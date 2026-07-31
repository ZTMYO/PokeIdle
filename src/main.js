// ===== 宝可梦挂机 - 入口模块 =====
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
  renderIncubatorView, updateIncubatorBadge,
} from './ui.js';
import { spawnItemDrop, activateHoney, activateShinyCharm,
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

function _randomWidth(base) {
  // 在 base 的 1~2.5 倍间随机，至少 50 格
  const rawMin = Math.max(50, Math.floor(base));
  const rawMax = Math.floor(base * 2.5);
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function loadRoad(idx, useTransition) {
  const p = ROAD_PRESETS[idx];
  // fixed 类型循环 5 次原图案；prob 类型随机宽度
  const game = p.type === 'fixed'
    ? { ...p.game, width: (p.game.tiles[0]?.length || p.game.width) * 5 }
    : { ...p.game, width: _randomWidth(p.game.width) };
  if (useTransition) {
    if (p.type === 'prob') road.transitionToProb(game);
    else road.transitionTo(game);
  } else {
    if (p.type === 'prob') road.loadProb(game);
    else road.load(game);
  }
  road.setPlace(p.game.place || '');
  road.resetScroll();
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
  else if (itemKey === 'mystery-egg') {
    setPrevView('idleView');
    showView('incubatorView');
    renderIncubatorView();
  }
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
    const cyc = road.getCycles();
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

  // 孵蛋器定时刷新倒计时（每 tick）
  if ($('incubatorView')?.style.display === 'flex') {
    renderIncubatorView();
  }
  // badge 同步
  if (gameTick % 5 === 0) updateIncubatorBadge();
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

  // 修复存档：根据遭遇日志重新计算图鉴数据
  fixPokedexFromLogs();

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
  // DevTools: window.__resetSave() → 完全重置存档（内存+存储）
  window.__resetSave = () => {
    setGameData(getDefaultSave());
    localStorage.removeItem('pokemon_idle_save');
    localStorage.removeItem('pokemon_idle_road');
    saveGame().then(() => {
      updateBackpack();
      updateStats();
      console.log('存档已完全重置！请手动删除 Tauri 文件: %APPDATA%\\com.pokemon.idle\\save.json');
    });
  };

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

  // 加载路面数据（优先恢复上次道路，兜底第一预设）
  try {
    const saved = localStorage.getItem('pokemon_idle_road');
    if (saved) {
      const rs = JSON.parse(saved);
      if (rs && typeof rs.roadIdx === 'number' && rs.roadIdx < ROAD_PRESETS.length) {
        _roadIdx = rs.roadIdx;
        _roadCycleStart = 0;
      }
    }
  } catch (_) {}
  loadRoad(_roadIdx);

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
        // 连胜应归零，球已从背包扣除（存档已保存），不重复回退
        // currentEncounterBalls 保留原值以便捕获日志完整记录
        setCatchStreak(0);
        setPhase('encounter');
        showEncounter(poke, true);
        if (gameData.settings?.autoFlee && !gameData.settings?.autoCatch) {
          startAutoFleeTimer();
        }
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
    try { localStorage.setItem('pokemon_idle_road', JSON.stringify({ roadIdx: _roadIdx })); } catch (_) {}
  });

  // 启动循环
  setInterval(onGameTick, 1000);
  setInterval(() => saveGame(), SAVE_INTERVAL * 1000);

  setTimeout(() => {
    if (allPokemon.length > 0) scheduleNextEncounter(5000);
  }, 2000);
}

// 根据遭遇日志重新计算图鉴数据，修复 session 还原导致的多余计数
function fixPokedexFromLogs() {
  if (!gameData || !gameData.pokedex) return;
  const logs = gameData.encounterLogs || {};
  let changed = false;

  for (const [idxStr, entry] of Object.entries(gameData.pokedex)) {
    const entryLogs = logs[idxStr];
    if (!entryLogs || !Array.isArray(entryLogs) || entryLogs.length === 0) {
      if (entry && (entry.seen > 0 || entry.caught > 0)) {
        entry.seen = 0;
        entry.caught = 0;
        entry.shinySeen = 0;
        entry.shinyCaught = 0;
        entry.lastTime = null;
        changed = true;
      }
      continue;
    }

    // 从日志重新统计
    let seen = 0, caught = 0, shinySeen = 0, shinyCaught = 0;
    let lastTime = null;
    for (const log of entryLogs) {
      if (!log || typeof log !== 'object') continue;
      seen++;
      if (log.shiny) shinySeen++;
      if (log.result === 'caught') {
        caught++;
        if (log.shiny) shinyCaught++;
      }
      if (log.time && (!lastTime || log.time > lastTime)) lastTime = log.time;
    }

    if (entry.seen !== seen || entry.caught !== caught ||
        entry.shinySeen !== shinySeen || entry.shinyCaught !== shinyCaught) {
      entry.seen = seen;
      entry.caught = caught;
      entry.shinySeen = shinySeen;
      entry.shinyCaught = shinyCaught;
      entry.lastTime = lastTime ? new Date(lastTime).toISOString() : null;
      changed = true;
    }
  }

  if (changed) {
    saveGame();
    console.log('已根据遭遇日志修复图鉴数据');
  }
}

document.addEventListener('DOMContentLoaded', init);
