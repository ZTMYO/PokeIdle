// ===== 饲育屋 App =====
// 把两只宝可梦放进饲育屋配对：满足蛋组条件（雌雄共蛋组 / 百变怪万能配对）即可繁殖。
// 互斥规则：饲育屋 / 训练 / 配队三方互斥——放入饲育屋自动离开队伍与训练槽，反之亦然。
import { $, showView, tryLoadImage, setupFoodTooltip, showConfirmBar, hideConfirmBar } from './ui.js';
import { gameData, getPokemonByIndex, isPokemon, saveGame, pushNav, ensureGender, genderBadge, rollGender, rollNature, addSystemLog } from './state.js';
import { matchPinyinPartial } from './pokedex.js';
import { BERRY_ICONS, BERRY_NAMES, TYPE_COLORS } from './items.js';
import { ensureBerryFarm } from './berry.js';
import { removePokemonFromAllTeams } from './team.js';
import { REGION_CYCLE } from './config.js';

const BERRY_DIR = './items/berries/';
// 产蛋时长区间（分钟，本期固定随机，后续可做同种/同蛋组和睦度加成）
const BREED_MIN_MIN = 5;
const BREED_MAX_MIN = 10;
const EGG_SHINY_CHANCE = 1 / 4096; // 蛋的闪光概率：与原版一致的低概率，不与亲本闪光挂钩

const TILE = 24;
const TILESET = './terrain/terrain-tileset.png';
const BOARD_IMG = './items/berry-trees/board.png';
const BOX_IMG = './items/berry-trees/box.png';
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

// 移动帧动画（与训练场一致）：pokemon-move 9 帧 sprite，单帧 32×32；向左复用向右序列，靠 scaleX(-1) 镜像
const MOVE_SEQ = { right: [0, 6, 1, 6], up: [2, 7, 3, 7], down: [4, 8, 5, 8] };
const MOVE_FRAME_MS = 200;
const MOVE_DUR_MS = 600; // 覆盖 0.5s 位移过渡，帧动画稍长避免瞬停
const MOVE_SCALE = 1.4; // 移动帧单帧 32px 比 icon 视觉小，放大到接近 icon 尺寸

// 饲育屋地图（{col,row} 为 terrain tileset 坐标）：围栏环绕 + 草地/花丛，11x9
const NURSERY = {
  tiles: [
    [[64,1],[64,1],[64,1],[64,1],[64,1],[64,1],[64,1],[64,1],[64,1],[64,1],[64,1]],
    [[66,1],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[66,1]],
    [[66,1],[1,0],[1,0],[5,1],[5,1],[1,0],[5,1],[5,1],[1,0],[1,0],[66,1]],
    [[66,1],[1,0],[5,1],[1,0],[1,0],[5,1],[1,0],[1,0],[5,1],[1,0],[66,1]],
    [[66,1],[1,0],[5,1],[1,0],[1,0],[1,0],[1,0],[1,0],[5,1],[1,0],[64,1]],
    [[66,1],[1,0],[1,0],[5,1],[1,0],[1,0],[1,0],[5,1],[1,0],[1,0],[64,1]],
    [[66,1],[1,0],[1,0],[1,0],[5,1],[1,0],[5,1],[1,0],[1,0],[1,0],[64,1]],
    [[66,1],[1,0],[1,0],[1,0],[1,0],[5,1],[1,0],[1,0],[1,0],[1,0],[64,1]],
    [[66,1],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[64,1]],
  ],
};
NURSERY.w = NURSERY.tiles[0].length;
NURSERY.h = NURSERY.tiles.length;
const NURSERY_W = NURSERY.w * TILE;
const NURSERY_H = NURSERY.h * TILE;

// 可走动瓦片：草地/花丛（不包含最外一圈围栏/边缘）
const NURSERY_LAND = new Set(['1,0', '5,1']);
const LAND_CELLS = [];
for (let r = 0; r < NURSERY.h; r++) {
  for (let c = 0; c < NURSERY.w; c++) {
    if (r === 0 || r === NURSERY.h - 1 || c === 0 || c === NURSERY.w - 1) continue;
    // 排除 [1,1] / [1,9]：纸箱子（左上）、告示牌（右上）占位格，禁止宝可梦走到这里
    if (NURSERY_LAND.has(NURSERY.tiles[r][c].join(',')) && !((c === 1 && r === 1) || (c === 9 && r === 1))) {LAND_CELLS.push({ c, r });
}
  }
}

// 繁殖特例编号（与图鉴 index 一致：补前导零，保证 getPokemonByIndex 命中）
const DITTO = '0132';    // 百变怪：万能配对
const MANAPHY = '0490';  // 玛纳霏：只能与百变怪繁殖（产玛纳霏）
// 幼年宝可梦 / 尼多娜·尼多后 / 神兽幻兽等：官方蛋组均为"未发现群"，由 noEggGroup 统一覆盖，无需特判

let _timer = null;
const _walkers = new Map();   // id -> walker 状态
const _walkerPos = new Map(); // id -> 上次位置 {c,r,facing}（页面重绘后沿用）
let _leaderId = null;         // 当前"被跟随"的宝可梦 id（A 跟一会儿 B，B 跟一会儿 A）
let _leaderSwitchAt = 0;      // 下一次切换被跟随者的时间戳
let _pickSlot = null;         // 非 null 时告示牌显示"放入宝可梦"列表（点击空槽后）
let _pickSortBy = null;   // 放入列表排序列：null=默认按编号+等级 | name | iv | level
let _pickSortDir = 1;     // 1 升序 / -1 降序
let _pickSearch = '';         // 放入列表搜索词
let _pickListScroll = 0;      // 进入个体详情前记住放入列表滚动位置，返回后恢复
let _pickRenderSeq = 0;       // 放入列表渲染序号：新一轮分片渲染取代旧轮
let _pickTypeFilter = '';     // 放入列表属性筛选
let _pickRegionFilter = '';   // 放入列表地区筛选
let _pickIvSel = [];        // 放入列表个体值多选：[{stat,min}]，全部条件需同时满足（AND）
let _eggView = false;         // 蛋仓库视图
let _confirmTakeSlot = -1;    // 双击取出：第一次点击进入待确认的槽位（-1=无）
let _eggQuery = '';           // 蛋搜索关键词
let _eggSortBy = null;    // 蛋列表排序列：null=默认按时间降序 | name | iv
let _eggSortDir = -1;     // 1 升序 / -1 降序
let _breedRounds = 1;         // 连续繁殖轮数（提交树果时选择，1~MAX_BREED_ROUNDS）
const MAX_BREED_ROUNDS = 10;  // 连续繁殖轮数上限

// ---------- 存档 ----------
// 保证饲育屋数据存在并补齐两个亲本槽位（兼容旧存档）
export function ensureNursery() {
  if (!gameData.nursery || !Array.isArray(gameData.nursery.parents)) {
    gameData.nursery = { parents: [null, null] };
  }
  while (gameData.nursery.parents.length < 2) gameData.nursery.parents.push(null);
  // lockedIv：锁定的遗传个体（null = 不锁定；{ key:'hp'|'atk'|…, source:'a'|'b' } = 锁定该项
  // 并固定继承指定亲本的数值，不再 50% 二选一，贴合原版"力量负重携带者固定遗传"设定）
  if (!('lockedIv' in gameData.nursery)) gameData.nursery.lockedIv = null;
  // breeding：当前繁殖批次（null = 未繁殖 / { startedAt, durMs, roundsTotal, roundsDone, reportedRounds }）
  // roundsTotal=提交的连续轮数，roundsDone=已自动入库的蛋数，reportedRounds=已提示过的产蛋数
  if (!('breeding' in gameData.nursery)) gameData.nursery.breeding = null;
  // 兼容旧版单轮 breeding（无 rounds 字段）：按 1 轮连续批次处理，蛋在下次结算时自动入库
  const b = gameData.nursery.breeding;
  if (b && (typeof b.roundsTotal !== 'number' || typeof b.roundsDone !== 'number')) {
    gameData.nursery.breeding = { startedAt: b.startedAt, durMs: b.durMs, roundsTotal: 1, roundsDone: 0, reportedRounds: 0 };
  }
  return gameData.nursery;
}

// ---------- 配对判定 ----------
// 返回 { ok, reason, mode?, childSpecies?, shared? }
// 类型1 常规：性别一雄一雌 + 至少共用 1 个蛋组 + 都不属未发现群
// 类型2 百变怪：一方百变怪 + 另一方不属未发现群（无视性别）
export function checkPairing(entryA, entryB) {
  const aDitto = String(entryA.species) === DITTO;
  const bDitto = String(entryB.species) === DITTO;
  if (aDitto && bDitto) return { ok: false, reason: '百变怪之间无法繁殖' };
  if (aDitto || bDitto) {
    const other = aDitto ? entryB : entryA;
    const poke = getPokemonByIndex(String(other.species));
    if (!poke || poke.noEggGroup) return { ok: false, reason: '另一只属于未发现蛋组，无法繁殖' };
    // 百变怪与玛纳霏：后代为玛纳霏本身（原版规则是产霏欧纳，这里统一为亲本物种）
    if (String(other.species) === MANAPHY) return { ok: true, mode: 'ditto', childSpecies: MANAPHY, shared: ['百变怪'] };
    return { ok: true, mode: 'ditto', childSpecies: other.species, shared: ['百变怪'] };
  }
  const ga = ensureGender(entryA);
  const gb = ensureGender(entryB);
  if (ga === 'genderless' || gb === 'genderless' || ga === gb) {
    return { ok: false, reason: '需要一雄一雌' };
  }
  const pa = getPokemonByIndex(String(entryA.species));
  const pb = getPokemonByIndex(String(entryB.species));
  if (!pa || !pb || pa.noEggGroup || pb.noEggGroup) return { ok: false, reason: '属于未发现蛋组，无法繁殖' };
  if (String(entryA.species) === MANAPHY || String(entryB.species) === MANAPHY) {
    return { ok: false, reason: '玛纳霏只能与百变怪繁殖' };
  }
  const shared = (pa.eggGroup || []).filter(g => (pb.eggGroup || []).includes(g));
  if (!shared.length) return { ok: false, reason: '没有共同蛋组，无法繁殖' };
  const female = ga === 'female' ? entryA : entryB;
  return { ok: true, mode: 'normal', childSpecies: female.species, shared };
}

