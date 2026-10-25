// ===== 海豹滑冰 =====
// 限时活动「海豹滑冰」：点宝可梦选中，再点同排/同列的格子，它会一直滑到
// 冰墙或另一只宝可梦才停。让海豹球正好停在所有精灵球上。
// 每局本地随机生成，BFS 验证有解并筛掉过短/过长的盘面。
import { $, showView, getCurrentView, tryLoadImage } from './ui.js';
import { pushNav, popNav } from './state.js';
import { playMahjongSfx } from './audio.js';

export const SL_LEVELS = [
  { id: 'easy',   name: '简单', targets: 1, minMin: 3, minMax: 5, extra: 4, coins: 30 },
  { id: 'normal', name: '普通', targets: 2, minMin: 4, minMax: 7, extra: 3, coins: 70 },
  { id: 'hard',   name: '困难', targets: 3, minMin: 5, minMax: 9, extra: 2, coins: 130 },
];
export const slLevelOf = (id) => SL_LEVELS.find(l => l.id === id) || SL_LEVELS[1];

const N = 6;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SPRITES = [
  { file: '0363-海豹球.png', w: 31, h: 27, walk: { n: 6, ms: 110 }, idle: { n: 6, ms: 180 } },
  { file: '0713-冰岩怪.png', w: 58, h: 41, walk: { n: 4, ms: 150 }, idle: { n: 4, ms: 220 } },
];

let _g = null;
let _bound = false;

const rc = i => [Math.floor(i / N), i % N];
const idx = (r, c) => r * N + c;
const keyOf = (pos, mask) => `${pos.join(',')}|${mask}`;
const shuffle = (list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function slide(positions, mover, dr, dc, walls) {
  let [r, c] = rc(positions[mover]);
  let dist = 0;
  for (;;) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= N || nc < 0 || nc >= N) break;
    const ni = idx(nr, nc);
    if (walls.has(ni)) break;
    if (positions.some((p, j) => j !== mover && p === ni)) break;
    r = nr;
    c = nc;
    dist++;
  }
  if (!dist) return null;
  const next = positions.slice();
  next[mover] = idx(r, c);
  return { positions: next, dist };
}

function bfs(positions, walls, targets, maxMoves) {
  const targetAt = new Map(targets.map((t, i) => [t, i]));
  const full = (1 << targets.length) - 1;
  const queue = [{ pos: positions.slice(), mask: 0, d: 0 }];
  const seen = new Set([keyOf(positions, 0)]);
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur.mask === full) return cur.d;
    if (cur.d >= maxMoves) continue;
    for (let m = 0; m < cur.pos.length; m++) {
      for (const [dr, dc] of DIRS) {
        const moved = slide(cur.pos, m, dr, dc, walls);
        if (!moved) continue;
        let mask = cur.mask;
        if (m === 0 && targetAt.has(moved.positions[0])) mask |= 1 << targetAt.get(moved.positions[0]);
        if (mask === full) return cur.d + 1;
        const k = keyOf(moved.positions, mask);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ pos: moved.positions, mask, d: cur.d + 1 });
      }
    }
  }
  return Infinity;
}

function solve(positions, walls, targets, maxMoves = 40) {
  const targetAt = new Map(targets.map((t, i) => [t, i]));
  const full = (1 << targets.length) - 1;
  const start = { pos: positions.slice(), mask: 0, d: 0, parent: null, move: null };
  const queue = [start];
  const seen = new Set([keyOf(positions, 0)]);
  const pathFrom = (node) => {
    const out = [];
    for (let n = node; n.parent; n = n.parent) out.push(n.move);
    return out.reverse();
  };
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur.mask === full) return pathFrom(cur);
    if (cur.d >= maxMoves) continue;
    for (let m = 0; m < cur.pos.length; m++) {
      for (const [dr, dc] of DIRS) {
        const moved = slide(cur.pos, m, dr, dc, walls);
        if (!moved) continue;
        let mask = cur.mask;
        if (m === 0 && targetAt.has(moved.positions[0])) mask |= 1 << targetAt.get(moved.positions[0]);
        const k = keyOf(moved.positions, mask);
        if (seen.has(k)) continue;
        seen.add(k);
        const node = { pos: moved.positions, mask, d: cur.d + 1, parent: cur, move: { mover: m, dr, dc } };
        if (mask === full) return pathFrom(node);
        queue.push(node);
      }
    }
  }
  return null;
}

