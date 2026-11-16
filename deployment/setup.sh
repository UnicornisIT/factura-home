#!/usr/bin/env bash
# Ubuntu/Debian. Run from a trusted copy of the repository.
set -Eeuo pipefail
umask 022
# Secrets must stay out of execution traces, including when invoked with bash -x.
set +x

SETUP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NODE=/usr/bin/node
SERVICE=factura
LOCK_FILE=/run/lock/factura-update.lock
HOST=127.0.0.1
PORT=3000
UPDATER=/usr/local/sbin/factura-update.sh
UPDATE_CONFIG=/etc/factura/update.env
MYSQL_SETUP_STATE=/etc/factura/mysql-setup.env
UNIT=/etc/systemd/system/factura.service
SUDOERS=/etc/sudoers.d/factura-update
NGINX_SITE=/etc/nginx/sites-available/factura
NGINX_LINK=/etc/nginx/sites-enabled/factura
MYSQL_CONTAINER=factura-mysql
ACME_ROOT=/var/www/factura-acme
REPO_DEFAULT=UnicornisIT/factura-home

log() { printf '\n==> %s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { warn "$*"; exit 1; }
config() { "$NODE" "$SETUP_DIR/setup-config.mjs" "$@"; }

answer() {
  local label="$1" default="${2:-}"
  if [ -n "$default" ]; then label="$label [$default]"; fi
  IFS= read -rp "$label: " REPLY || die "Ввод прерван"
  REPLY="${REPLY:-$default}"
}

ask() {
  local key="$1"
  shift
  answer "$@"
  while [ -z "$REPLY" ]; do answer "$@"; done
  printf -v "$key" '%s' "$REPLY"
}

secret() {
  IFS= read -rsp "$2 (ввод скрыт): " REPLY || die "Ввод прерван"
  printf '\n'
  [[ "$REPLY" != *[[:cntrl:]]* ]] || die "Секрет содержит управляющие символы"
  printf -v "$1" '%s' "$REPLY"
}

yes_no() {
  answer "$1 [y/N]" n
  [[ "$REPLY" =~ ^([yY]|[yY][eE][sS])$ ]]
}

choice() {
  local key="$1" label="$2" default="$3" allowed="$4"
  while true; do
    answer "$label" "$default"
    if [[ "$REPLY" =~ ^($allowed)$ ]]; then
      printf -v "$key" '%s' "$REPLY"
      return
    fi
    warn "Выберите один из указанных вариантов."
  done
}

ask_path() {
  local key="$1" label="$2" default="$3"
  ask "$key" "$label" "$default"
  local path="${!key}"
  [[ "$path" =~ ^/([a-zA-Z0-9._-]+/)*[a-zA-Z0-9._-]+$ ]] ||
    die "Нужен абсолютный путь без пробелов: $label"
  if [ "${4:-}" != keep-links ]; then path="$(realpath -m -- "$path")"; fi
  [[ "$path" =~ ^/([a-zA-Z0-9._-]+/)*[a-zA-Z0-9._-]+$ ]] ||
    die "Недопустимый путь: $label"
  printf -v "$key" '%s' "$path"
}

safe_id() {
  [[ "$1" =~ ^[1-9][0-9]{0,15}$ ]] && (( 10#$1 <= 9007199254740991 ))
}

ask_port() {
  ask "$1" "$2" "$3"
  local port="${!1}"
  if [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
    die "Порт должен быть между 1 и 65535"
  fi
}

installed() {
  [ "$(dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null)" = installed ]
}

node_ready() {
  [ -x "$NODE" ] && "$NODE" -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major === 22 && minor >= 12 ? 0 : 1);
  ' && command -v npm >/dev/null && [[ "$(npm --version)" =~ ^[0-9]+\. ]] &&
    [ "${BASH_REMATCH[0]%.}" -ge 10 ]
}

probe_server() {
  [ "$(id -u)" -eq 0 ] || die "Запустите: sudo bash deployment/setup.sh"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "$ID" in
    ubuntu) minimum=22.04 ;;
    debian) minimum=12 ;;
    *) die "Поддерживаются Ubuntu 22.04+ и Debian 12+" ;;
  esac
  dpkg --compare-versions "$VERSION_ID" ge "$minimum" ||
    die "Неподдерживаемая версия ОС: $PRETTY_NAME"
  [ "$(ps -p 1 -o comm=)" = systemd ] || die "Требуется сервер с systemd"
  ARCH="$(dpkg --print-architecture)"
  log "Сервер: $PRETTY_NAME, $ARCH"
  df -h --output=target,avail / /opt /var
  local binary
  for binary in git node npm mysql mysqld nginx certbot; do
    printf '  %s: %s\n' "$binary" "$(command -v "$binary" || printf 'нет')"
  done
  if command -v curl >/dev/null; then
    curl -fsS --max-time 10 https://api.github.com/ -o /dev/null ||
      warn "Связь с GitHub не подтверждена. Мастер повторит проверку перед загрузкой."
  elif command -v getent >/dev/null; then
    getent hosts api.github.com >/dev/null ||
      warn "Разрешение имени api.github.com не подтверждено."
  fi
}

read_old() { config get "$ENV_FILE" "$1"; }
read_install() {
  if [ -f "$UPDATE_CONFIG" ]; then config get "$UPDATE_CONFIG" "$1"; fi
}

select_installation() {
  log "Каталог установки"
  local default=/opt/factura detected=""
  if [ -x "$NODE" ] && [ -f "$UPDATE_CONFIG" ]; then
    detected="$(read_install FACTURA_APP_DIR)"
  fi
  if [ -n "$detected" ] && [ -f "$detected/app/.env" ]; then
    default="$(dirname "$detected")"
  fi
  ask_path APP_PARENT "Корневой каталог приложения" "$default"
  APP_DIR="$APP_PARENT/current"
  if [ "$APP_PARENT" = "$default" ] && [ -n "$detected" ] && [ -f "$detected/app/.env" ]; then
    APP_DIR="$detected"
  elif [ -f "$APP_PARENT/app/.env" ]; then
    APP_DIR="$APP_PARENT"
  fi
  ENV_FILE="$APP_DIR/app/.env"
  RECONFIGURE=false
  if [ -f "$ENV_FILE" ]; then
    node_ready || die "Для чтения действующей конфигурации требуется Node.js 22.12+ и npm 10+."
    [ -d "$APP_DIR/.git" ] || die "В действующей установке отсутствует .git"
    RECONFIGURE=true
    log "Найдена действующая конфигурация: $ENV_FILE"
    local installed_dir
    installed_dir="$(systemctl show -p WorkingDirectory --value "$SERVICE")"
    [ -z "$installed_dir" ] || [ "$installed_dir" = "$APP_DIR/app" ] ||
      die "factura.service относится к другой установке: $installed_dir"
  elif [ -e "$UNIT" ] || { [ -n "$detected" ] && [ -f "$detected/app/.env" ]; }; then
    die "Обнаружена другая установка Factura. Укажите её каталог."
  fi
}