// 配对角色判定：返回该槽亲本在配对中的角色 'mother' | 'father'
// 正常配对：雌性=母方、雄性=父方
// 百变怪配对：非百变怪按自身性别判定（雄性=父方、雌性=母方、无性别=母方，提供后代物种的一方）；
// 百变怪充当与对方相反的角色（对方雄性→母方，对方雌性/无性别→父方）
function pairRole(ea, eb, sid) {
  const entry = sid === 'b' ? eb : ea;
  const other = sid === 'b' ? ea : eb;
  const r = checkPairing(ea, eb);
  if (!r || !r.ok) return 'father';
  if (r.mode !== 'ditto') return ensureGender(entry) === 'female' ? 'mother' : 'father';
  if (String(entry.species) === DITTO) {
    return ensureGender(other) === 'male' ? 'mother' : 'father';
  }
  return ensureGender(entry) === 'male' ? 'father' : 'mother';
}

// ---------- 互斥：放入饲育屋 / 取出 ----------
export function showNurseryView() {
  pushNav('nurseryView');
  _pickSlot = null; // 重新进入饲育屋时退出选取页
  _pickSearch = '';
  _pickTypeFilter = '';
  _pickRegionFilter = '';
  _pickIvSel = [];
  // 先结算离开期间产出的蛋（自动入库），再进入页面；有新蛋时底部弹出提示
  const produced = settleBreeding();
  render();
  showView('nurseryView');
  startTimer();
  if (produced > 0) notifyNewEggs(produced);
}

// 从所有亲本槽移除该个体（训练/配队放入时调用）
export function removeNurseryByPokemon(id) {
  const n = ensureNursery();
  let changed = false;
  for (let i = 0; i < n.parents.length; i++) {
    if (n.parents[i] && n.parents[i].id === id) {
      // 亲本被训练/配队取走：繁殖直接终止（已产蛋自动入库，无丢失）
      if (n.breeding) n.breeding = null;
      n.parents[i] = null; changed = true;
    }
  }
  if (changed) saveGame();
  return changed;
}

// 该个体是否在饲育屋亲本槽中（放入页占用确认用）
export function isNurseryPokemon(id) {
  return ensureNursery().parents.some(p => p && p.id === id);
}

// 仓库选取：从列表项放入饲育屋（空槽点击跳转仓库后由列表项触发）。
// 若该个体正被训练/队伍占用，先弹确认框，确认后才放入（自动撤下原占用方）
export function addToNursery(id, slot) {
  const n = ensureNursery();
  if (n.parents[slot]) return; // 目标槽已被占用则不处理
  Promise.all([
    import('./train.js').then(m => m.isTrainingPokemon(id)),
    import('./team.js').then(m => m.isInAnyTeam(id)),
  ]).then(([inTrain, inTeam]) => {
    const occ = [];
    if (inTrain) occ.push('训练');
    if (inTeam) occ.push('队伍');
    if (occ.length) {
      showConfirmBar(`这只宝可梦正在${occ.join('、')}中。放入饲育屋将自动将其撤下，确定放入？`, () => doAddToNursery(id, slot), null);
      return;
    }
    doAddToNursery(id, slot);
  });
}

function doAddToNursery(id, slot) {
  const n = ensureNursery();
  if (n.parents[slot]) return; // 目标槽已被占用则不处理
  n.parents[slot] = { id, placedAt: Date.now() };
  _pickSearch = ''; // 放入成功后清空搜索词，避免放第二只时残留第一只页面的输入
  _pickSlot = null; // 退出放入页
  // 饲育屋中的宝可梦不能留在任何配队队伍 / 训练槽里
  removePokemonFromAllTeams(id);
  import('./train.js').then(m => m.removeTrainingByPokemon(id));
  saveGame();
  render();
  openBoard(); // 放入后回场地，打开配对面板查看状态
  showView('nurseryView');
  startTimer();
}

// 点击已有亲本槽取出（繁殖中取出 = 终止本次繁殖，树果不退；蛋已自动入库无丢失）
function removeParent(slot) {
  const n = ensureNursery();
  if (!n.parents[slot]) return;
  if (n.breeding) n.breeding = null; // 繁殖中/完成后取出亲本终止剩余轮次
  n.parents[slot] = null;
  saveGame();
  render();
  refreshBoard();
}

// ---------- 页面渲染 ----------
function render() {
  const box = $('nurseryContent');
  if (!box) return;
  // 蛋仓库视图
  if (_eggView) { renderEggView(); return; }
  // 选取宝可梦：切到全页列表（不占用告示牌面板）
  if (_pickSlot != null) { renderPickPage(box); return; }
  box.innerHTML = `
    <div class="nursery-app">
      <div class="nursery-field">
        <canvas class="nursery-field-canvas" width="${NURSERY_W}" height="${NURSERY_H}"></canvas>
        <div class="nursery-walkers"></div>
        <img class="nursery-box-sign berry-icon" src="${BOX_IMG}" data-tip="查看宝可梦蛋" alt="蛋仓库" />
        <img class="nursery-board-sign berry-icon" src="${BOARD_IMG}" data-tip="点击管理宝可梦" alt="告示牌" />
      </div>
    </div>`;
  drawField(box.querySelector('.nursery-field-canvas'));
  _walkers.clear();
  syncWalkers();
  box.querySelector('.nursery-box-sign').addEventListener('click', (e) => {
    e.stopPropagation();
    if (boardOpen()) closeBoard();
    openEggView();
  });
  box.querySelector('.nursery-board-sign').addEventListener('click', (e) => {
    e.stopPropagation();
    if (boardOpen()) closeBoard();
    else openBoard();
  });
}

// 全页"放入宝可梦"列表：顶部仅标题，返回走标题栏（appTitle）
function renderPickPage(box) {
  // 标题后小字跟上另一槽亲本的蛋组，作为配对参考
  const n = ensureNursery();
  const other = n.parents[1 - _pickSlot];
  let eggNote = '';
  if (other && other.id) {
    const entry = (gameData.roster || []).find(x => x.id === other.id);
    const poke = entry ? getPokemonByIndex(String(entry.species)) : null;
    const egg = poke ? ((poke.eggGroup || []).join(' / ') || (poke.noEggGroup ? '未发现蛋组' : '')) : '';
    if (egg) eggNote = ` 目标蛋组：${egg}`;
  }
  box.innerHTML = `
    <div class="view-list" style="display:flex;flex-direction:column;flex:1;min-height:0;">
      <div class="pokedex-progress" id="nurseryPickProgress" style="${eggNote ? 'display:flex;justify-content:space-between;align-items:center;gap:8px;' : ''}">
        <span id="nurseryPickProgressCount"></span>
        ${eggNote ? `<span class="nursery-pick-egggroup">${eggNote}</span>` : ''}
      </div>
      <div class="pokedex-search">
        <div class="pokedex-search-row">
          <div class="pokedex-search-input-wrap">
            <input id="nurseryPickSearch" class="pokedex-search-input" type="text" placeholder="搜索宝可梦"
              autocomplete="off" value="${_pickSearch.replace(/"/g, '&quot;')}" />
            <button class="pokedex-search-clear" id="nurseryPickSearchClear" style="${_pickSearch ? '' : 'display:none'}" aria-label="清空搜索">
              <svg><use xlink:href="#icon-close"></use></svg>
            </button>
          </div>
          <div id="nurseryPickTypeFilter" class="pokedex-region-select" tabindex="0" title="按属性筛选">
            <span id="nurseryPickTypeFilterLabel">${_pickTypeFilter ? _pickTypeFilter : '属性'}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="nurseryPickTypeFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
          <div id="nurseryPickRegionFilter" class="pokedex-region-select" tabindex="0" title="按地区筛选">
            <span id="nurseryPickRegionFilterLabel">${_pickRegionFilter || '地区'}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="nurseryPickRegionFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
          <div id="nurseryPickIvFilter" class="pokedex-region-select" tabindex="0" title="按个体值筛选">
            <span id="nurseryPickIvFilterLabel">${pickIvFilterLabel()}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="nurseryPickIvFilterDropdown" class="region-dropdown nursery-iv-dd" style="display:none;"></div>
          </div>
        </div>
      </div>
      <div class="pokedex-header roster-header nursery-pick-header">
        <span class="roster-icon"></span>
        <span class="pokedex-star"></span>
        <span class="pokedex-name" data-sort="name">名称</span>
        <span class="roster-lv-col" data-sort="level">等级</span>
        <span class="roster-iv" data-sort="iv">个体值</span>
        <span class="bounty-trade-btn-col">放入</span>
      </div>
      <div class="list-scroll nursery-pick-list">
      </div>
    </div>`;
  // 更新进度文字（与目标蛋组同行显示）
  const prog = box.querySelector('#nurseryPickProgress');
  if (prog) {
    const total = (gameData.roster || []).filter(p => !p.inNursery && !p.inTeam).length;
    const countEl = prog.querySelector('#nurseryPickProgressCount') || prog;
    countEl.textContent = eggNote ? `可放入 ${total} 只` : `共 ${total} 只可放入`;
  }
  // 设置标题栏
  const title = $('appTitle');
  if (title) {
    title.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 放入';
    title.dataset.action = 'back';
  }
  // 行事件委托：行 DOM 由分片渲染动态插入，委托绑定一次，避免每片重复绑定
  const list = box.querySelector('.nursery-pick-list');
  if (list) {
    list.onclick = (e) => {
      const btn = e.target.closest('[data-pick-submit]');
      if (btn) {
        e.stopPropagation();
        // 放入动作由 addToNursery 内部处理：占用时弹确认框（确认后才回场地开面板），
        // 无占用直接放入回场地；不能在此同步 openBoard，否则确认框弹出时面板也一起弹出
        addToNursery(btn.dataset.pickSubmit, _pickSlot);
        return;
      }
      const row = e.target.closest('[data-pick-view]');
      if (!row) return;
      e.stopPropagation();
      _pickListScroll = list.scrollTop; // 记住列表位置，返回后恢复
      import('./roster.js').then(m => m.showRosterDetailFromList(row.dataset.pickView, () => {
        showView('nurseryView');
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

// 筛选下拉菜单绑定（只在 renderPickPage 时调用一次，避免 refreshPickList 重复绑定）
function bindPickFilters(root) {
  // 属性筛选下拉
  const typeTrigger = root.querySelector('#nurseryPickTypeFilter');
  const typeLabel = root.querySelector('#nurseryPickTypeFilterLabel');
  const typeDd = root.querySelector('#nurseryPickTypeFilterDropdown');
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
          typeDd.style.display = 'none';
          typeTrigger.classList.remove('open');
          refreshPickList();
        });
      });
    }
    typeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = typeDd.style.display !== 'none';
      root.querySelectorAll('.region-dropdown').forEach(d => d.style.display = 'none');
      root.querySelectorAll('.pokedex-region-select').forEach(s => s.classList.remove('open'));
      if (!open) { buildTypeOptions(); typeDd.style.display = ''; typeTrigger.classList.add('open'); }
    });
    document.addEventListener('click', () => { typeDd.style.display = 'none'; typeTrigger.classList.remove('open'); });
  }
  // 地区筛选下拉
  const regionTrigger = root.querySelector('#nurseryPickRegionFilter');
  const regionLabel = root.querySelector('#nurseryPickRegionFilterLabel');
  const regionDd = root.querySelector('#nurseryPickRegionFilterDropdown');
  if (regionTrigger && regionLabel && regionDd) {
    function buildRegionOptions() {
      regionDd.innerHTML = `<div class="region-dropdown-item${!_pickRegionFilter ? ' active' : ''}" data-region="">全部</div>`
        + REGION_CYCLE.map(r => `<div class="region-dropdown-item${r === _pickRegionFilter ? ' active' : ''}" data-region="${r}">${r}</div>`).join('');
      regionDd.querySelectorAll('.region-dropdown-item').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          _pickRegionFilter = el.dataset.region || '';
          regionLabel.textContent = _pickRegionFilter || '地区';
          regionDd.style.display = 'none';
          regionTrigger.classList.remove('open');
          refreshPickList();
        });
      });
    }
    regionTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = regionDd.style.display !== 'none';
      root.querySelectorAll('.region-dropdown').forEach(d => d.style.display = 'none');
      root.querySelectorAll('.pokedex-region-select').forEach(s => s.classList.remove('open'));
      if (!open) { buildRegionOptions(); regionDd.style.display = ''; regionTrigger.classList.add('open'); }
    });
    document.addEventListener('click', () => { regionDd.style.display = 'none'; regionTrigger.classList.remove('open'); });
  }
  // 个体值筛选面板：6 项个体值各带档位，可多选（AND），选中后面板保持打开，点击空白关闭
  const ivTrigger = root.querySelector('#nurseryPickIvFilter');
  const ivLabel = root.querySelector('#nurseryPickIvFilterLabel');
  const ivDd = root.querySelector('#nurseryPickIvFilterDropdown');
  if (ivTrigger && ivLabel && ivDd) {
    const IV_ITEMS = [['hp', 'HP'], ['atk', '攻'], ['def', '防'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速']];
    const IV_LEVELS = [20, 25, 31]; // 下限档位
    function ivLevelLabel(v) { return v === 31 ? '31' : `≥${v}`; }
    // 当前该档位是否已选中
    function ivSelected(k, v) {
      return _pickIvSel.some(s => s.stat === k && s.min === v);
    }
    function buildIvOptions() {
      ivDd.innerHTML = `
        <div class="region-dropdown-item${!_pickIvSel.length ? ' active' : ''}" data-iv-clear="1">全部</div>
        <div class="nursery-iv-panel">
          ${IV_ITEMS.map(([k, cn]) => `
          <div class="nursery-iv-col${_pickIvSel.some(s => s.stat === k) ? ' active' : ''}">
            <div class="nursery-iv-col-head">${cn}</div>
            ${IV_LEVELS.map(v =>
              `<div class="nursery-iv-lvl${ivSelected(k, v) ? ' active' : ''}" data-iv="${k}" data-min="${v}">${ivLevelLabel(v)}</div>`
            ).join('')}
          </div>`).join('')}
        </div>`;
      // 全部：清空所有个体值条件
      const clearEl = ivDd.querySelector('[data-iv-clear]');
      if (clearEl) clearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        _pickIvSel = [];
        ivLabel.textContent = pickIvFilterLabel();
        ivDd.style.display = 'none';
        ivTrigger.classList.remove('open');
        refreshPickList();
      });
      // 档位：切换选中状态（多选，不关闭面板）
      ivDd.querySelectorAll('.nursery-iv-lvl').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const k = el.dataset.iv;
          const v = Number(el.dataset.min);
          const idx = _pickIvSel.findIndex(s => s.stat === k && s.min === v);
          if (idx >= 0) _pickIvSel.splice(idx, 1);
          else _pickIvSel.push({ stat: k, min: v });
          ivLabel.textContent = pickIvFilterLabel();
          buildIvOptions(); // 重建以刷新选中态，面板保持打开
          refreshPickList();
         });
       });
