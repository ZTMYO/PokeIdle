// ===== 遇敌转场 =====
// 两种逐格溶解，遮罩用游戏主题底色（--screen-bg），都以左上角为起点：
//   grid    阈值 = 对角线位置 + 2×2 Bayer 抖动（过渡带呈棋盘状）
//   checker 阈值 = 种子固定的随机顺序
// 盖：小阈值先变；揭：小阈值先露出来——两段同向，都不从右下往回退。
// 省电模式、开场剧情、splash、后台补算一律直接切，不做动画。
import { $ } from './ui.js';

const EFFECTS = ['grid', 'checker'];
// 单次转场时长（毫秒）：盖 → 停顿 → 揭。斜向溶解扫得慢一档，随机格子保持原速
const TIMING = {
  grid: { cover: 260, hold: 50, reveal: 300 },
  checker: { cover: 220, hold: 50, reveal: 260 },
};
let _last = '';
let _canvas = null, _ctx = null, _w = 0, _h = 0, _dpr = 0;

const easeIn = (t) => t * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);

// 遮罩用主题底色：浅色主题 / 夜间 / 扭曲各有自己的底
function themeBg() {
  try {
    const c = getComputedStyle($('screen')).getPropertyValue('--screen-bg').trim();
    if (c) return c;
  } catch (_) {}
  return '#73c5a4';
}

function ensureCanvas() {
  const screen = $('screen');
  if (!screen) return null;
  if (!_canvas) {
    _canvas = document.createElement('canvas');
    _canvas.className = 'encounter-transition';
    screen.appendChild(_canvas);
  }
  const w = screen.clientWidth;
  const h = screen.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (w !== _w || h !== _h || dpr !== _dpr) {
    _w = w;
    _h = h;
    _dpr = dpr;
    _canvas.width = Math.round(w * dpr);
    _canvas.height = Math.round(h * dpr);
    _canvas.style.width = w + 'px';
    _canvas.style.height = h + 'px';
    _ctx = _canvas.getContext('2d');
    _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return _ctx;
}

const clamp01 = (v) => Math.min(0.999, Math.max(0.001, v));
const BAYER = [[0, 2], [3, 1]];

// 逐格画：tOf(i,j) 给出这一格的阈值 0~1，covered(t) 决定画不画
function drawCells(w, h, cell, tOf, covered) {
  const ctx = _ctx;
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  ctx.beginPath();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!covered(tOf(i, j))) continue;
      ctx.rect(i * cell, j * cell, cell + 0.5, cell + 0.5);
    }
  }
  ctx.fill();
}

// 左上 → 右下阈值：对角线位置 + Bayer 抖动
function drawGrid(covered) {
  const cell = 4;
  const cols = Math.ceil(_w / cell), rows = Math.ceil(_h / cell);
  const maxD = Math.max(1, cols + rows - 2);
  const band = 0.16;
  drawCells(_w, _h, cell, (i, j) => {
    const d = (i + j) / maxD;
    const jitter = (BAYER[j & 1][i & 1] / 4 - 0.375) * band * 2;
    return clamp01(d + jitter);
  }, covered);
}

// 随机顺序（种子固定）：同一次转场里盖和揭用的是同一套顺序
function hash01(i, j, seed) {
  let x = (Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663) ^ seed) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function drawChecker(covered, seed) {
  drawCells(_w, _h, 4, (i, j) => clamp01(hash01(i, j, seed)), covered);
}

function paint(name, covered, seed, color) {
  const ctx = _ctx;
  if (!ctx) return;
  ctx.clearRect(0, 0, _w, _h);
  ctx.fillStyle = color;
  if (name === 'checker') drawChecker(covered, seed);
  else drawGrid(covered);
}

function pickEffect() {
  const list = EFFECTS.filter((e) => e !== _last);
  const name = list[Math.floor(Math.random() * list.length)] || EFFECTS[0];
  _last = name;
  return name;
}

// swap：全屏铺满那一刻执行的切视图动作。返回 Promise，播完（含跳过）时 resolve
export function playEncounterTransition(swap, opts = {}) {
  const doSwap = typeof swap === 'function' ? swap : () => {};
  const skip = opts.skip
    || document.documentElement.classList.contains('power-save')
    || $('splash')?.style.display === 'flex'
    || window.__introActive;
  if (skip) {
    doSwap();
    return Promise.resolve();
  }

  const name = EFFECTS.includes(opts.effect) ? opts.effect : pickEffect();
  if (opts.effect) _last = name;
  const seed = (Math.random() * 0x7fffffff) | 0;
  // 时长按效果分开：斜向溶解从左上扫到右下，整屏观感比随机格子快，扫得慢一档
  const { cover: COVER, hold: HOLD, reveal: REVEAL } = TIMING[name] || TIMING.checker;

  if (!ensureCanvas()) {
    doSwap();
    return Promise.resolve();
  }
  const fill = themeBg();
  _canvas.style.display = 'block';

  return new Promise((resolve) => {
    let swapped = false;
    let raf = 0;
    const t0 = performance.now();
    const finish = () => {
      if (_canvas) _canvas.style.display = 'none';
      cancelAnimationFrame(raf);
      resolve();
    };
    const frame = (now) => {
      const t = now - t0;
      if (t < COVER) {
        const p = easeIn(t / COVER);
        // 盖：阈值小的（左上）先变
        paint(name, (th) => p >= th, seed, fill);
        raf = requestAnimationFrame(frame);
        return;
      }
      if (!swapped) {
        swapped = true;
        doSwap();
      }
      const rt = (t - COVER - HOLD) / REVEAL;
      if (rt < 1) {
        const q = easeOut(Math.max(0, rt));
        // 揭：阈值小的（左上）先露出来，与盖同向
        paint(name, (th) => q < th, seed, fill);
        raf = requestAnimationFrame(frame);
        return;
      }
      finish();
    };
    raf = requestAnimationFrame(frame);
  });
}

// 调试预览：按顺序把两种溶解各放一遍（__encounterFx 调用）
export async function previewEncounterFx() {
  for (const effect of EFFECTS) {
    await playEncounterTransition(() => {}, { effect });
    await new Promise((r) => setTimeout(r, 140));
  }
}
