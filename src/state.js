// ===== 游戏状态 + 存档管理 =====
import { REGION_CYCLE, HATCH_DIST_MIN, HATCH_DIST_MAX, HATCH_DIST_SIGMA, ROAD_SPEED_WALK, START_CANDY, BIKE_RESTORE_MAX_GAP_MS } from './config.js';

// ---------- 游戏数据 ----------
export let allPokemon = [];

// 宝可梦编号 → 数据对象 索引
let _pokemonMap = null;
export function getPokemonByIndex(idx) {
  if (!_pokemonMap) {
    _pokemonMap = new Map();
    for (const p of allPokemon) _pokemonMap.set(String(p.index), p);
  }
  return _pokemonMap.get(String(idx)) || null;
}
export function setAllPokemon(a) { allPokemon = a; _pokemonMap = null; }

export let gameData = null;
export let phase = 'idle'; // idle | encounter | caught | fled | eggResult
export let currentEncounter = null;
export let currentIsShiny = false;
export let encounterLevel = 1; // 当前野生遇敌的等级（1~20，遇敌时随机生成）
export let encounterBallsUsed = 0;
export let currentEncounterBalls = {};
export let nextEncounterTimer = null;
export let gameTick = 0;

// Buff 状态
export let honeyBuffActive = false;
export let honeyCountdownEnd = 0;
export let honeyCountdownInterval = null;
export let honeyPausedRemaining = 0;
export let honeyExpiryTimer = null;
export let charmBuffActive = false;
export let charmCountdownEnd = 0;
export let charmCountdownInterval = null;
export let charmPausedRemaining = 0;
export let charmExpiryTimer = null;
export let _charmEncounterCount = 0;

// 树果方块 Buff 状态（混合器产物）
export let blockBuffActive = false;
export let blockRecipe = [];          // 配方树果下标（升序、唯一；与宝可梦 foods 完全一致才会被吃掉）
export let blockStartWalk = 0;        // 方块摆放时的行走累计（px），走满 BLOCK_DISTANCE 米后过期
export let blockQuality = 'good';     // 方块品质（完美/优秀/良好/一般/劣质），决定命中目标概率
export let qteState = null;           // 树果混合 QTE 进行中状态快照（退出重连后接着进度玩，不给重置机会）

// UI 状态
export let _catchConfirmStep = false;
export let _prevView = 'idleView';
export let _pokedexInLogView = false;
export let _pokedexSortBy = 'index';
export let _pokedexSortDir = 1;

// 动画锁
export let _itemDropActive = false;
export let _throwing = false;
export let _autoCatching = false;
export let _eggHatching = false;
export let _fishing = false;

// 空闲消息
export let _idleMsgs = [];
export let _idleMsgIdx = 0;
export let _regionMsgInterval = 0;
export let _idleMsgTimer = null;
export let _idlePickupTimer = null;

// 佛系倒计时
export let _autoFleeTimer = null;
export let _autoFleeStartTime = 0;
export let _autoFleeBarInterval = null;

export let _lastRegionId = -1;
export let _prevBagCounts = {};

// ---------- Setter 函数（跨模块同步） ----------
export function setGameData(d) { gameData = d; }
export function setPhase(p) { phase = p; }
export function setCurrentEncounter(e) {
  currentEncounter = e;
  // 新遇敌生成野生等级；结束遇敌（null）时重置
  encounterLevel = e ? 1 + Math.floor(Math.random() * 20) : 1;
}
export function setEncounterLevel(lv) { encounterLevel = lv; }
export function setCurrentIsShiny(s) { currentIsShiny = s; }
export function setEncounterBallsUsed(n) { encounterBallsUsed = n; }
export function setCurrentEncounterBalls(b) { currentEncounterBalls = b; }
export function setGameTick(n) { gameTick = n; }
export function setPrevView(v) { _prevView = v; }

