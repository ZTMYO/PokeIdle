// ===== GPS 导航（地区图 · 单页面） =====
// 地区按距离矩阵连通：1 单位 = 10 分钟走路；999 = 无直达边；-1 = 两点完全不可通行。
// 当前地区由 GPS 位置决定（默认丰缘）。点击地区按钮可手动导航；开启"漫游"后沿固定
// 漫游路线自动规划下一站。没有目的地时，定位图标在水平轴中央原地上下浮动。
// 推进由主角实际移动驱动（gpsAddDistance），遇敌/钓鱼时道路暂停、导航也随之暂停。
import { $, showView } from './ui.js';
import { gameData, phase, setPrevView, saveGame } from './state.js';
import { REGION_CYCLE, ROAD_SPEED_WALK, PX_PER_METER } from './config.js';
import { isFishing } from './fishing.js';

// 地区距离矩阵（下标与 REGION_CYCLE 一致：0关都 1城都 2丰缘 3神奥 4合众 5卡洛斯 6阿罗拉 7伽勒尔 8帕底亚）
const DIST_MATRIX = [
  [0, 1, 3, 999, 6, 6, 6, 6, 6],
  [1, 0, 3, 3, 6, 6, 6, 6, 6],
  [3, 3, 0, 999, 6, 6, 6, 6, 6],
  [999, 3, 999, 0, 6, 6, 6, 6, 6],
  [6, 6, 6, 6, 0, -1, -1, -1, -1],
  [6, 6, 6, 6, -1, 0, -1, -1, -1],
  [6, 6, 6, 6, -1, -1, 0, -1, -1],
  [6, 6, 6, 6, -1, -1, -1, 0, -1],
  [6, 6, 6, 6, -1, -1, -1, -1, 0],
];
const MIN_PER_UNIT = 10; // 1 单位 = 10 分钟走路
const NO_EDGE = 999;     // 无直达边（可能经由其他地区绕行）
// 1 单位对应的真实移动像素 = 走路速度(px/帧)×60帧/秒×60秒×10分钟
const PX_PER_UNIT = ROAD_SPEED_WALK * 60 * 60 * MIN_PER_UNIT;

// 漫游路线：一条经过全部 9 个地区的固定路线，按距离矩阵的直达边连接成环
// （合众→关都→卡洛斯→城都→阿罗拉→丰缘→伽勒尔→神奥→帕底亚→合众…），
// 漫游开启后沿该路线依次前往下一地区，走完一轮继续循环。
const ROAM_ROUTE = [4, 0, 5, 1, 6, 2, 7, 3, 8];

const PIN_SVG = `<svg viewBox="0 0 24 24" width="20" height="20">
  <path d="M12 1.5a7 7 0 0 0-7 7c0 4.6 5.4 12.1 6.2 13.2a0.9 0.9 0 0 0 1.5 0c0.9-1.1 6.3-8.6 6.3-13.2a7 7 0 0 0-7-7z" fill="currentColor"/>
  <circle cx="12" cy="8.5" r="2.4" fill="var(--console-body)"/>
</svg>`;

// 从距离矩阵提取节点 i 的直达边（跳过自身 / 无直达 / 不可通行）
function edgesOf(i) {
  const edges = [];
  for (let j = 0; j < DIST_MATRIX[i].length; j++) {
    const d = DIST_MATRIX[i][j];
    if (d > 0 && d !== NO_EDGE) edges.push({ to: j, cost: d });
  }
  return edges;
}

// Dijkstra 最短路径（按距离单位），返回地区编号数组
function findPath(fromIdx, toIdx) {
  if (fromIdx === toIdx) return [fromIdx];
  const n = DIST_MATRIX.length;
  const dist = DIST_MATRIX.map((_, i) => (i === fromIdx ? 0 : Infinity));
  const prev = Array(n).fill(null);
  const done = Array(n).fill(false);
  while (true) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    }
    if (u === -1 || best === Infinity || u === toIdx) break;
    done[u] = true;
    for (const { to, cost } of edgesOf(u)) {
      if (!done[to] && dist[u] + cost < dist[to]) {
        dist[to] = dist[u] + cost;
        prev[to] = u;
      }
    }
  }
  if (!isFinite(dist[toIdx])) return [fromIdx, toIdx]; // 不可通行时兜底直连
  const path = [toIdx];
  let p = toIdx;
  while (prev[p] != null) { path.unshift(prev[p]); p = prev[p]; }
  return path;
}

