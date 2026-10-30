// ===== 分享图 =====
// 用 canvas 直接把数据画成卡片：不截屏、不拼 SVG，没有跨域限制，手机 WebView 上也一样能出图。
// 版面照游戏屏幕来：整张青绿卡 + 一圈深绿细边，平面色块与分割线，没有渐变。
// 素材只用游戏自己的：精灵图（路径取图鉴里的 image 字段）、app 图标、内联 SVG 图标（#icon-star 等）。
import { tryLoadImage, isMobilePlatform } from './ui.js';   // 贴图走游戏自己的加载器：多通道 + 缓存，PC WebView 上才不会漏图
import { alcremieSuffix, alcremieShinySrc } from './config.js';

const W = 1080;
const H = 1080;
const L = 76;            // 卡片内内容左边界
const R = 1004;          // 卡片内内容右边界
const FONT = "'Segoe UI','Noto Sans SC',system-ui,sans-serif"; // 和游戏里同一个字体栈
const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`;

const MALE = '#4a9ff5';   // 游戏里 .g-male
const FEMALE = '#ff6b9d'; // 游戏里 .g-female

function palette() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return dark
    ? {
      card: '#12211a', edge: '#172920',
      text: '#5cb48d', weak: 'rgba(92,180,141,0.68)', line: 'rgba(92,180,141,0.3)',
      soft: 'rgba(255,255,255,0.12)', track: '#1e3a2e', check: '#1b2f26', hexFill: 'rgba(92,180,141,0.3)', brand: '#a79e89', dim: '#46886b', lv: '#4a8f70', idx: '#376a53', ivval: '#3e795f',
    }
    : {
      card: '#73c5a4', edge: '#4c8d73',
      text: '#376d56', weak: 'rgba(55,109,86,0.68)', line: 'rgba(55,109,86,0.3)',
      soft: 'rgba(255,255,255,0.45)', track: '#6bb996', check: '#6cb99a', hexFill: 'rgba(55,109,86,0.22)', brand: '#e8dcc0', dim: '#49886d', lv: '#468369', idx: '#55997d', ivval: '#4c8b70',
    };
}

// ---------- 绘制小工具 ----------
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function rect(ctx, x, y, w, h, fill, r = 0) {
  if (r) roundRect(ctx, x, y, w, h, r);
  else { ctx.beginPath(); ctx.rect(x, y, w, h); }
  ctx.fillStyle = fill;
  ctx.fill();
}

function outline(ctx, x, y, w, h, stroke, width = 2, r = 0) {
  if (r) roundRect(ctx, x, y, w, h, r);
  else { ctx.beginPath(); ctx.rect(x, y, w, h); }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function label(ctx, str, x, y, { size = 26, weight = 400, color = '#000', align = 'left', baseline = 'alphabetic' } = {}) {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

function measure(ctx, str, size, weight = 400) {
  ctx.font = font(size, weight);
  return ctx.measureText(str).width;
}

// 超长截断加省略号
function fit(ctx, str, maxW, size, weight = 400) {
  if (measure(ctx, str, size, weight) <= maxW) return str;
  let s = str;
  while (s.length > 1 && measure(ctx, s + '…', size, weight) > maxW) s = s.slice(0, -1);
  return s + '…';
}

// #rrggbb → rgba()
function tint(hex, alpha) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// 小胶囊（属性徽章 / 状态标签），和游戏里 .type-badge / .roster-status-tag 一个样
function pill(ctx, str, x, y, h, { bg, fg, size = 22, weight = 700, padX = 14 } = {}) {
  const w = measure(ctx, str, size, weight) + padX * 2;
  rect(ctx, x, y, w, h, bg, h / 2);
  label(ctx, str, x + w / 2, y + h / 2 + size * 0.36, { size, weight, color: fg, align: 'center' });
  return w;
}

// 直接复用游戏里的内联 SVG 图标（icon-star / icon-male / icon-female …），不自己造图形
const _iconCache = new Map();
function iconImage(id, color) {
  const key = `${id}|${color}`;
  if (_iconCache.has(key)) return _iconCache.get(key);
  const sym = document.getElementById(id);
  if (!sym) return Promise.resolve(null);
  const vb = sym.getAttribute('viewBox') || '0 0 24 24';
  const body = sym.innerHTML.replace(/currentColor/g, color);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="${color}">${body}</svg>`);
  const p = new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
  _iconCache.set(key, p);
  return p;
}

