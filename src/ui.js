// ===== UI 管理 =====
import { phase, currentEncounter, currentIsShiny, gameData, saveGame, _fishing, _eggHatching } from './state.js';
import { formatNum, getCurrentRegion, getCurrentRoadInfo, anyIncubatorReady, getIncubatorUnlockCost, getMassOutbreak, getRoadNumForEdge, getPokemonByIndex, isPokemon } from './state.js';
import { ROAD_SPEED_WALK, ROAD_SPEED_RUN, ROAD_SPEED_BIKE, PX_PER_METER } from './config.js';
import { formatLogTime } from './pokedex.js';
import * as road from './road.js';

// DOM 快捷获取
export const $ = id => document.getElementById(id);

// ---------- 切歌提示 ----------
let _npInT = null;
let _npOutT = null;
function setRoll(container, text) {
  if (!container) return;
  let inner = container.firstElementChild;
  if (!inner) { inner = document.createElement('span'); container.appendChild(inner); }
  inner.textContent = text;
  const overflow = inner.scrollWidth > container.clientWidth;
  container.classList.toggle('scrolling', overflow);
  if (overflow) {
    container.style.setProperty('--marquee', (container.clientWidth - inner.scrollWidth) + 'px');
    inner.style.animation = 'none';
    void inner.offsetWidth;
    inner.style.animation = '';
  }
}
export function showNowPlaying(title, artist) {
  const el = $('nowPlaying');
  if (!el) return;
  const idle = $('idleView');
  if (!idle || idle.style.display !== 'flex') return;
  const t = el.querySelector('.now-playing-title');
  const a = el.querySelector('.now-playing-artist');
  clearTimeout(_npInT);
  clearTimeout(_npOutT);
  el.classList.remove('np-in', 'np-out');
  el.style.display = 'flex';
  void el.offsetWidth;
  setRoll(t, title);
  setRoll(a, artist || '');
  void el.offsetWidth; // 重启动画
  el.classList.add('np-in');
  _npInT = setTimeout(() => {
    el.classList.remove('np-in');
    el.classList.add('np-out');
    _npOutT = setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('np-out');
    }, 650);
  }, 2800);
}

// ---------- 视图切换 ----------
// 全部全屏视图 id：显示切换与"记录返回来源"共用同一份列表
const VIEW_IDS = ['idleView','introView','phoneView','pokedexView','encounterView','hatchView','gpsView','bountyView','dataView','achievementView','shopView','settingsView','tutorialView','declarationView','systemLogView','incubatorView','mixerView','berryView','rosterView','moveEditView','tradeView','battleView','teamView','trainView','nurseryView'];

