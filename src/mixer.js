// ===== 树果混合器 =====
// 从农场库存选树果（1~RECIPE_MAX 颗）作配方，确认后制成树果方块：按配方颜色混合着色，
// 优先吸引当前地区与配方一致的宝可梦，被吃掉或再走满 BLOCK_DISTANCE 米后结束。
import { $, showView, tryLoadImage } from './ui.js';
import { phase, gameData, blockBuffActive, blockRecipe, blockStartWalk, blockQuality, qteState, setBlockBuffActive, setBlockRecipe, setBlockStartWalk, setBlockQuality, setQteState, saveSessionState, setIdleMsgIdx, setPrevView, addSystemLog, saveGame, randInt } from './state.js';
import { BERRY_ICONS, BERRY_NAMES, BERRY_COLORS, findBerryTarget } from './items.js';
import { BLOCK_DISTANCE, PX_PER_METER, BLOCK_QUALITY } from './config.js';
import { playObtained } from './audio.js';

// 制作一个树果方块最多消耗的树果颗数（每种 1 颗）
const RECIPE_MAX = 4;
let _recipe = [];       // 已选树果下标（去重）
let _lastRecipe = [];   // 最近成功制作的配方（决定颜色与吸引目标）
let _pickOpen = false;  // 是否处于选择树果状态
let _blockCoolInterval = null; // 剩余里程轮询（500ms）
let _demoActive = false;   // 首页演示动画是否运行中
let _demoRaf = 0;          // 首页演示动画 rAF 句柄
let _demoTimer = 0;        // 首页演示动画批次间隔句柄
let _cubeBase = null;      // 白色结构图原始位图（blob 缓存）

// ---------- 混合小游戏（QTE 转盘） ----------
// 转盘内指针旋转，玩家在指针扫过顶部色带中央时按下按钮，按落点判定单轮得分；
// 共 5 轮、速度渐快；五轮总分换算五档品质，品质决定命中目标宝可梦的概率。
const TAU = Math.PI * 2;
const QTE_ROUNDS = 5;
const QTE_CANVAS = 180;                 // 转盘画布 CSS 尺寸（px）
const QTE_APPROACH = 0.9;               // 每轮外指针靠近 + 内指针启动时长（秒）
const QTE_ACCEL = 0.6;                  // 内指针加速到全速时长（秒）
const QTE_WINDOW = 4.2;                 // 可点击窗口（秒），超时记 miss
const QTE_JUDGE_PAUSE = 0.8;            // 判定展示时长（秒）
const QTE_SPEEDS = [120, 180, 260, 350, 450]; // 每轮内指针角速度（度/秒），渐快
const QTE_GRADE_COLOR = { perfect: '#c54444', good: '#e3b540', poor: '#4c8d73' }; // 精准度色：进度环 + 内圈色带共用
let _qteActive = false;    // 小游戏进行中
let _qteRaf = 0;           // 小游戏 rAF 句柄
let _qteRound = 0;         // 当前轮次 0~4
let _qteScore = [];        // 每轮判定等级
let _qteQuality = 'good';  // 最终品质
let _qtePhase = 'idle';    // approach / active / judge
let _qteStart = 0;         // 当前阶段起点时间戳
let _qteAngle = 0;         // 内指针当前角度（度）
let _qteBaseAngle = 0;     // active 阶段起始角度（度）
let _qteSpeed = 0;         // 当前轮内指针角速度

// ---------- 页面入口 ----------
export function showMixerView() {
  // 从手机主页进入时，返回应回到手机主页
  setPrevView($('phoneView')?.style.display !== 'none' ? 'phoneView' : (phase === 'encounter' || phase === 'caught') ? 'encounterView' : 'idleView');
  showView('mixerView');
  render();
}

