import { EmeraldFx } from '../src/pe-battle/runtime.js';

const $ = (id) => document.getElementById(id);
// 舞台整体做了 scale(2)，把战斗内元素的 rect 还原成舞台内部坐标，
// 否则 lunge 位移和粒子落点会按放大后的屏幕坐标再乘一次缩放，直接飞出画面。
let _fxScale = 2;
const _nativeRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  const r = _nativeRect.call(this);
  const root = $('fxScreen');
  if (!root || this === root || !root.contains(this)) return r;
  const s = _fxScale || 1;
  return new DOMRect(r.x / s, r.y / s, r.width / s, r.height / s);
};
function updateFxScale() {
  const root = $('fxScreen');
  if (!root) return;
  _fxScale = root.getBoundingClientRect().width / root.offsetWidth || 1;
}
const stage = () => $('battleContent');
const P_NAME = '皮卡丘';
const E_NAME = '妙蛙种子';
const TYPE_COLORS = {
  '一般': '#9F9E9A', '格斗': '#A7443E', '飞行': '#72A3D2', '毒': '#793B9B',
  '地面': '#894F4E', '岩石': '#BA9459', '虫': '#89991A', '幽灵': '#633963',
  '钢': '#548EA2', '火': '#CB494D', '水': '#3786CE', '草': '#378E24',
  '电': '#DBB538', '超能': '#DA5A89', '冰': '#37BEE0', '龙': '#4654C6',
  '恶': '#553F42', '妖精': '#C74ECB',
};
const TYPE_FX = {
  火: 'flame', 水: 'drop', 草: 'leaf', 电: 'spark', 冰: 'ice', 毒: 'bubble',
  地面: 'clump', 岩石: 'rock', 飞行: 'streak', 虫: 'dot', 超能: 'swirl', 龙: 'dragon',
};
const IMPACT_TINT_TYPES = new Set(['火', '水', '草', '毒', '冰']);
const METEOR_MOVES = new Set(['流星群', '流星闪冲', '流星突击', '流星光束']);
const TYPE_FX_COUNT = { flame: 6, drop: 6, leaf: 6, spark: 7, ice: 5, bubble: 6, clump: 5, rock: 5, streak: 5, dot: 6, swirl: 5, dragon: 6 };
const DMG_KINDS = new Set(['damage', 'explode', 'multihit', 'fixed', 'drain', 'recoil', 'finalGambit', 'counter', 'mirrorCoat']);
const B_ANIM_CLS = ['lunge', 'lunge-attack', 'hit', 'faint', 'lunge-stay', 'b-strike', 'flinch', 'b-enter', 'cg-sink', 'cg-rise', 'cg-vanish', 'cg-glow', 'cg-out-sink', 'cg-out-rise', 'cg-out-vanish'];
const CHARGE_MOVES = new Set(['挖洞', '飞翔', '潜水', '弹跳', '神鸟猛击', '潜灵奇袭', '日光束', '日光刃']);
const CHARGE_HIDES = { 挖洞: true, 飞翔: true, 潜水: true, 弹跳: true, 潜灵奇袭: true, 神鸟猛击: false, 日光束: false, 日光刃: false };
const CHARGE_ENTER_TEXT = {
  挖洞: (n) => `${n} 挖洞钻入了地下！`, 飞翔: (n) => `${n} 飞向了高空！`,
  潜水: (n) => `${n} 潜入了水中！`, 弹跳: (n) => `${n} 高高跃起！`,
  神鸟猛击: (n) => `${n} 开始积蓄力量！`, 潜灵奇袭: (n) => `${n} 消失在了暗影中！`,
  日光束: (n) => `${n} 吸收了阳光！`, 日光刃: (n) => `${n} 吸收了阳光！`,
};
const CHARGE_ENTER_CLS = { 挖洞: 'cg-sink', 潜水: 'cg-sink', 飞翔: 'cg-rise', 弹跳: 'cg-rise', 神鸟猛击: 'cg-glow', 日光束: 'cg-glow', 日光刃: 'cg-glow', 潜灵奇袭: 'cg-vanish' };
const CHARGE_OUT_CLS = { 挖洞: 'cg-out-sink', 潜水: 'cg-out-sink', 飞翔: 'cg-out-rise', 弹跳: 'cg-out-rise', 神鸟猛击: 'cg-out-rise', 日光刃: 'cg-glow', 潜灵奇袭: 'cg-out-vanish' };
const SOUND_MOVES = new Set([
  '叫声', '吼叫', '唱歌', '超音波', '音爆', '刺耳声', '打鼾', '终焉之歌', '治愈铃声',
  '巨声', '金属音', '长嚎', '虫鸣', '轮唱', '回声', '大声咆哮', '打嗝', '战吼',
  '魅惑之声', '爆音波', '密语', '古老之歌', '破音', '精神噪音', '龙声鼓舞', '魅诱之声',
  '闪焰高歌', '鳞片噪音', '魂舞烈音爆', '怪异电波', '吵闹', '哈欠', '梦话',
]);
const BIND_MOVES = new Set(['缠绕', '紧束', '绑紧']);
const FIST_MOVES = new Set(['子弹拳', '增强拳', '等离子闪电拳', '钢拳双击', '极巨拳斗', '喷射拳', '愤怒之拳']);
const STONE_RANGED = new Set(['尖石攻击', '岩石炮', '钻石风暴', '岩斧', '冲岩']);
const RANGED_PHYS_MULTI = {
  '种子机关枪': { shape: 'pill', color: TYPE_COLORS['草'] }, '冰锥': { shape: 'crystal', color: TYPE_COLORS['冰'] },
  '岩石爆击': { shape: 'jag', color: TYPE_COLORS['岩石'] }, '飞弹针': { shape: 'needle', color: TYPE_COLORS['虫'] },
  '骨棒乱打': { shape: 'bone', color: TYPE_COLORS['地面'] },
  '骨头回力镖': { shape: 'bone', color: TYPE_COLORS['地面'] }, '投球': { shape: 'ball', color: '#d85b4b' }, '鳞射': { shape: 'scale', color: TYPE_COLORS['龙'] },
  '尖刺加农炮': { shape: 'pill', color: TYPE_COLORS['一般'] },
};
const RANGED_SINGLE = {
  '冰砾': { shape: 'sphere', color: TYPE_COLORS['冰'] }, '毒针': { shape: 'needle', color: TYPE_COLORS['毒'] },
  '毒千针': { shape: 'needle', color: TYPE_COLORS['毒'] }, '垃圾射击': { shape: 'blob', color: TYPE_COLORS['毒'] },
};
const GROUPS = {
  statusAnim: '状态动画',
  charge: '蓄力', sound: '声波', wind: '旋风', water: '水幕', dragon: '龙息', bubble: '气泡',
  star: '星星', pebble: '圆石', ring: '圆环', psychic: '念力', confuse: '幻光球', fire: '火焰弹', hotSand: '热沙', frostBreath: '冰息',
  acid: '酸液', hotWater: '热水', screen: '全屏闪光', leaf: '叶片', ball: '能量球', beam: '破坏光线', iceBeam: '冰光线',
  solar: '光柱', quake: '震地', rockSlide: '岩崩', rockThrow: '落石', snow: '雪球', electric: '闪电',
  drain: '吸血', rangedSingle: '远程单体', rangedMulti: '远程连击', multiPhys: '近战连击',
  phys: '近战', spec: '施法', status: '变化', heal: '回复', shield: '守住',
};

