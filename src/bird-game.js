// ===== 鸟了个鸟（堆叠三消）=====
// 限时活动「鸟了个鸟」的玩法：点开没被压住的鸟放进下面槽位，凑齐三只同一种自动抵消，
// 槽位放满 7 个就算输。整盘消完给该难度的固定气球（跟宝可翻牌共用一套兑换所）。
import { $, showView, getCurrentView, tryLoadImage } from './ui.js';
import { pushNav, popNav, getPokemonByIndex } from './state.js';
import { playMahjongSfx } from './audio.js';

const TRAY_MAX = 7;
const COIN_ICON = './items/goods/balloon-teal.png';   // 本活动的代币气球（和活动页那颗同一色）


// 鸟池：按进化系分组，同一局里一个家族最多出一只（波波和比比鸟摆一起会认混）。
// 每档只写"要几种鸟"，具体抽谁每局现摇 —— 这样池子里每只都有机会上场。
const BIRD_FAMILIES = [
  ['0016', '0017', '0018'],         // 波波 / 比比鸟 / 大比鸟
  ['0022'],                         //大嘴雀
  ['0083'],                         // 大葱鸭
  ['0144'], ['0145'], ['0146'],     // 急冻鸟 / 闪电鸟 / 火焰鸟
  ['0163', '0164'],                 // 咕咕 / 猫头夜鹰
  ['0177', '0178'],                 // 天然雀 / 天然鸟
  ['0198', '0430'],                 // 黑暗鸦 / 乌鸦头头
  ['0225'],                         // 信使鸟
  ['0227'],                         // 盔甲鸟（钢）
  ['0250'],                         // 凤王
  ['0276', '0277'],                 // 傲骨燕 / 大王燕
  ['0278', '0279'],                 // 长翅鸥 / 大嘴鸥
  ['0333', '0334'],                 // 青绵鸟 / 七夕青鸟
  ['0396', '0397', '0398'],         // 姆克儿 / 姆克鸟 / 姆克鹰
  ['0519', '0520'],                 // 豆豆鸽 / 咕咕鸽
  ['0580', '0581'],                 // 鸭宝宝 / 舞天鹅
  ['0629', '0630'],                 // 秃鹰丫头 / 秃鹰娜
  ['0661', '0662', '0663'],         // 小箭雀 / 火箭雀 / 烈箭鹰
  ['0722', '0723'],                 // 木木枭 / 投羽枭
  ['0731'],                         // 小笃儿
  ['0821', '0822', '0823'],         // 稚山雀 / 蓝鸦 / 钢铠鸦（钢）
  ['0940', '0941'],                 // 电海燕 / 大电海燕
  ['0962'],                         // 下石鸟
];

// 从池子里抽 n 种：先抽家族，再在家族里随机取一只
function pickBirds(n) {
  return shuffled(BIRD_FAMILIES).slice(0, n).map((f) => f[Math.floor(Math.random() * f.length)]);
}

