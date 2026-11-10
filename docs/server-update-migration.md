# Одноразовый переход сервера v0.1.1 → v0.2.2 (исправленный механизм обновления)

Инструкция для production-сервера с установленным проектом в `/opt/factura`
(v0.1.1, локальные правки исходников, старый сломанный обновлятор). Все
команды выполняются администратором через SSH **один раз**; после перехода
обновления выполняются только кнопкой в админ-панели.

Принципы перехода:

- все локальные изменения сначала архивируются **вне** рабочего дерева, и только
  потом откатываются — пофайлово, никаких безусловных `git checkout -- .`,
  `git reset --hard` и `git clean`;
- существующие `.env`, база данных, SSH-настройки и конфигурация сервера
  сохраняются: правятся только отдельные строки, файлы не пересоздаются;
- `SERVER_UPDATE_TOKEN` не переименовывается «вслепую»: сначала проверяется,
  какое из значений является рабочим PAT.

Переменные ниже: репозиторий `/opt/factura`, сервис `factura`, пользователь
приложения `factura`, администратор `vaanedain`. Уточните владельца репозитория:

```bash
stat -c '%U:%G %n' /opt/factura /opt/factura/app/.env
REPO_USER=$(stat -c %U /opt/factura)
```

Далее команды используют `sudo -u "$REPO_USER"` — git должен работать от
владельца репозитория (иначе `dubious ownership`).

## Шаг 0. Резервные копии (вне рабочего дерева)

```bash
BK=~/factura-migration-$(date +%F-%H%M)
mkdir -p "$BK" && chmod 700 "$BK"

# База данных (MySQL):
sudo mysqldump --single-transaction --default-character-set=utf8mb4 factura > "$BK/db.sql"
# или SQLite:
# sudo cp /var/lib/factura/factura.db "$BK/factura.db"

# Конфигурация и системные файлы:
sudo cp /opt/factura/app/.env "$BK/env.backup" && sudo chmod 600 "$BK/env.backup"
sudo cp /etc/systemd/system/factura.service "$BK/factura.service.backup"
sudo cp /etc/sudoers.d/factura-update "$BK/sudoers.backup" 2>/dev/null || true

# Все локальные изменения репозитория — до какого-либо отката:
sudo -u "$REPO_USER" git -C /opt/factura status --porcelain | tee "$BK/local-status.txt"
sudo -u "$REPO_USER" git -C /opt/factura diff | tee "$BK/local-changes.patch"
sudo -u "$REPO_USER" git -C /opt/factura rev-parse HEAD | tee "$BK/local-head.txt"
# Копия изменённых и «горячих» файлов (включая *.bak) архивом:
cd /opt/factura && sudo tar czf "$BK/local-files.tgz" \
  $(sudo -u "$REPO_USER" git -C /opt/factura status --porcelain | awk '{print $2}') \
  $(ls app/api/lib/*.bak 2>/dev/null) 2>/dev/null || true
```

Проверьте, что `$BK/local-files.tgz` и дампы созданы, прежде чем идти дальше.

## Шаг 1. Ревизия и пофайловый откат локальных правок

Просмотрите `$BK/local-status.txt` и `$BK/local-changes.patch`. Типичные
временные правки v0.1.1: `app/api/lib/system-update.ts` (+ `.bak`-копия) и
подобные hotfix-и — в v0.2.2 они заменены штатным кодом. Откатывайте **только
файлы, которые сознательно решили вернуть к релизу**, по одному:

```bash
sudo -u "$REPO_USER" git -C /opt/factura checkout -- app/api/lib/system-update.ts
# ... другие файлы из local-status.txt после просмотра diff ...
sudo rm -f /opt/factura/app/api/lib/system-update.ts.bak   # уже в local-files.tgz
```

Если правку нужно сохранить — перенесите её в `$BK` и при необходимости
оформите как commit в репозитории разработки (не на сервере).

Критерий готовности: вывод пуст.

```bash
sudo -u "$REPO_USER" git -C /opt/factura status --porcelain
```

## Шаг 2. Ревизия токенов в .env (без слепого переименования)

Посмотрите текущие значения:

```bash
sudo grep -nE '^(SERVER_UPDATE_TOKEN|GITHUB_TOKEN)=' /opt/factura/app/.env
```

Проверьте каждое значение как PAT (код 200 = токен рабочий; 401 = недействителен;
токен не попадает в аргументы процессов — используется config-файл):