function generateBoard(lv) {
  let best = null;
  for (let tries = 0; tries < 400; tries++) {
    const wallChance = tries < 260 ? 0.18 : 0.1;
    const walls = new Set();
    for (let i = 0; i < N * N; i++) if (Math.random() < wallChance) walls.add(i);
    const free = [...Array(N * N).keys()].filter(i => !walls.has(i));
    if (free.length < 2 + lv.targets) continue;
    const pool = shuffle(free);
    const positions = [pool[0], pool[1]];
    const targets = pool.slice(2, 2 + lv.targets);
    const min = bfs(positions, walls, targets, 14);
    if (!Number.isFinite(min)) continue;
    if (!best || min > best.min) best = { walls, positions, targets, min };
    if (min >= lv.minMin && min <= lv.minMax) return { walls, positions, targets, min };
  }
  if (best) return best;
  // 兜底：无墙盘面，海豹球先撞左边界拿 0 号目标，再沿底边拿其余目标
  const positions = [1, 5];
  const targets = [30, 35, 0].slice(0, lv.targets);
  const min = bfs(positions, new Set(), targets, 14);
  return { walls: new Set(), positions, targets, min: Number.isFinite(min) ? min : 3 };
}

export function startSealGame(opts = {}) {
  const lv = slLevelOf(opts.level);
  pushNav('sealView');
  showView('sealView');
  initBoard(lv, generateBoard(lv), opts.onFinish || null);
  if (!_bound) bindUI();
  requestAnimationFrame(() => {
    if (_g && getCurrentView() === 'sealView') renderBoard();
  });
}

function initBoard(lv, board, onFinish) {
  _g = {
    lv,
    board,
    positions: board.positions.slice(),
    targets: board.targets,
    collected: new Set(),
    steps: 0,
    dirs: board.positions.map(() => [1, 0]),
    selected: 0,
    busy: false,
    done: false,
    failed: false,
    history: [],
    demo: false,
    voided: false,
    answerPath: null,
    answerStep: 0,
    answerTotal: 0,
    cell: 32,
    gap: 2,
    sprites: [],
    onFinish,
    min: board.min,
    budget: Math.max(board.min + lv.extra, board.min + 1),
  };
  _g.initial = {
    positions: _g.positions.slice(),
    dirs: _g.dirs.map(d => d.slice()),
  };
  const boardEl = $('slBoard');
  if (boardEl) boardEl.classList.remove('done');
  setResultHeader(false);
  hideOverlay();
  renderHead();
  renderBoard();
  renderControls();
}

function bindUI() {
  if (_bound) return;
  _bound = true;
  $('slBoard').addEventListener('click', onBoardClick);
  $('slBoard').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sl]');
    if (!btn || !_g || !_g.done) return;
    const lv = _g.lv;
    const cb = _g.onFinish;
    if (btn.dataset.sl === 'again') initBoard(lv, generateBoard(lv), cb);
    else leaveSealGame();
  });
  $('slUndo').addEventListener('click', undo);
  $('slReset').addEventListener('click', () => { if (_g && !_g.busy) resetBoard(); });
  $('slNew').addEventListener('click', () => { if (_g && !_g.busy) newBoard(); });
  $('slOverlay').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sl]');
    if (!btn || !_g) return;
    if (btn.dataset.sl === 'retry') { hideOverlay(); resetBoard(); return; }
    if (btn.dataset.sl === 'answer') { startAnswer(); return; }
    leaveSealGame();
  });
  window.addEventListener('resize', () => {
    if (_g && !_g.done && getCurrentView() === 'sealView') renderBoard();
  });
}

