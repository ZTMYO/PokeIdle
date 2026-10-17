// ===== 限时活动总线 =====
// 服务端只发"开关 + 时间段 + 参数"（GET /api/activity/），玩法写在 src/activities.js 里。
// 手机首页时钟左侧会多出一个入口按钮，活动窗口内点开进容器；到点自己消失。
// 拉不到清单（离线 / 服务器挂了）就当没有活动，主游戏完全不受影响。
import { $, showView, showConfirmBar, getCurrentView, isDualLayout } from './ui.js';
import { gameData, saveGame, addSystemLog, pushNav, popNav, rollGender } from './state.js';
import { grantItem } from './items.js';
import { ITEM_NAMES } from './config.js';
import { ACTIVITIES } from './activities.js';
import { DEV } from './build-info.js';

const ACTIVITY_ENDPOINT = 'https://pokeidle.shiliu.space/api/activity/';
const CACHE_KEY = 'pokeidle_activity_cache_v1';
const RETRY_MIN = 10;   // 轮询间隔（分钟）：正常情况下只靠回前台与到点补拉

let _list = null;       // 服务端给的清单
let _srvAt = 0;         // 对齐用的服务器时刻
let _perfAt = 0;        // 对齐时的单调时钟
let _loading = null;
let _tick = 0;
let _open = null;       // 当前打开的活动 id
let _openWin = null;    // 当前打开活动的窗口 { from, to }（开发预览时用假窗口）
let _picks = [];        // 上交槽位里选的个体 id（活动页自己的临时状态，不落盘）
let _openMod = null;    // 当前打开活动的模块（ACTIVITIES[id]）
let _bodyTimer = null;  // 容器每秒刷新

function hasSchedule() { return !!_list; }
function serverNow() {
  return _perfAt ? _srvAt + (performance.now() - _perfAt) : Date.now();
}

// 当前窗口内、且客户端认识的活动（不认识的 id 静默忽略：那是给新版本准备的）
function activeActivities(now = serverNow()) {
  if (!_list) return [];
  return _list
    .filter(a => now >= a.from && now < a.to && ACTIVITIES[a.id])
    .sort((a, b) => a.from - b.from);
}

function apply(data, srvAt, perfAt) {
  if (!data || !Array.isArray(data.list)) return false;
  _list = data.list;
  _srvAt = srvAt;
  _perfAt = perfAt;
  refreshEntry();
  return true;
}

// 拉取清单（并发请求合并）；成功后写缓存并顺带校准时间
async function loadActivities(force = false) {
  if (_loading) return _loading;
  if (!force && _list && _freshAt && Date.now() - _freshAt < RETRY_MIN * 60000 && !_expiredSoon()) return true;
  _loading = (async () => {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(`${ACTIVITY_ENDPOINT}?t=${Date.now()}`, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!apply(data, data.serverNow || Date.now(), performance.now())) throw new Error('格式不对');
      _freshAt = Date.now();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch (_) {}
      return true;
    } catch (e) {
      console.warn('[限时活动] 拉取失败，本次不显示入口：', e.name === 'AbortError' ? '超时(6s)' : e.message);
      return false;
    } finally { _loading = null; }
  })();
  return _loading;
}
let _freshAt = 0;
// 全部活动都过了结束时间（跨天/活动收摊）→ 下一次该拉新清单
function _expiredSoon() {
  if (!_list || !_list.length) return false;
  return serverNow() > Math.max(..._list.map(a => a.to));
}

// 先用缓存点亮入口（离线启动也能按已知窗口显示），随后会被最新数据覆盖
function loadActivitiesFromCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!data || typeof data.serverNow !== 'number') return false;
    const drift = Math.max(0, Date.now() - (data.savedAt || Date.now()));
    return apply(data, data.serverNow + drift, performance.now());
  } catch (_) { return false; }
}

// 开发运行专用的"预览态"：服务端还没配活动时也把入口显示出来，方便调样式。
// 发布构建 DEV=false，这段不会生效。
const DEV_PREVIEW = DEV ? (Object.keys(ACTIVITIES)[0] || null) : null;

