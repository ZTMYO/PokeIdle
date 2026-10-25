// ===== 资源热更（客户端） =====
// 进游戏时静默比对一次服务器清单：有差异就在手机页右上角闪「可更新」，点它才弹对话框。
// 取消只关掉，下次还能再点；更新则就地显示进度，把差异文件下载进本地缓存（CacheStorage），
// 下完自动重启游戏，重启后由 sw.js 优先返回这些新文件，等于"更新完再进游戏"。
// 没有 Service Worker 的环境（老 WebView / file://）静默跳过，游戏照常跑。
//
// 服务器侧接口：GET /api/hot/manifest.json、GET /api/hot/file?p=<相对路径>
// 开发调试：localStorage.pokeidle_hot_on = '1' 打开（dev 构建默认关），
//          localStorage.pokeidle_hot_base 换成本地源（见 tools/pokeidledeploy.config.json 里的 apiBase）
import { DEV } from './build-info.js';

const HOT_BASE = 'https://pokeidle.shiliu.space/api/hot';
const SITE = 'https://pokeidle.shiliu.space';
const CACHE = 'pokeidle-hot';
const MANIFEST_KEY = '/__hot__.json';   // 缓存里存"已应用"的 { gen, files: { 相对路径: hash } }
const META_KEY = 'pokeidle_hot_v1';     // 资源状态记录：{ app, gen, at, applied, added }，设置页显示"资源 月-日 时:分 · N 个文件"
const CONCURRENCY = 4;
// 这几个永远用包里的：SW 不能被自己替换；res-manifest.json 是基线；build-info.js 里是版本号和
// DEV 开关——被热更成 DEV=true 的一版就会关掉热更、把客户端锁死在开发态（自己清不掉）
const SKIP = new Set(['res-manifest.json', 'sw.js', 'build-info.js']);

let _busy = false;       // 正在下载/应用，防重入
let _checking = false;   // 进游戏时那次静默比对

// 轻提示：复用全局提示条，1.6 秒自动收；动态引入避免和 ui.js 成环
function toast(msg) {
  import('./ui.js').then((m) => {
    m.showConfirmBar(msg, null, null, { noButtons: true });
    const bar = document.getElementById('confirmBar');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { if (document.getElementById('confirmBar') === bar) m.hideConfirmBar(); }, 1600);
  }).catch(() => {});
}

// ready 可能永远不兑现（注册被顶掉 / SW 装不上），给它一个上限
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('超时')), ms))]);
}

function hotBase() {
  try { return localStorage.getItem('pokeidle_hot_base') || HOT_BASE; } catch (_) { return HOT_BASE; }
}
function enabled() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (!/^https?:$/.test(location.protocol)) return false;
  if (!DEV) return true;
  try { return localStorage.getItem('pokeidle_hot_on') === '1'; } catch (_) { return false; }
}
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (_) {} }

