/* Semantic script */

(() => {
  'use strict';

  const SYNC_URL = '/api/settings_kv';
  const KEY_RE = /^nc_[a-zA-Z0-9_:\-\.]+$/;
  const EXTRA_KEYS = new Set(['nc_settings_ui_state', 'nc_chat_settings']);

  function canSyncKey(k) {
    if (!k) return false;
    if (EXTRA_KEYS.has(k)) return true;
    return KEY_RE.test(k);
  }

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }

  function lsSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  function lsKeys() {
    try {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) out.push(k);
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  let pending = {};
  let timer = null;
  let inFlight = false;

  function scheduleSend() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void sendNow();
    }, 350);
  }

  async function sendNow() {
    if (inFlight) return;
    const patch = pending;
    pending = {};
    if (!patch || Object.keys(patch).length === 0) return;

    inFlight = true;
    try {
      await fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ patch })
      });
    } catch (e) {
      // ignore; next change will retry
    } finally {
      inFlight = false;
      if (Object.keys(pending).length) scheduleSend();
    }
  }

  function queuePatch(k, v) {
    if (!canSyncKey(k)) return;
    pending[k] = v;
    scheduleSend();
  }

  async function boot() {
    let server = {};
    try {
      const r = await fetch(SYNC_URL, { credentials: 'same-origin' });
      if (r && r.ok) {
        const j = await r.json();
        server = (j && j.settings && typeof j.settings === 'object') ? j.settings : {};
      }
    } catch (e) {
      server = {};
    }

    // Apply server settings to localStorage if the key is missing locally.
    try {
      Object.keys(server).forEach((k) => {
        if (!canSyncKey(k)) return;
        const local = lsGet(k);
        if (local === null || typeof local === 'undefined') {
          const sv = String(server[k]);
          lsSet(k, sv);
        }
      });
    } catch (e) {}

    // Upload local settings that differ from server.
    const patch = {};
    try {
      lsKeys().forEach((k) => {
        if (!canSyncKey(k)) return;
        const lv = lsGet(k);
        if (lv === null) return;
        const sv = (typeof server[k] === 'undefined') ? null : String(server[k]);
        if (sv !== lv) patch[k] = lv;
      });
    } catch (e) {}

    if (Object.keys(patch).length) {
      try {
        await fetch(SYNC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ patch })
        });
      } catch (e) {}
    }
  }

  // Intercept localStorage changes so every setting toggle gets persisted.
  try {
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      const res = origSet.apply(this, arguments);
      if (this === localStorage) queuePatch(String(k), String(v));
      return res;
    };

    const origRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) {
      const res = origRemove.apply(this, arguments);
      if (this === localStorage) queuePatch(String(k), null);
      return res;
    };
  } catch (e) {
    // If overriding Storage fails, we still do initial sync.
  }

  // Run as early as possible (defer script keeps order).
  void boot();
})();