// 顶层页面导航栈：栈底为挂机页（不可弹出）。进入手机主页/各 App 页压栈，
// apptitle 返回弹栈回上一级，实现逐级返回；
// 悬赏/商店/设置同属一个平级组，互相跳转时替换栈顶而非叠加层级
export let _navStack = ['idleView'];
const PEER_VIEWS = ['bountyView', 'shopView', 'settingsView'];
export function pushNav(viewId) {
  if (!viewId) return;
  const top = _navStack[_navStack.length - 1];
  if (top === viewId) return; // 已在栈顶：不重复压栈
  if (PEER_VIEWS.includes(viewId) && PEER_VIEWS.includes(top)) {
    _navStack[_navStack.length - 1] = viewId; // 平级组内互跳：替换栈顶，不叠加层级
    return;
  }
  // 从平级组页面进入其它页面：先把平级组弹出，使其不残留返回路径（跳过悬赏/商店/设置）
  if (!PEER_VIEWS.includes(viewId) && PEER_VIEWS.includes(top)) {
    _navStack.pop();
  }
  _navStack.push(viewId);
}
export function popNav() {
  if (_navStack.length > 1) _navStack.pop();
  return _navStack[_navStack.length - 1];
}
export function resetNav() {
  _navStack = ['idleView'];
}
export function setLastRegionId(id) { _lastRegionId = id; }
export function setHoneyBuffActive(v) { honeyBuffActive = v; window.__honeyBuffActive__ = v; }
export function setHoneyCountdownEnd(t) { honeyCountdownEnd = t; }
export function setCharmBuffActive(v) { charmBuffActive = v; window.__charmBuffActive__ = v; }
export function setCharmCountdownEnd(t) { charmCountdownEnd = t; }
export function setHoneyPausedRemaining(v) { honeyPausedRemaining = v; }
export function setCharmPausedRemaining(v) { charmPausedRemaining = v; }
export function setCharmEncounterCount(n) { _charmEncounterCount = n; }
export function setIdleMsgIdx(n) { _idleMsgIdx = n; }
export function setIdleMsgs(a) { _idleMsgs = a; }
export function setRegionMsgInterval(n) { _regionMsgInterval = n; }
export function setIdleMsgTimer(t) { _idleMsgTimer = t; }
export function setIdlePickupTimer(t) { _idlePickupTimer = t; }
export function setAutoFleeTimer(t) { _autoFleeTimer = t; }
export function setAutoFleeStartTime(t) { _autoFleeStartTime = t; }
export function setAutoFleeBarInterval(i) { _autoFleeBarInterval = i; }
export function setNextEncounterTimer(t) { nextEncounterTimer = t; }
export function setAutoCatching(v) { _autoCatching = v; }
export function setThrowing(v) { _throwing = v; }
export function setCatchConfirmStep(v) { _catchConfirmStep = v; }
export function setItemDropActive(v) { _itemDropActive = v; }
export function setEggHatching(v) { _eggHatching = v; }
export function setFishing(v) { _fishing = v; }
export function setPokedexInLogView(v) { _pokedexInLogView = v; }
export function setPokedexSortBy(v) { _pokedexSortBy = v; }
export function setPokedexSortDir(v) { _pokedexSortDir = v; }
export function setHoneyExpiryTimer(t) { honeyExpiryTimer = t; }
export function setCharmExpiryTimer(t) { charmExpiryTimer = t; }
export function setHoneyCountdownInterval(i) { honeyCountdownInterval = i; }
export function setCharmCountdownInterval(i) { charmCountdownInterval = i; }
export function setBlockBuffActive(v) { blockBuffActive = v; window.__blockBuffActive__ = v; }
export function setBlockRecipe(a) { blockRecipe = a; }
export function setBlockStartWalk(v) { blockStartWalk = v; }
export function setBlockQuality(k) { blockQuality = k || 'good'; }
export function setQteState(s) { qteState = s || null; }

// ---------- 孵化里程计算 ----------
// 按体重/稀有度定分布峰值，截断正态采样（Box-Muller），落在配置区间内
export function calcHatchDistance(poke) {
  const w = Math.min((poke.weight || 100) / 5000, 1); // 重量 0~1
  const r = poke.rarity || 0.5;                       // 稀有度 0~1
  const factor = Math.min(w * 0.6 + r * 0.4, 1);      // 综合因子 0~1
  // 峰值：轻/常见 → 最短，重/稀有 → 最长
  const mid = HATCH_DIST_MIN * Math.pow(HATCH_DIST_MAX / HATCH_DIST_MIN, factor);
  const sigma = Math.max(20, mid * HATCH_DIST_SIGMA);
  let d = 0;
  do {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    d = mid + z * sigma;
  } while (d < HATCH_DIST_MIN || d > HATCH_DIST_MAX);
  return Math.round(d);
}

// 空孵蛋器
// eggRef：宝可梦蛋（饲育屋产）对应的仓库条目 id；null = 神秘蛋（无对应条目，孵化时随机建档）
export function emptyIncubator() {
  return { eggIndex: null, eggRef: null, hatchStart: 0, hatchDuration: 0, hatched: false, isShiny: false };
}

// 孵蛋器解锁糖果价格（槽位 0~7，全部需购买，价格递增）
export function getIncubatorUnlockCost(slotIndex) {
  const costs = [100, 200, 400, 800, 1600, 3200, 6400, 12800];
  return costs[slotIndex] ?? 0;
}

