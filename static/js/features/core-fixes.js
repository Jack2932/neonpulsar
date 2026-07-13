(function(){
  'use strict';
  if (window.__ncStageA1Installed) return;
  window.__ncStageA1Installed = true;

  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

  const MODE = {
    FRIENDS: 'friends',
    DM: 'dm',
    GUILD: 'guild',
    UNKNOWN: 'unknown'
  };

  function els(){
    return {
      body: document.body,
      chatMain: q('.chat-main'),
      channelTitle: q('#current-channel-name'),
      friendsView: q('#friends-view'),
      chatMessages: q('#chat-messages'),
      messageForm: q('#message-form'),
      chatHeaderActions: q('#chat-header-actions'),
      guildBrowseView: q('#guild-browse-view'),
      guildMembersView: q('#guild-members-view'),
      jumpLatest: q('#btn-jump-latest'),
      emojiPop: q('#emoji-pop'),
      emojiButton: q('#btn-emoji-insert'),
      friendsList: q('#friends-page-list'),
      friendsEmpty: q('#friends-page-empty'),
      friendsCount: q('#friends-page-count'),
      friendsPendingPane: q('#friends-pending-pane, #friends-pending-list'),
      friendsSearchInput: q('#friends-page-search, #friends-global-search-input, #friends-search-input')
    };
  }

  function text(el){ return String(el && el.textContent || '').trim(); }
  function isOnlineItem(item){ return String(item?.dataset?.online || '0') === '1'; }

  function activeFriendsTab(){
    return q('#friends-view .friends-tab.is-active[data-friends-tab]')?.dataset?.friendsTab || 'online';
  }

  function getCurrentMode(){
    const e = els();
    const title = text(e.channelTitle);
    const body = e.body;
    const main = e.chatMain;

    const friendsVisible = !!(e.friendsView && !e.friendsView.classList.contains('is-hidden') && e.friendsView.style.display !== 'none');
    const guildVisible = !!(
      (e.guildBrowseView && !e.guildBrowseView.classList.contains('is-hidden') && e.guildBrowseView.style.display !== 'none') ||
      (e.guildMembersView && !e.guildMembersView.classList.contains('is-hidden') && e.guildMembersView.style.display !== 'none')
    );

    if (body?.classList.contains('nc-friends-mode') || main?.classList.contains('friends-mode') || title === 'Друзья' || friendsVisible) {
      return MODE.FRIENDS;
    }
    if ((typeof window.currentChannelType !== 'undefined' && window.currentChannelType === 'dm') || title.startsWith('@')) {
      return MODE.DM;
    }
    if (guildVisible || body?.classList.contains('nc-server-mode')) {
      return MODE.GUILD;
    }
    return MODE.UNKNOWN;
  }

  function setFriendsUiVisible(visible){
    const e = els();
    if (!e.friendsView) return;
    e.friendsView.classList.toggle('is-hidden', !visible);
    e.friendsView.style.display = visible ? '' : 'none';
    e.friendsView.setAttribute('aria-hidden', visible ? 'false' : 'true');
    e.chatMain?.classList.toggle('friends-mode', visible);
    e.body?.classList.toggle('nc-friends-mode', visible);
    if (e.chatMessages) e.chatMessages.style.display = visible ? 'none' : '';
    if (e.messageForm) e.messageForm.style.display = visible ? 'none' : '';
    if (e.chatHeaderActions) e.chatHeaderActions.classList.toggle('is-hidden', visible);
    if (e.jumpLatest) e.jumpLatest.classList.toggle('is-hidden', visible);
  }

  function setGuildUiVisible(visible){
    const e = els();
    [e.guildBrowseView, e.guildMembersView].forEach((node) => {
      if (!node) return;
      node.classList.toggle('is-hidden', !visible);
      node.style.display = visible ? '' : 'none';
      node.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
  }

  function applyMainMode(mode){
    switch (mode) {
      case MODE.FRIENDS:
        setGuildUiVisible(false);
        setFriendsUiVisible(true);
        applyFriendsFilter();
        break;
      case MODE.DM:
        setGuildUiVisible(false);
        setFriendsUiVisible(false);
        break;
      case MODE.GUILD:
        setFriendsUiVisible(false);
        break;
      default:
        break;
    }
  }

  let reconcileTimer = 0;
  function scheduleReconcile(delay){
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => applyMainMode(getCurrentMode()), typeof delay === 'number' ? delay : 0);
  }

  function applyFriendsFilter(){
    const e = els();
    const root = e.friendsView;
    if (!root) return;
    const tab = activeFriendsTab();
    const query = String(e.friendsSearchInput?.value || '').trim().toLowerCase();
    const items = qa('#friends-view .friends-page-item[data-user-id]');
    let visible = 0;

    items.forEach((item) => {
      const name = String(item.dataset.username || '').toLowerCase();
      const online = isOnlineItem(item);
      let show = false;
      if (tab === 'online') show = online;
      else if (tab === 'all') show = true;
      else if (tab === 'pending') show = false;
      if (show && query) show = name.includes(query);
      item.hidden = !show;
      item.style.display = show ? '' : 'none';
      if (show) visible += 1;
    });

    const mainList = q('#friends-page-list');
    if (mainList) mainList.classList.toggle('is-hidden', tab === 'pending');
    if (e.friendsPendingPane) e.friendsPendingPane.classList.toggle('is-hidden', tab !== 'pending');
    if (e.friendsCount) {
      const label = tab === 'online' ? 'В сети' : (tab === 'all' ? 'Все' : 'Ожидание');
      e.friendsCount.textContent = tab === 'pending' ? '' : `${label} — ${visible}`;
    }
    if (e.friendsEmpty) e.friendsEmpty.classList.toggle('is-hidden', tab === 'pending' || visible > 0);
  }

  function positionComposerEmoji(){
    const e = els();
    const pop = e.emojiPop;
    const btn = e.emojiButton;
    if (!pop || !btn) return;
    if (!pop.classList.contains('active')) return;

    const mode = String(pop.dataset.mode || 'insert');
    if (mode !== 'insert') return;

    const btnRect = btn.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 20);
    const maxHeight = Math.min(440, Math.floor(window.innerHeight * 0.58));

    const prev = {
      position: pop.style.position,
      left: pop.style.left,
      top: pop.style.top,
      width: pop.style.width,
      maxHeight: pop.style.maxHeight,
      visibility: pop.style.visibility
    };

    pop.style.visibility = 'hidden';
    pop.style.position = 'fixed';
    pop.style.width = `${width}px`;
    pop.style.maxHeight = `${maxHeight}px`;
    pop.style.left = '0px';
    pop.style.top = '0px';

    const measured = pop.getBoundingClientRect();
    const height = Math.min(Math.ceil(measured.height || 420), maxHeight);

    let left = Math.round(btnRect.right - width);
    left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
    let top = Math.round(btnRect.top - height - 10);
    if (top < 10) top = Math.min(window.innerHeight - height - 10, Math.round(btnRect.bottom + 10));

    pop.classList.add('nc-core-emoji-docked');
    pop.style.position = 'fixed';
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.right = 'auto';
    pop.style.bottom = 'auto';
    pop.style.width = `${width}px`;
    pop.style.maxHeight = `${height}px`;
    pop.style.visibility = '';
    pop.dataset.ncAnchor = 'composer-btn';

    if (!pop.classList.contains('active')) {
      Object.assign(pop.style, prev);
    }
  }

  function bind(){
    document.addEventListener('click', (e) => {
      const tab = e.target?.closest?.('#friends-view .friends-tab[data-friends-tab]');
      if (!tab) return;
      raf(applyFriendsFilter);
      scheduleReconcile(0);
    });

    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('#btn-open-friends-view');
      if (!btn) return;
      setTimeout(() => {
        applyMainMode(MODE.FRIENDS);
        applyFriendsFilter();
      }, 0);
      setTimeout(() => {
        applyMainMode(MODE.FRIENDS);
        applyFriendsFilter();
      }, 120);
    }, true);

    document.addEventListener('click', (e) => {
      const item = e.target?.closest?.('#pane-friends .dm-entry[data-user-id], #friends-view .friends-page-item[data-user-id]');
      if (!item) return;
      [0, 80, 220, 450].forEach((ms) => setTimeout(() => applyMainMode(MODE.DM), ms));
    }, true);

    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('#btn-emoji-insert');
      if (!btn) return;
      [0, 30, 80, 150].forEach((ms) => setTimeout(positionComposerEmoji, ms));
    }, true);

    const titleEl = q('#current-channel-name');
    if (titleEl && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => scheduleReconcile(10)).observe(titleEl, { childList: true, subtree: true, characterData: true });
    }

    const list = q('#friends-page-list');
    if (list && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => raf(applyFriendsFilter)).observe(list, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-online']
      });
    }

    const pop = q('#emoji-pop');
    if (pop && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => setTimeout(positionComposerEmoji, 0)).observe(pop, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-mode', 'aria-hidden']
      });
    }

    window.addEventListener('resize', () => setTimeout(positionComposerEmoji, 0), { passive: true });
    window.addEventListener('load', () => {
      applyFriendsFilter();
      scheduleReconcile(20);
      setTimeout(positionComposerEmoji, 0);
    }, { once: true });

    applyFriendsFilter();
    scheduleReconcile(20);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
