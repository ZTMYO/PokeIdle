// ===== 混合器（小游戏） =====
// 消耗 MIXER_CANDY_COST 糖果开局，倒计时后连抛 MIXER_ROUNDS 轮树果，点击收集，集满 MIXER_MAX_PICKS 种自动结束；
// 领取后得到"树果方块"：如甜甜蜜一样作为随身 buff，快速遇敌并优先吸引当前地区配方完全一致的宝可梦，
// 被吃掉或再走满 BLOCK_DISTANCE 米后结束（无目标宝可梦则纯走里程）。
import { $, showView, tryLoadImage, updateBackpack, updateStats } from './ui.js';
import { phase, gameData, blockBuffActive, blockRecipe, blockStartWalk, setBlockBuffActive, setBlockRecipe, setBlockStartWalk, setIdleMsgIdx, setPrevView, addSystemLog, saveGame, randInt } from './state.js';
import { BERRY_ICONS, BERRY_NAMES, BERRY_COLORS, findBerryTarget } from './items.js';
import { delay } from './animation.js';
import { MIXER_CANDY_COST, MIXER_ROUNDS, MIXER_BERRIES_PER_ROUND, MIXER_MAX_PICKS, MIXER_FALL_DURATION, MIXER_REACT_MS, MIXER_ROUND_GAP, MIXER_COUNTDOWN_STEP, BLOCK_DISTANCE, PX_PER_METER } from './config.js';

// 混合器页面状态：'idle' | 'game' | 'result'（冷却状态由 blockBuffActive 决定）
let _pageState = 'idle';
let _gameActive = false;
let _rounds = [];          // 各轮的树果下标数组
let _collected = new Set();// 已收集的唯一树果下标
let _pickCount = 0;        // 已收集的不同树果种类数（满 MIXER_MAX_PICKS 自动结束）
let _currentRound = 0;     // 当前进行的轮下标（0 起），刷新恢复用
let _pendingResume = null; // 会话快照恢复的进行中游戏/结果（待进入页面时继续）
let _raf = 0;              // 抛果动画句柄
let _blockCoolInterval = null; // 剩余里程轮询（500ms）
let _demoActive = false;   // 首页演示动画是否运行中
let _demoRaf = 0;          // 首页演示动画 rAF 句柄
let _demoTimer = 0;        // 首页演示动画批次间隔句柄
let _cubeBase = null;      // 白色结构图原始位图（blob 缓存，供染色）

// ---------- 页面入口 ----------
export function showMixerView() {
  // 从手机主页进入时，返回应回到手机主页
  setPrevView($('phoneView')?.style.display !== 'none' ? 'phoneView' : (phase === 'encounter' || phase === 'caught') ? 'encounterView' : 'idleView');
  // 先显示视图再渲染：演示动画依赖可见状态
  showView('mixerView');
  // 恢复进行中游戏/结果；进行中不重绘，避免打断
  if (_pageState !== 'game' && _pageState !== 'result') {
    if (_pendingResume) {
      const snap = _pendingResume;
      _pendingResume = null;
      resumeGame(snap);
    } else {
      render();
    }
  }
}

// 从快照恢复小游戏（刷新/退出后继续）
function resumeGame(snap) {
  _collected = new Set(snap.collected || []);
  _pickCount = snap.pickCount || 0;
  // 快照为待领取的结果页 → 直接回到结果页，可继续领取/放弃
  if (snap.pageState === 'result') {
    _pageState = 'result';
    showResult();
    return;
  }
  _pageState = 'game';
  _gameActive = true;
  _rounds = snap.rounds || [];
  _currentRound = snap.currentRound || 0;
  buildStage(); // buildStage 内部会 refreshCollected
  (async () => {
    await runCountdown();
    await runRounds(_currentRound);
    _gameActive = false;
    _pageState = 'result';
    showResult();
  })();
}

