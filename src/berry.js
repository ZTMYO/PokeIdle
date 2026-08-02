// ===== 树果农场 =====
// 6 块田地按真实时间生长；生长/湿度由 Date.now() 折算并随存档持久化（gameData.berryFarm）
import { $, showView, tryLoadImage, getCharPrefix } from './ui.js';
import { phase, gameData, setPrevView, saveGame, randInt, addSystemLog } from './state.js';
import { BERRY_ICONS, BERRY_NAMES } from './items.js';
import { setupFoodTooltip } from './pokedex.js';
import {
  FARM_PLOT_COUNT as PLOT_COUNT,
  FARM_MATURE_MIN as MATURE_MIN,
  FARM_MATURE_MAX as MATURE_MAX,
  FARM_STAGE_DIRT as STAGE_DIRT,
  FARM_STAGE_SPROUT as STAGE_SPROUT,
  FARM_STAGE_GROW as STAGE_GROW,
  FARM_MAX_WATER as MAX_WATER,
  FARM_WATER_DROP as WATER_DROP,
  FARM_PLANT_COST as PLANT_COST,
  FARM_BOARD_DEMANDS as BOARD_DEMANDS,
  FARM_BOARD_QTY_MIN as BOARD_QTY_MIN,
  FARM_BOARD_QTY_MAX as BOARD_QTY_MAX,
  FARM_BOARD_BIG_QTY_MIN as BIG_QTY_MIN,
  FARM_BOARD_BIG_QTY_MAX as BIG_QTY_MAX,
  FARM_CANDY_PER_BERRY as CANDY_PER_BERRY,
  FARM_HARVEST_MIN as HARVEST_MIN,
  FARM_HARVEST_MAX as HARVEST_MAX,
  FARM_HELPER_COST as HELPER_COST,
  FARM_HELPER_DURATION as HELPER_DURATION,
  FARM_HELPER_COOLDOWN as HELPER_COOLDOWN,
  FARM_HELPER_WORK_MIN as HELPER_WORK_MIN,
  FARM_HELPER_WORK_MAX as HELPER_WORK_MAX,
  FARM_HELPER_PATROL_PAUSE_MIN as PATROL_PAUSE_MIN,
  FARM_HELPER_PATROL_PAUSE_MAX as PATROL_PAUSE_MAX,
} from './config.js';

const CANDY_ICON = '<img src="./items/candy.png" style="width:12px;height:12px;vertical-align:-2px;image-rendering:pixelated;" />';

const FRAME_W = 32;
const BERRY_COLS = 6;

const TREE_DIR = './items/berry-trees/';
const BERRY_DIR = './items/berries/';

const FIELD_TILE = 24;
const FIELD_TILESET = './terrain/terrain-tileset.png';
const FARM = {
  w: 10,
  h: 9,
  tiles: [
    Array.from({ length: 10 }, () => ({ col: 1, row: 0 })),
    [{ col: 0, row: 39 }, ...Array.from({ length: 8 }, () => ({ col: 1, row: 41 })), { col: 2, row: 39 }],
    [{ col: 0, row: 40 }, { col: 3, row: 41 }, ...Array.from({ length: 6 }, () => ({ col: 4, row: 41 })), { col: 5, row: 41 }, { col: 2, row: 40 }],
    [{ col: 0, row: 40 }, { col: 3, row: 33 }, ...Array.from({ length: 6 }, () => ({ col: 4, row: 33 })), { col: 5, row: 33 }, { col: 2, row: 40 }],
    [{ col: 0, row: 40 }, { col: 3, row: 34 }, ...Array.from({ length: 6 }, () => ({ col: 4, row: 34 })), { col: 5, row: 34 }, { col: 2, row: 40 }],
    [{ col: 0, row: 40 }, { col: 3, row: 41 }, ...Array.from({ length: 6 }, () => ({ col: 4, row: 41 })), { col: 5, row: 41 }, { col: 2, row: 40 }],
    [{ col: 0, row: 40 }, { col: 3, row: 33 }, ...Array.from({ length: 6 }, () => ({ col: 4, row: 33 })), { col: 5, row: 33 }, { col: 2, row: 40 }],
    [{ col: 0, row: 40 }, { col: 3, row: 34 }, ...Array.from({ length: 6 }, () => ({ col: 4, row: 34 })), { col: 5, row: 34 }, { col: 2, row: 40 }],
    [{ col: 0, row: 40 }, ...Array.from({ length: 8 }, (_, k) => (k % 2 === 0 ? { col: 5, row: 1 } : { col: 4, row: 0 })), { col: 2, row: 40 }],
  ],
};
const FIELD_W = FARM.w * FIELD_TILE;
const FIELD_H = FARM.h * FIELD_TILE;
const PLOT_LEFT = [48 + 144 / 6 - 16, 48 + 144 / 2 - 16, 48 + 144 * 5 / 6 - 16];
const PLOT_BOTTOM = [FIELD_H - 4 * FIELD_TILE + 5, FIELD_H - 7 * FIELD_TILE + 5];
const HOME_X = 200;
const HOME_Y = 130;
// 固定巡逻线路（bottom 坐标系）："日"去掉顶部一横——底横 y=25、中横 y=95、两侧竖边 x=10/x=200 贯穿（25→130），顶横不连接，循环走动；
// x 已左移 16px 补偿角色左下角锚点（角色 32px 宽，视觉中心对准原线）
const PATROL_PTS = [
  { x: 10, y: 25 },
  { x: 200, y: 25 },
  { x: 200, y: 130 },
  { x: 200, y: 95 },
  { x: 10, y: 95 },
  { x: 10, y: 130 },
];
const PATROL_ROW_Y = { aisle: 95, bottom: 25 };
const WALK_SPEED = 100;
const MIN_LEG_MS = 240;
// 层级压缩到对话框（.berry-picker z-index:11）之下：树按行固定（上行 7 / 下行 9）；
// 帮手 z 由 helperZ 分段——树行前方(ty<53) z=10 压住下行树，进入树行/过道 z=8 被下行树遮住
const TREE_Z = [7, 9];
function helperZ(ty) {
  return ty < PLOT_BOTTOM[1] ? 10 : 8;
}

let _timer = null;
let _picking = null;

