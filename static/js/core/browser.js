/* Semantic script */

(function(){
  try{
    var ua = navigator.userAgent || '';
    var isYa = /YaBrowser/i.test(ua);
    if (isYa) {
      document.documentElement.classList.add('is-yabrowser');
      // Back-compat with older CSS selectors
      document.documentElement.classList.add('yabrowser');
      window.__NC_YABROWSER = true;
    } else {
      window.__NC_YABROWSER = false;
    }
  }catch(e){}
})();