// ---------- 渲染 ----------
function render() {
  const el = $('mixerContent');
  if (!el) return;
  if (!_qteActive && qteState) {
    if (qteState.phase === 'result') {
      // 重连恢复：回到混合结果/领取页（未领取前不清状态）
      _lastRecipe = Array.isArray(qteState.recipe) ? qteState.recipe : [];
      _qteQuality = qteState.quality || 'good';
      showResult();
      return;
    }
    restoreQte(); // 重连恢复 QTE 进度
  }
  if (_qteActive) {
    // 小游戏进行中：重建页面继续
    el.innerHTML = qteHtml();
    bindQte();
    startQteLoop();
  } else if (blockBuffActive) {
    stopIdleDemo();
    _pickOpen = false;
    el.innerHTML = cooldownHtml();
    syncCoolTimer();
    loadBerryImgs(el);
    tintBlockVisual();
    $('mixerCancelBtn')?.addEventListener('click', cancelBlock);
  } else {
    el.innerHTML = idleHtml();
    if (_pickOpen) {
      stopIdleDemo(); // 选择界面隐藏装饰动画
      el.querySelectorAll('img[data-src]').forEach(im => tryLoadImage(im, im.dataset.src));
      el.querySelectorAll('.mixer-pick-item:not(.no-stock)').forEach(item => {
        item.addEventListener('click', () => togglePick(item));
      });
      refreshPick();
    } else {
      startIdleDemo();
    }
    $('mixerStartBtn')?.addEventListener('click', onStartBtn);
    $('mixerCancelPickBtn')?.addEventListener('click', cancelPick);
  }
}

// 首页：装饰动画 + 选择态（树果网格 + 开始混合）
function idleHtml() {
  if (!_pickOpen) {
    return `
      <div class="mixer-wrap">
        <div class="mixer-page-title">树果混合器</div>
        <div class="mixer-info">
          <div class="mixer-demo" id="mixerDemo"></div>
        </div>
        <button class="bottom-dock" id="mixerStartBtn">选择树果</button>
      </div>`;
  }
  const stock = gameData?.berryFarm?.stock || {};
  return `
    <div class="mixer-wrap">
      <div class="mixer-page-title">选择树果</div>
      <div class="board-stock">
        ${BERRY_ICONS.map((name, i) => {
          const have = stock[i] || 0; // 库存键为树果下标（与农场一致）
          return `
            <div class="board-stock-item mixer-pick-item${have > 0 ? '' : ' no-stock'}" data-berry="${i}">
              <img class="berry-icon" data-src="./items/berries/${name}" data-tip="${BERRY_NAMES[name] || ''}" alt="" />
              <span class="board-stock-count">×${have}</span>
            </div>`;
        }).join('')}
      </div>
      <div class="mixer-pick-chosen" id="mixerPickChosen"></div>
      <div class="mixer-result-actions show">
        <button class="mixer-action-claim" id="mixerStartBtn">开始混合</button>
        <button class="mixer-action-giveup" id="mixerCancelPickBtn">取消</button>
      </div>
    </div>`;
}

// 底部按钮：未选择时进入选择态；选择态点击即制作
function onStartBtn() {
  if (_pickOpen) {
    confirmPick();
  } else {
    _recipe = [];
    _pickOpen = true;
    render();
  }
}


function cancelPick() {
  _recipe = [];
  _pickOpen = false;
  render();
}

function togglePick(item) {
  const idx = Number(item.dataset.berry);
  const pos = _recipe.indexOf(idx);
  if (pos >= 0) {
    _recipe.splice(pos, 1); // 已选则取消
  } else {
    if (_recipe.length >= RECIPE_MAX) return; // 超过上限不再可选
    _recipe.push(idx);
  }
  refreshPick();
}

// 同步选中态与下方已选图标行
function refreshPick() {
  const host = $('mixerContent');
  if (!host) return;
  const stock = gameData?.berryFarm?.stock || {};
  host.querySelectorAll('.mixer-pick-item').forEach(item => {
    const idx = Number(item.dataset.berry);
    const selected = _recipe.includes(idx);
    item.classList.toggle('selected', selected);
    const countEl = item.querySelector('.board-stock-count');
    if (countEl) countEl.textContent = '×' + Math.max(0, (stock[idx] || 0) - (selected ? 1 : 0));
  });
  const chosen = $('mixerPickChosen');
  if (chosen) {
    chosen.innerHTML = _recipe.map(i =>
      `<img data-src="./items/berries/${BERRY_ICONS[i]}" data-tip="${BERRY_NAMES[BERRY_ICONS[i]] || ''}" alt="" />`
    ).join('');
    chosen.querySelectorAll('img[data-src]').forEach(im => tryLoadImage(im, im.dataset.src));
  }
}

// 确认制作
function confirmPick() {
  if (_recipe.length === 0) return;
  _pickOpen = false;
  makeBlock();
}

// 校验库存并消耗树果，产出方块
function makeBlock() {
  if (blockBuffActive) return;
  if (_recipe.length === 0) return;
  const f = gameData?.berryFarm;
  if (!f || !f.stock) return;
  // 库存校验（UI 已限制，此处兜底）
  for (const i of _recipe) {
    if (!(f.stock[i] > 0)) return;
  }
  // 按颗消耗库存
  for (const i of _recipe) {
    f.stock[i] -= 1;
    if (f.stock[i] <= 0) delete f.stock[i];
  }
  _lastRecipe = [...new Set(_recipe)];
  _recipe = [];
  addSystemLog('mixer', { action: 'make', recipe: [..._lastRecipe] });
  saveGame();
  startQte(); // 树果已扣，进入小游戏
}

