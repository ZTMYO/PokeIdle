// ===== 符文寻踪 =====
// 限时活动「符文寻踪」的玩法：点格子探测，数字是离最近符文还要走的步数（四方向曼哈顿距离），
// 数字为 0 就是符文所在格，自动挖出；挖出一个后其余已探测格子的数字全部重算。
// 一局的符文位置用本地随机就够 —— 奖励固定，没有"全服同一份奖励"的问题。
import { $, showView, getCurrentView, tryLoadPokemonImage } from './ui.js';
import { pushNav, popNav, getPokemonByIndex } from './state.js';
import { playMahjongSfx } from './audio.js';

// 三档场地：边长 / 符文数 / 通关基础气球 / 标准探测次数（不超过它拿满额）/ 探测次数上限（0 = 不限）
export const TH_LEVELS = [
  { id: 'easy', name: '简单', size: 5, count: 3, base: 20, par: 12, max: 0 },
  { id: 'normal', name: '普通', size: 6, count: 5, base: 40, par: 15, max: 20 },
  { id: 'hard', name: '困难', size: 7, count: 7, base: 120, par: 16, max: 20 },
];
export const thLevelOf = (id) => TH_LEVELS.find(l => l.id === id) || TH_LEVELS[1];

// 未知图腾 28 种：0201=A、0201-1=B …… 0201-25=Z、0201-26=感叹号、0201-27=问号
export const UNOWN_INDEX = Array.from({ length: 28 }, (_, i) => (i === 0 ? '0201' : `0201-${i}`));

const GAP = 3;

let _g = null;   // 当前这一局

export function startTreasureGame(opts = {}) {
  const view = $('treasureView');
  if (!view) return;
  if (_g?.fxTimer) clearTimeout(_g.fxTimer);   // 再来一局：掐掉上一局的收尾演出
  const lv = thLevelOf(opts.level);
  _g = {
    lv,
    cells: [],       // { i, x, y, treasure, idx, probed, dist, dug }
    treasures: [],   // { x, y, dug }
    probes: 0, found: 0, done: false, coins: 0, win: false,
    fxTimer: 0,
    onFinish: opts.onFinish || null,
  };
  buildCells();
  pushNav('treasureView');
  showView('treasureView');
  renderBoard();
  renderHead();
  tip('点格子开始探测');
}

function buildCells() {
  const n = _g.lv.size;
  const used = new Set();
  for (let k = 0; k < _g.lv.count; k++) {
    let p;
    do { p = Math.floor(Math.random() * n * n); } while (used.has(p));
    used.add(p);
    _g.treasures.push({ x: p % n, y: Math.floor(p / n), dug: false });
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const isT = used.has(i);
      _g.cells.push({
        i, x, y,
        idx: isT ? UNOWN_INDEX[Math.floor(Math.random() * UNOWN_INDEX.length)] : null,
        probed: false, dist: null, dug: false,
      });
    }
  }
}

// 格子保持正方形：取场地宽高能容纳的最大边长（整数像素，避免高分屏下半像素模糊）
function cellSizeOf(board) {
  const n = _g.lv.size;
  const w = board.clientWidth, h = board.clientHeight;
  if (w < 40 || h < 40) return 24;   // 量不到（还没铺开）：给个默认值
  const fitW = Math.floor((w - GAP * (n - 1)) / n);
  const fitH = Math.floor((h - GAP * (n - 1)) / n);
  return Math.max(12, Math.min(fitW, fitH));
}

function renderBoard() {
  const board = $('thBoard');
  if (!board) return;
  const n = _g.lv.size;
  const cell = cellSizeOf(board);
  board.style.gridTemplateColumns = `repeat(${n}, ${cell}px)`;
  board.style.gridAutoRows = `${cell}px`;
  board.innerHTML = _g.cells.map(c => cellHtml(c)).join('');
  loadIcons(board);
  board.onclick = onBoardClick;
}

function cellHtml(c) {
  if (c.dug) return `<div class="th-cell dug" data-i="${c.i}"><img data-icon="${c.idx}" alt=""></div>`;
  if (c.probed) return `<div class="th-cell" data-i="${c.i}" data-band="${bandOf(c.dist)}">${c.dist}</div>`;
  return `<div class="th-cell" data-i="${c.i}"></div>`;
}

// 符文用动图立绘（.gif），比静态 icon 生动
function loadIcons(root) {
  root.querySelectorAll('img[data-icon]').forEach((img) => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (!poke) return;
    tryLoadPokemonImage(img, poke, '');
    img.alt = poke.name || '';
  });
}

const cellEl = (c) => $('thBoard')?.children[c.i] || null;

// 四方向移动的最短步数 = 曼哈顿距离
const manhattan = (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2);

// 到最近一个还没挖出的符文的步数
function nearestSteps(x, y) {
  let best = Infinity;
  for (const t of _g.treasures) {
    if (t.dug) continue;
    best = Math.min(best, manhattan(x, y, t.x, t.y));
  }
  return best === Infinity ? 0 : best;
}

// 步数映射到底色档位：越小越近
function bandOf(d) {
  if (d <= 2) return 1;
  if (d <= 4) return 2;
  if (d <= 6) return 3;
  if (d <= 9) return 4;
  return 5;
}