// 是否有任一孵蛋器已孵化
export function anyIncubatorReady() {
  if (!gameData) return false;
  return (gameData.incubators || []).some(s => s && s.hatched);
}

// ---------- GPS 导航状态 ----------
// 当前地区由 GPS 位置决定（默认从丰缘出发）；开启"漫游"后才会有目的地并随行走推进。
export function defaultGpsState() {
  return {
    roamEnabled: true,               // 漫游开关：开局默认开启，自动沿环国路线前进
    curIdx: 2,                      // 当前地区编号（REGION_CYCLE 下标，2=丰缘）
    destIdx: null,                  // 目的地地区编号；null=无目的地
    path: null,                     // 最短路线（地区编号数组）
    seg: 0,                         // 当前路段下标
    units: 0,                       // 当前路段距离（单位）
    totalPx: 0,                     // 当前路段总像素
    remainPx: 0,                    // 当前路段剩余像素
    pxPerSec: ROAD_SPEED_WALK * 60, // 最近一次移动速度（px/秒）
    position: null,                 // 显式位置快照：存档里清楚写明当前在地区还是在道路上
    massTarget: null,               // 导航目标为大量出没事件点：{ edge:[a,b], t }；null=无
    massArrived: false,             // 是否已到达大量出没事件点（导航在该点停止后才触发大量出没）
    pendingBike: false,             // 待选骑行目的地：点背包「自行车」后进入，选好目的地才消耗上车
    bikePrevNav: null,              // 待选期间的旧导航快照：放弃选目的地（点退出/返回/再点背包）时恢复
  };
}

// 初始化/补齐 GPS 状态
export function ensureGpsState() {
  if (!gameData) return;
  if (!gameData.gps) gameData.gps = defaultGpsState();
  else {
    const d = defaultGpsState();
    for (const k of Object.keys(d)) {
      if (gameData.gps[k] === undefined) gameData.gps[k] = d[k];
    }
  }
  syncGpsPosition();
  return gameData.gps;
}