// ---------- 首页演示动画 ----------
// 树果从三边飞入 cube 中心渐隐，循环演示；纯装饰。
function startIdleDemo() {
  stopIdleDemo();
  const demo = $('mixerDemo');
  if (!demo) return;
  // cube 底座：canvas 1:1 绘制原图，避免缩放坏点
  const cube = document.createElement('canvas');
  cube.className = 'mixer-demo-cube';
  demo.appendChild(cube);
  loadCubeBaseImage()
    .then(() => {
      if (!cube.isConnected) return;
      cube.width = _cubeBase.naturalWidth;
      cube.height = _cubeBase.naturalHeight;
      tintCanvasTo(cube, '#FFFFFF');
    })
    .catch(() => {});

  let stopped = false;
  _demoActive = true;

  function spawnBatch() {
    if (stopped || !_demoActive) return;
    // 页面切走时停止
    if ($('mixerView')?.style.display === 'none') { stopIdleDemo(); return; }
    const n = 2 + randInt(0, 2); // 每批随机 2~4 颗
    const pool = BERRY_ICONS.map((_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) { // 洗牌取前 n，同批不重复
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const indices = pool.slice(0, n);
    flyBerriesBatch(demo, cube, indices, () => {
      tintCubeTo(cube, computeBlockColor(indices)); // 方块染成该批混合色
      _demoTimer = setTimeout(spawnBatch, 800 + Math.random() * 500);
    });
  }
  spawnBatch();
}

// 一批树果从屏幕外飞入 cube 中心，全部到达后回调
function flyBerriesBatch(demo, cube, indices, onDone) {
  // 以屏幕容器为参照，从屏幕边缘外飞入
  const host = demo.closest('.screen') || demo;
  const rect = host.getBoundingClientRect();
  const W = Math.max(rect.width, 120);
  const H = Math.max(rect.height, 120);
  const cubeRect = cube.getBoundingClientRect();
  const berryHalf = 22; // 偏移半尺寸对齐中心
  const cx = (cubeRect.left - rect.left) + cubeRect.width / 2 - berryHalf;
  const cy = (cubeRect.top - rect.top) + cubeRect.height / 2 - berryHalf;
  const dur = 1500 + Math.random() * 500;
  const berries = [];
  const MIN_GAP = 70;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const el = document.createElement('div');
    el.className = 'mixer-demo-berry';
    const img = document.createElement('img');
    el.appendChild(img);
    host.appendChild(el);
    tryLoadImage(img, `./items/berries/${BERRY_ICONS[idx]}`);
    let sx, sy, tries = 0;
    do { // 重试保持起点间距，上限后接受
      const edge = randInt(0, 2); // 上/左/右三边
      if (edge === 0)      { sx = 8 + Math.random() * (W - 56); sy = -70 - Math.random() * 30; }
      else if (edge === 1) { sx = -70 - Math.random() * 30; sy = 8 + Math.random() * (H - 56); }
      else                 { sx = W + 70 + Math.random() * 30; sy = 8 + Math.random() * (H - 56); }
      tries++;
    } while (tries < 12 && berries.some(b => Math.hypot(b.sx - sx, b.sy - sy) < MIN_GAP));
    berries.push({ el, sx, sy, tx: cx, ty: cy, dur });
  }
  const start = performance.now();
  function frame(now) {
    // 树果挂在共享的 .screen 容器上，离开页面必须清理防止残留
    if ($('mixerView')?.style.display === 'none') {
      berries.forEach(b => b.el.remove());
      return;
    }
    let allDone = true;
    for (const b of berries) {
      const t = Math.min((now - start) / b.dur, 1);
      if (t >= 1) { b.el.style.opacity = '0'; continue; } // 到达即消失
      allDone = false;
      const e = 1 - (1 - t) * (1 - t); // easeOut：进场快、靠近 cube 减速
      const x = b.sx + (b.tx - b.sx) * e;
      const y = b.sy + (b.ty - b.sy) * e;
      const scale = 0.35 + 0.65 * t;      // 从小到大
      const opacity = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1; // 接近 cube 渐隐
      b.el.style.opacity = String(opacity);
      b.el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
    if (allDone) {
      berries.forEach(b => b.el.remove());
      onDone();
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function stopIdleDemo() {
  _demoActive = false;
  if (_demoRaf) { cancelAnimationFrame(_demoRaf); _demoRaf = 0; }
  if (_demoTimer) { clearTimeout(_demoTimer); _demoTimer = 0; }
  const demo = $('mixerDemo');
  if (demo) demo.innerHTML = '';
  // 飞入树果挂在屏幕容器上，必须清理残留
  const host = demo?.closest('.screen') || $('mixerContent')?.closest('.screen') || document.querySelector('.screen');
  if (host) host.querySelectorAll('.mixer-demo-berry').forEach(el => el.remove());
}

// ---------- 首页 cube 染色 ----------
// 预加载白色结构图（blob 缓存防跨源污染）
function loadCubeBaseImage() {
  if (_cubeBase) return Promise.resolve(_cubeBase);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { _cubeBase = img; resolve(img); };
    img.onerror = reject;
    fetch('./items/cube.png')
      .then(r => r.blob())
      .then(b => { img.src = URL.createObjectURL(b); })
      .catch(reject);
  });
}

// 只染不透明像素，1:1 绘制防缩放坏点
function tintCanvasTo(cube, color) {
  if (!_cubeBase) return;
  const ctx = cube.getContext('2d');
  ctx.imageSmoothingEnabled = false; // 1:1 绘制，无需插值
  ctx.drawImage(_cubeBase, 0, 0); // 1:1 复制原图
  const data = ctx.getImageData(0, 0, cube.width, cube.height);
  const px = data.data;
  const [tr, tg, tb] = hexToRgb(color);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] !== 255) continue;
    const lum = (px[i] + px[i + 1] + px[i + 2]) / 3 / 255;
    const l2 = Math.pow(lum, 0.8);
    px[i] = tr * l2; px[i + 1] = tg * l2; px[i + 2] = tb * l2;
  }
  ctx.putImageData(data, 0, 0);
}

