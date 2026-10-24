// ===== 跳企鹅（游戏厅二楼第一台游戏机） =====
// 下注后企鹅踩着浮冰一路往右跳，每跳（含第一跳）都可能踩碎浮冰掉进水里；
// 每站住一次可提现额 ×PENGUIN_MULT，随时可以提现，跳到最右自动结算。
import { PENGUIN_STEPS, PENGUIN_BREAK_CHANCE, PENGUIN_MULT } from './config.js';
import { gameData, getPokemonByIndex, saveGame, pushNav, formatNum, addSystemLog } from './state.js';
import { $, showView, updateStats, tryLoadImage } from './ui.js';
import { playMahjongSfx } from './audio.js';
import { BETS, renderBetAreaCommon, showCasinoHistoryView } from './casino.js';

// ---------- 对局状态 ----------
let _phase = 'bet';    // bet=下注 | play=跳跃中 | settle=已结算
let _bet = BETS[0];    // 下注档位
let _stake = 0;        // 本局注额
let _step = 0;         // 已站住的步数（决定可提现额）
let _vis = 0;          // 企鹅视觉所在浮冰（跳跃/碎裂瞬间先落到下一格）
let _busy = false;     // 动画期间锁按钮
let _settle = null;    // 本局结算：{ text, net, netText, action }
let _lastResult = null; // 上局结果文案（下注页展示）
let _brokenAt = -1;    // 碎裂的那块浮冰（结算页保留碎裂画面）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coinOf = () => gameData.items['casinoCoin'] || 0;
// 站住 n 步后的提现额与倍率
const cashOf = (n) => Math.round(_stake * Math.pow(PENGUIN_MULT, n));
const multOf = (n) => Math.pow(PENGUIN_MULT, n);

// 浮冰横向排布：首块贴左、末块贴右，等距铺满展示区
const FLOE_X0 = 5;
const FLOE_DX = 90 / PENGUIN_STEPS;
const floeX = (i) => FLOE_X0 + i * FLOE_DX;

// 立绘用 pokedex 里的 image（动图）：结冻头有冰壳，解冻头是冰壳碎了之后的样子
const eiscueSprite = (melt) => (melt ? getPokemonByIndex('0875-1')?.image : '') || getPokemonByIndex('0875')?.image || '';

// ---------- 进入页面 ----------
export function showPenguinView() {
  pushNav('casinoPenguinView');
  showView('casinoPenguinView');
  // 恢复退出前没结算完的一局
  const saved = gameData._penguinRound;
  if (saved && saved.stake > 0) {
    _stake = saved.stake;
    _step = Math.max(0, Math.min(PENGUIN_STEPS, saved.step || 0));
    _vis = _step;
    _phase = 'play';
  } else if (_phase !== 'bet') {
    _phase = 'bet';
    _step = 0;
    _vis = 0;
  }
  _busy = false;
  _settle = null;
  _brokenAt = -1;
  render();
}

// ---------- 渲染 ----------
function render() {
  const box = $('casinoPenguinContent');
  if (!box) return;
  box.innerHTML = `<div class="casino-app pg-app">${_phase === 'bet' ? renderBetPage() : renderPlayPage()}</div>`;
  bind(box);
  // 两张立绘都先挂上：落水时只切显隐，不会等图
  box.querySelectorAll('img.pg-melt').forEach((img) => tryLoadImage(img, eiscueSprite(false)));
  box.querySelectorAll('img.pg-unmelt').forEach((img) => tryLoadImage(img, eiscueSprite(true)));
}

// 下注页：复用 21 点那套下注区
function renderBetPage() {
  const balance = coinOf();
  const holder = { bet: _bet, lastResult: _lastResult };
  const startText = balance <= 0 ? '请在柜台兑换游戏币再来' : '开始跳';
  const html = renderBetAreaCommon(balance, holder, 'pgStart', startText);
  _bet = holder.bet; // 同步自动回落的档位
  return html;
}

