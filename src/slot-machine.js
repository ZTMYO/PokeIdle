// ===== 老虎机（游戏厅二楼 3 号机） =====
import { $, showView, updateStats, showConfirmBar, hideConfirmBar, getCurrentView } from './ui.js';
import { gameData, saveGame, pushNav, popNav, addSystemLog, formatNum } from './state.js';
import { grantItem, BERRY_ICONS, BERRY_NAMES } from './items.js';
import { ensureBerryFarm } from './berry.js';
import { getCardCollectionStats } from './album.js';
import { showRulesPanel, closeRulesPanel, isRulesPanelOpen } from './rules-panel.js';
import { playMahjongSfx, playSpinSfx, preloadSpinSfx } from './audio.js';

const COST = 10;
const BET_TIERS = [10, 50, 100, 500, 1000];
const REEL_H = 66;
const REEL_ITEMS = 18;
const WHEEL_TURNS = 5;
const WHEEL_ROW_H = 21;

// 橙橙果、桃桃果各代表一半树果池，各收 6 种
const BERRY_POOLS = [
  [6, 0, 1, 2, 3, 4],
  [7, 5, 8, 9, 10, 11],
].map(indices => indices.map((berry, i) => {
  const file = BERRY_ICONS[berry];
  return {
    name: BERRY_NAMES[file] || '树果',
    icon: `./items/berries/${file}`,
    qty: i % 2 ? 1 : 2,
    berry,
  };
}));

const POOLS = {
  berryA: { accent: '#e1ecc3', accent2: '#c8db99', items: BERRY_POOLS[0] },
  berryB: { accent: '#eee8b9', accent2: '#ddd287', items: BERRY_POOLS[1] },
  candy: { accent: '#d7e4fc', accent2: '#b3caf2', iconSize: 20, items: [10, 12, 15, 20, 25, 30, 35, 40].map(qty => ({ name: '糖果', key: 'candy', icon: './items/goods/candy.png', qty })) },
  coin: { accent: '#f7d2a8', accent2: '#eaa76a', iconSize: 20, items: [12, 13, 14, 15, 16, 18, 20, 25].map(qty => ({ name: '游戏币', key: 'casinoCoin', icon: './items/goods/coin.png', qty })) },
  poke: { accent: '#f1cec6', accent2: '#dfa89e', items: [2, 2, 5, 5, 5, 8, 8, 10].map(qty => ({ name: '精灵球', key: 'poke-ball', icon: './items/balls/poke-ball.png', qty })) },
  ultra: { accent: '#f5e2a9', accent2: '#e6cb70', items: [2, 2, 2, 2, 4, 4, 4, 5].map(qty => ({ name: '高级球', key: 'ultra-ball', icon: './items/balls/ultra-ball.png', qty })) },
  egg: { accent: '#f0dfc8', accent2: '#e0c49f', items: [1, 1, 1, 1, 2, 2, 2, 2].map(qty => ({ name: '神秘蛋', key: 'mystery-egg', icon: './items/goods/mystery-egg.png', qty })) },
  box: {
    accent: '#f1dcb4',
    accent2: '#dec082',
    items: [
      { name: '经验糖果', key: 'exp-candy', icon: './items/goods/xp-candy.png', qty: 2, weight: 10 },
      { name: '甜甜蜜', key: 'sweet-honey', icon: './items/goods/honey.png', qty: 2, weight: 20 },
      { name: '糖果', key: 'candy', icon: './items/goods/candy.png', qty: 20, weight: 20 },
      { name: '神秘蛋', key: 'mystery-egg', icon: './items/goods/mystery-egg.png', qty: 2, weight: 15 },
      { name: '精灵球', key: 'poke-ball', icon: './items/balls/poke-ball.png', qty: 12, weight: 15 },
      { name: '游戏币', key: 'casinoCoin', icon: './items/goods/coin.png', qty: 12, weight: 10 },
      { name: '高级球', key: 'ultra-ball', icon: './items/balls/ultra-ball.png', qty: 5, weight: 10 },
    ],
  },
};

