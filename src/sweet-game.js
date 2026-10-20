// ===== 甜蜜工坊（限时活动里的小游戏）=====
// 顾客走进柜台报出想要的冰激凌（1 个糖饰 + 1~3 个口味，口味可重复），点一下口味就往蛋筒上叠一球，
// 放上糖饰封顶；做好了按时机点击条出货：光标在绿区里按下，命中越准给的气球越多。
import { $, showView, getCurrentView, tryLoadImage } from './ui.js';
import { pushNav, popNav } from './state.js';
import { playMahjongSfx } from './audio.js';
import { ICE_DECOS, ICE_FLAVORS, ICECREAM_W, flavorInk, decoInk, icecreamHeight, paintIcecream } from './icecream.js';
import { fourDirGeom, fourDirSrc, fourDirAnim, fourDirDelay, fourDirFitContent, DIR_ROW } from './four-dir.js';

const COIN_ICON = './items/goods/balloon-cream.png';   // 本活动的代币气球（和活动页那颗同一色）
const ROUNDS = 5;        // 一轮营业接待几位顾客
const CUST_FIT = 56;     // 顾客立绘的内容框上限（像素），和随从页一样按内容归一，不带透明留白
const PREVIEW_H = 56;    // 成品预览的显示高度上限（像素），和顾客立绘一般高，按最高 3 层定、各层数同比例
const DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));   // 高 DPI 下放大画布，预览不糊

// 三档难度：口味越多、给顾客的时间越短；只有困难档要求叠放次序和顾客念的一致
// good / perfect 是点击条命中绿区与正中时的气球数，rave 是顾客爆赞时额外加的那笔，直接写死
export const SW_LEVELS = [
  { id: 'easy', name: '简单', layers: 1, good: 5, perfect: 8, rave: 6, time: 18, ordered: false },
  { id: 'normal', name: '普通', layers: 2, good: 10, perfect: 15, rave: 12, time: 10, ordered: false },
  { id: 'hard', name: '困难', layers: 3, good: 20, perfect: 30, rave: 24, time: 8, ordered: true },
];
export const swLevelOf = (id) => SW_LEVELS.find((l) => l.id === id) || SW_LEVELS[1];

// 做对了才有机会被爆赞：台词换成粉色那几句，额外再给一笔气球
const RAVE_CHANCE = 0.2;

// 点击条三档共用一套参数：难度只体现在订单和时间上
const QTE = { zone: 0.13, perfect: 0.05, speed: 0.85 };

// 顾客池
const CUSTOMERS = [
  1, 4, 7, 25, 39, 52, 54, 58, 94, 104, 133, 134, 135, 136, 143, 155, 172, 196, 197,
  252, 255, 282, 393, 427, 440, 446, 447, 470, 471, 495, 498, 658, 700, 744, 813, 816, 835, 906,
];
const LINES = {
  perfect: [
    '哇！好漂亮，就是这个！',
    '太棒啦！这个冰淇淋超好看！',
    '就是这个甜甜的味道，谢谢你！',
    '好好看，都舍不得咬一口！',
    '好好吃！我之后还会来！',
  ],
  good: [
    '嗯，甜甜的很好吃，谢谢！',
    '不错不错，下次再来光顾。',
    '味道刚刚好，谢谢你~',
    '很好吃，就是奶油多了一点点。',
    '味道很棒，我要先走咯。',
  ],
  rave: [
    '呜哇！好吃到要飞起来啦！',
    '这辈子再也不会吃到这么绝的味道了！',
    '惊艳到说不出话！太厉害了！！',
    '震撼到发抖！怎么能做得这么完美！',
    '天呐！这是全世界最好吃的冰淇淋！'
  ],
  miss: [
    '唔……冰淇淋有点化掉了。',
    '还差一点点，继续加油呀！',
    '是不是手抖啦？下次稳住哦。',
    '造型有点歪，但还是谢谢你。',
    '勉强收下啦，下次再看看。',
  ],
  wrong: [
    '唔，这个不是我点的！',
    '不对不对，我想要的不是这个！',
    '是不是拿错冰淇淋啦？',
    '咦，是不是看错我的订单了？',
    '我想要别的口味哦。',
  ],
  timeout: [
    '等太久啦，我先走咯！',
    '来不及啦，下次再来吧。',
    '等好久还没做好？我先走啦。',
    '唔，我赶时间，不等啦。',
  ],
};

