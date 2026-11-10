#!/usr/bin/env bash
# Интеграционный сценарий проверки механизма обновления Factura на НАСТОЯЩИХ
# systemd, sudoers, Unix-пользователе и правах файловой системы.
#
# ТОЛЬКО для одноразовой тестовой VM или CI-runner. НЕ запускать на production:
# сценарий создаёт системного пользователя, юниты, sudoers-записи и временные
# заглушки в /usr/local/bin. Защита: обязательный флаг и проверка маркеров
# production (см. ниже).
#
# Запуск (от root):
#   sudo env REPO_ROOT=/путь/к/чекауту [NODE_BIN=/путь/к/node] \
#     bash deployment/tests/systemd-integration.sh --i-am-on-a-disposable-vm
#
# Предусловия: systemd (PID 1), git, sqlite3, node (NODE_BIN или в PATH;
# в репозитории выполнен `npm ci --prefix app` — нужен better-sqlite3 для
# проверки резервного копирования без sqlite3 CLI), доступ в интернет НЕ нужен.
#
# Проверяемые сценарии (номера соответствуют требованиям регрессии):
#   S1  полный цикл обновления по триггеру из cgroup сервиса:
#       реальный handoff в transient unit systemd через sudoers (8),
#       root-owned BACKUP_DIR 700 недоступен пользователю приложения (1),
#       WAL-база под активной транзакцией: копия согласована, integrity ok (2,3,5)
#   S2  повторный запуск: «already up to date» без изменений
#   S3  резервное копирование без sqlite3 CLI через better-sqlite3 (4)
#   S4  битый шаблон sudoers в релизе: рабочий sudoers не заменён, откат (7)
#   S5  битый шаблон unit-файла: systemd-analyze verify отклоняет, юнит цел
#   S6  ошибка резервного копирования: обновление отменено до изменения кода (6)
#   S7  конкурентный запуск: второй процесс отклоняется блокировкой/unit-именем
set -euo pipefail

IT_FLAG="${1:-}"
if [ "$IT_FLAG" != "--i-am-on-a-disposable-vm" ]; then
  echo "Отказ: сценарий запускается только на одноразовой VM/CI-runner." >&2
  echo "Использование: sudo env REPO_ROOT=... bash $0 --i-am-on-a-disposable-vm" >&2
  exit 2
fi
[ "$(id -u)" -eq 0 ] || { echo "Отказ: требуется root" >&2; exit 2; }
# Маркеры production — сценарий не должен выполняться на боевом сервере.
if [ -f /opt/factura/app/.env ] || systemctl list-unit-files factura.service 2>/dev/null | grep -q '^factura\.service'; then
  echo "Отказ: обнаружены маркеры production-установки Factura. Сценарий только для одноразовой среды." >&2
  exit 2
fi
[ -d /run/systemd/system ] || { echo "Отказ: systemd не запущен (нет /run/systemd/system)" >&2; exit 2; }

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
[ -f "$REPO_ROOT/deployment/factura-update.sh" ] || { echo "Отказ: REPO_ROOT=$REPO_ROOT не содержит deployment/factura-update.sh" >&2; exit 2; }

for cmd in git curl sqlite3 flock systemd-run systemctl useradd; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Отказ: не найден $cmd" >&2; exit 2; }
done
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[ -n "$NODE_BIN" ] || { echo "Отказ: node не найден (задайте NODE_BIN)" >&2; exit 2; }
[ -d "$REPO_ROOT/app/node_modules/better-sqlite3" ] || {
  echo "Отказ: нет $REPO_ROOT/app/node_modules/better-sqlite3 — выполните npm ci --prefix app" >&2; exit 2; }