let data = null;
let moves = [];
let filtered = [];
let current = null;
let busy = false;
let speed = 1;
let emerald = null;
const TWO_TURN_MOVES = new Set([13, 19, 76, 91, 117, 130, 143, 291, 340]);
const STATUS_MOVES = [
  { id: -1, name: '混乱', type: '状态', statusKind: 'confusion', statusText: '混乱了' },
  { id: -2, name: '睡眠', type: '状态', statusKind: 'sleep', statusText: '睡着了' },
  { id: -3, name: '中毒', type: '状态', statusKind: 'poison', statusText: '中毒了' },
  { id: -4, name: '灼伤', type: '状态', statusKind: 'burn', statusText: '灼伤了' },
  { id: -5, name: '麻痹', type: '状态', statusKind: 'paralysis', statusText: '麻痹了' },
  { id: -6, name: '冰冻', type: '状态', statusKind: 'freeze', statusText: '冰冻了' },
  { id: -7, name: '着迷', type: '状态', statusKind: 'infatuation', statusText: '着迷了' },
  { id: -8, name: '诅咒', type: '状态', statusKind: 'curse', statusText: '被诅咒了' },
  { id: -9, name: '恶梦', type: '状态', statusKind: 'nightmare', statusText: '被恶梦缠身了' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const catOf = (mv) => mv?.statusKind ? '状态' : (mv?.category || (mv?.effect?.cat === 'spec' ? '特殊' : '物理'));

function moveCat(mv) {
  const ef = mv.effect || {};
  if (DMG_KINDS.has(ef.kind)) {
    if (ef.kind === 'mirrorCoat') return 'spec';
    return ef.cat === 'spec' ? 'spec' : 'phys';
  }
  return 'status';
}

function classify(mv) {
  if (mv.statusKind) return 'statusAnim';
  if (CHARGE_MOVES.has(mv.name)) return 'charge';
  if (SOUND_MOVES.has(mv.name)) return 'sound';
  if (['起风', '翅膀攻击', '暴风', '空气利刃', '热风', '妖精之风', '冰冻之风'].includes(mv.name)) return 'wind';
  if (['潮旋', '水之波动', '泼冷水', '冲浪'].includes(mv.name)) return 'water';
  if (mv.name === '热水') return 'hotWater';
  if (mv.type === '龙' && moveCat(mv) === 'spec' && mv.name !== '龙卷风') return 'dragon';
  if (['泡沫', '泡沫光线', '水枪', '喷水'].includes(mv.name)) return 'bubble';
  if (mv.name === '高速星星') return 'star';
  if (['原始之力', '掷泥'].includes(mv.name)) return 'pebble';
  if (mv.name === '冰息') return 'frostBreath';
  if (['热沙大地', '热沙风暴'].includes(mv.name)) return 'hotSand';
  if (['幻象光线', '精神波', '水炮'].includes(mv.name)) return 'ring';
  if (mv.name === '念力') return 'psychic';
  if (mv.name === '奇异之光') return 'confuse';
  if (mv.name === '喷射火焰' || mv.name === '喷火') return 'fire';
  if (mv.name === '溶解液') return 'acid';
  if (['魔法闪耀', '电光', '精神强念'].includes(mv.name)) return 'screen';
  if (['飞叶快刀', '花瓣舞', '飞叶风暴'].includes(mv.name)) return 'leaf';
  if (['能量球', '暗影球', '电球', '火焰球', '火花', '磷火', '大字爆炎', '意念头锤', '污泥炸弹', '击落', '加农光炮'].includes(mv.name)) return 'ball';
  if (mv.name === '破坏光线') return 'beam';
  if (['冰冻光束', '极光束', '铁蹄光线'].includes(mv.name)) return 'iceBeam';
  if (mv.name === '日光束') return 'solar';
  if (['重踏', '地震'].includes(mv.name)) return 'quake';
  if (mv.name === '岩崩') return 'rockSlide';
  if (mv.name === '落石') return 'rockThrow';
  if (mv.name === '雪崩') return 'snow';
  if (mv.type === '电' && moveCat(mv) === 'spec') return 'electric';
  if (mv.effect?.kind === 'drain') return 'drain';
  if (mv.effect?.kind === 'multihit' && moveCat(mv) === 'phys') return RANGED_PHYS_MULTI[mv.name] ? 'rangedMulti' : 'multiPhys';
  if (RANGED_SINGLE[mv.name]) return 'rangedSingle';
  if (['heal', 'sleepRest', 'healCure'].includes(mv.effect?.kind)) return 'heal';
  if (['protect', 'endure'].includes(mv.effect?.kind)) return 'shield';
  return moveCat(mv) === 'phys' ? 'phys' : moveCat(mv) === 'spec' ? 'spec' : 'status';
}

function setText(text) { $('fxText').textContent = text; }

function resetAnim(el) { if (el) el.classList.remove(...B_ANIM_CLS); }
function raiseAttacker(side) {
  if (side === 'bp') {
    const flip = $('bp-box')?.querySelector('.b-flip');
    if (flip) flip.style.zIndex = '6';
  } else {
    const img = $('be-img');
    if (img) img.style.zIndex = '6';
  }
}
function lowerAttacker(side) {
  if (side === 'bp') {
    const flip = $('bp-box')?.querySelector('.b-flip');
    if (flip) flip.style.zIndex = '';
  } else {
    const img = $('be-img');
    if (img) img.style.zIndex = '';
  }
}
function playAnim(side, cls) {
  const el = $(`${side}-img`);
  if (!el) return;
  resetAnim(el);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', function h(ev) {
    if (ev.target !== el) return;
    el.classList.remove(cls);
    el.removeEventListener('animationend', h);
  });
}
function lungeTargetRect(side) {
  const foe = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  if (foe && foe.dataset.charged === '1') {
    const base = $(`${side === 'bp' ? 'be' : 'bp'}-base`);
    if (base) return base.getBoundingClientRect();
  }
  return foe ? foe.getBoundingClientRect() : null;
}
function lunge(side) {
  const el = $(`${side}-img`);
  const f = lungeTargetRect(side);
  if (!el || !f) return;
  resetAnim(el);
  void el.offsetWidth;
  raiseAttacker(side);
  el.classList.add('lunge');
  const r = el.getBoundingClientRect();
  let vx = f.left + f.width / 2 - (r.left + r.width / 2);
  const vy = f.top + f.height / 2 - (r.top + r.height / 2);
  const len = Math.hypot(vx, vy) || 1;
  vx = (vx / len) * 42;
  const dy = (vy / len) * 42;
  if (side === 'bp') vx = -vx;
  el.style.setProperty('--lunge-dx', vx.toFixed(1) + 'px');
  el.style.setProperty('--lunge-dy', dy.toFixed(1) + 'px');
  el.addEventListener('animationend', function h(ev) {
    if (ev.target !== el) return;
    el.classList.remove('lunge');
    lowerAttacker(side);
    el.removeEventListener('animationend', h);
  });
}
function lungeAttack(side) {
  const el = $(`${side}-img`);
  const f = lungeTargetRect(side);
  if (!el || !f) return;
  resetAnim(el);
  void el.offsetWidth;
  raiseAttacker(side);
  el.classList.add('lunge-attack');
  const r = el.getBoundingClientRect();
  const dx = side === 'bp'
    ? -(Math.max(0, f.left - r.right))
    : Math.min(0, f.right - r.left);
  const dy = f.top + f.height / 2 - (r.top + r.height / 2);
  el.style.setProperty('--lunge-dx', dx.toFixed(1) + 'px');
  el.style.setProperty('--lunge-dy', dy.toFixed(1) + 'px');
  el.addEventListener('animationend', function h(ev) {
    if (ev.target !== el) return;
    el.classList.remove('lunge-attack');
    lowerAttacker(side);
    el.removeEventListener('animationend', h);
  });
}
function shake(side) { playAnim(side, 'hit'); }
function hitRecoil(side) {
  const el = $(`${side}-img`);
  if (!el) return;
  el.classList.remove('hit-recoil');
  void el.offsetWidth;
  el.classList.add('hit-recoil');
  el.addEventListener('animationend', function h(ev) {
    if (ev.target !== el) return;
    el.classList.remove('hit-recoil');
    el.removeEventListener('animationend', h);
  });
}
function popDmg(side, amount, maxHp = 100) {
  const s = document.createElement('span');
  s.className = 'b-dmg';
  if (amount / maxHp >= 0.25) s.classList.add('heavy');
  s.textContent = '-' + amount;
  $(`${side}-box`).appendChild(s);
  setTimeout(() => s.remove(), 900);
}
function popHeal(side, amount) {
  const s = document.createElement('span');
  s.className = 'b-dmg heal';
  s.textContent = '+' + amount;
  $(`${side}-box`).appendChild(s);
  setTimeout(() => s.remove(), 900);
}
function flashHitPanel(side) {
  const panel = $(`${side}-box`)?.querySelector('.b-panel');
  if (!panel) return;
  panel.classList.remove('b-hit-panel');
  void panel.offsetWidth;
  panel.classList.add('b-hit-panel');
  setTimeout(() => panel.classList.remove('b-hit-panel'), 340);
}
function spawnGroundBurst(side, color, count) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-ground-fx';
  fx.style.setProperty('--fc', color);
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height - 3) + 'px';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const dir = Math.random() < 0.5 ? -1 : 1;
    p.style.setProperty('--dx', (dir * (8 + Math.random() * 24)).toFixed(1) + 'px');
    p.style.setProperty('--dy', -(5 + Math.random() * 20).toFixed(1) + 'px');
    p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
    p.style.animationDuration = (0.35 + Math.random() * 0.3).toFixed(2) + 's';
    fx.appendChild(p);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 800);
}
function spawnHitSpark(side) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const spark = document.createElement('span');
  spark.className = 'b-spark';
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  spark.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  spark.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('i');
    const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.7;
    const dist = 13 + Math.random() * 9;
    p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    spark.appendChild(p);
  }
  box.appendChild(spark);
  setTimeout(() => spark.remove(), 480);
}
function spawnTypeFx(side, type) {
  const shape = TYPE_FX[type];
  if (!shape) return;
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const fx = document.createElement('span');
  fx.className = 'b-type-fx tf-' + shape;
  fx.style.setProperty('--fc', TYPE_COLORS[type] || '#fff');
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  const n = TYPE_FX_COUNT[shape] || 5;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.8;
    const dist = 12 + Math.random() * 12;
    p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
    p.style.animationDuration = (0.5 + Math.random() * 0.3).toFixed(2) + 's';
    fx.appendChild(p);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 900);
}
// 回复：统一使用原作 Gfx_BlueStar 星星粒子
function spawnHealFx(side) {
  spawnBlueStarBurst(side, 10);
}
function spawnProjStream(side, shape, color, solid) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-proj-fx proj-' + shape;
  if (color) fx.style.setProperty('--fc', color);
  const sx = fr.left - br.left + fr.width / 2;
  const yk = shape === 'ball' ? 0.5 : 0.38;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  if (shape === 'ball' || shape === 'confuse') {
    const b = document.createElement('i');
    b.style.setProperty('--bx', (ex - sx).toFixed(1) + 'px');
    b.style.setProperty('--by', (ey - sy).toFixed(1) + 'px');
    b.style.setProperty('--bs', (16 + Math.random() * 4).toFixed(1) + 'px');
    if (solid) b.style.boxShadow = 'none';
    fx.appendChild(b);
    box.appendChild(fx);
    return new Promise((resolve) => setTimeout(() => { fx.remove(); resolve(); }, 740));
  }
  const shrink = side === 'bp';
  const n = 6;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i');
    b.style.setProperty('--bx', (ex - sx + (Math.random() * 12 - 6)).toFixed(1) + 'px');
    b.style.setProperty('--by', (ey - sy + (Math.random() * 10 - 5)).toFixed(1) + 'px');
    b.style.setProperty('--sf', shrink ? 1.5 : 0.45);
    b.style.setProperty('--se', shrink ? 0.45 : 1.5);
    b.style.setProperty('--bs', (10 + Math.random() * 7).toFixed(1) + 'px');
    b.style.setProperty('--bd', (i * 0.06).toFixed(2) + 's');
    fx.appendChild(b);
  }
  box.appendChild(fx);
  return new Promise((resolve) => setTimeout(() => { fx.remove(); resolve(); }, 700));
}
function spawnProjOne(side, shape, color) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-proj-fx proj-' + shape;
  if (color) fx.style.setProperty('--fc', color);
  const sx = fr.left - br.left + fr.width / 2;
  const yk = shape === 'ball' ? 0.5 : 0.38;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  const b = document.createElement('i');
  const shrink = side === 'bp';
  b.style.setProperty('--bx', (ex - sx + (Math.random() * 14 - 7)).toFixed(1) + 'px');
  b.style.setProperty('--by', (ey - sy + (Math.random() * 12 - 6)).toFixed(1) + 'px');
  b.style.setProperty('--sf', shrink ? 1.5 : 0.45);
  b.style.setProperty('--se', shrink ? 0.45 : 1.5);
  b.style.setProperty('--bs', (9 + Math.random() * 5).toFixed(1) + 'px');
  fx.appendChild(b);
  box.appendChild(fx);
  return new Promise((resolve) => {
    setTimeout(() => { fx.remove(); resolve(); }, 380 / speed);
  });
}
// 空气之刃/空气利刃：复用气旋攻击的 Gfx_AirWave2 风刃，少量发射
function spawnAirBladeStream(side, count = 2) {
  const tSide = side === 'bp' ? 'be' : 'bp';
  const from = $(`${side}-img`);
  const to = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!from || !to || !box) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.42;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.42;
  const ang = (Math.atan2(ey - sy, ex - sx) * 180) / Math.PI;
  const url = new URL('./move-fx-assets/pe/Gfx_AirWave2__32x16.png', import.meta.url).href;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = sx + 'px';
    el.style.top = (sy + (i - (count - 1) / 2) * 12) + 'px';
    el.style.width = '32px';
    el.style.height = '16px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = '32px 16px';
    el.style.filter = 'drop-shadow(0 0 5px #dff6ff)';
    el.style.zIndex = '9';
    el.style.transform = `translate(-50%,-50%) rotate(${ang.toFixed(1)}deg)`;
    box.appendChild(el);
    const dy = ey - (sy + (i - (count - 1) / 2) * 12);
    el.animate([
      { transform: `translate(-50%,-50%) rotate(${ang.toFixed(1)}deg) scale(.7)`, opacity: 0 },
      { transform: `translate(-50%,-50%) rotate(${ang.toFixed(1)}deg) scale(1)`, opacity: 1, offset: .12 },
      { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${ang.toFixed(1)}deg) scale(1.15)`, opacity: 1, offset: .9 },
      { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${ang.toFixed(1)}deg) scale(1.2)`, opacity: 0 },
    ], { duration: 320 / speed, delay: (i * 55) / speed, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), (360 + i * 55) / speed);
  }
  return new Promise((resolve) => setTimeout(resolve, (320 + (count - 1) * 55 + 50) / speed));
}
// 原作针形弹道：用 Gfx_Needle 贴图沿飞行方向旋转射出（双针/毒针同素材）
function spawnNeedleAsset(side, tSide) {
  const from = $(`${side}-img`);
  const to = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = 0.4;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  const ang = (Math.atan2(ey - sy, ex - sx) * 180) / Math.PI + 90;
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = sx + 'px';
  el.style.top = sy + 'px';
  el.style.width = '20px';
  el.style.height = '20px';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_Needle__16x16.png', import.meta.url).href})`;
  el.style.backgroundSize = '20px 20px';
  el.style.zIndex = '9';
  box.appendChild(el);
  const trs = `translate(-50%,-50%) rotate(${ang.toFixed(1)}deg)`;
  el.animate([
    { transform: trs, opacity: 0 },
    { opacity: 1, offset: .1 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) rotate(${ang.toFixed(1)}deg)`, opacity: 1, offset: .86 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) rotate(${ang.toFixed(1)}deg)`, opacity: 0 },
  ], { duration: 330 / speed, easing: 'linear', fill: 'both' });
  setTimeout(() => el.remove(), 370 / speed);
}
function spawnLightSweep(side) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.42;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.42;
  const fx = document.createElement('span');
  fx.className = 'b-light-fx';
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  fx.style.transform = `rotate(${Math.atan2(ey - sy, ex - sx)}rad)`;
  const seg = document.createElement('i');
  seg.className = 'seg';
  seg.style.setProperty('--td', (Math.hypot(ex - sx, ey - sy) * 1.9).toFixed(0) + 'px');
  fx.appendChild(seg);
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 1000);
}
function spawnSolarBeam(tSide) {
  const box = $(`${tSide}-box`);
  const base = $(`${tSide}-base`);
  if (!box || !base) return;
  const br = box.getBoundingClientRect();
  const bsr = base.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-solar-fx';
  fx.style.left = (bsr.left - br.left + bsr.width / 2) + 'px';
  fx.style.top = (bsr.top - br.top + bsr.height / 2) + 'px';
  const b = document.createElement('i');
  b.className = 'beam';
  fx.appendChild(b);
  const g = document.createElement('i');
  g.className = 'glow';
  fx.appendChild(g);
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 650);
}
// 电系命中：Gfx_Lightning 分片纵向拼接成从屏幕顶劈到目标头顶
// 电系强度对应的分片：3=细弱电（电击），0=常规，2=粗壮分叉
function lightningVariant(mv) {
  const p = Number(mv.power) || 0;
  if (p >= 100) return 1;
  if (p >= 85) return 2;
  if (p >= 55) return 0;
  return 3;
}
function spawnLightningStrike(tSide, variant = 3) {
  spawnVoltFlash();
  spawnLightningAsset(tSide, variant);
}
function spawnParalysisBurst(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const k = Math.max(0.7, Math.min(1.6, ir.width / 80));
  const offs = [[5, 0], [-5, 10], [15, 20], [-15, -10], [25, 0], [-8, 8], [2, -8], [-20, 15]];
  offs.forEach(([ox, oy], i) => {
    const el = document.createElement('span');
    el.className = 'fx-spark-asset';
    el.style.left = (cx + ox * k) + 'px';
    el.style.top = (cy + oy * k) + 'px';
    el.style.animationDelay = (i * 0.03).toFixed(2) + 's';
    box.appendChild(el);
    setTimeout(() => el.remove(), 760 / speed);
  });
  const orbUrl = new URL('./move-fx-assets/pe/Gfx_ElectricOrbs__8x8.png', import.meta.url).href;
  for (let i = 0; i < 5; i++) {
    const size = 14 + rnd(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + rnd(-24, 24)) + 'px';
    el.style.top = (cy + rnd(-20, 20)) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${orbUrl})`;
    el.style.backgroundSize = `${size}px ${size * 4}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    let f = rnd(0, 3);
    const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * size}px`; }, 60 / speed);
    const dx = rnd(-30, 30), dy = rnd(-36, 16);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`, opacity: 0 },
    ], { duration: 420 / speed, delay: (i * 30) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, (480 + i * 30) / speed);
  }
}
function spawnLightningAsset(tSide, variant = 3) {
  const field = stage();
  const img = $(`${tSide}-img`);
  if (!field || !img) return;
  const fr = field.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - fr.left + ir.width / 2;
  const headY = ir.top - fr.top + ir.height * 0.12;
  const url = new URL('./move-fx-assets/pe/Gfx_Lightning__32x32.png', import.meta.url).href;
  const step = 24;
  const count = Math.max(1, Math.ceil(headY / step));
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.zIndex = '8';
    el.style.width = '32px';
    el.style.height = '32px';
    el.style.left = (cx + rnd(-3, 3)) + 'px';
    el.style.top = (headY - i * step) + 'px';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = '32px 160px';
    el.style.backgroundPosition = `0 -${variant * 32}px`;
    el.style.transform = 'translate(-50%,-50%) scale(1.05)';
    field.appendChild(el);
    el.animate([
      { opacity: 0 },
      { opacity: 1, offset: .15 },
      { opacity: .35, offset: .4 },
      { opacity: 1, offset: .55 },
      { opacity: 0 },
    ], { duration: 340 / speed, fill: 'both' });
    setTimeout(() => el.remove(), 380 / speed);
  }
  setTimeout(() => spawnParalysisBurst(tSide), 220 / speed);
}
function spawnVoltFlash() {
  const st = stage();
  if (!st) return;
  const el = document.createElement('span');
  el.className = 'b-volt-flash';
  st.appendChild(el);
  setTimeout(() => el.remove(), 320 / speed);
}
function spawnElectricBall(fromSide, toSide, variant = 2) {
  const from = $(`${fromSide}-img`);
  const to = $(`${toSide}-img`);
  const box = $(`${fromSide}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.42;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.42;
  const ball = document.createElement('span');
  ball.className = 'fx-orig';
  ball.style.left = sx + 'px';
  ball.style.top = sy + 'px';
  ball.style.width = '58px';
  ball.style.height = '58px';
  ball.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_CircleOfLight__64x64.png', import.meta.url).href})`;
  ball.style.backgroundSize = '58px 58px';
  ball.style.filter = 'drop-shadow(0 0 12px #ffe45c)';
  ball.style.zIndex = '9';
  box.appendChild(ball);
  ball.animate([
    { transform: 'translate(-50%,-50%) scale(.35)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .2 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) scale(1.15)`, opacity: 1 },
  ], { duration: 420 / speed, easing: 'cubic-bezier(.3,.1,.8,1)', fill: 'both' });
  setTimeout(() => {
    ball.remove();
    spawnLightningStrike(toSide, variant);
  }, 420 / speed);
}
function spawnRockSlide(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const url = new URL('./move-fx-assets/pe/Gfx_Rocks__32x32.png', import.meta.url).href;
  for (let i = 0; i < 9; i++) {
    const size = 22 + rnd(0, 16);
    const endX = cx + rnd(-Math.round(ir.width * 0.45), Math.round(ir.width * 0.45));
    const endY = ir.top - br.top + ir.height * (0.06 + Math.random() * 0.28);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = endX + 'px';
    el.style.top = endY + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${rnd(0, 5) * size}px`;
    el.style.zIndex = '8';
    box.appendChild(el);
    el.animate([
      { transform: `translate(-50%,-50%) translateY(-${(ir.height + rnd(90, 190)).toFixed(0)}px) rotate(0deg)`, opacity: 0 },
      { opacity: 1, offset: .1 },
      { transform: 'translate(-50%,-50%) translateY(0) rotate(240deg)', opacity: 1, offset: .88 },
      { transform: 'translate(-50%,-50%) translateY(0) rotate(240deg)', opacity: 0 },
    ], { duration: (500 + rnd(0, 120)) / speed, delay: rnd(0, 220) / speed, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), (720 + i * 25) / speed);
  }
}
function spawnRockDrop(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const url = './pe-battle/move-fx-assets/pe/Gfx_Rocks__32x32.png';
  for (let i = 0; i < 5; i++) {
    const size = 30 + rnd(0, 16);
    const endX = cx + rnd(-Math.round(ir.width * 0.28), Math.round(ir.width * 0.28));
    const endY = ir.top - br.top + ir.height * (0.08 + Math.random() * 0.24);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = endX + 'px';
    el.style.top = endY + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${rnd(0, 5) * size}px`;
    el.style.zIndex = '8';
    box.appendChild(el);
    el.animate([
      { transform: `translate(-50%,-50%) translateY(-${(ir.height + rnd(100, 180)).toFixed(0)}px) rotate(0deg)`, opacity: 0 },
      { opacity: 1, offset: .1 },
      { transform: 'translate(-50%,-50%) translateY(0) rotate(200deg)', opacity: 1, offset: .9 },
      { transform: 'translate(-50%,-50%) translateY(0) rotate(200deg)', opacity: 0 },
    ], { duration: (560 + rnd(0, 100)) / speed, delay: (i * 35) / speed, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), (700 + i * 35) / speed);
  }
}
function spawnSnowSlide(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-snow-fx';
  const cx = ir.left - br.left + ir.width / 2;
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('i');
    const size = 7 + Math.random() * 12;
    const dropY = 130 + Math.random() * 70;
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = (cx + (Math.random() * 100 - 50)) + 'px';
    s.style.top = (ir.top - br.top - dropY) + 'px';
    s.style.setProperty('--by', (dropY + ir.height * 0.35).toFixed(0) + 'px');
    s.style.setProperty('--bd', (Math.random() * 0.3).toFixed(2) + 's');
    fx.appendChild(s);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 950);
}
// 声音招式：攻击方身边弹出原作 NoiseLine 声纹，再配合扩散声波圈
function spawnNoiseLines(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const dir = side === 'bp' ? 1 : -1;
  const url = new URL('./move-fx-assets/pe/Gfx_NoiseLine__32x32.png', import.meta.url).href;
  const rows = [-10, 0, 10];
  rows.forEach((dy, i) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = cx + 'px';
    el.style.top = (cy + dy) + 'px';
    el.style.width = '28px';
    el.style.height = '28px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = '28px 112px';
    el.style.zIndex = '8';
    box.appendChild(el);
    let f = i === 2 ? 2 : 0;
    const timer = setInterval(() => { f = f === 0 ? 1 : f === 1 ? 0 : f === 2 ? 3 : 2; el.style.backgroundPosition = `0 -${f * 28}px`; }, 90 / speed);
    const dur = 480 / speed;
    el.animate([
      { transform: `translate(-50%,-50%) scaleX(${dir}) scale(.7)`, opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: `translate(calc(-50% + ${dir * 64}px), calc(-50% + ${dy * 0.4}px)) scaleX(${dir}) scale(1.05)`, opacity: 0 },
    ], { duration: dur, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, dur + 40);
  });
}
function spawnSoundWave(side, tSide = side === 'bp' ? 'be' : 'bp') {
  spawnNoiseLines(side);
  const from = $(`${side}-img`);
  const to = $(`${tSide}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-sonic-fx';
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.35;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.35;
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  for (let i = 0; i < 3; i++) {
    const w = document.createElement('i');
    w.style.setProperty('--bx', ((ex - sx) * 0.72).toFixed(1) + 'px');
    w.style.setProperty('--by', ((ey - sy) * 0.72).toFixed(1) + 'px');
    w.style.setProperty('--bd', (i * 0.16).toFixed(2) + 's');
    fx.appendChild(w);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 850);
}
function spawnIceBeam(side) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.35;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.35;
  const dx = ex - sx, dy = ey - sy;
  const fx = document.createElement('span');
  fx.className = 'b-beam-fx';
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  fx.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
  const b = document.createElement('i');
  b.style.width = Math.hypot(dx, dy) + 'px';
  fx.appendChild(b);
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 450);
}
function spawnScreenFlash() {
  const st = stage();
  if (!st) return;
  const fx = document.createElement('span');
  fx.className = 'b-fairy-fx';
  st.appendChild(fx);
  setTimeout(() => fx.remove(), 420);
}
function spawnWaterSweep(side) {
  const st = stage();
  if (!st) return;
  const fx = document.createElement('span');
  fx.className = 'b-water-fx';
  const wave = document.createElement('i');
  if (side === 'bp') {
    wave.style.setProperty('--dx', '30%');
    wave.style.setProperty('--dy', '-30%');
  } else {
    wave.classList.add('be');
    wave.style.setProperty('--dx', '-30%');
    wave.style.setProperty('--dy', '30%');
  }
  fx.appendChild(wave);
  st.appendChild(fx);
  setTimeout(() => fx.remove(), 700);
}
function spawnWindTornado(side, color) {
  // 用原版 gust 贴图，不再走旧 CSS 旋风
  return spawnOrigStream('gust', { count: 3, duration: 500, delay: 100, spread: 14, wave: 10, startScale: .8, endScale: 1.2, opacityStart: .75, opacityEnd: .45 });
}
function spawnDragonWave(side) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = shape === 'ball' ? 0.5 : 0.38;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  const fx = document.createElement('span');
  fx.className = 'b-dragon-fx';
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('i');
    const spread = Math.random() * 26;
    const ang = Math.random() * Math.PI * 2;
    p.style.setProperty('--bx', (ex - sx + Math.cos(ang) * spread).toFixed(1) + 'px');
    p.style.setProperty('--by', (ey - sy + Math.sin(ang) * spread).toFixed(1) + 'px');
    p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
    p.style.animationDuration = (0.5 + Math.random() * 0.15).toFixed(2) + 's';
    fx.appendChild(p);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 750);
}
function spawnDrainParticles(fromSide, toSide, color, count = 10) {
  const from = $(`${fromSide}-img`);
  const to = $(`${toSide}-img`);
  const box = $(`${toSide}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = 0.4;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  const url = new URL('./move-fx-assets/pe/Gfx_Orbs__16x16.png', import.meta.url).href;
  for (let i = 0; i < count; i++) {
    const size = 14 + rnd(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = sx + 'px';
    el.style.top = (sy + rnd(-5, 5)) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 3}px`;
    el.style.backgroundPosition = `0 -${2 * size}px`;
    el.style.filter = 'drop-shadow(0 0 5px rgba(150, 225, 255, .8))';
    el.style.zIndex = '9';
    el.style.pointerEvents = 'none';
    box.appendChild(el);
    const spread = rnd(0, 20);
    const ang = Math.random() * Math.PI * 2;
    const dx = ex - sx + Math.cos(ang) * spread;
    const dy = ey - sy + Math.sin(ang) * spread;
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.45)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .16 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(.55)`, opacity: 0 },
    ], { duration: 480 / speed, delay: (i * 22) / speed, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), (540 + i * 22) / speed);
  }
}
function spawnDrainingKissFx(atkSide, tSide) {
  const tBox = $(`${tSide}-box`);
  const tImg = $(`${tSide}-img`);
  const aImg = $(`${atkSide}-img`);
  if (!tBox || !tImg || !aImg) return;
  const br = tBox.getBoundingClientRect();
  const tr = tImg.getBoundingClientRect();
  const ar = aImg.getBoundingClientRect();
  const cx = tr.left - br.left + tr.width / 2;
  const cy = tr.top - br.top + tr.height / 2;
  const ax = ar.left - br.left + ar.width / 2;
  const ay = ar.top - br.top + ar.height / 2;
  for (let i = 0; i < 8; i++) {
    const h = document.createElement('span');
    h.style.position = 'absolute';
    h.style.zIndex = '9';
    h.style.left = cx + 'px';
    h.style.top = cy + 'px';
    h.style.width = '14px';
    h.style.height = '14px';
    h.style.pointerEvents = 'none';
    h.style.color = '#ff78b8';
    h.style.filter = 'drop-shadow(0 0 3px #ff78b8)';
    h.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><use xlink:href="#icon-liked"/></svg>';
    tBox.appendChild(h);
    const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
    const burst = 12 + Math.random() * 12;
    const dx = Math.cos(ang) * burst;
    const dy = Math.sin(ang) * burst;
    h.animate([
      { transform: 'translate(-50%, -50%) scale(.25)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1)`, opacity: 1, offset: .3 },
      { transform: `translate(calc(-50% + ${(ax - cx).toFixed(1)}px), calc(-50% + ${(ay - cy).toFixed(1)}px)) scale(.65)`, opacity: 0 },
    ], { duration: 420 / speed, delay: (i * 22) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => h.remove(), (520 + i * 22) / speed);
  }
}
function spawnPsychicWrap(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-psy-fx';
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height * 0.35) + 'px';
  fx.appendChild(document.createElement('i'));
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 950);
}
function spawnPsyCharge(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-psy-charge';
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 650);
}
let _cosmicFx = null;
function hideCosmicBg() {
  if (_cosmicFx) {
    _cosmicFx.remove();
    _cosmicFx = null;
  }
}
function spawnCosmicBg() {
  const st = stage();
  if (!st) return;
  hideCosmicBg();
  const fx = document.createElement('span');
  fx.className = 'b-cosmic-fx';
  fx.style.backgroundImage = `url(${new URL('./move-fx-assets/bg/bg_cosmic.png', import.meta.url).href})`;
  st.appendChild(fx);
  _cosmicFx = fx;
  setTimeout(() => { if (_cosmicFx === fx) hideCosmicBg(); }, 3000);
}
function spawnMeteorRain(tSide, count = 6) {
  const st = stage();
  const img = $(`${tSide}-img`);
  if (!st || !img) return 0;
  const fr = st.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - fr.left + ir.width / 2;
  const cy = ir.top - fr.top + ir.height / 2;
  const colors = ['#ff6ec7', '#69e7ff', '#ffe36a', '#b98cff', '#80ffb0', '#ff9d6b'];
  const fx = document.createElement('span');
  fx.className = 'b-meteor-fx';
  let end = 0;
  for (let i = 0; i < count; i++) {
    const rock = document.createElement('i');
    rock.className = 'meteor';
    rock.style.left = cx + 'px';
    rock.style.top = cy + 'px';
    rock.style.setProperty('--sx', `${-150 - (i % 3) * 34}px`);
    rock.style.setProperty('--sy', `${-150 - (i % 2) * 26}px`);
    rock.style.setProperty('--mc', colors[i % colors.length]);
    rock.style.setProperty('--ms', `${18 + (i % 4) * 4}px`);
    const delay = i * 95;
    const dur = 480 + (i % 3) * 45;
    rock.style.setProperty('--delay', `${delay}ms`);
    rock.style.setProperty('--md', `${dur}ms`);
    fx.appendChild(rock);
    const land = delay + dur;
    end = Math.max(end, land);
    setTimeout(() => {
      if (!st.isConnected) return;
      spawnOrigImpact(tSide);
      shake(tSide);
    }, land);
  }
  st.appendChild(fx);
  setTimeout(() => fx.remove(), end + 260);
  return end;
}

// 灼伤闪烁：直接让精灵本体红光脉冲两下（不再叠白色圆片）
function spawnStatusFlash(side) {
  const img = $(`${side}-img`);
  if (!img) return;
  img.classList.remove('b-burn-flash');
  void img.offsetWidth;
  img.classList.add('b-burn-flash');
  clearTimeout(img._burnFlashT);
  img._burnFlashT = setTimeout(() => img.classList.remove('b-burn-flash'), 620 / speed);
}

const HEART_SVG = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="m20.17 13.537-7.122 7.034a1.494 1.494 0 0 1-2.096 0l-7.128-7.04a6.125 6.125 0 0 1 .006-8.728A6.25 6.25 0 0 1 8.233 3c1.36 0 2.68.436 3.767 1.253A6.26 6.26 0 0 1 15.767 3a6.25 6.25 0 0 1 4.404 1.803 6.127 6.127 0 0 1 0 8.734"/></svg>';

