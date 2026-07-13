/* Semantic script */


// v9.13 fix19: UI safety + guaranteed clickability + group-call modal open
// - Kills invisible full-screen overlays that accidentally block clicks (idle call HUD / hidden stages)
// - Guarantees header "Group call" button opens the group-call modal (Discord-like)
// - Provides debug helper: __ncOpenGroupCallModalFix19()

(function(){
  const $ = (id)=>document.getElementById(id);

  function showModal(el){
    if(!el) return;
    try{
      el.classList.add('active');
      el.setAttribute('aria-hidden','false');
      // FIX21: if anything left inline display:none/pointer-events:none, clear it.
      try{
        el.style.display = '';
        el.style.pointerEvents = '';
        el.style.visibility = '';
        el.style.opacity = '';
        el.removeAttribute('hidden');
      }catch(_){ }
      // lock scroll like Discord
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
    }catch(e){}
  }
  function hideModal(el){
    if(!el) return;
    try{
      el.classList.remove('active');
      el.setAttribute('aria-hidden','true');
      // unlock scroll if no active modals
      try{
        if(!document.querySelector('.modal-backdrop.active')){
          document.documentElement.classList.remove('modal-open');
          document.body.classList.remove('modal-open');
        }
      }catch(e){}
    }catch(e){}
  }

  function ensureNotBlocking(){
    try{
      const callBar = $('call-bar');
      if (callBar) {
        const mode = String(callBar.dataset && callBar.dataset.mode || 'idle');
        if (!mode || mode === 'idle') {
          callBar.style.display = 'none';
          callBar.style.pointerEvents = 'none';
        }
      }
    }catch(e){}

    try{
      const grid = $('call-ss-grid');
      if (grid && String(grid.getAttribute('aria-hidden')) === 'true') {
        grid.style.display = 'none';
      }
    }catch(e){}

    try{
      const stage = $('call-screen-stage');
      if (stage && stage.classList && stage.classList.contains('is-hidden')) {
        stage.style.display = 'none';
      }
    }catch(e){}

    // Any modal-backdrop with aria-hidden=true must never block clicks.
    // IMPORTANT: do NOT set display:none inline (it can stick and break future opens).
    try{
      document.querySelectorAll('.modal-backdrop').forEach(el=>{
        const hidden = (String(el.getAttribute('aria-hidden')) === 'true') || !!el.hasAttribute('hidden') || !el.classList.contains('active');
        if (hidden){
          el.style.pointerEvents = 'none';
        } else {
          el.style.pointerEvents = '';
          if (el.style.display === 'none') el.style.display = '';
        }
      });
    }catch(e){}
  }

  // Hard guard: if some invisible overlay still exists, disable it
  function killTransparentFullscreenOverlays(){
    try{
      const els = document.querySelectorAll('body *');
      const vw = window.innerWidth, vh = window.innerHeight;
      for (let i=0; i<els.length; i++){
        const el = els[i];
        // skip legit modals
        if (el.classList && (el.classList.contains('modal') || el.classList.contains('modal-backdrop'))) continue;

        const cs = window.getComputedStyle(el);
        if (!cs) continue;
        if (cs.position !== 'fixed') continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const z = parseInt(cs.zIndex || '0', 10);
        if (!z || z < 1000) continue;
        if (cs.pointerEvents !== 'auto') continue;
        const op = parseFloat(cs.opacity || '1');
        if (op > 0.03) continue;

        const r = el.getBoundingClientRect();
        // Fullscreen-ish
        const full = (r.left <= 0 && r.top <= 0 && r.width >= vw-2 && r.height >= vh-2);
        if (!full) continue;

        // Disable it
        el.style.pointerEvents = 'none';
        el.style.display = 'none';
      }
    }catch(e){}
  }

  function openGroupCall(){
    // Prefer native main.js modal logic if available
    try{
      if (typeof window.openGroupCallModal === 'function') {
        const precheck = (typeof window.currentDmUserId !== 'undefined' && window.currentDmUserId) ? [window.currentDmUserId] : [];
        window.openGroupCallModal({ intent: 'start', precheckIds: precheck });
        return true;
      }
    }catch(e){}

    // Fallback: show modal element directly
    const modal = $('modal-group-call');
    if(modal){
      showModal(modal);
      return true;
    }
    return false;
  }

  function bindGroupCallButton(){
    const btn = $('btn-header-group-call');
    if(!btn) return;

    const handler = (ev)=>{
      try{ ev.preventDefault(); }catch(e){}
      try{ ev.stopPropagation(); }catch(e){}
      ensureNotBlocking();
      openGroupCall();
    };

    try{ btn.addEventListener('pointerdown', handler, true); }catch(e){}
    try{ btn.addEventListener('click', handler, true); }catch(e){}
  }

  function bindModalClose(){
    const modal = $('modal-group-call');
    if(!modal) return;

    const closeBtn = $('modal-close-group-call');
    const cancelBtn = $('btn-cancel-group-call');

    const close = (ev)=>{
      try{ ev && ev.preventDefault(); }catch(e){}
      try{ ev && ev.stopPropagation(); }catch(e){}
      hideModal(modal);
    };

    try{ closeBtn && closeBtn.addEventListener('click', close); }catch(e){}
    try{ cancelBtn && cancelBtn.addEventListener('click', close); }catch(e){}
    try{
      modal.addEventListener('click', (ev)=>{
        // click on backdrop closes
        if (ev && ev.target === modal) close(ev);
      });
    }catch(e){}
    try{
      document.addEventListener('keydown', (ev)=>{
        if (ev && ev.key === 'Escape' && modal.classList.contains('active')) close(ev);
      });
    }catch(e){}
  }

  window.__ncOpenGroupCallModalFix19 = function(){ ensureNotBlocking(); return openGroupCall(); };

  window.addEventListener('DOMContentLoaded', ()=>{
    ensureNotBlocking();
    bindGroupCallButton();
    bindModalClose();

    // Periodic safety: prevent "dead UI" after screenshare/failed reconnect
    setInterval(()=>{ ensureNotBlocking(); }, 1200);

    // Extra safety if some overlay keeps blocking
    document.addEventListener('pointerdown', ()=>{ killTransparentFullscreenOverlays(); }, true);
  });
})();

