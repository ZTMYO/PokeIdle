// ===== 全服事件页（手机桌面的 app，单独一屏） =====
// 一条竖直时间轴：左侧大量出没、右侧时空扭曲，每个事件是一根"有长度的条"——
// 条长＝持续时间；两侧处在同一段纵向位置，就是这两类事件的时间段重叠，一眼能看出来。
// 数据就是游戏在拉的 /api/events/ 排期，拉不到（离线）时整页显示"还没有排期"。
import { $, showView, tryLoadImage } from './ui.js';
import { pushNav, getRoadNumForEdge } from './state.js';
import { REGION_CYCLE } from './config.js';
import { allSlots, hasSchedule, serverNow } from './server-events.js';
import { pokeOfSlot, spotOfSlot } from './events.js';
import { eventMapSvg, navigateToNearestEnd, showGpsView } from './gps.js';
import { fetchPresenceStats } from './telemetry.js';

const WIN_HOURS = 6;       // 只画从现在起 6 小时
const PX_PER_HOUR = 50;     // 时间轴比例
const MIN_BAR_H = 14;       // 太短的事件也要放得下一行字
let _presence = null;      // 打开页面时拉到的在线/事件人数
let _liveTimer = null;     // 中间人数轮播

// 标题右侧导航图标（纸飞机样式），与悬赏页同款
const GO_ICON = '<svg viewBox="0 0 1024 1024" width="13" height="13" aria-hidden="true"><path d="M123.92 555.9a32 32 0 0 1-14.82-60.38l719.19-374.9a32 32 0 0 1 29.59 56.76l-719.2 374.89a31.87 31.87 0 0 1-14.76 3.63z"/><path d="M608.6 957.7a32 32 0 0 1-30.6-41.27l234.64-776.34a32 32 0 0 1 61.26 18.52L639.22 935a32 32 0 0 1-30.62 22.7zM505.92 580.44c-0.68 0-1.36 0-2.05-0.07l-381.46-24.12a32 32 0 1 1 4-63.88l381.5 24.13a32 32 0 0 1-2 63.94z"/><path d="M608.14 957.32a32 32 0 0 1-30.87-23.63L475 556.82a32 32 0 1 1 61.77-16.76L639 916.93a32 32 0 0 1-22.51 39.26 31.61 31.61 0 0 1-8.35 1.13z"/></svg>';

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 老外壳里没有这个页面容器，自己补一个
function ensureEventsView() {
  let view = $('eventsView');
  if (!view) {
    const host = $('phoneView')?.parentElement;
    if (!host) return null;
    view = document.createElement('div');
    view.id = 'eventsView';
    view.className = 'view-fixed view-list';
    view.style.display = 'none';
    const content = document.createElement('div');
    content.id = 'eventsContent';
    content.className = 'list-scroll';
    view.appendChild(content);
    host.appendChild(view);
  }
  view.style.position = 'relative';   // 位置弹框按它定位，只盖这一屏
  return view;
}

export function showEventsView() {
  if (!ensureEventsView()) return;
  pushNav('eventsView');
  showView('eventsView');
  renderEventsView();
  loadPresence();   // 只在打开页面时拉一次，之后不轮询
  if (showEventsView._t) clearInterval(showEventsView._t);
  showEventsView._t = setInterval(() => {   // 停留期间让"现在"和条的位置跟着走
    if ($('eventsView')?.style.display === 'none') { clearInterval(showEventsView._t); showEventsView._t = null; return; }
    renderEventsView();
  }, 60000);
}

async function loadPresence() {
  const p = await fetchPresenceStats();
  if (!p) return;
  _presence = p;
  if ($('eventsView')?.style.display !== 'none') paintLive();
}