function showStatusFx(side, status) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box || !status) return;
  box.querySelector('.b-status-fx')?.remove();
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const fx = document.createElement('div');
  fx.className = 'b-status-fx fx-' + status;
  fx.dataset.status = status;
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  if (status === 'sleep') {
    fx.style.top = (ir.top - br.top - 2) + 'px';
    for (let i = 0; i < 2; i++) {
      const z = document.createElement('i');
      z.textContent = 'Z';
      z.style.animationDelay = (i * 1.2) + 's';
      fx.appendChild(z);
    }
  } else if (status === 'infatuation') {
    for (let i = 0; i < 4; i++) {
      const p = document.createElement('i');
      p.innerHTML = '<svg viewBox="0 0 24 24"><use xlink:href="#icon-liked"/></svg>';
      p.style.left = (rnd(0, Math.round(ir.width)) - ir.width / 2) + 'px';
      p.style.top = (-ir.height / 2 - 2) + 'px';
      p.style.animationDelay = (i * 0.4).toFixed(2) + 's';
      fx.appendChild(p);
    }
  } else if (status === 'curse') {
    for (let i = 0; i < 4; i++) {
      const p = document.createElement('i');
      p.textContent = '呪';
      p.style.left = (rnd(0, Math.round(ir.width)) - ir.width / 2) + 'px';
      p.style.top = (-ir.height / 2 - 2) + 'px';
      p.style.animationDelay = (i * 0.5).toFixed(2) + 's';
      fx.appendChild(p);
    }
  } else if (status === 'poison') {
    // 中毒：原作 Gfx_PoisonBubble 第一帧毒泡，大大小小从身上冒出
    for (let i = 0; i < 7; i++) {
      const p = document.createElement('i');
      p.className = 'fx-poison-bubble';
      p.style.setProperty('--s', rnd(10, 22) + 'px');
      p.style.left = rnd(-ir.width / 2 + 6, ir.width / 2 - 6) + 'px';
      p.style.top = rnd(-ir.height * 0.25, ir.height * 0.3) + 'px';
      p.style.animationDelay = (Math.random() * 2.4).toFixed(2) + 's';
      p.style.animationDuration = (2.2 + Math.random() * 1.2).toFixed(2) + 's';
      fx.appendChild(p);
    }
  } else if (status === 'paralysis') {
    const offs = [[-12, -10], [10, -6], [-6, 10], [12, 12], [0, -2]];
    offs.forEach(([ox, oy], i) => {
      const p = document.createElement('i');
      p.className = 'fx-spark-asset';
      p.style.left = ox + 'px';
      p.style.top = oy + 'px';
      p.style.animationDelay = (i * 0.11).toFixed(2) + 's';
      fx.appendChild(p);
    });
  } else {
    const counts = { burn: 5, freeze: 5, confusion: 4 };
    const n = counts[status] || 5;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      if (status === 'burn') {
        p.className = 'fx-burn-spr';
        p.style.left = (rnd(0, Math.round(ir.width)) - ir.width / 2) + 'px';
        p.style.top = (Math.random() * ir.height * 0.8 - ir.height * 0.4) + 'px';
        p.style.animationDelay = (i * 0.12).toFixed(2) + 's';
      } else if (status === 'confusion') {
        p.textContent = '✧';
        p.style.left = (rnd(0, 28) - 14) + 'px';
        p.style.top = (-ir.height / 2 - 4) + 'px';
        p.style.animationDelay = (i * 0.3).toFixed(2) + 's';
      } else {
        p.style.left = (rnd(0, Math.round(ir.width)) - ir.width / 2) + 'px';
        p.style.top = (Math.random() * ir.height * 0.8 - ir.height * 0.4) + 'px';
        p.style.animationDelay = (Math.random() * 1.2).toFixed(2) + 's';
        p.style.animationDuration = (0.8 + Math.random() * 0.5).toFixed(2) + 's';
      }
      fx.appendChild(p);
    }
  }
  box.appendChild(fx);
}

// 绿宝石原版战斗动画贴图（从 pokeemerald 素材转成透明 PNG）
const ORIG = {
  fire:    { file: 'fire.png',          fw: 32, fh: 32, frames: 8, ms: 65 },
  firePlume:{ file: 'fire_plume.png',   fw: 32, fh: 32, frames: 5, ms: 90 },
  leaf:    { file: 'razor_leaf.png',    fw: 32, fh: 16, frames: 1, ms: 100 },
  star:    { file: 'gold_stars.png',    fw: 16, fh: 24, frames: 1, ms: 100 },
  bubble:  { file: 'bubble.png',        fw: 16, fh: 16, frames: 3, ms: 90 },
  hydro:   { file: 'pe/Gfx_WaterOrb__16x16.png', fw: 16, fh: 16, frames: 4, ms: 70 },
  gust:    { file: 'gust.png',          fw: 32, fh: 32, frames: 2, ms: 90 },
  electric:{ file: 'electricity.png',   fw: 32, fh: 32, frames: 4, ms: 60 },
  rocks:   { file: 'rocks.png',         fw: 32, fh: 32, frames: 6, ms: 100 },
  water:   { file: 'water_droplet.png', fw: 32, fh: 32, frames: 8, ms: 70 },
  impact:  { file: 'impact.png',        fw: 32, fh: 32, frames: 1, ms: 100 },
  blackBall:{ file: 'black_ball.png',   fw: 8,  fh: 8,  frames: 1, ms: 100 },
  slash:   { file: 'pe/Gfx_Cut__32x32.png', fw: 32, fh: 32, frames: 4, ms: 45 },
  mist:    { file: 'pe/Gfx_MistCloud__32x16.png', fw: 32, fh: 16, frames: 2, ms: 140 },
};
const origOn = () => $('fxOrig')?.checked !== false;
const origUrl = (file) => new URL(`./move-fx-assets/${file}`, import.meta.url).href;

function origEl(key, frame = 0) {
  const spec = ORIG[key];
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.width = spec.fw + 'px';
  el.style.height = spec.fh + 'px';
  el.style.backgroundImage = `url(${origUrl(spec.file)})`;
  el.style.backgroundPosition = `0 -${frame * spec.fh}px`;
  if (key === 'mist') el.style.filter = 'brightness(1.55) saturate(.35)';
  return el;
}
function startOrigSheet(el, spec, startFrame = 0) {
  if (spec.frames <= 1) return;
  let frame = startFrame;
  el._origTimer = setInterval(() => {
    frame = (frame + 1) % spec.frames;
    el.style.backgroundPosition = `0 -${frame * spec.fh}px`;
  }, spec.ms / speed);
}
function removeOrig(el) {
  clearInterval(el._origTimer);
  el.remove();
}
function spawnOrigStream(key, opts = {}, fromSide = 'bp', toSide = 'be') {
  const spec = ORIG[key];
  const from = $(`${fromSide}-img`);
  const to = $(`${toSide}-img`);
  const box = $(`${fromSide}-box`);
  if (!spec || !from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = key === 'blackBall' ? 0.5 : 0.4;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  const count = opts.count || 7;
  const duration = (opts.duration || 420) / speed;
  const delayStep = (opts.delay || 65) / speed;
  const spread = opts.spread ?? 8;
  const wave = opts.wave || 0;
  const o0 = opts.opacityStart ?? 1;
  const o1 = opts.opacityEnd ?? 0;
  for (let i = 0; i < count; i++) {
    const el = origEl(key);
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    box.appendChild(el);
    startOrigSheet(el, spec);
    const tx = ex - sx + (Math.random() * spread * 2 - spread);
    const ty = ey - sy + (Math.random() * spread - spread / 2);
    const beginScale = (opts.startScale ?? 0.9) * (0.92 + Math.random() * 0.16);
    const finishScale = (opts.endScale ?? 0.55) * (0.92 + Math.random() * 0.16);
    const spin = opts.spin ? rnd(-180, 180) : 0;
    const phase = Math.random() * Math.PI * 2;
    const steps = wave ? 8 : 2;
    const frames = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = tx * t + (wave ? Math.sin(t * Math.PI * 2 + phase) * wave : 0);
      const y = ty * t + (wave ? Math.cos(t * Math.PI * 2 + phase) * wave * 0.45 : 0);
      const scale = beginScale + (finishScale - beginScale) * t;
      const opacity = k === steps ? 0 : o0 + (o1 - o0) * t;
      frames.push({
        offset: t,
        transform: `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px)) scale(${scale.toFixed(2)}) rotate(${(spin * t).toFixed(0)}deg)`,
        opacity,
      });
    }
    el.animate(frames, { duration, delay: i * delayStep, easing: 'linear', fill: 'both' });
    if (opts.onHit) setTimeout(() => opts.onHit(i), duration + i * delayStep);
    setTimeout(() => removeOrig(el), duration + i * delayStep + 120);
  }
  return duration + count * delayStep;
}
// 热沙大地 / 热沙风暴：原作没有对应脚本，用绿宝石的沙粒与飞沙贴图做贴身的暖色沙旋
const HOT_SAND = {
  grain: { file: 'pe/Gfx_MudSand__8x8.png', fw: 8, fh: 8, filter: 'sepia(1) saturate(3) hue-rotate(-18deg) brightness(1.12)' },
  streak: { file: 'pe/Gfx_FlyingDirt__32x16.png', fw: 32, fh: 16, filter: 'sepia(.75) saturate(2) hue-rotate(-12deg) brightness(1.12)' },
};

function hotSandEl(spec) {
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.width = spec.fw + 'px';
  el.style.height = spec.fh + 'px';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/' + spec.file, import.meta.url).href})`;
  el.style.filter = spec.filter;
  return el;
}

function spawnHotSand(name, tSide = 'be') {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return 0;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const storm = name === '热沙风暴';
  const duration = storm ? 780 : 720;
  const nodes = [];
  const add = (spec, left, top, frames, delay) => {
    const el = hotSandEl(spec);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    box.appendChild(el);
    el.animate(frames, { duration: duration / speed, delay, easing: 'ease-in-out', fill: 'both' });
    nodes.push(el);
  };

  if (storm) {
    // 热沙风暴：几股暖色飞沙从左、右两侧扫过目标身体
    for (let i = 0; i < 7; i++) {
      const dir = i % 2 ? -1 : 1;
      const y = cy + (i - 3) * 4 + rnd(-3, 3);
      add(HOT_SAND.streak, cx, y, [
        { transform: `translate(calc(-50% + ${dir * 54}px), calc(-50% + ${rnd(-10, 10)}px)) rotate(${dir * -12}deg) scale(.75)`, opacity: 0 },
        { transform: `translate(-50%, -50%) rotate(${dir * 8}deg) scale(1.08)`, opacity: 1, offset: .42 },
        { transform: `translate(calc(-50% + ${dir * -48}px), calc(-50% + ${rnd(-8, 8)}px)) rotate(${dir * 18}deg) scale(.8)`, opacity: 0 },
      ], (i * 34) / speed);
    }
    for (let i = 0; i < 4; i++) {
      add(HOT_SAND.grain, cx, cy + 12, [
        { transform: `translate(calc(-50% + ${rnd(-12, 12)}px), 8px) scale(.8)`, opacity: 0 },
        { transform: `translate(calc(-50% + ${rnd(-22, 22)}px), ${-12 - rnd(0, 10)}px) scale(1.7)`, opacity: .95, offset: .45 },
        { transform: `translate(calc(-50% + ${rnd(-18, 18)}px), -38px) scale(1.2)`, opacity: 0 },
      ], (i * 70) / speed);
    }
  } else {
    // 热沙大地：从脚边向上收拢的暖色沙旋
    for (let i = 0; i < 10; i++) {
      const phase = Math.random() * Math.PI * 2;
      const dir = i % 2 ? -1 : 1;
      const frames = [];
      for (let k = 0; k <= 7; k++) {
        const t = k / 7;
        const ang = phase + t * Math.PI * (1.7 + (i % 3) * 0.25);
        const r = (20 + (i % 4) * 3) * (1 - t * 0.35);
        frames.push({
          transform: `translate(calc(-50% + ${(Math.cos(ang) * r * dir).toFixed(1)}px), calc(-50% + ${(-t * 42 + Math.sin(ang) * 4).toFixed(1)}px)) scale(${(1.4 + t * 0.35).toFixed(2)}) rotate(${(t * 80 * dir).toFixed(0)}deg)`,
          opacity: t === 0 ? 0 : Math.min(1, t * 2.4) * (t > .78 ? (1 - t) / .22 : 1),
        });
      }
      add(HOT_SAND.grain, cx, cy + 14, frames, (i * 32) / speed);
    }
  }
  setTimeout(() => { for (const el of nodes) el.remove(); }, duration / speed + 180);
  return duration;
}

// 围绕目标做螺旋环绕；back 层在精灵前、front 层在精灵后，按轨道深度切换
function spawnOrbitFx(targetSide, { count, duration, radius, yRadius, rise, duck = false }) {
  const box = $(`${targetSide}-box`);
  const img = $(`${targetSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + (duck ? ir.height * 0.18 : ir.height * 0.46);
  const back = document.createElement('span');
  const front = document.createElement('span');
  back.className = 'fx-orbit-back';
  front.className = 'fx-orbit-front';
  const host = targetSide === 'bp' ? img.parentElement : img;
  if (host && host.parentElement === box) box.insertBefore(back, host);
  else box.insertBefore(back, box.firstChild);
  box.appendChild(front);
  const parts = [];
  const dur = duration / speed;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('i');
    el.className = duck ? 'fx-duck' : 'fx-petal';
    if (duck) el.style.animationDelay = (-i * 0.18).toFixed(2) + 's';
    back.appendChild(el);
    parts.push({
      el,
      phase: (i / count) * Math.PI * 2 + (duck ? 0 : rnd(0, 0.6)),
      r: duck ? radius : radius * (0.75 + Math.random() * 0.35),
      spin: duck ? 1 : 1.8 + Math.random() * 0.9,
      bob: duck ? 0 : rnd(0, 6),
    });
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    for (const p of parts) {
      const ang = p.phase + t * Math.PI * 2 * p.spin;
      const depth = Math.sin(ang);
      const x = cx + Math.cos(ang) * p.r * (duck ? 1 : (1 - t * 0.3));
      const y = duck
        ? cy + Math.sin(ang) * yRadius
        : cy + Math.sin(ang) * yRadius * (1 - t * 0.15) - t * rise + p.bob;
      const sc = duck ? 1 : 0.7 + 0.3 * Math.cos(ang);
      const rot = duck ? '' : ` rotate(${(ang * 57.3 + 90).toFixed(0)}deg)`;
      p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)${rot} scale(${sc.toFixed(2)})`;
      p.el.style.opacity = String(Math.min(1, t * 5) * (t > 0.82 ? (1 - t) / 0.18 : 1));
      const dest = depth < 0 ? back : front;
      if (p.el.parentNode !== dest) dest.appendChild(p.el);
    }
    if (t < 1) requestAnimationFrame(tick);
    else { back.remove(); front.remove(); }
  };
  requestAnimationFrame(tick);
}
// 大字爆炎：直线发射火焰，命中后由火焰素材拼成“大”字炸开
function spawnFireBlastShot(side) {
  const tSide = side === 'bp' ? 'be' : 'bp';
  const from = $(`${side}-img`);
  const to = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!from || !to || !box) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height / 2;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height / 2;
  const size = 42;
  const url = new URL('./move-fx-assets/pe/Gfx_FirePlume__32x32.png', import.meta.url).href;
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = sx + 'px';
  el.style.top = sy + 'px';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.backgroundImage = `url(${url})`;
  el.style.backgroundSize = `${size}px ${size * 5}px`;
  el.style.zIndex = '10';
  box.appendChild(el);
  let f = 0;
  const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * size}px`; }, 70 / speed);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.55)', opacity: 0 },
    { opacity: 1, offset: .12 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) scale(1)`, opacity: 1, offset: .92 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) scale(1.15)`, opacity: 0 },
  ], { duration: 330 / speed, easing: 'linear', fill: 'both' });
  setTimeout(() => { clearInterval(timer); el.remove(); }, 380 / speed);
  return new Promise((resolve) => setTimeout(resolve, 350 / speed));
}
function spawnFireBigExplosion(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.46;
  const big = Math.max(74, Math.min(118, ir.width * 0.8));
  const half = big / 2;
  const pts = [
    [-half, -half * 0.38], [-half * 0.5, -half * 0.38], [0, -half * 0.38], [half * 0.5, -half * 0.38], [half, -half * 0.38],
    [0, -half * 0.42], [-half * 0.28, -half * 0.08], [-half * 0.55, half * 0.35], [-half * 0.78, half * 0.78],
    [0, -half * 0.42], [half * 0.28, -half * 0.08], [half * 0.55, half * 0.35], [half * 0.78, half * 0.78],
  ];
  const url = new URL('./move-fx-assets/pe/Gfx_FirePlume__32x32.png', import.meta.url).href;
  pts.forEach(([dx, dy], i) => {
    const size = 24 + rnd(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + dx) + 'px';
    el.style.top = (cy + dy) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 5}px`;
    el.style.backgroundPosition = `0 -${rnd(0, 4) * size}px`;
    el.style.zIndex = '10';
    box.appendChild(el);
    let f = rnd(0, 4);
    const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * size}px`; }, 70 / speed);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.35)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.12)', opacity: 1, offset: .22 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
    ], { duration: 420 / speed, delay: (i * 18) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, (500 + i * 18) / speed);
  });
}
function spawnPetalDance(targetSide) {
  const box = $(`${targetSide}-box`);
  const img = $(`${targetSide}-img`);
  if (!box || !img) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.46;
  const back = document.createElement('span');
  const front = document.createElement('span');
  back.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none';
  front.style.cssText = 'position:absolute;inset:0;z-index:9;pointer-events:none';
  box.insertBefore(back, box.firstChild);
  box.appendChild(front);
  const petalUrl = new URL('./move-fx-assets/pe/Gfx_PinkPetal__8x8.png', import.meta.url).href;
  const bigFlowerUrl = new URL('./move-fx-assets/pe/Gfx_Flower__16x16.png', import.meta.url).href;
  const smallFlowerUrl = new URL('./move-fx-assets/pe/Gfx_Flower__8x8.png', import.meta.url).href;
  const parts = [];
  const add = (kind) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = '0';
    el.style.top = '0';
    el.style.zIndex = '0';
    let size = 12 + rnd(0, 3);
    let frames = 4;
    if (kind === 'big') { size = 22 + rnd(0, 5); frames = 1; el.style.backgroundImage = `url(${bigFlowerUrl})`; }
    else if (kind === 'small') { size = 13 + rnd(0, 3); frames = 5; el.style.backgroundImage = `url(${smallFlowerUrl})`; }
    else el.style.backgroundImage = `url(${petalUrl})`;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundSize = `${size}px ${size * frames}px`;
    el.style.backgroundPosition = `0 -${rnd(0, frames - 1) * size}px`;
    back.appendChild(el);
    if (frames > 1) {
      let f = rnd(0, frames - 1);
      el._timer = setInterval(() => { f = (f + 1) % frames; el.style.backgroundPosition = `0 -${f * size}px`; }, 80 / speed);
    }
    parts.push({
      el,
      phase: (parts.length / 19) * Math.PI * 2 + Math.random() * 0.6,
      r: (kind === 'petal' ? 48 : 42) * (0.75 + Math.random() * 0.35),
      spin: kind === 'petal' ? 1.8 + Math.random() * 0.9 : 0.7 + Math.random() * 0.6,
      bob: rnd(0, 8),
      rise: kind === 'petal' ? 26 : 18,
      kind,
    });
  };
  for (let i = 0; i < 12; i++) add('petal');
  for (let i = 0; i < 3; i++) add('big');
  for (let i = 0; i < 4; i++) add('small');
  const dur = 1050 / speed;
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      for (const p of parts) {
        const ang = p.phase + t * Math.PI * 2 * p.spin;
        const depth = Math.sin(ang);
        const x = cx + Math.cos(ang) * p.r * (1 - t * 0.3);
        const y = cy + Math.sin(ang) * (p.kind === 'petal' ? 15 : 13) * (1 - t * 0.15) - t * p.rise + p.bob;
        const sc = p.kind === 'petal' ? 0.7 + 0.3 * Math.cos(ang) : 0.9 + 0.15 * Math.cos(ang);
        p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) rotate(${(ang * (p.kind === 'petal' ? 57.3 : 22)).toFixed(0)}deg) scale(${sc.toFixed(2)})`;
        p.el.style.opacity = String(Math.min(1, t * 5) * (t > 0.82 ? (1 - t) / 0.18 : 1));
        const dest = depth < 0 ? back : front;
        if (p.el.parentNode !== dest) dest.appendChild(p.el);
      }
      if (t < 1) requestAnimationFrame(tick);
      else {
        for (const p of parts) {
          if (p.el._timer) clearInterval(p.el._timer);
          p.el.remove();
        }
        back.remove();
        front.remove();
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}
function spawnDuckOrbit(targetSide) {
  spawnOrbitFx(targetSide, { count: 5, duration: 1500, radius: 30, yRadius: 9, rise: 8, duck: true });
}

const SURF_WAVE_SRC = {
  bp: new URL('../src/pe-battle/move-fx-assets/surf-player.png', import.meta.url).href,
  be: new URL('../src/pe-battle/move-fx-assets/surf-enemy.png', import.meta.url).href,
};
async function flailWindup(side) {
  const img = $(`${side}-img`);
  if (!img) return;
  const dur = 420 / speed;
  img.style.transformOrigin = '50% 100%';
  const a = img.animate([
    { transform: 'translateX(0)' },
    { transform: 'translateX(-14px)', offset: 0.15 },
    { transform: 'translateX(14px)', offset: 0.35 },
    { transform: 'translateX(-14px)', offset: 0.55 },
    { transform: 'translateX(14px)', offset: 0.75 },
    { transform: 'translateX(0)' },
  ], { duration: dur, easing: 'ease-in-out', fill: 'both' });
  await sleep(420);
  a.cancel();
  img.style.transformOrigin = '';
  img.style.transform = '';
}
async function playMementoFx(side) {
  const st = stage();
  const foe = side === 'bp' ? 'be' : 'bp';
  const atk = $(`${side}-img`);
  const tgt = $(`${foe}-img`);
  if (!st || !atk || !tgt) return;
  const sr = st.getBoundingClientRect();
  const orb = (img) => {
    const r = img.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'b-memento-orb';
    el.style.left = (r.left - sr.left + r.width / 2) + 'px';
    el.style.top = (r.top - sr.top + r.height * 0.52) + 'px';
    el.style.width = (r.width * 1.08) + 'px';
    el.style.height = (r.height * 0.86) + 'px';
    st.appendChild(el);
    return el;
  };
  const run = (img, frames, dur, orbFrames) => {
    img.style.transformOrigin = '50% 100%';
    const a = img.animate(frames, { duration: dur / speed, easing: 'ease-in-out', fill: 'both' });
    const el = orb(img);
    el.animate(orbFrames, { duration: dur / speed, easing: 'ease-in-out', fill: 'both' });
    return { a, el };
  };
  const first = run(atk, [
    { transform: 'scale(1,1)' },
    { transform: 'scale(1.06,1.45)', offset: 0.55 },
    { transform: 'scale(1.06,1.45)', offset: 0.78 },
    { transform: 'scale(1,1)' },
  ], 520, [
    { opacity: 0, transform: 'translate(-50%,-50%) scaleY(.5)' },
    { opacity: .85, transform: 'translate(-50%,-50%) scaleY(1.45)', offset: .5 },
    { opacity: .8, transform: 'translate(-50%,-50%) scaleY(1.55)', offset: .78 },
    { opacity: 0, transform: 'translate(-50%,-50%) scaleY(1.6)' },
  ]);
  await sleep(560);
  first.a.cancel();
  first.el.remove();
  atk.style.transformOrigin = '';
  atk.style.transform = '';
  await sleep(70);
  const second = run(tgt, [
    { transform: 'scale(1,1)' },
    { transform: 'scale(1.08,.5)', offset: .35 },
    { transform: 'scale(1.08,.5)', offset: .7 },
    { transform: 'scale(1,1)' },
  ], 560, [
    { opacity: 0, transform: 'translate(-50%,-50%) scaleY(1.55)' },
    { opacity: .85, transform: 'translate(-50%,-50%) scaleY(1.55)', offset: .25 },
    { opacity: .7, transform: 'translate(-50%,-50%) scaleY(.55)', offset: .7 },
    { opacity: 0, transform: 'translate(-50%,-50%) scaleY(.35)' },
  ]);
  await sleep(600);
  second.a.cancel();
  second.el.remove();
  tgt.style.transformOrigin = '';
  tgt.style.transform = '';
}
function spawnSurfWave(side, muddy = false) {
  const stage = document.querySelector('.battle-fight');
  if (!stage) return;
  const fx = document.createElement('span');
  fx.className = 'b-surf-fx ' + (side === 'bp' ? 'is-player' : 'is-enemy') + (muddy ? ' is-muddy' : '');
  const water = document.createElement('span');
  water.className = 'b-surf-water';
  const wave = document.createElement('img');
  wave.className = 'b-surf-wave';
  wave.src = SURF_WAVE_SRC[side === 'bp' ? 'bp' : 'be'];
  wave.alt = '';
  water.appendChild(wave);
  fx.appendChild(water);
  stage.appendChild(fx);
  setTimeout(() => fx.remove(), 1000);
}

