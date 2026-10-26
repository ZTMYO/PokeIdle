// ===== 电球翻牌 =====
// 5×5 牌阵，×2/×3 连乘；翻到雷电球归零，收手按连锁档位结算。
// 提前收手按剩余 ×2/×3 价值打折（最多 -30%）；全清/封顶不打折。
import { BETS, renderBetAreaCommon, showCasinoHistoryView } from './casino.js';
import { gameData, saveGame, pushNav, formatNum, addSystemLog } from './state.js';
import { $, showView, updateStats, showConfirmBar } from './ui.js';
import { playMahjongSfx } from './audio.js';
import { showRulesPanel } from './rules-panel.js';

const BOARDS = [
  [6, 2, 7],
  [8, 1, 8],
  [6, 3, 9],
  [7, 2, 10],
  [9, 1, 10],
];
const PAYOUTS = [
  [128, 3.00], [96, 2.65], [64, 2.30], [48, 2.05], [32, 1.80],
  [24, 1.60], [16, 1.45], [12, 1.30], [8, 1.20], [6, 1.10],
  [4, 1.00], [3, 0.95], [2, 0.90], [1, 0.50],
];
const COLORS = ['#e77355', '#41ad46', '#efa53e', '#3194f9', '#c563e1'];
const CAP = 128;
const EARLY_PENALTY = 0.3;
const MARK_BITS = { 1: 1, 2: 2, 3: 4, 0: 8 };
const TILE = 28;
const GAP = 6;
const WIRE = 4;

let _phase = 'bet'; // bet | play | settle
let _bet = BETS[0];
let _stake = 0;
let _board = null;
let _revealed = [];
let _marks = [];
let _p = 1;
let _flips = 0;
let _suppressTap = false;
let _busy = false;
let _lastResult = null;
let _bustAt = -1;

const coinOf = () => gameData.items['casinoCoin'] || 0;
const pad2 = (n) => String(n).padStart(2, '0');

// ---------- 进入页面 ----------
export function showVoltorbView() {
  pushNav('casinoVoltorbView');
  showView('casinoVoltorbView');
  const saved = gameData._voltorbRound;
  if (saved && saved.stake > 0 && saved.board && Array.isArray(saved.board.values) && saved.board.values.length === 25) {
    _stake = saved.stake;
    _bet = BETS.includes(saved.bet) ? saved.bet : saved.stake;
    _board = saved.board;
    _revealed = Array.isArray(saved.revealed) ? saved.revealed.slice() : Array(25).fill(false);
    _marks = Array.isArray(saved.marks) ? saved.marks.slice() : Array(25).fill(0);
    _p = saved.p || 1;
    _flips = saved.flips || 0;
    _phase = 'play';
  } else if (_phase !== 'bet') {
    _phase = 'bet';
    _stake = 0;
    _board = null;
    _revealed = [];
    _marks = [];
    _p = 1;
    _flips = 0;
  }
  _busy = false;
  _bustAt = -1;
  if (_phase === 'play') {
    const bust = _revealed.findIndex((r, i) => r && _board.values[i] === 0);
    if (bust >= 0) _bustAt = bust;
    render();
    if (bust >= 0) { settle('bust'); return; }
    if (_p >= CAP) { settle('cap'); return; }
    if (!hasValuableLeft()) { settle('clear'); return; }
    return;
  }
  render();
}

// ---------- 渲染 ----------
function render() {
  const box = $('casinoVoltorbContent');
  if (!box) return;
  closeMarkMenu();
  if (_phase === 'bet') {
    box.innerHTML = renderBetPage();
  } else {
    box.innerHTML = `<div class="vf-app">${boardHtml()}</div>`;
  }
  bind(box);
}

function renderBetPage() {
  const balance = coinOf();
  const holder = { bet: _bet, lastResult: _lastResult };
  const startText = balance <= 0 ? '请在柜台兑换游戏币再来' : '开始翻牌';
  const html = renderBetAreaCommon(balance, holder, 'vfStart', startText, { rulesId: 'vfRules' });
  _bet = holder.bet;
  return html;
}