export function showView(id) {
  if (id === 'idleView' && phase === 'encounter') {
    id = 'encounterView';
  }
  if (id === 'encounterView' && phase === 'idle') {
    id = 'idleView';
  }
  // 离开导航页时若仍停在「待选骑行目的地」（点了背包自行车、未选目的地就退出/返回/切换页面）：
  // 放弃待选并恢复进入待选前的导航，保证下次进入导航页是正常状态，不会卡在选择骑行目的地。
  // 选好目的地后 pendingBike 已被 consumePendingBike 清空，不会误恢复。
  if (id !== 'gpsView' && $('gpsView')?.style.display === 'flex' && gameData?.gps?.pendingBike) {
    import('./gps.js').then(m => m.abandonBikeTarget());
  }
  const wasOnGameView = $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none' || $('hatchView')?.style.display !== 'none';
  VIEW_IDS.forEach(v => {
    const el = $(v);
    if (el) el.style.display = v === id ? 'flex' : 'none';
  });
  // 重新进入孵蛋器：重置记录页/选蛋页状态，总是回到主列表
  if (id === 'incubatorView') {
    _incLogOpen = false;
    _eggPickSlot = null;
    _incLogPrevTitle = null;
  }
  // 孵蛋结果确认页离开游戏页时：若期间挂起过野生遭遇则恢复该遭遇，
  // 否则按原流程回到空闲，避免 phase 停留在 eggResult。
  if (wasOnGameView && phase === 'eggResult' && !_eggHatching && id !== 'encounterView') {
    import('./items.js').then(m => m.finalizeEggResultContext());
  }
  if (wasOnGameView && id !== 'idleView' && id !== 'encounterView') {
    import('./battle.js').then(m => {
      m.cancelBgResultReplay();
      // 离开游戏页时若正停在手动捕获的"是否查看详情"确认框（phase='caught'）：
      // 确认框随视图隐藏后无人点击，不清理会导致返回挂机页时道路不移动、不再遇敌
      m.finalizePendingCatch();
    });
  }
  if (!wasOnGameView && (id === 'idleView' || id === 'encounterView')) {
    setTimeout(() => {
      import('./battle.js').then(async m => {
        // 后台结算（遭遇被 NPC 对战打断）结果补播：切回游戏页时重放最终捕捉/逃跑动画
        if (await m.replayBgResult()) return;
        // 后台捕捉仍在进行：切回遭遇画面，后续丢球动画在可见状态下照常播放
        if (await m.resumeBgEncounter()) return;
        if (phase === 'encounter' && currentEncounter) {
          const loadPromise = m.renderEncounterScene(currentEncounter);
          if (gameData.settings?.autoCatch
              && !(currentIsShiny && gameData.settings?.shinyStop)
              && !(m.isLegendEncounter() && gameData.settings?.legendStop)) {
            await loadPromise; // 等图片加载完再丢球，避免尺寸错乱
            m.autoCatch();
          } else if (gameData.settings?.autoFlee && !gameData.settings?.autoCatch) {
            m.startAutoFleeTimer();
          }
        }
      });
    }, 0);
  }
  const PHONE_VIEWS = new Set(['phoneView','gpsView','pokedexView','incubatorView','hatchView','berryView','mixerView','dataView','achievementView','systemLogView','tutorialView','rosterView','moveEditView','tradeView','battleView','teamView','trainView','nurseryView']);
  document.querySelectorAll('.control-btn.window-icon[data-view]').forEach(btn => {
    const on = btn.dataset.view === id || (btn.dataset.view === 'phoneView' && PHONE_VIEWS.has(id));
    btn.classList.toggle('active', on);
  });
  if (id === 'idleView') {
    if (_fishing) {
      import('./fishing.js').then(m => m.applyFishingVisual());
    } else {
      setIdleCharacter('walk');
    }
    road.refreshSize();
  }

  if (id !== 'encounterView' && id !== 'hatchView') {
    hideTextBox();
  } else if (id === 'encounterView' && phase === 'encounter' && currentEncounter) {
    const box = $('textBox');
    const tc = $('animThrowChar');
    if (box && !box.classList.contains('show')) {
      const screen = $('screen');
      if (screen) {
        screen.classList.add('encounter-intro');
        setTimeout(() => screen.classList.remove('encounter-intro'), 750);
      }
      box.style.display = 'flex';
      box.style.transform = 'translateY(100%)';
      void box.offsetHeight;
      box.classList.add('show');
      box.style.transform = 'translateY(0)';
      if (tc) {
        tc.style.transition = 'none';
        tc.style.bottom = '0';
        void tc.offsetHeight;
        tc.style.transition = 'bottom 0.7s cubic-bezier(0.22, 1, 0.36, 1)';
        tc.style.bottom = '52px';
      }
    }
    $('fleeBtn').style.display = '';
    if (tc) tc.style.display = '';
    if (tc) tc.classList.remove('throwing');
  }
  const title = $('appTitle');
  if (id === 'idleView' || id === 'encounterView' || id === 'introView') {
    title.innerHTML = '口袋挂机';
    title.dataset.action = '';
  } else {
    const names = { phoneView:'手机', pokedexView:'图鉴', gpsView:'导航', bountyView:'地区悬赏', dataView:'统计', achievementView:'成就', shopView:'商店', settingsView:'设置', tutorialView:'教程', declarationView:'版权声明', systemLogView:'系统日志', incubatorView:'孵蛋器', hatchView:'孵化', mixerView:'混合器', berryView:'农场', rosterView:'宝可梦', moveEditView:'配招', tradeView:'交换', battleView:'对战', teamView:'配队', trainView:'训练', nurseryView:'饲育屋' };
    title.innerHTML = `<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="./icons/sprites.svg#icon-back"/></svg> ${names[id]||''}`;
    title.dataset.action = 'back';
  }
}

// ---------- 底部文字框 ----------
export function updateTextBox(text, showArrow) {
  // 底部文字框只在游戏页（挂机/遇敌）或孵蛋页显示；孵蛋页文案由孵蛋流程显式调用，
  // 其他页面一律隐藏。遭遇页的文案调用方都用 isOnGameView() 先做判断，不会漏到孵蛋页。
  if (!isOnGameView() && !isOnHatchView()) return;
  const box = $('textBox');
  const content = $('textBoxContent');
  const arrow = $('textBoxArrow');
  if (!box || !content) return;
  content.textContent = text;
  if (arrow) arrow.style.display = showArrow ? 'flex' : 'none';
  if (box.classList.contains('show')) return;
  box.style.display = 'flex';
  requestAnimationFrame(() => {
    box.style.transform = 'translateY(100%)';
    void box.offsetHeight;
    box.classList.add('show');
    box.style.transform = 'translateY(0)';
  });
}

export function hideTextBox() {
  const box = $('textBox');
  if (!box) return;
  box.classList.remove('show');
  box.style.transform = 'translateY(100%)';
  box.style.display = 'none';
  $('textBoxArrow').style.display = 'none';
}

export function isOnGameView() {
  // 仅主界面 / 遇敌页属于"游戏页"：孵蛋页是独立页面，遭遇/丢球文案、动画与视图切换都不得作用其上
  return $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none';
}

// 是否在孵蛋独立页（hatchView）：孵蛋动画/结果文案的可见性判断专用，与游戏页完全隔离
export function isOnHatchView() {
  return $('hatchView')?.style.display !== 'none';
}

// ---------- 角色系统 ----------
// 增益（甜甜蜜/闪耀护符）生效时主角改为跑步
export function isBuffActive() {
  return !!(window.__honeyBuffActive__ || window.__charmBuffActive__);
}

