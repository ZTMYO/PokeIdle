// ===== 树果农场 =====
// 6 块田地，按真实时间生长：点击浇水回满湿度，成熟后收获。
// 生长进度按 Date.now() 折算，随存档持久化（gameData.berryFarm），离线持续推进。
import { $, showView, tryLoadImage } from './ui.js';
import { phase, gameData, setPrevView, saveGame, randInt } from './state.js';
import { BERRY_ICONS, BERRY_NAMES } from './items.js';
import { setupFoodTooltip } from './pokedex.js';

const PLOT_COUNT = 6;
// 成熟总时长 30~60 分钟随机（同批不会同时成熟）
const MATURE_MIN = 30 * 60 * 1000;
const MATURE_MAX = 60 * 60 * 1000;
// 各阶段占成熟总时长的累计比例：刚种下 / 发芽 / 成长 / 开花结果
const STAGE_DIRT   = 2 / 30;
const STAGE_SPROUT = 8 / 30;
const STAGE_GROW   = 18 / 30;
// 湿度：浇水回满，降到 0 停止生长
const MAX_WATER = 100;
const WATER_DROP = 100 / (10 * 60); // 每秒下降点数（满湿度可撑 10 分钟）
// 种植消耗糖果 + 告示牌每日需求（兑换糖果）
const PLANT_COST = 10;
const BOARD_DEMANDS = 3;
const BOARD_QTY_MIN = 3;
const BOARD_QTY_MAX = 6;
const CANDY_PER_BERRY = 8;
const CANDY_ICON = '<img src="./items/candy.png" style="width:12px;height:12px;vertical-align:-2px;image-rendering:pixelated;" />';

// 帧宽 16px → 显示 32px；树果动画表 6 帧（96×32），帧序 0-1 成长 / 2-3 开花结果 / 4-5 成熟
const FRAME_W = 32;
const BERRY_COLS = 6;

const TREE_DIR = './items/berry-trees/';
const BERRY_DIR = './items/berries/';

// 农田 = 10×9 瓦片，24px/瓦片；耕地条带位于 col 4，每条带种 3 颗
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
// 耕地条带每条带种 3 颗，三等分
const PLOT_LEFT = [48 + 144 / 6 - 16, 48 + 144 / 2 - 16, 48 + 144 * 5 / 6 - 16];
const PLOT_BOTTOM = [FIELD_H - 4 * FIELD_TILE + 5, FIELD_H - 7 * FIELD_TILE + 5];

let _timer = null;   // 每秒刷新计时器
let _picking = null; // 正在选种子的田地下标

function ensureBerryFarm() {
  if (!gameData.berryFarm) gameData.berryFarm = { plots: Array(PLOT_COUNT).fill(null), stock: {} };
  const f = gameData.berryFarm;
  // 兼容旧存档：3 块田地的存档补足到 6 块，已种的树保留
  if (!Array.isArray(f.plots) || f.plots.length !== PLOT_COUNT) {
    const arr = Array(PLOT_COUNT).fill(null);
    (f.plots || []).forEach((p, i) => { if (i < PLOT_COUNT) arr[i] = p; });
    f.plots = arr;
  }
  if (!f.stock) f.stock = {};
  return f;
}

// 日期字符串（YYYY-MM-DD），用于每日需求刷新判断
function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 随机抽 3 种树果，需求量 3~6 颗，糖果奖励随颗数增加
function generateDailyDemands() {
  const pool = BERRY_ICONS.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, BOARD_DEMANDS).map(type => {
    const qty = randInt(BOARD_QTY_MIN, BOARD_QTY_MAX);
    return {
      type,
      qty,
      candy: qty * CANDY_PER_BERRY + randInt(0, 8),
      claimed: false,
    };
  });
}

// 跨天重新生成需求，当天保持不变；返回 true 表示已重建（应保存存档）
function updateDailyDemands(f) {
  const today = dateStr();
  const b = f.board;
  if (b && b.date === today && Array.isArray(b.demands)) return false;
  f.board = { date: today, demands: generateDailyDemands() };
  return true;
}

function ensureBoard() {
  return updateDailyDemands(ensureBerryFarm());
}

// 湿度/生长折算：全部由 Date.now() 折算，离线期间同样正确，无需在计时器里累加
function plotState(p) {
  const since = Date.now() - p.waterAt;
  const dropMs = (p.water / WATER_DROP) * 1000;
  const growMs = Math.min(since, dropMs);
  return {
    water: Math.max(0, p.water - Math.floor(growMs / 1000) * WATER_DROP),
    grownMs: p.grownMs + growMs,
  };
}

