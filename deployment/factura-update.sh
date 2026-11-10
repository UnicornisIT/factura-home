#!/usr/bin/env bash
# Обновление Factura Shop до последнего GitHub-релиза.
#
# Запускается от root (через sudoers-запись) по кнопке «Обновить» в админ-панели
# или вручную: sudo /usr/local/sbin/factura-update.sh
#
# Поток: при запуске из cgroup веб-сервиса — перенос себя в transient unit
# systemd (блокировка flock освобождается до передачи, чтобы дочерний процесс
# не спорил за неё с ещё живым родителем; обновление не зависит от рестарта
# сервиса и пишет root-файлы вне mount namespace сервиса) -> блокировка (flock)
# -> стадии: проверка окружения, доступ к GitHub, информация о релизе
# (+ скачивание архива тега), резервные копии (БД через SQLite Backup API с
# integrity_check, изображения, .env, метаданные, скрипт/unit/sudoers),
# git fetch/checkout тега, npm ci, сборка, db:migrate, переустановка
# deployment-файлов, restart, healthcheck.
# При сбое код, скрипт обновления, юнит и sudoers откатываются на предыдущие,
# сервис перезапускается и работоспособность отката подтверждается healthcheck;
# БД не откатывается (миграции могут быть необратимы).
#
# Границы доверия:
#   - git выполняется от имени владельца репозитория: нет «dubious ownership»,
#     SSH deploy key берётся из core.sshCommand в конфигурации репозитория;
#   - app/.env разбирается как данные и НЕ исполняется (файл может быть доступен
#     на запись пользователю приложения);
#   - скрипт обновления, юнит и sudoers устанавливаются из архива проверенного
#     тега, скачанного root'ом с GitHub, — не из рабочего дерева приложения;
#   - sudoers не пробрасывает окружение вызывающего: корень установки
#     определяется автоматически либо из root-конфига /etc/factura/update.env;
#   - GITHUB_TOKEN не попадает в аргументы процессов (curl --config, git
#     credential-файл 600), в журнал и в статус.
#
# Окружение (только для root-контекстов: sudo его вырезает):
#   FACTURA_APP_DIR        корень установки (иначе /opt/factura/current или /opt/factura)
#   FACTURA_SERVICE        имя сервиса (по умолчанию factura)
#   FACTURA_BACKUP_DIR     каталог резервных копий (/var/backups/factura)
#   FACTURA_UPDATE_LOG     журнал (/var/log/factura/update.log)
#   FACTURA_LOCK_FILE      файл блокировки (/run/lock/factura-update.lock)
# Ошибки фиксируются в статусе SERVER_UPDATE_STATUS_PATH (JSON, атомарно),
# включая предварительные проверки, — панель всегда видит реальную причину.
set -euo pipefail

if [ "$(id -u)" -ne 0 ] && [ "${FACTURA_ALLOW_NONROOT:-0}" != "1" ]; then
  echo "Требуется root" >&2
  exit 1
fi

# Опциональный root-конфиг механизма обновления (нестандартная раскладка).
# Исполняется только файл, принадлежащий root: непривилегированный пользователь
# не может подсунуть свой FACTURA_APP_DIR ни здесь, ни через окружение (sudo
# его вырезает, env_keep в sudoers-записи отсутствует).
if [ -f /etc/factura/update.env ] && [ "$(stat -c %u /etc/factura/update.env 2>/dev/null)" = "0" ]; then
  # shellcheck disable=SC1091
  . /etc/factura/update.env
fi

# --- Ранняя диагностика: статус и журнал создаются до проверки путей ---
STATUS_PATH="${SERVER_UPDATE_STATUS_PATH:-/var/lib/factura/update-status.json}"
LOG_FILE="${FACTURA_UPDATE_LOG:-/var/log/factura/update.log}"
LOCK_FILE="${FACTURA_LOCK_FILE:-/run/lock/factura-update.lock}"