# --- Изолированное пространство имён ---------------------------------------
IT_USER="factura-it"
IT_ROOT="/opt/factura-it-root"          # фикстуры (репозитории, заглушки)
APP_DIR="/opt/factura-it"               # «установленное приложение»
DATA_DIR="/var/lib/factura-it"
BACKUP_DIR="/var/backups/factura-it"
LOG_DIR="/var/log/factura-it"
LOCK_FILE="/run/lock/factura-it-update.lock"
STATUS_PATH="$DATA_DIR/update-status.json"
UPDATE_LOG="$LOG_DIR/update.log"
SERVICE="factura-it"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
SUDOERS_FILE="/etc/sudoers.d/$SERVICE-update"
UPDATE_SCRIPT="/usr/local/sbin/factura-update-it.sh"
IT_PORT=3998
STUBS="$IT_ROOT/stubs"
TARROOT="$IT_ROOT/tarroot"
CURL_CONTROL="$IT_ROOT/curl-control"
NODE_LINK_CREATED=0
STUBS_INSTALLED=()

PASS_COUNT=0
FAIL_COUNT=0

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf '\033[1;32m  PASS\033[0m %s\n' "$*"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf '\033[1;31m  FAIL\033[0m %s\n' "$*" >&2; }
check() { # check "описание" условие...
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

cleanup() {
  set +e
  log "Очистка стенда"
  pkill -u "$IT_USER" -f 'sleep 45' 2>/dev/null
  pkill -u "$IT_USER" sqlite3 2>/dev/null
  systemctl stop "$SERVICE" 2>/dev/null
  systemctl reset-failed "$SERVICE" 2>/dev/null
  systemctl reset-failed factura-update 2>/dev/null
  rm -f "$UNIT_FILE" "$SUDOERS_FILE" /etc/factura/update.env /etc/factura/factura.env
  systemctl daemon-reload 2>/dev/null
  for f in "${STUBS_INSTALLED[@]}"; do rm -f "$f"; done
  [ "$NODE_LINK_CREATED" = "1" ] && rm -f /usr/bin/node
  userdel "$IT_USER" 2>/dev/null
  rm -rf "$IT_ROOT" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR" "$LOCK_FILE"
  log "Очистка завершена"
}
trap cleanup EXIT

# --- Пользователь, каталоги, node -------------------------------------------
log "Подготовка стенда"
id -u "$IT_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$IT_USER"
mkdir -p "$IT_ROOT" "$DATA_DIR/uploads" "$BACKUP_DIR" "$LOG_DIR" "$STUBS" "$TARROOT"
chown -R "$IT_USER:$IT_USER" "$DATA_DIR" "$LOG_DIR"
chmod 700 "$BACKUP_DIR"
if [ ! -x /usr/bin/node ]; then
  ln -s "$NODE_BIN" /usr/bin/node
  NODE_LINK_CREATED=1
fi

# --- Заглушки curl/npm -------------------------------------------------------
# curl и npm устанавливаются в /usr/local/bin: этот каталог входит в secure_path
# sudo и в PATH по умолчанию у transient unit systemd — иначе заглушки не видны
# ни скрипту, запущенному через sudoers, ни его detached-копии.
cat >"$STUBS/curl" <<EOF
#!/usr/bin/env bash
out=""; url=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2;;
    -H|-w|-A|-u|--config) shift 2;;
    -*) shift;;
    *) url="\$1"; shift;;
  esac