// 按真实时间折算当前生长阶段（含动画表定位参数）
function stageOf(plot) {
  const el = plotState(plot).grownMs;
  const total = plot.totalMs || MATURE_MIN; // 兼容旧存档（无 totalMs 按最短时长）
  const d = total * STAGE_DIRT;
  const s = total * STAGE_SPROUT;
  const g = total * STAGE_GROW;
  if (el < d) return { key: 'dirt',   label: '刚种下', img: TREE_DIR + 'dirt_pile.png', cols: 1, frame: 0, count: 1, fh: 32, remain: d - el };
  if (el < s) return { key: 'sprout', label: '发芽中', img: TREE_DIR + 'sprout.png',    cols: 2, frame: 0, count: 2, fh: 32, scale: 0.8, remain: s - el };
  if (el < g) return { key: 'grow',   label: '成长中', img: TREE_DIR + BERRY_ICONS[plot.type], cols: BERRY_COLS, frame: 0, count: 2, fh: 64, remain: g - el };
  if (el < total) return { key: 'fruit',  label: '开花结果', img: TREE_DIR + BERRY_ICONS[plot.type], cols: BERRY_COLS, frame: 2, count: 2, fh: 64, remain: total - el };
  return { key: 'ripe', label: '可收获', img: TREE_DIR + BERRY_ICONS[plot.type], cols: BERRY_COLS, frame: 4, count: 2, fh: 64, remain: 0 };
}