const SYMBOLS = [
  { id: 'candy', name: '糖果', icon: './items/goods/candy.png', weight: 220, pool: POOLS.candy },
  { id: 'coin', name: '游戏币', icon: './items/goods/coin.png', weight: 210, pool: POOLS.coin, iconSize: 34 },
  { id: 'poke', name: '精灵球', icon: './items/balls/poke-ball.png', weight: 130, pool: POOLS.poke },
  { id: 'berryA', name: '橙橙果', icon: `./items/berries/${BERRY_ICONS[6]}`, weight: 120, pool: POOLS.berryA },
  { id: 'berryB', name: '桃桃果', icon: `./items/berries/${BERRY_ICONS[7]}`, weight: 120, pool: POOLS.berryB },
  { id: 'ultra', name: '高级球', icon: './items/balls/ultra-ball.png', weight: 100, pool: POOLS.ultra },
  { id: 'egg', name: '神秘蛋', icon: './items/goods/mystery-egg.png', weight: 50, pool: POOLS.egg },
  { id: 'box', name: '补给箱', icon: './items/berry-trees/box.png', weight: 50, pool: POOLS.box },
];
const WEIGHT_TOTAL = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

let _g = null;
let _bet = COST;

const coin = () => gameData.items['casinoCoin'] || 0;
const rand = list => list[Math.floor(Math.random() * list.length)];
const betMult = (bet = _bet) => bet / COST;

// 奖励按注额等比放大：10 币 ×1，1000 币 ×100
function scaleItem(item) {
  const mult = (_g?.stake || COST) / COST;
  return { ...item, qty: Math.max(1, Math.round(item.qty * mult)) };
}

function setWheelLock(on) {
  window.__SLOT_WHEEL_LOCK__ = !!on;
}

function pickSymbol() {
  let r = Math.random() * WEIGHT_TOTAL;
  for (const s of SYMBOLS) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return SYMBOLS[0];
}

