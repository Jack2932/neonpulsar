(function(){
  'use strict';
  if (window.__ncStateGuardianInstalled) return;
  window.__ncStateGuardianInstalled = true;

  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const raf = (fn) => (window.requestAnimationFrame ? requestAnimationFrame(fn) : setTimeout(fn, 16));

  function isVisible(el){
    if (!el || el.hidden) return false;
    const cs = window.getComputedStyle ? getComputedStyle(el) : null;
    if (!cs) return true;
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.01;
  }

  function text(el){ return String((el && el.textContent) || '').trim(); }

  function els(){
    return {
      body: document.body,
      chatMain: q('.chat-main'),
      friendsView: q('#friends-view'),
      chatMessages: q('#chat-messages'),
      messageForm: q('#message-form'),
      channelTitle: q('#current-channel-name'),
      dmHomeNav: q('.dm-home-nav'),
      sidebarSearch: q('.sidebar-search'),
      jumpLatest: q('#btn-jump-latest'),
      emojiPop: q('#emoji-pop'),
      emojiButton: q('#btn-emoji-insert')
    };
  }

  function detectMode(){
    const e = els();
    const title = text(e.channelTitle);
    const activeDm = q('#pane-friends .dm-entry.active, #pane-friends .friend-item.active');
    const hasMessages = !!(e.chatMessages && e.chatMessages.children && e.chatMessages.children.length);
    if ((e.body && e.body.classList.contains('nc-server-mode')) && title && !title.startsWith('@')) return 'guild';
    if (title === 'Друзья' || (e.friendsView && isVisible(e.friendsView) && !hasMessages && !activeDm)) return 'friends';
    if (title.startsWith('@') || activeDm || (hasMessages && !isVisible(e.friendsView))) return 'dm';
    if (e.friendsView && isVisible(e.friendsView)) return 'friends';
    return 'unknown';
  }

  function applyMode(mode){
    const e = els();
    const body = e.body;
    if (!body) return;
    body.classList.remove('nc-ui-mode-friends','nc-ui-mode-dm','nc-ui-mode-guild');
    if (mode === 'friends') body.classList.add('nc-ui-mode-friends');
    else if (mode === 'guild') body.classList.add('nc-ui-mode-guild');
    else if (mode === 'dm') body.classList.add('nc-ui-mode-dm');

    if (e.dmHomeNav) e.dmHomeNav.style.display = mode === 'guild' ? 'none' : '';
    if (e.sidebarSearch) e.sidebarSearch.style.display = mode === 'guild' ? 'none' : '';

    if (mode === 'friends' && e.friendsView) {
      e.friendsView.hidden = false;
      e.friendsView.style.display = '';
      e.friendsView.setAttribute('aria-hidden', 'false');
    }

    if ((mode === 'dm' || mode === 'guild') && e.friendsView) {
      e.friendsView.hidden = true;
      e.friendsView.style.display = 'none';
      e.friendsView.setAttribute('aria-hidden', 'true');
    }

    if (e.jumpLatest && (mode === 'friends' || !e.chatMessages || !isVisible(e.chatMessages))) {
      e.jumpLatest.classList.add('is-hidden');
    }
  }

  function syncJumpButton(){
    const e = els();
    if (!e.chatMessages || !e.jumpLatest || document.body.classList.contains('nc-ui-mode-friends')) return;
    const box = e.chatMessages;
    const nearBottom = (box.scrollHeight - box.clientHeight - box.scrollTop) <= 48;
    const overflow = (box.scrollHeight - box.clientHeight) > 32;
    e.jumpLatest.classList.toggle('is-hidden', nearBottom || !overflow);
  }

  function anchorEmoji(){
    const e = els();
    if (!e.emojiPop || !e.emojiButton || !isVisible(e.emojiPop)) return;
    const mobile = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    if (mobile) {
      e.emojiPop.classList.add('nc-emoji-sheet-guarded');
      e.emojiPop.style.position = 'fixed';
      e.emojiPop.style.left = '10px';
      e.emojiPop.style.right = '10px';
      e.emojiPop.style.top = 'auto';
      e.emojiPop.style.bottom = 'calc(76px + var(--nc-kb, 0px))';
      e.emojiPop.style.width = 'auto';
      return;
    }
    const rect = e.emojiButton.getBoundingClientRect();
    const popRect = e.emojiPop.getBoundingClientRect();
    const width = Math.min(360, Math.max(280, popRect.width || 320));
    const height = Math.min(440, Math.max(280, popRect.height || 380));
    let left = Math.round(rect.right - width);
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    let top = Math.round(rect.top - height - 12);
    if (top < 12) top = Math.min(window.innerHeight - height - 12, Math.round(rect.bottom + 12));
    Object.assign(e.emojiPop.style, {
      position: 'fixed',
      left: left + 'px',
      top: top + 'px',
      right: 'auto',
      bottom: 'auto',
      width: width + 'px',
      maxHeight: height + 'px'
    });
  }

  function pass(){
    applyMode(detectMode());
    syncJumpButton();
    anchorEmoji();
  }

  function schedule(){ raf(pass); }

  function bind(){
    document.addEventListener('click', function(ev){
      const t = ev.target instanceof Element ? ev.target : null;
      if (!t) return;
      if (t.closest('#btn-open-friends-view, #friends-view .friends-tab, #pane-friends .dm-entry, #pane-friends .friend-item, #friends-view .friends-page-item, #btn-emoji-insert, #btn-jump-latest, .message-action, .message-actions')) {
        [0, 40, 120, 260, 600].forEach(ms => setTimeout(schedule, ms));
      }
    }, true);

    document.addEventListener('input', function(ev){
      const t = ev.target instanceof Element ? ev.target : null;
      if (t && t.closest('#friends-page-search, #friends-global-search-input, #friends-search-input, #message-input, textarea')) schedule();
    }, true);

    const title = q('#current-channel-name');
    if (title && window.MutationObserver) {
      new MutationObserver(schedule).observe(title, { childList:true, subtree:true, characterData:true });
    }
    const friendsView = q('#friends-view');
    if (friendsView && window.MutationObserver) {
      new MutationObserver(schedule).observe(friendsView, { childList:true, subtree:true, attributes:true, attributeFilter:['class','style','hidden','aria-hidden'] });
    }
    const messages = q('#chat-messages');
    if (messages) {
      messages.addEventListener('scroll', function(){ raf(syncJumpButton); }, { passive:true });
      if (window.MutationObserver) new MutationObserver(schedule).observe(messages, { childList:true, subtree:true });
    }
    window.addEventListener('resize', schedule, { passive:true });
    window.addEventListener('orientationchange', schedule, { passive:true });
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('focus', schedule);
  }

  function init(){
    bind();
    [0, 80, 220, 500, 900, 1500, 2400].forEach(ms => setTimeout(schedule, ms));
    window.__ncStateGuardianSync = schedule;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
