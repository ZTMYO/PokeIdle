// ===== UI 管理 =====
import { phase, currentEncounter, currentIsShiny, gameData, saveGame, _fishing } from './state.js';
import { formatNum, formatTime, getCurrentRegion, anyIncubatorReady, getIncubatorUnlockCost } from './state.js';
import { ROAD_SPEED_WALK, ROAD_SPEED_RUN } from './config.js';
import * as road from './road.js';

// DOM 快捷获取
export const $ = id => document.getElementById(id);

// ---------- 视图切换 ----------
export function showView(id) {
  if (id === 'idleView' && phase === 'encounter') {
    id = 'encounterView';
  }
  const wasOnGameView = $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none';
  const views = ['idleView','phoneView','pokedexView','encounterView','gpsView','dataView','shopView','settingsView','tutorialView','systemLogView','incubatorView'];
  views.forEach(v => {
    const el = $(v);
    if (el) el.style.display = v === id ? 'flex' : 'none';
  });
  // 切换视图时关闭可能残留的目的地弹窗
  $('gpsDialog')?.classList.remove('open');
  // 从非游戏页（图鉴/商店等）切回游戏页时，同步当前遭遇画面
  // （后台自动捕捉可能已推进到新遭遇，需刷新图片/文案/标签）
  if (!wasOnGameView && (id === 'idleView' || id === 'encounterView') && phase === 'encounter' && currentEncounter) {
    setTimeout(() => {
      import('./battle.js').then(async m => {
        const loadPromise = m.renderEncounterScene(currentEncounter);
        // 若自动捕捉开启且未在运行，回到游戏页时重新接管
        if (gameData.settings?.autoCatch && !(currentIsShiny && gameData.settings?.shinyStop)) {
          await loadPromise; // 等图片加载完再丢球，避免尺寸错乱
          m.autoCatch();
        } else if (gameData.settings?.autoFlee && !gameData.settings?.autoCatch) {
          m.startAutoFleeTimer();
        }
      });
    }, 0);
  }
  document.querySelectorAll('.control-btn.window-icon[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === id);
  });
  // 回到首页时刷新角色精灵 + 道路尺寸（钓鱼中恢复钓鱼画面而非走路）
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
      // 遇敌页入场：文字框与主角背影同步慢速升起（文案把主角"顶起"）
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
      // 主角背影从底部随文案一起升起
      if (tc) {
        tc.style.transition = 'none';
        tc.style.bottom = '0';
        void tc.offsetHeight;
        tc.style.transition = 'bottom 0.7s cubic-bezier(0.22, 1, 0.36, 1)';
        tc.style.bottom = '52px';
      }
    }
    $('fleeBtn').style.display = '';
    // 兜底恢复丢球主角背影
    if (tc) tc.style.display = '';
    // 防止 display:none→flex 导致 CSS animation 重播丢球动画
    if (tc) tc.classList.remove('throwing');
  }
  const title = $('appTitle');
  if (id === 'idleView' || id === 'encounterView') {
    title.innerHTML = '口袋挂机';
    title.dataset.action = '';
  } else {
    const names = { phoneView:'手机', pokedexView:'图鉴', gpsView:'导航', dataView:'统计', shopView:'商店', settingsView:'设置', tutorialView:'教程', systemLogView:'系统日志', incubatorView:'孵蛋器' };
    title.innerHTML = `<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="./icons/sprites.svg#icon-back"/></svg> ${names[id]||''}`;
    title.dataset.action = 'back';
  }
}

// ---------- 底部文字框 ----------
// ★ 核心修复：updateTextBox 自带 isOnGameView 保护
// 调用方不再需要手动检查，一处修复处处生效
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
// 是否处于 buff 生效状态（影响跑步动画）
function isBuffActive() {
  // 动态导入避免循环依赖
  const s = document.querySelector('#idleView')?.style?.display;
  return s !== 'none' && (window.__honeyBuffActive__ || window.__charmBuffActive__);
}

