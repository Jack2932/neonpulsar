/* Semantic script */

(function(){
  function settingsOpen(){
    const ov = document.getElementById('nc-settings-overlay');
    return !!(ov && !ov.classList.contains('is-hidden'));
  }
  function accountPage(){
    return document.querySelector('#nc-settings-overlay .nc-settings-page[data-page="account"].is-active');
  }
  function visible(el){
    if (!el || el.disabled) return false;
    const r = el.getBoundingClientRect();
    return !!(r.width > 0 && r.height > 0);
  }
  function inRect(x, y, r){
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  function getAccountCandidates(){
    const page = accountPage();
    if (!page) return [];
    const ids = [
      'nc-edit-profile',
      'nc-btn-edit-displayname',
      'nc-btn-edit-username',
      'nc-btn-edit-email',
      'nc-btn-edit-phone',
      'nc-btn-change-password',
      'nc-btn-recover-password',
      'nc-btn-enable-auth-app',
      'nc-btn-register-security-key',
      'nc-btn-reveal-security-keys',
      'nc-btn-recovery-redownload',
      'nc-btn-recovery-regenerate',
      'nc-btn-disable-account',
      'nc-btn-delete-account'
    ];
    const out = [];
    ids.forEach((id)=>{
      const el = document.getElementById(id);
      if (page.contains(el) && visible(el)) out.push(el);
    });
    page.querySelectorAll('.nc-settings-tab').forEach((el)=>{ if (visible(el)) out.push(el); });
    return out;
  }
  function safeProgrammaticClick(el){
    if (!el) return;
    try{ el.focus && el.focus({preventScroll:true}); }catch(e){}
    if (el.id === 'nc-edit-profile' && typeof window.__ncOpenEditProfileModal === 'function'){
      try{ window.__ncOpenEditProfileModal(); return; }catch(e){}
    }
    try{ el.click(); }catch(e){
      try{ el.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window })); }catch(_){}
    }
  }

  document.addEventListener('pointerdown', function(e){
    if (!settingsOpen()) return;
    const page = accountPage();
    if (!page) return;
    const target = e.target;
    if (!target) return;
    if (target.closest('.nc-mini-modal,.nc-bill-action-modal,.modal,.context-menu,.emoji-picker')) return;
    const x = e.clientX, y = e.clientY;
    const hit = getAccountCandidates().find((el)=> inRect(x, y, el.getBoundingClientRect()));
    if (!hit) return;
    if (target === hit || (target.closest && hit.id && target.closest('#' + CSS.escape(hit.id)))) return;
    if (target.closest && target.closest('.nc-settings-tab') === hit) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    setTimeout(function(){ safeProgrammaticClick(hit); }, 0);
  }, true);

  // Extra safety: make native buttons always executable even if another script replaced them.
  window.addEventListener('load', function(){
    const edit = document.getElementById('nc-edit-profile');
    if (edit && !edit.dataset.ncAccFixBound){
      edit.dataset.ncAccFixBound = '1';
      edit.addEventListener('keydown', function(ev){
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          safeProgrammaticClick(edit);
        }
      });
    }
  });
})();


