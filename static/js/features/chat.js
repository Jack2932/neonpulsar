/* Semantic script */

/*
  FIX116 extras (10/10 pack)
  - PiP mini-window for active screenshare
  - Screenshot (snapshot) capture (download or upload to chat)
  - Whiteboard overlay synced in group calls
  - Call statuses (online/busy/ghost) shown on tiles
  - Sticky timecode bar while scrolling chat
  - Lightweight activity heatline (top speakers)

  Designed to be defensive: if a feature can't find expected DOM/state, it quietly no-ops.
*/

(function(){
  'use strict';

  const _log = (...a)=>{ try{ console.log('[NEONCHAT] FIX116 extras', ...a); }catch(e){} };
  const _toast = (msg, bad=false)=>{
    try{ if (typeof ncToast === 'function') return ncToast(String(msg||''), bad); }catch(e){}
    try{ if (!bad) console.log(msg); else console.warn(msg); }catch(e){}
  };

  // ---------------- Online badge: restyle to "В сети · N" (keeps .nc-online-count for main.js updater)
  function patchOnlineBadge(){
    try{
      const el = document.getElementById('nc-online-counter');
      if (!el) return;
      if (!el.querySelector('.nc-online-count')) return;
      // Build a consistent structure once
      if (!el.querySelector('.nc-online-sep')) {
        el.innerHTML = '<span class="nc-online-dot" aria-hidden="true"></span>'+
                       '<span class="nc-online-label">В сети</span>'+
                       '<span class="nc-online-sep" aria-hidden="true">·</span>'+
                       '<span class="nc-online-count">'+(el.querySelector('.nc-online-count')?.textContent||'—')+'</span>';
      } else {
        const lbl = el.querySelector('.nc-online-label');
        if (lbl) lbl.textContent = 'В сети';
      }
      // Small style override (only if not already present)
      if (!document.getElementById('nc-online-style-fix116')) {
        const st = document.createElement('style');
        st.id = 'nc-online-style-fix116';
        st.textContent = `
          .nc-online-badge{ pointer-events:none; }
          .nc-online-label{ text-transform:none !important; letter-spacing:.2px !important; }
          .nc-online-sep{ opacity:.65; font-weight:900; }
          .nc-online-count{ padding-left:0 !important; border-left:none !important; font-weight:900; }
        `;
        document.head.appendChild(st);
      }
    }catch(e){}
  }

  // ---------------- Helpers
  function isInGroupCall(){
    try{ return !!(typeof groupCallActive !== 'undefined' && groupCallActive && typeof groupCallChannelId !== 'undefined' && groupCallChannelId); }catch(e){ return false; }
  }
  function getGroupCallId(){
    try{ return (typeof groupCallChannelId !== 'undefined') ? groupCallChannelId : null; }catch(e){ return null; }
  }
  function getSocket(){
    try{ if (typeof socket !== 'undefined' && socket && typeof socket.emit === 'function') return socket; }catch(e){}
    return null;
  }
  function q(sel, root=document){ try{ return root.querySelector(sel); }catch(e){ return null; } }
  function qa(sel, root=document){ try{ return Array.from(root.querySelectorAll(sel)||[]); }catch(e){ return []; } }

  // ---------------- PiP
  let pipEl = null;
  let pipVideo = null;
  let pipVisible = false;
  let pipDrag = null;

  function getActiveShareVideo(){
    try{
      const v1 = document.getElementById('voice-share-video');
      if (v1 && v1.srcObject && v1.readyState >= 2 && !v1.classList.contains('is-hidden') && v1.offsetParent !== null) return v1;
      const v2 = document.getElementById('call-screen-video');
      if (v2 && v2.srcObject && v2.readyState >= 2 && v2.offsetParent !== null) return v2;
      // fallback: any visible video with a stream
      const vids = qa('video');
      for (const v of vids){
        try{ if (v && v.srcObject && v.readyState >= 2 && v.offsetParent !== null) return v; }catch(e){}
      }
    }catch(e){}
    return null;
  }

  function ensurePiP(){
    if (pipEl) return;
    pipEl = document.createElement('div');
    pipEl.className = 'nc-pip is-hidden';
    pipEl.id = 'nc-pip';
    pipEl.innerHTML = `
      <div class="drag-hint" aria-hidden="true"></div>
      <video autoplay playsinline muted></video>
      <div class="bar">
        <div class="title"><span aria-hidden="true">🧊</span><span>PiP</span></div>
        <div class="actions">
          <button class="mini-btn" type="button" title="Сменить источник" aria-label="Сменить источник">⇄</button>
          <button class="mini-btn" type="button" title="Закрыть" aria-label="Закрыть">✕</button>
        </div>
      </div>
    `;
    document.body.appendChild(pipEl);
    pipVideo = q('video', pipEl);

    const btnSwap = qa('button', pipEl)[0];
    const btnClose = qa('button', pipEl)[1];
    if (btnClose) btnClose.addEventListener('click', ()=> setPiP(false));
    if (btnSwap) btnSwap.addEventListener('click', ()=> syncPiP(true));

    // drag
    const drag = q('.drag-hint', pipEl);
    if (drag) {
      drag.addEventListener('pointerdown', (e)=>{
        if (!pipEl) return;
        pipEl.classList.add('is-dragging');
        const r = pipEl.getBoundingClientRect();
        pipDrag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
        try{ drag.setPointerCapture(e.pointerId); }catch(_){}
      });
      drag.addEventListener('pointermove', (e)=>{
        if (!pipDrag || e.pointerId !== pipDrag.id) return;
        const x = Math.max(8, Math.min(window.innerWidth - 40, e.clientX - pipDrag.dx));
        const y = Math.max(8, Math.min(window.innerHeight - 40, e.clientY - pipDrag.dy));
        pipEl.style.left = x + 'px';
        pipEl.style.top = y + 'px';
        pipEl.style.right = 'auto';
        pipEl.style.bottom = 'auto';
      });
      const end = (e)=>{
        if (!pipDrag || e.pointerId !== pipDrag.id) return;
        pipDrag = null;
        pipEl?.classList.remove('is-dragging');
      };
      drag.addEventListener('pointerup', end);
      drag.addEventListener('pointercancel', end);
    }
  }

  function syncPiP(force=false){
    try{
      if (!pipVisible) return;
      const src = getActiveShareVideo();
      if (!src || !src.srcObject) {
        _toast('Нет активной демки для PiP', true);
        return;
      }
      if (pipVideo && (force || pipVideo.srcObject !== src.srcObject)) {
        pipVideo.srcObject = src.srcObject;
        try{ pipVideo.muted = true; pipVideo.volume = 0; }catch(e){}
        try{ pipVideo.play(); }catch(e){}
      }
    }catch(e){}
  }

  function setPiP(on){
    ensurePiP();
    pipVisible = !!on;
    try{ pipEl.classList.toggle('is-hidden', !pipVisible); }catch(e){}
    if (pipVisible) syncPiP(true);
  }

  // ---------------- Snapshot
  async function snapshotShare(){
    try{
      const v = getActiveShareVideo();
      if (!v || !v.videoWidth || !v.videoHeight) {
        _toast('Нет активной демки для снимка', true);
        return;
      }
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((res)=>c.toBlob(res, 'image/png', 0.92));
      if (!blob) throw new Error('toBlob failed');
      const name = `neonchat_snapshot_${Date.now()}.png`;
      const file = new File([blob], name, { type: 'image/png' });

      // If in chat channel that supports attachments -> upload; else download.
      let canUpload = false;
      try{ canUpload = !!(typeof currentChannelId !== 'undefined' && currentChannelId && String(currentChannelType||'') !== 'adhoc_group'); }catch(e){ canUpload = false; }
      if (canUpload) {
        try{
          const fd = new FormData();
          fd.append('channel_id', String(currentChannelId));
          fd.append('content', '📸 Снимок демки');
          fd.append('files', file, file.name);
          const r = await fetch('/api/upload', { method:'POST', body: fd });
          const j = await r.json().catch(()=>null);
          if (!r.ok || (j && j.error)) throw new Error((j && j.error) || ('HTTP '+r.status));
          _toast('Снимок отправлен в чат');
          return;
        }catch(e){
          _toast('Не удалось отправить снимок в чат — скачаю файлом', true);
        }
      }

      // Download fallback
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} }, 2000);
      _toast('Снимок скачан');
    }catch(e){
      _toast('Снимок не получился', true);
    }
  }

  // ---------------- Whiteboard (group calls)
  let wbEl = null;
  let wbCanvas = null;
  let wbCtx = null;
  let wbOpen = false;
  let wbDraw = null;
  let wbSeq = 0;
  let wbColor = '#7dffe9';
  let wbSize = 3;

  function ensureWhiteboard(){
    if (wbEl) return;
    wbEl = document.createElement('div');
    wbEl.className = 'nc-wb is-hidden';
    wbEl.id = 'nc-whiteboard';
    wbEl.innerHTML = `
      <canvas></canvas>
      <div class="panel">
        <span class="lbl">Whiteboard</span>
        <input class="wb-color" type="color" value="#7dffe9" title="Цвет" aria-label="Цвет" />
        <input class="wb-size" type="range" min="1" max="16" value="3" title="Толщина" aria-label="Толщина" />
        <button class="wb-btn wb-clear" type="button">Очистить</button>
        <button class="wb-btn wb-close" type="button">Закрыть</button>
      </div>
    `;
    document.body.appendChild(wbEl);
    wbCanvas = q('canvas', wbEl);
    wbCtx = wbCanvas ? wbCanvas.getContext('2d') : null;

    const inpC = q('.wb-color', wbEl);
    const inpS = q('.wb-size', wbEl);
    const btnClr = q('.wb-clear', wbEl);
    const btnClose = q('.wb-close', wbEl);
    if (inpC) inpC.addEventListener('input', ()=>{ wbColor = inpC.value || wbColor; });
    if (inpS) inpS.addEventListener('input', ()=>{ wbSize = parseInt(inpS.value||'3',10) || 3; });
    if (btnClose) btnClose.addEventListener('click', ()=> setWhiteboard(false));
    if (btnClr) btnClr.addEventListener('click', ()=> whiteboardClear(true));

    // Resize
    const resize = ()=>{
      try{
        if (!wbCanvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, wbEl.clientWidth);
        const h = Math.max(1, wbEl.clientHeight);
        wbCanvas.width = Math.floor(w * dpr);
        wbCanvas.height = Math.floor(h * dpr);
        wbCanvas.style.width = w + 'px';
        wbCanvas.style.height = h + 'px';
        if (wbCtx) wbCtx.setTransform(dpr,0,0,dpr,0,0);
      }catch(e){}
    };
    window.addEventListener('resize', resize);
    resize();

    function drawLine(x1,y1,x2,y2, color, size){
      if (!wbCtx) return;
      wbCtx.lineCap = 'round';
      wbCtx.lineJoin = 'round';
      wbCtx.strokeStyle = color;
      wbCtx.lineWidth = size;
      wbCtx.beginPath();
      wbCtx.moveTo(x1,y1);
      wbCtx.lineTo(x2,y2);
      wbCtx.stroke();
    }

    function norm(x,y){
      const r = wbCanvas.getBoundingClientRect();
      const nx = (x - r.left) / Math.max(1, r.width);
      const ny = (y - r.top) / Math.max(1, r.height);
      return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)), w: r.width, h: r.height };
    }
    function denorm(nx,ny){
      const r = wbCanvas.getBoundingClientRect();
      return { x: nx * r.width, y: ny * r.height };
    }

    // pointer drawing
    wbCanvas.addEventListener('pointerdown', (e)=>{
      if (!wbOpen) return;
      wbCanvas.setPointerCapture?.(e.pointerId);
      const n = norm(e.clientX, e.clientY);
      wbDraw = { id: e.pointerId, last: { nx: n.nx, ny: n.ny } };
    });
    wbCanvas.addEventListener('pointermove', (e)=>{
      if (!wbOpen || !wbDraw || e.pointerId !== wbDraw.id) return;
      const n = norm(e.clientX, e.clientY);
      const a = wbDraw.last;
      wbDraw.last = { nx: n.nx, ny: n.ny };
      const p1 = denorm(a.nx, a.ny);
      const p2 = denorm(n.nx, n.ny);
      drawLine(p1.x,p1.y,p2.x,p2.y, wbColor, wbSize);
      emitWhiteboardDraw(a.nx,a.ny,n.nx,n.ny, wbColor, wbSize);
    });
    const end = (e)=>{ if (wbDraw && e.pointerId===wbDraw.id) wbDraw=null; };
    wbCanvas.addEventListener('pointerup', end);
    wbCanvas.addEventListener('pointercancel', end);

    // close on ESC
    document.addEventListener('keydown', (e)=>{
      if (!wbOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); setWhiteboard(false); }
    }, true);
  }

  function emitWhiteboardDraw(nx1,ny1,nx2,ny2,color,size){
    try{
      const s = getSocket();
      const cid = getGroupCallId();
      if (!s || !cid) return;
      wbSeq += 1;
      s.emit('group_whiteboard', {
        channel_id: cid,
        action: 'draw',
        stroke: { p: [nx1,ny1,nx2,ny2] },
        color: color,
        size: size,
        seq: wbSeq
      });
    }catch(e){}
  }

  function whiteboardClear(broadcast){
    try{
      if (wbCtx && wbCanvas) wbCtx.clearRect(0,0,wbCanvas.width,wbCanvas.height);
      if (broadcast) {
        const s = getSocket();
        const cid = getGroupCallId();
        if (s && cid) {
          wbSeq += 1;
          s.emit('group_whiteboard', { channel_id: cid, action:'clear', stroke:null, color:'', size:0, seq: wbSeq });
        }
      }
    }catch(e){}
  }

  function setWhiteboard(on){
    ensureWhiteboard();
    if (on && !isInGroupCall()) {
      _toast('Whiteboard работает в групповом звонке', true);
      return;
    }
    wbOpen = !!on;
    try{ wbEl.classList.toggle('is-hidden', !wbOpen); }catch(e){}
  }

  function bindWhiteboardSocket(){
    const s = getSocket();
    if (!s || s.__ncWbBoundFix116) return;
    s.__ncWbBoundFix116 = true;
    s.on('group_whiteboard', (p)=>{
      try{
        if (!p || !wbCtx || !wbCanvas) return;
        const cid = getGroupCallId();
        if (!cid || String(p.channel_id) !== String(cid)) return;
        if (String(p.action||'') === 'clear') {
          if (wbCtx && wbCanvas) wbCtx.clearRect(0,0,wbCanvas.width,wbCanvas.height);
          return;
        }
        const st = p.stroke;
        const arr = st && st.p ? st.p : null;
        if (!arr || arr.length < 4) return;
        const r = wbCanvas.getBoundingClientRect();
        const x1 = arr[0] * r.width;
        const y1 = arr[1] * r.height;
        const x2 = arr[2] * r.width;
        const y2 = arr[3] * r.height;
        const col = String(p.color||'#7dffe9');
        const sz = Math.max(1, Math.min(32, parseInt(p.size||3,10) || 3));
        wbCtx.lineCap = 'round';
        wbCtx.lineJoin = 'round';
        wbCtx.strokeStyle = col;
        wbCtx.lineWidth = sz;
        wbCtx.beginPath();
        wbCtx.moveTo(x1,y1);
        wbCtx.lineTo(x2,y2);
        wbCtx.stroke();
      }catch(e){}
    });
  }

  // ---------------- Call statuses
  const callStatusByUid = {};
  const STATUS_LABEL = { online:'ONLINE', busy:'BUSY', ghost:'GHOST' };

  function ensureStatusBadge(tile){
    try{
      if (!tile) return null;
      let b = tile.querySelector('.nc-call-status');
      if (b) return b;
      b = document.createElement('div');
      b.className = 'nc-call-status';
      b.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="t"></span>';
      tile.appendChild(b);
      return b;
    }catch(e){ return null; }
  }

  function applyStatusesToTiles(){
    try{
      const tiles = qa('.voice-participant[data-uid], .participant-tile[data-uid]');
      tiles.forEach((t)=>{
        try{
          const uid = parseInt(t.dataset.uid||'0',10) || 0;
          if (!uid) return;
          const st = callStatusByUid[String(uid)] || 'online';
          t.dataset.callStatus = st;
          const b = ensureStatusBadge(t);
          const tt = b ? b.querySelector('.t') : null;
          if (tt) tt.textContent = STATUS_LABEL[st] || 'ONLINE';
        }catch(e){}
      });
    }catch(e){}
  }

  function setMyCallStatus(st){
    try{
      st = String(st||'online').toLowerCase();
      if (!['online','busy','ghost'].includes(st)) st = 'online';
      localStorage.setItem('nc_call_status_pref', st);
      const s = getSocket();
      const cid = getGroupCallId();
      if (s && cid) {
        s.emit('group_call_status', { channel_id: cid, status: st });
      }
      // optimistic local apply
      try{ if (typeof currentUserId !== 'undefined' && currentUserId) callStatusByUid[String(currentUserId)] = st; }catch(e){}
      applyStatusesToTiles();
      updateStatusBtn();
    }catch(e){}
  }

  function getMyCallStatus(){
    try{ return localStorage.getItem('nc_call_status_pref') || 'online'; }catch(e){ return 'online'; }
  }

  function cycleMyStatus(){
    const cur = getMyCallStatus();
    const next = (cur === 'online') ? 'busy' : (cur === 'busy' ? 'ghost' : 'online');
    setMyCallStatus(next);
    _toast('Статус: ' + next);
  }

  function bindStatusSocket(){
    const s = getSocket();
    if (!s || s.__ncStatusBoundFix116) return;
    s.__ncStatusBoundFix116 = true;
    s.on('group_call_status_bulk', (p)=>{
      try{
        const cid = getGroupCallId();
        if (!cid || !p || String(p.channel_id) !== String(cid)) return;
        const st = p.statuses || {};
        Object.keys(st).forEach((uid)=>{ callStatusByUid[String(uid)] = String(st[uid]||'online'); });
        applyStatusesToTiles();
      }catch(e){}
    });
    s.on('group_call_status', (p)=>{
      try{
        const cid = getGroupCallId();
        if (!cid || !p || String(p.channel_id) !== String(cid)) return;
        const uid = String(p.user_id||'');
        if (!uid) return;
        callStatusByUid[uid] = String(p.status||'online');
        applyStatusesToTiles();
      }catch(e){}
    });
  }

  // ---------------- Sticky timecode bar
  let tcBar = null;
  let tcBound = false;
  function ensureTimecodeBar(){
    if (tcBar) return;
    const sc = document.getElementById('chat-messages');
    if (!sc) return;
    tcBar = document.createElement('div');
    tcBar.className = 'nc-timecode-bar';
    tcBar.textContent = '';
    // put as first child inside scroll container
    sc.insertBefore(tcBar, sc.firstChild);
  }

  function updateTimecodeBar(){
    try{
      if (!tcBar) return;
      const sc = document.getElementById('chat-messages');
      if (!sc) return;
      // date label: last .date-sep above scrollTop
      let dateLabel = '';
      const seps = qa('.date-sep', sc);
      const st = sc.scrollTop + 12;
      for (const sep of seps){
        if (sep.offsetTop <= st) {
          const l = sep.querySelector('.date-sep-label');
          if (l) dateLabel = l.textContent || dateLabel;
        }
      }
      // time: element at top point
      let time = '';
      try{
        const r = sc.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + Math.min(80, r.width - 10), r.top + 40);
        const row = el ? (el.closest ? el.closest('.msg-row') : null) : null;
        if (row) {
          const tt = row.querySelector('.msg-time');
          if (tt) time = tt.textContent || '';
        }
      }catch(e){}

      const txt = (dateLabel && time) ? (time + ' · ' + dateLabel) : (dateLabel || time || '');
      tcBar.textContent = txt;
      tcBar.style.display = txt ? 'block' : 'none';
    }catch(e){}
  }

  function bindTimecode(){
    if (tcBound) return;
    const sc = document.getElementById('chat-messages');
    if (!sc) return;
    tcBound = true;
    ensureTimecodeBar();
    const on = ()=>{ requestAnimationFrame(updateTimecodeBar); };
    sc.addEventListener('scroll', on, { passive:true });
    // update on new messages
    try{
      const mo = new MutationObserver(()=>{ requestAnimationFrame(updateTimecodeBar); });
      mo.observe(sc, { childList:true, subtree:true });
    }catch(e){}
    setTimeout(updateTimecodeBar, 500);
  }

  // ---------------- Activity heatline (mini overlay)
  let heatBtn = null;
  let heatEl = null;
  let heatAcc = {};
  let heatT0 = Date.now();
  function ensureHeatOverlay(){
    if (heatEl) return;
    heatEl = document.createElement('div');
    heatEl.style.cssText = 'position:fixed;left:50%;top:90px;transform:translateX(-50%);z-index:9998;display:none;'+
      'padding:10px 12px;border-radius:16px;background:rgba(10,14,24,.72);border:1px solid rgba(120,255,233,.22);'+
      'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 18px 45px rgba(0,0,0,.45);'+
      'color:rgba(235,250,255,.92);font-weight:800;font-size:12px;max-width: min(520px, calc(100vw - 24px));';
    heatEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">'+
      '<span>Активность (10с)</span>'+
      '<button type="button" style="border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.25);color:rgba(235,250,255,.92);border-radius:12px;height:30px;padding:0 10px;cursor:pointer;">Закрыть</button>'+
      '</div><div class="body" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;"></div>';
    document.body.appendChild(heatEl);
    const btn = heatEl.querySelector('button');
    if (btn) btn.addEventListener('click', ()=>{ heatEl.style.display='none'; });
  }
  function sampleHeat(){
    try{
      if (!isInGroupCall()) { heatAcc = {}; heatT0 = Date.now(); return; }
      // voiceLevelByUid is best-effort global (if present)
      if (typeof voiceLevelByUid === 'undefined' || !voiceLevelByUid) return;
      const now = Date.now();
      const dt = Math.min(400, Math.max(0, now - (sampleHeat._t || now)));
      sampleHeat._t = now;
      const sec = dt / 1000;
      Object.keys(voiceLevelByUid).forEach((uid)=>{
        const v = Math.max(0, Math.min(1, Number(voiceLevelByUid[uid]||0)));
        if (v > 0.06) heatAcc[uid] = (heatAcc[uid] || 0) + sec * v;
      });
      // decay window 10s
      if ((now - heatT0) > 12000) { heatAcc = {}; heatT0 = now; }
    }catch(e){}
  }
  function showHeat(){
    ensureHeatOverlay();
    const body = heatEl.querySelector('.body');
    if (!body) return;
    const items = Object.entries(heatAcc).sort((a,b)=>b[1]-a[1]).slice(0,8);
    if (!items.length) {
      body.innerHTML = '<span style="opacity:.75;">Пока тихо…</span>';
    } else {
      body.innerHTML = '';
      items.forEach(([uid,val])=>{
        const el = document.createElement('div');
        const pct = Math.min(100, Math.round((val / 10) * 100));
        el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;'+
          'border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.22);';
        el.textContent = `#${uid} · ${pct}%`;
        body.appendChild(el);
      });
    }
    heatEl.style.display = 'block';
  }

  // ---------------- Voice toolbar buttons injection
  function ensureVoiceButtons(){
    try{
      const bar = document.getElementById('voice-toolbar');
      if (!bar || bar.dataset.fix116Btns) return;
      bar.dataset.fix116Btns = '1';

      function mkBtn(id, title, text){
        const b = document.createElement('button');
        b.type = 'button';
        b.id = id;
        b.className = 'vctl icon-btn';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.textContent = text;
        return b;
      }

      const btnPiP = mkBtn('vctl-pip', 'PiP демки', 'PiP');
      const btnSnap = mkBtn('vctl-snap', 'Снимок демки', '📸');
      const btnWb = mkBtn('vctl-wb', 'Whiteboard', '✍');
      const btnStatus = mkBtn('vctl-status', 'Статус в звонке', '🫥');
      const btnHeat = mkBtn('vctl-heat', 'Активность (10с)', '⚡');

      btnPiP.addEventListener('click', ()=> setPiP(!pipVisible));
      btnSnap.addEventListener('click', ()=> snapshotShare());
      btnWb.addEventListener('click', ()=> setWhiteboard(!wbOpen));
      btnStatus.addEventListener('click', ()=> cycleMyStatus());
      btnHeat.addEventListener('click', ()=> showHeat());

      // Insert before the last controls (usually "leave")
      const ref = bar.lastElementChild;
      bar.insertBefore(btnHeat, ref);
      bar.insertBefore(btnStatus, btnHeat);
      bar.insertBefore(btnWb, btnStatus);
      bar.insertBefore(btnSnap, btnWb);
      bar.insertBefore(btnPiP, btnSnap);

      heatBtn = btnHeat;
      updateStatusBtn();
    }catch(e){}
  }

  function updateStatusBtn(){
    try{
      const b = document.getElementById('vctl-status');
      if (!b) return;
      const st = getMyCallStatus();
      const map = { online:'🟢', busy:'🟡', ghost:'⚪' };
      b.textContent = map[st] || '🟢';
      b.title = 'Статус: ' + st;
    }catch(e){}
  }

  // ---------------- Boot
  function boot(){
    patchOnlineBadge();
    ensureVoiceButtons();
    bindStatusSocket();
    bindWhiteboardSocket();
    bindTimecode();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }

  // Keep synced
  setInterval(()=>{
    try{ patchOnlineBadge(); }catch(e){}
    try{ ensureVoiceButtons(); }catch(e){}
    try{ applyStatusesToTiles(); }catch(e){}
    try{ if (pipVisible) syncPiP(false); }catch(e){}
    try{ sampleHeat(); }catch(e){}
  }, 650);

  // When entering a group call, send our preferred status.
  let lastCallId = null;
  setInterval(()=>{
    try{
      const cid = getGroupCallId();
      if (cid && String(cid) !== String(lastCallId)) {
        lastCallId = cid;
        // push our preference
        setTimeout(()=>{ try{ setMyCallStatus(getMyCallStatus()); }catch(e){} }, 600);
      }
      if (!cid) lastCallId = null;
    }catch(e){}
  }, 900);

})();