export function applyCharSprites() {
  setIdleCharacter('walk');
}

// 各道具对应的精灵图列 x 偏移（sprite sheet: brendan-get-all.png）
const GET_ITEM_X = {
  'poke-ball': 0,    'ultra-ball': -40,   'master-ball': -80,
  'candy': -120,     'shiny-charm': -160,
  'mystery-egg': -200, 'sweet-honey': -240,
};

let _getItemRaf = null;

function startGetItemAnim(el, xOffset) {
  if (_getItemRaf) { cancelAnimationFrame(_getItemRaf); _getItemRaf = null; }
  const frames = 5;
  const frameH = 42;
  const dur = 800;
  const startT = performance.now();
  function frame(now) {
    const t = Math.min((now - startT) / dur, 1);
    const idx = Math.min(Math.floor(t * frames), frames - 1);
    el.style.backgroundPosition = `${xOffset}px ${-idx * frameH}px`;
    if (t < 1) {
      _getItemRaf = requestAnimationFrame(frame);
    }
  }
  _getItemRaf = requestAnimationFrame(frame);
}

export function setIdleCharacter(state, itemKey) {
  const el = $('walkGif');
  if (!el) return;
  // 清除所有类和 get-item 遗留的内联样式
  el.className = 'walk-gif';
  el.style.backgroundImage = '';
  el.style.backgroundSize = '';
  el.style.backgroundPosition = '';
  if (state === 'stop') {
    el.classList.add('brendan-stop');
  } else if (state === 'get-item') {
    el.classList.add('brendan-get-item');
    if (itemKey && GET_ITEM_X[itemKey] !== undefined) {
      // 使用 sprite sheet + JS 动画（每种道具不同列）
      el.style.backgroundImage = 'url("./character/brendan-get-all.png")';
      el.style.backgroundSize = '280px 210px';
      startGetItemAnim(el, GET_ITEM_X[itemKey]);
    }
  } else {
    // walk → 根据 buff 状态决定走还是跑
    if (isBuffActive()) {
      el.classList.add('brendan-run');
      road.setSpeed(ROAD_SPEED_RUN);
    } else {
      el.classList.add('brendan-walk');
      road.setSpeed(ROAD_SPEED_WALK);
    }
  }
}

// ---------- 图片尺寸自适应 ----------
// 舞台尺寸缓存：窗口固定 320×400，屏幕内容区尺寸恒定。
// 首次正常布局后缓存，避免从其他页面切回游戏页的瞬间 layout 未稳定时取到收缩值
let _stageCache = null;
export function getStageSize() {
  if (_stageCache && _stageCache.w >= 280 && _stageCache.h >= 250) return _stageCache;
  const innerRect = $('screenInner')?.getBoundingClientRect();
  let w = innerRect?.width || 0;
  let h = innerRect?.height || 0;
  if (w < 50 || h < 50) {
    // 兜底：.screen 内容区（去掉 3px 边框）
    const screenRect = document.querySelector('.screen')?.getBoundingClientRect();
    w = (screenRect?.width || 0) - 6;
    h = (screenRect?.height || 0) - 6;
  }
  if (w < 50 || h < 50) {
    // 最后兜底：窗口视口
    w = window.innerWidth;
    h = window.innerHeight;
  }
  if (w >= 280 && h >= 250) _stageCache = { w, h };
  return { w, h };
}

export function fitPokemonImage(img) {
  // 默认保持自然尺寸；若高度超出可见范围则等比压缩到刚好到顶
  if (!img || !img.naturalWidth || !img.naturalHeight) return;
  img.style.width = '';
  img.style.height = '';
  img.style.objectFit = '';
  const view = img.closest('#encounterView');
  if (!view || view.clientHeight <= 0) return;
  // 精灵底部锚在屏幕 42% 高度处，可见上限为剩余 58% 高度
  // 用缓存舞台高度而非 view.clientHeight（切回瞬间 view 可能未铺满，导致缩放尺寸错误）
  const { h: stageH } = getStageSize();
  const maxH = stageH * 0.58;
  if (img.naturalHeight > maxH) {
    const scale = maxH / img.naturalHeight;
    img.style.width = Math.floor(img.naturalWidth * scale) + 'px';
    img.style.height = Math.floor(maxH) + 'px';
  }
}