-       // 点击面板内部空白不关闭
-       ivDd.addEventListener('click', (e) => e.stopPropagation());
     }
+    // 点击面板内部空白不关闭（仅绑定一次，buildIvOptions 重建内容不影响）
+    ivDd.addEventListener('click', (e) => e.stopPropagation());
     ivTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = ivDd.style.display !== 'none';
      root.querySelectorAll('.region-dropdown').forEach(d => d.style.display = 'none');
      root.querySelectorAll('.pokedex-region-select').forEach(s => s.classList.remove('open'));
      if (!open) { buildIvOptions(); ivDd.style.display = ''; ivTrigger.classList.add('open'); }
    });
    // 点击面板外任意空白区域关闭
    document.addEventListener('click', () => {
      if (ivDd.style.display !== 'none') {
        ivDd.style.display = 'none';
        ivTrigger.classList.remove('open');
      }
    });
  }
}

// 选取页是否打开（供 main.js 标题栏返回使用）
export function isNurseryPicking() {
  return _pickSlot != null && $('nurseryView')?.style.display !== 'none';
}

// 标题栏返回：退出选取页，回饲育屋场地并打开告示牌
export function leaveNurseryPick() {
  if (_pickSlot == null) return;
  _pickSlot = null;
  _pickSearch = '';
  _pickTypeFilter = '';
  _pickRegionFilter = '';
  _pickIvSel = [];
  render();
  // 恢复标题栏
  const title = $('appTitle');
  if (title) {
    title.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 饲育屋';
    title.dataset.action = 'back';
  }
  // 延迟到当前 click 冒泡结束后再打开告示牌弹窗：document 上注册了"点击面板外部关闭"
  // 的全局监听（见下方），标题栏返回的 click 会冒泡触发它；若同步 openBoard，
  // 弹窗刚打开就会被误关（表现为返回后配置弹窗被隐藏）
  setTimeout(openBoard, 0);
}

// 绘制 tile 地图到画布（与农田/训练场同款 tileset，放大 1.5x 像素风）
function drawField(canvas) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = NURSERY_W * dpr;
  canvas.height = NURSERY_H * dpr;
  canvas.style.width = NURSERY_W + 'px';
  canvas.style.height = NURSERY_H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  const img = new Image();
  img.onload = () => {
    for (let r = 0; r < NURSERY.h; r++) {
      for (let c = 0; c < NURSERY.w; c++) {
        const [tc, tr] = NURSERY.tiles[r][c];
        ctx.drawImage(img, tc * 16, tr * 16, 16, 16, c * TILE, r * TILE, TILE, TILE);
      }
    }
  };
  img.src = TILESET;
}

// ---------- 场地亲本：随机走动 ----------
function syncWalkers() {
  const wrap = $('nurseryContent')?.querySelector('.nursery-walkers');
  if (!wrap) return;
  const n = ensureNursery();
  const want = new Set(n.parents.filter(s => s && s.id).map(s => s.id));
  // 移除已不在饲育屋的 walker
  for (const [id, w] of _walkers) {
    if (want.has(id)) continue;
    w.el.remove();
    _walkers.delete(id);
    _walkerPos.delete(id);
  }
  for (const slot of n.parents) {
    if (!slot || _walkers.has(slot.id)) continue;
    const entry = (gameData.roster || []).find(x => x.id === slot.id);
    if (!entry || entry.inRoster === false) continue;
    const poke = getPokemonByIndex(String(entry.species));
    // 初始落点：已有存档沿用；新放置则随机挑一个不与其它亲本同格的格子
    let cell = _walkerPos.get(slot.id);
    if (!cell) {
      const far = LAND_CELLS.filter(lc => {
        for (const [oid, op] of _walkerPos) {
          if (oid !== slot.id && op.c === lc.c && op.r === lc.r) return false;
        }
        return true;
      });
      const pool = far.length ? far : LAND_CELLS;
      cell = pool[Math.floor(Math.random() * pool.length)];
    }
    const w = {
      id: slot.id,
      el: document.createElement('div'),
      flipEl: document.createElement('div'),
      img: document.createElement('img'),
      x: cell.c * TILE,
      y: cell.r * TILE,
      facing: cell.facing ?? (Math.random() < 0.5 ? 1 : -1),
      // 各自随机起步时间，避免两只同时迈步（共速）
      nextAt: Date.now() + randInt(400, 1400),
      move: false,           // 是否启用移动帧动画
      scale: 1,              // 本体显示放大倍率（move 素材启用后设为 MOVE_SCALE）
      frameCount: 1, frameW: 1,
      seq: MOVE_SEQ.right, frame: 0,
      moving: false, moveUntil: 0, lastFrameAt: 0,
    };
    w.el.className = 'nursery-walker';
    w.flipEl.className = 'nursery-walker-flip';
    w.img.className = 'nursery-walker-img';
    // 像素图标（与训练场一致）；素材默认朝左，向右走才镜像。
    // 同一 img 只走一个请求：非变体先试 move，失败回退 icon；变体直接加载 icon，
    // 避免静态 icon 请求被 move 请求抢占导致缓存未建立、src 停留失败 URL 破图
    // 随机相位：多只亲本的弹跳动画错开，避免同步
    w.img.style.animationDelay = '-' + (Math.random() * 0.5).toFixed(2) + 's';
    if (w.facing < 0) w.flipEl.style.transform = 'scaleX(-1)';
    // 移动帧动画（与训练场一致）：仅无变体本体尝试；素材缺失/非多帧自动回退 icon+跳动
    if (poke && !String(poke.index).includes('-')) {
      const moveSrc = './pokemon-data/pokemon-move/' + String(poke.index).padStart(4, '0') + '-' + poke.name + '.png';
      tryLoadImage(w.img, moveSrc).then(ok => {
        if (!ok) { if (poke?.icon) tryLoadImage(w.img, poke.icon); return; } // 无 move 素材回退 icon+跳动
        const nw = w.img.naturalWidth, nh = w.img.naturalHeight;
        const fc = nw && nh ? Math.max(1, Math.round(nw / nh)) : 1;
        if (fc < 2) { if (poke?.icon) tryLoadImage(w.img, poke.icon); return; } // 非多帧素材回退 icon+跳动
        w.move = true;
        w.frameCount = fc;
        w.frameW = nw / fc;
        w.img.style.objectFit = 'none';
        w.img.style.objectPosition = '0px 0px';
        w.img.classList.add('move'); // 移动帧模式彻底停用上下跳动，行走切帧、静止保持帧
        w.scale = MOVE_SCALE;
        w.flipEl.style.transformOrigin = 'center';
        w.flipEl.style.transform = (w.facing < 0 ? 'scaleX(-1) ' : '') + 'scale(' + MOVE_SCALE + ')';
        addMoveAnim(w);
      });
    } else if (poke?.icon) {
      // 变体无移动素材：直接加载静态图标
      tryLoadImage(w.img, poke.icon);
    }
    w.flipEl.appendChild(w.img);
    w.el.appendChild(w.flipEl);
    // 爱心粒子层（繁殖进行中才显示，由 syncWalkers 末尾同步显隐）：头顶 ♥ 上浮放大淡出
    const fx = document.createElement('div');
    fx.className = 'nursery-walker-fx';
    for (let i = 0; i < 4; i++) {
      const p = document.createElement('i');
      p.textContent = '♥';
      p.style.left = (Math.random() * 24 - 12) + 'px';
      p.style.animationDelay = (i * 0.45).toFixed(2) + 's';
      fx.appendChild(p);
    }
    fx.style.display = 'none';
    w.el.appendChild(fx);
    w.fx = fx;
    const g = ensureGender(entry);
    const gText = g === 'female' ? '♀' : g === 'male' ? '♂' : '⚲'; 
    const tip = poke ? `${entry.nickname || poke.name} ${gText}` : '';
    if (tip) w.el.setAttribute('data-tip', tip);
    w.el.style.left = w.x + 'px';
    w.el.style.top = w.y + 'px';
    w.el.style.zIndex = 10 + w.y; // 俯视层级：靠下的亲本盖住靠上的，避免相邻时互相遮挡
    // 初始站着不动：先不跳，首次移动时才起跳
    w.img.classList.add('idle');
    // 位移结束（停下）后停止跳动；再次移动时恢复
    w.el.addEventListener('transitionend', () => w.img.classList.add('idle'));
    wrap.appendChild(w.el);
    _walkers.set(slot.id, w);
    _walkerPos.set(slot.id, { c: cell.c, r: cell.r, facing: w.facing });
  }
  // 爱心显隐同步：繁殖进行中（running）时，仅当前追随方（跟在带头者身后的那只）飘爱心；
  // 带头者不飘；未繁殖/单只在场均不显示
  const love = loveActive(n);
  for (const [, w] of _walkers) {
    if (!w.fx) continue;
    const isFollower = love && _leaderId && w.id !== _leaderId;
    w.fx.style.display = isFollower ? '' : 'none';
  }
}

