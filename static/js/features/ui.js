/* Semantic script */

// v9.13 fix24: make sidebar search bar ALWAYS clickable
// - Some layouts/overlays can steal clicks, so we open the global search modal via capture + hit-test.
// - Works even if main.js failed before binding, or if target is an overlay.

(function(){
  const $ = (id)=>document.getElementById(id);

  const modal = $('modal-global-search');
  const input = $('global-search-input');
  const btnSidebar = $('btn-open-global-search-sidebar');
  const btnFriends = $('btn-open-global-search-friends');
  const btnClose = $('modal-close-global-search');

  function open(){
    if(!modal) return;
    try{ modal.hidden = false; }catch(e){}
    try{ modal.classList.add('active'); }catch(e){}
    try{ modal.setAttribute('aria-hidden','false'); }catch(e){}

    // Clear any sticky inline styles that could keep it invisible
    try{
      modal.style.display = '';
      modal.style.pointerEvents = '';
      modal.style.visibility = '';
      modal.style.opacity = '';
      modal.removeAttribute('hidden');
    }catch(e){}

    try{ document.documentElement.classList.add('modal-open'); }catch(e){}
    try{ document.body.classList.add('modal-open'); }catch(e){}

    // Focus input on next tick
    setTimeout(()=>{
      try{
        if(input){
          input.value = '';
          input.focus({ preventScroll: true });
        }
      }catch(e){
        try{ input && input.focus(); }catch(_){ }
      }
    }, 0);
  }

  function close(){
    if(!modal) return;
    try{ modal.classList.remove('active'); }catch(e){}
    try{ modal.setAttribute('aria-hidden','true'); }catch(e){}
    try{ modal.hidden = true; }catch(e){}
    try{ document.documentElement.classList.remove('modal-open'); }catch(e){}
    try{ document.body.classList.remove('modal-open'); }catch(e){}
  }

  function withinRect(r, x, y){
    if(!r) return false;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function tryOpenFromPoint(x, y){
    // Preferred: check if click is within the sidebar search button box
    try{
      if(btnSidebar){
        const r = btnSidebar.getBoundingClientRect();
        if(withinRect(r, x, y)) { open(); return true; }
      }
    }catch(e){}

    // Fallback: if the click is inside the .sidebar-search block
    try{
      const wrap = document.querySelector('.sidebar-search');
      if(wrap){
        const r = wrap.getBoundingClientRect();
        if(withinRect(r, x, y)) { open(); return true; }
      }
    }catch(e){}

    return false;
  }

  // Normal clicks
  try{ btnSidebar && btnSidebar.addEventListener('click', (e)=>{ try{ e.preventDefault(); }catch(_){} open(); }, true); }catch(e){}
  try{ btnFriends && btnFriends.addEventListener('click', (e)=>{ try{ e.preventDefault(); }catch(_){} open(); }, true); }catch(e){}
  try{ btnClose && btnClose.addEventListener('click', close); }catch(e){}

  // Click backdrop to close
  try{
    modal && modal.addEventListener('click', (e)=>{
      if(e.target === modal) close();
    });
  }catch(e){}

  // Capture-level pointerdown: open even if an overlay steals the target
  document.addEventListener('pointerdown', (e)=>{
    try{
      if(!e) return;
      const x = e.clientX, y = e.clientY;
      if(tryOpenFromPoint(x, y)){
        try{ e.preventDefault(); }catch(_){ }
        try{ e.stopPropagation(); }catch(_){ }
      }
    }catch(err){}
  }, true);

  // ESC closes
  document.addEventListener('keydown', (e)=>{
    try{
      if(e && e.key === 'Escape' && modal && modal.classList.contains('active')) close();
    }catch(err){}
  });
})();


/*
  NeonChat fix11: Button Skin toggle (Discord Flat / Elevated)
  - Reads localStorage: nc_btn_skin = "flat" | "elevated"
  - Sets: <html data-btn-skin="...">
  - Hotkey: Ctrl+Shift+B toggles style
  - API: window.setButtonSkin("flat"|"elevated")
*/

(function(){
  const KEY = 'nc_btn_skin';
  const ALLOWED = new Set(['flat','elevated']);

  function get(){
    try{
      const v = (localStorage.getItem(KEY) || 'flat').toLowerCase();
      return ALLOWED.has(v) ? v : 'flat';
    }catch(_){
      return 'flat';
    }
  }

  function apply(v){
    try{ document.documentElement.setAttribute('data-btn-skin', v); }catch(_){ }
  }

  function set(v, reload){
    v = (v || 'flat').toLowerCase();
    if (!ALLOWED.has(v)) v = 'flat';
    try{ localStorage.setItem(KEY, v); }catch(_){ }
    apply(v);
    toast('Buttons: ' + (v === 'elevated' ? 'Elevated' : 'Flat'));
    if (reload) {
      try{ location.reload(); }catch(_){ }
    }
  }

  function toast(text){
    try{
      let el = document.getElementById('nc-btn-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'nc-btn-toast';
        el.style.position = 'fixed';
        el.style.left = '50%';
        el.style.bottom = '18px';
        el.style.transform = 'translateX(-50%)';
        el.style.zIndex = '9999';
        el.style.padding = '10px 12px';
        el.style.borderRadius = '12px';
        el.style.background = 'rgba(0,0,0,0.55)';
        el.style.border = '1px solid rgba(255,255,255,0.14)';
        el.style.backdropFilter = 'blur(10px)';
        el.style.webkitBackdropFilter = 'blur(10px)';
        el.style.color = 'rgba(249,251,255,0.92)';
        el.style.fontSize = '13px';
        el.style.letterSpacing = '.01em';
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        el.style.transition = 'opacity 160ms ease, transform 160ms ease';
        document.body.appendChild(el);
      }
      el.textContent = text;
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0px)';
      clearTimeout(el.__t);
      el.__t = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(4px)';
      }, 900);
    }catch(_){
      try{ console.log(text); }catch(__){}
    }
  }

  // Expose
  window.setButtonSkin = (v) => set(v, false);

  // Apply current at boot (if inline head script didn't run for some reason)
  window.addEventListener('DOMContentLoaded', () => {
    apply(get());

    // Hotkey: Ctrl+Shift+B
    document.addEventListener('keydown', (e) => {
      try{
        if (!(e.ctrlKey && e.shiftKey)) return;
        if ((e.key || '').toLowerCase() !== 'b') return;
        e.preventDefault();
        const next = get() === 'flat' ? 'elevated' : 'flat';
        set(next, true);
      }catch(_){ }
    });
  });
})();


/*
  NeonChat fix21: Button Motion (stable)
  - Ripple on pointerdown
  - Micro pop on click
  - Optional cursor-follow glow (when skin=elevated)
  - Works with dynamic DOM (MutationObserver)
  - Respects prefers-reduced-motion ONLY when html does NOT have .force-motion
*/