function renderHead() {
  $('slSteps').textContent = _g.demo
    ? `答案 ${_g.answerStep}/${_g.answerTotal}`
    : `步数 ${_g.steps}/${_g.budget}`;
  $('slBalls').textContent = `精灵球 ${_g.collected.size}/${_g.targets.length}`;
}

function renderControls() {
  const blocked = !!_g.busy || !!_g.demo;
  $('slReset').textContent = _g.failed ? '重试' : '重置';
  $('slUndo').classList.toggle('off', blocked || _g.done || !_g.history.length);
  $('slReset').classList.toggle('off', blocked);
  $('slNew').classList.toggle('off', blocked);
}

function setResultHeader(on) {
  const level = $('slLevel');
  if (level) {
    level.hidden = !on;
    level.textContent = on ? _g.lv.name : '';
  }
  $('slBalls').hidden = !!on;
  $('slActions').hidden = !!on;
}

function hideOverlay() {
  const el = $('slOverlay');
  if (el) el.hidden = true;
}

function showFailureOverlay() {
  $('slOverlayTitle').textContent = '步数用尽';
  $('slAnswer').hidden = false;
  setResultHeader(true);
  $('slOverlay').hidden = false;
}

function showDemoDone() {
  $('slOverlayTitle').textContent = '演示完成';
  $('slAnswer').hidden = true;
  setResultHeader(true);
  $('slOverlay').hidden = false;
}

function startAnswer() {
  if (!_g) return;
  const path = solve(_g.initial.positions, _g.board.walls, _g.targets, 40);
  if (!path || !path.length) { hideOverlay(); return; }
  hideOverlay();
  resetBoard();
  _g.voided = true;
  _g.demo = true;
  _g.done = true;
  _g.answerPath = path;
  _g.answerStep = 0;
  _g.answerTotal = path.length;
  renderHead();
  renderControls();
  setTimeout(demoStep, 250);
}

function demoStep() {
  if (!_g || !_g.demo) return;
  const step = _g.answerPath[_g.answerStep];
  if (!step) { endDemo(); return; }
  const moved = slide(_g.positions, step.mover, step.dr, step.dc, _g.board.walls);
  if (!moved) { endDemo(); return; }
  _g.positions = moved.positions;
  _g.dirs[step.mover] = [step.dr, step.dc];
  _g.selected = step.mover;
  _g.busy = true;
  const sprite = _g.sprites[step.mover];
  const pieceEl = sprite && sprite.piece;
  const moveMs = sprite ? Math.max(180, moved.dist * sprite.geom.walk.ms) : 230;
  if (sprite) sprite.moving = true;
  if (pieceEl) pieceEl.style.transitionDuration = `${moveMs}ms`;
  const targetAt = step.mover === 0
    ? (_g.targets.find(t => t === _g.positions[0] && !_g.collected.has(t)) ?? null)
    : null;
  updatePieces();
  renderHead();
  setTimeout(() => {
    if (!_g || !_g.demo) return;
    if (sprite) sprite.moving = false;
    if (pieceEl) pieceEl.style.transitionDuration = '0.2s';
    if (targetAt != null) {
      _g.collected.add(targetAt);
      refreshTargets();
    }
    _g.answerStep++;
    _g.busy = false;
    renderHead();
    if (_g.answerStep >= _g.answerPath.length) { endDemo(); return; }
    setTimeout(demoStep, 160);
  }, moveMs + 50);
}

function endDemo() {
  if (!_g) return;
  _g.demo = false;
  _g.done = true;
  _g.busy = false;
  _g.answerPath = null;
  renderHead();
  renderControls();
  showDemoDone();
}

