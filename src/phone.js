// ===== 手机主页（主菜单） =====
// 标题栏"手机"按钮进入，内含多个应用。
import { $, showView, renderIncubatorView, updateIncubatorBadge } from './ui.js';
import { phase, setPrevView, anyIncubatorReady } from './state.js';
import { hasTradableOffers, ensureTrades } from './trade.js';
import { hasDryBerries } from './berry.js';

const APPS = [
  { id: 'gps',  icon: 'icon-gps',  name: '导航' },
  { id: 'book', icon: 'icon-book', name: '图鉴' },
  { id: 'roster', icon: 'icon-owned', name: '宝可梦' },
  { id: 'trade', icon: 'icon-trade', name: '交换' },
  { id: 'incubator', icon: 'icon-egg', name: '孵蛋器' },
  { id: 'berry', icon: 'icon-tree', name: '树果农场' },
  { id: 'mixer', icon: 'icon-mixer', name: '混合器' },
  { id: 'data', icon: 'icon-data', name: '统计' },
  { id: 'log', icon: 'icon-log', name: '日志' },
  { id: 'tutorial', icon: 'icon-tutorial', name: '教程' },
];

// 打开孵蛋器应用（从手机进入，返回回到手机主页）
function showIncubatorView() {
  setPrevView('phoneView');
  showView('incubatorView');
  renderIncubatorView();
}

// 手机主页红点：有可交换的宝可梦（交换）/ 有干涸树果（树果农场）
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

// 标题栏手机图标聚合红点：任意 app 有红点（孵蛋完成/可交换/干涸树果）即点亮
function updatePhoneBadge() {
  const badge = $('title-badge-phone');
  if (!badge) return;
  ensureTrades(); // 波次过期先刷新，保证与交换红点口径一致
  badge.style.display = (anyIncubatorReady() || hasTradableOffers() || hasDryBerries()) ? '' : 'none';
}
export { updateTradeBadge, updateBerryBadge, updatePhoneBadge };

// 状态变化时即时刷新红点：树果浇水/收获/种植、仓库宝可梦变化（捕获/孵化/交换）、交换波次刷新，无需等 5 秒轮询
window.addEventListener('berry-farm-changed', () => { updateBerryBadge(); updatePhoneBadge(); });
window.addEventListener('roster-changed', () => { updateTradeBadge(); updatePhoneBadge(); });
window.addEventListener('trade-wave-changed', () => { updateTradeBadge(); updatePhoneBadge(); });

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
  };
  tick();
  setInterval(tick, 1000);
}

export function showPhoneView() {
  setPrevView(phase === 'encounter' ? 'encounterView' : 'idleView');
  startClock();
  const el = $('phoneContent');
  el.innerHTML = `
    <div class="phone-apps">
      ${APPS.map(a => `
        <div class="phone-app" data-app="${a.id}">
          <div class="phone-app-icon"><svg><use xlink:href="./icons/sprites.svg#${a.icon}"/></svg>
            ${['incubator', 'trade', 'berry'].includes(a.id) ? `<span class="phone-app-badge" id="phone-badge-${a.id}" style="display:none;"></span>` : ''}
          </div>
          <div class="phone-app-name">${a.name}</div>
        </div>`).join('')}
    </div>`;
  // 渲染后同步红点（页面重建后需重新应用）
  updateIncubatorBadge();
  updateTradeBadge();
  updateBerryBadge();
  updatePhoneBadge();
  // 事件委托：点击应用进入对应页面
  el.onclick = (e) => {
    const app = e.target.closest('.phone-app');
    if (!app) return;
    const id = app.dataset.app;
    if (id === 'gps') import('./gps.js').then(m => { setPrevView('phoneView'); m.showGpsView(); });
    else if (id === 'data') import('./views.js').then(m => m.showDataView());
    else if (id === 'book') import('./pokedex.js').then(m => m.showPokedex());
    else if (id === 'incubator') showIncubatorView();
    else if (id === 'roster') import('./roster.js').then(m => m.showRosterView());
    else if (id === 'trade') import('./trade.js').then(m => m.showTradeView());
    else if (id === 'mixer') import('./mixer.js').then(m => m.showMixerView());
    else if (id === 'berry') import('./berry.js').then(m => m.showBerryView());
    else if (id === 'log') import('./views.js').then(m => m.showSystemLogs());
    else if (id === 'tutorial') import('./views.js').then(m => m.showTutorialView());
  };
  showView('phoneView');
}
