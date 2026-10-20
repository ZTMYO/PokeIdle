// ===== 宝可连线（Flow）=====
// 限时活动「宝可连线」的玩法：按住一对搭档宝可梦拖出线，把所有格子铺满、线不交叉。
// 关卡不手工摆：先生成一条铺满全盘的哈密顿路径，再切成几段，段的两端就是一对端点 ——
// 这样每一局都必有解，而且每次开始都是新盘面。
import { $, showView, getCurrentView, tryLoadImage, tryLoadPokemonImage } from './ui.js';
import { pushNav, popNav, getPokemonByIndex } from './state.js';
import { playMahjongSfx } from './audio.js';

// 三档：盘面越大、对数越多越难；通关给该难度的固定气球（与另外两个小游戏共用兑换所）。
// 盘面尺寸受手机屏幕限制不再放大，难度靠对数拉开；奖励按实际用时压到与另外两个小游戏接近的水平
export const FLOW_LEVELS = [
  { id: 'easy', name: '简单', size: 5, flows: 4, minLen: 4, coins: 15 },
  { id: 'normal', name: '普通', size: 6, flows: 6, minLen: 4, coins: 30 },
  { id: 'hard', name: '困难', size: 7, flows: 7, minLen: 4, coins: 60 },
];
export const flowLevelOf = (id) => FLOW_LEVELS.find((l) => l.id === id) || FLOW_LEVELS[1];

// 配对池：外形同款、设定上互为一对的组合，每对配一个贴合本体的颜色（互不重复）
const FLOW_PAIRS = [
  { a: '0311', b: '0312', color: '#ffea71' },   // 正电拍拍 / 负电拍拍
  { a: '0313', b: '0314', color: '#6ca81a' },   // 电萤虫 / 甜甜萤
  { a: '0266', b: '0268', color: '#eef2f6' },   // 甲壳茧 / 盾甲茧
  { a: '0029', b: '0032', color: '#a35fc4' },   // 尼多兰 / 尼多朗
  { a: '0592', b: '0592-1', color: '#4fa3e3' }, // 轻飘飘 雄 / 雌
  { a: '0380', b: '0381', color: '#5566cc' },   // 拉帝亚斯 / 拉帝欧斯
  { a: '0337', b: '0338', color: '#e8943a' },   // 月石 / 太阳岩
  { a: '0876', b: '0876-1', color: '#786ca6' }, // 爱管侍 雄 / 雌
  { a: '0678', b: '0678-1', color: '#4771d4' }, // 超能妙喵 雄 / 雌
  { a: '0282', b: '0475', color: '#d055a0' },   // 沙奈朵 / 艾路雷朵
  { a: '0010', b: '0384', color: '#2e9e4f' },   // 绿毛虫 / 烈空坐
  { a: '0196', b: '0197', color: '#7353af' }, // 太阳伊布 / 月亮伊布
  { a: '0025', b: '0778', color: '#f0c22e' },   // 皮卡丘 / 谜拟丘
];
const COIN_ICON = './items/goods/balloon-pink.png';

let _g = null;   // 当前这一局

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 抽几对搭档：池内每对颜色都不同，随机取够数量即可
function pickPairs(count) {
  return shuffled(FLOW_PAIRS).slice(0, count);
}

// 每格的上下左右邻居（下标 = 行 × 边长 + 列）
function neighbors(n) {
  const out = Array.from({ length: n * n }, () => []);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (r > 0) out[i].push(i - n);
      if (r < n - 1) out[i].push(i + n);
      if (c > 0) out[i].push(i - 1);
      if (c < n - 1) out[i].push(i + 1);
    }
  }
  return out;
}

// 铺满全盘的哈密顿路径：先蛇形铺一条，再用 backbite 反复随机变形。
// 一次 backbite = 从端点咬住一个远处邻居，把中间那段反过来接上，路径仍然合法且仍铺满全盘。
function hamiltonian(n) {
  const N = n * n;
  const path = [];
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) path.push(r * n + (r % 2 ? n - 1 - k : k));
  }
  const at = new Int32Array(N);   // 格子 → 它在路径里的位置
  for (let i = 0; i < N; i++) at[path[i]] = i;
  const reverse = (a, b) => {
    while (a < b) {
      const t = path[a]; path[a] = path[b]; path[b] = t;
      at[path[a]] = a; at[path[b]] = b;
      a++; b--;
    }
  };
  const nbs = neighbors(n);
  for (let s = 0, steps = N * 60; s < steps; s++) {
    if (Math.random() < 0.5) {
      const list = nbs[path[0]];
      const k = at[list[(Math.random() * list.length) | 0]];
      if (k >= 2) reverse(0, k - 1);
    } else {
      const list = nbs[path[N - 1]];
      const k = at[list[(Math.random() * list.length) | 0]];
      if (k <= N - 3) reverse(k + 1, N - 1);
    }
  }
  return path;
}