// 把 cube 染成目标色
function tintCubeTo(cube, color) {
  if (!cube.isConnected) return;
  tintCanvasTo(cube, color);
}

// ---------- 方块颜色：配方树果固有色加权平均 ----------
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// 配方树果 RGB 加权平均 → gamma 提亮 → 补饱和度（混合易发灰变暗）
export function computeBlockColor(recipe) {
  if (!recipe || recipe.length === 0) return '#FFFFFF';
  let r = 0, g = 0, b = 0, total = 0;
  for (const i of recipe) {
    const c = BERRY_COLORS[i];
    if (!c) continue;
    const [cr, cg, cb] = hexToRgb(c);
    r += cr; g += cg; b += cb; total++;
  }
  if (total === 0) return '#FFFFFF';
  r /= total; g /= total; b /= total;
  const gamma = 0.7; // <1 提升中间调亮度，暗部提升最多，白色不变
  r = 255 * Math.pow(r / 255, gamma);
  g = 255 * Math.pow(g / 255, gamma);
  b = 255 * Math.pow(b / 255, gamma);
  let [h, s, l] = rgbToHsl(r, g, b);
  s = Math.min(1, s * 1.6); // 混合使颜色发灰，补足饱和度
  return rgbToHex(...hslToRgb(h, s, l));
}

// 白色结构图染成目标色（fetch+blob 防跨源污染）
function tintCubeImage(color, onLoad) {
  const img = new Image();
  img.onload = () => {
    try {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth || img.width;
      cv.height = img.naturalHeight || img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, cv.width, cv.height);
      const px = data.data;
      const [tr, tg, tb] = hexToRgb(color);
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] !== 255) continue; // 不透明像素才染色，透明/半透明保持原样
        const lum = (px[i] + px[i + 1] + px[i + 2]) / 3 / 255; // 亮度 0~1，白色高光=1
        const l2 = Math.pow(lum, 0.8); // 暗部/灰部轻度提亮，让方块更鲜亮且保留明暗层次
        px[i] = tr * l2; px[i + 1] = tg * l2; px[i + 2] = tb * l2;
      }
      ctx.putImageData(data, 0, 0);
      onLoad(cv.toDataURL('image/png'));
    } catch (e) {
      onLoad(null); // canvas 被污染等异常时保持白色原图
    }
  };
  img.onerror = () => onLoad(null);
  // blob 同源数据源，canvas 不会被标记为跨源
  fetch('./items/cube.png')
    .then(r => r.blob())
    .then(blob => { img.src = URL.createObjectURL(blob); })
    .catch(() => { img.src = './items/cube.png'; }); // fetch 不可用时降级直接加载
}