function boardHtml() {
  const tiles = Array.from({ length: 25 }, (_, i) => tileHtml(i)).join('');
  const rows = Array.from({ length: 5 }, (_, r) =>
    hintHtml('vf-hint-row', COLORS[r], _board.rowSum[r], _board.rowVolt[r])).join('');
  const cols = Array.from({ length: 5 }, (_, c) =>
    hintHtml('vf-hint-col', COLORS[c], _board.colSum[c], _board.colVolt[c])).join('');
  const corner = `<button type="button" class="vf-corner" id="vfQuit" ${_phase === 'play' && _flips > 0 && !_busy ? '' : 'disabled'}><span class="vf-cash-label">收手</span><span class="vf-cash-mult">×${_p}</span></button>`;
  return `<div class="vf-board">
      <div class="vf-grid-area"><div class="vf-lattice">${latticeSvg()}</div>${tiles}</div>
      <div class="vf-row-hints">${rows}</div>
      <div class="vf-col-hints">${cols}</div>
      ${corner}
    </div>`;
}

function hintHtml(cls, color, sum, volt) {
  return `<div class="vf-hint ${cls}" style="--hc:${color}">
      <div class="vf-hint-top"><span class="vf-num">${pad2(sum)}</span></div>
      <div class="vf-hint-div"></div>
      <div class="vf-hint-bot"><img class="vf-mini" src="./items/goods/voltorb.png" alt=""><span class="vf-num">${volt}</span></div>
    </div>`;
}

function tileHtml(i) {
  const v = _board.values[i];
  const rev = !!_revealed[i];
  const bust = i === _bustAt;
  const dim = rev && v === 0 && !bust;
  const shown = v === 0
    ? '<img class="vf-volt-face" src="./items/goods/voltorb.png" alt="">'
    : `<span class="vf-big-num">${v}</span>`;
  const mem = !rev && _marks[i] ? markHtml(_marks[i]) : '';
  return `<button type="button" class="vf-tile${rev ? ' revealed' : ''}${bust ? ' bust' : ''}${dim ? ' dim' : ''}" data-i="${i}" aria-label="第 ${Math.floor(i / 5) + 1} 行第 ${i % 5 + 1} 列">
      <span class="vf-bezel"><span class="vf-card">
        <span class="vf-face vf-hidden"></span>
        <span class="vf-face vf-shown">${shown}</span>
      </span></span>
      <span class="vf-memo">${mem}</span>
    </button>`;
}

function markHtml(mask) {
  let html = '';
  if (mask & MARK_BITS[1]) html += '<span class="vf-mark m1">1</span>';
  if (mask & MARK_BITS[2]) html += '<span class="vf-mark m2">2</span>';
  if (mask & MARK_BITS[3]) html += '<span class="vf-mark m3">3</span>';
  if (mask & MARK_BITS[0]) html += '<span class="vf-mark m0"><img src="./items/goods/voltorb.png" alt=""></span>';
  return html;
}

function latticeSvg() {
  const gapRatio = GAP / TILE;
  const wireRatio = WIRE / TILE;
  const L = 5 + 4 * gapRatio;
  const u = 100 / L;
  const thick = wireRatio * u;
  const len = gapRatio * 0.9 * u;
  const colX = (c) => (c * (1 + gapRatio) + 0.5) * u;
  const rowY = (r) => (r * (1 + gapRatio) + 0.5) * u;
  const gapX = (c) => (c * (1 + gapRatio) + 1 + gapRatio / 2) * u;
  const gapY = (r) => (r * (1 + gapRatio) + 1 + gapRatio / 2) * u;
  let out = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">`;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      const x = colX(c), y = gapY(r);
      out += `<rect x="${(x - thick / 2).toFixed(3)}" y="${(y - len / 2).toFixed(3)}" width="${thick.toFixed(3)}" height="${len.toFixed(3)}" fill="${COLORS[c]}" stroke="#d5efe7" stroke-width="${(thick * 0.28).toFixed(3)}"/>`;
    }
  }
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 4; c++) {
      const x = gapX(c), y = rowY(r);
      out += `<rect x="${(x - len / 2).toFixed(3)}" y="${(y - thick / 2).toFixed(3)}" width="${len.toFixed(3)}" height="${thick.toFixed(3)}" fill="${COLORS[r]}" stroke="#d5efe7" stroke-width="${(thick * 0.28).toFixed(3)}"/>`;
    }
  }
  return out + '</svg>';
}

