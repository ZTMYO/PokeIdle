// ===== 口袋挂机 - 入口模块 =====
import { CATCH_RATES, SAVE_INTERVAL, ENCOUNTER_MIN, ENCOUNTER_MAX, ITEM_RATES, ITEM_NAMES, ROAD_SPECIAL_CHANCE, ROAD_WIDTH_MIN, ROAD_WIDTH_MAX, ROAD_SWITCH_CYCLES } from './config.js';
import {
  allPokemon, gameData, phase, currentEncounter, currentIsShiny,
  currentEncounterBalls, encounterBallsUsed,
  honeyBuffActive, charmBuffActive,
  honeyCountdownEnd, charmCountdownEnd,
  honeyPausedRemaining, charmPausedRemaining,
  honeyCountdownInterval, charmCountdownInterval,
  honeyExpiryTimer, charmExpiryTimer,
  _charmEncounterCount,
  _autoFleeTimer, _autoFleeBarInterval,
  _autoCatching,
  _catchConfirmStep, _prevView, _pokedexInLogView, _idleMsgIdx,
  _lastRegionId, gameTick, _fishing,
  setAllPokemon, setGameData, setPhase, setCurrentEncounter,
  setCurrentIsShiny, setEncounterBallsUsed, setCurrentEncounterBalls,
  setGameTick, setPrevView, setLastRegionId,
  setHoneyBuffActive, setHoneyCountdownEnd, setCharmBuffActive, setCharmCountdownEnd,
  setHoneyPausedRemaining, setCharmPausedRemaining,
  setCharmEncounterCount, setIdleMsgIdx, setCatchConfirmStep,
  setBlockBuffActive, setBlockRecipe, setBlockStartWalk, setBlockQuality, setQteState,
  getDefaultSave, saveGame, getPokemonByIndex, ensureGpsState, defaultGpsState,
  restoreSessionState, calcOffline, addSystemLog, getCurrentRegion, addRosterEntry, getLastObtainedEntryId,
  hasAnyBall, saveSessionState, rand, randInt, formatNum,
  setEncounterMsg, addPlaySeconds,
} from './state.js';
import { computeObtainScore } from './scoring.js';
import {
  $, showView, updateTextBox, hideTextBox,
  isOnGameView, applyCharSprites, updateBackpack, updateStats, setIdleCharacter,
  renderIncubatorView, updateIncubatorTimers, updateIncubatorBadge,
} from './ui.js';
import { spawnItemDrop, activateHoney, activateShinyCharm,
  startHoneyCountdown, startCharmCountdown, clearHoneyCountdown, clearCharmCountdown,
  closeCandyDialog, doCandyExchange } from './items.js';
import { syncBlockVisual, startBlockCountdown, clearBlockCountdown } from './mixer.js';
import { scheduleNextEncounter, throwBall, fleeEncounter, goIdle,
  tryEncounter, pauseAutoFleeTimer, autoCatch, showEncounter } from './battle.js';
import { startIdleRotation, buildIdleMessages } from './messages.js';
import { tryStartFishing, onRoadChanged, getFishingGuarantee } from './fishing.js';
import { helperTick, refreshBerryView } from './berry.js';
import { startIntro, advanceIntro, confirmIntro } from './intro.js';
import { restorePokedex, setupRegionDropdown,
  showPokedex, setupPokedexSearch } from './pokedex.js';
import { showRosterView, isRosterInDetail, isRosterDetailFromObtain, leaveRosterDetailToSource, restoreRosterList, isRosterDetailFromList, leaveRosterDetailToList, isRosterDetailJumpedToPokedex, returnRosterDetailFromPokedex } from './roster.js';
import { isTradeInDetail, restoreTradeList } from './trade.js';
import { showShopView, showSettingsView,
  showTutorialView, renderSystemLogs } from './views.js';
import { showPhoneView, updateTradeBadge, updateBerryBadge, updatePhoneBadge } from './phone.js';
import { gpsAddDistance, showGpsView } from './gps.js';
import { initAudio, playRegion, playCycling, endCycling, stopVictory, setMuted, isMuted, setMusicEnabled, setSplashLocked, setShowCardOnEncounterEnd, setBattleMusic } from './audio.js';
import { ensureBounty, updateBountyBadge, isBountyInTrade, restoreBountyList } from './bounty.js';
import * as road from './road.js';
import * as particles from './particles.js';

let ROAD_PRESETS = null;
let ROAD_LAND = [];   // 普通陆地路段池（无垂钓点、非自行车道）
let ROAD_WATER = [];  // 水域路段池（有垂钓点，可钓鱼）
let ROAD_BIKE = [];   // 自行车道路段池（不遇敌、不拾取、快速推进里程）
window.__introActive = false; // 开场剧情进行中（gate 挂机推进，拦截箭头/确认点击）
let _roadIdx = 0;
let _roadCycleStart = 0;
let _pendingBike = null; // 过渡加载时暂存新路段的骑行状态，待过渡完成后应用

function _randomWidth() {
  // prob（随机生成）道路长度在 [ROAD_WIDTH_MIN, ROAD_WIDTH_MAX] 间均匀随机
  return ROAD_WIDTH_MIN + Math.floor(Math.random() * (ROAD_WIDTH_MAX - ROAD_WIDTH_MIN + 1));
}