// 冷却页方块预览：按配方颜色染色
function tintBlockVisual() {
  const el = $('mixerBlockVisual');
  if (!el) return;
  tintCubeImage(computeBlockColor(blockRecipe), url => {
    if (url && el.isConnected) el.src = url;
  });
}

function cooldownHtml() {
  const target = findBerryTarget(blockRecipe);
  const targetCaught = !!(target && (gameData.pokedex?.[String(target.index)]?.caught || 0) > 0);
  const quality = BLOCK_QUALITY[blockQuality] || BLOCK_QUALITY.good;
  // 布局与首页/结果页统一
  return `
    <div class="mixer-wrap mixer-cool">
      <div class="mixer-page-title">树果方块生效中</div>
      <div class="mixer-result-stage">
        <img class="mixer-block-visual" id="mixerBlockVisual" src="./items/cube.png" alt="树果方块" />
        <div class="mixer-cool-quality ${blockQuality}">${quality.label}</div>
        <div class="mixer-cool-timer">剩余 <span id="mixerCoolMeters">${blockMetersRemaining()}</span> 米</div>
        <div class="mixer-result-target show">
          ${targetCaught
            ? `遇敌时 ${Math.round(quality.chance * 100)}% 概率直接遇到目标宝可梦！`
            : '当地没有宝可梦喜欢吃这个配方！'}
        </div>
      </div>
      <button class="bottom-dock" id="mixerCancelBtn">取消使用</button>
    </div>`;
}

function berryImgsHtml(list) {
  if (!Array.isArray(list) || list.length === 0) return '<span class="mixer-empty">-</span>';
  return list.map(i => `<span class="block-bait-berry"><img data-berry="${BERRY_ICONS[i]}" alt="${BERRY_NAMES[BERRY_ICONS[i]] || ''}" /></span>`).join('');
}

// 渲染后显式加载树果缩略图（img 仅带 data-berry）
function loadBerryImgs(scope) {
  (scope || document).querySelectorAll('.block-bait-berry img').forEach(im => {
    const f = im.dataset.berry;
    if (f) tryLoadImage(im, `./items/berries/${f}`);
  });
}

// ---------- 混合小游戏（QTE 转盘） ----------
// 页面：上半转盘 + 底部吸底按钮
function qteHtml() {
  return `
    <div class="mixer-wrap mixer-qte">
      <div class="mixer-qte-stage">
        <canvas class="mixer-qte-canvas" id="mixerQteCanvas"></canvas>
      </div>
      <button class="bottom-dock" id="mixerQteBtn">按下！</button>
    </div>`;
}

// 绑定按钮、初始化画布
function bindQte() {
  const cv = $('mixerQteCanvas');
  if (cv) {
    const dpr = window.devicePixelRatio || 1;
    cv.width = QTE_CANVAS * dpr;
    cv.height = QTE_CANVAS * dpr;
  }
  $('mixerQteBtn')?.addEventListener('click', onQtePress);
}

// 开始小游戏（树果已扣）
function startQte() {
  const el = $('mixerContent');
  if (!el) return;
  stopIdleDemo();
  _qteRound = 0;
  _qteScore = [];
  _qteQuality = 'good';
  _qteActive = true;
  el.innerHTML = qteHtml();
  bindQte();
  beginRound();
  _qteRaf = requestAnimationFrame(qteFrame);
}

// 页面重进/重连时继续游戏（挂钟时间戳续跑）
function startQteLoop() {
  if (!_qteActive) return;
  if (_qteRaf) { cancelAnimationFrame(_qteRaf); _qteRaf = 0; }
  const cv = $('mixerQteCanvas');
  if (cv) {
    const dpr = window.devicePixelRatio || 1;
    cv.width = QTE_CANVAS * dpr;
    cv.height = QTE_CANVAS * dpr;
  }
  _qteRaf = requestAnimationFrame(qteFrame);
}

// 开启新一轮：指针从顶部启动加速
function beginRound() {
  _qtePhase = 'approach';
  _qteStart = Date.now();
  _qteAngle = 0;
  _qteSpeed = QTE_SPEEDS[_qteRound];
  saveQteState();
}

