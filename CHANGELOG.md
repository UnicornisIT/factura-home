# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [0.1.1] - 2026-11-09

### Изменено

- Технические идентификаторы `glina` заменены на `factura`: пакеты `factura-shop` и `factura-shop-admin`, cookie `factura_admin_sid`, сервис `factura.service`, скрипты `deployment/factura-update.sh` и `deployment/setup.sh`, пути `/opt/factura`, `/var/lib/factura`, `/var/log/factura`, `/var/backups/factura`, база и пользователь MySQL, тестовая БД CI. Бренд «Глиняная мастерская» в интерфейсе сохранён.
- Скрипт обновления автоматически переустанавливает себя и systemd-юнит из нового тега (атомарно, с резервной копией); при откате предыдущие версии файлов деплоя восстанавливаются.

## [0.1.0] - 2026-11-09

### Добавлено

- Магазин: витрина, админ-панель, API (Hono/tRPC), вход через Telegram Login Widget.
- Конструктор главной страницы из блоков с собственными цветами фона.
- Заказы, загрузка изображений с перекодированием в WebP, роли и журнал доступа.
- Скрипт первоначальной настройки сервера `deployment/setup.sh` (компоненты, `.env`, systemd).
- Обновление до последнего релиза из админ-панели (super_admin) через `deployment/factura-update.sh`.
- Релизный workflow: тег `v*` публикует GitHub Release.
