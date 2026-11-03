// ===== 球球归位（限时活动小游戏）=====
import { $, showView, getCurrentView, tryLoadImage } from './ui.js';
import { pushNav, popNav } from './state.js';
import { playMahjongSfx } from './audio.js';

export const BH_LEVELS = [
  { id: 'easy', name: '简单', n: 5, pushes: 2, crates: 1, triangles: 0, setups: 1, minLen: 3, maxLen: 5, coins: 30, attempts: 4000, cap: 60000 },
  { id: 'normal', name: '普通', n: 6, pushes: 3, crates: 1, triangles: 0, setups: 1, minLen: 4, maxLen: 7, coins: 60, attempts: 5000, cap: 100000 },
  { id: 'hard', name: '困难', n: 7, pushes: 4, crates: 2, triangles: 1, setups: 1, minLen: 5, maxLen: 10, coins: 100, attempts: 6000, cap: 150000 },
];
export const bhLevelOf = (id) => BH_LEVELS.find((l) => l.id === id) || BH_LEVELS[1];

const COIN_ICON = './items/goods/balloon-orange.png';
const BALL_SRC = 'items/balls/poke-ball.png';
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const STEP = 60;
const BREAK = 260;
const WINDUP = 120;
const LUNGE = 50;
const DROP = 200;

const SVG_HOLE = `<svg class="bh-hole" viewBox="0 0 32 32" aria-hidden="true">
  <circle class="bh-hole-pit" cx="16" cy="16" r="12.5"/>
  <circle class="bh-hole-rim" cx="16" cy="16" r="12.5"/>
</svg>`;

const CRATE_HTML = `<span class="bh-crate-frame"></span><span class="bh-crate-shards"><i></i><i></i><i></i><i></i></span>`;

const SVG_ARROW = `<svg class="bh-arrow" viewBox="0 0 32 32" aria-hidden="true">
  <path d="M16 4.5 27 19.5h-7.4V27h-7.2v-7.5H5Z" fill="currentColor"/>
</svg>`;

const SVG_TRI = `<svg class="bh-arrow" viewBox="0 0 32 32" aria-hidden="true">
  <path d="M16 4 28 27H4Z" fill="currentColor"/>
</svg>`;

let _g = null;
let _bound = false;
let _gen = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomSeed = () => (Math.random() * 0xFFFFFFFF) >>> 0;

