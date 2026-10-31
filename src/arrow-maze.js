// ===== 箭头迷宫（限时活动小游戏）=====
// 点箭头转向，朝北鼻从起点走到终点：每走到一格，就按那一格的箭头继续走。
// 排好后点「出发」；撞到岩石或边界回起点。岩石随机生成，且保证没有
// 「只朝终点方向走」的直达路线。
import { $, showView, getCurrentView, tryLoadImage } from './ui.js';
import { pushNav, popNav } from './state.js';
import { playMahjongSfx } from './audio.js';
import { fourDirGeom, fourDirAnim, fourDirDelay, fourDirRowBox, DIR_ROW } from './four-dir.js';

export const AM_LEVELS = [
  { id: 'easy', name: '简单', n: 5, coins: 30, minCost: 6, clusters: 2, noLimit: true },
  { id: 'normal', name: '普通', n: 6, coins: 60, slack: 3, minCost: 8, clusters: 3 },
  { id: 'hard', name: '困难', n: 7, coins: 100, slack: 2, minCost: 11, clusters: 4 },
];
export const amLevelOf = (id) => AM_LEVELS.find((l) => l.id === id) || AM_LEVELS[1];

const COIN_ICON = './items/goods/balloon-brown.png';
const NOSE_DEX = 299;
const MOVE_MS = 200;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // 上 右 下 左
const DIR_NAME = ['up', 'right', 'down', 'left'];
const ARROW_SVG = '<svg viewBox="-88 -88 1200 1200" aria-hidden="true"><path d="M512 709.632l-377.856 221.696L512 92.672l377.856 838.656-377.856-221.696z" fill="currentColor"/></svg>';

let _g = null;
let _bound = false;
let _gen = 0;

const idx = (n, x, y) => y * n + x;
const cellOf = (n, i) => [i % n, (i / n) | 0];
const turnCost = (from, to) => (to - from + 4) & 3;   // 顺时针要转几下
const netOf = (c) => (c.dir - c.initDir + 4) & 3;    // 这一格相对初始朝向转了几下
const arrowColor = (c) => (netOf(c) === 0 ? 'var(--am-arrow)' : 'var(--am-arrow-on)');

function stepTo(n, i, d) {
  const [x, y] = cellOf(n, i);
  const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
  if (nx < 0 || nx >= n || ny < 0 || ny >= n) return -1;
  return idx(n, nx, ny);
}

const randInt = (n) => Math.floor(Math.random() * n);

// --- 关卡生成 ---
// 随机撒短墙/拐角/孤立石，再反复堵掉「只朝终点方向走」的捷径（堵了会断路就换一格）。
function paintWallShape(walls, n, a, b) {
  const put = (x, y) => {
    if (x < 0 || x >= n || y < 0 || y >= n) return;
    const i = idx(n, x, y);
    if (i !== a && i !== b) walls.add(i);
  };
  if (Math.random() < 0.3) {                    // 孤立一块
    put(randInt(n), randInt(n));
    return;
  }
  let x = randInt(n);
  let y = randInt(n);
  let dir = randInt(4);
  const len = 2 + randInt(3);
  for (let k = 0; k < len; k++) {
    put(x, y);
    if (k === len - 2 && Math.random() < 0.55) dir = (dir + (Math.random() < 0.5 ? 1 : 3)) & 3;
    x += DIRS[dir][0];
    y += DIRS[dir][1];
  }
}

function reachable(n, walls, a, b) {
  const seen = new Uint8Array(n * n);
  const queue = [a];
  seen[a] = 1;
  for (let h = 0; h < queue.length; h++) {
    const cur = queue[h];
    if (cur === b) return true;
    for (let d = 0; d < 4; d++) {
      const nx = stepTo(n, cur, d);
      if (nx < 0 || walls.has(nx) || seen[nx]) continue;
      seen[nx] = 1;
      queue.push(nx);
    }
  }
  return false;
}

// 只朝终点方向走的捷径（先横后竖、任意楼梯都算）
function monotonePath(n, walls, a, b) {
  const [ax, ay] = cellOf(n, a), [bx, by] = cellOf(n, b);
  const sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
  const moves = [];
  if (sx) moves.push([sx, 0]);
  if (sy) moves.push([0, sy]);
  if (!moves.length) return null;
  const prev = new Map([[a, -1]]);
  const queue = [a];
  for (let h = 0; h < queue.length; h++) {
    const cur = queue[h];
    if (cur === b) break;
    const [x, y] = cellOf(n, cur);
    for (const [dx, dy] of moves) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
      const ni = idx(n, nx, ny);
      if (walls.has(ni) || prev.has(ni)) continue;
      prev.set(ni, cur);
      queue.push(ni);
    }
  }
  if (!prev.has(b)) return null;
  const path = [];
  for (let v = b; v >= 0; v = prev.get(v)) { path.push(v); if (v === a) break; }
  return path.reverse();
}

