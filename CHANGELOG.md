# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [0.1.0] - 2026-11-09

### Добавлено

- Магазин: витрина, админ-панель, API (Hono/tRPC), вход через Telegram Login Widget.
- Конструктор главной страницы из блоков с собственными цветами фона.
- Заказы, загрузка изображений с перекодированием в WebP, роли и журнал доступа.
- Скрипт первоначальной настройки сервера `deployment/setup.sh` (компоненты, `.env`, systemd).
- Обновление до последнего релиза из админ-панели (super_admin) через `deployment/glina-update.sh`.
- Релизный workflow: тег `v*` публикует GitHub Release.
