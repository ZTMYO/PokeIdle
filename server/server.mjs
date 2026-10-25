// ===== 口袋挂机 · 后端服务（Node，无依赖） =====
// 功能：在线统计 /api/telemetry/*；每日事件排期 /api/events（大量出没 / 时空扭曲全服共用）；资源热更 /api/hot/*。加新功能就在下面 ROUTES 里加一条。
// 环境变量：PORT（默认 4000）/ DATA_DIR（默认 ./data）/ TELEMETRY_SALT（生产必填）/ TELEMETRY_ORIGINS（额外跨域来源）
// 数据全在一个文件里：DATA_DIR/stats.json
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
// 事件参数与客户端同源：优先读仓库里的 src/config.js（部署时把它一起放上去即可）。
// 读不到就用内置兜底值 —— 服务端不会因为目录结构不同而启动失败。
let CFG = {
  MASS_GEN_MIN: 20, MASS_GEN_MAX: 60, MASS_DURATION: 60,
  TWIST_GEN_MIN: 40, TWIST_GEN_MAX: 90, TWIST_DURATION: 30,
  REGION_CYCLE: ['关都', '城都', '丰缘', '神奥', '合众', '卡洛斯', '阿罗拉', '伽勒尔', '帕底亚'],
};
try {
  CFG = { ...CFG, ...(await import('../src/config.js')) };
} catch (_) {
  console.warn('[server] 未找到 ../src/config.js，事件参数改用内置兜底值');
}
let APP_VERSION = '';
try {
  APP_VERSION = (await import('../src/build-info.js')).APP_VERSION || '';
} catch (_) {
  console.warn('[server] 未找到 ../src/build-info.js，版本公告改用环境变量 LATEST_VERSION');
}

const { MASS_GEN_MIN, MASS_GEN_MAX, MASS_DURATION, TWIST_GEN_MIN, TWIST_GEN_MAX, TWIST_DURATION, REGION_CYCLE } = CFG;

