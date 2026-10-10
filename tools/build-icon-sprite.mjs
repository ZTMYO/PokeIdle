// 把 src/pokemon-data/icon/ 下全部宝可梦图标拼成一张雪碧图，供官网用。
// 图标尺寸各不相同，一律按原始像素贴、四周留 1px 透明边，位置写进 json 让页面自己缩放。
// 用法：node tools/build-icon-sprite.mjs
// 产出：web/public/pokeicons.png（图集）+ web/public/pokeicons.json（index → [x, y, w, h]）
// 自检：写完重新解码图集，逐像素与源文件比对，有一处不一致就以退出码 1 结束
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = join(root, 'src', 'pokemon-data', 'icon');
const OUT_PNG = join(root, 'web', 'public', 'pokeicons.png');
const OUT_JSON = join(root, 'web', 'public', 'pokeicons.json');
const PAD = 1;                    // 每个图标四周的透明边
const CANDIDATE_W = [2048, 4096]; // 图集宽度候选（放不下就换更宽的）

// ---------- PNG 解码（8 位非隔行：RGBA / 调色板 / RGB / 灰度）----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let p = 8, w = 0, h = 0, depth = 0, colorType = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`只支持 8 位非隔行（当前 depth=${depth} interlace=${interlace}）`);
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!bpp) throw new Error(`不支持的颜色类型 ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (colorType === 6) { r = px[i * 4]; g = px[i * 4 + 1]; b = px[i * 4 + 2]; a = px[i * 4 + 3]; }
    else if (colorType === 3) { const q = px[i]; r = palette[q * 3]; g = palette[q * 3 + 1]; b = palette[q * 3 + 2]; a = trns && q < trns.length ? trns[q] : 255; }
    else if (colorType === 2) { r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2]; }
    else if (colorType === 0) r = g = b = px[i];
    else { r = g = b = px[i * 2]; a = px[i * 2 + 1]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, rgba };
}

// ---------- PNG 编码（RGBA，filter 0）----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 位 RGBA
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 清单：index → 图标文件 ----------
const dex = JSON.parse(readFileSync(join(root, 'src', 'pokemon-data', 'pokedex.json'), 'utf8'));
const items = dex.map((p) => ({ key: String(p.index), file: join(root, 'src', p.icon) }));
items.push({ key: 'unknown', file: join(ICON_DIR, 'unknown.png') });

const cache = new Map();
const load = (file) => {
  if (!cache.has(file)) cache.set(file, decodePng(readFileSync(file)));
  return cache.get(file);
};

// ---------- 装箱：按高度降序的货架式排布 ----------
function pack(width) {
  const sorted = items.map((it) => ({ ...it, img: load(it.file) }))
    .sort((a, b) => b.img.h - a.img.h || a.key.localeCompare(b.key));
  const placed = [];
  let x = PAD, y = PAD, shelf = 0;
  for (const it of sorted) {
    const cw = it.img.w + PAD * 2, ch = it.img.h + PAD * 2;
    if (x + cw > width) { x = PAD; y += shelf; shelf = 0; }
    placed.push({ ...it, x: x + PAD, y: y + PAD });
    x += cw;
    if (ch > shelf) shelf = ch;
  }
  return { placed, height: y + shelf + PAD };
}

let atlas = null;
for (const width of CANDIDATE_W) {
  const r = pack(width);
  if (r.height <= 8192) { atlas = { ...r, width }; break; }
}
if (!atlas) throw new Error('图集放不下');

// ---------- 贴图 ----------
const { width, height, placed } = atlas;
const canvas = Buffer.alloc(width * height * 4);
for (const it of placed) {
  const { img, x, y } = it;
  for (let row = 0; row < img.h; row++) {
    img.rgba.copy(canvas, ((y + row) * width + x) * 4, row * img.w * 4, (row + 1) * img.w * 4);
  }
}
const png = encodePng(width, height, canvas);
writeFileSync(OUT_PNG, png);

const icons = {};
for (const it of placed.sort((a, b) => a.key.localeCompare(b.key))) icons[it.key] = [it.x, it.y, it.img.w, it.img.h];
writeFileSync(OUT_JSON, `${JSON.stringify({ w: width, h: height, count: placed.length, icons }, null, 1)}\n`);

// ---------- 自检：重新解码写出的图集，逐像素与源文件比对 ----------
const back = decodePng(readFileSync(OUT_PNG));
let bad = 0, checked = 0;
for (const it of placed) {
  const { img, x, y } = it;
  for (let row = 0; row < img.h && bad < 5; row++) {
    const a = back.rgba.subarray(((y + row) * back.w + x) * 4, ((y + row) * back.w + x + img.w) * 4);
    const b = img.rgba.subarray(row * img.w * 4, (row + 1) * img.w * 4);
    if (!a.equals(b)) { bad++; console.error(`像素不一致：${it.key} 第 ${row} 行`); break; }
  }
  checked++;
}
const used = placed.reduce((s, it) => s + (it.img.w + PAD * 2) * (it.img.h + PAD * 2), 0);
console.log(`图集 ${width}×${height}（利用率 ${(used / (width * height) * 100).toFixed(1)}%）｜图标 ${placed.length} 个｜PNG ${(statSync(OUT_PNG).size / 1048576).toFixed(2)} MB`);
console.log(`写好 ${OUT_PNG}\n写好 ${OUT_JSON}`);
console.log(bad ? `✗ 校验失败：${bad} 个图标像素不一致` : `✓ 逐像素校验通过（${checked} 个图标与原图完全一致）`);
process.exit(bad ? 1 : 0);
