(function(){
  'use strict';
  if (window.__ncJumpButtonFixInstalled) return;
  window.__ncJumpButtonFixInstalled = true;

  const q = (sel, root) => (root || document).querySelector(sel);
  const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

  function els(){
    return {
      btn: q('#btn-jump-latest'),
      messages: q('#chat-messages'),
      friendsView: q('#friends-view'),
      form: q('#message-form')
    };
  }

  function isVisible(node){
    if (!node) return false;
    if (node.hidden) return false;
    const st = window.getComputedStyle ? getComputedStyle(node) : null;
    if (st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0')) return false;
    return true;
  }

  function isFriendsMode(){
    const e = els();
    if (document.body.classList.contains('nc-friends-mode')) return true;
    if (e.friendsView && isVisible(e.friendsView) && !e.friendsView.classList.contains('is-hidden')) return true;
    const title = String((q('#current-channel-name')?.textContent || '')).trim();
    return title === 'Друзья';
  }

  function shouldHide(){
    const e = els();
    if (!e.btn || !e.messages) return true;
    if (!isVisible(e.messages) || !isVisible(e.form)) return true;
    if (isFriendsMode()) return true;
    const noOverflow = e.messages.scrollHeight <= (e.messages.clientHeight + 8);
    if (noOverflow) return true;
    const gap = Math.max(0, e.messages.scrollHeight - e.messages.scrollTop - e.messages.clientHeight);
    return gap <= 96;
  }

  let timer = 0;
  function apply(){
    const e = els();
    if (!e.btn) return;
    const hide = shouldHide();
    e.btn.classList.toggle('is-hidden', hide);
    e.btn.setAttribute('aria-hidden', hide ? 'true' : 'false');
    e.btn.style.pointerEvents = hide ? 'none' : '';
  }
  function schedule(delay){
    clearTimeout(timer);
    timer = setTimeout(() => raf(apply), typeof delay === 'number' ? delay : 0);
  }

  function bind(){
    const e = els();
    if (!e.btn || e.btn.__ncJumpFixBound) return;
    e.btn.__ncJumpFixBound = true;
    try{ e.messages && e.messages.addEventListener('scroll', () => schedule(0), { passive:true }); }catch(e){}
    try{ window.addEventListener('resize', () => schedule(0), { passive:true }); }catch(e){}
    try{ window.visualViewport && window.visualViewport.addEventListener('resize', () => schedule(0), { passive:true }); }catch(e){}
    try{ document.addEventListener('click', () => schedule(40), true); }catch(e){}
    try{ document.addEventListener('input', () => schedule(40), true); }catch(e){}

    try{
      const mo = new MutationObserver(() => schedule(40));
      if (e.messages) mo.observe(e.messages, { childList:true, subtree:true, attributes:true, attributeFilter:['class','style'] });
      if (e.form) mo.observe(e.form, { childList:true, subtree:true, attributes:true, attributeFilter:['class','style'] });
      if (e.friendsView) mo.observe(e.friendsView, { attributes:true, attributeFilter:['class','style','hidden'] });
      mo.observe(document.body, { attributes:true, attributeFilter:['class'] });
    }catch(e){}

    schedule(0);
    schedule(120);
    schedule(320);
    schedule(700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once:true });
  } else {
    bind();
  }
})();
