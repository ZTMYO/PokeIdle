// ===== GPS 导航（地区图 · 单页面） =====
// 地区按距离矩阵连通：1 单位 = 10 分钟走路；999 = 无直达边；-1 = 两点完全不可通行。
// 当前地区由 GPS 位置决定（默认丰缘）。点击地区按钮可手动导航；开启"漫游"后无目的地时
// 沿固定漫游路线自动选择下一站。到达目的地即结束导航（目的地回到"未设置"状态）。
// 没有目的地时，定位图标在水平轴中央原地上下浮动。
// 推进由主角实际移动驱动（gpsAddDistance），遇敌/钓鱼时道路暂停、导航也随之暂停。
import { $, showView, setupFoodTooltip, updateBackpack } from './ui.js';
import { gameData, phase, saveGame, setDistMatrix, getCurrentRoadInfo, getMassOutbreak, getPokemonByIndex, getTwist, inMassZone, inTwistZone, walkedPxOnSegment, normalizeMassRemainToEnd, pushNav } from './state.js';
import { REGION_CYCLE, ROAD_SPEED_WALK, PX_PER_METER } from './config.js';
import { isFishing } from './fishing.js';
import * as road from './road.js';

// 地区距离矩阵（下标与 REGION_CYCLE 一致：0关都 1城都 2丰缘 3神奥 4合众 5卡洛斯 6阿罗拉 7伽勒尔 8帕底亚）
// 陆路全通：按地图可视化的 Delaunay 网络连成 14 条直达边（无交叉、全连通；
// 丰缘-关都、城都-神奥 为原作水路/不直连，已剔除；关都-神奥 为原作直连陆路，手动补上）。
// 距离值 = map.html 各边图上长度等比换算（最短边 关都-城都 = 1 单位；1 单位 = 10 分钟走路）。
// 999 = 无直达边（可绕行）。
const DIST_MATRIX = [
  [0, 1, 999, 1.5, 999, 999, 999, 999, 999],
  [1, 0, 1.7, 999, 999, 4.7, 999, 999, 4.7],
  [999, 1.7, 0, 999, 999, 999, 3.5, 999, 4.3],
  [1.5, 999, 999, 0, 999, 5.4, 999, 999, 999],
  [999, 999, 999, 999, 0, 2.9, 999, 3.6, 2.3],
  [999, 4.7, 999, 5.4, 2.9, 0, 999, 1.4, 1.4],
  [999, 999, 3.5, 999, 999, 999, 0, 999, 3.6],
  [999, 999, 999, 999, 3.6, 1.4, 999, 0, 999],
  [999, 4.7, 4.3, 999, 2.3, 1.4, 3.6, 999, 0],
];
setDistMatrix(DIST_MATRIX); // 注册矩阵给 state.js 计算路段分段编号（1#~28#）
const MIN_PER_UNIT = 10; // 1 单位 = 10 分钟走路
const NO_EDGE = 999;     // 无直达边（可能经由其他地区绕行）
// 1 单位对应的真实移动像素 = 走路速度(px/帧)×60帧/秒×60秒×10分钟
const PX_PER_UNIT = ROAD_SPEED_WALK * 60 * 60 * MIN_PER_UNIT;

// 漫游路线：一条经过全部 9 个地区的固定路线（阿罗拉→丰缘→城都→关都→神奥→卡洛斯→伽勒尔→合众→帕底亚→阿罗拉…），
// 按当前地图（MAP_POS/DIST_MATRIX）布局设计，环上相邻地区均有直达边（无 999 绕行/回走），走完一轮继续循环。
const ROAM_ROUTE = [6, 2, 1, 0, 3, 5, 7, 4, 8];

const PIN_SVG = `<svg viewBox="0 0 24 24" width="20" height="20">
  <path d="M12 1.5a7 7 0 0 0-7 7c0 4.6 5.4 12.1 6.2 13.2a0.9 0.9 0 0 0 1.5 0c0.9-1.1 6.3-8.6 6.3-13.2a7 7 0 0 0-7-7z" fill="currentColor"/>
  <circle cx="12" cy="8.5" r="2.4" fill="var(--console-body)"/>
</svg>`;
const MAP_VIEWBOX = '0 12 320 176';
const MAP_POS = {
  0: [263, 87], 1: [244, 103], 2: [220, 134], 3: [270, 54],
  4: [53, 90], 5: [124, 63], 6: [136, 167], 7: [118, 33], 8: [117, 91],
};
const MAP_LABEL = {
  0: 'right', 1: 'right', 2: 'right', 3: 'right', 4: 'left',
  5: 'tr', 6: 'left', 7: 'left', 8: 'bl',
};

function mapEdgeList() {
  const edges = [];
  for (let i = 0; i < DIST_MATRIX.length; i++) {
    for (let j = i + 1; j < DIST_MATRIX[i].length; j++) {
      const d = DIST_MATRIX[i][j];
      if (d > 0 && d !== NO_EDGE) edges.push([i, j]);
    }
  }
  return edges;
}
export const MAP_EDGES = mapEdgeList();

function lerpPoint(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
}