async function jsonOrNull(url, ms = 8000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    return res.ok ? await res.json() : null;
  } catch (_) { return null; }
}
async function sha1Hex(buf) {
  try {
    const d = await crypto.subtle.digest('SHA-1', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch (_) { return null; }   // 环境没有 crypto.subtle：跳过校验
}
// 已应用的清单：{ gen, files: { 路径: hash } }。
// gen 是"这批文件来自服务器哪一版清单"——SW 拿它跟包内清单的 gen 比，谁新听谁的
async function readApplied(cache) {
  try {
    const res = await cache.match(MANIFEST_KEY);
    const data = res ? await res.json() : null;
    if (!data) return { gen: 0, files: {} };
    // 老格式是一张裸的 { 路径: hash }，没有 gen：当成 0（比任何包都旧），下次比对时补上或清掉
    return data.files ? { gen: Number(data.gen) || 0, files: data.files } : { gen: 0, files: data };
  } catch (_) { return { gen: 0, files: {} }; }
}
async function writeApplied(cache, gen, files) {
  await cache.put(new Request(MANIFEST_KEY),
    new Response(JSON.stringify({ gen, files }), { headers: { 'Content-Type': 'application/json' } }));
}

// 对账：缓存里的每一条都必须和"服务器当前清单"一致，否则删掉。
// 目的是让"装了新包"以包为准——旧缓存不能盖住包里的新内容（app 里已经是 500，缓存还留着热更的 450）。
async function reconcile(cache, stored, remote) {
  const keep = remote && remote.files ? remote.files : null;   // 传 null = 全清（拿不到服务器清单时按最保守处理）
  const gen = stored.gen || (keep && Number(remote.gen)) || 0; // 老缓存补个 gen，不然 SW 一直不肯用它
  let dropped = 0;
  const next = {};
  for (const [path, hash] of Object.entries(stored.files)) {
    if (keep && keep[path] && keep[path].hash === hash) { next[path] = hash; continue; }
    try { await cache.delete(new Request(`${location.origin}/${path}`)); } catch (_) {}
    dropped++;
  }
  if (dropped || gen !== stored.gen) {
    await writeApplied(cache, gen, next);
    if (dropped) try { (await navigator.serviceWorker.ready).active?.postMessage('pokeidle-hot-refresh'); } catch (_) {}
  }
  return { gen, files: next };
}

// 比对：服务器清单 vs（包里基线 + 已下过的）。返回 { ok, reason, changes }
// ok=false（离线 / 接口挂了）时角标先收起来，等下次进游戏再比
async function findChanges() {
  const bundled = await jsonOrNull('./res-manifest.json');
  if (!bundled || !bundled.files) return { ok: false, reason: '包内清单读不到' };
  const remote = await jsonOrNull(`${hotBase()}/manifest.json?t=${Date.now()}`);   // 带时间戳：绕过中间层缓存
  const cache = await caches.open(CACHE);
  // 刚装的新包比服务器上那份热更还新（包打完了、还没重新部署）：缓存里都是上一版代码，全清掉，
  // 也不提示更新——拿旧热更盖新包，玩家装完新包等于白发
  if (remote && Number(remote.gen) > 0 && Number(remote.gen) <= Number(bundled.gen)) {
    const applied = await reconcile(cache, await readApplied(cache), null);
    lsSet(META_KEY, JSON.stringify({
      app: remote.app || '', gen: remote.gen, at: Date.now(), applied: Object.keys(applied.files).length, pending: 0, stale: true,
    }));
    return { ok: true, changes: null };
  }
  const applied = await reconcile(cache, await readApplied(cache), remote && remote.files ? remote : null);
  if (!remote || !remote.files) {
    const meta = readMeta();
    if (meta) lsSet(META_KEY, JSON.stringify({ ...meta, pending: 0, stale: true }));
    return { ok: false, reason: '连不上更新服务器' };
  }
  const list = [];
  let bytes = 0;
  for (const [path, info] of Object.entries(remote.files)) {
    if (SKIP.has(path)) continue;
    const have = applied.files[path] || (bundled.files[path] && bundled.files[path].hash);
    if (have !== info.hash) { list.push([path, info]); bytes += info.size || 0; }
  }
  // 记一笔"本机资源状态"给设置页那个小圆点用：pending = 还没更上的文件数（0 = 已是最新）
  lsSet(META_KEY, JSON.stringify({
    app: remote.app || '', gen: remote.gen, at: Date.now(), applied: Object.keys(applied.files).length,
    pending: list.length, stale: false,
  }));
  return { ok: true, changes: list.length ? { gen: remote.gen, app: remote.app || '', list, bytes } : null };
}

// 读取热更记录（设置页那行的绿/红小圆点用）
function readMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (_) { return null; }
}
export function hotMeta() { return readMeta(); }

// 居中对话框（同一个 overlay 两种状态）：ask 询问 / progress 进度。样式在 styles.css 的 .hot-mask
function hotOverlay() {
  let el = document.getElementById('hotMask');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hotMask';
    el.className = 'hot-mask';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
  return el;
}
function hideOverlay() { document.getElementById('hotMask')?.remove(); }

function askUpdate(changes, onYes, onNo) {
  const el = hotOverlay();
  const mb = (changes.bytes / 1048576).toFixed(1);
  el.innerHTML = `
    <div class="hot-box">
      <div class="hot-title">发现新资源</div>
      <div class="hot-text">共 ${changes.list.length} 个文件 · ${mb} MB<br>更新完会自动重启游戏</div>
      <div class="hot-btns">
        <span class="catch-confirm-btn" data-hot="no">取消</span>
        <span class="catch-confirm-btn" data-hot="yes">更新</span>
      </div>
    </div>`;
  el.onclick = (e) => {
    const btn = e.target.closest('[data-hot]');
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.hot === 'yes') onYes(); else onNo();
  };
}

