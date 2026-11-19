// Original Pokémon Emerald move animations, ported from pokeemerald battle_anim scripts.
// Each move script is interpreted frame-by-frame (60 FPS) against the original sprites.
import PE from './move-fx-pe-data.js';

const FPS = 60;
const ASSET_BASE = new URL('./move-fx-assets/', import.meta.url).href;
// Single battle battler centers in the original 240x160 GBA screen.
const ATK_X = 72;
const ATK_Y = 80;
const TGT_X = 176;
const TGT_Y = 40;
const SPR_SCALE = 1;
PE.templates.__smokescreenImpact = {
  cb: 'AnimSmokescreenImpact', img: 'pe/Gfx_SmokescreenImpact__16x16.png',
  fw: 16, fh: 16, cols: 1, frames: 3, am: 0, ob: 0,
  an: [[['f', 0, 4], ['f', 1, 4], ['f', 2, 4], ['e']]], af: [[]],
};
for (const t of Object.values(PE.templates)) {
  if (/Gfx_MagentaHeart/i.test(t.img || '')) { t.img = null; t.heart = true; }
  if (/Gfx_Spotlight/i.test(t.img || '')) t.img = null;
}
// 泥巴射击：原作和高压水枪共用同一颗蓝色水球（Gfx_WaterOrb），这里保留球体形状与 4 帧流光，
// 只在渲染时染成泥巴色（素材库里没有现成泥球，Gfx_MudSand 是方形噪点土粒，直接换贴图更难看）
if (PE.templates.gMudShotOrbSpriteTemplate) PE.templates.gMudShotOrbSpriteTemplate.mudTint = true;
for (const k of Object.keys(PE.backgrounds)) {
  if (/_contests\.png$/.test(PE.backgrounds[k] || '')) delete PE.backgrounds[k];
}

const gba = (side) => (side === 'be' ? { x: TGT_X, y: TGT_Y } : { x: ATK_X, y: ATK_Y });
const A = (arr, i, d = 0) => {
  const v = arr && arr[i];
  return v === undefined || v === null ? d : Number(v) || 0;
};
const s16 = (v) => (v << 16) >> 16;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleSin = (a, amp) => Math.round(Math.sin(((a & 255) / 256) * Math.PI * 2) * amp);
const angleCos = (a, amp) => Math.round(Math.cos(((a & 255) / 256) * Math.PI * 2) * amp);
// 这些招式的 SlideMon/Lunge 只是施法位移或弹道，不能被放大成贴身冲撞
const NO_CONTACT_LABELS = new Set([
  'Move_WING_ATTACK', 'Move_STEEL_WING', 'Move_REVERSAL', 'Move_BONEMERANG', 'Move_ROCK_BLAST',
  'Move_PETAL_DANCE', 'Move_BIDE', 'Move_ANCIENT_POWER', 'Move_NATURE_POWER',
  'Move_RAZOR_LEAF', 'Move_PRESENT', 'Move_SACRED_FIRE', 'Move_PAY_DAY', 'Move_EGG_BOMB', 'Move_BONE_CLUB',
  'Move_POISON_STING', 'Move_TWINEEDLE', 'Move_PIN_MISSILE', 'Move_BULLET_SEED', 'Move_ICICLE_SPEAR',
  'Move_BARRAGE', 'Move_BONE_RUSH', 'Move_ROCK_THROW', 'Move_ROCK_SLIDE', 'Move_ROCK_TOMB',
  'Move_EARTHQUAKE', 'Move_MAGNITUDE', 'Move_FISSURE', 'Move_SELF_DESTRUCT', 'Move_EXPLOSION', 'Move_SAND_TOMB',
]);
const FAST_POWDER_MOVES = /^Move_(POISON_POWDER|STUN_SPORE|SLEEP_POWDER|SPORE|COTTON_SPORE)$/;
// 吸取类：伤害/吸血靠吸收光球表现，不做命中贴图，也不做草系树叶炸开
const DRAIN_MOVE_LABELS = /^Move_(ABSORB|MEGA_DRAIN|GIGA_DRAIN|LEECH_LIFE|DREAM_EATER|DRAIN_PUNCH)$/;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const rgb555 = (c) => [c & 31, (c >> 5) & 31, (c >> 10) & 31];
const hex = (c) => {
  const [r, g, b] = rgb555(c);
  return '#' + [r, g, b].map((v) => Math.round((v / 31) * 255).toString(16).padStart(2, '0')).join('');
};
const hexToRgba = (color, alpha) => {
  const h = color.replace('#', '');
  if (h.length !== 6) return color;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
};

const protectTexCache = new Map();

// Gfx_Protect is a 7-color diagonal band texture; the original animation cycles its
// palette every 2 frames. Pre-render one frame per palette offset and swap images.
function protectTexture(src) {
  let rec = protectTexCache.get(src);
  if (rec) return rec;
  rec = { ready: false, frames: [] };
  protectTexCache.set(src, rec);
  const img = new Image();
  img.onload = () => {
    const w = img.width;
    const h = img.height;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const colors = [];
    const idOf = new Map();
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      if (!idOf.has(key)) {
        idOf.set(key, colors.length);
        colors.push([px[i], px[i + 1], px[i + 2]]);
      }
    }
    if (colors.length < 2) return;
    for (let step = 0; step < colors.length; step++) {
      const out = ctx.createImageData(w, h);
      for (let i = 0; i < px.length; i += 4) {
        out.data[i + 3] = px[i + 3];
        if (!px[i + 3]) continue;
        const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
        const c = colors[(idOf.get(key) + step) % colors.length];
        out.data[i] = c[0];
        out.data[i + 1] = c[1];
        out.data[i + 2] = c[2];
      }
      const fc = document.createElement('canvas');
      fc.width = w;
      fc.height = h;
      fc.getContext('2d').putImageData(out, 0, 0);
      rec.frames.push(fc.toDataURL());
    }
    rec.ready = true;
  };
  img.src = src;
  return rec;
}

function buildHailWeather(el) {
  el.innerHTML = '';
  for (let i = 0; i < 18; i++) {
    const stone = document.createElement('i');
    stone.className = 'pe-hail-stone';
    stone.style.left = rnd(-8, 100) + '%';
    stone.style.top = rnd(-30, 95) + '%';
    const size = rnd(14, 28);
    stone.style.width = size + 'px';
    stone.style.height = size + 'px';
    stone.style.animationDuration = (1.1 + Math.random() * 0.7).toFixed(2) + 's';
    stone.style.animationDelay = (-Math.random() * 2).toFixed(2) + 's';
    stone.style.setProperty('--drift', (-10 - Math.random() * 22).toFixed(0) + 'px');
    stone.style.setProperty('--spin', (rnd(-30, 60)).toFixed(0) + 'deg');
    el.appendChild(stone);
  }
}

function buildRainWeather(el) {
  el.innerHTML = '';
  for (let i = 0; i < 30; i++) {
    const drop = document.createElement('i');
    drop.className = 'pe-rain-drop';
    drop.style.left = rnd(-10, 100) + '%';
    drop.style.top = rnd(-45, 100) + '%';
    const w = rnd(8, 14);
    drop.style.width = w + 'px';
    drop.style.height = w * 2 + 'px';
    drop.style.animationDuration = (0.55 + Math.random() * 0.35).toFixed(2) + 's';
    drop.style.animationDelay = (-Math.random() * 1.2).toFixed(2) + 's';
    drop.style.setProperty('--drift', (-22 - Math.random() * 22).toFixed(0) + 'px');
    el.appendChild(drop);
  }
}

function buildSandWeather(el) {
  el.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const dust = document.createElement('i');
    dust.className = 'pe-sand-dust';
    dust.style.left = rnd(-25, 60) + '%';
    dust.style.top = rnd(-5, 95) + '%';
    const w = rnd(26, 44);
    dust.style.width = w + 'px';
    dust.style.height = Math.round(w / 2) + 'px';
    dust.style.animationDuration = (0.75 + Math.random() * 0.7).toFixed(2) + 's';
    dust.style.animationDelay = (-Math.random() * 1.4).toFixed(2) + 's';
    dust.style.setProperty('--dy', rnd(-18, 18) + 'px');
    el.appendChild(dust);
  }
}

const BG_STYLE = {
  1: 'linear-gradient(180deg, #0a0a14 0%, #14101f 100%)', // dark
  2: 'radial-gradient(circle at 50% 40%, #3a2456 0%, #180f26 70%, #0d0816 100%)', // ghost
  3: 'radial-gradient(circle at 50% 42%, #5a2a62 0%, #2a1338 65%, #120a1c 100%)', // psychic
  4: 'radial-gradient(circle at 30% 50%, #3a1e1e 0%, #180c0c 100%)', // impact opponent
  5: 'radial-gradient(circle at 70% 50%, #3a1e1e 0%, #180c0c 100%)', // impact player
  6: 'radial-gradient(circle at 50% 50%, #3a1e1e 0%, #180c0c 100%)',
  7: 'linear-gradient(90deg, #2b2118 0%, #4a3a26 50%, #2b2118 100%)', // drill
  8: 'linear-gradient(90deg, #2b2118 0%, #4a3a26 50%, #2b2118 100%)',
  9: 'repeating-linear-gradient(90deg, #202838 0 6px, #2c3850 6px 12px)', // highspeed
  10: 'repeating-linear-gradient(270deg, #202838 0 6px, #2c3850 6px 12px)',
  11: 'radial-gradient(circle at 50% 0%, #2c3350 0%, #101320 80%)', // thunder
  12: 'radial-gradient(circle at 30% 50%, #3a1414 0%, #160808 100%)', // guillotine
  13: 'radial-gradient(circle at 70% 50%, #3a1414 0%, #160808 100%)',
  14: 'radial-gradient(circle at 50% 50%, #3a1414 0%, #160808 100%)',
  15: 'linear-gradient(180deg, #2c6c86 0%, #123846 55%, #9fd8e8 100%)', // ice
  16: 'radial-gradient(circle at 50% 30%, #24304a 0%, #080b16 70%)', // cosmic
  17: 'linear-gradient(180deg, #8fc9f0 0%, #cfe9fb 100%)', // in air
  18: 'linear-gradient(180deg, #4b9cd8 0%, #9fd2f5 65%, #d8ecfb 100%)', // sky
  19: 'linear-gradient(180deg, #4b9cd8 0%, #9fd2f5 65%, #d8ecfb 100%)',
  20: 'linear-gradient(120deg, #0d3a3a 0%, #1d8a6a 40%, #7ce0b0 70%, #2a4a8a 100%)', // aurora
  21: 'linear-gradient(180deg, #3a2a1a 0%, #170f08 100%)', // fissure
  22: 'linear-gradient(180deg, #1e3a16 0%, #0e1c0a 100%)', // bug
  23: 'linear-gradient(180deg, #1e3a16 0%, #0e1c0a 100%)',
  24: 'radial-gradient(circle at 50% 30%, #fff2a8 0%, #d9a520 45%, #6b4a08 100%)', // solar beam
  25: 'radial-gradient(circle at 50% 30%, #fff2a8 0%, #d9a520 45%, #6b4a08 100%)',
  26: 'radial-gradient(circle at 50% 30%, #fff2a8 0%, #d9a520 45%, #6b4a08 100%)',
};

function newMonState() {
  return { ox: 0, oy: 0, lungeX: 0, lungeY: 0, castX: 0, castY: 0, sx: 1, sy: 1, rot: 0, alpha: 1, bright: 1, sat: 1, hue: 0, sepia: 0, inv: 0, hidden: false, tint: null };
}

function applyTintFilter(m) {
  const f = [];
  if (m.bright !== 1) f.push(`brightness(${m.bright.toFixed(3)})`);
  if (m.sat !== 1) f.push(`saturate(${m.sat.toFixed(3)})`);
  if (m.sepia > 0) f.push(`sepia(${m.sepia.toFixed(3)})`);
  if (m.hue) f.push(`hue-rotate(${m.hue.toFixed(1)}deg)`);
  if (m.inv) f.push(`invert(${m.inv.toFixed(3)})`);
  return f.length ? f.join(' ') : 'none';
}
// PE 调色不要覆盖时空扭曲外观的 CSS 滤镜
function variantFilter(img) {
  if (!img || !img.classList) return '';
  if (img.classList.contains('fx-variant-rgb')) {
    return 'drop-shadow(3px 0 0 rgba(255, 0, 80, .65)) drop-shadow(-3px 0 0 rgba(0, 220, 255, .65))';
  }
  if (img.classList.contains('fx-variant-polluted')) {
    return 'grayscale(1) sepia(1) hue-rotate(248deg) saturate(7) brightness(.65)';
  }
  return '';
}

function setMonTint(m, color, amount) {
  const t = clamp(amount / 16, 0, 1.6);
  const [r, g, b] = rgb555(color);
  const lum = (r + g + b) / 93;
  if (t === 0) {
    m.bright = 1; m.sat = 1; m.hue = 0; m.sepia = 0; m.tint = null;
    return;
  }
  if (lum < 0.12) {
    m.bright = 1 - t * 0.72; m.sat = 1; m.sepia = 0; m.hue = 0;
  } else if (lum > 0.9) {
    m.bright = 1 + t * 1.0; m.sat = 1 - t * 0.7; m.sepia = 0; m.hue = 0;
  } else {
    const hue = (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180 / Math.PI + 360) % 360;
    m.bright = 1 + t * 0.1;
    m.sat = 1 + t * 1.8;
    m.sepia = Math.min(1, t * 1.1);
    m.hue = hue - 40;
  }
  m.tint = { color, amount };
}

// ---------------------------------------------------------------- behaviors
// Sprite fields: gx/gy (GBA coords), x2/y2, sx/sy/rot/alpha, anim, affine, data.
function initAtk(s, atk = true) {
  const p = s.E.statusSide ? { x: TGT_X, y: TGT_Y } : { x: ATK_X, y: ATK_Y };
  s.gx = p.x + A(s.args, 0);
  s.gy = p.y + A(s.args, 1);
}
function initTgt(s) {
  s.gx = TGT_X + A(s.args, 0);
  s.gy = TGT_Y + A(s.args, 1);
}
// 看我嘛/挑衅共用：Gfx_Finger2 的三帧来回勾手
function fingerBeckon(s) {
  initAtk(s);
  if (s.E.opponent) s.sx = -1;
  s.tmpl = { ...s.tmpl, img: 'pe/Gfx_Finger2__32x32.png', fw: 32, fh: 32, frames: 3 };
  if (s.el) {
    s.el.style.backgroundImage = `url(${new URL('pe/Gfx_Finger2__32x32.png', ASSET_BASE).href})`;
    s.el.style.transformOrigin = '50% 80%';
  }
  s.anim = {
    cmds: [
      ['f', 0, 1], ['f', 0, 1], ['f', 0, 4], ['f', 1, 4], ['f', 2, 4],
      ['f', 1, 4], ['f', 0, 4], ['f', 1, 4], ['f', 2, 4], ['j', 0],
    ],
    i: 0, frame: 0, timer: 1, ended: false, started: true,
  };
  animApply(s);
  s.life = 90;
  s.dieOnLife = true;
  s.onTick = () => {
    s.y2 = Math.sin(s.age / 12) * 4;
  };
}
function absMetrics(s) {
  const eng = s.E.E;
  const sr = eng.stage.getBoundingClientRect();
  const field = (eng.stage.querySelector && eng.stage.querySelector('.battle-stage-top')) || eng.stage;
  const fr = field.getBoundingClientRect();
  const k = eng.rectScale || 1;
  const a = eng.anchors || { atk: { x: 72, y: 80 }, tgt: { x: 176, y: 40 } };
  return {
    ox: (fr.left - sr.left) * k,
    oy: (fr.top - sr.top) * k,
    w: fr.width * k,
    h: fr.height * k,
    sx: (a.tgt.x - a.atk.x) / (TGT_X - ATK_X) || 1,
    sy: (a.tgt.y - a.atk.y) / (TGT_Y - ATK_Y) || 1,
    a,
  };
}
function absToGba(s, x, y) {
  const m = absMetrics(s);
  s.gx = ATK_X + (m.ox + (x / 240) * m.w - m.a.atk.x) / m.sx;
  s.gy = ATK_Y + (m.oy + (y / 160) * m.h - m.a.atk.y) / m.sy;
}
function startAffine(s, idx = 0) {
  const cmds = (s.tmpl.af && s.tmpl.af[idx]) || [];
  const a = { cmds, i: 0, sx: 256, sy: 256, rot: 0, delay: 0, ended: !cmds.length };
  s.aff = a;
  if (!cmds.length) return;
  applyAffCmd(s, true);
}
function applyAffCmd(s, first = false) {
  const a = s.aff;
  if (!a) return;
  const c = a.cmds[a.i];
  if (!c) { a.ended = true; return; }
  if (c[0] === 'f') {
    const dx = c[1], dy = c[2], rot = c[3], dur = c[4];
    if (dur === 0) {
      if (dx !== 0 || dy !== 0) { a.sx = dx; a.sy = dy; }
      a.rot = rot << 8; a.delay = 0; a.i++;
    } else {
      a.sx += dx; a.sy += dy; a.rot += rot << 8; a.delay = dur - 1; a.i++;
    }
  } else if (c[0] === 'j') {
    a.i = c[1];
    applyAffCmd(s, first);
  } else if (c[0] === 'p') {
    a.i++;
    applyAffCmd(s, first);
  } else {
    a.ended = true;
  }
}
function tickAffine(s) {
  const a = s.aff;
  if (!a || a.ended) return;
  if (a.delay > 0) {
    a.delay--;
    if (a.delay === 0) {
      const c = a.cmds[a.i - 1];
      if (c && c[0] === 'f') { a.sx += c[1]; a.sy += c[2]; a.rot += c[3] << 8; }
    }
  } else {
    applyAffCmd(s);
  }
}
function startAnim(s, idx = 0) {
  const cmds = (s.tmpl.an && s.tmpl.an[idx]) || [];
  s.anim = { cmds, i: 0, frame: 0, timer: 0, ended: !cmds.length, started: true };
  if (!cmds.length) { s.anim.frame = 0; return; }
  animApply(s);
}
function animApply(s) {
  const a = s.anim;
  if (!a) return;
  const c = a.cmds[a.i];
  if (!c) { a.ended = true; return; }
  if (c[0] === 'f') {
    a.frame = clamp(c[1], 0, Math.max(0, (s.tmpl.frames || 1) - 1));
    a.timer = Math.max(1, c[2]);
    a.i++;
  } else if (c[0] === 'j') {
    a.i = c[1];
    animApply(s);
  } else if (c[0] === 'p') {
    a.i++;
    animApply(s);
  } else {
    a.ended = true;
  }
}
function tickAnim(s) {
  const a = s.anim;
  if (!a || a.ended || !a.cmds) return;
  if (--a.timer <= 0) animApply(s);
}
function linearTo(s, dur, tx, ty, arc = 0, destroy = true) {
  const d = Math.max(1, Math.round(dur));
  const x0 = s.gx, y0 = s.gy;
  let t = 0;
  s.onTick = () => {
    t++;
    const k = Math.min(1, t / d);
    s.x2 = (tx - x0) * k;
    s.y2 = (ty - y0) * k * s.E.dirY - (arc ? Math.sin(k * Math.PI) * arc : 0);
    if (k >= 1 && destroy) s.dead = true;
  };
}
// x/y 为舞台 GBA 坐标；动态轨迹传入前先把 y2 乘 dirY
const AIM_BASE = {
  Gfx_GreenSpike: 0,
  Gfx_IcicleSpear: -90,
  Gfx_HornHit2: 0,
  Gfx_HornHit: -45,
  Gfx_Needle: 90,
  Gfx_AirWave: 0,
};
function aimAt(s, x0, y0, x1, y1) {
  const eng = s.E.E;
  const a = eng.stagePoint(x0, y0);
  const b = eng.stagePoint(x1, y1);
  const img = s.tmpl.img || '';
  const key = Object.keys(AIM_BASE).find((k) => img.includes(k));
  const base = key ? AIM_BASE[key] : 90;
  s.rot = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI - base;
}
function faceTarget(s, both = false) {
  if (!s.E.opponent) return;
  s.sx = -Math.abs(s.sx || 1);
  if (both) s.sy = -Math.abs(s.sy || 1);
}

function dieWhenAnimEnds(s, max = 180) {
  s.life = max;
  s.onTick = () => { if (s.anim && s.anim.ended) s.dead = true; };
}
function dieWhenAffineEnds(s, max = 120) {
  s.life = max;
  s.onTick = () => { if (!s.aff || s.aff.ended) s.dead = true; };
}
function popAndFade(s, dur = 24) {
  s.life = dur;
  s.onTick = () => {
    if (s.age > dur - 8) s.alpha = Math.max(0, (dur - s.age) / 8);
    if (s.age >= dur) s.dead = true;
  };
}
function drift(s, vx, vy, dur, fade = true) {
  s.life = dur;
  s.onTick = () => {
    s.x2 += vx; s.y2 += vy;
    if (fade && s.age > dur - 8) s.alpha = Math.max(0, (dur - s.age) / 8);
    if (s.age >= dur) s.dead = true;
  };
}
function flicker(s, dur = 12) {
  s.life = dur;
  s.onTick = () => {
    s.visible = (s.age & 1) === 0;
    if (s.age >= dur) s.dead = true;
  };
}
function burstAround(s, dur, speed = 2, gravity = 0) {
  const ang = Math.random() * Math.PI * 2;
  let vx = Math.cos(ang) * speed;
  let vy = Math.sin(ang) * speed;
  s.life = dur;
  s.onTick = () => {
    s.x2 += vx; s.y2 += vy; vy += gravity;
    s.rot += 7;
    if (s.age > dur - 8) s.alpha = Math.max(0, (dur - s.age) / 8);
    if (s.age >= dur) s.dead = true;
  };
}
function isDarkColor(c) {
  const [r, g, b] = rgb555(c);
  return (r + g + b) / 93 < 0.2;
}

function trimPalSelector(sel, color) {
  let out = sel & ~1;
  if (isDarkColor(color)) out &= ~2;
  return out;
}

function trimComplexSelector(sel, c1, c2) {
  let out = sel & ~1;
  if (isDarkColor(c1) || isDarkColor(c2)) out &= ~2;
  return out;
}

function applyPalSelector(E, sel, color, amount) {
  if (sel & 1) E.bgTint = amount > 0 ? { color: hex(color), alpha: clamp(amount / 16, 0, 0.5) } : null;
  if (sel & 2) setMonTint(E.mon(sideOf(0)), color, amount);
  if (sel & 4) setMonTint(E.mon(sideOf(1)), color, amount);
}

