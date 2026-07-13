/* Semantic script */

/* fix67: Fill "Раздел в разработке" pages with Discord-like UI.
   - Keeps things stable: no heavy network, no background loops.
   - Saves all toggles to localStorage.
   - Applies only the few toggles that affect real app behavior.
*/
(function(){
  'use strict';

  const UI_STORE_KEY = 'nc_settings_ui_state';
  const CHAT_STORE_KEY = 'nc_chat_settings';

  function safeJsonParse(s, fallback){
    try{ return JSON.parse(s); }catch(e){ return fallback; }
  }

  function loadUiState(){
    return safeJsonParse(localStorage.getItem(UI_STORE_KEY) || '{}', {}) || {};
  }

  function saveUiState(state){
    try{ localStorage.setItem(UI_STORE_KEY, JSON.stringify(state||{})); }catch(e){}
  }

  function loadChatState(){
    return safeJsonParse(localStorage.getItem(CHAT_STORE_KEY) || '{}', {}) || {};
  }

  function saveChatState(state){
    try{ localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(state||{})); }catch(e){}
  }

  function boolish(v){
    if (v === true || v === false) return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return !!v;
  }

  function applyChatClasses(chatState){
    const root = document.documentElement;
    if (!root) return;
    // If disabled => add "no" class.
    root.classList.toggle('nc-chat-no-link-previews', !boolish(chatState.linkPreviews !== false));
    root.classList.toggle('nc-chat-no-media-links',   !boolish(chatState.mediaLinks !== false));
    root.classList.toggle('nc-chat-no-reactions',     !boolish(chatState.showReactions !== false));
    root.classList.toggle('nc-chat-no-autoemoji',     !boolish(chatState.autoEmoji !== false));
  }


  function normalizeLocale(loc){
    const s=(loc||'').toString().trim();
    if(!s) return 'ru';
    // keep common short codes and BCP-47 like pt-BR
    return s.replace('_','-');
  }

  function applyUiEffects(uiState){
    try{
      const root=document.documentElement;
      if(!root) return;
      const loc=normalizeLocale((uiState&&uiState.locale) || localStorage.getItem('nc_locale') || 'ru');
      root.setAttribute('lang', loc.split('-')[0]);
      const tf=((uiState&&uiState.timeFormat) || localStorage.getItem('nc_time_format') || 'auto').toString();
      root.setAttribute('data-nc-time-format', tf);

      // --- Global UI effects (apply instantly) ---
      // IMPORTANT: override only if the key exists in uiState (so Appearance page can stay the source of truth).
      const b = document.body;

      // High contrast
      if (uiState && Object.prototype.hasOwnProperty.call(uiState, 'highContrast')){
        root.classList.toggle('nc-high-contrast', !!boolish(uiState.highContrast));
      }

      // Developer mode (UI-only for now)
      if (uiState && Object.prototype.hasOwnProperty.call(uiState, 'devMode')){
        root.classList.toggle('nc-devmode', !!boolish(uiState.devMode));
      }

      // Activity privacy (hide activity labels when disabled)
      if (uiState && Object.prototype.hasOwnProperty.call(uiState, 'showActivity')){
        root.classList.toggle('nc-hide-activity', !boolish(uiState.showActivity !== false));
      }

      // Compact mode maps to existing density classes
      if (b && uiState && Object.prototype.hasOwnProperty.call(uiState, 'compactMode')){
        const on = !!boolish(uiState.compactMode);
        b.classList.remove('nc-density-compact','nc-density-default','nc-density-spacious');
        b.classList.add(on ? 'nc-density-compact' : 'nc-density-default');
      }

      // Motion: combine "Animations" + "Reduce motion" from UI-only pages.
      // - If uiAnimations is explicitly false => motion OFF
      // - else if reduceMotion true => motion REDUCED
      // - else motion ON
      // Only apply if at least one of the keys exists.
      const hasAnimKey = uiState && Object.prototype.hasOwnProperty.call(uiState, 'uiAnimations');
      const hasReduceKey = uiState && Object.prototype.hasOwnProperty.call(uiState, 'reduceMotion');
      if (b && (hasAnimKey || hasReduceKey)){
        const animOn = hasAnimKey ? !!boolish(uiState.uiAnimations !== false) : true;
        const reduce = hasReduceKey ? !!boolish(uiState.reduceMotion) : false;
        const mode = (!animOn) ? 'off' : (reduce ? 'reduced' : 'on');
        b.classList.remove('nc-motion-off','nc-motion-reduced','nc-motion-on');
        b.classList.add(mode === 'off' ? 'nc-motion-off' : (mode === 'reduced' ? 'nc-motion-reduced' : 'nc-motion-on'));
      }
      const streamer=!!(uiState && boolish(uiState.streamerMode));
      root.classList.toggle('nc-streamer-on', streamer);
      root.classList.toggle('nc-hide-personal', streamer && boolish(uiState.streamerHidePersonal !== false));
      root.classList.toggle('nc-hide-invites', streamer && boolish(uiState.streamerHideInvites !== false));
      root.classList.toggle('nc-mute-sfx', streamer && boolish(uiState.streamerMuteSfx));
      root.classList.toggle('nc-mute-notifications', streamer && boolish(uiState.streamerMuteNotifications));
    }catch(e){}
  }

  function h(str){
    return String(str)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function toggleRow(opts){
    const id = opts.id;
    const title = opts.title;
    const desc = opts.desc || '';
    const store = opts.store || 'ui'; // 'ui' or 'chat'
    const key = opts.key;
    const pressed = opts.pressed ? 'true' : 'false';
    const onClass = opts.pressed ? ' is-on' : '';
    const aria = h(title);
    return `
      <div class="nc-vv-toggle-row">
        <div>
          <div class="nc-vv-toggle-title">${h(title)}</div>
          ${desc ? `<div class="nc-vv-muted">${h(desc)}</div>` : ''}
        </div>
        <button class="nc-vv-switch${onClass}" type="button" id="${h(id)}" data-store="${h(store)}" data-key="${h(key)}" aria-pressed="${pressed}" aria-label="${aria}">
          <span class="nc-vv-switch-knob" aria-hidden="true"></span>
        </button>
      </div>
    `;
  }

  function radioRow(opts){
    const name = opts.name;
    const items = opts.items || [];
    return `
      <div class="nc-vv-radio-group" data-radio-name="${h(name)}">
        ${items.map(it => {
          const checked = it.checked ? 'checked' : '';
          return `<label class="nc-radio"><input type="radio" name="${h(name)}" value="${h(it.value)}" ${checked}><span>${h(it.label)}</span></label>`;
        }).join('')}
      </div>
    `;
  }

  function cardRow(title, subtitle){
    return `
      <div class="nc-settings-card">
        <div class="nc-settings-card-title">${h(title)}</div>
        ${subtitle ? `<div class="nc-settings-muted">${h(subtitle)}</div>` : ''}
      </div>
    `;
  }

  function ensurePage(pageName){
    return document.querySelector(`.nc-settings-page[data-page="${pageName}"]`);
  }

  function isPlaceholderPage(pageEl){
    if (!pageEl) return false;
    const muted = pageEl.querySelector('.nc-settings-muted');
    if (!muted) return false;
    return /в разработке/i.test(muted.textContent || '');
  }

  function fillPage(pageEl, html){
    if (!pageEl) return;
    pageEl.innerHTML = html;
  }

  function fillUiOnlyPages(){
    // These pages are UI-only (persist toggles), but should look like Discord.
    const uiState = loadUiState();

    // HOTKEYS
    const hotkeys = ensurePage('hotkeys');
    if (isPlaceholderPage(hotkeys)){
      const enabled = boolish(uiState.hotkeysEnabled !== false);
      fillPage(hotkeys, `
        <h2 class="nc-settings-title">Горячие клавиши</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Горячие клавиши</div>
          <div class="nc-vv-muted">Настройте быстрые действия. Горячие клавиши работают, если включены ниже.</div>
          ${toggleRow({id:'nc-hk-enabled', title:'Включить горячие клавиши', desc:'Разрешает сочетания клавиш в приложении.', store:'ui', key:'hotkeysEnabled', pressed:enabled})}
        </div>
        <div class="nc-vv-section">
          <div class="nc-vv-h2">Список</div>
          ${cardRow('Ctrl + K', 'Быстрый поиск')}
          ${cardRow('Ctrl + ,', 'Открыть настройки')}
          ${cardRow('Ctrl + /', 'Справка по горячим клавишам')}
          ${cardRow('Ctrl + Shift + M', 'Включить/выключить микрофон')}
          ${cardRow('Ctrl + Shift + D', 'Включить/выключить звук')}
        </div>
      `);
    }

    // PRIVACY
    const privacy = ensurePage('privacy');
    if (isPlaceholderPage(privacy)){
      const dms = boolish(uiState.privacyAllowDms !== false);
      const friendReq = boolish(uiState.privacyAllowFriendReq !== false);
      fillPage(privacy, `
        <h2 class="nc-settings-title">Данные и конфиденциальность</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Личные сообщения</div>
          ${toggleRow({id:'nc-pr-dms', title:'Разрешить личные сообщения от участников', desc:'Позволяет получать ЛС на серверах.', store:'ui', key:'privacyAllowDms', pressed:dms})}
          ${toggleRow({id:'nc-pr-friend', title:'Разрешить запросы дружбы', desc:'Разрешает другим пользователям отправлять запросы в друзья.', store:'ui', key:'privacyAllowFriendReq', pressed:friendReq})}
        </div>
        <div class="nc-vv-section">
          <div class="nc-vv-h2">Данные</div>
          ${toggleRow({id:'nc-pr-telemetry', title:'Отправлять диагностические данные', desc:'Помогает улучшать приложение. (UI-only)', store:'ui', key:'telemetry', pressed:boolish(uiState.telemetry !== false)})}
        </div>
      `);
    }

    // FAMILY / AUTHORIZED / DEVICES / INTEGRATIONS
    const family = ensurePage('family');
    if (isPlaceholderPage(family)){
      fillPage(family, `
        <h2 class="nc-settings-title">Семейный центр</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Семейный центр</div>
          <div class="nc-vv-muted">Раздел находится в разработке.</div>
        </div>
      `);
    }

    const authorized = ensurePage('authorized');
    if (authorized){
      try{ authorized.remove(); }catch(_e){ authorized.style.display='none'; }
    }

    const devices = ensurePage('devices');
    if (isPlaceholderPage(devices)){
      fillPage(devices, `
  <h2 class="nc-settings-title">Устройства</h2>

  <div class="nc-vv-section nc-vv-section-first">
    <div class="nc-vv-h2">Быстрая защита аккаунта</div>
    <div class="nc-vv-muted">
      Здесь показаны активные сеансы, история успешных входов и последние неудачные попытки.
      Если видите что-то подозрительное — используйте «Это был не я», затем войдите заново и смените пароль.
    </div>

    <div class="nc-devices-actions">
      <div class="nc-devices-actions-text">
        <div class="nc-vv-toggle-title">Выйти со всех устройств</div>
        <div class="nc-vv-muted">Завершает все сеансы на всех устройствах, включая это.</div>
      </div>
      <div class="nc-devices-action-buttons">
        <button class="nc-btn danger ghost" type="button" id="nc-devices-not-me">Это был не я</button>
        <button class="nc-btn danger" type="button" id="nc-devices-logout-all">Выйти со всех устройств</button>
      </div>
    </div>
  </div>

  <div class="nc-vv-section">
    <div class="nc-vv-h2">Примерное местоположение</div>
    <div class="nc-vv-muted">
      Опционально: показать страну/город для каждого IP в списке устройств и истории входов.
      При включении сервер выполнит запрос к стороннему сервису геолокации по IP и кэширует результат.
    </div>

    <div class="nc-vv-toggle-row">
      <div>
        <div class="nc-vv-toggle-title">Показывать местоположение по IP</div>
        <div class="nc-vv-muted">Если не хотите отправлять IP третьей стороне — оставьте выключенным.</div>
      </div>
      <button class="nc-vv-switch" type="button" id="nc-devices-geo-toggle" aria-pressed="false" aria-label="Показывать местоположение по IP">
        <span class="nc-vv-switch-knob" aria-hidden="true"></span>
      </button>
    </div>

    <div class="nc-settings-muted nc-devices-disclaimer">
      Геолокация работает через внешний сервис и может быть неточной, особенно с VPN/прокси.
    </div>
  </div>

  <div class="nc-vv-section nc-security-dashboard" id="nc-security-dashboard" style="display:none;">
    <div class="nc-vv-h2">Центр безопасности</div>
    <div class="nc-vv-muted">Быстрый обзор блокировок и шумных IP прямо внутри настроек.</div>
    <div class="nc-security-stats">
      <div class="nc-security-stat">
        <div class="nc-security-stat-label">Активные блокировки</div>
        <div class="nc-security-stat-value" id="nc-security-blocks-count">0</div>
      </div>
      <div class="nc-security-stat">
        <div class="nc-security-stat-label">Шумный IP за 24ч</div>
        <div class="nc-security-stat-value" id="nc-security-top-ip">—</div>
      </div>
      <div class="nc-security-stat">
        <div class="nc-security-stat-label">Событий у топ IP</div>
        <div class="nc-security-stat-value" id="nc-security-top-ip-count">0</div>
      </div>
    </div>
    <div class="nc-devices-action-buttons" style="margin-top:12px; justify-content:flex-start;">
      <a class="nc-btn ghost" id="nc-security-open-admin" href="/admin/security" target="_blank" rel="noopener">Открыть админ-панель</a>
    </div>
    <div class="nc-audit-list" id="nc-security-blocks-list"></div>
  </div>

  <div class="nc-vv-section">
    <div class="nc-vv-h2">Активные сеансы</div>
    <div class="nc-vv-muted">Нажмите «Выйти», чтобы завершить выбранный сеанс.</div>
    <div class="nc-devices-list" id="nc-devices-list">
      <div class="nc-settings-muted" id="nc-devices-loading">Загрузка…</div>
    </div>
  </div>

  <div class="nc-vv-section">
    <div class="nc-vv-h2">История входов</div>
    <div class="nc-vv-muted">Последние успешные входы в аккаунт с браузером, IP и временем.</div>
    <div class="nc-audit-list" id="nc-login-history-list"></div>
  </div>

  <div class="nc-vv-section">
    <div class="nc-vv-h2">Неудачные попытки</div>
    <div class="nc-vv-muted">Показывает ошибки входа по этому аккаунту: неверный пароль и 2FA.</div>
    <div class="nc-audit-list" id="nc-login-failed-list"></div>
  </div>

  <div class="nc-vv-section" id="nc-invalid-login-section" style="display:none;">
    <div class="nc-vv-h2">Неверный логин · анти-брют</div>
    <div class="nc-vv-muted">Админ-раздел: общий список попыток с несуществующим логином и событий лимита.</div>
    <div class="nc-audit-list" id="nc-invalid-login-list"></div>
  </div>
`);
    }

const integrations = ensurePage('integrations');
    if (isPlaceholderPage(integrations)){
      fillPage(integrations, `
        <h2 class="nc-settings-title">Интеграции</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Интеграции</div>
          <div class="nc-vv-muted">Раздел находится в разработке.</div>
        </div>
      `);
    }

    // PREMIUM PAGES
    // Billing / subscriptions / gifts are rendered by dedicated runtime modules
    // (nc_billing_ui_fix1.js + nc_gifts_fix1.js). We intentionally do not fill
    // them here, otherwise the old UI-only placeholders can overwrite the real
    // premium pages and hide the buy/gift actions.

    const nitro = ensurePage('nitro');
    if (isPlaceholderPage(nitro)){
      fillPage(nitro, `
        <h2 class="nc-settings-title">Neon</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Neon</div>
          <div class="nc-vv-muted">Загружаем премиум-витрину…</div>
        </div>
      `);
    }

    const boost = ensurePage('boost');
    if (isPlaceholderPage(boost)){
      fillPage(boost, `
        <h2 class="nc-settings-title">Буст сервера</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Бусты</div>
          <div class="nc-vv-muted">Управление бустами.</div>
          ${cardRow('У вас нет активных бустов', '')}
        </div>
      `);
    }

    // APPEARANCE / ACCESSIBILITY / ADVANCED / ACTIVITY (UI-only)
    const appearance = ensurePage('appearance');
    if (isPlaceholderPage(appearance)){
      fillPage(appearance, `
        <h2 class="nc-settings-title">Внешний вид</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Тема</div>
          <div class="nc-vv-muted">Настройте внешний вид приложения. (частично UI-only)</div>
          ${toggleRow({id:'nc-ap-compact', title:'Компактный режим', desc:'Уменьшает отступы в списках.', store:'ui', key:'compactMode', pressed:boolish(uiState.compactMode)})}
          ${toggleRow({id:'nc-ap-anim', title:'Анимации интерфейса', desc:'Включить анимации.', store:'ui', key:'uiAnimations', pressed:boolish(uiState.uiAnimations !== false)})}
        </div>
      `);
    }

    const accessibility = ensurePage('accessibility');
    if (isPlaceholderPage(accessibility)){
      fillPage(accessibility, `
        <h2 class="nc-settings-title">Специальные возможности</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Доступность</div>
          ${toggleRow({id:'nc-ac-reduce', title:'Уменьшить движение', desc:'Снижает анимации.', store:'ui', key:'reduceMotion', pressed:boolish(uiState.reduceMotion)})}
          ${toggleRow({id:'nc-ac-contrast', title:'Повышенный контраст', desc:'Делает элементы контрастнее.', store:'ui', key:'highContrast', pressed:boolish(uiState.highContrast)})}
        </div>
      `);
    }

    const advanced = ensurePage('advanced');
    if (isPlaceholderPage(advanced)){
      fillPage(advanced, `
        <h2 class="nc-settings-title">Расширенные</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Расширенные</div>
          ${toggleRow({id:'nc-ad-dev', title:'Режим разработчика', desc:'Показывает дополнительные пункты интерфейса.', store:'ui', key:'devMode', pressed:boolish(uiState.devMode)})}
          ${toggleRow({id:'nc-ad-hwa', title:'Аппаратное ускорение', desc:'Перезапуск может потребоваться. (UI-only)', store:'ui', key:'hwAccel', pressed:boolish(uiState.hwAccel !== false)})}
        </div>
      `);
    }

    const activity = ensurePage('activity');
    if (isPlaceholderPage(activity)){
      fillPage(activity, `
        <h2 class="nc-settings-title">Конфиденциальность активности</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Статус активности</div>
          ${toggleRow({id:'nc-act-show', title:'Показывать активность', desc:'Показывать, во что вы играете/что делаете.', store:'ui', key:'showActivity', pressed:boolish(uiState.showActivity !== false)})}
        </div>
      `);
    }

    // --- Language & Time (Discord-like) ---
    const lang = ensurePage('language');
    if (lang && isPlaceholderPage(lang)){
      const ui = loadUiState();
      const savedLocale = (ui.locale || localStorage.getItem('nc_locale') || 'ru').toString();
      const savedTime = (ui.timeFormat || localStorage.getItem('nc_time_format') || 'auto').toString();

      const LOCALES = [
        ['ru','🇷🇺','Русский'],
        ['en','🇺🇸','English'],
        ['uk','🇺🇦','Українська'],
        ['de','🇩🇪','Deutsch'],
        ['fr','🇫🇷','Français'],
        ['es','🇪🇸','Español'],
        ['it','🇮🇹','Italiano'],
        ['pl','🇵🇱','Polski'],
        ['tr','🇹🇷','Türkçe'],
        ['pt-BR','🇧🇷','Português (Brasil)'],
        ['ja','🇯🇵','日本語'],
        ['ko','🇰🇷','한국어'],
        ['zh-CN','🇨🇳','中文（简体）'],
        ['zh-TW','🇹🇼','中文（繁體）'],
        ['sv','🇸🇪','Svenska'],
        ['nl','🇳🇱','Nederlands'],
        ['cs','🇨🇿','Čeština'],
        ['ro','🇷🇴','Română'],
        ['hu','🇭🇺','Magyar'],
        ['fi','🇫🇮','Suomi'],
        ['no','🇳🇴','Norsk'],
        ['da','🇩🇰','Dansk'],
      ];

      const opts = LOCALES.map(([v,f,n]) => `<option value="${v}">${f} ${n}</option>`).join('');
      fillPage(lang, `
        <h2 class="nc-settings-title">Language & Time</h2>

        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Выберите язык</div>
          <div class="nc-ap-select">
            <select id="nc-lt-locale" aria-label="Language">
              ${opts}
            </select>
          </div>
          <div class="nc-settings-muted" style="margin-top:8px">Язык применяется сразу для настроек и интерфейса, где доступен перевод.</div>
        </div>

        <div class="nc-vv-section">
          <div class="nc-vv-h2">Формат времени</div>
          <div class="nc-radios">
            <label class="nc-radio"><input type="radio" name="nc-timefmt" value="auto"> <span>Автоматически</span></label>
            <label class="nc-radio"><input type="radio" name="nc-timefmt" value="12"> <span>12 часов</span></label>
            <label class="nc-radio"><input type="radio" name="nc-timefmt" value="24"> <span>24 часа</span></label>
          </div>
          <div class="nc-settings-muted" style="margin-top:8px">Формат времени применяется к отметкам времени в сообщениях и событиях (если они есть на странице).</div>
        </div>
      `);

      // set initial values
      const sel = lang.querySelector('#nc-lt-locale');
      if (sel){
        sel.value = savedLocale;
        sel.addEventListener('change', () => {
          const v = sel.value;
          ui.locale = v;
          try{ localStorage.setItem('nc_locale', v); }catch(e){}
          saveUiState(ui);
          try{ document.documentElement.setAttribute('lang', v.split('-')[0]); }catch(e){}
          try{ window.dispatchEvent(new CustomEvent('nc_locale_changed', {detail:{locale:v}})); }catch(e){}
        });
      }
      lang.querySelectorAll('input[name="nc-timefmt"]').forEach(r => {
        if (r.value === savedTime) r.checked = true;
        r.addEventListener('change', () => {
          if(!r.checked) return;
          const v = r.value;
          ui.timeFormat = v;
          try{ localStorage.setItem('nc_time_format', v); }catch(e){}
          saveUiState(ui);
          try{ window.dispatchEvent(new CustomEvent('nc_time_format_changed', {detail:{format:v}})); }catch(e){}
        });
      });
    }

    // --- Streamer mode ---
    const streamer = ensurePage('streamer');
    if (streamer && isPlaceholderPage(streamer)){
      const ui = loadUiState();
      const sm = boolish(ui.streamerMode);
      fillPage(streamer, `
        <h2 class="nc-settings-title">Режим стримера</h2>
        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Включить режим стримера</div>
          ${toggleRow({id:'nc-sm-on', title:'Режим стримера', desc:'Скрывает личные данные и делает статус стримера заметным.', store:'ui', key:'streamerMode', pressed:sm})}
        </div>
        <div class="nc-vv-section">
          <div class="nc-vv-h2">Параметры режима стримера</div>
          ${toggleRow({id:'nc-sm-hide', title:'Скрыть мою личную информацию', desc:'Скрывает e-mail/телефон и другие поля учетной записи внутри клиента.', store:'ui', key:'streamerHidePersonal', pressed:boolish(ui.streamerHidePersonal !== false)})}
          ${toggleRow({id:'nc-sm-inv', title:'Скрыть ссылки‑приглашения', desc:'Скрывает ссылки‑приглашения в сообщениях.', store:'ui', key:'streamerHideInvites', pressed:boolish(ui.streamerHideInvites !== false)})}
          ${toggleRow({id:'nc-sm-sfx', title:'Отключить все звуковые эффекты', desc:'Отключает клиентские звуки (уведомления и другие эффекты).', store:'ui', key:'streamerMuteSfx', pressed:boolish(ui.streamerMuteSfx)})}
          ${toggleRow({id:'nc-sm-notif', title:'Отключить уведомления', desc:'Отключает уведомления и звуки входящих сообщений.', store:'ui', key:'streamerMuteNotifications', pressed:boolish(ui.streamerMuteNotifications)})}
        </div>
      `);
    }
  }

  function initSwitches(){
    const uiState = loadUiState();
    const chatState = loadChatState();

    function getValue(store, key){
      if (store === 'chat') return (key in chatState) ? chatState[key] : undefined;
      return (key in uiState) ? uiState[key] : undefined;
    }

    function syncBtnState(btn, on){
      if (!btn) return;
      const enabled = !!on;
      try{ btn.setAttribute('aria-pressed', enabled ? 'true' : 'false'); }catch(e){}
      try{ btn.setAttribute('aria-checked', enabled ? 'true' : 'false'); }catch(e){}
      try{ btn.classList.toggle('is-on', enabled); }catch(e){}
    }

    function setValue(store, key, value){
      if (store === 'chat'){
        chatState[key] = value;
        saveChatState(chatState);
        applyChatClasses(chatState);
        // also let main.js know immediately if it has hooks
        try{ window.dispatchEvent(new CustomEvent('nc_chat_settings_changed', {detail:{key,value,store}})); }catch(e){}
      } else {
        uiState[key] = value;
        saveUiState(uiState);
        applyUiEffects(uiState);
        try{ window.dispatchEvent(new CustomEvent('nc_ui_settings_changed', {detail:{key,value,store}})); }catch(e){}
      }
    }

    document.querySelectorAll('button.nc-vv-switch[data-key]').forEach(btn => {
      const store = btn.getAttribute('data-store') || 'ui';
      const key = btn.getAttribute('data-key');
      const cur = getValue(store, key);
      const initial = (cur === undefined)
        ? (btn.getAttribute('aria-pressed') === 'true')
        : boolish(cur);

      if (cur === undefined){
        // default true for most toggles unless explicitly set
        setValue(store, key, initial);
      }
      syncBtnState(btn, initial);
      try{ btn.setAttribute('role','switch'); }catch(e){}
      try{ if (btn.tabIndex < 0) btn.tabIndex = 0; }catch(e){}

      if (btn.__ncUiSwitchBound) return;
      btn.__ncUiSwitchBound = true;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pressed = btn.getAttribute('aria-pressed') === 'true';
        const next = !pressed;
        syncBtnState(btn, next);
        setValue(store, key, next);
      }, {passive:false});

      btn.addEventListener('keydown', (e) => {
        const k = e.key || '';
        if (k !== 'Enter' && k !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        const pressed = btn.getAttribute('aria-pressed') === 'true';
        const next = !pressed;
        syncBtnState(btn, next);
        setValue(store, key, next);
      }, {passive:false});
    });

    applyChatClasses(chatState);
  }

  function fillChatIfPlaceholder(){
    // Chat page may already be filled by template. If not, fill minimal Discord-like layout.
    const page = ensurePage('chat');
    if (!page) return;
    const muted = page.querySelector('.nc-settings-muted');
    if (muted && /в разработке/i.test(muted.textContent || '')){
      const chat = loadChatState();
      const vLink = boolish(chat.linkPreviews !== false);
      const vMediaLinks = boolish(chat.mediaLinks !== false);
      const vReactions = boolish(chat.showReactions !== false);
      const vAutoEmoji = boolish(chat.autoEmoji !== false);

      fillPage(page, `
        <h2 class="nc-settings-title">Чат</h2>

        <div class="nc-vv-section nc-vv-section-first">
          <div class="nc-vv-h2">Отображать картинки, видео и няшных котиков</div>
          ${toggleRow({id:'nc-chat-link-previews', title:'При публикации ссылки в чате', desc:'Показывать медиа‑предпросмотр, если сообщение содержит ссылку.', store:'chat', key:'linkPreviews', pressed:vLink})}
          ${toggleRow({id:'nc-chat-media-links', title:'При загрузке через Neon Chat', desc:'Показывать изображения прямо в ленте сообщений, если файл был загружен как вложение.', store:'chat', key:'mediaLinks', pressed:vMediaLinks})}
          ${toggleRow({id:'nc-chat-img-alt', title:'Включить описания изображений', desc:'Добавляет альтернативный текст для изображений (полезно для программ экранного чтения).', store:'ui', key:'imgAlt', pressed:false})}
        </div>

        <div class="nc-vv-section">
          <div class="nc-vv-h2">Вложения и предпросмотр ссылок</div>
          ${toggleRow({id:'nc-chat-embed', title:'Показывать вложения и предпросмотр веб‑ссылок', desc:'Если отключить — ссылки останутся кликабельными, но без карточек предпросмотра.', store:'chat', key:'linkPreviews', pressed:vLink})}
        </div>

        <div class="nc-vv-section">
          <div class="nc-vv-h2">Эмодзи</div>
          ${toggleRow({id:'nc-chat-reactions', title:'Показывать эмодзи‑реакции под сообщениями', desc:'Добавляет кнопку реакции и отображает реакции под сообщениями.', store:'chat', key:'showReactions', pressed:vReactions})}
          ${toggleRow({id:'nc-chat-autoemoji', title:'Автоматически преобразовывать смайлы в эмодзи', desc:'Например, :) превратится в 🙂 при отправке сообщения.', store:'chat', key:'autoEmoji', pressed:vAutoEmoji})}
        </div>

        <div class="nc-vv-section">
          <div class="nc-vv-h2">Стикеры</div>
          ${toggleRow({id:'nc-chat-stickers', title:'Стикеры в автозаполнении', desc:'Если включено — в будущем можно будет предлагать стикеры в подсказках ввода.', store:'ui', key:'stickersAutocomplete', pressed:false})}
        </div>
      `);
    }
  }

  function init(){
    // Fill placeholder pages now.
    fillUiOnlyPages();

    // Apply UI effects (locale, streamer, time) immediately.
    applyUiEffects(loadUiState());
    fillChatIfPlaceholder();

    // Bind switches after DOM is ready.
    initSwitches();

    // If settings modal pages are dynamically shown, ensure re-bind when modal opens.
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t) return;
      // When a settings item is clicked, pages may be swapped; rebind after paint.
      if (t.closest && (t.closest('.nc-settings-item') || t.closest('.nc-settings-subitem'))){
        setTimeout(() => {
          fillUiOnlyPages();
          fillChatIfPlaceholder();
          initSwitches();
        }, 0);
      }
    }, true);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