function renderBoard() {
  const area = $('slBoard');
  if (!area || !_g) return;
  const gap = 2;
  const availW = area.clientWidth || 220;
  const availH = area.clientHeight || 220;
  let cell = Math.floor(Math.min((availW - 8 - gap * (N - 1)) / N, (availH - 8 - gap * (N - 1)) / N));
  if (!Number.isFinite(cell) || cell < 16) cell = 30;
  cell = Math.min(44, cell);
  _g.cell = cell;
  _g.gap = gap;
  const size = cell * N + gap * (N - 1);
  const grid = document.createElement('div');
  grid.className = 'sl-grid';
  grid.style.width = `${size}px`;
  grid.style.height = `${size}px`;
  grid.style.gridTemplateColumns = `repeat(${N}, ${cell}px)`;
  grid.style.gridTemplateRows = `repeat(${N}, ${cell}px)`;
  grid.style.gap = `${gap}px`;

  const cells = [];
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i);
    const wall = _g.board.walls.has(i);
    const target = _g.targets.includes(i);
    cells.push(`<div class="sl-cell${wall ? ' wall' : ''}${target ? ' target' : ''}" data-i="${i}" data-r="${r}" data-c="${c}">${target ? '<img class="sl-ball" data-src="items/balls/poke-ball.png" alt="">' : ''}</div>`);
  }
  const pieces = _g.positions.map((pos, i) => {
    const [r, c] = rc(pos);
    const s = SPRITES[i];
    const scale = Math.max(0.2, Math.min((cell - 4) / s.w, (cell - 4) / s.h));
    const row = rowOf(_g.dirs[i] || [1, 0]);
    const style = `width:${s.w}px;height:${s.h}px;transform:scale(${scale});object-position:0px -${row * s.h}px`;
    return `<div class="sl-piece${i === _g.selected ? ' sel' : ''}" data-mover="${i}" style="left:${c * (cell + gap)}px;top:${r * (cell + gap)}px;width:${cell}px;height:${cell}px">
      <span class="sl-foot"></span>
      <img class="sl-sprite idle on" data-spr="${i}" data-anim="idle" style="${style}" alt="">
      <img class="sl-sprite walk" data-spr="${i}" data-anim="walk" style="${style}" alt="">
    </div>`;
  });
  grid.innerHTML = cells.join('') + pieces.join('');
  area.replaceChildren(grid);

  grid.querySelectorAll('.sl-ball').forEach(img => tryLoadImage(img, img.dataset.src));
  grid.querySelectorAll('.sl-sprite').forEach((img) => {
    const i = Number(img.dataset.spr);
    tryLoadImage(img, `pokemon-data/pokemon-4dir/${img.dataset.anim}/${SPRITES[i].file}`);
  });
  _g.sprites = _g.positions.map((_, i) => ({
    idx: i, geom: SPRITES[i],
    idle: grid.querySelector(`.sl-sprite[data-spr="${i}"][data-anim="idle"]`),
    walk: grid.querySelector(`.sl-sprite[data-spr="${i}"][data-anim="walk"]`),
    piece: grid.querySelector(`.sl-piece[data-mover="${i}"]`),
    row: rowOf(_g.dirs[i] || [1, 0]), frame: 0, next: 0, anim: 'idle', moving: false,
  }));
  refreshTargets();
  updatePieces();
}

function refreshTargets() {
  const grid = $('slBoard')?.querySelector('.sl-grid');
  if (!grid) return;
  _g.targets.forEach((t) => {
    const cell = grid.querySelector(`.sl-cell[data-i="${t}"]`);
    if (!cell) return;
    cell.classList.toggle('done', _g.collected.has(t));
  });
}

function updatePieces() {
  const grid = $('slBoard')?.querySelector('.sl-grid');
  if (!grid) return;
  _g.positions.forEach((pos, i) => {
    const el = grid.querySelector(`.sl-piece[data-mover="${i}"]`);
    if (!el) return;
    const [r, c] = rc(pos);
    el.style.left = `${c * (_g.cell + _g.gap)}px`;
    el.style.top = `${r * (_g.cell + _g.gap)}px`;
    el.classList.toggle('sel', _g.selected === i);
  });
}

