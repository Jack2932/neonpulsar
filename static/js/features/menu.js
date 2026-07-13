/* Semantic script */

// Discord-like bottom-left user popout menu
(function(){
  'use strict';

  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  const mePanel = $('#me-panel');
  const meLeft = mePanel ? $('.current-user-left', mePanel) : null;
  const mePopout = $('#me-popout');
  const meSubmenu = $('#me-dnd-submenu');

  if (!mePanel || !mePopout) return;

  // Helpers: get current user data from DOM dataset
  function getMe(){
    return {
      id: parseInt(mePanel.dataset.userId || mePanel.dataset.userid || '0', 10) || 0,
      username: (mePanel.dataset.username || '').trim(),
      avatarUrl: (mePanel.dataset.avatarUrl || '').trim(),
    };
  }

  function syncPopout(){
    const me = getMe();
    const avatar = $('#me-popout-avatar');
    const name = $('#me-popout-name');
    const sub = $('#me-popout-sub');
    const dot = $('#me-popout-dot');
    if (name) name.textContent = me.username || 'Пользователь';
    // Presence text mirrors bottom panel
    const meSub = $('#me-sub');
    if (sub && meSub) sub.textContent = (meSub.textContent || '').trim();
    // avatar
    if (avatar){
      avatar.classList.toggle('has-image', !!me.avatarUrl);
      avatar.style.backgroundImage = me.avatarUrl ? `url(${me.avatarUrl})` : '';
      const init = $('.avatar-initial', avatar);
      if (init) init.textContent = me.avatarUrl ? '' : (me.username ? me.username[0].toUpperCase() : 'N');
    }
    // dot copies class from bottom dot
    const bottomDot = $('#current-user-dot');
    if (dot && bottomDot){
      dot.className = bottomDot.className;
    }
  }

  function positionPopout(){
    const anchor = mePanel;
    const r = anchor.getBoundingClientRect();
    // Prefer opening above the panel like Discord
    const margin = 10;
    const w = mePopout.offsetWidth || 360;
    const h = mePopout.offsetHeight || 360;
    let left = Math.round(r.left + margin);
    left = Math.min(left, window.innerWidth - w - margin);
    let top = Math.round(r.top - h - margin);
    if (top < margin) top = Math.round(r.bottom + margin);
    top = Math.min(top, window.innerHeight - h - margin);
    mePopout.style.left = `${left}px`;
    mePopout.style.top = `${top}px`;
  }

  function hideSubmenu(){
    if (meSubmenu) {
      meSubmenu.setAttribute('hidden','');
      meSubmenu.setAttribute('aria-hidden','true');
    }
  }

  function show(){
    syncPopout();
    mePopout.removeAttribute('hidden');
    mePopout.setAttribute('aria-hidden','false');
    positionPopout();
    hideSubmenu();
  }

  function hide(){
    mePopout.setAttribute('hidden','');
    mePopout.setAttribute('aria-hidden','true');
    hideSubmenu();
  }

  function toggle(){
    if (mePopout.hasAttribute('hidden')) show();
    else hide();
  }

  // Open menu when clicking the left part of the bottom panel
  // Capture = we prevent older click handlers (e.g. "click on name to edit") from firing.
  mePanel.addEventListener('click', (e)=>{
    const t = e.target;
    // Don't hijack action buttons (mic/deafen/settings)
    if (t && (t.closest && t.closest('.current-user-actions'))) return;
    if (t && (t.closest && t.closest('.icon-btn'))) return;
    // Only open when click is inside panel
    if (!mePanel.contains(t)) return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }, true);

  // Close on outside click / ESC
  document.addEventListener('click', (e)=>{
    if (mePopout.hasAttribute('hidden')) return;
    const t = e.target;
    if (mePopout.contains(t) || mePanel.contains(t)) return;
    hide();
  });
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') hide();
  });

  window.addEventListener('resize', ()=>{ if (!mePopout.hasAttribute('hidden')) positionPopout(); });

  // Actions
  const btnEdit = $('#me-popout-edit');
  if (btnEdit){
    btnEdit.addEventListener('click', ()=>{
      // Open profile edit directly if main.js exposed helper (safer with capture-phase hotfixes)
      try{
        if (typeof window.__ncOpenEditProfileModal === 'function'){
          window.__ncOpenEditProfileModal();
        } else {
          const nameEl = document.querySelector('.sidebar-bottom .current-user .user-meta .user-name');
          nameEl && nameEl.click();
        }
      }catch(_){ }
      hide();
    });
  }

  const btnCopyId = $('#me-popout-copyid');
  if (btnCopyId){
    btnCopyId.addEventListener('click', async ()=>{
      const me = getMe();
      const txt = String(me.id || '');
      try{
        await navigator.clipboard.writeText(txt);
        btnCopyId.textContent = 'Скопировано ✓';
        setTimeout(()=>{ btnCopyId.textContent = 'Копировать ID'; }, 1200);
      }catch(e){
        try{
          const ta = document.createElement('textarea');
          ta.value = txt;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          btnCopyId.textContent = 'Скопировано ✓';
          setTimeout(()=>{ btnCopyId.textContent = 'Копировать ID'; }, 1200);
        }catch(_){ }
      }
    });
  }

  // Status buttons: reuse existing presence menu click handlers.
  function clickPresence(mode){
    const btn = document.querySelector(`.presence-menu .presence-item[data-mode="${mode}"]`);
    if (btn) btn.click();
  }

  $all('.me-status-btn[data-mode]', mePopout).forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const mode = (btn.dataset.mode || '').trim();
      if (!mode) return;
      if (mode === 'dnd' && btn.dataset.hasSub === '1'){
        // Toggle submenu
        if (!meSubmenu) return;
        const open = meSubmenu.hasAttribute('hidden');
        if (open){
          meSubmenu.removeAttribute('hidden');
          meSubmenu.setAttribute('aria-hidden','false');
        } else {
          hideSubmenu();
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Clear timed DND on normal status change
      try{ localStorage.removeItem('nc_dnd_until'); }catch(_){ }
      clickPresence(mode);
      hide();
    });
  });

  // Timed DND submenu
  function setDndUntil(minutes){
    try{
      if (!minutes || minutes <= 0) {
        localStorage.setItem('nc_dnd_until', 'forever');
      } else {
        const until = Date.now() + minutes * 60 * 1000;
        localStorage.setItem('nc_dnd_until', String(until));
      }
    }catch(_){ }
  }

  function scheduleDndCheck(){
    let raw = '';
    try{ raw = localStorage.getItem('nc_dnd_until') || ''; }catch(_){ raw = ''; }
    if (!raw) return;
    if (raw === 'forever') return;
    const until = parseInt(raw, 10) || 0;
    if (!until) return;
    const ms = until - Date.now();
    if (ms <= 0){
      try{ localStorage.removeItem('nc_dnd_until'); }catch(_){ }
      // Only revert if we are still in DND
      try{ clickPresence('online'); }catch(_){ }
      return;
    }
    setTimeout(()=>{
      // Re-check on timeout
      scheduleDndCheck();
    }, Math.min(ms + 250, 60*1000));
  }

  if (meSubmenu){
    $all('.me-subitem[data-min]', meSubmenu).forEach(it=>{
      it.addEventListener('click', ()=>{
        const min = parseInt(it.dataset.min || '0', 10) || 0;
        clickPresence('dnd');
        setDndUntil(min);
        scheduleDndCheck();
        hide();
      });
    });
  }

  // On load: restore timed DND if still active
  try{
    const raw = localStorage.getItem('nc_dnd_until') || '';
    if (raw){
      if (raw === 'forever'){
        // do nothing: user likely set it intentionally
      } else {
        const until = parseInt(raw, 10) || 0;
        if (until && until > Date.now()){
          // If user is not in DND yet, keep it consistent
          const cur = (document.querySelector('.chat-main')?.dataset.currentPresenceMode || '').toLowerCase();
          if (cur && cur !== 'dnd') clickPresence('dnd');
          scheduleDndCheck();
        } else {
          localStorage.removeItem('nc_dnd_until');
        }
      }
    }
  }catch(_){ }
})();
