// 训练 App：训练场 —— 把宝可梦放进训练槽，按真实时间挂机自动获得经验（不消耗糖果）
// 页面为 tile 地图铺满 + 告示牌入口：点击告示牌弹出配置/数据面板
// 训练中的宝可梦会以像素图标在场地上随机走动
import { $, showView, tryLoadImage, setupFoodTooltip, showConfirmBar } from './ui.js';
import { gameData, getPokemonByIndex, saveGame, pushNav, addSystemLog, ensureGender, genderBadge } from './state.js';
import {
  TRAIN_SLOTS, TRAIN_XP_PER_MIN, TRAIN_LAZY, MAX_LEVEL,
  TRAIN_SATIETY_MAX, TRAIN_SATIETY_DRAIN_PER_MIN, TRAIN_SATIETY_EAT_AT,
  TRAIN_SATIETY_PER_BERRY, REGION_CYCLE,
} from './config.js';
import { ensureBerryFarm } from './berry.js';
import { removePokemonFromAllTeams, isInAnyTeam } from './team.js';
import { BERRY_ICONS, BERRY_NAMES, TYPE_COLORS, pokemonSourceBadge } from './items.js';
import { matchPinyinPartial } from './pokedex.js';
import { setupSourceFilter, closeAllDropdowns, sourceFilterLabel } from './filters.js';

// 升级经验需求（与对战结算一致）
const expNeed = (lv) => 25 + lv * 20;
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

// 给个体追加经验并按等级曲线逐级升级（训练挂机 / 经验糖果共用），返回本次升级数
export function applyXp(entry, amount) {
  if (!entry || amount <= 0) return 0;
  const before = entry.level || 1;
  entry.exp = (entry.exp || 0) + amount;
  while ((entry.level || 1) < MAX_LEVEL && entry.exp >= expNeed(entry.level || 1)) {
    entry.exp -= expNeed(entry.level || 1);
    entry.level = (entry.level || 1) + 1;
  }
  if ((entry.level || 1) >= MAX_LEVEL) entry.exp = 0; // 满级后不再积累经验
  return (entry.level || 1) - before;
}

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

// 移动帧动画（pokemon-move 9 帧 sprite，单帧 32×32）：方向帧序列（0-indexed，对应 1-7-2-7 / 3-8-4-8 / 5-9-6-9）
// 向左复用向右序列，靠 scaleX(-1) 镜像
const MOVE_SEQ = { right: [0, 6, 1, 6], up: [2, 7, 3, 7], down: [4, 8, 5, 8] };
const MOVE_FRAME_MS = 200;
const MOVE_DUR_MS = 600; // 覆盖 0.5s 位移过渡，帧动画稍长避免瞬停
const MOVE_SCALE = 1.4; // 移动帧单帧 32px 比 icon 视觉小，放大到接近 icon 尺寸（可调）

// 可走动瓦片：水域（水系宝可梦专属）与陆地；陆地宝可梦不去第一行、最下面一行与最后一列
const TILE_WATER = new Set(['1,26', '1,22']); // 深水 + 水池上缘浅水，四行高度
const TILE_LAND = new Set(['1,0', '5,1', '1,41']);
const BLOCKED_CELLS = new Set(['8,1', '9,1', '10,1']);
const WATER_CELLS = [];
const LAND_CELLS = [];
// 水域最下面一行不放行：先求出水池实际底部行，水系宝可梦只在底部行之上活动（水池底部留白）
let waterBottom = -1;
for (let r = 0; r < TRAIN.h; r++) {
  for (let c = 0; c < TRAIN.w; c++) {
    if (TILE_WATER.has(TRAIN.tiles[r][c].join(','))) waterBottom = Math.max(waterBottom, r);
  }
}
for (let r = 0; r < TRAIN.h; r++) {
  for (let c = 0; c < TRAIN.w; c++) {
    const key = TRAIN.tiles[r][c].join(',');
    if (BLOCKED_CELLS.has(c + ',' + r)) continue;
    if (TILE_WATER.has(key) && r < waterBottom) WATER_CELLS.push({ c, r });
    else if (TILE_LAND.has(key) && r > 0 && r < TRAIN.h - 1 && c < TRAIN.w - 1) LAND_CELLS.push({ c, r });
  }
}

let _timer = null;
const _walkers = new Map();  // id -> walker 状态
const _walkerPos = new Map(); // id -> 上次位置 {c,r,facing}（页面重绘后沿用）

// "放入训练"全页列表状态（点击训练空槽进入，与饲育屋放入页一致；放入/返回后清空）
let _pickSlot = null;          // 当前放入槽位；null = 不在放入页
let _pickSearch = '';          // 放入列表搜索词
let _pickSortBy = null;        // 放入列表排序列：null=默认按编号+等级 | name | iv | level
let _pickSortDir = 1;          // 1 升序 / -1 降序
let _pickTypeFilter = '';      // 放入列表属性筛选
let _pickRegionFilter = '';    // 放入列表地区筛选
let _pickSrc = '';             // 放入列表来源筛选（''=全部 | normal | fishing | egg | trade | twist）
let _pickLegend = '';          // 神兽筛选：''=不限 | legend | normal
let _pickShiny = '';           // 闪光筛选：''=不限 | shiny | normal
let _pickVariant = '';         // 变体筛选：''=不限 | any | rgb | polluted
let _pickListScroll = 0;       // 进入个体详情前记住放入列表滚动位置，返回后恢复
let _pickRenderSeq = 0;        // 放入列表渲染序号：新一轮分片渲染取代旧轮

