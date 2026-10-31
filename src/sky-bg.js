// ===== 挂机页视差背景（pokeemerald 开场 scene_2）=====
// 六层：天空 / 远山 / 远景林线 / 云 / 近景林线 / 前景草叶带，横向按路面推进距离做视差。
// 素材是 8bpp 索引图，昼夜只换调色板不换图；色板按系统时间在 白天 / 黄昏 / 夜晚 之间插值，
// 日出和日落都走黄昏档。路面那一条（含主角、路上道具）用同色系半透明遮罩一起染色，
// 不然只有天空变暗、路面还是白天会割裂。
// 只在挂机页画：省电模式、设置里关掉、挂机页不在前台时一律不画。
import { $ } from './ui.js';
import { gameData } from './state.js';
import * as road from './road.js';
import { TREES_IMG, CLOUDS_IMG, TREES_MAP, GRASS_IMG, GRASS_MAP, SKY_PALETTES } from './sky-bg-data.js';

const SKY_H = 40;          // 源素材里天空条的高度
const ART_H = 112;         // 景观可见高度：天空 40 + 山 40 + 林线 16 + 林下地面 16
const FAR_Y = 80;          // 远景树线起始行
const NEAR_Y = 57;         // 近景树线起始行
const GRASS_Y = 96;        // 草叶线的顶端（从下面截会只剩刺）
const GRASS_H = 12;        // 只留草叶这一截，底边贴住路面
const RIDGE_BASE = 80;     // 山体填充到远景树线顶部
const SCALE = 1.5;         // 与路面瓦片一致（16px 源 → 24px）
const RIDGE_W = 768;       // 山脊周期（比屏幕宽，避免频繁重复）
const SPAN = 288;          // 精灵周期：256 + 一个精灵宽，等价原版 x > 255 → -32
const MAX_DPR = 2;         // 背景只喂像素画，2 倍以上纯浪费填充率
const ROAD_H = 72;         // 路面条高度（.road-layer 的 height）

// 每层相对路面推进距离的倍率：路面算 1.0，草叶带最快，林线慢一个数量级，山几乎不动
const SPEED = { ridge: [0.014, 0.008], far: 0.022, near: 0.12, grass: 0.55, cloud: [0.050, 0.036, 0.024, 0.012] };

// 一天里的相位：日出、日落都走黄昏档
const TIME_KEYS = [
  { h: 0, phase: 'night' }, { h: 5, phase: 'night' },
  { h: 6.5, phase: 'dusk' }, { h: 9, phase: 'day' },
  { h: 16, phase: 'day' }, { h: 18, phase: 'dusk' },
  { h: 20, phase: 'night' }, { h: 24, phase: 'night' },
];
// 路面遮罩：[r, g, b, alpha]，白天不盖
const TINT = { day: [0, 0, 0, 0], dusk: [255, 178, 126, 0.14], night: [20, 32, 72, 0.55] };

const CLOUD_FRAMES = [
  { x: 0, y: 0, w: 32, h: 32 },
  { x: 0, y: 32, w: 16, h: 16 },
  { x: 0, y: 40, w: 16, h: 8 },
  { x: 16, y: 40, w: 16, h: 8 },
];

let _canvas = null, _ctx = null, _tint = null, _idle = null, _stage = null;
let _w = 0, _h = 0, _dpr = 0, _artTop = 0;
let _dist = 0;             // 与路面同一套世界距离（px）
let _bands = null;         // 裁剪好的索引带（只保留可见部分）
let _ridges = null;        // 山脊高度数组（只算一次）
let _clouds = null;        // 云的初始位置/层速（只算一次）
let _art = null;           // 当前色板渲染出的图层
let _artKey = '';
let _off = null;           // 上次的开关状态（只在变化时改 display）

