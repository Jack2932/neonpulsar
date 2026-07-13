"""WSGI entrypoint for production servers such as gunicorn."""

from backend import create_app, socketio  # noqa: F401

app = create_app()
application = app