function samplePool(pool, count) {
  const left = pool.slice();
  const out = [];
  while (out.length < count && left.length) {
    const total = left.reduce((sum, x) => sum + (x.weight || 1), 0);
    let r = Math.random() * total;
    let pick = left.length - 1;
    for (let i = 0; i < left.length; i++) {
      r -= left[i].weight || 1;
      if (r <= 0) { pick = i; break; }
    }
    out.push(left.splice(pick, 1)[0]);
  }
  while (out.length < count) out.push(pool[Math.floor(Math.random() * pool.length)]);
  return out;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function buildWheelFace(pool, rewards) {
  const entries = rewards.map((item, drawIndex) => ({ item, drawIndex }));
  for (const item of samplePool(pool.items, 8 - rewards.length)) entries.push({ item: scaleItem(item) });
  shuffle(entries);
  const winIndices = Array(rewards.length);
  entries.forEach((entry, index) => {
    if (entry.drawIndex != null) winIndices[entry.drawIndex] = index;
  });
  return { segments: entries.map(entry => entry.item), winIndices };
}

function addReward(list, reward) {
  const found = list.find(x => x.name === reward.name && x.icon === reward.icon);
  if (found) found.qty += reward.qty;
  else list.push({ ...reward });
}

function symbolHtml(symbol) {
  const size = symbol.iconSize ? ` style="width:${symbol.iconSize}px;height:${symbol.iconSize}px"` : '';
  return `<div class="slot-sym"><img src="${symbol.icon}"${size} alt=""></div>`;
}

function matchOf(result) {
  const [a, b, c] = result;
  if (a.id === b.id && b.id === c.id) return 3;
  if (a.id === b.id || b.id === c.id || a.id === c.id) return 2;
  return 0;
}

function symbolOf(result) {
  const [a, b, c] = result;
  if (a.id === b.id) return a;
  if (b.id === c.id) return b;
  return c;
}

function clearWins() {
  for (let i = 0; i < 3; i++) $('slotReel' + i).classList.remove('win');
}

function markWins(result) {
  clearWins();
  const match = matchOf(result);
  if (match === 3) {
    for (let i = 0; i < 3; i++) $('slotReel' + i).classList.add('win');
    return;
  }
  if (!match) return;
  const [a, b, c] = result;
  if (a.id === b.id) { $('slotReel0').classList.add('win'); $('slotReel1').classList.add('win'); }
  if (b.id === c.id) { $('slotReel1').classList.add('win'); $('slotReel2').classList.add('win'); }
  if (a.id === c.id) { $('slotReel0').classList.add('win'); $('slotReel2').classList.add('win'); }
}

function rollReward(symbol) {
  return scaleItem(rand(samplePool(symbol.pool.items, 8)));
}

function grantSpin(match, symbol, rewards) {
  const summary = [];
  for (const reward of rewards) {
    if (reward.berry != null) {
      const farm = ensureBerryFarm();
      farm.stock[reward.berry] = (farm.stock[reward.berry] || 0) + reward.qty;
    } else {
      grantItem(reward.key, reward.qty, '老虎机', true);
    }
    addReward(summary, reward);
  }
  addSystemLog('slot-machine', {
    match,
    symbol: symbol ? symbol.name : null,
    draws: rewards.length,
    rewards: summary.map(r => ({ name: r.name, qty: r.qty })),
  });
  saveGame();
  updateStats();
  return summary;
}

export async function showSlotMachineView() {
  if (_g) {
    for (const t of _g.timers) clearTimeout(t);
    _g.timers = [];
  }
  document.getElementById('slotWheelOverlay')?.remove();
  closeRulesPanel();
  setWheelLock(false);
  if (_g?.spinAudio) _g.spinAudio.pause();
  preloadSpinSfx('spin1');
  let stats = null;
  try {
    stats = await getCardCollectionStats();
  } catch (e) {
    stats = null;
  }
  if (!stats || !stats.total || stats.owned < stats.total) {
    const text = !stats || !stats.total
      ? '卡册数据读取失败，稍后再试'
      : `卡册还差 ${stats.total - stats.owned} 张（${stats.owned}/${stats.total}），集齐后开放老虎机`;
    showConfirmBar(text, null, null, { singleButton: true, overlay: true });
    return;
  }

  pushNav('slotMachineView');
  showView('slotMachineView');
  _g = {
    phase: 'idle',
    timers: [],
    stake: COST,
    spinResult: null,
    match: 0,
    symbol: null,
    drawRewards: [],
    rewards: [],
    headline: '',
    wheel: null,
  };
  render();
}

export function leaveSlotMachineGame() {
  setWheelLock(false);
  if (_g) {
    for (const t of _g.timers) clearTimeout(t);
    _g.timers = [];
    stopSpinAudio();
    _g = null;
  }
  document.getElementById('slotWheelOverlay')?.remove();
  hideConfirmBar();
  if (getCurrentView() !== 'slotMachineView') return;
  const target = popNav();
  showView(target || 'casinoView');
}

function render() {
  const box = $('slotMachineContent');
  if (!box || !_g) return;
  box.innerHTML = `
    <div class="slot-app">
      <div class="slot-top">
        <div class="slot-headline" id="slotHeadline"></div>
        <button class="slot-rules" id="slotRules">规则</button>
      </div>
      <div class="slot-stage">
        <div class="slot-cabinet">
          <div class="slot-reels">
            ${[0, 1, 2].map(i => `<div class="slot-reel" id="slotReel${i}"><div class="slot-strip" id="slotStrip${i}">${symbolHtml(SYMBOLS[i])}</div></div>`).join('')}
          </div>
          <div class="slot-cost"><b id="slotCost">${_bet}</b><img src="./items/goods/coin.png" alt=""><span>/ 转</span></div>
        </div>
      </div>
      <div class="slot-betbar">
        <div class="slot-bet-opts">
          ${BET_TIERS.map(bet => `<button class="slot-bet-opt" data-bet="${bet}">${bet}</button>`).join('')}
        </div>
        <span class="slot-bet-mult" id="slotBetMult"></span>
      </div>
      <button class="bottom-dock" id="slotSpin"></button>
    </div>`;
  $('slotSpin').addEventListener('click', () => {
    if (_g?.phase === 'spinning') stopNextReel();
    else spin();
  });
  [0, 1, 2].forEach(i => $('slotReel' + i).addEventListener('click', () => stopReel(i)));
  box.querySelectorAll('.slot-bet-opt').forEach(btn => {
    btn.addEventListener('click', () => selectBet(+btn.dataset.bet));
  });
  $('slotRules').addEventListener('click', showRules);
  renderHeadline();
  renderControls();
}

function renderControls() {
  if (!_g) return;
  syncBetBar();
  const spin = $('slotSpin');
  if (!spin) return;
  const busy = _g.phase !== 'idle';
  const spinning = _g.phase === 'spinning';
  spin.disabled = !spinning && (busy || coin() < _bet);
  spin.textContent = spinning ? '停止' : '转动';
  spin.title = coin() < _bet && _g.phase === 'idle' ? '游戏币不足' : '';
  const rules = $('slotRules');
  if (rules) rules.disabled = busy;
}

function selectBet(bet) {
  if (!_g || _g.phase !== 'idle' || bet > coin()) return;
  _bet = bet;
  renderControls();
}

function syncBetBar() {
  if (!_g) return;
  const busy = _g.phase !== 'idle';
  // 结算后余额不够当前档位时，自动落到买得起的最高档；连最低档都买不起就停在 10
  if (!busy && _bet > coin()) {
    _bet = COST;
    for (const bet of BET_TIERS) if (bet <= coin()) _bet = bet;
  }
  const cost = $('slotCost');
  if (cost) cost.textContent = String(_bet);
  const mult = $('slotBetMult');
  if (mult) mult.textContent = `奖励×${betMult()}`;
  const box = $('slotMachineContent');
  if (!box) return;
  for (const btn of box.querySelectorAll('.slot-bet-opt')) {
    const bet = +btn.dataset.bet;
    btn.classList.toggle('sel', bet === _bet);
    btn.disabled = busy || bet > coin();
  }
}

function renderHeadline() {
  if (!_g) return;
  const el = $('slotHeadline');
  if (el) el.textContent = _g.headline || '';
}

function setHeadline(text) {
  if (!_g) return;
  _g.headline = text;
  renderHeadline();
}

function showRules() {
  if (!_g || _g.phase !== 'idle' || isRulesPanelOpen()) return;
  const pairPct = SYMBOLS.reduce((sum, sym) => {
    const p = sym.weight / WEIGHT_TOTAL;
    return sum + 3 * p * p * (1 - p);
  }, 0) * 100;
  const triplePct = SYMBOLS.reduce((sum, sym) => {
    const p = sym.weight / WEIGHT_TOTAL;
    return sum + p * p * p;
  }, 0) * 100;
  const symbolPct = SYMBOLS.map(sym => `${sym.name}${(sym.weight / WEIGHT_TOTAL * 100).toFixed(0)}%`).join(' / ');
  showRulesPanel('slotMachineContent', '老虎机规则', `
    <div class="game-rule-row"><b>下注</b><span>底部选择注额，最高 1000 游戏币；奖励按注额等比放大（最高 ×100），中奖概率不变</span></div>
    <div class="game-rule-row"><b>中奖</b><span>2同 ${pairPct.toFixed(2)}% / 3同 ${triplePct.toFixed(2)}%；2同抽1格，3同抽2格，其余不中奖</span></div>
    <div class="game-rule-row"><b>转盘</b><span>对应奖池随机取 8 格停 1 格，每格 1/8；</span></div>
    <div class="game-rule-row"><b>图案</b><span>单轮权重：${symbolPct}</span></div>`);
}


function spin() {
  if (!_g || _g.phase !== 'idle') return;
  if (coin() < _bet) return;

  for (const t of _g.timers) clearTimeout(t);
  _g.timers = [];
  setWheelLock(false);
  _g.stake = _bet;
  gameData.items['casinoCoin'] = coin() - _g.stake;
  updateStats();
  _g.phase = 'spinning';
  _g.spinResult = [pickSymbol(), pickSymbol(), pickSymbol()];
  _g.match = matchOf(_g.spinResult);
  _g.symbol = _g.match ? symbolOf(_g.spinResult) : null;
  _g.drawRewards = [];
  _g.rewards = [];
  _g.headline = '';
  clearWins();
  renderHeadline();
  renderControls();

  const draws = _g.match === 3 ? 2 : _g.match === 2 ? 1 : 0;
  for (let i = 0; i < draws; i++) _g.drawRewards.push(rollReward(_g.symbol));
  _g.rewards = grantSpin(_g.match, _g.symbol, _g.drawRewards);

  _g.spinAudio = playSpinSfx('spin1', { loop: true });
  _g.reelStopped = [false, false, false];
  _g.reelTimers = [0, 1, 2].map(i => {
    const timer = setTimeout(() => stopReel(i), 6000 + i * 500);
    _g.timers.push(timer);
    return timer;
  });
  for (let i = 0; i < 3; i++) startReel(i);
}

function startReel(index) {
  const reel = $('slotReel' + index);
  const strip = $('slotStrip' + index);
  if (!reel || !strip) return;
  const items = Array.from({ length: REEL_ITEMS }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
  // 双份拼接，循环回位不闪空
  strip.innerHTML = items.concat(items).map(symbolHtml).join('');
  strip.style.animation = 'none';
  strip.style.transition = 'none';
  strip.style.transform = 'translateY(0px)';
  strip.style.setProperty('--roll-h', `${items.length * REEL_H}px`);
  void strip.offsetHeight;
  strip.style.animation = `slot-roll ${680 + index * 70}ms linear infinite`;
  reel.classList.add('spinning');
}

function stopNextReel() {
  if (!_g || _g.phase !== 'spinning') return;
  const index = _g.reelStopped.findIndex(v => !v);
  if (index >= 0) stopReel(index);
}

function stopReel(index) {
  if (!_g || _g.phase !== 'spinning' || _g.reelStopped[index]) return;
  _g.reelStopped[index] = true;
  clearTimeout(_g.reelTimers[index]);
  const reel = $('slotReel' + index);
  const strip = $('slotStrip' + index);
  if (reel) reel.classList.remove('spinning');
  if (strip) {
    strip.style.animation = 'none';
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0px)';
    strip.innerHTML = symbolHtml(_g.spinResult[index]);
  }
  playSpinSfx('stop');
  if (_g.reelStopped.every(Boolean)) finishSpin();
}

function stopSpinAudio() {
  if (!_g?.spinAudio) return;
  _g.spinAudio.pause();
  _g.spinAudio = null;
}

function finishSpin() {
  if (!_g || _g.phase !== 'spinning') return;
  stopSpinAudio();
  markWins(_g.spinResult);
  if (!_g.match) {
    _g.phase = 'idle';
    setHeadline('未中奖');
    renderControls();
    return;
  }
  setWheelLock(true);
  playSpinSfx('win');
  _g.phase = 'flash';
  setHeadline(`${_g.match === 3 ? '三连' : '对子'} · ${_g.symbol.name}`);
  renderControls();
  _g.timers.push(setTimeout(() => {
    if (!_g || _g.phase !== 'flash') return;
    _g.phase = 'wheel';
    openWheel();
  }, 1000));
}

function openWheel() {
  setWheelLock(true);
  const w = _g.wheel = {
    symbol: _g.symbol,
    total: _g.drawRewards.length,
    index: 0,
  };
  const overlay = document.createElement('div');
  overlay.className = 'slot-wheel-overlay';
  overlay.id = 'slotWheelOverlay';
  overlay.innerHTML = `
    <div class="slot-wheel-title" id="slotWheelTitle"></div>
    <div class="slot-wheel-rewards" id="slotWheelRewards"></div>
    <div class="slot-wheel-wrap">
      <div class="slot-wheel-rotor" id="slotWheelRotor"></div>
      <span class="slot-pokeball" aria-hidden="true">
        <i class="slot-pb-top"></i>
        <i class="slot-pb-band"></i>
        <i class="slot-pb-btn"></i>
      </span>
      <span class="slot-wheel-pointer"></span>
    </div>
    <div class="slot-wheel-result" id="slotWheelResult"></div>
    <div class="slot-wheel-action"><button type="button" class="casino-btn main slot-wheel-btn" id="slotWheelBtn" hidden>收下奖励</button></div>`;
  $('slotMachineContent').appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('#slotWheelBtn')) return;
    e.stopPropagation();
    skipWheel();
  });
  $('slotWheelBtn').addEventListener('click', closeWheel);
  const face = buildWheelFace(w.symbol.pool, _g.drawRewards);
  w.winIndices = face.winIndices;
  w.angle = 0;
  renderWheel(face.segments, w.symbol.pool);
  nextWheelDraw();
}