// 挖洞/潜水原作素材 + 第二段目标脚边复制体
function spawnChargeAssetFx(boxSide, kind) {
  const img = $(`${boxSide}-img`);
  const box = $(`${boxSide}-box`);
  if (!img || !box) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height - 2;
  const A = {
    dig: new URL('./move-fx-assets/pe/Gfx_DirtMound__32x16.png', import.meta.url).href,
    dirt: new URL('./move-fx-assets/pe/Gfx_MudSand__8x8.png', import.meta.url).href,
    splash: new URL('./move-fx-assets/pe/Gfx_Splash__64x64.png', import.meta.url).href,
    drop: new URL('./move-fx-assets/water_droplet.png', import.meta.url).href,
  };
  const add = (src, w, h, frames, ms, dx, dy, scale, life) => {
    const el = document.createElement('span');
    el.className = 'b-charge-asset';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = (cx + dx) + 'px';
    el.style.top = (cy + dy) + 'px';
    el.style.backgroundImage = `url(${src})`;
    el.style.backgroundSize = `${w}px ${h * frames}px`;
    el.style.backgroundPosition = '0 0';
    el.style.transform = `translate(-50%, -50%) scale(${scale})`;
    box.appendChild(el);
    if (frames > 1) {
      let f = 0;
      el._timer = setInterval(() => {
        f = (f + 1) % frames;
        el.style.backgroundPosition = `0 -${f * h}px`;
      }, ms / speed);
    }
    el.animate([
      { opacity: 0, transform: `translate(-50%, -50%) scale(${scale * 0.6})` },
      { opacity: 1, offset: 0.22 },
      { opacity: 0, transform: `translate(-50%, -50%) scale(${scale * 1.2})` },
    ], { duration: life / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(el._timer); el.remove(); }, life / speed + 40);
  };
  if (kind === 'dig') {
    add(A.dig, 32, 16, 2, 110, 0, 0, 1.25, 620);
    for (let i = 0; i < 5; i++) add(A.dirt, 8, 8, 1, 0, Math.random() * 34 - 17, -4, 1.6, 520);
  } else {
    add(A.splash, 64, 64, 1, 0, 0, 0, 1.35, 620);
    for (let i = 0; i < 6; i++) add(A.drop, 32, 32, 8, 70, Math.random() * 44 - 22, -8, 0.6, 620);
  }
}
function spawnChargeClone(side, targetSide) {
  const el = $(`${side}-img`);
  const box = $(`${targetSide}-box`);
  const tImg = $(`${targetSide}-img`);
  if (!el || !box || !tImg) return null;
  const br = box.getBoundingClientRect();
  const ir = tImg.getBoundingClientRect();
  const clone = document.createElement('img');
  clone.className = 'b-charge-clone';
  clone.src = el.currentSrc || el.src;
  clone.alt = '';
  clone.draggable = false;
  clone.style.width = ir.width + 'px';
  clone.style.height = ir.height + 'px';
  clone.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  clone.style.top = (ir.top - br.top + ir.height) + 'px';
  clone.style.marginLeft = (-ir.width / 2) + 'px';
  clone.style.marginTop = (-ir.height) + 'px';
  clone.style.zIndex = '6';
  box.appendChild(clone);
  el.style.visibility = 'hidden';
  void clone.offsetWidth;
  clone.classList.add('cg-out-sink');
  return clone;
}

function spawnOrigStatic(key, side, scale = 2, duration = 420, color = null) {
  const spec = ORIG[key];
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!spec || !box || !img) return duration;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const el = origEl(key);
  if (key === 'impact' && color) {
    const mask = `url(${origUrl(spec.file)})`;
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = color;
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
    el.style.maskSize = '100% 100%';
    el.style.webkitMaskSize = '100% 100%';
  }
  if (color) el.style.filter = `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 12px ${color})`;
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height * (key === 'impact' ? 0.5 : 0.3)) + 'px';
  box.appendChild(el);
  startOrigSheet(el, spec);
  el.animate([
    { transform: `translate(-50%, -50%) scale(${scale * 0.6})`, opacity: 0 },
    { transform: `translate(-50%, -50%) scale(${scale})`, opacity: 1, offset: .35 },
    { transform: `translate(-50%, -50%) scale(${scale * 1.15})`, opacity: 0 },
  ], { duration: duration / speed, easing: 'ease-out', fill: 'both' });
  setTimeout(() => removeOrig(el), duration / speed + 100);
  return duration / speed;
}
function spawnOrigRocks(side, count = 6) {
  const spec = ORIG.rocks;
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!spec || !box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  for (let i = 0; i < count; i++) {
    const el = origEl('rocks', rnd(0, spec.frames - 1));
    const x = cx + (Math.random() * 100 - 50);
    const y = ir.top - br.top - (130 + Math.random() * 60);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    box.appendChild(el);
    const drop = (ir.top - br.top + ir.height * 0.35) - y;
    el.animate([
      { transform: 'translate(-50%, 0) rotate(0deg)', opacity: 1 },
      { transform: `translate(-50%, ${drop}px) rotate(${rnd(-40, 40)}deg)`, opacity: 0 },
    ], { duration: (520 + Math.random() * 160) / speed, delay: Math.random() * 180 / speed, easing: 'ease-in', fill: 'both' });
    setTimeout(() => removeOrig(el), 900 / speed);
  }
}
// “束”类招式的可见光束：从攻击方中心连到对手中心，短暂亮起后消失
const BEAM_COLORS = {
  冰冻光束: '#a8f0ff', 极光束: '#b9f4ff', 铁蹄光线: '#d9e7f5',
  破坏光线: '#ffc46b', 日光束: '#ffe89a', 幻象光线: '#f58bd0',
  信号光束: '#c8e56a', 充电光束: '#ffe36a', 棱镜镭射: '#f0a7ff',
  无极光束: '#8b8cff', 流星光束: '#d8c5ff', 双光束: '#f2b5ff', 电光束: '#ffe16a',
};

function spawnBeamFx(name, opp = false) {
  const color = BEAM_COLORS[name];
  if (!color) return;
  const box = stage();
  const atk = $(opp ? 'be-img' : 'bp-img');
  const tgt = $(opp ? 'bp-img' : 'be-img');
  if (!box || !atk || !tgt) return;
  const br = box.getBoundingClientRect();
  const ar = atk.getBoundingClientRect();
  const tr = tgt.getBoundingClientRect();
  const x1 = ar.left - br.left + ar.width / 2;
  const y1 = ar.top - br.top + ar.height * 0.48;
  const x2 = tr.left - br.left + tr.width / 2;
  const y2 = tr.top - br.top + tr.height * 0.48;
  const len = Math.max(8, Math.hypot(x2 - x1, y2 - y1));
  const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  const el = document.createElement('span');
  el.className = 'fx-beam';
  el.style.setProperty('--beam', color);
  el.style.left = x1 + 'px';
  el.style.top = (y1 - 6) + 'px';
  el.style.transform = `rotate(${ang}deg)`;
  box.appendChild(el);
  el.animate([
    { width: '0px', opacity: 0 },
    { width: (len * 0.72).toFixed(1) + 'px', opacity: 1, offset: 0.2 },
    { width: len.toFixed(1) + 'px', opacity: 1, offset: 0.48 },
    { width: len.toFixed(1) + 'px', opacity: 0 },
  ], { duration: 560 / speed, easing: 'ease-out', fill: 'both' });
  setTimeout(() => el.remove(), 700 / speed);
}