function ensureBerryFarm() {
  if (!gameData.berryFarm) gameData.berryFarm = { plots: Array(PLOT_COUNT).fill(null), stock: {} };
  const f = gameData.berryFarm;
  if (!Array.isArray(f.plots) || f.plots.length !== PLOT_COUNT) {
    const arr = Array(PLOT_COUNT).fill(null);
    (f.plots || []).forEach((p, i) => { if (i < PLOT_COUNT) arr[i] = p; });
    f.plots = arr;
  }
  if (!f.stock) f.stock = {};
  return f;
}

function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function generateDailyDemands() {
  const pool = BERRY_ICONS.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, BOARD_DEMANDS).map((type, k) => {
    const big = k === BOARD_DEMANDS - 1;
    const qty = big ? randInt(BIG_QTY_MIN, BIG_QTY_MAX) : randInt(BOARD_QTY_MIN, BOARD_QTY_MAX);
    return {
      type,
      qty,
      big,
      candy: qty * CANDY_PER_BERRY + randInt(0, big ? 30 : 8),
      claimed: false,
    };
  });
}

function updateDailyDemands(f) {
  const today = dateStr();
  const b = f.board;
  if (b && b.date === today && Array.isArray(b.demands) && b.demands.length === BOARD_DEMANDS) return false;
  f.board = { date: today, demands: generateDailyDemands() };
  return true;
}

function ensureBoard() {
  return updateDailyDemands(ensureBerryFarm());
}

function plotState(p) {
  const since = Date.now() - p.waterAt;
  const dropMs = (p.water / WATER_DROP) * 1000;
  const growMs = Math.min(since, dropMs);
  return {
    water: Math.max(0, p.water - Math.floor(growMs / 1000) * WATER_DROP),
    grownMs: p.grownMs + growMs,
  };
}

function stageOf(plot) {
  const el = plotState(plot).grownMs;
  const total = plot.totalMs || MATURE_MIN;
  const d = total * STAGE_DIRT;
  const s = total * STAGE_SPROUT;
  const g = total * STAGE_GROW;
  if (el < d) return { key: 'dirt',   label: '刚种下', img: TREE_DIR + 'dirt_pile.png', cols: 1, frame: 0, count: 1, fh: 32, remain: d - el };
  if (el < s) return { key: 'sprout', label: '发芽中', img: TREE_DIR + 'sprout.png',    cols: 2, frame: 0, count: 2, fh: 32, scale: 0.8, remain: s - el };
  if (el < g) return { key: 'grow',   label: '成长中', img: TREE_DIR + BERRY_ICONS[plot.type], cols: BERRY_COLS, frame: 0, count: 2, fh: 64, remain: g - el };
  if (el < total) return { key: 'fruit',  label: '开花结果', img: TREE_DIR + BERRY_ICONS[plot.type], cols: BERRY_COLS, frame: 2, count: 2, fh: 64, remain: total - el };
  return { key: 'ripe', label: '可收获', img: TREE_DIR + BERRY_ICONS[plot.type], cols: BERRY_COLS, frame: 4, count: 2, fh: 64, remain: 0 };
}

function notifyBerryChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('berry-farm-changed'));
}

export function hasDryBerries() {
  const f = gameData?.berryFarm;
  if (!f || !Array.isArray(f.plots)) return false;
  return f.plots.some(p => p && stageOf(p).key !== 'ripe' && plotState(p).water <= 0);
}

function frameStyle(st, dry) {
  const bgW = st.cols * FRAME_W;
  const fromX = -(st.frame * FRAME_W);
  let base = `width:${FRAME_W}px;height:${st.fh}px;background-image:url('${encodeURI(st.img)}');background-size:${bgW}px ${st.fh}px;background-position:${fromX}px 0;`;
  if (st.scale) base += `transform:scale(${st.scale}) translateY(-2px);transform-origin:center bottom;`;
  if (st.count <= 1 || dry) return base;
  const toX = fromX - st.count * FRAME_W;
  return `${base}--bfrom:${fromX}px;--bto:${toX}px;animation:berry-frames 0.9s steps(${st.count}, end) infinite;`;
}

function isDry(p) {
  return !!p && stageOf(p).key !== 'ripe' && plotState(p).water <= 0;
}