// ---------- 绑定 ----------
function bind(box) {
  for (const t of box.querySelectorAll('.casino-bet-tick')) {
    t.addEventListener('click', () => {
      if (_phase !== 'bet' || t.classList.contains('off')) return;
      _bet = BETS[+t.dataset.i];
      render();
    });
  }
  box.querySelector('#vfStart')?.addEventListener('click', startRound);
  box.querySelector('#casinoHistoryBtn')?.addEventListener('click', () => showCasinoHistoryView('vf'));
  box.querySelector('#vfRules')?.addEventListener('click', showVoltorbRules);
  box.querySelector('#vfQuit')?.addEventListener('click', onCash);
  if (!box._vfDelegated) {
    box._vfDelegated = true;
    box.addEventListener('click', (e) => {
      const tile = e.target.closest('.vf-tile');
      if (!tile || !box.contains(tile)) return;
      if (_suppressTap) { _suppressTap = false; return; }
      onTile(+tile.dataset.i);
    });
    box.addEventListener('contextmenu', (e) => {
      const isRightClick = e.pointerType ? e.pointerType !== 'touch' : e.button === 2;
      if (box.querySelector('.vf-mark-menu')) {
        e.preventDefault();
        e.stopPropagation();
        if (isRightClick) closeMarkMenu();
        return;
      }
      const tile = e.target.closest('.vf-tile');
      if (!tile || !box.contains(tile)) return;
      e.preventDefault();
      e.stopPropagation();
      const i = +tile.dataset.i;
      if (_phase !== 'play' || _busy || _revealed[i]) return;
      openMarkMenu(i);
    });
  }
}

function showVoltorbRules() {
  showRulesPanel('casinoVoltorbContent', '电球翻牌规则', `
    <div class="game-rule-row"><b>牌阵</b><span>5×5 牌阵，每行每列标出数值合计和雷电球数量。</span></div>
    <div class="game-rule-row"><b>翻牌</b><span>翻开 ×2 / ×3 会连乘；翻到雷电球本局归零。</span></div>
    <div class="game-rule-row"><b>收手</b><span>随时收手按连锁结算；提前收手最多扣 ${Math.round(EARLY_PENALTY * 100)}%；全清或封顶 ×${CAP} 不打折。</span></div>
    <div class="game-rule-row"><b>标记</b><span>右键格子标记 1 / 2 / 3 / 雷电球，不消耗翻牌次数。</span></div>`);
}

// ---------- 玩法 ----------
function newBoard() {
  const set = BOARDS[Math.floor(Math.random() * BOARDS.length)];
  const values = Array(25).fill(1);
  const idx = [...Array(25).keys()];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  let k = 0;
  for (let i = 0; i < set[0]; i++) values[idx[k++]] = 2;
  for (let i = 0; i < set[1]; i++) values[idx[k++]] = 3;
  for (let i = 0; i < set[2]; i++) values[idx[k++]] = 0;
  const rowSum = Array(5).fill(0), rowVolt = Array(5).fill(0);
  const colSum = Array(5).fill(0), colVolt = Array(5).fill(0);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const v = values[r * 5 + c];
      if (v === 0) { rowVolt[r]++; colVolt[c]++; }
      else { rowSum[r] += v; colSum[c] += v; }
    }
  }
  return { values, rowSum, rowVolt, colSum, colVolt };
}

function payoutMult(p) {
  for (const [tier, mult] of PAYOUTS) if (p >= tier) return mult;
  return 0;
}

function highValueSplit() {
  let rem = 0, total = 0;
  if (_board) {
    for (let i = 0; i < 25; i++) {
      const v = _board.values[i];
      if (v === 2 || v === 3) {
        total += v;
        if (!_revealed[i]) rem += v;
      }
    }
  }
  return { rem, total };
}

function earlyDiscount() {
  const { rem, total } = highValueSplit();
  return total > 0 ? EARLY_PENALTY * rem / total : 0;
}

function cashoutMult() {
  return payoutMult(_p) * (1 - earlyDiscount());
}

function hasValuableLeft() {
  if (!_board) return false;
  for (let i = 0; i < 25; i++) {
    if (!_revealed[i]) {
      const v = _board.values[i];
      if (v === 2 || v === 3) return true;
    }
  }
  return false;
}

function saveRound() {
  if (_phase !== 'play' || !_board) return;
  gameData._voltorbRound = {
    stake: _stake,
    bet: _bet,
    board: _board,
    revealed: _revealed.slice(),
    marks: _marks.slice(),
    p: _p,
    flips: _flips,
  };
}

function startRound() {
  if (_phase !== 'bet') return;
  if (_bet <= 0 || coinOf() < _bet) return;
  gameData.items['casinoCoin'] -= _bet;
  _stake = _bet;
  _board = newBoard();
  _revealed = Array(25).fill(false);
  _marks = Array(25).fill(0);
  _p = 1;
  _flips = 0;
  _busy = false;
  _lastResult = null;
  _bustAt = -1;
  _phase = 'play';
  saveRound();
  saveGame();
  updateStats();
  playMahjongSfx('draw');
  render();
}

