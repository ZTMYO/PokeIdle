// ===== 游戏状态 + 存档管理 =====
import { ITEM_RATES, REGION_CYCLE, HATCH_TIME_MIN, HATCH_TIME_MAX, HATCH_TIME_SIGMA, ROAD_SPEED_WALK } from './config.js';

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
export let _honeyEncounterCount = 0;
export let _charmEncounterCount = 0;

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
export function setCurrentEncounter(e) { currentEncounter = e; }
export function setCurrentIsShiny(s) { currentIsShiny = s; }
export function setEncounterBallsUsed(n) { encounterBallsUsed = n; }
export function setCurrentEncounterBalls(b) { currentEncounterBalls = b; }
export function setGameTick(n) { gameTick = n; }
export function setPrevView(v) { _prevView = v; }
export function setLastRegionId(id) { _lastRegionId = id; }
export function setHoneyBuffActive(v) { honeyBuffActive = v; window.__honeyBuffActive__ = v; }
export function setHoneyCountdownEnd(t) { honeyCountdownEnd = t; }
export function setCharmBuffActive(v) { charmBuffActive = v; window.__charmBuffActive__ = v; }
export function setCharmCountdownEnd(t) { charmCountdownEnd = t; }
export function setHoneyPausedRemaining(v) { honeyPausedRemaining = v; }
export function setCharmPausedRemaining(v) { charmPausedRemaining = v; }
export function setHoneyEncounterCount(n) { _honeyEncounterCount = n; }
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

// ---------- 孵化时间计算 ----------
// 体重/稀有度决定正态分布的峰值（对数插值），叠加正态随机后截断到配置区间，
// 使所有孵化时间都落在 [HATCH_TIME_MIN, HATCH_TIME_MAX] 内且呈钟形分布
export function calcHatchDuration(poke) {
  const w = Math.min((poke.weight || 100) / 5000, 1); // 重量 0~1
  const r = poke.rarity || 0.5;                       // 稀有度 0~1
  const factor = Math.min(w * 0.6 + r * 0.4, 1);      // 综合因子 0~1
  // 分布峰值：轻/常见 → 靠近最短，重/稀有 → 靠近最长
  const mid = HATCH_TIME_MIN * Math.pow(HATCH_TIME_MAX / HATCH_TIME_MIN, factor);
  // 标准差相对峰值（而非整段区间）：否则轻/常见宝可梦的分布会大量被截断在最小值整值
  const sigma = Math.max(60, mid * HATCH_TIME_SIGMA);
  // 截断正态采样（Box-Muller）：超出配置区间时重新采样而非粗暴截断，
  // 保证钟形分布，且不会堆积出大量"恰好 30 分钟整"的结果
  let t = 0;
  do {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    t = mid + z * sigma;
  } while (t < HATCH_TIME_MIN || t > HATCH_TIME_MAX);
  return Math.round(t) * 1000;
}

// 空孵蛋器
export function emptyIncubator() {
  return { eggIndex: null, hatchStart: 0, hatchDuration: 0, hatched: false, isShiny: false };
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
    roamEnabled: false,            // 漫游开关：关闭时没有目的地，停留在当前地区
    curIdx: 2,                     // 当前地区编号（REGION_CYCLE 下标，2=丰缘）
    destIdx: null,                 // 目的地地区编号；null=无目的地
    path: null,                    // 最短路线（地区编号数组）
    seg: 0,                        // 当前路段下标
    units: 0,                      // 当前路段距离（单位）
    totalPx: 0,                    // 当前路段总像素
    remainPx: 0,                   // 当前路段剩余像素
    arrived: false,                // 是否已到达目的地
    arrivedAt: 0,                  // 到达时间戳（停留片刻后自动规划下一站）
    pxPerSec: ROAD_SPEED_WALK * 60, // 最近一次移动速度（px/秒）
  };
}

// 补齐/初始化 GPS 状态（兼容旧存档）
export function ensureGpsState() {
  if (!gameData) return;
  if (!gameData.gps) gameData.gps = defaultGpsState();
  else {
    const d = defaultGpsState();
    for (const k of Object.keys(d)) {
      if (gameData.gps[k] === undefined) gameData.gps[k] = d[k];
    }
  }
  return gameData.gps;
}

// ---------- 存档默认值 ----------
export function getDefaultSave() {
  return {
    items: { 'poke-ball':0, 'ultra-ball':0, 'master-ball':0, 'candy':0, 'sweet-honey':0, 'mystery-egg':0, 'shiny-charm':0 },
    stats: {
      totalPlaySeconds:0, walkDistance:0, totalCatches:0, totalFlees:0, lastSaveTime:Date.now(),
      totalShinySeen:0, totalShinyCaught:0,
      totalBallsUsed:0, totalEggsHatched:0, totalShinyEggsHatched:0,
      totalItemsEarned: { 'poke-ball':0, 'ultra-ball':0, 'master-ball':0, 'candy':0, 'sweet-honey':0, 'mystery-egg':0, 'shiny-charm':0 },
    },
    incubators: Array.from({length: 8}, () => emptyIncubator()),
    incubatorUnlockedSlots: 0,
    gps: defaultGpsState(),
    pokedex: {},
    encounterLogs: {},
    systemLogs: [],
    settings: { autoCatch: false, autoFlee: false, windowPinned: false, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true }, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false },
  };
}

// ---------- 系统日志 ----------
export function addSystemLog(type, details) {
  if (!gameData.systemLogs) gameData.systemLogs = [];
  gameData.systemLogs.push({ time: Date.now(), type, details });
  if (gameData.systemLogs.length > 50) {
    gameData.systemLogs = gameData.systemLogs.slice(-50);
  }
}

// ---------- 存档保存 ----------
export async function saveGame() {
  if (!gameData) return;
  gameData.stats.lastSaveTime = Date.now();
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

export function saveSessionState() {
  try {
    const state = {
      _savedAt: Date.now(),
      phase,
      honeyBuffActive,
      honeyPausedRemaining,
      charmBuffActive,
      charmPausedRemaining,
      _honeyEncounterCount,
      _charmEncounterCount,
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

// ---------- 离线收益计算 ----------
export function calcOffline(save) {
  const now = Date.now();
  const elapsed = Math.min((now - save.stats.lastSaveTime) / 1000, 86400);
  if (elapsed <= 0) return 0;
  save.stats.totalPlaySeconds += elapsed;
  // 地区进度只按实际游玩时的行走/跑步距离推进，离线不累计
  for (const [item, rate] of Object.entries(ITEM_RATES)) {
    const gained = Math.floor(rate * elapsed);
    if (gained > 0) save.items[item] += gained;
  }
  return elapsed;
}

// ---------- 当前地区 ----------
// 当前地区由 GPS 位置决定：开启漫游并抵达目的地后才会改变；
// 未开启时一直停留在当前位置（默认从丰缘出发）。
export function getCurrentRegion() {
  const idx = gameData?.gps?.curIdx ?? 2;
  return { id: idx, name: REGION_CYCLE[idx] || '丰缘' };
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
export function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