// ---------- 解码 ----------
const b64bytes = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const decodeRle = (def) => {
  const raw = b64bytes(def.rle);
  const px = new Uint8Array(def.w * def.h);
  let p = 0;
  for (let i = 0; i < raw.length; i += 2) {
    px.fill(raw[i + 1], p, p + raw[i]);
    p += raw[i];
  }
  return { w: def.w, h: def.h, px };
};

// u16 tilemap → 索引图；只拼 0..ART_H 这段，再往下是路面
const composeBand = (tileset, map, y0, y1) => {
  const W = map.w * 8;
  const H = y1 - y0;
  const px = new Uint8Array(W * H);
  const perRow = tileset.w / 8;
  const my0 = Math.floor(y0 / 8), my1 = Math.ceil(y1 / 8);
  for (let my = my0; my < my1; my++) {
    for (let mx = 0; mx < map.w; mx++) {
      const v = map.entries[my * map.w + mx];
      const tid = v & 0x3ff, hf = (v >> 10) & 1, vf = (v >> 11) & 1;
      const tx = (tid % perRow) * 8, ty = Math.floor(tid / perRow) * 8;
      for (let y = 0; y < 8; y++) {
        const ay = my * 8 + y;
        if (ay < y0 || ay >= y1) continue;
        for (let x = 0; x < 8; x++) {
          px[(ay - y0) * W + mx * 8 + x] =
            tileset.px[(ty + (vf ? 7 - y : y)) * tileset.w + (tx + (hf ? 7 - x : x))];
        }
      }
    }
  }
  return { w: W, h: H, px };
};

