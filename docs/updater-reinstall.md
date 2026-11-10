# Однократная установка исправленного обновлятора (сервер v0.2.3+)

Скрипт `/usr/local/sbin/factura-update.sh` принадлежит root: изменения из GitHub
сами по себе не заменяют его на действующем сервере. Эта процедура выполняется
через SSH **один раз** для перехода на релиз с исправленным механизмом
обновления (v0.2.5+). Все последующие обновления выполняются кнопкой
«Обновить» в админ-панели без SSH.

Процедура не затрагивает базу данных (`/var/lib/factura/factura.db`),
изображения (`/var/lib/factura/uploads`), `app/.env` и администраторов
Telegram. Миграции применяются штатно (`npm run db:migrate`) и данные не
удаляют.

Переменные: репозиторий `/opt/factura`, сервис `factura`, пользователь
`factura`. Тег `vX.Y.Z` — целевой релиз с исправленным обновлятором.

## Шаг 0. Резервные копии root-файлов механизма

```bash
BK=~/factura-updater-$(date +%F-%H%M)
mkdir -p "$BK" && chmod 700 "$BK"
sudo cp /usr/local/sbin/factura-update.sh "$BK/factura-update.sh.prev"
sudo cp /etc/systemd/system/factura.service "$BK/factura.service.prev"
sudo cp /etc/sudoers.d/factura-update "$BK/sudoers.prev" 2>/dev/null || true
sudo -u factura git -C /opt/factura describe --tags --exact-match | tee "$BK/version-prev.txt"
sudo cp /opt/factura/app/.env "$BK/env.prev" && sudo chmod 600 "$BK/env.prev"
# Контрольная копия БД через Backup API (WAL-безопасно; простое cp недопустимо):
command -v sqlite3 >/dev/null || sudo apt-get install -y sqlite3
sudo sqlite3 /var/lib/factura/factura.db ".backup '$BK/factura.db'"
sudo sqlite3 "$BK/factura.db" "PRAGMA integrity_check;"   # ожидалось: ok
```

## Шаг 1. Репозиторий должен быть чистым

```bash
sudo -u factura git -C /opt/factura status --porcelain
```

Ожидаемо: пусто. При наличии правок — сначала заархивируйте их
(`git diff > "$BK/local.patch"`) и только потом откатите пофайлово
(`git checkout -- <файл>`). Обновлятор блокирует обновление при грязном дереве.

## Шаг 2. Код нового релиза

```bash
TAG=vX.Y.Z   # замените на целевой релиз
sudo -u factura git -C /opt/factura fetch --tags --force origin
sudo -u factura git -C /opt/factura checkout "$TAG"
sudo -u factura git -C /opt/factura describe --tags --exact-match   # = $TAG
sudo -u factura bash -c 'cd /opt/factura/app && npm ci'
sudo -u factura bash -c 'cd /opt/factura/admin && npm ci'
sudo -u factura bash -c 'cd /opt/factura/app && npm run build'
sudo -u factura bash -c 'cd /opt/factura/app && npm run db:migrate'
```

## Шаг 3. Root-файлы механизма из проверенного тега

```bash
# Скрипт обновления (атомарная замена через install):
sudo install -o root -g root -m 755 \
  /opt/factura/deployment/factura-update.sh /usr/local/sbin/factura-update.sh

# Unit-файл: сначала во временный файл с суффиксом .service, проверка, замена:
TMP=$(sudo mktemp /etc/systemd/system/.factura-XXXXXX.service)
sudo sed -e 's|@APP_DIR@|/opt/factura|g' \
  -e 's|@APP_USER@|factura|g' \
  -e 's|@RW_PATHS@|/var/lib/factura /var/log/factura|g' \
  /opt/factura/deployment/factura.service | sudo tee "$TMP" >/dev/null
sudo systemd-analyze verify "$TMP" && sudo chmod 644 "$TMP" && \
  sudo mv -f "$TMP" /etc/systemd/system/factura.service || sudo rm -f "$TMP"

# Sudoers (без env_keep, один разрешённый скрипт):
sudo sed -e 's|@UPDATE_SCRIPT@|/usr/local/sbin/factura-update.sh|' \
  /opt/factura/deployment/sudoers-factura-update | sudo tee /etc/sudoers.d/factura-update >/dev/null
sudo chown root:root /etc/sudoers.d/factura-update
sudo chmod 440 /etc/sudoers.d/factura-update
sudo visudo -cf /etc/sudoers.d/factura-update
```