// 开发用的"本地预览活动"：把某个活动当成正在开，用假窗口 + 可覆盖的 payload，
// 这样开发新玩法时不用去改服务器上那份真实活动。控制台：__act('poke-flip')
const DEV_KEY = 'pokeidle_activity_dev';
function devPreview() {
  if (!DEV) return null;
  try {
    const o = JSON.parse(localStorage.getItem(DEV_KEY) || 'null');
    return o && o.id && ACTIVITIES[o.id] ? o : null;
  } catch (_) { return null; }
}
// 登记 / 取消本地预览（登记时刻存下来：重载刷新不会因为窗口变了把活动存档槽重置）
export function setDevPreview(id, opts = {}) {
  if (!id) {
    localStorage.removeItem(DEV_KEY);
    console.log('[限时活动] 本地预览已取消');
  } else if (!ACTIVITIES[id]) {
    console.log(`[限时活动] 不认识这个活动：${id}；可用：${Object.keys(ACTIVITIES).join(' / ')}`);
    return null;
  } else {
    const old = devPreview();
    const keepFrom = opts.reset || old?.id !== id ? 0 : old.from;
    const o = { id, from: keepFrom || Date.now(), hours: Number(opts.hours) || 24, payload: opts.payload || {} };
    localStorage.setItem(DEV_KEY, JSON.stringify(o));
    console.log(`[限时活动] 本地预览：${id}（${o.hours} 小时，payload ${JSON.stringify(o.payload)}）${opts.reset ? '，存档槽已重置' : ''}`);
  }
  refreshEntry();
  if (_open) reopenActivity();
  return devPreview();
}
// 本地预览的假窗口：开始时刻固定，结束按 hours 顺延，免得开发到一半活动"过期"
function devWin(di) {
  const from = di.from || Date.now();
  return { from, to: Math.max(from + (di.hours || 24) * 3600e3, Date.now() + 3600e3) };
}
// 某个活动此刻是否在窗口内（不发奖励，只判断）；本地预览的那个也算
export function activityActive(id) {
  return activeActivities().some(a => a.id === id) || (devPreview() || {}).id === id;
}

// 这个 id 该用哪条记录：本地预览优先（同一个 id 也走假窗口和覆盖后的 payload）
function entryOf(id) {
  const di = devPreview();
  if (di && di.id === id) return { id, payload: di.payload || {}, dev: true };
  return (_list || []).find(x => x.id === id) || { id, payload: {} };
}