// 计算定位点当前位置/朝向（与 buildMiniMap 同一套逻辑，供导航推进时增量更新）
function computeMarkerPos(g) {
  const onRoad = !!(g.path && g.path.length >= 2 && g.seg < g.path.length - 1 && g.totalPx > 0);
  const currentRoad = onRoad ? getCurrentRoadInfo() : null;
  const activeA = currentRoad ? g.path[g.seg] : null;
  const activeB = currentRoad ? g.path[g.seg + 1] : null;
  const markerIdx = g.curIdx ?? 2;
  let markerX = MAP_POS[markerIdx][0];
  let markerY = MAP_POS[markerIdx][1];

  if (currentRoad && activeA != null && activeB != null && g.totalPx > 0) {
    // 已走比例：普通路段 = (总长-剩余)/总长；事件边最后一段的 remainPx 是"到事件点的剩余"，
    // 由 walkedPxOnSegment 统一换算成从段起点量起的真实已走像素——定位点从段起点平滑走到事件点，不会跳变
    const p = Math.max(0, Math.min(1, walkedPxOnSegment(g) / g.totalPx));
    [markerX, markerY] = lerpPoint(MAP_POS[activeA], MAP_POS[activeB], p);
  }

  // 有目的地（地区节点或大量出没事件点）时定位针指向当前段目标方向
  const segTarget = (g.destIdx != null || g.massTarget != null) && hasActiveSegment(g) ? g.path[g.seg + 1] : null;
  let markerAngle = 0;
  if (segTarget != null) {
    const [dxp, dyp] = MAP_POS[segTarget];
    // 指针默认尖端朝下（南），SVG rotate 正角为顺时针；
    // 令尖端指向目标方向：atan2(-Δx, Δy)（屏幕 y 轴向下）
    markerAngle = Math.atan2(-(dxp - markerX), dyp - markerY) * 180 / Math.PI;
  }
  const markerUsable = segTarget != null && isFinite(markerAngle);
  return { onRoad, currentRoad, activeA, activeB, markerIdx, markerX, markerY, markerAngle, markerUsable };
}