function fmtRemain(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- 页面入口 ----------
export function showBerryView() {
  setPrevView($('phoneView')?.style.display !== 'none' ? 'phoneView' : (phase === 'encounter' || phase === 'caught') ? 'encounterView' : 'idleView');
  ensureBerryFarm();
  if (ensureBoard()) saveGame();
  setupFoodTooltip();
  render();
  showView('berryView');
  startTimer();
}

// 外部刷新：同步手机主页红点，农场页可见时直接重绘
export function refreshBerryView() {
  notifyBerryChanged();
  if ($('berryView')?.style.display === 'none') return;
  render();
}

function render() {
  const el = $('berryContent');
  if (!el) return;
  const f = ensureBerryFarm();
  el.innerHTML = `
    <div class="berry-progress" id="berryProgress" style="display:none">
      <div class="berry-progress-head">
        <span class="berry-progress-state"></span>
        <span class="berry-progress-time"></span>
        <span class="berry-progress-right"></span>
      </div>
      <div class="berry-progress-track"><div class="berry-progress-fill"></div></div>
    </div>
    <div class="berry-wrap">
      <div class="berry-field">
        <canvas class="berry-field-canvas"></canvas>
        <img class="berry-box-sign berry-icon" src="${TREE_DIR}box.png" data-tip="库存" alt="库存" />
        <img class="berry-board-sign berry-icon" src="${TREE_DIR}board.png" data-tip="告示牌" alt="告示牌" />
        ${f.plots.map((p, i) => plotHtml(p, i)).join('')}
      </div>
    </div>
  `;
  drawField(el.querySelector('.berry-field-canvas'));
  bindEvents(el);
  if (isHelperActive()) createHelperChar();
  else removeHelperChar();
}

function drawField(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = FIELD_W * dpr;
  canvas.height = FIELD_H * dpr;
  canvas.style.width = FIELD_W + 'px';
  canvas.style.height = FIELD_H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  const img = new Image();
  img.onload = () => {
    for (let r = 0; r < FARM.h; r++) {
      for (let c = 0; c < FARM.w; c++) {
        const t = FARM.tiles[r][c];
        ctx.drawImage(img, t.col * 16, t.row * 16, 16, 16, c * FIELD_TILE, r * FIELD_TILE, FIELD_TILE, FIELD_TILE);
      }
    }
  };
  img.src = FIELD_TILESET;
}

function plotTip(p) {
  return BERRY_NAMES[BERRY_ICONS[p.type]] || '树果';
}

function plotHtml(p, i) {
  const row = Math.floor(i / 3);
  const pos = `left:${PLOT_LEFT[i % 3]}px;bottom:${PLOT_BOTTOM[row]}px;`;
  const z = TREE_Z[row];
  if (!p) {
    return `
      <div class="berry-plot empty" data-plot="${i}" style="${pos}z-index:${z};">
        <div class="berry-plot-add berry-icon" data-tip="空地 · 点击种下">＋</div>
      </div>`;
  }
  const st = stageOf(p);
  return `
    <div class="berry-plot stage-${st.key}${st.key === 'ripe' ? ' ripe' : ''}" data-plot="${i}" style="${pos}z-index:${z};">
      <div class="berry-frame berry-icon" data-img="${st.img}" data-stage="${st.key}" data-tip="${plotTip(p)}" style="${frameStyle(st, isDry(p))}"></div>
    </div>`;
}

function pickerHtml() {
  const canAfford = (gameData.items.candy || 0) >= PLANT_COST;
  return `
    <div class="berry-picker">
      <div class="berry-picker-head">
        <span class="berry-picker-title">选择种子</span>
        <div class="berry-picker-x" data-pick-close>✕</div>
      </div>
      <div class="berry-picker-note">种植消耗 ${CANDY_ICON}${PLANT_COST}</div>
      <div class="berry-picker-grid">
        ${BERRY_ICONS.map((f, i) => `
          <div class="berry-pick-opt${canAfford ? '' : ' no-candy'}" data-type="${i}">
            <img class="berry-icon" data-src="${BERRY_DIR}${f}" data-tip="${BERRY_NAMES[f]}" alt="" />
          </div>`).join('')}
      </div>
    </div>`;
}

function bindPlot(plotEl) {
  plotEl.addEventListener('click', e => {
    e.stopPropagation();
    closePicker();
    closeBoard();
    closeStock();
    const i = Number(plotEl.dataset.plot);
    if (_harvesting.has(i)) return; // 收获动效播放中，忽略点击
    const p = ensureBerryFarm().plots[i];
    if (!p) openPicker(i);
    else if (stageOf(p).key === 'ripe') harvest(i);
    else waterPlot(i);
  });
  plotEl.addEventListener('mouseenter', () => {
    const i = Number(plotEl.dataset.plot);
    const p = ensureBerryFarm().plots[i];
    if (!p) return;
    _hoverPlot = i;
    const prog = $('berryProgress');
    if (prog) prog.style.display = '';
    updateProgress();
  });
  plotEl.addEventListener('mouseleave', () => {
    _hoverPlot = null;
    const prog = $('berryProgress');
    if (prog) prog.style.display = 'none';
  });
}

function bindEvents(el) {
  el.querySelector('.berry-box-sign')?.addEventListener('click', e => {
    closePicker();
    closeBoard();
    openStock();
    e.stopPropagation();
  });
  el.querySelector('.berry-board-sign')?.addEventListener('click', e => {
    closePicker();
    closeStock();
    openBoard();
    e.stopPropagation();
  });
  el.querySelectorAll('.berry-plot').forEach(bindPlot);
}

let _hoverPlot = null;
// 收获动效中的地块，期间忽略点击
const _harvesting = new Set();

function updateProgress() {
  if (_hoverPlot == null) return;
  const p = ensureBerryFarm().plots[_hoverPlot];
  const prog = $('berryProgress');
  if (!p || !prog) return;
  const st = stageOf(p);
  const ps = plotState(p);
  const el = ps.grownMs;
  const total = p.totalMs || MATURE_MIN;
  const pct = Math.min(100, el / total * 100);
  const fill = prog.querySelector('.berry-progress-fill');
  const state = prog.querySelector('.berry-progress-state');
  const time = prog.querySelector('.berry-progress-time');
  const right = prog.querySelector('.berry-progress-right');
  if (fill) fill.style.width = pct + '%';
  if (state) state.textContent = st.label;
  if (time) time.textContent = st.key === 'ripe' ? '' : fmtRemain(Math.max(0, total - el));
  if (right) right.textContent = st.key === 'ripe' ? '' : '湿度 ' + Math.floor(ps.water);
}

// ---------- 选种子面板 ----------
function pickerHost() {
  let host = $('berryPickerHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'berryPickerHost';
    host.style.display = 'none';
    $('berryView').appendChild(host);
  }
  return host;
}

function openPicker(i) {
  _picking = i;
  const host = pickerHost();
  host.innerHTML = pickerHtml();
  host.style.display = '';
  host.querySelectorAll('.berry-pick-opt img').forEach(im => {
    if (im.dataset.src) tryLoadImage(im, im.dataset.src);
  });
  host.querySelectorAll('.berry-pick-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      if ((gameData.items.candy || 0) < PLANT_COST) return;
      const type = Number(opt.dataset.type);
      const idx = _picking;
      closePicker();
      if (idx == null) return;
      gameData.items.candy -= PLANT_COST;
      gameData.stats.totalPlantings = (gameData.stats.totalPlantings || 0) + 1;
      ensureBerryFarm().plots[idx] = { type, grownMs: 0, water: 0, waterAt: Date.now(), totalMs: randInt(MATURE_MIN, MATURE_MAX) };
      saveGame();
      render();
      notifyBerryChanged();
    });
  });
  host.querySelectorAll('[data-pick-close]').forEach(btn => {
    btn.addEventListener('click', closePicker);
  });
}

function closePicker() {
  _picking = null;
  const host = $('berryPickerHost');
  if (host) {
    host.innerHTML = '';
    host.style.display = 'none';
  }
}

// ---------- 告示牌：每日果子需求，用库存树果兑换糖果（类似悬赏） ----------
function boardHost() {
  let host = $('berryBoardHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'berryBoardHost';
    host.style.display = 'none';
    $('berryView').appendChild(host);
  }
  return host;
}