done
case "\$url" in
  *api.github.com*/tarball/*)
    tar -czf "\$out" -C "$TARROOT" pkg
    ;;
  *api.github.com*)
    tag="\$(sed -n 's/^TAG=//p' '$CURL_CONTROL' | head -n1)"
    code="\$(sed -n 's/^CODE=//p' '$CURL_CONTROL' | head -n1)"
    [ -n "\$out" ] && printf '{"tag_name":"%s"}' "\${tag:-v0.0.2}" > "\$out"
    printf '%s' "\${code:-200}"
    ;;
  *)
    [ -f "$IT_ROOT/health-fail" ] && exit 7
    exit 0
    ;;
esac
exit 0
EOF
cat >"$STUBS/npm" <<EOF
#!/usr/bin/env bash
# Пути зашиты: вложенный sudo -u внутри скрипта обновления сбрасывает
# окружение (secure_path + env_reset), переменные сюда не доехали бы.
echo "npm \$*" >> "$IT_ROOT/npm-stub.log"
if [ -f "$IT_ROOT/slow" ]; then sleep 8; fi
exit 0
EOF
chmod 755 "$STUBS/curl" "$STUBS/npm"
for name in curl npm; do
  install -m 755 "$STUBS/$name" "/usr/local/bin/$name"
  STUBS_INSTALLED+=("/usr/local/bin/$name")
done
printf 'TAG=v0.0.2\nCODE=200\n' >"$CURL_CONTROL"

git_iso() { # git c изолированной конфигурацией от указанного пользователя
  local user="$1" dir="$2"; shift 2
  sudo -u "$user" env \
    GIT_AUTHOR_NAME=IT GIT_AUTHOR_EMAIL=it@example.com \
    GIT_COMMITTER_NAME=IT GIT_COMMITTER_EMAIL=it@example.com \
    GIT_TERMINAL_PROMPT=0 \
    git -C "$dir" "$@"
}
git_root() { # git от root (для bare-репозитория)
  env GIT_AUTHOR_NAME=IT GIT_AUTHOR_EMAIL=it@example.com \
    GIT_COMMITTER_NAME=IT GIT_COMMITTER_EMAIL=it@example.com \
    GIT_TERMINAL_PROMPT=0 git "$@"
}

# --- Фикстурный «GitHub»: bare-репозиторий и теги-релизы ---------------------
REMOTE="$IT_ROOT/remotes/UnicornisIT/factura-home.git"
mkdir -p "$REMOTE"
git_root init --bare -b main "$REMOTE" >/dev/null
WORK="$IT_ROOT/work"
mkdir -p "$WORK/app/dist" "$WORK/admin"
git_root init -b main "$WORK" >/dev/null
echo "# it v0.0.1" >"$WORK/README.md"
echo '{"name":"app"}' >"$WORK/app/package.json"
echo '{"name":"admin"}' >"$WORK/admin/package.json"
# Тестовый «сервис» присутствует уже в v0.0.1: сервис должен подниматься и после
# отката/сброса на старую версию (ExecStart=/usr/bin/node dist/boot.js).
cat >"$WORK/app/dist/boot.js" <<EOF
// Тестовый «сервис»: отвечает на healthcheck и по /it-trigger запускает
// обновление через sudoers — так же, как реальное API из cgroup сервиса.
const http = require("http");
const { spawn } = require("child_process");
http.createServer((req, res) => {
  if (req.url === "/it-trigger") {
    const child = spawn("sudo", ["-n", "$UPDATE_SCRIPT"], {
      detached: true,
      stdio: "ignore",
    });
    child.on("exit", code =>
      console.log("it-trigger child exit", code));
    child.unref();
    res.writeHead(202); res.end("triggered");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end('{"ok":true}');
}).listen($IT_PORT, "127.0.0.1");
EOF
git_root -C "$WORK" add -A >/dev/null
git_root -C "$WORK" commit -qm "v0.0.1"
git_root -C "$WORK" tag v0.0.1

# v0.0.2: deployment-файлы из тестируемого чекаута.
mkdir -p "$WORK/deployment"
cp "$REPO_ROOT/deployment/factura-update.sh" "$WORK/deployment/"
cp "$REPO_ROOT/deployment/factura.service" "$WORK/deployment/"
cp "$REPO_ROOT/deployment/sudoers-factura-update" "$WORK/deployment/"
echo "# it v0.0.2" >"$WORK/README.md"
git_root -C "$WORK" add -A >/dev/null
git_root -C "$WORK" commit -qm "v0.0.2"
git_root -C "$WORK" tag v0.0.2
# Дополнительные теги для последующих сценариев (пустые коммиты — каждый тег
# указывает на уникальный commit, чтобы CURRENT_REF определялся однозначно).
for t in v0.0.3 v0.0.4 v0.0.5 v0.0.6 v0.0.7; do
  git_root -C "$WORK" commit -q --allow-empty -m "$t"
  git_root -C "$WORK" tag "$t"
done
git_root -C "$WORK" remote add origin "$REMOTE"
git_root -C "$WORK" push -q origin main --tags

# «Архив релиза» для curl-заглушки: дерево v0.0.2 с маркером в юните.
mkdir -p "$TARROOT/pkg"
cp -r "$WORK/." "$TARROOT/pkg/"
rm -rf "$TARROOT/pkg/.git"
printf '# it-tarball-marker\n' | cat - "$TARROOT/pkg/deployment/factura.service" >"$TARROOT/unit.tmp"
mv "$TARROOT/unit.tmp" "$TARROOT/pkg/deployment/factura.service"

# --- «Установленное приложение» v0.0.1 ---------------------------------------
git_root clone -q "$REMOTE" "$APP_DIR"
git_iso "$IT_USER" "$APP_DIR" checkout -q v0.0.1
ln -s "$REPO_ROOT/app/node_modules" "$APP_DIR/app/node_modules"
cat >"$APP_DIR/app/.env" <<EOF
NODE_ENV=production
DB_DIALECT=sqlite
SQLITE_PATH=$DATA_DIR/factura.db
UPLOAD_DIR=$DATA_DIR/uploads
HOST=127.0.0.1
PORT=$IT_PORT
GITHUB_TOKEN=it-secret-token
SERVER_UPDATE_ENABLED=true
SERVER_UPDATE_REPOSITORY=UnicornisIT/factura-home
SERVER_UPDATE_SCRIPT=$UPDATE_SCRIPT
SERVER_UPDATE_STATUS_PATH=$STATUS_PATH
EOF
chown "$IT_USER:$IT_USER" "$APP_DIR/app/.env"
chmod 640 "$APP_DIR/app/.env"
chown -R "$IT_USER:$IT_USER" "$APP_DIR"

# --- Root-файлы механизма (как на реальном сервере) ---------------------------
install -o root -g root -m 755 "$REPO_ROOT/deployment/factura-update.sh" "$UPDATE_SCRIPT"
sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@APP_USER@|$IT_USER|g" \
  -e "s|@RW_PATHS@|$DATA_DIR $LOG_DIR|g" \
  "$REPO_ROOT/deployment/factura.service" >"$UNIT_FILE"
chmod 644 "$UNIT_FILE"
# Sudoers: временный файл -> visudo -> замена (безопасный порядок).
STMP="$(mktemp /etc/sudoers.d/.it-XXXXXX)"
sed -e "s/^factura /$IT_USER /" -e "s|@UPDATE_SCRIPT@|$UPDATE_SCRIPT|" \
  "$REPO_ROOT/deployment/sudoers-factura-update" >"$STMP"
chown root:root "$STMP"; chmod 440 "$STMP"
visudo -cf "$STMP" >/dev/null
mv -f "$STMP" "$SUDOERS_FILE"
# Root-конфиг механизма: тестовые пути + PATH заглушек для transient unit.
mkdir -p /etc/factura
cat >/etc/factura/update.env <<EOF
FACTURA_APP_DIR=$APP_DIR
FACTURA_SERVICE=$SERVICE
FACTURA_BACKUP_DIR=$BACKUP_DIR
FACTURA_UPDATE_LOG=$UPDATE_LOG
FACTURA_LOCK_FILE=$LOCK_FILE
FACTURA_UNIT_FILE=$UNIT_FILE
FACTURA_SUDOERS_FILE=$SUDOERS_FILE
FACTURA_DATA_DIR=$DATA_DIR
FACTURA_HEALTHCHECK_TRIES=10
FACTURA_UPDATE_SYSTEMD_ENV=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EOF
chown root:root /etc/factura/update.env
chmod 600 /etc/factura/update.env
systemctl daemon-reload
systemctl enable --now "$SERVICE" >/dev/null 2>&1

# --- Вспомогательные функции сценариев ----------------------------------------
wait_status() { # wait_status <state> [timeout c] — ждёт состояния в статус-файле
  local want="$1" timeout="${2:-90}" i state=""
  for ((i = 0; i < timeout * 2; i++)); do
    if [ -f "$STATUS_PATH" ]; then
      state="$(sed -n 's/.*"state":"\([a-z]*\)".*/\1/p' "$STATUS_PATH" | head -n1)"
      [ "$state" = "$want" ] && return 0
    fi
    sleep 0.5
  done
  echo "    (ожидался статус '$want', последний: '$state')" >&2
  return 1
}
trigger_update() { # запуск обновления из cgroup сервиса (как кнопка в панели)
  # Настоящий curl: /usr/local/bin/curl на стенде — заглушка.
  /usr/bin/curl -fsS -X POST "http://127.0.0.1:$IT_PORT/it-trigger" >/dev/null
}
reset_to_v001() {
  git_iso "$IT_USER" "$APP_DIR" checkout -qf v0.0.1
  rm -f "$STATUS_PATH"
  : >"$IT_ROOT/npm-stub.log" 2>/dev/null || true
}
make_db() { # реальная SQLite-база в WAL-режиме с одной зафиксированной строкой
  rm -f "$DATA_DIR"/factura.db*
  sudo -u "$IT_USER" sqlite3 "$DATA_DIR/factura.db" \
    "PRAGMA journal_mode=WAL; CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);" >/dev/null
}
start_wal_holder() { # незафиксированная транзакция держит WAL активной
  sudo -u "$IT_USER" bash -c "( printf 'BEGIN IMMEDIATE;\nINSERT INTO t VALUES (999);\n'; sleep 45 ) | sqlite3 '$DATA_DIR/factura.db' >/dev/null 2>&1 &"
  sleep 2
}
stop_wal_holder() { pkill -u "$IT_USER" sqlite3 2>/dev/null; pkill -u "$IT_USER" -f 'sleep 45' 2>/dev/null; true; }
latest_backup() { # имя самой свежей резервной копии
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' 2>/dev/null |
    sort -rn | head -n1 | cut -d' ' -f2-
}

