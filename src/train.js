// 训练 App：训练场 —— 把宝可梦放进训练槽，按真实时间挂机自动获得经验（不消耗糖果）
// 页面为 tile 地图铺满 + 告示牌入口：点击告示牌弹出配置/数据面板
// 训练中的宝可梦会以像素图标在场地上随机走动
import { $, showView, tryLoadImage, setupFoodTooltip } from './ui.js';
import { gameData, getPokemonByIndex, saveGame, pushNav, addSystemLog, ensureGender, genderBadge } from './state.js';
import {
  TRAIN_SLOTS, TRAIN_XP_PER_MIN, TRAIN_LAZY, MAX_LEVEL,
  TRAIN_SATIETY_MAX, TRAIN_SATIETY_DRAIN_PER_MIN, TRAIN_SATIETY_EAT_AT,
  TRAIN_SATIETY_PER_BERRY, TRAIN_HUNGRY_LAZY_MULT,
} from './config.js';
import { ensureBerryFarm } from './berry.js';
import { BERRY_ICONS, BERRY_NAMES } from './items.js';

// 升级经验需求（与对战结算一致）
const expNeed = (lv) => 25 + lv * 20;
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

// 瓦片：tileset 单格 16px，显示放大到 24px
const TILE_SRC = 16;
const TILE = 24;
const TILESET = './terrain/terrain-tileset.png';
const BOARD_IMG = './items/berry-trees/board.png';
const BOX_IMG = './items/berry-trees/box.png';
const BERRY_DIR = './items/berries/';

// 训练场地图（{col,row} 为 terrain tileset 坐标）
const TRAIN = {
  tiles: [
    [[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41]],
    [[1,22],[1,22],[1,22],[2,22],[5,1],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]],
    [[1,26],[1,26],[1,26],[2,23],[5,1],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]],
    [[1,26],[1,26],[1,26],[2,23],[5,1],[1,0],[1,0],[1,0],[5,1],[5,1],[5,1]],
    [[1,26],[1,26],[1,26],[2,23],[1,0],[1,0],[1,0],[1,0],[5,1],[5,1],[5,1]],
    [[2,0],[2,0],[2,0],[2,0],[1,0],[1,0],[1,0],[1,0],[5,1],[5,1],[5,1]],
    [[1,0],[4,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]],
    [[1,0],[1,0],[1,0],[5,1],[5,1],[5,1],[1,0],[1,0],[1,0],[1,0],[1,0]],
    [[1,0],[1,0],[1,0],[5,1],[5,1],[5,1],[1,0],[1,0],[1,0],[1,0],[1,0]],
  ],
};
TRAIN.w = TRAIN.tiles[0].length;
TRAIN.h = TRAIN.tiles.length;
const TRAIN_W = TRAIN.w * TILE;
const TRAIN_H = TRAIN.h * TILE;

// 可走动瓦片：水域（水系宝可梦专属）与陆地；陆地宝可梦不去第一行、最下面一行与最后一列
const TILE_WATER = '1,26';
const TILE_LAND = new Set(['1,0', '5,1', '1,41']);
const BLOCKED_CELLS = new Set(['8,1', '9,1', '10,1']);
const WATER_CELLS = [];
const LAND_CELLS = [];
for (let r = 0; r < TRAIN.h; r++) {
  for (let c = 0; c < TRAIN.w; c++) {
    const key = TRAIN.tiles[r][c].join(',');
    if (BLOCKED_CELLS.has(c + ',' + r)) continue;
    if (key === TILE_WATER && r < TRAIN.h - 1) WATER_CELLS.push({ c, r });
    else if (TILE_LAND.has(key) && r > 0 && r < TRAIN.h - 1 && c < TRAIN.w - 1) LAND_CELLS.push({ c, r });
  }
}

let _timer = null;
const _walkers = new Map();  // id -> walker 状态
const _walkerPos = new Map(); // id -> 上次位置 {c,r,facing}（页面重绘后沿用）