(function(){
  const IDS = [
    'nc-account-modal',
    'nc-password-modal',
    'nc-2fa-modal',
    'nc-2fa-disable-modal',
    'nc-disable-modal',
    'nc-delete-modal',
    'nc-info-modal'
  ];

  function getModals(){
    return IDS.map(id => document.getElementById(id)).filter(Boolean);
  }

  function ensurePortal(){
    const body = document.body;
    if (!body) return;
    getModals().forEach((modal)=>{
      if (modal.parentElement !== body) body.appendChild(modal);
    });
  }

  function syncBodyState(){
    const anyOpen = getModals().some((m)=> !m.classList.contains('is-hidden'));
    document.body.classList.toggle('nc-account-mini-open', anyOpen);
  }

  function bindModalState(){
    getModals().forEach((modal)=>{
      if (modal.dataset.ncPortalBound === '1') return;
      modal.dataset.ncPortalBound = '1';
      const observer = new MutationObserver(syncBodyState);
      observer.observe(modal, { attributes:true, attributeFilter:['class'] });
      modal.addEventListener('click', function(e){
        // make absolutely sure the modal itself receives the click, not the settings panel below it
        e.stopPropagation();
      }, true);
    });
  }

  function safeClick(el){
    if (!el) return;
    try { el.focus && el.focus({preventScroll:true}); } catch(e){}
    try { el.click(); return; } catch(e){}
    try { el.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window })); } catch(e){}
  }

  function bindDirectButtons(){
    const map = {
      'nc-edit-profile': function(){
        if (typeof window.__ncOpenEditProfileModal === 'function') {
          try { window.__ncOpenEditProfileModal(); return; } catch(e){}
        }
        safeClick(document.getElementById('nc-edit-profile'));
      },
      'nc-btn-change-password': function(){ safeClick(document.getElementById('nc-btn-change-password')); },
      'nc-btn-recover-password': function(){ safeClick(document.getElementById('nc-btn-recover-password')); },
      'nc-btn-enable-auth-app': function(){
        if (typeof window.nc2faToggle === 'function') {
          try { window.nc2faToggle(); return; } catch(e){}
        }
        safeClick(document.getElementById('nc-btn-enable-auth-app'));
      },
      'nc-btn-register-security-key': function(){ safeClick(document.getElementById('nc-btn-register-security-key')); },
      'nc-btn-edit-displayname': function(){ safeClick(document.getElementById('nc-btn-edit-displayname')); },
      'nc-btn-edit-username': function(){ safeClick(document.getElementById('nc-btn-edit-username')); },
      'nc-btn-edit-email': function(){ safeClick(document.getElementById('nc-btn-edit-email')); },
      'nc-btn-edit-phone': function(){ safeClick(document.getElementById('nc-btn-edit-phone')); },
      'nc-btn-disable-account': function(){ safeClick(document.getElementById('nc-btn-disable-account')); },
      'nc-btn-delete-account': function(){ safeClick(document.getElementById('nc-btn-delete-account')); }
    };

    Object.keys(map).forEach((id)=>{
      const el = document.getElementById(id);
      if (!el || el.dataset.ncDirectBound === '1') return;
      el.dataset.ncDirectBound = '1';
      // only assist pointer events if the normal click path is blocked by overlay/layout issues
      el.addEventListener('pointerup', function(ev){
        if (ev.button !== 0) return;
        ev.stopPropagation();
      }, true);
    });

    document.addEventListener('pointerdown', function(e){
      const hit = e.target && e.target.closest && e.target.closest(
        '#nc-edit-profile,#nc-btn-change-password,#nc-btn-recover-password,#nc-btn-enable-auth-app,#nc-btn-register-security-key,#nc-btn-edit-displayname,#nc-btn-edit-username,#nc-btn-edit-email,#nc-btn-edit-phone,#nc-btn-disable-account,#nc-btn-delete-account'
      );
      if (!hit) return;
      const fn = map[hit.id];
      if (!fn) return;
      // let the native click happen first; if nothing opens, the portal makes it visible anyway.
      setTimeout(syncBodyState, 0);
    }, true);
  }

  function boot(){
    ensurePortal();
    bindModalState();
    bindDirectButtons();
    syncBodyState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
  window.addEventListener('load', boot);
  window.addEventListener('resize', syncBodyState);
})();


(function(){
  const IDS = [
    'nc-account-modal',
    'nc-password-modal',
    'nc-2fa-modal',
    'nc-2fa-disable-modal',
    'nc-disable-modal',
    'nc-delete-modal',
    'nc-info-modal'
  ];

  function settingsOpen(){
    const ov = document.getElementById('nc-settings-overlay');
    return !!(ov && !ov.classList.contains('is-hidden'));
  }

  function anyMiniOpen(){
    return IDS.some((id)=>{
      const el = document.getElementById(id);
      return !!(el && !el.classList.contains('is-hidden'));
    });
  }

  function sync(){
    const open = settingsOpen();
    const mini = anyMiniOpen();
    if (!mini) {
      try{ document.body.classList.remove('nc-account-mini-open'); }catch(e){}
    }
    if (!open) {
      try{ document.body.classList.remove('nc-account-mini-open'); }catch(e){}
    }
  }

  function bind(){
    IDS.forEach((id)=>{
      const el = document.getElementById(id);
      if (!el || el.dataset.ncFix354Bound === '1') return;
      el.dataset.ncFix354Bound = '1';
      const mo = new MutationObserver(sync);
      mo.observe(el, {attributes:true, attributeFilter:['class']});
    });
    const ov = document.getElementById('nc-settings-overlay');
    if (ov && ov.dataset.ncFix354Bound !== '1') {
      ov.dataset.ncFix354Bound = '1';
      const mo = new MutationObserver(sync);
      mo.observe(ov, {attributes:true, attributeFilter:['class']});
    }
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, {once:true});
  } else {
    bind();
  }
  window.addEventListener('load', sync);
})();


