(function(){
  'use strict';
  if (window.__ncStageF1Installed) return;
  window.__ncStageF1Installed = true;

  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

  function isVisible(el){
    if (!el || el.hidden) return false;
    const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (!cs) return true;
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.01;
  }

  function text(el){ return String(el && el.textContent || '').trim(); }

  function els(){
    return {
      body: document.body,
      chatMain: q('.chat-main'),
      channelTitle: q('#current-channel-name'),
      friendsView: q('#friends-view'),
      chatMessages: q('#chat-messages'),
      messageForm: q('#message-form'),
      chatHeaderActions: q('#chat-header-actions'),
      jumpLatest: q('#btn-jump-latest'),
      emojiPop: q('#emoji-pop'),
      emojiButton: q('#btn-emoji-insert'),
      friendsCount: q('#friends-page-count'),
      friendsEmpty: q('#friends-page-empty'),
      friendsPendingPane: q('#friends-pending-pane, #friends-pending-list'),
      friendsSearchInput: q('#friends-page-search, #friends-global-search-input, #friends-search-input'),
      dmHomeNav: q('.dm-home-nav'),
      sidebarSearch: q('.sidebar-search')
    };
  }

  function activeFriendTab(){
    return q('#friends-view .friends-tab.is-active[data-friends-tab]')?.dataset?.friendsTab || 'online';
  }

  function onlineOf(item){
    const ds = item && item.dataset ? item.dataset : {};
    return String(ds.online || ds.isOnline || '0') === '1';
  }

  function currentMode(){
    const e = els();
    const title = text(e.channelTitle);
    if ((e.body && e.body.classList.contains('nc-friends-mode')) || (e.chatMain && e.chatMain.classList.contains('friends-mode')) || isVisible(e.friendsView) || title === 'Друзья') return 'friends';
    if ((typeof window.currentChannelType !== 'undefined' && window.currentChannelType === 'dm') || title.startsWith('@') || q('#pane-friends .dm-entry.active, #pane-friends .friend-item.active')) return 'dm';
    if (e.body && e.body.classList.contains('nc-server-mode')) return 'guild';
    return 'unknown';
  }

  function setFriendsVisible(visible){
    const e = els();
    if (!e.friendsView) return;
    e.friendsView.classList.toggle('is-hidden', !visible);
    e.friendsView.style.display = visible ? '' : 'none';
    e.friendsView.hidden = !visible;
    e.friendsView.setAttribute('aria-hidden', visible ? 'false' : 'true');
    e.chatMain && e.chatMain.classList.toggle('friends-mode', visible);
    e.body && e.body.classList.toggle('nc-friends-mode', visible);
    if (e.chatMessages) e.chatMessages.style.display = visible ? 'none' : '';
    if (e.messageForm) e.messageForm.style.display = visible ? 'none' : '';
    if (e.chatHeaderActions) e.chatHeaderActions.classList.toggle('is-hidden', visible);
    if (e.jumpLatest) e.jumpLatest.classList.toggle('is-hidden', visible);
  }

  function syncCenter(){
    const mode = currentMode();
    if (mode === 'friends') {
      setFriendsVisible(true);
    } else if (mode === 'dm' || mode === 'guild') {
      setFriendsVisible(false);
    }
    const e = els();
    const inServer = !!(e.body && e.body.classList.contains('nc-server-mode'));
    if (e.dmHomeNav) e.dmHomeNav.style.display = inServer ? 'none' : '';
    if (e.sidebarSearch) e.sidebarSearch.style.display = inServer ? 'none' : '';
  }

  function applyFriendsFilter(){
    const e = els();
    const root = e.friendsView;
    if (!root) return;
    const items = qa('#friends-view .friends-page-item[data-user-id]');
    if (!items.length) return;
    const tab = activeFriendTab();
    const query = String(e.friendsSearchInput && e.friendsSearchInput.value || '').trim().toLowerCase();
    let visibleCount = 0;

    items.forEach((item) => {
      const name = String(item.dataset.username || text(item.querySelector('.friend-name')) || '').toLowerCase();
      const online = onlineOf(item);
      let show = true;
      if (tab === 'online') show = online;
      else if (tab === 'pending') show = false;
      if (show && query) show = name.includes(query);
      item.hidden = !show;
      item.style.display = show ? '' : 'none';
      if (show) visibleCount += 1;
    });

    const mainList = q('#friends-page-list');
    if (mainList) mainList.classList.toggle('is-hidden', tab === 'pending');
    if (e.friendsPendingPane) e.friendsPendingPane.classList.toggle('is-hidden', tab !== 'pending');
    if (e.friendsCount) {
      const label = tab === 'online' ? 'В сети' : (tab === 'all' ? 'Все' : 'Ожидание');
      e.friendsCount.textContent = tab === 'pending' ? '' : (label + ' — ' + visibleCount);
    }
    if (e.friendsEmpty) e.friendsEmpty.classList.toggle('is-hidden', tab === 'pending' || visibleCount > 0);
  }

  function syncJumpButton(){
    const e = els();
    const btn = e.jumpLatest;
    const box = e.chatMessages;
    if (!btn || !box || !isVisible(box)) return;
    const overflow = (box.scrollHeight - box.clientHeight) > 24;
    const nearBottom = (box.scrollHeight - box.clientHeight - box.scrollTop) <= 40;
    const shouldShow = overflow && !nearBottom && !document.body.classList.contains('nc-friends-mode');
    btn.classList.toggle('is-hidden', !shouldShow);
  }

  function anchorEmoji(){
    const e = els();
    const pop = e.emojiPop;
    const btn = e.emojiButton;
    if (!pop || !btn || !isVisible(pop)) return;
    const mobile = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    if (mobile) {
      pop.classList.add('nc-final-emoji-mobile');
      pop.classList.remove('nc-final-emoji-anchored');
      pop.style.left = '8px';
      pop.style.right = '8px';
      pop.style.width = 'auto';
      pop.style.maxWidth = 'none';
      pop.style.top = 'auto';
      pop.style.bottom = 'calc(74px + var(--nc-kb, 0px))';
      pop.style.position = 'fixed';
      return;
    }
    const rect = btn.getBoundingClientRect();
    const width = Math.min(360, Math.max(280, window.innerWidth - 20));
    const height = Math.min(440, Math.max(280, pop.getBoundingClientRect().height || 380));
    let left = Math.round(rect.right - width);
    left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
    let top = Math.round(rect.top - height - 10);
    if (top < 10) top = Math.min(window.innerHeight - height - 10, Math.round(rect.bottom + 10));
    pop.classList.add('nc-final-emoji-anchored');
    pop.classList.remove('nc-final-emoji-mobile');
    pop.style.position = 'fixed';
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.right = 'auto';
    pop.style.bottom = 'auto';
    pop.style.width = width + 'px';
    pop.style.maxHeight = height + 'px';
  }

  function schedulePasses(){
    [0, 60, 180, 420, 900].forEach((ms) => setTimeout(() => {
      syncCenter();
      applyFriendsFilter();
      syncJumpButton();
      anchorEmoji();
    }, ms));
  }

  function bind(){
    document.addEventListener('click', (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      if (target.closest('#btn-open-friends-view, #friends-view .friends-tab, #pane-friends .dm-entry, #pane-friends .friend-item, #friends-view .friends-page-item, #btn-emoji-insert, #btn-jump-latest')) {
        schedulePasses();
      }
    }, true);

    document.addEventListener('input', (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (target && target.closest('#friends-page-search, #friends-global-search-input, #friends-search-input')) {
        raf(applyFriendsFilter);
      }
    }, true);

    const titleEl = q('#current-channel-name');
    if (titleEl && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => schedulePasses()).observe(titleEl, { childList:true, subtree:true, characterData:true });
    }
    const chatMessages = q('#chat-messages');
    if (chatMessages) {
      chatMessages.addEventListener('scroll', () => raf(syncJumpButton), { passive:true });
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => schedulePasses()).observe(chatMessages, { childList:true, subtree:true });
      }
    }
    const friendsView = q('#friends-view');
    if (friendsView && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => {
        applyFriendsFilter();
        syncCenter();
      }).observe(friendsView, { attributes:true, attributeFilter:['class','style','hidden','aria-hidden'], childList:true, subtree:true });
    }

    window.addEventListener('resize', () => {
      raf(syncJumpButton);
      raf(anchorEmoji);
      raf(syncCenter);
    }, { passive:true });
  }

  function init(){
    bind();
    schedulePasses();
    window.__ncFinalSync = schedulePasses;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
