// ===== 手机主页（主菜单） =====
// 标题栏"手机"按钮进入，内含多个应用。
import { $, showView, renderIncubatorView, updateIncubatorBadge } from './ui.js';
import { pushNav, anyIncubatorReady } from './state.js';
import { hasTradableOffers, ensureTrades } from './trade.js';
import { hasDryBerries } from './berry.js';
import { hasClaimableAchievements } from './achievements.js';
import { hasUnclaimedTutorialRewards } from './views.js';
import { getNowPlaying } from './audio.js';

const APPS = [
  { id: 'gps',  icon: 'icon-gps',  name: '导航' },
  { id: 'book', icon: 'icon-book', name: '图鉴' },
  { id: 'roster', icon: 'icon-owned', name: '宝可梦' },
  { id: 'trade', icon: 'icon-trade', name: '交换' },
  { id: 'incubator', icon: 'icon-egg', name: '孵蛋器' },
  { id: 'berry', icon: 'icon-tree', name: '农场' },
  { id: 'mixer', icon: 'icon-mixer', name: '混合器' },
  { id: 'achievement', icon: 'icon-achievement', name: '成就' },
  { id: 'data', icon: 'icon-data', name: '统计' },
  { id: 'tutorial', icon: 'icon-tutorial', name: '教程' },
  // 第二页：日志 + 训练 + 配队 + 对战
  { id: 'log', icon: 'icon-log', name: '日志' },
  { id: 'nursery', icon: 'icon-heart', name: '饲育屋' },
  { id: 'train', icon: 'icon-train', name: '训练' },
  { id: 'team', icon: 'icon-edit', name: '配队' },
  { id: 'battle', icon: 'icon-versus', name: '对战' },
  { id: 'casino', icon: 'icon-casino', name: '游戏厅' },
  { id: 'album', icon: 'icon-album', name: '卡册' },
  { id: 'follower', icon: 'icon-follower', name: '随从' },
];

// 每页 App 数量（5 列 × 2 行）
const PAGE_SIZE = 10;

// 打开孵蛋器应用（从手机进入，返回回到手机主页；全局快捷键 F 也走这里）
export function showIncubatorView() {
  pushNav('incubatorView');
  showView('incubatorView');
  renderIncubatorView();
}

// 手机主页红点：有可交换的宝可梦（交换）/ 有干涸树果（农场）
// 每次直接设置 display：手机页每次重绘都会重建红点节点，缓存状态会漏刷。
function updateTradeBadge() {
  const badge = $('phone-badge-trade');
  if (!badge) return;
  ensureTrades(); // 波次过期时先刷新，红点反映最新一波（新一波无可交换则熄灭）
  badge.style.display = hasTradableOffers() ? '' : 'none';
}
function updateBerryBadge() {
  const badge = $('phone-badge-berry');
  if (badge) badge.style.display = hasDryBerries() ? '' : 'none';
}
// 成就应用红点：有未领取的成就奖励即点亮
function updateAchievementBadge() {
  const badge = $('phone-badge-achievement');
  if (badge) badge.style.display = hasClaimableAchievements() ? '' : 'none';
}
// 教程应用红点：有未领取的教程章节奖励即点亮
function updateTutorialBadge() {
  const badge = $('phone-badge-tutorial');
  if (badge) badge.style.display = hasUnclaimedTutorialRewards() ? '' : 'none';
}

// 标题栏手机图标聚合红点：任意 app 有红点（孵蛋完成/可交换/干涸树果/成就可领/教程奖励可领）即点亮
function updatePhoneBadge() {
  const badge = $('title-badge-phone');
  if (!badge) return;
  ensureTrades(); // 波次过期先刷新，保证与交换红点口径一致
  badge.style.display = (anyIncubatorReady() || hasTradableOffers() || hasDryBerries() || hasClaimableAchievements() || hasUnclaimedTutorialRewards()) ? '' : 'none';
}
export { updateTradeBadge, updateBerryBadge, updateAchievementBadge, updateTutorialBadge, updatePhoneBadge };