// 保证训练场数据存在并补齐槽位数（兼容旧存档）
export function ensureTraining() {
  if (!gameData.training || !Array.isArray(gameData.training.slots)) {
    gameData.training = { slots: [] };
  }
  while (gameData.training.slots.length < TRAIN_SLOTS) gameData.training.slots.push(null);
  return gameData.training;
}

// 结算截至 now 已积累的经验：推进 startAt 并应用升级；返回是否发生过升级
export function processTrainingXp(now = Date.now()) {
  const t = ensureTraining();
  let leveled = false, fed = false, lazyStarted = false;
  for (let i = 0; i < t.slots.length; i++) {
    const slot = t.slots[i];
    if (!slot) continue;
    const entry = (gameData.roster || []).find(x => x.id === slot.id);
    if (!entry || entry.inRoster === false) { t.slots[i] = null; continue; }
    if (slot.lazyUntil && now < slot.lazyUntil) continue; // 偷懒中：暂停积累
    slot.lazyUntil = 0;
    const elapsed = Math.max(0, now - slot.startAt);
    if (elapsed <= 0) continue;
    const effMin = Math.min(10, elapsed / 60000); // 离线补算时长截断：饱食度/偷懒都与它一致，避免一次返回瞬间扣光
    entry.exp = (entry.exp || 0) + (elapsed / 1000) * (TRAIN_XP_PER_MIN / 60);
    slot.startAt = now;
    const levelBefore = entry.level || 1;
    while ((entry.level || 1) < MAX_LEVEL && entry.exp >= expNeed(entry.level || 1)) {
      entry.exp -= expNeed(entry.level || 1);
      entry.level = (entry.level || 1) + 1;
      leveled = true;
    }
    // 一次补算可能连升多级：只记一条最终等级，避免刷屏
    if ((entry.level || 1) > levelBefore) {
      addSystemLog('train_levelup', { pokemon: entry.species, level: entry.level });
    }
    if ((entry.level || 1) >= MAX_LEVEL) entry.exp = 0; // 满级后不再积累经验
    // 饱食度：训练中随时间下降；低于阈值自动吃库存里爱吃的树果
    if (slot.satiety == null) slot.satiety = TRAIN_SATIETY_MAX;
    slot.satiety = Math.max(0, slot.satiety - effMin * TRAIN_SATIETY_DRAIN_PER_MIN);
    if (slot.satiety < TRAIN_SATIETY_EAT_AT && eatFavorite(slot, entry)) fed = true;
    entry.satiety = slot.satiety; // 同步到个体记录：取出再放回时沿用当前饱食度
    // 随机偷懒：只影响之后，不扣已结算经验；饱食度越低越容易偷懒（满饱食 1 倍，归零 TRAIN_HUNGRY_LAZY_MULT 倍）
    const hungerMult = 1 + (1 - slot.satiety / TRAIN_SATIETY_MAX) * (TRAIN_HUNGRY_LAZY_MULT - 1);
    if (TRAIN_LAZY.enabled && Math.random() < Math.min(0.8, TRAIN_LAZY.chancePerMin * hungerMult * effMin)) {
      slot.lazyUntil = now + randInt(TRAIN_LAZY.durationMin, TRAIN_LAZY.durationMax);
      lazyStarted = true;
      addSystemLog('train_lazy', { pokemon: entry.species });
    }
  }
  if (leveled || fed || lazyStarted) saveGame();
  return leveled;
}

// 从库存吃一颗该宝可梦爱吃的树果（pokedex.foods，下标对应 BERRY_ICONS）补饱食度；成功进食返回 true
function eatFavorite(slot, entry) {
  const poke = getPokemonByIndex(String(entry.species));
  if (!poke || !Array.isArray(poke.foods) || !poke.foods.length) return false;
  const stock = ensureBerryFarm().stock || {};
  const favs = poke.foods.filter(t => (stock[t] || 0) > 0);
  if (!favs.length) return false;
  const t = favs[Math.floor(Math.random() * favs.length)];
  stock[t] = (stock[t] || 0) - 1;
  if (stock[t] <= 0) delete stock[t];
  slot.satiety = Math.min(TRAIN_SATIETY_MAX, slot.satiety + TRAIN_SATIETY_PER_BERRY);
  addSystemLog('train_feed', { pokemon: entry.species, berry: t });
  return true;
}