// 漫游路线中的下一站（按环序）
function nextStop(curIdx) {
  const i = ROAM_ROUTE.indexOf(curIdx);
  if (i === -1) return (curIdx + 1) % REGION_CYCLE.length;
  return ROAM_ROUTE[(i + 1) % ROAM_ROUTE.length];
}

// 开启当前路段：总长 = 边距离 × 每单位像素（按真实移动像素推进）
function newSegment() {
  const g = gameData.gps;
  g.units = DIST_MATRIX[g.path[g.seg]][g.path[g.seg + 1]];
  g.totalPx = g.units * PX_PER_UNIT;
  g.remainPx = g.totalPx;
}

// 推进当前路段；路段走完后移到下一站，最终目标到达后停留片刻等下一站
function advanceSegment() {
  const g = gameData.gps;
  if (g.seg < g.path.length - 2) {
    g.seg++;
    g.curIdx = g.path[g.seg];
    newSegment();
  } else {
    g.curIdx = g.path[g.path.length - 1];
    g.arrived = true;
    g.arrivedAt = Date.now();
    render();
  }
}

// 规划前往指定地区的路线（手动选择目的地 / 漫游自动下一站共用）
function planRoute(fromIdx, toIdx) {
  const g = gameData.gps;
  g.curIdx = fromIdx;
  g.destIdx = toIdx;
  g.path = findPath(fromIdx, toIdx);
  g.seg = 0;
  g.arrived = false;
  g.arrivedAt = 0;
  newSegment();
  render();
}

// 主角移动推进：main.js 每秒把道路滚动距离喂进来（px 为真实行走/跑步像素）
export function gpsAddDistance(px, pxPerSec) {
  const g = gameData?.gps;
  if (!g) return;
  // 到达后停留片刻，漫游开启时自动规划下一站（刷新后由本函数兜底续接）
  if (g.roamEnabled && g.arrived && Date.now() - (g.arrivedAt || 0) >= 2200) {
    g.arrived = false;
    planRoute(g.curIdx, nextStop(g.curIdx));
  }
  if (g.destIdx == null || g.arrived || px <= 0) return;
  g.pxPerSec = pxPerSec || ROAD_SPEED_WALK * 60;
  g.remainPx = Math.max(0, g.remainPx - px);
  if (g.remainPx <= 0) { advanceSegment(); return; }
  if ($('gpsView')?.style.display === 'flex') render();
}

// 开启/关闭漫游：开启后若当前无目的地，自动沿漫游路线规划下一站
export function setRoamEnabled(on) {
  const g = gameData.gps;
  g.roamEnabled = !!on;
  if (g.roamEnabled && g.destIdx == null) {
    planRoute(g.curIdx, nextStop(g.curIdx));
  } else {
    render();
  }
  saveGame();
}

// 初始化兜底：环国旅行已开启但没有目的地时，自动规划漫游下一站
// （默认档 roamEnabled=true 但 destIdx=null，进入游戏即自动开始环国之旅）
export function ensureRoamDest() {
  const g = gameData?.gps;
  if (g && g.roamEnabled && g.destIdx == null) {
    planRoute(g.curIdx, nextStop(g.curIdx));
  }
}

// 取消目的地：停止导航回到无目的地状态
export function cancelNavigation() {
  const g = gameData.gps;
  g.roamEnabled = false;
  g.destIdx = null;
  g.path = null;
  g.seg = 0;
  g.units = 0;
  g.totalPx = 0;
  g.remainPx = 0;
  g.arrived = false;
  g.arrivedAt = 0;
  render();
  saveGame();
}