function boardDemandHtml(d, k, stock) {
  const icon = BERRY_ICONS[d.type];
  const name = BERRY_NAMES[icon] || '树果';
  const have = stock[d.type] || 0;
  const done = !!d.claimed;
  const canTrade = !done && have >= d.qty;
  const btnText = done ? '已兑换' : canTrade ? '兑换' : '库存不足';
  return `
    <div class="board-demand${done ? ' claimed' : ''}">
      <img class="berry-icon" data-src="${BERRY_DIR}${icon}" data-tip="${name}" alt="" />
      <span class="board-demand-name">${name}</span>
      <span class="board-demand-qty">×${d.qty}</span>
      <span class="board-demand-candy">${CANDY_ICON}${d.candy}</span>
      <span class="board-trade ${done ? 'done' : canTrade ? '' : 'locked'}" data-di="${k}">${btnText}</span>
    </div>`;
}

function stockHtml(stock) {
  return BERRY_ICONS.map((icon, t) => `
    <div class="board-stock-item">
      <img class="berry-icon" data-src="${BERRY_DIR}${icon}" data-tip="${BERRY_NAMES[icon] || '树果'}" alt="" />
      <span class="board-stock-count">×${stock[t] || 0}</span>
    </div>`).join('');
}

function helperPanelHtml() {
  const active = isHelperActive();
  const resting = isHelperResting();
  const canAfford = (gameData.items.candy || 0) >= HELPER_COST;
  const remainStr = active ? fmtRemain(helperRemainingMs()) : resting ? fmtRemain(helperCooldownMs()) : '';
  const autoPlant = !!ensureBerryFarm().autoPlant;
  const stateClass = active ? ' active' : resting ? ' resting' : '';
  return `
    <div class="berry-helper-panel${stateClass}">
      <div class="helper-head">
        <img class="helper-avatar" src="./character/${helperSpritePrefix()}-front.png" alt="" />
        <div class="helper-meta">
          <div class="helper-name">${helperName()}</div>
          <div class="helper-desc">${active ? '正在照看果园' : resting ? '休息中' : '空闲中'}</div>
        </div>
        ${(active || resting) ? `<span class="helper-remain">${active ? '剩余' : '冷却'} ${remainStr}</span>` : ''}
      </div>
      <div class="helper-foot">
        ${active
          ? `
            ${autoPlant ? `<span class="helper-note">帮手会随机种植树果（每颗种子 ${CANDY_ICON}${PLANT_COST}）</span>` : ''}
            <span class="ball-check${autoPlant ? ' on' : ''}" id="toggleAutoPlant">${autoPlant ? '☑' : '☐'}自动种植</span>`
          : resting
            ? `<span class="helper-rest-note">帮手累了，休息中</span>`
            : `<span class="helper-cost">${CANDY_ICON}${HELPER_COST}</span>
               <span class="helper-hire${canAfford ? '' : ' locked'}" data-hire>招募</span>`}
      </div>
    </div>`;
}

function bindHelperPanel(scope) {
  scope.querySelectorAll('[data-hire]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      recruitHelper();
    });
  });
  scope.querySelectorAll('#toggleAutoPlant').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const f = ensureBerryFarm();
      f.autoPlant = !f.autoPlant;
      saveGame();
      refreshHelperPanel();
    });
  });
}

function refreshHelperPanel() {
  const host = $('berryBoardHost');
  if (!host || host.style.display === 'none') return;
  const section = host.querySelector('.berry-board-section-helper');
  if (!section) return;
  section.innerHTML = `
    <div class="berry-board-section-title">招募帮手</div>
    ${helperPanelHtml()}`;
  bindHelperPanel(section);
}

function updateHelperTimer() {
  const host = $('berryBoardHost');
  if (!host || host.style.display === 'none') return;
  const rem = host.querySelector('.helper-remain');
  if (!rem) return;
  if (isHelperActive()) rem.textContent = '剩余 ' + fmtRemain(helperRemainingMs());
  else if (isHelperResting()) rem.textContent = '冷却 ' + fmtRemain(helperCooldownMs());
}

function boardHtml() {
  const f = ensureBerryFarm();
  ensureBoard();
  const b = f.board;
  const stock = f.stock || {};
  const demands = b.demands
    .map((d, k) => ({ d, k }))
    .sort((a, b) => (a.d.big ? 1 : 0) - (b.d.big ? 1 : 0))
    .map(({ d, k }) => boardDemandHtml(d, k, stock)).join('');
  return `
    <div class="berry-picker berry-board">
      <div class="berry-picker-head">
        <span class="berry-picker-title">告示牌</span>
        <div class="berry-picker-x" data-board-close>✕</div>
      </div>
      <div class="berry-board-sections">
        <div class="berry-board-section">
          <div class="berry-board-section-title">树果委托</div>
          <div class="board-demands">${demands}</div>
        </div>
        <div class="berry-board-section berry-board-section-helper">
          <div class="berry-board-section-title">招募帮手</div>
          ${helperPanelHtml()}
        </div>
      </div>
    </div>`;
}

function openBoard() {
  if (ensureBoard()) saveGame();
  const host = boardHost();
  host.innerHTML = boardHtml();
  host.style.display = '';
  host.querySelectorAll('img[data-src]').forEach(im => tryLoadImage(im, im.dataset.src));
  host.querySelectorAll('[data-board-close]').forEach(btn => btn.addEventListener('click', closeBoard));
  host.querySelectorAll('.board-trade:not(.locked):not(.done)').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      tradeBoard(Number(btn.dataset.di));
    });
  });
  bindHelperPanel(host);
}

function closeBoard() {
  const host = $('berryBoardHost');
  if (host) {
    host.innerHTML = '';
    host.style.display = 'none';
  }
}

// ---------- 库存面板 ----------
function stockHost() {
  let host = $('berryStockHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'berryStockHost';
    host.style.display = 'none';
    $('berryView').appendChild(host);
  }
  return host;
}

function stockPanelHtml() {
  const stock = ensureBerryFarm().stock || {};
  return `
    <div class="berry-picker berry-stock-panel">
      <div class="berry-picker-head">
        <span class="berry-picker-title">我的库存</span>
        <div class="berry-picker-x" data-stock-close>✕</div>
      </div>
      <div class="board-stock">${stockHtml(stock)}</div>
    </div>`;
}

function openStock() {
  const host = stockHost();
  host.innerHTML = stockPanelHtml();
  host.style.display = '';
  host.querySelectorAll('img[data-src]').forEach(im => tryLoadImage(im, im.dataset.src));
  host.querySelectorAll('[data-stock-close]').forEach(btn => btn.addEventListener('click', closeStock));
}

function closeStock() {
  const host = $('berryStockHost');
  if (host) {
    host.innerHTML = '';
    host.style.display = 'none';
  }
}

