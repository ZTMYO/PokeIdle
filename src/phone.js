// ===== 手机主页（主菜单） =====
// 应用定义在 apps.js，桌面顺序存在存档的 phoneLayout 里：
// 长按进编辑态可拖拽：拖到哪个图标身上就和它就地换位，快速甩上去则是建合集。
import { $, showView, showAppView, syncViewChrome, isDualLayout, renderIncubatorView, viewportToLogic } from './ui.js';
import { pushNav, gameData, saveGame } from './state.js';
import { allApps, appById, appAvailable } from './apps.js';
import { ensureTrades } from './trade.js';
import { getNowPlaying, isMusicEnabled } from './audio.js';
import { showMusicView, refreshMusicViewIfOpen } from './music.js';

// 每页应用数量（5 列 × 2 行）
const PAGE_SIZE = 10;
// 合集容量上限 = 窗口里一屏放得下的数量（3×3），多出来的应用落回桌面末尾
const FOLDER_MAX = 9;
// 拖到边缘要停这么久才翻页（防手滑：划过边缘不翻）
const CUE_DWELL_MS = 320;
// 翻过一页后的冷却：手指还停在边上也不能马上再翻，免得一路连翻；
// 想接着翻得先把手指移出边缘再贴回来（那次重新计时）
const FLIP_COOLDOWN_MS = 600;
// 快甩门槛（机身逻辑像素/毫秒）：手速到这儿就记一笔"刚甩过"，比这慢的才算换位。
// 量的是窗口内的峰值，实测"挪一格"的快甩约 0.2~0.3、慢慢拖约 0.05~0.15。
// 取 0.35 而不是 0.25：上下换位要跨一行、行程更长，速度容易冲过旧门槛，
// 结果被当成"甩"去建合集，反而换不了位；放宽一点，稍快的拖速也还能换位
const FAST_PX_MS = 0.35;
// "刚甩过"记性有多久：甩完会减速，减速后的速度代表不了这一下，所以看这一小段内有没有甩过
const FAST_HOLD_MS = 200;
// 手速取最近这么久内走过的距离折算（窗口越短越贴当下的动作）
const VEL_WINDOW_MS = 120;
// 指针落在图标之间的缝里时，离得这么近就算压在图标上
const TILE_SNAP_PX = 8;
// 编辑态里按住多久才拖起来：比进编辑态那次短，但也不能是"按下即拖"——
// 不然想滑动翻页时一按图标就被当成拖拽了
const DRAG_HOLD_MS = 200;
// 短按/横滑超过这个位移就撤销长按（交给翻页手势）
const PRESS_SLOP_PX = 10;
// 指针离左右边缘多近算"贴边翻页"（机身逻辑像素）
const EDGE_ZONE = 14;

// 合集名是玩家自己填的，拼进 HTML 前先转义
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _edit = false;      // 编辑态：图标抖动、可拖拽
let _dragging = false;  // 拖拽中：挂起重绘，避免拖到一半整页重建
let _stale = false;     // 重绘被挂起过，退出编辑态时补一次
let _pageIdx = 0;       // 当前页（重绘后归位，别把玩家弹回第一页）

// 打开孵蛋器应用（从手机进入，返回回到手机主页；全局快捷键 F 也走这里）
export function showIncubatorView() {
  pushNav('incubatorView');
  showView('incubatorView');
  renderIncubatorView();
}

// ---------- 红点 ----------
async function appDot(id) {
  const a = appById(id);
  if (!a || !a.dot) return false;
  try { return !!(await a.dot()); } catch (_) { return false; }
}

// 标题栏手机图标聚合红点：任意应用有红点即点亮（不看手机页是否渲染）
export function updatePhoneBadge() {
  const badge = $('title-badge-phone');
  if (!badge) return;
  ensureTrades(); // 波次过期先刷新，保证与交换红点口径一致
  Promise.all(allApps().map((a) => appDot(a.id))).then((list) => {
    badge.style.display = list.some(Boolean) ? '' : 'none';
  });
}

// 磁贴红点：布局可重排、应用能进合集，不能按固定 id 找节点，整体重算一遍。
// 查 #phoneView 而不是 #phoneContent：合集窗口挂在它下面，窗口里那些图标也要各自亮红点
export function refreshPhoneBadges() {
  updatePhoneBadge();
  $('phoneView')?.querySelectorAll('.phone-app[data-dot]').forEach(async (el) => {
    const on = (await Promise.all(el.dataset.dot.split(' ').map(appDot))).some(Boolean);
    const badge = el.querySelector('.phone-app-badge');
    if (badge) badge.style.display = on ? '' : 'none';
  });
}

// 状态变化时即时刷新红点：树果浇水/收获/种植、仓库变化（捕获/孵化/交换）、交换波次、成就、教程、派遣
for (const ev of ['berry-farm-changed', 'roster-changed', 'trade-wave-changed', 'achievements-changed', 'tutorial-rewards-changed', 'dispatch-changed']) {
  window.addEventListener(ev, refreshPhoneBadges);
}

// 音乐栏整条可点：进音乐点播页（音乐关着时这条不展开，也就点不到）
function installMusicEntry() {
  const el = $('phoneMusic');
  if (!el || el._wired) return;
  el._wired = true;
  el.addEventListener('click', () => showMusicView());
}