// ---------- 存档默认值 ----------
export function getDefaultSave() {
  return {
    manualBike: false, // 手动骑行状态标记（上车/下车时随主存档持久化，刷新/重开可恢复）
    items: { 'poke-ball':0, 'ultra-ball':0, 'master-ball':0, 'candy':START_CANDY, 'casinoCoin':0, 'sweet-honey':0, 'mystery-egg':0, 'shiny-charm':0, 'bike':0 },
    stats: {
      totalPlaySeconds:0, playSecondsToday:0, lastPlayDate:'', walkDistance:0, totalCatches:0, totalFlees:0, lastSaveTime:Date.now(),
      totalShinySeen:0, totalShinyCaught:0,
      totalBallsUsed:0, totalEggsHatched:0, totalShinyEggsHatched:0, totalEggsProduced:0,
      totalBlockMade:0, totalPlantings:0, totalHarvests:0, totalBerriesHarvested:0, totalBoardTrades:0,
      totalBountyClaims:0, totalBountyCandy:0, bountyClaimsToday:0, lastBountyDate:'',
      totalTrades:0, tradesToday:0, lastTradeDate:'',
      totalNpcWins:0, totalNpcNoviceWins:0, totalNpcEliteWins:0, totalNpcChampionWins:0, totalNpcCandy:0,
      luckyGachaScore:0, luckyGachaCount:0, // 抽卡欧气累计（独立累计，不受抽卡日志 50 条窗口影响）
      totalItemsEarned: { 'poke-ball':0, 'ultra-ball':0, 'master-ball':0, 'candy':START_CANDY, 'sweet-honey':0, 'mystery-egg':0, 'shiny-charm':0, 'bike':0 },
    },
    incubators: Array.from({length: 8}, () => emptyIncubator()),
    incubatorUnlockedSlots: 0,
    gps: defaultGpsState(),
    berryFarm: { plots: Array(6).fill(null), stock: {} }, // 树果农场：6 块田地 + 收获库存（键为树果下标）
    massOutbreak: null,     // 大量出没事件：{ edge:[a,b], t, pokemon, remain, expiresAt, nextSpawnAt, active }；null=无事件
    massNextGenAt: 0,       // 下一次大量出没生成时间戳（毫秒）
    roster: [], // 宝可梦仓库：每只捕获/孵化的宝可梦一个独立条目（个体值/闪光/来源/是否在仓）
    team: [], // 出战队伍：仓库条目 id 数组（首元素为首发），由仓库详情页管理
    training: { slots: [] }, // 训练场：{ slots: [{ id, startAt } | null] }，随时间自动获得经验
    nursery: { parents: [null, null] }, // 饲育屋：{ parents: [{ id, placedAt } | null, ...] }，配对繁殖（与训练/配队互斥）
    casinoRecords: [],   // 21点战绩（滑动窗口 50 条）：{ time, bet, action, result, net }
    mahjongRecords: [],  // 麻将战绩（滑动窗口 50 条，整场一条）：{ time, net, rank, stake }
    bounty: null, // 地区悬赏：{ date: 'YYYY-MM-DD', rewards: [{ pokemon, candy, claimed }] }，由 bounty.js 管理
    trades: null, // 交换广场：{ refreshedAt: Date.now(), offers: [{ npc, want, give, traded }] }，由 trade.js 管理
    battleNpcs: null, // NPC 挑战：{ refreshedAt: Date.now(), list: [{ id, tier, title, name, sprite, lvBonus, candy, mons }] }，由 npcs.js 管理
    pokedex: {},
    encounterLogs: {},
    systemLogs: [],
    incubatorLogs: [], // 孵蛋记录（仅孵化成功事件，最多 50 条）：{ time, species, gender, shiny }
    achievements: {}, // 成就进度：{ 成就id: 已领取档位数 }，由 achievements.js 管理
    collectedCards: {}, // 卡牌收集：{ filename: { tier, cnName, enName, obtainedAt } }，由 gacha.js 管理
    gachaLogs: {}, // 抽卡记录：{ pool1: [{ time, card, tier, cnName, isNew }], pool2: [...] }，由 gacha.js 管理
    introDone: false, // 是否已完成开场剧情（首次进入必须看完才能开始挂机）
    settings: { autoCatch: false, autoFlee: true, windowPinned: true, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': false }, shinyStop: false, legendStop: false, autoBuffHoney: false, autoBuffCharm: false, autoRefill: false, autoRefillBalls: { 'poke-ball': true, 'ultra-ball': false, 'master-ball': false }, autoRefillOrder: ['poke-ball', 'ultra-ball', 'master-ball'], catchFilter: { rows: { normal: { action: 'catch', levelMin: 1, levelMax: 20, uncaughtOnly: false }, normalShiny: { action: 'catch', levelMin: 1, levelMax: 20, uncaughtOnly: false }, legend: { action: 'catch', levelMin: 1, levelMax: 20, uncaughtOnly: false }, legendShiny: { action: 'catch', levelMin: 1, levelMax: 20, uncaughtOnly: false } } }, gender: 'brendan', musicVolume: 0.6, musicEnabled: true },
  };
}

// ---------- 宝可梦仓库 ----------
// 每只捕获/孵化的宝可梦 = 一个独立条目：{ id, species, nickname?, level, shiny, ivs, nature, source, obtainedAt, inRoster }

// 随机生成六围个体值（0~31）
export function rollIvs() {
  return {
    hp: randInt(0, 31), atk: randInt(0, 31), def: randInt(0, 31),
    spa: randInt(0, 31), spd: randInt(0, 31), spe: randInt(0, 31),
  };
}

// 神兽个体值：随机 3 个不同维度强制 31，其余 3 项正常随机
export function rollLegendIvs() {
  const keys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const ivs = rollIvs();
  const picks = new Set();
  while (picks.size < 3) picks.add(Math.floor(Math.random() * keys.length));
  picks.forEach(i => { ivs[keys[i]] = 31; });
  return ivs;
}

// ---------- 性格 ----------
// 25 种性格：key（存档用）→ 中文名（展示用）
export const POKEMON_NATURES = [
  ['hardy','勤奋'], ['lonely','怕寂寞'], ['adamant','固执'], ['naughty','顽皮'], ['brave','勇敢'],
  ['bold','大胆'], ['docile','坦率'], ['impish','淘气'], ['lax','乐天'], ['relaxed','悠闲'],
  ['modest','内敛'], ['mild','慢吞吞'], ['bashful','害羞'], ['rash','马虎'], ['quiet','冷静'],
  ['calm','温和'], ['gentle','温顺'], ['careful','慎重'], ['quirky','浮躁'], ['sassy','自大'],
  ['timid','胆小'], ['hasty','急躁'], ['jolly','爽朗'], ['naive','天真'], ['serious','认真'],
];
const _natureMap = new Map(POKEMON_NATURES);
export function getNature(key) { return _natureMap.has(key) ? { cn: _natureMap.get(key) } : null; }
// 随机 roll 一个性格 key
export function rollNature() { return POKEMON_NATURES[randInt(0, POKEMON_NATURES.length - 1)][0]; }

// ---------- 性别 ----------
// genderRate：-1=无性别；0-8=雌性概率/8（数据源：素材包 gender_ratio 转换，见 pokedex.json）
export function rollGender(species) {
  const rate = getPokemonByIndex(species)?.genderRate ?? 4; // 数据缺失兜底 50/50
  if (rate === -1) return 'genderless';
  return Math.random() * 8 < rate ? 'female' : 'male';
}

// 旧存档兼容：无 gender 字段的旧个体按物种比例补 roll 并写回
export function ensureGender(entry) {
  if (!entry || entry.gender) return entry?.gender || 'genderless';
  const g = rollGender(entry.species);
  entry.gender = g;
  return g;
}

// 性别 → 雪碧图图标（♂ 蓝 / ♀ 粉，颜色由 .g-female/.g-male 控制）；无性别返回空串
export function genderBadge(g) {
  if (g === 'female') return '<svg class="g-sym g-female" viewBox="0 0 24 24" width="12" height="12"><use xlink:href="./icons/sprites.svg#icon-female"/></svg>';
  if (g === 'male') return '<svg class="g-sym g-male" viewBox="0 0 24 24" width="12" height="12"><use xlink:href="./icons/sprites.svg#icon-male"/></svg>';
  // 无性别：♂♀ 组合图标，同尺寸占位保证等级列 Lv 起点对齐
  return '<svg class="g-sym g-genderless" viewBox="0 0 24 24" width="12" height="12"><use xlink:href="./icons/sprites.svg#icon-genderless"/></svg>';
}

// 是否为宝可梦（非蛋）：蛋条目（kind:'egg'）不可用于配队/训练/交换/悬赏/饲育屋等
// 一切消耗与参战入口，仅能查看详情与放入孵蛋器。旧存档无 kind 字段 = 宝可梦，天然兼容
export function isPokemon(p) {
  return !p || !p.kind || p.kind !== 'egg';
}

// 把一只刚获得的宝可梦加入仓库（捕获/孵蛋时调用）
export function addRosterEntry({ species, shiny = false, source = 'normal', level = 1, gender }) {
  if (!gameData) return null;
  if (!Array.isArray(gameData.roster)) gameData.roster = [];
  const poke = getPokemonByIndex(String(species));
  const legendIv = source !== 'egg' && poke && poke.legend === true;
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    species,
    shiny: !!shiny,
    gender: gender || rollGender(species), // 显式传入的性别优先（如捕获时沿用遭遇性别，避免两次 roll 不一致）
    level, // 捕获/孵化即 Lv1（战斗系统）；野生捕获可传随机等级
    exp: 0, // 经验（对战获得）
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, // 努力值（训练方向自动分配）
    ivs: legendIv ? rollLegendIvs() : rollIvs(),
    nature: rollNature(),
    source,
    obtainedAt: Date.now(),
    inRoster: true,
  };
  gameData.roster.push(entry);
  // 通知依赖仓库变化的界面（如交换页实时刷新按钮可用状态）
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('roster-changed'));
  return entry;
}