function tradeBoard(di) {
  const f = ensureBerryFarm();
  ensureBoard();
  const d = f.board?.demands?.[di];
  if (!d || d.claimed) return;
  const have = f.stock[d.type] || 0;
  if (have < d.qty) return;
  f.stock[d.type] = have - d.qty;
  if (f.stock[d.type] <= 0) delete f.stock[d.type];
  d.claimed = true;
  gameData.items.candy = (gameData.items.candy || 0) + d.candy;
  if (gameData.stats?.totalItemsEarned) gameData.stats.totalItemsEarned.candy = (gameData.stats.totalItemsEarned.candy || 0) + d.candy;
  gameData.stats.totalBoardTrades = (gameData.stats.totalBoardTrades || 0) + 1;
  saveGame();
  refreshBoard();
}

function refreshBoard() {
  const host = $('berryBoardHost');
  if (!host) return;
  const f = ensureBerryFarm();
  const stock = f.stock || {};
  const demandsEl = host.querySelector('.board-demands');
  if (demandsEl && Array.isArray(f.board?.demands)) {
    demandsEl.innerHTML = f.board.demands.map((d, k) => boardDemandHtml(d, k, stock)).join('');
    demandsEl.querySelectorAll('img[data-src]').forEach(im => tryLoadImage(im, im.dataset.src));
    demandsEl.querySelectorAll('.board-trade:not(.locked):not(.done)').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation(); 
        tradeBoard(Number(btn.dataset.di));
      });
    });
  }
}

function harvest(i) {
  if (_harvesting.has(i)) return;
  const f = ensureBerryFarm();
  const p = f.plots[i];
  if (!p || stageOf(p).key !== 'ripe') return;
  const qty = randInt(HARVEST_MIN, HARVEST_MAX);
  gameData.stats.totalHarvests = (gameData.stats.totalHarvests || 0) + 1;
  gameData.stats.totalBerriesHarvested = (gameData.stats.totalBerriesHarvested || 0) + qty;
  f.stock[p.type] = (f.stock[p.type] || 0) + qty;
  f.plots[i] = null;
  saveGame();
  // 树果飞向库存箱的动效播完再重绘（render 会清掉动效图标）
  _harvesting.add(i);
  const wait = spawnHarvestFly(i, p.type, qty);
  setTimeout(() => { _harvesting.delete(i); render(); notifyBerryChanged(); }, wait);
}

function waterPlot(i) {
  const p = ensureBerryFarm().plots[i];
  if (!p) return;
  p.grownMs = plotState(p).grownMs;
  p.water = MAX_WATER;
  p.waterAt = Date.now();
  saveGame();
  spawnSpray(i);
  if (_hoverPlot === i) updateProgress();
  notifyBerryChanged();
}

function spawnSpray(i) {
  const plotEl = $('berryContent')?.querySelector(`.berry-plot[data-plot="${i}"]`);
  if (!plotEl) return;
  const img = document.createElement('img');
  img.className = 'berry-spray';
  img.src = TREE_DIR + 'spray' + randInt(1, 4) + '.png';
  img.alt = '';
  img.addEventListener('animationend', () => img.remove());
  plotEl.appendChild(img);
  for (let k = 0; k < 12; k++) {
    const drop = document.createElement('div');
    drop.className = 'berry-drop';
    const size = Math.random() < 0.7 ? 1 : 2;
    drop.style.width = size + 'px';
    drop.style.height = size + 'px';
    drop.style.setProperty('--dx', Math.floor(Math.random() * 33 - 16) + 'px');
    drop.style.setProperty('--delay', (Math.random() * 0.15).toFixed(2) + 's');
    drop.addEventListener('animationend', () => drop.remove(), { once: true });
    plotEl.appendChild(drop);
  }
}

// 收获动效：按收获数量生成树果图标，从树冠逐个飞向左上角库存箱；返回动效总时长（ms），供调用方决定何时清空地块
function spawnHarvestFly(i, type, qty) {
  const field = $('berryContent')?.querySelector('.berry-field');
  const boxEl = $('berryContent')?.querySelector('.berry-box-sign');
  if (!field || !boxEl) return 0;
  const plotEl = field.querySelector(`.berry-plot[data-plot="${i}"]`);
  if (!plotEl) return 0;
  const fr = field.getBoundingClientRect();
  const pr = (plotEl.querySelector('.berry-frame') || plotEl).getBoundingClientRect();
  const br = boxEl.getBoundingClientRect();
  const sx = pr.left - fr.left + pr.width / 2;
  const sy = pr.top - fr.top + pr.height * 0.25;
  const ex = br.left - fr.left + br.width / 2;
  const ey = br.top - fr.top + br.height / 2;
  const flyMs = 520;
  const step = 45;
  for (let k = 0; k < qty; k++) {
    const img = document.createElement('img');
    img.className = 'berry-fly';
    img.src = BERRY_DIR + BERRY_ICONS[type];
    img.alt = '';
    const delay = k * step + Math.floor(Math.random() * 30);
    const ox = Math.floor(Math.random() * 13) - 6;
    const oy = Math.floor(Math.random() * 9) - 4;
    img.style.left = (sx + ox) + 'px';
    img.style.top = (sy + oy) + 'px';
    img.style.transform = 'scale(1)';
    field.appendChild(img);
    // 先让初始位置完成一次渲染，再切过渡，避免直接落在终点
    requestAnimationFrame(() => requestAnimationFrame(() => {
      img.style.transition =
        `left ${flyMs}ms cubic-bezier(0.45,0,0.25,1) ${delay}ms, ` +
        `top ${flyMs}ms cubic-bezier(0.45,0,0.25,1) ${delay}ms, ` +
        `transform ${flyMs}ms ease-in ${delay}ms`;
      img.style.left = ex + 'px';
      img.style.top = ey + 'px';
      img.style.transform = 'scale(0.55)';
    }));
    setTimeout(() => img.remove(), delay + flyMs + 80);
  }
  return flyMs + Math.max(0, qty - 1) * step + 110;
}

// ---------- 招募帮手系统 ----------
const _helper = {
  nextWorkAt: 0,
  wanderTimer: null,
  workTimers: [],
  // 帮手当前位置缓存：render 重建会先清空 DOM，只能靠 walkTo 记录的坐标恢复，避免瞬移回出生点
  x: HOME_X,
  y: HOME_Y,
};