// 顶部系统时间，每秒刷新一次（仅启动一次）
function startClock() {
  if (startClock._started) return;
  startClock._started = true;
  const tick = () => {
    const timeEl = $('phoneClockTime');
    if (!timeEl) return;
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const week = '日一二三四五六'[d.getDay()];
    const dateEl = $('phoneClockDate');
    if (dateEl) dateEl.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week}`;
    timeEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    updatePhoneMusic();
    refreshMusicViewIfOpen(); // 音乐页开着时同步「正在播」标记（复用这个 1 秒 tick，不另起定时器）
  };
  tick();
  setInterval(tick, 1000);
}

// 时间下方显示当前地区音乐：标题变化才写 DOM，波形仅在地区曲实际发声时跳动
function updatePhoneMusic() {
  const el = $('phoneMusic');
  if (!el) return;
  const info = getNowPlaying();
  const pv = $('phoneView');
  // 音乐栏常驻 flex，展开/收起由 has-music 控制（max-height+opacity 平滑过渡），与时钟放大/压缩互补保持总高度稳定
  el.style.display = 'flex';
  // 音乐开着就常驻这条（暂停时也能点进去换歌）；音乐总开关关掉、或还没播过曲子时收起
  if (!isMusicEnabled() || !info.title) {
    if (pv) pv.classList.remove('has-music');
    return;
  }
  if (pv) pv.classList.add('has-music');
  const titleEl = $('phoneMusicTitle');
  if (titleEl && titleEl.textContent !== info.title) titleEl.textContent = info.title;
  const eq = $('phoneMusicEq');
  if (eq) eq.classList.toggle('on', info.playing);
}

export function showPhoneView() {
  showPhoneHome();
  // 手游：showPhoneHome 只切下半屏，这里补记当前页；经典下它已经整屏切过去了
  if (isDualLayout()) showView('phoneView');
}

// 右上角「可更新」：有资源待更新才显示（闪烁），点它弹更新对话框；取消也留着，下次还能点
function updateHotBadge() {
  const el = $('phoneUpdate');
  if (!el) return;
  import('./hot-update.js')
    .then((m) => { el.style.display = m.hotPendingCount() > 0 ? '' : 'none'; })
    .catch(() => { el.style.display = 'none'; });
}
// 双屏下手机页会被战斗屏的内层盖住，角标收不到 click：在文档捕获阶段按坐标判定
// 手机页上有浮层时：坐标命中要放过（否则点浮层空白会穿透到角标）
function overlayOnPhone() {
  return !!($('phoneFolderMask') || $('evpMapMask') || $('hotMask')
    || document.querySelector('.dg-blocker') || document.querySelector('#quitDialog.open'));
}
// 双屏下手机页会被战斗屏的内层盖住，角标收不到 click：在文档捕获阶段按坐标判定。
// 盒子用 getClientRects 取（没被 main.js 的 rect 补偿改写，是真实视口坐标），直接和指针比：
// 手机单屏模式走 transform 缩放，getBoundingClientRect 返回的是机身逻辑坐标，两边对不上
function bindHotBadge() {
  const el = $('phoneUpdate');
  if (!el || el._wired) return;
  el._wired = true;
  document.addEventListener('pointerdown', (e) => {
    if (overlayOnPhone()) return;
    const r = el.getClientRects()[0];
    if (!r || !r.width) return;
    if (e.clientX < r.left - 6 || e.clientX > r.right + 6 || e.clientY < r.top - 6 || e.clientY > r.bottom + 6) return;
    e.preventDefault();
    e.stopPropagation();
    import('./hot-update.js')
      .then((m) => { console.log('[热更] 角标命中，记录里的待更新数', m.hotPendingCount()); return m.openHotUpdateNotice(); })
      .catch(() => {});
  }, true);
}
window.addEventListener('hot-pending', updateHotBadge);

// 手机页开着时重画一次（不压导航栈）；编辑态/拖拽中挂起，等退出编辑态再补
export function refreshPhoneHome() {
  const el = $('phoneContent');
  if (!el || $('phoneView')?.style.display === 'none') return false;
  if (_edit || _dragging) { _stale = true; return true; }
  paintPhoneHome(el);
  return true;
}

// 渲染并显示手机首页，并把 phoneView 压栈供返回
export function showPhoneHome() {
  pushNav('phoneView');
  startClock();
  installMusicEntry();
  bindHotBadge();
  exitEdit();   // 从别处回到手机页：退出编辑态
  paintPhoneHome($('phoneContent'));
  // 手游双屏：显示到下半屏应用容器（不改当前页）；经典布局等同整屏切换
  showAppView('phoneView');
  $('phoneContent')?._syncPage?.();   // 显示后再归位一次（隐藏时容器宽为 0，滚不到目标页）
  // 下半屏停在首页就是把当前页记成首页：入口高亮跟着走，返回按钮随之置灰
  if (isDualLayout()) syncViewChrome('phoneView');
}

// ---------- 桌面布局 ----------
// 布局 = 一页固定 10 格（PAGE_SIZE），格子里没有图标就是 null。拖走一个只把那格清空、
// 后面谁都不动 —— 洞长期留着，和 Windows 桌面一个意思；新装应用、合集溢出/解散都填最近的空位。
function pages() {
  const L = gameData.phoneLayout;
  if (!Array.isArray(L) || L.some((p) => !Array.isArray(p))) gameData.phoneLayout = [];
  return gameData.phoneLayout;
}
const slotKey = (p, i) => `${p}-${i}`;
function parseSlot(k) {
  const [p, i] = String(k).split('-');
  return { p: Number(p), i: Number(i) };
}
const itemAt = (p, i) => (pages()[p] || [])[i] || null;

// 空页：固定 10 格全是空位，可以顺手在首格塞一个
const freshPage = (entry) => { const pg = new Array(PAGE_SIZE).fill(null); if (entry) pg[0] = entry; return pg; };
// 空位占位：和图标同尺寸的方形虚框，钉在格子里。有它每格都有一个 DOM，网格不会自己往前补
const blankHtml = (p, i) => `<div class="phone-blank" data-slot="${slotKey(p, i)}"></div>`;

// 把 entry 放到第 p 页第 i 格：那格空着就直接放；被占就从落点往后找最近的空位，
// 再没有就从第一页头找，全都满才新开一页。只填空位、不挤别人
function placeAt(P, p, i, entry) {
  const N = P.length * PAGE_SIZE;
  for (let k = Math.max(0, p) * PAGE_SIZE + Math.max(0, i); k < N; k++) {
    const pg = P[Math.floor(k / PAGE_SIZE)];
    if (pg && pg[k % PAGE_SIZE] == null) { pg[k % PAGE_SIZE] = entry; return; }
  }
  for (let k = 0; k < N; k++) {
    const pg = P[Math.floor(k / PAGE_SIZE)];
    if (pg && pg[k % PAGE_SIZE] == null) { pg[k % PAGE_SIZE] = entry; return; }
  }
  P.push(freshPage(entry));
}

// 元素现在在哪一页哪一位（摘除/插入之后下标会变，用对象引用回查）
function findSlot(entry) {
  const P = pages();
  for (let p = 0; p < P.length; p++) {
    const i = P[p].indexOf(entry);
    if (i >= 0) return { p, i };
  }
  return null;
}

// 对账：清掉未知 id / 重复 / 空合集，**原位置直接清成空位**（不压缩、不补位）；
// 整页都是空位的页删掉（至少留一页）；缺的应用（新装等）填进最近的空位
function normalizeLayout() {
  const seen = new Set();
  const clean = (e) => {
    if (!e) return null;
    if (typeof e.app === 'string') {
      if (seen.has(e.app) || !appById(e.app)) return null;
      seen.add(e.app);
      return { app: e.app };
    }
    if (Array.isArray(e.folder)) {
      const ids = e.folder.filter((id) => typeof id === 'string' && appById(id) && !seen.has(id));
      if (!ids.length) return null;
      ids.forEach((id) => seen.add(id));
      const f = { folder: ids };
      if (typeof e.name === 'string' && e.name) f.name = e.name;
      return f;
    }
    return null;
  };
  const out = [];
  for (const page of pages()) {
    const pg = [];
    for (let i = 0; i < PAGE_SIZE; i++) pg.push(clean(page[i]));
    out.push(pg);
  }
  for (let i = out.length - 1; i > 0; i--) {   // 整页空的删掉，第 0 页怎么都留着
    if (out[i].every((e) => !e)) out.splice(i, 1);
  }
  if (!out.length) out.push(freshPage());
  for (const a of allApps()) {
    if (seen.has(a.id) || !appAvailable(a)) continue;
    seen.add(a.id);
    placeAt(out, 0, 0, { app: a.id });
  }
  gameData.phoneLayout = out;
  return out;
}

function paintPhoneHome(el) {
  if (!el) return;
  resetDrag();   // 上一次拖拽被打断（切后台/元素被换掉）时兜底复位
  _stale = false;
  updateHotBadge();
  const P = normalizeLayout();
  el.innerHTML = `<div class="phone-pages" id="phonePages">`
    + P.map((page, pi) => `<div class="phone-page" data-page="${pi}">${page.map((entry, ti) => (entry ? tileHtml(entry, pi, ti) : '') || blankHtml(pi, ti)).join('')}</div>`).join('')
    + `</div>`
    + (P.length > 1 ? `<div class="phone-dots">${P.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}" data-page="${i}"></span>`).join('')}</div>` : '');
  refreshPhoneBadges();
  bindPaging(el, P.length);
  bindGestures(el);
  // 点击应用进入对应页面；点合集开窗口（编辑态里点空白顺手关掉窗口）
  el.onclick = (e) => {
    const tile = e.target.closest('.phone-app');
    if (_edit) {
      // 编辑态遮罩不拦指针：点桌面空白（不在图标上）顺手关掉合集窗口
      if ($('phoneFolderMask') && !tile && !e.target.closest('.phone-folder-box')) closeFolderWindow();
      return;
    }
    if (!tile || tile.dataset.inFolder) return;   // 窗口里的点击由窗口自己处理
    if (tile.dataset.folder) { const s = parseSlot(tile.dataset.folder); openFolderWindow(s.p, s.i); return; }
    if (tile.dataset.app) appById(tile.dataset.app)?.open();
  };
}