// 稀有度文字等级（捕获率/获得结果展示共用）
export function rarityLabel(rarity) {
  if (rarity <= 0.2) return '常见';
  if (rarity <= 0.4) return '一般';
  if (rarity <= 0.6) return '稀有';
  if (rarity <= 0.8) return '罕见';
  return '极稀有';
}

// 最近一次获得的宝可梦在仓库中的个体 id（捕获/孵蛋后“查看详情”跳转用）
let _lastObtainedEntryId = null;
export function getLastObtainedEntryId() { return _lastObtainedEntryId; }
export function setLastObtainedEntryId(id) { _lastObtainedEntryId = id; }

// ---------- 系统日志 ----------
export function addSystemLog(type, details) {
  if (!gameData.systemLogs) gameData.systemLogs = [];
  gameData.systemLogs.push({ time: Date.now(), type, details });
  if (gameData.systemLogs.length > 50) {
    gameData.systemLogs = gameData.systemLogs.slice(-50);
  }
}

// 孵蛋记录（独立留存，仅孵化成功事件，最多 50 条）：{ time, species, gender, shiny }
export function addIncubatorLog({ species, gender, shiny = false }) {
  if (!gameData.incubatorLogs) gameData.incubatorLogs = [];
  gameData.incubatorLogs.push({ time: Date.now(), species, gender, shiny });
  if (gameData.incubatorLogs.length > 50) {
    gameData.incubatorLogs = gameData.incubatorLogs.slice(-50);
  }
}

// ---------- 存档保存 ----------
export async function saveGame() {
  if (!gameData) return;
  gameData.stats.lastSaveTime = Date.now();
  syncGpsPosition();
  const s = JSON.stringify(gameData);
  if (window.__TAURI__?.core?.invoke) {
    try { await window.__TAURI__.core.invoke('save_game_data', { data: s }); } catch (_) {}
  }
  try { localStorage.setItem('pokemon_idle_save', s); } catch (_) {}
}