// 调试快照：控制台执行 __activity() 看当前活动状态（登记在 debug.js）
export function activityDebug() {
  const now = serverNow();
  const list = (_list || []).map(a => ({
    id: a.id,
    认识: !!ACTIVITIES[a.id],
    窗口: `${hhmmss(a.from)}~${hhmmss(a.to)}`,
    进行中: now >= a.from && now < a.to,
  }));
  return {
    拿到排期: hasSchedule(),
    活动清单: list,
    进行中: activeActivities().map(a => a.id),
    就绪: Object.keys(ACTIVITIES).map(id => ({ id, ready: readyOf(id, ACTIVITIES[id]) })),
    入口: activityEntries(),
    入口在手机上的状态: (() => {
      const el = document.querySelector('.phone-app[data-app^="act:"]');
      return el ? '亮着' : '未渲染（手机页未打开/无活动）';
    })(),
    开发预览: DEV_PREVIEW,
    本地预览: devPreview(),
  };
}
function hhmmss(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 仓库选择器回调：把选中的个体放进对应槽位，然后回到活动页
export function pickForActivity(rid, slot) {
  if (!_open || slot == null) return;
  _picks[slot] = rid;
  reopenActivity();
}

// 从选择器/小游戏返回活动页（重画一次，槽位和气球就位）；活动已下架返回 false
export function reopenActivity() {
  if (!_open) return false;
  showView('activityView');
  paintActivity();
  return true;
}

/* ---------- 手机首页的入口按钮 ---------- */
// 活动窗口：清单条目用自己的 from/to；开发预览用假窗口（一小时前开始、一天后结束），
// 一个会话内固定不变——窗口每次都变的话会把活动存档槽来回重置
let _previewWin = null;
const PREVIEW_WIN_KEY = 'pokeidle_activity_preview_v1';
// 预览窗口固定住（存进 localStorage）：否则每次启动都算"新开一次活动"，目标会跟着种子变
function previewWin() {
  if (_previewWin) return _previewWin;
  try {
    const saved = JSON.parse(localStorage.getItem(PREVIEW_WIN_KEY) || 'null');
    if (saved && saved.from > 0 && saved.to > saved.from) { _previewWin = saved; return _previewWin; }
  } catch (_) {}
  _previewWin = { from: Date.now() - 3600000, to: Date.now() + 86400000 };
  try { localStorage.setItem(PREVIEW_WIN_KEY, JSON.stringify(_previewWin)); } catch (_) {}
  return _previewWin;
}
function winOf(a, id) {
  if (a && a.dev) return devWin(devPreview() || {});
  if (a && a.from) return { from: a.from, to: a.to };
  if (id !== DEV_PREVIEW) return null;
  return previewWin();
}

// 活动可选的就绪检查：ready() 返回 false（比如拿不到排期）时入口不显示，免得点进去是个空页。
// 注意要把窗口传进去 —— ready 里要按活动窗口去排期里找那一段
function readyOf(id, mod) {
  if (!mod.ready) return true;
  const a = entryOf(id);
  const win = winOf(a, id);
  if (!win) return false;
  try { return !!mod.ready(ctxFor(a, win)); }
  catch (e) { console.error('[限时活动] ready 出错：', e); return false; }
}

// 当前能进的活动清单（可以同时开多个，桌面上就出多个图标）。
// 开发预览 / 本地预览也一并收进来，方便离线调
export function activityEntries() {
  const out = activeActivities()
    .filter((a) => readyOf(a.id, ACTIVITIES[a.id]))
    .map((a) => ({ id: a.id, name: ACTIVITIES[a.id].name || '限时活动' }));
  const di = devPreview();
  const extra = di && ACTIVITIES[di.id] ? di.id : DEV_PREVIEW;
  if (extra && ACTIVITIES[extra] && readyOf(extra, ACTIVITIES[extra]) && !out.some((e) => e.id === extra)) {
    out.unshift({ id: extra, name: ACTIVITIES[extra].name || '限时活动' });
  }
  return out;
}

// 手机首页点某个活动的图标：打开它
export function openActivityById(id) { openActivity(id); }

// 入口状态刷新：活动增删由这里感知，只在真的变了时重画手机页
let _entryKey = null;
function refreshEntry() {
  const list = activityEntries();
  const key = list.map((e) => `${e.id}|${e.name}`).join(',');
  if (key === _entryKey) return;
  _entryKey = key;
  if (!list.length && _open) closeActivity(); // 正开着却被下架/条件不满足：退回首页
  import('./phone.js').then((m) => m.refreshPhoneHome()).catch(() => {});
}

// 航海寻宝配色：活动页与悬赏页共用。双屏布局页面在下屏；
// 经典布局两屏重合，app 页在 #appScreen 里、背景靠底下 #screen 透出来，两块都要换
function voyageScreenEls() {
  const app = document.getElementById('appScreen');
  return isDualLayout() ? [app] : [app, document.getElementById('screen')];
}

function applyVoyageTheme(on) {
  const els = voyageScreenEls().filter(Boolean);
  if (!els.length || els.every((sc) => sc.classList.contains('voyage') === on)) return;
  els.forEach((sc) => sc.classList.add('no-theme-trans')); // 配色切换禁用过渡，直接跳变
  els.forEach((sc) => sc.classList.toggle('voyage', on));
  void els[0].offsetWidth;
  els.forEach((sc) => sc.classList.remove('no-theme-trans'));
}

// 只有活动页（且当前开的是航海寻宝）和悬赏页（且活动期内）才用这套配色，切到别的页面立刻收回
function syncVoyageTheme() {
  const onBounty = $('bountyView')?.style.display !== 'none';
  const onAct = $('activityView')?.style.display !== 'none';
  applyVoyageTheme((onBounty && activityActive('voyage')) || (onAct && _open === 'voyage'));
}
window.addEventListener('view-changed', syncVoyageTheme);

function openActivity(id) {
  const mod = ACTIVITIES[id];
  const view = $('activityView');
  if (!mod || !view) return;
  const a = entryOf(id);
  const known = !!(_list || []).find(x => x.id === id);
  if (!known && id !== DEV_PREVIEW && !a.dev) return;   // 清单里没有、也不是开发预览/本地预览：不打开
  if (!readyOf(id, mod)) return;          // 条件不满足（比如拿不到排期）：不打开
  _open = id;
  _openMod = mod;
  _picks = [];
  _openWin = winOf(a, id);
  if (getCurrentView() !== 'activityView') pushNav('activityView');   // 已在活动页（切活动）时别再压一层
  showView('activityView');
  paintActivity();
  if (_bodyTimer) clearInterval(_bodyTimer);
  _bodyTimer = setInterval(() => {
    const cur = (_list || []).find(x => x.id === _open);
    if (!_openWin || serverNow() >= _openWin.to) { closeActivity(); return; } // 到点：自动退回首页
    if (_open !== DEV_PREVIEW && !cur && !(devPreview() || {}).id) { closeActivity(); return; }   // 被下架：同上
    if (!readyOf(_open, _openMod)) { closeActivity(); return; }               // 条件不满足了：收起
    tickActivity();
  }, 1000);
}

function closeActivity() {
  if (_bodyTimer) { clearInterval(_bodyTimer); _bodyTimer = null; }
  if (_openMod && _openMod.unmount) {
    try { _openMod.unmount($('activityBody'), ctxFor(entryOf(_open), _openWin)); } catch (_) {}
  }
  _open = null;
  _openMod = null;
  _picks = [];
  if (getCurrentView() === 'activityView') popNav(); // 自己关掉时把栈里那层弹掉，别让返回键再打开它
  showView('phoneView');
  refreshEntry();
}

// 活动能用到的东西：只有这些，够写玩法，又碰不到游戏状态
function ctxFor(a, win) {
  if (!gameData.activity) gameData.activity = {};
  // 每次活动开启都是一份干净的存档槽：窗口开始时刻变了就重置
  // （气球、兑换记录、档位进度、抽到的奖励都不带到下一次）
  const from = win ? win.from : 0;
  let slot = gameData.activity[a.id];
  if (!slot || slot.actFrom !== from) {
    slot = gameData.activity[a.id] = { actFrom: from };
    saveGame();
  }
  return {
    id: a.id,
    from: win ? win.from : 0,
    to: win ? win.to : 0,
    payload: a.payload || {},
    slot,                                   // 这个活动的存档命名空间（随主存档落盘，按"这一次活动"隔离）
    get left() { return Math.max(0, (win ? win.to : 0) - serverNow()); },
    grant: (key, qty = 1) => grantItem(key, qty, '限时活动'),   // 第三个参数是掉落来源，会写进系统日志
    // 持有量（只读）与消耗：不足则整单不执行，返回是否成功
    count: (key) => Number(gameData.items[key]) || 0,
    spend: (key, qty = 1) => {
      const n = Number(gameData.items[key]) || 0;
      if (n < qty) return false;
      if (n === qty) delete gameData.items[key]; else gameData.items[key] = n - qty;
      saveGame();
      return true;
    },
    confirm: (text, onYes) => showConfirmBar(text, onYes || null, null, {}),   // 留取消键，让玩家能反悔
    picks: _picks,                                    // 槽位里已选的个体 id（下标 = 槽位）
    setPick: (i, rid) => { _picks[i] = rid || null; },
    // 打开仓库选择器挑一只放进第 i 个槽；exclude 由活动给（只列得出可上交的那些）
    openPicker: (i, exclude) => {
      import('./roster.js').then(m => m.showRosterPicker({
        mode: 'activity', slot: i, from: 'activityView', exclude: exclude || [],
      }));
    },
    // 发一颗蛋（闪光蛋也走这里）：蛋作为仓库条目存在，个体/性格/性别/闪光都跟着它，
    // 放进孵蛋器孵出来就是同一只（与培育蛋同一套机制）
    grantEgg: (species, eggOpts = {}) => {
      const arr = (gameData && Array.isArray(gameData.roster)) ? gameData.roster : null;
      if (!arr) return false;
      arr.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        kind: 'egg',
        species: String(species),
        originSpecies: String(species),
        gender: rollGender(String(species)),
        level: 1, exp: 0,
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: eggOpts.ivs || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        nature: eggOpts.nature || 'hardy',
        shiny: !!eggOpts.shiny,
        source: 'egg',
        obtainedAt: Date.now(),
        inRoster: true,
      });
      saveGame();
      return true;
    },
    // 上交：按 id 从仓库移除（活动改游戏状态只走 grant / take / grantEgg 这几个口子）
    take: (ids, reason) => {
      const arr = (gameData && Array.isArray(gameData.roster)) ? gameData.roster : [];
      // 空位过滤掉：picks 跳着放会留空洞，for...of 会把它当 undefined 交给
      // findIndex（-1）→ splice(-1,1) 误删仓库末尾的个体
      const want = (ids || []).filter(Boolean);
      // 全有才交：有一个不在了（被放生/交换/进化改了 id）就整单作废，避免半交还照发全奖
      if (!want.length || want.some(id => !arr.some(p => p.id === id))) return false;
      for (const id of want) arr.splice(arr.findIndex(p => p.id === id), 1);
      const n = want.length;
      addSystemLog(`上交了 ${n} 只宝可梦${reason ? `（${reason}）` : ''}`);
      saveGame();
      return true;
    },
    name: (key) => ITEM_NAMES[key] || key,
    save: () => saveGame(),
    refresh: () => paintActivity(),
    // 记系统日志（用新 type 的话，要在 views.js 的日志文案表里补一行）
    log: (type, details) => addSystemLog(type, details),
  };
}