// ---------- 移动帧驱动（与训练场一致：共享 RAF 切帧，参考随从走马灯） ----------
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
      w.img.style.objectPosition = `-${idx * w.frameW}px 0px`;
    }
  }
  if (_moveImgs.length > 0) _moveRaf = requestAnimationFrame(moveTick);
  else _moveRaf = null;
}

// 繁殖进行中才飘爱心：两只亲本配对有效且 breeding 处于 running（已产蛋后停止）
function loveActive(n) {
  const [a, b] = n.parents;
  if (!a || !b) return false;
  const ea = (gameData.roster || []).find(x => x.id === a.id);
  const eb = (gameData.roster || []).find(x => x.id === b.id);
  if (!ea || !eb || ea.inRoster === false || eb.inRoster === false) return false;
  if (!checkPairing(ea, eb).ok) return false;
  return breedingState(n).key === 'running';
}

// 每秒让亲本移动：两只都在场时一只"带头"自由走动、另一只跟在后面；
// 过一段时间（6~12 秒）互换角色，实现 A 跟 B 一会儿、B 跟 A 一会儿
function walkerTick() {
  const wrap = $('nurseryContent')?.querySelector('.nursery-walkers');
  if (!wrap) return;
  const now = Date.now();
  const ids = [..._walkers.keys()];
  // 确定带头者（被跟随的一方）
  let leaderId = null;
  if (ids.length === 2) {
    if (!_leaderId || !_walkers.has(_leaderId) || now >= _leaderSwitchAt) {
      _leaderId = ids.find(id => id !== _leaderId) ?? ids[0];
      _leaderSwitchAt = now + randInt(6000, 12000);
    }
    leaderId = _leaderId;
  } else {
    _leaderId = null;
  }
  const dist = (a, b) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
  for (const [, w] of _walkers) {
    if (now < w.nextAt) continue; // 各自随机节奏，避免两只共速同步迈步
    const cur = _walkerPos.get(w.id);
    if (!cur) continue;
    const lead = leaderId && leaderId !== w.id ? _walkerPos.get(leaderId) : null;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const opts = [];
    for (const [dc, dr] of dirs) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (nr < 1 || nr >= NURSERY.h - 1 || nc < 1 || nc >= NURSERY.w - 1) continue;
      if (!NURSERY_LAND.has(NURSERY.tiles[nr][nc].join(','))) continue;
      // 贴图碰撞：只禁止与另一只亲本同格（相邻格允许，靠面对面逻辑让两只并排对望）
      let clash = false;
      for (const [oid, op] of _walkerPos) {
        if (oid !== w.id && op.c === nc && op.r === nr) { clash = true; break; }
      }
      if (clash) continue;
      opts.push({ c: nc, r: nr });
    }
    if (!opts.length) continue;
    let next;
    if (lead) {
      // 跟随者：优先走向带头者；已贴在一起就原地歇一会儿，避免挤作一团
      if (dist(cur, lead) <= 1 && Math.random() < 0.7) continue;
      opts.sort((x, y) => dist(x, lead) - dist(y, lead));
      next = opts[0];
    } else {
      next = opts[Math.floor(Math.random() * opts.length)];
    }
    w.busy = true;
    w.x = next.c * TILE;
    w.y = next.r * TILE;
    // move 素材默认朝右、icon 素材默认朝左：向左走 icon 不镜像 / move 镜像，向右相反
    const nf = w.move
      ? (next.c < cur.c ? -1 : next.c > cur.c ? 1 : w.facing)
      : (next.c < cur.c ? 1 : next.c > cur.c ? -1 : w.facing);
    if (nf !== w.facing) {
      w.flipEl.style.transform = (nf < 0 ? 'scaleX(-1) ' : '') + (w.scale > 1 ? 'scale(' + w.scale + ')' : '');
      w.facing = nf;
    }
    // 移动帧：按方向选帧序列并启动切帧（左/右共用向右序列，向左靠镜像翻转）
    if (w.move) {
      w.seq = next.c === cur.c && next.r < cur.r ? MOVE_SEQ.up : next.c === cur.c && next.r > cur.r ? MOVE_SEQ.down : MOVE_SEQ.right;
      w.frame = 0;
      w.lastFrameAt = performance.now();
      w.moveUntil = w.lastFrameAt + MOVE_DUR_MS;
      w.moving = true;
      // 立即切到新方向第一帧：贴图先朝移动方向，再开始位移（避免起步时仍显示旧方向帧）
      w.img.style.objectPosition = `-${(w.seq[0] % w.frameCount) * w.frameW}px 0px`;
    }
    w.el.style.left = w.x + 'px';
    w.el.style.top = w.y + 'px';
    w.el.style.zIndex = 10 + w.y; // 俯视层级随 y 递增
    w.img.classList.remove('idle'); // 开始走动：恢复上下跳动（停下时 transitionend 再加回）
    _walkerPos.set(w.id, { c: next.c, r: next.r, facing: w.facing });
    w.nextAt = now + randInt(900, 2200); // 迈步后随机歇息，节奏各异
  }
  // 两只左右相邻时强制面对面（左朝右、右朝左），避免背靠背
  if (_walkers.size === 2) {
    const [aId, bId] = [..._walkers.keys()];
    const pa = _walkerPos.get(aId), pb = _walkerPos.get(bId);
    if (pa && pb && pa.r === pb.r && Math.abs(pa.c - pb.c) === 1) {
      const applyFacing = (id, f) => {
        const w = _walkers.get(id);
        if (!w || w.facing === f) return;
        w.facing = f;
        w.flipEl.style.transform = (f < 0 ? 'scaleX(-1) ' : '') + (w.scale > 1 ? 'scale(' + w.scale + ')' : '');
      };
      const leftId = pa.c < pb.c ? aId : bId;
      const rightId = pa.c < pb.c ? bId : aId;
      // 面对面：左边的朝右、右边的朝左。move 素材默认朝右（朝右不镜像）、icon 默认朝左（朝右才镜像），facing 取值相反
      const lw = _walkers.get(leftId), rw = _walkers.get(rightId);
      applyFacing(leftId, lw && lw.move ? 1 : -1);
      applyFacing(rightId, rw && rw.move ? -1 : 1);
    }
  }
}

// ---------- 告示牌弹窗：亲本槽位 + 配对状态 ----------
function boardOpen() {
  const host = $('nurseryBoardHost');
  return !!host && host.style.display !== 'none';
}

function boardHost() {
  let host = $('nurseryBoardHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'nurseryBoardHost';
    host.style.display = 'none';
    $('nurseryView').appendChild(host);
  }
  return host;
}

function openBoard() {
  _confirmTakeSlot = -1; // 新打开面板不残留上次的待确认态
  const host = boardHost();
  host.innerHTML = boardHtml();
  host.style.display = '';
  loadSlotIcons(host);
  bindSlots(host);
  host.querySelectorAll('[data-board-close]').forEach(btn => btn.addEventListener('click', closeBoard));
}

function closeBoard() {
  _confirmTakeSlot = -1;
  const host = $('nurseryBoardHost');
  if (!host) return;
  host.innerHTML = '';
  host.style.display = 'none';
}

// 点击面板外部关闭（页面本身隐藏时不做自动关闭，保证跳仓库回来后仍打开）
document.addEventListener('click', (e) => {
  if ($('nurseryView')?.style.display === 'none') return;
  const host = $('nurseryBoardHost');
  if (!host || host.style.display === 'none') return;
  if (host.contains(e.target)) return;
  closeBoard();
});