// 跳跃页 / 结算页共用：顶部金额 + 展示区 + 底部操作
function renderPlayPage() {
  const balance = coinOf();
  const done = _step >= PENGUIN_STEPS;
  const actions = _phase === 'settle'
    ? `<button class="bottom-dock" id="pgAgain">再来一局</button>`
    : `<div class="pg-actions">
        <button class="pg-btn" id="pgForward" ${_busy || done ? 'disabled' : ''}>${done ? '已到最右' : '前进'}</button>
        <button class="pg-btn pg-btn-cash" id="pgCash" ${_busy || _step <= 0 ? 'disabled' : ''}>提现${_step > 0 ? ' ' + formatNum(cashOf(_step)) : ''}</button>
      </div>`;
  return topbarHtml(balance) + stageHtml() + actions;
}

// 顶部金额条：左余额，右可提现（结算时为本局盈亏）
function topbarHtml(balance) {
  let right;
  if (_phase === 'settle' && _settle) {
    right = `<span class="pg-topcash">本局 <b>${_settle.net > 0 ? '+' : ''}${formatNum(_settle.net)}</b></span>`;
  } else if (_step > 0) {
    right = `<span class="pg-topcash">可提现 <b>${formatNum(cashOf(_step))}</b> <i>×${multOf(_step).toFixed(2)}</i></span>`;
  } else {
    right = `<span class="pg-topcash">可提现 <b>—</b></span>`;
  }
  return `<div class="pg-topbar">
      <span class="pg-topbal"><img src="./items/goods/coin.png" alt="">${formatNum(balance)}</span>
      ${right}
    </div>`;
}

// 展示区：水面 + 浮冰 + 企鹅
function stageHtml() {
  const vis = _vis;
  const floes = [];
  for (let i = 0; i <= PENGUIN_STEPS; i++) {
    const cls = ['pg-floe'];
    if (i <= _step && i !== vis) cls.push('done');   // 走过的置灰，企鹅脚下那块不动
    if (i === _step + 1 && _phase === 'play' && !_busy && i !== _brokenAt) cls.push('next');
    if (i === _brokenAt) cls.push('broken');
    const fh = 10 + (i % 3);
    floes.push(`<div class="${cls.join(' ')}" data-i="${i}" style="left:${floeX(i).toFixed(2)}%;height:${fh}px;margin-top:${-fh / 2}px">
        <span class="pg-half l"></span><span class="pg-half r"></span>
      </div>`);
  }
  // 掉水里后企鹅不在了：结算页只在提现/走满时还站在冰上
  const showPenguin = _phase !== 'settle' || (_settle && _settle.action === 'win');
  const penguin = showPenguin
    ? `<div class="pg-penguin" style="left:${floeX(vis).toFixed(2)}%"><img class="pg-melt" alt=""><img class="pg-unmelt" alt=""></div>`
    : '';
  const flag = `<div class="pg-flag" style="left:${(floeX(PENGUIN_STEPS) - 1.5).toFixed(2)}%"></div>`;
  const banner = _phase === 'settle' && _settle
    ? `<div class="casino-result">${_settle.text}${_settle.netText ? ` <b>${_settle.netText}</b>` : ''}</div>`
    : '';
  return `<div class="pg-stage">
      <div class="pg-water"><span class="pg-wave"></span><span class="pg-wave pg-wave2"></span></div>
      ${floes.join('')}
      ${flag}
      ${penguin}
      ${banner}
    </div>`;
}