// 当前打开的筛选下拉（放入页）。模块级统一关闭：仅注册一次 document 监听，
// 避免每次进入放入页重复注册（旧 DOM 被闭包引用无法回收，反复进出会累积卡顿）
let _openDd = null;
function closeOpenDd() {
  if (!_openDd) return;
  _openDd.dd.style.display = 'none';
  _openDd.trigger.classList.remove('open');
  _openDd = null;
}
document.addEventListener('click', closeOpenDd);

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
    // 偷懒中：暂停经验积累；但饿了仍会进食，吃上树果后自动结束偷懒恢复训练
    if (slot.lazyUntil && now < slot.lazyUntil) {
      if (slot.satiety == null) slot.satiety = TRAIN_SATIETY_MAX;
      if (slot.satiety <= TRAIN_SATIETY_EAT_AT && eatFavorite(slot, entry)) fed = true;
      if (slot.satiety > 0) slot.lazyUntil = 0;
      continue;
    }
    slot.lazyUntil = 0;
    const elapsed = Math.max(0, now - slot.startAt);
    if (elapsed <= 0) continue;
    const effMin = Math.min(10, elapsed / 60000); // 离线补算时长截断：饱食度/偷懒都与它一致，避免一次返回瞬间扣光
    slot.startAt = now; // 先推进时间：偷懒/停训期间不积累经验，恢复后也不会一次性补算
    // 饱食度：训练中随时间下降；降到阈值（含）时自动吃库存里爱吃的树果，
    // 单颗补充与阈值相等，吃一颗正好回满饱食度
    if (slot.satiety == null) slot.satiety = TRAIN_SATIETY_MAX;
    slot.satiety = Math.max(0, slot.satiety - effMin * TRAIN_SATIETY_DRAIN_PER_MIN);
    if (slot.satiety <= TRAIN_SATIETY_EAT_AT && eatFavorite(slot, entry)) fed = true;
    entry.satiety = slot.satiety; // 同步到个体记录：取出再放回时沿用当前饱食度
    // 饱食度归零：保持偷懒（持续暂停训练），直到吃上树果恢复
    if (slot.satiety <= 0) {
      slot.lazyUntil = now + randInt(TRAIN_LAZY.durationMin, TRAIN_LAZY.durationMax);
      if (!lazyStarted) { lazyStarted = true; addSystemLog('train_lazy', { pokemon: entry.species }); }
      continue;
    }
    // 结算经验
    const ups = applyXp(entry, (elapsed / 1000) * (TRAIN_XP_PER_MIN / 60));
    if (ups > 0) {
      leveled = true;
      // 一次补算可能连升多级：只记一条最终等级，避免刷屏
      addSystemLog('train_levelup', { pokemon: entry.species, level: entry.level });
    }
    // 随机偷懒：只影响之后，不扣已结算经验；饱食度越低越容易偷懒（满饱食 1 倍，越饿越高）
    const hungerMult = 1 + (1 - slot.satiety / TRAIN_SATIETY_MAX);
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

// 该个体是否正在训练中（放入页占用确认用）
export function isTrainingPokemon(id) {
  return ensureTraining().slots.some(s => s && s.id === id);
}

// 仓库选取：从列表项放入训练（空槽点击跳转仓库后由列表项触发）。
// 若该个体正被饲育屋/队伍占用，先弹确认框，确认后才放入（自动撤下原占用方）
export function addToTraining(id, slot) {
  const t = ensureTraining();
  if (t.slots[slot]) return;
  const occ = [];
  if (isInAnyTeam(id)) occ.push('队伍');
  Promise.all([
    import('./nursery.js').then(m => m.isNurseryPokemon(id)),
    import('./dispatch.js').then(m => m.isDispatchPokemon(id)),
  ]).then(([inNursery, inDispatch]) => {
    if (inNursery) occ.push('饲育屋');
    if (inDispatch) occ.push('派遣');
    if (occ.length) {
      showConfirmBar(`这只宝可梦正在${occ.join('、')}中。放入训练将自动将其撤下，确定放入？`, () => doAddToTraining(id, slot), null, { overlay: true });
      return;
    }
    doAddToTraining(id, slot);
  });
}