const CB = {
  // ---------------------------------------------------------------- impacts
  AnimConfuseRayBallBounce(s) {
    initAtk(s);
    const speed = Math.max(1, A(s.args, 2, 288));
    const dur = Math.max(8, Math.round((Math.abs(TGT_X - s.gx) * 256) / speed));
    let t = 0;
    const x0 = s.gx, y0 = s.gy;
    s.onTick = () => {
      t++;
      const k = Math.min(1, t / dur);
      s.x2 = (TGT_X - x0) * k + angleSin(t * 5, 10);
      s.y2 = (TGT_Y - y0) * k * s.E.dirY + angleCos(t * 5, 15);
      if (t > dur + 16) s.dead = true;
    };
  },
  AnimConfuseRayBallSpiral(s) {
    s.gx = TGT_X + A(s.args, 0);
    s.gy = TGT_Y + A(s.args, 1);
    let phase = 0;
    let drop = 0;
    s.onTick = () => {
      s.x2 = angleSin(phase, 32);
      s.y2 = angleCos(phase, 8) + drop;
      drop += 0.35;
      phase = (phase + 19) & 255;
      if (s.age > 61) s.dead = true;
    };
  },
  AnimAirWaveCrescent(s) {
    initAtk(s);
    startAnim(s, A(s.args, 5, 0));
    linearTo(s, Math.max(4, A(s.args, 4, 15)), TGT_X + A(s.args, 2), TGT_Y + A(s.args, 3), 0);
  },
  AnimAirWaveCrescent2(s) { CB.AnimAirWaveCrescent(s); },
  AnimFlyBallUp(s) {
    initAtk(s);
    startAffine(s, 0);
    s.E.mon('bp').hidden = true;
    const delay = Math.max(0, A(s.args, 2, 13));
    const vel = A(s.args, 3, 336);
    let acc = 0;
    s.onTick = () => {
      if (s.age <= delay) return;
      acc += vel;
      s.y2 -= acc >> 8;
      if (s.gy + s.y2 < -32) s.dead = true;
    };
  },
  AnimFlyBallAttack(s) {
    const E = s.E;
    const m = E.mon('bp');
    m.hidden = true;
    startAffine(s, E.opponent ? 1 : 0);
    absToGba(s, E.opponent ? 272 : -32, -32);
    s.sx = -1;
    const dur = 20;
    let t = 0;
    linearTo(s, dur, TGT_X, TGT_Y, 0, false);
    const tick = s.onTick;
    s.onTick = () => {
      tick?.();
      if (++t >= dur) { m.hidden = false; s.dead = true; }
    };
  },
  AnimSkyAttackBird(s) {
    s.gx = ATK_X;
    s.gy = ATK_Y;
    const dur = 12;
    const vx = (TGT_X - ATK_X) / dur;
    const vy = (TGT_Y - ATK_Y) / dur;
    const a = s.E.E.stagePoint(ATK_X, ATK_Y);
    const b = s.E.E.stagePoint(TGT_X, TGT_Y);
    s.rot = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
    let t = 0;
    s.onTick = () => {
      t++;
      s.x2 += vx;
      s.y2 += vy * s.E.dirY;
      if (t === dur) {
        const hit = s.E.createSprite('gBasicHitSplatSpriteTemplate', true, 2, [0, 0, 1, 1]);
        if (hit) { hit.gx = TGT_X; hit.gy = TGT_Y; }
      }
      if (t >= dur + 14) s.dead = true;
    };
  },
  AnimDiveBall(s) {
    initAtk(s);
    startAffine(s, 0);
    s.E.mon('bp').hidden = true; // 会话里 bp 永远是出招方
    const delay = 8;
    const vel = 220;
    const top = -24;
    let acc = 0;
    let t = 0;
    let phase = 0;
    let wait = 0;
    s.onTick = () => {
      t++;
      if (t <= delay) return;
      if (phase === 0) {
        acc += vel;
        s.y2 -= acc >> 8;
        if (s.y2 < top) { phase = 1; s.visible = false; wait = 0; }
      } else if (phase === 1) {
        if (++wait > 10) phase = 2;
      } else {
        s.y2 += acc >> 8;
        if (s.y2 > top) s.visible = true;
        if (s.y2 > 0) s.dead = true;
      }
    };
  },
  AnimDiveWaterSplash(s) {
    const onTarget = A(s.args, 0, 0) !== 0;
    const p = gba(onTarget ? 'be' : 'bp');
    s.gx = p.x;
    s.gy = p.y;
    s.sx = 1;
    s.sy = 1;
    let t = 0;
    s.onTick = () => {
      t++;
      const k = Math.min(1, t / 22);
      s.alpha = 1 - k * 0.35;
      if (k >= 1) s.dead = true;
    };
  },
  AnimBounceBallShrink(s) {
    initAtk(s);
    startAffine(s, 0);
    s.E.mon('bp').hidden = true;
    dieWhenAffineEnds(s, 90);
  },
  AnimBounceBallLand(s) {
    s.gx = TGT_X;
    s.gy = TGT_Y;
    let phase = 0;
    s.y2 = -(TGT_Y + 32);
    s.onTick = () => {
      if (phase === 0) {
        s.y2 += 10;
        if (s.y2 >= 0) phase = 1;
      } else {
        s.y2 -= 10;
        if (s.gy + s.y2 < -32) {
          s.E.mon('bp').hidden = false;
          s.dead = true;
        }
      }
    };
  },
  AnimTealAlert(s) {
    s.gx = TGT_X + A(s.args, 0);
    s.gy = TGT_Y + A(s.args, 1);
    startAffine(s, 0);
    dieWhenAnimEnds(s, 60);
  },
  AnimMissileArc(s) {
    initAtk(s);
    const dur = Math.max(4, A(s.args, 4, 20));
    const tx = TGT_X + A(s.args, 2, 0);
    const ty = TGT_Y + A(s.args, 3, 0);
    const amp = A(s.args, 5, 0);
    const x0 = s.gx, y0 = s.gy;
    let t = 0;
    s.onTick = () => {
      t++;
      const k = Math.min(1, t / dur);
      const px = s.x2, py = s.y2 * s.E.dirY;
      s.x2 = (tx - x0) * k;
      s.y2 = (ty - y0) * k * s.E.dirY + Math.sin(Math.PI * k) * amp;
      aimAt(s, x0 + px, y0 + py, x0 + s.x2, y0 + s.y2 * s.E.dirY);
      if (k >= 1) s.dead = true;
    };
  },
  AnimTranslateStinger(s) {
    initAtk(s);
    const dur = Math.max(4, A(s.args, 4, 20));
    const tx = TGT_X + A(s.args, 2, 0);
    const ty = TGT_Y + A(s.args, 3, 0);
    aimAt(s, s.gx, s.gy, tx, ty);
    linearTo(s, dur, tx, ty);
  },
  AnimLeechLifeNeedle(s) {
    s.gx = TGT_X + A(s.args, 0, 0);
    s.gy = TGT_Y + A(s.args, 1, 0);
    aimAt(s, s.gx, s.gy, TGT_X, TGT_Y);
    linearTo(s, Math.max(4, A(s.args, 2, 12)), TGT_X, TGT_Y);
  },
  AnimHitSplatBasic(s) {
    if (s.E.label === 'Move_STRENGTH' && s.E.strengthImpacted) { s.dead = true; return; }
    startAffine(s, A(s.args, 3));
    if (A(s.args, 2) === 0) initAtk(s); else initTgt(s);
    if (s.E.label === 'Move_STRENGTH') {
      const k = (Math.abs(A(s.args, 0, 0)) + Math.abs(A(s.args, 1, 0))) / 60;
      s.sx = s.sy = clamp(0.72 + k, 0.72, 1.3);
    }
    dieWhenAffineEnds(s, 40);
  },
  AnimHitSplatHandleInvert(s) { CB.AnimHitSplatBasic(s); },
  AnimHitSplatRandom(s) {
    startAffine(s, A(s.args, 1, rnd(0, 3)));
    if (A(s.args, 0) === 0) initAtk(s); else initTgt(s);
    s.x2 += rnd(-24, 24); s.y2 += rnd(-12, 12);
    dieWhenAffineEnds(s, 40);
  },
  AnimHitSplatOnMonEdge(s) {
    const side = sideOf(A(s.args, 0));
    const p = gba(side);
    s.gx = p.x + A(s.args, 1);
    s.gy = p.y + A(s.args, 2);
    startAffine(s, A(s.args, 3));
    dieWhenAffineEnds(s, 40);
  },
  AnimHitSplatPersistent(s) {
    CB.AnimHitSplatBasic(s);
    const extra = Math.max(0, A(s.args, 4));
    s.life = Math.max(40, extra + 12);
    s.onTick = () => { if (!s.aff || s.aff.ended) s.life = Math.min(s.life, s.age + extra + 1); };
  },
  AnimFlashingHitSplat(s) {
    startAffine(s, A(s.args, 3));
    if (A(s.args, 2) === 0) initAtk(s); else initTgt(s);
    flicker(s, 14);
  },
  AnimCrossImpact(s) {
    if (A(s.args, 2) === 0) initAtk(s); else initTgt(s);
    popAndFade(s, Math.max(8, A(s.args, 3, 20)));
  },
  AnimBasicFistOrFoot(s) {
    startAnim(s, A(s.args, 4));
    if (A(s.args, 3) === 0) initAtk(s); else initTgt(s);
    popAndFade(s, Math.max(8, A(s.args, 2, 20)));
  },
  AnimFistOrFootRandomPos(s) {
    startAnim(s, A(s.args, 2, 0));
    const side = A(s.args, 0) === 0 ? 'bp' : 'be';
    const p = gba(side);
    s.gx = p.x + rnd(-14, 14);
    s.gy = p.y + rnd(-10, 6);
    popAndFade(s, Math.max(8, A(s.args, 1, 20)));
  },
  AnimSpinningHandOrFoot(s) {
    startAnim(s, A(s.args, 0));
    initTgt(s);
    s.rotSpeed = 24;
    popAndFade(s, Math.max(26, A(s.args, 3, 26)));
  },
  AnimSlideHandOrFootToTarget(s) {
    startAnim(s, A(s.args, 2, 0));
    initAtk(s);
    linearTo(s, Math.max(4, A(s.args, 3, 12)), TGT_X, TGT_Y);
  },
  AnimJumpKick(s) {
    initAtk(s);
    linearTo(s, 14, TGT_X, TGT_Y, 24);
  },
  AnimStompFoot(s) {
    initTgt(s); // 参数 0/1 是相对目标的落点偏移（踩踏脚本为 0,-32）
    // 第三帧是脚掌：0 拳 / 1 宽脚印 / 2 高脚印 / 3 手
    s.anim = { cmds: [], i: 0, frame: 2, timer: 0, ended: true, started: true };
    let t = 0;
    const delay = Math.max(1, A(s.args, 2, 15));
    s.onTick = () => {
      t++;
      if (t >= delay) linearTo(s, 6, TGT_X, TGT_Y, 0, true);
    };
  },
  // ----------------------------------------------------------------- orbs
  AnimAbsorptionOrb(s) {
    initTgt(s);
    linearTo(s, Math.max(6, A(s.args, 3, 20)), ATK_X, ATK_Y, Math.abs(A(s.args, 2, 10)));
  },
  AnimPowerAbsorptionOrb(s) {
    initAtk(s);
    linearTo(s, Math.max(4, A(s.args, 2, 16)), ATK_X, ATK_Y, 8);
  },
  AnimStockpileAbsorptionOrb(s) {
    initAtk(s);
    linearTo(s, 18, ATK_X, ATK_Y, 6);
  },
  AnimSpitUpOrb(s) {
    initAtk(s);
    s.vx = angleSin(A(s.args, 0, 0), 10);
    s.vy = angleCos(A(s.args, 0, 0), 7);
    drift(s, s.vx, s.vy, Math.max(6, A(s.args, 1, 20)));
  },
  AnimSolarBeamBigOrb(s) {
    initAtk(s);
    startAnim(s, A(s.args, 3, 0));
    linearTo(s, Math.max(6, A(s.args, 2, 20)), TGT_X, TGT_Y, 0);
  },
  AnimSolarBeamSmallOrb(s) {
    initAtk(s);
    linearTo(s, Math.max(6, A(s.args, 2, 18)), TGT_X, TGT_Y, 0);
  },
  AnimHyperBeamOrb(s) {
    startAnim(s, rnd(0, Math.max(0, (s.tmpl.an.length || 1) - 1)));
    initAtk(s);
    linearTo(s, rnd(18, 30), TGT_X, TGT_Y);
  },
  AnimHiddenPowerOrb(s) {
    initAtk(s);
    linearTo(s, 20, TGT_X, TGT_Y, 10);
  },
  AnimHiddenPowerOrbScatter(s) {
    initTgt(s);
    burstAround(s, 26, 2.4, -0.03);
  },
  AnimReversalOrb(s) {
    s.gx = ATK_X;
    s.gy = ATK_Y;
    const dur = Math.max(1, A(s.args, 0, 26));
    let phase = A(s.args, 1, 0) & 255;
    let growX = 0;
    let growY = 0;
    let t = 0;
    let shrink = false;
    s.onTick = () => {
      s.x2 = angleSin(phase, growX >> 8);
      s.y2 = angleCos(phase, growY >> 8);
      phase = (phase + 9) & 255;
      if (!shrink) {
        growX += 0x400;
        growY += 0x100;
        if (++t >= dur) { t = 0; shrink = true; }
      } else {
        growX -= 0x400;
        growY -= 0x100;
        if (++t >= dur) s.dead = true;
      }
    };
  },
  AnimMimicOrb(s) {
    initTgt(s);
    const x0 = s.gx, y0 = s.gy;
    const dx = ATK_X - x0, dy = ATK_Y - y0;
    s.onTick = () => {
      const k = Math.min(1, s.age / 24);
      s.x2 = dx * k;
      s.y2 = dy * k * s.E.dirY;
      s.sx = s.sy = 0.5 + k * 0.9;
      if (k >= 1) s.dead = true;
    };
  },
  AnimPainSplitProjectile(s) {
    initAtk(s);
    linearTo(s, 20, TGT_X, TGT_Y, 12);
  },
  AnimPsychoBoostOrb(s) {
    s.gx = TGT_X + rnd(-40, 40); s.gy = TGT_Y + rnd(-30, 30);
    linearTo(s, 22, TGT_X, TGT_Y, 12);
  },
  AnimMudShotOrb(s) {
    initAtk(s);
    linearTo(s, 18, TGT_X, TGT_Y, 14);
  },
  AnimShadowBall(s) {
    s.gx = ATK_X;
    s.gy = ATK_Y;
    linearTo(s, 22, TGT_X, TGT_Y, 6);
  },
  AnimOctazookaBall(s) {
    initAtk(s);
    linearTo(s, 18, TGT_X, TGT_Y, 10);
  },
  AnimWeatherBallUp(s) {
    initAtk(s);
    drift(s, 0, -2.4, 22, false);
  },
  AnimWeatherBallDown(s) {
    s.gx = TGT_X + A(s.args, 0); s.gy = TGT_Y - 90 * s.E.dirY;
    s.onTick = () => {
      s.y2 += 3.2;
      if (s.age > 18) s.dead = true;
    };
  },
  AnimWeatherBallFireDown(s) { CB.AnimWeatherBallDown(s); },
  AnimWeatherBallWaterDown(s) { CB.AnimWeatherBallDown(s); },
  AnimWeatherBallRockDown(s) { CB.AnimWeatherBallDown(s); },
  AnimWeatherBallIceDown(s) { CB.AnimWeatherBallDown(s); },
  // ---------------------------------------------------------------- flames
  AnimFirePlume(s) { flameDrift(s); },
  AnimLargeFlame(s) { flameDrift(s); },
  AnimOverheatFlame(s) {
    s.gx = ATK_X; s.gy = ATK_Y + A(s.args, 4);
    const ang = A(s.args, 1);
    const ex = angleCos(ang, A(s.args, 2)) * A(s.args, 0);
    const ey = angleSin(ang, Math.floor((A(s.args, 2) * 3) / 5)) * A(s.args, 0);
    s.gx += ex; s.gy += ey;
    s.onTick = () => { s.x2 += angleCos(ang, 1.2); s.y2 += angleSin(ang, 0.8) - 0.4; };
    popAndFade(s, Math.max(8, A(s.args, 3, 30)));
  },
  AnimOutrageFlame(s) {
    const outrage = s.E.label === 'Move_OUTRAGE';
    if (outrage) {
      s.gx = ATK_X + rnd(-14, 14);
      s.gy = ATK_Y + rnd(-12, 12);
      let phase = rnd(0, 255);
      let t = 0;
      const dur = Math.max(6, A(s.args, 2, 30));
      s.onTick = () => {
        t++;
        s.x2 = angleSin(phase, 8);
        s.y2 -= 0.8;
        phase = (phase + 8) & 255;
        s.visible = (t & 1) === 0;
        if (t > dur) s.dead = true;
      };
      return;
    }
    initAtk(s);
    s.y2 += A(s.args, 1);
    const vx = A(s.args, 3, 0) / 256;
    const dur = Math.max(6, A(s.args, 2, 30));
    s.onTick = () => {
      s.x2 += vx;
      s.visible = (s.age & 1) === 0;
      if (s.age > dur) s.dead = true;
    };
  },
  AnimTravelDiagonally(s) {
    const startSide = A(s.args, 5, 0) === 0 ? 'bp' : 'be';
    const p = gba(startSide);
    const dur = Math.max(4, A(s.args, 4, 20));
    s.gx = p.x + A(s.args, 0);
    s.gy = p.y + A(s.args, 1);
    // 打鼾的 Z 要飞向对手，而不是落在攻击方附近
    if (s.E.label === 'Move_SNORE') {
      linearTo(s, dur, TGT_X + A(s.args, 2), TGT_Y + A(s.args, 3), 0);
      return;
    }
    linearTo(s, dur, p.x + A(s.args, 2), p.y + A(s.args, 3), 0);
  },
  AnimEmberFlare(s) {
    if (s.E.label === 'Move_EMBER') {
      s.gx = TGT_X;
      s.gy = TGT_Y;
      s.onTick = () => {
        s.x2 = angleSin(s.age * 8, 3);
        if (s.age > 30) s.dead = true;
      };
      return;
    }
    CB.AnimTravelDiagonally(s);
  },
  AnimFireSpread(s) {
    s.gx = TGT_X + A(s.args, 0);
    s.gy = TGT_Y + A(s.args, 1);
    const vx = A(s.args, 2, 0) / 256;
    const vy = A(s.args, 3, 0) / 256;
    const dur = Math.max(6, A(s.args, 4, 40));
    s.onTick = () => {
      s.x2 += vx;
      s.y2 += vy;
      if (s.age > dur) s.dead = true;
    };
  },
  AnimFireSpiralInward(s) {
    const ang = A(s.args, 0);
    const atk = s.E.label === 'Move_FIRE_PUNCH';
    s.gx = (atk ? ATK_X : TGT_X) + angleCos(ang, 34);
    s.gy = (atk ? ATK_Y : TGT_Y) + angleSin(ang, 22);
    s.onTick = () => {
      const k = s.age / 34;
      s.x2 = -angleCos(ang, 34) * k;
      s.y2 = -angleSin(ang, 22) * k;
      if (k > 1) s.dead = true;
    };
  },
  AnimFireSpiralOutward(s) {
    if (s.E.label === 'Move_FLAME_WHEEL') {
      initAtk(s);
      const idx = Math.min(3, Math.max(0, Math.round(A(s.args, 3, 0) / 4)));
      const life = Math.max(20, A(s.args, 2, 56));
      const start = s.E._flameStart ?? s.E.frame;
      const base = 128;
      const spread = 12;
      const radius = 28;
      s.sx = s.sy = 0.55 + idx * 0.22;
      s.onTick = () => {
        const elapsed = s.E.frame - start;
        const a = (base + elapsed * 7 + (idx - 1.5) * spread) & 255;
        s.x2 = angleCos(a, radius) * s.E.dirX;
        s.y2 = -angleSin(a, radius);
        if (elapsed > life) s.dead = true;
      };
      return;
    }
    initAtk(s);
    const life = Math.max(1, A(s.args, 2, 56));
    const delay = Math.max(0, A(s.args, 3, 0));
    let t = 0;
    let phase = 0;
    let radius = 0;
    s.visible = false;
    s.onTick = () => {
      t++;
      if (t <= delay) return;
      s.visible = true;
      if (t > delay + life) { s.dead = true; return; }
      phase = (phase + 10) & 255;
      radius += 0xD0;
      s.x2 = angleSin(phase, radius >> 8);
      s.y2 = angleCos(phase, radius >> 8);
    };
  },
  AnimWillOWispOrb(s) {
    initAtk(s);
    linearTo(s, 22, TGT_X, TGT_Y, 12);
  },
  AnimWillOWispFire(s) {
    s.gx = TGT_X;
    s.gy = TGT_Y;
    let phase = A(s.args, 0, 0);
    let growX = 0;
    let growY = 0;
    s.onTick = () => {
      growX += 0x180;
      growY += 0xA0;
      s.x2 = angleSin(phase, growX >> 8);
      s.y2 = angleCos(phase, growY >> 8);
      phase = (phase + 7) & 255;
      if (s.age > 30) s.dead = true;
    };
  },
  AnimBurnFlame(s) {
    s.gx = TGT_X + A(s.args, 0, 0);
    s.gy = TGT_Y + A(s.args, 1, 0);
    s.onTick = () => {
      s.y2 -= 1.15;
      s.x2 += angleSin(s.age * 3, 2);
      if (s.age > 30) s.dead = true;
    };
  },
  AnimDragonRageFirePlume(s) {
    initAtk(s);
    linearTo(s, 20, TGT_X, TGT_Y, 8);
  },
  AnimDragonBreathFire(s) {
    initAtk(s);
    drift(s, A(s.args, 1, 1.6), A(s.args, 2, 0), Math.max(10, A(s.args, 3, 28)));
  },
  AnimDragonFireToTarget(s) {
    initAtk(s);
    linearTo(s, Math.max(8, A(s.args, 3, 18)), TGT_X, TGT_Y, 6);
  },
  // 龙之舞：环状光球绕攻击方旋转，随后向外炸开
  AnimDragonDanceOrb(s) {
    s.gx = ATK_X;
    s.gy = ATK_Y;
    let phase = A(s.args, 0, 0) & 255;
    let radius = 22;
    let speed = 1;
    let speedT = 0;
    s.life = 82;
    s.onTick = () => {
      const t = s.age;
      phase = (phase - speed) & 255;
      if (++speedT > 5) { speedT = 0; if (speed < 16) speed++; }
      if (t > 60) radius = Math.min(150, radius + 8);
      s.x2 = angleCos(phase, radius);
      s.y2 = angleSin(phase, radius);
    };
  },
  AnimFireRing(s) {
    initAtk(s);
    s.sx = 1.1;
    s.sy = 1.1;
    const x0 = s.gx;
    const y0 = s.gy;
    let t = 0;
    s.onTick = () => {
      t++;
      if (t <= 12) {
        s.x2 = angleCos(t * 20, 12);
        s.y2 = angleSin(t * 20, 12);
      } else if (t <= 42) {
        const k = (t - 12) / 30;
        s.x2 = (TGT_X - x0) * k + angleCos(t * 20, 8);
        s.y2 = (TGT_Y - y0) * k * s.E.dirY + angleSin(t * 20, 8);
      } else s.dead = true;
    };
  },
  AnimFireCross(s) {
    initTgt(s);
    s.sx = 1.15;
    s.sy = 1.15;
    popAndFade(s, 24);
  },
  AnimFireBlastRing(s) { CB.AnimFireRing(s); },
  AnimFireBlastCross(s) { CB.AnimFireCross(s); },
  // ------------------------------------------------------------------ rocks
  AnimFallingRock(s) {
    if (s.E.label === 'Move_ROCK_SLIDE') {
      const startY = TGT_Y - 80 * s.E.dirY;
      const endY = TGT_Y + 18 * s.E.dirY;
      s.gx = TGT_X + A(s.args, 0, 0) + rnd(-4, 4);
      s.gy = startY;
      startAnim(s, A(s.args, 1, 0));
      let t = 0;
      s.onTick = () => {
        t++;
        const k = Math.min(1, t / 24);
        s.x2 = A(s.args, 2, 0) * k;
        s.y2 = (endY - startY) * k * s.E.dirY;
        s.rot += 6;
        if (k >= 1) s.dead = true;
      };
      return;
    }
    s.gx = TGT_X + A(s.args, 0) + rnd(-18, 18);
    s.gy = TGT_Y - (110 + rnd(0, 40)) * s.E.dirY;
    s.onTick = () => {
      s.y2 += 3.4;
      s.rot += 6;
      if (s.y2 > 100) s.dead = true;
    };
  },
  AnimRaiseSprite(s) {
    const x0 = ATK_X + A(s.args, 0, 0);
    const y0 = ATK_Y + A(s.args, 1, 0);
    const rise = A(s.args, 2, -48);
    const dur = Math.max(1, A(s.args, 3, 30));
    startAnim(s, A(s.args, 4, 0));
    s.gx = x0;
    s.gy = y0;
    let t = 0;
    s.onTick = () => {
      t++;
      if (t <= dur) {
        s.y2 = rise * (t / dur);
        return;
      }
      const k = Math.min(1, (t - dur) / 18);
      s.x2 = (TGT_X - x0) * k;
      s.y2 = rise * (1 - k) + (TGT_Y - y0) * k * s.E.dirY;
      if (k >= 1) {
        const hit = s.E.createSprite('gBasicHitSplatSpriteTemplate', true, 2, [0, 0, 1, 1]);
        if (hit) { hit.gx = TGT_X; hit.gy = TGT_Y; }
        s.dead = true;
      }
    };
  },
  AnimRockFragment(s) {
    if (s.E.label === 'Move_ROCK_SMASH') { s.gx = TGT_X; s.gy = TGT_Y; }
    burstAround(s, 24, 2.2, 0.12);
  },
  AnimRockScatter(s) {
    // 碎片围绕目标身体炸开，不再按原脚本的大 y 偏移落到脚下
    s.gx = TGT_X + A(s.args, 0, 0) * 0.35;
    s.gy = TGT_Y + A(s.args, 1, 0) * 0.2;
    startAnim(s, A(s.args, 3, 0));
    const vx = A(s.args, 0, 0);
    const amp = A(s.args, 2, 3);
    s.sx = 1.12;
    s.sy = 1.12;
    let t = 0;
    s.onTick = () => {
      t++;
      s.x2 += vx * 0.16;
      s.y2 -= Math.sin(t * 0.35) * amp * 0.18;
      if (t > 20) s.dead = true;
    };
  },
  AnimAncientPowerRock(s) {
    const ang = A(s.args, 0);
    s.onTick = () => {
      s.x2 = angleCos(ang + s.age * 3, 30);
      s.y2 = angleSin(ang + s.age * 3, 20);
      if (s.age > 34) s.dead = true;
    };
  },
  AnimRockTombRock(s) {
    s.gx = TGT_X + rnd(-30, 30); s.gy = TGT_Y - 120 * s.E.dirY;
    s.onTick = () => { s.y2 += 4; if (s.y2 > 90) s.dead = true; };
  },
  AnimEruptionLaunchRock(s) { initAtk(s); burstAround(s, 26, 2.4, 0.1); },
  AnimEruptionFallingRock(s) { CB.AnimFallingRock(s); },
  AnimRockBlastRock(s) {
    initAtk(s);
    linearTo(s, 16, TGT_X, TGT_Y, 10);
  },
  AnimTwisterRock(s) {
    twisterParticle(s);
  },
  // -------------------------------------------------------------------- ice
  AnimIceEffectParticle(s) { initTgt(s); burstAround(s, 26, 2.2, 0.04); },
  AnimIceGroundSpike(s) {
    if (A(s.args, 2) === 0) initTgt(s); else { initTgt(s); s.x2 += A(s.args, 0); s.y2 += A(s.args, 1); }
    dieWhenAnimEnds(s, 60);
  },
  AnimSwirlingSnowball(s) {
    const ang = A(s.args, 0);
    s.onTick = () => {
      const k = s.age / 28;
      s.x2 = angleCos(ang + s.age * 6, 30) * (1 - k);
      s.y2 = angleSin(ang + s.age * 6, 20) * (1 - k);
      if (k >= 1) s.dead = true;
    };
  },
  AnimPowderSnowSnowball(s) {
    s.gx = TGT_X + rnd(-40, 40); s.gy = TGT_Y - 60 * s.E.dirY;
    s.onTick = () => { s.y2 += 2.2; if (s.age > 24) s.dead = true; };
  },
  AnimBlizzardIceCrystal(s) {
    s.gx = TGT_X + rnd(-40, 40); s.gy = TGT_Y + rnd(-30, 30);
    burstAround(s, 24, 2.0, 0);
  },
  AnimIceCrystalHitSmall(s) { initTgt(s); s.x2 = A(s.args, 0); s.y2 = A(s.args, 1); popAndFade(s, 18); },
  AnimIceCrystalHitLarge(s) { initTgt(s); s.x2 = A(s.args, 0); s.y2 = A(s.args, 1); popAndFade(s, 24); },
  InitIceBallAnim(s) {
    initAtk(s);
    const dur = Math.max(8, A(s.args, 4, 30));
    const tx = TGT_X + A(s.args, 2, 0);
    const ty = TGT_Y + A(s.args, 3, 0);
    const arc = Math.abs(A(s.args, 5, 40));
    s.sx = 1.1;
    s.sy = 1.1;
    s.rotSpeed = 6;
    linearTo(s, dur, tx, ty, arc);
  },
  AnimIceBeamOuterCrystal(s) {
    initAtk(s);
    linearTo(s, Math.max(6, A(s.args, 4, 20)), TGT_X + A(s.args, 2), TGT_Y + A(s.args, 3), 4);
  },
  AnimIceBeamInnerCrystal(s) {
    initAtk(s);
    linearTo(s, Math.max(6, A(s.args, 4, 11)), TGT_X, TGT_Y, 0);
  },
  AnimIceCrystalSpiralInwardSmall(s) { spiralIn(s, 'be', 20); },
  AnimIceCrystalSpiralInwardLarge(s) { spiralIn(s, 'be', 26); },
  AnimIcePunchSwirlingParticle(s) { spiralIn(s, 'be', 22); },
  // -------------------------------------------------------------- electric
  AnimLightning(s) {
    const thunder = s.E.label === 'Move_THUNDER';
    if (thunder) {
      if (A(s.args, 0) !== 16) { s.dead = true; return; }
      const session = s.E;
      if (!session._thunderImpacted) {
        session._thunderImpacted = true;
        try { session.opts?.onImpact?.(); } catch (_) {}
      }
    }
    const xoff = thunder ? 0 : A(s.args, 0);
    s.gx = TGT_X + (s.E.opponent ? -xoff : xoff);
    s.gy = TGT_Y + A(s.args, 1);
    startAnim(s, 0);
    s.life = 30;
    s.dieOnLife = true;
  },
  AnimThunderWave(s) {
    s.gx = TGT_X + A(s.args, 0, 0);
    s.gy = TGT_Y + A(s.args, 1, 0);
    if (A(s.args, 2, 0) === 0) {
      const twin = s.E.createSprite('gThunderWaveSpriteTemplate', true, 2, [A(s.args, 0, 0), A(s.args, 1, 0), 1]);
      if (twin) {
        twin.gx = s.gx + 32;
        twin.gy = s.gy;
        startAnim(twin, 1);
        s._waveTwinSprite = twin;
      }
    }
    let t = 0;
    s.onTick = () => {
      t++;
      s.visible = Math.floor(t / 3) % 2 === 0;
      if (s._waveTwinSprite) s._waveTwinSprite.visible = s.visible;
      if (t >= 51) {
        s.dead = true;
        if (s._waveTwinSprite) s._waveTwinSprite.dead = true;
      }
    };
  },
  AnimElectricity(s) {
    initTgt(s);
    if (s.anim) s.anim.frame = clamp(A(s.args, 3, 0), 0, Math.max(0, (s.tmpl.frames || 1) - 1));
    s.life = Math.max(4, A(s.args, 2, 6));
  },
  AnimSparkElectricityFlashing(s) {
    const useTarget = (A(s.args, 7, 0) & 0x8000) !== 0;
    const p = gba(useTarget ? 'be' : 'bp');
    s.gx = p.x + A(s.args, 0, 0);
    s.gy = p.y + A(s.args, 1, 0);
    startAnim(s, A(s.args, 6, 0));
    const amp = A(s.args, 2, 0);
    const life = Math.min(60, Math.max(4, A(s.args, 3, 20)));
    const speed = A(s.args, 5, 0);
    const interval = A(s.args, 7, 0) & 0x7FFF;
    let phase = A(s.args, 4, 0);
    s.life = life;
    s.onTick = () => {
      s.x2 = angleSin(phase, amp);
      s.y2 = angleCos(phase, amp);
      phase = (phase + speed) & 0xFF;
      if (interval > 0 && phase % interval === 0) s.visible = !s.visible;
    };
  },
  AnimSparkElectricity(s) {
    const battler = A(s.args, 4, 1);
    s.gx = (sideOf(battler) === 'bp' ? ATK_X : TGT_X) + A(s.args, 1);
    s.gy = (sideOf(battler) === 'bp' ? ATK_Y : TGT_Y) + A(s.args, 2);
    startAnim(s, A(s.args, 0));
    dieWhenAnimEnds(s, 30);
  },
  AnimZapCannonSpark(s) {
    initTgt(s);
    s.x2 = A(s.args, 0); s.y2 = A(s.args, 1);
    flicker(s, 20);
  },
  AnimElectricPuff(s) { initTgt(s); burstAround(s, 20, 1.8, 0); },
  AnimThunderboltOrb(s) {
    s.gx = TGT_X + A(s.args, 0); s.gy = TGT_Y + A(s.args, 1);
    dieWhenAnimEnds(s, 30);
  },
  AnimSparkH(s) {
    s.gx = TGT_X + rnd(-20, 20); s.gy = TGT_Y + rnd(-16, 16);
    flicker(s, 16);
  },
  AnimShockWaveProgressingBolt(s) {
    initAtk(s);
    linearTo(s, 18, TGT_X, TGT_Y, 14);
  },
  AnimVoltTackleBolt(s) { spiralIn(s, 'be', 18); },
  AnimVoltTackleOrbSlide(s) {
    initAtk(s);
    linearTo(s, 18, TGT_X, TGT_Y, 8);
  },
  AnimGrowingChargeOrb(s) { initAtk(s); s.sx = 0.2; s.sy = 0.2; dieWhenAnimEnds(s, 40); },
  AnimGrowingShockWaveOrb(s) { initAtk(s); s.sx = 0.2; s.sy = 0.2; dieWhenAnimEnds(s, 40); },
  // ------------------------------------------------------------- particles
  AnimMovePowderParticle(s) {
    s.gx = TGT_X + A(s.args, 0);
    s.gy = TGT_Y + A(s.args, 1) * s.E.dirY;
    const life = Math.max(1, Math.min(36, A(s.args, 2, 20)));
    let left = life;
    const fall = Math.max(60, A(s.args, 3, 80)) * 3;
    const amp = Math.abs(A(s.args, 4, 5));
    const speed = Math.max(1, A(s.args, 5, 1));
    let phase = rnd(0, 255);
    let pos = 0;
    s.onTick = () => {
      if (--left <= 0) { s.dead = true; return; }
      pos += fall;
      s.x2 = angleSin(phase, amp);
      s.y2 = pos >> 8;
      phase = (phase + speed) & 255;
    };
  },
  AnimSporeParticle(s) {
    s.gx = TGT_X + A(s.args, 0, 0);
    s.gy = TGT_Y + A(s.args, 1, 0) * s.E.dirY;
    startAnim(s, A(s.args, 4, 0));
    let life = Math.max(1, Math.min(40, A(s.args, 3, 80)));
    let phase = A(s.args, 2, 0);
    let drop = 0;
    s.onTick = () => {
      phase = (phase + 2) & 255;
      drop += 160;
      s.x2 = angleSin(phase, 32);
      s.y2 = angleCos(phase, -3) + (drop >> 8);
      if (--life < 0) s.dead = true;
    };
  },
  AnimParticleInVortex(s) {
    const sand = (s.tmpl.img || '').includes('MudSand');
    const fireSpin = s.E.label === 'Move_FIRE_SPIN';
    const whirlpool = s.E.label === 'Move_WHIRLPOOL';
    const dragonClaw = s.E.label === 'Move_DRAGON_CLAW';
    if (A(s.args, 6, 1) === 0) initAtk(s); else initTgt(s);
    let life = Math.max(4, A(s.args, 3, 20));
    let y = 0;
    let yv = A(s.args, 2, 20) / 256;
    let speed = A(s.args, 4, 4);
    let amp = A(s.args, 5, 16);
    let phase = 0;
    if (sand) {
      s.gy = TGT_Y + 8;
      life = 36;
      yv = 0.75;
      speed = 14;
      amp = 12;
      phase = rnd(0, 255);
      s.sx = 1.4;
      s.sy = 1.4;
    } else if (fireSpin) {
      s.gy = TGT_Y + 10 * s.E.dirY;
      life = 40;
      yv = 0.55;
      speed = 18;
      amp = 16;
      phase = rnd(0, 255);
    } else if (dragonClaw) {
      life = 24;
      yv = 0.65;
      speed = 18;
      amp = 12;
      phase = rnd(0, 255);
      s.sx = 0.65;
      s.sy = 0.65;
    } else if (whirlpool) {
      s.gx = TGT_X;
      s.gy = TGT_Y + 8;
      s.sx = 0.9;
      s.sy = 0.9;
      let angle = rnd(0, 255);
      let rise = 0;
      let left = 34;
      s.onTick = () => {
        if (--left <= 0) { s.dead = true; return; }
        rise += 0.9;
        s.x2 = angleSin(angle, 16);
        s.y2 = -rise * s.E.dirY;
        angle = (angle + 16) & 255;
      };
      return;
    }
    s.onTick = () => {
      if (--life <= 0) { s.dead = true; return; }
      y += yv; s.y2 = -y;
      s.x2 = angleSin(phase, amp);
      phase = (phase + speed) & 255;
      if (sand && life < 7) s.alpha = Math.max(0, life / 7);
    };
  },
  AnimParticleBurst(s) {
    const vx = A(s.args, 0, 0);
    const amp = A(s.args, 1, 0);
    let acc = 0;
    let phase = 0;
    s.onTick = () => {
      acc += vx;
      s.x2 = acc >> 8;
      s.y2 = angleSin(phase, amp);
      phase = (phase + 3) & 255;
      if (phase > 100) s.visible = phase % 2 === 0;
      if (phase > 120) s.dead = true;
    };
  },
  AnimGreenStar(s) {
    const p = gba(s.E.statusSide ? 'be' : 'bp');
    s.gx = p.x + rnd(-32, 32);
    s.gy = p.y + 32;
    const life = Math.max(6, A(s.args, 0, 30));
    const vy = A(s.args, 1, 0) / 256;
    s.onTick = () => {
      s.y2 -= vy;
      if (s.age > life) s.dead = true;
    };
  },
  AnimSuperpowerRock(s) {
    s.gx = A(s.args, 0, 80);
    s.gy = 120;
    const rise = Math.abs(A(s.args, 1, 248)) / 256;
    const riseFrames = Math.max(1, A(s.args, 3, 4));
    s.onTick = () => {
      if (s.age <= riseFrames) {
        s.gy -= rise;
      } else {
        const k = Math.min(1, (s.age - riseFrames) / 22);
        s.x2 = (TGT_X - s.gx) * k;
        s.y2 = (TGT_Y - s.gy) * k * s.E.dirY;
        if (k >= 1) s.dead = true;
      }
    };
  },
  AnimOrbitScatter(s) {
    const ang = rnd(0, 255);
    s.onTick = () => {
      s.x2 = angleCos(ang + s.age * 5, 26);
      s.y2 = angleSin(ang + s.age * 5, 18);
      if (s.age > 34) s.dead = true;
    };
  },
  AnimFlyingParticle(s) {
    const battler = A(s.args, 6, 0) ? 'be' : 'bp';
    const m = gba(battler);
    // 全屏风粒子：铺满整个宽度，统一沿 +x 吹；stagePoint 在敌方出招时会自动映射成向左
    s.gx = rnd(-24, 240);
    s.gy = A(s.args, 5, 0) === 2 || A(s.args, 5, 0) === 3 ? m.y + A(s.args, 0) : A(s.args, 0);
    const speed = 3 + Math.min(4, Math.abs(A(s.args, 3, 0)) / 48);
    let t = 0;
    s.onTick = () => {
      t++;
      s.x2 += speed;
      s.y2 = angleSin(t * A(s.args, 2, 6), A(s.args, 1, 8));
      if (s.x2 > 300) s.dead = true;
    };
  },
  AnimSword(s) {
    initTgt(s);
    popAndFade(s, 24);
  },
  // ------------------------------------------------------------------ slashes
  AnimFurySwipes(s) {
    s.gx = TGT_X;
    s.gy = TGT_Y;
    s.x2 = A(s.args, 0, 0);
    s.y2 = A(s.args, 1, 0);
    startAnim(s, A(s.args, 2, 0));
    dieWhenAnimEnds(s, 30);
  },
  AnimClawSlash(s) {
    initTgt(s);
    if (A(s.args, 0)) { s.x2 = A(s.args, 0); s.y2 = A(s.args, 1); }
    popAndFade(s, 22);
  },
  AnimSlashSlice(s) {
    const onTarget = A(s.args, 0, 0) !== 0;
    s.gx = (onTarget ? TGT_X : ATK_X) + A(s.args, 1, 0);
    s.gy = (onTarget ? TGT_Y : ATK_Y) + A(s.args, 2, 0);
    s.sx = 1.15;
    s.sy = 1.15;
    s.life = 46;
    s.dieOnLife = true;
  },
  AnimCuttingSlice(s) { initTgt(s); popAndFade(s, 22); },
  AnimAirCutterSlice(s) { initTgt(s); popAndFade(s, 20); },
  AnimFalseSwipeSlice(s) { initTgt(s); popAndFade(s, 20); },
  AnimFalseSwipePositionedSlice(s) { initTgt(s); popAndFade(s, 20); },
  AnimBite(s) {
    const sharp = (s.tmpl.img || '').includes('Gfx_SharpTeeth');
    if (sharp) {
      // 尖牙统一在目标中心上下咬合：上牙原样、下牙旋转 180°，不走斜向 affine
      const lower = A(s.args, 1, 0) > 0 || (A(s.args, 1, 0) === 0 && A(s.args, 4, 0) < 0);
      s.gx = TGT_X;
      s.gy = TGT_Y + (lower ? 30 : -30) * s.E.dirY;
      s.rot = lower ? 180 : 0;
      s.sx = s.sy = 1;
      const vy = Math.abs(A(s.args, 4, 819) / 256);
      const dur = Math.max(1, A(s.args, 5, 10));
      let t = 0;
      let y = 0;
      s.onTick = () => {
        t++;
        if (t <= dur) y += lower ? -vy : vy;
        else y -= lower ? -vy : vy;
        s.y2 = y;
        if (t >= dur * 2) s.dead = true;
      };
      return;
    }
    // 上下/左右两片牙（钳）从两侧咬合
    s.gx = TGT_X + A(s.args, 0);
    s.gy = TGT_Y + A(s.args, 1);
    startAffine(s, A(s.args, 2, 0));
    const vx = A(s.args, 3, 0) / 256;
    const vy = A(s.args, 4, 0) / 256;
    const dur = Math.max(1, A(s.args, 5, 10));
    let t = 0;
    let x = 0;
    let y = 0;
    s.onTick = () => {
      t++;
      if (t <= dur) { x += vx; y += vy; }
      else { x -= vx; y -= vy; }
      s.x2 = x;
      s.y2 = y;
      if (t >= dur * 2) s.dead = true;
    };
  },  AnimSharpTeeth(s) { initTgt(s); popAndFade(s, 24); },
  AnimFang(s) {
    initTgt(s);
    s.x2 = A(s.args, 0);
    s.y2 = A(s.args, 1);
    dieWhenAnimEnds(s, 60);
  },
  // ------------------------------------------------------------------- rings
  AnimThinRingExpanding(s) { ringExpand(s); },
  AnimThinRingShrinking(s) { ringShrink(s); },
  AnimBlendThinRingExpanding(s) { ringExpand(s); },
  AnimGoldRing(s) { ringExpand(s); },
  AnimGuardRing(s) { ringExpand(s); },
  AnimSupersonicRing(s) {
    initAtk(s);
    const dur = Math.max(8, A(s.args, 4, 30));
    s.onTick = () => {
      s.x2 = A(s.args, 0) * (s.age / dur);
      s.y2 = A(s.args, 1) * (s.age / dur);
      s.sx = s.sy = 1 + s.age / dur;
      if (s.age > dur) s.dead = true;
    };
  },
  AnimScreechRing(s) { ringExpand(s); },
  AnimWaterPulseRing(s) {
    initAtk(s);
    startAffine(s, 0);
    if (s.el) s.el.style.filter = 'hue-rotate(200deg) saturate(1.5) brightness(1.05)';
    const dur = Math.max(1, A(s.args, 2, 40));
    const dx = TGT_X - s.gx;
    const dy = TGT_Y - s.gy;
    let t = 0;
    s.onTick = () => {
      t++;
      const k = Math.min(1, t / dur);
      s.x2 = dx * k;
      s.y2 = dy * k * s.E.dirY;
      if (t >= dur) s.dead = true;
    };
  },
  AnimAuroraBeamRing(s) { initAtk(s); linearTo(s, 20, TGT_X, TGT_Y, 10); },
  AnimLusterPurgeCircle(s) { initTgt(s); ringExpand(s); },
  AnimCircleImpact(s) { initTgt(s); ringExpand(s); },
  AnimCircleOfLight(s) { initAtk(s); ringExpand(s); },
  AnimWhiteHalo(s) { initAtk(s); ringExpandShrink(s); },
  AnimUproarRing(s) { initTgt(s); ringExpand(s); },
  // -------------------------------------------------------------------- misc
  AnimSpriteOnMonPos(s) {
    if (s.E.label === 'Move_TOXIC') {
      const eng = s.E.E;
      const a = eng.anchors || { atk: { x: ATK_X, y: ATK_Y }, tgt: { x: TGT_X, y: TGT_Y } };
      const sx = (a.tgt.x - a.atk.x) / (TGT_X - ATK_X) || 1;
      const sy = (a.tgt.y - a.atk.y) / (TGT_Y - ATK_Y) || 1;
      const onTarget = A(s.args, 2, 0) !== 0;
      const img = s.E.imgFor(s.E.opponent ? (onTarget ? 'bp' : 'be') : (onTarget ? 'be' : 'bp'));
      const scale = ((img?.getBoundingClientRect().height || 64) / 64);
      s.gx = (onTarget ? TGT_X : ATK_X) + (A(s.args, 0) * scale) / sx;
      s.gy = (onTarget ? TGT_Y : ATK_Y) + (A(s.args, 1) * scale) / sy;
    } else if (!A(s.args, 3)) {
      if (A(s.args, 2) === 0) initAtk(s); else initTgt(s);
    } else {
      const p = gba(A(s.args, 2) === 0 ? 'bp' : 'be');
      s.gx = p.x + A(s.args, 0);
      s.gy = p.y + A(s.args, 1) * s.E.dirY;
    }
    if (s.tmpl.af?.[0]?.length) {
      startAffine(s, 0);
      dieWhenAffineEnds(s, 120);
    } else {
      dieWhenAnimEnds(s, 120);
    }
  },
  AnimWaveFromCenterOfTarget(s) {
    s.gx = TGT_X + A(s.args, 0);
    s.gy = TGT_Y + A(s.args, 1);
    dieWhenAnimEnds(s, 90);
  },
  AnimNeedleArmSpike(s) {
    const useTarget = A(s.args, 0) !== 0;
    const p = gba(useTarget ? 'be' : 'bp');
    const dur = Math.max(4, A(s.args, 4, 20));
    const fromAtk = A(s.args, 1) === 0;
    const px = A(s.args, 2), py = A(s.args, 3);
    const sx = fromAtk ? p.x + px : p.x;
    const sy = fromAtk ? p.y + py : p.y;
    const ex = fromAtk ? p.x : p.x + px;
    const ey = fromAtk ? p.y : p.y + py;
    s.gx = sx; s.gy = sy;
    aimAt(s, sx, sy, ex, ey);
    linearTo(s, dur, ex, ey, 0);
  },
  AnimRazorLeafParticle(s) {
    initAtk(s);
    let t = Math.max(1, A(s.args, 2, 10));
    let phase = 0;
    s.onTick = () => {
      if (t-- > 0) { s.x2 += A(s.args, 0, 0); s.y2 += A(s.args, 1, -2); return; }
      s.x2 = angleSin(phase, 25);
      phase = (phase + 2) & 255;
      if (s.age & 1) s.y2 += 1;
      if (s.age > 80) s.dead = true;
    };
  },
  AnimRazorLeafCutter(s) {
    s.gx = TGT_X + A(s.args, 0, 20);
    s.gy = TGT_Y + A(s.args, 1, -10);
    s.rotSpeed = 18;
    let vy = A(s.args, 2, 20) / 20;
    s.onTick = () => {
      s.x2 -= 2.2;
      s.y2 += vy;
      if (s.age > 50) s.dead = true;
    };
  },
  AnimFlyingSandCrescent(s) {
    // 沙暴片段（最后一个参数为 0）改成绕目标打转的局部沙流；热风等继续横穿画面
    if (A(s.args, 3, 1) === 0) {
      initTgt(s);
      s.gx = TGT_X;
      s.gy = TGT_Y + 8 + (A(s.args, 0, 10) - 45) * 0.18;
      s.sx = s.sy = 1.0;
      let phase = (A(s.args, 0, 10) * 5) & 255;
      let rise = 0;
      s.onTick = () => {
        phase = (phase + 10) & 255;
        s.x2 = angleSin(phase, 16);
        s.y2 = angleCos(phase, 7) - rise;
        rise += 0.35;
        if (s.age > 48) s.dead = true;
      };
      return;
    }
    s.gx = -64;
    s.gy = A(s.args, 0, 10);
    const vx = A(s.args, 1, 2304) / 256;
    const vy = A(s.args, 2, 96) / 256;
    s.onTick = () => {
      s.x2 += vx;
      s.y2 += vy;
      if (s.x2 > 340) s.dead = true;
    };
  },
  AnimSweetScentPetal(s) {
    const player = !s.E.opponent;
    const y0 = A(s.args, 0, 0);
    absToGba(s, player ? 0 : 240, player ? y0 : y0 - 30);
    startAnim(s, A(s.args, 1, 0));
    let phase = 0;
    s.onTick = () => {
      phase += 3;
      s.x2 += 5;
      s.gy -= 1;
      s.y2 = player ? angleSin(phase & 255, 16) : -angleCos(phase & 255, 16);
      if (s.age > 50) s.dead = true;
    };
  },
  AnimPetalDanceBigFlower(s) { initTgt(s); popAndFade(s, 34); },
  AnimPetalDanceSmallFlower(s) { initTgt(s); burstAround(s, 34, 1.6, -0.02); },
  AnimAromatherapySmallFlower(s) { drift(s, rnd(-1, 1), -1.2, 34); },
  AnimAromatherapyBigFlower(s) { initAtk(s); drift(s, rnd(-1, 1), -1.4, 36); },
  AnimTearDrop(s) { initTgt(s); drift(s, 0, 1.6, 26); },
  AnimFallingFeather(s) { initTgt(s); drift(s, rnd(-1, 1), 1.1, 34); },
  AnimRedHeartRising(s) { initAtk(s); drift(s, rnd(-0.7, 0.7), -1.4, 32); },
  AnimMagentaHeart(s) { initAtk(s); drift(s, A(s.args, 0, 0) / 20, -1.2, 34); },
  AnimPinkHeart(s) { CB.AnimParticleBurst(s); },
  AnimRedHeartBurst(s) { CB.AnimParticleBurst(s); },
  AnimRedHeartProjectile(s) { initAtk(s); linearTo(s, 16, TGT_X, TGT_Y, 8); },
  AnimLetterZ(s) {
    initAtk(s);
    s.x2 = A(s.args, 0, 0); s.y2 = A(s.args, 1, -10);
    drift(s, 0.8, -1.1, 40);
  },
  AnimSleepLetterZ(s) {
    initAtk(s);
    s.x2 = A(s.args, 0, 4); s.y2 = A(s.args, 1, -10);
    drift(s, 0.6, -1.0, 46);
  },
  AnimSnoreZ(s) { initAtk(s); drift(s, 1, -1.2, 40); },
  AnimPerishSongMusicNote(s) { initAtk(s); drift(s, rnd(-0.8, 0.8), -1.4, 38); },
  AnimHealBellMusicNote(s) { initAtk(s); drift(s, rnd(-0.8, 0.8), -1.4, 38); },
  AnimWavyMusicNotes(s) {
    initAtk(s);
    startAnim(s, A(s.args, 0));
    let t = 0;
    const speed = Math.abs(A(s.args, 2, 12)) / 8;
    s.onTick = () => {
      t++;
      s.x2 += (TGT_X - ATK_X) / 34;
      s.y2 += ((TGT_Y - ATK_Y) / 34) * s.E.dirY + angleSin(t * 8, 1.2);
      if (t > 36) s.dead = true;
    };
  },
  AnimFastFlyingMusicNotes(s) { initAtk(s); linearTo(s, 18, TGT_X, TGT_Y, 10); },
  AnimSlowFlyingMusicNotes(s) { initAtk(s); linearTo(s, 34, TGT_X, TGT_Y, 14); },
  AnimCirclingMusicNote(s) {
    initAtk(s);
    const ang = A(s.args, 0, 0);
    s.onTick = () => {
      s.x2 = angleCos(ang + s.age * 5, 22);
      s.y2 = -20 + angleSin(ang + s.age * 5, 14);
      if (s.age > 40) s.dead = true;
    };
  },
  AnimJaggedMusicNote(s) { initTgt(s); drift(s, 1, -1.2, 30); },
  AnimConfusionDuck(s) {
    s.gx = TGT_X + A(s.args, 0);
    s.gy = TGT_Y + A(s.args, 1);
    startAnim(s, 1);
    let ang = A(s.args, 2);
    const speed = A(s.args, 3, 3);
    const dur = Math.max(10, A(s.args, 4, 90));
    s.onTick = () => {
      s.x2 = angleCos(ang, 30);
      s.y2 = angleSin(ang, 10);
      ang = (ang + speed) & 255;
      if (s.age > dur) s.dead = true;
    };
  },
  AnimDizzyPunchDuck(s) {
    s.gx = TGT_X; s.gy = TGT_Y;
    startAnim(s, rnd(0, Math.max(0, (s.tmpl.frames || 1) - 1)));
    s.onTick = () => {
      const k = s.age * 0.22;
      s.x2 = angleCos(s.age * 5, 26);
      s.y2 = -18 + angleSin(s.age * 5, 14);
      if (s.age > 50) s.dead = true;
    };
  },
  AnimAngerMark(s) {
    const onTarget = A(s.args, 0, 0) !== 0;
    const p = gba(onTarget ? 'be' : 'bp');
    s.gx = p.x;
    s.gy = p.y;
    s.x2 = A(s.args, 1, 0) * 0.5 * (onTarget ? -s.E.dirX : s.E.dirX);
    s.y2 = A(s.args, 2, 0) * 0.5;
    s.onTick = () => {
      s.sx = 0.5 + Math.min(1, s.age / 8) * 0.5 + Math.sin(s.age / 2) * 0.06;
      s.sy = s.sx;
      if (s.age > 34) s.dead = true;
    };
  },
  AnimConversion(s) { initAtk(s); ringExpandShrink(s); },
  AnimConversion2(s) { initAtk(s); ringExpandShrink(s); },
  AnimMudSportDirt(s) { initAtk(s); burstAround(s, 30, 1.8, 0.08); },
  AnimDirtScatter(s) {
    // 泼沙/泥巴射击：从攻击方把沙粒抛向对手，落点在对手身上随机散开
    if ((s.tmpl.img || '').includes('Gfx_MudSand')) {
      initAtk(s);
      const dur = Math.max(4, A(s.args, 2, 20));
      const x0 = s.gx;
      const y0 = s.gy;
      const tx = TGT_X + rnd(-16, 16);
      const ty = TGT_Y + rnd(-16, 16);
      const ang = Math.random() * Math.PI * 2;
      let t = 0;
      s.onTick = () => {
        t++;
        if (t <= dur) {
          const k = t / dur;
          s.x2 = (tx - x0) * k;
          s.y2 = (ty - y0) * k * s.E.dirY;
        } else {
          const e = t - dur;
          s.x2 = (tx - x0) + Math.cos(ang) * e * 1.5;
          s.y2 = (ty - y0) * s.E.dirY + Math.sin(ang) * e * 1.5;
          if (e > 8) s.dead = true;
        }
      };
      return;
    }
    initTgt(s);
    burstAround(s, 28, 2.0, 0.1);
  },
  AnimDirtPlumeParticle(s) {
    const onTarget = A(s.args, 0, 0) !== 0;
    const p = gba(onTarget ? 'be' : 'bp');
    const side = A(s.args, 1, 0);
    const dur = Math.max(1, A(s.args, 5, 18));
    s.gx = p.x + (side ? -24 : 24);
    s.gy = p.y + (s.E.label === 'Move_DIG' ? 8 : 16) * s.E.dirY;
    let t = 0;
    s.onTick = () => {
      t++;
      const k = Math.min(1, t / dur);
      s.x2 = (side ? -1 : 1) * A(s.args, 2, 0) * k;
      s.y2 = A(s.args, 3, 0) * k * s.E.dirY + Math.sin(Math.PI * k) * A(s.args, 4, 0);
      if (k >= 1) s.dead = true;
    };
  },
  AnimDigDirtMound(s) {
    const onTarget = A(s.args, 0, 0) !== 0;
    const right = A(s.args, 1, 0) !== 0;
    const eng = s.E.E;
    const a = eng.anchors || { atk: { x: ATK_X, y: ATK_Y }, tgt: { x: TGT_X, y: TGT_Y } };
    const sx = (a.tgt.x - a.atk.x) / (TGT_X - ATK_X) || 1;
    s.gx = (onTarget ? TGT_X : ATK_X) + (right ? 16 : -16) / sx;
    const domSide = onTarget ? (s.E.opponent ? 'bp' : 'be') : (s.E.opponent ? 'be' : 'bp');
    const base = document.getElementById(domSide + '-base');
    if (base && eng.stage) {
      const sr = eng.stage.getBoundingClientRect();
      const br = base.getBoundingClientRect();
      const k = eng.rectScale || 1;
      const sy = (a.tgt.y - a.atk.y) / (TGT_Y - ATK_Y) || 1;
      const anchor = onTarget ? a.tgt : a.atk;
      const screenY = (br.top + br.height / 2 - sr.top) * k;
      s.gy = (onTarget ? TGT_Y : ATK_Y) + (screenY - anchor.y) / sy;
    } else {
      s.gy = (onTarget ? TGT_Y : ATK_Y) + 8 * s.E.dirY;
    }
    if (s.anim) s.anim.frame = A(s.args, 1, 0) ? 1 : 0;
    const digSetUp = s.E.label === 'Move_DIG' && s.E.twoTurn && s.E.turn === 1;
    s.life = digSetUp ? 14 : Math.max(1, A(s.args, 2, 1));
    s.dieOnLife = true;
  },
  AnimSandAttackDirt(s) { initAtk(s); s.onTick = () => { s.x2 += 2.2; s.y2 = angleSin(s.age * 8, 6); if (s.age > 26) s.dead = true; }; },
  AnimMudSlapMud(s) { initAtk(s); linearTo(s, 16, TGT_X, TGT_Y, 10); },
  AnimBlackSmoke(s) {
    initTgt(s);
    s.gy += A(s.args, 1, 0) * s.E.dirY;
    const vx = A(s.args, 2, 0) * (A(s.args, 3, 0) ? -1 : 1) / 256;
    const dur = Math.max(1, A(s.args, 4, 75));
    s.onTick = () => {
      s.x2 += vx * s.E.dirX;
      s.visible = !s.visible;
      if (s.age >= dur) s.dead = true;
    };
  },
  AnimGraySmoke(s) { initAtk(s); drift(s, 1.0, -0.4, 32); },
  AnimSmokeBallEscapeCloud(s) { initAtk(s); drift(s, 0.8, -0.6, 36); },
  AnimSmogCloud(s) { initTgt(s); drift(s, rnd(-0.7, 0.7), -0.5, 34); },
  AnimPoisonGasCloud(s) { CB.InitPoisonGasCloudAnim(s); },
  InitPoisonGasCloudAnim(s) {
    const dur = Math.max(12, A(s.args, 0, 64));
    const x0 = ATK_X + A(s.args, 1, 0);
    const y0 = ATK_Y + A(s.args, 2, 0);
    const tx = TGT_X + A(s.args, 3, -32) * 0.25;
    const ty = TGT_Y + A(s.args, 4, -6) * 0.25 * s.E.dirY;
    s.gx = x0;
    s.gy = y0;
    let t = 0;
    let phase = rnd(0, 255);
    s.onTick = () => {
      t++;
      if (t <= dur) {
        const k = t / dur;
        s.x2 = (tx - x0) * k + angleSin(phase, 4);
        s.y2 = (ty - y0) * k * s.E.dirY;
        phase = (phase + 8) & 255;
        return;
      }
      const e = t - dur;
      s.x2 = (tx - x0) + angleSin(phase, 6);
      s.y2 = (ty - y0) * s.E.dirY + e * 0.25;
      phase = (phase + 4) & 255;
      s.alpha = Math.max(0, 1 - e / 80);
      if (e >= 80) s.dead = true;
    };
  },
  InitSwirlingFogAnim(s) {
    const xOff = A(s.args, 0, 0);
    const yOff = A(s.args, 1, 0);
    const dy = A(s.args, 2, 48);
    const dur = Math.max(1, A(s.args, 3, 240));
    const onTarget = A(s.args, 4, 0) !== 0;
    const mist = s.E.label === 'Move_MIST';
    const smog = s.E.label === 'Move_SMOG';
    s.gx = (onTarget ? TGT_X : ATK_X) + xOff;
    s.gy = (onTarget ? TGT_Y : ATK_Y) + yOff * s.E.dirY;
    const life = mist ? Math.min(60, dur) : smog ? Math.min(44, dur) : dur;
    const amp = mist ? 24 : 32;
    const step = mist ? 2 : 3;
    let t = 0;
    let phase = 64;
    s.onTick = () => {
      t++;
      const k = Math.min(1, t / life);
      s.x2 = angleSin(phase, amp);
      s.y2 = dy * k + angleCos(phase, -6) / 4;
      phase = (phase + step) & 255;
      if (t >= life) s.dead = true;
    };
  },
  AnimPoisonBubble(s) { initTgt(s); s.x2 = A(s.args, 0); s.y2 = A(s.args, 1); drift(s, 0, -0.9, 26); },
  AnimAcidPoisonBubble(s) { initTgt(s); drift(s, rnd(-0.5, 0.5), -0.9, 26); },
  AnimAcidPoisonDroplet(s) { initAtk(s); linearTo(s, 16, TGT_X, TGT_Y, 10); },
  AnimToxicBubble(s) { initTgt(s); s.x2 = A(s.args, 0); s.y2 = A(s.args, 1); drift(s, 0, -0.8, 34); },
  AnimSludgeBombHitParticle(s) { initTgt(s); burstAround(s, 26, 2.0, 0.06); },
  AnimSludgeProjectile(s) { initAtk(s); linearTo(s, 18, TGT_X, TGT_Y, 12); },
  AnimBubbleEffect(s) {
    // Keep target-local offsets at roughly sprite scale; the screen mapping
    // stretches distances between battlers and would otherwise spread them too far.
    s.gx = TGT_X + A(s.args, 0) * 0.5;
    s.gy = TGT_Y + A(s.args, 1) * 0.5 * s.E.dirY;
    startAffine(s, 0);
    let phase = 0;
    let rise = 0;
    s.onTick = () => {
      phase = (phase + 0xB) & 0xFF;
      s.x2 = angleSin(phase, 4);
      rise += 0x30;
      s.y2 = -(rise >> 8);
      if ((s.aff && s.aff.ended) || s.age > 24) s.dead = true;
    };
  },
  AnimSmallBubblePair(s) { initTgt(s); drift(s, rnd(-0.6, 0.6), -0.7, 28); },
  AnimSmallDriftingBubbles(s) { initTgt(s); drift(s, rnd(-0.7, 0.7), -0.6, 21); },
  AnimWaterBubble(s) { initAtk(s); linearTo(s, 18, TGT_X, TGT_Y, 12); },
  AnimWaterBubbleProjectile(s) { initAtk(s); linearTo(s, Math.max(8, A(s.args, 4, 18)), TGT_X, TGT_Y, 14); },
  AnimWaterGunDroplet(s) { initAtk(s); linearTo(s, 14, TGT_X, TGT_Y, 8); },
  AnimWaterGunProjectile(s) { initAtk(s); linearTo(s, 16, TGT_X, TGT_Y, 6); },
  AnimSprayWaterDroplet(s) {
    const dir = A(s.args, 0, 0);
    const p = gba(A(s.args, 1, 0) !== 0 ? 'be' : 'bp');
    s.gx = p.x;
    s.gy = p.y;
    let vx = 736 + rnd(0, 511);
    let vy = 896 + rnd(0, 127);
    s.onTick = () => {
      s.x2 += (dir ? -1 : 1) * (vx >> 8);
      s.y2 -= vy >> 8;
      vy -= 32;
      if (++s.age >= 31) s.dead = true;
    };
  },
  AnimHydroPumpOrb(s) { initAtk(s); linearTo(s, 20, TGT_X, TGT_Y, 6); },
  AnimHydroCannonBeam(s) { initAtk(s); linearTo(s, 22, TGT_X, TGT_Y, 0); },
  AnimHydroCannonCharge(s) { initAtk(s); s.sx = 0.3; s.sy = 0.3; dieWhenAnimEnds(s, 40); },
  AnimWaterPulseBubble(s) {
    startAnim(s, A(s.args, 6, 0));
    absToGba(s, A(s.args, 0, 120), A(s.args, 1, 80));
    const m = absMetrics(s);
    const rise = A(s.args, 2, 8);
    const swaySpeed = A(s.args, 3, 1);
    const swayAmp = A(s.args, 4, 20);
    const life = Math.max(1, A(s.args, 5, 40));
    let t = 0;
    let phase = 0;
    let dy = 0;
    s.onTick = () => {
      t++;
      dy -= rise;
      s.y2 = (dy / 10) * (m.h / 160) / (s.E.dirY * m.sy);
      phase = (phase + swaySpeed) & 0xFF;
      s.x2 = Math.sin((phase / 256) * Math.PI * 2) * swayAmp * (m.w / 240) / m.sx;
      if (t >= life) s.dead = true;
    };
  },
  AnimWhirlpool(s) { initTgt(s); spiralIn(s, 'be', 28, 20, 13); },
  AnimTwisterLeaf(s) {
    twisterParticle(s);
  },
  AnimRazorWindTornado(s) { initAtk(s); s.onTick = () => { s.x2 += 2.4; s.y2 = angleSin(s.age * 9, 14); if (s.age > 30) s.dead = true; }; },
  AnimEllipticalGust(s) { initAtk(s); linearTo(s, 26, TGT_X, TGT_Y, 18); },
  AnimGustToTarget(s) {
    initAtk(s);
    linearTo(s, s.E.label === 'Move_WING_ATTACK' ? 41 : 22, TGT_X, TGT_Y, 10);
  },
  AnimToTargetInSinWave(s) {
    initAtk(s);
    const amp = Math.abs(A(s.args, 3, 10)) || 10;
    s.onTick = () => {
      const k = Math.min(1, s.age / 30);
      s.x2 = (TGT_X - s.gx) * k;
      s.y2 = (TGT_Y - s.gy) * k * s.E.dirY + angleSin(s.age * 10, amp);
      if (k >= 1) s.dead = true;
    };
  },
  AnimMoveParticleBeyondTarget(s) {
    initAtk(s);
    linearTo(s, 22, TGT_X + 30, TGT_Y - 10, 8);
  },
  AnimTranslateLinearSingleSineWave(s) {
    initAtk(s);
    s.onTick = () => {
      const k = Math.min(1, s.age / 28);
      s.x2 = (TGT_X - ATK_X) * k;
      s.y2 = (TGT_Y - ATK_Y) * k * s.E.dirY + angleSin(s.age * 8, 12) * (1 - k);
      if (k >= 1) s.dead = true;
    };
  },
  TranslateAnimSpriteToTargetMonLocation(s) {
    initAtk(s);
    const ember = s.E.label === 'Move_EMBER';
    linearTo(s, Math.max(4, A(s.args, 4, 20)), ember ? TGT_X : TGT_X + A(s.args, 2), ember ? TGT_Y : TGT_Y + A(s.args, 3), 0);
  },
  AnimThrowProjectile(s) {
    initAtk(s);
    linearTo(s, Math.max(4, A(s.args, 4, 18)), TGT_X + A(s.args, 2), TGT_Y + A(s.args, 3), Math.abs(A(s.args, 5, 12)));
  },
  AnimBulletSeed(s) { initAtk(s); linearTo(s, 14, TGT_X, TGT_Y, 10); },
  AnimPinMissile(s) { initAtk(s); aimAt(s, s.gx, s.gy, TGT_X, TGT_Y); linearTo(s, 14, TGT_X, TGT_Y, 8); },
  AnimIcicleSpear(s) { initAtk(s); aimAt(s, s.gx, s.gy, TGT_X, TGT_Y); linearTo(s, 14, TGT_X, TGT_Y, 8); },
  AnimRoarNoiseLine(s) {
    s.gx = ATK_X + A(s.args, 0, 0);
    s.gy = ATK_Y + A(s.args, 1, 0) * s.E.dirY;
    const kind = A(s.args, 2, 0);
    if (s.E.opponent) s.sx = -1;
    if (kind !== 0 && kind !== 1) startAnim(s, 1);
    if (kind === 1) s.sy = -1;
    const vy = kind === 0 ? -2.5 : kind === 1 ? 2.5 : 0;
    s.onTick = () => {
      s.x2 += 2.5;
      s.y2 += vy;
      if (s.age >= 14) s.dead = true;
    };
  },
  AnimLeechSeed(s) {
    initAtk(s);
    linearTo(s, Math.max(8, A(s.args, 0, 15)), TGT_X, TGT_Y, Math.abs(A(s.args, 3, 24)));
  },
  AnimIngrainRoot(s) { initAtk(s); dieWhenAnimEnds(s, 80); },
  AnimFrenzyPlantRoot(s) { initTgt(s); dieWhenAnimEnds(s, 80); },
  AnimIngrainOrb(s) { initAtk(s); drift(s, 0, -1, 30); },
  AnimSpikes(s) {
    initAtk(s);
    const x0 = s.gx;
    const y0 = s.gy;
    const tx = TGT_X + A(s.args, 2, 0) * 0.4;
    const ty = TGT_Y + 18 * s.E.dirY;
    const dur = Math.max(6, A(s.args, 4, 30));
    let t = 0;
    let wait = 0;
    let landed = false;
    s.onTick = () => {
      if (!landed) {
        t++;
        const k = Math.min(1, t / dur);
        s.x2 = (tx - x0) * k;
        s.y2 = (ty - y0) * k * s.E.dirY - Math.sin(k * Math.PI) * 50;
        if (k >= 1) landed = true;
        return;
      }
      if (++wait > 30) s.visible = wait % 2 === 0;
      if (wait >= 46) s.dead = true;
    };
  },
  AnimPresent(s) { initTgt(s); popAndFade(s, 40); },
  AnimPresentHealParticle(s) { initAtk(s); drift(s, rnd(-0.7, 0.7), -1.2, 34); },
  AnimSoftBoiledEgg(s) { initAtk(s); drift(s, 0, -1, 30); },
  AnimMilkBottle(s) {
    // 瓶子在嘴边，绕自身中心转到瓶口对准宝可梦中心，像仰瓶倒奶
    s.gx = ATK_X + 16;
    s.gy = ATK_Y - 12 * s.E.dirY;
    const eng = s.E.E;
    const b = eng.stagePoint(s.gx, s.gy);
    const c = eng.stagePoint(ATK_X, ATK_Y);
    let aim = (Math.atan2(c.y - b.y, c.x - b.x) * 180) / Math.PI + 90;
    if (aim > 180) aim -= 360;
    if (aim < -180) aim += 360;
    const dur = 74;
    s.onTick = () => {
      const t = s.age;
      s.alpha = t < 8 ? t / 8 : t > dur - 10 ? Math.max(0, (dur - t) / 10) : 1;
      const k = Math.min(1, t / 9);
      s.rot = aim * k + (t > 20 ? Math.sin((t - 20) / 8) * 2 : 0);
      if (t >= dur) s.dead = true;
    };
  },
  AnimHealingBlueStar(s) { initAtk(s); drift(s, rnd(-0.8, 0.8), -1.3, 34); },
  AnimGrantingStars(s) { initAtk(s); drift(s, rnd(-0.8, 0.8), -1.3, 34); },
  AnimSparklingStars(s) { initTgt(s); burstAround(s, 28, 1.8, 0); },
  AnimMoonlightSparkle(s) { initAtk(s); drift(s, rnd(-0.7, 0.7), -1.1, 36); },
  AnimWallSparkle(s) { initTgt(s); s.x2 = A(s.args, 0); s.y2 = A(s.args, 1); flicker(s, 24); },
  AnimProtect(s) {
    const dur = Math.max(24, Math.round(A(s.args, 2, 90) * 0.65));
    const mon = s.E.imgFor('bp');
    const monW = mon && mon.offsetWidth ? mon.offsetWidth : 50;
    const base = monW / 64;
    const perGba = Math.abs((s.E.E.stagePoint(ATK_X + 10, ATK_Y).x - s.E.E.stagePoint(ATK_X, ATK_Y).x) / 10) || 1;
    s.gx = ATK_X + (A(s.args, 0, 24) * base) / perGba;
    s.gy = ATK_Y + A(s.args, 1, 0);
    s.sx = s.sy = base;
    s.alpha = 0;
    const slide = (34 * base) / perGba;
    const tex = protectTexture(new URL(s.tmpl.img, ASSET_BASE).href);
    let pal = -1;
    let t = 0;
    s.onTick = () => {
      t++;
      s.x2 = -slide * (t / dur);
      const fade = Math.max(0, Math.min(1, t / 6, (dur - t) / 10));
      s.alpha = fade * (t < 13 ? 1 - (t / 13) * 0.6 : 0.4);
      s.sx = s.sy = base * (t < 6 ? 0.86 + (t / 6) * 0.16 : 1);
      if (s.el && tex.ready && tex.frames.length) {
        const idx = (t >> 1) % tex.frames.length;
        if (idx !== pal) {
          pal = idx;
          s.el.style.backgroundImage = `url(${tex.frames[idx]})`;
        }
      }
      if (t >= dur) s.dead = true;
    };
  },
  AnimSwordsDanceBlade(s) {
    s.gx = ATK_X;
    s.gy = ATK_Y;
    let ang = 0;
    s.onTick = () => {
      ang = (ang + 4) & 255;
      s.x2 = angleCos(ang, 20);
      s.y2 = -20 + angleSin(ang, 8);
      if (s.age > 60) s.dead = true;
    };
  },
  AnimSharpenSphere(s) { initAtk(s); ringExpandShrink(s); },
  AnimEndureEnergy(s) { initAtk(s); ringExpandShrink(s); },
  AnimKinesisZapEnergy(s) { initTgt(s); s.onTick = () => { s.x2 = angleSin(s.age * 12, 10); if (s.age > 26) s.dead = true; }; },
  AnimMetronomeFinger(s) {
    // 挥指：手出现在头侧，放大后绕手根来回摆动
    const onTarget = A(s.args, 0, 0) !== 0;
    s.gx = onTarget ? TGT_X - 22 : ATK_X + 22;
    s.gy = (onTarget ? TGT_Y : ATK_Y) - 22 * s.E.dirY;
    if (s.el) s.el.style.transformOrigin = '50% 88%';
    const dur = 74;
    s.onTick = () => {
      const t = s.age;
      if (t < 8) {
        const k = t / 8;
        s.sx = s.sy = 0.45 + k * 0.65;
        s.alpha = k;
      } else if (t < 24) {
        s.alpha = 1;
      } else {
        const k = (t - 24) / 11;
        s.rot = Math.sin(k * Math.PI) * 17;
        s.alpha = t > dur - 10 ? Math.max(0, (dur - t) / 10) : 1;
      }
      if (t >= dur) s.dead = true;
    };
  },
  AnimFollowMeFinger(s) { fingerBeckon(s); },
  AnimTauntFinger(s) { fingerBeckon(s); },
  AnimThoughtBubble(s) { initAtk(s); drift(s, 0.4, -0.9, 34); },
  AnimOpeningEye(s) { initAtk(s); popAndFade(s, 30); },
  AnimMeanLookEye(s) { initTgt(s); s.onTick = () => { s.sx = 0.8 + Math.min(1, s.age / 10) * 0.4; s.sy = s.sx; if (s.age > 50) s.dead = true; }; },
  AnimEyeSparkle(s) { initAtk(s); flicker(s, 22); },
  AnimLeer(s) { initAtk(s); dieWhenAnimEnds(s, 40); },
  AnimCurseGhost(s) { initTgt(s); drift(s, 0, -0.6, 40); },
  AnimCurseNail(s) { initTgt(s); popAndFade(s, 24); },
  AnimNightmareDevil(s) { initTgt(s); drift(s, 0, -0.5, 44); },
  AnimMoon(s) { initAtk(s); drift(s, 0, -1.2, 40); },
  AnimSunlightRay(s) { initAtk(s); drift(s, 0, -1.6, 34); },
  AnimSpotlight(s) { initAtk(s); dieWhenAnimEnds(s, 60); },
  AnimWhiteShadow(s) { initAtk(s); dieWhenAnimEnds(s, 40); },
  AnimBlackBall(s) { initAtk(s); linearTo(s, 18, TGT_X, TGT_Y, 6); },
  AnimBlackSmokeBall(s) { initAtk(s); linearTo(s, 18, TGT_X, TGT_Y, 10); },
  AnimPokeball(s) { initAtk(s); linearTo(s, 20, TGT_X, TGT_Y, 20); },
  AnimBatonPassPokeball(s) { initAtk(s); drift(s, 0, -1.2, 30); },
  AnimCoinThrow(s) {
    initAtk(s);
    const x0 = s.gx, y0 = s.gy;
    let t = 0;
    s.onTick = () => {
      t++;
      const k = Math.min(1, t / 20);
      s.x2 = (TGT_X - x0) * k;
      s.y2 = (TGT_Y - y0) * k * s.E.dirY - Math.sin(k * Math.PI) * 24;
      if (k >= 1) {
        const n = 6;
        for (let i = 0; i < n; i++) {
          const c = s.E.createSprite('gFallingCoinSpriteTemplate', false, 2, []);
          if (!c) continue;
          const off = i - (n - 1) / 2;
          c.gx = TGT_X;
          c.gy = TGT_Y;
          c.x2 = rnd(-3, 3);
          c.y2 = rnd(-3, 3);
          c.sx = c.sy = 0.72;
          c.vx = off * 1.15 + rnd(-0.25, 0.25);
          c.vy = -2.4 - Math.abs(off) * 0.12 + rnd(-0.25, 0.25);
          c.rot = rnd(0, 360);
          c.onTick = () => {
            c.x2 += c.vx;
            c.y2 += c.vy;
            c.vy += 0.22;
            c.rot += 10;
            if (c.age > 30) c.dead = true;
          };
        }
        s.dead = true;
      }
    };
  },
  AnimFallingCoin(s) { initTgt(s); CB.AnimFallingRock(s); },
  AnimLick(s) {
    // 贴身位移交给预览层统一使用旧项目的 lungeAttack；这里只做目标拉长
    s.visible = false;
    const m = s.E.mon('be');
    const img = s.E.imgFor('be');
    if (img) img.style.transformOrigin = '50% 100%';
    let t = 0;
    s.onTick = () => {
      t++;
      const k = Math.min(1, t / 14);
      const stretch = Math.sin(k * Math.PI);
      m.sy = 1 + stretch * 0.55;
      m.sx = 1 - stretch * 0.12;
      if (t > 28) {
        m.sx = 1; m.sy = 1;
        if (img) img.style.transformOrigin = '';
        s.dead = true;
      }
    };
  },
  AnimPencil(s) { initTgt(s); popAndFade(s, 26); },
  AnimForesightMagnifyingGlass(s) {
    s.gx = TGT_X;
    s.gy = TGT_Y;
    const spots = [
      { x: 0, y: 0 },
      { x: 22, y: 0 },
      { x: -22, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -14 },
      { x: 0, y: 14 },
      { x: 0, y: 0 },
    ];
    const leg = 7;
    s.onTick = () => {
      const i = Math.min(spots.length - 2, Math.floor(s.age / leg));
      const k = Math.min(1, (s.age - i * leg) / leg);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const a = spots[i], b = spots[i + 1];
      s.x2 = (a.x + (b.x - a.x) * e) * s.E.dirX;
      s.y2 = a.y + (b.y - a.y) * e;
      if (s.age > 44) s.alpha = Math.max(0, 1 - (s.age - 44) / 4);
      if (s.age >= 48) s.dead = true;
    };
  },
  AnimBentSpoon(s) { initTgt(s); popAndFade(s, 26); },
  AnimTrickBag(s) { initTgt(s); dieWhenAnimEnds(s, 40); },
  AnimKnockOffItem(s) { initTgt(s); burstAround(s, 26, 2, 0.08); },
  AnimItemSteal(s) { initAtk(s); linearTo(s, 18, TGT_X, TGT_Y, 12); },
  AnimBrickBreakWall(s) { initTgt(s); dieWhenAnimEnds(s, 40); },
  AnimBrickBreakWallShard(s) { initTgt(s); burstAround(s, 26, 2, 0.16); },
  AnimDefensiveWall(s) {
    s.gx = s.E.statusSide ? TGT_X : ATK_X;
    s.gy = s.E.statusSide ? TGT_Y : ATK_Y;
    s.sx = 1.15;
    s.sy = 1.15;
    s.E.objAlpha = 1;
    let t = 0;
    s.alpha = 0;
    s.onTick = () => {
      t++;
      s.alpha = Math.min(1, t / 8);
      if (t > 60) s.dead = true; // 墙体停留 1s 即可，别把对战节奏拖慢
    };
  },
  AnimLightScreenWall(s) { initAtk(s); dieWhenAnimEnds(s, 60); },
  AnimReflectWall(s) { initAtk(s); dieWhenAnimEnds(s, 60); },
  AnimBarrierWall(s) { initAtk(s); dieWhenAnimEnds(s, 50); },
  AnimMirrorCoatWall(s) { initAtk(s); dieWhenAnimEnds(s, 50); },
  AnimMagicCoatWall(s) { initAtk(s); dieWhenAnimEnds(s, 50); },
  AnimWebThread(s) {
    initAtk(s);
    s.sx = s.sy = 1.5;
    linearTo(s, 20, TGT_X, TGT_Y, 10);
  },
  AnimTranslateWebThread(s) { CB.AnimWebThread(s); },
  AnimStringWrap(s) {
    initTgt(s);
    s.y2 = -10;
    s.life = 50;
    s.dieOnLife = true;
    s.onTick = () => {
      if (s.age > 42) s.alpha = Math.max(0, (50 - s.age) / 8);
    };
  },
  AnimSpiderWeb(s) {
    initTgt(s);
    s.life = 56;
    s.dieOnLife = true;
    s.onTick = () => {
      s.sx = s.sy = Math.min(1, 0.65 + s.age / 20);
      if (s.age > 44) s.alpha = Math.max(0, (56 - s.age) / 12);
    };
  },
  AnimString(s) { initTgt(s); drift(s, 0, -0.4, 30); },
  AnimVineWhip(s) { initAtk(s); linearTo(s, 14, TGT_X, TGT_Y, 18); },
  AnimVine(s) { initTgt(s); dieWhenAnimEnds(s, 50); },
  AnimSlamHit(s) { initTgt(s); popAndFade(s, 20); },
  AnimHornHit(s) {
    initAtk(s);
    faceTarget(s, true);
    linearTo(s, 12, TGT_X, TGT_Y, s.E.label === 'Move_HORN_ATTACK' ? 0 : 12);
  },
  AnimMegahornHorn(s) { initAtk(s); faceTarget(s, true); linearTo(s, 14, TGT_X, TGT_Y, 14); },
  AnimBonemerang(s) {
    initAtk(s);
    startAffine(s, 0);
    const dx = TGT_X - ATK_X;
    const dy = TGT_Y - ATK_Y;
    let t = 0;
    s.onTick = () => {
      t++;
      if (t <= 20) {
        const k = t / 20;
        s.x2 = dx * k;
        s.y2 = dy * k * s.E.dirY;
      } else if (t <= 40) {
        const k = (t - 20) / 20;
        s.x2 = dx * (1 - k);
        s.y2 = dy * (1 - k) * s.E.dirY;
      } else {
        s.dead = true;
      }
    };
  },
  AnimBonemerangProjectile(s) { CB.AnimBonemerang(s); },
  AnimBoneHitProjectile(s) {
    initAtk(s);
    s.rotSpeed = 28;
    linearTo(s, Math.max(8, A(s.args, 4, 15)), TGT_X + A(s.args, 2, 0), TGT_Y + A(s.args, 3, 0), 28);
  },
  AnimSpinningBone(s) { CB.AnimBoneHitProjectile(s); },
  AnimPinMissileNeedle(s) { initAtk(s); aimAt(s, s.gx, s.gy, TGT_X, TGT_Y); linearTo(s, 14, TGT_X, TGT_Y, 8); },
  AnimBarrageBall(s) { initAtk(s); linearTo(s, 18, TGT_X, TGT_Y, 16); },
  AnimSonicBoomProjectile(s) {
    initAtk(s);
    const tx = TGT_X + A(s.args, 2, 0);
    const ty = TGT_Y + A(s.args, 3, 0) * s.E.dirY;
    aimAt(s, s.gx, s.gy, tx, ty);
    linearTo(s, Math.max(1, A(s.args, 4, 15)), tx, ty, 0);
  },
  AnimSmokescreenImpact(s) {
    initTgt(s);
    s.gx += 8 * s.E.dirX;
    s.gy += 8 * s.E.dirY;
    dieWhenAnimEnds(s, 20);
  },
  AnimSmokescreenImpact_Step(s) { CB.AnimSmokescreenImpact(s); },
  AnimWaterSpoutLaunch(s) { initAtk(s); CB.AnimWaterSpoutRain(s); },
  AnimWaterSpoutRain(s) { initTgt(s); burstAround(s, 30, 1.8, 0.1); },
  AnimFlatterConfetti(s) {
    const fromRight = A(s.args, 0, 0) !== 0;
    absToGba(s, fromRight ? 248 : -8, 104);
    if (s.anim) s.anim.frame = rnd(0, Math.max(0, (s.tmpl.frames || 1) - 1));
    const r1 = rnd(0, 511);
    const r2 = rnd(0, 255);
    let vx = ((r1 & 1) ? 0x5E0 + r1 : 0x5E0 - r1) / 256;
    let vy = ((r2 & 1) ? 0x480 + r2 : 0x480 - r2) / 256;
    s.onTick = () => {
      s.x2 += fromRight ? -vx * s.E.dirX : vx * s.E.dirX;
      s.y2 -= vy;
      vx = Math.max(0, vx - 22 / 256);
      vy -= 48 / 256;
      if (s.age >= 31) s.dead = true;
    };
  },
  AnimConfetti(s) { initTgt(s); burstAround(s, 30, 2.0, 0.06); },
  AnimEclipsingOrb(s) { initTgt(s); ringExpandShrink(s); },
  AnimHealingWish(s) { initAtk(s); drift(s, 0, -1.2, 36); },
  AnimDoomDesireLight(s) { initTgt(s); drift(s, 0, -2, 30); },
  AnimWindUpLunge(s) { monLunge(s); },
  AnimBowMon(s) { monBow(s); },
  AnimTipMon(s) { monTip(s); },
  AnimVibrateBattlerBack(s) { monVibrateBack(s); },
  AnimMonMoveCircular(s) { monCircle(s); },
  AnimShakeMonOrBattleTerrain(s) { shakeTerrainFromSprite(s); },
  DoHorizontalLunge(s) { monLunge(s, true); },
  DoVerticalDip(s) { monDip(s); },
  SlideMonToOriginalPos(s) { monSlideBack(s); },
  SlideMonToOffset(s) { monSlideOffset(s); },
  SlideMonToOffsetAndBack(s) { monSlideOffsetBack(s); },
  AnimSimplePaletteBlend(s) {
    const color = A(s.args, 4, 0);
    const sel = trimPalSelector(A(s.args, 0, 1), color);
    const start = A(s.args, 2, 0);
    const end = A(s.args, 3, 0);
    if (!sel || start === end) { s.dead = true; return; }
    const delay = Math.max(1, A(s.args, 1, 0));
    let amount = start;
    let timer = 0;
    applyPalSelector(s.E, sel, color, amount);
    s.onTick = () => {
      if (timer++ < delay) return;
      timer = 0;
      if (amount === end) { s.dead = true; return; }
      amount += amount < end ? 1 : -1;
      applyPalSelector(s.E, sel, color, amount);
    };
  },
  AnimComplexPaletteBlend(s) {
    const c1 = A(s.args, 3, 0), d1 = Math.max(1, A(s.args, 4, 14));
    const c2 = A(s.args, 5, 0), d2 = Math.max(1, A(s.args, 6, 14));
    const sel = trimComplexSelector(A(s.args, 0, 1), c1, c2);
    if (!sel) { s.dead = true; return; }
    const num = Math.min(2, Math.max(1, A(s.args, 1, 1)));
    const cyc = d1 + d2;
    const limit = Math.min(cyc * num, 30);
    let t = 0;
    s.onTick = () => {
      t++;
      const k = (t - 1) % cyc;
      if (k < d1) applyPalSelector(s.E, sel, c1, Math.round((k / d1) * 16));
      else applyPalSelector(s.E, sel, c2, Math.round(((cyc - k) / d2) * 16));
      if (t >= limit) {
        applyPalSelector(s.E, sel, c2, 0);
        s.dead = true;
      }
    };
  },
  SpriteCB_SetInvisible(s) { s.alpha = 0; s.dead = true; },
  SpriteCallbackDummy(s) { s.life = 40; s.dieOnLife = true; },
};