// 把槽位当前的饱食度记回个体记录（取出训练时调用），夹取到合法区间
function saveSatietyToEntry(slot) {
  if (!slot || slot.satiety == null) return;
  const entry = (gameData.roster || []).find(x => x.id === slot.id);
  if (entry) entry.satiety = Math.max(0, Math.min(TRAIN_SATIETY_MAX, slot.satiety));
}

export function showTrainView() {
  pushNav('trainView');
  processTrainingXp();
  render();
  showView('trainView');
  startTimer();
}

// 训练/队伍互斥：入队后把该个体从所有训练槽移除（取出前把饱食度记回个体，放回时沿用）
export function removeTrainingByPokemon(id) {
  const t = ensureTraining();
  let changed = false;
  for (let i = 0; i < t.slots.length; i++) {
    if (t.slots[i] && t.slots[i].id === id) {
      saveSatietyToEntry(t.slots[i]);
      const entry = (gameData.roster || []).find(x => x.id === id);
      if (entry) addSystemLog('train_end', { pokemon: entry.species });
      t.slots[i] = null;
      changed = true;
    }
  }
  if (changed) saveGame();
  return changed;
}

// 仓库选取：从列表项放入训练（空槽点击跳转仓库后由列表项触发）
export function addToTraining(id, slot) {
  const t = ensureTraining();
  if (t.slots[slot]) return; // 目标槽已被占用则不处理
  const entry = (gameData.roster || []).find(x => x.id === id);
  // 饱食度沿用个体记录值（取出再放回不重置）；新个体/无记录默认满饱食
  const satiety = entry && entry.satiety != null
    ? Math.max(0, Math.min(TRAIN_SATIETY_MAX, entry.satiety))
    : TRAIN_SATIETY_MAX;
  t.slots[slot] = { id, startAt: Date.now(), satiety };
  // 训练中的宝可梦不能留在配队队伍里
  if (Array.isArray(gameData.team)) {
    gameData.team = gameData.team.filter(x => x !== id);
  }
  // 训练/饲育屋/配队三方互斥：放入训练后从饲育屋移除
  import('./nursery.js').then(m => m.removeNurseryByPokemon(id));
  if (entry) addSystemLog('train_start', { pokemon: entry.species, slot });
  saveGame();
  processTrainingXp();
  render();
  refreshBoard(); // 弹框保持打开，仅刷新内容
  showView('trainView');
  startTimer();
}

function render() {
  const box = $('trainContent');
  if (!box) return;
  const t = ensureTraining();
  box.innerHTML = `
    <div class="train-app">
      <div class="train-field" style="width:${TRAIN_W}px;height:${TRAIN_H}px;">
        <canvas class="train-field-canvas"></canvas>
        <div class="train-walkers" id="trainWalkers"></div>
        <img class="train-box-sign berry-icon" src="${BOX_IMG}" data-tip="树果库存" alt="库存" />
        <img class="train-board-sign berry-icon" src="${BOARD_IMG}" data-tip="点击管理宝可梦" alt="告示牌" />
      </div>
    </div>`;
  drawField(box.querySelector('.train-field-canvas'));
  box.querySelector('.train-box-sign')?.addEventListener('click', (e) => {
    e.stopPropagation(); // 避免触发表层关闭监听
    closeBoard();
    openStockPanel();
  });
  box.querySelector('.train-board-sign')?.addEventListener('click', (e) => {
    e.stopPropagation(); // 避免触发表层关闭监听后又被打开
    closeStockPanel();
    if (boardOpen()) closeBoard();
    else openBoard();
  });
  // innerHTML 已重建场地层，旧 walker 元素全部失效，清空后按当前配置重建（位置沿用 _walkerPos）
  _walkers.clear();
  syncWalkers();
}