function doAddToTraining(id, slot) {
  const t = ensureTraining();
  if (t.slots[slot]) return; // 目标槽已被占用则不处理
  const entry = (gameData.roster || []).find(x => x.id === id);
  // 饱食度沿用个体记录值（取出再放回不重置）；新个体/无记录默认满饱食
  const satiety = entry && entry.satiety != null
    ? Math.max(0, Math.min(TRAIN_SATIETY_MAX, entry.satiety))
    : TRAIN_SATIETY_MAX;
  t.slots[slot] = { id, startAt: Date.now(), satiety };
  _pickSearch = ''; // 放入成功后清空搜索词，避免放第二只时残留第一只页面的输入
  _pickSlot = null; // 退出放入页
  // 训练中的宝可梦不能留在任何配队队伍里
  removePokemonFromAllTeams(id);
  // 训练/饲育屋/配队/派遣互斥：放入训练后从其它槽位移除
  import('./nursery.js').then(m => m.removeNurseryByPokemon(id));
  import('./dispatch.js').then(m => m.removeDispatchByPokemon(id));
  if (entry) addSystemLog('train_start', { pokemon: entry.species, slot });
  saveGame();
  processTrainingXp();
  render();
  openBoard(); // 放入后回到场地，打开告示牌查看状态
  showView('trainView');
  startTimer();
}

function render() {
  const box = $('trainContent');
  if (!box) return;
  // 放入训练：切到全页列表（不占用告示牌面板）
  if (_pickSlot != null) { renderPickPage(box); return; }
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
    // 仅主属性为水的宝可梦下水（types[0] 是主属性；双属性水排后面的如波尔凯尼恩不算）
    const isWater = (poke.types || [])[0] === '水';
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
    el.className = 'train-walker' + (isWater ? ' water' : '');
    el.style.left = (start.c * TILE) + 'px';
    el.style.top = (start.r * TILE) + 'px';
    // 俯视层级：靠下的宝可梦（y 大）盖住靠上的，避免相邻时互相遮挡
    el.style.zIndex = 10 + start.r * TILE;
    el.innerHTML = '<div class="train-walker-flip"><img class="train-walker-img" alt=""></div>'
      + '<span class="train-walker-zzz"><i>z</i><i>z</i><i>z</i></span>';
    layer.appendChild(el);
    const img = el.querySelector('.train-walker-img');
    // 随机相位：多个宝可梦的闪烁动画错开，避免同步
    img.style.animationDelay = '-' + (Math.random() * 0.5).toFixed(2) + 's';
    if (start.facing < 0) el.querySelector('.train-walker-flip').style.transform = 'scaleX(-1)';
    el.classList.toggle('lazy', isLazy(slot));
    if (isLazy(slot)) img.classList.add('lazy');
    // 初始站着不动：先不跳，首次移动时才起跳
    img.classList.add('idle');
    // 位移结束（停下）后停止跳动；再次移动时恢复
    el.addEventListener('transitionend', () => img.classList.add('idle'));
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
      move: false,           // 是否启用移动帧动画
      scale: 1,              // 本体显示放大倍率（move 素材启用后设为 MOVE_SCALE）
      frameCount: 1, frameW: 1,
      seq: MOVE_SEQ.right, frame: 0,
      moving: false, moveUntil: 0, lastFrameAt: 0,
      nextAt: Date.now() + randInt(400, 1400),
    });
    // 移动帧动画：仅无变体本体尝试；素材缺失/非多帧自动回退 icon+跳动。
    // 同一 img 只走一个请求：非变体先试 move，失败回退 icon；变体直接加载 icon，
    // 避免静态 icon 请求被 move 请求抢占导致缓存未建立、src 停留失败 URL 破图
    const w = _walkers.get(slot.id);
    if (!String(poke.index).includes('-')) {
      const moveSrc = './pokemon-data/pokemon-move/' + String(poke.index).padStart(4, '0') + '-' + poke.name + '.png';
      const iconSrc = poke.icon;
      tryLoadImage(img, moveSrc).then(ok => {
        if (!ok) { if (iconSrc) tryLoadImage(img, iconSrc); return; }
        const nw = img.naturalWidth, nh = img.naturalHeight;
        const fc = nw && nh ? Math.max(1, Math.round(nw / nh)) : 1;
        if (fc < 2) { if (iconSrc) tryLoadImage(img, iconSrc); return; } // 非多帧素材不启用
        w.move = true;
        w.frameCount = fc;
        w.frameW = nw / fc;
        img.style.objectFit = 'none';
        img.style.objectPosition = '0px 0px';
        img.classList.add('move'); // 移动帧模式彻底停用上下跳动，行走切帧、静止保持帧
        // 放大本体：水系贴水面向上（origin bottom，底部不浸水）、陆地居中放大
        w.scale = MOVE_SCALE;
        const pf = (_walkerPos.get(slot.id) || { facing: 1 }).facing;
        const flipEl = el.querySelector('.train-walker-flip');
        flipEl.style.transformOrigin = isWater ? 'bottom' : 'center';
        flipEl.style.transform = (pf < 0 ? 'scaleX(-1) ' : '') + 'scale(' + MOVE_SCALE + ')';
        addMoveAnim(w);
      });
    } else if (poke.icon) {
      // 变体无移动素材：直接加载静态图标
      tryLoadImage(img, poke.icon);
    }
  });
}

// ---------- 移动帧驱动（共享 RAF 切帧，参考随从走马灯） ----------
let _moveImgs = [];
let _moveRaf = null;