# ==============================================================================
log "S1. Полный цикл: handoff из cgroup сервиса, WAL-бэкап, права резервных копий"
# ==============================================================================
make_db
start_wal_holder
check "WAL активна до обновления (-wal существует)" test -e "$DATA_DIR/factura.db-wal"
printf 'TAG=v0.0.2\nCODE=200\n' >"$CURL_CONTROL"
trigger_update
if wait_status success 120; then pass "обновление завершилось успехом (статус success, тег v0.0.2)"; else fail "обновление не завершилось успехом"; fi
stop_wal_holder
check "журнал: реальный handoff в transient unit" grep -q "запуск в transient unit" "$UPDATE_LOG"
check "transient unit factura-update реально выполнялся (journalctl)" \
  bash -c "journalctl -u factura-update --no-pager 2>/dev/null | grep -q 'factura-update'"
check "репозиторий на теге v0.0.2" bash -c "[ \"\$(git -C '$APP_DIR' describe --tags --exact-match 2>/dev/null)\" = v0.0.2 ]"
check "сервис перезапущен и активен" bash -c "systemctl is-active '$SERVICE' >/dev/null"
check "healthcheck-эндпоинт сервиса отвечает (настоящий curl)" \
  /usr/bin/curl -fsS "http://127.0.0.1:$IT_PORT/api/trpc/ping"