function spawnStarBurst(side, count = 6) {
  const spec = ORIG.star;
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!spec || !box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  for (let i = 0; i < count; i++) {
    const el = origEl('star');
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 12 + Math.random() * 22;
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.filter = 'drop-shadow(0 0 2px #ffe066)';
    box.appendChild(el);
    el.animate([
      { transform: 'translate(-50%, -50%) scale(.35) rotate(0deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist * 0.55).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist * 0.55).toFixed(1)}px)) scale(1) rotate(${rnd(-45, 45)}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist).toFixed(1)}px)) scale(.55) rotate(${rnd(-90, 90)}deg)`, opacity: 0 },
    ], { duration: 420 / speed, delay: (i * 20) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => removeOrig(el), 560 / speed);
  }
}

// 四代牙类招式没有原作脚本，复用原作 Gfx_FangAttack 牙印贴图补一个咬合表现
const FANG_COLORS = {
  雷电牙: '#ffe066',
  冰冻牙: '#23d7ff',
  火焰牙: '#ff9a4d',
  精神之牙: '#f08bd0',
  剧毒牙: '#b35cff',
  虫咬: '#a8c93f',
};
const HAND_CLAMP_MOVES = new Set(['拍落', '小偷', '渴望', '击掌奇袭']);
const FIRE_IMPACT = new Set(['火焰牙', '火焰弹', '火焰球', '交错火焰', '魔法火焰', '火焰鞭']);

function spawnFangBite(tSide, name) {
  const color = FANG_COLORS[name];
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!color || !box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = `url(${new URL('./move-fx-assets/pe/Gfx_SharpTeeth__64x64.png', import.meta.url).href})`;
  const makeJaw = (mirror, delay) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.width = '64px';
    el.style.height = '64px';
    el.style.backgroundImage = url;
    el.style.zIndex = '10';
    box.appendChild(el);
    const start = mirror ? 'translate(-50%, -50%) translateY(28px) scaleY(-1)' : 'translate(-50%, -50%) translateY(-28px)';
    const close = mirror ? 'translate(-50%, -50%) scaleY(-1)' : 'translate(-50%, -50%)';
    const hot = name === '剧毒牙';
    const biteFilter = hot
      ? 'sepia(1) saturate(4) hue-rotate(250deg) brightness(1.08)'
      : `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 8px ${color})`;
    el.animate([
      { transform: start, opacity: 0, filter: 'none' },
      { transform: close, opacity: 1, filter: biteFilter, offset: 0.38 },
      { transform: close, opacity: 0, filter: biteFilter },
    ], { duration: 460 / speed, delay, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), 520 / speed);
  };
  makeJaw(false, 0);
  makeJaw(true, 0);
}
// 拍落/小偷/渴望：Gfx_TagHand 下半只手，左右对称夹击目标两侧
function spawnClampHands(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.44;
  const edge = ir.width / 2 + 2;
  const url = `url(${new URL('./move-fx-assets/pe/Gfx_TagHand__32x32.png', import.meta.url).href})`;
  const makeHand = (dir) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + dir * edge) + 'px';
    el.style.top = cy + 'px';
    el.style.width = '32px';
    el.style.height = '32px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = '32px 64px';
    el.style.backgroundPosition = '0 -32px';
    el.style.zIndex = '10';
    box.appendChild(el);
    const flip = dir > 0 ? ' scaleX(-1)' : '';
    const base = `translate(-50%,-50%) translateX(${dir * 40}px)${flip} rotate(8deg)`;
    const hit = `translate(-50%,-50%)${flip} rotate(8deg) scale(1.08)`;
    const press = `translate(-50%,-50%) translateX(${-dir * 3}px)${flip} rotate(8deg) scale(1.08)`;
    const out = `translate(-50%,-50%) translateX(${dir * 34}px)${flip} rotate(8deg)`;
    el.animate([
      { transform: base, opacity: 0, easing: 'ease-in' },
      { transform: hit, opacity: 1, offset: 0.42 },
      { transform: press, opacity: 1, offset: 0.6 },
      { transform: out, opacity: 0, easing: 'ease-out' },
    ], { duration: 420 / speed, fill: 'both' });
    setTimeout(() => el.remove(), 460 / speed);
  };
  makeHand(-1);
  makeHand(1);
}
// 紧束/绑紧/缠绕：原作 Gfx_Tendrils 四帧藤蔓缠住目标，左右交错收紧两轮
function spawnBindWrapFx(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const scale = Math.max(0.8, Math.min(1.35, ir.width / 64));
  const sway = 11 * scale;
  const el = document.createElement('span');
  el.className = 'fx-orig b-bind-wrap';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height * 0.55) + 'px';
  el.style.width = 64 * scale + 'px';
  el.style.height = 32 * scale + 'px';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_Tendrils__64x32.png', import.meta.url).href})`;
  el.style.backgroundSize = `${64 * scale}px ${128 * scale}px`;
  el.style.backgroundPosition = '0 0';
  el.style.zIndex = '10';
  box.appendChild(el);
  let frame = 0;
  const timer = setInterval(() => {
    frame = (frame + 1) % 4;
    el.style.backgroundPosition = `0 ${-32 * scale * frame}px`;
  }, 66 / speed);
  const dur = 560 / speed;
  const anim = el.animate([
    { transform: 'translate(-50%,-50%) scale(0.86)', opacity: 0 },
    { transform: `translate(-50%,-50%) translateX(${-sway}px) scale(1)`, opacity: 1, offset: 0.14 },
    { transform: `translate(-50%,-50%) translateX(${sway}px) scale(1.04)`, opacity: 1, offset: 0.32 },
    { transform: `translate(-50%,-50%) translateX(${-sway}px) scale(1.04)`, opacity: 1, offset: 0.52 },
    { transform: `translate(-50%,-50%) translateX(${sway}px) scale(1.04)`, opacity: 1, offset: 0.72 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.84 },
    { transform: 'translate(-50%,-50%) scale(0.92)', opacity: 0 },
  ], { duration: dur, easing: 'ease-in-out', fill: 'both' });
  const squeeze = img.animate([
    { transform: 'scale(1, 1)' },
    { transform: 'scale(0.94, 1.06)', offset: 0.2 },
    { transform: 'scale(1.04, 0.96)', offset: 0.38 },
    { transform: 'scale(0.96, 1.04)', offset: 0.56 },
    { transform: 'scale(1, 1)' },
  ], { duration: dur, easing: 'ease-in-out' });
  const done = () => {
    clearInterval(timer);
    anim.cancel();
    squeeze.cancel();
    el.remove();
  };
  anim.onfinish = done;
  setTimeout(done, 650 / speed);
}
// 喝牛奶：增益瓶始终在施放者自己身上，玩家右侧、对手左侧
function spawnMilkDrinkFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const dir = side === 'bp' ? 1 : -1;
  const bx = cx + dir * 20;
  const by = cy - 14;
  let aim = (Math.atan2(cy - by, cx - bx) * 180) / Math.PI + 90;
  if (aim > 180) aim -= 360;
  if (aim < -180) aim += 360;
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = bx + 'px';
  el.style.top = by + 'px';
  el.style.width = '32px';
  el.style.height = '32px';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_MilkBottle__32x32.png', import.meta.url).href})`;
  el.style.backgroundSize = '32px 32px';
  el.style.zIndex = '10';
  box.appendChild(el);
  el.animate([
    { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 0 },
    { opacity: 1, offset: .12 },
    { transform: `translate(-50%,-50%) rotate(${aim.toFixed(1)}deg)`, offset: .34 },
    { transform: `translate(-50%,-50%) rotate(${(aim * 0.92).toFixed(1)}deg)`, offset: .62 },
    { transform: `translate(-50%,-50%) rotate(${(aim * 1.06).toFixed(1)}deg)`, opacity: 1, offset: .82 },
    { transform: `translate(-50%,-50%) rotate(${aim.toFixed(1)}deg)`, opacity: 0 },
  ], { duration: 780 / speed, easing: 'ease-in-out', fill: 'both' });
  setTimeout(() => el.remove(), 820 / speed);
}
// 龙卷风：从目标脚下卷起树叶和碎石，螺旋上升到目标身上
function spawnTwisterFx(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.42;
  const groundY = ir.top - br.top + ir.height * 0.96;
  const leafUrl = `url(${new URL('./move-fx-assets/pe/Gfx_Leaf__16x16.png', import.meta.url).href})`;
  const rockUrl = `url(${new URL('./move-fx-assets/pe/Gfx_Rocks__32x32.png', import.meta.url).href})`;
  for (let i = 0; i < 12; i++) {
    const rock = i >= 8;
    const el = document.createElement('span');
    el.className = 'fx-orig';
    const size = rock ? 28 + rnd(0, 10) : 16 + rnd(0, 6);
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.backgroundImage = rock ? rockUrl : leafUrl;
    el.style.backgroundSize = `${size}px ${size * (rock ? 6 : 9)}px`;
    el.style.backgroundPosition = `0 -${rnd(0, rock ? 5 : 8) * size}px`;
    el.style.zIndex = '10';
    el.style.transform = 'translate(-50%,-50%)';
    box.appendChild(el);
    const ang = Math.random() * Math.PI * 2;
    const radius = 44 + rnd(0, 26);
    const dy0 = groundY - cy + rnd(0, 14);
    const a1 = ang + Math.PI * 0.9;
    const a2 = ang + Math.PI * 1.7;
    const delay = (rnd(0, 160) + (rock ? 40 : 0)) / speed;
    const dur = (520 + rnd(0, 160)) / speed;
    el.animate([
      { transform: `translate(-50%,-50%) translate(${(Math.cos(ang) * 14).toFixed(1)}px, ${dy0.toFixed(1)}px) rotate(0deg) scale(.55)`, opacity: 0 },
      { opacity: 1, offset: .14 },
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a1) * radius).toFixed(1)}px, ${(dy0 * 0.62 + Math.sin(a1) * 10).toFixed(1)}px) rotate(170deg) scale(1)`, offset: .42 },
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a2) * radius * 0.42).toFixed(1)}px, ${(dy0 * 0.25 + Math.sin(a2) * 7).toFixed(1)}px) rotate(310deg) scale(1.12)`, offset: .7 },
      { transform: 'translate(-50%,-50%) translate(0, 0) rotate(420deg) scale(1.2)', opacity: 0 },
    ], { duration: dur, delay, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), dur + delay + 30);
  }
}
// 烟幕：原作烟雾贴图在目标上半身聚成一团
// 黑雾：整片暗雾横扫战场，配合压暗遮罩
function spawnHazeFx() {
  const field = stage();
  if (!field) return;
  const fr = field.getBoundingClientRect();
  const url = new URL('./move-fx-assets/pe/Gfx_GraySmoke__32x32.png', import.meta.url).href;
  const shade = document.createElement('span');
  shade.style.position = 'absolute';
  shade.style.inset = '0';
  shade.style.zIndex = '6';
  shade.style.background = 'rgba(8, 8, 14, 0.42)';
  shade.style.opacity = '0';
  shade.style.pointerEvents = 'none';
  field.appendChild(shade);
  shade.animate([{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: 1, offset: .65 }, { opacity: 0 }], { duration: 950, fill: 'both' });
  setTimeout(() => shade.remove(), 1000);
  for (let i = 0; i < 12; i++) {
    const dir = i % 2 ? 1 : -1;
    const w = 60 + randInt(0, 50);
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.left = (dir > 0 ? -w / 2 : fr.width + w / 2) + 'px';
    el.style.top = fr.height * (0.12 + Math.random() * 0.7) + 'px';
    el.style.width = w + 'px';
    el.style.height = w + 'px';
    el.style.zIndex = '7';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${w}px ${w * 5}px`;
    el.style.filter = 'brightness(.2) saturate(.12)';
    el.style.opacity = '0';
    field.appendChild(el);
    let f = randInt(0, 4);
    const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * w}px`; }, 80 / speed);
    const dur = (900 + randInt(0, 260)) / speed;
    el.animate([
      { transform: 'translate(-50%,-50%) translateX(0)', opacity: 0 },
      { opacity: .9, offset: .2 },
      { transform: `translate(-50%,-50%) translateX(${dir * (fr.width + w) * 0.55}px)`, opacity: .85, offset: .6 },
      { transform: `translate(-50%,-50%) translateX(${dir * (fr.width + w)}px)`, opacity: 0 },
    ], { duration: dur, easing: 'linear', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, dur + 50);
  }
}
// 蓝色星星粒子：自身强化/月光类招式复用
function spawnBlueStarBurst(side, count = 8) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = new URL('./move-fx-assets/pe/Gfx_BlueStar__32x32.png', import.meta.url).href;
  for (let i = 0; i < count; i++) {
    const size = 20 + rnd(0, 12);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + rnd(-Math.round(ir.width * 0.35), Math.round(ir.width * 0.35))) + 'px';
    el.style.top = (cy + rnd(-Math.round(ir.height * 0.3), Math.round(ir.height * 0.25))) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 7}px`;
    el.style.backgroundPosition = `0 -${rnd(0, 6) * size}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    let f = rnd(0, 6);
    const timer = setInterval(() => { f = (f + 1) % 7; el.style.backgroundPosition = `0 -${f * size}px`; }, 70 / speed);
    el.animate([
      { transform: 'translate(-50%,-50%) translateY(8px) scale(.5)', opacity: 0 },
      { opacity: 1, offset: .2 },
      { transform: 'translate(-50%,-50%) translateY(-28px) scale(1.1) rotate(120deg)', opacity: 0 },
    ], { duration: 780 / speed, delay: (i * 45) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, (850 + i * 45) / speed);
  }
}
// 岩石封锁：四块岩石从脚下升起围住目标，最后在目标中心打叉
function spawnRockTombFx(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const groundY = ir.top - br.top + ir.height * 0.96;
  const url = new URL('./move-fx-assets/pe/Gfx_Rocks__32x32.png', import.meta.url).href;
  const spots = [[-0.34, -0.05], [0.34, -0.05], [-0.27, 0.22], [0.27, 0.22]];
  spots.forEach(([dx, dy], i) => {
    const size = 34 + rnd(0, 10);
    const endX = cx + dx * ir.width;
    const endY = cy + dy * ir.height;
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = endX + 'px';
    el.style.top = endY + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${rnd(0, 5) * size}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    el.animate([
      { transform: `translate(-50%,-50%) translateY(${(groundY - endY).toFixed(0)}px) scale(.7) rotate(0deg)`, opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: 'translate(-50%,-50%) translateY(0) scale(1) rotate(180deg)', opacity: 1, offset: .8 },
      { transform: 'translate(-50%,-50%) translateY(0) scale(1) rotate(180deg)', opacity: 0 },
    ], { duration: 520 / speed, delay: (i * 40) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), (580 + i * 40) / speed);
  });
}
function spawnXMark(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  el.style.width = '56px';
  el.style.height = '56px';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_XSign__64x64.png', import.meta.url).href})`;
  el.style.backgroundSize = '56px 56px';
  el.style.zIndex = '10';
  box.appendChild(el);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.35)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.12)', opacity: 1, offset: .45 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .7 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
  ], { duration: 520 / speed, fill: 'both' });
  setTimeout(() => el.remove(), 560);
}
// 尖石攻击/岩石炮等：石块沿抛物线从攻击方砸向目标
function spawnStoneBarrageFx(atkSide, tSide, count = 6) {
  const box = $(`${tSide}-box`);
  const from = $(`${atkSide}-img`);
  const to = $(`${tSide}-img`);
  if (!box || !from || !to) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = 0.4;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  const url = new URL('./move-fx-assets/pe/Gfx_Rocks__32x32.png', import.meta.url).href;
  for (let i = 0; i < count; i++) {
    const size = 26 + rnd(0, 12);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${rnd(0, 5) * size}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    const tx = ex + rnd(-18, 18);
    const ty = ey + rnd(-12, 12);
    el.animate([
      { transform: 'translate(-50%,-50%) translate(0,0) rotate(0deg)', opacity: 0 },
      { opacity: 1, offset: .12 },
      { transform: `translate(-50%,-50%) translate(${((tx - sx) * .5).toFixed(1)}px, ${((ty - sy) * .5 - 90).toFixed(1)}px) rotate(220deg)`, opacity: 1, offset: .55 },
      { transform: `translate(-50%,-50%) translate(${(tx - sx).toFixed(1)}px, ${(ty - sy).toFixed(1)}px) rotate(400deg)`, opacity: 0 },
    ], { duration: 560 / speed, delay: (i * 45) / speed, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), (620 + i * 45) / speed);
  }
}
// 月亮：压黑背景显示月亮，月光用自身蓝星，月亮之力用蓝星飞向目标
function spawnMoonFx(side, tSide, mode) {
  const field = stage();
  if (!field) return;
  const fr = field.getBoundingClientRect();
  const shade = document.createElement('span');
  shade.style.position = 'absolute';
  shade.style.inset = '0';
  shade.style.zIndex = '6';
  shade.style.background = '#050510';
  shade.style.opacity = '0';
  shade.style.pointerEvents = 'none';
  field.appendChild(shade);
  shade.animate([{ opacity: 0 }, { opacity: .58, offset: .25 }, { opacity: .58, offset: .75 }, { opacity: 0 }], { duration: 950 / speed, fill: 'both' });
  setTimeout(() => shade.remove(), 1000);
  const moon = document.createElement('span');
  moon.className = 'fx-orig';
  moon.style.left = (fr.width / 2) + 'px';
  moon.style.top = (fr.height * 0.16) + 'px';
  moon.style.width = '96px';
  moon.style.height = '96px';
  moon.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_Moon__64x64.png', import.meta.url).href})`;
  moon.style.backgroundSize = '96px 96px';
  moon.style.zIndex = '7';
  field.appendChild(moon);
  moon.animate([
    { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .25 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .75 },
    { transform: 'translate(-50%,-50%) scale(.8)', opacity: 0 },
  ], { duration: 950 / speed, fill: 'both' });
  setTimeout(() => moon.remove(), 1000);
  if (mode === 'heal') {
    spawnBlueStarBurst(side, 10);
    return;
  }
  const box = $(`${tSide}-box`);
  const tgt = $(`${tSide}-img`);
  if (!box || !tgt) return;
  const tr = tgt.getBoundingClientRect();
  // 粒子挂在战场上，落点用战场坐标；box 坐标会导致方向乱飞
  const tx = tr.left - fr.left + tr.width / 2;
  const ty = tr.top - fr.top + tr.height / 2;
  const mx = fr.width / 2;
  const my = fr.height * 0.16;
  const url = new URL('./move-fx-assets/pe/Gfx_BlueStar__32x32.png', import.meta.url).href;
  for (let i = 0; i < 8; i++) {
    const size = 18 + rnd(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = mx + 'px';
    el.style.top = my + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 7}px`;
    el.style.zIndex = '9';
    field.appendChild(el);
    let f = rnd(0, 6);
    const timer = setInterval(() => { f = (f + 1) % 7; el.style.backgroundPosition = `0 -${f * size}px`; }, 70 / speed);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
      { opacity: 1, offset: .15 },
      { transform: `translate(calc(-50% + ${((tx - mx) * .5).toFixed(1)}px), calc(-50% + ${((ty - my) * .5).toFixed(1)}px)) scale(1.1) rotate(160deg)`, opacity: 1, offset: .55 },
      { transform: `translate(calc(-50% + ${(tx - mx).toFixed(1)}px), calc(-50% + ${(ty - my).toFixed(1)}px)) scale(.8) rotate(300deg)`, opacity: 0 },
    ], { duration: 620 / speed, delay: (120 + i * 55) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, (820 + i * 55) / speed);
  }
}
// 地球上投后半段：显隐攻击方，临时替身在对手位置随背景一起下坠
// 地球上投命中后：背景浮现，攻击方从贴身位置向下滑出，结束后回原位
// 地球上投命中后：攻击方先钻到对手下方上顶，再随背景一起坠出画面
function spawnSeismicRocks(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = new URL('./move-fx-assets/pe/Gfx_Rocks__32x32.png', import.meta.url).href;
  for (let i = 0; i < 7; i++) {
    const size = 14 + rnd(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + rnd(-18, 18)) + 'px';
    el.style.top = (cy + rnd(-16, 16)) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${rnd(0, 5) * size}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    const ang = Math.random() * Math.PI * 2;
    const dist = 30 + rnd(0, 45);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.5) rotate(0deg)', opacity: 0 },
      { opacity: 1, offset: .15 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist - 35).toFixed(1)}px)) scale(.9) rotate(220deg)`, opacity: 1, offset: .6 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist * 1.2).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist * 1.2 + 35).toFixed(1)}px)) scale(.7) rotate(400deg)`, opacity: 0 },
    ], { duration: 620 / speed, delay: (i * 25) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), (700 + i * 25) / speed);
  }
}
function spawnSeismicLiftFx(side, tSide, onImpact) {
  const field = stage();
  const atk = $(`${side}-img`);
  const tgt = $(`${tSide}-img`);
  if (!field || !atk || !tgt) return Promise.resolve();
  resetAnim(atk);
  atk.style.transform = '';
  const ar = atk.getBoundingClientRect();
  const tr = tgt.getBoundingClientRect();
  const acx = ar.left + ar.width / 2;
  const acy = ar.top + ar.height / 2;
  const tcx = tr.left + tr.width / 2;
  const tcy = tr.top + tr.height / 2;
  // 我方在 scaleX(-1) 容器内，translateX 方向与屏幕相反
  const dx = (side === 'bp' ? -1 : 1) * (tcx - acx);
  // 位移目标（对手正下方）：攻击方头顶贴住对手脚底
  const belowDy = (tcy + tr.height * 0.5 + ar.height * 0.5) - acy;
  // 向上顶：攻击方中心顶到对手下半身（接触点），不再继续上冲
  const strikeDy = (tcy + tr.height * 0.15) - acy;
  raiseAttacker(side);
  const anim = atk.animate([
    // 从原位快速冲到对手正下方（不闪现）
    { transform: 'translate(0, 0) scale(1)', offset: 0, easing: 'cubic-bezier(.35,.8,.35,1)' },
    { transform: `translate(${dx.toFixed(1)}px, ${belowDy.toFixed(1)}px) scale(.96)`, offset: .18, easing: 'ease-out' },
    { transform: `translate(${dx.toFixed(1)}px, ${belowDy.toFixed(1)}px) scale(1)`, offset: .24, easing: 'ease-in' },
    // 下蹲蓄力
    { transform: `translate(${dx.toFixed(1)}px, ${(belowDy + 6).toFixed(1)}px) scale(.9, 1.12)`, offset: .31, easing: 'cubic-bezier(.15,.85,.3,1)' },
    // 向上顶：接触瞬间压扁拉长
    { transform: `translate(${dx.toFixed(1)}px, ${strikeDy.toFixed(1)}px) scale(1.08, .94)`, offset: .41, easing: 'ease-out' },
    { transform: `translate(${dx.toFixed(1)}px, ${(strikeDy - 4).toFixed(1)}px) scale(1.03, .98)`, offset: .44, easing: 'cubic-bezier(.4,0,.9,.6)' },
    // 顶完以很快的速度向下坠落出视口（衬托对手被巨力打飞到天上）
    { transform: `translate(${dx.toFixed(1)}px, ${(strikeDy + 420).toFixed(1)}px) scale(1)`, offset: .60 },
    { transform: `translate(${dx.toFixed(1)}px, ${(strikeDy + 420).toFixed(1)}px) scale(1)`, offset: 1 },
  ], { duration: 1200 / speed, fill: 'both' });
  // 被顶飞：受击压扁 → 被巨力打飞到天上 → 落回原处（结束时回到原位，不留下位移残留）
  const squash = tgt.animate([
    { transform: 'translateY(0) scale(1,1)', offset: 0 },
    { transform: 'translateY(4px) scale(.84,1.18)', offset: .06, easing: 'ease-out' },
    { transform: 'translateY(-34px) scale(1.1,.9)', offset: .18, easing: 'ease-out' },
    { transform: 'translateY(-102px) scale(1.03,.97)', offset: .44, easing: 'ease-in' },
    { transform: 'translateY(-108px) scale(1,1)', offset: .54, easing: 'cubic-bezier(.6,0,.9,.5)' },
    { transform: 'translateY(-16px) scale(1,1)', offset: .84, easing: 'ease-in' },
    { transform: 'translateY(0) scale(.9,1.12)', offset: .93 },
    { transform: 'translateY(0) scale(1,1)', offset: 1 },
  ], { duration: 710 / speed, delay: 490 / speed, fill: 'forwards' });
  const bg = document.createElement('span');
  bg.style.position = 'absolute';
  bg.style.inset = '0';
  bg.style.zIndex = '0';
  bg.style.pointerEvents = 'none';
  bg.style.backgroundImage = `url(${new URL('./move-fx-assets/bg/bg_in_air.png', import.meta.url).href})`;
  bg.style.backgroundRepeat = 'repeat';
  bg.style.backgroundSize = 'auto';
  bg.style.backgroundPosition = '0 0';
  bg.style.opacity = '0';
  field.insertBefore(bg, field.firstChild);
  bg.animate([
    { opacity: 0, backgroundPosition: '0 0' },
    { opacity: 1, offset: .2 },
    { opacity: 1, offset: .84 },
    { opacity: 0, backgroundPosition: '0 520px' },
  ], { duration: 960 / speed, delay: 240 / speed, fill: 'both' });
  setTimeout(() => { spawnSeismicRocks(tSide); if (onImpact) onImpact(); }, 490 / speed);
  setTimeout(spawnSeismicRocks, 650 / speed, tSide);
  return new Promise((resolve) => {
    setTimeout(() => {
      anim.cancel();
      squash.cancel();
      atk.style.transform = '';
      atk.style.visibility = '';
      lowerAttacker(side);
      bg.remove();
      resolve();
    }, 1210 / speed);
  });
}
// 充电：小电球环绕自身螺旋上升，最后聚成大光球
function spawnChargeFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const orbUrl = new URL('./move-fx-assets/pe/Gfx_ElectricOrbs__8x8.png', import.meta.url).href;
  for (let i = 0; i < 12; i++) {
    const size = 18 + rnd(0, 12);
    const a0 = (i / 12) * Math.PI * 2;
    const radius = 46 + rnd(0, 22);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${orbUrl})`;
    el.style.backgroundSize = `${size}px ${size * 4}px`;
    el.style.zIndex = '10';
    box.appendChild(el);
    let f = rnd(0, 3);
    const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * size}px`; }, 70 / speed);
    const a1 = a0 + Math.PI * 1.15;
    const a2 = a0 + Math.PI * 2.2;
    el.animate([
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a0) * radius).toFixed(1)}px, ${(Math.sin(a0) * radius * .55 + 46).toFixed(1)}px) scale(.6)`, opacity: 0 },
      { opacity: 1, offset: .14 },
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a1) * radius * .8).toFixed(1)}px, ${(Math.sin(a1) * radius * .4 + 8).toFixed(1)}px) scale(1)`, opacity: 1, offset: .48 },
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a2) * radius * .35).toFixed(1)}px, ${(Math.sin(a2) * radius * .25 - 58).toFixed(1)}px) scale(1.15)`, opacity: 0 },
    ], { duration: 820 / speed, delay: (i * 34) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, (940 + i * 34) / speed);
  }
  const orb = document.createElement('span');
  orb.className = 'fx-orig';
  orb.style.left = cx + 'px';
  orb.style.top = (cy - 12) + 'px';
  orb.style.width = '64px';
  orb.style.height = '64px';
  orb.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_CircleOfLight__64x64.png', import.meta.url).href})`;
  orb.style.backgroundSize = '64px 64px';
  orb.style.filter = 'drop-shadow(0 0 12px #ffe45c)';
  orb.style.zIndex = '11';
  box.appendChild(orb);
  orb.animate([
    { transform: 'translate(-50%,-50%) scale(.25)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: .45 },
    { transform: 'translate(-50%,-50%) scale(1.35)', opacity: 1, offset: .72 },
    { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
  ], { duration: 720 / speed, delay: 320 / speed, fill: 'both' });
  setTimeout(() => orb.remove(), 1100 / speed);
}
// 撒菱/毒菱：三根尖刺从对手上方落到脚边，毒菱用紫色滤镜
// 破坏光线：光段与小光球粒子同时发出，不再先粒子后光束
function spawnHyperBeamParticles(side, tSide) {
  const from = $(`${side}-img`);
  const to = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = 0.4;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  const url = new URL('./move-fx-assets/pe/Gfx_Orbs__8x8.png', import.meta.url).href;
  for (let i = 0; i < 14; i++) {
    const size = 10 + rnd(0, 7);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 4}px`;
    el.style.backgroundPosition = `0 -${rnd(0, 3) * size}px`;
    el.style.filter = 'sepia(1) saturate(3) hue-rotate(-12deg) brightness(1.15)';
    el.style.zIndex = '9';
    box.appendChild(el);
    let f = rnd(0, 3);
    const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * size}px`; }, 55 / speed);
    const tx = ex + rnd(-10, 10);
    const ty = ey + rnd(-8, 8);
    el.animate([
      { transform: 'translate(-50%,-50%) translate(0,0) scale(.5)', opacity: 0 },
      { opacity: 1, offset: .12 },
      { transform: `translate(calc(-50% + ${(tx - sx).toFixed(1)}px), calc(-50% + ${(ty - sy).toFixed(1)}px)) scale(1)`, opacity: 0 },
    ], { duration: 380 / speed, delay: (i * 18) / speed, easing: 'linear', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, (430 + i * 18) / speed);
  }
}
// 恶之波动：四帧紫焰从施法者中心向外扩散
function spawnDarkPulseFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = new URL('./move-fx-assets/pe/Gfx_PurpleFlame__16x32.png', import.meta.url).href;
  for (let wave = 0; wave < 3; wave++) {
    for (let i = 0; i < 8; i++) {
      const w = 16 + rnd(0, 6);
      const h = w * 2;
      const ang = (i / 8) * Math.PI * 2 + wave * 0.3 + Math.random() * 0.2;
      const dist = 56 + wave * 26 + rnd(0, 22);
      const el = document.createElement('span');
      el.className = 'fx-orig';
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = `${w}px ${h * 4}px`;
      el.style.backgroundPosition = '0 0';
      el.style.filter = 'drop-shadow(0 0 5px #b35cff)';
      el.style.zIndex = '9';
      box.appendChild(el);
      let f = rnd(0, 3);
      const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * h}px`; }, 65 / speed);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist * 0.8;
      const rot = (ang * 180) / Math.PI + 90;
      el.animate([
        { transform: `translate(-50%,-50%) rotate(${rot.toFixed(1)}deg) scale(.55)`, opacity: 0 },
        { opacity: 1, offset: .12 },
        { transform: `translate(calc(-50% + ${(dx * .55).toFixed(1)}px), calc(-50% + ${(dy * .55).toFixed(1)}px)) rotate(${rot.toFixed(1)}deg) scale(1)`, opacity: 1, offset: .5 },
        { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${rot.toFixed(1)}deg) scale(1.15)`, opacity: 0 },
      ], { duration: 520 / speed, delay: (wave * 75 + i * 10) / speed, easing: 'ease-out', fill: 'both' });
      setTimeout(() => { clearInterval(timer); el.remove(); }, (820 + wave * 75 + i * 10) / speed);
    }
  }
}
// 喷出：自身短暂压扁蓄力，回弹时以自身为中心爆出多圈橙黄色光球
function spawnSpitUpFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  img.animate([
    { transform: 'scale(1,1)' },
    { transform: 'scale(1.16,.72)', offset: .3 },
    { transform: 'scale(.95,1.12)', offset: .58 },
    { transform: 'scale(1,1)' },
  ], { duration: 420, easing: 'ease-out' });
  const url = new URL('./move-fx-assets/pe/Gfx_Orbs__8x8.png', import.meta.url).href;
  for (let wave = 0; wave < 3; wave++) {
    for (let i = 0; i < 9; i++) {
      const size = 10 + rnd(0, 7);
      const ang = (i / 9) * Math.PI * 2 + wave * 0.35 + Math.random() * 0.15;
      const dist = 64 + wave * 24 + rnd(0, 24);
      const el = document.createElement('span');
      el.className = 'fx-orig';
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = `${size}px ${size * 4}px`;
      el.style.backgroundPosition = `0 -${rnd(0, 3) * size}px`;
      el.style.filter = 'sepia(1) saturate(3) hue-rotate(-12deg) brightness(1.18)';
      el.style.zIndex = '9';
      box.appendChild(el);
      let f = rnd(0, 3);
      const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * size}px`; }, 55 / speed);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist * 0.8;
      el.animate([
        { transform: 'translate(-50%,-50%) translate(0,0) scale(.45)', opacity: 0 },
        { opacity: 1, offset: .12 },
        { transform: `translate(calc(-50% + ${(dx * .55).toFixed(1)}px), calc(-50% + ${(dy * .55).toFixed(1)}px)) scale(1)`, opacity: 1, offset: .5 },
        { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1.65)`, opacity: 0 },
      ], { duration: 520 / speed, delay: (wave * 80 + i * 10) / speed, easing: 'ease-out', fill: 'both' });
      setTimeout(() => { clearInterval(timer); el.remove(); }, (820 + wave * 80 + i * 10) / speed);
    }
  }
}
// 拳类招式通用拳头素材
function spawnImpactBg(tSide) {
  const field = stage();
  if (!field) return;
  const file = tSide === 'be' ? 'bg_impact_opponent.png' : 'bg_impact_player.png';
  const el = document.createElement('span');
  el.className = 'b-impact-bg';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/bg/' + file, import.meta.url).href})`;
  field.appendChild(el);
  setTimeout(() => el.remove(), 760 / speed);
}
function spawnPunchFist(tSide, opts = {}) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const size = opts.size || 30;
  const count = opts.count || 1;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (ir.left - br.left + ir.width / 2 + (i ? 12 : -8)) + 'px';
    el.style.top = (ir.top - br.top + ir.height * 0.42 + (i ? -6 : 6)) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_HandsAndFeet__32x32.png', import.meta.url).href})`;
    el.style.backgroundSize = `${size}px ${size * 4}px`;
    el.style.backgroundPosition = '0 0';
    el.style.zIndex = '10';
    box.appendChild(el);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.45) rotate(-8deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.08) rotate(4deg)', opacity: 1, offset: .22 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 0 },
    ], { duration: 260 / speed, delay: (i * 90) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), (310 + i * 90) / speed);
  }
}
// 暗影爪/克命爪：复用金属爪的 Gfx_ClawSlash 五帧爪痕
function spawnClawSlashFx(tSide, color) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const size = 54;
  const url = `url(${new URL('./move-fx-assets/pe/Gfx_ClawSlash__32x32.png', import.meta.url).href})`;
  for (let i = 0; i < 2; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
    el.style.top = (ir.top - br.top + ir.height * 0.46) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = `${size}px ${size * 5}px`;
    el.style.backgroundPosition = '0 0';
    el.style.zIndex = '10';
    if (color) el.style.filter = `drop-shadow(0 0 5px ${color})`;
    box.appendChild(el);
    let f = 0;
    const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * size}px`; }, 55 / speed);
    const rot = i ? 24 : -24;
    el.animate([
      { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(.75)`, opacity: 0 },
      { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(1.15)`, opacity: 1, offset: .25 },
      { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(1.05)`, opacity: 0 },
    ], { duration: 320 / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 370 / speed);
  }
}
// 贝壳刃：Sparkle4 第四个分片作为斩击特效
function spawnSparkleSlash(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height * 0.46) + 'px';
  el.style.width = '52px';
  el.style.height = '52px';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_Sparkle4__32x32.png', import.meta.url).href})`;
  el.style.backgroundSize = '52px 260px';
  el.style.backgroundPosition = '0 -156px';
  el.style.zIndex = '10';
  box.appendChild(el);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.45) rotate(-35deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.16) rotate(-10deg)', opacity: 1, offset: .24 },
    { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 0 },
  ], { duration: 300 / speed, easing: 'ease-out', fill: 'both' });
  setTimeout(() => el.remove(), 340 / speed);
}
// 拍击/连环巴掌：Gfx_TagHand 上半部分的手掌从上方拍向目标
function spawnTagHandStrike(tSide, index = 0) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.46;
  const size = 40;
  const dir = index % 2 ? -1 : 1;
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = (cx + dir * 6) + 'px';
  el.style.top = (cy + 3) + 'px';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_TagHand__32x32.png', import.meta.url).href})`;
  el.style.backgroundSize = `${size}px ${size * 2}px`;
  el.style.backgroundPosition = '0 0';
  el.style.zIndex = '10';
  box.appendChild(el);
  el.animate([
    { transform: `translate(-50%,-120%) translateX(${dir * -10}px) rotate(${dir * -10}deg) scale(.8)`, opacity: 0 },
    { transform: `translate(-50%,-50%) rotate(${dir * 4}deg) scale(1.08)`, opacity: 1, offset: .35 },
    { transform: 'translate(-50%,-50%) rotate(0deg) scale(1)', opacity: 0 },
  ], { duration: 300 / speed, delay: (index * 55) / speed, easing: 'ease-out', fill: 'both' });
  setTimeout(() => el.remove(), (380 + index * 55) / speed);
}
// 再来一次：下方手掌固定，上方手掌出现/隐藏三次，并撒彩带
function spawnEncoreClap(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.46;
  const size = 40;
  const handUrl = `url(${new URL('./move-fx-assets/pe/Gfx_TagHand__32x32.png', import.meta.url).href})`;
  const makeHand = (top) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = cx + 'px';
    el.style.top = top + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = handUrl;
    el.style.backgroundSize = `${size}px ${size * 2}px`;
    el.style.backgroundPosition = '0 0';
    el.style.zIndex = '10';
    el.style.transform = 'translate(-50%,-50%)';
    box.appendChild(el);
    return el;
  };
  const lower = makeHand(cy + 18);
  const upper = makeHand(cy - 8);
  upper.animate([
    { transform: 'translate(-50%,-50%) translateY(-18px) scale(.9)', opacity: 0 },
    { transform: 'translate(-50%,-50%) translateY(0) scale(1)', opacity: 1, offset: .2 },
    { transform: 'translate(-50%,-50%) translateY(0) scale(1)', opacity: 1, offset: .55 },
    { transform: 'translate(-50%,-50%) translateY(3px) scale(1)', opacity: 0, offset: .8 },
    { transform: 'translate(-50%,-50%) translateY(3px) scale(1)', opacity: 0 },
  ], { duration: 300 / speed, delay: 80 / speed, iterations: 3, easing: 'ease-in-out', fill: 'both' });
  const confettiUrl = new URL('./move-fx-assets/pe/Gfx_Confetti__8x8.png', import.meta.url).href;
  for (let i = 0; i < 10; i++) {
    const sizeC = 9 + rnd(0, 5);
    const p = document.createElement('span');
    p.className = 'fx-orig';
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.width = sizeC + 'px';
    p.style.height = sizeC + 'px';
    p.style.backgroundImage = `url(${confettiUrl})`;
    p.style.backgroundSize = `${sizeC}px ${sizeC * 12}px`;
    p.style.backgroundPosition = `0 -${rnd(0, 11) * sizeC}px`;
    p.style.zIndex = '9';
    box.appendChild(p);
    const dx = rnd(-42, 42);
    const dy = -42 - rnd(0, 38);
    const rot = rnd(-180, 180);
    p.animate([
      { transform: 'translate(-50%,-50%) scale(.6) rotate(0deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * .35}px), calc(-50% + ${dy * .35}px)) scale(1) rotate(${rot * .4}deg)`, opacity: 1, offset: .25 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.8) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: 650 / speed, delay: (120 + i * 25) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => p.remove(), (840 + i * 25) / speed);
  }
  setTimeout(() => { lower.remove(); upper.remove(); }, 1100 / speed);
}
// 吸取拳：命中后绿色光球从目标吸回自身
// 吸取拳：绿色光球沿目标到自身的连线依次吸回
// 吸取拳吸取段：复用吸取的大光球，从目标沿直线吸回施放者
function spawnDrainOrbs(fromSide, toSide) {
  const box = $(`${fromSide}-box`);
  const from = $(`${fromSide}-img`);
  const to = $(`${toSide}-img`);
  if (!box || !from || !to) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.42;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.42;
  const dx = ex - sx, dy = ey - sy;
  const url = new URL('./move-fx-assets/pe/Gfx_Orbs__16x16.png', import.meta.url).href;
  for (let i = 0; i < 8; i++) {
    const size = 20 + rnd(0, 9);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 3}px`;
    el.style.backgroundPosition = `0 -${size * 2}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    const ox = rnd(-18, 18), oy = rnd(-14, 14);
    el.animate([
      { transform: `translate(-50%,-50%) translate(${ox}px, ${oy}px) scale(.55)`, opacity: 0 },
      { opacity: 1, offset: .15 },
      { transform: `translate(calc(-50% + ${(dx * .5).toFixed(1)}px), calc(-50% + ${(dy * .5).toFixed(1)}px)) scale(1)`, opacity: 1, offset: .52 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1.2)`, opacity: 0 },
    ], { duration: 500 / speed, delay: (i * 42) / speed, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), (560 + i * 42) / speed);
  }
}
// 斜向光束（破坏光线）：白芯光束 + 起点几颗光球
function spawnCrossBeamFx(side, tSide, color) {
  const field = stage();
  const atk = $(`${side}-img`);
  const tgt = $(`${tSide}-img`);
  if (!field || !atk || !tgt) return;
  const br = field.getBoundingClientRect();
  const ar = atk.getBoundingClientRect();
  const tr = tgt.getBoundingClientRect();
  const x1 = ar.left - br.left + ar.width / 2;
  const y1 = ar.top - br.top + ar.height * 0.48;
  const x2 = tr.left - br.left + tr.width / 2;
  const y2 = tr.top - br.top + tr.height * 0.48;
  const len = Math.max(8, Math.hypot(x2 - x1, y2 - y1));
  const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  const beam = document.createElement('span');
  beam.className = 'fx-beam';
  beam.style.setProperty('--beam', color);
  beam.style.left = x1 + 'px';
  beam.style.top = (y1 - 6) + 'px';
  beam.style.transform = `rotate(${ang}deg)`;
  field.appendChild(beam);
  beam.animate([
    { width: '0px', opacity: 0 },
    { width: (len * 0.72).toFixed(1) + 'px', opacity: 1, offset: 0.2 },
    { width: len.toFixed(1) + 'px', opacity: 1, offset: 0.48 },
    { width: len.toFixed(1) + 'px', opacity: 0 },
  ], { duration: 560 / speed, easing: 'ease-out', fill: 'both' });
  setTimeout(() => beam.remove(), 700 / speed);
  const url = new URL('./move-fx-assets/pe/Gfx_Orbs__16x16.png', import.meta.url).href;
  for (let i = 0; i < 4; i++) {
    const size = 18 + rnd(0, 8);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (x1 + rnd(-18, 18)) + 'px';
    el.style.top = (y1 + rnd(-18, 18)) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 3}px`;
    el.style.backgroundPosition = `0 -${size * 2}px`;
    el.style.zIndex = '9';
    field.appendChild(el);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { opacity: 1, offset: .2 },
      { transform: `translate(calc(-50% + ${((x2 - x1) * .35).toFixed(1)}px), calc(-50% + ${((y2 - y1) * .35).toFixed(1)}px)) scale(1.1)`, opacity: 0 },
    ], { duration: 480 / speed, delay: (i * 45) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), (560 + i * 45) / speed);
  }
}
function spawnSmokeScreen(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.42;
  const url = `url(${new URL('./move-fx-assets/pe/Gfx_GraySmoke__32x32.png', import.meta.url).href})`;
  for (let i = 0; i < 9; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    const w = 42 + rnd(0, 20);
    el.style.width = w + 'px';
    el.style.height = w + 'px';
    el.style.left = (cx + rnd(-Math.round(ir.width * 0.34), Math.round(ir.width * 0.34))) + 'px';
    el.style.top = (cy + rnd(-Math.round(ir.height * 0.3), Math.round(ir.height * 0.08))) + 'px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = `${w}px ${w * 5}px`;
    el.style.filter = 'brightness(.34) saturate(.15)';
    el.style.zIndex = '10';
    el.style.opacity = '0';
    box.appendChild(el);
    let f = rnd(0, 4);
    const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * w}px`; }, 80 / speed);
    const dur = (520 + rnd(0, 160)) / speed;
    el.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.7)' },
      { opacity: .95, offset: .18 },
      { opacity: .82, offset: .55 },
      { opacity: .9, offset: .78 },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.08)' },
    ], { duration: dur, fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, dur + 40);
  }
  const imp = document.createElement('span');
  imp.className = 'fx-orig';
  imp.style.left = cx + 'px';
  imp.style.top = cy + 'px';
  imp.style.width = '28px';
  imp.style.height = '28px';
  imp.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_SmokescreenImpact__16x16.png', import.meta.url).href})`;
  imp.style.backgroundSize = '28px 84px';
  imp.style.zIndex = '11';
  box.appendChild(imp);
  let f = 0;
  const timer = setInterval(() => { f = (f + 1) % 3; imp.style.backgroundPosition = `0 -${f * 28}px`; }, 55 / speed);
  setTimeout(() => { clearInterval(timer); imp.remove(); }, 220 / speed);
}
// 电击波：8x8 电花从攻击方连成一串冲向目标
function spawnShockWaveFx(atkSide, tSide) {
  const box = $(`${tSide}-box`);
  const atk = $(`${atkSide}-img`);
  const tgt = $(`${tSide}-img`);
  if (!box || !atk || !tgt) return;
  const br = box.getBoundingClientRect();
  const ar = atk.getBoundingClientRect();
  const tr = tgt.getBoundingClientRect();
  const ax = ar.left - br.left + ar.width / 2;
  const ay = ar.top - br.top + ar.height / 2;
  const tx = tr.left - br.left + tr.width / 2;
  const ty = tr.top - br.top + tr.height / 2;
  const url = `url(${new URL('./move-fx-assets/pe/Gfx_Spark__8x8.png', import.meta.url).href})`;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.zIndex = '9';
    el.style.width = '12px';
    el.style.height = '12px';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = url;
    el.style.backgroundSize = '12px 432px';
    el.style.backgroundPosition = `0 -${rnd(0, 35) * 12}px`;
    el.style.left = (ax + (tx - ax) * k + (i % 2 ? -1 : 1) * rnd(7, 14)) + 'px';
    el.style.top = (ay + (ty - ay) * k + (i % 2 ? -1 : 1) * rnd(6, 12)) + 'px';
    el.style.transform = 'translate(-50%,-50%)';
    box.appendChild(el);
    el.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' },
      { opacity: 1, offset: .25, transform: 'translate(-50%,-50%) scale(1.15)' },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.8)' },
    ], { duration: 170 / speed, delay: i * 24 / speed, fill: 'both' });
    setTimeout(() => el.remove(), (220 + i * 24) / speed);
  }
  setTimeout(() => spawnLightningStrike(tSide, 0), 320 / speed);
}
// 连续抓痕：乱抓等多段爪击只重复抓痕
function spawnFurySwipes(tSide, hits) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = `url(${new URL('./move-fx-assets/pe/Gfx_Swipe__32x32.png', import.meta.url).href})`;
  const total = Math.max(2, hits * 2);
  for (let i = 0; i < total; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + (i % 2 ? -1 : 1) * rnd(6, 18)) + 'px';
    el.style.top = (cy + rnd(-14, 14)) + 'px';
    el.style.width = '36px';
    el.style.height = '36px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = '36px 180px';
    el.style.zIndex = '10';
    box.appendChild(el);
    el.animate([
      { opacity: 0, transform: `translate(-50%,-50%) scaleX(${i % 2 ? -1 : 1}) scale(.8)` },
      { opacity: 1, offset: .2, transform: `translate(-50%,-50%) scaleX(${i % 2 ? -1 : 1}) scale(1.15)` },
      { opacity: 0, transform: `translate(-50%,-50%) scaleX(${i % 2 ? -1 : 1}) scale(1)` },
    ], { duration: 300 / speed, delay: i * 105 / speed, fill: 'both' });
    let f = 0;
    const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * 36}px`; }, 42 / speed);
    setTimeout(() => { clearInterval(timer); el.remove(); }, (320 + i * 105) / speed);
  }
}
function spawnPoisonOrbBurst(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = new URL('./move-fx-assets/pe/Gfx_WaterOrb__16x16.png', import.meta.url).href;
  for (let i = 0; i < 7; i++) {
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.zIndex = '9';
    el.style.width = '18px';
    el.style.height = '18px';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = '18px 72px';
    el.style.filter = 'hue-rotate(70deg) saturate(2.2) brightness(.8) drop-shadow(0 0 4px #b35cff)';
    box.appendChild(el);
    let frame = 0;
    const timer = setInterval(() => {
      frame = (frame + 1) % 4;
      el.style.backgroundPosition = `0 -${frame * 18}px`;
    }, 70 / speed);
    const ang = (i / 7) * Math.PI * 2 + Math.random() * 0.45;
    const dist = 18 + Math.random() * 20;
    const delay = i * 24;
    el.animate([
      { transform: 'translate(-50%, -50%) scale(.45)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist * .45).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist * .45 - 8).toFixed(1)}px)) scale(1)`, opacity: 1, offset: .3 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist).toFixed(1)}px)) scale(.7)`, opacity: 0 },
    ], { duration: 430 / speed, delay: delay / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, (440 + delay) / speed);
  }
}
function spawnFangParticles(tSide, name) {
  if (name === '雷电牙') {
    spawnVoltFlash();
    spawnLightningAsset(tSide, 0);
    return;
  }
  if (name === '剧毒牙') {
    spawnPoisonOrbBurst(tSide);
    return;
  }
  if (name === '火焰牙') {
    spawnFireBurst(tSide);
    return;
  }
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const color = FANG_COLORS[name] || '#9beeff';
  const n = 7;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.position = 'absolute';
    p.style.zIndex = '9';
    p.style.pointerEvents = 'none';
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    const sz = 9 + Math.random() * 7;
    p.style.width = sz + 'px';
    p.style.height = sz * 1.35 + 'px';
    p.style.background = `linear-gradient(135deg, #f2ffff 0%, ${color} 35%, ${color} 75%, ${color}22 100%)`;
    p.style.clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
    p.style.filter = `drop-shadow(0 0 3px ${color})`;
    box.appendChild(p);
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 16 + Math.random() * 18;
    p.animate([
      { transform: 'translate(-50%, -50%) scale(.35) rotate(-20deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist).toFixed(1)}px)) scale(1) rotate(20deg)`, opacity: 1, offset: .35 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist * 1.15).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist * 1.15).toFixed(1)}px)) scale(.6) rotate(50deg)`, opacity: 0 },
    ], { duration: 420 / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => p.remove(), 460 / speed);
  }
}

function spawnHyperFangBurst(tSide = 'be') {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  for (let i = 0; i < 7; i++) {
    const el = document.createElement('span');
    el.className = 'b-hyper-particle';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    box.appendChild(el);
    const ang = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 18 + Math.random() * 24;
    el.animate([
      { transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist).toFixed(1)}px)) scale(1)`, opacity: 1, offset: 0.4 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist * 1.35).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist * 1.35).toFixed(1)}px)) scale(.5)`, opacity: 0 },
    ], { duration: 500 / speed, delay: (i * 18) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), 580 / speed);
  }
}