// 当前遭遇的自定义文案（如钓鱼"上钩了"），写入会话状态以便刷新后沿用
export let encounterMsg = null;
export function setEncounterMsg(msg) { encounterMsg = msg; }

// ---------- 会话状态保存/恢复 ----------
const SESSION_KEY = 'pokemon_idle_session';

export function saveSessionState(extra) {
  try {
    const state = {
      _savedAt: Date.now(),
      phase,
      honeyBuffActive,
      honeyPausedRemaining,
      charmBuffActive,
      charmPausedRemaining,
      _charmEncounterCount,
      blockBuffActive,
    };
    if ((phase === 'encounter' || phase === 'caught') && currentEncounter) {
      state.encounter = {
        index: currentEncounter.index,
        isShiny: currentIsShiny,
        ballsUsed: encounterBallsUsed,
        balls: { ...currentEncounterBalls },
        msg: encounterMsg,
      };
    }
    if (honeyBuffActive && honeyCountdownEnd > Date.now()) {
      state.honeyRemaining = honeyCountdownEnd - Date.now();
    }
    if (charmBuffActive && charmCountdownEnd > Date.now()) {
      state.charmRemaining = charmCountdownEnd - Date.now();
    }
    if (blockBuffActive) {
      state.blockStartWalk = blockStartWalk;
      state.blockRecipe = [...blockRecipe];
      state.blockQuality = blockQuality;
    }
    if (qteState) state.qteState = qteState;
    if (extra) Object.assign(state, extra); // 附加会话状态（如手动骑行标记），随会话一并保存
    localStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch (_) {}
}

export function restoreSessionState() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;
  localStorage.removeItem(SESSION_KEY);
  let state;
  try { state = JSON.parse(raw); } catch (_) { return; }
  if (!state) return;

  // 返回恢复所需的 state 快照，由调用方处理
  return state;
}

// ---------- 今日挂机时长 ----------
function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 累计挂机秒数到"今日时长"（跨天自动清零重计）
export function addPlaySeconds(save, sec) {
  if (!save?.stats) return;
  const ts = todayDateStr();
  if (save.stats.lastPlayDate !== ts) {
    save.stats.lastPlayDate = ts;
    save.stats.playSecondsToday = 0;
  }
  save.stats.playSecondsToday = (save.stats.playSecondsToday || 0) + sec;
}

// ---------- 离线处理：仅推进 0 点刷新的内容，其余机制保持存档原样 ----------
export function calcOffline(save) {
  const now = Date.now();
  const elapsed = Math.min((now - save.stats.lastSaveTime) / 1000, 86400);
  if (elapsed <= 0) return 0;
  // 长时间离线（非刷新）不保留手动骑行状态：清除标记，重开后按走路结算
  if (elapsed * 1000 > BIKE_RESTORE_MAX_GAP_MS) {
    save.manualBike = false;
    if (save.gps) { save.gps.pendingBike = false; save.gps.bikePrevNav = null; } // 待选骑行目的地也不跨长离线保留
  }
  save.stats.totalPlaySeconds += elapsed;
  // 今日挂机时长：跨天时只累计今天 0 点之后的部分（昨天的离线秒数不计入今天）
  const ts = todayDateStr();
  if (save.stats.lastPlayDate !== ts) {
    save.stats.lastPlayDate = ts;
    save.stats.playSecondsToday = 0;
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    save.stats.playSecondsToday += Math.max(0, Math.min(elapsed, (now - midnight) / 1000));
  } else {
    save.stats.playSecondsToday = (save.stats.playSecondsToday || 0) + elapsed;
  }
  // 离线暂停：把依赖真实时间推进的机制时间基准整体后移，等价于离线期间不走表。
  // 孵蛋已改为里程制（离线不走路，天然暂停），无需处理
  const ms = Math.floor(elapsed * 1000);
  if (ms > 0) {
    // 树果农场：离线不生长、不干涸（告示牌每日需求属 0 点刷新，仍由 berry.js 按日期刷新）
    for (const p of save.berryFarm?.plots || []) {
      if (p && p.waterAt) p.waterAt += ms;
    }
    // 训练场：离线不训练（与树果农场/交换刷新同口径，离线期间不计时）
    for (const s of save.training?.slots || []) {
      if (s) s.startAt += ms;
    }
    // 交换广场：刷新倒计时只按在线时间累计，离线不刷新
    if (save.trades?.refreshedAt) save.trades.refreshedAt += ms;
  }
  return elapsed;
}