function boardHtml() {
  const n = ensureNursery();
  const slots = n.parents.map((s, i) => slotHtml(s, i));
  return `
    <div class="berry-picker berry-board nursery-panel">
      <div class="berry-picker-head">
        <span class="berry-picker-title">饲育屋</span>
        <div class="berry-picker-x" data-board-close>✕</div>
      </div>
      <div class="berry-board-sections">
        <div class="nursery-pair-row">${slots[0]}<span class="nursery-pair-plus">＋</span>${slots[1]}</div>
        ${pairStatusHtml(n)}
      </div>
    </div>`;
}

// 局部刷新放入列表（搜索/排序时只重建列表）。防抖合并快速连续触发（连点排序/连续输入），
// 否则多轮分片渲染的图标请求并发叠加，触发浏览器资源上限 ERR_INSUFFICIENT_RESOURCES
let _pickRefreshT = null;
function refreshPickList() {
  clearTimeout(_pickRefreshT);
  _pickRefreshT = setTimeout(() => {
    const page = $('nurseryContent');
    if (!page || _pickSlot == null) return;
    const list = page.querySelector('.nursery-pick-list');
    if (!list) return;
    renderPickRows(list); // 新一轮分片渲染自动取代旧轮（行 DOM 由委托绑定）
    markPickSort(page); // 点击排序后同步三角箭头（表头是持久 DOM，需主动刷新标记）
  }, 80);
}

// 个体值总和
function pickIvSum(p) {
  if (!p.ivs) return 0;
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].reduce((s, k) => s + (p.ivs[k] || 0), 0);
}
// 个体值明细（hover 个体值单元格的 tooltip 显示；HP 用全角 ＨＰ，与中文标签同宽，数值自然对齐）
function ivTip(ivs) {
  return [['ＨＰ', 'hp'], ['攻击', 'atk'], ['防御', 'def'], ['特攻', 'spa'], ['特防', 'spd'], ['速度', 'spe']]
    .map(([label, k]) => `${label}  ${ivs ? (ivs[k] || 0) : 0}`)
    .join('\n');
}
function pickIvTip(p) {
  return ivTip(p.ivs);
}
function pickIvFilterLabel() {
  return _pickIvSel.length ? `个体*${_pickIvSel.length}` : '个体值';
}

