﻿// ===== 宝可梦挂机 - 入口模块 =====
import { CATCH_RATES, SAVE_INTERVAL, ENCOUNTER_MIN, ENCOUNTER_MAX, ITEM_RATES, ITEM_NAMES } from './config.js';
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
  _catchConfirmStep, _prevView, _pokedexInLogView, _idleMsgIdx,
  _lastRegionId, gameTick,
  setAllPokemon, setGameData, setPhase, setCurrentEncounter,
  setCurrentIsShiny, setEncounterBallsUsed, setCurrentEncounterBalls,
  setCatchStreak, setGameTick, setPrevView, setLastRegionId,
  setHoneyBuffActive, setHoneyCountdownEnd, setCharmBuffActive, setCharmCountdownEnd,
  setHoneyPausedRemaining, setCharmPausedRemaining,
  setHoneyEncounterCount, setCharmEncounterCount, setIdleMsgIdx, setCatchConfirmStep,
  getDefaultSave, saveGame, cleanSaveData, ensureGameData,
  restoreSessionState, calcOffline, addSystemLog, getCurrentRegion,
  hasAnyBall, saveSessionState, rand, randInt, formatNum, formatTime,
} from './state.js';
import {
  $, showView, updateTextBox, hideTextBox,
  isOnGameView, applyCharSprites, updateBackpack, updateStats, setIdleCharacter,
} from './ui.js';
import { spawnItemDrop, hatchEggFromBag, activateHoney, activateShinyCharm,
  startHoneyCountdown, startCharmCountdown, clearHoneyCountdown, clearCharmCountdown,
  closeCandyDialog, doCandyExchange } from './items.js';
import { scheduleNextEncounter, throwBall, fleeEncounter, goIdle,
  tryEncounter, startAutoFleeTimer, stopAutoFleeTimer, autoCatch, showEncounter } from './battle.js';
import { startIdleRotation, buildIdleMessages } from './messages.js';
import { showEncounterLogs, restorePokedex, setupRegionDropdown,
  showPokedex, setupPokedexSearch } from './pokedex.js';
import { showDataView, showSystemLogs, showShopView, showSettingsView,
  showTutorialView, renderSystemLogs } from './views.js';
import * as road from './road.js';
import * as particles from './particles.js';

let ROAD_PRESETS = null;
let _roadIdx = 0;
let _roadCycleStart = 0;

function loadRoad(idx, useTransition) {
  const p = ROAD_PRESETS[idx];
  if (useTransition) {
    if (p.type === 'prob') road.transitionToProb(p.game);
    else road.transitionTo(p.game);
  } else {
    if (p.type === 'prob') road.loadProb(p.game);
    else road.load(p.game);
  }
  road.resetCycleCount();
  _roadCycleStart = 0;
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
      stopAutoFleeTimer();
      throwBall(itemKey);
    }
    return;
  }
  if (phase !== 'idle') return;
  if (itemKey === 'sweet-honey') { activateHoney(); }
  else if (itemKey === 'mystery-egg') { hatchEggFromBag(); }
  else if (itemKey === 'shiny-charm') {
    if (honeyBuffActive) return;
    activateShinyCharm();
  }
}

// ---------- 游戏 Tick ----------
function onGameTick() {
  setGameTick(gameTick + 1);
  gameData.stats.totalPlaySeconds++;

  const region = getCurrentRegion();
  if (region.id !== _lastRegionId) {
    setLastRegionId(region.id);
    addSystemLog('region_change', { region: region.name });
  }

  if (phase !== 'idle') { updateStats(); return; }

  // 道路轮播：每 2 个完整循环切下一个（过渡中不切）
  if (!road.isTransitioning()) {
    const cyc = road.getCycleCount();
    if (cyc >= 2 && _roadCycleStart < cyc) {
      let next;
      do { next = Math.floor(Math.random() * ROAD_PRESETS.length); } while (next === _roadIdx);
      _roadIdx = next;
      _roadCycleStart = cyc;
      loadRoad(_roadIdx, true);
      setIdleCharacter('walk');
    }
  }

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

  if (gameTick % 5 === 0) { updateBackpack(); updateStats(); }
}

// ---------- 初始化 ----------
async function init() {
  try { await window.__TAURI__?.core?.invoke('mark_show'); } catch (_) {}

  // 加载宝可梦数据
  try {
    const resp = await fetch('./pokemon-data/pokedex.json');
    setAllPokemon(await resp.json());
  } catch (e) {
    console.error('加载数据失败');
    return;
  }

  // 加载存档
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

  if (gameDataRaw) {
    setGameData(cleanSaveData(ensureGameData(gameDataRaw)));
  } else {
    setGameData(getDefaultSave());
  }

  setLastRegionId(getCurrentRegion().id);
  await saveGame();

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

  // 加载路面数据（第一预设）
  loadRoad(0);

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
          particles.start('rgba(255,215,0,1)');
          startHoneyCountdown();
        }
      } else if (sessionState.honeyPausedRemaining > 0) {
        setHoneyBuffActive(true);
        setHoneyPausedRemaining(sessionState.honeyPausedRemaining);
        particles.stop();
        particles.start('rgba(255,215,0,1)');
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
          particles.start('rgba(160,210,255,0.5)');
          startCharmCountdown();
        }
      } else if (sessionState.charmPausedRemaining > 0) {
        setCharmBuffActive(true);
        setCharmPausedRemaining(sessionState.charmPausedRemaining);
        particles.stop();
        particles.start('rgba(160,210,255,0.5)');
        // 恢复视觉UI（即使遇敌中，以便战后恢复）
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

    // 恢复角色动画（走/跑取决于 buff 状态）
    setIdleCharacter('walk');

    // 恢复战斗状态
    if (sessionState.phase === 'encounter' && sessionState.encounter) {
      const poke = allPokemon.find(p => p.index === sessionState.encounter.index);
      if (poke) {
        setCurrentEncounter(poke);
        setCurrentIsShiny(!!sessionState.encounter.isShiny);
        setEncounterBallsUsed(sessionState.encounter.ballsUsed || 0);
        setCurrentEncounterBalls(sessionState.encounter.balls || { 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 });
        // 球已回退到背包，连胜应归零
        setCatchStreak(0);
        for (const [ball, count] of Object.entries(currentEncounterBalls)) {
          if (count > 0) gameData.items[ball] = (gameData.items[ball] || 0) + count;
        }
        setPhase('encounter');
        showEncounter(poke, true);
        if (gameData.settings?.autoFlee && !gameData.settings?.autoCatch) {
          startAutoFleeTimer();
        }
      }
    }
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
      if (phase === 'caught' && !gameData.settings?.autoCatch) {
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
  $('btnPokedex')?.addEventListener('click', showPokedex);
  $('btnShop')?.addEventListener('click', showShopView);
  $('btnData')?.addEventListener('click', showDataView);
  $('btnSettings')?.addEventListener('click', showSettingsView);

  // 状态栏点击
  $('statProgress')?.addEventListener('click', showShopView);
  $('statTime')?.addEventListener('click', showSystemLogs);
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
  });

  // 启动循环
  setInterval(onGameTick, 1000);
  setInterval(() => saveGame(), SAVE_INTERVAL * 1000);

  setTimeout(() => {
    if (allPokemon.length > 0) scheduleNextEncounter(5000);
  }, 2000);
}

document.addEventListener('DOMContentLoaded', init);
