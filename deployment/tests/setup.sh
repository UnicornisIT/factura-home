#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deployment/setup.sh
. "$(dirname "$0")/../setup.sh"
NODE="$(command -v node)"

fail() { printf '%s\n' "$*" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

new_admins() {
  RECONFIGURE=false
  DOMAIN=shop.example.test
  select_telegram <<'INPUT'
shop_bot
123:example_token
0
9007199254740992
100
2
100
200
200
300
INPUT
  [ "$SUPER_ADMIN_TELEGRAM_ID" = 100 ]
  [ "${ADMIN_IDS[*]}" = "200 300" ]
}

check_database() (
  WORK="$tmp"
  APP_DIR="$tmp"
  RECONFIGURE=false
  DB_DIALECT=mysql
  DB_MODE=remote
  DB_PASS=" #complex:/@%'\\value "
  DB_HOST=127.0.0.1
  DB_PORT=3306
  DB_NAME=shop
  DB_USER=factura
  mysql_app() {
    [ -s "$WORK/mysql.cnf" ] || fail "Expected MySQL client configuration"
    cat >"$tmp/probe.sql"
    grep -q 'CREATE TABLE' "$tmp/probe.sql"
    grep -q 'DROP TABLE' "$tmp/probe.sql"
  }
  prepare_database
  [[ "$DATABASE_URL" == *"%23complex"* ]] || fail "Expected encoded credentials"
  mysql_app() { return 1; }
  if (prepare_database) 2>"$tmp/db-error"; then fail "Broken DB accepted"; fi
  grep -q 'MySQL:' "$tmp/db-error"

  DB_DIALECT=sqlite
  SQLITE_PATH="$tmp/shop.db"
  app_exec() {
    [ "$*" = "$APP_DIR sqlite3 $SQLITE_PATH PRAGMA schema_version;" ]
  }
  prepare_database
)

check_nginx() (
  WORK="$tmp"
  DOMAIN=shop.example.test
  PORT=3090
  TLS_MODE=letsencrypt
  TLS_CERT=/etc/ssl/factura.pem
  TLS_KEY=/etc/ssl/factura.key
  render_nginx bootstrap
  grep -q 'acme-challenge/' "$WORK/nginx.conf"
  if grep -q 'proxy_pass' "$WORK/nginx.conf"; then fail "HTTP exposed before TLS"; fi
  render_nginx https
  grep -q 'client_max_body_size 6m' "$WORK/nginx.conf"
  grep -Fq "proxy_set_header Origin \$http_origin" "$WORK/nginx.conf"
  grep -Fq "proxy_set_header Cookie \$http_cookie" "$WORK/nginx.conf"
  grep -Fq "proxy_set_header X-Real-IP \$remote_addr;" "$WORK/nginx.conf"
  grep -q 'proxy_pass http://127.0.0.1:3090' "$WORK/nginx.conf"
  grep -q 'ssl_certificate /etc/ssl/factura.pem' "$WORK/nginx.conf"
  TLS_MODE=certificate
  render_nginx https
  if grep -q 'acme-challenge/' "$WORK/nginx.conf"; then fail "Unexpected ACME location"; fi
)

check_install() (
  RECONFIGURE="$1"
  local injected_failure="$2"
  local trace="$tmp/trace"
  : >"$trace"
  LOCK_FILE="$tmp/update.lock"
  APP_DIR="$tmp/current"
  ENV_FILE="$APP_DIR/app/.env"
  UNIT="$tmp/factura.service"
  UPDATER="$tmp/factura-update.sh"
  SUDOERS="$tmp/sudoers"
  UPDATE_CONFIG="$tmp/update.env"
  NGINX_SITE="$tmp/nginx.conf"
  NGINX_LINK="$tmp/nginx-enabled"
  RELEASE_REF=v0.0.1
  PUBLIC_ORIGIN=https://shop.example.test
  PORT=3000
  SEED=false
  ADMIN_IDS=(200 300)
  mkdir -p "$APP_DIR/app/db"
  touch "$APP_DIR/app/db/bootstrap-admins.ts"
  printf '0.0.1\n' >"$APP_DIR/VERSION"
  if "$RECONFIGURE"; then
    printf 'APP_SECRET=original\n' >"$ENV_FILE"
    printf 'previous unit\n' >"$UNIT"
    mkdir -p "$APP_DIR/app/dist" "$APP_DIR/app/node_modules/.bin"
    touch "$APP_DIR/app/dist/boot.js" "$APP_DIR/app/node_modules/.bin/tsx"
    chmod +x "$APP_DIR/app/node_modules/.bin/tsx"
  fi
  flock() { return 0; }
  install_packages() { :; }
  check_telegram() { :; }
  ensure_directories() { :; }
  clone_release() { printf 'clone\n' >>"$trace"; }
  app_git() { return 0; }
  prepare_database() { :; }
  check_existing_owner() { :; }
  backup_existing() { printf 'backup\n' >>"$trace"; }
  app_exec() { printf '%s\n' "$*" >>"$trace"; }
  write_env() { printf 'APP_SECRET=updated\n' >"$ENV_FILE"; }
  install_systemd() { printf 'new unit\n' >"$UNIT"; }
  install_updates() { :; }
  configure_nginx() { :; }
  verify_unlisted_login() { :; }
  systemctl() {
    printf '%s\n' "$*" >>"$trace"
    if [[ "$1" == is-* ]] && [ "$(wc -l <"$trace")" -lt 5 ]; then
      "$RECONFIGURE"
    fi
  }
  healthcheck() {
    printf 'health %s\n' "$1" >>"$trace"
    if "$injected_failure" && [ "$1" = "$PUBLIC_ORIGIN" ]; then die "Test health failure"; fi
  }
  local status=0
  set +e
  (set -e; install_factura) >"$tmp/output" 2>&1
  status=$?
  set -e
  if "$injected_failure"; then
    [ "$status" -ne 0 ] || fail "Expected install failure"
    grep -qx 'APP_SECRET=original' "$ENV_FILE"
    grep -qx 'previous unit' "$UNIT"
    grep -qx 'stop factura' "$trace"
    [ "$(grep -c '^start factura$' "$trace")" -eq 2 ]
    if grep -q 'db:bootstrap-admins --' "$trace"; then fail "Grants applied before healthcheck"; fi
  else
    [ "$status" -eq 0 ] || { cat "$tmp/output"; fail "Install failed"; }
    grep -q 'npm run db:migrate' "$trace"
    grep -q 'npm run db:bootstrap-admins -- 200 300' "$trace"
    grep -qx 'enable factura' "$trace"
    if "$RECONFIGURE"; then
      grep -qx backup "$trace"
      if grep -qx clone "$trace"; then fail "Reconfigure cloned the repo"; fi
    else
      grep -qx clone "$trace"
      grep -q 'npm run build' "$trace"
    fi
  fi
)

new_admins
check_database
check_nginx
check_install false false
check_install true false
check_install true true
printf '%s\n' "Setup wizard checks passed."