function onBoardClick(e) {
  if (!_g || _g.busy || _g.done) return;
  const piece = e.target.closest('.sl-piece');
  if (piece) {
    _g.selected = Number(piece.dataset.mover);
    updatePieces();
    return;
  }
  const cell = e.target.closest('.sl-cell');
  if (!cell) return;
  tryMove(Number(cell.dataset.r), Number(cell.dataset.c));
}

function tryMove(r, c) {
  if (!_g || _g.busy || _g.done) return;
  const mover = _g.selected;
  const [pr, pc] = rc(_g.positions[mover]);
  if (r === pr && c === pc) return;
  if (r !== pr && c !== pc) return;
  const dr = Math.sign(r - pr);
  const dc = Math.sign(c - pc);
  const moved = slide(_g.positions, mover, dr, dc, _g.board.walls);
  if (!moved) return;

  _g.history.push(snapshot());
  _g.positions = moved.positions;
  _g.dirs[mover] = [dr, dc];
  _g.steps++;
  _g.busy = true;

  const sprite = _g.sprites[mover];
  const pieceEl = sprite && sprite.piece;
  const moveMs = sprite ? Math.max(180, moved.dist * sprite.geom.walk.ms) : 230;
  const game = _g;
  if (sprite) sprite.moving = true;
  if (pieceEl) pieceEl.style.transitionDuration = `${moveMs}ms`;

  const targetAt = mover === 0
    ? (_g.targets.find(t => t === _g.positions[0] && !_g.collected.has(t)) ?? null)
    : null;
  updatePieces();
  renderHead();

  setTimeout(() => {
    if (_g !== game) return;
    if (sprite) sprite.moving = false;
    if (pieceEl) pieceEl.style.transitionDuration = '0.2s';
    // 等海豹球滑到位再收走精灵球，滑行途中球还在原地
    if (targetAt != null) {
      _g.collected.add(targetAt);
      refreshTargets();
      renderHead();
    }
    _g.busy = false;
    renderControls();
    if (_g.collected.size === _g.targets.length) { finishGame('clear'); return; }
    if (_g.steps >= _g.budget) finishGame('fail');
  }, moveMs + 50);
}

function snapshot() {
  return {
    positions: _g.positions.slice(),
    collected: [..._g.collected],
    steps: _g.steps,
    dirs: _g.dirs.map(d => d.slice()),
    selected: _g.selected,
  };
}

function undo() {
  if (!_g || _g.busy || _g.done || !_g.history.length) return;
  const s = _g.history.pop();
  _g.positions = s.positions;
  _g.collected = new Set(s.collected);
  _g.steps = s.steps;
  _g.dirs = s.dirs;
  _g.selected = s.selected;
  const grid = $('slBoard')?.querySelector('.sl-grid');
  if (grid) grid.classList.add('no-trans');
  updatePieces();
  refreshTargets();
  if (grid) { void grid.offsetWidth; grid.classList.remove('no-trans'); }
  renderHead();
  renderControls();
}

function resetBoard() {
  _g.positions = _g.initial.positions.slice();
  _g.collected = new Set();
  _g.steps = 0;
  _g.dirs = _g.initial.dirs.map(d => d.slice());
  _g.selected = 0;
  _g.busy = false;
  _g.done = false;
  _g.failed = false;
  _g.history = [];
  _g.demo = false;
  _g.answerPath = null;
  _g.answerStep = 0;
  _g.answerTotal = 0;
  setResultHeader(false);
  hideOverlay();
  const board = $('slBoard');
  if (board) board.classList.remove('done');
  const grid = board?.querySelector('.sl-grid');
  if (grid) grid.classList.add('no-trans');
  _g.sprites.forEach((sp, i) => {
    sp.moving = false;
    sp.anim = 'idle';
    sp.frame = 0;
    sp.next = 0;
    sp.row = rowOf(_g.dirs[i] || [1, 0]);
    const pos = `0px -${sp.row * sp.geom.h}px`;
    sp.idle.style.objectPosition = pos;
    sp.walk.style.objectPosition = pos;
    sp.idle.classList.add('on');
    sp.walk.classList.remove('on');
  });
  updatePieces();
  refreshTargets();
  if (grid) { void grid.offsetWidth; grid.classList.remove('no-trans'); }
  renderControls();
  renderHead();
}

