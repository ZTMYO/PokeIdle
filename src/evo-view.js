// ===== 进化演出 =====
// 约 6.5~7.4 秒，点画面跳过：登场 → 道具注入 → 能量汇聚转白剪影 → 剪影交替 6 拍 → 收束 → 新形态浮现。
// 全部按 render(t) 纯函数渲染，暂停 / 跳过 / 重播只是换一个 t。
import { getPokemonByIndex, setPhase } from './state.js';
import { TYPE_COLORS, itemIconSrc } from './items.js';
import { $, showView, tryLoadPokemonImage } from './ui.js';
import { playCongratulation } from './audio.js';

/* ---------- 节奏参数 ---------- */
const CFG = {
  intro: 200,              // ① 登场，不用等太久
  itemFly: 900,            // ① 每个道具飞入；双道具依次来，中间隔 itemGap
  itemGap: 120,            // 两件道具之间的间隔
  gather: 1100,            // ② 能量汇聚：底色换掉 + 粒子被吸进来 + 转白剪影
  beatDurs: [700, 560, 440, 340, 260, 200],  // ③ 剪影交替：逐拍加快；6 拍收在初始形态剪影上
  beatSplit: [0.42, 0.13, 0.33, 0.12],       // 每拍内：缩小 / 闪白换影 / 放大 / 停留
  burst: 180,              // ④ 收束：接着最后一拍的节奏匀速收小
  finish: 900,             // ⑤ 彩色立绘放大显现
  hold: 700,               // ⑤ 停住展示
  spriteFrac: 0.52,        // 立绘高度 = 屏幕高度 × 这个比例
  particleDensity: 1.6,    // 粒子数 ≈ 面积 ÷ (这个值 × 1000)，调大即调少
};

// 时空扭曲外观变体是一串 CSS filter；演出每帧都写 inline filter 会盖掉类上那串，所以得拼进去。
const VARIANT_FILTER = {
  rgb: 'drop-shadow(2px 0 0 rgba(255,0,80,.65)) drop-shadow(-2px 0 0 rgba(0,220,255,.65))',
  polluted: 'grayscale(1) sepia(1) hue-rotate(248deg) saturate(7) brightness(.65)',
};

