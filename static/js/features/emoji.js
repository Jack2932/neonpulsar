/* Semantic script */

/* Stable emoji panel bootstrap
   - keep luxe panel skin
   - do NOT hijack opening logic from main.js
   - move panel to <body> so it never affects layout flow
*/
(function(){
  'use strict';

  function initStableEmojiBootstrap(){
    const pop = document.getElementById('emoji-pop');
    if (!pop) return;
    try { pop.classList.add('nc-emoji-shell', 'nc-emoji-stable'); } catch (e) {}
    // Do not force the popup into <body> here.
    // Insert mode needs to dock above the composer button, while reaction mode
    // can still be moved to <body> later if the legacy menu code opens it there.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStableEmojiBootstrap, { once:true });
  } else {
    initStableEmojiBootstrap();
  }
})();


/* Fix162 (supersedes Fix143): Discord-like Emoji Panel (big, searchable)
   - Builds #emoji-pop UI if missing
   - Categories work reliably (scroll inside panel)
   - Search is inline (no global-search hijack)
   - Keeps compatibility with main.js click handler via [data-emoji]
*/
(function() {
  'use strict';

  const EMOJI = {"smileys": ["😀", "😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😊", "😋", "😎", "😍", "😘", "🥰", "😗", "😙", "😚", "🙂", "🤗", "🤩", "🤔", "🤨", "😐", "😑", "😶", "🙄", "😏", "😣", "😥", "😮", "🤐", "😯", "😪", "😫", "🥱", "😴", "😌", "😛", "😜", "🤪", "😝", "🤤", "😒", "😓", "😔", "😕", "🙃", "🫠", "🤑", "😲", "☹️", "🙁", "😖", "😞", "😟", "😤", "😢", "😭", "😦", "😧", "😨", "😩", "🤯", "😬", "😰", "😱", "🥵", "🥶", "😳", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🫢", "🫣", "🫡", "😇", "🥳", "🥸", "😈", "👿", "💀", "☠️", "👻", "👽", "🤖", "🎃"], "people": ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🫀", "🫁", "🦷", "🦴", "👀", "👁️", "👅", "👄", "🫦", "🧑", "👨", "👩", "🧑‍🦱", "🧑‍🦰", "🧑‍🦳", "🧑‍🦲", "👶", "🧒", "👦", "👧", "🧓", "👴", "👵", "🙍", "🙎", "🙅", "🙆", "💁", "🙋", "🧏", "🙇", "🤦", "🤷", "🧑‍⚕️", "🧑‍🎓", "🧑‍🏫", "🧑‍💻", "🧑‍🎤", "🧑‍🚀", "🧑‍🚒", "🧑‍🔧", "🧑‍🍳", "🧑‍🌾", "🧑‍⚖️", "🧑‍✈️", "🧑‍🔬", "🧑‍🎨", "🧑‍💼", "🧑‍🏭", "🧑‍🔒"], "nature": ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨", "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🪲", "🐛", "🦋", "🐌", "🐞", "🪳", "🦂", "🕷️", "🕸️", "🐢", "🐍", "🦎", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🦧", "🐘", "🦣", "🦛", "🦏", "🐪", "🐫", "🦒", "🦘", "🦬", "🐃", "🐂", "🐄", "🐎", "🐖", "🐏", "🐑", "🦙", "🐐", "🦌", "🐕", "🐩", "🦮", "🐕‍🦺", "🐈", "🐈‍⬛", "🪶", "🦢", "🦩", "🦚", "🦜", "🦤", "🐓", "🪿", "🐾", "🌸", "🌼", "🌻", "🌺", "🌹", "🥀", "🌷", "🪷", "🌱", "🌿", "☘️", "🍀", "🍁", "🍂", "🍃", "🌲", "🌳", "🌴", "🌵", "🌾", "🌎", "🌍", "🌏", "🌙", "⭐", "🌟", "✨", "⚡", "🔥", "💧", "🌈", "☀️", "⛅", "☁️", "🌧️", "⛈️", "❄️", "☃️", "🌊"], "food": ["🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🫓", "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🌭", "🍔", "🍟", "🍕", "🥪", "🥙", "🧆", "🌮", "🌯", "🫔", "🥗", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🍢", "🍡", "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🥛", "🍼", "☕", "🍵", "🧃", "🥤", "🧋", "🍺", "🍻", "🥂", "🍷", "🥃", "🍸", "🍹", "🧉", "🍾", "🧊"], "activity": ["⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "⛳", "🪁", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "⛷️", "🏂", "🪂", "🏋️", "🤼", "🤸", "⛹️", "🤺", "🤾", "🏌️", "🏇", "🧘", "🏄", "🏊", "🚣", "🧗", "🚴", "🚵", "🎮", "🕹️", "🎲", "♟️", "🧩", "🎭", "🎨", "🧵", "🪡", "🎼", "🎹", "🥁", "🎸", "🎻", "🎺", "🎷", "🪇", "🎤", "🎧", "🎬", "🎯", "🎳", "🎰", "🎪", "🎟️", "🎫", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️", "🎗️"], "travel": ["🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻", "🚚", "🚛", "🚜", "🏍️", "🛵", "🚲", "🛴", "🚨", "🚔", "🚍", "🚘", "🚖", "🚡", "🚠", "🚟", "🚃", "🚋", "🚞", "🚝", "🚄", "🚅", "🚈", "🚂", "🚆", "🚇", "🚊", "🚉", "✈️", "🛫", "🛬", "🛩️", "💺", "🚁", "🚀", "🛸", "🚢", "⛴️", "🛥️", "🚤", "⛵", "🛶", "⚓", "⛽", "🚧", "🚦", "🗺️", "🗿", "🗽", "🗼", "🏰", "🏯", "🏟️", "🎡", "🎢", "🎠", "⛲", "⛱️", "🏖️", "🏝️", "🏜️", "🌋", "⛰️", "🏔️", "🗻", "🏕️", "⛺", "🏠", "🏡", "🏢", "🏬", "🏣", "🏤", "🏥", "🏦", "🏨", "🏪", "🏫", "🏭", "🏞️", "🌅", "🌄", "🌆", "🌇", "🌉", "🌃"], "objects": ["⌚", "📱", "💻", "🖥️", "🖨️", "🖱️", "🖲️", "🕹️", "💽", "💾", "📀", "📷", "📸", "📹", "🎥", "📽️", "🎞️", "📞", "☎️", "📟", "📠", "📺", "📻", "🎙️", "🎚️", "🎛️", "🧭", "⏱️", "⏲️", "⏰", "🕰️", "⌛", "⏳", "📡", "🔋", "🪫", "🔌", "💡", "🔦", "🕯️", "🪔", "🧯", "🛢️", "💸", "💵", "💴", "💶", "💷", "💰", "💳", "🪪", "🧾", "💎", "⚖️", "🔧", "🔨", "⛏️", "🛠️", "🧰", "🪛", "🔩", "⚙️", "🗜️", "🧱", "🪜", "🧲", "🧪", "🧫", "🧬", "🔬", "🔭", "📌", "📍", "✂️", "🖊️", "🖋️", "✒️", "📝", "📁", "📂", "🗂️", "📄", "📃", "📑", "📚", "📖", "🔖", "🗞️", "📦", "📫", "📬", "📭", "📮", "✉️", "📧", "📨", "📩", "🪧", "🔒", "🔓", "🔏", "🔐", "🔑", "🗝️", "🔨", "🪓", "🔫", "🧨", "🪃", "🧿", "🪬", "💊", "🩹", "🩺", "🚪", "🛏️", "🛋️", "🚽", "🚿", "🛁", "🧴", "🪥", "🧻", "🧼", "🧽", "🧹", "🧺", "🪣", "🧊", "🧷", "🪢", "🧸", "🪅", "🪩", "🎁", "🎈", "🎀", "🪄", "📣", "📢", "🔔", "🔕", "🎵", "🎶", "🎼"], "symbols": ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "💖", "💗", "💓", "💞", "💕", "💟", "❣️", "💘", "💝", "💢", "💥", "💫", "💦", "💨", "🕳️", "💬", "🗨️", "🗯️", "💭", "💤", "✅", "☑️", "✔️", "✖️", "❌", "⭕", "❗", "❓", "⁉️", "‼️", "🔔", "🔕", "⚠️", "🚫", "⛔", "🛑", "🔞", "♻️", "⚜️", "🔱", "📛", "🔰", "⭕", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "🟫", "⬛", "⬜", "◼️", "◻️", "🔶", "🔷", "🔸", "🔹", "🔺", "🔻", "⭐", "🌟", "✨", "⚡", "🔥", "💯", "🔊", "🔉", "🔈", "🔇"], "flags": ["🏳️", "🏴", "🏁", "🚩", "🏳️‍🌈", "🏳️‍⚧️", "🇷🇺", "🇺🇦", "🇸🇪", "🇺🇸", "🇬🇧", "🇫🇷", "🇩🇪", "🇮🇹", "🇪🇸", "🇵🇱", "🇨🇿", "🇳🇴", "🇫🇮", "🇩🇰", "🇳🇱", "🇧🇪", "🇨🇦", "🇧🇷", "🇦🇷", "🇯🇵", "🇰🇷", "🇨🇳", "🇮🇳", "🇹🇷", "🇦🇪", "🇸🇦", "🇲🇽", "🇦🇺"]};

  const CAT_ORDER = [
    {key:'recent', name:'Часто используемые', icon:'🕘'},
    {key:'custom', name:'Ваши эмодзи', icon:'✨'},
    {key:'smileys', name:'Смайлики', icon:'😀'},
    {key:'people', name:'Люди', icon:'🧑'},
    {key:'nature', name:'Животные и природа', icon:'🐾'},
    {key:'food', name:'Еда', icon:'🍔'},
    {key:'activity', name:'Активности', icon:'⚽'},
    {key:'travel', name:'Путешествия', icon:'✈️'},
    {key:'objects', name:'Объекты', icon:'💡'},
    {key:'symbols', name:'Символы', icon:'💜'},
    {key:'flags', name:'Флаги', icon:'🏳️'}
  ];

  const LS_RECENT = 'nc_recent_emojis_v1';
  const LS_CUSTOM = 'nc_custom_emojis_v1';

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
  }

  function uniq(arr) {
    const out = [];
    const set = new Set();
    for (const x of arr) {
      const k = String(x||'');
      if (!k || set.has(k)) continue;
      set.add(k);
      out.push(k);
    }
    return out;
  }

  function getRecent() {
    const r = loadJSON(LS_RECENT, []);
    if (Array.isArray(r)) return r.slice(0, 40);
    return [];
  }
  function addRecent(emo) {
    const s = String(emo||'').trim();
    if (!s) return;
    // don't store custom :name:
    if (s.startsWith(':') && s.endsWith(':')) return;
    const r = getRecent();
    const next = uniq([s, ...r]).slice(0, 40);
    saveJSON(LS_RECENT, next);
  }
  function getCustom() {
    const m = loadJSON(LS_CUSTOM, { });
    if (!m || typeof m !== 'object') return { };
    return m;
  }
  function setCustom(name, url) {
    const m = getCustom();
    m[name] = url;
    saveJSON(LS_CUSTOM, m);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function ensurePopSkeleton(pop) {
    // If old template has only a raw emoji list, upgrade it in-place.
    try{ pop.classList.add('nc-emoji-pop'); }catch(e){}

    const hasSearch = !!pop.querySelector('#emoji-search');
    const hasCats = !!pop.querySelector('#emoji-cats');
    const hasGrid = !!pop.querySelector('#emoji-grid');
    if (hasSearch && hasCats && hasGrid) return;

    pop.innerHTML = `
      <div class="nc-emoji-top">
        <div class="nc-emoji-title">Эмодзи</div>
        <div class="nc-emoji-search-wrap">
          <input class="nc-emoji-search" id="emoji-search" type="text" autocomplete="off" placeholder="Поиск эмодзи..." />
          <button class="nc-emoji-search-clear nc-hidden" id="emoji-search-clear" type="button" aria-label="Очистить поиск">✕</button>
        </div>
        <button class="nc-emoji-add" id="emoji-add-btn" type="button" title="Добавить эмодзи">+</button>
      </div>

      <div class="nc-emoji-main">
        <div class="nc-emoji-cats" id="emoji-cats" aria-label="Категории"></div>
        <div class="nc-emoji-gridwrap" aria-label="Эмодзи">
          <div id="emoji-grid"></div>
        </div>
      </div>

      <div class="nc-emoji-previewbar" aria-label="Предпросмотр">
        <div class="nc-emoji-preview-emo" id="emoji-preview-emo">😀</div>
        <div class="nc-emoji-preview-code" id="emoji-preview-code">😀</div>
      </div>

      <div class="nc-emoji-add-modal nc-hidden" id="emoji-add-modal" aria-hidden="true">
        <div class="nc-emoji-add-card" role="dialog" aria-label="Добавить эмодзи">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="font-weight:700;font-size:13px;color:rgba(255,255,255,0.9);">Добавить эмодзи</div>
            <button id="emoji-add-cancel" type="button" title="Закрыть" style="width:34px;height:34px;border-radius:12px;border:1px solid rgba(255,255,255,0.10);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.9);cursor:pointer;">✕</button>
          </div>
          <div class="nc-emoji-add-row">
            <label for="emoji-add-name">Название (без пробелов)</label>
            <input id="emoji-add-name" type="text" autocomplete="off" placeholder="party_cat" />
          </div>
          <div class="nc-emoji-add-row">
            <label for="emoji-add-url">URL картинки</label>
            <input id="emoji-add-url" type="text" autocomplete="off" placeholder="https://.../emoji.png" />
          </div>
          <div class="nc-emoji-add-actions">
            <button id="emoji-add-save" type="button">Сохранить</button>
          </div>
        </div>
      </div>
    `;
  }

  function buildEmojiButtonNative(emo) {
    const b = el('button', 'nc-emoji-pick emoji-pick', emo);
    b.type = 'button';
    b.setAttribute('data-emoji', emo);
    b.setAttribute('title', emo);
    return b;
  }

  function buildEmojiButtonCustom(name, url) {
    const b = el('button', 'nc-emoji-pick emoji-pick is-custom', '');
    b.type = 'button';
    b.setAttribute('data-emoji', `:${name}:`);
    b.setAttribute('title', `:${name}:`);
    const img = new Image();
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = `:${name}:`;
    img.src = url;
    b.appendChild(img);
    return b;
  }

  function renderCats(catsEl, activeKey) {
    catsEl.innerHTML = '';
    // Slider indicator (moves to active/hovered category)
    const ind = el('div', 'nc-cat-indicator', '');
    ind.id = 'emoji-cat-indicator';
    catsEl.appendChild(ind);

    for (const c of CAT_ORDER) {
      const b = el('button', 'nc-emoji-cat', c.icon);
      b.type = 'button';
      b.setAttribute('data-cat', c.key);
      b.setAttribute('title', c.name);
      if (c.key === activeKey) b.classList.add('is-active');
      catsEl.appendChild(b);
    }
  }

  function _secWrap(titleText, secKey) {
    const wrap = el('div', 'nc-emoji-sec');
    const title = el('div', 'nc-emoji-section-title', titleText);
    title.setAttribute('data-sec', secKey);
    wrap.appendChild(title);
    const grid = el('div', 'nc-emoji-grid');
    wrap.appendChild(grid);
    return {wrap, grid};
  }

  function renderGrid(gridRoot, query, mode) {
    // mode: insert | react
    const q = String(query||'').trim().toLowerCase();
    const isSearch = q.length > 0;

    const recent = getRecent();
    const custom = getCustom();

    const sections = [];
    if (!isSearch) {
      sections.push({ key:'recent', title:'Часто используемые', items: recent.map(e=>({t:'native', v:e})) });
      const customItems = Object.entries(custom).map(([name,url])=>({t:'custom', name, url}));
      sections.push({ key:'custom', title:'Ваши эмодзи', items: customItems });
      for (const c of CAT_ORDER) {
        if (c.key==='recent' || c.key==='custom') continue;
        const list = EMOJI[c.key] || [];
        sections.push({ key:c.key, title:c.name, items: list.map(e=>({t:'native', v:e})) });
      }
    } else {
      // search across all native + custom names
      const flat = [];
      for (const c of CAT_ORDER) {
        if (c.key==='recent' || c.key==='custom') continue;
        for (const e of (EMOJI[c.key]||[])) flat.push({t:'native', v:e});
      }
      for (const [name,url] of Object.entries(custom)) flat.push({t:'custom', name, url});

      const filtered = flat.filter(it => {
        if (it.t === 'custom') return it.name.toLowerCase().includes(q);
        const v = it.v;
        if (q.length <= 2) return v.includes(q);
        const hex = Array.from(v).map(ch=>ch.codePointAt(0).toString(16)).join('-');
        return hex.includes(q);
      }).slice(0, 300);

      sections.push({ key:'search', title:`Результаты: "${q}"`, items: filtered });
    }

    gridRoot.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const sec of sections) {
      if (!sec.items || sec.items.length === 0) continue;

      const {wrap, grid} = _secWrap(sec.title, sec.key);

      for (const it of sec.items) {
        if (mode === 'react' && it.t === 'custom') continue; // reactions = only native
        const b = (it.t === 'custom')
          ? buildEmojiButtonCustom(it.name, it.url)
          : buildEmojiButtonNative(it.v);
        grid.appendChild(b);
      }

      frag.appendChild(wrap);
    }

    gridRoot.appendChild(frag);
  }

  function _moveCatIndicator(catsEl, btn, immediate) {
    try{
      if (!catsEl) return;
      const b = btn || catsEl.querySelector('.nc-emoji-cat.is-active') || catsEl.querySelector('.nc-emoji-cat');
      if (!b) return;
      const y = b.offsetTop || 0;
      catsEl.style.setProperty('--nc-ind-y', y + 'px');

      const ind = catsEl.querySelector('#emoji-cat-indicator');
      if (ind && immediate) {
        ind.style.transitionDuration = '0ms';
        requestAnimationFrame(()=>{ try{ ind.style.transitionDuration = ''; }catch(e){} });
      }
    }catch(e){}
  }

  function setActiveCat(catsEl, key, immediate) {
    try{ catsEl && (catsEl.dataset.activeCat = String(key||'')); }catch(e){}
    let activeBtn = null;
    for (const b of catsEl.querySelectorAll('.nc-emoji-cat')) {
      const on = (b.getAttribute('data-cat') === key);
      b.classList.toggle('is-active', on);
      if (on) activeBtn = b;
    }
    _moveCatIndicator(catsEl, activeBtn, immediate);
  }

  function hookCatScroll(pop) {
    const catsEl = pop.querySelector('#emoji-cats');
    const gridWrap = pop.querySelector('.nc-emoji-gridwrap');
    const gridRoot = pop.querySelector('#emoji-grid');
    const searchEl = pop.querySelector('#emoji-search');

    if (!catsEl || !gridWrap || !gridRoot) return;

    function getScroller(){
      let sc = gridWrap;
      try{
        if (sc && sc.scrollHeight <= sc.clientHeight + 1) {
          const cand = pop.querySelector('.nc-emoji-gridwrap');
          if (cand) sc = cand;
        }
      }catch(e){}
      return sc || gridWrap;
    }

    function scrollToCat(key){
      const title = gridRoot.querySelector(`.nc-emoji-section-title[data-sec="${key}"]`);
      if (!title) return;
      const sc = getScroller();
      const top = Math.max(0, (title.offsetTop || 0) - 6);
      try{ sc.scrollTo({ top, behavior: 'smooth' }); }catch(e){ try{ sc.scrollTop = top; }catch(_){} }
    }

    const stop = (e)=>{ try{ e.stopPropagation(); }catch(_){} };
    try{ catsEl.addEventListener('pointerdown', stop, true); }catch(e){}
    try{ gridWrap.addEventListener('pointerdown', stop, true); }catch(e){}

    catsEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-cat]') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      const key = btn.getAttribute('data-cat') || '';
      setActiveCat(catsEl, key);

      try{
        if (searchEl && String(searchEl.value||'').trim()) {
          searchEl.value = '';
          searchEl.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(()=>scrollToCat(key), 0);
          return;
        }
      }catch(err){}

      scrollToCat(key);
    });

    let lastHover = null;
    catsEl.addEventListener('mousemove', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.nc-emoji-cat') : null;
      if (!btn || btn === lastHover) return;
      lastHover = btn;
      _moveCatIndicator(catsEl, btn, false);
    }, { passive: true });

    catsEl.addEventListener('mouseleave', () => {
      lastHover = null;
      const key = (catsEl.dataset.activeCat || 'recent');
      const btn = catsEl.querySelector(`.nc-emoji-cat[data-cat="${key}"]`);
      _moveCatIndicator(catsEl, btn, false);
    }, { passive: true });

    let raf = 0;
    getScroller().addEventListener('scroll', () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const titles = Array.from(gridRoot.querySelectorAll('.nc-emoji-section-title'));
        if (!titles.length) return;
        const sc = getScroller();
        const cur = (sc.scrollTop || 0) + 18;
        let best = titles[0];
        for (const t of titles) {
          if ((t.offsetTop || 0) <= cur) best = t;
        }
        const key = best.getAttribute('data-sec') || 'recent';
        setActiveCat(catsEl, key);
      });
    }, { passive: true });

    setTimeout(()=>{ try{ _moveCatIndicator(catsEl, null, true); }catch(e){} }, 0);
  }

  function hookPreview(pop) {
    const pEmo = pop.querySelector('#emoji-preview-emo');
    const pCode = pop.querySelector('#emoji-preview-code');
    if (!pEmo || !pCode) return;

    pop.addEventListener('mousemove', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-emoji]') : null;
      if (!btn) return;
      const code = btn.getAttribute('data-emoji') || '';
      if (!code) return;

      if (btn.classList.contains('is-custom')) {
        const img = btn.querySelector('img');
        pEmo.textContent = '';
        pEmo.innerHTML = '';
        if (img) {
          const clone = img.cloneNode(true);
          clone.style.width = '18px';
          clone.style.height = '18px';
          clone.style.borderRadius = '6px';
          pEmo.appendChild(clone);
        } else {
          pEmo.textContent = '✨';
        }
        pCode.textContent = code;
      } else {
        pEmo.textContent = code;
        pCode.textContent = code;
      }
    });
  }

  function hookAddEmoji(pop, rerender) {
    const addBtn = pop.querySelector('#emoji-add-btn');
    const modal = pop.querySelector('#emoji-add-modal');
    const nameEl = pop.querySelector('#emoji-add-name');
    const urlEl = pop.querySelector('#emoji-add-url');
    const saveBtn = pop.querySelector('#emoji-add-save');
    const cancelBtn = pop.querySelector('#emoji-add-cancel');
    if (!addBtn || !modal || !nameEl || !urlEl || !saveBtn || !cancelBtn) return;

    function open() {
      modal.classList.remove('nc-hidden');
      modal.setAttribute('aria-hidden','false');
      nameEl.value = '';
      urlEl.value = '';
      setTimeout(()=>{ try{ nameEl.focus({ preventScroll:true }); }catch(e){ try{ nameEl.focus(); }catch(_){} } }, 0);
    }
    function close() {
      modal.classList.add('nc-hidden');
      modal.setAttribute('aria-hidden','true');
    }

    addBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (String(pop.dataset.mode||'insert') === 'react') return;
      open();
    });

    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = String(nameEl.value||'').trim().replace(/[^a-zA-Z0-9_]/g,'_').slice(0, 40);
      const url = String(urlEl.value||'').trim();
      if (!name || !url) return;
      setCustom(name, url);
      close();
      rerender();
    });
  }

  function hookSearchGuard(pop, searchEl, clearEl) {
    if (!searchEl) return;

    // Prevent global capture listeners (global search hotfix / shortcut handlers) from stealing focus.
    const stop = (e) => { try{ e.stopPropagation(); }catch(_){ } };

    ['keydown','keyup','keypress','pointerdown','mousedown','click'].forEach(evt => {
      try{ searchEl.addEventListener(evt, stop, true); }catch(e){}
      try{ clearEl && clearEl.addEventListener(evt, stop, true); }catch(e){}
    });

    // also keep clicks inside panel from bubbling to document-level closers
    try{ pop.addEventListener('pointerdown', stop, true); }catch(e){}

    // Clear button UX
    if (clearEl) {
      clearEl.addEventListener('click', (e) => {
        try{ e.preventDefault(); }catch(_){ }
        try{ e.stopPropagation(); }catch(_){ }
        try{
          searchEl.value = '';
          searchEl.dispatchEvent(new Event('input', { bubbles: true }));
          clearEl.classList.add('nc-hidden');
          searchEl.focus({ preventScroll:true });
        }catch(err){ try{ searchEl.focus(); }catch(_){ } }
      });
    }
  }

  function initEmojiPop() {
    const pop = document.getElementById('emoji-pop');
    if (!pop) return;

    ensurePopSkeleton(pop);

    const catsEl = pop.querySelector('#emoji-cats');
    const gridRoot = pop.querySelector('#emoji-grid');
    const searchEl = pop.querySelector('#emoji-search');
    const clearEl = pop.querySelector('#emoji-search-clear');

    if (!catsEl || !gridRoot || !searchEl) return;

    const rerender = () => {
      const mode = String(pop.dataset.mode || 'insert');
      const keepKey = String((catsEl.dataset && catsEl.dataset.activeCat) || 'recent');

      renderCats(catsEl, keepKey);
      renderGrid(gridRoot, searchEl.value, mode);

      // snap indicator + active without "jump" animation on rerender
      setActiveCat(catsEl, keepKey, true);

      // search clear button
      try{
        if (clearEl) clearEl.classList.toggle('nc-hidden', !String(searchEl.value||'').trim());
      }catch(e){}
    };

    hookCatScroll(pop);
    hookPreview(pop);
    hookAddEmoji(pop, rerender);
    hookSearchGuard(pop, searchEl, clearEl);

    // Search live
    let t = null;
    searchEl.addEventListener('input', () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        rerender();
      }, 70);
    });

    // Add to recents when picking (panel may be used both for insert and react)
    pop.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-emoji]') : null;
      if (!btn) return;
      const code = btn.getAttribute('data-emoji') || '';
      if (!code) return;
      addRecent(code);
    });

    // first render
    rerender();

    // public hook for main.js to re-render when opening in react mode
    window.__ncEmojiPopOnOpen = function(popEl) {
      try {
        const mode = String(popEl.dataset.mode || 'insert');
        if (mode === 'react') {
          try {
            if (popEl.parentElement !== document.body) document.body.appendChild(popEl);
            popEl.style.position = 'fixed';
            popEl.style.right = 'auto';
            popEl.style.bottom = 'auto';
            popEl.dataset.ncAnchor = 'viewport';
          } catch (_e) {}
        }
        const add = popEl.querySelector('#emoji-add-btn');
        if (add) add.style.display = (mode === 'react') ? 'none' : '';

        const se = popEl.querySelector('#emoji-search');
        const clr = popEl.querySelector('#emoji-search-clear');
        if (clr) { try{ clr.classList.add('nc-hidden'); }catch(e){} }
        if (se) {
          se.value = '';
        }

        const grid = popEl.querySelector('#emoji-grid');
        if (grid) renderGrid(grid, '', mode);

        const cats = popEl.querySelector('#emoji-cats');
        if (cats) {
          renderCats(cats, 'recent');
          setActiveCat(cats, 'recent', true);
        }

        const wrap = popEl.querySelector('.nc-emoji-gridwrap');
        if (wrap && wrap.scrollTop) wrap.scrollTop = 0;
      } catch (e) {}
    };
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function positionSafeEmojiPop(pop, btn) {
    if (!pop || !btn) return;

    const pad = 16;
    const gap = 12;
    const composer = document.getElementById('message-form') || btn.closest('.composer') || btn.closest('form');
    const chatInput = btn.closest('.chat-input') || (composer && composer.closest && composer.closest('.chat-input'));
    const isComposerButton = !!(btn && btn.id === 'btn-emoji-insert' && composer);

    const prevVis = pop.style.visibility;
    const prevLeft = pop.style.left;
    const prevTop = pop.style.top;
    const prevRight = pop.style.right;
    const prevBottom = pop.style.bottom;
    const prevMaxHeight = pop.style.maxHeight;
    const prevWidth = pop.style.width;
    const prevPosition = pop.style.position;
    const prevAria = pop.getAttribute('aria-hidden');
    const hadActive = pop.classList.contains('active');

    pop.style.visibility = 'hidden';
    pop.classList.add('active');
    pop.setAttribute('aria-hidden', 'false');

    if (isComposerButton) {
      try {
        pop.classList.add('nc-emoji-shell', 'nc-emoji-stable', 'nc-composer-docked');
        composer.style.position = 'relative';
        composer.style.overflow = 'visible';
        if (chatInput) chatInput.style.overflow = 'visible';
        if (pop.parentElement !== composer) composer.appendChild(pop);

        pop.style.position = 'absolute';
        pop.style.left = 'auto';
        pop.style.top = 'auto';
        pop.style.right = '0px';
        pop.style.bottom = 'calc(100% + 10px)';

        const composerRect = composer.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const naturalRect = pop.getBoundingClientRect();

        const width = clamp(Math.round(Math.min(380, Math.max(320, composerRect.width * 0.36))), 320, 380);
        const naturalHeight = Math.max(320, Math.round(naturalRect.height || pop.offsetHeight || 430));
        const maxHeight = clamp(Math.min(naturalHeight, Math.max(280, Math.floor(composerRect.top - pad - gap)), 460), 300, 460);

        const right = clamp(
          Math.round(composerRect.right - btnRect.right + Math.max(0, ((btnRect.width || 0) - 36) / 2)),
          0,
          Math.max(0, Math.round(composerRect.width - 52))
        );

        if (!hadActive) {
          pop.classList.remove('active');
          pop.setAttribute('aria-hidden', prevAria || 'true');
        }
        pop.style.visibility = prevVis;
        pop.style.left = prevLeft;
        pop.style.top = prevTop;
        pop.style.right = prevRight;
        pop.style.bottom = prevBottom;
        pop.style.maxHeight = prevMaxHeight;
        pop.style.width = prevWidth;
        pop.style.position = prevPosition;

        requestAnimationFrame(() => {
          pop.classList.add('active');
          pop.classList.add('nc-composer-docked');
          pop.classList.remove('nc-open-up');
          pop.setAttribute('aria-hidden', 'false');
          pop.style.position = 'absolute';
          pop.style.width = width + 'px';
          pop.style.maxHeight = maxHeight + 'px';
          pop.style.left = 'auto';
          pop.style.top = 'auto';
          pop.style.right = right + 'px';
          pop.style.bottom = 'calc(100% + 10px)';
          pop.style.visibility = '';
          pop.dataset.mode = 'insert';
          pop.dataset.ncAnchor = 'composer';
          try { delete pop.dataset.targetMessageId; } catch (e) { pop.dataset.targetMessageId = ''; }
          try { if (window.__ncEmojiPopOnOpen) window.__ncEmojiPopOnOpen(pop); } catch (e) {}
        });
        return;
      } catch (e) {
        try { pop.dataset.ncAnchor = ''; } catch (_) {}
      }
    }

    // Fallback / reaction mode: legacy fixed-position menu in the viewport.
    try {
      if (pop.parentElement !== document.body) document.body.appendChild(pop);
    } catch (e) {}

    pop.style.position = 'fixed';
    pop.style.left = pad + 'px';
    pop.style.top = pad + 'px';
    pop.style.right = 'auto';
    pop.style.bottom = 'auto';

    const btnRect = btn.getBoundingClientRect();
    const composerRect = composer ? composer.getBoundingClientRect() : btnRect;
    const popRect = pop.getBoundingClientRect();

    const width = clamp(Math.round(Math.min(380, Math.max(336, composerRect.width * 0.34))), 336, 380);
    const naturalHeight = Math.max(320, Math.round(popRect.height || pop.offsetHeight || 470));

    const aboveRoom = Math.max(220, Math.floor(composerRect.top - pad - gap));
    const belowRoom = Math.max(170, Math.floor(window.innerHeight - composerRect.bottom - pad - gap));
    const openUp = aboveRoom >= belowRoom;
    const targetRoom = openUp ? aboveRoom : belowRoom;
    const maxHeight = clamp(Math.min(naturalHeight, targetRoom, 460), 300, 460);

    let left = Math.round(btnRect.right - width + 8);
    const minLeft = pad;
    const maxLeft = Math.max(minLeft, Math.round(window.innerWidth - width - pad));
    left = clamp(left, minLeft, maxLeft);

    if (composerRect && Number.isFinite(composerRect.left) && Number.isFinite(composerRect.right)) {
      const composerMinLeft = Math.max(minLeft, Math.round(composerRect.left));
      const composerMaxLeft = Math.min(maxLeft, Math.round(composerRect.right - width));
      if (composerMaxLeft >= composerMinLeft) {
        left = clamp(left, composerMinLeft, composerMaxLeft);
      }
    }

    let top = openUp
      ? Math.round(btnRect.top - maxHeight - 14)
      : Math.round(btnRect.bottom + 14);
    top = clamp(top, pad, Math.max(pad, window.innerHeight - maxHeight - pad));

    pop.classList.toggle('nc-open-up', openUp);

    const arrowCenter = clamp(
      Math.round(btnRect.left + (btnRect.width / 2) - left),
      36,
      Math.max(36, width - 36)
    );

    if (!hadActive) {
      pop.classList.remove('active');
      pop.setAttribute('aria-hidden', prevAria || 'true');
    }
    pop.style.visibility = prevVis;
    pop.style.left = prevLeft;
    pop.style.top = prevTop;
    pop.style.right = prevRight;
    pop.style.bottom = prevBottom;
    pop.style.maxHeight = prevMaxHeight;
    pop.style.width = prevWidth;
    pop.style.position = prevPosition;

    requestAnimationFrame(() => {
      pop.classList.add('active');
      pop.classList.add('nc-composer-docked');
      pop.setAttribute('aria-hidden', 'false');
      pop.style.position = 'fixed';
      pop.style.width = width + 'px';
      pop.style.maxHeight = maxHeight + 'px';
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
      pop.style.right = 'auto';
      pop.style.bottom = 'auto';
      pop.style.visibility = '';
      pop.style.setProperty('--nc-emoji-arrow-x', arrowCenter + 'px');
      pop.dataset.mode = 'insert';
      pop.dataset.ncAnchor = 'viewport';
      try { delete pop.dataset.targetMessageId; } catch (e) { pop.dataset.targetMessageId = ''; }
      try { if (window.__ncEmojiPopOnOpen) window.__ncEmojiPopOnOpen(pop); } catch (e) {}
    });
  }

  function installSafeEmojiToggle() {
    window.__ncSafeEmojiToggle = function(ev, btn){
      const pop = document.getElementById('emoji-pop');
      if (!pop || !btn) return false;
      try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {}

      const isOpen = pop.classList.contains('active') && String((pop.dataset && pop.dataset.mode) || 'insert') === 'insert';
      if (isOpen) {
        pop.classList.remove('active');
        pop.setAttribute('aria-hidden', 'true');
        return true;
      }

      positionSafeEmojiPop(pop, btn);
      return true;
    };
  }

  function initEmojiHoverButton() {
    const btn = document.getElementById('btn-emoji-insert');
    if (!btn) return;
    const face = btn.querySelector('.nc-emoji-btn-face') || btn.querySelector('.nc-emoji-face');
    if (!face) return;

    const frames = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','🙂','😉','😍','😘','😗','😙','😚','😜','🤪','😎','🤩','🥳','😇','😏','😛','😝','😋','🫠','🤑','🤗','😈'];
    const base = face.textContent || '😀';

    let hover = false;
    let timer = 0;

    const start = () => {
      hover = true;
      stopTimer();
      tick();
    };

    const stop = () => {
      hover = false;
      stopTimer();
      face.textContent = base;
      try{ btn.classList.remove('nc-emoji-hover'); }catch(e){}
    };

    const stopTimer = () => {
      if (timer) clearTimeout(timer);
      timer = 0;
    };

    const tick = () => {
      if (!hover) return;
      try{ btn.classList.add('nc-emoji-hover'); }catch(e){}
      const emo = frames[(Math.random()*frames.length)|0];
      face.textContent = emo;
      timer = setTimeout(tick, 85);
    };

    btn.addEventListener('mouseenter', start);
    btn.addEventListener('mouseleave', stop);

    // small pop on click
    btn.addEventListener('mousedown', ()=>{
      try{ btn.classList.add('nc-pop'); }catch(e){}
      setTimeout(()=>{ try{ btn.classList.remove('nc-pop'); }catch(e){} }, 220);
    });
  }


  function installHardComposerEmojiAnchor() {
    const btn = document.getElementById('btn-emoji-insert');
    const pop = document.getElementById('emoji-pop');
    if (!btn || !pop) return;
    if (btn.__ncEmojiAnchorBound) return;
    btn.__ncEmojiAnchorBound = true;

    const handler = function(ev){
      try {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      } catch (e) {}

      const isOpen = pop.classList.contains('active') && String((pop.dataset && pop.dataset.mode) || 'insert') === 'insert';
      if (isOpen) {
        try {
          pop.classList.remove('active');
          pop.setAttribute('aria-hidden', 'true');
        } catch (e) {}
        return false;
      }

      try {
        pop.classList.add('nc-emoji-shell', 'nc-emoji-stable', 'nc-composer-docked');
      } catch (e) {}
      positionSafeEmojiPop(pop, btn);
      return false;
    };

    btn.addEventListener('click', handler, true);
    btn.addEventListener('pointerdown', function(ev){
      try {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      } catch (e) {}
    }, true);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initEmojiPop();
    installSafeEmojiToggle();
    installHardComposerEmojiAnchor();
    initEmojiHoverButton();
  });

})();