// 把长路径切成几段：每段至少 minLen 格，长度随机但尽量均衡
function splitPath(path, count, minLen) {
  const extra = path.length - minLen * count;
  const weights = Array.from({ length: count }, () => 0.75 + Math.random() * 0.5);
  const sum = weights.reduce((a, b) => a + b, 0);
  const lens = weights.map((w) => minLen + Math.floor((extra * w) / sum));
  let rest = path.length - lens.reduce((a, b) => a + b, 0);
  while (rest > 0) { lens[(Math.random() * count) | 0]++; rest--; }
  const segs = [];
  let i = 0;
  for (const len of lens) { segs.push(path.slice(i, i + len)); i += len; }
  return segs;
}

function connected(c) {
  const p = _g.paths[c], [a, b] = _g.endpoints[c];
  return p.length >= 2
    && ((p[0] === a && p[p.length - 1] === b) || (p[0] === b && p[p.length - 1] === a));
}

// 格子归属：端点即使还没连线也算这一方占着，别的线不能压过去
function rebuildOwner() {
  _g.owner.fill(-1);
  _g.paths.forEach((p, c) => { for (const i of p) _g.owner[i] = c; });
  _g.endpoints.forEach(([a, b], c) => {
    if (_g.owner[a] < 0) _g.owner[a] = c;
    if (_g.owner[b] < 0) _g.owner[b] = c;
  });
}

function buildBoard() {
  const board = $('flBoard');
  if (!board) return;
  board.querySelectorAll('.fl-cell, .fl-end, .fl-result').forEach((el) => el.remove());
  board.classList.remove('done');
  board.onpointerdown = onDown;
  board.onpointermove = onMove;
  board.onpointerup = onUp;
  board.onpointercancel = onUp;
  board.onclick = onBoardClick;
  board.oncontextmenu = (e) => e.preventDefault();   // 手机上长按别弹菜单打断拖拽
  _g.cellEls = [];
  for (let i = 0; i < _g.n * _g.n; i++) {
    const el = document.createElement('div');
    el.className = 'fl-cell';
    board.appendChild(el);
    _g.cellEls.push(el);
  }
  _g.endEls = [];
  _g.endpoints.forEach((pair, c) => {
    pair.forEach((idx, j) => {
      const el = document.createElement('div');
      el.className = 'fl-end';
      // 脚下淡色，提示这条线该用什么颜色；悬停时用加深的那档
      el.style.setProperty('--fl-soft', hexAlpha(_g.colors[c], 0.18));
      el.style.setProperty('--fl-hover', hexAlpha(_g.colors[c], 0.42));
      const img = document.createElement('img');
      img.alt = '';
      const poke = getPokemonByIndex(_g.mons[c][j]);
      // 部分条目（如轻飘飘雄性）的文件名带性别，但图鉴条目没有 form 字段，拼名会拼错，优先用 image
      if (poke?.image) tryLoadImage(img, `./${poke.image}`);
      else if (poke) tryLoadPokemonImage(img, poke, '');
      el.appendChild(img);
      board.appendChild(el);
      _g.endEls.push({ idx, el });
    });
  });
}

// 按舞台大小算格子边长；色块、端点、网格底纹都跟着这个尺寸走
function layout() {
  if (!_g) return;
  const stage = $('flStage'), board = $('flBoard');
  if (!stage || !board) return;
  const cs = getComputedStyle(stage);
  const w = stage.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const h = stage.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  const n = _g.n;
  const size = Math.max(18, Math.floor((Math.min(w, h) - 2) / n));   // 留 2px 给棋盘边框
  _g.cell = size;
  const px = size * n;
  board.style.width = `${px}px`;
  board.style.height = `${px}px`;
  board.style.backgroundSize = `${size}px ${size}px`;
  for (let i = 0; i < _g.cellEls.length; i++) {
    const el = _g.cellEls[i];
    el.style.left = `${(i % n) * size}px`;
    el.style.top = `${Math.floor(i / n) * size}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
  }
  for (const { idx, el } of _g.endEls) {
    el.style.left = `${(idx % n) * size}px`;
    el.style.top = `${Math.floor(idx / n) * size}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
  }
  paint();
}