(function(){
  'use strict';
  function unstick(){
    try{
      var sels = ['#global-loader','#app-loader','.app-loader','.app-loading','.nc-loading','.loading-overlay','.preloader','.splash-loader'];
      sels.forEach(function(s){ document.querySelectorAll(s).forEach(function(el){ try{ el.style.display='none'; el.hidden=true; el.classList&&el.classList.add('is-hidden'); }catch(e){} }); });
      try{ document.documentElement.classList.remove('loading','is-loading'); }catch(e){}
      try{ document.body && document.body.classList.remove('loading','is-loading'); }catch(e){}
    }catch(e){}
  }
  window.__nc_force_unstick_loader_fix26 = unstick;
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', function(){ setTimeout(unstick, 4500); }, {once:true}); }
  else { setTimeout(unstick, 4500); }
})();



// v9.13 fix19: per-button "alive" animations for call controls (Discord-like)
// Adds short-lived classes on click/toggle so each button has its own vibe.

(function(){
  const byId=(id)=>document.getElementById(id);

  function pulse(el, cls){
    if(!el) return;
    el.classList.remove(cls);
    // force reflow
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(()=>{ try{ el.classList.remove(cls); }catch(e){} }, 550);
  }

  function bind(){
    const map = [
      ['btn-toggle-mic','fx-mic'],
      ['btn-voice-mic','fx-mic'],
      ['me-mic','fx-mic'],
      ['btn-toggle-sound','fx-sound'],
      ['btn-voice-sound','fx-sound'],
      ['me-deafen','fx-sound'],
      ['btn-call-video','fx-cam'],
      ['btn-share-screen','fx-screen'],
      ['btn-end-call','fx-hang'],
      ['btn-header-call','fx-call'],
      ['btn-header-group-call','fx-group'],
      ['btn-voice-settings','fx-gear'],
      ['gm-settings','fx-gear'],
      ['me-settings','fx-gear'],
      ['ss-settings','fx-gear'],
      ['btn-header-settings','fx-gear'],
      ['btn-call-settings','fx-gear'],
    ];

    map.forEach(([id, cls])=>{
      const el = byId(id);
      if(!el) return;
      el.dataset.fx = cls;
      // Tap effect
      el.addEventListener('click', ()=>pulse(el,'fx-tap'), true);
      // Unique effect
      el.addEventListener('click', ()=>pulse(el,cls), true);
    });
  }

  window.addEventListener('DOMContentLoaded', bind);
})();



