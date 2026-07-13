# Beget shared hosting (Passenger WSGI)

Files used:
- `passenger_wsgi.py` — Passenger entrypoint
- `wsgi.py` — WSGI app export
- `requirements.txt` — dependencies

## 1) Upload project
Put the project into the site directory.

## 2) Virtualenv
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 3) Entry point
Configure Passenger to use `passenger_wsgi.py`.

## 4) Environment
Recommended:
- `SECRET_KEY`
- `PREFERRED_URL_SCHEME=https`
- `SOCKETIO_ASYNC_MODE=threading`

## 5) Note
Shared hosting usually does not support a full separate websocket stack like VPS.
Passenger + threading mode is the safer option there.
For full nginx/systemd/gunicorn deployment use the VPS flow instead.