// 三档难度：牌越多、种类越多越难；通关拿固定气球，失败一场空。
// layers 里只写"这层几张、占网格多大一块（span）"，具体几列几行由舞台形状现场算
export const BG_LEVELS = [
  {
    id: 'easy', name: '简单', coins: 40, birds: 6,
    layers: [
      { n: 8, span: 1 }, { n: 8, span: 1 }, { n: 7, span: 0.8 },
      { n: 7, span: 0.66 }, { n: 6, span: 0.66 },
    ],
  },
  {
    id: 'normal', name: '普通', coins: 80, birds: 8,
    layers: [
      { n: 12, span: 1 }, { n: 10, span: 1 }, { n: 9, span: 0.85 },
      { n: 9, span: 0.85 }, { n: 8, span: 0.66 },
    ],
  },
  {
    id: 'hard', name: '困难', coins: 150, birds: 10,
    layers: [
      { n: 12, span: 1 }, { n: 11, span: 1 }, { n: 10, span: 0.85 },
      { n: 9, span: 0.85 }, { n: 9, span: 0.7 }, { n: 9, span: 0.66 },
    ],
  },
];
export const bgLevelOf = (id) => BG_LEVELS.find((l) => l.id === id) || BG_LEVELS[1];
// 整层共用一个错位量：上层鸟正好压在下面几只的交界处，堆叠的层次感就是这么来的。
// 取值范围刻意收在 [-25, 50]，这样棋盘只要留 1/4 格余量就摆得开
const SHIFTS = [
  [0, 0], [25, 25], [-25, -25], [50, 50], [50, -25], [-25, 50],
  [50, 0], [0, 50], [-25, 25], [25, -25], [25, 50], [0, -25],
];
const HALF = 0.25;   // 摆牌时四周各留 1/4 格给错位
const PAD = 0.75;    // 棋盘比网格多出来的余量（格）：左 1/4 + 右 1/2
const MIN_COLS = 5;  // 网格最少几列几行，再少最挤的那一层就摆不开
const MIN_ROWS = 3;
const TRAY_GAP = 3;  // 槽位之间的间距，要和 CSS 里 .bg-tray 的 gap 保持一致
const SIDE_PAD = 4; // 槽位那一行左右各留的空，别贴着屏幕边

const rndInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

let _g = null;        // 当前这一局
let _timer = null;    // 每秒看一眼是不是从别的页面切回来了
let _cardEls = new Map();   // 牌堆里每张牌对应的 DOM，留着复用才做得出过渡动画

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// 两张牌只要有重叠（只压到一个角也算）就挡住下面那张。坐标以格为单位
function overlap(a, b) {
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
}

// 排一条可行的取牌顺序：每次只能取当前没被压住的
function solveOrder(slots) {
  const rest = slots.slice();
  const order = [];
  while (rest.length) {
    const free = rest.filter((p) => !rest.some((q) => q.z > p.z && overlap(p, q)));
    const pick = free[Math.floor(Math.random() * free.length)];
    order.push(pick);
    rest.splice(rest.indexOf(pick), 1);
  }
  return order;
}

// 这一层占网格里多大一块：以网格中心为心，按 span 缩出一块矩形
function layerCells(base, cols, rows) {
  let cw = Math.max(2, Math.round(cols * base.span));
  let ch = Math.max(2, Math.round(rows * base.span));
  while (cw * ch < base.n && (cw < cols || ch < rows)) {   // 装不下这批牌就往外扩
    if (cw <= ch && cw < cols) cw++;
    else if (ch < rows) ch++;
    else cw++;
  }
  const c0 = Math.floor((cols - cw) / 2);
  const r0 = Math.floor((rows - ch) / 2);
  const cells = [];
  for (let r = r0; r < r0 + ch; r++) for (let c = c0; c < c0 + cw; c++) cells.push({ c, r });
  return cells;
}

// 每层牌数在基准上抖一下，再配平回总数
function layerCounts(base, areas, total) {
  const caps = areas.map((a) => a.length);   // 这层最多塞得下几张
  const counts = base.map((b, i) => Math.min(caps[i], Math.max(4, b.n + rndInt(-1, 1))));
  let diff = total - counts.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (diff !== 0 && guard++ < 200) {
    const i = rndInt(0, counts.length - 1);
    if (diff > 0) {
      if (counts[i] < caps[i]) { counts[i]++; diff--; }
    } else if (counts[i] > 4) {
      counts[i]--; diff++;
    }
  }
  return counts;
}