// 棋盘格底（详情页贴图格就是这个纹理）
function checker(ctx, x, y, w, h, cell, color) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = color;
  for (let iy = 0; iy * cell < h; iy++) {
    for (let ix = 0; ix * cell < w; ix++) {
      if ((ix + iy) % 2) continue;
      ctx.fillRect(x + ix * cell, y + iy * cell, cell, cell);
    }
  }
  ctx.restore();
}

// 借游戏自己的加载器取图（它有多条通道与缓存，直接 new Image() 塞原始路径在 PC WebView 上会失败）
async function loadImage(src) {
  if (!src) return null;
  const img = new Image();
  try {
    const ok = await tryLoadImage(img, src);
    return ok && img.naturalWidth ? img : null;
  } catch (_) { return null; }
}

// 贴图路径：优先用图鉴里的 image 字段（游戏自己就是这么取的），再补后缀；闪光图取不到就退回本体
function spritePaths(m) {
  const out = [];
  const push = (...ps) => { for (const p of ps) if (p && !out.includes(p)) out.push(p); };
  const withExt = (p) => [p, p.replace(/\.png$/i, '.gif'), p.replace(/\.gif$/i, '.png')];
  const base = m.image || `./pokemon-data/images/${m.dexNo}-${m.spriteName}.gif`;
  // 霜奶仙特殊外观：糖饰 × 口味 的组合图（没有闪光版），优先于 _shiny
  const deco = alcremieSuffix(m.variant);
  if (deco) push(...withExt(base.replace(/(\.[a-z]+)$/i, `${deco}$1`)));
  else if (m.shiny) push(...withExt(alcremieShinySrc({ form: m.spriteName }) || base.replace(/(\.[a-z]+)$/i, '_shiny$1')));
  push(...withExt(base));
  return out;
}

async function loadSprite(m) {
  for (const p of spritePaths(m)) {
    const img = await loadImage(p);
    if (img && img.width) return img;
  }
  return null;
}

