// ===== UI 管理 =====
import { phase, currentEncounter, currentIsShiny, gameData, saveGame, _fishing, _eggHatching } from './state.js';
import { formatNum, getCurrentRegion, getCurrentRoadInfo, anyIncubatorReady, getIncubatorUnlockCost, getMassOutbreak, getRoadNumForEdge } from './state.js';
import { ROAD_SPEED_WALK, ROAD_SPEED_RUN, ROAD_SPEED_BIKE, PX_PER_METER } from './config.js';
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
export function showView(id) {
  if (id === 'idleView' && phase === 'encounter') {
    id = 'encounterView';
  }
  if (id === 'encounterView' && phase === 'idle') {
    id = 'idleView';
  }
  const wasOnGameView = $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none';
  const views = ['idleView','introView','phoneView','pokedexView','encounterView','gpsView','bountyView','dataView','shopView','settingsView','tutorialView','declarationView','systemLogView','incubatorView','mixerView','berryView','rosterView','moveEditView','tradeView','battleView','teamView','trainView'];
  views.forEach(v => {
    const el = $(v);
    if (el) el.style.display = v === id ? 'flex' : 'none';
  });
  // 孵蛋动画结束后的「查看详情」确认页：玩家离开游戏页 → 后台完成流程（回到空闲），
  // 避免 phase 停留在 eggResult 导致孵蛋按钮一直禁用
  if (wasOnGameView && phase === 'eggResult' && !_eggHatching && id !== 'encounterView') {
    import('./battle.js').then(m => {
      m.goIdle();
      renderIncubatorView();
    });
  }
  if (!wasOnGameView && (id === 'idleView' || id === 'encounterView') && phase === 'encounter' && currentEncounter) {
    setTimeout(() => {
      import('./battle.js').then(async m => {
        const loadPromise = m.renderEncounterScene(currentEncounter);
        if (gameData.settings?.autoCatch && !(currentIsShiny && gameData.settings?.shinyStop)) {
          await loadPromise; // 等图片加载完再丢球，避免尺寸错乱
          m.autoCatch();
        } else if (gameData.settings?.autoFlee && !gameData.settings?.autoCatch) {
          m.startAutoFleeTimer();
        }
      });
    }, 0);
  }
  const PHONE_VIEWS = new Set(['phoneView','gpsView','pokedexView','incubatorView','berryView','mixerView','dataView','systemLogView','tutorialView','rosterView','moveEditView','tradeView','battleView','teamView','trainView']);
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

  if (id !== 'encounterView') {
    hideTextBox();
  } else if (phase === 'encounter' && currentEncounter) {
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
    const names = { phoneView:'手机', pokedexView:'图鉴', gpsView:'导航', bountyView:'地区悬赏', dataView:'统计', shopView:'商店', settingsView:'设置', tutorialView:'教程', declarationView:'版权声明', systemLogView:'系统日志', incubatorView:'孵蛋器', mixerView:'混合器', berryView:'树果农场', rosterView:'宝可梦', moveEditView:'配招', tradeView:'交换', battleView:'对战', teamView:'配队', trainView:'训练' };
    title.innerHTML = `<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="./icons/sprites.svg#icon-back"/></svg> ${names[id]||''}`;
    title.dataset.action = 'back';
  }
}

// ---------- 底部文字框 ----------
export function updateTextBox(text, showArrow) {
  if (!isOnGameView()) return;
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
  return $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none';
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
  if (!img.closest('#encounterView')) return;
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
export function renderIncubatorView() {
  const list = $('incubatorList');
  if (!list) return;
  const incubators = gameData.incubators || [];
  if (!incubators.length) return;
  const unlocked = gameData.incubatorUnlockedSlots ?? 0;
  const hatchBtnHtml = (i, disabled) => `<span class="incubator-hatch-text hatched${disabled ? ' disabled' : ''}" data-slot="${i}" ${disabled ? 'style="pointer-events:none;"' : ''}>孵化</span>`;
  const inBattle = phase !== 'idle';
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
    if (s && s.hatched) {
      html += `<div class="incubator-row">
        <div class="incubator-egg-slot has-egg"><img src="./items/mystery-egg.png" alt="蛋" class="shake" /></div>
        <div class="incubator-info"><div class="incubator-name">蛋</div></div>
        ${hatchBtnHtml(i, inBattle)}
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
          <div class="incubator-egg-slot has-egg"><img src="./items/mystery-egg.png" alt="蛋" class="shake" /></div>
          <div class="incubator-info"><div class="incubator-name">蛋</div></div>
          ${hatchBtnHtml(i, inBattle)}
        </div>`;
        continue;
      }
      const pct = Math.min(100, Math.floor(used / s.hatchDuration * 100));const remain = Math.max(0, Math.ceil((s.hatchDuration - used) / PX_PER_METER));
      const distStr = remain >= 1000 ? `${(remain / 1000).toFixed(1)}公里` : `${remain}米`;
      html += `<div class="incubator-row">
        <div class="incubator-egg-slot has-egg"><img src="./items/mystery-egg.png" alt="蛋" /></div>
        <div class="incubator-info">
          <div class="incubator-name">蛋</div>
          <div class="incubator-progress-wrap" data-slot="${i}">
            <div class="incubator-progress-fill" style="width:${pct}%"></div>
            <div class="incubator-progress-text">还需 ${distStr}</div>
          </div>
        </div>
      </div>`;
    } else {
      const canPlace = (gameData.items['mystery-egg'] || 0) > 0;
      html += `<div class="incubator-row">
        <div class="incubator-egg-slot" data-empty="${i}" style="${canPlace ? 'cursor:pointer;' : ''}">${canPlace ? '<span style="font-size:14px;color:var(--ui-color);transform:translateY(-2px);">+</span>' : ''}</div>
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
      import('./items.js').then(m => m.placeEggInIncubator(slot));
    });
  });
  list.querySelectorAll('.incubator-hatch-text[data-unlock]').forEach(el => {
    el.addEventListener('click', () => {
      const slot = parseInt(el.dataset.unlock);
      import('./items.js').then(m => m.unlockIncubatorSlot(slot));
    });
  });
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