// 主循环：推进阶段、旋转内指针、绘制转盘
function qteFrame() {
  if (!_qteActive) return;
  // 离开页面暂停绘制，挂钟时间戳保证离开期间照常推进
  if ($('mixerView')?.style.display === 'none') return;
  const t = (Date.now() - _qteStart) / 1000;
  if (_qtePhase === 'approach') {
    if (t < QTE_ACCEL) _qteAngle = _qteSpeed * t * t / (2 * QTE_ACCEL); // 匀加速启动
    else if (t < QTE_APPROACH) _qteAngle = _qteSpeed * (t - QTE_ACCEL / 2);
    else { _qtePhase = 'active'; _qteBaseAngle = _qteAngle; _qteStart = Date.now(); saveQteState(); }
  } else if (_qtePhase === 'active') {
    const tt = (Date.now() - _qteStart) / 1000;
    _qteAngle = (_qteBaseAngle + _qteSpeed * tt) % 360;
    if (tt >= QTE_WINDOW) recordQte('poor'); // 超时未按 → 失误
  } else if (_qtePhase === 'judge') {
    if (t >= QTE_JUDGE_PAUSE) {
      _qteRound++;
      if (_qteRound >= QTE_ROUNDS) { endQteGame(); return; }
      beginRound();
    }
  }
  drawQte();
  _qteRaf = requestAnimationFrame(qteFrame);
}

// 按下按钮：仅 active 阶段有效，按指针与顶部 0° 的角度误差判定
function onQtePress() {
  if (!_qteActive || _qtePhase !== 'active') return;
  const a = _qteAngle % 360;
  const err = Math.min(a, 360 - a);
  recordQte(judgeGrade(err));
}

// 角度误差 → 单轮精确度（三档：完美 / 良好 / 劣质）
function judgeGrade(err) {
  if (err <= 8) return 'perfect';
  if (err <= 30) return 'good';
  return 'poor';
}

// 记录一轮结果，进入展示阶段
function recordQte(grade) {
  _qteScore.push(grade);
  _qtePhase = 'judge';
  _qteStart = Date.now();
  saveQteState();
}

// 结束小游戏：补齐剩余轮次 → 计算品质 → 清除进度 → 进入结果页
function endQteGame() {
  if (!_qteActive) return;
  _qteActive = false;
  if (_qteRaf) { cancelAnimationFrame(_qteRaf); _qteRaf = 0; }
  while (_qteScore.length < QTE_ROUNDS) _qteScore.push('poor');
  _qteQuality = calcQuality(_qteScore);
  addSystemLog('mixer', { action: 'qte', score: [..._qteScore], quality: _qteQuality });
  setQteState({ phase: 'result', recipe: [..._lastRecipe], quality: _qteQuality }); // 结果页未领取前可恢复
  saveSessionState();
  showResult();
}

// QTE 进度存会话：退出/重连接着玩，不给重置机会
function saveQteState() {
  setQteState({
    round: _qteRound,
    score: [..._qteScore],
    phase: _qtePhase,
    start: _qteStart,
    angle: _qteAngle,
    baseAngle: _qteBaseAngle,
    speed: _qteSpeed,
    quality: _qteQuality,
    recipe: [..._lastRecipe], 
  });
  saveSessionState();
}

// 重连恢复：从断点继续
function restoreQte() {
  const s = qteState;
  if (!s) return;
  _qteActive = true;
  _qteRound = s.round || 0;
  _qteScore = Array.isArray(s.score) ? s.score : [];
  _qteQuality = s.quality || 'good';
  _qtePhase = s.phase || 'approach';
  _qteStart = s.start || Date.now();
  _qteAngle = s.angle || 0;
  _qteBaseAngle = s.baseAngle || 0;
  _qteSpeed = s.speed || QTE_SPEEDS[_qteRound] || QTE_SPEEDS[0];
  _lastRecipe = Array.isArray(s.recipe) ? s.recipe : [];
}

// 五轮成绩 → 五档品质：完美 2 分 / 良好 1 分 / 劣质 0 分，总分 0~10，满分需全完美
function calcQuality(scores) {
  const total = scores.reduce((s, g) => s + (g === 'perfect' ? 2 : g === 'good' ? 1 : 0), 0);
  if (total >= 10) return 'perfect';
  if (total >= 7) return 'great';
  if (total >= 5) return 'good';
  if (total >= 3) return 'fair';
  return 'poor';
}