// 剩余里程/时间（与 render 同一套逻辑，供导航推进时增量更新底部信息）
function computeRouteRemain(g) {
  const hasDest = g.destIdx != null || g.massTarget != null;
  let remainPxTotal = hasDest ? (g.remainPx || 0) : 0;
  if (hasDest && g.path) {
    for (let i = g.seg + 1; i < g.path.length - 1; i++) {
      const segA = g.path[i], segB = g.path[i + 1];
      let segPx = DIST_MATRIX[segA][segB] * PX_PER_UNIT;
      if (g.massTarget && i === g.path.length - 2) {
        const [ea, eb] = g.massTarget.edge;
        const fromA = segPx * g.massTarget.t;
        segPx = (segA === ea && segB === eb) ? fromA : (segPx - fromA);
      }
      remainPxTotal += segPx;
    }
  }
  const pxPerSec = road.getSpeed() * 60;
  const pxPerMin = pxPerSec * 60;
  const remainMin = hasDest ? Math.max(0, Math.ceil(remainPxTotal / pxPerMin)) : 0;
  const remainKm = hasDest ? Math.max(0, remainPxTotal / PX_PER_METER / 1000) : 0;
  const arriveStr = hasDest ? (() => {
    const d = new Date(Date.now() + remainMin * 60000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  })() : '';
  return { hasDest, remainKm, remainMin, arriveStr };
}

// 导航推进时增量更新地图（定位点位置/朝向 + 底部剩余信息），不重建 DOM，
// 避免打断大量出没点扩散圆环等 CSS 动画（整页重建会让动画反复重置）
function updateGpsViewport() {
  if ($('gpsView')?.style.display !== 'flex') return;
  const g = gameData.gps;
  const wrap = $('gpsContent')?.firstElementChild;
  if (!wrap) return;
  const pos = computeMarkerPos(g);
  const marker = wrap.querySelector('.gps-map-marker');
  if (marker) {
    marker.setAttribute('transform',
      `translate(${pos.markerX} ${pos.markerY})${pos.markerUsable ? ` rotate(${pos.markerAngle}) scale(0.35) translate(-20 -15)` : ''}`);
  }
  const info = wrap.querySelector('.gps-bottom-info');
  if (info) {
    const remain = computeRouteRemain(g);
    const pendingBike = g.pendingBike === true;
    info.innerHTML = `<span class="gps-bottom-line1">${remain.hasDest ? `${remain.remainKm.toFixed(1)}公里 ${remain.remainMin}分` : (pendingBike ? '点击地图选择骑行目的地' : '点击地图选择目的地')}</span>`
      + (remain.hasDest ? `<span class="gps-bottom-line2">${remain.arriveStr}到达</span>` : '');
  }
}

function buildMiniMap(g) {
  // 骑行中（已选好目的地）锁定地图：节点/大量出没点不可点击，光标改默认
  const locked = road.isManualBike();
  // 是否在道路中间由物理位置（path 进度）决定，不依赖是否有目的地——
  // 取消导航后仍停留在原物理位置，定位点不跳回出发端节点
  const { onRoad, currentRoad, activeA, activeB, markerIdx, markerX, markerY, markerAngle, markerUsable } = computeMarkerPos(g);

  // 高亮"即将要走"的整条路径：从当前段开始到目的地的所有边（已走过的段不高亮）。
  // 改目的地/过段时 g.path 与 g.seg 变化，render 随实时位置刷新，高亮随之更新。
  // 前往大量出没事件点时同样高亮（destIdx 为 null，但 massTarget 已设置）
  const activeSet = new Set();
  if ((g.destIdx != null || g.massTarget != null) && g.path && g.path.length >= 2) {
    for (let i = g.seg; i < g.path.length - 1; i++) {
      const u = g.path[i], v = g.path[i + 1];
      activeSet.add(`${Math.min(u, v)}-${Math.max(u, v)}`);
    }
  }
  const curSegKey = activeA != null && activeB != null
    ? `${Math.min(activeA, activeB)}-${Math.max(activeA, activeB)}`
    : null;

  // 事件点坐标：从当前导航目标 massTarget 取（大量出没 / 时空扭曲共用，与导航目标一致），
  // 与 massMarkerSvg / twistMarkerSvg 的坐标算法保持一致。
  const massEndKey = (g.massTarget && g.path && g.path.length >= 2)
    ? `${Math.min(g.path[g.path.length - 2], g.path[g.path.length - 1])}-${Math.max(g.path[g.path.length - 2], g.path[g.path.length - 1])}`
    : null;
  const massPt = (() => {
    const mt = g.massTarget;
    if (!mt) return null;
    const [ea, eb] = mt.edge;
    return lerpPoint(MAP_POS[ea], MAP_POS[eb], mt.t);
  })();

  const edgeSvg = MAP_EDGES.map(([a, b]) => {
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    const isActive = activeSet.has(key);
    if (isActive && key === massEndKey && massPt) {
      if (key === curSegKey) {
        const [ax, ay] = MAP_POS[activeA], [bx, by] = MAP_POS[activeB];
        return `
          <line class="gps-map-edge" x1="${ax}" y1="${ay}" x2="${markerX}" y2="${markerY}"></line>
          <line class="gps-map-edge active" x1="${markerX}" y1="${markerY}" x2="${massPt[0]}" y2="${massPt[1]}"></line>
          <line class="gps-map-edge" x1="${massPt[0]}" y1="${massPt[1]}" x2="${bx}" y2="${by}"></line>`;
      }
      const u = g.path[g.path.length - 2];
      const v = g.path[g.path.length - 1];
      return `
        <line class="gps-map-edge active" x1="${MAP_POS[u][0]}" y1="${MAP_POS[u][1]}" x2="${massPt[0]}" y2="${massPt[1]}"></line>
        <line class="gps-map-edge" x1="${massPt[0]}" y1="${massPt[1]}" x2="${MAP_POS[v][0]}" y2="${MAP_POS[v][1]}"></line>`;
    }
    if (isActive && key === curSegKey && activeA != null && activeB != null) {
      const [ax, ay] = MAP_POS[activeA], [bx, by] = MAP_POS[activeB];
      const [mx, my] = [markerX, markerY];
      return `
        <line class="gps-map-edge" x1="${ax}" y1="${ay}" x2="${mx}" y2="${my}"></line>
        <line class="gps-map-edge active" x1="${mx}" y1="${my}" x2="${bx}" y2="${by}"></line>`;
    }
    return `<line class="gps-map-edge${isActive ? ' active' : ''}" x1="${MAP_POS[a][0]}" y1="${MAP_POS[a][1]}" x2="${MAP_POS[b][0]}" y2="${MAP_POS[b][1]}"></line>`;
  }).join('');

  const nodeSvg = REGION_CYCLE.map((name, i) => {
    const [x, y] = MAP_POS[i];
    const isCur = !currentRoad && i === markerIdx;
    const isDest = g.destIdx === i;
    // 标签方位按 MAP_LABEL 配置：水平一侧或 右上(tr)/左下(bl)
    const pos = MAP_LABEL[i] || 'right';
    const dx = pos === 'right' || pos === 'tr' ? 10 : -10;
    const dy = pos === 'bl' ? 14 : pos === 'tr' ? -10 : 3.5;
    const anchor = pos === 'right' || pos === 'tr' ? 'start' : 'end';
    return `
      <g class="gps-map-node${isCur ? ' current' : ''}${isDest ? ' dest' : ''}" data-region="${i}" style="cursor:pointer">
        <circle cx="${x}" cy="${y}" r="${isCur ? 6 : 5}"></circle>
        <text x="${x + dx}" y="${y + dy}" text-anchor="${anchor}">${name}</text>
      </g>`;
  }).join('');

  return `
    <div class="gps-minimap${locked ? ' locked' : ''}">
      <svg viewBox="${MAP_VIEWBOX}" class="gps-minimap-svg" aria-hidden="true">
        ${edgeSvg}
        ${nodeSvg}
        ${massMarkerSvg()}
        ${twistMarkerSvg()}
        <g class="gps-map-marker" transform="translate(${markerX} ${markerY})${markerUsable ? ` rotate(${markerAngle}) scale(0.35) translate(-20 -15)` : ''}">
          ${markerUsable
            ? `<g class="gps-map-pin"><path d="M19.9785 8.35385C21.8358 8.35385 23.6171 9.09168 24.9304 10.405C26.2437 11.7183 26.9815 13.4996 26.9815 15.3569C26.9815 17.2143 26.2437 18.9955 24.9304 20.3089C23.6171 21.6222 21.8358 22.36 19.9785 22.36C18.1211 22.36 16.3399 21.6222 15.0265 20.3089C13.7132 18.9955 12.9754 17.2143 12.9754 15.3569C12.9754 13.4996 13.7132 11.7183 15.0265 10.405C16.3399 9.09168 18.1211 8.35385 19.9785 8.35385ZM35.3415 15.36C35.3415 12.9683 34.7829 10.6096 33.7105 8.47173C32.638 6.33391 31.0812 4.47602 29.164 3.04599C27.2469 1.61597 25.0223 0.653312 22.6675 0.234685C20.3126 -0.183942 17.8926 -0.0469785 15.6 0.634669C13.3074 1.31632 11.2057 2.52382 9.46212 4.16102C7.71855 5.79823 6.38132 7.81991 5.5569 10.0651C4.73248 12.3103 4.44366 14.7169 4.71342 17.0934C4.98319 19.4699 5.8041 21.7506 7.11077 23.7539L18.6031 39.0769C18.7307 39.3329 18.9271 39.5483 19.1703 39.6988C19.4136 39.8494 19.694 39.9291 19.98 39.9291C20.2661 39.9291 20.5464 39.8494 20.7897 39.6988C21.0329 39.5483 21.2293 39.3329 21.3569 39.0769L32.8708 23.7539C34.4215 21.3354 35.3415 18.4615 35.3415 15.36Z" fill="#96D0B9"></path><path d="M20 23C24.4183 23 28 19.4183 28 15C28 10.5817 24.4183 7 20 7C15.5817 7 12 10.5817 12 15C12 19.4183 15.5817 23 20 23Z" fill="#376D56"></path></g>`
            : `<circle cx="0" cy="0" r="3.2"></circle>`}
        </g>
      </svg>
    </div>`;
}

// 大量出没事件点标记：事件活跃时在对应路段中间渲染可点击的闪烁点
function massMarkerSvg() {
  const mo = getMassOutbreak();
  if (!mo) return '';
  const [ea, eb] = mo.edge;
  const [x, y] = lerpPoint(MAP_POS[ea], MAP_POS[eb], mo.t);
  const poke = getPokemonByIndex(mo.pokemon);
  const name = poke ? poke.name : '';
  return `
    <g class="gps-mass-marker" data-mass="1" data-name="${name}" data-remain="${mo.remain}" transform="translate(${x} ${y})" style="cursor:pointer">
      <circle r="8" class="gps-mass-ring"></circle>
      <circle r="3.5" class="gps-mass-dot"></circle>
      <text x="0" y="-13" text-anchor="middle" class="gps-mass-label">大量出没</text>
    </g>`;
}

// 时空扭曲事件点标记：紫色，样式语义与大量出没一致但独立配色
function twistMarkerSvg() {
  const tw = getTwist();
  if (!tw) return '';
  const [ea, eb] = tw.edge;
  const [x, y] = lerpPoint(MAP_POS[ea], MAP_POS[eb], tw.t);
  return `
    <g class="gps-twist-marker" data-twist="1" data-remain="${tw.remain}" transform="translate(${x} ${y})" style="cursor:pointer">
      <circle r="8" class="gps-twist-ring"></circle>
      <circle r="3.5" class="gps-twist-dot"></circle>
      <text x="0" y="-13" text-anchor="middle" class="gps-twist-label">时空扭曲</text>
    </g>`;
}

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

function clearRouteAt(idx) {
  const g = gameData.gps;
  g.curIdx = idx;
  g.destIdx = null;
  g.massTarget = null;
  g.massArrived = false;
  g.path = null;
  g.seg = 0;
  g.units = 0;
  g.totalPx = 0;
  g.remainPx = 0;
}

function hasActiveSegment(g = gameData?.gps) {
  return !!(g && g.path && g.path.length >= 2 && g.seg < g.path.length - 1 && g.totalPx > 0);
}

function pathCostPx(path) {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += DIST_MATRIX[path[i]][path[i + 1]] * PX_PER_UNIT;
  }
  return total;
}

