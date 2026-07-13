# NeonChat production checklist

## One process model
Use **one** production runner only:
- nginx -> gunicorn -> wsgi:app
- do **not** run `python app.py` in parallel on the same port

## Quick commands
```bash
sudo cp deploy/neonchat.service /etc/systemd/system/neonchat.service
sudo cp deploy/nginx_neonchat.conf /etc/nginx/sites-available/neonchat.conf
sudo systemctl daemon-reload
sudo systemctl enable neonchat
sudo systemctl restart neonchat
sudo nginx -t && sudo systemctl reload nginx
```

## Health checks
```bash
curl -s http://127.0.0.1:5000/healthz
curl -s http://127.0.0.1:5000/readyz
curl -i "http://127.0.0.1:5000/socket.io/?EIO=4&transport=polling"
systemctl status neonchat --no-pager
journalctl -u neonchat -n 100 --no-pager
ss -ltnp | grep :5000
```

`/healthz` is a lightweight process check.
`/readyz` also verifies database access and returns `503` if the app is not ready.

## Static/media
Make sure nginx serves these directly:
- `/static/`
- `/media/`

If static goes through Flask, the app will feel much heavier and can time out.

## Common pitfalls
- `Address already in use` -> another runner already owns port 5000.
- endless loading -> backend timed out or socket.io websocket/polling is not proxied correctly.
- app works locally but not on server -> check systemd env vars and nginx alias paths.

## Useful headers
Every response now includes:
- `X-Request-ID`
- `X-Response-Time-Ms`

Slow requests above `SLOW_REQUEST_MS` are logged into journald/gunicorn output.