```bash
check_token() {
  sudo bash -c "TOKEN=\$(grep '^$1=' /opt/factura/app/.env | cut -d= -f2-)
    [ -n \"\$TOKEN\" ] || { echo '$1: пусто'; exit; }
    printf 'header = \"Authorization: Bearer %s\"\n' \"\$TOKEN\" > /tmp/.t && chmod 600 /tmp/.t
    printf '$1: %s\n' \"\$(curl -sS --config /tmp/.t -o /dev/null -w '%{http_code}' \
      -H 'Accept: application/vnd.github+json' \
      https://api.github.com/repos/UnicornisIT/factura-home/releases/latest)\"
    shred -u /tmp/.t 2>/dev/null || rm -f /tmp/.t"
}
check_token GITHUB_TOKEN
check_token SERVER_UPDATE_TOKEN
```

Решение по результату:

- `GITHUB_TOKEN: 200` — оставить как есть; строку `SERVER_UPDATE_TOKEN=` удалить:
  `sudo sed -i '/^SERVER_UPDATE_TOKEN=/d' /opt/factura/app/.env`
- `GITHUB_TOKEN` пуст/не 200, а `SERVER_UPDATE_TOKEN: 200` — перенести рабочее
  значение: `sudo sed -i 's/^SERVER_UPDATE_TOKEN=/GITHUB_TOKEN=/' /opt/factura/app/.env`
  (если строка `GITHUB_TOKEN=` уже есть — сначала удалите её, затем
  переименуйте рабочую).
- Оба не работают — выпустить новый fine-grained PAT (Contents: Read-only,
  Metadata: Read-only на `UnicornisIT/factura-home`) и вписать в `GITHUB_TOKEN=`.

Итоговая проверка конфигурации обновления (значение токена маскируется):

```bash
sudo grep -E '^(SERVER_UPDATE_ENABLED|SERVER_UPDATE_REPOSITORY|SERVER_UPDATE_SCRIPT|SERVER_UPDATE_STATUS_PATH|GITHUB_TOKEN)=' /opt/factura/app/.env | sed 's/^\(GITHUB_TOKEN=\).\{4\}.*/\1****/'
```

Ожидаемо: `SERVER_UPDATE_ENABLED=true`, `SERVER_UPDATE_REPOSITORY=UnicornisIT/factura-home`,
`SERVER_UPDATE_SCRIPT=/usr/local/sbin/factura-update.sh`,
`SERVER_UPDATE_STATUS_PATH=/var/lib/factura/update-status.json`, `GITHUB_TOKEN=****`.
Права `.env` — `640`, группа = пользователь сервиса (проверка:
`sudo -u factura test -r /opt/factura/app/.env && echo OK`).

## Шаг 3. Git-доступ (сохраняя существующие SSH-настройки)

Посмотрите текущий remote:

```bash
sudo -u "$REPO_USER" git -C /opt/factura remote -v
sudo -u "$REPO_USER" git -C /opt/factura config --get core.sshCommand || true
```

Новый скрипт выполняет git от владельца репозитория; SSH-псевдоним
`github-factura` из `~/.ssh/config` администратора ему недоступен. Выберите
вариант (существующие ключи **копируются**, а не перемещаются; `~/.ssh`
администратора остаётся нетронутым):

### Вариант A — текущий deploy key (SSH)

```bash
# Ключ, на который ссылается псевдоним github-factura:
grep -A3 'github-factura' ~/.ssh/config    # найдите IdentityFile
sudo mkdir -p /var/lib/factura/keys
sudo install -m 600 -o "$REPO_USER" -g "$REPO_USER" \
  ~/.ssh/factura_home_deploy /var/lib/factura/keys/factura_deploy
sudo ssh-keyscan -t ed25519,ecdsa,rsa github.com \
  | sudo tee /var/lib/factura/keys/known_hosts >/dev/null
sudo chown "$REPO_USER" /var/lib/factura/keys/known_hosts
sudo chmod 600 /var/lib/factura/keys/known_hosts
sudo -u "$REPO_USER" git -C /opt/factura remote set-url origin \
  git@github.com:UnicornisIT/factura-home.git
sudo -u "$REPO_USER" git -C /opt/factura config core.sshCommand \
  "ssh -i /var/lib/factura/keys/factura_deploy -o UserKnownHostsFile=/var/lib/factura/keys/known_hosts -o IdentitiesOnly=yes"
```

### Вариант B — HTTPS + PAT (тот же GITHUB_TOKEN)

```bash
sudo -u "$REPO_USER" git -C /opt/factura remote set-url origin \
  https://github.com/UnicornisIT/factura-home.git
sudo bash -c "umask 077; printf 'https://x-access-token:%s@github.com\n' \
  \"\$(grep '^GITHUB_TOKEN=' /opt/factura/app/.env | cut -d= -f2-)\" \
  > /var/lib/factura/.git-credentials"
sudo chown "$REPO_USER" /var/lib/factura/.git-credentials
sudo -u "$REPO_USER" git -C /opt/factura config credential.helper \
  'store --file=/var/lib/factura/.git-credentials'
```