// 磁贴：应用 / 合集（合集里最多画 9 个迷你图标，3×3）
function tileHtml(entry, p, i) {
  const slot = slotKey(p, i);
  const delay = `animation-delay:-${(i % 5) * 0.07}s`;   // 抖动错开相位，别整页同频
  if (typeof entry.app === 'string') {
    const a = appById(entry.app);
    if (!a || !appAvailable(a)) return '';
    const title = a.titleOf ? a.titleOf() : '';
    return `<div class="phone-app" data-app="${a.id}" data-slot="${slot}" data-dot="${a.id}" style="${delay}"${title ? ` title="${title}"` : ''}>`
      + `<div class="phone-app-icon"><svg><use xlink:href="#${a.icon}"/></svg><span class="phone-app-badge" id="phone-badge-${a.id}" style="display:none;"></span></div>`
      + `<div class="phone-app-name">${a.nameOf ? a.nameOf() : a.name}</div></div>`;
  }
  const apps = entry.folder.map(appById).filter((a) => a && appAvailable(a));
  if (!apps.length) return '';
  return `<div class="phone-app phone-folder" data-folder="${slot}" data-slot="${slot}" data-dot="${apps.map((a) => a.id).join(' ')}" style="${delay}">`
    + `<div class="phone-app-icon phone-folder-icon">${apps.slice(0, FOLDER_MAX).map((a) => `<i><svg><use xlink:href="#${a.icon}"/></svg></i>`).join('')}`
    + `<span class="phone-app-badge" style="display:none;"></span></div>`
    + `<div class="phone-app-name">${esc(entry.name || '合集')}</div></div>`;
}