function loadRoad(idx, useTransition, saved) {
  const p = ROAD_PRESETS[idx];
  // 先随机一段长度，再按类型处理：
  // fixed 向上取整到瓦片行宽的整数倍后循环拼接；prob 直接用随机长度逐格生成
  const base = _randomWidth();
  let game;
  if (p.type === 'fixed') {
    const rowLen = p.game.tiles[0]?.length || p.game.width;
    game = { ...p.game, width: rowLen * Math.max(1, Math.ceil(base / rowLen)) };
  } else {
    game = { ...p.game, width: base };
  }
  if (useTransition) {
    if (p.type === 'prob') road.transitionToProb(game);
    else road.transitionTo(game);
  } else {
    if (p.type === 'prob') road.loadProb(game);
    else road.load(game);
  }
  road.setPlace(p.game.place || '');
  road.setFishingRow(p.game.fishingRow || 0);
  // 过渡加载时暂存新路段的骑行状态：过渡期间保持当前骑行/行走状态，
  // 等旧路段完全滑出后再切换，避免自行车道还没骑到头就提前结束骑行
  if (useTransition) {
    _pendingBike = !!p.game.bike;
  } else {
    _pendingBike = null;
    road.setBike(!!p.game.bike);
    // 骑行音乐：自行车道播放骑行曲，离开后恢复地区曲
    if (road.isBike()) playCycling();
    else endCycling();
  }
  // 刷新页面恢复路段时，若该路段本次循环已钓过则不再强制触发
  onRoadChanged(p.game.fishingRow || 0, { fished: !!saved?.fished });
  road.resetScroll();
  _roadCycleStart = 0;
}

// 过渡中新道路滑到角色脚下即切换骑行/行走，自行车道骑到头才下车
road.onTransitionCharReach(() => {
  if (_pendingBike === null) return;
  road.setBike(_pendingBike);
  _pendingBike = null;
  if (road.isBike()) playCycling();
  else endCycling();
  setIdleCharacter('walk');
});

// 依次按 水域/自行车道 → 普通陆地 抽取下一段路：
// ROAD_SPECIAL_CHANCE 概率出特殊路段，其中水域与自行车道对半开，
// 目标子池为空时换另一个子池，两个都空则退回普通陆地
function _pickNextRoad() {
  let pool = ROAD_LAND;
  if (ROAD_WATER.length + ROAD_BIKE.length > 0 && Math.random() < ROAD_SPECIAL_CHANCE) {
    const preferWater = Math.random() < 0.5;
    pool = preferWater
      ? (ROAD_WATER.length > 0 ? ROAD_WATER : ROAD_BIKE)
      : (ROAD_BIKE.length > 0 ? ROAD_BIKE : ROAD_WATER);
  }
  if (pool.length === 0) pool = ROAD_PRESETS.map((_, i) => i); // 目标池为空时退回全量
  if (pool.length === 1) return pool[0];
  let next;
  do { next = pool[Math.floor(Math.random() * pool.length)]; } while (next === _roadIdx);
  return next;
}

// ---------- 返回按钮 ----------
function goBack() {
  // 详情页跳转图鉴（第 4 层子页）：返回先回详情页，再按详情返回逻辑走
  if (isRosterDetailJumpedToPokedex()) { returnRosterDetailFromPokedex(); return; }
  if (_pokedexInLogView) { restorePokedex(); return; }
  if (isRosterInDetail()) {
    if (isRosterDetailFromList()) { leaveRosterDetailToList(); }
    else if (isRosterDetailFromObtain()) { leaveRosterDetailToSource(); }
    else { restoreRosterList(); }
    return;
  }
  if (isTradeInDetail()) { restoreTradeList(); return; }
  // 悬赏提交列表：标题栏返回先回悬赏列表
  if (isBountyInTrade()) { restoreBountyList(); return; }
  const target = _prevView;
  showView(target);
  setPrevView('idleView');
  // 返回手机主页时兜底同步红点（showView 不重建页面，避免漏刷新）
  if (target === 'phoneView') { updateTradeBadge(); updateBerryBadge(); updatePhoneBadge(); }
}

// ---------- 背包点击 ----------
function onBagClick(itemKey) {
  if (phase === 'encounter') {
    // 自动捕捉开启但勾选球种均无库存（自动逃跑中）：禁止手动丢球，与状态栏【自动逃跑中】判定一致
    if (gameData.settings?.autoCatch) {
      const balls = gameData.settings?.autoCatchBalls || {};
      const hasStock = ['poke-ball', 'ultra-ball', 'master-ball'].some(b => balls[b] !== false && (gameData.items[b] || 0) > 0);
      if (!hasStock) return;
    }
    if (CATCH_RATES[itemKey] && (gameData.items[itemKey]||0) > 0) {
      pauseAutoFleeTimer();
      throwBall(itemKey);
    }
    return;
  }
  if (phase !== 'idle') return;
  // 钓鱼中禁止使用 buff 道具（会与暂停的道路/角色状态冲突）
  if (_fishing && (itemKey === 'sweet-honey' || itemKey === 'shiny-charm')) return;
  if (itemKey === 'sweet-honey') { activateHoney(); }
  else if (itemKey === 'shiny-charm') {
    if (honeyBuffActive) return;
    activateShinyCharm();
  }
}

