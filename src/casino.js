// ===== 游戏厅（21 点） =====
// 消耗糖果的赌博玩法：玩家 vs 庄家比点数接近 21。
// 规则：标准 52 张牌；A = 1/11 取最优，J/Q/K = 10；玩家可要牌/停牌/加倍；
// 庄家点数 < 17 一直要牌；天然 21（前两张即 21 = 黑杰克）按 1.5 倍赔付；
// 下注/赔付均操作 gameData.items.candy，结算走 saveGame() + updateStats()。
import { $, showView, updateStats } from './ui.js';
import { gameData, saveGame, pushNav, formatNum, addSystemLog } from './state.js';
import { playCasino, playMahjongSfx } from './audio.js';
import { COIN_RATE, DEALER_STAND, BJ_MULT } from './config.js';

// ---------- 牌堆 ----------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RED = new Set(['♥', '♦']);

// 下注档位（代币）
const BETS = [5, 10, 25, 50, 100, 250];

// ---------- 首页场景 ----------
const SCENE_TILESET = './terrain/terrain-tileset.png';
const TILE = 24; // 瓦片显示放大倍率（与农田/饲育屋一致）
// 赌桌热区：场景第 5/6/7 行、第 3/4 列（0-based：行 4~6、列 2~3）
const SCENE_HOT = { x: 2 * TILE, y: 4 * TILE, w: 2 * TILE, h: 3 * TILE };
// 麻将桌热区：场景第 5/6 行、第 8/9 列（0-based：行 4~5、列 7~8）
const SCENE_MAHJONG = { x: 7 * TILE, y: 4 * TILE, w: 2 * TILE, h: 2 * TILE };
// 抽卡机热区：场景第 2/3 行、第 9/10 列（0-based：行 1~2、列 8~9）
const SCENE_GACHA1 = { x: 8 * TILE, y: 1 * TILE, w: 1 * TILE, h: 2 * TILE };
const SCENE_GACHA2 = { x: 9 * TILE, y: 1 * TILE, w: 1 * TILE, h: 2 * TILE };
// 场景地图：来自 tools/road-data.json 的 tile「casino」（11×9，{col,row} 为 terrain tileset 坐标）
const SCENE = {
  w: 11,
  h: 9,
  tiles: [
    [{col:79,row:47},{col:74,row:45},{col:75,row:45},{col:76,row:50},{col:77,row:50},{col:78,row:50},{col:78,row:50},{col:79,row:50},{col:73,row:45},{col:74,row:45},{col:75,row:45}],
    [{col:79,row:48},{col:74,row:42},{col:73,row:42},{col:76,row:51},{col:77,row:51},{col:78,row:51},{col:77,row:51},{col:79,row:51},{col:78,row:43},{col:79,row:43},{col:74,row:42}],
    [{col:74,row:42},{col:74,row:42},{col:74,row:42},{col:76,row:52},{col:77,row:52},{col:78,row:52},{col:78,row:52},{col:79,row:52},{col:78,row:44},{col:79,row:44},{col:74,row:42}],
    [{col:74,row:42},{col:74,row:42},{col:74,row:42},{col:76,row:53},{col:77,row:53},{col:78,row:53},{col:78,row:53},{col:80,row:46},{col:74,row:42},{col:74,row:42},{col:74,row:42}],
    [{col:74,row:42},{col:74,row:42},{col:74,row:46},{col:75,row:46},{col:77,row:43},{col:74,row:42},{col:74,row:42},{col:80,row:47},{col:81,row:47},{col:79,row:46},{col:74,row:42}],
    [{col:74,row:42},{col:78,row:46},{col:74,row:47},{col:75,row:47},{col:79,row:46},{col:74,row:42},{col:78,row:46},{col:80,row:48},{col:81,row:48},{col:73,row:42},{col:74,row:42}],
    [{col:74,row:42},{col:74,row:42},{col:74,row:48},{col:75,row:48},{col:77,row:45},{col:74,row:42},{col:73,row:42},{col:73,row:42},{col:81,row:49},{col:73,row:42},{col:74,row:42}],
    [{col:74,row:42},{col:74,row:42},{col:74,row:42},{col:74,row:42},{col:74,row:42},{col:74,row:42},{col:74,row:42},{col:73,row:42},{col:73,row:42},{col:74,row:42},{col:74,row:42}],
    [{col:73,row:42},{col:73,row:42},{col:73,row:42},{col:73,row:42},{col:78,row:42},{col:79,row:41},{col:79,row:42},{col:73,row:42},{col:73,row:42},{col:73,row:42},{col:73,row:42}],
  ],
};