// 翻页：页码指示点点击 + 手势拖动（编辑态交给拖拽，不翻页）
function bindPaging(el, pageCount) {
  let page = Math.max(0, Math.min(_pageIdx, pageCount - 1));
  const pagesEl = $('phonePages');
  const paintDots = () => el.querySelectorAll('.phone-dots .dot').forEach((d, di) => d.classList.toggle('active', di === page));
  const gotoPage = (i) => {
    page = Math.max(0, Math.min(pageCount - 1, i));
    _pageIdx = page;
    // 整页宽就是容器宽，目标位置 = 页码 × 容器宽
    pagesEl.scrollTo({ left: page * pagesEl.clientWidth, behavior: 'smooth' });
    paintDots();
  };
  el.querySelectorAll('.phone-dots .dot').forEach(d => {
    d.addEventListener('click', () => gotoPage(Number(d.dataset.page)));
  });
  // 重绘后归位（不做动画）：页面还没显示时容器宽为 0，等 showPhoneHome 里显示完再补一次
  const syncScroll = () => {
    const w = pagesEl.clientWidth;
    if (!w) return;
    pagesEl.scrollLeft = page * w;
    paintDots();
  };
  el._syncPage = syncScroll;
  el._gotoPage = gotoPage;                 // 拖拽到边缘要翻页
  el._pageNow = () => page;
  el._pageCount = () => pageCount;
  syncScroll();
  // 触摸翻页：只有编辑态才手动接管 —— 那时 touch-action: none 把原生滚动关掉了（拖拽要独占手势）。
  // 平时这块本身就是横向滚动容器，交给浏览器滚最跟手，别去 preventDefault 抢它
  let pan = null;
  let _suppress = false;   // 划过页后挡掉手指底下那一下点击
  pagesEl.addEventListener('touchstart', (e) => {
    if (!_edit || e.touches.length !== 1) { pan = null; return; }
    const r = pagesEl.getBoundingClientRect();
    // 整机是缩放过的，手指位移要折算回布局像素
    pan = { x: e.touches[0].clientX, y: e.touches[0].clientY, page, dx: 0, axis: 0,
      scale: (r.width / (pagesEl.offsetWidth || 1)) || 1 };
  }, { passive: true });
  pagesEl.addEventListener('touchmove', (e) => {
    if (!pan || _drag || e.touches.length !== 1) return;   // 没接管 / 正在拖图标：都别翻页
    const dx = (e.touches[0].clientX - pan.x) / pan.scale;
    const dy = (e.touches[0].clientY - pan.y) / pan.scale;
    if (!pan.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      pan.axis = Math.abs(dx) > Math.abs(dy) ? 1 : -1;   // -1 = 纵向手势，交还给页面
      if (pan.axis < 0) { pan = null; return; }
    }
    e.preventDefault();
    pan.dx = dx;
    pagesEl.scrollLeft = pan.page * pagesEl.clientWidth - dx;
  }, { passive: false });
  const endPan = () => {
    const w = pagesEl.clientWidth || 1;
    const d = pan;
    pan = null;
    if (!d) {   // 纵向手势 / 多指：只把画面拉回最近一页
      const idx = Math.round(pagesEl.scrollLeft / w);
      if (idx !== page) gotoPage(idx);
      return;
    }
    if (d.axis > 0) {
      _suppress = true;
      setTimeout(() => { _suppress = false; }, 400);
    }
    gotoPage(d.page + (d.dx <= -w / 5 ? 1 : d.dx >= w / 5 ? -1 : 0));   // 只看这一次手势的方向，最多翻一页
  };
  pagesEl.addEventListener('touchend', endPan);
  pagesEl.addEventListener('touchcancel', endPan);
  // 拖动中圆点不跟着中间态闪
  pagesEl.addEventListener('scroll', () => {
    if (pan) return;
    const idx = Math.round(pagesEl.scrollLeft / (pagesEl.clientWidth || 1));
    if (idx !== page && idx >= 0 && idx < pageCount) {
      page = idx;
      _pageIdx = idx;
      paintDots();
    }
  }, { passive: true });
  // 鼠标滚轮翻页（桌面端）：纵向滚轮映射为横向翻页，带节流防连翻
  let wheelLock = 0;
  pagesEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; // 横向滚轮交给原生滚动
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLock < 400) return;
    wheelLock = now;
    gotoPage(page + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  // 划页后吞掉收尾 click，别顺手把手指底下那个应用点开
  el.addEventListener('click', (e) => { if (_suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// ---------- 编辑态 ----------
function enterEdit() {
  if (_edit) return;
  _edit = true;
  $('phoneView')?.classList.add('editing');
  if (!$('phoneEditBar')) {
    const bar = document.createElement('div');
    bar.id = 'phoneEditBar';
    bar.className = 'phone-edit-bar';
    bar.innerHTML = '<span class="phone-edit-btn" data-edit="reset">恢复默认布局</span>'
      + '<span class="phone-edit-btn" data-edit="done">完成</span>';
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-edit]');
      if (!btn) return;
      if (btn.dataset.edit === 'reset') restoreDefaultLayout(); else exitEdit();
    });
    $('phoneView')?.appendChild(bar);
  }
}

export function exitEdit() {
  if (!_edit) return;
  _edit = false;
  resetDrag();
  closeFolderWindow();
  $('phoneView')?.classList.remove('editing');
  $('phoneEditBar')?.remove();
  if (_stale) { _stale = false; paintPhoneHome($('phoneContent')); }
}
export function isPhoneEditing() { return _edit; }

// 恢复默认布局：清空后由对账按注册表顺序重建（只动布局，不碰存档其它字段）
function restoreDefaultLayout() {
  gameData.phoneLayout = [];
  saveGame();
  paintPhoneHome($('phoneContent'));
}

// ---------- 合集窗口 ----------
// 在手机屏内弹一层，整块由 JS 生成（外壳热更不到）。编辑态里遮罩不拦指针，方便把图标拖出去；
// 关窗口靠点空白（编辑态由桌面点击兜底），所以不放关闭按钮。
function openFolderWindow(p, i) {
  closeFolderWindow();
  const view = $('phoneView');
  const entry = itemAt(p, i);
  if (!view || !entry?.folder) return;
  const key = slotKey(p, i);
  const apps = entry.folder.map(appById).filter((a) => a && appAvailable(a));
  if (!apps.length) return;
  const el = document.createElement('div');
  el.id = 'phoneFolderMask';
  el.className = 'phone-folder-mask';
  el.innerHTML = `<div class="phone-folder-box" data-folder-box="${key}">
      <div class="phone-folder-title" data-folder-name="1"></div>
      <div class="phone-folder-grid">
        ${apps.map((a) => `<div class="phone-app" data-app="${a.id}" data-in-folder="${key}" data-dot="${a.id}">
            <div class="phone-app-icon"><svg><use xlink:href="#${a.icon}"/></svg><span class="phone-app-badge" style="display:none;"></span></div>
            <div class="phone-app-name">${a.nameOf ? a.nameOf() : a.name}</div></div>`).join('')}
      </div>
    </div>`;
  el.querySelector('[data-folder-name]').textContent = entry.name || '合集';
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-folder-name]') || e.target.closest('.phone-folder-name-input')) return;   // 点标题是改名，不当空白
    const tile = e.target.closest('.phone-app');
    if (!tile || _edit) { if (!tile) closeFolderWindow(); return; }   // 点空白关掉；编辑态里点图标不打开
    const a = appById(tile.dataset.app);
    if (a) { closeFolderWindow(); a.open(); }
  });
  el.querySelector('[data-folder-name]').addEventListener('click', (e) => startRename(p, i, e.currentTarget));
  el.querySelector('.phone-folder-box').addEventListener('pointerdown', (e) => {
    startTilePress(e, e.target.closest('.phone-app'));
  });
  view.appendChild(el);
  refreshPhoneBadges();
}
function closeFolderWindow() { $('phoneFolderMask')?.remove(); }