function addMoveAnim(w) {
  _moveImgs.push(w);
  if (!_moveRaf) _moveRaf = requestAnimationFrame(moveTick);
}

function moveTick() {
  const now = performance.now();
  _moveImgs = _moveImgs.filter(m => m.img && m.img.isConnected);
  for (const w of _moveImgs) {
    if (!w.moving) continue;
    if (now > w.moveUntil) {
      w.moving = false; // 位移结束：切到站立过渡帧（帧7/8/9，序列第二帧），别停在抬脚的帧
      const idx = w.seq[1] % w.frameCount;
      w.img.style.objectPosition = `-${idx * w.frameW}px 0px`;
      continue;
    }
    if (now - w.lastFrameAt >= MOVE_FRAME_MS) {
      w.lastFrameAt = now;
      w.frame = (w.frame + 1) % w.seq.length;
      const idx = w.seq[w.frame] % w.frameCount;
      const pos = `-${idx * w.frameW}px 0px`;
      w.img.style.objectPosition = pos;
    }
  }
  if (_moveImgs.length > 0) _moveRaf = requestAnimationFrame(moveTick);
  else _moveRaf = null;
}

// 每 tick 让在场宝可梦随机移动一格；偷懒中的原地发呆；不与其它宝可梦重叠
function walkerTick(now = Date.now()) {
  const t = ensureTraining();
  const slotById = new Map(t.slots.filter(Boolean).map(s => [s.id, s]));
  for (const [id, w] of _walkers) {
    const slot = slotById.get(id);
    const lazy = !!slot && isLazy(slot);
    // 偷懒的宝可梦暂停上下跳动画并停掉移动帧
    w.img.classList.toggle('lazy', lazy);
    w.el.classList.toggle('lazy', lazy);
    if (lazy && w.moving) {
      w.moving = false;
      // 偷懒原地：切到站立过渡帧（帧7/8/9），别停在抬脚的帧
      const idx = w.seq[1] % w.frameCount;
      w.img.style.objectPosition = `-${idx * w.frameW}px 0px`;
    }
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
      // 图标素材默认朝左、move 素材默认朝右：向左走 icon 不镜像 / move 镜像，向右相反
      if (dc !== 0) prev.facing = w.move ? (dc < 0 ? -1 : 1) : (dc < 0 ? 1 : -1);
      _walkerPos.set(id, prev);
      w.el.style.left = (nc * TILE) + 'px';
      w.el.style.top = (nr * TILE) + 'px';
      w.el.style.zIndex = 10 + nr * TILE; // 俯视层级随 y 递增
      w.img.classList.remove('idle'); // 开始走动：恢复上下跳动（停下时 transitionend 再加回）
      // 移动帧：按方向选帧序列并启动切帧（左/右共用向右序列，向左靠镜像翻转）
      if (w.move) {
        w.seq = dc === 0 && dr < 0 ? MOVE_SEQ.up : dc === 0 && dr > 0 ? MOVE_SEQ.down : MOVE_SEQ.right;
        w.frame = 0;
        w.lastFrameAt = performance.now();
        w.moveUntil = w.lastFrameAt + MOVE_DUR_MS;
        w.moving = true;
        // 立即切到新方向第一帧：贴图先朝移动方向，再开始位移（避免起步时仍显示旧方向帧）
        w.img.style.objectPosition = `-${(w.seq[0] % w.frameCount) * w.frameW}px 0px`;
      }
      // 镜像与缩放：水系贴水面向上放大（origin bottom 已在 move 回调设置），陆地居中
      const flipEl = w.el.querySelector('.train-walker-flip');
      flipEl.style.transform = (prev.facing < 0 ? 'scaleX(-1) ' : '') + (w.scale > 1 ? 'scale(' + w.scale + ')' : '');
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
    ? ' <svg viewBox="0 0 1024 1024" width="10" height="10" style="vertical-align:-1px;color:#fff;"><use xlink:href="#icon-star"/></svg>'
    : '';
  const sat = slot.satiety == null ? TRAIN_SATIETY_MAX : Math.round(slot.satiety);
  tip.innerHTML = `${entry.nickname || (poke ? poke.name : '#' + entry.species)}${shiny} · ${genderBadge(ensureGender(entry))}Lv${entry.level || 1} · 饱食${sat}
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
  const name = entry.nickname || (poke ? poke.name : `#${entry.species}`);
  const lv = entry.level || 1;
  const cur = entry.exp || 0;
  const need = expNeed(lv);
  const ratio = Math.min(100, Math.max(0, (cur / need) * 100));
  const lazy = isLazy(slot);
  const sat = slot.satiety == null ? TRAIN_SATIETY_MAX : Math.round(slot.satiety);
  const satCls = sat >= 70 ? 'full' : sat >= 40 ? 'mid' : 'low';
  const shiny = entry.shiny
    ? '<svg viewBox="0 0 1024 1024" width="10" height="10" style="flex-shrink:0;color:var(--ui-color);vertical-align:-1px;"><use xlink:href="#icon-star"/></svg>'
    : '';
  return `<div class="train-status-row" data-slot="${i}">
    <span class="train-status-dot${lazy ? ' lazy' : ''}"></span>
    <span class="train-status-name"><span class="train-status-name-text">${name}</span>${shiny}<em class="train-status-g">${genderBadge(ensureGender(entry))}</em></span>
    <span class="train-status-satiety ${satCls}" title="饱食度"><span class="train-status-sat-track"><span class="train-status-sat-fill" style="width:${sat}%"></span></span><em class="train-status-sat-num">${sat}</em></span>
    <span class="train-status-xp" title="经验"><span class="train-status-bar"><span class="xp-fill" style="width:${ratio.toFixed(1)}%"></span></span><em class="train-status-xp-lv">Lv${lv}</em></span>
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
        // 关闭面板，切到全页"放入训练"列表（与饲育屋放入页一致）
        openTrainPick(i);
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

// ---------- "放入训练"全页列表（与饲育屋放入页一致：搜索/筛选/排序/详情，标题栏为「放入」） ----------

// 点击训练空槽：关闭面板，切到全页放入列表
function openTrainPick(slot) {
  closeBoard();
  _pickSlot = slot;
  render();
}

// 放入页是否打开（供 main.js 标题栏返回使用）
export function isTrainPicking() {
  return _pickSlot != null && $('trainView')?.style.display !== 'none';
}

// 标题栏返回：退出放入页，回训练场地并打开告示牌
export function leaveTrainPick() {
  if (_pickSlot == null) return;
  _pickSlot = null;
  _pickSearch = '';
  _pickTypeFilter = '';
  _pickRegionFilter = '';
  _pickSrc = '';
  _pickLegend = '';
  _pickShiny = '';
  _pickVariant = '';
  render();
  // 恢复标题栏
  const title = $('appTitle');
  if (title) {
    title.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 训练';
    title.dataset.action = 'back';
  }
  // 延迟到当前 click 冒泡结束后再打开告示牌弹窗：document 上注册了"点击面板外部关闭"
  // 的全局监听，标题栏返回的 click 会冒泡触发它；若同步 openBoard，弹窗刚打开就会被误关
  setTimeout(openBoard, 0);
}

// 全页"放入训练"列表：顶部仅标题，返回走标题栏（appTitle）
function renderPickPage(box) {
  box.innerHTML = `
    <div class="view-list" style="display:flex;flex-direction:column;flex:1;min-height:0;">
      <div class="pokedex-progress" id="trainPickProgress">
        <span id="trainPickProgressCount"></span>
      </div>
      <div class="pokedex-search">
        <div class="pokedex-search-row">
          <div class="pokedex-search-input-wrap">
            <input id="trainPickSearch" class="pokedex-search-input" type="text" placeholder="搜索宝可梦"
              autocomplete="off" value="${_pickSearch.replace(/"/g, '&quot;')}" />
            <button class="pokedex-search-clear" id="trainPickSearchClear" style="${_pickSearch ? '' : 'display:none'}" aria-label="清空搜索">
              <svg><use xlink:href="#icon-close"></use></svg>
            </button>
          </div>
          <div id="trainPickSrcFilter" class="pokedex-region-select" tabindex="0" title="按来源筛选">
            <span id="trainPickSrcFilterLabel">${sourceFilterLabel({ src: _pickSrc, legend: _pickLegend, shiny: _pickShiny, variant: _pickVariant })}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="trainPickSrcFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
          <div id="trainPickTypeFilter" class="pokedex-region-select" tabindex="0" title="按属性筛选">
            <span id="trainPickTypeFilterLabel">${_pickTypeFilter ? _pickTypeFilter : '属性'}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="trainPickTypeFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
          <div id="trainPickRegionFilter" class="pokedex-region-select" tabindex="0" title="按地区筛选">
            <span id="trainPickRegionFilterLabel">${_pickRegionFilter || '地区'}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="trainPickRegionFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
        </div>
      </div>
      <div class="pokedex-header roster-header nursery-pick-header train-pick-header">
        <span class="roster-icon"></span>
        <span class="pokedex-star"></span>
        <span class="pokedex-name" data-sort="name">名称</span>
        <span class="roster-lv-col" data-sort="level">等级</span>
        <span class="roster-iv" data-sort="iv">个体值</span>
        <span class="bounty-trade-btn-col">放入</span>
      </div>
      <div class="list-scroll nursery-pick-list train-pick-list">
      </div>
    </div>`;
  // 进度：可放入总数（与饲育屋放入页一致）
  const prog = box.querySelector('#trainPickProgressCount');
  if (prog) prog.textContent = `共 ${pickPickRows().length} 只可放入`;
  // 设置标题栏
  const title = $('appTitle');
  if (title) {
    title.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 放入';
    title.dataset.action = 'back';
  }
  // 行事件委托：行 DOM 由分片渲染动态插入，委托绑定一次，避免每片重复绑定
  const list = box.querySelector('.train-pick-list');
  if (list) {
    list.onclick = (e) => {
      const btn = e.target.closest('[data-pick-submit]');
      if (btn) {
        e.stopPropagation();
        const slot = _pickSlot;
        _pickSlot = null;
        addToTraining(btn.dataset.pickSubmit, slot);
        return;
      }
      const row = e.target.closest('[data-pick-view]');
      if (!row) return;
      e.stopPropagation();
      _pickListScroll = list.scrollTop; // 记住列表位置，返回后恢复
      import('./roster.js').then(m => m.showRosterDetailFromList(row.dataset.pickView, () => {
        showView('trainView');
        render(); // _pickSlot 未清空，仍显示放入列表
        startTimer();
      }));
    };
    // 分片渲染完成后恢复详情返回前的滚动位置
    renderPickRows(list, () => { list.scrollTop = _pickListScroll; });
  }
  bindPick(box);
  bindPickFilters(box);
}

// 个体值总和
function pickIvSum(p) {
  if (!p.ivs) return 0;
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].reduce((s, k) => s + (p.ivs[k] || 0), 0);
}
// 个体值明细（hover 个体值单元格的 tooltip 显示；HP 用全角 ＨＰ，与中文标签同宽，数值自然对齐）
function pickIvTip(p) {
  return [['ＨＰ', 'hp'], ['攻击', 'atk'], ['防御', 'def'], ['特攻', 'spa'], ['特防', 'spd'], ['速度', 'spe']]
    .map(([label, k]) => `${label}  ${p.ivs ? (p.ivs[k] || 0) : 0}`)
    .join('\n');
}
// 放入列表来源筛选状态（供共享来源下拉读写）
function pickSrcState() {
  return {
    get src() { return _pickSrc; }, set src(v) { _pickSrc = v; },
    get legend() { return _pickLegend; }, set legend(v) { _pickLegend = v; },
    get shiny() { return _pickShiny; }, set shiny(v) { _pickShiny = v; },
    get variant() { return _pickVariant; }, set variant(v) { _pickVariant = v; },
  };
}

// "放入训练"列表候选：全部在仓个体（排除已放入训练槽的），行结构与饲育屋放入页一致——
// 个体值（综合，hover 看明细） / 等级（性别跟在等级边上） / 放入；点击行跳转个体详情（返回后仍在列表）
function pickPickRows() {
  const t = ensureTraining();
  const exclude = new Set(t.slots.filter(s => s && s.id).map(s => s.id));
  const q = _pickSearch.trim();
  return (gameData.roster || [])
    .filter(p => p.inRoster && !exclude.has(p.id))
    .filter(p => !p.kind || p.kind !== 'egg') // 宝可梦蛋不能放入训练
    // 属性筛选
    .filter(p => {
      if (!_pickTypeFilter) return true;
      const poke = getPokemonByIndex(String(p.species));
      return poke?.types?.includes(_pickTypeFilter);
    })
    // 地区筛选
    .filter(p => {
      if (!_pickRegionFilter) return true;
      const poke = getPokemonByIndex(String(p.species));
      return poke?.region === _pickRegionFilter;
    })
    // 来源筛选：来源 → 神兽 → 闪光 → 变体（与 roster 一致；mass 归入「野生」）
    .filter(p => {
      if (_pickSrc) return _pickSrc === 'normal' ? (p.source === 'normal' || p.source === 'mass') : p.source === _pickSrc;
      return true;
    })
    .filter(p => {
      if (!_pickLegend) return true;
      const poke = getPokemonByIndex(String(p.species));
      const isLegend = poke?.legend === true;
      return _pickLegend === 'legend' ? isLegend : !isLegend;
    })
    .filter(p => {
      if (!_pickShiny) return true;
      return _pickShiny === 'shiny' ? p.shiny : !p.shiny;
    })
    .filter(p => {
      if (!_pickVariant) return true;
      return _pickVariant === 'any' ? !!p.variant : p.variant === _pickVariant;
    })
    // 搜索过滤：名称 / 拼音 / 首字母 / 昵称
    .filter(p => {
      if (!q) return true;
      const poke = getPokemonByIndex(String(p.species));
      if (!poke) return true;
      const upper = q.toUpperCase();
      return poke.name.includes(q) ||
        (poke.pinyin || '').toUpperCase().includes(upper) ||
        (poke.pinyinInitials || '').toUpperCase().includes(upper) ||
        matchPinyinPartial(q, poke.pinyin) ||
        (p.nickname && p.nickname.includes(q));
    })
    .sort((a, b) => {
      let va, vb;
      if (_pickSortBy === 'name') {
        va = getPokemonByIndex(String(a.species))?.name || '';
        vb = getPokemonByIndex(String(b.species))?.name || '';
      } else if (_pickSortBy === 'iv') {
        va = pickIvSum(a); vb = pickIvSum(b);
      } else if (_pickSortBy === 'level') {
        va = a.level || 1; vb = b.level || 1;
      } else {
        // 默认按编号排序：纯数字保持"编号+等级"语义，扩展编号（变体）按字符串比较
        const ai = String(a.species), bi = String(b.species);
        const an = Number(ai), bn = Number(bi);
        if (Number.isFinite(an) && Number.isFinite(bn)) {
          va = an * 1000 + (a.level || 1);
          vb = bn * 1000 + (b.level || 1);
        } else {
          va = ai; vb = bi;
        }
      }
      if (typeof va === 'string') return va.localeCompare(vb) * _pickSortDir;
      return (va - vb) * _pickSortDir;
    });
}

// 放入列表单行渲染
function pickRowHtml(p) {
  const poke = getPokemonByIndex(String(p.species));
  const name = p.nickname || (poke ? poke.name : `#${p.species}`);
  const icon = poke?.icon ? `<img class="roster-icon-img" data-icon="${p.species}" alt="" />` : '';
  return `
  <div class="pokedex-entry roster-row bounty-trade-row" data-pick-view="${p.id}">
    <span class="roster-icon">${icon}</span>
    <span class="pokedex-star">${pokemonSourceBadge(p)}</span>
    <span class="pokedex-name">${name}</span>
    <span class="roster-lv-col">${genderBadge(ensureGender(p))}Lv${p.level || 1}</span>
    <span class="roster-iv" data-tip="${pickIvTip(p)}">${pickIvSum(p)}</span>
    <span class="bounty-trade-btn-col"><button class="bounty-trade-btn" data-pick-submit="${p.id}">放入</button></span>
  </div>`;
}