function nextWheelDraw() {
  if (!_g || !_g.wheel) return;
  const w = _g.wheel;
  if (w.index >= w.total) return;
  $('slotWheelTitle').textContent = `${w.symbol.name} ${w.index + 1}/${w.total}`;
  $('slotWheelResult').textContent = '自动转动…';
  $('slotWheelBtn').hidden = true;
  _g.timers.push(setTimeout(spinWheel, 350));
}

function spinWheel() {
  if (!_g || !_g.wheel) return;
  const w = _g.wheel;
  const index = w.winIndices[w.index];
  const rotor = $('slotWheelRotor');
  if (!rotor || index == null) return;
  rotor.querySelectorAll('path.slot-wheel-hit').forEach(el => el.classList.remove('slot-wheel-hit'));
  const current = w.angle || 0;
  const desired = ((-22.5 - index * 45) % 360 + 360) % 360;
  const currentMod = ((current % 360) + 360) % 360;
  const delta = (desired - currentMod + 360) % 360;
  const jitter = (Math.random() - 0.5) * 14;
  const deg = current + 360 * WHEEL_TURNS + delta + jitter;
  w.angle = deg;
  playSpinSfx('spin2');
  $('slotWheelResult').textContent = '转动中…';
  rotor.style.transition = 'transform 1.75s cubic-bezier(.16,.84,.2,1)';
  rotor.style.transform = `rotate(${deg}deg)`;
  rotor.querySelectorAll('.slot-wheel-qty').forEach(el => {
    el.style.transform = `rotate(${-deg}deg)`;
  });
  _g.timers.push(setTimeout(finishWheelDraw, 1850));
}