// 点标题直接改名（最多 4 字）：回车/点别处保存，Esc 取消
function startRename(p, i, titleEl) {
  if (titleEl.querySelector('input')) return;
  const entry = itemAt(p, i);
  if (!entry?.folder) return;
  const input = document.createElement('input');
  input.className = 'phone-folder-name-input';
  input.maxLength = 4;
  input.value = entry.name || '合集';
  input.setAttribute('aria-label', '合集名称');
  const commit = (save) => {
    if (!input.isConnected) return;
    if (!save) { titleEl.textContent = entry.name || '合集'; return; }
    const v = input.value.trim().slice(0, 4);
    if (v && v !== '合集') entry.name = v; else delete entry.name;   // 叫回默认名就等于没改
    saveGame();
    closeFolderWindow();
    openFolderWindow(p, i);           // 重开一次：标题与桌面磁贴都跟着新名字
    paintPhoneHome($('phoneContent'));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();
}

// ---------- 长按 / 拖拽 ----------
// 长按 500ms 进编辑态，并且不松手就能接着拖这个图标；拖到哪个图标身上就和它就地换位（画面实时重排），
// 快甩到图标上=建合集（描边锁定，指针不离开就不拆）。合集窗口里的图标同样能长按拖出来（拖起来后窗口收掉）。
let _drag = null;      // 拖拽状态（桌面与合集窗口共用）
let _press = null;     // { e, tile, timer }
function cancelPress() { if (_press) { clearTimeout(_press.timer); _press = null; } }
window.addEventListener('pointerup', cancelPress);
window.addEventListener('pointercancel', cancelPress);

// 按下图标：编辑态里按住 DRAG_HOLD_MS 才拖起来，否则等 500ms 进编辑态。
// 编辑态也不做"按下即拖"：不然想横滑翻页时一按图标就被当成拖拽
function startTilePress(e, tile) {
  if (!tile || e.button === 2 || _drag) return;
  cancelPress();
  _press = { e, tile, timer: setTimeout(() => {
    const p = _press;
    _press = null;
    if (!_edit) enterEdit();
    if (p) beginDrag(p.e, p.tile, true);
  }, _edit ? DRAG_HOLD_MS : 500) };
}

function bindGestures(el) {
  const pagesEl = $('phonePages');
  pagesEl.addEventListener('pointerdown', (e) => startTilePress(e, e.target.closest('.phone-app')));
  pagesEl.addEventListener('pointermove', (e) => {
    if (!_press) return;
    if (Math.hypot(e.clientX - _press.e.clientX, e.clientY - _press.e.clientY) > PRESS_SLOP_PX) cancelPress();
  });
  // 桌面右键等同长按
  pagesEl.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.phone-app') || _edit) return;
    e.preventDefault();
    enterEdit();
  });
}

function beginDrag(e, tile, lift) {
  if (_drag) return;
  const inFolder = tile.dataset.inFolder ? parseSlot(tile.dataset.inFolder) : null;
  const from = tile.dataset.slot ? parseSlot(tile.dataset.slot) : null;
  const entry = inFolder ? { app: tile.dataset.app } : (from ? itemAt(from.p, from.i) : null);
  if (!entry) return;
  if (e.cancelable) e.preventDefault();
  e.stopPropagation();
  const lp = viewportToLogic(e.clientX, e.clientY);
  _drag = { tile, entry, from, inFolder, id: tile.dataset.app || null, pid: e.pointerId,
    x0: e.clientX, y0: e.clientY, moved: !!lift, touched: false, mode: '', dwellDir: 0, newPage: false, dwell: 0,
    pt: { x: e.clientX, y: e.clientY }, trace: [{ x: lp.x, y: lp.y, t: performance.now() }], v: 0,
    fastAt: 0, swapped: false, armed: null, ghost: null };
  _dragging = true;
  // 监听挂在 document 上：拖拽途中合集窗口会被收掉、手机页可能重绘，挂在图标上会跟着一起没
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
  if (lift) liftTile();
}

// 图标离手：幽灵跟着指针；原来那格直接留空（不补位，拖到哪就是哪）
function liftTile() {
  const st = _drag;
  st.tile.classList.add('dragging');
  st.ghost = makeGhost(st.tile);
  moveGhost(st.x0, st.y0);
}

// 手速 = 最近 VEL_WINDOW_MS 内的峰值（机身逻辑像素/毫秒）。取峰值不是取平均：挪一格的距离很短，
// 一次快甩的平均速度会被起步和收尾拖低，量不出"甩"这一下。
// 用机身逻辑像素而不是屏幕像素：机身缩放各设备差很多，用屏幕像素会让同一个手势在手机上量出来
// 只有电脑的一半，阈值就没法通用了。按"累积够 8ms 结算一段"算，高频鼠标也不会除出假高速
function sampleVelocity(st, e) {
  const now = performance.now();
  const lp = viewportToLogic(e.clientX, e.clientY);
  st.trace.push({ x: lp.x, y: lp.y, t: now });
  while (st.trace.length > 2 && now - st.trace[0].t > VEL_WINDOW_MS) st.trace.shift();
  let peak = 0, anchor = st.trace[0];
  for (let i = 1; i < st.trace.length; i++) {
    const b = st.trace[i];
    const dt = b.t - anchor.t;
    if (dt < 8) continue;
    peak = Math.max(peak, Math.hypot(b.x - anchor.x, b.y - anchor.y) / dt);
    anchor = b;
  }
  st.v = peak;
  if (peak >= FAST_PX_MS) st.fastAt = now;   // 甩过就记一笔
}

function onDragMove(e) {
  if (!_drag || e.pointerId !== _drag.pid) return;
  const st = _drag;
  if (!st.touched) {
    if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < 6) return;   // 6px 阈值：轻点不算拖
    st.touched = true;
    if (!st.moved) { st.moved = true; liftTile(); }
    // 从合集窗口里拖出来：手一动就把窗口收掉，桌面露出来才好落点
    if (st.inFolder != null) closeFolderWindow();
  }
  sampleVelocity(st, e);
  moveGhost(e.clientX, e.clientY);
  updateDropCue(e.clientX, e.clientY);
}

