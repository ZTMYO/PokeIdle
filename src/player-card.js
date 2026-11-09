// ===== 训练家名片 =====
// 数据直接读当前存档（gameData），不弹存档选择；玩家只补昵称和名片上显示的性别。
import { gameData, allPokemon, getPokemonByIndex } from './state.js';
import { TYPE_COLORS } from './items.js';
import { REGION_CYCLE, PX_PER_METER } from './config.js';
import { tryLoadImage } from './ui.js';
import { openShareCanvas } from './share-card.js';

const W = 1200;
const H = 675;
const SCALE = 2;   // 导出分辨率倍率：2x 高清，文字更清晰
const FONT = "'Microsoft YaHei','PingFang SC','Noto Sans SC',system-ui,sans-serif";
const MONO = 'Consolas,"SFMono-Regular",monospace';
const INK = '#3B2A4A';
const MUT = '#8C7BA0';
const CREAM = '#FFFDF6';
const IV_STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const REGION_COLORS = [
  ['#D8232A', '#00A040'], ['#C9A227', '#AFB6BC'], ['#B01E2E', '#0F52BA', '#2E8B57'],
  ['#8FC1E3', '#E8A0C0'], ['#1A1A1A', '#F0F0F0'], ['#1A6FB5', '#D0121B'],
  ['#F7941E', '#2E3192'], ['#00A0E9', '#D6006E'], ['#E04A2F', '#8B4FBF'],
];