function helperSpritePrefix() {
  return getCharPrefix() === 'may' ? 'brendan' : 'may';
}

function helperName() {
  return helperSpritePrefix() === 'brendan' ? '小悠' : '小遥';
}

function isHelperActive() {
  const h = gameData?.berryFarm?.helper;
  return !!h && h.remainingMs > 0;
}

// 服务结束后的冷却期：帮手休息中，不可招募
function isHelperResting() {
  const h = gameData?.berryFarm?.helper;
  return !!h && h.remainingMs <= 0 && (h.cooldownMs || 0) > 0;
}

function helperRemainingMs() {
  return isHelperActive() ? gameData.berryFarm.helper.remainingMs : 0;
}

function helperCooldownMs() {
  return isHelperResting() ? gameData.berryFarm.helper.cooldownMs : 0;
}

function recruitHelper() {
  const f = ensureBerryFarm();
  if (isHelperActive() || isHelperResting()) return;
  if ((gameData.items.candy || 0) < HELPER_COST) return;
  gameData.items.candy -= HELPER_COST;
  f.helper = { remainingMs: HELPER_DURATION };
  addSystemLog('berry_helper', { cost: HELPER_COST, duration: HELPER_DURATION });
  saveGame();
  notifyBerryChanged();
  if ($('berryView')?.style.display !== 'none') {
    render();
    refreshHelperPanel();
  }
}

export function helperTick() {
  const f = gameData?.berryFarm;
  if (!f || !f.helper) return;
  const viewOpen = $('berryView')?.style.display !== 'none';
  if (f.helper.remainingMs > 0) {
    f.helper.remainingMs = Math.max(0, (f.helper.remainingMs || 0) - 1000);
    if (f.helper.remainingMs <= 0) {
      // 服务结束，进入冷却（帮手离场）
      f.helper.cooldownMs = HELPER_COOLDOWN;
      saveGame();
      notifyBerryChanged();
      if (viewOpen) {
        removeHelperChar();
        refreshHelperPanel();
      }
    } else if (viewOpen) {
      updateHelperTimer();
    }
  } else if ((f.helper.cooldownMs || 0) > 0) {
    f.helper.cooldownMs = Math.max(0, (f.helper.cooldownMs || 0) - 1000);
    if (f.helper.cooldownMs <= 0) {
      // 冷却结束，清空状态，恢复可招募
      f.helper = null;
      saveGame();
      notifyBerryChanged();
      if (viewOpen) refreshHelperPanel();
    } else if (viewOpen) {
      updateHelperTimer();
    }
  }
}

// 帮手单次劳作，从随机起点扫描：
// 收获成熟树果优先 → 其次浇水（避免干涸任务无限抢占收获）→ 开「自动种植」时空地补种（每颗扣 PLANT_COST）
function helperWork() {
  const f = ensureBerryFarm();
  if (!isHelperActive()) return;
  // 上一个劳作任务还在进行（走路/动作中）时不打断，避免半路转向另一个作物造成“突然加速”观感；
  // 等 finishHelperWork 移除 working 后，由下一次触发再接新任务
  const helper = document.getElementById('berryHelper');
  if (!helper || helper.classList.contains('working')) return;
  const autoPlant = !!f.autoPlant;
  const n = f.plots.length;
  const start = randInt(0, n - 1);
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (f.plots[i] && stageOf(f.plots[i]).key === 'ripe') {
      moveHelperTo(i, 'plant', () => helperHarvest(i));
      return;
    }
  }
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (f.plots[i] && isDry(f.plots[i])) {
      moveHelperTo(i, 'water', () => helperWater(i));
      return;
    }
  }
  if (autoPlant && (gameData.items.candy || 0) >= PLANT_COST) {
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (!f.plots[i]) {
        moveHelperTo(i, 'plant', () => helperPlant(i), () => helperWater(i));
        return;
      }
    }
  }
}

function helperWater(i) {
  const p = ensureBerryFarm().plots[i];
  if (!p) return;
  p.grownMs = plotState(p).grownMs;
  p.water = MAX_WATER;
  p.waterAt = Date.now();
  saveGame();
  spawnSpray(i);
  if (_hoverPlot === i) updateProgress();
  notifyBerryChanged();
}

function helperPlant(i) {
  const f = ensureBerryFarm();
  if (f.plots[i] || (gameData.items.candy || 0) < PLANT_COST) return;
  const type = randInt(0, BERRY_ICONS.length - 1);
  gameData.items.candy -= PLANT_COST;
  gameData.stats.totalPlantings = (gameData.stats.totalPlantings || 0) + 1;
  f.plots[i] = { type, grownMs: 0, water: 0, waterAt: Date.now(), totalMs: randInt(MATURE_MIN, MATURE_MAX) };
  saveGame();
  const plotEl = $('berryContent')?.querySelector(`.berry-plot[data-plot="${i}"]`);
  if (plotEl) {
    plotEl.outerHTML = plotHtml(f.plots[i], i);
    const newEl = $('berryContent')?.querySelector(`.berry-plot[data-plot="${i}"]`);
    if (newEl) bindPlot(newEl);
  }
  notifyBerryChanged();
}

function helperHarvest(i) {
  const f = ensureBerryFarm();
  const p = f.plots[i];
  if (!p || stageOf(p).key !== 'ripe') return;
  const qty = randInt(HARVEST_MIN, HARVEST_MAX);
  gameData.stats.totalHarvests = (gameData.stats.totalHarvests || 0) + 1;
  gameData.stats.totalBerriesHarvested = (gameData.stats.totalBerriesHarvested || 0) + qty;
  f.stock[p.type] = (f.stock[p.type] || 0) + qty;
  f.plots[i] = null;
  saveGame();
  _harvesting.add(i);
  const wait = spawnHarvestFly(i, p.type, qty); // 收获动效：树果飞向库存箱（图标是 .berry-field 的兄弟元素，不受地块替换影响）
  setTimeout(() => _harvesting.delete(i), wait);
  const plotEl = $('berryContent')?.querySelector(`.berry-plot[data-plot="${i}"]`);
  if (plotEl) {
    const row = Math.floor(i / 3);
    const pos = `left:${PLOT_LEFT[i % 3]}px;bottom:${PLOT_BOTTOM[row]}px;`;
    plotEl.outerHTML = `
      <div class="berry-plot empty" data-plot="${i}" style="${pos}z-index:${TREE_Z[row]};">
        <div class="berry-plot-add berry-icon" data-tip="空地 · 点击种下">＋</div>
      </div>`;
    const newEl = $('berryContent')?.querySelector(`.berry-plot[data-plot="${i}"]`);
    if (newEl) bindPlot(newEl);
  }
  notifyBerryChanged();
}