(function(){
  const TARGET_IDS = new Set([
    'nc-btn-edit-displayname','nc-btn-edit-username','nc-btn-edit-email','nc-btn-edit-phone',
    'nc-btn-change-password','nc-btn-recover-password','nc-btn-enable-auth-app',
    'nc-btn-register-security-key','nc-btn-disable-account','nc-btn-delete-account'
  ]);

  function $(sel, root){ return (root||document).querySelector(sel); }
  function byId(id){ return document.getElementById(id); }
  function txt(id, fallback){
    const el = byId(id);
    return el ? (el.textContent || '').trim() : (fallback || '');
  }
  function rawValue(id){
    const el = byId(id);
    if (!el) return '';
    const raw = el.getAttribute('data-raw');
    return raw != null ? String(raw) : ((el.textContent || '').trim());
  }
  function setRawValue(id, value){
    const el = byId(id);
    if (el) el.setAttribute('data-raw', String(value || ''));
  }
  function setText(id, value){
    const el = byId(id);
    if (el) el.textContent = value;
  }
  function setCount(id, value){
    const el = byId(id);
    if (el) el.setAttribute('data-change-count', String(Number(value || 0)));
  }
  function getCount(id){
    const el = byId(id);
    return Number(el && el.getAttribute('data-change-count') || 0);
  }
  function toast(msg){ try{ if (window.ncToast) window.ncToast(msg); }catch(e){} }
  async function api(url, body, method){
    const r = await fetch(url, {
      method: method || 'POST',
      headers: method === 'GET' ? undefined : {'Content-Type':'application/json'},
      credentials:'same-origin',
      body: method === 'GET' ? undefined : JSON.stringify(body || {})
    });
    const j = await r.json().catch(()=>null);
    if (!r.ok) throw new Error((j && j.error) ? j.error : 'Ошибка');
    return j;
  }

  let root, card, titleEl, subtitleEl, bodyEl, actionsEl, closeBtn, backdropEl;
  let activeActionHandlers = [];
  let prevActiveEl = null;
  let prevDocKeydown = null;

  function stopEvt(e){
    if (!e) return;
    try{ e.preventDefault(); }catch(_e){}
    try{ e.stopPropagation(); }catch(_e){}
    try{ if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }catch(_e){}
  }

  function runAction(index){
    const fn = activeActionHandlers[index];
    if (typeof fn !== 'function') return;
    try{ fn(); }catch(e){ console.error(e); }
  }

  function onRootKeydown(e){
    if (!root || !root.classList.contains('is-open')) return;
    if (e.key === 'Escape'){
      stopEvt(e);
      close();
    }
  }

  function ensureRoot(){
    if (root) return root;
    root = document.createElement('div');
    root.id = 'nc-hard-modal-root';
    root.tabIndex = -1;
    root.innerHTML = `
      <div class="nc-hard-modal-backdrop" data-close="1"></div>
      <div class="nc-hard-modal-card" role="dialog" aria-modal="true" tabindex="-1">
        <div class="nc-hard-modal-head">
          <div>
            <div class="nc-hard-modal-kicker">Neon Account</div>
            <div class="nc-hard-modal-title"></div>
            <div class="nc-hard-modal-subtitle"></div>
          </div>
          <button class="nc-hard-modal-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="nc-hard-modal-body"></div>
        <div class="nc-hard-actions"></div>
      </div>`;
    document.body.appendChild(root);
    card = $('.nc-hard-modal-card', root);
    backdropEl = $('.nc-hard-modal-backdrop', root);
    titleEl = $('.nc-hard-modal-title', root);
    subtitleEl = $('.nc-hard-modal-subtitle', root);
    bodyEl = $('.nc-hard-modal-body', root);
    actionsEl = $('.nc-hard-actions', root);
    closeBtn = $('.nc-hard-modal-close', root);

    const closeHandler = function(e){ if (e) stopEvt(e); close(); };
    if (backdropEl){
      backdropEl.onclick = closeHandler;
      backdropEl.onmouseup = closeHandler;
      backdropEl.onpointerup = closeHandler;
    }
    if (closeBtn){
      closeBtn.onclick = closeHandler;
      closeBtn.onmouseup = closeHandler;
      closeBtn.onpointerup = closeHandler;
    }

    root.addEventListener('pointerdown', function(e){
      if (root.classList.contains('is-open') && (e.target === backdropEl || card.contains(e.target))) {
        try{ e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }catch(_e){}
      }
    }, true);
    root.addEventListener('click', function(e){
      if (!root.classList.contains('is-open')) return;
      const actionBtn = e.target && e.target.closest ? e.target.closest('[data-hard-action-index]') : null;
      if (actionBtn && card.contains(actionBtn)){
        stopEvt(e);
        runAction(Number(actionBtn.getAttribute('data-hard-action-index')) || 0);
        return;
      }
      if (e.target === backdropEl || e.target === closeBtn || (e.target && e.target.dataset && e.target.dataset.close === '1')){
        stopEvt(e);
        close();
        return;
      }
      if (card.contains(e.target)) {
        try{ e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }catch(_e){}
      }
    }, true);

    document.addEventListener('keydown', onRootKeydown, true);
    return root;
  }

  function forceHideLegacy(){
    ['nc-account-modal','nc-password-modal','nc-2fa-modal','nc-2fa-disable-modal','nc-disable-modal','nc-delete-modal','nc-info-modal'].forEach((id)=>{
      const el = byId(id);
      if (el) el.classList.add('is-hidden');
    });
    document.body.classList.remove('nc-account-mini-open');
  }

  function open(opts){
    ensureRoot();
    forceHideLegacy();
    prevActiveEl = document.activeElement;
    titleEl.textContent = opts.title || 'Действие';
    subtitleEl.textContent = opts.subtitle || '';
    subtitleEl.style.display = opts.subtitle ? '' : 'none';
    bodyEl.innerHTML = '';
    actionsEl.innerHTML = '';
    activeActionHandlers = [];
    if (opts.width) card.style.width = opts.width;
    else card.style.width = '';
    if (opts.body) bodyEl.appendChild(opts.body);
    (opts.actions || []).forEach((a, idx)=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nc-hard-btn' + (a.primary ? ' is-primary' : '') + (a.danger ? ' is-danger' : '');
      btn.textContent = a.label;
      btn.setAttribute('data-hard-action-index', String(idx));
      activeActionHandlers[idx] = a.onClick;
      const handler = function(e){ stopEvt(e); runAction(idx); };
      btn.onclick = handler;
      btn.onmouseup = handler;
      btn.onpointerup = handler;
      actionsEl.appendChild(btn);
    });
    root.classList.add('is-open');
    document.body.classList.add('nc-hard-modal-open');
    prevDocKeydown = document.onkeydown;
    document.onkeydown = function(e){
      if (root && root.classList.contains('is-open') && e && e.key === 'Escape'){
        stopEvt(e);
        close();
        return false;
      }
      if (typeof prevDocKeydown === 'function') return prevDocKeydown.call(document, e);
    };
    setTimeout(()=>{
      try{
        const first = bodyEl.querySelector('input,textarea,select,button');
        if (first) first.focus();
        else if (closeBtn) closeBtn.focus();
        else if (card) card.focus();
      }catch(e){}
    }, 0);
  }
  function close(){
    if (!root) return;
    root.classList.remove('is-open');
    document.body.classList.remove('nc-hard-modal-open');
    activeActionHandlers = [];
    forceHideLegacy();
    document.onkeydown = prevDocKeydown || null;
    prevDocKeydown = null;
    try{ if (prevActiveEl && prevActiveEl.focus) prevActiveEl.focus({preventScroll:true}); }catch(e){}
    prevActiveEl = null;
  }

  function makeError(){ const d=document.createElement('div'); d.className='nc-hard-error'; return d; }
  function fieldSection(label, input){
    const s=document.createElement('div'); s.className='nc-hard-modal-section';
    const l=document.createElement('label'); l.className='nc-hard-label'; l.textContent=label; s.appendChild(l); s.appendChild(input); return s;
  }
  function input(type, value, placeholder){
    const i=document.createElement('input'); i.className='nc-hard-input'; i.type=type||'text'; i.value=value||''; i.placeholder=placeholder||''; return i;
  }

  function syncSummary(){
    const email = txt('nc-email-value');
    const phone = txt('nc-phone-value');
    const summary = document.querySelectorAll('#nc-settings-overlay [data-page="account"] .nc-account-summary-item strong');
    if (summary[1]) summary[1].textContent = /не добав/i.test(email) ? 'Не добавлена' : 'Добавлена';
    if (summary[2]) summary[2].textContent = /не добав/i.test(phone) ? 'Не добавлен' : 'Добавлен';
  }

  function updateRestrictionUi(payload){
    if (!payload) return;
    const usernameBtn = byId('nc-btn-edit-username');
    const usernameNote = byId('nc-username-note');
    const usernameAllowed = Number(payload.username_change_allowed ?? (1 - Number(payload.username_change_count || 0)));
    if (usernameBtn) usernameBtn.disabled = usernameAllowed <= 0;
    if (usernameNote){
      usernameNote.textContent = usernameAllowed <= 0
        ? 'Вы использовали свой единственный раз для изменения постоянного имени пользователя.'
        : 'Имя пользователя можно изменить только один раз.';
    }

    const emailBtn = byId('nc-btn-edit-email');
    const emailNote = byId('nc-email-note');
    const emailAllowed = Number(payload.email_change_allowed ?? (2 - Number(payload.email_change_count || 0)));
    if (emailBtn) emailBtn.disabled = emailAllowed <= 0;
    if (emailNote){
      const hasEmail = !!rawValue('nc-email-value');
      emailNote.textContent = emailAllowed <= 0
        ? 'Лимит перепривязки почты исчерпан. Кнопка изменения заблокирована.'
        : `Почту можно перепривязать ещё ${emailAllowed} из 2 раз. Для изменения понадобится пароль${hasEmail ? ' и текущая почта' : ''}.`;
    }

    const phoneBtn = byId('nc-btn-edit-phone');
    const phoneNote = byId('nc-phone-note');
    const phoneAllowed = Number(payload.phone_change_allowed ?? (2 - Number(payload.phone_change_count || 0)));
    if (phoneBtn) phoneBtn.disabled = phoneAllowed <= 0;
    if (phoneNote){
      const hasPhone = !!rawValue('nc-phone-value');
      phoneNote.textContent = phoneAllowed <= 0
        ? 'Лимит перепривязки телефона исчерпан. Кнопка изменения заблокирована.'
        : `Телефон можно перепривязать ещё ${phoneAllowed} из 2 раз. Для изменения понадобится пароль${hasPhone ? ' и текущий номер' : ''}.`;
    }
  }

  function openFieldEditor(kind){
    const meta = {
      displayname: {
        title:'Изменить отображаемое имя', subtitle:'Это имя видно в профиле и списках.',
        label:'Отображаемое имя', value: txt('nc-displayname-value'), api:'/api/account/update_display_name',
        after:(j,v)=>{ const val = (j && j.display_name) || v; byId('nc-displayname-value').textContent = val || 'Не добавлен'; byId('nc-account-displayname').textContent = val || txt('nc-username-value'); }
      },
      username: {
        title:'Изменить имя пользователя', subtitle:'Используется для входа и @упоминаний.',
        label:'Имя пользователя', value: rawValue('nc-username-value'), api:'/api/account/update_username',
        note: 'Имя пользователя можно изменить только один раз. После этого кнопка будет недоступна и останется залоченной.',
        after:(j,v)=>{ const val = (j && j.username) || v; setText('nc-username-value', val); setRawValue('nc-username-value', val); setText('nc-account-username-top', val); setCount('nc-username-value', j && j.username_change_count); updateRestrictionUi(j); }
      },
      email: {
        title:'Изменить электронную почту', subtitle:'Для изменения нужны пароль и подтверждение текущей почты.',
        label:'Новая электронная почта', value: rawValue('nc-email-value'), api:'/api/account/update_email', type:'email',
        confirmLabel: rawValue('nc-email-value') ? `Текущая электронная почта (${txt('nc-email-value')})` : null, confirmValue:'',
        passwordLabel:'Пароль',
        note:'Почта уникальна для одного аккаунта. Один и тот же адрес нельзя использовать на другом аккаунте. В профиле она показывается в скрытом виде.',
        after:(j,v)=>{ const raw = (j && j.email) || v || ''; setRawValue('nc-email-value', raw); setText('nc-email-value', (j && j.email_masked) || 'Не добавлен'); setCount('nc-email-value', j && j.email_change_count); syncSummary(); updateRestrictionUi(j); }
      },
      phone: {
        title:'Изменить номер телефона', subtitle:'Для изменения нужны пароль и подтверждение текущего номера.',
        label:'Новый номер телефона', value: rawValue('nc-phone-value'), api:'/api/account/update_phone', type:'tel',
        confirmLabel: rawValue('nc-phone-value') ? `Текущий номер телефона (${txt('nc-phone-value')})` : null, confirmValue:'',
        passwordLabel:'Пароль',
        note:'Телефон уникален для одного аккаунта. Указывайте международный формат: + и код страны. Для России и Казахстана используйте +7, для США/Канады — +1. В профиле видны только последние 2 цифры.',
        after:(j,v)=>{ const raw = (j && j.phone) || v || ''; setRawValue('nc-phone-value', raw); setText('nc-phone-value', (j && j.phone_masked) || 'Не добавлен'); setCount('nc-phone-value', j && j.phone_change_count); syncSummary(); updateRestrictionUi(j); }
      }
    }[kind];
    if (!meta) return;
    const inp = input(meta.type || 'text', meta.value || '', kind === 'phone' ? '+79991234567' : '');
    const confirmInp = meta.confirmLabel ? input(meta.type || 'text', meta.confirmValue || '', kind === 'phone' ? '+79991234567' : '') : null;
    const passwordInp = meta.passwordLabel ? input('password', '', '') : null;
    if (kind === 'phone'){
      const sanitizePhone = (el)=>{
        if (!el) return;
        el.setAttribute('inputmode', 'tel');
        el.setAttribute('maxlength', '16');
        el.addEventListener('input', ()=>{
          let v = String(el.value || '');
          v = v.replace(/[^\d+]/g, '');
          if (!v.startsWith('+')) v = '+' + v.replace(/\+/g, '');
          v = '+' + v.slice(1).replace(/\+/g, '');
          el.value = v.slice(0, 16);
        });
      };
      sanitizePhone(inp);
      sanitizePhone(confirmInp);
    }
    const err = makeError();
    const body = document.createElement('div');
    body.appendChild(fieldSection(meta.label, inp));
    if (confirmInp) body.appendChild(fieldSection(meta.confirmLabel, confirmInp));
    if (passwordInp) body.appendChild(fieldSection(meta.passwordLabel, passwordInp));
    if (meta.note){
      const noteWrap = document.createElement('div');
      noteWrap.className = 'nc-hard-modal-section';
      noteWrap.innerHTML = `<div class="nc-hard-modal-subtitle" style="display:block">${meta.note}</div>`;
      body.appendChild(noteWrap);
    }
    body.appendChild(err);
    open({
      title: meta.title,
      subtitle: meta.subtitle,
      body,
      actions:[
        { label:'Отмена', onClick: close },
        { label:'Сохранить', primary:true, onClick: async ()=>{
          try{
            err.textContent='';
            const value = String(inp.value || '').trim();
            const payload = { value };
            if (confirmInp) payload.current_value = String(confirmInp.value || '').trim();
            if (passwordInp) payload.password = String(passwordInp.value || '');
            const j = await api(meta.api, payload);
            meta.after(j, value);
            toast('Сохранено');
            close();
          }catch(e){ err.textContent = String(e.message || e); }
        }}
      ]
    });
    setTimeout(()=>{ try{ inp.focus(); inp.select(); }catch(e){} }, 0);
  }

  function openPassword(mode){
    const body = document.createElement('div');
    const err = makeError();
    let first, newPass, confirmPass;
    if (mode === 'change'){
      first = input('password','','');
      body.appendChild(fieldSection('Текущий пароль', first));
    } else {
      first = input('text','','XXXX-XXXX-XXXX');
      body.appendChild(fieldSection('Код восстановления', first));
    }
    newPass = input('password','','');
    confirmPass = input('password','','');
    body.appendChild(fieldSection('Новый пароль', newPass));
    body.appendChild(fieldSection('Подтверждение нового пароля', confirmPass));
    body.appendChild(err);
    open({
      title: mode === 'change' ? 'Изменить пароль' : 'Восстановить пароль',
      subtitle: mode === 'change' ? 'Введите текущий пароль и придумайте новый.' : 'Введите код восстановления и новый пароль.',
      body,
      actions:[
        { label:'Отмена', onClick: close },
        { label:'Готово', primary:true, onClick: async ()=>{
          try{
            err.textContent='';
            if (mode === 'change') await api('/api/account/change_password', { current_password:first.value, new_password:newPass.value, new_password2:confirmPass.value });
            else await api('/api/account/recovery/use', { code:first.value, new_password:newPass.value, new_password2:confirmPass.value });
            toast('Готово');
            close();
          }catch(e){ err.textContent = String(e.message || e); }
        }}
      ]
    });
    setTimeout(()=>{ try{ first.focus(); }catch(e){} }, 0);
  }

  function open2fa(){
    api('/api/account/2fa/status', {}, 'GET').then((st)=>{
      if (st && st.enabled) return open2faDisable();
      return open2faSetup();
    }).catch(()=>open2faSetup());
  }

  function open2faSetup(){
    const body = document.createElement('div');
    const wrap = document.createElement('div'); wrap.className='nc-hard-modal-section nc-hard-qr-row';
    const qrBox = document.createElement('div'); qrBox.className='nc-hard-qr-box';
    const qr = document.createElement('img'); qr.alt='QR'; qrBox.appendChild(qr);
    const info = document.createElement('div');
    const p1 = document.createElement('div'); p1.className='nc-hard-label'; p1.textContent='Сканируйте QR-код';
    const p2 = document.createElement('div'); p2.className='nc-hard-modal-subtitle'; p2.style.display='block'; p2.textContent='Откройте Authy или Google Authenticator и добавьте аккаунт.';
    const secretLabel = document.createElement('div'); secretLabel.className='nc-hard-label'; secretLabel.style.marginTop='12px'; secretLabel.textContent='Код для ручного ввода';
    const secret = document.createElement('div'); secret.className='nc-hard-secret'; secret.textContent='Загрузка…';
    const code = input('text','','000000'); code.className='nc-hard-code'; code.maxLength=6;
    info.appendChild(p1); info.appendChild(p2); info.appendChild(secretLabel); info.appendChild(secret); info.appendChild(fieldSection('Код из приложения', code));
    wrap.appendChild(qrBox); wrap.appendChild(info);
    const err = makeError();
    body.appendChild(wrap); body.appendChild(err);
    open({
      title:'Включить приложение для аутентификации',
      subtitle:'После настройки при входе потребуется код из приложения.',
      width:'min(740px, calc(100vw - 28px))',
      body,
      actions:[
        { label:'Отмена', onClick: close },
        { label:'Активировать', primary:true, onClick: async ()=>{
          try{
            err.textContent='';
            await api('/api/account/2fa/confirm', { code: code.value.trim() });
            const btn = byId('nc-btn-enable-auth-app'); if (btn) btn.textContent='Отключить приложение для аутентификации';
            toast('2FA включена');
            close();
          }catch(e){ err.textContent = String(e.message || e); }
        }}
      ]
    });
    api('/api/account/2fa/start', {}).then((j)=>{
      qr.src = (j && j.qr) || '';
      secret.textContent = (j && j.secret) || '—';
    }).catch((e)=>{ err.textContent = String(e.message || e); secret.textContent='—'; });
  }

  function open2faDisable(){
    const pwd = input('password','','');
    const code = input('text','','000000'); code.maxLength=6;
    const err = makeError();
    const body = document.createElement('div');
    body.appendChild(fieldSection('Пароль', pwd));
    body.appendChild(fieldSection('Код из приложения', code));
    body.appendChild(err);
    open({
      title:'Отключить приложение для аутентификации',
      subtitle:'Подтвердите действие паролем и 6-значным кодом.',
      body,
      actions:[
        { label:'Отмена', onClick: close },
        { label:'Отключить', danger:true, onClick: async ()=>{
          try{
            err.textContent='';
            await api('/api/account/2fa/disable', { password: pwd.value, code: code.value.trim() });
            const btn = byId('nc-btn-enable-auth-app'); if (btn) btn.textContent='Включить приложение для аутентификации';
            toast('2FA отключена');
            close();
          }catch(e){ err.textContent = String(e.message || e); }
        }}
      ]
    });
  }

  function openInfo(title, subtitle, text){
    const body = document.createElement('div');
    const sec = document.createElement('div'); sec.className='nc-hard-modal-section'; sec.innerHTML = `<div class="nc-hard-modal-subtitle" style="display:block">${text}</div>`;
    body.appendChild(sec);
    open({ title, subtitle, body, actions:[{label:'Закрыть', primary:true, onClick: close}] });
  }

  function openDisableAccount(){
    const pwd = input('password','','');
    const err = makeError();
    const body = document.createElement('div');
    body.appendChild(fieldSection('Введите пароль', pwd));
    body.appendChild(err);
    open({
      title:'Отключить учётную запись',
      subtitle:'Вы выйдете из аккаунта, но сможете вернуться позже.',
      body,
      actions:[
        { label:'Отмена', onClick: close },
        { label:'Отключить', danger:true, onClick: async ()=>{
          try{
            err.textContent='';
            await api('/api/account/disable', { password: pwd.value });
            window.location.href='/login';
          }catch(e){ err.textContent = String(e.message || e); }
        }}
      ]
    });
  }

  function openDeleteAccount(){
    const pwd = input('password','','');
    const conf = input('text','','DELETE');
    const err = makeError();
    const body = document.createElement('div');
    body.appendChild(fieldSection('Введите пароль', pwd));
    body.appendChild(fieldSection('Подтверждение', conf));
    body.appendChild(err);
    open({
      title:'Удалить учётную запись',
      subtitle:'Действие необратимо. Для подтверждения введите DELETE.',
      body,
      actions:[
        { label:'Отмена', onClick: close },
        { label:'Удалить', danger:true, onClick: async ()=>{
          try{
            err.textContent='';
            await api('/api/account/delete', { password: pwd.value, confirm: conf.value });
            window.location.href='/login';
          }catch(e){ err.textContent = String(e.message || e); }
        }}
      ]
    });
  }

  function openEditProfile(){
    try{
      if (typeof window.__ncOpenProfileSettingsModal === 'function'){
        return window.__ncOpenProfileSettingsModal({tab:'main'});
      }
      if (typeof window.__ncOpenEditProfileModal === 'function' && window.__ncOpenEditProfileModal !== openEditProfile){
        return window.__ncOpenEditProfileModal({tab:'main'});
      }
    }catch(_e){}
    openInfo('Редактировать профиль', 'Профиль', 'Модалка редактирования профиля сейчас недоступна.');
  }

  function handleById(id){
    switch(id){
      case 'nc-btn-edit-displayname': return openFieldEditor('displayname');
      case 'nc-btn-edit-username': return openFieldEditor('username');
      case 'nc-btn-edit-email': return openFieldEditor('email');
      case 'nc-btn-edit-phone': return openFieldEditor('phone');
      case 'nc-btn-change-password': return openPassword('change');
      case 'nc-btn-recover-password': return openPassword('recovery');
      case 'nc-btn-enable-auth-app': return open2fa();
      case 'nc-btn-register-security-key': return openInfo('Ключи безопасности', 'WebAuthn / Security Key', 'Регистрация аппаратных ключей требует отдельной WebAuthn-интеграции. Интерфейс уже готов, а саму привязку можно подключить следующим патчем.');
      case 'nc-btn-disable-account': return openDisableAccount();
      case 'nc-btn-delete-account': return openDeleteAccount();
      case 'nc-edit-profile': return openEditProfile();
    }
  }

  function intercept(e){
    const t = e.target && e.target.closest && e.target.closest('#nc-edit-profile,#nc-btn-edit-displayname,#nc-btn-edit-username,#nc-btn-edit-email,#nc-btn-edit-phone,#nc-btn-change-password,#nc-btn-recover-password,#nc-btn-enable-auth-app,#nc-btn-register-security-key,#nc-btn-disable-account,#nc-btn-delete-account');
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (t.disabled){
      if (t.id === 'nc-btn-edit-username') return toast('Вы уже использовали свой единственный раз для изменения постоянного имени пользователя.');
      if (t.id === 'nc-btn-edit-email') return toast('Лимит перепривязки почты исчерпан.');
      if (t.id === 'nc-btn-edit-phone') return toast('Лимит перепривязки телефона исчерпан.');
      return;
    }
    handleById(t.id);
  }

  // Important: intercept only on click. If we open on pointerdown, the same pointer sequence
  // can finish on the freshly inserted backdrop and instantly close the modal.
  // That was exactly the "click -> opens -> immediately closes" bug.
  try{ updateRestrictionUi({
    username_change_count: getCount('nc-username-value'),
    email_change_count: getCount('nc-email-value'),
    phone_change_count: getCount('nc-phone-value')
  }); }catch(e){}
  window.addEventListener('click', intercept, true);
  try{
    if (typeof window.__ncOpenProfileSettingsModal === 'function'){
      window.__ncOpenEditProfileModal = window.__ncOpenProfileSettingsModal;
    }
  }catch(_e){}
})();