(function(){
  const SELECTOR = [
    'button',
    '.btn',
    '[role="button"]',
    'a.btn-primary',
    'a.btn-secondary',
    'a.btn-logout',
    '.icon-btn',
    '.call-icon-btn',
    '.call-control',
    '.call-pill-btn',
    '.call-ss-watch-btn',
    '.call-ended-ok',
    '.nc-tp-btn',
    '.nc-tp-ghost',
    '.nc-tp-mini',
    '.user-popout-primary'
  ].join(', ');

  function isDisabled(el){
    try{
      if (!el) return true;
      if (el.matches && el.matches('button:disabled')) return true;
      if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
      if (el.classList && (el.classList.contains('disabled') || el.classList.contains('is-disabled'))) return true;
      return false;
    }catch(_){
      return false;
    }
  }

  function wantsGlow(){
    try{
      return (document.documentElement.getAttribute('data-btn-skin') || 'flat') === 'elevated';
    }catch(_){
      return false;
    }
  }

  function setCenterGlow(el){
    try{
      el.style.setProperty('--mx','50%');
      el.style.setProperty('--my','50%');
    }catch(_){ }
  }

  function attachGlowTracking(el){
    if (!el || el.dataset.ncGlow === '1') return;
    el.dataset.ncGlow = '1';
    setCenterGlow(el);
    const onMove = (e)=>{
      try{
        const r = el.getBoundingClientRect();
        const x = Math.max(0, Math.min((e.clientX - r.left), r.width));
        const y = Math.max(0, Math.min((e.clientY - r.top), r.height));
        el.style.setProperty('--mx', x + 'px');
        el.style.setProperty('--my', y + 'px');
      }catch(_){ }
    };
    const onLeave = ()=>setCenterGlow(el);
    el.addEventListener('pointermove', onMove, {passive:true});
    el.addEventListener('pointerleave', onLeave, {passive:true});
  }

  function attachRippleAndPop(el){
    if (!el || el.dataset.ncBtnMotion === '1') return;
    el.dataset.ncBtnMotion = '1';

    try{ el.classList.add('btn-ripple'); }catch(_){ }

    el.addEventListener('pointerdown', (e)=>{
      try{
        if (isDisabled(el)) return;
        if (e.button !== undefined && e.button !== 0) return;

        // Micro pop
        el.classList.remove('btn-pop');
        void el.offsetWidth;
        el.classList.add('btn-pop');
        window.setTimeout(()=>{ try{ el.classList.remove('btn-pop'); }catch(_){ } }, 220);

        // Ripple
        const rect = el.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 1.15;
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = ((e.clientX - rect.left) - size/2) + 'px';
        ripple.style.top  = ((e.clientY - rect.top)  - size/2) + 'px';
        el.appendChild(ripple);
        ripple.addEventListener('animationend', ()=>{ try{ ripple.remove(); }catch(_){ } }, {once:true});
      }catch(_){ }
    }, {passive:true});
  }

  function upgrade(el){
    if (!el || !(el instanceof HTMLElement)) return;
    // Password "eye" must stay fixed inside inputs (no ripple/pop/hover lift)
    try{ if (el.classList && el.classList.contains('pw-eye')) return; }catch(_){ }
    attachRippleAndPop(el);
    if (wantsGlow()) attachGlowTracking(el);
  }

  function scan(root){
    try{
      (root || document).querySelectorAll(SELECTOR).forEach(upgrade);
    }catch(_){ }
  }

  function boot(){
    scan(document);
    try{
      const mo = new MutationObserver((muts)=>{
        for (const m of muts){
          for (const n of (m.addedNodes || [])){
            if (!(n instanceof HTMLElement)) continue;
            if (n.matches && n.matches(SELECTOR)) upgrade(n);
            if (n.querySelectorAll) n.querySelectorAll(SELECTOR).forEach(upgrade);
          }
        }
      });
      mo.observe(document.documentElement || document.body, {subtree:true, childList:true});
    }catch(_){ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();


/*
  NeonChat fix12: Control button customization
  - Stores settings in localStorage: nc_ctrl_btn
  - Applies CSS variables on <html>
  - API: window.setControlButtons({size, radius, hoverBg, activeBg, fg, fgHover, danger})
*/
(function(){
  const KEY = 'nc_ctrl_btn';
  const MAP = {
    size: '--dc-ic-size',
    sizeSm: '--dc-ic-size-sm',
    radius: '--dc-ic-radius',
    radiusLg: '--dc-ic-radius-lg',
    hoverBg: '--dc-ic-bg-hover',
    activeBg: '--dc-ic-bg-active',
    onBg: '--dc-ic-bg-on',
    fg: '--dc-ic-fg',
    fgHover: '--dc-ic-fg-hover',
    danger: '--dc-danger',
    success: '--dc-success'
  };

  function safeParse(s){
    try{ return JSON.parse(s || '{}') || {}; }catch(_){ return {}; }
  }

  function apply(obj){
    try{
      const root = document.documentElement;
      Object.keys(MAP).forEach((k) => {
        if (obj[k] === undefined || obj[k] === null || obj[k] === '') return;
        let v = obj[k];
        // numbers -> px
        if (typeof v === 'number') v = String(v) + 'px';
        root.style.setProperty(MAP[k], String(v));
      });
    }catch(_){ }
  }

  function load(){
    try{
      const obj = safeParse(localStorage.getItem(KEY));
      apply(obj);
    }catch(_){ }
  }

  function set(obj){
    obj = obj || {};
    try{ localStorage.setItem(KEY, JSON.stringify(obj)); }catch(_){ }
    apply(obj);
    try{ console.log('[NeonChat] Control buttons updated', obj); }catch(_){ }
  }

  window.setControlButtons = set;
  window.resetControlButtons = () => { try{ localStorage.removeItem(KEY); }catch(_){ } try{ location.reload(); }catch(_){ } };

  window.addEventListener('DOMContentLoaded', load);
})();


(function(){
  if (window.__ncSafeUiHotfixV29) return;
  window.__ncSafeUiHotfixV29 = true;

  let suppressFriendsUntil = 0;

  function q(sel,root){ try{return (root||document).querySelector(sel);}catch(_){return null;} }
  function qa(sel,root){ try{return Array.from((root||document).querySelectorAll(sel));}catch(_){return [];} }

  function hideFriendsShowGuild(){
    const now = Date.now();
    const force = now < suppressFriendsUntil;
    const appShell = q('#app-shell');
    const friendsView = q('#friends-view');
    const friendsPane = q('#friends-pane');
    const messages = q('#messages');
    const chatArea = q('#chat-area');
    if (force) {
      if (friendsView) friendsView.style.display = 'none';
      if (friendsPane) friendsPane.style.display = 'none';
      if (messages && !messages.style.display) { /* keep current */ }
      if (messages && (messages.style.display === 'none' || getComputedStyle(messages).display === 'none')) messages.style.display = '';
      if (chatArea && (chatArea.style.display === 'none' || getComputedStyle(chatArea).display === 'none')) chatArea.style.display = '';
      if (appShell) {
        appShell.classList.remove('dm-mode','friends-open');
        appShell.classList.add('guild-mode');
      }
      // if a channel is highlighted, click it once to restore main pane from accidental Friends redirect
      const activeGuildChannel = q('#sidebar .channel-item.active, #sidebar .guild-channel-item.active, #sidebar [data-channel-id].active');
      if (activeGuildChannel && !activeGuildChannel.__ncSafeClicked) {
        activeGuildChannel.__ncSafeClicked = true;
        setTimeout(()=>{ try{ activeGuildChannel.click(); }catch(_){} activeGuildChannel.__ncSafeClicked=false; }, 30);
      }
    }
  }

  function markGuildClickAndSuppress(){
    suppressFriendsUntil = Date.now() + 1800;
    hideFriendsShowGuild();
    setTimeout(hideFriendsShowGuild, 60);
    setTimeout(hideFriendsShowGuild, 180);
    setTimeout(hideFriendsShowGuild, 500);
    setTimeout(hideFriendsShowGuild, 1100);
  }

  document.addEventListener('click', function(ev){
    const t = ev.target;
    if (!t || !t.closest) return;

    // Clicking a server icon in left rail should never open Friends main page.
    const guildBtn = t.closest('#dc-rail .dc-server, #dc-rail .server-item, #dc-rail [data-guild-id]');
    const isAddBtn = !!t.closest('#dc-rail .add-server, #dc-rail [data-action=add-server]');
    const isHomeBrand = !!t.closest('#rail-brand');
    if (guildBtn && !isAddBtn && !isHomeBrand) {
      markGuildClickAndSuppress();
      return;
    }

    // Clicking the logo/home button should NOT be blocked by the guild anti-friends guard.
    // Let main.js handle full switch to Home/DM mode (it correctly clears guild UI and restores last DM).
    const homeBtn = t.closest('#rail-brand');
    if (homeBtn) {
      suppressFriendsUntil = 0;
      return;
    }
  }, true);

  // If some script still flips UI to Friends right after guild click, force it back briefly.
  function installLightGuards(){
    const appShell = q('#app-shell');
    const friendsView = q('#friends-view');
    const watchNodes = [appShell, friendsView].filter(Boolean);
    watchNodes.forEach((node)=>{
      try{
        const mo = new MutationObserver(function(){
          if (Date.now() < suppressFriendsUntil) hideFriendsShowGuild();
        });
        mo.observe(node, { attributes:true, attributeFilter:['class','style'] });
      }catch(_){}
    });
  }

  // Remove injected experimental folder chips if any remain from older cached DOM.
  function purgeFolders(){
    qa('.nc-rail-folders, .nc-folder-stack, .nc-folder-item, .nc-folder-chip, .dc-rail-folders, .dc-server-folder, [data-nc-folder], [data-folder-id]').forEach((el)=>{
      try{ el.remove(); }catch(_){}
    });
  }

  // Settings screen safety: kill accidental duplicate preview layers (ghost clones).
  function sanitizeSettingsGhosts(){
    const overlay = q('#nc-settings-overlay');
    if (!overlay) return;
    // remove nested duplicates that contain another full page-main inside page-main
    qa('.nc-settings-page-main .nc-settings-page-main', overlay).forEach((el)=>{
      try { el.remove(); } catch(_){}
    });
    // clear duplicate right-preview cards beyond first one in same section
    qa('.nc-settings-right-panel, .nc-settings-preview-panel', overlay).forEach((wrap)=>{
      const kids = Array.from(wrap.children || []);
      if (kids.length > 1) {
        for (let i = 1; i < kids.length; i++) {
          if (kids[i] && kids[i].classList && /preview|card|panel/i.test(kids[i].className)) {
            try { kids[i].remove(); } catch(_){}
          }
        }
      }
    });
  }

  function boot(){
    installLightGuards();
    purgeFolders();
    sanitizeSettingsGhosts();
    // short-lived cleanup to avoid permanent intervals
    let n = 0;
    const iv = setInterval(function(){
      purgeFolders();
      sanitizeSettingsGhosts();
      hideFriendsShowGuild();
      n += 1;
      if (n > 10) clearInterval(iv);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();


/* fix32: navigation/profile stability hardening (safe, no heavy observers) */
(function(){
  if (window.__ncFix32Loaded) return;
  window.__ncFix32Loaded = true;

  const LOG = '[NC fix32]';
  const DM_KEY = 'nc_last_dm_uid_fix32';

  function log(){ try{ console.log.apply(console, [LOG].concat([].slice.call(arguments))); }catch(_){} }

  function safe(fn){ try{ return fn(); }catch(e){ try{ console.warn(LOG, e); }catch(_){} } }

  function getLastDmUid(){
    try{
      if (typeof __ncGetLastView === 'function'){
        const v = __ncGetLastView();
        if (v && String(v.mode||'') === 'dm' && v.dmUserId) return String(v.dmUserId);
      }
    }catch(_){}
    try{
      const a = localStorage.getItem(DM_KEY);
      if (a) return String(a);
    }catch(_){}
    try{
      const b = localStorage.getItem('nc_last_dm_uid');
      if (b) return String(b);
    }catch(_){}
    return '';
  }

  function rememberDmUidFromDom(target){
    try{
      const el = target && target.closest ? target.closest('[data-dm-user-id],[data-user-id],[data-userid],.dm-item,.dm-entry,.friend-item') : null;
      if (!el) return;
      let uid = el.getAttribute('data-dm-user-id') || el.getAttribute('data-user-id') || el.getAttribute('data-userid') || '';
      if (!uid && el.dataset){ uid = el.dataset.dmUserId || el.dataset.userId || el.dataset.userid || ''; }
      if (!uid) return;
      localStorage.setItem(DM_KEY, String(uid));
    }catch(_){}
  }

  function rememberCurrentDmUid(){
    try{
      const active = document.querySelector('.dm-item.active,[data-dm-user-id].active,.dm-entry.active,.friend-item.active,.friend-row.active');
      if (!active) return;
      rememberDmUidFromDom(active);
    }catch(_){}
  }

  function forceServerModeSoon(){
    setTimeout(function(){
      safe(function(){
        if (typeof setSidebarMode === 'function') setSidebarMode('server');
        // ensure friends panel isn't force-opened in guild mode
        document.body.classList.remove('nc-force-friends-home');
      });
    }, 30);
    setTimeout(function(){ safe(function(){ if (typeof setSidebarMode === 'function') setSidebarMode('server'); }); }, 120);
  }

  function normalizeHomeAfterLogo(){
    setTimeout(function(){
      safe(function(){
        rememberCurrentDmUid();
        if (typeof clearGuildUI === 'function') clearGuildUI();
        if (typeof setSidebarMode === 'function') setSidebarMode('friends');

        const uid = getLastDmUid();
        if (uid && typeof openDmByUserId === 'function'){
          try { const pr = openDmByUserId(uid); if (pr && typeof pr.catch === 'function') pr.catch(function(){}); } catch(_) {}
          log('logo->home restored DM', uid);
          return;
        }

        // fallback: click active dm entry if present
        const activeDm = document.querySelector('.dm-item.active,[data-dm-user-id].active,.dm-entry.active,.friend-item.active');
        if (activeDm && typeof activeDm.click === 'function') {
          activeDm.click();
          log('logo->home clicked active DM fallback');
        }
      });
    }, 0);

    setTimeout(function(){
      safe(function(){
        // one more pass after main handlers/async UI updates
        if (typeof setSidebarMode === 'function') setSidebarMode('friends');
      });
    }, 180);
  }

  function isLogoClickTarget(target){
    const el = target && target.closest ? target.closest('#rail-brand,.rail-brand,.dc-rail-brand,.np-logo-wrap,[data-role="rail-brand"]') : null;
    return !!el;
  }

  function isServerRailClickTarget(target){
    const el = target && target.closest ? target.closest('#dc-rail .dc-server, #dc-rail [data-guild-id], .dc-server, .server-pill, .guild-pill') : null;
    if (!el) return false;
    if (isLogoClickTarget(el)) return false;
    // ignore plus/create button and explicit DM/home buttons
    if (el.matches('.add-server, .server-add, #add-server-btn, [data-action="add-server"]')) return false;
    return true;
  }

  function tryOpenEditProfile(ev){
    const t = ev && ev.target;
    if (!t || !t.closest) return false;
    const btn = t.closest('#me-popout-edit,#nc-edit-profile,.edit-profile-btn,[aria-label*="Редактировать профиль"],[title*="редактир" i]');
    if (!btn) return false;
    safe(function(){
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation && ev.stopImmediatePropagation();
      if (typeof __ncOpenEditProfileModal === 'function'){
        __ncOpenEditProfileModal();
        log('profile editor opened via fix32');
        return;
      }
      // fallback to known button if handler is attached elsewhere
      const direct = document.getElementById('nc-edit-profile');
      if (direct && direct !== btn && typeof direct.click === 'function') direct.click();
    });
    return true;
  }

  // Track DM clicks to preserve last selected DM on logo/home
  document.addEventListener('click', function(ev){
    safe(function(){
      const t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest('.dm-item,.dm-entry,.friend-item,[data-dm-user-id]')) rememberDmUidFromDom(t);
    });
  }, true);

  // Main nav hardening (capture phase)
  document.addEventListener('click', function(ev){
    try {
      if (tryOpenEditProfile(ev)) return;
    } catch(_) {}

    safe(function(){
      const t = ev.target;
      if (!t) return;
      if (isLogoClickTarget(t)){
        normalizeHomeAfterLogo();
        return;
      }
      if (isServerRailClickTarget(t)){
        forceServerModeSoon();
      }
    });
  }, true);

  // Keyboard accessibility for profile edit triggers
  document.addEventListener('keydown', function(ev){
    safe(function(){
      if (!(ev.key === 'Enter' || ev.key === ' ')) return;
      const t = ev.target;
      if (!t || !t.closest) return;
      const hit = t.closest('#me-popout-edit,#nc-edit-profile,.edit-profile-btn,[aria-label*="Редактировать профиль"]');
      if (!hit) return;
      ev.preventDefault();
      if (typeof __ncOpenEditProfileModal === 'function') __ncOpenEditProfileModal();
    });
  }, true);

  // Settings modal sanity pass (no mutation observers)
  function fixSettingsLayers(){
    safe(function(){
      const modal = document.querySelector('#settings-modal,.settings-modal,.nc-settings-modal');
      if (!modal) return;
      modal.querySelectorAll('.is-entering,.is-closing,.leaving,.entering').forEach(function(el){
        const cls = el.className || '';
        if (/settings/i.test(cls)) {
          el.classList.remove('is-entering','is-closing','leaving','entering');
        }
      });
    });
  }

  document.addEventListener('click', function(ev){
    safe(function(){
      const t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest('.open-settings,#open-settings,[data-action="settings"],.settings-btn,#me-settings-btn,.me-settings')){
        setTimeout(fixSettingsLayers, 50);
        setTimeout(fixSettingsLayers, 250);
      }
    });
  }, true);

  // Expose tiny manual helper for debugging
  window.__ncFix32 = {
    normalizeHomeAfterLogo: normalizeHomeAfterLogo,
    forceServerModeSoon: forceServerModeSoon,
    openEditProfile: function(){ if (typeof __ncOpenEditProfileModal === 'function') __ncOpenEditProfileModal(); },
    getLastDmUid: getLastDmUid
  };

  log('loaded');
})();


// FIX33: Safe keyboard shortcuts (no mutation observers, no DOM rewrites)
(function(){
  if (window.__ncFix33ShortcutsInstalled) return;
  window.__ncFix33ShortcutsInstalled = true;

  function getUiState(){
    try{ return JSON.parse(localStorage.getItem('nc_settings_ui_state')||'{}')||{}; }catch(e){ return {}; }
  }

  function hotkeysEnabled(){
    const ui = getUiState();
    if (Object.prototype.hasOwnProperty.call(ui, 'hotkeysEnabled')) return ui.hotkeysEnabled !== false;
    return true; // default ON
  }

  function isTypingTarget(el){
    if (!el) return false;
    try {
      if (el.isContentEditable) return true;
      const tag = (el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    } catch(_) { return false; }
  }

  function isVisible(el){
    if (!el) return false;
    try {
      const st = window.getComputedStyle(el);
      if (!st) return true;
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      if (el.closest && el.closest('.hidden,[hidden],.is-hidden')) return false;
      return true;
    } catch(_) { return true; }
  }

  function clickFirstVisible(ids){
    try{
      for (var i=0;i<ids.length;i++){
        var el = document.getElementById(ids[i]);
        if (!el) continue;
        if (!isVisible(el)) continue;
        if (el.disabled) continue;
        el.click();
        return true;
      }
    }catch(_){}
    return false;
  }

  function focusSearch(){
    try {
      const inline = document.getElementById('search-input');
      if (inline && isVisible(inline)) {
        inline.focus();
        inline.select && inline.select();
        return true;
      }

      const openBtn = document.getElementById('btn-open-global-search')
        || document.querySelector('[data-open="global-search"], .btn-open-global-search');
      if (openBtn) {
        openBtn.click();
        setTimeout(function(){
          try {
            const modalInput = document.getElementById('global-search-input')
              || document.querySelector('#global-search-modal input, .global-search-modal input');
            if (modalInput && isVisible(modalInput)) {
              modalInput.focus();
              modalInput.select && modalInput.select();
            }
          } catch(_){}
        }, 60);
        return true;
      }

      const fallback = document.querySelector('input[placeholder*="Поиск"], input[placeholder*="Найти"]');
      if (fallback && isVisible(fallback)) {
        fallback.focus();
        fallback.select && fallback.select();
        return true;
      }
    } catch(_) {}
    return false;
  }

  function openSettings(){
    try {
      const btn = document.getElementById('btn-settings')
        || document.querySelector('#me-settings-btn, .me-settings-btn, [data-action="settings"]');
      if (btn) { btn.click(); return true; }
    } catch(_) {}
    return false;
  }

  function toggleMic(){
    // Prefer in-call controls, then bottom-left voice buttons.
    return clickFirstVisible(['btn-toggle-mic','dm-call-mini-mic','dm-btn-mic','btn-voice-mic']);
  }

  function toggleSound(){
    return clickFirstVisible(['btn-toggle-sound','dm-call-mini-sound','dm-btn-sound','btn-voice-sound']);
  }

  function toggleScreen(){
    return clickFirstVisible(['dm-call-mini-screen','dm-btn-screen','btn-toggle-screen','btn-toggle-demo']);
  }

  function ensureHelpModal(){
    let modal = document.getElementById('nc-hotkeys-help');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'nc-hotkeys-help';
    modal.setAttribute('aria-hidden','true');
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.zIndex = '99999';
    modal.style.display = 'none';

    const backdrop = document.createElement('div');
    backdrop.style.position = 'absolute';
    backdrop.style.inset = '0';
    backdrop.style.background = 'rgba(0,0,0,0.55)';

    const card = document.createElement('div');
    card.style.position = 'absolute';
    card.style.left = '50%';
    card.style.top = '50%';
    card.style.transform = 'translate(-50%,-50%)';
    card.style.width = 'min(520px, calc(100vw - 28px))';
    card.style.maxHeight = 'min(70vh, 560px)';
    card.style.overflow = 'auto';
    card.style.borderRadius = '16px';
    card.style.background = 'rgba(25, 25, 35, 0.72)';
    card.style.backdropFilter = 'blur(16px)';
    card.style.border = '1px solid rgba(255,255,255,0.14)';
    card.style.boxShadow = '0 20px 60px rgba(0,0,0,0.55)';
    card.style.padding = '16px 16px 14px';

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'space-between';
    head.style.gap = '10px';
    head.innerHTML = '<div style="font-weight:800;font-size:16px">Горячие клавиши</div>';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label','Закрыть');
    close.style.border = '0';
    close.style.background = 'rgba(255,255,255,0.10)';
    close.style.color = 'inherit';
    close.style.borderRadius = '10px';
    close.style.width = '36px';
    close.style.height = '32px';
    close.style.cursor = 'pointer';

    head.appendChild(close);

    const list = document.createElement('div');
    list.style.marginTop = '12px';
    list.innerHTML = [
      row('Ctrl/Cmd + K', 'Поиск'),
      row('Ctrl/Cmd + ,', 'Настройки'),
      row('Ctrl/Cmd + /', 'Эта справка'),
      row('Ctrl/Cmd + Shift + M', 'Микрофон'),
      row('Ctrl/Cmd + Shift + D', 'Звук'),
      row('Ctrl/Cmd + Shift + S', 'Демонстрация (если доступно)')
    ].join('');

    const foot = document.createElement('div');
    foot.style.marginTop = '12px';
    foot.style.opacity = '0.8';
    foot.style.fontSize = '12px';
    foot.textContent = 'Если горячие клавиши мешают — выключите их в Настройках → Горячие клавиши.';

    card.appendChild(head);
    card.appendChild(list);
    card.appendChild(foot);

    modal.appendChild(backdrop);
    modal.appendChild(card);
    document.body.appendChild(modal);

    function hide(){
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden','true');
    }
    function show(){
      modal.style.display = 'block';
      modal.setAttribute('aria-hidden','false');
    }
    function toggle(){
      if (modal.style.display === 'block') hide(); else show();
    }

    close.addEventListener('click', hide);
    backdrop.addEventListener('click', hide);

    modal.__ncShow = show;
    modal.__ncHide = hide;
    modal.__ncToggle = toggle;
    return modal;

    function row(k, d){
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 10px;border-radius:12px;border:1px solid rgba(255,255,255,0.10);background:rgba(255,255,255,0.05);margin-bottom:8px">' +
        '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:700;font-size:12px;opacity:.95">' + esc(k) + '</div>' +
        '<div style="font-size:13px;opacity:.92">' + esc(d) + '</div>' +
      '</div>';
    }
    function esc(s){
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
  }

  document.addEventListener('keydown', function(e){
    try {
      if (e.defaultPrevented) return;
      if (!hotkeysEnabled()) return;

      const ctrl = !!(e.ctrlKey || e.metaKey);
      if (!ctrl) return;

      const key = e.key || '';
      const code = e.code || '';

      // Ctrl/Cmd + Shift + M => mic (works even while typing)
      if (e.shiftKey && !e.altKey && (key === 'm' || key === 'M')) {
        e.preventDefault();
        e.stopPropagation();
        toggleMic();
        return;
      }

      // Ctrl/Cmd + Shift + D => sound (works even while typing)
      if (e.shiftKey && !e.altKey && (key === 'd' || key === 'D')) {
        e.preventDefault();
        e.stopPropagation();
        toggleSound();
        return;
      }

      // Ctrl/Cmd + Shift + S => screen share (best-effort)
      if (e.shiftKey && !e.altKey && (key === 's' || key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        toggleScreen();
        return;
      }

      // Below shortcuts should not hijack typing in inputs
      if (isTypingTarget(document.activeElement)) return;

      // Ctrl/Cmd+K => search (Discord-like)
      if ((key === 'k' || key === 'K') && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        focusSearch();
        return;
      }

      // Ctrl/Cmd+, => settings
      if (key === ',' && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        openSettings();
        return;
      }

      // Ctrl/Cmd+/ => hotkeys help (works with layouts)
      if (!e.altKey && (code === 'Slash' || key === '/' || key === '?')) {
        e.preventDefault();
        e.stopPropagation();
        const m = ensureHelpModal();
        if (m && m.__ncToggle) m.__ncToggle();
        return;
      }
    } catch(_) {}
  }, true);
})();


(function(){
  'use strict';
  if (window.__ncFix240CtxEverywhere) return; window.__ncFix240CtxEverywhere = true;

  function toInt(v){ var n = parseInt(v,10); return Number.isFinite(n)?n:0; }

  function pickUidFromNode(cur){
    if (!cur || !(cur instanceof HTMLElement)) return 0;
    var ds = cur.dataset || {};
    var uid = toInt(ds.userId || ds.userid || ds.uid || ds.memberId || ds.authorId || ds.peerId || ds.targetUserId || ds.participantId || ds.ownerId);
    if (uid) return uid;
    var attrs = ['data-user-id','data-userid','data-uid','data-member-id','data-author-id','data-peer-id','data-target-user-id','data-participant-id','participant-id','data-owner-id'];
    for (var i=0;i<attrs.length;i++){ uid = toInt(cur.getAttribute && cur.getAttribute(attrs[i])); if (uid) return uid; }
    return 0;
  }

  function inferUidFromContext(cur){
    try {
      if (cur && cur.closest){
        if (cur.closest('#me-panel,.me-panel,.current-user-panel,#current-user-avatar,.current-user') && window.currentUserId) return toInt(window.currentUserId);
        if (cur.closest('#call-bar,.call-window,#call-participants,.call-stage,.call-hud,.call-top,.call-bottom,.voice-participant,.participant-tile,.voice-roster-user,.call-user,.call-member')) {
          return toInt(window.currentCallTargetId || window.currentDmUserId || 0);
        }
        if (cur.closest('.chat-header,.main-content,.chat-container,.profile-card,.user-mini-card,.user-full-modal,.friends-main,.dm-main') && window.currentDmUserId) {
          return toInt(window.currentDmUserId || 0);
        }
      }
    } catch(e){}
    return 0;
  }

  function extract(start){
    var cur = start;
    for (var i=0; cur && i<14; i++, cur=cur.parentElement){
      if (!(cur instanceof HTMLElement)) continue;
      var uid = pickUidFromNode(cur);
      if (!uid) {
        try {
          var inner = cur.querySelector('[data-user-id],[data-userid],[data-uid],[data-member-id],[data-author-id],[data-peer-id],[data-target-user-id],[data-participant-id],[participant-id],[data-owner-id]');
          uid = pickUidFromNode(inner);
          if (uid && inner) cur = inner;
        } catch(e){}
      }
      if (!uid) uid = inferUidFromContext(cur);
      if (uid) return { uid: uid, node: cur };
    }
    return null;
  }

  function enrichNode(node, info){
    if (!info || !info.uid) return node;
    var target = node;
    try {
      if (!(target instanceof HTMLElement)) {
        target = document.createElement('span');
        target.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(target);
        setTimeout(function(){ try{ target.remove(); }catch(_){} }, 0);
      }
      if (!target.dataset) return target;
      target.dataset.userId = target.dataset.userId || String(info.uid);
      target.dataset.uid = target.dataset.uid || String(info.uid);
      if (!target.dataset.username) {
        var nameEl = target.querySelector && target.querySelector('.nc-cos-name,.friend-name,.dc-mname,.gm-name,.user-mini-name,.user-name,.member-name,.participant-name,.voice-name,.chat-header-title,#chat-title,.dm-header-name');
        var nameTxt = nameEl ? (nameEl.textContent||'') : '';
        if (!nameTxt && info.username) nameTxt = info.username;
        if (nameTxt) target.dataset.username = String(nameTxt).replace(/\s+(VIP|PRO|PLUS|DEV|MOD|CREW|NEON|G4S|BOSS|LVL)\s*$/i,'').trim();
      }
      if (!target.dataset.status) {
        var st = target.querySelector && target.querySelector('.friend-sub,.dc-msub,.status-text,.presence-text,.user-status,.user-mini-sub');
        if (st) target.dataset.status = (st.textContent||'').trim();
      }
      if (!target.dataset.avatar && !target.dataset.avatarUrl) {
        var img = target.querySelector && target.querySelector('img');
        if (img && img.getAttribute('src')) {
          target.dataset.avatar = img.getAttribute('src');
          target.dataset.avatarUrl = img.getAttribute('src');
        }
      }
    } catch(e){}
    return target;
  }

  function fallbackMenu(e, info){
    if (!info || !info.uid) return false;
    try{
      var old = document.getElementById('nc-global-ctx-fallback'); if (old) old.remove();
      var m = document.createElement('div');
      m.id = 'nc-global-ctx-fallback';
      m.className = 'context-menu';
      m.style.position = 'fixed';
      m.style.left = (e.clientX||14) + 'px';
      m.style.top = (e.clientY||14) + 'px';
      m.style.zIndex = '100000';
      m.style.minWidth = '190px';
      var title = document.createElement('div');
      title.className = 'context-title';
      title.textContent = info.username || ('Пользователь #' + info.uid);
      m.appendChild(title);
      function btn(text, fn){
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'context-item'; b.textContent = text;
        b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); try{ fn(); }catch(_){} try{ m.remove(); }catch(_){} });
        m.appendChild(b);
      }
      btn('Профиль', function(){
        if (typeof window.openUserProfileModal === 'function') return window.openUserProfileModal(info.uid);
        if (typeof window.showUserProfileModal === 'function') return window.showUserProfileModal(info.uid);
      });
      btn('Открыть чат', function(){
        if (typeof window.openDmWithUser === 'function') return window.openDmWithUser(info.uid);
        if (typeof window.openDMWithUser === 'function') return window.openDMWithUser(info.uid);
      });
      btn('Позвонить', function(){
        if (typeof window.startCallWithUser === 'function') return window.startCallWithUser(info.uid);
        if (typeof window.startDmCall === 'function') return window.startDmCall(info.uid);
      });
      document.body.appendChild(m);
      var closer = function(){ try{ m.remove(); }catch(_){} document.removeEventListener('mousedown', closer, true); document.removeEventListener('contextmenu', closer, true); };
      setTimeout(function(){ document.addEventListener('mousedown', closer, true); document.addEventListener('contextmenu', closer, true); }, 0);
      try{ e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }catch(_){ }
      return true;
    }catch(_){ return false; }
  }

  function openCtx(e, info){
    if (!info || !info.uid) return false;
    var opened = false;
    var target = enrichNode(info.node, info);
    if (typeof window.__ncOpenUserCtxFromEl === 'function') {
      try {
        // main.js helper expects (element, x, y)
        window.__ncOpenUserCtxFromEl(target, e.clientX, e.clientY);
        opened = true;
      } catch(err) {
        opened = false;
      }
    }
    if (!opened) opened = fallbackMenu(e, info);
    if (opened) {
      try{ e.preventDefault(); }catch(_){ }
      try{ e.stopPropagation(); }catch(_){ }
      try{ if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }catch(_){ }
    }
    return opened;
  }

  var __lastCtxTs = 0, __lastCtxX = -9999, __lastCtxY = -9999;
  function _markOpened(x,y){ __lastCtxTs = Date.now(); __lastCtxX = (x|0); __lastCtxY = (y|0); }
  function _isDupOpen(x,y){
    var dt = Date.now() - (__lastCtxTs || 0);
    if (dt > 900) return false;
    return Math.abs((x|0) - (__lastCtxX|0)) < 4 && Math.abs((y|0) - (__lastCtxY|0)) < 4;
  }
  function _isTextEditable(t){
    try{ return !!(t && t.closest && t.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]')); }catch(e){ return false; }
  }
  function _isServerArea(t){
    try{
      // block server/channel menus, but DO NOT block whole sidebar (friends/user panel live there)
      return !!(t && t.closest && t.closest(
        '#dc-rail,.dc-rail,.dc-server,.dc-server-list,.server-item,.guild-item,.guild-row,'+
        '.channel-item,.guild-header,.guild-topbar,'+
        '#guild-menu,.guild-menu,#channel-context-menu,.channel-context-menu'
      ));
    }catch(e){ return false; }
  }
  function _tryOpenFromTarget(e, target){
    if (!target) return false;
    if (_isTextEditable(target)) return false;
    if (_isServerArea(target)) return false;
    var info = extract(target);
    if (!info) return false;
    try{
      if (!info.username){
        var holder = target.closest && target.closest('.friend-item,.dm-item,.member-item,.participant,.participant-tile,.voice-user,.call-user,.profile-card,.user-mini-card,.current-user,#me-panel,.chat-header');
        var nameNode = holder && holder.querySelector && holder.querySelector('.nc-cos-name,.friend-name,.dc-mname,.member-name,.participant-name,.voice-name,.user-name,.profile-name,.user-mini-name,#chat-title,.chat-header-title,.dm-header-name');
        if (nameNode) info.username = (nameNode.textContent||'').trim();
      }
    }catch(_){ }
    var ok = openCtx(e, info);
    if (ok) _markOpened(e.clientX||0, e.clientY||0);
    return !!ok;
  }

  window.addEventListener('contextmenu', function(e){
    var t = e.target;
    if (!t) return;
    if (_isDupOpen(e.clientX||0, e.clientY||0)) {
      try{ e.preventDefault(); }catch(_){ }
      try{ e.stopPropagation(); }catch(_){ }
      try{ if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }catch(_){ }
      return;
    }
    _tryOpenFromTarget(e, t);
  }, true);

  function _isRightPointer(ev){
    try{ if (!ev) return false; return ev.button===2 || ev.which===3 || (typeof ev.buttons==='number' && (ev.buttons&2)); }catch(e){ return false; }
  }
  function _hitTarget(ev){
    var x = ev && typeof ev.clientX === 'number' ? ev.clientX : 0;
    var y = ev && typeof ev.clientY === 'number' ? ev.clientY : 0;
    var t = ev ? ev.target : null;
    try{ var under = document.elementFromPoint(x, y); if (under) t = under; }catch(e){}
    return t;
  }
  function _pointerFallback(ev){
    try{
      if (!_isRightPointer(ev)) return;
      if (_isDupOpen(ev.clientX||0, ev.clientY||0)) return;
      var t = _hitTarget(ev); if (!t) return;
      if (_isServerArea(t)) return;
      setTimeout(function(){
        try{
          if (_isDupOpen(ev.clientX||0, ev.clientY||0)) return;
          var fake = {
            clientX: ev.clientX||0,
            clientY: ev.clientY||0,
            preventDefault: function(){ try{ ev.preventDefault(); }catch(_){} },
            stopPropagation: function(){ try{ ev.stopPropagation(); }catch(_){} },
            stopImmediatePropagation: function(){ try{ if (ev.stopImmediatePropagation) ev.stopImmediatePropagation(); }catch(_){} }
          };
          _tryOpenFromTarget(fake, _hitTarget(ev) || t);
        }catch(_e){}
      }, 0);
    }catch(_e){}
  }
  window.addEventListener('pointerdown', _pointerFallback, true);
  window.addEventListener('mousedown', _pointerFallback, true);

  var lpTimer = null, lpPayload = null;
  window.addEventListener('touchstart', function(e){
    if (!e.touches || e.touches.length !== 1) return;
    var t = e.target;
    if (!t || (t.closest && t.closest('input,textarea,select,[contenteditable="true"]'))) return;
    if (_isServerArea(t)) return;
    var info = extract(t); if (!info) return;
    lpPayload = { info: info, x: e.touches[0].clientX, y: e.touches[0].clientY };
    clearTimeout(lpTimer);
    lpTimer = setTimeout(function(){
      if (!lpPayload) return;
      openCtx({ clientX: lpPayload.x, clientY: lpPayload.y, preventDefault:function(){}, stopPropagation:function(){}, stopImmediatePropagation:function(){} }, lpPayload.info);
      try { if (navigator.vibrate) navigator.vibrate(10); } catch(_){ }
    }, 560);
  }, {passive:true, capture:true});
  ['touchend','touchmove','touchcancel','scroll'].forEach(function(ev){
    window.addEventListener(ev, function(){ clearTimeout(lpTimer); lpPayload = null; }, true);
  });
})();


(function(){
  'use strict';

  function stripTagSuffix(text, label){
    var out = String(text || '').trim();
    var tag = String(label || '').trim();
    if (!out || !tag) return out;
    var esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(?:[\\s\\-_.|•·]*)' + esc + '$', 'i');
    for (var i = 0; i < 3; i++){
      var next = out.replace(re, '').trim();
      if (!next || next === out) break;
      out = next;
    }
    return out;
  }

  function run(){
    try{
      document.querySelectorAll('.nc-badge-chip[data-badge="music"]').forEach(function(n){ try{ n.remove(); }catch(_){} });
    }catch(_){ }

    // Duplicate tag in nickname (example: jaki2932PLUS + PLUS badge) -> keep badge, trim suffix from nick
    try{
      document.querySelectorAll('.user-name, .profile-name, .friend-name, .dc-mname, .user-mini-name, .member-name, .voice-name, .participant-name').forEach(function(n){
        var nameNode = n.querySelector('.nc-cos-name');
        var tagNode  = n.querySelector('.nc-cos-tag');
        if (!nameNode || !tagNode) return;
        var before = String(nameNode.textContent || '').trim();
        var after = stripTagSuffix(before, String(tagNode.textContent || ''));
        if (after && after !== before) nameNode.textContent = after;
      });
    }catch(_){ }

    // Compact areas become unreadable with badge chips -> remove visual clutter
    try{
      document.querySelectorAll('.friend-item .nc-badge-showcase-inline, .dm-item .nc-badge-showcase-inline, #me-panel .nc-badge-showcase-inline').forEach(function(n){ try{ n.remove(); }catch(_){} });
      document.querySelectorAll('#me-panel .user-meta > *').forEach(function(n){
        if (!n) return;
        if (n.id === 'me-sub') return;
        if (n.classList && (n.classList.contains('user-name') || n.classList.contains('profile-name') || n.classList.contains('user-sub'))) return;
        var cn = String(n.className || '').toLowerCase();
        if (cn.indexOf('badge') !== -1) { try{ n.remove(); }catch(_){} }
      });
    }catch(_){ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, {once:true}); else run();
  var mo = new MutationObserver(function(){ clearTimeout(window.__ncFix242T); window.__ncFix242T = setTimeout(run, 25); });
  try{ mo.observe(document.documentElement || document.body, {childList:true, subtree:true}); }catch(e){}
})();


/* =========================================================
   FIX251 (kept filename fix250_mobile_full.js for includes)
   MOBILE FULL JS
   - Inject mobile topbar + overlay
   - Toggle left/right drawers
   - Swipe gestures (edge swipe open/close)
   - Keyboard-aware composer using visualViewport
   - Long-press context menu (touch replacement for ПКМ)
   - Guard screen-share button on mobile
   ========================================================= */

(function(){
  const mq = window.matchMedia("(max-width: 900px)");
  const EDGE_PX = 18;          // swipe start edge
  const SWIPE_TRIGGER = 42;    // px to trigger
  const SWIPE_SLOPE = 1.6;     // abs(dx) > abs(dy)*slope

  let overlay, topbar, hint, bottombar;
  let longPressTimer = null;
  let longPressStart = null;
  let swipe = null;

  const LONG_PRESS_MS = 520;
  const MOVE_CANCEL_PX = 10;

  const ICON_MENU = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;

  const ICON_USER = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" stroke-width="2"/>
      <path d="M20 21a8 8 0 0 0-16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;


  const ICON_CHAT = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v6A3.5 3.5 0 0 1 15.5 16H10l-4.5 3V16.6A3.6 3.6 0 0 1 5 12.5v-6Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <path d="M8 8.5h8M8 11.5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  const ICON_FRIENDS = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 11a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" stroke="currentColor" stroke-width="2"/>
      <path d="M17 10a3 3 0 1 0-2.8-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M3.5 21a6.5 6.5 0 0 1 13 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M16.5 21a5 5 0 0 1 4-4.9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  const ICON_CALL = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 3.5l3.2 2.6-1.4 2.7c1.5 3 3.8 5.2 6.8 6.8l2.7-1.4L20.5 17c.4.5.3 1.3-.2 1.7-1.2.9-2.6 1.3-4.1 1.3C9.9 20 5 15.1 5 8.8c0-1.5.4-2.9 1.3-4.1.4-.5 1.2-.6 1.7-.2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
  const ICON_SETTINGS = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" stroke-width="2"/>
      <path d="M19.4 15a7.9 7.9 0 0 0 .1-6l2-1.6-2-3.4-2.5 1a8.2 8.2 0 0 0-5-2l-.4-2.7H8.4L8 3a8.2 8.2 0 0 0-5 2l-2.5-1-2 3.4L.6 9a7.9 7.9 0 0 0 .1 6L.6 16.6l2 3.4 2.5-1a8.2 8.2 0 0 0 5 2l.4 2.7h3.2l.4-2.7a8.2 8.2 0 0 0 5-2l2.5 1 2-3.4L19.4 15Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;


  function isChatPage(){
    // only enable full mobile shell on the main chat UI (avoid breaking login/register pages)
    return !!(document.querySelector(".chat-main") && document.getElementById("sidebar"));
  }

  function setMobileChatClass(on){
    try{
      document.body.classList.toggle("nc-mobile-chat", !!on);
      document.documentElement.classList.toggle("nc-mobile-chat", !!on);
    }catch(e){}
  }

  function el(tag, cls, html){
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function ensureOverlay(){
    overlay = document.getElementById("nc-mobile-overlay");
    if (!overlay){
      overlay = el("div", "");
      overlay.id = "nc-mobile-overlay";
      document.body.appendChild(overlay);
      overlay.addEventListener("click", () => {
        document.body.classList.remove("nc-left-open","nc-right-open","nc-call-full");
      });
    }
  }

  function inferTitle(){
    const candidates = [
      document.getElementById("current-channel-name"),
      document.querySelector(".channel-title"),
      document.querySelector(".chat-header .title"),
      document.querySelector(".channel-header .title"),
      document.querySelector(".chat-topbar .title"),
      document.querySelector("#chatHeader .title"),
      document.querySelector(".dm-header .title"),
      document.querySelector(".header-title"),
      document.querySelector(".chat-title"),
      document.querySelector("h1")
    ].filter(Boolean);
    const t = candidates[0]?.textContent?.trim();
    return t && t.length ? t : "Neon Chat";
  }

  function inferSub(){
    const online = document.querySelector("#onlineCount, .online-count");
    if (online){
      const s = online.textContent.trim();
      if (s) return "онлайн: " + s;
    }
    // DM presence
    const st = document.querySelector(".dm-presence, .presence-text");
    const s2 = st?.textContent?.trim();
    return s2 || "";
  }

  function ensureTopbar(){
    topbar = document.getElementById("nc-mobile-topbar");
    if (topbar) return;

    topbar = el("div", "");
    topbar.id = "nc-mobile-topbar";
    topbar.innerHTML = `
      <div class="nc-mbar">
        <div class="nc-mbtn" id="nc-mbtn-left" aria-label="Меню">${ICON_MENU}</div>
        <div class="nc-mtitles">
          <div class="nc-mtitle" id="nc-mtitle"></div>
          <div class="nc-msub" id="nc-msub"></div>
        </div>
        <div class="nc-mbtn" id="nc-mbtn-right" aria-label="Профиль">${ICON_USER}</div>
      </div>
    `;
    document.body.appendChild(topbar);

    const t = topbar.querySelector("#nc-mtitle");
    const sub = topbar.querySelector("#nc-msub");
    t.textContent = inferTitle();
    sub.textContent = inferSub();

    topbar.querySelector("#nc-mbtn-left").addEventListener("click", () => {
      document.body.classList.toggle("nc-left-open");
      document.body.classList.remove("nc-right-open");
    });

    topbar.querySelector("#nc-mbtn-right").addEventListener("click", () => {
      document.body.classList.toggle("nc-right-open");
      document.body.classList.remove("nc-left-open");
    });

    // Keep title in sync (cheap interval)
    setInterval(() => {
      if (!mq.matches) return;
      try{
        const nt = inferTitle();
        if (t.textContent !== nt) t.textContent = nt;
        const ns = inferSub();
        if (sub.textContent !== ns) sub.textContent = ns;
      }catch(e){}
    }, 1200);
  }

  function ensureHint(){
    hint = document.querySelector(".nc-touch-hint");
    if (!hint){
      hint = el("div", "nc-touch-hint", "Долгий тап = меню действий");
      document.body.appendChild(hint);
    }
  }

  function showHintOnce(){
    try{
      if (localStorage.getItem("nc_mobile_lp_hint_shown") === "1") return;
      localStorage.setItem("nc_mobile_lp_hint_shown","1");
    }catch(e){}
    ensureHint();
    hint.classList.add("show");
    setTimeout(()=>hint.classList.remove("show"), 1400);
  }

  function isTouch(){
    return ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  }

  function getCtxTarget(startEl){
    return startEl.closest("[data-user-id]") ||
           startEl.closest(".friend-item, .dm-item, .message, .msg, .member, .participant, .call-participant") ||
           null;
  }

  function openContextMenuAt(x, y, target){
    // If app has a context menu API
    try{
      if (window.NC && typeof window.NC.openContextMenu === "function"){
        window.NC.openContextMenu({x, y, target});
        return true;
      }
    }catch(e){}

    // Fallback: reuse existing menu element created by fixes
    const m = document.getElementById("fix240-context-menu") ||
              document.getElementById("fix245-context-menu") ||
              document.getElementById("fix243-context-menu") ||
              document.getElementById("fix244-context-menu") ||
              document.getElementById("fix240-context-menu");
    if (m){
      m.style.left = x + "px";
      m.style.top  = y + "px";
      m.style.display = "block";
      const uid = target?.dataset?.userId || target?.getAttribute?.("data-user-id");
      if (uid) m.dataset.userId = uid;
      return true;
    }
    return false;
  }

  function cancelLongPress(){
    if (longPressTimer){
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressStart = null;
  }

  function onTouchStart(e){
    if (!mq.matches || !isTouch() || !isChatPage()) return;
    if (e.touches && e.touches.length > 1) return;

    const t = e.touches ? e.touches[0] : e;

    // Swipe start detection
    const w = window.innerWidth || document.documentElement.clientWidth;
    const x = t.clientX;
    const y = t.clientY;

    const leftOpen = document.body.classList.contains("nc-left-open");
    const rightOpen = document.body.classList.contains("nc-right-open");

    if (!leftOpen && !rightOpen){
      if (x <= EDGE_PX) swipe = {mode:"open-left", sx:x, sy:y, active:true, locked:false};
      else if (x >= w - EDGE_PX) swipe = {mode:"open-right", sx:x, sy:y, active:true, locked:false};
      else swipe = null;
    } else {
      // if any drawer open, allow swipe to close
      swipe = {mode: leftOpen ? "close-left" : "close-right", sx:x, sy:y, active:true, locked:false};
    }

    // Long press detection (only if on a user-ish element)
    const startEl = e.target;
    const target = getCtxTarget(startEl);
    if (!target) return;

    longPressStart = {x: x, y: y, target};
    longPressTimer = setTimeout(() => {
      const ok = openContextMenuAt(longPressStart.x, longPressStart.y, longPressStart.target);
      if (ok){
        try{ navigator.vibrate && navigator.vibrate(12); }catch(_){ }
        showHintOnce();
      }
      cancelLongPress();
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e){
    if (!mq.matches || !isTouch() || !isChatPage()) return;
    const t = e.touches ? e.touches[0] : e;

    // Cancel long press if moved
    if (longPressStart){
      const dx = t.clientX - longPressStart.x;
      const dy = t.clientY - longPressStart.y;
      if (Math.hypot(dx,dy) > MOVE_CANCEL_PX) cancelLongPress();
    }

    if (!swipe || !swipe.active) return;

    const dx = t.clientX - swipe.sx;
    const dy = t.clientY - swipe.sy;

    // ignore vertical gestures
    if (Math.abs(dx) <= 8 && Math.abs(dy) > 10) return;

    // lock only when it's clearly horizontal
    if (!swipe.locked){
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * SWIPE_SLOPE){
        swipe.locked = true;
      } else {
        return;
      }
    }

    // Prevent page scrolling during horizontal swipe
    try{ e.preventDefault(); }catch(_){ }

    if (swipe.mode === "open-left" && dx > SWIPE_TRIGGER){
      document.body.classList.add("nc-left-open");
      document.body.classList.remove("nc-right-open");
      swipe.active = false;
    }
    if (swipe.mode === "open-right" && dx < -SWIPE_TRIGGER){
      document.body.classList.add("nc-right-open");
      document.body.classList.remove("nc-left-open");
      swipe.active = false;
    }
    if (swipe.mode === "close-left" && dx < -SWIPE_TRIGGER){
      document.body.classList.remove("nc-left-open");
      swipe.active = false;
    }
    if (swipe.mode === "close-right" && dx > SWIPE_TRIGGER){
      document.body.classList.remove("nc-right-open");
      swipe.active = false;
    }
  }

  function onTouchEnd(){
    cancelLongPress();
    swipe = null;
  }


  function setTopbarTitles(title, sub){
    try{
      const t = document.getElementById("nc-mtitle");
      const s = document.getElementById("nc-msub");
      if (t && typeof title === "string") t.textContent = title;
      if (s && typeof sub === "string") s.textContent = sub;
    }catch(e){}
  }

  function closeFriendsPage(){
    try{
      const fv = document.getElementById("friends-view");
      const chatMain = document.querySelector(".chat-main");
      if (chatMain) chatMain.classList.remove("friends-mode");
      if (fv) fv.classList.add("is-hidden");

      // restore title from currently active DM/channel (best-effort)
      try{
        const titleEl = document.getElementById("current-channel-name");
        const active = document.querySelector(".friend-item.active, .channel-item.active");
        if (titleEl){
          if (active && active.classList.contains("friend-item")){
            const nm = (active.dataset && active.dataset.username) || active.getAttribute("data-username") || (active.querySelector(".friend-name") && active.querySelector(".friend-name").textContent) || "Личные сообщения";
            titleEl.textContent = (nm || "Личные сообщения").trim();
          } else if (active && active.classList.contains("channel-item")){
            const cn = (active.dataset && (active.dataset.channelName || active.dataset.channelname)) || active.getAttribute("data-channel-name") || (active.querySelector(".channel-name") && active.querySelector(".channel-name").textContent) || "Канал";
            titleEl.textContent = (cn || "Канал").trim();
          }
        }
      }catch(e){}

      // restore call bar visibility if it was hidden by friends page
      const callBar = document.getElementById("call-bar");
      if (callBar) callBar.style.display = "";

      // restore header actions visibility only if a DM/channel is active
      try{
        const chatHeaderActions = document.getElementById("chat-header-actions");
        const hasActive = !!document.querySelector(".friend-item.active, .channel-item.active");
        if (chatHeaderActions) chatHeaderActions.classList.toggle("is-hidden", !hasActive);
      }catch(e){}

      const jl = document.getElementById("btn-jump-latest");
      if (jl) jl.classList.remove("is-hidden");
    }catch(e){}
  }

  function closeSettings(){
    try{
      if (typeof window.ncCloseSettingsModal === "function") window.ncCloseSettingsModal();
      else{
        const overlay = document.getElementById("nc-settings-overlay");
        if (overlay && !overlay.classList.contains("is-hidden")){
          const btn = document.getElementById("nc-settings-close") || overlay.querySelector(".nc-settings-close");
          if (btn) btn.click();
        }
      }
    }catch(e){}
  }

  function minimizeCall(){
    try{
      const callBar = document.getElementById("call-bar");
      if (!callBar) return;
      const mode = String(callBar.dataset.mode || "idle");
      if (mode === "idle") return;
      callBar.dataset.min = "1";
    }catch(e){}
  }

  function expandCall(){
    try{
      const callBar = document.getElementById("call-bar");
      if (!callBar) return false;
      const mode = String(callBar.dataset.mode || "idle");
      if (mode === "idle") return false;
      callBar.dataset.min = "0";
      try{ callBar.style.display = ""; }catch(_){}
      return true;
    }catch(e){ return false; }
  }

  function showToast(msg){
    try{
      if (typeof window.ncToast === "function") { window.ncToast(msg); return; }
    }catch(e){}
    try{ alert(msg); }catch(_){}
  }

  function setActiveTab(tab){
    if (!bottombar) return;
    try{
      bottombar.querySelectorAll(".nc-btab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === tab));
    }catch(e){}
  }

  function ensureBottomBar(){
    bottombar = document.getElementById("nc-mobile-bottombar");
    if (bottombar) return;

    // Only on the main chat page
    if (!document.querySelector(".chat-main") || !document.getElementById("sidebar")) return;

    bottombar = el("div", "");
    bottombar.id = "nc-mobile-bottombar";
    bottombar.innerHTML = `
      <div class="nc-bbar" role="tablist" aria-label="Навигация">
        <button class="nc-btab is-active" type="button" data-tab="chats" role="tab" aria-label="Чаты">
          ${ICON_CHAT}<span class="nc-blabel">Чаты</span>
        </button>
        <button class="nc-btab" type="button" data-tab="friends" role="tab" aria-label="Друзья">
          ${ICON_FRIENDS}<span class="nc-blabel">Друзья</span>
          <span class="nc-bbadge is-hidden" id="nc-badge-friends" aria-hidden="true"></span>
        </button>
        <button class="nc-btab" type="button" data-tab="call" role="tab" aria-label="Звонок">
          ${ICON_CALL}<span class="nc-blabel">Звонок</span>
          <span class="nc-bbadge is-hidden" id="nc-badge-call" aria-hidden="true">•</span>
        </button>
        <button class="nc-btab" type="button" data-tab="settings" role="tab" aria-label="Настройки">
          ${ICON_SETTINGS}<span class="nc-blabel">Настройки</span>
        </button>
      </div>
    `;
    document.body.appendChild(bottombar);

    bottombar.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(".nc-btab") : null;
      if (!btn) return;
      const tab = String(btn.dataset.tab || "chats");

      // Close drawers for predictable UX
      try{ document.body.classList.remove("nc-left-open","nc-right-open"); }catch(_){}

      if (tab === "friends"){
        closeSettings();
        try{
          const b = document.getElementById("btn-open-friends-view");
          if (b) b.click();
          else{
            // fallback: show friends view if present
            const fv = document.getElementById("friends-view");
            if (fv) fv.classList.remove("is-hidden");
          }
        }catch(e){}
        setTopbarTitles("Друзья", "");
      } else if (tab === "settings"){
        closeFriendsPage();
        minimizeCall();
        try{
          if (typeof window.ncOpenSettingsModal === "function") window.ncOpenSettingsModal();
          else{
            const b = document.getElementById("me-settings");
            if (b) b.click();
          }
        }catch(e){}
        setTopbarTitles("Настройки", "");
      } else if (tab === "call"){
        closeSettings();
        closeFriendsPage();
        const ok = expandCall();
        if (!ok){
          showToast("Нет активного звонка. Открой «Друзья» и нажми трубку у друга.");
          // Helpful redirect: Friends tab
          try{ setActiveTab("friends"); }catch(_){}
          try{ const b = document.getElementById("btn-open-friends-view"); if (b) b.click(); }catch(_){}
          setTopbarTitles("Друзья", "");
          return;
        }
        setTopbarTitles("Звонок", "");
      } else {
        // chats
        closeSettings();
        closeFriendsPage();
        minimizeCall();
        setTopbarTitles(inferTitle(), inferSub());
      }

      setActiveTab(tab);
      try{ localStorage.setItem("nc_mobile_tab", tab); }catch(_){}
    });
  }

  function syncBottomBar(){
    if (!mq.matches) return;
    if (!isChatPage()) return;
    if (!bottombar) return;

    // Pending friends badge
    try{
      const src = document.getElementById("friends-pending-sidebar-badge") || document.getElementById("friends-pending-tab-badge") || document.getElementById("friends-pending-rail-badge");
      const dst = document.getElementById("nc-badge-friends");
      const n = src ? (parseInt(String(src.textContent||"0").trim(),10)||0) : 0;
      if (dst){
        dst.textContent = String(n);
        dst.classList.toggle("is-hidden", n<=0);
      }
    }catch(e){}

    // Call indicator
    try{
      const cb = document.getElementById("call-bar");
      const badge = document.getElementById("nc-badge-call");
      const mode = cb ? String(cb.dataset.mode || "idle") : "idle";
      const active = (mode !== "idle");
      if (badge) badge.classList.toggle("is-hidden", !active);
    }catch(e){}

    // Determine active view
    let settingsOpen = false, friendsOpen = false, callFull = false;

    try{
      const so = document.getElementById("nc-settings-overlay");
      settingsOpen = !!(document.body.classList.contains("nc-settings-open") || (so && !so.classList.contains("is-hidden") && so.getAttribute("aria-hidden") !== "true"));
    }catch(e){}

    try{
      const fv = document.getElementById("friends-view");
      friendsOpen = !!(fv && !fv.classList.contains("is-hidden"));
    }catch(e){}

    try{
      const cb = document.getElementById("call-bar");
      if (cb){
        const mode = String(cb.dataset.mode || "idle");
        const min = String(cb.dataset.min || "0");
        const visible = (cb.style.display !== "none");
        callFull = (mode !== "idle") && (min !== "1") && visible && !friendsOpen && !settingsOpen;
      }
    }catch(e){}

    try{ document.body.classList.toggle("nc-call-full", !!callFull); }catch(e){}

    if (settingsOpen) setActiveTab("settings");
    else if (friendsOpen) setActiveTab("friends");
    else if (callFull) setActiveTab("call");
    else setActiveTab("chats");
  }

  function guardScreenShare(){
    const ok = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    if (ok) return;

    const btns = Array.from(document.querySelectorAll(
      "[data-action='screenshare'], .btn-screenshare, #btn-screenshare, .screenshare-btn"
    ));

    btns.forEach(b => {
      b.classList.add("disabled");
      b.setAttribute("aria-disabled","true");
      b.title = "Демонстрация экрана недоступна в этом браузере/на мобильном";
      b.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        alert("Демонстрация экрана недоступна в этом браузере/на мобильном устройстве.");
      }, {once:true});
    });
  }

  function updateVhVar(){
    try{
      const vh = (window.innerHeight || document.documentElement.clientHeight || 0) * 0.01;
      if (vh > 0) document.documentElement.style.setProperty("--nc-vh", vh.toFixed(4) + "px");
    }catch(e){}
  }

  function updateKeyboardVar(){
    try{
      const vv = window.visualViewport;
      if (!vv) return;
      const kb = Math.max(0, (window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty("--nc-kb", kb.toFixed(0) + "px");
    }catch(e){}
  }

  function applyMobile(){
    if (!isChatPage()){
      setMobileChatClass(false);
      removeMobile();
      return;
    }

    setMobileChatClass(true);
    ensureOverlay();
    ensureTopbar();
    ensureBottomBar();
    guardScreenShare();
    updateVhVar();
    updateKeyboardVar();
    try{ syncBottomBar(); }catch(e){}
  }

  function removeMobile(){
    try{ document.body.classList.remove("nc-left-open","nc-right-open","nc-call-full"); }catch(_){ }
    try{ setMobileChatClass(false); }catch(_){ }
    try{ document.documentElement.style.removeProperty("--nc-kb"); }catch(_){ }
    try{ document.documentElement.style.removeProperty("--nc-vh"); }catch(_){ }

    // If we're not on the chat page, clean injected UI to avoid ghost overlays
    if (!isChatPage()){
      ["nc-mobile-overlay","nc-mobile-topbar","nc-mobile-bottombar"].forEach(id=>{
        try{ const el = document.getElementById(id); if (el) el.remove(); }catch(e){}
      });
      overlay = null; topbar = null; bottombar = null;
    }
  }

  function init(){
    try{ updateVhVar(); }catch(e){}
    if (mq.matches) applyMobile();

    mq.addEventListener?.("change", (e)=>{
      if (e.matches){ try{ updateVhVar(); }catch(_){ } applyMobile(); }
      else removeMobile();
    });

    // Touch handlers
    window.addEventListener("touchstart", onTouchStart, {passive:true, capture:true});
    window.addEventListener("touchmove", onTouchMove, {passive:false, capture:true});
    window.addEventListener("touchend", onTouchEnd, {passive:true, capture:true});
    window.addEventListener("touchcancel", onTouchEnd, {passive:true, capture:true});

    // bottom tab sync
    setInterval(() => { try{ syncBottomBar(); }catch(e){} }, 700);

    // keyboard tracking
    if (window.visualViewport){
      window.visualViewport.addEventListener("resize", () => { updateVhVar(); updateKeyboardVar(); });
      window.visualViewport.addEventListener("scroll", () => { updateVhVar(); updateKeyboardVar(); });
    }
    window.addEventListener("resize", () => { updateVhVar(); updateKeyboardVar(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();


(function(){
  'use strict';
  const OWNER = 'jaki2932';
  const norm = (s) => String(s || '').trim().toLowerCase();
  const isOwner = (s) => norm(s) === OWNER;

  function addAdminChip(el){
    if (!el || el.querySelector('.nc-admin-chip')) return;
    const chip = document.createElement('span');
    chip.className = 'nc-admin-chip';
    chip.textContent = 'ADMIN';
    el.appendChild(document.createTextNode(' '));
    el.appendChild(chip);
  }

  function markOwnerNodes(root){
    const selectors = [
      '#me-panel .profile-name',
      '#me-popout-name',
      '#full-user-name',
      '.current-user .profile-name',
      '.current-user .user-name'
    ];
    selectors.forEach((sel)=>{
      root.querySelectorAll(sel).forEach((el)=>{
        const baseText = String(el.textContent || '').replace(/\bADMIN\b/gi,'').trim();
        const probe = el.id === 'full-user-name'
          ? String((document.getElementById('full-user-username')?.textContent || '')).replace(/^@/,'').trim() || baseText
          : baseText;
        if (!isOwner(probe)) return;
        el.classList.add('nc-owner-name');
        addAdminChip(el);
      });
    });
  }

  function dedupeDmList(){
    const list = document.querySelector('#pane-friends .friend-list');
    if (!list) return;
    const seen = new Set();
    Array.from(list.querySelectorAll('.friend-item[data-user-id], .dm-entry[data-user-id]')).forEach((item)=>{
      const uid = String(item.dataset.userId || '').trim();
      if (!uid) return;
      const dm = String(item.dataset.dmChannelId || item.dataset.adhocGroupId || '').trim();
      const key = uid + '::' + dm;
      if (seen.has(key)) {
        item.remove();
        return;
      }
      seen.add(key);
    });
  }

  function wrapPresence(){
    return;
  }

  let scheduled = false;
  function scheduleLightPass(){
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(()=>{
      scheduled = false;
      try { markOwnerNodes(document); } catch(_e){}
      try { dedupeDmList(); } catch(_e){}
      try { wrapPresence(); } catch(_e){}
    });
  }

  function boot(){
    scheduleLightPass();
    document.addEventListener('click', scheduleLightPass, true);
    window.addEventListener('load', scheduleLightPass, { once:true });
    window.addEventListener('nc:gifts-refresh', scheduleLightPass);
    window.addEventListener('nc:profile-opened', scheduleLightPass);
    const dmList = document.querySelector('#pane-friends .friend-list');
    if (dmList && typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver((mut)=>{
        for (const m of mut) {
          if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
            scheduleLightPass();
            break;
          }
        }
      });
      mo.observe(dmList, { childList:true, subtree:false });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