let _setupEl = null;
let _setupKey = null;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}
function fmtInt(v) {
  return num(v).toLocaleString('zh-CN');
}
function fmtPlay(sec) {
  const total = num(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
function fmtDistance(px) {
  const meters = Math.round(num(px) / PX_PER_METER);
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters} m`;
}

function buildModel({ name, gender, accentType }) {
  const stats = gameData?.stats || {};
  const pokedex = gameData?.pokedex || {};
  const dexMap = new Map(allPokemon.map(p => [String(p.index), p]));
  const roster = (gameData?.roster || []).filter(p => p && p.species && p.kind !== 'egg');
  const byId = new Map(roster.map(p => [String(p.id), p]));
  const active = Number.isInteger(gameData?.activeTeam) ? gameData.activeTeam : 0;
  const ids = gameData?.teams?.[active]?.ids || gameData?.team || [];
  let team = (Array.isArray(ids) ? ids : []).map(id => byId.get(String(id))).filter(Boolean);
  if (!team.length) {
    team = roster.slice().sort((a, b) => num(b.level) - num(a.level)).slice(0, 6);
  }
  const partner = team[0] || null;
  const partnerPoke = partner ? getPokemonByIndex(String(partner.species)) : null;

  let unique = 0;
  let shinyDex = 0;
  const legendNames = new Set();
  const shinyLegendNames = new Set();
  for (const [idx, entry] of Object.entries(pokedex)) {
    if (!entry) continue;
    const p = dexMap.get(String(idx));
    const owned = (num(entry.owned) > 0) || (num(entry.caught) > 0) || (num(entry.evolved) > 0);
    const shiny = (num(entry.shinyOwned) > 0) || (num(entry.shinyCaught) > 0) || (num(entry.shinyEvolved) > 0);
    if (owned) {
      unique++;
      if (p?.legend) legendNames.add(p.name || String(idx));
    }
    if (shiny) {
      shinyDex++;
      if (p?.legend) shinyLegendNames.add(p.name || String(idx));
    }
  }

  let shinyEggs = num(stats.totalShinyEggsHatched);
  if (!shinyEggs) {
    for (const arr of Object.values(gameData?.encounterLogs || {})) {
      if (!Array.isArray(arr)) continue;
      for (const l of arr) {
        if (l && l.shiny && (l.source === 'egg' || !l.source)) shinyEggs++;
      }
    }
  }

  let square = 0;
  let perfect = 0;
  let maxLevel = 0;
  let variant = 0;
  for (const p of roster) {
    if (p.shiny && p.squareShiny) square++;
    if (p.variant === 'rgb' || p.variant === 'polluted' || p.variant === 'rainbow') variant++;
    if (p.ivs && IV_STATS.every(k => num(p.ivs[k]) === 31)) perfect++;
    if (num(p.level) >= 100) maxLevel++;
  }

  const totalByRegion = {};
  const ownedByRegion = {};
  for (const p of allPokemon) {
    if (!p?.region) continue;
    totalByRegion[p.region] = (totalByRegion[p.region] || 0) + 1;
  }
  for (const [idx, entry] of Object.entries(pokedex)) {
    const p = dexMap.get(String(idx));
    if (!p?.region || !entry) continue;
    if ((num(entry.owned) > 0) || (num(entry.caught) > 0) || (num(entry.evolved) > 0)) {
      ownedByRegion[p.region] = (ownedByRegion[p.region] || 0) + 1;
    }
  }
  const regions = REGION_CYCLE.map(name => ({
    name,
    total: totalByRegion[name] || 0,
    owned: ownedByRegion[name] || 0,
  }));

  const avatarGender = gender === 'male' ? 'brendan' : gender === 'female' ? 'may' : (gameData?.settings?.gender === 'may' ? 'may' : 'brendan');
  const nameSymbol = gender === 'male' ? '♂' : gender === 'female' ? '♀' : '';
  const totalDex = allPokemon.length || 1493;

  return {
    name, gender, avatarGender, nameSymbol,
    accentType: accentType || (partnerPoke?.types?.[0]) || null,
    roster, team, partner, partnerPoke, regions,
    play: fmtPlay(stats.totalPlaySeconds),
    dex: `${unique}/${totalDex}`,
    catches: fmtInt(stats.totalCatches),
    shiny: fmtInt(stats.totalShinyCaught),
    eggs: fmtInt(stats.totalEggsHatched),
    walk: fmtDistance(stats.walkDistance),
    legend: fmtInt(legendNames.size),
    shinyEggs: fmtInt(shinyEggs),
    shinyLegends: fmtInt(shinyLegendNames.size),
    square: fmtInt(square),
    perfect: fmtInt(perfect),
    maxLevel: fmtInt(maxLevel),
    shinyDex: fmtInt(shinyDex),
    variant: fmtInt(variant),
    achievements: Object.values(gameData?.achievements || {}).reduce((s, v) => s + num(v), 0),
  };
}

// ---------- canvas ----------
function setFont(ctx, size, weight = 400, mono = false) {
  ctx.font = `${weight} ${size}px ${mono ? MONO : FONT}`;
}
function measure(ctx, text, size, weight = 400, mono = false) {
  setFont(ctx, size, weight, mono);
  return ctx.measureText(String(text)).width;
}
function fitSize(ctx, text, maxW, base, min, weight = 800, mono = false) {
  let size = base;
  while (size > min) {
    if (measure(ctx, text, size, weight, mono) <= maxW) break;
    size -= 1;
  }
  return size;
}
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
function fillRR(ctx, x, y, w, h, r, color) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}
function strokeRR(ctx, x, y, w, h, r, color, width = 2) {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function contrast(hex) {
  const n = parseInt(String(hex || '').replace('#', ''), 16);
  if (!Number.isFinite(n)) return '#fff';
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? '#2f4036' : '#ffffff';
}
function drawText(ctx, text, x, y, size, weight = 400, color = INK, align = 'left', mono = false) {
  setFont(ctx, size, weight, mono);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(text), x, y);
  ctx.textAlign = 'left';
}
function pill(ctx, text, x, y, h, bg, fg, size = 15, pad = 13) {
  setFont(ctx, size, 700);
  const w = Math.ceil(ctx.measureText(String(text)).width) + pad * 2;
  fillRR(ctx, x, y, w, h, h / 2, bg);
  drawText(ctx, text, x + w / 2, y + h / 2 + size * 0.35, size, 700, fg, 'center');
  return w;
}
function dots(ctx, x, y, w, h, color, alpha, step, r) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let yy = y + step / 2; yy < y + h + step; yy += step) {
    for (let xx = x + step / 2; xx < x + w + step; xx += step) {
      ctx.beginPath();
      ctx.arc(xx, yy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawAvatar(ctx, img, x, y, size) {
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x + 8, y + 8, size - 16, size - 16);
  } else {
    drawText(ctx, '?', x + size / 2, y + size / 2 + 24, 56, 800, INK, 'center');
  }
  ctx.restore();
  strokeRR(ctx, x, y, size, size, size / 2, INK, 7);
}

function drawInfoBox(ctx, x, y, w, h, label, value) {
  fillRR(ctx, x, y, w, h, 13, '#fff');
  strokeRR(ctx, x, y, w, h, 13, INK, 2.5);
  drawText(ctx, label, x + 13, y + 18, 11, 800, MUT);
  const size = fitSize(ctx, value, w - 26, 20, 11, 800);
  drawText(ctx, value, x + 13, y + 44, size, 800, INK);
}

function drawChip(ctx, x, y, w, h, label, value) {
  fillRR(ctx, x, y, w, h, 9, '#fff');
  strokeRR(ctx, x, y, w, h, 9, INK, 2);
  drawText(ctx, label, x + 10, y + h / 2 + 4, 10, 800, MUT);
  const labelW = measure(ctx, label, 10, 800);
  const size = fitSize(ctx, value, w - 28 - labelW, 13, 9, 800);
  drawText(ctx, value, x + w - 10, y + h / 2 + 4, size, 800, INK, 'right');
}

function drawRegionBlock(ctx, x, y, w, h, colors) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = colors[0];
  ctx.fillRect(x, y, w, h);
  for (let i = 1; i < colors.length; i++) {
    const bx = x + w * i / colors.length;
    ctx.beginPath();
    ctx.moveTo(bx + 5, y);
    ctx.lineTo(x + w + 2, y);
    ctx.lineTo(x + w + 2, y + h);
    ctx.lineTo(bx - 5, y + h);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
  }
  ctx.restore();
}

function drawRegionTile(ctx, x, y, w, h, item, index, accent) {
  const explored = item.owned > 0;
  const colors = REGION_COLORS[index] || [MUT, '#C9BED4'];
  const count = item.total ? `${item.owned}/${item.total}` : String(item.owned || 0);
  if (explored) {
    fillRR(ctx, x, y, w, h, 9, INK);
    ctx.save();
    roundRect(ctx, x, y, w, h, 9);
    ctx.clip();
    drawRegionBlock(ctx, x, y, 52, h, colors);
    ctx.restore();
    strokeRR(ctx, x, y, w, h, 9, INK, 2);
    drawText(ctx, item.name, x + 62, y + Math.round(h * 0.40), 13, 800, '#fff');
    drawText(ctx, count, x + 62, y + Math.round(h * 0.78), 11, 700, 'rgba(255,255,255,0.72)');
  } else {
    fillRR(ctx, x, y, w, h, 9, '#fff');
    ctx.save();
    roundRect(ctx, x, y, w, h, 9);
    ctx.clip();
    drawRegionBlock(ctx, x, y, 52, h, ['#E9E4EF', '#F5F2F8']);
    ctx.restore();
    strokeRR(ctx, x, y, w, h, 9, '#D9D2E2', 2);
    drawText(ctx, item.name, x + 62, y + Math.round(h * 0.40), 13, 800, '#B9AEC6');
    drawText(ctx, '未探索', x + 62, y + Math.round(h * 0.78), 11, 700, '#C9BED4');
  }
}

function drawPartnerPanel(ctx, model, images, accent) {
  const x = 694, y = 88, w = 462, h = 400;
  fillRR(ctx, x, y + 7, w, h, 24, INK);
  fillRR(ctx, x, y, w, h, 24, CREAM);
  ctx.save();
  roundRect(ctx, x, y, w, h, 24);
  ctx.clip();
  dots(ctx, x, y, w, h, accent, 0.48, 22, 2.4);
  ctx.restore();
  strokeRR(ctx, x, y, w, h, 24, INK, 5);

  drawText(ctx, '搭档 / PARTNER', x + 22, y + 30, 10, 800, MUT);
  const partner = model.partner;
  const poke = model.partnerPoke;
  const name = partner ? (partner.nickname || (poke ? poke.form || poke.name : `#${partner.species}`)) : '尚未编队';
  const nameSize = fitSize(ctx, name, 340, 30, 18, 800);
  drawText(ctx, name, x + 22, y + 65, nameSize, 800, INK);
  let nameW = measure(ctx, name, nameSize, 800);
  if (partner?.shiny && images.shiny) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(images.shiny, x + 22 + nameW + 5, y + 49, 20, 20);
    ctx.imageSmoothingEnabled = false;
    nameW += 26;
  }
  if (partner && (partner.gender === 'male' || partner.gender === 'female')) {
    drawText(ctx, partner.gender === 'female' ? '♀' : '♂', x + 22 + nameW + 8, y + 65, 22, 800, partner.gender === 'female' ? '#f0789f' : '#4a9ff5');
  }

  let bx = x + 22;
  const types = (poke?.types || []).slice(0, 2);
  for (const t of types) {
    const bg = TYPE_COLORS[t] || MUT;
    bx += pill(ctx, t, bx, y + 82, 27, bg, contrast(bg), 15, 11) + 7;
  }
  if (partner) {
    drawText(ctx, `Lv.${num(partner.level) || 1}`, bx + (types.length ? 1 : 0), y + 101, 14, 700, MUT, 'left', true);
  }

  const cx = x + w / 2;
  const bottom = y + h - 24;
  if (partner && poke) {
    const img = images.partner;
    if (img) {
      const target = 320;
      const scale = target / Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
      const dw = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      const dh = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, Math.round(cx - dw / 2), Math.round(bottom - dh), dw, dh);
    } else {
      drawText(ctx, '立绘加载失败', cx, bottom - 46, 14, 400, MUT, 'center');
    }
  } else {
    drawText(ctx, '当前队伍没有宝可梦', cx, y + 260, 16, 700, MUT, 'center');
  }

  const rest = model.team.slice(1, 6);
  drawText(ctx, '队伍 / TEAM', x + 22, y + h + 36, 10, 800, MUT);
  if (rest.length) {
    const size = 84, gap = 6;
    rest.forEach((entry, i) => {
      const ix = x + 6 + i * (size + gap);
      const iy = y + h + 44;
      const img = images.team[i];
      if (img) {
        const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
        const dw = Math.round(img.naturalWidth * k);
        const dh = Math.round(img.naturalHeight * k);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, Math.round(ix + (size - dw) / 2), Math.round(iy + (size - dh) / 2), dw, dh);
      }
      if (entry.shiny && images.shiny) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(images.shiny, ix + size - 14, iy - 6, 17, 17);
        ctx.imageSmoothingEnabled = false;
      }
    });
  } else {
    drawText(ctx, '暂无更多队友', x + 22, y + h + 62, 12, 400, MUT);
  }
}

