/* Semantic script */

(function(){
  var __NC_APP_ONLY = /^\/app(?:$|[\/?#])/.test(location.pathname || '');
  if (!__NC_APP_ONLY) return;
  'use strict';

  const state = {
    selfId: 0,
    self: null,
    billing: null,
    cache: new Map(),
    pendingBulk: false,
    observerInstalled: false,
    applyTimer: 0,
    lastBulkAt: 0,
    lastBulkHash: '',
    lastBulkHashAt: 0,
    applying: false,
    tempBannerPreviewUrl: ''
  };

  const PRESETS = {
    default: 'linear-gradient(135deg, rgba(122,243,255,0.16), rgba(255,124,251,0.16))',
    purple: 'linear-gradient(135deg, rgba(119,72,255,0.34), rgba(255,110,230,0.28))',
    ocean: 'linear-gradient(135deg, rgba(0,208,255,0.22), rgba(94,117,255,0.24))',
    sunset: 'linear-gradient(135deg, rgba(255,136,64,0.26), rgba(255,74,170,0.24))',
    emerald: 'linear-gradient(135deg, rgba(31,220,141,0.22), rgba(0,196,255,0.18))',
    gold: 'linear-gradient(135deg, rgba(255,211,77,0.26), rgba(255,153,0,0.20))',
    rose: 'linear-gradient(135deg, rgba(255,98,177,0.24), rgba(167,139,250,0.22))',
    aurora: 'linear-gradient(135deg, rgba(92,255,190,0.18), rgba(78,155,255,0.20), rgba(191,112,255,0.18))',
    midnight: 'linear-gradient(135deg, rgba(40,55,110,0.26), rgba(18,21,36,0.32), rgba(95,74,170,0.20))',
    crimson: 'linear-gradient(135deg, rgba(255,82,110,0.25), rgba(125,20,50,0.22))',
    ice: 'linear-gradient(135deg, rgba(190,245,255,0.24), rgba(126,170,255,0.18))',
    synthwave: 'linear-gradient(135deg, rgba(255,59,146,0.22), rgba(124,58,237,0.22), rgba(34,211,238,0.18))',
    lava: 'linear-gradient(135deg, rgba(255,90,31,0.24), rgba(255,195,0,0.20), rgba(140,0,0,0.18))',
    forest: 'linear-gradient(135deg, rgba(34,197,94,0.20), rgba(20,83,45,0.24), rgba(56,189,248,0.14))',
    obsidian: 'linear-gradient(135deg, rgba(30,30,38,0.26), rgba(70,70,85,0.16), rgba(130,130,150,0.12))',
    berry: 'linear-gradient(135deg, rgba(236,72,153,0.22), rgba(147,51,234,0.20), rgba(59,130,246,0.14))',
    toxic: 'linear-gradient(135deg, rgba(163,255,58,0.18), rgba(39,39,42,0.24), rgba(34,197,94,0.16))'
  };

  const AVATAR_BADGES = {
    none: '', flame: '🔥', spark: '✨', crown: '👑', neon: '⚡', wings: '🪽', diamond: '💎',
    heart: '💖', skull: '💀', moon: '🌙', leaf: '🍃', shield: '🛡️', star: '⭐', glitch: '🌀'
  };

  const AVATAR_FRAMES = ['none','pulse','orbit','prism','ember','frost','toxic','royal','glitch','starlight','vortex','flora'];
  const NAME_FONTS = ['default','bold','rounded','mono','serif','wide','compact','script','cyber','pixel'];
  const NAME_EFFECTS = ['none','glow','gradient','chrome','neonblue','neonpink','rainbow','fire','ice','toxic','shimmer','outline'];
  const NAME_COLORS = ['none','cyan','pink','gold','lime','violet','white','sunset','ice','toxic','royal','crimson'];
  const NAME_GRADIENTS = ['none','aurora','sunset','discord','neon','icefire','emerald','cotton','royal','lava','mono','cyber'];
  const BANNER_FX = ['none','sparkle','scanline','pulse','stars','confetti','flame','matrix','nebula','glowlines','snow','hex'];
  const NAME_TAGS = ['none','vip','pro','plus','dev','mod','crew','neon','g4s','boss','lvl'];
  const TAG_LABELS = { none:'', vip:'VIP', pro:'PRO', plus:'PLUS', dev:'DEV', mod:'MOD', crew:'CREW', neon:'NEON', g4s:'G4S', boss:'BOSS', lvl:'LVL' };

  const THEME_PACKS = {
    nitro_wave: { bg:'synthwave', bannerFx:'nebula', nameFont:'cyber', nameEffect:'shimmer', nameColor:'none', nameGradient:'neon', nameTag:'PLUS', avatarFx:'neon', avatarFrame:'prism', avatarAura:'plasma', cardFrame:'cyber', cardFrameDm:'royal', cardFrameGuild:'cyber', roleGradient:'discord', badges:['rocket','bolt','diamond'] },
    firelord: { bg:'lava', bannerFx:'flame', nameFont:'wide', nameEffect:'fire', nameColor:'gold', nameGradient:'lava', nameTag:'BOSS', avatarFx:'flame', avatarFrame:'ember', avatarAura:'solar', cardFrame:'ember', cardFrameDm:'gold', cardFrameGuild:'ember', roleGradient:'ember', badges:['flame','crown','sun'] },
    frostbyte: { bg:'ice', bannerFx:'snow', nameFont:'rounded', nameEffect:'ice', nameColor:'none', nameGradient:'icefire', nameTag:'VIP', avatarFx:'diamond', avatarFrame:'frost', avatarAura:'frost', cardFrame:'diamond', cardFrameDm:'platinum', cardFrameGuild:'diamond', roleGradient:'ocean', badges:['ice','diamond','star'] },
    toxic_glitch: { bg:'toxic', bannerFx:'matrix', nameFont:'pixel', nameEffect:'toxic', nameColor:'none', nameGradient:'cyber', nameTag:'DEV', avatarFx:'glitch', avatarFrame:'glitch', avatarAura:'glitch', cardFrame:'obsidian', cardFrameDm:'obsidian', cardFrameGuild:'mythic', roleGradient:'toxic', badges:['toxic','code','skull'] },
    royal_gold: { bg:'gold', bannerFx:'glowlines', nameFont:'serif', nameEffect:'chrome', nameColor:'gold', nameGradient:'royal', nameTag:'VIP', avatarFx:'crown', avatarFrame:'royal', avatarAura:'halo', cardFrame:'royal', cardFrameDm:'gold', cardFrameGuild:'royal', roleGradient:'gold', badges:['crown','diamond','star'] },
    forest_spirit: { bg:'forest', bannerFx:'sparkle', nameFont:'rounded', nameEffect:'none', nameColor:'lime', nameGradient:'emerald', nameTag:'CREW', avatarFx:'leaf', avatarFrame:'flora', avatarAura:'sakura', cardFrame:'flora', cardFrameDm:'flora', cardFrameGuild:'platinum', roleGradient:'aurora', badges:['leaf','moon','heart'] },
    pink_anime: { bg:'berry', bannerFx:'confetti', nameFont:'script', nameEffect:'neonpink', nameColor:'pink', nameGradient:'cotton', nameTag:'PLUS', avatarFx:'heart', avatarFrame:'starlight', avatarAura:'sakura', cardFrame:'mythic', cardFrameDm:'mythic', cardFrameGuild:'royal', roleGradient:'rose', badges:['heart','star','cat'] },
    shadow_hacker: { bg:'obsidian', bannerFx:'hex', nameFont:'mono', nameEffect:'outline', nameColor:'white', nameGradient:'mono', nameTag:'DEV', avatarFx:'shield', avatarFrame:'vortex', avatarAura:'shadow', cardFrame:'obsidian', cardFrameDm:'obsidian', cardFrameGuild:'cyber', roleGradient:'midnight', badges:['code','shield','ghost'] },
    cosmo_vip: { bg:'aurora', bannerFx:'stars', nameFont:'bold', nameEffect:'rainbow', nameColor:'none', nameGradient:'aurora', nameTag:'VIP', avatarFx:'star', avatarFrame:'starlight', avatarAura:'pulse', cardFrame:'platinum', cardFrameDm:'royal', cardFrameGuild:'diamond', roleGradient:'aurora', badges:['star','rocket','moon'] },
    lava_core: { bg:'crimson', bannerFx:'flame', nameFont:'compact', nameEffect:'fire', nameColor:'crimson', nameGradient:'sunset', nameTag:'PRO', avatarFx:'flame', avatarFrame:'toxic', avatarAura:'void', cardFrame:'ember', cardFrameDm:'mythic', cardFrameGuild:'ember', roleGradient:'sunset', badges:['flame','skull','bolt'] }
  };

  const META = {
    bg: {
      default:{cat:'energy',rarity:'common',label:'Неоновый'}, purple:{cat:'energy',rarity:'rare'}, ocean:{cat:'nature',rarity:'rare'}, sunset:{cat:'energy',rarity:'rare'},
      emerald:{cat:'nature',rarity:'rare'}, gold:{cat:'royal',rarity:'epic'}, rose:{cat:'fun',rarity:'rare'}, aurora:{cat:'energy',rarity:'epic'}, midnight:{cat:'royal',rarity:'epic'},
      crimson:{cat:'royal',rarity:'rare'}, ice:{cat:'nature',rarity:'rare'}, synthwave:{cat:'cyber',rarity:'epic'}, lava:{cat:'energy',rarity:'epic'}, forest:{cat:'nature',rarity:'rare'},
      obsidian:{cat:'cyber',rarity:'common'}, berry:{cat:'fun',rarity:'rare'}, toxic:{cat:'cyber',rarity:'legendary'}
    },
    effect: {
      none:{cat:'all',rarity:'common'}, glow:{cat:'energy',rarity:'common'}, gradient:{cat:'fun',rarity:'rare'}, chrome:{cat:'royal',rarity:'epic'}, neonblue:{cat:'cyber',rarity:'rare'},
      neonpink:{cat:'fun',rarity:'rare'}, rainbow:{cat:'fun',rarity:'epic'}, fire:{cat:'energy',rarity:'epic'}, ice:{cat:'nature',rarity:'rare'}, toxic:{cat:'cyber',rarity:'legendary'},
      shimmer:{cat:'royal',rarity:'legendary'}, outline:{cat:'cyber',rarity:'common'}
    },
    avatarFx: {
      none:{cat:'all',rarity:'common'}, flame:{cat:'energy',rarity:'epic'}, spark:{cat:'energy',rarity:'rare'}, crown:{cat:'royal',rarity:'legendary'}, neon:{cat:'cyber',rarity:'rare'}, wings:{cat:'royal',rarity:'legendary'},
      diamond:{cat:'royal',rarity:'epic'}, heart:{cat:'fun',rarity:'rare'}, skull:{cat:'cyber',rarity:'epic'}, moon:{cat:'nature',rarity:'rare'}, leaf:{cat:'nature',rarity:'common'}, shield:{cat:'royal',rarity:'rare'},
      star:{cat:'energy',rarity:'epic'}, glitch:{cat:'cyber',rarity:'legendary'}
    },
    avatarFrame: {
      none:{cat:'all',rarity:'common'}, pulse:{cat:'energy',rarity:'common'}, orbit:{cat:'energy',rarity:'rare'}, prism:{cat:'cyber',rarity:'epic'}, ember:{cat:'energy',rarity:'epic'},
      frost:{cat:'nature',rarity:'rare'}, toxic:{cat:'cyber',rarity:'legendary'}, royal:{cat:'royal',rarity:'legendary'}, glitch:{cat:'cyber',rarity:'epic'}, starlight:{cat:'energy',rarity:'legendary'},
      vortex:{cat:'cyber',rarity:'legendary'}, flora:{cat:'nature',rarity:'epic'}
    }
  };

  const RARITY_LABEL = { common:'Common', rare:'Rare', epic:'Epic', legendary:'Legendary' };
  const RARITY_MARK = { common:'⚪', rare:'🔵', epic:'🟣', legendary:'🟠' };
  const CAT_LABEL = { energy:'Energy', nature:'Nature', royal:'Royal', cyber:'Cyber', fun:'Fun', all:'Все' };

  function el(id){ return document.getElementById(id); }

  function controls(){
    return {
      bgMode: el('edit-profile-bg-mode'),
      bg: el('edit-profile-bg'),
      bgInput: el('edit-profile-banner-input'),
      bgReset: el('edit-profile-banner-reset'),
      bgFile: el('edit-profile-banner-file'),
      bgWrap: el('epc-banner-upload-wrap'),
      bgCustomUrl: el('edit-profile-bg-custom-url'),
      bgCustomReset: el('edit-profile-bg-custom-reset'),
      filterCat: el('edit-profile-cos-filter-cat'),
      filterRarity: el('edit-profile-cos-filter-rarity'),
      font: el('edit-profile-name-font'),
      effect: el('edit-profile-name-effect'),
      nameColor: el('edit-profile-name-color'),
      nameGradient: el('edit-profile-name-gradient'),
      bannerFx: el('edit-profile-banner-fx'),
      tag: el('edit-profile-name-tag'),
      avatarFx: el('edit-profile-avatar-fx'),
      avatarFrame: el('edit-profile-avatar-frame'),
      themePack: el('edit-profile-theme-pack'),
      themeApply: el('edit-profile-theme-apply'),
      hint: el('edit-profile-cosmetics-hint')
    };
  }

  function billingInfo(){
    try { return state.billing || window.NC_BILLING || {}; } catch(e){ return {}; }
  }

  function billingFeatures(){
    try {
      const b = billingInfo();
      return b.features || (b.plan && b.plan.features) || {};
    } catch(e){ return {}; }
  }

  function currentPlanCode(){
    try {
      const b = billingInfo();
      return String((b.plan && b.plan.code) || 'free').toLowerCase();
    } catch(e){ return 'free'; }
  }

  function hasPremiumNameAvatar(){
    try {
      const f = billingFeatures();
      return !!(f.profile_badge || f.name_styles || f.avatar_decor);
    } catch(e){ return false; }
  }

  function hasProEffects(){
    try {
      const f = billingFeatures();
      return !!(f.pro_effects || currentPlanCode() === 'pro');
    } catch(e){ return false; }
  }

  function hasBasicThemePacks(){
    try {
      const f = billingFeatures();
      return !!(f.theme_packs_basic || hasProEffects());
    } catch(e){ return false; }
  }

  function rarityAllowed(rarity){
    if (!hasPremiumNameAvatar()) return false;
    if (hasProEffects()) return true;
    return String(rarity || 'common') === 'common' || String(rarity || 'common') === 'rare';
  }

  function optionAllowedForPlan(selectId, value){
    const v = String(value || '').toLowerCase();
    if (!v || v === 'none' || (selectId === 'edit-profile-bg' && v === 'default')) return true;
    if (selectId === 'edit-profile-bg') return true;
    const meta = optionMetaFor(selectId, v);
    if (meta) return rarityAllowed(meta.rarity);
    return hasPremiumNameAvatar();
  }

  function clampByPlan(selectId, value, fallback){
    const v = String(value || '').toLowerCase();
    return optionAllowedForPlan(selectId, v) ? v : String(fallback || 'none').toLowerCase();
  }

  function safeLocalBannerUrl(v){
    v = String(v || '').trim();
    if (!v) return '';
    if (!/^\/static\/profile_banners\//.test(v)) return '';
    if (v.indexOf('..') >= 0) return '';
    return v;
  }

  function makeBannerCss(bgKey, mode, customUrl){
    const base = PRESETS[bgKey] || PRESETS.default;
    const safe = safeLocalBannerUrl(customUrl);
    if (mode !== 'custom' || !safe) return base;
    return base + ', url(' + safe + ') center/cover no-repeat';
  }

  function normCos(c){
    c = c || {};
    const bg = String(c.profile_bg || 'default').toLowerCase();
    const nameFont = String(c.name_font || 'default').toLowerCase();
    const nameEffect = String(c.name_effect || 'none').toLowerCase();
    const avatarFx = String(c.avatar_fx || 'none').toLowerCase();
    const avatarFrame = String(c.avatar_frame || 'none').toLowerCase();
    const bannerFx = String(c.banner_fx || 'none').toLowerCase();
    const nameColor = String(c.name_color || 'none').toLowerCase();
    const nameGradient = String(c.name_gradient || 'none').toLowerCase();
    let bgMode = String(c.profile_bg_mode || 'preset').toLowerCase();
    let bgCustom = safeLocalBannerUrl(c.profile_bg_custom_url || '');
    if (bgMode !== 'custom' && bgMode !== 'preset') bgMode = 'preset';
    if (bgMode === 'custom' && !bgCustom) bgMode = 'preset';

    const out = {
      profile_bg: PRESETS[bg] ? bg : 'default',
      profile_bg_mode: bgMode,
      profile_bg_custom_url: bgCustom,
      profile_bg_css: String(c.profile_bg_css || '').trim() || makeBannerCss(PRESETS[bg] ? bg : 'default', bgMode, bgCustom),
      name_tag: clampByPlan('edit-profile-name-tag', NAME_TAGS.includes(String(c.name_tag || 'none').toLowerCase()) ? String(c.name_tag || 'none').toLowerCase() : 'none', 'none'),
      name_font: hasPremiumNameAvatar() && NAME_FONTS.includes(nameFont) ? nameFont : 'default',
      name_effect: clampByPlan('edit-profile-name-effect', NAME_EFFECTS.includes(nameEffect) ? nameEffect : 'none', 'none'),
      name_color: hasPremiumNameAvatar() && NAME_COLORS.includes(nameColor) ? nameColor : 'none',
      name_gradient: hasPremiumNameAvatar() && NAME_GRADIENTS.includes(nameGradient) ? nameGradient : 'none',
      avatar_fx: clampByPlan('edit-profile-avatar-fx', Object.prototype.hasOwnProperty.call(AVATAR_BADGES, avatarFx) ? avatarFx : 'none', 'none'),
      avatar_frame: clampByPlan('edit-profile-avatar-frame', AVATAR_FRAMES.includes(avatarFrame) ? avatarFrame : 'none', 'none'),
      banner_fx: hasPremiumNameAvatar() && BANNER_FX.includes(bannerFx) ? bannerFx : 'none'
    };
    out.profile_bg_css = makeBannerCss(out.profile_bg, out.profile_bg_mode, out.profile_bg_custom_url);
    return out;
  }

  function setSelectValue(select, value){
    if (!select) return;
    const v = String(value || '');
    const ok = Array.from(select.options || []).some(o => String(o.value) === v);
    select.value = ok ? v : (select.options[0] ? select.options[0].value : '');
  }

  function getFilterState(){
    const c = controls();
    return {
      cat: (c.filterCat && c.filterCat.value) ? c.filterCat.value : 'all',
      rarity: (c.filterRarity && c.filterRarity.value) ? c.filterRarity.value : 'all'
    };
  }

  function optionMetaFor(selectId, value){
    const map = {
      'edit-profile-bg': META.bg,
      'edit-profile-name-effect': META.effect,
      'edit-profile-avatar-fx': META.avatarFx,
      'edit-profile-avatar-frame': META.avatarFrame
    }[selectId] || null;
    return (map && map[value]) || null;
  }

  function decorateSelectOptionLabels(){
    const ids = ['edit-profile-bg','edit-profile-name-effect','edit-profile-avatar-fx','edit-profile-avatar-frame'];
    ids.forEach((id)=>{
      const node = el(id);
      if (!node) return;
      Array.from(node.options || []).forEach((opt)=>{
        if (!opt || !opt.value) return;
        const orig = opt.dataset.ncOrigLabel || opt.textContent;
        opt.dataset.ncOrigLabel = orig;
        const meta = optionMetaFor(id, String(opt.value || ''));
        if (!meta || String(opt.value) === 'none') {
          opt.textContent = orig;
          return;
        }
        opt.textContent = orig + ' ' + (RARITY_MARK[meta.rarity] || '') + ' [' + (CAT_LABEL[meta.cat] || meta.cat) + ' • ' + (RARITY_LABEL[meta.rarity] || meta.rarity) + ']';
      });
    });
  }

  function applySelectFilter(select){
    if (!select) return;
    const fs = getFilterState();
    const current = String(select.value || '');
    let currentVisible = true;
    Array.from(select.options || []).forEach((opt)=>{
      const val = String(opt.value || '');
      const meta = optionMetaFor(select.id, val);
      const baseVisible = (!meta || val === 'none' || (select.id === 'edit-profile-bg' && val === 'default'));
      if (baseVisible) {
        opt.hidden = false;
        return;
      }
      const catOk = (fs.cat === 'all') || meta.cat === fs.cat;
      const rarOk = (fs.rarity === 'all') || meta.rarity === fs.rarity;
      const planOk = optionAllowedForPlan(select.id, val);
      const show = catOk && rarOk && planOk;
      opt.hidden = !show;
      if (val === current && !show) currentVisible = false;
    });
    if (!currentVisible) {
      const fallback = Array.from(select.options || []).find(o => !o.hidden);
      if (fallback) select.value = fallback.value;
    }
  }

  function applyCatalogFilters(){
    ['edit-profile-bg','edit-profile-name-effect','edit-profile-avatar-fx','edit-profile-avatar-frame'].forEach((id)=> applySelectFilter(el(id)));
  }

  function clearTempBannerPreview(){
    try {
      if (state.tempBannerPreviewUrl) URL.revokeObjectURL(state.tempBannerPreviewUrl);
    } catch(e){}
    state.tempBannerPreviewUrl = '';
  }

  function syncCustomBannerControls(fromCos){
    const c = controls();
    const cos = normCos(fromCos || state.self || {});
    if (c.bgCustomUrl && !String(c.bgCustomUrl.value || '').trim()) {
      c.bgCustomUrl.value = cos.profile_bg_custom_url || '';
    }
    if (c.bgMode) setSelectValue(c.bgMode, cos.profile_bg_mode || 'preset');
    const customMode = !!(c.bgMode && c.bgMode.value === 'custom');
    if (c.bgWrap) c.bgWrap.classList.toggle('is-custom-mode', customMode);
    if (c.bg) {
      c.bg.disabled = customMode;
      const wrap = c.bg.closest('.epc-field');
      if (wrap) wrap.classList.toggle('is-muted', customMode);
    }
    if (c.bgFile) {
      const hasSaved = !!safeLocalBannerUrl(c.bgCustomUrl && c.bgCustomUrl.value);
      const hasLocal = !!(c.bgInput && c.bgInput.files && c.bgInput.files[0]);
      if (hasLocal) c.bgFile.textContent = c.bgInput.files[0].name || 'Выбрано';
      else if (hasSaved && customMode) c.bgFile.textContent = 'Сохранённый фон';
      else if (!String(c.bgFile.textContent || '').trim()) c.bgFile.textContent = 'Не выбрано';
    }
  }

  function currentPreviewCos(){
    const c = controls();
    const base = normCos(state.self || {});
    const premium = hasPremiumNameAvatar();
    const bgMode = c.bgMode && c.bgMode.value ? c.bgMode.value : base.profile_bg_mode;
    const bg = c.bg && c.bg.value ? c.bg.value : base.profile_bg;
    const bgCustomUrlSaved = (c.bgCustomUrl && c.bgCustomUrl.value) ? c.bgCustomUrl.value : base.profile_bg_custom_url;
    let bgCustomUrl = safeLocalBannerUrl(bgCustomUrlSaved);
    let bgCss = makeBannerCss(bg, bgMode, bgCustomUrl);
    if (bgMode === 'custom' && state.tempBannerPreviewUrl) {
      bgCss = (PRESETS[bg] || PRESETS.default) + ', url(' + state.tempBannerPreviewUrl + ') center/cover no-repeat';
    }
    const out = {
      profile_bg: bg,
      profile_bg_mode: bgMode,
      profile_bg_custom_url: bgCustomUrl,
      profile_bg_css: bgCss,
      name_font: premium && c.font && c.font.value ? c.font.value : (premium ? base.name_font : 'default'),
      name_effect: premium && c.effect && c.effect.value ? c.effect.value : (premium ? base.name_effect : 'none'),
      name_color: premium && c.nameColor && c.nameColor.value ? c.nameColor.value : (premium ? (base.name_color || 'none') : 'none'),
      name_gradient: premium && c.nameGradient && c.nameGradient.value ? c.nameGradient.value : (premium ? (base.name_gradient || 'none') : 'none'),
      name_tag: premium && c.tag && c.tag.value ? c.tag.value : (premium ? (base.name_tag || 'none') : 'none'),
      avatar_fx: premium && c.avatarFx && c.avatarFx.value ? c.avatarFx.value : (premium ? base.avatar_fx : 'none'),
      avatar_frame: premium && c.avatarFrame && c.avatarFrame.value ? c.avatarFrame.value : (premium ? base.avatar_frame : 'none'),
      banner_fx: premium && c.bannerFx && c.bannerFx.value ? c.bannerFx.value : (premium ? (base.banner_fx || 'none') : 'none')
    };
    const norm = normCos(out);
    norm.profile_bg_css = bgCss;
    return norm;
  }

  function clearNameClasses(node){
    if (!node) return;
    try {
      Array.from(node.classList || []).forEach((cls)=>{
        if (cls === 'nc-cos-nameplate' || cls === 'nc-cos-name-compact' || cls === 'nc-cos-animated' || cls.indexOf('nc-cos-font-') === 0 || cls.indexOf('nc-cos-namefx-') === 0 || cls.indexOf('nc-cos-namecolor-') === 0) {
          node.classList.remove(cls);
        }
      });
    } catch(e) {}
    node.style.removeProperty('--nc-nameplate-bg');
    node.removeAttribute('data-nc-name-color');
    node.removeAttribute('data-nc-name-gradient');
    const oldTag = node.querySelector(':scope > .nc-cos-tag');
    if (oldTag) oldTag.remove();
  }

  function applyName(node, cos){
    if (!node) return;
    clearNameClasses(node);
    const c = normCos(cos);

    // Keep the visible name in a dedicated span so sync updates don't wipe tags.
    let nameText = node.querySelector(':scope > .nc-cos-name');
    if (!nameText) {
      let raw = '';
      Array.from(node.childNodes || []).forEach((ch)=>{
        if (ch && ch.nodeType === 3) raw += ch.nodeValue || '';
      });
      Array.from(node.childNodes || []).forEach((ch)=>{
        if (ch && ch.nodeType === 3) node.removeChild(ch);
      });
      nameText = document.createElement('span');
      nameText.className = 'nc-cos-name';
      nameText.textContent = String(raw || '').trim();
      node.insertBefore(nameText, node.firstChild || null);

      // FIX246: remove legacy inline badges/dots accidentally injected into the name node
      try {
        Array.from(node.children || []).forEach((ch)=>{
          if (!ch || !ch.classList) { try{ ch && ch.remove && ch.remove(); }catch(e){}; return; }
          if (!ch.classList.contains('nc-cos-name') && !ch.classList.contains('nc-cos-tag')) { try{ ch.remove(); }catch(e){} }
        });
      } catch(e) {}

      // FIX246: if username ends with PLUS, do not show it inside the name text (badge will represent it)
      try {
        let t = String((nameText && nameText.textContent) || '').trim();
        const compact = t.replace(/\s+/g, '');
        if (compact && /PLUS$/i.test(compact)) {
          t = t.replace(/\s*PLUS\s*$/i, '').trim();
          if (t) nameText.textContent = t;
        }
      } catch(e) {}
    }

    node.classList.add('nc-cos-nameplate');
    if (node.matches && node.matches('.friend-name,.dc-mname,.gm-name,.member-name,.voice-name,.participant-name')) {
      node.classList.add('nc-cos-name-compact');
    }
    node.style.setProperty('--nc-nameplate-bg', PRESETS[c.profile_bg] || PRESETS.default);
    if (c.name_font && c.name_font !== 'default') node.classList.add('nc-cos-font-' + c.name_font);
    if (c.name_effect && c.name_effect !== 'none') node.classList.add('nc-cos-namefx-' + c.name_effect);
    if (c.name_color && c.name_color !== 'none') node.setAttribute('data-nc-name-color', c.name_color);
    if (c.name_gradient && c.name_gradient !== 'none') node.setAttribute('data-nc-name-gradient', c.name_gradient);

    const tagKey = String(c.name_tag || 'none');
    if (tagKey !== 'none' && TAG_LABELS[tagKey]) {
      const label = String(TAG_LABELS[tagKey] || '').trim();
      let baseName = '';
      try { baseName = String((nameText && nameText.textContent) || '').trim(); } catch(e) {}
      const compactName = baseName.replace(/[\s_\-\[\]()]+/g, '').toLowerCase();
      const compactLabel = label.replace(/[\s_\-\[\]()]+/g, '').toLowerCase();
      const oldTag = node.querySelector(':scope > .nc-cos-tag');
      if (oldTag) oldTag.remove();
      if (!(compactLabel && compactName && compactName.endsWith(compactLabel))) {
        const tag = document.createElement('span');
        tag.className = 'nc-cos-tag nc-cos-tag--' + tagKey;
        tag.textContent = label;
        node.appendChild(tag);
      }
    } else {
      const oldTag = node.querySelector(':scope > .nc-cos-tag');
      if (oldTag) oldTag.remove();
    }

    if ((c.name_effect && c.name_effect !== 'none') || (c.name_font && c.name_font !== 'default') || (c.name_tag && c.name_tag !== 'none')) {
      node.classList.add('nc-cos-animated');
    }
  }

  function applyAvatar(avatar, cos){
    if (!avatar) return;
    const c = normCos(cos);
    const fx = c.avatar_fx || 'none';
    const allowedFx = Object.prototype.hasOwnProperty.call(AVATAR_BADGES, fx) && fx !== 'none';
    if (allowedFx) avatar.setAttribute('data-nc-avatar-fx', fx);
    else avatar.removeAttribute('data-nc-avatar-fx');

    let badge = avatar.querySelector(':scope > .nc-avatar-fx-badge');
    if (!allowedFx) {
      if (badge) badge.remove();
    } else {
      if (!badge){
        badge = document.createElement('span');
        badge.className = 'nc-avatar-fx-badge';
        avatar.appendChild(badge);
      }
      badge.textContent = AVATAR_BADGES[fx] || '✨';
    }

    const frame = c.avatar_frame || 'none';
    const allowedFrame = AVATAR_FRAMES.includes(frame) && frame !== 'none';
    if (allowedFrame) avatar.setAttribute('data-nc-avatar-frame', frame);
    else avatar.removeAttribute('data-nc-avatar-frame');

    let ring = avatar.querySelector(':scope > .nc-avatar-frame-ring');
    if (!allowedFrame){
      if (ring) ring.remove();
      return;
    }
    if (!ring){
      ring = document.createElement('span');
      ring.className = 'nc-avatar-frame-ring';
      avatar.appendChild(ring);
    }
  }

  function applyBanner(banner, cos){
    if (!banner) return;
    const c = normCos(cos);
    banner.classList.add('nc-cos-banner');
    banner.style.setProperty('--nc-profile-banner-bg', c.profile_bg_css || (PRESETS[c.profile_bg] || PRESETS.default));
    if (c.banner_fx && c.banner_fx !== 'none') banner.setAttribute('data-nc-banner-fx', c.banner_fx);
    else banner.removeAttribute('data-nc-banner-fx');
  }

  function __ncScopeCosSig(scope, userId, cos){
    try{
      const c = normCos(cos || {});
      const scopeKey = (scope && (scope.id || scope.className || scope.getAttribute('data-user-id'))) || 'scope';
      return JSON.stringify({
        u: parseInt(userId || 0, 10) || 0,
        s: String(scopeKey || '').slice(0, 120),
        bg: c.profile_bg || 'default',
        bgm: c.profile_bg_mode || 'preset',
        bfx: c.banner_fx || 'none',
        font: c.name_font || 'default',
        ne: c.name_effect || 'none',
        nc: c.name_color || 'none',
        ng: c.name_gradient || 'none'
      });
    }catch(e){ return ''; }
  }

  function applyCosmeticsToScope(scope, userId, cos){
    if (!scope || !cos) return;
    const __sig = __ncScopeCosSig(scope, userId, cos);
    try{
      if (__sig && scope.dataset && scope.dataset.ncCosSig === __sig && scope.id !== 'modal-edit-profile') {
        try{ scope.setAttribute('data-nc-cos-applied', '1'); }catch(_e){}
        return;
      }
    }catch(e){}
    try{ scope.setAttribute('data-nc-cos-applied', '1'); }catch(e){}
    try{ if (__sig && scope.dataset) scope.dataset.ncCosSig = __sig; }catch(e){}
    const names = [];
    const avatars = [];

    scope.querySelectorAll('.friend-name, .dc-mname, .gm-name, .user-mini-name').forEach(n => names.push(n));
    scope.querySelectorAll('.avatar-circle, .dc-mavatar, .gm-av').forEach(a => avatars.push(a));

    if (scope.id === 'modal-user-mini') {
      const n = el('modal-user-name'); if (n) names.push(n);
      const a = el('modal-user-avatar'); if (a) avatars.push(a);
      const b = scope.querySelector('.user-mini-modal-banner'); if (b) applyBanner(b, cos);
    }
    if (scope.id === 'modal-user-full') {
      const n = el('full-user-name'); if (n) names.push(n);
      const a = el('full-user-avatar'); if (a) avatars.push(a);
      const b = el('full-user-banner'); if (b) applyBanner(b, cos);
    }
    if (scope.id === 'user-mini-card') {
      const n = el('mini-user-name'); if (n) names.push(n);
      const a = el('mini-user-avatar'); if (a) avatars.push(a);
      const b = scope.querySelector('.user-mini-banner'); if (b) applyBanner(b, cos);
    }
    if (scope.classList && scope.classList.contains('current-user')) {
      const n = scope.querySelector('.user-name'); if (n) names.push(n);
      const a = scope.querySelector('.avatar-circle'); if (a) avatars.push(a);
    }
    if (scope.classList && scope.classList.contains('profile-card')) {
      const n = scope.querySelector('.user-name'); if (n) names.push(n);
      const a = scope.querySelector('#profile-avatar, .avatar-circle'); if (a) avatars.push(a);
    }
    if (scope.id === 'modal-edit-profile') {
      const a = el('edit-profile-avatar-preview'); if (a) avatars.push(a);
    }

    Array.from(new Set(names)).forEach(n => applyName(n, cos));
    Array.from(new Set(avatars)).forEach(a => applyAvatar(a, cos));
  }
  window.__ncApplyProfileCosmeticsToCard = applyCosmeticsToScope;

  function previewFromControls(){
    const modal = el('modal-edit-profile');
    if (!modal || !modal.classList.contains('active')) return;
    syncCustomBannerControls(currentPreviewCos());
    applyCosmeticsToScope(modal, state.selfId, currentPreviewCos());
  }

  function syncControlsFromState(){
    const c = controls();
    const self = normCos(state.self || window.NC_PROFILE_COSMETICS_SELF || {});
    state.self = self;
    setSelectValue(c.bgMode, self.profile_bg_mode || 'preset');
    setSelectValue(c.bg, self.profile_bg);
    setSelectValue(c.font, self.name_font);
    setSelectValue(c.effect, self.name_effect);
    setSelectValue(c.nameColor, self.name_color || 'none');
    setSelectValue(c.nameGradient, self.name_gradient || 'none');
    setSelectValue(c.bannerFx, self.banner_fx || 'none');
    setSelectValue(c.tag, self.name_tag);
    setSelectValue(c.avatarFx, self.avatar_fx);
    setSelectValue(c.avatarFrame, self.avatar_frame);
    if (c.bgCustomUrl) c.bgCustomUrl.value = self.profile_bg_custom_url || '';
    if (c.bgCustomReset) c.bgCustomReset.value = '0';

    const premium = hasPremiumNameAvatar();
    const pro = hasProEffects();
    [c.font, c.effect, c.nameColor, c.nameGradient, c.bannerFx, c.tag, c.avatarFx, c.avatarFrame, c.themePack, c.themeApply].forEach((node)=>{
      if (!node) return;
      const isTheme = node === c.themePack || node === c.themeApply;
      node.disabled = isTheme ? !hasBasicThemePacks() : !premium;
      const wrapper = node.closest('.epc-field');
      if (wrapper) wrapper.classList.toggle('is-locked', isTheme ? !hasBasicThemePacks() : !premium);
    });

    if (c.themePack){
      const plusPacks = new Set(['nitro_wave','frostbyte','forest_spirit','pink_anime']);
      let visibleCurrent = false;
      Array.from(c.themePack.options || []).forEach((opt)=>{
        const val = String((opt && opt.value) || 'none').toLowerCase();
        const allow = val === 'none' || (pro ? true : plusPacks.has(val));
        opt.hidden = !allow;
        if (allow && val === String(c.themePack.value || '').toLowerCase()) visibleCurrent = true;
      });
      if (!visibleCurrent) c.themePack.value = 'none';
    }

    if (c.hint){
      c.hint.classList.remove('is-ok','is-locked');
      if (pro){
        c.hint.classList.add('is-ok');
        c.hint.textContent = 'Free даёт базовый профиль. NEON Plus открывает стили ника, градиенты, теги, баннер и украшения. NEON Pro добавляет все редкости, ауры, рамки, витрину значков и полные пресеты.';
      } else if (premium){
        c.hint.classList.add('is-ok');
        c.hint.textContent = 'Фон профиля и кастомная картинка — бесплатно. NEON Plus активен: стили/градиенты ника, мини-теги, анимации баннера, украшения и базовые пресеты включены. Эпик/легендарные эффекты доступны в NEON Pro.';
      } else {
        c.hint.classList.add('is-locked');
        c.hint.textContent = 'Фон карточки и своя картинка доступны всем. Стили/цвет ника, теги, украшения и базовые Nitro-style пресеты откроются на NEON Plus. Ауры, рамки и витрина значков — на NEON Pro.';
      }
    }

    decorateSelectOptionLabels();
    applyCatalogFilters();
    syncCustomBannerControls(self);
    previewFromControls();
  }
  window.__ncCosmeticsModalSyncFromState = syncControlsFromState;

  function applyThemePack(packId){
    const key = String(packId || '').trim();
    const p = THEME_PACKS[key];
    if (!p) return;
    const plusPacks = new Set(['nitro_wave','frostbyte','forest_spirit','pink_anime']);
    if (!hasProEffects() && !plusPacks.has(key)) return;
    const byId = (id)=> document.getElementById(id);
    const set = (id, v)=> { const n = byId(id); if (!n || v === undefined || v === null) return; try { setSelectValue(n, String(v).toLowerCase()); n.dispatchEvent(new Event('change', { bubbles:true })); } catch(e){} };
    set('edit-profile-bg', p.bg);
    set('edit-profile-banner-fx', p.bannerFx);
    set('edit-profile-name-font', p.nameFont);
    set('edit-profile-name-effect', p.nameEffect);
    set('edit-profile-name-color', p.nameColor);
    set('edit-profile-name-gradient', p.nameGradient);
    set('edit-profile-name-tag', String(p.nameTag || 'none').toLowerCase());
    set('edit-profile-avatar-fx', p.avatarFx);
    set('edit-profile-avatar-frame', p.avatarFrame);
    set('edit-profile-avatar-aura', p.avatarAura);
    set('edit-profile-card-frame', p.cardFrame);
    set('edit-profile-card-frame-dm', p.cardFrameDm);
    set('edit-profile-card-frame-guild', p.cardFrameGuild);
    set('edit-profile-role-gradient', p.roleGradient);
    const badges = Array.isArray(p.badges) ? p.badges : [];
    set('edit-profile-badge-slot-1', badges[0] || 'none');
    set('edit-profile-badge-slot-2', badges[1] || 'none');
    set('edit-profile-badge-slot-3', badges[2] || 'none');
    try { window.dispatchEvent(new CustomEvent('nc:cosmetics-banner-preview')); } catch(e){}
    previewFromControls();
  }

  function bindControls(){
    const c = controls();
    [c.bgMode, c.bg, c.font, c.effect, c.nameColor, c.nameGradient, c.bannerFx, c.tag, c.avatarFx, c.avatarFrame, c.filterCat, c.filterRarity, c.themePack].forEach((node)=>{
      if (!node || node.dataset.ncCosBound === '1') return;
      node.dataset.ncCosBound = '1';
      const handler = () => {
        if (node === c.filterCat || node === c.filterRarity) {
          decorateSelectOptionLabels();
          applyCatalogFilters();
        }
        if (node === c.bgMode) syncCustomBannerControls(currentPreviewCos());
        previewFromControls();
      };
      node.addEventListener('change', handler);
      node.addEventListener('input', handler);
    });

    if (c.bgInput && c.bgInput.dataset.ncCosBound !== '1') {
      c.bgInput.dataset.ncCosBound = '1';
      c.bgInput.addEventListener('change', ()=>{
        clearTempBannerPreview();
        const file = c.bgInput.files && c.bgInput.files[0];
        if (file) {
          try { state.tempBannerPreviewUrl = URL.createObjectURL(file); } catch(e){ state.tempBannerPreviewUrl = ''; }
          if (c.bgMode) c.bgMode.value = 'custom';
          if (c.bgCustomReset) c.bgCustomReset.value = '0';
        }
        syncCustomBannerControls(currentPreviewCos());
        previewFromControls();
      });
    }

    if (c.bgReset && c.bgReset.dataset.ncCosBound !== '1') {
      c.bgReset.dataset.ncCosBound = '1';
      c.bgReset.addEventListener('click', ()=>{
        clearTempBannerPreview();
        if (c.bgInput) c.bgInput.value = '';
        if (c.bgCustomUrl) c.bgCustomUrl.value = '';
        if (c.bgCustomReset) c.bgCustomReset.value = '1';
        if (c.bgMode && c.bgMode.value === 'custom') c.bgMode.value = 'preset';
        if (c.bgFile) c.bgFile.textContent = 'Не выбрано';
        syncCustomBannerControls(currentPreviewCos());
        previewFromControls();
      });
    }

    if (c.themeApply && c.themeApply.dataset.ncCosBound !== '1') {
      c.themeApply.dataset.ncCosBound = '1';
      c.themeApply.addEventListener('click', ()=> {
        const key = c.themePack && c.themePack.value ? c.themePack.value : 'none';
        applyThemePack(key);
      });
    }
  }

  async function fetchAccountMe(){
    try{
      const res = await fetch('/api/account/me', { credentials: 'same-origin' });
      if (!res.ok || res.status === 401 || (res.redirected && /\/login(?:$|[?#])/.test(res.url||""))) return;
      const data = await res.json();
      state.selfId = parseInt(data.user_id || 0, 10) || 0;
      state.self = normCos((data && data.cosmetics) || {});
      state.billing = (data && data.billing) || null;
      if (state.selfId) state.cache.set(state.selfId, state.self);
      window.NC_PROFILE_COSMETICS_SELF = state.self;
      try { window.NC_PROFILE_SHOWCASE_SELF = (data && data.showcase) || window.NC_PROFILE_SHOWCASE_SELF || {}; } catch(e) {}
      window.NC_BILLING = state.billing || window.NC_BILLING;
      syncControlsFromState();
      scheduleApply(30);
    }catch(e){}
  }

  async function bulkLoad(ids){
    // FIX249: hard throttle + dedupe to stop request spam (/api/users/cosmetics)
    if (!ids || !ids.length) return;
    // unique + sort for stable hashing
    ids = Array.from(new Set(ids.map(x => parseInt(x,10)||0).filter(Boolean))).sort((a,b)=>a-b);
    // only request missing cosmetics
    ids = ids.filter(uid => !state.cache.has(uid));
    if (!ids.length) return;

    const now = Date.now();
    const hash = ids.join(',');
    // don't spam the same batch
    if (hash === state.lastBulkHash && (now - state.lastBulkHashAt) < 8000) return;
    // global min interval
    if ((now - state.lastBulkAt) < 2500) return;
    if (state.pendingBulk) return;

    state.pendingBulk = true;
    state.lastBulkAt = now;
    state.lastBulkHash = hash;
    state.lastBulkHashAt = now;
    try{
      const res = await fetch('/api/users/cosmetics', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: ids })
      });
      if (!res.ok || res.status === 401 || (res.redirected && /\/login(?:$|[?#])/.test(res.url||""))) return;
      const data = await res.json();
      const items = (data && data.items) || {};
      Object.keys(items).forEach((k)=>{
        const uid = parseInt(k, 10) || 0;
        if (!uid) return;
        state.cache.set(uid, normCos(items[k] || {}));
      });
    }catch(e){}
    finally{
      state.pendingBulk = false;
      applyNow(false);
    }
  }

  function allUserScopes(){
    const out = [];
    document.querySelectorAll('[data-user-id]').forEach((n)=> out.push(n));
    const mini = el('modal-user-mini'); if (mini && mini.classList.contains('active')) out.push(mini);
    const full = el('modal-user-full'); if (full && full.classList.contains('active')) out.push(full);
    const mePanel = document.querySelector('.sidebar-bottom .current-user'); if (mePanel) out.push(mePanel);
    const meCard = document.querySelector('.profile-card'); if (meCard) out.push(meCard);
    const rightMini = el('user-mini-card'); if (rightMini) out.push(rightMini);
    const editModal = el('modal-edit-profile'); if (editModal && editModal.classList.contains('active')) out.push(editModal);
    return out;
  }

  function idForScope(scope){
    if (!scope) return 0;
    if (scope.id === 'modal-user-mini' || scope.id === 'modal-user-full') return parseInt((scope.dataset && scope.dataset.userId) || 0, 10) || 0;
    if (scope.id === 'user-mini-card') return parseInt((scope.dataset && scope.dataset.userId) || (scope.getAttribute && scope.getAttribute('data-user-id')) || 0, 10) || 0;
    if (scope.classList && (scope.classList.contains('current-user') || scope.classList.contains('profile-card') || scope.id === 'modal-edit-profile')) return state.selfId || 0;
    return parseInt((scope.getAttribute && scope.getAttribute('data-user-id')) || 0, 10) || 0;
  }

  function applyNow(requestMissing){
    if (requestMissing === undefined) requestMissing = true;
    state.applying = true;
    bindControls();
    const scopes = allUserScopes();
    const need = [];
    const seenNeed = new Set();

    scopes.forEach((scope)=>{
      const uid = idForScope(scope);
      if (!uid) return;
      let cos = null;
      if (state.selfId && uid === state.selfId && state.self) cos = state.self;
      if (!cos) cos = state.cache.get(uid) || null;
      if (scope.id === 'modal-edit-profile') cos = currentPreviewCos();
      if (cos) applyCosmeticsToScope(scope, uid, cos);
      else if (requestMissing && !seenNeed.has(uid)) {
        seenNeed.add(uid);
        need.push(uid);
      }
    });

    if (requestMissing && need.length) bulkLoad(need.slice(0, 120));
    state.applying = false;
  }

  function scheduleApply(delay){
    if (state.applying) return;
    const ms = typeof delay === 'number' ? delay : 260;
    clearTimeout(state.applyTimer);
    state.applyTimer = setTimeout(() => applyNow(true), ms);
  }

  function invalidateUserCache(uid){
    uid = parseInt(uid || 0, 10) || 0;
    if (!uid) return;
    try{
      state.cache.delete(uid);
      Array.from(state.cache.keys()).forEach((k)=>{
        const ks = String(k || '');
        if (ks === String(uid) || ks.indexOf(String(uid) + '@') === 0) state.cache.delete(k);
      });
    }catch(e){}
  }
  window.__ncApplyProfileCosmetics = scheduleApply;

  function installObserver(){
    if (state.observerInstalled || !document.body) return;
    state.observerInstalled = true;
    try{
      const mo = new MutationObserver((mutations) => {
        try{
          const now = Date.now();
          const bootLimit = (window.__ncFriendsBootUntil || 0);
          const relevant = (mutations||[]).some((m)=>{
            const t = m && m.target;
            if (!t || !t.closest) return false;
            if (now < bootLimit && t.closest('#friends-view, #pane-friends')) return false;
            return !!t.closest('#user-mini-card, #modal-user-mini, #modal-user-full, .current-user, .profile-card, #friends-view, #pane-friends');
          });
          if (!relevant) return;
        }catch(_e){}
        scheduleApply(Date.now() < (window.__ncFriendsBootUntil || 0) ? 700 : 320);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }catch(e){}
  }

  window.addEventListener('nc:cosmetics-banner-preview', ()=>{
    bindControls();
    const c = controls();
    if (c.bgInput && c.bgInput.files && c.bgInput.files[0]) {
      clearTempBannerPreview();
      try { state.tempBannerPreviewUrl = URL.createObjectURL(c.bgInput.files[0]); } catch(e){ state.tempBannerPreviewUrl = ''; }
    }
    syncCustomBannerControls(currentPreviewCos());
    previewFromControls();
  });

  window.addEventListener('nc:cosmetics-updated', (e)=>{
    try{
      clearTempBannerPreview();
      const next = normCos((e && e.detail && e.detail.self) || window.NC_PROFILE_COSMETICS_SELF || state.self || {});
      state.self = next;
      if (state.selfId) state.cache.set(state.selfId, next);
      syncControlsFromState();
      scheduleApply(20);
    }catch(err){}
  });

  window.addEventListener('nc:billing-updated', ()=>{
    try{ state.billing = window.NC_BILLING || state.billing; }catch(e){}
    syncControlsFromState();
    scheduleApply(30);
  });

  window.addEventListener('nc:remote-cosmetics-updated', (e)=>{
    try{
      const uid = parseInt(e && e.detail && e.detail.user_id || 0, 10) || 0;
      if (!uid) return;
      if (state.selfId && uid === state.selfId) { try{ fetchAccountMe(); }catch(_e){} return; }
      invalidateUserCache(uid);
      scheduleApply(20);
    }catch(_err){}
  });

  function init(){
    bindControls();
    decorateSelectOptionLabels();
    applyCatalogFilters();
    installObserver();
    fetchAccountMe();
    scheduleApply(200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();


(function(){
  var __NC_APP_ONLY = /^\/app(?:$|[\/?#])/.test(location.pathname || '');
  if (!__NC_APP_ONLY) return;
  'use strict';

  const AURAS = ['none','pulse','plasma','lightning','frost','sakura','shadow','halo','matrix','solar','void','glitch'];
  const CARD_FRAMES = ['none','bronze','silver','gold','platinum','diamond','royal','obsidian','cyber','ember','flora','mythic'];
  const ROLE_GRADIENTS = ['none','violet','cyan','sunset','gold','toxic','rose','ocean','ember','aurora','midnight','discord'];
  const BADGES = {
    crown:{e:'👑',t:'Crown'}, flame:{e:'🔥',t:'Flame'}, diamond:{e:'💎',t:'Diamond'}, star:{e:'⭐',t:'Star'}, moon:{e:'🌙',t:'Moon'},
    skull:{e:'💀',t:'Skull'}, heart:{e:'💖',t:'Heart'}, leaf:{e:'🍃',t:'Leaf'}, bolt:{e:'⚡',t:'Bolt'}, music:{e:'🎵',t:'Music'},
    game:{e:'🎮',t:'Game'}, ghost:{e:'👻',t:'Ghost'}, rocket:{e:'🚀',t:'Rocket'}, shield:{e:'🛡️',t:'Shield'}, ice:{e:'❄️',t:'Ice'},
    toxic:{e:'☣️',t:'Toxic'}, sun:{e:'☀️',t:'Sun'}, cat:{e:'🐱',t:'Cat'}, code:{e:'💻',t:'Code'}
  };

  const state = { selfId:0, self:null, billing:null, cache:new Map(), pending:false, timer:0 };

  function el(id){ return document.getElementById(id); }
  function controls(){
    return {
      aura: el('edit-profile-avatar-aura'),
      cardFrame: el('edit-profile-card-frame'),
      cardFrameDm: el('edit-profile-card-frame-dm'),
      cardFrameGuild: el('edit-profile-card-frame-guild'),
      roleGrad: el('edit-profile-role-gradient'),
      b1: el('edit-profile-badge-slot-1'),
      b2: el('edit-profile-badge-slot-2'),
      b3: el('edit-profile-badge-slot-3'),
      hint: el('edit-profile-cosmetics-hint')
    };
  }

  function canProEffects(){
    try{
      const f = (window.NC_BILLING && (window.NC_BILLING.features || (window.NC_BILLING.plan && window.NC_BILLING.plan.features))) || {};
      return !!(f.pro_effects || ((window.NC_BILLING && window.NC_BILLING.plan && window.NC_BILLING.plan.code) || '').toLowerCase() === 'pro');
    }catch(e){ return false; }
  }

  function uniqBadges(list){
    const out = [];
    const seen = new Set();
    (Array.isArray(list)?list:[]).forEach((x)=>{
      const k = String(x||'').trim().toLowerCase();
      if (!k || k === 'none' || k === 'music' || !BADGES[k] || seen.has(k)) return;
      seen.add(k); out.push(k);
    });
    return out.slice(0,3);
  }

  function norm(c){
    c = c || {};
    let badges = c.badge_showcase;
    if (typeof badges === 'string') badges = badges.split(',');
    badges = uniqBadges(badges);
    const aura = AURAS.includes(String(c.avatar_aura||'none').toLowerCase()) ? String(c.avatar_aura||'none').toLowerCase() : 'none';
    const card = CARD_FRAMES.includes(String(c.card_frame||'none').toLowerCase()) ? String(c.card_frame||'none').toLowerCase() : 'none';
    const cardDm = CARD_FRAMES.includes(String(c.card_frame_dm||card||'none').toLowerCase()) ? String(c.card_frame_dm||card||'none').toLowerCase() : card;
    const cardGuild = CARD_FRAMES.includes(String(c.card_frame_guild||card||'none').toLowerCase()) ? String(c.card_frame_guild||card||'none').toLowerCase() : card;
    const role = ROLE_GRADIENTS.includes(String(c.role_gradient||'none').toLowerCase()) ? String(c.role_gradient||'none').toLowerCase() : 'none';
    return Object.assign({}, c, { avatar_aura:aura, card_frame:card, card_frame_dm:cardDm, card_frame_guild:cardGuild, role_gradient:role, badge_showcase:badges });
  }

  function setSelect(node, value){
    if (!node) return;
    const v = String(value||'');
    const ok = Array.from(node.options||[]).some(o => String(o.value) === v);
    node.value = ok ? v : (node.options[0] ? node.options[0].value : '');
  }

  function stripMusicBadgeOptions(){
    const c = controls();
    [c.b1, c.b2, c.b3].forEach((sel)=>{
      if (!sel) return;
      try{ Array.from(sel.options || []).forEach((o)=>{ if (o && String(o.value||'').toLowerCase() === 'music') o.remove(); }); }catch(e){}
    });
  }

  function syncControlsFromSelf(){
    stripMusicBadgeOptions();
    const c = controls();
    const cos = norm(state.self || window.NC_PROFILE_COSMETICS_SELF || {});
    state.self = cos;
    setSelect(c.aura, cos.avatar_aura || 'none');
    setSelect(c.cardFrame, cos.card_frame || 'none');
    setSelect(c.cardFrameDm, cos.card_frame_dm || cos.card_frame || 'none');
    setSelect(c.cardFrameGuild, cos.card_frame_guild || cos.card_frame || 'none');
    setSelect(c.roleGrad, cos.role_gradient || 'none');
    const b = uniqBadges(cos.badge_showcase || []);
    setSelect(c.b1, b[0] || 'none');
    setSelect(c.b2, b[1] || 'none');
    setSelect(c.b3, b[2] || 'none');

    const premium = canProEffects();
    [c.aura, c.cardFrame, c.cardFrameDm, c.cardFrameGuild, c.roleGrad, c.b1, c.b2, c.b3].forEach((n)=>{
      if (!n) return;
      n.disabled = !premium;
      const w = n.closest('.epc-field');
      if (w) w.classList.toggle('is-locked', !premium);
    });
    if (c.hint){
      const extra = premium
        ? ' NEON Pro активен: ауры, рамки профиля, градиенты роли и витрина значков открыты.'
        : ' Доп. эффекты уровня Pro (ауры, рамки профиля, градиенты роли и витрина значков) откроются на NEON Pro.';
      const base = (c.hint.dataset.ncPlusBase || c.hint.textContent || '').replace(/\s+Доп\. эффекты v2[\s\S]*$/,'').trim();
      c.hint.dataset.ncPlusBase = base;
      c.hint.textContent = (base + extra).trim();
    }
  }

  function currentPreview(){
    const c = controls();
    const base = norm(state.self || {});
    if (!canProEffects()) return Object.assign({}, base, { avatar_aura:'none', card_frame:'none', card_frame_dm:'none', card_frame_guild:'none', role_gradient:'none', badge_showcase:[] });
    const badges = uniqBadges([c.b1 && c.b1.value, c.b2 && c.b2.value, c.b3 && c.b3.value]);
    return Object.assign({}, base, {
      avatar_aura: (c.aura && c.aura.value) || base.avatar_aura || 'none',
      card_frame: (c.cardFrame && c.cardFrame.value) || base.card_frame || 'none',
      card_frame_dm: (c.cardFrameDm && c.cardFrameDm.value) || base.card_frame_dm || base.card_frame || 'none',
      card_frame_guild: (c.cardFrameGuild && c.cardFrameGuild.value) || base.card_frame_guild || base.card_frame || 'none',
      role_gradient: (c.roleGrad && c.roleGrad.value) || base.role_gradient || 'none',
      badge_showcase: badges
    });
  }

  function getUserIdForScope(scope){
    if (!scope) return 0;
    if (scope.id === 'modal-edit-profile' || scope.classList.contains('profile-card') || scope.classList.contains('current-user')) return state.selfId || 0;
    if (scope.id === 'user-mini-card') return parseInt((scope.dataset && (scope.dataset.userId || scope.dataset.uid)) || scope.getAttribute('data-user-id') || '0', 10) || 0;
    if (scope.id === 'modal-user-mini' || scope.id === 'modal-user-full') return parseInt(scope.dataset.userId || '0', 10) || 0;
    if (scope.id === 'user-popout-card') return parseInt((el('popout-btn-primary') && el('popout-btn-primary').dataset.uid) || '0', 10) || 0;
    return parseInt(scope.getAttribute('data-user-id') || '0', 10) || 0;
  }

  function allScopes(){
    const out = [];
    document.querySelectorAll('[data-user-id]').forEach(n => out.push(n));
    const mini = el('modal-user-mini'); if (mini && mini.classList.contains('active')) out.push(mini);
    const full = el('modal-user-full'); if (full && full.classList.contains('active')) out.push(full);
    const edit = el('modal-edit-profile'); if (edit && edit.classList.contains('active')) out.push(edit);
    const me = document.querySelector('.sidebar-bottom .current-user'); if (me) out.push(me);
    const meCard = document.querySelector('.profile-card'); if (meCard) out.push(meCard);
    const rightMini = el('user-mini-card'); if (rightMini) out.push(rightMini);
    const popWrap = el('user-popout'); const popCard = el('user-popout-card');
    if (popWrap && popCard && !popWrap.hidden) out.push(popCard);
    return out;
  }

  function applyRoleGradient(scope, cos){
    if (!scope) return;
    const key = (cos && cos.role_gradient) || 'none';
    const targets = [];
    if (scope.id === 'modal-user-mini') { const n = el('modal-user-role-pill'); if (n) targets.push(n); }
    if (scope.id === 'modal-user-full') {
      scope.querySelectorAll('.user-badge, .chip-role, .user-full-meta-v').forEach(()=>{});
    }
    if (scope.id === 'user-popout-card') { const n = el('popout-role-pill'); if (n) targets.push(n); }
    scope.querySelectorAll('.nc-cos-tag, .user-mini-role-pill, .user-popout-role-pill, .user-badge, .chip-role').forEach(n => targets.push(n));
    Array.from(new Set(targets)).forEach((n)=>{
      if (!n) return;
      if (key && key !== 'none') n.setAttribute('data-nc-role-gradient', key);
      else n.removeAttribute('data-nc-role-gradient');
    });
  }

  function ensureAura(avatar){
    let aura = avatar.querySelector(':scope > .nc-avatar-aura');
    if (!aura){ aura = document.createElement('span'); aura.className = 'nc-avatar-aura'; avatar.appendChild(aura); }
    return aura;
  }

  function applyAvatarAura(scope, cos){
    const key = (cos && cos.avatar_aura) || 'none';
    const avatars = [];
    scope.querySelectorAll('.avatar-circle, .dc-mavatar, .gm-av').forEach(a => avatars.push(a));
    if (scope.id === 'modal-user-mini') { const a = el('modal-user-avatar'); if (a) avatars.push(a); }
    if (scope.id === 'modal-user-full') { const a = el('full-user-avatar'); if (a) avatars.push(a); }
    if (scope.id === 'user-mini-card') { const a = el('mini-user-avatar'); if (a) avatars.push(a); }
    if (scope.id === 'user-popout-card') { const a = el('popout-avatar'); if (a) avatars.push(a); }
    if (scope.id === 'modal-edit-profile') { const a = el('edit-profile-avatar-preview'); if (a) avatars.push(a); }
    Array.from(new Set(avatars)).forEach((a)=>{
      if (!a) return;
      if (key && key !== 'none') { a.setAttribute('data-nc-avatar-aura', key); ensureAura(a); }
      else { a.removeAttribute('data-nc-avatar-aura'); const x = a.querySelector(':scope > .nc-avatar-aura'); if (x) x.remove(); }
    });
  }

  function cardFrameForScope(scope, cos){
    const base = String((cos && cos.card_frame) || 'none').toLowerCase();
    const dm = String((cos && (cos.card_frame_dm || cos.card_frame)) || 'none').toLowerCase();
    const guild = String((cos && (cos.card_frame_guild || cos.card_frame)) || 'none').toLowerCase();
    let useDm = false;
    let useGuild = false;
    try {
      const cls = String((scope && scope.className) || '');
      if (scope && (scope.id === 'modal-edit-profile' || scope.id === 'modal-user-mini' || scope.id === 'modal-user-full' || scope.id === 'user-popout-card' || scope.id === 'user-mini-card')) useDm = true;
      if (scope && scope.classList && (scope.classList.contains('current-user') || scope.classList.contains('profile-card'))) useDm = true;
      if (!useDm && /\bdc-/.test(cls)) useGuild = true;
      if (!useGuild && scope && scope.querySelector && scope.querySelector('.dc-mname, .message-row, .guild-members, .channel-item')) useGuild = true;
      if (!useDm && !useGuild && /\bgm-/.test(cls)) useDm = true;
      if (!useDm && !useGuild && scope && scope.querySelector && scope.querySelector('.friend-name, .friends-list, .dm-list')) useDm = true;
    } catch(e){}
    const picked = useGuild ? guild : (useDm ? dm : base);
    return CARD_FRAMES.includes(picked) ? picked : 'none';
  }

  function applyCardFrame(scope, cos){
    const key = cardFrameForScope(scope, cos);
    const targets = [];
    if (scope.id === 'modal-user-mini') targets.push(scope.querySelector('.user-mini-popout') || scope.querySelector('.user-mini-modal') || scope.querySelector('.modal'));
    else if (scope.id === 'modal-user-full') targets.push(scope.querySelector('.user-full-modal') || scope.querySelector('.modal'));
    else if (scope.id === 'user-popout-card') targets.push(scope);
    else if (scope.id === 'modal-edit-profile') targets.push(scope.querySelector('.profile-edit-modal') || scope.querySelector('.modal'));
    else if (scope.classList && (scope.classList.contains('current-user') || scope.classList.contains('profile-card'))) targets.push(scope);
    else targets.push(scope);
    Array.from(new Set(targets)).forEach((t)=>{
      if (!t) return;
      if (key && key !== 'none') t.setAttribute('data-nc-card-frame', key);
      else t.removeAttribute('data-nc-card-frame');
    });
  }

  function badgeHtml(k){
    const b = BADGES[k];
    if (!b) return '';
    return '<span class="nc-badge-chip" data-badge="'+k+'" title="'+(b.t||k)+'">'+b.e+'</span>';
  }

  function applyBadgesToNameNode(nameNode, badges){
    if (!nameNode) return;
    const old = nameNode.querySelector(':scope > .nc-badge-showcase-inline');
    if (old) old.remove();
    badges = uniqBadges(badges);
    if (!badges.length) return;
    const wrap = document.createElement('span');
    wrap.className = 'nc-badge-showcase-inline';
    wrap.innerHTML = badges.map(badgeHtml).join('');
    nameNode.appendChild(wrap);
  }

  function ensureShowcaseBadgeBlock(container){
    if (!container) return null;
    let box = container.querySelector('.nc-showcase-badges');
    if (!box){
      box = document.createElement('div');
      box.className = 'nc-showcase-badges';
      container.insertBefore(box, container.firstChild || null);
    }
    return box;
  }

  function applyShowcaseBadges(scope, cos){
    const badges = uniqBadges((cos && cos.badge_showcase) || []);
    // inline badges: не в компактных списках/нижней панели (ломают ник и ширину)
    const names = [];
    scope.querySelectorAll('.friend-name, .dc-mname, .gm-name, .user-name, .user-mini-name').forEach(n => names.push(n));
    if (scope.id === 'modal-user-mini') { const n = el('modal-user-name'); if (n) names.push(n); }
    if (scope.id === 'modal-user-full') { const n = el('full-user-name'); if (n) names.push(n); }
    if (scope.id === 'user-popout-card') { const n = el('popout-name'); if (n) names.push(n); }
    Array.from(new Set(names)).forEach((n)=>{
      if (!n) return;
      try {
        if (n.closest('.current-user, .sidebar-bottom, .friend-item, .dm-item, .friends-list, .dm-list')) {
          applyBadgesToNameNode(n, []);
          return;
        }
      } catch(e){}
      applyBadgesToNameNode(n, badges);
    });

    // dedicated blocks on profile cards
    const miniBox = (scope.id === 'modal-user-mini') ? ensureShowcaseBadgeBlock(el('modal-user-showcase')) : null;
    const fullBox = (scope.id === 'modal-user-full') ? ensureShowcaseBadgeBlock(el('full-user-showcase')) : null;
    let popBox = null;
    if (scope.id === 'user-popout-card') {
      const body = scope.querySelector('.user-popout-body');
      if (body){
        popBox = body.querySelector('.nc-showcase-badges.popout');
        if (!popBox){ popBox = document.createElement('div'); popBox.className = 'nc-showcase-badges popout'; body.insertBefore(popBox, body.querySelector('.user-popout-role-row') || body.querySelector('.user-popout-primary') || null); }
      }
    }
    [miniBox, fullBox, popBox].forEach((box)=>{
      if (!box) return;
      if (!badges.length){ box.innerHTML = ''; box.style.display = 'none'; return; }
      box.style.display = '';
      box.innerHTML = '<div class="nc-showcase-badges-label">Любимые значки</div><div class="nc-showcase-badges-row">'+badges.map(badgeHtml).join('')+'</div>';
      const host = box.parentElement;
      if (host && (host.id === 'modal-user-showcase' || host.id === 'full-user-showcase')) host.style.display = '';
    });
  }

  function __ncPlusScopeSig(scope, cos){
    try{
      const c = norm(cos || {});
      const scopeKey = (scope && (scope.id || scope.className || scope.getAttribute('data-user-id'))) || 'scope';
      return JSON.stringify({
        s: String(scopeKey || '').slice(0, 120),
        aura: c.avatar_aura || 'none',
        frame: c.card_frame || 'none',
        frameDm: c.card_frame_dm || 'none',
        frameGuild: c.card_frame_guild || 'none',
        role: c.role_gradient || 'none',
        badges: Array.isArray(c.badge_showcase) ? c.badge_showcase.join(',') : ''
      });
    }catch(e){ return ''; }
  }

  function applyScope(scope, cos){
    if (!scope || !cos) return;
    const __sig = __ncPlusScopeSig(scope, cos);
    try{
      if (__sig && scope.dataset && scope.dataset.ncPlusCosSig === __sig && scope.id !== 'modal-edit-profile') return;
    }catch(e){}
    try{ if (__sig && scope.dataset) scope.dataset.ncPlusCosSig = __sig; }catch(e){}
    applyAvatarAura(scope, cos);
    applyCardFrame(scope, cos);
    applyRoleGradient(scope, cos);
    applyShowcaseBadges(scope, cos);
  }

  async function fetchMe(){
    try{
      const r = await fetch('/api/account/me', { credentials:'same-origin' });
      if (!r.ok || r.status === 401 || (r.redirected && /\/login(?:$|[?#])/.test(r.url||""))) return;
      const d = await r.json();
      state.selfId = parseInt(d.user_id || 0, 10) || state.selfId;
      state.self = norm(d.cosmetics || {});
      state.billing = d.billing || state.billing;
      if (state.selfId) state.cache.set(state.selfId, state.self);
      syncControlsFromSelf();
      schedule(50);
    }catch(e){}
  }

  async function bulk(ids){
    ids = Array.from(new Set((ids||[]).map(x => parseInt(x,10)||0).filter(Boolean)));
    if (!ids.length || state.pending) return;
    state.pending = true;
    try{
      const r = await fetch('/api/users/cosmetics', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_ids: ids.slice(0,120) }) });
      if (!r.ok || r.status === 401 || (r.redirected && /\/login(?:$|[?#])/.test(r.url||""))) return;
      const d = await r.json();
      const items = (d && d.items) || {};
      Object.keys(items).forEach((k)=>{
        const uid = parseInt(k,10)||0; if (!uid) return;
        state.cache.set(uid, norm(items[k]||{}));
      });
    }catch(e){}
    finally { state.pending = false; }
    applyAll(false);
  }

  function applyAll(requestMissing){
    const scopes = allScopes();
    const need = [];
    scopes.forEach((scope)=>{
      const uid = getUserIdForScope(scope);
      if (!uid) return;
      const cos = (state.selfId && uid === state.selfId) ? currentPreviewIfEdit(scope) : (state.cache.get(uid) || null);
      if (cos) applyScope(scope, norm(cos));
      else if (requestMissing !== false) need.push(uid);
    });
    if (requestMissing !== false && need.length) bulk(need);
  }

  function currentPreviewIfEdit(scope){
    if (scope && scope.id === 'modal-edit-profile') return currentPreview();
    return state.self || window.NC_PROFILE_COSMETICS_SELF || null;
  }

  function schedule(ms){
    clearTimeout(state.timer);
    state.timer = setTimeout(()=> applyAll(true), typeof ms === 'number' ? ms : 100);
  }

  function invalidateUserCache(uid){
    uid = parseInt(uid || 0, 10) || 0;
    if (!uid) return;
    try{
      state.cache.delete(uid);
      Array.from(state.cache.keys()).forEach((k)=>{
        const ks = String(k || '');
        if (ks === String(uid) || ks.indexOf(String(uid) + '@') === 0) state.cache.delete(k);
      });
    }catch(e){}
  }

  function bind(){
    const c = controls();
    [c.aura, c.cardFrame, c.cardFrameDm, c.cardFrameGuild, c.roleGrad, c.b1, c.b2, c.b3].forEach((n)=>{
      if (!n || n.dataset.ncPlusBound === '1') return;
      n.dataset.ncPlusBound = '1';
      const onChange = ()=> {
        if (n === c.b2 || n === c.b3) {
          // prevent duplicates quickly in UI
          const vals = uniqBadges([c.b1 && c.b1.value, c.b2 && c.b2.value, c.b3 && c.b3.value]);
          setSelect(c.b1, vals[0] || 'none'); setSelect(c.b2, vals[1] || 'none'); setSelect(c.b3, vals[2] || 'none');
        }
        schedule(0);
      };
      n.addEventListener('change', onChange);
      n.addEventListener('input', onChange);
    });
  }

  function installObserver(){
    if (!document.body) return;
    try {
      const mo = new MutationObserver((mutations)=> {
        try{
          const relevant = (mutations||[]).some((m)=>{
            const t = m && m.target;
            if (!t || !t.closest) return false;
            return !!t.closest('#friends-view, #pane-friends, #user-mini-card, #modal-user-mini, #modal-user-full, .current-user, .profile-card');
          });
          if (!relevant) return;
        }catch(_e){}
        schedule(60);
      });
      mo.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','data-user-id','hidden'] });
    } catch(e){}
  }

  window.addEventListener('nc:cosmetics-updated', (e)=>{
    try{
      const self = (e && e.detail && e.detail.self) || window.NC_PROFILE_COSMETICS_SELF || {};
      state.self = norm(self);
      if (state.selfId) state.cache.set(state.selfId, state.self);
      syncControlsFromSelf();
      schedule(0);
    }catch(err){}
  });
  window.addEventListener('nc:billing-updated', ()=> { syncControlsFromSelf(); schedule(0); });
  window.addEventListener('nc:cosmetics-banner-preview', ()=> schedule(0));
  window.addEventListener('nc:remote-cosmetics-updated', (e)=>{
    try{
      const uid = parseInt(e && e.detail && e.detail.user_id || 0, 10) || 0;
      if (!uid) return;
      if (state.selfId && uid === state.selfId) { try{ fetchMe(); }catch(_e){} return; }
      invalidateUserCache(uid);
      schedule(20);
    }catch(_err){}
  });

  function init(){
    bind();
    installObserver();
    fetchMe();
    syncControlsFromSelf();
    schedule(120);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();


(function(){
  'use strict';

  const $ = (s,r)=> (r||document).querySelector(s);
  const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));

  function toast(msg){
    try{ if (window.showToast) return window.showToast(String(msg||'')); }catch(e){}
    try{ console.log('[FIX227]', msg); }catch(e){}
  }

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  async function fetchJson(url, opts){
    const r = await fetch(url, Object.assign({credentials:'same-origin'}, opts||{}));
    let data = null;
    try{ data = await r.json(); }catch(e){}
    if (!r.ok) throw new Error((data && (data.error || data.message)) || ('HTTP '+r.status));
    return data || {};
  }

  async function postJson(url, payload){
    return fetchJson(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload || {})
    });
  }

  const NC_PLUS_NAME_FONT_OPTIONS = { default:'Обычный', bold:'Жирный', rounded:'Rounded', mono:'Mono', serif:'Serif', wide:'Wide', compact:'Compact', script:'Script', cyber:'Cyber', pixel:'Pixel' };
  const NC_PLUS_NAME_EFFECT_OPTIONS = { none:'Нет', glow:'Glow', gradient:'Gradient', chrome:'Chrome', neonblue:'Neon Blue', neonpink:'Neon Pink', rainbow:'Rainbow', fire:'Fire', ice:'Ice', toxic:'Toxic', shimmer:'Shimmer', outline:'Outline' };
  const NC_PLUS_NAME_COLOR_OPTIONS = { none:'Нет', cyan:'Cyan', pink:'Pink', gold:'Gold', lime:'Lime', violet:'Violet', white:'White', sunset:'Sunset', ice:'Ice', toxic:'Toxic', royal:'Royal', crimson:'Crimson' };
  const NC_PLUS_NAME_GRADIENT_OPTIONS = { none:'Нет', aurora:'Aurora', sunset:'Sunset', discord:'Discord', neon:'Neon', icefire:'Icefire', emerald:'Emerald', cotton:'Cotton', royal:'Royal', lava:'Lava', mono:'Mono', cyber:'Cyber' };
  const NC_PLUS_NAME_TAG_OPTIONS = { none:'Нет', vip:'VIP', pro:'PRO', plus:'NEON Plus', dev:'DEV', mod:'MOD', crew:'CREW', neon:'NEON', g4s:'GTA5', boss:'BOSS', lvl:'LVL' };

  function plusSelectOptions(map, current){
    const cur = String(current || '');
    return Object.keys(map).map(k=>`<option value="${esc(k)}" ${k===cur?'selected':''}>${esc(map[k])}</option>`).join('');
  }

  function ensurePlusFields(page){
    if (!page) return;
    const mainAboutField = $('#nc-prof-about', page)?.closest('.nc-prof-field');
    if (mainAboutField && !$('#nc-prof-plus-main', page)) {
      const box = document.createElement('div');
      box.className = 'nc-prof-section';
      box.id = 'nc-prof-plus-main';
      box.innerHTML = `
        <div class="nc-prof-section-title">NEON Plus · Ник и ID</div>
        <div class="nc-prof-muted" style="margin-bottom:8px;">Стили ника и тег/ID как в старом редакторе профиля.</div>
        <div class="nc-prof-row nc-prof-plus-row">
          <div class="nc-prof-field">
            <label class="nc-prof-label" for="nc-prof-plus-name-font">Шрифт ника</label>
            <select id="nc-prof-plus-name-font" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_FONT_OPTIONS, 'default')}</select>
          </div>
          <div class="nc-prof-field">
            <label class="nc-prof-label" for="nc-prof-plus-name-effect">Эффект ника</label>
            <select id="nc-prof-plus-name-effect" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_EFFECT_OPTIONS, 'none')}</select>
          </div>
        </div>
        <div class="nc-prof-row nc-prof-plus-row">
          <div class="nc-prof-field">
            <label class="nc-prof-label" for="nc-prof-plus-name-color">Цвет ника</label>
            <select id="nc-prof-plus-name-color" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_COLOR_OPTIONS, 'none')}</select>
          </div>
          <div class="nc-prof-field">
            <label class="nc-prof-label" for="nc-prof-plus-name-gradient">Градиент ника</label>
            <select id="nc-prof-plus-name-gradient" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_GRADIENT_OPTIONS, 'none')}</select>
          </div>
        </div>
        <div class="nc-prof-field" style="margin-bottom:0;">
          <label class="nc-prof-label" for="nc-prof-plus-name-tag">ID / тег</label>
          <select id="nc-prof-plus-name-tag" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_TAG_OPTIONS, 'none')}</select>
        </div>`;
      mainAboutField.insertAdjacentElement('afterend', box);
    }

    const serverAboutField = $('#nc-prof-server-about', page)?.closest('.nc-prof-field');
    if (serverAboutField && !$('#nc-prof-plus-server', page)) {
      const box = document.createElement('div');
      box.className = 'nc-prof-section';
      box.id = 'nc-prof-plus-server';
      box.innerHTML = `
        <div class="nc-prof-section-title">NEON Plus для профиля сервера</div>
        <div class="nc-prof-muted" style="margin-bottom:8px;">Эти настройки сохраняются локально для выбранного сервера.</div>
        <div class="nc-prof-row nc-prof-plus-row">
          <div class="nc-prof-field">
            <label class="nc-prof-label" for="nc-prof-server-plus-name-font">Шрифт ника</label>
            <select id="nc-prof-server-plus-name-font" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_FONT_OPTIONS, 'default')}</select>
          </div>
          <div class="nc-prof-field">
            <label class="nc-prof-label" for="nc-prof-server-plus-name-effect">Эффект ника</label>
            <select id="nc-prof-server-plus-name-effect" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_EFFECT_OPTIONS, 'none')}</select>
          </div>
        </div>
        <div class="nc-prof-row nc-prof-plus-row">
          <div class="nc-prof-field">
            <label class="nc-prof-label" for="nc-prof-server-plus-name-color">Цвет ника</label>
            <select id="nc-prof-server-plus-name-color" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_COLOR_OPTIONS, 'none')}</select>
          </div>
          <div class="nc-prof-field">
            <label class="nc-prof-label" for="nc-prof-server-plus-name-gradient">Градиент ника</label>
            <select id="nc-prof-server-plus-name-gradient" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_GRADIENT_OPTIONS, 'none')}</select>
          </div>
        </div>
        <div class="nc-prof-field" style="margin-bottom:0;">
          <label class="nc-prof-label" for="nc-prof-server-plus-name-tag">ID / тег</label>
          <select id="nc-prof-server-plus-name-tag" class="nc-prof-select">${plusSelectOptions(NC_PLUS_NAME_TAG_OPTIONS, 'none')}</select>
        </div>`;
      serverAboutField.insertAdjacentElement('afterend', box);
    }

    const cardBody = $('.nc-prof-card-body', page);
    if (cardBody && !$('#nc-prof-card-tag-row', page)) {
      const row = document.createElement('div');
      row.id = 'nc-prof-card-tag-row';
      row.className = 'nc-prof-card-tag-row';
      row.innerHTML = '<span class="nc-prof-card-tag is-hidden" id="nc-prof-card-tag"></span>';
      const userLine = $('#nc-prof-card-user', page);
      if (userLine) userLine.insertAdjacentElement('afterend', row);
      else cardBody.appendChild(row);
    }
  }

  function plusTagLabel(v){ return NC_PLUS_NAME_TAG_OPTIONS[String(v||'none').toLowerCase()] || ''; }

  function applyNamePreviewStyle(el, style){
    if (!el) return;
    style = style || {};
    const font = String(style.name_font || 'default');
    const effect = String(style.name_effect || 'none');
    const color = String(style.name_color || 'none');
    const grad = String(style.name_gradient || 'none');

    el.style.fontFamily = '';
    el.style.fontWeight = '800';
    el.style.letterSpacing = '';
    el.style.textTransform = '';
    if (font === 'bold') el.style.fontWeight = '900';
    else if (font === 'mono') el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    else if (font === 'serif') el.style.fontFamily = 'Georgia, serif';
    else if (font === 'wide') el.style.letterSpacing = '.04em';
    else if (font === 'compact') el.style.letterSpacing = '-.02em';
    else if (font === 'script') el.style.fontFamily = 'cursive';
    else if (font === 'cyber') { el.style.letterSpacing = '.03em'; el.style.textTransform = 'uppercase'; }
    else if (font === 'pixel') el.style.fontFamily = 'ui-monospace, monospace';

    const colorMap = { cyan:'#66e3ff', pink:'#ff7de5', gold:'#ffd166', lime:'#c7ff68', violet:'#b388ff', white:'#ffffff', sunset:'#ff9f68', ice:'#bfe9ff', toxic:'#a4ff5e', royal:'#93a0ff', crimson:'#ff6b88' };
    const gradMap = { aurora:'linear-gradient(90deg,#78ffd6,#79a7ff,#e879f9)', sunset:'linear-gradient(90deg,#ffb36b,#ff6ea8)', discord:'linear-gradient(90deg,#5865f2,#8ea1ff)', neon:'linear-gradient(90deg,#22d3ee,#a855f7)', icefire:'linear-gradient(90deg,#9be7ff,#60a5fa,#fb7185)', emerald:'linear-gradient(90deg,#34d399,#10b981)', cotton:'linear-gradient(90deg,#f9a8d4,#c4b5fd)', royal:'linear-gradient(90deg,#818cf8,#c084fc)', lava:'linear-gradient(90deg,#fb7185,#f59e0b)', mono:'linear-gradient(90deg,#ffffff,#9ca3af)', cyber:'linear-gradient(90deg,#22d3ee,#e879f9,#fde047)' };

    el.style.background = '';
    el.style.webkitBackgroundClip = '';
    el.style.backgroundClip = '';
    el.style.color = '#fff';
    if (grad !== 'none' && gradMap[grad]){
      el.style.background = gradMap[grad];
      el.style.webkitBackgroundClip = 'text';
      el.style.backgroundClip = 'text';
      el.style.color = 'transparent';
    } else if (color !== 'none' && colorMap[color]) {
      el.style.color = colorMap[color];
    }

    el.style.textShadow = '';
    const shadows = { glow:'0 0 10px rgba(140,180,255,.5)', neonblue:'0 0 12px rgba(59,130,246,.65)', neonpink:'0 0 12px rgba(236,72,153,.65)', fire:'0 0 12px rgba(251,146,60,.6)', ice:'0 0 12px rgba(125,211,252,.6)', toxic:'0 0 12px rgba(163,230,53,.6)', outline:'0 0 0.01px #000, 0 1px 0 rgba(0,0,0,.65)', shimmer:'0 0 8px rgba(255,255,255,.35)', chrome:'0 0 8px rgba(255,255,255,.25)', gradient:'0 0 6px rgba(168,85,247,.25)', rainbow:'0 0 10px rgba(255,255,255,.35)' };
    if (effect !== 'none' && shadows[effect]) el.style.textShadow = shadows[effect];
  }

  function readMainPlusValues(page){
    return {
      name_font: ($('#nc-prof-plus-name-font', page)?.value || 'default').toLowerCase(),
      name_effect: ($('#nc-prof-plus-name-effect', page)?.value || 'none').toLowerCase(),
      name_color: ($('#nc-prof-plus-name-color', page)?.value || 'none').toLowerCase(),
      name_gradient: ($('#nc-prof-plus-name-gradient', page)?.value || 'none').toLowerCase(),
      name_tag: ($('#nc-prof-plus-name-tag', page)?.value || 'none').toLowerCase()
    };
  }

  function readServerPlusValues(page){
    return {
      name_font: ($('#nc-prof-server-plus-name-font', page)?.value || 'default').toLowerCase(),
      name_effect: ($('#nc-prof-server-plus-name-effect', page)?.value || 'none').toLowerCase(),
      name_color: ($('#nc-prof-server-plus-name-color', page)?.value || 'none').toLowerCase(),
      name_gradient: ($('#nc-prof-server-plus-name-gradient', page)?.value || 'none').toLowerCase(),
      name_tag: ($('#nc-prof-server-plus-name-tag', page)?.value || 'none').toLowerCase()
    };
  }


  function getCurrentBasicProfile(){
    const name = ($('#nc-account-displayname')?.textContent || $('.current-user .user-name')?.textContent || '').trim();
    const username = ($('#nc-account-username-top')?.textContent || $('.current-user .user-tag')?.textContent || name || 'User').trim();
    const avatar = ($('#nc-account-avatar img')?.getAttribute('src') || $('.current-user .user-avatar')?.style?.backgroundImage?.replace(/^url\(["']?/, '').replace(/["']?\)$/,'') || '').trim();
    const status = ($('#my-status-text')?.textContent || '').trim();
    const accent = localStorage.getItem('nc_prof_banner_color_v1') || '#3ba55d';
    return { name, username, avatar, status, accent };
  }

  async function getGuildOptions(){
    try{
      const meta = await fetchJson('/api/sidebar_meta');
      const guilds = Array.isArray(meta.guilds) ? meta.guilds : [];
      return guilds.map(g=>({ id:String(g.guild_id||g.id||''), name:String(g.name||'Сервер') })).filter(g=>g.id);
    }catch(e){
      return [];
    }
  }

  async function getCosmetics(){
    try{
      const me = await fetchJson('/api/account/me');
      const sc = (me && me.showcase) || {};
      const cos = (me && me.cosmetics) || {};
      const billing = (me && me.billing) || {};
      return {
        tagline: String(sc.tagline || ''),
        about: String(sc.about || ''),
        badge: 'GTA5',
        serverTag: '',
        name_font: String(cos.name_font || 'default'),
        name_effect: String(cos.name_effect || 'none'),
        name_color: String(cos.name_color || 'none'),
        name_gradient: String(cos.name_gradient || 'none'),
        name_tag: String(cos.name_tag || 'none'),
        premium: String(billing.plan || billing.status || '')
      };
    }catch(e){
      return { tagline:'', about:'', badge:'GTA5', serverTag:'', name_font:'default', name_effect:'none', name_color:'none', name_gradient:'none', name_tag:'none', premium:'' };
    }
  }

  function ensureProfilesNavAndPage(){
    const overlay = $('#nc-settings-overlay');
    if (!overlay) return null;

    const nav = $('#nc-settings-nav', overlay);
    if (nav && !$('.nc-settings-item[data-page="profiles"]', nav)){
      const accountBtn = $('.nc-settings-item[data-page="account"]', nav);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nc-settings-item';
      btn.setAttribute('data-page', 'profiles');
      btn.textContent = 'Профили';
      if (accountBtn && accountBtn.parentNode){
        accountBtn.parentNode.insertBefore(btn, accountBtn.nextSibling);
      } else {
        nav.insertBefore(btn, nav.firstChild);
      }
      btn.addEventListener('click', ()=> activateSettingsPage('profiles'));
    }

    const scroll = $('.nc-settings-content-scroll', overlay);
    if (scroll && !$('.nc-settings-page[data-page="profiles"]', scroll)){
      const page = document.createElement('div');
      page.className = 'nc-settings-page nc-prof-settings-page';
      page.setAttribute('data-page', 'profiles');
      page.innerHTML = `
        <div class="nc-prof-wrap nc-prof-wrap--theme5" id="nc-prof-wrap-227">
          <div class="nc-prof-shell5">
            <aside class="nc-prof-shell5-side">
              <div class="nc-prof-shell5-preview-card">
                <div class="nc-prof-preview-title" id="nc-prof-preview-title">Предпросмотр профиля</div>
                <div class="nc-prof-card" id="nc-prof-card-preview">
                  <div class="nc-prof-card-banner" id="nc-prof-card-banner"></div>
                  <div class="nc-prof-card-body">
                    <div class="nc-prof-card-avatar" id="nc-prof-card-avatar">U</div>
                    <div class="nc-prof-card-status-btn">+ Добавить статус</div>
                    <div class="nc-prof-card-name" id="nc-prof-card-name">User</div>
                    <div class="nc-prof-card-user" id="nc-prof-card-user">username</div>
                    <div class="nc-prof-card-bio" id="nc-prof-card-bio"></div>
                    <button type="button" class="nc-prof-card-btn">Редактировать профиль</button>
                  </div>
                </div>
                <div class="nc-prof-shell5-upgrade">
                  <div class="nc-prof-shell5-upgrade-copy">
                    <strong>Прокачайте свой профиль</strong>
                    <span>Виджеты, украшения и premium-витрина в одном месте.</span>
                  </div>
                  <div class="nc-prof-shell5-upgrade-actions">
                    <button type="button" class="nc-prof-btn is-primary">Подписаться на Nitro</button>
                    <button type="button" class="nc-prof-btn is-secondary">Магазин</button>
                  </div>
                </div>
                <div class="nc-prof-actions nc-prof-actions--side">
                  <input id="nc-prof-avatar-file" type="file" accept="image/*" class="nc-prof-hidden">
                  <button type="button" class="nc-prof-btn is-ghost" id="nc-prof-avatar-pick">Смена аватара</button>
                  <button type="button" class="nc-prof-btn is-primary" id="nc-prof-main-save">Сохранить изменения</button>
                </div>
                <div class="nc-prof-muted" id="nc-prof-main-save-note"></div>
                <div class="nc-prof-badge-box">
                  <div class="nc-prof-section-title" style="margin-bottom:8px;">Бейджик</div>
                  <div class="nc-prof-badge-row">
                    <div class="nc-prof-badge-dot" id="nc-prof-badge-dot">NC</div>
                    <div>
                      <span class="nc-prof-badge-text" id="nc-prof-badge-name">User</span>
                      <span class="nc-prof-badge-tag" id="nc-prof-badge-tag">GTA5</span>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            <div class="nc-prof-shell5-main">
              <div class="nc-prof-title-row">
                <div class="nc-prof-title">Профили</div>
              </div>
              <div class="nc-prof-tabs" role="tablist" aria-label="Вкладки профиля">
                <button type="button" class="nc-prof-tab is-active" data-prof-tab="main">Основной профиль</button>
                <button type="button" class="nc-prof-tab" data-prof-tab="server">Личные профили сервера</button>
              </div>

              <div class="nc-prof-main-stage">
                <section class="nc-prof-section nc-prof-section--studio" data-prof-panel="main">
                  <div class="nc-prof-section-topline">PROFILE STUDIO</div>
                  <div class="nc-prof-section-title nc-prof-section-title--big">Сделайте профиль по-настоящему luxe</div>
                  <div class="nc-prof-section-subcopy">Редактируйте имя, описание, баннер и общую витрину профиля. Всё теперь собрано в одной тёмной studio-панели.</div>

                  <div class="nc-prof-row">
                    <div class="nc-prof-field">
                      <label class="nc-prof-label" for="nc-prof-display">Отображаемое имя</label>
                      <input id="nc-prof-display" class="nc-prof-input" type="text" maxlength="32" placeholder="Ваше имя">
                    </div>
                    <div class="nc-prof-field">
                      <label class="nc-prof-label" for="nc-prof-status">Статус</label>
                      <input id="nc-prof-status" class="nc-prof-input" type="text" maxlength="80" placeholder="Что у вас нового?">
                    </div>
                  </div>
                  <div class="nc-prof-field">
                    <label class="nc-prof-label" for="nc-prof-tagline">Местоположение</label>
                    <input id="nc-prof-tagline" class="nc-prof-input" type="text" maxlength="120" placeholder="Город / страна / где вы сейчас">
                  </div>
                  <div class="nc-prof-field">
                    <label class="nc-prof-label" for="nc-prof-about">Обо мне</label>
                    <textarea id="nc-prof-about" class="nc-prof-textarea" maxlength="190" placeholder="Расскажите немного о себе"></textarea>
                  </div>
                  <div class="nc-prof-row nc-prof-row--bottom">
                    <div class="nc-prof-field">
                      <label class="nc-prof-label" for="nc-prof-color">Цвет баннера</label>
                      <input id="nc-prof-color" class="nc-prof-color" type="color" value="#3ba55d">
                    </div>
                    <div class="nc-prof-field">
                      <label class="nc-prof-label">Быстрые действия</label>
                      <div class="nc-prof-quick-actions">
                        <button type="button" class="nc-prof-btn is-secondary">Украшение аватара</button>
                        <button type="button" class="nc-prof-btn is-secondary">Изменить бейджик</button>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="nc-prof-section nc-prof-widget-board" data-prof-panel="main">
                  <div class="nc-prof-section-headline">
                    <div>
                      <div class="nc-prof-section-title">Виджеты в профиле</div>
                      <div class="nc-prof-muted">Соберите свой профиль из готовых карточек как в full-profile studio.</div>
                    </div>
                    <button type="button" class="nc-prof-btn is-primary">Добавить виджеты</button>
                  </div>
                  <div class="nc-prof-widget-stage-tabs">
                    <button type="button" class="is-active">Доска</button>
                    <button type="button">Активность</button>
                    <button type="button">Вишлист</button>
                  </div>
                  <div class="nc-prof-widget-demo-grid nc-prof-widget-demo-grid--board">
                    <button class="nc-prof-widget-demo" type="button"><span>Marvel Rivals</span></button>
                    <button class="nc-prof-widget-demo" type="button"><span>Wuthering Waves</span></button>
                    <button class="nc-prof-widget-demo" type="button"><span>Любимая игра</span></button>
                    <button class="nc-prof-widget-demo" type="button"><span>Мои любимые игры</span></button>
                    <button class="nc-prof-widget-demo" type="button"><span>Текущие игры</span></button>
                    <button class="nc-prof-widget-demo" type="button"><span>Хочу поиграть</span></button>
                  </div>
                </section>

                <section class="nc-prof-section nc-prof-section--server nc-prof-hidden" data-prof-panel="server">
                  <div class="nc-prof-section-title">Личный профиль сервера</div>
                  <div class="nc-prof-muted nc-prof-server-note">Подготовьте отдельный ник, описание и стили для конкретного сервера.</div>
                  <div class="nc-prof-field">
                    <label class="nc-prof-label" for="nc-prof-server-select">Выберите сервер</label>
                    <select id="nc-prof-server-select" class="nc-prof-select"></select>
                  </div>
                  <div class="nc-prof-field">
                    <label class="nc-prof-label" for="nc-prof-server-nick">Никнейм на сервере</label>
                    <input id="nc-prof-server-nick" class="nc-prof-input" type="text" maxlength="32" placeholder="Никнейм на сервере">
                  </div>
                  <div class="nc-prof-field">
                    <label class="nc-prof-label" for="nc-prof-server-tagline">Местоположение</label>
                    <input id="nc-prof-server-tagline" class="nc-prof-input" type="text" maxlength="120" placeholder="Город / страна / где вы сейчас">
                  </div>
                  <div class="nc-prof-field">
                    <label class="nc-prof-label" for="nc-prof-server-about">Обо мне</label>
                    <textarea id="nc-prof-server-about" class="nc-prof-textarea" maxlength="190" placeholder="Расскажите этому серверу о себе"></textarea>
                  </div>
                  <div class="nc-prof-actions">
                    <button type="button" class="nc-prof-btn" id="nc-prof-server-copy">Скопировать из основного</button>
                    <button type="button" class="nc-prof-btn is-primary" id="nc-prof-server-save">Сохранить</button>
                  </div>
                  <div class="nc-prof-muted" id="nc-prof-server-note">Серверный профиль пока сохраняется локально на этом устройстве.</div>
                </section>

                <section class="nc-prof-section nc-prof-nitro-card" data-prof-panel="main">
                  <div class="nc-prof-nitro-head">
                    <div>
                      <div class="nc-prof-section-title nc-prof-section-title--big">Попробуйте Nitro!</div>
                      <div class="nc-prof-muted">Посмотрите, как мог бы выглядеть ваш профиль с premium-оформлением.</div>
                    </div>
                    <div class="nc-prof-nitro-chip">Знакомство с Nitro</div>
                  </div>
                  <div class="nc-prof-nitro-body">
                    <div class="nc-prof-nitro-copy">
                      <div class="nc-prof-nitro-swatches">
                        <button type="button" class="is-active"></button>
                        <button type="button"></button>
                      </div>
                      <div class="nc-prof-nitro-actions">
                        <button type="button" class="nc-prof-btn is-primary">Сменить баннер</button>
                        <button type="button" class="nc-prof-btn is-secondary">Добавить анимированный аватар</button>
                      </div>
                      <div class="nc-prof-nitro-footer">
                        <span>Прокачайте свой облик с подпиской Nitro</span>
                        <button type="button" class="nc-prof-btn is-primary">Подписаться на Nitro</button>
                      </div>
                    </div>
                    <div class="nc-prof-nitro-preview">
                      <div class="nc-prof-nitro-banner"></div>
                      <div class="nc-prof-nitro-avatar"></div>
                      <div class="nc-prof-nitro-tag">КИБЕРПАНК</div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>`;
      scroll.appendChild(page);
    }

    wireProfilesPageOnce();
    return overlay;
  }

  function activateSettingsPage(pageName){
    const overlay = $('#nc-settings-overlay');
    if (!overlay) return;
    $$('.nc-settings-item', overlay).forEach(btn=>{
      btn.classList.toggle('is-active', (btn.getAttribute('data-page')||'') === pageName);
    });
    $$('.nc-settings-page', overlay).forEach(pg=>{
      pg.classList.toggle('is-active', (pg.getAttribute('data-page')||'') === pageName);
    });
    try{ $('#nc-settings-search', overlay)?.blur(); }catch(e){}
  }

  let wired = false;
  function wireProfilesPageOnce(){
    if (wired) return;
    const overlay = $('#nc-settings-overlay');
    const page = $('.nc-settings-page[data-page="profiles"]', overlay);
    if (!page) return;
    ensurePlusFields(page);
    wired = true;

    page.addEventListener('click', async (e)=>{
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const tabBtn = t.closest('.nc-prof-tab');
      if (tabBtn){
        const tab = tabBtn.getAttribute('data-prof-tab') || 'main';
        setProfTab(tab);
        return;
      }
      if (t.id === 'nc-prof-avatar-pick'){
        $('#nc-prof-avatar-file', page)?.click();
        return;
      }
      if (t.id === 'nc-prof-main-save'){
        await saveMainProfile(page);
        return;
      }
      if (t.id === 'nc-prof-server-copy'){
        copyMainToServer(page);
        return;
      }
      if (t.id === 'nc-prof-server-save'){
        saveServerLocal(page);
        return;
      }
    });

    page.addEventListener('input', (e)=>{
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.matches('#nc-prof-display, #nc-prof-status, #nc-prof-tagline, #nc-prof-about, #nc-prof-color, #nc-prof-server-nick, #nc-prof-server-tagline, #nc-prof-server-about, #nc-prof-server-select, #nc-prof-plus-name-font, #nc-prof-plus-name-effect, #nc-prof-plus-name-color, #nc-prof-plus-name-gradient, #nc-prof-plus-name-tag, #nc-prof-server-plus-name-font, #nc-prof-server-plus-name-effect, #nc-prof-server-plus-name-color, #nc-prof-server-plus-name-gradient, #nc-prof-server-plus-name-tag')){
        updatePreview(page);
      }
    });

    const fileInput = $('#nc-prof-avatar-file', page);
    if (fileInput){
      fileInput.addEventListener('change', async ()=>{
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try{
          const fd = new FormData();
          fd.append('avatar', file);
          await fetchJson('/api/profile', { method:'POST', body: fd });
          try{ localStorage.setItem('nc_fix227_avatar_bust', String(Date.now())); }catch(e){}
          toast('Аватар обновлён');
          await hydrateProfilesPage(page, { keepTab:true, keepServer:true });
          // refresh top account card/avatar if main.js has helper
          try{ window.ncRefreshMyData && window.ncRefreshMyData(); }catch(e){}
        }catch(err){
          toast('Не удалось загрузить аватар');
        } finally {
          fileInput.value = '';
        }
      });
    }
  }

  function setProfTab(tab){
    const page = $('.nc-settings-page[data-page="profiles"]');
    if (!page) return;
    $$('.nc-prof-tab', page).forEach(b=>b.classList.toggle('is-active', (b.getAttribute('data-prof-tab')||'main') === tab));
    $$('[data-prof-panel]', page).forEach(p=>p.classList.toggle('nc-prof-hidden', (p.getAttribute('data-prof-panel')||'main') !== tab));
    try{ page.dataset.profTab = tab; }catch(e){}
    updatePreview(page);
  }

  function getStoredServerProfiles(){
    try{ return JSON.parse(localStorage.getItem('nc_fix227_server_profiles') || '{}') || {}; }catch(e){ return {}; }
  }
  function setStoredServerProfiles(obj){
    try{ localStorage.setItem('nc_fix227_server_profiles', JSON.stringify(obj||{})); }catch(e){}
  }

  function copyMainToServer(page){
    $('#nc-prof-server-nick', page).value = ($('#nc-prof-display', page).value || '').trim();
    $('#nc-prof-server-tagline', page).value = ($('#nc-prof-tagline', page).value || '').trim();
    $('#nc-prof-server-about', page).value = ($('#nc-prof-about', page).value || '').trim();
    const mp = readMainPlusValues(page);
    const sf = $('#nc-prof-server-plus-name-font', page); if (sf) sf.value = mp.name_font;
    const se = $('#nc-prof-server-plus-name-effect', page); if (se) se.value = mp.name_effect;
    const sc = $('#nc-prof-server-plus-name-color', page); if (sc) sc.value = mp.name_color;
    const sg = $('#nc-prof-server-plus-name-gradient', page); if (sg) sg.value = mp.name_gradient;
    const stg = $('#nc-prof-server-plus-name-tag', page); if (stg) stg.value = mp.name_tag;
    updatePreview(page);
    toast('Скопировано из основного профиля');
  }

  function saveServerLocal(page){
    const sel = $('#nc-prof-server-select', page);
    const gid = sel?.value || '';
    if (!gid){ toast('Сначала выбери сервер'); return; }
    const all = getStoredServerProfiles();
    all[gid] = {
      nick: ($('#nc-prof-server-nick', page).value || '').trim(),
      tagline: ($('#nc-prof-server-tagline', page).value || '').trim(),
      about: ($('#nc-prof-server-about', page).value || '').trim(),
      plus: readServerPlusValues(page)
    };
    setStoredServerProfiles(all);
    toast('Серверный профиль сохранён локально');
    updatePreview(page);
  }

  async function saveMainProfile(page){
    const name = ($('#nc-prof-display', page).value || '').trim();
    const status = ($('#nc-prof-status', page).value || '').trim();
    const tagline = ($('#nc-prof-tagline', page).value || '').trim();
    const about = ($('#nc-prof-about', page).value || '').trim();
    const color = ($('#nc-prof-color', page).value || '#3ba55d');
    const note = $('#nc-prof-main-save-note', page);
    if (note) note.textContent = 'Сохраняю…';
    try{
      if (name) {
        await postJson('/api/account/update_display_name', { value: name });
      }
      const fd = new FormData();
      fd.append('status', status);
      fd.append('showcase_tagline', tagline);
      fd.append('showcase_about', about);
      const plus = readMainPlusValues(page);
      fd.append('name_font', plus.name_font || 'default');
      fd.append('name_effect', plus.name_effect || 'none');
      fd.append('name_color', plus.name_color || 'none');
      fd.append('name_gradient', plus.name_gradient || 'none');
      fd.append('name_tag', plus.name_tag || 'none');
      const profileResp = await fetchJson('/api/profile', { method:'POST', body: fd });
      try{ localStorage.setItem('nc_prof_banner_color_v1', color); }catch(e){}
      try{
        if (profileResp && profileResp.cosmetics) {
          window.NC_PROFILE_COSMETICS_SELF = profileResp.cosmetics;
          window.dispatchEvent(new CustomEvent('nc:cosmetics-updated', { detail:{ self: profileResp.cosmetics } }));
          window.dispatchEvent(new CustomEvent('nc:profile-cosmetics-updated', { detail:{ source:'fix227-main-save', saved:true } }));
        }
        if (profileResp && profileResp.showcase) window.NC_PROFILE_SHOWCASE_SELF = profileResp.showcase;
      }catch(_e){}
      if (note) note.textContent = 'Сохранено';
      toast('Профиль сохранён');
      // sync account settings visible labels
      try{
        const d1 = $('#nc-account-displayname'); if (d1) d1.textContent = name || d1.textContent;
        const d2 = $('#nc-settings-me-name'); if (d2) d2.textContent = name || d2.textContent;
        const d3 = $('.current-user .user-name'); if (d3) d3.textContent = name || d3.textContent;
        const st = $('#my-status-text'); if (st) st.textContent = status;
      }catch(e){}
      updatePreview(page);
    }catch(err){
      if (note) note.textContent = 'Ошибка сохранения';
      toast('Не удалось сохранить профиль');
    }
  }

  async function hydrateProfilesPage(page, opts){
    opts = opts || {};
    const keepTab = !!opts.keepTab;
    const keepServer = !!opts.keepServer;
    const activeTab = keepTab ? (page.dataset.profTab || 'main') : 'main';
    const prevServer = keepServer ? ($('#nc-prof-server-select', page)?.value || '') : '';

    ensurePlusFields(page);
    const basic = getCurrentBasicProfile();
    const cos = await getCosmetics();
    const guilds = await getGuildOptions();
    const localServer = getStoredServerProfiles();

    $('#nc-prof-display', page).value = basic.name || basic.username || '';
    $('#nc-prof-status', page).value = basic.status || '';
    $('#nc-prof-tagline', page).value = cos.tagline || '';
    $('#nc-prof-about', page).value = cos.about || '';
    $('#nc-prof-color', page).value = (basic.accent && /^#[0-9a-fA-F]{6}$/.test(basic.accent)) ? basic.accent : '#3ba55d';
    const mF = $('#nc-prof-plus-name-font', page); if (mF) mF.value = String(cos.name_font || 'default');
    const mE = $('#nc-prof-plus-name-effect', page); if (mE) mE.value = String(cos.name_effect || 'none');
    const mC = $('#nc-prof-plus-name-color', page); if (mC) mC.value = String(cos.name_color || 'none');
    const mG = $('#nc-prof-plus-name-gradient', page); if (mG) mG.value = String(cos.name_gradient || 'none');
    const mT = $('#nc-prof-plus-name-tag', page); if (mT) mT.value = String(cos.name_tag || 'none');

    const sel = $('#nc-prof-server-select', page);
    if (sel){
      const options = guilds.length ? guilds : [{id:'0', name:'Текущий сервер'}];
      sel.innerHTML = options.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
      if (prevServer && options.some(g=>g.id === prevServer)) sel.value = prevServer;
      const rec = localServer[sel.value] || {};
      $('#nc-prof-server-nick', page).value = rec.nick || (basic.name || '').trim();
      $('#nc-prof-server-tagline', page).value = rec.tagline || '';
      $('#nc-prof-server-about', page).value = rec.about || '';
      const p0 = rec.plus || {};
      const sf0 = $('#nc-prof-server-plus-name-font', page); if (sf0) sf0.value = String(p0.name_font || cos.name_font || 'default');
      const se0 = $('#nc-prof-server-plus-name-effect', page); if (se0) se0.value = String(p0.name_effect || cos.name_effect || 'none');
      const sc0 = $('#nc-prof-server-plus-name-color', page); if (sc0) sc0.value = String(p0.name_color || cos.name_color || 'none');
      const sg0 = $('#nc-prof-server-plus-name-gradient', page); if (sg0) sg0.value = String(p0.name_gradient || cos.name_gradient || 'none');
      const st0 = $('#nc-prof-server-plus-name-tag', page); if (st0) st0.value = String(p0.name_tag || cos.name_tag || 'none');
      sel.onchange = function(){
        const rec2 = getStoredServerProfiles()[this.value] || {};
        $('#nc-prof-server-nick', page).value = rec2.nick || ($('#nc-prof-display', page).value || '').trim();
        $('#nc-prof-server-tagline', page).value = rec2.tagline || '';
        $('#nc-prof-server-about', page).value = rec2.about || '';
        const p2 = rec2.plus || {};
        const sf = $('#nc-prof-server-plus-name-font', page); if (sf) sf.value = String(p2.name_font || $('#nc-prof-plus-name-font', page)?.value || 'default');
        const se = $('#nc-prof-server-plus-name-effect', page); if (se) se.value = String(p2.name_effect || $('#nc-prof-plus-name-effect', page)?.value || 'none');
        const sc = $('#nc-prof-server-plus-name-color', page); if (sc) sc.value = String(p2.name_color || $('#nc-prof-plus-name-color', page)?.value || 'none');
        const sg = $('#nc-prof-server-plus-name-gradient', page); if (sg) sg.value = String(p2.name_gradient || $('#nc-prof-plus-name-gradient', page)?.value || 'none');
        const st = $('#nc-prof-server-plus-name-tag', page); if (st) st.value = String(p2.name_tag || $('#nc-prof-plus-name-tag', page)?.value || 'none');
        updatePreview(page);
      };
    }

    page.dataset._avatarUrl = basic.avatar || '';
    page.dataset._username = basic.username || basic.name || 'user';
    page.dataset._badge = cos.badge || 'GTA5';
    updatePreview(page);
    setProfTab(activeTab);
  }

  function updatePreview(page){
    if (!page) return;
    const tab = page.dataset.profTab || 'main';
    const baseName = ($('#nc-prof-display', page).value || '').trim() || (page.dataset._username || 'User');
    const baseUser = (page.dataset._username || baseName || 'user').trim();
    const baseTagline = ($('#nc-prof-tagline', page).value || '').trim();
    const baseAbout = ($('#nc-prof-about', page).value || '').trim();
    const color = ($('#nc-prof-color', page).value || '#3ba55d');
    const mainPlus = readMainPlusValues(page);

    let name = baseName;
    let bio = baseAbout || baseTagline;
    let previewTitle = 'Предпросмотр';

    let plus = Object.assign({}, mainPlus);
    if (tab === 'server'){
      const sel = $('#nc-prof-server-select', page);
      const selectedLabel = sel?.options?.[sel.selectedIndex]?.text || 'сервер';
      const sn = ($('#nc-prof-server-nick', page).value || '').trim();
      const sa = ($('#nc-prof-server-about', page).value || '').trim();
      const st = ($('#nc-prof-server-tagline', page).value || '').trim();
      if (sn) name = sn;
      bio = sa || st || bio;
      previewTitle = 'Предпросмотр: ' + selectedLabel;
      plus = Object.assign(plus, readServerPlusValues(page));
    }

    const banner = $('#nc-prof-card-banner', page);
    if (banner) banner.style.background = color;
    try{ localStorage.setItem('nc_prof_banner_color_v1', color); }catch(e){}

    const avatar = $('#nc-prof-card-avatar', page);
    const avatarUrl = page.dataset._avatarUrl || '';
    if (avatar){
      avatar.style.backgroundColor = color;
      if (avatarUrl){
        avatar.style.backgroundImage = `url("${avatarUrl.replace(/"/g,'')}")`;
        avatar.textContent = '';
      } else {
        avatar.style.backgroundImage = 'none';
        avatar.textContent = (name || baseUser || 'U').trim().charAt(0).toUpperCase();
      }
    }

    const uname = baseUser.replace(/^@/, '');
    $('#nc-prof-preview-title', page).textContent = previewTitle;
    const nmEl = $('#nc-prof-card-name', page);
    const userEl = $('#nc-prof-card-user', page);
    nmEl.textContent = name;
    userEl.textContent = '@' + uname;
    applyNamePreviewStyle(nmEl, plus);
    applyNamePreviewStyle(userEl, Object.assign({}, plus, { name_effect: 'none' }));
    userEl.style.fontSize = '12px';
    userEl.style.opacity = '.92';
    $('#nc-prof-card-bio', page).textContent = bio;
    const tagChip = $('#nc-prof-card-tag', page);
    const tagLabel = plusTagLabel(plus.name_tag);
    if (tagChip){
      tagChip.textContent = tagLabel || '';
      tagChip.classList.toggle('is-hidden', !tagLabel || String(plus.name_tag||'none') === 'none');
    }
    $('#nc-prof-badge-name', page).textContent = name;
    $('#nc-prof-badge-tag', page).textContent = (tagLabel && String(plus.name_tag||'none') !== 'none') ? tagLabel : (page.dataset._badge || 'GTA5');
    $('#nc-prof-badge-dot', page).textContent = (name || 'NC').replace(/\s+/g,'').slice(0,2).toUpperCase();
  }

  async function openProfilesSettings(opts){
    ensureProfilesNavAndPage();
    try{
      if (window.ncOpenSettingsModal) window.ncOpenSettingsModal();
      else $('#btn-open-user-settings')?.click();
    }catch(e){ $('#btn-open-user-settings')?.click(); }

    const overlay = $('#nc-settings-overlay');
    const page = $('.nc-settings-page[data-page="profiles"]', overlay);
    if (!page) return;

    await hydrateProfilesPage(page, { keepTab:false });
    activateSettingsPage('profiles');
    setProfTab((opts && opts.tab === 'server') ? 'server' : 'main');
  }

  // Expose for other fixes (fix32 uses __ncOpenEditProfileModal)
  window.__ncOpenProfileSettingsModal = openProfilesSettings;
  window.__ncOpenEditProfileModal = openProfilesSettings;

  // Some legacy handlers in main.js still call the old modal directly.
  // Keep alias fresh and auto-redirect if old modal is shown by any leftover trigger.
  function installLegacyProfileModalRedirect(){
    const bindAlias = ()=>{ try{ window.__ncOpenEditProfileModal = openProfilesSettings; }catch(_e){} };
    bindAlias();
    setTimeout(bindAlias, 0);
    setTimeout(bindAlias, 250);
    setTimeout(bindAlias, 1000);

    const legacy = document.getElementById('modal-edit-profile');
    if (!legacy || legacy.__ncFix227RedirectInstalled) return;
    legacy.__ncFix227RedirectInstalled = true;

    let guard = false;
    const redirect = ()=>{
      if (guard) return;
      if (!legacy.classList.contains('active')) return;
      guard = true;
      try{ legacy.classList.remove('active'); }catch(_e){}
      try{ openProfilesSettings({tab:'main'}); }catch(_e){}
      setTimeout(()=>{ guard = false; }, 80);
    };

    try{
      const mo = new MutationObserver(()=>{ redirect(); });
      mo.observe(legacy, { attributes:true, attributeFilter:['class'] });
    }catch(_e){}

    legacy.addEventListener('click', function(ev){
      const t = ev.target instanceof HTMLElement ? ev.target : null;
      if (!t) return;
      const inside = t.closest('.profile-edit-modal,.modal');
      if (inside) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation && ev.stopImmediatePropagation();
      try{ legacy.classList.remove('active'); }catch(_e){}
    }, true);
  }

  installLegacyProfileModalRedirect();

  // Intercept edit-profile triggers globally.
  document.addEventListener('click', function(e){
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;

    const editBtn = target.closest('#nc-edit-profile, [data-action="edit-profile"], .btn-edit-profile, .edit-profile-btn, #me-popout-edit');
    const bottomProfileName = target.closest('.sidebar-bottom .current-user .user-meta .user-name, .sidebar-bottom .current-user .user-meta .user-sub');
    const settingsMeEntry = target.closest('#nc-settings-me, .nc-settings-me, .nc-settings-me-name, .nc-settings-me-sub');

    if (editBtn || bottomProfileName || settingsMeEntry){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation && e.stopImmediatePropagation();
      openProfilesSettings({tab:'main'});
      return;
    }
  }, true);

  document.addEventListener('keydown', function(e){
    const key = e.key;
    if (key !== 'Enter' && key !== ' ') return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;
    const hit = target.closest('.sidebar-bottom .current-user .user-meta .user-name, .sidebar-bottom .current-user .user-meta .user-sub, #nc-settings-me, .nc-settings-me, .nc-settings-me-name, .nc-settings-me-sub, #nc-edit-profile, #me-popout-edit, [data-action="edit-profile"], .btn-edit-profile, .edit-profile-btn');
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation && e.stopImmediatePropagation();
    openProfilesSettings({tab:'main'});
  }, true);

  // ---- Friends page fixes: ensure list exists before syncing, no blank page until refresh ----
  function createFriendItem(friend){
    const uid = parseInt(friend.user_id, 10);
    if (!uid) return null;
    const li = document.createElement('li');
    li.className = 'friend-item dm-entry';
    li.dataset.userId = String(uid);
    li.dataset.username = String(friend.username || friend.display_name || ('User '+uid));
    li.dataset.avatarUrl = String(friend.avatar_url || '');
    li.dataset.status = String(friend.presence_text || '');
    li.dataset.online = friend.online ? '1' : '0';
    if (friend.dm_channel_id) li.dataset.dmChannelId = String(friend.dm_channel_id);
    if (friend.last_message_at) li.dataset.lastMessageAt = String(friend.last_message_at);

    const hasAvatar = !!(friend.avatar_url);
    li.innerHTML = `
      <div class="avatar-circle ${hasAvatar ? 'has-image' : ''}" ${hasAvatar ? `style="background-image:url('${esc(friend.avatar_url)}');"` : ''}>
        <span class="avatar-initial">${hasAvatar ? '' : esc((li.dataset.username||'U').charAt(0).toUpperCase())}</span>
        <span class="presence-dot ${friend.online ? 'is-online' : 'is-offline'}" aria-hidden="true"></span>
      </div>
      <div class="friend-meta">
        <div class="friend-row">
          <span class="friend-name">${esc(li.dataset.username)}</span>
          <span class="unread-badge ${(friend.unread||0) ? '' : 'is-hidden'}" aria-hidden="true">${friend.unread||''}</span>
        </div>
        <div class="friend-row sub">
          <span class="friend-sub">${esc(friend.online ? 'в сети' : 'не в сети')}</span>
          <span class="friend-preview"></span>
        </div>
      </div>`;

    li.addEventListener('click', ()=>{
      try{ window.openDmByUserId ? window.openDmByUserId(uid) : null; }catch(e){}
      try{
        $$('#pane-friends .friend-item').forEach(x=>x.classList.remove('is-active'));
        li.classList.add('is-active');
      }catch(e){}
    });
    return li;
  }

  async function ensureFriendsSidebarList(){
    const list = $('#pane-friends .friend-list');
    if (!list) return;
    const hasItems = !!list.querySelector('.friend-item');
    if (hasItems) return;
    try{
      const data = await fetchJson('/api/sidebar_meta');
      const friends = Array.isArray(data.friends) ? data.friends : [];
      if (!friends.length) return;
      list.innerHTML = '';
      friends.forEach(f=>{
        const li = createFriendItem(f);
        if (li) list.appendChild(li);
      });
    }catch(e){}
  }

  function syncFriendsPageNow(){
    try{
      if (typeof window.__ncSyncFriendsPageFromSidebar === 'function'){
        window.__ncSyncFriendsPageFromSidebar();
        return;
      }
    }catch(e){}

    const src = $('#pane-friends .friend-list');
    const dst = $('#friends-list');
    if (!src || !dst) return;
    const items = $$('.friend-item', src);
    if (!items.length) return;
    dst.innerHTML = '';
    items.forEach(it=>{
      const c = it.cloneNode(true);
      c.classList.add('friends-page-item');
      c.addEventListener('click', ()=>{
        const uid = parseInt(c.dataset.userId || '0', 10);
        if (uid && window.openDmByUserId) window.openDmByUserId(uid);
      });
      dst.appendChild(c);
    });
  }

  async function ensureFriendsVisible(){
    await ensureFriendsSidebarList();
    syncFriendsPageNow();
    setTimeout(syncFriendsPageNow, 60);
    setTimeout(syncFriendsPageNow, 180);
  }

  function installFriendsHooks(){
    // Wrap refreshSidebarMeta so new entries appear without full refresh.
    if (typeof window.refreshSidebarMeta === 'function' && !window.refreshSidebarMeta.__ncFix227Wrapped){
      const orig = window.refreshSidebarMeta;
      const wrapped = async function(){
        let out;
        try{ out = await orig.apply(this, arguments); }catch(e){ throw e; }
        try{ await ensureFriendsSidebarList(); }catch(e){}
        try{ syncFriendsPageNow(); }catch(e){}
        return out;
      };
      wrapped.__ncFix227Wrapped = true;
      window.refreshSidebarMeta = wrapped;
    }

    document.addEventListener('click', function(e){
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (!t) return;
      const hit = t.closest('#btn-open-friends-view, #friends-pill, [data-nav="friends"], .friend-home-btn, .rail-brand, #logo-home');
      if (!hit) return;
      // only act for explicit friends buttons / home brand after channel switch
      setTimeout(()=>{ ensureFriendsVisible(); }, 10);
      setTimeout(()=>{ ensureFriendsVisible(); }, 120);
    }, true);

    const list = $('#pane-friends .friend-list');
    if (list){
      const mo = new MutationObserver(()=>{
        try{ syncFriendsPageNow(); }catch(e){}
      });
      mo.observe(list, {childList:true, subtree:false});
    }

    // Startup sync
    setTimeout(()=>{ ensureFriendsVisible(); }, 250);
  }

  function boot(){
    ensureProfilesNavAndPage();
    // Friends/DM boot + syncing is already handled in main.js.
    // This legacy hook duplicates sidebar/page handlers and causes double open_dm calls.
    // Keep only profile/settings navigation wiring here.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();


/* FIX207 v3: User context menu (ПКМ) everywhere
   - binds immediately (no DOMContentLoaded race)
   - works when right-clicking nested nodes (avatar/name spans)
*/

(function(){
  'use strict';
  if (window.__ncUserCtxGlobal207_v3) return;
  window.__ncUserCtxGlobal207_v3 = true;

  const USER_SELECTORS = [
    '[data-user-id]','[data-userid]','[data-uid]',
    '.dc-member','.svs-member','.friend-item','.friends-page-item',
    '.msg-user','.msg-avatar','.voice-roster-user','.voice-participant',
    '.participant-tile','.user-mini','.user-pop'
  ].join(',');

  const UID_ANCHOR = '[data-user-id],[data-userid],[data-uid]';

  function closestUserEl(t){
    if(!t || !t.closest) return null;
    try{ return t.closest(USER_SELECTORS); }catch(e){ return null; }
  }

  function uidFrom(el){
    if(!el) return 0;
    try{
      const ds = el.dataset || {};
      const v = ds.userId || ds.userid || ds.uid || el.getAttribute('data-user-id') || el.getAttribute('data-userid') || el.getAttribute('data-uid') || '';
      return parseInt(String(v||'').trim(), 10) || 0;
    }catch(e){
      return 0;
    }
  }

  function findAnchor(el){
    if(!el) return null;
    try{
      if (el.closest) {
        const a = el.closest(UID_ANCHOR);
        if (a) return a;
      }
      if (el.querySelector) {
        const inner = el.querySelector(UID_ANCHOR);
        if (inner) return inner;
      }
    }catch(e){}
    return null;
  }

  let bound = false;
  function bind(){
    if (bound) return;
    bound = true;

    document.addEventListener('contextmenu', (e) => {
      try{
        const openFn = window.__ncOpenUserCtxFromEl || (typeof openUserCtxFromEl === 'function' ? openUserCtxFromEl : null);
        if(typeof openFn !== 'function') return;

        const t = e.target;
        if(!t || !t.closest) return;

        // Keep browser menu for inputs/editables
        if (t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], .allow-browser-context')) return;

        // Allow interaction inside already opened context menus
        if (t.closest('.context-menu')) return;

        let el = closestUserEl(t);
        if(!el) return;

        const anchor = findAnchor(el) || el;
        const uid = uidFrom(anchor);
        if(!uid) return;

        // Ensure uid exists on the element passed to openFn
        try{
          if (anchor.dataset){
            if (!anchor.dataset.userId) anchor.dataset.userId = String(uid);
            if (!anchor.dataset.uid) anchor.dataset.uid = String(uid);
          }
        }catch(_){ }

        openFn(anchor, e.clientX, e.clientY);

        // swallow only if menu became active
        const menu = document.getElementById('friend-context-menu');
        if (menu && menu.classList && menu.classList.contains('active')){
          e.preventDefault();
          try{ e.stopPropagation(); }catch(_){ }
        }
      }catch(err){}
    }, true);
  }

  try{ bind(); }catch(e){}
  // also bind after DOMContentLoaded just in case
  document.addEventListener('DOMContentLoaded', function(){ try{ bind(); }catch(e){} }, { once:true });
})();


(function(){
  var __NC_APP_ONLY = /^\/app(?:$|[\/?#])/.test(location.pathname || '');
  if (!__NC_APP_ONLY) return;
  'use strict';
  // Disabled: this legacy profile sync re-fetches /api/users/cosmetics and public profiles
  // on top of the current profile/cosmetics manager above, which causes startup flicker
  // and repeated cosmetics requests.
  return;
  if (window.__ncFix240ProfileSync) return; window.__ncFix240ProfileSync = true;

  var cachePublic = new Map();   // uid -> public profile
  var cacheCos = new Map();      // uid -> cosmetics
  var inflightPublic = new Set();
  var lastCollect = 0;
  var syncTimer = null;

  function qsa(sel, root){ try { return Array.from((root||document).querySelectorAll(sel)); } catch(e){ return []; } }
  function toInt(v){ var n = parseInt(v,10); return Number.isFinite(n) ? n : 0; }
  var TAG_LABELS = { none:'', vip:'VIP', pro:'PRO', plus:'PLUS', dev:'DEV', mod:'MOD', crew:'CREW', neon:'NEON', g4s:'G4S', boss:'BOSS', lvl:'LVL' };
  function displayTagLabel(cos){
    try { var k = String((cos && cos.name_tag) || 'none').toLowerCase(); return TAG_LABELS[k] || ''; } catch(e){ return ''; }
  }
  function dedupeDisplayName(raw, cos){
    var s = String(raw || '').trim();
    var tag = displayTagLabel(cos);
    if (!s || !tag) return s;
    var esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(?:[\\s\\-_.|•·]*)' + esc + '$', 'i');
    for (var i=0;i<3;i++){
      var ns = s.replace(re, '').trim();
      if (!ns || ns === s) break;
      s = ns;
    }
    // extra-safe compact suffix cleanup (jaki2932PLUS -> jaki2932 when PLUS badge is present)
    try{
      var cS = s.replace(/[\s_\-\[\]()]+/g,'').toLowerCase();
      var cT = tag.replace(/[\s_\-\[\]()]+/g,'').toLowerCase();
      if (cT && cS && cS.endsWith(cT)){
        var rx = new RegExp('(?:[\s\-_.|•·]*)' + esc + '$', 'i');
        var tmp = s.replace(rx,'').trim();
        if (tmp) s = tmp;
      }
    }catch(e){}
    return s || String(raw || '').trim();
  }

  function extractUid(el){
    if (!el) return 0;
    var cur = el;
    for (var i=0; cur && i<6; i++, cur=cur.parentElement){
      var ds = cur.dataset || {};
      var keys = ['userId','uid','memberId','authorId','peerId','targetUserId'];
      for (var k=0;k<keys.length;k++){
        var uid = toInt(ds[keys[k]]);
        if (uid>0) return uid;
      }
      var attrs = ['data-user-id','data-uid','data-member-id','data-author-id','data-peer-id','participant-id'];
      for (var a=0;a<attrs.length;a++){
        uid = toInt(cur.getAttribute && cur.getAttribute(attrs[a]));
        if (uid>0) return uid;
      }
    }
    return 0;
  }

  function collectVisibleUserIds(){
    var ids = new Set();
    var bootLimit = (window.__ncFriendsBootUntil || 0);
    qsa('[data-user-id],[data-uid],[data-member-id],[data-author-id],[data-peer-id],[participant-id]').forEach(function(el){
      try {
        if (Date.now() < bootLimit && el && el.closest && el.closest('#friends-view, #pane-friends')) return;
      } catch(e){}
      var uid = extractUid(el); if (uid>0) ids.add(uid);
    });
    // fallback: right profile card / modal often stores id in globals
    try { if (window.__ncMiniCardUserId) ids.add(toInt(window.__ncMiniCardUserId)); } catch(e){}
    try { if (window.currentDmUserId) ids.add(toInt(window.currentDmUserId)); } catch(e){}
    return Array.from(ids).filter(function(x){return x>0;}).slice(0,120);
  }

  function setNodeTextPreserveTags(node, text){
    if (!node) return;
    text = (text == null ? '' : String(text));
    // If node has a dedicated child for the name, prefer it.
    var named = node.querySelector && node.querySelector('.nc-cos-name');
    if (named) node = named;
    var firstText = null;
    for (var i=0;i<node.childNodes.length;i++){
      var c = node.childNodes[i];
      if (c.nodeType === 3){ firstText = c; break; }
    }
    if (firstText) {
      if ((firstText.nodeValue||'').trim() !== text) firstText.nodeValue = text;
    } else {
      node.insertBefore(document.createTextNode(text), node.firstChild || null);
    }
    try{ node.setAttribute('title', text); }catch(e){}
  }

  function applyPublicToElement(scope, pub, cos){
    if (!scope || !pub) return;
    var display = dedupeDisplayName((pub.display_name || pub.username || '').trim(), cos);
    if (!display) return;
    var selectors = [
      '.friend-name','.dc-mname','.gm-name','.user-mini-name','.user-name','.member-name','.voice-name','.participant-name',
      '.nc-settings-me-name','#mini-user-name','#full-user-name','#chat-title','#dm-title','#dm-chat-title','.chat-title','.chat-header-title','.dm-header-name','.peer-title'
    ].join(',');
    qsa(selectors, scope).forEach(function(n){ setNodeTextPreserveTags(n, display); });

    // Some places store username in dataset attributes.
    try {
      if (scope.dataset){
        if (scope.dataset.username != null) scope.dataset.username = pub.username || display;
        if (scope.dataset.displayName != null) scope.dataset.displayName = display;
      }
    } catch(e){}

    // Avatar sync (best-effort)
    if (pub.avatar_url){
      qsa('img', scope).forEach(function(img){
        try {
          var cls = img.className || '';
          if (/avatar|ava|user/i.test(cls) || img.closest('.profile-card,.friend-item,.member-item,.participant-tile,.user-mini-card')) {
            var cur = img.getAttribute('src') || '';
            if (!cur || cur.indexOf(pub.avatar_url) === -1) img.setAttribute('src', pub.avatar_url);
          }
        } catch(e){}
      });
    }
  }

  function applyForUid(uid){
    var pub = cachePublic.get(uid);
    var cos = cacheCos.get(uid);
    if (!pub && !cos) return;
    var scopes = [];
    qsa('[data-user-id],[data-uid],[data-member-id],[data-author-id],[data-peer-id],[participant-id]').forEach(function(el){
      if (extractUid(el) === uid) scopes.push(el);
    });
    // open profile/mini card may not carry dataset on inner name nodes; add common containers if current target matches
    try {
      if (toInt(window.__ncMiniCardUserId) === uid) {
        var mc = document.getElementById('mini-user-card') || document.querySelector('.user-mini-card');
        if (mc) scopes.push(mc);
      }
    } catch(e){}
    try {
      if (toInt(window.currentDmUserId) === uid) {
        var pc = document.querySelector('.profile-card');
        if (pc) scopes.push(pc);
      }
    } catch(e){}

    if (!scopes.length) return;
    scopes.forEach(function(scope){
      if (pub) applyPublicToElement(scope, pub, cos);
      try {
        if (typeof window.__ncApplyProfileCosmeticsToCard === 'function' && cos) {
          window.__ncApplyProfileCosmeticsToCard(scope, uid, cos);
        } else if (typeof window.__ncApplyProfileCosmetics === 'function') {
          window.__ncApplyProfileCosmetics();
        }
      } catch(e) {}
    });
  }

  function fetchPublic(uid){
    if (!uid || inflightPublic.has(uid)) return;
    inflightPublic.add(uid);
    fetch('/api/users/' + uid + '/profile', {credentials:'same-origin'})
      .then(function(r){ if (!r.ok || r.status === 401 || (r.redirected && /\/login(?:$|[?#])/.test(r.url||''))) return null; return r.json(); })
      .then(function(data){
        if (!data) return;
        cachePublic.set(uid, data);
        applyForUid(uid);
      })
      .catch(function(){})
      .finally(function(){ inflightPublic.delete(uid); });
  }

  function fetchCosmeticsBulk(ids){
    if (!ids || !ids.length) return Promise.resolve();
    return fetch('/api/users/cosmetics', {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({user_ids: ids})
    }).then(function(r){ if (!r.ok || r.status === 401 || (r.redirected && /\/login(?:$|[?#])/.test(r.url||''))) return null; return r.json(); })
      .then(function(data){
        var items = (data && data.items) || {};
        Object.keys(items).forEach(function(k){
          var uid = toInt(k); if (!uid) return;
          cacheCos.set(uid, items[k] || {});
          applyForUid(uid);
        });
      }).catch(function(){});
  }

  function syncNow(force){
    var ids = collectVisibleUserIds();
    if (!ids.length) return;
    fetchCosmeticsBulk(ids);
    ids.forEach(function(uid){ if (force || !cachePublic.has(uid)) fetchPublic(uid); else applyForUid(uid); });
    // Ensure global cosmetics pass for newly rendered bits.
    try { if (typeof window.__ncApplyProfileCosmetics === 'function') window.__ncApplyProfileCosmetics(); } catch(e){}
  }

  function schedule(ms, force){
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function(){ syncNow(!!force); }, ms || 0);
  }

  // Observe DOM changes and refresh throttled
  try {
    var mo = new MutationObserver(function(muts){
      var now = Date.now();
      var bootLimit = (window.__ncFriendsBootUntil || 0);
      if (now - lastCollect < (now < bootLimit ? 900 : 250)) return;
      var relevant = (muts || []).some(function(m){
        var t = m && m.target;
        if (!t || !t.closest) return true;
        if (now < bootLimit && t.closest('#friends-view, #pane-friends')) return false;
        return true;
      });
      if (!relevant) return;
      lastCollect = now;
      schedule(now < bootLimit ? 420 : 80, false);
    });
    mo.observe(document.documentElement || document.body, {subtree:true, childList:true});
  } catch(e){}

  // Socket live updates
  function bindSocket(){
    var s = window.socket;
    if (!s || s.__ncFix240Bound) return;
    s.__ncFix240Bound = true;
    try {
      s.on('user_profile_cosmetics_updated', function(p){
        var uid = toInt(p && p.user_id); if (!uid) return;
        cacheCos.delete(uid); fetchCosmeticsBulk([uid]); fetchPublic(uid);
      });
      s.on('user_profile_public_updated', function(p){
        var uid = toInt(p && p.user_id); if (!uid) return;
        if (p && typeof p === 'object') cachePublic.set(uid, p);
        applyForUid(uid);
        fetchCosmeticsBulk([uid]);
      });
      s.on('presence_update', function(p){
        var uid = toInt(p && p.user_id); if (!uid) return;
        var cur = cachePublic.get(uid) || {};
        if (p && p.username) cur.username = p.username;
        if (p && p.display_name) cur.display_name = p.display_name;
        if (p && p.avatar_url) cur.avatar_url = p.avatar_url;
        cachePublic.set(uid, cur);
        applyForUid(uid);
      });
      ['friend_request_accepted','friend_removed','dm_cleared_local','new_message','group_user_joined'].forEach(function(ev){
        s.on(ev, function(){ schedule(120, true); });
      });
    } catch(e){}
  }

  // Bootstrap
  window.addEventListener('load', function(){
    try { window.__ncFriendsBootUntil = Math.max(window.__ncFriendsBootUntil || 0, Date.now() + 3500); } catch(e){}
    schedule(900, true);
    bindSocket();
  });
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) schedule(100, true); });
  setInterval(function(){ bindSocket(); schedule(0, false); }, 7000);
  try { window.__ncFriendsBootUntil = Math.max(window.__ncFriendsBootUntil || 0, Date.now() + 3500); } catch(e){}
  schedule(1200, true);
})();