// 画一次容器内容：调活动的 render 铺 HTML，再调 mount 绑事件
function paintActivity() {
  const body = $('activityBody');
  if (!body || !_openMod) return;
  const ctx = currentCtx();
  // 标题：活动可以自己拼（大量悬赏会把目标宝可梦接在后面，如"大量悬赏-皮卡丘"）；
  // 中间那格是活动自己的徽标（气球之类），不占正文高度
  const titleEl = $('activityTitle');
  if (titleEl) {
    let t = _openMod.name || '限时活动';
    try { if (_openMod.title) t = _openMod.title(ctx) || t; } catch (e) { console.error('[限时活动] title 出错：', e); }
    titleEl.textContent = t;
  }
  const badgeEl = $('activityBadge');
  if (badgeEl) {
    let html = '';
    try { html = (_openMod.badge && _openMod.badge(ctx)) || ''; } catch (e) { console.error('[限时活动] badge 出错：', e); }
    if (badgeEl.innerHTML !== html) badgeEl.innerHTML = html;
  }
  let html = '';
  try { html = _openMod.render(ctx) || ''; } catch (e) { console.error('[限时活动] render 出错：', e); html = ''; }
  body.innerHTML = html;
  try { _openMod.mount && _openMod.mount(body, ctx); } catch (e) { console.error('[限时活动] mount 出错：', e); }
  try { _openMod.tick && _openMod.tick(body, ctx); } catch (_) {}
  paintLeft(ctx);
}

