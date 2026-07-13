/* Semantic script */

(function(){
  const state = { loading:false, plans:null, me:null };
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');


  const FALLBACK_PLANS = [
    {
      code:'free',
      name:'Free',
      description:'Стартовый аккаунт для чатов, звонков и подарков',
      price_minor:0,
      currency:'RUB',
      period_days:30,
      badge:'FREE',
      features:{ max_upload_mb:25, hd_stream:false, stream_1080p:false, stream_60fps:false, stream_1440p:false, profile_badge:false, name_styles:false, avatar_decor:false, theme_packs_basic:false, badge_showcase:false, pro_effects:false }
    },
    {
      code:'plus',
      name:'NEON Plus',
      description:'Средний пакет: 1080p-демка, кастомизация профиля и повышенные лимиты',
      price_minor:29900,
      currency:'RUB',
      period_days:30,
      badge:'PLUS',
      features:{ max_upload_mb:100, hd_stream:true, stream_1080p:true, stream_60fps:false, stream_1440p:false, profile_badge:true, name_styles:true, avatar_decor:true, theme_packs_basic:true, badge_showcase:false, pro_effects:false }
    },
    {
      code:'pro',
      name:'NEON Pro',
      description:'Максимум Neon: 60 FPS, полный набор эффектов и самые большие лимиты',
      price_minor:59900,
      currency:'RUB',
      period_days:30,
      badge:'PRO',
      features:{ max_upload_mb:500, hd_stream:true, stream_1080p:true, stream_60fps:true, stream_1440p:true, profile_badge:true, name_styles:true, avatar_decor:true, theme_packs_basic:true, badge_showcase:true, pro_effects:true }
    }
  ];

  function logoForPlan(code){
    code = String(code || '').toLowerCase();
    if (code === 'pro') return '/static/img/neon_pro_logo.svg';
    if (code === 'plus') return '/static/img/neon_plus_logo.svg';
    if (code === 'free') return '/static/img/neon_free_logo.svg';
    return '/static/img/neon_free_logo.svg';
  }
  function planTone(code){
    code = String(code || '').toLowerCase();
    if (code === 'pro') return 'is-pro';
    if (code === 'plus') return 'is-plus';
    return 'is-free';
  }

  const PLAN_RANK = { free:0, plus:1, pro:2 };
  const RENEW_REMINDER_SNOOZE_KEY = 'nc_bill_renew_reminder_snooze_until';
  const RENEW_REMINDER_HIDE_YEAR_KEY = 'nc_bill_renew_reminder_hide_year_until';
  const RENEW_REMINDER_CLOSE_KEY = 'nc_bill_renew_reminder_close_until';
  function planRank(code){ return PLAN_RANK[String(code || '').toLowerCase()] ?? 0; }
  function isDowngradePlan(targetCode){
    const current = String(currentPlanCode() || 'free').toLowerCase();
    const target = String(targetCode || 'free').toLowerCase();
    if (current === 'free') return false;
    return planRank(target) < planRank(current);
  }
  function endDateMs(){
    const raw = state && state.me && state.me.current_period_end;
    if (!raw) return 0;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }
  function canShowRenewReminder(){
    if (String(currentPlanCode() || 'free').toLowerCase() === 'free') return false;
    if (!state.me || state.me.cancel_at_period_end) return false;
    const endMs = endDateMs();
    if (!endMs) return false;
    const now = Date.now();
    const diff = endMs - now;
    if (diff <= 0 || diff > (3 * 24 * 60 * 60 * 1000)) return false;
    try{
      const hiddenYear = Number(localStorage.getItem(RENEW_REMINDER_HIDE_YEAR_KEY) || 0);
      const snoozeUntil = Number(localStorage.getItem(RENEW_REMINDER_SNOOZE_KEY) || 0);
      const closeUntil = Number(localStorage.getItem(RENEW_REMINDER_CLOSE_KEY) || 0);
      if (hiddenYear > now || snoozeUntil > now || closeUntil > now) return false;
    }catch(_){ }
    if (document.getElementById('nc-bill-action-modal')) return false;
    return true;
  }
  function setSettingsBlocked(blocked){
    try{
      const overlay = document.getElementById('nc-settings-overlay');
      if (!overlay) return;
      overlay.classList.toggle('nc-bill-settings-blocked', !!blocked);
      if ('inert' in overlay) overlay.inert = !!blocked;
      if (blocked){
        overlay.setAttribute('aria-hidden', 'true');
      } else {
        overlay.removeAttribute('aria-hidden');
      }
    }catch(_){ }
  }
  function closeActionModal(){
    const el = document.getElementById('nc-bill-action-modal');
    if (el) el.remove();
    try{ document.body.classList.remove('nc-bill-modal-open'); }catch(_){ }
    setSettingsBlocked(false);
  }

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
  function totalMinor(plan, months){
    return Math.max(0, Number((plan && plan.price_minor) || 0)) * clampMonths(months, 1);
  }
  function durationPickerHtml(plan, selected, opts){
    const options = opts || {};
    const planObj = normalizePlan(plan || {});
    const months = clampMonths(selected, 1);
    return `
      <div class="nc-bill-duration-box" data-duration-picker data-price-minor="${esc(planObj.price_minor || 0)}" data-currency="${esc(planObj.currency || 'RUB')}">
        ${options.caption ? `<div class="nc-bill-duration-caption">${esc(options.caption)}</div>` : ''}
        <div class="nc-bill-duration-grid">
          ${Array.from({ length:12 }, (_, idx) => {
            const m = idx + 1;
            return `<button type="button" class="nc-bill-duration-chip ${m === months ? 'is-active' : ''}" data-duration-month="${m}">${m}</button>`;
          }).join('')}
        </div>
        <div class="nc-bill-duration-total">
          <span class="nc-bill-duration-total__label">Срок: <strong data-duration-label>${esc(monthsText(months))}</strong></span>
          <span class="nc-bill-duration-total__price" data-duration-total>${esc(Number(planObj.price_minor || 0) > 0 ? rub(totalMinor(planObj, months), planObj.currency) : 'Бесплатно')}</span>
        </div>
        ${options.note ? `<div class="nc-bill-duration-note">${options.note}</div>` : ''}
      </div>`;
  }
  function syncDurationPicker(root){
    const host = root && root.querySelector ? root.querySelector('[data-duration-picker]') : null;
    if (!host) return 1;
    const active = host.querySelector('[data-duration-month].is-active') || host.querySelector('[data-duration-month="1"]');
    const months = clampMonths(active && active.getAttribute('data-duration-month'), 1);
    const totalEl = host.querySelector('[data-duration-total]');
    const labelEl = host.querySelector('[data-duration-label]');
    const priceMinor = Number(host.getAttribute('data-price-minor') || 0);
    const currency = host.getAttribute('data-currency') || 'RUB';
    if (labelEl) labelEl.textContent = monthsText(months);
    if (totalEl) totalEl.textContent = priceMinor > 0 ? rub(priceMinor * months, currency) : 'Бесплатно';
    return months;
  }
  function getDurationFromModal(root, fallback){
    const host = root && root.querySelector ? root.querySelector('[data-duration-picker]') : null;
    if (!host) return clampMonths(fallback, 1);
    const active = host.querySelector('[data-duration-month].is-active') || host.querySelector('[data-duration-month="1"]');
    return clampMonths(active && active.getAttribute('data-duration-month'), fallback || 1);
  }
  function openActionModal(opts){
    closeActionModal();
    const options = opts || {};
    const root = document.createElement('div');
    root.className = 'nc-bill-action-modal';
    root.id = 'nc-bill-action-modal';
    root.innerHTML = `
      <div class="nc-bill-action-modal__backdrop"></div>
      <div class="nc-bill-action-modal__dialog ${esc(options.tone || '')}" role="dialog" aria-modal="true" aria-label="${esc(options.title || 'Уведомление')}" tabindex="-1">
        <button class="nc-bill-action-modal__close" type="button" aria-label="Закрыть">×</button>
        ${options.kicker ? `<div class="nc-bill-action-modal__kicker">${esc(options.kicker)}</div>` : ''}
        <h3>${esc(options.title || 'Уведомление')}</h3>
        ${options.text ? `<div class="nc-bill-action-modal__text">${esc(options.text)}</div>` : ''}
        ${options.html ? `<div class="nc-bill-action-modal__html">${options.html}</div>` : ''}
        <div class="nc-bill-action-modal__actions">
          ${(options.buttons || []).map((btn, idx) => `<button type="button" class="nc-bill-btn ${btn.primary ? 'primary' : ''} ${btn.warn ? 'warn' : ''}" data-modal-action="${esc(btn.action || '')}" data-modal-idx="${idx}">${esc(btn.label || 'Ок')}</button>`).join('')}
        </div>
      </div>`;
    const host = document.body || document.documentElement;
    host.appendChild(root);
    const dialog = root.querySelector('.nc-bill-action-modal__dialog');
    const backdrop = root.querySelector('.nc-bill-action-modal__backdrop');
    const closeBtn = root.querySelector('.nc-bill-action-modal__close');
    const stopAll = function(ev){ ev.stopPropagation(); };
    try{
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.zIndex = '2147483647';
      root.style.pointerEvents = 'auto';
    }catch(_){ }
    try{
      if (dialog){
        dialog.style.position = 'relative';
        dialog.style.zIndex = '2';
        dialog.style.pointerEvents = 'auto';
        dialog.style.overflow = 'visible';
        dialog.style.transform = 'translateZ(0)';
      }
      if (closeBtn){
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '14px';
        closeBtn.style.right = '14px';
        closeBtn.style.left = 'auto';
        closeBtn.style.bottom = 'auto';
        closeBtn.style.zIndex = '6';
        closeBtn.style.pointerEvents = 'auto';
      }
      root.querySelectorAll('[data-duration-month], [data-modal-action]').forEach(function(el){
        el.style.position = 'relative';
        el.style.zIndex = '5';
        el.style.pointerEvents = 'auto';
      });
    }catch(_){ }
    const safeDismiss = function(reason){
      closeActionModal();
      if (typeof options.onDismiss === 'function') options.onDismiss(reason || 'close');
    };
    const runAction = function(action){
      let shouldClose = true;
      if (typeof options.onAction === 'function') shouldClose = options.onAction(action, root);
      if (shouldClose && typeof shouldClose.then === 'function'){
        shouldClose.then(function(value){ if (value !== false) closeActionModal(); }).catch(function(err){ try{ console.error(err); }catch(_e){} });
        return;
      }
      if (shouldClose !== false) closeActionModal();
    };
    if (dialog){
      ['click','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend'].forEach(function(type){
        dialog.addEventListener(type, stopAll, true);
      });
    }
    const delegatedModalHandle = function(ev){
      const target = ev.target && ev.target.closest ? ev.target.closest('.nc-bill-action-modal__close, [data-duration-month], [data-modal-action], .nc-bill-action-modal__backdrop') : null;
      if (!target || !root.contains(target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (target.classList.contains('nc-bill-action-modal__close')) return safeDismiss('close');
      if (target.classList.contains('nc-bill-action-modal__backdrop')) return safeDismiss('backdrop');
      if (target.hasAttribute('data-duration-month')){
        const pickerHost = target.closest('[data-duration-picker]');
        if (pickerHost){
          pickerHost.querySelectorAll('[data-duration-month]').forEach(function(chip){ chip.classList.toggle('is-active', chip === target); });
          syncDurationPicker(root);
        }
        return;
      }
      if (target.hasAttribute('data-modal-action')) return runAction(target.getAttribute('data-modal-action') || '');
    };
    ['click','pointerdown','mousedown','touchstart'].forEach(function(type){
      root.addEventListener(type, delegatedModalHandle, true);
    });
    try{ document.body.classList.add('nc-bill-modal-open'); }catch(_){ }
    setSettingsBlocked(true);
    syncDurationPicker(root);
    try{ dialog && dialog.focus({ preventScroll:true }); }catch(_){ }
    return root;
  }

  function rememberRenewReminder(action){
    const now = Date.now();
    try{
      if (action === 'month') localStorage.setItem(RENEW_REMINDER_SNOOZE_KEY, String(now + (30 * 24 * 60 * 60 * 1000)));
      else if (action === 'year') localStorage.setItem(RENEW_REMINDER_HIDE_YEAR_KEY, String(now + (365 * 24 * 60 * 60 * 1000)));
      else localStorage.setItem(RENEW_REMINDER_CLOSE_KEY, String(now + (12 * 60 * 60 * 1000)));
    }catch(_){ }
  }
  function maybeOpenRenewReminder(){
    if (!canShowRenewReminder()) return;
    const whenText = fmtDate(state.me && state.me.current_period_end);
    openActionModal({
      kicker:'Автопродление',
      title:'Скоро спишется продление подписки',
      text:`У вас включено автопродление ${normalizePlan(state.me && state.me.plan).name}. Следующее продление запланировано до ${whenText}.`,
      html:`<div class="nc-bill-reminder-note">Если хотите остановить продление, откройте настройки подписки и выключите автопродление заранее.</div>`,
      buttons:[
        { action:'month', label:'Напомни через месяц' },
        { action:'manage', label:'Перейти в настройки' },
        { action:'close', label:'Закрыть' },
        { action:'year', label:'Отключить на год' }
      ],
      onAction:function(action){
        if (action === 'manage'){
          navTo('subscriptions');
          rememberRenewReminder('close');
          return;
        }
        if (action === 'month') return rememberRenewReminder('month');
        if (action === 'year') return rememberRenewReminder('year');
        rememberRenewReminder('close');
      },
      onDismiss:function(){ rememberRenewReminder('close'); }
    });
  }
  function openCancelConfirmModal(){
    const plan = normalizePlan(state.me && state.me.plan);
    openActionModal({
      kicker:'Подтверждение',
      title:'Точно ли вы хотите отменить подписку?',
      text:`Подписка ${plan.name} останется активной до конца оплаченного периода, но автопродление будет выключено.`,
      html:'<div class="nc-bill-reminder-note">После окончания периода аккаунт автоматически вернётся на Free, если вы не включите автопродление снова.</div>',
      buttons:[
        { action:'no', label:'Нет' },
        { action:'yes', label:'Да', warn:true }
      ],
      onAction:function(action){
        if (action === 'yes') return performAction('cancel');
      }
    });
  }
  function openDowngradeModal(targetCode){
    const current = normalizePlan(state.me && state.me.plan);
    const target = normalizePlan((state.plans || FALLBACK_PLANS).find(function(p){ return String(p.code || '').toLowerCase() === String(targetCode || '').toLowerCase(); }) || { code: targetCode });
    const autoRenewOn = !!(state.me && !state.me.cancel_at_period_end);
    const msg = autoRenewOn
      ? `Сейчас у вас активен ${current.name}. Перейти на тариф ниже (${target.name}) до окончания текущего периода нельзя.`
      : `Сейчас у вас ещё активен ${current.name}. Когда оплаченный период закончится, аккаунт автоматически вернётся на Free.`;
    const note = autoRenewOn
      ? 'Вы можете выключить автопродление и дождаться окончания периода, либо оставить текущий тариф и продлить его.'
      : 'После возврата на Free вы сможете оформить любой тариф заново.';
    openActionModal({
      kicker:'Тариф ниже недоступен',
      title:'Нельзя перейти на подписку ниже',
      text:msg,
      html:`<div class="nc-bill-reminder-note">${esc(note)}</div>`,
      buttons:autoRenewOn
        ? [
            { action:'manage', label:'Перейти в настройки', primary:true },
            { action:'close', label:'Понятно' }
          ]
        : [
            { action:'plans', label:'К тарифам', primary:true },
            { action:'close', label:'Понятно' }
          ],
      onAction:function(action){
        if (action === 'manage') return navTo('subscriptions');
        if (action === 'plans') return scrollToPlans();
      }
    });
  }
  function openResumeConfirmModal(){
    const plan = normalizePlan(state.me && state.me.plan);
    const currentMonths = clampMonths(state.me && state.me.renew_months, 1);
    openActionModal({
      kicker:'Автопродление',
      title:'Включить автопродление?',
      text:`${plan.name} будет продлеваться автоматически на выбранный срок, пока вы снова не отключите автопродление.`,
      html: durationPickerHtml(plan, currentMonths, {
        caption:'Срок каждого следующего продления',
        note:'Выберите, на сколько месяцев будет продлеваться ваш текущий тариф.'
      }) + '<div class="nc-bill-reminder-note">После включения автопродления следующий платёж будет списан автоматически в конце текущего периода.</div>',
      buttons:[
        { action:'close', label:'Не сейчас' },
        { action:'enable', label:'Включить автопродление', primary:true }
      ],
      onAction:function(action, root){
        if (action !== 'enable') return true;
        const renewMonths = getDurationFromModal(root, currentMonths);
        return performAction('resume', '', { renew_months: renewMonths });
      }
    });
  }

  function openPurchaseModal(action, planCode){
    const list = (state.plans && state.plans.length ? state.plans : FALLBACK_PLANS);
    const plan = normalizePlan(list.find(function(p){ return String(p.code || '').toLowerCase() === String(planCode || '').toLowerCase(); }) || { code: planCode });
    const primaryLabel = action === 'checkout' ? 'Перейти к оплате' : 'Купить';
    openActionModal({
      kicker:'Тариф и оплата',
      title: plan.name || 'Подписка',
      text:'Выберите срок подписки от 1 до 12 месяцев. Чем больше срок, тем больше итоговая сумма.',
      html: durationPickerHtml(plan, 1, {
        caption:'На сколько оформить подписку',
        note:'Автопродление для этой покупки будет включено на такой же срок. Позже его можно отключить или изменить в настройках.'
      }),
      buttons:[
        { action:'close', label:'Закрыть' },
        { action:'confirm', label:primaryLabel, primary:true }
      ],
      onAction:function(modalAction, root){
        if (modalAction !== 'confirm') return true;
        const months = getDurationFromModal(root, 1);
        return performAction(action, plan.code, { duration_months: months });
      }
    });
  }

  function fallbackMe(){
    const current = (window.NC_BILLING && window.NC_BILLING.me) || {};
    const currentPlan = current.plan || {};
    const planCode = String(currentPlan.code || 'free').toLowerCase();
    const fallbackPlan = (FALLBACK_PLANS.find(p => p.code === planCode) || FALLBACK_PLANS[0]);
    return {
      provider: current.provider || 'mock',
      plan: Object.assign({}, fallbackPlan, currentPlan || {}),
      status: current.status || (planCode === 'free' ? 'free' : 'active'),
      cancel_at_period_end: !!current.cancel_at_period_end,
      started_at: current.started_at || null,
      current_period_start: current.current_period_start || null,
      current_period_end: current.current_period_end || null,
      renew_months: clampMonths(current.renew_months || 1, 1),
      features: Object.assign({}, fallbackPlan.features || {}, current.features || {}),
      payments: Array.isArray(current.payments) ? current.payments : []
    };
  }
  function seedState(){
    if (!Array.isArray(state.plans) || !state.plans.length) state.plans = FALLBACK_PLANS.slice();
    if (!state.me) state.me = fallbackMe();
  }

  function rub(minor, currency){
    const n = Number(minor||0)/100;
    if ((currency||'RUB') === 'RUB') return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(n);
    return `${n.toFixed(2)} ${(currency||'').toUpperCase()}`;
  }
  function fmtDate(iso){
    if(!iso) return '—';
    try{
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    }catch(_){ return iso; }
  }
  async function api(url, opts){
    const res = await fetch(url, Object.assign({ credentials:'same-origin' }, opts||{}));
    let data = {};
    try{ data = await res.json(); }catch(_){ }
    if(!res.ok){ const err = new Error(data && data.error ? data.error : `HTTP ${res.status}`); err.status = res.status; err.payload = data || {}; throw err; }
    return data;
  }
  function navTo(page){
    const btn = document.querySelector(`.nc-settings-item[data-page="${page}"]`);
    if (btn) btn.click();
  }
  function setNavLabel(page, mainText, subText){
    $$(`.nc-settings-item[data-page="${page}"]`).forEach(el=>{
      let label = el.querySelector('.nc-settings-label');
      if (!label){
        label = document.createElement('span');
        label.className = 'nc-settings-label';
        Array.from(el.childNodes).forEach(node=>{
          if (node.nodeType === 3 || !(node.classList && node.classList.contains('nc-settings-ico'))) node.remove();
        });
        el.appendChild(label);
      }
      label.innerHTML = `<span class="nc-settings-label-main">${esc(mainText)}</span>${subText ? `<span class="nc-settings-label-sub">${esc(subText)}</span>` : ''}`;
    });
  }
  function mountPromoButtons(){
    const popPromo = $('#popout-promo-nitro');
    if (popPromo){
      popPromo.textContent = 'Подписаться на Neon';
      if (!popPromo.dataset.billBound){
        popPromo.dataset.billBound = '1';
        popPromo.addEventListener('click', function(e){ e.preventDefault(); navTo('subscriptions'); });
      }
    }
    setNavLabel('nitro', 'Neon', 'что даёт подписка');
    setNavLabel('subscriptions', 'Подписка', 'тарифы и управление');
    setNavLabel('gifts', 'Склад подарков', 'полученные и выданные');
    setNavLabel('billing', 'Платежи', 'история, статусы и чеки');
  }

  function screenShareLabel(plan){
    const f = (plan && plan.features) || {};
    if (f.stream_60fps) return 'До 1080p / 60 FPS';
    if (f.stream_1080p || f.hd_stream) return 'До 1080p / 30 FPS';
    return 'До 720p / 30 FPS';
  }
  function planPerks(plan){
    const f = (plan && plan.features) || {};
    const code = String(plan && plan.code || 'free').toLowerCase();
    const maxUpload = esc(f.max_upload_mb ?? 25);
    if (code === 'free'){
      return [
        `Загрузка файлов до ${maxUpload} МБ`,
        `Демонстрация экрана ${screenShareLabel(plan)}`,
        'Базовый профиль и обычный ник',
        'Получение и активация подарков'
      ];
    }
    const perks = [code === 'plus' ? 'Всё из Free' : 'Всё из NEON Plus'];
    perks.push(`Загрузка файлов до ${maxUpload} МБ`);
    perks.push(`Демонстрация экрана ${screenShareLabel(plan)}`);
    if (f.profile_badge) perks.push(code === 'pro' ? 'Профильный бейдж NEON Pro' : 'Профильный бейдж NEON Plus');
    if (f.name_styles) perks.push('Стили ника, градиенты и мини-теги');
    if (f.avatar_decor) perks.push('Украшения аватара и баннера');
    if (f.theme_packs_basic) perks.push(code === 'pro' ? 'Все пресеты профиля' : 'Базовые пресеты профиля');
    if (f.pro_effects) perks.push('Ауры, рамки, витрина значков и про-эффекты');
    return perks;
  }
  function featureLines(plan){
    return planPerks(plan);
  }
  function currentPlanCode(){ return state.me && state.me.plan && state.me.plan.code || 'free'; }
  function normalizePlan(plan){
    const code = String(plan && plan.code || 'free').toLowerCase();
    const fallback = FALLBACK_PLANS.find(p => p.code === code) || FALLBACK_PLANS[0];
    return Object.assign({}, fallback, plan || {}, { features:Object.assign({}, fallback.features || {}, (plan && plan.features) || {}) });
  }
  function currentPlanPerks(){
    const me = state.me || fallbackMe();
    return planPerks(normalizePlan(me.plan || {}));
  }
  function planSubtitle(code){
    code = String(code || '').toLowerCase();
    if (code === 'plus') return 'Средний пакет: 1080p, кастомизация и лимиты';
    if (code === 'pro') return 'Топ-план: 60 FPS, полный набор эффектов и максимум лимитов';
    return 'Базовый аккаунт без подписки';
  }
  function heroSummary(code){
    code = String(code || '').toLowerCase();
    if (code === 'plus') return 'NEON Plus — это 1080p / 30 FPS, профильный бейдж, стили ника и базовые Nitro-style пресеты.';
    if (code === 'pro') return 'NEON Pro даёт всё из Plus, 60 FPS для демки, продвинутые эффекты профиля и самые большие лимиты без серверных бустов.';
    return 'Free — это обычный аккаунт: чат, звонки, подарки и базовые лимиты без подписки.';
  }

  function planInfoLead(code){
    code = String(code || '').toLowerCase();
    if (code === 'plus') return 'Средний тариф для тех, кому уже мало Free: Full HD для демки, кастомизация профиля и повышенные лимиты.';
    if (code === 'pro') return 'Максимальный тариф: весь пакет Plus, 60 FPS для демки, редкие эффекты профиля и самые большие лимиты аккаунта.';
    return 'Базовый тариф без подписки: чат, звонки, подарки и стандартные лимиты для повседневного использования.';
  }
  function planStatusLabel(code){
    code = String(code || '').toLowerCase();
    if (code === 'plus') return 'Средний сегмент';
    if (code === 'pro') return 'Максимальный план';
    return 'Базовый доступ';
  }
  function planCardLead(code){
    code = String(code || '').toLowerCase();
    if (code === 'plus') return 'Средний уровень Neon для Full HD, кастомизации и повышенных лимитов.';
    if (code === 'pro') return 'Максимальный уровень Neon: 60 FPS, полный набор эффектов и самые большие лимиты.';
    return 'Стартовый уровень Neon: чат, звонки, подарки и базовые лимиты без подписки.';
  }
  function priceLine(plan){
    const p = normalizePlan(plan || {});
    if (Number(p.price_minor || 0) <= 0) return 'Бесплатно';
    return `${rub(p.price_minor, p.currency)} / ${p.period_days || 30}д`;
  }

  function compareProfileState(plan){
    const f = (plan && plan.features) || {};
    if (f.pro_effects) return 'Pro FX';
    if (f.name_styles || f.avatar_decor) return 'Кастом';
    return 'База';
  }
  function compareTierAccent(code){
    code = String(code || '').toLowerCase();
    if (code === 'plus') return 'Популярный';
    if (code === 'pro') return 'Максимум';
    return 'Старт';
  }
  function compareQuickRows(plans){
    const normalized = (Array.isArray(plans) && plans.length ? plans : FALLBACK_PLANS).map(normalizePlan);
    const order = ['free','plus','pro'];
    const tiers = order.map(code => normalized.find(p => p.code === code) || normalizePlan({ code }));
    const uploadLine = tiers.map(t => `${(((t.features || {}).max_upload_mb) ?? 25)} МБ`).join(' → ');
    const streamLine = tiers.map(t => screenShareLabel(t).replace('До ', '')).join(' → ');
    const profileLine = [
      'База',
      (tiers[1] && (tiers[1].features || {}).name_styles) ? 'Plus' : '—',
      (tiers[2] && (tiers[2].features || {}).pro_effects) ? 'Всё' : '—'
    ].join(' → ');
    return [
      { label:'Файлы', value:uploadLine },
      { label:'Демка', value:streamLine },
      { label:'Профиль', value:profileLine }
    ];
  }
  function compareTeaser(plans){
    const normalized = (Array.isArray(plans) && plans.length ? plans : FALLBACK_PLANS).map(normalizePlan);
    return `<div class="nc-bill-compare-showcase">
      ${planPreviewChips(normalized)}
      <div class="nc-bill-compare-mini-grid">
        ${compareQuickRows(normalized).map(row => `<div class="nc-bill-compare-mini-row"><span>${esc(row.label)}</span><strong>${esc(row.value)}</strong></div>`).join('')}
      </div>
    </div>`;
  }
  function planPreviewChips(plans){
    const normalized = (Array.isArray(plans) && plans.length ? plans : FALLBACK_PLANS).map(normalizePlan);
    const order = ['free','plus','pro'];
    const notes = {
      free:'Базовый доступ',
      plus:'1080p и кастомизация',
      pro:'60 FPS и все эффекты'
    };
    return `<div class="nc-bill-tier-preview">${order.map(code => {
      const plan = normalized.find(p => p.code === code) || normalizePlan({ code });
      const active = currentPlanCode() === code ? ' is-active' : '';
      return `<div class="nc-bill-tier-chip ${planTone(code)}${active}">
        <img src="${logoForPlan(code)}" alt="">
        <div class="nc-bill-tier-chip__copy">
          <strong>${esc(plan.name)}</strong>
          <small>${esc(notes[code] || '')}</small>
        </div>
        ${active ? '<span class="nc-bill-tier-chip__mark">Текущий</span>' : ''}
      </div>`;
    }).join('')}</div>`;
  }
  function closeCompareModal(){
    const el = document.getElementById('nc-bill-compare-modal');
    if (el) el.remove();
  }
  function openCompareModal(plans){
    closeCompareModal();
    const root = document.createElement('div');
    root.className = 'nc-bill-compare-modal';
    root.id = 'nc-bill-compare-modal';
    root.innerHTML = `
      <div class="nc-bill-compare-modal__backdrop"></div>
      <div class="nc-bill-compare-modal__dialog" role="dialog" aria-modal="true" aria-label="Сравнение планов">
        <button class="nc-bill-compare-modal__close" type="button" aria-label="Закрыть">×</button>
        <div class="nc-bill-compare-modal__head">
          <div class="nc-bill-brand-line"><span class="nc-bill-brand-name">NEON MEMBERSHIP</span></div>
          <h3>Сравнение планов</h3>
          <div class="nc-bill-muted">Таблица открывается отдельно, чтобы всё читалось ровно и без сжатия в правой колонке.</div>
          ${planPreviewChips(plans)}
        </div>
        <div class="nc-bill-compare-modal__body">${compareMatrix(plans)}</div>
        <div class="nc-bill-compare-modal__foot">
          <button class="nc-bill-btn" type="button" data-local-action="close">Закрыть</button>
          <button class="nc-bill-btn primary" type="button" data-local-action="subscriptions">К тарифам</button>
        </div>
      </div>`;
    root.addEventListener('click', function(ev){
      const target = ev.target;
      if (target === root || target.classList.contains('nc-bill-compare-modal__backdrop')){
        closeCompareModal();
        return;
      }
      const closeBtn = target.closest('.nc-bill-compare-modal__close, [data-local-action="close"]');
      if (closeBtn){
        closeCompareModal();
        return;
      }
      const navBtn = target.closest('[data-local-action="subscriptions"]');
      if (navBtn){
        closeCompareModal();
        navTo('subscriptions');
      }
    });
    const host = document.body || document.documentElement;
    host.appendChild(root);
  }
  function compareCellState(on, extraClass, content){
    return `<div class="nc-bill-compare-cell ${on ? 'is-on' : 'is-off'} ${extraClass || ''}">${content}</div>`;
  }
  function compareBoolCell(plan, key){
    const f = (plan && plan.features) || {};
    const on = !!f[key];
    return compareCellState(on, 'is-bool', on ? '✓' : '—');
  }
  function compareValueCell(text, tone){
    return `<div class="nc-bill-compare-cell is-value ${tone || ''}">${text}</div>`;
  }
  function compareMatrix(plans){
    const normalized = (Array.isArray(plans) && plans.length ? plans : FALLBACK_PLANS).map(normalizePlan);
    const order = ['free','plus','pro'];
    const tiers = order.map(code => normalized.find(p => p.code === code) || normalizePlan({ code }));
    const rows = [
      {
        label:'Загрузка файлов',
        cells: tiers.map(t => compareValueCell(`${esc(((t.features || {}).max_upload_mb) ?? 25)} МБ`, `tone-${planTone(t.code)}`))
      },
      {
        label:'Демонстрация экрана',
        cells: tiers.map(t => compareValueCell(screenShareLabel(t), `tone-${planTone(t.code)}`))
      },
      {
        label:'Профильный бейдж',
        cells: tiers.map(t => compareBoolCell(t, 'profile_badge'))
      },
      {
        label:'Стили ника и теги',
        cells: tiers.map(t => compareBoolCell(t, 'name_styles'))
      },
      {
        label:'Украшения аватара',
        cells: tiers.map(t => compareBoolCell(t, 'avatar_decor'))
      },
      {
        label:'Пресеты профиля',
        cells: tiers.map(t => compareBoolCell(t, 'theme_packs_basic'))
      },
      {
        label:'Ауры / рамки / витрина',
        cells: tiers.map(t => compareBoolCell(t, 'pro_effects'))
      }
    ];
    return `
      <div class="nc-bill-compare-wrap">
        <div class="nc-bill-compare">
          <div class="nc-bill-compare-head">
            <div class="nc-bill-compare-cell is-head is-label">Опция</div>
            ${tiers.map(t => `<div class="nc-bill-compare-cell is-head ${planTone(t.code)}">${esc(t.name)}</div>`).join('')}
          </div>
          ${rows.map(row => `
            <div class="nc-bill-compare-row">
              <div class="nc-bill-compare-cell nc-bill-compare-label">${esc(row.label)}</div>
              ${row.cells.join('')}
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function buildLoadingShell(title, subtitle){
    seedState();
    return `
      <h2 class="nc-settings-title">${esc(title)}</h2>
      <div class="nc-bill-wrap nc-bill-wrap--luxury">
        <div class="nc-bill-hero nc-bill-hero--premium is-loading">
          <div class="nc-bill-hero-main">
            <div class="nc-bill-brand-line"><span class="nc-bill-brand-name">NEON MEMBERSHIP</span></div>
            <h3>${esc(title)}</h3>
            <div class="nc-bill-muted">${esc(subtitle || 'Загрузка…')}</div>
          </div>
        </div>
      </div>`;
  }

  function pageNeedsHydration(pageName){
    const page = $(`.nc-settings-page[data-page="${pageName}"]`);
    if (!page) return false;
    const text = (page.textContent || '').trim();
    if (!text) return true;
    if (/Раздел в разработке/i.test(text)) return true;
    if (/Загружаем премиум-витрину/i.test(text)) return true;
    if (/Загружаем витрину/i.test(text)) return true;
    if (pageName === 'subscriptions' && !page.querySelector('.nc-bill-plan')) return true;
    if (pageName === 'nitro' && !page.querySelector('.nc-bill-hero')) return true;
    if (pageName === 'billing' && !page.querySelector('.nc-bill-kv-item')) return true;
    return false;
  }

  function scheduleHydrate(pageName){
    const steps = [0, 80, 220, 500, 900, 1400];
    steps.forEach(function(delay){
      setTimeout(function(){
        if (pageNeedsHydration(pageName)) renderPremiumPageNow(pageName);
      }, delay);
    });
  }

  function renderPremiumPageNow(pageName){
    const page = $(`.nc-settings-page[data-page="${pageName}"]`);
    if (!page) return;
    seedState();
    try{
      if (pageName === 'subscriptions') buildSubscriptionsPage();
      else if (pageName === 'nitro') buildNitroPage();
      else if (pageName === 'billing') buildBillingPage();
    }catch(err){
      page.innerHTML = `<h2 class="nc-settings-title">${esc(pageName === 'nitro' ? 'Neon' : (pageName === 'billing' ? 'Платежи' : 'Подписка'))}</h2><div class="nc-bill-error">${esc(err && err.message ? err.message : err)}</div>`;
    }
    if (!state.loading) refresh(false);
  }

  function buildSubscriptionsPage(){
    seedState();
    const page = $('.nc-settings-page[data-page="subscriptions"]');
    if (!page) return;
    const plans = (state.plans && state.plans.length ? state.plans : FALLBACK_PLANS).slice().map(normalizePlan);
    const me = state.me || fallbackMe();
    const plan = normalizePlan(me.plan || {});
    const provider = (me.provider || 'mock');
    const cancelTxt = me.cancel_at_period_end ? 'Выключено — закончится в конце периода' : (currentPlanCode() === 'free' ? 'Не требуется' : `Включено • каждые ${monthsText(me.renew_months || 1)}`);
    const actionContentForCard = function(p){
      const code = p.code || '';
      const current = currentPlanCode() === code;
      if (current) return '<button class="nc-bill-btn" disabled>Текущий</button>';
      if (code === 'free') return '<button class="nc-bill-btn" data-bill-action="subscribe" data-plan="free">Перейти на Free</button>';
      return `
        <button class="nc-bill-btn primary" data-bill-action="${(provider && provider !== 'mock') ? 'checkout' : 'subscribe'}" data-plan="${esc(code)}">Купить для себя</button>
        <button class="nc-bill-btn" data-bill-action="gift-plan" data-plan="${esc(code)}">Подарить</button>`;
    };
    page.innerHTML = `
      <h2 class="nc-settings-title">Подписка</h2>
      <div class="nc-bill-wrap nc-bill-wrap--luxury">
        <div class="nc-bill-hero nc-bill-hero--premium ${planTone(plan.code)}">
          <div class="nc-bill-hero-main">
            <div class="nc-bill-brand-line"><img src="${logoForPlan(plan.code)}" class="nc-bill-brand-logo" alt=""><span class="nc-bill-brand-name">NEON MEMBERSHIP</span></div>
            <h3>Текущий план: ${esc(plan.name || 'Free')}</h3>
            <div class="nc-bill-muted">${esc(heroSummary(plan.code))}</div>
            <div class="nc-bill-badges">
              <span class="nc-bill-badge ${(plan.code==='plus'?'plus':(plan.code==='pro'?'pro':''))}">${esc((plan.badge || plan.code || 'free').toUpperCase())}</span>
              <span class="nc-bill-badge">${esc((me.status) || 'free')}</span>
              ${provider==='gift' ? '<span class="nc-bill-badge">gift</span>' : ''}
            </div>
          </div>
          <div class="nc-bill-actions nc-bill-actions--hero">
            <button class="nc-bill-btn" data-bill-action="gift-open">Подарить другу</button>
            ${currentPlanCode() !== 'free' ? `<button class="nc-bill-btn ${me.cancel_at_period_end ? 'primary' : ''}" data-bill-action="${me.cancel_at_period_end ? 'resume' : 'cancel'}">${me.cancel_at_period_end ? 'Включить автопродление' : 'Отменить автопродление'}</button>` : ''}
            <button class="nc-bill-btn" data-bill-action="scroll-plans">Обновить</button>
          </div>
        </div>

        <div class="nc-bill-card nc-bill-stats-card">
          <div class="nc-bill-kv">
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">Статус</div><div class="nc-bill-kv-v">${esc((me && me.status) || 'free')}</div></div>
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">Период до</div><div class="nc-bill-kv-v">${fmtDate(me && me.current_period_end)}</div></div>
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">Автопродление</div><div class="nc-bill-kv-v">${esc(cancelTxt)}</div></div>
          </div>
          ${currentPlanCode() !== 'free' ? `<div class="nc-bill-renew-note">${me.cancel_at_period_end ? 'После окончания периода аккаунт вернётся на Free. Автопродление можно снова включить в любой момент.' : `Продление включено. Следующее автоматическое списание пройдёт за ${monthsText(me.renew_months || 1)} текущего тарифа, если вы не отключите автопродление.`}</div>` : ''}
        </div>

        <div class="nc-bill-grid nc-bill-grid--feature nc-bill-grid--top">
          <div class="nc-bill-card nc-bill-card--tariff">
            <div class="nc-vv-h2">Тарифный план</div>
            <div class="nc-bill-muted">${esc(planInfoLead(plan.code))}</div>
            <div class="nc-bill-tariff-head ${planTone(plan.code)}">
              <img src="${logoForPlan(plan.code)}" class="nc-bill-tariff-logo" alt="">
              <div class="nc-bill-tariff-copy">
                <div class="nc-bill-tariff-name">${esc(plan.name || 'Free')}</div>
                <div class="nc-bill-tariff-sub">${esc(planStatusLabel(plan.code))} • ${esc(priceLine(plan))}</div>
              </div>
              <span class="nc-bill-badge ${(plan.code==='plus'?'plus':(plan.code==='pro'?'pro':''))}">${esc((plan.badge || plan.code || 'free').toUpperCase())}</span>
            </div>
            <ul class="nc-bill-list">${currentPlanPerks().map(x=>`<li>${x}</li>`).join('')}</ul>
          </div>
          <div class="nc-bill-card nc-bill-card--compare-cta">
            <div class="nc-vv-h2">Сравнение планов</div>
            <div class="nc-bill-muted">Быстрый взгляд на разницу между Free, Plus и Pro. Полная таблица откроется отдельно, уже без тесной вёрстки.</div>
            ${compareTeaser(plans)}
            <div class="nc-bill-compare-cta-actions">
              <button class="nc-bill-btn primary" data-bill-action="open-compare">Открыть полное сравнение</button>
            </div>
          </div>
        </div>

        <div class="nc-bill-section" id="nc-bill-plans-anchor">
          <div class="nc-bill-grid nc-bill-grid--plans">${plans.map(p => {
            const code = p.code || '';
            const current = currentPlanCode() === code;
            const price = (Number(p.price_minor||0) > 0) ? `${rub(p.price_minor, p.currency)} <small>/ ${p.period_days || 30}д</small>` : 'Бесплатно';
            return `<div class="nc-bill-plan ${current?'is-current':''} ${code==='pro'?'is-pro':''} ${code==='plus'?'is-plus':''} ${code==='free'?'is-free':''}">
              <div class="nc-bill-plan-top">
                <div class="nc-bill-plan-head">
                  <img class="nc-bill-plan-logo" src="${logoForPlan(code)}" alt="">
                  <div>
                    <div class="nc-bill-plan-kicker">${esc(compareTierAccent(code))}</div>
                    <div class="nc-bill-plan-name">${esc(p.name)}</div>
                    <div class="nc-bill-muted">${esc(planCardLead(code))}</div>
                  </div>
                </div>
                ${(p.badge || '').trim() ? `<span class="nc-bill-badge ${(code==='plus'?'plus':(code==='pro'?'pro':''))}">${esc(p.badge)}</span>` : ''}
              </div>
              <div class="nc-bill-plan-price">${price}</div>
              <div class="nc-bill-plan-subline">${esc(planSubtitle(code))}</div>
              <ul class="nc-bill-list">${featureLines(p).map(x=>`<li>${x}</li>`).join('')}</ul>
              <div class="nc-bill-spacer"></div>
              <div class="nc-bill-actions">${actionContentForCard(p)}</div>
            </div>`;
          }).join('')}</div>
        </div>
      </div>`;
  }

  function buildNitroPage(){
    seedState();
    const page = $('.nc-settings-page[data-page="nitro"]');
    if (!page) return;
    const plan = normalizePlan((state.me && state.me.plan) || {});
    const plans = (state.plans && state.plans.length ? state.plans : FALLBACK_PLANS).slice().map(normalizePlan);
    const tone = planTone(plan.code);
    page.innerHTML = `
      <h2 class="nc-settings-title">Neon</h2>
      <div class="nc-bill-wrap nc-bill-wrap--luxury">
        <div class="nc-bill-hero nc-bill-hero--premium ${tone}">
          <div class="nc-bill-hero-main">
            <div class="nc-bill-brand-line"><img src="${logoForPlan(plan.code || 'free')}" class="nc-bill-brand-logo" alt=""><span class="nc-bill-brand-name">NEON ACCESS</span></div>
            <h3>Neon — подписка для аккаунта, а не для сервера</h3>
            <div class="nc-bill-muted">Здесь только личные преимущества: качество демки, оформление профиля, бейджи, пресеты и лимиты. Бустов сервера нет.</div>
            <div class="nc-bill-badges"><span class="nc-bill-badge ${(plan.code==='plus'?'plus':(plan.code==='pro'?'pro':''))}">${esc((plan.badge || plan.code || 'free').toUpperCase())}</span><span class="nc-bill-badge">${esc((state.me && state.me.status) || 'free')}</span></div>
          </div>
          <div class="nc-bill-actions nc-bill-actions--hero">
            <button class="nc-bill-btn primary" data-bill-action="open-subscriptions">Управлять подпиской</button>
            <button class="nc-bill-btn" data-bill-action="gift-open">Подарить другу</button>
            <button class="nc-bill-btn" data-bill-action="open-billing">Платежи</button>
          </div>
        </div>

        <div class="nc-bill-card nc-bill-stats-card">
          <div class="nc-bill-kv">
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">Текущий план</div><div class="nc-bill-kv-v">${esc(plan.name || 'Free')}</div></div>
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">Период до</div><div class="nc-bill-kv-v">${fmtDate(state.me && state.me.current_period_end)}</div></div>
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">Что это даёт</div><div class="nc-bill-kv-v">${esc(currentPlanCode() === 'free' ? 'Базовый доступ' : (currentPlanCode() === 'plus' ? '1080p, кастомизация и лимиты' : '60 FPS, про-эффекты и максимум лимитов'))}</div></div>
          </div>
        </div>

        <div class="nc-bill-grid nc-bill-grid--feature">
          <div class="nc-bill-card">
            <div class="nc-vv-h2">Что открывает Neon</div>
            <ul class="nc-bill-list">
              <li>Free — базовый аккаунт: 720p / 30 FPS и стандартные лимиты.</li>
              <li>NEON Plus — 1080p / 30 FPS, бейдж, стили ника, украшения и базовые пресеты профиля.</li>
              <li>NEON Pro — всё из Plus, 60 FPS, продвинутые эффекты, ауры, рамки и витрина значков.</li>
              <li>Подписка влияет только на ваш аккаунт. Серверные бусты не используются.</li>
            </ul>
            <div class="nc-bill-showcase"><img src="/static/img/neon_plus_logo.svg" alt=""><img src="/static/img/neon_pro_logo.svg" alt=""></div>
          </div>
          <div class="nc-bill-card nc-bill-card--compare-cta">
            <div class="nc-vv-h2">Сравнение планов</div>
            <div class="nc-bill-muted">Не сухая таблица, а быстрый обзор: что даёт каждый уровень и где начинается настоящий Neon.</div>
            ${compareTeaser(plans)}
            <div class="nc-bill-compare-cta-actions">
              <button class="nc-bill-btn primary" data-bill-action="open-compare">Открыть полное сравнение</button>
              <button class="nc-bill-btn" data-bill-action="open-subscriptions">К тарифам</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function buildBillingPage(){
    seedState();
    const page = $('.nc-settings-page[data-page="billing"]');
    if (!page) return;
    const me = state.me || {};
    const payments = Array.isArray(me.payments) ? me.payments : [];
    const plan = normalizePlan(me.plan || {});
    const renewTxt = me.cancel_at_period_end ? 'Выключено — закончится в конце периода' : (currentPlanCode() === 'free' ? 'Не требуется' : `Включено • каждые ${monthsText(me.renew_months || 1)}`);
    page.innerHTML = `
      <h2 class="nc-settings-title">Платежи</h2>
      <div class="nc-bill-wrap nc-bill-wrap--luxury">
        <div class="nc-bill-card nc-bill-stats-card">
          <div class="nc-bill-kv">
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">План</div><div class="nc-bill-kv-v">${esc(plan.name || 'Free')}</div></div>
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">Статус</div><div class="nc-bill-kv-v">${esc(me.status || 'free')}</div></div>
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">Период до</div><div class="nc-bill-kv-v">${fmtDate(me.current_period_end)}</div></div>
            <div class="nc-bill-kv-item"><div class="nc-bill-kv-k">Автопродление</div><div class="nc-bill-kv-v">${esc(renewTxt)}</div></div>
          </div>
        </div>
        <div class="nc-bill-grid nc-bill-grid--feature">
          <div class="nc-bill-card"><div class="nc-vv-h2" style="margin-bottom:10px">Сейчас включено</div><ul class="nc-bill-list">${currentPlanPerks().map(x=>`<li>${x}</li>`).join('')}</ul></div>
          <div class="nc-bill-card"><div class="nc-vv-h2" style="margin-bottom:10px">История платежей</div>${payments.length ? `<div class="nc-bill-paylist">${payments.map(p=>`<div class="nc-bill-payrow"><div><div style="font-weight:800">${esc((p.plan_code || '').toUpperCase() || 'FREE')}</div><div class="nc-bill-muted">${fmtDate(p.paid_at || p.created_at)}</div></div><div class="nc-bill-pill ${(p.status==='succeeded'?'ok':'wait')}">${esc(p.status || '')}</div><div style="font-weight:900">${rub(p.amount_minor, p.currency)}</div></div>`).join('')}</div>` : `<div class="nc-bill-empty">Пока платежей нет.</div>`}</div>
        </div>
      </div>`;
  }

  function renderAll(){
    mountPromoButtons();
    buildNitroPage();
    buildSubscriptionsPage();
    buildBillingPage();
    setTimeout(maybeOpenRenewReminder, 180);
  }

  async function refresh(showErr){
    if (state.loading) return;
    state.loading = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(function(){ try{ controller.abort(); }catch(_){} }, 3500) : null;
    try{
      seedState();
      const [plansData, meData] = await Promise.all([
        api('/api/billing/plans', controller ? { signal: controller.signal } : undefined),
        api('/api/billing/me', controller ? { signal: controller.signal } : undefined)
      ]);
      state.plans = Array.isArray(plansData.plans) && plansData.plans.length ? plansData.plans : FALLBACK_PLANS.slice();
      state.me = Object.assign({}, fallbackMe(), meData || {});
      try{ window.NC_BILLING = { me: state.me, plans: state.plans, ts: Date.now() }; }catch(_){ }
      try{ window.dispatchEvent(new CustomEvent('nc:billing-updated', { detail: (window.NC_BILLING || {}) })); }catch(_){ }
    }catch(err){
      if (!state.plans || !state.plans.length) state.plans = FALLBACK_PLANS.slice();
      if (!state.me) state.me = fallbackMe();
      try{ window.NC_BILLING = { me: state.me, plans: state.plans, ts: Date.now(), fallback:true }; }catch(_){ }
      if (showErr){
        const page = $('.nc-settings-page[data-page="subscriptions"]');
        if (page) {
          let box = page.querySelector('.nc-bill-error');
          if (!box){ box = document.createElement('div'); box.className = 'nc-bill-error'; page.prepend(box); }
          box.textContent = (err && err.name === 'AbortError') ? 'Сервер долго отвечает. Показана локальная витрина.' : (err.message || String(err));
        }
      }
    }finally{
      if (timer) clearTimeout(timer);
      state.loading = false;
      renderAll();
    }
  }

  function scrollToPlans(){
    const page = $('.nc-settings-page[data-page="subscriptions"]');
    const target = page && page.querySelector('#nc-bill-plans-anchor');
    if (!target) return;
    try{
      target.scrollIntoView({ behavior:'smooth', block:'start', inline:'nearest' });
      target.classList.remove('is-flash');
      requestAnimationFrame(function(){ target.classList.add('is-flash'); });
      setTimeout(function(){ target.classList.remove('is-flash'); }, 1600);
    }catch(_){
      try{ target.scrollIntoView(); }catch(__){}
    }
  }

  async function performAction(action, plan, extra){
    if (action === 'open-subscriptions') return navTo('subscriptions');
    if (action === 'open-billing') return navTo('billing');
    if (action === 'open-compare') return openCompareModal(state.plans || FALLBACK_PLANS);
    if (action === 'scroll-plans') return scrollToPlans();
    if (action === 'refresh') return refresh(true);
    if (action === 'gift-open') { try{ window.NC_GIFTS && window.NC_GIFTS.open && window.NC_GIFTS.open({ plan_code: plan || '' }); }catch(e){} return; }
    if (action === 'gift-plan') { try{ window.NC_GIFTS && window.NC_GIFTS.open && window.NC_GIFTS.open({ plan_code: plan }); }catch(e){} return; }
    const payload = Object.assign({}, extra || {});
    if (action === 'subscribe'){
      await api('/api/billing/subscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(Object.assign({}, payload, { plan_code: plan })) });
    } else if (action === 'checkout'){
      const out = await api('/api/billing/checkout/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(Object.assign({}, payload, { plan_code: plan })) });
      if (out && out.checkout_url){
        window.location.href = out.checkout_url;
        return;
      }
    } else if (action === 'cancel'){
      await api('/api/billing/cancel', { method:'POST', headers:{'Content-Type':'application/json'}, body: '{}' });
    } else if (action === 'resume'){
      await api('/api/billing/resume', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    }
    await refresh(true);
  }

  async function doAction(action, plan){
    try{
      if (action === 'cancel') return openCancelConfirmModal();
      if (action === 'resume') return openResumeConfirmModal();
      if ((action === 'subscribe' || action === 'checkout') && isDowngradePlan(plan)) return openDowngradeModal(plan);
      if (action === 'subscribe' || action === 'checkout') return openPurchaseModal(action, plan);
      await performAction(action, plan);
    }catch(err){
      if (err && err.payload && err.payload.error_code === 'downgrade_not_allowed'){
        openDowngradeModal(plan || (err.payload && err.payload.target_plan));
        return;
      }
      const box = $('.nc-settings-page[data-page="subscriptions"] .nc-bill-wrap') || $('.nc-settings-page[data-page="subscriptions"]');
      if (box){
        let e = box.querySelector('.nc-bill-error');
        if (!e){ e = document.createElement('div'); e.className = 'nc-bill-error'; box.prepend(e); }
        e.textContent = err.message || String(err);
      }
    }
  }

  function bindEvents(){
    if (document.body.dataset.ncBillingBound === '1') return;
    document.body.dataset.ncBillingBound = '1';
    document.addEventListener('click', function(ev){
      const btn = ev.target.closest('[data-bill-action]');
      if (!btn) return;
      ev.preventDefault();
      const action = btn.getAttribute('data-bill-action') || '';
      const plan = btn.getAttribute('data-plan') || '';
      doAction(action, plan);
    }, true);
  }

  function boot(){
    seedState();
    bindEvents();
    mountPromoButtons();
    try{ window.NC_BILLING_REFRESH = refresh; }catch(_){ }
    window.addEventListener('nc:billing-refresh', function(){ try{ refresh(false); }catch(_){ } });
    window.addEventListener('keydown', function(ev){
      if (ev.key === 'Escape' && document.getElementById('nc-bill-compare-modal')){
        closeCompareModal();
      }
      if (ev.key === 'Escape' && document.getElementById('nc-bill-action-modal')){
        closeActionModal();
      }
    });
    window.addEventListener('nc:settings-page-changed', function(ev){
      const page = ev && ev.detail && ev.detail.page;
      if (!page) return;
      renderPremiumPageNow(page);
      if (page === 'subscriptions' || page === 'nitro' || page === 'billing') scheduleHydrate(page);
    });
    document.addEventListener('click', function(ev){
      const btn = ev.target && ev.target.closest ? ev.target.closest('.nc-settings-item[data-page="subscriptions"], .nc-settings-item[data-page="nitro"], .nc-settings-item[data-page="billing"]') : null;
      if (!btn) return;
      const page = btn.getAttribute('data-page') || '';
      scheduleHydrate(page);
    }, true);
    renderPremiumPageNow('subscriptions');
    renderPremiumPageNow('nitro');
    renderPremiumPageNow('billing');
    scheduleHydrate('subscriptions');
    scheduleHydrate('nitro');
    scheduleHydrate('billing');
    refresh(false);
    let ticks = 0;
    const t = setInterval(function(){
      mountPromoButtons();
      ticks += 1;
      if (ticks > 8) clearInterval(t);
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