// 走过的格子直接铺色，端点格要等线真的拖过去才上色
function paint() {
  if (!_g) return;
  const total = _g.n * _g.n;
  const colors = new Int8Array(total).fill(-1);
  _g.paths.forEach((p, c) => { for (const i of p) colors[i] = c; });
  for (let i = 0; i < total; i++) {
    const el = _g.cellEls[i];
    const c = colors[i];
    el.classList.toggle('on', c >= 0);
    el.style.backgroundColor = c >= 0 ? _g.colors[c] : '';
  }
}

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function cellAt(clientX, clientY) {
  if (!_g || !_g.cell) return -1;
  const board = $('flBoard');
  // 机身整体会被 transform / zoom 缩放，指针是视口坐标、格子边长是布局坐标；
  // 用未做 rect 补偿的 getClientRects 反推缩放比，两边才在同一套坐标里
  const rect = board.getClientRects()[0];
  if (!rect || !rect.width) return -1;
  const scale = rect.width / board.offsetWidth;
  const size = _g.cell * scale;
  const col = Math.floor((clientX - rect.left - board.clientLeft * scale) / size);
  const row = Math.floor((clientY - rect.top - board.clientTop * scale) / size);
  if (col < 0 || row < 0 || col >= _g.n || row >= _g.n) return -1;
  return row * _g.n + col;
}

function onDown(e) {
  if (!_g || _g.done || _g.drag || (e.button !== 0 && e.pointerType !== 'touch')) return;   // 已有一根手指在画，别被第二根抢走
  const idx = cellAt(e.clientX, e.clientY);
  if (idx < 0) return;
  const color = _g.owner[idx];
  if (color < 0) return;
  const [a, b] = _g.endpoints[color];
  const path = _g.paths[color];
  const at = path.indexOf(idx);
  if (idx === a || idx === b) {
    _g.paths[color] = [idx];   // 从端点起手：旧线整条作废，重新画
  } else if (at >= 0) {
    path.length = at + 1;      // 从线中间接着拖：后面的部分收回去
  } else {
    return;
  }
  _g.drag = { color, id: e.pointerId, locked: false };
  rebuildOwner();
  paint();
  e.preventDefault();
  try { $('flBoard').setPointerCapture(e.pointerId); } catch { /* 老 WebView 不支持就算了 */ }
}

function isEndOf(color, idx) {
  const [a, b] = _g.endpoints[color];
  return idx === a || idx === b;
}

// 快速滑动时两次事件之间会跨过好几格：朝目标格一格一格补上，斜着走时先走偏差大的那根轴
function stepToward(last, idx) {
  const n = _g.n;
  const dr = Math.floor(idx / n) - Math.floor(last / n);
  const dc = (idx % n) - (last % n);
  if (!dr && !dc) return -1;
  if (!dr) return last + Math.sign(dc);
  if (!dc) return last + Math.sign(dr) * n;
  return Math.abs(dr) >= Math.abs(dc) ? last + Math.sign(dr) * n : last + Math.sign(dc);
}

function extend(idx) {
  if (idx < 0 || !_g.drag) return;
  const d = _g.drag;
  const p = _g.paths[d.color];
  const last = p[p.length - 1];
  if (idx === last) return;
  const at = p.indexOf(idx);
  if (at >= 0) {   // 拖回走过的格 = 退格，已经接通的线也能退回去重画
    p.length = at + 1;
    d.locked = false;
    rebuildOwner();
    paint();
    return;
  }
  if (d.locked) return;   // 已经接上另一端：手没松之前只能往回退，不能继续往外长
  // 相邻格直接走；跨格的（触屏划过太快）沿途中补齐，离太远就当成手指滑出盘面，不补
  const dist = Math.abs(Math.floor(idx / _g.n) - Math.floor(last / _g.n)) + Math.abs((idx % _g.n) - (last % _g.n));
  if (dist > 4) return;
  for (let guard = 0; guard < 64; guard++) {
    const from = p[p.length - 1];
    if (from === idx) break;
    const next = stepToward(from, idx);
    if (next < 0) break;
    const owner = _g.owner[next];
    if (owner >= 0 && owner !== d.color) break;   // 被别的线（或别的端点）占着
    p.push(next);
    if (isEndOf(d.color, next)) {   // 接到自己的另一端：这条线完成，但先不锁住手势
      d.locked = true;
      playMahjongSfx('ui');
      break;
    }
  }
  rebuildOwner();
  paint();
}

function onMove(e) {
  if (!_g || !_g.drag || _g.done || e.pointerId !== _g.drag.id) return;
  extend(cellAt(e.clientX, e.clientY));
  e.preventDefault();
}