function legMs(px) {
  return Math.max(MIN_LEG_MS, Math.round(Math.abs(px) / WALK_SPEED * 1000));
}

function walkTo(el, tx, ty, onDone) {
  const cs = getComputedStyle(el);
  const cx = parseFloat(cs.left) || HOME_X;
  const cy = parseFloat(cs.bottom) || HOME_Y;
  if (cx === tx && cy === ty) { if (onDone) onDone(); return; }
  el.classList.remove('stand');
  const legs = [];
  if (tx !== cx) {
    const ms = legMs(tx - cx);
    legs.push({ ms, set: () => {
      el.dataset.x = tx;
      _helper.x = tx; // 同步位置缓存，render 重建后按此恢复
      el.style.transition = `left ${ms}ms linear, bottom ${ms}ms linear`;
      el.style.left = tx + 'px';
      el.classList.remove('walk-up', 'walk-down');
      el.classList.add('walk');
      el.classList.toggle('flip', tx < cx); // 向右走素材本身朝右，向左才翻转
    }});
  }
  if (ty !== cy) {
    const ms = legMs(ty - cy);
    legs.push({ ms, set: () => {
      el.dataset.y = ty;
      _helper.y = ty; // 同步位置缓存，重建后恢复
      el.style.transition = `left ${ms}ms linear, bottom ${ms}ms linear`;
      el.style.bottom = ty + 'px';
      // 层级与 bottom 联动（helperZ）：树行前方 z=10、进入树行/过道 z=8，始终低于对话框(11)
      el.style.zIndex = String(helperZ(ty));
      el.classList.remove('flip', 'walk', 'walk-up', 'walk-down'); // 走路即重置随机转向，竖直段朝上/下
      el.classList.add(ty > cy ? 'walk-up' : 'walk-down');
    }});
  }
  const run = k => {
    if (k >= legs.length) { if (onDone) onDone(); return; }
    legs[k].set();
    _helper.workTimers.push(setTimeout(() => run(k + 1), legs[k].ms));
  };
  run(0);
}

function walkPatrolRoute(el, startIdx, endIdx, tx, ty, onDone) {
  const n = PATROL_PTS.length;
  const ps = PATROL_PTS[startIdx];
  walkTo(el, ps.x, ps.y, () => {
    if (!el.isConnected) return;
    const fwd = (endIdx - startIdx + n) % n;   // 正向绕环段数
    const back = (startIdx - endIdx + n) % n;  // 反向绕环段数
    const step = fwd <= back ? 1 : -1;
    let k = startIdx;
    const go = () => {
      if (k === endIdx) { walkTo(el, tx, ty, onDone); return; }
      const p = PATROL_PTS[(k + step + n) % n];
      walkTo(el, p.x, p.y, () => {
        if (!el.isConnected) return;
        k = (k + step + n) % n;
        go();
      });
    };
    go();
  });
}

function moveHelperTo(i, action, doWork, waterAfter) {
  const el = document.getElementById('berryHelper');
  if (!el) return;
  stopHelperWander(); // 劳作期间暂停闲逛
  _helper.workTimers.forEach(clearTimeout);
  _helper.workTimers = [];
  el.classList.add('working');
  el.classList.remove('flip', 'water', 'plant', 'walk-up', 'walk-down', 'stand');
  const x = Math.round(PLOT_LEFT[i % 3]);
  const row = Math.floor(i / 3);
  const y = row === 0 ? PATROL_ROW_Y.aisle : PATROL_ROW_Y.bottom;
  const cs = getComputedStyle(el);
  const cx = parseFloat(cs.left) || HOME_X;
  const cy = parseFloat(cs.bottom) || HOME_Y;
  walkPatrolRoute(el, nearestPatrolIdx(cx, cy), nearestPatrolIdx(x, y), x, y, () => {
    if (!el.classList.contains('working')) return;
    el.classList.remove('walk', 'walk-up', 'walk-down', 'flip');
    el.classList.add('plant');
    if (action === 'plant') {
      doWork();
      if (waterAfter) {
        _helper.workTimers.push(setTimeout(() => {
          if (!el.classList.contains('working')) return;
          el.classList.remove('plant');
          el.style.backgroundImage = el.dataset.waterImg; // 换 water 素材
          el.classList.add('water');
          waterAfter();
          _helper.workTimers.push(setTimeout(finishHelperWork, 900));
        }, 400));
      } else {
        _helper.workTimers.push(setTimeout(finishHelperWork, 900));
      }
    } else {
      _helper.workTimers.push(setTimeout(() => {
        el.classList.remove('plant');
        el.style.backgroundImage = el.dataset.waterImg; // 换 water 素材，避免走图被压扁
        el.classList.add('water');
        doWork();
        _helper.workTimers.push(setTimeout(finishHelperWork, 900));
      }, 400));
    }
  });
}

// 劳作结束：从当前最近线路点接入固定巡逻，到点站定并恢复巡逻
function finishHelperWork() {
  const el = document.getElementById('berryHelper');
  if (!el) return;
  el.classList.remove('working', 'water', 'plant', 'flip');
  el.style.backgroundImage = el.dataset.walkImg;
  startHelperWander();
}

// 果园内的帮手角色：待机时随机左右游走
function createHelperChar() {
  const field = $('berryContent')?.querySelector('.berry-field');
  if (!field) return;
  let el = document.getElementById('berryHelper');
  // 位置以缓存为准：render 清空 DOM 后旧节点已不在，靠 walkTo 记录的坐标恢复
  let sx = _helper.x, sy = _helper.y;
  if (el) {
    // 节点残留时以实际 DOM 位置为准并刷新缓存
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.left), py = parseFloat(cs.bottom);
    if (!isNaN(px) && !isNaN(py)) { sx = px; sy = py; _helper.x = px; _helper.y = py; }
    el.remove();
  }
  // 终止旧行走链与巡逻计时器，避免残留定时器驱动新角色
  _helper.workTimers.forEach(clearTimeout);
  _helper.workTimers = [];
  stopHelperWander();
  const prefix = helperSpritePrefix();
  el = document.createElement('div');
  el.id = 'berryHelper';
  el.className = 'berry-helper stand';
  el.dataset.walkImg = `url('./character/${prefix}-walk.png')`;
  el.dataset.waterImg = `url('./character/${prefix}-water.png')`;
  el.style.backgroundImage = el.dataset.walkImg;
  el.style.setProperty('--helper-water', el.dataset.waterImg);
  el.dataset.x = String(sx);
  el.dataset.y = String(sy);
  el.style.left = sx + 'px';
  el.style.bottom = sy + 'px';
  el.style.zIndex = String(helperZ(sy));
  field.appendChild(el);
  startHelperWander();
}