// 索引图 + 调色板 → canvas；索引 0 透明（GBA 里 BG 色 0 同样透明）
const colorize = (band, pal) => {
  const c = document.createElement('canvas');
  c.width = band.w;
  c.height = band.h;
  const g = c.getContext('2d');
  const img = g.createImageData(band.w, band.h);
  const d = img.data;
  for (let i = 0; i < band.px.length; i++) {
    const v = band.px[i];
    if (!v) continue;
    const col = pal[v] || [255, 0, 255];
    const o = i * 4;
    d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
};

// ---------- 场景生成（固定种子：同一个世界，刷新不变脸）----------
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const makeRidge = (rng, baseY, maxH, peaks) => {
  const list = [];
  for (let i = 0; i < peaks; i++) {
    list.push({ x: rng() * RIDGE_W, h: maxH * (0.45 + rng() * 0.55), w: 18 + rng() * 46 });
  }
  const ridge = new Float32Array(RIDGE_W).fill(baseY);
  for (let x = 0; x < RIDGE_W; x++) {
    let top = baseY;
    for (const p of list) {
      let d = Math.abs(x - p.x);
      d = Math.min(d, RIDGE_W - d);
      if (d < p.w) {
        const y = baseY - p.h * Math.pow(1 - d / p.w, 1.25);
        if (y < top) top = y;
      }
    }
    ridge[x] = top;
  }
  return ridge;
};

const buildScene = () => {
  const rng = mulberry32(0x5ce7e2);   // 固定种子
  _ridges = [
    { ridge: makeRidge(rng, RIDGE_BASE - 2, 20, 9), speed: SPEED.ridge[0], haze: 0 },
    { ridge: makeRidge(rng, RIDGE_BASE - 10, 28, 13), speed: SPEED.ridge[1], haze: 0.14 },
  ];
  // 远的先画：慢的一层在最后面，否则雾化的远山会把近山整片盖掉，
  // 只剩一道又浅又平的山脊线
  _ridges.sort((a, b) => a.speed - b.speed);
  _clouds = [];
  for (let i = 0; i < 10; i++) {
    const f = Math.floor(rng() * 4);
    _clouds.push({ x: rng() * SPAN, y: 24 + rng() * 22, frame: f, speed: SPEED.cloud[f] });
  }
};

// ---------- 调色板 ----------
const lerpColor = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

const lerpPal = (a, b, t) => a.map((c, i) => lerpColor(c, b[i] || c, t));

const phasePalette = (key) => ({
  name: key,
  trees: SKY_PALETTES[key].trees,
  clouds: SKY_PALETTES[key].clouds,
  grass: SKY_PALETTES[key].grass,
  tint: TINT[key],
});

// 时刻 + 是否夜间模式 → 插值后的色板。夜间模式直接锁夜晚，
// 否则路面被夜间模式降亮、天空却还停在白天，两头对不上
const paletteAt = (hours, dark) => {
  if (dark) return { ...phasePalette('night'), id: 'dark', fading: false };
  let a = TIME_KEYS[0], b = TIME_KEYS[TIME_KEYS.length - 1];
  for (let i = 0; i < TIME_KEYS.length - 1; i++) {
    if (hours >= TIME_KEYS[i].h && hours <= TIME_KEYS[i + 1].h) { a = TIME_KEYS[i]; b = TIME_KEYS[i + 1]; break; }
  }
  if (a.phase === b.phase) return { ...phasePalette(a.phase), id: a.phase, fading: false };
  const t = (hours - a.h) / (b.h - a.h);
  const pa = phasePalette(a.phase), pb = phasePalette(b.phase);
  return {
    name: t < 0.5 ? a.phase : b.phase,
    trees: lerpPal(pa.trees, pb.trees, t),
    clouds: lerpPal(pa.clouds, pb.clouds, t),
    grass: lerpPal(pa.grass, pb.grass, t),
    tint: pa.tint.map((v, i) => v + (pb.tint[i] - v) * t),
    id: `${a.phase}-${b.phase}`,
    fading: true,
  };
};

// ---------- 渲染 ----------
const buildArt = (pal) => {
  const ridges = _ridges.map((r) => {
    const c = document.createElement('canvas');
    c.width = RIDGE_W;
    c.height = RIDGE_BASE;
    const g = c.getContext('2d');
    const body = lerpColor(pal.trees[6], pal.trees[5], r.haze);
    const bodyStyle = `rgb(${body})`, hiStyle = `rgb(${pal.trees[7]})`;
    for (let x = 0; x < RIDGE_W; x++) {
      const h = Math.floor(r.ridge[x]);
      const hn = Math.floor(r.ridge[(x + 1) % RIDGE_W]);
      const band = hn < h ? 2 : 0;   // 只给受光的左坡打亮，和原素材一致
      if (band) {
        g.fillStyle = hiStyle;
        g.fillRect(x, h, 1, band);
      }
      g.fillStyle = bodyStyle;
      g.fillRect(x, h + band, 1, RIDGE_BASE - h - band);
    }
    return c;
  });
  _art = {
    sky: colorize(_bands.sky, pal.trees),
    far: colorize(_bands.far, pal.trees),
    near: colorize(_bands.near, pal.trees),
    grass: colorize(_bands.grass, pal.grass),
    clouds: colorize(_bands.clouds, pal.clouds),
    ridges,
    skyLow: pal.trees[5],   // 素材 40~80 行之间的天空底色
  };
  if (_tint) {
    const t = pal.tint;
    _tint.style.backgroundColor = `rgb(${Math.round(t[0])},${Math.round(t[1])},${Math.round(t[2])})`;
    _tint.style.opacity = String(Math.max(0, Math.min(1, t[3])));
  }
  // 深色天空下文案改用亮色，否则深绿字压在夜色里看不清
  if (_idle) _idle.classList.toggle('sky-dark-text', pal.name !== 'day');
};

const tile = (img, srcY, srcH, destY, offCss) => {
  const dw = img.width * SCALE;
  const dh = srcH * SCALE;
  let x = -(((offCss % dw) + dw) % dw);
  x = road.snapPx(x);
  for (; x < _w; x += dw) {
    _ctx.drawImage(img, 0, srcY, img.width, srcH, x, destY, dw, dh);
  }
};

const drawClouds = () => {
  for (const c of _clouds) {
    const f = CLOUD_FRAMES[c.frame];
    let x = (c.x + _dist * c.speed) % SPAN;
    if (x < 0) x += SPAN;
    x -= f.w;
    const dy = _artTop + c.y * SCALE;
    for (let k = -1; k <= 1; k++) {
      const dx = road.snapPx(x + k * SPAN);
      if (dx > _w || dx + f.w * SCALE < 0) continue;
      _ctx.drawImage(_art.clouds, f.x, f.y, f.w, f.h, dx, dy, f.w * SCALE, f.h * SCALE);
    }
  }
};

const paint = () => {
  if (!_canvas) return;
  const s = gameData?.settings;
  const off = !s || s.idleBackground !== true ||
    document.documentElement.classList.contains('power-save');
  if (off !== _off) {
    _off = off;
    _canvas.style.display = off ? 'none' : '';
    if (_tint) _tint.style.display = off ? 'none' : '';
    if (off && _idle) _idle.classList.remove('sky-dark-text');
  }
  if (off) return;
  // 不在挂机页就不画：切到图鉴/商店时别白烧一帧
  if (!_idle || _idle.style.display === 'none' || !_idle.clientWidth) return;

  // 尺寸只从舞台量（#screenInner），绝不读 canvas 自己：
  // canvas 是替换元素，只写 top/bottom 时浏览器可能按 height 属性取高，
  // 再拿 clientHeight 回写 height 就会每帧翻倍，直到把主线程拖死。
  const stage = _stage || (_stage = $('screenInner') || $('screen'));
  const stageW = stage ? stage.clientWidth : 0;
  const stageH = stage ? stage.clientHeight : 0;
  const cssW = Math.max(0, stageW | 0);
  const cssH = Math.max(0, (stageH | 0) - ROAD_H);
  if (cssW <= 0 || cssH <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  if (cssW !== _w || cssH !== _h || dpr !== _dpr) {
    _w = cssW; _h = cssH; _dpr = dpr;
    // 显式 px 顶住 CSS 盒，避免高度跟着 canvas 属性走
    _canvas.style.left = '0px';
    _canvas.style.top = '0px';
    _canvas.style.bottom = 'auto';
    _canvas.style.width = cssW + 'px';
    _canvas.style.height = cssH + 'px';
    _canvas.width = Math.round(cssW * dpr);
    _canvas.height = Math.round(cssH * dpr);
    _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _ctx.imageSmoothingEnabled = false;
  }

  // 色板 5 分钟一档，只在换档/换主题时重建（几毫秒，不会每帧都跑）
  const now = new Date();
  const bucket = Math.floor((now.getHours() * 60 + now.getMinutes()) / 5);
  // 设置里指定了时段就锁死那一档，只有「默认」才跟随系统时间
  const forced = gameData?.settings?.idleBackgroundTime;
  const pal = (forced === 'day' || forced === 'dusk' || forced === 'night')
    ? { ...phasePalette(forced), id: `fix-${forced}`, fading: false }
    : paletteAt(bucket * 5 / 60, document.documentElement.dataset.theme === 'dark');
  // 相位恒定（纯白天/纯夜晚）时不用每档重算，只有渐变段才跟着档位走
  const key = pal.fading ? `${bucket}|${pal.id}` : pal.id;
  if (key !== _artKey) {
    _artKey = key;
    buildArt(pal);
  }
  if (!_art) return;

  // 景观贴底，天空贴顶：舞台高度变化时不会把天空挤没，山也不会跟着涨
  _artTop = _h - ART_H * SCALE;
  _ctx.fillStyle = `rgb(${_art.skyLow.join(',')})`;
  _ctx.fillRect(0, 0, _w, _h);

  const farOff = _dist * SPEED.far;
  const nearOff = _dist * SPEED.near;
  const grassOff = _dist * SPEED.grass;
  const dw = RIDGE_W * SCALE;

  tile(_art.sky, 0, SKY_H, 0, farOff);
  for (let i = 0; i < _art.ridges.length; i++) {
    let x = -((((_dist * _ridges[i].speed) % dw) + dw) % dw);
    for (let xx = road.snapPx(x); xx < _w; xx += dw) {
      _ctx.drawImage(_art.ridges[i], 0, 0, RIDGE_W, RIDGE_BASE, xx, _artTop, dw, RIDGE_BASE * SCALE);
    }
  }
  tile(_art.far, 0, ART_H - FAR_Y, _artTop + FAR_Y * SCALE, farOff);
  drawClouds();
  tile(_art.near, 0, ART_H - NEAR_Y, _artTop + NEAR_Y * SCALE, nearOff);
  // 草叶带贴底（底边=路面顶），只露出草叶这一截
  tile(_art.grass, 0, GRASS_H, _h - GRASS_H * SCALE, grassOff);

};

// 背景挂在路面的渲染钩子上：这里一旦抛异常，road 的 rAF 链会断掉、整局停摆。
// 所以统一兜底：出错就永久关掉背景（本局），绝不影响游戏本体。
let _dead = false;
const die = (e) => {
  if (_dead) return;
  _dead = true;
  if (_canvas) _canvas.style.display = 'none';
  if (_tint) _tint.style.display = 'none';
  // 桌面端开不了控制台：把原因写进存档侧，设置页能看见
  try { localStorage.setItem('skybg_last_error', String(e).slice(0, 120)); } catch (_) {}
  console.warn('[sky-bg] 挂机背景已停用：', e);
};
const draw = () => {
  if (_dead) return;
  try { paint(); } catch (e) { die(e); }
};

// ---------- 生命周期 ----------
const stepWorld = (speed) => { _dist += speed; };

export function startSkyBg() {
  if (_dead) return;
  // 立即初始化（解码 + 拼图约十几毫秒）：splash 播放时背景就该在，别再延后
  initSkyBg();
}

function initSkyBg() {
  if (_dead) return;
  try {
    _idle = $('idleView');
    _tint = $('skyTint');
    _stage = $('screenInner') || $('screen');
    if (!_canvas) {
      _canvas = $('skyCanvas');
      if (!_canvas) return;
      _ctx = _canvas.getContext('2d', { alpha: false });
    }
    if (!_bands) {
      const trees = decodeRle(TREES_IMG);
      const map = { w: TREES_MAP.w, h: TREES_MAP.h, entries: new Uint16Array(TREES_MAP.w * TREES_MAP.h) };
      const raw = b64bytes(TREES_MAP.b64);
      for (let i = 0; i < map.entries.length; i++) map.entries[i] = raw[i * 2] | (raw[i * 2 + 1] << 8);
      const layerA = { w: 32, h: 32, entries: map.entries.subarray(0, 1024) };
      const layerB = { w: 32, h: 32, entries: map.entries.subarray(1024) };
      const grassTiles = decodeRle(GRASS_IMG);
      const grassMap = { w: GRASS_MAP.w, h: GRASS_MAP.h, entries: new Uint16Array(GRASS_MAP.w * GRASS_MAP.h) };
      const graw = b64bytes(GRASS_MAP.b64);
      for (let i = 0; i < grassMap.entries.length; i++) grassMap.entries[i] = graw[i * 2] | (graw[i * 2 + 1] << 8);
      _bands = {
        sky: composeBand(trees, layerA, 0, SKY_H),
        far: composeBand(trees, layerA, FAR_Y, ART_H),
        near: composeBand(trees, layerB, NEAR_Y, ART_H),
        grass: composeBand(grassTiles, grassMap, GRASS_Y, GRASS_Y + GRASS_H),
        clouds: decodeRle(CLOUDS_IMG),
      };
      buildScene();
    }
    // 路面 stop() 会清空步进/渲染钩子，所以每次启动都重挂（Set.add 幂等）
    road.addStepper(stepWorld);
    road.addRender(draw);
  } catch (e) {
    die(e);
  }
}

// 设置里打开开关时才初始化（默认关闭，启动阶段一点活都不干）
window.addEventListener('idle-bg-changed', () => { startSkyBg(); });