function onTile(i) {
  if (_phase !== 'play' || _busy || _revealed[i]) return;
  reveal(i);
}

function reveal(i) {
  if (_revealed[i]) return;
  const v = _board.values[i];
  _revealed[i] = true;
  _marks[i] = 0;
  _flips++;
  const t = tileEl(i);
  if (t) {
    t.classList.add('revealed');
    if (v === 0) t.classList.add('bust');
  }
  if (v === 0) {
    _bustAt = i;
    _busy = true;
    syncLive();
    playMahjongSfx('ui');
    saveRound();
    saveGame();
    setTimeout(() => settle('bust'), 650);
    return;
  }
  playMahjongSfx('ui');
  if (v > 1) {
    _p *= v;
    if (_p >= CAP) {
      _busy = true;
      syncLive();
      saveRound();
      saveGame();
      setTimeout(() => settle('cap'), 400);
      return;
    }
    if (!hasValuableLeft()) {
      _busy = true;
      syncLive();
      saveRound();
      saveGame();
      setTimeout(() => settle('clear'), 400);
      return;
    }
  }
  syncLive();
  saveRound();
  saveGame();
}

function tileEl(i) {
  const box = $('casinoVoltorbContent');
  return box?.querySelector(`.vf-tile[data-i="${i}"]`);
}

function paintTile(i) {
  const el = tileEl(i);
  if (el) el.outerHTML = tileHtml(i);
}

function syncLive() {
  const box = $('casinoVoltorbContent');
  if (!box) return;
  const quit = box.querySelector('#vfQuit');
  if (quit) {
    quit.disabled = !(_phase === 'play' && _flips > 0 && !_busy);
    const mult = quit.querySelector('.vf-cash-mult');
    if (mult) mult.textContent = `×${_p}`;
  }
}

function openMarkMenu(i) {
  if (_phase !== 'play' || _busy || _revealed[i]) return;
  closeMarkMenu();
  const app = $('casinoVoltorbContent')?.querySelector('.vf-app');
  if (!app) return;
  const tile = app.querySelector(`.vf-tile[data-i="${i}"]`);
  if (!tile) return;
  const ar = app.getBoundingClientRect();
  const tr = tile.getBoundingClientRect();
  const mw = 68;
  const mh = 88;
  let x = tr.left - ar.left + (tr.width - mw) / 2;
  let y = tr.top - ar.top + (tr.height - mh) / 2;
  x = Math.max(2, Math.min(ar.width - mw - 2, x));
  y = Math.max(2, Math.min(ar.height - mh - 2, y));
  _suppressTap = true;
  setTimeout(() => { _suppressTap = false; }, 500);
  const marks = _marks[i] || 0;
  const btn = (n, label) => `<button type="button" data-mark="${n}" class="${marks & MARK_BITS[n] ? 'sel' : ''}">${label}</button>`;
  const backdrop = document.createElement('div');
  backdrop.className = 'vf-mark-backdrop';
  const menu = document.createElement('div');
  menu.className = 'vf-mark-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.innerHTML = `${btn(1, '1')}${btn(2, '2')}${btn(3, '3')}${btn(0, '<img src="./items/goods/voltorb.png" alt="">')}<button type="button" data-mark="clear" class="vf-menu-clear">清</button>`;
  app.appendChild(backdrop);
  app.appendChild(menu);
  menu.style.pointerEvents = 'none';
  backdrop.style.pointerEvents = 'none';
  setTimeout(() => {
    if (!menu.isConnected) return;
    menu.style.pointerEvents = '';
    backdrop.style.pointerEvents = '';
  }, 250);
  menu.querySelectorAll('[data-mark]').forEach((b) => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const key = b.dataset.mark;
      if (key === 'clear') _marks[i] = 0;
      else _marks[i] = (_marks[i] || 0) ^ MARK_BITS[+key];
      paintTile(i);
      saveRound();
      saveGame();
      closeMarkMenu();
    });
  });
  backdrop.addEventListener('click', closeMarkMenu);
}

function closeMarkMenu() {
  const app = $('casinoVoltorbContent')?.querySelector('.vf-app');
  if (app) {
    app.querySelector('.vf-mark-menu')?.remove();
    app.querySelector('.vf-mark-backdrop')?.remove();
  }
  _suppressTap = false;
}

