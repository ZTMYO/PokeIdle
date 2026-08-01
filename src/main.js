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
  _honeyEncounterCount, _charmEncounterCount,
  _autoFleeTimer, _autoFleeBarInterval,
  _autoCatching,
  _catchConfirmStep, _prevView, _pokedexInLogView, _idleMsgIdx,
  _lastRegionId, gameTick, _fishing,
  setAllPokemon, setGameData, setPhase, setCurrentEncounter,
  setCurrentIsShiny, setEncounterBallsUsed, setCurrentEncounterBalls,
  setGameTick, setPrevView, setLastRegionId,
  setHoneyBuffActive, setHoneyCountdownEnd, setCharmBuffActive, setCharmCountdownEnd,
  setHoneyPausedRemaining, setCharmPausedRemaining,
  setHoneyEncounterCount, setCharmEncounterCount, setIdleMsgIdx, setCatchConfirmStep,
  setBlockBuffActive, setBlockRecipe, setBlockStartWalk, setBlockQuality, setQteState,
  getDefaultSave, saveGame, getPokemonByIndex, ensureGpsState, defaultGpsState,
  restoreSessionState, calcOffline, addSystemLog, getCurrentRegion,
  hasAnyBall, saveSessionState, rand, randInt, formatNum, formatTime,
  setEncounterMsg, addPlaySeconds,
} from './state.js';
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
import { showEncounterLogs, restorePokedex, setupRegionDropdown,
  showPokedex, setupPokedexSearch } from './pokedex.js';
import { showShopView, showSettingsView,
  showTutorialView, renderSystemLogs } from './views.js';
import { showPhoneView } from './phone.js';
import { gpsAddDistance, ensureRoamDest, showGpsView } from './gps.js';
import { ensureBounty } from './bounty.js';
import { debugBerryFarm } from './berry.js';
import * as road from './road.js';
import * as particles from './particles.js';

let ROAD_PRESETS = null;
let ROAD_LAND = [];   // 普通陆地路段池（无垂钓点、非自行车道）
let ROAD_WATER = [];  // 水域路段池（有垂钓点，可钓鱼）
let ROAD_BIKE = [];   // 自行车道路段池（不遇敌、不拾取、快速推进里程）
let _roadIdx = 0;
let _roadCycleStart = 0;

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
  road.setBike(!!p.game.bike);
  // 刷新页面恢复路段时，若该路段本次循环已钓过则不再强制触发
  onRoadChanged(p.game.fishingRow || 0, { fished: !!saved?.fished });
  road.resetScroll();
  _roadCycleStart = 0;
}

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
  if (_pokedexInLogView) { restorePokedex(); return; }
  showView(_prevView);
  setPrevView('idleView');
}