// 绘制 tile 地图到画布（与农田同款 tileset，放大 1.5x 像素风）
function drawField(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = TRAIN_W * dpr;
  canvas.height = TRAIN_H * dpr;
  canvas.style.width = TRAIN_W + 'px';
  canvas.style.height = TRAIN_H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  const img = new Image();
  img.onload = () => {
    for (let r = 0; r < TRAIN.h; r++) {
      for (let c = 0; c < TRAIN.w; c++) {
        const [col, row] = TRAIN.tiles[r][c];
        ctx.drawImage(img, col * TILE_SRC, row * TILE_SRC, TILE_SRC, TILE_SRC, c * TILE, r * TILE, TILE, TILE);
      }
    }
  };
  img.src = TILESET;
}

// ---------- 场地上的训练宝可梦（随机走动） ----------
function syncWalkers() {
  const layer = $('trainWalkers');
  if (!layer) return;
  const t = ensureTraining();
  const active = new Set(t.slots.filter(Boolean).map(s => s.id));
  for (const [id, w] of _walkers) {
    if (active.has(id)) continue;
    w.el.remove();
    _walkers.delete(id);
  }
  // 已不在训练的宝可梦：清掉残留位置记录
  for (const id of [..._walkerPos.keys()]) {
    if (!active.has(id)) _walkerPos.delete(id);
  }
  t.slots.filter(Boolean).forEach(slot => {
    if (_walkers.has(slot.id)) return;
    const entry = (gameData.roster || []).find(x => x.id === slot.id);
    if (!entry || entry.inRoster === false) return;
    const poke = getPokemonByIndex(String(entry.species));
    if (!poke) return;
    const isWater = (poke.types || []).includes('水');
    const cells = isWater ? WATER_CELLS : LAND_CELLS;
    if (!cells.length) return;
    const prev = _walkerPos.get(slot.id);
    // 已被其它宝可梦占用的格子：出生点也不重叠
    const occupied = new Set();
    for (const [oid, op] of _walkerPos) {
      if (oid !== slot.id) occupied.add(op.c + ',' + op.r);
    }
    let start;
    if (prev && cells.some(c => c.c === prev.c && c.r === prev.r)) {
      start = prev;
    } else {
      const free = cells.filter(c => !occupied.has(c.c + ',' + c.r));
      start = free.length ? free[Math.floor(Math.random() * free.length)] : cells[Math.floor(Math.random() * cells.length)];
    }
    const el = document.createElement('div');
    el.className = 'train-walker';
    el.style.left = (start.c * TILE) + 'px';
    el.style.top = (start.r * TILE) + 'px';
    el.innerHTML = '<div class="train-walker-flip"><img class="train-walker-img" alt=""></div>'
      + '<span class="train-walker-zzz"><i>z</i><i>z</i><i>z</i></span>';
    layer.appendChild(el);
    const img = el.querySelector('img');
    if (poke.icon) tryLoadImage(img, poke.icon);
    // 随机相位：多个宝可梦的闪烁动画错开，避免同步
    img.style.animationDelay = '-' + (Math.random() * 0.5).toFixed(2) + 's';
    if (start.facing < 0) el.querySelector('.train-walker-flip').style.transform = 'scaleX(-1)';
    el.classList.toggle('lazy', isLazy(slot));
    if (isLazy(slot)) img.classList.add('lazy');
    // 点击（抓取）偷懒的宝可梦：把它叫醒，立即恢复训练
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      wakeUp(slot, img);
    });
    // hover 显示名字/等级/状态提示
    el.addEventListener('mouseenter', () => showWalkerTip(el, slot));
    el.addEventListener('mouseleave', hideWalkerTip);
    _walkerPos.set(slot.id, { c: start.c, r: start.r, facing: start.facing || 1 });
    _walkers.set(slot.id, {
      el, img, isWater,
      nextAt: Date.now() + randInt(400, 1400),
    });
  });
}

