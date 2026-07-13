(function(){
  'use strict';
  if (window.__ncStageBComposerInstalled) return;
  window.__ncStageBComposerInstalled = true;

  const q = (sel, root) => (root || document).querySelector(sel);
  const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

  const state = {
    reply: null,
    jumpTimer: 0,
    replyClearTimer: 0
  };

  function els(){
    return {
      body: document.body,
      messages: q('#chat-messages'),
      form: q('#message-form'),
      input: q('#message-input'),
      jump: q('#btn-jump-latest'),
      uploadPanel: q('#upload-panel'),
      channelTitle: q('#current-channel-name'),
      friendsView: q('#friends-view'),
      chatInput: q('footer.chat-input') || q('.chat-input'),
      send: q('#btn-send')
    };
  }

  function isVisible(node){
    if (!node) return false;
    if (node.hidden) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  }

  function isChatThreadVisible(){
    const e = els();
    if (!isVisible(e.messages) || !isVisible(e.form)) return false;
    if (e.body && e.body.classList.contains('nc-friends-mode')) return false;
    if (e.friendsView && isVisible(e.friendsView) && !e.friendsView.classList.contains('is-hidden')) return false;
    return true;
  }

  function hasOverflow(){
    const c = els().messages;
    if (!c) return false;
    return (c.scrollHeight - c.clientHeight) > 24;
  }

  function isNearBottom(){
    const c = els().messages;
    if (!c) return true;
    const delta = c.scrollHeight - c.scrollTop - c.clientHeight;
    return delta <= 28;
  }

  function updateJumpButton(){
    const e = els();
    if (!e.jump) return;
    const shouldHide = !isChatThreadVisible() || !hasOverflow() || isNearBottom();
    e.jump.classList.toggle('is-hidden', shouldHide);
    e.jump.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
  }

  function scheduleJumpSync(delay){
    clearTimeout(state.jumpTimer);
    state.jumpTimer = setTimeout(() => raf(updateJumpButton), typeof delay === 'number' ? delay : 0);
  }

  function ensureReplyBar(){
    const e = els();
    if (!e.chatInput || !e.form) return null;
    let bar = q('#nc-reply-bar', e.chatInput);
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'nc-reply-bar';
    bar.className = 'nc-replybar is-hidden';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = [
      '<div class="nc-replybar-accent" aria-hidden="true"></div>',
      '<div class="nc-replybar-body">',
      '  <div class="nc-replybar-label">Ответ</div>',
      '  <div class="nc-replybar-meta">',
      '    <span class="nc-replybar-user"></span>',
      '    <span class="nc-replybar-snippet"></span>',
      '  </div>',
      '</div>',
      '<button type="button" class="nc-replybar-close" aria-label="Отменить ответ" title="Отменить ответ">×</button>'
    ].join('');
    e.form.parentNode.insertBefore(bar, e.form);
    const closeBtn = q('.nc-replybar-close', bar);
    if (closeBtn) closeBtn.addEventListener('click', clearReplyState);
    return bar;
  }

  function renderReplyBar(){
    const bar = ensureReplyBar();
    if (!bar) return;
    const e = els();
    if (!state.reply || !isChatThreadVisible()) {
      bar.classList.add('is-hidden');
      bar.setAttribute('aria-hidden', 'true');
      e.form && e.form.classList.remove('nc-has-reply');
      return;
    }
    q('.nc-replybar-user', bar).textContent = state.reply.user || 'Пользователь';
    q('.nc-replybar-snippet', bar).textContent = state.reply.snippet || 'Сообщение';
    bar.classList.remove('is-hidden');
    bar.setAttribute('aria-hidden', 'false');
    e.form && e.form.classList.add('nc-has-reply');
  }

  function clearReplyState(){
    state.reply = null;
    renderReplyBar();
  }

  function setReplyFromRow(row){
    if (!row) return;
    const user = (q('.msg-user', row)?.textContent || '').trim() || 'Пользователь';
    const bubble = q('.msg-bubble', row);
    let snippet = (bubble?.textContent || '').trim().replace(/\s+/g, ' ');
    if (!snippet) snippet = 'Сообщение';
    if (snippet.length > 84) snippet = snippet.slice(0, 84) + '…';
    state.reply = {
      id: String(row.dataset.msgId || row.dataset.msgid || row.dataset.id || ''),
      user,
      snippet
    };
    renderReplyBar();
  }

  function syncComposerState(){
    const e = els();
    if (!e.form || !e.input) return;
    const hasText = !!String(e.input.value || '').trim();
    const hasUpload = !!(e.uploadPanel && !e.uploadPanel.classList.contains('is-hidden') && isVisible(e.uploadPanel));
    e.form.classList.toggle('nc-has-text', hasText);
    e.form.classList.toggle('nc-has-upload', hasUpload);
    e.form.classList.toggle('nc-composer-active', hasText || hasUpload || !!state.reply);
    if (e.send) {
      e.send.disabled = !(hasText || hasUpload) || !!e.input.disabled;
      e.send.setAttribute('aria-hidden', (hasText || hasUpload) ? 'false' : 'true');
      e.send.tabIndex = (hasText || hasUpload) ? 0 : -1;
    }
  }

  function bindInput(){
    const e = els();
    if (!e.input || e.input.dataset.ncStageBComposerBound) return;
    e.input.dataset.ncStageBComposerBound = '1';
    ['input','change','keyup'].forEach((evt) => e.input.addEventListener(evt, syncComposerState, { passive: true }));
    e.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !String(e.input.value || '').trim() && state.reply) {
        ev.preventDefault();
        clearReplyState();
      }
    });
  }

  function bindForm(){
    const e = els();
    if (!e.form || e.form.dataset.ncStageBComposerBound) return;
    e.form.dataset.ncStageBComposerBound = '1';
    e.form.addEventListener('submit', () => {
      syncComposerState();
      clearTimeout(state.replyClearTimer);
      state.replyClearTimer = setTimeout(() => {
        clearReplyState();
        syncComposerState();
        scheduleJumpSync(80);
      }, 260);
    });
  }

  function bindJump(){
    const e = els();
    if (!e.jump || e.jump.dataset.ncStageBJumpBound) return;
    e.jump.dataset.ncStageBJumpBound = '1';
    e.jump.addEventListener('click', (ev) => {
      ev.preventDefault();
      const c = els().messages;
      if (!c) return;
      try{ c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }); }
      catch(_e){ c.scrollTop = c.scrollHeight; }
      scheduleJumpSync(60);
      setTimeout(updateJumpButton, 260);
    });
  }

  function bindReplyCapture(){
    document.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.msg-act[data-act="reply"]') : null;
      if (!btn) return;
      const row = btn.closest('.msg-row[data-msg-id], .msg-row');
      if (!row) return;
      setReplyFromRow(row);
      syncComposerState();
    }, true);

    document.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.msg-act[data-act="edit"], .msg-act[data-act="delete"]') : null;
      if (!btn) return;
      clearReplyState();
      syncComposerState();
    }, true);
  }

  function bindObservers(){
    const e = els();
    if (e.messages && typeof MutationObserver !== 'undefined' && !e.messages.dataset.ncStageBObserved) {
      e.messages.dataset.ncStageBObserved = '1';
      new MutationObserver(() => scheduleJumpSync(20)).observe(e.messages, { childList: true, subtree: true });
      e.messages.addEventListener('scroll', () => scheduleJumpSync(0), { passive: true });
    }
    if (e.uploadPanel && typeof MutationObserver !== 'undefined' && !e.uploadPanel.dataset.ncStageBObserved) {
      e.uploadPanel.dataset.ncStageBObserved = '1';
      new MutationObserver(() => syncComposerState()).observe(e.uploadPanel, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'], childList: true, subtree: true });
    }
    const title = e.channelTitle;
    if (title && typeof MutationObserver !== 'undefined' && !title.dataset.ncStageBObserved) {
      title.dataset.ncStageBObserved = '1';
      new MutationObserver(() => {
        clearReplyState();
        syncComposerState();
        scheduleJumpSync(40);
      }).observe(title, { childList: true, subtree: true, characterData: true });
    }
    window.addEventListener('resize', () => {
      syncComposerState();
      scheduleJumpSync(20);
    }, { passive: true });
  }

  function init(){
    ensureReplyBar();
    bindInput();
    bindForm();
    bindJump();
    bindReplyCapture();
    bindObservers();
    syncComposerState();
    renderReplyBar();
    scheduleJumpSync(80);
    setTimeout(() => { syncComposerState(); scheduleJumpSync(180); }, 240);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