// 初始化时由 main.js 调用：暂存会话恢复的游戏快照，待进入混合器页面时继续
export function resumeMixerGame(snap) {
  if (!snap) return;
  _pendingResume = {
    pageState: snap.pageState === 'result' ? 'result' : 'game',
    rounds: snap.rounds || [],
    collected: snap.collected || [],
    pickCount: snap.pickCount || 0,
    currentRound: snap.currentRound || 0,
  };
}

// 会话快照（beforeunload 写入，刷新后恢复）
export function getMixerSessionSnapshot() {
  if (_pendingResume) {
    return { pageState: _pendingResume.pageState, rounds: _pendingResume.rounds, collected: _pendingResume.collected, pickCount: _pendingResume.pickCount, currentRound: _pendingResume.currentRound };
  }
  if (_pageState === 'game' && _gameActive) {
    return { pageState: 'game', rounds: _rounds, collected: [..._collected], pickCount: _pickCount, currentRound: _currentRound };
  }
  if (_pageState === 'result') {
    return { pageState: 'result', collected: [..._collected], pickCount: _pickCount };
  }
  return null;
}
window.__mixerSessionSnapshot__ = getMixerSessionSnapshot;

// ---------- 渲染 ----------
function render() {
  const el = $('mixerContent');
  if (!el) return;
  if (blockBuffActive) {
    _pageState = 'idle';
    el.innerHTML = cooldownHtml();
    syncCoolTimer();
    loadBerryImgs(el);
    tintBlockVisual();
    $('mixerCancelBtn')?.addEventListener('click', cancelBlock);
  } else {
    _pageState = 'idle';
    el.innerHTML = idleHtml();
    const btn = $('mixerStartBtn');
    if (btn) btn.addEventListener('click', startGame);
    startIdleDemo();
  }
}

function idleHtml() {
  const candy = gameData?.items?.['candy'] || 0;
  return `
    <div class="mixer-wrap">
      <div class="mixer-page-title">树果混合器</div>
      <div class="mixer-info">
        <div class="mixer-demo" id="mixerDemo"></div>
      </div>
      <button class="bottom-dock" id="mixerStartBtn" ${candy < MIXER_CANDY_COST ? 'disabled' : ''}>
        <span>开始混合</span>
        <span class="mixer-cost"><img src="./items/candy.png" alt="糖果" /> ×${MIXER_CANDY_COST}</span>
      </button>
    </div>`;
}

