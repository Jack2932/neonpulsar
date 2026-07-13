(function(){
  'use strict';
  if (window.__ncResponsiveYaV62Installed) return;
  window.__ncResponsiveYaV62Installed = true;

  function viewportWidth(){
    try{
      if (window.visualViewport && Number(window.visualViewport.width)) return Math.round(window.visualViewport.width);
    }catch(e){}
    return Math.max(document.documentElement ? document.documentElement.clientWidth : 0, window.innerWidth || 0, 0);
  }

  function syncViewportClasses(){
    const body = document.body;
    const root = document.documentElement;
    if (!body || !root) return;
    const w = viewportWidth();
    body.classList.toggle('nc-layout-compact', w <= 1500);
    body.classList.toggle('nc-layout-narrow', w <= 1280);
    body.classList.toggle('nc-layout-tight', w <= 1120);
    root.classList.toggle('nc-vp-compact', w <= 1500);
    root.classList.toggle('nc-vp-narrow', w <= 1280);
    root.classList.toggle('nc-vp-tight', w <= 1120);
  }

  function trimYaBrowser(){
    try{
      const root = document.documentElement;
      const isYa = !!(window.__NC_YABROWSER || (root && root.classList && (root.classList.contains('is-yabrowser') || root.classList.contains('yabrowser'))));
      if (!isYa) return;
      document.body && document.body.classList.add('nc-yabrowser-lite');
      try{ document.documentElement.style.scrollBehavior = 'auto'; }catch(e){}
      try{
        document.querySelectorAll('canvas').forEach((c) => {
          if (c && c.id !== 'music-viz') c.style.willChange = 'auto';
        });
      }catch(e){}
    }catch(e){}
  }

  function sync(){
    syncViewportClasses();
    trimYaBrowser();
  }

  let resizeTimer = 0;
  function schedule(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sync, 40);
  }

  function bind(){
    window.addEventListener('resize', schedule, { passive:true });
    window.addEventListener('orientationchange', schedule, { passive:true });
    window.addEventListener('pageshow', sync, { passive:true });
    if (window.visualViewport) {
      try{ window.visualViewport.addEventListener('resize', schedule, { passive:true }); }catch(e){}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ bind(); sync(); setTimeout(sync, 160); });
  } else {
    bind(); sync(); setTimeout(sync, 160);
  }
})();