// v9.13 fix19: Force group-call modal "Call" button to work even if main.js handler didn't bind.
// Uses the same call-start functions if available (startAdhocGroupCall / convertToAdhocGroupCall / inviteToExistingGroupCall).
(function(){
  function $(id){ return document.getElementById(id); }

  async function onStart(ev){
    const btn = $('btn-start-group-call-selected');
    const modal = $('modal-group-call');
    if(!btn || !modal) return;

    // If disabled, do nothing (keeps UX).
    if (btn.disabled) return;

    try{ ev.preventDefault(); }catch(e){}
    try{ ev.stopPropagation(); }catch(e){}
    try{ ev.stopImmediatePropagation(); }catch(e){}

    if (btn.dataset.gcStarting === '1') return;
    btn.dataset.gcStarting = '1';

    const checked = modal.querySelectorAll('.group-call-friend-checkbox:checked');
    const targets = [];
    checked.forEach(cb=>{
      const v = parseInt(cb.value,10);
      if(!v) return;
      try{
        if (typeof window.currentUserId !== 'undefined' && window.currentUserId && v === window.currentUserId) return;
      }catch(e){}
      targets.push(v);
    });

    const out = $('group-call-result');
    if(!targets.length){
      if(out) out.textContent = 'Выбери хотя бы одного друга.';
      btn.dataset.gcStarting = '0';
      return;
    }

    // Close modal visually (Discord-like: instant close)
    try{
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden','true');
    }catch(e){}

    try{
      if (typeof window.groupCallActive !== 'undefined' && window.groupCallActive && typeof window.inviteToExistingGroupCall === 'function'){
        await window.inviteToExistingGroupCall(targets);
      } else if (typeof window.peerConnection !== 'undefined' && window.peerConnection && typeof window.convertToAdhocGroupCall === 'function'){
        await window.convertToAdhocGroupCall(targets);
      } else if (typeof window.startAdhocGroupCall === 'function'){
        await window.startAdhocGroupCall(targets);
      } else {
        // No call engine available
        if(out) out.textContent = 'Движок звонка не загрузился (main.js).';
      }
    }catch(e){
      try{ console.error(e); }catch(_){}
      if(out) out.textContent = 'Ошибка при запуске группового звонка.';
    } finally {
      btn.dataset.gcStarting = '0';
    }
  }

  function bind(){
    const btn = $('btn-start-group-call-selected');
    if(!btn) return;
    // capture-phase so it works even if other handlers broke
    btn.addEventListener('click', onStart, true);
  }

  window.addEventListener('DOMContentLoaded', bind);
})();


// v9.13 fix18: HARD group-call button binding + modal fallback
// Ensures the "Групповой звонок" button always opens the modal.

