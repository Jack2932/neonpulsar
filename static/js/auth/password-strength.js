/* Semantic script */

/* Password UX meter (UX only)
   Mirrors backend rules: only length matters (8..24, any chars). */
(function(){
  'use strict';

  function setBar(barEl, level){
    barEl.classList.remove('lvl-0','lvl-1','lvl-2','lvl-3');
    barEl.classList.add('lvl-' + level);
    const widths = [10, 35, 65, 100];
    barEl.style.width = widths[level] + '%';
  }

  function attachMeter(meter){
    const pwId = meter.getAttribute('data-password');
    const pw = pwId ? document.getElementById(pwId) : null;
    const bar = meter.querySelector('.pw-meter-bar');
    const text = meter.querySelector('.pw-meter-text');
    const list = meter.querySelector('.pw-meter-list');
    if(!pw || !bar || !text || !list) return;

    function render(){
      const v = pw.value || '';
      if(!v.length){
        setBar(bar, 0);
        text.textContent = 'Введи пароль';
        list.innerHTML = '';
        return;
      }

      const issues = [];
      if(v.length < 8 || v.length > 24) issues.push('Длина 8–24 символа.');

      let lvl = 0;
      // Simple meter by length only
      if(v.length >= 8 && v.length <= 10) lvl = 1;
      else if(v.length <= 15) lvl = 2;
      else if(v.length <= 24) lvl = 3;
      else lvl = 0;

      setBar(bar, lvl);
      const names = ['Слабый', 'Нормальный', 'Хороший', 'Сильный'];
      text.textContent = issues.length ? (names[lvl] + ' (есть замечания)') : (names[lvl] + ' (OK)');

      if(issues.length){
        list.innerHTML = issues.map(i => '<li>' + String(i).replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</li>').join('');
      } else {
        list.innerHTML = '<li>Пароль проходит проверку.</li>';
      }
    }

    pw.addEventListener('input', render);
    render();
  }

  function init(){
    document.querySelectorAll('[data-pw-meter]').forEach(attachMeter);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