// ---------- 游戏 Tick ----------
function onGameTick() {
  if (window.__introActive) return; // 开场剧情期间不推进挂机
  setGameTick(gameTick + 1);
  gameData.stats.totalPlaySeconds++;
  addPlaySeconds(gameData, 1); // 今日挂机时长（跨天自动清零重计）
  // 招募帮手：在线秒数递减（离线不递减，天然离线暂停），到期终止并刷新农场页
  helperTick();
  // 同步真实行走距离：仅 idle 挂机时道路在滚动，遇敌/战斗/钓鱼不计
  const walked = road.takeDistance();
  if (walked > 0) {
    gameData.stats.walkDistance = (gameData.stats.walkDistance || 0) + walked;
    // 导航由主角实际移动推进（跑步更快）
    gpsAddDistance(walked, road.getSpeed() * 60);
  }

  const region = getCurrentRegion();
  if (region.id !== _lastRegionId) {
    setLastRegionId(region.id);
    addSystemLog('region_change', { region: region.name });
    playRegion(region.name); // 跨越地区边界 → 切换对应地区歌单
  }

  // 地区悬赏：跨过 0 点自动刷新（日期变化时重新生成，当天保持不变）
  ensureBounty();

  if (phase !== 'idle') { updateStats(); return; }

  // 过渡完成：应用新路段的骑行状态（骑行/行走与骑行音乐一起切换）
  if (_pendingBike !== null && !road.isTransitioning()) {
    road.setBike(_pendingBike);
    _pendingBike = null;
    if (road.isBike()) playCycling();
    else endCycling();
    setIdleCharacter('walk');
  }

  // 道路轮播：每 ROAD_SWITCH_CYCLES 个完整循环切下一个（过渡中/钓鱼中不切）
  if (!road.isTransitioning() && !_fishing) {
    const cyc = road.getCycles();
    if (cyc >= ROAD_SWITCH_CYCLES && _roadCycleStart < cyc) {
      if (ROAD_PRESETS.length > 1) {
        _roadIdx = _pickNextRoad();
        _roadCycleStart = cyc;
        loadRoad(_roadIdx, true);
        setIdleCharacter('walk');
      } else {
        // 只有一个预设时无法切换，重置计数避免 do/while 死循环卡死
        _roadCycleStart = cyc;
      }
    }
  }

  // 钓鱼：有垂钓点的路段随机停下钓鱼（钓鱼期间不生成道路道具；自行车道上不钓鱼不拾取，
  // 过渡到自行车道期间也停止生成，避免遗留道具在骑行开始后滑过）
  if (!road.isBike()) tryStartFishing();
  if (!_fishing && !road.isBike() && _pendingBike !== true) {
    for (const [item, rate] of Object.entries(ITEM_RATES)) {
      const key = `_f_${item}`;
      if (!gameData[key]) gameData[key] = 0;
      gameData[key] += rate;
      const gained = Math.floor(gameData[key]);
      if (gained > 0) {
        gameData[key] -= gained;
        for (let i = 0; i < gained; i++) {
          spawnItemDrop(item);
        }
      }
    }
  }

  if (gameTick % 5 === 0) { updateBackpack(); updateStats(); }

  // 孵蛋器状态检查（每 tick，先检查再渲染）
  let incubatorChanged = false;
  for (const s of (gameData.incubators || [])) {
    if (s && s.eggIndex != null && !s.hatched) {
      const used = (gameData.stats?.walkDistance || 0) - s.hatchStart;
      // 检查里程达标（加 100px 容差）+ hatchStart 无效（NaN/负值）兜底
      if (isNaN(used) || used < 0 || (used + 100) >= s.hatchDuration) {
        s.hatched = true;
        incubatorChanged = true;
      }
    }
  }
  if (incubatorChanged) {
    updateIncubatorBadge();
    updatePhoneBadge(); // 孵蛋完成也同步手机图标红点
    if ($('incubatorView')?.style.display === 'flex') renderIncubatorView();
  }

  // 孵蛋器里程刷新（每 tick）：轻量更新进度条与剩余里程，不重建 DOM，
  // 避免每秒整页重建导致按钮点击在重建瞬间丢失（要点两下才有反应）
  if ($('incubatorView')?.style.display === 'flex') {
    updateIncubatorTimers();
  }
  // badge 同步
  if (gameTick % 5 === 0) {
    updateIncubatorBadge();
    updateTradeBadge();
    updateBerryBadge();
    updateBountyBadge();
    updatePhoneBadge();
  }
}

// ---------- 开场剧情静音开关（顶栏按钮，仅开场显示） ----------
function syncIntroMuteIcon() {
  const btn = document.getElementById('btnIntroMute');
  const on = document.getElementById('introMuteIconOn');
  const off = document.getElementById('introMuteIconOff');
  const muted = isMuted();
  if (on) on.style.display = muted ? 'none' : '';
  if (off) off.style.display = muted ? '' : 'none';
  if (btn) { btn.title = muted ? '取消静音' : '静音'; btn.setAttribute('aria-label', btn.title); }
}

function onIntroMuteClick() {
  const muted = !isMuted();
  setMuted(muted);
  if (!gameData.settings) gameData.settings = {};
  gameData.settings.muted = muted;
  saveGame();
  syncIntroMuteIcon();
  // 玩家点击过静音开关：引导文案不再显示
  const hint = document.getElementById('introMuteHint');
  if (hint) hint.style.display = 'none';
}