export function applyCharSprites() {
  const prefix = getCharPrefix();
  const backImg = document.querySelector('#animThrowChar .anim-throw-char-img');
  if (backImg) backImg.src = `./character/${prefix}-back.png`;
  const hero = document.querySelector('.splash-hero');
  if (hero) hero.src = `./character/${prefix}-front.png`;
  setIdleCharacter('walk');
}

// 当前角色前缀（按设置里的性别）：'brendan' 或 'may'
export function getCharPrefix() {
  return gameData.settings?.gender === 'may' ? 'may' : 'brendan';
}

const GET_ITEM_Y = {
  'poke-ball': 0,     'ultra-ball': -46,   'master-ball': -92,
  'mystery-egg': -138,      'sweet-honey': -184,
  'shiny-charm': -230, 'candy': -276,
};

let _getItemRaf = null;

function startGetItemAnim(el, yOffset) {
  if (_getItemRaf) { cancelAnimationFrame(_getItemRaf); _getItemRaf = null; }
  const frames = 5;
  const frameW = 64;
  const dur = 800;
  const startT = performance.now();
  function frame(now) {
    const t = Math.min((now - startT) / dur, 1);
    const idx = Math.min(Math.floor(t * frames), frames - 1);
    el.style.backgroundPosition = `${-idx * frameW}px ${yOffset}px`;
    if (t < 1) {
      _getItemRaf = requestAnimationFrame(frame);
    }
  }
  _getItemRaf = requestAnimationFrame(frame);
}

export function setIdleCharacter(state, itemKey) {
  const el = $('walkGif');
  if (!el) return;
  el.className = 'walk-gif';
  el.style.backgroundImage = '';
  el.style.backgroundSize = '';
  el.style.backgroundPosition = '';
  if (state === 'get-item') {
    el.classList.add('get-item');
    if (itemKey && GET_ITEM_Y[itemKey] !== undefined) {
      el.style.backgroundImage = `url("./character/${getCharPrefix()}-get-all.png")`;
      el.style.backgroundSize = '320px 322px';
      startGetItemAnim(el, GET_ITEM_Y[itemKey]);
    }
  } else {
    if (road.isBike()) {
      el.classList.add('bike');
      road.setSpeed(ROAD_SPEED_BIKE);
    } else if (isBuffActive()) {
      el.classList.add('run');
      road.setSpeed(ROAD_SPEED_RUN);
    } else {
      el.classList.add('walk');
      road.setSpeed(ROAD_SPEED_WALK);
    }
    el.classList.add(getCharPrefix());
  }
  if ($('gpsView')?.style.display === 'flex') {
    import('./gps.js').then(m => m.refreshGpsRender());
  }
}

// ---------- 图片尺寸自适应 ----------
let _stageCache = null;
export function getStageSize() {
  if (_stageCache && _stageCache.w >= 280 && _stageCache.h >= 250) return _stageCache;
  const innerRect = $('screenInner')?.getBoundingClientRect();
  let w = innerRect?.width || 0;
  let h = innerRect?.height || 0;
  if (w < 50 || h < 50) {
    const screenRect = document.querySelector('.screen')?.getBoundingClientRect();
    w = (screenRect?.width || 0) - 6;
    h = (screenRect?.height || 0) - 6;
  }
  if (w < 50 || h < 50) {
    w = window.innerWidth;
    h = window.innerHeight;
  }
  if (w >= 280 && h >= 250) _stageCache = { w, h };
  return { w, h };
}

export function fitPokemonImage(img) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return;
  img.style.width = '';
  img.style.height = '';
  img.style.objectFit = '';
  if (!img.closest('#encounterView') && !img.closest('#hatchView')) return;
  const { h: stageH } = getStageSize();
  const maxH = stageH * 0.58;
  if (img.naturalHeight > maxH) {
    const scale = maxH / img.naturalHeight;
    img.style.width = Math.floor(img.naturalWidth * scale) + 'px';
    img.style.height = Math.floor(maxH) + 'px';
  }
}