const PORT = Number(process.env.PORT || 4000);
const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const SALT = process.env.TELEMETRY_SALT || '';
const ONLINE_TTL = 150000;  // 150 秒没心跳就不算在线
const MIN_BEATS = 2;        // 两次心跳才算在线：随机刷 id 只能骗到一瞬
const RATE_MS = 10000;      // 单 IP 最快 10 秒一次（客户端节奏 60 秒）
const RATE_BURST = 6;
const MAX_BODY = 128;
const MAX_SEEN = 5000;      // 同时跟踪的安装标识上限
const MAX_RATE = 20000;     // 限流表上限
const MAX_TRACKED = 100000; // 每日/累计标识上限
const MAX_INFLIGHT = 256;   // 同时处理的请求上限
const MAX_HOT_INFLIGHT = 64;      // 同时在传的热更文件
const MAX_HOT_PER_IP = 8;         // 单个 IP 同时在传的热更文件（客户端自己 4 并发）
// 资源热更：客户端要的文件都放 DATA_DIR/hot/ 下（按原相对路径摆），manifest.json 是清单。
// 路径用查询参数传（路由是精确匹配，不改成前缀匹配，免得动到别的路由）
const HOT_DIR = path.join(DATA_DIR, 'hot');
const HOT_MIME = {
  '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};
let hotInflight = 0;
const hotByIp = new Map();
let _hotManifest = { mtime: 0, raw: null, gz: null };
function hotManifest() {
  const file = path.join(HOT_DIR, 'manifest.json');
  try {
    const st = fs.statSync(file);
    if (_hotManifest.mtime !== st.mtimeMs) {
      const raw = fs.readFileSync(file);
      _hotManifest = { mtime: st.mtimeMs, raw, gz: zlib.gzipSync(raw) };
    }
    return _hotManifest;
  } catch (_) {
    return null;
  }
}
function hotBegin(ip) {
  if (hotInflight >= MAX_HOT_INFLIGHT || (hotByIp.get(ip) || 0) >= MAX_HOT_PER_IP) return false;
  hotInflight++;
  hotByIp.set(ip, (hotByIp.get(ip) || 0) + 1);
  return true;
}
function hotEnd(ip) {
  hotInflight = Math.max(0, hotInflight - 1);
  const n = (hotByIp.get(ip) || 1) - 1;
  if (n > 0) hotByIp.set(ip, n); else hotByIp.delete(ip);
}

const ORIGINS = new Set([
  'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost',
  'capacitor://localhost', 'http://localhost', 'https://localhost',
  ...(process.env.TELEMETRY_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

if (!SALT) console.warn('[server] 未设置 TELEMETRY_SALT（仅限本地调试）');

// ---- 版本公告 ----
// 最新版本由发布时上传的 src/build-info.js 或环境变量 LATEST_VERSION 决定；
// 客户端上报的版本只用来判断"它是不是旧的"，服务端不再回写，避免被伪造版本号污染。

const PIN_VER = process.env.LATEST_VERSION || APP_VERSION;
const VER_RE = /^\d+(\.\d+){1,3}$/;
function cmpVer(a, b) { // 逐段数字比较，第三段就是补丁号
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
function latestVersion() {
  return PIN_VER || null;
}
// ---- 限时活动 ----
// 只发"开关 + 时间段 + 参数"，玩法在客户端（和全服事件同构）。
// 活动清单放 DATA_DIR/activity.json：{ "list": [ { id, from, to, payload } ] }，空数组 = 没有活动。
// 按 mtime 热读：改完存盘即生效，连重启都省了。
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
let _actList = [], _actMtime = -1;
function loadActivities() {
  try {
    const st = fs.statSync(ACTIVITY_FILE);
    if (st.mtimeMs === _actMtime) return _actList;
    _actMtime = st.mtimeMs;
    const j = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
    const list = (j && Array.isArray(j.list)) ? j.list : [];
    _actList = list.filter((a) => a && typeof a.id === 'string' && Number(a.from) > 0 && Number(a.to) > Number(a.from));
    console.log(`[server] 已载入 ${_actList.length} 个限时活动：${_actList.map((a) => a.id).join(', ') || '（无）'}｜更新历程 ${_actTimeline.length} 条`);
  } catch (_) { /* 没有这个文件 = 没有活动，正常 */ }
  return _actList;
}

function isOutdated(ver) {
  const cur = latestVersion();
  if (!cur || !VER_RE.test(ver || '')) return false;
  return cmpVer(cur, ver) > 0;
}

// ---------- 在线统计 ----------
const seen = new Map();  // hash -> { last, beats }
const rate = new Map();  // ip -> { n, ts }
// 落盘就一个文件 data/stats.json：{ days: { '2026-10-12': [哈希...] }, total: [哈希...] }
const DB_FILE = path.join(DATA_DIR, 'stats.json');
const db = { days: {}, total: [], version: null }; // version = 见过的最新版本字符串（客户端心跳带上来的）
const totalSet = new Set();
let day = dayKey();
let today = new Set();

function dayKey() { return new Date().toISOString().slice(0, 10); }
function rollDay() { // 跨天：换一天的桶（历史留在 db.days 里）
  const now = dayKey();
  if (now === day) return;
  if (today.size) db.days[day] = [...today].sort();
  day = now;
  today = new Set(db.days[day] || []);
}
// 版本记录以文件为准：手动改了 stats.json 的 version，下一次读取/落盘就会采纳，
// 既不用重启，也不会被内存里的旧值在 30 秒一次的落盘里顶掉
let _verMtime = 0;
function syncVersionFile() {
  try {
    const st = fs.statSync(DB_FILE);
    if (st.mtimeMs === _verMtime) return;
    _verMtime = st.mtimeMs;
    const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const v = j && j.version;
    if (v === null) db.version = null;                      // 显式写成 null 视为清空
    else if (typeof v === 'string') db.version = v;
    else if (v && typeof v.ver === 'string') db.version = v.ver;   // 兼容老格式 { ver, stamp }
  } catch (_) { /* 文件不存在或内容坏了：保持内存里的值 */ }
}
function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); }
  catch (_) { fs.rmSync(file, { force: true }); fs.renameSync(tmp, file); }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    syncVersionFile();
    if (today.size) db.days[day] = [...today].sort();
    const days = {};
    for (const k of Object.keys(db.days).sort()) days[k] = [...db.days[k]].sort();
    db.total = [...totalSet].sort();
    writeAtomic(DB_FILE, JSON.stringify({ days, total: db.total, version: db.version }));
  } catch (e) { console.error('[server] 落盘失败:', e.message); }
}
function load() {
  try { // 新格式
    const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (j && typeof j.days === 'object') db.days = j.days || {};
    if (Array.isArray(j && j.total)) j.total.forEach((h) => totalSet.add(h));
    if (j && typeof j.version === 'string') db.version = j.version;
    else if (j && j.version && typeof j.version.ver === 'string') db.version = j.version.ver;
    today = new Set(db.days[day] || []);
    return;
  } catch (_) {}
  // 旧格式（每天一个 json + total.json）：一次性并进来，之后只用 stats.json
  try {
    const t = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'total.json'), 'utf8'));
    if (Array.isArray(t)) t.forEach((h) => totalSet.add(h));
  } catch (_) {}
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
      if (!m) continue;
      const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      if (Array.isArray(arr)) db.days[m[1]] = arr;
    }
  } catch (_) {}
  today = new Set(db.days[day] || []);
  if (Object.keys(db.days).length || totalSet.size) save();
}

