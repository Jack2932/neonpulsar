# Frontend structure

## CSS
- `static/css/main.css` — базовая основа приложения
- `static/css/core/` — общие системные стили
- `static/css/themes/` — темы/скины
- `static/css/features/` — стили по функциональным зонам (`channels`, `servers`, `chat`, `emoji`, `billing`, `profile`, `settings`, `gifts`, `admin`, `account`, `calls`, `friends`, `ui`)

## JS
- `static/js/main.js` — главный runtime приложения
- `static/js/core/` — системные скрипты
- `static/js/auth/` — логин/пароль
- `static/js/features/` — скрипты по модулям (`chat`, `emoji`, `settings`, `calls`, `ui`, `menu`, `billing`, `gifts`, `account`, `profile`)

Все старые файлы с именами вида `fix***`, `patch***`, `nc_*` и разрозненные мелкие подключения были собраны в смысловые бандлы.


## Python backend layout

- `app.py` — thin local entrypoint only
- `wsgi.py` — production WSGI entrypoint
- `passenger_wsgi.py` — Beget/shared-hosting entrypoint
- `backend/application.py` — main Flask + Socket.IO application
- `backend/legacy/` — legacy snapshots kept out of the root
- `backend/entrypoints/` — optional launch helpers
- `tools/` — maintenance scripts
