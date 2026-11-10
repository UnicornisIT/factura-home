# Интеграционная проверка обновлятора на настоящем systemd

`deployment/tests/systemd-integration.sh` — сценарий, который восполняет то,
что не покрывают bash-фикстуры с заглушками: **настоящие** systemd,
`systemd-run`, `systemd-analyze verify`, `visudo`, sudoers, отдельный
Unix-пользователь и права файловой системы.

**Сценарий запускается ТОЛЬКО на одноразовой среде** (тестовая VM или
CI-runner). Встроенные защиты:

- обязательный флаг `--i-am-on-a-disposable-vm`;
- отказ при маркерах production (`/opt/factura/app/.env` или юнит
  `factura.service`);
- отказ без запущенного systemd;
- всё создаётся в изолированном пространстве имён (`factura-it`,
  `/opt/factura-it*`, `factura-it.service`, `/etc/sudoers.d/factura-it-update`)
  и удаляется trap-ом при выходе.

## Запуск в CI

Workflow `.github/workflows/systemd-integration.yml` выполняет сценарий на
каждый pull request (ubuntu-latest — VM с настоящим systemd).

## Запуск на тестовой VM вручную

Требования: Ubuntu 22.04+ c systemd, root-доступ, git, sqlite3, Node.js 22
(любой путь — передаётся `NODE_BIN`), интернет не нужен. В чекауте репозитория
должен быть выполнен `npm ci --prefix app` (нужен better-sqlite3).

```bash
sudo env REPO_ROOT=/путь/к/чекауту NODE_BIN="$(command -v node)" \
  bash deployment/tests/systemd-integration.sh --i-am-on-a-disposable-vm
```

Успех: `Результат: PASS=N FAIL=0` и итоговая строка
«Интеграция с настоящим systemd подтверждена». При падении печается хвост
журнала обновления; очистка стенда выполняется автоматически.

## Что проверяется (соответствие обязательным регрессиям)

| №   | Требование                                                                                   | Сценарий |
| --- | -------------------------------------------------------------------------------------------- | -------- |
| 1   | Root-owned BACKUP_DIR 700 недоступен пользователю приложения                                 | S1       |
| 2   | Backup API при активной WAL (незафиксированная транзакция не попадает в копию)               | S1, S3   |
| 3   | Резервное копирование с установленным sqlite3 CLI                                            | S1       |
| 4   | Резервное копирование без sqlite3 CLI через better-sqlite3 (NODE_PATH)                       | S3       |
| 5   | `PRAGMA integrity_check` копии                                                               | S1, S3   |
| 6   | Отказ резервного копирования отменяет обновление до изменения кода                           | S6       |
| 7   | Защищённая замена sudoers: битый шаблон не устанавливается, прежний файл цел                 | S4       |
| 8   | Реальный systemd-handoff из cgroup сервиса в transient unit; конкурентный запуск отклоняется | S1, S7   |

Дополнительно: S2 — идемпотентность («already up to date»), S5 — настоящий
`systemd-analyze verify` отклоняет битый шаблон юнита (проверка исправления с
суффиксом `.service`), откат подтверждается healthcheck и реальным ответом
сервиса.

## Как воспроизводится реальный поток

Тестовый сервис `factura-it.service` (node-«приложение» в cgroup systemd) по
запросу `POST /it-trigger` выполняет `spawn("sudo", ["-n", …])` — тот же путь,
что и `startUpdate()` в `app/api/lib/system-update.ts`. Скрипт обновления
обнаруживает cgroup сервиса и передаёт себя в настоящий transient unit
`systemd-run --unit=factura-update`, после чего обновление переживает
`systemctl restart factura-it` и пишется в root-каталоги вне mount namespace
сервиса.