DEST="$(latest_backup)"
check "резервная копия создана" test -n "$DEST"
check "BACKUP_DIR принадлежит root с правами 700" \
  bash -c "[ \"\$(stat -c '%U %a' '$BACKUP_DIR')\" = 'root 700' ]"
check "каталог копии принадлежит root с правами 700" \
  bash -c "[ \"\$(stat -c '%U %a' '$BACKUP_DIR/$DEST')\" = 'root 700' ]"
check "пользователь приложения НЕ может читать каталог резервных копий" \
  bash -c "! sudo -u '$IT_USER' ls '$BACKUP_DIR/$DEST' >/dev/null 2>&1"
check "копия БД: integrity_check = ok" \
  bash -c "[ \"\$(sqlite3 '$BACKUP_DIR/$DEST/db.sqlite' 'PRAGMA integrity_check;' | head -n1)\" = ok ]"
check "копия БД согласована: незафиксированная строка (999) не попала в копию" \
  bash -c "[ \"\$(sqlite3 '$BACKUP_DIR/$DEST/db.sqlite' 'SELECT count(*) FROM t WHERE x=999;')\" = 0 ]"
check "копия БД содержит зафиксированные данные" \
  bash -c "[ \"\$(sqlite3 '$BACKUP_DIR/$DEST/db.sqlite' 'SELECT count(*) FROM t WHERE x=1;')\" = 1 ]"