// ---------- 大量出没（随机道路事件）----------
// 共享读取函数放这里：gps.js / battle.js / events.js 都会用到，避免模块间循环依赖
export function getMassOutbreak() {
  if (!gameData || !gameData.massOutbreak || !gameData.massOutbreak.active) return null;
  return gameData.massOutbreak;
}

// 主角当前是否位于大量出没事件点：事件是一个"点"而非整条路，
// 必须通过地图点击事件点标记导航过去并在该点停下（gps.massArrived）才算进入大量出没区域；
// 仅在事件路段上路过（去往其他地区）不算，避免整条路都触发大量出没。
export function inMassZone() {
  const mo = getMassOutbreak();
  if (!mo) return false;
  const g = gameData?.gps;
  if (!g || !g.massArrived) return false;
  if (!g.path || g.path.length < 2) return false;
  const a = g.path[g.seg];
  const b = g.path[g.seg + 1];
  const [ea, eb] = mo.edge;
  return (a === ea && b === eb) || (a === eb && b === ea);
}

// ---------- 当前位置换算 ----------
// 当前路段已走像素（从段起点 path[seg] 量起）。
// 大量出没事件边（最后一段）的 remainPx 语义是"到事件点的剩余距离"：已走 = 段起点到事件点的距离 - 剩余；
// 普通路段 remainPx 是"到段终点的剩余"：已走 = 总长 - 剩余。统一换算，避免定位点/归属/路段编号跳变。
export function walkedPxOnSegment(g) {
  if (!g || !g.path || g.path.length < 2 || g.seg >= g.path.length - 1 || !g.totalPx) return 0;
  const remain = g.remainPx || 0;
  if (g.massTarget && g.seg === g.path.length - 2) {
    const [ea, eb] = g.massTarget.edge;
    const fromA = g.totalPx * g.massTarget.t;
    const fromStart = (g.path[g.seg] === ea) ? fromA : g.totalPx - fromA; // 段起点到事件点的距离
    return Math.max(0, Math.min(fromStart, fromStart - remain));
  }
  return Math.max(0, Math.min(g.totalPx, g.totalPx - remain));
}

// 取消大量出没目标时，把事件边最后一段的 remainPx 从"到事件点的剩余"换算回"到段终点的剩余"，
// 保证之后（取消导航/改目的地/事件结束）按普通路段语义读取位置时不会瞬移。
export function normalizeMassRemainToEnd(g) {
  if (!g || !g.massTarget || !g.path || g.path.length < 2 || g.seg !== g.path.length - 2 || !g.totalPx) return;
  const [ea, eb] = g.massTarget.edge;
  const fromA = g.totalPx * g.massTarget.t;
  const fromStart = (g.path[g.seg] === ea) ? fromA : g.totalPx - fromA;
  const walked = Math.max(0, Math.min(fromStart, fromStart - (g.remainPx || 0)));
  g.remainPx = g.totalPx - walked;
}

// ---------- 当前地区 ----------
// 在途时按路段进度分归属：前半程归出发端、后半程归目标端，避免方向性矛盾
export function getCurrentRegion() {
  const g = gameData?.gps;
  // 在途：有路径且当前段有长度 → 按物理位置折算归属地区
  if (g && g.path && g.path.length >= 2 && g.totalPx > 0) {
    const a = g.path[g.seg];
    const b = g.path[g.seg + 1];
    if (a != null && b != null && a !== b) {
      // 段内已走比例 [0,1)：A→B 正算，B→A 反向折算成从 A 端量起的物理坐标
      let p = g.totalPx > 0 ? walkedPxOnSegment(g) / g.totalPx : 0;
      if (a > b) p = 1 - p;
      const idx = p < 0.5 ? Math.min(a, b) : Math.max(a, b);
      return { id: idx, name: REGION_CYCLE[idx] || '丰缘' };
    }
  }
  const idx = g?.curIdx ?? 2;
  return { id: idx, name: REGION_CYCLE[idx] || '丰缘' };
}

// ---------- 路段分段编号 ----------
// 每条路拆成前后两段独立编号（与 map.html 一致）；距离矩阵由 gps.js 注册
let _distMatrix = null;
export function setDistMatrix(m) { _distMatrix = m; }
let _segBase = null;
function segBase() {
  if (!_segBase && _distMatrix) {
    const t = {};
    let n = 1;
    for (let i = 0; i < _distMatrix.length; i++) {
      for (let j = i + 1; j < _distMatrix.length; j++) {
        const d = _distMatrix[i][j];
        if (d > 0 && d !== 999) { t[`${i}-${j}`] = n; n += 2; }
      }
    }
    _segBase = t;
  }
  return _segBase;
}