function openDownload() {
  const m = window.__POKEIDLE_MOBILE__;
  if (m && m.openExternal) {
    try { m.openExternal(SITE); return; } catch (_) {}
  }
  if (window.__TAURI__?.opener?.openUrl) {
    try { window.__TAURI__.opener.openUrl(SITE); return; } catch (_) {}
  }
  let win = null;
  try { win = window.open(SITE, '_blank'); } catch (_) {}
  if (win) return;
  try { location.href = SITE; } catch (_) {}
}

// 热更失败：文案压到一行，引导玩家去官网下载最新安装包
export function showFailure() {
  const el = hotOverlay();
  el.onclick = null;
  el.innerHTML = `
    <div class="hot-box">
      <div class="hot-title">更新失败</div>
      <div class="hot-text">请下载最新安装包更新</div>
      <div class="hot-btns">
        <span class="catch-confirm-btn" data-hot="later">稍后</span>
        <a class="catch-confirm-btn" data-hot="download" href="${SITE}" target="_blank" rel="noopener">下载最新版</a>
      </div>
    </div>`;
  el.onclick = (e) => {
    const btn = e.target.closest('[data-hot]');
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.hot !== 'download') { hideOverlay(); return; }
    const bridge = window.__POKEIDLE_MOBILE__?.openExternal || window.__TAURI__?.opener?.openUrl;
    if (!bridge) return;   // 浏览器：交给 <a> 自己开
    e.preventDefault();
    openDownload();
    hideOverlay();
  };
}

function showProgress() {
  const el = hotOverlay();
  el.onclick = null;
  el.innerHTML = '<div class="hot-box"><div class="hot-title">正在更新资源…</div>'
    + '<div class="hot-bar"><i id="hotBarFill"></i></div><div class="hot-num" id="hotNum"></div></div>';
  const set = (done, total, got, all) => {
    const fill = document.getElementById('hotBarFill');
    if (fill) fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    const num = document.getElementById('hotNum');
    if (num) num.textContent = `${done}/${total} 个文件 · ${(got / 1048576).toFixed(1)}/${(all / 1048576).toFixed(1)} MB`;
  };
  return { set };
}

// 下载差异文件：逐个校验 sha1，坏的跳过。只写缓存，清单等整批都成功后才提交，
// 避免出现"新 index.html + 旧 main.js"这种新旧混用的状态
async function download(changes, ui) {
  const cache = await caches.open(CACHE);
  const applied = await readApplied(cache);
  const queue = changes.list.slice();
  const total = changes.list.length;
  const loaded = {};
  let done = 0, got = 0;
  ui.set(0, total, 0, changes.bytes);
  const worker = async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const [path, info] = item;
      try {
        const res = await fetch(`${hotBase()}/file?p=${encodeURIComponent(path)}&v=${info.hash}`, { cache: 'no-store' });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const h = await sha1Hex(buf);
          if (!h || h === info.hash) {
            await cache.put(new Request(`${location.origin}/${path}`),
              new Response(buf, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } }));
            loaded[path] = info.hash;
            done++; got += buf.byteLength;
            ui.set(done, total, got, changes.bytes);
            continue;
          }
        }
      } catch (_) { /* 单个失败不影响别的 */ }
      ui.set(done, total, got, changes.bytes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) || 0 }, worker));
  return { cache, applied, loaded, done, total };
}