function cutMonotone(n, walls, a, b) {
  for (let iter = 0; iter < 90; iter++) {
    const path = monotonePath(n, walls, a, b);
    if (!path) return true;
    const cands = path.filter((v) => v !== a && v !== b);
    for (let k = cands.length - 1; k > 0; k--) { const j = randInt(k + 1); [cands[k], cands[j]] = [cands[j], cands[k]]; }
    let done = false;
    for (const v of cands) {
      if (walls.has(v)) continue;
      walls.add(v);
      if (reachable(n, walls, a, b)) { done = true; break; }
      walls.delete(v);
    }
    if (!done) return false;
  }
  return false;
}

function makeBoard(lv) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const n = lv.n;
    const lo = 1, hi = n - 2;                       // 起终点都留一格边，保证有地方绕
    const a = idx(n, lo + randInt(hi - lo + 1), lo + randInt(hi - lo + 1));
    let b = -1;
    for (let k = 0; k < 40 && b < 0; k++) {
      const cand = idx(n, lo + randInt(hi - lo + 1), lo + randInt(hi - lo + 1));
      const [ax, ay] = cellOf(n, a), [bx, by] = cellOf(n, cand);
      if (cand !== a && Math.abs(bx - ax) + Math.abs(by - ay) >= n - 1) b = cand;
    }
    if (b < 0) continue;

    const walls = new Set();
    for (let c = 0; c < lv.clusters; c++) paintWallShape(walls, n, a, b);
    if (!reachable(n, walls, a, b)) continue;
    if (!cutMonotone(n, walls, a, b)) continue;

    const cells = Array.from({ length: n * n }, () => ({ wall: false, dir: 0, initDir: 0, turns: 0 }));
    for (const w of walls) cells[w].wall = true;
    // 起点固定成第一步，其余随机
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].wall) continue;
      cells[i].initDir = randInt(4);
      cells[i].dir = cells[i].initDir;
      cells[i].turns = cells[i].initDir;
    }
    const exits = [];
    for (let d = 0; d < 4; d++) {
      const v = stepTo(n, a, d);
      if (v >= 0 && !cells[v].wall) exits.push(d);
    }
    if (!exits.length) continue;
    cells[a].initDir = exits[randInt(exits.length)];
    cells[a].dir = cells[a].initDir;
    cells[a].turns = cells[a].initDir;

    const best = bestRoute(n, cells, a, b);
    if (!best || best.cost < lv.minCost) continue;
    if (best.route.length - 1 < n) continue;                          // 路线太短，一眼就看穿
    if (best.route.some((v, k) => best.route.indexOf(v) !== k)) continue;
    if (!follows(n, cells, a, b, best.route)) continue;
    if (solves(n, cells, a, b)) continue;                             // 别一开局就已经通了

    return {
      n, cells, start: a, goal: b,
        min: best.cost,
      budget: lv.noLimit ? Infinity : best.cost + lv.slack,   // 简单档不限转动次数
    };
  }
  return fallbackBoard(lv);
}

// 最省转动路线：边权 = 这一格的箭头转到「走出这一步」要点几下（起点固定、终点不计费）。
function bestRoute(n, cells, start, goal) {
  const total = n * n;
  const dist = new Array(total).fill(Infinity);
  const prev = new Array(total).fill(-1);
  const done = new Uint8Array(total);
  dist[start] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < total; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    if (u === goal) break;
    for (let d = 0; d < 4; d++) {
      const v = stepTo(n, u, d);
      if (v < 0 || cells[v].wall) continue;
      const cost = (u === start) ? (cells[u].initDir === d ? 0 : Infinity) : turnCost(cells[u].initDir, d);
      if (cost === Infinity) continue;
      if (dist[u] + cost < dist[v]) { dist[v] = dist[u] + cost; prev[v] = u; }
    }
  }
  if (!Number.isFinite(dist[goal])) return null;
  const route = [];
  for (let v = goal; v >= 0; v = prev[v]) route.push(v);
  route.reverse();
  return { cost: dist[goal], route };
}

