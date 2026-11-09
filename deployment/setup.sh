#!/usr/bin/env bash
# Интерактивный мастер первоначальной настройки сервера Factura Shop (Ubuntu 22.04+/Debian 12+).
#
# Запуск (от root):
#   sudo bash deployment/setup.sh
#
# Что делает:
#   1. Проверяет ОС и спрашивает разрешение на установку компонентов
#      (git, curl, Node.js 22, build-essential, MySQL 8, nginx).
#   2. Создаёт системного пользователя, каталоги и клонирует репозиторий
#      по выбранному тегу в /opt/factura/current.
#   3. Интерактивно собирает app/.env (Telegram-токен, владелец, БД, секреты)
#      по образцу .env.example; APP_SECRET генерируется автоматически.
#   4. Устанавливает зависимости, собирает проект, применяет миграции.
#   5. Ставит systemd-сервис factura.service и выполняет healthcheck.
#   6. При включении автообновления ставит /usr/local/sbin/factura-update.sh
#      и ограниченную sudoers-запись для него.
set -euo pipefail

APP_USER="${APP_USER:-factura}"
APP_PARENT="${APP_PARENT:-/opt/factura}"
APP_DIR="${APP_PARENT}/current"
DATA_DIR="${DATA_DIR:-/var/lib/factura}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/factura}"
LOG_DIR="${LOG_DIR:-/var/log/factura}"
SERVICE_NAME="${SERVICE_NAME:-factura}"
UPDATE_SCRIPT="/usr/local/sbin/factura-update.sh"
REPO_DEFAULT="UnicornisIT/factura-home"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

ask() { # ask VAR "вопрос" [default]
  local __var="$1" prompt="$2" default="${3:-}" value
  if [ -n "$default" ]; then
    read -rp "$prompt [$default]: " value
    value="${value:-$default}"
  else
    value=""
    while [ -z "$value" ]; do
      read -rp "$prompt: " value
    done
  fi
  printf -v "$__var" '%s' "$value"
}

ask_secret() { # ask_secret VAR "вопрос" (ввод скрыт, допускает пустое значение)
  local __var="$1" prompt="$2" value
  read -rsp "$prompt (ввод скрыт): " value
  echo
  printf -v "$__var" '%s' "$value"
}

confirm() { # confirm "вопрос" — возвращает 0 при "y"
  local prompt="$1" answer
  read -rp "$prompt [y/N]: " answer
  [[ "$answer" =~ ^[Yy] ]]
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "Запустите скрипт от root: sudo bash deployment/setup.sh"
}

require_os() {
  . /etc/os-release
  case "${ID:-}" in
    ubuntu | debian) log "ОС: $PRETTY_NAME" ;;
    *) die "Поддерживаются Ubuntu/Debian; определена: ${ID:-неизвестно}" ;;
  esac
}

install_packages() {
  local missing=()
  for pkg in "$@"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    log "Уже установлены: $*"
    return 0
  fi
  if confirm "Установить компоненты: ${missing[*]}?"; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq "${missing[@]}"
  else
    die "Без пакетов ${missing[*]} установка невозможна"
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" = "22" ]; then
    log "Node.js 22 уже установлен: $(node -v)"
    return 0
  fi
  if confirm "Установить Node.js 22 (репозиторий NodeSource)?"; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
    log "Установлен Node.js $(node -v), npm $(npm -v)"
  else
    die "Node.js 22 обязателен (engines в app/package.json)"
  fi
}

install_mysql_server() {
  if command -v mysqld >/dev/null 2>&1; then
    log "MySQL-сервер уже установлен"
    return 0
  fi
  if confirm "Установить MySQL-сервер (mysql-server)?"; then
    apt-get install -y -qq mysql-server
    systemctl enable --now mysql
  else
    warn "MySQL-сервер не установлен: DATABASE_URL должен указывать на внешнюю БД"
  fi
}

install_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    log "nginx уже установлен"
    return 0
  fi
  if confirm "Установить nginx (reverse proxy)?"; then
    apt-get install -y -qq nginx
    cat >/etc/nginx/sites-available/factura <<EOF
# Пример конфигурации: TLS настройте отдельно (например, certbot).
server {
    listen 80;
    server_name _;
    client_max_body_size 6m;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header Origin \$http_origin;
        proxy_set_header Cookie \$http_cookie;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/factura /etc/nginx/sites-enabled/factura
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
    warn "Сгенерирован HTTP-vhost; до запуска добавьте TLS (PUBLIC_ORIGIN требует HTTPS)"
  else
    warn "nginx не установлен; настройте reverse proxy самостоятельно"
  fi
}

detect_latest_tag() {
  local tag=""
  tag=$(curl -fsSL ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
    "https://api.github.com/repos/$REPOSITORY/releases/latest" 2>/dev/null |
    sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1) || true
  printf '%s' "$tag"
}