// 分片渲染放入列表：每帧插一批 + 分片加载图标，避免大仓库一次性 innerHTML 和
// 全量图片请求长时间阻塞主线程 / 触发资源上限（与仓库列表 renderList 同款方案）
function renderPickRows(list, onDone) {
  const sorted = pickPickRows();
  _pickRenderSeq++;
  const seq = _pickRenderSeq;
  list.innerHTML = '';
  if (!sorted.length) {
    list.innerHTML = _pickSearch.trim()
      ? `<div class="roster-trade-empty">没有匹配的宝可梦</div>`
      : `<div class="roster-trade-empty">仓库里没有可以放入的宝可梦</div>`;
    onDone?.();
    return;
  }
  let i = 0;
  const CHUNK = 40;
  const step = () => {
    if (seq !== _pickRenderSeq || !list.isConnected) return; // 已被新一轮渲染取代或列表已卸载
    const view = $('trainView');
    if (view && view.style.display === 'none') return; // 视图已隐藏：暂停分片，避免后台继续抢图片 I/O
    const rows = [];
    const end = Math.min(i + CHUNK, sorted.length);
    for (; i < end; i++) rows.push(pickRowHtml(sorted[i]));
    const before = list.querySelectorAll('.roster-icon-img').length;
    list.insertAdjacentHTML('beforeend', rows.join(''));
    const imgs = list.querySelectorAll('.roster-icon-img');
    for (let k = before; k < imgs.length; k++) {
      const poke = getPokemonByIndex(imgs[k].dataset.icon);
      if (poke?.icon) tryLoadImage(imgs[k], poke.icon);
    }
    if (i < sorted.length) { requestAnimationFrame(step); return; }
    onDone?.(); // 分片完成
  };
  requestAnimationFrame(step);
}

