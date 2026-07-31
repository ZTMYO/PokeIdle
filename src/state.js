// ===== 游戏状态 + 存档管理 =====
import { ITEM_RATES, REGION_CYCLE, REGION_DURATION } from './config.js';

// ---------- 游戏数据 ----------
export let allPokemon = [];
export let gameData = null;
export let phase = 'idle'; // idle | encounter | caught | fled | eggResult
export let currentEncounter = null;
export let currentIsShiny = false;
export let encounterBallsUsed = 0;
export let currentEncounterBalls = {};
export let _catchStreak = 0;
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
export function setCatchStreak(n) { _catchStreak = n; }
export function setAllPokemon(a) { allPokemon = a; }
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
export function setPokedexInLogView(v) { _pokedexInLogView = v; }
export function setPokedexSortBy(v) { _pokedexSortBy = v; }
export function setPokedexSortDir(v) { _pokedexSortDir = v; }
export function setHoneyExpiryTimer(t) { honeyExpiryTimer = t; }
export function setCharmExpiryTimer(t) { charmExpiryTimer = t; }
export function setHoneyCountdownInterval(i) { honeyCountdownInterval = i; }
export function setCharmCountdownInterval(i) { charmCountdownInterval = i; }

// ---------- 孵化时间计算 ----------
export function calcHatchDuration(poke) {
  const w = Math.min((poke.weight || 100) / 5000, 1); // 重量 0~1
  const r = poke.rarity || 0.5;                       // 稀有度 0~1
  const factor = Math.min(w * 0.6 + r * 0.4, 1);       // 综合因子 0~1
  const minTime = 600;                                 // 最短 10 分钟
  const maxTime = 28800;                               // 最长 8 小时
  const ratio = maxTime / minTime;                     // 48 倍
  const time = minTime * Math.pow(ratio, factor);      // 指数增长
  const randomized = time + (Math.random() - 0.5) * time * 0.4; // ±20%
  return Math.round(Math.max(minTime, randomized)) * 1000;
}

// 空孵蛋器
export function emptyIncubator() {
  return { eggIndex: null, name: null, hatchStart: 0, hatchDuration: 0, hatched: false, isShiny: false };
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

// ---------- 存档默认值 ----------
export function getDefaultSave() {
  return {
    items: { 'poke-ball':0, 'ultra-ball':0, 'master-ball':0, 'candy':0, 'sweet-honey':0, 'mystery-egg':0, 'shiny-charm':0 },
    stats: {
      totalPlaySeconds:0, totalCatches:0, totalFlees:0, lastSaveTime:Date.now(),
      totalShinySeen:0, totalShinyCaught:0,
      totalBallsUsed:0, totalEggsHatched:0, totalShinyEggsHatched:0,
      totalItemsEarned: { 'poke-ball':0, 'ultra-ball':0, 'master-ball':0, 'candy':0, 'sweet-honey':0, 'mystery-egg':0, 'shiny-charm':0 },
    },
    incubators: Array.from({length: 8}, () => emptyIncubator()),
    incubatorUnlockedSlots: 0,
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

// ---------- 存档清洗 ----------
export function cleanSaveData(data) {
  if (!data.pokedex) return data;
  if (!data.encounterLogs) data.encounterLogs = {};
  return data;
}

// ---------- 存档确保字段 ----------
export function ensureStats(stats) {
  if (typeof stats.totalBallsUsed !== 'number') stats.totalBallsUsed = 0;
  if (typeof stats.totalEggsHatched !== 'number') stats.totalEggsHatched = 0;
  if (typeof stats.totalShinyEggsHatched !== 'number') stats.totalShinyEggsHatched = 0;
  if (!stats.totalItemsEarned) {
    stats.totalItemsEarned = { 'poke-ball':0, 'ultra-ball':0, 'master-ball':0, 'candy':0, 'sweet-honey':0, 'mystery-egg':0, 'shiny-charm':0 };
  }
  return stats;
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
  for (const [item, rate] of Object.entries(ITEM_RATES)) {
    const gained = Math.floor(rate * elapsed);
    if (gained > 0) save.items[item] += gained;
  }
  return elapsed;
}

// ---------- 当前地区 ----------
export function getCurrentRegion() {
  const sec = gameData?.stats?.totalPlaySeconds ?? 0;
  const regionId = Math.floor(sec / REGION_DURATION) % REGION_CYCLE.length;
  return { id: regionId, name: REGION_CYCLE[regionId] };
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

// ---------- 存档完整性检查 ----------
export function ensureGameData(data) {
  const def = getDefaultSave();
  if (!data.items || typeof data.items !== 'object') data.items = { ...def.items };
  else {
    for (const k of Object.keys(def.items)) {
      if (typeof data.items[k] !== 'number') data.items[k] = 0;
    }
  }
  if (!data.stats || typeof data.stats !== 'object') data.stats = { ...def.stats, lastSaveTime:Date.now() };
  else {
    for (const k of Object.keys(def.stats)) {
      if (k === 'totalItemsEarned') continue;
      if (typeof data.stats[k] !== 'number') data.stats[k] = def.stats[k];
    }
    if (!data.stats.totalItemsEarned || typeof data.stats.totalItemsEarned !== 'object') {
      data.stats.totalItemsEarned = { ...def.stats.totalItemsEarned };
    } else {
      for (const k of Object.keys(def.stats.totalItemsEarned)) {
        if (typeof data.stats.totalItemsEarned[k] !== 'number') data.stats.totalItemsEarned[k] = 0;
      }
    }
  }
  if (!data.pokedex) data.pokedex = {};
  if (!data.encounterLogs) data.encounterLogs = {};
  if (!data.incubators || !Array.isArray(data.incubators) || data.incubators.length !== 8) {
    data.incubators = Array.from({length: 8}, () => emptyIncubator());
  } else {
    data.incubators = data.incubators.map(s => s && typeof s === 'object' ? { ...emptyIncubator(), ...s } : emptyIncubator());
  }
  if (typeof data.incubatorUnlockedSlots !== 'number' || data.incubatorUnlockedSlots < 0) {
    data.incubatorUnlockedSlots = 0;
  }
  // 迁移旧存档：之前默认 4 个免费槽，现在全部需解锁
  if (data.incubatorUnlockedSlots === 4 && data.incubators) {
    data.incubatorUnlockedSlots = 0;
  }
  if (!data.settings) data.settings = { ...def.settings };
  if (typeof data.settings.windowPinned !== 'boolean') data.settings.windowPinned = false;
  if (!data.settings.autoCatchBalls) data.settings.autoCatchBalls = { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true };
  if (typeof data.settings.shinyStop !== 'boolean') data.settings.shinyStop = false;
  if (typeof data.settings.autoBuffHoney !== 'boolean') data.settings.autoBuffHoney = false;
  if (typeof data.settings.autoBuffCharm !== 'boolean') data.settings.autoBuffCharm = false;
  for (const [idx, logs] of Object.entries(data.encounterLogs)) {
    if (!Array.isArray(logs)) { delete data.encounterLogs[idx]; continue; }
    data.encounterLogs[idx] = logs.filter(log => {
      if (!log || typeof log !== 'object') return false;
      if (!log.balls || typeof log.balls !== 'object') return false;
      if (!log.result || !log.time) return false;
      return true;
    });
    if (data.encounterLogs[idx].length === 0) delete data.encounterLogs[idx];
  }
  return data;
}