// ---------- 图片加载 ----------
export function tryLoadPokemonImage(img, poke, suffix) {
  const idx = String(poke.index);
  const name = poke.name;
  const primaryExt = poke.image?.endsWith('.png') ? 'png' : 'gif';
  const fallbackExt = primaryExt === 'png' ? 'gif' : 'png';

  function tryLoad(ext) {
    const ip = `./pokemon-data/images/${idx}-${name}${suffix}.${ext}`;
    return new Promise(resolve => {
      const doRaw = () => new Promise(r => {
        img.onload = () => { img.onerror = null; fitPokemonImage(img); r(true); };
        img.onerror = () => r(false);
        img.src = ip;
      });
      const doEncoded = () => new Promise(r => {
        img.onload = () => { img.onerror = null; fitPokemonImage(img); r(true); };
        img.onerror = () => r(false);
        img.src = encodeURI(ip);
      });
      const doFetch = () => fetch(encodeURI(ip)).then(r => {
        if (!r.ok) return false;
        return r.blob().then(blob => {
          const url = URL.createObjectURL(blob);
          return new Promise(r => {
            img.onload = () => { URL.revokeObjectURL(url); fitPokemonImage(img); r(true); };
            img.onerror = () => { URL.revokeObjectURL(url); r(false); };
            img.src = url;
          });
        });
      }).catch(() => false);
      const doTauri = () => {
        if (!window.__TAURI__?.core?.invoke) return Promise.resolve(false);
        const fp = `pokemon-data/images/${idx}-${name}${suffix}.${ext}`;
        return window.__TAURI__.core.invoke('read_gif_base64', { path: fp })
          .then(b64 => new Promise(r => {
            img.onload = () => { fitPokemonImage(img); r(true); };
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
  return tryLoad(primaryExt).then(ok => {
    if (ok) return true;
    return tryLoad(fallbackExt);
  });
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
  $('statTime').textContent = `${getCurrentRegion().name} ${formatTime(gameData.stats.totalPlaySeconds)}`;
  const autoEl = $('statAutoStatus');
  const autoText = $('statAutoText');
  const autoBar = $('statAutoBar');
  if (autoEl && autoText && autoBar) {
    if (gameData.settings?.autoCatch) {
      const balls = gameData.settings?.autoCatchBalls || {};
      const enabled = ['poke-ball','ultra-ball','master-ball'].filter(b => balls[b] !== false);
      const hasStock = enabled.some(b => (gameData.items[b]||0) > 0);
      autoText.textContent = hasStock ? '【自动捕捉中】' : '【自动逃跑中】';
      autoEl.style.display = '';
      autoBar.style.display = 'none';
      if (autoBar.parentElement) autoBar.parentElement.style.display = 'none';
    } else if (gameData.settings?.autoFlee) {
      autoText.textContent = '【佛系模式】';
      autoEl.style.display = '';
      if (phase !== 'encounter') {
        autoBar.style.display = 'none';
        if (autoBar.parentElement) autoBar.parentElement.style.display = 'none';
      }
    } else {
      autoEl.style.display = 'none';
    }
  }
}

// ---------- 孵蛋器红点 ----------
// 红点挂在手机主页的"孵蛋器"应用图标上（入口已迁到手机），有蛋孵化完成时点亮。
// 每次直接设置 display：手机页每次重绘都会重建红点节点，缓存状态会漏刷。
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
  let html = '';
  for (let i = 0; i < Math.min(incubators.length, 8); i++) {
    const s = incubators[i];
    const isUnlocked = i < unlocked;
    const hasEgg = s && s.eggIndex != null;
    if (!isUnlocked && !hasEgg) {
      // 锁定且无蛋 → 解锁按钮：仅下一个待解锁槽位可点击，其余禁用（必须按顺序解锁）
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
        <span class="incubator-hatch-text hatched" data-slot="${i}">孵化</span>
      </div>`;
    } else if (hasEgg) {
      // 孵化中 → 进度条
      const elapsed = Date.now() - s.hatchStart;
      // 兜底：超时、hatchStart 无效（NaN）、hatchDuration 不合法 → 强制标记孵化
      const elapsedValid = !isNaN(elapsed) && elapsed >= 0;
      const shouldBeReady = (!elapsedValid || (elapsed >= s.hatchDuration)) && !s.hatched;
      if (shouldBeReady) {
        s.hatched = true;
        saveGame();
        updateIncubatorBadge();
      }
      if (s.hatched) {
        html += `<div class="incubator-row">
          <div class="incubator-egg-slot has-egg"><img src="./items/mystery-egg.png" alt="蛋" class="shake" /></div>
          <div class="incubator-info"><div class="incubator-name">蛋</div></div>
          <span class="incubator-hatch-text hatched" data-slot="${i}">孵化</span>
        </div>`;
        continue;
      }
      const pct = Math.min(100, Math.floor(elapsed / s.hatchDuration * 100));const remain = Math.max(0, Math.ceil((s.hatchDuration - elapsed) / 1000));
      const h = Math.floor(remain / 3600), m = Math.floor((remain % 3600) / 60), sec = remain % 60;
      const timeStr = h > 0 ? `${h}小时${m}分` : (m > 0 ? `${m}分${sec}秒` : `${sec}秒`);
      html += `<div class="incubator-row">
        <div class="incubator-egg-slot has-egg"><img src="./items/mystery-egg.png" alt="蛋" /></div>
        <div class="incubator-info">
          <div class="incubator-name">蛋</div>
          <div class="incubator-progress-wrap" data-slot="${i}">
            <div class="incubator-progress-fill" style="width:${pct}%"></div>
            <div class="incubator-progress-text">${timeStr}</div>
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

// 孵蛋器倒计时轻量刷新：只更新进度条宽度与剩余时间文本，不重建 DOM。
// 由主循环每 tick 调用（孵蛋器页可见时）。若沿用 renderIncubatorView 每秒整页重建，
// 点击瞬间恰逢重建会丢失 click（mousedown/mouseup 落在新旧两个节点上），表现为"要点两下才有反应"。
export function updateIncubatorTimers() {
  const list = $('incubatorList');
  if (!list) return;
  const incubators = gameData.incubators || [];
  list.querySelectorAll('.incubator-progress-wrap[data-slot]').forEach(wrap => {
    const i = parseInt(wrap.dataset.slot);
    const s = incubators[i];
    if (!s || s.eggIndex == null || s.hatched) return;
    const elapsed = Date.now() - s.hatchStart;
    const elapsedValid = !isNaN(elapsed) && elapsed >= 0;
    const pct = elapsedValid ? Math.min(100, Math.floor(elapsed / s.hatchDuration * 100)) : 0;
    const remain = elapsedValid ? Math.max(0, Math.ceil((s.hatchDuration - elapsed) / 1000)) : Math.ceil(s.hatchDuration / 1000);
    const h = Math.floor(remain / 3600), m = Math.floor((remain % 3600) / 60), sec = remain % 60;
    const timeStr = h > 0 ? `${h}小时${m}分` : (m > 0 ? `${m}分${sec}秒` : `${sec}秒`);
    const fill = wrap.querySelector('.incubator-progress-fill');
    const txt = wrap.querySelector('.incubator-progress-text');
    if (fill) fill.style.width = pct + '%';
    if (txt) txt.textContent = timeStr;
  });
}