function addWheelRewardRow(reward, { silent = false, instant = false } = {}) {
  const list = $('slotWheelRewards');
  if (!list) return;
  if (!silent) playMahjongSfx('ui');
  for (const el of list.children) {
    const y = Number(el.dataset.y || 0) + WHEEL_ROW_H;
    el.dataset.y = String(y);
    if (instant) el.style.transition = 'none';
    el.style.transform = `translate(0, -${y}px)`;
  }
  const row = document.createElement('div');
  row.className = 'slot-wheel-reward';
  row.dataset.y = '0';
  row.innerHTML = `<img src="${reward.icon}" alt=""><span>×${formatNum(reward.qty)}</span>`;
  if (instant) row.style.transition = 'none';
  row.style.transform = instant ? 'translate(0, 0)' : 'translate(-140%, 0)';
  list.appendChild(row);
  if (!instant) {
    void row.offsetWidth;
    row.style.transform = 'translate(0, 0)';
  }
}

function finishWheelDraw() {
  if (!_g || !_g.wheel) return;
  const w = _g.wheel;
  const drawIndex = w.index;
  const reward = _g.drawRewards[drawIndex];
  const landed = w.winIndices[drawIndex];
  w.index++;
  addWheelRewardRow(reward);
  const rotor = $('slotWheelRotor');
  rotor?.querySelectorAll('path.slot-wheel-hit').forEach(el => el.classList.remove('slot-wheel-hit'));
  const hit = rotor?.querySelectorAll('path')[landed];
  if (hit) hit.classList.add('slot-wheel-hit');
  $('slotWheelResult').textContent = `获得 ${reward.name} ×${formatNum(reward.qty)}`;
  if (w.index >= w.total) {
    $('slotWheelTitle').textContent = `${w.symbol.name} ${w.total}/${w.total}`;
    $('slotWheelBtn').hidden = false;
    return;
  }
  $('slotWheelTitle').textContent = `${w.symbol.name} ${w.index + 1}/${w.total}`;
  _g.timers.push(setTimeout(nextWheelDraw, 550));
}

