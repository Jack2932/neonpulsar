from __future__ import annotations
import os
import uuid
import secrets
import json
import re
import mimetypes
import time
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone

# --- Time helpers (UTC, timezone-aware) ---
def utcnow() -> datetime:
    """Timezone-aware UTC timestamp (replacement for deprecated utcnow())."""
    return datetime.now(timezone.utc)

import base64
import hmac
import hashlib
import io
import csv
import urllib.request
import urllib.error
import urllib.parse
import ipaddress

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None

from flask import Flask, render_template, redirect, url_for, request, flash, jsonify, session, send_file, abort, g

# --- Default avatar presets (v32+) ---
# Build preset list dynamically from static/avatars so new preset_*.png files
# can be dropped in without code changes.
def _load_preset_avatar_files(base_dir: str):
    folder = os.path.join(base_dir, "static", "avatars")
    out = []
    try:
        for fn in os.listdir(folder):
            low = fn.lower()
            if not low.startswith("preset_"):
                continue
            if not low.endswith((".png", ".jpg", ".jpeg", ".webp")):
                continue
            # If the user later adds seasonal presets, exclude them automatically.
            if any(k in low for k in ("new", "year", "ny", "xmas", "christ", "snow")):
                continue
            out.append(f"avatars/{fn}")
    except Exception:
        out = []

    if not out:
        out = [f"avatars/preset_{i:02d}.png" for i in range(1, 11)]
    return sorted(set(out))

# BASE_DIR is defined later; we init PRESET_AVATAR_FILES in create_app().
PRESET_AVATAR_FILES = []

def _pick_preset_avatar_url():
    """Return a static URL for a random preset avatar.

    Safe to call within a request context.
    """
    try:
        if not PRESET_AVATAR_FILES:
            return url_for("static", filename="avatars/default.png")
        return url_for("static", filename=secrets.choice(PRESET_AVATAR_FILES))
    except Exception:
        try:
            return url_for("static", filename="avatars/default.png")
        except Exception:
            return "/static/avatars/default.png"

from flask_sqlalchemy import SQLAlchemy

from flask_login import (
    LoginManager,
    login_user,
    login_required,
    logout_user,
    current_user,
    UserMixin,
)
from flask_socketio import SocketIO, join_room, emit, leave_room

from sqlalchemy import text
from sqlalchemy import or_, and_, func, case, cast, String

from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix

from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from sqlalchemy import text

# 2FA (TOTP) for Google Authenticator-compatible apps
try:
    import pyotp
except Exception:
    pyotp = None

try:
    import qrcode
except Exception:
    qrcode = None

# --- config / init ---

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)

db = SQLAlchemy()
login_manager = LoginManager()

def _pick_socketio_async_mode() -> str:
    # Allow override via env var: SOCKETIO_ASYNC_MODE=threading|eventlet|gevent
    forced = os.environ.get("SOCKETIO_ASYNC_MODE")
    if forced:
        return forced.strip()

    # eventlet is not reliable on Windows; default to threading there.
    if os.name == "nt":
        return "threading"

    # Prefer gevent on Linux hosts (works well with Gunicorn + GeventWebSocketWorker).
    try:
        import gevent  # noqa: F401
        return "gevent"
    except Exception:
        pass

    # Fall back to eventlet if present, otherwise use threading.
    try:
        import eventlet  # noqa: F401
        return "eventlet"
    except Exception:
        return "threading"

socketio = SocketIO(async_mode=_pick_socketio_async_mode(), manage_session=False)

# =============================
# Background-task Flask context
# =============================
# Some SocketIO/eventlet background tasks run outside of a Flask application
# context. Any DB access through Flask-SQLAlchemy needs an app context.
# We store a reference to the created Flask app and use it to enter an
# application context when a background task touches the DB.
_BG_APP = None

def _set_bg_app(app: Flask) -> None:
    global _BG_APP
    _BG_APP = app

# map user_id -> set of socket ids
user_sids = {}

# presence tracking (live online/offline + last activity)
# user_id -> last heartbeat timestamp (UTC)
presence_last_beat: dict[int, datetime] = {}
_presence_task_started = False

group_calls = {}

# channel_id -> {user_id: True} screenshare intent (prevents phantom demo tiles)
group_screen_intents: dict[int, dict[int, bool]] = {}

# (channel_id, user_id) -> last reaction time (seconds)
group_reaction_rl: dict[tuple[int,int], float] = {}



# (channel_id) -> {user_id: status} call status for group calls (online/busy/ghost)
group_call_status: dict[int, dict[int, str]] = {}

# rate limit: (channel_id, user_id) -> last whiteboard emit time
group_whiteboard_rl: dict[tuple[int,int], float] = {}


# Ad-hoc (DM) group call invite host mapping: channel_id -> host user_id
adhoc_group_hosts = {}

# --- Ad-hoc (DM) group call temporary chat (Discord-like) ---
# Lifetime: 24 hours from creation (in-memory only).
# channel_id -> {"created_at": datetime, "expires_at": datetime, "title": str,
#                "members": set[int], "messages": list[dict], "last_id": int}
adhoc_group_chats: dict[int, dict] = {}

def _adhoc_gc_room(channel_id: int) -> str:
    return f"adhoc_gc_{int(channel_id)}"

def _cleanup_expired_adhoc_group_chats(now: datetime | None = None) -> None:
    """Remove expired ad-hoc group chats (24h TTL)."""
    try:
        now = now or datetime.now(timezone.utc)
    except Exception:
        now = utcnow().replace(tzinfo=timezone.utc)
    expired_ids = []
    for cid, st in list(adhoc_group_chats.items()):
        try:
            exp = st.get("expires_at")
            if exp and exp <= now:
                expired_ids.append(int(cid))
        except Exception:
            expired_ids.append(int(cid))
    for cid in expired_ids:
        try:
            st = adhoc_group_chats.pop(int(cid), None) or {}
            members = list(st.get("members") or [])
            # Notify online members to remove the temporary chat entry
            for uid in members:
                try:
                    _emit_to_user(int(uid), "adhoc_group_chat_deleted", {"channel_id": int(cid)})
                except Exception:
                    pass
        except Exception:
            pass

_adhoc_gc_task_started = False

def _adhoc_gc_sweeper(app: Flask):
    """Periodically cleanup expired ad-hoc group chats (runs forever)."""
    while True:
        try:
            with app.app_context():
                _cleanup_expired_adhoc_group_chats()
        except Exception:
            try:
                _cleanup_expired_adhoc_group_chats()
            except Exception:
                pass
        # every 5 minutes
        try:
            time.sleep(300)
        except Exception:
            break


def _adhoc_group_chat_list_for_user(user_id: int) -> list[dict]:
    """Return list of active ad-hoc group chats visible to the user (in-memory)."""
    _cleanup_expired_adhoc_group_chats()
    out = []
    try:
        uid = int(user_id)
    except Exception:
        return out
    now = datetime.now(timezone.utc)
    for cid, st in list(adhoc_group_chats.items()):
        try:
            cid_i = int(cid)
        except Exception:
            continue
        try:
            members = set(st.get("members") or set())
        except Exception:
            members = set()
        if uid not in members:
            continue
        try:
            exp = st.get("expires_at")
            if exp and exp <= now:
                continue
        except Exception:
            pass
        try:
            title = st.get("title") or "Групповой звонок"
        except Exception:
            title = "Групповой звонок"
        try:
            host_id = int(adhoc_group_hosts.get(cid_i) or 0)
        except Exception:
            host_id = 0
        try:
            count = len(members)
        except Exception:
            count = 0
        out.append({
            "channel_id": cid_i,
            "title": str(title),
            "expires_at": (st.get("expires_at").isoformat() if st.get("expires_at") else ""),
            "member_count": len(st.get("members") or []),
            "host_id": host_id,
            "member_count": int(count),
        })
    return out

def _emit_adhoc_group_chat_list(user_id: int):
    try:
        payload = {"chats": _adhoc_group_chat_list_for_user(int(user_id))}
        _emit_to_user(int(user_id), "adhoc_group_chat_list", payload)
    except Exception:
        pass

def _ensure_adhoc_group_chat(channel_id: int, title: str, members: set[int]) -> dict:
    """Create or refresh (if expired) a temporary ad-hoc group chat."""
    _cleanup_expired_adhoc_group_chats()
    now = datetime.now(timezone.utc)
    st = adhoc_group_chats.get(int(channel_id))
    if not st:
        st = {
            "created_at": now,
            "expires_at": now + timedelta(hours=24),
            "title": str(title or "Групповой звонок"),
            "members": set(),
            "messages": [],
            "last_id": 0,
        }
        adhoc_group_chats[int(channel_id)] = st
    # Sliding TTL: extend on new activity (invite / call again / join / message)
    try:
        st["expires_at"] = now + timedelta(hours=24)
        st["touched_at"] = now
    except Exception:
        pass
    try:
        st["members"].update(set(int(x) for x in members if int(x) > 0))
    except Exception:
        pass
    if title:
        try:
            st["title"] = str(title)
        except Exception:
            pass
    return st

def _adhoc_group_chat_make_msg(channel_id: int, from_user_id: int, content: str, client_nonce: str | None = None) -> dict:
    st = adhoc_group_chats.get(int(channel_id))
    if not st:
        st = _ensure_adhoc_group_chat(int(channel_id), "Групповой звонок", {int(from_user_id)})
    try:
        st["last_id"] = int(st.get("last_id") or 0) + 1
    except Exception:
        st["last_id"] = 1
    msg_id = int(st["last_id"])
    from_name = None
    try:
        u = db.session.get(User, int(from_user_id))
        from_name = getattr(u, "username", None) or getattr(u, "name", None) or str(from_user_id)
    except Exception:
        from_name = str(from_user_id)
    ts = datetime.now(timezone.utc).isoformat()
    return {
        "id": msg_id,
        "channel_id": int(channel_id),
        "user_id": int(from_user_id),
        "username": from_name,
        "content": str(content or ""),
        "created_at": ts,
        "client_nonce": client_nonce or "",
        "kind": "adhoc_group",
    }


def _adhoc_group_chat_add_sys_call(channel_id: int, actor_user_id: int, kind: str, dur_sec: int | None = None) -> dict | None:
    """Append a Discord-like system call event into the temporary adhoc group chat.

    The client renderer understands messages whose content starts with '__sys_call__:'
    and will render them as compact call cards in the feed.
    """
    try:
        _cleanup_expired_adhoc_group_chats()
    except Exception:
        pass
    try:
        channel_id = int(channel_id)
        actor_user_id = int(actor_user_id or 0)
    except Exception:
        return None
    if not channel_id or not actor_user_id:
        return None
    st = adhoc_group_chats.get(int(channel_id))
    if not st:
        # create minimal state so the message can be displayed
        st = _ensure_adhoc_group_chat(int(channel_id), "Групповой звонок", {actor_user_id})
    # Touch TTL on call events (sliding 24h)
    try:
        now = datetime.now(timezone.utc)
        st["expires_at"] = now + timedelta(hours=24)
        st["touched_at"] = now
    except Exception:
        pass

    k = str(kind or "event").strip().lower()
    content = f"__sys_call__:{k}"
    if dur_sec is not None:
        try:
            content = content + f":{int(dur_sec)}"
        except Exception:
            pass
    msg = _adhoc_group_chat_make_msg(int(channel_id), int(actor_user_id), content, client_nonce="")
    # keep compatibility with existing renderer fields
    try:
        msg["from_id"] = int(actor_user_id)
        msg["user_name"] = msg.get("username")
        msg["system"] = True
    except Exception:
        pass
    try:
        st["messages"].append(msg)
        if len(st["messages"]) > 500:
            st["messages"] = st["messages"][-500:]
    except Exception:
        pass
    # emit to room + fallback per-member
    try:
        socketio.emit("adhoc_group_chat_message", msg, room=_adhoc_gc_room(int(channel_id)))
    except Exception:
        try:
            for uid in list(st.get("members") or []):
                _emit_to_user(int(uid), "adhoc_group_chat_message", msg)
        except Exception:
            pass
    return msg


# Voice state tracking for voice channels (Discord-like roster icons)
# channel_id -> { user_id -> {muted: bool, deafened: bool} }
voice_states: dict[int, dict[int, dict[str, bool]]] = {}

# --- Direct DM call reconnect (3-minute window) ---
DIRECT_CALL_RECONNECT_WINDOW_SEC = 3 * 60

# session_id -> {"deadline": datetime, "ended_by": int, "task_started": bool}
direct_call_reconnect: dict[int, dict] = {}

# user_id -> session_id (tracks last connected/active DM call)
direct_call_users: dict[int, int] = {}

# user_id -> socket sid that is currently associated with the DM call tab/flow
# (used to detect F5 reload race: new sid may connect before old sid disconnects)
direct_call_sid: dict[int, str] = {}

# session_id -> { user_id -> {muted: bool, deafened: bool} }
# Used for Discord-like mute/deafen badges in 1:1 DM calls.
direct_call_states: dict[int, dict[int, dict[str, bool]]] = {}

# session_id -> {"accum": int, "connected_started_at": Optional[datetime]}
direct_call_metrics: dict[int, dict] = {}

def _dc_metrics(session_id: int) -> dict:
    return direct_call_metrics.setdefault(int(session_id), {"accum": 0, "connected_started_at": None})

def _dc_mark_connected(session_id: int, now: datetime) -> None:
    m = _dc_metrics(session_id)
    m["connected_started_at"] = now

def _dc_mark_disconnected(session_id: int, now: datetime) -> None:
    m = direct_call_metrics.get(int(session_id))
    if not m:
        return
    started = m.get("connected_started_at")
    if started:
        m["accum"] = int(m.get("accum", 0) or 0) + int((now - started).total_seconds())
        m["connected_started_at"] = None

def _dc_duration_sec(session: "CallSession", now: datetime) -> int:
    m = direct_call_metrics.get(int(session.id))
    if m:
        dur = int(m.get("accum", 0) or 0)
        started = m.get("connected_started_at")
        if started:
            dur += int((now - started).total_seconds())
        return max(0, dur)
    if getattr(session, "call_started_at", None):
        return max(0, int((now - session.call_started_at).total_seconds()))
    return 0

def _dc_emit_reconnect_window(session_id: int, deadline: datetime) -> None:
    sess = db.session.get(CallSession, int(session_id))
    if not sess:
        return
    payload = {
        "session_id": int(session_id),
        "peer1": int(sess.user1_id),
        "peer2": int(sess.user2_id),
        "deadline_ms": int(deadline.timestamp() * 1000),
    }
    _emit_to_user(int(sess.user1_id), "call_reconnect_window", payload)
    _emit_to_user(int(sess.user2_id), "call_reconnect_window", payload)

def _dc_emit_clyde_notice(to_user_id: int, dm_channel_id: int, text_ru: str) -> None:
    now = utcnow()
    payload = {
        "id": -int(time.time() * 1000),
        "user": "Neon",
        "user_id": 0,
        "avatar_url": "/static/img/brand.png",
        "content": "__sys_clyde__:traffic:" + (text_ru or ""),
        "created_at": _fmt_msk(now),
        "created_day_key": _fmt_day_key_msk(now),
        "created_day_label": _fmt_day_label_ru(now),
        "channel_id": int(dm_channel_id),
        "attachments": [],
        "receipt": None,
        "edited_at": "",
        "deleted_at": "",
        "is_pinned": False,
        "pinned_by": 0,
        "reactions": {},
        "my_reactions": [],
    }
    _emit_to_user(int(to_user_id), "new_message", payload)

def _dc_finalize_after_deadline(session_id: int) -> None:
    """Finalize a DM call after the reconnect deadline.

    IMPORTANT: This is launched as a SocketIO/eventlet background task and
    therefore may run *outside* a Flask application context.
    """
    while True:
        info = direct_call_reconnect.get(int(session_id))
        if not info:
            return
        deadline = info.get("deadline")
        if not deadline:
            return

        now = utcnow()
        remaining = (deadline - now).total_seconds()
        if remaining > 0:
            socketio.sleep(min(1.0, remaining))
            continue

        # Re-check after sleep
        info = direct_call_reconnect.get(int(session_id))
        if not info:
            return
        deadline = info.get("deadline")
        if deadline and utcnow() < deadline:
            continue

        ended_by = int(info.get("ended_by") or 0)
        direct_call_reconnect.pop(int(session_id), None)

        # Enter Flask app context for DB access
        app = _BG_APP
        if app is None:
            return

        with app.app_context():
            try:
                sess = db.session.get(CallSession, int(session_id))
                if not sess:
                    direct_call_metrics.pop(int(session_id), None)
                    return

                now = utcnow()
                _dc_mark_disconnected(int(session_id), now)

                # mark inactive
                try:
                    if getattr(sess, "active", False):
                        sess.active = False
                        db.session.commit()
                except Exception:
                    db.session.rollback()

                # clear tracking
                direct_call_users.pop(int(sess.user1_id), None)
                direct_call_users.pop(int(sess.user2_id), None)
                direct_call_sid.pop(int(sess.user1_id), None)
                direct_call_sid.pop(int(sess.user2_id), None)

                # Notify waiting side with Clyde-like bot notice (ephemeral)
                try:
                    dm_ch = get_or_create_dm_channel(int(sess.user1_id), int(sess.user2_id))
                    wait_id = None
                    if ended_by:
                        wait_id = int(sess.user2_id) if int(sess.user1_id) == ended_by else int(sess.user1_id)

                    notice = (
                        "Похоже, что вы более 3 минут единолично занимали линию. "
                        "Служба контроля трафика попросила отключить вас для экономии. "
                        "Трафик счёт любит!"
                    )

                    if wait_id:
                        _dc_emit_clyde_notice(wait_id, dm_ch.id, notice)
                    else:
                        _dc_emit_clyde_notice(int(sess.user1_id), dm_ch.id, notice)
                        _dc_emit_clyde_notice(int(sess.user2_id), dm_ch.id, notice)
                except Exception:
                    pass

                # Log system call end/missed message to DM (persistent)
                try:
                    dm_ch = get_or_create_dm_channel(int(sess.user1_id), int(sess.user2_id))
                    dur_sec = int(_dc_duration_sec(sess, now))
                    connected = bool(getattr(sess, "call_started_at", None))
                    kind = "__sys_call__:ended" if connected else "__sys_call__:missed"
                    kind = f"{kind}:{dur_sec}"

                    author = db.session.get(User, ended_by) if ended_by else None
                    if not author:
                        author = db.session.get(User, int(sess.user1_id)) or db.session.get(User, int(sess.user2_id))

                    if author:
                        sys_msg = Message(channel_id=dm_ch.id, user_id=int(author.id), content=kind)
                        db.session.add(sys_msg)
                        db.session.commit()

                        sys_payload = {
                            "id": sys_msg.id,
                            "user": author.username,
                            "user_id": int(author.id),
                            "avatar_url": getattr(author, "avatar_url", "") or "",
                            "content": sys_msg.content,
                            "created_at": _fmt_msk(sys_msg.created_at),
                            "created_day_key": _fmt_day_key_msk(sys_msg.created_at),
                            "created_day_label": _fmt_day_label_ru(sys_msg.created_at),
                            "channel_id": dm_ch.id,
                            "attachments": [],
                            "receipt": None,
                            "edited_at": "",
                            "deleted_at": "",
                            "is_pinned": False,
                            "pinned_by": 0,
                            "reactions": {},
                            "my_reactions": [],
                        }
                        socketio.emit("new_message", sys_payload, to=f"channel_{dm_ch.id}")
                except Exception:
                    db.session.rollback()

                _emit_to_user(int(sess.user1_id), "call_reconnect_expired", {"session_id": int(session_id)})
                _emit_to_user(int(sess.user2_id), "call_reconnect_expired", {"session_id": int(session_id)})
                return
            finally:
                try:
                    db.session.remove()
                except Exception:
                    pass

def _dc_start_reconnect_window(session_id: int, ended_by: int = 0) -> datetime:
    now = utcnow()
    deadline = now + timedelta(seconds=int(DIRECT_CALL_RECONNECT_WINDOW_SEC))
    task_started = False
    existing = direct_call_reconnect.get(int(session_id))
    if existing:
        task_started = bool(existing.get("task_started"))
        if existing.get("deadline") and existing["deadline"] > now:
            deadline = existing["deadline"]

    direct_call_reconnect[int(session_id)] = {
        "deadline": deadline,
        "ended_by": int(ended_by or 0),
        "task_started": task_started,
    }
    _dc_emit_reconnect_window(int(session_id), deadline)

    if not task_started:
        direct_call_reconnect[int(session_id)]["task_started"] = True
        socketio.start_background_task(_dc_finalize_after_deadline, int(session_id))
    return deadline

def _emit_voice_roster_update(guild_id: int) -> None:
    """Broadcast current voice roster for a guild to all connected clients.

    Clients should ignore updates for guilds they are not currently viewing.
    """
    try:
        gid = int(guild_id or 0)
    except Exception:
        gid = 0
    if not gid:
        return

    try:
        voice_channels = (
            Channel.query
            .filter(Channel.is_dm == False)
            .filter(Channel.guild_id == gid)
            .filter(Channel.channel_type == "voice")
            .all()
        )
    except Exception:
        voice_channels = []

    mapping = {}
    try:
        user_ids = set()
        for ch in voice_channels:
            try:
                for uid in (group_calls.get(int(ch.id)) or set()):
                    try:
                        user_ids.add(int(uid))
                    except Exception:
                        pass
            except Exception:
                pass

        users_by_id = {}
        if user_ids:
            try:
                for u in User.query.filter(User.id.in_(list(user_ids))).all():
                    users_by_id[int(u.id)] = u
            except Exception:
                users_by_id = {}

        for ch in voice_channels:
            ids = list(group_calls.get(int(ch.id)) or [])
            if not ids:
                continue
            roster = []
            for uid in ids:
                try:
                    uid = int(uid)
                except Exception:
                    continue
                u = users_by_id.get(uid)
                if not u:
                    continue
                st = {}
                try:
                    st = (voice_states.get(int(ch.id)) or {}).get(int(uid)) or {}
                except Exception:
                    st = {}
                pub = _presence_public(u)
                roster.append({
                    "id": u.id,
                    "username": u.username,
                    "avatar_url": u.avatar_url or "",
                    "is_online": bool(pub.get("online")),
                    "mode": pub.get("mode"),
                    "presence_text": pub.get("presence_text"),
                    "muted": bool(st.get("muted")),
                    "deafened": bool(st.get("deafened")),
                "streaming": bool((group_screen_intents.get(int(ch.id)) or {}).get(int(uid))),
                })
            if roster:
                mapping[str(int(ch.id))] = roster
    except Exception:
        mapping = {}

    try:
        socketio.emit("voice_roster_update", {"guild_id": gid, "voice_roster": mapping}, broadcast=True)
    except Exception:
        pass

# Basic email validation (good enough for UX)
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# --- password policy (2026, not "12345678") ---
# Length handled separately (8–21). This covers complexity and obvious weak patterns.
_COMMON_PASSWORDS = {
    "password", "password1", "qwerty", "qwerty123", "admin", "admin123",
    "letmein", "iloveyou", "welcome", "12345678", "87654321", "123456789",
    "11111111", "00000000", "abcdefgh", "asdfghjk", "neonpulsar",
}

_SEQ_BASES = [
    "0123456789",
    "9876543210",
    "abcdefghijklmnopqrstuvwxyz",
    "zyxwvutsrqponmlkjihgfedcba",
]

def _has_simple_sequence(pw: str, min_len: int = 6) -> bool:
    x = (pw or "").lower()
    # only check alnum sequences, ignore symbols
    x = re.sub(r"[^a-z0-9]", "", x)
    if len(x) < min_len:
        return False
    for base in _SEQ_BASES:
        for i in range(len(base) - min_len + 1):
            sub = base[i:i+min_len]
            if sub in x:
                return True
    return False



def _norm_username(name: str) -> str:
    try:
        return (name or '').strip().casefold()
    except Exception:
        try:
            return (name or '').strip().lower()
        except Exception:
            return ''


def _validate_password(password: str, username=None) -> tuple[bool, str]:
    """Discord-like: only length matters (8..24, any characters)."""
    try:
        password = '' if password is None else str(password)
    except Exception:
        password = ''
    if len(password) < 8 or len(password) > 24:
        return (False, 'Пароль должен быть 8–24 символа.')
    return (True, '')

def _make_recovery_codes(n: int = 10) -> list[str]:
    """Generate human-friendly recovery codes.

    Codes are shown once to the user and stored only as hashes.
    """
    codes: list[str] = []
    for _ in range(max(1, n)):
        raw = secrets.token_urlsafe(10).replace("-", "").replace("_", "").upper()
        raw = (raw + "000000000000")[:12]
        codes.append(f"{raw[:4]}-{raw[4:8]}-{raw[8:12]}")
    return codes

def _save_recovery_codes(user_id: int, codes: list[str]) -> None:
    # Remove any unused old codes (regen invalidates them)
    RecoveryCode.query.filter_by(user_id=user_id, used_at=None).delete()
    for c in codes:
        db.session.add(RecoveryCode(user_id=user_id, code_hash=generate_password_hash(c)))
    db.session.commit()

def _use_recovery_code(user_id: int, code: str) -> bool:
    code = (code or "").strip().upper()
    if not code:
        return False
    rows = RecoveryCode.query.filter_by(user_id=user_id, used_at=None).all()
    for r in rows:
        if check_password_hash(r.code_hash, code):
            r.used_at = utcnow()
            db.session.commit()
            return True
    return False


def _totp_enabled_for_user(user) -> bool:
    try:
        return bool(getattr(user, "totp_enabled", False)) and bool(getattr(user, "totp_secret", None)) and pyotp is not None
    except Exception:
        return False


def _totp_verify_and_mark(user, code: str) -> bool:
    """Verify TOTP and prevent reusing the same time-step code."""
    if pyotp is None:
        return False
    secret = getattr(user, "totp_secret", None)
    if not secret:
        return False
    code = (code or "").strip().replace(" ", "")
    if not (code.isdigit() and len(code) == 6):
        return False

    totp = pyotp.TOTP(secret)
    # allow small clock drift
    if not totp.verify(code, valid_window=1):
        return False

    try:
        counter = int(totp.timecode(datetime.now(timezone.utc)))
    except Exception:
        counter = None

    if counter is not None:
        last = int(getattr(user, "totp_last_counter", -1) or -1)
        if counter <= last:
            return False
        try:
            user.totp_last_counter = counter
            db.session.commit()
        except Exception:
            db.session.rollback()
            # if cannot commit, still fail safe
            return False

    return True


def _send_verification_email(app: Flask, user: 'User') -> bool:
    if not user.email:
        return False
    token = _email_verify_serializer(app).dumps({"uid": user.id, "email": (user.email or "").lower()})
    link = url_for("verify_email", token=token, _external=True)
    body = (
        "Привет!\n\n"
        "Подтверди почту для аккаунта Neon Pulsar.\n\n"
        f"Ник: {user.username}\n"
        f"Ссылка для подтверждения (24 часа):\n{link}\n\n"
        "Если ты не создавал аккаунт, просто игнорируй письмо.\n"
    )
    return _send_email(app, user.email, "Neon Pulsar: подтверждение почты", body)

def _get_serializer(app: Flask, salt: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt=salt)

def _pw_reset_serializer(app: Flask) -> URLSafeTimedSerializer:
    return _get_serializer(app, "neonchat-pw-reset")

def _email_verify_serializer(app: Flask) -> URLSafeTimedSerializer:
    return _get_serializer(app, "neonchat-email-verify")

def _send_email(app: Flask, to_email: str, subject: str, body: str) -> bool:
    """Send an email via SMTP.

    Configure via env:
      MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD, MAIL_FROM
      MAIL_USE_TLS=1 (default), MAIL_USE_SSL=0
    """
    host = os.environ.get("MAIL_HOST")
    if not host:
        # No SMTP configured. Don't crash the app.
        print("[mail] MAIL_HOST is not set; skipping email send")
        return False

    port = int(os.environ.get("MAIL_PORT") or (465 if os.environ.get("MAIL_USE_SSL") == "1" else 587))
    user = os.environ.get("MAIL_USER")
    pwd = os.environ.get("MAIL_PASSWORD")
    from_addr = os.environ.get("MAIL_FROM") or user or "no-reply@neon.local"
    use_ssl = os.environ.get("MAIL_USE_SSL") == "1"
    use_tls = os.environ.get("MAIL_USE_TLS", "1") == "1"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.set_content(body)

    try:
        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            server = smtplib.SMTP(host, port, timeout=15)
        with server:
            server.ehlo()
            if (not use_ssl) and use_tls:
                server.starttls()
                server.ehlo()
            if user and pwd:
                server.login(user, pwd)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"[mail] send failed: {e}")
        return False

def _ensure_user_email_column() -> None:
    """Lightweight SQLite 'migrations' for existing installs."""
    try:
        cols = [r[1] for r in db.session.execute(text("PRAGMA table_info(user)")).fetchall()]
        if "email" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN email VARCHAR(120)"))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_user_email ON user(email)"))
            db.session.commit()
            cols.append("email")
        if "email_verified" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN email_verified BOOLEAN DEFAULT 0"))
            db.session.commit()
            # Backfill: existing users keep access
            db.session.execute(text("UPDATE user SET email_verified = 1 WHERE email IS NOT NULL AND email != ''"))
            db.session.commit()
    except Exception as e:
        print(f"[db] ensure columns failed: {e}")

def _fmt_msk(dt: datetime) -> str:
    """Format datetime as Moscow time (HH:MM).

    The app stores naive UTC timestamps (datetime.utcnow). On servers with
    non-Moscow timezones we still want a consistent MSK display.
    """
    if not dt:
        return ""

    # Treat naive timestamps as UTC.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    if ZoneInfo is not None:
        try:
            msk = dt.astimezone(ZoneInfo("Europe/Moscow"))
            return msk.strftime("%H:%M")
        except Exception:
            pass

    # Fallback: fixed UTC+3.
    return dt.astimezone(timezone(timedelta(hours=3))).strftime("%H:%M")

def _iso_z(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    try:
        s = dt.astimezone(timezone.utc).isoformat()
    except Exception:
        s = dt.isoformat()
    return s.replace("+00:00", "Z")

def _fmt_date_msk(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if ZoneInfo is not None:
        try:
            msk = dt.astimezone(ZoneInfo("Europe/Moscow"))
            return msk.strftime("%d.%m.%Y")
        except Exception:
            pass
    return dt.astimezone(timezone(timedelta(hours=3))).strftime("%d.%m.%Y")

def _fmt_day_key_msk(dt: datetime | None) -> str:
    """Return date key YYYY-MM-DD in MSK for UI grouping."""
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if ZoneInfo is not None:
        try:
            msk = dt.astimezone(ZoneInfo("Europe/Moscow"))
            return msk.strftime("%Y-%m-%d")
        except Exception:
            pass
    return dt.astimezone(timezone(timedelta(hours=3))).strftime("%Y-%m-%d")

def _fmt_day_label_ru(dt: datetime | None) -> str:
    """Return Russian day label like '19 декабря 2025 г.' in MSK."""
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if ZoneInfo is not None:
        try:
            msk = dt.astimezone(ZoneInfo("Europe/Moscow"))
        except Exception:
            msk = dt.astimezone(timezone(timedelta(hours=3)))
    else:
        msk = dt.astimezone(timezone(timedelta(hours=3)))

    months = [
        "января","февраля","марта","апреля","мая","июня",
        "июля","августа","сентября","октября","ноября","декабря"
    ]
    day = msk.day
    month = months[msk.month - 1]
    year = msk.year
    return f"{day} {month} {year} г."


def _fmt_datetime_msk(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if ZoneInfo is not None:
        try:
            msk = dt.astimezone(ZoneInfo("Europe/Moscow"))
            return msk.strftime("%d.%m.%Y %H:%M")
        except Exception:
            pass
    return dt.astimezone(timezone(timedelta(hours=3))).strftime("%d.%m.%Y %H:%M")

def _presence_text(mode: str, online_public: bool) -> str:
    mode = (mode or "online").lower().strip()
    if not online_public:
        if mode == "invisible":
            return "скрытность"
        return "не в сети"
    if mode == "away":
        return "нет на месте"
    if mode == "dnd":
        return "не беспокоить"
    return "в сети"

def _rel_time_ru(dt: datetime | None) -> str:
    """Human-ish relative time label in Russian (MSK display is handled on client too)."""
    if not dt:
        return "—"
    now = utcnow()
    try:
        delta = now - dt
    except Exception:
        return _fmt_datetime_msk(dt)

    sec = int(delta.total_seconds())
    if sec < 0:
        sec = 0
    if sec < 60:
        return "только что"
    mins = sec // 60
    if mins < 60:
        return f"{mins} мин назад"
    hrs = mins // 60
    if hrs < 24:
        return f"{hrs} ч назад"
    days = hrs // 24
    if days == 1:
        return "вчера"
    if days < 7:
        return f"{days} дн назад"
    return _fmt_datetime_msk(dt)

def _presence_public(u: 'User') -> dict:
    mode = (getattr(u, "presence_mode", None) or "online").lower().strip()
    actual_online = bool(getattr(u, "is_online", False))
    online_public = bool(actual_online and mode not in ("offline", "invisible"))
    # last_seen: hide for invisible
    last_seen = getattr(u, "last_seen", None)
    last_seen_iso = None if mode == "invisible" else _iso_z(last_seen)
    activity_label = "Скрыто" if mode == "invisible" else ("сейчас" if online_public else _rel_time_ru(last_seen))
    status = (getattr(u, "status_text", "") or "")
    activity = (getattr(u, "activity_text", "") or "")
    if mode == "invisible":
        status = ""
        activity = ""
    return {
        "user_id": int(u.id),
        "online": bool(online_public),
        "mode": mode,
        "presence_text": _presence_text(mode, online_public),
        "last_seen": last_seen_iso,
        "activity_label": activity_label,
        "status_text": status,
        "activity_text": activity,
    }

def _emit_presence_update(user_id: int) -> None:
    u = db.session.get(User, int(user_id))
    if not u:
        return
    payload = _presence_public(u)
    socketio.emit("presence_update", payload, to="presence")
    # Also broadcast total online count (lightweight; clients can also poll /api/online_count)
    try:
        n = int(User.query.filter_by(is_online=True).count())
        socketio.emit("online_count", {"online": n}, to="presence")
    except Exception:
        pass


def _set_user_presence(user_id: int, online_actual: bool) -> None:
    # Update DB + broadcast. Safe to call from request/socket context.
    now = utcnow()
    u = db.session.get(User, int(user_id))
    if not u:
        return
    prev_payload = _presence_public(u)
    u.is_online = bool(online_actual)
    u.last_seen = now
    db.session.commit()
    new_payload = _presence_public(u)
    # broadcast only if public presence changed or going offline/online matters
    if (prev_payload.get("online") != new_payload.get("online")) or (prev_payload.get("mode") != new_payload.get("mode")):
        _emit_presence_update(u.id)
    else:
        # still useful to refresh activity occasionally
        _emit_presence_update(u.id)

def _touch_activity(user_id: int) -> None:
    # Lightweight activity bump.
    now = utcnow()
    u = db.session.get(User, int(user_id))
    if not u:
        return
    u.last_seen = now
    if not getattr(u, "is_online", False):
        u.is_online = True
    db.session.commit()
    _emit_presence_update(u.id)

def _presence_sweeper(app: Flask) -> None:
    # Periodically mark users offline if they have no active sockets (or no heartbeat).
    while True:
        socketio.sleep(15)
        try:
            with app.app_context():
                now = utcnow()
                for uid, beat in list(presence_last_beat.items()):
                    # If user has no active sockets, they're offline.
                    sids = user_sids.get(uid) or set()
                    stale = (now - beat) > timedelta(seconds=75)
                    if (not sids) or stale:
                        u = db.session.get(User, int(uid))
                        if u and getattr(u, "is_online", False):
                            u.is_online = False
                            u.last_seen = now
                            db.session.commit()
                            _emit_presence_update(u.id)
                        if not sids:
                            presence_last_beat.pop(uid, None)
        except Exception as e:
            print(f"[presence] sweeper error: {e}")



def create_app():
    global app
    global PRESET_AVATAR_FILES
    # Make app available to background tasks that need an application context
    # for DB access (Flask-SQLAlchemy scoped sessions).
    try:
        _set_bg_app(app)
    except Exception:
        pass

    # Ensure correct MIME types for JS/CSS when served by Flask (helps when reverse proxy is minimal)
    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('application/javascript', '.mjs')
    mimetypes.add_type('text/css', '.css')

    # Respect X-Forwarded-* headers when behind a reverse proxy (nginx)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    app.config["PREFERRED_URL_SCHEME"] = os.environ.get("PREFERRED_URL_SCHEME", "https")
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    # Static asset cache-buster. Increment when static/js or static/css changes.
    # Bump this when frontend assets change to avoid stale browser cache
    # Bump asset version to break browser cache when JS/CSS change.
    # Bump asset version whenever frontend JS/CSS changes to break browser cache
    # Bump to break aggressive browser cache when JS/CSS changes
    # v87: context menu fix (avoid dead right-click in call tiles)
    # Bump asset version to bust browser caches after reconnect fixes.
    # FIX22: bump asset version to force clients to refresh updated CSS/HTML (icons + animations + selection dots)
    # Bump asset version to bust cache after group screenshare context fix.
    # Bump this string whenever static assets (JS/CSS) change, to bust cache on hosts/CDNs.
    app.config["ASSET_VERSION"] = os.environ.get("ASSET_VERSION", "20260313_screenshare_modal_ultra_luxe_v39_fitfix")

    # (v32+) Load bundled preset avatars dynamically from static/avatars.
    try:
        PRESET_AVATAR_FILES = _load_preset_avatar_files(BASE_DIR)
    except Exception:
        PRESET_AVATAR_FILES = [f"avatars/preset_{i:02d}.png" for i in range(1, 11)]

    # --- WebRTC (voice/video) ICE config ---
    # localhost often works without TURN, but real networks (mobile, strict NAT) typically require TURN.
    # Configure via environment variables on the host:
    #   RTC_STUN_URLS="stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
    #   RTC_TURN_URLS="turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp"
    #   RTC_TURN_USERNAME="neon"
    #   RTC_TURN_CREDENTIAL="change-me"
    # Recommended (more secure): TURN REST / HMAC short-lived credentials
    #   RTC_TURN_SECRET="<long random secret>"   (enable coturn: use-auth-secret + static-auth-secret)
    #   RTC_TURN_TTL_SECONDS="600"              (optional, default 600 seconds)
    # Optional:
    #   RTC_ICE_TRANSPORT_POLICY="all"  (or "relay" to force TURN)
    app.config["RTC_STUN_URLS"] = os.environ.get(
        "RTC_STUN_URLS",
        "stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302",
    )
    app.config["RTC_TURN_URLS"] = os.environ.get("RTC_TURN_URLS", "")
    app.config["RTC_TURN_USERNAME"] = os.environ.get("RTC_TURN_USERNAME", "")
    app.config["RTC_TURN_CREDENTIAL"] = os.environ.get("RTC_TURN_CREDENTIAL", "")
    app.config["RTC_TURN_SECRET"] = os.environ.get("RTC_TURN_SECRET", "")
    app.config["RTC_TURN_TTL_SECONDS"] = os.environ.get("RTC_TURN_TTL_SECONDS", "")
    app.config["RTC_ICE_TRANSPORT_POLICY"] = os.environ.get("RTC_ICE_TRANSPORT_POLICY", "all")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(
        BASE_DIR, "app.db"
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    # Hard upper cap for uploads (per request). Real per-plan limits are enforced in /api/upload.
    app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024
    app.config["UPLOAD_FOLDER"] = os.path.join(app.static_folder, "uploads")
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    # Private uploads (not served by static)
    app.config["PRIVATE_UPLOADS_FOLDER"] = os.path.join(BASE_DIR, "private_uploads")
    app.config["CHANNEL_ICONS_FOLDER"] = os.path.join(app.config["PRIVATE_UPLOADS_FOLDER"], "channel_icons")
    os.makedirs(app.config["CHANNEL_ICONS_FOLDER"], exist_ok=True)

    db.init_app(app)
    login_manager.init_app(app)
    socketio.init_app(app)

    with app.app_context():
        db.create_all()
        _ensure_user_email_column()
        _ensure_db_columns()
        _seed_subscription_plans()

    register_routes(app)
    register_socket_handlers(app)
    return app


# --- create global Flask app early so @app.route decorators work ---

def _ensure_db_columns() -> None:
    """Lightweight SQLite 'migrations' for existing installs."""
    try:
        cols = [
            r[1]
            for r in db.session.execute(text("PRAGMA table_info(user)")).fetchall()
        ]

        # username_norm: case-insensitive username uniqueness (Discord-like)
        if "username_norm" not in cols:
            try:
                db.session.execute(text("ALTER TABLE user ADD COLUMN username_norm VARCHAR(64)"))
                db.session.commit()
            except Exception:
                try: db.session.rollback()
                except Exception: pass
            try:
                cols = [r[1] for r in db.session.execute(text("PRAGMA table_info(user)")).fetchall()]
            except Exception:
                pass
        try:
            if "username_norm" in cols:
                db.session.execute(text("UPDATE user SET username_norm = lower(username) WHERE username_norm IS NULL OR username_norm = ''"))
                db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass
        # Best-effort unique index (may fail if legacy DB already has case-variants)
        try:
            db.session.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_user_username_norm ON user(username_norm)"))
            db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass


        if "email" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN email VARCHAR(120)"))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_user_email ON user(email)"))
            db.session.commit()
            cols.append("email")

        if "email_verified" not in cols:
            db.session.execute(
                text("ALTER TABLE user ADD COLUMN email_verified BOOLEAN DEFAULT 0")
            )
            db.session.commit()
            # Backfill: existing users keep access
            db.session.execute(
                text(
                    "UPDATE user SET email_verified = 1 WHERE email IS NOT NULL AND email != ''"
                )
            )
            db.session.commit()
            cols.append("email_verified")

        # --- account fields (Discord-like) ---
        if "display_name" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN display_name VARCHAR(32) DEFAULT ''"))
            db.session.commit()
            try:
                db.session.execute(text("UPDATE user SET display_name = username WHERE display_name IS NULL OR display_name = ''"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            cols.append("display_name")

        if "phone" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN phone VARCHAR(32)"))
            db.session.commit()
            cols.append("phone")

        if "reputation_level" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN reputation_level INTEGER DEFAULT 0"))
            db.session.commit()
            try:
                db.session.execute(text("UPDATE user SET reputation_level = 0 WHERE reputation_level IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            cols.append("reputation_level")

        if "recovery_codes_plain" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN recovery_codes_plain TEXT"))
            db.session.commit()
            cols.append("recovery_codes_plain")

        if "recovery_redownload_left" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN recovery_redownload_left INTEGER DEFAULT 0"))
            db.session.commit()
            try:
                db.session.execute(text("UPDATE user SET recovery_redownload_left = 0 WHERE recovery_redownload_left IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            cols.append("recovery_redownload_left")

        # --- account lifecycle ---
        if "is_disabled" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN is_disabled BOOLEAN DEFAULT 0"))
            db.session.commit()
            try:
                db.session.execute(text("UPDATE user SET is_disabled = 0 WHERE is_disabled IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            cols.append("is_disabled")

        if "is_deleted" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN is_deleted BOOLEAN DEFAULT 0"))
            db.session.commit()
            try:
                db.session.execute(text("UPDATE user SET is_deleted = 0 WHERE is_deleted IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            cols.append("is_deleted")

        # --- 2FA (TOTP) ---
        if "totp_enabled" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN totp_enabled BOOLEAN DEFAULT 0"))
            db.session.commit()
            try:
                db.session.execute(text("UPDATE user SET totp_enabled = 0 WHERE totp_enabled IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            cols.append("totp_enabled")

        if "totp_secret" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN totp_secret TEXT"))
            db.session.commit()
            cols.append("totp_secret")

        if "totp_temp_secret" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN totp_temp_secret TEXT"))
            db.session.commit()
            cols.append("totp_temp_secret")

        if "totp_last_counter" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN totp_last_counter INTEGER DEFAULT -1"))
            db.session.commit()
            try:
                db.session.execute(text("UPDATE user SET totp_last_counter = -1 WHERE totp_last_counter IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            cols.append("totp_last_counter")


        # --- presence columns ---
        if "last_seen" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN last_seen DATETIME"))
            db.session.commit()
            db.session.execute(
                text("UPDATE user SET last_seen = created_at WHERE last_seen IS NULL")
            )
            db.session.commit()
            cols.append("last_seen")

        if "is_online" not in cols:
            db.session.execute(
                text("ALTER TABLE user ADD COLUMN is_online BOOLEAN DEFAULT 0")
            )
            db.session.commit()
            cols.append("is_online")

        if "presence_mode" not in cols:
            db.session.execute(
                text("ALTER TABLE user ADD COLUMN presence_mode VARCHAR(16) DEFAULT 'online'")
            )
            db.session.commit()
            # backfill null/empty
            db.session.execute(
                text("UPDATE user SET presence_mode = 'online' WHERE presence_mode IS NULL OR presence_mode = ''")
            )
            db.session.commit()
            cols.append("presence_mode")

        # --- per-account settings sync (client UI toggles) ---
        if "settings_kv" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN settings_kv TEXT"))
            db.session.commit()
            try:
                db.session.execute(text("UPDATE user SET settings_kv = '{}' WHERE settings_kv IS NULL OR settings_kv = ''"))
                db.session.commit()
            except Exception:
                try: db.session.rollback()
                except Exception: pass
            cols.append("settings_kv")

        if "activity_text" not in cols:
            db.session.execute(text("ALTER TABLE user ADD COLUMN activity_text VARCHAR(120) DEFAULT ''"))
            db.session.commit()
            try:
                db.session.execute(text("UPDATE user SET activity_text = '' WHERE activity_text IS NULL"))
                db.session.commit()
            except Exception:
                try: db.session.rollback()
                except Exception: pass
            cols.append("activity_text")

        # --- channel table migrations ---
        ccols = [
            r[1]
            for r in db.session.execute(text("PRAGMA table_info(channel)")).fetchall()
        ]
        def _add_ch_col(sql):
            db.session.execute(text(sql))
            db.session.commit()

        if "channel_type" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN channel_type VARCHAR(8) DEFAULT 'text'")
            # backfill
            db.session.execute(text("UPDATE channel SET channel_type = 'text' WHERE channel_type IS NULL OR channel_type = ''"))
            db.session.commit()
            ccols.append("channel_type")

        if "topic" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN topic VARCHAR(140) DEFAULT ''")
            db.session.execute(text("UPDATE channel SET topic = '' WHERE topic IS NULL"))
            db.session.commit()
            ccols.append("topic")

        if "created_by" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN created_by INTEGER")
            ccols.append("created_by")

        # --- v9: private channels + invites ---
        if "is_private" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN is_private BOOLEAN DEFAULT 1")
            # Backfill existing channels to private by default (invite-only).
            db.session.execute(text("UPDATE channel SET is_private = 1 WHERE is_private IS NULL"))
            db.session.commit()
            ccols.append("is_private")

        if "invite_code" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN invite_code VARCHAR(32) DEFAULT ''")
            db.session.execute(text("UPDATE channel SET invite_code = '' WHERE invite_code IS NULL"))
            db.session.commit()
            ccols.append("invite_code")

        # --- v44: invite link controls (expiry + usage limit) ---
        if "invite_expires_at" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN invite_expires_at DATETIME")
            ccols.append("invite_expires_at")

        if "invite_max_uses" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN invite_max_uses INTEGER DEFAULT 0")
            try:
                db.session.execute(text("UPDATE channel SET invite_max_uses = 0 WHERE invite_max_uses IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            ccols.append("invite_max_uses")

        if "invite_uses" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN invite_uses INTEGER DEFAULT 0")
            try:
                db.session.execute(text("UPDATE channel SET invite_uses = 0 WHERE invite_uses IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            ccols.append("invite_uses")
        # --- v45: invite destination channel + temporary membership ---
        if "invite_default_channel_id" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN invite_default_channel_id INTEGER")
            ccols.append("invite_default_channel_id")

        if "invite_temporary" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN invite_temporary BOOLEAN DEFAULT 0")
            try:
                db.session.execute(text("UPDATE channel SET invite_temporary = 0 WHERE invite_temporary IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            ccols.append("invite_temporary")

        # --- v10: channel icon path ---
        if "icon_path" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN icon_path VARCHAR(256) DEFAULT ''")
            db.session.execute(text("UPDATE channel SET icon_path = '' WHERE icon_path IS NULL"))
            db.session.commit()
            ccols.append("icon_path")

        # --- v30: server profile fields (tag + banner) ---
        if "server_tag" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN server_tag VARCHAR(50) DEFAULT ''")
            db.session.execute(text("UPDATE channel SET server_tag = '' WHERE server_tag IS NULL"))
            db.session.commit()
            ccols.append("server_tag")

        if "banner_color" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN banner_color VARCHAR(50) DEFAULT ''")
            db.session.execute(text("UPDATE channel SET banner_color = '' WHERE banner_color IS NULL"))
            db.session.commit()
            ccols.append("banner_color")

        # --- v11: server -> channels (guild_id) ---
        if "guild_id" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN guild_id INTEGER")
            # Backfill: all existing non-DM channels become root servers
            try:
                db.session.execute(text("UPDATE channel SET guild_id = id WHERE is_dm = 0 AND (guild_id IS NULL OR guild_id = 0)"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            ccols.append("guild_id")

        # --- v14: categories inside guilds ---
        if "category_id" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN category_id INTEGER")
            ccols.append("category_id")

        if "position" not in ccols:
            _add_ch_col("ALTER TABLE channel ADD COLUMN position INTEGER DEFAULT 0")
            try:
                db.session.execute(text("UPDATE channel SET position = id WHERE position IS NULL OR position = 0"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            ccols.append("position")

        # Helpful indexes for categories/ordering
        try:
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_channel_category_id ON channel(category_id)"))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_channel_guild_category_pos ON channel(guild_id, category_id, position)"))
            db.session.commit()
        except Exception:
            db.session.rollback()

        # Helpful index for guild lookups
        try:
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_channel_guild_id ON channel(guild_id)"))
            db.session.commit()
        except Exception:
            db.session.rollback()

        
        # Helpful index for invite lookups (non-unique to avoid issues with legacy duplicates)
        try:
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_channel_invite_code ON channel(invite_code)"))
            db.session.commit()
        except Exception:
            db.session.rollback()

# Ensure each non-DM channel has an invite code.
        try:
            rows = db.session.execute(text(
                "SELECT id, invite_code, invite_expires_at, is_dm, COALESCE(guild_id, id) AS guild_id "
                "FROM channel"
            )).fetchall()
            now = utcnow()
            default_exp = now + timedelta(days=7)
            for cid, code, expires_at, is_dm, gid in rows:
                if int(is_dm or 0) == 1:
                    continue
                # Only root servers should have invite codes
                try:
                    if int(gid or 0) != int(cid):
                        continue
                except Exception:
                    continue
                if not code:
                    new_code = uuid.uuid4().hex[:16]
                    db.session.execute(
                        text("UPDATE channel SET invite_code = :c, invite_expires_at = :e, invite_uses = 0 WHERE id = :id"),
                        {"c": new_code, "e": default_exp, "id": int(cid)}
                    )
                else:
                    # Backfill default expiry for legacy codes (7 days from first start after update).
                    if expires_at is None:
                        db.session.execute(
                            text("UPDATE channel SET invite_expires_at = :e WHERE id = :id"),
                            {"e": default_exp, "id": int(cid)}
                        )
            db.session.commit()
        except Exception:
            db.session.rollback()

        # --- v9: channel member roles ---
        cmcols = [
            r[1]
            for r in db.session.execute(text("PRAGMA table_info(channel_member)")).fetchall()
        ]
        def _add_cm_col(sql):
            db.session.execute(text(sql))
            db.session.commit()

        if "role" not in cmcols:
            _add_cm_col("ALTER TABLE channel_member ADD COLUMN role VARCHAR(16) DEFAULT 'member'")
            db.session.execute(text("UPDATE channel_member SET role = 'member' WHERE role IS NULL OR role = ''"))
            db.session.commit()
            cmcols.append("role")

        if "joined_at" not in cmcols:
            _add_cm_col("ALTER TABLE channel_member ADD COLUMN joined_at DATETIME")
            db.session.execute(text("UPDATE channel_member SET joined_at = CURRENT_TIMESTAMP WHERE joined_at IS NULL"))
            db.session.commit()
            cmcols.append("joined_at")
        # --- v45: temporary membership fields ---
        if "is_temporary" not in cmcols:
            _add_cm_col("ALTER TABLE channel_member ADD COLUMN is_temporary BOOLEAN DEFAULT 0")
            try:
                db.session.execute(text("UPDATE channel_member SET is_temporary = 0 WHERE is_temporary IS NULL"))
                db.session.commit()
            except Exception:
                db.session.rollback()
            cmcols.append("is_temporary")

        if "temporary_until" not in cmcols:
            _add_cm_col("ALTER TABLE channel_member ADD COLUMN temporary_until DATETIME")
            cmcols.append("temporary_until")

        # Unique index to prevent duplicates
        try:
            db.session.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_member ON channel_member(channel_id, user_id)"))
            db.session.commit()
        except Exception:
            db.session.rollback()

        # Backfill: channel creator becomes admin (best-effort).
        try:
            rows = db.session.execute(text("SELECT channel_member.id, channel_member.user_id, channel.created_by FROM channel_member JOIN channel ON channel.id = channel_member.channel_id WHERE channel.is_dm = 0")).fetchall()
            for cm_id, uid, created_by in rows:
                if created_by and int(uid) == int(created_by):
                    db.session.execute(text("UPDATE channel_member SET role = 'admin' WHERE id = :id"), {"id": int(cm_id)})
            db.session.commit()
        except Exception:
            db.session.rollback()

        # --- v14.1: role ordering ---
        try:
            rcols = [r[1] for r in db.session.execute(text("PRAGMA table_info(role)")).fetchall()]
            if "position" not in rcols:
                db.session.execute(text("ALTER TABLE role ADD COLUMN position INTEGER DEFAULT 0"))
                db.session.commit()
                try:
                    db.session.execute(text("UPDATE role SET position = id WHERE position IS NULL OR position = 0"))
                    db.session.commit()
                except Exception:
                    db.session.rollback()
                rcols.append("position")
            try:
                db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_role_position ON role(position)"))
                db.session.commit()
            except Exception:
                db.session.rollback()
        except Exception:
            db.session.rollback()

        # --- message table migrations ---
        mcols = [
            r[1]
            for r in db.session.execute(text("PRAGMA table_info(message)")).fetchall()
        ]
        def _add_msg_col(sql):
            db.session.execute(text(sql))
            db.session.commit()

        if "edited_at" not in mcols:
            _add_msg_col("ALTER TABLE message ADD COLUMN edited_at DATETIME")
            mcols.append("edited_at")
        if "deleted_at" not in mcols:
            _add_msg_col("ALTER TABLE message ADD COLUMN deleted_at DATETIME")
            mcols.append("deleted_at")
        if "is_pinned" not in mcols:
            _add_msg_col("ALTER TABLE message ADD COLUMN is_pinned BOOLEAN DEFAULT 0")
            mcols.append("is_pinned")
        if "pinned_at" not in mcols:
            _add_msg_col("ALTER TABLE message ADD COLUMN pinned_at DATETIME")
            mcols.append("pinned_at")
        if "pinned_by" not in mcols:
            _add_msg_col("ALTER TABLE message ADD COLUMN pinned_by INTEGER")
            mcols.append("pinned_by")

        # --- call_session table migrations ---
        try:
            cscols = [
                r[1]
                for r in db.session.execute(text("PRAGMA table_info(call_session)")).fetchall()
            ]
            def _add_cs_col(sql):
                db.session.execute(text(sql))
                db.session.commit()

            if "call_started_at" not in cscols:
                _add_cs_col("ALTER TABLE call_session ADD COLUMN call_started_at DATETIME")
                cscols.append("call_started_at")
                try:
                    db.session.execute(text("UPDATE call_session SET call_started_at = started_at WHERE call_started_at IS NULL"))
                    db.session.commit()
                except Exception:
                    db.session.rollback()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass

        # --- support tables/columns migrations ---
        try:
            db.session.execute(text("""
                CREATE TABLE IF NOT EXISTS support_saved_reply (
                    id INTEGER PRIMARY KEY,
                    title VARCHAR(120) NOT NULL,
                    body TEXT NOT NULL,
                    scope VARCHAR(16) DEFAULT 'support' NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    created_by INTEGER,
                    updated_by INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_support_saved_reply_scope ON support_saved_reply(scope)"))
            db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass

        try:
            db.session.execute(text("""
                CREATE TABLE IF NOT EXISTS support_ticket_feedback (
                    id INTEGER PRIMARY KEY,
                    ticket_id INTEGER NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL,
                    rating INTEGER NOT NULL,
                    comment TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_support_ticket_feedback_rating ON support_ticket_feedback(rating)"))
            db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass

        try:
            stcols = [r[1] for r in db.session.execute(text("PRAGMA table_info(support_ticket)")).fetchall()]
            def _add_st_col(sql):
                db.session.execute(text(sql))
                db.session.commit()
            if 'tags_csv' not in stcols:
                _add_st_col("ALTER TABLE support_ticket ADD COLUMN tags_csv TEXT DEFAULT ''")
                stcols.append('tags_csv')
            if 'public_token' not in stcols:
                _add_st_col("ALTER TABLE support_ticket ADD COLUMN public_token VARCHAR(40)")
                stcols.append('public_token')
            if 'satisfaction_rating' not in stcols:
                _add_st_col("ALTER TABLE support_ticket ADD COLUMN satisfaction_rating INTEGER")
                stcols.append('satisfaction_rating')
            if 'satisfaction_comment' not in stcols:
                _add_st_col("ALTER TABLE support_ticket ADD COLUMN satisfaction_comment TEXT")
                stcols.append('satisfaction_comment')
            if 'rated_at' not in stcols:
                _add_st_col("ALTER TABLE support_ticket ADD COLUMN rated_at DATETIME")
                stcols.append('rated_at')
            try:
                rows = db.session.execute(text("SELECT id, public_token FROM support_ticket WHERE public_token IS NULL OR public_token = ''")).fetchall()
                for tid, _token in rows:
                    db.session.execute(text("UPDATE support_ticket SET public_token = :t WHERE id = :id"), {'t': secrets.token_urlsafe(18)[:36], 'id': int(tid)})
                db.session.commit()
            except Exception:
                db.session.rollback()
            try:
                db.session.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_support_ticket_public_token ON support_ticket(public_token)"))
                db.session.commit()
            except Exception:
                db.session.rollback()
        except Exception:
            try: db.session.rollback()
            except Exception: pass

        try:
            spcols = [r[1] for r in db.session.execute(text("PRAGMA table_info(support_staff_profile)")).fetchall()]
            def _add_sp_col(sql):
                db.session.execute(text(sql))
                db.session.commit()
            if 'last_seen_at' not in spcols:
                _add_sp_col("ALTER TABLE support_staff_profile ADD COLUMN last_seen_at DATETIME")
                spcols.append('last_seen_at')
            if 'skills_csv' not in spcols:
                _add_sp_col("ALTER TABLE support_staff_profile ADD COLUMN skills_csv TEXT DEFAULT ''")
                spcols.append('skills_csv')
            if 'categories_csv' not in spcols:
                _add_sp_col("ALTER TABLE support_staff_profile ADD COLUMN categories_csv TEXT DEFAULT ''")
                spcols.append('categories_csv')
            if 'max_active' not in spcols:
                _add_sp_col("ALTER TABLE support_staff_profile ADD COLUMN max_active INTEGER DEFAULT 0")
                spcols.append('max_active')
        except Exception:
            try: db.session.rollback()
            except Exception: pass

        try:
            db.session.execute(text("""
                CREATE TABLE IF NOT EXISTS support_sla_rule (
                    id INTEGER PRIMARY KEY,
                    category VARCHAR(32) NOT NULL DEFAULT '*',
                    priority VARCHAR(16) NOT NULL DEFAULT '*',
                    first_reply_minutes INTEGER NOT NULL DEFAULT 240,
                    next_reply_minutes INTEGER NOT NULL DEFAULT 720,
                    escalate_after_minutes INTEGER NOT NULL DEFAULT 30,
                    required_role VARCHAR(16) NOT NULL DEFAULT 'support',
                    is_enabled BOOLEAN DEFAULT 1,
                    note VARCHAR(255),
                    updated_by INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_support_sla_rule_cat_prio ON support_sla_rule(category, priority)"))
            db.session.commit()
            count_rules = int(db.session.execute(text("SELECT COUNT(*) FROM support_sla_rule")).scalar() or 0)
            if count_rules <= 0:
                seed_rows = [
                    ('*', 'urgent', 15, 30, 15, 'senior_support', 'default urgent'),
                    ('security', 'urgent', 10, 20, 10, 'head_support', 'security urgent'),
                    ('billing', 'urgent', 15, 30, 15, 'head_support', 'billing urgent'),
                    ('security', '*', 30, 60, 15, 'senior_support', 'security baseline'),
                    ('billing', '*', 45, 90, 20, 'senior_support', 'billing baseline'),
                    ('*', 'high', 60, 180, 30, 'senior_support', 'default high'),
                    ('*', 'normal', 240, 720, 60, 'support', 'default normal'),
                    ('*', 'low', 720, 1440, 120, 'support', 'default low'),
                ]
                for category, priority, first_m, next_m, esc_m, req_role, note in seed_rows:
                    db.session.execute(text("INSERT INTO support_sla_rule(category, priority, first_reply_minutes, next_reply_minutes, escalate_after_minutes, required_role, is_enabled, note) VALUES (:c, :p, :f, :n, :e, :r, 1, :note)"), {'c': category, 'p': priority, 'f': first_m, 'n': next_m, 'e': esc_m, 'r': req_role, 'note': note})
                db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass

        try:
            db.session.execute(text("""
                CREATE TABLE IF NOT EXISTS support_ticket_event (
                    id INTEGER PRIMARY KEY,
                    ticket_id INTEGER NOT NULL,
                    actor_user_id INTEGER,
                    event_type VARCHAR(32) NOT NULL,
                    event_value VARCHAR(255),
                    body TEXT,
                    meta_json TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_support_ticket_event_ticket_id ON support_ticket_event(ticket_id)"))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_support_ticket_event_created_at ON support_ticket_event(created_at)"))
            db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass

        try:
            db.session.execute(text("""
                CREATE TABLE IF NOT EXISTS support_ticket_mention (
                    id INTEGER PRIMARY KEY,
                    ticket_id INTEGER NOT NULL,
                    message_id INTEGER,
                    from_user_id INTEGER,
                    target_user_id INTEGER NOT NULL,
                    mention_key VARCHAR(64),
                    context_text TEXT,
                    is_read BOOLEAN DEFAULT 0,
                    read_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_support_ticket_mention_ticket_id ON support_ticket_mention(ticket_id)"))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_support_ticket_mention_target_user_id ON support_ticket_mention(target_user_id)"))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_support_ticket_mention_created_at ON support_ticket_mention(created_at)"))
            db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass

    except Exception as e:
        print(f"[db] ensure columns failed: {e}")


# --- models ---

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(32), unique=True, nullable=False)
    # Case-insensitive uniqueness helper
    username_norm = db.Column(db.String(64), index=True)
    # Discord-like account fields
    display_name = db.Column(db.String(32), nullable=True, default="")
    phone = db.Column(db.String(32), nullable=True)
    reputation_level = db.Column(db.Integer, default=0)
    # Allow a single extra download of recovery codes: store plaintext temporarily and clear after use.
    recovery_codes_plain = db.Column(db.Text, nullable=True)
    recovery_redownload_left = db.Column(db.Integer, default=0)
    email = db.Column(db.String(120), nullable=True)
    email_verified = db.Column(db.Boolean, default=False)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)
    is_online = db.Column(db.Boolean, default=False)
    presence_mode = db.Column(db.String(16), default="online")
    status_text = db.Column(db.String(120), default="")
    # Shown under username ("Playing ..." / activity). Client can set via API.
    activity_text = db.Column(db.String(120), default="")
    # Persistent per-account client settings (JSON as text) to sync UI toggles across devices.
    settings_kv = db.Column(db.Text, nullable=True, default="{}")
    avatar_url = db.Column(db.String(256))

    # Account lifecycle
    is_disabled = db.Column(db.Boolean, default=False)
    is_deleted = db.Column(db.Boolean, default=False)

    # 2FA (TOTP) – compatible with Google Authenticator / Authy
    totp_enabled = db.Column(db.Boolean, default=False)
    totp_secret = db.Column(db.Text, nullable=True)
    totp_temp_secret = db.Column(db.Text, nullable=True)
    totp_last_counter = db.Column(db.Integer, default=-1)

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

class Channel(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), nullable=False)
    is_dm = db.Column(db.Boolean, default=False)

    # 2026: -ish channel types
    channel_type = db.Column(db.String(8), default="text")  # text | voice
    topic = db.Column(db.String(140), default="")
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)

    # v9: invite-only private groups
    is_private = db.Column(db.Boolean, default=True)
    invite_code = db.Column(db.String(32), default="")

    # v44: invite link controls
    invite_expires_at = db.Column(db.DateTime, nullable=True)
    invite_max_uses = db.Column(db.Integer, default=0)  # 0 => unlimited
    invite_uses = db.Column(db.Integer, default=0)

    # v45: invite destination channel + temporary membership
    invite_default_channel_id = db.Column(db.Integer, nullable=True)
    invite_temporary = db.Column(db.Boolean, default=False)
    # v10: private group icon (stored server-side, not in /static)
    icon_path = db.Column(db.String(256), default="")

    # v30: server profile fields (Discord-like settings)
    server_tag = db.Column(db.String(50), default="")
    banner_color = db.Column(db.String(50), default="")

    # v11: -like server -> channels
    # Root server: guild_id == id. Subchannel: guild_id == <root server id>.
    # DMs keep guild_id = NULL.
    guild_id = db.Column(db.Integer, nullable=True, index=True)

    # v14: categories inside guilds (Discord-like)
    category_id = db.Column(db.Integer, nullable=True, index=True)
    position = db.Column(db.Integer, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ChannelCategory(db.Model):
    """Category grouping for subchannels inside a guild (server)."""

    __tablename__ = "channel_category"

    id = db.Column(db.Integer, primary_key=True)
    guild_id = db.Column(db.Integer, nullable=False, index=True)
    name = db.Column(db.String(64), nullable=False)
    position = db.Column(db.Integer, default=0)
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ChannelPermissionOverride(db.Model):
    """Per-channel permission overrides by member role (Discord-like, simplified).

    Roles correspond to ChannelMember.role: pending|member|moderator|admin.
    Values are nullable: NULL means "inherit default".
    """
    __tablename__ = "channel_permission_override"

    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.Integer, db.ForeignKey("channel.id"), nullable=False, index=True)
    role = db.Column(db.String(16), nullable=False)

    view_channel = db.Column(db.Boolean, nullable=True)
    send_messages = db.Column(db.Boolean, nullable=True)
    connect = db.Column(db.Boolean, nullable=True)
    speak = db.Column(db.Boolean, nullable=True)

    __table_args__ = (
        db.UniqueConstraint("channel_id", "role", name="uq_channel_perm_role"),
    )



class ChannelMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.Integer, db.ForeignKey("channel.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    # v9: per-channel roles
    role = db.Column(db.String(16), default="member")  # pending|member|moderator|admin
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

    # v45: temporary membership via invite
    is_temporary = db.Column(db.Boolean, default=False)
    temporary_until = db.Column(db.DateTime, nullable=True)
    __table_args__ = (db.UniqueConstraint("channel_id", "user_id", name="uq_channel_member"),)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.Integer, db.ForeignKey("channel.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    content = db.Column(db.Text, nullable=False, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    # 2026 extras
    edited_at = db.Column(db.DateTime, nullable=True)
    deleted_at = db.Column(db.DateTime, nullable=True)

    is_pinned = db.Column(db.Boolean, default=False)
    pinned_at = db.Column(db.DateTime, nullable=True)
    pinned_by = db.Column(db.Integer, nullable=True)  # user id


class Attachment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("message.id"), nullable=False)
    file_url = db.Column(db.String(512), nullable=False)
    file_name = db.Column(db.String(256), nullable=False)
    file_size = db.Column(db.Integer, default=0)
    mime_type = db.Column(db.String(128), default="application/octet-stream")
    is_image = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)




class ChannelClear(db.Model):
    """Per-user clear marker for a channel (used for DM 'Очистить чат').

    Clearing a chat is local to the current user: the other participant should not lose history.
    We store the timestamp after which messages are shown to this user.
    """
    __tablename__ = "channel_clear"

    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.Integer, db.ForeignKey("channel.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    cleared_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (db.UniqueConstraint("channel_id", "user_id", name="uq_channel_clear"), {"extend_existing": True})



class ChannelRead(db.Model):
    """Per-user read cursor for a channel (used for unread counters).

    Stores last_read_message_id for each (channel_id, user_id) pair.
    """
    __tablename__ = "channel_read"

    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.Integer, db.ForeignKey("channel.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    last_read_message_id = db.Column(db.Integer, default=0, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("channel_id", "user_id", name="uq_channel_read"),
        {"extend_existing": True},
    )

class MessageReceipt(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("message.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    delivered_at = db.Column(db.DateTime, nullable=True)
    read_at = db.Column(db.DateTime, nullable=True)

    __table_args__ = (db.UniqueConstraint("message_id", "user_id", name="uq_message_receipt"),)

class MessageReaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("message.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    emoji = db.Column(db.String(16), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (db.UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_reaction"),)

class MessageReport(db.Model):
    __tablename__ = "message_report"

    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("message.id"), nullable=False, index=True)
    reporter_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    target_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    channel_id = db.Column(db.Integer, db.ForeignKey("channel.id"), nullable=False, index=True)
    guild_id = db.Column(db.Integer, nullable=True, index=True)
    reason = db.Column(db.String(32), default="other", nullable=False)
    details = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(16), default="open", nullable=False, index=True)  # open|resolved|dismissed
    moderator_note = db.Column(db.Text, nullable=True)
    resolved_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    resolved_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (db.UniqueConstraint("message_id", "reporter_user_id", name="uq_message_report_once"),)

class AdminUserAction(db.Model):
    __tablename__ = "admin_user_action"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    admin_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    guild_id = db.Column(db.Integer, nullable=True, index=True)
    action_type = db.Column(db.String(24), nullable=False, index=True)
    reason = db.Column(db.Text, nullable=True)
    duration_minutes = db.Column(db.Integer, nullable=True)
    expires_at = db.Column(db.DateTime, nullable=True, index=True)
    is_active = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class AdminGrant(db.Model):
    __tablename__ = "admin_grant"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, unique=True, index=True)
    granted_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    permissions = db.Column(db.Text, nullable=True, default='')
    is_superadmin = db.Column(db.Boolean, default=False, index=True)
    note = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)


class SupportTicket(db.Model):
    __tablename__ = "support_ticket"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    assigned_to = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    guild_id = db.Column(db.Integer, nullable=True, index=True)
    subject = db.Column(db.String(160), nullable=False)
    category = db.Column(db.String(32), default='other', nullable=False, index=True)
    priority = db.Column(db.String(16), default='normal', nullable=False, index=True)
    status = db.Column(db.String(16), default='open', nullable=False, index=True)  # open|pending|closed
    waiting_for = db.Column(db.String(16), default='staff', nullable=False, index=True)
    first_staff_reply_at = db.Column(db.DateTime, nullable=True, index=True)
    first_response_due_at = db.Column(db.DateTime, nullable=True, index=True)
    next_reply_due_at = db.Column(db.DateTime, nullable=True, index=True)
    last_message_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    tags_csv = db.Column(db.Text, nullable=True, default='')
    public_token = db.Column(db.String(40), nullable=True, index=True, default=lambda: secrets.token_urlsafe(18)[:36])
    satisfaction_rating = db.Column(db.Integer, nullable=True, index=True)
    satisfaction_comment = db.Column(db.Text, nullable=True)
    rated_at = db.Column(db.DateTime, nullable=True, index=True)


class SupportTicketMessage(db.Model):
    __tablename__ = "support_ticket_message"

    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("support_ticket.id"), nullable=False, index=True)
    author_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    body = db.Column(db.Text, nullable=False)
    is_staff = db.Column(db.Boolean, default=False, index=True)
    is_internal = db.Column(db.Boolean, default=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class SupportTicketAttachment(db.Model):
    __tablename__ = "support_ticket_attachment"

    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("support_ticket.id"), nullable=False, index=True)
    message_id = db.Column(db.Integer, db.ForeignKey("support_ticket_message.id"), nullable=False, index=True)
    file_url = db.Column(db.String(512), nullable=False)
    file_name = db.Column(db.String(255), nullable=False)
    mime_type = db.Column(db.String(160), nullable=True)
    file_size = db.Column(db.Integer, nullable=True)
    is_image = db.Column(db.Boolean, default=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class SupportStaffProfile(db.Model):
    __tablename__ = "support_staff_profile"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, unique=True, index=True)
    role_level = db.Column(db.String(16), nullable=False, default='support', index=True)
    note = db.Column(db.String(255), nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    last_seen_at = db.Column(db.DateTime, nullable=True, index=True)


class SupportSavedReply(db.Model):
    __tablename__ = "support_saved_reply"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(120), nullable=False)
    body = db.Column(db.Text, nullable=False)
    scope = db.Column(db.String(16), nullable=False, default='support', index=True)
    sort_order = db.Column(db.Integer, default=0, index=True)
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    updated_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class SupportSlaRule(db.Model):
    __tablename__ = "support_sla_rule"

    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(32), nullable=False, default='*', index=True)
    priority = db.Column(db.String(16), nullable=False, default='*', index=True)
    first_reply_minutes = db.Column(db.Integer, nullable=False, default=240)
    next_reply_minutes = db.Column(db.Integer, nullable=False, default=720)
    escalate_after_minutes = db.Column(db.Integer, nullable=False, default=30)
    required_role = db.Column(db.String(16), nullable=False, default='support', index=True)
    is_enabled = db.Column(db.Boolean, default=True, index=True)
    note = db.Column(db.String(255), nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class SupportTicketFeedback(db.Model):
    __tablename__ = "support_ticket_feedback"

    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("support_ticket.id"), nullable=False, unique=True, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    rating = db.Column(db.Integer, nullable=False, index=True)
    comment = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class SupportTicketEvent(db.Model):
    __tablename__ = "support_ticket_event"

    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("support_ticket.id"), nullable=False, index=True)
    actor_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    event_type = db.Column(db.String(32), nullable=False, index=True)
    event_value = db.Column(db.String(255), nullable=True)
    body = db.Column(db.Text, nullable=True)
    meta_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class SupportTicketMention(db.Model):
    __tablename__ = "support_ticket_mention"

    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("support_ticket.id"), nullable=False, index=True)
    message_id = db.Column(db.Integer, db.ForeignKey("support_ticket_message.id"), nullable=True, index=True)
    from_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    target_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    mention_key = db.Column(db.String(64), nullable=True, index=True)
    context_text = db.Column(db.Text, nullable=True)
    is_read = db.Column(db.Boolean, default=False, index=True)
    read_at = db.Column(db.DateTime, nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class Role(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(32), unique=True, nullable=False)
    color = db.Column(db.String(16), default="#9aa0ff")  # CSS color string
    # v14.1: ordering (Discord-like role ordering)
    position = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class UserRole(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    role_id = db.Column(db.Integer, db.ForeignKey("role.id"), nullable=False, index=True)

    __table_args__ = (db.UniqueConstraint("user_id", name="uq_user_role_user"),)

class RecoveryCode(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    code_hash = db.Column(db.String(255), nullable=False)
    used_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class FriendRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    from_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    to_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    status = db.Column(db.String(16), default="pending")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class AuthSession(db.Model):
    """Tracks logged-in sessions per device/browser (Fix268)."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    token_hash = db.Column(db.String(64), nullable=False, unique=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    user_agent = db.Column(db.String(512))
    ip_address = db.Column(db.String(64))



class GeoIPCache(db.Model):
    """Caches IP → geo (country/region/city) lookups (Fix269)."""
    id = db.Column(db.Integer, primary_key=True)
    ip_address = db.Column(db.String(64), nullable=False, unique=True, index=True)
    country = db.Column(db.String(96))
    country_code = db.Column(db.String(8))
    region = db.Column(db.String(96))
    city = db.Column(db.String(96))
    org = db.Column(db.String(160))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class AuthAttempt(db.Model):
    """Audit trail for auth events: successful logins, failures, invalid usernames, rate limits."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    session_id = db.Column(db.Integer, db.ForeignKey("auth_session.id"), nullable=True, index=True)
    status = db.Column(db.String(32), nullable=False, index=True)
    login_value = db.Column(db.String(160), nullable=True, index=True)
    ip_address = db.Column(db.String(64), nullable=True, index=True)
    user_agent = db.Column(db.String(512), nullable=True)
    note = db.Column(db.String(160), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class AuthSecurityBlock(db.Model):
    """Temporary auth lockouts for abusive IPs / logins / 2FA targets (Fix271)."""
    id = db.Column(db.Integer, primary_key=True)
    scope_type = db.Column(db.String(16), nullable=False, index=True)  # ip|login|user
    scope_value = db.Column(db.String(160), nullable=False, index=True)
    phase = db.Column(db.String(16), nullable=False, index=True)       # login|2fa
    reason = db.Column(db.String(160), nullable=True)
    active = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)

# --- Fix268: auth sessions helpers (devices list / revoke) ---

AUTH_SESSION_COOKIE = "nc_auth_s"
AUTH_SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def _nc_client_ip() -> str:
    try:
        xff = (request.headers.get("X-Forwarded-For") or "").strip()
        if xff:
            return xff.split(",")[0].strip()
    except Exception:
        pass
    try:
        return (request.remote_addr or "").strip()
    except Exception:
        return ""


def _nc_hash_session_token(token: str) -> str:
    try:
        return hashlib.sha256((token or "").encode("utf-8")).hexdigest()
    except Exception:
        return ""


def _nc_dt_iso(dt) -> str | None:
    if not dt:
        return None
    try:
        # DB stores naive UTC in this project; mark as Z for client formatting.
        return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        try:
            return str(dt)
        except Exception:
            return None



AUTH_AUDIT_MAX_ROWS = 50
AUTH_RATE_WINDOW_MINUTES = 15
AUTH_RATE_MAX_PER_IP = 20
AUTH_RATE_MAX_PER_LOGIN = 8
AUTH_RATE_MAX_2FA_PER_IP = 10
AUTH_CAPTCHA_AFTER_IP = 4
AUTH_CAPTCHA_AFTER_LOGIN = 3
AUTH_CAPTCHA_AFTER_2FA_IP = 3
AUTH_BLOCK_WINDOW_MINUTES = 60
AUTH_BLOCK_LOGIN_FAILS_PER_IP = 30
AUTH_BLOCK_LOGIN_FAILS_PER_LOGIN = 12
AUTH_BLOCK_2FA_FAILS_PER_IP = 12
AUTH_BLOCK_DURATION_MINUTES = 60


def _nc_login_norm(value: str) -> str:
    try:
        return _norm_username((value or '').strip())
    except Exception:
        try:
            return (value or '').strip().lower()
        except Exception:
            return ''


def _nc_record_auth_attempt(status: str, user: 'User' | None = None, login_value: str | None = None,
                            note: str | None = None, session_id: int | None = None) -> None:
    try:
        rec = AuthAttempt(
            user_id=(int(user.id) if user is not None and getattr(user, 'id', None) else None),
            session_id=(int(session_id) if session_id else None),
            status=(str(status or 'unknown')[:32] or 'unknown'),
            login_value=((login_value or '')[:160] or None),
            ip_address=((_nc_client_ip() or '')[:64] or None),
            user_agent=((request.headers.get('User-Agent') or '')[:512] or None),
            note=((note or '')[:160] or None),
            created_at=datetime.utcnow(),
        )
        db.session.add(rec)
        db.session.commit()
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass


def _nc_auth_rate_limit(login_value: str | None = None, user: 'User' | None = None, phase: str = 'login') -> tuple[bool, str | None]:
    try:
        now = datetime.utcnow()
        cutoff = now - timedelta(minutes=AUTH_RATE_WINDOW_MINUTES)
        ip = (_nc_client_ip() or '').strip()
        login_norm = _nc_login_norm(login_value or getattr(user, 'username', '') or '')

        ip_limit = AUTH_RATE_MAX_2FA_PER_IP if phase == '2fa' else AUTH_RATE_MAX_PER_IP
        if ip:
            q = AuthAttempt.query.filter(AuthAttempt.created_at >= cutoff, AuthAttempt.ip_address == ip)
            if phase == '2fa':
                q = q.filter(AuthAttempt.status.in_(['bad_2fa', 'rate_limited_2fa']))
            else:
                q = q.filter(AuthAttempt.status.in_(['bad_password', 'bad_login', 'rate_limited_login', 'bad_2fa']))
            if q.count() >= ip_limit:
                return True, 'Слишком много попыток. Подождите 15 минут и попробуйте снова.'

        if phase != '2fa' and login_norm:
            q2 = AuthAttempt.query.filter(
                AuthAttempt.created_at >= cutoff,
                AuthAttempt.login_value == login_norm,
                AuthAttempt.status.in_(['bad_password', 'bad_login', 'rate_limited_login'])
            )
            if q2.count() >= AUTH_RATE_MAX_PER_LOGIN:
                return True, 'Слишком много попыток для этого логина. Подождите 15 минут.'
    except Exception:
        pass
    return False, None


NC_ADMIN_PERMISSIONS = ('dashboard', 'security', 'users', 'servers', 'moderation', 'audit', 'roles', 'support')
SUPPORT_ROLE_LEVELS = ('support', 'senior_support', 'head_support')
SUPPORT_QUICK_REPLIES = [
    {'title': 'Попросить шаги', 'body': 'Привет! Спасибо за обращение. Чтобы быстрее разобраться, пришли, пожалуйста: 1) что ты делал шаг за шагом, 2) что ожидал увидеть, 3) что произошло фактически, 4) скриншот или видео, если есть.'},
    {'title': 'Попросить браузер', 'body': 'Проверь, пожалуйста, в каком браузере и на каком устройстве это происходит. Ещё полезно написать версию браузера и приложить скрин из консоли, если там есть ошибки.'},
    {'title': 'Безопасность', 'body': 'Похоже, вопрос связан с безопасностью аккаунта. На всякий случай советую сразу сменить пароль, проверить активные устройства и закрыть лишние сессии в настройках.'},
    {'title': 'Оплата', 'body': 'По оплате лучше сразу прислать: дату платежа, сумму, способ оплаты и последние 4 цифры карты или часть id платежа. Полные реквизиты отправлять не нужно.'},
    {'title': 'Закрытие', 'body': 'Хорошие новости: всё выглядит решённым. Если проблема вернётся, просто ответь в этом тикете или создай новый с актуальными шагами.'},
]
SUPPORT_SLA_MINUTES = {
    'urgent': {'first': 15, 'user': 30},
    'high': {'first': 60, 'user': 180},
    'normal': {'first': 240, 'user': 720},
    'low': {'first': 720, 'user': 1440},
}
SUPPORT_MAX_FILES = 5
SUPPORT_MAX_FILE_BYTES = 10 * 1024 * 1024


def _nc_admin_permissions_for(user_id: int) -> set[str]:
    try:
        uid = int(user_id or 0)
    except Exception:
        uid = 0
    if uid <= 0:
        return set()
    if uid == 1:
        return set(NC_ADMIN_PERMISSIONS)
    try:
        row = AdminGrant.query.filter_by(user_id=uid).first()
    except Exception:
        row = None
    if not row:
        return set()
    if bool(getattr(row, 'is_superadmin', False)):
        return set(NC_ADMIN_PERMISSIONS)
    raw = (getattr(row, 'permissions', '') or '').strip()
    perms = {x.strip().lower() for x in raw.split(',') if x and x.strip()}
    return {x for x in perms if x in NC_ADMIN_PERMISSIONS}


def _nc_auth_is_admin_auditor(permission: str | None = None) -> bool:
    try:
        if not current_user.is_authenticated:
            return False
        perms = _nc_admin_permissions_for(int(getattr(current_user, 'id', 0) or 0))
        if not perms:
            return False
        if not permission:
            return True
        return str(permission).strip().lower() in perms
    except Exception:
        return False


def _nc_auth_attempt_payload(r: AuthAttempt, include_geo: bool = False, geo_map: dict | None = None) -> dict:
    try:
        meta = _nc_parse_user_agent(r.user_agent or '')
    except Exception:
        meta = {'browser': 'Browser', 'browser_version': None, 'os': 'Unknown OS', 'device': 'Desktop'}
    geo = None
    ip = (getattr(r, 'ip_address', None) or '').strip()
    if include_geo and geo_map is not None and ip:
        geo = geo_map.get(ip)
    return {
        'id': int(getattr(r, 'id', 0) or 0),
        'status': getattr(r, 'status', None),
        'note': getattr(r, 'note', None),
        'login_value': getattr(r, 'login_value', None),
        'ip_address': getattr(r, 'ip_address', None),
        'created_at': _nc_dt_iso(getattr(r, 'created_at', None)),
        'browser': meta.get('browser'),
        'browser_version': meta.get('browser_version'),
        'os': meta.get('os'),
        'device': meta.get('device'),
        'geo': geo,
    }


def _nc_auth_fail_statuses(phase: str = 'login') -> list[str]:
    if phase == '2fa':
        return ['bad_2fa', 'bad_captcha_2fa', 'rate_limited_2fa', 'blocked_2fa']
    return ['bad_password', 'bad_login', 'bad_captcha_login', 'rate_limited_login', 'blocked_login']


def _nc_auth_challenge_session_key(phase: str) -> str:
    return f'nc_auth_challenge_{phase}'


def _nc_auth_challenge_force_key(phase: str) -> str:
    return f'nc_auth_force_captcha_{phase}'


def _nc_auth_new_challenge(phase: str = 'login') -> dict:
    a = 2 + secrets.randbelow(8)
    b = 1 + secrets.randbelow(8)
    data = {'prompt': f'Подтвердите, что вы не бот: {a} + {b} = ?', 'answer': str(a + b), 'created_at': int(time.time())}
    session[_nc_auth_challenge_session_key(phase)] = data
    return {'required': True, 'prompt': data['prompt']}


def _nc_auth_challenge_state(phase: str = 'login') -> dict | None:
    if not session.get(_nc_auth_challenge_force_key(phase)):
        return None
    data = session.get(_nc_auth_challenge_session_key(phase)) or {}
    if not (data.get('prompt') or '').strip():
        return _nc_auth_new_challenge(phase)
    return {'required': True, 'prompt': data['prompt']}


def _nc_auth_clear_challenge(phase: str = 'login') -> None:
    session.pop(_nc_auth_challenge_force_key(phase), None)
    session.pop(_nc_auth_challenge_session_key(phase), None)


def _nc_auth_validate_challenge(answer: str, phase: str = 'login') -> bool:
    data = session.get(_nc_auth_challenge_session_key(phase)) or {}
    expected = str(data.get('answer') or '').strip()
    actual = str(answer or '').strip()
    ok = bool(expected) and (actual == expected)
    if ok:
        _nc_auth_clear_challenge(phase)
    else:
        _nc_auth_new_challenge(phase)
    return ok


def _nc_auth_should_require_captcha(login_value: str | None = None, user: 'User' | None = None, phase: str = 'login') -> bool:
    if session.get(_nc_auth_challenge_force_key(phase)):
        return True
    try:
        cutoff = datetime.utcnow() - timedelta(minutes=AUTH_RATE_WINDOW_MINUTES)
        ip = (_nc_client_ip() or '').strip()
        login_norm = _nc_login_norm(login_value or getattr(user, 'username', '') or '')
        fail_statuses = _nc_auth_fail_statuses(phase)
        if ip:
            q = AuthAttempt.query.filter(AuthAttempt.created_at >= cutoff, AuthAttempt.ip_address == ip, AuthAttempt.status.in_(fail_statuses))
            ip_threshold = AUTH_CAPTCHA_AFTER_2FA_IP if phase == '2fa' else AUTH_CAPTCHA_AFTER_IP
            if q.count() >= ip_threshold:
                session[_nc_auth_challenge_force_key(phase)] = 1
                return True
        if phase != '2fa' and login_norm:
            q2 = AuthAttempt.query.filter(AuthAttempt.created_at >= cutoff, AuthAttempt.login_value == login_norm, AuthAttempt.status.in_(fail_statuses))
            if q2.count() >= AUTH_CAPTCHA_AFTER_LOGIN:
                session[_nc_auth_challenge_force_key(phase)] = 1
                return True
    except Exception:
        pass
    return False


def _nc_upsert_auth_block(scope_type: str, scope_value: str, phase: str, reason: str, minutes: int = AUTH_BLOCK_DURATION_MINUTES) -> AuthSecurityBlock | None:
    scope_value = (scope_value or '').strip()
    if not scope_value:
        return None
    now = datetime.utcnow()
    expires_at = now + timedelta(minutes=max(5, int(minutes or AUTH_BLOCK_DURATION_MINUTES)))
    try:
        row = AuthSecurityBlock.query.filter_by(scope_type=scope_type, scope_value=scope_value, phase=phase, active=True).order_by(AuthSecurityBlock.expires_at.desc()).first()
        if row:
            row.reason = (reason or row.reason or 'auth_lock')[:160]
            if not row.expires_at or row.expires_at < expires_at:
                row.expires_at = expires_at
            db.session.commit()
            return row
        row = AuthSecurityBlock(scope_type=scope_type, scope_value=scope_value[:160], phase=(phase or 'login')[:16], reason=(reason or 'auth_lock')[:160], active=True, created_at=now, expires_at=expires_at)
        db.session.add(row)
        db.session.commit()
        return row
    except Exception:
        try: db.session.rollback()
        except Exception: pass
    return None


def _nc_find_active_auth_block(login_value: str | None = None, user: 'User' | None = None, phase: str = 'login') -> AuthSecurityBlock | None:
    now = datetime.utcnow()
    login_norm = _nc_login_norm(login_value or getattr(user, 'username', '') or '')
    scopes = []
    ip = (_nc_client_ip() or '').strip()
    if ip: scopes.append(('ip', ip))
    if phase != '2fa' and login_norm: scopes.append(('login', login_norm))
    if phase == '2fa' and user is not None and getattr(user, 'id', None): scopes.append(('user', str(int(user.id))))
    try:
        for scope_type, scope_value in scopes:
            row = AuthSecurityBlock.query.filter(AuthSecurityBlock.scope_type == scope_type, AuthSecurityBlock.scope_value == scope_value, AuthSecurityBlock.phase == phase, AuthSecurityBlock.active.is_(True), AuthSecurityBlock.expires_at > now).order_by(AuthSecurityBlock.expires_at.desc()).first()
            if row: return row
        stale = AuthSecurityBlock.query.filter(AuthSecurityBlock.active.is_(True), AuthSecurityBlock.expires_at <= now).all()
        if stale:
            for row in stale: row.active = False
            db.session.commit()
    except Exception:
        try: db.session.rollback()
        except Exception: pass
    return None


def _nc_auth_block_message(block: AuthSecurityBlock | None, phase: str = 'login') -> str | None:
    if not block: return None
    try: left = int(max(1, (block.expires_at - datetime.utcnow()).total_seconds() // 60))
    except Exception: left = AUTH_BLOCK_DURATION_MINUTES
    if phase == '2fa':
        return f'Слишком много подозрительных попыток 2FA. Повторите через {left} мин.'
    return f'Вход временно заблокирован из-за подозрительной активности. Повторите через {left} мин.'


def _nc_auth_maybe_activate_block(login_value: str | None = None, user: 'User' | None = None, phase: str = 'login') -> AuthSecurityBlock | None:
    try:
        cutoff = datetime.utcnow() - timedelta(minutes=AUTH_BLOCK_WINDOW_MINUTES)
        ip = (_nc_client_ip() or '').strip()
        login_norm = _nc_login_norm(login_value or getattr(user, 'username', '') or '')
        fail_statuses = _nc_auth_fail_statuses(phase)
        if ip:
            q = AuthAttempt.query.filter(AuthAttempt.created_at >= cutoff, AuthAttempt.ip_address == ip, AuthAttempt.status.in_(fail_statuses))
            ip_limit = AUTH_BLOCK_2FA_FAILS_PER_IP if phase == '2fa' else AUTH_BLOCK_LOGIN_FAILS_PER_IP
            if q.count() >= ip_limit:
                return _nc_upsert_auth_block('ip', ip, phase, f'{phase}_ip_threshold')
        if phase != '2fa' and login_norm:
            q2 = AuthAttempt.query.filter(AuthAttempt.created_at >= cutoff, AuthAttempt.login_value == login_norm, AuthAttempt.status.in_(fail_statuses))
            if q2.count() >= AUTH_BLOCK_LOGIN_FAILS_PER_LOGIN:
                return _nc_upsert_auth_block('login', login_norm, phase, 'login_threshold')
        if phase == '2fa' and user is not None and getattr(user, 'id', None):
            q3 = AuthAttempt.query.filter(AuthAttempt.created_at >= cutoff, AuthAttempt.user_id == int(user.id), AuthAttempt.status.in_(fail_statuses))
            if q3.count() >= max(6, AUTH_BLOCK_2FA_FAILS_PER_IP - 2):
                return _nc_upsert_auth_block('user', str(int(user.id)), phase, '2fa_user_threshold')
    except Exception:
        pass
    return None


def _nc_render_login(nxt: str | None = None):
    return render_template('login.html', next=nxt, auth_challenge=_nc_auth_challenge_state('login'))


def _nc_render_twofa(username: str):
    return render_template('twofa.html', username=username, auth_challenge=_nc_auth_challenge_state('2fa'))


# --- Fix269: optional IP geolocation for sessions list (opt-in) ---

GEO_CACHE_TTL_DAYS = 14


def _nc_is_public_ip(ip: str) -> bool:
    try:
        ip = (ip or "").strip()
        if not ip:
            return False
        addr = ipaddress.ip_address(ip)
        return not (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast)
    except Exception:
        return False


def _nc_boolish(v, default: bool = False) -> bool:
    try:
        if v is None:
            return default
        if v is True or v is False:
            return bool(v)
        s = str(v).strip().lower()
        if s in ("1", "true", "yes", "on"):
            return True
        if s in ("0", "false", "no", "off", ""):
            return False
        return default
    except Exception:
        return default


def _nc_geo_fetch_ipwhois(ip: str) -> dict | None:
    """Fetch geo from ipwho.is (HTTPS, no key)."""
    try:
        url = f"https://ipwho.is/{urllib.parse.quote(ip)}"
        req = urllib.request.Request(url, headers={"User-Agent": "neonchat/1.0"})
        with urllib.request.urlopen(req, timeout=1.6) as resp:
            raw = resp.read()
        j = json.loads(raw.decode("utf-8", "ignore") or "{}")
        if not j or j.get("success") is False:
            return None
        return {
            "country": j.get("country"),
            "country_code": j.get("country_code") or j.get("countryCode"),
            "region": j.get("region"),
            "city": j.get("city"),
            "org": (j.get("connection") or {}).get("isp") or (j.get("connection") or {}).get("org"),
        }
    except Exception:
        return None


def _nc_geo_fetch_ipapico(ip: str) -> dict | None:
    """Fallback geo provider: ipapi.co (HTTPS)."""
    try:
        url = f"https://ipapi.co/{urllib.parse.quote(ip)}/json/"
        req = urllib.request.Request(url, headers={"User-Agent": "neonchat/1.0"})
        with urllib.request.urlopen(req, timeout=1.6) as resp:
            raw = resp.read()
        j = json.loads(raw.decode("utf-8", "ignore") or "{}")
        if not j or j.get("error"):
            return None
        return {
            "country": j.get("country_name"),
            "country_code": j.get("country_code"),
            "region": j.get("region"),
            "city": j.get("city"),
            "org": j.get("org"),
        }
    except Exception:
        return None


def _nc_geo_lookup(ip: str) -> dict | None:
    """Cached lookup for IP geo. Returns dict with keys city/region/country/country_code."""
    ip = (ip or "").strip()
    if not _nc_is_public_ip(ip):
        return None

    now = datetime.utcnow()
    cutoff = now - timedelta(days=GEO_CACHE_TTL_DAYS)

    rec = None
    try:
        rec = GeoIPCache.query.filter_by(ip_address=ip).first()
    except Exception:
        rec = None

    if rec and rec.updated_at and rec.updated_at >= cutoff:
        return {
            "city": rec.city,
            "region": rec.region,
            "country": rec.country,
            "country_code": rec.country_code,
            "org": rec.org,
        }

    data = _nc_geo_fetch_ipwhois(ip) or _nc_geo_fetch_ipapico(ip)
    if not data:
        return None

    try:
        if not rec:
            rec = GeoIPCache(ip_address=ip)
            db.session.add(rec)
        rec.country = (data.get("country") or "")[:96] if data.get("country") else None
        rec.country_code = (data.get("country_code") or "")[:8] if data.get("country_code") else None
        rec.region = (data.get("region") or "")[:96] if data.get("region") else None
        rec.city = (data.get("city") or "")[:96] if data.get("city") else None
        rec.org = (data.get("org") or "")[:160] if data.get("org") else None
        rec.updated_at = now
        db.session.commit()
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass

    return {
        "city": data.get("city"),
        "region": data.get("region"),
        "country": data.get("country"),
        "country_code": data.get("country_code"),
        "org": data.get("org"),
    }

def _nc_parse_user_agent(ua: str) -> dict:
    ua = (ua or "").strip()
    low = ua.lower()

    def _ver(token: str) -> str | None:
        try:
            i = ua.find(token)
            if i == -1:
                return None
            s = ua[i + len(token):]
            v = s.split(" ", 1)[0].split(";", 1)[0].strip()
            return v[:32] if v else None
        except Exception:
            return None

    browser = "Browser"
    version = None
    if "edg/" in low:
        browser = "Edge"
        version = _ver("Edg/")
    elif "opr/" in low or "opera" in low:
        browser = "Opera"
        version = _ver("OPR/") or _ver("Opera/")
    elif "yabrowser/" in low:
        browser = "Yandex"
        version = _ver("YaBrowser/")
    elif "firefox/" in low:
        browser = "Firefox"
        version = _ver("Firefox/")
    elif "chrome/" in low and "safari/" in low:
        browser = "Chrome"
        version = _ver("Chrome/")
    elif "safari/" in low and "chrome/" not in low:
        browser = "Safari"
        version = _ver("Version/") or _ver("Safari/")
    elif "msie" in low or "trident/" in low:
        browser = "Internet Explorer"

    os_name = "Unknown OS"
    if "windows nt" in low:
        os_name = "Windows"
    elif "android" in low:
        os_name = "Android"
    elif "iphone" in low or "ipad" in low or "ios" in low:
        os_name = "iOS"
    elif "mac os x" in low or "macintosh" in low:
        os_name = "macOS"
    elif "linux" in low:
        os_name = "Linux"

    device = "Desktop"
    if "mobile" in low or "android" in low or "iphone" in low:
        device = "Mobile"

    return {
        "browser": browser,
        "browser_version": version,
        "os": os_name,
        "device": device,
        "ua": ua,
    }


def _nc_issue_auth_session(user_id: int) -> tuple[str, AuthSession] | tuple[None, None]:
    """Create a new AuthSession row and return (raw_cookie_token, row)."""
    try:
        token = secrets.token_urlsafe(32)
        th = _nc_hash_session_token(token)
        now = datetime.utcnow()
        rec = AuthSession(
            user_id=int(user_id),
            token_hash=th,
            created_at=now,
            last_seen_at=now,
            user_agent=(request.headers.get("User-Agent") or "")[:512],
            ip_address=(_nc_client_ip() or "")[:64],
        )
        db.session.add(rec)
        db.session.commit()
        return token, rec
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass
        return None, None


def _nc_get_auth_session_for_request(user_id: int) -> tuple[AuthSession | None, str | None]:
    try:
        token = request.cookies.get(AUTH_SESSION_COOKIE)
    except Exception:
        token = None
    if not token:
        return None, None
    th = _nc_hash_session_token(token)
    try:
        rec = AuthSession.query.filter_by(user_id=int(user_id), token_hash=th).first()
    except Exception:
        rec = None
    return rec, token


def _nc_revoke_current_auth_session(user_id: int) -> None:
    try:
        rec, _tok = _nc_get_auth_session_for_request(user_id)
        if rec:
            db.session.delete(rec)
            db.session.commit()
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass

class CallSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user1_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    user2_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    # Real connected call start time (set when callee answers). If None, the call never connected (ringing/missed).
    call_started_at = db.Column(db.DateTime, nullable=True)
    active = db.Column(db.Boolean, default=True)


class SubscriptionPlan(db.Model):
    __tablename__ = "subscription_plan"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(32), unique=True, nullable=False, index=True)
    name = db.Column(db.String(64), nullable=False)
    description = db.Column(db.String(255), default="")
    price_minor = db.Column(db.Integer, default=0)
    currency = db.Column(db.String(8), default="RUB")
    period_days = db.Column(db.Integer, default=30)
    badge = db.Column(db.String(32), default="")
    is_active = db.Column(db.Boolean, default=True)
    sort_order = db.Column(db.Integer, default=0)
    features_json = db.Column(db.Text, default="{}")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class UserSubscription(db.Model):
    __tablename__ = "user_subscription"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    plan_id = db.Column(db.Integer, db.ForeignKey("subscription_plan.id"), nullable=False, index=True)
    provider = db.Column(db.String(32), default="mock")
    provider_subscription_id = db.Column(db.String(128), nullable=True)
    status = db.Column(db.String(32), default="active")  # active|canceled|expired
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    current_period_start = db.Column(db.DateTime, default=datetime.utcnow)
    current_period_end = db.Column(db.DateTime, nullable=True)
    cancel_at_period_end = db.Column(db.Boolean, default=False)
    canceled_at = db.Column(db.DateTime, nullable=True)
    ended_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BillingPayment(db.Model):
    __tablename__ = "billing_payment"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    subscription_id = db.Column(db.Integer, db.ForeignKey("user_subscription.id"), nullable=True, index=True)
    plan_id = db.Column(db.Integer, db.ForeignKey("subscription_plan.id"), nullable=True, index=True)
    provider = db.Column(db.String(32), default="mock")
    provider_payment_id = db.Column(db.String(128), nullable=True)
    amount_minor = db.Column(db.Integer, default=0)
    currency = db.Column(db.String(8), default="RUB")
    status = db.Column(db.String(32), default="succeeded")
    payload_json = db.Column(db.Text, default="{}")
    paid_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class SubscriptionGift(db.Model):
    __tablename__ = "subscription_gift"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(64), unique=True, nullable=False, index=True)
    from_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    to_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)  # optional intended recipient
    redeemed_by_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    plan_id = db.Column(db.Integer, db.ForeignKey("subscription_plan.id"), nullable=False, index=True)
    status = db.Column(db.String(32), default="active")  # active|redeemed|expired|revoked
    message = db.Column(db.String(200), default="")
    expires_at = db.Column(db.DateTime, nullable=True)
    redeemed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# --- login ---

@login_manager.user_loader
def load_user(user_id: str):
    return db.session.get(User, int(user_id))

login_manager.login_view = "login"

# --- helpers ---

def _dm_channel_key(u1: int, u2: int) -> str:
    lo, hi = sorted([u1, u2])
    return f"dm:{lo}:{hi}"

def get_or_create_dm_channel(user1_id: int, user2_id: int) -> Channel:
    key = _dm_channel_key(user1_id, user2_id)
    channel = Channel.query.filter_by(is_dm=True, name=key).first()
    if channel:
        return channel
    channel = Channel(name=key, is_dm=True)
    db.session.add(channel)
    db.session.flush()

    db.session.add(ChannelMember(channel_id=channel.id, user_id=user1_id))
    db.session.add(ChannelMember(channel_id=channel.id, user_id=user2_id))
    db.session.commit()
    return channel


def _get_dm_other_user_id(channel_id: int, my_id: int) -> int | None:
    ch = db.session.get(Channel, int(channel_id))
    if not ch or not ch.is_dm:
        return None
    members = ChannelMember.query.filter_by(channel_id=ch.id).all()
    for m in members:
        if int(m.user_id) != int(my_id):
            return int(m.user_id)
    return None

def _are_friends(u1: int, u2: int) -> bool:
    """Return True if users have an accepted friend relation."""
    try:
        u1 = int(u1)
        u2 = int(u2)
    except Exception:
        return False
    if not u1 or not u2:
        return False
    if u1 == u2:
        return True
    try:
        fr = (
            FriendRequest.query
            .filter(FriendRequest.status == "accepted")
            .filter(
                or_(
                    and_(FriendRequest.from_id == u1, FriendRequest.to_id == u2),
                    and_(FriendRequest.from_id == u2, FriendRequest.to_id == u1),
                )
            )
            .first()
        )
        return bool(fr)
    except Exception:
        return False

def _have_mutual_non_dm_channel(u1: int, u2: int) -> bool:
    """Return True if users share membership in at least one non-DM channel.

    This approximates Discord's "mutual server" gating.
    """
    try:
        u1 = int(u1)
        u2 = int(u2)
    except Exception:
        return False


# --- v? privacy-aware settings helpers (Fix258) ---

def _nc_settings_kv_for_user(u: 'User') -> dict:
    """Read per-account settings KV JSON from DB.

    Stored as text on the User model (settings_kv). Used to enforce
    privacy toggles server-side (friend requests / DMs).
    """
    try:
        raw = getattr(u, 'settings_kv', None) or "{}"
        if not isinstance(raw, str):
            return {}
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _nc_ui_state_for_user(u: 'User') -> dict:
    """Return parsed dict from settings key: nc_settings_ui_state."""
    try:
        kv = _nc_settings_kv_for_user(u)
        raw = kv.get('nc_settings_ui_state')
        if not raw or not isinstance(raw, str):
            return {}
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _nc_boolish(v, default: bool | None = None) -> bool:
    if v is None:
        return bool(default) if default is not None else False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    try:
        s = str(v).strip().lower()
    except Exception:
        return bool(default) if default is not None else False
    if s in {'false', '0', 'no', 'off'}:
        return False
    if s in {'true', '1', 'yes', 'on'}:
        return True
    return bool(default) if default is not None else bool(v)


def _nc_ui_allow(u: 'User', key: str, default_allow: bool = True) -> bool:
    """UI toggles default to ON unless explicitly false (Discord-like)."""
    st = _nc_ui_state_for_user(u)
    if key not in st:
        return bool(default_allow)
    return _nc_boolish(st.get(key), default_allow)
    if not u1 or not u2:
        return False
    if u1 == u2:
        return True
    try:
        from sqlalchemy.orm import aliased

        cm1 = aliased(ChannelMember)
        cm2 = aliased(ChannelMember)
        row = (
            db.session.query(Channel.id)
            .join(cm1, cm1.channel_id == Channel.id)
            .join(cm2, cm2.channel_id == Channel.id)
            .filter(Channel.is_dm == False)  # noqa: E712
            .filter(cm1.user_id == u1)
            .filter(cm2.user_id == u2)
            .first()
        )
        return bool(row)
    except Exception:
        return False

def _dm_can_send(sender_id: int, recipient_id: int) -> bool:
    """DM sending gate.

    Discord-like behaviour + per-user privacy:
    - allow if users are friends
    - else allow only if recipient accepts DMs from server members AND there is a mutual server
    """
    if not sender_id or not recipient_id:
        return False
    if int(sender_id) == int(recipient_id):
        return True
    if _are_friends(int(sender_id), int(recipient_id)):
        return True

    # Fix258: Respect recipient privacy toggle (Settings -> Privacy)
    try:
        recip = db.session.get(User, int(recipient_id))
    except Exception:
        recip = None
    allow_mutual = True
    if recip is not None:
        # UI key is stored inside nc_settings_ui_state JSON and defaults to ON.
        allow_mutual = _nc_ui_allow(recip, 'privacyAllowDms', True)

    if allow_mutual and _have_mutual_non_dm_channel(int(sender_id), int(recipient_id)):
        return True
    return False

# --- v9 access helpers ---

def _get_channel_member(channel_id: int, user_id: int) -> ChannelMember | None:
    try:
        return ChannelMember.query.filter_by(channel_id=int(channel_id), user_id=int(user_id)).first()
    except Exception:
        return None


def _root_id_for_channel(ch: 'Channel') -> int:
    """Return root server id for a channel/subchannel.

    - DMs: returns channel id
    - Root server: returns its id
    - Subchannel: returns guild_id
    """
    try:
        if bool(getattr(ch, 'is_dm', False)):
            return int(getattr(ch, 'id', 0) or 0)
        gid = getattr(ch, 'guild_id', None)
        if gid is None:
            return int(getattr(ch, 'id', 0) or 0)
        gid_i = int(gid or 0)
        return gid_i if gid_i > 0 else int(getattr(ch, 'id', 0) or 0)
    except Exception:
        return int(getattr(ch, 'id', 0) or 0)

def _cleanup_temporary_memberships(guild_id: int) -> None:
    """Remove expired temporary memberships (v45).
    We expire only 'pending' memberships created via temporary invites.
    Called opportunistically on read endpoints.
    """
    try:
        now = utcnow()
        q = (
            ChannelMember.query
            .filter(ChannelMember.channel_id == int(guild_id))
            .filter(ChannelMember.is_temporary == True)
            .filter(ChannelMember.temporary_until.isnot(None))
            .filter(ChannelMember.temporary_until < now)
            .filter(ChannelMember.role == 'pending')
        )
        rows = q.all()
        if not rows:
            return
        for r in rows:
            try:
                db.session.delete(r)
            except Exception:
                pass
        db.session.commit()
    except Exception:
        db.session.rollback()
        return

def _require_membership(channel_id: int, user_id: int) -> tuple[Channel | None, ChannelMember | None]:
    ch = db.session.get(Channel, int(channel_id))
    if not ch:
        return None, None

    root_id = _root_id_for_channel(ch)
    mem = _get_channel_member(root_id, user_id)
    if not mem:
        return ch, None
    return ch, mem

def _is_channel_admin(mem: ChannelMember | None) -> bool:
    return bool(mem and (getattr(mem, 'role', '') == 'admin'))

def _is_channel_moderator(mem: ChannelMember | None) -> bool:
    return bool(mem and (getattr(mem, 'role', '') in ('moderator', 'admin')))



def _default_channel_perms_for_role(role: str, ch_type: str) -> dict:
    """Default permissions per member role (simplified Discord-like)."""
    r = (role or "member").lower()
    t = (ch_type or "text").lower()
    if r == "pending":
        return {"view": False, "send": False, "connect": False, "speak": False}
    base = {"view": True, "send": True, "connect": False, "speak": False}
    if t == "voice":
        base["connect"] = True
        base["speak"] = True
    return base

def _effective_channel_perms(ch: 'Channel', mem: ChannelMember | None) -> dict:
    """Compute effective permissions for a user in a channel."""
    try:
        if bool(getattr(ch, "is_dm", False)):
            return {"view": True, "send": True, "connect": True, "speak": True}
    except Exception:
        pass

    if not mem:
        return {"view": False, "send": False, "connect": False, "speak": False}

    if _is_channel_admin(mem):
        return {"view": True, "send": True, "connect": True, "speak": True}

    role = (getattr(mem, "role", None) or "member").lower()
    base = _default_channel_perms_for_role(role, (getattr(ch, "channel_type", None) or "text"))

    try:
        ov = ChannelPermissionOverride.query.filter_by(channel_id=int(ch.id), role=str(role)).first()
    except Exception:
        ov = None

    if ov:
        if ov.view_channel is not None:
            base["view"] = bool(ov.view_channel)
        if ov.send_messages is not None:
            base["send"] = bool(ov.send_messages)
        if ov.connect is not None:
            base["connect"] = bool(ov.connect)
        if ov.speak is not None:
            base["speak"] = bool(ov.speak)

    return base

def _permission_overrides_for_channel(channel_id: int) -> list[dict]:
    rows = []
    try:
        rs = ChannelPermissionOverride.query.filter_by(channel_id=int(channel_id)).all()
        for r in rs:
            rows.append({
                "role": (r.role or "member"),
                "view": (None if r.view_channel is None else bool(r.view_channel)),
                "send": (None if r.send_messages is None else bool(r.send_messages)),
                "connect": (None if r.connect is None else bool(r.connect)),
                "speak": (None if r.speak is None else bool(r.speak)),
            })
    except Exception:
        rows = []
    return rows

def _channel_icon_url(ch: 'Channel') -> str:
    try:
        root_id = _root_id_for_channel(ch)
        root = db.session.get(Channel, int(root_id)) if root_id else None
        p = (getattr(root, 'icon_path', '') or '').strip() if root else ''
        if not p:
            return ''
        return url_for('media_channel_icon', channel_id=int(root_id))
    except Exception:
        return ''
        return url_for('media_channel_icon', channel_id=int(getattr(ch, 'id', 0) or 0))
    except Exception:
        return ''

def _can_join_voice(mem: ChannelMember | None) -> bool:
    if not mem:
        return False
    return (getattr(mem, 'role', '') != 'pending')

def _get_or_create_channel_read(channel_id: int, user_id: int) -> ChannelRead:
    row = ChannelRead.query.filter_by(channel_id=int(channel_id), user_id=int(user_id)).first()
    if row:
        return row
    row = ChannelRead(channel_id=int(channel_id), user_id=int(user_id), last_read_message_id=0)
    db.session.add(row)
    db.session.commit()
    return row

def _unread_count(channel_id: int, user_id: int) -> int:
    try:
        cr = ChannelRead.query.filter_by(channel_id=int(channel_id), user_id=int(user_id)).first()
        last_read = int(getattr(cr, "last_read_message_id", 0) or 0) if cr else 0
        return (
            Message.query.filter(Message.channel_id == int(channel_id))
            .filter(Message.id > last_read)
            .filter(Message.user_id != int(user_id))
            .count()
        )
    except Exception:
        return 0

def _last_message(channel_id: int) -> Message | None:
    return (
        Message.query.filter_by(channel_id=int(channel_id))
        .order_by(Message.created_at.desc())
        .first()
    )

def _receipt_state_for_sender(message_id: int, recipient_id: int) -> dict:
    r = MessageReceipt.query.filter_by(message_id=int(message_id), user_id=int(recipient_id)).first()
    delivered = bool(r and r.delivered_at)
    read = bool(r and r.read_at)
    return {
        "delivered": delivered,
        "read": read,
        "delivered_at": _iso_z(r.delivered_at) if (r and r.delivered_at) else None,
        "read_at": _iso_z(r.read_at) if (r and r.read_at) else None,
    }

def _emit_to_user(user_id: int, event: str, data: dict):
    sids = user_sids.get(user_id) or set()
    for sid in sids:
        socketio.emit(event, data, to=sid)

# --- routes ---



# ===== Billing / subscriptions helpers (MVP) =====
def _billing_provider_name() -> str:
    return (os.environ.get("BILLING_PROVIDER") or "mock").strip().lower() or "mock"


def _billing_load_features(plan: SubscriptionPlan | None) -> dict:
    if not plan:
        return {}
    raw = getattr(plan, "features_json", None) or "{}"
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _billing_plan_public(plan: SubscriptionPlan | None) -> dict:
    if not plan:
        return {}
    return {
        "id": int(plan.id),
        "code": plan.code,
        "name": plan.name,
        "description": plan.description or "",
        "price_minor": int(getattr(plan, "price_minor", 0) or 0),
        "currency": (getattr(plan, "currency", "RUB") or "RUB"),
        "period_days": int(getattr(plan, "period_days", 30) or 30),
        "badge": getattr(plan, "badge", "") or "",
        "features": _billing_load_features(plan),
    }


def _billing_get_free_plan() -> SubscriptionPlan | None:
    return (
        SubscriptionPlan.query
        .filter_by(code="free")
        .first()
    )


def _billing_get_active_subscription(user_id: int) -> tuple[UserSubscription | None, SubscriptionPlan | None]:
    try:
        uid = int(user_id)
    except Exception:
        return None, None
    now = datetime.utcnow()
    sub = (
        UserSubscription.query
        .filter_by(user_id=uid)
        .filter(UserSubscription.status == "active")
        .order_by(UserSubscription.id.desc())
        .first()
    )
    if sub and sub.current_period_end and sub.current_period_end <= now:
        try:
            sub.status = "expired"
            sub.ended_at = now
            db.session.commit()
        except Exception:
            db.session.rollback()
        sub = None
    if not sub:
        return None, _billing_get_free_plan()
    plan = db.session.get(SubscriptionPlan, int(sub.plan_id))
    return sub, plan


def _billing_summary_for_user(user_id: int, include_payments: bool = False) -> dict:
    sub, plan = _billing_get_active_subscription(user_id)
    if not plan:
        plan = _billing_get_free_plan()
    status = "free"
    cancel_at_period_end = False
    provider = _billing_provider_name()
    started_at = None
    current_period_start = None
    current_period_end = None
    if sub:
        status = (sub.status or "active")
        cancel_at_period_end = bool(getattr(sub, "cancel_at_period_end", False))
        provider = (getattr(sub, "provider", None) or provider)
        started_at = _iso_z(getattr(sub, "started_at", None)) if getattr(sub, "started_at", None) else None
        current_period_start = _iso_z(getattr(sub, "current_period_start", None)) if getattr(sub, "current_period_start", None) else None
        current_period_end = _iso_z(getattr(sub, "current_period_end", None)) if getattr(sub, "current_period_end", None) else None
    data = {
        "provider": provider,
        "plan": _billing_plan_public(plan),
        "status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "started_at": started_at,
        "current_period_start": current_period_start,
        "current_period_end": current_period_end,
        "features": _billing_load_features(plan),
    }
    if include_payments:
        pays = (
            BillingPayment.query
            .filter_by(user_id=int(user_id))
            .order_by(BillingPayment.id.desc())
            .limit(10)
            .all()
        )
        data["payments"] = [
            {
                "id": int(p.id),
                "amount_minor": int(getattr(p, "amount_minor", 0) or 0),
                "currency": (getattr(p, "currency", "RUB") or "RUB"),
                "status": (getattr(p, "status", "") or ""),
                "provider": (getattr(p, "provider", "") or ""),
                "plan_code": (db.session.get(SubscriptionPlan, int(p.plan_id)).code if getattr(p, "plan_id", None) and db.session.get(SubscriptionPlan, int(p.plan_id)) else None),
                "paid_at": _iso_z(getattr(p, "paid_at", None)) if getattr(p, "paid_at", None) else None,
                "created_at": _iso_z(getattr(p, "created_at", None)) if getattr(p, "created_at", None) else None,
            }
            for p in pays
        ]
    return data


# ===== Gifts (subscription gifts / Nitro-like) =====

def _gift_normalize_code(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    # Accept full URLs like https://site/gift/NCGIFT-xxxx
    s = s.replace("\n", " ").replace("\r", " ").strip()
    m = re.search(r"(NCGIFT-[A-Za-z0-9_-]{10,})", s)
    if m:
        s = m.group(1)
    return s.strip()


def _gift_generate_code() -> str:
    # URL-safe, non-guessable
    token = secrets.token_urlsafe(18)
    # keep it pretty
    token = re.sub(r"[^A-Za-z0-9]", "", token)[:26]
    return f"NCGIFT-{token}"


def _gift_public(g: 'SubscriptionGift', include_code: bool = False) -> dict:
    plan = db.session.get(SubscriptionPlan, int(getattr(g, 'plan_id', 0) or 0)) if getattr(g, 'plan_id', None) else None
    from_u = db.session.get(User, int(getattr(g, 'from_user_id', 0) or 0)) if getattr(g, 'from_user_id', None) else None
    to_u = db.session.get(User, int(getattr(g, 'to_user_id', 0) or 0)) if getattr(g, 'to_user_id', None) else None
    redeemed_by = db.session.get(User, int(getattr(g, 'redeemed_by_user_id', 0) or 0)) if getattr(g, 'redeemed_by_user_id', None) else None
    out = {
        "id": int(g.id),
        "status": (getattr(g, 'status', '') or 'active'),
        "message": (getattr(g, 'message', '') or ''),
        "plan": _billing_plan_public(plan),
        "from": {
            "user_id": int(from_u.id) if from_u else int(getattr(g, 'from_user_id', 0) or 0),
            "username": (from_u.username if from_u else ''),
            "display_name": ((getattr(from_u, 'display_name', None) or from_u.username) if from_u else ''),
            "avatar_url": ((from_u.avatar_url or '') if from_u else ''),
        },
        "to": {
            "user_id": int(to_u.id) if to_u else (int(getattr(g, 'to_user_id', 0) or 0) if getattr(g, 'to_user_id', None) else None),
            "username": (to_u.username if to_u else ''),
            "display_name": ((getattr(to_u, 'display_name', None) or to_u.username) if to_u else ''),
            "avatar_url": ((to_u.avatar_url or '') if to_u else ''),
        } if (getattr(g, 'to_user_id', None) is not None) else None,
        "redeemed_by": {
            "user_id": int(redeemed_by.id) if redeemed_by else (int(getattr(g, 'redeemed_by_user_id', 0) or 0) if getattr(g, 'redeemed_by_user_id', None) else None),
            "username": (redeemed_by.username if redeemed_by else ''),
            "display_name": ((getattr(redeemed_by, 'display_name', None) or redeemed_by.username) if redeemed_by else ''),
            "avatar_url": ((redeemed_by.avatar_url or '') if redeemed_by else ''),
        } if (getattr(g, 'redeemed_by_user_id', None) is not None) else None,
        "created_at": _iso_z(getattr(g, 'created_at', None)) if getattr(g, 'created_at', None) else None,
        "expires_at": _iso_z(getattr(g, 'expires_at', None)) if getattr(g, 'expires_at', None) else None,
        "redeemed_at": _iso_z(getattr(g, 'redeemed_at', None)) if getattr(g, 'redeemed_at', None) else None,
        "claim_path": f"/gift/{getattr(g, 'code', '')}",
    }
    if include_code:
        out["code"] = getattr(g, 'code', '')
    return out


def _billing_apply_gift_to_user(user_id: int, plan: SubscriptionPlan, gift: 'SubscriptionGift') -> None:
    now = datetime.utcnow()
    period_days = int(getattr(plan, 'period_days', 30) or 30)
    if period_days < 1:
        period_days = 30

    sub, _cur = _billing_get_active_subscription(int(user_id))
    base = now
    if sub and getattr(sub, 'current_period_end', None) and sub.current_period_end and sub.current_period_end > now:
        base = sub.current_period_end

    new_end = base + timedelta(days=period_days)

    if sub:
        # Extend existing subscription
        sub.plan_id = int(plan.id)
        sub.provider = 'gift'
        sub.status = 'active'
        sub.cancel_at_period_end = False
        if (not sub.current_period_end) or (sub.current_period_end <= now):
            sub.current_period_start = now
            sub.started_at = sub.started_at or now
        sub.current_period_end = new_end
        if not getattr(sub, 'provider_subscription_id', None):
            sub.provider_subscription_id = f"gift_sub_{gift.id}_{int(now.timestamp())}"
        db.session.add(sub)
        db.session.flush()
    else:
        sub = UserSubscription(
            user_id=int(user_id),
            plan_id=int(plan.id),
            provider='gift',
            provider_subscription_id=f"gift_sub_{gift.id}_{int(now.timestamp())}",
            status='active',
            started_at=now,
            current_period_start=now,
            current_period_end=new_end,
            cancel_at_period_end=False,
        )
        db.session.add(sub)
        db.session.flush()

    # Receiver payment record (0 amount; the purchase is logged on giver side)
    try:
        payload = {
            'type': 'gift_redeem',
            'gift_id': int(gift.id),
            'gift_code': getattr(gift, 'code', ''),
            'from_user_id': int(getattr(gift, 'from_user_id', 0) or 0),
            'plan_code': getattr(plan, 'code', ''),
        }
    except Exception:
        payload = {'type': 'gift_redeem'}

    pay = BillingPayment(
        user_id=int(user_id),
        subscription_id=int(sub.id) if sub else None,
        plan_id=int(plan.id),
        provider='gift',
        provider_payment_id=f"gift_redeem_{gift.id}_{int(user_id)}_{int(now.timestamp())}",
        amount_minor=0,
        currency=(getattr(plan, 'currency', 'RUB') or 'RUB'),
        status='succeeded',
        payload_json=json.dumps(payload, ensure_ascii=False),
        paid_at=now,
    )
    db.session.add(pay)

def _seed_subscription_plans() -> None:
    defaults = [
        {
            "code": "free",
            "name": "Free",
            "description": "Стартовый аккаунт для чатов, звонков и подарков",
            "price_minor": 0,
            "currency": "RUB",
            "period_days": 30,
            "badge": "FREE",
            "sort_order": 0,
            "features": {
                "hd_stream": False,
                "stream_1080p": False,
                "stream_60fps": False,
                "stream_1440p": False,
                "profile_badge": False,
                "max_upload_mb": 25,
                "name_styles": False,
                "avatar_decor": False,
                "theme_packs_basic": False,
                "badge_showcase": False,
                "pro_effects": False,
            },
        },
        {
            "code": "plus",
            "name": "NEON Plus",
            "description": "Средний пакет: 1080p-демка, кастомизация профиля и повышенные лимиты",
            "price_minor": 29900,
            "currency": "RUB",
            "period_days": 30,
            "badge": "PLUS",
            "sort_order": 10,
            "features": {
                "hd_stream": True,
                "stream_1080p": True,
                "stream_60fps": False,
                "stream_1440p": False,
                "profile_badge": True,
                "max_upload_mb": 100,
                "name_styles": True,
                "avatar_decor": True,
                "theme_packs_basic": True,
                "badge_showcase": False,
                "pro_effects": False,
            },
        },
        {
            "code": "pro",
            "name": "NEON Pro",
            "description": "Максимум Neon: 60 FPS, полный набор эффектов и самые большие лимиты",
            "price_minor": 59900,
            "currency": "RUB",
            "period_days": 30,
            "badge": "PRO",
            "sort_order": 20,
            "features": {
                "hd_stream": True,
                "stream_1080p": True,
                "stream_60fps": True,
                "stream_1440p": True,
                "profile_badge": True,
                "max_upload_mb": 500,
                "name_styles": True,
                "avatar_decor": True,
                "theme_packs_basic": True,
                "badge_showcase": True,
                "pro_effects": True,
            },
        },
    ]
    changed = False
    for item in defaults:
        plan = SubscriptionPlan.query.filter_by(code=item["code"]).first()
        if not plan:
            plan = SubscriptionPlan(code=item["code"])
            db.session.add(plan)
            changed = True
        # Keep names/prices in sync with defaults for MVP (easy to change later)
        plan.name = item["name"]
        plan.description = item["description"]
        plan.price_minor = int(item["price_minor"])
        plan.currency = item["currency"]
        plan.period_days = int(item["period_days"])
        plan.badge = item["badge"]
        plan.sort_order = int(item["sort_order"])
        plan.is_active = True
        feats = json.dumps(item.get("features") or {}, ensure_ascii=False, separators=(",", ":"))
        if (plan.features_json or "") != feats:
            plan.features_json = feats
            changed = True
    if changed:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()


def _billing_has_feature(user_id: int, feature_key: str) -> bool:
    try:
        info = _billing_summary_for_user(int(user_id), include_payments=False)
        val = (info.get("features") or {}).get(str(feature_key))
        if isinstance(val, bool):
            return val
        if isinstance(val, (int, float)):
            return bool(val)
        return str(val).lower() in {"1", "true", "yes", "on"}
    except Exception:
        return False


def _billing_feature_int(user_id: int, feature_key: str, default: int = 0) -> int:
    try:
        info = _billing_summary_for_user(int(user_id), include_payments=False)
        return int((info.get("features") or {}).get(str(feature_key), default))
    except Exception:
        return int(default)


def _billing_activate_plan_and_payment(
    user_id: int,
    plan: SubscriptionPlan,
    *,
    provider: str = "mock",
    provider_subscription_id: str | None = None,
    provider_payment_id: str | None = None,
    amount_minor: int | None = None,
    currency: str | None = None,
    payload: dict | None = None,
) -> dict:
    """Activate a user plan and mark payment succeeded (idempotent by provider_payment_id)."""
    now = datetime.utcnow()
    period_days = int(getattr(plan, "period_days", 30) or 30)
    current_end = now + timedelta(days=period_days)

    prevs = (
        UserSubscription.query
        .filter_by(user_id=int(user_id))
        .filter(UserSubscription.status == "active")
        .all()
    )
    for prev in prevs:
        prev.status = "canceled"
        prev.cancel_at_period_end = False
        prev.canceled_at = now
        prev.ended_at = now

    sub = UserSubscription(
        user_id=int(user_id),
        plan_id=int(plan.id),
        provider=(provider or "mock"),
        provider_subscription_id=(provider_subscription_id or f"{provider or 'mock'}_sub_{user_id}_{int(now.timestamp())}"),
        status="active",
        started_at=now,
        current_period_start=now,
        current_period_end=current_end,
        cancel_at_period_end=False,
    )
    db.session.add(sub)
    db.session.flush()

    pay = None
    if provider_payment_id:
        pay = (
            BillingPayment.query
            .filter(BillingPayment.provider == (provider or "mock"))
            .filter(BillingPayment.provider_payment_id == str(provider_payment_id))
            .order_by(BillingPayment.id.desc())
            .first()
        )
    if not pay:
        pay = BillingPayment(
            user_id=int(user_id),
            subscription_id=int(sub.id),
            plan_id=int(plan.id),
            provider=(provider or "mock"),
            provider_payment_id=(provider_payment_id or f"{provider or 'mock'}_pay_{user_id}_{int(now.timestamp())}"),
            amount_minor=int(amount_minor if amount_minor is not None else (getattr(plan, "price_minor", 0) or 0)),
            currency=(currency or getattr(plan, "currency", "RUB") or "RUB"),
            status="succeeded",
            payload_json=json.dumps(payload or {"plan_code": plan.code, "provider": provider}, ensure_ascii=False),
            paid_at=now,
        )
        db.session.add(pay)
    else:
        pay.user_id = int(user_id)
        pay.subscription_id = int(sub.id)
        pay.plan_id = int(plan.id)
        pay.status = "succeeded"
        pay.amount_minor = int(amount_minor if amount_minor is not None else (getattr(plan, "price_minor", 0) or pay.amount_minor or 0))
        pay.currency = (currency or getattr(plan, "currency", "RUB") or pay.currency or "RUB")
        pay.paid_at = now
        if payload is not None:
            try:
                pay.payload_json = json.dumps(payload, ensure_ascii=False)
            except Exception:
                pass

    db.session.commit()
    return _billing_summary_for_user(int(user_id), include_payments=True)


def _billing_create_checkout_for_user(user: User, plan: SubscriptionPlan) -> dict:
    provider = _billing_provider_name()
    if not plan or (getattr(plan, "code", "") == "free"):
        raise ValueError("Для бесплатного тарифа checkout не нужен")

    if provider == "mock":
        billing = _billing_activate_plan_and_payment(
            int(user.id), plan,
            provider="mock",
            provider_subscription_id=f"mock_sub_{user.id}_{int(time.time())}",
            provider_payment_id=f"mock_pay_{user.id}_{int(time.time())}",
            amount_minor=int(getattr(plan, "price_minor", 0) or 0),
            currency=(getattr(plan, "currency", "RUB") or "RUB"),
            payload={"mode": "mock_checkout", "plan_code": plan.code},
        )
        return {"provider": "mock", "mode": "activated", "billing": billing}

    if provider == "yookassa":
        shop_id = (os.environ.get("YOOKASSA_SHOP_ID") or "").strip()
        secret_key = (os.environ.get("YOOKASSA_SECRET_KEY") or "").strip()
        if not shop_id or not secret_key:
            raise RuntimeError("Не настроены YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY")

        return_url = (os.environ.get("BILLING_RETURN_URL") or "").strip()
        if not return_url:
            return_url = (request.host_url.rstrip("/") + "/app") if request.host_url else "/app"

        body = {
            "amount": {
                "value": f"{(int(getattr(plan, 'price_minor', 0) or 0) / 100):.2f}",
                "currency": (getattr(plan, "currency", "RUB") or "RUB").upper(),
            },
            "capture": True,
            "confirmation": {"type": "redirect", "return_url": return_url},
            "description": f"Neon Chat {plan.name}",
            "metadata": {"user_id": str(int(user.id)), "plan_code": str(plan.code)},
        }
        idem = uuid.uuid4().hex
        auth = base64.b64encode(f"{shop_id}:{secret_key}".encode("utf-8")).decode("ascii")
        req = urllib.request.Request(
            "https://api.yookassa.ru/v3/payments",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/json",
                "Idempotence-Key": idem,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw or "{}")
        except urllib.error.HTTPError as e:
            err = ''
            try:
                err = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            raise RuntimeError(f"YooKassa error {e.code}: {err[:260]}")
        except Exception as e:
            raise RuntimeError(f"YooKassa error: {e}")

        payment_id = str((data or {}).get("id") or "").strip()
        checkout_url = ((data or {}).get("confirmation") or {}).get("confirmation_url")
        if not payment_id or not checkout_url:
            raise RuntimeError("YooKassa не вернула confirmation_url")

        existing = BillingPayment.query.filter_by(provider="yookassa", provider_payment_id=payment_id).first()
        if not existing:
            db.session.add(BillingPayment(
                user_id=int(user.id),
                subscription_id=None,
                plan_id=int(plan.id),
                provider="yookassa",
                provider_payment_id=payment_id,
                amount_minor=int(getattr(plan, "price_minor", 0) or 0),
                currency=(getattr(plan, "currency", "RUB") or "RUB"),
                status="pending",
                payload_json=json.dumps(data, ensure_ascii=False),
                paid_at=None,
            ))
            db.session.commit()

        return {"provider": "yookassa", "mode": "redirect", "checkout_url": checkout_url, "payment_id": payment_id}

    raise RuntimeError(f"Провайдер '{provider}' пока не поддерживается (MVP checkout)")


def register_routes(app: Flask):
    @app.before_request
    def _nc_kick_disabled_users():
        """Prevent disabled/deleted accounts from using the app even if their session cookie exists."""
        try:
            if current_user.is_authenticated:
                if bool(getattr(current_user, "is_deleted", False)) or bool(getattr(current_user, "is_disabled", False)):
                    # Keep login/recover accessible.
                    allowed = {"login", "recover_password", "logout", "index", "static"}
                    logout_user()
                    try:
                        session.pop("user_id", None)
                    except Exception:
                        pass
                    if (request.endpoint or "") not in allowed:
                        return redirect(url_for("login"))
        except Exception:
            # Never block request on errors.
            return None

    @app.before_request
    def _nc_auth_sessions_guard():
        """Fix268: validate per-device auth cookie and keep last_seen fresh."""
        try:
            if not current_user.is_authenticated:
                return None

            uid = int(getattr(current_user, "id", 0) or 0)
            if not uid:
                return None

            rec, tok = _nc_get_auth_session_for_request(uid)

            # No cookie yet -> issue one (after_request will set)
            if not tok:
                nt, nrec = _nc_issue_auth_session(uid)
                if nt:
                    g._nc_set_auth_cookie = nt
                    try:
                        g._nc_auth_session_id = nrec.id if nrec else None
                    except Exception:
                        pass
                return None

            # Cookie exists but session not found -> force logout
            if not rec:
                try:
                    logout_user()
                except Exception:
                    pass
                try:
                    session.clear()
                except Exception:
                    pass
                g._nc_clear_auth_cookie = True
                if request.path.startswith("/api/"):
                    return jsonify(ok=False, error="unauthorized"), 401
                return redirect(url_for("login"))

            # Session ok -> update last seen (throttled)
            try:
                g._nc_auth_session_id = rec.id
            except Exception:
                pass

            try:
                now = datetime.utcnow()
                if (not rec.last_seen_at) or ((now - rec.last_seen_at).total_seconds() > 30):
                    rec.last_seen_at = now
                    ua = (request.headers.get("User-Agent") or "")
                    ip = (_nc_client_ip() or "")
                    if ua and ua != (rec.user_agent or ""):
                        rec.user_agent = ua[:512]
                    if ip and ip != (rec.ip_address or ""):
                        rec.ip_address = ip[:64]
                    db.session.commit()
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass
        except Exception:
            pass
        return None


    @app.after_request
    def _nc_auth_sessions_apply(resp):
        """Fix268: apply auth cookie set/clear."""
        try:
            tok = getattr(g, "_nc_set_auth_cookie", None)
            if tok:
                resp.set_cookie(
                    AUTH_SESSION_COOKIE,
                    tok,
                    max_age=AUTH_SESSION_MAX_AGE,
                    httponly=True,
                    samesite="Lax",
                )
        except Exception:
            pass
        try:
            if getattr(g, "_nc_clear_auth_cookie", False):
                resp.delete_cookie(AUTH_SESSION_COOKIE)
        except Exception:
            pass
        return resp

    @app.route("/")
    def index():
        if current_user.is_authenticated:
            return redirect(url_for("chat"))
        return redirect(url_for("login"))


    @app.route("/gift/<code>")
    def gift_landing(code: str):
        c = _gift_normalize_code(code)
        gift = SubscriptionGift.query.filter_by(code=c).first() if c else None
        gift_pub = _gift_public(gift, include_code=False) if gift else None
        # basic validity for UI
        now = datetime.utcnow()
        is_active = bool(gift and (getattr(gift, 'status', 'active') == 'active') and (not gift.expires_at or gift.expires_at > now))
        intended_ok = bool((not gift) or (not gift.to_user_id) or (current_user.is_authenticated and int(gift.to_user_id) == int(current_user.id)))
        return render_template(
            "gift.html",
            gift=gift_pub,
            code=c,
            is_active=is_active,
            intended_ok=intended_ok,
        )
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("chat"))
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            username_norm = _norm_username(username)
            email = None
            password = request.form.get("password", "")

            if not username or not password:
                flash("Заполни ник и пароль.", "error")
                return render_template("register.html")

            if not (8 <= len(password) <= 24):
                flash("Пароль должен быть от 8 до 24 символа.", "error")
                return render_template("register.html")

            ok, msg = _validate_password(password, username=username)
            if not ok:
                flash(msg, "error")
                return render_template("register.html")

            # Case-insensitive uniqueness
            if User.query.filter_by(username_norm=username_norm).first():
                flash("Имя занято.", "error")
                return render_template("register.html")

            user = User(username=username, username_norm=username_norm, display_name=username, email=None)
            user.set_password(password)
            db.session.add(user)
            db.session.commit()

            # v32: assign a random preset avatar on signup
            try:
                if not getattr(user, 'avatar_url', None):
                    user.avatar_url = _pick_preset_avatar_url()
                    db.session.commit()
            except Exception:
                db.session.rollback()

            # Safety: don't auto-create a default public channel per user on registration.
            # Older builds accidentally created a channel named "1" (or str(user.id)) for each new user.
            # If it appears right after signup and has no messages, remove it.
            try:
                from datetime import timedelta
                now = utcnow()
                suspects = Channel.query.filter(
                    Channel.is_dm == False,  # noqa: E712
                    Channel.name.in_([str(user.id), "1"]),
                    Channel.created_at >= (now - timedelta(seconds=30)),
                ).all()
                for chx in suspects:
                    has_msgs = Message.query.filter_by(channel_id=chx.id).first() is not None
                    if not has_msgs:
                        ChannelMember.query.filter_by(channel_id=chx.id).delete()
                        db.session.delete(chx)
                db.session.commit()
            except Exception:
                # If anything goes wrong, registration should still succeed.
                db.session.rollback()

            codes = _make_recovery_codes(10)
            _save_recovery_codes(user.id, codes)
            # allow one extra download later from Settings
            try:
                user.display_name = user.display_name or user.username
                user.recovery_codes_plain = "\n".join(codes)
                user.recovery_redownload_left = 1
                db.session.commit()
            except Exception:
                db.session.rollback()

            login_user(user)
            session["recovery_codes_once"] = codes
            return redirect(url_for("recovery_codes"))

        return render_template("register.html")

    @app.route("/recovery-codes")
    @login_required
    def recovery_codes():
        codes = session.pop("recovery_codes_once", None)
        return render_template("recovery_codes.html", codes=codes)

    @app.route("/settings/recovery-codes", methods=["POST"])
    @login_required
    def regen_recovery_codes():
        codes = _make_recovery_codes(10)
        _save_recovery_codes(current_user.id, codes)
        # allow one extra download later from Settings
        try:
            current_user.recovery_codes_plain = "\n".join(codes)
            current_user.recovery_redownload_left = 1
            db.session.commit()
        except Exception:
            db.session.rollback()
        session["recovery_codes_once"] = codes
        flash("Новые коды сгенерированы. Старые больше не работают.", "ok")
        return redirect(url_for("recovery_codes"))
    @app.route("/login", methods=["GET", "POST"])
    def login():
        def _safe_next(raw):
            try:
                s = str(raw or "").strip()
            except Exception:
                return None
            if not s:
                return None
            if not s.startswith("/") or s.startswith("//"):
                return None
            # basic allow-list: printable path/query only
            if "\\" in s:
                return None
            return s

        nxt = _safe_next(request.args.get("next") or request.form.get("next") or "")

        if current_user.is_authenticated:
            return redirect(nxt) if nxt else redirect(url_for("chat"))
        if request.method == "GET":
            try:
                if (request.args.get('reason') or '').strip() == 'not_me':
                    flash('Вы вышли со всех устройств. Рекомендуется сразу сменить пароль.', 'ok')
            except Exception:
                pass
        if request.method == "POST":
            login_value = (request.form.get("login") or request.form.get("username") or "").strip()
            password = request.form.get("password", "")

            block = _nc_find_active_auth_block(login_value=login_value, phase='login')
            if block:
                _nc_record_auth_attempt('blocked_login', login_value=_nc_login_norm(login_value), note=(block.reason or 'active_block'))
                flash(_nc_auth_block_message(block, phase='login') or "Вход временно заблокирован.", "error")
                return _nc_render_login(nxt)

            if _nc_auth_should_require_captcha(login_value=login_value, phase='login'):
                captcha_answer = request.form.get('captcha_answer', '')
                if not _nc_auth_validate_challenge(captcha_answer, phase='login'):
                    _nc_record_auth_attempt('bad_captcha_login', login_value=_nc_login_norm(login_value), note='human_check_failed')
                    _nc_auth_maybe_activate_block(login_value=login_value, phase='login')
                    flash("Подтвердите, что вход выполняет человек.", "error")
                    return _nc_render_login(nxt)

            limited, limited_msg = _nc_auth_rate_limit(login_value=login_value, phase='login')
            if limited:
                _nc_record_auth_attempt('rate_limited_login', login_value=_nc_login_norm(login_value), note='login')
                _nc_auth_maybe_activate_block(login_value=login_value, phase='login')
                flash(limited_msg or "Слишком много попыток. Подождите и попробуйте снова.", "error")
                return _nc_render_login(nxt)

            user = None
            if login_value:
                try:
                    norm = _norm_username(login_value)
                except Exception:
                    norm = (login_value or '').strip().lower()
                try:
                    user = User.query.filter_by(username_norm=norm).first()
                except Exception:
                    user = None
                if not user:
                    user = User.query.filter_by(username=login_value).first()

            if not user:
                _nc_record_auth_attempt('bad_login', login_value=_nc_login_norm(login_value), note='unknown_login')
                _nc_auth_maybe_activate_block(login_value=login_value, phase='login')
                flash("Неверные данные.", "error")
            elif not user.check_password(password):
                _nc_record_auth_attempt('bad_password', user=user, login_value=_nc_login_norm(login_value), note='wrong_password')
                _nc_auth_maybe_activate_block(login_value=login_value, user=user, phase='login')
                flash("Неверные данные.", "error")
            else:
                if bool(getattr(user, "is_deleted", False)):
                    _nc_record_auth_attempt('bad_login', user=user, login_value=_nc_login_norm(login_value), note='deleted_account')
                    flash("Этот аккаунт удалён.", "error")
                    return _nc_render_login(nxt)
                if bool(getattr(user, "is_disabled", False)):
                    _nc_record_auth_attempt('bad_login', user=user, login_value=_nc_login_norm(login_value), note='disabled_account')
                    flash("Этот аккаунт отключён. Включите его в настройках или обратитесь к администратору.", "error")
                    return _nc_render_login(nxt)
                # If 2FA enabled, require TOTP before completing login
                if _totp_enabled_for_user(user):
                    session["pre_2fa_user_id"] = int(user.id)
                    session["pre_2fa_login_value"] = _nc_login_norm(login_value)
                    if nxt:
                        session["pre_2fa_next"] = nxt
                    return redirect(url_for("twofa"))
                login_user(user)
                resp = redirect(nxt) if nxt else redirect(url_for("chat"))
                _issued_rec = None
                try:
                    tok, _rec = _nc_issue_auth_session(int(user.id))
                    _issued_rec = _rec
                    if tok:
                        resp.set_cookie(
                            AUTH_SESSION_COOKIE,
                            tok,
                            max_age=AUTH_SESSION_MAX_AGE,
                            httponly=True,
                            samesite="Lax",
                        )
                except Exception:
                    pass
                try:
                    _nc_record_auth_attempt('success_login', user=user, login_value=_nc_login_norm(login_value), session_id=(getattr(_issued_rec, 'id', None) if _issued_rec else None), note='login_ok')
                except Exception:
                    pass
                _nc_auth_clear_challenge('login')
                return resp

        return _nc_render_login(nxt)

    @app.route("/twofa", methods=["GET", "POST"])
    def twofa():
        if current_user.is_authenticated:
            return redirect(url_for("chat"))

        uid = session.get("pre_2fa_user_id")
        if not uid:
            return redirect(url_for("login"))

        user = db.session.get(User, int(uid))
        if not user or not _totp_enabled_for_user(user):
            session.pop("pre_2fa_user_id", None)
            return redirect(url_for("login"))

        if request.method == "POST":
            code = (request.form.get("code") or "").strip()
            rcode = (request.form.get("recovery_code") or "").strip().upper()

            block = _nc_find_active_auth_block(user=user, phase='2fa')
            if block:
                _nc_record_auth_attempt('blocked_2fa', user=user, login_value=session.get('pre_2fa_login_value') or _nc_login_norm(user.username), note=(block.reason or 'active_block'))
                flash(_nc_auth_block_message(block, phase='2fa') or "Временная блокировка 2FA.", "error")
                return _nc_render_twofa(user.username)

            if _nc_auth_should_require_captcha(user=user, phase='2fa'):
                captcha_answer = request.form.get('captcha_answer', '')
                if not _nc_auth_validate_challenge(captcha_answer, phase='2fa'):
                    _nc_record_auth_attempt('bad_captcha_2fa', user=user, login_value=session.get('pre_2fa_login_value') or _nc_login_norm(user.username), note='human_check_failed')
                    _nc_auth_maybe_activate_block(user=user, phase='2fa')
                    flash("Сначала пройдите проверку, что вы не бот.", "error")
                    return _nc_render_twofa(user.username)

            limited, limited_msg = _nc_auth_rate_limit(user=user, phase='2fa')
            if limited:
                _nc_record_auth_attempt('rate_limited_2fa', user=user, login_value=session.get('pre_2fa_login_value') or _nc_login_norm(user.username), note='2fa')
                _nc_auth_maybe_activate_block(user=user, phase='2fa')
                flash(limited_msg or "Слишком много попыток. Подождите и попробуйте снова.", "error")
                return _nc_render_twofa(user.username)

            ok = False
            if code:
                ok = _totp_verify_and_mark(user, code)
            elif rcode:
                ok = _use_recovery_code(user.id, rcode)

            if not ok:
                _nc_record_auth_attempt('bad_2fa', user=user, login_value=session.get('pre_2fa_login_value') or _nc_login_norm(user.username), note=('recovery_code' if rcode else 'totp'))
                _nc_auth_maybe_activate_block(user=user, phase='2fa')
                flash("Неверный код.", "error")
                return _nc_render_twofa(user.username)

            session.pop("pre_2fa_user_id", None)
            nxt = session.pop("pre_2fa_next", None)
            login_value_for_audit = session.pop("pre_2fa_login_value", None) or _nc_login_norm(user.username)
            login_user(user)
            resp = redirect(nxt) if nxt else redirect(url_for("chat"))
            _issued_rec = None
            try:
                tok, _rec = _nc_issue_auth_session(int(user.id))
                _issued_rec = _rec
                if tok:
                    resp.set_cookie(
                        AUTH_SESSION_COOKIE,
                        tok,
                        max_age=AUTH_SESSION_MAX_AGE,
                        httponly=True,
                        samesite="Lax",
                    )
            except Exception:
                pass
            try:
                _nc_record_auth_attempt('success_2fa', user=user, login_value=login_value_for_audit, session_id=(getattr(_issued_rec, 'id', None) if _issued_rec else None), note=('recovery_code' if rcode else 'totp'))
            except Exception:
                pass
            return resp

        return render_template("twofa.html", username=user.username)



def _nc_admin_security_apply_attempt_filters(query):
    q = (request.args.get('q') or '').strip()
    status = (request.args.get('status') or '').strip().lower()
    kind = (request.args.get('kind') or '').strip().lower()
    if q:
        like = f"%{q[:160]}%"
        query = query.filter(or_(AuthAttempt.login_value.ilike(like), AuthAttempt.ip_address.ilike(like), AuthAttempt.note.ilike(like), AuthAttempt.status.ilike(like)))
    if status:
        query = query.filter(AuthAttempt.status == status[:32])
    if kind == 'failed':
        query = query.filter(AuthAttempt.status.in_(_nc_auth_fail_statuses('login') + _nc_auth_fail_statuses('2fa')))
    elif kind == 'success':
        query = query.filter(AuthAttempt.status.in_(['success_login', 'success_2fa']))
    elif kind == 'invalid':
        query = query.filter(AuthAttempt.status.in_(['bad_login', 'rate_limited_login', 'blocked_login']))
    return query


def _nc_admin_security_apply_block_filters(query):
    q = (request.args.get('q') or '').strip()
    phase = (request.args.get('phase') or '').strip().lower()
    scope_type = (request.args.get('scope_type') or '').strip().lower()
    active = (request.args.get('active') or '').strip().lower()
    if q:
        like = f"%{q[:160]}%"
        query = query.filter(or_(AuthSecurityBlock.scope_value.ilike(like), AuthSecurityBlock.reason.ilike(like), AuthSecurityBlock.scope_type.ilike(like)))
    if phase:
        query = query.filter(AuthSecurityBlock.phase == phase[:16])
    if scope_type:
        query = query.filter(AuthSecurityBlock.scope_type == scope_type[:16])
    if active == '1':
        query = query.filter(AuthSecurityBlock.active.is_(True), AuthSecurityBlock.expires_at > datetime.utcnow())
    elif active == '0':
        query = query.filter(or_(AuthSecurityBlock.active.is_(False), AuthSecurityBlock.expires_at <= datetime.utcnow()))
    return query


def _nc_admin_security_stats() -> dict:
    now = datetime.utcnow()
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(days=7)
    try:
        attempts_24h = AuthAttempt.query.filter(AuthAttempt.created_at >= day_ago).count()
    except Exception:
        attempts_24h = 0
    try:
        failed_24h = AuthAttempt.query.filter(AuthAttempt.created_at >= day_ago, AuthAttempt.status.in_(_nc_auth_fail_statuses('login') + _nc_auth_fail_statuses('2fa'))).count()
    except Exception:
        failed_24h = 0
    try:
        active_blocks = AuthSecurityBlock.query.filter(AuthSecurityBlock.active.is_(True), AuthSecurityBlock.expires_at > now).count()
    except Exception:
        active_blocks = 0
    top_ip = None
    try:
        top_ip_counts = {}
        for row in AuthAttempt.query.filter(AuthAttempt.created_at >= day_ago).all():
            ip = (row.ip_address or '').strip()
            if ip:
                top_ip_counts[ip] = top_ip_counts.get(ip, 0) + 1
        if top_ip_counts:
            ip, count = sorted(top_ip_counts.items(), key=lambda kv: kv[1], reverse=True)[0]
            top_ip = {'ip_address': ip, 'count': int(count)}
    except Exception:
        top_ip = None
    try:
        recent_alerts = AuthAttempt.query.filter(AuthAttempt.created_at >= week_ago, AuthAttempt.status.in_(['blocked_login','blocked_2fa','rate_limited_login','rate_limited_2fa','bad_login'])).order_by(AuthAttempt.created_at.desc()).limit(12).all()
    except Exception:
        recent_alerts = []
    return {
        'attempts_24h': int(attempts_24h or 0),
        'failed_24h': int(failed_24h or 0),
        'active_blocks': int(active_blocks or 0),
        'top_ip': top_ip,
        'recent_alerts': recent_alerts,
    }



def _nc_admin_record_user_action(user_id: int, action_type: str, *, reason: str = '', duration_minutes: int | None = None, guild_id: int | None = None, is_active: bool = True):
    row = AdminUserAction(
        user_id=int(user_id),
        admin_user_id=(int(current_user.id) if getattr(current_user, 'is_authenticated', False) else None),
        guild_id=(int(guild_id) if guild_id else None),
        action_type=(action_type or '').strip().lower()[:24] or 'note',
        reason=(reason or '').strip()[:1000] or None,
        duration_minutes=(int(duration_minutes) if duration_minutes else None),
        expires_at=(datetime.utcnow() + timedelta(minutes=int(duration_minutes)) if duration_minutes else None),
        is_active=bool(is_active),
    )
    db.session.add(row)
    return row


def _nc_support_role_for_user(user_id: int) -> str:
    try:
        uid = int(user_id or 0)
    except Exception:
        uid = 0
    if uid <= 0:
        return 'support'
    if uid == 1:
        return 'head_support'
    try:
        row = SupportStaffProfile.query.filter_by(user_id=uid).first()
    except Exception:
        row = None
    role_level = (getattr(row, 'role_level', None) or 'support').strip().lower()
    return role_level if role_level in SUPPORT_ROLE_LEVELS else 'support'


def _nc_support_role_label(role_level: str) -> str:
    return {
        'support': 'Support',
        'senior_support': 'Senior Support',
        'head_support': 'Head Support',
    }.get((role_level or 'support').strip().lower(), 'Support')


def _nc_support_csv_tokens(raw) -> list[str]:
    parts = re.split(r'[,;\n]+', str(raw or ''))
    out = []
    seen = set()
    for item in parts:
        token = str(item or '').strip().lower()
        if not token or token in seen:
            continue
        seen.add(token)
        out.append(token)
    return out


def _nc_support_profile_categories(row) -> list[str]:
    return _nc_support_csv_tokens(getattr(row, 'categories_csv', None))


def _nc_support_profile_skills(row) -> list[str]:
    return _nc_support_csv_tokens(getattr(row, 'skills_csv', None))


def _nc_support_skill_catalog() -> list[str]:
    return ['security', 'billing', 'technical', 'voice', 'media', 'performance', 'ui', 'accounts', 'mobile', 'other']


def _nc_support_sla_rule_match(ticket, row) -> tuple[int, int]:
    category = (getattr(ticket, 'category', None) or 'other').strip().lower()
    priority = (getattr(ticket, 'priority', None) or 'normal').strip().lower()
    row_cat = (getattr(row, 'category', None) or '*').strip().lower() or '*'
    row_prio = (getattr(row, 'priority', None) or '*').strip().lower() or '*'
    cat_score = 2 if row_cat == category else (1 if row_cat == '*' else -10)
    prio_score = 2 if row_prio == priority else (1 if row_prio == '*' else -10)
    return (cat_score, prio_score)


def _nc_support_rule_for_ticket(ticket):
    rows = []
    try:
        rows = SupportSlaRule.query.filter(SupportSlaRule.is_enabled.is_(True)).order_by(SupportSlaRule.id.asc()).all()
    except Exception:
        rows = []
    best = None
    for row in rows:
        score = _nc_support_sla_rule_match(ticket, row)
        if min(score) < 0:
            continue
        if best is None or score > best[0]:
            best = (score, row)
    return best[1] if best else None


def _nc_support_sla_config_for_ticket(ticket) -> dict:
    priority = (getattr(ticket, 'priority', None) or 'normal').strip().lower()
    base = SUPPORT_SLA_MINUTES.get(priority, SUPPORT_SLA_MINUTES['normal'])
    out = {'first': int(base['first']), 'user': int(base['user']), 'escalate_after': 30, 'required_role': _nc_support_role_label('support'), 'required_role_key': 'support'}
    rule = _nc_support_rule_for_ticket(ticket)
    if rule is not None:
        out['first'] = max(5, int(getattr(rule, 'first_reply_minutes', out['first']) or out['first']))
        out['user'] = max(5, int(getattr(rule, 'next_reply_minutes', out['user']) or out['user']))
        out['escalate_after'] = max(5, int(getattr(rule, 'escalate_after_minutes', out['escalate_after']) or out['escalate_after']))
        role_key = (getattr(rule, 'required_role', None) or 'support').strip().lower()
        if role_key not in SUPPORT_ROLE_LEVELS:
            role_key = 'support'
        out['required_role_key'] = role_key
        out['required_role'] = _nc_support_role_label(role_key)
    return out


def _nc_support_is_online(user_id: int, now: datetime | None = None) -> bool:
    try:
        uid = int(user_id or 0)
    except Exception:
        uid = 0
    if uid <= 0:
        return False
    now = now or datetime.utcnow()
    try:
        beat = presence_last_beat.get(uid)
        if beat:
            if getattr(beat, 'tzinfo', None) is not None:
                beat_naive = beat.astimezone(timezone.utc).replace(tzinfo=None)
            else:
                beat_naive = beat
            if beat_naive >= now - timedelta(minutes=2):
                return True
    except Exception:
        pass
    try:
        u = User.query.get(uid)
        last_seen = getattr(u, 'last_seen', None) if u else None
        mode = (getattr(u, 'presence_mode', None) or 'online').strip().lower() if u else 'online'
        if mode == 'invisible':
            return False
        if last_seen and last_seen >= now - timedelta(minutes=5):
            return True
    except Exception:
        pass
    return False


def _nc_support_infer_category(subject: str, body: str, fallback: str = 'other') -> tuple[str, list[str]]:
    text_blob = f"{subject or ''}\n{body or ''}".lower()
    rules = [
        ('security', ['2fa', 'взлом', 'hack', 'hacked', 'stolen', 'steal', 'password', 'парол', 'логин', 'suspicious', 'подозр', 'безопас', 'fraud', 'phish', 'фиш', 'session', 'сесс']),
        ('billing', ['payment', 'paid', 'purchase', 'refund', 'charge', 'card', 'invoice', 'billing', 'оплат', 'платеж', 'подписк', 'донат', 'gift', 'nitro']),
        ('server', ['server', 'guild', 'канал', 'channel', 'role', 'permission', 'invite', 'инвайт', 'участник', 'member', 'voice channel', 'гс', 'сервер']),
        ('bug', ['bug', 'error', 'traceback', 'exception', 'crash', 'broken', 'не работает', 'сломал', 'сломалось', 'fix', 'баг', 'ошиб', 'лага', 'lag', 'fps', 'freeze', 'loading', 'stream', 'демк']),
        ('report', ['report', 'abuse', 'spam', 'scam', 'жалоб', 'оскорб', 'наруш', 'мошенн', 'угроз', 'tox', 'harass']),
    ]
    best = (0, fallback if fallback in {'billing','bug','report','security','server','other'} else 'other', [])
    for category, keywords in rules:
        matched = [kw for kw in keywords if kw in text_blob]
        score = len(matched)
        if score > best[0]:
            best = (score, category, matched[:6])
    tags = []
    seen = set()
    for item in best[2]:
        tag = re.sub(r'[^a-zA-Z0-9а-яА-ЯёЁ_\- ]+', '', item).strip()[:24]
        if tag and tag.lower() not in seen:
            seen.add(tag.lower())
            tags.append(tag)
    return best[1], tags


def _nc_support_staff_candidates() -> list[SupportStaffProfile]:
    try:
        rows = SupportStaffProfile.query.order_by(SupportStaffProfile.role_level.asc(), SupportStaffProfile.user_id.asc()).all()
    except Exception:
        rows = []
    out = []
    seen = set()
    for row in rows:
        uid = int(getattr(row, 'user_id', 0) or 0)
        if uid <= 0 or uid in seen:
            continue
        if _nc_support_role_for_user(uid) not in SUPPORT_ROLE_LEVELS:
            continue
        seen.add(uid)
        out.append(row)
    if 1 not in seen:
        dummy = type('SupportDummy', (), {})()
        dummy.user_id = 1
        dummy.role_level = 'head_support'
        dummy.last_seen_at = datetime.utcnow()
        out.append(dummy)
    return out


def _nc_support_role_rank(role_level: str) -> int:
    return {'support': 1, 'senior_support': 2, 'head_support': 3}.get((role_level or 'support').strip().lower(), 1)


def _nc_support_ticket_required_rank(ticket) -> int:
    cfg = _nc_support_sla_config_for_ticket(ticket)
    base = _nc_support_role_rank(cfg.get('required_role_key') or 'support')
    category = (getattr(ticket, 'category', None) or 'other').strip().lower()
    priority = (getattr(ticket, 'priority', None) or 'normal').strip().lower()
    if priority == 'urgent' and category in ('security', 'billing'):
        base = max(base, 3)
    elif priority == 'high' or category == 'security':
        base = max(base, 2)
    return max(1, int(base or 1))


def _nc_support_pick_assignee(ticket, *, min_rank: int | None = None, exclude_user_id: int | None = None) -> int | None:
    try:
        required_rank = int(min_rank or _nc_support_ticket_required_rank(ticket) or 1)
    except Exception:
        required_rank = 1
    exclude_uid = int(exclude_user_id or 0) if exclude_user_id else 0
    candidates = _nc_support_staff_candidates()
    if not candidates:
        return None
    now = datetime.utcnow()
    category = (getattr(ticket, 'category', None) or 'other').strip().lower()
    priority = (getattr(ticket, 'priority', None) or 'normal').strip().lower()
    workloads = {}
    try:
        rows = db.session.query(SupportTicket.assigned_to, func.count(SupportTicket.id)).filter(SupportTicket.status != 'closed', SupportTicket.assigned_to.is_not(None)).group_by(SupportTicket.assigned_to).all()
        workloads = {int(uid): int(cnt) for uid, cnt in rows if uid}
    except Exception:
        workloads = {}
    best = None
    for row in candidates:
        uid = int(getattr(row, 'user_id', 0) or 0)
        if uid <= 0 or uid == exclude_uid:
            continue
        role_level = _nc_support_role_for_user(uid)
        rank = _nc_support_role_rank(role_level)
        if rank < required_rank:
            continue
        last_seen = getattr(row, 'last_seen_at', None)
        stale = 0 if (last_seen and last_seen >= now - timedelta(days=14)) else 1
        current_load = int(workloads.get(uid, 0))
        categories = set(_nc_support_profile_categories(row))
        skills = set(_nc_support_profile_skills(row))
        category_bonus = 0 if (category and category in categories) else 1
        skill_bonus = 0 if ({category, priority} & skills) else 1
        max_active = max(0, int(getattr(row, 'max_active', 0) or 0))
        over_capacity = 1 if (max_active and current_load >= max_active) else 0
        direct_bonus = 0 if rank == required_rank else 1
        online_penalty = 0 if _nc_support_is_online(uid, now=now) else 1
        recent_presence_penalty = 0 if (last_seen and last_seen >= now - timedelta(hours=6)) else 1
        score = (over_capacity, online_penalty, recent_presence_penalty, stale, category_bonus, skill_bonus, current_load, direct_bonus, -rank, uid)
        if best is None or score < best[0]:
            best = (score, uid)
    return int(best[1]) if best else None


def _nc_support_auto_assign(ticket, *, force: bool = False, reason: str = 'auto_assigned') -> int | None:
    if not ticket:
        return None
    current_assignee = int(getattr(ticket, 'assigned_to', 0) or 0)
    if current_assignee and not force:
        return current_assignee
    picked = _nc_support_pick_assignee(ticket, exclude_user_id=(current_assignee if force else None))
    if not picked:
        return current_assignee or None
    ticket.assigned_to = int(picked)
    ticket.updated_at = datetime.utcnow()
    _nc_support_log_event(int(ticket.id), reason, actor_user_id=None, event_value=str(int(picked)), meta={'auto': True})
    return int(picked)


def _nc_support_apply_escalation_tag(ticket, tag_name: str = 'sla-escalated'):
    tags = _nc_support_tags_list(ticket)
    lowered = {t.lower() for t in tags}
    if tag_name.lower() not in lowered:
        tags.append(tag_name)
        ticket.tags_csv = ', '.join(tags[:10])


def _nc_support_run_escalations(limit: int = 40) -> dict:
    now = datetime.utcnow()
    out = {'checked': 0, 'escalated': 0, 'auto_assigned': 0}
    try:
        rows = SupportTicket.query.filter(
            SupportTicket.status != 'closed',
            SupportTicket.waiting_for == 'staff',
            SupportTicket.next_reply_due_at.is_not(None),
            SupportTicket.next_reply_due_at < now,
        ).order_by(SupportTicket.next_reply_due_at.asc()).limit(max(1, min(int(limit or 40), 200))).all()
    except Exception:
        rows = []
    changed = False
    for ticket in rows:
        out['checked'] += 1
        due = getattr(ticket, 'next_reply_due_at', None)
        if not due:
            continue
        overdue_minutes = max(0, int((now - due).total_seconds() // 60))
        cfg = _nc_support_sla_config_for_ticket(ticket)
        escalate_after = max(5, int(cfg.get('escalate_after') or 30))
        required_rank = _nc_support_ticket_required_rank(ticket)
        if overdue_minutes >= max(15, escalate_after // 2):
            required_rank = max(required_rank, 2)
        if overdue_minutes >= max(60, escalate_after):
            required_rank = max(required_rank, 3 if required_rank >= 2 else 2)
        assigned_to = int(getattr(ticket, 'assigned_to', 0) or 0)
        assigned_rank = _nc_support_role_rank(_nc_support_role_for_user(assigned_to)) if assigned_to else 0
        if not assigned_to:
            picked = _nc_support_auto_assign(ticket, reason='auto_assigned_overdue')
            if picked:
                out['auto_assigned'] += 1
                assigned_to = int(picked)
                assigned_rank = _nc_support_role_rank(_nc_support_role_for_user(assigned_to)) if assigned_to else 0
                changed = True
        if overdue_minutes >= 30 and assigned_rank < required_rank:
            picked = _nc_support_pick_assignee(ticket, min_rank=required_rank, exclude_user_id=assigned_to or None)
            if picked and picked != assigned_to:
                ticket.assigned_to = int(picked)
                ticket.updated_at = now
                _nc_support_apply_escalation_tag(ticket)
                _nc_support_log_event(int(ticket.id), 'sla_escalated', actor_user_id=None, event_value=str(int(picked)), meta={'overdue_minutes': overdue_minutes, 'required_rank': required_rank, 'prev_assigned_to': assigned_to or None})
                out['escalated'] += 1
                changed = True
    if changed:
        try:
            db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass
    return out


def _nc_support_tags_list(ticket) -> list[str]:
    raw = (getattr(ticket, 'tags_csv', None) or '').strip()
    seen = set()
    result = []
    for part in raw.split(','):
        tag = re.sub(r'[^a-zA-Z0-9а-яА-ЯёЁ_\- ]+', '', (part or '').strip()).strip()[:32]
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(tag)
        if len(result) >= 10:
            break
    return result


def _nc_support_tags_csv_from_value(value) -> str:
    if isinstance(value, (list, tuple, set)):
        raw = ','.join([str(x or '') for x in value])
    else:
        raw = str(value or '')
    class _Tmp: pass
    t = _Tmp()
    t.tags_csv = raw
    return ', '.join(_nc_support_tags_list(t))


def _nc_support_reply_library() -> list[dict]:
    rows = []
    try:
        rows = SupportSavedReply.query.order_by(SupportSavedReply.sort_order.asc(), SupportSavedReply.id.asc()).limit(100).all()
    except Exception:
        rows = []
    if rows:
        return [{'id': int(r.id), 'title': r.title or '', 'body': r.body or '', 'scope': (r.scope or 'support')} for r in rows]
    return [{'id': 0, 'title': x.get('title',''), 'body': x.get('body',''), 'scope': 'system'} for x in SUPPORT_QUICK_REPLIES]


def _nc_support_attachment_search_payload(items, user_map: dict[int, User] | None = None) -> list[dict]:
    user_map = user_map or {}
    payload = []
    for a in items or []:
        ticket = SupportTicket.query.filter_by(id=int(getattr(a, 'ticket_id', 0) or 0)).first()
        owner = user_map.get(int(getattr(ticket, 'user_id', 0) or 0)) if ticket else None
        payload.append({
            'id': int(getattr(a, 'id', 0) or 0),
            'ticket_id': int(getattr(a, 'ticket_id', 0) or 0),
            'message_id': int(getattr(a, 'message_id', 0) or 0),
            'file_name': getattr(a, 'file_name', '') or '',
            'file_url': getattr(a, 'file_url', '') or '',
            'mime_type': getattr(a, 'mime_type', '') or '',
            'is_image': bool(getattr(a, 'is_image', False)),
            'created_at': getattr(a, 'created_at', None),
            'username': (getattr(owner, 'username', None) if owner else None) or '',
            'subject': (getattr(ticket, 'subject', None) if ticket else None) or '',
        })
    return payload


def _nc_support_can_manage_team() -> bool:
    try:
        if int(getattr(current_user, 'id', 0) or 0) == 1:
            return True
    except Exception:
        pass
    if not _nc_auth_is_admin_auditor('roles'):
        return False
    return _nc_support_role_for_user(int(getattr(current_user, 'id', 0) or 0)) == 'head_support'



def _nc_support_extract_mentions(body: str, actor_user_id: int | None = None) -> list[dict]:
    raw = str(body or '')
    if not raw:
        return []
    tokens = re.findall(r'@([A-Za-zА-Яа-яЁё0-9_\-.]{2,32})', raw)
    if not tokens:
        return []
    wanted = []
    seen = set()
    for item in tokens:
        key = str(item or '').strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        wanted.append(key)
        if len(wanted) >= 12:
            break
    try:
        candidates = User.query.filter(or_(User.username_norm.in_(wanted), func.lower(User.username).in_(wanted), func.lower(User.display_name).in_(wanted))).all()
    except Exception:
        candidates = []
    out = []
    used = set()
    actor = int(actor_user_id or 0) if actor_user_id else 0
    for u in candidates:
        uid = int(getattr(u, 'id', 0) or 0)
        if uid <= 0 or uid == actor:
            continue
        if _nc_support_role_for_user(uid) not in SUPPORT_ROLE_LEVELS:
            continue
        if uid in used:
            continue
        used.add(uid)
        out.append({'user_id': uid, 'mention_key': ((getattr(u, 'username', None) or getattr(u, 'display_name', None) or '')[:64])})
    return out


def _nc_support_store_mentions(ticket_id: int, message_id: int | None, body: str, *, actor_user_id: int | None = None) -> list[SupportTicketMention]:
    hits = _nc_support_extract_mentions(body, actor_user_id=actor_user_id)
    created = []
    for hit in hits:
        try:
            row = SupportTicketMention(
                ticket_id=int(ticket_id),
                message_id=(int(message_id) if message_id else None),
                from_user_id=(int(actor_user_id) if actor_user_id else None),
                target_user_id=int(hit['user_id']),
                mention_key=(hit.get('mention_key') or '')[:64] or None,
                context_text=(str(body or '').strip()[:1000] or None),
            )
            db.session.add(row)
            created.append(row)
        except Exception:
            pass
    return created


def _nc_support_mentions_payload(user_id: int, limit: int = 25, unread_only: bool = False) -> list[dict]:
    try:
        uid = int(user_id or 0)
    except Exception:
        uid = 0
    if uid <= 0:
        return []
    try:
        q = SupportTicketMention.query.filter_by(target_user_id=uid)
        if unread_only:
            q = q.filter(SupportTicketMention.is_read.is_(False))
        rows = q.order_by(SupportTicketMention.created_at.desc(), SupportTicketMention.id.desc()).limit(max(1, min(int(limit or 25), 100))).all()
    except Exception:
        rows = []
    if not rows:
        return []
    ticket_ids = sorted({int(r.ticket_id) for r in rows if getattr(r, 'ticket_id', None)})
    user_ids = sorted({int(r.from_user_id) for r in rows if getattr(r, 'from_user_id', None)})
    tickets = {int(t.id): t for t in SupportTicket.query.filter(SupportTicket.id.in_(ticket_ids)).all()} if ticket_ids else {}
    users = {int(u.id): u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
    out = []
    for r in rows:
        t = tickets.get(int(r.ticket_id))
        actor = users.get(int(getattr(r, 'from_user_id', 0) or 0))
        out.append({
            'id': int(r.id),
            'ticket_id': int(r.ticket_id),
            'message_id': int(getattr(r, 'message_id', 0) or 0),
            'from_user_id': int(getattr(r, 'from_user_id', 0) or 0),
            'from_username': (getattr(actor, 'username', None) if actor else None) or 'staff',
            'subject': (getattr(t, 'subject', None) if t else None) or '',
            'status': (getattr(t, 'status', None) if t else None) or '',
            'context_text': (getattr(r, 'context_text', None) or '')[:220],
            'is_read': bool(getattr(r, 'is_read', False)),
            'created_at': getattr(r, 'created_at', None),
        })
    return out


def _nc_support_ticket_brief(ticket) -> dict:
    return {
        'id': int(getattr(ticket, 'id', 0) or 0),
        'subject': getattr(ticket, 'subject', '') or '',
        'status': getattr(ticket, 'status', '') or '',
        'priority': getattr(ticket, 'priority', '') or '',
        'waiting_for': getattr(ticket, 'waiting_for', '') or '',
        'assigned_to': int(getattr(ticket, 'assigned_to', 0) or 0),
        'user_id': int(getattr(ticket, 'user_id', 0) or 0),
        'updated_at': getattr(ticket, 'updated_at', None),
        'last_message_at': getattr(ticket, 'last_message_at', None),
        'sla': _nc_support_sla_payload(ticket),
    }


def _nc_support_inbox_payload(user_id: int) -> dict:
    try:
        uid = int(user_id or 0)
    except Exception:
        uid = 0
    payload = {
        'assigned_waiting': [],
        'mentions': [],
        'unassigned_hot': [],
        'overdue': [],
        'counts': {'assigned_waiting': 0, 'mentions': 0, 'unassigned_hot': 0, 'unread_mentions': 0, 'overdue': 0},
        'generated_at': datetime.utcnow().isoformat() + 'Z',
    }
    if uid <= 0:
        return payload
    try:
        now = datetime.utcnow()
        assigned_rows = SupportTicket.query.filter(SupportTicket.assigned_to == uid, SupportTicket.status != 'closed').order_by(case((SupportTicket.waiting_for == 'staff', 0), else_=1), SupportTicket.next_reply_due_at.asc().nullslast(), SupportTicket.last_message_at.desc()).limit(30).all()
        mention_rows = _nc_support_mentions_payload(uid, limit=20, unread_only=False)
        hot_rows = SupportTicket.query.filter(SupportTicket.status == 'open', SupportTicket.assigned_to.is_(None)).order_by(case((SupportTicket.priority == 'urgent', 0), (SupportTicket.priority == 'high', 1), else_=2), SupportTicket.created_at.desc()).limit(30).all()
        overdue_rows = SupportTicket.query.filter(SupportTicket.status != 'closed', SupportTicket.waiting_for == 'staff', SupportTicket.next_reply_due_at.is_not(None), SupportTicket.next_reply_due_at < now).order_by(SupportTicket.next_reply_due_at.asc(), SupportTicket.last_message_at.desc()).limit(30).all()
        payload['assigned_waiting'] = [_nc_support_ticket_brief(x) for x in assigned_rows]
        payload['mentions'] = mention_rows
        payload['unassigned_hot'] = [_nc_support_ticket_brief(x) for x in hot_rows]
        payload['overdue'] = [_nc_support_ticket_brief(x) for x in overdue_rows]
        payload['counts']['assigned_waiting'] = len(payload['assigned_waiting'])
        payload['counts']['mentions'] = len(payload['mentions'])
        payload['counts']['unassigned_hot'] = len(payload['unassigned_hot'])
        payload['counts']['unread_mentions'] = sum(1 for x in payload['mentions'] if not x.get('is_read'))
        payload['counts']['overdue'] = len(payload['overdue'])
    except Exception:
        pass
    return payload


def _nc_support_dashboard_widget(user_id: int | None = None) -> dict:
    uid = 0
    try:
        uid = int(user_id or 0)
    except Exception:
        uid = 0
    stats = _nc_get_support_stats()
    out = {'stats': stats, 'notifications': {}, 'inbox_counts': {}}
    if uid > 0:
        notifications = _nc_support_notifications_for_user(uid)
        inbox = _nc_support_inbox_payload(uid)
        out['notifications'] = notifications
        out['inbox_counts'] = dict(inbox.get('counts') or {})
    return out


def _nc_support_emit_refresh(*, reason: str = 'updated', ticket_id: int | None = None, target_user_ids=None):
    try:
        ids = set()
        for item in (target_user_ids or []):
            try:
                uid = int(item or 0)
            except Exception:
                uid = 0
            if uid > 0:
                ids.add(uid)
        payload = {'reason': (reason or 'updated')[:64], 'ticket_id': (int(ticket_id) if ticket_id else None), 'widget': _nc_support_dashboard_widget(0)}
        socketio.emit('support_live_update', payload, to='support_staff_global')
        for uid in ids:
            socketio.emit('support_live_update', {'reason': payload['reason'], 'ticket_id': payload['ticket_id'], 'widget': _nc_support_dashboard_widget(uid)}, to=f'support_staff_user_{uid}')
    except Exception:
        pass


def _nc_support_log_event(ticket_id: int, event_type: str, *, actor_user_id: int | None = None, event_value: str | None = None, body: str | None = None, meta: dict | None = None):
    try:
        row = SupportTicketEvent(
            ticket_id=int(ticket_id),
            actor_user_id=(int(actor_user_id) if actor_user_id else None),
            event_type=(event_type or 'event').strip().lower()[:32],
            event_value=((event_value or '').strip()[:255] or None),
            body=((body or '').strip()[:4000] or None),
            meta_json=(json.dumps(meta, ensure_ascii=False)[:8000] if meta else None),
        )
        db.session.add(row)
        return row
    except Exception:
        return None


def _nc_support_visible_replies(ticket=None) -> list[dict]:
    all_items = _nc_support_reply_library()
    if not ticket:
        return all_items
    scope = (getattr(ticket, 'category', None) or 'support').strip().lower()
    preferred = []
    fallback = []
    for item in all_items:
        item_scope = (item.get('scope') or 'support').strip().lower()
        if item_scope == scope:
            preferred.append(item)
        elif item_scope == 'support':
            fallback.append(item)
    return preferred + fallback


def _nc_support_notifications_for_user(user_id: int) -> dict:
    out = {'new_open': 0, 'unassigned_open': 0, 'my_waiting': 0, 'unseen_events': 0, 'unread_mentions': 0, 'last_seen_at': None}
    try:
        uid = int(user_id or 0)
    except Exception:
        uid = 0
    if uid <= 0:
        return out
    try:
        profile = SupportStaffProfile.query.filter_by(user_id=uid).first()
        last_seen_at = getattr(profile, 'last_seen_at', None) if profile else None
        out['last_seen_at'] = last_seen_at
        out['new_open'] = int(SupportTicket.query.filter(SupportTicket.status == 'open', SupportTicket.created_at >= datetime.utcnow() - timedelta(hours=24)).count())
        out['unassigned_open'] = int(SupportTicket.query.filter(SupportTicket.status == 'open', SupportTicket.assigned_to.is_(None)).count())
        out['my_waiting'] = int(SupportTicket.query.filter(SupportTicket.assigned_to == uid, SupportTicket.waiting_for == 'staff', SupportTicket.status != 'closed').count())
        if last_seen_at:
            out['unseen_events'] = int(SupportTicketEvent.query.join(SupportTicket, SupportTicket.id == SupportTicketEvent.ticket_id).filter(SupportTicketEvent.created_at > last_seen_at, or_(SupportTicket.assigned_to.is_(None), SupportTicket.assigned_to == uid), SupportTicketEvent.actor_user_id != uid).count())
        else:
            out['unseen_events'] = int(SupportTicketEvent.query.join(SupportTicket, SupportTicket.id == SupportTicketEvent.ticket_id).filter(or_(SupportTicket.assigned_to.is_(None), SupportTicket.assigned_to == uid)).count())
        out['unread_mentions'] = int(SupportTicketMention.query.filter_by(target_user_id=uid, is_read=False).count())
    except Exception:
        pass
    return out


def _nc_support_refresh_sla(ticket):
    now = datetime.utcnow()
    cfg = _nc_support_sla_config_for_ticket(ticket)
    if not getattr(ticket, 'first_response_due_at', None):
        ticket.first_response_due_at = (getattr(ticket, 'created_at', None) or now) + timedelta(minutes=int(cfg['first']))
    waiting_for = (getattr(ticket, 'waiting_for', None) or 'staff').strip().lower()
    if waiting_for == 'closed':
        ticket.next_reply_due_at = None
    else:
        base_dt = getattr(ticket, 'last_message_at', None) or now
        minutes = int(cfg['user'] if waiting_for == 'user' else cfg['first'])
        ticket.next_reply_due_at = base_dt + timedelta(minutes=minutes)


def _nc_support_sla_payload(ticket) -> dict:
    if not ticket:
        return {}
    now = datetime.utcnow()
    waiting_for = (getattr(ticket, 'waiting_for', None) or ('closed' if getattr(ticket, 'status', '') == 'closed' else 'staff')).strip().lower()
    due = getattr(ticket, 'next_reply_due_at', None)
    cfg = _nc_support_sla_config_for_ticket(ticket)
    return {
        'waiting_for': waiting_for,
        'label': 'closed' if waiting_for == 'closed' else ('ждём пользователя' if waiting_for == 'user' else 'ждём саппорт'),
        'due_at': due,
        'first_due_at': getattr(ticket, 'first_response_due_at', None),
        'first_staff_reply_at': getattr(ticket, 'first_staff_reply_at', None),
        'is_overdue': bool(due and due < now and waiting_for != 'closed'),
        'target_first_minutes': int(cfg.get('first') or 0),
        'target_next_minutes': int(cfg.get('user') or 0),
        'escalate_after_minutes': int(cfg.get('escalate_after') or 0),
        'required_role': cfg.get('required_role') or 'Support',
    }


def _nc_support_save_attachments(files, ticket_id: int, message_id: int) -> list[SupportTicketAttachment]:
    saved = []
    folder = os.path.join(app.static_folder, 'support_uploads')
    os.makedirs(folder, exist_ok=True)
    for idx, f in enumerate(list(files or [])):
        if idx >= SUPPORT_MAX_FILES:
            break
        if not f or not getattr(f, 'filename', None):
            continue
        original = (f.filename or '').strip()
        if not original:
            continue
        safe = secure_filename(original) or 'file'
        ext = os.path.splitext(safe)[1].lower()
        new_name = f"tk_{int(ticket_id)}_{int(message_id)}_{secrets.token_hex(10)}{ext}"
        path = os.path.join(folder, new_name)
        try:
            f.save(path)
            size = os.path.getsize(path)
            if size > SUPPORT_MAX_FILE_BYTES:
                os.remove(path)
                continue
            mime = (getattr(f, 'mimetype', None) or mimetypes.guess_type(original)[0] or 'application/octet-stream')[:160]
            row = SupportTicketAttachment(
                ticket_id=int(ticket_id),
                message_id=int(message_id),
                file_url=url_for('static', filename=f'support_uploads/{new_name}'),
                file_name=original[:255],
                mime_type=mime,
                file_size=int(size),
                is_image=mime.startswith('image/'),
            )
            db.session.add(row)
            saved.append(row)
        except Exception:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass
    return saved


def _nc_support_user_can_view(ticket) -> bool:
    try:
        if not getattr(current_user, 'is_authenticated', False):
            return False
        if _nc_auth_is_admin_auditor('support'):
            return True
        return int(getattr(ticket, 'user_id', 0) or 0) == int(getattr(current_user, 'id', 0) or 0)
    except Exception:
        return False


def _nc_support_touch_ticket(ticket, *, status: str | None = None, actor: str | None = None, is_internal: bool = False):
    now = datetime.utcnow()
    try:
        ticket.last_message_at = now
        if status:
            ticket.status = str(status).strip().lower()[:16]
        if str(getattr(ticket, 'status', 'open')).lower() == 'closed':
            ticket.waiting_for = 'closed'
        elif not is_internal:
            actor = (actor or '').strip().lower()
            if actor == 'staff':
                if not getattr(ticket, 'first_staff_reply_at', None):
                    ticket.first_staff_reply_at = now
                ticket.waiting_for = 'user'
            elif actor == 'user':
                ticket.waiting_for = 'staff'
        _nc_support_refresh_sla(ticket)
        ticket.updated_at = now
    except Exception:
        pass


def _nc_support_ticket_payload(ticket, user_map: dict[int, User] | None = None) -> dict:
    user_map = user_map or {}
    owner = user_map.get(int(getattr(ticket, 'user_id', 0) or 0)) if getattr(ticket, 'user_id', None) else None
    assignee = user_map.get(int(getattr(ticket, 'assigned_to', 0) or 0)) if getattr(ticket, 'assigned_to', None) else None
    return {
        'id': int(getattr(ticket, 'id', 0) or 0),
        'user_id': int(getattr(ticket, 'user_id', 0) or 0),
        'username': (getattr(owner, 'username', None) if owner else None) or 'unknown',
        'assigned_to': int(getattr(ticket, 'assigned_to', 0) or 0) or None,
        'assigned_username': (getattr(assignee, 'username', None) if assignee else None) or None,
        'guild_id': int(getattr(ticket, 'guild_id', 0) or 0) or None,
        'subject': getattr(ticket, 'subject', '') or '',
        'category': getattr(ticket, 'category', 'other') or 'other',
        'priority': getattr(ticket, 'priority', 'normal') or 'normal',
        'status': getattr(ticket, 'status', 'open') or 'open',
        'waiting_for': getattr(ticket, 'waiting_for', 'staff') or 'staff',
        'tags': _nc_support_tags_list(ticket),
        'public_token': getattr(ticket, 'public_token', None) or '',
        'satisfaction_rating': getattr(ticket, 'satisfaction_rating', None),
        'satisfaction_comment': getattr(ticket, 'satisfaction_comment', None) or '',
        'created_at': _nc_dt_iso(getattr(ticket, 'created_at', None)),
        'first_response_due_at': _nc_dt_iso(getattr(ticket, 'first_response_due_at', None)),
        'next_reply_due_at': _nc_dt_iso(getattr(ticket, 'next_reply_due_at', None)),
        'updated_at': _nc_dt_iso(getattr(ticket, 'updated_at', None)),
        'last_message_at': _nc_dt_iso(getattr(ticket, 'last_message_at', None)),
    }


def _nc_support_message_payload(msg, user_map: dict[int, User] | None = None) -> dict:
    user_map = user_map or {}
    author = user_map.get(int(getattr(msg, 'author_user_id', 0) or 0)) if getattr(msg, 'author_user_id', None) else None
    return {
        'id': int(getattr(msg, 'id', 0) or 0),
        'ticket_id': int(getattr(msg, 'ticket_id', 0) or 0),
        'author_user_id': int(getattr(msg, 'author_user_id', 0) or 0) or None,
        'author_username': (getattr(author, 'username', None) if author else None) or ('Support' if getattr(msg, 'is_staff', False) else 'System'),
        'body': getattr(msg, 'body', '') or '',
        'is_staff': bool(getattr(msg, 'is_staff', False)),
        'is_internal': bool(getattr(msg, 'is_internal', False)),
        'created_at': _nc_dt_iso(getattr(msg, 'created_at', None)),
    }


def _nc_support_analytics_payload(days: int = 30) -> dict:
    now = datetime.utcnow()
    days = max(1, min(int(days or 30), 365))
    start = now - timedelta(days=days)
    start_7 = now - timedelta(days=7)
    payload = {
        'days': days,
        'generated_at': now,
        'stats': {'created_total': 0, 'closed_total': 0, 'open_now': 0, 'pending_now': 0, 'overdue_now': 0, 'avg_first_response_min': None, 'avg_close_hours': None, 'csat_avg': None, 'csat_count': 0},
        'trend_7d': {'created': 0, 'closed': 0},
        'by_category': [],
        'by_priority': [],
        'by_status': [],
        'staff': [],
        'feedback': [],
        'top_overdue': [],
        'series_daily': [],
        'series_weekly': [],
        'sla_rules': [],
        'skills': [],
        'hourly_load': [],
        'hourly_heatmap': [],
        'routing': {'auto_routed': 0, 'manual_category': 0, 'by_detected_category': []},
    }
    try:
        payload['stats']['created_total'] = int(SupportTicket.query.filter(SupportTicket.created_at >= start).count())
        payload['stats']['closed_total'] = int(SupportTicket.query.filter(SupportTicket.updated_at >= start, SupportTicket.status == 'closed').count())
        payload['stats']['open_now'] = int(SupportTicket.query.filter(SupportTicket.status == 'open').count())
        payload['stats']['pending_now'] = int(SupportTicket.query.filter(SupportTicket.status == 'pending').count())
        payload['stats']['overdue_now'] = int(SupportTicket.query.filter(SupportTicket.status != 'closed', SupportTicket.waiting_for == 'staff', SupportTicket.next_reply_due_at.is_not(None), SupportTicket.next_reply_due_at < now).count())
        payload['trend_7d']['created'] = int(SupportTicket.query.filter(SupportTicket.created_at >= start_7).count())
        payload['trend_7d']['closed'] = int(SupportTicket.query.filter(SupportTicket.updated_at >= start_7, SupportTicket.status == 'closed').count())
    except Exception:
        pass
    try:
        first_rows = SupportTicket.query.filter(SupportTicket.created_at >= start, SupportTicket.first_staff_reply_at.is_not(None)).all()
        if first_rows:
            vals = [max(0.0, (t.first_staff_reply_at - t.created_at).total_seconds() / 60.0) for t in first_rows if getattr(t, 'created_at', None) and getattr(t, 'first_staff_reply_at', None)]
            if vals:
                payload['stats']['avg_first_response_min'] = round(sum(vals) / len(vals), 1)
    except Exception:
        pass
    try:
        close_rows = SupportTicket.query.filter(SupportTicket.created_at >= start, SupportTicket.status == 'closed').all()
        if close_rows:
            vals = [max(0.0, (t.updated_at - t.created_at).total_seconds() / 3600.0) for t in close_rows if getattr(t, 'created_at', None) and getattr(t, 'updated_at', None)]
            if vals:
                payload['stats']['avg_close_hours'] = round(sum(vals) / len(vals), 1)
    except Exception:
        pass
    try:
        fb_rows = SupportTicketFeedback.query.filter(SupportTicketFeedback.created_at >= start).all()
        if fb_rows:
            ratings = [int(getattr(x, 'rating', 0) or 0) for x in fb_rows if int(getattr(x, 'rating', 0) or 0) > 0]
            if ratings:
                payload['stats']['csat_avg'] = round(sum(ratings) / len(ratings), 2)
                payload['stats']['csat_count'] = len(ratings)
                for r in range(5, 0, -1):
                    payload['feedback'].append({'rating': r, 'count': sum(1 for x in ratings if x == r)})
    except Exception:
        pass
    try:
        rows = db.session.query(SupportTicket.category, func.count(SupportTicket.id)).filter(SupportTicket.created_at >= start).group_by(SupportTicket.category).order_by(func.count(SupportTicket.id).desc()).all()
        payload['by_category'] = [{'name': (name or 'other'), 'count': int(cnt)} for name, cnt in rows]
    except Exception:
        pass
    try:
        rows = db.session.query(SupportTicket.priority, func.count(SupportTicket.id)).filter(SupportTicket.created_at >= start).group_by(SupportTicket.priority).order_by(func.count(SupportTicket.id).desc()).all()
        payload['by_priority'] = [{'name': (name or 'normal'), 'count': int(cnt)} for name, cnt in rows]
    except Exception:
        pass
    try:
        rows = db.session.query(SupportTicket.status, func.count(SupportTicket.id)).group_by(SupportTicket.status).order_by(func.count(SupportTicket.id).desc()).all()
        payload['by_status'] = [{'name': (name or 'open'), 'count': int(cnt)} for name, cnt in rows]
    except Exception:
        pass
    try:
        staff_rows = SupportStaffProfile.query.all()
        staff_ids = sorted({int(x.user_id) for x in staff_rows if getattr(x, 'user_id', None)} | {1})
        users = {int(u.id): u for u in User.query.filter(User.id.in_(staff_ids)).all()} if staff_ids else {}
        staff_list = []
        for uid in staff_ids:
            role = _nc_support_role_for_user(uid)
            username = (getattr(users.get(uid), 'username', None) or f'user{uid}')
            assigned_open = int(SupportTicket.query.filter(SupportTicket.assigned_to == uid, SupportTicket.status != 'closed').count())
            answered = int(SupportTicketMessage.query.filter(SupportTicketMessage.author_user_id == uid, SupportTicketMessage.is_staff.is_(True), SupportTicketMessage.created_at >= start, SupportTicketMessage.is_internal.is_(False)).count())
            notes = int(SupportTicketMessage.query.filter(SupportTicketMessage.author_user_id == uid, SupportTicketMessage.is_staff.is_(True), SupportTicketMessage.created_at >= start, SupportTicketMessage.is_internal.is_(True)).count())
            closed = int(SupportTicket.query.filter(SupportTicket.assigned_to == uid, SupportTicket.status == 'closed', SupportTicket.updated_at >= start).count())
            waiting = int(SupportTicket.query.filter(SupportTicket.assigned_to == uid, SupportTicket.status != 'closed', SupportTicket.waiting_for == 'staff').count())
            staff_list.append({'user_id': uid, 'username': username, 'role': role, 'role_label': _nc_support_role_label(role), 'assigned_open': assigned_open, 'staff_replies': answered, 'internal_notes': notes, 'closed_total': closed, 'waiting_now': waiting})
        payload['staff'] = sorted(staff_list, key=lambda x: (-x['staff_replies'], -x['closed_total'], x['assigned_open'], x['username'].lower()))
    except Exception:
        pass
    try:
        day_map = {}
        rows = SupportTicket.query.filter(SupportTicket.created_at >= start).all()
        for offset in range(days):
            d = (start + timedelta(days=offset)).date()
            day_map[d.isoformat()] = {'day': d.strftime('%d.%m'), 'created': 0, 'closed': 0, 'first_reply_avg': None, 'csat': None}
        first_reply_buckets = {}
        feedback_buckets = {}
        for t in rows:
            ckey = (getattr(t, 'created_at', None) or now).date().isoformat()
            if ckey in day_map:
                day_map[ckey]['created'] += 1
            if getattr(t, 'status', None) == 'closed' and getattr(t, 'updated_at', None):
                ukey = t.updated_at.date().isoformat()
                if ukey in day_map:
                    day_map[ukey]['closed'] += 1
            if getattr(t, 'first_staff_reply_at', None) and getattr(t, 'created_at', None):
                bucket = ckey
                first_reply_buckets.setdefault(bucket, []).append(max(0.0, (t.first_staff_reply_at - t.created_at).total_seconds() / 60.0))
        fb_rows = SupportTicketFeedback.query.filter(SupportTicketFeedback.created_at >= start).all()
        for fb in fb_rows:
            key = (getattr(fb, 'created_at', None) or now).date().isoformat()
            feedback_buckets.setdefault(key, []).append(int(getattr(fb, 'rating', 0) or 0))
        for key, vals in first_reply_buckets.items():
            if key in day_map and vals:
                day_map[key]['first_reply_avg'] = round(sum(vals) / len(vals), 1)
        for key, vals in feedback_buckets.items():
            clean = [v for v in vals if v > 0]
            if key in day_map and clean:
                day_map[key]['csat'] = round(sum(clean) / len(clean), 2)
        payload['series_daily'] = [day_map[k] for k in sorted(day_map.keys())]
        weekly = {}
        for row in payload['series_daily']:
            day_dt = datetime.strptime(row['day'], '%d.%m')
            wk_key = row['day']
            weekly.setdefault(wk_key, {'label': row['day'], 'created': 0, 'closed': 0})
            weekly[wk_key]['created'] += int(row['created'])
            weekly[wk_key]['closed'] += int(row['closed'])
        payload['series_weekly'] = list(weekly.values())[-12:]
    except Exception:
        pass
    try:
        skill_rows = SupportStaffProfile.query.all()
        skill_counts = {}
        for row in skill_rows:
            for item in _nc_support_profile_categories(row) + _nc_support_profile_skills(row):
                skill_counts[item] = int(skill_counts.get(item, 0)) + 1
        payload['skills'] = [{'name': k, 'count': v} for k, v in sorted(skill_counts.items(), key=lambda x: (-x[1], x[0]))[:20]]
    except Exception:
        pass
    try:
        hour_map = {h: {'hour': f'{h:02d}:00', 'created': 0, 'staff_replies': 0, 'closed': 0} for h in range(24)}
        weekday_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        heat = {(d, h): 0 for d in range(7) for h in range(24)}
        ticket_rows = SupportTicket.query.filter(SupportTicket.created_at >= start).all()
        for t in ticket_rows:
            cdt = getattr(t, 'created_at', None)
            if cdt:
                hour_map[cdt.hour]['created'] += 1
                heat[(cdt.weekday(), cdt.hour)] += 1
            if getattr(t, 'status', None) == 'closed' and getattr(t, 'updated_at', None) and t.updated_at >= start:
                hour_map[t.updated_at.hour]['closed'] += 1
        reply_rows = SupportTicketMessage.query.filter(SupportTicketMessage.created_at >= start, SupportTicketMessage.is_staff.is_(True), SupportTicketMessage.is_internal.is_(False)).all()
        for m in reply_rows:
            cdt = getattr(m, 'created_at', None)
            if cdt:
                hour_map[cdt.hour]['staff_replies'] += 1
                heat[(cdt.weekday(), cdt.hour)] += 1
        payload['hourly_load'] = [hour_map[h] for h in range(24)]
        max_cell = max([heat[(d, h)] for d in range(7) for h in range(24)] or [0])
        payload['hourly_heatmap'] = [
            {
                'weekday': weekday_names[d],
                'cells': [
                    {'hour': h, 'count': int(heat[(d, h)]), 'level': (0 if max_cell <= 0 else max(1, int(round((heat[(d, h)] / max_cell) * 4))) if heat[(d, h)] > 0 else 0)}
                    for h in range(24)
                ]
            }
            for d in range(7)
        ]
    except Exception:
        pass
    try:
        auto_routed = int(SupportTicketEvent.query.filter(SupportTicketEvent.created_at >= start, SupportTicketEvent.event_type == 'category_auto_routed').count())
        created_total = int(payload['stats'].get('created_total') or 0)
        payload['routing']['auto_routed'] = auto_routed
        payload['routing']['manual_category'] = max(0, created_total - auto_routed)
        rows = db.session.query(SupportTicketEvent.event_value, func.count(SupportTicketEvent.id)).filter(SupportTicketEvent.created_at >= start, SupportTicketEvent.event_type == 'category_auto_routed').group_by(SupportTicketEvent.event_value).order_by(func.count(SupportTicketEvent.id).desc()).all()
        payload['routing']['by_detected_category'] = [{'name': (name or 'other'), 'count': int(cnt)} for name, cnt in rows]
    except Exception:
        pass
    try:
        rules = SupportSlaRule.query.order_by(SupportSlaRule.category.asc(), SupportSlaRule.priority.asc(), SupportSlaRule.id.asc()).all()
        payload['sla_rules'] = [{'id': int(r.id), 'category': r.category or '*', 'priority': r.priority or '*', 'first_reply_minutes': int(r.first_reply_minutes or 0), 'next_reply_minutes': int(r.next_reply_minutes or 0), 'escalate_after_minutes': int(r.escalate_after_minutes or 0), 'required_role': _nc_support_role_label(r.required_role or 'support'), 'enabled': bool(r.is_enabled)} for r in rules]
    except Exception:
        pass
    return payload


def _nc_get_support_stats() -> dict:
    now = datetime.utcnow()
    day_ago = now - timedelta(hours=24)
    try:
        open_count = int(SupportTicket.query.filter(SupportTicket.status == 'open').count())
    except Exception:
        open_count = 0
    try:
        pending_count = int(SupportTicket.query.filter(SupportTicket.status == 'pending').count())
    except Exception:
        pending_count = 0
    try:
        closed_24h = int(SupportTicket.query.filter(SupportTicket.status == 'closed', SupportTicket.updated_at >= day_ago).count())
    except Exception:
        closed_24h = 0
    try:
        new_24h = int(SupportTicket.query.filter(SupportTicket.created_at >= day_ago).count())
    except Exception:
        new_24h = 0
    return {'open': open_count, 'pending': pending_count, 'closed_24h': closed_24h, 'new_24h': new_24h}


def _nc_get_active_user_mute(user_id: int):
    now = datetime.utcnow()
    return AdminUserAction.query.filter(
        AdminUserAction.user_id == int(user_id),
        AdminUserAction.action_type == 'mute',
        AdminUserAction.is_active.is_(True),
        or_(AdminUserAction.expires_at.is_(None), AdminUserAction.expires_at > now),
    ).order_by(AdminUserAction.created_at.desc()).first()


def _nc_is_user_muted(user_id: int) -> tuple[bool, str, str | None]:
    row = _nc_get_active_user_mute(int(user_id))
    if not row:
        return False, '', None
    until = getattr(row, 'expires_at', None)
    return True, 'Вы временно лишены права писать сообщения администратором.', (_iso_z(until) if until else None)


def _nc_get_channel_root_server_id(channel_obj) -> int | None:
    try:
        if not channel_obj or bool(getattr(channel_obj, 'is_dm', False)):
            return None
        gid = int(getattr(channel_obj, 'guild_id', 0) or 0)
        cid = int(getattr(channel_obj, 'id', 0) or 0)
        return gid or cid or None
    except Exception:
        return None


def _nc_get_active_server_action(user_id: int, server_id: int, action_type: str):
    now = datetime.utcnow()
    return AdminUserAction.query.filter(
        AdminUserAction.user_id == int(user_id),
        AdminUserAction.guild_id == int(server_id),
        AdminUserAction.action_type == str(action_type).strip().lower(),
        AdminUserAction.is_active.is_(True),
        or_(AdminUserAction.expires_at.is_(None), AdminUserAction.expires_at > now),
    ).order_by(AdminUserAction.created_at.desc()).first()


def _nc_is_user_server_muted(user_id: int, server_id: int) -> tuple[bool, str, str | None]:
    row = _nc_get_active_server_action(int(user_id), int(server_id), 'server_mute')
    if not row:
        return False, '', None
    until = getattr(row, 'expires_at', None)
    return True, 'Вы временно лишены права писать на этом сервере.', (_iso_z(until) if until else None)


def _nc_is_user_server_banned(user_id: int, server_id: int) -> tuple[bool, str, str | None]:
    row = _nc_get_active_server_action(int(user_id), int(server_id), 'server_ban')
    if not row:
        return False, '', None
    until = getattr(row, 'expires_at', None)
    return True, 'Вы заблокированы на этом сервере.', (_iso_z(until) if until else None)


def _nc_admin_revoke_user_sessions(user_id: int) -> int:
    try:
        deleted = AuthSession.query.filter_by(user_id=int(user_id), revoked_at=None).delete(synchronize_session=False)
        db.session.commit()
        return int(deleted or 0)
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass
        return 0


def _nc_kick_user_from_server(server_id: int, user_id: int) -> dict:
    server = Channel.query.filter(Channel.id == int(server_id), Channel.is_dm.is_(False), Channel.guild_id == Channel.id).first()
    if not server:
        raise ValueError('server_not_found')
    channel_ids = [int(r[0]) for r in db.session.query(Channel.id).filter(Channel.guild_id == int(server_id)).all()]
    if int(server_id) not in channel_ids:
        channel_ids.append(int(server_id))
    deleted = ChannelMember.query.filter(ChannelMember.user_id == int(user_id), ChannelMember.channel_id.in_(channel_ids)).delete(synchronize_session=False)
    return {'server': server, 'deleted_memberships': int(deleted or 0), 'channel_ids': channel_ids}


def _nc_admin_message_preview(content: str | None, limit: int = 140) -> str:
    txt = (content or '').replace('\r', ' ').replace('\n', ' ').strip()
    if len(txt) <= limit:
        return txt or '—'
    return txt[: max(1, limit - 1)].rstrip() + '…'


def _nc_admin_message_state(row) -> str:
    if getattr(row, 'deleted_at', None):
        return 'hidden'
    return 'visible'


def _nc_admin_message_payload(msg, user_map: dict[int, User] | None = None, channel_map: dict[int, Channel] | None = None) -> dict:
    user_map = user_map or {}
    channel_map = channel_map or {}
    user = user_map.get(int(getattr(msg, 'user_id', 0) or 0)) if getattr(msg, 'user_id', None) else None
    ch = channel_map.get(int(getattr(msg, 'channel_id', 0) or 0)) if getattr(msg, 'channel_id', None) else None
    guild_id = getattr(ch, 'guild_id', None) if ch else None
    attachments = []
    try:
        for a in Attachment.query.filter_by(message_id=int(getattr(msg, 'id', 0) or 0)).order_by(Attachment.id.asc()).all():
            attachments.append({
                'id': int(a.id),
                'url': a.file_url,
                'name': a.file_name,
                'size': int(a.file_size or 0),
                'mime': a.mime_type or 'application/octet-stream',
                'is_image': bool(a.is_image),
            })
    except Exception:
        attachments = []
    return {
        'id': int(getattr(msg, 'id', 0) or 0),
        'channel_id': int(getattr(msg, 'channel_id', 0) or 0),
        'guild_id': int(guild_id or 0) if guild_id else None,
        'user_id': int(getattr(msg, 'user_id', 0) or 0),
        'username': (getattr(user, 'username', None) if user else None) or 'unknown',
        'channel_name': (getattr(ch, 'name', None) if ch else None) or 'unknown',
        'content': getattr(msg, 'content', '') or '',
        'preview': _nc_admin_message_preview(getattr(msg, 'content', '') or ''),
        'state': _nc_admin_message_state(msg),
        'created_at': _nc_dt_iso(getattr(msg, 'created_at', None)),
        'deleted_at': _nc_dt_iso(getattr(msg, 'deleted_at', None)),
        'attachments': attachments,
    }


def _nc_admin_report_payload(rep, msg=None, reporter=None, target=None, channel=None) -> dict:
    return {
        'id': int(getattr(rep, 'id', 0) or 0),
        'message_id': int(getattr(rep, 'message_id', 0) or 0),
        'status': getattr(rep, 'status', 'open') or 'open',
        'reason': getattr(rep, 'reason', 'other') or 'other',
        'details': getattr(rep, 'details', None),
        'moderator_note': getattr(rep, 'moderator_note', None),
        'reporter_user_id': int(getattr(rep, 'reporter_user_id', 0) or 0),
        'reporter_username': (getattr(reporter, 'username', None) if reporter else None) or 'unknown',
        'target_user_id': int(getattr(rep, 'target_user_id', 0) or 0) if getattr(rep, 'target_user_id', None) else None,
        'target_username': (getattr(target, 'username', None) if target else None) or None,
        'channel_id': int(getattr(rep, 'channel_id', 0) or 0),
        'channel_name': (getattr(channel, 'name', None) if channel else None) or 'unknown',
        'created_at': _nc_dt_iso(getattr(rep, 'created_at', None)),
        'resolved_at': _nc_dt_iso(getattr(rep, 'resolved_at', None)),
        'message_preview': _nc_admin_message_preview(getattr(msg, 'content', '') or '') if msg else '—',
    }


def _nc_admin_mod_stats() -> dict:
    now = datetime.utcnow()
    day_ago = now - timedelta(hours=24)
    try:
        reports_open = int(MessageReport.query.filter(MessageReport.status == 'open').count())
    except Exception:
        reports_open = 0
    try:
        reports_24h = int(MessageReport.query.filter(MessageReport.created_at >= day_ago).count())
    except Exception:
        reports_24h = 0
    try:
        hidden_messages = int(Message.query.filter(Message.deleted_at.is_not(None)).count())
    except Exception:
        hidden_messages = 0
    try:
        msgs_24h = int(Message.query.filter(Message.created_at >= day_ago).count())
    except Exception:
        msgs_24h = 0
    return {
        'reports_open': reports_open,
        'reports_24h': reports_24h,
        'hidden_messages': hidden_messages,
        'messages_24h': msgs_24h,
    }


def _nc_admin_send_csv(filename: str, rows: list[dict]):
    sio = io.StringIO()
    cols = list(rows[0].keys()) if rows else ['empty']
    writer = csv.DictWriter(sio, fieldnames=cols)
    writer.writeheader()
    if rows:
        writer.writerows(rows)
    else:
        writer.writerow({'empty': 'no_data'})
    bio = io.BytesIO(sio.getvalue().encode('utf-8-sig'))
    return send_file(bio, mimetype='text/csv; charset=utf-8', as_attachment=True, download_name=filename)


    @app.route("/admin", methods=["GET"])
    @login_required
    def admin_dashboard():
        if not _nc_auth_is_admin_auditor('dashboard'):
            abort(403)
        stats = _nc_admin_security_stats()
        support_stats = _nc_get_support_stats()
        return render_template('admin_dashboard.html', stats=stats, support_stats=support_stats, support_widget=_nc_support_dashboard_widget(int(current_user.id)))


    @app.route("/admin/security", methods=["GET"])
    @login_required
    def admin_security():
        if not _nc_auth_is_admin_auditor('security'):
            abort(403)
        try:
            limit = max(20, min(300, int(request.args.get('limit') or 100)))
        except Exception:
            limit = 100
        view = (request.args.get('view') or 'overview').strip().lower()
        stats = _nc_admin_security_stats()
        attempts_query = _nc_admin_security_apply_attempt_filters(AuthAttempt.query)
        blocks_query = _nc_admin_security_apply_block_filters(AuthSecurityBlock.query)
        attempts = attempts_query.order_by(AuthAttempt.created_at.desc()).limit(limit).all()
        blocks = blocks_query.order_by(AuthSecurityBlock.active.desc(), AuthSecurityBlock.expires_at.desc()).limit(limit).all()
        cutoff = datetime.utcnow() - timedelta(hours=24)
        top_ip_counts = {}
        for row in AuthAttempt.query.filter(AuthAttempt.created_at >= cutoff).all():
            ip = (row.ip_address or '').strip()
            if ip:
                top_ip_counts[ip] = top_ip_counts.get(ip, 0) + 1
        top_ips = sorted(top_ip_counts.items(), key=lambda kv: kv[1], reverse=True)[:20]
        return render_template('admin_security.html', attempts=attempts, blocks=blocks, top_ips=top_ips, utcnow=datetime.utcnow(), stats=stats, current_view=view)

    @app.route('/admin/security/export', methods=['GET'])
    @login_required
    def admin_security_export():
        if not _nc_auth_is_admin_auditor('security'):
            abort(403)
        fmt = (request.args.get('format') or 'csv').strip().lower()
        export_type = (request.args.get('type') or 'attempts').strip().lower()
        if export_type == 'blocks':
            rows = _nc_admin_security_apply_block_filters(AuthSecurityBlock.query).order_by(AuthSecurityBlock.created_at.desc()).limit(1000).all()
            data = [{
                'id': int(getattr(r, 'id', 0) or 0),
                'scope_type': getattr(r, 'scope_type', None),
                'scope_value': getattr(r, 'scope_value', None),
                'phase': getattr(r, 'phase', None),
                'reason': getattr(r, 'reason', None),
                'active': bool(getattr(r, 'active', False)),
                'created_at': _nc_dt_iso(getattr(r, 'created_at', None)),
                'expires_at': _nc_dt_iso(getattr(r, 'expires_at', None)),
            } for r in rows]
            base = 'security_blocks'
        else:
            rows = _nc_admin_security_apply_attempt_filters(AuthAttempt.query).order_by(AuthAttempt.created_at.desc()).limit(2000).all()
            data = [{
                'id': int(getattr(r, 'id', 0) or 0),
                'status': getattr(r, 'status', None),
                'login_value': getattr(r, 'login_value', None),
                'ip_address': getattr(r, 'ip_address', None),
                'note': getattr(r, 'note', None),
                'user_id': getattr(r, 'user_id', None),
                'session_id': getattr(r, 'session_id', None),
                'created_at': _nc_dt_iso(getattr(r, 'created_at', None)),
            } for r in rows]
            base = 'security_attempts'
        if fmt == 'json':
            return jsonify(ok=True, type=export_type, rows=data)
        return _nc_admin_send_csv(f'{base}.csv', data)

    @app.route('/api/admin/security/cleanup', methods=['POST'])
    @login_required
    def api_admin_security_cleanup():
        if not _nc_auth_is_admin_auditor('security'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        kind = (data.get('kind') or 'all').strip().lower()
        try:
            older_than_days = max(1, min(365, int(data.get('older_than_days') or 30)))
        except Exception:
            older_than_days = 30
        cutoff = datetime.utcnow() - timedelta(days=older_than_days)
        deleted_attempts = 0
        deleted_blocks = 0
        try:
            if kind in ('attempts', 'all'):
                deleted_attempts = AuthAttempt.query.filter(AuthAttempt.created_at < cutoff).delete(synchronize_session=False)
            if kind in ('blocks', 'all'):
                deleted_blocks = AuthSecurityBlock.query.filter(AuthSecurityBlock.expires_at < cutoff).delete(synchronize_session=False)
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error='db_error'), 500
        return jsonify(ok=True, deleted_attempts=int(deleted_attempts or 0), deleted_blocks=int(deleted_blocks or 0), older_than_days=older_than_days)



    def _nc_admin_user_status_label(user) -> str:
        try:
            if bool(getattr(user, 'is_deleted', False)):
                return 'deleted'
            if bool(getattr(user, 'is_disabled', False)):
                return 'disabled'
            if bool(getattr(user, 'is_online', False)):
                return 'online'
        except Exception:
            pass
        return 'active'


    @app.route("/admin/users", methods=["GET"])
    @login_required
    def admin_users():
        if not _nc_auth_is_admin_auditor('users'):
            abort(403)
        q = (request.args.get('q') or '').strip()
        status = (request.args.get('status') or '').strip().lower()
        sort = (request.args.get('sort') or 'recent').strip().lower()
        try:
            limit = max(20, min(300, int(request.args.get('limit') or 100)))
        except Exception:
            limit = 100

        query = User.query
        if q:
            like = f"%{q}%"
            query = query.filter(or_(User.username.ilike(like), User.display_name.ilike(like), User.email.ilike(like)))
        if status == 'disabled':
            query = query.filter(User.is_disabled.is_(True))
        elif status == 'deleted':
            query = query.filter(User.is_deleted.is_(True))
        elif status == 'online':
            query = query.filter(User.is_online.is_(True), User.is_deleted.is_(False))
        elif status == 'active':
            query = query.filter(User.is_disabled.is_(False), User.is_deleted.is_(False))

        if sort == 'new':
            query = query.order_by(User.created_at.desc())
        elif sort == 'name':
            query = query.order_by(User.username.asc())
        else:
            query = query.order_by(User.last_seen.desc(), User.created_at.desc())

        users = query.limit(limit).all()
        user_ids = [int(u.id) for u in users if getattr(u, 'id', None)]
        msg_counts = {}
        session_counts = {}
        server_counts = {}
        if user_ids:
            try:
                for uid, cnt in db.session.query(Message.user_id, func.count(Message.id)).filter(Message.user_id.in_(user_ids)).group_by(Message.user_id).all():
                    msg_counts[int(uid)] = int(cnt or 0)
            except Exception:
                msg_counts = {}
            try:
                for uid, cnt in db.session.query(AuthSession.user_id, func.count(AuthSession.id)).filter(AuthSession.user_id.in_(user_ids)).group_by(AuthSession.user_id).all():
                    session_counts[int(uid)] = int(cnt or 0)
            except Exception:
                session_counts = {}
            try:
                root_server_ids = [gid for (gid,) in db.session.query(Channel.id).filter(Channel.is_dm.is_(False), Channel.guild_id == Channel.id).all()]
                if root_server_ids:
                    for uid, cnt in db.session.query(ChannelMember.user_id, func.count(ChannelMember.id)).filter(ChannelMember.user_id.in_(user_ids), ChannelMember.channel_id.in_(root_server_ids)).group_by(ChannelMember.user_id).all():
                        server_counts[int(uid)] = int(cnt or 0)
            except Exception:
                server_counts = {}

        stats = {
            'total': int(User.query.count()),
            'online': int(User.query.filter(User.is_online.is_(True), User.is_deleted.is_(False)).count()),
            'disabled': int(User.query.filter(User.is_disabled.is_(True)).count()),
            'deleted': int(User.query.filter(User.is_deleted.is_(True)).count()),
            'new_24h': int(User.query.filter(User.created_at >= datetime.utcnow() - timedelta(hours=24)).count()),
        }

        return render_template('admin_users.html', users=users, stats=stats, msg_counts=msg_counts, session_counts=session_counts, server_counts=server_counts, current_q=q, current_status=status, current_sort=sort, current_limit=limit)


    @app.route("/admin/servers", methods=["GET"])
    @login_required
    def admin_servers():
        if not _nc_auth_is_admin_auditor('servers'):
            abort(403)
        q = (request.args.get('q') or '').strip()
        visibility = (request.args.get('visibility') or '').strip().lower()
        sort = (request.args.get('sort') or 'recent').strip().lower()
        try:
            limit = max(20, min(300, int(request.args.get('limit') or 100)))
        except Exception:
            limit = 100

        query = Channel.query.filter(Channel.is_dm.is_(False), Channel.guild_id == Channel.id)
        if q:
            like = f"%{q}%"
            query = query.filter(or_(Channel.name.ilike(like), Channel.topic.ilike(like), Channel.server_tag.ilike(like)))
        if visibility == 'private':
            query = query.filter(Channel.is_private.is_(True))
        elif visibility == 'public':
            query = query.filter(Channel.is_private.is_(False))
        if sort == 'name':
            query = query.order_by(Channel.name.asc())
        else:
            query = query.order_by(Channel.created_at.desc())
        servers = query.limit(limit).all()
        server_ids = [int(s.id) for s in servers if getattr(s, 'id', None)]
        member_counts = {}
        subchannel_counts = {}
        message_counts = {}
        admin_counts = {}
        creator_ids = set()
        if server_ids:
            try:
                for cid, cnt in db.session.query(ChannelMember.channel_id, func.count(ChannelMember.id)).filter(ChannelMember.channel_id.in_(server_ids)).group_by(ChannelMember.channel_id).all():
                    member_counts[int(cid)] = int(cnt or 0)
            except Exception:
                member_counts = {}
            try:
                for gid, cnt in db.session.query(Channel.guild_id, func.count(Channel.id)).filter(Channel.guild_id.in_(server_ids), Channel.id != Channel.guild_id).group_by(Channel.guild_id).all():
                    subchannel_counts[int(gid)] = int(cnt or 0)
            except Exception:
                subchannel_counts = {}
            try:
                for gid, cnt in db.session.query(Channel.guild_id, func.count(Message.id)).join(Message, Message.channel_id == Channel.id).filter(Channel.guild_id.in_(server_ids)).group_by(Channel.guild_id).all():
                    message_counts[int(gid)] = int(cnt or 0)
            except Exception:
                message_counts = {}
            try:
                for cid, cnt in db.session.query(ChannelMember.channel_id, func.count(ChannelMember.id)).filter(ChannelMember.channel_id.in_(server_ids), ChannelMember.role == 'admin').group_by(ChannelMember.channel_id).all():
                    admin_counts[int(cid)] = int(cnt or 0)
            except Exception:
                admin_counts = {}
            creator_ids = {int(s.created_by) for s in servers if getattr(s, 'created_by', None)}
        creators = {}
        if creator_ids:
            try:
                creators = {int(u.id): u for u in User.query.filter(User.id.in_(list(creator_ids))).all()}
            except Exception:
                creators = {}

        stats = {
            'total': int(Channel.query.filter(Channel.is_dm.is_(False), Channel.guild_id == Channel.id).count()),
            'private': int(Channel.query.filter(Channel.is_dm.is_(False), Channel.guild_id == Channel.id, Channel.is_private.is_(True)).count()),
            'public': int(Channel.query.filter(Channel.is_dm.is_(False), Channel.guild_id == Channel.id, Channel.is_private.is_(False)).count()),
            'new_24h': int(Channel.query.filter(Channel.is_dm.is_(False), Channel.guild_id == Channel.id, Channel.created_at >= datetime.utcnow() - timedelta(hours=24)).count()),
        }

        return render_template('admin_servers.html', servers=servers, stats=stats, member_counts=member_counts, subchannel_counts=subchannel_counts, message_counts=message_counts, admin_counts=admin_counts, creators=creators, current_q=q, current_visibility=visibility, current_sort=sort, current_limit=limit)


    @app.route('/api/admin/users/toggle-disable', methods=['POST'])
    @login_required
    def api_admin_users_toggle_disable():
        if not _nc_auth_is_admin_auditor('users'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        try:
            user_id = int(data.get('user_id') or 0)
        except Exception:
            return jsonify(ok=False, error='bad_request'), 400
        user = User.query.filter_by(id=user_id).first()
        if not user:
            return jsonify(ok=False, error='not_found'), 404
        if int(user.id) == int(current_user.id):
            return jsonify(ok=False, error='self_action_blocked'), 400
        try:
            user.is_disabled = not bool(getattr(user, 'is_disabled', False))
            if bool(user.is_disabled):
                user.is_online = False
                try:
                    AuthSession.query.filter_by(user_id=int(user.id)).delete(synchronize_session=False)
                except Exception:
                    pass
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error='db_error'), 500
        return jsonify(ok=True, user_id=int(user.id), is_disabled=bool(user.is_disabled))


    @app.route('/api/admin/users/logout-all', methods=['POST'])
    @login_required
    def api_admin_users_logout_all():
        if not _nc_auth_is_admin_auditor('users'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        try:
            user_id = int(data.get('user_id') or 0)
        except Exception:
            return jsonify(ok=False, error='bad_request'), 400
        user = User.query.filter_by(id=user_id).first()
        if not user:
            return jsonify(ok=False, error='not_found'), 404
        deleted = 0
        try:
            deleted = AuthSession.query.filter_by(user_id=int(user.id)).delete(synchronize_session=False)
            user.is_online = False
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error='db_error'), 500
        return jsonify(ok=True, user_id=int(user.id), deleted_sessions=int(deleted or 0))


    @app.route("/admin/moderation", methods=["GET"])
    @login_required
    def admin_moderation():
        if not _nc_auth_is_admin_auditor('moderation'):
            abort(403)
        q = (request.args.get('q') or '').strip()
        report_status = (request.args.get('report_status') or '').strip().lower()
        message_state = (request.args.get('message_state') or '').strip().lower()
        reason = (request.args.get('reason') or '').strip().lower()
        try:
            limit = max(20, min(300, int(request.args.get('limit') or 100)))
        except Exception:
            limit = 100

        msg_query = Message.query
        rep_query = MessageReport.query
        if q:
            like = f"%{q}%"
            msg_query = msg_query.outerjoin(User, User.id == Message.user_id).outerjoin(Channel, Channel.id == Message.channel_id).filter(or_(Message.content.ilike(like), User.username.ilike(like), Channel.name.ilike(like), cast(Message.id, String).ilike(like)))
            rep_query = rep_query.outerjoin(Message, Message.id == MessageReport.message_id).outerjoin(User, User.id == MessageReport.reporter_user_id).outerjoin(Channel, Channel.id == MessageReport.channel_id).filter(or_(MessageReport.details.ilike(like), MessageReport.reason.ilike(like), Message.content.ilike(like), User.username.ilike(like), Channel.name.ilike(like), cast(MessageReport.id, String).ilike(like)))
        if message_state == 'hidden':
            msg_query = msg_query.filter(Message.deleted_at.is_not(None))
        elif message_state == 'visible':
            msg_query = msg_query.filter(Message.deleted_at.is_(None))
        if report_status:
            rep_query = rep_query.filter(MessageReport.status == report_status[:16])
        if reason:
            rep_query = rep_query.filter(MessageReport.reason == reason[:32])

        messages = msg_query.order_by(Message.created_at.desc()).limit(limit).all()
        reports = rep_query.order_by(case((MessageReport.status == 'open', 0), else_=1), MessageReport.created_at.desc()).limit(limit).all()

        user_ids = set()
        channel_ids = set()
        message_ids = set()
        for m in messages:
            if getattr(m, 'user_id', None): user_ids.add(int(m.user_id))
            if getattr(m, 'channel_id', None): channel_ids.add(int(m.channel_id))
            if getattr(m, 'id', None): message_ids.add(int(m.id))
        for r in reports:
            if getattr(r, 'reporter_user_id', None): user_ids.add(int(r.reporter_user_id))
            if getattr(r, 'target_user_id', None): user_ids.add(int(r.target_user_id))
            if getattr(r, 'channel_id', None): channel_ids.add(int(r.channel_id))
            if getattr(r, 'message_id', None): message_ids.add(int(r.message_id))
        user_map = {int(u.id): u for u in User.query.filter(User.id.in_(list(user_ids))).all()} if user_ids else {}
        channel_map = {int(ch.id): ch for ch in Channel.query.filter(Channel.id.in_(list(channel_ids))).all()} if channel_ids else {}
        message_map = {int(m.id): m for m in Message.query.filter(Message.id.in_(list(message_ids))).all()} if message_ids else {}

        report_counts = {}
        if message_ids:
            try:
                for mid, cnt in db.session.query(MessageReport.message_id, func.count(MessageReport.id)).filter(MessageReport.message_id.in_(list(message_ids))).group_by(MessageReport.message_id).all():
                    report_counts[int(mid)] = int(cnt or 0)
            except Exception:
                report_counts = {}

        report_reason_counts = []
        try:
            report_reason_counts = db.session.query(MessageReport.reason, func.count(MessageReport.id)).group_by(MessageReport.reason).order_by(func.count(MessageReport.id).desc()).limit(8).all()
        except Exception:
            report_reason_counts = []

        attachment_map = {}
        if message_ids:
            try:
                for a in Attachment.query.filter(Attachment.message_id.in_(list(message_ids))).order_by(Attachment.id.asc()).all():
                    attachment_map.setdefault(int(a.message_id), []).append(a)
            except Exception:
                attachment_map = {}

        target_user_ids = {int(m.user_id) for m in messages if getattr(m, 'user_id', None)} | {int(r.target_user_id) for r in reports if getattr(r, 'target_user_id', None)}
        active_mutes = {}
        if target_user_ids:
            try:
                mute_rows = AdminUserAction.query.filter(AdminUserAction.user_id.in_(list(target_user_ids)), AdminUserAction.action_type == 'mute', AdminUserAction.is_active.is_(True)).all()
                now = datetime.utcnow()
                for row in mute_rows:
                    if row.expires_at and row.expires_at <= now:
                        continue
                    active_mutes[int(row.user_id)] = row
            except Exception:
                active_mutes = {}

        return render_template(
            'admin_moderation.html',
            stats=_nc_admin_mod_stats(),
            messages=messages,
            reports=reports,
            user_map=user_map,
            channel_map=channel_map,
            message_map=message_map,
            attachment_map=attachment_map,
            active_mutes=active_mutes,
            report_counts=report_counts,
            report_reason_counts=report_reason_counts,
            current_q=q,
            current_report_status=report_status,
            current_message_state=message_state,
            current_reason=reason,
            current_limit=limit,
        )


    @app.route('/admin/users/<int:user_id>', methods=['GET'])
    @login_required
    def admin_user_detail(user_id: int):
        if not _nc_auth_is_admin_auditor('users'):
            abort(403)
        user = User.query.filter_by(id=int(user_id)).first_or_404()
        recent_messages = Message.query.filter_by(user_id=int(user.id)).order_by(Message.created_at.desc()).limit(30).all()
        sessions = AuthSession.query.filter_by(user_id=int(user.id)).order_by(AuthSession.last_seen_at.desc(), AuthSession.created_at.desc()).limit(30).all()
        attempts = AuthAttempt.query.filter(or_(AuthAttempt.user_id == int(user.id), AuthAttempt.login_value == _nc_login_norm(user.username))).order_by(AuthAttempt.created_at.desc()).limit(30).all()
        reports = MessageReport.query.filter(or_(MessageReport.reporter_user_id == int(user.id), MessageReport.target_user_id == int(user.id))).order_by(MessageReport.created_at.desc()).limit(30).all()
        membership_rows = ChannelMember.query.filter_by(user_id=int(user.id)).order_by(ChannelMember.joined_at.desc()).limit(100).all()
        action_rows = AdminUserAction.query.filter_by(user_id=int(user.id)).order_by(AdminUserAction.created_at.desc()).limit(50).all()
        channel_ids = {int(r.channel_id) for r in membership_rows if getattr(r, 'channel_id', None)} | {int(m.channel_id) for m in recent_messages if getattr(m, 'channel_id', None)}
        channel_map = {int(ch.id): ch for ch in Channel.query.filter(Channel.id.in_(list(channel_ids))).all()} if channel_ids else {}
        root_server_ids = sorted({int(ch.guild_id or ch.id) for ch in channel_map.values() if not getattr(ch, 'is_dm', False)})
        root_servers = {int(ch.id): ch for ch in Channel.query.filter(Channel.id.in_(root_server_ids)).all()} if root_server_ids else {}
        admin_grant = AdminGrant.query.filter_by(user_id=int(user.id)).first()
        return render_template('admin_user_detail.html', user_obj=user, recent_messages=recent_messages, sessions=sessions, attempts=attempts, reports=reports, membership_rows=membership_rows, channel_map=channel_map, root_servers=root_servers, action_rows=action_rows, active_mute=_nc_get_active_user_mute(int(user.id)), admin_grant=admin_grant, admin_permissions=sorted(_nc_admin_permissions_for(int(user.id))))


    @app.route('/admin/servers/<int:server_id>', methods=['GET'])
    @login_required
    def admin_server_detail(server_id: int):
        if not _nc_auth_is_admin_auditor('servers'):
            abort(403)
        server = Channel.query.filter(Channel.id == int(server_id), Channel.is_dm.is_(False), Channel.guild_id == Channel.id).first_or_404()
        subchannels = Channel.query.filter(Channel.guild_id == int(server.id)).order_by(Channel.category_id.asc().nullsfirst(), Channel.position.asc(), Channel.id.asc()).limit(200).all()
        member_rows = ChannelMember.query.filter_by(channel_id=int(server.id)).order_by(case((ChannelMember.role == 'admin', 0), (ChannelMember.role == 'moderator', 1), else_=2), ChannelMember.joined_at.desc()).limit(200).all()
        message_rows = db.session.query(Message).join(Channel, Channel.id == Message.channel_id).filter(Channel.guild_id == int(server.id)).order_by(Message.created_at.desc()).limit(40).all()
        creator = User.query.filter_by(id=int(server.created_by)).first() if getattr(server, 'created_by', None) else None
        user_ids = {int(r.user_id) for r in member_rows if getattr(r, 'user_id', None)} | {int(m.user_id) for m in message_rows if getattr(m, 'user_id', None)}
        user_map = {int(u.id): u for u in User.query.filter(User.id.in_(list(user_ids))).all()} if user_ids else {}
        active_server_mutes = {}
        active_server_bans = {}
        now = datetime.utcnow()
        if user_ids:
            rows = AdminUserAction.query.filter(AdminUserAction.user_id.in_(list(user_ids)), AdminUserAction.guild_id == int(server.id), AdminUserAction.action_type.in_(['server_mute', 'server_ban']), AdminUserAction.is_active.is_(True)).all()
            for row in rows:
                if row.expires_at and row.expires_at <= now:
                    continue
                if row.action_type == 'server_mute':
                    active_server_mutes[int(row.user_id)] = row
                elif row.action_type == 'server_ban':
                    active_server_bans[int(row.user_id)] = row
        return render_template('admin_server_detail.html', server=server, creator=creator, subchannels=subchannels, member_rows=member_rows, message_rows=message_rows, user_map=user_map, active_server_mutes=active_server_mutes, active_server_bans=active_server_bans)


    @app.route('/api/messages/report', methods=['POST'])
    @login_required
    def api_report_message_item():
        data = request.get_json(silent=True) or {}
        try:
            message_id = int(data.get('message_id') or 0)
        except Exception:
            return jsonify(ok=False, error='bad_request'), 400
        reason = (data.get('reason') or 'other').strip().lower()[:32] or 'other'
        details = (data.get('details') or '').strip()[:1000]
        msg = db.session.get(Message, message_id)
        if not msg:
            return jsonify(ok=False, error='not_found'), 404
        ch, mem = _require_membership(int(msg.channel_id), current_user.id)
        if not mem:
            return jsonify(ok=False, error='forbidden'), 403
        existing = MessageReport.query.filter_by(message_id=int(msg.id), reporter_user_id=int(current_user.id)).first()
        if existing:
            return jsonify(ok=True, duplicate=True, report_id=int(existing.id), status=str(existing.status or 'open'))
        rep = MessageReport(
            message_id=int(msg.id),
            reporter_user_id=int(current_user.id),
            target_user_id=int(getattr(msg, 'user_id', 0) or 0) or None,
            channel_id=int(msg.channel_id),
            guild_id=int(getattr(ch, 'guild_id', 0) or 0) or None,
            reason=reason,
            details=details,
            status='open',
        )
        try:
            db.session.add(rep)
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error='db_error'), 500
        return jsonify(ok=True, report_id=int(rep.id), status='open')


    @app.route('/api/admin/moderation/message-action', methods=['POST'])
    @login_required
    def api_admin_moderation_message_action():
        if not _nc_auth_is_admin_auditor('moderation'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        try:
            message_id = int(data.get('message_id') or 0)
        except Exception:
            return jsonify(ok=False, error='bad_request'), 400
        action = (data.get('action') or '').strip().lower()
        msg = Message.query.filter_by(id=message_id).first()
        if not msg:
            return jsonify(ok=False, error='not_found'), 404
        if action == 'hide':
            msg.deleted_at = msg.deleted_at or utcnow()
        elif action == 'restore':
            msg.deleted_at = None
        else:
            return jsonify(ok=False, error='bad_action'), 400
        try:
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error='db_error'), 500
        payload = {'id': int(msg.id), 'channel_id': int(msg.channel_id), 'content': msg.content or '', 'deleted_at': _iso_z(getattr(msg, 'deleted_at', None)), 'edited_at': _iso_z(getattr(msg, 'edited_at', None))}
        try:
            socketio.emit('message_updated', payload, to=f"channel_{int(msg.channel_id)}")
        except Exception:
            pass
        if getattr(msg, 'deleted_at', None):
            try:
                socketio.emit('message_deleted', {'id': int(msg.id), 'channel_id': int(msg.channel_id), 'deleted_at': _iso_z(msg.deleted_at)}, to=f"channel_{int(msg.channel_id)}")
            except Exception:
                pass
        return jsonify(ok=True, message=_nc_admin_message_payload(msg))


    @app.route('/api/admin/moderation/report-action', methods=['POST'])
    @login_required
    def api_admin_moderation_report_action():
        if not _nc_auth_is_admin_auditor('moderation'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        try:
            report_id = int(data.get('report_id') or 0)
        except Exception:
            return jsonify(ok=False, error='bad_request'), 400
        action = (data.get('action') or '').strip().lower()
        note = (data.get('moderator_note') or '').strip()[:1000]
        rep = MessageReport.query.filter_by(id=report_id).first()
        if not rep:
            return jsonify(ok=False, error='not_found'), 404
        if action == 'resolve':
            rep.status = 'resolved'
        elif action == 'dismiss':
            rep.status = 'dismissed'
        elif action == 'reopen':
            rep.status = 'open'
        else:
            return jsonify(ok=False, error='bad_action'), 400
        rep.moderator_note = note or rep.moderator_note
        rep.resolved_by = int(current_user.id) if rep.status != 'open' else None
        rep.resolved_at = utcnow() if rep.status != 'open' else None
        try:
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error='db_error'), 500
        return jsonify(ok=True, report_id=int(rep.id), status=str(rep.status), moderator_note=rep.moderator_note or '')

    @app.route('/api/admin/users/punish', methods=['POST'])
    @login_required
    def api_admin_users_punish():
        if not _nc_auth_is_admin_auditor('users'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        try:
            user_id = int(data.get('user_id') or 0)
        except Exception:
            return jsonify(ok=False, error='bad_request'), 400
        action = (data.get('action') or '').strip().lower()
        reason = (data.get('reason') or '').strip()[:1000]
        try:
            duration_minutes = int(data.get('duration_minutes') or 0)
        except Exception:
            duration_minutes = 0
        user = User.query.filter_by(id=user_id).first()
        if not user:
            return jsonify(ok=False, error='not_found'), 404
        if int(user.id) == int(current_user.id) and action in ('ban', 'mute'):
            return jsonify(ok=False, error='self_action_forbidden'), 400
        try:
            if action == 'ban':
                user.is_disabled = True
                _nc_admin_record_user_action(int(user.id), 'ban', reason=reason, is_active=True)
                db.session.commit()
                deleted = _nc_admin_revoke_user_sessions(int(user.id))
                return jsonify(ok=True, action='ban', user_id=int(user.id), is_disabled=True, deleted_sessions=deleted)
            elif action == 'unban':
                user.is_disabled = False
                for row in AdminUserAction.query.filter_by(user_id=int(user.id), action_type='ban', is_active=True).all():
                    row.is_active = False
                _nc_admin_record_user_action(int(user.id), 'unban', reason=reason, is_active=False)
                db.session.commit()
                return jsonify(ok=True, action='unban', user_id=int(user.id), is_disabled=False)
            elif action == 'mute':
                if duration_minutes <= 0:
                    duration_minutes = 60
                for row in AdminUserAction.query.filter_by(user_id=int(user.id), action_type='mute', is_active=True).all():
                    row.is_active = False
                row = _nc_admin_record_user_action(int(user.id), 'mute', reason=reason, duration_minutes=duration_minutes, is_active=True)
                db.session.commit()
                return jsonify(ok=True, action='mute', user_id=int(user.id), mute_until=_iso_z(row.expires_at), duration_minutes=duration_minutes)
            elif action == 'unmute':
                changed = 0
                for row in AdminUserAction.query.filter_by(user_id=int(user.id), action_type='mute', is_active=True).all():
                    row.is_active = False
                    changed += 1
                _nc_admin_record_user_action(int(user.id), 'unmute', reason=reason, is_active=False)
                db.session.commit()
                return jsonify(ok=True, action='unmute', user_id=int(user.id), changed=changed)
            elif action == 'logout_all':
                _nc_admin_record_user_action(int(user.id), 'logout_all', reason=reason, is_active=False)
                db.session.commit()
                deleted = _nc_admin_revoke_user_sessions(int(user.id))
                return jsonify(ok=True, action='logout_all', user_id=int(user.id), deleted_sessions=deleted)
            elif action in ('server_ban', 'server_unban', 'server_mute', 'server_unmute'):
                if not _nc_auth_is_admin_auditor('servers'):
                    return jsonify(ok=False, error='forbidden'), 403
                try:
                    server_id = int(data.get('server_id') or 0)
                except Exception:
                    server_id = 0
                if server_id <= 0:
                    return jsonify(ok=False, error='server_required'), 400
                server = Channel.query.filter(Channel.id == int(server_id), Channel.is_dm.is_(False), Channel.guild_id == Channel.id).first()
                if not server:
                    return jsonify(ok=False, error='server_not_found'), 404
                if action == 'server_ban':
                    if duration_minutes <= 0:
                        duration_minutes = 0
                    for row in AdminUserAction.query.filter_by(user_id=int(user.id), guild_id=int(server_id), action_type='server_ban', is_active=True).all():
                        row.is_active = False
                    _nc_kick_user_from_server(int(server_id), int(user.id))
                    row = _nc_admin_record_user_action(int(user.id), 'server_ban', reason=reason, duration_minutes=duration_minutes, guild_id=int(server_id), is_active=True)
                    db.session.commit()
                    return jsonify(ok=True, action='server_ban', user_id=int(user.id), server_id=int(server_id), ban_until=_iso_z(row.expires_at), duration_minutes=duration_minutes)
                elif action == 'server_unban':
                    changed = 0
                    for row in AdminUserAction.query.filter_by(user_id=int(user.id), guild_id=int(server_id), action_type='server_ban', is_active=True).all():
                        row.is_active = False
                        changed += 1
                    _nc_admin_record_user_action(int(user.id), 'server_unban', reason=reason, guild_id=int(server_id), is_active=False)
                    db.session.commit()
                    return jsonify(ok=True, action='server_unban', user_id=int(user.id), server_id=int(server_id), changed=changed)
                elif action == 'server_mute':
                    if duration_minutes <= 0:
                        duration_minutes = 60
                    for row in AdminUserAction.query.filter_by(user_id=int(user.id), guild_id=int(server_id), action_type='server_mute', is_active=True).all():
                        row.is_active = False
                    row = _nc_admin_record_user_action(int(user.id), 'server_mute', reason=reason, duration_minutes=duration_minutes, guild_id=int(server_id), is_active=True)
                    db.session.commit()
                    return jsonify(ok=True, action='server_mute', user_id=int(user.id), server_id=int(server_id), mute_until=_iso_z(row.expires_at), duration_minutes=duration_minutes)
                elif action == 'server_unmute':
                    changed = 0
                    for row in AdminUserAction.query.filter_by(user_id=int(user.id), guild_id=int(server_id), action_type='server_mute', is_active=True).all():
                        row.is_active = False
                        changed += 1
                    _nc_admin_record_user_action(int(user.id), 'server_unmute', reason=reason, guild_id=int(server_id), is_active=False)
                    db.session.commit()
                    return jsonify(ok=True, action='server_unmute', user_id=int(user.id), server_id=int(server_id), changed=changed)
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error='db_error'), 500
        return jsonify(ok=False, error='bad_action'), 400


    @app.route('/api/admin/servers/kick-member', methods=['POST'])
    @login_required
    def api_admin_servers_kick_member():
        if not _nc_auth_is_admin_auditor('servers'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        try:
            server_id = int(data.get('server_id') or 0)
            user_id = int(data.get('user_id') or 0)
        except Exception:
            return jsonify(ok=False, error='bad_request'), 400
        reason = (data.get('reason') or '').strip()[:1000]
        if not server_id or not user_id:
            return jsonify(ok=False, error='bad_request'), 400
        try:
            info = _nc_kick_user_from_server(int(server_id), int(user_id))
            _nc_admin_record_user_action(int(user_id), 'kick_server', reason=reason, guild_id=int(server_id), is_active=False)
            db.session.commit()
        except ValueError:
            return jsonify(ok=False, error='server_not_found'), 404
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error='db_error'), 500
        return jsonify(ok=True, server_id=int(server_id), user_id=int(user_id), deleted_memberships=int(info.get('deleted_memberships') or 0))


    @app.route('/api/admin/moderation/bulk', methods=['POST'])
    @login_required
    def api_admin_moderation_bulk():
        if not _nc_auth_is_admin_auditor('moderation'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        kind = (data.get('kind') or '').strip().lower()
        action = (data.get('action') or '').strip().lower()
        ids_raw = data.get('ids') or []
        ids = []
        for item in ids_raw:
            try:
                ids.append(int(item))
            except Exception:
                pass
        ids = sorted(set(i for i in ids if i > 0))
        if not ids:
            return jsonify(ok=False, error='empty_ids'), 400
        changed = 0
        try:
            if kind == 'messages':
                rows = Message.query.filter(Message.id.in_(ids)).all()
                for msg in rows:
                    if action == 'hide':
                        if not msg.deleted_at:
                            msg.deleted_at = utcnow()
                            changed += 1
                    elif action == 'restore':
                        if msg.deleted_at:
                            msg.deleted_at = None
                            changed += 1
                db.session.commit()
                return jsonify(ok=True, kind='messages', action=action, changed=changed)
            if kind == 'reports':
                rows = MessageReport.query.filter(MessageReport.id.in_(ids)).all()
                for rep in rows:
                    if action == 'resolve' and rep.status != 'resolved':
                        rep.status = 'resolved'; rep.resolved_by = int(current_user.id); rep.resolved_at = utcnow(); changed += 1
                    elif action == 'dismiss' and rep.status != 'dismissed':
                        rep.status = 'dismissed'; rep.resolved_by = int(current_user.id); rep.resolved_at = utcnow(); changed += 1
                    elif action == 'reopen' and rep.status != 'open':
                        rep.status = 'open'; rep.resolved_by = None; rep.resolved_at = None; changed += 1
                db.session.commit()
                return jsonify(ok=True, kind='reports', action=action, changed=changed)
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error='db_error'), 500
        return jsonify(ok=False, error='bad_action'), 400


    @app.route("/recover", methods=["GET", "POST"])
    def recover_password():
        if current_user.is_authenticated:
            return redirect(url_for("chat"))
        if request.method == "POST":
            username = (request.form.get("username") or "").strip()
            code = (request.form.get("code") or "").strip().upper()
            p1 = request.form.get("password") or ""
            p2 = request.form.get("password2") or ""

            if p1 != p2:
                flash("Пароли не совпадают.", "error")
                return render_template("recover.html")

            if not (8 <= len(p1) <= 24):
                flash("Пароль должен быть от 8 до 24 символа.", "error")
                return render_template("recover.html")

            ok, msg = _validate_password(p1, username=username)
            if not ok:
                flash(msg, "error")
                return render_template("recover.html")

            user = None
            try:
                user = User.query.filter_by(username_norm=_norm_username(username)).first()
            except Exception:
                user = None
            if not user:
                user = User.query.filter_by(username=username).first()
            if not user:
                flash("Неверные данные.", "error")
                return render_template("recover.html")

            if not _use_recovery_code(user.id, code):
                flash("Неверный или уже использованный код восстановления.", "error")
                return render_template("recover.html")

            user.set_password(p1)
            db.session.commit()
            flash("Пароль обновлён. Теперь можно войти.", "ok")
            return redirect(url_for("login"))

        return render_template("recover.html")

    @app.route("/forgot", methods=["GET", "POST"])
    def forgot_password():
        return redirect(url_for("recover_password"))

    @app.route("/reset/<token>", methods=["GET", "POST"])
    def reset_password(token: str):
        return redirect(url_for("recover_password"))

    @app.route("/logout")
    @login_required
    def logout():
        uid = current_user.id
        try:
            user_sids.pop(uid, None)
            presence_last_beat.pop(uid, None)
            _set_user_presence(uid, False)
        except Exception:
            pass
        try:
            _nc_revoke_current_auth_session(int(uid))
        except Exception:
            pass
        logout_user()
        resp = redirect(url_for("login"))
        try:
            resp.delete_cookie(AUTH_SESSION_COOKIE)
        except Exception:
            pass
        return resp


    # --- Fix268/270: sessions + auth audit API ---
    @app.route("/api/auth/audit", methods=["GET"])
    @login_required
    def api_auth_audit():
        try:
            uid = int(current_user.id)
        except Exception:
            return jsonify(ok=False, error="unauthorized"), 401

        try:
            limit = int(request.args.get('limit') or 30)
        except Exception:
            limit = 30
        limit = max(1, min(AUTH_AUDIT_MAX_ROWS, limit))

        current_hash = None
        try:
            tok = request.cookies.get(AUTH_SESSION_COOKIE)
            if tok:
                current_hash = _nc_hash_session_token(tok)
        except Exception:
            current_hash = None

        do_geo = False
        try:
            if request.args.get("geo") in ("1", "true", "yes", "on"):
                kv = _get_settings_kv(current_user)
                do_geo = _nc_boolish(kv.get("nc_sessions_geo"), default=False)
        except Exception:
            do_geo = False

        try:
            sessions_rows = AuthSession.query.filter_by(user_id=uid).order_by(AuthSession.last_seen_at.desc()).all()
        except Exception:
            sessions_rows = []

        try:
            history_rows = AuthAttempt.query.filter(
                AuthAttempt.user_id == uid,
                AuthAttempt.status.in_(['success_login', 'success_2fa'])
            ).order_by(AuthAttempt.created_at.desc()).limit(limit).all()
        except Exception:
            history_rows = []

        try:
            failed_rows = AuthAttempt.query.filter(
                AuthAttempt.user_id == uid,
                AuthAttempt.status.in_(['bad_password', 'bad_2fa', 'rate_limited_2fa', 'rate_limited_login'])
            ).order_by(AuthAttempt.created_at.desc()).limit(limit).all()
        except Exception:
            failed_rows = []

        invalid_rows = []
        show_invalid = _nc_auth_is_admin_auditor('security')
        if show_invalid:
            try:
                invalid_rows = AuthAttempt.query.filter(
                    AuthAttempt.user_id.is_(None),
                    AuthAttempt.status.in_(['bad_login', 'rate_limited_login'])
                ).order_by(AuthAttempt.created_at.desc()).limit(limit).all()
            except Exception:
                invalid_rows = []

        geo_map = {}
        if do_geo:
            try:
                ips = sorted({(r.ip_address or '').strip() for r in (list(sessions_rows) + list(history_rows) + list(failed_rows) + list(invalid_rows)) if (r and r.ip_address)})
                if len(ips) > 12:
                    ips = ips[:12]
                for ip in ips:
                    if ip:
                        geo_map[ip] = _nc_geo_lookup(ip)
            except Exception:
                geo_map = {}

        sessions = []
        for r in sessions_rows:
            try:
                meta = _nc_parse_user_agent(r.user_agent or "")
            except Exception:
                meta = {"browser": "Browser", "browser_version": None, "os": "Unknown OS", "device": "Desktop"}
            sessions.append({
                "id": r.id,
                "browser": meta.get("browser"),
                "browser_version": meta.get("browser_version"),
                "os": meta.get("os"),
                "device": meta.get("device"),
                "ip_address": r.ip_address,
                "created_at": _nc_dt_iso(r.created_at),
                "last_seen_at": _nc_dt_iso(r.last_seen_at),
                "is_current": True if (current_hash and (r.token_hash == current_hash)) else False,
                "geo": (geo_map.get((r.ip_address or "").strip()) if do_geo else None),
            })

        active_blocks_count = 0
        admin_blocks = []
        top_ip_activity = []
        if show_invalid:
            try:
                now_utc = datetime.utcnow()
                active_blocks = AuthSecurityBlock.query.filter(AuthSecurityBlock.active.is_(True), AuthSecurityBlock.expires_at > now_utc).order_by(AuthSecurityBlock.expires_at.asc()).limit(20).all()
                active_blocks_count = AuthSecurityBlock.query.filter(AuthSecurityBlock.active.is_(True), AuthSecurityBlock.expires_at > now_utc).count()
                admin_blocks = [
                    {
                        'id': int(getattr(b, 'id', 0) or 0),
                        'scope_type': getattr(b, 'scope_type', None),
                        'scope_value': getattr(b, 'scope_value', None),
                        'phase': getattr(b, 'phase', None),
                        'reason': getattr(b, 'reason', None),
                        'created_at': _nc_dt_iso(getattr(b, 'created_at', None)),
                        'expires_at': _nc_dt_iso(getattr(b, 'expires_at', None)),
                    }
                    for b in active_blocks
                ]
            except Exception:
                active_blocks_count = 0
                admin_blocks = []
            try:
                cutoff = datetime.utcnow() - timedelta(hours=24)
                top_ip_counts = {}
                for row in AuthAttempt.query.filter(AuthAttempt.created_at >= cutoff).all():
                    ip = (row.ip_address or '').strip()
                    if ip:
                        top_ip_counts[ip] = top_ip_counts.get(ip, 0) + 1
                top_ip_activity = [
                    {'ip_address': ip, 'count': int(count)}
                    for ip, count in sorted(top_ip_counts.items(), key=lambda kv: kv[1], reverse=True)[:10]
                ]
            except Exception:
                top_ip_activity = []

        return jsonify(
            ok=True,
            sessions=sessions,
            history=[_nc_auth_attempt_payload(r, include_geo=do_geo, geo_map=geo_map) for r in history_rows],
            failed=[_nc_auth_attempt_payload(r, include_geo=do_geo, geo_map=geo_map) for r in failed_rows],
            invalid_logins=[_nc_auth_attempt_payload(r, include_geo=do_geo, geo_map=geo_map) for r in invalid_rows],
            show_invalid_logins=bool(show_invalid),
            active_blocks_count=int(active_blocks_count or 0),
            active_blocks=admin_blocks,
            top_ip_activity=top_ip_activity,
            admin_security_url=(url_for('admin_security') if show_invalid else None),
            admin_dashboard_url=(url_for('admin_dashboard') if show_invalid else None),
        )

    @app.route("/admin/roles", methods=["GET"])
    @login_required
    def admin_roles():
        if not _nc_auth_is_admin_auditor('roles'):
            return redirect(url_for('chat'))
        q = (request.args.get('q') or '').strip()
        users_q = User.query
        if q:
            like = f"%{q}%"
            users_q = users_q.filter(or_(User.username.ilike(like), User.display_name.ilike(like), User.email.ilike(like)))
        users = users_q.order_by(User.last_seen.desc().nullslast(), User.created_at.desc()).limit(80).all()
        grants = {int(g.user_id): g for g in AdminGrant.query.all()}
        support_profiles = {int(x.user_id): x for x in SupportStaffProfile.query.all()}
        return render_template('admin_roles.html', users=users, grants=grants, support_profiles=support_profiles, all_permissions=list(NC_ADMIN_PERMISSIONS), q=q)


    @app.route('/api/admin/roles/set', methods=['POST'])
    @login_required
    def api_admin_roles_set():
        if not _nc_auth_is_admin_auditor('roles'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        try:
            user_id = int(data.get('user_id') or 0)
        except Exception:
            user_id = 0
        user = User.query.filter_by(id=user_id).first()
        if not user or user_id <= 0:
            return jsonify(ok=False, error='not_found'), 404
        if int(user_id) == 1:
            return jsonify(ok=False, error='owner_locked'), 400
        perms_in = data.get('permissions') or []
        if isinstance(perms_in, str):
            perms_in = [x.strip() for x in perms_in.split(',') if x.strip()]
        perms = sorted({str(x).strip().lower() for x in perms_in if str(x).strip().lower() in NC_ADMIN_PERMISSIONS})
        is_superadmin = bool(data.get('is_superadmin'))
        note = (data.get('note') or '').strip()[:255]
        support_role = (data.get('support_role') or 'support').strip().lower()
        if support_role not in SUPPORT_ROLE_LEVELS:
            support_role = 'support'
        row = AdminGrant.query.filter_by(user_id=int(user_id)).first()
        support_profile = SupportStaffProfile.query.filter_by(user_id=int(user_id)).first()
        try:
            if row is None:
                row = AdminGrant(user_id=int(user_id), granted_by=int(current_user.id), permissions=','.join(perms), is_superadmin=is_superadmin, note=note or None)
                db.session.add(row)
            else:
                row.granted_by = int(current_user.id)
                row.permissions = ','.join(perms)
                row.is_superadmin = is_superadmin
                row.note = note or None
            if 'support' in perms or is_superadmin or support_profile is not None:
                if support_profile is None:
                    support_profile = SupportStaffProfile(user_id=int(user_id), role_level=support_role, updated_by=int(current_user.id), note=note or None)
                    db.session.add(support_profile)
                else:
                    support_profile.role_level = support_role
                    support_profile.updated_by = int(current_user.id)
                    support_profile.note = note or None
            _nc_admin_record_user_action(int(user_id), 'admin_grant', reason=(f"superadmin={1 if is_superadmin else 0}; perms={','.join(perms)}; support_role={support_role}; note={note}"), is_active=False)
            db.session.commit()
            return jsonify(ok=True, user_id=int(user_id), permissions=perms, is_superadmin=is_superadmin, support_role=support_role)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/admin/audit', methods=['GET'])
    @login_required
    def admin_audit():
        if not _nc_auth_is_admin_auditor('audit'):
            return redirect(url_for('chat'))
        q = (request.args.get('q') or '').strip()
        action_type = (request.args.get('action_type') or '').strip().lower()
        active = (request.args.get('active') or '').strip()
        query = AdminUserAction.query
        if q:
            like = f"%{q}%"
            ids = [int(r[0]) for r in db.session.query(User.id).filter(or_(User.username.ilike(like), User.display_name.ilike(like), User.email.ilike(like))).all()]
            conds = [AdminUserAction.reason.ilike(like)]
            if q.isdigit():
                conds += [AdminUserAction.user_id == int(q), AdminUserAction.admin_user_id == int(q), AdminUserAction.guild_id == int(q)]
            if ids:
                conds += [AdminUserAction.user_id.in_(ids), AdminUserAction.admin_user_id.in_(ids)]
            query = query.filter(or_(*conds))
        if action_type:
            query = query.filter(AdminUserAction.action_type == action_type)
        if active in ('1', 'true', 'yes'):
            query = query.filter(AdminUserAction.is_active.is_(True))
        elif active in ('0', 'false', 'no'):
            query = query.filter(AdminUserAction.is_active.is_(False))
        rows = query.order_by(AdminUserAction.created_at.desc()).limit(300).all()
        user_ids = sorted({int(r.user_id) for r in rows} | {int(r.admin_user_id) for r in rows if r.admin_user_id})
        user_map = {u.id: u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
        server_ids = sorted({int(r.guild_id) for r in rows if r.guild_id})
        server_map = {c.id: c for c in Channel.query.filter(Channel.id.in_(server_ids)).all()} if server_ids else {}
        stats = {
            'total': int(AdminUserAction.query.count()),
            'active': int(AdminUserAction.query.filter(AdminUserAction.is_active.is_(True)).count()),
            'server_actions': int(AdminUserAction.query.filter(AdminUserAction.guild_id.isnot(None)).count()),
            'recent_24h': int(AdminUserAction.query.filter(AdminUserAction.created_at >= datetime.utcnow() - timedelta(hours=24)).count()),
        }
        return render_template('admin_audit.html', rows=rows, user_map=user_map, server_map=server_map, stats=stats, q=q, action_type=action_type, active=active)


    @app.route('/api/admin/audit/export', methods=['GET'])
    @login_required
    def api_admin_audit_export():
        if not _nc_auth_is_admin_auditor('audit'):
            return jsonify(ok=False, error='forbidden'), 403
        fmt = (request.args.get('format') or 'csv').strip().lower()
        rows = AdminUserAction.query.order_by(AdminUserAction.created_at.desc()).limit(2000).all()
        payload = [{
            'id': int(r.id), 'user_id': int(r.user_id), 'admin_user_id': int(r.admin_user_id or 0) or None, 'guild_id': int(r.guild_id or 0) or None,
            'action_type': r.action_type, 'reason': r.reason or '', 'duration_minutes': r.duration_minutes, 'expires_at': _iso_z(r.expires_at), 'is_active': bool(r.is_active), 'created_at': _iso_z(r.created_at)
        } for r in rows]
        if fmt == 'json':
            return jsonify(ok=True, rows=payload)
        return _nc_admin_send_csv('admin_audit.csv', payload)


    @app.route('/support', methods=['GET'])
    @login_required
    def support_center():
        try:
            ticket_id = int(request.args.get('ticket') or 0)
        except Exception:
            ticket_id = 0
        status = (request.args.get('status') or '').strip().lower()
        query = SupportTicket.query.filter_by(user_id=int(current_user.id))
        if status in ('open', 'pending', 'closed'):
            query = query.filter(SupportTicket.status == status)
        tickets = query.order_by(SupportTicket.last_message_at.desc(), SupportTicket.id.desc()).limit(100).all()
        selected = SupportTicket.query.filter_by(id=ticket_id, user_id=int(current_user.id)).first() if ticket_id > 0 else (tickets[0] if tickets else None)
        messages = []
        users = {}
        attachment_map = {}
        if selected:
            messages = SupportTicketMessage.query.filter_by(ticket_id=int(selected.id), is_internal=False).order_by(SupportTicketMessage.created_at.asc(), SupportTicketMessage.id.asc()).all()
            user_ids = sorted({int(selected.user_id)} | {int(m.author_user_id) for m in messages if m.author_user_id})
            users = {u.id: u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
            msg_ids = [int(m.id) for m in messages]
            if msg_ids:
                for a in SupportTicketAttachment.query.filter(SupportTicketAttachment.message_id.in_(msg_ids)).order_by(SupportTicketAttachment.id.asc()).all():
                    attachment_map.setdefault(int(a.message_id), []).append(a)
        return render_template('support_center.html', tickets=tickets, selected=selected, messages=messages, user_map=users, status=status, attachment_map=attachment_map, sla_map={int(t.id): _nc_support_sla_payload(t) for t in tickets}, selected_sla=_nc_support_sla_payload(selected) if selected else None, tag_list=_nc_support_tags_list, saved_replies=_nc_support_reply_library())


    @app.route('/api/support/tickets', methods=['POST'])
    @login_required
    def api_support_create_ticket():
        data = request.get_json(silent=True) or request.form or {}
        subject = (data.get('subject') or '').strip()[:160]
        body = (data.get('body') or '').strip()[:4000]
        category = (data.get('category') or 'other').strip().lower()[:32]
        priority = (data.get('priority') or 'normal').strip().lower()[:16]
        try:
            guild_id = int(data.get('guild_id') or 0) or None
        except Exception:
            guild_id = None
        if not subject or len(subject) < 4:
            return jsonify(ok=False, error='subject_too_short'), 400
        if not body or len(body) < 8:
            return jsonify(ok=False, error='body_too_short'), 400
        allowed_category = {'billing', 'bug', 'report', 'security', 'server', 'other'}
        allowed_priority = {'low', 'normal', 'high', 'urgent'}
        requested_category = category if category in allowed_category else 'other'
        if category not in allowed_category:
            category = 'other'
        if priority not in allowed_priority:
            priority = 'normal'
        detected_category, detected_tags = _nc_support_infer_category(subject, body, fallback=(requested_category or 'other'))
        auto_routed = False
        if requested_category == 'other' and detected_category in allowed_category and detected_category != 'other':
            category = detected_category
            auto_routed = True
        else:
            category = requested_category
        try:
            ticket = SupportTicket(user_id=int(current_user.id), guild_id=guild_id, subject=subject, category=category, priority=priority, status='open', waiting_for='staff')
            if detected_tags:
                ticket.tags_csv = ', '.join(detected_tags[:6])
            db.session.add(ticket)
            db.session.flush()
            msg = SupportTicketMessage(ticket_id=int(ticket.id), author_user_id=int(current_user.id), body=body, is_staff=False, is_internal=False)
            db.session.add(msg)
            db.session.flush()
            saved_files = _nc_support_save_attachments(request.files.getlist('files') if request.files else [], int(ticket.id), int(msg.id))
            _nc_support_touch_ticket(ticket, status='open', actor='user')
            _nc_support_auto_assign(ticket, reason='auto_assigned_new_ticket')
            if auto_routed:
                _nc_support_log_event(int(ticket.id), 'category_auto_routed', actor_user_id=None, event_value=(ticket.category or 'other'), body=(requested_category or 'other'), meta={'detected_tags': detected_tags[:6]})
            _nc_support_log_event(int(ticket.id), 'ticket_created', actor_user_id=int(current_user.id), event_value=(ticket.category or 'other'), body=(ticket.subject or '')[:255], meta={'priority': ticket.priority, 'attachments': len(saved_files or []), 'assigned_to': int(getattr(ticket, 'assigned_to', 0) or 0) or None, 'auto_routed': bool(auto_routed)})
            _nc_support_log_event(int(ticket.id), 'user_reply', actor_user_id=int(current_user.id), body=body[:500], meta={'attachments': len(saved_files or [])})
            db.session.commit()
            _nc_support_run_escalations(limit=20)
            _nc_support_emit_refresh(reason='ticket_created', ticket_id=int(ticket.id), target_user_ids=[int(current_user.id), int(getattr(ticket, 'assigned_to', 0) or 0)])
            return jsonify(ok=True, ticket_id=int(ticket.id), redirect_url=url_for('support_center', ticket=int(ticket.id)))
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/support/tickets/<int:ticket_id>/reply', methods=['POST'])
    @login_required
    def api_support_reply(ticket_id: int):
        ticket = SupportTicket.query.filter_by(id=int(ticket_id), user_id=int(current_user.id)).first()
        if not ticket:
            return jsonify(ok=False, error='not_found'), 404
        if str(getattr(ticket, 'status', 'open')).lower() == 'closed':
            return jsonify(ok=False, error='ticket_closed'), 400
        data = request.get_json(silent=True) or request.form or {}
        body = (data.get('body') or '').strip()[:4000]
        if not body or len(body) < 1:
            return jsonify(ok=False, error='empty_body'), 400
        try:
            msg = SupportTicketMessage(ticket_id=int(ticket.id), author_user_id=int(current_user.id), body=body, is_staff=False, is_internal=False)
            db.session.add(msg)
            db.session.flush()
            saved_files = _nc_support_save_attachments(request.files.getlist('files') if request.files else [], int(ticket.id), int(msg.id))
            _nc_support_touch_ticket(ticket, status='open', actor='user')
            if not getattr(ticket, 'assigned_to', None):
                _nc_support_auto_assign(ticket, reason='auto_assigned_user_reply')
            _nc_support_log_event(int(ticket.id), 'user_reply', actor_user_id=int(current_user.id), body=body[:500], meta={'attachments': len(saved_files or []), 'assigned_to': int(getattr(ticket, 'assigned_to', 0) or 0) or None})
            db.session.commit()
            _nc_support_run_escalations(limit=20)
            _nc_support_emit_refresh(reason='user_reply', ticket_id=int(ticket.id), target_user_ids=[int(current_user.id), int(getattr(ticket, 'assigned_to', 0) or 0)])
            return jsonify(ok=True)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/support/tickets/<int:ticket_id>/close', methods=['POST'])
    @login_required
    def api_support_close(ticket_id: int):
        ticket = SupportTicket.query.filter_by(id=int(ticket_id), user_id=int(current_user.id)).first()
        if not ticket:
            return jsonify(ok=False, error='not_found'), 404
        try:
            _nc_support_touch_ticket(ticket, status='closed')
            _nc_support_log_event(int(ticket.id), 'status_changed', actor_user_id=int(current_user.id), event_value='closed')
            db.session.commit()
            _nc_support_emit_refresh(reason='ticket_closed', ticket_id=int(ticket.id), target_user_ids=[int(current_user.id), int(getattr(ticket, 'assigned_to', 0) or 0)])
            return jsonify(ok=True)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/admin/support/analytics', methods=['GET'])
    @login_required
    def admin_support_analytics():
        if not _nc_auth_is_admin_auditor('support'):
            return redirect(url_for('chat'))
        _nc_support_run_escalations(limit=60)
        try:
            days = int(request.args.get('days') or 30)
        except Exception:
            days = 30
        _nc_support_run_escalations(limit=60)
        analytics = _nc_support_analytics_payload(days=days)
        return render_template('admin_support_analytics.html', analytics=analytics, days=max(1, min(days, 365)))


    @app.route('/admin/support', methods=['GET'])
    @login_required
    def admin_support():
        if not _nc_auth_is_admin_auditor('support'):
            return redirect(url_for('chat'))
        q = (request.args.get('q') or '').strip()
        status = (request.args.get('status') or '').strip().lower()
        priority = (request.args.get('priority') or '').strip().lower()
        assigned = (request.args.get('assigned') or '').strip().lower()
        tag = (request.args.get('tag') or '').strip()
        attachment_q = (request.args.get('attachment_q') or '').strip()
        queue = (request.args.get('queue') or '').strip().lower()
        try:
            ticket_id = int(request.args.get('ticket') or 0)
        except Exception:
            ticket_id = 0
        query = SupportTicket.query
        if status in ('open', 'pending', 'closed'):
            query = query.filter(SupportTicket.status == status)
        if priority in ('low', 'normal', 'high', 'urgent'):
            query = query.filter(SupportTicket.priority == priority)
        if assigned == 'me':
            query = query.filter(SupportTicket.assigned_to == int(current_user.id))
        elif assigned == 'unassigned':
            query = query.filter(SupportTicket.assigned_to.is_(None))
        elif assigned == 'any':
            query = query.filter(SupportTicket.assigned_to.is_not(None))
        if queue == 'mine':
            query = query.filter(SupportTicket.assigned_to == int(current_user.id))
        elif queue == 'unassigned':
            query = query.filter(SupportTicket.assigned_to.is_(None))
        elif queue == 'overdue':
            query = query.filter(SupportTicket.status != 'closed', SupportTicket.waiting_for == 'staff', SupportTicket.next_reply_due_at.is_not(None), SupportTicket.next_reply_due_at < datetime.utcnow())
        if q:
            like = f"%{q}%"
            user_ids = [int(r[0]) for r in db.session.query(User.id).filter(or_(User.username.ilike(like), User.display_name.ilike(like), User.email.ilike(like))).all()]
            conds = [SupportTicket.subject.ilike(like), SupportTicket.tags_csv.ilike(like)]
            if q.isdigit():
                conds += [SupportTicket.id == int(q), SupportTicket.user_id == int(q), SupportTicket.guild_id == int(q)]
            if user_ids:
                conds += [SupportTicket.user_id.in_(user_ids), SupportTicket.assigned_to.in_(user_ids)]
            query = query.filter(or_(*conds))
        if tag:
            query = query.filter(SupportTicket.tags_csv.ilike(f"%{tag}%"))
        tickets = query.order_by(case((SupportTicket.status == 'open', 0), (SupportTicket.status == 'pending', 1), else_=2), SupportTicket.last_message_at.desc()).limit(200).all()
        selected = SupportTicket.query.filter_by(id=ticket_id).first() if ticket_id > 0 else (tickets[0] if tickets else None)
        messages = []
        users = {}
        attachment_map = {}
        if selected:
            messages = SupportTicketMessage.query.filter_by(ticket_id=int(selected.id)).order_by(SupportTicketMessage.created_at.asc(), SupportTicketMessage.id.asc()).all()
            msg_ids = [int(m.id) for m in messages]
            if msg_ids:
                for a in SupportTicketAttachment.query.filter(SupportTicketAttachment.message_id.in_(msg_ids)).order_by(SupportTicketAttachment.id.asc()).all():
                    attachment_map.setdefault(int(a.message_id), []).append(a)
        user_ids = sorted({int(t.user_id) for t in tickets} | {int(t.assigned_to) for t in tickets if t.assigned_to} | ({int(selected.user_id), int(selected.assigned_to)} if selected and selected.assigned_to else ({int(selected.user_id)} if selected else set())) | {int(m.author_user_id) for m in messages if m.author_user_id})
        users = {u.id: u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
        stats = _nc_get_support_stats()
        analytics_mini = _nc_support_analytics_payload(days=7)
        support_profiles = {int(x.user_id): x for x in SupportStaffProfile.query.all()}
        support_notifications = _nc_support_notifications_for_user(int(current_user.id))
        attachment_results = []
        if attachment_q:
            alike = f"%{attachment_q}%"
            attachment_rows = SupportTicketAttachment.query.join(SupportTicket, SupportTicket.id == SupportTicketAttachment.ticket_id).filter(or_(SupportTicketAttachment.file_name.ilike(alike), SupportTicket.subject.ilike(alike))).order_by(SupportTicketAttachment.created_at.desc(), SupportTicketAttachment.id.desc()).limit(80).all()
            attachment_user_ids = sorted({int(a.ticket_id) for a in attachment_rows})
            ticket_map = {int(t.id): t for t in SupportTicket.query.filter(SupportTicket.id.in_(attachment_user_ids)).all()} if attachment_user_ids else {}
            more_user_ids = sorted({int(getattr(t, 'user_id', 0) or 0) for t in ticket_map.values() if getattr(t, 'user_id', None)})
            if more_user_ids:
                for u in User.query.filter(User.id.in_(more_user_ids)).all():
                    users[u.id] = u
            attachment_results = []
            for a in attachment_rows:
                t = ticket_map.get(int(a.ticket_id))
                owner = users.get(int(getattr(t, 'user_id', 0) or 0)) if t else None
                attachment_results.append({'id': int(a.id), 'ticket_id': int(a.ticket_id), 'message_id': int(a.message_id), 'file_name': a.file_name or '', 'file_url': a.file_url or '', 'mime_type': a.mime_type or '', 'is_image': bool(a.is_image), 'created_at': a.created_at, 'username': (owner.username if owner else ''), 'subject': (t.subject if t else '')})
        avg_rating = None
        try:
            rating_rows = db.session.query(func.avg(SupportTicket.satisfaction_rating), func.count(SupportTicket.id)).filter(SupportTicket.satisfaction_rating.is_not(None)).first()
            if rating_rows and rating_rows[0] is not None:
                avg_rating = {'value': round(float(rating_rows[0]), 2), 'count': int(rating_rows[1] or 0)}
        except Exception:
            avg_rating = None
        selected_events = SupportTicketEvent.query.filter_by(ticket_id=int(selected.id)).order_by(SupportTicketEvent.created_at.desc(), SupportTicketEvent.id.desc()).limit(60).all() if selected else []
        if selected:
            try:
                SupportTicketMention.query.filter_by(ticket_id=int(selected.id), target_user_id=int(current_user.id), is_read=False).update({'is_read': True, 'read_at': datetime.utcnow()})
                db.session.commit()
            except Exception:
                try: db.session.rollback()
                except Exception: pass
        selected_reply_macros = _nc_support_visible_replies(selected)
        try:
            staff_profile = SupportStaffProfile.query.filter_by(user_id=int(current_user.id)).first()
            if staff_profile is None and (_nc_auth_is_admin_auditor('support') or int(current_user.id) == 1):
                staff_profile = SupportStaffProfile(user_id=int(current_user.id), role_level=_nc_support_role_for_user(int(current_user.id)), updated_by=int(current_user.id), last_seen_at=datetime.utcnow())
                db.session.add(staff_profile)
            elif staff_profile is not None:
                staff_profile.last_seen_at = datetime.utcnow()
            db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass
        return render_template('admin_support.html', tickets=tickets, selected=selected, messages=messages, user_map=users, attachment_map=attachment_map, stats=stats, q=q, status=status, priority=priority, assigned=assigned, tag=tag, attachment_q=attachment_q, attachment_results=attachment_results, support_profiles=support_profiles, support_quick_replies=_nc_support_reply_library(), selected_reply_macros=selected_reply_macros, selected_sla=_nc_support_sla_payload(selected) if selected else None, sla_map={int(t.id): _nc_support_sla_payload(t) for t in tickets}, support_role_label=_nc_support_role_label, current_support_role=_nc_support_role_for_user(int(current_user.id)), avg_rating=avg_rating, tag_list=_nc_support_tags_list, support_notifications=support_notifications, support_inbox=_nc_support_inbox_payload(int(current_user.id)), selected_events=selected_events, queue=queue)


    @app.route('/api/admin/support/tickets/<int:ticket_id>/assign', methods=['POST'])
    @login_required
    def api_admin_support_assign(ticket_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        ticket = SupportTicket.query.filter_by(id=int(ticket_id)).first()
        if not ticket:
            return jsonify(ok=False, error='not_found'), 404
        data = request.get_json(silent=True) or request.form or {}
        mode = (data.get('mode') or 'me').strip().lower()
        try:
            if mode == 'clear':
                ticket.assigned_to = None
            else:
                ticket.assigned_to = int(current_user.id)
            if str(getattr(ticket, 'status', 'open')).lower() == 'open' and ticket.assigned_to:
                ticket.status = 'pending'
            _nc_support_touch_ticket(ticket, status=ticket.status)
            if ticket.assigned_to == int(current_user.id):
                SupportTicketMention.query.filter_by(ticket_id=int(ticket.id), target_user_id=int(current_user.id), is_read=False).update({'is_read': True, 'read_at': datetime.utcnow()})
            _nc_support_log_event(int(ticket.id), 'assigned', actor_user_id=int(current_user.id), event_value=(str(ticket.assigned_to) if ticket.assigned_to else 'unassigned'))
            db.session.commit()
            _nc_support_emit_refresh(reason='assigned', ticket_id=int(ticket.id), target_user_ids=[int(current_user.id), int(getattr(ticket, 'assigned_to', 0) or 0), int(getattr(ticket, 'user_id', 0) or 0)])
            return jsonify(ok=True)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/tickets/<int:ticket_id>/reply', methods=['POST'])
    @login_required
    def api_admin_support_reply(ticket_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        ticket = SupportTicket.query.filter_by(id=int(ticket_id)).first()
        if not ticket:
            return jsonify(ok=False, error='not_found'), 404
        data = request.get_json(silent=True) or request.form or {}
        body = (data.get('body') or '').strip()[:4000]
        is_internal = bool(data.get('is_internal'))
        if not body:
            return jsonify(ok=False, error='empty_body'), 400
        try:
            msg = SupportTicketMessage(ticket_id=int(ticket.id), author_user_id=int(current_user.id), body=body, is_staff=True, is_internal=is_internal)
            db.session.add(msg)
            db.session.flush()
            saved_files = _nc_support_save_attachments(request.files.getlist('files') if request.files else [], int(ticket.id), int(msg.id))
            if is_internal:
                _nc_support_store_mentions(int(ticket.id), int(msg.id), body, actor_user_id=int(current_user.id))
            SupportTicketMention.query.filter_by(ticket_id=int(ticket.id), target_user_id=int(current_user.id), is_read=False).update({'is_read': True, 'read_at': datetime.utcnow()})
            _nc_support_touch_ticket(ticket, status=('pending' if ticket.status != 'closed' else 'closed'), actor='staff', is_internal=is_internal)
            if not ticket.assigned_to:
                ticket.assigned_to = int(current_user.id)
            _nc_support_log_event(int(ticket.id), 'internal_note' if is_internal else 'staff_reply', actor_user_id=int(current_user.id), body=body[:500], meta={'attachments': len(saved_files or [])})
            db.session.commit()
            _nc_support_emit_refresh(reason='staff_reply' if not is_internal else 'internal_note', ticket_id=int(ticket.id), target_user_ids=[int(current_user.id), int(getattr(ticket, 'assigned_to', 0) or 0), int(getattr(ticket, 'user_id', 0) or 0)])
            return jsonify(ok=True)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/tickets/<int:ticket_id>/status', methods=['POST'])
    @login_required
    def api_admin_support_status(ticket_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        ticket = SupportTicket.query.filter_by(id=int(ticket_id)).first()
        if not ticket:
            return jsonify(ok=False, error='not_found'), 404
        data = request.get_json(silent=True) or request.form or {}
        status = (data.get('status') or '').strip().lower()
        if status not in ('open', 'pending', 'closed'):
            return jsonify(ok=False, error='bad_status'), 400
        try:
            _nc_support_touch_ticket(ticket, status=status)
            _nc_support_log_event(int(ticket.id), 'status_changed', actor_user_id=int(current_user.id), event_value=status)
            db.session.commit()
            _nc_support_emit_refresh(reason='status_changed', ticket_id=int(ticket.id), target_user_ids=[int(current_user.id), int(getattr(ticket, 'assigned_to', 0) or 0), int(getattr(ticket, 'user_id', 0) or 0)])
            return jsonify(ok=True)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500



    @app.route('/api/admin/support/tickets/<int:ticket_id>/priority', methods=['POST'])
    @login_required
    def api_admin_support_priority(ticket_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        ticket = SupportTicket.query.filter_by(id=int(ticket_id)).first()
        if not ticket:
            return jsonify(ok=False, error='not_found'), 404
        data = request.get_json(silent=True) or request.form or {}
        priority = (data.get('priority') or '').strip().lower()
        if priority not in ('low', 'normal', 'high', 'urgent'):
            return jsonify(ok=False, error='bad_priority'), 400
        try:
            ticket.priority = priority
            _nc_support_refresh_sla(ticket)
            ticket.updated_at = datetime.utcnow()
            _nc_support_log_event(int(ticket.id), 'priority_changed', actor_user_id=int(current_user.id), event_value=priority)
            db.session.commit()
            _nc_support_emit_refresh(reason='priority_changed', ticket_id=int(ticket.id), target_user_ids=[int(current_user.id), int(getattr(ticket, 'assigned_to', 0) or 0), int(getattr(ticket, 'user_id', 0) or 0)])
            return jsonify(ok=True, priority=priority)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/queue', methods=['GET'])
    @login_required
    def api_admin_support_queue():
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        q = (request.args.get('q') or '').strip()
        status = (request.args.get('status') or '').strip().lower()
        priority = (request.args.get('priority') or '').strip().lower()
        assigned = (request.args.get('assigned') or '').strip().lower()
        tag = (request.args.get('tag') or '').strip()
        queue = (request.args.get('queue') or '').strip().lower()
        try:
            ticket_id = int(request.args.get('ticket') or 0)
        except Exception:
            ticket_id = 0
        query = SupportTicket.query
        if status in ('open', 'pending', 'closed'):
            query = query.filter(SupportTicket.status == status)
        if priority in ('low', 'normal', 'high', 'urgent'):
            query = query.filter(SupportTicket.priority == priority)
        if assigned == 'me':
            query = query.filter(SupportTicket.assigned_to == int(current_user.id))
        elif assigned == 'unassigned':
            query = query.filter(SupportTicket.assigned_to.is_(None))
        elif assigned == 'any':
            query = query.filter(SupportTicket.assigned_to.is_not(None))
        if queue == 'mine':
            query = query.filter(SupportTicket.assigned_to == int(current_user.id))
        elif queue == 'unassigned':
            query = query.filter(SupportTicket.assigned_to.is_(None))
        elif queue == 'overdue':
            query = query.filter(SupportTicket.status != 'closed', SupportTicket.waiting_for == 'staff', SupportTicket.next_reply_due_at.is_not(None), SupportTicket.next_reply_due_at < datetime.utcnow())
        if q:
            like = f"%{q}%"
            user_ids = [int(r[0]) for r in db.session.query(User.id).filter(or_(User.username.ilike(like), User.display_name.ilike(like), User.email.ilike(like))).all()]
            conds = [SupportTicket.subject.ilike(like), SupportTicket.tags_csv.ilike(like)]
            if q.isdigit():
                conds += [SupportTicket.id == int(q), SupportTicket.user_id == int(q), SupportTicket.guild_id == int(q)]
            if user_ids:
                conds += [SupportTicket.user_id.in_(user_ids), SupportTicket.assigned_to.in_(user_ids)]
            query = query.filter(or_(*conds))
        if tag:
            query = query.filter(SupportTicket.tags_csv.ilike(f"%{tag}%"))
        tickets = query.order_by(case((SupportTicket.status == 'open', 0), (SupportTicket.status == 'pending', 1), else_=2), SupportTicket.last_message_at.desc()).limit(200).all()
        user_ids = sorted({int(getattr(t, 'user_id', 0) or 0) for t in tickets if getattr(t, 'user_id', None)} | {int(getattr(t, 'assigned_to', 0) or 0) for t in tickets if getattr(t, 'assigned_to', None)})
        users = {int(u.id): u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
        payload = []
        for t in tickets:
            item = _nc_support_ticket_payload(t, users)
            assignee_role = _nc_support_role_for_user(int(getattr(t, 'assigned_to', 0) or 0)) if getattr(t, 'assigned_to', None) else ''
            item['assigned_role_label'] = _nc_support_role_label(assignee_role) if assignee_role else ''
            item['sla'] = _nc_support_sla_payload(t)
            payload.append(item)
        selected_id = ticket_id if any(int(getattr(t, 'id', 0) or 0) == ticket_id for t in tickets) else (int(getattr(tickets[0], 'id', 0) or 0) if tickets else 0)
        return jsonify(ok=True, tickets=payload, selected_id=selected_id)


    @app.route('/api/admin/support/tickets/<int:ticket_id>/view', methods=['GET'])
    @login_required
    def api_admin_support_ticket_view(ticket_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        ticket = SupportTicket.query.filter_by(id=int(ticket_id)).first()
        if not ticket:
            return jsonify(ok=False, error='not_found'), 404
        messages = SupportTicketMessage.query.filter_by(ticket_id=int(ticket.id)).order_by(SupportTicketMessage.created_at.asc(), SupportTicketMessage.id.asc()).all()
        events = SupportTicketEvent.query.filter_by(ticket_id=int(ticket.id)).order_by(SupportTicketEvent.created_at.desc(), SupportTicketEvent.id.desc()).limit(60).all()
        user_ids = {int(getattr(ticket, 'user_id', 0) or 0)}
        if getattr(ticket, 'assigned_to', None):
            user_ids.add(int(ticket.assigned_to))
        user_ids |= {int(getattr(m, 'author_user_id', 0) or 0) for m in messages if getattr(m, 'author_user_id', None)}
        user_ids |= {int(getattr(e, 'actor_user_id', 0) or 0) for e in events if getattr(e, 'actor_user_id', None)}
        users = {int(u.id): u for u in User.query.filter(User.id.in_(sorted(user_ids))).all()} if user_ids else {}
        msg_ids = [int(m.id) for m in messages]
        attachment_map = {}
        if msg_ids:
            for a in SupportTicketAttachment.query.filter(SupportTicketAttachment.message_id.in_(msg_ids)).order_by(SupportTicketAttachment.id.asc()).all():
                attachment_map.setdefault(int(a.message_id), []).append({
                    'id': int(getattr(a, 'id', 0) or 0),
                    'file_url': getattr(a, 'file_url', '') or '',
                    'file_name': getattr(a, 'file_name', '') or '',
                    'is_image': bool(getattr(a, 'is_image', False)),
                    'mime_type': getattr(a, 'mime_type', '') or '',
                })
        ticket_payload = _nc_support_ticket_payload(ticket, users)
        assignee_role = _nc_support_role_for_user(int(getattr(ticket, 'assigned_to', 0) or 0)) if getattr(ticket, 'assigned_to', None) else ''
        ticket_payload['assigned_role_label'] = _nc_support_role_label(assignee_role) if assignee_role else ''
        message_payload = []
        for m in messages:
            row = _nc_support_message_payload(m, users)
            row['attachments'] = attachment_map.get(int(getattr(m, 'id', 0) or 0), [])
            message_payload.append(row)
        event_payload = [{
            'id': int(getattr(e, 'id', 0) or 0),
            'event_type': getattr(e, 'event_type', '') or '',
            'event_value': getattr(e, 'event_value', '') or '',
            'body': getattr(e, 'body', '') or '',
            'actor_user_id': int(getattr(e, 'actor_user_id', 0) or 0) or None,
            'actor_username': (getattr(users.get(int(getattr(e, 'actor_user_id', 0) or 0)), 'username', None) if getattr(e, 'actor_user_id', None) else None) or '',
            'created_at': _nc_dt_iso(getattr(e, 'created_at', None)),
        } for e in events]
        try:
            SupportTicketMention.query.filter_by(ticket_id=int(ticket.id), target_user_id=int(current_user.id), is_read=False).update({'is_read': True, 'read_at': datetime.utcnow()})
            db.session.commit()
        except Exception:
            try: db.session.rollback()
            except Exception: pass
        return jsonify(ok=True, ticket=ticket_payload, messages=message_payload, events=event_payload, visible_replies=_nc_support_visible_replies(ticket), sla=_nc_support_sla_payload(ticket), profile_url=url_for('admin_support_ticket_profile', ticket_id=int(ticket.id)))



    @app.route('/admin/support/inbox', methods=['GET'])
    @login_required
    def admin_support_inbox():
        if not _nc_auth_is_admin_auditor('support'):
            return redirect(url_for('chat'))
        focus = (request.args.get('focus') or '').strip().lower()
        inbox = _nc_support_inbox_payload(int(current_user.id))
        ticket_ids = sorted({int(x['id']) for x in inbox.get('assigned_waiting', []) if x.get('id')} | {int(x['id']) for x in inbox.get('unassigned_hot', []) if x.get('id')} | {int(x['id']) for x in inbox.get('overdue', []) if x.get('id')} | {int(x['ticket_id']) for x in inbox.get('mentions', []) if x.get('ticket_id')})
        tickets = {int(t.id): t for t in SupportTicket.query.filter(SupportTicket.id.in_(ticket_ids)).all()} if ticket_ids else {}
        user_ids = sorted({int(getattr(t, 'user_id', 0) or 0) for t in tickets.values()} | {int(getattr(t, 'assigned_to', 0) or 0) for t in tickets.values() if getattr(t, 'assigned_to', None)} | {int(x.get('from_user_id') or 0) for x in inbox.get('mentions', []) if x.get('from_user_id')})
        users = {int(u.id): u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
        return render_template('admin_support_inbox.html', inbox=inbox, ticket_map=tickets, user_map=users, support_role_label=_nc_support_role_label, current_support_role=_nc_support_role_for_user(int(current_user.id)), focus=focus)


    @app.route('/api/admin/support/inbox', methods=['GET'])
    @login_required
    def api_admin_support_inbox():
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        return jsonify(ok=True, inbox=_nc_support_inbox_payload(int(current_user.id)), notifications=_nc_support_notifications_for_user(int(current_user.id)))


    @app.route('/api/admin/support/mentions/<int:mention_id>/read', methods=['POST'])
    @login_required
    def api_admin_support_mark_mention_read(mention_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        mention = SupportTicketMention.query.filter_by(id=int(mention_id), target_user_id=int(current_user.id)).first()
        if not mention:
            return jsonify(ok=False, error='not_found'), 404
        try:
            mention.is_read = True
            mention.read_at = datetime.utcnow()
            db.session.commit()
            _nc_support_emit_refresh(reason='mention_read', ticket_id=int(getattr(mention, 'ticket_id', 0) or 0), target_user_ids=[int(current_user.id)])
            return jsonify(ok=True)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/admin/support/tickets/<int:ticket_id>', methods=['GET'])
    @login_required
    def admin_support_ticket_profile(ticket_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return redirect(url_for('chat'))
        ticket = SupportTicket.query.filter_by(id=int(ticket_id)).first()
        if not ticket:
            return redirect(url_for('admin_support'))
        messages = SupportTicketMessage.query.filter_by(ticket_id=int(ticket.id)).order_by(SupportTicketMessage.created_at.asc(), SupportTicketMessage.id.asc()).all()
        events = SupportTicketEvent.query.filter_by(ticket_id=int(ticket.id)).order_by(SupportTicketEvent.created_at.desc(), SupportTicketEvent.id.desc()).limit(200).all()
        user_ids = {int(ticket.user_id)}
        if ticket.assigned_to:
            user_ids.add(int(ticket.assigned_to))
        user_ids |= {int(m.author_user_id) for m in messages if m.author_user_id}
        user_ids |= {int(e.actor_user_id) for e in events if e.actor_user_id}
        users = {u.id: u for u in User.query.filter(User.id.in_(sorted(user_ids))).all()} if user_ids else {}
        msg_ids = [int(m.id) for m in messages]
        attachment_map = {}
        if msg_ids:
            for a in SupportTicketAttachment.query.filter(SupportTicketAttachment.message_id.in_(msg_ids)).order_by(SupportTicketAttachment.id.asc()).all():
                attachment_map.setdefault(int(a.message_id), []).append(a)
        return render_template('admin_support_ticket.html', ticket=ticket, messages=messages, events=events, user_map=users, attachment_map=attachment_map, support_role_label=_nc_support_role_label, current_support_role=_nc_support_role_for_user(int(current_user.id)), selected_sla=_nc_support_sla_payload(ticket), tag_list=_nc_support_tags_list)


    @app.route('/help', methods=['GET'])
    def support_landing_page():
        support_stats = _nc_get_support_stats()
        avg_rating = None
        try:
            rating_rows = db.session.query(func.avg(SupportTicket.satisfaction_rating), func.count(SupportTicket.id)).filter(SupportTicket.satisfaction_rating.is_not(None)).first()
            if rating_rows and rating_rows[0] is not None:
                avg_rating = {'value': round(float(rating_rows[0]), 2), 'count': int(rating_rows[1] or 0)}
        except Exception:
            avg_rating = None
        return render_template('support_landing.html', support_stats=support_stats, avg_rating=avg_rating)


    @app.route('/api/support/tickets/<int:ticket_id>/rate', methods=['POST'])
    @login_required
    def api_support_rate(ticket_id: int):
        ticket = SupportTicket.query.filter_by(id=int(ticket_id), user_id=int(current_user.id)).first()
        if not ticket:
            return jsonify(ok=False, error='not_found'), 404
        if str(getattr(ticket, 'status', 'open')).lower() != 'closed':
            return jsonify(ok=False, error='ticket_not_closed'), 400
        data = request.get_json(silent=True) or request.form or {}
        try:
            rating = int(data.get('rating') or 0)
        except Exception:
            rating = 0
        comment = (data.get('comment') or '').strip()[:1000]
        if rating < 1 or rating > 5:
            return jsonify(ok=False, error='bad_rating'), 400
        try:
            ticket.satisfaction_rating = rating
            ticket.satisfaction_comment = comment or None
            ticket.rated_at = datetime.utcnow()
            row = SupportTicketFeedback.query.filter_by(ticket_id=int(ticket.id)).first()
            if row is None:
                row = SupportTicketFeedback(ticket_id=int(ticket.id), user_id=int(current_user.id), rating=rating, comment=comment or None)
                db.session.add(row)
            else:
                row.rating = rating
                row.comment = comment or None
                row.updated_at = datetime.utcnow()
            _nc_support_log_event(int(ticket.id), 'feedback_left', actor_user_id=int(current_user.id), event_value=str(rating), body=comment[:500] if comment else None)
            db.session.commit()
            return jsonify(ok=True)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/tickets/<int:ticket_id>/tags', methods=['POST'])
    @login_required
    def api_admin_support_tags(ticket_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        ticket = SupportTicket.query.filter_by(id=int(ticket_id)).first()
        if not ticket:
            return jsonify(ok=False, error='not_found'), 404
        data = request.get_json(silent=True) or request.form or {}
        tags_csv = _nc_support_tags_csv_from_value(data.get('tags') or '')
        try:
            ticket.tags_csv = tags_csv
            ticket.updated_at = datetime.utcnow()
            _nc_support_log_event(int(ticket.id), 'tags_changed', actor_user_id=int(current_user.id), event_value=tags_csv[:255])
            db.session.commit()
            return jsonify(ok=True, tags=_nc_support_tags_list(ticket))
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/saved-replies', methods=['POST'])
    @login_required
    def api_admin_support_saved_replies_create():
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or request.form or {}
        title = (data.get('title') or '').strip()[:120]
        body = (data.get('body') or '').strip()[:4000]
        scope = (data.get('scope') or 'support').strip().lower()[:16]
        try:
            sort_order = int(data.get('sort_order') or 0)
        except Exception:
            sort_order = 0
        if not title or not body:
            return jsonify(ok=False, error='title_or_body_required'), 400
        try:
            row = SupportSavedReply(title=title, body=body, scope=scope or 'support', sort_order=sort_order, created_by=int(current_user.id), updated_by=int(current_user.id))
            db.session.add(row)
            db.session.commit()
            return jsonify(ok=True, id=int(row.id))
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/saved-replies/<int:reply_id>', methods=['POST'])
    @login_required
    def api_admin_support_saved_replies_update(reply_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        row = SupportSavedReply.query.filter_by(id=int(reply_id)).first()
        if not row:
            return jsonify(ok=False, error='not_found'), 404
        data = request.get_json(silent=True) or request.form or {}
        title = (data.get('title') or row.title or '').strip()[:120]
        body = (data.get('body') or row.body or '').strip()[:4000]
        scope = (data.get('scope') or row.scope or 'support').strip().lower()[:16]
        try:
            sort_order = int(data.get('sort_order') if data.get('sort_order') is not None else row.sort_order or 0)
        except Exception:
            sort_order = int(row.sort_order or 0)
        try:
            row.title = title
            row.body = body
            row.scope = scope
            row.sort_order = sort_order
            row.updated_by = int(current_user.id)
            row.updated_at = datetime.utcnow()
            db.session.commit()
            return jsonify(ok=True)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/saved-replies/<int:reply_id>/delete', methods=['POST'])
    @login_required
    def api_admin_support_saved_replies_delete(reply_id: int):
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        row = SupportSavedReply.query.filter_by(id=int(reply_id)).first()
        if not row:
            return jsonify(ok=False, error='not_found'), 404
        try:
            db.session.delete(row)
            db.session.commit()
            return jsonify(ok=True)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/staff-profile', methods=['POST'])
    @login_required
    def api_admin_support_staff_profile():
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        try:
            user_id = int(data.get('user_id') or 0)
        except Exception:
            user_id = 0
        if user_id <= 0:
            return jsonify(ok=False, error='bad_user_id'), 400
        role_level = (data.get('role_level') or 'support').strip().lower()
        if role_level not in SUPPORT_ROLE_LEVELS:
            role_level = 'support'
        categories_csv = ', '.join(_nc_support_csv_tokens(data.get('categories_csv') or ''))[:255]
        skills_csv = ', '.join(_nc_support_csv_tokens(data.get('skills_csv') or ''))[:255]
        try:
            max_active = max(0, min(int(data.get('max_active') or 0), 500))
        except Exception:
            max_active = 0
        note = (data.get('note') or '').strip()[:255] or None
        row = SupportStaffProfile.query.filter_by(user_id=user_id).first()
        try:
            if row is None:
                row = SupportStaffProfile(user_id=user_id, role_level=role_level, updated_by=int(current_user.id))
                db.session.add(row)
            row.role_level = role_level
            row.categories_csv = categories_csv
            row.skills_csv = skills_csv
            row.max_active = max_active
            row.note = note
            row.updated_by = int(current_user.id)
            db.session.commit()
            return jsonify(ok=True, user_id=user_id, role_level=role_level, categories_csv=categories_csv, skills_csv=skills_csv, max_active=max_active)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/sla-rules', methods=['POST'])
    @login_required
    def api_admin_support_sla_rules():
        if not _nc_auth_is_admin_auditor('support'):
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or {}
        try:
            rule_id = int(data.get('id') or 0)
        except Exception:
            rule_id = 0
        category = ((data.get('category') or '*').strip().lower() or '*')[:32]
        priority = ((data.get('priority') or '*').strip().lower() or '*')[:16]
        if priority not in ('*', 'low', 'normal', 'high', 'urgent'):
            priority = '*'
        if category not in ('*', 'billing', 'security', 'technical', 'voice', 'media', 'performance', 'ui', 'accounts', 'mobile', 'other'):
            category = '*'
        try:
            first_reply_minutes = max(5, min(int(data.get('first_reply_minutes') or 240), 10080))
            next_reply_minutes = max(5, min(int(data.get('next_reply_minutes') or 720), 10080))
            escalate_after_minutes = max(5, min(int(data.get('escalate_after_minutes') or 30), 10080))
        except Exception:
            return jsonify(ok=False, error='bad_minutes'), 400
        required_role = (data.get('required_role') or 'support').strip().lower()
        if required_role not in SUPPORT_ROLE_LEVELS:
            required_role = 'support'
        is_enabled = bool(data.get('is_enabled', True))
        note = (data.get('note') or '').strip()[:255] or None
        row = SupportSlaRule.query.filter_by(id=rule_id).first() if rule_id > 0 else None
        try:
            if row is None:
                row = SupportSlaRule(category=category, priority=priority)
                db.session.add(row)
            row.category = category
            row.priority = priority
            row.first_reply_minutes = first_reply_minutes
            row.next_reply_minutes = next_reply_minutes
            row.escalate_after_minutes = escalate_after_minutes
            row.required_role = required_role
            row.is_enabled = is_enabled
            row.note = note
            row.updated_by = int(current_user.id)
            db.session.commit()
            return jsonify(ok=True, id=int(row.id))
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500


    @app.route('/api/admin/support/staff-role', methods=['POST'])
    @login_required
    def api_admin_support_staff_role():
        if not _nc_support_can_manage_team():
            return jsonify(ok=False, error='forbidden'), 403
        data = request.get_json(silent=True) or request.form or {}
        try:
            user_id = int(data.get('user_id') or 0)
        except Exception:
            user_id = 0
        role_level = (data.get('role_level') or 'support').strip().lower()
        if role_level not in SUPPORT_ROLE_LEVELS:
            return jsonify(ok=False, error='bad_role'), 400
        user = User.query.filter_by(id=user_id).first()
        if not user:
            return jsonify(ok=False, error='not_found'), 404
        if 'support' not in _nc_admin_permissions_for(user_id) and user_id != 1:
            return jsonify(ok=False, error='user_has_no_support_permission'), 400
        try:
            row = SupportStaffProfile.query.filter_by(user_id=user_id).first()
            if row is None:
                row = SupportStaffProfile(user_id=user_id, role_level=role_level, updated_by=int(current_user.id))
                db.session.add(row)
            else:
                row.role_level = role_level
                row.updated_by = int(current_user.id)
            _nc_admin_record_user_action(int(user_id), 'support_role', reason=role_level, is_active=False)
            db.session.commit()
            return jsonify(ok=True, role_level=role_level)
        except Exception:
            try: db.session.rollback()
            except Exception: pass
            return jsonify(ok=False, error='db_error'), 500

    @app.route("/api/admin/security/unblock", methods=["POST"])
    @login_required
    def api_admin_security_unblock():
        if not _nc_auth_is_admin_auditor('security'):
            return jsonify(ok=False, error="forbidden"), 403
        data = request.get_json(silent=True) or {}
        block_id = data.get('block_id')
        try:
            block_id = int(block_id)
        except Exception:
            return jsonify(ok=False, error="bad_request"), 400
        row = None
        try:
            row = AuthSecurityBlock.query.filter_by(id=block_id).first()
        except Exception:
            row = None
        if not row:
            return jsonify(ok=False, error="not_found"), 404
        try:
            row.active = False
            if getattr(row, 'expires_at', None) and row.expires_at > datetime.utcnow():
                row.expires_at = datetime.utcnow()
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error="db_error"), 500
        return jsonify(ok=True)

    @app.route("/api/auth/sessions", methods=["GET"])
    @login_required
    def api_auth_sessions_list():
        return api_auth_audit()

    @app.route("/api/auth/sessions/revoke", methods=["POST"])
    @login_required
    def api_auth_sessions_revoke():
        data = request.get_json(silent=True) or {}
        sid = data.get("session_id")
        try:
            sid = int(sid)
        except Exception:
            return jsonify(ok=False, error="bad_request"), 400

        uid = int(current_user.id)
        rec = None
        try:
            rec = AuthSession.query.filter_by(id=sid, user_id=uid).first()
        except Exception:
            rec = None
        if not rec:
            return jsonify(ok=False, error="not_found"), 404

        is_current = False
        try:
            tok = request.cookies.get(AUTH_SESSION_COOKIE)
            if tok and rec.token_hash == _nc_hash_session_token(tok):
                is_current = True
        except Exception:
            pass

        try:
            db.session.delete(rec)
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            return jsonify(ok=False, error="db_error"), 500

        if is_current:
            try:
                logout_user()
            except Exception:
                pass
            try:
                session.clear()
            except Exception:
                pass
            resp = jsonify(ok=True, logged_out=True)
            try:
                resp.delete_cookie(AUTH_SESSION_COOKIE)
            except Exception:
                pass
            return resp

        return jsonify(ok=True)
@app.route("/api/auth/sessions/revoke_all", methods=["POST"])
@login_required
def api_auth_sessions_revoke_all():
    uid = int(current_user.id)
    try:
        AuthSession.query.filter_by(user_id=uid).delete()
        db.session.commit()
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass
        return jsonify(ok=False, error="db_error"), 500

    try:
        logout_user()
    except Exception:
        pass
    try:
        session.clear()
    except Exception:
        pass

    resp = jsonify(ok=True, logged_out=True)
    try:
        resp.delete_cookie(AUTH_SESSION_COOKIE)
    except Exception:
        pass
    return resp

# --- media (protected + fallbacks) ---

def _send_static_fallback(rel_path: str, mimetype: str | None = None):
    """Send a bundled static asset as a safe fallback (no 404 spam in UI)."""
    try:
        fp = os.path.join(app.static_folder, rel_path)
        if os.path.isfile(fp):
            return send_file(fp, mimetype=mimetype, conditional=True)
    except Exception:
        pass
    abort(404)

@app.route("/favicon.ico")
def favicon():
    # Browser default favicon request
    return _send_static_fallback("favicon.ico")

@app.route("/static/avatars/<path:filename>")
def static_avatar_with_fallback(filename: str):
    """Serve avatars with a default placeholder when the file is missing.

    This eliminates noisy 404s when the DB points to an avatar that was deleted.
    """
    try:
        avatar_dir = os.path.join(app.static_folder, "avatars")
        fp = os.path.normpath(os.path.join(avatar_dir, filename))
        # Prevent path traversal
        if not fp.startswith(os.path.normpath(avatar_dir) + os.sep):
            abort(404)
        if os.path.isfile(fp):
            return send_file(fp, conditional=True)
    except Exception:
        pass
    return _send_static_fallback("avatars/default.png")

# --- v10: protected media (private group icons) ---
@app.route("/media/channels/<int:channel_id>/icon")
@login_required
def media_channel_icon(channel_id: int):
    ch0 = db.session.get(Channel, int(channel_id))
    ch, mem = _require_membership(int(channel_id), int(current_user.id))
    # Do not leak existence of groups to non-members.
    if (not ch0) or bool(getattr(ch0, 'is_dm', False)) or (not mem):
        abort(404)

    root_id = _root_id_for_channel(ch0)
    root = db.session.get(Channel, int(root_id)) if root_id else ch0
    fn = (getattr(root, 'icon_path', '') or '').strip()

    folder = app.config.get('CHANNEL_ICONS_FOLDER') or os.path.join(BASE_DIR, 'private_uploads', 'channel_icons')
    fp = os.path.join(folder, fn) if fn else ""

    # If icon is not set or the file is missing, return a bundled placeholder.
    if (not fn) or (not fp) or (not os.path.isfile(fp)):
        return _send_static_fallback("img/channel_default.png")

    return send_file(fp, conditional=True)

@app.route("/app")
@login_required
def chat():
    # v32: auto-assign preset avatar if missing/legacy default
    try:
        av = (getattr(current_user, 'avatar_url', None) or '').strip()
        # If missing or legacy placeholder, assign a random bundled preset.
        # NOTE: brand.png is now used as a valid preset/default avatar, so do not treat it as legacy.
        if (not av) or av.endswith('/avatars/default.png'):
            current_user.avatar_url = _pick_preset_avatar_url()
            db.session.commit()
    except Exception:
        try: db.session.rollback()
        except Exception: pass

    # Channels (servers): only root guilds where user is a member.
    # Older DBs might have legacy guild roots with guild_id=NULL; fix them lazily so
    # orphan subchannels don't show up as "servers" in the rail.
    try:
        legacy = Channel.query.filter(Channel.is_dm == False).filter(Channel.guild_id.is_(None)).all()
        if legacy:
            legacy_ids = [int(c.id) for c in legacy]
            rootish = set()
            try:
                rootish |= {int(gid) for (gid,) in db.session.query(ChannelCategory.guild_id).filter(ChannelCategory.guild_id.in_(legacy_ids)).all()}
            except Exception:
                pass
            try:
                rootish |= {int(gid) for (gid,) in db.session.query(Channel.guild_id).filter(Channel.guild_id.in_(legacy_ids)).all()}
            except Exception:
                pass
            if rootish:
                for cid in rootish:
                    ch0 = db.session.get(Channel, int(cid))
                    if ch0 and getattr(ch0, 'guild_id', None) is None:
                        try:
                            ch0.guild_id = ch0.id
                        except Exception:
                            pass
                db.session.commit()
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass

    rows = (
        db.session.query(Channel, ChannelMember)
        .join(ChannelMember, ChannelMember.channel_id == Channel.id)
        .filter(Channel.is_dm == False)
        .filter(Channel.guild_id == Channel.id)
        .filter(ChannelMember.user_id == current_user.id)
        .order_by(Channel.created_at.asc())
        .all()
    )
    channels = []
    for ch, mem in rows:
        channels.append({
            'id': ch.id,
            'name': ch.name,
            'type': (getattr(ch, 'channel_type', None) or 'text'),
            'topic': (getattr(ch, 'topic', None) or ''),
            'is_private': bool(getattr(ch, 'is_private', True)),
            'my_role': (getattr(mem, 'role', None) or 'member'),
            'icon_url': _channel_icon_url(ch),
        })
    # friend list = accepted friend requests partners
    friend_ids = set()
    for fr in FriendRequest.query.filter_by(
        status="accepted"
    ).filter(
        (FriendRequest.from_id == current_user.id)
        | (FriendRequest.to_id == current_user.id)
    ):
        if fr.from_id == current_user.id:
            friend_ids.add(fr.to_id)
        else:
            friend_ids.add(fr.from_id)
    friends = User.query.filter(User.id.in_(friend_ids)).all() if friend_ids else []
    # DM list: all existing 1:1 DM channels for the user (even if not friends anymore)
    dm_peers = []
    try:
        dm_ch_rows = (
            db.session.query(Channel.id)
            .join(ChannelMember, ChannelMember.channel_id == Channel.id)
            .filter(Channel.is_dm == True)
            .filter(ChannelMember.user_id == current_user.id)
            .all()
        )
        dm_channel_ids = [int(r[0]) for r in dm_ch_rows] if dm_ch_rows else []
        if dm_channel_ids:
            peer_rows = (
                db.session.query(ChannelMember.channel_id, ChannelMember.user_id)
                .filter(ChannelMember.channel_id.in_(dm_channel_ids))
                .filter(ChannelMember.user_id != current_user.id)
                .all()
            )
            chan_to_peer = {}
            peer_ids = set()
            for cid, uid in peer_rows:
                cid_i = int(cid)
                uid_i = int(uid)
                if cid_i not in chan_to_peer:
                    chan_to_peer[cid_i] = uid_i
                    peer_ids.add(uid_i)
            users_by_id = {int(u.id): u for u in User.query.filter(User.id.in_(list(peer_ids))).all()} if peer_ids else {}
            # order by last message time (most recent first)
            last_map = {}
            try:
                last_rows = (
                    db.session.query(Message.channel_id, db.func.max(Message.created_at))
                    .filter(Message.channel_id.in_(dm_channel_ids))
                    .group_by(Message.channel_id)
                    .all()
                )
                for cid, last_at in last_rows:
                    last_map[int(cid)] = last_at
            except Exception:
                last_map = {}
            for cid, uid in chan_to_peer.items():
                u = users_by_id.get(int(uid))
                if u:
                    try:
                        setattr(u, "_dm_channel_id", int(cid))
                    except Exception:
                        pass
                    dm_peers.append(u)
            dm_peers.sort(key=lambda u: (last_map.get(int(getattr(u, "_dm_channel_id", 0)) or 0) or datetime.min), reverse=True)
    except Exception:
        dm_peers = []

            # Pending friend requests:
    # - incoming: requests sent TO me
    # - outgoing: requests I have sent
    pending_in_rows = (
        FriendRequest.query.filter_by(to_id=current_user.id, status="pending")
        .order_by(FriendRequest.created_at.desc())
        .all()
    )
    pending_out_rows = (
        FriendRequest.query.filter_by(from_id=current_user.id, status="pending")
        .order_by(FriendRequest.created_at.desc())
        .all()
    )

    # Enrich with user info for UI rendering.
    def _pack_fr(fr, other_user):
        return {
            "request_id": int(fr.id),
            "created_at": _iso_z(getattr(fr, "created_at", None)),
            "other_id": int(other_user.id) if other_user else int(fr.from_id if fr.to_id == current_user.id else fr.to_id),
            "other_username": (getattr(other_user, "username", None) or f"#{fr.from_id if fr.to_id == current_user.id else fr.to_id}"),
            "other_avatar": (getattr(other_user, "avatar_url", None) or ""),
            "other_online": bool(getattr(other_user, "is_online", False)) if other_user else False,
            "other_last_seen": _iso_z(getattr(other_user, "last_seen", None)) if other_user else None,
        }

    pending_in_payload = []
    if pending_in_rows:
        from_ids = list({int(fr.from_id) for fr in pending_in_rows})
        users = {int(u.id): u for u in User.query.filter(User.id.in_(from_ids)).all()} if from_ids else {}
        for fr in pending_in_rows:
            pending_in_payload.append(_pack_fr(fr, users.get(int(fr.from_id))))

    pending_out_payload = []
    if pending_out_rows:
        to_ids = list({int(fr.to_id) for fr in pending_out_rows})
        users = {int(u.id): u for u in User.query.filter(User.id.in_(to_ids)).all()} if to_ids else {}
        for fr in pending_out_rows:
            pending_out_payload.append(_pack_fr(fr, users.get(int(fr.to_id))))

    return render_template(
        "chat.html",
        channels=channels,
        friends=friends,
        dm_peers=dm_peers,
        pending_in=pending_in_payload,
        pending_out=pending_out_payload,
    )# --- API: messages / channels / friends / calls ---


@app.route("/api/channels", methods=["POST"])
@login_required
def api_create_channel():
    """Create a root guild (server).

    This endpoint creates the root server object (guild_id == id).
    Subchannels are created via POST /api/guilds/<guild_id>/channels.
    """
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    # Root server itself is a container; keep channel_type for backward compatibility.
    ch_type = (data.get("type") or "text").strip().lower()
    topic = (data.get("topic") or "").strip()

    if not name:
        return jsonify({"error": "Имя сервера пустое"}), 400
    if ch_type not in ("text", "voice"):
        ch_type = "text"
    if len(topic) > 140:
        topic = topic[:140]

    invite_code = uuid.uuid4().hex[:16]
    channel = Channel(
        name=name[:64],
        is_dm=False,
        channel_type=ch_type,
        topic=topic,
        created_by=current_user.id,
        is_private=True,
        invite_code=invite_code,
    )
    db.session.add(channel)
    db.session.flush()

    # v11: mark as root server
    try:
        channel.guild_id = channel.id
    except Exception:
        pass

    # creator becomes admin member on the root server
    db.session.add(ChannelMember(channel_id=channel.id, user_id=current_user.id, role='admin', joined_at=utcnow()))

    # Seed default categories + channels (Discord-like)
    default_text_id = None
    default_voice_id = None
    try:
        cat_text = ChannelCategory(
            guild_id=int(channel.id),
            name="Текстовые каналы",
            position=0,
            created_by=current_user.id,
            created_at=utcnow(),
        )
        cat_voice = ChannelCategory(
            guild_id=int(channel.id),
            name="Голосовые каналы",
            position=1,
            created_by=current_user.id,
            created_at=utcnow(),
        )
        db.session.add(cat_text)
        db.session.add(cat_voice)
        db.session.flush()

        ch_text = Channel(
            name="основной",
            is_dm=False,
            channel_type="text",
            topic="",
            created_by=current_user.id,
            is_private=True,
            invite_code="",
            guild_id=int(channel.id),
            category_id=int(cat_text.id),
            position=0,
            created_at=utcnow(),
        )
        ch_voice = Channel(
            name="Основной",
            is_dm=False,
            channel_type="voice",
            topic="",
            created_by=current_user.id,
            is_private=True,
            invite_code="",
            guild_id=int(channel.id),
            category_id=int(cat_voice.id),
            position=0,
            created_at=utcnow(),
        )
        db.session.add(ch_text)
        db.session.add(ch_voice)
        db.session.flush()
        default_text_id = int(ch_text.id)
        try:
            channel.invite_default_channel_id = int(default_text_id)
        except Exception:
            pass
        default_voice_id = int(ch_voice.id)
    except Exception as e:
        print(f"[guild-seed] failed: {e}")

    db.session.commit()
    return jsonify({
        "id": channel.id,
        "name": channel.name,
        "type": channel.channel_type,
        "topic": channel.topic,
        "is_private": True,
        "invite_code": invite_code,
        "my_role": 'admin',
        "icon_url": _channel_icon_url(channel),
        "default_text_channel_id": default_text_id,
        "default_voice_channel_id": default_voice_id,
    })


# --- v11: guild (server) channels ---

@app.route('/api/guilds/<int:guild_id>/channels', methods=['GET'])
@login_required
def api_guild_channels_list(guild_id: int):
    guild = db.session.get(Channel, int(guild_id))
    if (not guild) or bool(getattr(guild, 'is_dm', False)):
        return jsonify({'error': 'Сервер не найден'}), 404

    # normalize to root
    try:
        if int(getattr(guild, 'guild_id', guild.id) or guild.id) != int(guild.id):
            root_id = int(getattr(guild, 'guild_id', 0) or 0)
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                guild = root
    except Exception:
        pass

    _, mem = _require_membership(guild.id, int(current_user.id))
    if not mem:
        return jsonify({'error': 'Нет доступа'}), 403

    try:
        _cleanup_temporary_memberships(int(guild.id))
    except Exception:
        pass

    # Load categories (v14)
    categories = (
        ChannelCategory.query
        .filter(ChannelCategory.guild_id == int(guild.id))
        .order_by(ChannelCategory.position.asc(), ChannelCategory.created_at.asc())
        .all()
    )

    subchannels = (
        Channel.query
        .filter(Channel.is_dm == False)
        .filter(Channel.guild_id == int(guild.id))
        .filter(Channel.id != int(guild.id))
        .all()
    )

    # Serialize channels with category + ordering (+ effective permissions)
    # v14.22: show locked channels (Discord-like "show with lock") instead of hiding.
    ch_rows = []
    for ch in subchannels:
        perms = _effective_channel_perms(ch, mem)

        can_view = bool(perms.get('view'))
        # If you can't view it, still return it for UI (locked state), but unread is 0.
        unread = int(_unread_count(ch.id, current_user.id)) if can_view else 0

        ch_rows.append({
            'id': ch.id,
            'name': ch.name,
            'type': (getattr(ch, 'channel_type', None) or 'text'),
            'topic': (getattr(ch, 'topic', None) or ''),
            'unread': unread,
            'category_id': int(getattr(ch, 'category_id', 0) or 0) or None,
            'position': int(getattr(ch, 'position', 0) or 0),
            'created_at': _iso_z(getattr(ch, 'created_at', None)),
            'can_view': can_view,
            'can_send': bool(perms.get('send')),
            'can_connect': bool(perms.get('connect')),
            'can_speak': bool(perms.get('speak')),
        })

    # Group by category
    cat_map = {int(c.id): {'id': int(c.id), 'name': c.name, 'position': int(getattr(c, 'position', 0) or 0), 'channels': []} for c in categories}
    uncategorized = []
    for r in ch_rows:
        cid = r.get('category_id')
        if cid and int(cid) in cat_map:
            cat_map[int(cid)]['channels'].append(r)
        else:
            uncategorized.append(r)

    def _ch_sort_key(r):
        return (int(r.get('position') or 0), int(r.get('id') or 0))

    # Sort channels within each category
    for c in cat_map.values():
        c['channels'].sort(key=_ch_sort_key)

    # Sort categories
    cat_list = list(cat_map.values())
    cat_list.sort(key=lambda c: (int(c.get('position') or 0), int(c.get('id') or 0)))
    uncategorized.sort(key=_ch_sort_key)

    # Backward-compatible flat list (kept for older clients)
    flat = []
    for c in cat_list:
        flat.extend(c.get('channels') or [])
    flat.extend(uncategorized)

    # Voice roster (Discord-like: show users under voice channels)
    voice_roster = {}
    try:
        voice_ids = [int(r.get('id') or 0) for r in (flat or []) if str(r.get('type') or '').lower() == 'voice']
        voice_ids = [vid for vid in voice_ids if vid]
        if voice_ids:
            user_ids = set()
            for vid in voice_ids:
                try:
                    for uid in (group_calls.get(int(vid)) or set()):
                        try:
                            user_ids.add(int(uid))
                        except Exception:
                            pass
                except Exception:
                    pass

            users_by_id = {}
            if user_ids:
                try:
                    for u in User.query.filter(User.id.in_(list(user_ids))).all():
                        users_by_id[int(u.id)] = u
                except Exception:
                    users_by_id = {}

            for vid in voice_ids:
                ids = list(group_calls.get(int(vid)) or [])
                if not ids:
                    continue
                roster = []
                for uid in ids:
                    try:
                        uid = int(uid)
                    except Exception:
                        continue
                    u = users_by_id.get(uid)
                    if not u:
                        continue
                    st = {}
                    try:
                        st = (voice_states.get(int(vid)) or {}).get(int(uid)) or {}
                    except Exception:
                        st = {}
                    pub = _presence_public(u)
                    roster.append({
                        "id": u.id,
                        "username": u.username,
                        "avatar_url": u.avatar_url or "",
                        "is_online": bool(pub.get("online")),
                        "mode": pub.get("mode"),
                        "presence_text": pub.get("presence_text"),
                        "muted": bool(st.get("muted")),
                        "deafened": bool(st.get("deafened")),
                        "streaming": bool((group_screen_intents.get(int(vid)) or {}).get(int(uid))),
                    })
                if roster:
                    voice_roster[str(int(vid))] = roster
    except Exception:
        voice_roster = {}

    return jsonify({
        'guild': {
            'id': guild.id,
            'name': guild.name,
            'my_role': (getattr(mem, 'role', None) or 'member'),
            'can_admin': bool(_is_channel_admin(mem)),
            # v14.1: UI permissions helpers (Discord-like)
            'can_manage': bool(_is_channel_admin(mem)),
            'can_delete': bool(_is_channel_admin(mem)),
            'icon_url': _channel_icon_url(guild),
        },
        'categories': cat_list,
        'uncategorized': uncategorized,
        'channels': flat,
        'voice_roster': voice_roster,
    })


# FIX221: Members list for Discord-like "Участники" page
@app.route('/api/guilds/<int:guild_id>/members', methods=['GET'])
@login_required
def api_guild_members_list(guild_id: int):
    guild = db.session.get(Channel, int(guild_id))
    if (not guild) or bool(getattr(guild, 'is_dm', False)):
        return jsonify({'error': 'Сервер не найден'}), 404

    # normalize to root
    try:
        if int(getattr(guild, 'guild_id', guild.id) or guild.id) != int(guild.id):
            root_id = int(getattr(guild, 'guild_id', 0) or 0)
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                guild = root
    except Exception:
        pass

    _, mem = _require_membership(int(guild.id), int(current_user.id))
    if not mem:
        return jsonify({'error': 'Нет доступа'}), 403

    # only root guild members
    members = (
        ChannelMember.query
        .filter(ChannelMember.channel_id == int(guild.id))
        .order_by(ChannelMember.created_at.desc())
        .all()
    )

    user_ids = []
    for m in members:
        try:
            user_ids.append(int(m.user_id))
        except Exception:
            pass

    users_by_id = {}
    if user_ids:
        try:
            for u in User.query.filter(User.id.in_(list(set(user_ids)))).all():
                users_by_id[int(u.id)] = u
        except Exception:
            users_by_id = {}

    out = []
    for m in members:
        u = users_by_id.get(int(getattr(m, 'user_id', 0) or 0))
        if not u:
            continue
        pub = _presence_public(u)
        out.append({
            'id': int(u.id),
            'username': u.username,
            'avatar_url': u.avatar_url or "",
            'is_online': bool(pub.get('online')),
            'mode': pub.get('mode'),
            'presence_text': pub.get('presence_text'),
            'joined_at': _iso_z(getattr(m, 'created_at', None)),
            'created_at': _iso_z(getattr(u, 'created_at', None)),
            'role': (getattr(m, 'role', None) or 'member'),
        })

    return jsonify({
        'guild_id': int(guild.id),
        'members': out,
    })

@app.route('/api/guilds/<int:guild_id>/channels', methods=['POST'])
@login_required
def api_guild_channels_create(guild_id: int):
    guild = db.session.get(Channel, int(guild_id))
    if (not guild) or bool(getattr(guild, 'is_dm', False)):
        return jsonify({'error': 'Сервер не найден'}), 404

    # normalize to root
    try:
        if int(getattr(guild, 'guild_id', guild.id) or guild.id) != int(guild.id):
            root_id = int(getattr(guild, 'guild_id', 0) or 0)
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                guild = root
    except Exception:
        pass

    _, mem = _require_membership(guild.id, int(current_user.id))
    if not mem or not _is_channel_admin(mem):
        return jsonify({'error': 'Только админ может создавать каналы'}), 403

    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    ch_type = (data.get('type') or 'text').strip().lower()
    topic = (data.get('topic') or '').strip()
    category_id = data.get('category_id')
    if not name:
        return jsonify({'error': 'Имя канала пустое'}), 400
    if ch_type not in ('text', 'voice'):
        ch_type = 'text'
    if len(topic) > 140:
        topic = topic[:140]

    # Validate category belongs to this guild (optional)
    cat_id = None
    try:
        if category_id is not None and str(category_id).strip() != "":
            cand = int(category_id)
            if cand > 0:
                cat = db.session.get(ChannelCategory, cand)
                if cat and int(getattr(cat, 'guild_id', 0) or 0) == int(guild.id):
                    cat_id = int(cat.id)
    except Exception:
        cat_id = None

    # Position: append to the end within the same category
    pos = 0
    try:
        q = db.session.query(db.func.max(Channel.position)).filter(Channel.guild_id == int(guild.id)).filter(Channel.id != int(guild.id))
        if cat_id is None:
            q = q.filter((Channel.category_id == None) | (Channel.category_id == 0))
        else:
            q = q.filter(Channel.category_id == int(cat_id))
        mx = q.scalar()
        pos = int(mx or 0) + 1
    except Exception:
        pos = 0

    ch = Channel(
        name=name[:64],
        is_dm=False,
        channel_type=ch_type,
        topic=topic[:140],
        created_by=current_user.id,
        is_private=True,
        invite_code='',
        guild_id=int(guild.id),
        category_id=cat_id,
        position=pos,
    )
    db.session.add(ch)
    db.session.commit()

    return jsonify({
        'success': True,
        'channel': {
            'id': ch.id,
            'name': ch.name,
            'type': ch.channel_type,
            'topic': ch.topic,
            'unread': 0
        }
    })

# --- v14: categories inside guilds ---

@app.route('/api/guilds/<int:guild_id>/categories', methods=['POST'])
@login_required
def api_guild_category_create(guild_id: int):
    guild = db.session.get(Channel, int(guild_id))
    if (not guild) or bool(getattr(guild, 'is_dm', False)):
        return jsonify({'error': 'Сервер не найден'}), 404

    # normalize to root
    try:
        if int(getattr(guild, 'guild_id', guild.id) or guild.id) != int(guild.id):
            root_id = int(getattr(guild, 'guild_id', 0) or 0)
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                guild = root
    except Exception:
        pass

    _, mem = _require_membership(guild.id, int(current_user.id))
    if not mem or not _is_channel_admin(mem):
        return jsonify({'error': 'Только админ может создавать категории'}), 403

    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Имя категории пустое'}), 400
    name = name[:64]

    # append to the end
    pos = 0
    try:
        mx = db.session.query(db.func.max(ChannelCategory.position)).filter(ChannelCategory.guild_id == int(guild.id)).scalar()
        pos = int(mx or 0) + 1
    except Exception:
        pos = 0

    cat = ChannelCategory(guild_id=int(guild.id), name=name, position=pos, created_by=int(current_user.id))
    db.session.add(cat)
    db.session.commit()
    return jsonify({'success': True, 'category': {'id': int(cat.id), 'name': cat.name, 'position': int(cat.position or 0)}})

@app.route('/api/guilds/<int:guild_id>/categories/<int:cat_id>/update', methods=['POST'])
@login_required
def api_guild_category_update(guild_id: int, cat_id: int):
    guild = db.session.get(Channel, int(guild_id))
    if (not guild) or bool(getattr(guild, 'is_dm', False)):
        return jsonify({'error': 'Сервер не найден'}), 404

    # normalize to root
    try:
        if int(getattr(guild, 'guild_id', guild.id) or guild.id) != int(guild.id):
            root_id = int(getattr(guild, 'guild_id', 0) or 0)
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                guild = root
    except Exception:
        pass

    _, mem = _require_membership(guild.id, int(current_user.id))
    if not mem or not _is_channel_admin(mem):
        return jsonify({'error': 'Нет прав'}), 403

    cat = db.session.get(ChannelCategory, int(cat_id))
    if not cat or int(getattr(cat, 'guild_id', 0) or 0) != int(guild.id):
        return jsonify({'error': 'Категория не найдена'}), 404

    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if name:
        cat.name = name[:64]
    db.session.commit()
    return jsonify({'success': True, 'category': {'id': int(cat.id), 'name': cat.name, 'position': int(cat.position or 0)}})

@app.route('/api/guilds/<int:guild_id>/categories/<int:cat_id>', methods=['DELETE'])
@login_required
def api_guild_category_delete(guild_id: int, cat_id: int):
    guild = db.session.get(Channel, int(guild_id))
    if (not guild) or bool(getattr(guild, 'is_dm', False)):
        return jsonify({'error': 'Сервер не найден'}), 404

    # normalize to root
    try:
        if int(getattr(guild, 'guild_id', guild.id) or guild.id) != int(guild.id):
            root_id = int(getattr(guild, 'guild_id', 0) or 0)
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                guild = root
    except Exception:
        pass

    _, mem = _require_membership(guild.id, int(current_user.id))
    if not mem or not _is_channel_admin(mem):
        return jsonify({'error': 'Нет прав'}), 403

    cat = db.session.get(ChannelCategory, int(cat_id))
    if not cat or int(getattr(cat, 'guild_id', 0) or 0) != int(guild.id):
        return jsonify({'error': 'Категория не найдена'}), 404

    # Move channels out of category
    try:
        Channel.query.filter(Channel.guild_id == int(guild.id)).filter(Channel.category_id == int(cat.id)).update({'category_id': None}, synchronize_session=False)
    except Exception:
        db.session.rollback()

    db.session.delete(cat)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/channels/<int:channel_id>/move', methods=['POST'])
@login_required
def api_channel_move_category(channel_id: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch or bool(getattr(ch, 'is_dm', False)):
        return jsonify({'error': 'Канал не найден'}), 404

    root_id = _root_id_for_channel(ch)
    _, mem = _require_membership(int(root_id), int(current_user.id))
    if not mem or not _is_channel_admin(mem):
        return jsonify({'error': 'Нет прав'}), 403

    # root channel itself cannot be moved
    try:
        if int(getattr(ch, 'id', 0) or 0) == int(root_id):
            return jsonify({'error': 'Нельзя перемещать сам сервер'}), 400
    except Exception:
        pass

    data = request.get_json(silent=True) or {}
    category_id = data.get('category_id')

    cat_id = None
    try:
        if category_id is not None and str(category_id).strip() != "":
            cand = int(category_id)
            if cand > 0:
                cat = db.session.get(ChannelCategory, int(cand))
                if cat and int(getattr(cat, 'guild_id', 0) or 0) == int(root_id):
                    cat_id = int(cat.id)
    except Exception:
        cat_id = None

    # append to end within target category
    pos = 0
    try:
        q = db.session.query(db.func.max(Channel.position)).filter(Channel.guild_id == int(root_id)).filter(Channel.id != int(root_id))
        if cat_id is None:
            q = q.filter((Channel.category_id == None) | (Channel.category_id == 0))
        else:
            q = q.filter(Channel.category_id == int(cat_id))
        mx = q.scalar()
        pos = int(mx or 0) + 1
    except Exception:
        pos = int(getattr(ch, 'position', 0) or 0)

    ch.category_id = cat_id
    ch.position = pos
    db.session.commit()
    return jsonify({'success': True, 'id': int(ch.id), 'category_id': (int(cat_id) if cat_id else None), 'position': int(ch.position or 0)})

# --- v14.1: mark as read + reorder (Discord-like) ---

@app.route('/api/channels/<int:channel_id>/mark_read', methods=['POST'])
@login_required
def api_channel_mark_read(channel_id: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch or bool(getattr(ch, 'is_dm', False)):
        return jsonify({'error': 'Канал не найден'}), 404

    root_id = _root_id_for_channel(ch)
    _, mem = _require_membership(int(root_id), int(current_user.id))
    if not mem:
        return jsonify({'error': 'Нет доступа'}), 403

    try:
        last_id = db.session.query(db.func.max(Message.id)).filter(Message.channel_id == int(channel_id)).scalar()
        last_id = int(last_id or 0)
    except Exception:
        last_id = 0

    cr = _get_or_create_channel_read(int(channel_id), int(current_user.id))
    cr.last_read_message_id = int(last_id)
    cr.updated_at = utcnow()
    db.session.commit()
    return jsonify({'success': True, 'channel_id': int(channel_id), 'last_read_message_id': int(last_id)})

@app.route('/api/guilds/<int:guild_id>/categories/<int:cat_id>/mark_read', methods=['POST'])
@login_required
def api_guild_category_mark_read(guild_id: int, cat_id: int):
    guild = db.session.get(Channel, int(guild_id))
    if (not guild) or bool(getattr(guild, 'is_dm', False)):
        return jsonify({'error': 'Сервер не найден'}), 404

    # normalize to root
    try:
        if int(getattr(guild, 'guild_id', guild.id) or guild.id) != int(guild.id):
            root_id = int(getattr(guild, 'guild_id', 0) or 0)
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                guild = root
    except Exception:
        pass

    _, mem = _require_membership(guild.id, int(current_user.id))
    if not mem:
        return jsonify({'error': 'Нет доступа'}), 403

    # cat_id == 0 means "uncategorized"
    q = Channel.query.filter(Channel.is_dm == False).filter(Channel.guild_id == int(guild.id)).filter(Channel.id != int(guild.id))
    if int(cat_id) == 0:
        q = q.filter((Channel.category_id == None) | (Channel.category_id == 0))
    else:
        q = q.filter(Channel.category_id == int(cat_id))

    ch_ids = [int(r.id) for r in q.all()]
    if not ch_ids:
        return jsonify({'success': True, 'channels': []})

    # Find last message per channel in one query
    try:
        rows = (
            db.session.query(Message.channel_id, db.func.max(Message.id))
            .filter(Message.channel_id.in_(ch_ids))
            .group_by(Message.channel_id)
            .all()
        )
        last_by_ch = {int(cid): int(mx or 0) for (cid, mx) in rows}
    except Exception:
        last_by_ch = {int(cid): 0 for cid in ch_ids}

    out = []
    for cid in ch_ids:
        last_id = int(last_by_ch.get(int(cid), 0) or 0)
        cr = ChannelRead.query.filter_by(channel_id=int(cid), user_id=int(current_user.id)).first()
        if not cr:
            cr = ChannelRead(channel_id=int(cid), user_id=int(current_user.id), last_read_message_id=0)
            db.session.add(cr)
        cr.last_read_message_id = int(last_id)
        cr.updated_at = utcnow()
        out.append({'channel_id': int(cid), 'last_read_message_id': int(last_id)})
    db.session.commit()
    return jsonify({'success': True, 'channels': out})

@app.route('/api/guilds/<int:guild_id>/reorder', methods=['POST'])
@login_required
def api_guild_reorder(guild_id: int):
    guild = db.session.get(Channel, int(guild_id))
    if (not guild) or bool(getattr(guild, 'is_dm', False)):
        return jsonify({'error': 'Сервер не найден'}), 404

    # normalize to root
    try:
        if int(getattr(guild, 'guild_id', guild.id) or guild.id) != int(guild.id):
            root_id = int(getattr(guild, 'guild_id', 0) or 0)
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                guild = root
    except Exception:
        pass

    _, mem = _require_membership(guild.id, int(current_user.id))
    if not mem or not _is_channel_admin(mem):
        return jsonify({'error': 'Нет прав'}), 403

    data = request.get_json(silent=True) or {}
    categories = data.get('categories') or []
    uncategorized = data.get('uncategorized') or []

    # Build sets of allowed ids
    allowed_channels = {
        int(ch.id)
        for ch in Channel.query.filter(Channel.is_dm == False)
        .filter(Channel.guild_id == int(guild.id))
        .filter(Channel.id != int(guild.id))
        .all()
    }
    allowed_cats = {
        int(c.id)
        for c in ChannelCategory.query.filter(ChannelCategory.guild_id == int(guild.id)).all()
    }

    # Update category positions
    try:
        pos = 1
        for item in categories:
            try:
                cid = int(item.get('id') or 0)
            except Exception:
                cid = 0
            if cid and cid in allowed_cats:
                cat = db.session.get(ChannelCategory, int(cid))
                if cat:
                    cat.position = int(pos)
                    pos += 1
    except Exception:
        pass

    # Helper to update channels in a bucket
    def _apply_channel_bucket(ch_ids, cat_id_or_none):
        p = 1
        for raw in (ch_ids or []):
            try:
                ch_id = int(raw)
            except Exception:
                continue
            if ch_id not in allowed_channels:
                continue
            ch = db.session.get(Channel, int(ch_id))
            if not ch:
                continue
            ch.category_id = (int(cat_id_or_none) if cat_id_or_none else None)
            ch.position = int(p)
            p += 1

    # Apply per-category channels
    for item in categories:
        try:
            cid = int(item.get('id') or 0)
        except Exception:
            cid = 0
        if not cid or cid not in allowed_cats:
            continue
        _apply_channel_bucket(item.get('channels') or [], cid)

    # Apply uncategorized bucket
    _apply_channel_bucket(uncategorized, None)

    db.session.commit()
    return jsonify({'success': True})

@app.route("/api/channels/<int:channel_id>", methods=["DELETE"])
@login_required
def api_delete_channel(channel_id: int):
    channel = db.session.get(Channel, channel_id)
    if not channel or channel.is_dm:
        return jsonify({"error": "Канал не найден"}), 404

    root_id = _root_id_for_channel(channel)
    root = db.session.get(Channel, int(root_id)) if root_id else channel

    # We'll notify clients in this server so they can refresh channel lists without page reload.
    guild_notify_id = int(getattr(root, 'id', 0) or 0)

    _, mem = _require_membership(int(root.id), current_user.id)
    if not mem or not _is_channel_admin(mem):
        return jsonify({"error": "Только админ может удалить"}), 403

    is_root = (int(getattr(root, 'id', 0) or 0) == int(getattr(channel, 'id', 0) or 0)) and (not bool(getattr(channel, 'is_dm', False)))

    # Collect channels to delete
    ids = [int(channel.id)]
    if is_root:
        subs = Channel.query.filter(Channel.guild_id == int(root.id)).filter(Channel.id != int(root.id)).all()
        ids = [int(root.id)] + [int(s.id) for s in subs]

    # Remove icon file only when deleting root server
    if is_root:
        try:
            folder = app.config.get('CHANNEL_ICONS_FOLDER') or os.path.join(BASE_DIR, 'private_uploads', 'channel_icons')
            old = (getattr(root, 'icon_path', '') or '').strip()
            if old:
                fp = os.path.join(folder, old)
                if os.path.isfile(fp):
                    os.remove(fp)
        except Exception:
            pass

    # Delete attachments/messages/reads/members
    try:
        # attachments by message subquery
        Attachment.query.filter(Attachment.message_id.in_(db.session.query(Message.id).filter(Message.channel_id.in_(ids)))).delete(synchronize_session=False)
    except Exception:
        db.session.rollback()
    try:
        Message.query.filter(Message.channel_id.in_(ids)).delete(synchronize_session=False)
    except Exception:
        db.session.rollback()
    try:
        ChannelRead.query.filter(ChannelRead.channel_id.in_(ids)).delete(synchronize_session=False)
    except Exception:
        db.session.rollback()
    try:
        ChannelMember.query.filter(ChannelMember.channel_id.in_(ids)).delete(synchronize_session=False)
    except Exception:
        db.session.rollback()

    # Delete channels
    for cid in ids:
        ch = db.session.get(Channel, int(cid))
        if ch:
            db.session.delete(ch)
    db.session.commit()

    # Discord-like: instantly refresh channel list client-side after deletion.
    try:
        if guild_notify_id:
            socketio.emit(
                "guild_channels_update",
                {"guild_id": guild_notify_id, "reason": "deleted", "deleted_ids": ids},
                broadcast=True,
            )
            # If the root server itself was deleted, notify clients so they can remove it
            # from the left rail without requiring a full page reload.
            if is_root:
                socketio.emit(
                    "guild_deleted",
                    {"guild_id": guild_notify_id, "deleted_ids": ids},
                    broadcast=True,
                )
    except Exception:
        pass
    return jsonify({"success": True, "guild_id": guild_notify_id, "deleted_ids": ids})

@app.route("/api/channels/<int:channel_id>/join", methods=["POST"])
@login_required
def api_join_channel(channel_id: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch or ch.is_dm:
        return jsonify({"error": "Канал не найден"}), 404

    # v11: operate on root server
    try:
        root_id = _root_id_for_channel(ch)
        if int(root_id) != int(getattr(ch, 'id', 0) or 0):
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                ch = root
    except Exception:
        pass

    # v11: operate on root server
    try:
        root_id = _root_id_for_channel(ch)
        if int(root_id) != int(getattr(ch, 'id', 0) or 0):
            root = db.session.get(Channel, int(root_id)) if root_id else None
            if root:
                ch = root
    except Exception:
        pass

    if bool(getattr(ch, 'is_private', True)):
        return jsonify({"error": "Этот канал приватный. Вступление только по инвайту."}), 403

    exists = ChannelMember.query.filter_by(channel_id=ch.id, user_id=current_user.id).first()
    if not exists:
        db.session.add(ChannelMember(channel_id=ch.id, user_id=current_user.id, role='member', joined_at=utcnow()))
        db.session.commit()
    return jsonify({"success": True})

def _get_user_role_obj(user_id: int):
    try:
        ur = UserRole.query.filter_by(user_id=int(user_id)).first()
        if not ur:
            return None
        return db.session.get(Role, int(ur.role_id))
    except Exception:
        return None


@app.route("/api/channels/<int:channel_id>/details", methods=["GET"])
@login_required
def api_channel_details(channel_id: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch:
        return jsonify({"error": "Канал не найден"}), 404

    root_id = _root_id_for_channel(ch)
    is_dm = bool(getattr(ch, 'is_dm', False))
    is_root = (not is_dm) and (int(root_id) == int(getattr(ch, 'id', 0) or 0))

    root_ch = (db.session.get(Channel, int(root_id)) or ch) if (not is_dm) else ch

    # Membership is stored on the root (server) channel.
    _, mem = _require_membership(int(root_id), int(current_user.id))
    if not mem:
        return jsonify({"error": "Нет доступа к этому каналу"}), 403

    try:
        _cleanup_temporary_memberships(int(root_id))
    except Exception:
        pass

    can_admin = _is_channel_admin(mem)
    can_mod = _is_channel_moderator(mem)
    # Permission check for this конкретный канал (not only root membership)
    perms = _effective_channel_perms(ch, mem)

    # Fix258: For DM channels, reflect privacy gating in permissions.send
    if is_dm:
        try:
            other_id = _get_dm_other_user_id(int(getattr(ch, 'id', 0) or 0), int(current_user.id))
        except Exception:
            other_id = None
        try:
            if other_id and (not _dm_can_send(int(current_user.id), int(other_id))):
                # Ensure it's a plain dict so JSON contains the override.
                if not isinstance(perms, dict):
                    perms = dict(perms)
                else:
                    perms = dict(perms)
                perms['send'] = False
        except Exception:
            pass
    if (not bool(perms.get("view"))) and (not bool(can_admin)):
        return jsonify({"error": "Нет доступа к этому каналу"}), 403


    members = []
    if not is_dm:
        try:
            rows = (
                db.session.query(User, ChannelMember)
                .join(ChannelMember, ChannelMember.user_id == User.id)
                .filter(ChannelMember.channel_id == int(root_id))
                .all()
            )
            for u, cm in rows:
                pub = _presence_public(u)
                members.append({
                    "id": u.id,
                    "username": u.username,
                    "avatar_url": u.avatar_url or "",
                    "is_online": bool(pub.get("online")),
                    "mode": pub.get("mode"),
                    "presence_text": pub.get("presence_text"),
                    "member_role": (getattr(cm, "role", None) or "member"),
                    "joined_at": _iso_z(getattr(cm, "joined_at", None)),
                })
        except Exception:
            members = []

    # Invite: allowed for admins; for subchannels we store invite_code on that subchannel.
    invite_code = ""
    invite_url = ""
    invite_expires_at = None
    invite_max_uses = 0
    invite_uses = 0
    try:
        if (not is_dm) and can_admin:
            target = ch if not is_root else (db.session.get(Channel, int(root_id)) or ch)
            invite_code = (getattr(target, 'invite_code', '') or '').strip()
            if not invite_code:
                # Generate lazily.
                for _ in range(6):
                    cand = uuid.uuid4().hex[:16]
                    exists = Channel.query.filter(Channel.invite_code == cand).first()
                    if not exists:
                        invite_code = cand
                        setattr(target, 'invite_code', cand)
                        break
                db.session.commit()
            if invite_code:
                invite_url = url_for('invite_join', code=invite_code, _external=True)
            invite_expires_at = getattr(target, 'invite_expires_at', None)
            invite_max_uses = int(getattr(target, 'invite_max_uses', 0) or 0)
            invite_uses = int(getattr(target, 'invite_uses', 0) or 0)
    except Exception:
        invite_code = ""
        invite_url = ""
        invite_expires_at = None
        invite_max_uses = 0
        invite_uses = 0

    # Categories for settings UI (admin only)
    cats = []
    try:
        if (not is_dm) and can_admin:
            rows = (
                ChannelCategory.query
                .filter(ChannelCategory.guild_id == int(root_id))
                .order_by(ChannelCategory.position.asc(), ChannelCategory.created_at.asc())
                .all()
            )
            for c in rows:
                cats.append({'id': int(c.id), 'name': c.name, 'position': int(getattr(c, 'position', 0) or 0)})
    except Exception:
        cats = []

    # Global roles list (used in channel panel; ordering like Discord)
    roles_list = []
    try:
        rows = Role.query.order_by(Role.position.asc(), Role.created_at.asc()).all()
        for r in rows:
            roles_list.append({"id": int(r.id), "name": r.name, "color": (r.color or "#9aa0ff"), "position": int(getattr(r, "position", 0) or 0)})
    except Exception:
        roles_list = []

    return jsonify({
        "id": ch.id,
        "root_id": int(root_id),
        "is_root": bool(is_root),
        "name": ch.name,
        "is_dm": bool(is_dm),
        "type": (getattr(ch, "channel_type", None) or "text"),
        "topic": (getattr(ch, "topic", None) or ""),
        "category_id": (int(getattr(ch, "category_id", 0) or 0) or None),
        "position": int(getattr(ch, "position", 0) or 0),
        "created_by": int(getattr(ch, "created_by", 0) or 0),
        "created_at": _iso_z(getattr(ch, "created_at", None)),
        "is_private": bool(getattr(ch, "is_private", True)),
        "my_role": (getattr(mem, "role", None) or "member"),
        "can_admin": bool(can_admin),
        "can_moderate": bool(can_mod),
        "permissions": _effective_channel_perms(ch, mem),
        "permission_overrides": (_permission_overrides_for_channel(int(ch.id)) if bool(can_admin) else []),
        "invite_code": (invite_code if can_admin else ""),
        "invite_url": (invite_url if can_admin else ""),
        "invite_expires_at": (_iso_z(invite_expires_at) if (can_admin and invite_expires_at) else None),
        "invite_max_uses": (invite_max_uses if can_admin else 0),
        "invite_uses": (invite_uses if can_admin else 0),
        "invite_default_channel_id": (int(getattr(root_ch if is_root else ch, "invite_default_channel_id", 0) or 0) or None) if can_admin else None,
        "invite_temporary": bool(getattr(root_ch if is_root else ch, "invite_temporary", False)) if can_admin else False,
        "icon_url": _channel_icon_url(ch),
        "members": members,
        "roles": roles_list,
        "categories": cats,
    })

@app.route("/api/channels/<int:channel_id>/update", methods=["POST"])
@login_required
def api_channel_update(channel_id: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch or ch.is_dm:
        return jsonify({"error": "Канал не найден"}), 404

    _, mem = _require_membership(ch.id, current_user.id)
    if not mem or not _is_channel_admin(mem):
        return jsonify({"error": "Нет прав менять этот канал"}), 403

    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    ch_type = (data.get("type") or "").strip().lower()
    topic = (data.get("topic") or "").strip()

    server_tag = (data.get("server_tag") or "").strip()
    banner_color = (data.get("banner_color") or "").strip()

    if name:
        ch.name = name[:64]
    if ch_type in ("text", "voice"):
        ch.channel_type = ch_type
    if topic is not None:
        ch.topic = topic[:140]

    # v30: server profile fields apply only to root server
    try:
        rid = _root_id_for_channel(ch)
    except Exception:
        rid = int(getattr(ch, 'id', 0) or 0)
    if int(rid) == int(getattr(ch, 'id', 0) or 0):
        if server_tag is not None:
            ch.server_tag = (server_tag[:50])
        if banner_color is not None:
            ch.banner_color = (banner_color[:50])

    db.session.commit()
    return jsonify({"success": True, "id": ch.id, "name": ch.name, "type": ch.channel_type, "topic": ch.topic})


# --- v14.2: channel permission overrides (Discord-like, simplified) ---

@app.route("/api/channels/<int:channel_id>/permissions", methods=["GET"])
@login_required
def api_channel_permissions_get(channel_id: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch or bool(getattr(ch, "is_dm", False)):
        return jsonify({"error": "Канал не найден"}), 404

    _, mem = _require_membership(int(channel_id), int(current_user.id))
    if not mem:
        return jsonify({"error": "Нет доступа"}), 403
    if not _is_channel_admin(mem):
        return jsonify({"error": "Нет прав"}), 403

    return jsonify({
        "channel_id": int(channel_id),
        "overrides": _permission_overrides_for_channel(int(channel_id)),
    })

@app.route("/api/channels/<int:channel_id>/permissions", methods=["POST"])
@login_required
def api_channel_permissions_set(channel_id: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch or bool(getattr(ch, "is_dm", False)):
        return jsonify({"error": "Канал не найден"}), 404

    _, mem = _require_membership(int(channel_id), int(current_user.id))
    if not mem:
        return jsonify({"error": "Нет доступа"}), 403
    if not _is_channel_admin(mem):
        return jsonify({"error": "Только админ может менять права"}), 403

    data = request.get_json(silent=True) or {}
    overrides = data.get("overrides") or data.get("items") or []
    if not isinstance(overrides, list):
        return jsonify({"error": "overrides должен быть списком"}), 400

    allowed_roles = {"pending", "member", "moderator", "admin"}

    def _norm(v):
        # None means inherit
        if v is None:
            return None
        if isinstance(v, bool):
            return bool(v)
        if isinstance(v, (int, float)):
            return bool(int(v))
        s = str(v).strip().lower()
        if s in ("", "inherit", "null", "none"):
            return None
        if s in ("1", "true", "yes", "on", "allow"):
            return True
        if s in ("0", "false", "no", "off", "deny"):
            return False
        return None

    try:
        for item in overrides:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "member").lower().strip()
            if role not in allowed_roles:
                continue

            row = ChannelPermissionOverride.query.filter_by(channel_id=int(channel_id), role=role).first()
            if not row:
                row = ChannelPermissionOverride(channel_id=int(channel_id), role=role)
                db.session.add(row)

            row.view_channel = _norm(item.get("view"))
            row.send_messages = _norm(item.get("send"))
            row.connect = _norm(item.get("connect"))
            row.speak = _norm(item.get("speak"))

        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Ошибка сохранения прав"}), 500

    return jsonify({
        "success": True,
        "channel_id": int(channel_id),
        "overrides": _permission_overrides_for_channel(int(channel_id)),
    })

# --- v10: group icon management (admin only) ---
_ICON_EXTS = {'.png', '.jpg', '.jpeg', '.webp'}

@app.route('/api/channels/<int:channel_id>/icon', methods=['POST'])
@login_required
def api_channel_icon_upload(channel_id: int):
    ch0 = db.session.get(Channel, int(channel_id))
    if (not ch0) or bool(getattr(ch0, 'is_dm', False)):
        return jsonify({'error': 'Канал не найден'}), 404
    root_id = _root_id_for_channel(ch0)
    ch = db.session.get(Channel, int(root_id)) if root_id else ch0
    if (not ch) or bool(getattr(ch, 'is_dm', False)):
        return jsonify({'error': 'Канал не найден'}), 404
    _, mem = _require_membership(ch.id, int(current_user.id))
    if (not mem) or (not _is_channel_admin(mem)):
        return jsonify({'error': 'Только админ может менять иконку'}), 403

    f = request.files.get('icon') or request.files.get('file')
    if (not f) or (not getattr(f, 'filename', None)):
        return jsonify({'error': 'Файл не выбран'}), 400

    filename = secure_filename(f.filename) or 'icon'
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _ICON_EXTS:
        return jsonify({'error': 'Только PNG/JPG/WEBP'}), 400

    # size limit 2MB (best-effort; nginx/body limits may apply too)
    try:
        f.stream.seek(0, os.SEEK_END)
        size = int(f.stream.tell())
        f.stream.seek(0)
    except Exception:
        size = 0
    if size and size > 2 * 1024 * 1024:
        return jsonify({'error': 'Файл слишком большой (макс 2MB)'}), 413

    folder = app.config.get('CHANNEL_ICONS_FOLDER') or os.path.join(BASE_DIR, 'private_uploads', 'channel_icons')
    os.makedirs(folder, exist_ok=True)
    new_name = f'ch_{int(ch.id)}_{uuid.uuid4().hex[:10]}{ext}'
    fp = os.path.join(folder, new_name)

    # delete old
    try:
        old = (getattr(ch, 'icon_path', '') or '').strip()
        if old:
            old_fp = os.path.join(folder, old)
            if os.path.isfile(old_fp):
                os.remove(old_fp)
    except Exception:
        pass

    f.save(fp)
    ch.icon_path = new_name
    db.session.commit()
    return jsonify({'success': True, 'icon_url': _channel_icon_url(ch)})

@app.route('/api/channels/<int:channel_id>/icon', methods=['DELETE'])
@login_required
def api_channel_icon_delete(channel_id: int):
    ch0 = db.session.get(Channel, int(channel_id))
    if (not ch0) or bool(getattr(ch0, 'is_dm', False)):
        return jsonify({'error': 'Канал не найден'}), 404
    root_id = _root_id_for_channel(ch0)
    ch = db.session.get(Channel, int(root_id)) if root_id else ch0
    if (not ch) or bool(getattr(ch, 'is_dm', False)):
        return jsonify({'error': 'Канал не найден'}), 404
    _, mem = _require_membership(ch.id, int(current_user.id))
    if (not mem) or (not _is_channel_admin(mem)):
        return jsonify({'error': 'Только админ может менять иконку'}), 403

    folder = app.config.get('CHANNEL_ICONS_FOLDER') or os.path.join(BASE_DIR, 'private_uploads', 'channel_icons')
    try:
        old = (getattr(ch, 'icon_path', '') or '').strip()
        if old:
            old_fp = os.path.join(folder, old)
            if os.path.isfile(old_fp):
                os.remove(old_fp)
    except Exception:
        pass
    ch.icon_path = ''
    db.session.commit()
    return jsonify({'success': True, 'icon_url': ''})


# --- v9: invites & per-channel role management ---


@app.route("/invite/<code>")
@login_required
def invite_join(code: str):
    raw = (code or "").strip()
    if not raw:
        flash("Неверный инвайт", "error")
        return redirect(url_for("chat"))

    # Keep only hex chars (our codes are uuid4 hex slices)
    norm = re.sub(r'[^0-9a-fA-F]', '', raw)[:32]
    if not norm:
        flash("Неверный инвайт", "error")
        return redirect(url_for("chat"))

    ch = Channel.query.filter(Channel.is_dm == False).filter(Channel.invite_code == norm).first()
    if not ch:
        flash("Инвайт недействителен или устарел", "error")
        return redirect(url_for("chat"))

    # v44: expiry / usage limit
    now = utcnow()
    try:
        exp = getattr(ch, 'invite_expires_at', None)
        if exp is not None and now > exp:
            flash("Инвайт недействителен или устарел", "error")
            return redirect(url_for("chat"))
        max_uses = int(getattr(ch, 'invite_max_uses', 0) or 0)
        uses = int(getattr(ch, 'invite_uses', 0) or 0)
        if max_uses > 0 and uses >= max_uses:
            flash("Инвайт недействителен или устарел", "error")
            return redirect(url_for("chat"))
    except Exception:
        pass

    root_id = _root_id_for_channel(ch)
    root = db.session.get(Channel, int(root_id)) if root_id else ch

    mem = ChannelMember.query.filter_by(channel_id=int(root.id), user_id=int(current_user.id)).first()
    if not mem:
        cm = ChannelMember(channel_id=int(root.id), user_id=int(current_user.id), role='pending', joined_at=utcnow())
        try:
            if bool(getattr(root, 'invite_temporary', False)):
                cm.is_temporary = True
                cm.temporary_until = utcnow() + timedelta(hours=24)
        except Exception:
            pass
        db.session.add(cm)
        # count invite usage only on first join
        try:
            ch.invite_uses = int(getattr(ch, 'invite_uses', 0) or 0) + 1
        except Exception:
            pass
        db.session.commit()

    # Open server + (optionally) a specific subchannel in UI
    url = f"{url_for('chat')}?open={int(root.id)}"
    try:
        if (not bool(getattr(ch, 'is_dm', False))) and int(getattr(ch, 'id', 0) or 0) != int(getattr(root, 'id', 0) or 0):
            # invite points to a specific subchannel
            url += f"&sub={int(getattr(ch, 'id', 0) or 0)}"
        else:
            # root invite -> open default destination channel if configured
            dest = int(getattr(root, 'invite_default_channel_id', 0) or 0)
            if dest > 0:
                url += f"&sub={dest}"
    except Exception:
        pass
    return redirect(url)


@app.route("/api/invites/join", methods=["POST"])
@login_required
def api_invite_join():
    data = request.get_json(silent=True) or {}
    raw = (data.get('code') or '').strip()
    if not raw:
        return jsonify({"error": "Код обязателен"}), 400

    # Accept either pure code or full invite URL
    code = raw
    if '/invite/' in code:
        code = code.split('/invite/', 1)[-1]
    code = code.split('?', 1)[0].strip().strip('/')

    # Keep only hex chars (our codes are uuid4 hex slices)
    code = re.sub(r'[^0-9a-fA-F]', '', code)[:32]
    if not code:
        return jsonify({"error": "Неверный код"}), 400

    # Can be either a server invite (root) or a subchannel invite.
    ch = Channel.query.filter(Channel.is_dm == False).filter(Channel.invite_code == code).first()
    if not ch:
        return jsonify({"error": "Инвайт не найден"}), 404

    # v44: expiry / usage limit
    now = utcnow()
    try:
        exp = getattr(ch, 'invite_expires_at', None)
        if exp is not None and now > exp:
            return jsonify({"error": "Инвайт устарел"}), 400
        max_uses = int(getattr(ch, 'invite_max_uses', 0) or 0)
        uses = int(getattr(ch, 'invite_uses', 0) or 0)
        if max_uses > 0 and uses >= max_uses:
            return jsonify({"error": "Лимит приглашений исчерпан"}), 400
    except Exception:
        pass

    root_id = _root_id_for_channel(ch)
    root = db.session.get(Channel, int(root_id)) if root_id else ch
    if not root:
        return jsonify({"error": "Группа не найдена"}), 404

    mem = ChannelMember.query.filter_by(channel_id=int(root.id), user_id=int(current_user.id)).first()
    created = False
    if not mem:
        mem = ChannelMember(channel_id=int(root.id), user_id=int(current_user.id), role='pending', joined_at=utcnow())
        try:
            if bool(getattr(root, 'invite_temporary', False)):
                mem.is_temporary = True
                mem.temporary_until = utcnow() + timedelta(hours=24)
        except Exception:
            pass
        db.session.add(mem)
        # count invite usage only on first join
        try:
            ch.invite_uses = int(getattr(ch, 'invite_uses', 0) or 0) + 1
        except Exception:
            pass
        db.session.commit()
        created = True

    target_id = int(getattr(ch, 'id', 0) or 0)
    target_is_sub = (not bool(getattr(ch, 'is_dm', False))) and (int(target_id) != int(getattr(root, 'id', 0) or 0))

    return jsonify({
        "success": True,
        "created": bool(created),
        "root_id": int(root.id),
        "target_channel_id": (int(target_id) if target_is_sub else (int(getattr(root, "invite_default_channel_id", 0) or 0) or None)),
        "channel": {  # root server info for UI
            "id": root.id,
            "name": root.name,
            "type": (getattr(root, 'channel_type', None) or 'text'),
            "topic": (getattr(root, 'topic', None) or ''),
            "is_private": bool(getattr(root, 'is_private', True)),
            "my_role": (getattr(mem, 'role', None) or 'member'),
            "icon_url": _channel_icon_url(root),
        },
        "target": ({"id": target_id, "name": ch.name, "type": (getattr(ch, 'channel_type', None) or 'text')} if target_is_sub else None)
    })


@app.route("/api/channels/<int:channel_id>/invite/regenerate", methods=["POST"])
@login_required
def api_invite_regenerate(channel_id: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch or ch.is_dm:
        return jsonify({"error": "Канал не найден"}), 404

    _, mem = _require_membership(ch.id, current_user.id)
    if not mem or not _is_channel_admin(mem):
        return jsonify({"error": "Только админ может регенерировать инвайт"}), 403

    new_code = uuid.uuid4().hex[:16]
    ch.invite_code = new_code
    ch.is_private = True
    # v44 defaults: 7 days expiry, reset uses
    try:
        ch.invite_expires_at = utcnow() + timedelta(days=7)
    except Exception:
        pass
    try:
        ch.invite_uses = 0
    except Exception:
        pass
    db.session.commit()

    return jsonify({
        "success": True,
        "invite_code": new_code,
        "invite_url": url_for('invite_join', code=new_code, _external=True),
        "invite_expires_at": (ch.invite_expires_at.isoformat() if getattr(ch, 'invite_expires_at', None) else None),
        "invite_max_uses": int(getattr(ch, 'invite_max_uses', 0) or 0),
        "invite_uses": int(getattr(ch, 'invite_uses', 0) or 0),
        "invite_default_channel_id": (int(getattr(ch, 'invite_default_channel_id', 0) or 0) or None),
        "invite_temporary": bool(getattr(ch, 'invite_temporary', False))
    })

@app.route("/api/channels/<int:channel_id>/invite/settings", methods=["POST"])
@login_required
def api_invite_settings(channel_id: int):
    """Update invite link settings for a server/subchannel.
    Payload: { expires_in: seconds (0/None => never), max_uses: int (0 => unlimited), default_channel_id: int|null, temporary: bool }
    """
    ch = db.session.get(Channel, int(channel_id))
    if not ch or ch.is_dm:
        return jsonify({"error": "Канал не найден"}), 404

    _, mem = _require_membership(ch.id, current_user.id)
    if not mem or not _is_channel_admin(mem):
        return jsonify({"error": "Только админ может менять приглашения"}), 403

    data = request.get_json(silent=True) or {}
    expires_in = data.get('expires_in', None)
    max_uses = data.get('max_uses', None)
    default_channel_id = data.get('default_channel_id', None)
    temporary = data.get('temporary', None)

    now = utcnow()
    # expires
    try:
        if expires_in is None or str(expires_in).strip() == "":
            # keep current
            pass
        else:
            ei = int(expires_in)
            if ei <= 0:
                ch.invite_expires_at = None
            else:
                ch.invite_expires_at = now + timedelta(seconds=ei)
    except Exception:
        return jsonify({"error": "Неверный срок"}), 400

    # max uses
    try:
        if max_uses is None or str(max_uses).strip() == "":
            pass
        else:
            mu = int(max_uses)
            if mu < 0:
                mu = 0
            ch.invite_max_uses = mu
    except Exception:
        return jsonify({"error": "Неверный лимит"}), 400

    
    # destination channel (root server only)
    try:
        rid = _root_id_for_channel(ch)
        guild = db.session.get(Channel, int(rid)) if rid else ch
        is_root = guild and int(getattr(guild, 'id', 0) or 0) == int(getattr(ch, 'id', 0) or 0)
        if is_root:
            if default_channel_id is None or str(default_channel_id).strip() == "":
                pass
            else:
                cid = int(default_channel_id)
                if cid <= 0:
                    ch.invite_default_channel_id = None
                else:
                    dest = db.session.get(Channel, int(cid))
                    if (not dest) or bool(getattr(dest, 'is_dm', False)):
                        return jsonify({"error": "Канал назначения не найден"}), 400
                    if int(getattr(dest, 'guild_id', 0) or 0) != int(getattr(ch, 'id', 0) or 0):
                        return jsonify({"error": "Канал не относится к этому серверу"}), 400
                    # Prefer text channel
                    if (getattr(dest, 'channel_type', None) or 'text') != 'text':
                        return jsonify({"error": "Канал назначения должен быть текстовым"}), 400
                    ch.invite_default_channel_id = int(dest.id)
        # temporary membership
        if temporary is not None:
            ch.invite_temporary = bool(temporary)
    except ValueError:
        return jsonify({"error": "Неверный канал назначения"}), 400
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Ошибка настроек приглашения"}), 400

# ensure an invite code exists
    if not (getattr(ch, 'invite_code', '') or '').strip():
        ch.invite_code = uuid.uuid4().hex[:16]
    ch.is_private = True
    db.session.commit()

    return jsonify({
        "success": True,
        "invite_code": ch.invite_code,
        "invite_url": url_for('invite_join', code=ch.invite_code, _external=True),
        "invite_expires_at": (ch.invite_expires_at.isoformat() if getattr(ch, 'invite_expires_at', None) else None),
        "invite_max_uses": int(getattr(ch, 'invite_max_uses', 0) or 0),
        "invite_uses": int(getattr(ch, 'invite_uses', 0) or 0),
        "invite_default_channel_id": (int(getattr(ch, 'invite_default_channel_id', 0) or 0) or None),
        "invite_temporary": bool(getattr(ch, 'invite_temporary', False))
    })

@app.route("/api/channels/<int:channel_id>/members/<int:uid>/role", methods=["POST"])
@login_required
def api_set_channel_member_role(channel_id: int, uid: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch or ch.is_dm:
        return jsonify({"error": "Канал не найден"}), 404

    _, admin_mem = _require_membership(ch.id, current_user.id)
    if not admin_mem or not _is_channel_admin(admin_mem):
        return jsonify({"error": "Только админ может менять роли"}), 403

    target = ChannelMember.query.filter_by(channel_id=ch.id, user_id=int(uid)).first()
    if not target:
        return jsonify({"error": "Участник не найден"}), 404

    data = request.get_json(silent=True) or {}
    new_role = (data.get('role') or '').strip().lower()
    allowed = {'pending', 'member', 'moderator', 'admin'}
    if new_role not in allowed:
        return jsonify({"error": "Неверная роль"}), 400

    # Protect last admin
    if (target.role == 'admin') and (new_role != 'admin'):
        admins = ChannelMember.query.filter_by(channel_id=ch.id, role='admin').count()
        if int(admins) <= 1:
            return jsonify({"error": "Нельзя снять последнего админа"}), 400

    target.role = new_role

    # v45: converting to a real member clears temporary status
    try:
        if new_role and str(new_role) != 'pending':
            target.is_temporary = False
            target.temporary_until = None
    except Exception:
        pass
    db.session.commit()

    return jsonify({"success": True, "user_id": int(uid), "role": new_role})


@app.route("/api/channels/<int:channel_id>/members/<int:uid>/remove", methods=["POST"])
@login_required
def api_remove_channel_member(channel_id: int, uid: int):
    ch0 = db.session.get(Channel, int(channel_id))
    if not ch0 or ch0.is_dm:
        return jsonify({"error": "Канал не найден"}), 404

    root_id = _root_id_for_channel(ch0)
    root = db.session.get(Channel, int(root_id)) if root_id else ch0
    if not root or root.is_dm:
        return jsonify({"error": "Канал не найден"}), 404

    _, admin_mem = _require_membership(int(root.id), int(current_user.id))
    if not admin_mem or not _is_channel_admin(admin_mem):
        return jsonify({"error": "Только админ может удалять участников"}), 403

    target = ChannelMember.query.filter_by(channel_id=int(root.id), user_id=int(uid)).first()
    if not target:
        return jsonify({"error": "Участник не найден"}), 404

    # Protect last admin
    if (target.role == 'admin'):
        admins = ChannelMember.query.filter_by(channel_id=int(root.id), role='admin').count()
        if int(admins) <= 1:
            return jsonify({"error": "Нельзя удалить последнего админа"}), 400

    # Remove membership
    try:
        ChannelMember.query.filter_by(channel_id=int(root.id), user_id=int(uid)).delete()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось удалить участника"}), 500

    # Best-effort: remove read markers for all channels in this guild
    try:
        ch_ids = [int(root.id)]
        rows = Channel.query.filter(Channel.guild_id == int(root.id)).with_entities(Channel.id).all()
        for (cid,) in rows:
            try:
                ch_ids.append(int(cid))
            except Exception:
                pass
        if ch_ids:
            ChannelRead.query.filter(ChannelRead.user_id == int(uid)).filter(ChannelRead.channel_id.in_(ch_ids)).delete(synchronize_session=False)
    except Exception:
        db.session.rollback()

    db.session.commit()

    # Notify clients to refresh lists
    try:
        socketio.emit("guild_channels_update", {"guild_id": int(root.id)}, broadcast=True)
    except Exception:
        pass

    return jsonify({"success": True, "user_id": int(uid)})

@app.route("/api/roles", methods=["GET", "POST"])
@login_required
def api_roles():
    if request.method == "GET":
        roles = [{"id": r.id, "name": r.name, "color": r.color, "position": int(r.position or 0)}
                 for r in Role.query.order_by(Role.position.asc(), Role.created_at.asc()).all()]
        return jsonify(roles)

    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    color = (data.get("color") or "").strip()
    if not name:
        return jsonify({"error": "Имя роли пустое"}), 400
    if len(name) > 32:
        name = name[:32]
    if not color:
        color = "#9aa0ff"
    try:
        mx = db.session.query(db.func.max(Role.position)).scalar() or 0
    except Exception:
        mx = 0
    role = Role(name=name, color=color, position=int(mx) + 1)
    db.session.add(role)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Роль с таким именем уже есть"}), 400
    return jsonify({"id": role.id, "name": role.name, "color": role.color, "position": int(role.position or 0)})

@app.route("/api/roles/<int:role_id>", methods=["PUT", "DELETE"])
@login_required
def api_role_item(role_id: int):
    role = db.session.get(Role, int(role_id))
    if not role:
        return jsonify({"error": "Роль не найдена"}), 404

    if request.method == "DELETE":
        UserRole.query.filter_by(role_id=role.id).delete()
        db.session.delete(role)
        db.session.commit()
        return jsonify({"success": True})

    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    color = (data.get("color") or "").strip()
    if name:
        role.name = name[:32]
    if color:
        role.color = color[:16]
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось обновить роль"}), 400
    return jsonify({"success": True, "id": role.id, "name": role.name, "color": role.color})

@app.route("/api/roles/reorder", methods=["POST"])
@login_required
def api_roles_reorder():
    data = request.get_json(silent=True)
    order = None
    if isinstance(data, list):
        order = data
    else:
        order = (data or {}).get("order")
    if not isinstance(order, list) or not order:
        return jsonify({"error": "order обязателен"}), 400
    # Normalize ids
    ids = []
    for x in order:
        try:
            ids.append(int(x))
        except Exception:
            continue
    if not ids:
        return jsonify({"error": "order пуст"}), 400

    roles = Role.query.filter(Role.id.in_(ids)).all()
    rmap = {int(r.id): r for r in roles}

    pos = 10
    for rid in ids:
        r = rmap.get(int(rid))
        if not r:
            continue
        r.position = int(pos)
        pos += 10
    db.session.commit()

    # Notify all connected clients so their UI can reload channel lists immediately.
    try:
        if guild_notify_id:
            socketio.emit("guild_channels_update", {"guild_id": int(guild_notify_id)}, broadcast=True)
    except Exception:
        pass

    return jsonify({"success": True})

@app.route("/api/roles/assign", methods=["POST"])
@login_required
def api_role_assign():
    data = request.get_json() or {}
    try:
        user_id = int(data.get("user_id") or 0)
    except Exception:
        user_id = 0
    try:
        role_id = int(data.get("role_id") or 0)
    except Exception:
        role_id = 0

    if not user_id:
        return jsonify({"error": "user_id обязателен"}), 400
    u = db.session.get(User, user_id)
    if not u:
        return jsonify({"error": "Пользователь не найден"}), 404

    # clear role
    if not role_id:
        UserRole.query.filter_by(user_id=user_id).delete()
        db.session.commit()
        return jsonify({"success": True, "user_id": user_id, "role": None})

    r = db.session.get(Role, role_id)
    if not r:
        return jsonify({"error": "Роль не найдена"}), 404

    # one role per user
    UserRole.query.filter_by(user_id=user_id).delete()
    db.session.add(UserRole(user_id=user_id, role_id=role_id))
    db.session.commit()
    return jsonify({"success": True, "user_id": user_id, "role": {"id": r.id, "name": r.name, "color": r.color}})

@app.route("/api/messages/<int:channel_id>")
@login_required
def api_messages(channel_id: int):
    ch = db.session.get(Channel, int(channel_id))
    if not ch:
        return jsonify({"error": "Канал не найден"}), 404

    _, mem = _require_membership(ch.id, current_user.id)
    if not mem:
        return jsonify({"error": "Нет доступа к этому каналу"}), 403

    # Permission check (Discord-like, simplified)
    perms = _effective_channel_perms(ch, mem)
    if not bool(perms.get("view")):
        return jsonify({"error": "Нет доступа к этому каналу"}), 403

    # Apply per-user clear marker for DMs (local-only 'Очистить чат').
    clear_row = None
    if bool(getattr(ch, 'is_dm', False)):
        try:
            clear_row = ChannelClear.query.filter_by(channel_id=int(channel_id), user_id=int(current_user.id)).first()
        except Exception:
            clear_row = None

    q = Message.query.filter_by(channel_id=channel_id).filter(Message.deleted_at.is_(None))
    if clear_row and getattr(clear_row, 'cleared_at', None):
        q = q.filter(Message.created_at > clear_row.cleared_at)

    msgs = q.order_by(Message.created_at.asc()).all()

    # Preload attachments for these messages (separate table; no DB migrations needed)
    msg_ids = [m.id for m in msgs]
    att_map = {mid: [] for mid in msg_ids}
    if msg_ids:
        for a in (
            Attachment.query.filter(Attachment.message_id.in_(msg_ids))
            .order_by(Attachment.id.asc())
            .all()
        ):
            att_map.setdefault(a.message_id, []).append(
                {
                    "url": a.file_url,
                    "name": a.file_name,
                    "size": int(a.file_size or 0),
                    "mime": a.mime_type or "application/octet-stream",
                    "is_image": bool(a.is_image),
                }
            )

    # Reactions (aggregate counts + your own)
    react_counts = {mid: {} for mid in msg_ids}
    my_reacts = {mid: set() for mid in msg_ids}
    try:
        if msg_ids:
            from sqlalchemy import func
            rows = (
                db.session.query(MessageReaction.message_id, MessageReaction.emoji, func.count(MessageReaction.id))
                .filter(MessageReaction.message_id.in_(msg_ids))
                .group_by(MessageReaction.message_id, MessageReaction.emoji)
                .all()
            )
            for mid, emoji, cnt in rows:
                react_counts.setdefault(int(mid), {})[str(emoji)] = int(cnt)

            mine_rows = (
                db.session.query(MessageReaction.message_id, MessageReaction.emoji)
                .filter(MessageReaction.message_id.in_(msg_ids), MessageReaction.user_id == current_user.id)
                .all()
            )
            for mid, emoji in mine_rows:
                my_reacts.setdefault(int(mid), set()).add(str(emoji))
    except Exception:
        react_counts = {mid: {} for mid in msg_ids}
        my_reacts = {mid: set() for mid in msg_ids}
    ch = db.session.get(Channel, int(channel_id))
    other_id = _get_dm_other_user_id(channel_id, current_user.id) if (ch and ch.is_dm) else None

    result = []
    for m in msgs:
        user = db.session.get(User, m.user_id)

        receipt = None
        try:
            if other_id and int(m.user_id) == int(current_user.id):
                receipt = _receipt_state_for_sender(m.id, other_id)
        except Exception:
            receipt = None

        result.append(
            {
                "id": m.id,
                "user": user.username if user else "unknown",
                "user_id": user.id if user else None,
                "avatar_url": (user.avatar_url or "") if user else "",
                "content": m.content,
                "created_at": _fmt_msk(m.created_at),
                "created_day_key": _fmt_day_key_msk(m.created_at),
                "created_day_label": _fmt_day_label_ru(m.created_at),
                "channel_id": m.channel_id,
                "attachments": att_map.get(m.id, []),
                "receipt": receipt,
                "edited_at": _iso_z(getattr(m, "edited_at", None)),
                "deleted_at": _iso_z(getattr(m, "deleted_at", None)),
                "is_pinned": bool(getattr(m, "is_pinned", False)),
                "pinned_by": int(getattr(m, "pinned_by", 0) or 0),
                "reactions": react_counts.get(m.id, {}),
                "my_reactions": sorted(list(my_reacts.get(m.id, set()))),
            }
        )
    return jsonify(result)

@app.route("/api/messages/item/<int:message_id>", methods=["PUT"])
@login_required
def api_edit_message_item(message_id: int):
    msg = db.session.get(Message, int(message_id))
    if not msg:
        return jsonify({"error": "Сообщение не найдено"}), 404

    _, mem = _require_membership(int(msg.channel_id), current_user.id)
    if not mem:
        return jsonify({"error": "Нет доступа к этому каналу"}), 403

    if int(msg.user_id) != int(current_user.id):
        return jsonify({"error": "Нельзя редактировать чужое сообщение"}), 403

    data = request.get_json() or {}
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"error": "Пустое сообщение"}), 400

    msg.content = content
    msg.edited_at = utcnow()
    db.session.commit()

    payload = {
        "id": msg.id,
        "channel_id": msg.channel_id,
        "content": msg.content,
        "edited_at": _iso_z(msg.edited_at),
    }
    try:
        socketio.emit("message_updated", payload, to=f"channel_{msg.channel_id}")
    except Exception:
        pass
    return jsonify(payload)

@app.route("/api/messages/item/<int:message_id>", methods=["DELETE"])
@login_required
def api_delete_message_item(message_id: int):
    msg = db.session.get(Message, int(message_id))
    if not msg:
        return jsonify({"error": "Сообщение не найдено"}), 404

    _, mem = _require_membership(int(msg.channel_id), current_user.id)
    if not mem:
        return jsonify({"error": "Нет доступа к этому каналу"}), 403

    if int(msg.user_id) != int(current_user.id):
        ch = db.session.get(Channel, int(msg.channel_id))
        # In group chats, moderators/admins can delete. In DMs, only author.
        if (not ch) or bool(getattr(ch, 'is_dm', False)) or (not _is_channel_moderator(mem)):
            return jsonify({"error": "Нет прав удалить это сообщение"}), 403

    msg.deleted_at = utcnow()
    msg.content = ""
    db.session.commit()

    payload = {"id": msg.id, "channel_id": msg.channel_id, "deleted_at": _iso_z(msg.deleted_at)}
    try:
        socketio.emit("message_deleted", payload, to=f"channel_{msg.channel_id}")
    except Exception:
        pass
    return jsonify({"success": True})

@app.route("/api/messages/item/<int:message_id>/pin", methods=["POST"])
@login_required
def api_pin_message_item(message_id: int):
    msg = db.session.get(Message, int(message_id))
    if not msg:
        return jsonify({"error": "Сообщение не найдено"}), 404

    ch, mem = _require_membership(int(msg.channel_id), current_user.id)
    if not mem:
        return jsonify({"error": "Нет доступа к этому каналу"}), 403
    if not ch.is_dm and not _is_channel_moderator(mem):
        return jsonify({"error": "Только модератор/админ может закреплять сообщения"}), 403

    data = request.get_json() or {}
    desired = data.get("pinned", None)

    if desired is None:
        msg.is_pinned = not bool(getattr(msg, "is_pinned", False))
    else:
        msg.is_pinned = bool(desired)

    if msg.is_pinned:
        msg.pinned_at = utcnow()
        msg.pinned_by = int(current_user.id)
    else:
        msg.pinned_at = None
        msg.pinned_by = None

    db.session.commit()

    payload = {
        "id": msg.id,
        "channel_id": msg.channel_id,
        "is_pinned": bool(msg.is_pinned),
        "pinned_by": int(msg.pinned_by or 0),
        "pinned_at": _iso_z(msg.pinned_at),
    }
    try:
        socketio.emit("message_pinned", payload, to=f"channel_{msg.channel_id}")
    except Exception:
        pass
    return jsonify(payload)

@app.route("/api/messages/item/<int:message_id>/react", methods=["POST"])
@login_required
def api_react_message_item(message_id: int):
    msg = db.session.get(Message, int(message_id))
    if not msg:
        return jsonify({"error": "Сообщение не найдено"}), 404

    _, mem = _require_membership(int(msg.channel_id), current_user.id)
    if not mem:
        return jsonify({"error": "Нет доступа к этому каналу"}), 403

    data = request.get_json() or {}
    emoji = (data.get("emoji") or "").strip()
    if not emoji or len(emoji) > 16:
        return jsonify({"error": "Некорректная реакция"}), 400

    # toggle
    existing = MessageReaction.query.filter_by(message_id=msg.id, user_id=current_user.id, emoji=emoji).first()
    action = "added"
    if existing:
        db.session.delete(existing)
        action = "removed"
    else:
        db.session.add(MessageReaction(message_id=msg.id, user_id=current_user.id, emoji=emoji))
    db.session.commit()

    # counts
    try:
        from sqlalchemy import func
        rows = (
            db.session.query(MessageReaction.emoji, func.count(MessageReaction.id))
            .filter(MessageReaction.message_id == msg.id)
            .group_by(MessageReaction.emoji)
            .all()
        )
        counts = {str(e): int(c) for e, c in rows}
    except Exception:
        counts = {}

    payload = {
        "id": msg.id,
        "channel_id": msg.channel_id,
        "emoji": emoji,
        "user_id": int(current_user.id),
        "action": action,
        "counts": counts,
    }
    try:
        socketio.emit("reaction_update", payload, to=f"channel_{msg.channel_id}")
    except Exception:
        pass
    return jsonify(payload)

@app.route("/api/upload", methods=["POST"])
@login_required
def api_upload():
    """Upload files and create a chat message with attachments (per-plan limits)."""
    try:
        ch_id = int(request.form.get("channel_id") or 0)
    except Exception:
        ch_id = 0

    content = (request.form.get("content") or "").strip()

    if not ch_id:
        return jsonify({"error": "Не указан канал"}), 400

    ch = db.session.get(Channel, ch_id)
    if not ch:
        return jsonify({"error": "Канал не найден"}), 404

    # Discord-like DM gating (same as socket send_message)
    if bool(getattr(ch, "is_dm", False)):
        try:
            other_id = _get_dm_other_user_id(ch_id, current_user.id)
        except Exception:
            other_id = None
        if other_id and not _dm_can_send(int(current_user.id), int(other_id)):
            return (
                jsonify(
                    {
                        "error": "Ваше сообщение не было доставлено. Обычно такое случается, потому что у вас нет общих серверов с получателем или получатель принимает личные сообщения только от друзей.",
                        "code": "dm_not_allowed",
                    }
                ),
                403,
            )

    # Require membership for any channel (privacy)
    _, mem = _require_membership(ch_id, current_user.id)
    if not mem:
        return jsonify({"error": "Нет доступа к этому каналу"}), 403

    muted, mute_msg, mute_until = _nc_is_user_muted(int(current_user.id))
    if muted:
        return jsonify({"error": mute_msg, "code": "muted", "mute_until": mute_until}), 403
    server_id = _nc_get_channel_root_server_id(ch)
    if server_id:
        server_banned, server_ban_msg, server_ban_until = _nc_is_user_server_banned(int(current_user.id), int(server_id))
        if server_banned:
            return jsonify({"error": server_ban_msg, "code": "server_banned", "ban_until": server_ban_until}), 403
        server_muted, server_mute_msg, server_mute_until = _nc_is_user_server_muted(int(current_user.id), int(server_id))
        if server_muted:
            return jsonify({"error": server_mute_msg, "code": "server_muted", "mute_until": server_mute_until}), 403

    # Permission check (Discord-like, simplified)
    try:
        perms = _effective_channel_perms(ch, mem)
        if (getattr(ch, "channel_type", None) or "text").lower() == "voice":
            return jsonify({"error": "Нельзя отправлять файлы в голосовой канал"}), 400
        if not bool(perms.get("send")):
            return jsonify({"error": "Нет прав отправлять сообщения"}), 403
    except Exception:
        pass

    files = request.files.getlist("files")
    if not files:
        f = request.files.get("file")
        files = [f] if f else []

    files = [f for f in files if f and f.filename]
    if not files:
        return jsonify({"error": "Файл не выбран"}), 400

    user_max_upload_mb = _billing_feature_int(int(current_user.id), "max_upload_mb", 20)
    if user_max_upload_mb <= 0:
        user_max_upload_mb = 20
    user_max_upload_bytes = int(user_max_upload_mb) * 1024 * 1024

    # Create message (content can be empty string)
    msg = Message(channel_id=ch_id, user_id=current_user.id, content=content or "")
    db.session.add(msg)
    db.session.flush()  # get msg.id

    # Create initial receipt row for DM recipient (delivery/read handled client-side).
    try:
        if ch.is_dm:
            other_id = _get_dm_other_user_id(ch_id, current_user.id)
            if other_id:
                existing = MessageReceipt.query.filter_by(message_id=msg.id, user_id=int(other_id)).first()
                if not existing:
                    db.session.add(MessageReceipt(message_id=msg.id, user_id=int(other_id)))
    except Exception:
        pass

    saved = []
    for f in files:
        original = f.filename
        safe = secure_filename(original) or "file"
        ext = os.path.splitext(safe)[1].lower()
        token = uuid.uuid4().hex[:10]
        stamp = utcnow().strftime("%Y%m%d_%H%M%S")
        new_name = f"{stamp}_{current_user.id}_{token}{ext}"
        save_path = os.path.join(app.config["UPLOAD_FOLDER"], new_name)

        # Size check (best effort, MAX_CONTENT_LENGTH handles most cases)
        try:
            f.stream.seek(0, os.SEEK_END)
            size = int(f.stream.tell())
            f.stream.seek(0)
        except Exception:
            size = 0

        if size > user_max_upload_bytes:
            db.session.rollback()
            return jsonify({"error": f"Файл слишком большой (макс {user_max_upload_mb}MB на вашем тарифе)"}), 413

        f.save(save_path)

        file_url = url_for("static", filename=f"uploads/{new_name}")
        mime = (getattr(f, "mimetype", None) or "application/octet-stream")
        is_image = bool(
            mime.startswith("image/")
            or ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"}
        )

        att = Attachment(
            message_id=msg.id,
            file_url=file_url,
            file_name=original,
            file_size=size,
            mime_type=mime,
            is_image=is_image,
        )
        db.session.add(att)
        saved.append(
            {"url": file_url, "name": original, "size": size, "mime": mime, "is_image": is_image}
        )

    db.session.commit()

    payload = {
        "id": msg.id,
        "user": current_user.username,
        "user_id": current_user.id,
        "avatar_url": current_user.avatar_url or "",
        "content": msg.content,
        "created_at": _fmt_msk(msg.created_at),
            "created_day_key": _fmt_day_key_msk(msg.created_at),
            "created_day_label": _fmt_day_label_ru(msg.created_at),
            "channel_id": ch_id,
        "attachments": saved,
        "receipt": None,
        "edited_at": "",
        "deleted_at": "",
        "is_pinned": False,
        "pinned_by": 0,
        "reactions": {},
        "my_reactions": [],
    }

    # Broadcast to channel room so both sender and peers see it live.
    socketio.emit("new_message", payload, to=f"channel_{ch_id}")
    return jsonify({"success": True, "message": payload})

@app.errorhandler(413)
def api_file_too_large(e):
    # Keep it JSON-friendly for fetch/XHR clients
    return jsonify({"error": "Файл слишком большой (превышен лимит запроса или тарифа)"}), 413



@app.route("/api/users/<int:user_id>/profile", methods=["GET"])
@login_required
def api_user_profile(user_id: int):
    u = db.session.get(User, user_id)
    if not u:
        return jsonify({"error": "Пользователь не найден"}), 404

    # Optional context: if profile opened from inside a server, return badge hints for that server
    guild_id = request.args.get("guild_id", type=int)
    badges = []
    try:
        if guild_id:
            g = db.session.get(Channel, int(guild_id))
            if g:
                if int(g.created_by or 0) == int(u.id):
                    badges.append({"key": "owner", "label": "Владелец сервера"})
                mbr = ChannelMember.query.filter_by(channel_id=int(guild_id), user_id=int(u.id)).first()
                if mbr:
                    if (mbr.role or "") == "admin":
                        badges.append({"key": "admin", "label": "Администратор"})
                    elif (mbr.role or "") == "moderator":
                        badges.append({"key": "mod", "label": "Модератор"})
    except Exception:
        pass

    return jsonify({
        "id": int(u.id),
        "username": u.username or "",
        "display_name": (getattr(u, "display_name", None) or u.username or ""),
        "status_text": u.status_text or "",
        "presence_mode": u.presence_mode or "online",
        "is_online": bool(u.is_online),
        "avatar_url": u.avatar_url or "",
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_seen": u.last_seen.isoformat() if u.last_seen else None,
        "badges": badges,
        "cosmetics": _get_user_cosmetics(u),
        "showcase": _get_user_showcase(u),
    })
@app.route("/api/open_dm/<int:user_id>", methods=["POST"])
@login_required
def api_open_dm(user_id: int):
    if user_id == current_user.id:
        return jsonify({"error": "Нельзя писать самому себе"}), 400
    other = db.session.get(User, user_id)
    if not other:
        return jsonify({"error": "Пользователь не найден"}), 404
    ch = get_or_create_dm_channel(current_user.id, user_id)
    # Fix258: expose DM send permission so client can disable composer immediately
    try:
        can_send = bool(_dm_can_send(int(current_user.id), int(user_id)))
    except Exception:
        can_send = True
    title = (getattr(other, "display_name", None) or other.username)
    pub = _presence_public(other)
    return jsonify(
        {
            "channel_id": ch.id,
            "can_send": bool(can_send),
            "title": title,
            "status": other.status_text or "",
            "avatar_url": other.avatar_url or "",
            "user_id": other.id,
            "username": other.username or "",
            "display_name": (getattr(other, "display_name", None) or other.username or ""),
            "is_online": bool(pub.get("online")),
            "mode": pub.get("mode"),
            "presence_text": pub.get("presence_text"),
            "created_at": _iso_z(other.created_at),
            "last_seen": pub.get("last_seen"),
            "created_at_label": _fmt_date_msk(other.created_at),
            "last_seen_label": ("Скрыто" if (pub.get("mode") == "invisible") else _fmt_datetime_msk(getattr(other, "last_seen", None))),
            "activity_label": pub.get("activity_label"),
            "cosmetics": _get_user_cosmetics(other),
        }
    )

@app.route("/api/dm/<int:channel_id>/clear", methods=["POST"])
@login_required
def api_clear_dm(channel_id: int):
    """Clear a DM locally for the current user (Discord-like).

    IMPORTANT: Clearing must NOT delete history for the other participant.
    We store a per-user marker (ChannelClear.cleared_at) and filter messages on load.
    """
    ch = db.session.get(Channel, int(channel_id))
    if (not ch) or (not bool(getattr(ch, "is_dm", False))):
        return jsonify({"error": "Канал не найден"}), 404

    _, mem = _require_membership(int(channel_id), int(current_user.id))
    if not mem:
        return jsonify({"error": "Нет доступа к этому каналу"}), 403

    now = utcnow()
    try:
        row = ChannelClear.query.filter_by(channel_id=int(channel_id), user_id=int(current_user.id)).first()
        if row:
            row.cleared_at = now
        else:
            db.session.add(ChannelClear(channel_id=int(channel_id), user_id=int(current_user.id), cleared_at=now))

        # Also mark as read up to the last message at clear time so unread counters do not get stuck on hidden history.
        last_msg = (
            Message.query
            .filter(Message.channel_id == int(channel_id))
            .filter(Message.deleted_at.is_(None))
            .order_by(Message.created_at.desc())
            .first()
        )
        cr = ChannelRead.query.filter_by(channel_id=int(channel_id), user_id=int(current_user.id)).first()
        if not cr:
            cr = ChannelRead(channel_id=int(channel_id), user_id=int(current_user.id), last_read_message_id=0, updated_at=now)
            db.session.add(cr)
        cr.last_read_message_id = int(last_msg.id) if last_msg else 0
        cr.updated_at = now

        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось очистить чат"}), 500

    # Notify ONLY the current user (other participant must not see anything change).
    try:
        _emit_to_user(int(current_user.id), "dm_cleared_local", {"channel_id": int(channel_id), "by": int(current_user.id), "cleared_at": _iso_z(now)})
    except Exception:
        pass

    return jsonify({"success": True})


@app.route("/api/presence_bulk")
@login_required
def api_presence_bulk():
    # Return live presence for current user's friends.
    friend_ids = set()
    for fr in FriendRequest.query.filter_by(status="accepted").filter(
        (FriendRequest.from_id == current_user.id) | (FriendRequest.to_id == current_user.id)
    ):
        if fr.from_id == current_user.id:
            friend_ids.add(fr.to_id)
        else:
            friend_ids.add(fr.from_id)

    users = User.query.filter(User.id.in_(friend_ids)).all() if friend_ids else []
    out = []
    for u in users:
        pub = _presence_public(u)
        out.append(
            {
                "user_id": u.id,
                "online": bool(pub.get("online")),
                "mode": pub.get("mode"),
                "presence_text": pub.get("presence_text"),
                "created_at": _iso_z(u.created_at),
                "last_seen": pub.get("last_seen"),
                "created_at_label": _fmt_date_msk(u.created_at),
                "last_seen_label": ("Скрыто" if (pub.get("mode") == "invisible") else _fmt_datetime_msk(getattr(u, "last_seen", None))),
                "activity_label": pub.get("activity_label"),
            }
        )
    return jsonify({"users": out})

@app.route("/api/presence_mode", methods=["POST"])
@login_required
def api_presence_mode():
    data = request.get_json(silent=True) or {}
    mode = (data.get("mode") or "").lower().strip()
    allowed = {"online", "offline", "away", "dnd", "invisible"}
    if mode not in allowed:
        return jsonify({"error": "Неверный статус"}), 400
    try:
        current_user.presence_mode = mode
        db.session.commit()
        _emit_presence_update(current_user.id)
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось обновить статус"}), 500

    pub = _presence_public(current_user)
    return jsonify({"success": True, "mode": pub.get("mode"), "online": pub.get("online"), "presence_text": pub.get("presence_text")})

@app.route("/api/sidebar_meta")
@login_required
def api_sidebar_meta():
    # Return DM previews + unread counts for friend list.
    friend_ids = set()
    for fr in FriendRequest.query.filter_by(status="accepted").filter(
        (FriendRequest.from_id == current_user.id) | (FriendRequest.to_id == current_user.id)
    ):
        if fr.from_id == current_user.id:
            friend_ids.add(fr.to_id)
        else:
            friend_ids.add(fr.from_id)

    friends = User.query.filter(User.id.in_(friend_ids)).all() if friend_ids else []
    out = []
    for f in friends:
        # DM channel may not exist until first open; don't create it here.
        key = _dm_channel_key(current_user.id, f.id)
        ch = Channel.query.filter_by(name=key, is_dm=True).first()
        last = _last_message(ch.id) if ch else None
        unread = _unread_count(ch.id, current_user.id) if ch else 0

        pub = _presence_public(f)

        out.append(
            {
                "user_id": f.id,
                "username": f.username,
                "display_name": (getattr(f, "display_name", None) or f.username or ""),
                "avatar_url": f.avatar_url or "",
                "dm_channel_id": ch.id if ch else None,
                "last_message": (last.content if last else ""),
                "last_message_at": _iso_z(last.created_at) if last else None,
                "unread": int(unread),
                "online": bool(pub.get("online")),
                "mode": pub.get("mode"),
                "presence_text": pub.get("presence_text"),
            }
        )

    # Channels (servers): unread counts for left rail
    ch_out = []
    try:
        servers = (
            db.session.query(Channel, ChannelMember)
            .join(ChannelMember, ChannelMember.channel_id == Channel.id)
            .filter(Channel.is_dm == False)
            .filter(or_(Channel.guild_id == Channel.id, Channel.guild_id.is_(None)))
            .filter(ChannelMember.user_id == current_user.id)
            .order_by(Channel.id.asc())
            .all()
        )
        for ch, cm in servers:
            # aggregate unread over subchannels
            unread_total = 0
            try:
                subs = Channel.query.filter(Channel.guild_id == int(ch.id)).filter(Channel.id != int(ch.id)).all()
                for sub in subs:
                    unread_total += int(_unread_count(sub.id, current_user.id))
            except Exception:
                unread_total = int(_unread_count(ch.id, current_user.id))

            ch_out.append(
                {
                    "channel_id": ch.id,
                    "name": ch.name,
                    "last_message": "",
                    "last_message_at": None,
                    "unread": int(unread_total),
                    "is_private": bool(getattr(ch, 'is_private', True)),
                    "my_role": (getattr(cm, 'role', None) or 'member'),
                    "icon_url": _channel_icon_url(ch),
                }
            )
    except Exception:
        ch_out = []

    return jsonify({"friends": out, "channels": ch_out})


@app.route("/api/profile", methods=["POST"])
@login_required
def api_profile_update():
    status = (request.form.get("status") or "").strip()
    if status is not None:
        current_user.status_text = status[:120]

    activity = (request.form.get("activity") or "").strip()
    if activity is not None:
        current_user.activity_text = activity[:120]

    # Optional: select a bundled preset avatar (Discord-like).
    preset = (request.form.get("preset_avatar") or "").strip()
    if preset:
        try:
            # Accept either 'preset_01.png' or 'avatars/preset_01.png'
            fn = preset.replace('\\', '/').split('/')[-1]
            cand = f"avatars/{fn}"
            if cand in PRESET_AVATAR_FILES:
                current_user.avatar_url = url_for("static", filename=cand)
        except Exception:
            pass

    # profile cosmetics (background is free, name/avatar effects are plan-gated)
    incoming_cos = {
        "profile_bg": (request.form.get("profile_bg") or "").strip().lower() or None,
        "profile_bg_mode": (request.form.get("profile_bg_mode") or "").strip().lower() or None,
        "profile_bg_custom_url": (request.form.get("profile_bg_custom_url") or "").strip() or None,
        "name_font": (request.form.get("name_font") or "").strip().lower() or None,
        "name_effect": (request.form.get("name_effect") or "").strip().lower() or None,
        "avatar_fx": (request.form.get("avatar_fx") or "").strip().lower() or None,
        "avatar_frame": (request.form.get("avatar_frame") or "").strip().lower() or None,
        "banner_fx": (request.form.get("banner_fx") or "").strip().lower() or None,
        "name_color": (request.form.get("name_color") or "").strip().lower() or None,
        "name_gradient": (request.form.get("name_gradient") or "").strip().lower() or None,
        "name_tag": (request.form.get("name_tag") or "").strip().lower() or None,
        "avatar_aura": (request.form.get("avatar_aura") or "").strip().lower() or None,
        "card_frame": (request.form.get("card_frame") or "").strip().lower() or None,
        "card_frame_dm": (request.form.get("card_frame_dm") or "").strip().lower() or None,
        "card_frame_guild": (request.form.get("card_frame_guild") or "").strip().lower() or None,
        "role_gradient": (request.form.get("role_gradient") or "").strip().lower() or None,
        "badge_showcase": (request.form.get("badge_showcase") or "").strip() or None,
    }
    # Optional custom profile banner image (free)
    banner_reset = (request.form.get("profile_bg_custom_reset") or "").strip().lower() in {"1", "true", "yes"}
    banner_file = request.files.get("profile_bg_image")
    if banner_reset:
        incoming_cos["profile_bg_custom_url"] = ""
        if (incoming_cos.get("profile_bg_mode") or "").lower() == "custom":
            incoming_cos["profile_bg_mode"] = "preset"
    if banner_file and getattr(banner_file, "filename", ""):
        bname = secure_filename(banner_file.filename)
        bext = os.path.splitext(bname)[1].lower()
        if bext not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            return jsonify({"error": "Недопустимый формат баннера"}), 400
        try:
            banner_file.stream.seek(0, os.SEEK_END)
            bsize = int(banner_file.stream.tell() or 0)
            banner_file.stream.seek(0)
        except Exception:
            bsize = 0
        if bsize > 8 * 1024 * 1024:
            return jsonify({"error": "Баннер слишком большой (макс 8 МБ)"}), 413
        banner_dir = os.path.join(app.static_folder, "profile_banners")
        os.makedirs(banner_dir, exist_ok=True)
        try:
            pref = f"user_{int(current_user.id)}_"
            for fn in os.listdir(banner_dir):
                if fn.startswith(pref):
                    try:
                        os.remove(os.path.join(banner_dir, fn))
                    except Exception:
                        pass
        except Exception:
            pass
        new_bn = f"user_{int(current_user.id)}_{uuid.uuid4().hex[:8]}{bext}"
        banner_path = os.path.join(banner_dir, new_bn)
        banner_file.save(banner_path)
        incoming_cos["profile_bg_custom_url"] = url_for("static", filename=f"profile_banners/{new_bn}")
        incoming_cos["profile_bg_mode"] = "custom"

    try:
        cosmetics = _set_user_cosmetics(current_user, incoming_cos)
    except Exception:
        cosmetics = _get_user_cosmetics(current_user)

    incoming_showcase = {
        "tagline": (request.form.get("showcase_tagline") or "").strip(),
        "favorite_game": (request.form.get("showcase_favorite_game") or "").strip(),
        "about": (request.form.get("showcase_about") or "").strip(),
    }
    try:
        showcase = _set_user_showcase(current_user, incoming_showcase)
    except Exception:
        showcase = _get_user_showcase(current_user)

    file = request.files.get("avatar")
    avatar_url = None
    if file and file.filename:
        filename = secure_filename(file.filename)
        ext = os.path.splitext(filename)[1].lower()
        if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            return jsonify({"error": "Недопустимый формат файла"}), 400
        avatar_dir = os.path.join(app.static_folder, "avatars")
        os.makedirs(avatar_dir, exist_ok=True)
        new_name = f"user_{current_user.id}{ext}"
        path = os.path.join(avatar_dir, new_name)
        file.save(path)
        avatar_url = url_for("static", filename=f"avatars/{new_name}")
        current_user.avatar_url = avatar_url

    db.session.commit()
    try:
        socketio.emit("user_profile_cosmetics_updated", {"user_id": int(current_user.id)})
    except Exception:
        pass
    try:
        socketio.emit("user_profile_public_updated", {
            "user_id": int(current_user.id),
            "username": current_user.username or "",
            "display_name": (getattr(current_user, "display_name", None) or current_user.username or ""),
            "avatar_url": current_user.avatar_url or avatar_url or "",
            "status": (current_user.status or "offline")
        }, broadcast=True)
    except Exception:
        pass
    return jsonify(
        {
            "success": True,
            "status": current_user.status_text or "",
            "activity": getattr(current_user, "activity_text", "") or "",
            "avatar_url": current_user.avatar_url or avatar_url or "",
            "cosmetics": cosmetics,
            "showcase": showcase,
        }
    )




# ===== Billing / subscriptions API (MVP) =====

@app.route("/api/billing/plans")
@login_required
def api_billing_plans():
    plans = (
        SubscriptionPlan.query
        .filter(SubscriptionPlan.is_active == True)
        .order_by(SubscriptionPlan.sort_order.asc(), SubscriptionPlan.id.asc())
        .all()
    )
    return jsonify({
        "provider": _billing_provider_name(),
        "plans": [_billing_plan_public(p) for p in plans],
    })


@app.route("/api/billing/me")
@login_required
def api_billing_me():
    return jsonify(_billing_summary_for_user(int(current_user.id), include_payments=True))



@app.route("/api/billing/gifts/preview")
@login_required
def api_billing_gifts_preview():
    """Lightweight gift preview for message embeds (no HTML parsing)."""
    raw = request.args.get('code', '')
    code = _gift_normalize_code(str(raw or ''))
    if not code:
        return jsonify({'error': 'code обязателен'}), 400

    gift = SubscriptionGift.query.filter_by(code=code).first()
    if not gift:
        return jsonify({'error': 'gift_not_found'}), 404

    now = datetime.utcnow()
    # auto-expire on read
    try:
        if getattr(gift, 'status', 'active') == 'active' and gift.expires_at and gift.expires_at <= now:
            gift.status = 'expired'
            db.session.commit()
    except Exception:
        db.session.rollback()

    status = getattr(gift, 'status', 'active') or 'active'
    is_active = bool(status == 'active' and (not gift.expires_at or gift.expires_at > now))
    intended_only = bool(getattr(gift, 'to_user_id', None))
    intended_ok = bool((not intended_only) or (int(gift.to_user_id) == int(current_user.id)))

    can_redeem = bool(is_active and intended_ok)
    reason = ''
    if not is_active:
        if status == 'redeemed':
            reason = 'Уже активирован'
        elif status == 'revoked':
            reason = 'Отозван'
        elif status == 'expired':
            reason = 'Истёк'
        else:
            reason = 'Недоступен'
    elif not intended_ok:
        reason = 'Подарок не для тебя'

    out = _gift_public(gift, include_code=False)
    return jsonify({
        'success': True,
        'gift': out,
        'flags': {
            'is_active': is_active,
            'intended_only': intended_only,
            'intended_ok': intended_ok,
            'can_redeem': can_redeem,
            'reason': reason,
        }
    })

@app.route("/api/billing/gifts")
@login_required
def api_billing_gifts():
    now = datetime.utcnow()
    # auto-expire old gifts
    try:
        for g in SubscriptionGift.query.filter(SubscriptionGift.status == 'active').filter(SubscriptionGift.expires_at.isnot(None)).all():
            if g.expires_at and g.expires_at <= now:
                g.status = 'expired'
        db.session.commit()
    except Exception:
        db.session.rollback()

    given = (
        SubscriptionGift.query
        .filter(SubscriptionGift.from_user_id == int(current_user.id))
        .order_by(SubscriptionGift.id.desc())
        .limit(50)
        .all()
    )
    received = (
        SubscriptionGift.query
        .filter(or_(SubscriptionGift.to_user_id == int(current_user.id), SubscriptionGift.redeemed_by_user_id == int(current_user.id)))
        .order_by(SubscriptionGift.id.desc())
        .limit(50)
        .all()
    )
    return jsonify({
        'given': [_gift_public(g, include_code=True) for g in given],
        'received': [_gift_public(g, include_code=False) for g in received],
    })


@app.route("/api/billing/gifts/create", methods=["POST"])
@login_required
def api_billing_gifts_create():
    data = request.get_json(silent=True) or {}
    plan_code = str(data.get('plan_code') or '').strip().lower()
    if not plan_code:
        return jsonify({'error': 'plan_code обязателен'}), 400

    plan = SubscriptionPlan.query.filter_by(code=plan_code, is_active=True).first()
    if not plan or plan.code == 'free':
        return jsonify({'error': 'Тариф для подарка не найден'}), 404

    to_user_id = data.get('to_user_id')
    try:
        to_uid = int(to_user_id) if to_user_id not in (None, '', 0, '0') else None
    except Exception:
        to_uid = None

    if to_uid and to_uid != int(current_user.id):
        if not _are_friends(int(current_user.id), int(to_uid)):
            return jsonify({'error': 'Можно дарить только друзьям'}), 403

    msg = str(data.get('message') or '').strip()
    if len(msg) > 200:
        msg = msg[:200]

    now = datetime.utcnow()
    # gifts live 365 days by default
    expires_at = now + timedelta(days=365)

    code = None
    for _ in range(10):
        c = _gift_generate_code()
        if not SubscriptionGift.query.filter_by(code=c).first():
            code = c
            break
    if not code:
        return jsonify({'error': 'Не удалось создать код подарка'}), 500

    gift = SubscriptionGift(
        code=code,
        from_user_id=int(current_user.id),
        to_user_id=int(to_uid) if to_uid else None,
        plan_id=int(plan.id),
        status='active',
        message=msg,
        expires_at=expires_at,
    )
    db.session.add(gift)
    db.session.flush()

    # log purchase on giver side (mock/provider)
    provider = _billing_provider_name()
    pay = BillingPayment(
        user_id=int(current_user.id),
        subscription_id=None,
        plan_id=int(plan.id),
        provider=(provider or 'mock'),
        provider_payment_id=f"{provider or 'mock'}_gift_{current_user.id}_{int(gift.id)}_{int(now.timestamp())}",
        amount_minor=int(getattr(plan, 'price_minor', 0) or 0),
        currency=(getattr(plan, 'currency', 'RUB') or 'RUB'),
        status='succeeded' if (provider == 'mock') else 'pending',
        payload_json=json.dumps({
            'type': 'gift_purchase',
            'gift_id': int(gift.id),
            'gift_code': code,
            'plan_code': plan.code,
            'to_user_id': int(to_uid) if to_uid else None,
        }, ensure_ascii=False),
        paid_at=now if (provider == 'mock') else None,
    )
    db.session.add(pay)

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'db_error'}), 500

    out = _gift_public(gift, include_code=True)

    # realtime ping to recipient (if targeted)
    try:
        if to_uid:
            _emit_to_user(int(to_uid), 'gift_received', {
                'gift': _gift_public(gift, include_code=False),
                'from_user_id': int(current_user.id),
            })
    except Exception:
        pass

    return jsonify({'success': True, 'gift': out})


@app.route("/api/billing/gifts/redeem", methods=["POST"])
@login_required
def api_billing_gifts_redeem():
    data = request.get_json(silent=True) or {}
    raw = data.get('code')
    code = _gift_normalize_code(str(raw or ''))
    if not code:
        return jsonify({'error': 'code обязателен'}), 400

    gift = SubscriptionGift.query.filter_by(code=code).first()
    if not gift:
        return jsonify({'error': 'Подарок не найден'}), 404

    now = datetime.utcnow()
    if getattr(gift, 'status', 'active') != 'active':
        return jsonify({'error': 'Подарок уже использован или недоступен'}), 400

    if gift.expires_at and gift.expires_at <= now:
        try:
            gift.status = 'expired'
            db.session.commit()
        except Exception:
            db.session.rollback()
        return jsonify({'error': 'Срок подарка истёк'}), 400

    if gift.to_user_id and int(gift.to_user_id) != int(current_user.id):
        return jsonify({'error': 'Этот подарок предназначен другому пользователю'}), 403

    plan = db.session.get(SubscriptionPlan, int(gift.plan_id)) if getattr(gift, 'plan_id', None) else None
    if not plan or not getattr(plan, 'is_active', True) or plan.code == 'free':
        return jsonify({'error': 'Тариф недоступен'}), 400

    try:
        _billing_apply_gift_to_user(int(current_user.id), plan, gift)
        gift.status = 'redeemed'
        gift.redeemed_at = now
        gift.redeemed_by_user_id = int(current_user.id)
        if not gift.to_user_id:
            gift.to_user_id = int(current_user.id)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Не удалось активировать подарок'}), 500

    # notify giver
    try:
        _emit_to_user(int(gift.from_user_id), 'gift_redeemed', {
            'gift_id': int(gift.id),
            'by_user_id': int(current_user.id),
            'plan_code': plan.code,
        })
    except Exception:
        pass

    return jsonify({'success': True, 'billing': _billing_summary_for_user(int(current_user.id), include_payments=True)})


@app.route("/api/billing/gifts/<int:gift_id>/revoke", methods=["POST"])
@login_required
def api_billing_gifts_revoke(gift_id: int):
    g = db.session.get(SubscriptionGift, int(gift_id))
    if not g or int(getattr(g, 'from_user_id', 0) or 0) != int(current_user.id):
        return jsonify({'error': 'gift_not_found'}), 404
    if getattr(g, 'status', 'active') != 'active':
        return jsonify({'error': 'gift_not_active'}), 400
    try:
        g.status = 'revoked'
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'db_error'}), 500
    return jsonify({'success': True})


@app.route("/api/billing/subscribe", methods=["POST"])
@login_required
def api_billing_subscribe():
    data = request.get_json(silent=True) or {}
    plan_code = str(data.get("plan_code") or "").strip().lower()
    if not plan_code:
        return jsonify({"error": "plan_code обязателен"}), 400

    plan = SubscriptionPlan.query.filter_by(code=plan_code, is_active=True).first()
    if not plan:
        return jsonify({"error": "Тариф не найден"}), 404

    # Choosing Free works as a downgrade/cancel.
    if plan.code == "free":
        active_sub, _ = _billing_get_active_subscription(int(current_user.id))
        if active_sub:
            try:
                now = datetime.utcnow()
                active_sub.status = "canceled"
                active_sub.cancel_at_period_end = False
                active_sub.canceled_at = now
                active_sub.ended_at = now
                db.session.commit()
            except Exception:
                db.session.rollback()
                return jsonify({"error": "Не удалось переключить тариф"}), 500
        return jsonify({"success": True, "billing": _billing_summary_for_user(int(current_user.id), include_payments=True)})

    provider = _billing_provider_name()
    if provider != "mock":
        return jsonify({
            "error": "Для этого провайдера используйте checkout/create",
            "provider": provider,
            "checkout_required": True,
        }), 409

    try:
        billing = _billing_activate_plan_and_payment(
            int(current_user.id),
            plan,
            provider="mock",
            provider_subscription_id=f"mock_sub_{current_user.id}_{int(time.time())}",
            provider_payment_id=f"mock_pay_{current_user.id}_{int(time.time())}",
            amount_minor=int(getattr(plan, "price_minor", 0) or 0),
            currency=(getattr(plan, "currency", "RUB") or "RUB"),
            payload={"mode": "mock", "plan_code": plan.code},
        )
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось активировать подписку"}), 500

    return jsonify({"success": True, "billing": billing})


@app.route("/api/billing/cancel", methods=["POST"])
@login_required
def api_billing_cancel():
    sub, plan = _billing_get_active_subscription(int(current_user.id))
    if not sub or not plan or plan.code == "free":
        return jsonify({"error": "Нет активной подписки"}), 400
    try:
        sub.cancel_at_period_end = True
        sub.canceled_at = datetime.utcnow()
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось отменить подписку"}), 500
    return jsonify({"success": True, "billing": _billing_summary_for_user(int(current_user.id), include_payments=True)})


@app.route("/api/billing/resume", methods=["POST"])
@login_required
def api_billing_resume():
    sub, plan = _billing_get_active_subscription(int(current_user.id))
    if not sub or not plan or plan.code == "free":
        return jsonify({"error": "Нет активной подписки"}), 400
    try:
        sub.cancel_at_period_end = False
        sub.canceled_at = None
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось возобновить подписку"}), 500
    return jsonify({"success": True, "billing": _billing_summary_for_user(int(current_user.id), include_payments=True)})


@app.route("/api/billing/checkout/create", methods=["POST"])
@login_required
def api_billing_checkout_create():
    data = request.get_json(silent=True) or {}
    plan_code = str(data.get("plan_code") or "").strip().lower()
    if not plan_code:
        return jsonify({"error": "plan_code обязателен"}), 400
    plan = SubscriptionPlan.query.filter_by(code=plan_code, is_active=True).first()
    if not plan:
        return jsonify({"error": "Тариф не найден"}), 404
    if plan.code == "free":
        return jsonify({"error": "Для бесплатного тарифа checkout не нужен"}), 400
    try:
        out = _billing_create_checkout_for_user(current_user, plan)
        return jsonify({"success": True, **out})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e), "provider": _billing_provider_name()}), 501
    except Exception as e:
        return jsonify({"error": f"checkout error: {e}"}), 500


@app.route("/api/billing/webhook/<provider>", methods=["POST"])
def api_billing_webhook(provider):
    provider = str(provider or "").strip().lower()
    payload = request.get_json(silent=True) or {}

    if provider == "mock":
        app.logger.info("[billing webhook mock] %s", json.dumps(payload, ensure_ascii=False))
        return jsonify({"ok": True, "provider": provider})

    if provider == "yookassa":
        # NOTE: add signature validation on production if you expose this endpoint publicly.
        event = str(payload.get("event") or "").strip()
        obj = payload.get("object") or {}
        pay_id = str(obj.get("id") or "").strip()
        status = str(obj.get("status") or "").strip()
        meta = obj.get("metadata") or {}
        try:
            meta_user_id = int(str(meta.get("user_id") or "0"))
        except Exception:
            meta_user_id = 0
        meta_plan_code = str(meta.get("plan_code") or "").strip().lower()

        if not pay_id:
            return jsonify({"error": "payment id missing"}), 400

        pay = BillingPayment.query.filter_by(provider="yookassa", provider_payment_id=pay_id).first()
        if pay and not meta_user_id:
            try: meta_user_id = int(pay.user_id or 0)
            except Exception: meta_user_id = 0
        if pay and not meta_plan_code:
            try:
                plan_from_pay = db.session.get(SubscriptionPlan, int(pay.plan_id)) if getattr(pay, "plan_id", None) else None
                meta_plan_code = str(getattr(plan_from_pay, "code", "") or "").strip().lower()
            except Exception:
                meta_plan_code = meta_plan_code or ""

        # Upsert/track payment row even before success
        if not pay and meta_user_id:
            plan_for_pending = SubscriptionPlan.query.filter_by(code=meta_plan_code).first() if meta_plan_code else None
            amount_minor = 0
            try:
                amount_minor = int(round(float(str((obj.get("amount") or {}).get("value") or "0").replace(",", ".")) * 100))
            except Exception:
                amount_minor = int(getattr(plan_for_pending, "price_minor", 0) or 0)
            pay = BillingPayment(
                user_id=int(meta_user_id),
                subscription_id=None,
                plan_id=int(plan_for_pending.id) if plan_for_pending else None,
                provider="yookassa",
                provider_payment_id=pay_id,
                amount_minor=amount_minor,
                currency=((obj.get("amount") or {}).get("currency") or getattr(plan_for_pending, "currency", "RUB") or "RUB"),
                status=(status or "pending"),
                payload_json=json.dumps(payload, ensure_ascii=False),
                paid_at=None,
            )
            db.session.add(pay)
            db.session.commit()

        if event == "payment.succeeded" or status == "succeeded":
            if not meta_user_id or not meta_plan_code:
                return jsonify({"error": "metadata user_id/plan_code required"}), 400
            plan = SubscriptionPlan.query.filter_by(code=meta_plan_code, is_active=True).first()
            if not plan:
                return jsonify({"error": "unknown plan"}), 404
            try:
                amount_minor = int(round(float(str((obj.get("amount") or {}).get("value") or "0").replace(",", ".")) * 100))
            except Exception:
                amount_minor = int(getattr(plan, "price_minor", 0) or 0)
            try:
                billing = _billing_activate_plan_and_payment(
                    int(meta_user_id),
                    plan,
                    provider="yookassa",
                    provider_subscription_id=f"yookassa_sub_{meta_user_id}_{plan.code}",
                    provider_payment_id=pay_id,
                    amount_minor=amount_minor,
                    currency=((obj.get("amount") or {}).get("currency") or getattr(plan, "currency", "RUB") or "RUB"),
                    payload=payload,
                )
            except Exception as e:
                db.session.rollback()
                return jsonify({"error": f"activation failed: {e}"}), 500
            return jsonify({"ok": True, "provider": "yookassa", "activated": True, "billing": billing})

        if pay:
            try:
                pay.status = (status or event or "pending")[:32]
                pay.payload_json = json.dumps(payload, ensure_ascii=False)
                db.session.commit()
            except Exception:
                db.session.rollback()
        return jsonify({"ok": True, "provider": "yookassa", "event": event or status})

    return jsonify({"ok": True, "provider": provider, "note": "no handler"})



# ===== Account settings API (My Account) =====

@app.route("/api/account/me")
@login_required
def api_account_me():
    return jsonify({
        "user_id": int(current_user.id),
        "username": current_user.username,
        "display_name": (getattr(current_user, "display_name", "") or current_user.username),
        "email": current_user.email or "",
        "phone": getattr(current_user, "phone", None) or "",
        "email_verified": bool(getattr(current_user, "email_verified", False)),
        "reputation_level": int(getattr(current_user, "reputation_level", 0) or 0),
        "recovery_redownload_left": int(getattr(current_user, "recovery_redownload_left", 0) or 0),
        "billing": _billing_summary_for_user(int(current_user.id), include_payments=False),
        "cosmetics": _get_user_cosmetics(current_user),
        "showcase": _get_user_showcase(current_user),
    })


# ===== Settings KV Sync (persist localStorage 'nc_*' keys in DB) =====
def _get_settings_kv(u: User) -> dict:
    raw = getattr(u, "settings_kv", None) or "{}"
    if not isinstance(raw, str):
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def _save_settings_kv(u: User, kv: dict) -> None:
    # Compact JSON to reduce DB size.
    try:
        raw = json.dumps(kv, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        raw = "{}"
    # Hard safety cap (prevents accidentally storing huge payloads)
    if len(raw) > 200_000:
        raise ValueError("settings payload too large")
    u.settings_kv = raw




def _get_user_showcase(u: User) -> dict:
    kv = _get_settings_kv(u)
    raw = kv.get("profile_showcase") or {}
    if not isinstance(raw, dict):
        raw = {}
    out = {
        "tagline": str(raw.get("tagline") or "")[:90],
        "favorite_game": str(raw.get("favorite_game") or "")[:70],
        "about": str(raw.get("about") or "")[:280],
    }
    return out

def _set_user_showcase(u: User, incoming: dict) -> dict:
    incoming = incoming or {}
    kv = _get_settings_kv(u)
    cur = _get_user_showcase(u)

    def _clean(v, n):
        v = str(v or "").strip()
        return v[:n]

    if "tagline" in incoming:
        cur["tagline"] = _clean(incoming.get("tagline"), 90)
    if "favorite_game" in incoming:
        cur["favorite_game"] = _clean(incoming.get("favorite_game"), 70)
    if "about" in incoming:
        cur["about"] = _clean(incoming.get("about"), 280)

    if any(cur.values()):
        kv["profile_showcase"] = cur
    else:
        kv.pop("profile_showcase", None)
    _save_settings_kv(u, kv)
    return cur

_NC_PROFILE_BG_PRESETS = {
    "default": "linear-gradient(135deg, rgba(122,243,255,0.16), rgba(255,124,251,0.16))",
    "purple": "linear-gradient(135deg, rgba(119,72,255,0.34), rgba(255,110,230,0.28))",
    "ocean": "linear-gradient(135deg, rgba(0,208,255,0.22), rgba(94,117,255,0.24))",
    "sunset": "linear-gradient(135deg, rgba(255,136,64,0.26), rgba(255,74,170,0.24))",
    "emerald": "linear-gradient(135deg, rgba(31,220,141,0.22), rgba(0,196,255,0.18))",
    "gold": "linear-gradient(135deg, rgba(255,211,77,0.26), rgba(255,153,0,0.20))",
    "rose": "linear-gradient(135deg, rgba(255,98,177,0.24), rgba(167,139,250,0.22))",
    "aurora": "linear-gradient(135deg, rgba(92,255,190,0.18), rgba(78,155,255,0.20), rgba(191,112,255,0.18))",
    "midnight": "linear-gradient(135deg, rgba(40,55,110,0.26), rgba(18,21,36,0.32), rgba(95,74,170,0.20))",
    "crimson": "linear-gradient(135deg, rgba(255,82,110,0.25), rgba(125,20,50,0.22))",
    "ice": "linear-gradient(135deg, rgba(190,245,255,0.24), rgba(126,170,255,0.18))",
    "synthwave": "linear-gradient(135deg, rgba(255,59,146,0.22), rgba(124,58,237,0.22), rgba(34,211,238,0.18))",
    "lava": "linear-gradient(135deg, rgba(255,90,31,0.24), rgba(255,195,0,0.20), rgba(140,0,0,0.18))",
    "forest": "linear-gradient(135deg, rgba(34,197,94,0.20), rgba(20,83,45,0.24), rgba(56,189,248,0.14))",
    "obsidian": "linear-gradient(135deg, rgba(30,30,38,0.26), rgba(70,70,85,0.16), rgba(130,130,150,0.12))",
    "berry": "linear-gradient(135deg, rgba(236,72,153,0.22), rgba(147,51,234,0.20), rgba(59,130,246,0.14))",
    "toxic": "linear-gradient(135deg, rgba(163,255,58,0.18), rgba(39,39,42,0.24), rgba(34,197,94,0.16))",
}
_NC_BANNER_FX = {"none", "sparkle", "scanline", "pulse", "stars", "confetti", "flame", "matrix", "nebula", "glowlines", "snow", "hex"}
_NC_NAME_COLORS = {"none", "cyan", "pink", "gold", "lime", "violet", "white", "sunset", "ice", "toxic", "royal", "crimson"}
_NC_NAME_GRADIENTS = {"none", "aurora", "sunset", "discord", "neon", "icefire", "emerald", "cotton", "royal", "lava", "mono", "cyber"}

_NC_NAME_FONTS = {"default", "bold", "rounded", "mono", "serif", "wide", "compact", "script", "cyber", "pixel"}
_NC_NAME_EFFECTS = {"none", "glow", "gradient", "chrome", "neonblue", "neonpink", "rainbow", "fire", "ice", "toxic", "shimmer", "outline"}
_NC_NAME_TAGS = {"none", "vip", "pro", "plus", "dev", "mod", "crew", "neon", "g4s", "boss", "lvl"}
_NC_AVATAR_FX = {"none", "flame", "spark", "crown", "neon", "wings", "diamond", "heart", "skull", "moon", "leaf", "shield", "star", "glitch"}
_NC_AVATAR_FRAMES = {"none", "pulse", "orbit", "prism", "ember", "frost", "toxic", "royal", "glitch", "starlight", "vortex", "flora"}

_NC_AVATAR_AURAS = {"none", "pulse", "plasma", "lightning", "frost", "sakura", "shadow", "halo", "matrix", "solar", "void", "glitch"}
_NC_CARD_FRAMES = {"none", "bronze", "silver", "gold", "platinum", "diamond", "royal", "obsidian", "cyber", "ember", "flora", "mythic"}
_NC_ROLE_GRADIENTS = {"none", "violet", "cyan", "sunset", "gold", "toxic", "rose", "ocean", "ember", "aurora", "midnight", "discord"}
_NC_SHOWCASE_BADGES = {"none", "crown", "flame", "diamond", "star", "moon", "skull", "heart", "leaf", "bolt", "music", "game", "ghost", "rocket", "shield", "ice", "toxic", "sun", "cat", "code"}

def _nc_safe_profile_banner_url(v: str | None) -> str:
    v = (v or "").strip()
    if not v:
        return ""
    if not v.startswith("/static/profile_banners/"):
        return ""
    if ".." in v or "\\" in v or '"' in v or "'" in v:
        return ""
    return v

def _nc_profile_banner_css(bg_key: str, custom_url: str = "") -> str:
    base = _NC_PROFILE_BG_PRESETS.get(bg_key) or _NC_PROFILE_BG_PRESETS["default"]
    safe = _nc_safe_profile_banner_url(custom_url)
    if not safe:
        return base
    return f"{base}, url({safe}) center/cover no-repeat"

def _get_user_cosmetics(u: User) -> dict:
    kv = _get_settings_kv(u)
    raw = kv.get("profile_cosmetics") or {}
    if not isinstance(raw, dict):
        raw = {}
    bg = str(raw.get("profile_bg") or "default").strip().lower()
    bg_mode = str(raw.get("profile_bg_mode") or "preset").strip().lower()
    bg_custom_url = _nc_safe_profile_banner_url(raw.get("profile_bg_custom_url") or "")
    name_font = str(raw.get("name_font") or "default").strip().lower()
    name_effect = str(raw.get("name_effect") or "none").strip().lower()
    avatar_fx = str(raw.get("avatar_fx") or "none").strip().lower()
    avatar_frame = str(raw.get("avatar_frame") or "none").strip().lower()
    banner_fx = str(raw.get("banner_fx") or "none").strip().lower()
    name_color = str(raw.get("name_color") or "none").strip().lower()
    name_gradient = str(raw.get("name_gradient") or "none").strip().lower()
    name_tag = str(raw.get("name_tag") or "none").strip().lower()
    avatar_aura = str(raw.get("avatar_aura") or "none").strip().lower()
    card_frame = str(raw.get("card_frame") or "none").strip().lower()
    card_frame_dm = str(raw.get("card_frame_dm") or card_frame or "none").strip().lower()
    card_frame_guild = str(raw.get("card_frame_guild") or card_frame or "none").strip().lower()
    role_gradient = str(raw.get("role_gradient") or "none").strip().lower()
    raw_badges = raw.get("badge_showcase") or []
    if isinstance(raw_badges, str):
        raw_badges = [x.strip().lower() for x in raw_badges.split(",")]
    if not isinstance(raw_badges, list):
        raw_badges = []
    badge_showcase = []
    _seen_badges = set()
    for _b in raw_badges:
        try:
            _key = str(_b or "").strip().lower()
        except Exception:
            _key = ""
        if (not _key) or (_key == "none") or (_key in _seen_badges) or (_key not in _NC_SHOWCASE_BADGES):
            continue
        _seen_badges.add(_key)
        badge_showcase.append(_key)
        if len(badge_showcase) >= 3:
            break
    if bg not in _NC_PROFILE_BG_PRESETS:
        bg = "default"
    if bg_mode not in {"preset", "custom"}:
        bg_mode = "preset"
    if bg_mode == "custom" and not bg_custom_url:
        bg_mode = "preset"
    if name_font not in _NC_NAME_FONTS:
        name_font = "default"
    if name_effect not in _NC_NAME_EFFECTS:
        name_effect = "none"
    if avatar_fx not in _NC_AVATAR_FX:
        avatar_fx = "none"
    if avatar_frame not in _NC_AVATAR_FRAMES:
        avatar_frame = "none"
    if avatar_aura not in _NC_AVATAR_AURAS:
        avatar_aura = "none"
    if card_frame not in _NC_CARD_FRAMES:
        card_frame = "none"
    if role_gradient not in _NC_ROLE_GRADIENTS:
        role_gradient = "none"
    if banner_fx not in _NC_BANNER_FX:
        banner_fx = "none"
    if name_color not in _NC_NAME_COLORS:
        name_color = "none"
    if name_tag not in _NC_NAME_TAGS:
        name_tag = "none"
    if name_gradient not in _NC_NAME_GRADIENTS:
        name_gradient = "none"
    if card_frame_dm not in _NC_CARD_FRAMES:
        card_frame_dm = card_frame if card_frame in _NC_CARD_FRAMES else "none"
    if card_frame_guild not in _NC_CARD_FRAMES:
        card_frame_guild = card_frame if card_frame in _NC_CARD_FRAMES else "none"
    return {
        "profile_bg": bg,
        "profile_bg_mode": bg_mode,
        "profile_bg_custom_url": bg_custom_url,
        "name_font": name_font,
        "name_effect": name_effect,
        "avatar_fx": avatar_fx,
        "avatar_frame": avatar_frame,
        "avatar_aura": avatar_aura,
        "card_frame": card_frame,
        "role_gradient": role_gradient,
        "badge_showcase": badge_showcase,
        "banner_fx": banner_fx,
        "name_color": name_color,
        "name_gradient": name_gradient,
        "name_tag": name_tag,
        "card_frame_dm": card_frame_dm,
        "card_frame_guild": card_frame_guild,
        "profile_bg_css": _nc_profile_banner_css(bg, bg_custom_url if bg_mode == "custom" else ""),
    }

def _set_user_cosmetics(u: User, incoming: dict) -> dict:
    if not isinstance(incoming, dict):
        incoming = {}
    kv = _get_settings_kv(u)
    cur = _get_user_cosmetics(u)

    bg = str(incoming.get("profile_bg", cur.get("profile_bg", "default")) or "default").strip().lower()
    bg_mode = str(incoming.get("profile_bg_mode", cur.get("profile_bg_mode", "preset")) or "preset").strip().lower()
    bg_custom_url = _nc_safe_profile_banner_url(incoming.get("profile_bg_custom_url", cur.get("profile_bg_custom_url", "")) or "")
    name_font = str(incoming.get("name_font", cur.get("name_font", "default")) or "default").strip().lower()
    name_effect = str(incoming.get("name_effect", cur.get("name_effect", "none")) or "none").strip().lower()
    avatar_fx = str(incoming.get("avatar_fx", cur.get("avatar_fx", "none")) or "none").strip().lower()
    avatar_frame = str(incoming.get("avatar_frame", cur.get("avatar_frame", "none")) or "none").strip().lower()
    banner_fx = str(incoming.get("banner_fx", cur.get("banner_fx", "none")) or "none").strip().lower()
    name_color = str(incoming.get("name_color", cur.get("name_color", "none")) or "none").strip().lower()
    name_gradient = str(incoming.get("name_gradient", cur.get("name_gradient", "none")) or "none").strip().lower()
    name_tag = str(incoming.get("name_tag", cur.get("name_tag", "none")) or "none").strip().lower()
    avatar_aura = str(incoming.get("avatar_aura", cur.get("avatar_aura", "none")) or "none").strip().lower()
    card_frame = str(incoming.get("card_frame", cur.get("card_frame", "none")) or "none").strip().lower()
    card_frame_dm = str(incoming.get("card_frame_dm", cur.get("card_frame_dm", cur.get("card_frame", "none"))) or "none").strip().lower()
    card_frame_guild = str(incoming.get("card_frame_guild", cur.get("card_frame_guild", cur.get("card_frame", "none"))) or "none").strip().lower()
    role_gradient = str(incoming.get("role_gradient", cur.get("role_gradient", "none")) or "none").strip().lower()
    raw_badges = incoming.get("badge_showcase", cur.get("badge_showcase", []))
    if isinstance(raw_badges, str):
        raw_badges = [x.strip().lower() for x in raw_badges.split(",")]
    if not isinstance(raw_badges, list):
        raw_badges = []
    badge_showcase = []
    _seen_badges = set()
    for _b in raw_badges:
        try:
            _key = str(_b or "").strip().lower()
        except Exception:
            _key = ""
        if (not _key) or (_key == "none") or (_key in _seen_badges) or (_key not in _NC_SHOWCASE_BADGES):
            continue
        _seen_badges.add(_key)
        badge_showcase.append(_key)
        if len(badge_showcase) >= 3:
            break

    if bg not in _NC_PROFILE_BG_PRESETS:
        bg = "default"
    if bg_mode not in {"preset", "custom"}:
        bg_mode = "preset"
    if bg_mode == "custom" and not bg_custom_url:
        bg_mode = "preset"
    if name_font not in _NC_NAME_FONTS:
        name_font = "default"
    if name_effect not in _NC_NAME_EFFECTS:
        name_effect = "none"
    if avatar_fx not in _NC_AVATAR_FX:
        avatar_fx = "none"
    if avatar_frame not in _NC_AVATAR_FRAMES:
        avatar_frame = "none"
    if avatar_aura not in _NC_AVATAR_AURAS:
        avatar_aura = "none"
    if card_frame not in _NC_CARD_FRAMES:
        card_frame = "none"
    if role_gradient not in _NC_ROLE_GRADIENTS:
        role_gradient = "none"
    if banner_fx not in _NC_BANNER_FX:
        banner_fx = "none"
    if name_color not in _NC_NAME_COLORS:
        name_color = "none"
    if name_tag not in _NC_NAME_TAGS:
        name_tag = "none"
    if name_gradient not in _NC_NAME_GRADIENTS:
        name_gradient = "none"
    if card_frame_dm not in _NC_CARD_FRAMES:
        card_frame_dm = card_frame if card_frame in _NC_CARD_FRAMES else "none"
    if card_frame_guild not in _NC_CARD_FRAMES:
        card_frame_guild = card_frame if card_frame in _NC_CARD_FRAMES else "none"

    premium_ok = bool(
        _billing_has_feature(int(u.id), "profile_badge")
        or _billing_has_feature(int(u.id), "name_styles")
        or _billing_has_feature(int(u.id), "avatar_decor")
    )
    if not premium_ok:
        name_font = "default"
        name_effect = "none"
        avatar_fx = "none"
        avatar_frame = "none"
        avatar_aura = "none"
        card_frame = "none"
        role_gradient = "none"
        badge_showcase = []
        banner_fx = "none"
        name_color = "none"
        name_tag = "none"
        name_gradient = "none"
        card_frame_dm = "none"
        card_frame_guild = "none"

    kv["profile_cosmetics"] = {
        "profile_bg": bg,
        "profile_bg_mode": bg_mode,
        "profile_bg_custom_url": bg_custom_url,
        "name_font": name_font,
        "name_effect": name_effect,
        "avatar_fx": avatar_fx,
        "avatar_frame": avatar_frame,
        "avatar_aura": avatar_aura,
        "card_frame": card_frame,
        "role_gradient": role_gradient,
        "badge_showcase": badge_showcase,
        "banner_fx": banner_fx,
        "name_color": name_color,
        "name_gradient": name_gradient,
        "name_tag": name_tag,
        "card_frame_dm": card_frame_dm,
        "card_frame_guild": card_frame_guild,
    }
    _save_settings_kv(u, kv)
    return _get_user_cosmetics(u)

@app.route("/api/settings_kv")
@login_required
def api_settings_kv_get():
    return jsonify({"settings": _get_settings_kv(current_user)})

@app.route("/api/settings_kv", methods=["POST"])
@login_required
def api_settings_kv_patch():
    data = request.get_json(silent=True) or {}
    patch = data.get("patch") or {}
    if not isinstance(patch, dict):
        return jsonify({"error": "patch must be an object"}), 400

    kv = _get_settings_kv(current_user)
    changed = False

    for k, v in patch.items():
        try:
            k = str(k)
        except Exception:
            continue
        if not k or len(k) > 128:
            continue
        # Only allow reasonably-safe key chars (matches typical localStorage keys)
        if not re.match(r"^[a-zA-Z0-9_:\\-\\.]+$", k):
            continue

        if v is None:
            if k in kv:
                del kv[k]
                changed = True
            continue
        # Store as string (same as localStorage). Keep size sane.
        try:
            sv = str(v)
        except Exception:
            continue
        if len(sv) > 20_000:
            continue
        if kv.get(k) != sv:
            kv[k] = sv
            changed = True

    if changed:
        try:
            _save_settings_kv(current_user, kv)
            db.session.commit()
        except ValueError:
            db.session.rollback()
            return jsonify({"error": "settings too large"}), 413
        except Exception:
            db.session.rollback()
            return jsonify({"error": "failed to save"}), 500

    return jsonify({"success": True})

@app.route("/api/profile/cosmetics", methods=["GET", "POST"])
@login_required
def api_profile_cosmetics():
    if request.method == "GET":
        return jsonify({"cosmetics": _get_user_cosmetics(current_user)})
    data = request.get_json(silent=True) or {}
    cos = _set_user_cosmetics(current_user, data if isinstance(data, dict) else {})
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось сохранить оформление"}), 500
    try:
        socketio.emit("user_profile_cosmetics_updated", {"user_id": int(current_user.id)})
    except Exception:
        pass
    try:
        socketio.emit("user_profile_public_updated", {
            "user_id": int(current_user.id),
            "username": current_user.username or "",
            "display_name": (getattr(current_user, "display_name", None) or current_user.username or ""),
            "avatar_url": current_user.avatar_url or "",
            "status": (current_user.status or "offline")
        }, broadcast=True)
    except Exception:
        pass
    return jsonify({"ok": True, "cosmetics": cos})

@app.route("/api/users/cosmetics", methods=["POST"])
@login_required
def api_users_cosmetics_bulk():
    data = request.get_json(silent=True) or {}
    ids = data.get("user_ids") or []
    if not isinstance(ids, list):
        return jsonify({"error": "user_ids должен быть массивом"}), 400
    safe_ids = []
    seen = set()
    for raw in ids[:200]:
        try:
            uid = int(raw)
        except Exception:
            continue
        if uid <= 0 or uid in seen:
            continue
        seen.add(uid)
        safe_ids.append(uid)
    if not safe_ids:
        return jsonify({"items": {}})
    users = User.query.filter(User.id.in_(safe_ids)).all()
    out = {}
    for u in users:
        out[str(int(u.id))] = _get_user_cosmetics(u)
    return jsonify({"items": out})

def _json_value(key: str) -> str:
    data = request.get_json(silent=True) or {}
    return (data.get(key) or "").strip()

@app.route("/api/account/update_display_name", methods=["POST"])
@login_required
def api_account_update_display_name():
    v = _json_value("value")
    if len(v) > 32:
        return jsonify({"error": "Слишком длинно (макс 32)."}), 400
    # allow empty => fallback to username
    try:
        current_user.display_name = v
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось сохранить."}), 500
    try:
        _emit_presence_update(current_user)
    except Exception:
        pass
    try:
        socketio.emit("user_profile_public_updated", {
            "user_id": int(current_user.id),
            "username": current_user.username or "",
            "display_name": (getattr(current_user, "display_name", None) or current_user.username or ""),
            "avatar_url": current_user.avatar_url or "",
            "status": (current_user.status or "offline")
        }, broadcast=True)
    except Exception:
        pass
    return jsonify({"success": True, "display_name": (current_user.display_name or current_user.username)})

@app.route("/api/account/update_username", methods=["POST"])
@login_required
def api_account_update_username():
    v = _json_value("value")
    if not v or len(v) < 3:
        return jsonify({"error": "Имя должно быть от 3 символов."}), 400
    if len(v) > 32:
        return jsonify({"error": "Слишком длинно (макс 32)."}), 400
    v_norm = _norm_username(v)
    if v_norm and v != current_user.username:
        try:
            q = User.query.filter(User.username_norm == v_norm, User.id != current_user.id)
            if q.first():
                return jsonify({"error": "Имя занято."}), 400
        except Exception:
            if User.query.filter_by(username=v).first():
                return jsonify({"error": "Имя занято."}), 400
    try:
        current_user.username = v
        try:
            current_user.username_norm = _norm_username(v)
        except Exception:
            pass
        if not (getattr(current_user, "display_name", "") or "").strip():
            current_user.display_name = v
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось сохранить."}), 500
    try:
        _emit_presence_update(current_user)
    except Exception:
        pass
    try:
        socketio.emit("user_profile_public_updated", {
            "user_id": int(current_user.id),
            "username": current_user.username or "",
            "display_name": (getattr(current_user, "display_name", None) or current_user.username or ""),
            "avatar_url": current_user.avatar_url or "",
            "status": (current_user.status or "offline")
        }, broadcast=True)
    except Exception:
        pass
    return jsonify({"success": True, "username": current_user.username})

@app.route("/api/account/update_email", methods=["POST"])
@login_required
def api_account_update_email():
    v = _json_value("value")
    if not v:
        try:
            current_user.email = None
            current_user.email_verified = False
            db.session.commit()
        except Exception:
            db.session.rollback()
            return jsonify({"error": "Не удалось сохранить."}), 500
        return jsonify({"success": True, "email": ""})

    if ("@" not in v) or ("." not in v.split("@")[-1]):
        return jsonify({"error": "Неверный email."}), 400

    # unique email is not enforced in DB; keep it permissive
    try:
        current_user.email = v
        current_user.email_verified = False
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось сохранить."}), 500

    # Optional: send verification email (silent fail)
    try:
        _send_verification_email(app, current_user)
    except Exception:
        pass

    return jsonify({"success": True, "email": current_user.email or ""})

@app.route("/api/account/update_phone", methods=["POST"])
@login_required
def api_account_update_phone():
    v = _json_value("value")
    v = v.replace(" ", "")
    if not v:
        try:
            current_user.phone = None
            db.session.commit()
        except Exception:
            db.session.rollback()
            return jsonify({"error": "Не удалось сохранить."}), 500
        return jsonify({"success": True, "phone": ""})
    if len(v) > 32:
        return jsonify({"error": "Слишком длинно."}), 400
    try:
        current_user.phone = v
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось сохранить."}), 500
    return jsonify({"success": True, "phone": current_user.phone or ""})

@app.route("/api/account/change_password", methods=["POST"])
@login_required
def api_account_change_password():
    data = request.get_json(silent=True) or {}
    cur = (data.get("current_password") or "")
    new = (data.get("new_password") or "")
    new2 = (data.get("new_password2") or "")
    if not current_user.check_password(cur):
        return jsonify({"error": "Текущий пароль неверный."}), 400
    if new2 and new != new2:
        return jsonify({"error": "Пароли не совпадают."}), 400
    if not (8 <= len(new) <= 21):
        return jsonify({"error": "Пароль должен быть от 8 до 21 символа."}), 400
    ok, msg = _validate_password(new, username=current_user.username)
    if not ok:
        return jsonify({"error": msg}), 400
    try:
        current_user.set_password(new)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось сохранить."}), 500
    return jsonify({"success": True})

# ===== 2FA (TOTP) API =====

@app.route("/api/account/2fa/status")
@login_required
def api_account_2fa_status():
    enabled = _totp_enabled_for_user(current_user)
    return jsonify({"enabled": bool(enabled)})

@app.route("/api/account/2fa/start", methods=["POST"])
@login_required
def api_account_2fa_start():
    if pyotp is None or qrcode is None:
        return jsonify({"error": "2FA не установлена на сервере (нет pyotp/qrcode)."}), 500

    # generate a new secret each time we open the setup modal
    secret = pyotp.random_base32()
    try:
        current_user.totp_temp_secret = secret
        # do not enable until confirmed
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось создать секрет."}), 500

    issuer = "Neon Chat"
    name = f"{issuer}:{current_user.username}"
    uri = pyotp.TOTP(secret).provisioning_uri(name=name, issuer_name=issuer)

    # generate QR image (PNG) and return as data URL
    try:
        img = qrcode.make(uri)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        qr_data_url = f"data:image/png;base64,{b64}"
    except Exception:
        qr_data_url = ""

    # group secret for manual typing
    secret_pretty = " ".join([secret[i:i+4].lower() for i in range(0, len(secret), 4)]).strip()
    return jsonify({"success": True, "uri": uri, "secret": secret_pretty, "qr": qr_data_url})

@app.route("/api/account/2fa/confirm", methods=["POST"])
@login_required
def api_account_2fa_confirm():
    if pyotp is None:
        return jsonify({"error": "2FA не установлена на сервере."}), 500
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip().replace(" ", "")
    secret = getattr(current_user, "totp_temp_secret", None)
    if not secret:
        return jsonify({"error": "Сначала нажми 'Включить приложение'."}), 400
    if not (code.isdigit() and len(code) == 6):
        return jsonify({"error": "Введите 6-значный код."}), 400
    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=1):
        return jsonify({"error": "Код неверный."}), 400

    try:
        current_user.totp_secret = secret
        current_user.totp_temp_secret = None
        current_user.totp_enabled = True
        current_user.totp_last_counter = -1
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось включить 2FA."}), 500

    return jsonify({"success": True, "enabled": True})

@app.route("/api/account/2fa/disable", methods=["POST"])
@login_required
def api_account_2fa_disable():
    if pyotp is None:
        return jsonify({"error": "2FA не установлена на сервере."}), 500
    if not _totp_enabled_for_user(current_user):
        return jsonify({"error": "2FA не включена."}), 400

    data = request.get_json(silent=True) or {}
    pwd = (data.get("password") or "")
    code = (data.get("code") or "")
    if not current_user.check_password(pwd):
        return jsonify({"error": "Пароль неверный."}), 400
    if not _totp_verify_and_mark(current_user, code):
        return jsonify({"error": "Код неверный."}), 400

    try:
        current_user.totp_enabled = False
        current_user.totp_secret = None
        current_user.totp_temp_secret = None
        current_user.totp_last_counter = -1
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось отключить 2FA."}), 500

    return jsonify({"success": True, "enabled": False})

@app.route("/api/account/recovery/state")
@login_required
def api_account_recovery_state():
    left = int(getattr(current_user, "recovery_redownload_left", 0) or 0)
    has_plain = bool(getattr(current_user, "recovery_codes_plain", None))
    return jsonify({"redownload_left": left, "has_plain": has_plain})

@app.route("/api/account/recovery/redownload", methods=["POST"])
@login_required
def api_account_recovery_redownload():
    left = int(getattr(current_user, "recovery_redownload_left", 0) or 0)
    plain = getattr(current_user, "recovery_codes_plain", None) or ""
    if left <= 0 or not plain.strip():
        return jsonify({"error": "Повторное скачивание недоступно."}), 400
    codes = [c.strip() for c in plain.splitlines() if c.strip()]
    try:
        current_user.recovery_redownload_left = 0
        current_user.recovery_codes_plain = None
        db.session.commit()
    except Exception:
        db.session.rollback()
    return jsonify({"success": True, "codes": codes})

@app.route("/api/account/recovery/regenerate", methods=["POST"])
@login_required
def api_account_recovery_regenerate():
    codes = _make_recovery_codes(10)
    _save_recovery_codes(current_user.id, codes)
    try:
        current_user.recovery_codes_plain = "\n".join(codes)
        current_user.recovery_redownload_left = 1
        db.session.commit()
    except Exception:
        db.session.rollback()
    return jsonify({"success": True, "codes": codes})

@app.route("/api/account/recovery/use", methods=["POST"])
@login_required
def api_account_recovery_use():
    """Change password using a recovery code (consumes the code)."""
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip().upper()
    p1 = (data.get("new_password") or "")
    p2 = (data.get("new_password2") or "")

    if not code:
        return jsonify({"error": "Введи код восстановления."}), 400
    if p1 != p2:
        return jsonify({"error": "Пароли не совпадают."}), 400
    if not (8 <= len(p1) <= 24):
        return jsonify({"error": "Пароль должен быть от 8 до 21 символа."}), 400
    ok, msg = _validate_password(p1, username=current_user.username)
    if not ok:
        return jsonify({"error": msg}), 400

    if not _use_recovery_code(current_user.id, code):
        return jsonify({"error": "Неверный или уже использованный код восстановления."}), 400

    try:
        current_user.set_password(p1)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось сохранить."}), 500

    return jsonify({"success": True})

@app.route("/api/account/disable", methods=["POST"])
@login_required
def api_account_disable():
    data = request.get_json(silent=True) or {}
    pwd = (data.get("password") or "")
    if not current_user.check_password(pwd):
        return jsonify({"error": "Пароль неверный."}), 400
    try:
        current_user.is_disabled = True
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось сохранить."}), 500
    try:
        logout_user()
    except Exception:
        pass
    return jsonify({"success": True})

@app.route("/api/account/delete", methods=["POST"])
@login_required
def api_account_delete():
    data = request.get_json(silent=True) or {}
    pwd = (data.get("password") or "")
    confirm = (data.get("confirm") or "").strip().upper()
    if confirm not in {"DELETE", "УДАЛИТЬ"}:
        return jsonify({"error": "Подтверждение неверное. Введи DELETE."}), 400
    if not current_user.check_password(pwd):
        return jsonify({"error": "Пароль неверный."}), 400
    try:
        uid = current_user.id
        # soft-delete: make account unusable and hide personal data
        current_user.is_deleted = True
        current_user.is_disabled = True
        current_user.display_name = ""
        current_user.email = None
        current_user.email_verified = False
        current_user.phone = None
        current_user.avatar_url = None
        current_user.username = f"deleted_{uid}"
        try: current_user.username_norm = _norm_username(current_user.username)
        except Exception: pass
        current_user.set_password(secrets.token_urlsafe(24))
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Не удалось удалить."}), 500
    try:
        logout_user()
    except Exception:
        pass
    return jsonify({"success": True})

@app.route("/api/friend-request", methods=["POST"])
@login_required
def api_friend_request():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    if not username:
        return jsonify({"error": "Укажи ник"}), 400
    target = None
    try:
        target = User.query.filter_by(username_norm=_norm_username(username)).first()
    except Exception:
        target = None
    if not target:
        target = User.query.filter_by(username=username).first()
    if not target:
        return jsonify({"error": "Пользователь не найден"}), 404
    if target.id == current_user.id:
        return jsonify({"error": "Нельзя добавить себя"}), 400

    # Fix258: Respect recipient privacy toggle (Settings -> Privacy)
    # Default: allowed unless explicitly disabled.
    try:
        if not _nc_ui_allow(target, 'privacyAllowFriendReq', True):
            return (
                jsonify({"error": "Пользователь отключил запросы в друзья.", "code": "friend_requests_disabled"}),
                403,
            )
    except Exception:
        pass
    existing = FriendRequest.query.filter_by(
        from_id=current_user.id, to_id=target.id
    ).filter(FriendRequest.status != "rejected").first()
    if existing:
        return jsonify({"error": "Заявка уже отправлена"}), 400
    fr = FriendRequest(from_id=current_user.id, to_id=target.id, status="pending")
    db.session.add(fr)
    db.session.commit()

    # realtime уведомление получателю
    payload = {
        "request_id": fr.id,
        "from_id": current_user.id,
        "from_username": current_user.username,
        "from_avatar": current_user.avatar_url or "",
    }
    sids = user_sids.get(target.id, set())
    for sid in list(sids):
        socketio.emit("friend_request_created", payload, to=sid)

    return jsonify({"success": True, "request_id": fr.id, "target_id": target.id, "target_username": target.username, "target_avatar": target.avatar_url or ""})



@app.route("/api/online_count", methods=["GET"])
@login_required
def api_online_count():
    try:
        n = int(User.query.filter_by(is_online=True).count())
    except Exception:
        n = 0
    return jsonify({"online": n})


@app.route("/api/friend-requests/pending", methods=["GET"])
@login_required
def api_friend_requests_pending():
    """Return pending friend requests (incoming + outgoing) for the current user."""
    reqs = FriendRequest.query.filter(
        ((FriendRequest.from_id == current_user.id) | (FriendRequest.to_id == current_user.id)) &
        (FriendRequest.status == "pending")
    ).order_by(FriendRequest.id.desc()).all()

    items = []
    for fr in reqs:
        incoming = (fr.to_id == current_user.id)
        other_id = fr.from_id if incoming else fr.to_id
        other = User.query.get(other_id)
        items.append({
            "request_id": fr.id,
            "direction": "incoming" if incoming else "outgoing",
            "user_id": other.id if other else other_id,
            "username": other.username if other else "",
            "avatar": (other.avatar_url or "") if other else "",
        })
    return jsonify({"success": True, "items": items})

@app.route("/api/friend-request/<int:req_id>/respond", methods=["POST"])
@login_required
def api_friend_respond(req_id: int):
    data = request.get_json() or {}
    action = (data.get("action") or "").strip().lower()
    fr = db.session.get(FriendRequest, int(req_id))

    if (not fr) or (fr.status != "pending"):
        return jsonify({"error": "Неверная заявка"}), 400

    # Incoming request actions (current user is recipient)
    if action in ("accept", "reject", "decline"):
        if fr.to_id != current_user.id:
            return jsonify({"error": "Недостаточно прав"}), 403

        if action == "accept":
            fr.status = "accepted"
            db.session.commit()

            other = db.session.get(User, fr.from_id)
            me = current_user

            payload_for_from = {
                "request_id": int(fr.id),
                "friend_id": me.id,
                "friend_username": me.username,
                "friend_avatar": me.avatar_url or "",
                "friend_online": bool(getattr(me, "is_online", False)),
                "friend_created_at": _iso_z(me.created_at),
                "friend_last_seen": _iso_z(getattr(me, "last_seen", None)),
            }
            payload_for_to = {
                "request_id": int(fr.id),
                "friend_id": other.id,
                "friend_username": other.username,
                "friend_avatar": other.avatar_url or "",
                "friend_online": bool(getattr(other, "is_online", False)),
                "friend_created_at": _iso_z(other.created_at),
                "friend_last_seen": _iso_z(getattr(other, "last_seen", None)),
            }

            try:
                for sid in list(user_sids.get(fr.from_id, set()) or []):
                    socketio.emit("friend_request_accepted", payload_for_from, to=sid)
            except Exception:
                pass

            try:
                for sid in list(user_sids.get(fr.to_id, set()) or []):
                    socketio.emit("friend_request_accepted", payload_for_to, to=sid)
            except Exception:
                pass

            return jsonify({"success": True})

        # reject/decline
        fr.status = "rejected"
        db.session.commit()

        payload = {"request_id": int(fr.id), "from_id": int(fr.from_id), "to_id": int(fr.to_id)}
        try:
            for sid in list(user_sids.get(fr.from_id, set()) or []):
                socketio.emit("friend_request_rejected", payload, to=sid)
        except Exception:
            pass
        try:
            for sid in list(user_sids.get(fr.to_id, set()) or []):
                socketio.emit("friend_request_rejected", payload, to=sid)
        except Exception:
            pass

        return jsonify({"success": True})

    # Outgoing request cancellation (current user is sender)
    if action == "cancel":
        if fr.from_id != current_user.id:
            return jsonify({"error": "Недостаточно прав"}), 403

        fr.status = "canceled"
        db.session.commit()

        payload = {"request_id": int(fr.id), "from_id": int(fr.from_id), "to_id": int(fr.to_id)}
        try:
            for sid in list(user_sids.get(fr.from_id, set()) or []):
                socketio.emit("friend_request_canceled", payload, to=sid)
        except Exception:
            pass
        try:
            for sid in list(user_sids.get(fr.to_id, set()) or []):
                socketio.emit("friend_request_canceled", payload, to=sid)
        except Exception:
            pass

        return jsonify({"success": True})

    return jsonify({"error": "Неизвестное действие"}), 400
@app.route("/api/friend-request/<int:req_id>/cancel", methods=["POST"])

@login_required
def api_friend_cancel(req_id: int):
    fr = db.session.get(FriendRequest, int(req_id))
    if (not fr) or (fr.from_id != current_user.id) or (fr.status != "pending"):
        return jsonify({"error": "Неверная заявка"}), 400

    fr.status = "rejected"
    db.session.commit()

    # realtime: notify receiver to remove the pending row (if open)
    payload = {"request_id": int(fr.id), "from_id": int(current_user.id)}
    try:
        for sid in list(user_sids.get(int(fr.to_id), set()) or []):
            socketio.emit("friend_request_cancelled", payload, to=sid)
    except Exception:
        pass

    return jsonify({"success": True})

@app.route("/api/friends/<int:friend_id>/remove", methods=["POST"])
@login_required
def api_friend_remove(friend_id: int):
    fid = int(friend_id or 0)
    if not fid:
        return jsonify({"error": "invalid"}), 400
    if fid == int(current_user.id):
        return jsonify({"error": "Нельзя удалить себя"}), 400

    # Find accepted friendship record in either direction
    fr = (
        FriendRequest.query
        .filter(FriendRequest.status == "accepted")
        .filter(
            or_(
                (FriendRequest.from_id == int(current_user.id)) & (FriendRequest.to_id == fid),
                (FriendRequest.from_id == fid) & (FriendRequest.to_id == int(current_user.id)),
            )
        )
        .first()
    )
    if not fr:
        return jsonify({"error": "Не в друзьях"}), 404

    try:
        db.session.delete(fr)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "db_error"}), 500

    # realtime: tell both sides to remove the friend
    payload_me = {"friend_id": fid}
    payload_other = {"friend_id": int(current_user.id)}

    try:
        for sid in list(user_sids.get(int(current_user.id), set()) or []):
            socketio.emit("friend_removed", payload_me, to=sid)
    except Exception:
        pass
    try:
        for sid in list(user_sids.get(int(fid), set()) or []):
            socketio.emit("friend_removed", payload_other, to=sid)
    except Exception:
        pass

    return jsonify({"success": True})


@app.route("/api/rtc_config")
@login_required
def api_rtc_config():
    """Return WebRTC RTCPeerConnection config (ICE servers).

    This lets the frontend work on real networks without hardcoding TURN credentials into JS.
    """
    def _split_urls(val: str):
        out = []
        for x in (val or "").split(","):
            x = (x or "").strip()
            if x:
                out.append(x)
        return out

    stun_urls = _split_urls(app.config.get("RTC_STUN_URLS", ""))
    turn_urls = _split_urls(app.config.get("RTC_TURN_URLS", ""))

    # TURN credentials
    # Option A (recommended): TURN REST / HMAC short-lived creds
    #   - set RTC_TURN_SECRET on the server
    #   - coturn: use-auth-secret + static-auth-secret
    turn_secret = (app.config.get("RTC_TURN_SECRET") or "").strip()
    ttl_raw = app.config.get("RTC_TURN_TTL_SECONDS") or app.config.get("RTC_TURN_TTL") or "600"
    try:
        turn_ttl = int(ttl_raw)
    except Exception:
        turn_ttl = 600
    # clamp: 1min .. 24h
    if turn_ttl < 60:
        turn_ttl = 60
    if turn_ttl > 86400:
        turn_ttl = 86400

    # Option B (fallback): static username/password
    turn_user = (app.config.get("RTC_TURN_USERNAME") or "").strip()
    turn_cred = (app.config.get("RTC_TURN_CREDENTIAL") or "").strip()
    policy = (app.config.get("RTC_ICE_TRANSPORT_POLICY") or "all").strip().lower()
    if policy not in ("all", "relay"):
        policy = "all"

    ice_servers = []
    if stun_urls:
        ice_servers.append({"urls": stun_urls})

    # Only include TURN if it is fully configured.
    if turn_urls:
        if turn_secret:
            # TURN REST: username contains expiry epoch (seconds).
            try:
                user_label = None
                try:
                    user_label = str(getattr(current_user, "id", ""))
                except Exception:
                    user_label = None
                if not user_label or user_label == "None":
                    user_label = "user"

                exp = int(time.time()) + int(turn_ttl)
                username = f"{exp}:{user_label}"
                digest = hmac.new(turn_secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1).digest()
                password = base64.b64encode(digest).decode("utf-8")
                ice_servers.append({"urls": turn_urls, "username": username, "credential": password})
            except Exception:
                # If anything goes wrong, fall back to static creds if present.
                if turn_user and turn_cred:
                    ice_servers.append({"urls": turn_urls, "username": turn_user, "credential": turn_cred})
        elif turn_user and turn_cred:
            ice_servers.append({"urls": turn_urls, "username": turn_user, "credential": turn_cred})

    return jsonify({"iceServers": ice_servers, "iceTransportPolicy": policy})

@app.route("/api/current_call")
@login_required
def api_current_call():
    cutoff = utcnow() - timedelta(minutes=3)
    session = (
        CallSession.query.filter(
            CallSession.active.is_(True),
            CallSession.started_at >= cutoff,
            (
                (CallSession.user1_id == current_user.id)
                | (CallSession.user2_id == current_user.id)
            ),
        )
        .order_by(CallSession.started_at.desc())
        .first()
    )
    if not session:
        return jsonify({"active": False})
    peer_id = (
        session.user2_id
        if session.user1_id == current_user.id
        else session.user1_id
    )
    peer = db.session.get(User, peer_id)
    mode = "active"
    deadline_ms = None
    try:
        info = direct_call_reconnect.get(int(session.id))
        if info and info.get("deadline"):
            mode = "reconnect"
            deadline_ms = int(info["deadline"].timestamp() * 1000)
    except Exception:
        pass
    return jsonify(
        {
            "active": True,
            "mode": mode,
            "deadline_ms": deadline_ms,
            "peer_id": peer_id,
            "peer_name": peer.username if peer else "unknown",
        }
    )

@app.route("/api/voice/leave", methods=["POST"])
@login_required
def api_voice_leave():
    """Fallback HTTP endpoint to leave a voice channel.

    This exists to prevent "stuck" voice roster entries when a Socket.IO leave event
    is missed on the client side. It mirrors the server-side cleanup performed by the
    group_leave socket handler.
    """
    data = request.get_json(silent=True) or {}
    try:
        channel_id = int(data.get("channel_id") or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return jsonify({"ok": False, "error": "invalid"}), 400

    try:
        ch = db.session.get(Channel, int(channel_id))
    except Exception:
        ch = None
    if ch is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    ch_type = (getattr(ch, "channel_type", None) or "text").lower()
    if bool(getattr(ch, "is_dm", False)) or ch_type != "voice":
        return jsonify({"ok": False, "error": "not_voice"}), 400

    # Must be a member and not pending
    _, mem = _require_membership(int(channel_id), current_user.id)
    if not mem:
        return jsonify({"ok": False, "error": "no_access"}), 403
    if (getattr(mem, "role", None) or "member") == "pending":
        return jsonify({"ok": False, "error": "pending"}), 403

    members = group_calls.get(channel_id)
    was_member = False
    if members is not None:
        try:
            was_member = any(str(uid) == str(current_user.id) for uid in (members or []))
        except Exception:
            was_member = False

    if members is not None:
        try:
            members.discard(current_user.id)
            try:
                members.discard(int(current_user.id))
            except Exception:
                pass
            try:
                members.discard(str(current_user.id))
            except Exception:
                pass
        except Exception:
            try:
                members.remove(current_user.id)
            except Exception:
                pass
        if not members:
            group_calls.pop(channel_id, None)

    # Clean voice state (mute/deafen) even if membership tracking was out of sync.
    try:
        vs = voice_states.get(int(channel_id))
        if vs and int(current_user.id) in vs:
            vs.pop(int(current_user.id), None)
        if vs is not None and not vs:
            voice_states.pop(int(channel_id), None)
    except Exception:
        pass

    # Notify remaining peers so they can close WebRTC connections.
    if was_member and members is not None:
        try:
            for uid in list(members):
                _emit_to_user(
                    uid,
                    "group_user_left",
                    {"channel_id": channel_id, "user_id": current_user.id},
                )
        except Exception:
            pass

    # Broadcast roster update for the guild.
    try:
        _emit_voice_roster_update(_root_id_for_channel(ch))
    except Exception:
        pass

    return jsonify({"ok": True})

# --- socket handlers ---

def register_socket_handlers(app: Flask):
        @socketio.on("connect")
        def on_connect(auth=None):
            global _presence_task_started
            if not current_user.is_authenticated:
                return
            # everybody joins the shared presence room
            join_room("presence")

            # Join only channels where you're a member (privacy)
            try:
                for mem in ChannelMember.query.filter_by(user_id=int(current_user.id)).all():
                    join_room(f"channel_{int(mem.channel_id)}")
            except Exception:
                pass

            sids = user_sids.setdefault(current_user.id, set())
            sids.add(request.sid)

            presence_last_beat[current_user.id] = utcnow()

            # start background sweeper once
            if not _presence_task_started:
                _presence_task_started = True
                socketio.start_background_task(_presence_sweeper, app)

            # start ad-hoc group chat sweeper once (24h TTL cleanup)
            global _adhoc_gc_task_started
            if not _adhoc_gc_task_started:
                _adhoc_gc_task_started = True
                socketio.start_background_task(_adhoc_gc_sweeper, app)

            try:
                _set_user_presence(current_user.id, True)
            except Exception as e:
                print(f"[presence] connect update failed: {e}")

            try:
                if _nc_auth_is_admin_auditor('support'):
                    join_room('support_staff_global')
                    join_room(f"support_staff_user_{int(current_user.id)}")
            except Exception:
                pass

            # Sync active ad-hoc group chats to survive page refresh (Discord-like)
            try:
                _emit_adhoc_group_chat_list(int(current_user.id))
            except Exception:
                pass
        @socketio.on("disconnect")
        def on_disconnect():
            if not current_user.is_authenticated:
                return
            sids = user_sids.get(current_user.id)
            if not sids:
                return
            sids.discard(request.sid)
            # DM call socket drop detection: handles the F5 reload race where a new socket
            # may connect before the old call socket is closed.
            try:
                call_sid = direct_call_sid.get(int(current_user.id))
            except Exception:
                call_sid = None
            if call_sid and call_sid == request.sid:
                try:
                    direct_call_sid.pop(int(current_user.id), None)
                except Exception:
                    pass
                try:
                    sid = direct_call_users.get(int(current_user.id))
                except Exception:
                    sid = None
                if sid:
                    try:
                        sess = db.session.get(CallSession, int(sid))
                    except Exception:
                        sess = None
                    try:
                        if sess and getattr(sess, "active", False) and getattr(sess, "call_started_at", None):
                            now = utcnow()
                            try:
                                sess.started_at = now
                                db.session.commit()
                            except Exception:
                                try:
                                    db.session.rollback()
                                except Exception:
                                    pass
                            try:
                                _dc_mark_disconnected(int(sid), now)
                            except Exception:
                                pass
                            try:
                                deadline = _dc_start_reconnect_window(int(sid), ended_by=int(current_user.id))
                            except Exception:
                                deadline = None
                            # IMPORTANT:
                            # Do NOT emit call_rejected on transient disconnect (F5/tab reload).
                            # Older clients interpret call_rejected as a hard hangup and will
                            # close the call UI immediately on the other side.
                            # The reconnect flow is driven by:
                            #   - call_reconnect_window (emitted to both peers), and
                            #   - WebRTC ICE/PC state transitions on the client.
                            # Keeping call_rejected reserved for explicit hangups/declines
                            # makes reloads behave Discord-like.
                    except Exception:
                        pass

            if not sids:
                user_sids.pop(current_user.id, None)
                presence_last_beat.pop(current_user.id, None)
                try:
                    _set_user_presence(current_user.id, False)
                except Exception as e:
                    print(f"[presence] disconnect update failed: {e}")
                # If user dropped during a connected DM call, open reconnect window for 3 minutes.
                try:
                    sid = direct_call_users.get(int(current_user.id))
                except Exception:
                    sid = None
                if sid:
                    try:
                        sess = db.session.get(CallSession, int(sid))
                    except Exception:
                        sess = None
                    try:
                        if sess and getattr(sess, "active", False) and getattr(sess, "call_started_at", None):
                            now = utcnow()
                            try:
                                sess.started_at = now
                                db.session.commit()
                            except Exception:
                                try: db.session.rollback()
                                except Exception: pass
                            try:
                                _dc_mark_disconnected(int(sid), now)
                            except Exception:
                                pass
                            try:
                                _dc_start_reconnect_window(int(sid), ended_by=int(current_user.id))
                            except Exception:
                                pass
                    except Exception:
                        pass


                # Clean up voice memberships for this user (if they were in any voice rooms)
                try:
                    affected_guilds = set()
                    for cid, members in list(group_calls.items()):
                        try:
                            if int(current_user.id) in set(members or []):
                                try:
                                    members.discard(current_user.id)
                                    try:
                                        members.discard(int(current_user.id))
                                    except Exception:
                                        pass
                                    try:
                                        members.discard(str(current_user.id))
                                    except Exception:
                                        pass
                                except Exception:
                                    try:
                                        members.remove(current_user.id)
                                    except Exception:
                                        pass

                                # notify peers in the room
                                try:
                                    socketio.emit(
                                        "group_user_left",
                                        {"channel_id": int(cid), "user_id": int(current_user.id)},
                                        to=f"group_{int(cid)}",
                                    )
                                except Exception:
                                    pass


                                # clear screenshare intent (avoid lingering demo tiles)
                                try:
                                    st = group_screen_intents.get(int(cid))
                                    if st is not None:
                                        removed = st.pop(int(current_user.id), None)
                                        if removed is not None:
                                            try:
                                                socketio.emit(
                                                    "group_screen_intent",
                                                    {"channel_id": int(cid), "user_id": int(current_user.id), "active": False},
                                                    to=f"group_{int(cid)}",
                                                )
                                            except Exception:
                                                pass
                                        if not st:
                                            group_screen_intents.pop(int(cid), None)
                                except Exception:
                                    pass

                                # clean voice state
                                try:
                                    vs = voice_states.get(int(cid))
                                    if vs and int(current_user.id) in vs:
                                        vs.pop(int(current_user.id), None)
                                    if vs is not None and not vs:
                                        voice_states.pop(int(cid), None)
                                except Exception:
                                    pass
                                if not members:
                                    group_calls.pop(cid, None)
                                try:
                                    ch = db.session.get(Channel, int(cid))
                                    gid = int(_root_id_for_channel(ch)) if ch else 0
                                    if gid:
                                        affected_guilds.add(gid)
                                except Exception:
                                    pass
                        except Exception:
                            pass

                    for gid in affected_guilds:
                        _emit_voice_roster_update(int(gid))
                except Exception:
                    pass

        @socketio.on("register_user")
        def handle_register_user(data):
            # nothing extra; mapping already done in connect
            pass

        @socketio.on("presence_ping")
        def handle_presence_ping(data=None):
            if not current_user.is_authenticated:
                return
            presence_last_beat[current_user.id] = utcnow()
            # bump last_seen, but don't spam everyone
            try:
                u = db.session.get(User, int(current_user.id))
                if u:
                    u.last_seen = utcnow()
                    if not getattr(u, "is_online", False):
                        u.is_online = True
                        db.session.commit()
                        _emit_presence_update(u.id)
                        return
                    db.session.commit()
            except Exception as e:
                print(f"[presence] ping update failed: {e}")

        @socketio.on("join_channel")
        def handle_join_channel(data):
            if not current_user.is_authenticated:
                return
            try:
                ch_id = int(data.get("channel_id") or 0)
            except Exception:
                ch_id = 0

            ch, mem = _require_membership(ch_id, current_user.id)
            if not ch or not mem:
                socketio.emit("channel_join_denied", {"channel_id": int(ch_id), "reason": "no_access"}, to=request.sid)
                return

            join_room(f"channel_{ch_id}")
            socketio.emit("channel_joined", {"channel_id": int(ch_id)}, to=request.sid)

        @socketio.on("typing")
        def handle_typing(data):
            if not current_user.is_authenticated:
                return
            try:
                ch_id = int(data.get("channel_id") or 0)
            except Exception:
                ch_id = 0
            if not ch_id:
                return

            # Require membership (privacy)
            try:
                _, mem = _require_membership(ch_id, current_user.id)
            except Exception:
                mem = None
            if not mem:
                return

            typing = bool(data.get("typing"))
            emit(
                "typing_update",
                {
                    "channel_id": ch_id,
                    "user_id": current_user.id,
                    "username": current_user.username,
                    "typing": typing,
                },
                to=f"channel_{ch_id}",
                include_self=False,
            )

        @socketio.on("messages_delivered")
        def handle_messages_delivered(data):
            if not current_user.is_authenticated:
                return
            try:
                channel_id = int(data.get("channel_id") or 0)
            except Exception:
                channel_id = 0
            msg_ids = data.get("message_ids") or []
            if not channel_id or not isinstance(msg_ids, list) or not msg_ids:
                return

            # Require membership
            try:
                _, mem = _require_membership(channel_id, current_user.id)
            except Exception:
                mem = None
            if not mem:
                return

            # Update receipts for messages in this channel only
            safe_ids = []
            for mid in msg_ids[:200]:
                try:
                    mid_i = int(mid)
                except Exception:
                    continue
                msg = db.session.get(Message, mid_i)
                if not msg or int(msg.channel_id) != int(channel_id):
                    continue
                safe_ids.append(mid_i)

            if not safe_ids:
                return

            try:
                now = utcnow()
                recs = MessageReceipt.query.filter(
                    MessageReceipt.message_id.in_(safe_ids),
                    MessageReceipt.user_id == current_user.id
                ).all()
                for r in recs:
                    if not r.delivered_at:
                        r.delivered_at = now
                db.session.commit()
            except Exception:
                db.session.rollback()
                return

            # notify senders (within room)
            try:
                socketio.emit(
                    "message_receipt_update",
                    {"channel_id": channel_id, "message_ids": safe_ids, "user_id": int(current_user.id), "delivered": True},
                    to=f"channel_{channel_id}"
                )
            except Exception:
                pass

        @socketio.on("channel_read")

        def handle_channel_read(data):
            if not current_user.is_authenticated:
                return
            try:
                ch_id = int(data.get("channel_id") or 0)
                last_id = int(data.get("last_message_id") or 0)
            except Exception:
                return
            if not ch_id or not last_id:
                return

            # Require membership to prevent privacy leaks
            try:
                _, mem = _require_membership(int(ch_id), current_user.id)
            except Exception:
                mem = None
            if not mem:
                return

            # We keep ChannelRead for any channel (for unread counts),
            # but delivery/read receipts are only meaningful for DM chats in this app.
            ch = db.session.get(Channel, int(ch_id))
            if not ch:
                return
            cr = ChannelRead.query.filter_by(channel_id=ch_id, user_id=int(current_user.id)).first()
            if not cr:
                cr = ChannelRead(channel_id=ch_id, user_id=int(current_user.id), last_read_message_id=last_id)
                db.session.add(cr)
            else:
                cr.last_read_message_id = max(int(cr.last_read_message_id or 0), last_id)
                cr.updated_at = utcnow()

            now = utcnow()
            updates = []
            # Mark receipts for messages in this channel read by current user.
            # IMPORTANT: do NOT mark receipts for messages sent by the current user,
            # otherwise the sender will immediately see their own messages as read.
            try:
                if not ch.is_dm:
                    db.session.commit()
                    return

                msg_ids = [
                    m.id
                    for m in (
                        Message.query.filter_by(channel_id=ch_id)
                        .filter(Message.id <= last_id)
                        .filter(Message.user_id != int(current_user.id))
                        .all()
                    )
                ]
                if msg_ids:
                    recs = MessageReceipt.query.filter(MessageReceipt.user_id == int(current_user.id)).filter(MessageReceipt.message_id.in_(msg_ids)).all()
                    rec_map = {r.message_id: r for r in recs}
                    for mid in msg_ids:
                        r = rec_map.get(mid)
                        if not r:
                            r = MessageReceipt(message_id=int(mid), user_id=int(current_user.id))
                            db.session.add(r)
                        if not r.delivered_at:
                            r.delivered_at = now
                        if not r.read_at:
                            r.read_at = now
                        updates.append({"message_id": int(mid), "user_id": int(current_user.id), "delivered_at": _iso_z(r.delivered_at), "read_at": _iso_z(r.read_at)})
                db.session.commit()
            except Exception:
                db.session.rollback()
                return

            if updates:
                emit("receipt_update_batch", {"items": updates}, to=f"channel_{ch_id}")

        @socketio.on("send_message")
        def handle_send_message(data):
            if not current_user.is_authenticated:
                return
            presence_last_beat[current_user.id] = utcnow()
            ch_id = int(data.get("channel_id") or 0)
            content = (data.get("content") or "").strip()
            if not ch_id or not content:
                return

            ch = db.session.get(Channel, int(ch_id))
            if not ch:
                return

            # Discord-like DM gating: if users are not friends and have no mutual servers,
            # deny sending and let client show a Clyde-style notice.
            if bool(getattr(ch, "is_dm", False)):
                try:
                    other_id = _get_dm_other_user_id(ch_id, current_user.id)
                except Exception:
                    other_id = None
                if other_id and not _dm_can_send(int(current_user.id), int(other_id)):
                    try:
                        emit("send_denied", {"channel_id": int(ch_id), "reason": "dm_not_allowed"}, to=request.sid)
                    except Exception:
                        pass
                    return

            # Require membership for ANY channel (privacy)
            try:
                _, mem = _require_membership(int(ch_id), current_user.id)
            except Exception:
                mem = None
            if not mem:
                try:
                    emit("send_denied", {"channel_id": int(ch_id), "reason": "no_access"}, to=request.sid)
                except Exception:
                    pass
                return

            muted, mute_msg, mute_until = _nc_is_user_muted(int(current_user.id))
            if muted:
                try:
                    emit("send_denied", {"channel_id": int(ch_id), "reason": "muted", "mute_until": mute_until, "message": mute_msg}, to=request.sid)
                except Exception:
                    pass
                return
            server_id = _nc_get_channel_root_server_id(ch)
            if server_id:
                server_banned, server_ban_msg, server_ban_until = _nc_is_user_server_banned(int(current_user.id), int(server_id))
                if server_banned:
                    try:
                        emit("send_denied", {"channel_id": int(ch_id), "reason": "server_banned", "ban_until": server_ban_until, "message": server_ban_msg}, to=request.sid)
                    except Exception:
                        pass
                    return
                server_muted, server_mute_msg, server_mute_until = _nc_is_user_server_muted(int(current_user.id), int(server_id))
                if server_muted:
                    try:
                        emit("send_denied", {"channel_id": int(ch_id), "reason": "server_muted", "mute_until": server_mute_until, "message": server_mute_msg}, to=request.sid)
                    except Exception:
                        pass
                    return

            # Permission check (Discord-like, simplified)
            try:
                perms = _effective_channel_perms(ch, mem)
                if (getattr(ch, "channel_type", None) or "text").lower() == "voice":
                    emit("send_denied", {"channel_id": int(ch_id), "reason": "voice_channel"}, to=request.sid)
                    return
                if not bool(perms.get("send")):
                    emit("send_denied", {"channel_id": int(ch_id), "reason": "no_send"}, to=request.sid)
                    return
            except Exception:
                pass

            msg = Message(channel_id=ch_id, user_id=current_user.id, content=content)
            try:
                current_user.last_seen = utcnow()
                current_user.is_online = True
            except Exception:
                pass

            db.session.add(msg)
            db.session.flush()  # msg.id

            other_id = None
            if ch.is_dm:
                try:
                    other_id = _get_dm_other_user_id(ch_id, current_user.id)
                    if other_id:
                        existing = MessageReceipt.query.filter_by(message_id=msg.id, user_id=int(other_id)).first()
                        if not existing:
                            db.session.add(MessageReceipt(message_id=msg.id, user_id=int(other_id)))
                except Exception:
                    other_id = None

            db.session.commit()

            receipt = None
            if other_id:
                receipt = {"delivered": False, "read": False, "delivered_at": None, "read_at": None}

            payload = {
                "id": msg.id,
                "user": current_user.username,
                "user_id": current_user.id,
                "avatar_url": current_user.avatar_url or "",
                "content": msg.content,
                "created_at": _fmt_msk(msg.created_at),
                "created_day_key": _fmt_day_key_msk(msg.created_at),
                "created_day_label": _fmt_day_label_ru(msg.created_at),
                "channel_id": ch_id,
                "attachments": [],
                "receipt": receipt,
                "edited_at": "",
                "deleted_at": "",
                "is_pinned": False,
                "pinned_by": 0,
                "reactions": {},
                "my_reactions": [],
            }
            emit("new_message", payload, to=f"channel_{ch_id}")

        @socketio.on("call_user")
        def handle_call_user(data):
            if not current_user.is_authenticated:
                return
            try:
                target_id = int(data.get("target_id") or 0)
            except Exception:
                target_id = 0
            offer = data.get("offer")
            if not target_id or not offer:
                return

            # Direct calls are allowed only between friends (Discord-like for this app).
            # Server-side enforcement is mandatory so the callee never receives an offer
            # even if the client UI is bypassed.
            try:
                if not _are_friends(int(current_user.id), int(target_id)):
                    emit("call_denied", {"reason": "not_friends", "target_id": int(target_id)}, to=request.sid)
                    return
            except Exception:
                try:
                    emit("call_denied", {"reason": "not_friends", "target_id": int(target_id)}, to=request.sid)
                except Exception:
                    pass
                return

            # Create/refresh a DM call session immediately (even before answer), so we can:
            # - compute ring duration for missed/declined calls
            # - avoid "stuck" states when a party hangs up before the call is answered
            # NOTE: we no longer push a separate "started" system message here (it created spam in empty chats).
            try:
                low = min(current_user.id, target_id)
                high = max(current_user.id, target_id)
                now = utcnow()
                session = CallSession.query.filter_by(user1_id=low, user2_id=high, active=True).first()
                if not session:
                    session = CallSession(user1_id=low, user2_id=high, active=True, started_at=now, call_started_at=None)
                    db.session.add(session)
                else:
                    session.active = True
                    session.started_at = now
                db.session.commit()
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass
            # Track which socket is tied to the DM call flow for this user.
            # Needed to detect the F5 reload race (new socket connects before old one disconnects).
            try:
                direct_call_sid[int(current_user.id)] = request.sid
            except Exception:
                pass

            _emit_to_user(
                target_id,
                "call_offer",
                {
                    "from_id": current_user.id,
                    "from_name": current_user.username,
                    "offer": offer,
                    "reconnect": bool(data.get("reconnect")),
                    # If this offer is part of an auto-reconnect flow, the client
                    # should avoid showing the incoming-call modal.
                    "final": False,
                },
            )

            # Discord-like: add a "started call" system message in the DM feed so the other
            # side can join via the green link in history instead of a blocking modal.
            # Debounced to avoid spamming the chat with repeated offers.
            try:
                dm_ch = get_or_create_dm_channel(int(current_user.id), int(target_id))
                # Only write a started marker when this is NOT a reconnect attempt.
                if not bool((data or {}).get("reconnect")):
                    try:
                        last = (
                            Message.query.filter_by(channel_id=dm_ch.id)
                            .filter(Message.deleted_at.is_(None))
                            .order_by(Message.created_at.desc())
                            .first()
                        )
                        if last and isinstance(last.content, str) and last.content.startswith("__sys_call__:started"):
                            # If a started marker was just posted, skip.
                            if last.created_at and (utcnow() - last.created_at).total_seconds() < 8.0:
                                raise RuntimeError("debounced")
                    except RuntimeError:
                        return
                    except Exception:
                        pass

                    sys_msg = Message(channel_id=dm_ch.id, user_id=int(current_user.id), content="__sys_call__:started")
                    db.session.add(sys_msg)
                    db.session.commit()

                    sys_payload = {
                        "id": sys_msg.id,
                        "user": current_user.username,
                        "user_id": int(current_user.id),
                        "avatar_url": getattr(current_user, "avatar_url", "") or "",
                        "content": sys_msg.content,
                        "created_at": _fmt_msk(sys_msg.created_at),
                        "created_day_key": _fmt_day_key_msk(sys_msg.created_at),
                        "created_day_label": _fmt_day_label_ru(sys_msg.created_at),
                        "channel_id": dm_ch.id,
                        "attachments": [],
                        "receipt": None,
                        "edited_at": "",
                        "deleted_at": "",
                        "is_pinned": False,
                        "pinned_by": 0,
                        "reactions": {},
                        "my_reactions": [],
                    }
                    try:
                        socketio.emit("new_message", sys_payload, to=f"channel_{dm_ch.id}")
                    except Exception:
                        pass
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass

        @socketio.on("answer_call")
        def handle_answer_call(data):
            if not current_user.is_authenticated:
                return
            try:
                target_id = int((data or {}).get("target_id") or 0)
            except Exception:
                target_id = 0
            answer = (data or {}).get("answer")
            if (not target_id) or (not answer):
                return

            # track active call session
            low = min(current_user.id, target_id)
            high = max(current_user.id, target_id)
            session = CallSession.query.filter_by(
                user1_id=low, user2_id=high, active=True
            ).first()

            # Ensure session has a stable call_started_at (for duration) and keep started_at as last seen
            now = utcnow()
            if not session:
                session = CallSession(user1_id=low, user2_id=high, active=True, started_at=now, call_started_at=now)
                db.session.add(session)
            else:
                try:
                    session.active = True
                    if not getattr(session, "call_started_at", None):
                        session.call_started_at = now
                    session.started_at = now
                except Exception:
                    pass
            try:
                db.session.commit()
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass

            # DM call reconnect tracking
            try:
                if session and getattr(session, "id", None):
                    sid = int(session.id)
                    direct_call_users[int(current_user.id)] = sid
                    direct_call_users[int(target_id)] = sid
                    try:
                        direct_call_sid[int(current_user.id)] = request.sid
                    except Exception:
                        pass
                    _dc_mark_connected(sid, utcnow())
                    direct_call_reconnect.pop(sid, None)
            except Exception:
                pass

            # Notify caller immediately that we are answering (stops ringback quickly).
            try:
                _emit_to_user(target_id, "call_answering", {"from_id": current_user.id})
            except Exception:
                pass

            _emit_to_user(
                target_id,
                "call_answer",
                {"from_id": current_user.id, "answer": answer},
            )

            # Send current DM call mute/deafen states to both sides (best-effort).
            try:
                if session and getattr(session, "id", None):
                    sid = int(session.id)
                    st = direct_call_states.get(sid, {})
                    emit("dm_call_state_sync", {"session_id": sid, "states": st}, to=request.sid)
                    _emit_to_user(target_id, "dm_call_state_sync", {"session_id": sid, "states": st})
            except Exception:
                pass

            # Socket.IO ack so client can keep the modal open until server really got the answer.
            return {"ok": True}

        @socketio.on("dm_call_state_update")
        def handle_dm_call_state_update(data):
            """Update DM call mute/deafen state so peers can show badges (Discord-like).

            Client should emit when toggling mic/sound while a 1:1 call is active.
            """
            if not current_user.is_authenticated:
                return
            try:
                target_id = int((data or {}).get("target_id") or 0)
            except Exception:
                target_id = 0
            if not target_id:
                return

            low = min(int(current_user.id), int(target_id))
            high = max(int(current_user.id), int(target_id))
            try:
                session = CallSession.query.filter_by(user1_id=low, user2_id=high, active=True).first()
            except Exception:
                session = None
            if not session:
                return

            muted = bool((data or {}).get("muted"))
            deafened = bool((data or {}).get("deafened"))

            try:
                sid = int(getattr(session, "id", 0) or 0)
            except Exception:
                sid = 0
            if not sid:
                return

            try:
                direct_call_states.setdefault(sid, {})[int(current_user.id)] = {
                    "muted": muted,
                    "deafened": deafened,
                }
            except Exception:
                pass

            # Notify the peer of this user's state
            try:
                _emit_to_user(
                    target_id,
                    "dm_call_peer_state",
                    {
                        "session_id": sid,
                        "user_id": int(current_user.id),
                        "muted": muted,
                        "deafened": deafened,
                    },
                )
            except Exception:
                pass

        @socketio.on("screenshare_offer")
        def handle_screenshare_offer(data):
            if not current_user.is_authenticated:
                return
            target_id = int(data.get("target_id") or 0)
            offer = data.get("offer")
            if not target_id or not offer:
                return
            _emit_to_user(
                target_id,
                "screenshare_offer",
                {"from_id": current_user.id, "offer": offer},
            )

        @socketio.on("screenshare_answer")
        def handle_screenshare_answer(data):
            if not current_user.is_authenticated:
                return
            target_id = int(data.get("target_id") or 0)
            answer = data.get("answer")
            if not target_id or not answer:
                return
            _emit_to_user(
                target_id,
                "screenshare_answer",
                {"from_id": current_user.id, "answer": answer},
            )

        

        @socketio.on("screenshare_stop")
        def handle_screenshare_stop(data):
            if not current_user.is_authenticated:
                return
            target_id = int(data.get("target_id") or 0)
            if not target_id:
                return
            _emit_to_user(
                target_id,
                "screenshare_stop",
                {"from_id": current_user.id},
            )


@socketio.on("camera_offer")
def handle_camera_offer(data):
    if not current_user.is_authenticated:
        return
    target_id = int((data or {}).get("target_id") or 0)
    offer = (data or {}).get("offer")
    if not target_id or not offer:
        return
    _emit_to_user(
        target_id,
        "camera_offer",
        {"from_id": current_user.id, "offer": offer},
    )

@socketio.on("camera_answer")
def handle_camera_answer(data):
    if not current_user.is_authenticated:
        return
    target_id = int((data or {}).get("target_id") or 0)
    answer = (data or {}).get("answer")
    if not target_id or not answer:
        return
    _emit_to_user(
        target_id,
        "camera_answer",
        {"from_id": current_user.id, "answer": answer},
    )

@socketio.on("camera_stop")
def handle_camera_stop(data):
    if not current_user.is_authenticated:
        return
    target_id = int((data or {}).get("target_id") or 0)
    if not target_id:
        return
    _emit_to_user(
        target_id,
        "camera_stop",
        {"from_id": current_user.id},
    )

@socketio.on("reject_call")
def handle_reject_call(data):
    if not current_user.is_authenticated:
        return
    target_id = int(data.get("target_id"))
    force = bool(data.get("force"))

    low = min(current_user.id, target_id)
    high = max(current_user.id, target_id)
    session = CallSession.query.filter_by(
        user1_id=low, user2_id=high, active=True
    ).first()
    if session:
        # If call was connected, do not finalize immediately. Open 3-minute reconnect window.
        try:
            connected = bool(getattr(session, "call_started_at", None))
        except Exception:
            connected = False

        # If we're already in a reconnect window for this call, a reject means FINAL END (no auto-resume).
        try:
            sid = int(getattr(session, 'id', 0) or 0)
            if sid and sid in direct_call_reconnect:
                force = True
            if bool((data or {}).get('cancel_reconnect')):
                force = True
        except Exception:
            pass
        if connected and (not force):
            now = utcnow()
            try:
                session.active = True
                session.started_at = now
                db.session.commit()
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass
            try:
                sid = int(session.id)
                direct_call_users[int(current_user.id)] = sid
                direct_call_users[int(target_id)] = sid
                _dc_mark_disconnected(sid, now)
                deadline = _dc_start_reconnect_window(sid, ended_by=int(current_user.id))
                _emit_to_user(
                    target_id,
                    "call_rejected",
                    {
                        "from_id": current_user.id,
                        "reconnect": True,
                        "final": False,
                        "deadline_ms": int(deadline.timestamp() * 1000),
                    },
                )
            except Exception:
                pass
            return
        if connected and force:
            # Explicit hangup: finalize immediately (no reconnect window)
            now = utcnow()
            try:
                sid = int(session.id)
                _dc_mark_disconnected(sid, now)
                direct_call_reconnect.pop(sid, None)
                session.active = False
                session.started_at = now
                db.session.commit()
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass
            try:
                # clear tracking for both sides
                direct_call_users.pop(int(session.user1_id), None)
                direct_call_users.pop(int(session.user2_id), None)
                direct_call_sid.pop(int(session.user1_id), None)
                direct_call_sid.pop(int(session.user2_id), None)
                direct_call_reconnect.pop(int(session.id), None)
                try:
                    direct_call_states.pop(int(session.id), None)
                except Exception:
                    pass
            except Exception:
                pass

        # Not connected yet -> finalize as missed/cancel
        session.active = False
        db.session.commit()

        try:
            if session and getattr(session, "id", None):
                direct_call_states.pop(int(session.id), None)
        except Exception:
            pass

    
    # System message in DM feed (Discord-like)
    try:
        dm_ch = get_or_create_dm_channel(current_user.id, target_id)
        # Compute duration (best-effort)
        dur_sec = 0
        try:
            now = utcnow()
            if session and getattr(session, "call_started_at", None):
                dur_sec = int((now - session.call_started_at).total_seconds())
            elif session and getattr(session, "started_at", None):
                # fallback for older DBs
                dur_sec = int((now - session.started_at).total_seconds())
            else:
                # call was not accepted; approximate by last started system message time
                last_start = (
                    Message.query.filter_by(channel_id=dm_ch.id)
                    .filter(Message.deleted_at.is_(None))
                    .filter(Message.content.in_(["__sys_call__:start","__sys_call__:started"]))
                    .order_by(Message.created_at.desc())
                    .first()
                )
                if last_start and getattr(last_start, "created_at", None):
                    dur_sec = int((now - last_start.created_at).total_seconds())
        except Exception:
            dur_sec = 0
        if dur_sec < 0:
            dur_sec = 0

        # Determine event kind:
        # - if call_started_at exists -> call was connected -> ended
        # - otherwise -> call never connected (ringing) -> missed (generic: decline/cancel)
        try:
            connected = bool(session and getattr(session, "call_started_at", None))
        except Exception:
            connected = False
        kind = "__sys_call__:ended" if connected else "__sys_call__:missed"
        kind = f"{kind}:{dur_sec}"

        # Debounce duplicates: both sides may send reject_call nearly simultaneously.
        try:
            last = (
                Message.query.filter_by(channel_id=dm_ch.id)
                .filter(Message.deleted_at.is_(None))
                .order_by(Message.created_at.desc())
                .first()
            )
            if last and isinstance(last.content, str) and last.content.startswith("__sys_call__:"):
                if last.created_at and (utcnow() - last.created_at).total_seconds() < 2.0:
                    # recent system call event already recorded; skip creating another
                    raise RuntimeError("debounced")
        except RuntimeError:
            # recent system call event already recorded; skip creating another
            # but still notify remote UI state (final, no reconnect window).
            _emit_to_user(target_id, "call_rejected", {"from_id": current_user.id, "final": True})
            return
        except Exception:
            pass

        # For missed calls (not connected), show the caller as the "actor" in the feed (closer to Telegram/Discord).
        # Best-effort: we attribute to the other party.
        author = current_user
        try:
            if not connected:
                other = db.session.get(User, int(target_id))
                if other:
                    author = other
        except Exception:
            author = current_user

        sys_msg = Message(channel_id=dm_ch.id, user_id=int(author.id), content=kind)
        db.session.add(sys_msg)
        db.session.commit()

        sys_payload = {
            "id": sys_msg.id,
            "user": author.username,
            "user_id": int(author.id),
            "avatar_url": getattr(author, "avatar_url", "") or "",
            "content": sys_msg.content,
            "created_at": _fmt_msk(sys_msg.created_at),
            "created_day_key": _fmt_day_key_msk(sys_msg.created_at),
            "created_day_label": _fmt_day_label_ru(sys_msg.created_at),
            "channel_id": dm_ch.id,
            "attachments": [],
            "receipt": None,
            "edited_at": "",
            "deleted_at": "",
            "is_pinned": False,
            "pinned_by": 0,
            "reactions": {},
            "my_reactions": [],
        }
        try:
            socketio.emit("new_message", sys_payload, to=f"channel_{dm_ch.id}")
        except Exception:
            pass
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass

    # Default: call fully ended / missed. Mark as final so the client does NOT
    # treat it as a transient drop and start auto-reconnect.
    _emit_to_user(target_id, "call_rejected", {"from_id": current_user.id, "final": True})

@socketio.on("ice_candidate")
def handle_ice_candidate(data):
    if not current_user.is_authenticated:
        return
    target_id = int(data.get("target_id"))
    candidate = data.get("candidate")
    if not candidate:
        return
    _emit_to_user(
        target_id,
        "ice_candidate",
        {"from_id": current_user.id, "candidate": candidate},
    )

@socketio.on("call_heartbeat")
def handle_call_heartbeat(data):
    """Keep DM call session alive for reconnect.

    Client pings every ~20s while connected so /api/current_call
    keeps returning active even for long calls.
    """
    if not current_user.is_authenticated:
        return
    try:
        target_id = int(data.get("target_id") or 0)
    except Exception:
        return
    if not target_id:
        return
    low = min(current_user.id, target_id)
    high = max(current_user.id, target_id)
    session = CallSession.query.filter_by(
        user1_id=low, user2_id=high, active=True
    ).first()
    if not session:
        return
    session.started_at = utcnow()
    db.session.commit()
@socketio.on("group_join")
def handle_group_join(data):
    if not current_user.is_authenticated:
        return
    channel_id = int(data.get("channel_id") or 0)
    if not channel_id:
        emit("group_join_denied", {"reason": "invalid"})
        return

    # Only allow group calls inside real voice channels, and only for members with role != pending
    ch = None
    try:
        ch = db.session.get(Channel, int(channel_id))
    except Exception:
        ch = None

    if ch is not None:
        ch_type = (getattr(ch, "channel_type", None) or "text").lower()
        if bool(getattr(ch, "is_dm", False)) or ch_type != "voice":
            emit("group_join_denied", {"reason": "text_channel"})
            return

        _, mem = _require_membership(int(channel_id), current_user.id)
        if not mem:
            emit("group_join_denied", {"reason": "no_access"})
            return
        if (getattr(mem, "role", None) or "member") == "pending":
            emit("group_join_denied", {"reason": "pending"})
            return

        # Permission check: connect to voice
        try:
            perms = _effective_channel_perms(ch, mem)
            if not bool(perms.get("connect")):
                emit("group_join_denied", {"reason": "no_connect"})
                return
        except Exception:
            pass

    # join room and announce
    join_room(f"group_{channel_id}")
    group_calls.setdefault(channel_id, set()).add(current_user.id)

    # Adhoc group calls: write a system event into the temporary call chat
    try:
        if ch is None and int(channel_id) in adhoc_group_chats:
            _adhoc_group_chat_add_sys_call(int(channel_id), int(current_user.id), 'joined')
            try:
                st = adhoc_group_chats.get(int(channel_id)) or {}
                if st:
                    st['expires_at'] = datetime.utcnow() + timedelta(hours=24)
            except Exception:
                pass
    except Exception:
        pass

    # Initialize voice state for roster icons
    try:
        voice_states.setdefault(int(channel_id), {})[int(current_user.id)] = {
            "muted": False,
            "deafened": False,
        }
    except Exception:
        pass

    # Broadcast roster update (Discord-like voice member list)
    try:
        _emit_voice_roster_update(_root_id_for_channel(ch) if ch is not None else 0)
    except Exception:
        pass

    # Send peers list
    peers = []
    try:
        for uid in group_calls.get(channel_id, set()):
            if uid == current_user.id:
                continue
            peers.append({"user_id": uid})
    except Exception:
        peers = []

    # Send current peers + explicit screenshare intents (prevents phantom demo tiles)
    screen_intents = {}
    try:
        si = group_screen_intents.get(int(channel_id), {}) or {}
        # prune intents of non-members
        members = set(group_calls.get(int(channel_id), set()) or [])
        for uid in list(si.keys()):
            if uid not in members:
                si.pop(uid, None)
        group_screen_intents[int(channel_id)] = si
        screen_intents = {int(uid): True for uid in si.keys()}
    except Exception:
        screen_intents = {}
    emit("group_peers", {"channel_id": int(channel_id), "peers": peers, "screen_intents": screen_intents})

    # Send current call statuses to the joiner (FIX116 extras)
    try:
        st = group_call_status.get(int(channel_id), {}) or {}
        members = set(group_calls.get(int(channel_id), set()) or [])
        for uid in list(st.keys()):
            if int(uid) not in members:
                st.pop(uid, None)
        group_call_status[int(channel_id)] = st
        emit('group_call_status_bulk', {'channel_id': int(channel_id), 'statuses': st})
    except Exception:
        pass


    # Notify others user joined
    try:
        socketio.emit("group_user_joined", {"channel_id": channel_id, "user_id": current_user.id}, to=f"group_{channel_id}")
    except Exception:
        pass


@socketio.on("group_screen_intent")
def handle_group_screen_intent(data):
    """Explicit screenshare intent for group calls.

    This prevents "phantom" demo tiles: a client shows a remote screenshare only if
    the peer explicitly pressed "Share screen".
    """
    if not current_user.is_authenticated:
        return
    try:
        channel_id = int((data or {}).get("channel_id") or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return
    active = bool((data or {}).get("active"))

    # Only allow intent if the user is actually in this call
    try:
        members = group_calls.get(int(channel_id), set()) or set()
        if int(current_user.id) not in members:
            return
    except Exception:
        return

    try:
        st = group_screen_intents.setdefault(int(channel_id), {})
        if active:
            st[int(current_user.id)] = True
        else:
            st.pop(int(current_user.id), None)
    except Exception:
        return

    try:
        socketio.emit(
            "group_screen_intent",
            {"channel_id": int(channel_id), "user_id": int(current_user.id), "active": bool(active)},
            to=f"group_{channel_id}"
        )
    except Exception:
        pass




@socketio.on("group_call_status")
def handle_group_call_status(data):
    """Per-user status inside a group call (FIX116).

    status: online | busy | ghost
    """
    if not current_user.is_authenticated:
        return
    d = data or {}
    try:
        channel_id = int(d.get('channel_id') or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return
    status = str(d.get('status') or 'online').strip().lower()
    if status not in ('online','busy','ghost'):
        status = 'online'

    # only members of the call can set status
    try:
        members = group_calls.get(int(channel_id), set()) or set()
        if int(current_user.id) not in members:
            return
    except Exception:
        return

    try:
        st = group_call_status.setdefault(int(channel_id), {})
        st[int(current_user.id)] = status
    except Exception:
        return

    try:
        socketio.emit('group_call_status', {
            'channel_id': int(channel_id),
            'user_id': int(current_user.id),
            'status': status
        }, to=f'group_{int(channel_id)}')
    except Exception:
        pass


@socketio.on("group_whiteboard")
def handle_group_whiteboard(data):
    """Broadcast whiteboard strokes for group calls (FIX116).

    Payload is intentionally permissive and sanitized client-side; server only routes it.
    """
    if not current_user.is_authenticated:
        return
    d = data or {}
    try:
        channel_id = int(d.get('channel_id') or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return

    # only members of the call can draw
    try:
        members = group_calls.get(int(channel_id), set()) or set()
        if int(current_user.id) not in members:
            return
    except Exception:
        return

    # soft rate limit (avoid flooding)
    try:
        import time
        key = (int(channel_id), int(current_user.id))
        now = time.time()
        last = float(group_whiteboard_rl.get(key) or 0.0)
        if (now - last) < 0.02:  # ~50fps max
            return
        group_whiteboard_rl[key] = now
    except Exception:
        pass

    payload = {
        'channel_id': int(channel_id),
        'user_id': int(current_user.id),
        'action': str(d.get('action') or 'draw')[:24],
        'stroke': d.get('stroke'),
        'color': str(d.get('color') or '')[:16],
        'size': int(d.get('size') or 2),
        'seq': int(d.get('seq') or 0),
    }
    try:
        socketio.emit('group_whiteboard', payload, to=f'group_{int(channel_id)}')
    except Exception:
        pass

@socketio.on("group_reaction")
def handle_group_reaction(data):
    """Group-call tile reactions (emoji bursts).

    Client sends: {channel_id, type}
    Server broadcasts to room group_{channel_id}: {channel_id, user_id, type}
    """
    if not current_user.is_authenticated:
        return
    try:
        channel_id = int((data or {}).get("channel_id") or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return
    typ = str((data or {}).get("type") or "")[:8]
    if not typ:
        return

    # Only allow reactions from call members
    try:
        members = group_calls.get(int(channel_id), set()) or set()
        if int(current_user.id) not in members:
            return
    except Exception:
        return

    # Basic spam guard
    try:
        now = time.time()
        key = (int(channel_id), int(current_user.id))
        last = float(group_reaction_rl.get(key, 0.0) or 0.0)
        if (now - last) < 0.35:
            return
        group_reaction_rl[key] = now
    except Exception:
        pass

    try:
        socketio.emit(
            "group_reaction",
            {"channel_id": int(channel_id), "user_id": int(current_user.id), "type": typ},
            to=f"group_{int(channel_id)}"
        )
    except Exception:
        pass


@socketio.on("group_leave")

def handle_group_leave(data):
    if not current_user.is_authenticated:
        return
    channel_id = int(data.get("channel_id") or 0)
    if not channel_id:
        return

    # Always leave the Socket.IO room first so the client stops receiving peer events.
    try:
        leave_room(f"group_{channel_id}")
    except Exception:
        pass
    try:
        ch = db.session.get(Channel, int(channel_id))
    except Exception:
        ch = None
    if ch is not None:
        ch_type = (getattr(ch, "channel_type", None) or "text").lower()
        if getattr(ch, "is_dm", False) or ch_type != "voice":
            # Nothing to do (voice rooms are only valid for voice channels; ad-hoc calls ignore this)
            return

    members = group_calls.get(channel_id)
    was_member = False
    if members is not None:
        try:
            was_member = any(str(uid) == str(current_user.id) for uid in (members or []))
        except Exception:
            was_member = False

    if was_member and members is not None:
        # Robustly remove membership even if types drifted (int/str)
        try:
            members.discard(current_user.id)
        except Exception:
            pass
        try:
            members.discard(int(current_user.id))
        except Exception:
            pass
        try:
            members.discard(str(current_user.id))
        except Exception:
            pass
        # Fallback if membership is a list-like structure
        try:
            while current_user.id in members:
                members.remove(current_user.id)
        except Exception:
            pass
        try:
            while int(current_user.id) in members:
                members.remove(int(current_user.id))
        except Exception:
            pass
        try:
            while str(current_user.id) in members:
                members.remove(str(current_user.id))
        except Exception:
            pass
        if not members:
            group_calls.pop(channel_id, None)

    # Clear screenshare intent (avoid lingering demo tiles)
    try:
        st = group_screen_intents.get(int(channel_id))
        if st is not None:
            removed = st.pop(int(current_user.id), None)
            if removed is not None:
                socketio.emit(
                    "group_screen_intent",
                    {"channel_id": int(channel_id), "user_id": int(current_user.id), "active": False},
                    to=f"group_{channel_id}",
                )
            if not st:
                group_screen_intents.pop(int(channel_id), None)
    except Exception:
        pass

    # Clean voice state even if membership tracking was out of sync.
    try:
        vs = voice_states.get(int(channel_id))
        if vs and int(current_user.id) in vs:
            vs.pop(int(current_user.id), None)
        if vs is not None and not vs:
            voice_states.pop(int(channel_id), None)
    except Exception:
        pass

    # Broadcast roster update (Discord-like voice member list)
    try:
        _emit_voice_roster_update(_root_id_for_channel(ch) if ch is not None else 0)
    except Exception:
        pass

    # notify remaining peers (only if we actually were in the set)
    if was_member and members is not None:
        for uid in list(members):
            _emit_to_user(
                uid,
                "group_user_left",
                {
                    "channel_id": channel_id,
                    "user_id": current_user.id,
                },
            )

    # broadcast to room as well (more reliable than per-sid delivery)
    try:
        socketio.emit(
            "group_user_left",
            {"channel_id": channel_id, "user_id": int(current_user.id)},
            to=f"group_{channel_id}",
        )
    except Exception:
        pass


    
    # Ad-hoc (DM) group call: broadcast member list/count for sidebar badges
    try:
        if ch is None and int(channel_id) in adhoc_group_chats:
            st = adhoc_group_chats.get(int(channel_id)) or {}
            members = list(st.get("members") or [])
            socketio.emit("adhoc_group_chat_members", {
                "channel_id": int(channel_id),
                "members": members,
                "member_count": len(members),
                "expires_at": (st.get("expires_at").isoformat() if st.get("expires_at") else ""),
            "member_count": len(st.get("members") or []),
                "title": st.get("title") or "Групповой звонок",
            }, to=_adhoc_gc_room(int(channel_id)))
    except Exception:
        pass

# Ad-hoc (DM) group call: write system leave/end events into the temporary chat
    try:
        if ch is None and int(channel_id) in adhoc_group_chats:
            _adhoc_group_chat_add_sys_call(int(channel_id), int(current_user.id), 'left')
            # If the call just became empty, mark as ended
            try:
                still = group_calls.get(int(channel_id)) or set()
                if not still:
                    _adhoc_group_chat_add_sys_call(int(channel_id), int(current_user.id), 'ended')
            except Exception:
                pass
    except Exception:
        pass

@socketio.on("voice_state_update")
def handle_voice_state_update(data):
    """Update voice state (muted/deafened) for Discord-like roster icons."""
    if not current_user.is_authenticated:
        return
    try:
        channel_id = int((data or {}).get("channel_id") or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return

    # Only for real voice channels where the user is currently joined
    try:
        if int(current_user.id) not in (group_calls.get(int(channel_id)) or set()):
            return
    except Exception:
        return

    muted = bool((data or {}).get("muted"))
    deafened = bool((data or {}).get("deafened"))

    try:
        voice_states.setdefault(int(channel_id), {})[int(current_user.id)] = {
            "muted": muted,
            "deafened": deafened,
        }
    except Exception:
        pass

    # Broadcast roster update for the guild so clients can redraw icons
    try:
        ch = db.session.get(Channel, int(channel_id))
    except Exception:
        ch = None
    try:
        gid = int(_root_id_for_channel(ch)) if ch else 0
        if gid:
            _emit_voice_roster_update(gid)
    except Exception:
        pass

@socketio.on("group_offer")
def handle_group_offer(data):
    if not current_user.is_authenticated:
        return
    target_id = int(data.get("target_id") or 0)
    offer = data.get("offer")
    channel_id = int(data.get("channel_id") or 0)
    if not target_id or not offer or not channel_id:
        return

    # Allow both:
    #  - real voice channels (must pass membership/perms)
    #  - adhoc group calls (channel_id not present in Channel table)
    ch = None
    try:
        ch = db.session.get(Channel, int(channel_id))
    except Exception:
        ch = None

    if ch is not None:
        ch_type = (getattr(ch, "channel_type", None) or "text").lower()

        # Allow group calls (including screenshare renegotiation) in:
        #  - voice channels (permission-gated)
        #  - adhoc/group chats (membership-gated)
        # Block DM channels here (DM uses separate signaling).
        if bool(getattr(ch, "is_dm", False)):
            return

        _, mem = _require_membership(int(channel_id), current_user.id)
        if not mem:
            return
        if (getattr(mem, "role", None) or "member") == "pending":
            return

        # Permission check only for voice channels
        if ch_type == "voice":
            try:
                perms = _effective_channel_perms(ch, mem)
                if not bool(perms.get("connect")):
                    return
            except Exception:
                pass

    # Sender must have joined the call (works for both voice + adhoc)
    if current_user.id not in group_calls.get(channel_id, set()):
        return

    _emit_to_user(
        target_id,
        "group_offer",
        {"channel_id": channel_id, "from_id": current_user.id, "offer": offer},
    )


@socketio.on("group_answer")
def handle_group_answer(data):
    if not current_user.is_authenticated:
        return
    target_id = int(data.get("target_id") or 0)
    answer = data.get("answer")
    channel_id = int(data.get("channel_id") or 0)
    if not target_id or not answer or not channel_id:
        return

    ch = None
    try:
        ch = db.session.get(Channel, int(channel_id))
    except Exception:
        ch = None

    if ch is not None:
        ch_type = (getattr(ch, "channel_type", None) or "text").lower()

        # Allow group call renegotiation (incl. screenshare) in group chats as well.
        # Block DM channels here (DM uses separate signaling).
        if bool(getattr(ch, "is_dm", False)):
            return

        _, mem = _require_membership(int(channel_id), current_user.id)
        if not mem:
            return
        if (getattr(mem, "role", None) or "member") == "pending":
            return

        # Permission check only for voice channels
        if ch_type == "voice":
            try:
                perms = _effective_channel_perms(ch, mem)
                if not bool(perms.get("connect")):
                    return
            except Exception:
                pass

    if current_user.id not in group_calls.get(channel_id, set()):
        return

    _emit_to_user(
        target_id,
        "group_answer",
        {"channel_id": channel_id, "from_id": current_user.id, "answer": answer},
    )


@socketio.on("group_ice_candidate")
def handle_group_ice_candidate(data):
    if not current_user.is_authenticated:
        return
    target_id = int(data.get("target_id") or 0)
    candidate = data.get("candidate")
    channel_id = int(data.get("channel_id") or 0)
    if not target_id or not candidate or not channel_id:
        return

    ch = None
    try:
        ch = db.session.get(Channel, int(channel_id))
    except Exception:
        ch = None

    if ch is not None:
        ch_type = (getattr(ch, "channel_type", None) or "text").lower()

        # Allow group call renegotiation (incl. screenshare) in group chats as well.
        # Block DM channels here (DM uses separate signaling).
        if bool(getattr(ch, "is_dm", False)):
            return

        _, mem = _require_membership(int(channel_id), current_user.id)
        if not mem:
            return
        if (getattr(mem, "role", None) or "member") == "pending":
            return

        # Permission check only for voice channels
        if ch_type == "voice":
            try:
                perms = _effective_channel_perms(ch, mem)
                if not bool(perms.get("connect")):
                    return
            except Exception:
                pass

    if current_user.id not in group_calls.get(channel_id, set()):
        return

    _emit_to_user(
        target_id,
        "group_ice_candidate",
        {"channel_id": channel_id, "from_id": current_user.id, "candidate": candidate},
    )


@socketio.on("adhoc_group_invite")
def handle_adhoc_group_invite(data):
    """Relay an ad-hoc (DM) group call invite.

    Client payload:
      {channel_id: <int>, target_ids: [<int>...], title?: str}
    """
    if not current_user.is_authenticated:
        return
    d = data or {}
    try:
        channel_id = int(d.get("channel_id") or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return
    targets = d.get("target_ids") or d.get("targets") or []
    if not isinstance(targets, list):
        # accept single target_id too
        try:
            tid = int(d.get("target_id") or 0)
        except Exception:
            tid = 0
        targets = [tid] if tid else []
    # Save host mapping
    try:
        adhoc_group_hosts[int(channel_id)] = int(current_user.id)
    except Exception:
        pass

    title = str(d.get("title") or "Групповой звонок")
    from_name = None
    try:
        from_name = getattr(current_user, "username", None) or getattr(current_user, "name", None) or None
    except Exception:
        from_name = None

    # Resolve allowed targets (respect DM access rules)
    allowed_targets: list[int] = []
    for tid in targets:
        try:
            target_id = int(tid or 0)
        except Exception:
            target_id = 0
        if not target_id:
            continue
        try:
            if not _dm_can_send(int(current_user.id), int(target_id)):
                continue
        except Exception:
            continue
        allowed_targets.append(int(target_id))

    # Create/update temporary group chat immediately after invite (Discord-like)
    try:
        st = _ensure_adhoc_group_chat(int(channel_id), title, set([int(current_user.id), *allowed_targets]))
        payload_created = {
            "channel_id": int(channel_id),
            "title": st.get("title") or title,
            "host_id": int(current_user.id),
            "host_name": from_name,
            "expires_at": (st.get("expires_at").isoformat() if st.get("expires_at") else ""),
            "member_count": len(st.get("members") or []),
        }
        # Notify host and targets so the chat appears right away in the DM sidebar
        _emit_to_user(int(current_user.id), "adhoc_group_chat_created", payload_created)
        for target_id in allowed_targets:
            _emit_to_user(int(target_id), "adhoc_group_chat_created", payload_created)
    
        # System event in the temporary call chat (Discord-like)
        try:
            _adhoc_group_chat_add_sys_call(int(channel_id), int(current_user.id), 'started')
        except Exception:
            pass
    except Exception:
        pass

    # Send the call invite popup to targets
    for target_id in allowed_targets:
        _emit_to_user(
            int(target_id),
            "adhoc_group_invite",
            {
                "channel_id": int(channel_id),
                "from_id": int(current_user.id),
                "from_name": from_name,
                "title": title,
            },
        )


@socketio.on("adhoc_group_decline")
def handle_adhoc_group_decline(data):
    """Receiver declined an ad-hoc group call invite."""
    if not current_user.is_authenticated:
        return
    d = data or {}
    try:
        channel_id = int(d.get("channel_id") or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return

    host_id = 0
    try:
        host_id = int(d.get("host_id") or 0)
    except Exception:
        host_id = 0
    if not host_id:
        try:
            host_id = int(adhoc_group_hosts.get(int(channel_id)) or 0)
        except Exception:
            host_id = 0
    if not host_id:
        return

    _emit_to_user(
        host_id,
        "adhoc_group_declined",
        {"channel_id": int(channel_id), "user_id": int(current_user.id)},
    )

    # Also append a system message into the temporary call chat (Discord-like)
    try:
        if int(channel_id) in adhoc_group_chats:
            _adhoc_group_chat_add_sys_call(int(channel_id), int(current_user.id), 'declined')
    except Exception:
        pass




@socketio.on("adhoc_group_chat_sync")
def handle_adhoc_group_chat_sync(_data=None):
    """Client requests a re-sync of visible ad-hoc group chats (e.g., after refresh)."""
    if not current_user.is_authenticated:
        return
    try:
        _emit_adhoc_group_chat_list(int(current_user.id))
    except Exception:
        pass

@socketio.on("adhoc_group_chat_join")
def handle_adhoc_group_chat_join(data):
    """Join / fetch the temporary ad-hoc group chat (in-memory only)."""
    if not current_user.is_authenticated:
        return
    _cleanup_expired_adhoc_group_chats()
    d = data or {}
    try:
        channel_id = int(d.get("channel_id") or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return
    st = adhoc_group_chats.get(int(channel_id))
    if not st:
        _emit_to_user(int(current_user.id), "adhoc_group_chat_deleted", {"channel_id": int(channel_id)})
        return
    # must be a member
    try:
        if int(current_user.id) not in set(st.get("members") or set()):
            # allow host or invitee who can be DM'ed
            if not _dm_can_send(int(current_user.id), int(adhoc_group_hosts.get(int(channel_id)) or 0)):
                return
            try:
                st["members"].add(int(current_user.id))
            except Exception:
                pass
    except Exception:
        pass

    # Touch TTL on join (sliding 24h)
    try:
        _ensure_adhoc_group_chat(int(channel_id), st.get("title") or "Групповой звонок", set(st.get("members") or set()))
        st = adhoc_group_chats.get(int(channel_id)) or st
    except Exception:
        pass

    try:
        join_room(_adhoc_gc_room(int(channel_id)))
    except Exception:
        pass

    payload = {
        "channel_id": int(channel_id),
        "title": st.get("title") or "Групповой звонок",
        "expires_at": (st.get("expires_at").isoformat() if st.get("expires_at") else ""),
            "member_count": len(st.get("members") or []),
        "members": list(st.get("members") or []),
        "messages": list(st.get("messages") or []),
    }
    _emit_to_user(int(current_user.id), "adhoc_group_chat_info", payload)


@socketio.on("adhoc_group_chat_message")
def handle_adhoc_group_chat_message(data):
    """Send message to the temporary ad-hoc group chat (broadcast to members)."""
    if not current_user.is_authenticated:
        return
    _cleanup_expired_adhoc_group_chats()
    d = data or {}
    try:
        channel_id = int(d.get("channel_id") or 0)
    except Exception:
        channel_id = 0
    if not channel_id:
        return
    st = adhoc_group_chats.get(int(channel_id))
    if not st:
        _emit_to_user(int(current_user.id), "adhoc_group_chat_deleted", {"channel_id": int(channel_id)})
        return
    content = str(d.get("content") or "")
    if not content.strip():
        return
    client_nonce = str(d.get("client_nonce") or "")

    # must be member
    try:
        if int(current_user.id) not in set(st.get("members") or set()):
            return
    except Exception:
        return

    # Touch TTL on activity (sliding 24h)
    try:
        _ensure_adhoc_group_chat(int(channel_id), st.get("title") or "Групповой звонок", set(st.get("members") or set()))
        st = adhoc_group_chats.get(int(channel_id)) or st
    except Exception:
        pass

    msg = _adhoc_group_chat_make_msg(int(channel_id), int(current_user.id), content, client_nonce=client_nonce)
    try:
        st["messages"].append(msg)
        # keep last 500
        if len(st["messages"]) > 500:
            st["messages"] = st["messages"][-500:]
    except Exception:
        pass

    try:
        socketio.emit("adhoc_group_chat_message", msg, room=_adhoc_gc_room(int(channel_id)))
    except Exception:
        # fallback: send to each member
        for uid in list(st.get("members") or []):
            try:
                _emit_to_user(int(uid), "adhoc_group_chat_message", msg)
            except Exception:
                pass


@socketio.on("music_control")
def handle_music_control(data):
    if not current_user.is_authenticated:
        return
    d = data or {}
    try:
        target_id = int(d.get("target_id") or 0)
    except Exception:
        target_id = 0
    action = d.get("action")
    value = d.get("value", None)
    if not target_id or not action:
        return
    _emit_to_user(
        target_id,
        "music_control",
        {"from_id": int(current_user.id), "action": action, "value": value},
    )

@socketio.on("music_state")
def handle_music_state(data):
    if not current_user.is_authenticated:
        return
    d = data or {}
    try:
        target_id = int(d.get("target_id") or 0)
    except Exception:
        target_id = 0
    state = d.get("state")
    if not target_id or state is None:
        return
    _emit_to_user(
        target_id,
        "music_state",
        {"from_id": int(current_user.id), "state": state},
    )


@socketio.on("music_link")
def handle_music_link(data):
    """Sync music playback by URL (each client plays locally; no streaming).

    DM payload: {target_id, action, url, startAt}
    Group voice payload: {channel_id, action, url, startAt}
    """
    if not current_user.is_authenticated:
        return
    d = data or {}

    # DM target
    try:
        target_id = int(d.get("target_id") or 0)
    except Exception:
        target_id = 0

    # Group voice channel target
    try:
        channel_id = int(d.get("channel_id") or 0)
    except Exception:
        channel_id = 0

    action = str(d.get("action") or "play")
    url = str(d.get("url") or "")
    start_at = d.get("startAt")

    payload = {
        "from_id": int(current_user.id),
        "action": action,
        "url": url,
        "startAt": start_at,
    }

    # DM: relay to target user
    if target_id:
        _emit_to_user(target_id, "music_link", payload)
        return

    # Group: broadcast to all in active group call
    if channel_id:
        try:
            participants = group_calls.get(channel_id, set())
        except Exception:
            participants = set()
        for uid in list(participants):
            try:
                if int(uid) == int(current_user.id):
                    continue
            except Exception:
                pass
            _emit_to_user(int(uid), "music_link", {**payload, "channel_id": channel_id})
        return

@socketio.on("dm_screen_state")
def handle_dm_screen_state(data):
    if not current_user.is_authenticated:
        return
    d = data or {}
    try:
        target_id = int(d.get("target_id") or 0)
    except Exception:
        target_id = 0
    active = d.get("active", None)
    if not target_id or active is None:
        return
    _emit_to_user(
        target_id,
        "dm_screen_state",
        {"from_id": int(current_user.id), "active": bool(active)},
    )




# --- Hotfix fallback auth routes ---
# Some builds ended up with recover routes not registered in time, which breaks
# url_for('recover_password') during login page rendering. These top-level routes
# are safe fallbacks and keep /login working even if the nested registrations were
# skipped by a bad merge/indentation.
@app.route("/recover", methods=["GET", "POST"], endpoint="recover_password")
def _recover_password_fallback():
    if current_user.is_authenticated:
        return redirect(url_for("chat"))
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        code = (request.form.get("code") or "").strip().upper()
        p1 = request.form.get("password") or ""
        p2 = request.form.get("password2") or ""

        if p1 != p2:
            flash("Пароли не совпадают.", "error")
            return render_template("recover.html")

        if not (8 <= len(p1) <= 24):
            flash("Пароль должен быть от 8 до 24 символа.", "error")
            return render_template("recover.html")

        ok, msg = _validate_password(p1, username=username)
        if not ok:
            flash(msg, "error")
            return render_template("recover.html")

        user = None
        try:
            user = User.query.filter_by(username_norm=_norm_username(username)).first()
        except Exception:
            user = None
        if not user:
            user = User.query.filter_by(username=username).first()
        if not user:
            flash("Неверные данные.", "error")
            return render_template("recover.html")

        if not _use_recovery_code(user.id, code):
            flash("Неверный или уже использованный код восстановления.", "error")
            return render_template("recover.html")

        user.set_password(p1)
        db.session.commit()
        flash("Пароль обновлён. Теперь можно войти.", "ok")
        return redirect(url_for("login"))

    return render_template("recover.html")


@app.route("/forgot", methods=["GET", "POST"], endpoint="forgot_password")
def _forgot_password_fallback():
    return redirect("/recover")


@app.route("/reset/<token>", methods=["GET", "POST"], endpoint="reset_password")
def _reset_password_fallback(token: str):
    return redirect("/recover")


if __name__ == "__main__":
    create_app()

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 5000))

    # HTTPS is REQUIRED for microphone / screen-audio in modern browsers
    # (except localhost). In production, deploy behind Nginx + Let's Encrypt.
    # For quick testing you can either:
    #  - provide real cert paths: SSL_CERT=/path/fullchain.pem SSL_KEY=/path/privkey.pem
    #  - or use Werkzeug's self-signed cert: SSL_ADHOC=1 (shows browser warning)
    ssl_ctx = None
    try:
        cert = (os.environ.get("SSL_CERT") or "").strip()
        key = (os.environ.get("SSL_KEY") or "").strip()
        if cert and key:
            ssl_ctx = (cert, key)
        elif (os.environ.get("SSL_ADHOC") or "").strip() in ("1", "true", "yes"):
            ssl_ctx = "adhoc"
    except Exception:
        ssl_ctx = None

    socketio.run(app, host=host, port=port, ssl_context=ssl_ctx)