// 站住后只做增量刷新：重绘会重建浮冰，把刚踩下去那一下的动画截断
function patchPlay() {
  const box = $('casinoPenguinContent');
  if (!box) return;
  const top = box.querySelector('.pg-topcash');
  if (top) top.innerHTML = `可提现 <b>${formatNum(cashOf(_step))}</b> <i>×${multOf(_step).toFixed(2)}</i>`;
  box.querySelector('#pgForward')?.removeAttribute('disabled');
  const cashBtn = box.querySelector('#pgCash');
  if (cashBtn) {
    cashBtn.textContent = `提现 ${formatNum(cashOf(_step))}`;
    cashBtn.removeAttribute('disabled');
  }
  box.querySelectorAll('.pg-floe').forEach((el) => {
    const i = +el.dataset.i;
    el.classList.toggle('done', i <= _step && i !== _vis);
    el.classList.toggle('next', i === _step + 1 && _step < PENGUIN_STEPS);
  });
}

// ---------- 交互（渲染后绑定） ----------
function bind(box) {
  // 下注刻度条：点圆点换注额（置灰档位忽略）
  for (const t of box.querySelectorAll('.casino-bet-tick')) {
    t.addEventListener('click', () => {
      if (_phase !== 'bet' || t.classList.contains('off')) return;
      _bet = BETS[+t.dataset.i];
      render();
    });
  }
  box.querySelector('#pgStart')?.addEventListener('click', startRound);
  box.querySelector('#pgForward')?.addEventListener('click', onForward);
  box.querySelector('#pgCash')?.addEventListener('click', onCash);
  box.querySelector('#pgAgain')?.addEventListener('click', nextRound);
  box.querySelector('#casinoHistoryBtn')?.addEventListener('click', () => showCasinoHistoryView('pg'));
}

// ---------- 玩法 ----------
function startRound() {
  if (_phase !== 'bet') return;
  if (_bet <= 0 || coinOf() < _bet) return;
  gameData.items['casinoCoin'] -= _bet;
  _stake = _bet;
  _step = 0;
  _vis = 0;
  _busy = false;
  _settle = null;
  _brokenAt = -1;
  _lastResult = null;
  _phase = 'play';
  gameData._penguinRound = { stake: _stake, step: 0 };
  updateStats(); // 扣款即时反映到状态栏
  saveGame(); // 进行中的一局写进存档：退出/刷新后回来能接着跳
  render();
}

// 前进：企鹅跳到下一块冰，落地再判浮冰碎不碎。
// 全程只改 DOM 不重绘——重绘会重建企鹅元素，left 过渡播不出来（看着像"闪"过去再原地跳）
async function onForward() {
  if (_phase !== 'play' || _busy) return;
  if (_step >= PENGUIN_STEPS) return;
  _busy = true;
  const box = $('casinoPenguinContent');
  const target = _step + 1;
  const penguin = box?.querySelector('.pg-penguin');
  const floe = box?.querySelector(`.pg-floe[data-i="${target}"]`);
  box?.querySelectorAll('.pg-actions .pg-btn').forEach((b) => b.setAttribute('disabled', ''));
  // 摘掉旧的动画类并强制重排：不重绘时同一个类再 add 一次，CSS 动画不会重播
  penguin?.classList.remove('jump', 'land');
  floe?.classList.remove('land');
  if (penguin) penguin.style.left = `${floeX(target).toFixed(2)}%`;   // 平移在滞空期完成
  void box?.offsetWidth;
  penguin?.classList.add('jump', 'land');
  floe?.classList.add('land');
  playMahjongSfx('draw');
  await sleep(340);
  if (Math.random() < PENGUIN_BREAK_CHANCE) {
    _vis = target;
    _brokenAt = target;
    penguin?.classList.remove('jump', 'land');   // 冰碎了就不跟着沉了
    penguin?.classList.add('fall');
    floe?.classList.remove('land');
    floe?.classList.add('broken');
    // 冰壳碎了：翻到一定角度再换解冻头立绘
    window.setTimeout(() => penguin?.classList.add('melt'), 150);
    const splash = document.createElement('span');
    splash.className = 'pg-splash';
    splash.style.left = `${floeX(target).toFixed(2)}%`;
    box?.querySelector('.pg-stage')?.appendChild(splash);
    await sleep(760);
    _busy = false;
    settleRound('drown', true);   // 保持现场：碎冰与倒地的企鹅都不重绘
    return;
  }
  // 站住了：刷新金额与按钮
  _step = target;
  _vis = target;
  gameData._penguinRound = { stake: _stake, step: _step };
  saveGame();
  _busy = false;
  if (_step >= PENGUIN_STEPS) {
    await sleep(300);   // 等最后一块冰沉完再进结算
    settleRound('full');
  } else {
    patchPlay();
  }
}