// 每 tick 让在场宝可梦随机移动一格；偷懒中的原地发呆；不与其它宝可梦重叠
function walkerTick(now = Date.now()) {
  const t = ensureTraining();
  const slotById = new Map(t.slots.filter(Boolean).map(s => [s.id, s]));
  for (const [id, w] of _walkers) {
    const slot = slotById.get(id);
    const lazy = !!slot && isLazy(slot);
    // 偷懒的宝可梦暂停上下跳动画
    w.img.classList.toggle('lazy', lazy);
    w.el.classList.toggle('lazy', lazy);
    if (now < w.nextAt) continue;
    if (lazy) continue; // 偷懒中不动
    w.nextAt = now + randInt(900, 2200);
    const prev = _walkerPos.get(id) || { c: 0, r: 0, facing: 1 };
    const cells = w.isWater ? WATER_CELLS : LAND_CELLS;
    // 其它宝可梦当前占用的格子（含偷懒原地发呆的）
    const occupied = new Set();
    for (const [oid, op] of _walkerPos) {
      if (oid !== id) occupied.add(op.c + ',' + op.r);
    }
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (let attempt = 0; attempt < 4; attempt++) {
      const [dc, dr] = dirs[Math.floor(Math.random() * dirs.length)];
      const nc = prev.c + dc, nr = prev.r + dr;
      if (nc < 0 || nc >= TRAIN.w || nr < 0 || nr >= TRAIN.h) continue;
      if (!cells.some(c => c.c === nc && c.r === nr)) continue;
      if (occupied.has(nc + ',' + nr)) continue;
      prev.c = nc;
      prev.r = nr;
      // 图标素材默认朝左：向左走不镜像，向右走才镜像
      if (dc !== 0) prev.facing = dc < 0 ? 1 : -1;
      _walkerPos.set(id, prev);
      w.el.style.left = (nc * TILE) + 'px';
      w.el.style.top = (nr * TILE) + 'px';
      // 转向直接镜像，不做 3D 翻转
      w.el.querySelector('.train-walker-flip').style.transform = prev.facing < 0 ? 'scaleX(-1)' : '';
      break;
    }
  }
}

// ---------- 告示牌面板（复用农田底部的 picker 弹层） ----------
function isLazy(slot) {
  return !!slot && !!slot.lazyUntil && Date.now() < slot.lazyUntil;
}

// 点击（抓取）偷懒的宝可梦：清除偷懒状态立即恢复训练
function wakeUp(slot, img) {
  if (!slot || !slot.lazyUntil || Date.now() >= slot.lazyUntil) return;
  slot.lazyUntil = 0;
  const entry = (gameData.roster || []).find(x => x.id === slot.id);
  if (entry) addSystemLog('train_wake', { pokemon: entry.species });
  saveGame();
  if (img) {
    img.classList.remove('lazy');
    img.closest('.train-walker')?.classList.remove('lazy'); // 同步移除，睡觉粒子立即消失
  }
  refreshSlots(); // 同步告示牌上的状态标签
}

// ---------- 场地宝可梦 hover 提示（名字 · 等级 · 状态，样式对齐农场树果提示） ----------
let _walkerTip = null;

function walkerTipEl() {
  if (_walkerTip && !_walkerTip.isConnected) _walkerTip = null;
  if (!_walkerTip) {
    _walkerTip = document.createElement('div');
    _walkerTip.className = 'train-walker-tip';
    _walkerTip.style.display = 'none';
    document.body.appendChild(_walkerTip);
  }
  return _walkerTip;
}

function showWalkerTip(el, slot) {
  const entry = (gameData.roster || []).find(x => x.id === slot.id);
  if (!entry) return;
  const poke = getPokemonByIndex(String(entry.species));
  const lazy = isLazy(slot);
  const tip = walkerTipEl();
  if (!tip) return;
  const shiny = entry.shiny
    ? ' <svg viewBox="0 0 1024 1024" width="10" height="10" style="vertical-align:-1px;color:#fff;"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>'
    : '';
  const sat = slot.satiety == null ? TRAIN_SATIETY_MAX : Math.round(slot.satiety);
  tip.innerHTML = `${poke ? poke.name : '#' + entry.species}${shiny} · ${genderBadge(ensureGender(entry))}Lv${entry.level || 1} · 饱食${sat}
    <span class="train-walker-tip-status${lazy ? ' lazy' : ''}">${lazy ? '偷懒中' : '训练中'}</span>`;
  tip.style.display = '';
  const er = el.getBoundingClientRect();
  const left = er.left + er.width / 2 - tip.offsetWidth / 2;
  tip.style.left = Math.max(4, Math.min(left, window.innerWidth - tip.offsetWidth - 4)) + 'px';
  tip.style.top = Math.max(4, er.top - tip.offsetHeight - 4) + 'px';
}