function currentCtx() {
  return ctxFor(entryOf(_open), _openWin);
}

// 每秒只走 tick（活动自己判断内容有没有变）+ 刷倒计时；不整页重画，才不会打断动图立绘
function tickActivity() {
  const body = $('activityBody');
  if (!body || !_openMod) return;
  const ctx = currentCtx();
  try { _openMod.tick && _openMod.tick(body, ctx); } catch (_) {}
  paintLeft(ctx);
}

function paintLeft(ctx) {
  const left = $('activityLeft');
  if (!left) return;
  const ms = ctx.left;
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  left.textContent = h >= 24
    ? `剩 ${Math.floor(h / 24)} 天 ${h % 24} 小时`
    : `剩 ${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// 开机：先吃缓存再拉最新；之后每分钟看一眼（到点就收摊），每 10 分钟对一次表
export function startActivityRefresh() {
  // 入口是手机第三页那些活动图标（点击由 apps.js 里各自的 open 处理），这里只管状态刷新
  refreshEntry();
  loadActivitiesFromCache();
  loadActivities(true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadActivities(); });
  // 入口状态 5 秒复检：活动清单和排期是两条独立请求，谁先到都可能让"就绪"判断扑空
  setInterval(() => { if (!document.hidden) refreshEntry(); }, 5000);
  setInterval(() => {
    if (document.hidden) return;
    refreshEntry();
    if (_expiredSoon()) loadActivities(true);
    else if (++_tick % RETRY_MIN === 0) loadActivities(true);
  }, 60000);
}
