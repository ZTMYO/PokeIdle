// ===== UI 管理 =====
import { phase, currentEncounter, currentIsShiny, _autoCatching, gameData } from './state.js';
import { formatNum, formatTime, getCurrentRegion } from './state.js';
import { ROAD_SPEED_WALK, ROAD_SPEED_RUN } from './config.js';
import * as road from './road.js';

// DOM 快捷获取
export const $ = id => document.getElementById(id);

// ---------- 视图切换 ----------
export function showView(id) {
  if (id === 'idleView' && phase === 'encounter') {
    id = 'encounterView';
  }
  const views = ['idleView','pokedexView','encounterView','dataView','shopView','settingsView','tutorialView','systemLogView'];
  views.forEach(v => {
    const el = $(v);
    if (el) el.style.display = v === id ? 'flex' : 'none';
  });
  document.querySelectorAll('.control-btn.window-icon[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === id);
  });
  // 回到首页时刷新角色精灵
  if (id === 'idleView') {
    setIdleCharacter('walk');
  }

  if (id !== 'encounterView') {
    hideTextBox();
  } else if (phase === 'encounter' && currentEncounter) {
    const box = $('textBox');
    if (box && !box.classList.contains('show')) {
      box.style.display = 'flex';
      box.style.transform = 'translateY(100%)';
      void box.offsetHeight;
      box.classList.add('show');
      box.style.transform = 'translateY(0)';
    }
    $('fleeBtn').style.display = '';
    // 加载宝可梦图片
    const gif = $('encounterGif');
    if (gif && !gif.getAttribute('src')) {
      const poke = currentEncounter;
      const shinySuffix = currentIsShiny ? '_shiny' : '';
      tryLoadPokemonImage(gif, poke, shinySuffix);
      updateTextBox(currentIsShiny ? '野生的 闪光' + poke.name + ' 跳出来了！' : '野生的 ' + poke.name + ' 跳出来了！', false);
      if (currentIsShiny) {
        tryLoadPokemonImage(gif, poke, shinySuffix).then(() => {
          import('./animation.js').then(m => setTimeout(m.playShinySparkle, 200));
        });
      }
      if (gameData?.settings?.autoCatch && !_autoCatching) {
        import('./battle.js').then(m => setTimeout(m.autoCatch, 600));
      }
    }
  }
  const title = $('appTitle');
  if (id === 'idleView' || id === 'encounterView') {
    title.innerHTML = '宝可梦挂机';
    title.dataset.action = '';
  } else {
    const names = { pokedexView:'图鉴', dataView:'统计', shopView:'商店', settingsView:'设置', tutorialView:'教程', systemLogView:'系统日志' };
    title.innerHTML = `<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);" viewBox="0 0 1024 1024"><use xlink:href="./icons/sprites.svg#icon-back"/></svg> ${names[id]||''}`;
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
export function fitPokemonImage(img) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const maxSize = 100, minSize = 80;
  const longSide = Math.max(nw, nh);
  let displaySize;
  if (longSide <= 40) displaySize = minSize;
  else if (longSide >= 200) displaySize = maxSize;
  else displaySize = minSize + (maxSize - minSize) * ((longSide - 40) / 160);
  const aspect = nw / nh;
  if (aspect >= 1) {
    img.style.width = Math.round(displaySize) + 'px';
    img.style.height = Math.round(displaySize / aspect) + 'px';
  } else {
    img.style.width = Math.round(displaySize * aspect) + 'px';
    img.style.height = Math.round(displaySize) + 'px';
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