// 按 route 摆好箭头后，朝北鼻是否真的能一路走到终点
function follows(n, cells, start, goal, route) {
  const want = new Map();
  for (let k = 0; k < route.length - 1; k++) {
    const u = route[k], v = route[k + 1];
    let d = -1;
    for (let x = 0; x < 4; x++) if (stepTo(n, u, x) === v) d = x;
    if (d < 0) return false;
    if (u === start) { if (cells[u].initDir !== d) return false; }
    else want.set(u, d);
  }
  let pos = start, dir = cells[start].initDir;
  for (let k = 0; k < n * n * 3; k++) {
    const nx = stepTo(n, pos, dir);
    if (nx < 0 || cells[nx].wall) return false;
    pos = nx;
    if (pos === goal) return k + 1 <= route.length - 1;
    dir = want.has(pos) ? want.get(pos) : cells[pos].initDir;
  }
  return false;
}

function solves(n, cells, start, goal) {
  let pos = start, dir = cells[start].initDir;
  for (let k = 0; k < n * n * 3; k++) {
    const nx = stepTo(n, pos, dir);
    if (nx < 0 || cells[nx].wall) return false;
    pos = nx;
    if (pos === goal) return true;
    dir = cells[pos].dir;
  }
  return false;
}

function fallbackBoard(lv) {
  const n = lv.n;
  const cells = Array.from({ length: n * n }, () => ({ wall: false, dir: 0, initDir: 0, turns: 0 }));
  const start = idx(n, 1, 1), goal = idx(n, n - 2, n - 2);
  const cx = Math.max(2, Math.floor(n / 2));
  for (let y = 1; y <= n - 2; y++) cells[idx(n, cx, y)].wall = true;
  for (let i = 0; i < n * n; i++) if (!cells[i].wall && i !== start) {
    cells[i].initDir = randInt(4);
    cells[i].dir = cells[i].initDir;
    cells[i].turns = cells[i].initDir;
  }
  cells[start].initDir = 0;
  cells[start].dir = 0;
  cells[start].turns = 0;
  const best = bestRoute(n, cells, start, goal);
  return { n, cells, start, goal, min: best ? best.cost : 8,
    budget: lv.noLimit ? Infinity : (best ? best.cost : 8) + lv.slack };
}

// --- 运行状态 ---
function initGame(lv, board, onFinish) {
  _gen += 1;
  _g = {
    lv,
    n: board.n,
    cells: board.cells,
    start: board.start,
    goal: board.goal,
    pos: board.start,
    dir: board.cells[board.start].initDir,
    min: board.min,
    budget: board.budget,
    rot: 0,
    steps: 0,
    history: [],
    walking: false,
    seen: null,
    done: false,
    gen: _gen,
    cell: 40,
    gap: 2,
    sprites: null,
    onFinish: onFinish || null,
  };
  const boardEl = $('amBoard');
  if (boardEl) boardEl.classList.remove('done');
  setResultHeader(false);
  renderHead();
  renderBoard();
  renderControls();
}

// 四向素材几何：查 meta，查不到就退回 0299 的实测值（免得整块不显示）
const NOSE_FILE = '0299-朝北鼻.png';
function noseGeom() {
  const g = fourDirGeom(NOSE_DEX);
  return {
    raw: g,
    file: (g && g.file) || NOSE_FILE,
    walk: fourDirAnim(g, 'walk') || { w: 35, h: 39, n: 4, d: [8, 10, 8, 10] },
    idle: fourDirAnim(g, 'idle') || { w: 35, h: 39, n: 8, d: [30, 6, 4, 4, 4, 4, 4, 6] },
  };
}