// 局部刷新放入列表（搜索/排序时只重建列表，不重建搜索框避免失焦）。
// 防抖合并快速连续触发（连点排序/连续输入）：否则多轮分片渲染的图标请求并发叠加，
// 触发浏览器资源上限 ERR_INSUFFICIENT_RESOURCES
let _pickRefreshT = null;
function refreshPickList() {
  clearTimeout(_pickRefreshT);
  _pickRefreshT = setTimeout(() => {
    const page = $('trainContent');
    if (!page || _pickSlot == null) return;
    const list = page.querySelector('.train-pick-list');
    if (!list) return;
    renderPickRows(list); // 新一轮分片渲染自动取代旧轮（行 DOM 由委托绑定）
    const prog = page.querySelector('#trainPickProgressCount');
    if (prog) prog.textContent = `共 ${pickPickRows().length} 只可放入`;
    markPickSort(page); // 点击排序后同步三角箭头（表头是持久 DOM，需主动刷新标记）
  }, 80);
}

// "放入训练"全页列表交互：行内按钮放入该槽；点击行跳转个体详情（返回后恢复列表）
function bindPick(root) {
  if (_pickSlot == null) return;
  bindPickPersistent(root); // 搜索 / 表头排序：页面级持久监听，仅 render() 重建时绑定
}

