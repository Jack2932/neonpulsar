/* NeonChat: Socket.IO client loader
 *
 * Why: Flask-SocketIO endpoints occupy /socket.io/* and will return 400 for
 * /socket.io/socket.io.js. We therefore load the official client bundle from
 * public CDNs and expose a single promise that main.js can await.
 */
(function () {
  try {
    if (window.__nc_socketio_ready_promise) return;

    var urls = [
      "https://cdn.socket.io/4.7.5/socket.io.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.min.js",
      "https://unpkg.com/socket.io-client@4.7.5/dist/socket.io.min.js",
      "https://cdn.jsdelivr.net/npm/socket.io-client@4.7.5/dist/socket.io.min.js"
    ];

    function loadScript(src) {
      return new Promise(function (resolve, reject) {
        try {
          var s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.onload = function () { resolve(true); };
          s.onerror = function () { reject(new Error('load failed: ' + src)); };
          document.head.appendChild(s);
        } catch (e) { reject(e); }
      });
    }

    window.__nc_socketio_ready_promise = (async function () {
      if (typeof io !== 'undefined') return true;

      for (var i = 0; i < urls.length; i++) {
        try {
          await loadScript(urls[i]);
          if (typeof io !== 'undefined') return true;
        } catch (e) {
          // ignore and try next
        }
      }

      return false;
    })();

  } catch (e) {
    // Ensure promise exists even on unexpected errors
    try {
      window.__nc_socketio_ready_promise = Promise.resolve(false);
    } catch (_e) {}
  }
})();