function renderBoard() {
  const area = $('amBoard');
  if (!area || !_g) return;
  const availW = area.clientWidth || 220;
  const availH = area.clientHeight || 220;
  let cell = Math.floor(Math.min((availW - 8 - _g.gap * (_g.n - 1)) / _g.n, (availH - 8 - _g.gap * (_g.n - 1)) / _g.n));
  if (!Number.isFinite(cell) || cell < 18) cell = 34;
  _g.cell = Math.min(56, cell);
  const size = _g.cell * _g.n + _g.gap * (_g.n - 1);

  const grid = document.createElement('div');
  grid.className = 'sl-grid';
  grid.style.width = `${size}px`;
  grid.style.height = `${size}px`;
  grid.style.gridTemplateColumns = `repeat(${_g.n}, ${_g.cell}px)`;
  grid.style.gridTemplateRows = `repeat(${_g.n}, ${_g.cell}px)`;
  grid.style.gap = `${_g.gap}px`;

  const cells = [];
  for (let i = 0; i < _g.n * _g.n; i++) {
    const cellData = _g.cells[i];
    const cls = ['sl-cell'];
    if (cellData.wall) cls.push('wall');
    if (i === _g.start) cls.push('start');
    if (i === _g.goal) cls.push('target');
    const inner = cellData.wall
      ? ''
      : i === _g.goal
        ? '<img class="sl-ball" data-src="items/balls/poke-ball.png" style="width:62%;height:62%" alt="终点">'
        : `<span class="pf-rot" style="transform:rotate(${(cellData.turns || 0) * 90}deg);color:${arrowColor(cellData)}">${ARROW_SVG}</span>`;
    cells.push(`<div class="${cls.join(' ')}" data-i="${i}">${inner}</div>`);
  }
  const geom = noseGeom();
  const row = DIR_ROW[DIR_NAME[_g.dir]] ?? 0;
  // 按可见内容框缩放（四向帧四周留白很多，按整帧算会显得很小）
  const bb = geom.raw ? fourDirRowBox(geom.raw, 'walk') : null;
  const contentH = bb ? Math.max(1, bb[3] - bb[1] + 1) : 25;
  const k = (_g.cell * 0.84) / contentH;
  const [sx, sy] = cellOf(_g.n, _g.pos);
  const st = `width:${geom.walk.w}px;height:${geom.walk.h}px;max-width:none;max-height:none;`
    + `object-fit:none;transform-origin:center;transform:scale(${k});object-position:0px -${row * geom.walk.h}px`;
  const frame = `left:${sx * (_g.cell + _g.gap)}px;top:${sy * (_g.cell + _g.gap)}px;`
    + `width:${_g.cell}px;height:${_g.cell}px;pointer-events:none`;
  const walker = `<div class="sl-piece" id="amWalker" style="${frame}">`
    + `<img class="sl-sprite idle on" id="amWalkIdle" data-anim="idle" style="${st}" alt="朝北鼻">`
    + `<img class="sl-sprite walk" id="amWalkMove" data-anim="walk" style="${st}" alt="朝北鼻"></div>`;
  grid.innerHTML = cells.join('') + walker;
  area.innerHTML = '';
  area.appendChild(grid);
  grid.querySelectorAll('.sl-ball').forEach((img) => tryLoadImage(img, img.dataset.src));
  grid.querySelectorAll('.sl-sprite').forEach((img) => {
    const rel = `pokemon-data/pokemon-4dir/${img.dataset.anim}/${geom.file}`;
    // 路径写法与随从一致；首次没取到再按 ./ 形式补一次
    tryLoadImage(img, rel).then((ok) => { if (!ok) tryLoadImage(img, `./${rel}`); });
  });
  _g.sprites = {
    walk: geom.walk, idle: geom.idle,
    idleEl: grid.querySelector('#amWalkIdle'),
    walkEl: grid.querySelector('#amWalkMove'),
    row, frame: 0, next: 0, anim: 'idle',
  };
  placeWalker(true);
}

function placeWalker(instant) {
  const el = $('amWalker');
  if (!el || !_g) return;
  const grid = el.parentElement;
  const [x, y] = cellOf(_g.n, _g.pos);
  if (instant && grid) grid.classList.add('no-trans');
  el.style.left = `${x * (_g.cell + _g.gap)}px`;
  el.style.top = `${y * (_g.cell + _g.gap)}px`;
  el.style.width = `${_g.cell}px`;
  el.style.height = `${_g.cell}px`;
  if (instant && grid) { void grid.offsetWidth; grid.classList.remove('no-trans'); }
}

function setWalkerRow(dir) {
  const s = _g && _g.sprites;
  if (!s) return;
  const row = DIR_ROW[DIR_NAME[dir]] ?? 0;
  if (row === s.row) return;
  s.row = row;
  s.frame = 0;
  s.next = 0;
  const pos = `0px -${row * s.walk.h}px`;
  s.idleEl.style.objectPosition = pos;
  s.walkEl.style.objectPosition = pos;
}

function tickSprites() {
  const s = _g && _g.sprites;
  if (!s) return;
  const now = performance.now();
  if (now < s.next) return;
  const anim = s.anim === 'walk' ? s.walk : s.idle;
  const el = s.anim === 'walk' ? s.walkEl : s.idleEl;
  el.style.objectPosition = `-${s.frame * anim.w}px -${s.row * anim.h}px`;
  s.next = now + fourDirDelay(anim, s.frame);
  s.frame = (s.frame + 1) % anim.n;
}

