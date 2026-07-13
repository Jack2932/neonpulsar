/* Semantic script */

/* Fix264: Subscription gifts (Nitro-like). Lightweight UI + server enforcement. */
(function(){
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  function toast(msg){
    try{ if (typeof ncToast === 'function') return ncToast(msg); }catch(e){}
    try{ console.log('[gift]', msg); }catch(e){}
    try{ alert(msg); }catch(e){}
  }

  async function api(url, opts){
    const res = await fetch(url, Object.assign({ credentials:'same-origin' }, opts||{}));
    let data = {};
    try{ data = await res.json(); }catch(_){ }
    if(!res.ok){ throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`); }
    return data;
  }

  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m])); }
  function fmtDate(v){
    if(!v) return '—';
    try{
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    }catch(_e){ return String(v); }
  }
  function planLogo(code){
    code = String(code||'').toLowerCase();
    if (code === 'pro') return '/static/img/neon_pro_logo.svg';
    if (code === 'plus') return '/static/img/neon_plus_logo.svg';
    return '/static/img/brand.png';
  }
  function statusLabel(status){ return ({active:'Ожидает активации', redeemed:'Активирован', expired:'Истёк', revoked:'Отозван'})[String(status||'').toLowerCase()] || String(status||''); }
  function statusCls(status){ return `is-${String(status||'').toLowerCase()}`; }
  function fmtPerson(u){ return (u && (u.display_name || u.username)) || '—'; }
  function clampMonths(value, fallback){
    const raw = Number(value);
    if (!Number.isFinite(raw)) return Math.min(12, Math.max(1, Number(fallback || 1) || 1));
    return Math.min(12, Math.max(1, Math.round(raw)));
  }
  function monthsText(months){
    const m = clampMonths(months, 1);
    if (m % 10 === 1 && m % 100 !== 11) return `${m} месяц`;
    if ([2,3,4].includes(m % 10) && ![12,13,14].includes(m % 100)) return `${m} месяца`;
    return `${m} месяцев`;
  }
  function formatMoney(minor, currency){
    const n = Number(minor || 0) / 100;
    if ((currency || 'RUB') === 'RUB') return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(n);
    return `${n.toFixed(2)} ${(currency||'').toUpperCase()}`;
  }
  function durationButtonsHtml(selected){
    const active = clampMonths(selected, 1);
    return `<div class="nc-bill-duration-grid">${Array.from({ length:12 }, (_, idx) => {
      const m = idx + 1;
      return `<button type="button" class="nc-bill-duration-chip ${m === active ? 'is-active' : ''}" data-gift-month="${m}">${m}</button>`;
    }).join('')}</div>`;
  }


  let _modal = null;
  let _tab = 'gift';
  let _giftRoot = null;

  function freezeSettingsUnderGift(){
    const ov = document.getElementById('nc-settings-overlay');
    if (!ov) return;
    ov.classList.add('nc-has-gift-modal');
    try{ document.body.classList.add('nc-gift-modal-open'); }catch(_e){}
    try{ window.__ncGiftModalOpen = true; }catch(_e){}
  }

  function unfreezeSettingsUnderGift(){
    const ov = document.getElementById('nc-settings-overlay');
    if (!ov) return;
    ov.classList.remove('nc-has-gift-modal');
    try{ document.body.classList.remove('nc-gift-modal-open'); }catch(_e){}
    try{ window.__ncGiftModalOpen = false; }catch(_e){}
  }

  function ensureRoot(){
    const ov = document.getElementById('nc-settings-overlay');
    if (!ov) return null;
    let root = ov.querySelector('#nc-gift-root');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'nc-gift-root';
    root.className = 'nc-gift-root';
    root.setAttribute('aria-hidden','true');
    root.innerHTML = '<div class="nc-gift-backdrop" data-close="1"></div><div class="nc-gift-stage"></div>';
    root.addEventListener('click', (e)=>{
      const t = e.target;
      if (t && (t.getAttribute && t.getAttribute('data-close')==='1')) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }, true);
    ov.appendChild(root);
    _giftRoot = root;
    return root;
  }

  function ensureModal(){
    const root = ensureRoot();
    if (!root) return null;
    const stage = root.querySelector('.nc-gift-stage');
    if (_modal && stage && stage.contains(_modal)) return _modal;
    const wrap = document.createElement('div');
    wrap.id = 'modal-gifts';
    wrap.className = 'nc-gift-shell';
    wrap.setAttribute('aria-hidden','false');
    wrap.innerHTML = `
      <div class="modal nc-gift-modal" role="dialog" aria-modal="true" aria-label="Подарки подписки">
        <div class="glass-card nc-gift-card-shell" style="padding:16px 16px 14px; position:relative; z-index:2;">
          <div class="nc-gift-head">
            <div class="nc-gift-title">
              <div class="ico">🎁</div>
              <div>
                <div class="nc-gift-title__main">Подарки подписки</div>
                <div class="nc-gift-title__sub">Красивая подарочная подписка без кодов. Выбираешь тариф, срок и друга — подарок сразу попадает в его инвентарь.</div>
              </div>
            </div>
            <button type="button" class="modal-close" id="nc-gifts-close" aria-label="Закрыть">×</button>
          </div>
          <div class="nc-gift-body" id="nc-gift-body"></div>
        </div>
      </div>
    `;
    wrap.addEventListener('click', (e)=>{
      const closeBtn = e.target && e.target.closest ? e.target.closest('#nc-gifts-close') : null;
      if (closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
    }, true);
    stage.appendChild(wrap);
    _modal = wrap;
    return _modal;
  }

  function open(prefill){
    const ov = document.getElementById('nc-settings-overlay');
    if (!ov) return;
    ensureModal();
    prefill = prefill || {};

    try{
      if (!prefill.to_user_id){
        let dmUid = null;
        try{ if (typeof currentDmUserId !== 'undefined' && currentDmUserId) dmUid = parseInt(currentDmUserId,10)||null; }catch(_e){}
        if (dmUid) prefill.to_user_id = dmUid;
      }
    }catch(_e){}

    const root = ensureRoot();
    if (root){
      root.setAttribute('aria-hidden','false');
      root.classList.add('is-open');
    }
    if (_modal) {
      _modal.style.display = 'block';
      _modal.classList.add('active');
      _modal.setAttribute('aria-hidden','false');
    }
    freezeSettingsUnderGift();
    setTab(_tab || 'gift', prefill);
  }

  function close(){
    const root = document.getElementById('nc-gift-root');
    if (_modal) {
      _modal.classList.remove('active');
      _modal.style.display = 'none';
      _modal.setAttribute('aria-hidden','true');
    }
    if (root){
      root.classList.remove('is-open');
      root.setAttribute('aria-hidden','true');
    }
    unfreezeSettingsUnderGift();
  }

  document.addEventListener('keydown', (e)=>{
    if (!window.__ncGiftModalOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      try{ e.stopImmediatePropagation(); }catch(_e){}
      close();
    }
  }, true);

  async function getPlans(){
    try{ if (window.NC_BILLING && Array.isArray(window.NC_BILLING.plans) && window.NC_BILLING.plans.length) return window.NC_BILLING.plans; }catch(e){}
    const out = await api('/api/billing/plans');
    return out.plans || [];
  }

  async function getFriends(){
    // sidebar_meta already returns accepted friends list
    const out = await api('/api/sidebar_meta');
    return Array.isArray(out.friends) ? out.friends : [];
  }

  function openSettingsGiftInventory(){
    const overlay = document.getElementById('nc-settings-overlay');
    if (!overlay) return;
    try{
      const btn = overlay.querySelector('.nc-settings-item[data-page="gifts"]');
      if (btn) {
        btn.click();
      } else {
        overlay.querySelectorAll('.nc-settings-item').forEach(b=>b.classList.toggle('is-active', (b.getAttribute('data-page')||'')==='gifts'));
        overlay.querySelectorAll('.nc-settings-page').forEach(p=>p.classList.toggle('is-active', (p.getAttribute('data-page')||'')==='gifts'));
      }
    }catch(_e){}
    try{ renderSettingsGiftInventory(); }catch(_e){}
    try{ window.dispatchEvent(new CustomEvent('nc:settings-page-changed', { detail:{ page:'gifts' } })); }catch(_e){}
  }

  function setTab(tab, prefill){
    tab = (tab||'gift').toLowerCase();
    _tab = tab;
    const body = $('#nc-gift-body', _modal);
    if (!body) return;

    if (tab === 'inventory' || tab === 'redeem'){
      close();
      openSettingsGiftInventory();
      return;
    }

    if (tab === 'redeem' && false){
      body.innerHTML = `
        <div class="nc-gift-grid">
          <div class="nc-gift-field">
            <label>Код или ссылка</label>
            <input id="nc-gift-redeem-code" type="text" placeholder="NCGIFT-... или /gift/NCGIFT-...">
          </div>
          <div class="nc-gift-actions">
            <button class="nc-bill-btn primary" id="nc-gift-redeem-btn" type="button">Активировать</button>
            <button class="nc-bill-btn" id="nc-gift-redeem-close" type="button">Закрыть</button>
          </div>
          <div class="nc-bill-muted">Если подарок предназначен именно тебе — подписка активируется сразу.</div>
        </div>
      `;
      const btn = $('#nc-gift-redeem-btn', body);
      const inp = $('#nc-gift-redeem-code', body);
      const cls = $('#nc-gift-redeem-close', body);
      if (cls) cls.addEventListener('click', ()=>close());
      if (btn) btn.addEventListener('click', async ()=>{
        const code = (inp && inp.value || '').trim();
        if (!code){ toast('Вставь код подарка'); return; }
        try{
          await api('/api/billing/gifts/redeem', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code }) });
          toast('Подарок активирован ✅');
          try{ window.dispatchEvent(new CustomEvent('nc:billing-refresh')); }catch(e){}
          close();
        }catch(err){
          toast(err.message || String(err));
        }
      });
      if (inp) inp.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); btn && btn.click(); } });
      return;
    }

    if (tab === 'inventory'){
      body.innerHTML = `
        <div class="nc-bill-card">
          <div style="font-weight:900; font-size:16px;">Склад подарков</div>
          <div class="nc-bill-muted" style="margin-top:6px;">Теперь все подарки показываются только в отдельной странице «Склад подарков» в настройках.</div>
          <div class="nc-bill-muted" style="margin-top:6px;">Там видны входящие и отправленные подарки, а также кнопки активации и отзыва.</div>
        </div>
        <div class="nc-gift-actions">
          <button class="nc-bill-btn primary" id="nc-gift-open-settings-inv" type="button">Открыть склад подарков</button>
          <button class="nc-bill-btn" id="nc-gift-back-create" type="button">Создать подарок</button>
          <button class="nc-bill-btn" id="nc-gift-close" type="button">Закрыть</button>
        </div>
      `;
      const openInv = $('#nc-gift-open-settings-inv', body);
      const openCreate = $('#nc-gift-back-create', body);
      const closeBtn = $('#nc-gift-close', body);
      if (closeBtn) closeBtn.addEventListener('click', ()=>close());
      if (openCreate) openCreate.addEventListener('click', ()=>setTab('gift', prefill));
      if (openInv) openInv.addEventListener('click', ()=>{ close(); openSettingsGiftInventory(); });
      return;
    }

    // gift tab
    const preMonths = clampMonths(prefill && prefill.duration_months, 1);
    body.innerHTML = `
      <div class="nc-gift-hero-card">
        <div class="nc-gift-hero-card__orb"></div>
        <div class="nc-gift-hero-card__content">
          <div class="nc-gift-hero-card__kicker">NEON GIFT</div>
          <div class="nc-gift-hero-card__title">Подари подписку красиво</div>
          <div class="nc-gift-hero-card__text">Выбери план, срок от 1 до 12 месяцев и друга. Подарок сразу появится в его инвентаре и будет ждать активации.</div>
        </div>
      </div>

      <div class="nc-gift-plan-preview" id="nc-gift-plan-preview">
        <div class="nc-gift-plan-preview__main">
          <div class="nc-gift-plan-preview__logo-wrap"><img class="nc-gift-plan-preview__logo" id="nc-gift-preview-logo" src="${planLogo(prefill && prefill.plan_code || 'plus')}" alt=""></div>
          <div class="nc-gift-plan-preview__copy">
            <div class="nc-gift-plan-preview__kicker">ПОДАРОЧНЫЙ ТАРИФ</div>
            <div class="nc-gift-plan-preview__name" id="nc-gift-preview-name">Подписка</div>
            <div class="nc-gift-plan-preview__desc" id="nc-gift-preview-desc">Выбери тариф и срок подарка.</div>
          </div>
        </div>
        <div class="nc-gift-plan-preview__side">
          <div class="nc-gift-plan-preview__price" id="nc-gift-total-price">—</div>
          <div class="nc-gift-plan-preview__term" id="nc-gift-months-label">${monthsText(preMonths)}</div>
        </div>
      </div>

      <div class="nc-gift-grid two nc-gift-grid--top">
        <div class="nc-gift-field">
          <label>Тариф</label>
          <select id="nc-gift-plan"></select>
        </div>
        <div class="nc-gift-field">
          <label>Кому подарить</label>
          <select id="nc-gift-to">
            <option value="">Выбери друга</option>
          </select>
        </div>
      </div>

      <div class="nc-gift-field" style="margin-top:12px;">
        <label>На какой срок</label>
        <div class="nc-bill-duration-box nc-gift-duration-box" id="nc-gift-duration-box">
          <div class="nc-bill-duration-caption">От 1 месяца до 1 года. Подарок покупается сразу на весь выбранный срок.</div>
          ${durationButtonsHtml(preMonths)}
          <div class="nc-bill-duration-note">У получателя подарок активируется без автопродления.</div>
        </div>
      </div>

      <div class="nc-gift-field" style="margin-top:12px;">
        <label>Сообщение к подарку (опционально)</label>
        <textarea id="nc-gift-msg" placeholder="Например: спасибо за помощь ❤️"></textarea>
      </div>

      <div class="nc-gift-actions nc-gift-actions--single-row">
        <button class="nc-bill-btn primary" id="nc-gift-create" type="button">Подарить подписку</button>
        <button class="nc-bill-btn" id="nc-gift-close2" type="button">Закрыть</button>
      </div>

      <div class="nc-gift-result" id="nc-gift-result" style="display:none;"></div>
      <div class="nc-bill-muted nc-gift-footnote" style="margin-top:10px;">Совет: выбери конкретного друга — тогда активировать подарок сможет только он.</div>
    `;

    const planSel = $('#nc-gift-plan', body);
    const toSel = $('#nc-gift-to', body);
    const msgEl = $('#nc-gift-msg', body);
    const btnCreate = $('#nc-gift-create', body);
    const btnClose = $('#nc-gift-close2', body);
    const box = $('#nc-gift-result', body);
    const totalEl = $('#nc-gift-total-price', body);
    const monthsLabelEl = $('#nc-gift-months-label', body);
    const durationBox = $('#nc-gift-duration-box', body);
    const previewLogo = $('#nc-gift-preview-logo', body);
    const previewName = $('#nc-gift-preview-name', body);
    const previewDesc = $('#nc-gift-preview-desc', body);

    function selectedMonths(){
      const active = durationBox && durationBox.querySelector('[data-gift-month].is-active');
      return clampMonths(active && active.getAttribute('data-gift-month'), preMonths || 1);
    }
    function updateGiftSummary(){
      const planCode = (planSel && planSel.value || '').trim().toLowerCase();
      const months = selectedMonths();
      let plans = [];
      try{ plans = (window.NC_BILLING && Array.isArray(window.NC_BILLING.plans)) ? window.NC_BILLING.plans : []; }catch(_e){}
      const plan = (plans || []).find(p => String(p.code || '').toLowerCase() === planCode) || { code:planCode, name:'Подписка', description:'Выбери тариф и срок подарка.', price_minor:0, currency:'RUB' };
      if (monthsLabelEl) monthsLabelEl.textContent = monthsText(months);
      if (totalEl) totalEl.textContent = Number(plan.price_minor || 0) > 0 ? formatMoney(Number(plan.price_minor || 0) * months, plan.currency || 'RUB') : 'Бесплатно';
      if (previewLogo) previewLogo.src = planLogo(plan.code || planCode || 'plus');
      if (previewName) previewName.textContent = String(plan.name || plan.code || 'Подписка');
      if (previewDesc) previewDesc.textContent = Number(plan.price_minor || 0) > 0
        ? `${String(plan.description || 'Премиум-план')} • ${monthsText(months)}`
        : `${String(plan.description || 'Базовый план')} • ${monthsText(months)}`;
    }

    if (btnClose) btnClose.addEventListener('click', ()=>close());

    (async ()=>{
      try{
        const plans = await getPlans();
        const paid = (plans||[]).filter(p=>String(p.code||'')!=='free');
        if (planSel){
          planSel.innerHTML = paid.map(p=>`<option value="${String(p.code||'')}">${String(p.name||p.code||'')}</option>`).join('') || '<option value="plus">Plus</option>';
          const pre = (prefill && prefill.plan_code) ? String(prefill.plan_code) : '';
          if (pre && planSel.querySelector(`option[value="${pre}"]`)) planSel.value = pre;
          else {
            const plus = paid.find(p=>String(p.code||'')==='plus');
            if (plus) planSel.value = 'plus';
          }
        }
      }catch(e){
        if (planSel) planSel.innerHTML = '<option value="plus">Plus</option>';
      }

      try{
        const friends = await getFriends();
        if (toSel){
          const meId = (typeof currentUserId !== 'undefined' && currentUserId) ? String(currentUserId) : '';
          const seen = new Set();
          const opts = friends.filter(f=>{
            const uid = String(f.user_id || f.userId || f.id || '');
            if (!uid || uid === meId || seen.has(uid)) return false;
            seen.add(uid);
            return true;
          }).map(f=>{
            const uid = f.user_id || f.userId || f.id;
            const name = (f.display_name || f.displayName || f.username || f.name || ('User '+uid));
            return `<option value="${uid}">${String(name)}</option>`;
          }).join('');
          toSel.insertAdjacentHTML('beforeend', opts);
          if (prefill && prefill.to_user_id){
            const v = String(prefill.to_user_id);
            const opt = toSel.querySelector(`option[value="${v}"]`);
            if (opt) toSel.value = v;
          }
        }
      }catch(e){}
      updateGiftSummary();
    })();

    if (planSel) planSel.addEventListener('change', updateGiftSummary);
    if (durationBox) durationBox.addEventListener('click', (ev)=>{
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-gift-month]') : null;
      if (!btn) return;
      ev.preventDefault();
      durationBox.querySelectorAll('[data-gift-month]').forEach(node => node.classList.toggle('is-active', node === btn));
      updateGiftSummary();
    });

    if (btnCreate) btnCreate.addEventListener('click', async ()=>{
      const plan_code = (planSel && planSel.value || '').trim();
      const to_user_id = (toSel && toSel.value || '').trim();
      const message = (msgEl && msgEl.value || '').trim();
      const duration_months = selectedMonths();
      if (!plan_code){ toast('Выбери тариф'); return; }
      if (!to_user_id){ toast('Выбери друга, которому отправить подарок'); return; }
      try{
        btnCreate.disabled = true;
        const out = await api('/api/billing/gifts/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ plan_code, to_user_id: to_user_id || null, message, duration_months }) });
        const g = out && out.gift;
        if (!g){ toast('Не удалось создать подарок'); return; }
        if (box){
          box.style.display = '';
          const toName = (g.to && (g.to.display_name || g.to.username)) || 'другу';
          const giftDuration = monthsText(g.duration_months || duration_months);
          const giftMessage = g.message ? `<div class="nc-bill-muted" style="margin-top:8px;">Сообщение: ${String(g.message)}</div>` : '';
          box.innerHTML = `
            <div style="font-weight:900; margin-bottom:6px;">Подарок отправлен ✅</div>
            <div class="nc-bill-muted">Подписка отправлена для ${toName}. Она уже лежит в его инвентаре и ждёт активации.</div>
            <div class="nc-bill-muted" style="margin-top:8px;">Срок подарка: ${giftDuration}</div>
            ${giftMessage}
            <div style="display:flex; gap:10px; margin-top:12px;">
              <button class="nc-bill-btn primary" id="nc-gift-send-more" type="button">Отправить ещё</button>
              <button class="nc-bill-btn" id="nc-gift-success-close" type="button">Закрыть</button>
            </div>
          `;
          const b1 = $('#nc-gift-send-more', box);
          const b2 = $('#nc-gift-success-close', box);
          if (b1) b1.addEventListener('click', ()=>setTab('gift', { plan_code, duration_months }));
          if (b2) b2.addEventListener('click', ()=>close());
        }
        toast('Подарок отправлен');
        try{ window.dispatchEvent(new CustomEvent('nc:billing-refresh')); }catch(e){}
        try{ window.dispatchEvent(new CustomEvent('nc:gifts-refresh', { detail: { gift: g } })); }catch(e){}
        try{ window.__ncLastGiftCreated = g; }catch(e){}
        try{ renderSettingsGiftInventory(); }catch(e){}

      }catch(err){
        toast(err.message || String(err));
      }finally{
        try{ btnCreate.disabled = false; }catch(_e){}
      }
    });
  }



  async function renderSettingsGiftInventory(){
    const page = document.querySelector('.nc-settings-page[data-page="gifts"]');
    if (!page) return;
    page.classList.add('nc-gifts-page-host');
    page.innerHTML = `
      <div class="nc-gifts-page nc-gifts-page--rich">
        <div class="nc-gifts-hero nc-gifts-hero--inventory">
          <div class="nc-gifts-hero-copy">
            <div class="nc-gifts-kicker">NEON PULSAR</div>
            <h2 class="nc-settings-title">Склад подарков</h2>
            <div class="nc-settings-muted">Входящие и отправленные подарки подписки. Всё в одном красивом складе, без кодов и ссылок.</div>
          </div>
          <div class="nc-gifts-hero-actions">
            <button class="nc-bill-btn primary" type="button" id="nc-gifts-settings-open">Подарить другу</button>
            <button class="nc-bill-btn" type="button" id="nc-gifts-settings-refresh">Обновить</button>
          </div>
        </div>
        <div class="nc-gifts-current-plan" id="nc-gifts-current-plan"></div>
        <div class="nc-gifts-columns">
          <section class="nc-gift-section nc-bill-card" id="nc-gifts-settings-received"></section>
          <section class="nc-gift-section nc-bill-card" id="nc-gifts-settings-given"></section>
        </div>
      </div>`;

    const received = page.querySelector('#nc-gifts-settings-received');
    const given = page.querySelector('#nc-gifts-settings-given');
    const currentPlanBox = page.querySelector('#nc-gifts-current-plan');
    const btnOpen = page.querySelector('#nc-gifts-settings-open');
    const btnRefresh = page.querySelector('#nc-gifts-settings-refresh');
    if (btnOpen) btnOpen.onclick = ()=>open();

    async function load(){
      if(received) received.innerHTML = '<div class="nc-bill-muted">Загрузка входящих…</div>';
      if(given) given.innerHTML = '<div class="nc-bill-muted">Загрузка отправленных…</div>';
      try{
        const out = await api('/api/billing/gifts');
        const rec = Array.isArray(out.received) ? out.received : [];
        const giv = Array.isArray(out.given) ? out.given : [];
        try{
          const cur = (window.NC_BILLING && window.NC_BILLING.me && window.NC_BILLING.me.plan) || {};
          const curStatus = (window.NC_BILLING && window.NC_BILLING.me && window.NC_BILLING.me.status) || 'free';
          if (currentPlanBox){
            currentPlanBox.innerHTML = `
              <div class="nc-gifts-plan-chip">Текущий план: <strong>${esc(cur.name || 'Free')}</strong></div>
              <div class="nc-gifts-plan-chip is-soft">Статус: ${esc(curStatus || 'free')}</div>
              <div class="nc-gifts-plan-chip is-soft">Подарки активируются сразу после нажатия «Активировать»</div>`;
          }
        }catch(_e){}

        if(received){
          received.innerHTML = `
            <div class="nc-gift-section-head">
              <div>
                <div class="nc-gift-section-title">Входящие</div>
                <div class="nc-bill-muted">Подписки, которые подарили тебе.</div>
              </div>
              <div class="nc-gift-counter">${rec.length}</div>
            </div>
            ${rec.length ? `<div class="nc-gift-card-list">${rec.map(g=>{ const code=String((g.plan && g.plan.code) || '').toLowerCase(); const plan=(g.plan&&g.plan.name)||'План'; const from=fmtPerson(g.from); const msg=g.message?`<div class="nc-gift-note">${esc(g.message)}</div>`:''; const actionBtn=String(g.status||'')==='active' ? `<button class="nc-bill-btn primary" data-claim="${g.id}">Активировать сейчас</button>` : ''; return `<article class="nc-gift-item-card"><div class="nc-gift-item-main"><div class="nc-gift-plan-row"><img class="nc-gift-plan-logo" src="${planLogo(code)}" alt=""><div><div class="nc-gift-plan">${esc(plan)}</div><div class="nc-gift-meta">От: ${esc(from)} • ${esc(fmtDate(g.created_at))}</div></div></div>${msg}</div><div class="nc-gift-item-side"><span class="nc-gift-status ${statusCls(g.status)}">${esc(statusLabel(g.status))}</span>${actionBtn}</div></article>`; }).join('')}</div>` : '<div class="nc-gift-empty">Пока пусто. Когда тебе подарят подписку — она появится здесь.</div>'}`;
        }

        if(given){
          given.innerHTML = `
            <div class="nc-gift-section-head">
              <div>
                <div class="nc-gift-section-title">Отправленные</div>
                <div class="nc-bill-muted">Подписки, которые ты отправил друзьям.</div>
              </div>
              <div class="nc-gift-counter">${giv.length}</div>
            </div>
            ${giv.length ? `<div class="nc-gift-card-list">${giv.map(g=>{ const code=String((g.plan && g.plan.code) || '').toLowerCase(); const plan=(g.plan&&g.plan.name)||'План'; const to=fmtPerson(g.to); const msg=g.message?`<div class="nc-gift-note">${esc(g.message)}</div>`:''; const revokeBtn=String(g.status||'')==='active' ? `<button class="nc-bill-btn" data-revoke="${g.id}">Отозвать</button>` : ''; return `<article class="nc-gift-item-card"><div class="nc-gift-item-main"><div class="nc-gift-plan-row"><img class="nc-gift-plan-logo" src="${planLogo(code)}" alt=""><div><div class="nc-gift-plan">${esc(plan)}</div><div class="nc-gift-meta">Кому: ${esc(to)} • ${esc(fmtDate(g.created_at))}</div></div></div>${msg}</div><div class="nc-gift-item-side"><span class="nc-gift-status ${statusCls(g.status)}">${esc(statusLabel(g.status))}</span>${revokeBtn}</div></article>`; }).join('')}</div>` : '<div class="nc-gift-empty">Пока пусто. Отправленные подписки будут видны здесь.</div>'}`;
        }

        page.querySelectorAll('button[data-claim]').forEach(btn=>{
          btn.onclick = async ()=>{
            try{
              btn.disabled = true;
              const claimOut = await api(`/api/billing/gifts/${btn.getAttribute('data-claim')}/claim`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
              if (claimOut && claimOut.billing){
                try{ window.NC_BILLING = Object.assign({}, window.NC_BILLING||{}, { me: claimOut.billing, ts: Date.now() }); }catch(_e){}
                try{ window.dispatchEvent(new CustomEvent('nc:billing-updated', { detail: (window.NC_BILLING || {}) })); }catch(_e){}
              }
              toast('Подарок активирован ✅');
              try{ window.dispatchEvent(new CustomEvent('nc:billing-refresh')); }catch(_e){}
              load();
            }catch(err){
              btn.disabled = false;
              toast(err.message||String(err));
            }
          };
        });
        page.querySelectorAll('button[data-revoke]').forEach(btn=>{
          btn.onclick = async ()=>{ try{ btn.disabled=true; await api(`/api/billing/gifts/${btn.getAttribute('data-revoke')}/revoke`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }); toast('Подарок отозван'); load(); }catch(err){ btn.disabled=false; toast(err.message||String(err)); } };
        });
      }catch(err){
        if(received) received.innerHTML = `<div class="nc-bill-error">${esc(err.message||err)}</div>`;
        if(given) given.innerHTML = `<div class="nc-bill-error">${esc(err.message||err)}</div>`;
      }
    }
    if(btnRefresh) btnRefresh.onclick = load;
    load();
  }

  function hookGiftButton(){
    const btn = document.getElementById('btn-gift');
    if (!btn || btn.dataset.ncGiftBound === '1') return;
    btn.dataset.ncGiftBound = '1';
    // capture to override main.js "soon" toast
    btn.addEventListener('click', function(e){
      try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }catch(_e){}
      open();
    }, true);
  }

  function injectSettingsCard(){
    return;
  }


  function hookGiftLanding(){
    const claim = document.getElementById('gift-claim-btn');
    if (claim && claim.dataset.ncBound !== '1'){
      claim.dataset.ncBound = '1';
      claim.addEventListener('click', async ()=>{
        const code = claim.getAttribute('data-gift-code') || '';
        if (!code) return;
        claim.disabled = true;
        try{
          await api('/api/billing/gifts/redeem', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code }) });
          toast('Подарок активирован ✅');
          try{ window.location.href = '/chat'; }catch(e){}
        }catch(err){
          claim.disabled = false;
          toast(err.message || String(err));
        }
      });
    }

    const copy = document.getElementById('gift-copy-code');
    if (copy && copy.dataset.ncBound !== '1'){
      copy.dataset.ncBound = '1';
      copy.addEventListener('click', async ()=>{
        const code = copy.getAttribute('data-gift-code') || '';
        try{ await navigator.clipboard.writeText(code); toast('Скопировано'); }catch(e){ toast('Не смог скопировать'); }
      });
    }
  }

  function boot(){
    hookGiftButton();
    injectSettingsCard();
    hookGiftLanding();
    try{ renderSettingsGiftInventory(); }catch(e){}

    window.addEventListener('nc:billing-updated', ()=>{ injectSettingsCard(); try{ renderSettingsGiftInventory(); }catch(e){} });
    window.addEventListener('nc:gifts-refresh', ()=>{ try{ renderSettingsGiftInventory(); }catch(e){}; }, {passive:true});
    window.addEventListener('nc:billing-refresh', ()=>{
      try{ if (typeof fetch === 'function') api('/api/billing/me').then(()=>{}).catch(()=>{}); }catch(e){}
      try{ renderSettingsGiftInventory(); }catch(e){}
    });
    window.addEventListener('nc:settings-page-changed', (ev)=>{
      if (!ev || !ev.detail || ev.detail.page !== 'gifts') return;
      setTimeout(()=>{ try{ renderSettingsGiftInventory(); }catch(e){} }, 0);
      setTimeout(()=>{ try{ renderSettingsGiftInventory(); }catch(e){} }, 120);
    });
    document.addEventListener('click', (ev)=>{
      const btn = ev.target && ev.target.closest ? ev.target.closest('.nc-settings-item[data-page="gifts"], #nc-gift-open-settings-inv') : null;
      if (!btn) return;
      setTimeout(()=>{ try{ renderSettingsGiftInventory(); }catch(e){} }, 0);
      setTimeout(()=>{ try{ renderSettingsGiftInventory(); }catch(e){} }, 120);
    }, true);

    let t=0;
    const it = setInterval(()=>{
      hookGiftButton();
      injectSettingsCard();
      hookGiftLanding();
      t++;
      if (t>6) clearInterval(it);
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // public API
  try{ window.NC_GIFTS = { open }; }catch(e){}
})();


/* Fix265: Gift cards in chat messages (Discord-like) + one-click redeem.
   Lightweight: no heavy filters, only small shadows/glow.
*/
(function(){
  'use strict';

  const CODE_RE = /(NCGIFT-[A-Za-z0-9]{10,})/i;
  const CODE_RE_G = /(NCGIFT-[A-Za-z0-9]{10,})/ig;
  const URL_CODE_RE = /\/gift\/(NCGIFT-[A-Za-z0-9]{10,})/i;

  const cache = new Map(); // code -> { promise?, data?, ts }

  function toast(msg){
    try{ (window.ncToast || window.toast || window.NCToast || console.log)(String(msg||'')); }catch(e){ try{ console.log(String(msg||'')); }catch(_e){} }
  }

  async function api(url, opts){
    const res = await fetch(url, Object.assign({ credentials:'same-origin' }, opts||{}));
    let data = null;
    try{ data = await res.json(); }catch(e){ data = null; }
    if (!res.ok){
      const err = (data && (data.error || data.message)) ? (data.error || data.message) : ('HTTP '+res.status);
      const ex = new Error(err);
      ex.status = res.status;
      ex.data = data;
      throw ex;
    }
    return data;
  }

  function normalizeCode(raw){
    const s = String(raw||'').trim();
    const m = s.match(CODE_RE);
    return m ? String(m[1]) : '';
  }

  function extractCodesFromText(text){
    const out = new Set();
    const s = String(text||'');
    let m;
    while((m = CODE_RE_G.exec(s))){
      out.add(String(m[1]));
      if (out.size >= 2) break;
    }
    return Array.from(out);
  }

  function extractCodesFromLinks(row){
    const out = new Set();
    const as = row.querySelectorAll('a[href]');
    as.forEach(a=>{
      const href = String(a.getAttribute('href')||'');
      const m = href.match(URL_CODE_RE);
      if (m && m[1]) out.add(String(m[1]));
    });
    return Array.from(out);
  }

  function isGiftOnlyMessage(text){
    const t = String(text||'').trim();
    if (!t) return false;
    // Only link/code + optional small prefix.
    const re = /^\s*(?:🎁\s*)?(?:Подарок\s+подписки:\s*)?(?:Активируй:\s*)?(?:(?:https?:\/\/[^\s]*\/gift\/(NCGIFT-[A-Za-z0-9]{10,}))|(?:\/gift\/(NCGIFT-[A-Za-z0-9]{10,}))|(?:(NCGIFT-[A-Za-z0-9]{10,})))\s*$/i;
    return re.test(t);
  }

  async function getPreview(code){
    code = normalizeCode(code);
    if (!code) return null;
    const hit = cache.get(code);
    if (hit && hit.data) return hit.data;
    if (hit && hit.promise) return hit.promise;

    const p = (async ()=>{
      try{
        const out = await api('/api/billing/gifts/preview?code=' + encodeURIComponent(code));
        return out;
      }catch(e){
        return { error: true, message: e && e.message ? e.message : 'preview failed' };
      }
    })();

    cache.set(code, { promise: p, ts: Date.now() });
    const data = await p;
    cache.set(code, { data, ts: Date.now() });
    return data;
  }

  function formatExpires(iso){
    try{
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yy = d.getFullYear();
      return dd + '.' + mm + '.' + yy;
    }catch(e){ return ''; }
  }

  function ensureEmbedWrap(body){
    let wrap = body.querySelector('.msg-gift-embeds');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.className = 'msg-gift-embeds';

    const before = body.querySelector('.msg-link-previews') || body.querySelector('.msg-attachments');
    if (before) body.insertBefore(wrap, before);
    else body.appendChild(wrap);

    return wrap;
  }

  function removeDefaultGiftLinkPreviews(row, codes){
    try{
      const set = new Set(codes||[]);
      const wrap = row.querySelector('.msg-link-previews');
      if (!wrap) return;
      // Remove any preview blocks that point to /gift/NCGIFT-...
      wrap.querySelectorAll('a[href]').forEach(a=>{
        const href = String(a.getAttribute('href')||'');
        const m = href.match(URL_CODE_RE);
        if (!m || !m[1]) return;
        const code = String(m[1]);
        if (!set.has(code)) return;
        // remove closest card/container
        const card = a.closest('.msg-link-media, .msg-link-preview') || a;
        try{ card.remove(); }catch(e){ try{ a.remove(); }catch(_e){} }
      });
      // If empty, remove wrapper to avoid spacing.
      if (!wrap.childNodes.length) {
        try{ wrap.remove(); }catch(e){}
      }
    }catch(e){}
  }

  function buildGiftCardSkeleton(code){
    const card = document.createElement('div');
    card.className = 'msg-gift-card is-loading';
    card.dataset.giftCode = code;

    card.innerHTML = `
      <div class="msg-gift-cover" aria-hidden="true">
        <div class="msg-gift-cover-badge">ПОДАРОК</div>
        <div class="msg-gift-cover-text">
          <div class="msg-gift-cover-plan">Подписка</div>
          <div class="msg-gift-cover-sub">Загрузка…</div>
        </div>
      </div>
      <div class="msg-gift-top">
        <div class="msg-gift-ico">🎁</div>
        <div class="msg-gift-meta">
          <div class="msg-gift-title">Подарок подписки</div>
          <div class="msg-gift-sub">Загрузка…</div>
        </div>
        <a class="msg-gift-open" href="/gift/${code}" target="_blank" rel="noopener">Открыть</a>
      </div>
      <div class="msg-gift-actions">
        <button type="button" class="msg-gift-btn primary" disabled>Активировать</button>
      </div>
      <div class="msg-gift-foot">Код: <span class="msg-gift-code">${code}</span></div>
    `;

    return card;
  }

  function setCardState(card, st){
    const sub = card.querySelector('.msg-gift-sub');
    const btn = card.querySelector('.msg-gift-btn');
    const foot = card.querySelector('.msg-gift-foot');
    const title = card.querySelector('.msg-gift-title');

    const gift = st && st.gift;
    const flags = st && st.flags;

    const planName = gift && gift.plan && (gift.plan.name || gift.plan.code) ? (gift.plan.name || gift.plan.code) : 'Подписка';
    const days = gift && gift.plan && gift.plan.period_days ? Number(gift.plan.period_days) : 0;
    const fromName = gift && gift.from && (gift.from.display_name || gift.from.username) ? (gift.from.display_name || gift.from.username) : '';

    let line = planName;
    if (days) line += ` • ${days} дн.`;
    if (fromName) line += ` • от ${fromName}`;

    let extra = '';
    const ex = gift && gift.expires_at ? formatExpires(gift.expires_at) : '';
    if (ex) extra = `Истекает: ${ex}`;

    if (sub) sub.textContent = line + (extra ? (' — ' + extra) : '');

    // Cover texts (Nitro-like header)
    try{
      const cPlan = card.querySelector('.msg-gift-cover-plan');
      const cSub  = card.querySelector('.msg-gift-cover-sub');
      const cBadge= card.querySelector('.msg-gift-cover-badge');
      if (cPlan) cPlan.textContent = planName + (days ? (' • ' + days + ' дн.') : '');
      const parts = [];
      if (fromName) parts.push('от ' + fromName);
      if (ex) parts.push('до ' + ex);
      if (cSub) cSub.textContent = parts.length ? parts.join(' • ') : 'Активируй, чтобы получить';
      if (cBadge) cBadge.textContent = 'ПОДАРОК';
    }catch(e){}

    // Optional personal message
    try{
      const msg = gift && gift.message ? String(gift.message).trim() : '';
      let msgEl = card.querySelector('.msg-gift-note');
      if (msg){
        if (!msgEl){
          msgEl = document.createElement('div');
          msgEl.className = 'msg-gift-note';
          card.insertBefore(msgEl, card.querySelector('.msg-gift-actions'));
        }
        msgEl.textContent = msg;
      }else if (msgEl){
        msgEl.remove();
      }
    }catch(e){}

    // Button logic
    if (btn){
      btn.disabled = true;
      btn.textContent = 'Активировать';
      btn.classList.remove('danger');
    }

    const status = gift && gift.status ? String(gift.status) : '';
    const can = !!(flags && flags.can_redeem);
    const reason = flags && flags.reason ? String(flags.reason) : '';

    card.classList.remove('is-loading','is-redeemed','is-expired','is-revoked','is-denied');

    if (status === 'redeemed') {
      card.classList.add('is-redeemed');
      if (btn){ btn.disabled = true; btn.textContent = 'Активировано'; }
      if (title) title.textContent = 'Подарок активирован';
      try{
        const cBadge= card.querySelector('.msg-gift-cover-badge');
        const cSub  = card.querySelector('.msg-gift-cover-sub');
        if (cBadge) cBadge.textContent = 'АКТИВИРОВАНО';
        if (cSub) cSub.textContent = 'Подписка применена';
      }catch(e){}

    } else if (status === 'expired') {
      card.classList.add('is-expired');
      if (btn){ btn.disabled = true; btn.textContent = 'Истёк'; }
      if (title) title.textContent = 'Подарок недоступен';
      try{
        const cBadge= card.querySelector('.msg-gift-cover-badge');
        const cSub  = card.querySelector('.msg-gift-cover-sub');
        if (cBadge) cBadge.textContent = 'ИСТЁК';
        if (cSub) cSub.textContent = 'Подарок больше недоступен';
      }catch(e){}

    } else if (status === 'revoked') {
      card.classList.add('is-revoked');
      if (btn){ btn.disabled = true; btn.textContent = 'Отозван'; }
      if (title) title.textContent = 'Подарок отозван';
      try{
        const cBadge= card.querySelector('.msg-gift-cover-badge');
        const cSub  = card.querySelector('.msg-gift-cover-sub');
        if (cBadge) cBadge.textContent = 'ОТОЗВАН';
        if (cSub) cSub.textContent = 'Отправитель отозвал подарок';
      }catch(e){}

    } else if (!can) {
      card.classList.add('is-denied');
      if (btn){ btn.disabled = true; btn.textContent = reason || 'Недоступно'; }
      if (title) title.textContent = 'Подарок подписки';
      try{
        const cBadge= card.querySelector('.msg-gift-cover-badge');
        const cSub  = card.querySelector('.msg-gift-cover-sub');
        if (cBadge) cBadge.textContent = 'НЕДОСТУПНО';
        if (cSub) cSub.textContent = reason || 'Этот подарок нельзя активировать';
      }catch(e){}

    } else {
      if (btn){ btn.disabled = false; btn.textContent = 'Активировать'; }
      if (title) title.textContent = 'Подарок подписки';
    }

    // Footline: hide code for non-monospace overload? Keep but shorten.
    try{
      if (foot){
        const short = codeShort(card.dataset.giftCode || '');
        foot.innerHTML = `Код: <span class="msg-gift-code">${short}</span>`;
      }
    }catch(e){}
  }

  function codeShort(code){
    const c = String(code||'');
    if (c.length <= 16) return c;
    return c.slice(0, 10) + '…' + c.slice(-6);
  }

  async function wireCard(card){
    const code = normalizeCode(card.dataset.giftCode || '');
    if (!code) return;

    const btn = card.querySelector('.msg-gift-btn');

    const st = await getPreview(code);
    if (st && st.error){
      card.classList.remove('is-loading');
      const sub = card.querySelector('.msg-gift-sub');
      if (sub) sub.textContent = 'Не удалось загрузить превью';
      if (btn){ btn.disabled = true; btn.textContent = 'Недоступно'; }
      return;
    }

    setCardState(card, st);

    if (btn && !(btn.dataset.ncBound === '1')){
      btn.dataset.ncBound = '1';
      btn.addEventListener('click', async ()=>{
        try{
          btn.disabled = true;
          btn.textContent = 'Активируем…';
          await api('/api/billing/gifts/redeem', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ code })
          });
          toast('Подарок активирован ✅');
          card.classList.add('is-redeemed');
          btn.textContent = 'Активировано';
          btn.disabled = true;
          // Refresh billing widgets if any
          try{ window.dispatchEvent(new CustomEvent('nc:billing-refresh')); }catch(e){}
          // Update preview cache
          try{ cache.delete(code); }catch(e){}
        }catch(e){
          const msg = (e && e.message) ? e.message : 'Ошибка активации';
          toast(msg);
          btn.disabled = false;
          btn.textContent = 'Активировать';
          // Try to refresh state after failure
          try{ cache.delete(code); }catch(_e){}
          try{ const st2 = await getPreview(code); setCardState(card, st2); }catch(_e){}
        }
      });
    }
  }

  function enhanceRow(row){
    try{
      if (!row || !(row instanceof Element)) return;
      if (row.dataset.ncGiftCardsDone === '1') return;

      const body = row.querySelector('.msg-body');
      if (!body) return;

      const bubble = body.querySelector('.msg-bubble');
      const text = bubble ? (bubble.textContent || '') : '';

      const codes = new Set();
      extractCodesFromLinks(row).forEach(c=>codes.add(c));
      extractCodesFromText(text).forEach(c=>codes.add(c));

      const list = Array.from(codes);
      if (!list.length) { row.dataset.ncGiftCardsDone = '1'; return; }

      // Remove default link previews for gifts
      removeDefaultGiftLinkPreviews(row, list);

      // If message is only a gift code/link: hide bubble to make it look like a pure card embed.
      try{
        if (bubble && isGiftOnlyMessage(text)){
          bubble.classList.add('is-empty');
          bubble.style.display = 'none';
        }
      }catch(e){}

      const wrap = ensureEmbedWrap(body);

      list.slice(0,1).forEach((code)=>{
        if (wrap.querySelector(`.msg-gift-card[data-gift-code="${code}"]`)) return;
        const card = buildGiftCardSkeleton(code);
        wrap.appendChild(card);
        wireCard(card);
      });

      row.dataset.ncGiftCardsDone = '1';
    }catch(e){
      try{ row.dataset.ncGiftCardsDone = '1'; }catch(_e){}
    }
  }

  function boot(){
    const messages = document.getElementById('messages') || document.querySelector('#messages');
    if (!messages) return false;

    // Initial pass
    try{ messages.querySelectorAll('.msg-row').forEach(enhanceRow); }catch(e){}

    // Observe new messages
    const mo = new MutationObserver((mutList)=>{
      for (const m of mutList){
        if (!m.addedNodes) continue;
        m.addedNodes.forEach(n=>{
          if (!(n instanceof Element)) return;
          if (n.classList && n.classList.contains('msg-row')) enhanceRow(n);
          else {
            const r = n.querySelector && n.querySelector('.msg-row');
            if (r) enhanceRow(r);
          }
        });
      }
    });
    try{ mo.observe(messages, { childList:true, subtree:false }); }catch(e){}

    return true;
  }

  function start(){
    // retry a few times because chat boot may be async
    let tries = 0;
    const tick = ()=>{
      tries++;
      if (boot()) return;
      if (tries < 30) setTimeout(tick, 250);
    };
    tick();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