function buildRouteCandidate(endpoint, entryFrom, firstRemainPx, toIdx) {
  const tail = findPath(endpoint, toIdx);
  if (firstRemainPx <= 0) {
    return {
      costPx: pathCostPx(tail),
      path: tail,
      usePartial: false,
      curIdx: tail[0] ?? endpoint,
    };
  }
  return {
    costPx: firstRemainPx + pathCostPx(tail),
    path: [entryFrom, endpoint, ...tail.slice(1)],
    usePartial: true,
    curIdx: entryFrom,
    totalPx: DIST_MATRIX[entryFrom][endpoint] * PX_PER_UNIT,
    remainPx: firstRemainPx,
  };
}

function applyRouteCandidate(candidate, toIdx) {
  const g = gameData.gps;
  if (!candidate || !candidate.path || candidate.path.length === 0) {
    clearRouteAt(g.curIdx);
    render();
    return;
  }
  g.destIdx = toIdx;
  g.path = candidate.path;
  g.seg = 0;
  g.curIdx = candidate.curIdx;
  if (candidate.usePartial) {
    g.units = DIST_MATRIX[g.path[0]][g.path[1]];
    g.totalPx = candidate.totalPx;
    g.remainPx = candidate.remainPx;
  } else if (g.path.length >= 2) {
    newSegment();
  } else {
    clearRouteAt(g.path[0] ?? g.curIdx);
  }
  render();
}

// 推进当前路段；路段走完后移到下一站，最终目标到达时直接结束导航（无论是否漫游）
function advanceSegment() {
  const g = gameData.gps;
  // 大量出没事件点：最后一段是事件边，剩余走完（remainPx<=0）即到达事件点——
  // 导航结束但保留当前段进度，主角精确停在事件点（道路中间），不跳到节点；
  // 记下 massArrived：只有停在这个点上才触发大量出没，途经该路段不算
  if (g.massTarget && g.seg === g.path.length - 2 && g.remainPx <= 0) {
    // 到达事件点：把剩余像素修正为「事件点到段终点节点」的距离，使地图定位点
    // （p = 1 - remainPx/totalPx）精确停在事件点上，不会瞬移到段终点节点
    const [ea, eb] = g.massTarget.edge;
    const fromA = g.totalPx * g.massTarget.t; // 事件点距 ea 的像素
    g.remainPx = (g.path[g.seg] === ea && g.path[g.seg + 1] === eb)
      ? g.totalPx - fromA // a→b 方向：事件点之后还剩到 eb 的距离
      : fromA;            // b→a 方向：事件点之后还剩到 ea 的距离
    g.destIdx = null;
    g.massTarget = null;
    g.massArrived = true;
    // 抵达大量出没事件点：立即结束骑行状态（场景是自行车场景时直接切成走路，
    // 场景画面保持自行车道不变，恢复正常走路/遭遇，事件宝可梦才能滚向主角进战斗）
    road.setBike(false);
    road.setManualBike(false);
    render();
    return;
  }
  if (g.seg < g.path.length - 2) {
    g.seg++;
    g.curIdx = g.path[g.seg];
    newSegment();
    // 大量出没：推进到事件边时，把该段剩余改为「事件点距段起点的距离」，走到即到达事件点
    if (g.massTarget && g.seg === g.path.length - 2) {
      const [ea, eb] = g.massTarget.edge;
      const fromA = g.totalPx * g.massTarget.t; // 事件点距 ea 的像素
      if (g.path[g.seg] === ea && g.path[g.seg + 1] === eb) g.remainPx = fromA; // a→b 方向
      else g.remainPx = g.totalPx - fromA;                                     // b→a 方向
    }
    // 经过中间节点不下车：骑行连续推进到当前导航目的地（最终目的地/大量出没点）才自动下车
    render();
    return;
  }
  // 到达目的地：若仍开启漫游，立刻接续下一站；否则回到未选择目的地状态
  const arrivedIdx = g.path[g.path.length - 1];
  clearRouteAt(arrivedIdx);
  road.setManualBike(false); // 到达导航目的地：自动下车（导航已结束，骑行状态一并结束）
  if (g.roamEnabled) {
    planRoute(nextStop(arrivedIdx));
    return;
  }
  render();
}