// 提现：把当前倍率的钱拿走
function onCash() {
  if (_phase !== 'play' || _busy || _step <= 0) return;
  settleRound('cash');
}

// ---------- 结算 ----------
function settleRound(kind, keepStage) {
  if (_phase === 'settle') return;
  let profit = 0;
  let text = '';
  let action = 'lose';
  if (kind === 'drown') {
    profit = 0;
    text = '浮冰碎了，冰砌鹅掉进水里';
    action = 'lose';
  } else {
    profit = cashOf(_step);
    text = kind === 'full' ? '走满全程！' : `提现 ${formatNum(profit)} 游戏币`;
    action = 'win';
  }
  gameData.items['casinoCoin'] = (gameData.items['casinoCoin'] || 0) + profit;
  const net = profit - _stake;
  const money = `${net >= 0 ? '+' : ''}${formatNum(net)}`;
  // 走满全程只报净盈亏；落水文案本身已经很长，不再接后缀
  const netText = kind === 'drown' ? '' : (kind === 'full' ? `${money} 游戏币` : `（净 ${money}）`);
  _lastResult = kind === 'cash' ? `${text}（净 ${money}）` : `${text} ${money} 游戏币`;
  _settle = { text, net, netText, action };
  _phase = 'settle';
  delete gameData._penguinRound; // 已结算：下次进来是新的下注页
  addSystemLog('casino', { game: 'penguin', action: kind === 'drown' ? 'lose' : 'cash', stake: _stake, steps: _step, cash: profit, profit: net });
  // 战绩存储（滑动窗口 50 条）
  gameData.penguinRecords = gameData.penguinRecords || [];
  gameData.penguinRecords.unshift({ time: Date.now(), bet: _stake, steps: _step, action, result: text, net });
  if (gameData.penguinRecords.length > 50) gameData.penguinRecords.length = 50;
  saveGame().then(updateStats);
  if (keepStage) patchSettle();
  else render();
}

// 落水结算：不重绘，只把底部换成「再来一局」、顶部换成盈亏，
// 碎裂的浮冰和倒头的企鹅原样留在画面上
function patchSettle() {
  const box = $('casinoPenguinContent');
  if (!box || !_settle) return;
  const money = `${_settle.net > 0 ? '+' : ''}${formatNum(_settle.net)}`;
  const bar = box.querySelector('.pg-topbar');
  const bal = bar?.querySelector('.pg-topbal');
  if (bal) bal.innerHTML = `<img src="./items/goods/coin.png" alt="">${formatNum(coinOf())}`;
  const cash = bar?.querySelector('.pg-topcash');
  if (cash) cash.outerHTML = `<span class="pg-topcash">本局 <b>${money}</b></span>`;
  const stage = box.querySelector('.pg-stage');
  if (stage && !stage.querySelector('.casino-result')) {
    const banner = document.createElement('div');
    banner.className = 'casino-result';
    banner.innerHTML = `${_settle.text}${_settle.netText ? ` <b>${_settle.netText}</b>` : ''}`;
    stage.appendChild(banner);
  }
  const actions = box.querySelector('.pg-actions');
  if (actions) {
    actions.outerHTML = `<button class="bottom-dock" id="pgAgain">再来一局</button>`;
    box.querySelector('#pgAgain')?.addEventListener('click', nextRound);
  }
}

// 再来一局：回到下注页
function nextRound() {
  _phase = 'bet';
  _stake = 0;
  _step = 0;
  _vis = 0;
  _busy = false;
  _settle = null;
  _brokenAt = -1;
  render();
}
