# -*- coding: utf-8 -*-
"""Passenger entrypoint for shared hosting environments."""
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault("PYTHONUNBUFFERED", "1")
os.environ.setdefault("PREFERRED_URL_SCHEME", "https")
os.environ.setdefault("SOCKETIO_ASYNC_MODE", os.environ.get("SOCKETIO_ASYNC_MODE", "threading"))

from wsgi import application  # noqa: E402,F401