// ---------- 画卡片 ----------
// 版面照游戏屏幕来：整张米绿卡 + 一圈深绿细边。自上而下：标题行（编号 + 名字 + 闪光星 + 性别 + Lv）
// → 基础信息（左立绘、右属性胶囊与三行文字）→ 一条内缩分割线 → 个体值（左雷达图右进度条）
// → 一条通到底的分割线 → 页脚（左：游戏 logo，右：日期）
async function drawCard(ctx, m) {
  const c = palette();
  const ui = c.text;
  ctx.imageSmoothingEnabled = false; // 像素素材放大不要糊

  ctx.fillStyle = c.card;
  ctx.fillRect(0, 0, W, H);
  outline(ctx, 12, 12, W - 24, H - 24, c.edge, 4, 22);

  // 标题行：编号 + 名字（全名含形态）+ 游戏自带图标 + Lv
  const dispName = m.title || m.name || '';   // 昵称上限 5 字、形态名也放得下，图上不截断
  let nx = L;
  label(ctx, dispName, nx, 106, { size: 56, weight: 700, color: ui });
  nx += measure(ctx, dispName, 56, 700) + 22;
  ctx.save();
  ctx.imageSmoothingEnabled = true;   // 矢量图标：开平滑才按目标尺寸锐利光栅化
  if (m.shiny) {
    const st = await iconImage('icon-star', ui);
    if (st) { ctx.drawImage(st, nx, 62, 46, 46); nx += 58; }
  }
  if (m.gender) {
    const gi = await iconImage(m.gender === '♀' ? 'icon-female' : 'icon-male', m.gender === '♀' ? FEMALE : MALE);
    if (gi) { ctx.drawImage(gi, nx, 68, 38, 38); nx += 50; }
  }
  ctx.restore();
  ctx.font = '700 38px monospace';
  ctx.fillStyle = c.lv;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Lv${m.level}`, nx, 106);
  ctx.font = '400 32px monospace';
  ctx.fillStyle = c.idx;
  ctx.textAlign = 'right';
  ctx.fillText(`No.${m.dexNo}`, R, 102);

  // 基础信息：左立绘格 + 右属性胶囊与三行文字
  const cellY = 150, cellS = 240;
  checker(ctx, L, cellY, cellS, cellS, 16, c.check);
  const sprite = await loadSprite(m);
  if (sprite && sprite.width) {
    const k = Math.min((cellS - 20) / sprite.width, (cellS - 20) / sprite.height, 5);
    const sw = Math.round(sprite.width * k);
    const sh = Math.round(sprite.height * k);
    const sx = Math.round(L + (cellS - sw) / 2);
    const sy = Math.round(cellY + (cellS - sh) / 2);
    // 外观变体：canvas 上挂不了 .fx-variant-* 那套 CSS，用等价的 filter 画（取值和 styles.css 对齐）。
    // RGB 的偏移量按立绘大小缩放 —— 固定 3px 放在这张大图上几乎看不出来
    ctx.save();
    if (m.variant === 'rgb') {
      const off = Math.max(3, Math.round(sw / 48));
      ctx.filter = `drop-shadow(${off}px 0 0 rgba(255, 0, 80, .65)) drop-shadow(-${off}px 0 0 rgba(0, 220, 255, .65))`;
    } else if (m.variant === 'polluted') {
      ctx.filter = 'grayscale(1) sepia(1) hue-rotate(248deg) saturate(7) brightness(.65)';
    }
    ctx.drawImage(sprite, sx, sy, sw, sh);
    ctx.restore();
  } else {
    label(ctx, '贴图没加载出来', L + cellS / 2, cellY + cellS / 2, { size: 22, color: c.weak, align: 'center' });
    label(ctx, fit(ctx, spritePaths(m)[0] || '', cellS - 12, 16), L + cellS / 2, cellY + cellS / 2 + 30, { size: 16, color: c.weak, align: 'center' });
  }
  const tx = L + cellS + 36;
  let bx = tx;
  for (const t of m.types) bx += pill(ctx, t.name, bx, cellY + 8, 46, { bg: t.color, fg: '#ffffff', size: 30, weight: 600, padX: 22 }) + 12;
  for (const t of m.tags) bx += pill(ctx, t, bx, cellY + 14, 42, { bg: c.soft, fg: ui, size: 24 }) + 10;
  const natureStr = `性格：${m.nature}`;
  label(ctx, natureStr, tx, cellY + 104, { size: 38, weight: 400, color: c.dim });
  label(ctx, `来源：${m.source}`, tx + measure(ctx, natureStr, 38) + 30, cellY + 104, { size: 38, weight: 400, color: c.dim });
  label(ctx, `获得时间：${m.obtained}`, tx, cellY + 180, { size: 38, weight: 400, color: c.dim });
  if (m.lastLog) label(ctx, fit(ctx, m.lastLog, R - tx, 38), tx, cellY + 256, { size: 38, weight: 400, color: c.dim });

  // 个体值：左雷达图（6 轴标签环绕）+ 右进度条列表（与基础信息之间一条内缩分割线）
  rect(ctx, L, 448, R - L, 2, c.line);
  label(ctx, '个体值', L, 506, { size: 38, weight: 700, color: ui });
  const ivNote = `${m.ivTotal}/186${m.crowned ? ` · 王冠 ${m.crowned}` : ''}`;
  label(ctx, ivNote, L + measure(ctx, '个体值', 38, 700) + 12, 506, { size: 38, weight: 700, color: c.ivval });

  const hexX = L + 148, hexY = 716, hexR = 122;
  const AXES = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];   // 顺时针：HP 攻击 防御 特攻 特防 速度（和游戏一致）
  const LABELS = { hp: 'HP', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };
  const at = (i, ratio) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return [hexX + Math.cos(a) * hexR * ratio, hexY + Math.sin(a) * hexR * ratio];
  };
  const ring = (ratio) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const [px, py] = at(i, ratio);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  for (const ratio of [0.34, 0.67, 1]) { ring(ratio); ctx.strokeStyle = c.line; ctx.lineWidth = 2; ctx.stroke(); }
  AXES.forEach((_, i) => {
    const [px, py] = at(i, 1);
    ctx.beginPath();
    ctx.moveTo(hexX, hexY);
    ctx.lineTo(px, py);
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  ctx.beginPath();
  AXES.forEach((k, i) => {
    const v = (m.ivs.find((x) => x.key === k) || {}).value || 0;
    const [px, py] = at(i, Math.max(v, 1) / 31);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = c.hexFill;
  ctx.fill();
  ctx.strokeStyle = ui;
  ctx.lineWidth = 3;
  ctx.stroke();
  AXES.forEach((k, i) => {
    const v = (m.ivs.find((x) => x.key === k) || {}).value || 0;
    const [px, py] = at(i, Math.max(v, 1) / 31);
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = ui;
    ctx.fill();
  });
  AXES.forEach((k, i) => {
    const [px, py] = at(i, 1.3);
    label(ctx, LABELS[k], px, py + 9, { size: 28, color: ui, align: 'center' });
  });

  const barX = L + 430, trackX = barX + 104, trackW = 300, valX = R - 4;
  m.ivs.forEach((iv, i) => {
    const ry = 579 + i * 58;
    label(ctx, iv.label, barX, ry, { size: 30, color: ui });
    rect(ctx, trackX, ry - 16, trackW, 14, c.track, 7);                            // 轨道：比卡面略深
    rect(ctx, trackX, ry - 16, Math.max(trackW * (iv.value / 31), 14), 14, ui, 7); // 填充：主题绿
    label(ctx, String(iv.value), valX, ry, { size: 30, color: ui, align: 'right' });
  });

  // 页脚：通栏分隔线（拉到卡片边框两端）+ 左侧游戏 logo + 右侧日期
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  rect(ctx, 12, 948, W - 24, 2, c.line);
  const logo = await loadImage('./icons/app-icon.png');
  if (logo) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;   // 大图缩小，这里要开平滑
    ctx.drawImage(logo, L, 969, 64, 64);
    ctx.restore();
  }
  const lx = L + (logo ? 80 : 0);
  ctx.save();
  ctx.letterSpacing = '6px';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';   // 启动画面那套 2px 硬阴影
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;
  label(ctx, '口袋挂机', lx, 1013, { size: 38, weight: 800, color: c.brand });
  ctx.restore();
  ctx.save();
  ctx.letterSpacing = '4px';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  label(ctx, 'POKEMON IDLE', lx, 1039, { size: 20, color: tint(c.brand, 0.72) });
  ctx.restore();
  ctx.font = '400 38px monospace';
  ctx.fillStyle = c.weak;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(ymd, R, 1018);
}

async function renderShareCard(model) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  try { await document.fonts.ready; } catch (_) { /* 字体没就绪就用系统字体 */ }
  await drawCard(ctx, model);
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((res, rej) => {
    try { canvas.toBlob((b) => (b ? res(b) : rej(new Error('导出失败'))), 'image/png'); }
    catch (e) { rej(e); }
  });
}

// ---------- 预览层 ----------
let _mask = null;

function closeShareCard() {
  if (!_mask) return;
  const img = _mask.querySelector('#shareImg');
  if (img && img.dataset.objUrl) URL.revokeObjectURL(img.dataset.objUrl);
  _mask.style.display = 'none';
}

// 返回键用：预览层开着就先关它，别让返回穿透到底层页面
export function isShareCardOpen() {
  return !!_mask && _mask.style.display !== 'none';
}
export function closeShareCardIfOpen() {
  if (!isShareCardOpen()) return false;
  closeShareCard();
  return true;
}

function ensureMask() {
  if (_mask) return _mask;
  const el = document.createElement('div');
  el.className = 'share-mask';
  el.innerHTML = `
    <div class="share-box">
      <img id="shareImg" alt="" />
      <div class="share-actions">
        <button class="share-btn" id="shareSend">分享</button>
        <button class="share-btn" id="shareSave" style="display:none">保存图片</button>
        <button class="share-btn" id="shareClose">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) closeShareCard(); });
  el.querySelector('#shareClose').addEventListener('click', closeShareCard);
  _mask = el;
  return el;
}

