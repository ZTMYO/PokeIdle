// ===== 无限滚动路面 (Canvas 渲染) =====
import { $ } from './ui.js';
import { ROAD_SPEED_WALK } from './config.js';
import * as clock from './clock.js';

const TILE = 24;
const SRC_TILE = 16;
const TILESET = './terrain/terrain-tileset.png';

let canvas = null;
let ctx = null;
let img = null;
let pattern = null;
let scrollX = 0;
let speed = ROAD_SPEED_WALK;
let rafId = null;
let active = false;

let containerWidth = 0;
let roadHeight = 0;
let patternWidth = 0;
let _dpr = 1; // 设备像素比（_resize 时刷新），用于把绘制坐标对齐设备像素网格

// 坐标对齐到设备像素网格：缩放/像素比非整数时，带小数的偏移会让花纹的采样相位逐帧变化，
// 滚动时表现为"波纹"；对齐后每帧都是整数设备像素平移，画面相位稳定
export function snapPx(px) {
  return Math.round(px * _dpr) / _dpr;
}

let _cycles = 0;
let _scrollFraction = 0;
// 累计行走距离（像素）：世界每走一步加 speed；暂停（遇敌/钓鱼/拾取）期间不累积
let _distance = 0;
// 世界步进（见 clock.js）：每帧把真实经过时间兑换成整数个 1/60 秒的步，逐步推进路面与
// 注册的步进器；渲染每帧一次。speed 单位是 px/步（走路 0.5 / 跑步 1.0 / 骑行 2.0）
const _steppers = new Set(); // 每步推进一次：道具 / 遇敌图标 / 大量出没 / 时空扭曲
const _renders = new Set();  // 每帧渲染一次：写 DOM 位置与显隐，不推进世界
// 掉落折算用的走动秒数游标：clock 的世界秒只增不减，取差值即本段走动时长
let _walkSecCursor = 0;
// 过渡状态：新道路从右侧滑入
let _transition = null; // { tiles, width, height, patternWidth, roadHeight, remaining }
// 过渡中新道路滑到角色脚下时回调（切换骑行/行走）
let _transitionCharCb = null;

function _resize() {
  if (!canvas || !pattern) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = _transition ? _transition.roadHeight : pattern.height * TILE;
  const dpr = window.devicePixelRatio || 1;
  _dpr = dpr;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx = canvas.getContext('2d',{willReadFrequently:true});
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  containerWidth = w;
  roadHeight = h;
  if (!_transition) {
    patternWidth = pattern.width * TILE;
  }
  // canvas.width 赋值会清空画布，暂停状态下 _frame 不会重绘，需立即补画一帧
  _draw();
}

function _drawPatternData(offsetX, pd) {
  if (!ctx || !img || !pd) return;
  const tiles = pd.tiles;
  if (!tiles || tiles.length === 0) return;
  const rows = tiles.length;
  const cols = tiles[0].length;
  // 偏移对齐设备像素网格后直接用 float offsetX 绘制（imageSmoothingEnabled=false 下浏览器会 floor 坐标）
  const ox = snapPx(offsetX);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = tiles[r][c];
      if (!tile) continue;
      ctx.drawImage(img, tile.col * SRC_TILE, tile.row * SRC_TILE, SRC_TILE, SRC_TILE,
                    ox + c * TILE, r * TILE, TILE, TILE);
    }
  }
}