function removeHelperChar() {
  stopHelperWander();
  _helper.workTimers.forEach(clearTimeout);
  _helper.workTimers = [];
  const el = document.getElementById('berryHelper');
  if (el) el.remove();
}

let _patrolIdx = 0; // 当前所在巡逻段下标

function nearestPatrolIdx(x, y) {
  let best = 0, bestD = Infinity;
  PATROL_PTS.forEach((p, k) => {
    const d = Math.abs(p.x - x) + Math.abs(p.y - y);
    if (d < bestD) { bestD = d; best = k; }
  });
  return best;
}

function startHelperWander() {
  stopHelperWander();
  const el = document.getElementById('berryHelper');
  if (!el || el.classList.contains('working')) return;
  const cs = getComputedStyle(el);
  const cx = parseFloat(cs.left) || HOME_X;
  const cy = parseFloat(cs.bottom) || HOME_Y;
  _patrolIdx = nearestPatrolIdx(cx, cy);
  walkPatrolLeg();
}

function walkPatrolLeg() {
  const el = document.getElementById('berryHelper');
  if (!el || el.classList.contains('working')) return;
  const p = PATROL_PTS[_patrolIdx];
  const cs = getComputedStyle(el);
  const cx = parseFloat(cs.left) || HOME_X;
  const cy = parseFloat(cs.bottom) || HOME_Y;
  if (Math.abs(cx - p.x) < 0.5 && Math.abs(cy - p.y) < 0.5) {
    patrolStand(() => {
      _patrolIdx = (_patrolIdx + 1) % PATROL_PTS.length;
      walkPatrolLeg();
    });
    return;
  }
  // 本段方向：竖直段（x 不变）取 y 中部，水平段（y 不变）取 x 中部
  const isV = Math.abs(cx - p.x) < 2;
  const t = 0.3 + Math.random() * 0.4;
  const mid = isV
    ? { x: p.x, y: cy + (p.y - cy) * t }
    : { x: cx + (p.x - cx) * t, y: p.y };
  walkTo(el, mid.x, mid.y, () => {
    if (!el.isConnected || el.classList.contains('working')) return;
    patrolStand(() => {
      if (!el.isConnected || el.classList.contains('working')) return;
      // 走完本段到拐点，再停一下进入下一段
      walkTo(el, p.x, p.y, () => {
        if (!el.isConnected || el.classList.contains('working')) return;
        patrolStand(() => {
          _patrolIdx = (_patrolIdx + 1) % PATROL_PTS.length;
          walkPatrolLeg();
        });
      });
    });
  });
}

// 站定片刻（0.8~1.8s）后继续；被劳作接管或元素重建时静默放弃
function patrolStand(next) {
  const el = document.getElementById('berryHelper');
  if (!el || el.classList.contains('working')) return;
  el.classList.remove('walk', 'walk-up', 'walk-down');
  el.classList.add('stand');
  el.classList.toggle('flip', Math.random() < 0.5);
  _helper.workTimers.push(setTimeout(() => {
    if (!el.isConnected || el.classList.contains('working')) return;
    next();
  }, randInt(PATROL_PAUSE_MIN, PATROL_PAUSE_MAX)));
}

function stopHelperWander() {
  if (_helper.wanderTimer) clearTimeout(_helper.wanderTimer);
  _helper.wanderTimer = null;
}

// 每秒轻量刷新：只更新阶段与剩余时间，不重建 DOM（避免动画闪烁）
function startTimer() {
  if (_timer) return;
  _timer = setInterval(() => {
    if ($('berryView')?.style.display === 'none') { clearInterval(_timer); _timer = null; return; }
    const f = ensureBerryFarm();
    if (isHelperActive()) {
      if (!_helper.nextWorkAt) _helper.nextWorkAt = Date.now() + randInt(HELPER_WORK_MIN, HELPER_WORK_MAX) * 1000;
      if (Date.now() >= _helper.nextWorkAt) {
        _helper.nextWorkAt = Date.now() + randInt(HELPER_WORK_MIN, HELPER_WORK_MAX) * 1000;
        helperWork();
      }
      if (_hoverPlot != null) updateProgress();
    } else {
      _helper.nextWorkAt = 0;
    }
    f.plots.forEach((p, i) => {
      if (!p) return;
      const plotEl = $('berryContent')?.querySelector(`.berry-plot[data-plot="${i}"]`);
      if (!plotEl) return;
      const st = stageOf(p);
      const want = `berry-plot stage-${st.key}${st.key === 'ripe' ? ' ripe' : ''}`;
      if (plotEl.className !== want) plotEl.className = want;
      const frame = plotEl.querySelector('.berry-frame');
      const dry = isDry(p);
      if (frame && (frame.dataset.stage !== st.key || frame.dataset.dry !== String(dry))) {
        frame.dataset.stage = st.key;
        frame.dataset.dry = String(dry);
        frame.dataset.img = st.img;
        frame.setAttribute('style', frameStyle(st, dry));
      }
      // 悬停时同步刷新顶部进度条
      if (_hoverPlot === i) updateProgress();
      // 阶段/剩余时间变化时同步刷新 hover 提示文案（只显示名字）
      if (frame) frame.dataset.tip = plotTip(p);
    });
  }, 1000);
}

// 树果弹框（选种子/告示牌/库存）：点击空白区域收起
document.addEventListener('click', e => {
  const open = ['berryPickerHost', 'berryBoardHost', 'berryStockHost']
    .map(id => $(id))
    .filter(h => h && h.style.display !== 'none');
  if (!open.length) return;
  if (open.some(h => h.contains(e.target))) return;
  open.forEach(h => {
    if (h.id === 'berryPickerHost') closePicker();
    else if (h.id === 'berryBoardHost') closeBoard();
    else closeStock();
  });
});
