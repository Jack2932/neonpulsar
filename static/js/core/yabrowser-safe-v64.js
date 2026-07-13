(function(){
  'use strict';
  try{
    var ua = navigator.userAgent || '';
    var isYa = /YaBrowser/i.test(ua) || !!window.__NC_YABROWSER;
    if (!isYa) return;

    try{ document.documentElement.classList.add('is-yabrowser'); }catch(e){}
    try{ document.documentElement.classList.add('yabrowser'); }catch(e){}
    try{ window.__NC_YABROWSER = true; }catch(e){}

    /* Throttle RAF globally in YaBrowser so heavy visual loops cannot starve the tab. */
    var queued = [];
    var active = new Map();
    var rafTimer = 0;
    var rafId = 1;
    function flush(){
      rafTimer = 0;
      var batch = queued.slice();
      queued.length = 0;
      var ts = (window.performance && typeof performance.now === 'function') ? performance.now() : Date.now();
      for (var i = 0; i < batch.length; i++){
        var item = batch[i];
        if (!active.has(item.id)) continue;
        active.delete(item.id);
        try{ item.cb(ts); }catch(e){}
      }
    }
    window.requestAnimationFrame = function(cb){
      var id = rafId++;
      active.set(id, cb);
      queued.push({ id: id, cb: cb });
      if (!rafTimer) rafTimer = window.setTimeout(flush, 50);
      return id;
    };
    window.cancelAnimationFrame = function(id){
      active.delete(id);
    };

    /* Clamp ultra-fast intervals; keep app logic alive but stop browser-killer loops. */
    var nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = function(fn, ms){
      var delay = typeof ms === 'number' ? ms : 0;
      if (delay > 0 && delay < 250) delay = 250;
      return nativeSetInterval(fn, delay);
    };

    document.addEventListener('DOMContentLoaded', function(){
      try{ document.body && document.body.classList.add('nc-yabrowser-safe'); }catch(e){}
      try{
        document.querySelectorAll('canvas, .visualizer, .music2026-viz, .music2026-rays, .music2026-blob').forEach(function(el){
          if (!el) return;
          try{ el.remove(); }catch(_e){ try{ el.style.display = 'none'; }catch(_e2){} }
        });
      }catch(e){}
    }, { once: true });
  }catch(e){}
})();