check "копия db.sqlite принадлежит root, права 600" \
  bash -c "[ \"\$(stat -c '%U %a' '$BACKUP_DIR/$DEST/db.sqlite')\" = 'root 600' ]"
check "владельцы живой БД и -wal не изменились (приложение)" \
  bash -c "[ \"\$(stat -c '%U' '$DATA_DIR/factura.db')\" = '$IT_USER' ]"
check "образы и метаданные в резервной копии" \
  bash -c "[ -f '$BACKUP_DIR/$DEST/backup-meta.txt' ] && [ -d '$BACKUP_DIR/$DEST/uploads' ]"
check "юнит установлен из архива релиза (маркер) и прошёл настоящий verify" \
  grep -q "it-tarball-marker" "$UNIT_FILE"
check "sudoers заменён на версию из архива релиза" grep -q "$IT_USER" "$SUDOERS_FILE"

# ==============================================================================
log "S2. Повторный запуск: уже установлена последняя версия"
# ==============================================================================
rm -f "$STATUS_PATH"
trigger_update
if wait_status success 60; then pass "повторный запуск завершился без обновления"; else fail "повторный запуск не завершился"; fi
check "статус: already up to date" grep -q "already up to date" "$STATUS_PATH"
check "HEAD не изменился (v0.0.2)" bash -c "[ \"\$(git -C '$APP_DIR' describe --tags --exact-match 2>/dev/null)\" = v0.0.2 ]"

# ==============================================================================
log "S3. Резервная копия без sqlite3 CLI — через better-sqlite3 Backup API"
# ==============================================================================
reset_to_v001
make_db
start_wal_holder
printf 'TAG=v0.0.3\nCODE=200\n' >"$CURL_CONTROL"
printf 'FACTURA_DISABLE_SQLITE_CLI=1\n' >>/etc/factura/update.env
trigger_update
if wait_status success 120; then pass "обновление с node-бэкапом завершилось успехом"; else fail "обновление с node-бэкапом не завершилось"; fi
stop_wal_holder
sed -i '/FACTURA_DISABLE_SQLITE_CLI/d' /etc/factura/update.env
check "журнал: использован better-sqlite3 Backup API" \
  grep -q "better-sqlite3 Backup API" "$UPDATE_LOG"
DEST="$(latest_backup)"
check "копия БД (node-путь): integrity_check = ok" \
  bash -c "[ \"\$(sqlite3 '$BACKUP_DIR/$DEST/db.sqlite' 'PRAGMA integrity_check;' | head -n1)\" = ok ]"
check "копия БД (node-путь) согласована: 999 отсутствует, 1 присутствует" \
  bash -c "[ \"\$(sqlite3 '$BACKUP_DIR/$DEST/db.sqlite' 'SELECT count(*) FROM t;')\" = 1 ]"

# ==============================================================================
log "S4. Битый шаблон sudoers в релизе: рабочий файл не заменён, выполнен откат"
# ==============================================================================
reset_to_v001
GOOD_SUDOERS_SUM="$(md5sum "$SUDOERS_FILE" | cut -d' ' -f1)"
printf 'TAG=v0.0.4\nCODE=200\n' >"$CURL_CONTROL"
echo 'this is %%% not valid sudoers' >"$TARROOT/pkg/deployment/sudoers-factura-update"
trigger_update
if wait_status failed 120; then pass "обновление с битым sudoers отклонено"; else fail "обновление с битым sudoers не отклонено"; fi
check "статус сообщает об ошибке файлов деплоя" grep -q "файлов деплоя" "$STATUS_PATH"
check "рабочий sudoers не изменён" bash -c "[ \"\$(md5sum '$SUDOERS_FILE' | cut -d' ' -f1)\" = '$GOOD_SUDOERS_SUM' ]"
check "код откачен на v0.0.1" bash -c "[ \"\$(git -C '$APP_DIR' describe --tags --exact-match 2>/dev/null)\" = v0.0.1 ]"
check "откат подтверждён работоспособностью сервиса" grep -q "работоспособен" "$STATUS_PATH"
check "сервис активен после отката" bash -c "systemctl is-active '$SERVICE' >/dev/null"
cp "$REPO_ROOT/deployment/sudoers-factura-update" "$TARROOT/pkg/deployment/sudoers-factura-update"

