/* Semantic script */

// Universal password preview toggle + screenshare privacy lock
(function(){
  function wrapInput(inp){
    try{
      if (!inp || inp.dataset.ncPwWrapped === '1') return;
      // Skip if explicitly disabled
      if (inp.dataset && inp.dataset.ncPwNoToggle === '1') return;

      const wrap = document.createElement('div');
      wrap.className = 'pw-wrap';
      // Keep existing layout: clone computed display? We'll keep block-level.
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-eye';
      btn.setAttribute('aria-label','Показать пароль');
      // Avoid browser tooltips that can look like the button "moves" out of the input.
      // We keep aria-label for accessibility but remove any title attribute entirely.
      try{ btn.removeAttribute('title'); }catch(e){}
      // Ensure it stays completely static (some global scripts add motion classes)
      try{ btn.classList.remove('btn-ripple','btn-pop'); }catch(e){}
      btn.innerHTML = '👁';
      wrap.appendChild(btn);

      inp.dataset.ncPwWrapped = '1';
      inp.classList.add('nc-pw-input');

      const setShown = (shown) => {
        try{
          if (shown) {
            inp.type = 'text';
            inp.dataset.ncPwShown = '1';
            btn.innerHTML = '🙈';
            btn.setAttribute('aria-label','Скрыть пароль');
            try{ btn.removeAttribute('title'); }catch(e){}
          } else {
            inp.type = 'password';
            inp.dataset.ncPwShown = '0';
            btn.innerHTML = '👁';
            btn.setAttribute('aria-label','Показать пароль');
            try{ btn.removeAttribute('title'); }catch(e){}
          }
        }catch(e){}
      };

      btn.addEventListener('click', () => {
        try{
          // Screenshare privacy lock
          if (document.documentElement.classList.contains('nc-lock-password')) {
            setShown(false);
            return;
          }
          const shown = inp.type === 'text' || inp.dataset.ncPwShown === '1';
          setShown(!shown);
        }catch(e){}
      });

      // Default hidden
      inp.dataset.ncPwShown = '0';

      // Expose helpers
      inp.__ncPwSetShown = setShown;
      wrap.__ncPwBtn = btn;

    }catch(e){}
  }

  function scan(){
    try{
      const inputs = document.querySelectorAll('input[type="password"]');
      inputs.forEach(wrapInput);
    }catch(e){}
  }

  function applyLockState(){
    try{
      const locked = document.documentElement.classList.contains('nc-lock-password');
      const wraps = document.querySelectorAll('.pw-wrap');
      wraps.forEach(w => {
        try{
          const inp = w.querySelector('input');
          const btn = w.querySelector('button.pw-eye');
          if (inp && inp.__ncPwSetShown) inp.__ncPwSetShown(false);
          if (btn) {
            btn.disabled = !!locked;
            btn.classList.toggle('is-disabled', !!locked);
          }
        }catch(e){}
      });
    }catch(e){}
  }

  // Public API for main.js
  try{
    window.__ncSetPasswordLock = function(on){
      try{
        document.documentElement.classList.toggle('nc-lock-password', !!on);
      }catch(e){}
      try{ applyLockState(); }catch(e){}
    };
  }catch(e){}

  // Observe DOM for new password inputs and lock state changes
  function boot(){
    scan();
    applyLockState();

    try{
      const obs = new MutationObserver((muts) => {
        let needScan = false;
        let needLock = false;
        for (const m of muts){
          if (m.type === 'childList') needScan = true;
          if (m.type === 'attributes' && m.attributeName === 'class') needLock = true;
        }
        if (needScan) scan();
        if (needLock) applyLockState();
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    }catch(e){}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
