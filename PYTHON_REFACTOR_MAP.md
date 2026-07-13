# Python refactor map

## What changed

The Python backend was moved out of the project root so the root stays clean.
Only thin entrypoints remain in the root:

- `app.py` — local start/run entrypoint
- `wsgi.py` — gunicorn / production entrypoint
- `passenger_wsgi.py` — Beget shared-hosting entrypoint
- `run_with_electron.py` — compatibility wrapper for the Electron launcher

## New backend layout

- `backend/application.py` — main Flask + Socket.IO app
- `backend/legacy/app_blockdedent.py` — moved legacy snapshot
- `backend/legacy/app_dedent.py` — moved legacy snapshot
- `backend/entrypoints/run_with_electron.py` — moved Electron launcher
- `tools/` — maintenance scripts

## Notes

- Database, templates, static, deploy and tools folders stayed in place.
- `backend/application.py` now points Flask explicitly at the project-level
  `templates/` and `static/` folders.
- `BASE_DIR` inside the moved backend app now resolves to the project root.