function drawCard(ctx, model, images) {
  const accent = TYPE_COLORS[model.accentType] || MUT;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  dots(ctx, 0, 0, W, H, accent, 0.50, 22, 2.6);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(778, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H);
  ctx.lineTo(648, H);
  ctx.closePath();
  ctx.clip();
  const g = ctx.createLinearGradient(648, 0, W, H);
  g.addColorStop(0, accent);
  g.addColorStop(0.82, CREAM);
  ctx.fillStyle = g;
  ctx.fillRect(640, 0, W - 640, H);
  dots(ctx, 640, 0, W - 640, H, INK, 0.09, 24, 2.4);
  ctx.restore();

  // 右上角游戏 logo
  const bandFg = contrast(accent);
  const bandSoft = bandFg === '#ffffff' ? 'rgba(255,255,255,0.72)' : 'rgba(59,42,74,0.62)';
  const logo = images.app;
  const logoText = '口袋挂机';
  setFont(ctx, 18, 800);
  const logoW = ctx.measureText(logoText).width;
  if (logo) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logo, 1156 - logoW - 34, 18, 26, 26);
  }
  drawText(ctx, logoText, 1156, 34, 18, 800, bandFg, 'right');
  drawText(ctx, '#训练家名片', 1156, 53, 10, 700, bandSoft, 'right');

  drawAvatar(ctx, images.avatar, 56, 34, 180);

  const name = String(model.name || '').trim() || '训练家';
  const nameSize = fitSize(ctx, name, 340, 52, 26, 800);
  drawText(ctx, name, 254, 120, nameSize, 800, INK);
  const nameW = measure(ctx, name, nameSize, 800);
  if (model.nameSymbol) {
    drawText(ctx, model.nameSymbol, 254 + nameW + 10, 119, 25, 800, model.nameSymbol === '♀' ? '#f0789f' : '#4a9ff5');
  }

  const boxW = 178, boxGap = 8;
  drawInfoBox(ctx, 56, 224, boxW, 58, '游戏时长', model.play);
  drawInfoBox(ctx, 56 + boxW + boxGap, 224, boxW, 58, '图鉴收集', model.dex);
  drawInfoBox(ctx, 56 + (boxW + boxGap) * 2, 224, boxW, 58, '成就', `${model.achievements} 级`);

  const chips = [
    ['神兽', model.legend],
    ['闪神', model.shinyLegends],
    ['特效', model.variant],
    ['蛋闪', model.shinyEggs],
    ['闪光', model.shiny],
    ['方闪', model.square],
    ['闪光图鉴', model.shinyDex],
    ['6V', model.perfect],
    ['满级', model.maxLevel],
    ['孵蛋', model.eggs],
    ['捕获', model.catches],
    ['步行', model.walk],
  ];
  chips.forEach(([label, value], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    drawChip(ctx, 56 + col * (boxW + boxGap), 294 + row * 36, boxW, 30, label, value);
  });

  drawText(ctx, '地区图鉴 / REGIONS', 56, 460, 11, 800, MUT);
  model.regions.forEach((item, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    drawRegionTile(ctx, 56 + col * (boxW + boxGap), 472 + row * 54, boxW, 48, item, i, accent);
  });

  drawPartnerPanel(ctx, model, images, accent);
}

