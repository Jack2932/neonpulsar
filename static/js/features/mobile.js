(function(){
  const mq = window.matchMedia ? window.matchMedia('(max-width: 900px)') : { matches:false, addEventListener:null, addListener:null };

  function setVh(){
    try{
      const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.01;
      document.documentElement.style.setProperty('--nc-vh', `${vh}px`);
    }catch(e){}
  }

  function isMobile(){
    return !!mq.matches;
  }

  function closeDrawers(){
    try{ document.body.classList.remove('nc-left-open','nc-right-open'); }catch(e){}
  }

  function syncMobileFlags(){
    try{
      document.body.classList.toggle('nc-mobile-chat', isMobile());
      document.documentElement.classList.toggle('nc-mobile-chat', isMobile());
      if (!isMobile()) closeDrawers();
    }catch(e){}
    setVh();
  }

  function bindAutoClose(){
    document.addEventListener('click', function(ev){
      if (!isMobile()) return;
      const t = ev.target;
      if (!t || !t.closest) return;

      if (t.closest('#nc-mobile-overlay')) {
        closeDrawers();
        return;
      }

      if (t.closest('#pane-friends .dm-entry, #friends-view .friends-page-item, #server-list .channel-item, #pane-channels .channel-item, .guild-menu-item, .friends-tab, #btn-open-friends-view, .dm-home-item')){
        setTimeout(closeDrawers, 60);
      }

      if (t.closest('#message-input, #message-form, .composer, .chat-messages')){
        setTimeout(closeDrawers, 0);
      }
    }, true);
  }

  function bindViewport(){
    window.addEventListener('resize', setVh, {passive:true});
    window.addEventListener('orientationchange', function(){ setTimeout(setVh, 180); }, {passive:true});
    if (window.visualViewport){
      visualViewport.addEventListener('resize', setVh, {passive:true});
      visualViewport.addEventListener('scroll', setVh, {passive:true});
    }
  }

  function bindComposerScrollGuard(){
    document.addEventListener('focusin', function(ev){
      if (!isMobile()) return;
      const t = ev.target;
      if (t && t.id === 'message-input'){
        setTimeout(function(){
          try{ t.scrollIntoView({ block:'nearest', inline:'nearest' }); }catch(e){}
          setVh();
        }, 120);
      }
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){
      syncMobileFlags();
      bindAutoClose();
      bindViewport();
      bindComposerScrollGuard();
    });
  } else {
    syncMobileFlags();
    bindAutoClose();
    bindViewport();
    bindComposerScrollGuard();
  }

  if (mq.addEventListener) mq.addEventListener('change', syncMobileFlags);
  else if (mq.addListener) mq.addListener(syncMobileFlags);
})();
