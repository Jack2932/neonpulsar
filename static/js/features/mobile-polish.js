(function(){
  const mq = window.matchMedia ? window.matchMedia('(max-width: 900px)') : { matches:false, addEventListener:null, addListener:null };
  const vv = window.visualViewport || null;

  function isMobile(){ return !!mq.matches; }
  function body(){ return document.body; }

  function setViewportVars(){
    try{
      const vh = ((vv && vv.height) ? vv.height : window.innerHeight) * 0.01;
      document.documentElement.style.setProperty('--nc-vh', vh + 'px');
      const base = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      const current = Math.max((vv && vv.height) ? vv.height : 0, 0);
      const offsetTop = vv ? Math.max(vv.offsetTop || 0, 0) : 0;
      const keyboardInset = isMobile() ? Math.max(0, Math.round(base - current - offsetTop)) : 0;
      document.documentElement.style.setProperty('--nc-kb', keyboardInset + 'px');
    }catch(e){}
  }

  function closeDrawers(){
    try{ body().classList.remove('nc-left-open','nc-right-open'); }catch(e){}
  }

  function getEmojiPop(){
    return document.getElementById('emoji-pop') || document.querySelector('.emoji-pop, .nc-emoji-pop');
  }

  function isEmojiVisible(pop){
    if (!pop) return false;
    const cs = window.getComputedStyle(pop);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.02 && !pop.classList.contains('is-hidden') && !pop.hidden;
  }

  function syncEmojiSheet(){
    if (!isMobile()) return;
    const pop = getEmojiPop();
    if (!pop || !isEmojiVisible(pop)) return;
    try{
      const side = window.innerWidth <= 640 ? 8 : 10;
      const composer = document.getElementById('message-form');
      const anchorBottom = composer ? Math.max(74, Math.round(window.innerHeight - composer.getBoundingClientRect().top + 10)) : 84;
      pop.style.left = side + 'px';
      pop.style.right = side + 'px';
      pop.style.top = 'auto';
      pop.style.bottom = 'calc(' + anchorBottom + 'px + var(--nc-mobile-bottom-inset, 0px) + var(--nc-kb, 0px))';
      pop.style.width = 'auto';
      pop.style.maxWidth = 'none';
      pop.style.transform = 'none';
      pop.style.position = 'fixed';
    }catch(e){}
  }

  function friendsViewVisible(){
    const fv = document.getElementById('friends-view');
    if (!fv) return false;
    const cs = window.getComputedStyle(fv);
    return !fv.classList.contains('is-hidden') && cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function syncMobileViewState(){
    if (!document.body) return;
    const b = body();
    if (!isMobile()){
      b.classList.remove('nc-mobile-friends-active','nc-mobile-dm-active','nc-mobile-guild-active','nc-mobile-center-friends','nc-mobile-center-dm','nc-mobile-center-guild');
      return;
    }
    const activeFriend = document.querySelector('#pane-friends .friend-item.active, #pane-friends .dm-entry.active');
    const activeChannel = document.querySelector('#pane-channels .channel-item.active');
    const friendsActive = friendsViewVisible();
    const dmActive = !friendsActive && !!activeFriend;
    const guildActive = !friendsActive && !activeFriend && !!activeChannel;
    b.classList.toggle('nc-mobile-friends-active', friendsActive);
    b.classList.toggle('nc-mobile-dm-active', dmActive);
    b.classList.toggle('nc-mobile-guild-active', guildActive);
    b.classList.toggle('nc-mobile-center-friends', friendsActive);
    b.classList.toggle('nc-mobile-center-dm', dmActive);
    b.classList.toggle('nc-mobile-center-guild', guildActive);
  }

  function bindAutoClose(){
    document.addEventListener('click', function(ev){
      if (!isMobile()) return;
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (t.closest('#pane-friends .friend-item, #pane-friends .dm-entry, #friends-view .friends-page-item, #pane-channels .channel-item, .guild-item, .guild-menu-item, .friends-tab')){
        setTimeout(function(){ closeDrawers(); syncMobileViewState(); }, 90);
      }
      if (t.closest('#btn-open-friends-view, .dm-home-item')){
        setTimeout(syncMobileViewState, 60);
      }
      if (t.closest('#btn-emoji-insert')){
        setTimeout(syncEmojiSheet, 40);
        setTimeout(syncEmojiSheet, 160);
      }
    }, true);
  }

  function bindObservers(){
    const targets = [document.querySelector('.chat-main'), document.getElementById('friends-view'), document.getElementById('pane-friends'), document.getElementById('message-form')].filter(Boolean);
    if (!targets.length || !window.MutationObserver) return;
    const obs = new MutationObserver(function(){
      syncMobileViewState();
      syncEmojiSheet();
    });
    targets.forEach(function(t){
      obs.observe(t, { attributes:true, attributeFilter:['class','style','hidden','aria-hidden'], childList:true, subtree:false });
    });
  }

  function bindWindow(){
    window.addEventListener('resize', function(){ setViewportVars(); syncMobileViewState(); syncEmojiSheet(); }, {passive:true});
    window.addEventListener('orientationchange', function(){ setTimeout(function(){ setViewportVars(); syncMobileViewState(); syncEmojiSheet(); }, 220); }, {passive:true});
    document.addEventListener('focusin', function(ev){
      if (!isMobile()) return;
      const t = ev.target;
      if (t && t.id === 'message-input'){
        closeDrawers();
        setTimeout(function(){ setViewportVars(); syncEmojiSheet(); }, 120);
      }
    });
    document.addEventListener('keydown', function(ev){
      if (!isMobile()) return;
      if (ev.key === 'Escape') closeDrawers();
    });
    if (vv){
      vv.addEventListener('resize', function(){ setViewportVars(); syncEmojiSheet(); }, {passive:true});
      vv.addEventListener('scroll', function(){ setViewportVars(); syncEmojiSheet(); }, {passive:true});
    }
  }

  function init(){
    setViewportVars();
    syncMobileViewState();
    syncEmojiSheet();
    bindAutoClose();
    bindObservers();
    bindWindow();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  if (mq.addEventListener) mq.addEventListener('change', function(){ setViewportVars(); syncMobileViewState(); syncEmojiSheet(); });
  else if (mq.addListener) mq.addListener(function(){ setViewportVars(); syncMobileViewState(); syncEmojiSheet(); });
})();