// 规划前往指定地区的路线（手动选择目的地 / 漫游自动下一站共用）
// 改目的地时按当前道路上的真实位置重算：比较“折返到起点”与“继续到终点”两条候选，取更短者。
function planRoute(toIdx) {
  if (road.isManualBike()) return; // 骑行中禁止改选目的地（防中途换站/漫游无限续）
  const g = gameData.gps;
  if (g.pendingBike) { g.pendingBike = false; g.bikePrevNav = null; } // 待选中经其他入口导航（悬赏前往/漫游）：取消待选与快照，按普通走路导航
  const fromIdx = g.curIdx;
  // 改选地区目的地会取消大量出没事件点目标：先换算事件边的剩余语义，避免位置整体偏移
  normalizeMassRemainToEnd(g);
  g.massTarget = null; // 改选地区目的地会取消大量出没事件点目标
  g.massArrived = false; // 离开大量出没事件点
  // 起点即终点（仅站在节点上时成立）：无路程可规划，直接视为未选择目的地
  if (!hasActiveSegment(g) && fromIdx === toIdx) {
    clearRouteAt(fromIdx);
    render();
    return;
  }

  if (!hasActiveSegment(g)) {
    const path = findPath(fromIdx, toIdx);
    if (path.length < 2) {
      clearRouteAt(path[0] ?? fromIdx);
      render();
      return;
    }
    g.curIdx = fromIdx;
    g.destIdx = toIdx;
    g.path = path;
    g.seg = 0;
    newSegment();
    render();
    return;
  }

  const a = g.path[g.seg];
  const b = g.path[g.seg + 1];
  const edgePx = g.totalPx || (DIST_MATRIX[a][b] * PX_PER_UNIT);
  const remainPx = Math.max(0, Math.min(g.remainPx || 0, edgePx));
  const walkedPx = Math.max(0, edgePx - remainPx);
  const forward = buildRouteCandidate(b, a, remainPx, toIdx);
  const backward = buildRouteCandidate(a, b, walkedPx, toIdx);
  const best = backward.costPx < forward.costPx ? backward : forward;
  applyRouteCandidate(best, toIdx);
}

// ===== 事件点导航（大量出没 / 时空扭曲共用） =====
// 目标是一个"边中间点"（事件点）而非地区节点：最后一段走事件边，走到事件点即到达。
// 到达后结束导航但保留当前段进度，主角精确停在事件点（道路中间），不会瞬移回节点。
function planEventRoute(getEvent, inZone) {
  if (road.isManualBike()) return; // 骑行中禁止改选事件点
  const ev = getEvent();
  if (!ev) return;
  const g = gameData.gps;
  // 点击事件点导航：自动关闭漫游，保证到达事件点后自动停下（不被漫游接续下一站）
  if (g.roamEnabled) g.roamEnabled = false;
  if (inZone()) return; // 已在事件路段，无需导航

  const [ea, eb] = ev.edge;
  const edgePx = DIST_MATRIX[ea][eb] * PX_PER_UNIT;
  const fromA = edgePx * ev.t;  // 事件点距 ea 的像素
  const fromB = edgePx - fromA; // 事件点距 eb 的像素

  // 当前位置已在事件边段上（如：到达事件点后开启漫游又点回事件点，massArrived 已被
  // planRoute 清除但人还没离开）：直接在当前段内导航到事件点，避免先走到端点再绕回一大圈。
  if (hasActiveSegment(g) && g.totalPx > 0) {
    const a = g.path[g.seg];
    const b = g.path[g.seg + 1];
    const isEventEdge = (a === ea && b === eb) || (a === eb && b === ea);
    if (isEventEdge) {
      const fromStart = (a === ea && b === eb) ? g.totalPx * ev.t : g.totalPx * (1 - ev.t);
      // 用统一换算取真实已走像素：massTarget 已设时 remainPx 是"到事件点的剩余"，未设时是"到段终点的剩余"
      const walkedPx = walkedPxOnSegment(g);
      const distToEvent = Math.abs(walkedPx - fromStart);
      if (distToEvent < 1) {
        // 已站在事件点上：直接结束导航，恢复"已到达事件点"状态；
        // remainPx 修正为"事件点到段终点的距离"，定位点精确停在事件坐标
        g.destIdx = null;
        g.massTarget = null;
        g.massArrived = true;
        g.remainPx = g.totalPx - fromStart;
        road.setManualBike(false); // 已站在事件点：同样自动下车（骑行中不遇敌）
        render();
        saveGame();
        return;
      }
      // 事件点在前方则沿当前方向继续走，已走过则折返；走完 distToEvent 即到达事件点
      const goForward = walkedPx <= fromStart;
      const [pa, pb] = goForward ? [a, b] : [b, a];
      g.destIdx = null;
      g.massTarget = { edge: ev.edge, t: ev.t };
      g.path = [pa, pb];
      g.seg = 0;
      g.curIdx = pa;
      g.units = DIST_MATRIX[pa][pb];
      g.totalPx = g.units * PX_PER_UNIT;
      g.remainPx = distToEvent;
      render();
      saveGame();
      return;
    }
  }

  // 从节点 X 出发到事件点的候选：从事件边两端进入，选更短的一侧
  const fromNode = (X) => {
    const pathA = findPath(X, ea); // 先到 ea，再沿 a→b 走到事件点
    const pathB = findPath(X, eb); // 先到 eb，再沿 b→a 走到事件点
    const costA = pathCostPx(pathA) + fromA;
    const costB = pathCostPx(pathB) + fromB;
    if (costA <= costB) return { tail: [...pathA, eb], entryFrom: ea, entryEnd: eb, firstRemainPx: fromA, cost: costA };
    return { tail: [...pathB, ea], entryFrom: eb, entryEnd: ea, firstRemainPx: fromB, cost: costB };
  };

  const startEventRoute = (path, entryFrom, entryEnd, firstRemainPx, firstTotalPx) => {
    g.destIdx = null; // 事件点不是地区节点：底部不显示地区目的地，到达即停
    g.massTarget = { edge: ev.edge, t: ev.t };
    g.path = path;
    g.seg = 0;
    g.curIdx = path[0];
    g.units = DIST_MATRIX[entryFrom][entryEnd];
    // 在途接续：第一段 = 当前段，沿用剩余进度；站在节点上：第一段从节点全新出发
    if (firstRemainPx != null && firstTotalPx != null) {
      g.totalPx = firstTotalPx;
      g.remainPx = firstRemainPx;
    } else {
      newSegment();
    }
    render();
  };

  if (!hasActiveSegment(g)) {
    // 站在节点上：直接从该节点规划到事件点，第一段按全新路段从节点出发
    const c = fromNode(g.curIdx);
    startEventRoute(c.tail, c.entryFrom, c.entryEnd, null, null);
    saveGame();
    return;
  }

  // 在途：比较"继续到段终点再导航"与"折返到段起点再导航"，取更短者
  const a = g.path[g.seg];
  const b = g.path[g.seg + 1];
  const curEdgePx = g.totalPx || (DIST_MATRIX[a][b] * PX_PER_UNIT);
  const remainPx = Math.max(0, Math.min(g.remainPx || 0, curEdgePx));
  const walkedPx = Math.max(0, curEdgePx - remainPx);
  const fwd = fromNode(b);
  const bwd = fromNode(a);
  if (remainPx + fwd.cost <= walkedPx + bwd.cost) {
    startEventRoute([a, b, ...fwd.tail.slice(1)], a, b, remainPx, curEdgePx);
  } else {
    startEventRoute([b, a, ...bwd.tail.slice(1)], b, a, walkedPx, curEdgePx);
  }
  saveGame();
}

