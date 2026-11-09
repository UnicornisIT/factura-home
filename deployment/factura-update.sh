#!/usr/bin/env bash
# Обновление Factura Shop до последнего GitHub-релиза.
#
# Запускается от root (чер sudoers-запись) по кнопке «Обновить» в админ-панели
# или вручную: sudo /usr/local/sbin/factura-update.sh
#
# Поток: блокировка (flock) -> статус "running" -> последний релиз через GitHub API
# -> резервная копия БД и .env -> git fetch/checkout тега -> npm ci -> build
# -> db:migrate -> переустановка скрипта обновления и systemd-юнита из нового тега
# -> systemctl restart -> healthcheck. При сбое код, скрипт обновления и юнит
# откатываются на предыдущие, сервис перезапускается; БД не откатывается.
# Итог пишется в SERVER_UPDATE_STATUS_PATH (JSON), журнал — /var/log/factura/update.log.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Требуется root" >&2; exit 1; }

APP_DIR="${FACTURA_APP_DIR:-/opt/factura/current}"
ENV_FILE="$APP_DIR/app/.env"
[ -f "$ENV_FILE" ] || { echo "Не найден $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

SERVICE="${FACTURA_SERVICE:-factura}"
REPOSITORY="${SERVER_UPDATE_REPOSITORY:-UnicornisIT/factura-home}"
TOKEN="${SERVER_UPDATE_TOKEN:-}"
STATUS_PATH="${SERVER_UPDATE_STATUS_PATH:-/var/lib/factura/update-status.json}"
BACKUP_DIR="${FACTURA_BACKUP_DIR:-/var/backups/factura}"
LOG_FILE="${FACTURA_UPDATE_LOG:-/var/log/factura/update.log}"
LOCK_FILE="/run/lock/factura-update.lock"
UPDATE_SELF="${SERVER_UPDATE_SCRIPT:-/usr/local/sbin/factura-update.sh}"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
DATA_DIR="${FACTURA_DATA_DIR:-/var/lib/factura}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
HEALTHCHECK_URL="http://$HOST:$PORT/api/trpc/ping"
HEALTHCHECK_TRIES=30

mkdir -p "$(dirname "$LOG_FILE")" "$BACKUP_DIR" "$(dirname "$STATUS_PATH")"
exec >>"$LOG_FILE" 2>&1

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -Is) Обновление уже выполняется, выход"
  exit 1
fi

OPERATION_ID="$(date +%Y%m%d%H%M%S)-$$"
APP_USER="$(stat -c %U "$APP_DIR")"

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r\t'; }

write_status() { # write_status state tag message finished
  local tmp
  tmp="$(mktemp "$(dirname "$STATUS_PATH")/.status.XXXXXX")"
  printf '{"state":"%s","tag":%s,"operationId":"%s","startedAt":"%s","finishedAt":%s,"message":%s}\n' \
    "$1" \
    "$( [ -n "${2:-}" ] && printf '"%s"' "$(json_escape "$2")" || printf 'null' )" \
    "$OPERATION_ID" \
    "$STARTED_AT" \
    "$( [ "${4:-false}" = true ] && printf '"%s"' "$(date -Is)" || printf 'null' )" \
    "$( [ -n "${3:-}" ] && printf '"%s"' "$(json_escape "$3")" || printf 'null' )" >"$tmp"
  chown "$APP_USER:$APP_USER" "$tmp" 2>/dev/null || true
  chmod 640 "$tmp"
  mv -f "$tmp" "$STATUS_PATH"
}

STARTED_AT="$(date -Is)"
CURRENT_REF="$(git -C "$APP_DIR" describe --tags --exact-match 2>/dev/null || git -C "$APP_DIR" rev-parse --short HEAD)"
echo "$(date -Is) [$OPERATION_ID] начало, текущая версия: $CURRENT_REF"
write_status running "$CURRENT_REF" "" false

github_api() {
  curl -fsSL \
    ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: factura-updater" \
    "$@"
}

finish_failed() { # finish_failed message [rollback:true]
  local message="$1"
  echo "$(date -Is) [$OPERATION_ID] ОШИБКА: $message"
  if [ "${2:-false}" = true ] && [ -n "${CURRENT_REF:-}" ]; then
    echo "$(date -Is) [$OPERATION_ID] откат кода на $CURRENT_REF"
    if git -C "$APP_DIR" checkout -f "$CURRENT_REF" &&
      run_as_app "npm ci" && run_as_app "npm run build"; then
      restore_deployment_files
      systemctl restart "$SERVICE"
      echo "$(date -Is) [$OPERATION_ID] откат завершён (БД не откатывается)"
    else
      echo "$(date -Is) [$OPERATION_ID] ОТКАТ НЕ УДАЛСЯ — требуется ручное вмешательство"
      message="$message; rollback failed"
    fi
  fi
  write_status failed "${TARGET_TAG:-$CURRENT_REF}" "$message" true
  exit 1
}

run_as_app() { # run_as_app "команда" — выполняется в $APP_DIR/app от имени владельца
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR/app' && $1"
}

install_deployment_files() { # переустановка скрипта обновления и юнита из нового тега
  if [ -f "$APP_DIR/deployment/factura-update.sh" ]; then
    cp -f "$UPDATE_SELF" "$DEST/factura-update.sh.prev"
    # install заменяет файл атомарно через rename: уже запущенный процесс
    # продолжает выполняться из старого inode.
    install -o root -g root -m 755 "$APP_DIR/deployment/factura-update.sh" "$UPDATE_SELF"
  fi
  if [ -f "$APP_DIR/deployment/factura.service" ]; then
    [ -f "$UNIT_FILE" ] && cp -f "$UNIT_FILE" "$DEST/factura.service.prev"
    sed -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@APP_USER@|$APP_USER|g" \
      -e "s|@RW_PATHS@|$DATA_DIR $(dirname "$LOG_FILE")|g" \
      "$APP_DIR/deployment/factura.service" >"$UNIT_FILE.tmp"
    mv -f "$UNIT_FILE.tmp" "$UNIT_FILE"
    systemctl daemon-reload
  fi
}