// 绘制转盘：进度环 + 盘面 + 色带 + 内指针
function drawQte() {
  const cv = $('mixerQteCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const S = QTE_CANVAS;
  const cx = S / 2, cy = S / 2;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);

  // 外圈环 = 进度环：五段弧
  const segDeg = 360 / QTE_ROUNDS;
  const segGap = 0; // 五段首尾相接，平头拼接不交叠
  for (let i = 0; i < QTE_ROUNDS; i++) {
    const a0 = (-90 + i * segDeg + segGap / 2) * Math.PI / 180;
    const a1 = (-90 + (i + 1) * segDeg - segGap / 2) * Math.PI / 180;
    ctx.beginPath();
    ctx.arc(cx, cy, 70, a0, a1);
    ctx.strokeStyle = i < _qteScore.length ? QTE_GRADE_COLOR[_qteScore[i]] : 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'butt';
    ctx.stroke();
  }

  // 盘面：中心透明，仅轮廓描边
  ctx.beginPath();
  ctx.arc(cx, cy, 64, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#376d56';
  ctx.stroke();

  // 内圈色带：顶部双色三截——中间完美 ±8°，两侧良好 8°~30°，其余不画
  const ringR = 56;  // 环带中心半径（内指针尖端扫过位置）
  const ringW = 8;   // 环带宽度
  ctx.lineCap = 'butt';
  ctx.lineWidth = ringW;
  // 两侧良好段
  ctx.strokeStyle = QTE_GRADE_COLOR.good;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, (-90 - 30) * Math.PI / 180, (-90 - 8) * Math.PI / 180);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, (-90 + 8) * Math.PI / 180, (-90 + 30) * Math.PI / 180);
  ctx.stroke();
  // 中间完美段
  ctx.strokeStyle = QTE_GRADE_COLOR.perfect;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, (-90 - 8) * Math.PI / 180, (-90 + 8) * Math.PI / 180);
  ctx.stroke();

  // 内指针（红，指向顶部）
  const ang = (_qteAngle % 360) * Math.PI / 180;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, -56);
  ctx.lineTo(-3, 0);
  ctx.lineTo(3, 0);
  ctx.closePath();
  ctx.fillStyle = '#c0392b';
  ctx.fill();
  ctx.restore();

  // 中心点（后画，盖住指针根部）
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, TAU);
  ctx.fillStyle = '#24563f';
  ctx.fill();

  ctx.restore();
}

// ---------- 结果 / 领取 ----------
function showResult() {
  const el = $('mixerContent');
  if (!el) return;
  stopIdleDemo();
  const recipe = [..._lastRecipe].sort((a, b) => a - b);
  const target = findBerryTarget(recipe);
  // 目标已捕获才算"有宝可梦吃"，否则不可领取
  const targetCaught = !!(target && (gameData.pokedex?.[String(target.index)]?.caught || 0) > 0);
  const quality = BLOCK_QUALITY[_qteQuality] || BLOCK_QUALITY.good;
  el.innerHTML = `
    <div class="mixer-wrap mixer-result">
      <div class="mixer-page-title mixer-result-title">混合结果：<span class="${_qteQuality}">${quality.label}</span></div>
      <div class="mixer-result-stage" id="mixerResultStage">
        <img class="mixer-block-visual" id="mixerResultCube" src="./items/cube.png" alt="树果方块" />
        <div class="mixer-result-berries">${berryImgsHtml(recipe)}</div>
        <div class="mixer-result-target">
          ${target && targetCaught
            ? `遇敌时 ${Math.round(quality.chance * 100)}% 概率直接遇到目标宝可梦！`
            : '当地没有宝可梦喜欢吃这个配方！'}
        </div>
      </div>
      <div class="mixer-result-actions">
        <button class="mixer-action-claim" id="mixerClaimBtn">领取树果方块</button>
        <button class="mixer-action-giveup" id="mixerGiveUpBtn">放弃</button>
      </div>
    </div>`;
  $('mixerClaimBtn')?.addEventListener('click', claimBlock);
  $('mixerGiveUpBtn')?.addEventListener('click', () => { setQteState(null); render(); });
  loadBerryImgs(el);
  // 混合动画：配方树果从屏幕外飞入 cube，全部到达后染色并淡入结果内容
  const stage = $('mixerResultStage');
  const cube = $('mixerResultCube');
  const reveal = () => {
    el.querySelectorAll('.mixer-page-title, .mixer-result-berries, .mixer-result-target, .mixer-result-actions').forEach(n => n.classList.add('show'));
    playObtained(); // 方块动画结束、结果 UI 出现 → 获得音效
  };
  if (stage && cube && recipe.length > 0) {
    flyBerriesBatch(stage, cube, recipe, () => {
      tintCubeImage(computeBlockColor(recipe), url => {
        if (url && cube.isConnected) cube.src = url;
      });
      reveal();
    });
  } else {
    tintCubeImage(computeBlockColor(recipe), url => { if (url && cube?.isConnected) cube.src = url; });
    reveal();
  }
}