// 生成动画表元素的背景样式，多帧通过 steps() 循环
function frameStyle(st) {
  const bgW = st.cols * FRAME_W;
  const fromX = -(st.frame * FRAME_W);
  let base = `width:${FRAME_W}px;height:${st.fh}px;background-image:url('${encodeURI(st.img)}');background-size:${bgW}px ${st.fh}px;background-position:${fromX}px 0;`;
  // 发芽幼苗缩小显示，底边保持对齐地面，整体上移 2px
  if (st.scale) base += `transform:scale(${st.scale}) translateY(-2px);transform-origin:center bottom;`;
  if (st.count <= 1) return base;
  const toX = fromX - st.count * FRAME_W;
  return `${base}--bfrom:${fromX}px;--bto:${toX}px;animation:berry-frames 0.9s steps(${st.count}, end) infinite;`;
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
        <img class="berry-board-sign berry-icon" src="${TREE_DIR}board.png" data-tip="今日需求" alt="今日需求" />
        ${f.plots.map((p, i) => plotHtml(p, i)).join('')}
      </div>
    </div>
  `;
  drawField(el.querySelector('.berry-field-canvas'));
  bindEvents(el);
}

// 用 terrain tileset 按 FARM 瓦片布局绘制农田画布
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

// 悬停 tooltip：只显示树果名字
function plotTip(p) {
  return BERRY_NAMES[BERRY_ICONS[p.type]] || '树果';
}

function plotHtml(p, i) {
  const pos = `left:${PLOT_LEFT[i % 3]}px;bottom:${PLOT_BOTTOM[Math.floor(i / 3)]}px;`;
  if (!p) {
    return `
      <div class="berry-plot empty" data-plot="${i}" style="${pos}">
        <div class="berry-plot-add berry-icon" data-tip="空地 · 点击种下">＋</div>
      </div>`;
  }
  const st = stageOf(p);
  return `
    <div class="berry-plot stage-${st.key}${st.key === 'ripe' ? ' ripe' : ''}" data-plot="${i}" style="${pos}">
      <div class="berry-frame berry-icon" data-img="${st.img}" data-stage="${st.key}" data-tip="${plotTip(p)}" style="${frameStyle(st)}"></div>
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

function bindEvents(el) {
  el.querySelector('.berry-box-sign')?.addEventListener('click', e => {
    closePicker();
    closeBoard();
    openStock();
    e.stopPropagation(); // 不触发空白关闭
  });
  el.querySelector('.berry-board-sign')?.addEventListener('click', e => {
    closePicker();
    closeStock();
    openBoard();
    e.stopPropagation(); // 不触发空白关闭
  });
  el.querySelectorAll('.berry-plot').forEach(plotEl => {
    plotEl.addEventListener('click', e => {
      const i = Number(plotEl.dataset.plot);
      const p = ensureBerryFarm().plots[i];
      if (!p) openPicker(i);
      else if (stageOf(p).key === 'ripe') harvest(i);
      else waterPlot(i);
      e.stopPropagation(); // 不触发空白关闭
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
  });
}

let _hoverPlot = null; // 当前悬停的田地下标

// 刷新顶部进度条：整体生长进度 + 当前阶段 + 剩余时间
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

// 单条需求行（告示牌渲染与局部刷新共用）
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

// 库存格：上半图标、下半库存个数
function stockHtml(stock) {
  return BERRY_ICONS.map((icon, t) => `
    <div class="board-stock-item">
      <img class="berry-icon" data-src="${BERRY_DIR}${icon}" data-tip="${BERRY_NAMES[icon] || '树果'}" alt="" />
      <span class="board-stock-count">×${stock[t] || 0}</span>
    </div>`).join('');
}

function boardHtml() {
  const f = ensureBerryFarm();
  ensureBoard();
  const b = f.board;
  const stock = f.stock || {};
  const demands = b.demands.map((d, k) => boardDemandHtml(d, k, stock)).join('');
  return `
    <div class="berry-picker berry-board">
      <div class="berry-picker-head">
        <span class="berry-picker-title">今日需求</span>
        <div class="berry-picker-x" data-board-close>✕</div>
      </div>
      <div class="board-demands">${demands}</div>
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
    btn.addEventListener('click', () => tradeBoard(Number(btn.dataset.di)));
  });
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

// 兑换：消耗库存树果换取糖果，单条需求当天只能兑换一次
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
      btn.addEventListener('click', () => tradeBoard(Number(btn.dataset.di)));
    });
  }
}

// 收获成熟树果：得到 2~4 颗存入库存，田地清空
function harvest(i) {
  const f = ensureBerryFarm();
  const p = f.plots[i];
  if (!p || stageOf(p).key !== 'ripe') return;
  const qty = 2 + randInt(0, 3);
  gameData.stats.totalHarvests = (gameData.stats.totalHarvests || 0) + 1;
  gameData.stats.totalBerriesHarvested = (gameData.stats.totalBerriesHarvested || 0) + qty;
  f.stock[p.type] = (f.stock[p.type] || 0) + qty;
  f.plots[i] = null;
  saveGame();
  render();
}

// 浇水：先沉淀已生长时间再浇满湿度，避免 waterAt 重置导致进度回退
function waterPlot(i) {
  const p = ensureBerryFarm().plots[i];
  if (!p) return;
  p.grownMs = plotState(p).grownMs;
  p.water = MAX_WATER;
  p.waterAt = Date.now();
  saveGame();
  spawnSpray(i);
  if (_hoverPlot === i) updateProgress();
}

// 浇水动画：喷壶贴图淡出，同时撒落水滴粒子
function spawnSpray(i) {
  const plotEl = $('berryContent')?.querySelector(`.berry-plot[data-plot="${i}"]`);
  if (!plotEl) return;
  const img = document.createElement('img');
  img.className = 'berry-spray';
  img.src = TREE_DIR + 'spray' + randInt(1, 4) + '.png';
  img.alt = '';
  img.addEventListener('animationend', () => img.remove());
  plotEl.appendChild(img);
  // 水滴粒子：大小不一（70% 1px 小颗粒，30% 2px 大颗粒）
  for (let k = 0; k < 12; k++) {
    const drop = document.createElement('div');
    drop.className = 'berry-drop';
    const size = Math.random() < 0.7 ? 1 : 2;
    drop.style.width = size + 'px';
    drop.style.height = size + 'px';
    drop.style.setProperty('--dx', Math.floor(Math.random() * 33 - 16) + 'px'); // 整数像素偏移
    drop.style.setProperty('--delay', (Math.random() * 0.15).toFixed(2) + 's');
    drop.addEventListener('animationend', () => drop.remove(), { once: true });
    plotEl.appendChild(drop);
  }
}

// 每秒轻量刷新：只更新阶段与剩余时间，不重建 DOM（避免动画闪烁）
function startTimer() {
  if (_timer) return;
  _timer = setInterval(() => {
    if ($('berryView')?.style.display === 'none') { clearInterval(_timer); _timer = null; return; }
    const f = ensureBerryFarm();
    f.plots.forEach((p, i) => {
      if (!p) return;
      const plotEl = $('berryContent')?.querySelector(`.berry-plot[data-plot="${i}"]`);
      if (!plotEl) return;
      const st = stageOf(p);
      const want = `berry-plot stage-${st.key}${st.key === 'ripe' ? ' ripe' : ''}`;
      if (plotEl.className !== want) plotEl.className = want;
      // 阶段切换（含同图帧表的成长/结果/成熟）时刷新帧样式
      const frame = plotEl.querySelector('.berry-frame');
      if (frame && frame.dataset.stage !== st.key) {
        frame.dataset.stage = st.key;
        frame.dataset.img = st.img;
        frame.setAttribute('style', frameStyle(st));
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