let _g = null;
let _timer = null;      // 每秒看一眼是不是从别的页面切回来了
let _custRaf = null;    // 顾客的逐帧动画
let _qteRaf = null;     // 点击条光标

const rndOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 一轮里不重复：先把顾客池洗一遍，按顺序请进来
function pickCustomers(n) {
  const pool = CUSTOMERS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

// 一位顾客的订单：1 个糖饰 + N 个口味（可以重复，比如草莓草莓芒果）
function makeOrder(level) {
  const pool = ICE_FLAVORS.map((f) => f.id);
  const flavors = [];
  for (let i = 0; i < level.layers; i++) flavors.push(rndOf(pool));
  return { deco: rndOf(ICE_DECOS), flavors };
}

// 不要求次序的难度：口味只要种类和数量都对就行
function sameFlavors(a, b) {
  return a.length === b.length && a.every((f) => {
    const i = b.indexOf(f);
    if (i < 0) return false;
    b = b.slice(0, i).concat(b.slice(i + 1));
    return true;
  });
}

// ===== 顾客入场：先按右向走一段，到位后转正面站定 =====
function enterCustomer() {
  const img = $('swCustImg');
  const geom = fourDirGeom(_g.dex);
  const cust = $('swCust');
  const stage = document.querySelector('.sw-stage');
  if (!img || !cust || !geom) return;
  // 提前把待机图灌进缓存，等会儿切过去才不会白一下
  const warm = new Image();
  tryLoadImage(warm, fourDirSrc(geom, 'idle'));

  tryLoadImage(img, fourDirSrc(geom, 'walk'));
  fourDirFitContent(img, geom, 'walk', CUST_FIT, { row: DIR_ROW.right });
  _g.cust = { img, name: 'walk', anim: fourDirAnim(geom, 'walk'), row: DIR_ROW.right, frame: 0, nextAt: performance.now() };
  if (!_custRaf) _custRaf = requestAnimationFrame(custTick);

  if (stage) stage.classList.remove('leaving');
  // 上一位是往右走掉的，先把位置按回左侧起点再放行，否则会从右边滑进来
  cust.classList.remove('out', 'in');
  cust.classList.add('pre');
  void cust.offsetWidth;   // 重排一次，让入场动画能重头播
  cust.classList.remove('pre');
  cust.classList.add('in');

  const seq = _g.custSeq;
  setTimeout(() => {
    if (!_g || _g.done || !_g.cust || _g.custSeq !== seq || _g.phase !== 'serve') return;
    const idle = fourDirAnim(geom, 'idle');
    _g.cust.row = DIR_ROW.down;
    _g.cust.frame = 0;
    _g.cust.nextAt = performance.now();
    if (idle && idle.n > 1) {
      _g.cust.name = 'idle';
      _g.cust.anim = idle;
      tryLoadImage(img, fourDirSrc(geom, 'idle'));
    }
  }, 900);
}

// 顾客退场：切回右向行走，向右走出屏幕（.sw-stage 裁掉出界部分）
function exitCustomer() {
  const m = _g && _g.cust;
  const cust = $('swCust');
  const stage = document.querySelector('.sw-stage');
  if (!m || !cust) return;
  const geom = fourDirGeom(_g.dex);
  if (stage) stage.classList.add('leaving');
  if (geom) {
    tryLoadImage(m.img, fourDirSrc(geom, 'walk'));
    fourDirFitContent(m.img, geom, 'walk', CUST_FIT, { row: DIR_ROW.right });
    m.name = 'walk';
    m.anim = fourDirAnim(geom, 'walk');
    m.row = DIR_ROW.right;
    m.frame = 0;
    m.nextAt = performance.now();
  }
  // 直接换成 .out：从当前站位一路走到屏幕外，中途别重排，否则会先闪回入场位
  cust.classList.remove('in');
  cust.classList.add('out');
  if (!_custRaf) _custRaf = requestAnimationFrame(custTick);
  // 冰激凌跟着顾客走了：清空手上这杯，台面上只剩空蛋筒
  _g.pick = { deco: null, flavors: [] };
  refreshPick();
}

// 转屏 / 改窗口大小后重新贴合尺寸（动作与方向不变，逐帧那步会自己接上）
function refitCust() {
  if (!_g || !_g.cust) return;
  const geom = fourDirGeom(_g.dex);
  if (geom) fourDirFitContent(_g.cust.img, geom, _g.cust.name, CUST_FIT, { row: _g.cust.row });
}

// 从别的页面切回来：顾客还站在原地，把逐帧接上就行，别重播入场
function resumeCustomer() {
  if (!_g || !_g.cust) return;
  if (!_custRaf) _custRaf = requestAnimationFrame(custTick);
}

function custTick() {
  // 先把句柄清掉：中途 return 也不会留下一个假的 id，入场时才会重新起循环
  _custRaf = null;
  const m = _g && _g.cust;
  if (!m) return;
  const now = performance.now();

  // 倒计时：顾客站着等的时候才走；切到别的页面、或者已经交单了都不算
  const waiting = (_g.phase === 'serve' || _g.phase === 'qte') && !_g.paused;
  if (waiting) {
    if (getCurrentView() === 'sweetView') {
      const dt = _g.tickLast ? Math.min(200, now - _g.tickLast) : 0;
      if (dt > 0) {
        _g.timeLeft = Math.max(0, _g.timeLeft - dt / 1000);
        const sec = Math.ceil(_g.timeLeft);
        if (sec !== _g.timeShown) { _g.timeShown = sec; paintHead(); }
        if (_g.timeLeft <= 0) { timeUp(); return; }
      }
    }
    _g.tickLast = now;
  } else {
    _g.tickLast = 0;
  }

  if (now >= m.nextAt) {
    const n = Math.max(1, m.anim.n);
    if (m.frame >= n) m.frame = 0;
    m.img.style.objectPosition = `-${m.frame * m.anim.w}px -${m.row * m.anim.h}px`;
    m.nextAt = now + fourDirDelay(m.anim, m.frame);
    m.frame = (m.frame + 1) % n;
  }
  _custRaf = requestAnimationFrame(custTick);
}

// 顾客说完一句反馈再退场，退完换下一位
function sayAndLeave(kind) {
  if (!_g || _g.done || _g.phase === 'leaving') return;
  _g.phase = 'leaving';
  _g.fb = rndOf(LINES[kind] || LINES.good);
  _g.rave = kind === 'rave';
  cancelAnimationFrame(_qteRaf); _qteRaf = null;
  paint();
  const seq = _g.custSeq;
  setTimeout(() => {
    if (!_g || _g.done || _g.custSeq !== seq || _g.phase !== 'leaving') return;
    exitCustomer();
  }, 800);   // 让台词先停一会儿，再走
  setTimeout(() => {
    if (!_g || _g.done || _g.custSeq !== seq) return;
    nextCustomer();
  }, 1700);
}

// 等超时：这单失败，不给气球，顾客抱怨一句就走
function timeUp() {
  if (!_g || _g.done || _g.phase === 'leaving') return;
  playMahjongSfx('ui');
  sayAndLeave('timeout');
}

// ===== 画面 =====
function paint() {
  if (!_g) return;
  const over = _g.phase === 'result';
  paintHead();
  // 结算时只留结算面板：顾客、预览、气泡、顶部那一行全部收掉
  const head = document.querySelector('.sw-head');
  if (head) head.style.display = over ? 'none' : '';
  const stage = document.querySelector('.sw-stage');
  if (stage) stage.style.display = over ? 'none' : '';
  const bubble = $('swBubble');
  if (bubble) {
    if (_g.phase === 'serve' || _g.phase === 'qte') bubble.innerHTML = orderText();
    else bubble.innerHTML = _g.phase === 'leaving' ? _g.fb : '';
    // 爆赞那句话单独走粉色
    bubble.classList.toggle('rave', _g.phase === 'leaving' && !!_g.rave);
  }
  paintPanel();
}

// 顾客说的那句话：逐层口味 + 糖饰，口味和糖饰各带自己的颜色
// 不念方向，报的就是叠放次序：念到哪个就叠哪个，头一个落在筒口
// 只有困难档讲次序（用箭头串起来），简单/普通档只要种类数量对上
function orderText() {
  const o = _g.order;
  const want = flavorPhrase(o.flavors, _g.level.ordered);
  const deco = `<b class="sw-ink" style="color:${decoInk(o.deco)}">${o.deco}</b>`;
  return `我要${want}口味，再加${deco}`;
}

// 同口味不重复念：「草莓、草莓、芒果」说成「草莓 2 份、芒果」
// 困难档讲次序，只有挨着的同口味能并成一份（草莓→草莓→芒果 = 草莓 2 份→芒果）
function flavorPhrase(list, ordered) {
  const groups = [];
  list.forEach((f) => {
    const last = groups[groups.length - 1];
    const hit = ordered ? (last && last.id === f ? last : null) : groups.find((g) => g.id === f);
    if (hit) hit.n++;
    else groups.push({ id: f, n: 1 });
  });
  return groups.map((g) => {
    const text = g.n > 1 ? `${g.id} ${g.n} 份` : g.id;
    return `<b class="sw-ink" style="color:${flavorInk(g.id)}">${text}</b>`;
  }).join(ordered ? '→' : '、');
}

function paintHead() {
  const info = $('swInfo');
  if (info) info.textContent = _g.phase === 'result' ? '营业结束' : `顾客 ${_g.round}/${ROUNDS}`;
  // 秒数只在顾客真的在等的时候挂着：交单后表停了，再留着数字会误导
  const on = _g.phase === 'serve' && !_g.paused;
  const time = $('swTime');
  if (time) {
    time.textContent = on ? `剩余 ${Math.ceil(_g.timeLeft)}s` : '';
    time.classList.toggle('low', on && _g.timeLeft <= 6);
  }
  const coins = $('swCoins');
  if (coins) coins.innerHTML = `<img src="${COIN_ICON}" alt="">${_g.coins}`;
}

function paintPanel() {
  const panel = $('swPanel');
  if (!panel) return;
  if (_g.phase === 'result') { panel.innerHTML = resultHtml(); return; }
  // 退场时面板保持原样（出货结果还在提示里），等下一位顾客进来再重建
  if (_g.phase === 'leaving') return;
  if (_g.phase === 'qte') { panel.innerHTML = qteHtml(); mountQte(); return; }
  panel.innerHTML = serveHtml();
  mountServe();
}

// 成品预览按 DPR 放大画布、再压回固定 CSS 尺寸：高分屏上不糊
// 显示尺寸按最高层数定一个统一缩放，各层数比例一致，也不会把站台撑高
let _pvSeq = 0;
const _pvOff = document.createElement('canvas');   // 离屏合成：连点时只有最后一次的结果会拷上来
function paintPreview(deco, flavors) {
  const cv = $('swOrderCv');
  if (!cv) return;
  const seq = ++_pvSeq;
  const n = (flavors || []).length;
  const k = PREVIEW_H / icecreamHeight(3);
  cv.style.width = `${ICECREAM_W * k}px`;
  cv.style.height = `${icecreamHeight(n) * k}px`;
  paintIcecream(_pvOff, deco, flavors, 2 * DPR).then(() => {
    if (seq !== _pvSeq) return;   // 连点时只认最后一次
    cv.width = _pvOff.width;
    cv.height = _pvOff.height;
    cv.getContext('2d').drawImage(_pvOff, 0, 0);
  });
}

function serveHtml() {
  const decos = ICE_DECOS.map((d) => `
    <span class="sw-chip sw-deco" data-deco="${d}"><img data-sweet="${d}" alt=""></span>`).join('');
  // 口味就用纯色块：按彩虹顺序排下来，一眼扫过去就能对上需求里的颜色
  const flavs = ICE_FLAVORS.map((f) => `
    <span class="sw-chip sw-flavor" data-flavor="${f.id}" style="background:${f.colors[0]}"></span>`).join('');
  return `
    <div class="sw-picks">
      <div class="sw-row" id="swDecoRow">${decos}</div>
      <div class="sw-row" id="swFlavorRow">${flavs}</div>
    </div>
    <div class="sw-actions">
      <button id="swDiscard">丢弃</button>
      <button class="sw-primary" id="swOk" disabled>确定</button>
    </div>`;
}

function mountServe() {
  // 糖饰图标走统一加载器：中文文件名在原生 src 下会 404，得靠 encodeURI/IPC 兜底
  document.querySelectorAll('#swDecoRow [data-sweet]').forEach((im) => {
    tryLoadImage(im, `./items/sweets/${im.dataset.sweet}.png`);
  });

  const decoRow = $('swDecoRow');
  if (decoRow) decoRow.onclick = (e) => {
    if (_g.phase !== 'serve') return;
    const el = e.target.closest('[data-deco]');
    if (!el) return;
    // 糖饰只有一个位置，放上就定了：想换、想取下来都只能丢弃重做
    if (_g.pick.deco) { hintDiscard(); return; }
    _g.pick.deco = el.dataset.deco;
    _g.paused = false;                // 又动上手了，表接着走
    playMahjongSfx('ui');
    refreshPick();
  };

  const flavRow = $('swFlavorRow');
  if (flavRow) flavRow.onclick = (e) => {
    if (_g.phase !== 'serve') return;
    const el = e.target.closest('[data-flavor]');
    if (!el) return;
    // 糖饰封了顶就不能再往上叠球：球还没叠够就是死局，只能丢弃重做，所以把丢弃键点亮
    if (_g.pick.deco) {
      if (_g.pick.flavors.length < _g.level.layers) hintDiscard();
      return;
    }
    if (_g.pick.flavors.length >= _g.level.layers) return;
    _g.pick.flavors.push(el.dataset.flavor);
    _g.paused = false;
    playMahjongSfx('ui');
    refreshPick();
  };

  const ok = $('swOk');
  if (ok) ok.onclick = confirmOrder;
  const discard = $('swDiscard');
  if (discard) discard.onclick = discardPick;
  refreshPick();
}

// 丢弃手上的这杯：重头做，不扣气球，代价就是白等一会儿顾客
function discardPick() {
  if (!_g || _g.phase !== 'serve') return;
  _g.pick = { deco: null, flavors: [] };
  _g.paused = false;
  playMahjongSfx('ui');
  refreshPick();
}

// 糖饰放早了、球叠不上去，或者想把糖饰取下来：把丢弃键点亮闪两下，这杯只能重做
function hintDiscard() {
  const btn = $('swDiscard');
  if (!btn) return;
  btn.classList.remove('nudge');
  void btn.offsetWidth;   // 重排一次，连点也能重播
  btn.classList.add('nudge');
}

// 选料状态回填：确定键能不能按 + 成品预览（选料键都不留状态，放了就是放上去了）
function refreshPick() {
  const p = _g.pick;
  const ok = $('swOk');
  if (ok) ok.disabled = !(p.deco && p.flavors.length === _g.level.layers);
  // 预览跟着手上的料走：默认空筒，叠了球才往上加
  paintPreview(p.deco, p.flavors);
}

function confirmOrder() {
  if (_g.phase !== 'serve') return;
  const p = _g.pick;
  const o = _g.order;
  if (!p.deco || p.flavors.length !== _g.level.layers) return;
  _g.paused = true;   // 交单就把表停了：出货那一下不该还被倒计时追着
  playMahjongSfx('ui');
  // 对不对先记着不表态，等出货那一下顾客才给结果
  _g.right = p.deco === o.deco
    && (_g.level.ordered ? p.flavors.every((f, i) => f === o.flavors[i]) : sameFlavors(p.flavors, o.flavors));
  startQte();
}

// ===== 时机点击条 =====
// 出货就是光标按在绿区里那一下，没有别的提示文字；绿区位置每单随机，别让玩家闭着眼点中间
function qteHtml() {
  const c = _g.qte.c;
  return `
    <div class="sw-bar" id="swBar">
      <div class="sw-zone" style="width:${QTE.zone * 200}%;left:${(c - QTE.zone) * 100}%"></div>
      <div class="sw-perfect" style="width:${QTE.perfect * 200}%;left:${(c - QTE.perfect) * 100}%"></div>
      <div class="sw-cursor" id="swCursor" style="left:0%"></div>
    </div>
    <div class="sw-actions"><button class="sw-primary" id="swPress">出货</button></div>`;
}

function mountQte() {
  const bar = $('swBar');
  if (bar) bar.onclick = pressQte;
  const btn = $('swPress');
  if (btn) btn.onclick = pressQte;
}

function startQte() {
  _g.phase = 'qte';
  // 绿区中心每单重摇一次，落在条内不贴边（左边界 zone、右边界 1-zone）
  const c = QTE.zone + Math.random() * (1 - 2 * QTE.zone);
  _g.qte = { pos: 0, dir: 1, hit: null, last: 0, c };
  paintHead();      // 进 QTE 就把顶上的秒数收掉
  paintPanel();
  cancelAnimationFrame(_qteRaf);
  _qteRaf = requestAnimationFrame(qteLoop);
}

function qteLoop(ts) {
  const q = _g && _g.qte;
  if (!_g || _g.phase !== 'qte' || !q || q.hit) { _qteRaf = null; return; }
  const now = ts || performance.now();
  const dt = q.last ? Math.min(50, now - q.last) : 0;
  q.last = now;
  q.pos += (q.dir * QTE.speed * dt) / 1000;
  if (q.pos >= 1) { q.pos = 1; q.dir = -1; }
  if (q.pos <= 0) { q.pos = 0; q.dir = 1; }
  const cur = $('swCursor');
  if (cur) cur.style.left = `${q.pos * 100}%`;
  _qteRaf = requestAnimationFrame(qteLoop);
}

function pressQte() {
  const q = _g && _g.qte;
  if (!_g || _g.phase !== 'qte' || !q || q.hit) return;
  const lv = _g.level;
  const d = Math.abs(q.pos - q.c);
  const hit = d <= QTE.perfect ? 'perfect' : d <= QTE.zone ? 'good' : 'miss';
  q.hit = hit;
  // 单子做错了，时机按得再准也白搭：顾客不认，一个气球不给
  const gain = _g.right ? (hit === 'perfect' ? lv.perfect : hit === 'good' ? lv.good : 0) : 0;
  // 做对了才有机会被爆赞：额外补一笔，台词也走粉色那几句
  const rave = _g.right && hit !== 'miss' && Math.random() < RAVE_CHANCE;
  _g.coins += gain + (rave ? lv.rave : 0);
  playMahjongSfx('ui');
  paintHead();

  const cur = $('swCursor');
  if (cur) cur.style.left = `${q.pos * 100}%`;
  const bar = $('swBar');
  if (bar) bar.classList.add('locked');
  const btn = $('swPress');
  if (btn) btn.disabled = true;   // 出货键按下就定死，免得像是还能再点一次
  const verdict = _g.right ? hit : 'wrong';
  setTimeout(() => sayAndLeave(rave ? 'rave' : verdict), 800);
}

// ===== 一轮营业的推进 =====
function nextCustomer() {
  if (!_g || _g.done) return;
  if (_g.round >= ROUNDS) return finish();
  _g.round++;
  _g.dex = _g.queue[_g.round - 1];   // 本轮排好的队伍，第几位就是第几只
  _g.order = makeOrder(_g.level);
  _g.pick = { deco: null, flavors: [] };
  _g.phase = 'serve';
  _g.custSeq++;
  _g.paused = false;
  _g.timeLeft = _g.level.time;
  _g.timeShown = -1;
  _g.tickLast = 0;
  _g.fb = '';
  _g.rave = false;
  paint();
  enterCustomer();
}

function finish() {
  if (!_g || _g.done) return;
  _g.done = true;
  _g.phase = 'result';
  clearInterval(_timer); _timer = null;
  cancelAnimationFrame(_qteRaf); _qteRaf = null;
  cancelAnimationFrame(_custRaf); _custRaf = null;
  if (_g.onFinish) { try { _g.onFinish(_g.coins); } catch (e) { console.error('[甜蜜工坊] 结算出错：', e); } }
  playMahjongSfx('ui');
  paint();
}

function resultHtml() {
  return `
    <div class="sw-result">
      <p class="sw-result-title">营业结束</p>
      <p class="sw-result-coins"><img src="${COIN_ICON}" alt="">+${_g.coins} 气球</p>
      <div class="sw-result-btns">
        <span class="catch-confirm-btn" data-sw="again">再来一轮</span>
        <span class="catch-confirm-btn" data-sw="back">返回</span>
      </div>
    </div>`;
}

// 结算面板的按钮走面板这一层的委托（面板元素本身不换，只换 innerHTML）
function onPanelClick(e) {
  const btn = e.target.closest('[data-sw]');
  if (!btn || !_g) return;
  if (btn.dataset.sw === 'again') startSweetGame({ level: _g.level.id, onFinish: _g.onFinish });
  else leaveSweetGame();
}

export function startSweetGame(opts = {}) {
  if (!$('sweetView')) return;
  const level = swLevelOf(opts.level);
  const queue = pickCustomers(ROUNDS);   // 本轮这几位顾客：洗完牌按序上场，一轮里不重样
  _g = {
    level,
    round: 1,
    queue,
    dex: queue[0],
    order: null,
    pick: { deco: null, flavors: [] },
    coins: 0,
    phase: 'serve',
    cust: null,
    qte: null,
    custSeq: 1,   // 顾客编号：换人时 +1，用来作废上一位还没跑完的定时器
    timeLeft: level.time,
    timeShown: -1,
    tickLast: 0,
    paused: false,   // 交单后停表，回到选料或换下一位顾客再走
    right: true,     // 这一单做没做对，等出货那一下才由顾客表态
    rave: false,     // 这一单有没有被顾客爆赞
    fb: '',       // 顾客退场前撂下的那句话
    done: false,
    live: true,   // 是否正显示着这一页（切到别的页面会置 false）
    onFinish: opts.onFinish || null,
  };
  _g.order = makeOrder(level);
  if (getCurrentView() !== 'sweetView') pushNav('sweetView');   // 再来一轮时已经在店里，别再压一层
  showView('sweetView');
  const panel = $('swPanel');
  if (panel) panel.onclick = onPanelClick;
  paint();
  enterCustomer();

  clearInterval(_timer);
  // 切去别的页面（比如设置）先留着这一轮，回来重画一帧接着玩；真正退出只有按返回键那一条路
  _timer = setInterval(() => {
    if (!_g || _g.done) return;
    if (getCurrentView() === 'sweetView') {
      if (!_g.live) {
        _g.live = true;
        paint();
        if (_g.phase === 'serve') resumeCustomer();
        else if (_g.phase === 'qte') { cancelAnimationFrame(_qteRaf); _qteRaf = requestAnimationFrame(qteLoop); }
      }
    } else {
      _g.live = false;
    }
  }, 1000);
}

// 离开：没做完的直接作废，气球照给（已经赚到的记账在 onFinish 里）
export function leaveSweetGame() {
  if (_g) _g.done = true;
  clearInterval(_timer); _timer = null;
  cancelAnimationFrame(_custRaf); _custRaf = null;
  cancelAnimationFrame(_qteRaf); _qteRaf = null;
  _g = null;
  if (getCurrentView() !== 'sweetView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');   // 活动已下架：退回手机首页
  });
}

// 转屏 / 改窗口大小：预览和顾客都要重新贴合，重画一次即可（状态都在 _g 里）
window.addEventListener('resize', () => {
  if (_g && !_g.done && getCurrentView() === 'sweetView') { paint(); refitCust(); }
});