function setWalkAnim(on) {
  const s = _g && _g.sprites;
  if (!s) return;
  const name = on ? 'walk' : 'idle';
  if (s.anim === name) return;
  s.anim = name;
  s.frame = 0;
  s.next = 0;
  s.idleEl.classList.toggle('on', !on);
  s.walkEl.classList.toggle('on', on);
  s.idleEl.style.objectPosition = `0px -${s.row * s.walk.h}px`;
  s.walkEl.style.objectPosition = `0px -${s.row * s.walk.h}px`;
}

setInterval(() => {
  if (!_g || getCurrentView() !== 'arrowView') return;
  tickSprites();
}, 60);

// --- 界面 ---
function renderHead() {
  if (!_g) return;
  const rot = $('amRot');
  if (rot) rot.textContent = Number.isFinite(_g.budget) ? `转动 ${_g.rot}/${_g.budget}` : `转动 ${_g.rot}`;
}

// 结算时收起操作按钮，中间显示难度名（同海豹滑冰的 setResultHeader）
function setResultHeader(on) {
  const level = $('amLevel');
  if (level) {
    level.hidden = !on;
    level.textContent = on ? _g.lv.name : '';
  }
  const actions = $('amActions');
  if (actions) actions.hidden = !!on;
}

function renderControls() {
  if (!_g) return;
  const busy = _g.walking || _g.done;
  $('amUndo')?.classList.toggle('off', busy || !_g.history.length);
  $('amReset')?.classList.toggle('off', busy);
  $('amNew')?.classList.toggle('off', busy);
  $('amGo')?.classList.toggle('off', busy || _g.done || _g.rot > _g.budget);
}

function onCellClick(i) {
  if (!_g || _g.walking || _g.done) return;
  const c = _g.cells[i];
  if (!c || c.wall || i === _g.start || i === _g.goal) return;
  // 计数按「离初始朝向差几下」：转满 4 下回到原样，净变化是 -3 而不是 +1。
  // 允许超出上限（多转几下也许又能减回来），超了只禁「出发」
  const delta = netOf(c) === 3 ? -3 : 1;
  _g.history.push({ i, dir: c.dir, turns: c.turns });
  c.dir = (c.dir + 1) & 3;
  c.turns = (c.turns || 0) + 1;
  _g.rot += delta;
  playMahjongSfx('ui');
  paintCell(i);
  renderHead();
  renderControls();
}

function paintCell(i) {
  const grid = $('amBoard')?.querySelector('.sl-grid');
  const el = grid?.querySelector(`.sl-cell[data-i="${i}"] .pf-rot`);
  const c = _g?.cells[i];
  if (el && c) {
    el.style.transform = `rotate(${(c.turns || 0) * 90}deg)`;
    el.style.color = arrowColor(c);
  }
}

function undo() {
  if (!_g || _g.walking || _g.done || !_g.history.length) return;
  const last = _g.history.pop();
  const c = _g.cells[last.i];
  _g.rot -= netOf(c);
  c.dir = last.dir;
  c.turns = last.turns;
  _g.rot += netOf(c);
  playMahjongSfx('ui');
  paintCell(last.i);
  renderHead();
  renderControls();
}

function resetBoard() {
  if (!_g || _g.walking) return;
  for (const c of _g.cells) {
    if (c.wall) continue;
    c.dir = c.initDir;
    c.turns = c.initDir;
  }
  _g.rot = 0;
  _g.steps = 0;
  _g.history = [];
  _g.pos = _g.start;
  _g.dir = _g.cells[_g.start].initDir;
  _g.done = false;
  const board = $('amBoard');
  if (board) board.classList.remove('done');
  setResultHeader(false);
  renderBoard();
  renderHead();
  renderControls();
}

function newBoard() {
  if (!_g || _g.walking) return;
  const lv = _g.lv;
  const cb = _g.onFinish;
  initGame(lv, makeBoard(lv), cb);
}

function startWalk() {
  if (!_g || _g.walking || _g.done || _g.rot > _g.budget) return;
  _g.walking = true;
  _g.steps = 0;
  _g.pos = _g.start;
  _g.dir = _g.cells[_g.start].initDir;
  _g.seen = new Set();
  placeWalker(true);
  setWalkerRow(_g.dir);
  setWalkAnim(true);
  renderHead();
  renderControls();
  const gen = _g.gen;
  setTimeout(() => {
    if (!_g || _g.gen !== gen || !_g.walking) return;
    walkStep();
  }, 120);
}