function hideWalkerTip() {
  const tip = walkerTipEl();
  if (tip) tip.style.display = 'none';
}

function boardOpen() {
  const host = $('trainBoardHost');
  return !!host && host.style.display !== 'none';
}

function boardHost() {
  let host = $('trainBoardHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'trainBoardHost';
    host.style.display = 'none';
    $('trainView').appendChild(host);
  }
  return host;
}

function openBoard() {
  const host = boardHost();
  host.innerHTML = boardHtml();
  host.style.display = '';
  loadCellIcons(host);
  bindSlots(host);
  host.querySelectorAll('[data-board-close]').forEach(btn => btn.addEventListener('click', closeBoard));
}

function closeBoard() {
  const host = $('trainBoardHost');
  if (!host) return;
  host.innerHTML = '';
  host.style.display = 'none';
}

// ---------- 树果库存面板（纸箱入口，供训练的宝可梦吃爱吃树果） ----------
function stockPanelHost() {
  let host = $('trainStockHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'trainStockHost';
    host.style.display = 'none';
    $('trainView').appendChild(host);
  }
  return host;
}

function openStockPanel() {
  const host = stockPanelHost();
  host.innerHTML = stockPanelHtml();
  host.style.display = '';
  host.querySelectorAll('img[data-src]').forEach(im => tryLoadImage(im, im.dataset.src));
  host.querySelectorAll('[data-stock-close]').forEach(btn => btn.addEventListener('click', closeStockPanel));
}

function closeStockPanel() {
  const host = $('trainStockHost');
  if (!host) return;
  host.innerHTML = '';
  host.style.display = 'none';
}

function stockPanelHtml() {
  const stock = ensureBerryFarm().stock || {};
  const count = ensureTraining().slots.filter(Boolean).length;
  const note = count ? `训练中的 ${count} 只宝可梦会自动吃掉爱吃的树果补充饱食度` : '放入宝可梦训练后，会自动吃掉爱吃的树果补充饱食度';
  return `
    <div class="berry-picker berry-stock-panel">
      <div class="berry-picker-head">
        <span class="berry-picker-title">树果库存</span>
        <div class="berry-picker-x" data-stock-close>✕</div>
      </div>
      <div class="train-stock-note">${note}</div>
      <div class="board-stock">${BERRY_ICONS.map((icon, t) => `
        <div class="board-stock-item">
          <img class="berry-icon" data-src="${BERRY_DIR}${icon}" data-tip="${BERRY_NAMES[icon] || '树果'}" alt="" />
          <span class="board-stock-count">×${stock[t] || 0}</span>
        </div>`).join('')}</div>
    </div>`;
}

// 库存面板打开时每秒同步数量（进食会扣减）
function refreshStockPanel() {
  const host = $('trainStockHost');
  if (!host || host.style.display === 'none') return;
  const stock = ensureBerryFarm().stock || {};
  host.querySelectorAll('.board-stock-item').forEach((item, t) => {
    const cnt = item.querySelector('.board-stock-count');
    if (cnt) cnt.textContent = `×${stock[t] || 0}`;
  });
}

// 点击面板外部关闭（页面本身隐藏时不做自动关闭，保证跳仓库回来后仍打开）
document.addEventListener('click', (e) => {
  if ($('trainView')?.style.display === 'none') return;
  const open = ['trainBoardHost', 'trainStockHost']
    .map(id => $(id))
    .filter(h => h && h.style.display !== 'none');
  if (!open.length) return;
  if (open.some(h => h.contains(e.target))) return;
  open.forEach(h => {
    if (h.id === 'trainBoardHost') closeBoard();
    else closeStockPanel();
  });
});