function spawnHyperFangTeeth(tSide = 'be') {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  el.style.width = '32px';
  el.style.height = '32px';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_FangAttack__32x32.png', import.meta.url).href})`;
  el.style.backgroundSize = '32px 128px';
  el.style.backgroundPosition = '0 0';
  el.style.zIndex = '12';
  box.appendChild(el);
  let frame = 0;
  el._origTimer = setInterval(() => {
    frame = (frame + 1) % 4;
    el.style.backgroundPosition = `0 -${frame * 32}px`;
  }, 55 / speed);
  el.animate([
    { transform: 'translate(-50%, -50%) scale(.65)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.28 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
  ], { duration: 300 / speed, easing: 'ease-out', fill: 'both' });
  setTimeout(() => removeOrig(el), 340 / speed);
}

function spawnSlashFx(targetSide = 'be') {
  const box = $(`${targetSide}-box`);
  const img = $(`${targetSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  for (const dx of [-9, 9]) {
    const el = origEl('slash');
    el.style.left = (cx + dx) + 'px';
    el.style.top = cy + 'px';
    el.style.transform = 'translate(-50%, -50%) scale(1.05)';
    box.appendChild(el);
    startOrigSheet(el, ORIG.slash);
    el.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.8)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.05)', offset: 0.3 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.15)' },
    ], { duration: 300 / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => removeOrig(el), 340 / speed);
  }
}

function spawnOrigImpact(side, color = null) {
  return spawnOrigStatic('impact', side, 1.15, 260, color);
}
function spawnWaterImpact(tSide) {
  const img = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!img || !box) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const el = document.createElement('span');
  el.style.position = 'absolute';
  el.style.zIndex = '9';
  el.style.width = '32px';
  el.style.height = '32px';
  el.style.pointerEvents = 'none';
  el.style.imageRendering = 'pixelated';
  el.style.backgroundImage = `url(${new URL('./move-fx-assets/pe/Gfx_WaterImpact__32x32.png', import.meta.url).href})`;
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  box.appendChild(el);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.55)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.35)', opacity: 1, offset: .3 },
    { transform: 'translate(-50%,-50%) scale(1.55)', opacity: 0 },
  ], { duration: 280 / speed, easing: 'ease-out', fill: 'both' });
  setTimeout(() => el.remove(), 320 / speed);
}
// 蟹钳锤小气泡：原作 gSmallBubblePair（Gfx_IceCrystals 第 12/13 帧）围目标错峰上浮
function spawnSmallBubblesFx(tSide) {
  const img = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!img || !box) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = `url(${new URL('./move-fx-assets/pe/Gfx_IceCrystals__8x8.png', import.meta.url).href})`;
  const offs = [[10, 10], [20, -20], [-15, 15], [0, 0], [-10, -20], [16, -8], [5, 8], [-16, 0]];
  offs.forEach(([ox, oy], i) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + ox) + 'px';
    el.style.top = (cy + oy) + 'px';
    el.style.width = '10px';
    el.style.height = '10px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = '10px 140px';
    el.style.zIndex = '10';
    box.appendChild(el);
    let frame = 12;
    const timer = setInterval(() => {
      frame = frame === 12 ? 13 : 12;
      el.style.backgroundPosition = `0 -${frame * 10}px`;
    }, 70 / speed);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { opacity: 1, offset: .2 },
      { transform: `translate(calc(-50% + ${(Math.random() * 8 - 4).toFixed(1)}px), calc(-50% - ${20 + Math.random() * 14}px)) scale(1)`, opacity: 0 },
    ], { duration: 520 / speed, delay: (i * 40) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, (560 + i * 40) / speed);
  });
}
function spawnImpactTint(side, color) {
  if (!color) return;
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'b-impact-tint';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  el.style.background = `radial-gradient(circle, ${color} 0%, ${color}66 38%, transparent 70%)`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 340);
}
function spawnFireBurst(side) {
  const spec = ORIG.firePlume;
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!spec || !box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  for (let i = 0; i < 7; i++) {
    const el = origEl('firePlume', rnd(0, spec.frames - 1));
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    box.appendChild(el);
    startOrigSheet(el, spec);
    const ang = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 30;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - 8;
    const s0 = .45 + Math.random() * .3;
    const s1 = .8 + Math.random() * .5;
    el.animate([
      { transform: `translate(-50%,-50%) scale(${s0})`, opacity: 0 },
      { transform: `translate(calc(-50% + ${(dx * .45).toFixed(1)}px), calc(-50% + ${(dy * .45).toFixed(1)}px)) scale(${s1})`, opacity: 1, offset: .35 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(${s0})`, opacity: 0 },
    ], { duration: (300 + Math.random() * 120) / speed, easing: 'ease-out', fill: 'both' });
    setTimeout(() => removeOrig(el), 520 / speed);
  }
}
function spawnBrineRain(tSide) {
  const spec = ORIG.bubble;
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!spec || !box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const top = ir.top - br.top;
  const fall = ir.height * 0.55 + 8;
  for (let i = 0; i < 10; i++) {
    const el = origEl('bubble', rnd(0, spec.frames - 1));
    el.style.left = (cx + rnd(-24, 24)) + 'px';
    el.style.top = (top - 70 - rnd(0, 40)) + 'px';
    box.appendChild(el);
    startOrigSheet(el, spec);
    const dur = (360 + rnd(0, 140)) / speed;
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.75)', opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: `translate(-50%, calc(-50% + ${fall.toFixed(0)}px)) scale(1)`, opacity: 0 },
    ], { duration: dur, delay: (i * 35) / speed, easing: 'ease-in', fill: 'both' });
    setTimeout(() => spawnWaterImpact(tSide), dur + (i * 35) / speed + 40);
    setTimeout(() => removeOrig(el), dur + (i * 35) / speed + 80);
  }
}
function spawnAquaRing(side) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const host = document.createElement('span');
  host.className = 'b-aqua-ring';
  host.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  host.style.top = (ir.top - br.top + ir.height * 0.5) + 'px';
  box.appendChild(host);
  const band = document.createElement('span');
  band.className = 'aqua-band';
  host.appendChild(band);
  const drops = [];
  for (let i = 0; i < 10; i++) {
    const el = document.createElement('span');
    el.className = 'aqua-drop';
    host.appendChild(el);
    drops.push({ el, phase: (i / 10) * Math.PI * 2 });
  }
  const start = performance.now();
  const dur = 900 / speed;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const spin = t * Math.PI * 2 * 1.15;
    for (const d of drops) {
      const ang = spin + d.phase;
      const x = Math.cos(ang) * 34;
      const y = Math.sin(ang) * 13 + Math.sin(ang * 2) * 2;
      d.el.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px))`;
    }
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(() => host.remove(), 980 / speed);
}

function showShield(side) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  // 与游戏一致：用布局坐标定位，避免预览页 scale(2) 下 rect 放大导致环又大又偏
  const flip = side === 'bp' ? img.closest('.b-flip') : null;
  const cx = (flip ? flip.offsetLeft + img.offsetLeft : img.offsetLeft) + img.offsetWidth / 2;
  const cy = (flip ? flip.offsetTop + img.offsetTop : img.offsetTop) + img.offsetHeight / 2;
  const w = img.offsetWidth;
  const h = img.offsetHeight;
  const fx = document.createElement('span');
  fx.className = 'b-shield';
  fx.style.left = cx + 'px';
  fx.style.top = cy + 'px';
  const ringW = Math.max(28, Math.min(80, w * 0.78));
  const ringH = Math.min(ringW / 2, Math.max(7, h * 0.24));
  const n = 6;
  const span = Math.min(h * 0.7, ringH * 2.2);
  const step = span / (n - 1);
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'b-shield-ring';
    p.style.width = ringW + 'px';
    p.style.height = ringH + 'px';
    p.style.top = (step * ((n - 1) / 2 - i)) + 'px';
    p.style.opacity = '0';
    p.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(0.7)' },
      { opacity: 0.9, transform: 'translate(-50%,-50%) scale(1)', offset: 0.6 },
      { opacity: 0.9, transform: 'translate(-50%,-50%) scale(1.02)' },
    ], { duration: 170 / speed, delay: (i * 90) / speed, easing: 'ease-out', fill: 'both' });
    fx.appendChild(p);
  }
  box.appendChild(fx);
  const hold = ((n - 1) * 90 + 170 + 140) / speed;
  const fadeDur = 220 / speed;
  const fade = fx.animate([
    { opacity: 1 },
    { opacity: 1, offset: hold / (hold + fadeDur) },
    { opacity: 0 },
  ], { duration: hold + fadeDur, easing: 'linear' });
  fade.onfinish = () => { fx.style.opacity = '0'; };
  setTimeout(() => fx.remove(), hold + fadeDur + 300);
}
function stageShake() {
  const st = stage();
  if (!st) return;
  st.classList.remove('battle-shake');
  void st.offsetWidth;
  st.classList.add('battle-shake');
  setTimeout(() => st.classList.remove('battle-shake'), 500);
}
function quakeAttack(side) {
  const img = $(`${side}-img`);
  if (img) {
    img.classList.remove('quake-hop');
    void img.offsetWidth;
    img.classList.add('quake-hop');
    setTimeout(() => img.classList.remove('quake-hop'), 450);
  }
  setTimeout(stageShake, 300);
}
function playChargeEnter(side, mvName) {
  const el = $(`${side}-img`);
  if (!el) return;
  resetAnim(el);
  void el.offsetWidth;
  el.classList.add(CHARGE_ENTER_CLS[mvName] || 'cg-vanish');
  el.dataset.charged = CHARGE_HIDES[mvName] ? '1' : '';
  if (mvName === '挖洞') spawnGroundBurst(side, '#b98f5e', 9);
  else if (mvName === '潜水') spawnGroundBurst(side, '#7fd0f5', 7);
}

function clearFx() {
  emerald?.stop();
  const root = stage();
  if (!root) return;
  const sel = '.b-dmg,.b-spark,.b-type-fx,.b-proj-fx,.b-light-fx,.b-solar-fx,.b-lightning-fx,.b-rock-fx,.b-snow-fx,.b-sonic-fx,.b-beam-fx,.b-fairy-fx,.b-water-fx,.b-surf-fx,.fx-orbit-back,.fx-orbit-front,.b-charge-asset,.b-charge-clone,.b-wind-fx,.b-dragon-fx,.b-psy-fx,.b-ground-fx,.b-shield,.b-status-fx,.fx-spark-asset,.fx-poison-bubble';
  root.querySelectorAll(sel).forEach((el) => el.remove());
  root.classList.remove('battle-shake');
  for (const side of ['bp', 'be']) {
    const img = $(`${side}-img`);
    if (img) {
      resetAnim(img);
      img.classList.remove('quake-hop', 'b-burn-flash');
      img.dataset.charged = '';
      img.style.removeProperty('--lunge-dx');
      img.style.removeProperty('--lunge-dy');
      img.style.zIndex = '';
    }
    const flip = $(`${side}-box`)?.querySelector('.b-flip');
    if (flip) flip.style.zIndex = '';
  }
}

async function impact(mv, tailScale = 1, tgt = 'be') {
  const self = tgt === 'be' ? 'bp' : 'be';
  const tgtName = tgt === 'be' ? E_NAME : P_NAME;
  const kind = mv.effect?.kind;
  const color = IMPACT_TINT_TYPES.has(mv.type) ? (TYPE_COLORS[mv.type] || null) : null;
  if (!DMG_KINDS.has(kind)) {
    spawnTypeFx(tgt, mv.type);
    setText(`${tgtName}受到了${mv.name}的影响`);
    await sleep(350);
    return;
  }
  if (origOn()) {
    if (mv.name === '喷射火焰' || mv.name === '喷火') spawnOrigStatic('firePlume', tgt, .7, 260, color);
    else spawnOrigImpact(tgt, color);
  } else {
    spawnHitSpark(tgt);
    spawnTypeFx(tgt, mv.type);
  }
  if (FIRE_IMPACT.has(mv.name) || mv.type === '火') spawnFireBurst(tgt);
  if (mv.type === '超能') spawnPsychicWrap(tgt);
  spawnImpactTint(tgt, color);
  flashHitPanel(tgt);
  shake(tgt);
  popDmg(tgt, rnd(16, 30));
  if (kind === 'drain' && mv.name !== '吸取之吻') {
    spawnHealFx(self);
    popHeal(self, rnd(8, 14));
  }
  if (kind === 'recoil' || mv.name === '勇鸟猛攻' || mv.name === '舍身冲撞') {
    popDmg(self, rnd(4, 8));
  }
  if (kind === 'explode' || kind === 'finalGambit') {
    setTimeout(() => $(`${self}-img`)?.classList.add('faint'), 380);
  }
  await sleep(220 * tailScale);
  hideCosmicBg();
}

async function playAttack(mv, group, opp = false) {
  const phys = moveCat(mv) === 'phys';
  const cat = catOf(mv);
  const orig = origOn();
  const atkSide = opp ? 'be' : 'bp';
  const tSide = opp ? 'bp' : 'be';
  if (group === 'sound') {
    const selfSound = mv.effect?.target === 'self' || mv.effect?.kind === 'cure';
    spawnSoundWave(atkSide, selfSound ? atkSide : tSide);
    await sleep(320);
    if (selfSound) return;
  }
  else if (group === 'wind') {
    if (orig) { await wait(spawnOrigStream('gust', { count: 3, duration: 500, delay: 100, spread: 14, wave: 10, startScale: .8, endScale: 1.2, opacityStart: .75, opacityEnd: .45 }, atkSide, tSide)); }
    else { spawnWindTornado(atkSide, mv.name === '热风' ? '#ff5a3c' : mv.name === '妖精之风' ? '#f8669c' : mv.name === '冰冻之风' ? '#7fd0f5' : ''); await sleep(mv.name === '翅膀攻击' ? 500 : 430); }
  }
  else if (group === 'hotWater') {
    await wait(spawnOrigStream('water', { count: 7, duration: 520, delay: 48, spread: 12, wave: 3, startScale: .6, endScale: 1.05, opacityStart: .85, opacityEnd: .35 }, atkSide, tSide));
  }
  else if (group === 'water') { spawnWaterSweep(atkSide); await sleep(560); }
  else if (group === 'dragon') { spawnDragonWave(atkSide); await sleep(480); }
  else if (group === 'bubble') {
    if (orig) { await wait(spawnOrigStream('bubble', { count: 4, duration: 420, delay: 80, spread: 20, startScale: .5, endScale: .8, opacityStart: .75, opacityEnd: .55 }, atkSide, tSide)); }
    else { await spawnProjStream(atkSide, 'bubble'); }
  }
  else if (group === 'frostBreath') {
    await wait(spawnOrigStream('mist', { count: 9, duration: 620, delay: 42, spread: 16, wave: 5, startScale: .55, endScale: 1.35, opacityStart: .88, opacityEnd: .22 }, atkSide, tSide));
  }
  else if (group === 'star') {
    if (orig) { await wait(spawnOrigStream('star', { count: 4, duration: 360, delay: 75, spread: 24, spin: true, startScale: .6, endScale: 1, opacityStart: .65, opacityEnd: .35 }, atkSide, tSide)); }
    else { await spawnProjStream(atkSide, 'star'); }
  }
  else if (group === 'pebble') { await spawnProjStream(atkSide, 'pebble', mv.name === '掷泥' ? '#9C5A59' : '#D3A865'); }
  else if (group === 'ring') { await spawnProjStream(atkSide, 'ring', mv.name === '水炮' ? '#3F98EA' : '#F8669C'); }
  else if (group === 'psychic') { await sleep(480); }
  else if (group === 'confuse') { await spawnProjStream(atkSide, 'confuse'); }
  else if (group === 'fire') {
    if (orig) { await wait(spawnOrigStream('fire', { count: 4, duration: 450, delay: 80, spread: 10, startScale: .55, endScale: .9, opacityStart: .75, opacityEnd: .55 }, atkSide, tSide)); }
    else { await spawnProjStream(atkSide, 'flame', '#ff7a2e'); }
  }
  else if (group === 'acid') { await spawnProjStream(atkSide, 'acid', TYPE_COLORS['毒']); }
  else if (group === 'screen') { spawnScreenFlash(); await sleep(320); }
  else if (group === 'leaf') {
    if (orig && mv.name !== '花瓣舞') { await wait(spawnOrigStream('leaf', { count: 5, duration: 400, delay: 60, wave: 4, spin: true, startScale: .6, endScale: .85, opacityStart: .8, opacityEnd: .55 }, atkSide, tSide)); }
    else { await spawnProjStream(atkSide, 'leaf', mv.name === '花瓣舞' ? '#f8669c' : '#3fa129'); }
  }
  else if (group === 'ball') {
    if (orig && mv.name === '暗影球') {
      await wait(spawnOrigStream('blackBall', { count: 1, duration: 520, delay: 0, spread: 0, startScale: 2, endScale: 3, opacityStart: .8, opacityEnd: .5 }, atkSide, tSide));
    } else {
      const color = { '能量球': '#3fa129', '暗影球': '#7a52c9', '电球': '#ffd93b', '火焰球': '#ff7a2e', '火花': '#ff7a2e', '磷火': '#ff7a2e', '大字爆炎': '#ff7a2e', '意念头锤': '#F8669C', '污泥炸弹': '#8943B0', '击落': '#D3A865', '加农光炮': '#60a1b8' }[mv.name];
      await spawnProjStream(atkSide, 'ball', color, mv.name === '击落');
    }
  } else if (group === 'beam') { spawnLightSweep(atkSide); await sleep(350); }
  else if (group === 'iceBeam') { spawnIceBeam(atkSide); await sleep(360); }
  else if (group === 'solar') { spawnSolarBeam(tSide); await sleep(500); }
  else if (group === 'quake') { quakeAttack(atkSide); await sleep(400); }
  else if (group === 'rockSlide') {
    if (orig) { spawnOrigRocks(tSide, 6); await sleep(620); }
    else { spawnRockSlide(tSide); await sleep(520); }
  }
  else if (group === 'rockThrow') {
    if (orig) { spawnOrigRocks(tSide, 2); await sleep(620); }
    else { spawnRockDrop(tSide); await sleep(560); }
  }
  else if (group === 'snow') { spawnSnowSlide(tSide); await sleep(520); }
  else if (group === 'electric') {
    if (phys) lungeAttack(atkSide);
    if (orig) { await wait(spawnOrigStatic('electric', tSide, 1.6, 400)); }
    else { spawnLightningStrike(tSide, lightningVariant(mv)); await sleep(phys ? 430 : 400); }
    shake(tSide);
    popDmg(tSide, rnd(16, 30));
    return;
  } else if (group === 'drain') {
    if (phys) lungeAttack(atkSide); else lunge(atkSide);
    await sleep(phys ? 280 : 160);
    spawnDrainParticles(tSide, atkSide, '#7dc84a');
    await sleep(520);
    return; // 吸取类只播吸血粒子，不再补 impact
  } else if (group === 'rangedSingle') {
    raiseAttacker(atkSide);
    const x = RANGED_SINGLE[mv.name];
    await spawnProjOne(atkSide, x.shape, x.color);
    await sleep(120);
    lowerAttacker(atkSide);
  } else if (group === 'rangedMulti' || group === 'multiPhys') {
    const ranged = group === 'rangedMulti' ? RANGED_PHYS_MULTI[mv.name] : null;
    const tailScale = mv.effect?.kind === 'multihit' ? 0.72 : 1;
    for (let i = 0; i < 3; i++) {
      if (ranged) await spawnProjOne(atkSide, ranged.shape, ranged.color);
      else { lungeAttack(atkSide); await sleep(280 * tailScale); }
      await impact(mv, tailScale, tSide);
    }
    return;
  } else if (group === 'hotSand') {
    lunge(atkSide);
    await sleep(140);
    const d = spawnHotSand(mv.name, tSide);
    await wait(d / speed);
  } else if (phys) {
    lungeAttack(atkSide);
    await sleep(280);
  } else {
    lunge(atkSide);
    await sleep(160);
  }
  await impact(mv, 1, tSide);
}

async function playMove(mv) {
  if (busy) return;
  busy = true;
  try {
    clearFx();
    current = mv;
    highlight(mv);
    updateTitle(mv);
    if (mv.statusKind) {
      // 勾选「对手出招」时把状态动画施加到我方身上，方便预览
      const opp = $('fxOpp')?.checked === true;
      const tSide = opp ? 'bp' : 'be';
      if (mv.statusKind === 'confusion') {
        setText(`${opp ? P_NAME : E_NAME}混乱了！`);
        spawnDuckOrbit(tSide);
        await sleep(1000 / speed);
        return;
      }
      if (mv.statusKind === 'burn') {
        // 灼伤：身上常驻火苗贴图，再让精灵本体红光闪一下（与游戏实装一致）
        lunge(opp ? 'be' : 'bp');
        await sleep(160 / speed);
        setText(`${opp ? P_NAME : E_NAME}${mv.statusText}！`);
        showStatusFx(tSide, 'burn');
        spawnStatusFlash(tSide); // 红光闪烁 + 抖动（代替白色受击闪）
        await sleep(650 / speed);
      } else if (origOn() && emerald && emerald.hasStatus(mv.statusKind)) {
        setText(`${opp ? P_NAME : E_NAME}${mv.statusText}！`);
        await emerald.playStatus(mv.statusKind, { speed, targetSide: tSide });
      } else {
        lunge(opp ? 'be' : 'bp');
        await sleep(160 / speed);
        showStatusFx(tSide, mv.statusKind);
        setText(`${opp ? P_NAME : E_NAME}${mv.statusText}！`);
        await sleep(650 / speed);
      }
      return;
    }
    if (mv.name === '拍击') {
      const opp = $('fxOpp')?.checked === true;
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      await sleep(220 / speed);
      spawnTagHandStrike(tSide, 0);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      await sleep(300 / speed);
      return;
    }
    if (mv.name === '连环巴掌') {
      const opp = $('fxOpp')?.checked === true;
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      await sleep(220 / speed);
      for (let i = 0; i < 3; i++) {
        spawnTagHandStrike(tSide, i);
        shake(tSide);
        popDmg(tSide, rnd(8, 16));
        await sleep(170 / speed);
      }
      return;
    }
    if (mv.name === '再来一次') {
      const opp = $('fxOpp')?.checked === true;
      setText(`${opp ? E_NAME : P_NAME}接受了再来一次！`);
      spawnEncoreClap(opp ? 'bp' : 'be');
      await sleep(1100 / speed);
      return;
    }
    if (mv.name === '暗影爪' || mv.name === '克命爪') {
      const opp = $('fxOpp')?.checked === true;
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      await sleep(220 / speed);
      spawnClawSlashFx(tSide, mv.name === '暗影爪' ? '#9a6cd0' : '#b35cff');
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      await sleep(300 / speed);
      return;
    }
    if (mv.name === '大字爆炎') {
      const opp = $('fxOpp')?.checked === true;
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      await spawnFireBlastShot(atkSide);
      spawnFireBigExplosion(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      await sleep(380 / speed);
      return;
    }
    if (mv.name === '贝壳刃') {
      const opp = $('fxOpp')?.checked === true;
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      await sleep(220 / speed);
      spawnSparkleSlash(tSide);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      await sleep(300 / speed);
      return;
    }
    if (mv.name === '头锤' || mv.name === '火箭头锤') {
      const opp = $('fxOpp')?.checked === true;
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      await sleep(240 / speed);
      await impact(mv, 1, tSide);
      return;
    }
    if (mv.name === '百万吨重拳') {
      const opp = $('fxOpp')?.checked === true;
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      await sleep(240 / speed);
      spawnImpactBg(tSide);
      spawnPunchFist(tSide, { size: 46 });
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      await sleep(320 / speed);
      return;
    }
    if (mv.id === 67) {
      const opp = $('fxOpp')?.checked === true;
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      lungeAttack(atkSide);
      await sleep(300 / speed);
      await impact(mv, 1, tSide);
      return;
    }
    if (mv.id === 158) {
      const opp = $('fxOpp')?.checked === true;
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      lungeAttack(atkSide);
      await sleep(180 / speed);
      spawnHyperFangTeeth(tSide);
      setTimeout(() => shake(tSide), 180 / speed);
      await wait(300 / speed);
      await impact(mv, 1, tSide);
      spawnHyperFangBurst(tSide);
      lowerAttacker(atkSide);
      return;
    }
    if (mv.id === 122) {
      const opp = $('fxOpp')?.checked === true;
      const atkSide = opp ? 'be' : 'bp';
      const defSide = opp ? 'bp' : 'be';
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      lungeAttack(atkSide);
      await sleep(180 / speed);
      shake(defSide);
      const foe = $(`${defSide}-img`);
      if (foe) {
        foe.style.transformOrigin = '50% 100%';
        const stretch = foe.animate([
          { transform: 'scale(1, 1)' },
          { transform: 'scale(.88, 1.55)', offset: 0.38 },
          { transform: 'scale(1, 1)' },
        ], { duration: 420 / speed, easing: 'ease-out', fill: 'both' });
        // 必须清掉 fill 动画，否则下一次对手出招时它会覆盖 lungeAttack 的 transform
        setTimeout(() => { stretch.cancel(); foe.style.transformOrigin = ''; }, 460 / speed);
      }
      await wait(460 / speed);
      lowerAttacker(atkSide);
      return;
    }
    if (mv.id === 15) {
      const opp = $('fxOpp')?.checked === true;
      const tSide = opp ? 'bp' : 'be';
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      spawnSlashFx(tSide);
      setTimeout(() => shake(tSide), 150 / speed);
      await wait(360 / speed);
      return;
    }
    const opp = $('fxOpp')?.checked === true;
    if (mv.name === '吸取之吻') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lunge(atkSide);
      await sleep(80 / speed);
      spawnDrainingKissFx(atkSide, tSide);
      await impact(mv, 1, tSide);
      return;
    }
    if (mv.name === '十万伏特' || mv.name === '伏特攻击') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      if (mv.name === '伏特攻击') lungeAttack(atkSide);
      spawnVoltFlash();
      spawnLightningAsset(tSide, mv.name === '伏特攻击' ? 1 : 2);
      await sleep(320 / speed);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '雷电牙' || mv.name === '冰冻牙' || mv.name === '火焰牙' || mv.name === '精神之牙' || mv.name === '剧毒牙' || mv.name === '虫咬') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      spawnFangBite(tSide, mv.name);
      await sleep(170 / speed);
      spawnFangParticles(tSide, mv.name);
      await impact(mv, 1, tSide);
      if (mv.name === '剧毒牙') showStatusFx(tSide, 'poison');
      return;
    }
    if (HAND_CLAMP_MOVES.has(mv.name)) {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      await sleep(60 / speed);
      spawnClampHands(tSide);
      await sleep(150 / speed);
      await impact(mv, 1, tSide);
      return;
    }
    if (mv.name === '精神突进') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      spawnPsyCharge(opp ? 'be' : 'bp');
      await sleep(600 / speed);
      await impact(mv, 1, opp ? 'bp' : 'be');
      return;
    }
    if (METEOR_MOVES.has(mv.name)) spawnCosmicBg();
    if (mv.name === '流星群') {
      const tSide = opp ? 'bp' : 'be';
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const dur = spawnMeteorRain(tSide, 6);
      await sleep(dur / speed);
      await impact(mv, 1, tSide);
      hideCosmicBg();
      return;
    }
    if (mv.name === '水枪' || mv.name === '喷水') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      await wait(spawnOrigStream('hydro', {
        count: 7, duration: 500, delay: 55, spread: 10,
        startScale: .6, endScale: 1, opacityStart: .9, opacityEnd: .4,
        onHit: () => spawnWaterImpact(tSide),
      }, opp ? 'be' : 'bp', tSide));
      await sleep(180 / speed);
      return;
    }
    if (mv.name === '盐水') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      spawnBrineRain(opp ? 'bp' : 'be');
      await sleep(520 / speed);
      return;
    }
    if (mv.name === '水流环') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      spawnAquaRing(opp ? 'be' : 'bp');
      await sleep(1000 / speed);
      return;
    }
    if (mv.name === '电击') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      spawnVoltFlash();
      spawnLightningAsset(tSide, 3);
      await sleep(360 / speed);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '电击波') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnShockWaveFx(atkSide, tSide);
      await sleep(520 / speed);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '喝牛奶') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      spawnMilkDrinkFx(atkSide);
      await sleep(800 / speed);
      spawnHealFx(atkSide);
      popHeal(atkSide, rnd(12, 20));
      setText(`${opp ? E_NAME : P_NAME}回复了体力！`);
      return;
    }
    if (mv.name === '双针') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnNeedleAsset(atkSide, tSide);
      await sleep(160 / speed);
      spawnNeedleAsset(atkSide, tSide);
      await sleep(380 / speed);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '溶解液') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      await spawnProjStream(atkSide, 'acid', TYPE_COLORS['毒']);
      spawnPoisonOrbBurst(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '毒千针') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      if (origOn() && emerald?.hasMove(40)) {
        await emerald.playMove(40, { speed, opponent: opp, melee: false, cast: true });
      } else {
        spawnNeedleAsset(atkSide, tSide);
        await sleep(380 / speed);
        spawnPoisonOrbBurst(tSide);
      }
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '破坏光线') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnCrossBeamFx(atkSide, tSide, '#ffc46b');
      await sleep(380 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(24, 40));
      return;
    }
    if (mv.name === '撒菱' || mv.name === '毒菱') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const toxic = mv.name === '毒菱';
      const host = stage();
      if (toxic) host?.classList.add('pe-toxic-hazards');
      try {
        if (origOn() && emerald?.hasMove(191)) {
          await emerald.playMove(191, { speed, opponent: opp, melee: false, cast: true });
        }
      } finally {
        if (toxic) host?.classList.remove('pe-toxic-hazards');
      }
      setText(`${toxic ? '毒' : ''}菱撒在了${opp ? P_NAME : E_NAME}脚下！`);
      return;
    }
    if (mv.name === '汲取') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      await emerald.playMove(141, { speed, melee: false, cast: true, opponent: opp });
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (BIND_MOVES.has(mv.name)) {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lunge(atkSide);
      await sleep(160 / speed);
      spawnBindWrapFx(tSide);
      await sleep(560 / speed);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '蟹钳锤') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide); // 贴脸挥钳
      await sleep(220 / speed);
      spawnWaterImpact(tSide);
      spawnSmallBubblesFx(tSide);
      spawnHitSpark(tSide);
      hitRecoil(tSide);
      popDmg(tSide, rnd(16, 30));
      await sleep(180 / speed);
      return;
    }
    if (mv.name === '吸取拳') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      await sleep(200 / speed);
      spawnPunchFist(tSide);
      shake(tSide);
      await sleep(340 / speed);
      if (emerald) await emerald.play('AbsorbEffect', { speed, opponent: opp });
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (FIST_MOVES.has(mv.name)) {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lungeAttack(atkSide);
      await sleep(200 / speed);
      spawnPunchFist(tSide, {
        count: mv.name === '钢拳双击' ? 2 : 1,
        size: mv.name === '极巨拳斗' ? 50 : 30,
      });
      if (mv.name === '等离子闪电拳') { spawnVoltFlash(); spawnParalysisBurst(tSide); }
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '恶之波动' || mv.name === '怒火中烧') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnDarkPulseFx(atkSide);
      await sleep(620 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '喷出') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnSpitUpFx(atkSide);
      await sleep(560 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(20, 35));
      return;
    }
    if (mv.name === '充电') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      spawnChargeFx(atkSide);
      await sleep(1000 / speed);
      setText(`${opp ? E_NAME : P_NAME}的特攻提升了！`);
      return;
    }
    if (mv.name === '地球上投') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      await spawnSeismicLiftFx(atkSide, tSide, () => { shake(tSide); spawnHitSpark(tSide); });
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '岩崩') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      spawnRockSlide(tSide);
      await sleep(820 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '击落') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnStoneBarrageFx(atkSide, tSide, 1);
      await sleep(800 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '原始之力') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnStoneBarrageFx(atkSide, tSide, 4);
      await sleep(800 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '岩石爆击') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnStoneBarrageFx(atkSide, tSide, 4);
      await sleep(800 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '岩石封锁') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      spawnRockTombFx(tSide);
      await sleep(620 / speed);
      spawnXMark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '岩石打磨') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      spawnBlueStarBurst(atkSide, 10);
      await sleep(760 / speed);
      setText(`${opp ? E_NAME : P_NAME}的速度大幅提升了！`);
      return;
    }
    if (STONE_RANGED.has(mv.name)) {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnStoneBarrageFx(atkSide, tSide);
      await sleep(700 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '月光' || mv.name === '新月祈祷') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      spawnMoonFx(atkSide, atkSide, 'heal');
      await sleep(960 / speed);
      spawnHealFx(atkSide);
      popHeal(atkSide, rnd(12, 20));
      setText(`${opp ? E_NAME : P_NAME}回复了体力！`);
      return;
    }
    if (mv.name === '月亮之力') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      spawnMoonFx(atkSide, tSide, 'attack');
      await sleep(960 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '落石') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      spawnRockDrop(tSide);
      await sleep(760 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '黑雾') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      spawnHazeFx();
      await sleep(1000 / speed);
      setText('黑雾弥漫，能力变化被还原了！');
      return;
    }
    if (mv.name === '烟幕') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      spawnSmokeScreen(tSide);
      await sleep(520 / speed);
      setText(`${opp ? P_NAME : E_NAME}的命中率下降了！`);
      return;
    }
    if (mv.name === '龙卷风') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      spawnTwisterFx(tSide);
      await sleep(900 / speed);
      spawnHitSpark(tSide);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '乱抓') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      spawnFurySwipes(tSide, 4);
      await sleep(620 / speed);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '电磁炮' || mv.name === '电球') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      spawnElectricBall(opp ? 'be' : 'bp', tSide, mv.name === '电磁炮' ? 1 : 2);
      await sleep(440 / speed);
      shake(tSide);
      popDmg(tSide, rnd(16, 30));
      return;
    }
    if (mv.name === '抓狂') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      await flailWindup(opp ? 'be' : 'bp');
      await impact(mv, 1, opp ? 'bp' : 'be');
      return;
    }
    if (mv.name === '冰冻之风') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      await wait(spawnOrigStream('mist', {
        count: 10, duration: 620, delay: 45, spread: 14, wave: 5,
        startScale: .55, endScale: 1.35, opacityStart: .85, opacityEnd: .15,
      }, opp ? 'be' : 'bp', opp ? 'bp' : 'be'));
      return;
    }
    if (mv.name === '归天之翼') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lunge(atkSide);
      await spawnAirBladeStream(atkSide, 2);
      spawnDrainParticles(tSide, atkSide, '#9bd9ff', 8);
      await sleep(520 / speed);
      await impact(mv, 1, tSide);
      return;
    }
    if (mv.name === '空气之刃' || mv.name === '空气利刃') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lunge(atkSide);
      await spawnAirBladeStream(atkSide, 2);
      await impact(mv, 1, tSide);
      return;
    }
    if (mv.name === '火之舞' || mv.name === '烈火深渊') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      await emerald.playMove(83, { speed, opponent: opp, cast: false });
      return;
    }
    if (mv.name === '临别礼物') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      await playMementoFx(opp ? 'be' : 'bp');
      return;
    }
    if (mv.name === '冲浪' || mv.name === '浊流') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      spawnSurfWave(opp ? 'be' : 'bp', mv.name === '浊流');
      await sleep(900 / speed);
      return;
    }
    if (mv.name === '花瓣舞') {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      await spawnPetalDance(opp ? 'bp' : 'be');
      return;
    }
    if (mv.name === '精神强念' && origOn() && emerald?.hasMove(94)) {
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const tSide = opp ? 'bp' : 'be';
      await emerald.playMove(94, {
        speed,
        melee: false,
        cast: true,
        opponent: opp,
        onImpact: () => { void impact(mv, 1, tSide); },
      });
      return;
    }
    if (mv.name === '模仿') {
      // 模仿：原作脚本复用的是命中泼溅帧，观感不对；改成把对手身上的能量吸过来
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      const atkSide = opp ? 'be' : 'bp';
      const tSide = opp ? 'bp' : 'be';
      lunge(atkSide);
      await sleep(160 / speed);
      spawnDrainParticles(tSide, atkSide, '#9bd9ff', 12);
      await sleep(600 / speed);
      setText(`${opp ? P_NAME : E_NAME}模仿了对手的招式！`);
      return;
    }
    const peId = mv.name === '骨棒乱打' ? 125 : mv.name === '蛮力' ? 70 : mv.name === '龙之怒' ? 225
      : mv.name === '雷击' ? 87 : mv.id; // 雷击复用打雷（已简化为单段落雷）
    if (origOn() && emerald && emerald.hasMove(peId)) {
      const opp = $('fxOpp')?.checked === true;
      setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
      if (BEAM_COLORS[mv.name]) spawnBeamFx(mv.name, opp);
      if (mv.id === 98) setTimeout(() => spawnStarBurst(opp ? 'bp' : 'be', 6), 180 / speed);
      let fast = mv.id === 76 ? 1.8 : mv.id === 109 ? 1.65 : mv.name === '晨光' ? 2 : 1;
      if (mv.effect?.kind === 'multihit') fast *= 1.3; // 多段招式后摇偏长，整体适当提速
      const two = TWO_TURN_MOVES.has(mv.id);
      const peCat = moveCat(mv);
      const bolt = mv.name === '雷击'; // 雷击复用打雷的施法式落雷，不做近身冲撞
      const peCast = bolt || peCat === 'spec'
        || (peCat === 'phys' && (mv.name === '攀瀑' || !!(RANGED_SINGLE[mv.name] || RANGED_PHYS_MULTI[mv.name])))
        || (peCat === 'status' && mv.effect?.target === 'foe');
      const peMelee = !bolt && peCat === 'phys' && !RANGED_SINGLE[mv.name] && !RANGED_PHYS_MULTI[mv.name];
      const peOpts = { speed: speed * fast, melee: peMelee, cast: peCast, twoTurn: two, opponent: opp };
      if (mv.name === '打雷' || bolt) {
        // 击中瞬间：震屏 + 从目标头顶正中心劈下的闪电
        const tSide = opp ? 'bp' : 'be';
        peOpts.onImpact = () => {
          const img = $(`${tSide}-img`);
          const layer = tSide === 'bp' ? img?.parentElement : img;
          const prevZ = layer?.style.zIndex;
          if (layer) layer.style.zIndex = '7';
          shake(tSide);
          spawnLightningAsset(tSide, 1);
          setTimeout(() => { if (layer && layer.isConnected) layer.style.zIndex = prevZ; }, 520 / speed);
        };
      }
      if (mv.id === 143) {
        await emerald.playMove(peId, { ...peOpts, turn: 2 });
      } else if (mv.id === 117) {
        await emerald.playMove(peId, { ...peOpts, turn: 2 });
      } else if (two) {
        const chargeImg = (mv.name === '飞翔' || mv.name === '挖洞') ? $(`${opp ? 'be' : 'bp'}-img`) : null;
        await emerald.playMove(peId, { ...peOpts, turn: 1 });
        if (chargeImg) chargeImg.style.visibility = 'hidden';
        // 挖洞/潜水/飞翔先让第一段完整演完，再进第二段，避免第二段的目标水花/出土叠在潜入动作上
        await sleep((mv.name === '挖洞' ? 120 : (mv.name === '潜水' || mv.name === '飞翔') ? 900 : 250) / speed);
        const peTurn2 = { ...peOpts, turn: 2 };
        if (mv.name === '挖洞') peTurn2.onReveal = () => { if (chargeImg) chargeImg.style.visibility = ''; };
        await emerald.playMove(peId, peTurn2);
        if (chargeImg) chargeImg.style.visibility = '';
      } else {
        await emerald.playMove(peId, peOpts);
      }
      if (mv.id === 158) spawnHyperFangBurst(opp ? 'bp' : 'be');
      return;
    }
    const group = classify(mv);
    const cat = catOf(mv);
    setText(`${opp ? E_NAME : P_NAME}使用了${mv.name}！`);
    if (BEAM_COLORS[mv.name]) spawnBeamFx(mv.name, opp);
    if (FANG_COLORS[mv.name]) spawnFangBite(opp ? 'bp' : 'be', mv.name);
    if (CHARGE_MOVES.has(mv.name)) {
    const atkSide = opp ? 'be' : 'bp';
    const tSide = opp ? 'bp' : 'be';
    const atkImg = $(`${atkSide}-img`);
    setText(CHARGE_ENTER_TEXT[mv.name](opp ? E_NAME : P_NAME));
    playChargeEnter(atkSide, mv.name);
    await sleep(720);
    resetAnim(atkImg);
    atkImg.dataset.charged = '';
    if (mv.name !== '日光束') atkImg.classList.add(CHARGE_OUT_CLS[mv.name] || 'cg-out-vanish');
    if (mv.name === '挖洞') spawnGroundBurst(atkSide, '#b98f5e', 10);
    else if (mv.name === '潜水') spawnGroundBurst(atkSide, '#7fd0f5', 8);
    await sleep(340);
    if (mv.name === '日光束') {
      spawnSolarBeam(tSide);
      await sleep(500);
    } else {
      lungeAttack(atkSide);
      await sleep(280);
    }
    await impact(mv, 1, tSide);
  } else if (group === 'heal') {
    const atkSide = opp ? 'be' : 'bp';
    lunge(atkSide);
    await sleep(180);
    spawnHealFx(atkSide);
    popHeal(atkSide, rnd(12, 20));
    setText(`${opp ? E_NAME : P_NAME}回复了体力！`);
    await sleep(500);
  } else if (group === 'shield') {
    const atkSide = opp ? 'be' : 'bp';
    lunge(atkSide);
    await sleep(160);
    showShield(atkSide);
    setText(`${opp ? E_NAME : P_NAME}张开了防护！`);
    await sleep(650);
  } else if (group === 'status') {
    const atkSide = opp ? 'be' : 'bp';
    const tSide = opp ? 'bp' : 'be';
    lunge(atkSide);
    await sleep(180);
    const status = mv.effect?.status || mv.effect?.attach?.status;
    if (status) {
      showStatusFx(tSide, status);
      if (status === 'burn') spawnStatusFlash(tSide); // 灼伤：红光闪烁
      const cn = { sleep: '睡着了', poison: '中毒了', burn: '灼伤了', paralysis: '麻痹了', freeze: '冰冻了', confusion: '混乱了', infatuation: '着迷了', curse: '被诅咒了' }[status] || '状态变化了';
      setText(`${opp ? P_NAME : E_NAME}${cn}`);
    } else {
      spawnTypeFx(tSide, mv.type);
      setText(`${mv.name}的效果发动了！`);
    }
    await sleep(400);
    } else {
      await playAttack(mv, group, opp);
    }
    await sleep(150);
  } finally {
    busy = false;
  }
}

function updateTitle(mv) {
  $('fxName').textContent = mv.statusKind ? `${mv.name}（状态）` : mv.name;
  if (mv.statusKind) {
    $('fxMeta').textContent = `状态动画 · ${emerald?.hasStatus(mv.statusKind) ? '原作' : '缺失'}`;
    return;
  }
  const source = origOn() && emerald?.hasMove(mv.id) ? `原作动画${$('fxOpp')?.checked ? '（对手）' : ''}` : '兼容演出';
  $('fxMeta').textContent = `#${mv.id} · ${mv.type} · ${catOf(mv)} · ${GROUPS[classify(mv)] || ''} · ${source}`;
}
function setActiveClass() {
  document.querySelectorAll('.fx-item').forEach((el) => el.classList.toggle('active', current && Number(el.dataset.id) === current.id));
}
function highlight(mv) { setActiveClass(); }
function selectMove(mv) {
  if (busy) return;
  current = mv;
  updateTitle(mv);
  playMove(mv);
}

