(function(){
  "use strict";
  try{
    var ua = navigator.userAgent || '';
    var isYa = /YaBrowser|Yandex|Yowser|YaApp/i.test(ua) || !!window.__NC_YABROWSER;
    if (!isYa) return;
    document.documentElement.classList.add('is-yabrowser','yabrowser','nc-yabrowser-lite');
    window.__NC_YABROWSER = true;
    function trimDecor(){
      try{
        document.querySelectorAll('[data-visualizer], .visualizer-canvas, .voice-visualizer, .call-visualizer, #music-viz, .orb, .ambient-orb, .fx-orb, .bg-orb, .music2026-blob, .music2026-rays').forEach(function(el){
          try{ el.remove(); }catch(_e){}
        });
      }catch(e){}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', trimDecor, {once:true});
    } else {
      trimDecor();
    }
    window.addEventListener('load', function(){ setTimeout(trimDecor, 150); }, {once:true});
  }catch(e){}
})();