// ---------- 对局状态 ----------
let _deck = [];      // 剩余牌堆
let _player = [];    // 玩家手牌
let _dealer = [];    // 庄家手牌
let _bet = 5;      // 下注档位
let _stake = 0;      // 本局实际投入（含加倍）
let _phase = 'bet';  // bet=下注 | play=对局中 | settle=已结算
let _doubled = false;
let _busy = false;   // 庄家回合动画中，禁止操作
let _lastResult = null; // 上局结果文案（下注区展示）
let _settleMsg = null;  // 本局结算消息（牌桌展示）
let _dealAnim = null;   // 最近发到的手牌区（player/dealer）：其最后一张牌播放入场动画
let _flipFirst = false; // 结算时庄家第一张暗牌翻开播翻转动画
let _bustFlag = 0;       // 0=无爆牌 1=玩家爆牌 2=庄家爆牌（渲染后即清）
let _winnerPile = false;  // 有赢家时：渲染后筹码堆飞向赢方

const sleep = ms => new Promise(r => setTimeout(r, ms));
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

// 洗牌（Fisher-Yates）
function buildDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 手牌点数：A 按 11 计，超过 21 时逐个降为 1
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { aces++; total += 11; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J') total += 10;
    else total += +c.rank;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

// 黑杰克：前两张即 21
function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

// 软点数：含 A 且 A 按 11 计不爆牌。此时点数是不稳定的（再补牌可能把 A 降为 1 导致点数变小）
function handIsSoft(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { aces++; total += 11; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J') total += 10;
    else total += +c.rank;
  }
  return aces > 0 && total <= 21;
}

const candy = () => gameData.items['candy'] || 0;
const coin = () => gameData.items['casinoCoin'] || 0;

// ---------- 进入页面 ----------
export function showCasinoView() {
  pushNav('casinoView');
  showView('casinoView');
  playCasino();
  renderScene();
}

// 游戏厅首页：仿训练/饲育屋整页场景布局 + 赌桌/麻将桌热区（data-tip 走游戏统一 tooltip，点击分别跳转 21 点/口袋麻将）
function renderScene() {
  const box = $('casinoContent');
  if (!box) return;
  box.innerHTML = `
    <div class="casino-scene-page">
      <div class="casino-scene">
        <canvas class="casino-scene-canvas" width="${SCENE.w * TILE}" height="${SCENE.h * TILE}"></canvas>
        <div class="casino-scene-hot" data-tip="21 点"
          style="left:${SCENE_HOT.x}px;top:${SCENE_HOT.y}px;width:${SCENE_HOT.w}px;height:${SCENE_HOT.h}px"></div>
        <div class="casino-scene-hot" data-tip="口袋麻将"
          style="left:${SCENE_MAHJONG.x}px;top:${SCENE_MAHJONG.y}px;width:${SCENE_MAHJONG.w}px;height:${SCENE_MAHJONG.h}px"></div>
        <div class="casino-scene-hot" data-tip="1号抽卡机"
          style="left:${SCENE_GACHA1.x}px;top:${SCENE_GACHA1.y}px;width:${SCENE_GACHA1.w}px;height:${SCENE_GACHA1.h}px"></div>
        <div class="casino-scene-hot" data-tip="2号抽卡机"
          style="left:${SCENE_GACHA2.x}px;top:${SCENE_GACHA2.y}px;width:${SCENE_GACHA2.w}px;height:${SCENE_GACHA2.h}px"></div>
        <div class="casino-scene-hot casino-coin-exchange" data-tip="兑换游戏币"
          style="left:${4*TILE}px;top:${1*TILE}px;width:${3*TILE}px;height:${2*TILE}px"></div>
      </div>
    </div>`;
  const hots = box.querySelectorAll('.casino-scene-hot');
  hots[0]?.addEventListener('click', enterTable);
  hots[1]?.addEventListener('click', enterMahjong);
  hots[2]?.addEventListener('click', () => import('./gacha.js').then(m => m.showGachaView(1)));
  hots[3]?.addEventListener('click', () => import('./gacha.js').then(m => m.showGachaView(2)));
  hots[4]?.addEventListener('click', exchangeCoin);
  drawScene(box.querySelector('.casino-scene-canvas'));
}

// 绘制 tile 地图到画布（与饲育屋/农田同款 tileset，放大 1.5x 像素风）
function drawScene(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = SCENE.w * TILE, ch = SCENE.h * TILE;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  const img = new Image();
  img.onload = () => {
    for (let r = 0; r < SCENE.h; r++) {
      for (let c = 0; c < SCENE.w; c++) {
        const { col: tc, row: tr } = SCENE.tiles[r][c];
        ctx.drawImage(img, tc * 16, tr * 16, 16, 16, c * TILE, r * TILE, TILE, TILE);
      }
    }
  };
  img.src = SCENE_TILESET;
}

// 点击赌桌：重置对局并跳转到独立的 21 点页面
function enterTable() {
  _phase = 'bet';
  _deck = [];
  _player = [];
  _dealer = [];
  _stake = 0;
  _doubled = false;
  _busy = false;
  _settleMsg = null;
  pushNav('casinoGameView');
  showView('casinoGameView');
  renderCasino();
}

// 点击兑换区：1000 糖果 = 50 代币
const COIN_EXCHANGE_OPTIONS = [100, 500, 1000, 5000, 10000];

function exchangeCoin() {
  const bal = candy();
  if (bal <= 0) { hideExchangeMenu(); return; }
  hideExchangeMenu();
  const menu = document.createElement('div');
  menu.id = 'exchangeCoinMenu';
  menu.className = 'shop-ctx-menu casino-exchange-menu';
  const renderMenu = () => {
    const b = candy();
    menu.innerHTML = COIN_EXCHANGE_OPTIONS.map(n => {
      const ok = b >= n;
      const coins = Math.floor(n / COIN_RATE);
      return `<div class="shop-ctx-item${ok ? '' : ' disabled'}" data-n="${n}">
        <span class="shop-ctx-qty"><img src="./items/coin.png" style="width:10px;height:10px;vertical-align:middle;image-rendering:pixelated;" /> ${formatNum(coins)}</span>
        <span class="shop-ctx-cost"><img src="./items/candy.png" style="width:10px;height:10px;vertical-align:middle;image-rendering:pixelated;" /> ×${formatNum(n)}</span>
      </div>`;
    }).join('');
  };
  renderMenu();
  document.body.appendChild(menu);
  const scene = document.querySelector('.casino-coin-exchange');
  if (scene) {
    const r = scene.getBoundingClientRect();
    menu.style.left = Math.max(4, r.left) + 'px';
    menu.style.top = Math.max(4, r.bottom + 2) + 'px';
  }
  menu.addEventListener('pointerdown', e => e.stopPropagation());
  menu.onclick = (e) => {
    const item = e.target.closest('.shop-ctx-item');
    if (!item || item.classList.contains('disabled')) return;
    const n = parseInt(item.dataset.n);
    if (!n || n > candy()) return;
    gameData.items['candy'] -= n;
    const earned = Math.floor(n / COIN_RATE);
    gameData.items['casinoCoin'] = (gameData.items['casinoCoin'] || 0) + earned;
    addSystemLog('casino', { exchange: 'candy-to-coin', amount: n, earned, coinBalance: gameData.items['casinoCoin'] });
    saveGame().then(updateStats);
    renderMenu();  // 刷新菜单可兑换状态
  };
  document.addEventListener('pointerdown', hideExchangeMenu);
}
function hideExchangeMenu() {
  const m = document.getElementById('exchangeCoinMenu');
  if (m) m.remove();
  document.removeEventListener('pointerdown', hideExchangeMenu);
}

// 赢家筹码：输方筹码一枚一枚依次飞到赢方堆旁边，自成新摞
function flyPile(container) {
  const loser = document.getElementById('pile-dealer');
  const winPile = document.getElementById('pile-player');
  const playerWon = (_settleMsg && _settleMsg.net > 0);
  const source = playerWon ? loser : winPile;
  const dest = playerWon ? winPile : loser;
  if (!source || !dest) return;

  const coins = [...source.querySelectorAll('.casino-coin-pile-stack')];
  if (!coins.length) return;
  const sr = source.getBoundingClientRect();
  const dr = dest.getBoundingClientRect();
  // 飞向赢方堆旁边（右偏 18px），垂直对齐并逐枚叠成新摞
  const dx = dr.left + dr.width + 10 - sr.left - sr.width / 2;
  const dy = dr.top - sr.top;

  coins.forEach((coin, i) => {
    setTimeout(() => {
      coin.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.3s ease';
      coin.style.transform = `translate(${dx}px, ${dy - i * 2}px) scale(1.1)`;
      coin.style.opacity = '0.9';
      coin.style.zIndex = String(100 + i);
    }, i * 60);
  });
}

// ---------- 渲染（21 点页） ----------
function renderCasino() {
  const box = $('casinoGameContent');
  if (!box) return;
  const balance = coin();
  let html = `<div class="casino-app">`;

  if (_phase === 'bet') {
    html += renderBetArea(balance);
  } else {
    html += renderTable();
  }

  html += `</div>`;
  box.innerHTML = html;
  bindCasino();
  // 动画标记只用一次：渲染完即清，避免重复渲染重播动画
  _dealAnim = null;
  _flipFirst = false;
  _bustFlag = 0;
  if (_winnerPile) { _winnerPile = false; flyPile(box); }
}

// 下注区（21 点 / 口袋麻将共用）：点击式刻度条（自制，非原生 range）+ 开始对局 dock 贴底
// holder: { bet, lastResult }——余额不足时自动回落到可承受档位并写回 holder.bet
function renderBetAreaCommon(balance, holder, startId, startText) {
  // 余额不足以维持当前档位时，自动落到可承受的最高档位
  const maxAffIdx = BETS.findIndex(b => b > balance);
  const sliderMax = maxAffIdx === -1 ? BETS.length - 1 : maxAffIdx - 1;
  if (sliderMax >= 0 && holder.bet > BETS[sliderMax]) holder.bet = BETS[sliderMax];
  const disabled = sliderMax < 0; // 连最低档都买不起：刻度条与开始按钮禁用
  // 每个档位：圆点（点击选择），选中档位上方浮出糖果 icon、下方标注金额
  const ticks = BETS.map((b, i) => `
    <div class="casino-bet-tick${b > balance ? ' off' : ''}${b === holder.bet ? ' sel' : ''}"
      data-i="${i}" style="left:${(i / (BETS.length - 1)) * 100}%">
      <img class="casino-bet-coin" src="./items/coin.png" alt="">
      <span class="casino-bet-dot"></span>
      <span class="casino-bet-value">${formatNum(b)}</span>
    </div>`).join('');
  return `
    <div class="casino-bet-area">
      <div class="casino-bet-body">
        <div class="casino-bet-label-row">
          <div class="casino-bet-label">选择下注档位</div>
          <button class="casino-history-btn" id="casinoHistoryBtn">战绩</button>
        </div>
        <div class="casino-bet-slider${disabled ? ' disabled' : ''}">
          <div class="casino-bet-ticks">${ticks}</div>
        </div>
        <div class="casino-bet-row">
          <span class="casino-bet-amount">当前注额 <b>${formatNum(holder.bet)}</b></span>
        </div>
        ${holder.lastResult ? `<div class="casino-last">上局：${holder.lastResult}</div>` : ''}
      </div>
      <button class="bottom-dock" id="${startId}" ${disabled ? 'disabled' : ''}>${startText}</button>
    </div>`;
}

// 下注区（21 点）
function renderBetArea(balance) {
  const holder = { bet: _bet, lastResult: _lastResult };
  const startText = balance <= 0 ? '请在柜台兑换游戏币再来' : '开始对局';
  const html = renderBetAreaCommon(balance, holder, 'casinoStart', startText);
  _bet = holder.bet; // 同步自动回落的档位
  return html;
}

// 牌桌（对局中 / 已结算共用：settle 时翻开庄家暗牌）
function renderTable() {
  const dealerFaceDown = _phase === 'play' && _dealer.length >= 2;
  // 爆牌散开：每张牌随机方向
  const bustStyles = (i) => `style="--bx:${(i%2?-1:1)*(15+Math.random()*25)}px;--by:${-(10+Math.random()*20)}px;--br:${(i%2?-1:1)*(8+Math.random()*12)}deg"`;
  let dealerCards = '';
  for (let i = 0; i < _dealer.length; i++) {
    const isNew = _dealAnim === 'dealer' && i === _dealer.length - 1;
    if (dealerFaceDown && i === 0) {
      dealerCards += cardBackHtml(isNew);
    } else if (_phase === 'settle' && i === 0 && _flipFirst) {
      dealerCards += cardHtml(_dealer[i], false, true, _bustFlag === 2 ? bustStyles(i) : '');
    } else {
      dealerCards += cardHtml(_dealer[i], isNew, false, _bustFlag === 2 ? bustStyles(i) : '');
    }
  }
  const playerCards = _player.map((c, i) =>
    cardHtml(c, _dealAnim === 'player' && i === _player.length - 1, false, _bustFlag === 1 ? bustStyles(i) : '')).join('');
  // 对局中庄家只显示明牌点数（暗牌不计入）；结算后显示全部
  // 庄家已亮出的牌（暗牌除外）：庄家每摸一张，总点数实时更新
  const dealerShow = dealerFaceDown ? _dealer.slice(1) : _dealer;
  const playerVal = handValue(_player);
  const playerSoft = handIsSoft(_player);
  const dealerVal = handValue(dealerShow);
  // 软点数（A 按 11 计）标注「软」：A 是灵活值，再补牌可能降为 1 导致点数变小
  const dealerValHtml = `点数 ${dealerVal}${handIsSoft(dealerShow) ? '（软）' : ''}`;
  // 点数高的一方加粗（玩家爆牌则庄家高亮，庄家爆牌则玩家高亮）
  const settleDV = _phase === 'settle' ? handValue(_dealer) : dealerVal;
  const dLead = settleDV > playerVal && settleDV <= 21;
  const pLead = playerVal > settleDV && playerVal <= 21 || (settleDV > 21 && playerVal <= 21);
  const valCls = (v) => v > 21 ? ' bust' : v === 21 ? ' bj' : '';

  // 下注堆叠：显示在本方手牌标签左侧（dealer=上，player=下）
  const pileHtml = (side, n, doubled) => {
    const count = Math.min(8, Math.max(1, Math.round(n / BETS[0])));
    const cls = `casino-coin-pile ${side}${doubled ? ' doubled' : ''}`;
    const id = `pile-${side}`;
    const coins = Array.from({ length: count }, (_, i) =>
      `<img src="./items/coin.png" class="casino-coin-pile-stack" style="z-index:${i + 1};transform:translateY(${-i * 2}px)" />`
    ).join('');
    return `<div class="${cls}" id="${id}">${coins}</div>`;
  };

  return `
    <div class="casino-table">
      ${_phase === 'settle' ? renderSettleBanner() : ''}
      <div class="casino-hands">
        <div class="casino-hand${_bustFlag === 2 ? ' busted' : ''}">
          <div class="casino-hand-label">庄家 <span class="casino-hand-value${valCls(settleDV)}${dLead ? ' lead' : ''}">${dealerValHtml}</span></div>
          <div class="casino-cards">${dealerCards}</div>
        </div>
        <div class="casino-hand${_bustFlag === 1 ? ' busted' : ''}">
          <div class="casino-hand-label">玩家 <span class="casino-hand-value${valCls(playerVal)}${pLead ? ' lead' : ''}">点数 ${playerVal}${playerSoft ? '（软）' : ''}${_doubled ? ' · 加倍' : ''}</span></div>
          <div class="casino-cards">${playerCards}</div>
        </div>
        <div class="casino-coin-piles">
          ${pileHtml('dealer', _stake, false)}
          ${pileHtml('player', _stake, _doubled)}
        </div>
      </div>
      ${_phase === 'play' ? renderActions() : renderSettleArea()}
    </div>`;
}

// 对局中操作按钮（发牌动画期间禁用）
function renderActions() {
  const playerVal = handValue(_player);
  const canDouble = !_doubled && _player.length === 2 && coin() >= _stake;
  const busted = playerVal > 21;
  const lock = _busy ? 'disabled' : '';
  return `
    <div class="casino-actions">
      <button class="casino-btn main" id="casinoHit" ${lock || busted ? 'disabled' : ''}>要牌</button>
      <button class="casino-btn" id="casinoStand" ${lock || busted ? 'disabled' : ''}>停牌</button>
      <button class="casino-btn" id="casinoDouble" ${lock || !canDouble || busted ? 'disabled' : ''}>加倍</button>
    </div>`;
}

// 结算横幅：文案显示在牌桌顶部居中
function renderSettleBanner() {
  if (!_settleMsg) return '';
  const cls = _settleMsg.net > 0 ? 'win' : _settleMsg.net === 0 ? 'push' : 'lose';
  if (_settleMsg.net === 0) return `<div class="casino-result ${cls}">${_settleMsg.text}</div>`;
  const sign = _settleMsg.net > 0 ? '+' : '';
  return `<div class="casino-result ${cls}">${_settleMsg.text} <b>${sign}${formatNum(_settleMsg.net)}</b></div>`;
}

// 结算区：仅「再来一局」按钮，单独一行居中
function renderSettleArea() {
  return `
    <div class="casino-actions">
      <button class="casino-btn main" id="casinoAgain">再来一局</button>
    </div>`;
}

// 单张牌（deal=入场动画 flip=翻转动画 extra=附加style属性如爆牌散开）
function cardHtml(c, deal = false, flip = false, extra = '') {
  const cls = deal ? ' dealing' : flip ? ' flip' : '';
  return `<div class="casino-card${RED.has(c.suit) ? ' red' : ''}${cls}" ${extra}><span class="casino-card-rank">${c.rank}</span><span class="casino-card-suit">${c.suit}</span></div>`;
}
function cardBackHtml(deal = false) {
  return `<div class="casino-card back${deal ? ' dealing' : ''}">
    <svg class="casino-card-back-icon" viewBox="0 0 1024 1024">
      <use xlink:href="./icons/sprites.svg#icon-card-back" />
    </svg>
  </div>`;
}

// ---------- 交互（render 后绑定） ----------
function bindCasino() {
  const box = $('casinoGameContent');
  if (!box) return;
  // 点击式刻度条：点击档位圆点选择注额（不可负担的档位已置灰，忽略点击）
  const ticks = box.querySelectorAll('.casino-bet-tick');
  for (const t of ticks) t.addEventListener('click', () => {
    if (_phase !== 'bet' || t.classList.contains('off')) return;
    _bet = BETS[+t.dataset.i];
    renderCasino();
  });
  const start = box.querySelector('#casinoStart');
  if (start) start.addEventListener('click', startRound);
  const hist = box.querySelector('#casinoHistoryBtn');
  if (hist) hist.addEventListener('click', () => showCasinoHistoryView('bj'));
  const hit = box.querySelector('#casinoHit');
  if (hit) hit.addEventListener('click', onHit);
  const stand = box.querySelector('#casinoStand');
  if (stand) stand.addEventListener('click', onStand);
  const dbl = box.querySelector('#casinoDouble');
  if (dbl) dbl.addEventListener('click', onDouble);
  const again = box.querySelector('#casinoAgain');
  if (again) again.addEventListener('click', nextRound);
}

// 开局：扣注额 -> 逐张发牌（玩家1 / 庄家1 / 玩家2 / 庄家2，庄家第 1 张为暗牌）
async function startRound() {
  if (_phase !== 'bet') return;
  if (_bet <= 0 || coin() < _bet) return;
  gameData.items['casinoCoin'] -= _bet;
  _stake = _bet;
  _deck = buildDeck();
  _player = [];
  _dealer = [];
  _doubled = false;
  _phase = 'play';
  _lastResult = null;
  _settleMsg = null;
  _busy = true; // 发牌动画期间锁定操作按钮
  updateStats(); // 扣款即时反映到状态栏
  renderCasino();
  for (const target of ['player', 'dealer', 'player', 'dealer']) {
    const c = _deck.pop();
    (target === 'player' ? _player : _dealer).push(c);
    _dealAnim = target; // 最后一张牌播放入场动画
    renderCasino();
    playMahjongSfx('ui');
    await sleep(230);
  }
  _busy = false;
  renderCasino(); // 解除发牌锁定：重新渲染，要牌/停牌/加倍按钮恢复可点
  // 玩家天然黑杰克：立即结算（若庄家也是黑杰克则平局）
  if (isBlackjack(_player)) {
    settleRound();
  }
}

// 要牌
async function onHit() {
  if (_phase !== 'play' || _busy) return;
  _player.push(_deck.pop());
  _dealAnim = 'player';
  renderCasino();
  playMahjongSfx('ui');
  const val = handValue(_player);
  if (val > 21) {
    _busy = true;
    await sleep(450);
    _busy = false;
    settleRound();
  } else if (val === 21) {
    _busy = true;
    await sleep(450); // 稍作展示，自动停牌进入庄家回合
    _busy = false;
    await dealerPlay();
  }
}

// 停牌：进入庄家回合
async function onStand() {
  if (_phase !== 'play' || _busy) return;
  await dealerPlay();
}

// 加倍：再扣一份注额，只补 1 张，随后自动进入庄家回合
async function onDouble() {
  if (_phase !== 'play' || _busy) return;
  if (_doubled || _player.length !== 2 || coin() < _stake) return;
  gameData.items['casinoCoin'] -= _stake;
  _stake *= 2;
  _doubled = true;
  updateStats(); // 加倍扣款即时反映到状态栏
  _player.push(_deck.pop());
  _dealAnim = 'player';
  renderCasino();
  playMahjongSfx('ui');
  if (handValue(_player) > 21) {
    _busy = true;
    await sleep(450);
    _busy = false;
    settleRound();
    return;
  }
  await dealerPlay();
}

// 庄家回合：<17 一直要牌，逐张展示
async function dealerPlay() {
  _busy = true;
  while (handValue(_dealer) < DEALER_STAND) {
    _dealer.push(_deck.pop());
    renderCasino();
    playMahjongSfx('ui');
    await sleep(650);
  }
  _busy = false;
  settleRound();
}

// ---------- 结算 ----------
function settleRound() {
  if (_phase === 'settle') return;
  const pv = handValue(_player);
  const dv = handValue(_dealer);
  const pBj = isBlackjack(_player);
  const dBj = isBlackjack(_dealer);

  let profit = 0; // 总返还（含本金）
  let text = '';
  let action = 'lose';

  if (pBj && dBj) {
    profit = _stake; // 平局：返还本金
    text = '双方黑杰克，平局，返还';
    action = 'push';
  } else if (pBj) {
    profit = Math.round(_stake * (1 + BJ_MULT));
    text = `黑杰克！${BJ_MULT} 倍`;
    action = 'blackjack';
    _winnerPile = true;
  } else if (pv > 21) {
    profit = 0;
    text = '爆牌了';
    action = 'lose';
    _bustFlag = 1; // 玩家爆牌
    _winnerPile = true;
  } else if (dv > 21) {
    profit = _stake * 2;
    text = '庄家爆牌';
    action = 'win';
    _bustFlag = 2; // 庄家爆牌
    _winnerPile = true;
  } else if (dBj && !pBj) {
    profit = 0;
    text = '庄家黑杰克';
    action = 'lose';
    _winnerPile = true;
  } else if (pv > dv) {
    profit = _stake * 2;
    text = '你赢了';
    action = 'win';
    _winnerPile = true;
  } else if (pv === dv) {
    profit = _stake;
    text = '平局，返还';
    action = 'push';
  } else {
    profit = 0;
    text = '庄家赢';
    action = 'lose';
    _winnerPile = true;
  }

  gameData.items['casinoCoin'] += profit;
  const net = profit - _stake; // 净盈亏
  _lastResult = net === 0 ? text : `${text} ${net > 0 ? '+' + formatNum(net) : formatNum(net)} 游戏币`;
  _settleMsg = { text, net };
  addSystemLog('casino', { action, stake: _stake, profit: net, player: pv, dealer: dv });
  // 战绩存储（滑动窗口 50 条）
  gameData.casinoRecords = gameData.casinoRecords || [];
  gameData.casinoRecords.unshift({ time: Date.now(), bet: _stake, action, result: text, net });
  if (gameData.casinoRecords.length > 50) gameData.casinoRecords.length = 50;
  _phase = 'settle';
  _flipFirst = true; // 结算翻开庄家暗牌（带翻转动画）
  saveGame().then(updateStats);
  renderCasino();
}

// 再来一局：回到下注状态
function nextRound() {
  _phase = 'bet';
  _deck = [];
  _player = [];
  _dealer = [];
  _stake = 0;
  _doubled = false;
  _busy = false;
  _settleMsg = null;
  _dealAnim = null;
  _flipFirst = false;
  _bustFlag = 0;
  _winnerPile = false;
  renderCasino();
}

// ---------- 战绩记录查看（21点 / 麻将共用） ----------
function fmtHistoryTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// source: 'bj' 21点 | 'mj' 麻将
export function showCasinoHistoryView(source) {
  pushNav('casinoHistoryView');
  const content = $('casinoHistoryContent');
  if (!content) return;
  const isMj = source === 'mj';
  const records = (isMj ? gameData.mahjongRecords : gameData.casinoRecords) || [];
  const title = isMj ? '口袋麻将战绩' : '21点战绩';
  const CN = ['零', '一', '二', '三', '四'];
  // 徽章（仿抽卡记录 tier 色块）：21点按输赢上色；麻将按名次上色
  const badge = r => {
    if (isMj) {
      const colors = ['#d4850a', '#8a8a8a', '#b87333', '#5a5a5a'];
      return { text: `第${CN[r.rank - 1]}名`, bg: colors[r.rank - 1] || '#7a8a8a' };
    }
    if (r.action === 'win' || r.action === 'blackjack') return { text: '赢', bg: '#d4850a' };
    if (r.action === 'lose') return { text: '输', bg: '#b5544e' };
    return { text: '平', bg: '#7a8a8a' };
  };
  content.innerHTML = `
    <div style="border-bottom:1px solid var(--ui-color);margin-bottom:3px;font-size:10px;">${title} · ${records.length} 场</div>
    ${records.length === 0 ? '<div style="padding:12px 4px;text-align:center;">暂无战绩</div>' : ''}
    ${records.map(r => {
    const time = fmtHistoryTime(r.time);
    const b = badge(r);
    const note = isMj ? `下注 ${formatNum(r.stake)} 档` : r.result;
    const color = r.net > 0 ? '#d4850a' : r.net < 0 ? '#b5544e' : 'rgba(255,255,255,0.45)';
    return `<div style="font-size:10px;line-height:1.8;padding:1px 0;display:flex;align-items:baseline;">
        <span style="opacity:0.6;margin-right:12px;flex-shrink:0;">${time}</span>
        <span style="font-size:8px;padding:0 3px;border-radius:2px;color:#fff;margin:0 8px;min-width:30px;text-align:center;display:inline-block;background:${b.bg}">${b.text}</span>
        <span style="flex:1;">${note}</span>
        <span style="flex-shrink:0;margin-left:14px;color:${color};">${r.net > 0 ? '+' : ''}${formatNum(r.net)}</span>
      </div>`;
  }).join('')}
  `;
  showView('casinoHistoryView');
}

// 点击麻将桌：进入独立的口袋麻将玩法页（src/mahjong.js）
function enterMahjong() {
  import('./mahjong.js').then(m => m.showMahjongView());
}