// ---------- 图片加载 ----------
const _imgCache = new Map();
function _cacheSet(key, val) {
  _imgCache.set(key, val);
  if (_imgCache.size > 800) _imgCache.delete(_imgCache.keys().next().value); // 超限淘汰最早插入的
}
export function tryLoadImage(img, relPath) {
  const hit = _imgCache.get(relPath);
  if (hit) {
    return new Promise(resolve => {
      img.onload = () => { img.onerror = null; resolve(true); };
      img.onerror = () => { _imgCache.delete(relPath); resolve(false); };
      img.src = hit;
      if (img.complete) resolve(true);
    });
  }
  return new Promise(resolve => {
    const ext = (relPath.split('.').pop() || 'png').toLowerCase();
    const doRaw = () => new Promise(r => {
      img.onload = () => { img.onerror = null; _cacheSet(relPath, relPath); r(true); };
      img.onerror = () => r(false);
      img.src = relPath;
    });
    const doEncoded = () => new Promise(r => {
      img.onload = () => { img.onerror = null; _cacheSet(relPath, encodeURI(relPath)); r(true); };
      img.onerror = () => r(false);
      img.src = encodeURI(relPath);
    });
    const doFetch = () => fetch(encodeURI(relPath)).then(r => {
      if (!r.ok) return false;
      return r.blob().then(blob => {
        const url = URL.createObjectURL(blob);
        const prev = _imgCache.get(relPath);
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        _cacheSet(relPath, url);
        return new Promise(r => {
          img.onload = () => r(true);
          img.onerror = () => { URL.revokeObjectURL(url); if (_imgCache.get(relPath) === url) _imgCache.delete(relPath); r(false); };
          img.src = url;
        });
      });
    }).catch(() => false);
    const doTauri = () => {
      if (!window.__TAURI__?.core?.invoke) return Promise.resolve(false);
      const fp = relPath.replace(/^\.\//, '');
      return window.__TAURI__.core.invoke('read_gif_base64', { path: fp })
        .then(b64 => new Promise(r => {
          img.onload = () => { _cacheSet(relPath, `data:image/${ext};base64,${b64}`); r(true); };
          img.onerror = () => r(false);
          img.src = `data:image/${ext};base64,${b64}`;
        }))
        .catch(() => false);
    };
    doRaw().then(ok => ok ? resolve(true) : doEncoded()).then(ok => {
      if (ok) { resolve(true); return; }
      doFetch().then(ok => ok ? resolve(true) : doTauri()).then(resolve).catch(() => resolve(false));
    }).catch(() => resolve(false));
  });
}

export function tryLoadPokemonImage(img, poke, suffix) {
  const idx = String(poke.index);
  const name = poke.name;
  const primaryExt = poke.image?.endsWith('.png') ? 'png' : 'gif';
  const fallbackExt = primaryExt === 'png' ? 'gif' : 'png';
  function tryLoad(ext) {
    const ip = `./pokemon-data/images/${idx}-${name}${suffix}.${ext}`;
    return tryLoadImage(img, ip).then(ok => { if (ok) fitPokemonImage(img); return ok; });
  }
  return tryLoad(primaryExt).then(ok => ok ? true : tryLoad(fallbackExt));
}

// 加载宝可梦头像 icon
export function tryLoadPokemonIcon(img, poke) {
  const idx = String(poke.index);
  const ip = `./pokemon-data/icon/${idx}-${poke.name}.png`;
  return tryLoadImage(img, ip);
}

// ---------- 背包更新 ----------
export function updateBackpack(popItem) {
  for (const [item, qty] of Object.entries(gameData.items)) {
    const el = document.getElementById(`bag-${item}`);
    if (el) {
      const slot = el.closest('.bag-slot');
      // 骑行中自行车槽：半透明（与增益道具激活同款）+ 数量显示「下车」，下车后恢复
      if (item === 'bike' && road.isManualBike()) {
        slot?.classList.add('disabled');
        el.textContent = '下车';
        _prevBagCounts[item] = qty;
        continue;
      }
      // 骑行中增益道具槽：持续置灰（交互拦截在 onBagClick，视觉防误点；骑行中不拾取，数量不变）
      if (road.isManualBike() && (item === 'sweet-honey' || item === 'shiny-charm')) {
        slot?.classList.add('disabled');
        _prevBagCounts[item] = qty;
        continue;
      }
      if (!slot?.classList.contains('disabled')) {
        el.textContent = formatNum(qty);
      }
      const prev = _prevBagCounts[item] ?? qty;
      if (qty > prev) {
        const icon = el.closest('.bag-slot')?.querySelector('.bag-icon');
        if (icon) {
          icon.classList.remove('pop');
          void icon.offsetHeight;
          icon.classList.add('pop');
          setTimeout(() => icon.classList.remove('pop'), 500);
        }
      }
      _prevBagCounts[item] = qty;
    }
  }
  if (popItem) {
    const icon = document.querySelector(`.bag-slot[data-item="${popItem}"] .bag-icon`);
    if (icon) {
      icon.classList.remove('pop');
      void icon.offsetHeight;
      icon.classList.add('pop');
      setTimeout(() => icon.classList.remove('pop'), 500);
    }
  }
}
let _prevBagCounts = {};

// ---------- 状态栏更新 ----------
export function updateStats() {
  const candy = gameData.items['candy'] || 0;
  $('statProgress').innerHTML = `<img src="./items/candy.png" style="width:14px;height:14px;vertical-align:middle;image-rendering:pixelated;" /> ${formatNum(candy)}`;
  const g = gameData?.gps;
  const region = getCurrentRegion();
  const onRoad = !!(g && g.path && g.path.length >= 2 && g.seg < g.path.length - 1 && g.totalPx > 0);
  const road = onRoad ? getCurrentRoadInfo() : null;
  $('statTime').textContent = road
    ? `${road.num}#道路（${road.name}）`
    : region.name;
  const autoEl = $('statAutoStatus');
  const autoText = $('statAutoText');
  const autoBar = $('statAutoBar');
  if (autoEl && autoText && autoBar) {
    const hint = $('statDropHint');
    if (hint && hint.style.display !== 'none' && hint.textContent) {
      // 掉落提示显示期间互斥：整个自动模式状态栏隐藏（含佛系进度条）
      autoEl.style.display = 'none';
    } else if (gameData.settings?.autoCatch) {
      const balls = gameData.settings?.autoCatchBalls || {};
      const enabled = ['poke-ball','ultra-ball','master-ball'].filter(b => balls[b] !== false);
      const hasStock = enabled.some(b => (gameData.items[b]||0) > 0);
      autoText.textContent = hasStock ? '自动捕捉中' : '自动逃跑中';
      autoEl.style.display = '';
      autoBar.style.display = 'none';
      if (autoBar.parentElement) autoBar.parentElement.style.display = 'none';
    } else if (gameData.settings?.autoFlee) {
      autoText.textContent = '佛系模式';
      autoEl.style.display = '';
      if (phase !== 'encounter') {
        autoBar.style.display = 'none';
        if (autoBar.parentElement) autoBar.parentElement.style.display = 'none';
      }
    } else {
      autoText.textContent = '手动模式';
      autoEl.style.display = '';
      autoBar.style.display = 'none';
      if (autoBar.parentElement) autoBar.parentElement.style.display = 'none';
    }
  }
}

// ---------- 孵蛋器红点 ----------
export function updateIncubatorBadge() {
  const badge = $('phone-badge-incubator');
  if (badge) badge.style.display = anyIncubatorReady() ? '' : 'none';
}

// ---------- 孵蛋器视图渲染 ----------
// 空槽点加号弹出选择菜单（神秘蛋 / 宝可梦蛋），无需顶部页签
let _eggPickSlot = null; // 菜单选「宝可梦蛋」后正在选蛋的槽位下标；null = 未在选蛋
let _incLogOpen = false; // 孵蛋记录页是否打开（点顶部"孵蛋记录"进入，返回后关闭）
let _incLogPrevTitle = null; // 打开记录页前的标题栏内容（关闭时还原）

// 孵蛋记录页是否打开（main.js 标题返回时判断：开 → 只关记录页，不走正常返回）
export function isIncubatorLogOpen() { return _incLogOpen; }
// 关闭记录页并还原标题栏，回主列表
export function closeIncubatorLog() {
  _incLogOpen = false;
  const t = $('appTitle');
  if (t && _incLogPrevTitle != null) {
    t.innerHTML = _incLogPrevTitle;
    _incLogPrevTitle = null;
  }
  renderIncubatorView();
}

// 槽位内蛋的 hover 提示名：宝可梦蛋显示「XX的蛋」，神秘蛋显示「神秘蛋」；
// 槽位列表统一显示「蛋」，hover 时经 data-tip 弹出具体名称
function slotEggName(s) {
  if (s && s.eggRef) {
    const eggEntry = (gameData.roster || []).find(r => r.id === s.eggRef);
    if (eggEntry) {
      const poke = getPokemonByIndex(String(eggEntry.species));
      return (poke ? poke.name : `#${eggEntry.species}`) + '的蛋';
    }
  }
  return '神秘蛋';
}

// 六维个体值斜杠串：31/31/31/31/31/31（HP/攻击/防御/特攻/特防/速度，与繁殖页面一致；
// 蛋条目在生成时已 roll 好个体值，是孵蛋前唯一已知的信息）
function eggIvSlash(p) {
  if (!p || !p.ivs) return '0/0/0/0/0/0';
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => p.ivs[k] || 0).join('/');
}