async function loadImage(src) {
  const img = new Image();
  try {
    const ok = await tryLoadImage(img, src);
    return ok && img.naturalWidth ? img : null;
  } catch (_) {
    return null;
  }
}

// 复用项目里的 #icon-star（闪光标记），不要用文字五角星
function loadSymbolImage(id, color) {
  return new Promise((resolve) => {
    const sym = document.getElementById(id);
    if (!sym) return resolve(null);
    const vb = sym.getAttribute('viewBox') || '0 0 1024 1024';
    const body = sym.innerHTML.replace(/currentColor/g, color);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`);
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function spritePath(poke, shiny) {
  const base = poke?.image ? `./${poke.image}` : '';
  return shiny ? base.replace(/(\.[a-z]+)$/i, '_shiny$1') : base;
}

async function loadSprite(poke, shiny) {
  if (!poke?.image) return null;
  const wanted = spritePath(poke, shiny);
  let img = wanted ? await loadImage(wanted) : null;
  if (!img && shiny) img = await loadImage(spritePath(poke, false));
  return img;
}

async function renderCard(model) {
  const partner = model.partner;
  const team = model.team.slice(1, 6);
  const [app, avatar, partnerImg, shinyMark, ...teamImgs] = await Promise.all([
    loadImage('./icons/app-icon.png'),
    loadImage(`./character/${model.avatarGender}-front.png`),
    model.partnerPoke ? loadSprite(model.partnerPoke, !!partner?.shiny) : Promise.resolve(null),
    loadSymbolImage('icon-star', '#3B2A4A'),
    ...team.map(entry => {
      const p = getPokemonByIndex(String(entry.species));
      return loadSprite(p, !!entry.shiny);
    }),
  ]);

  try { await document.fonts.ready; } catch (_) { /* 字体没就绪就用系统字体 */ }
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  drawCard(ctx, model, { app, avatar, partner: partnerImg, team: teamImgs, shiny: shinyMark });
  return canvas;
}

function closeSetup() {
  if (!_setupEl) return;
  if (_setupKey) {
    window.removeEventListener('keydown', _setupKey);
    _setupKey = null;
  }
  _setupEl.remove();
  _setupEl = null;
}

export function closePlayerCardSetupIfOpen() {
  if (!_setupEl) return false;
  closeSetup();
  return true;
}

export function openPlayerCard() {
  if (!gameData || _setupEl) return;
  let savedName = '';
  let savedGender = '';
  try {
    savedName = localStorage.getItem('pokeidle_card_name') || '';
    savedGender = localStorage.getItem('pokeidle_card_gender') || '';
  } catch (_) { /* 私密模式 */ }

  const gameGender = gameData.settings?.gender === 'may' ? 'female' : 'male';
  const defaultGender = savedGender === 'male' || savedGender === 'female' || savedGender === 'none' ? savedGender : gameGender;
  const fallbackName = defaultGender === 'female' ? '小遥' : defaultGender === 'male' ? '小悠' : '训练家';
  let chosenGender = defaultGender;

  const el = document.createElement('div');
  el.className = 'cf-modal player-card-modal';
  const typeChips = Object.keys(TYPE_COLORS).map(t =>
    `<span class="adv-chip" data-type="${t}"><span class="roster-type-dot" style="background:${TYPE_COLORS[t]}"></span>${t}</span>`).join('');
  el.innerHTML = `
    <div class="cf-modal-panel">
      <div class="cf-modal-head">
        <span>训练家名片</span>
        <button type="button" class="cf-modal-close" id="pcClose">✕</button>
      </div>
      <div class="cf-modal-body">
        <div class="player-card-field">
          <label for="pcName">昵称</label>
          <input id="pcName" maxlength="12" autocomplete="off" />
        </div>
        <div class="player-card-field">
          <label>性别</label>
          <div class="player-card-genders">
            <button type="button" class="player-card-gender" data-g="male">♂ 男</button>
            <button type="button" class="player-card-gender" data-g="female">♀ 女</button>
            <button type="button" class="player-card-gender" data-g="none">不显示</button>
          </div>
        </div>
        <div class="player-card-field">
          <label>属性配色</label>
          <div class="adv-chips" id="pcTypeChips">
            <span class="adv-chip sel" data-type="">默认</span>
            ${typeChips}
          </div>
          <div class="player-card-hint">默认使用队伍首发宝可梦的主属性来决定卡片颜色。</div>
        </div>
        <div class="player-card-error" id="pcError"></div>
        <button type="button" class="player-card-make" id="pcMake">生成名片</button>
      </div>
    </div>`;
  const host = document.querySelector('.console') || document.body;
  host.appendChild(el);
  _setupEl = el;

  const nameInput = el.querySelector('#pcName');
  const error = el.querySelector('#pcError');
  const makeBtn = el.querySelector('#pcMake');
  const closeBtn = el.querySelector('#pcClose');
  const typeChipEls = [...el.querySelectorAll('#pcTypeChips .adv-chip')];
  const genderBtns = [...el.querySelectorAll('.player-card-gender')];
  let chosenType = '';

  const paintGender = () => {
    genderBtns.forEach(btn => btn.classList.toggle('on', btn.dataset.g === chosenGender));
  };
  const paintType = () => {
    typeChipEls.forEach(c => c.classList.toggle('sel', (c.dataset.type || '') === chosenType));
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSetup();
    }
  };

  nameInput.value = savedName || fallbackName;
  paintGender();
  paintType();

  genderBtns.forEach(btn => btn.addEventListener('click', () => {
    chosenGender = btn.dataset.g;
    error.textContent = '';
    paintGender();
  }));
  typeChipEls.forEach(c => c.addEventListener('click', () => {
    chosenType = c.dataset.type || '';
    error.textContent = '';
    paintType();
  }));
  closeBtn.addEventListener('click', closeSetup);
  el.addEventListener('click', (e) => { if (e.target === el) closeSetup(); });
  _setupKey = onKey;
  window.addEventListener('keydown', onKey);

  makeBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      error.textContent = '先填一个昵称。';
      nameInput.focus();
      return;
    }
    try {
      localStorage.setItem('pokeidle_card_name', name);
      localStorage.setItem('pokeidle_card_gender', chosenGender);
    } catch (_) { /* 私密模式 */ }
    makeBtn.disabled = true;
    makeBtn.textContent = '生成中…';
    try {
      const model = buildModel({ name, gender: chosenGender, accentType: chosenType });
      const canvas = await renderCard(model);
      closeSetup();
      const safeName = name.replace(/[\\/:*?"<>|]/g, '').slice(0, 12) || '训练家';
      await openShareCanvas(canvas, `口袋挂机-${safeName}-训练家名片.png`, `${name} 的训练家名片`);
    } catch (e) {
      console.error('[训练家名片] 生成失败：', e);
      error.textContent = '生成失败，请再试一次。';
      makeBtn.disabled = false;
      makeBtn.textContent = '生成名片';
    }
  });
}