// "放入宝可梦"列表候选：全部在仓个体（排除另一槽已放入的），复用悬赏提交列表的行结构——
// 个体值（综合，hover 看明细） / 等级（性别跟在等级边上） / 放入；点击行跳转个体详情（返回后仍在列表）
function pickPickRows() {
  const n = ensureNursery();
  const exclude = new Set(n.parents.filter(s => s && s.id).map(s => s.id));
  const other = n.parents[1 - _pickSlot];
  const otherEntry = other && other.id
    ? (gameData.roster || []).find(x => x.id === other.id) || null
    : null;
  const q = _pickSearch.trim();
  return (gameData.roster || [])
    .filter(p => p.inRoster && !exclude.has(p.id))
    .filter(p => !p.kind || p.kind !== 'egg')
    .filter(p => {
      const poke = getPokemonByIndex(String(p.species));
      return poke && !poke.noEggGroup;
    })
    .filter(p => !otherEntry || checkPairing(otherEntry, p).ok)
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
    // 个体值筛选：多选条件需全部满足（如攻≥25 且 速≥31）
    .filter(p => {
      if (!_pickIvSel.length) return true;
      return _pickIvSel.every(({ stat, min }) =>
        p.ivs && p.ivs[stat] != null && p.ivs[stat] >= min);
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
    <span class="pokedex-star">${p.shiny ? '★' : ''}</span>
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
    const view = $('nurseryView');
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

// 亲本槽位：空位点击去仓库放入；已有宝可梦点击取出（繁殖中取出=终止，已产蛋先收取）
function slotHtml(slot, i) {
  if (!slot) return `<div class="nursery-slot empty" data-slot="${i}" title="点击放入宝可梦">＋</div>`;
  const entry = (gameData.roster || []).find(x => x.id === slot.id);
  if (!entry || entry.inRoster === false) return `<div class="nursery-slot empty" data-slot="${i}" title="点击放入宝可梦">＋</div>`;
  const poke = getPokemonByIndex(String(entry.species));
  const name = entry.nickname || (poke ? poke.name : `#${entry.species}`);
  const egg = poke && (poke.eggGroup || []).length ? poke.eggGroup.join(' / ') : poke?.noEggGroup ? '未发现蛋组' : '—';
  const st = breedingState(ensureNursery());
  const tip = st.key === 'running' ? '繁殖中，取出将终止剩余轮次（树果不退）'
    : st.key === 'done' ? '本轮繁殖完成，取出后可开始新一批' : '点击取出';
  const shiny = entry.shiny
    ? '<svg viewBox="0 0 1024 1024" width="10" height="10" style="flex-shrink:0;color:var(--ui-color);vertical-align:-1px;"><use xlink:href="#icon-star"/></svg>'
    : '';
  return `<div class="nursery-slot" data-slot="${i}" title="${tip}">
    <img class="nursery-slot-icon" data-icon="${entry.species}" alt="">
    <div class="nursery-slot-info">
      <div class="nursery-slot-name">${_confirmTakeSlot === i ? '再次点击取出' : `${name}${shiny}<em>${genderBadge(ensureGender(entry))}</em>`}</div>
      <div class="nursery-slot-egg">${egg}</div>
    </div>
  </div>`;
}

function loadSlotIcons(host) {
  host.querySelectorAll('[data-icon]').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
  // 树果图标（data-src 静态 png，与农田面板一致）
  host.querySelectorAll('img[data-src]').forEach(im => tryLoadImage(im, im.dataset.src));
}

// 配对预览：两只都放入后展示双方个体值（第一行一左一右）与后代名字/个体值（第二行）。
// 不展示"能否繁殖"判定——放入列表已按共同蛋组过滤，能选到的必定可繁殖。
function pairStatusHtml(n) {
  const [a, b] = n.parents;
  if (!a && !b) return `<div class="nursery-pair-status idle">放入两只宝可梦后，这里会显示配对预览</div>`;
  if (!a || !b) return `<div class="nursery-pair-status idle">再放入一只宝可梦，这里会显示配对预览</div>`;
  const ea = (gameData.roster || []).find(x => x.id === a.id);
  const eb = (gameData.roster || []).find(x => x.id === b.id);
  if (!ea || !eb || ea.inRoster === false || eb.inRoster === false) {
    return `<div class="nursery-pair-status idle">宝可梦已不在仓库，请重新放入</div>`;
  }
  const r = checkPairing(ea, eb);
  // 防御分支：放入列表已过滤，正常不会走到这里
  if (!r.ok) return `<div class="nursery-pair-status idle">${r.reason}</div>`;
  const child = getPokemonByIndex(String(r.childSpecies));
  const childName = child ? child.name : `#${r.childSpecies}`;
  const locked = n.lockedIv || null;
  const preview = previewChildIvs(ea, eb, locked);
  // 繁殖开始后（繁殖中）锁定区隐藏：锁定项已随本轮繁殖固定，不能再改；
  // 完成/空闲后恢复显示（新一批可重新选择锁定）
  const st = breedingState(n);
  const lockHidden = st.key === 'running';
  // 锁定遗传维度按钮（点击已选中的项取消，回到随机继承原版逻辑）
  const lockBtns = [['hp', 'HP'], ['atk', '物攻'], ['def', '物防'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速度']]
    .map(([k, label]) =>
      // 选中且已选定来源才高亮（未选来源 = 尚未完成锁定）
      `<button class="nursery-pair-lock-btn${locked && locked.source && locked.key === k ? ' on' : ''}" data-lock="${k}">${label}</button>`
    ).join('');
  // 锁定后选择来源亲本：固定继承该亲本数值（贴合原版"力量负重"设定，锁定位不再 50% 二选一）
  // 角色：母方/父方由 pairRole 统一判定——正常配对=雌母雄父；百变怪配对=非百变怪按自身性别，百变怪充当相反角色
  const parentLabel = sid => {
    const idx = sid === 'b' ? 1 : 0;
    const slot = n.parents[idx];
    const entry = slot && (gameData.roster || []).find(x => x.id === slot.id);
    if (!entry) return sid === 'a' ? '槽A' : '槽B';
    const poke = getPokemonByIndex(String(entry.species));
    const name = poke ? poke.name : `#${entry.species}`;
    const role = pairRole(ea, eb, sid);
    return `${role === 'mother' ? '母方' : '父方'}·${name}`;
  };
  const srcHtml = locked ? `
    <div class="nursery-pair-lock-srcs">
      <span class="nursery-pair-lock-src-label">继承自</span>
      <button class="nursery-pair-lock-src${locked.source === 'a' ? ' on' : ''}" data-lock-src="a">${parentLabel('a')}</button>
      <button class="nursery-pair-lock-src${locked.source === 'b' ? ' on' : ''}" data-lock-src="b">${parentLabel('b')}</button>
    </div>` : '';
  const lockHtml = `
    <div class="nursery-pair-lock">
      <div class="nursery-pair-lock-label">锁定遗传个体</div>
      <div class="nursery-pair-lock-btns">${lockBtns}</div>
      ${srcHtml}
    </div>`;
  return `
    ${lockHidden ? '' : lockHtml}
    <div class="nursery-pair-result">
      <div class="nursery-pair-ivs">
        <span class="nursery-pair-iv left">${ivSlash(ea.ivs)}</span>
        <span class="nursery-pair-iv right">${ivSlash(eb.ivs)}</span>
      </div>
      <div class="nursery-pair-child">
        <span class="nursery-pair-child-name">后代：${childName}</span>
      </div>
      <div class="nursery-pair-preview">${previewIvCells(preview)}</div>
    </div>
    ${breedAreaHtml(n, ea, eb, r)}`;
}

// 六维个体值斜杠串：31/31/31/31/31/31（HP/攻击/防御/特攻/特防/速度）
function ivSlash(ivs) {
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
    .map(k => (ivs && ivs[k]) != null ? ivs[k] : 0)
    .join('/');
}

// 后代个体值预览（同一配对结果稳定，仅展示用）：按遗传规则——6 项中 5 项继承双亲、
// 1 项随机。锁定位固定继承所选亲本（定值），其余随机遗传位二选一、纯随机位 0~31。
// 用双亲 id 做种子仅决定「纯随机位是哪一项」，实际孵化以产蛋/孵化为准。
// 返回 { lockVal, lockKey, randomKeys, ea, eb } 供区间化展示。
function previewChildIvs(ea, eb, lockedIv) {
  const keys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  let seed = 2166136261;
  const str = (ea.id || '') + ':' + (eb.id || '');
  for (let i = 0; i < str.length; i++) {
    seed = ((seed ^ str.charCodeAt(i)) * 16777619) >>> 0;
  }
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const inherits = new Set();
  const lockVal = {}; // 锁定位定值
  // 来源未选（source 为空）不算锁定，该维仍按随机遗传位处理
  const lockKey = lockedIv && lockedIv.key && lockedIv.source && keys.includes(lockedIv.key) ? lockedIv.key : null;
  if (lockKey) {
    inherits.add(keys.indexOf(lockKey));
    const from = lockedIv.source === 'b' ? eb : ea;
    lockVal[lockKey] = from.ivs && from.ivs[lockKey] != null ? from.ivs[lockKey] : 0;
  }
  // 剩余继承名额（锁定 1 项则再随机继承 4 项；不锁定则随机继承 5 项）
  while (inherits.size < 5) inherits.add(Math.floor(rnd() * keys.length));
  // 未继承项 = 纯随机位（恰好 1 个）
  const randomKeys = keys.filter((_, i) => !inherits.has(i));
  return { lockVal, lockKey, randomKeys, ea, eb };
}

// 预览区间格：锁定位显示定值（标注锁定），随机遗传位显示 min~max，纯随机位显示 0~31
function previewIvCells(p) {
  const dims = { hp: 'HP', atk: '物攻', def: '物防', spa: '特攻', spd: '特防', spe: '速度' };
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => {
    let range, cls = '';
    if (p.lockKey === k) {
      range = String(p.lockVal[k]); // 锁定位：定值，仅加粗区分
      cls = ' locked';
    } else if (p.randomKeys.includes(k)) {
      range = '0~31'; // 纯随机位：完全随机
    } else {
      const va = p.ea.ivs && p.ea.ivs[k] != null ? p.ea.ivs[k] : 0;
      const vb = p.eb.ivs && p.eb.ivs[k] != null ? p.eb.ivs[k] : 0;
      range = `${Math.min(va, vb)}~${Math.max(va, vb)}`; // 随机遗传位：二选一 → 双亲范围
    }
    return `<div class="npv-cell"><span class="npv-dim">${dims[k]}</span><span class="npv-range${cls}">${range}</span></div>`;
  }).join('');
}

// ---------- M2 投喂与产蛋 ----------
// 繁殖状态机：breeding 为 null 未繁殖；否则按时间判定 繁殖中 / 全部完成。
// 多轮批次：roundsDone 为已自动入库的蛋数，当前轮剩余 = startedAt + (roundsDone+1)*durMs - now
function breedingState(n) {
  if (!n.breeding) return { key: 'idle' };
  const b = n.breeding;
  if (b.roundsDone >= b.roundsTotal) return { key: 'done', roundsTotal: b.roundsTotal, roundsDone: b.roundsDone };
  const remain = b.startedAt + (b.roundsDone + 1) * b.durMs - Date.now();
  return { key: 'running', remain: Math.max(0, remain), total: b.durMs, roundsDone: b.roundsDone, roundsLeft: b.roundsTotal - b.roundsDone, roundsTotal: b.roundsTotal };
}

// 本轮所需树果（§4.5）：双方喜欢列表有交集 → 投 1 颗共同喜欢 ×2；
// 无交集 → 各投 1 颗（自动按库存选取，优先有库存的，否则取列表第一个）
function berryDemand(ea, eb) {
  const pa = getPokemonByIndex(String(ea.species));
  const pb = getPokemonByIndex(String(eb.species));
  const fa = (pa && Array.isArray(pa.foods) && pa.foods.length) ? pa.foods : [0];
  const fb = (pb && Array.isArray(pb.foods) && pb.foods.length) ? pb.foods : [0];
  const stock = ensureBerryFarm().stock || {};
  const shared = fa.filter(t => fb.includes(t));
  if (shared.length) {
    // 有交集：每轮固定投 2 颗双方都喜欢的树果。优先同种凑满 2 颗（按库存从多到少选）；
    // 库存不足 2 颗时改为两种共同喜欢各投 1 颗（仍凑满 2 颗）；
    // 只有一种共同喜欢且库存不足 2 颗时，仍按 2 颗要求（不足则提示缺货），
    // 避免出现"本轮只需 1 颗"的异常需求
    const cand = shared.slice().sort((x, y) => (stock[y] || 0) - (stock[x] || 0));
    const top = cand[0];
    if ((stock[top] || 0) >= 2) return [{ type: top, qty: 2 }];
    if (cand[1] != null) return [{ type: top, qty: 1 }, { type: cand[1], qty: 1 }];
    return [{ type: top, qty: 2 }];
  }
  const pick = list => list.find(t => (stock[t] || 0) > 0) ?? list[0];
  const a = pick(fa), b = pick(fb);
  const items = [{ type: a, qty: 1 }];
  if (b !== a) items.push({ type: b, qty: 1 });
  return items;
}

// 繁殖区：繁殖中 → 进度条（第 X/N 轮）；未繁殖 / 全部完成 → 轮数选择 + 多轮树果需求 + 投喂按钮，
// 一批完成后直接恢复默认界面，可立即开始下一批（蛋已自动入库，无需手动收取）
function breedAreaHtml(n, ea, eb, r) {
  const st = breedingState(n);
  const child = getPokemonByIndex(String(r.childSpecies));
  const childName = child ? child.name : `#${r.childSpecies}`;
  if (st.key === 'running') {
    const pct = Math.max(0, Math.min(100, (1 - st.remain / st.total) * 100));
    const sec = Math.ceil(st.remain / 1000);
    const mm = Math.floor(sec / 60), ss = sec % 60;
    return `
    <div class="nursery-breed">
      <div class="nursery-breed-bar"><div class="nursery-breed-fill" id="nurseryBreedFill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="nursery-breed-meta">
        <span>第 ${st.roundsDone + 1}/${st.roundsTotal} 轮 繁殖中…</span>
        <span id="nurseryBreedRemain">剩余 ${mm}:${String(ss).padStart(2, '0')}</span>
      </div>
      <div class="nursery-breed-note">已产 ${st.roundsDone} 枚蛋自动入库，取出亲本终止剩余轮次（树果不退）</div>
    </div>`;
  }
  if (st.key === 'done') {
    // 一批全部完成：不单独展示完成态，直接恢复默认的轮数选择 + 树果需求界面，可立即开始下一批
  }
  const demand = berryDemand(ea, eb);
  const rounds = Math.max(1, Math.min(MAX_BREED_ROUNDS, _breedRounds));
  const stock = ensureBerryFarm().stock || {};
  const lack = demand.filter(({ type, qty }) => (stock[type] || 0) < qty * rounds);
  const itemsHtml = demand.map(({ type, qty }) => {
    const have = stock[type] || 0;
    const name = BERRY_NAMES[BERRY_ICONS[type]] || '树果';
    return `<span class="nursery-breed-item${have < qty * rounds ? ' lack' : ''}" data-tip="${name}（库存 ${have}）">
      <img class="berry-icon" data-src="${BERRY_DIR}${BERRY_ICONS[type]}" alt="">
      <span>×${qty * rounds}</span>
    </span>`;
  }).join('');
  const canStart = !lack.length;
  const lastTip = n.lastEggAt
    ? '<div class="nursery-breed-note">上一批蛋已自动入库，提交后可开始下一批</div>'
    : '';
  return `
    <div class="nursery-breed">
      <div class="nursery-breed-rounds">
        <span class="nursery-breed-demand-label">连续繁殖轮数</span>
        <button class="nursery-round-btn" data-round-minus type="button">−</button>
        <span class="nursery-round-num">${rounds}</span>
        <button class="nursery-round-btn" data-round-plus type="button">＋</button>
      </div>
      <div class="nursery-breed-demand">
        <span class="nursery-breed-demand-label">共需</span>
        ${itemsHtml}
      </div>
      <button class="nursery-breed-btn${canStart ? '' : ' locked'}" data-start-breed${canStart ? '' : ' disabled'}>
        ${canStart ? `投喂并连续繁殖 ${rounds} 轮` : '库存不足'}
      </button>
      ${lastTip}
    </div>`;
}

// 「投喂并开始繁殖」：扣除 N 轮所需树果 → 进入连续产蛋计时（每轮 5~10 分钟真实时间）。
// 繁殖中不可重复开启；上一批全部完成后（done）可覆盖开始新一批
function startBreeding() {
  const n = ensureNursery();
  if (breedingState(n).key === 'running') return;
  const [a, b] = n.parents;
  const ea = (gameData.roster || []).find(x => x.id === a.id);
  const eb = (gameData.roster || []).find(x => x.id === b.id);
  if (!ea || !eb || ea.inRoster === false || eb.inRoster === false) return;
  const r = checkPairing(ea, eb);
  if (!r.ok) return;
  const demand = berryDemand(ea, eb);
  const rounds = Math.max(1, Math.min(MAX_BREED_ROUNDS, _breedRounds));
  const stock = ensureBerryFarm().stock || {};
  if (demand.some(({ type, qty }) => (stock[type] || 0) < qty * rounds)) return; // 库存不足（按钮已置灰）
  for (const { type, qty } of demand) {
    stock[type] = (stock[type] || 0) - qty * rounds;
    if (stock[type] <= 0) delete stock[type];
  }
  n.breeding = { startedAt: Date.now(), durMs: randInt(BREED_MIN_MIN, BREED_MAX_MIN) * 60 * 1000, roundsTotal: rounds, roundsDone: 0, reportedRounds: 0 };
  addSystemLog('nursery_breed_start', { a: ea.species, b: eb.species, rounds });
  saveGame();
  refreshBoard();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('roster-changed'));
}

// 结算已完成轮次：每完成一轮自动生成蛋入库存并继续下一轮，直至全部完成。
// 用真实时间戳结算，离开页面/离线期间产出的蛋在进入页面时一次性补齐。
// 返回本次结算产出的蛋数（供进入饲育屋页面时弹出提示）。
function settleBreeding() {
  const n = ensureNursery();
  const b = n.breeding;
  if (!b) return 0;
  const target = Math.min(b.roundsTotal, b.roundsDone + Math.floor((Date.now() - b.startedAt) / b.durMs));
  let produced = 0;
  while (b.roundsDone < target) {
    const [a, c] = n.parents;
    const ea = a && (gameData.roster || []).find(x => x.id === a.id);
    const eb = c && (gameData.roster || []).find(x => x.id === c.id);
    // 亲本缺失/配对失效：终止剩余轮次（已产蛋已入库，无丢失）
    if (!ea || !eb || ea.inRoster === false || eb.inRoster === false) { n.breeding = null; break; }
    const r = checkPairing(ea, eb);
    if (!r.ok) { n.breeding = null; break; }
    const entry = createEggEntry(ea, eb, r.childSpecies, n.lockedIv || null);
    if (!Array.isArray(gameData.roster)) gameData.roster = [];
    gameData.roster.push(entry);
    n.lastEggAt = Date.now();
    gameData.stats.totalEggsProduced = (gameData.stats.totalEggsProduced || 0) + 1; // 育种成就统计
    addSystemLog('nursery_egg', { pokemon: r.childSpecies, shiny: entry.shiny });
    b.roundsDone++;
    produced++;
  }
  if (produced) {
    saveGame();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('roster-changed'));
  }
  return produced;
}

// 重新访问饲育屋时：离开期间有蛋孵化 → 底部弹窗提示（单「确定」按钮）
function notifyNewEggs(produced) {
  const n = ensureNursery();
  const nameOf = slot => {
    if (!slot) return '宝可梦';
    const entry = (gameData.roster || []).find(x => x.id === slot.id);
    const poke = entry ? getPokemonByIndex(String(entry.species)) : null;
    return (entry && entry.nickname) || (poke ? poke.name : '宝可梦');
  };
  const msg = `${nameOf(n.parents[0])}和${nameOf(n.parents[1])}孵了 ${produced} 个蛋！已自动放入仓库`;
  showConfirmBar(msg, null, null, { singleButton: true });
}

// 生成蛋条目：个体值 6 项中 5 项继承双亲、1 项随机。锁定位固定继承所选亲本（source）的
// 数值（占 1 个继承名额），其余随机遗传位 50% 取父/母；性别/性格/闪光出生即定，孵化后完全沿用
function createEggEntry(ea, eb, childSpecies, lockedIv) {
  const keys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const inherits = new Set();
  const ivs = {};
  // 来源未选（source 为空）不算锁定，该维仍按随机遗传处理
  if (lockedIv && lockedIv.key && lockedIv.source && keys.includes(lockedIv.key)) {
    inherits.add(keys.indexOf(lockedIv.key));
    const from = lockedIv.source === 'b' ? eb : ea;
    ivs[lockedIv.key] = from.ivs && from.ivs[lockedIv.key] != null ? from.ivs[lockedIv.key] : 0;
  }
  while (inherits.size < 5) inherits.add(Math.floor(Math.random() * keys.length));
  // 记录纯随机位：6 项中唯一不继承亲本的项，是孵蛋时唯一的个体值运气（欧气评分用它加分）
  const ivRandomKey = keys.filter((_, i) => !inherits.has(i))[0] || null;
  keys.forEach((k, i) => {
    if (ivs[k] != null) return;
    if (inherits.has(i)) {
      const from = Math.random() < 0.5 ? ea : eb;
      ivs[k] = from.ivs && from.ivs[k] != null ? from.ivs[k] : 0;
    } else {
      ivs[k] = Math.floor(Math.random() * 32);
    }
  });
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    kind: 'egg', // 蛋条目：孵化后原地转正为宝可梦
    species: childSpecies,
    gender: rollGender(String(childSpecies)),
    level: 1,
    exp: 0,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs,
    ivRandomKey, // 纯随机个体值项（欧气评分只按该项加分）
    nature: rollNature(),
    shiny: Math.random() < EGG_SHINY_CHANCE,
    source: 'egg',
    obtainedAt: Date.now(),
    inRoster: true,
  };
}

// 每秒驱动繁殖进度（仅繁殖中且面板打开时更新进度条；时间判定用真实时间戳，离开页面也不丢进度）
let _lastBreedKey = 'idle'; // 繁殖状态变化标记：状态切换时刷新一次面板，避免每秒重建
function tickBreeding() {
  const n = ensureNursery();
  const before = n.breeding?.roundsDone ?? 0;
  // 结算已完成轮次（页面内每轮完成自动产蛋入库并推进下一轮）
  settleBreeding();
  const key = !n.breeding ? 'idle' : breedingState(n).key;
  // 状态切换（running→done / 异常终止）或完成新一轮 → 刷新配对面板（更新"第 X/N 轮"）
  if (key !== _lastBreedKey || before !== (n.breeding?.roundsDone ?? 0)) {
    _lastBreedKey = key;
    refreshBoard();
    return;
  }
  if (key !== 'running') return;
  const fill = $('nurseryBreedFill');
  const remain = $('nurseryBreedRemain');
  if (!fill || !remain) return;
  const st = breedingState(n);
  const pct = Math.max(0, Math.min(100, (1 - st.remain / st.total) * 100));
  fill.style.width = pct.toFixed(1) + '%';
  const sec = Math.ceil(st.remain / 1000);
  const mm = Math.floor(sec / 60), ss = sec % 60;
  remain.textContent = `剩余 ${mm}:${String(ss).padStart(2, '0')}`;
}

function bindSlots(host) {
  host.querySelectorAll('.nursery-slot[data-slot]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation(); // 防止格子被 refreshBoard 替换后冒泡，误触"点击外部关闭面板"
      const n = ensureNursery();
      const i = Number(el.dataset.slot);
      if (n.parents[i]) {
        // 二次确认仅限繁殖中取出（会终止剩余轮次）：未开始/已完成直接取出，繁殖中需双击确认
        if (breedingState(n).key !== 'running') {
          _confirmTakeSlot = -1;
          removeParent(i);
          return;
        }
        // 双击取出：第一次点击进入待确认态（上方文字提示），再次点击同槽才真正取出
        if (_confirmTakeSlot === i) {
          _confirmTakeSlot = -1;
          removeParent(i);
        } else {
          _confirmTakeSlot = i;
          refreshBoard();
        }
      } else {
        // 关闭面板，切到全页"放入宝可梦"列表
        closeBoard();
        _pickSlot = i;
        render();
      }
    });
  });
  // 锁定遗传维度：点击已选中的项取消（回随机继承）；否则锁定该项，来源默认选中母方（可切换）
  host.querySelectorAll('.nursery-pair-lock-btn[data-lock]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = ensureNursery();
      const v = btn.dataset.lock;
      if (n.lockedIv && n.lockedIv.key === v) {
        n.lockedIv = null;
      } else {
        // 默认来源：母方（与 pairRole 角色判定一致）——正常配对=雌性，百变怪配对按性别/角色判定
        const [a, b] = n.parents;
        const ea = a && (gameData.roster || []).find(x => x.id === a.id);
        const eb = b && (gameData.roster || []).find(x => x.id === b.id);
        const r = ea && eb ? checkPairing(ea, eb) : null;
        let src = 'a';
        if (r && r.ok) {
          src = pairRole(ea, eb, 'a') === 'mother' ? 'a' : 'b';
        }
        n.lockedIv = { key: v, source: src };
      }
      saveGame();
      refreshBoard(); // 刷新后代预览与来源选择行
    });
  });
  // 锁定位来源切换：固定继承所选亲本的该项数值
  host.querySelectorAll('[data-lock-src]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = ensureNursery();
      if (!n.lockedIv) return;
      n.lockedIv.source = btn.dataset.lockSrc;
      saveGame();
      refreshBoard();
    });
  });
  // 连续繁殖轮数增减（仅未繁殖/已完成时展示的按钮）
  host.querySelectorAll('[data-round-minus]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_breedRounds > 1) { _breedRounds--; refreshBoard(); }
    });
  });
  host.querySelectorAll('[data-round-plus]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_breedRounds < MAX_BREED_ROUNDS) { _breedRounds++; refreshBoard(); }
    });
  });
  // 「投喂并开始繁殖」
  host.querySelectorAll('[data-start-breed]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      startBreeding();
    });
  });
}