function flameDrift(s) {
  if (s.isTarget) initTgt(s);
  else initAtk(s);
  const life = Math.max(6, A(s.args, 2, 20));
  const driftFrames = Math.max(0, A(s.args, 3, life));
  const vx = A(s.args, 4, 1);
  const vy = A(s.args, 5, 0);
  s.onTick = () => {
    if (s.age <= driftFrames) { s.x2 += vx; s.y2 += vy; }
    if (s.age >= life) s.dead = true;
  };
}
function spiralIn(s, side, dur, rx = 36, ry = 24) {
  const m = s.E.mon(side);
  const ang = rnd(0, 255);
  s.onTick = () => {
    const k = s.age / dur;
    s.x2 = angleCos(ang + s.age * 6, rx) * (1 - k);
    s.y2 = angleSin(ang + s.age * 6, ry) * (1 - k);
    if (k >= 1) s.dead = true;
  };
}
function ringExpand(s) {
  const dur = Math.max(8, A(s.args, 4, 26));
  s.onTick = () => {
    const k = s.age / dur;
    s.sx = s.sy = 0.4 + k * 1.2;
    s.alpha = 1 - k;
    if (k >= 1) s.dead = true;
  };
}
function ringShrink(s) {
  const dur = Math.max(8, A(s.args, 4, 26));
  s.onTick = () => {
    const k = s.age / dur;
    s.sx = s.sy = Math.max(0.05, 1.6 - k * 1.4);
    s.alpha = 1 - k;
    if (k >= 1) s.dead = true;
  };
}
function ringExpandShrink(s) {
  const dur = 30;
  s.onTick = () => {
    const k = s.age / dur;
    s.sx = s.sy = 0.4 + Math.sin(k * Math.PI) * 1.2;
    s.alpha = Math.sin(k * Math.PI);
    if (k >= 1) s.dead = true;
  };
}
let ACTIVE_STATUS_SIDE = null;
function sideOf(v) {
  if (ACTIVE_STATUS_SIDE) return ACTIVE_STATUS_SIDE;
  if (v === 1 || v === 3 || v === 6 || v === 7) return 'be';
  return 'bp';
}
function monLunge(s, isSprite = false) {
  if (s.E.noContact) { s.dead = true; return; }
  const m = s.E.mon('bp');
  const dur = Math.max(1, A(s.args, 0, 4));
  const contact = !/Move_ODOR_SLEUTH/.test(s.E.label || '');
  const v = contact ? s.E.meleeVector() : null;
  let t = 0;
  s.onTick = () => {
    t++;
    if (v) {
      const k = t <= dur ? 1 - (1 - t / dur) ** 2 : Math.max(0, 1 - (t - dur) / dur);
      m.lungeX = v.x * k;
      m.lungeY = v.y * k;
      if (t >= dur * 2) { m.lungeX = 0; m.lungeY = 0; s.dead = true; }
      return;
    }
    const step = A(s.args, 1, 4);
    m.ox += step * (t <= dur ? 1 : -1);
    if (t >= dur * 2) { m.ox = 0; s.dead = true; }
  };
  s.life = dur * 2 + 4;
  s.dieOnLife = true;
}
function monDip(s) {
  const m = s.E.mon(sideOf(A(s.args, 2, 0)));
  const dur = Math.max(1, A(s.args, 0, 6));
  const step = Math.max(1, Math.abs(A(s.args, 1, 2)));
  let t = 0;
  s.onTick = () => {
    t++;
    if (t <= dur) m.oy = -step * t;
    else if (t <= dur * 2) m.oy = -step * (dur * 2 - t);
    else { m.oy = 0; s.dead = true; }
  };
}
// 泰山压顶：原地压扁蓄力 → 恢复的同时沿抛物线跃到对手头上砸下
function bodySlamJump(s) {
  const E = s.E;      // Session
  const eng = E.E;    // EmeraldFx
  const m = E.mon('bp');
  const a = eng.anchors?.atk;
  const t = eng.anchors?.tgt;
  const k = eng.rectScale || 1;
  const ah = (E.imgFor('bp')?.getBoundingClientRect().height || 64) * k;
  const th = (E.imgFor('be')?.getBoundingClientRect().height || 64) * k;
  // ox 渲染时会乘 dirX，这里先按屏幕方向换算；oy 直接用屏幕方向
  const dx = a && t ? (t.x - a.x) / E.dirX : 26;
  const dy = a && t ? t.y - a.y : -40;
  // 落点：攻击方脚底压在对手头顶
  const land = dy - (ah + th) * 0.5 + 4;
  const hop = Math.max(18, Math.abs(land) * 0.22);
  const squash = 4, leap = 15, settle = 8;
  const tgt = E.mon('be');
  let n = 0, landed = false, tl = 0;
  s.onTick = () => {
    if (landed) {
      // 落地后：被踩的目标压扁再弹回，攻击方体型恢复；这段时间不阻塞脚本结算
      tl++;
      const q = Math.min(1, tl / settle);
      const e = 1 - (1 - q) ** 2;
      tgt.sx = 1.3 - 0.3 * e;
      tgt.sy = 0.6 + 0.4 * e;
      m.sx = 1.1 - 0.1 * e;
      m.sy = 0.9 + 0.1 * e;
      if (q >= 1) {
        tgt.sx = 1; tgt.sy = 1;
        m.sx = 1; m.sy = 1;
        s.dead = true;
      }
      return;
    }
    n++;
    if (n <= squash) {
      // 原地压扁
      const q = n / squash;
      m.ox = 0;
      m.oy = 3 * q;
      m.sx = 1 + 0.16 * q;
      m.sy = 1 - 0.22 * q;
    } else if (n <= squash + leap) {
      // 一边恢复体型一边沿抛物线飞向对手头顶
      const q = (n - squash) / leap;
      const e = q < 0.5 ? 2 * q * q : 1 - ((-2 * q + 2) ** 2) / 2;
      m.ox = dx * e;
      m.oy = 3 + (land - 3) * e - hop * Math.sin(Math.PI * q);
      const rec = Math.min(1, q / 0.3);
      m.sx = (1.16 - 0.16 * rec) * (1 + 0.05 * q);
      m.sy = (0.78 + 0.22 * rec) * (1 - 0.04 * q);
    } else {
      // 砸在对手头上
      m.ox = dx;
      m.oy = land;
      m.sx = 1.1;
      m.sy = 0.9;
      landed = true;
      tl = 0;
      s.noWait = true;
    }
  };
}
function monSlideOffset(s) {
  if (s.E.noContact) { s.dead = true; return; }
  const side = sideOf(A(s.args, 0, 0));
  const m = s.E.mon(side);
  let dx = A(s.args, 1, 8);
  let dy = A(s.args, 2, 0);
  if (side === 'bp' && dx > 0) {
    const v = s.E.meleeVector();
    dx = v.x;
    dy = v.y;
  }
  const dur = Math.max(1, A(s.args, 4, 10));
  let x0 = m.ox, y0 = m.oy, t = 0;
  s.onTick = () => {
    t++;
    const k = Math.min(1, t / dur);
    m.ox = x0 + dx * k; m.oy = y0 + dy * k;
    if (k >= 1) s.dead = true;
  };
}
function monSlideBack(s) {
  const m = s.E.mon(sideOf(A(s.args, 0, 0)));
  const dur = Math.max(1, A(s.args, 2, 10));
  let x0 = m.ox, y0 = m.oy, t = 0;
  s.onTick = () => {
    t++;
    const k = Math.min(1, t / dur);
    m.ox = x0 * (1 - k); m.oy = y0 * (1 - k);
    if (k >= 1) s.dead = true;
  };
}
function monSlideOffsetBack(s) {
  const m = s.E.mon(sideOf(A(s.args, 0, 0)));
  const dx = A(s.args, 1, 8), dy = A(s.args, 2, 0);
  const dur = Math.max(1, A(s.args, 4, 10));
  const x0 = m.ox, y0 = m.oy;
  let t = 0;
  s.onTick = () => {
    t++;
    const k = Math.min(1, t / dur);
    if (k < 1) { m.ox = x0 + dx * k; m.oy = y0 + dy * k; }
    else {
      const k2 = Math.min(1, (t - dur) / dur);
      m.ox = x0 + dx * (1 - k2); m.oy = y0 + dy * (1 - k2);
      if (k2 >= 1) s.dead = true;
    }
  };
}
function monBow(s) {
  const m = s.E.mon('bp');
  let t = 0;
  s.onTick = () => {
    t++;
    m.ox = Math.sin(t * 0.5) * 3;
    if (t > 24) { m.ox = 0; s.dead = true; }
  };
}
function monTip(s) {
  const m = s.E.mon('bp');
  let t = 0;
  s.onTick = () => {
    t++;
    m.rot = Math.sin(t * 0.4) * 6;
    if (t > 28) { m.rot = 0; s.dead = true; }
  };
}
function monVibrateBack(s) {
  const m = s.E.mon('be');
  const dur = Math.max(6, A(s.args, 2, 20));
  s.onTick = () => {
    m.ox = (s.age & 1 ? 1 : -1) * 3;
    if (s.age > dur) { m.ox = 0; s.dead = true; }
  };
}
function monCircle(s) {
  const m = s.E.mon('bp');
  s.onTick = () => {
    m.ox = angleCos(s.age * 6, 14);
    m.oy = angleSin(s.age * 6, 8);
    if (s.age > 40) { m.ox = 0; m.oy = 0; s.dead = true; }
  };
}
function shakeTerrainFromSprite(s) {
  const amp = A(s.args, 0, 3);
  const times = Math.min(15, Math.max(1, A(s.args, 1, 6)));
  const delay = Math.min(2, Math.max(1, A(s.args, 2, 3)));
  let t = 0, n = times * 2;
  s.life = times * delay * 2 + 4;
  s.onTick = () => {
    t++;
    if (t % delay === 0) {
      s.E.shakeX = (n-- & 1 ? 1 : -1) * amp;
      if (n <= 0) { s.E.shakeX = 0; s.dead = true; }
    }
    if (s.age >= s.life) { s.E.shakeX = 0; s.dead = true; }
  };
}