function newBoard() {
  if (!_g || _g.busy) return;
  const lv = _g.lv;
  const cb = _g.onFinish;
  initBoard(lv, generateBoard(lv), cb);
}

function finishGame(reason) {
  if (!_g || _g.done) return;
  _g.done = true;
  _g.win = reason === 'clear';
  const counted = _g.win && !_g.voided;
  _g.coins = counted ? _g.lv.coins : 0;
  if (_g.onFinish) {
    try { _g.onFinish(_g.coins, counted); } catch (e) { console.error('[海豹滑冰] 结算出错：', e); }
  }
  if (reason === 'leave') return;
  if (_g.win) {
    playMahjongSfx('ui');
    showResult();
    return;
  }
  _g.failed = true;
  renderControls();
  renderHead();
  showFailureOverlay();
}

function showResult() {
  const board = $('slBoard');
  if (!board) return;
  board.classList.add('done');
  setResultHeader(true);
  renderControls();
  const voided = _g.voided;
  board.innerHTML = `<div class="sl-result">
    <p class="game-result-title${voided ? ' fail' : ''}">${voided ? '本关作废' : '完成'}</p>
    <p class="sl-result-sub">${voided ? '看过答案，本关不计奖励' : `步数 ${_g.steps} · 最少 ${_g.min} 步`}</p>
    ${voided
      ? '<p class="game-result-coins none">本关无奖励</p>'
      : `<p class="game-result-coins"><img src="./items/goods/balloon-blue.png" alt="">+${_g.coins} 气球</p>`}
    <div class="game-result-btns">
      <span class="catch-confirm-btn" data-sl="again">再来一局</span>
      <span class="catch-confirm-btn" data-sl="back">返回</span>
    </div>
  </div>`;
}

export function leaveSealGame() {
  if (_g && !_g.done) finishGame('leave');
  _g = null;
  if (getCurrentView() !== 'sealView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');
  });
}

function rowOf(dir) {
  if (dir[0] === 1) return 0;
  if (dir[1] === 1) return 1;
  if (dir[0] === -1) return 2;
  return 3;
}

setInterval(() => {
  if (!_g || !_g.sprites) return;
  const now = performance.now();
  for (const s of _g.sprites) {
    const anim = s.moving ? 'walk' : 'idle';
    const row = rowOf(_g.dirs[s.idx] || [1, 0]);
    if (anim !== s.anim) {
      s.anim = anim;
      s.frame = 0;
      s.next = now;
      s.row = row;
      s.idle.classList.toggle('on', anim === 'idle');
      s.walk.classList.toggle('on', anim === 'walk');
      const pos = `0px -${row * s.geom.h}px`;
      s.idle.style.objectPosition = pos;
      s.walk.style.objectPosition = pos;
    }
    const img = s[anim];
    const info = s.geom[anim];
    if (row !== s.row) {
      s.row = row;
      s.frame = 0;
      s.next = now;
      const pos = `0px -${row * s.geom.h}px`;
      s.idle.style.objectPosition = pos;
      s.walk.style.objectPosition = pos;
    }
    if (now < s.next) continue;
    img.style.objectPosition = `-${s.frame * s.geom.w}px -${s.row * s.geom.h}px`;
    s.frame = (s.frame + 1) % info.n;
    s.next = now + info.ms;
  }
}, 60);