// 大量出没事件点导航入口
export function planMassRoute() {
  planEventRoute(getMassOutbreak, inMassZone);
}

// 时空扭曲事件点导航入口
export function planTwistRoute() {
  planEventRoute(getTwist, inTwistZone);
}

// 调试用：直接传送玩家到时空扭曲事件点（站在事件边上，等效于导航到点后自动停下）。
// 用于 __resetTwist 联调，省去手动导航。
export function teleportToTwist() {
  const ev = getTwist();
  if (!ev) return false;
  const g = gameData.gps;
  const [ea, eb] = ev.edge;
  // 关闭漫游/导航，直接落位事件点：状态与 planEventRoute 到达分支保持一致
  g.roamEnabled = false;
  g.destIdx = null;
  g.massTarget = null;
  g.massArrived = true;
  g.curIdx = ea;
  g.path = [ea, eb];
  g.seg = 0;
  g.units = DIST_MATRIX[ea][eb];
  g.totalPx = g.units * PX_PER_UNIT;
  g.remainPx = g.totalPx * (1 - ev.t); // 事件点到 eb 的剩余距离（事件点停在边中间）
  // 事件点强制非骑行（骑行中不遇敌），下车可立即遭遇
  road.setManualBike(false);
  road.setBike(false);
  render();
  saveGame();
  return true;
}

// 主角移动推进：main.js 每秒把道路滚动距离喂进来（px 为真实行走/跑步像素）
export function gpsAddDistance(px, pxPerSec) {
  const g = gameData?.gps;
  if (!g) return;
  // 有地区目的地或正在前往大量出没事件点时都会移动推进
  if ((g.destIdx == null && g.massTarget == null) || px <= 0) return;
  g.pxPerSec = pxPerSec || ROAD_SPEED_WALK * 60;
  g.remainPx = Math.max(0, g.remainPx - px);
  if (g.remainPx <= 0) { advanceSegment(); return; }
  // 推进中只增量更新定位点/里程，不重建整个地图（避免打断事件点扩散圆环等 CSS 动画）
  updateGpsViewport();
}

// 开启/关闭漫游：开启后若当前无目的地，自动沿漫游路线规划下一站
export function setRoamEnabled(on) {
  const g = gameData.gps;
  g.roamEnabled = !!on;
  if (g.roamEnabled && g.destIdx == null) {
    if (hasActiveSegment(g)) {
      // 在道路中间开启漫游：先导航到当前段终点（下一个地区节点），只高亮"当前位置→下一节点"这一段；
      // 到达节点后由 advanceSegment 的漫游分支自动接续下一站，不会一次性规划到远方节点整条高亮。
      planRoute(g.path[g.seg + 1]);
    } else {
      planRoute(nextStop(g.curIdx));
    }
  } else {
    render();
  }
  saveGame();
}

