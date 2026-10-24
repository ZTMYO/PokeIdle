// ===== 电力输送（限时活动小游戏）=====
// 点击导线旋转，把电肚蛙的电送到没电的洛托姆。
// 简单用一条铺满全盘的引线；普通/困难用全盘生成树，允许分叉。
import { $, showView, getCurrentView, tryLoadImage } from './ui.js';
import { pushNav, popNav } from './state.js';
import { playMahjongSfx } from './audio.js';

export const PF_LEVELS = [
  { id: 'easy', name: '简单', n: 4, coins: 40, mode: 'path', hints: 4 },
  { id: 'normal', name: '普通', n: 5, coins: 80, mode: 'network', hints: 0 },
  { id: 'hard', name: '困难', n: 6, coins: 150, mode: 'network', hints: 0 },
];
export const pfLevelOf = (id) => PF_LEVELS.find((l) => l.id === id) || PF_LEVELS[1];

const COIN_ICON = './items/goods/balloon-yellow.png';
const N = 1, E = 2, S = 4, W = 8;
const OPP = { [N]: S, [E]: W, [S]: N, [W]: E };
const EDGE = { [N]: [50, 0], [E]: [100, 50], [S]: [50, 100], [W]: [0, 50] };
// 4dir 待机帧按方向导出的 GIF：电肚蛙/洛托姆都朝自己格子的导线方向
const ART = {
  source: {
    w: 47, h: 45, oy: -5,   // 4dir 帧内容比画布中心低约 5px，抬高让肚子对准导线
    dirs: {
      down: './items/power-flow/bellibolt-down.gif',
      right: './items/power-flow/bellibolt-right.gif',
      up: './items/power-flow/bellibolt-up.gif',
      left: './items/power-flow/bellibolt-left.gif',
    },
  },
  targetOff: {
    w: 38, h: 35,
    dirs: {
      down: './items/power-flow/rotom-off-down.gif',
      right: './items/power-flow/rotom-off-right.gif',
      up: './items/power-flow/rotom-off-up.gif',
      left: './items/power-flow/rotom-off-left.gif',
    },
  },
  targetOn: {
    w: 38, h: 35,
    dirs: {
      down: './items/power-flow/rotom-on-down.gif',
      right: './items/power-flow/rotom-on-right.gif',
      up: './items/power-flow/rotom-on-up.gif',
      left: './items/power-flow/rotom-on-left.gif',
    },
  },
};

let _g = null;

const randInt = (n) => Math.floor(Math.random() * n);
const cellX = (n, i) => i % n;
const cellY = (n, i) => Math.floor(i / n);

function neighbor(n, i, bit) {
  const x = cellX(n, i), y = cellY(n, i);
  if (bit === N) return y > 0 ? i - n : -1;
  if (bit === E) return x < n - 1 ? i + 1 : -1;
  if (bit === S) return y < n - 1 ? i + n : -1;
  if (bit === W) return x > 0 ? i - 1 : -1;
  return -1;
}

function neighborBit(n, from, to) {
  if (to === from - n) return N;
  if (to === from + 1) return E;
  if (to === from + n) return S;
  if (to === from - 1) return W;
  return 0;
}

function rotateMask(mask, rot) {
  let m = mask;
  for (let k = 0; k < (rot & 3); k++) {
    let next = 0;
    if (m & N) next |= E;
    if (m & E) next |= S;
    if (m & S) next |= W;
    if (m & W) next |= N;
    m = next;
  }
  return m;
}

function maskOf(n, adj, i) {
  let mask = 0;
  for (const to of adj[i]) mask |= neighborBit(n, i, to);
  return mask;
}

// 随机生成一棵覆盖全盘的生成树：困难档使用，允许分叉
function makeTree(n) {
  const total = n * n;
  const adj = Array.from({ length: total }, () => []);
  const seen = new Array(total).fill(false);
  const start = randInt(total);
  seen[start] = true;
  const stack = [start];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = [];
    const x = cellX(n, cur), y = cellY(n, cur);
    if (y > 0 && !seen[cur - n]) options.push(cur - n);
    if (x < n - 1 && !seen[cur + 1]) options.push(cur + 1);
    if (y < n - 1 && !seen[cur + n]) options.push(cur + n);
    if (x > 0 && !seen[cur - 1]) options.push(cur - 1);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const next = options[randInt(options.length)];
    seen[next] = true;
    adj[cur].push(next);
    adj[next].push(cur);
    stack.push(next);
  }
  return adj;
}