/* Fix158: Emoji Combo Finisher (x6+) — premium neon arc + flash + sparks
   Safe addon: hooks emoji picks inside #emoji-pop ([data-emoji]).
*/
(function(){
  'use strict';
  if (window.__ncEmojiComboFinisher && window.__ncEmojiComboFinisher.v >= 158) return;
  window.__ncEmojiComboFinisher = { v: 158 };

  const cfg = {
    comboWindowMs: 780,
    finisherAt: 6,
    finisherCooldownMs: 900,
    sparks: 28
  };

  let lastPickAt = 0;
  let combo = 0;
  let lastFinisherAt = 0;

  function _now(){
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function ensureLayer(){
    let layer = document.getElementById('nc-emoji-fx-layer');
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = 'nc-emoji-fx-layer';
    layer.className = 'nc-emoji-fx-layer';
    document.body.appendChild(layer);
    return layer;
  }

  function centerOf(el){
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height };
  }

  function spawnComboBadge(c, n){
    if (n < 2) return;
    const layer = ensureLayer();
    const b = document.createElement('div');
    b.className = 'nc-emoji-fx-combo';
    b.textContent = 'x' + n;
    b.style.left = (c.x + 14) + 'px';
    b.style.top = (c.y - 16) + 'px';
    layer.appendChild(b);
    b.addEventListener('animationend', () => b.remove(), { once:true });
  }

  function spawnFlash(){
    const layer = ensureLayer();
    const el = document.createElement('div');
    el.className = 'nc-emoji-fx-flash';
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once:true });
  }

  function spawnRing(c){
    const layer = ensureLayer();
    const el = document.createElement('div');
    el.className = 'nc-emoji-fx-ring';
    el.style.left = c.x + 'px';
    el.style.top = c.y + 'px';
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once:true });
  }

  function spawnArc(c, combo){
    const layer = ensureLayer();
    const size = Math.max(120, Math.min(220, 130 + combo * 7));
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'nc-emoji-fx-arc');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.style.left = (c.x - size/2) + 'px';
    svg.style.top = (c.y - size/2) + 'px';

    const a = Math.random() * Math.PI * 2;
    const r = 40;
    const span = Math.PI * (0.95 + Math.random() * 0.35);
    const x1 = 50 + r * Math.cos(a);
    const y1 = 50 + r * Math.sin(a);
    const x2 = 50 + r * Math.cos(a + span);
    const y2 = 50 + r * Math.sin(a + span);
    const cx = 50 + 10 * Math.cos(a + span/2 + Math.PI/2);
    const cy = 50 + 10 * Math.sin(a + span/2 + Math.PI/2);

    const p1 = document.createElementNS(svgNS, 'path');
    p1.setAttribute('d', `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    p1.setAttribute('pathLength', '1');

    const p2 = document.createElementNS(svgNS, 'path');
    // secondary arc (slightly offset) for "premium"
    const r2 = 32;
    const x3 = 50 + r2 * Math.cos(a + 0.35);
    const y3 = 50 + r2 * Math.sin(a + 0.35);
    const x4 = 50 + r2 * Math.cos(a + span - 0.25);
    const y4 = 50 + r2 * Math.sin(a + span - 0.25);
    const cx2 = 50 + 8 * Math.cos(a + span/2 - Math.PI/2);
    const cy2 = 50 + 8 * Math.sin(a + span/2 - Math.PI/2);
    p2.setAttribute('d', `M ${x3.toFixed(1)} ${y3.toFixed(1)} Q ${cx2.toFixed(1)} ${cy2.toFixed(1)} ${x4.toFixed(1)} ${y4.toFixed(1)}`);
    p2.setAttribute('pathLength', '1');
    p2.style.opacity = '0.65';
    p2.style.strokeWidth = '2.6';

    svg.appendChild(p1);
    svg.appendChild(p2);
    layer.appendChild(svg);
    svg.addEventListener('animationend', () => svg.remove(), { once:true });
  }

  function spawnSparks(c, combo){
    const layer = ensureLayer();
    const count = Math.min(42, cfg.sparks + Math.max(0, combo - cfg.finisherAt) * 3);
    for (let i = 0; i < count; i++){
      const s = document.createElement('span');
      s.className = 'nc-emoji-fx-spark';

      const kindR = Math.random();
      if (kindR < 0.22) s.dataset.kind = 'star';
      else if (kindR < 0.48) s.dataset.kind = 'line';
      else s.dataset.kind = 'dot';

      const ang = Math.random() * Math.PI * 2;
      const dist = 44 + Math.random() * (56 + combo * 2);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist;

      s.style.setProperty('--dx', dx.toFixed(1) + 'px');
      s.style.setProperty('--dy', dy.toFixed(1) + 'px');

      if (s.dataset.kind === 'line'){
        const rot = (Math.random() * 180 - 90).toFixed(1);
        s.style.setProperty('--rot', rot + 'deg');
      }

      s.style.left = c.x + 'px';
      s.style.top = c.y + 'px';

      layer.appendChild(s);
      s.addEventListener('animationend', () => s.remove(), { once:true });
    }
  }

  function finisher(c, combo){
    spawnFlash();
    spawnRing(c);
    spawnArc(c, combo);
    spawnSparks(c, combo);
  }

  function onPick(btn){
    const t = _now();
    combo = (t - lastPickAt <= cfg.comboWindowMs) ? (combo + 1) : 1;
    lastPickAt = t;

    const c = centerOf(btn);
    spawnComboBadge(c, combo);

    if (combo >= cfg.finisherAt && (t - lastFinisherAt) > cfg.finisherCooldownMs){
      lastFinisherAt = t;
      finisher(c, combo);
    }
  }

  function bind(){
    const pop = document.getElementById('emoji-pop');
    if (!pop) return false;
    if (pop.dataset.ncFinisher158Bound === '1') return true;
    pop.dataset.ncFinisher158Bound = '1';

    // Click (capture): we only ADD FX, do not block insertion handlers.
    pop.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-emoji]') : null;
      if (!btn) return;
      if (!pop.contains(btn)) return;
      onPick(btn);
    }, true);

    // Keyboard enter on focused emoji cell
    pop.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const btn = e.target && e.target.closest ? e.target.closest('[data-emoji]') : null;
      if (!btn) return;
      if (!pop.contains(btn)) return;
      onPick(btn);
    }, true);

    // Reset combo when pop hides
    const mo = new MutationObserver(() => {
      const ariaHidden = (pop.getAttribute('aria-hidden') || '') === 'true';
      const hiddenClass = pop.classList.contains('nc-hidden') || pop.classList.contains('hidden');
      const dispNone = pop.style && pop.style.display === 'none';
      if (ariaHidden || hiddenClass || dispNone){
        combo = 0;
        lastPickAt = 0;
      }
    });
    mo.observe(pop, { attributes:true, attributeFilter:['aria-hidden','class','style'] });

    window.addEventListener('blur', () => { combo = 0; lastPickAt = 0; }, { passive:true });
    return true;
  }

  function init(){
    if (bind()) return;
    // Emoji pop can be re-rendered; retry a few seconds
    const start = _now();
    const t = setInterval(() => {
      if (bind()){ clearInterval(t); return; }
      if (_now() - start > 15000) clearInterval(t);
    }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
