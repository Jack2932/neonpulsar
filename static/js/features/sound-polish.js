(function(){
  'use strict';
  if (window.__ncStageC2SoundInstalled) return;
  window.__ncStageC2SoundInstalled = true;

  let ctx = null;
  let lastPlay = 0;
  let armed = false;

  const CLICK_SELECTORS = [
    '.icon-btn', '.btn-primary', '.msg-act', '.jump-latest', '.dm-home-nav',
    '.sidebar-search', '.friends-tab', '.channel-item', '.friend-item',
    '.dm-entry', '.friends-page-item', '.nc-ico-btn', '.call-icon-btn',
    '.vctl', '.composer-attach', '.btn-send', '.guild-invite-btn'
  ].join(',');

  function now(){
    return (window.performance && typeof performance.now === 'function') ? performance.now() : Date.now();
  }

  function ensureCtx(){
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try{
      ctx = new AC();
      document.documentElement.classList.add('nc-audio-armed');
    }catch(_e){
      ctx = null;
    }
    return ctx;
  }

  function arm(){
    armed = true;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') {
      try{ c.resume(); }catch(_e){}
    }
  }

  function playTone(cfg){
    const c = ensureCtx();
    if (!armed || !c) return;
    const ts = now();
    if (ts - lastPlay < 42) return;
    lastPlay = ts;
    try{
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cfg.filter || 2200;
      osc.type = cfg.type || 'triangle';
      osc.frequency.setValueAtTime(cfg.from, t0);
      osc.frequency.exponentialRampToValueAtTime(cfg.to, t0 + cfg.dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(cfg.gain, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + cfg.dur);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + cfg.dur + 0.02);
    }catch(_e){}
  }

  function play(kind){
    const palette = {
      soft:    { from: 760, to: 520, dur: 0.05, gain: 0.012, type: 'triangle', filter: 1800 },
      primary: { from: 940, to: 650, dur: 0.06, gain: 0.017, type: 'sine',     filter: 2400 },
      danger:  { from: 520, to: 310, dur: 0.07, gain: 0.013, type: 'triangle', filter: 1500 },
      bright:  { from: 1200,to: 860, dur: 0.05, gain: 0.015, type: 'sine',     filter: 2600 }
    };
    playTone(palette[kind] || palette.soft);
  }

  function classify(el){
    if (!el) return 'soft';
    if (el.matches('.danger, .msg-act[data-act="delete"], #vctl-leave, #voice-mini-leave, #dm-call-mini-leave')) return 'danger';
    if (el.matches('.btn-primary, #btn-send, .jump-latest')) return 'primary';
    if (el.matches('.msg-act[data-act="reply"], .msg-act[data-act="edit"], #btn-emoji-insert, #btn-gif, #btn-stickers')) return 'bright';
    return 'soft';
  }

  function bindArming(){
    const once = function(){ arm(); cleanup(); };
    const cleanup = function(){
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('keydown', once, true);
      window.removeEventListener('focus', once, true);
    };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('keydown', once, true);
    window.addEventListener('focus', once, true);
  }

  function bindClicks(){
    document.addEventListener('pointerdown', function(ev){
      const el = ev.target && ev.target.closest ? ev.target.closest(CLICK_SELECTORS) : null;
      if (!el) return;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      play(classify(el));
      try{
        el.classList.add('nc-press-pulse');
        setTimeout(function(){ el.classList.remove('nc-press-pulse'); }, 180);
      }catch(_e){}
    }, true);
  }

  window.__ncPlayUiTick = play;
  bindArming();
  bindClicks();
})();