// 状态变化时即时刷新红点：树果浇水/收获/种植、仓库宝可梦变化（捕获/孵化/交换）、交换波次刷新、成就领取，无需等 5 秒轮询
window.addEventListener('berry-farm-changed', () => { updateBerryBadge(); updatePhoneBadge(); });
window.addEventListener('roster-changed', () => { updateTradeBadge(); updatePhoneBadge(); });
window.addEventListener('trade-wave-changed', () => { updateTradeBadge(); updatePhoneBadge(); });
window.addEventListener('achievements-changed', () => { updateAchievementBadge(); updatePhoneBadge(); });
window.addEventListener('tutorial-rewards-changed', () => { updateTutorialBadge(); updatePhoneBadge(); });

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
  if (!info.title || !info.playing) {
    if (pv) pv.classList.remove('has-music');
    return;
  }
  if (pv) pv.classList.add('has-music');
  const titleEl = $('phoneMusicTitle');
  if (titleEl && titleEl.textContent !== info.title) titleEl.textContent = info.title;
  // 歌名超出容器宽度时启动滚动动画，滚动距离按实际溢出量计算
  const wrap = $('phoneMusicTitleWrap');
  if (wrap && titleEl) {
    const overflow = titleEl.scrollWidth > wrap.clientWidth;
    wrap.classList.toggle('scrolling', overflow);
    if (overflow) wrap.style.setProperty('--marquee', (wrap.clientWidth - titleEl.scrollWidth) + 'px');
  }
  const eq = $('phoneMusicEq');
  if (eq) eq.classList.toggle('on', info.playing);
}