// 取消目的地：停止导航，原地停在当前点
// 保留当前路段进度作为物理位置（不清 path），只清除目的地——位置不丢，下次导航从当前点继续，不会瞬移
// 待选骑行目的地中点退出 = 放弃选骑行目的地：恢复进入待选前的导航
export function cancelNavigation() {
  const g = gameData.gps;
  if (g.pendingBike) { abandonBikeTarget(); return; }
  g.roamEnabled = false;
  // 若正停在事件边最后一段上，先把 remainPx 从"到事件点的剩余"换算回"到段终点的剩余"，
  // 否则下面清掉 massTarget 后，后续按普通路段语义读取位置会整体偏移（瞬移）
  normalizeMassRemainToEnd(g);
  g.destIdx = null;
  g.massTarget = null;
  g.pendingBike = false; // 取消待选骑行目的地状态
  road.setManualBike(false); // 手动结束导航：直接下车（导航是骑行的自然终点）
  render();
  saveGame();
}

// 点背包「自行车」：保存当前导航状态，停止导航（保留物理位置，与取消导航一致），
// 进入"待选骑行目的地"状态并跳转导航页；玩家在地图上选好目的地后才消耗 1 个道具上车骑行。
// 若玩家放弃选目的地（点退出 / 标题栏返回 / 再点背包），恢复进入前的导航。
export function startBikeTarget() {
  const g = gameData.gps;
  // 保存旧导航快照（放弃待选时恢复）：含目的地/漫游/路线/位置/事件点目标，恢复后完全回到原状态
  g.bikePrevNav = {
    destIdx: g.destIdx,
    massTarget: g.massTarget ? { ...g.massTarget } : null,
    roamEnabled: g.roamEnabled,
    path: g.path ? [...g.path] : null,
    seg: g.seg,
    remainPx: g.remainPx,
    totalPx: g.totalPx,
    curIdx: g.curIdx,
    massArrived: g.massArrived,
  };
  g.roamEnabled = false;
  normalizeMassRemainToEnd(g);
  g.destIdx = null;
  g.massTarget = null;
  g.pendingBike = true;
  showGpsView(); // pushNav + render + showView（恢复进入时 render 读取 pendingBike 显示待选 UI）
  saveGame();
}

// 放弃待选骑行目的地：恢复进入待选前的导航（若存在），否则仅清待选状态
export function abandonBikeTarget() {
  const g = gameData.gps;
  const prev = g.bikePrevNav;
  g.pendingBike = false;
  g.bikePrevNav = null;
  if (prev) {
    g.destIdx = prev.destIdx;
    g.massTarget = prev.massTarget;
    g.roamEnabled = prev.roamEnabled;
    g.path = prev.path;
    g.seg = prev.seg;
    g.remainPx = prev.remainPx;
    g.totalPx = prev.totalPx;
    g.curIdx = prev.curIdx;
    g.massArrived = prev.massArrived;
  }
  road.setManualBike(false);
  render();
  saveGame();
}

// 外部入口：自动规划前往指定地区的路线（地区悬赏页「前往」按钮）
export function navigateToRegion(toIdx) {
  const idx = Number(toIdx);
  const g = gameData?.gps;
  if (!g || !Number.isInteger(idx)) return;
  planRoute(idx);
  saveGame();
}