// ---------- 初始化 ----------
async function init() {
  try { await window.__TAURI__?.core?.invoke('mark_show'); } catch (_) {}

  // 系统托盘走路动画（异步加载，失败不影响主流程）
  import('./tray.js').then(m => m.startTrayAnimation()).catch(() => {});

  // 加载宝可梦数据
  try {
    const resp = await fetch('./pokemon-data/pokedex.json');
    setAllPokemon(await resp.json());
  } catch (e) {
    console.error('加载数据失败');
    return;
  }

  // 加载存档（localStorage 与 Tauri 文件取较新者）
  let gameDataRaw = null;
  try {
    const candidates = [];
    if (window.__TAURI__?.core?.invoke) {
      const raw = await window.__TAURI__.core.invoke('load_game_data');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.items) candidates.push(parsed);
      }
    }
    const local = localStorage.getItem('pokemon_idle_save');
    if (local) {
      const parsed = JSON.parse(local);
      if (parsed && parsed.items) candidates.push(parsed);
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => (b.stats?.lastSaveTime || 0) - (a.stats?.lastSaveTime || 0));
      gameDataRaw = candidates[0];
    }
  } catch (_) {}
  setGameData(gameDataRaw || getDefaultSave());
  ensureGpsState(); // 初始化 GPS 状态（默认从丰缘出发）
  initAudio(gameData.settings?.musicVolume ?? 0.6); // 背景音乐：读取存档音量并初始化
  setMuted(!!gameData.settings?.muted); // 开场静音开关：沿用上次状态
  setMusicEnabled(gameData.settings?.musicEnabled !== false); // 音乐开关：沿用上次状态
  setBattleMusic(gameData.settings?.battleMusic !== false); // 战斗音乐开关：沿用上次状态
  ensureBounty();   // 生成/恢复当日地区悬赏
  updateBountyBadge(); // 初始化标题栏悬赏红点
  updatePhoneBadge(); // 初始化标题栏手机聚合红点

  setLastRegionId(getCurrentRegion().id);
  await saveGame();

  // 调试辅助：DevTools 控制台快速增加糖果
  window.__addCandy = (n = 1000) => {
    const amount = Number(n) || 1000;
    gameData.items['candy'] = (gameData.items['candy'] || 0) + amount;
    gameData.stats.totalItemsEarned = gameData.stats.totalItemsEarned || {};
    gameData.stats.totalItemsEarned.candy = (gameData.stats.totalItemsEarned.candy || 0) + amount;
    saveGame();
    updateBackpack('candy');
    updateStats();
    console.log('糖果 +' + amount);
  };

  // 调试辅助：DevTools 控制台快速完成所有孵蛋
  window.__completeAllEggs = () => {
    gameData.incubators.forEach(s => {
      if (s && s.eggIndex != null && !s.hatched) {
        s.hatched = true;
      }
    });
    saveGame();
    if ($('incubatorView')?.style.display === 'flex') renderIncubatorView();
    updateIncubatorBadge();
    console.log('所有孵蛋中的蛋已标记为孵化完成');
  };

  // 调试辅助：DevTools 控制台一键让树果农场所有已种植地块成熟（window.__matureBerries()）
  window.__matureBerries = () => {
    const f = gameData.berryFarm;
    if (!f || !Array.isArray(f.plots)) { console.warn('__matureBerries: 尚未开启树果农场'); return; }
    let n = 0;
    f.plots.forEach(p => {
      if (!p) return;
      p.grownMs = p.totalMs || 30 * 60 * 1000; // 生长进度直接拉满，进入「可收获」
      n++;
    });
    if (!n) { console.warn('__matureBerries: 农场没有已种植的树果'); return; }
    saveGame();
    refreshBerryView();
    console.log(`__matureBerries: ${n} 棵树果已成熟，可以收获了`);
  };

  // 调试辅助：DevTools 控制台清空当前 GPS 状态，恢复为默认丰缘
  window.__resetGps = async () => {
    gameData.gps = defaultGpsState();
    ensureGpsState();
    setLastRegionId(getCurrentRegion().id);
    await saveGame();
    updateStats();
    if ($('gpsView')?.style.display === 'flex') showGpsView();
    console.log('GPS 已重置为默认丰缘');
  };

  // 调试：按宝可梦编号直接写入一只 6V 孵蛋宝可梦（如 window.__addPoke(25) 写入皮卡丘）
  // __addShinyPoke 相同，但为蛋闪
  async function addDebugPoke(idx, shiny) {
    const poke = getPokemonByIndex(String(idx).padStart(4, '0'));
    if (!poke) { console.warn(`__addPoke: 未找到编号 ${idx}`); return null; }
    const entry = addRosterEntry({ species: poke.index, source: 'egg', shiny });
    if (entry) entry.ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
    // 同步解锁图鉴（与孵蛋流程一致）
    const pdx = String(poke.index);
    if (!gameData.pokedex[pdx]) {
      gameData.pokedex[pdx] = { seen: 0, caught: 0, lastTime: null, shinySeen: 0, shinyCaught: 0 };
    }
    gameData.pokedex[pdx].seen++;
    gameData.pokedex[pdx].caught = (gameData.pokedex[pdx].caught || 0) + 1;
    gameData.pokedex[pdx].lastTime = new Date().toISOString();
    if (shiny) {
      gameData.pokedex[pdx].shinyCaught = (gameData.pokedex[pdx].shinyCaught || 0) + 1;
      gameData.stats.totalShinyCaught++;
      gameData.stats.totalShinyEggsHatched++;
    }
    gameData.stats.totalCatches++;
    gameData.stats.totalEggsHatched++;
    // 配套写一条「孵蛋获得」遭遇日志，详情页的日志行才有内容
    if (!gameData.encounterLogs) gameData.encounterLogs = {};
    if (!gameData.encounterLogs[poke.index]) gameData.encounterLogs[poke.index] = [];
    gameData.encounterLogs[poke.index].push({
      time: Date.now(),
      shiny,
      result: 'caught',
      balls: {},
      charmBuff: false,
      score: computeObtainScore({ pokemon: poke, source: 'egg', shiny, charmBuff: false, honeyBuff: false, balls: {}, finalRate: 1 }),
    });
    await saveGame();
    if (isRosterInDetail()) restoreRosterList();
    else if ($('rosterView')?.style.display === 'flex') showRosterView();
    console.log(`__addPoke: 已添加 6V ${shiny ? '闪光 ' : ''}${poke.name}（${shiny ? '蛋闪' : '孵蛋'}）`);
    return entry;
  }
  window.__addPoke = idx => addDebugPoke(idx, false);
  window.__addShinyPoke = idx => addDebugPoke(idx, true);

  // 固定窗口
  if (gameData.settings?.windowPinned) {
    try {
      const tw = window.__TAURI__?.window;
      if (tw?.getCurrentWindow) tw.getCurrentWindow().setAlwaysOnTop(true);
      else if (tw?.appWindow?.setAlwaysOnTop) tw.appWindow.setAlwaysOnTop(true);
    } catch (_) {}
  }

  // 离线处理：仅推进 0 点刷新的内容（今日时长/告示牌），孵蛋、树果、交换广场暂停
  if (calcOffline(gameData) > 0) await saveGame();

  // 加载道路预设数据
  try {
    ROAD_PRESETS = await (await fetch('./road-data.json')).json();
  } catch (e) {
    console.error('加载道路数据失败', e);
    ROAD_PRESETS = [];
  }
  // 构建 自行车道/水域/普通陆地 三个池子（自行车道优先，其次有垂钓点的水域）
  ROAD_LAND = [];
  ROAD_WATER = [];
  ROAD_BIKE = [];
  ROAD_PRESETS.forEach((p, i) => {
    if (p.game && p.game.bike) ROAD_BIKE.push(i);
    else if (p.game && p.game.fishingRow) ROAD_WATER.push(i);
    else ROAD_LAND.push(i);
  });

  // 加载路面数据：新存档固定第一段路（草地预设），老存档恢复上次道路
  let savedRoad = null;
  if (gameDataRaw) {
    try {
      const saved = localStorage.getItem('pokemon_idle_road');
      if (saved) {
        savedRoad = JSON.parse(saved);
        if (savedRoad && typeof savedRoad.roadIdx === 'number' && savedRoad.roadIdx < ROAD_PRESETS.length) {
          _roadIdx = savedRoad.roadIdx;
          _roadCycleStart = 0;
        }
      }
    } catch (_) {}
  }
  loadRoad(_roadIdx, false, savedRoad);

  // 界面
  updateBackpack();
  updateStats();
  applyCharSprites();

  // 旧存档无 introDone 字段 → 视为已完成开场，跳过剧情
  if (gameData.introDone === undefined) gameData.introDone = true;

  // 首次进入：先播开场剧情（选角色 → 与小田卷碰面 → 确认开始），完成前不启动挂机，中途退出需重来
  if (gameData.introDone !== true) {
    // 剧情期间隐藏底部背包/统计栏与顶部应用按钮（纯剧情画面）；最小化/关闭保持可用
    document.body.classList.add('boot-no-ui');
    window.__introActive = true;
    // 开场剧情顶栏静音开关（仅开场显示，位于最小化按钮左侧）
    syncIntroMuteIcon();
    const muteBtn = document.getElementById('btnIntroMute');
    if (muteBtn) {
      muteBtn.style.display = 'flex';
      muteBtn.addEventListener('click', onIntroMuteClick);
    }
    // 静音引导文案：与按钮一同显示在左侧，点击静音后消失
    const muteHint = document.getElementById('introMuteHint');
    if (muteHint) muteHint.style.display = 'flex';
    startIntro(() => {
      window.__introActive = false;
      gameData.introDone = true;
      // 开场结束：静音开关与引导文案随开场一起隐藏
      const btn = document.getElementById('btnIntroMute');
      if (btn) btn.style.display = 'none';
      const hint = document.getElementById('introMuteHint');
      if (hint) hint.style.display = 'none';
      // 底部背包/统计栏与顶部按钮的恢复由 startSplashDrop 统一处理（splash 显示后淡入，避免闪现）
      // 首次 splash（开场剧情结束后的首个开机动画）不静音：未白镇开场曲顺势延续
      saveGame().then(() => { beginGameplay(); startSplashDrop(null, false); });
    });
  } else {
    beginGameplay();
    startSplashDrop(() => playRegion(getCurrentRegion().name));
  }

  // 主游戏流程：显示挂机界面、恢复会话、启动循环与遇敌调度
  // 背景音乐在 splash 落位动画结束后统一启动（startSplashDrop 的 onDone 回调），避免音乐盖过开机动画
  function beginGameplay() {
    // 开场已结束，恢复标题栏按钮（开场期间保持禁用防止切走）
    const controls = document.querySelector('.window-controls');
    if (controls) controls.classList.remove('controls-disabled');

    startIdleRotation();
    showView('idleView');
    road.start();

    // 恢复会话状态
    const sessionState = restoreSessionState();
    if (sessionState) {
    const willEncounter = sessionState.phase === 'encounter' && sessionState.encounter;

    // 恢复 Buff 状态（遇敌中不启动倒计时）
    if (sessionState.honeyBuffActive) {
      if (!willEncounter && sessionState.honeyRemaining > 0) {
        setHoneyBuffActive(true);
        setHoneyCountdownEnd(Date.now() + sessionState.honeyRemaining);
        if ($('idleView').style.display !== 'none') {
          $('idleText').textContent = '✦ 甜蜜蜜生效中 ✦';
          setIdleMsgIdx(-1);
          particles.stop();
          particles.start('rgba(255,215,0,1)', 'circle', { sizeMult: 0.7, alphaMult: 0.6 });
          startHoneyCountdown();
        }
      } else if (sessionState.honeyPausedRemaining > 0) {
        setHoneyBuffActive(true);
        setHoneyPausedRemaining(sessionState.honeyPausedRemaining);
        particles.stop();
        particles.start('rgba(255,215,0,1)', 'circle', { sizeMult: 0.7, alphaMult: 0.6 });
        // 恢复视觉 UI（即使遇敌中，以便战后恢复）
        $('idleText').textContent = '✦ 甜蜜蜜生效中 ✦';
        setIdleMsgIdx(-1);
        // 背包显示暂停的剩余秒数 + 遮罩
        const slotH = document.querySelector('.bag-slot[data-item="sweet-honey"]');
        if (slotH) slotH.classList.add('disabled');
        const qtyEl = document.getElementById('bag-sweet-honey');
        if (qtyEl) qtyEl.textContent = Math.ceil(sessionState.honeyPausedRemaining / 1000) + 's';
      } else {
        // 无效状态：buff 标记残留但无剩余时间 → 清除
        setHoneyBuffActive(false);
        clearHoneyCountdown();
      }
    }
    if (sessionState.charmBuffActive) {
      if (!willEncounter && sessionState.charmRemaining > 0) {
        setCharmBuffActive(true);
        setCharmCountdownEnd(Date.now() + sessionState.charmRemaining);
        if ($('idleView').style.display !== 'none') {
          $('idleText').textContent = '✦ 闪耀护符生效中 ✦';
          setIdleMsgIdx(-1);
          particles.stop();
          particles.start('rgba(180,230,255,1)', 'star');
          startCharmCountdown();
        }
      } else if (sessionState.charmPausedRemaining > 0) {
        setCharmBuffActive(true);
        setCharmPausedRemaining(sessionState.charmPausedRemaining);
        particles.stop();
        particles.start('rgba(180,230,255,1)', 'star');
        $('idleText').textContent = '✦ 闪耀护符生效中 ✦';
        setIdleMsgIdx(-1);
        // 背包显示暂停的剩余秒数 + 遮罩
        const slotC = document.querySelector('.bag-slot[data-item="shiny-charm"]');
        if (slotC) slotC.classList.add('disabled');
        const qtyEl = document.getElementById('bag-shiny-charm');
        if (qtyEl) qtyEl.textContent = Math.ceil(sessionState.charmPausedRemaining / 1000) + 's';
      } else {
        // 无效状态：buff 标记残留但无剩余时间 → 清除
        setCharmBuffActive(false);
        clearCharmCountdown();
      }
    }
    if (sessionState._charmEncounterCount) setCharmEncounterCount(sessionState._charmEncounterCount);

    // 恢复树果方块（混合器冷却）：按里程判定（主角再走满 BLOCK_DISTANCE 米失效），重新挂上里程轮询
    if (sessionState.blockBuffActive) {
      if (typeof sessionState.blockStartWalk === 'number') {
        setBlockBuffActive(true);
        setBlockRecipe(sessionState.blockRecipe || []);
        setBlockStartWalk(sessionState.blockStartWalk);
        setBlockQuality(sessionState.blockQuality);
        syncBlockVisual();
        startBlockCountdown();
        if ($('idleView').style.display !== 'none') {
          $('idleText').textContent = '✦ 树果方块已摆放在路旁 ✦';
          setIdleMsgIdx(-1);
        }
      } else {
        setBlockBuffActive(false);
        clearBlockCountdown();
      }
    }

    // 恢复树果混合 QTE 进行中状态：重连后直接接着进度玩（不给重置机会）
    if (sessionState.qteState) setQteState(sessionState.qteState);

    // 恢复角色动画（走/跑取决于 buff 状态）
    setIdleCharacter('walk');

    // 恢复战斗状态
    if (sessionState.phase === 'encounter' && sessionState.encounter) {
      const poke = getPokemonByIndex(sessionState.encounter.index);
      if (poke) {
        setCurrentEncounter(poke);
        setCurrentIsShiny(!!sessionState.encounter.isShiny);
        setEncounterBallsUsed(sessionState.encounter.ballsUsed || 0);
        setCurrentEncounterBalls(sessionState.encounter.balls || { 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 });
        // 球已从背包扣除（存档已保存），不重复回退；currentEncounterBalls 保留原值以便捕获日志完整记录
        setPhase('encounter');
        // 恢复自定义遭遇文案（如钓鱼"上钩了"），避免刷新后退化为默认"跳出来了"
        setEncounterMsg(sessionState.encounter.msg || null);
        // 不跳过自动操作：恢复遭遇后，自动捕捉/佛系模式由 showEncounter 统一接管
        showEncounter(poke);
        // 启动即遭遇：splash 后 playRegion 被覆盖曲压住不弹歌曲卡，等这场遭遇结束再补弹
        setShowCardOnEncounterEnd(true);
      }
    }
  }
  // 孵化器 badge 初始同步（无 session 时也要同步，数据在 gameData 持久存档中）
  updateIncubatorBadge();
  updatePhoneBadge(); // 手机图标聚合红点（孵蛋/交换/树果）

  // 启动循环与遇敌调度（开场期间 onGameTick 已被 gate 拦截，此处仅正常启动一次）
  setInterval(onGameTick, 1000);
  setInterval(() => saveGame(), SAVE_INTERVAL * 1000);

  setTimeout(() => {
    // 当前处于未钓过的垂钓路段时，不预排遇敌：让钓鱼流程先走（钓完/进战斗后由钓鱼逻辑统一调度）
    if (allPokemon.length > 0 && !(road.getFishingRow() && !getFishingGuarantee().fished)) scheduleNextEncounter(5000);
  }, 2000);
  }

  // 事件绑定 — 背包槽
  document.querySelectorAll('.bag-slot').forEach(slot => {
    const item = slot.dataset.item;
    if (item) slot.addEventListener('click', () => onBagClick(item));
  });

  // 文字框箭头
  const textBoxArrow = $('textBoxArrow');
  if (textBoxArrow) {
    textBoxArrow.addEventListener('click', () => {
      // 开场剧情中：箭头推进台词
      if (window.__introActive) { advanceIntro(); return; }
      // 手动捕获（自动捕捉未实际接管，如闪光暂停转手动）→ 询问是否查看仓库详情
      if (phase === 'caught' && !_autoCatching) {
        $('textBoxArrow').style.display = 'none';
        $('textBoxContent').textContent = '是否查看该宝可梦的详情？';
        $('catchConfirmBtns').style.display = 'flex';
      } else if (phase === 'eggResult') {
        // 孵蛋成功（精简显示）→ 询问是否查看仓库详情
        $('textBoxArrow').style.display = 'none';
        $('textBoxContent').textContent = '是否查看该宝可梦的详情？';
        $('catchConfirmBtns').style.display = 'flex';
      } else {
        setCatchConfirmStep(false);
        goIdle();
      }
    });
  }

  // 捕捉/孵蛋确认（查看仓库个体详情，非图鉴）
  $('confirmYes')?.addEventListener('click', () => {
    // 开场剧情中：点击确定开始游戏
    if (window.__introActive) { confirmIntro(); return; }
    stopVictory(); // 交互完图鉴对话框 → 停止胜利音效
    $('catchConfirmBtns').style.display = 'none';
    setCatchConfirmStep(false);
    const entryId = getLastObtainedEntryId();
    goIdle();
    if (entryId) {
      import('./roster.js').then(m => m.showRosterDetailById(entryId, 'idleView'));
    }
  });
  $('confirmNo')?.addEventListener('click', () => {
    stopVictory(); // 交互完图鉴对话框 → 停止胜利音效
    $('catchConfirmBtns').style.display = 'none';
    setCatchConfirmStep(false);
    goIdle();
  });

  // 逃跑
  $('fleeBtn')?.addEventListener('click', () => fleeEncounter(false));

  // 导航按钮
  // header 图标：当前页面体系内（图标高亮）再次点击 → 直接返回首页挂机页；否则打开对应页面
  const bindHeaderIcon = (btn, open) => {
    btn?.addEventListener('click', () => {
      if (btn.classList.contains('active')) {
        setPrevView('idleView');
        showView('idleView');
      } else {
        open();
      }
    });
  };
  bindHeaderIcon($('btnPhone'), showPhoneView);
  bindHeaderIcon($('btnShop'), showShopView);
  bindHeaderIcon($('btnSettings'), showSettingsView);
  bindHeaderIcon($('btnStation'), () => import('./bounty.js').then(m => m.showBountyView()));

  // 状态栏点击：糖果→商店，当前位置→导航
  $('statProgress')?.addEventListener('click', showShopView);
  // 右下角状态栏：点击进入导航，返回回主界面
  $('statTime')?.addEventListener('click', () => {
    setPrevView(phase === 'encounter' ? 'encounterView' : 'idleView');
    showGpsView();
  });
  $('appTitle')?.addEventListener('click', () => {
    if ($('appTitle').dataset.action === 'back') goBack();
  });

  // 图鉴搜索
  setupPokedexSearch();
  // 地区筛选
  setupRegionDropdown();
  // 糖果弹窗
  document.querySelectorAll('.candy-opt').forEach(el => {
    el.addEventListener('click', () => doCandyExchange(el.dataset.item));
  });
  document.querySelector('.candy-close')?.addEventListener('click', closeCandyDialog);
  document.addEventListener('click', e => {
    const dlg = $('candyDialog');
    if (dlg?.classList.contains('open') && !e.target.closest('.candy-box')) {
      closeCandyDialog();
    }
  });

  // 标题栏拖拽窗口：覆盖 title-bar 全部区域（含 appTitle 与返回图标），排除窗口控制按钮。
  // Tauri 的 data-tauri-drag-region 只对 mousedown 目标自身带属性的元素生效，
  // 子元素（appTitle、SVG 图标）上无法拖拽，故统一在此处理。
  // 拖动超过阈值才启动拖拽，原地点击（如返回按钮）不启动，click 正常触发。
  document.querySelector('.title-bar')?.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest?.('.control-btn')) return;
    const sx = e.screenX, sy = e.screenY;
    const onMove = ev => {
      if (Math.hypot(ev.screenX - sx, ev.screenY - sy) < 4) return;
      cleanup();
      try {
        const tw = window.__TAURI__?.window;
        if (tw?.getCurrentWindow) tw.getCurrentWindow().startDragging();
        else if (tw?.appWindow?.startDragging) tw.appWindow.startDragging();
      } catch (_) {}
    };
    const onUp = () => cleanup();
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // 窗口控制
  document.querySelector('.control-btn.minimize')?.addEventListener('click', async () => {
    try {
      const tw = window.__TAURI__?.window;
      if (tw?.getCurrentWindow) await tw.getCurrentWindow().minimize();
      else if (tw?.appWindow?.minimize) await tw.appWindow.minimize();
    } catch (_) {}
  });
  document.querySelector('.control-btn.close')?.addEventListener('click', async () => {
    await saveGame();
    try {
      const tw = window.__TAURI__?.window;
      if (tw?.getCurrentWindow) await tw.getCurrentWindow().close();
      else if (tw?.appWindow?.close) await tw.appWindow.close();
    } catch (_) {}
  });

  // 页面关闭前保存
  window.addEventListener('beforeunload', () => {
    saveSessionState();
    if (gameData) {
      gameData.stats.lastSaveTime = Date.now();
      try { localStorage.setItem('pokemon_idle_save', JSON.stringify(gameData)); } catch (_) {}
    }
    try { localStorage.setItem('pokemon_idle_road', JSON.stringify({ roadIdx: _roadIdx, fished: getFishingGuarantee().fished })); } catch (_) {}
  });
}