(function(){
  function $(id){ return document.getElementById(id); }

  function safeStop(ev){
    try{ ev.preventDefault(); }catch(e){}
    try{ ev.stopPropagation(); }catch(e){}
    try{ ev.stopImmediatePropagation(); }catch(e){}
  }

  function openViaApi(intent){
    try{
      if (typeof window.openGroupCallModal === 'function') {
        var pre = [];
        try{
          if (typeof window.currentDmUserId !== 'undefined' && window.currentDmUserId) pre = [window.currentDmUserId];
        }catch(e){}
        window.openGroupCallModal({ intent: intent || 'start', precheckIds: pre });
        return true;
      }
      if (typeof window.__ncOpenGroupCallModal === 'function') {
        window.__ncOpenGroupCallModal({ intent: intent || 'start', precheckIds: [] });
        return true;
      }
    } catch (e) {}
    return false;
  }

  function openFallback(intent){
    var modal = $('modal-group-call');
    if (!modal) return false;
    try{
      // FIX21: clear sticky inline styles from previous safety runs.
      try{ modal.style.display=''; modal.style.pointerEvents=''; modal.style.visibility=''; modal.style.opacity=''; }catch(e){}
      try{ modal.removeAttribute('hidden'); }catch(e){}
      modal.classList.add('active');
      modal.setAttribute('aria-hidden','false');
      modal.dataset.intent = intent || 'start';
      // Reset search
      var s = $('group-call-search');
      if (s){ s.value=''; }
    } catch (e) {}
    return true;
  }

  function tryOpen(intent){
    return openViaApi(intent) || openFallback(intent);
  }

  function findBtnFromPoint(x,y){
    try{
      if (!document.elementsFromPoint) return null;
      var els = document.elementsFromPoint(x,y) || [];
      for (var i=0;i<els.length;i++) {
        var el = els[i];
        if (!el) continue;
        if (el.id === 'btn-header-group-call') return el;
        if (el.closest){
          var b = el.closest('#btn-header-group-call');
          if (b) return b;
        }
      }
    } catch (e) {}
    return null;
  }

  function matchesGroupCallButton(el){
    if (!el) return false;
    try{
      if (el.id === 'btn-header-group-call') return true;
      if (el.closest && el.closest('#btn-header-group-call')) return true;
      // future-proof: allow data-action
      if (el.closest && el.closest('[data-action="group-call"]')) return true;
    } catch (e) {}
    return false;
  }

  function bindDirect(){
    var btn = $('btn-header-group-call');
    if (!btn) return;
    if (btn.dataset && btn.dataset.gcBound === '1') return;
    if (btn.dataset) btn.dataset.gcBound = '1';

    var handler = function(ev){
      safeStop(ev);
      tryOpen('start');
    };

    try{ btn.addEventListener('pointerdown', handler, true); }catch(e){}
    try{ btn.addEventListener('click', handler, true); }catch(e){}
  }

  // Document-level HARD capture (works even when some overlay swallows the click)
  function docHandler(ev){
    try{
      var t = ev && ev.target;
      if (matchesGroupCallButton(t)) {
        safeStop(ev);
        tryOpen('start');
        return;
      }
      // If the click didn't land on the button due to an overlay, do a hit-test.
      var x = ev && (ev.clientX || ev.pageX);
      var y = ev && (ev.clientY || ev.pageY);
      if (typeof x === 'number' && typeof y === 'number') {
        var b = findBtnFromPoint(x,y);
        if (b) {
          safeStop(ev);
          tryOpen('start');
          return;
        }
      }
    } catch (e) {}
  }

  function boot(){
    // direct bind
    bindDirect();

    // hard capture on doc
    try{ document.addEventListener('pointerdown', docHandler, true); }catch(e){}
    try{ document.addEventListener('click', docHandler, true); }catch(e){}

    // watch for rerenders
    try{
      var mo = new MutationObserver(function(){ bindDirect(); });
      mo.observe(document.documentElement || document.body, {subtree:true, childList:true});
    } catch(e) {}

    // expose debug
    try{
      window.__ncForceOpenGroupCall = window.__ncForceOpenGroupCall || function(intent){ tryOpen(intent||'start'); };
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