// "放入宝可梦"全页列表交互：行内按钮放入该槽；点击行跳转个体详情（返回后恢复列表）
function bindPick(root) {
  if (_pickSlot == null) return;
  bindPickPersistent(root); // 搜索 / 表头排序：页面级持久监听，仅 render() 重建时绑定
}

// 页面级持久监听（搜索 / 表头排序）：仅在 render() 重建页面时绑定一次，
// 不要放进 refreshPickList，否则同一持久 DOM 会累积监听导致多次触发/卡死
function bindPickPersistent(root) {
  // 搜索输入：实时过滤列表，不清空排序状态
  const searchInput = root.querySelector('#nurseryPickSearch');
  const searchClear = root.querySelector('#nurseryPickSearchClear');
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
  root.querySelectorAll('.nursery-pick-header [data-sort]').forEach(el => {
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
  const header = root.querySelector('.nursery-pick-header');
  if (!header) return;
  header.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
  const cur = _pickSortBy ? header.querySelector(`[data-sort="${_pickSortBy}"]`) : null;
  if (cur) cur.classList.add(_pickSortDir === 1 ? 'sort-asc' : 'sort-desc');
}

// 弹框保持打开时局部刷新内容（不重建弹层，避免闪烁/关闭）
function refreshBoard() {
  const host = $('nurseryBoardHost');
  if (!host || host.style.display === 'none') return;
  const n = ensureNursery();
  const wrap = host.querySelector('.berry-board-sections');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="nursery-pair-row">${slotHtml(n.parents[0], 0)}<span class="nursery-pair-plus">＋</span>${slotHtml(n.parents[1], 1)}</div>
    ${pairStatusHtml(n)}`;
  loadSlotIcons(wrap);
  bindSlots(host);
}

// 每秒驱动亲本走动（页面隐藏时自动停止，避免常驻定时器）
function startTimer() {
  setupFoodTooltip();
  if (_timer) return;
  _timer = setInterval(() => {
    if ($('nurseryView')?.style.display === 'none') { clearInterval(_timer); _timer = null; return; }
    syncWalkers();
    walkerTick();
    tickBreeding();
  }, 1000);
}

// ---------- 蛋仓库 ----------
function openEggView() {
  _eggView = true;
  _eggQuery = '';
  const content = $('nurseryContent');
  if (content) { content.style.display = 'flex'; content.style.flexDirection = 'column'; }
  const title = $('appTitle');
  if (title) {
    title.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 宝可梦蛋';
    title.dataset.action = 'back';
  }
  renderEggView();
}

function discardEgg(id) {
  showConfirmBar(
    '确定丢弃这枚蛋吗？',
    () => { // 确定
      const arr = gameData.roster || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id === id && !isPokemon(arr[i])) {
          arr.splice(i, 1);
          saveGame();
          renderEggView();
          return;
        }
      }
    },
    null // 取消
  );
}

function removeEggConfirmBar() {
  hideConfirmBar();
}

function renderEggView() {
  const box = $('nurseryContent');
  if (!box) return;
  const eggs = (gameData.roster || []).filter(p => p.inRoster && !isPokemon(p));
  // 搜索过滤
  let filtered = eggs;
  if (_eggQuery) {
    const q = _eggQuery;
    filtered = eggs.filter(p => {
      const poke = getPokemonByIndex(String(p.species));
      if (!poke) return false;
      return poke.name.includes(q) || poke.pinyin?.toUpperCase().includes(q.toUpperCase()) ||
        poke.pinyinInitials?.toUpperCase().includes(q.toUpperCase());
    });
  }
  // 排序
  const sorted = [...filtered].sort((a, b) => {
    let va, vb;
    if (_eggSortBy === 'name') {
      va = getPokemonByIndex(String(a.species))?.name || '';
      vb = getPokemonByIndex(String(b.species))?.name || '';
      return va.localeCompare(vb) * _eggSortDir;
    } else if (_eggSortBy === 'iv') {
      va = (a.ivs ? (a.ivs.hp + a.ivs.atk + a.ivs.def + a.ivs.spa + a.ivs.spd + a.ivs.spe) : 0);
      vb = (b.ivs ? (b.ivs.hp + b.ivs.atk + b.ivs.def + b.ivs.spa + b.ivs.spd + b.ivs.spe) : 0);
      return (va - vb) * _eggSortDir;
    }
    // time: newest first by default
    va = a.obtainedAt || 0; vb = b.obtainedAt || 0;
    return (va - vb) * _eggSortDir;
  });
  // 蛋是否在孵化中（孵蛋器槽位 eggRef 指向该蛋）
  function isIncubating(id) {
    return (gameData.incubators || []).some(s => s && s.eggRef === id);
  }
  // 蛋行丢弃按钮：孵化中显示「孵化中」并禁用
  function eggDiscardCell(eg) {
    return isIncubating(eg.id)
      ? '<span class="bounty-trade-btn-col"><button class="bounty-trade-btn" disabled>孵化中</button></span>'
      : `<span class="bounty-trade-btn-col"><button class="bounty-trade-btn" data-discard="${eg.id}">丢弃</button></span>`;
  }

  // 检查是否已有完整页面，有则只增量更新列表和表头（避免销毁搜索框导致失焦）
  const existingPage = box.querySelector('.nursery-egg-page');
  if (existingPage) {
    // 更新进度
    const progress = existingPage.querySelector('.pokedex-progress');
    if (progress) progress.textContent = eggs.length ? `共 ${eggs.length} 个蛋` : '暂无宝可梦蛋';
    // 更新表头排序标记
    existingPage.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
    const cur = existingPage.querySelector(`[data-sort="${_eggSortBy}"]`);
    if (cur) cur.classList.add(_eggSortDir === 1 ? 'sort-asc' : 'sort-desc');
    // 更新列表
    const listScroll = existingPage.querySelector('.list-scroll');
    if (listScroll) {
      listScroll.innerHTML = sorted.length === 0
        ? '<div class="roster-empty">暂无宝可梦蛋</div>'
        : sorted.map(eg => {
            const poke = getPokemonByIndex(String(eg.species));
            const name = poke ? poke.name : `#${eg.species}`;
            return `
              <div class="pokedex-entry roster-row nursery-egg-row" data-egg-id="${eg.id}">
                <span class="pokedex-name"><img class="roster-icon-img" src="./items/mystery-egg.png" alt="蛋" style="width:18px;height:18px;" />${name}的蛋${eg.shiny ? ' ★' : ''}</span>
                <span class="roster-iv">${eggIvSlash(eg)}</span>
                ${eggDiscardCell(eg)}
              </div>`;
          }).join('');
      // 重新绑定丢弃按钮
      listScroll.querySelectorAll('[data-discard]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          discardEgg(btn.dataset.discard);
        });
      });
    }
    // 更新清空按钮可见性
    const clearBtn = existingPage.querySelector('#nurseryEggSearchClear');
    if (clearBtn) clearBtn.style.display = _eggQuery ? '' : 'none';
    return;
  }

  // 首次渲染：创建完整 HTML
  box.innerHTML = `
    <div class="nursery-egg-page view-list">
      <div class="pokedex-progress">${eggs.length ? `共 ${eggs.length} 个蛋` : '暂无宝可梦蛋'}</div>
      <div class="pokedex-search">
        <div class="pokedex-search-row">
          <div class="pokedex-search-input-wrap">
            <input id="nurseryEggSearch" class="pokedex-search-input" type="text" placeholder="名称/拼音/首字母" autocomplete="off" value="${_eggQuery}" />
            <button class="pokedex-search-clear" id="nurseryEggSearchClear" style="display:${_eggQuery ? '' : 'none'};" aria-label="清空搜索">
              <svg><use xlink:href="#icon-close" /></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="pokedex-header roster-header nursery-egg-header">
        <span class="pokedex-name" data-sort="name">宝可梦蛋</span>
        <span class="roster-iv" data-sort="iv">个体值</span>
        <span class="bounty-trade-btn-col">丢弃</span>
      </div>
      <div class="list-scroll">
        ${sorted.length === 0
          ? '<div class="roster-empty">暂无宝可梦蛋</div>'
          : sorted.map(eg => {
              const poke = getPokemonByIndex(String(eg.species));
              const name = poke ? poke.name : `#${eg.species}`;
              return `
                <div class="pokedex-entry roster-row nursery-egg-row" data-egg-id="${eg.id}">
                  <span class="pokedex-name"><img class="roster-icon-img" src="./items/mystery-egg.png" alt="蛋" style="width:18px;height:18px;" />${name}的蛋${eg.shiny ? ' ★' : ''}</span>
                  <span class="roster-iv">${eggIvSlash(eg)}</span>
                  ${eggDiscardCell(eg)}
                </div>`;
            }).join('')}
      </div>
    </div>`;
  // 搜索（只绑一次——新创建的 input）
  const input = box.querySelector('#nurseryEggSearch');
  const clearBtn = box.querySelector('#nurseryEggSearchClear');
  if (input) {
    input.addEventListener('input', () => {
      _eggQuery = input.value.trim();
      renderEggView();
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', () => { _eggQuery = ''; input.value = ''; renderEggView(); });
  // 排序（3 段 toggle：升序 → 降序 → 回到默认时间降序）
  box.querySelectorAll('.nursery-egg-header [data-sort]').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.sort;
      if (_eggSortBy === k) {
        if (_eggSortDir === 1) _eggSortDir = -1;
        else { _eggSortBy = null; _eggSortDir = -1; }
      } else { _eggSortBy = k; _eggSortDir = 1; }
      renderEggView();
    });
  });
  // 标记当前排序列
  const eggHeader = box.querySelector('.nursery-egg-header');
  if (eggHeader) {
    const cur = eggHeader.querySelector(`[data-sort="${_eggSortBy}"]`);
    if (cur) cur.classList.add(_eggSortDir === 1 ? 'sort-asc' : 'sort-desc');
  }
  // 丢弃
  box.querySelectorAll('[data-discard]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      discardEgg(btn.dataset.discard);
    });
  });
}

// 蛋个体值斜杠串（与孵蛋器选蛋页一致）
function eggIvSlash(p) {
  if (!p || !p.ivs) return '0/0/0/0/0/0';
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => p.ivs[k] || 0).join('/');
}

// 标题栏返回判断：是否在蛋仓库视图
export function isNurseryEggView() {
  return _eggView && $('nurseryView')?.style.display !== 'none';
}

// 标题栏返回：退出蛋仓库，回饲育屋场地
export function leaveNurseryEggView() {
  _eggView = false;
  removeEggConfirmBar();
  const content = $('nurseryContent');
  if (content) { content.style.display = ''; content.style.flexDirection = ''; }
  const title = $('appTitle');
  if (title) {
    title.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 饲育屋';
    title.dataset.action = 'back';
  }
  render();
  startTimer();
}

// ---------- 调试辅助 ----------
// 直接完成当前繁殖批次：跳过投喂树果消耗与等待计时，立即产完本批所有蛋（自动入库）。
// 控制台执行 window.__finishBreeding()。
window.__finishBreeding = function () {
  const n = ensureNursery();
  if (!n || !n.breeding) {
    console.log('[调试] 当前没有进行中的繁殖（需先投喂开始繁殖）');
    return false;
  }
  n.breeding.startedAt = Date.now() - (n.breeding.durMs || 1) * n.breeding.roundsTotal - 1;
  const produced = settleBreeding();
  saveGame();
  render();
  console.log(`[调试] 已直接完成当前繁殖，${produced} 枚蛋已自动入库`);
  return true;
};

// 调试：直接添加宝可梦蛋到仓库（6V 个体值）
// 参数 speciesIndex 为图鉴编号，默认为 1（妙蛙种子）
// 用法：__addEgg(25)  → 获得一只皮卡丘的蛋
//       __addEgg()    → 获得一只妙蛙种子的蛋
window.__addEgg = function (speciesIndex) {
  const species = String(speciesIndex || 1).padStart(4, '0');
  const poke = getPokemonByIndex(species);
  if (!poke) { console.log('[调试] 无效的图鉴编号:', species); return false; }
  if (!Array.isArray(gameData.roster)) gameData.roster = [];
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    kind: 'egg',
    species,
    gender: rollGender(species),
    level: 1,
    exp: 0,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs,
    nature: rollNature(),
    shiny: false,
    source: 'egg',
    obtainedAt: Date.now(),
    inRoster: true,
  };
  gameData.roster.push(entry);
  saveGame();
  if (_eggView) renderEggView();
  console.log(`[调试] 已添加 ${poke.name} 的蛋（6V），可在「饲育屋→纸箱」或「孵蛋器→宝可梦蛋」中查看`);
  return true;
};