function bfs(n, adj, start) {
  const dist = new Array(n * n).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const next of adj[cur]) {
      if (dist[next] !== -1) continue;
      dist[next] = dist[cur] + 1;
      queue.push(next);
    }
  }
  return dist;
}

function pickEnds(n, adj) {
  const leaves = [];
  for (let i = 0; i < adj.length; i++) if (adj[i].length === 1) leaves.push(i);
  let a = leaves[randInt(leaves.length)];
  const dist = bfs(n, adj, a);
  let b = a;
  for (const leaf of leaves) if (leaf !== a && dist[leaf] > dist[b]) b = leaf;
  if (b === a) b = leaves.find((x) => x !== a);
  return { source: a, target: b };
}

// 简单：一条覆盖全盘的引线，没有分叉
function makeHamiltonPath(n) {
  let path = [];
  const horizontal = Math.random() < 0.5;
  const flip = Math.random() < 0.5;
  if (horizontal) {
    for (let y = 0; y < n; y++) {
      const xs = Array.from({ length: n }, (_, i) => i);
      if ((y % 2 === 0) === flip) xs.reverse();
      for (const x of xs) path.push(y * n + x);
    }
  } else {
    for (let x = 0; x < n; x++) {
      const ys = Array.from({ length: n }, (_, i) => i);
      if ((x % 2 === 0) === flip) ys.reverse();
      for (const y of ys) path.push(y * n + x);
    }
  }
  if (Math.random() < 0.5) path.reverse();

  // backbite：从端点咬住路径内相邻格，反转中间段，仍是覆盖全盘的路径
  for (let step = 0; step < 320; step++) {
    const fromStart = Math.random() < 0.5;
    const endpoint = fromStart ? path[0] : path[path.length - 1];
    const x = cellX(n, endpoint), y = cellY(n, endpoint);
    const neighbors = [];
    if (y > 0) neighbors.push(endpoint - n);
    if (x < n - 1) neighbors.push(endpoint + 1);
    if (y < n - 1) neighbors.push(endpoint + n);
    if (x > 0) neighbors.push(endpoint - 1);
    const current = fromStart ? path[1] : path[path.length - 2];
    const choices = neighbors.filter((v) => v !== current);
    if (!choices.length) continue;
    const q = choices[randInt(choices.length)];
    const j = path.indexOf(q);
    if (fromStart) {
      if (j <= 1) continue;
      path = path.slice(0, j).reverse().concat(path.slice(j));
    } else {
      if (j >= path.length - 2) continue;
      path = path.slice(0, j + 1).concat(path.slice(j + 1).reverse());
    }
  }
  return path;
}

function masksOf(cells) {
  return cells.map((c) => rotateMask(c.mask, c.rot));
}

function floodFrom(n, masks, source) {
  const seen = new Array(n * n).fill(false);
  seen[source] = true;
  const queue = [source];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const bit of [N, E, S, W]) {
      if (!(masks[cur] & bit)) continue;
      const next = neighbor(n, cur, bit);
      if (next < 0 || !(masks[next] & OPP[bit]) || seen[next]) continue;
      seen[next] = true;
      queue.push(next);
    }
  }
  return seen;
}

function isSolvedGame(n, cells, source, target) {
  return floodFrom(n, masksOf(cells), source)[target];
}

function randomize(cells, n, source, target) {
  const free = [];
  for (let i = 0; i < cells.length; i++) if (!cells[i].fixed) free.push(i);
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const i of free) cells[i].rot = randInt(4);
    if (!isSolvedGame(n, cells, source, target)) return;
  }
  for (const i of free) {
    const old = cells[i].rot;
    for (let r = 0; r < 4; r++) {
      if (r === old) continue;
      cells[i].rot = r;
      if (!isSolvedGame(n, cells, source, target)) return;
    }
    cells[i].rot = old;
  }
}

function makePathCells(lv) {
  const n = lv.n;
  const path = makeHamiltonPath(n);
  const cells = Array.from({ length: n * n }, () => ({ mask: 0, rot: 0, fixed: false, turns: 0 }));
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    let mask = 0;
    if (k > 0) mask |= neighborBit(n, i, path[k - 1]);
    if (k < path.length - 1) mask |= neighborBit(n, i, path[k + 1]);
    cells[i] = { mask, rot: 0, fixed: k === 0 || k === path.length - 1, turns: 0 };
  }
  const source = path[0];
  const target = path[path.length - 1];
  const interior = path.slice(1, -1);
  for (let i = interior.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [interior[i], interior[j]] = [interior[j], interior[i]];
  }
  const hints = Math.min(lv.hints || 0, interior.length);
  for (let k = 0; k < hints; k++) {
    cells[interior[k]].fixed = true;
    cells[interior[k]].hint = true;
    cells[interior[k]].rot = 0;
  }
  randomize(cells, n, source, target);
  for (const cell of cells) cell.turns = cell.rot;
  return { n, cells, source, target };
}