function buildFilters() {
  const typeSel = $('fxType');
  const order = ['一般', '格斗', '飞行', '毒', '地面', '岩石', '虫', '幽灵', '钢', '火', '水', '草', '电', '超能', '冰', '龙', '恶', '妖精'];
  const types = [...new Set(moves.map((m) => m.type))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const t of types) {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t;
    typeSel.appendChild(o);
  }
  const groups = [...new Set(moves.map((m) => classify(m)))];
  for (const g of groups) {
    const o = document.createElement('option');
    o.value = g;
    o.textContent = GROUPS[g] || g;
    $('fxGroup').appendChild(o);
  }
}
function renderList() {
  const q = $('fxSearch').value.trim().toLowerCase();
  const type = $('fxType').value;
  const cat = $('fxCategory').value;
  const group = $('fxGroup').value;
  const reps = $('fxReps').checked;
  let list = moves.filter((m) => (!q || m.name.toLowerCase().includes(q) || String(m.id).includes(q))
    && (!type || m.type === type)
    && (!cat || catOf(m) === cat)
    && (!group || classify(m) === group));
  if (reps) {
    const seen = new Set();
    list = list.filter((m) => {
      const g = classify(m);
      if (seen.has(g)) return false;
      seen.add(g);
      return true;
    });
  }
  filtered = list;
  $('fxCount').textContent = `${list.length} / ${moves.length} 个招式`;
  const html = list.map((m) => {
    const source = m.statusKind || (origOn() && emerald?.hasMove(m.id)) ? '原作' : '兼容';
    const sub = m.statusKind ? `状态 · 原作` : `${m.type} · ${catOf(m)} · ${source}`;
    return `<button type="button" class="fx-item" data-id="${m.id}">
    <span class="fx-item-id">${m.statusKind ? '—' : m.id}</span>
    <span class="fx-item-main"><span class="fx-item-name">${m.name}</span><span class="fx-item-sub">${sub}</span></span>
    <span class="fx-item-group">${GROUPS[classify(m)] || classify(m)}</span>
  </button>`;
  }).join('');
  $('fxList').innerHTML = html;
  setActiveClass();
}
function nextMove() {
  if (!filtered.length) return;
  const i = current ? filtered.findIndex((m) => m.id === current.id) : -1;
  const mv = filtered[(i + 1) % filtered.length];
  if (mv) selectMove(mv);
}