// 中间那格：只轮播当前正在开的事件 + 在线人数
function paintLive() {
  clearInterval(_liveTimer);
  _liveTimer = null;
  const el = $('evpLive');
  if (!el) return;
  const now = serverNow();
  const slotOf = (kind) => allSlots(kind).find((s) => now >= s.from && now < s.to);
  const massSlot = slotOf('mass');
  const twistSlot = slotOf('twist');
  const items = [];
  if (massSlot && Number.isFinite(_presence?.mass) && String(_presence.massFrom) === String(massSlot.from)) {
    items.push({ cls: 'mass', text: `${_presence.mass} 人正在大量出没` });
  }
  if (twistSlot && Number.isFinite(_presence?.twist) && String(_presence.twistFrom) === String(twistSlot.from)) {
    items.push({ cls: 'twist', text: `${_presence.twist} 人正在时空扭曲` });
  }
  if (Number.isFinite(_presence?.online)) items.push({ cls: 'online', text: `${_presence.online} 人在线` });
  if (!items.length) { el.textContent = ''; return; }
  let i = 0;
  const show = () => {
    const it = items[i++ % items.length];
    el.textContent = it.text;
    el.className = `evp-live ${it.cls}`;
    void el.offsetWidth;   // 重播淡入
    el.classList.add('in');
  };
  show();
  if (items.length > 1) {
    _liveTimer = setInterval(() => {
      if ($('eventsView')?.style.display === 'none') { clearInterval(_liveTimer); _liveTimer = null; return; }
      show();
    }, 4000);
  }
}

function renderEventsView() {
  const box = $('eventsContent');
  if (!box) return;
  if (!hasSchedule()) {
    clearInterval(_liveTimer);
    _liveTimer = null;
    box.innerHTML = '<div class="roster-empty">还没有拿到全服排期<br>联网后自动同步</div>';
    return;
  }
  const now = serverNow();
  const end = now + WIN_HOURS * 3600e3;
  const px = (ms) => (ms - now) / 3600e3 * PX_PER_HOUR;   // 时刻 → 纵向像素
  const canvasH = WIN_HOURS * PX_PER_HOUR;
  const running = (kind) => allSlots(kind).some((s) => now >= s.from && now < s.to);   // 这一类的时段正在走
  // 每侧要画的时段：点击时按同样的下标取回原始段
  const lanes = {};
  for (const kind of ['mass', 'twist']) {
    lanes[kind] = allSlots(kind).filter((s) => s.to > now && s.from < end).sort((a, b) => a.from - b.from);
  }

  // 一侧：轴上的一段时长条，从段中点拉一根细线接到文字
  const laneHtml = (kind, side) => {
    return lanes[kind]
      .map((s, i) => {
        const poke = pokeOfSlot(kind, s);
        const species = poke ? (poke.form || poke.name) : '';
        // 已经开始的段：从"现在"往下画到它真正结束，别把过去的那段算进来
        const from = Math.max(0, px(Math.max(s.from, now)));
        const to = Math.min(canvasH, px(s.to));
        const raw = Math.max(MIN_BAR_H, to - from);
        const segTop = from + 1;                // 两端各内缩 1px：挨着的两段之间也留出可见缝隙
        const segH = Math.max(3, raw - 2);
        // 引线锚在段的正中（夹在段内），保证线一定落在这一段上
        const anchor = Math.min(from + raw - 1, Math.max(from + 1, from + raw / 2));
        return `<div class="evp-seg ${kind}" style="top:${segTop.toFixed(1)}px;height:${segH.toFixed(1)}px"></div>`
          + `<div class="evp-item ${side}${s.from <= now ? ' now' : ''}" data-lane="${kind}" data-idx="${i}" data-anchor="${anchor.toFixed(1)}">`
          + `<i class="evp-lead"></i>`
          + `<span class="evp-label">`
          + (poke ? `<span class="evp-row"><img class="evp-icon" data-icon="${poke.icon}" alt=""><span class="evp-poke">${species}</span></span>` : '')
          + `<span class="evp-time">${hhmm(s.from)}–${hhmm(s.to)}</span>`
          + `</span></div>`;
      }).join('');
  };

  box.innerHTML = `<div class="evp-inner">`
    + `<div class="evp-sides"><span class="${running('mass') ? 'on' : ''}">大量出没</span><div class="evp-live" id="evpLive"></div><span class="${running('twist') ? 'on' : ''}">时空扭曲</span></div>`
    + `<div class="evp-canvas" style="height:${canvasH}px">`
    + `<div class="evp-axis mass"></div><div class="evp-axis twist"></div>`
    + `<div class="evp-now"></div>`
    + laneHtml('mass', 'left')
    + laneHtml('twist', 'right')
    + `</div>`;
  paintLive();
  // 位置自适应：先按引线锚点摆，撞上上一个就往下推；引线跟着文字走
  for (const side of ['left', 'right']) {
    let cursor = 0;
    const items = [...box.querySelectorAll(`.evp-item.${side}`)].sort((a, b) => Number(a.dataset.anchor) - Number(b.dataset.anchor));
    for (const el of items) {
      const h = el.offsetHeight;
      const y = Math.max(Number(el.dataset.anchor) - h / 2, cursor, 0);   // 文字以锚点为中心，撞了就往下让
      el.style.top = `${y.toFixed(1)}px`;
      const lead = el.querySelector('.evp-lead');
      if (lead) lead.style.top = `${(Number(el.dataset.anchor) - y).toFixed(1)}px`;   // 引线仍指回锚点
      cursor = y + h + 1;
    }
  }
  // 宝可梦图标：路径含中文，走统一的编码加载
  box.querySelectorAll('img[data-icon]').forEach((img) => tryLoadImage(img, img.dataset.icon));
  // 点时段条：弹小地图看它落在哪条路上
  box.onclick = (e) => {
    const item = e.target.closest('.evp-item');
    if (!item) return;
    const slot = (lanes[item.dataset.lane] || [])[Number(item.dataset.idx)];
    if (slot) openSpotPopup(item.dataset.lane, slot);
  };
}

