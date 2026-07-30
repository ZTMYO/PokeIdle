// ===== 无限滚动路面 (Canvas 渲染) =====
import { $ } from './ui.js';
import { ROAD_SPEED_WALK } from './config.js';

const TILE = 24;
const SRC_TILE = 16;
const TILESET = './img/terrain-tileset.png';

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

let _cycles = 0;
let _prevScrollX = 0;

// 过渡状态：新道路从右侧滑入
let _transition = null; // { tiles, width, height, patternWidth, roadHeight, remaining }

function _resize() {
  if (!canvas || !pattern) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = _transition ? _transition.roadHeight : pattern.height * TILE;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  containerWidth = w;
  roadHeight = h;
  if (!_transition) {
    patternWidth = pattern.width * TILE;
  }
}

function _drawPatternData(offsetX, pd) {
  if (!ctx || !img || !pd) return;
  const tiles = pd.tiles;
  if (!tiles || tiles.length === 0) return;
  const rows = tiles.length;
  const cols = tiles[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = tiles[r][c];
      if (!tile) continue;
      ctx.drawImage(img, tile.col * SRC_TILE, tile.row * SRC_TILE, SRC_TILE, SRC_TILE,
                    offsetX + c * TILE, r * TILE, TILE, TILE);
    }
  }
}

function _frame() {
  if (!active) return;

  ctx.clearRect(0, 0, containerWidth, roadHeight);

  if (_transition) {
    // 过渡中：只用 remaining 控制滑动，scrollX 保持不变
    // 旧道路从当前位置向左滑出一个屏幕宽度
    // 新道路从容器右边缘滑入到正常位置（offset = 0）
    const oldPw = patternWidth;
    const newPw = _transition.patternWidth;

    const oldOffset = -scrollX - (containerWidth - _transition.remaining);
    const oldCopies = Math.ceil((containerWidth + speed) / oldPw) + 2;
    for (let i = 0; i < oldCopies; i++) {
      _drawPatternData(oldOffset + i * oldPw, pattern);
    }

    const newCopies = Math.ceil((containerWidth + _transition.remaining + speed) / newPw) + 2;
    for (let i = 0; i < newCopies; i++) {
      _drawPatternData(_transition.remaining + i * newPw, _transition.pattern);
    }

    _transition.remaining -= speed;

    if (_transition.remaining <= 0) {
      // 过渡完成，切到新道路
      pattern = _transition.pattern;
      patternWidth = newPw;
      roadHeight = _transition.roadHeight;
      scrollX = 0;
      _transition = null;
      _cycles = 0;
    }
  } else {
    // 正常渲染
    scrollX += speed;

    const copies = Math.ceil(containerWidth / patternWidth) + 1;
    for (let i = 0; i < copies; i++) {
      _drawPatternData(-scrollX + i * patternWidth, pattern);
    }

    if (scrollX >= patternWidth) {
      scrollX -= patternWidth;
      _cycles++;
    }
  }

  rafId = requestAnimationFrame(_frame);
}

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

export function load(data) {
  pattern = {
    width: data.width,
    height: data.height,
    tiles: _optimizeTiling(data.tiles),
  };
  patternWidth = (pattern.tiles[0]?.length || data.width) * TILE;
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
  const newTiles = _optimizeTiling(data.tiles);
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
      active = true;
      rafId = requestAnimationFrame(_frame);
    };
    img.src = TILESET;
  } else {
    _resize();
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
  window.removeEventListener('resize', _resize);
}

export function pause() {
  if (!active) return;
  active = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export function resume() {
  if (active) return;
  if (!canvas || !pattern) return;
  active = true;
  rafId = requestAnimationFrame(_frame);
}

export function setSpeed(spd) {
  speed = spd;
}

export function getSpeed() {
  return speed;
}

export function isActive() {
  return active;
}

export function isTransitioning() {
  return _transition !== null;
}

export function getCycleCount() {
  return _cycles;
}

export function resetCycleCount() {
  _cycles = 0;
  _prevScrollX = 0;
}