function walkStep() {
  if (!_g || !_g.walking) return;
  if (getCurrentView() !== 'arrowView') { stopWalk(); return; }
  const n = _g.n;
  // 位置 + 朝向重复 = 一定在绕圈，立刻停，别等步数上限
  const state = `${_g.pos}:${_g.dir}`;
  if (_g.seen.has(state)) { bump(); return; }
  _g.seen.add(state);
  const next = stepTo(n, _g.pos, _g.dir);
  if (next < 0 || _g.cells[next].wall) { bump(); return; }
  _g.pos = next;
  _g.steps += 1;
  setWalkerRow(_g.dir);
  placeWalker(false);
  renderHead();
  const gen = _g.gen;
  setTimeout(() => {
    if (!_g || _g.gen !== gen || !_g.walking) return;
    if (_g.pos === _g.goal) { winGame(); return; }
    _g.dir = _g.cells[_g.pos].dir;
    if (_g.steps > n * n * 3) { bump(); return; }
    walkStep();
  }, MOVE_MS + 20);
}

function stopWalk() {
  if (!_g) return;
  _g.walking = false;
  setWalkAnim(false);
  renderControls();
}

function bump() {
  if (!_g) return;
  _g.walking = false;
  _g.pos = _g.start;
  _g.dir = _g.cells[_g.start].initDir;
  _g.steps = 0;
  setWalkAnim(false);
  placeWalker(true);
  setWalkerRow(_g.dir);
  renderHead();
  renderControls();
}

function winGame() {
  if (!_g || _g.done) return;
  _g.walking = false;
  _g.done = true;
  _g.coins = _g.lv.coins;
  setWalkAnim(false);
  playMahjongSfx('ui');
  if (_g.onFinish) {
    try { _g.onFinish(_g.coins, true); } catch (e) { console.error('[箭头迷宫] 结算出错：', e); }
  }
  renderHead();
  renderControls();
  showResult();
}

function showResult() {
  const board = $('amBoard');
  if (!board || !_g) return;
  board.classList.add('done');
  setResultHeader(true);
  renderControls();
  board.innerHTML = `<div class="sl-result">
    <p class="game-result-title">完成</p>
    <p class="sl-result-sub">转动 ${_g.rot} 次 · 最少 ${_g.min} 次</p>
    <p class="game-result-coins"><img src="${COIN_ICON}" alt="">+${_g.coins} 气球</p>
    <div class="game-result-btns">
      <span class="catch-confirm-btn" data-am="again">再来一局</span>
      <span class="catch-confirm-btn" data-am="back">返回</span>
    </div>
  </div>`;
}

function onBoardClick(e) {
  if (!_g) return;
  if (_g.done) {
    const btn = e.target.closest('[data-am]');
    if (!btn) return;
    if (btn.dataset.am === 'again') { const lv = _g.lv, cb = _g.onFinish; initGame(lv, makeBoard(lv), cb); }
    else leaveArrowGame();
    return;
  }
  const cell = e.target.closest('.sl-cell');
  if (!cell) return;
  onCellClick(Number(cell.dataset.i));
}

function bindUI() {
  if (_bound) return;
  _bound = true;
  $('amBoard').addEventListener('click', onBoardClick);
  $('amUndo').addEventListener('click', undo);
  $('amReset').addEventListener('click', resetBoard);
  $('amNew').addEventListener('click', newBoard);
  $('amGo').addEventListener('click', startWalk);
  window.addEventListener('resize', () => {
    if (_g && !_g.done && getCurrentView() === 'arrowView') renderBoard();
  });
}

export function startArrowGame(opts = {}) {
  if (!$('arrowView')) return;
  if (getCurrentView() !== 'arrowView') pushNav('arrowView');
  showView('arrowView');
  const lv = amLevelOf(opts.level);
  initGame(lv, makeBoard(lv), opts.onFinish);
  if (!_bound) bindUI();
  requestAnimationFrame(() => {
    if (_g && getCurrentView() === 'arrowView') renderBoard();
  });
}

export function leaveArrowGame() {
  if (_g && !_g.done && _g.onFinish) {
    try { _g.onFinish(0, false); } catch (e) { console.error('[箭头迷宫] 结算出错：', e); }
  }
  _g = null;
  if (getCurrentView() !== 'arrowView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');
  });
}
