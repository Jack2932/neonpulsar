(function(){
  'use strict';
  try{
    var ua = navigator.userAgent || '';
    var isYa = /YaBrowser|Yandex|Yowser|YaApp/i.test(ua) || !!window.__NC_YABROWSER;
    if (!isYa) return;

    var version = (document.documentElement.getAttribute('data-asset-version') || '').trim();
    function src(path){ return path + (version ? ('?v=' + encodeURIComponent(version)) : ''); }
    function loadOnce(key, path, cb){
      var flag = '__ncLazyLoaded_' + key;
      if (window[flag]) { if (cb) cb(); return; }
      window[flag] = 'loading';
      var s = document.createElement('script');
      s.src = src(path);
      s.async = false;
      s.onload = function(){ window[flag] = true; if (cb) cb(); };
      s.onerror = function(){ window[flag] = false; };
      document.body.appendChild(s);
    }

    document.addEventListener('click', function(e){
      var t = e.target;
      if (!t || !t.closest) return;
      var emojiBtn = t.closest('#btn-emoji-insert, .emoji-insert-btn, #btn-gif, .nc-gif-btn, #btn-stickers');
      if (emojiBtn && !window.__ncLazyLoaded_emoji){
        e.preventDefault();
        e.stopPropagation();
        loadOnce('emoji', '/static/js/features/emoji.js', function(){ setTimeout(function(){ try{ emojiBtn.click(); }catch(_e){} }, 0); });
        return;
      }
      var callBtn = t.closest('#btn-call, #btn-video-call, #btn-start-call, #btn-open-group-call, [data-open-call], [data-action="call"], .call-launch-btn');
      if (callBtn && !window.__ncLazyLoaded_calls){
        e.preventDefault();
        e.stopPropagation();
        loadOnce('calls', '/static/js/features/calls.js', function(){ setTimeout(function(){ try{ callBtn.click(); }catch(_e){} }, 0); });
      }
    }, true);
  }catch(e){}
})();