function onUp(e) {
  if (!_g || !_g.drag || e.pointerId !== _g.drag.id) return;
  _g.drag = null;
  rebuildOwner();
  paint();
  checkWin();
}

function checkWin() {
  if (!_g || _g.done) return;
  for (let c = 0; c < _g.paths.length; c++) if (!connected(c)) return;
  const seen = new Uint8Array(_g.n * _g.n);
  for (const p of _g.paths) for (const i of p) seen[i] = 1;
  for (let i = 0; i < seen.length; i++) if (!seen[i]) return;
  finish();
}

function finish() {
  if (!_g || _g.done) return;
  _g.done = true;
  _g.drag = null;
  _g.coins = _g.lv.coins;
  if (_g.onFinish) { try { _g.onFinish(_g.coins, true); } catch (e) { console.error('[宝可连线] 结算出错：', e); } }
  playMahjongSfx('ui');
  playWinFx();
}

// 通关动效：色块从盘面中心向外依次弹一下，荡完再弹结算
function playWinFx() {
  const board = $('flBoard');
  if (!board) { showResult(); return; }
  const { n } = _g;
  const mid = (n - 1) / 2;
  let maxD = 0;
  _g.cellEls.forEach((el, i) => {
    const d = Math.round(Math.abs((i % n) - mid) + Math.abs(Math.floor(i / n) - mid));
    if (d > maxD) maxD = d;
    el.style.setProperty('--fl-d', d);
    el.classList.add('win');
  });
  for (const { el } of _g.endEls) el.classList.add('win');
  _g.fxTimer = setTimeout(() => {
    _g.fxTimer = 0;
    if (_g && _g.done) showResult();
  }, 260 + maxD * 45 + 360);
}

function showResult() {
  const board = $('flBoard');
  if (!board) return;
  for (const { el } of _g.endEls) el.remove();   // 结算面板上不再保留宝可梦图标
  _g.endEls = [];
  const el = document.createElement('div');
  el.className = 'bg-result fl-result';
  el.innerHTML = `
    <p class="game-result-title">全部连接完成</p>
    <p class="game-result-coins"><img src="${COIN_ICON}" alt="">+${_g.coins} 气球</p>
    <div class="game-result-btns">
      <span class="catch-confirm-btn" data-fl="again">再来一局</span>
      <span class="catch-confirm-btn" data-fl="back">返回</span>
    </div>`;
  board.appendChild(el);
  board.classList.add('done');
}

function onBoardClick(e) {
  if (!_g || !_g.done) return;
  const btn = e.target.closest('[data-fl]');
  if (!btn) return;
  if (btn.dataset.fl === 'again') {
    startFlowGame({ level: _g.lv.id, onFinish: _g.onFinish });
  } else {
    leaveFlowGame();
  }
}

export function startFlowGame(opts = {}) {
  if (!$('flowView')) return;
  if (_g?.fxTimer) clearTimeout(_g.fxTimer);
  const lv = flowLevelOf(opts.level);
  const flows = Math.min(lv.flows, FLOW_PAIRS.length);
  const segs = splitPath(hamiltonian(lv.size), flows, lv.minLen);
  const pairs = pickPairs(flows);
  _g = {
    lv,
    n: lv.size,
    cell: 0,                 // 由 layout() 按舞台尺寸赋值
    mons: pairs.map((p) => [p.a, p.b]),
    colors: pairs.map((p) => p.color),
    endpoints: segs.map((seg) => [seg[0], seg[seg.length - 1]]),
    paths: segs.map(() => []),
    owner: new Int16Array(lv.size * lv.size).fill(-1),
    endEls: [],
    drag: null,
    done: false,
    coins: 0,
    onFinish: opts.onFinish || null,
  };
  rebuildOwner();
  if (getCurrentView() !== 'flowView') pushNav('flowView');   // 再来一局时已经在棋盘上，别再压一层
  showView('flowView');
  buildBoard();
  layout();
}

// 离开：没连完就整局作废，一个气球也不给
export function leaveFlowGame() {
  if (!_g) return;   // 已经离开过：避免连点返回把导航栈多弹一层
  if (_g.fxTimer) clearTimeout(_g.fxTimer);
  _g.done = true;
  _g.drag = null;
  _g = null;
  if (getCurrentView() !== 'flowView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');   // 活动已下架：退回手机首页
  });
}

// 转屏 / 改窗口大小：格子边长要重算，按新尺寸重排一遍
window.addEventListener('resize', () => {
  if (_g && !_g.done && getCurrentView() === 'flowView') layout();
});