// ---------- 首页演示动画 ----------
// 随机 2~4 颗树果从三边飞入汇聚到 cube 中心渐隐，循环演示；纯装饰，页面不可见时停止。
function startIdleDemo() {
  stopIdleDemo();
  const demo = $('mixerDemo');
  if (!demo) return;
  // cube 底座：canvas 直接绘制（buffer 与原图同尺寸，避免缩放坏点）
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

// 一批树果从整个屏幕外飞入汇聚到 cube 中心（同时出发/到达），全部到达后回调
function flyBerriesBatch(demo, cube, indices, onDone) {
  // 以屏幕容器为参照并挂载：树果从屏幕边缘外飞入，而非局限于中间舞台区
  const host = demo.closest('.screen') || demo;
  const rect = host.getBoundingClientRect();
  const W = Math.max(rect.width, 120);
  const H = Math.max(rect.height, 120);
  const cubeRect = cube.getBoundingClientRect();
  const berryHalf = 22; // 44x44 元素 translate 定位左上角，偏移半尺寸对齐中心
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
    do { // 重试保持起点间距（上限后接受，防死循环）
      const edge = randInt(0, 2); // 上/左/右三边（不从下方出来）
      if (edge === 0)      { sx = 8 + Math.random() * (W - 56); sy = -70 - Math.random() * 30; }
      else if (edge === 1) { sx = -70 - Math.random() * 30; sy = 8 + Math.random() * (H - 56); }
      else                 { sx = W + 70 + Math.random() * 30; sy = 8 + Math.random() * (H - 56); }
      tries++;
    } while (tries < 12 && berries.some(b => Math.hypot(b.sx - sx, b.sy - sy) < MIN_GAP));
    berries.push({ el, sx, sy, tx: cx, ty: cy, dur });
  }
  const start = performance.now();
  function frame(now) {
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
  if (demo) {
    demo.innerHTML = '';
    // 飞入的树果挂在屏幕容器上，一并清理
    (demo.closest('.screen') || demo).querySelectorAll('.mixer-demo-berry').forEach(el => el.remove());
  }
}

// ---------- 首页 cube 染色 ----------
// 预加载白色结构图（blob 缓存，避免跨源污染）
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

// 染色：只染不透明像素；buffer 与原图同尺寸 1:1 绘制，放大交给 CSS pixelated，避免缩放坏点
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

// 把 cube 染成目标色（下阴影由 CSS 提供）
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

// 把白色结构图染成目标色（只染不透明像素；fetch+blob 规避跨源污染）
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
  // 与首页/结果页统一：标题顶部居中，方块底部中央；剩余里程在结果页配方同位置（cube 上方），小字在方块下方
  return `
    <div class="mixer-wrap mixer-cool">
      <div class="mixer-page-title">树果方块生效中</div>
      <div class="mixer-result-stage">
        <img class="mixer-block-visual" id="mixerBlockVisual" src="./items/cube.png" alt="树果方块" />
        <div class="mixer-cool-timer" id="mixerCoolTimer">剩余 ${blockMetersRemaining()} 米</div>
        <div class="mixer-result-target show">
          ${targetCaught ? '当地有宝可梦喜欢吃这个配方，将被吸引！' : '当地没有宝可梦喜欢吃这个配方！'}
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

// ---------- 开始混合（扣糖果 + 倒计时 + 小游戏） ----------
async function startGame() {
  if (_gameActive || blockBuffActive) return;
  if ((gameData.items?.['candy'] || 0) < MIXER_CANDY_COST) return;
  gameData.items['candy'] -= MIXER_CANDY_COST;
  addSystemLog('mixer', { action: 'start', cost: MIXER_CANDY_COST });
  saveGame();
  updateBackpack('candy');
  updateStats();

  _pageState = 'game';
  _gameActive = true;
  _collected = new Set();
  _pickCount = 0;
  _currentRound = 0;
  _rounds = generateRounds();

  buildStage();
  await runCountdown();
  await runRounds(0);
  _gameActive = false;
  _pageState = 'result';
  showResult();
}

// 生成 MIXER_ROUNDS 轮：12 种树果各一个 + 随机补充，打散后每 4 个一轮（必覆盖全部，允许重复）
function generateRounds() {
  const base = BERRY_ICONS.map((_, i) => i);
  const extraCount = MIXER_ROUNDS * MIXER_BERRIES_PER_ROUND - base.length;
  const extra = Array.from({ length: Math.max(extraCount, 0) }, () => randInt(0, base.length - 1));
  const all = shuffle([...base, ...extra]);
  const rounds = [];
  for (let i = 0; i < MIXER_ROUNDS; i++) rounds.push(all.slice(i * MIXER_BERRIES_PER_ROUND, (i + 1) * MIXER_BERRIES_PER_ROUND));
  return rounds;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildStage() {
  stopIdleDemo();
  const el = $('mixerContent');
  el.innerHTML = `
    <div class="mixer-stage" id="mixerStage">
      <div class="mixer-collected" id="mixerCollected"></div>
      <div class="mixer-round" id="mixerRound"></div>
      <div class="mixer-countdown" id="mixerCountdown"></div>
    </div>`;
  $('mixerStage').addEventListener('click', onStageClick);
  refreshCollected();
}

async function runCountdown() {
  const cd = $('mixerCountdown');
  if (!cd) return;
  for (let n = 3; n >= 1; n--) {
    cd.textContent = n;
    cd.classList.remove('show');
    void cd.offsetWidth;
    cd.classList.add('show');
    await delay(MIXER_COUNTDOWN_STEP);
  }
  cd.textContent = '开始';
  cd.classList.remove('show');
  void cd.offsetWidth;
  cd.classList.add('show');
  await delay(MIXER_COUNTDOWN_STEP);
  cd.style.display = 'none';
}

async function runRounds(from = 0) {
  const total = _rounds.length;
  for (let i = from; i < total; i++) {
    _currentRound = i;
    if (_pickCount >= MIXER_MAX_PICKS || !_gameActive) break;
    setRoundInfo(i + 1);
    await throwRound(_rounds[i]);
    if (_pickCount >= MIXER_MAX_PICKS) { await delay(350); break; }
    if (i < total - 1) await delay(MIXER_ROUND_GAP);
  }
}

function setRoundInfo(n) {
  const el = $('mixerRound');
  if (el) el.textContent = `第 ${n}/${_rounds.length} 轮`;
}

// 一轮抛果：每颗树果独立抛物线（顶点高度/飞行时长/上升占比各自随机），
// 从各自落点下方带角度抛出（像抛球一样散开），落地多下坠数像素贴死地面（底部被舞台裁切），
// 落地后仍可点击 MIXER_REACT_MS，随后原地淡出
function throwRound(berries) {
  return new Promise(resolve => {
    const stage = $('mixerStage');
    if (!stage || !_gameActive) return resolve();
    const rect = stage.getBoundingClientRect();
    const stageW = Math.max(rect.width, 180);
    const stageH = Math.max(rect.height, 200);
    const berryH = 40;          // 树果元素高度（见 .mixer-falling-berry）
    const landY = stageH - berryH + 14; // 多下坠 14px，底部埋进地面更多（超出部分被裁切）
    // 落点横向分槽：每颗树果落在自己的槽位中心附近（小范围抖动），槽位更宽避免挤在一起误触
    const n = berries.length;
    const margin = 8;
    const slotW = (stageW - margin * 2) / n;
    const T = MIXER_FALL_DURATION;
    const items = berries.map((idx, i) => {
      const el = document.createElement('div');
      el.className = 'mixer-falling-berry';
      el.dataset.idx = String(idx);
      const img = document.createElement('img');
      img.alt = BERRY_NAMES[BERRY_ICONS[idx]] || '';
      el.appendChild(img);
      stage.appendChild(el);
      tryLoadImage(img, `./items/berries/${BERRY_ICONS[idx]}`);
      // 落点：槽位中心附近；起抛点：落点正下方左右偏开（带抛球角度，各树果从一开始就分散）
      const endX = margin + slotW * i + slotW / 2 + (Math.random() - 0.5) * slotW * 0.12;
      const startX = endX + (Math.random() - 0.5) * slotW * 0.7;
      // 每颗树果独立随机：最高点高度、飞行时长（±15%）、上升占比，营造自然随机感
      const peakY = 18 + Math.random() * 52;
      const dur = T * (0.85 + Math.random() * 0.3);
      const up = 0.38 + Math.random() * 0.12;
      return { idx, el, startX, endX, peakY, dur, up, caught: false, landed: false, gone: false };
    });
    const start = performance.now();
    function frame(now) {
      if (!_gameActive || _pageState !== 'game') { resolve(); return; }
      for (const it of items) {
        if (it.caught || it.el.dataset.caught) continue; // 已点击的树果交给飞向收集区的动画，不再由本循环驱动
        const tRaw = Math.min((now - start) / it.dur, 1);
        let t, y, rot;
        if (tRaw < it.up) {
          t = tRaw / it.up;
          y = stageH - (stageH - it.peakY) * (1 - (1 - t) * (1 - t)); // easeOut 上升，顶点处自然减速到 0
          rot = -120 + 120 * t; // 抛出时向后翻转，顶点回正
        } else {
          t = (tRaw - it.up) / (1 - it.up);
          y = it.peakY + (landY - it.peakY) * t * t; // easeIn 下落（从 0 开始加速）
          rot = 150 * t; // 下落翻转
        }
        // 水平位移只在上升段完成：从起抛点移向落点，下落时固定在落点
        const tx = tRaw < it.up ? tRaw / it.up : 1;
        const x = it.startX + (it.endX - it.startX) * tx;
        it.el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
        // 落地回正：抹掉下落旋转的残留角度，树果正立贴地
        if (tRaw >= 1 && !it.landed) {
          it.landed = true;
          it.landedAt = now;
          it.el.classList.add('landed');
          it.el.style.transform = `translate(${it.endX}px, ${landY}px)`;
        }
      }
      // 已落地且超过反应窗口的树果原地淡出；全部完成（含被点击）则结束本轮
      let allCleared = true;
      for (const it of items) {
        if (it.caught || it.el.dataset.caught) continue; // 已收集视为完成
        if (it.gone) continue;
        allCleared = false;
        if (it.landed && now - it.landedAt >= MIXER_REACT_MS) {
          it.gone = true;
          it.el.classList.add('miss');
          setTimeout(() => it.el.remove(), 220);
        }
      }
      if (allCleared) { resolve(); return; }
      _raf = requestAnimationFrame(frame);
    }
    _raf = requestAnimationFrame(frame);
  });
}

// 舞台点击 → 收集树果（被点击的树果飞向左上角收集区）
function onStageClick(e) {
  if (_pageState !== 'game' || !_gameActive) return;
  const berryEl = e.target.closest('.mixer-falling-berry');
  if (!berryEl || berryEl.dataset.caught) return;
  if (_pickCount >= MIXER_MAX_PICKS) return;
  const idx = Number(berryEl.dataset.idx);
  berryEl.dataset.caught = '1';
  // 只有首次收集该种类才累加计数与配方，重复点击不改变收集数量
  if (!_collected.has(idx)) {
    _collected.add(idx);
    _pickCount++;
  }
  flyToCollected(berryEl);
  refreshCollected();
  setTimeout(() => berryEl.remove(), 300);
}

// 点击的树果平滑飞向左上角收集区（缩小并淡出）
function flyToCollected(el) {
  const box = $('mixerCollected');
  if (!box) return;
  el.style.pointerEvents = 'none'; // 飞行途中不再拦截点击，避免挡住后续树果
  const destX = box.offsetLeft + Math.min(box.offsetWidth / 2, 22);
  const destY = box.offsetTop + 12;
  el.style.zIndex = '8';
  el.style.transition = 'transform 0.24s ease-in, opacity 0.24s ease-in';
  el.style.transform = `translate(${destX}px, ${destY}px) scale(0.35)`;
  el.style.opacity = '0.85';
}

// 已收集树果展示（增量更新，不重建已加载图片避免闪烁）
function refreshCollected() {
  const box = $('mixerCollected');
  if (!box) return;
  const list = [..._collected];
  // 计数标签
  let label = box.querySelector('.mixer-collected-label');
  if (!label) {
    label = document.createElement('div');
    label.className = 'mixer-collected-label';
    box.prepend(label);
  }
  label.textContent = `已收集 ${_pickCount}/${MIXER_MAX_PICKS}`;
  // 收集列表容器
  let items = box.querySelector('.mixer-collected-items');
  if (!items) {
    items = document.createElement('div');
    items.className = 'mixer-collected-items';
    box.appendChild(items);
  }
  if (list.length === 0) {
    items.innerHTML = '<span class="mixer-empty">-</span>';
    return;
  }
  // 有树果了，移除占位符
  const placeholder = items.querySelector('.mixer-empty');
  if (placeholder) placeholder.remove();
  // 已存在的树果不重建，只补充缺失的
  const existing = new Set();
  items.querySelectorAll('.mixer-collected-berry img').forEach(im => {
    if (im.dataset.idx != null) existing.add(Number(im.dataset.idx));
  });
  for (const i of list) {
    if (existing.has(i)) continue;
    const span = document.createElement('span');
    span.className = 'mixer-collected-berry';
    const img = document.createElement('img');
    img.dataset.idx = String(i);
    img.alt = BERRY_NAMES[BERRY_ICONS[i]] || '';
    span.appendChild(img);
    items.appendChild(span);
    tryLoadImage(img, `./items/berries/${BERRY_ICONS[i]}`);
  }
}

// ---------- 结果 / 领取 ----------
function showResult() {
  const el = $('mixerContent');
  if (!el) return;
  const recipe = [..._collected].sort((a, b) => a - b);
  const target = findBerryTarget(recipe);
  // 只有图鉴中成功捕获过目标宝可梦才算"有宝可梦吃"；命中但未捕获 → 视为没有，不允许领取
  const targetCaught = !!(target && (gameData.pokedex?.[String(target.index)]?.caught || 0) > 0);
  // 三页统一：标题顶部居中（动画后淡入），方块底部中央，小字在方块下方
  const reveal = recipe.length > 0 ? '' : ' show'; // 无动画（空配方）时直接显示
  el.innerHTML = `
    <div class="mixer-wrap mixer-result">
      <div class="mixer-page-title mixer-fade${reveal}" id="mixerResultTitle">混合完成！</div>
      <div class="mixer-result-stage" id="mixerResultDemo">
        ${recipe.length > 0
          ? `<div class="mixer-result-berries mixer-fade" id="mixerResultBerries">${berryImgsHtml(recipe)}</div>`
          : '<div class="mixer-empty">没有收集到任何树果</div>'}
        <div class="mixer-result-target${reveal}" id="mixerResultTarget">
          ${target && targetCaught
            ? '当地有宝可梦喜欢吃这个配方，将被吸引！'
            : recipe.length === 0
              ? '没有收集到树果，无法制作树果方块'
              : '当地没有宝可梦喜欢吃这个配方！'}
        </div>
      </div>
      ${recipe.length > 0
        ? '<div class="mixer-result-actions" id="mixerResultActions"><button class="mixer-action-claim" id="mixerClaimBtn">领取树果方块</button><button class="mixer-action-giveup" id="mixerGiveUpBtn">放弃</button></div>'
        : '<button class="bottom-dock" id="mixerBackBtn">返回</button>'}
    </div>`;
  $('mixerClaimBtn')?.addEventListener('click', claimBlock);
  $('mixerGiveUpBtn')?.addEventListener('click', () => render());
  $('mixerBackBtn')?.addEventListener('click', () => render());
  loadBerryImgs(el);
  // 有配方：播放汇聚动画，完成后染色并淡入标题/小字/按钮
  if (recipe.length > 0) {
    const demo = $('mixerResultDemo');
    if (!demo) return;
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
    flyBerriesBatch(demo, cube, recipe, () => {
      tintCubeTo(cube, computeBlockColor(recipe));
      $('mixerResultTitle')?.classList.add('show');
      $('mixerResultBerries')?.classList.add('show');
      $('mixerResultTarget')?.classList.add('show');
      $('mixerResultActions')?.classList.add('show');
    });
  }
}

function claimBlock() {
  if (blockBuffActive) return;
  const recipe = [..._collected].sort((a, b) => a - b);
  if (recipe.length === 0) return;
  setBlockRecipe(recipe);
  setBlockBuffActive(true);
  setBlockStartWalk(gameData.stats?.walkDistance || 0); // 再走满 BLOCK_DISTANCE 米自动结束
  syncBlockVisual();
  startBlockCountdown();
  // 方块期间按 BLOCK_TARGET_CHANCE 提高目标宝可梦的出现概率（不影响遇敌节奏）
  import('./battle.js').then(m => m.scheduleNextEncounter());
  // 文案切换为方块生效状态
  if (phase === 'idle') {
    const t = $('idleText');
    if (t) t.textContent = '✦ 树果方块生效中 ✦';
    setIdleMsgIdx(-1);
  }
  addSystemLog('mixer', { action: 'claim', recipe });
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

// 清理首页旧方块残留（方块期间无独立 UI，纯功能性 buff）
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
  const ct = $('mixerCoolTimer');
  if (ct) ct.textContent = '剩余 ' + remain + ' 米';
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
  const el = $('mixerCoolTimer');
  if (el) el.textContent = '剩余 ' + blockMetersRemaining() + ' 米';
}