restore_deployment_files() { # возврат скрипта обновления и юнита из резервной копии
  if [ -n "${DEST:-}" ]; then
    [ -f "$DEST/factura-update.sh.prev" ] &&
      install -o root -g root -m 755 "$DEST/factura-update.sh.prev" "$UPDATE_SELF"
    [ -f "$DEST/factura.service.prev" ] &&
      cp -f "$DEST/factura.service.prev" "$UNIT_FILE" &&
      systemctl daemon-reload
  fi
  return 0
}

backup_database() { # backup_database dest_dir
  local dest="$1"
  if [ "${DB_DIALECT:-mysql}" = sqlite ]; then
    local db="${SQLITE_PATH:-$APP_DIR/app/dev.db}"
    [[ "$db" != /* ]] && db="$APP_DIR/app/$db"
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$db" ".backup '$dest/db.sqlite'"
    else
      cp "$db" "$dest/db.sqlite"
    fi
  else
    local url="${DATABASE_URL:-}"
    [[ "$url" =~ ^mysql://([^:]+):([^@]*)@([^:/]+)(:([0-9]+))?/(.+)$ ]] || {
      echo "Не удалось разобрать DATABASE_URL"; return 1; }
    local user="${BASH_REMATCH[1]}" pass="${BASH_REMATCH[2]}" host="${BASH_REMATCH[3]}"
    local port="${BASH_REMATCH[5]:-3306}" db="${BASH_REMATCH[6]}"
    local cnf
    cnf="$(mktemp)"
    chmod 600 "$cnf"
    printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$user" "$pass" "$host" "$port" >"$cnf"
    mysqldump --defaults-extra-file="$cnf" --single-transaction \
      --default-character-set=utf8mb4 "$db" >"$dest/db.sql"
    rm -f "$cnf"
  fi
  cp "$ENV_FILE" "$dest/env.backup"
  cp "/etc/systemd/system/$SERVICE.service" "$dest/service.backup" 2>/dev/null || true
}

healthcheck() {
  local i
  for i in $(seq 1 "$HEALTHCHECK_TRIES"); do
    if curl -fsS "$HEALTHCHECK_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# 1. Последний релиз
RESPONSE="$(github_api "https://api.github.com/repos/$REPOSITORY/releases/latest")" ||
  finish_failed "GitHub API недоступен" false
TARGET_TAG="$(printf '%s' "$RESPONSE" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
[ -n "$TARGET_TAG" ] || finish_failed "В репозитории нет релизов" false
echo "$(date -Is) [$OPERATION_ID] последний релиз: $TARGET_TAG"

if [ "$TARGET_TAG" = "$CURRENT_REF" ]; then
  echo "$(date -Is) [$OPERATION_ID] уже установлена последняя версия"
  write_status success "$TARGET_TAG" "already up to date" true
  exit 0
fi

# 2. Резервная копия
TS="$(date +%Y%m%d-%H%M%S)"
SAFE_CURRENT="$(printf '%s' "$CURRENT_REF" | tr -c 'A-Za-z0-9._-' '_')"
SAFE_TARGET="$(printf '%s' "$TARGET_TAG" | tr -c 'A-Za-z0-9._-' '_')"
DEST="$BACKUP_DIR/${TS}-${SAFE_CURRENT}-to-${SAFE_TARGET}"
mkdir -p "$DEST"
backup_database "$DEST" || finish_failed "Не удалось создать резервную копию БД" false
echo "$(date -Is) [$OPERATION_ID] резервная копия: $DEST"

# 3. Код нового релиза
git -C "$APP_DIR" ${TOKEN:+-c "http.extraHeader=Authorization: Bearer $TOKEN"} \
  fetch --tags --force origin || finish_failed "git fetch не удался" false
git -C "$APP_DIR" checkout -f "$TARGET_TAG" || finish_failed "git checkout $TARGET_TAG не удался" false
ACTUAL="$(git -C "$APP_DIR" rev-parse HEAD)"
REMOTE="$(git -C "$APP_DIR" rev-parse "refs/tags/$TARGET_TAG^{commit}")"
[ "$ACTUAL" = "$REMOTE" ] || finish_failed "checkout не соответствует тегу $TARGET_TAG" true

# 4. Зависимости, сборка, миграции, перезапуск
run_as_app "npm ci" || finish_failed "npm ci (app) не удался" true
sudo -u "$APP_USER" bash -c "cd '$APP_DIR/admin' && npm ci" || finish_failed "npm ci (admin) не удался" true
run_as_app "npm run build" || finish_failed "сборка не удалась" true
run_as_app "npm run db:migrate" || finish_failed "миграции не применились" true
install_deployment_files || finish_failed "переустановка файлов деплоя не удалась" true
systemctl restart "$SERVICE" || finish_failed "перезапуск сервиса не удался" true
healthcheck || finish_failed "healthcheck не прошёл после перезапуска" true

echo "$(date -Is) [$OPERATION_ID] обновлено $CURRENT_REF -> $TARGET_TAG"
write_status success "$TARGET_TAG" "updated from $CURRENT_REF" true