function onBoardClick(e) {
  const el = e.target.closest('.th-cell');
  if (!el || !_g || _g.done) return;
  const c = _g.cells[Number(el.dataset.i)];
  if (!c) return;
  if (c.dug) { tip('这个符文已经挖走了'); return; }
  if (c.probed) { tip(`这格已经探测过：还要走 ${c.dist} 步`); return; }

  playMahjongSfx('ui');
  _g.probes++;
  c.probed = true;
  c.dist = nearestSteps(c.x, c.y);
  if (c.dist === 0) digAt(c);
  else { paintCell(c); tip(`离最近符文还要走 ${c.dist} 步`); }
  renderHead();
  if (_g.found === _g.lv.count) finish('clear');
  else if (_g.lv.max && _g.probes >= _g.lv.max) finish('fail');
}

function digAt(c) {
  const t = _g.treasures.find(t => !t.dug && t.x === c.x && t.y === c.y);
  if (!t) return;
  t.dug = true;
  c.dug = true;
  _g.found++;
  const el = cellEl(c);
  if (el) {
    el.className = 'th-cell dug';
    el.textContent = '';
    const img = document.createElement('img');
    img.dataset.icon = c.idx;
    el.appendChild(img);
    loadIcons(el);
  }
  const poke = getPokemonByIndex(c.idx);
  tip(`挖到了${poke ? (poke.form || poke.name) : '符文'}`);
  repaintProbed();   // 最近目标可能换人，旧数字全部重算
}

// 挖出一个后重算所有已探测格子的步数，保证提示始终是当前状态
function repaintProbed() {
  const cleared = _g.found === _g.lv.count;   // 全挖完：数字没意义了，清空只留符文
  for (const c of _g.cells) {
    if (!c.probed || c.dug) continue;
    const el = cellEl(c);
    if (cleared) {
      if (el) { el.textContent = ''; el.removeAttribute('data-band'); }
      continue;
    }
    c.dist = nearestSteps(c.x, c.y);
    paintCell(c);
  }
}

function paintCell(c) {
  const el = cellEl(c);
  if (!el) return;
  el.dataset.band = bandOf(c.dist);
  el.textContent = c.dist;
}

function renderHead() {
  const a = $('thFound'), b = $('thProbe');
  if (a) a.textContent = `剩 ${_g.lv.count - _g.found} 个`;
  if (b) b.textContent = _g.lv.max ? `探测 ${_g.probes}/${_g.lv.max}` : `探测 ${_g.probes} 次`;
}

function tip(msg) {
  const el = $('thMsg');
  if (el) el.textContent = msg;
}

// 结算（一局只发一次）：
//   clear = 全挖完，标准探测次数内拿全额，超出按比例递减
//   fail  = 探测次数用尽，按已挖出的符文比例给一半，保证通关始终更划算
//   leave = 中途退出，静默作废
function finish(reason) {
  if (!_g || _g.done) return;
  _g.done = true;
  _g.win = reason === 'clear';
  const { lv, probes, found } = _g;
  if (_g.win) _g.coins = Math.round(lv.base * Math.min(1, lv.par / Math.max(1, probes)));
  else if (reason === 'fail') _g.coins = Math.round(lv.base * (found / lv.count) * 0.5);
  else _g.coins = 0;
  if (_g.onFinish) { try { _g.onFinish(_g.coins, _g.win); } catch (e) { console.error('[符文寻踪] 结算出错：', e); } }
  renderHead();
  if (reason === 'leave') return;
  playMahjongSfx('ui');
  // 挖完最后一个先来一段收尾演出，再弹结算
  if (_g.win) playWinFx();
  else _g.fxTimer = setTimeout(showResult, 600);
}

// 收尾演出：格子从场地中心向外依次弹一下，荡完再弹结算
function playWinFx() {
  const board = $('thBoard');
  if (!board) { showResult(); return; }
  const n = _g.lv.size;
  const mid = (n - 1) / 2;
  let maxD = 0;
  Array.from(board.children).forEach((el, i) => {
    const d = Math.round(Math.abs((i % n) - mid) + Math.abs(Math.floor(i / n) - mid));
    if (d > maxD) maxD = d;
    el.style.setProperty('--th-d', d);
    el.classList.add('th-win');
  });
  _g.fxTimer = setTimeout(() => {
    _g.fxTimer = 0;
    if (_g && _g.done) showResult();
  }, 260 + maxD * 45 + 360);
}

function showResult() {
  const board = $('thBoard');
  if (!board) return;
  const t = $('thMsg');
  if (t) t.textContent = _g.lv.name;   // 顶栏中间改成显示本局难度
  board.style.gridTemplateColumns = '1fr';
  board.style.gridAutoRows = '';
  const head = _g.win
    ? `<p class="game-result-title">全部挖出</p>`
    : `<p class="game-result-title">探测次数用尽</p><p class="th-rank">挖到 ${_g.found}/${_g.lv.count} 个</p>`;
  board.innerHTML = `
    <div class="th-result">
      ${head}
      <p class="game-result-coins"><img src="./items/goods/balloon-indigo.png" alt="">+${_g.coins} 气球</p>
      <div class="game-result-btns">
        <span class="catch-confirm-btn" data-th="again">再来一局</span>
        <span class="catch-confirm-btn" data-th="back">返回</span>
      </div>
    </div>`;
  board.onclick = (e) => {
    const btn = e.target.closest('[data-th]');
    if (!btn) return;
    if (btn.dataset.th === 'again') startTreasureGame({ level: _g.lv.id, onFinish: _g.onFinish });
    else leaveTreasureGame();
  };
}

// 离开：还没结算的静默作废（一局只发一次），回活动页
export function leaveTreasureGame() {
  if (_g?.fxTimer) { clearTimeout(_g.fxTimer); _g.fxTimer = 0; }
  if (_g && !_g.done) finish('leave');
  _g = null;
  if (getCurrentView() !== 'treasureView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');   // 活动已下架：退回手机首页
  });
}