github_get() {
  local endpoint="$1"
  if [ -n "$GITHUB_TOKEN" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN" |
      curl -fsS --max-time 25 --config - "https://api.github.com/$endpoint"
  else
    curl -fsS --max-time 25 "https://api.github.com/$endpoint"
  fi
}

discover_latest_release() {
  if command -v curl >/dev/null && node_ready; then
    github_get "repos/$REPOSITORY/releases/latest" | config release
  elif command -v python3 >/dev/null; then
    printf '%s' "$GITHUB_TOKEN" | python3 -c '
import json, sys, urllib.request
url = "https://api.github.com/repos/" + sys.argv[1] + "/releases/latest"
token = sys.stdin.read()
headers = {"Authorization": "Bearer " + token} if token else {}
with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as response:
    print(json.load(response)["tag_name"])
' "$REPOSITORY"
  else
    return 1
  fi
}

git_auth_header() {
  printf 'Authorization: Basic '
  printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0
}

select_release() {
  log "GitHub и релиз"
  GITHUB_TOKEN=""
  DEPLOY_KEY_PATH=""
  if "$RECONFIGURE"; then
    REPOSITORY="$(read_old SERVER_UPDATE_REPOSITORY)"
    REPOSITORY="${REPOSITORY:-$REPO_DEFAULT}"
    GITHUB_TOKEN="$(read_old GITHUB_TOKEN)"
    local origin
    origin="$(app_git remote get-url origin)"
    GIT_ACCESS=https
    if [[ "$origin" == git@* || "$origin" == ssh://* ]]; then GIT_ACCESS=ssh; fi
    RELEASE_REF="$(app_git describe --tags --exact-match 2>/dev/null || app_git rev-parse --short HEAD)"
    if yes_no "Заменить токен GitHub для $REPOSITORY?"; then secret GITHUB_TOKEN "PAT GitHub"; fi
  else
    ask REPOSITORY "GitHub-репозиторий (owner/name)" "$REPO_DEFAULT"
    choice GIT_ACCESS "Доступ к GitHub (https: публичный или PAT, ssh: deploy key)" https 'https|ssh'
    secret GITHUB_TOKEN "PAT GitHub с Contents: read (Enter для публичного репозитория)"
    if [ "$GIT_ACCESS" = ssh ]; then
      ask DEPLOY_KEY_PATH "Путь к приватному SSH deploy key"
      [ -f "$DEPLOY_KEY_PATH" ] || die "Deploy key не найден"
    fi
    [[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "Неверный формат репозитория"
    [[ "$GITHUB_TOKEN" =~ ^[a-zA-Z0-9_]*$ ]] || die "Неверный формат PAT GitHub"
    local latest
    latest="$(discover_latest_release 2>/dev/null)" || latest=""
    ask RELEASE_REF "Тег релиза (latest — последний стабильный опубликованный)" "${latest:-latest}"
    if [ "$RELEASE_REF" != latest ]; then
      [[ "$RELEASE_REF" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "Недопустимый тег"
    fi
  fi
  [[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "Неверный формат репозитория"
  [[ "$GITHUB_TOKEN" =~ ^[a-zA-Z0-9_]*$ ]] || die "Неверный формат PAT GitHub"
}

select_paths() {
  log "Каталоги, пользователь и порт"
  if "$RECONFIGURE"; then
    APP_USER="$(stat -c %U "$APP_DIR")"
    DATA_DIR="$(read_install FACTURA_DATA_DIR)"
    BACKUP_DIR="$(read_install FACTURA_BACKUP_DIR)"
    LOG_DIR="$(read_install FACTURA_UPDATE_LOG)"
    LOG_DIR="${LOG_DIR%/*}"
    UPLOAD_DIR="$(read_old UPLOAD_DIR)"
    DATA_DIR="${DATA_DIR:-/var/lib/factura}"
    BACKUP_DIR="${BACKUP_DIR:-/var/backups/factura}"
    LOG_DIR="${LOG_DIR:-/var/log/factura}"
  else
    ask APP_USER "Системный пользователь" factura
    ask_path DATA_DIR "Каталог данных" /var/lib/factura
    ask_path UPLOAD_DIR "Каталог загруженных изображений" "$DATA_DIR/uploads"
    ask_path BACKUP_DIR "Каталог резервных копий" /var/backups/factura
    ask_path LOG_DIR "Каталог журналов" /var/log/factura
  fi
  if [[ ! "$APP_USER" =~ ^[a-z_][a-z0-9_-]{0,30}$ || "$APP_USER" == root ]]; then
    die "Недопустимое имя системного пользователя"
  fi
  if id "$APP_USER" >/dev/null 2>&1; then
    local uid uid_min
    uid="$(id -u "$APP_USER")"
    uid_min="$(awk '$1 == "UID_MIN" {print $2; exit}' /etc/login.defs)"
    if ! { [ "$uid" -gt 0 ] && [ "$uid" -lt "${uid_min:-1000}" ] &&
      [ "$(id -gn "$APP_USER")" = "$APP_USER" ]; }; then
      die "Используйте отдельного системного пользователя с одноимённой группой"
    fi
  fi
  local path
  for path in "$APP_DIR" "$DATA_DIR" "$UPLOAD_DIR" "$BACKUP_DIR" "$LOG_DIR"; do
    [[ "$path" =~ ^/([a-zA-Z0-9._-]+/)*[a-zA-Z0-9._-]+$ ]] ||
      die "Неподдерживаемый системный путь: $path"
  done
  [[ "$UPLOAD_DIR/" != "$APP_DIR/"* ]] || die "Каталог изображений должен быть вне каталога релиза"
  local old_port=3000
  if "$RECONFIGURE"; then old_port="$(read_old PORT)"; fi
  ask_port PORT "Порт API на localhost" "${old_port:-3000}"
}

select_database() {
  log "База данных"
  DB_MODE=""
  DB_NAME=""
  DATABASE_URL=""
  SQLITE_PATH=""
  DB_PASS=""
  if "$RECONFIGURE"; then
    DB_DIALECT="$(read_old DB_DIALECT)"
    DB_DIALECT="${DB_DIALECT:-mysql}"
    if [ "$DB_DIALECT" = mysql ]; then
      DATABASE_URL="$(read_old DATABASE_URL)"
      DB_NAME="$(printf '%s' "$DATABASE_URL" | config mysql-db)" || die "Проверьте существующий DATABASE_URL"
      if yes_no "Изменить учётные данные MySQL для той же базы?"; then
        ask DB_USER "Новый пользователь MySQL"
        secret DB_PASS "Новый пароль MySQL"
        [ -n "$DB_PASS" ] || die "Требуется пароль MySQL"
      fi
    else
      SQLITE_PATH="$(read_old SQLITE_PATH)"
      SQLITE_PATH="${SQLITE_PATH:-$APP_DIR/app/dev.db}"
      [[ "$SQLITE_PATH" = /* ]] || SQLITE_PATH="$APP_DIR/app/$SQLITE_PATH"
    fi
  else
    choice DB_DIALECT "Диалект БД (sqlite или mysql)" sqlite 'sqlite|mysql'
    if [ "$DB_DIALECT" = sqlite ]; then
      ask_path SQLITE_PATH "Путь к файлу SQLite" "$DATA_DIR/factura.db"
      [[ "$SQLITE_PATH/" != "$APP_DIR/"* ]] || die "Файл SQLite должен находиться вне каталога релиза"
      if [ -e "$SQLITE_PATH" ]; then warn "Будет использована существующая SQLite: $SQLITE_PATH"; fi
    else
      choice DB_MODE "MySQL (install: установить, local: существующий локальный, remote: внешний)" remote 'install|local|remote'
      if [ "$DB_MODE" = remote ]; then
        ask DB_HOST "Имя или IP сервера MySQL"
        [[ "$DB_HOST" =~ ^[a-zA-Z0-9.-]+$ || "$DB_HOST" =~ ^\[[:a-fA-F0-9]+\]$ ]] ||
          die "Некорректный адрес MySQL (IPv6 укажите в квадратных скобках)"
      else
        DB_HOST=127.0.0.1
      fi
      if [ "$DB_MODE" = install ] && [ "$ID" = ubuntu ]; then
        DB_PORT=3306
      else
        ask_port DB_PORT "Порт MySQL" 3306
      fi
      ask DB_NAME "Имя базы данных MySQL" factura
      ask DB_USER "Пользователь приложения MySQL" factura
      secret DB_PASS "Пароль MySQL (Enter — сгенерировать для локальной БД)"
      [ -n "$DB_PASS" ] || [ "$DB_MODE" != remote ] || die "Требуется пароль MySQL"
      if [ "$DB_MODE" = local ]; then
        ask MYSQL_SOCKET "Unix-сокет для локального входа root" /run/mysqld/mysqld.sock
        [[ "$MYSQL_SOCKET" = /* ]] || die "Укажите абсолютный путь к MySQL socket"
        secret MYSQL_ROOT_PASSWORD "Пароль MySQL root (Enter для socket authentication)"
      fi
    fi
  fi
  if [ -n "${DB_USER:-}" ]; then
    if [[ ! "$DB_USER" =~ ^[a-zA-Z0-9_]{1,32}$ || "$DB_USER" == root ]]; then
      die "Укажите отдельного пользователя приложения (буквы ASCII, цифры, _)"
    fi
  fi
  if [ "$DB_DIALECT" = mysql ]; then
    [[ "$DB_NAME" =~ ^[a-zA-Z0-9_]{1,64}$ ]] || die "Недопустимое имя базы"
    [[ ! "$DB_NAME" =~ ^(mysql|sys|performance_schema|information_schema)$ ]] ||
      die "Укажите отдельную базу приложения."
  fi
}

select_web() {
  log "Домен и HTTPS"
  local old_origin="" tls_default=letsencrypt
  if "$RECONFIGURE"; then
    old_origin="$(read_old PUBLIC_ORIGIN)"
    tls_default=existing
  fi
  ask PUBLIC_ORIGIN "Публичный адрес (например https://shop.example.com)" "$old_origin"
  [[ "$PUBLIC_ORIGIN" =~ ^https://([a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[1-9][0-9]{0,4})?$ ]] ||
    die "Укажите HTTPS-домен в нижнем регистре без пути"
  DOMAIN="${BASH_REMATCH[1]}"
  choice TLS_MODE "HTTPS (letsencrypt, certificate, external, existing при повторной настройке)" \
    "$tls_default" "$("$RECONFIGURE" && printf 'letsencrypt|certificate|external|existing' || printf 'letsencrypt|certificate|external')"
  if [[ "$TLS_MODE" =~ ^(letsencrypt|certificate)$ ]]; then
    [ "$PUBLIC_ORIGIN" = "https://$DOMAIN" ] || die "Встроенный Nginx использует порт 443"
  fi
  case "$TLS_MODE" in
    letsencrypt)
      ask ACME_EMAIL "Email для Let's Encrypt"
      [[ "$ACME_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] ||
        die "Некорректный email"
      warn "Для проверки Let's Encrypt домен должен указывать на этот сервер, TCP 80 и 443 должны быть доступны."
      yes_no "Принимаете условия Let's Encrypt (https://letsencrypt.org/repository/)?" ||
        die "Выберите существующий сертификат или внешний reverse proxy."
      ;;
    certificate)
      ask_path TLS_CERT "Путь к PEM-файлу сертификата с цепочкой" "/etc/ssl/certs/$DOMAIN.pem" keep-links
      ask_path TLS_KEY "Путь к приватному ключу PEM" "/etc/ssl/private/$DOMAIN.key" keep-links
      if [[ ! -r "$TLS_CERT" || ! -r "$TLS_KEY" ]]; then
        die "Сертификат или ключ недоступен"
      fi
      ;;
    external)
      warn "Заранее настройте HTTPS-прокси для $PUBLIC_ORIGIN на http://$HOST:$PORT (локальный прокси или туннель)."
      ;;
    existing)
      [ "$PUBLIC_ORIGIN" = "$old_origin" ] ||
        die "При смене домена выберите способ настройки HTTPS"
      [ "$PORT" = "$(read_old PORT)" ] ||
        die "При смене порта выберите способ настройки HTTPS"
      ;;
  esac
}

select_telegram() {
  log "Telegram и администраторы"
  local old_bot="" count id
  TELEGRAM_BOT_TOKEN=""
  if "$RECONFIGURE"; then
    old_bot="$(read_old TELEGRAM_BOT_NAME)"
    TELEGRAM_BOT_TOKEN="$(read_old TELEGRAM_BOT_TOKEN)"
  fi
  ask TELEGRAM_BOT_NAME "Username бота (без @)" "$old_bot"
  [[ "$TELEGRAM_BOT_NAME" =~ ^[a-zA-Z][a-zA-Z0-9_]{4,31}$ ]] || die "Некорректный username"
  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ "$TELEGRAM_BOT_NAME" != "$old_bot" ] ||
    yes_no "Заменить токен Telegram?"; then
    secret TELEGRAM_BOT_TOKEN "Токен Telegram от BotFather"
  fi
  [[ "$TELEGRAM_BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || die "Некорректный формат токена Telegram"
  warn "Для Telegram Login Widget привяжите $DOMAIN к боту @$TELEGRAM_BOT_NAME через /setdomain в BotFather."
  if "$RECONFIGURE"; then
    SUPER_ADMIN_TELEGRAM_ID="$(read_old SUPER_ADMIN_TELEGRAM_ID)"
    safe_id "$SUPER_ADMIN_TELEGRAM_ID" || die "Проверьте Telegram ID владельца в существующем .env"
  else
    while true; do
      ask SUPER_ADMIN_TELEGRAM_ID "Числовой Telegram ID владельца (super_admin)"
      if safe_id "$SUPER_ADMIN_TELEGRAM_ID"; then break; fi
      warn "Введите положительное целое число до 9007199254740991."
    done
  fi
  while true; do
    ask count "Количество обычных администраторов, которых нужно добавить" 0
    if [ "$count" = 0 ] || safe_id "$count"; then break; fi
    warn "Введите неотрицательное целое число."
  done
  ADMIN_IDS=()
  local -A seen=(["$SUPER_ADMIN_TELEGRAM_ID"]=1)
  while [ "${#ADMIN_IDS[@]}" -lt "$count" ]; do
    ask id "Telegram ID администратора $((${#ADMIN_IDS[@]} + 1))/$count"
    if ! safe_id "$id"; then
      warn "Введите положительное целое число до 9007199254740991."
    elif [ -n "${seen[$id]:-}" ]; then
      warn "ID уже указан или принадлежит владельцу."
    else
      ADMIN_IDS+=("$id")
      seen[$id]=1
    fi
  done
}

plan() {
  APP_SECRET=""
  if "$RECONFIGURE"; then
    APP_SECRET="$(read_old APP_SECRET)"
    if yes_no "Заменить APP_SECRET? Действующие сессии потребуют нового входа."; then APP_SECRET=""; fi
  fi
  local update_default=false seed_default=false
  if "$RECONFIGURE" && [ "$(read_old SERVER_UPDATE_ENABLED)" = true ]; then update_default=true; fi
  choice UPDATE_ENABLED "Обновления из панели (true/false)" "$update_default" 'true|false'
  choice SEED "Добавить демонстрационные данные (true/false)" "$seed_default" 'true|false'
  PACKAGES=(git curl ca-certificates sudo build-essential python3 openssh-client)
  if [ "$DB_DIALECT" = sqlite ]; then
    PACKAGES+=(sqlite3)
  else
    PACKAGES+=(default-mysql-client)
    if [ "$DB_MODE" = install ]; then
      if [ "$ID" = debian ]; then PACKAGES+=(docker.io); else PACKAGES+=(mysql-server); fi
    fi
  fi
  if [[ "$TLS_MODE" =~ ^(letsencrypt|certificate)$ ]]; then PACKAGES+=(nginx); fi
  if [ "$TLS_MODE" = letsencrypt ]; then PACKAGES+=(certbot); fi
  MISSING=()
  local pkg
  for pkg in "${PACKAGES[@]}"; do
    if ! installed "$pkg"; then MISSING+=("$pkg"); fi
  done
  NEED_NODE=false
  if ! node_ready; then NEED_NODE=true; fi

  log "Проверьте параметры"
  printf '  ОС: %s (%s)\n  Повторная настройка: %s\n' "$PRETTY_NAME" "$ARCH" "$RECONFIGURE"
  printf '  Репозиторий: %s (%s)\n  Релиз: %s\n' "$REPOSITORY" "$GIT_ACCESS" "$RELEASE_REF"
  if [ "$DB_DIALECT" = sqlite ]; then
    printf '  База: SQLite, %s\n' "$SQLITE_PATH"
  elif "$RECONFIGURE"; then
    printf '  База: MySQL, %s' "$DB_NAME"
    printf '%s' "$DATABASE_URL" | config mysql-summary
    if [ -n "$DB_PASS" ]; then printf '  Новый пользователь MySQL: %s\n' "$DB_USER"; fi
  else
    printf '  База: MySQL (%s), %s@%s:%s/%s\n' "$DB_MODE" "$DB_USER" "$DB_HOST" "$DB_PORT" "$DB_NAME"
  fi
  printf '  Домен: %s (%s)\n  API: %s:%s\n  Бот: @%s\n  Владелец (super_admin): %s\n' \
    "$PUBLIC_ORIGIN" "$TLS_MODE" "$HOST" "$PORT" "$TELEGRAM_BOT_NAME" "$SUPER_ADMIN_TELEGRAM_ID"
  printf '  Администраторы (admin): %s\n' "${ADMIN_IDS[*]:-нет}"
  printf '  Приложение: %s (%s)\n  Данные: %s\n  Изображения: %s\n  Копии: %s\n  Журнал: %s\n' \
    "$APP_DIR" "$APP_USER" "$DATA_DIR" "$UPLOAD_DIR" "$BACKUP_DIR" "$LOG_DIR"
  printf '  Обновления: %s\n  Демоданные: %s\n' "$UPDATE_ENABLED" "$SEED"
  printf '  Установить пакеты: %s\n  Установить Node.js 22 из NodeSource: %s\n' "${MISSING[*]:-нет}" "$NEED_NODE"
  if [ "$DB_MODE" = install ] && [ "$ID" = debian ]; then
    printf '  Локальный MySQL 8.4 будет запущен в контейнере Docker.\n'
  fi
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  if [ "${#MISSING[@]}" -gt 0 ]; then
    apt-get update -qq
    apt-get install -y "${MISSING[@]}"
  fi
  if "$NEED_NODE"; then
    curl -fsS --max-time 60 https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  node_ready || die "Требуются системные Node.js 22.12+ и npm 10+"
}

check_telegram() {
  printf 'url = "https://api.telegram.org/bot%s/getMe"\n' "$TELEGRAM_BOT_TOKEN" |
    curl -fsS --max-time 20 --config - 2>/dev/null |
    config telegram "$TELEGRAM_BOT_NAME" ||
    die "Telegram getMe не подтвердил токен и username бота"
}

app_exec() {
  local cwd="$1"
  shift
  runuser -u "$APP_USER" -- env -i --chdir="$cwd" PATH=/usr/bin:/bin:/usr/local/bin \
    HOME="$DATA_DIR" npm_config_cache="$DATA_DIR/.npm" "$@"
}
app_git() { app_exec "$APP_DIR" git "$@"; }

make_app_dir() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    install -d -m 0750 -o "$APP_USER" -g "$APP_USER" -- "$dir"
  fi
  runuser -u "$APP_USER" -- test -w "$dir" || die "Пользователь $APP_USER не может писать в $dir"
}

ensure_directories() {
  id "$APP_USER" >/dev/null 2>&1 ||
    useradd --system --user-group --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
  mkdir -p -- "$APP_PARENT" /run/lock
  make_app_dir "$DATA_DIR"
  make_app_dir "$UPLOAD_DIR"
  make_app_dir "$LOG_DIR"
  if [ "$DB_DIALECT" = sqlite ]; then make_app_dir "$(dirname "$SQLITE_PATH")"; fi
  if [ ! -d "$BACKUP_DIR" ]; then install -d -m 0700 -- "$BACKUP_DIR"; fi
  local uid mode
  read -r uid mode < <(stat -c '%u %a' "$BACKUP_DIR")
  if [ "$uid" != 0 ] || (( (8#$mode & 022) != 0 )); then
    die "Каталог копий должен принадлежать root и быть недоступен на запись другим: $BACKUP_DIR"
  fi
}

clone_release() {
  local url ssh_config="" token_header="" key_dir="$DATA_DIR/keys"
  local -a flags=()
  if [ "$GIT_ACCESS" = ssh ]; then
    url="git@github.com:$REPOSITORY.git"
    make_app_dir "$key_dir"
    install -m 0600 -o "$APP_USER" -g "$APP_USER" -- "$DEPLOY_KEY_PATH" "$key_dir/factura_deploy"
    # Published ED25519 host key from GitHub's SSH key fingerprints page.
    printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' >"$WORK/known_hosts"
    install -m 0600 -o "$APP_USER" -g "$APP_USER" "$WORK/known_hosts" "$key_dir/known_hosts"
    ssh_config="ssh -i $key_dir/factura_deploy -o UserKnownHostsFile=$key_dir/known_hosts -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o BatchMode=yes"
    flags=(-c "core.sshCommand=$ssh_config")
  else
    url="https://github.com/$REPOSITORY.git"
    if [ -n "$GITHUB_TOKEN" ]; then
      token_header="$(git_auth_header)"
      flags=(--config-env=http.extraHeader=FACTURA_GIT_HEADER)
    fi
  fi
  if [ -d "$APP_DIR/.git" ]; then
    if [[ "$(app_git remote get-url origin)" != "$url" ||
      "$(app_git describe --tags --exact-match)" != "$RELEASE_REF" ]]; then
      die "Остался checkout другого релиза в $APP_DIR. Выберите его тег или другой каталог."
    fi
    return
  fi
  [ ! -e "$APP_DIR" ] || die "Каталог $APP_DIR занят"
  CLONE_TEMP="$(mktemp -d "$APP_PARENT/.checkout.XXXXXX")"
  GIT_TERMINAL_PROMPT=0 FACTURA_GIT_HEADER="$token_header" git "${flags[@]}" \
    clone --branch "$RELEASE_REF" -- "$url" "$CLONE_TEMP" ||
    die "Git не смог загрузить релиз. Проверьте тег и доступ к репозиторию."
  git -C "$CLONE_TEMP" checkout --detach "refs/tags/$RELEASE_REF" ||
    die "Выбранная версия должна быть тегом релиза"
  if [ -n "$ssh_config" ]; then git -C "$CLONE_TEMP" config core.sshCommand "$ssh_config"; fi
  chown -R "$APP_USER:$APP_USER" "$CLONE_TEMP"
  chmod 0755 "$CLONE_TEMP"
  mv -T -- "$CLONE_TEMP" "$APP_DIR"
  CLONE_TEMP=""
}

mysql_options() {
  printf '%s' "$1" | config mysql-options >"$WORK/mysql.cnf"
  chmod 0600 "$WORK/mysql.cnf"
}

mysql_app() { mysql --defaults-extra-file="$WORK/mysql.cnf" --connect-timeout=8 "$@"; }

mysql_root() {
  if [ "$DB_MODE" = install ] && [ "$ID" = debian ]; then
    docker exec -i "$MYSQL_CONTAINER" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --binary-mode'
  else
    MYSQL_PWD="${MYSQL_ROOT_PASSWORD:-}" mysql --user=root --protocol=SOCKET \
      --socket="${MYSQL_SOCKET:-/run/mysqld/mysqld.sock}" --binary-mode
  fi
}

start_local_mysql() {
  if [ "$ID" = ubuntu ]; then
    systemctl enable --now mysql
    return
  fi
  systemctl enable --now docker
  if docker container inspect "$MYSQL_CONTAINER" >/dev/null 2>&1; then
    [ "$(docker inspect -f '{{index .Config.Labels "org.factura.installation"}}' "$MYSQL_CONTAINER")" = "$APP_PARENT" ] ||
      die "Имя контейнера $MYSQL_CONTAINER уже занято"
    docker start "$MYSQL_CONTAINER" >/dev/null
  else
    printf 'MYSQL_ROOT_PASSWORD=%s\n' "$(config random)" >"$WORK/container.env"
    docker run -d --name "$MYSQL_CONTAINER" --restart unless-stopped \
      --label "org.factura.installation=$APP_PARENT" --env-file "$WORK/container.env" \
      -p "$DB_HOST:$DB_PORT:3306" --mount "type=volume,source=factura-mysql,target=/var/lib/mysql" \
      mysql:8.4 >/dev/null
    rm -f -- "$WORK/container.env"
  fi
  local tried
  for ((tried=0; tried<60; tried++)); do
    if printf 'SELECT 1;\n' | mysql_root >/dev/null 2>&1; then return; fi
    sleep 1
  done
  die "Локальный MySQL не запустился"
}

prepare_database() {
  case "$DB_DIALECT" in
    sqlite)
      if "$RECONFIGURE"; then
        [ -f "$SQLITE_PATH" ] || die "База SQLite из действующей конфигурации не найдена"
      fi
      app_exec "$APP_DIR" sqlite3 "$SQLITE_PATH" 'PRAGMA schema_version;' >/dev/null ||
        die "Ошибка открытия SQLite"
      ;;
    mysql)
      if "$RECONFIGURE"; then
        if [ -n "$DB_PASS" ]; then
          DATABASE_URL="$(printf '%s' "$DB_PASS" | config mysql-change-user "$DB_USER" "$ENV_FILE")"
        fi
      else
        if [ -z "$DB_PASS" ]; then local_mysql_password; fi
        if [ "$DB_MODE" = install ]; then start_local_mysql; fi
        if [[ "$DB_MODE" =~ ^(install|local)$ ]]; then
          local account_host=localhost
          if [ "$DB_MODE" = install ] && [ "$ID" = debian ]; then account_host='%'; fi
          local escaped="${DB_PASS//\'/\'\'}"
          mysql_root >/dev/null 2>&1 <<SQL || die "Не удалось создать базу и пользователя MySQL. Проверьте root-доступ."
SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES';
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'$account_host' IDENTIFIED BY '$escaped';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'$account_host';
SQL
        fi
        DATABASE_URL="$(printf '%s' "$DB_PASS" | config mysql-url "$DB_USER" "$DB_HOST" "$DB_PORT" "$DB_NAME")"
      fi
      mysql_options "$DATABASE_URL"
      local probe
      probe="factura_setup_$$_$(date +%s)"
      if ! mysql_app --database="$DB_NAME" >/dev/null 2>&1 <<SQL
CREATE TABLE \`$probe\` (id INT PRIMARY KEY) ENGINE=InnoDB;
ALTER TABLE \`$probe\` ADD COLUMN value INT;
CREATE INDEX setup_value ON \`$probe\` (value);
CREATE TABLE \`${probe}_fk\` (id INT, FOREIGN KEY (id) REFERENCES \`$probe\`(id)) ENGINE=InnoDB;
INSERT INTO \`$probe\` (id) VALUES (1);
UPDATE \`$probe\` SET value = 1 WHERE id = 1;
SELECT value FROM \`$probe\` WHERE id = 1;
DELETE FROM \`$probe\` WHERE id = 1;
DROP TABLE \`${probe}_fk\`;
DROP TABLE \`$probe\`;
SQL
      then
        mysql_app --database="$DB_NAME" -e "DROP TABLE IF EXISTS ${probe}_fk, $probe" >/dev/null 2>&1 || true
        die "MySQL: нет подключения или прав на чтение, запись и миграции схемы."
      fi
      ;;
  esac
}

local_mysql_password() {
  local key="$APP_DIR:$DB_NAME:$DB_USER"
  if [ -e "$MYSQL_SETUP_STATE" ]; then
    if [[ "$(stat -c '%u:%a' "$MYSQL_SETUP_STATE")" != 0:600 ||
      "$(config get "$MYSQL_SETUP_STATE" INSTALLATION)" != "$key" ]]; then
      die "Найдены данные незавершённой настройки другой базы MySQL в $MYSQL_SETUP_STATE"
    fi
    DB_PASS="$(config get "$MYSQL_SETUP_STATE" PASSWORD)"
  else
    DB_PASS="$(config random)"
    printf 'INSTALLATION=%s\nPASSWORD=%s\n' "$key" "$DB_PASS" >"$WORK/mysql-setup.env"
    install -d -m 0755 /etc/factura
    install -m 0600 "$WORK/mysql-setup.env" "$MYSQL_SETUP_STATE"
  fi
  USED_MYSQL_SETUP_STATE=true
}

database_query() {
  if [ "$DB_DIALECT" = sqlite ]; then
    app_exec "$APP_DIR" sqlite3 -batch -noheader "$SQLITE_PATH" "$1"
  else
    mysql_app --batch --skip-column-names --database="$DB_NAME" -e "$1"
  fi
}

check_existing_owner() {
  local query tables
  if [ "$DB_DIALECT" = sqlite ]; then
    query="SELECT count(*) FROM sqlite_master WHERE type='table' AND name='adminAllowlist'"
  else
    query="SELECT count(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='adminAllowlist'"
  fi
  tables="$(database_query "$query")"
  if [ "$tables" -eq 0 ]; then return; fi
  local owners chosen
  owners="$(database_query "SELECT count(*) FROM adminAllowlist WHERE role='super_admin'")"
  chosen="$(database_query "SELECT count(*) FROM adminAllowlist WHERE telegramId=$SUPER_ADMIN_TELEGRAM_ID AND role='super_admin'")"
  if [ "$owners" -gt 0 ] && [ "$chosen" -eq 0 ]; then
    die "В базе уже настроен другой super_admin. Проверьте базу и Telegram ID владельца."
  fi
}

backup_existing() {
  BACKUP="$(mktemp -d "$BACKUP_DIR/setup-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
  cp -p -- "$ENV_FILE" "$BACKUP/app.env"
  chmod 0600 "$BACKUP/app.env"
  if [ "$DB_DIALECT" = sqlite ]; then
    app_exec "$APP_DIR" bash -eus -- "$SQLITE_PATH" >"$BACKUP/shop.db" <<'BASH'
dir=$(mktemp -d)
trap 'rm -f "$dir/shop.db"; rmdir "$dir"' EXIT
sqlite3 -readonly "$1" ".backup $dir/shop.db"
[ "$(sqlite3 -readonly "$dir/shop.db" "PRAGMA integrity_check")" = ok ]
cat "$dir/shop.db"
BASH
  else
    mysql_options "$DATABASE_URL"
    mysqldump --defaults-extra-file="$WORK/mysql.cnf" --single-transaction --skip-lock-tables \
      --no-tablespaces "$DB_NAME" >"$BACKUP/mysql.sql" 2>/dev/null ||
      die "Не удалось сохранить резервную копию MySQL"
  fi
  if [ -d "$UPLOAD_DIR" ]; then
    app_exec "$APP_DIR" tar -C "$UPLOAD_DIR" -czf - . >"$BACKUP/uploads.tar.gz"
  fi
  log "Резервная копия действующей установки: $BACKUP"
}

# Snapshot only the files managed by this installer; backups and data survive errors.
snapshot() {
  TARGETS=("$ENV_FILE" "$UNIT" "$UPDATE_CONFIG" "$UPDATER" "$SUDOERS" "$NGINX_SITE" "$NGINX_LINK")
  local i path
  for i in "${!TARGETS[@]}"; do
    path="${TARGETS[$i]}"
    if [ -e "$path" ] || [ -L "$path" ]; then
      cp -a -- "$path" "$WORK/old-$i"
      if [ -n "$BACKUP" ] && [ "$path" != "$ENV_FILE" ]; then
        cp -a -- "$path" "$BACKUP/$(basename "$path").$i"
      fi
    fi
  done
  SNAPSHOT=true
}

cleanup() {
  local status=$? i path
  trap - EXIT
  set +e
  if [ "$status" -ne 0 ] && "$SNAPSHOT"; then
    if "$SERVICE_TOUCHED"; then
      systemctl stop "$SERVICE"
      if ! "$WAS_ENABLED"; then systemctl disable "$SERVICE"; fi
    fi
    for i in "${!TARGETS[@]}"; do
      path="${TARGETS[$i]}"
      if [ -e "$WORK/old-$i" ] || [ -L "$WORK/old-$i" ]; then
        rm -f -- "$path"
        cp -a -- "$WORK/old-$i" "$path" || warn "Не удалось восстановить $path"
      else
        rm -f -- "$path"
      fi
    done
    systemctl daemon-reload
    if "$NGINX_TOUCHED"; then nginx -t && systemctl reload nginx; fi
    if "$SERVICE_TOUCHED"; then
      if "$WAS_ACTIVE"; then systemctl start "$SERVICE" || warn "Проверьте journalctl -u $SERVICE"; fi
    fi
    warn "Установка прервана. Проверьте сообщения мастера и journalctl -u $SERVICE."
    if [ -n "$BACKUP" ]; then warn "Резервная копия: $BACKUP"; fi
  fi
  if [ -n "$CLONE_TEMP" ]; then rm -rf -- "$CLONE_TEMP"; fi
  rm -rf -- "$WORK"
  exit "$status"
}

write_env() {
  local previous="" temp
  if "$RECONFIGURE"; then previous="$WORK/old-0"; fi
  local secret_line=""
  if [ -z "$APP_SECRET" ]; then secret_line="APP_SECRET=$(config random)"; fi
  local db_line="SQLITE_PATH=$SQLITE_PATH"
  if [ "$DB_DIALECT" = mysql ]; then db_line="DATABASE_URL=$DATABASE_URL"; fi
  temp="$(mktemp "$APP_DIR/app/.env.setup.XXXXXX")"
  if ! config dotenv "$previous" >"$temp" <<ENV
NODE_ENV=production
DB_DIALECT=$DB_DIALECT
$db_line
$secret_line
PUBLIC_ORIGIN=$PUBLIC_ORIGIN
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_NAME=$TELEGRAM_BOT_NAME
SUPER_ADMIN_TELEGRAM_ID=$SUPER_ADMIN_TELEGRAM_ID
UPLOAD_DIR=$UPLOAD_DIR
PORT=$PORT
HOST=$HOST
SERVER_UPDATE_ENABLED=$UPDATE_ENABLED
SERVER_UPDATE_REPOSITORY=$REPOSITORY
GITHUB_TOKEN=$GITHUB_TOKEN
SERVER_UPDATE_SCRIPT=$UPDATER
SERVER_UPDATE_STATUS_PATH=$DATA_DIR/update-status.json
ENV
  then
    rm -f -- "$temp"
    die "Не удалось записать настройки приложения"
  fi
  chmod 0640 "$temp"
  chown "root:$APP_USER" "$temp"
  mv -fT -- "$temp" "$ENV_FILE"
}

install_systemd() {
  ADDITIONAL_WRITE_PATHS="$UPLOAD_DIR $LOG_DIR"
  if [ "$DB_DIALECT" = sqlite ]; then ADDITIONAL_WRITE_PATHS+=" $(dirname "$SQLITE_PATH")"; fi
  sed -e '/^EnvironmentFile=/d' -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@APP_USER@|$APP_USER|g" \
    -e "s|@RW_PATHS@|$DATA_DIR $ADDITIONAL_WRITE_PATHS|g" "$SETUP_DIR/factura.service" >"$WORK/factura.service"
  systemd-analyze verify "$WORK/factura.service"
  install -m 0644 "$WORK/factura.service" "$UNIT"
  systemctl daemon-reload
}

install_updates() {
  install -d -m 0755 /etc/factura
  cat >"$WORK/update.env" <<ENV
FACTURA_APP_DIR=$APP_DIR
FACTURA_SERVICE=$SERVICE
FACTURA_DATA_DIR=$DATA_DIR
FACTURA_RW_PATHS='$DATA_DIR $ADDITIONAL_WRITE_PATHS'
FACTURA_MANAGED_ENV=true
FACTURA_BACKUP_DIR=$BACKUP_DIR
FACTURA_UPDATE_LOG=$LOG_DIR/update.log
SERVER_UPDATE_STATUS_PATH=$DATA_DIR/update-status.json
ENV
  install -m 0600 "$WORK/update.env" "$UPDATE_CONFIG"
  if ! "$UPDATE_ENABLED"; then
    rm -f -- "$SUDOERS"
    return
  fi
  bash -n "$SETUP_DIR/factura-update.sh"
  sed -e "s/^factura /$APP_USER /" -e "s|@UPDATE_SCRIPT@|$UPDATER|" \
    "$SETUP_DIR/sudoers-factura-update" >"$WORK/sudoers"
  visudo -cf "$WORK/sudoers"
  install -m 0755 "$SETUP_DIR/factura-update.sh" "$UPDATER"
  install -m 0440 "$WORK/sudoers" "$SUDOERS"
  visudo -c
  sudo -n -l -U "$APP_USER" -- "$UPDATER" >/dev/null ||
    die "Пользователь $APP_USER не может запустить обновление через sudo"
  github_get "repos/$REPOSITORY/releases/latest" | config release >/dev/null ||
    die "Не удалось прочитать последний релиз для проверки обновлений"
  local -a credentials=()
  if [ -n "$GITHUB_TOKEN" ] && [ "$GIT_ACCESS" = https ]; then
    credentials=(--config-env=http.extraHeader=FACTURA_GIT_HEADER)
    GIT_TERMINAL_PROMPT=0 FACTURA_GIT_HEADER="$(git_auth_header)" \
      runuser -u "$APP_USER" -- git -C "$APP_DIR" "${credentials[@]}" ls-remote --exit-code origin HEAD >/dev/null
  else
    app_exec "$APP_DIR" env GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code origin HEAD >/dev/null
  fi
}

nginx_location() {
  cat <<NGINX
    client_max_body_size 6m;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    location / {
        proxy_pass http://$HOST:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header Origin \$http_origin;
        proxy_set_header Cookie \$http_cookie;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
NGINX
}

configure_nginx() {
  case "$TLS_MODE" in
    existing)
      if [ -e "$NGINX_LINK" ]; then nginx -t; fi
      return
      ;;
    external) return ;;
  esac
  [ ! -L "$NGINX_SITE" ] || die "Путь конфигурации Nginx уже занят символьной ссылкой"
  if [ -e "$NGINX_SITE" ] &&
    ! grep -qx '# Managed by Factura setup' "$NGINX_SITE"; then
    die "Сайт Nginx $NGINX_SITE уже существует. Используйте существующую или внешнюю конфигурацию."
  fi
  if [ -L "$NGINX_LINK" ]; then
    [ "$(readlink -f "$NGINX_LINK")" = "$NGINX_SITE" ] || die "Имя сайта Nginx занято"
  elif [ -e "$NGINX_LINK" ]; then
    die "Имя активного сайта Nginx занято"
  fi
  NGINX_TOUCHED=true
  if [ "$TLS_MODE" = letsencrypt ]; then
    install -d -m 0755 "$ACME_ROOT"
    render_nginx bootstrap
    activate_nginx
    certbot certonly --webroot -w "$ACME_ROOT" --cert-name "$DOMAIN" \
      --non-interactive --agree-tos --email "$ACME_EMAIL" -d "$DOMAIN" \
      --deploy-hook 'systemctl reload nginx'
    TLS_CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    TLS_KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
  fi
  render_nginx https
  activate_nginx
}

render_nginx() {
  local phase="$1"
  {
    printf '# Managed by Factura setup\n'
    cat <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
NGINX
    if [ "$TLS_MODE" = letsencrypt ]; then
      printf '    location ^~ /.well-known/acme-challenge/ { root %s; }\n' "$ACME_ROOT"
    fi
    if [ "$phase" = bootstrap ]; then
      printf '    location / { return 503; }\n}\n'
    else
      cat <<NGINX
    location / { return 301 https://$DOMAIN\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN;
    ssl_certificate $TLS_CERT;
    ssl_certificate_key $TLS_KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
NGINX
      nginx_location
      printf '}\n'
    fi
  } >"$WORK/nginx.conf"
}

activate_nginx() {
  install -m 0644 "$WORK/nginx.conf" "$NGINX_SITE"
  if [ ! -L "$NGINX_LINK" ]; then ln -s "$NGINX_SITE" "$NGINX_LINK"; fi
  local result
  result="$(nginx -t 2>&1)" || die "$result"
  if [[ "$result" == *"conflicting server name \"$DOMAIN\""* ]]; then die "$result"; fi
  systemctl enable --now nginx
  systemctl reload nginx
}

healthcheck() {
  local address="$1" version="$2" attempt
  for ((attempt=0; attempt<15; attempt++)); do
    if curl -fsS --max-time 5 "$address/api/trpc/ping" 2>/dev/null |
      config ping "$version" 2>/dev/null; then return; fi
    sleep 1
  done
  die "Проверка API не прошла: $address/api/trpc/ping"
}

verify_unlisted_login() {
  local id count code
  while true; do
    id="$(config test-id)"
    count="$(database_query "SELECT count(*) FROM adminAllowlist WHERE telegramId=$id")"
    if [ "$count" = 0 ]; then break; fi
  done
  code="$(printf '%s' "$TELEGRAM_BOT_TOKEN" | config test-login "$id" |
    curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
      -H "Origin: $PUBLIC_ORIGIN" -H 'Content-Type: application/json' \
      --data-binary @- "http://$HOST:$PORT/api/trpc/auth.telegram.verify")"
  [ "$code" = 403 ] || die "Проверка отказа во входе незарегистрированному Telegram ID: HTTP $code"
}

install_factura() {
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "Другая установка или обновление Factura уже выполняется"
  WORK="$(mktemp -d)"
  CLONE_TEMP=""
  BACKUP=""
  SNAPSHOT=false
  NGINX_TOUCHED=false
  SERVICE_TOUCHED=false
  WAS_ACTIVE=false
  WAS_ENABLED=false
  USED_MYSQL_SETUP_STATE=false
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  install_packages
  config origin "$PUBLIC_ORIGIN"
  check_telegram
  if ! "$RECONFIGURE"; then
    if [ "$RELEASE_REF" = latest ]; then
      RELEASE_REF="$(github_get "repos/$REPOSITORY/releases/latest" | config release)" ||
        die "Не удалось определить последний релиз. Проверьте PAT и наличие опубликованного релиза."
      log "Выбран релиз $RELEASE_REF"
    fi
    [[ "$RELEASE_REF" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "Недопустимый тег релиза"
  fi
  ensure_directories
  if "$RECONFIGURE"; then backup_existing; else clone_release; fi
  if ! app_git diff --quiet HEAD --; then die "В checkout есть незакоммиченные изменения."; fi
  if [ ! -f "$APP_DIR/app/db/bootstrap-admins.ts" ]; then
    die "Этот релиз ещё не поддерживает мастер. Выберите релиз, содержащий db:bootstrap-admins."
  fi
  prepare_database
  if ! "$RECONFIGURE"; then check_existing_owner; fi
  snapshot
  if systemctl is-active --quiet "$SERVICE"; then WAS_ACTIVE=true; fi
  if systemctl is-enabled --quiet "$SERVICE"; then WAS_ENABLED=true; fi

  log "Установка зависимостей и сборка"
  if ! "$RECONFIGURE" || [ ! -f "$APP_DIR/app/dist/boot.js" ] ||
    [ ! -x "$APP_DIR/app/node_modules/.bin/tsx" ]; then
    app_exec "$APP_DIR/app" npm ci --include=dev
    app_exec "$APP_DIR/admin" npm ci --include=dev
    app_exec "$APP_DIR/app" npm run build
  fi
  if "$WAS_ACTIVE"; then
    SERVICE_TOUCHED=true
    systemctl stop "$SERVICE"
  fi
  write_env
  app_exec "$APP_DIR/app" npm run db:migrate
  if "$SEED"; then app_exec "$APP_DIR/app" npm run seed; fi
  app_exec "$APP_DIR/app" npm run db:bootstrap-admins
  install_systemd
  install_updates
  SERVICE_TOUCHED=true
  systemctl start "$SERVICE"
  systemctl is-active --quiet "$SERVICE"
  local version
  version="$(tr -d '\r\n' <"$APP_DIR/VERSION")"
  healthcheck "http://$HOST:$PORT" "$version"
  verify_unlisted_login
  configure_nginx
  healthcheck "$PUBLIC_ORIGIN" "$version"
  systemctl enable "$SERVICE"
  if [ "${#ADMIN_IDS[@]}" -gt 0 ]; then
    app_exec "$APP_DIR/app" npm run db:bootstrap-admins -- "${ADMIN_IDS[@]}"
  fi
  if "$USED_MYSQL_SETUP_STATE"; then
    rm -f -- "$MYSQL_SETUP_STATE" || warn "Не удалось удалить временный файл $MYSQL_SETUP_STATE"
  fi
  log "Установка завершена. Админ-панель: $PUBLIC_ORIGIN/admin/"
  printf 'Сервис: systemctl status %s\nЖурнал: journalctl -u %s -f\n' "$SERVICE" "$SERVICE"
}

main() {
  probe_server
  select_installation
  select_paths
  select_release
  select_database
  select_web
  select_telegram
  plan
  if ! yes_no "Начать установку с этими параметрами и установить перечисленные пакеты?"; then
    log "Установка отменена."
    return
  fi
  install_factura
}

if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then main "$@"; fi