function boardHtml() {
  const t = ensureTraining();
  return `
    <div class="berry-picker berry-board train-panel">
      <div class="berry-picker-head">
        <span class="berry-picker-title">训练场</span>
        <div class="berry-picker-x" data-board-close>✕</div>
      </div>
      <div class="berry-board-sections">
        <div class="train-cell-row">
          ${t.slots.map((slot, i) => cellHtml(slot, i)).join('')}
        </div>
        ${statusBlockHtml(t)}
      </div>
    </div>`;
}

// 底部状态区：每只训练中宝可梦一行（名字/等级 + 状态 + XP 进度条，不显示图标）
function statusBlockHtml(t) {
  const rows = [];
  for (let i = 0; i < t.slots.length; i++) {
    if (t.slots[i]) rows.push(statusRowHtml(t.slots[i], i));
  }
  if (!rows.length) return `<div class="train-status-empty">点击上方格子放入宝可梦开始训练</div>`;
  return `<div class="train-status-list">${rows.join('')}</div>`;
}

// 顶部槽位格：点击空位去仓库放入，点击已有宝可梦取出
function cellHtml(slot, i) {
  if (!slot) return `<div class="train-cell empty" data-slot="${i}" title="点击放入宝可梦">＋</div>`;
  const entry = (gameData.roster || []).find(x => x.id === slot.id);
  if (!entry || entry.inRoster === false) return `<div class="train-cell empty" data-slot="${i}" title="点击放入宝可梦">＋</div>`;
  return `<div class="train-cell${isLazy(slot) ? ' lazy' : ''}" data-slot="${i}" title="点击取出">
    <img class="train-cell-icon" data-icon="${entry.species}" alt="">
  </div>`;
}

// 加载槽位格图标
function loadCellIcons(host) {
  host.querySelectorAll('.train-cell-icon[data-icon]').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
}

// 底部状态行：名字/等级 + 状态标签 + XP 进度条 + 饱食度 + 数值（无图标）
function statusRowHtml(slot, i) {
  const entry = (gameData.roster || []).find(x => x.id === slot.id);
  if (!entry || entry.inRoster === false) return '';
  const poke = getPokemonByIndex(String(entry.species));
  const name = poke ? poke.name : `#${entry.species}`;
  const lv = entry.level || 1;
  const cur = entry.exp || 0;
  const need = expNeed(lv);
  const ratio = Math.min(100, Math.max(0, (cur / need) * 100));
  const lazy = isLazy(slot);
  const sat = slot.satiety == null ? TRAIN_SATIETY_MAX : Math.round(slot.satiety);
  const satCls = sat >= 70 ? 'full' : sat >= 40 ? 'mid' : 'low';
  const shiny = entry.shiny
    ? '<svg viewBox="0 0 1024 1024" width="10" height="10" style="flex-shrink:0;color:var(--ui-color);vertical-align:-1px;"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>'
    : '';
  return `<div class="train-status-row" data-slot="${i}">
    <span class="train-status-dot${lazy ? ' lazy' : ''}"></span>
    <span class="train-status-name"><span class="train-status-name-text">${name}</span>${shiny}<em>${genderBadge(ensureGender(entry))}Lv${lv}</em></span>
    <div class="train-status-bar"><div class="xp-fill" style="width:${ratio.toFixed(1)}%"></div></div>
    <span class="train-status-satiety ${satCls}" title="饱食度"><span class="train-status-sat-track"><span class="train-status-sat-fill" style="width:${sat}%"></span></span><em class="train-status-sat-num">${sat}</em></span>
    <span class="train-status-nums">${Math.floor(cur)} / ${need}</span>
  </div>`;
}

