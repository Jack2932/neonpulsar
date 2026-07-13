import os

bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:5000")
workers = int(os.environ.get("GUNICORN_WORKERS", "1") or 1)
worker_class = os.environ.get(
    "GUNICORN_WORKER_CLASS",
    "geventwebsocket.gunicorn.workers.GeventWebSocketWorker",
)
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120") or 120)
graceful_timeout = int(os.environ.get("GUNICORN_GRACEFUL_TIMEOUT", "30") or 30)
keepalive = int(os.environ.get("GUNICORN_KEEPALIVE", "25") or 25)
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info").lower()
max_requests = int(os.environ.get("GUNICORN_MAX_REQUESTS", "1000") or 1000)
max_requests_jitter = int(os.environ.get("GUNICORN_MAX_REQUESTS_JITTER", "100") or 100)
worker_tmp_dir = "/dev/shm"
forwarded_allow_ips = os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1")