function onDragEnd(e) {
  if (!_drag) return;
  const st = _drag;
  _drag = null;
  _dragging = false;
  clearTimeout(st.dwell);
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragEnd);
  st.tile.classList.remove('dragging');
  st.layer?.remove();
  hideNewPageTip();
  showEdgeTip(0);
  clearCues();
  if (!st.touched) {
    // 没真正拖动过 = 轻点：合集开窗口看看里面有什么
    if (st.entry.folder && !st.inFolder && st.from) openFolderWindow(st.from.p, st.from.i);
    return;
  }
  // 拖拽中已经就地换过位：位置已经对了，这里只要落盘
  if (st.swapped && st.from && st.mode.startsWith('slot:')) {
    const t = parseSlot(st.mode.slice(5));
    if (t.p === st.from.p && t.i === st.from.i) { saveGame(); return; }
  }
  // 落点只看"刚才屏幕上给过的提示"：图标描边才合并/进合集，虚框才插到那一格，没提示就不动
  if (st.mode === 'box') {
    const box = $('phoneFolderMask')?.querySelector('.phone-folder-box');
    if (box) { const t = parseSlot(box.dataset.folderBox); applyDrop(st, { kind: 'intoFolder', p: t.p, i: t.i }); }
    return;
  }
  if (st.mode.startsWith('icon:')) { const t = parseSlot(st.mode.slice(5)); applyDrop(st, { kind: 'icon', p: t.p, i: t.i }); return; }
  if (st.newPage) { applyDrop(st, { kind: 'newpage' }); return; }   // 最后一页右边缘：新建一页
  if (st.mode.startsWith('slot:')) { const t = parseSlot(st.mode.slice(5)); applyDrop(st, { kind: 'slot', p: t.p, i: t.i }); }
}

// 幽灵磁贴跟随指针（只带图标，不带名字：拖起来的时候下面那行字不该跟着走）
function makeGhost(tile) {
  const st = _drag;
  const box = $('appScreen');
  if (!st || !box) return null;
  // 裁剪层：铺满手机这块屏、挂进屏里。挂屏内是为了和手机页同处一个层叠上下文
  // （挂 body 上会比层级，结果被网格盖住）；层自己 overflow 裁掉越界，幽灵才不会跑出屏
  const layer = document.createElement('div');
  layer.className = 'phone-drag-layer';
  box.appendChild(layer);
  const g = document.createElement('div');
  g.className = 'phone-drag-ghost';
  const icon = tile.querySelector('.phone-app-icon');
  if (icon) g.appendChild(icon.cloneNode(true));
  layer.appendChild(g);
  st.ghost = g;
  st.layer = layer;
  return g;
}

function moveGhost(px, py) {
  const st = _drag;
  if (!st?.ghost || !st.layer) return;
  // 幽灵的 left/top 是相对层（= 这块屏）的逻辑像素。指针是屏幕坐标，而 main.js 把 console 内的
  // getBoundingClientRect 整体换算成了机身逻辑坐标，所以指针要先用 viewportToLogic 拉回同一套再相减
  const r = st.layer.getBoundingClientRect();
  const p = viewportToLogic(px, py);
  st.ghost.style.left = `${p.x - r.left}px`;
  st.ghost.style.top = `${p.y - r.top}px`;
}

// 清掉落点提示：合并描边、空位高亮
function clearCues() {
  const view = $('phoneView');
  if (!view) return;
  view.querySelectorAll('.drag-into').forEach((n) => n.classList.remove('drag-into'));
  view.querySelectorAll('.cue-on').forEach((n) => n.classList.remove('cue-on'));
}

// 拖拽被打断时兜底复位（切后台丢 pointerup、绘制打断），别让桌面卡在拖不动的状态
function resetDrag() {
  if (!_drag) return;
  clearTimeout(_drag.dwell);
  _drag.tile.classList.remove('dragging');
  _drag.layer?.remove();
  _drag = null;
  _dragging = false;
  hideNewPageTip();
  showEdgeTip(0);
  clearCues();
}

// 一页的网格几何：5 列 2 行等分，padding/gap 直接读计算样式，别写死数字。
// 与位置无关的量按元素缓存，指针每动一下都要用，免得反复触发样式计算
let _grid = null;
function pageGrid(pageEl) {
  if (_grid?.el === pageEl) return _grid;
  const cs = getComputedStyle(pageEl);
  const r = pageEl.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const gx = parseFloat(cs.columnGap) || 0;
  const gy = parseFloat(cs.rowGap) || 0;
  const cw = (r.width - padL - (parseFloat(cs.paddingRight) || 0) - gx * 4) / 5;
  const ch = (r.height - padT - (parseFloat(cs.paddingBottom) || 0) - gy) / 2;
  _grid = { el: pageEl, padL, padT, gx, gy, cw, ch };
  return _grid;
}
// 指针落在哪一页的哪一格。按格子算而不是"最近的图标"：空格也要认，
// 不然落在空位上会被算成紧挨着的那个图标，落点就跑了
function targetSlotAt(x, y) {
  const pageEl = document.elementFromPoint(x, y)?.closest('.phone-page');
  if (!pageEl) return null;
  const pi = Number(pageEl.dataset.page);
  const g = pageGrid(pageEl);
  if (g.cw <= 0 || g.ch <= 0) return { p: pi, i: 0 };
  const r = pageEl.getBoundingClientRect();
  // 指针是视口坐标、rect 是机身逻辑坐标：先 viewportToLogic 拉回同一套再比
  const p = viewportToLogic(x, y);
  const col = Math.max(0, Math.min(4, Math.floor((p.x - r.left - g.padL) / (g.cw + g.gx))));
  const row = Math.max(0, Math.min(1, Math.floor((p.y - r.top - g.padT) / (g.ch + g.gy))));
  return { p: pi, i: row * 5 + col };   // 每页固定 10 格，格号就是落点
}
// 指针贴着左右边缘：翻页 zones。指针拉回机身逻辑坐标再和 rect 比
function edgeAt(x, y) {
  const pagesEl = $('phonePages');
  if (!pagesEl) return null;
  const r = pagesEl.getBoundingClientRect();
  if (!r.width) return null;
  const p = viewportToLogic(x, y);
  if (p.y < r.top || p.y > r.bottom) return null;
  if (p.x <= r.left + EDGE_ZONE) return -1;
  if (p.x >= r.right - EDGE_ZONE) return 1;
  return 0;
}
function showNewPageTip() {
  if ($('phoneNewPageTip')) return;
  const el = document.createElement('div');
  el.id = 'phoneNewPageTip';
  el.className = 'phone-newpage-tip';
  el.textContent = '松手：新建一页';
  $('phoneContent')?.appendChild(el);
}
function hideNewPageTip() { $('phoneNewPageTip')?.remove(); }

