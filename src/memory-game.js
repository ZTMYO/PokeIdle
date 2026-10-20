// ===== 神经衰弱（配对翻牌）=====
// 限时活动「宝可翻牌」的玩法：翻牌配对，全部配对完结算气球。
// 结算 = 基础币 + 效率奖励（对数 ÷ 翻牌次数），零失误再 ×1.2；只有把整桌翻完才给币。
// 只剩最后一对时那两张必然配对，自动翻开完成、不占翻牌次数。超时 / 次数用完 / 中途退出都给 0。
// 一局的随机（牌面顺序、金卡）用本地随机就够 —— 这里没有"全服同一份奖励"的问题，价格是固定的。
import { $, showView, getCurrentView, tryLoadImage } from './ui.js';
import { pushNav, popNav, allPokemon } from './state.js';
import { playMahjongSfx } from './audio.js';

// 三档牌桌：对数 / 列数 / 通关基础币 / 时限（秒）/ 最多翻牌次数（一次 = 翻开两张）
export const MG_LEVELS = [
  { id: 'easy', name: '简单', pairs: 6, cols: 4, base: 20, time: 60, tries: 20 },
  { id: 'normal', name: '普通', pairs: 8, cols: 4, base: 40, time: 75, tries: 18 },
  { id: 'hard', name: '困难', pairs: 12, cols: 6, base: 80, time: 90, tries: 26 },
];
export const levelOf = (id) => MG_LEVELS.find(l => l.id === id) || MG_LEVELS[1];

let _g = null;   // 当前这一局

// 牌面池：都是大家眼熟的经典宝可梦，颜色和轮廓区别大，好认好配
const MG_FACES = [
  '0001', '0004', '0007', '0025', '0035', '0039', '0052', '0054', '0059', '0068',
  '0094', '0095', '0130', '0132', '0133', '0143', '0149', '0150',
  '0151', '0152', '0155', '0158', '0255', '0258', '0448',
];
// 妙蛙种子 / 小火龙 / 杰尼龟 / 皮卡丘 / 皮皮 / 胖丁 / 喵喵 / 可达鸭 / 风速狗 / 怪力 /
// 耿鬼 / 大岩蛇 / 暴鲤龙 / 百变怪 / 伊布 / 卡比兽 / 快龙 / 超梦 /
// 梦幻 / 菊草叶 / 火球鼠 / 小锯鳄 / 火稚鸡 / 水跃鱼 / 路卡利欧

// 牌面：每局从池子里随机挑 n 只，各档都只出这一批（换局就换面孔，不碰图鉴里那些生僻的）
function pickFaces(n) {
  const pool = MG_FACES.map(i => allPokemon.find(p => String(p.index) === i)).filter(p => p?.icon);
  return shuffled(pool).slice(0, n);
}
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function startMemoryGame(opts = {}) {
  const view = $('memoryView');
  if (!view) return;
  const lv = levelOf(opts.level);
  const faces = pickFaces(lv.pairs);
  if (faces.length < lv.pairs) return;
  _g = {
    lv,
    deck: shuffled(faces.concat(faces)),
    golden: faces[Math.floor(Math.random() * faces.length)].index,   // 金卡：配对成功额外 +10 币
    up: [], lock: false, reveal: false, tries: 0, matched: 0, bonus: 0,
    left: lv.time, maxTries: lv.tries, done: false, coins: 0,
    onFinish: opts.onFinish || null,
    timer: null,
  };
  pushNav('memoryView');
  showView('memoryView');   // 先亮出来再摆牌：量得到牌桌尺寸
  buildBoard();
  const t = $('mgTime');
  if (t) t.textContent = `${_g.left}s`;
  const titleEl = $('mgLevel');
  if (titleEl) titleEl.textContent = lv.name;
  renderHead();
  clearInterval(_g.timer);
  _g.timer = setInterval(tick, 1000);
}