// ---------- 背包点击 ----------
function onBagClick(itemKey) {
  if (phase === 'encounter') {
    // 自动模式下未勾选任何精灵球（自动逃跑）时禁止手动丢球
    if (gameData.settings?.autoCatch) {
      const balls = gameData.settings?.autoCatchBalls || {};
      const hasEnabled = ['poke-ball','ultra-ball','master-ball'].some(b => balls[b] !== false);
      if (!hasEnabled) return;
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
  setGameTick(gameTick + 1);
  gameData.stats.totalPlaySeconds++;
  addPlaySeconds(gameData, 1); // 今日挂机时长（跨天自动清零重计）
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
  }

  // 地区悬赏：跨过 0 点自动刷新（日期变化时重新生成，当天保持不变）
  ensureBounty();

  if (phase !== 'idle') { updateStats(); return; }

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

  // 钓鱼：有垂钓点的路段随机停下钓鱼（钓鱼期间不生成道路道具；自行车道上不钓鱼不拾取）
  if (!road.isBike()) tryStartFishing();
  if (!_fishing && !road.isBike()) {
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
      const elapsed = Date.now() - s.hatchStart;
      // 检查超时（加 100ms 容差）+ hatchedStart 无效（NaN/负值）兜底
      if (isNaN(elapsed) || elapsed < 0 || (elapsed + 100) >= s.hatchDuration) {
        s.hatched = true;
        incubatorChanged = true;
      }
    }
  }
  if (incubatorChanged) {
    updateIncubatorBadge();
    if ($('incubatorView')?.style.display === 'flex') renderIncubatorView();
  }

  // 孵蛋器倒计时刷新（每 tick）：轻量更新进度条与剩余时间，不重建 DOM，
  // 避免每秒整页重建导致按钮点击在重建瞬间丢失（要点两下才有反应）
  if ($('incubatorView')?.style.display === 'flex') {
    updateIncubatorTimers();
  }
  // badge 同步
  if (gameTick % 5 === 0) updateIncubatorBadge();
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
  ensureGpsState(); // 兼容旧存档：补齐 GPS 状态（默认从丰缘出发）
  ensureRoamDest(); // 漫游默认开启且无目的地时，自动开始导航
  ensureBounty();   // 生成/恢复当日地区悬赏

  setLastRegionId(getCurrentRegion().id);
  await saveGame();

  // 调试辅助：DevTools 控制台快速增加糖果
  window.__addCandy = (n = 1000) => {
    const amount = Number(n) || 1000;
    gameData.items['candy'] = (gameData.items['candy'] || 0) + amount;
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

  // 调试辅助：DevTools 控制台清空当前 GPS 状态，恢复为默认丰缘
  window.__resetGps = async () => {
    gameData.gps = defaultGpsState();
    ensureGpsState();
    ensureRoamDest();
    setLastRegionId(getCurrentRegion().id);
    await saveGame();
    updateStats();
    if ($('gpsView')?.style.display === 'flex') showGpsView();
    console.log('GPS 已重置为默认丰缘');
  };

  // 调试辅助：DevTools 控制台操作树果农场（一键成熟 / 重生日需求）
  window.__berryDebug = debugBerryFarm();

  // 固定窗口
  if (gameData.settings?.windowPinned) {
    try {
      const tw = window.__TAURI__?.window;
      if (tw?.getCurrentWindow) tw.getCurrentWindow().setAlwaysOnTop(true);
      else if (tw?.appWindow?.setAlwaysOnTop) tw.appWindow.setAlwaysOnTop(true);
    } catch (_) {}
  }

  // 离线收益
  const off = calcOffline(gameData);
  if (off > 0) {
    $('statProgress').innerHTML = `<img src="./items/candy.png" style="width:14px;height:14px;vertical-align:middle;image-rendering:pixelated;" /> 离线 ${formatTime(off)}`;
  }

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

  // 加载路面数据（优先恢复上次道路，兜底第一预设）
  let savedRoad = null;
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
  loadRoad(_roadIdx, false, savedRoad);

  // 界面
  updateBackpack();
  updateStats();
  applyCharSprites();
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
    if (sessionState._honeyEncounterCount) setHoneyEncounterCount(sessionState._honeyEncounterCount);
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
      }
    }
  }
  // 孵化器 badge 初始同步（无 session 时也要同步，数据在 gameData 持久存档中）
  updateIncubatorBadge();

  // 事件绑定 — 背包槽
  document.querySelectorAll('.bag-slot').forEach(slot => {
    const item = slot.dataset.item;
    if (item) slot.addEventListener('click', () => onBagClick(item));
  });

  // 文字框箭头
  const textBoxArrow = $('textBoxArrow');
  if (textBoxArrow) {
    textBoxArrow.addEventListener('click', () => {
      // 手动捕获（自动捕捉未实际接管，如闪光暂停转手动）→ 询问是否查看图鉴
      if (phase === 'caught' && !_autoCatching) {
        $('textBoxArrow').style.display = 'none';
        $('textBoxContent').textContent = '是否跳转到图鉴？';
        $('catchConfirmBtns').style.display = 'flex';
      } else {
        setCatchConfirmStep(false);
        goIdle();
      }
    });
  }

  // 捕捉确认
  $('confirmYes')?.addEventListener('click', () => {
    $('catchConfirmBtns').style.display = 'none';
    setCatchConfirmStep(false);
    const idx = currentEncounter.index;
    goIdle();
    showEncounterLogs(idx);
    showView('pokedexView');
  });
  $('confirmNo')?.addEventListener('click', () => {
    $('catchConfirmBtns').style.display = 'none';
    setCatchConfirmStep(false);
    goIdle();
  });

  // 逃跑
  $('fleeBtn')?.addEventListener('click', () => fleeEncounter(false));

  // 导航按钮
  $('btnPhone')?.addEventListener('click', showPhoneView);
  $('btnShop')?.addEventListener('click', showShopView);
  $('btnSettings')?.addEventListener('click', showSettingsView);
  $('btnStation')?.addEventListener('click', () => import('./bounty.js').then(m => m.showBountyView()));

  // 状态栏点击：糖果→商店，当前位置→导航
  $('statProgress')?.addEventListener('click', showShopView);
  $('statTime')?.addEventListener('click', showGpsView);
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

  // 启动循环
  setInterval(onGameTick, 1000);
  setInterval(() => saveGame(), SAVE_INTERVAL * 1000);

  setTimeout(() => {
    // 当前处于未钓过的垂钓路段时，不预排遇敌：让钓鱼流程先走（钓完/进战斗后由钓鱼逻辑统一调度）
    if (allPokemon.length > 0 && !(road.getFishingRow() && !getFishingGuarantee().fished)) scheduleNextEncounter(5000);
  }, 2000);

  // 启动画面：旋转结束后图标依次飞向背包槽位/糖果计数实际位置，最后一个道具（糖果）落位完成后自动淡出移除
  startSplashDrop();
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

function startSplashDrop() {
  const ring = document.getElementById('splashRing');
  const items = [...document.querySelectorAll('.splash-item')];
  const slots = [...document.querySelectorAll('.bag-slot')];
  const candy = document.getElementById('statProgress');
  const autoStatus = document.getElementById('statAutoStatus');
  const timeEl = document.getElementById('statTime');
  if (!ring || items.length === 0) return;
  // 启动画面期间禁用标题栏右侧按钮（图鉴/商店/统计/设置/最小化/关闭），动画结束后恢复
  const controls = document.querySelector('.window-controls');
  if (controls) controls.classList.add('controls-disabled');
  // 启动期间背包槽位、糖果计数与底部统计栏先隐藏，道具落位时再依次浮现
  slots.forEach(s => s.classList.add('splash-hidden'));
  if (candy) candy.classList.add('splash-hidden');
  if (autoStatus) autoStatus.classList.add('splash-hidden');
  if (timeEl) timeEl.classList.add('splash-hidden');
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
            // 启动画面结束，恢复标题栏右侧按钮
            if (controls) controls.classList.remove('controls-disabled');
          }, 550);
        }
      }, (items.length - 1) * 120 + 550);
    }, 250);
  }, 1000);
}

document.addEventListener('DOMContentLoaded', init);