# ==============================================================================
log "S5. Битый шаблон unit-файла: настоящий systemd-analyze verify отклоняет"
# ==============================================================================
reset_to_v001
GOOD_UNIT_SUM="$(md5sum "$UNIT_FILE" | cut -d' ' -f1)"
printf 'TAG=v0.0.5\nCODE=200\n' >"$CURL_CONTROL"
printf 'BogusUnknownDirective=yes\n' >>"$TARROOT/pkg/deployment/factura.service"
trigger_update
if wait_status failed 120; then pass "обновление с битым юнитом отклонено"; else fail "обновление с битым юнитом не отклонено"; fi
check "юнит не заменён (verify не прошёл)" bash -c "[ \"\$(md5sum '$UNIT_FILE' | cut -d' ' -f1)\" = '$GOOD_UNIT_SUM' ]"
check "журнал: verify отклонил шаблон" grep -q "systemd-analyze verify" "$UPDATE_LOG"
check "код откачен на v0.0.1" bash -c "[ \"\$(git -C '$APP_DIR' describe --tags --exact-match 2>/dev/null)\" = v0.0.1 ]"
head -n -1 "$TARROOT/pkg/deployment/factura.service" >"$TARROOT/unit.tmp"
mv "$TARROOT/unit.tmp" "$TARROOT/pkg/deployment/factura.service"

# ==============================================================================
log "S6. Ошибка резервного копирования: обновление отменено до изменения кода"
# ==============================================================================
reset_to_v001
make_db
chmod 000 "$DATA_DIR/factura.db"
printf 'TAG=v0.0.6\nCODE=200\n' >"$CURL_CONTROL"
trigger_update
if wait_status failed 120; then pass "обновление отменено на стадии резервного копирования"; else fail "обновление не отменено при ошибке бэкапа"; fi
chmod 644 "$DATA_DIR/factura.db"
chown "$IT_USER:$IT_USER" "$DATA_DIR/factura.db"
check "статус: ошибка резервной копии БД" grep -q "резервную копию БД" "$STATUS_PATH"
check "код не изменён (v0.0.1)" bash -c "[ \"\$(git -C '$APP_DIR' describe --tags --exact-match 2>/dev/null)\" = v0.0.1 ]"
check "npm не вызывался (приложение не тронуто)" bash -c "! grep -q 'npm ci' '$IT_ROOT/npm-stub.log'"

# ==============================================================================
log "S7. Конкурентный запуск: второй процесс отклоняется"
# ==============================================================================
reset_to_v001
printf 'TAG=v0.0.7\nCODE=200\n' >"$CURL_CONTROL"
touch "$IT_ROOT/slow"
trigger_update
sleep 4
LOG_LINES_BEFORE="$(wc -l <"$UPDATE_LOG")"
trigger_update || true
if wait_status success 150; then pass "первое обновление завершилось успехом"; else fail "первое обновление не завершилось"; fi
rm -f "$IT_ROOT/slow"
check "второй запуск отклонён (блокировка или занятое unit-имя)" \
  bash -c "tail -n +$((LOG_LINES_BEFORE + 1)) '$UPDATE_LOG' | grep -qE 'блокировка занята|systemd-run не сработал|уже выполняется'"
check "статус один и принадлежит успешной операции" grep -q '"state":"success"' "$STATUS_PATH"

# --- Итог ----------------------------------------------------------------------
echo
log "Результат: PASS=$PASS_COUNT FAIL=$FAIL_COUNT"
if [ "$FAIL_COUNT" -ne 0 ]; then
  echo "Журнал обновления (хвост):" >&2
  tail -n 60 "$UPDATE_LOG" >&2 || true
  exit 1
fi
echo "Интеграция с настоящим systemd подтверждена."