// 绘制当前一帧（不推进滚动、不调度下一帧）
function _draw() {
  if (!canvas || !ctx || !pattern) return;
  ctx.clearRect(0, 0, containerWidth, roadHeight);

  if (_transition) {
    // 旧道路从当前位置向左滑出一个屏幕宽度，新道路从右缘滑入
    const oldPw = patternWidth;
    const newPw = _transition.patternWidth;
    const cut = snapPx(Math.max(0, _transition.remaining));

    // 调整 oldOffset 使旧道路的瓦片边界落在 cut 上，消除分界处的半个瓦片
    // rawOldOffset - cut = -(savedScrollX + savedFraction + containerWidth) 为恒定值
    // → adjust 整个过渡期间不变 → 不产生跳跃
    const rawOldOffset = -_transition.savedScrollX - _transition.savedFraction - (containerWidth - cut);
    const adjust = ((rawOldOffset - cut) % TILE + TILE) % TILE;
    const oldOffset = rawOldOffset - adjust;

    // 旧道路：clip [0, cut)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cut, roadHeight);
    ctx.clip();
    if (oldPw > 0) {
      const oldCopies = Math.ceil((containerWidth + speed) / oldPw) + 2;
      for (let i = 0; i < oldCopies; i++) {
        _drawPatternData(oldOffset + i * oldPw, pattern);
      }
    }
    ctx.restore();

    // 新道路：只在 [cut, containerWidth) 范围内绘制，不侵犯左侧
    ctx.save();
    ctx.beginPath();
    ctx.rect(cut, 0, containerWidth - cut, roadHeight);
    ctx.clip();
    if (newPw > 0) {
      const newCopies = Math.ceil((containerWidth + cut + speed) / newPw) + 2;
      for (let i = 0; i < newCopies; i++) {
        _drawPatternData(cut + i * newPw, _transition.pattern);
      }
    }
    ctx.restore();
  } else {
    if (patternWidth <= 0) return;
    // 用精确位置（整数部分 + 小数累积）绘制：每步 0.75px 也能在设备像素网格上平滑推进
    const exact = scrollX + _scrollFraction;
    const copies = Math.ceil(containerWidth / patternWidth) + 1;
    for (let i = 0; i < copies; i++) {
      _drawPatternData(-exact + i * patternWidth, pattern);
    }
  }
}

// 世界走一步：推进 speed 像素（px/步）
function _stepWorld() {
  _distance += speed; // 行走距离与滚动量同步（过渡滑入同样在前进）
  if (_transition) {
    // 过渡中：先递减 remaining，再绘制，确保连续性
    _transition.remaining -= speed;
    // 新道路滑到角色脚下（30% 屏宽）即触发回调：自行车道骑到头才下车
    if (!_transition.charFired && _transition.remaining <= _transition.charX) {
      _transition.charFired = true;
      _transitionCharCb?.();
    }
  } else {
    // 正常渲染：整数步进，消除子像素"半个tile"
    _scrollFraction += speed;
    const step = Math.floor(_scrollFraction);
    if (step !== 0) {
      _scrollFraction -= step;
      scrollX += step;
    }
    if (scrollX >= patternWidth) {
      scrollX -= patternWidth;
      _cycles++;
    }
  }
}

function _frame() {
  if (!active) return;

  // 本帧要推进的世界步数：60 步/秒。高刷屏多数帧是 0 步（只重绘），低刷屏一帧补多步；
  // 页面隐藏/长停摆不在这里补（走挂机补算）
  const steps = clock.stepsThisFrame();
  for (let i = 0; i < steps; i++) {
    _stepWorld();
    for (const fn of _steppers) fn(speed); // 步进器：道具/遇敌/事件图标，与路面同速
    if (!active) break; // 某一步触发了暂停（拾取道具/进入战斗）：本帧剩余步数作废
  }

  _draw();

  if (_transition && _transition.remaining <= 0) {
    // 过渡完成，切到新道路。小数部分移入 _scrollFraction 保持连续
    pattern = _transition.pattern;
    patternWidth = _transition.patternWidth;
    roadHeight = _transition.roadHeight;
    _scrollFraction += -_transition.remaining;
    scrollX = Math.floor(_scrollFraction);
    _scrollFraction -= scrollX;
    _transition = null;
    _cycles = 0;
  }

  // 渲染钩子：每帧一次，把当前状态画出来（刷新率只影响采样密度）
  for (const fn of _renders) fn();

  rafId = requestAnimationFrame(_frame);
}

// ---------- 步进器 / 渲染钩子 ----------
// 跟着路面走的对象（道具、遇敌图标、大量出没、时空扭曲）注册到这里，
// 由世界步统一推进、统一渲染，保证与路面像素同步且与刷新率无关
export function addStepper(fn) { _steppers.add(fn); }
export function removeStepper(fn) { _steppers.delete(fn); }
export function addRender(fn) { _renders.add(fn); }
export function removeRender(fn) { _renders.delete(fn); }

// ---------- 加载/切换 API ----------