// 待更新的资源数（读那条记录）：手机页右上角据此显示「可更新」
export function hotPendingCount() {
  const meta = readMeta();
  return meta ? (meta.pending || 0) : 0;
}

// 玩家点「更新」：先落盘存档，再下载差异、重启交回 SW 提供新文件。
// 整批文件都到位才提交清单并重启；缺一个就整批作废留在旧版本，避免新旧资源混用
async function applyChanges(changes) {
  if (_busy) return;
  _busy = true;
  try {
    try { window.__saveLastChance && window.__saveLastChance(); } catch (_) {}
    const ui = showProgress();
    const { cache, applied, loaded, done, total } = await download(changes, ui);
    if (done !== total) {
      hideOverlay();
      showFailure();
      return;
    }
    Object.assign(applied.files, loaded);
    await writeApplied(cache, changes.gen || applied.gen, applied.files);
    lsSet(META_KEY, JSON.stringify({ app: changes.app || '', gen: changes.gen, at: Date.now(), applied: Object.keys(applied.files).length, pending: 0, added: done }));
    try { (await navigator.serviceWorker.ready).active?.postMessage('pokeidle-hot-refresh'); } catch (_) {}
    location.reload();
  } catch (e) {
    console.warn('[热更] 应用更新出错：', e && e.message);
    hideOverlay();
    showFailure();
  } finally {
    _busy = false;
  }
}

// 进游戏时只做一次静默的比对，不打扰玩家；有更新就在手机页右上角闪「可更新」。
// 老外壳里没有那个角标（index.html 换不掉，包里那个 sw.js 也不认根路径），这时退回自动弹框
export async function startHotUpdate() {
  if (_checking || !enabled()) return;
  _checking = true;
  try {
    await withTimeout(navigator.serviceWorker.register('./sw.js'), 10000);
    await withTimeout(navigator.serviceWorker.ready, 10000);
    const { ok, changes } = await findChanges();
    if (ok && changes) {
      if (document.getElementById('phoneUpdate')) {
        window.dispatchEvent(new CustomEvent('hot-pending'));   // 让手机页把角标亮起来，点它才弹
      } else {
        askUpdate(changes, () => applyChanges(changes), () => hideOverlay());
      }
    }
  } catch (e) {
    console.warn('[热更] 出错（忽略，游戏照常跑）：', e && e.message);
  } finally {
    _checking = false;
    window.dispatchEvent(new CustomEvent('hot-pending'));   // 比对完，让手机页刷新角标
  }
}

// 点「可更新」时调用：现算一次差异再弹对话框（玩家可以取消，下次还能再点）
export async function openHotUpdateNotice() {
  console.log('[热更] 点了可更新角标');
  if (_busy) { toast('正在更新资源…'); return; }
  if (!enabled()) { console.warn('[热更] 当前环境不支持热更'); toast('当前环境不支持热更'); return; }
  _busy = true;
  try {
    const { ok, reason, changes } = await findChanges();
    console.log('[热更] 比对结果', ok ? 'ok' : reason, changes ? `${changes.list.length} 个文件` : '无差异');
    window.dispatchEvent(new CustomEvent('hot-pending'));    // 角标按最新结果收起来
    if (!ok) { toast(`检查更新失败：${reason}`); return; }
    if (!changes) { toast('资源已是最新'); return; }
    askUpdate(changes,
      () => applyChanges(changes),
      () => hideOverlay());                                   // 取消：只关掉，角标留着下次再点
  } catch (e) {
    console.warn('[热更] 出错（忽略，游戏照常跑）：', e && e.message);
    toast('检查更新出错');
  } finally { _busy = false; }
}