export function showPhoneView() {
  pushNav('phoneView'); // 手机主页入栈：返回逐级回挂机页
  startClock();
  const el = $('phoneContent');
  // 分页：每页 PAGE_SIZE 个 App，横排平移翻页
  const pages = [];
  for (let i = 0; i < APPS.length; i += PAGE_SIZE) pages.push(APPS.slice(i, i + PAGE_SIZE));
  el.innerHTML = `
    <div class="phone-pages" id="phonePages">
      ${pages.map(page => `
        <div class="phone-page">
          ${page.map(a => `
            <div class="phone-app" data-app="${a.id}">
              <div class="phone-app-icon"><svg><use xlink:href="#${a.icon}"/></svg>
                ${['incubator', 'trade', 'berry', 'achievement', 'tutorial'].includes(a.id) ? `<span class="phone-app-badge" id="phone-badge-${a.id}" style="display:none;"></span>` : ''}
              </div>
              <div class="phone-app-name">${a.name}</div>
            </div>`).join('')}
        </div>`).join('')}
    </div>
    ${pages.length > 1 ? `<div class="phone-dots">${pages.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}" data-page="${i}"></span>`).join('')}</div>` : ''}`;
  // 渲染后同步红点（页面重建后需重新应用）
  updateIncubatorBadge();
  updateTradeBadge();
  updateBerryBadge();
  updateAchievementBadge();
  updateTutorialBadge();
  updatePhoneBadge();
  // 翻页：页码指示点点击 + 原生 scroll-snap 横向滑动
  let _page = 0;
  const pagesEl = $('phonePages');
  const gotoPage = (i) => {
    _page = Math.max(0, Math.min(pages.length - 1, i));
    // scroll-snap 容器按整页宽度吸附，浏览器原生计算，无需手动换算 padding/宽度
    pagesEl.scrollTo({ left: _page * pagesEl.clientWidth, behavior: 'smooth' });
    el.querySelectorAll('.phone-dots .dot').forEach((d, di) => d.classList.toggle('active', di === _page));
  };
  el.querySelectorAll('.phone-dots .dot').forEach(d => {
    d.addEventListener('click', () => gotoPage(Number(d.dataset.page)));
  });
  // 触摸滑动翻页由 scroll-snap 原生处理；监听 scroll 结束同步页码圆点
  pagesEl.addEventListener('scroll', () => {
    const idx = Math.round(pagesEl.scrollLeft / (pagesEl.clientWidth || 1));
    if (idx !== _page) {
      _page = idx;
      el.querySelectorAll('.phone-dots .dot').forEach((d, di) => d.classList.toggle('active', di === _page));
    }
  }, { passive: true });
  // 鼠标滚轮翻页（桌面端）：纵向滚轮映射为横向翻页，带节流防连翻
  let _wheelLock = 0;
  pagesEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; // 横向滚轮交给原生滚动
    e.preventDefault();
    const now = Date.now();
    if (now - _wheelLock < 400) return;
    _wheelLock = now;
    gotoPage(_page + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  // 事件委托：点击应用进入对应页面
  el.onclick = (e) => {
    const app = e.target.closest('.phone-app');
    if (!app) return;
    const id = app.dataset.app;
    if (id === 'gps') import('./gps.js').then(m => { pushNav('gpsView'); m.showGpsView(); });
    else if (id === 'data') import('./views.js').then(m => m.showDataView());
    else if (id === 'achievement') import('./views.js').then(m => m.showAchievementView());
    else if (id === 'book') import('./pokedex.js').then(m => m.showPokedex());
    else if (id === 'incubator') showIncubatorView();
    else if (id === 'roster') import('./roster.js').then(m => m.showRosterView());
    else if (id === 'battle') import('./battle-view.js').then(m => m.showBattleView());
    else if (id === 'team') import('./team.js').then(m => m.showTeamView());
    else if (id === 'train') import('./train.js').then(m => m.showTrainView());
    else if (id === 'nursery') import('./nursery.js').then(m => m.showNurseryView());
    else if (id === 'trade') import('./trade.js').then(m => m.showTradeView());
    else if (id === 'mixer') import('./mixer.js').then(m => m.showMixerView());
    else if (id === 'berry') import('./berry.js').then(m => m.showBerryView());
    else if (id === 'log') import('./views.js').then(m => m.showSystemLogs());
    else if (id === 'tutorial') import('./views.js').then(m => m.showTutorialView());
    else if (id === 'casino') import('./casino.js').then(m => m.showCasinoView());
    else if (id === 'album') import('./album.js').then(m => m.showAlbumView());
    else if (id === 'follower') import('./follower.js').then(m => m.showFollowerView());
  };
  showView('phoneView');
}

// 调试：打印手机主页布局几何信息（浏览器端/Tauri 端对比用）。
// 用法：进入手机主页后，在控制台执行 window.__dumpPhoneLayout()
window.__dumpPhoneLayout = () => {
  const info = (el, name) => {
    if (!el) return { name, missing: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      name,
      offset: [el.offsetWidth, el.offsetHeight],
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      display: cs.display,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      padding: cs.padding,
    };
  };
  const out = {
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    console: info(document.querySelector('.console'), 'console'),
    screen: info(document.querySelector('.screen'), 'screen'),
    screenInner: info(document.getElementById('screenInner'), 'screenInner'),
    phoneView: info(document.getElementById('phoneView'), 'phoneView'),
    phoneClock: info(document.getElementById('phoneClock'), 'phoneClock'),
    phoneClockDate: info(document.getElementById('phoneClockDate'), 'phoneClockDate'),
    phoneClockTime: info(document.getElementById('phoneClockTime'), 'phoneClockTime'),
    phoneContent: info(document.getElementById('phoneContent'), 'phoneContent'),
    phonePages: info(document.getElementById('phonePages'), 'phonePages'),
    pages: [...document.querySelectorAll('.phone-page')].map((p, i) => {
      const r = p.getBoundingClientRect();
      return { page: i, offset: [p.offsetWidth, p.offsetHeight], rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
    }),
    apps: [...document.querySelectorAll('.phone-app')].map((a, i) => {
      const r = a.getBoundingClientRect();
      const icon = a.querySelector('.phone-app-icon');
      return { idx: i, name: a.querySelector('.phone-app-name')?.textContent, offset: [a.offsetWidth, a.offsetHeight], rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], iconOffset: icon ? [icon.offsetWidth, icon.offsetHeight] : null };
    }),
  };
  console.log('[PHONE-DUMP]', JSON.stringify(out, null, 2));
  return out;
};