Если каталог установки отличается от `/opt/factura` и `/opt/factura/current`,
корень задаётся root-конфигом (sudo вырезает окружение вызывающего):

```bash
sudo mkdir -p /etc/factura
echo 'FACTURA_APP_DIR=/путь/к/репозиторию' | sudo tee /etc/factura/update.env
sudo chown root:root /etc/factura/update.env && sudo chmod 600 /etc/factura/update.env
```

## Шаг 4. Перезапуск и проверка

```bash
sudo systemctl daemon-reload
sudo systemctl restart factura
curl -fsS http://127.0.0.1:3000/api/trpc/ping   # порт из app/.env
sudo -u factura sudo -n -l /usr/local/sbin/factura-update.sh   # sudoers виден пользователю сервиса
```

Проверка в панели (`/admin/server-update`, super_admin):

1. «Текущая версия» = `$TAG`, статус «установлена последняя версия».
2. Ошибка прошлой операции (если была) отображается только в блоке
   «Последняя операция (история)» с пометкой, что она устарела.
3. Контрольный прогон обновлятора без изменения версии:

```bash
sudo /usr/local/sbin/factura-update.sh
sudo cat /var/lib/factura/update-status.json
# ожидалось: {"state":"success",...,"message":"already up to date",...}
sudo tail -n 30 /var/log/factura/update.log
```

## Откат процедуры

```bash
sudo -u factura git -C /opt/factura checkout "$(cat "$BK/version-prev.txt")"
sudo -u factura bash -c 'cd /opt/factura/app && npm ci && npm run build'
sudo install -o root -g root -m 755 "$BK/factura-update.sh.prev" /usr/local/sbin/factura-update.sh
sudo cp "$BK/factura.service.prev" /etc/systemd/system/factura.service
sudo cp "$BK/sudoers.prev" /etc/sudoers.d/factura-update 2>/dev/null || true
sudo chmod 440 /etc/sudoers.d/factura-update 2>/dev/null || true
sudo systemctl daemon-reload && sudo systemctl restart factura
```

База данных не откатывается: миграции новых версий добавляют столбцы/таблицы
и совместимы со старым кодом в пределах соседних релизов. При необходимости
полного возврата БД: `sudo cp "$BK/factura.db" /var/lib/factura/factura.db`
(только при остановленном сервисе и только если новые заказы после обновления
не нужны — иначе будут потеряны).

## Аварийное восстановление после сбоя кнопки «Обновить»

1. Статус и причина: `sudo cat /var/lib/factura/update-status.json`,
   журнал `sudo tail -n 100 /var/log/factura/update.log`.
2. Сервис не поднимается: `sudo systemctl status factura`,
   `journalctl -u factura -n 100`.
3. Последняя резервная копия: `sudo ls -lt /var/backups/factura | head`.
   Внутри — `backup-meta.txt` (версия до обновления), `db.sqlite`, `env.backup`,
   `uploads/`, `factura-update.sh.backup`, `service.backup`, `sudoers.backup`.
4. Возврат кода: `sudo -u factura git -C /opt/factura checkout <currentRef из
backup-meta.txt> && sudo -u factura bash -c 'cd /opt/factura/app && npm ci &&
npm run build' && sudo systemctl restart factura`.
5. БД из резервной копии восстанавливайте только осознавая потерю данных,
   созданных после обновления (см. «Откат процедуры»).