// 真实客户端 IP：优先取 X-Forwarded-For 的最后一跳（$proxy_add_x_forwarded_for 会把 nginx
// 看到的真实地址追加在末尾），绝不取第一跳 —— 那是客户端可以随便伪造的；
// 没有 XFF 时才退回 X-Real-IP（nginx 若配置了覆盖写入就是真实地址）。
const ipOf = (req) => {
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  const real = String(req.headers['x-real-ip'] || '').trim();
  return real || req.socket.remoteAddress || '?';
};
const hashOf = (id) => crypto.createHash('sha256').update(SALT + id).digest('hex').slice(0, 24);
function onlineCount() {
  const cut = Date.now() - ONLINE_TTL;
  let n = 0;
  for (const v of seen.values()) if (v.beats >= MIN_BEATS && v.last >= cut) n++;
  return n;
}
// 当前正在开的事件段起点（上一场残留的事件标识不算进这一场）
function activeSlotFrom(kind, now = Date.now()) {
  const slot = (mergedSchedule(now)[kind] || []).find((s) => now >= s.from && now < s.to);
  return slot ? String(slot.from) : '';
}
// 心跳里带的事件标识：只认当前正在开的这一段
function zoneOf(raw, now = Date.now()) {
  const m = /^(mass|twist):(\d{10,})$/.exec(String(raw || ''));
  if (!m) return '';
  return activeSlotFrom(m[1], now) === m[2] ? `${m[1]}:${m[2]}` : '';
}
function presenceCounts(now = Date.now()) {
  const cut = now - ONLINE_TTL;
  const massFrom = activeSlotFrom('mass', now);
  const twistFrom = activeSlotFrom('twist', now);
  let mass = 0;
  let twist = 0;
  for (const v of seen.values()) {
    if (v.beats < MIN_BEATS || v.last < cut) continue;
    if (massFrom && v.zone === `mass:${massFrom}`) mass++;
    else if (twistFrom && v.zone === `twist:${twistFrom}`) twist++;
  }
  return { mass, twist, massFrom: massFrom || null, twistFrom: twistFrom || null };
}
function prune() {
  const cut = Date.now() - ONLINE_TTL;
  for (const [k, v] of seen) if (v.last < cut) seen.delete(k);
  const rcut = Date.now() - 60000;
  for (const [k, v] of rate) if (v.ts < rcut) rate.delete(k);
}