// 宝可梦蛋页签：从仓库蛋条目（kind:'egg'）选一枚放入空槽，单列列表
function renderEggPickList(list, slotIndex) {
  const inUse = new Set((gameData.incubators || []).map(s => s && s.eggRef).filter(Boolean));
  const eggs = (gameData.roster || [])
    .filter(p => p.inRoster && !isPokemon(p) && !inUse.has(p.id));
  list.style.gridTemplateColumns = '1fr';
  list.innerHTML = `
    <div class="incubator-egg-list">
      <div class="incubator-egg-list-head">
        <span class="incubator-egg-back" data-egg-back>‹ 返回</span>
        <span class="incubator-egg-list-title">选择放入的蛋</span>
      </div>
      ${eggs.length === 0
        ? '<div class="incubator-egg-empty">没有可放入的蛋<br>饲育屋收取的蛋会出现在这里</div>'
        : eggs.map(eg => {
            const poke = getPokemonByIndex(String(eg.species));
            const name = poke ? poke.name : `#${eg.species}`;
            return `
            <div class="incubator-egg-item" data-egg-pick="${eg.id}">
              <span class="incubator-egg-icon"><img src="./items/mystery-egg.png" alt="蛋" /></span>
              <span class="incubator-egg-name">${name}的蛋${eg.shiny ? ' ★' : ''}</span>
              <span class="incubator-egg-iv">${eggIvSlash(eg)}</span>
            </div>`;
          }).join('')}
    </div>`;
  list.querySelector('[data-egg-back]')?.addEventListener('click', () => {
    _eggPickSlot = null;
    renderIncubatorView();
  });
  // 点击列表项整行即放入该蛋
  list.querySelectorAll('[data-egg-pick]').forEach(item => {
    item.addEventListener('click', () => {
      const sid = _eggPickSlot;
      const eid = item.dataset.eggPick;
      _eggPickSlot = null; // 先退出选蛋态（放蛋成功与否都回槽位视图）
      import('./items.js').then(m => m.placePokemonEggInIncubator(sid, eid));
    });
  });
}

// 孵蛋记录页：单列日志列表，每条仅显示时间 / 名字 / 性别（最多 50 条）
function renderIncubatorLogList(list) {
  const logs = (gameData.incubatorLogs || [])
    .filter(l => l && l.species != null) // 兼容旧存档残留的旧格式记录
    .slice()
    .reverse();
  const genderText = g => g === 'female' ? '♀' : g === 'male' ? '♂' : '无性别';
  list.style.gridTemplateColumns = '1fr';
  list.innerHTML = `
    <div class="incubator-egg-list">
      <div class="incubator-egg-list-head">
        <span class="incubator-egg-list-title">孵蛋记录</span>
      </div>
      ${logs.length === 0
        ? '<div class="incubator-egg-empty">暂无孵蛋记录<br>孵化宝可梦后会记录在这里</div>'
        : logs.map(l => {
            const poke = getPokemonByIndex(String(l.species));
            const name = poke ? poke.name : `#${l.species}`;
            return `
            <div class="incubator-log-item">
              <span class="incubator-log-time">${formatLogTime(l.time)}</span>
              <span class="incubator-log-name">${name}</span>
              <span class="incubator-log-gender">${genderText(l.gender)}</span>
            </div>`;
          }).join('')}
    </div>`;
}

export function renderIncubatorView() {
  const list = $('incubatorList');
  if (!list) return;
  const incubators = gameData.incubators || [];
  if (!incubators.length) return;
  const unlocked = gameData.incubatorUnlockedSlots ?? 0;

  // 顶部"孵蛋记录"按钮行：仅主列表显示；选蛋/记录页是独立子页，整个头部行隐藏
  const incHead = $('incubatorHead');
  if (incHead) incHead.style.display = (_eggPickSlot != null || _incLogOpen) ? 'none' : '';
  const logBtn = $('incubatorLogBtn');
  if (logBtn) logBtn.onclick = () => { _incLogOpen = true; renderIncubatorView(); };

  // 孵蛋记录页：替换标题栏为「孵蛋记录」（点击 appTitle 返回主列表），并渲染单列日志列表
  if (_incLogOpen) {
    const t = $('appTitle');
    if (t && _incLogPrevTitle == null) {
      _incLogPrevTitle = t.innerHTML;
      t.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="./icons/sprites.svg#icon-back"/></svg> 孵蛋记录';
      t.dataset.action = 'back';
    }
    renderIncubatorLogList(list);
    return;
  }

  // 正在选蛋：显示蛋列表（单列）
  if (_eggPickSlot != null) {
    renderEggPickList(list, _eggPickSlot);
    return;
  }
  list.style.gridTemplateColumns = '1fr 1fr';

  const hatchBtnHtml = (i, disabled) => `<span class="incubator-hatch-text hatched${disabled ? ' disabled' : ''}" data-slot="${i}" ${disabled ? 'style="pointer-events:none;"' : ''}>孵化</span>`;
  // 野生遭遇期间允许保留孵蛋入口：点击时优先切回遭遇画面处理；
  // 仅在 NPC 对战 / 孵蛋动画自身进行中时真正禁用，避免复用 encounterView 互相覆盖。
  const hatchLocked = phase === 'battle' || phase === 'eggResult' || _eggHatching;
  let html = '';
  for (let i = 0; i < Math.min(incubators.length, 8); i++) {
    const s = incubators[i];
    const isUnlocked = i < unlocked;
    const hasEgg = s && s.eggIndex != null;
    if (!isUnlocked && !hasEgg) {
      const cost = getIncubatorUnlockCost(i);
      const isNext = i === unlocked;
      const canAfford = (gameData.items['candy'] || 0) >= cost;
      const disabled = !isNext || !canAfford;
      html += `<div class="incubator-row locked">
        <div class="incubator-lock-icon"><img src="./items/candy.png" style="width:18px;height:18px;image-rendering:pixelated;opacity:0.5;" /><span class="incubator-lock-cost">×${cost}</span></div>
        <span class="incubator-hatch-text${disabled ? ' disabled' : ''}" data-unlock="${i}" ${disabled ? 'style="pointer-events:none;"' : ''}>解锁</span>
      </div>`;
      continue;
    }
    const eggName = slotEggName(s);
    if (s && s.hatched) {
      html += `<div class="incubator-row">
        <div class="incubator-egg-slot has-egg" data-tip="${eggName}"><img src="./items/mystery-egg.png" alt="蛋" class="shake" /></div>
        <div class="incubator-info"><div class="incubator-name" data-tip="${eggName}">蛋</div></div>
        ${hatchBtnHtml(i, hatchLocked)}
      </div>`;
    } else if (hasEgg) {
      const used = (gameData.stats?.walkDistance || 0) - s.hatchStart;
      const usedValid = !isNaN(used) && used >= 0;
      const shouldBeReady = (!usedValid || (used >= s.hatchDuration)) && !s.hatched;
      if (shouldBeReady) {
        s.hatched = true;
        saveGame();
        updateIncubatorBadge();
      }
      if (s.hatched) {
        html += `<div class="incubator-row">
          <div class="incubator-egg-slot has-egg" data-tip="${eggName}"><img src="./items/mystery-egg.png" alt="蛋" class="shake" /></div>
          <div class="incubator-info"><div class="incubator-name" data-tip="${eggName}">蛋</div></div>
          ${hatchBtnHtml(i, hatchLocked)}
        </div>`;
        continue;
      }
      const pct = Math.min(100, Math.floor(used / s.hatchDuration * 100));const remain = Math.max(0, Math.ceil((s.hatchDuration - used) / PX_PER_METER));
      const distStr = remain >= 1000 ? `${(remain / 1000).toFixed(1)}公里` : `${remain}米`;
      html += `<div class="incubator-row">
        <div class="incubator-egg-slot has-egg" data-tip="${eggName}"><img src="./items/mystery-egg.png" alt="蛋" /></div>
        <div class="incubator-info">
          <div class="incubator-name" data-tip="${eggName}">蛋</div>
          <div class="incubator-progress-wrap" data-slot="${i}">
            <div class="incubator-progress-fill" style="width:${pct}%"></div>
            <div class="incubator-progress-text">还需 ${distStr}</div>
          </div>
        </div>
      </div>`;
    } else {
      const plus = '<span style="font-size:14px;color:var(--ui-color);transform:translateY(-2px);">+</span>';
      // 空槽：点 + 弹出「神秘蛋 / 宝可梦蛋」选择菜单
      html += `<div class="incubator-row">
        <div class="incubator-egg-slot" data-empty="${i}" style="cursor:pointer;">${plus}</div>
        <div class="incubator-info"><div class="incubator-name">空孵蛋器</div></div>
      </div>`;
    }
  }
  list.innerHTML = html;
  list.querySelectorAll('.incubator-hatch-text.hatched').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = parseInt(btn.dataset.slot);
      import('./items.js').then(m => m.hatchFromIncubator(slot));
    });
  });
  list.querySelectorAll('.incubator-egg-slot[data-empty]').forEach(el => {
    el.addEventListener('click', () => {
      const slot = parseInt(el.dataset.empty);
      showIncubatorPickMenu(slot, el);
    });
  });
  list.querySelectorAll('.incubator-hatch-text[data-unlock]').forEach(el => {
    el.addEventListener('click', () => {
      const slot = parseInt(el.dataset.unlock);
      import('./items.js').then(m => m.unlockIncubatorSlot(slot));
    });
  });
}

// 空槽加号选择菜单：两个选项（神秘蛋 / 宝可梦蛋），样式复用商店批量菜单；
// 库存为 0 的选项置灰禁用；点击外部任意位置关闭
function showIncubatorPickMenu(slot, anchorEl) {
  hideIncubatorPickMenu();
  const mysteryCount = gameData.items['mystery-egg'] || 0;
  const inUse = new Set((gameData.incubators || []).map(s => s && s.eggRef).filter(Boolean));
  const pokemonCount = (gameData.roster || [])
    .filter(p => p.inRoster && !isPokemon(p) && !inUse.has(p.id)).length;
  // 特判：没有宝可梦蛋但有神秘蛋时，点击加号直接放入神秘蛋（不弹选择菜单）
  if (pokemonCount === 0 && mysteryCount > 0) {
    import('./items.js').then(m => m.placeEggInIncubator(slot));
    return;
  }
  let menu = $('incubatorPickMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'incubatorPickMenu';
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = `
    <div class="shop-ctx-item${mysteryCount > 0 ? '' : ' disabled'}" data-pick="mystery">
      <span class="shop-ctx-qty">神秘蛋</span>
    </div>
    <div class="shop-ctx-item${pokemonCount > 0 ? '' : ' disabled'}" data-pick="pokemon">
      <span class="shop-ctx-qty">宝可梦蛋</span>
    </div>`;
  // 定位到加号正下方（越界自动翻转）
  const rect = anchorEl.getBoundingClientRect();
  menu.style.display = '';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const x = Math.max(0, Math.min(rect.left + rect.width / 2 - 24, window.innerWidth - mw - 4));
  const y = Math.max(0, Math.min(rect.bottom + 2, window.innerHeight - mh - 4));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.onclick = (e) => {
    const opt = e.target.closest('.shop-ctx-item');
    if (!opt || opt.classList.contains('disabled')) return;
    hideIncubatorPickMenu();
    if (opt.dataset.pick === 'mystery') {
      import('./items.js').then(m => m.placeEggInIncubator(slot));
    } else {
      _eggPickSlot = slot;
      renderIncubatorView();
    }
  };
  document.addEventListener('pointerdown', hideIncubatorPickMenu);
}

function hideIncubatorPickMenu() {
  const menu = $('incubatorPickMenu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('pointerdown', hideIncubatorPickMenu);
}

export function updateIncubatorTimers() {
  const list = $('incubatorList');
  if (!list) return;
  const incubators = gameData.incubators || [];
  let changed = false;
  list.querySelectorAll('.incubator-progress-wrap[data-slot]').forEach(wrap => {
    const i = parseInt(wrap.dataset.slot);
    const s = incubators[i];
    if (!s || s.eggIndex == null) return;
    if (s.hatched) { changed = true; return; }
    const used = (gameData.stats?.walkDistance || 0) - s.hatchStart;
    const usedValid = !isNaN(used) && used >= 0;
    if (!usedValid || (used + 100) >= s.hatchDuration) {
      s.hatched = true;
      saveGame();
      changed = true;
      return;
    }
    const pct = usedValid ? Math.min(100, Math.floor(used / s.hatchDuration * 100)) : 0;
    const remain = usedValid ? Math.max(0, Math.ceil((s.hatchDuration - used) / PX_PER_METER)) : Math.ceil(s.hatchDuration / PX_PER_METER);
    const distStr = remain >= 1000 ? `${(remain / 1000).toFixed(1)}公里` : `${remain}米`;
    const fill = wrap.querySelector('.incubator-progress-fill');
    const txt = wrap.querySelector('.incubator-progress-text');
    if (fill) fill.style.width = pct + '%';
    if (txt) txt.textContent = `还需 ${distStr}`;
  });
  if (changed) {
    updateIncubatorBadge();
    renderIncubatorView();
  }
}

// ---------- 游戏内自制 tooltip（跟随鼠标，自动越界翻转）----------
let _foodTipEl = null;
let _foodTipInit = false;

function getFoodTipEl() {
  if (!_foodTipEl) {
    _foodTipEl = document.createElement('div');
    _foodTipEl.className = 'food-tooltip';
    _foodTipEl.style.display = 'none';
    document.body.appendChild(_foodTipEl);
  }
  return _foodTipEl;
}

export function hideFoodTip() {
  if (_foodTipEl) _foodTipEl.style.display = 'none';
}

export function showFoodTip(text, x, y) {
  const tip = getFoodTipEl();
  tip.textContent = text;
  // 多行文案（含 \n）时按行折行，单行文案保持 nowrap（如树果 tooltip）
  tip.style.whiteSpace = text.includes('\n') ? 'pre-line' : '';
  tip.style.display = '';
  // 定位：优先右下方，越界时翻转到左/上方
  const pad = 10;
  let left = x + 12;
  let top = y + 14;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  if (left + tw > window.innerWidth - pad) left = x - tw - 12;
  if (top + th > window.innerHeight - pad) top = y - th - 10;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

// 命中可弹自定义 tooltip 的元素并取文案；不支持的元素返回 null
// 支持：树果图标（.berry-icon 的 dataset.tip）、大量出没地图标记（.gps-mass-marker，显示 宝可梦在 x#道路 大量出没 · 剩余时间/只数）、战斗状态圆点（.b-status-dot 的 dataset.tip）、战斗血条（.b-hp 的 dataset.tip）
function tooltipTextFor(target) {
  const icon = target && target.closest ? target.closest('.berry-icon') : null;
  if (icon) return icon.dataset.tip || '';
  const stDot = target && target.closest ? target.closest('.b-status-dot') : null;
  if (stDot) return stDot.dataset.tip || '';
  const hpBar = target && target.closest ? target.closest('.b-hp') : null;
  if (hpBar) return hpBar.dataset.tip || '';
  const catWrap = target && target.closest ? target.closest('.move-cat-icon') : null;
  if (catWrap) {
    // hover 目标是类别图标图片本身（data-tip 在 img 上）
    const catImg = catWrap.tagName === 'IMG' ? catWrap : catWrap.querySelector('img');
    return (catImg && catImg.dataset.tip) || catWrap.dataset.tip || '';
  }
  const mass = target && target.closest ? target.closest('.gps-mass-marker') : null;
  if (mass) {
    const mo = getMassOutbreak();
    const name = mass.dataset.name || '宝可梦';
    const remain = mass.dataset.remain != null ? mass.dataset.remain : '?';
    if (!mo) return `${name}（剩余 ${remain} 只）`;
    const num = getRoadNumForEdge(mo.edge, mo.t);
    const roadStr = num != null ? `${num}#道路` : '某道路';
    const sec = Math.max(0, Math.ceil((mo.expiresAt - Date.now()) / 1000));
    const timeStr = `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
    return `${name} ${remain} 只\n剩余${timeStr}`;
  }
  // 通用 data-tip：任意带 data-tip 的元素（如饲育屋放入列表的个体值单元格、场地亲本）
  const tipEl = target && target.closest ? target.closest('[data-tip]') : null;
  if (tipEl) return tipEl.dataset.tip || '';
  return null;
}

export function setupFoodTooltip() {
  if (_foodTipInit) return;
  _foodTipInit = true;

  // 事件委托：任何支持的元素悬停都走这里（图鉴日志列表、地图大量出没标记重建后依然生效）
  document.addEventListener('mouseover', (e) => {
    const text = tooltipTextFor(e.target);
    if (!text) { hideFoodTip(); return; }
    showFoodTip(text, e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (_foodTipEl && _foodTipEl.style.display !== 'none' && tooltipTextFor(e.target)) {
      // 重新取文案：大量出没剩余时间随鼠标移动实时刷新
      showFoodTip(tooltipTextFor(e.target), e.clientX, e.clientY);
    }
  });
  document.addEventListener('mouseout', (e) => {
    if (!tooltipTextFor(e.target)) hideFoodTip();
  });
  // 滚出/切页时隐藏
  document.addEventListener('scroll', hideFoodTip, true);
}