// ===== 关卡引擎 =====
function stepOf(n, i, d) {
  const x = i % n, y = Math.floor(i / n);
  const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
  if (nx < 0 || nx >= n || ny < 0 || ny >= n) return -1;
  return nx + ny * n;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prepareLevel(level) {
  return {
    n: level.n,
    wallSet: new Set(level.walls),
    holeSet: new Set(level.holes),
    crateIndex: new Map(level.crates.map((c, i) => [c, i])),
    dirs: level.blocks.map((b) => b.dir),
    kinds: level.blocks.map((b) => b.kind || 'normal'),
  };
}

function initialState(level) {
  return {
    ball: level.ball,
    blocks: level.blocks.map((b) => b.cell),
    aliveMask: (1 << level.blocks.length) - 1,
    cratesMask: (1 << level.crates.length) - 1,
  };
}

function cloneState(s) {
  return { ball: s.ball, blocks: s.blocks.slice(), aliveMask: s.aliveMask, cratesMask: s.cratesMask };
}

// 一次点击：箭头滑到障碍/球/别的箭头前；碎岩会碎；撞到球/箭头时箭头消失。
function simulateMove(prep, state, bi, trace) {
  if (!(state.aliveMask & (1 << bi))) return null;
  const n = prep.n;
  const d = prep.dirs[bi];
  const blockAt = new Set();
  for (let i = 0; i < state.blocks.length; i++) {
    if ((state.aliveMask & (1 << i)) && state.blocks[i] >= 0) blockAt.add(state.blocks[i]);
  }
  const newBlocks = state.blocks.slice();
  const blockPath = trace ? [] : null;
  const ballPath = trace ? [] : null;
  let cratesMask = state.cratesMask;
  let aliveMask = state.aliveMask;
  let blockCrate = null;
  let ballCrate = null;
  let cur = state.blocks[bi];
  let ball = state.ball;
  let ballMoved = false;
  let hitBall = false;
  let hitArrow = false;
  let arrowPushTarget = -1;
  let arrowPushPath = trace ? [] : null;
  let win = false;

  while (true) {
    const nx = stepOf(n, cur, d);
    if (nx >= 0 && blockAt.has(nx)) {
      let ti = -1;
      for (let i = 0; i < newBlocks.length; i++) {
        if ((aliveMask & (1 << i)) && newBlocks[i] === nx) { ti = i; break; }
      }
      if (ti >= 0) {
        let tc = nx;
        while (true) {
          const nn = stepOf(n, tc, d);
          if (nn < 0 || prep.wallSet.has(nn) || prep.holeSet.has(nn) || blockAt.has(nn)) break;
          const cj = prep.crateIndex.get(nn);
          if (cj !== undefined && (cratesMask & (1 << cj))) break;
          if (nn === ball) break;
          tc = nn;
          if (trace) arrowPushPath.push(nn);
        }
        newBlocks[ti] = tc;
        hitArrow = true;
        arrowPushTarget = ti;
      }
      break;
    }
    if (nx < 0 || prep.wallSet.has(nx) || prep.holeSet.has(nx)) break;

    const ci = prep.crateIndex.get(nx);
    if (ci !== undefined && (cratesMask & (1 << ci))) {
      blockCrate = nx;
      cratesMask &= ~(1 << ci);
      break;
    }

    if (nx === ball) {
      hitBall = true;
      if (prep.kinds[bi] === 'triangle') {
        const nn = stepOf(n, ball, d);
        if (nn >= 0 && !prep.wallSet.has(nn) && !blockAt.has(nn)) {
          if (prep.holeSet.has(nn)) {
            ball = -1;
            ballMoved = true;
            win = true;
            if (trace) ballPath.push(nn);
          } else {
            const cj = prep.crateIndex.get(nn);
            if (cj !== undefined && (cratesMask & (1 << cj))) {
              cratesMask &= ~(1 << cj);
              ballCrate = nn;
            } else {
              ball = nn;
              ballMoved = true;
              if (trace) ballPath.push(nn);
            }
          }
        }
      } else {
        let bc = ball;
        while (true) {
          const nn = stepOf(n, bc, d);
          if (nn < 0 || prep.wallSet.has(nn) || blockAt.has(nn)) break;
          if (prep.holeSet.has(nn)) {
            ball = -1;
            ballMoved = true;
            win = true;
            if (trace) ballPath.push(nn);
            break;
          }
          const cj = prep.crateIndex.get(nn);
          if (cj !== undefined && (cratesMask & (1 << cj))) {
            cratesMask &= ~(1 << cj);
            ball = bc;
            ballMoved = true;
            ballCrate = nn;
            break;
          }
          bc = nn;
          ball = bc;
          ballMoved = true;
          if (trace) ballPath.push(nn);
        }
      }
      break;
    }

    cur = nx;
    if (trace) blockPath.push(nx);
  }

  aliveMask &= ~(1 << bi);
  newBlocks[bi] = -1;
  return {
    ball: win ? -1 : ball,
    blocks: newBlocks,
    aliveMask,
    cratesMask,
    win,
    hitBall,
    hitArrow,
    arrowPushTarget,
    arrowPushPath: arrowPushPath || [],
    blockPath: blockPath || [],
    ballPath: ballPath || [],
    blockCrate,
    ballCrate,
  };
}

function stateKey(s) {
  return s.ball + '|' + s.blocks.join(',') + '|' + s.aliveMask + '|' + s.cratesMask;
}

function solveLevel(level, prep, cap) {
  const start = initialState(level);
  if (start.ball === -1) return { solved: true, moves: [], len: 0 };
  const queue = [start];
  const startKey = stateKey(start);
  const prev = new Map([[startKey, null]]);
  let head = 0;
  let nodes = 0;
  while (head < queue.length) {
    if (nodes++ > cap) return { solved: false };
    const st = queue[head++];
    const stKey = stateKey(st);
    for (let bi = 0; bi < st.blocks.length; bi++) {
      const sim = simulateMove(prep, st, bi, false);
      if (!sim) continue;
      const ns = { ball: sim.ball, blocks: sim.blocks, aliveMask: sim.aliveMask, cratesMask: sim.cratesMask };
      const key = stateKey(ns);
      if (prev.has(key)) continue;
      prev.set(key, { key: stKey, move: bi });
      if (sim.win) {
        const moves = [];
        let k = key;
        while (prev.get(k)) {
          const p = prev.get(k);
          moves.push(p.move);
          k = p.key;
        }
        moves.reverse();
        return { solved: true, moves, len: moves.length };
      }
      queue.push(ns);
    }
  }
  return { solved: false };
}

function moveWins(level, prep, bi) {
  const sim = simulateMove(prep, initialState(level), bi, false);
  return !!sim && sim.win;
}

function solutionUsesTrianglePush(level, prep, moves) {
  let st = initialState(level);
  for (const bi of moves) {
    const sim = simulateMove(prep, st, bi, false);
    if (!sim) return false;
    if ((level.blocks[bi].kind || 'normal') === 'triangle' && sim.hitBall) return true;
    st = { ball: sim.ball, blocks: sim.blocks, aliveMask: sim.aliveMask, cratesMask: sim.cratesMask };
    if (sim.win) break;
  }
  return false;
}

function solutionUsesSetupPush(level, prep, moves) {
  let st = initialState(level);
  for (const bi of moves) {
    const sim = simulateMove(prep, st, bi, false);
    if (!sim) return false;
    if (sim.hitArrow) return true;
    st = { ball: sim.ball, blocks: sim.blocks, aliveMask: sim.aliveMask, cratesMask: sim.cratesMask };
    if (sim.win) break;
  }
  return false;
}

function backSteps(n, from, d, steps) {
  let c = from;
  for (let i = 0; i < steps; i++) {
    c = stepOf(n, c, (d + 2) % 4);
    if (c < 0) return -1;
  }
  return c;
}

function buildCandidate(cfg, rng) {
  const n = cfg.n;
  const total = n * n;
  const walls = new Set();
  const crates = new Set();
  const blocks = [];
  const prot = new Set();
  const vis = new Set();
  const broken = new Set();
  const used = new Set();
  let cratesUsed = 0;

  const solid = (c) => walls.has(c)
    || (blocks.some((b) => b.cell === c) && !used.has(c))
    || (crates.has(c) && !broken.has(c));
  const occupiedInitial = (c) => walls.has(c) || crates.has(c) || blocks.some((b) => b.cell === c);
  const start = Math.floor(rng() * total);
  const startX = start % n;
  const startY = Math.floor(start / n);
  let ball = start;
  let hole = -1;
  prot.add(ball);
  vis.add(ball);

  const triSet = new Set();
  if (cfg.triangles > 0 && cfg.pushes > 1) {
    const pool = [];
    for (let s = 0; s < cfg.pushes - 1; s++) pool.push(s);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < Math.min(cfg.triangles, pool.length); i++) triSet.add(pool[i]);
  }

  for (let s = 0; s < cfg.pushes; s++) {
    const final = s === cfg.pushes - 1;
    const kind = triSet.has(s) ? 'triangle' : 'normal';
    const opts = [];

    for (let d = 0; d < 4; d++) {
      if (final) {
        const bx = ball % n;
        const by = Math.floor(ball / n);
        const horizontal = d === 1 || d === 3;
        if (horizontal ? by === startY : bx === startX) continue;
      }

      const pushers = [];
      let back = ball;
      const line = [];
      for (let j = 1; j < n; j++) {
        const p = stepOf(n, back, (d + 2) % 4);
        if (p < 0 || solid(p)) break;
        line.push(p);
        if (!prot.has(p) && !crates.has(p)) pushers.push({ p, line: line.slice() });
        back = p;
      }
      if (!pushers.length) continue;

      if (kind === 'triangle') {
        const to = stepOf(n, ball, d);
        if (final) {
          if (to >= 0 && to !== start && !vis.has(to) && !occupiedInitial(to)) {
            opts.push({ d, to, path: [to], pushers, hole: true, kind: 'triangle' });
          }
        } else if (to >= 0 && to !== start && !solid(to) && !vis.has(to)) {
          opts.push({ d, to, path: [to], pushers, kind: 'triangle' });
        }
        continue;
      }

      let c = ball;
      const path = [];
      while (true) {
        const nx = stepOf(n, c, d);
        if (nx < 0 || solid(nx) || vis.has(nx)) break;
        c = nx;
        path.push(c);

        if (final) {
          if (c !== start && !vis.has(c) && !occupiedInitial(c)) {
            opts.push({ d, to: c, path: path.slice(), pushers, hole: true });
          }
          continue;
        }

        const after = stepOf(n, c, d);
        if (after < 0) opts.push({ d, to: c, path: path.slice(), pushers, edgeStop: true });
        if (cratesUsed < cfg.crates && after >= 0 && !solid(after) && !prot.has(after) && after !== start && !vis.has(after)) {
          opts.push({ d, to: c, path: path.slice(), pushers, crateStop: true, after });
        }
      }
    }

    if (!opts.length) return null;
    const ch = opts[Math.floor(rng() * opts.length)];
    const pick = ch.pushers[Math.floor(rng() * ch.pushers.length)];

    blocks.push({ cell: pick.p, dir: ch.d, kind });
    pick.line.forEach((c) => prot.add(c));
    ch.path.forEach((c) => prot.add(c));
    prot.add(pick.p);
    used.add(pick.p);

    if (final) {
      hole = ch.to;
      prot.add(hole);
    } else if (ch.crateStop) {
      crates.add(ch.after);
      broken.add(ch.after);
      cratesUsed++;
      prot.add(ch.after);
    }

    ball = ch.to;
    ch.path.forEach((c) => vis.add(c));
  }

  if (hole < 0) return null;
  if (cfg.crates > 0 && cratesUsed === 0) return null;

  const cells = [];
  for (let c = 0; c < total; c++) {
    if (c === hole || walls.has(c) || crates.has(c) || blocks.some((b) => b.cell === c) || prot.has(c)) continue;
    cells.push(c);
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  let k = 0;
  for (let i = cratesUsed; i < cfg.crates && k < cells.length; i++) crates.add(cells[k++]);

  return { n, walls: [...walls], holes: [hole], ball: start, blocks, crates: [...crates] };
}

// 把直线解改造成一次中转：目标推手先被另一只箭头推到球后方
function tryConvertToSetup(cand, prep, sol, cfg, rng) {
  if (cfg.setups <= 0) return null;
  const n = cand.n;
  const occupied = new Set([
    ...cand.walls,
    ...cand.crates,
    ...cand.blocks.map((b) => b.cell),
    cand.ball,
    ...cand.holes,
  ]);

  const candidates = [];
  let st = initialState(cand);
  for (const bi of sol.moves) {
    const sim = simulateMove(prep, st, bi, false);
    if (!sim) break;
    if (sim.hitBall && st.ball >= 0) candidates.push({ bi, cell: st.blocks[bi] });
    st = { ball: sim.ball, blocks: sim.blocks, aliveMask: sim.aliveMask, cratesMask: sim.cratesMask };
    if (sim.win) break;
  }
  if (!candidates.length) return null;
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  for (const cm of candidates) {
    const bi = cm.bi;
    const pFinal = cm.cell;
    const d = cand.blocks[bi].dir;
    const dirs = [(d + 1) & 3, (d + 3) & 3];

    for (const s of dirs) {
      const crateCell = stepOf(n, pFinal, s);
      if (crateCell < 0 || occupied.has(crateCell)) continue;
      for (let k = 1; k < n; k++) {
        const pInit = backSteps(n, pFinal, s, k);
        if (pInit < 0) break;
        if (occupied.has(pInit)) continue;

        let bad = false;
        let c = pInit;
        for (let q = 0; q < k - 1; q++) {
          c = stepOf(n, c, s);
          if (c < 0 || occupied.has(c)) { bad = true; break; }
        }
        if (bad) continue;

        for (let m = 1; m < n; m++) {
          const pSetup = backSteps(n, pInit, s, m);
          if (pSetup < 0) break;
          if (occupied.has(pSetup)) continue;

          let bad2 = false;
          let c2 = pSetup;
          for (let q = 0; q < m - 1; q++) {
            c2 = stepOf(n, c2, s);
            if (c2 < 0 || occupied.has(c2)) { bad2 = true; break; }
          }
          if (bad2) continue;

          const blocks = cand.blocks.map((b, idx) => (idx === bi ? { ...b, cell: pInit } : b));
          blocks.push({ cell: pSetup, dir: s, kind: 'normal' });
          const level = { ...cand, blocks, crates: [...cand.crates, crateCell] };
          const prep2 = prepareLevel(level);
          const sol2 = solveLevel(level, prep2, cfg.cap);
          if (!sol2.solved) continue;
          if (sol2.len < cfg.minLen || sol2.len > cfg.maxLen) continue;
          if (!solutionUsesSetupPush(level, prep2, sol2.moves)) continue;
          if (cfg.triangles > 0 && !solutionUsesTrianglePush(level, prep2, sol2.moves)) continue;
          return { level, sol: sol2 };
        }
      }
    }
  }
  return null;
}

function generateLevel(cfg, seed) {
  const rng = mulberry32(seed >>> 0);
  for (let attempt = 0; attempt < cfg.attempts; attempt++) {
    const cand = buildCandidate(cfg, rng);
    if (!cand) continue;
    const prep = prepareLevel(cand);
    if (cand.blocks.some((_, bi) => moveWins(cand, prep, bi))) continue;
    const sol = solveLevel(cand, prep, cfg.cap);
    if (!sol.solved) continue;

    if (cfg.setups > 0) {
      if (sol.len !== cfg.pushes) continue;
      const setup = tryConvertToSetup(cand, prep, sol, cfg, rng);
      if (!setup) continue;
      return { ...setup.level, coins: cfg.coins, minMoves: setup.sol.len };
    }

    if (sol.len < cfg.minLen || sol.len > cfg.maxLen) continue;
    if (cfg.triangles > 0 && !solutionUsesTrianglePush(cand, prep, sol.moves)) continue;
    return { ...cand, coins: cfg.coins, minMoves: sol.len };
  }
  return null;
}

// ===== 界面 =====
function crateCells(level, mask) {
  const out = [];
  for (let i = 0; i < level.crates.length; i++) if (mask & (1 << i)) out.push(level.crates[i]);
  return out;
}

function positionPiece(el, cell, ox = 0, oy = 0) {
  if (!el || !_g) return;
  const n = _g.level.n;
  const x = cell % n;
  const y = Math.floor(cell / n);
  const step = _g.cell + _g.gap;
  el.style.left = `${x * step + ox}px`;
  el.style.top = `${y * step + oy}px`;
  el.style.width = `${_g.cell}px`;
  el.style.height = `${_g.cell}px`;
}

function loadBall(img) {
  tryLoadImage(img, BALL_SRC);
}

function renderBoard() {
  const board = $('bhBoard');
  if (!board || !_g) return;
  board.classList.remove('done');
  const n = _g.level.n;
  const wrap = document.createElement('div');
  wrap.className = 'bh-board-wrap';

  const gap = 2;
  const availW = Math.max(80, board.clientWidth - 6);
  const availH = Math.max(80, board.clientHeight - 6);
  const cell = Math.max(16, Math.min(52, Math.floor(Math.min(
    (availW - gap * (n - 1)) / n,
    (availH - gap * (n - 1)) / n
  ))));
  const size = cell * n + gap * (n - 1);
  _g.cell = cell;
  _g.gap = gap;

  const grid = document.createElement('div');
  grid.className = 'sl-grid';
  grid.style.width = `${size}px`;
  grid.style.height = `${size}px`;
  grid.style.gridTemplateColumns = `repeat(${n}, ${cell}px)`;
  grid.style.gridAutoRows = `${cell}px`;
  grid.style.gap = `${gap}px`;

  const wallSet = new Set(_g.level.walls);
  const holeSet = new Set(_g.level.holes);
  for (let i = 0; i < n * n; i++) {
    const el = document.createElement('div');
    el.className = 'sl-cell';
    el.dataset.i = i;
    if (wallSet.has(i)) el.classList.add('wall');
    if (holeSet.has(i)) {
      el.classList.add('bh-hole-cell');
      el.innerHTML = SVG_HOLE;
    }
    grid.appendChild(el);
  }

  const overlay = document.createElement('div');
  overlay.className = 'bh-overlay';
  overlay.style.width = `${size}px`;
  overlay.style.height = `${size}px`;

  for (const c of crateCells(_g.level, _g.state.cratesMask)) {
    const el = document.createElement('div');
    el.className = 'bh-piece bh-crate';
    el.dataset.crate = c;
    el.innerHTML = CRATE_HTML;
    positionPiece(el, c);
    overlay.appendChild(el);
  }

  if (_g.state.ball >= 0) {
    const el = document.createElement('div');
    el.className = 'bh-piece bh-ball';
    const img = document.createElement('img');
    img.className = 'bh-ball-img';
    img.alt = '精灵球';
    el.appendChild(img);
    positionPiece(el, _g.state.ball);
    overlay.appendChild(el);
    loadBall(img);
  }

  for (let bi = 0; bi < _g.level.blocks.length; bi++) {
    if (!(_g.state.aliveMask & (1 << bi)) || _g.state.blocks[bi] < 0) continue;
    const b = _g.level.blocks[bi];
    const kind = b.kind || 'normal';
    const el = document.createElement('div');
    el.className = `bh-piece bh-block${kind === 'triangle' ? ' tri' : ''}`;
    el.dataset.bi = bi;
    el.dataset.kind = kind;
    el.style.setProperty('--rot', `${b.dir * 90}deg`);
    el.innerHTML = `<span class="bh-block-inner">${kind === 'triangle' ? SVG_TRI : SVG_ARROW}</span>`;
    positionPiece(el, _g.state.blocks[bi]);
    overlay.appendChild(el);
  }

  wrap.appendChild(grid);
  wrap.appendChild(overlay);
  board.innerHTML = '';
  board.appendChild(wrap);
}

function setResultHeader(on) {
  const level = $('bhLevel');
  if (level) {
    level.hidden = !on;
    level.textContent = on && _g ? _g.tier.name : '';
  }
  const actions = $('bhActions');
  if (actions) actions.hidden = !!on;
}

function updateHeader() {
  if (!_g) return;
  setResultHeader(_g.done);
  const lock = _g.busy || _g.done;
  $('bhUndo')?.classList.toggle('off', lock || !_g.history.length);
  $('bhReset')?.classList.toggle('off', lock);
  $('bhNew')?.classList.toggle('off', lock);
}

function initGame(tier, onFinish) {
  _gen++;
  let level = null;
  for (let i = 0; i < 3 && !level; i++) level = generateLevel(tier, randomSeed());
  if (!level) {
    console.error('[球球归位] 关卡生成失败');
    return;
  }
  _g = {
    tier,
    level,
    prep: prepareLevel(level),
    state: initialState(level),
    initial: null,
    history: [],
    moves: 0,
    done: false,
    busy: false,
    paid: false,
    onFinish: onFinish || null,
    cell: 0,
    gap: 2,
  };
  _g.initial = cloneState(_g.state);
  setResultHeader(false);
  renderBoard();
  updateHeader();
}

function resetGame() {
  if (!_g || _g.busy) return;
  _gen++;
  _g.state = cloneState(_g.initial);
  _g.moves = 0;
  _g.history = [];
  _g.done = false;
  _g.busy = false;
  updateHeader();
  renderBoard();
}

function undo() {
  if (!_g || _g.busy || _g.done || !_g.history.length) return;
  const h = _g.history.pop();
  _g.state = cloneState(h.state);
  _g.moves = h.moves;
  updateHeader();
  renderBoard();
}

function newGame() {
  if (!_g || _g.busy) return;
  initGame(_g.tier, _g.onFinish);
}

function breakCrate(cell) {
  const el = document.querySelector(`.bh-crate[data-crate="${cell}"]`);
  if (!el) return;
  el.classList.add('breaking');
  setTimeout(() => el.remove(), BREAK);
}

function showResult() {
  if (!_g) return;
  _g.done = true;
  _g.busy = false;
  updateHeader();
  const board = $('bhBoard');
  if (!board) return;
  board.classList.add('done');
  board.innerHTML = `<div class="sl-result">
    <p class="game-result-title">完成</p>
    <p class="sl-result-sub">用了 ${_g.moves} 步 · 最少 ${_g.level.minMoves} 步</p>
    <p class="game-result-coins"><img src="${COIN_ICON}" alt="">+${_g.level.coins} 气球</p>
    <div class="game-result-btns">
      <span class="catch-confirm-btn" data-bh="again">再来一局</span>
      <span class="catch-confirm-btn" data-bh="back">返回</span>
    </div>
  </div>`;
  board.querySelector('[data-bh="again"]').addEventListener('click', newGame);
  board.querySelector('[data-bh="back"]').addEventListener('click', leaveBallHomeGame);
  if (!_g.paid) {
    _g.paid = true;
    try {
      if (_g.onFinish) _g.onFinish(_g.level.coins, true);
    } catch (e) {
      console.error('[球球归位] 结算出错：', e);
    }
  }
}

async function animateBallPath(sim, ballEl, token, dir) {
  const img = ballEl && ballEl.firstElementChild;
  const horizontal = dir === 1 || dir === 3;
  const launch = horizontal ? 'scaleX(0.9) scaleY(1.1)' : 'scaleX(1.1) scaleY(0.9)';
  const stop = horizontal ? 'scaleX(0.86) scaleY(1.14)' : 'scaleX(1.14) scaleY(0.86)';
  if (img) img.style.transform = launch;
  for (const cell of sim.ballPath) {
    if (token !== _gen || !_g) return false;
    _g.state.ball = cell;
    positionPiece(ballEl, cell);
    if (_g.prep.holeSet.has(cell)) {
      await sleep(STEP);
      if (ballEl) ballEl.classList.add('drop');
      await sleep(DROP);
      return true;
    }
    await sleep(STEP);
  }
  if (img) img.style.transform = stop;
  if (sim.ballCrate !== null) {
    if (token !== _gen || !_g) return false;
    breakCrate(sim.ballCrate);
  }
  if (img) {
    await sleep(30);
    if (token !== _gen || !_g) return false;
    img.style.transform = '';
  }
  if (sim.ballCrate !== null) {
    await sleep(BREAK);
    if (token !== _gen || !_g) return false;
  } else if (img) {
    await sleep(60);
    if (token !== _gen || !_g) return false;
  }
  return true;
}

async function animateArrowPush(sim, token) {
  const targetEl = document.querySelector(`.bh-block[data-bi="${sim.arrowPushTarget}"]`);
  for (const cell of sim.arrowPushPath) {
    if (token !== _gen || !_g) return false;
    _g.state.blocks[sim.arrowPushTarget] = cell;
    positionPiece(targetEl, cell);
    await sleep(STEP);
  }
  return true;
}

async function performMove(bi) {
  const g = _g;
  if (!g || g.busy || g.done) return false;
  const sim = simulateMove(g.prep, g.state, bi, true);
  if (!sim) return false;

  playMahjongSfx('ui');
  g.history.push({ state: cloneState(g.state), moves: g.moves });
  g.busy = true;
  const token = ++_gen;
  updateHeader();

  const blockEl = document.querySelector(`.bh-block[data-bi="${bi}"]`);
  const ballEl = document.querySelector('.bh-ball');

  try {
    if (blockEl) {
      blockEl.classList.add('windup');
      await sleep(WINDUP);
      if (token !== _gen || _g !== g) return false;
      blockEl.classList.remove('windup');
    }

    for (const cell of sim.blockPath) {
      if (token !== _gen || _g !== g) return false;
      g.state.blocks[bi] = cell;
      positionPiece(blockEl, cell);
      await sleep(STEP);
    }

    if (blockEl) {
      const n = g.level.n;
      const d = g.level.blocks[bi].dir;
      const finalCell = g.state.blocks[bi];
      const target = stepOf(n, finalCell, d);
      const padArrow = 2;
      const padBall = g.cell * 0.08;
      const padCrate = g.cell * 0.08;
      const padHole = g.cell * 0.08;
      let padTarget = padArrow;
      if (sim.hitBall) padTarget = padBall;
      else if (sim.blockCrate !== null) padTarget = padCrate;
      else if (target >= 0 && g.prep.holeSet.has(target)) padTarget = padHole;
      const lunge = target < 0 ? padArrow : g.gap + padArrow + padTarget;
      blockEl.classList.add('lunge');
      positionPiece(blockEl, finalCell, DIRS[d][0] * lunge, DIRS[d][1] * lunge);
      await sleep(LUNGE);
      if (token !== _gen || _g !== g) return false;
    }

    const jobs = [];
    if (blockEl) blockEl.remove();
    if (sim.blockCrate !== null) {
      breakCrate(sim.blockCrate);
      jobs.push(sleep(BREAK));
    }
    if (sim.hitArrow) jobs.push(animateArrowPush(sim, token));
    if (sim.hitBall) jobs.push(animateBallPath(sim, ballEl, token, g.level.blocks[bi].dir));
    await Promise.all(jobs);
    if (token !== _gen || _g !== g) return false;

    g.state.ball = sim.ball;
    g.state.blocks = sim.blocks;
    g.state.aliveMask = sim.aliveMask;
    g.state.cratesMask = sim.cratesMask;
    g.moves++;
    g.busy = false;
    updateHeader();
    if (sim.win) showResult();
    return true;
  } catch (e) {
    console.error('[球球归位] 动画出错：', e);
    if (token === _gen && _g === g) {
      g.busy = false;
      updateHeader();
    }
    return false;
  }
}

function onBoardClick(e) {
  if (!_g || _g.busy || _g.done) return;
  const cell = e.target.closest('.sl-cell');
  if (!cell) return;
  const i = Number(cell.dataset.i);
  const bi = _g.state.blocks.indexOf(i);
  if (bi >= 0) performMove(bi);
}

function bindUI() {
  if (_bound) return;
  _bound = true;
  $('bhBoard')?.addEventListener('click', onBoardClick);
  $('bhUndo')?.addEventListener('click', undo);
  $('bhReset')?.addEventListener('click', resetGame);
  $('bhNew')?.addEventListener('click', newGame);
  window.addEventListener('resize', () => {
    if (_g && !_g.done && !_g.busy && getCurrentView() === 'ballHomeView') renderBoard();
  });
}

export function startBallHomeGame(opts = {}) {
  if (!$('ballHomeView')) return;
  if (getCurrentView() !== 'ballHomeView') pushNav('ballHomeView');
  showView('ballHomeView');
  const tier = bhLevelOf(opts.level);
  initGame(tier, opts.onFinish);
  if (!_bound) bindUI();
  requestAnimationFrame(() => {
    if (_g && getCurrentView() === 'ballHomeView') renderBoard();
  });
}

export function leaveBallHomeGame() {
  if (_g && !_g.done && _g.onFinish) {
    try { _g.onFinish(0, false); } catch (e) { console.error('[球球归位] 结算出错：', e); }
  }
  _g = null;
  _gen++;
  if (getCurrentView() !== 'ballHomeView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');
  });
}