clone_release() {
  local ref="$1" auth_header=()
  if [ -n "$GITHUB_TOKEN" ]; then
    auth_header=(-c "http.extraHeader=Authorization: Bearer $GITHUB_TOKEN")
  fi
  if [ -d "$APP_DIR/.git" ]; then
    log "Каталог $APP_DIR уже содержит git-репозиторий, переключаю на $ref"
    git -C "$APP_DIR" "${auth_header[@]}" fetch --tags --force origin
  else
    rm -rf "$APP_DIR"
    git "${auth_header[@]}" clone --branch "$ref" \
      "https://github.com/$REPOSITORY.git" "$APP_DIR"
    # Токен не должен оставаться в .git/config: origin без учётных данных.
    git -C "$APP_DIR" remote set-url origin "https://github.com/$REPOSITORY.git"
  fi
  git -C "$APP_DIR" checkout -f "$ref"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
}

create_mysql_db() { # create_mysql_db db user pass
  mysql --defaults-extra-file=<(printf '[client]\nuser=root\n') <<SQL
CREATE DATABASE IF NOT EXISTS \`$1\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$2'@'localhost' IDENTIFIED BY '$3';
GRANT ALL PRIVILEGES ON \`$1\`.* TO '$2'@'localhost';
FLUSH PRIVILEGES;
SQL
}

write_env_file() {
  local env_file="$APP_DIR/app/.env"
  umask 027
  cat >"$env_file" <<EOF
NODE_ENV=production
DB_DIALECT=$DB_DIALECT
$DB_LINE
APP_SECRET=$APP_SECRET
PUBLIC_ORIGIN=$PUBLIC_ORIGIN
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_NAME=$TELEGRAM_BOT_NAME
SUPER_ADMIN_TELEGRAM_ID=$SUPER_ADMIN_TELEGRAM_ID
UPLOAD_DIR=$UPLOAD_DIR
PORT=$PORT
HOST=$HOST
SERVER_UPDATE_ENABLED=$SERVER_UPDATE_ENABLED
SERVER_UPDATE_REPOSITORY=$REPOSITORY
SERVER_UPDATE_TOKEN=$GITHUB_TOKEN
SERVER_UPDATE_SCRIPT=$UPDATE_SCRIPT
SERVER_UPDATE_STATUS_PATH=$DATA_DIR/update-status.json
EOF
  chmod 640 "$env_file"
  chown "root:$APP_USER" "$env_file"
  log "Записан $env_file (640 root:$APP_USER)"
}

install_service() {
  # В ReadWritePaths, кроме данных и логов, входят каталоги скрипта обновления
  # и юнита: без них install_deployment_files получит EROFS под ProtectSystem=full.
  sed -e "s|@APP_DIR@|$APP_DIR|g" \
    -e "s|@APP_USER@|$APP_USER|g" \
    -e "s|@RW_PATHS@|$DATA_DIR $LOG_DIR $(dirname "$UPDATE_SCRIPT") /etc/systemd/system|g" \
    "$APP_DIR/deployment/factura.service" >/etc/systemd/system/$SERVICE_NAME.service
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  log "Сервис $SERVICE_NAME запущен"
}

healthcheck() {
  local url="http://${HOST}:${PORT}/api/trpc/ping" i
  for i in $(seq 1 30); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "Healthcheck OK: $url"
      return 0
    fi
    sleep 1
  done
  warn "Healthcheck не прошёл за 30 секунд: journalctl -u $SERVICE_NAME"
  return 1
}

install_updater() {
  install -o root -g root -m 755 "$APP_DIR/deployment/factura-update.sh" "$UPDATE_SCRIPT"
  sed -e "s/^factura /$APP_USER /" -e "s|@UPDATE_SCRIPT@|$UPDATE_SCRIPT|" \
    "$APP_DIR/deployment/sudoers-factura-update" >/etc/sudoers.d/$SERVICE_NAME-update
  chmod 440 /etc/sudoers.d/$SERVICE_NAME-update
  visudo -cf /etc/sudoers.d/$SERVICE_NAME-update || {
    rm -f /etc/sudoers.d/$SERVICE_NAME-update
    die "sudoers-файл не прошёл проверку, автообновление не установлено"
  }
  log "Установлены $UPDATE_SCRIPT и /etc/sudoers.d/$SERVICE_NAME-update"
}

main() {
  require_root
  require_os

  log "Шаг 1/7. Базовые компоненты"
  install_packages git curl ca-certificates sudo

  log "Шаг 2/7. Репозиторий и версия"
  ask REPOSITORY "GitHub-репозиторий (owner/name)" "$REPO_DEFAULT"
  if git ls-remote "https://github.com/$REPOSITORY.git" HEAD >/dev/null 2>&1; then
    GITHUB_TOKEN=""
  else
    warn "Репозиторий приватный или недоступен: потребуется токен (fine-grained PAT,"
    warn "права Contents: Read-only и Metadata: Read-only на $REPOSITORY)"
    ask_secret GITHUB_TOKEN "GitHub-токен для чтения релизов и кода"
    [ -n "$GITHUB_TOKEN" ] || die "Без токена приватный репозиторий недоступен"
  fi
  LATEST_TAG="$(detect_latest_tag)"
  ask RELEASE_REF "Тег/ветка для установки" "${LATEST_TAG:-main}"

  log "Шаг 3/7. База данных"
  ask DB_DIALECT "Диалект БД (mysql или sqlite)" "mysql"
  [[ "$DB_DIALECT" =~ ^(mysql|sqlite)$ ]] || die "DB_DIALECT должен быть mysql или sqlite"
  DB_LINE=""
  if [ "$DB_DIALECT" = mysql ]; then
    install_packages mysql-client
    install_mysql_server
    ask DB_NAME "Имя базы данных" "factura"
    ask DB_USER "Пользователь БД" "factura"
    ask_secret DB_PASS "Пароль пользователя БД"
    [ -n "$DB_PASS" ] || die "Пустой пароль БД недопустим"
    if command -v mysqld >/dev/null 2>&1 && confirm "Создать базу $DB_NAME и пользователя $DB_USER локально?"; then
      create_mysql_db "$DB_NAME" "$DB_USER" "$DB_PASS"
    fi
    DB_LINE="DATABASE_URL=mysql://$DB_USER:$DB_PASS@127.0.0.1:3306/$DB_NAME"
  else
    DB_LINE="SQLITE_PATH=$DATA_DIR/factura.db"
  fi

  log "Шаг 4/7. Параметры приложения"
  ask PUBLIC_ORIGIN "Публичный HTTPS-origin магазина (без / на конце)"
  [[ "$PUBLIC_ORIGIN" =~ ^https://[^/[:space:]]+$ ]] || die "PUBLIC_ORIGIN должен быть вида https://domain"
  ask TELEGRAM_BOT_NAME "Username Telegram-бота (без @)"
  ask_secret TELEGRAM_BOT_TOKEN "Токен Telegram-бота (от @BotFather)"
  [ -n "$TELEGRAM_BOT_TOKEN" ] || die "TELEGRAM_BOT_TOKEN обязателен в production"
  ask SUPER_ADMIN_TELEGRAM_ID "Telegram ID владельца (super_admin)"
  [[ "$SUPER_ADMIN_TELEGRAM_ID" =~ ^[1-9][0-9]*$ ]] || die "SUPER_ADMIN_TELEGRAM_ID — положительное целое число"
  ask PORT "Порт API" "3000"
  HOST="127.0.0.1"
  UPLOAD_DIR="$DATA_DIR/uploads"
  APP_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("hex"))' 2>/dev/null ||
    openssl rand -hex 48)"
  log "APP_SECRET сгенерирован автоматически"

  SERVER_UPDATE_ENABLED=false
  if [ -n "$GITHUB_TOKEN" ] && confirm "Включить обновление до последнего релиза из админ-панели?"; then
    SERVER_UPDATE_ENABLED=true
  fi

  log "Шаг 5/7. Пользователь, каталоги и код"
  id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_PARENT" --shell /usr/sbin/nologin "$APP_USER"
  mkdir -p "$APP_PARENT" "$DATA_DIR/uploads" "$BACKUP_DIR" "$LOG_DIR" /run/lock
  chown -R "$APP_USER:$APP_USER" "$DATA_DIR" "$LOG_DIR"
  clone_release "$RELEASE_REF"

  log "Шаг 6/7. Конфигурация, сборка и миграции"
  write_env_file
  # shellcheck disable=SC1090
  set -a; . "$APP_DIR/app/.env"; set +a
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR/app' && npm ci"
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR/admin' && npm ci"
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR/app' && npm run build"
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR/app' && npm run db:migrate"
  if confirm "Заполнить пустой магазин демонстрационными данными (npm run seed)?"; then
    sudo -u "$APP_USER" bash -c "cd '$APP_DIR/app' && npm run seed"
  fi

  log "Шаг 7/7. Сервис и автообновление"
  install_service
  if [ "$SERVER_UPDATE_ENABLED" = true ]; then
    install_updater
  fi
  install_nginx
  healthcheck || true

  echo
  log "Готово. Сводка:"
  echo "  Каталог:      $APP_DIR (тег/ветка: $RELEASE_REF)"
  echo "  Конфигурация: $APP_DIR/app/.env"
  echo "  Изображения:  $UPLOAD_DIR"
  echo "  Сервис:       systemctl status $SERVICE_NAME"
  if [ "$SERVER_UPDATE_ENABLED" = true ]; then
    echo "  Обновление:   админ-панель → «Обновление сервера» (super_admin)"
    echo "                скрипт $UPDATE_SCRIPT, журнал $LOG_DIR/update.log"
  else
    echo "  Обновление:   выключено (SERVER_UPDATE_ENABLED=false)"
  fi
  echo "  Логи:         journalctl -u $SERVICE_NAME -f"
}

main "$@"
