// 每日抽奖排期工具：本地后端提供游戏里的道具/宝可梦数据与图标，页面生成的 JSON 直接下载。
// 启动：npm run lottery-maker（默认 http://127.0.0.1:4610）
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.LOTTERY_PORT) || 4610;
const HOST = '127.0.0.1';
const HTML_FILE = join(ROOT, 'tools', 'lottery-maker.html');
const ICON_DIR = join(ROOT, 'src', 'pokemon-data', 'icon');
const ITEM_DIR = join(ROOT, 'src', 'items');

const CFG = await import(pathToFileURL(join(ROOT, 'src', 'config.js')).href);
const DEX = JSON.parse(readFileSync(join(ROOT, 'src', 'pokemon-data', 'pokedex.json'), 'utf8'));
const EVO = JSON.parse(readFileSync(join(ROOT, 'src', 'pokemon-data', 'evolution.json'), 'utf8'));

function readItemIcons() {
  const src = readFileSync(join(ROOT, 'src', 'items.js'), 'utf8');
  const m = src.match(/export const ITEM_ICONS = (\{[\s\S]*?\n\});/);
  if (!m) return {};
  try { return new Function(`return (${m[1]});`)(); } catch (_) { return {}; }
}
const ITEM_ICONS = readItemIcons();
const STONE_ICONS = (EVO && EVO.stoneIcons) || {};

function itemIcon(key) {
  const rel = ITEM_ICONS[key];
  if (rel && existsSync(join(ITEM_DIR, rel))) return '/items/' + encodeURI(rel);
  const stone = STONE_ICONS[key];
  if (stone && existsSync(join(ITEM_DIR, 'evo', 'stones', stone + '.png'))) {
    return '/items/evo/stones/' + encodeURI(stone + '.png');
  }
  return '/items/goods/mystery-egg.png';
}

const items = [];
const itemSeen = new Set();
function addItem(key, name) {
  if (!key || itemSeen.has(key)) return;
  itemSeen.add(key);
  const stone = key.includes('进化石') || key.endsWith('石');
  items.push({ key, name: name || key, icon: itemIcon(key), group: stone ? 'stone' : 'item' });
}
for (const [key, name] of Object.entries(CFG.ITEM_NAMES || {})) addItem(key, name);
for (const key of Object.keys(STONE_ICONS)) addItem(key, key);
for (const key of Object.keys(ITEM_ICONS)) addItem(key, CFG.ITEM_NAMES[key] || key);
items.sort((a, b) => {
  if (a.group !== b.group) return a.group === 'stone' ? -1 : 1;
  return a.name.localeCompare(b.name, 'zh-CN');
});

const pokemon = DEX.map((p) => {
  const base = String(p.icon || '').split('/').pop();
  return {
    index: String(p.index || ''),
    name: String(p.name || ''),
    form: String(p.form || ''),
    icon: base && existsSync(join(ICON_DIR, base)) ? '/icons/' + encodeURIComponent(base) : '',
    pinyin: String(p.pinyin || ''),
    initials: String(p.pinyinInitials || ''),
  };
}).filter((p) => /^\d{1,4}(-\d+)?$/.test(p.index));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendFile(res, file) {
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not-file');
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=600',
    });
    res.end(readFileSync(file));
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

function safeFile(baseDir, rel) {
  const p = resolve(baseDir, decodeURIComponent(rel));
  return p === baseDir || p.startsWith(baseDir + sep) ? p : null;
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || HOST}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return sendFile(res, HTML_FILE);
  }
  if (req.method === 'GET' && pathname.startsWith('/icons/')) {
    const file = safeFile(ICON_DIR, pathname.slice('/icons/'.length));
    return file ? sendFile(res, file) : sendJson(res, 403, { ok: false });
  }
  if (req.method === 'GET' && pathname.startsWith('/items/')) {
    const file = safeFile(ITEM_DIR, pathname.slice('/items/'.length));
    return file ? sendFile(res, file) : sendJson(res, 403, { ok: false });
  }
  if (req.method === 'GET' && pathname === '/api/meta') {
    return sendJson(res, 200, {
      ok: true,
      items,
      pokemon,
      lotteryPrizes: Array.isArray(CFG.LOTTERY_PRIZES) ? CFG.LOTTERY_PRIZES : [],
      prizeQty: CFG.LOTTERY_PRIZE_QTY && typeof CFG.LOTTERY_PRIZE_QTY === 'object' ? CFG.LOTTERY_PRIZE_QTY : {},
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[lottery-maker] 请求处理失败', e);
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('server error');
    } catch (_) {}
  });
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log(`[lottery-maker] 排期工具：${url}`);
  console.log('[lottery-maker] 页面里的「下载 JSON」会生成 lottery-schedule.json，手动传到服务器 DATA_DIR 即可');
  if (!process.argv.includes('--no-open')) {
    const cmd = process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[lottery-maker] 端口 ${PORT} 已被占用，可用 LOTTERY_PORT=另一个端口 npm run lottery-maker`);
  } else {
    console.error('[lottery-maker] 启动失败：', e.message);
  }
  process.exit(1);
});