function skipWheel() {
  if (!_g || !_g.wheel) return;
  const w = _g.wheel;
  if (w.index >= w.total) return;
  for (const t of _g.timers) clearTimeout(t);
  _g.timers = [];
  const rotor = $('slotWheelRotor');
  const lastDraw = w.total - 1;
  const lastLanded = w.winIndices[lastDraw];
  if (rotor && lastLanded != null) {
    const desired = ((-22.5 - lastLanded * 45) % 360 + 360) % 360;
    const finalAngle = 360 * WHEEL_TURNS + desired;
    w.angle = finalAngle;
    rotor.style.transition = 'none';
    rotor.style.transform = `rotate(${finalAngle}deg)`;
    rotor.querySelectorAll('.slot-wheel-qty').forEach(el => {
      el.style.transition = 'none';
      el.style.transform = `rotate(${-finalAngle}deg)`;
    });
    rotor.querySelectorAll('path.slot-wheel-hit').forEach(el => el.classList.remove('slot-wheel-hit'));
    const hit = rotor.querySelectorAll('path')[lastLanded];
    if (hit) hit.classList.add('slot-wheel-hit');
  }
  let lastReward = null;
  while (w.index < w.total) {
    lastReward = _g.drawRewards[w.index];
    addWheelRewardRow(lastReward, { silent: true, instant: true });
    w.index++;
  }
  $('slotWheelTitle').textContent = `${w.symbol.name} ${w.total}/${w.total}`;
  if (lastReward) $('slotWheelResult').textContent = `获得 ${lastReward.name} ×${formatNum(lastReward.qty)}`;
  $('slotWheelBtn').hidden = false;
}

