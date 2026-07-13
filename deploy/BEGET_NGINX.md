# Beget VPS / generic nginx deploy

## 1) Virtualenv
```bash
cd /var/www/myflask
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Optional but recommended for Linux production mode used in this project:
pip install gevent gevent-websocket
```

## 2) Environment
```bash
cp deploy/neonchat.env.example deploy/neonchat.env
nano deploy/neonchat.env
```

## 3) systemd service
Edit `deploy/neonchat.service`:
- `User`
- `Group`
- `WorkingDirectory`
- `ExecStart` path to your virtualenv

Then install it:
```bash
sudo cp deploy/neonchat.service /etc/systemd/system/neonchat.service
sudo systemctl daemon-reload
sudo systemctl enable neonchat
sudo systemctl restart neonchat
sudo systemctl status neonchat --no-pager
```

## 4) nginx
Copy `deploy/nginx_neonchat.conf` and adapt:
- domain names
- certificate paths
- `alias /var/www/myflask/static/`
- `alias /var/www/myflask/media/`

Do not forget the `map $http_upgrade $connection_upgrade` declaration in `http {}`.

Check and reload:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 5) Health checks
```bash
curl -I http://127.0.0.1:5000/app
curl -i "http://127.0.0.1:5000/socket.io/?EIO=4&transport=polling"
systemctl status neonchat --no-pager
journalctl -u neonchat -n 80 --no-pager
```

## Important
Production should be:
- nginx -> gunicorn -> `wsgi:app`
- not `python app.py`
