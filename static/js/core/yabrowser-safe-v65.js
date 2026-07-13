(function(){
  'use strict';
  try{
    var ua = navigator.userAgent || '';
    var isYa = /YaBrowser/i.test(ua) || !!window.__NC_YABROWSER;
    if (!isYa) return;
    window.__NC_YABROWSER = true;
    try{ document.documentElement.classList.add('is-yabrowser','yabrowser','nc-yabrowser-lite'); }catch(e){}
    try{ document.documentElement.classList.remove('force-motion'); }catch(e){}
    document.addEventListener('DOMContentLoaded', function(){
      try{ document.body && document.body.classList.add('nc-yabrowser-lite'); }catch(e){}
      try{
        document.querySelectorAll('canvas, .visualizer, .music2026-viz, .music2026-rays, .music2026-blob, .orb, .ambient-orb, .fx-orb, .bg-orb').forEach(function(el){
          if (!el) return;
          try{ el.remove(); }catch(_e){ try{ el.style.display = 'none'; }catch(_e2){} }
        });
      }catch(e){}
    }, { once:true });
  }catch(e){}
})();