// 贴边翻页提示：手指停在边缘区时亮起，告诉玩家再停一下就翻页
function showEdgeTip(side) {
  const host = $('phoneContent');
  if (!host) return;
  let el = $('phoneEdgeTip');
  if (!side) { el?.classList.remove('on'); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'phoneEdgeTip';
    el.className = 'phone-edge-tip';
    host.appendChild(el);
  }
  el.classList.toggle('left', side < 0);
  el.classList.toggle('right', side > 0);
  el.classList.add('on');
}

// 贴边翻页：指针停进左右边缘区就亮提示并开始计时。计时只认"在不在边缘区"——
// 在边缘区里怎么挪都不重新计时，免得提示亮着却迟迟不翻；离开边缘（或换到另一边）才重置
function updateEdgeFlip(st, x, y) {
  const edge = edgeAt(x, y) || 0;
  if (edge === st.dwellDir) return;   // 还在同一边：已有的计时继续跑
  st.dwellDir = edge;
  st.newPage = false;
  clearTimeout(st.dwell);
  st.dwell = 0;
  hideNewPageTip();
  showEdgeTip(0);
  if (!edge) return;
  const host = $('phoneContent');
  const page = host?._pageNow?.() ?? 0;
  const count = host?._pageCount?.() ?? 1;
  if (edge > 0 ? page >= count - 1 : page <= 0) {
    if (edge > 0) { st.newPage = true; showNewPageTip(); }   // 最后一页右边缘：提示松手新建一页
    return;
  }
  showEdgeTip(edge);
  const flip = () => {
    if (_drag !== st || st.dwellDir !== edge) return;
    const h = $('phoneContent');
    const p = h?._pageNow?.() ?? 0;
    const c = h?._pageCount?.() ?? 1;
    if (edge > 0 ? p >= c - 1 : p <= 0) return;   // 翻到头了，停
    h?._gotoPage?.(p + edge);
    st.dwell = setTimeout(flip, FLIP_COOLDOWN_MS);   // 翻过一页进冷却：手指不移开就不会马上再翻
  };
  st.dwell = setTimeout(flip, CUE_DWELL_MS);
}

// 指针底下是哪个图标（被拖起来那格不算）；落在图标之间的缝里，就认缝边上最近的那个
function tileUnderAt(x, y) {
  const hit = document.elementFromPoint(x, y)?.closest('.phone-app');
  if (hit && hit !== _drag.tile && hit.dataset.slot) return hit;
  const pageEl = document.elementFromPoint(x, y)?.closest('.phone-page');
  if (!pageEl) return null;
  const p = viewportToLogic(x, y);   // 视口 → 机身逻辑，和 rect 同一套
  let best = null, bestD = Infinity;
  for (const el of pageEl.children) {
    if (el === _drag.tile || !el.classList.contains('phone-app') || !el.dataset.slot) continue;
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    // 点到矩形的距离：落在框内算 0
    const dx = Math.max(r.left - p.x, 0, p.x - r.right);
    const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = el; }
  }
  return best && bestD <= TILE_SNAP_PX ? best : null;
}

// 拖拽中就地换位：数组和 DOM 位置一起换，画面立刻重排（松手时位置已经对了，不用再落点）。
// 同页、跨页都走这里；从合集窗口拖出来仍按松手落点走
function swapInPlace(st, pos) {
  const P = pages();
  const srcPage = P[st.from.p];
  const dstPage = P[pos.p];
  if (!srcPage || !dstPage || !dstPage[pos.i] || srcPage[st.from.i] == null) return;
  const tileA = st.tile;
  const tileB = $('phoneView')?.querySelector(`.phone-app[data-slot="${slotKey(pos.p, pos.i)}"]`);
  if (!tileA || !tileB || tileA === tileB) return;
  const from = { p: st.from.p, i: st.from.i };
  const tmp = srcPage[from.i];
  srcPage[from.i] = dstPage[pos.i];
  dstPage[pos.i] = tmp;
  // DOM 顺序跟着换：两边各占一个位再对插，跨页（父节点不同）也成立
  const mkA = document.createComment('');
  tileA.parentNode.insertBefore(mkA, tileA);
  const mkB = document.createComment('');
  tileB.parentNode.insertBefore(mkB, tileB);
  mkB.parentNode.insertBefore(tileA, mkB);
  mkA.parentNode.insertBefore(tileB, mkA);
  mkA.remove();
  mkB.remove();
  // 槽位属性跟着走，不然后面按 data-slot 找人会找错
  for (const [el, p, i] of [[tileA, pos.p, pos.i], [tileB, from.p, from.i]]) {
    const k = slotKey(p, i);
    el.dataset.slot = k;
    if (el.dataset.folder) el.dataset.folder = k;
  }
  st.from = { p: pos.p, i: pos.i };
  st.swapped = true;
  st.mode = `slot:${slotKey(pos.p, pos.i)}`;   // 换完了指针底下就是自己这格：松手时按它短路，别又换回去
  paintCue(st);
}

// 指针是不是真的压在某个图标上（严格命中，不算缝隙容差）。换位只认它：
// 交换完指针正好落在自己那格的空洞上，严格命中必然失败，天然挡住交界上来回闪
function tilePressedAt(el) {
  const tile = el?.closest('.phone-app');
  return tile && tile !== _drag.tile && tile.dataset.slot ? tile : null;
}