function initUI() {
  $('fxSearch').addEventListener('input', renderList);
  $('fxType').addEventListener('change', renderList);
  $('fxCategory').addEventListener('change', renderList);
  $('fxGroup').addEventListener('change', renderList);
  $('fxReps').addEventListener('change', renderList);
  $('fxOrig').addEventListener('change', () => {
    renderList();
    if (current) updateTitle(current);
  });
  $('fxOpp').addEventListener('change', () => {
    if (current) updateTitle(current);
  });
  $('fxSpeed').addEventListener('change', (e) => {
    speed = Number(e.target.value) || 1;
    if (emerald?.session) emerald.session.speed = speed;
  });
  $('fxReplay').addEventListener('click', () => current && playMove(current));
  $('fxNext').addEventListener('click', nextMove);
  $('fxList').addEventListener('click', (e) => {
    const item = e.target.closest('.fx-item');
    if (!item) return;
    const mv = moves.find((m) => m.id === Number(item.dataset.id));
    if (mv) selectMove(mv);
  });
}

async function init() {
  const res = await fetch(new URL('../src/pokemon-data/moves.json', import.meta.url));
  const json = await res.json();
  data = json;
  moves = Object.entries(json.moves)
    .map(([id, mv]) => ({ ...mv, id: Number(id) }))
    .filter((mv) => mv.effect && mv.effect.kind !== 'unimplemented')
    .sort((a, b) => a.id - b.id);
  moves = [...STATUS_MOVES, ...moves];
  emerald = new EmeraldFx({ stage: stage(), atkImg: $('bp-img'), tgtImg: $('be-img') });
  buildFilters();
  initUI();

  $('bp-img').src = new URL('../src/pokemon-data/images/0025-皮卡丘.gif', import.meta.url).href;
  $('be-img').src = new URL('../src/pokemon-data/images/0001-妙蛙种子.gif', import.meta.url).href;
  await Promise.all([$('bp-img').decode().catch(() => {}), $('be-img').decode().catch(() => {})]);
  $('bp-hp').style.width = '100%';
  $('be-hp').style.width = '100%';
  for (const [id, type] of [['bp-types', ['电']], ['be-types', ['草', '毒']]]) {
    $(id).innerHTML = type.map((t) => `<span class="b-type" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`).join('');
  }
  renderList();
  updateFxScale();
  window.addEventListener('resize', updateFxScale);
  const first = moves.find((m) => classify(m) === 'phys') || moves[0];
  if (first) { current = first; updateTitle(first); }
}

init().catch((e) => {
  console.error(e);
  setText('数据加载失败：请从项目根目录启动本地服务后访问本页');
});