// 所有档位共用同一套牌尺寸：按最多的 6 列 × 4 行算一次，能塞进牌桌就固定下来（换设备才重算）。
// 简单档格子少，牌桌居中显示，牌大小仍然和困难档一样。
function cardSizeOf(board) {
  const w = board.clientWidth, h = board.clientHeight;
  const GAP = 5, COLS = 6, ROWS = 4, RATIO = 0.76;   // 牌宽 ≈ 牌高 × 0.76
  if (w < 120 || h < 120) return { w: 40, h: 53 };   // 量不到（还没铺开）：给个默认值
  const fitW = Math.floor((w - GAP * (COLS - 1)) / COLS);
  const fitH = Math.floor((h - GAP * (ROWS - 1)) / ROWS);
  const cw = Math.max(24, Math.min(fitW, Math.round(fitH * RATIO)));
  return { w: cw, h: Math.round(cw / RATIO) };
}

function buildBoard() {
  const board = $('mgBoard');
  if (!board) return;
  const size = cardSizeOf(board);
  const rows = Math.ceil((_g.lv.pairs * 2) / _g.lv.cols);
  board.style.gridTemplateColumns = `repeat(${_g.lv.cols}, ${size.w}px)`;
  board.style.gridTemplateRows = `repeat(${rows}, ${size.h}px)`;   // 尺寸固定 → 各档看起来一样大，只是格子数不同
  board.innerHTML = _g.deck.map((p, i) => `
    <div class="mg-card" data-i="${i}">
      <div class="mg-inner">
        <div class="mg-front"><img data-icon="${p.index}" alt=""></div>
        <div class="mg-back"><svg class="mg-back-icon" viewBox="0 0 1024 1024"><use xlink:href="#icon-card-back"/></svg></div>
      </div>
    </div>`).join('');
  board.querySelectorAll('.mg-front img[data-icon]').forEach((img) => {
    const poke = allPokemon.find(p => String(p.index) === img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
  board.onclick = onBoardClick;
}

function renderHead() {
  const a = $('mgProgress'), b = $('mgTries');
  if (a) a.textContent = `已配对 ${_g.matched}/${_g.lv.pairs}`;
  if (b) {
    b.textContent = `翻牌 ${_g.tries}/${_g.maxTries} 次`;
    b.classList.toggle('low', _g.maxTries - _g.tries <= 3);   // 快用完了标红
  }
  const t = $('mgTime');
  if (t && !_g.done) t.textContent = `${_g.left}s`;
}

function onBoardClick(e) {
  const card = e.target.closest('.mg-card');
  if (!card || !_g || _g.done || _g.lock) return;
  const i = Number(card.dataset.i);
  if (card.classList.contains('up') || card.classList.contains('matched')) return;
  if (_g.up.length === 0 && _g.tries >= _g.maxTries) { revealAllAndFinish('tries'); return; }   // 次数用完：这一手不给翻
  playMahjongSfx('ui');   // 翻牌音效：和 21 点同款
  card.classList.add('up');
  _g.up.push(i);
  if (_g.up.length < 2) return;
  _g.tries++;
  const [a, b] = _g.up;
  const cards = $('mgBoard').querySelectorAll('.mg-card');
  if (_g.deck[a].index !== _g.deck[b].index) {   // 没配上：停一下再盖回去
    _g.lock = true;
    const round = _g;
    renderHead();
    setTimeout(() => {
      if (_g !== round || round.reveal) return;   // 已经换局/离开/正在亮牌：别动牌面
      cards[a].classList.remove('up');
      cards[b].classList.remove('up');
      _g.up = [];
      _g.lock = false;
    }, 600);
    return;
  }
  _g.matched++;
  _g.up = [];
  cards[a].classList.add('matched');
  cards[b].classList.add('matched');
  if (_g.deck[a].index === _g.golden) _g.bonus += 10;   // 金卡彩蛋
  renderHead();
  if (_g.matched === _g.lv.pairs) { finish('clear'); return; }
  // 只剩最后一对：那两张必然是一对，直接翻开完成，白送的一次不算在翻牌次数里
  if (_g.matched === _g.lv.pairs - 1) {
    const round = _g;
    _g.lock = true;
    _g.matched = _g.lv.pairs;
    cards.forEach((el) => { if (!el.classList.contains('matched')) el.classList.add('up'); });
    renderHead();
    setTimeout(() => {
      if (_g !== round) return;
      cards.forEach((el) => { if (!el.classList.contains('matched')) el.classList.add('matched'); });
      finish('clear');
    }, 450);
  }
}

function tick() {
  if (!_g || _g.done) return;
  if (getCurrentView() !== 'memoryView') { leaveMemoryGame(); return; }   // 被别处挤掉了：当场结算
  _g.left--;
  renderHead();
  if (_g.left <= 0) revealAllAndFinish('time');
}

// 没翻完就结束（超时 / 次数用完）：先把没翻开的牌全部亮给玩家看一眼，停一下再进结算
function revealAllAndFinish(reason) {
  if (!_g || _g.done) return;
  _g.reveal = true;
  _g.lock = true;
  clearInterval(_g.timer);
  _g.timer = null;
  const round = _g;
  $('mgBoard')?.querySelectorAll('.mg-card').forEach((el) => {
    if (!el.classList.contains('matched') && !el.classList.contains('up')) el.classList.add('up');
  });
  const t = $('mgTime');
  if (t) t.textContent = reason === 'time' ? '时间到' : '次数用完';
  setTimeout(() => { if (_g === round) finish(reason); }, 900);
}

// 结算：只有把整桌翻完才给气球（超时、翻牌次数用完、中途退出都是 0），只发一次。
// reason：clear = 全部配对完 / time = 超时 / tries = 翻牌次数用完 / leave = 中途退出（不弹面板、不发声）
function finish(reason) {
  if (!_g || _g.done) return;
  _g.done = true;
  clearInterval(_g.timer);
  _g.timer = null;
  const { lv, tries } = _g;
  if (reason === 'clear') {
    const eff = Math.min(1, lv.pairs / Math.max(1, tries));       // 效率：最少尝试 ÷ 实际尝试
    _g.coins = Math.round(lv.base * (1 + eff) * (tries === lv.pairs ? 1.2 : 1)) + _g.bonus;
  } else {
    _g.coins = 0;
  }
  if (_g.onFinish) { try { _g.onFinish(_g.coins, reason === 'clear'); } catch (e) { console.error('[宝可翻牌] 结算出错：', e); } }
  if (reason !== 'leave') {   // 中途退出：静默作废，别在离开时还响一声
    playMahjongSfx('ui');
    showResult(reason);
  }
  renderHead();
}

function showResult(reason) {
  const board = $('mgBoard');
  if (!board) return;
  const t = $('mgTime');
  if (t) t.textContent = reason === 'clear' ? '通关' : '结束';
  board.style.gridTemplateColumns = '1fr';
  board.style.gridTemplateRows = '1fr';
  board.innerHTML = `
    <div class="mg-result">
      <p class="game-result-title">${reason === 'clear' ? '全部配对完成' : reason === 'tries' ? '翻牌次数用完了' : '时间到了'}</p>
      ${reason === 'clear'
        ? `<p class="game-result-coins"><img src="./items/goods/balloon-cyan.png" alt="">+${_g.coins} 气球</p>`
        : '<p class="game-result-coins none">没翻完，这局没有气球</p>'}
      <div class="game-result-btns">
        <span class="catch-confirm-btn" data-mg="again">再来一局</span>
        <span class="catch-confirm-btn" data-mg="back">返回</span>
      </div>
    </div>`;
  board.onclick = (e) => {
    const btn = e.target.closest('[data-mg]');
    if (!btn) return;
    if (btn.dataset.mg === 'again') startMemoryGame({ level: _g.lv.id, onFinish: _g.onFinish });
    else leaveMemoryGame();
  };
}

// 离开牌桌：还没结算的静默作废（币照给 0，一局只发一次），回活动页
export function leaveMemoryGame() {
  if (_g && !_g.done) finish('leave');
  if (_g) { clearInterval(_g.timer); _g.timer = null; }
  _g = null;
  if (getCurrentView() !== 'memoryView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');   // 活动已下架：退回手机首页
  });
}

// 切后台/锁屏：本局当场按超时结算，别让它挂着偷跑
document.addEventListener('visibilitychange', () => {
  if (document.hidden && _g && !_g.done) finish('time');
});