// 当前正在走的路段：返回 { num, name }（num = 该段独立编号，name = 所属地区）；不在途中返回 null
export function getCurrentRoadInfo() {
  const g = gameData?.gps;
  const t = segBase();
  if (!g || !t || !g.path || g.path.length < 2) return null;
  const a = g.path[g.seg], b = g.path[g.seg + 1];
  if (a == null || b == null || a === b) return null;
  const min = Math.min(a, b), max = Math.max(a, b);
  const base = t[`${min}-${max}`];
  if (base == null) return null;
  const pa = g.totalPx > 0 ? walkedPxOnSegment(g) / g.totalPx : 0; // 从出发端量起的段内进度
  const firstHalf = pa < 0.5;
  // 编号：出发端为小号地区时前半段 = base，否则 = base + 1
  const num = firstHalf === (a === min) ? base : base + 1;
  return { num, name: REGION_CYCLE[firstHalf ? a : b] };
}

// 任意路段（边）+ 事件点位置比例 → 路段编号（与 getCurrentRoadInfo 的编号规则一致：t<0.5 归前段）
// 大量出没等事件文案需要显示"几号道路"时使用；边不在道路网络中返回 null
export function getRoadNumForEdge(edge, t) {
  if (!edge || edge.length < 2) return null;
  const base = segBase()?.[`${Math.min(edge[0], edge[1])}-${Math.max(edge[0], edge[1])}`];
  if (base == null) return null;
  return base + (t < 0.5 ? 0 : 1);
}

// 当前 GPS 位置快照（存档记录“我在哪”，读档后用于确认位置）
export function getGpsPositionSnapshot() {
  const g = gameData?.gps;
  if (!g) return null;
  const region = getCurrentRegion();
  const road = getCurrentRoadInfo();
  const hasRoad = !!(road && g.path && g.path.length >= 2 && g.seg < g.path.length - 1 && g.totalPx > 0);
  const base = {
    type: hasRoad ? 'road' : 'region',
    regionId: region.id,
    regionName: region.name,
    destIdx: g.destIdx ?? null,
    destName: g.destIdx != null ? (REGION_CYCLE[g.destIdx] || null) : null,
  };
  if (!hasRoad) {
    const nodeIdx = g.curIdx ?? region.id;
    return {
      ...base,
      nodeIdx,
      nodeName: REGION_CYCLE[nodeIdx] || region.name,
      label: REGION_CYCLE[nodeIdx] || region.name,
    };
  }
  const fromIdx = g.path[g.seg];
  const toIdx = g.path[g.seg + 1];
  const walked = walkedPxOnSegment(g);
  const progress = g.totalPx > 0 ? Math.max(0, Math.min(1, walked / g.totalPx)) : 0;
  const progressPct = Math.round(progress * 1000) / 10;
  return {
    ...base,
    roadNum: road.num,
    roadName: road.name,
    fromIdx,
    fromName: REGION_CYCLE[fromIdx] || '',
    toIdx,
    toName: REGION_CYCLE[toIdx] || '',
    progress: Number(progress.toFixed(4)),
    progressPct,
    remainPx: Math.round((g.totalPx || 0) - walked),
    totalPx: Math.round(g.totalPx || 0),
    label: `${road.num}#道路（${road.name}） ${REGION_CYCLE[fromIdx] || ''}→${REGION_CYCLE[toIdx] || ''} ${progressPct}%`,
  };
}

export function syncGpsPosition() {
  const g = gameData?.gps;
  if (!g) return null;
  g.position = getGpsPositionSnapshot();
  return g.position;
}

// ---------- 是否有可用球 ----------
export function hasAnyBall() {
  if (gameData.settings?.autoCatch) {
    const balls = gameData.settings?.autoCatchBalls || { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true };
    for (const b of ['poke-ball', 'ultra-ball', 'master-ball']) {
      if (balls[b] !== false && (gameData.items[b]||0) > 0) return true;
    }
    return false;
  }
  return (gameData.items['poke-ball']||0) + (gameData.items['ultra-ball']||0) + (gameData.items['master-ball']||0) > 0;
}

// ---------- 工具函数 ----------
export function rand(min, max) { return Math.random() * (max - min) + min; }
export function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
export function pad(n) { return String(n).padStart(2, '0'); }
export function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
// 大数值缩写：1000→1K、1234→1.2K、1000000→1M、1000000000→1B（小数位去掉多余的 .0）
function shortNum(v) {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
export function formatNum(n) {
  n = Number(n) || 0;
  if (n >= 1000000000) return shortNum(n / 1000000000) + 'B';
  if (n >= 1000000) return shortNum(n / 1000000) + 'M';
  if (n >= 1000) return shortNum(n / 1000) + 'K';
  return String(n);
}
