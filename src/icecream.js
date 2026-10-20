// ===== 冰激凌合成 =====
// 活动《甜蜜工坊》的订单冰激凌：蛋筒 + 叠球（每球一种口味）+ 顶层糖饰。
// 糖饰 7 种 × 口味 7 种 × 1~3 层，组合太多不预生成图集，运行时直接画到 canvas。
import { tryLoadImage } from './ui.js';

// 糖饰：直接对应素材里的 7 张图标（items/sweets/<名>.png）
export const ICE_DECOS = ['草莓糖饰', '爱心糖饰', '野莓糖饰', '幸运草糖饰', '花朵糖饰', '星星糖饰', '蝴蝶结糖饰'];

// 口味配色：按彩虹顺序摆（红→橙→黄→绿→蓝→紫），草莓顶粉当红头、巧克力是暖色那头
// 多出来的一格，落在末尾；每个色第二个值是需求文字用的深色版，浅底上也读得清
const FLAVOR_COLORS = {
  草莓: ['#f2728e', '#c8395c'],
  芒果: ['#f2a63c', '#bd6c05'],
  香蕉: ['#f2d84a', '#c9a11c'],
  抹茶: ['#8cbf52', '#568a1f'],
  蓝莓: ['#67a5ed', '#2f6bc0'],
  葡萄: ['#a06ad0', '#7a3fb0'],
  巧克力: ['#8a5230', '#6d3f24'],
};
export const ICE_FLAVORS = Object.keys(FLAVOR_COLORS).map(id => ({ id, colors: FLAVOR_COLORS[id] }));

function flavorColors(id) {
  return FLAVOR_COLORS[id] || ['#f0e0c0'];
}

// 需求文字用的口味色：取深色版，浅色口味在浅底上也能看清
export function flavorInk(id) {
  const c = FLAVOR_COLORS[id];
  return c ? (c[1] || c[0]) : '#8a6a3a';
}

// 糖饰文字色：跟着图标本身的主色走，玩家一眼能把文字和图标对上
const DECO_INK = {
  草莓糖饰: '#c9333f',
  爱心糖饰: '#dd4f79',
  野莓糖饰: '#2f6fc4',
  幸运草糖饰: '#3d8a3d',
  花朵糖饰: '#d3721a',
  星星糖饰: '#b8870e',
  蝴蝶结糖饰: '#8a4fc0',
};

export function decoInk(id) {
  return DECO_INK[id] || '#8a6a3a';
}

const OUTLINE = '#7a4a22';    // 球与蛋筒共用同一条描边，风格才统一
const CONE_FILL = '#eab55e';
const CONE_LINE = '#cf9a45';

const R = 15;          // 球半径
const STEP = 19;       // 相邻球心距（球间重叠 11px）
const CONE_H = 20;     // 蛋筒高
const CONE_TOP_W = 28;
const CONE_BOT_W = 8;
const INSET = 6;       // 最下层球陷进蛋筒的深度
const PAD_TOP = 6;     // 顶部留给糖饰的余量
const W = 34;
export const ICECREAM_W = W;

// 逻辑高度（未乘缩放），活动页排 DOM 时按这个留位；0 层 = 空筒
export function icecreamHeight(layers) {
  const n = Math.max(0, Math.min(3, layers | 0));
  if (n === 0) return PAD_TOP + CONE_H + 12;
  return PAD_TOP + CONE_H + 2 * R - INSET + (n - 1) * STEP;
}

const _icons = new Map();
function loadIcon(name) {
  const p = `./items/sweets/${name}.png`;
  if (!_icons.has(p)) {
    _icons.set(p, (async () => {
      const im = new Image();
      const ok = await tryLoadImage(im, p);
      return ok ? im : null;
    })());
  }
  return _icons.get(p);
}

// 球：底色 + 底部阴影 + 左上高光
function drawBall(g, cx, cy, colors) {
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = colors[0];
  g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  // 下缘压暗，叠球之间才有层次
  g.fillStyle = 'rgba(120,70,30,.18)';
  g.beginPath();
  g.ellipse(cx, cy + R * 0.74, R * 0.94, R * 0.5, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.beginPath();
  g.ellipse(cx - R * 0.34, cy - R * 0.42, R * 0.27, R * 0.17, -0.6, 0, Math.PI * 2);
  g.fill();
  g.restore();

  g.strokeStyle = OUTLINE;
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(cx, cy, R - 0.4, 0, Math.PI * 2);
  g.stroke();
}

function drawCone(g, cx, topY, bottomY) {
  const trace = () => {
    g.beginPath();
    g.moveTo(cx - CONE_TOP_W / 2, topY);
    g.lineTo(cx + CONE_TOP_W / 2, topY);
    g.lineTo(cx + CONE_BOT_W / 2, bottomY - 1);
    g.lineTo(cx - CONE_BOT_W / 2, bottomY - 1);
    g.closePath();
  };
  g.save();
  trace();
  g.fillStyle = CONE_FILL;
  g.fill();
  g.clip();
  g.strokeStyle = CONE_LINE;
  g.lineWidth = 1;
  for (let i = -CONE_H; i <= CONE_TOP_W + CONE_H; i += 5) {
    g.beginPath();
    g.moveTo(cx - CONE_TOP_W / 2 + i, topY);
    g.lineTo(cx - CONE_TOP_W / 2 + i - CONE_H, bottomY);
    g.stroke();
    g.beginPath();
    g.moveTo(cx + CONE_TOP_W / 2 - i, topY);
    g.lineTo(cx + CONE_TOP_W / 2 - i + CONE_H, bottomY);
    g.stroke();
  }
  g.restore();
  trace();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1.6;
  g.stroke();
}

// 把冰激凌画到 canvas 上：deco 糖饰名，flavors 口味名数组（第 0 个在最下面，空数组 = 只画蛋筒）
// 只设位图尺寸，显示尺寸交给调用方控制，避免加载期间画布突然撑大
export async function paintIcecream(canvas, deco, flavors, scale = 3) {
  const list = (flavors || []).filter(id => flavorColors(id)).slice(0, 3);
  const n = list.length;
  const H = icecreamHeight(n);
  const s = Math.max(1, Math.round(scale));
  canvas.width = W * s;
  canvas.height = H * s;

  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.scale(s, s);
  g.imageSmoothingEnabled = false;

  const cx = W / 2;
  const coneTopY = H - CONE_H;
  const baseCy = coneTopY - R + INSET;
  drawCone(g, cx, coneTopY, H);
  // 自下而上画，上面的球自然盖住下面球的上半部
  for (let i = 0; i < n; i++) drawBall(g, cx, baseCy - i * STEP, flavorColors(list[i]));

  const icon = deco ? await loadIcon(deco) : null;
  if (icon) {
    const d = 20;
    if (n === 0) {
      // 还没叠球：糖饰先落在筒口
      g.drawImage(icon, cx - d / 2, coneTopY - d + 4, d, d);
    } else {
      // 骑在最上层球顶，一半压在球上
      const topCy = baseCy - (n - 1) * STEP;
      g.drawImage(icon, cx - d / 2, topCy - R - d / 2 + 6, d, d);
    }
  }
  return canvas;
}