// 事件位置弹框：位置由排期 pos 换算，与游戏内事件点一致
function openSpotPopup(kind, slot) {
  const view = $('eventsView');
  const spot = spotOfSlot(slot);
  if (!view || !spot) return;
  const poke = pokeOfSlot(kind, slot);
  const name = poke ? (poke.form || poke.name) : '';
  const num = getRoadNumForEdge(spot.edge, spot.t);
  const [ea, eb] = spot.edge;
  const where = num != null ? `${num}#道路`
    : `${REGION_CYCLE[Math.min(ea, eb)]}↔${REGION_CYCLE[Math.max(ea, eb)]}之间的道路`;
  closeSpotPopup();
  const el = document.createElement('div');
  el.id = 'evpMapMask';
  el.className = 'evp-map-mask';
  el.innerHTML = `<div class="evp-map-box">
      <div class="evp-map-head">
        <span class="evp-map-title">${kind === 'twist' ? '时空扭曲' : '大量出没'}${name ? ` · ${name}` : ''}</span>
        <button class="evp-map-go" data-evp-go aria-label="前往最近的一端" title="导航到这条路最近的一端">${GO_ICON}</button>
      </div>
      <div class="evp-map-time">${hhmm(slot.from)}–${hhmm(slot.to)}${slot.from <= serverNow() ? ' · 进行中' : ''}</div>
      <div class="evp-map-svg">${eventMapSvg(spot.edge, spot.t, kind)}</div>
      <div class="evp-map-where">出现位置：${where}</div>
      <div class="evp-map-hint">点击任意处关闭</div>
    </div>`;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-evp-go]')) {
      navigateToNearestEnd(ea, eb);
      showGpsView();
    }
    closeSpotPopup();
  });
  view.appendChild(el);
}

function closeSpotPopup() { $('evpMapMask')?.remove(); }