// pick a behavior: exact name first, then suffix/prefix families
function behaviorFor(cb) {
  if (CB[cb]) return CB[cb];
  if (/HitSplat/.test(cb)) return CB.AnimHitSplatBasic;
  if (/AbsorptionOrb/.test(cb)) return CB.AnimAbsorptionOrb;
  if (/SpitUpOrb/.test(cb)) return CB.AnimSpitUpOrb;
  if (/Flame|Fire|Ember|WillOWisp|Burn/.test(cb)) return CB.AnimFirePlume;
  if (/Rock|Boulder|Stone|Fragment/.test(cb)) return CB.AnimRockFragment;
  if (/Ice|Snow|Crystal|Hail/.test(cb)) return CB.AnimIceEffectParticle;
  if (/Spark|Electric|Volt|Shock|Thunder|Zap/.test(cb)) return CB.AnimSparkElectricity;
  if (/Bubble|Droplet|Water/.test(cb)) return CB.AnimWaterBubble;
  if (/Slash|Cut|Claw|Scratch|Slice|Swipes/.test(cb)) return CB.AnimClawSlash;
  if (/Heart/.test(cb)) return CB.AnimMagentaHeart;
  if (/MusicNote|Note/.test(cb)) return CB.AnimPerishSongMusicNote;
  if (/Ring|Halo|Circle/.test(cb)) return CB.AnimThinRingExpanding;
  if (/Smoke|Cloud|Fog|Gas/.test(cb)) return CB.AnimBlackSmoke;
  if (/Dirt|Mud|Sand|Powder/.test(cb)) return CB.AnimDirtScatter;
  if (/Star|Sparkle|Shine/.test(cb)) return CB.AnimSparklingStars;
  if (/Stinger|Needle|LeechLife/.test(cb)) return CB.AnimBulletSeed;
  if (/Pincer|ViceGrip|Guillotine|Clamp|Bite|Teeth|Fang/.test(cb)) return targetPop;
  if (/Kick|Punch|Stomp|Foot|Hand|Clap|ArmThrust|SmellingSalts/.test(cb)) return targetPop;
  if (/Whirlwind|Whirl|Gust|Wind/.test(cb)) return windSweep;
  if (/Breath|Puff/.test(cb)) return puffAtTarget;
  if (/Wall/.test(cb)) return wallShield;
  if (/LockOn|Eye|Spotlight|Glare/.test(cb)) return targetHighlight;
  if (/Binding|Constrict|Wrap|Tendril/.test(cb)) return wrapAtTarget;
  if (/Triangle|Pawprint|QuestionMark|RedX|BlockX|MissileArc/.test(cb)) return targetPop;
  if (/RapidSpin/.test(cb)) return spinMon;
  if (/Lick|Tongue/.test(cb)) return windSweep;
  if (/Angel|Devil|Ghost|Spirit/.test(cb)) return floatAtTarget;
  if (/PsychoBoost/.test(cb)) return CB.AnimPsychoBoostOrb;
  if (/MovementWaves/.test(cb)) return ringExpandShrink;
  if (/Particle|Orb|Ball|Seed|Bone|Horn/.test(cb)) return CB.AnimParticleBurst;
  return CB.SpriteCallbackDummy;
}
function targetPop(s) {
  initTgt(s);
  popAndFade(s, 24);
}
function windSweep(s) {
  s.gx = ATK_X; s.gy = ATK_Y;
  s.onTick = () => {
    s.x2 += 2.4;
    s.y2 = angleSin(s.age * 8, 8);
    if (s.age > 28) s.dead = true;
  };
}
function puffAtTarget(s) {
  initTgt(s);
  drift(s, rnd(-0.6, 0.6), -0.8, 26);
}
function twisterParticle(s) {
  s.gx = TGT_X;
  s.gy = TGT_Y + 32 * s.E.dirY;
  let rise = A(s.args, 1, 0);
  const dur = Math.max(1, A(s.args, 0, 60));
  const speed = A(s.args, 2, 6);
  const amp = A(s.args, 3, 26);
  const threshold = A(s.args, 4, 0);
  let phase = 0;
  s.life = dur;
  s.onTick = () => {
    if (rise === 255) s.gy -= 2 * s.E.dirY;
    else if (rise > 0) { s.gy -= 2 * s.E.dirY; rise -= 2; }
    phase = (phase + speed + (dur - s.age < threshold ? speed : 0)) & 255;
    s.x2 = angleCos(phase, amp);
    s.y2 = angleSin(phase, 5);
  };
}
function wallShield(s) {
  initAtk(s);
  dieWhenAnimEnds(s, 60);
}
function targetHighlight(s) {
  initTgt(s);
  s.onTick = () => {
    s.sx = s.sy = 0.8 + Math.sin(s.age / 4) * 0.12;
    if (s.age > 40) s.dead = true;
  };
}
function wrapAtTarget(s) {
  initTgt(s);
  s.onTick = () => {
    s.x2 = angleSin(s.age * 10, 10);
    s.rot += 5;
    if (s.age > 40) s.dead = true;
  };
}
function spinMon(s) {
  const m = s.E.mon('bp');
  s.onTick = () => {
    m.rot += 18;
    if (s.age > 30) { m.rot = 0; s.dead = true; }
  };
}
function floatAtTarget(s) {
  initTgt(s);
  drift(s, 0, -0.6, 44);
}
function stageToGba(eng, px, py) {
  if (ACTIVE_STATUS_SIDE) {
    const t = eng.anchors?.tgt || { x: TGT_X, y: TGT_Y };
    return { gx: TGT_X + (px - t.x), gy: TGT_Y + (py - t.y) };
  }
  const a = eng.anchors || { atk: { x: ATK_X, y: ATK_Y }, tgt: { x: TGT_X, y: TGT_Y } };
  const sx = (a.tgt.x - a.atk.x) / (TGT_X - ATK_X) || 1;
  const sy = (a.tgt.y - a.atk.y) / (TGT_Y - ATK_Y) || 1;
  return {
    gx: ATK_X + (px - a.atk.x) / sx,
    gy: ATK_Y + (py - a.atk.y) / sy,
  };
}
function AnimDevil(s) {
  const eng = s.E.E;
  const targetSide = s.E.statusSide || (s.E.opponent ? 'bp' : 'be');
  const img = targetSide === 'bp' ? eng.atkImg : eng.tgtImg;
  const sr = eng.stage.getBoundingClientRect();
  const ir = img?.getBoundingClientRect();
  const a = eng.anchors || { atk: { x: ATK_X, y: ATK_Y }, tgt: { x: TGT_X, y: TGT_Y } };
  const k = eng.rectScale || 1;
  const fx = ir ? (ir.left - sr.left + ir.width / 2) * k : a.tgt.x;
  const fy = ir ? (ir.top - sr.top + ir.height) * k + 24 : a.tgt.y + 24;
  const p = stageToGba(eng, fx, fy);
  s.gx = p.gx;
  s.gy = p.gy;
  const frame = targetSide === 'bp' ? 0 : 1;
  s.anim = { cmds: [['f', frame, 60], ['j', 0]], i: 0, frame, timer: 60, ended: false, started: true };
  let rise = 0;
  s.onTick = () => {
    rise += 1.25;
    if (s.age >= 20) s.noWait = true;
    s.x2 = angleSin(s.age * 4, 3);
    s.y2 = -rise;
    if (s.age > 62) s.dead = true;
  };
}
CB.AnimDevil = AnimDevil;
function AnimAngel(s) {
  const dur = 46;
  s.gx = ATK_X;
  s.gy = ATK_Y - 8;
  s.sx = s.E.opponent ? 1 : -1;
  let t = 0;
  s.onTick = () => {
    t++;
    const k = Math.min(1, t / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    s.x2 = (TGT_X - ATK_X) * e;
    s.y2 = ((TGT_Y - ATK_Y) * e - Math.sin(k * Math.PI) * 14 * s.E.dirY) * s.E.dirY;
    if (t >= dur + 6) s.dead = true;
  };
}
CB.AnimAngel = AnimAngel;
function AnimTriAttackTriangle(s) {
  s.gx = ATK_X;
  s.gy = ATK_Y;
  startAffine(s, 0);
  s.life = 52;
  s.dieOnLife = true;
}
CB.AnimTriAttackTriangle = AnimTriAttackTriangle;
CB.AnimGhostStatusSprite = (s) => {
  if ((s.tmpl.img || '').includes('Devil')) AnimDevil(s);
  else floatAtTarget(s);
};

// ------------------------------------------------------------------- tasks
const TASKS = {
  AnimTask_ShakeMon(E, args) {
    if (E.label === 'Move_STRENGTH' && E.strengthImpacted) return () => false;
    // hitOnShake：暗影球这类没有命中类 sprite 的弹道招，把命中回调挂在目标被震那一帧，
    // 只在命中帧叠加打击视觉；扣血与倒下由战斗页等整段动画播完再执行
    if (E.opts?.hitOnShake && E.opts.onImpact && !E._psyImpacted && sideOf(A(args, 0)) === 'be') {
      E._psyImpacted = true;
      try { E.opts.onImpact(); } catch (_) {}
    }
    const side = sideOf(A(args, 0));
    const ox = s16(A(args, 1)), oy = s16(A(args, 2));
    let times = Math.min(30, Math.max(1, A(args, 3, 1)));
    const delay = Math.min(3, Math.max(1, A(args, 4, 1)));
    let timer = 0;
    let on = true;
    return () => {
      const m = E.mon(side);
      if (timer++ < delay) return true;
      timer = 0; on = !on;
      m.ox = on ? ox : 0; m.oy = on ? oy : 0;
      if (--times <= 0) { m.ox = 0; m.oy = 0; return false; }
      return true;
    };
  },
  AnimTask_ShakeMon2(E, args) { return TASKS.AnimTask_ShakeMon(E, args); },
  AnimTask_ShakeMonInPlace(E, args) {
    // 愤怒门牙：原作前摇是两段长抖动（合计约 1.5s），压缩抖动次数，出手不再拖沓
    if (E.label === 'Move_SUPER_FANG') {
      return TASKS.AnimTask_ShakeMon(E, [A(args, 0, 1), A(args, 1, 3), A(args, 2, 0), Math.min(16, A(args, 3, 1)), A(args, 4, 1)]);
    }
    return TASKS.AnimTask_ShakeMon(E, args);
  },
  AnimTask_ShakeTargetBasedOnMovePowerOrDmg(E, args) {
    return TASKS.AnimTask_ShakeMon(E, [A(args, 0, 1), A(args, 1, 3), A(args, 2, 0), A(args, 3, 6), A(args, 4, 1)]);
  },
  AnimTask_BlendBattleAnimPal(E, args) {
    if (E.label === 'Move_ICE_PUNCH' && !E._icePunchTintQueued) {
      E._icePunchTintQueued = true;
      const tick = blendPalTask(E, args);
      let started = false;
      let wait = 0;
      return () => {
        if (!started) {
          if (!E._icePunchHit) return true;
          if (++wait < 6) return true;
          started = true;
        }
        return tick();
      };
    }
    if (E.label === 'Move_FIRE_PUNCH') {
      // 原作脚本在出拳前就把对手染红；这里只保留淡出，泛红推迟到拳头命中那一刻（见 createSprite）
      const color = A(args, 4, 0);
      const sel = trimPalSelector(A(args, 0, 1), color);
      const start = A(args, 2, 0), end = A(args, 3, 0);
      if (sel && start < end) {
        E._firePunchPal = { sel, color, amount: end };
        return () => false;
      }
      return blendPalTask(E, args);
    }
    return blendPalTask(E, args);
  },
  AnimTask_BlendBattleAnimPalExclude(E, args) {
    if (E.label === 'Move_CALM_MIND') {
      E.bgTint = A(args, 3, 0) > 0 ? { color: '#4b1d5c', alpha: 0.18 } : null;
    }
    return () => false;
  },
  AnimTask_BlendNonAttackerPalettes() { return () => false; },
  AnimTask_BlendParticle(E, args) { return () => false; },
  AnimTask_BlendColorCycle(E, args) { return colorCycleTask(E, args); },
  AnimTask_BlendColorCycleExclude(E, args) { return colorCycleTask(E, args); },
  AnimTask_BlendColorCycleByTag(E, args) { return colorCycleTask(E, args); },
  AnimTask_BlendMonInAndOut(E, args) {
    const side = A(args, 0) === 0 ? 'bp' : 'be';
    const m = E.mon(side);
    let t = 0;
    const dur = Math.max(7, A(args, 2, 14));
    const limit = Math.min(dur * 2, 24);
    let dir = 1;
    return () => {
      if (t++ === 0) m.hidden = false;
      m.alpha = clamp(m.alpha + 0.08 * dir, 0.15, 1);
      if (t % dur === 0) dir = -dir;
      if (t >= limit) { m.alpha = 1; return false; }
      return true;
    };
  },
  AnimTask_ScaleMonAndRestore(E, args) {
    const side = sideOf(A(args, 3, 0));
    const m = E.mon(side);
    if (E.label === 'Move_GROWTH') {
      let t = 0;
      return () => {
        t++;
        const k = Math.sin((t / 16) * Math.PI);
        m.sx = 1 - k * 0.06;
        m.sy = 1 + k * 0.42;
        if (t >= 16) { m.sx = 1; m.sy = 1; return false; }
        return true;
      };
    }
    const dx = A(args, 0, -4) / 256, dy = A(args, 1, -4) / 256;
    const dur = Math.max(2, A(args, 2, 15));
    let t = 0;
    return () => {
      t++;
      if (t <= dur) { m.sx += dx; m.sy += dy; }
      else if (t <= dur * 2) { m.sx -= dx; m.sy -= dy; }
      if (t >= dur * 2) { m.sx = 1; m.sy = 1; return false; }
      return true;
    };
  },
  AnimTask_TranslateMonEllipticalRespectSide(E, args) {
    if (E.label === 'Move_STRENGTH') return () => false; // 怪力只保留普通受击抖动，不做绕圈
    return ellipticalTask(E, args);
  },
  AnimTask_TranslateMonElliptical(E, args) { return ellipticalTask(E, args); },
  AnimTask_SwayMon(E, args) {
    const side = sideOf(A(args, 4, 0));
    const m = E.mon(side);
    const dur = Math.max(6, A(args, 0, 20));
    const amp = A(args, 1, 2);
    let phase = A(args, 2, 4);
    return () => {
      m.ox = angleSin(phase, amp);
      phase = (phase + A(args, 3, 4)) & 255;
      if (--dur <= 0) { m.ox = 0; return false; }
      return true;
    };
  },
  AnimTask_RotateMonSpriteToSide(E, args) {
    const side = sideOf(A(args, 2, 0));
    const m = E.mon(side);
    const target = A(args, 0, 16);
    const dur = Math.min(30, Math.max(4, A(args, 1, 16)));
    let t = 0;
    return () => {
      t++;
      m.rot = (target * Math.min(1, t / dur)) * 360 / 256;
      if (t >= dur) { m.rot = 0; return false; }
      return true;
    };
  },
  AnimTask_RotateMonToSideAndRestore(E, args) { return TASKS.AnimTask_RotateMonSpriteToSide(E, args); },
  AnimTask_RockMonBackAndForth(E, args) {
    const side = sideOf(A(args, 0, 0));
    const m = E.mon(side);
    let t = 0;
    const dur = Math.max(10, A(args, 3, 30));
    return () => {
      t++;
      m.rot = Math.sin(t * 0.5) * 8;
      if (t > dur) { m.rot = 0; return false; }
      return true;
    };
  },
  AnimTask_HorizontalShake(E, args) {
    const target = A(args, 0, 0);
    const intensity = A(args, 1, 0);
    // 地震：幅度收紧、频率提高，变成细密的高频颤动，而不是大幅甩动
    const isQuake = E.label === 'Move_EARTHQUAKE';
    const amp = isQuake ? 4 : intensity ? intensity + 3 : 8;
    const freq = isQuake ? 34 : 16;
    const dur = Math.min(60, Math.max(6, A(args, 2, 40)));
    const mons = target === 4 ? [E.mon('bp'), E.mon('be')] : target >= 5 ? null : [E.mon(sideOf(target))];
    let t = 0;
    return () => {
      t++;
      const dx = angleSin(t * freq, amp);
      if (target >= 5) E.shakeX = dx;
      else for (const m of mons) m.ox = dx;
      if (t > dur) {
        if (target >= 5) E.shakeX = 0;
        else for (const m of mons) m.ox = 0;
        return false;
      }
      return true;
    };
  },
  AnimTask_ShakeBattleTerrain(E, args) { return TASKS.AnimTask_HorizontalShake(E, [5, A(args, 0, 4), A(args, 1, 30)]); },
  AnimTask_StartSlidingBg(E, args) {
    E.bgSlideVX = A(args, 0, 0) / 256;
    E.bgSlideVY = A(args, 1, 0) / 256;
    const dur = A(args, 3, -1) > 0 ? A(args, 3, 80) : 600;
    E.bgSlideUntil = E.frame + dur;
    return () => false;
  },
  AnimTask_InvertScreenColor() { return () => false; },
  AnimTask_Flash(E) {
    let t = 0;
    return () => {
      t++;
      E.flash = t < 4 ? 1 : Math.max(0, 1 - (t - 4) / 12);
      return t < 18;
    };
  },
  AnimTask_FadeScreenToWhite() { return () => false; },
  AnimTask_StatusClearedEffect() { return () => false; },
  AnimTask_AttackerFadeToInvisible(E) {
    const m = E.mon('bp');
    let t = 0;
    return () => {
      t++;
      m.alpha = Math.max(0, 1 - t / 14);
      return t < 14;
    };
  },
  AnimTask_AttackerFadeFromInvisible(E) {
    const m = E.mon('bp');
    let t = 0;
    return () => {
      t++;
      m.alpha = Math.min(1, t / 14);
      return t < 14;
    };
  },
  AnimTask_InitAttackerFadeFromInvisible(E) {
    E.mon('bp').alpha = 0;
    return () => false;
  },
  AnimTask_SetAttackerInvisibleWaitForSignal(E) {
    E.mon('bp').hidden = true;
    let t = 0;
    return () => {
      t++;
      if (t > 90) { E.mon('bp').hidden = false; return false; }
      return true;
    };
  },
  AnimTask_SetAllNonAttackersInvisiblity(E, args) {
    if (E.label === 'Move_CALM_MIND') return () => false;
    E.mon('be').hidden = A(args, 0, 0) !== 0;
    return () => false;
  },
  AnimTask_SlideOffScreen(E, args) {
    const side = A(args, 0, 0) === 0 ? 'bp' : 'be';
    const m = E.mon(side);
    let t = 0;
    const dur = Math.max(8, A(args, 2, 20));
    return () => {
      t++;
      m.ox = (side === 'bp' ? -1 : 1) * (t / dur) * 120;
      return t < dur;
    };
  },
  AnimTask_GrowAndShrink(E, args) {
    const side = sideOf(A(args, 2, 0));
    const m = E.mon(side);
    let t = 0;
    const dur = Math.max(6, A(args, 4, 20));
    const amt = A(args, 0, 16) / 256;
    return () => {
      t++;
      const k = Math.sin((t / dur) * Math.PI);
      m.sx = 1 + amt * k; m.sy = 1 + amt * k;
      if (t >= dur) { m.sx = 1; m.sy = 1; return false; }
      return true;
    };
  },
  AnimTask_GrowAndGrayscale(E, args) { return TASKS.AnimTask_GrowAndShrink(E, args); },
  AnimTask_StretchAttackerUp(E, args) {
    const m = E.mon(sideOf(A(args, 2, 0)));
    let t = 0;
    const dur = Math.max(8, A(args, 4, 24));
    return () => {
      t++;
      const k = Math.sin((t / dur) * Math.PI);
      m.sy = 1 + k * 0.35;
      if (t >= dur) { m.sy = 1; return false; }
      return true;
    };
  },
  AnimTask_StretchTargetUp(E, args) { return TASKS.AnimTask_StretchAttackerUp(E, args); },
  AnimTask_DeepInhale(E, args) { return TASKS.AnimTask_GrowAndShrink(E, [18, 18, 0, 0, 24]); },
  AnimTask_Teleport(E) { return TASKS.AnimTask_AttackerFadeToInvisible(E); },
  AnimTask_DoubleTeam(E) {
    const img = E.imgFor('bp');
    const st = E.mon('bp');
    const layer = E.layer;
    const stage = E.E.stage;
    if (!img || !layer || !stage) return () => false;
    const k = E.E.rectScale || 1;
    const ir0 = img.getBoundingClientRect();
    const amp = Math.max(6, ir0.width * k * 0.32);
    const flip = img.closest('.b-flip') ? 'scaleX(-1)' : '';
    const ghosts = [];
    const spawnGhost = () => {
      const sr = stage.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      const g = img.cloneNode(false);
      g.removeAttribute('id');
      g.style.cssText = 'position:absolute;margin:0;pointer-events:none;transform-origin:center;';
      g.style.left = ((r.left - sr.left) * k).toFixed(1) + 'px';
      g.style.top = ((r.top - sr.top) * k).toFixed(1) + 'px';
      g.style.width = (r.width * k).toFixed(1) + 'px';
      g.style.height = (r.height * k).toFixed(1) + 'px';
      g.style.objectFit = 'contain';
      g.style.imageRendering = 'pixelated';
      if (flip) g.style.transform = flip;
      g.style.opacity = '0.45';
      g.style.filter = 'brightness(1.1) saturate(0.3)';
      layer.appendChild(g);
      const fade = g.animate(
        [{ opacity: 0.5 }, { opacity: 0.22, offset: 0.5 }, { opacity: 0 }],
        { duration: 300, easing: 'ease-out', fill: 'forwards' },
      );
      fade.onfinish = () => g.remove();
      ghosts.push(g);
      if (ghosts.length > 6) ghosts.shift().remove();
    };
    let t = 0;
    return () => {
      t++;
      st.ox = Math.sin(t * 0.5) * amp;
      if (t <= 38 && t % 5 === 0) spawnGhost();
      if (t >= 44) { st.ox = 0; return false; }
      return true;
    };
  },
  AnimTask_Minimize(E, args) {
    const m = E.mon(sideOf(A(args, 0, 0)));
    let t = 0;
    return () => {
      t++;
      m.sy = Math.max(0.4, 1 - t / 20);
      return t < 20;
    };
  },
  AnimTask_DigDownMovement(E, args) {
    const m = E.mon('bp');
    if (A(args, 0, 0) !== 0) {
      m.hidden = true;
      m.oy = 40;
      return () => false;
    }
    let t = 0;
    return () => {
      t++;
      m.oy = (t / 30) * 40;
      if (t >= 30) { m.hidden = true; m.oy = 40; return false; }
      return true;
    };
  },
  AnimTask_DigUpMovement(E, args) {
    const m = E.mon('bp');
    m.hidden = false;
    m.oy = 40;
    if (A(args, 0, 0) === 0) {
      E.opts.onReveal?.();
      return () => false;
    }
    const dur = E.label === 'Move_DIG' && E.twoTurn && E.turn === 2 ? 8 : 20;
    let t = 0;
    return () => {
      t++;
      m.oy = 40 * (1 - t / dur);
      if (t >= dur) { m.oy = 0; return false; }
      return true;
    };
  },
  AnimTask_Splash(E) {
    const m = E.mon('bp');
    let t = 0;
    return () => {
      t++;
      m.oy = -Math.abs(Math.sin(t / 3)) * 10;
      if (t > 30) { m.oy = 0; return false; }
      return true;
    };
  },
  AnimTask_SkullBashPosition(E) {
    const m = E.mon('bp');
    let t = 0;
    return () => {
      t++;
      m.oy = Math.sin(t / 4) * 4;
      return t < 40;
    };
  },
  AnimTask_Rollout(E) {
    const rock = E.createSprite('gRolloutRockSpriteTemplate', true, 2, []);
    if (rock) {
      rock.gx = ATK_X;
      rock.gy = ATK_Y;
      rock.sx = rock.sy = 1.15;
      rock.rotSpeed = 28;
      linearTo(rock, 26, TGT_X, TGT_Y, 8);
    }
    return () => false;
  },
  AnimTask_SquishAndSweatDroplets(E, args) { return TASKS.AnimTask_StretchTargetUp(E, args); },
  AnimTask_SmellingSaltsSquish(E, args) { return TASKS.AnimTask_StretchTargetUp(E, args); },
  AnimTask_SlackOffSquish(E, args) { return TASKS.AnimTask_StretchTargetUp(E, args); },
  AnimTask_MeditateStretchAttacker(E, args) { return TASKS.AnimTask_StretchAttackerUp(E, args); },
  AnimTask_DefenseCurlDeformMon(E, args) { return TASKS.AnimTask_StretchAttackerUp(E, args); },
  AnimTask_Withdraw(E, args) { return TASKS.AnimTask_GrowAndShrink(E, [-24, -24, 0, 0, 24]); },
  AnimTask_AcidArmor(E, args) { return TASKS.AnimTask_GrowAndShrink(E, [-20, -20, 0, 0, 30]); },
  AnimTask_ElectricBolt(E, args) {
    spawnBolt(E, s16(A(args, 0)), s16(A(args, 1)), A(args, 2));
    return () => false;
  },
  AnimTask_VoltTackleBolt(E, args) { spawnBolt(E, rnd(-24, 24), -60, 1); return () => false; },
  AnimTask_ShockWaveProgressingBolt(E) { spawnBolt(E, 0, -60, 1); return () => false; },
  AnimTask_ShockWaveLightning(E) { spawnBolt(E, 0, -50, 0); return () => false; },
  AnimTask_ElectricChargingParticles(E) { return () => false; },
  AnimTask_CreateSurfWave(E) {
    E.surfX = 0;
    E.surfY = -48;
    E.surfTop = 30;
    E.surfBottom = 70;
    E.surfAlpha = 0;
    let t = 0;
    return () => {
      t++;
      E.surfX -= 2;
      E.surfY += 1;
      E.surfTop = Math.max(0, 30 - t * 0.5);
      E.surfBottom = Math.min(100, 70 + t * 0.45);
      E.surfAlpha = Math.min(0.72, t / 18);
      if (t > 110) E.surfAlpha = Math.max(0, 0.72 - (t - 110) / 20);
      if (t > 132) { E.surfAlpha = 0; return false; }
      return true;
    };
  },
  AnimTask_CreateRaindrops(E) { E.weather = 'rain'; return () => { setTimeout(() => { if (E.alive) E.weather = null; }, 1200); return false; }; },
  AnimTask_Hail(E) {
    E.weather = 'hail';
    let t = 0;
    return () => {
      t++;
      if (t > 90) { E.weather = null; return false; }
      return true;
    };
  },
  AnimTask_LoadSandstormBackground(E) { E.weather = 'sand'; E.bgTint = { color: '#c9a25a', alpha: 0.35 }; return () => false; },
  AnimTask_LoadMusicNotesPals(E) { return () => false; },
  AnimTask_FreeMusicNotesPals(E) { return () => false; },
  AnimTask_MusicNotesRainbowBlend(E) { E.mon('be').sat = 1.5; return () => false; },
  AnimTask_MusicNotesClearRainbowBlend(E) { E.mon('be').sat = 1; return () => false; },
  AnimTask_SetPsychicBackground() { return () => false; },
  AnimTask_CreateSpotlight(E) { return () => false; },
  AnimTask_RemoveSpotlight(E) { return () => false; },
  AnimTask_FlashAnimTagWithColor() { return () => false; },
  AnimTask_BlendBackground(E) { return () => false; },
  AnimTask_MoveHeatWaveTargets(E) { return () => false; },
  AnimTask_MetallicShine(E) {
    const m = E.mon('be');
    m.bright = 1.3; m.sat = 0.2; m.sepia = 0.1;
    return () => false;
  },
  AnimTask_FacadeColorBlend(E) { E.mon('bp').sat = 1.6; E.mon('bp').hue = -20; return () => false; },
  AnimTask_ConversionAlphaBlend(E) { return () => false; },
  AnimTask_Conversion2AlphaBlend(E) { return () => false; },
  AnimTask_SetCamouflageBlend(E) { return () => false; },
  AnimTask_TraceMonBlended(E) { return () => false; },
  AnimTask_AttackerPunchWithTrace(E) { return () => false; },
  AnimTask_WindUpLunge(E, args) {
    const m = E.mon(sideOf(A(args, 0, 0)));
    const x0 = m.ox;
    const y0 = m.oy;
    const wind = A(args, 1, -24);
    const amp = A(args, 2, 8);
    const windDur = Math.max(1, A(args, 3, 23));
    const delay = Math.max(0, A(args, 4, 10));
    const lunge = A(args, 5, 40);
    const lungeDur = Math.max(1, A(args, 6, 10));
    const phaseStep = 0x8000 / windDur;
    const contact = !E.noContact && !E.hasProjectile && E.label !== 'Move_SNATCH';
    const reach = contact ? E.meleeVector() : null;
    const startX = x0 + wind;
    const endX = reach ? x0 + reach.x : startX + lunge;
    const startY = y0;
    const endY = reach ? y0 + reach.y : y0;
    let t = 0;
    let phase = 0;
    let stage = 0;
    let pause = 0;
    return () => {
      if (stage === 0) {
        t++;
        m.ox = x0 + wind * Math.min(1, t / windDur);
        m.oy = y0 + angleSin(phase, amp);
        phase += phaseStep;
        if (t >= windDur) { stage = 1; t = 0; }
        return true;
      }
      if (stage === 1) {
        if (pause++ < delay) return true;
        stage = 2;
        t = 0;
      }
      t++;
      const k = Math.min(1, t / lungeDur);
      m.ox = startX + (endX - startX) * k;
      m.oy = startY + (endY - startY) * k;
      return k < 1;
    };
  },
  AnimTask_GlareEyeDots(E) { return () => false; },
  AnimTask_MoonlightEndFade(E) { E.bgTint = { color: '#2b2e6b', alpha: 0.15 }; return () => false; },
  AnimTask_MorningSunLightBeam(E) { E.bgTint = { color: '#fff2a8', alpha: 0.25 }; return () => false; },
  AnimTask_HeartsBackground(E) { E.bgTint = { color: '#f8669c', alpha: 0.2 }; return () => false; },
  AnimTask_CurseStretchingBlackBg(E) { E.bgTint = { color: '#000000', alpha: 0.45 }; return () => false; },
  AnimTask_HazeScrollingFog(E) { E.bgTint = { color: '#d8e8f0', alpha: 0.3 }; return () => false; },
  AnimTask_MistBallFog(E) { E.bgTint = { color: '#d8c8e8', alpha: 0.25 }; return () => false; },
  AnimTask_ImprisonOrbs(E) { return () => false; },
  AnimTask_GrudgeFlames(E) { return () => false; },
  AnimTask_DoomDesireLightBeam(E) { return () => false; },
  AnimTask_NightShadeClone(E) { return () => false; },
  AnimTask_NightmareClone(E) {
    E.createSprite('gDevilSpriteTemplate', true, 3, []);
    return () => false;
  },
  AnimTask_TransformMon(E) {
    const m = E.mon('be');
    let t = 0;
    return () => {
      t++;
      m.sx = 1 + Math.sin(t / 3) * 0.12;
      m.sy = 1 + Math.sin(t / 3 + 1) * 0.12;
      m.hue = (t * 12) % 360;
      if (t > 60) { m.sx = 1; m.sy = 1; m.hue = 0; return false; }
      return true;
    };
  },
  AnimTask_MonToSubstitute(E) {
    const m = E.mon('bp');
    let t = 0;
    return () => {
      t++;
      m.sat = Math.max(0.2, 1 - t / 12);
      if (t > 30) return false;
      return true;
    };
  },
  AnimTask_SwapMonSpriteToFromSubstitute(E) { return TASKS.AnimTask_MonToSubstitute(E); },
  AnimTask_SubstituteFadeToInvisible(E) {
    const m = E.mon('bp');
    let t = 0;
    return () => { t++; m.alpha = Math.max(0, 1 - t / 14); return t < 14; };
  },
  AnimTask_UproarDistortion(E) { return () => false; },
  AnimTask_ExtrasensoryDistortion(E) { return () => false; },
  AnimTask_DragonDanceWaver(E) { return () => false; },
  AnimTask_TeeterDanceMovement(E) {
    const m = E.mon('bp');
    let t = 0;
    return () => {
      t++;
      m.ox = Math.sin(t / 4) * 12;
      if (t > 84) { m.ox = 0; return false; }
      return true;
    };
  },
  AnimTask_ThrashMoveMonHorizontal(E) { return () => false; },
  AnimTask_ThrashMoveMonVertical(E) { return () => false; },
  AnimTask_FlailMovement(E) { return () => false; },
  AnimTask_SetGrayscaleOrOriginalPal(E, args) {
    const m = E.mon(sideOf(A(args, 0, 1)));
    const dur = Math.max(8, A(args, 1, 30));
    let t = 0;
    return () => {
      t++;
      m.sat = Math.max(0, 1 - t / 10);
      if (t > dur) { m.sat = 1; return false; }
      return true;
    };
  },
  AnimTask_PainSplitMovement(E, args) {
    return TASKS.AnimTask_ShakeMon(E, [A(args, 0, 1), 4, 0, 6, 2]);
  },
  AnimTask_ShakeTargetInPattern(E, args) {
    // 打雷/雷击：脚本这里的抖动会被识别成攻击方，命中特效结束后攻击方还会左右震一下；
    // 受击抖动已由战斗页在命中帧处理，这里直接跳过
    if (E.label === 'Move_THUNDER') return () => false;
    return TASKS.AnimTask_ShakeMon(E, [A(args, 0, 1), 3, 0, 8, 2]);
  },
  AnimTask_HardwarePaletteFade() { return () => false; },
  AnimTask_AnimateGustTornadoPalette(E) { E.mon('be').hue = -20; return () => false; },
  AnimTask_ScaryFace(E) {
    const eye = E.createSprite('gMeanLookEyeSpriteTemplate', true, 3, []);
    if (eye) {
      eye.gx = TGT_X;
      eye.gy = TGT_Y;
      eye.sx = eye.sy = 0.9;
      eye.life = 54;
      eye.onTick = () => {
        eye.sx = eye.sy = Math.min(1.45, 0.9 + eye.age / 12);
        if (eye.age > 42) eye.alpha = Math.max(0, (54 - eye.age) / 12);
      };
    }
    return TASKS.AnimTask_ShakeMon(E, [1, 4, 0, 8, 2]);
  },
  AnimTask_RapinSpinMonElevation(E) {
    const m = E.mon('bp');
    let t = 0;
    return () => {
      t++;
      m.rot += 24;
      m.oy = -Math.sin((t / 30) * Math.PI) * 14;
      if (t > 30) { m.rot = 0; m.oy = 0; return false; }
      return true;
    };
  },
  AnimTask_EruptionLaunchRocks(E, args) {
    for (let i = 0; i < 5; i++) {
      const s = E.createSprite('gEruptionLaunchRockSpriteTemplate', false, 3, [i, 0, 0]);
      if (s) { s.gx = ATK_X + rnd(-30, 30); s.gy = ATK_Y; burstAround(s, 30, 2.6, 0.12); }
    }
    return () => false;
  },
  AnimTask_SkillSwap(E) {
    E.mon('bp').hue = 60; E.mon('be').hue = -60;
    return () => false;
  },
  AnimTask_DrillPeckHitSplats(E) {
    for (let i = 0; i < 3; i++) {
      const s = E.createSprite('gBasicHitSplatSpriteTemplate', true, 3, [0, 0, 1, 1]);
      if (s) s.life = 14;
    }
    return () => false;
  },
  AnimTask_ShakeAndSinkMon(E) {
    if (E.label === 'Move_STRENGTH') {
      const m = E.mon('bp');
      E.strengthImpacted = false;
      const spots = [
        [-18, -10, 0.72], [12, 8, 1.22], [0, 0, 0.9],
        [-8, 14, 1.38], [20, -6, 0.65], [-20, 4, 1.05],
        [6, -16, 0.85], [15, 14, 1.28], [-12, -18, 1.0],
      ].sort(() => Math.random() - 0.5);
      let t = 0;
      let next = 0;
      const hit = (spot) => {
        const fx = E.createSprite('gBasicHitSplatSpriteTemplate', true, 3, [0, 0, 1, 2]);
        if (fx) {
          fx.gx = TGT_X + spot[0];
          fx.gy = TGT_Y + spot[1];
          fx.sx = spot[2];
          fx.sy = spot[2];
          fx.life = 18;
        }
        E.createTask('AnimTask_ShakeMon', [1, 3, 0, 3, 1]);
      };
      return () => {
        t++;
        if (t <= 18) m.sx = m.sy = 1 - t * 0.018;
        else if (t < 23) m.sx = m.sy = 0.68 + (t - 18) * 0.12;
        else if (t <= 23) m.sx = m.sy = 1.28;
        else if (t < 30) m.sx = m.sy = 1.28 - (t - 23) * 0.04;
        else {
          if (t === 30) m.sx = m.sy = 1;
          if (t >= 30 && (t - 30) % 5 === 0 && next < spots.length) hit(spots[next++]);
          if (next >= spots.length && t > 30 + (spots.length - 1) * 5 + 4) {
            E.strengthImpacted = true;
            return false;
          }
        }
        return true;
      };
    }
    const m = E.mon('be');
    let t = 0;
    return () => {
      t++;
      m.ox = angleSin(t * 16, 3);
      m.oy = Math.min(20, t * 0.5);
      if (t > 30) { m.ox = 0; m.oy = 0; return false; }
      return true;
    };
  },
  AnimTask_SmokescreenImpact(E) {
    E.createSprite('__smokescreenImpact', true, 3, []);
    return () => false;
  },
  AnimTask_BarrageBall(E) {
    const s = E.createSprite('gBarrageBallSpriteTemplate', false, 3, []);
    if (s) { initAtk(s); linearTo(s, 18, TGT_X, TGT_Y, 12); }
    return () => false;
  },
  AnimTask_SporeDoubleBattle(E) {
    for (let i = 0; i < 4; i++) {
      const s = E.createSprite('gSporeParticleSpriteTemplate', true, 3, [rnd(-20, 20), rnd(-10, 10), 24, 0, 4, 8]);
      if (s) s.life = 30;
    }
    return () => false;
  },
  AnimTask_SketchDrawMon(E) {
    const s = E.createSprite('gPencilSpriteTemplate', true, 3, []);
    if (s) { s.gx = TGT_X; s.gy = TGT_Y; s.life = 30; }
    return () => false;
  },
  AnimTask_FakeOut(E) {
    const m = E.mon('be');
    let t = 0;
    return () => {
      t++;
      m.ox = angleSin(t * 20, 5);
      if (t > 24) { m.ox = 0; return false; }
      return true;
    };
  },
  AnimTask_StockpileDeformMon(E) { return TASKS.AnimTask_GrowAndShrink(E, [-24, -24, 0, 0, 26]); },
  AnimTask_SpitUpDeformMon(E) { return TASKS.AnimTask_GrowAndShrink(E, [24, 24, 0, 0, 20]); },
  AnimTask_SwallowDeformMon(E) { return TASKS.AnimTask_GrowAndShrink(E, [-20, -20, 0, 0, 26]); },
  AnimTask_AlphaFadeIn(E) {
    const m = E.mon('bp');
    m.alpha = 0;
    let t = 0;
    return () => {
      t++;
      m.alpha = Math.min(1, t / 14);
      return t < 14;
    };
  },
  AnimTask_AttackerStretchAndDisappear(E) {
    const m = E.mon('bp');
    let t = 0;
    return () => {
      t++;
      m.sx = 1 + t / 30;
      m.alpha = Math.max(0, 1 - t / 18);
      return t < 20;
    };
  },
  AnimTask_ExtremeSpeedImpact(E) {
    E.shakeX = 8;
    setTimeout(() => { if (E.alive) E.shakeX = 0; }, 220);
    return () => false;
  },
  AnimTask_SpeedDust(E) {
    for (let i = 0; i < 6; i++) {
      const s = E.createSprite('gSpeedDustSpriteTemplate', false, 2, [rnd(-10, 10), rnd(-6, 6), 0]);
      if (s) { s.gx = ATK_X + rnd(-16, 16); s.gy = ATK_Y + rnd(-8, 8); popAndFade(s, 20); }
    }
    return () => false;
  },
  AnimTask_ExtremeSpeedMonReappear(E) {
    const m = E.mon('bp');
    m.alpha = 0;
    let t = 0;
    return () => {
      t++;
      m.alpha = Math.min(1, t / 10);
      return t < 10;
    };
  },
  AnimTask_VoltTackleAttackerReappear(E) { return TASKS.AnimTask_ExtremeSpeedMonReappear(E); },
  AnimTask_ShrinkTargetCopy(E) {
    const m = E.mon('be');
    let t = 0;
    return () => {
      t++;
      m.sx = m.sy = Math.max(0.4, 1 - t / 20);
      if (t >= 20) { m.sx = 1; m.sy = 1; return false; }
      return true;
    };
  },
  AnimTask_TransparentCloneGrowAndShrink(E) {
    const m = E.mon('be');
    let t = 0;
    return () => {
      t++;
      const k = Math.sin((t / 30) * Math.PI);
      m.sx = 1 + k * 0.4; m.sy = 1 + k * 0.4;
      m.alpha = 0.5 + k * 0.5;
      if (t > 30) { m.sx = 1; m.sy = 1; m.alpha = 1; return false; }
      return true;
    };
  },
  AnimTask_CycleMagicalLeafPal(E) {
    E.mon('bp').hue = 60; E.mon('bp').sat = 1.4;
    return () => false;
  },
  AnimTask_BlendPalInAndOutByTag() { return () => false; },
  AnimTask_RotateAuroraRingColors(E) { E.mon('bp').hue = 140; return () => false; },
  AnimTask_HelpingHandAttackerMovement(E) {
    return TASKS.AnimTask_ShakeMon(E, [0, 3, 0, 6, 2]);
  },
  AnimTask_TormentAttacker(E) {
    E.mon('bp').hue = -40;
    return () => false;
  },
  AnimTask_MementoShadow(E) {
    E.bgTint = { color: '#000000', alpha: 0.45 };
    return () => false;
  },
  AnimTask_InitMementoShadow(E) { return TASKS.AnimTask_MementoShadow(E); },
  AnimTask_MoveAttackerMementoShadow(E) { return TASKS.AnimTask_MementoShadow(E); },
  AnimTask_MoveTargetMementoShadow(E) { return TASKS.AnimTask_MementoShadow(E); },
  AnimTask_MementoHandleBg(E) { E.bgTint = null; return () => false; },
  AnimTask_WaterSpoutLaunch(E) {
    for (let i = 0; i < 5; i++) {
      const s = E.createSprite('gWaterDropletSpriteTemplate', false, 2, [rnd(-20, 20), 0, rnd(-3, 3), -3, 0, 8]);
      if (s) { s.gx = ATK_X + rnd(-20, 20); s.gy = ATK_Y; drift(s, 0, -2.2, 20); }
    }
    return () => false;
  },
  AnimTask_WaterSpoutRain(E) {
    for (let i = 0; i < 8; i++) {
      const s = E.createSprite('gWaterDropletSpriteTemplate', true, 2, [rnd(-30, 30), 0, 0, 3, 0, 8]);
      if (s) { s.gx = TGT_X + rnd(-40, 40); s.gy = TGT_Y - 80; drift(s, 0, 3, 24); }
    }
    return () => false;
  },
  AnimTask_AirCutterProjectile(E) {
    for (let i = 0; i < 3; i++) {
      const s = E.createSprite('gAirCutterSliceSpriteTemplate', true, 3, [rnd(-20, 20), rnd(-14, 14), 0]);
      if (s) { s.gx = TGT_X; s.gy = TGT_Y; popAndFade(s, 20); }
    }
    return () => false;
  },
  AnimTask_LeafBlade(E) {
    for (let i = 0; i < 2; i++) {
      const s = E.createSprite('gCuttingSliceSpriteTemplate', true, 3, [0, 0, 0]);
      if (s) { s.gx = TGT_X; s.gy = TGT_Y; s.life = 18; }
    }
    return () => false;
  },
  AnimTask_WaterSport(E) { E.weather = 'rain'; return () => false; },
  AnimTask_PositionFissureBgOnBattler(E) { E.bgOffsetX = 20; return () => false; },
  AnimTask_MoveSeismicTossBg(E) {
    let t = 0;
    let v = 22;
    E.bgSlideVX = 0;
    E.bgSlideVY = 0;
    E.bgSlideUntil = -1;
    return () => {
      t++;
      E.bgOffsetY += v;
      v = Math.max(2, v - 0.35);
      const m = E.mon('bp');
      m.lungeY = Math.min(170, t * 3.2);
      if (t > 88) m.hidden = true;
      if (t >= 112) {
        m.lungeY = 0;
        m.hidden = false;
        return false;
      }
      return true;
    };
  },
  AnimTask_MoveSkyUppercutBg(E) { return TASKS.AnimTask_StartSlidingBg(E, [0, -512, 0, 40]); },
  AnimTask_SeismicTossBgAccelerateDownAtEnd(E) { return () => false; },
  AnimTask_SporeDoubleBattle2(E) { return TASKS.AnimTask_SporeDoubleBattle(E); },
  AnimTask_ShakeMonOrTerrain(E, args) { return TASKS.AnimTask_HorizontalShake(E, args); },
  AnimTask_FrozenIceCube(E) {
    const m = E.mon('be');
    const ice = E.createSprite('gFrozenIceCubeComposite', true, 3, []);
    if (ice) {
      ice.gx = TGT_X;
      ice.gy = TGT_Y - 4;
      ice.life = 78;
      ice.alpha = 0;
      ice.onTick = () => {
        const fadeIn = 10, hold = 60, fadeOut = 18;
        if (ice.age <= fadeIn) ice.alpha = 0.62 * (ice.age / fadeIn);
        else if (ice.age <= hold) ice.alpha = 0.62;
        else ice.alpha = Math.max(0, 0.62 * (1 - (ice.age - hold) / fadeOut));
      };
    }
    m.bright = 1.04;
    return () => false;
  },
  AnimTask_DoubleTeamPosition(E) { return () => false; },
  AnimTask_SpiteTargetShadow(E) { return () => false; },
  AnimTask_DestinyBondWhiteShadow(E) { return () => false; },
  AnimTask_RolePlaySilhouette(E) { return () => false; },
  AnimTask_SnatchOpposingMonMove(E) { return () => false; },
  AnimTask_SnatchPartnerMove(E) { return () => false; },
  AnimTask_OdorSleuthMovement(E) { return () => false; },
  AnimTask_SlideMonForFocusBand(E) { return () => false; },
  AnimTask_DrawFallingWhiteLinesOnAttacker(E) { return () => false; },
  AnimTask_GrowAndGrayscale2(E) { return () => false; },
  AnimTask_CopyPalUnfadedToBackup(E) { return () => false; },
  AnimTask_CopyPalFadedToUnfaded(E) { return () => false; },
  AnimTask_CopyPalUnfadedFromBackup(E) { return () => false; },
  AnimTask_AllocBackupPalBuffer(E) { return () => false; },
  AnimTask_FreeBackupPalBuffer(E) { return () => false; },
  AnimTask_LoadBallGfx(E) { return () => false; },
  AnimTask_FreeBallGfx(E) { return () => false; },
  AnimTask_ThrowBall(E) { return () => false; },
  AnimTask_IsBallBlockedByTrainer(E) { return () => false; },
  AnimTask_SwitchOutBallEffect(E) { return () => false; },
  AnimTask_SwitchOutShrinkMon(E) { return () => false; },
  AnimTask_StatChange(E) { return () => false; },
  AnimTask_StatsChange(E) { return () => false; },
  AnimTask_GetBattleTerrain(E) { return () => false; },
  AnimTask_GetWeather(E) { return () => false; },
  AnimTask_GetAttackerSide(E) { E.args[7] = E.opponent ? 1 : 0; return () => false; },
  AnimTask_GetTargetSide(E) { E.args[7] = E.opponent ? 1 : 0; return () => false; },
  AnimTask_GetTargetIsAttackerPartner(E) { return () => false; },
  AnimTask_IsTargetPlayerSide(E) { E.args[7] = E.opponent ? 1 : 0; return () => false; },
  AnimTask_IsTargetSameSide(E) { return () => false; },
  AnimTask_IsContest(E) { E.args[7] = 0; return () => false; },
  AnimTask_IsHealingMove(E) { return () => false; },
  AnimTask_IsPowerOver99(E) { return () => false; },
  AnimTask_IsFuryCutterHitRight(E) { return () => false; },
  AnimTask_GetFuryCutterHitCount(E) { return () => false; },
  AnimTask_GetIceBallCounter(E) { return () => false; },
  AnimTask_GetReturnPowerLevel(E) { return () => false; },
  AnimTask_GetFrustrationPowerLevel(E) { return () => false; },
  AnimTask_GetSeismicTossDamageLevel(E) { return () => false; },
  AnimTask_GetBattlersFromArg(E) { return () => false; },
  AnimTask_SetAnimTargetToBattlerTarget(E) { return () => false; },
  AnimTask_SetAnimAttackerAndTargetForEffectAtk(E) { return () => false; },
  AnimTask_SetAnimAttackerAndTargetForEffectTgt(E) { return () => false; },
  AnimTask_SetTargetToEffectBattler(E) { return () => false; },
  AnimTask_IsMonInvisible(E) { return () => false; },
  AnimTask_IsAttackerBehindSubstitute(E) { return () => false; },
  AnimTask_GetTrappedMoveAnimId(E) { return () => false; },
  AnimTask_CastformGfxDataChange(E) { return () => false; },
  AnimTask_GetTargetIsAttackerPartner2(E) { return () => false; },
  AnimTask_SetAttackerTargetLeftPos(E) { return () => false; },
  AnimTask_LoadPokeblockGfx(E) { return () => false; },
  AnimTask_FreePokeblockGfx(E) { return () => false; },
  AnimTask_LoadHealthboxPalsForLevelUp(E) { return () => false; },
  AnimTask_FlashHealthboxOnLevelUp(E) { return () => false; },
  AnimTask_FreeHealthboxPalsForLevelUp(E) { return () => false; },
  AnimTask_StatusClearedEffect2(E) { return () => false; },
  AnimTask_FadeScreenToWhite2(E) { return () => false; },
  AnimTask_StartSinAnimTimer(E) { return () => false; },
  AnimTask_SetBattlerSpriteYOffsetFromYScale(E) { return () => false; },
  AnimTask_MonMoveCircular(E) { return () => false; },
};
// Any task not listed above is a no-op.
const noopTask = () => () => false;

function blendPalTask(E, args) {
  const color = A(args, 4, 0);
  const selector = trimPalSelector(A(args, 0, 1), color);
  const start = A(args, 2, 0), end = A(args, 3, 0);
  if (!selector || start === end) return () => false;
  const delay = Math.max(1, A(args, 1, 0));
  let amount = start;
  let timer = 0;
  const apply = () => {
    applyPalSelector(E, selector, color, amount);
  };
  return () => {
    if (timer++ < delay) return true;
    timer = 0;
    if (amount === end) return false;
    amount += amount < end ? 1 : -1;
    apply();
    return true;
  };
}
function colorCycleTask(E, args) {
  const color = A(args, 5, 0);
  const selector = trimPalSelector(A(args, 0, 1), color);
  if (!selector) return () => false;
  const delay = Math.min(2, Math.max(1, A(args, 1, 2)));
  let num = Math.min(2, Math.max(1, A(args, 2, 2)));
  const start = A(args, 3, 0), end = A(args, 4, 8);
  let amount = start;
  let dir = 1;
  let timer = 0;
  let total = 0;
  const apply = () => {
    applyPalSelector(E, selector, color, amount);
  };
  return () => {
    if (++total > 30) {
      applyPalSelector(E, selector, color, 0);
      return false;
    }
    if (timer++ < delay) return true;
    timer = 0;
    amount += dir;
    if (amount >= end) { amount = end; dir = -1; }
    if (amount <= start) { amount = start; dir = 1; if (--num <= 0) { apply(); return false; } }
    apply();
    return true;
  };
}
function ellipticalTask(E, args) {
  const side = sideOf(A(args, 0, 0));
  const m = E.mon(side);
  if (E.label === 'Move_SUBMISSION' && side === 'bp') {
    const v = E.meleeVector();
    let t = 0;
    return () => {
      t++;
      const k = t <= 8 ? 1 - (1 - t / 8) ** 2 : Math.max(0, 1 - (t - 8) / 12);
      m.ox = v.x * k;
      m.oy = v.y * k;
      if (t >= 20) { m.ox = 0; m.oy = 0; return false; }
      return true;
    };
  }
  const ampX = A(args, 1, 8);
  const ampY = A(args, 2, 4);
  const dur = Math.max(4, A(args, 5, 20));
  let t = 0;
  return () => {
    t++;
    m.ox = angleSin(t * 12, ampX);
    m.oy = angleCos(t * 12, ampY) - ampY;
    if (t > dur) { m.ox = 0; m.oy = 0; return false; }
    return true;
  };
}
function spawnBolt(E, x, y, variant) {
  const s = E.createSprite('gLightningSpriteTemplate', false, 4, [x || 0, y || 0]);
  if (!s) {
    const z = E.createSprite('gElectricitySpriteTemplate', false, 4, [x || 0, y || 0, 5, variant || 0]);
    if (z) z.life = 20;
  }
}

// ---------------------------------------------------------------- the engine
export class EmeraldFx {
  constructor({ stage, atkImg, tgtImg }) {
    this.stage = stage;
    this.atkImg = atkImg;
    this.tgtImg = tgtImg;
    this.atkFlip = atkImg?.parentElement || atkImg;
    const sr = stage.getBoundingClientRect();
    this.rectScale = sr.width ? (stage.offsetWidth || sr.width) / sr.width : 1;
    this.session = null;
    this.prefetched = new Set();
    this.preload();
  }

  preload() {
    const imgs = new Set();
    for (const t of Object.values(PE.templates)) if (t.img) imgs.add(t.img);
    for (const img of imgs) {
      const el = new Image();
      el.src = new URL(img, ASSET_BASE).href;
    }
  }

  hasMove(id) {
    const label = PE.moves[id];
    if (!label || label === 'Move_NONE' || label === 'Move_COUNT') return false;
    const start = PE.labels[label];
    if (start === undefined) return false;
    const seen = new Set();
    const stack = [start];
    let budget = 600;
    while (stack.length && budget-- > 0) {
      let pc = stack.pop();
      while (pc >= 0 && pc < PE.script.length && budget-- > 0) {
        if (seen.has(pc)) break;
        seen.add(pc);
        const c = PE.script[pc++];
        if (c[0] === 's' || c[0] === 't' || c[0] === 'f') return true;
        if (c[0] === 'e' || c[0] === 'r') break;
        if (c[0] === 'c') {
          const t = PE.labels[c[1]];
          if (t !== undefined) stack.push(t);
        } else if (c[0] === 'g') {
          pc = PE.labels[c[1]];
        } else if (c[0] === 'q') {
          pc = PE.labels[c[2]];
        } else if (c[0] === 'j') {
          const t = PE.labels[c[3]];
          if (t !== undefined) stack.push(t);
        } else if (c[0] === 'J') {
          const t = PE.labels[c[2]];
          if (t !== undefined) stack.push(t);
        }
      }
    }
    return false;
  }

  hasStatus(kind) {
    const label = PE.status[kind];
    return !!(label && PE.labels[label] !== undefined);
  }

  scriptHasProjectile(label) {
    const start = PE.labels[label];
    if (start === undefined) return false;
    const proj = /RockBlast|RockThrow|FallingRock|PinMissile|BulletSeed|Barrage|Bonemerang|SpinningBone|IcicleSpear|SpikeCannon|PoisonSting|Twineedle|Needle|CoinThrow|EggThrow|WaterGun|Octazooka|Cannon|Seed|Pebble|IceBall|Fling|Sludge|MudShot|WeatherBall|ShadowBall|DarkPulse|AuraSphere|EnergyBall|FocusBlast|SludgeBomb|ShadowPulse|HeartProjectile|ThunderboltOrb|HiddenPowerOrb|ReversalOrb|MimicOrb|SpitUpOrb|PsychoBoostOrb|GustToTarget|RazorLeaf|Present/i;
    const seen = new Set();
    const stack = [start];
    let budget = 600;
    while (stack.length && budget-- > 0) {
      let pc = stack.pop();
      while (pc >= 0 && pc < PE.script.length && budget-- > 0) {
        if (seen.has(pc)) break;
        seen.add(pc);
        const c = PE.script[pc++];
        if (c[0] === 'e' || c[0] === 'r') break;
        if ((c[0] === 's' || c[0] === 't') && proj.test(c[1])) return true;
        if (c[0] === 'c') {
          const t = PE.labels[c[1]];
          if (t !== undefined) stack.push(t);
        } else if (c[0] === 'g') {
          pc = PE.labels[c[1]];
        } else if (c[0] === 'q') {
          pc = PE.labels[c[2]];
        } else if (c[0] === 'j') {
          const t = PE.labels[c[3]];
          if (t !== undefined) stack.push(t);
        } else if (c[0] === 'J') {
          const t = PE.labels[c[2]];
          if (t !== undefined) stack.push(t);
        }
      }
    }
    return false;
  }
  scriptMovesMon(label) {
    if (label === 'Move_PECK') return false; // 啄走贴身扑击，不只原地旋转
    const start = PE.labels[label];
    if (start === undefined) return false;
    const tmpl = /Lunge|SlideMon|BowMon|TipMon|VibrateBattlerBack|MonMoveCircular|VerticalDip|SwayMon|FlyBall|BounceBall|DiveBall/i;
    const task = /TranslateMon|DigDown|DigUp|Splash|Rollout|SkullBash|Thrash|Flail|Minimize|Teleport|DoubleTeam|GrowAndShrink|Stretch|Deform|Withdraw|AcidArmor|Stockpile|SpitUp|Swallow|RapinSpin|WaterSpout|DragonDance|TeeterDance|Squish|Smelling|SlackOff|Meditate|RockMon|RotateMon|ScaleMon|SwayMon|Uproar|Extrasensory|HelpingHand|FakeOut|OdorSleuth|ShakeAndSink|SlideOffScreen|AttackerStretch/i;
    const seen = new Set();
    const stack = [start];
    let budget = 600;
    while (stack.length && budget-- > 0) {
      let pc = stack.pop();
      while (pc >= 0 && pc < PE.script.length && budget-- > 0) {
        if (seen.has(pc)) break;
        seen.add(pc);
        const c = PE.script[pc++];
        if (c[0] === 'e' || c[0] === 'r') break;
        if (c[0] === 's' && tmpl.test(c[1])) return true;
        if (c[0] === 't' && task.test(c[1])) return true;
        if (c[0] === 'c') {
          const t = PE.labels[c[1]];
          if (t !== undefined) stack.push(t);
        } else if (c[0] === 'g') {
          pc = PE.labels[c[1]];
        } else if (c[0] === 'q') {
          pc = PE.labels[c[2]];
        } else if (c[0] === 'j') {
          const t = PE.labels[c[3]];
          if (t !== undefined) stack.push(t);
        } else if (c[0] === 'J') {
          const t = PE.labels[c[2]];
          if (t !== undefined) stack.push(t);
        }
      }
    }
    return false;
  }

  playMove(id, opts = {}) {
    const label = PE.moves[id];
    if (!label) return Promise.resolve();
    return this.play(label, opts);
  }

  playStatus(kind, opts = {}) {
    const label = PE.status[kind];
    if (!label) return Promise.resolve();
    const targetSide = opts.targetSide === 'bp' ? 'bp' : 'be';
    return this.play(label, { ...opts, moveTurn: 1, statusSide: targetSide });
  }

  play(label, opts = {}) {
    this.stop();
    if (PE.labels[label] === undefined) return Promise.resolve();
    return new Promise((resolve) => {
      const session = new Session(this, label, opts, resolve);
      this.session = session;
      session.start();
    });
  }

  stop() {
    const s = this.session;
    if (s) {
      this.session = null;
      s.destroy();
      if (s.done) { const d = s.done; s.done = null; d(); }
    }
  }

  stagePoint(gx, gy) {
    if (ACTIVE_STATUS_SIDE) {
      const t = this.anchors?.tgt || { x: 200, y: 56 };
      return { x: t.x + (gx - TGT_X) * SPR_SCALE, y: t.y + (gy - TGT_Y) * SPR_SCALE };
    }
    const a = this.anchors || { atk: { x: 72, y: 80 }, tgt: { x: 176, y: 40 } };
    const sx = (a.tgt.x - a.atk.x) / (TGT_X - ATK_X);
    const sy = (a.tgt.y - a.atk.y) / (TGT_Y - ATK_Y);
    return { x: a.atk.x + (gx - ATK_X) * sx, y: a.atk.y + (gy - ATK_Y) * sy };
  }
}

class Session {
  constructor(engine, label, opts, done) {
    this.E = engine;
    this.label = label;
    this.noContact = NO_CONTACT_LABELS.has(label);
    this.opts = opts;
    this.done = done;
    this.speed = (opts.speed || 1) * (label === 'Move_COTTON_SPORE' || label === 'Move_SCARY_FACE' ? 2 : 1);
    this.frame = 0;
    this.wait = 0;
    this.waitVisual = false;
    this.waitBg = false;
    this.scriptDone = false;
    this.finishTimer = 0;
    this.alive = true;
    this.sprites = [];
    this.tasks = [];
    this.args = new Array(16).fill(0);
    this.objAlpha = 1;
    this.monbg = null;
    this.bg = null;
    this.bgTarget = null;
    this.bgAlpha = 0;
    this.bgOffsetX = 0;
    this.bgOffsetY = 0;
    this.bgSlideVX = 0;
    this.bgSlideVY = 0;
    this.bgSlideUntil = -1;
    this.bgTint = null;
    if (label === 'Move_MEAN_LOOK') this.bgTint = { color: '#2a1038', alpha: 0.55 };
    this.flash = 0;
    this.invert = 0;
    this.shakeX = 0;
    this.weather = null;
    this.builtWeather = null;
    this.surf = 0;
    this.surfAlpha = 0;
    this.surfTop = 30;
    this.surfBottom = 70;
    this.surfX = 0;
    this.surfY = -48;
    this.spotlight = false;
    this.meleeReady = !!opts.melee && !this.E.scriptMovesMon(label);
    this.hasProjectile = this.E.scriptHasProjectile(label);
    this.melee = null;
    this.meleeStarted = false;
    this.moveTurn = opts.moveTurn === undefined ? 1 : opts.moveTurn;
    this.statusSide = opts.statusSide || null;
    this.castReady = !!opts.cast && !this.statusSide && (!opts.twoTurn || label === 'Move_SKY_ATTACK');
    this.cast = null;
    this.opponent = !!opts.opponent && !this.statusSide;
    this.dirX = this.opponent ? -1 : 1;
    this.dirY = this.opponent ? -1 : 1;
    ACTIVE_STATUS_SIDE = this.statusSide;
    this.pc = PE.labels[label];
    if (this.pc === undefined) this.pc = 0;
    if (label === 'Move_WATERFALL' && PE.labels.RisingWaterHitEffect !== undefined) this.pc = PE.labels.RisingWaterHitEffect;
    this.phase2Label = null;
    this.twoTurn = !!opts.twoTurn;
    this.turn = opts.turn || 1;
    this.stack = [];
    this.mons = { bp: newMonState(), be: newMonState() };
    this.root = null;
    this.layer = null;
    this.bgEl = null;
    this.fxEl = null;
  }

  domSide(side) {
    if (!this.opponent) return side;
    return side === 'bp' ? 'be' : 'bp';
  }

  imgFor(side) {
    return this.domSide(side) === 'bp' ? this.E.atkImg : this.E.tgtImg;
  }

  mon(side) {
    const state = this.mons[side];
    const img = this.imgFor(side);
    if (img && !state.baseX) {
      const sr = this.E.stage.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      const k = this.E.rectScale || 1;
      state.baseX = (ir.left - sr.left + ir.width / 2) * k;
      state.baseY = (ir.top - sr.top + ir.height / 2) * k;
    }
    return state;
  }

  start() {
    const stage = this.E.stage;
    const sr = stage.getBoundingClientRect();
    const a = this.E.atkImg.getBoundingClientRect();
    const b = this.E.tgtImg.getBoundingClientRect();
    const k = this.E.rectScale || 1;
    const anchors = {
      atk: { x: (a.left - sr.left + a.width / 2) * k, y: (a.top - sr.top + a.height / 2) * k },
      tgt: { x: (b.left - sr.left + b.width / 2) * k, y: (b.top - sr.top + b.height / 2) * k },
    };
    // Fall back to sensible stage defaults if the preview layout isn't ready.
    if (!isFinite(anchors.atk.x) || anchors.atk.x <= 0) anchors.atk = { x: 52, y: 112 };
    if (!isFinite(anchors.tgt.x) || anchors.tgt.x <= 0) anchors.tgt = { x: 200, y: 56 };
    if (this.statusSide) {
      const t = this.statusSide === 'bp' ? { ...anchors.atk } : { ...anchors.tgt };
      anchors.atk = t;
      anchors.tgt = t;
    } else if (this.opponent) {
      const t = anchors.atk;
      anchors.atk = anchors.tgt;
      anchors.tgt = t;
    }
    this.E.anchors = anchors;

    this.root = document.createElement('div');
    this.root.className = 'pe-root';
    this.bgEl = document.createElement('div');
    this.bgEl.className = 'pe-bg';
    this.layer = document.createElement('div');
    this.layer.className = 'pe-layer';
    this.surfEl = document.createElement('div');
    this.surfEl.className = 'pe-surf';
    this.fxEl = document.createElement('div');
    this.fxEl.className = 'pe-screenfx';
    this.weatherEl = document.createElement('div');
    this.weatherEl.className = 'pe-weather';
    this.tintEl = document.createElement('div');
    this.tintEl.className = 'pe-tint';
    this.root.append(this.layer, this.fxEl, this.weatherEl);
    stage.appendChild(this.root);
    stage.insertBefore(this.bgEl, stage.firstChild);
    stage.insertBefore(this.surfEl, stage.firstChild);
    stage.insertBefore(this.tintEl, this.bgEl.nextSibling);

    this.resetMons();
    // 有发射物的招式不在这里起手：等弹道 sprite 真正出手时再前倾，保证施法动作与发射物同步
    // （近身招式没有"发射物"这一拍，仍然开场就前倾）
    if (this.castReady && (!this.hasProjectile || this.opts?.melee)) this.cast = { t: 0 };
    this.shakeEl = stage.querySelector ? (stage.querySelector('.battle-stage-top') || stage) : stage;
    this.last = performance.now();
    this.acc = 0;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resetMons() {
    for (const img of [this.E.atkImg, this.E.tgtImg]) {
      if (!img) continue;
      img.style.removeProperty('transform');
      img.style.removeProperty('transform-origin');
      img.style.removeProperty('filter');
      img.style.removeProperty('opacity');
      img.style.transformOrigin = '50% 100%';
    }
    if (this.E.atkFlip) this.E.atkFlip.style.removeProperty('transform');
    this.renderMons(true);
  }

  renderMons(force = false) {
    for (const side of ['bp', 'be']) {
      const st = this.mons[side];
      const img = this.imgFor(side);
      if (!img) continue;
      const dom = this.domSide(side);
      const dim = this.monbg && this.monbg !== side ? 0.55 : 1;
      const hidden = st.hidden ? 0 : 1;
      const alpha = st.alpha * hidden;
      const scaleX = st.sx, scaleY = st.sy;
      const rot = st.rot;
      const tx = (st.ox + (st.lungeX || 0) + (st.castX || 0)) * this.dirX;
      const ty = st.oy + (st.lungeY || 0) + (st.castY || 0);
      if (dom === 'bp') {
        if (this.E.atkFlip) this.E.atkFlip.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scaleX(-1)`;
        img.style.transform = `scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}) rotate(${rot.toFixed(2)}deg)`;
      } else {
        img.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}) rotate(${rot.toFixed(2)}deg)`;
      }
      let filter = applyTintFilter(st);
      const vf = variantFilter(img);
      if (vf) filter = filter === 'none' ? vf : `${vf} ${filter}`;
      if (dim !== 1) filter = filter === 'none' ? `brightness(${dim})` : `${filter} brightness(${dim})`;
      img.style.filter = filter;
      img.style.opacity = String(alpha);
    }
  }

  loop(now) {
    if (!this.alive) return;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.acc += dt;
    const frameMs = 1000 / FPS / this.speed;
    let guard = 0;
    while (this.acc >= frameMs && guard++ < 8) {
      this.acc -= frameMs;
      this.tick();
      if (!this.alive) return;
    }
    this.render();
    if (this.finished()) {
      this.finishDelay = (this.finishDelay || 0) + dt;
      if (this.finishDelay > 120) { this.stopSelf(); return; }
    }
    requestAnimationFrame(this.loop);
  }

  finished() {
    if (!this.scriptDone) return false;
    return this.sprites.length === 0 && this.tasks.length === 0;
  }
  tick() {
    this.frame++;
    if (this.wait > 0) {
      this.wait--;
    } else if (this.waitVisual) {
      if (!this.visualBusy()) {
        this.waitVisual = false;
        this.run();
      }
    } else if (!this.scriptDone) {
      this.run();
    }
    this.tickSprites();
    this.tickTasks();
    this.tickMelee();
    this.tickCast();
    this.tickBg();
    if (this.scriptDone && this.waitVisual && !this.visualBusy()) {
      this.waitVisual = false;
    }
    if (this.frame > 60 * 30) this.stopSelf();
  }

  run() {
    let guard = 0;
    while (this.alive && !this.scriptDone && this.wait === 0 && !this.waitVisual && !this.waitBg && guard++ < 400) {
      if (this.pc < 0 || this.pc >= PE.script.length) { this.scriptDone = true; return; }
      const cmd = PE.script[this.pc++];
      const op = cmd[0];
      switch (op) {
        case 'd':
          if (this.label === 'Move_FORESIGHT') break;
          if (this.label === 'Move_SUPER_FANG' && Number(cmd[1]) >= 15) {
            this.wait = 6; // 蓄力抖完立刻扑出去，不再多等 20 帧
            break;
          }
          if (this.label === 'Move_THUNDER') {
            this.wait = Math.max(1, Math.round((Number(cmd[1]) || 1) * 0.55));
            break;
          }
          if (FAST_POWDER_MOVES.test(this.label)) {
            this.wait = Math.max(1, Math.round((Number(cmd[1]) || 1) * 0.55));
            break;
          }
          if (this.label === 'Move_MIMIC') {
            this.wait = Math.min(8, Math.max(1, Number(cmd[1]) || 1));
            break;
          }
          if (this.label === 'Move_REVERSAL') {
            this.wait = Math.min(6, Math.max(1, Number(cmd[1]) || 1));
            break;
          }
          if (this.label === 'Move_DIG' && this.twoTurn) {
            this.wait = Math.min(8, Math.max(1, Number(cmd[1]) || 1));
            break;
          }
          if (this.label === 'Move_ICE_PUNCH' && this._iceShardBurst && Number(cmd[1]) >= 15) {
            this.wait = 1;
            break;
          }
          if (this.label === 'Move_BODY_SLAM') {
            const n = Number(cmd[1]) || 1;
            // 落地即结算：击退/命中贴图不再额外等待
            if (n === 11 || n === 6) break;
          }
          if (this.label === 'Move_RAZOR_LEAF') {
            const n = Number(cmd[1]) || 1;
            if (n === 60) { this.wait = 20; break; }
            if (n === 20) { this.wait = 6; break; }
          }
          if (this.label === 'Move_TOXIC' && Number(cmd[1]) === 15) {
            this.wait = 7;
            break;
          }
          if (this.label === 'Move_SMOG' && Number(cmd[1]) >= 100) {
            this.wait = 24;
            break;
          }
          if (this.label === 'Move_DOUBLE_TEAM' && Number(cmd[1]) > 4) {
            this.wait = 4;
            break;
          }
          if (this.castReady && this.hasProjectile && !this._projFired) {
            this.wait = Math.min(6, Math.max(1, Number(cmd[1]) || 1));
            break;
          }
          this.wait = Math.min(30, Math.max(1, Number(cmd[1]) || 1));
          break;
        case 'w':
          if (this.label === 'Move_PSYCHIC' && !this._psyWaitSkipped) {
            this._psyWaitSkipped = true;
            break;
          }
          if (this.label === 'Move_ROCK_SMASH' && !this._rockSmashWaitSkipped) {
            this._rockSmashWaitSkipped = true;
            break;
          }
          if (this.visualBusy()) this.waitVisual = true;
          break;
        case 'e':
          if (this.phase2Label !== null) {
            this.pc = this.phase2Label;
            this.phase2Label = null;
            this.wait = 4;
          } else {
            this.scriptDone = true;
          }
          break;
        case 's':
          if (this.label === 'Move_REVERSAL' && cmd[1] === 'gComplexPaletteBlendSpriteTemplate') break;
          this.createSprite(cmd[1], cmd[2] === 'TARGET', cmd[3] || 0, cmd.slice(4));
          break;
        case 't':
          if (this.label === 'Move_FORESIGHT' && cmd[1] === 'AnimTask_BlendMonInAndOut') break;
          if (this.label === 'Move_REVERSAL' && cmd[1] === 'AnimTask_BlendColorCycle') break;
          if (this.label === 'Move_MIMIC' && cmd[1] === 'AnimTask_BlendColorCycle') break;
          this.createTask(cmd[1], cmd.slice(3));
          break;
        case 'c': {
          if (cmd[1] === 'IceCrystalEffectShort' && (this.label === 'Move_ICE_BEAM' || this.label === 'Move_ICE_PUNCH')) break;
          if (cmd[1] === 'SmogCloud' && this.label === 'Move_SMOG') {
            this._smogClouds = (this._smogClouds || 0) + 1;
            if (this._smogClouds > 3) break;
          }
          if (cmd[1] === 'RisingWaterHitEffect' && this.label === 'Move_DIVE') break;
          if (cmd[1] === 'DigThrowDirt' && this.label === 'Move_DIG' && this.twoTurn && this.turn === 1) {
            if (this._digDirtDone) break;
            this._digDirtDone = true;
          }
          const target = PE.labels[cmd[1]];
          if (target === undefined) break;
          this.stack.push(this.pc);
          this.pc = target;
          break;
        }
        case 'r':
          if (this.stack.length) this.pc = this.stack.pop();
          else this.scriptDone = true;
          break;
        case 'g':
          if (PE.labels[cmd[1]] !== undefined) this.pc = PE.labels[cmd[1]];
          break;
        case 'q': {
          const first = PE.labels[cmd[1]];
          const second = PE.labels[cmd[2]];
          if (second === undefined) break;
          if (this.twoTurn && first !== undefined) {
            this.pc = this.turn === 2 ? second : first;
          } else {
            this.pc = first !== undefined ? first : second;
          }
          break;
        }
        case 'j': {
          const argId = cmd[1];
          const val = argId === 'RET' ? Number(this.args[7] || 0) : Number(this.args[argId] || 0);
          if (val === Number(cmd[2]) && PE.labels[cmd[3]] !== undefined) this.pc = PE.labels[cmd[3]];
          break;
        }
        case 'J':
          if (this.moveTurn === Number(cmd[1]) && PE.labels[cmd[2]] !== undefined) this.pc = PE.labels[cmd[2]];
          break;
        case 'K':
          break;
        case 'A':
          this.args[Number(cmd[1])] = Number(cmd[2]);
          break;
        case 'm':
          this.monbg = null;
          break;
        case 'M':
          this.monbg = null;
          break;
        case 'a':
          this.objAlpha = clamp(Number(cmd[1]) / 16, 0, 1);
          break;
        case 'b':
          this.objAlpha = 1;
          this.monbg = null;
          this.bgTint = null;
          setMonTint(this.mon('bp'), 0, 0);
          setMonTint(this.mon('be'), 0, 0);
          break;
        case 'f': {
          const id = cmd.length > 3 ? (this.opponent ? cmd[2] : cmd[1]) : cmd[1];
          const bg = Number(id);
          this.bgTarget = (bg === 3 || bg === 15) ? null : (PE.backgrounds[bg] || BG_STYLE[bg] || null);
          this.bgOffsetX = 0;
          this.bgOffsetY = 0;
          this.bgSlideVX = 0;
          this.bgSlideVY = 0;
          this.bgSlideUntil = -1;
          this.bgFadeIn = true;
          // 真气拳/必杀门牙：冲击背景瞬现，和拳头/牙齿特效同帧，不再提前淡入抢拍
          if (this.bgTarget && (this.label === 'Move_FOCUS_PUNCH' || this.label === 'Move_HYPER_FANG')) {
            this.bgAlpha = 1;
          }
          break;
        }
        case 'R':
          this.bgTarget = null;
          this.bgTint = null;
          this.bgOffsetX = 0;
          this.bgOffsetY = 0;
          this.bgSlideVX = 0;
          this.bgSlideVY = 0;
          this.bgSlideUntil = -1;
          this.bgFadeIn = true;
          break;
        case 'F':
        case 'o':
          this.waitBg = true;
          break;
        case 'i':
          this.mon(sideOf(A(cmd, 1, 0))).hidden = true;
          break;
        case 'v':
          this.mon(sideOf(A(cmd, 1, 0))).hidden = false;
          break;
        default:
          break;
      }
    }
  }

  visualBusy() {
    return this.sprites.some((s) => !s.noWait) || this.tasks.length > 0;
  }

  maybeMeleeLunge(name) {
    if (!this.meleeReady || this.meleeStarted) return;
    if (this.noContact || this.hasProjectile) return;
    const melee = /Fist|Foot|Hand|Bone|Smelling|Slash|Claw|Scratch|Kick|Punch|HornHit|Bite|Fang|Teeth|Slam|Whip|Strike|Cutting|CrossChop|ArmThrust|KarateChop|Megahorn|Swipes|Peck|Headbutt|Rage|Thrash|Rollout|Superpower/i.test(name);
    const impact = /HitSplat|Impact/i.test(name);
    if (!melee && !(impact && !this.hasProjectile)) return;
    this.meleeStarted = true;
    if (this.cast) {
      this.cast = null;
      this.mons.bp.castX = 0;
      this.mons.bp.castY = 0;
    }
    this.melee = { t: 0, ...this.meleeVector() };
  }

  meleeVector() {
    const a = this.E.anchors?.atk;
    const t = this.E.anchors?.tgt;
    if (!a || !t) return { x: 26, y: -8 };
    const k = this.E.rectScale || 1;
    const aw = (this.imgFor('bp')?.getBoundingClientRect().width || 80) * k;
    const tw = (this.imgFor('be')?.getBoundingClientRect().width || 80) * k;
    const dx = t.x - a.x;
    const dy = t.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const travel = Math.max(0, len - (aw + tw) * 0.5);
    return { x: ((dx / len) * travel) / this.dirX, y: (dy / len) * travel };
  }

  tickMelee() {
    if (!this.melee) return;
    const m = this.mons.bp;
    const t = ++this.melee.t;
    const out = 7, hold = 4, back = 11;
    let k;
    if (t <= out) k = 1 - (1 - t / out) ** 2;
    else if (t <= out + hold) k = 1;
    else k = Math.max(0, 1 - (t - out - hold) / back);
    m.lungeX = this.melee.x * k;
    m.lungeY = this.melee.y * k;
    if (t >= out + hold + back) {
      m.lungeX = 0;
      m.lungeY = 0;
      this.melee = null;
    }
  }

  tickCast() {
    if (!this.cast) {
      // 兜底：脚本里的弹道 sprite 没被识别出来时，开场 24 帧后也补上前倾，避免整招没有施法动作
      if (this.castReady && this.hasProjectile && !this._projFired && this.frame > 24) this.cast = { t: 0 };
      return;
    }
    const m = this.mons.bp;
    const t = ++this.cast.t;
    const out = 7, hold = 5, back = 10;
    const extra = this.hasProjectile && !this._projFired ? 12 : 0;
    const backStart = out + hold + extra;
    let k;
    if (t <= out) k = t / out;
    else if (t <= backStart) k = 1;
    else k = Math.max(0, 1 - (t - backStart) / back);
    m.castX = 12 * k;
    m.castY = -2.5 * k * this.dirY;
    if (t >= backStart + back) {
      m.castX = 0;
      m.castY = 0;
      this.cast = null;
    }
  }

  createSprite(name, isTarget, sub, args) {
    if (this.label === 'Move_HYDRO_PUMP' && name === 'gWaterHitSplatSpriteTemplate') {
      // 每次 HydroPumpHitSplats 生成上下两个，只保留一个居中的
      if (this._hydroSplatPair) {
        this._hydroSplatPair = false;
        return null;
      }
      this._hydroSplatPair = true;
    }
    // 踩踏的脚是“抬起→下砸”，命中要等 HitSplat 再触发，不能一脚生成就结算
    if (this.opts?.onImpact && !this._impactFired && !/StompFoot/.test(name) && /Fist|Foot|HitSplat|Impact/i.test(name)) {
      this._impactFired = true;
      try { this.opts.onImpact(); } catch (_) {}
    }
    // 光墙/反射壁等护墙：墙面出现的这一刻就播报文字，不等后面的闪光与墙体收尾
    if (this.opts?.onImpact && !this._impactFired && /Wall/i.test(name)
      && /^Move_(LIGHT_SCREEN|REFLECT|MIRROR_COAT|BARRIER|MAGIC_COAT)$/.test(this.label)) {
      this._impactFired = true;
      try { this.opts.onImpact(); } catch (_) {}
    }
    if (this.label === 'Move_ICE_PUNCH' && /Fist|Foot|HitSplat/i.test(name)) this._icePunchHit = true;
    if (this.label === 'Move_ICE_PUNCH' && /HitSplat/i.test(name) && !this._iceShardBurst) {
      this._iceShardBurst = true;
      this.spawnIceShards();
    }
    this.maybeMeleeLunge(name);
    let tmpl = PE.templates[name];
    if (!tmpl) return null;
    // 泰山压顶：跳跃已经把攻击方送到对手头顶，脚本里的滑步/击退都不再需要
    if (this.label === 'Move_BODY_SLAM' && name === 'gSlideMonToOffsetSpriteTemplate') return null;
    // 飞叶快刀：不再发射整片大字素材，直接让炸开的树叶沿敌我连线飞出去
    if (this.label === 'Move_RAZOR_LEAF' && name === 'gRazorLeafCutterSpriteTemplate') return null;
    // 攀瀑：原作命中段另撒了一层 SmallBubbles 的四分之一圆碎片，观感杂乱；
    // 只保留 WaterHitSplat 水花，气泡由战斗页在命中帧统一补
    if (this.label === 'Move_WATERFALL' && name === 'gSmallDriftingBubblesSpriteTemplate') return null;
    // 草系招式命中：用飞叶快刀同款树叶炸开，替代通用白色命中贴图（吸取类除外，它们的贴图落在自己身上）
    if (this.opts?.type === '草' && !DRAIN_MOVE_LABELS.test(this.label) && !this._leafBurstDone && /HitSplat|Impact|Whip/i.test(name)) {
      this._leafBurstDone = true;
      this.spawnLeafBurst();
    }
    if (this.opts?.type === '草' && /HitSplat/i.test(name)) return null;
    if (this.label === 'Move_THUNDER' && name === 'gLightningSpriteTemplate' && A(args, 0) !== 16) return null;
    if ((this.label === 'Move_DRAGON_CLAW' && name === 'gFireSpinSpriteTemplate')
      || (this.label === 'Move_DRAGON_BREATH' && name === 'gDragonBreathFireSpriteTemplate')
      || (this.label === 'Move_OUTRAGE' && name === 'gOutrageFlameSpriteTemplate')) {
      tmpl = { ...tmpl, img: 'pe/Gfx_WispFire__32x32.png', frames: 4 };
    }
    if (this.label === 'Move_LEECH_LIFE' && name === 'gLeechLifeNeedleSpriteTemplate') { this._projFired = true; return null; }
    if (this.noContact && /Fist|Foot/i.test(name)) return null;
    // 弹道 sprite 出现才算真正出手：前倾跟着这一刻起手，和发射物同帧（充能用的 Charge 球不算出手）
    if (!/Charge/i.test(name) && /Ball|Orb|Projectile|Pulse|Beam|Bubble|Droplet|Seed|Needle|Rock|Wave|Cannon|Missile|Blast|Stinger|Sting|ShadowBall|Gust|RazorLeaf|Present/i.test(name)) {
      if (!this._projFired) {
        this._projFired = true;
        if (this.castReady && !this.cast) this.cast = { t: 0 };
      }
    }
    if (/Spotlight/i.test(tmpl.img || '') || /Spotlight/i.test(tmpl.cb || '') || /Spotlight/.test(name)) return null;
    if (this.label === 'Move_MIST' && name === 'gMistCloudSpriteTemplate') {
      this._mistN = (this._mistN || 0) + 1;
      if (this._mistN > 4) return null;
    }
    if (this.label === 'Move_FLAME_WHEEL' && name === 'gFireSpiralOutwardSpriteTemplate') {
      if (A(args, 3, 0) > 12) return null;
      if (this._flameStart == null) this._flameStart = this.frame;
    }
    if (this.label === 'Move_BUBBLE_BEAM' && name === 'gWaterBubbleProjectileSpriteTemplate') {
      this._bubbleN = (this._bubbleN || 0) + 1;
      if (this._bubbleN % 2 === 0) return null;
    }
    // 吸取类不弹 impact 贴图，保留吸血粒子/光球
    if (/HitSplat/.test(tmpl.cb || '') && DRAIN_MOVE_LABELS.test(this.label)) return null;
    const spr = {
      E: this,
      name,
      tmpl,
      args: args.map((v) => (typeof v === 'number' ? s16(v) : v)),
      isTarget: !!isTarget,
      gx: isTarget ? TGT_X : ATK_X,
      gy: isTarget ? TGT_Y : ATK_Y,
      x2: 0,
      y2: 0,
      sx: 1,
      sy: 1,
      rot: 0,
      rotSpeed: 0,
      alpha: 1,
      visible: true,
      age: 0,
      life: Infinity,
      dieOnLife: false,
      dead: false,
      sub: sub + 10,
      el: null,
      anim: null,
      aff: null,
      onTick: null,
    };
    if (this.label === 'Move_PAY_DAY' && /FallingCoin/i.test(name)) spr.noWait = true;
    if ((this.label === 'Move_BONE_CLUB' || this.label === 'Move_BONE_RUSH') && /ComplexPaletteBlend/i.test(name)) return null;
    if (tmpl.img || tmpl.heart) {
      const heart = !!tmpl.heart || /Heart/.test(tmpl.cb || '') || /Heart/i.test(tmpl.img || '');
      const el = document.createElement('span');
      el.className = 'pe-spr' + (tmpl.ob ? ' pe-blend' : '') + (heart ? ' pe-heart' : '');
      el.style.width = tmpl.fw + 'px';
      el.style.height = tmpl.fh + 'px';
      if (heart) el.innerHTML = '<svg viewBox="0 0 24 24"><use xlink:href="#icon-liked"/></svg>';
      else el.style.backgroundImage = `url(${new URL(tmpl.img, ASSET_BASE).href})`;
      if (tmpl.mudTint) el.style.filter = 'sepia(.9) saturate(2.2) hue-rotate(-15deg) brightness(.85)';
      el.style.zIndex = String(10 + (sub | 0));
      el.style.transformOrigin = '50% 50%';
      this.layer.appendChild(el);
      spr.el = el;
    }
    startAnim(spr, 0);
    const cb = behaviorFor(tmpl.cb);
    try { cb(spr); } catch (e) { console.warn('fx', name, e); }
    if (this.label === 'Move_HYDRO_PUMP' && name === 'gWaterHitSplatSpriteTemplate') {
      spr.gx = TGT_X;
      spr.gy = TGT_Y;
    }
    if (this.label === 'Move_BODY_SLAM' && name === 'gVerticalDipSpriteTemplate') bodySlamJump(spr);
    if (this.label === 'Move_BODY_SLAM' && name === 'gBasicHitSplatSpriteTemplate') {
      spr.gx = TGT_X;
      spr.gy = TGT_Y;
      // 砸中的一刻恢复压扁的体型
      this.mons.bp.sx = 1;
      this.mons.bp.sy = 1;
      this.createTask('AnimTask_ShakeBattleTerrain', [3, 12]);
    }
    if (this.label === 'Move_RAZOR_LEAF' && name === 'gRazorLeafParticleSpriteTemplate') this.razorLeafFlight(spr);
    if (this.label === 'Move_FIRE_PUNCH' && this._firePunchPal && !this._firePunchFlashed && /Fist|HitSplat/i.test(name)) {
      this._firePunchFlashed = true;
      applyPalSelector(this, this._firePunchPal.sel, this._firePunchPal.color, this._firePunchPal.amount);
    }
    this.sprites.push(spr);
    return spr;
  }

  spawnIceShards() {
    const list = [
      [-10, -10, 'L'], [10, 20, 'S'], [-5, 10, 'L'], [17, -12, 'S'],
      [-15, 15, 'S'], [0, 0, 'S'], [20, 2, 'L'],
    ];
    for (const [x, y, sz] of list) {
      this.createSprite(sz === 'L' ? 'gIceCrystalHitLargeSpriteTemplate' : 'gIceCrystalHitSmallSpriteTemplate', true, 3, [x, y, 0]);
    }
  }

  // 飞叶快刀：树叶先在攻击方身边浮现，旋着聚拢到身前，再沿敌我连线一起射出去
  razorLeafFlight(spr) {
    const idx = (this._leafN = (this._leafN || 0) + 1);
    const dirY = this.dirY;
    const startAng = (rnd(0, 359) / 180) * Math.PI;
    const rad = 8 + rnd(0, 10);
    // 聚拢点：攻击方身前（GBA 坐标里 +x 恒指向对手）
    const hub = { x: 18 + rnd(-2, 2), y: (-6 + rnd(-2, 2)) * dirY };
    const to = {
      x: TGT_X - ATK_X + rnd(-4, 4),
      y: (TGT_Y - ATK_Y) * dirY + rnd(-4, 4) * dirY,
    };
    const gather = 9, fly = 12, fade = 9;
    const spin = 8 + rnd(0, 6);
    let phase = 0, k = 0, x = hub.x, y = hub.y, bvx = 0, bvy = 0;
    spr.gx = ATK_X;
    spr.gy = ATK_Y;
    spr.rot = rnd(0, 359);
    spr.onTick = () => {
      if (phase === 0) {
        // 从四周旋进聚拢点
        k = Math.min(1, spr.age / gather);
        const e = k * k;
        const a = startAng + Math.PI * 0.6 * e;
        const r = rad * (1 - e);
        x = hub.x + Math.cos(a) * r * 0.6;
        y = hub.y + Math.sin(a) * r * 0.6;
        spr.rot += spin * (0.4 + e);
        if (k >= 1) { phase = 1; k = 0; }
      } else if (phase === 1) {
        // 沿敌我连线射出，轻微摆动后收束
        k = Math.min(1, k + 1 / fly);
        const e = 1 - (1 - k) ** 2;
        const wob = Math.sin(k * Math.PI * 2 + idx) * 3 * (1 - k);
        x = hub.x + (to.x - hub.x) * e + wob;
        y = hub.y + (to.y - hub.y) * e - wob * 0.5;
        spr.rot += spin * 1.6;
        if (k >= 1) {
          phase = 2;
          k = 0;
          const a2 = (idx / 10) * Math.PI * 2;
          bvx = Math.cos(a2) * (1.4 + Math.random());
          bvy = Math.sin(a2) * (1.1 + Math.random() * 0.8) * dirY;
        }
      } else {
        // 命中后散开淡出
        k += 1 / fade;
        x += bvx;
        y += bvy;
        bvx *= 0.86;
        bvy = bvy * 0.86 + 0.12 * dirY;
        spr.rot += spin * 0.7;
        if (k >= 0.35) spr.alpha = Math.max(0, 1 - (k - 0.35) / 0.65);
        if (k >= 1) spr.dead = true;
      }
      spr.x2 = x;
      spr.y2 = y;
    };
  }

  // 树叶炸开：围绕命中点向四周迸散（与飞叶快刀同款 Gfx_Leaf）
  spawnLeafBurst(cx = TGT_X, cy = TGT_Y) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const spr = this.createSprite('gRazorLeafParticleSpriteTemplate', true, 3, [0, 0, 0]);
      if (!spr) continue;
      spr.gx = cx + rnd(-6, 6);
      spr.gy = cy + rnd(-8, 5);
      spr.rot = rnd(0, 359);
      const ang = (i / n) * Math.PI * 2 + rnd(-18, 18) / 100;
      const sp = 1.4 + Math.random() * 1.2;
      let vx = Math.cos(ang) * sp;
      let vy = Math.sin(ang) * sp * 0.8;
      const life = 22 + rnd(0, 8);
      spr.onTick = () => {
        spr.x2 += vx;
        spr.y2 += vy;
        vx *= 0.93;
        vy = vy * 0.93 + 0.1;
        spr.rot += 9;
        if (spr.age > life - 7) spr.alpha = Math.max(0, (life - spr.age) / 7);
        if (spr.age >= life) spr.dead = true;
      };
    }
  }

  createTask(name, args) {
    const fn = TASKS[name] || noopTask;
    let tick;
    try { tick = fn(this, args.map((v) => (typeof v === 'number' ? s16(v) : v))); } catch (e) { tick = null; }
    if (typeof tick !== 'function') tick = () => false;
    const task = { name, args, tick, age: 0, dead: false };
    this.tasks.push(task);
    return task;
  }

  tickSprites() {
    for (const s of this.sprites) {
      if (s.dead) continue;
      s.age++;
      if (s.rotSpeed) s.rot += s.rotSpeed;
      tickAnim(s);
      tickAffine(s);
      if (s.onTick) { try { s.onTick(); } catch (e) { s.dead = true; } }
      if (s.life !== Infinity && s.age >= s.life) s.dead = true;
    }
    this.sprites = this.sprites.filter((s) => {
      if (!s.dead) return true;
      if (s.el) s.el.remove();
      return false;
    });
  }

  tickTasks() {
    for (const t of this.tasks) {
      t.age++;
      let keep = false;
      try { keep = t.tick(); } catch (e) { keep = false; }
      if (t.age > 600) keep = false;
      if (!keep) t.dead = true;
    }
    this.tasks = this.tasks.filter((t) => !t.dead);
  }

  tickBg() {
    if (this.frame <= this.bgSlideUntil) {
      this.bgOffsetX += this.bgSlideVX;
      this.bgOffsetY += this.bgSlideVY;
    } else if (this.bgSlideUntil >= 0) {
      this.bgSlideUntil = -1;
      this.bgSlideVX = 0;
      this.bgSlideVY = 0;
      this.bgOffsetX = 0;
      this.bgOffsetY = 0;
    }
    if (this.bgTarget !== null) {
      this.bgAlpha = Math.min(1, this.bgAlpha + 0.08);
    } else {
      this.bgAlpha = Math.max(0, this.bgAlpha - 0.08);
    }
    if (this.waitBg && this.bgAlpha === (this.bgTarget !== null ? 1 : 0)) this.waitBg = false;
  }

  render() {
    this.renderMons();
    if (this.bgEl) {
      const bg = this.bgTarget;
      const sliding = this.bgSlideUntil >= 0 || this.bgOffsetX !== 0 || this.bgOffsetY !== 0;
      if (bg) {
        if (typeof bg === 'string' && bg.startsWith('bg/')) {
          const url = new URL(bg, ASSET_BASE).href;
          this.bgEl.style.backgroundImage = `url("${url}")`;
          // 背景图是 GBA 240x160 画面（滚动时 256 宽可横向循环），统一 cover 缩放并锚左上，
          // 位移直接叠加，静止与滚动切换时尺寸不会跳变。
          this.bgEl.style.backgroundSize = 'cover';
          this.bgEl.style.backgroundPosition = sliding
            ? `${this.bgOffsetX * this.dirX}px ${this.bgOffsetY}px`
            : 'left top';
          this.bgEl.style.backgroundRepeat = sliding ? 'repeat' : 'no-repeat';
        } else {
          this.bgEl.style.backgroundImage = bg;
          this.bgEl.style.backgroundSize = 'auto';
          this.bgEl.style.backgroundPosition = 'center';
        }
        this.bgEl.style.opacity = String(this.bgAlpha);
      } else {
        this.bgEl.style.opacity = '0';
      }
      this.bgEl.style.transform = '';
    }
    if (this.tintEl) {
      if (this.bgTint) {
        this.tintEl.style.background = hexToRgba(this.bgTint.color, this.bgTint.alpha);
        this.tintEl.style.opacity = '1';
      } else {
        this.tintEl.style.opacity = '0';
      }
    }
    if (this.E.stage) {
      this.E.stage.style.filter = this.invert ? `invert(${this.invert})` : '';
    }
    if (this.shakeEl) {
      this.shakeEl.style.transform = this.shakeX ? `translateX(${this.shakeX.toFixed(1)}px)` : '';
    }
    if (this.surfEl) {
      if (this.surfAlpha > 0) {
        this.surfEl.style.opacity = String(this.surfAlpha);
        this.surfEl.style.backgroundPosition = `${this.surfX}px ${this.surfY}px`;
        this.surfEl.style.setProperty('--surf-top', `${this.surfTop.toFixed(1)}%`);
        this.surfEl.style.setProperty('--surf-bottom', `${this.surfBottom.toFixed(1)}%`);
      } else {
        this.surfEl.style.opacity = '0';
      }
    }
    if (this.fxEl) {
      this.fxEl.style.background = this.flash ? `rgba(255,255,255,${this.flash})` : 'transparent';
      this.fxEl.classList.toggle('pe-spotlight', !!this.spotlight);
    }
    if (this.weatherEl) {
      const cls = 'pe-weather' + (this.weather ? ' pe-' + this.weather : '');
      if (this.weatherEl.className !== cls) this.weatherEl.className = cls;
      if (this.weather !== this.builtWeather) {
        this.weatherEl.innerHTML = '';
        const build = { hail: buildHailWeather, rain: buildRainWeather, sand: buildSandWeather }[this.weather];
        if (build) build(this.weatherEl);
        this.builtWeather = this.weather;
      }
    }
    for (const s of this.sprites) {
      if (!s.el) continue;
      const p = this.E.stagePoint(s.gx + s.x2, s.gy + s.y2 * this.dirY);
      const ax = s.aff ? s.aff.sx / 256 : 1;
      const ay = s.aff ? s.aff.sy / 256 : 1;
      s.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${(s.sx * ax * SPR_SCALE).toFixed(3)}, ${(s.sy * ay * SPR_SCALE).toFixed(3)}) rotate(${(s.rot + (s.aff ? s.aff.rot / 182.044 : 0)).toFixed(2)}deg)`;
      s.el.style.opacity = String(s.visible ? s.alpha * (s.tmpl.ob ? this.objAlpha : 1) : 0);
      const fw = s.tmpl.fw || 8;
      const fh = s.tmpl.fh || 8;
      if (s.el.style.width !== fw + 'px') s.el.style.width = fw + 'px';
      if (s.el.style.height !== fh + 'px') s.el.style.height = fh + 'px';
      const frame = s.anim ? s.anim.frame : 0;
      s.el.style.backgroundPosition = `0 -${frame * fh}px`;
      s.el.style.backgroundSize = `${fw}px ${fh * (s.tmpl.frames || 1)}px`;
    }
  }

  stopSelf() {
    if (!this.alive) return;
    this.alive = false;
    this.destroy();
    if (this.done) this.done();
  }

  destroy() {
    this.alive = false;
    for (const side of ['bp', 'be']) {
      const img = side === 'bp' ? this.E.atkImg : this.E.tgtImg;
      if (!img) continue;
      img.style.removeProperty('transform');
      img.style.removeProperty('transform-origin');
      img.style.removeProperty('filter');
      img.style.removeProperty('opacity');
      if (side === 'bp' && this.E.atkFlip) this.E.atkFlip.style.removeProperty('transform');
    }
    if (this.root) this.root.remove();
    if (this.bgEl) this.bgEl.remove();
    if (this.surfEl) this.surfEl.remove();
    if (this.tintEl) this.tintEl.remove();
    if (this.E.stage) {
      this.E.stage.style.removeProperty('transform');
      this.E.stage.style.removeProperty('filter');
    }
    if (this.shakeEl) this.shakeEl.style.removeProperty('transform');
    if (ACTIVE_STATUS_SIDE === this.statusSide) ACTIVE_STATUS_SIDE = null;
    this.root = null;
    this.bgEl = null;
    this.tintEl = null;
    this.sprites = [];
    this.tasks = [];
  }
}

export default EmeraldFx;