// 层内挑格子：先随机一个重心，离重心近的更可能被选上 —— 各层因此聚成不一样的形状
function pickCells(cells, n) {
  let cMin = Infinity, cMax = -Infinity, rMin = Infinity, rMax = -Infinity;
  for (const c of cells) {
    if (c.c < cMin) cMin = c.c;
    if (c.c > cMax) cMax = c.c;
    if (c.r < rMin) rMin = c.r;
    if (c.r > rMax) rMax = c.r;
  }
  const cx = rndInt(cMin, cMax), cy = rndInt(rMin, rMax);
  return cells
    .map((c) => ({ c, d: Math.hypot(c.c - cx, c.r - cy) * (0.75 + Math.random() * 0.5) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.c);
}

// 摆牌：每层随机占格（层内不会重叠）。摆好后按取牌顺序、每连着三张配成同一种鸟，
// 照着这条顺序取牌槽位最多压到三只，所以每一局必定有解
function makeDeck(level, cols, rows) {
  const base = level.layers;
  const birds = pickBirds(level.birds);   // 每局现摇一批，池子里每只都有机会出场
  const total = base.reduce((s, b) => s + b.n, 0);
  const areas = base.map((b) => layerCells(b, cols, rows));
  const counts = layerCounts(base, areas, total);
  const slots = [];
  let z = 0;
  counts.forEach((n, i) => {
    const [ox, oy] = SHIFTS[rndInt(0, SHIFTS.length - 1)];
    for (const { c, r } of pickCells(areas[i], n)) {
      slots.push({ x: c + ox / 100, y: r + oy / 100, z: z++ });
    }
  });
  while (slots.length % 3) slots.pop();   // 兜底：总量必须是 3 的倍数
  const order = solveOrder(slots);
  // 配色池：每只鸟一组三张，凑够组数就行（组数不一定是鸟种数的整数倍）
  const bag = [];
  while (bag.length < order.length / 3) bag.push(...birds);
  shuffled(bag);
  order.forEach((s, i) => { s.type = bag[Math.floor(i / 3)]; });
  return slots.map((s, i) => ({ ...s, id: i, gone: false, free: false }));
}

function iconOf(index) {
  const poke = getPokemonByIndex(index);
  return poke && poke.icon ? poke.icon : '';
}

// 算网格：舞台是宽扁的，格子就得排成"列多行少"，才顶得到槽位那么大。
// 边长以槽位为准，从它往下退，退到行列数够摆下最挤的那一层为止
function grid() {
  const stage = $('bgStage');
  const cs = getComputedStyle(stage);
  // 得把 stage 自己的内边距刨掉，不然棋盘会顶出容器、压到下面的槽位上
  const w = stage.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const h = stage.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  const boxW = Math.max(120, w - 2);
  const boxH = Math.max(72, h - 1);
  // 三个上限里取最小的：装得下最挤那一层、别撑爆装牌区、底下槽位排开别贴屏幕边
  const bySlot = Math.floor((w - SIDE_PAD * 2 - TRAY_GAP * (TRAY_MAX - 1)) / TRAY_MAX);
  const bySpace = Math.min(Math.floor(boxW / (MIN_COLS + PAD)), Math.floor(boxH / (MIN_ROWS + PAD)));
  const G = Math.max(12, Math.min(bySlot, bySpace));
  const cols = Math.max(MIN_COLS, Math.floor(boxW / G - PAD));
  const rows = Math.max(MIN_ROWS, Math.floor(boxH / G - PAD));
  const board = $('bgBoard');
  board.style.width = `${(cols + PAD) * G}px`;
  board.style.height = `${(rows + PAD) * G}px`;
  return { cols, rows, G };
}

// 上面压着牌（z 更大且重叠）就不能点
function updateFree() {
  const alive = _g.deck.filter((c) => !c.gone);
  for (const c of alive) {
    c.free = !alive.some((o) => o !== c && o.z > c.z && overlap(o, c));
  }
}

function paint() {
  if (!_g) return;
  const { cols, rows, G } = grid();
  if (!_g.deck) _g.deck = makeDeck(_g.level, cols, rows);   // 第一帧量到网格尺寸再摆牌
  updateFree();
  paintBoard(G);
  paintTray(G);
  const left = _g.deck.filter((c) => !c.gone).length + _g.tray.length;
  $('bgLeft').textContent = `剩余 ${left} 张`;
  $('bgTrayInfo').textContent = `槽位 ${_g.tray.length}/${TRAY_MAX}`;
}

// 牌堆走增量渲染：卡片元素留着复用，只改位置和状态。
// 全量重建的话，拿牌/解锁的过渡动画每次都被新 DOM 打断，看着就是"啪"地跳一下
function paintBoard(G) {
  const board = $('bgBoard');
  board.onclick = onBoardClick;
  const alive = new Set();
  for (const c of _g.deck) {
    if (c.gone) continue;
    alive.add(c.id);
    let el = _cardEls.get(c.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'bg-card';
      el.dataset.id = c.id;
      el.innerHTML = '<img alt="">';
      tryLoadImage(el.firstChild, iconOf(c.type));
      _cardEls.set(c.id, el);
      board.appendChild(el);
    }
    el.style.left = `${(c.x + HALF) * G}px`;
    el.style.top = `${(c.y + HALF) * G}px`;
    el.style.width = `${G}px`;
    el.style.height = `${G}px`;
    el.style.zIndex = 10 + c.z;
    el.classList.toggle('covered', !c.free);
  }
  for (const [id, el] of [..._cardEls]) {
    if (alive.has(id)) continue;
    _cardEls.delete(id);
    el.remove();   // 拿下来就直接收走
  }
}

// 槽位跟牌一样大：宽高由格子边长给，排一行居中
function paintTray(G) {
  const tray = $('bgTray');
  tray.innerHTML = '';
  let fading = _g.fading ? 3 : 0;   // 正在消掉的那三张：亮一下再缩走
  for (let i = 0; i < TRAY_MAX; i++) {
    const el = document.createElement('div');
    let cls = 'bg-slot';
    if (_g.tray[i]) cls += ' filled';
    if (fading && _g.tray[i] === _g.fading) { cls += ' ok'; fading--; }
    el.className = cls;
    el.style.width = `${G}px`;
    el.style.height = `${G}px`;
    if (_g.tray[i]) {
      el.innerHTML = '<img alt="">';
      tryLoadImage(el.firstChild, iconOf(_g.tray[i]));
    }
    tray.appendChild(el);
  }
}

// 同种鸟挨着放，看着不乱
function insertTray(type) {
  const at = _g.tray.lastIndexOf(type);
  _g.tray.splice(at >= 0 ? at + 1 : _g.tray.length, 0, type);
}

// 槽位里有没有凑够三张的
function tripleIn(tray) {
  const n = {};
  for (const t of tray) n[t] = (n[t] || 0) + 1;
  return Object.keys(n).find((k) => n[k] >= 3) || null;
}

// 把凑够的三张从槽位拿走
function clearTriple(type) {
  const next = [];
  let left = 3;
  for (const t of _g.tray) {
    if (t === type && left > 0) { left--; continue; }
    next.push(t);
  }
  _g.tray = next;
}

// 牌堆和结算面板共用一个点击入口，按当前状态分发（两边各绑一次的话会互相顶掉）
function onBoardClick(e) {
  if (_g && _g.done) {
    const btn = e.target.closest('[data-bg]');
    if (!btn) return;
    if (btn.dataset.bg === 'again') startBirdGame({ level: _g.level.id, onFinish: _g.onFinish });
    else leaveBirdGame();
    return;
  }
  const el = e.target.closest('.bg-card');
  if (el) press(Number(el.dataset.id));
}

function press(id) {
  if (!_g || _g.done || _g.busy) return;
  const c = _g.deck.find((x) => x.id === id);
  if (!c || c.gone || !c.free) return;
  if (_g.tray.length >= TRAY_MAX) return;
  c.gone = true;
  insertTray(c.type);
  playMahjongSfx('ui');

  const hit = tripleIn(_g.tray);
  if (!hit) {
    paint();
    checkEnd();
    return;
  }
  // 凑齐了：让这三张先在槽位里亮一下再缩走，动画走完才真拿走、才判胜负
  _g.busy = true;
  _g.fading = hit;
  _g.groups++;
  paint();
  setTimeout(() => {
    if (!_g || _g.done) return;
    clearTriple(hit);
    _g.fading = null;
    _g.busy = false;
    paint();
    checkEnd();
  }, 240);
}

function checkEnd() {
  const left = _g.deck.filter((c) => !c.gone).length;
  if (!left && !_g.tray.length) return finish(true);
  if (_g.tray.length >= TRAY_MAX) return finish(false);   // 槽位满了又消不掉
  if (!left && _g.tray.length) return finish(false);
}

function finish(win) {
  if (!_g || _g.done) return;
  _g.done = true;
  clearInterval(_timer);
  _timer = null;
  _g.coins = win ? _g.level.coins : 0;   // 只有整盘消完才给气球，失败一场空
  if (_g.onFinish) { try { _g.onFinish(_g.coins, win); } catch (e) { console.error('[鸟了个鸟] 结算出错：', e); } }
  playMahjongSfx('ui');
  showResult(win);
}

function showResult(win) {
  const board = $('bgBoard');
  if (!board) return;
  _cardEls.clear();   // 牌堆元素要被结果面板顶掉，缓存跟着清
  board.innerHTML = `
    <div class="bg-result">
      <p class="game-result-title">${win ? '全部抵消完成' : '槽位满了'}</p>
      ${win
        ? `<p class="game-result-coins"><img src="${COIN_ICON}" alt="">+${_g.coins} 气球</p>`
        : '<p class="game-result-coins none">没消完，这局没有气球</p>'}
      <div class="game-result-btns">
        <span class="catch-confirm-btn" data-bg="again">再来一局</span>
        <span class="catch-confirm-btn" data-bg="back">返回</span>
      </div>
    </div>`;
  const left = $('bgLeft');
  if (left) left.textContent = '本局结束';
}

export function startBirdGame(opts = {}) {
  if (!$('birdView')) return;
  const level = bgLevelOf(opts.level);
  _g = {
    level,
    deck: null,   // 摆牌要看实际网格，等第一帧量完尺寸再生成
    tray: [],
    groups: 0,
    coins: 0,
    done: false,
    live: true,   // 是否正显示着牌桌（切到别的页面会置 false）
    busy: false,  // 消除动画播着的时候不收新点击
    fading: null, // 正在消掉的这种鸟
    onFinish: opts.onFinish || null,
  };
  _cardEls.clear();
  $('bgBoard').innerHTML = '';
  if (getCurrentView() !== 'birdView') pushNav('birdView');   // 再来一局时已经在牌桌上，别再压一层
  showView('birdView');
  paint();
  clearInterval(_timer);
  // 切去别的页面（比如设置）先留着这一局，回来重画一帧接着玩，别当成中途退出；
  // 真正退出只有按返回键那一条路（走 leaveBirdGame）
  _timer = setInterval(() => {
    if (!_g || _g.done) return;
    if (getCurrentView() === 'birdView') {
      if (!_g.live) { _g.live = true; paint(); }   // 回来了：尺寸可能变过，重画
    } else {
      _g.live = false;
    }
  }, 1000);
}

// 离开：没打完就直接作废，一个气球也不给
export function leaveBirdGame() {
  if (_g) _g.done = true;
  clearInterval(_timer);
  _timer = null;
  _g = null;
  if (getCurrentView() !== 'birdView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');   // 活动已下架：退回手机首页
  });
}

// 转屏 / 改窗口大小：格子边长要重算，重画一次即可（状态都在 _g 里）
window.addEventListener('resize', () => {
  if (_g && !_g.done && getCurrentView() === 'birdView') paint();
});