// 页面级持久监听（搜索 / 表头排序）：仅在 render() 重建页面时绑定一次，
// 不要放进 refreshPickList，否则同一持久 DOM 会累积监听导致多次触发/卡死
function bindPickPersistent(root) {
  // 搜索输入：实时过滤列表，不清空排序状态
  const searchInput = root.querySelector('#trainPickSearch');
  const searchClear = root.querySelector('#trainPickSearchClear');
  if (searchInput) {
    const doSearch = () => {
      _pickSearch = searchInput.value.trim();
      if (searchClear) searchClear.style.display = _pickSearch ? '' : 'none';
      refreshPickList();
    };
    searchInput.addEventListener('input', doSearch);
    searchClear?.addEventListener('click', () => {
      searchInput.value = '';
      doSearch();
      searchInput.focus();
    });
  }
  // 表头点击排序（3 段 toggle：升序 → 降序 → 回到默认编号排序）
  root.querySelectorAll('.train-pick-header [data-sort]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const field = el.dataset.sort;
      if (_pickSortBy === field) {
        if (_pickSortDir === 1) _pickSortDir = -1;
        else { _pickSortBy = null; _pickSortDir = 1; }
      } else { _pickSortBy = field; _pickSortDir = 1; }
      refreshPickList();
    });
  });
  markPickSort(root);
}