detect_app_dir() {
  local candidate
  if [ -n "${FACTURA_APP_DIR:-}" ]; then
    printf '%s' "$FACTURA_APP_DIR"
    return 0
  fi
  for candidate in /opt/factura/current /opt/factura; do
    if [ -f "$candidate/app/.env" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

APP_DIR="$(detect_app_dir || true)"
BOOT_ERROR=""
if [ -z "$APP_DIR" ]; then
  BOOT_ERROR="Каталог установки не найден: существует /opt/factura/current или /opt/factura с app/.env (нестандартная раскладка задаётся в /etc/factura/update.env)"
elif [ ! -f "$APP_DIR/app/.env" ]; then
  BOOT_ERROR="Конфигурация $APP_DIR/app/.env не найдена"
fi

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$STATUS_PATH")" "$(dirname "$LOCK_FILE")" 2>/dev/null || true
exec >>"$LOG_FILE" 2>&1

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -Is) Обновление уже выполняется, выход"
  exit 1
fi

OPERATION_ID="$(date +%Y%m%d%H%M%S)-$$"
STARTED_AT="$(date -Is)"
SERVICE="${FACTURA_SERVICE:-factura}"
# Статус должен читать процесс сервиса: владелец файла — User= из юнита,
# при недоступности — владелец каталога данных.
SERVICE_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
STATUS_USER="${SERVICE_USER:-$(stat -c %U "$(dirname "$STATUS_PATH")" 2>/dev/null || true)}"

STAGE=""
DONE=0
TARGET_TAG=""
CURRENT_REF=""
DEST=""
APP_USER=""
CRED_FILE=""
API_CFG=""
TRUSTED_DIR=""
DEPLOY_SRC=""

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r\t'; }

write_status() { # write_status state tag message finished
  local tmp
  tmp="$(mktemp "$(dirname "$STATUS_PATH")/.status.XXXXXX")"
  printf '{"state":"%s","tag":%s,"stage":%s,"operationId":"%s","startedAt":"%s","finishedAt":%s,"message":%s}\n' \
    "$1" \
    "$( [ -n "${2:-}" ] && printf '"%s"' "$(json_escape "$2")" || printf 'null' )" \
    "$( [ -n "$STAGE" ] && printf '"%s"' "$(json_escape "$STAGE")" || printf 'null' )" \
    "$OPERATION_ID" \
    "$STARTED_AT" \
    "$( [ "${4:-false}" = true ] && printf '"%s"' "$(date -Is)" || printf 'null' )" \
    "$( [ -n "${3:-}" ] && printf '"%s"' "$(json_escape "$3")" || printf 'null' )" >"$tmp"
  if [ -n "$STATUS_USER" ]; then
    chown "$STATUS_USER:$STATUS_USER" "$tmp" 2>/dev/null || true
  fi
  chmod 640 "$tmp" 2>/dev/null || chmod 644 "$tmp"
  mv -f "$tmp" "$STATUS_PATH"
}

cleanup() { # временные файлы, включая содержащие секреты
  [ -n "$CRED_FILE" ] && rm -f "$CRED_FILE"
  [ -n "$API_CFG" ] && rm -f "$API_CFG"
  [ -n "$TRUSTED_DIR" ] && rm -rf "$TRUSTED_DIR"
  return 0
}

finish_failed() { # finish_failed message [rollback:true]
  local message="$1"
  echo "$(date -Is) [$OPERATION_ID] ОШИБКА: $message"
  if [ "${2:-false}" = true ] && [ -n "$CURRENT_REF" ] && [ -n "$APP_USER" ]; then
    echo "$(date -Is) [$OPERATION_ID] откат кода на $CURRENT_REF"
    if git_run checkout -f "$CURRENT_REF" &&
      run_as_app "npm ci" && run_as_app "npm run build"; then
      restore_deployment_files
      # Откат подтверждается healthcheck: «восстановлено» без проверки сервиса
      # недостоверно. БД не откатывается — миграции могут быть необратимы.
      if systemctl restart "$SERVICE" && healthcheck; then
        echo "$(date -Is) [$OPERATION_ID] откат завершён, сервис работоспособен (БД не откатывается)"
        message="$message; код откачен на $CURRENT_REF, сервис работоспособен, БД не откатывалась"
      else
        echo "$(date -Is) [$OPERATION_ID] ОТКАТ НЕПОЛНЫЙ: код возвращён, но сервис не поднялся — требуется ручное вмешательство"
        message="$message; код откачен на $CURRENT_REF, но сервис не поднялся (healthcheck) — требуется ручное вмешательство; БД не откатывалась"
      fi
    else
      echo "$(date -Is) [$OPERATION_ID] ОТКАТ НЕ УДАЛСЯ — требуется ручное вмешательство"
      message="$message; rollback failed"
    fi
  fi
  DONE=1
  write_status failed "${TARGET_TAG:-$CURRENT_REF}" "$message" true
  exit 1
}

# Незапланированный выход (set -e, сигнал) не должен оставлять вечный "running".
trap 'cleanup; if [ "$DONE" != 1 ]; then DONE=1; write_status failed "${TARGET_TAG:-$CURRENT_REF}" "обновление прервано неожиданно" true 2>/dev/null || true; fi' EXIT
trap 'finish_failed "обновление прервано сигналом" false' TERM INT

set_stage() {
  STAGE="$1"
  echo "$(date -Is) [$OPERATION_ID] этап: $STAGE"
  write_status running "${TARGET_TAG:-$CURRENT_REF}" "" false
}

if [ -n "$BOOT_ERROR" ]; then
  finish_failed "$BOOT_ERROR" false
fi

# --- Конфигурация из app/.env: разбор как данных, без исполнения файла ---
ENV_FILE="$APP_DIR/app/.env"
read_env() { # read_env KEY — последнее значение KEY= из app/.env
  local line
  line="$(sed -n "s|^${1}=||p" "$ENV_FILE" | tail -n 1)"
  case "$line" in
    '"'*'"') line="${line:1:${#line}-2}" ;;
    "'"*"'") line="${line:1:${#line}-2}" ;;
  esac
  printf '%s' "$line"
}

