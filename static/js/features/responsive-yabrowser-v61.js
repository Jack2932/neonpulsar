(function(){
  'use strict';
  if (window.__ncResponsiveYaV61Installed) return;
  window.__ncResponsiveYaV61Installed = true;

  function viewportWidth(){
    try{
      if (window.visualViewport && Number(window.visualViewport.width)) return Math.round(window.visualViewport.width);
    }catch(e){}
    return Math.max(document.documentElement ? document.documentElement.clientWidth : 0, window.innerWidth || 0, 0);
  }

  function isVisible(el){
    try{
      if (!el || el.hidden) return false;
      const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (!cs) return true;
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.01;
    }catch(e){ return false; }
  }

  function syncViewportClasses(){
    const w = viewportWidth();
    const body = document.body;
    const root = document.documentElement;
    if (!body || !root) return;

    body.classList.toggle('nc-layout-compact', w <= 1500);
    body.classList.toggle('nc-layout-narrow', w <= 1280);
    body.classList.toggle('nc-layout-tight', w <= 1120);

    root.classList.toggle('nc-vp-compact', w <= 1500);
    root.classList.toggle('nc-vp-narrow', w <= 1280);
    root.classList.toggle('nc-vp-tight', w <= 1120);
  }

  function syncUiModes(){
    const body = document.body;
    if (!body) return;
    const title = String((document.getElementById('current-channel-name') && document.getElementById('current-channel-name').textContent) || '').trim();
    const friendsView = document.getElementById('friends-view');
    const friendsVisible = isVisible(friendsView) && !friendsView.classList.contains('is-hidden');
    const activeDm = document.querySelector('#pane-friends .dm-entry.active, #pane-friends .friend-item.active, #friends-view .friends-page-item.active');
    const emptyTitles = ['Группа не выбрана', 'Канал не выбран', 'Чат не выбран'];
    const isEmpty = !friendsVisible && !activeDm && emptyTitles.indexOf(title) !== -1;
    body.classList.toggle('nc-ui-mode-empty', isEmpty);
  }

  function sync(){
    syncViewportClasses();
    syncUiModes();
  }

  function bind(){
    window.addEventListener('resize', sync, { passive:true });
    window.addEventListener('orientationchange', sync, { passive:true });
    window.addEventListener('pageshow', sync, { passive:true });
    if (window.visualViewport) {
      try{ window.visualViewport.addEventListener('resize', sync, { passive:true }); }catch(e){}
    }
    document.addEventListener('click', function(ev){
      const t = ev.target instanceof Element ? ev.target : null;
      if (!t) return;
      if (t.closest('#btn-open-friends-view, #pane-friends .dm-entry, #pane-friends .friend-item, #friends-view .friends-page-item, #server-list .channel-item, #pane-channels .channel-item')) {
        setTimeout(sync, 0);
        setTimeout(sync, 120);
        setTimeout(sync, 320);
      }
    }, true);
    const title = document.getElementById('current-channel-name');
    if (title && window.MutationObserver){
      new MutationObserver(sync).observe(title, { childList:true, subtree:true, characterData:true });
    }
    const friendsView = document.getElementById('friends-view');
    if (friendsView && window.MutationObserver){
      new MutationObserver(sync).observe(friendsView, { attributes:true, childList:true, subtree:true, attributeFilter:['class','style','hidden','aria-hidden'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ bind(); sync(); setTimeout(sync, 120); setTimeout(sync, 500); setTimeout(sync, 1200); });
  } else {
    bind(); sync(); setTimeout(sync, 120); setTimeout(sync, 500); setTimeout(sync, 1200);
  }
})();