export async function openShareCard(model) {
  const el = ensureMask();
  const img = el.querySelector('#shareImg');
  if (img.dataset.objUrl) URL.revokeObjectURL(img.dataset.objUrl);
  img.removeAttribute('src');
  img.dataset.objUrl = '';
  el.style.display = '';

  let blob;
  try {
    blob = await canvasToBlob(await renderShareCard(model));
  } catch (e) {
    console.error('[分享图] 生成失败：', e.message);
    return;
  }
  const url = URL.createObjectURL(blob);
  img.dataset.objUrl = url;
  img.src = url;

  const safe = `口袋挂机-${String(model.name).replace(/[\\/:*?"<>|]/g, '')}.png`;
  const file = new File([blob], safe, { type: 'image/png' });
  const send = el.querySelector('#shareSend');
  const save = el.querySelector('#shareSave');

  const mob = window.__POKEIDLE_MOBILE__;
  const share = async () => {
    try {
      if (mob?.shareImage) {
        // 安卓端：WebView 没有 navigator.share，交给原生插件把图片以文件流分享出去
        const base64 = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(',')[1]);
          fr.readAsDataURL(blob);
        });
        await mob.shareImage(base64, safe);
      } else {
        await navigator.share({ files: [file], title: '口袋挂机', text: `${model.name} Lv${model.level}` });
      }
    } catch (e) {
      if (e && e.name !== 'AbortError') console.warn('[分享图] 分享失败：', e);
    }
  };
  if (isMobilePlatform() || (navigator.canShare && navigator.canShare({ files: [file] }))) {
    // 手机端只给「分享」：存相册、发微信都在系统分享面板里
    send.style.display = '';
    save.style.display = 'none';
    send.onclick = share;
  } else {
    send.style.display = 'none';
    save.style.display = '';
  }
  save.onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = safe;
    a.click();
  };
}