function makeNetworkCells(lv) {
  const n = lv.n;
  const adj = makeTree(n);
  const ends = pickEnds(n, adj);
  const cells = [];
  for (let i = 0; i < n * n; i++) {
    cells.push({ mask: maskOf(n, adj, i), rot: 0, fixed: i === ends.source || i === ends.target });
  }
  randomize(cells, n, ends.source, ends.target);
  for (const cell of cells) cell.turns = cell.rot;
  return { n, cells, source: ends.source, target: ends.target };
}

function createGame(lv) {
  const made = lv.mode === 'path' ? makePathCells(lv) : makeNetworkCells(lv);
  return {
    lv,
    n: made.n,
    cells: made.cells,
    source: made.source,
    target: made.target,
    solved: false,
    coins: 0,
    onFinish: null,
    fxTimer: 0,
  };
}

function pipeSvg(mask) {
  let wires = '';
  for (const bit of [N, E, S, W]) {
    if (!(mask & bit)) continue;
    const [x, y] = EDGE[bit];
    wires += `<line class="pf-wire" x1="50" y1="50" x2="${x}" y2="${y}"></line>`;
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    ${wires}
    <circle class="pf-joint" cx="50" cy="50" r="8"></circle>
  </svg>`;
}

function cellHtml(cell, i) {
  const isSource = i === _g.source;
  const isTarget = i === _g.target;
  const cls = `pf-cell${cell.fixed ? ' fixed' : ''}${cell.hint ? ' hint' : ''}${isTarget ? ' target' : ''}`;
  const actor = isSource
    ? '<span class="pf-icon"><img class="pf-actor" data-actor="source" alt="电肚蛙"></span>'
    : isTarget
      ? '<span class="pf-icon"><img class="pf-actor" data-actor="target" alt="洛托姆"></span>'
      : '';
  const label = isSource
    ? '电源：电肚蛙'
    : isTarget
      ? '负载：洛托姆'
      : cell.hint
        ? '提示：这根导线已经接好了'
        : '导线';
  const title = (isSource || isTarget || cell.hint) ? ` title="${label}"` : '';
  return `<button type="button" class="${cls}" data-i="${i}"${title} aria-label="${label}">
    <span class="pf-rot" style="transform:rotate(${(cell.turns ?? cell.rot) * 90}deg)">${pipeSvg(cell.mask)}</span>
    ${actor}
  </button>`;
}

function dirKeyOf(cell) {
  const mask = rotateMask(cell.mask, cell.rot);
  if (mask & N) return 'up';
  if (mask & E) return 'right';
  if (mask & S) return 'down';
  return 'left';
}

function fitActor(el, art, dir) {
  const src = art.dirs[dir] || art.dirs.down;
  if (el.dataset.src !== src) {
    el.dataset.src = src;
    tryLoadImage(el, src);
  }
  const icon = el.closest('.pf-icon');
  const box = Math.max(20, Math.min(icon?.clientWidth || 48, icon?.clientHeight || 48) * .98);
  const k = Math.max(.1, box / Math.max(art.w, art.h));
  el.style.width = `${art.w * k}px`;
  el.style.height = `${art.h * k}px`;
  el.style.transform = art.oy ? `translateY(${art.oy * k}px)` : '';
}

function mountActors() {
  const sourceEl = $('pfBoard')?.querySelector('[data-actor="source"]');
  const targetEl = $('pfBoard')?.querySelector('[data-actor="target"]');
  if (!sourceEl || !targetEl) return;
  const sourceDir = dirKeyOf(_g.cells[_g.source]);
  const targetDir = dirKeyOf(_g.cells[_g.target]);
  const targetArt = targetEl.closest('.pf-cell')?.classList.contains('win')
    ? ART.targetOn : ART.targetOff;
  fitActor(sourceEl, ART.source, sourceDir);
  fitActor(targetEl, targetArt, targetDir);
}

function layoutBoard() {
  if (!_g) return;
  const stage = $('pfStage'), board = $('pfBoard');
  if (!stage || !board) return;
  const size = Math.max(96, Math.floor(Math.min(stage.clientWidth, stage.clientHeight) - 4));
  board.style.width = `${size}px`;
  board.style.height = `${size}px`;
  board.style.setProperty('--n', _g.n);
  mountActors();
}

function renderBoard() {
  const board = $('pfBoard');
  if (!board || !_g) return;
  board.classList.remove('done');
  board.innerHTML = _g.cells.map(cellHtml).join('');
  board.onclick = onBoardClick;
  layoutBoard();
  requestAnimationFrame(() => {
    if (_g && getCurrentView() === 'powerFlowView') mountActors();
  });
}


function checkSolved() {
  if (!_g || _g.solved) return;
  const masks = masksOf(_g.cells);
  if (floodFrom(_g.n, masks, _g.source)[_g.target]) finishGame();
}

function energyDistances() {
  const masks = masksOf(_g.cells);
  const dist = new Array(_g.n * _g.n).fill(-1);
  dist[_g.source] = 0;
  const queue = [_g.source];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const bit of [N, E, S, W]) {
      if (!(masks[cur] & bit)) continue;
      const next = neighbor(_g.n, cur, bit);
      if (next < 0 || !(masks[next] & OPP[bit]) || dist[next] >= 0) continue;
      dist[next] = dist[cur] + 1;
      queue.push(next);
    }
  }
  return dist;
}

function finishGame() {
  if (!_g || _g.solved) return;
  _g.solved = true;
  _g.done = true;
  _g.coins = _g.lv.coins;
  playMahjongSfx('ui');
  if (_g.onFinish) {
    try { _g.onFinish(_g.coins, true); } catch (e) { console.error('[电力输送] 结算出错：', e); }
  }
  const dist = energyDistances();
  let maxDist = 0;
  $('pfBoard')?.querySelectorAll('.pf-cell').forEach((el, i) => {
    if (dist[i] < 0) return;
    el.style.setProperty('--d', dist[i]);
    el.classList.add('live');
    if (dist[i] > maxDist) maxDist = dist[i];
  });
  const targetEl = $('pfBoard')?.querySelector(`.pf-cell[data-i="${_g.target}"]`);
  const finished = _g;
  _g.fxTimer = setTimeout(() => {
    if (_g !== finished) return;
    const targetActor = targetEl?.querySelector('.pf-actor');
    if (targetActor) fitActor(targetActor, ART.targetOn, dirKeyOf(_g.cells[_g.target]));
    if (targetEl) targetEl.classList.add('win');
    _g.fxTimer = setTimeout(() => { if (_g === finished) showResult(); }, 800);
  }, maxDist * 55 + 520);
}

function showResult() {
  const board = $('pfBoard');
  if (!board || !_g) return;
  const old = board.querySelector('.pf-result');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'pf-result';
  el.innerHTML = `
    <p class="game-result-title">电力输送完成！</p>
    <p class="game-result-coins"><img src="${COIN_ICON}" alt="">+${_g.coins} 气球</p>
    <div class="game-result-btns">
      <span class="catch-confirm-btn" data-pf="again">再来一局</span>
      <span class="catch-confirm-btn" data-pf="back">返回</span>
    </div>`;
  board.appendChild(el);
  board.classList.add('done');
}

function onBoardClick(e) {
  if (!_g) return;
  if (_g.done) {
    const btn = e.target.closest('[data-pf]');
    if (!btn) return;
    if (btn.dataset.pf === 'again') startPowerFlowGame({ level: _g.lv.id, onFinish: _g.onFinish });
    else leavePowerFlowGame();
    return;
  }
  const cellEl = e.target.closest('.pf-cell');
  if (!cellEl) return;
  const i = Number(cellEl.dataset.i);
  const cell = _g.cells[i];
  if (!cell || cell.fixed) return;
  cell.turns = (cell.turns ?? cell.rot) + 1;
  cell.rot = cell.turns & 3;
  const rotEl = cellEl.querySelector('.pf-rot');
  if (rotEl) rotEl.style.transform = `rotate(${cell.turns * 90}deg)`;
  checkSolved();
}

export function startPowerFlowGame(opts = {}) {
  if (!$('powerFlowView')) return;
  if (_g?.fxTimer) clearTimeout(_g.fxTimer);
  const lv = pfLevelOf(opts.level);
  _g = createGame(lv);
  _g.onFinish = opts.onFinish || null;
  if (getCurrentView() !== 'powerFlowView') pushNav('powerFlowView');
  showView('powerFlowView');
  renderBoard();
}

export function leavePowerFlowGame() {
  if (!_g) return;
  if (_g.fxTimer) clearTimeout(_g.fxTimer);
  _g.done = true;
  _g = null;
  if (getCurrentView() !== 'powerFlowView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');
  });
}

window.addEventListener('resize', () => {
  if (_g && getCurrentView() === 'powerFlowView') layoutBoard();
});