// 优化固定道路 tiles：旋转每行使首尾瓦片一致，实现无缝循环
function _optimizeTiling(tiles) {
  return tiles.map(row => {
    if (row.length < 2) return row;
    const first = row[0];
    const last = row[row.length - 1];
    const same = (a, b) => a && b && a.col === b.col && a.row === b.row;
    if (same(first, last)) return row; // 已经无缝
    // 遍历所有旋转位置，找首尾匹配的旋转
    for (let shift = 1; shift < row.length; shift++) {
      const rotated = [...row.slice(shift), ...row.slice(0, shift)];
      if (same(rotated[0], rotated[rotated.length - 1])) return rotated;
    }
    // 找不到完美匹配，用最常见的 tile 做首尾
    const freq = {};
    row.forEach(t => { if (t) { const k = `${t.col},${t.row}`; freq[k] = (freq[k] || 0) + 1; } });
    const bestKey = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (bestKey) {
      const [bc, br] = bestKey.split(',').map(Number);
      const idx = row.findIndex(t => t && t.col === bc && t.row === br);
      if (idx > 0) {
        const rotated = [...row.slice(idx), ...row.slice(0, idx)];
        if (same(rotated[0], rotated[rotated.length - 1])) return rotated;
      }
    }
    return row;
  });
}

// 固定预设如果 tiles 比 width 短，循环重复原图案
function _expandFixedTiles(tiles, targetWidth) {
  if (!tiles || !tiles[0] || tiles[0].length >= targetWidth) return tiles;
  const srcLen = tiles[0].length;
  return tiles.map(row =>
    Array.from({ length: targetWidth }, (_, i) => ({ ...row[i % srcLen] }))
  );
}

export function load(data) {
  // 先优化原始 tiles（让首尾一致形成无缝），再展开重复
  const optimized = _optimizeTiling(data.tiles || []);
  const tiles = _expandFixedTiles(optimized, data.width);
  pattern = { width: data.width, height: data.height, tiles };
  patternWidth = (tiles[0]?.length || data.width) * TILE;
  roadHeight = data.height * TILE;
}

export function loadProb(probData) {
  const { width, height, rows } = probData;
  const cols = width;
  const tiles = [];
  for (let r = 0; r < height; r++) {
    const options = rows[r] || [];
    const row = [];
    for (let c = 0; c < cols; c++) {
      const picked = options.length > 0 ? _weightedPick(options) : null;
      row.push(picked ? { col: picked.col, row: picked.row } : null);
    }
    tiles.push(row);
  }
  load({ width: cols, height, tiles });
}

/** 开始过渡：当前道路滑出，新道路滑入 */
export function transitionTo(data) {
  const optimized = _optimizeTiling(data.tiles || []);
  const newTiles = _expandFixedTiles(optimized, data.width);
  if (!newTiles || newTiles.length === 0) return;

  // 如果在过渡中，先完成过渡
  if (_transition) {
    pattern = _transition.pattern;
    patternWidth = _transition.patternWidth;
    roadHeight = _transition.roadHeight;
  }

  const newPw = (newTiles[0]?.length || data.width) * TILE;
  _transition = {
    pattern: { width: data.width, height: data.height, tiles: newTiles },
    patternWidth: newPw,
    roadHeight: data.height * TILE,
    remaining: containerWidth,
    charX: Math.round(containerWidth * 0.3),
    charFired: false,
    savedScrollX: scrollX,
    savedFraction: _scrollFraction,
  };
}

/** 开始过渡到概率道路 */
export function transitionToProb(probData) {
  const { width, height, rows } = probData;
  const cols = width;
  const tiles = [];
  for (let r = 0; r < height; r++) {
    const options = rows[r] || [];
    const row = [];
    for (let c = 0; c < cols; c++) {
      const picked = options.length > 0 ? _weightedPick(options) : null;
      row.push(picked ? { col: picked.col, row: picked.row } : null);
    }
    tiles.push(row);
  }
  transitionTo({ width: cols, height, tiles });
}

function _weightedPick(options) {
  const total = options.reduce((s, t) => s + t.weight, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const t of options) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return options[options.length - 1];
}

// ---------- 生命周期 ----------