function bindSlots(host) {
  host.querySelectorAll('.train-cell[data-slot]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation(); // 防止格子被 refreshBoard 替换后冒泡，误触“点击外部关闭面板”
      const t = ensureTraining();
      const i = Number(el.dataset.slot);
      if (t.slots[i]) {
        stopTraining(i);
      } else {
        // 弹框保持打开，去仓库选一只放进该槽
        const exclude = t.slots.filter(Boolean).map(s => s.id);
        import('./roster.js').then(m => m.showRosterPicker({ mode: 'train', slot: i, from: 'trainView', exclude }));
      }
    });
  });
}

function stopTraining(idx) {
  const t = ensureTraining();
  if (!t.slots[idx]) return;
  const entry = (gameData.roster || []).find(x => x.id === t.slots[idx].id);
  if (entry) addSystemLog('train_end', { pokemon: entry.species });
  saveSatietyToEntry(t.slots[idx]); // 取出时把当前饱食度记回个体，放回时沿用
  t.slots[idx] = null;
  saveGame();
  render();
  refreshBoard(); // 弹框保持打开，仅刷新内容
}

// 弹框保持打开时局部刷新内容（不重建弹层，避免闪烁/关闭）
function refreshBoard() {
  const host = $('trainBoardHost');
  if (!host || host.style.display === 'none') return;
  const t = ensureTraining();
  const wrap = host.querySelector('.berry-board-sections');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="train-cell-row">${t.slots.map((slot, i) => cellHtml(slot, i)).join('')}</div>
    ${statusBlockHtml(t)}`;
  loadCellIcons(wrap);
  bindSlots(host);
}

// 每秒结算 1 秒经验并原地刷新进度（页面隐藏时自动停止，避免常驻定时器）
function startTimer() {
  setupFoodTooltip();
  if (_timer) return;
  _timer = setInterval(() => {
    if ($('trainView')?.style.display === 'none') { clearInterval(_timer); _timer = null; return; }
    processTrainingXp();
    refreshSlots();
    walkerTick();
    refreshStockPanel();
  }, 1000);
}

function refreshSlots() {
  const t = ensureTraining();
  const host = $('trainBoardHost');
  if (!host || host.style.display === 'none') return;
  for (let i = 0; i < t.slots.length; i++) {
    const slot = t.slots[i];
    if (!slot) continue;
    const entry = (gameData.roster || []).find(x => x.id === slot.id);
    if (!entry) { openBoard(); return; }
    const cur = entry.exp || 0;
    const need = expNeed(entry.level || 1);
    const ratio = Math.min(100, Math.max(0, (cur / need) * 100));
    // 顶部槽位格：同步偷懒底色
    const cell = host.querySelector(`.train-cell[data-slot="${i}"]`);
    if (cell) cell.classList.toggle('lazy', isLazy(slot));
    // 底部状态行：同步进度条 / 数值 / 等级 / 状态
    const el = host.querySelector(`.train-status-row[data-slot="${i}"]`);
    if (el) {
      const fill = el.querySelector('.xp-fill');
      if (fill) fill.style.width = ratio.toFixed(1) + '%';
      const nums = el.querySelector('.train-status-nums');
      if (nums) nums.textContent = `${Math.floor(cur)} / ${need}`;
      const lv = el.querySelector('.train-status-name em');
      if (lv) lv.innerHTML = `${genderBadge(ensureGender(entry))}Lv${entry.level || 1}`;
      const st = el.querySelector('.train-status-dot');
      if (st) st.classList.toggle('lazy', isLazy(slot));
      // 饱食度条与数字：随每秒结算同步（吃到树果时数值会上涨）
      const satEl = el.querySelector('.train-status-satiety');
      if (satEl) {
        const sat = slot.satiety == null ? TRAIN_SATIETY_MAX : Math.round(slot.satiety);
        satEl.className = 'train-status-satiety ' + (sat >= 70 ? 'full' : sat >= 40 ? 'mid' : 'low');
        const fill = satEl.querySelector('.train-status-sat-fill');
        if (fill) fill.style.width = sat + '%';
        const num = satEl.querySelector('.train-status-sat-num');
        if (num) num.textContent = String(sat);
      }
    }
  }
}