(function(){
  const EDITABLE_SEL = [
    'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([disabled]):not([readonly])',
    'textarea:not([disabled]):not([readonly])',
    'select:not([disabled])',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable="plaintext-only"]'
  ].join(',');

  function activeModalRoot(){
    const hard = document.querySelector('#nc-hard-modal-root.is-open');
    if (hard) return hard;
    const mini = document.querySelector('.nc-mini-modal:not(.is-hidden)');
    if (mini) return mini;
    return null;
  }

  function editableTarget(t){
    if (!t || !t.closest) return null;
    if (t.matches && t.matches(EDITABLE_SEL)) return t;
    return t.closest(EDITABLE_SEL);
  }

  function isInside(el, root){
    try{ return !!(el && root && root.contains(el)); }catch(e){ return false; }
  }

  function stopOnlyPropagation(e){
    try{ if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }catch(_e){}
    try{ e.stopPropagation(); }catch(_e){}
  }

  function protectModalTyping(e){
    const root = activeModalRoot();
    if (!root) return;
    const field = editableTarget(e.target);
    if (!field || !isInside(field, root)) return;

    // Escape should still bubble to the modal close logic.
    if (e.key === 'Escape') return;

    // Let the browser keep its native editing behavior, but block global app hotkeys
    // from swallowing the keystroke before it reaches the field.
    stopOnlyPropagation(e);
  }

  function protectModalFocus(e){
    const root = activeModalRoot();
    if (!root) return;
    const field = editableTarget(e.target);
    if (!field || !isInside(field, root)) return;
    stopOnlyPropagation(e);
  }

  // window capture runs before the many document-level shortcut handlers in the app.
  window.addEventListener('keydown', protectModalTyping, true);
  window.addEventListener('keypress', protectModalTyping, true);
  window.addEventListener('keyup', protectModalTyping, true);
  window.addEventListener('beforeinput', protectModalTyping, true);

  // Keep focus/clicks inside the field from leaking back into settings layers.
  window.addEventListener('pointerdown', protectModalFocus, true);
  window.addEventListener('mousedown', protectModalFocus, true);
  window.addEventListener('click', protectModalFocus, true);
})();