function onCash() {
  if (_phase !== 'play' || _busy || _flips === 0) return;
  const cash = Math.floor(_stake * cashoutMult());
  _busy = true;
  showConfirmBar(
    `<div>确定收手？</div><div>连锁 ×${_p} · 返还 ${formatNum(cash)} 游戏币</div>`,
    () => settle('cash'),
    () => { _busy = false; },
    { overlay: true },
  );
}

// ---------- 结算 ----------
function settle(kind) {
  if (_phase !== 'play') return;
  const base = kind === 'bust' ? 0 : payoutMult(_p);
  const discount = kind === 'cash' ? earlyDiscount() : 0;
  const mult = base * (1 - discount);
  const payout = Math.floor(_stake * mult);
  const net = payout - _stake;

  gameData.items['casinoCoin'] = coinOf() + payout;
  _revealed = Array(25).fill(true);

  let text;
  if (kind === 'bust') text = '爆雷';
  else if (kind === 'cap') text = '连锁封顶！';
  else if (kind === 'clear') text = '全部挖完！';
  else text = `收手 ${formatNum(payout)} 游戏币`;
  _lastResult = kind === 'cash'
    ? `${text}（净 ${net > 0 ? '+' : ''}${formatNum(net)}）`
    : `${text} ${net > 0 ? '+' : ''}${formatNum(net)} 游戏币`;
  _phase = 'settle';
  _busy = false;

  addSystemLog('voltorb', {
    action: kind,
    stake: _stake,
    chain: _p,
    mult: +mult.toFixed(4),
    discount,
    cash: payout,
    profit: net,
  });
  gameData.voltorbRecords = gameData.voltorbRecords || [];
  gameData.voltorbRecords.unshift({ time: Date.now(), bet: _stake, chain: _p, action: kind, result: text, net });
  if (gameData.voltorbRecords.length > 50) gameData.voltorbRecords.length = 50;
  delete gameData._voltorbRound;
  saveGame().then(updateStats);
  closeMarkMenu();
  revealAllAndResult(kind, payout, net);
}

function revealAllAndResult(kind, payout, net) {
  const app = $('casinoVoltorbContent')?.querySelector('.vf-app');
  if (!app) return;
  app.classList.add('settled');
  let order = 0;
  for (let i = 0; i < 25; i++) {
    const t = tileEl(i);
    if (!t) continue;
    if (t.classList.contains('revealed')) {
      if (kind === 'bust' && _board.values[i] === 0 && i !== _bustAt) t.classList.add('dim');
      continue;
    }
    const delay = order * 18;
    order++;
    setTimeout(() => {
      t.classList.add('revealed');
      if (kind === 'bust' && _board.values[i] === 0 && i !== _bustAt) t.classList.add('dim');
    }, delay);
  }
  const wait = order * 18 + 520;
  setTimeout(() => showResultOverlay(kind, payout, net), wait);
}

function showResultOverlay(kind, payout, net) {
  if (_phase !== 'settle') return;
  const app = $('casinoVoltorbContent')?.querySelector('.vf-app');
  if (!app || app.querySelector('.vf-overlay')) return;
  const title = kind === 'bust' ? '本局结束'
    : kind === 'cap' ? '连锁封顶！'
    : kind === 'clear' ? '全部挖完！'
    : net > 0 ? '收手成功'
    : net === 0 ? '保本收手' : '止损收手';
  const money = `${net > 0 ? '+' : ''}${formatNum(net)}`;
  const overlay = document.createElement('div');
  overlay.className = 'vf-overlay';
  overlay.innerHTML = `<div class="vf-res-title">${title}</div>
      <div class="vf-res-main">×${_p}<span class="vf-res-label">连锁</span></div>
      <div class="vf-res-rows">
        <div class="vf-res-row"><span>返还</span><b>${formatNum(payout)}</b></div>
        <div class="vf-res-row"><span>净</span><b class="${net < 0 ? 'neg' : ''}">${money}</b></div>
      </div>
      <div class="vf-res-actions">
        <button type="button" class="casino-btn main vf-res-btn">再来一局</button>
      </div>`;
  app.appendChild(overlay);
  overlay.querySelector('.vf-res-btn').addEventListener('click', nextRound);
}

function nextRound() {
  _phase = 'bet';
  _stake = 0;
  _board = null;
  _revealed = [];
  _marks = [];
  _p = 1;
  _flips = 0;
  _busy = false;
  _bustAt = -1;
  render();
}