// 启动画面落位：旋转结束后道具依次飞向各自对应的背包槽位/糖果计数
// 偏移值写死（相对环中心，与真实 UI 大致对应：精灵球/糖果在左下角，高级球中左，护符在右）
const SPLASH_DROP = [
  { dx: -200, dy: 240 }, // 精灵球 → 左下角槽位
  { dx: -120, dy: 240 }, // 高级球 → 中左
  { dx: -40,  dy: 240 }, // 大师球
  { dx: 40,   dy: 240 }, // 神秘蛋
  { dx: 120,  dy: 240 }, // 甜甜蜜
  { dx: 200,  dy: 240 }, // 闪耀护符 → 右侧槽位
  { dx: -200, dy: 290 }, // 糖果 → 左下角糖果计数
];

// 开机落位动画：道具环旋转结束后依次飞向背包槽位/糖果计数实际位置，最后一个道具（糖果）落位完成后淡出并回调
// silent=true 时 splash 动画期间禁声（老玩家启动），首次 splash（开场剧情后）silent=false 让开场曲延续
function startSplashDrop(onDone, silent = true) {
  const splash = $('splash');
  const ring = document.getElementById('splashRing');
  const items = [...document.querySelectorAll('.splash-item')];
  const slots = [...document.querySelectorAll('.bag-slot')];
  const candy = document.getElementById('statProgress');
  const autoStatus = document.getElementById('statAutoStatus');
  const timeEl = document.getElementById('statTime');
  if (!splash || !ring || items.length === 0) { onDone?.(); return; }
  if (silent) setSplashLocked(true);
  splash.style.display = 'flex';
  // 启动画面期间禁用标题栏右侧按钮（图鉴/商店/统计/设置/最小化/关闭），动画结束后恢复
  const controls = document.querySelector('.window-controls');
  if (controls) controls.classList.add('controls-disabled');
  // 启动期间背包槽位、糖果计数与底部统计栏先隐藏，道具落位时再依次浮现
  slots.forEach(s => s.classList.add('splash-hidden'));
  if (candy) candy.classList.add('splash-hidden');
  if (autoStatus) autoStatus.classList.add('splash-hidden');
  if (timeEl) timeEl.classList.add('splash-hidden');
  // 开场剧情结束后恢复布局：splash 已显示，此时释放 screen-wrapper 的收缩高度（避免屏幕在 splash 出现前跳回原高度闪现）
  const sw = document.querySelector('.screen-wrapper');
  if (sw) {
    sw.classList.remove('boot-collapse');
    sw.style.flex = '';
    sw.style.height = '';
    sw.style.transition = '';
  }
  // 底部背包/统计栏与顶部按钮统一恢复：splash 已显示且槽位已隐藏，背包栏整体淡入，避免瞬间闪现
  if (document.body.classList.contains('boot-no-ui')) {
    document.body.classList.remove('boot-no-ui');
    const bar = document.querySelector('.backpack-bar');
    if (bar) bar.classList.add('splash-reveal');
  }
  setTimeout(() => {
    ring.style.animation = 'none';
    items.forEach(el => {
      const s = el.classList.contains('splash-item--sm') ? 18 / 22 : 18 / 30;
      el.style.transition = 'transform 0.35s ease';
      el.style.transform = `translate(0, 0) scale(${s})`;
    });
    // 聚拢完成后，按顺序依次飞向写死的落位偏移
    setTimeout(() => {
      items.forEach((el, i) => {
        const t = SPLASH_DROP[i] || { dx: 0, dy: 240 };
        const target = slots[i] || (i === 6 ? candy : null);
        const s = el.classList.contains('splash-item--sm') ? 18 / 22 : 18 / 30;
        el.style.animation = 'none';
        el.style.transition = 'none';
        el.style.opacity = '1';
        void el.offsetHeight;
        el.style.transition = 'transform 0.55s cubic-bezier(0.4, 0, 1, 1), opacity 0.55s ease';
        el.style.transitionDelay = i * 0.12 + 's';
        el.style.transform = `translate(${t.dx}px, ${t.dy}px) scale(${s})`;
        el.style.opacity = '0';
        // 对应背包槽位浮现
        if (target) {
          setTimeout(() => {
            target.classList.remove('splash-hidden');
            target.classList.add(i === 6 ? 'stats-fade' : 'bag-slot--pop');
            // 糖果（左）浮现后，统计栏中（自动状态）、右（挂机时间）按同一 120ms 节奏依次跟随
            if (i === 6) {
              if (autoStatus) {
                setTimeout(() => {
                  autoStatus.classList.remove('splash-hidden');
                  autoStatus.classList.add('stats-fade');
                }, 120);
              }
              if (timeEl) {
                setTimeout(() => {
                  timeEl.classList.remove('splash-hidden');
                  timeEl.classList.add('stats-fade');
                }, 240);
              }
            }
          }, i * 120 + 300);
        }
      });
      setTimeout(() => {
        const splash = $('splash');
        if (splash) {
          splash.classList.add('hide');
          setTimeout(() => {
            splash.remove();
            // 开场剧情期间保持禁用标题栏按钮（防止切走无法返回），开场结束由 beginGameplay 恢复
            if (controls && !window.__introActive) controls.classList.remove('controls-disabled');
            if (silent) setSplashLocked(false);
            onDone?.();
          }, 550);
        } else {
          if (silent) setSplashLocked(false);
          onDone?.();
        }
      }, (items.length - 1) * 120 + 550);
    }, 250);
  }, 1000);
}

document.addEventListener('DOMContentLoaded', init);