__v="$(read_env SERVER_UPDATE_REPOSITORY)"
REPOSITORY="${__v:-UnicornisIT/factura-home}"
TOKEN="$(read_env GITHUB_TOKEN)"
__v="$(read_env SERVER_UPDATE_STATUS_PATH)"
STATUS_PATH="${__v:-$STATUS_PATH}"
__v="$(read_env SERVER_UPDATE_SCRIPT)"
UPDATE_SELF="${__v:-${SERVER_UPDATE_SCRIPT:-/usr/local/sbin/factura-update.sh}}"
DB_DIALECT="$(read_env DB_DIALECT)"
DB_DIALECT="${DB_DIALECT:-mysql}"
SQLITE_PATH="$(read_env SQLITE_PATH)"
DATABASE_URL="$(read_env DATABASE_URL)"
HOST="$(read_env HOST)"
HOST="${HOST:-127.0.0.1}"
PORT="$(read_env PORT)"
PORT="${PORT:-3000}"
BACKUP_DIR="${FACTURA_BACKUP_DIR:-/var/backups/factura}"
UNIT_FILE="${FACTURA_UNIT_FILE:-/etc/systemd/system/$SERVICE.service}"
SUDOERS_FILE="${FACTURA_SUDOERS_FILE:-/etc/sudoers.d/$SERVICE-update}"
DATA_DIR="${FACTURA_DATA_DIR:-/var/lib/factura}"
UPLOADS_DIR="$(read_env UPLOAD_DIR)"
UPLOADS_DIR="${UPLOADS_DIR:-$DATA_DIR/uploads}"
[[ "$UPLOADS_DIR" != /* ]] && UPLOADS_DIR="$APP_DIR/app/$UPLOADS_DIR"
HEALTHCHECK_URL="http://$HOST:$PORT/api/trpc/ping"
HEALTHCHECK_TRIES="${FACTURA_HEALTHCHECK_TRIES:-30}"
APP_USER="$(stat -c %U "$APP_DIR")"

case "$UPDATE_SELF" in
  /*) ;;
  *) finish_failed "SERVER_UPDATE_SCRIPT должен быть абсолютным путём: ${UPDATE_SELF:-<пусто>}" false ;;
esac
case "$STATUS_PATH" in
  /*) ;;
  *) finish_failed "SERVER_UPDATE_STATUS_PATH должен быть абсолютным путём: $STATUS_PATH" false ;;
esac

run_in() { # run_in <каталог> "<команда>" — от имени владельца приложения
  if [ "$(id -u)" -eq 0 ]; then
    sudo -u "$APP_USER" bash -c "cd '$1' && $2"
  else
    bash -c "cd '$1' && $2"
  fi
}
run_as_app() { run_in "$APP_DIR/app" "$1"; }

# HTTPS-учётные данные git во временном файле (600, владелец — пользователь
# репозитория): значение токена не видно в аргументах процессов (ps).
if [ -n "$TOKEN" ]; then
  CRED_FILE="$(mktemp)"
  printf 'https://x-access-token:%s@github.com\n' "$TOKEN" >"$CRED_FILE"
  chmod 600 "$CRED_FILE"
  chown "$APP_USER" "$CRED_FILE" 2>/dev/null || true
fi

git_run() { # Git от имени владельца репозитория (без dubious ownership)
  local -a creds=()
  if [ -n "$CRED_FILE" ]; then
    creds=(-c "credential.helper=store --file=$CRED_FILE")
  fi
  if [ "$(id -u)" -eq 0 ]; then
    sudo -u "$APP_USER" git -C "$APP_DIR" "${creds[@]}" "$@"
  else
    git -C "$APP_DIR" "${creds[@]}" "$@"
  fi
}

# Обновление не должно зависеть от жизненного цикла веб-приложения: при запуске
# из cgroup сервиса переносим себя в transient unit. Он работает вне mount
# namespace сервиса (ProtectSystem не мешает писать root-файлы), а рестарт
# factura.service его не затрагивает. KillMode=process в юните — второй рубеж.
#
# Блокировка освобождается ДО systemd-run: transient-процесс стартует, пока
# родитель ещё жив, и не должен обнаружить flock занятым (гонка передачи).
# Повторное имя --unit=factura-update отклоняет второй параллельный запуск, а
# fallback-ветвь повторно берёт блокировку и при занятости молча выходит —
# статусом владеет уже выполняющееся обновление.
# FACTURA_UPDATE_FORCE_DETACH — тестовый крючок для среды без cgroup сервиса;
# через sudo переменная не передаётся (env_keep отсутствует), выставить её
# может только root.
if [ "${FACTURA_UPDATE_DETACHED:-0}" != "1" ] &&
  { [ "${FACTURA_UPDATE_FORCE_DETACH:-0}" = "1" ] ||
    grep -q "$SERVICE.service" /proc/self/cgroup 2>/dev/null; } &&
  command -v systemd-run >/dev/null 2>&1; then
  exec 9>&-
  echo "$(date -Is) [$OPERATION_ID] запуск в transient unit factura-update"
  if systemd-run --quiet --collect --unit=factura-update \
    --setenv=FACTURA_UPDATE_DETACHED=1 \
    --setenv=FACTURA_APP_DIR="$APP_DIR" \
    --setenv=FACTURA_SERVICE="$SERVICE" \
    "$UPDATE_SELF"; then
    DONE=1
    exit 0
  fi
  echo "$(date -Is) [$OPERATION_ID] предупреждение: systemd-run не сработал, продолжаю в cgroup сервиса"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "$(date -Is) [$OPERATION_ID] блокировка занята другим обновлением, выход"
    DONE=1
    exit 1
  fi
fi

install_deployment_files() { # переустановка скрипта, юнита и sudoers
  # Источник — архив тега, скачанный с GitHub (DEPLOY_SRC, root-owned), а не
  # рабочее дерево приложения: дерево принадлежит пользователю сервиса и
  # доверенным источником не является.
  local src="$DEPLOY_SRC"
  if [ ! -d "$src" ]; then
    echo "$(date -Is) [$OPERATION_ID] в архиве релиза нет deployment/ — файлы деплоя оставлены прежними"
    return 0
  fi
  if [ -f "$src/factura-update.sh" ]; then
    cp -f "$UPDATE_SELF" "$DEST/factura-update.sh.prev" 2>/dev/null || true
    # install заменяет файл атомарно через rename: уже запущенный процесс
    # продолжает выполняться из старого inode.
    if [ "$(id -u)" -eq 0 ]; then
      install -o root -g root -m 755 "$src/factura-update.sh" "$UPDATE_SELF"
    else
      install -m 755 "$src/factura-update.sh" "$UPDATE_SELF"
    fi
  fi
  if [ -f "$src/factura.service" ]; then
    # Временный файл создаётся в каталоге юнитов: с суффиксом .service
    # (systemd-analyze verify не принимает файлы без unit-суффикса), с ведущей
    # точкой (systemd игнорирует dot-файлы до переименования) и в той же ФС —
    # переименование атомарно.
    local tmp
    tmp="$(mktemp "$(dirname "$UNIT_FILE")/.$SERVICE-XXXXXX.service")" || return 1
    # ReadWritePaths сервиса ограничен данными и логами: каталоги root-скрипта
    # и юнитов намеренно НЕ входят — их пишет transient unit от root.
    sed -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@APP_USER@|$APP_USER|g" \
      -e "s|@RW_PATHS@|$DATA_DIR $(dirname "$LOG_FILE")|g" \
      "$src/factura.service" >"$tmp"
    if command -v systemd-analyze >/dev/null 2>&1 &&
      ! systemd-analyze verify "$tmp" >>"$LOG_FILE" 2>&1; then
      rm -f "$tmp"
      echo "$(date -Is) [$OPERATION_ID] шаблон юнита не прошёл systemd-analyze verify, юнит не заменён"
      return 1
    fi
    [ -f "$UNIT_FILE" ] && cp -f "$UNIT_FILE" "$DEST/factura.service.prev"
    chmod 644 "$tmp"
    if [ "$(id -u)" -eq 0 ]; then chown root:root "$tmp"; fi
    mv -f "$tmp" "$UNIT_FILE"
    systemctl daemon-reload
  fi
  if [ -f "$src/sudoers-factura-update" ] && [ -f "$SUDOERS_FILE" ]; then
    local stmp
    stmp="$(mktemp "$(dirname "$SUDOERS_FILE")/.sudoers-XXXXXX")" || return 1
    sed -e "s/^factura /$APP_USER /" -e "s|@UPDATE_SCRIPT@|$UPDATE_SELF|" \
      "$src/sudoers-factura-update" >"$stmp"
    chmod 440 "$stmp"
    if command -v visudo >/dev/null 2>&1 && ! visudo -cf "$stmp" >/dev/null 2>&1; then
      rm -f "$stmp"
      echo "$(date -Is) [$OPERATION_ID] шаблон sudoers не прошёл проверку visudo, sudoers не заменён"
      return 1
    fi
    cp -f "$SUDOERS_FILE" "$DEST/sudoers.prev" 2>/dev/null || true
    if [ "$(id -u)" -eq 0 ]; then chown root:root "$stmp"; fi
    mv -f "$stmp" "$SUDOERS_FILE"
  fi
  return 0
}

restore_deployment_files() { # возврат deployment-файлов из резервной копии
  if [ -n "$DEST" ]; then
    if [ -f "$DEST/factura-update.sh.prev" ]; then
      if [ "$(id -u)" -eq 0 ]; then
        install -o root -g root -m 755 "$DEST/factura-update.sh.prev" "$UPDATE_SELF"
      else
        install -m 755 "$DEST/factura-update.sh.prev" "$UPDATE_SELF"
      fi
    fi
    if [ -f "$DEST/factura.service.prev" ]; then
      cp -f "$DEST/factura.service.prev" "$UNIT_FILE"
      systemctl daemon-reload
    fi
    [ -f "$DEST/sudoers.prev" ] && cp -f "$DEST/sudoers.prev" "$SUDOERS_FILE"
  fi
  return 0
}

sqlite_backup() { # sqlite_backup src dest — SQLite Backup API + integrity_check
  # Простое cp для WAL-базы при активной записи недопустимо: копия может
  # оказаться несогласованной. Используется .backup (sqlite3 CLI) или Backup
  # API better-sqlite3, целостность копии проверяется integrity_check.
  # Выполняется от имени пользователя приложения: файлы -wal/-shm остаются
  # в его владении и сервис не теряет доступ к базе.
  local src="$1" dest="$2" out helper rc=0
  if command -v sqlite3 >/dev/null 2>&1; then
    out="$(run_in / "sqlite3 '$src' \".backup '$dest'\" && sqlite3 '$dest' 'PRAGMA integrity_check;' | head -n 1")" || return 1
    if [ "$out" != "ok" ]; then
      echo "$(date -Is) [$OPERATION_ID] копия SQLite не прошла integrity_check: ${out:-<пусто>}"
      return 1
    fi
    return 0
  fi
  # sqlite3 CLI отсутствует: Backup API через better-sqlite3 (зависимость приложения).
  helper="${TMPDIR:-/tmp}/factura-sqlite-backup-$$.js"
  cat >"$helper" <<'NODE'
const Database = require("better-sqlite3");
const [src, dest] = process.argv.slice(2);
const db = new Database(src, { readonly: true, fileMustExist: true });
db.backup(dest)
  .then(() => db.close())
  .then(() => {
    const check = new Database(dest, { readonly: true });
    const row = check.pragma("integrity_check", { simple: true });
    check.close();
    if (row !== "ok") throw new Error("integrity_check: " + row);
  })
  .catch(error => {
    process.stderr.write(String(error) + "\n");
    process.exit(1);
  });
NODE
  chmod 644 "$helper" 2>/dev/null || true
  chown "$APP_USER" "$helper" 2>/dev/null || true
  run_in "$APP_DIR/app" "node '$helper' '$src' '$dest'" || rc=1
  rm -f "$helper"
  return $rc
}

backup_database() { # backup_database dest_dir
  local dest="$1"
  if [ "$DB_DIALECT" = sqlite ]; then
    local db="${SQLITE_PATH:-$APP_DIR/app/dev.db}"
    [[ "$db" != /* ]] && db="$APP_DIR/app/$db"
    # Каталог резервной копии root-only (700): файл создаётся заранее и
    # передаётся пользователю приложения, чтобы backup писал именно он.
    if [ "$(id -u)" -eq 0 ]; then
      install -o "$APP_USER" -g "$APP_USER" -m 600 /dev/null "$dest/db.sqlite" || return 1
    else
      install -m 600 /dev/null "$dest/db.sqlite" || return 1
    fi
    sqlite_backup "$db" "$dest/db.sqlite" || return 1
    chown root:root "$dest/db.sqlite" 2>/dev/null || true
    chmod 600 "$dest/db.sqlite"
  else
    local url="$DATABASE_URL"
    [[ "$url" =~ ^mysql://([^:]+):([^@]*)@([^:/]+)(:([0-9]+))?/(.+)$ ]] || {
      echo "Не удалось разобрать DATABASE_URL"; return 1; }
    local user="${BASH_REMATCH[1]}" pass="${BASH_REMATCH[2]}" host="${BASH_REMATCH[3]}"
    local port="${BASH_REMATCH[5]:-3306}" db="${BASH_REMATCH[6]}"
    local cnf
    cnf="$(mktemp)"
    chmod 600 "$cnf"
    printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$user" "$pass" "$host" "$port" >"$cnf"
    # --defaults-extra-file: пароль БД не попадает в аргументы процесса.
    mysqldump --defaults-extra-file="$cnf" --single-transaction \
      --default-character-set=utf8mb4 "$db" >"$dest/db.sql"
    local rc=$?
    rm -f "$cnf"
    [ $rc -eq 0 ] || return 1
  fi
  cp "$ENV_FILE" "$dest/env.backup"
  cp "$UNIT_FILE" "$dest/service.backup" 2>/dev/null || true
  chmod 600 "$dest/env.backup" 2>/dev/null || true
}

healthcheck() {
  local _
  for _ in $(seq 1 "$HEALTHCHECK_TRIES"); do
    if curl -fsS "$HEALTHCHECK_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

set_stage "проверка окружения"
[[ "$REPOSITORY" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] ||
  finish_failed "SERVER_UPDATE_REPOSITORY имеет недопустимый формат: $REPOSITORY" false
CURRENT_REF="$(git_run describe --tags --exact-match 2>/dev/null || git_run rev-parse --short HEAD)" ||
  finish_failed "не удалось определить текущую версию (git в $APP_DIR)" false
DIRTY="$(git_run status --porcelain --untracked-files=no)" ||
  finish_failed "git status не удался" false
if [ -n "$DIRTY" ]; then
  DIRTY_FILES="$(printf '%s\n' "$DIRTY" | head -n 5 | awk '{print $2}' | paste -sd', ' -)"
  finish_failed "В репозитории есть незакоммиченные изменения ($DIRTY_FILES). Обновление прервано, файлы не тронуты. Закоммитьте или откатите изменения в $APP_DIR; правки исходников в production не поддерживаются" false
fi
echo "$(date -Is) [$OPERATION_ID] начало, текущая версия: $CURRENT_REF"

set_stage "проверка доступа к GitHub"
REMOTE_URL="$(git_run remote get-url origin)" ||
  finish_failed "git remote origin не настроен в $APP_DIR" false
case "$REMOTE_URL" in
  *"$REPOSITORY" | *"$REPOSITORY.git") ;;
  *) finish_failed "origin ($REMOTE_URL) не соответствует SERVER_UPDATE_REPOSITORY ($REPOSITORY): источник обновления недостоверен" false ;;
esac
git_sanitize() { # хвост stderr git без строк, похожих на секреты
  printf '%s' "$1" | grep -viE 'token|password|authorization' | tail -n 3 | tr '\n' ' '
}
if ! LSREMOTE_OUT="$(git_run ls-remote --exit origin HEAD 2>&1)"; then
  LSREMOTE_TAIL="$(git_sanitize "$LSREMOTE_OUT")"
  case "$REMOTE_URL" in
    git@* | ssh://*)
      finish_failed "Нет доступа к GitHub по SSH ($REMOTE_URL): проверьте deploy key и core.sshCommand в конфигурации репозитория для пользователя $APP_USER${LSREMOTE_TAIL:+; }${LSREMOTE_TAIL}" false ;;
    *)
      finish_failed "Нет доступа к GitHub по HTTPS: проверьте GITHUB_TOKEN в $ENV_FILE${LSREMOTE_TAIL:+; }${LSREMOTE_TAIL}" false ;;
  esac
fi

set_stage "загрузка информации о релизе"
API_BODY="$(mktemp)"
CURL_AUTH=()
if [ -n "$TOKEN" ]; then
  # Заголовок авторизации во временном файле (600): токен не виден в аргументах curl.
  API_CFG="$(mktemp)"
  chmod 600 "$API_CFG"
  printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" >"$API_CFG"
  CURL_AUTH=(--config "$API_CFG")
fi
API_CODE="$(curl -sS -o "$API_BODY" -w '%{http_code}' "${CURL_AUTH[@]}" \
  -H "Accept: application/vnd.github+json" \
  -H "User-Agent: factura-updater" \
  "https://api.github.com/repos/$REPOSITORY/releases/latest" 2>/dev/null)" || API_CODE="000"
case "$API_CODE" in
  200) RESPONSE="$(cat "$API_BODY")" ;;
  401) finish_failed "GitHub API ответил 401: GITHUB_TOKEN недействителен или отозван" false ;;
  403 | 429) finish_failed "GitHub API ответил $API_CODE: недостаточно прав у токена или превышен лимит запросов" false ;;
  404) finish_failed "GitHub API ответил 404: репозиторий $REPOSITORY или его релизы не найдены (для приватного репозитория нужен GITHUB_TOKEN)" false ;;
  000) finish_failed "GitHub API недоступен (сетевая ошибка)" false ;;
  *) finish_failed "GitHub API ответил $API_CODE" false ;;
esac
rm -f "$API_BODY"
TARGET_TAG="$(printf '%s' "$RESPONSE" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
[[ "$TARGET_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] ||
  finish_failed "Недопустимое имя релиза: ${TARGET_TAG:-<пусто>}" false
echo "$(date -Is) [$OPERATION_ID] последний релиз: $TARGET_TAG"

if [ "$TARGET_TAG" = "$CURRENT_REF" ]; then
  echo "$(date -Is) [$OPERATION_ID] уже установлена последняя версия"
  STAGE="завершено"
  DONE=1
  write_status success "$TARGET_TAG" "already up to date" true
  exit 0
fi

# Deployment-файлы берутся из архива проверенного тега (доверенный источник —
# GitHub, скачивание от root), а не из рабочего дерева приложения.
TRUSTED_DIR="$(mktemp -d)"
chmod 700 "$TRUSTED_DIR"
curl -fsSL "${CURL_AUTH[@]}" -H "Accept: application/vnd.github+json" \
  -o "$TRUSTED_DIR/release.tar.gz" \
  "https://api.github.com/repos/$REPOSITORY/tarball/$TARGET_TAG" ||
  finish_failed "не удалось скачать архив релиза $TARGET_TAG с GitHub" false
mkdir -p "$TRUSTED_DIR/src"
tar -xzf "$TRUSTED_DIR/release.tar.gz" -C "$TRUSTED_DIR/src" --strip-components=1 ||
  finish_failed "архив релиза $TARGET_TAG повреждён" false
DEPLOY_SRC="$TRUSTED_DIR/src/deployment"

set_stage "создание резервных копий"
TS="$(date +%Y%m%d-%H%M%S)"
SAFE_CURRENT="$(printf '%s' "$CURRENT_REF" | tr -c 'A-Za-z0-9._-' '_')"
SAFE_TARGET="$(printf '%s' "$TARGET_TAG" | tr -c 'A-Za-z0-9._-' '_')"
DEST="$BACKUP_DIR/${TS}-${SAFE_CURRENT}-to-${SAFE_TARGET}"
mkdir -p "$DEST" || finish_failed "Не удалось создать каталог резервной копии $DEST" false
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
chmod 700 "$DEST" 2>/dev/null || true
backup_database "$DEST" || finish_failed "Не удалось создать резервную копию БД" false
# Пользовательские изображения: hardlink-копия (cp -al) экономит место — файлы
# в uploads создаются один раз и не перезаписываются на месте; при невозможности
# hardlink (другая ФС) выполняется полная копия.
if [ -d "$UPLOADS_DIR" ]; then
  cp -al "$UPLOADS_DIR" "$DEST/uploads" 2>/dev/null ||
    cp -a "$UPLOADS_DIR" "$DEST/uploads" ||
    finish_failed "Не удалось создать резервную копию изображений ($UPLOADS_DIR)" false
fi
# Метаданные и текущие root-файлы механизма обновления (до их переустановки).
{
  printf 'date=%s\n' "$(date -Is)"
  printf 'currentRef=%s\n' "$CURRENT_REF"
  printf 'currentCommit=%s\n' "$(git_run rev-parse HEAD)"
  printf 'targetTag=%s\n' "$TARGET_TAG"
} >"$DEST/backup-meta.txt"
cp -f "$UPDATE_SELF" "$DEST/factura-update.sh.backup" 2>/dev/null || true
if [ -f "$SUDOERS_FILE" ]; then
  cp -f "$SUDOERS_FILE" "$DEST/sudoers.backup" 2>/dev/null || true
fi
echo "$(date -Is) [$OPERATION_ID] резервная копия: $DEST"

set_stage "получение исходного кода"
if ! FETCH_OUT="$(git_run fetch --tags --force origin 2>&1)"; then
  FETCH_TAIL="$(git_sanitize "$FETCH_OUT")"
  finish_failed "git fetch не удался${FETCH_TAIL:+: $FETCH_TAIL}" false
fi
git_run checkout "$TARGET_TAG" || finish_failed "git checkout $TARGET_TAG не удался" false
ACTUAL="$(git_run rev-parse HEAD)"
REMOTE="$(git_run rev-parse "refs/tags/$TARGET_TAG^{commit}")"
[ "$ACTUAL" = "$REMOTE" ] || finish_failed "checkout не соответствует тегу $TARGET_TAG" true

set_stage "установка зависимостей"
run_as_app "npm ci" || finish_failed "npm ci (app) не удался" true
run_in "$APP_DIR/admin" "npm ci" || finish_failed "npm ci (admin) не удался" true

set_stage "сборка приложения и админ-панели"
run_as_app "npm run build" || finish_failed "сборка не удалась" true

set_stage "миграция базы данных"
run_as_app "npm run db:migrate" || finish_failed "миграции не применились (БД не откатывается)" true

set_stage "установка deployment-файлов"
install_deployment_files || finish_failed "переустановка файлов деплоя не удалась" true

set_stage "перезапуск сервиса"
systemctl restart "$SERVICE" || finish_failed "перезапуск сервиса не удался" true

set_stage "проверка работоспособности"
healthcheck || finish_failed "healthcheck не прошёл после перезапуска" true

set_stage "завершено"
echo "$(date -Is) [$OPERATION_ID] обновлено $CURRENT_REF -> $TARGET_TAG"
DONE=1
write_status success "$TARGET_TAG" "updated from $CURRENT_REF" true