// ---------- 每日事件排期 ----------
// 每天一份、全服共用：同一时间所有玩家看到同一个事件；客户端拉一次后按"服务器时间"自行驱动，
// 因此改系统时间无效。位置/物种由这里定，内容细节（扭曲出什么）仍由客户端本地随机。
// 全存在 DATA_DIR/event.json（与 stats.json 同级）：{ days: { '日期': { mass, twist } } }，只留最近两天。
const EVENT_FILE = path.join(DATA_DIR, 'event.json');
const DAY_MS = 86400000;
const EVENT_KEEP_DAYS = 2;
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function dateKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 排一天：事件从 0 点后开始，按"时长 + 间隔"依次往后铺，
// 一旦结束时间超过当天 24:00 就停 —— 这样绝不会和次日排期重叠
function buildDay(dateStr, base) {
  const slots = (minGap, maxGap, durMin, extra) => {
    const out = [];
    const dur = durMin * 60000;
    let t = randInt(20, 60) * 60000;           // 当天第一个事件：0 点后留点缓冲
    for (;;) {
      if (t + dur > DAY_MS) break;
      out.push({ from: base + t, to: base + t + dur, ...extra() });
      t = t + dur + randInt(minGap, maxGap) * 60000;   // 事件结束 → 间隔 → 下一段
    }
    return out;
  };
  return {
    date: dateStr,
    // 大量出没：位置比例 + 物种种子，都和扭曲同一套（客户端按同一张路网换算，全服落在同一处）
    mass: slots(MASS_GEN_MIN, MASS_GEN_MAX, MASS_DURATION, () => ({
      pos: Math.random(),
      // 只给一个种子：客户端用"该地区野池 + 种子"取同一只，服务端不需要图鉴文件
      seed: Math.floor(Math.random() * 0x7fffffff),
    })),
    // 扭曲只给位置比例（0~1）：客户端按同一张路网换算成具体边，全服落在同一处
    twist: slots(TWIST_GEN_MIN, TWIST_GEN_MAX, TWIST_DURATION, () => ({ pos: Math.random() })),
  };
}

const eventDb = { days: {} };
function loadEvents() {
  try {
    const j = JSON.parse(fs.readFileSync(EVENT_FILE, 'utf8'));
    if (j && typeof j.days === 'object') eventDb.days = j.days || {};
  } catch (_) { /* 首次运行没有文件，正常 */ }
}
function saveEvents() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    writeAtomic(EVENT_FILE, JSON.stringify({ days: eventDb.days }));
  } catch (e) { console.warn('[server] 事件排期落盘失败', e.message); }
}

// 保证「今天 + 明天」两份都在，并只留这两天。
// 次日排期提前一整天备好：轴是水平滑动的，23 点后窗口会跨到次日，到点才生成会留一段空白。
function ensureEvents(nowMs = Date.now()) {
  const key = dateKey(nowMs);
  let changed = false;
  for (const [k, ts] of [[key, nowMs], [dateKey(nowMs + DAY_MS), nowMs + DAY_MS]]) {
    if (eventDb.days[k]) continue;
    const base = new Date(ts);
    base.setHours(0, 0, 0, 0);
    const data = buildDay(k, base.getTime());
    eventDb.days[k] = data;
    changed = true;
    console.log(`[server] 已生成 ${k} 事件排期：大量出没 ${data.mass.length} 场 / 时空扭曲 ${data.twist.length} 场`);
  }
  const keys = Object.keys(eventDb.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - EVENT_KEEP_DAYS))) {
    delete eventDb.days[k];
    changed = true;
  }
  if (changed) saveEvents();
  return eventDb.days[key] || null;
}