function closeWheel() {
  if (!_g || !_g.wheel || _g.wheel.index < _g.wheel.total) return;
  $('slotWheelOverlay')?.remove();
  const rewards = _g.rewards;
  _g.wheel = null;
  _g.phase = 'idle';
  setWheelLock(false);
  _g.headline = rewards.length === 1
    ? `获得 ${rewards[0].name} ×${formatNum(rewards[0].qty)}`
    : rewards.length
      ? `获得 ${rewards[0].name} ×${formatNum(rewards[0].qty)} 等 ${rewards.length} 项`
      : '获得奖励';
  renderHeadline();
  renderControls();
}

function renderWheel(segments, pool) {
  const C = 70, R = 66;
  let paths = '';
  let marks = '';
  for (let i = 0; i < 8; i++) {
    const a0 = (-90 + i * 45) * Math.PI / 180;
    const a1 = (-90 + (i + 1) * 45) * Math.PI / 180;
    const x1 = C + Math.cos(a0) * R;
    const y1 = C + Math.sin(a0) * R;
    const x2 = C + Math.cos(a1) * R;
    const y2 = C + Math.sin(a1) * R;
    const seg = segments[i];
    const fill = i % 2 ? pool.accent2 : pool.accent;
    paths += `<path d="M${C} ${C} L${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${fill}" stroke="#f3ead2" stroke-width=".8"/>`;

    const mid = (-90 + i * 45 + 22.5) * Math.PI / 180;
    const size = pool.iconSize || 24;
    const ix = C + Math.cos(mid) * 36;
    const iy = C + Math.sin(mid) * 36;
    const tx = C + Math.cos(mid) * 53;
    const ty = C + Math.sin(mid) * 53;
    marks += `<image href="${seg.icon}" x="${(ix - size / 2).toFixed(2)}" y="${(iy - size / 2).toFixed(2)}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
    marks += `<text class="slot-wheel-qty" x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="800" fill="#24563f">×${formatNum(seg.qty)}</text>`;
  }
  $('slotWheelRotor').innerHTML = `<svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
    ${paths}
    <circle cx="70" cy="70" r="66" fill="none" stroke="#24563f" stroke-width="1.2"/>
    ${marks}
  </svg>`;
}

// 其他入口离开时清掉计时器和遮罩
window.addEventListener('view-changed', (e) => {
  if (e.detail === 'slotMachineView' || !_g) return;
  for (const t of _g.timers) clearTimeout(t);
  _g.timers = [];
  stopSpinAudio();
  document.getElementById('slotWheelOverlay')?.remove();
  closeRulesPanel();
  setWheelLock(false);
  _g = null;
});