/* FIX254: Settings → open Edit Profile reliably
   - Click on the user card in settings left-nav ("Редактировать профиль…")
   - Click on the account page button "Редактировать профиль пользователя"
   Works even if settings overlay is moved into <body> at runtime.
*/
(function(){
  'use strict';

  function qs(sel, root){ return (root||document).querySelector(sel); }

  function openEditProfile(){
    try{
      if (typeof window.__ncOpenEditProfileModal === 'function') {
        window.__ncOpenEditProfileModal();
        return true;
      }
    }catch(e){}

    // Fallback: click the known trigger in the left bottom panel (if exists)
    try{
      const trigger = document.querySelector('.sidebar-bottom .current-user .user-meta .user-name');
      if (trigger){ trigger.click(); return true; }
    }catch(e){}

    return false;
  }

  function enhanceCard(el){
    if (!el || el.dataset.ncFix254 === '1') return;
    el.dataset.ncFix254 = '1';
    try{ el.setAttribute('role','button'); }catch(e){}
    try{ el.setAttribute('tabindex','0'); }catch(e){}
    try{ el.setAttribute('aria-label','Редактировать профиль'); }catch(e){}
  }

  function boot(){
    // Make the settings "me" card keyboard-focusable.
    try{
      const ov = qs('#nc-settings-overlay');
      const card = ov ? qs('.nc-settings-me', ov) : null;
      if (card) enhanceCard(card);
    }catch(e){}

    // Event delegation: survives DOM moves/rebuilds
    document.addEventListener('click', (e) => {
      try{
        const t = e.target;
        if (!t || !t.closest) return;

        const meCard = t.closest('.nc-settings-me');
        if (meCard && qs('#nc-settings-overlay')?.contains(meCard)){
          e.preventDefault();
          e.stopPropagation();
          openEditProfile();
          return;
        }

        const btn = t.closest('#nc-edit-profile');
        if (btn){
          e.preventDefault();
          e.stopPropagation();
          openEditProfile();
          return;
        }
      }catch(err){}
    }, true);

    document.addEventListener('keydown', (e) => {
      try{
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const a = document.activeElement;
        if (!a || !a.classList) return;
        if (a.classList.contains('nc-settings-me')){
          e.preventDefault();
          openEditProfile();
        }
      }catch(err){}
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();


/* fix: make settings modal truly modal (no click-through), keep pages inside modal */
(function(){
  'use strict';

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  function moveOverlayToBody(){
    const overlay = qs('#nc-settings-overlay');
    if (!overlay) return;
    if (overlay.parentElement !== document.body){
      try{ document.body.appendChild(overlay); }catch(e){}
    }
  }

  function lockBackground(isOpen){
    const b = document.body;
    if (!b) return;
    if (isOpen){
      b.classList.add('nc-modal-open');
    } else {
      b.classList.remove('nc-modal-open');
    }
  }

  function ensurePagesInsideModal(){
    const overlay = qs('#nc-settings-overlay');
    const modal = qs('.nc-settings-modal', overlay);
    const content = qs('#nc-settings-content-scroll', overlay) || qs('.nc-settings-content-scroll', overlay);
    if (!overlay || !modal || !content) return;

    // If any settings pages ended up outside the modal (e.g., appended to body), move them back.
    qsa('.nc-settings-page').forEach(p => {
      if (!overlay.contains(p)){
        try{ content.appendChild(p); }catch(e){}
      }
    });

    // Also ensure the right "floating" panel (if any) is removed.
    qsa('body > .nc-settings-page').forEach(p => {
      try{ p.remove(); }catch(e){}
    });
  }

  // v9.13 fix73: some builds can accidentally append chunks outside of `.nc-settings-page`
  // (e.g. "Advanced" blocks leaking into other tabs). This function hides any stray
  // nodes and enforces "only one active page" in the scroll area.
  function sanitizeSettingsPages(){
    const overlay = qs('#nc-settings-overlay');
    if (!overlay) return;
    const sc = qs('#nc-settings-content-scroll', overlay) || qs('.nc-settings-content-scroll', overlay);
    if (!sc) return;

    // Hide any direct children that are not page containers.
    Array.from(sc.children).forEach(ch => {
      try{
        if (!(ch && ch.classList && ch.classList.contains('nc-settings-page'))){
          ch.style.display = 'none';
          ch.setAttribute('aria-hidden','true');
        }
      }catch(e){}
    });

    // Determine current active page from the left nav.
    const activeBtn = overlay.querySelector('.nc-settings-item.is-active');
    const activeKey = activeBtn ? activeBtn.getAttribute('data-page') : null;
    if (!activeKey) return;

    // Enforce a single active page in the DOM.
    Array.from(sc.querySelectorAll('.nc-settings-page')).forEach(p => {
      try{
        const match = p.getAttribute('data-page') === activeKey;
        p.classList.toggle('is-active', match);
        p.style.display = match ? '' : 'none';
        p.setAttribute('aria-hidden', match ? 'false' : 'true');
      }catch(e){}
    });
  }

  function observeOpenState(){
    const overlay = qs('#nc-settings-overlay');
    if (!overlay) return;

    function isOpen(){
      // In this project settings overlay toggles via `.is-hidden`.
      // Treat it as open when it's NOT hidden and not aria-hidden.
      try{
        if (overlay.classList.contains('is-hidden')) return false;
        if (overlay.getAttribute('aria-hidden') === 'true') return false;
        return true;
      }catch(e){ return false; }
    }

    // Block interactions with the app behind the settings overlay.
    // IMPORTANT: do NOT stop events in capture phase on the overlay itself,
    // otherwise nothing inside the modal will be clickable.
    function shieldEvent(e){
      // Only when settings are open
      if (!isOpen()) return;
      // If event target is inside the overlay, allow it.
      if (overlay.contains(e.target)) return;
      // Otherwise block it so nothing behind can be clicked/focused.
      try{ e.preventDefault(); }catch(_e){}
      try{ e.stopPropagation(); }catch(_e){}
      try{ e.stopImmediatePropagation(); }catch(_e){}
    }

    const apply = () => {
      const open = isOpen();
      moveOverlayToBody();
      ensurePagesInsideModal();
      sanitizeSettingsPages();
      lockBackground(open);
    };

    apply();

    const mo = new MutationObserver(apply);
    mo.observe(overlay, { attributes:true, attributeFilter:['class'] });

    // Capture-phase shield: block events that start outside the overlay.
    // (This prevents click-through to the global search, etc.)
    ['pointerdown','mousedown','click','touchstart','wheel','keydown'].forEach(type => {
      document.addEventListener(type, shieldEvent, true);
    });

    // Bubble-phase stop on overlay so events don't leak to app-level handlers,
    // but still allow normal target handling inside the modal.
    overlay.addEventListener('click', (e) => {
      if (!isOpen()) return;
      e.stopPropagation();
    }, false);
    overlay.addEventListener('pointerdown', (e) => {
      if (!isOpen()) return;
      e.stopPropagation();
    }, false);

    // When switching pages, run a quick sanity pass on the DOM.
    overlay.addEventListener('click', (e) => {
      if (!isOpen()) return;
      const nav = e.target && e.target.closest ? e.target.closest('.nc-settings-item') : null;
      if (nav && overlay.contains(nav)) {
        // Defer until after the main handler toggles pages.
        setTimeout(sanitizeSettingsPages, 0);
      }
    }, true);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', observeOpenState);
  } else {
    observeOpenState();
  }
})();


/* fix255: Settings polish & stability
  - Better search: includes sub-items text (Voice&Video/Notifications) and hides empty group headers and separators
  - Keyboard UX: Enter opens first result, Esc clears
  - Remembers last opened settings page (and VV tab) and restores it on next open
  - Mobile UX: avoid auto-focus search keyboard pop (blur search on small screens)
*/
(function(){
  'use strict';

  const KEY_LAST_PAGE = 'nc_settings_last_page_v1';
  const KEY_LAST_VVTAB = 'nc_settings_last_vvtab_v1';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function isOverlayOpen(ov){
    try{
      if (!ov) return false;
      if (ov.classList.contains('is-hidden')) return false;
      if (ov.getAttribute('aria-hidden') === 'true') return false;
      return true;
    }catch(e){ return false; }
  }

  function readLS(key, fallback){
    try{
      const v = localStorage.getItem(key);
      return (v === null || v === undefined || v === '') ? fallback : v;
    }catch(e){ return fallback; }
  }
  function writeLS(key, val){
    try{ localStorage.setItem(key, String(val||'')); }catch(e){}
  }

  function normalize(s){
    return String(s||'').trim().toLowerCase();
  }

  function buildHaystackForItem(btn){
    const page = btn.getAttribute('data-page') || '';
    let txt = normalize(btn.textContent || '');

    // include sub-items for better discovery
    if (page === 'voicevideo'){
      const sub = document.querySelector('.nc-vv-subnav[data-parent="voicevideo"]');
      if (sub) txt += ' ' + normalize(sub.textContent || '');
    }
    if (page === 'notifications'){
      const sub = document.querySelector('.nc-nf-subnav[data-parent="notifications"]');
      if (sub) txt += ' ' + normalize(sub.textContent || '');
    }
    return txt;
  }

  function setVisible(el, on){
    if (!el) return;
    el.style.display = on ? '' : 'none';
  }

  function visible(el){
    if (!el) return false;
    return el.style.display !== 'none';
  }

  function filterNavBetter(ov, query){
    const needle = normalize(query);
    const navScroll = $('#nc-settings-nav-scroll', ov) || ov;
    if (!navScroll) return;

    const items = $$('.nc-settings-item[data-page]', navScroll);
    const groups = $$('.nc-settings-group', navScroll);
    const seps = $$('.nc-settings-sep', navScroll);
    const footer = $('.nc-settings-footer', navScroll);

    // Items
    items.forEach((btn)=>{
      const hay = buildHaystackForItem(btn);
      setVisible(btn, !needle || hay.includes(needle));
    });

    // Group headers: show only if they have any visible items until next group/sep/footer
    groups.forEach((g)=>{
      let any = false;
      let el = g.nextElementSibling;
      while(el){
        if (el === footer) break;
        if (el.classList && el.classList.contains('nc-settings-group')) break;
        if (el.classList && el.classList.contains('nc-settings-sep')) break;
        if (el.classList && el.classList.contains('nc-settings-item') && visible(el)) { any = true; break; }
        el = el.nextElementSibling;
      }
      setVisible(g, !needle ? true : any);
    });

    // Separators: hide when search is active OR if there are no visible items after it
    seps.forEach((s)=>{
      if (needle) { setVisible(s, false); return; }
      let any = false;
      let el = s.nextElementSibling;
      while(el){
        if (el === footer) break;
        if (el.classList && el.classList.contains('nc-settings-item') && visible(el)) { any = true; break; }
        el = el.nextElementSibling;
      }
      setVisible(s, any);
    });
  }

  function firstVisibleNavItem(ov){
    const navScroll = $('#nc-settings-nav-scroll', ov) || ov;
    const btn = $$('.nc-settings-item[data-page]', navScroll).find(b => b.style.display !== 'none');
    return btn || null;
  }

  function restoreLastPage(ov){
    const last = normalize(readLS(KEY_LAST_PAGE, ''));
    if (!last) return;
    if (last === 'logout') return; // don't reopen dangerous page

    // click target page
    const btn = ov.querySelector(`.nc-settings-item[data-page="${CSS.escape(last)}"]`);
    if (btn) {
      try{ btn.click(); }catch(e){}
    }

    // restore VV tab
    if (last === 'voicevideo'){
      const vv = normalize(readLS(KEY_LAST_VVTAB, ''));
      if (vv){
        const sub = ov.querySelector(`.nc-settings-subitem[data-vvtab="${CSS.escape(vv)}"]`);
        if (sub) { try{ sub.click(); }catch(e){} }
      }
    }
  }

  function bind(){
    const ov = document.getElementById('nc-settings-overlay');
    if (!ov) return;

    const search = document.getElementById('nc-settings-search');
    if (search && !search.__ncFix255Bound){
      search.__ncFix255Bound = true;

      // override/upgrade search results after main.js filterNav runs
      const run = ()=>{ try{ filterNavBetter(ov, search.value || ''); }catch(e){} };

      search.addEventListener('input', ()=>{
        // defer so main.js filterNav runs first (then we override)
        setTimeout(run, 0);
      }, true);

      search.addEventListener('keydown', (e)=>{
        const k = e.key || '';
        if (k === 'Escape'){
          try{ search.value = ''; }catch(_){ }
          setTimeout(()=>{ try{ filterNavBetter(ov, ''); }catch(err){} }, 0);
          try{ e.preventDefault(); }catch(_){ }
          return;
        }
        if (k === 'Enter'){
          const first = firstVisibleNavItem(ov);
          if (first) {
            try{ first.click(); }catch(_){ }
            try{ e.preventDefault(); }catch(_){ }
          }
        }
      }, true);
    }

    // remember page & vv tab
    ov.addEventListener('click', (e)=>{
      const t = e.target;
      if (!t || !t.closest) return;
      const item = t.closest('.nc-settings-item[data-page]');
      if (item){
        const page = normalize(item.getAttribute('data-page') || '');
        if (page && page !== 'logout') writeLS(KEY_LAST_PAGE, page);
      }
      const vv = t.closest('.nc-settings-subitem[data-vvtab]');
      if (vv){
        writeLS(KEY_LAST_PAGE, 'voicevideo');
        const tab = normalize(vv.getAttribute('data-vvtab') || '');
        if (tab) writeLS(KEY_LAST_VVTAB, tab);
      }
      const nf = t.closest('.nc-settings-subitem[data-nftab]');
      if (nf){
        writeLS(KEY_LAST_PAGE, 'notifications');
      }
    }, true);

    // restore last page whenever settings opens
    if (typeof window.ncOpenSettingsModal === 'function' && !window.ncOpenSettingsModal.__ncFix255Wrapped){
      const orig = window.ncOpenSettingsModal;
      const wrapped = function(){
        orig.apply(this, arguments);
        // If mobile, avoid keyboard pop
        try{
          if (window.innerWidth <= 680 && document.activeElement === search) search.blur();
        }catch(e){}
        setTimeout(()=>{ try{ restoreLastPage(ov); }catch(e){} }, 0);
      };
      wrapped.__ncFix255Wrapped = true;
      window.ncOpenSettingsModal = wrapped;
    }

    // also handle cases where modal is opened without calling ncOpenSettingsModal
    if (window.MutationObserver){
      try{
        let wasOpen = isOverlayOpen(ov);
        const mo = new MutationObserver(()=>{
          const now = isOverlayOpen(ov);
          if (now && !wasOpen) {
            wasOpen = true;
            setTimeout(()=>{ try{ restoreLastPage(ov); }catch(e){} }, 0);
          }
          if (!now) wasOpen = false;
        });
        mo.observe(ov, { attributes:true, attributeFilter:['class','aria-hidden','hidden','style'] });
      }catch(e){}
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();


/* Fix258: Privacy & content settings that affect real behaviour
   - Shows and edits local Ignore/Block lists inside Settings -> Privacy
   - Works with existing main.js keys: ignored_users / blocked_users
   - Calls window.__ncReloadIgnoreLists() so voice rosters & UI refresh
*/
(function(){
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);

  function parseIdSet(key){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr.map(x => String(parseInt(x, 10) || 0)).filter(x => x && x !== '0'));
    }catch(e){
      return new Set();
    }
  }

  function saveIdSet(key, set){
    try{ localStorage.setItem(key, JSON.stringify(Array.from(set))); }catch(e){}
  }

  function userLabelById(id){
    const sid = String(id || '').trim();
    if (!sid) return '#' + sid;
    try{
      // Try to resolve username from any list item already in DOM
      const sel = `.friend-item[data-user-id="${CSS.escape(sid)}"], .dm-entry[data-user-id="${CSS.escape(sid)}"], .friends-page-item[data-user-id="${CSS.escape(sid)}"]`;
      const el = document.querySelector(sel);
      if (el){
        const ds = (el.dataset && (el.dataset.username || el.dataset.userName)) ? String(el.dataset.username || el.dataset.userName) : '';
        const nm = ds || (el.querySelector('.friend-name') ? el.querySelector('.friend-name').textContent : '');
        const v = String(nm || '').trim();
        if (v) return '@' + v;
      }
    }catch(e){}
    return 'ID ' + sid;
  }

  function renderInto(container){
    const blocked = parseIdSet('blocked_users');
    const ignored = parseIdSet('ignored_users');

    const list = container.querySelector('.nc-privacy-list');
    const empty = container.querySelector('.nc-privacy-empty');
    const bCount = container.querySelector('[data-nc-count="blocked"]');
    const iCount = container.querySelector('[data-nc-count="ignored"]');

    if (bCount) bCount.textContent = String(blocked.size);
    if (iCount) iCount.textContent = String(ignored.size);

    if (!list) return;
    list.innerHTML = '';

    function addRow(kind, id){
      const row = document.createElement('div');
      row.className = 'nc-privacy-row';
      row.dataset.kind = kind;
      row.dataset.uid = String(id);
      row.innerHTML = `
        <div class="nc-privacy-meta">
          <div class="nc-privacy-title">${kind === 'blocked' ? 'Заблокирован' : 'Игнор'}</div>
          <div class="nc-privacy-sub">${userLabelById(id)}</div>
        </div>
        <div class="nc-privacy-actions">
          <button class="btn-sm" type="button" data-action="remove">Убрать</button>
        </div>
      `;
      list.appendChild(row);
    }

    Array.from(blocked).sort().forEach(id => addRow('blocked', id));
    Array.from(ignored).sort().forEach(id => addRow('ignored', id));

    if (empty) empty.classList.toggle('is-hidden', (blocked.size + ignored.size) > 0);

    // Bind buttons
    list.querySelectorAll('button[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.nc-privacy-row');
        if (!row) return;
        const kind = String(row.dataset.kind || '');
        const uid = String(row.dataset.uid || '');
        if (!uid) return;

        const sBlocked = parseIdSet('blocked_users');
        const sIgnored = parseIdSet('ignored_users');
        if (kind === 'blocked') sBlocked.delete(uid);
        if (kind === 'ignored') sIgnored.delete(uid);
        saveIdSet('blocked_users', sBlocked);
        saveIdSet('ignored_users', sIgnored);

        try{ if (typeof window.__ncReloadIgnoreLists === 'function') window.__ncReloadIgnoreLists(); }catch(e){}
        try{ if (typeof window.ncToast === 'function') window.ncToast('Готово.'); }catch(e){}

        renderInto(container);
      }, { passive:true });
    });
  }

  function ensureSection(){
    const page = document.querySelector('.nc-settings-page[data-page="privacy"]');
    if (!page) return;
    if (page.querySelector('.nc-privacy-blocklist')) return;

    const sec = document.createElement('div');
    sec.className = 'nc-vv-section nc-privacy-blocklist';
    sec.innerHTML = `
      <div class="nc-vv-h2">Блокировки и игнор</div>
      <div class="nc-vv-muted">Это локальные списки (клиент): скрывают пользователя в интерфейсе и в списках звонка.</div>

      <div class="nc-privacy-stats">
        <div class="nc-settings-muted">Заблокировано: <b data-nc-count="blocked">0</b></div>
        <div class="nc-settings-muted">Игнор: <b data-nc-count="ignored">0</b></div>
      </div>

      <div class="nc-privacy-empty nc-settings-muted">Списки пустые.</div>
      <div class="nc-privacy-list"></div>

      <div class="nc-privacy-footer">
        <button class="btn" type="button" data-action="clear">Очистить списки</button>
      </div>
    `;

    page.appendChild(sec);

    const clearBtn = sec.querySelector('button[data-action="clear"]');
    if (clearBtn){
      clearBtn.addEventListener('click', () => {
        try{
          if (!confirm('Очистить списки блокировок и игнора?')) return;
        }catch(e){}
        try{ localStorage.setItem('blocked_users', '[]'); }catch(e){}
        try{ localStorage.setItem('ignored_users', '[]'); }catch(e){}
        try{ if (typeof window.__ncReloadIgnoreLists === 'function') window.__ncReloadIgnoreLists(); }catch(e){}
        try{ if (typeof window.ncToast === 'function') window.ncToast('Списки очищены.'); }catch(e){}
        renderInto(sec);
      });
    }

    renderInto(sec);
  }

  function bind(){
    const ov = document.getElementById('nc-settings-overlay');
    if (!ov) return;

    // Render when settings opens and when privacy page is clicked
    const renderSoon = () => setTimeout(ensureSection, 0);

    // click in nav
    ov.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.nc-settings-item[data-page="privacy"]') : null;
      if (btn) renderSoon();
    }, true);

    // observe open
    if (window.MutationObserver){
      try{
        let lastOpen = false;
        const isOpen = () => {
          try{
            if (ov.classList.contains('is-hidden')) return false;
            if (ov.getAttribute('aria-hidden') === 'true') return false;
            return true;
          }catch(e){ return false; }
        };
        const mo = new MutationObserver(() => {
          const now = isOpen();
          if (now && !lastOpen) renderSoon();
          lastOpen = now;
        });
        mo.observe(ov, { attributes:true, attributeFilter:['class','aria-hidden','hidden','style'] });
      }catch(e){}
    }

    // first run (if already open)
    renderSoon();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();


(function(){
  'use strict';

  const COOKIE_NAME = 'nc_auth_s';
  const GEO_KEY = 'nc_sessions_geo';
  const $ = (s, r) => (r || document).querySelector(s);

  let booted = false;
  let inFlight = false;

  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function boolish(v){
    if (v === true || v === false) return v;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }
  function geoEnabled(){ return boolish(lsGet(GEO_KEY)); }
  async function persistGeoPref(next){
    const val = next ? '1' : '0';
    lsSet(GEO_KEY, val);
    try{
      await fetch('/api/settings_kv', {
        method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ patch: { [GEO_KEY]: val } })
      });
    }catch(e){}
  }
  function toast(msg){
    try{ if (window.showToast) return window.showToast(String(msg||'')); }catch(e){}
    try{ if (window.ncToast) return window.ncToast(String(msg||'')); }catch(e){}
    try{ console.log('[Devices]', msg); }catch(e){}
  }
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDT(iso){
    try{
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return new Intl.DateTimeFormat(undefined, { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(d);
    }catch(e){ return String(iso || '—'); }
  }
  function geoText(g){
    if (!g) return '';
    return [g.city, g.region, g.country_code || g.country].filter(Boolean).join(', ');
  }
  function stateClass(status){
    const s = String(status || '').toLowerCase();
    if (s.includes('success')) return 'is-ok';
    if (s.includes('rate') || s.includes('blocked')) return 'is-warn';
    return 'is-bad';
  }
  function statusLabel(status){
    const map = {
      success_login: 'Вход',
      success_2fa: '2FA',
      bad_password: 'Неверный пароль',
      bad_2fa: 'Неверный 2FA',
      bad_login: 'Неверный логин',
      bad_captcha_login: 'Провален human-check',
      bad_captcha_2fa: 'Провален human-check 2FA',
      rate_limited_login: 'Лимит входа',
      rate_limited_2fa: 'Лимит 2FA',
      blocked_login: 'Блок входа',
      blocked_2fa: 'Блок 2FA'
    };
    return map[status] || status || 'Событие';
  }
  function svgWrap(kind, svg){
    return '<span class="nc-browser-glyph nc-browser-glyph--' + kind + '" aria-hidden="true">' + svg + '</span>';
  }
  function iconFor(browser){
    const b = String(browser||'').toLowerCase();
    if (b.includes('chrome')) return svgWrap('chrome',
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="12" cy="12" r="11" fill="#ffffff"/>' +
      '<path d="M12 12 21.5 12A9.5 9.5 0 0 0 8.7 3.1Z" fill="#EA4335"/>' +
      '<path d="M12 12 7.4 19.9A9.5 9.5 0 0 0 21.5 12Z" fill="#34A853"/>' +
      '<path d="M12 12 8.7 3.1A9.5 9.5 0 0 0 7.4 19.9Z" fill="#FBBC05"/>' +
      '<circle cx="12" cy="12" r="4.15" fill="#4285F4" stroke="#ffffff" stroke-width="1.05"/>' +
      '<circle cx="12" cy="12" r="11" stroke="rgba(0,0,0,.08)" stroke-width="1"/>' +
      '</svg>'
    );
    if (b.includes('yandex')) return svgWrap('yandex',
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="12" cy="12" r="10.5" fill="#FFFFFF" stroke="#D7DEE8" stroke-width="1"/>' +
      '<path d="M7.4 7.25L12 12.05" stroke="#F7B733" stroke-width="3.15" stroke-linecap="round"/>' +
      '<path d="M16.6 7.25L12 12.05" stroke="#F24848" stroke-width="3.15" stroke-linecap="round"/>' +
      '<path d="M12 12.05V17" stroke="#6C7280" stroke-width="3.15" stroke-linecap="round"/>' +
      '</svg>'
    );
    if (b.includes('edge')) return '<span class="nc-browser-glyph nc-browser-glyph--edge" aria-hidden="true"><img class="nc-browser-glyph-img nc-browser-glyph-img--edge" src="/static/browser_icons/edge_exact_v31.png" alt=""></span>';
    if (b.includes('firefox')) return svgWrap('firefox',
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="ffg" x1="5" y1="4" x2="19" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="#FFB200"/><stop offset=".55" stop-color="#FF6A00"/><stop offset="1" stop-color="#D93AFF"/></linearGradient></defs>' +
      '<path d="M18.4 7.1c-.3-1.7-1.6-3-3.2-3.8.4.9.3 1.8-.2 2.6-1-1.2-2.6-1.9-4.5-1.9-3.5 0-6.4 2.7-6.4 6.2 0 3.4 2.8 6.3 6.7 6.3 4.8 0 8.3-3.7 7.6-9.4Z" fill="url(#ffg)"/>' +
      '<path d="M10.6 18.9c-3.2 0-5.8-2.2-5.8-5.1 0-1.9 1.1-3.6 2.8-4.5-.2 1.4.7 2.8 2.2 3.2-.1-1.2.5-2.6 1.6-3.5 2.4.6 4.2 2.5 4.2 5 0 2.8-2.2 4.9-5 4.9Z" fill="#40123E" opacity=".24"/>' +
      '<path d="M11 18.3c2.6 0 4.7-1.7 4.7-3.9 0-2.1-1.9-3.8-4.4-3.9-.7.6-1.2 1.6-1.2 2.7-.9-.3-1.6-1-1.8-1.9-1 .6-1.6 1.7-1.6 2.9 0 2.3 1.9 4.1 4.3 4.1Z" fill="#FFE4A3" opacity=".18"/>' +
      '</svg>'
    );
    if (b.includes('opera')) return svgWrap('opera',
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="opg" x1="6" y1="4" x2="18" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="#FF5A71"/><stop offset="1" stop-color="#C4002F"/></linearGradient></defs>' +
      '<path d="M12 4c4.1 0 7.2 3.4 7.2 8s-3.1 8-7.2 8-7.2-3.4-7.2-8 3.1-8 7.2-8Zm0 2.4c-2.4 0-4.2 2.4-4.2 5.6s1.8 5.6 4.2 5.6 4.2-2.4 4.2-5.6-1.8-5.6-4.2-5.6Z" fill="url(#opg)"/>' +
      '</svg>'
    );
    if (b.includes('safari')) return svgWrap('safari',
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="12" cy="12" r="9.5" fill="#5CB9FF" stroke="rgba(255,255,255,.9)" stroke-width="1"/>' +
      '<circle cx="12" cy="12" r="7.1" stroke="rgba(255,255,255,.75)" stroke-width="1" opacity=".9"/>' +
      '<path d="M12 7.2 13.7 12 12 16.8 10.3 12 12 7.2Z" fill="#fff"/>' +
      '<path d="M16.8 12 12 13.7 7.2 12 12 10.3 16.8 12Z" fill="#FF5A71" opacity=".95"/>' +
      '</svg>'
    );
    return svgWrap('generic',
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="4" y="5" width="16" height="11" rx="2.5" stroke="rgba(255,255,255,.9)" stroke-width="1.6"/>' +
      '<path d="M9 19h6" stroke="rgba(255,255,255,.9)" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M12 16v3" stroke="rgba(255,255,255,.9)" stroke-width="1.6" stroke-linecap="round"/>' +
      '</svg>'
    );
  }
  function isDevicesActive(){
    const ov = $('#nc-settings-overlay');
    if (!ov) return false;
    if (ov.classList.contains('is-hidden')) return false;
    if (ov.getAttribute('aria-hidden') === 'true') return false;
    const page = $('.nc-settings-page[data-page="devices"]', ov);
    return !!(page && page.classList.contains('is-active'));
  }
  async function apiGetAudit(includeGeo){
    const url = includeGeo ? '/api/auth/audit?geo=1' : '/api/auth/audit';
    const r = await fetch(url, { credentials:'include' });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok || !j || j.ok !== true) throw new Error((j && j.error) || 'Не удалось загрузить данные');
    return j;
  }
  async function apiRevoke(id){
    const r = await fetch('/api/auth/sessions/revoke', {
      method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ session_id: Number(id) })
    });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok || !j || j.ok !== true) throw new Error((j && j.error) || 'Не удалось завершить сеанс');
    return j;
  }
  async function apiRevokeAll(){
    const r = await fetch('/api/auth/sessions/revoke_all', { method:'POST', credentials:'include' });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok || !j || j.ok !== true) throw new Error((j && j.error) || 'Не удалось выйти со всех устройств');
    return j;
  }
  async function apiUnblock(blockId){
    const r = await fetch('/api/admin/security/unblock', {
      method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ block_id: Number(blockId) })
    });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok || !j || j.ok !== true) throw new Error((j && j.error) || 'Не удалось снять блок');
    return j;
  }
  function empty(text){ return '<div class="nc-settings-muted">' + esc(text) + '</div>'; }
  function renderSessions(listEl, sessions){
    if (!listEl) return;
    if (!Array.isArray(sessions) || !sessions.length){ listEl.innerHTML = empty('Активных сеансов не найдено.'); return; }
    listEl.innerHTML = sessions.map(s => {
      const title = [s.browser, s.os].filter(Boolean).join(' · ') || 'Устройство';
      const badge = s.is_current ? '<span class="nc-device-badge">Вы сейчас здесь</span>' : '';
      const geo = geoText(s.geo);
      const deviceLine = s.is_current ? 'Сейчас вы вошли на сайте с этого браузера' : 'Сеанс входа';
      const ipLine = [deviceLine, s.ip_address ? ('IP: ' + esc(s.ip_address)) : 'IP: —', geo ? esc(geo) : ''].filter(Boolean).join(' · ');
      const line = [ipLine, 'Вход: ' + esc(fmtDT(s.created_at)), 'Активность: ' + esc(fmtDT(s.last_seen_at))].join(' · ');
      return '<div class="nc-device-item" data-sid="' + esc(s.id) + '">' +
        '<div class="nc-device-left"><div class="nc-device-ico" aria-hidden="true">' + iconFor(s.browser) + '</div>' +
        '<div class="nc-device-meta"><div class="nc-device-title"><span>' + esc(title) + '</span>' + badge + '</div>' +
        '<div class="nc-device-sub">' + line + '</div></div></div>' +
        '<div class="nc-device-actions"><button class="nc-btn danger ghost nc-device-logout" type="button">' + esc(s.is_current ? 'Выйти с этого устройства' : 'Выйти') + '</button></div></div>';
    }).join('');
  }
  function renderAuditList(listEl, rows, opts){
    if (!listEl) return;
    if (!Array.isArray(rows) || !rows.length){ listEl.innerHTML = empty((opts && opts.empty) || 'Пока пусто.'); return; }
    listEl.innerHTML = rows.map(r => {
      const geo = geoText(r.geo);
      const meta = [r.browser, r.os, r.ip_address ? ('IP: ' + r.ip_address) : '', geo].filter(Boolean).join(' · ');
      const note = r.note ? (' · ' + esc(r.note)) : '';
      const login = r.login_value ? '<span class="nc-audit-login">' + esc(r.login_value) + '</span>' : '';
      return '<div class="nc-audit-item">' +
        '<div class="nc-device-left"><div class="nc-device-ico" aria-hidden="true">' + iconFor(r.browser) + '</div>' +
        '<div class="nc-device-meta"><div class="nc-device-title"><span class="nc-audit-badge ' + stateClass(r.status) + '">' + esc(statusLabel(r.status)) + '</span>' + login + '</div>' +
        '<div class="nc-device-sub">' + esc(fmtDT(r.created_at)) + (meta ? (' · ' + esc(meta)) : '') + note + '</div></div></div>' +
        '</div>';
    }).join('');
  }
  function renderSecurityDashboard(ov, data){
    const wrap = $('#nc-security-dashboard', ov);
    if (!wrap) return;
    const isAdmin = !!data.show_invalid_logins;
    wrap.style.display = isAdmin ? '' : 'none';
    if (!isAdmin) return;
    const blocksCount = $('#nc-security-blocks-count', ov);
    const topIp = $('#nc-security-top-ip', ov);
    const topIpCount = $('#nc-security-top-ip-count', ov);
    const openAdmin = $('#nc-security-open-admin', ov);
    const list = $('#nc-security-blocks-list', ov);
    if (blocksCount) blocksCount.textContent = String(data.active_blocks_count || 0);
    const top = Array.isArray(data.top_ip_activity) && data.top_ip_activity.length ? data.top_ip_activity[0] : null;
    if (topIp) topIp.textContent = top && top.ip_address ? top.ip_address : '—';
    if (topIpCount) topIpCount.textContent = String(top && top.count ? top.count : 0);
    if (openAdmin && (data.admin_dashboard_url || data.admin_security_url)) openAdmin.href = (data.admin_dashboard_url || data.admin_security_url);
    const rows = Array.isArray(data.active_blocks) ? data.active_blocks : [];
    if (!rows.length){ list.innerHTML = empty('Сейчас активных блокировок нет.'); return; }
    list.innerHTML = rows.map(r => {
      return '<div class="nc-audit-item nc-security-block-item" data-block-id="' + esc(r.id) + '">' +
        '<div class="nc-device-left"><div class="nc-device-meta"><div class="nc-device-title">' +
        '<span class="nc-audit-badge is-warn">' + esc((r.scope_type || 'block') + ' · ' + (r.phase || 'login')) + '</span>' +
        '<span class="nc-audit-login">' + esc(r.scope_value || '—') + '</span></div>' +
        '<div class="nc-device-sub">' + esc(r.reason || 'Временная блокировка') + ' · До: ' + esc(fmtDT(r.expires_at)) + '</div></div></div>' +
        '<div class="nc-device-actions"><button class="nc-btn danger ghost nc-security-unblock" type="button">Снять</button></div></div>';
    }).join('');
  }
  async function load(){
    const ov = $('#nc-settings-overlay');
    if (!ov || inFlight) return;
    const listEl = $('#nc-devices-list', ov);
    const loading = $('#nc-devices-loading', ov);
    if (!listEl) return;
    inFlight = true;
    try{
      if (loading) loading.style.display = '';
      const data = await apiGetAudit(geoEnabled());
      renderSessions(listEl, data.sessions || []);
      renderAuditList($('#nc-login-history-list', ov), data.history || [], { empty:'Успешных входов пока нет.' });
      renderAuditList($('#nc-login-failed-list', ov), data.failed || [], { empty:'Неудачных попыток пока нет.' });
      const invalidSection = $('#nc-invalid-login-section', ov);
      if (invalidSection) invalidSection.style.display = data.show_invalid_logins ? '' : 'none';
      renderAuditList($('#nc-invalid-login-list', ov), data.invalid_logins || [], { empty:'Нет попыток с несуществующим логином.' });
      renderSecurityDashboard(ov, data || {});
      wireSessionButtons(ov);
      wireSecurityButtons(ov);
      wireNotMe(ov);
    }catch(e){
      toast((e && e.message) ? e.message : 'Ошибка загрузки');
      listEl.innerHTML = empty('Не удалось загрузить список устройств.');
    }finally{
      try{ if (loading) loading.style.display = 'none'; }catch(e){}
      inFlight = false;
    }
  }
  function wireSessionButtons(ov){
    const listEl = $('#nc-devices-list', ov);
    if (!listEl || listEl.dataset.ncWired === '1') return;
    listEl.dataset.ncWired = '1';
    listEl.addEventListener('click', async (e)=>{
      const btn = e.target && e.target.closest ? e.target.closest('.nc-device-logout') : null;
      if (!btn) return;
      const item = btn.closest('.nc-device-item');
      const sid = item ? item.getAttribute('data-sid') : null;
      if (!sid) return;
      const isCurrent = !!(item.querySelector('.nc-device-badge'));
      if (!confirm(isCurrent ? 'Выйти с этого устройства? Вас перекинет на страницу входа.' : 'Завершить этот сеанс?')) return;
      btn.disabled = true;
      try{
        const res = await apiRevoke(sid);
        if (res.logged_out){ location.href = '/login'; return; }
        toast('Сеанс завершён');
        listEl.dataset.ncWired = '0';
        await load();
      }catch(err){ toast((err && err.message) ? err.message : 'Ошибка'); btn.disabled = false; }
    }, true);
  }
  function wireSecurityButtons(ov){
    const wrap = $('#nc-security-blocks-list', ov);
    if (!wrap || wrap.dataset.ncWired === '1') return;
    wrap.dataset.ncWired = '1';
    wrap.addEventListener('click', async (e)=>{
      const btn = e.target && e.target.closest ? e.target.closest('.nc-security-unblock') : null;
      if (!btn) return;
      const item = btn.closest('.nc-security-block-item');
      const blockId = item ? item.getAttribute('data-block-id') : null;
      if (!blockId) return;
      if (!confirm('Снять эту блокировку?')) return;
      btn.disabled = true;
      try{
        await apiUnblock(blockId);
        toast('Блокировка снята');
        wrap.dataset.ncWired = '0';
        await load();
      }catch(err){ toast((err && err.message) ? err.message : 'Ошибка'); btn.disabled = false; }
    }, true);
  }
  function wireLogoutAll(){
    const ov = $('#nc-settings-overlay');
    if (!ov) return;
    const btn = $('#nc-devices-logout-all', ov);
    if (!btn || btn.dataset.ncWired === '1') return;
    btn.dataset.ncWired = '1';
    btn.addEventListener('click', async ()=>{
      if (!confirm('Выйти со всех устройств? Это завершит все сеансы и потребует вход заново.')) return;
      btn.disabled = true;
      try{ await apiRevokeAll(); location.href = '/login'; }catch(e){ toast((e && e.message) ? e.message : 'Ошибка'); btn.disabled = false; }
    });
  }
  function wireNotMe(ov){
    const btn = $('#nc-devices-not-me', ov);
    if (!btn || btn.dataset.ncWired === '1') return;
    btn.dataset.ncWired = '1';
    btn.addEventListener('click', async ()=>{
      if (!confirm('Подозрительная активность? Вы выйдете со всех устройств. После этого лучше сразу сменить пароль.')) return;
      btn.disabled = true;
      try{
        await apiRevokeAll();
        location.href = '/login?reason=not_me';
      }catch(e){ toast((e && e.message) ? e.message : 'Ошибка'); btn.disabled = false; }
    });
  }
  function wireGeoToggle(){
    const ov = $('#nc-settings-overlay');
    if (!ov) return;
    const btn = $('#nc-devices-geo-toggle', ov);
    if (!btn || btn.dataset.ncWired === '1') return;
    btn.dataset.ncWired = '1';
    function apply(){
      const on = geoEnabled();
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
    }
    apply();
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      try{ await persistGeoPref(btn.getAttribute('aria-pressed') !== 'true'); }finally{ btn.disabled = false; }
      apply();
      try{ await load(); }catch(e){}
    }, { passive:false });
  }
  function boot(){
    if (booted) return;
    booted = true;
    document.addEventListener('click', function(e){
      const b = e.target && e.target.closest ? e.target.closest('.nc-settings-item[data-page="devices"]') : null;
      if (!b) return;
      setTimeout(function(){ try{ wireLogoutAll(); wireGeoToggle(); load(); }catch(e){} }, 0);
    }, true);
    const ov = $('#nc-settings-overlay');
    if (ov){
      const mo = new MutationObserver(()=>{ if (isDevicesActive()) { try{ wireLogoutAll(); wireGeoToggle(); load(); }catch(e){} } });
      mo.observe(ov, { attributes:true, attributeFilter:['class','aria-hidden'] });
      const page = $('.nc-settings-page[data-page="devices"]', ov);
      if (page){
        const mo2 = new MutationObserver(()=>{ if (isDevicesActive()) { try{ wireLogoutAll(); wireGeoToggle(); load(); }catch(e){} } });
        mo2.observe(page, { attributes:true, attributeFilter:['class'] });
      }
    }
    setTimeout(function(){ if (isDevicesActive()) { try{ wireLogoutAll(); wireGeoToggle(); load(); }catch(e){} } }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();


// FIX32: keep range sliders perfectly styled (emerald fill) by updating CSS --fill.
// Applies to Appearance sliders (.nc-ap-range) and Theme Preview sliders (.nc-tp-slider).
(function(){
  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
  function update(input){
    try{
      if(!input) return;
      const min = parseFloat(input.min || '0');
      const max = parseFloat(input.max || '100');
      const val = parseFloat(input.value || '0');
      const pct = (max<=min) ? 0 : ((val-min)/(max-min))*100;
      input.style.setProperty('--fill', String(clamp(pct, 0, 100)));
    }catch(e){}
  }

  function bind(input){
    if(!input || input.__ncFillBound) return;
    input.__ncFillBound = true;
    update(input);
    input.addEventListener('input', function(){ update(input); }, { passive: true });
    input.addEventListener('change', function(){ update(input); }, { passive: true });
  }

  function scan(root){
    try{
      (root||document).querySelectorAll('.nc-ap-range input[type=\"range\"], .nc-tp-slider input[type=\"range\"], .nc-vv-range input[type=\"range\"], .volume-slider input[type=\"range\"], .nc-nf-range input[type=\"range\"]').forEach(bind);
    }catch(e){}
  }

  function boot(){
    scan(document);
    // In case the settings modal gets rebuilt dynamically:
    document.addEventListener('click', function(){
      // cheap rescan; only binds once due to __ncFillBound guard
      scan(document);
    }, { passive: true });

    document.addEventListener('focusin', function(e){
      const t = e && e.target;
      if(t && t.matches && t.matches('input[type="range"]')) update(t);
    }, { passive: true });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }else{
    boot();
  }
})();

// v9.13 fix41 (fix255): Voice & Video left-subnav (Discord-like)
// - Left sub-items under "Голос и видео" switch sections
// - Keeps in sync with top tabs (.nc-vv-tab) managed by main.js
// - Stabilized: removed polling interval; now event-driven + MutationObserver

(function(){
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const $  = (sel, root=document) => root.querySelector(sel);

  function getOverlay(){ return document.getElementById('nc-settings-overlay'); }
  function getSubnav(){ return document.querySelector('.nc-vv-subnav[data-parent="voicevideo"]'); }

  function isSettingsOpen(){
    const ov = getOverlay();
    if (!ov) return false;
    if (ov.classList && ov.classList.contains('is-hidden')) return false;
    if (ov.getAttribute && ov.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  function setLeftMode(on){
    try{ document.body.classList.toggle('nc-vv-leftsub', !!on); }catch(e){}
  }

  function showSubnav(show){
    const sub = getSubnav();
    if (!sub) return;
    try{ sub.classList.toggle('is-hidden', !show); }catch(e){}
    try{ sub.setAttribute('aria-hidden', show ? 'false' : 'true'); }catch(e){}
    setLeftMode(!!show && isSettingsOpen());
  }

  function currentTopTab(){
    const t = document.querySelector('.nc-vv-tab.is-active[data-vvtab]');
    return (t && t.getAttribute('data-vvtab')) || 'voice';
  }

  function setSubActive(tab){
    $$('.nc-settings-subitem[data-vvtab]').forEach(btn=>{
      const t = btn.getAttribute('data-vvtab') || '';
      const on = t === tab;
      try{ btn.classList.toggle('is-active', on); }catch(e){}
      try{ btn.setAttribute('aria-selected', on ? 'true' : 'false'); }catch(e){}
    });
  }

  function ensureVoiceVideoPage(){
    const navBtn = document.querySelector('.nc-settings-item[data-page="voicevideo"]');
    if (!navBtn) return;
    if (navBtn.classList && navBtn.classList.contains('is-active')) return;
    try{ navBtn.click(); }catch(e){}
  }

  function clickTopTab(tab){
    const btn = document.querySelector('.nc-vv-tab[data-vvtab="' + tab + '"]');
    if (btn) {
      try{ btn.click(); return true; }catch(e){ }
    }

    // Fallback (if main.js handlers are missing for some reason)
    $$('.nc-vv-tab').forEach(b=>{
      const on = (b.getAttribute('data-vvtab')||'') === tab;
      try{ b.classList.toggle('is-active', on); }catch(e){}
      try{ b.setAttribute('aria-selected', on ? 'true' : 'false'); }catch(e){}
    });
    $$('.nc-vv-pane').forEach(p=>{
      const on = (p.getAttribute('data-vvtab')||'') === tab;
      try{ p.classList.toggle('is-active', on); }catch(e){}
      try{ p.style.display = on ? '' : 'none'; }catch(e){}
    });
    return true;
  }

  function onSubItemClick(btn, ev){
    const tab = btn.getAttribute('data-vvtab') || 'voice';
    try{ ev && ev.preventDefault(); }catch(e){}
    try{ ev && ev.stopPropagation(); }catch(e){}

    ensureVoiceVideoPage();
    showSubnav(true);
    setSubActive(tab);
    clickTopTab(tab);
  }

  function handleNavClick(btn){
    const page = btn.getAttribute('data-page') || '';
    if (page === 'voicevideo') {
      showSubnav(true);
      setSubActive(currentTopTab());
    } else {
      showSubnav(false);
    }
  }

  function bind(){
    const ov = getOverlay();
    if (!ov) return;

    // Left navigation (settings)
    ov.addEventListener('click', (ev)=>{
      const t = ev && ev.target;
      if (!t || !t.closest) return;

      const sub = t.closest('.nc-settings-subitem[data-vvtab]');
      if (sub) return onSubItemClick(sub, ev);

      const nav = t.closest('.nc-settings-item[data-page]');
      if (nav) return handleNavClick(nav);
    }, true);

    // Sync: when top tabs are used, keep left sub-items in sync
    document.addEventListener('click', (ev)=>{
      const t = ev && ev.target;
      if (!t || !t.closest) return;
      const tabBtn = t.closest('.nc-vv-tab[data-vvtab]');
      if (!tabBtn) return;
      const tab = tabBtn.getAttribute('data-vvtab') || 'voice';
      setSubActive(tab);
      showSubnav(true);
    }, true);

    // Keep state correct when settings opens/closes or active page changes.
    const sync = ()=>{
      const open = isSettingsOpen();
      const activeVV = document.querySelector('.nc-settings-item.is-active[data-page="voicevideo"]');
      if (open && activeVV) {
        showSubnav(true);
        setSubActive(currentTopTab());
      } else {
        showSubnav(false);
      }
    };

    try{ sync(); }catch(e){}

    // Observe open/close changes
    if (window.MutationObserver){
      try{
        const mo = new MutationObserver(()=>{ try{ sync(); }catch(e){} });
        mo.observe(ov, { attributes:true, attributeFilter:['class','aria-hidden','hidden','style'] });
      }catch(e){}
    }

    // Observe nav for class toggles ("is-active")
    if (window.MutationObserver){
      try{
        const nav = ov.querySelector('.nc-settings-nav');
        if (nav){
          const mo2 = new MutationObserver((muts)=>{
            for (const m of muts){
              if (m.type === 'attributes' && m.attributeName === 'class'){
                try{ sync(); }catch(e){}
                break;
              }
            }
          });
          mo2.observe(nav, { subtree:true, attributes:true, attributeFilter:['class'] });
        }
      }catch(e){}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();


// v9.13 fix42 (fix255): Notifications left-subnav (Discord-like) + remember last tab
// - Shows sub-items under "Уведомления"
// - Remembers last selected tab (localStorage: nc_nf_lasttab)
// - Linked settings: Voice&Video -> Notifications -> Sounds, and back.
// - Stabilized: removed polling interval; now event-driven + MutationObserver

(function(){
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const $  = (sel, root=document) => root.querySelector(sel);

  const KEY_LASTTAB = 'nc_nf_lasttab';
  const KEY_STATE   = 'nc_nf_state_v1';

  function getOverlay(){ return document.getElementById('nc-settings-overlay'); }
  function getSubnav(){ return document.querySelector('.nc-nf-subnav[data-parent="notifications"]'); }
  function getPage(){ return document.querySelector('.nc-settings-page[data-page="notifications"]'); }

  function isSettingsOpen(){
    const ov = getOverlay();
    if (!ov) return false;
    if (ov.classList && ov.classList.contains('is-hidden')) return false;
    if (ov.getAttribute && ov.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  function readLastTab(){
    try{
      const v = (localStorage.getItem(KEY_LASTTAB) || '').toLowerCase();
      if (v) return v;
    }catch(e){}
    return 'overview';
  }
  function writeLastTab(tab){
    try{ localStorage.setItem(KEY_LASTTAB, tab); }catch(e){}
  }

  function readState(){
    try{
      const raw = localStorage.getItem(KEY_STATE);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    }catch(e){ return {}; }
  }
  function writeState(obj){
    try{ localStorage.setItem(KEY_STATE, JSON.stringify(obj||{})); }catch(e){}
  }

  function setSubActive(tab){
    $$('.nc-settings-subitem[data-nftab]').forEach(btn=>{
      const t = (btn.getAttribute('data-nftab')||'').toLowerCase();
      const on = t === tab;
      try{ btn.classList.toggle('is-active', on); }catch(e){}
      try{ btn.setAttribute('aria-selected', on ? 'true' : 'false'); }catch(e){}
    });
  }

  function setPane(tab){
    const page = getPage();
    if (!page) return;
    $$('.nc-nf-pane[data-nftab]', page).forEach(p=>{
      const t = (p.getAttribute('data-nftab')||'').toLowerCase();
      const on = t === tab;
      try{ p.classList.toggle('is-active', on); }catch(e){}
      try{ p.style.display = on ? '' : 'none'; }catch(e){}
    });
  }

  function setLeftMode(on){
    try{ document.body.classList.toggle('nc-nf-leftsub', !!on); }catch(e){}
  }

  function showSubnav(show){
    const sub = getSubnav();
    if (!sub) return;
    try{ sub.classList.toggle('is-hidden', !show); }catch(e){}
    try{ sub.setAttribute('aria-hidden', show ? 'false' : 'true'); }catch(e){}
    setLeftMode(!!show && isSettingsOpen());
  }

  function ensureNotificationsPage(){
    const navBtn = document.querySelector('.nc-settings-item[data-page="notifications"]');
    if (!navBtn) return;
    if (navBtn.classList && navBtn.classList.contains('is-active')) return;
    try{ navBtn.click(); }catch(e){}
  }

  function ensureVoiceVideoTab(tab){
    const navBtn = document.querySelector('.nc-settings-item[data-page="voicevideo"]');
    if (navBtn) {
      try{ navBtn.click(); }catch(e){}
    }
    const sub = document.querySelector('.nc-settings-subitem[data-vvtab="' + tab + '"]');
    if (sub) {
      try{ sub.click(); return; }catch(e){}
    }
    const top = document.querySelector('.nc-vv-tab[data-vvtab="' + tab + '"]');
    if (top) { try{ top.click(); }catch(e){} }
  }

  function setNotificationsTab(tab, opts){
    tab = (tab || 'overview').toLowerCase();
    const valid = new Set(['overview','sounds','badges','email','advanced']);
    if (!valid.has(tab)) tab = 'overview';
    const remember = !(opts && opts.remember === false);

    ensureNotificationsPage();
    showSubnav(true);
    setSubActive(tab);
    setPane(tab);
    if (remember) writeLastTab(tab);
  }

  // Expose for other scripts if needed
  window.ncSetNotificationsTab = setNotificationsTab;

  function bindTogglePersistence(){
    const page = getPage();
    if (!page) return;

    const alreadyBound = !!(page.dataset && page.dataset.nfBound === "1");

    // restore
    const st = readState();
    $$('.nc-vv-switch[data-nf-key]', page).forEach(btn=>{
      const k = btn.getAttribute('data-nf-key');
      if (!k) return;
      const val = (k in st) ? !!st[k] : (btn.getAttribute('aria-pressed') === 'true');
      try{ btn.setAttribute('aria-pressed', val ? 'true' : 'false'); }catch(e){}
      try{ btn.classList.toggle('is-on', val); }catch(e){}
    });

    // bind
    if (alreadyBound) return;
    try{ if (page.dataset) page.dataset.nfBound = "1"; }catch(e){}
    page.addEventListener('click', (ev)=>{
      const t = ev && ev.target;
      if (!t || !t.closest) return;

      const sw = t.closest('.nc-vv-switch[data-nf-key]');
      if (sw) {
        try{ ev.preventDefault(); }catch(e){}
        try{ ev.stopPropagation(); }catch(e){}
        const k = sw.getAttribute('data-nf-key');
        const cur = sw.getAttribute('aria-pressed') === 'true';
        const next = !cur;

        // Special: muteAll disables others visually
        if (k === 'muteAll') {
          $$('.nc-vv-switch[data-nf-key]', page).forEach(b=>{
            if (b === sw) return;
            try{
              if (next) b.setAttribute('aria-pressed','false');
            }catch(e){}
            try{ b.classList.toggle('is-on', (!next && b.getAttribute('aria-pressed')==='true')); }catch(e){}
          });
        }

        try{ sw.setAttribute('aria-pressed', next ? 'true' : 'false'); }catch(e){}
        try{ sw.classList.toggle('is-on', next); }catch(e){}

        const obj = readState();
        obj[k] = next;
        // if muteAll becomes true, force known keys off
        if (k === 'muteAll' && next) {
          obj['sndMsg'] = false;
          obj['sndCall'] = false;
        }
        writeState(obj);
        return;
      }

      const resetBtn = t.closest('#nc-nf-reset');
      if (resetBtn) {
        try{ ev.preventDefault(); }catch(e){}
        try{ ev.stopPropagation(); }catch(e){}
        try{ localStorage.removeItem(KEY_STATE); }catch(e){}
        // restore defaults (on, except newsletter)
        const defaults = {
          badgeUnread: true,
          desktop: true,
          flashTab: true,
          sndMsg: true,
          sndCall: true,
          muteAll: false,
          badgeCount: true,
          tabBadge: true,
          emailSecurity: true,
          emailNews: false,
          ducking: false
        };
        writeState(defaults);
        bindTogglePersistence(); // re-apply
        return;
      }
    }, true);
  }

  function bind(){
    const ov = getOverlay();
    if (!ov) return;

    // navigation and subnav clicks
    ov.addEventListener('click', (ev)=>{
      const t = ev && ev.target;
      if (!t || !t.closest) return;

      const sub = t.closest('.nc-settings-subitem[data-nftab]');
      if (sub) {
        try{ ev.preventDefault(); }catch(e){}
        try{ ev.stopPropagation(); }catch(e){}
        const tab = (sub.getAttribute('data-nftab')||'overview').toLowerCase();
        setNotificationsTab(tab, { remember:true });
        return;
      }

      const nav = t.closest('.nc-settings-item[data-page]');
      if (nav) {
        const page = nav.getAttribute('data-page') || '';
        if (page === 'notifications') {
          showSubnav(true);
          const tab = readLastTab();
          setSubActive(tab);
          setPane(tab);
          // apply persistence (safe)
          setTimeout(()=>{ try{ bindTogglePersistence(); }catch(e){} }, 0);
        } else {
          showSubnav(false);
        }
      }

      // linked settings: Voice&Video -> Notifications -> Sounds
      const vvRel = t.closest('#nc-vv-related-notifications');
      if (vvRel) {
        try{ ev.preventDefault(); }catch(e){}
        try{ ev.stopPropagation(); }catch(e){}
        setNotificationsTab('sounds', { remember:true });
        return;
      }

      // linked settings: Notifications -> Voice&Video -> Sounds
      const nfRel = t.closest('#nc-nf-related-voicevideo-sounds');
      if (nfRel) {
        try{ ev.preventDefault(); }catch(e){}
        try{ ev.stopPropagation(); }catch(e){}
        ensureVoiceVideoTab('sounds');
        return;
      }
    }, true);

    // Keep state correct when settings opens/closes or active page changes.
    const sync = ()=>{
      const open = isSettingsOpen();
      const activeNF = document.querySelector('.nc-settings-item.is-active[data-page="notifications"]');
      if (open && activeNF) {
        showSubnav(true);
        const tab = readLastTab();
        setSubActive(tab);
        setPane(tab);
        try{ bindTogglePersistence(); }catch(e){}
      } else {
        showSubnav(false);
      }
    };

    try{ sync(); }catch(e){}

    // Observe open/close changes
    if (window.MutationObserver){
      try{
        const mo = new MutationObserver(()=>{ try{ sync(); }catch(e){} });
        mo.observe(ov, { attributes:true, attributeFilter:['class','aria-hidden','hidden','style'] });
      }catch(e){}
    }

    // Observe nav for class toggles ("is-active")
    if (window.MutationObserver){
      try{
        const nav = ov.querySelector('.nc-settings-nav');
        if (nav){
          const mo2 = new MutationObserver((muts)=>{
            for (const m of muts){
              if (m.type === 'attributes' && m.attributeName === 'class'){
                try{ sync(); }catch(e){}
                break;
              }
            }
          });
          mo2.observe(nav, { subtree:true, attributes:true, attributeFilter:['class'] });
        }
      }catch(e){}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();


(function(){
  // FIX31: New duotone icon set (crisper + more "modern").
  const ICONS = {
    // User settings
    account: icoUser(),
    content: icoMessage(),
    privacy: icoLock(),
    family: icoUsers(),
    authorized: icoAppsGrid(),
    devices: icoDevices(),
    integrations: icoLink(),

    // Billing
    nitro: icoNeonCore(),
    boost: icoRocket(),
    subscriptions: icoMembership(),
    gifts: icoGift(),
    billing: icoReceipt(),

    // App settings
    appearance: icoPalette(),
    accessibility: icoAccessibility(),
    voicevideo: icoMic(),
    chat: icoChat(),
    notifications: icoBell(),
    hotkeys: icoKeyboard(),
    language: icoGlobeClock(),
    langtime: icoGlobeClock(), // backward compat
    streamer: icoVideo(),
    advanced: icoSliders(),

    // Activity + logout
    activity: icoShieldUser(),
    logout: icoLogout()
  };

  function wrap(inner){
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }
  function fillPath(d, op){
    return `<path d="${d}" fill="currentColor" opacity="${op ?? 0.16}" stroke="none"></path>`;
  }

  function icoUser(){
    return wrap(
      fillPath("M12 12c-3.3 0-6 2.2-6 5v2h12v-2c0-2.8-2.7-5-6-5", 0.14) +
      fillPath("M12 3.5a4.2 4.2 0 1 1 0 8.4a4.2 4.2 0 0 1 0-8.4", 0.12) +
      `<path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="8" r="4"></circle>`
    );
  }
  function icoMessage(){
    return wrap(
      fillPath("M7 4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H9l-6 3V8a4 4 0 0 1 4-4", 0.14) +
      `<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>` +
      `<path d="M8 10h8"></path><path d="M8 14h5"></path>`
    );
  }
  function icoLock(){
    return wrap(
      fillPath("M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2", 0.14) +
      `<rect x="5" y="11" width="14" height="10" rx="2"></rect>` +
      `<path d="M8 11V8a4 4 0 0 1 8 0v3"></path>`
    );
  }
  function icoUsers(){
    return wrap(
      fillPath("M8 17h6a4 4 0 0 1 4 4H4a4 4 0 0 1 4-4", 0.12) +
      fillPath("M9 5.5a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 0 1 0-6.4", 0.12) +
      `<path d="M17 21a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4"></path>` +
      `<circle cx="9" cy="8" r="3"></circle>` +
      `<path d="M22 21a4 4 0 0 0-3-3.87"></path>` +
      `<path d="M16 3.13a3 3 0 0 1 0 5.74"></path>`
    );
  }
  // Authorized apps (like Discord): 2x2 apps grid
  function icoAppsGrid(){
    return wrap(
      fillPath("M5 5h6v6H5V5zm8 0h6v6h-6V5zM5 13h6v6H5v-6zm8 0h6v6h-6v-6z", 0.14) +
      `<rect x="5" y="5" width="6" height="6" rx="1.7"></rect>` +
      `<rect x="13" y="5" width="6" height="6" rx="1.7"></rect>` +
      `<rect x="5" y="13" width="6" height="6" rx="1.7"></rect>` +
      `<rect x="13" y="13" width="6" height="6" rx="1.7"></rect>`
    );
  }
  function icoDevices(){
    return wrap(
      fillPath("M5 4h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2", 0.12) +
      `<rect x="3" y="4" width="14" height="12" rx="2"></rect>` +
      `<path d="M7 20h6"></path>` +
      `<path d="M21 10v8a2 2 0 0 1-2 2h-2"></path>`
    );
  }
  // Integrations: chain link icon (like Discord)
  function icoLink(){
    return wrap(
      fillPath("M10 14a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1", 0.12) +
      `<path d="M10 14a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"></path>` +
      `<path d="M14 10a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"></path>`
    );
  }
  function icoFilm(){
    return wrap(
      fillPath("M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2", 0.12) +
      `<rect x="2" y="6" width="20" height="12" rx="2"></rect>` +
      `<path d="M7 6v12"></path><path d="M17 6v12"></path>` +
      `<path d="M2 10h5"></path><path d="M2 14h5"></path>` +
      `<path d="M17 10h5"></path><path d="M17 14h5"></path>`
    );
  }
  function icoSparkles(){
    return wrap(
      fillPath("M12 2l1.7 5.1L19 9l-5.3 1.9L12 16l-1.7-5.1L5 9l5.3-1.9L12 2Z", 0.14) +
      `<path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2Z"></path>` +
      `<path d="M19 14l.9 2.6L22 18l-2.1 1.4L19 22l-.9-2.6L16 18l2.1-1.4L19 14Z"></path>`
    );
  }
  function icoNeonCore(){
    return wrap(
      fillPath("M12 2l7 4v12l-7 4-7-4V6l7-4Z", 0.12) +
      `<path d="M12 2l7 4v12l-7 4-7-4V6l7-4Z"></path>` +
      `<path d="M12 6l1.5 3.4L17 11l-3.5 1.6L12 16l-1.5-3.4L7 11l3.5-1.6L12 6Z"></path>`
    );
  }
  function icoMembership(){
    return wrap(
      fillPath("M12 3l7 3v6c0 4.6-2.9 7.8-7 9-4.1-1.2-7-4.4-7-9V6l7-3Z", 0.10) +
      `<path d="M12 3l7 3v6c0 4.6-2.9 7.8-7 9-4.1-1.2-7-4.4-7-9V6l7-3Z"></path>` +
      `<path d="M9 11h6"></path><path d="M12 8v6"></path>`
    );
  }
  function icoRocket(){
    return wrap(
      fillPath("M6 15l-1 6 6-1 9.2-9.2a4 4 0 0 0-5.7-5.7L6 15Z", 0.12) +
      `<path d="M6 15l-1 6 6-1 10-10a4 4 0 0 0-6-6L6 15Z"></path>` +
      `<path d="M9 19l-4-4"></path><path d="M15 5l4 4"></path>`
    );
  }
  function icoCard(){
    return wrap(
      fillPath("M5 6h14a2 2 0 0 1 2 2v2H3V8a2 2 0 0 1 2-2", 0.12) +
      `<rect x="3" y="6" width="18" height="12" rx="2"></rect>` +
      `<path d="M3 10h18"></path><path d="M7 15h6"></path>`
    );
  }
  function icoGift(){
    return wrap(
      fillPath("M5 12h14v9H5v-9", 0.10) +
      `<rect x="3" y="8" width="18" height="4" rx="1"></rect>` +
      `<path d="M12 8v13"></path><path d="M19 12v9H5v-9"></path>` +
      `<path d="M7.5 8a2.5 2.5 0 1 1 0-5C10 3 12 8 12 8s-2-5-4.5-5Z"></path>` +
      `<path d="M16.5 8a2.5 2.5 0 1 0 0-5C14 3 12 8 12 8s2-5 4.5-5Z"></path>`
    );
  }
  function icoReceipt(){
    return wrap(
      fillPath("M7 2h10v18l-2-1-2 1-2-1-2 1-2-1-2 1V2Z", 0.10) +
      `<path d="M6 2h12v20l-2-1-2 1-2-1-2 1-2-1-2 1V2Z"></path>` +
      `<path d="M9 7h6"></path><path d="M9 11h6"></path><path d="M9 15h4"></path>`
    );
  }
  function icoPalette(){
    return wrap(
      fillPath("M12 22a10 10 0 1 1 0-20c5.5 0 10 3.9 10 9a3 3 0 0 1-3 3h-1a2 2 0 0 0-2 2v1a3 3 0 0 1-3 3z", 0.12) +
      `<path d="M12 22a10 10 0 1 1 0-20c5.5 0 10 3.9 10 9a3 3 0 0 1-3 3h-1a2 2 0 0 0-2 2v1a3 3 0 0 1-3 3z"></path>` +
      `<path d="M7.5 11.5h.01"></path><path d="M12 8.5h.01"></path><path d="M16.5 11.5h.01"></path>`
    );
  }
  function icoAccessibility(){
    return wrap(
      fillPath("M12 6a2 2 0 1 0 0-4a2 2 0 0 0 0 4", 0.10) +
      `<circle cx="12" cy="4" r="2"></circle>` +
      `<path d="M19 9H5"></path>` +
      `<path d="M12 9v12"></path>` +
      `<path d="M7 21l5-5 5 5"></path>` +
      `<path d="M7 9l5 3 5-3"></path>`
    );
  }
  function icoMic(){
    return wrap(
      fillPath("M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3", 0.12) +
      `<path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z"></path>` +
      `<path d="M19 11a7 7 0 0 1-14 0"></path>` +
      `<path d="M12 18v4"></path>`
    );
  }
  function icoChat(){
    return wrap(
      fillPath("M7 4h10a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H9l-6 3V8a4 4 0 0 1 4-4", 0.12) +
      `<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>` +
      `<path d="M8 10h8"></path><path d="M8 14h5"></path>`
    );
  }
  function icoBell(){
    return wrap(
      fillPath("M12 3a6 6 0 0 0-6 6c0 6-3 6-3 6h18s-3 0-3-6a6 6 0 0 0-6-6", 0.10) +
      `<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"></path>` +
      `<path d="M13.7 21a2 2 0 0 1-3.4 0"></path>`
    );
  }
  function icoKeyboard(){
    return wrap(
      fillPath("M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2", 0.12) +
      `<rect x="2" y="7" width="20" height="10" rx="2"></rect>` +
      `<path d="M6 11h.01"></path><path d="M10 11h.01"></path><path d="M14 11h.01"></path><path d="M18 11h.01"></path>` +
      `<path d="M6 15h12"></path>`
    );
  }
  function icoGlobeClock(){
    return wrap(
      fillPath("M12 22a10 10 0 1 1 0-20a10 10 0 0 1 0 20", 0.08) +
      `<circle cx="12" cy="12" r="10"></circle>` +
      `<path d="M2 12h20"></path>` +
      `<path d="M12 2a15 15 0 0 1 0 20"></path>` +
      `<path d="M12 2a15 15 0 0 0 0 20"></path>` +
      `<path d="M12 12l3 2"></path>`
    );
  }
  function icoVideo(){
    return wrap(
      fillPath("M5 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2", 0.12) +
      `<rect x="3" y="7" width="13" height="10" rx="2"></rect>` +
      `<path d="M16 10l5-3v10l-5-3v-4z"></path>`
    );
  }
  function icoSliders(){
    return wrap(
      `<path d="M4 21v-7"></path><path d="M4 10V3"></path>` +
      `<path d="M12 21v-9"></path><path d="M12 8V3"></path>` +
      `<path d="M20 21v-5"></path><path d="M20 12V3"></path>` +
      `<path d="M2 14h4"></path><path d="M10 10h4"></path><path d="M18 16h4"></path>`
    );
  }
  function icoShieldUser(){
    return wrap(
      fillPath("M12 2l8 4v6c0 5-3 9-8 10-5-1-8-5-8-10V6l8-4Z", 0.08) +
      `<path d="M12 2l8 4v6c0 5-3 9-8 10-5-1-8-5-8-10V6l8-4Z"></path>` +
      `<path d="M12 7a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z"></path>` +
      `<path d="M8.5 16.8c.9-1.7 2.1-2.8 3.5-2.8s2.6 1.1 3.5 2.8"></path>`
    );
  }
  function icoLogout(){
    return wrap(
      fillPath("M4 4h8v16H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2", 0.10) +
      `<path d="M10 17l1.41-1.41L8.83 13H20v-2H8.83l2.58-2.59L10 7l-7 5 7 5z"></path>` +
      `<path d="M4 3h6a2 2 0 0 1 2 2"></path>` +
      `<path d="M12 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"></path>`
    );
  }

  function apply(root){
    root = root || document;
    const items = root.querySelectorAll('.nc-settings-item[data-page]');
    if(!items.length) return;

    items.forEach(btn=>{
      // Idempotent: inject only once per element (prevents MutationObserver loops).
      const page = btn.getAttribute('data-page');
      const svg = ICONS[page];
      if(!svg) return;

      let ico = btn.querySelector('.nc-settings-ico');
      if(!ico){
        ico = document.createElement('span');
        ico.className = 'nc-settings-ico';
        ico.setAttribute('aria-hidden','true');
        btn.insertBefore(ico, btn.firstChild);
      }

      if (ico.getAttribute('data-nc-icon') !== page){
        ico.innerHTML = svg;
        ico.setAttribute('data-nc-icon', page);
      }

      btn.classList.add('has-nc-ico');
      btn.setAttribute('data-nc-ico-ready','1');
    });
  }

  let scheduled = false;
  function scheduleApply(){
    if (scheduled) return;
    scheduled = true;
    const raf = window.requestAnimationFrame || function(cb){ return setTimeout(cb, 16); };
    raf(function(){
      scheduled = false;
      try { apply(); } catch(e) {}
    });
  }

  function hasSettingsItems(node){
    if (!node || node.nodeType !== 1) return false;
    try{
      if (node.matches && node.matches('.nc-settings-item[data-page]')) return true;
      if (node.querySelector && node.querySelector('.nc-settings-item[data-page]')) return true;
    }catch(e){}
    return false;
  }

  window.addEventListener('DOMContentLoaded', ()=>{
    apply();

    const mo = new MutationObserver((muts)=>{
      for (const m of muts){
        if (!m.addedNodes || !m.addedNodes.length) continue;
        for (const n of m.addedNodes){
          if (hasSettingsItems(n)){
            scheduleApply();
            return;
          }
        }
      }
    });

    try{
      mo.observe(document.body, {subtree:true, childList:true});
    }catch(e){}
  });
})();

(function(){
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function currentUserId(){
    return String($('.chat-main')?.dataset.currentUserId || $('#me-panel')?.dataset.userId || '').trim();
  }

  function friendsViewVisible(){
    const fv = $('#friends-view');
    if (!fv) return false;
    if (fv.classList.contains('is-hidden')) return false;
    const st = window.getComputedStyle ? getComputedStyle(fv) : null;
    return !st || (st.display !== 'none' && st.visibility !== 'hidden');
  }

  function currentFriendsTab(){
    const active = $('#friends-view .friends-tab.is-active[data-friends-tab]');
    return String(active?.dataset?.friendsTab || 'online').trim() || 'online';
  }

  function rowMatchesFriendsFilter(row, tab, query){
    try{
      if (!row) return false;
      const mode = String(tab || 'online').trim();
      const q = String(query || '').toLowerCase().trim();
      const online = String(row.dataset.online || '0') === '1';
      const name = String(row.dataset.username || row.querySelector('.friend-name')?.textContent || '').toLowerCase();
      let ok = true;
      if (mode === 'online') ok = online;
      else if (mode === 'pending') ok = false;
      if (ok && q) ok = name.includes(q);
      return ok;
    }catch(_e){ return true; }
  }

  function reapplyFriendsPageFilterFallback(){
    try{
      const mainList = $('#friends-page-list');
      if (!mainList) return;
      const tab = currentFriendsTab();
      const query = String($('#friends-page-search')?.value || '');
      $$('.friends-page-item', mainList).forEach((row) => {
        row.style.display = rowMatchesFriendsFilter(row, tab, query) ? '' : 'none';
      });
    }catch(_e){}
  }

  function syncFriendsPageFallback(){
    try{
      if (!friendsViewVisible()) return;
      const mainList = $('#friends-page-list');
      const dmListWrap = $('#pane-friends');
      const dmList = $('#pane-friends .friend-list') || dmListWrap;
      if (!mainList || !dmList) return;

      const activeTab = currentFriendsTab();
      const searchQuery = String($('#friends-page-search')?.value || '');
      const myId = currentUserId();
      const srcItems = $$('.friend-item[data-user-id], .dm-entry[data-user-id]', dmList)
        .filter((el) => {
          const uid = String(el.dataset.userId || '').trim();
          if (!uid) return false;
          if (myId && uid === myId) return false;
          return true;
        });

      if (!srcItems.length) return;

      const seen = new Set();
      srcItems.forEach((src) => {
        const uid = String(src.dataset.userId || '').trim();
        if (!uid) return;
        seen.add(uid);

        let dst = mainList.querySelector(`.friends-page-item[data-user-id="${CSS.escape(uid)}"]`);
        if (!dst) {
          dst = src.cloneNode(true);
          dst.classList.add('friends-page-item');
          dst.classList.remove('is-active');
          mainList.appendChild(dst);
        } else {
          // Replace content to keep Pulsar+ tag / nickname cosmetics in sync.
          const cloned = src.cloneNode(true);
          cloned.classList.add('friends-page-item');
          cloned.classList.remove('is-active');
          dst.replaceWith(cloned);
          dst = cloned;
        }

        try{
          dst.dataset.userId = uid;
          if (src.dataset.username) dst.dataset.username = src.dataset.username;
          if (src.dataset.avatarUrl) dst.dataset.avatarUrl = src.dataset.avatarUrl;
          if (src.dataset.status) dst.dataset.status = src.dataset.status;
          if (src.dataset.online != null) dst.dataset.online = String(src.dataset.online);
          if (src.dataset.createdAt) dst.dataset.createdAt = src.dataset.createdAt;
          if (src.dataset.lastSeen) dst.dataset.lastSeen = src.dataset.lastSeen;
          dst.style.display = rowMatchesFriendsFilter(dst, activeTab, searchQuery) ? '' : 'none';
        }catch(e){}
      });

      try{
        $$('.friends-page-item[data-user-id]', mainList).forEach((el) => {
          const uid = String(el.dataset.userId || '').trim();
          if (!uid) return;
          if (!seen.has(uid)) el.remove();
        });
      }catch(e){}

      reapplyFriendsPageFilterFallback();
    }catch(e){}
  }

  function syncBurst(){
    [0, 60, 140, 260, 420, 700, 1100].forEach((ms) => {
      setTimeout(syncFriendsPageFallback, ms);
    });
  }

  function installFriendsHooks(){
    try{
      const triggers = [
        '#btn-open-friends-view',
        '#btn-open-friends',
        '#rail-friends',
        '#tab-friends'
      ];
      triggers.forEach((sel) => {
        const el = $(sel);
        if (!el || el.dataset.ncFix231Hooked === '1') return;
        el.dataset.ncFix231Hooked = '1';
        el.addEventListener('click', syncBurst, true);
      });

      try{
        $$('#friends-view .friends-tab[data-friends-tab]').forEach((btn) => {
          if (btn.dataset.ncFix231FilterHooked === '1') return;
          btn.dataset.ncFix231FilterHooked = '1';
          btn.addEventListener('click', () => { setTimeout(reapplyFriendsPageFilterFallback, 0); }, true);
        });
      }catch(e){}

      try{
        const search = $('#friends-page-search');
        if (search && search.dataset.ncFix231FilterHooked !== '1') {
          search.dataset.ncFix231FilterHooked = '1';
          search.addEventListener('input', () => { setTimeout(reapplyFriendsPageFilterFallback, 0); }, true);
        }
      }catch(e){}
    }catch(e){}

    try{
      if (typeof MutationObserver === 'undefined') return;
      const mo = new MutationObserver(() => {
        if (friendsViewVisible()) syncBurst();
      });
      const dmPane = $('#pane-friends');
      const fv = $('#friends-view');
      if (dmPane) mo.observe(dmPane, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','data-online','data-status','data-username'] });
      if (fv) mo.observe(fv, { attributes: true, attributeFilter: ['class','style'] });
    }catch(e){}

    try{
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncFriendsPageFallback();
      });
    }catch(e){}

    // Initial sync if page opens with friends visible.
    syncBurst();
  }

  function installGlobalCtxFallback(){
    // Extra safety: if fix207 doesn't catch some call tiles, catch them here too.
    document.addEventListener('contextmenu', (e) => {
      try{
        if (!window.__ncOpenUserCtxFromEl) return;
        const t = e.target;
        if (!t || !t.closest) return;
        const el = t.closest(
          '.voice-user-chip, .voice-peer, .voice-member, .call-member, .participant-tile, .participant-card, .groupcall-participant, [data-user-id], [data-peer-id]'
        );
        if (!el) return;
        const noMenu = el.closest('input, textarea, [contenteditable="true"]');
        if (noMenu) return;
        e.preventDefault();
        e.stopPropagation();
        window.__ncOpenUserCtxFromEl(el, e.clientX, e.clientY);
      }catch(err){}
    }, true);
  }

  function boot(){
    installFriendsHooks();
    installGlobalCtxFallback();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