// 对外排期：今天 + 明天平铺成一个按开始时刻排序的列表。
// 客户端与官网都按绝对时间戳判断，拿到连续两天就等于轴滑到哪儿都有数据。
function mergedSchedule(nowMs = Date.now()) {
  const days = [eventDb.days[dateKey(nowMs)], eventDb.days[dateKey(nowMs + DAY_MS)]];
  const cat = (k) => days.flatMap((d) => d?.[k] || []).sort((a, b) => a.from - b.from);
  return { date: dateKey(nowMs), mass: cat('mass'), twist: cat('twist') };
}

// 跨天时自动换页：日期没变就直接返回，不做多余 IO
let _eventsDay = '';
function tickEvents() {
  const k = dateKey(Date.now());
  if (k === _eventsDay) return;
  _eventsDay = k;
  ensureEvents();
}

// ---------- HTTP ----------
function json(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
function allowOrigin(req) {
  const origin = req.headers.origin;
  return origin && ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {};
}
let inflight = 0;

// 路由表：加功能就往这里加一条 { method, path, handle(req, res, body) }
const ROUTES = [
  {
    method: 'POST',
    path: '/api/telemetry/ping',
    handle(req, res, body) {
      const ip = ipOf(req);
      const now = Date.now();
      if (!rate.has(ip) && rate.size >= MAX_RATE) return json(res, 429, { ok: false }, allowOrigin(req));
      const r = rate.get(ip) || { n: 0, ts: 0 };
      if (now - r.ts > RATE_MS) { r.n = 1; r.ts = now; }
      else if (++r.n > RATE_BURST) { rate.set(ip, r); return json(res, 429, { ok: false }, allowOrigin(req)); }
      rate.set(ip, r);

      // body 是 `安装标识|版本[|事件标识]`；老客户端多带的版本戳会被 zoneOf 忽略
      const [id, ver, zoneRaw] = body.trim().split('|');
      if (!/^[0-9a-f]{16,64}$/.test(id || '')) return json(res, 400, { ok: false }, allowOrigin(req));
      const h = hashOf(id);
      const zone = zoneOf(zoneRaw, now);
      const cur = seen.get(h);
      if (!cur && seen.size >= MAX_SEEN) return json(res, 503, { ok: false }, allowOrigin(req));
      if (cur) { cur.last = now; cur.beats++; cur.zone = zone; } else seen.set(h, { last: now, beats: 1, zone });
      rollDay();
      if (today.size < MAX_TRACKED) today.add(h);
      if (totalSet.size < MAX_TRACKED) totalSet.add(h);
      // 不回统计值：客户端不需要，也少一个被探测的口子；只回报版本，设置页据此提示可更新
      const latest = latestVersion();
      json(res, 200, { ok: true, update: isOutdated(ver), latest: latest || null }, allowOrigin(req));
    },
  },
  {
    method: 'GET',
    path: '/api/telemetry/stats',
    handle(req, res) {
      rollDay();
      json(res, 200, { online: onlineCount(), ...presenceCounts(), today: today.size, total: totalSet.size }, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=10', // 官网读数由这层缓存兜住
      });
    },
  },
  {
    method: 'GET',
    path: '/api/events',
    handle(req, res) {
      ensureEvents();
      const data = mergedSchedule();
      if (!data.mass.length && !data.twist.length) return json(res, 503, { ok: false });
      json(res, 200, { ...data, serverNow: Date.now() }, {
        'Access-Control-Allow-Origin': '*',      // 公开只读数据，官网/客户端都能取
        'Cache-Control': 'public, max-age=60',   // 客户端自己会缓存整天，这层只防连点
      });
    },
  },
  {
    method: 'GET',
    path: '/api/activity',
    handle(req, res) {
      json(res, 200, { list: loadActivities(), serverNow: Date.now() }, {
        'Access-Control-Allow-Origin': '*',      // 公开只读数据，官网/客户端都能取
        'Cache-Control': 'public, max-age=60',
      });
    },
  },
  {
    method: 'GET',
    path: '/healthz',
    handle(req, res) {
      json(res, 200, { ok: true, online: onlineCount(), ...presenceCounts(), today: today.size, total: totalSet.size, latest: latestVersion() }, { 'Cache-Control': 'no-store' });
    },
  },
  {
    method: 'GET',
    path: '/api/hot/manifest.json',
    handle(req, res) {
      const m = hotManifest();
      if (!m) return json(res, 404, { ok: false });
      // no-store：清单绝不能被中间层缓存（否则刚推的更新会被缓存里的旧清单/旧 404 挡住）
      const head = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Vary': 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff' };
      if (/gzip/.test(req.headers['accept-encoding'] || '')) {
        res.writeHead(200, { ...head, 'Content-Encoding': 'gzip' });
        return res.end(m.gz);
      }
      res.writeHead(200, head);
      res.end(m.raw);
    },
  },
  {
    method: 'GET',
    path: '/api/hot/file',
    handle(req, res) {
      const q = (req.url || '').split('?')[1] || '';
      let rel = '';
      try { rel = decodeURIComponent(new URLSearchParams(q).get('p') || '').replace(/^\/+/, ''); } catch (_) { return json(res, 400, { ok: false }); }
      if (!rel || rel.includes('..') || rel.startsWith('.')) return json(res, 400, { ok: false });
      const file = path.join(HOT_DIR, rel);
      if (file !== HOT_DIR && !file.startsWith(HOT_DIR + path.sep)) return json(res, 400, { ok: false });
      const ip = ipOf(req);
      if (!hotBegin(ip)) return json(res, 429, { ok: false }, { 'Retry-After': '5' });
      let done = false;
      const finish = () => { if (done) return; done = true; hotEnd(ip); };
      res.on('close', finish);
      let st;
      try { st = fs.statSync(file); } catch (_) { finish(); return json(res, 404, { ok: false }); }
      if (!st.isFile()) { finish(); return json(res, 404, { ok: false }); }
      // 绝不加 max-age：中间层（nginx/CDN）一缓存就会出现"刚传的新文件被读成旧版，
      // 客户端哈希校验不过→反复弹更新"。客户端自己会把文件存进 CacheStorage，不需要 HTTP 缓存。
      res.writeHead(200, {
        'Content-Type': HOT_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      const stream = fs.createReadStream(file);
      res.on('close', () => stream.destroy());
      stream.on('error', () => { try { res.destroy(); } catch (_) {} });
      stream.pipe(res);
    },
  },
];

const server = http.createServer((req, res) => {
  if (inflight >= MAX_INFLIGHT) return json(res, 503, { ok: false }, { 'Retry-After': '1' });
  inflight++;
  res.on('close', () => { inflight = Math.max(0, inflight - 1); });
  const method = req.method || 'GET';
  // 末尾斜杠归一化：反代（nginx）常把 /api/events 301 成 /api/events/，两边都要能命中路由
  const url = ((req.url || '').split('?')[0].replace(/\/+$/, '')) || '/';

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204, allowOrigin(req));
    res.end();
    return;
  }

  const route = ROUTES.find((r) => r.method === method && r.path === url);
  if (!route) return json(res, 404, { ok: false });

  if (method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > MAX_BODY) req.destroy(); });
    req.on('end', () => route.handle(req, res, body));
    return;
  }
  route.handle(req, res, '');
});
server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;
server.maxConnections = 512;
server.maxHeadersCount = 100;
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});
load(); // 读回已有统计，否则每次重启都会从零覆盖 stats.json
server.listen(PORT, '127.0.0.1', () => console.log(`[server] 127.0.0.1:${PORT}`));

loadEvents(); // 先读回已有排期（重启不能换掉当天已发的排期）
tickEvents(); // 没有今天的那份就现建（DATA_DIR 不存在会一并创建）
setInterval(() => { prune(); rollDay(); tickEvents(); }, 30000);
setInterval(save, 30000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { save(); process.exit(0); });