// 标记当前排序列的三角箭头（先清旧标记再加新标记）
function markPickSort(root) {
  const header = root.querySelector('.train-pick-header');
  if (!header) return;
  header.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
  const cur = _pickSortBy ? header.querySelector(`[data-sort="${_pickSortBy}"]`) : null;
  if (cur) cur.classList.add(_pickSortDir === 1 ? 'sort-asc' : 'sort-desc');
}

// 筛选下拉菜单绑定（只在 renderPickPage 时调用一次，避免 refreshPickList 重复绑定）
function bindPickFilters(root) {
  // 属性筛选下拉
  const typeTrigger = root.querySelector('#trainPickTypeFilter');
  const typeLabel = root.querySelector('#trainPickTypeFilterLabel');
  const typeDd = root.querySelector('#trainPickTypeFilterDropdown');
  if (typeTrigger && typeLabel && typeDd) {
    const typeList = Object.keys(TYPE_COLORS);
    function buildTypeOptions() {
      typeDd.innerHTML = `<div class="region-dropdown-item${!_pickTypeFilter ? ' active' : ''}" data-type="">全部</div>`
        + typeList.map(t => `<div class="region-dropdown-item${t === _pickTypeFilter ? ' active' : ''}" data-type="${t}"><span class="roster-type-dot" style="background:${TYPE_COLORS[t]}"></span>${t}</div>`).join('');
      typeDd.querySelectorAll('.region-dropdown-item').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          _pickTypeFilter = el.dataset.type || '';
          typeLabel.innerHTML = _pickTypeFilter
            ? `<span class="roster-type-dot" style="background:${TYPE_COLORS[_pickTypeFilter]}"></span>${_pickTypeFilter}`
            : '属性';
          closeAllDropdowns();
          refreshPickList();
        });
      });
    }
    typeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = typeDd.style.display !== 'none';
      closeAllDropdowns(); // 关闭全部下拉（含来源）
      if (!isOpen) {
        buildTypeOptions();
        typeDd.style.display = '';
        typeTrigger.classList.add('open');
        _openDd = { dd: typeDd, trigger: typeTrigger };
      }
    });
  }
  // 地区筛选下拉
  const regionTrigger = root.querySelector('#trainPickRegionFilter');
  const regionLabel = root.querySelector('#trainPickRegionFilterLabel');
  const regionDd = root.querySelector('#trainPickRegionFilterDropdown');
  if (regionTrigger && regionLabel && regionDd) {
    function buildRegionOptions() {
      regionDd.innerHTML = `<div class="region-dropdown-item${!_pickRegionFilter ? ' active' : ''}" data-region="">全部</div>`
        + REGION_CYCLE.map(r => `<div class="region-dropdown-item${r === _pickRegionFilter ? ' active' : ''}" data-region="${r}">${r}</div>`).join('');
      regionDd.querySelectorAll('.region-dropdown-item').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          _pickRegionFilter = el.dataset.region || '';
          regionLabel.textContent = _pickRegionFilter || '地区';
          closeAllDropdowns();
          refreshPickList();
        });
      });
    }
    regionTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = regionDd.style.display !== 'none';
      closeAllDropdowns(); // 关闭全部下拉（含来源）
      if (!isOpen) {
        buildRegionOptions();
        regionDd.style.display = '';
        regionTrigger.classList.add('open');
        _openDd = { dd: regionDd, trigger: regionTrigger };
      }
    });
  }
  // 来源筛选下拉（与 roster 共用的二级三级菜单）
  setupSourceFilter({
    trigger: root.querySelector('#trainPickSrcFilter'),
    label: root.querySelector('#trainPickSrcFilterLabel'),
    dd: root.querySelector('#trainPickSrcFilterDropdown'),
    state: pickSrcState(),
    onPick: refreshPickList,
  });
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
      if (fill) {
        const next = ratio.toFixed(1) + '%';
        const prev = parseFloat(fill.style.width) || 0;
        // 升级瞬间条从满跳到空：临时禁用过渡让它立即归零，避免 0.3s 平滑收缩看起来像倒退
        if (ratio < prev - 1) {
          fill.style.transition = 'none';
          fill.style.width = next;
          void fill.offsetWidth; // 强制重排，令 transition:none 生效后再恢复
          fill.style.transition = '';
        } else {
          fill.style.width = next;
        }
      }
      const g = el.querySelector('.train-status-name .train-status-g');
      if (g) g.innerHTML = genderBadge(ensureGender(entry));
      const lv = el.querySelector('.train-status-xp-lv');
      if (lv) lv.textContent = 'Lv' + (entry.level || 1);
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