Проверка доступа (должен вывести SHA HEAD):

```bash
sudo -u "$REPO_USER" git -C /opt/factura ls-remote --exit origin HEAD
```

## Шаг 4. Одноразовое ручное обновление до v0.2.2

```bash
sudo -u "$REPO_USER" git -C /opt/factura fetch --tags --force origin
sudo -u "$REPO_USER" git -C /opt/factura checkout v0.2.2
# контроль: рабочее дерево чистое и точно на теге
sudo -u "$REPO_USER" git -C /opt/factura describe --tags --exact-match   # v0.2.2
sudo -u "$REPO_USER" git -C /opt/factura status --porcelain              # пусто

sudo -u "$REPO_USER" bash -c 'cd /opt/factura/app && npm ci'
sudo -u "$REPO_USER" bash -c 'cd /opt/factura/admin && npm ci'
sudo -u "$REPO_USER" bash -c 'cd /opt/factura/app && npm run build'
sudo -u "$REPO_USER" bash -c 'cd /opt/factura/app && npm run db:migrate'
```

## Шаг 5. Deployment-файлы из нового тега

```bash
sudo install -o root -g root -m 755 \
  /opt/factura/deployment/factura-update.sh /usr/local/sbin/factura-update.sh

# Юнит из шаблона v0.2.2 (полная замена кастомного: NoNewPrivileges=true
# блокирует sudo, а запись в /usr/local/sbin из-под сервиса — дыра в привилегиях):
sudo sed -e 's|@APP_DIR@|/opt/factura|g' \
  -e 's|@APP_USER@|factura|g' \
  -e 's|@RW_PATHS@|/var/lib/factura /var/log/factura|g' \
  /opt/factura/deployment/factura.service \
  | sudo tee /etc/systemd/system/factura.service >/dev/null

# Sudoers из шаблона v0.2.2 (без env_keep):
sudo sed -e 's|@UPDATE_SCRIPT@|/usr/local/sbin/factura-update.sh|' \
  /opt/factura/deployment/sudoers-factura-update \
  | sudo tee /etc/sudoers.d/factura-update >/dev/null
sudo chown root:root /etc/sudoers.d/factura-update
sudo chmod 440 /etc/sudoers.d/factura-update
sudo visudo -cf /etc/sudoers.d/factura-update

sudo mkdir -p /var/lib/factura /var/log/factura /var/backups/factura
sudo chown -R factura:factura /var/lib/factura /var/log/factura
sudo chmod 700 /var/backups/factura

sudo systemctl daemon-reload
sudo systemctl restart factura
curl -fsS http://127.0.0.1:3000/api/trpc/ping
```

Если раскладка отличается от `/opt/factura` и `/opt/factura/current`, задайте
корень установки root-конфигом (sudo вырезает окружение вызывающего):

```bash
sudo mkdir -p /etc/factura
echo 'FACTURA_APP_DIR=/путь/к/репозиторию' | sudo tee /etc/factura/update.env
sudo chown root:root /etc/factura/update.env && sudo chmod 600 /etc/factura/update.env
```

Шаблон юнита уже содержит опциональный `EnvironmentFile=-/etc/factura/factura.env`
— отдельный конфиг сервера сохраняется и продолжает работать.

## Шаг 6. Проверка

1. `systemctl status factura` — сервис активен.
2. Витрина и `/admin/` открываются; `curl` на `/api/trpc/ping` → 200.
3. `/admin/server-update` (super_admin): текущая версия **v0.2.2**, последний
   релиз отображается без ошибок GitHub API.
4. Со следующего релиза обновление выполняется только кнопкой.

## Откат перехода

Все исходные файлы — в `$BK`:

```bash
sudo -u "$REPO_USER" git -C /opt/factura checkout v0.1.1   # или SHA из local-head.txt
sudo cp "$BK/env.backup" /opt/factura/app/.env && sudo chown root:factura /opt/factura/app/.env && sudo chmod 640 /opt/factura/app/.env
sudo cp "$BK/factura.service.backup" /etc/systemd/system/factura.service
sudo systemctl daemon-reload && sudo systemctl restart factura
# БД — только при необходимости: mysql factura < "$BK/db.sql"
```

Локальные правки при необходимости возвращаются из `$BK/local-changes.patch`
(`git apply`) — но в production они не поддерживаются: следующий запуск
обновления заблокируется, пока дерево не будет чистым.