// ---------- 单页渲染 ----------
function render() {
  const g = gameData.gps;
  const el = $('gpsContent');
  const cur = REGION_CYCLE[g.curIdx];
  const hasDest = g.destIdx != null;
  const arrived = hasDest && g.arrived;

  // 共用水平轴：无目的地时指针停在中央原地上下浮动；有目的地时随进度滑动
  let pct = 50;
  if (hasDest) {
    pct = arrived ? 100
      : (g.totalPx > 0 ? Math.max(0, Math.min(100, (1 - g.remainPx / g.totalPx) * 100)) : 100);
  }

  // 剩余真实时间：按当前移动速度（走路/跑步）估算
  const pxPerMin = (g.pxPerSec || ROAD_SPEED_WALK * 60) * 60;
  const remainMin = hasDest ? Math.max(0, Math.ceil(g.remainPx / pxPerMin)) : 0;
  // 剩余距离换算公里
  const remainKm = hasDest ? Math.max(0, g.remainPx / PX_PER_METER / 1000) : 0;
  // 预计到达时刻 = 当前时间 + 剩余分钟，HH:MM 格式
  const arriveStr = hasDest && !arrived ? (() => {
    const d = new Date(Date.now() + remainMin * 60000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  })() : '';
  // 移动暂停原因：遇敌对战 / 钓鱼中，导航推进会随道路一起暂停
  const paused = phase !== 'idle' ? '正在与宝可梦对战，移动暂停'
    : isFishing() ? '正在钓鱼，移动暂停'
    : '';

  el.innerHTML = `
    <div class="gps-wrap">
      <div class="gps-roam-row">
        <span class="gps-roam-label">环国旅行</span>
        <div class="toggle-switch" id="gpsRoamToggle">
          <div class="toggle-track${g.roamEnabled ? ' on' : ''}"></div>
          <div class="toggle-knob"></div>
        </div>
      </div>
      <div class="gps-top" id="gpsDestBtn">
        <span class="gps-from">${cur}</span>
        ${hasDest ? `
          <svg class="gps-arrow" viewBox="0 0 24 24" width="16" height="16">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="gps-dest">${REGION_CYCLE[g.destIdx]}</span>`
        : '<span class="gps-dest gps-dest-none">未设置目的地</span>'}
      </div>
      ${hasDest && !arrived ? '' : '<div class="gps-tip">点击上方选择目的地，或开启环国旅行自动前进。</div>'}
      <div class="gps-axis">
        <div class="gps-axis-track"><div class="gps-axis-fill" style="width:${hasDest ? pct : 0}%"></div></div>
        <div class="gps-axis-pointer" style="left:${pct}%;">${PIN_SVG}</div>
      </div>
      ${paused
        ? `<div class="gps-status">${paused}</div>`
        : hasDest && !arrived ? `<div class="gps-status">当前：${g.path.slice(g.seg).map(i => REGION_CYCLE[i]).join('→')}</div>` : ''}
      <div class="bottom-dock${hasDest ? '' : ' clickable'}">
        ${hasDest ? `
        <span class="gps-bottom-cancel" id="gpsCancelBtn">
          <svg viewBox="0 0 12 12" width="13" height="13"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
          <span class="gps-bottom-cancel-text">退出</span>
        </span>` : ''}
        <span class="gps-bottom-info">
          <span class="gps-bottom-line1">${arrived
            ? `已到达 ${REGION_CYCLE[g.destIdx]}！${g.roamEnabled ? '正在规划下一站…' : ''}`
            : hasDest ? `${remainKm.toFixed(1)}公里 ${remainMin}分`
            : '开始导航'}</span>
          ${hasDest && !arrived ? `<span class="gps-bottom-line2">${arriveStr}到达</span>` : ''}
        </span>
      </div>
    </div>`;
}

// ---------- 目的地弹窗 ----------
function openDestDialog() {
  const g = gameData.gps;
  const list = $('gpsDialogList');
  if (!list) return;
  list.innerHTML = REGION_CYCLE.map((r, i) => `
    <div class="gps-dialog-opt${i === g.curIdx ? ' disabled' : ''}${i === g.destIdx ? ' sel' : ''}" data-region="${i}">
      ${r}${i === g.curIdx ? '（当前）' : ''}
    </div>`).join('');
  $('gpsDialog').classList.add('open');
}

function closeDestDialog() {
  $('gpsDialog').classList.remove('open');
}

export function showGpsView() {
  // 从手机主页进入时返回手机，否则回图鉴
  setPrevView($('phoneView')?.style.display !== 'none' ? 'phoneView' : 'pokedexView');
  render();
  showView('gpsView');
  // 事件委托：漫游开关 + 取消导航 + 点击目的地打开弹窗
  const el = $('gpsContent');
  el.onclick = (e) => {
    const sw = e.target.closest('#gpsRoamToggle');
    if (sw) { setRoamEnabled(!gameData.gps.roamEnabled); return; }
    const cancel = e.target.closest('#gpsCancelBtn');
    if (cancel) { cancelNavigation(); return; }
    if (e.target.closest('.bottom-dock.clickable')) { openDestDialog(); return; }
    if (e.target.closest('#gpsDestBtn')) { openDestDialog(); return; }
  };
  // 弹窗：选择地区 / 关闭 / 点击遮罩关闭
  const dlg = $('gpsDialog');
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('.gps-dialog-close')) { closeDestDialog(); return; }
    const opt = e.target.closest('.gps-dialog-opt');
    if (opt && !opt.classList.contains('disabled')) {
      planRoute(gameData.gps.curIdx, Number(opt.dataset.region));
      saveGame();
      closeDestDialog();
    }
  };
}