// ---------- 单页渲染 ----------
function render() {
  const g = gameData.gps;
  const el = $('gpsContent');
  // 骑行相关特殊态：骑行中（已上车）或待选骑行目的地（点过自行车、未选目的地）
  const riding = road.isManualBike();
  const pendingBike = g.pendingBike === true;
  const bikeMode = riding || pendingBike;
  // 导航中 = 有地区目的地 或 正在前往大量出没事件点（事件点不是地区节点，destIdx 为 null）
  const hasDest = g.destIdx != null || g.massTarget != null;

  // 剩余真实距离 = 当前路段剩余 + 后续各路段全长（换目的地/绕行时正确反映总里程；
  // 前往大量出没事件点时，事件边只算到事件点的距离）
  let remainPxTotal = hasDest ? (g.remainPx || 0) : 0;
  if (hasDest && g.path) {
    for (let i = g.seg + 1; i < g.path.length - 1; i++) {
      const segA = g.path[i], segB = g.path[i + 1];
      let segPx = DIST_MATRIX[segA][segB] * PX_PER_UNIT;
      if (g.massTarget && i === g.path.length - 2) {
        const [ea, eb] = g.massTarget.edge;
        const fromA = segPx * g.massTarget.t;
        segPx = (segA === ea && segB === eb) ? fromA : (segPx - fromA);
      }
      remainPxTotal += segPx;
    }
  }
  // 剩余真实时间：按主角当前移速（走路/跑步/骑车）实时估算，buff 生效即按跑步速度重算
  const pxPerSec = road.getSpeed() * 60;
  const pxPerMin = pxPerSec * 60;
  const remainMin = hasDest ? Math.max(0, Math.ceil(remainPxTotal / pxPerMin)) : 0;
  // 剩余距离换算公里
  const remainKm = hasDest ? Math.max(0, remainPxTotal / PX_PER_METER / 1000) : 0;
  // 预计到达时刻 = 当前时间 + 剩余分钟，HH:MM 格式
  const arriveStr = hasDest ? (() => {
    const d = new Date(Date.now() + remainMin * 60000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  })() : '';

  // 漫游行右侧互斥文案：暂停时显示暂停原因；非暂停时显示 当前道路→最近节点（当前段目标端）
  const paused = phase !== 'idle' ? '正在与宝可梦对战，移动暂停'
    : isFishing() ? '正在钓鱼，移动暂停'
    : '';
  let roamHint = '';
  if (!paused && hasActiveSegment(g)) {
    const roadInfo = getCurrentRoadInfo();
    if (g.massTarget) {
      // 事件点目标（massTarget）由大量出没 / 时空扭曲共用，按目标边区分文案
      const tw = getTwist();
      const isTwist = tw && g.massTarget.edge
        && g.massTarget.edge[0] === tw.edge[0] && g.massTarget.edge[1] === tw.edge[1]
        && Math.abs(g.massTarget.t - tw.t) < 1e-6;
      roamHint = roadInfo ? `${roadInfo.num}#道路（${roadInfo.name}）→${isTwist ? '时空扭曲' : '大量出没'}` : '';
    } else if (g.massArrived) {
      // 已停在事件点：不再是"前往某地区"，提示事件进行中
      const isTwist = inTwistZone();
      roamHint = roadInfo ? `${roadInfo.num}#道路（${roadInfo.name}）·${isTwist ? '时空扭曲中' : '大量出没中'}` : '';
    } else {
      const endIdx = g.path[g.seg + 1];
      roamHint = roadInfo ? `${roadInfo.num}#道路（${roadInfo.name}）→${REGION_CYCLE[endIdx]}` : '';
    }
  }

  el.innerHTML = `
    <div class="gps-wrap">
      <div class="gps-roam-row">
        ${bikeMode
          ? `<span class="gps-roam-label">${riding ? '骑行中' : '选择骑行目的地'}</span>`
          : `<span class="gps-roam-label">漫游</span>
             <div class="toggle-switch" id="gpsRoamToggle">
               <div class="toggle-track${g.roamEnabled ? ' on' : ''}"></div>
               <div class="toggle-knob"></div>
             </div>`}
        ${paused
          ? `<span class="gps-roam-paused">${paused}</span>`
          : roamHint ? `<span class="gps-roam-paused">${roamHint}</span>` : ''}
      </div>
      ${buildMiniMap(g)}
      <div class="bottom-dock">
        ${(hasDest || pendingBike) ? `
        <span class="gps-bottom-cancel" id="gpsCancelBtn">
          <svg viewBox="0 0 12 12" width="13" height="13"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
          <span class="gps-bottom-cancel-text">${riding ? '下车' : '退出'}</span>
        </span>` : ''}
        <span class="gps-bottom-info">
          <span class="gps-bottom-line1">${hasDest ? `${remainKm.toFixed(1)}公里 ${remainMin}分` : (pendingBike ? '点击地图选择骑行目的地' : '点击地图选择目的地')}</span>
          ${hasDest ? `<span class="gps-bottom-line2">${arriveStr}到达</span>` : ''}
        </span>
      </div>
    </div>`;
}

// 主角移速变化（buff 激活/到期、道路切换）后由 ui.js 调用，立即按新速度重算预计时间
export function refreshGpsRender() {
  if ($('gpsView')?.style.display === 'flex') render();
}

// 导航页底部大量出没跑马灯（已移除）：事件信息改为悬停大量出没标记时 tooltip 显示，
// 由 ui.js 的 setupFoodTooltip 事件委托统一处理，gps.js 无需维护定时器。

// 待选骑行目的地状态：玩家在地图上选好目的地（节点/大量出没点）后消耗 1 个自行车并进入骑行。
// 返回 true = 已消耗（调用方需接着上车骑行）；false = 非待选状态或无货（无货时仅取消待选，按普通走路导航处理）
function consumePendingBike() {
  const g = gameData.gps;
  if (g.pendingBike !== true) return false;
  g.pendingBike = false;
  g.bikePrevNav = null; // 已选好新目的地并开始骑行：旧导航快照不再需要
  if ((gameData.items['bike'] || 0) <= 0) return false;
  gameData.items['bike']--;
  updateBackpack('bike');
  return true;
}

export function showGpsView() {
  pushNav('gpsView'); // 导航页入栈：返回逐级回来源页（手机主页/悬赏/挂机）
  render();
  showView('gpsView');
  // 确保游戏内自制 tooltip 委托已激活（大量出没标记悬停提示用，幂等）
  setupFoodTooltip();
  // 事件委托：漫游开关 + 点击地图节点选择目的地 / 取消导航
  const el = $('gpsContent');
  el.onclick = (e) => {
    const sw = e.target.closest('#gpsRoamToggle');
    if (sw) {
      if (road.isManualBike() || gameData.gps.pendingBike) return; // 骑行相关态已隐藏开关，保险拦截
      setRoamEnabled(!gameData.gps.roamEnabled);
      return;
    }
    const cancel = e.target.closest('#gpsCancelBtn');
    if (cancel) { cancelNavigation(); return; }
    // 点击大量出没事件点标记 → 规划前往事件点（骑行中锁定；待选中 = 选它作为骑行目的地）
    const mass = e.target.closest('.gps-mass-marker');
    if (mass) {
      if (road.isManualBike()) return;
      if (consumePendingBike()) {
        planMassRoute();
        road.setManualBike(true); // 选好目的地才上车骑行
        render();
        saveGame();
        return;
      }
      planMassRoute();
      return;
    }
    // 点击时空扭曲事件点标记 → 同上，规划前往扭曲点
    const twist = e.target.closest('.gps-twist-marker');
    if (twist) {
      if (road.isManualBike()) return;
      if (consumePendingBike()) {
        planTwistRoute();
        road.setManualBike(true); // 选好目的地才上车骑行
        render();
        saveGame();
        return;
      }
      planTwistRoute();
      return;
    }
    // 点击地图上的地区节点 → 设为目的地（骑行中锁定；待选中 = 选它作为骑行目的地）
    const node = e.target.closest('.gps-map-node');
    if (node) {
      const idx = Number(node.dataset.region);
      const g = gameData.gps;
      if (road.isManualBike()) return;
      if (consumePendingBike()) {
        planRoute(idx);
        road.setManualBike(true); // 选好目的地才上车骑行
        render();
        saveGame();
        return;
      }
      if (!isNaN(idx) && !(g.destIdx == null && !hasActiveSegment(g) && idx === g.curIdx)) {
        planRoute(idx);
        saveGame();
      }
      return;
    }
  };
}