let L = null;              // 图层缓存
let st = null;             // 本次演出状态
let raf = 0, last = 0;

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const mix = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k * k;
const easeInOut = (k) => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
// 区间进度：毫秒区间与 0~1 归一化区间都要能用，所以只防除零、不夹到 1
const seg = (t, a, b) => clamp01((t - a) / Math.max(0.000001, b - a));
const spike = (t, c, dur, peak) => Math.max(0, peak * (1 - Math.abs(t - c) / dur));
// 颜色：hex 与 rgb() 都要能吃，嵌套混色时会传进来 rgb() 串
function toRgb(c) {
  if (typeof c === 'string' && c.charAt(0) === '#') {
    const h = c.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = String(c).match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
}
function rgbMix(c1, c2, k) {
  const a = toRgb(c1), b = toRgb(c2);
  return `rgb(${Math.round(mix(a[0], b[0], k))},${Math.round(mix(a[1], b[1], k))},${Math.round(mix(a[2], b[2], k))})`;
}
const typeColor = (types, i) => TYPE_COLORS[types[i] || types[0]] || '#7fb2ff';
// 按比例压暗，色相不变
const shade = (c, k) => { const [r, g, b] = toRgb(c); return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`; };
// 演出底色：取属性色的色相，饱和度封顶 0.38、亮度封顶 0.44
const BG_S = 0.38, BG_L = 0.44;
const DUAL_WAVE_MS = 2800;   // 双属性来回一轮的时长，正弦所以来回都平滑
function bgColor(c) {
  const [r0, g0, b0] = toRgb(c);
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l0 = (mx + mn) / 2;
  const s = Math.min(l0 === 0 || l0 === 1 ? 0 : d / (1 - Math.abs(2 * l0 - 1)), BG_S);
  const l = Math.min(l0, BG_L);
  const C = (1 - Math.abs(2 * l - 1)) * s;
  const X = C * (1 - Math.abs((h % 2) - 1));
  const m = l - C / 2;
  const seg = h < 1 ? [C, X, 0] : h < 2 ? [X, C, 0] : h < 3 ? [0, C, X] : h < 4 ? [0, X, C] : h < 5 ? [X, 0, C] : [C, 0, X];
  return `rgb(${seg.map((v) => Math.round((v + m) * 255)).join(',')})`;
}

function layers() {
  if (L) return L;
  L = {
    view: $('evoView'), canvas: $('evoFx'),
    mon: $('evoMon'), halo: $('evoHalo'), core: $('evoCore'), floor: $('evoFloor'),
    glowL: $('evoGlowL'), glowR: $('evoGlowR'), vig: $('evoVig'), flash: $('evoFlash'),
    item: $('evoItem'), starBox: $('evoStarBox'), starLayers: [...document.querySelectorAll('#evoStarBox i')],
    done: $('evoDone'), doneText: $('evoDoneText'), doneOk: $('evoDoneOk'),
  };
  L.ctx = L.canvas.getContext('2d');
  return L;
}

// 点画面 = 跳过；演出期间导航被 isModalLocked 锁住，只留这一个出口
let _skipBound = false;
function bindSkip() {
  if (_skipBound) return;
  _skipBound = true;
  const l = layers();
  l.view.addEventListener('click', () => { if (st && st.playing) skipEvolution(); });   // 播放中点画面 = 跳过
  l.doneOk.addEventListener('click', (e) => { e.stopPropagation(); if (st && st.awaiting) confirmDone(); });
}

/* ---------- 时间轴 ---------- */
function addSeg(t, dur) { const a = t; return [a, a + dur]; }
function buildTimeline(startT, itemCount) {
  const t = {};
  let c = startT;
  t.intro = addSeg(c, CFG.intro); c = t.intro[1];
  t.items = [];
  for (let i = 0; i < itemCount; i++) {
    const s = addSeg(c, CFG.itemFly); c = s[1]; t.items.push(s);
    if (i < itemCount - 1) c += CFG.itemGap;
  }
  t.gather = addSeg(c, CFG.gather); c = t.gather[1];
  t.beats = CFG.beatDurs.map((d) => { const s = addSeg(c, d); c = s[1]; return s; });
  t.burst = addSeg(c, CFG.burst); c = t.burst[1];
  t.finish = addSeg(c, CFG.finish); c = t.finish[1];
  t.hold = addSeg(c, CFG.hold); c = t.hold[1];
  t.total = c;
  return t;
}
function beatSwapTime(i) {
  const [s, e] = st.T.beats[i];
  return s + (e - s) * (CFG.beatSplit[0] + CFG.beatSplit[1] / 2);
}

/* ---------- 立绘尺寸 ---------- */
function fitMon() {
  const { mon, halo, core, floor } = layers();
  const boxH = st.H * CFG.spriteFrac, boxW = st.W * 0.74;
  const nw = mon.naturalWidth || 96, nh = mon.naturalHeight || 96;
  const k = Math.min(boxW / nw, boxH / nh);
  st.monSize = { w: Math.round(nw * k), h: Math.round(nh * k) };
  mon.style.width = st.monSize.w + 'px';
  mon.style.height = st.monSize.h + 'px';
  const monD = Math.max(st.monSize.w, st.monSize.h);      // 光晕/核心光按外接正方形给，保证是正圆
  halo.style.width = halo.style.height = Math.round(monD * 1.9) + 'px';
  core.style.width = core.style.height = Math.round(monD * 1.5) + 'px';
  floor.style.width = Math.round(st.monSize.w * 1.6) + 'px';
  const starD = Math.round(Math.max(st.W, st.H) * 1.15);   // 星盘别铺太大，蒙版栅格化也要钱
  const sb = $('evoStarBox');
  sb.style.width = sb.style.height = starD + 'px';
}

/* ---------- 粒子：② 一波从四周被吸进宝可梦身上，收进去就没了 ---------- */
// 光点用一个预渲染的小图反复贴：每帧给几十颗粒子现搭径向渐变是入场卡顿的主因之一
let _glow = null;
function glowSprite() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.32, 'rgba(255,255,255,0.42)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _glow = c;
  return c;
}
function spawnParticles() {
  const { monSize, W, H, T } = st;
  const monR = Math.max(16, (monSize.h || 100) / 2);
  const n = Math.max(40, Math.min(200, Math.round(W * H / (CFG.particleDensity * 1000))));
  const g0 = T.gather[0], gLen = CFG.gather;
  st.parts = [];
  for (let i = 0; i < n; i++) {
    st.parts.push({
      a0: Math.random() * Math.PI * 2,
      spin: (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? -1 : 1) * 0.3,
      r0: monR * (1.7 + Math.random() * 2.6),      // 从宝可梦外围起步，常常在屏幕外
      r1: monR * (0.04 + Math.random() * 0.28),    // 收进身体里 → 被吸收
      born: g0 + Math.random() * gLen * 0.45,      // ② 开始后陆续出发
      life: 650 + Math.random() * 500,             // 一趟 0.65~1.15 秒；末尾几颗会追进 ③，不等它们
      size: 0.9 + Math.random() * 1.4,
      alpha: 0.6 + Math.random() * 0.4,
      tw: 1 + Math.random() * 3,
    });
  }
}

/* ---------- 各量随时间的取值 ---------- */
function glowAt(t) {
  const T = st.T;
  if (t < T.gather[0]) return 0;
  let g = 0.5 * easeInOut(seg(t, T.gather[0], T.gather[1]));
  T.beats.forEach(([,], i) => { g += 0.1 * Math.max(0, 1 - Math.abs(t - beatSwapTime(i)) / 260); });
  g += 0.5 * Math.sin(Math.PI * seg(t, T.burst[0], T.burst[1]));
  // ⑤ 跟着结果一起退干净：绿底上别留圆形属性色斑
  if (t >= T.finish[0]) g *= 1 - easeInOut(seg(t, T.finish[0], T.finish[0] + CFG.finish * 0.8));
  return Math.min(1.2, g);
}
function silAt(t) {
  // 变白来得早一点：② 走到 ~72% 就已经全白，剩下时间给粒子收尾
  return easeInOut(seg(t, st.T.gather[0] + CFG.gather * 0.1, st.T.gather[0] + CFG.gather * 0.72));
}
// 中心压暗 + 四周暗角：② 起、⑤ 跟着结果一起退干净
function vigAt(t) {
  const T = st.T;
  const up = easeInOut(seg(t, T.gather[0], T.gather[0] + 700));
  if (t < T.finish[0]) return up;
  return up * (1 - easeInOut(seg(t, T.finish[0], T.finish[1] + 200)));
}
function filterAt(t) {
  const T = st.T;
  if (t >= T.finish[0]) {                 // ⑤ 白色剪影 → 彩色：brightness 0→1、invert 1→0
    const k = easeInOut(seg(t, T.finish[0], T.finish[0] + CFG.finish * 0.66));
    return k >= 1 ? '' : `brightness(${k.toFixed(3)}) invert(${(1 - k).toFixed(3)})`;   // 收尾给空串：拼变体滤镜时 'none xxx' 是非法值，整条会被丢掉
  }
  const s = silAt(t);
  const b = 1 - easeIn(seg(s, 0, 0.62));
  const inv = easeOut(seg(s, 0.55, 1));
  return `brightness(${b.toFixed(3)}) invert(${inv.toFixed(3)})`;
}
function monScaleAt(t) {
  const T = st.T;
  if (t < T.beats[0][0]) return 1;        // ①② 阶段保持原大小：登场、丢道具、汇聚都不缩放
  if (t < T.burst[0]) {
    const i = T.beats.findIndex(([s, e]) => t >= s && t < e);
    if (i < 0) return 1;
    const [s, e] = T.beats[i];
    const [ka, kb, kc] = CFG.beatSplit;
    const hi = 1 - i * 0.03, lo = 0.5 - i * 0.015;   // 逐拍整体收小，首拍从 1.0 起
    const p = (t - s) / (e - s);
    if (p < ka) return mix(hi, lo, easeIn(p / ka));
    if (p < ka + kb) return lo;
    if (p < ka + kb + kc) return mix(lo, hi, easeOut((p - ka - kb) / kc));
    return hi;
  }
  // ④ 从最后一拍放大的尺寸匀速继续收：不用慢起曲线，免得接着快节奏时像卡了一下
  if (t < T.burst[1]) return mix(1 - (T.beats.length - 1) * 0.03, 0.34, seg(t, T.burst[0], T.burst[1]));
  return mix(0.6, 1, easeOut(seg(t, T.finish[0], T.finish[0] + CFG.finish * 0.62)));
}
function monAlphaAt(t) {
  const T = st.T;
  if (t >= T.burst[0] && t < T.finish[0]) return 1 - easeIn(seg(t, T.burst[0], T.burst[1])) * 0.9;  // ④ 剪影淡出
  if (t >= T.finish[0]) return easeOut(seg(t, T.finish[0], T.finish[0] + 220));                      // ⑤ 新形态浮现
  return 1;
}
function beatFace(t) {
  let face = 0;
  st.T.beats.forEach(([,], i) => { if (t >= beatSwapTime(i)) face = (i + 1) % 2; });
  return face;
}
function flashAt(t) {
  // 没有白场：③ 每次换影只给很轻的一下
  let a = 0;
  st.T.beats.forEach(([,], i) => { a = Math.max(a, spike(t, beatSwapTime(i), 120, 0.07 + i * 0.04)); });
  return Math.min(1, a);
}
// 八角星能量：③ 起来、④ 最强，⑤ 跟着结果一起退掉，留一点余辉
function starAt(t) {
  const T = st.T;
  let k = easeInOut(seg(t, T.beats[0][0], T.beats[0][0] + 420));
  if (t >= T.burst[0]) k = Math.max(k, 1);
  if (t >= T.finish[0]) k *= 1 - easeInOut(seg(t, T.finish[0], T.finish[0] + 520));   // 八角星也退干净
  return clamp01(k);
}
// 背景渐变进度：0 = 游戏原本的绿底，1 = 完全变成属性色的深底
// ⑤ 出结果的同时铺回绿底：收尾停在成形那一刻等确认，画面得回到游戏的样子
function darkAt(t) {
  const T = st.T;
  if (t < T.burst[0]) return easeInOut(seg(t, T.gather[0], T.gather[1] + 200));
  if (t < T.finish[0]) return 1;
  return 1 - easeInOut(seg(t, T.finish[0], T.finish[0] + CFG.finish * 0.85));
}
// 白色核心光：② 汇聚完成时最亮，④ 再顶一下，⑤ 随结果退掉
function coreAt(t) {
  const T = st.T;
  let k = easeInOut(seg(t, T.gather[0] + CFG.gather * 0.1, T.gather[0] + CFG.gather * 0.72)) * 0.9;
  if (t >= T.burst[0]) k = Math.max(k, 1);
  if (t >= T.finish[0]) k *= 1 - easeInOut(seg(t, T.finish[0], T.finish[0] + 480));   // 收尾干净，别留白
  return clamp01(k);
}
// 变体特效只在彩色阶段挂：起始展示与 ⑤ 彩色回来之后；切换点落在画面已压黑或还没亮起时，看不出来
function variantOn(t) {
  if (!st.vFilter) return false;
  const T = st.T;
  if (t < T.finish[0]) return silAt(t) < 0.55;                       // ② 白到一半就不再挂
  const k = easeInOut(seg(t, T.finish[0], T.finish[0] + CFG.finish * 0.66));
  return k > 0.75;                                                  // ⑤ 彩色回来大半再挂上
}
function itemAt(t) {
  const T = st.T;
  const i = T.items.findIndex(([s, e]) => t >= s && t < e);
  if (i < 0) return null;
  const [s, e] = T.items[i];
  const p = clamp01((t - s) / (e - s));
  const x0 = -st.W * 0.5, y0 = st.H * 0.66, x1 = 0, y1 = -st.H * 0.05;
  const cx = -st.W * 0.1, cy = st.H * 0.2;
  const k = easeInOut(p);
  const q = (a, b, c) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * b + k * k * c;
  const sc = p < 0.6 ? mix(0.35, 1.1, easeOut(p / 0.6)) : mix(1.1, 0.5, (p - 0.6) / 0.4);
  const a = p < 0.1 ? p / 0.1 : p > 0.82 ? (1 - p) / 0.18 : 1;
  return { src: st.items[i], x: q(x0, cx, x1), y: q(y0, cy, y1), scale: sc, alpha: a, rot: mix(-22, 16, k) };
}

/* ---------- 渲染一帧 ---------- */
function render(t) {
  const { W, H } = st;
  const l = layers();
  const cx = W / 2, cy = H * 0.47;
  const shift = clamp01(seg(t, st.T.gather[1], st.T.burst[0]));
  // ③④ 收敛成当前属性色，⑤ 再舒展回"前形态 → 目标形态"的双色
  const focus = clamp01(seg(t, st.T.beats[0][0], st.T.beats[0][0] + 500)) * (1 - easeInOut(seg(t, st.T.finish[0], st.T.finish[0] + 500)));
  // 目标形态的属性色：单属性就用它，双属性在两种颜色之间平滑来回，约 2.8 秒一轮
  const prim = typeColor(st.to.types, 0);
  const prim2 = st.to.types[1] ? typeColor(st.to.types, 1) : prim;
  const wave = prim2 === prim ? 0 : 0.5 - 0.5 * Math.cos((Math.PI * 2 * t) / DUAL_WAVE_MS);
  const primT = rgbMix(prim, prim2, wave);
  // 演出用的"粉嫩版"属性色：原色偏深，往白里提一档
  const fresh = (c) => rgbMix(c, '#ffffff', 0.26);
  const primF = fresh(primT);
  const c1 = fresh(rgbMix(rgbMix(typeColor(st.from.types, 0), typeColor(st.to.types, 0), shift), primT, focus));
  const c2 = fresh(rgbMix(rgbMix(typeColor(st.from.types, 1), typeColor(st.to.types, 1), shift), primT, focus));
  l.view.style.setProperty('--c1', c1);
  l.view.style.setProperty('--c2', c2);
  l.view.style.setProperty('--star', primF);
  // 暗角 ＝ 当前底色的更深版，保住白剪影的对比
  l.view.style.setProperty('--vig-c', shade(bgColor(primT), 0.78));
  // 屏幕底色：绿 → 属性色的深底，② 结束时换完；双属性跟着上面那个来回一起渐变
  l.view.style.backgroundColor = rgbMix(st.baseBg, bgColor(primT), darkAt(t));

  // 八角星：三层错开、一圈圈往外走 + 缓慢自转
  const sk = starAt(t);
  l.starBox.style.opacity = sk;
  l.starBox.style.transform = `translate(-50%,-50%) rotate(${(t * 0.012).toFixed(2)}deg)`;
  l.starLayers.forEach((it, i) => {
    const cyc = ((t - st.T.beats[0][0]) / 980 + i / 3) % 1;
    const k = cyc < 0 ? 0 : cyc;
    it.style.transform = `scale(${mix(0.38, 2.15, easeOut(k)).toFixed(3)})`;
    it.style.opacity = (Math.sin(Math.PI * k) * (i === 0 ? 0.5 : i === 1 ? 0.4 : 0.32)).toFixed(3);
  });

  const g = glowAt(t);
  l.glowL.style.opacity = g * 0.9;
  l.glowR.style.opacity = g * 0.9;
  l.vig.style.opacity = vigAt(t);
  l.halo.style.opacity = Math.min(1, g * 1.05);
  l.core.style.opacity = coreAt(t);
  l.floor.style.opacity = 0.45 * g;
  l.flash.style.opacity = flashAt(t);

  // ③ 最后一拍停在初始形态剪影上；⑤ 一进来就换成新形态，切换那一瞬还是全透明
  const face = t >= st.T.finish[0] ? 1 : beatFace(t);
  const want = (face ? st.to : st.from).src;
  if (l.mon.dataset.src !== want) {
    l.mon.dataset.src = want;
    l.mon.src = want;
    fitMon();
  }
  l.mon.style.transform = `scale(${monScaleAt(t).toFixed(4)})`;
  const baseF = filterAt(t);
  l.mon.style.filter = (baseF ? baseF + ' ' : '') + (variantOn(t) ? st.vFilter : '');   // 变体特效只在彩色阶段挂
  l.mon.style.opacity = monAlphaAt(t);

  const it = itemAt(t);
  if (!it) {
    l.item.style.opacity = 0;
  } else {
    if (l.item.dataset.src !== it.src) { l.item.dataset.src = it.src; l.item.src = it.src; }
    l.item.style.opacity = it.alpha;
    l.item.style.transform =
      `translate(${it.x.toFixed(1)}px,${it.y.toFixed(1)}px) scale(${it.scale.toFixed(3)}) rotate(${it.rot.toFixed(1)}deg)`;
  }

  drawFx(t, cx, cy, primF);
}

function drawFx(t, cx, cy, ringHex) {
  const l = layers(), ctx = l.ctx;
  const { W, H } = st;
  ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
  ctx.save();
  ctx.scale(l.canvas.width / W, l.canvas.height / H);
  ctx.globalCompositeOperation = 'lighter';

  // 一波粒子：出生后往宝可梦身上收，收进去那一刻淡掉，之后就不再出现
  // 光点贴 glowSprite 的预渲染小图，不用每颗每帧现搭渐变
  const sp = glowSprite();
  for (const p of st.parts) {
    const u = (t - p.born) / p.life;
    if (u < 0 || u >= 1) continue;
    const r = mix(p.r0, p.r1, easeIn(u));                    // 越接近收尾越快：被吸进去
    const ang = p.a0 + p.spin * (t / 1000) * 1.6;
    const wob = Math.sin(t / 1000 * p.tw) * 2.2;
    const x = cx + Math.cos(ang) * r + wob;
    const y = cy + Math.sin(ang) * r;
    const a = p.alpha * Math.min(1, u / 0.1) * (1 - clamp01((u - 0.8) / 0.2)) * (0.6 + 0.4 * (1 - u));
    if (a <= 0.01) continue;
    const rad = p.size * (1 + (1 - u) * 0.55) * 3.4;         // 越靠近越亮越大
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(sp, x - rad, y - rad, rad * 2, rad * 2);
    // 中心再点一颗实心亮点：小屏上也要看得见
    ctx.globalAlpha = Math.min(1, a * 1.15);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, p.size * 0.85 * (1 + (1 - u) * 0.5)), 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 能量光圈：不跟换影节奏，按自己的固定间隔慢慢往外扩，整体很淡
  const ring = toRgb(ringHex);
  const ringEnv = easeOut(seg(t, st.T.gather[0], st.T.gather[0] + 800))                     // ② 起
    * (t >= st.T.finish[0] ? 1 - easeInOut(seg(t, st.T.finish[0], st.T.finish[0] + 400)) : 1);  // ⑤ 退掉
  if (ringEnv > 0.01) {
    const period = 1400, life = 2200;                     // 每 1.4s 放一个，一个扩 2.2s
    const r0 = Math.min(W, H) * 0.16, r1 = Math.min(W, H) * 0.92;
    const bornMax = Math.min(t, st.T.burst[1]);
    for (let born = st.T.gather[0]; born <= bornMax; born += period) {
      const p = (t - born) / life;
      if (p < 0 || p >= 1) continue;
      const rr = mix(r0, r1, easeOut(p));
      ctx.strokeStyle = `rgba(${ring[0]},${ring[1]},${ring[2]},${(0.14 * (1 - p) * ringEnv).toFixed(3)})`;
      ctx.lineWidth = 1.3 * (1 - p) + 0.4;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.stroke();
    }
  }
  ctx.restore();
}

/* ---------- 尺寸 ---------- */
function layout() {
  const l = layers();
  // 尺寸取演出自己那块屏（手游双屏下 #evoView 在下屏），视图还没显示时先借舞台尺寸排好
  const stage = $('screen');
  st.W = l.view.clientWidth || (stage && stage.clientWidth) || 0;
  st.H = l.view.clientHeight || (stage && stage.clientHeight) || 0;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  l.canvas.width = Math.round(st.W * dpr);
  l.canvas.height = Math.round(st.H * dpr);
  l.ctx.setTransform(1, 0, 0, 1, 0, 0);
  fitMon();
  spawnParticles();
}

/* ---------- 播放控制 ---------- */
function frame(ts) {
  if (!st || !st.playing) return;
  const dt = last ? ts - last : 0;
  last = ts;
  st.now += dt;
  if (st.now >= st.T.total) { st.now = st.T.total; st.playing = false; }
  render(st.now);
  if (st.playing) raf = requestAnimationFrame(frame);
  else endAnimation();
}
// 动画播完：停在成形那一刻，弹出"XX 已进化！"等玩家确认，不自己退页
function endAnimation() {
  cancelAnimationFrame(raf);
  if (!st) return;
  st.playing = false;
  st.awaiting = true;
  const l = layers();
  if (l.doneText) l.doneText.textContent = `${st.from.name} 进化成了 ${st.to.name}`;
  if (l.done) {
    l.done.style.display = 'flex';
    requestAnimationFrame(() => { l.done.style.transform = 'translateY(100%)'; void l.done.offsetHeight; l.done.classList.add('show'); l.done.style.transform = 'translateY(0)'; });
  }
  playCongratulation();   // 祝贺音效：提示先出来，音效放最后
}
// 点"确定"：收摊，回详情页
function confirmDone() {
  const l = layers();
  if (l.done) { l.done.classList.remove('show'); l.done.style.transform = 'translateY(100%)'; l.done.style.display = 'none'; }
  const cb = st && st.onFinish;
  st = null;
  setPhase('idle');
  showView('rosterView');   // 演出的落点固定是仓库页，详情页内容由调用方重渲染
  if (cb) cb();
}
function skipEvolution() {
  if (!st || st.awaiting) return;
  st.now = st.T.total;
  render(st.now);
  endAnimation();
}

/* ---------- 入口 ---------- */
// 立绘先预加载，走游戏那个加载器摸到最终 src 后再开演，
// 这样 ③ 换影时换图是命中缓存的，不会闪空白。
async function preloadSprite(idx, suff) {
  const poke = getPokemonByIndex(String(idx));
  if (!poke) return null;
  const img = new Image();
  const ok = await tryLoadPokemonImage(img, poke, suff);
  if (!ok) return null;
  // 顺手把首帧解码掉：动图在演出第一拍才解码会卡一下
  try { await img.decode(); } catch (_) { /* 不支持就跳过 */ }
  return img.src;
}

// from/to 传 { idx, name, types }；items 是道具键数组，如 ['火之石']；shiny 是个体是否闪光
export async function playEvolution({ from, to, items = [], shiny = false, variant = null, onFinish = null }) {
  const l = layers();
  if (!l.view) { onFinish && onFinish(); return; }   // 没挂上视图就直接回调，别卡流程（调用方的结算在 onFinish 里）
  const suff = shiny ? '_shiny' : '';
  const [srcFrom, srcTo] = await Promise.all([preloadSprite(from.idx, suff), preloadSprite(to.idx, suff)]);
  st = {
    from: { ...from, src: srcFrom || fallbackSrc(from.idx, suff) },
    to: { ...to, src: srcTo || fallbackSrc(to.idx, suff) },
    items: items.map((k) => itemIconSrc(k)),
    vFilter: VARIANT_FILTER[variant] || '',   // 个体的 rgb / 污染特效
    playing: true, now: 0, parts: [], onFinish,
  };
  st.baseBg = getComputedStyle(l.view).backgroundColor || '#73c5a4';
  st.T = buildTimeline(0, st.items.length);
  l.mon.dataset.src = st.from.src;
  l.mon.src = st.from.src;
  l.mon.onload = () => { if (st) { fitMon(); render(st.now); } };
  l.item.dataset.src = '';
  l.item.style.opacity = 0;
  layout();                                  // 先备好画布 / 粒子 / 首帧再显示视图，少一点进场卡顿
  bindSkip();
  if (l.done) { l.done.classList.remove('show'); l.done.style.transform = 'translateY(100%)'; l.done.style.display = 'none'; }
  render(0);
  showView('evoView');
  layout();                                  // 视图显示后再量一次，拿到自己那块屏的真实尺寸
  setPhase('evo');
  render(0);
  last = 0;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}
// 预加载失败时的兜底路径：按 编号-形态名 拼
function fallbackSrc(idx, suff) {
  const p = getPokemonByIndex(String(idx));
  return `./pokemon-data/images/${idx}-${(p && (p.form || p.name)) || idx}${suff}.gif`;
}