function claimBlock() {
  if (blockBuffActive) return;
  const recipe = _lastRecipe || [];
  if (recipe.length === 0) return;
  setBlockRecipe(recipe);
  setBlockQuality(_qteQuality || 'good');
  setBlockBuffActive(true);
  setBlockStartWalk(gameData.stats?.walkDistance || 0); // 再走满 BLOCK_DISTANCE 米自动结束
  syncBlockVisual();
  startBlockCountdown();
  // 方块期间提高目标宝可梦的出现概率
  import('./battle.js').then(m => m.scheduleNextEncounter());
  // 文案切换为方块生效状态
  if (phase === 'idle') {
    const t = $('idleText');
    if (t) t.textContent = '✦ 树果方块生效中 ✦';
    setIdleMsgIdx(-1);
  }
  addSystemLog('mixer', { action: 'claim', recipe });
  gameData.stats.totalBlockMade = (gameData.stats.totalBlockMade || 0) + 1;
  setQteState(null); // 已领取，清除结果状态
  saveGame();
  render();
}

// ---------- 树果方块 buff 管理 ----------
// 被目标宝可梦吃掉（遇敌时调用）
export function eatBlock(reason) {
  if (!blockBuffActive) return;
  setBlockBuffActive(false);
  setBlockStartWalk(0);
  clearBlockCountdown();
  setBlockRecipe([]);
  syncBlockVisual();
  restoreIdleText();
  addSystemLog('mixer', { action: 'eaten', reason });
  saveGame();
}

// 走满里程自动结束
export function handleBlockExpired() {
  if (!blockBuffActive) return;
  if (blockMetersRemaining() > 0) return;
  setBlockBuffActive(false);
  setBlockStartWalk(0);
  clearBlockCountdown();
  setBlockRecipe([]);
  syncBlockVisual();
  // 提示文案（轮播会自然接管）
  if (phase === 'idle') {
    const t = $('idleText');
    if (t) t.textContent = '✦ 树果方块的效果结束了 ✦';
    setIdleMsgIdx(-1);
  }
  addSystemLog('mixer', { action: 'expired' });
  saveGame();
}

// 取消使用：立即停止效果，恢复首页
function cancelBlock() {
  if (!blockBuffActive) return;
  setBlockBuffActive(false);
  setBlockStartWalk(0);
  clearBlockCountdown();
  setBlockRecipe([]);
  syncBlockVisual();
  restoreIdleText();
  addSystemLog('mixer', { action: 'cancel' });
  saveGame();
  render();
}

// 方块结束后的闲置文案：优先恢复其他生效 buff
function restoreIdleText() {
  if (phase !== 'idle') return;
  const t = $('idleText');
  if (!t) return;
  if (window.__honeyBuffActive__) t.textContent = '✦ 甜蜜蜜生效中 ✦';
  else if (window.__charmBuffActive__) t.textContent = '✦ 闪耀护符生效中 ✦';
  else setIdleMsgIdx(-1);
}

// 清理首页旧方块残留
export function syncBlockVisual() {
  const el = $('blockBait');
  if (!el) return;
  el.style.display = 'none';
  el.innerHTML = '';
}

// 方块剩余里程（米）：再走满 BLOCK_DISTANCE 米即失效
function blockMetersRemaining() {
  const total = BLOCK_DISTANCE * PX_PER_METER;
  const used = Math.max(0, (gameData.stats?.walkDistance || 0) - blockStartWalk);
  return Math.max(0, Math.ceil((total - used) / PX_PER_METER));
}

// 同步冷却页的剩余里程显示
function updateBlockTimers(remain) {
  const ct = $('mixerCoolMeters');
  if (ct) ct.textContent = remain;
}

export function startBlockCountdown() {
  clearBlockCountdown();
  _blockCoolInterval = setInterval(() => {
    if (!blockBuffActive) { clearBlockCountdown(); return; }
    const remain = blockMetersRemaining();
    if (remain <= 0) { handleBlockExpired(); return; } // 走满里程自动结束
    updateBlockTimers(remain);
  }, 500);
}

export function clearBlockCountdown() {
  if (_blockCoolInterval) {
    clearInterval(_blockCoolInterval);
    _blockCoolInterval = null;
  }
}

function syncCoolTimer() {
  const el = $('mixerCoolMeters');
  if (el) el.textContent = blockMetersRemaining();
}