// 当前指针落在哪类落点（只采样，不改状态）：合集窗口 > 已锁定的合并目标 > 某一格。
// 贴边翻页不掺在这儿：它自己有计时，见 updateEdgeFlip
function cueModeAt(x, y, el) {
  if (el?.closest('.phone-folder-box')) return 'box';
  if (_drag?.armed) return `icon:${_drag.armed.key}`;   // 已认下合并：指针没离开就一直保持
  const pos = targetSlotAt(x, y);
  return pos ? `slot:${slotKey(pos.p, pos.i)}` : null;   // 格号就是落点，落在空位上也算
}

// 落点：快甩到图标上 = 准备合并（描边锁定，指针不离开就不拆）；慢速压在图标上 = 和它换位；
// 其余按指针当前所在立刻认。松手用的就是这个 mode，不能让它停在"等待确认"上
function updateDropCue(x, y) {
  const st = _drag;
  st.pt = { x, y };
  const now = performance.now();
  const el = document.elementFromPoint(x, y);
  const under = tileUnderAt(x, y);
  // 合并锁定态：刚甩过的落在某个图标上就认下；之后只要指针还在这个图标上，慢慢挪、停下都不拆。
  // 判定用元素命中而不是算矩形：矩形和指针坐标在缩放的机身上容易对不齐
  if (st.armed) {
    if (under !== st.armed.el) { st.armed = null; st.mode = ''; paintCue(st); }   // 离开 = 拆开，回到换位判定
  } else if (under && now - st.fastAt <= FAST_HOLD_MS) {
    st.armed = { key: under.dataset.slot, el: under };
  }
  // 没进合并态就跟着指针就地换位：拖到谁身上就和谁换（同页跨页都换，落点那格和源格互换，别的不动）。
  // 只认严格命中，落在图标之间的缝里不算 —— 那正是两个图标左右闪的来源
  const pressed = tilePressedAt(el);
  if (!st.armed && !st.inFolder && st.from && pressed) {
    const pos = parseSlot(pressed.dataset.slot);
    if (pos.p !== st.from.p || pos.i !== st.from.i) { swapInPlace(st, pos); return; }
  }
  updateEdgeFlip(st, x, y);
  const mode = cueModeAt(x, y, el);
  if (mode === st.mode) return;
  st.mode = mode || '';   // 统一成字符串：没落点时也不能是 null，后面到处按字符串用
  paintCue(st);
}

function paintCue(st) {
  clearCues();
  if (!st.mode) return;
  if (st.mode === 'box') {
    $('phoneFolderMask')?.querySelector('.phone-folder-box')?.classList.add('drag-into');
    return;
  }
  const key = st.mode.replace(/^\w+:/, '');
  const el = $('phoneView')?.querySelector(`[data-slot="${key}"]`);
  if (!el) return;
  // 落点那格亮起来：空位本身就是方形虚线框，加 cue-on 让它实心显眼；实体图标则描一圈边
  el.classList.add(el.classList.contains('phone-blank') ? 'cue-on' : 'drag-into');
}

// 合集容量溢出：多的落回桌面最近的空位；只剩 1 个（或 0 个）时合集解散，剩下的回原格
function addToFolder(folder, ids) {
  const P = pages();
  folder.folder.push(...ids);
  while (folder.folder.length > FOLDER_MAX) {
    placeAt(P, P.length - 1, 0, { app: folder.folder.pop() });
  }
}
function dissolveIfLone(folder, at) {
  if (!folder?.folder || folder.folder.length > 1) return;
  const page = pages()[at.p];
  if (!page || page[at.i] !== folder) return;
  const rest = folder.folder[0];
  page[at.i] = rest ? { app: rest } : null;   // 散开占回原格；空了就留个洞
}

function applyDrop(st, dst) {
  if (!dst?.kind) return;
  const P = pages();
  // 拖回原来那一格：什么都不做
  if (dst.kind === 'slot' && !st.inFolder && st.from.p === dst.p && st.from.i === dst.i) return;
  const dstPage = dst.p != null ? (P[dst.p] || null) : null;
  const targetEntry = (dst.kind === 'icon' || dst.kind === 'intoFolder') ? itemAt(dst.p, dst.i) : null;
  // —— 取出源：只把自己那格清成洞，后面谁都不动
  let entry;
  let srcPage = null;   // 源页：目标那格的东西要回到源格
  if (st.inFolder) {
    const f = itemAt(st.inFolder.p, st.inFolder.i);
    if (!f?.folder || !f.folder.includes(st.id)) return;
    entry = { app: st.id };
    f.folder = f.folder.filter((x) => x !== st.id);
    dissolveIfLone(f, st.inFolder);
  } else {
    entry = itemAt(st.from.p, st.from.i);
    if (!entry) return;
    srcPage = P[st.from.p];
    srcPage[st.from.i] = null;
  }
  // —— 放进去
  if (dst.kind === 'newpage') {
    P.push(freshPage(entry));
    _pageIdx = P.length - 1;                     // 重绘后停在新页
  } else if (dst.kind === 'intoFolder' && targetEntry?.folder) {
    addToFolder(targetEntry, entry.app ? [entry.app] : entry.folder);
  } else if (dst.kind === 'icon' && targetEntry) {
    const at = findSlot(targetEntry);
    if (!at) P.push(freshPage(entry));
    else if (targetEntry.folder) addToFolder(targetEntry, entry.app ? [entry.app] : entry.folder);
    else if (entry.app) P[at.p][at.i] = { folder: [targetEntry.app, entry.app] };   // 应用落到应用上：合成合集
    else placeAt(P, at.p, at.i, entry);                                            // 合集落到图标上：塞进最近的空位
  } else if (dst.kind === 'slot') {
    const pi = dstPage ? P.indexOf(dstPage) : -1;
    if (pi < 0) { P.push(freshPage(entry)); }
    else {
      const page = P[pi];
      const tmp = page[dst.i];
      page[dst.i] = entry;
      if (tmp != null) {
        // 落点有东西：换位，把它挪到源格（同页/跨页都是回源格，源格刚清空）
        if (st.inFolder) addToFolder(itemAt(st.inFolder.p, st.inFolder.i), tmp.app ? [tmp.app] : tmp.folder);
        else srcPage[st.from.i] = tmp;
      }
      // 落点是空位：直接占上，别人一个都不动
    }
  } else return;
  saveGame();
  closeFolderWindow();   // 合集内容变了，窗口重开一次才准
  paintPhoneHome($('phoneContent'));
}