export function start(spd) {
  if (active) return;
  if (!pattern) return;
  if (spd !== undefined) speed = spd;

  const container = $('roadLayer');
  if (!container) return;
  container.innerHTML = '';

  canvas = document.createElement('canvas');
  canvas.className = 'road-canvas';
  container.appendChild(canvas);

  if (!img) {
    img = new Image();
    img.onload = () => {
      _resize();
      _walkSecCursor = 0;
      clock.start(); // 世界时钟起算：从当前帧开始兑换世界步
      active = true;
      rafId = requestAnimationFrame(_frame);
    };
    img.src = TILESET;
  } else {
    _resize();
    _walkSecCursor = 0;
    clock.start();
    active = true;
    rafId = requestAnimationFrame(_frame);
  }

  window.addEventListener('resize', _resize);
}

export function stop() {
  active = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (canvas) {
    canvas.remove();
    canvas = null;
    ctx = null;
  }
  scrollX = 0;
  _transition = null;
  _scrollFraction = 0;
  _walkSecCursor = 0;
  _steppers.clear();
  _renders.clear();
  clock.stop(); // 未补算的停摆时长作废
  window.removeEventListener('resize', _resize);
}

export function pause() {
  if (!active) return;
  active = false;
  clock.pause(); // 暂停期间不兑换世界步（遇敌/钓鱼/拾取道具的有意停顿）
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export function resume() {
  if (active) return;
  if (!canvas || !pattern) return;
  clock.resume(); // 重置时间戳与余数：暂停时长不计入推进，也不会一次性补一大段
  active = true;
  rafId = requestAnimationFrame(_frame);
}

export function setSpeed(spd) {
  speed = spd;
}

/** 当前步速：px/步（1 步 = 1/60 秒，见 clock.js）。走路 0.5 / 跑步 1.0 / 骑行 2.0 */
export function getSpeed() {
  return speed;
}

export function isActive() {
  return active;
}

export function isTransitioning() {
  return _transition !== null;
}

/** 注册过渡中"新道路到达角色脚下"回调（自行车道骑到头切换骑行/行走） */
export function onTransitionCharReach(cb) { _transitionCharCb = cb; }

export function getCycles() { return _cycles; }
export function resetScroll() { scrollX = 0; _cycles = 0; _scrollFraction = 0; }
/** 取走自上次调用以来累计的行走距离（像素），供主循环同步到存档 */
export function takeDistance() {
  const d = _distance;
  _distance = 0;
  return d;
}

// 实际推进速率（px/秒）= speed × 60（世界固定 60 步/秒），供 GPS 剩余时间与挂机补算共用
export function getPxPerSec() {
  return speed * 60;
}

// 取走并清零停摆累计秒数（浏览器后台/最小化补算用）
export function takeAfkSeconds() {
  return clock.takeAfkSeconds();
}

// 取走并清零正常走动累计秒数（掉落在 idle 期间按真实走路时长折算）
export function takeWalkSeconds() {
  const now = clock.simSeconds();
  const s = now - _walkSecCursor;
  _walkSecCursor = now;
  return s;
}
/** 视图切回时重新计算 canvas 尺寸 */
export function refreshSize() { _resize(); }

// ---- 道路地点标签（用于道具拾取文案）----
let _currentPlace = '';
export function setPlace(place) { _currentPlace = place || ''; }
export function getPlace() { return _currentPlace; }

// ---- 垂钓点行号（1/3 表示有垂钓点；钓鱼动画据此选择帧）----
let _fishingRow = 0;
export function setFishingRow(row) { _fishingRow = row || 0; }
export function getFishingRow() { return _fishingRow; }

// ---- 自行车道标记（骑行路段：快速推进里程，不触发遭遇/道具拾取）----
let _bike = false;
export function setBike(v) { _bike = !!v; }
export function isBike() { return _bike || _manualBike; }
// 仅路段自行车道（不含手动骑行）：用于"离开自行车路段"结算自行车道具
export function isRoadBike() { return _bike; }

// ---- 手动骑行（消耗自行车道具进入，独立于路段自行车道）----
// 独立标志：路段轮播切换（普通路/自行车道）不会打断手动骑行，也不误发"离开路段"奖励
let _manualBike = false;
let _manualBikeCb = null;
export function onManualBikeChanged(cb) { _manualBikeCb = cb; }
export function setManualBike(v) {
  v = !!v;
  if (_manualBike === v) return;
  _manualBike = v;
  _manualBikeCb?.(v);
}
export function isManualBike() { return _manualBike; }
