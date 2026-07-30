import { TYPE_COLORS, BREAK_MSGS, FLEE_CHANCE, ENCOUNTER_MIN, ENCOUNTER_MAX, SHINY_CHANCE, ITEM_NAMES, CATCH_RATES, REGION_DURATION, AUTO_FLEE_TIMEOUT, AUTO_FLEE_NO_BALL_DELAY } from './config.js';
import { phase, gameData, allPokemon, currentEncounter, currentIsShiny, encounterBallsUsed, currentEncounterBalls, _catchStreak, nextEncounterTimer, honeyBuffActive, charmBuffActive, honeyCountdownEnd, charmCountdownEnd, honeyPausedRemaining, charmPausedRemaining, honeyExpiryTimer, charmExpiryTimer, honeyCountdownInterval, charmCountdownInterval, _honeyEncounterCount, _charmEncounterCount, _autoFleeTimer, _autoFleeStartTime, _autoFleeBarInterval, _autoCatching, _throwing, _catchConfirmStep, _lastRegionId, _idleMsgIdx, saveGame, addSystemLog, getCurrentRegion, hasAnyBall, rand, randInt, formatNum, saveSessionState, setPhase, setCurrentEncounter, setCurrentIsShiny, setEncounterBallsUsed, setCurrentEncounterBalls, setCatchStreak, setHoneyBuffActive, setCharmBuffActive, setHoneyEncounterCount, setCharmEncounterCount, setHoneyPausedRemaining, setCharmPausedRemaining, setHoneyCountdownEnd, setCharmCountdownEnd, setNextEncounterTimer, setAutoCatching, setThrowing, setCatchConfirmStep, setAutoFleeTimer, setAutoFleeStartTime, setAutoFleeBarInterval, setHoneyExpiryTimer, setCharmExpiryTimer, setHoneyCountdownInterval, setCharmCountdownInterval } from './state.js';
import { $, showView, updateTextBox, hideTextBox, setIdleCharacter, isOnGameView, updateBackpack, updateStats, tryLoadPokemonImage, fitPokemonImage } from './ui.js';
import { pickRandomPokemon, pickWeightedPokemon, activateHoney, activateShinyCharm, clearCharmCountdown, clearHoneyCountdown, startCharmCountdown, startHoneyCountdown } from './items.js';
import { delay, playCatchSequence, playShinySparkle } from './animation.js';
import { startIdleRotation } from './messages.js';
import * as road from './road.js';
import * as particles from './particles.js';

// ===== 遇敌调度 =====
export function scheduleNextEncounter(delay) {
  if (nextEncounterTimer) clearTimeout(nextEncounterTimer);
  if (phase !== 'idle') return;
  let d = delay || rand(ENCOUNTER_MIN, ENCOUNTER_MAX) * 1000;
  setNextEncounterTimer(setTimeout(tryEncounter, d));
}

// ===== 遇敌 =====
export async function tryEncounter() {
  if (phase !== 'idle') return;

  // 无精灵球时不触发遇敌（自动操作模式例外，由自动逻辑处理逃跑）
  if (!gameData.settings?.autoCatch && !hasAnyBall()) {
    scheduleNextEncounter(rand(ENCOUNTER_MIN, ENCOUNTER_MAX) * 1000);
    return;
  }

  let poke;
  
  // 闪耀护符倒计时暂停
  if (charmBuffActive && charmCountdownEnd > Date.now()) {
    setCharmPausedRemaining(charmCountdownEnd - Date.now());
    setCharmCountdownEnd(0);
    if (charmCountdownInterval) { clearInterval(charmCountdownInterval); setCharmCountdownInterval(null); }
    if (charmExpiryTimer) { clearTimeout(charmExpiryTimer); setCharmExpiryTimer(null); }
    if (nextEncounterTimer) { clearTimeout(nextEncounterTimer); setNextEncounterTimer(null); }
  } else if (charmCountdownEnd > 0 && charmCountdownEnd <= Date.now()) {
    setCharmBuffActive(false);
    setCharmCountdownEnd(0);
    clearCharmCountdown();
  }

  // 甜甜蜜倒计时暂停（保留显示不清除遮罩）
  if (honeyBuffActive && honeyCountdownEnd > Date.now()) {
    setHoneyPausedRemaining(honeyCountdownEnd - Date.now());
    setHoneyCountdownEnd(0);
    if (honeyCountdownInterval) { clearInterval(honeyCountdownInterval); setHoneyCountdownInterval(null); }
    if (honeyExpiryTimer) { clearTimeout(honeyExpiryTimer); setHoneyExpiryTimer(null); }
    if (nextEncounterTimer) { clearTimeout(nextEncounterTimer); setNextEncounterTimer(null); }
  } else if (honeyCountdownEnd > 0 && honeyCountdownEnd <= Date.now()) {
    setHoneyBuffActive(false);
    setHoneyCountdownEnd(0);
    clearHoneyCountdown();
  }

  setPhase('encounter');
  setEncounterBallsUsed(0);
  setCatchStreak(0);

  // 选择宝可梦：确保 poke 和 currentEncounter 始终指向同一对象
  const regionPool = allPokemon.filter(p => p.region === getCurrentRegion().name);
  if (charmBuffActive && regionPool.length > 0) {
    const roll = Math.random();
    if (roll < 0.8) {
      // 80%: 任意精灵 + 闪光（权重选择，倾向稀有）
      poke = pickWeightedPokemon(0.7, regionPool);
      setCurrentEncounter(poke);
      setCurrentIsShiny(true);
    } else {
      // 20%: 未捕获精灵（非闪光，仅限当前地区）
      const uncaught = regionPool.filter(p => {
        const e = gameData.pokedex[String(p.index)];
        return !e || (e.caught || 0) === 0;
      });
      if (uncaught.length > 0) {
        poke = uncaught[randInt(0, uncaught.length - 1)];
      } else {
        poke = pickWeightedPokemon(0.7, regionPool);
      }
      setCurrentEncounter(poke);
      setCurrentIsShiny(false);
    }
  } else {
    poke = pickRandomPokemon();
    if (!poke) { updateStats(); return; }
    setCurrentEncounter(poke);
    setCurrentIsShiny(Math.random() < SHINY_CHANCE);
  }
  setCurrentEncounterBalls({ 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 });
  if (honeyBuffActive) setHoneyEncounterCount(_honeyEncounterCount + 1);
  if (charmBuffActive) setCharmEncounterCount(_charmEncounterCount + 1);

  // 更新图鉴遭遇统计
  const idx = String(poke.index);
  if (!gameData.pokedex[idx]) {
    gameData.pokedex[idx] = {
      name: poke.name, seen: 0, caught: 0,
      lastTime: null, shinySeen: 0, shinyCaught: 0,
    };
  }
  gameData.pokedex[idx].seen++;
  gameData.pokedex[idx].lastTime = new Date().toISOString();
  if (currentIsShiny) {
    gameData.pokedex[idx].shinySeen++;
    gameData.stats.totalShinySeen++;
  }

  addSystemLog('encounter', { pokemon: poke.index, name: poke.name, shiny: currentIsShiny });

  showEncounter(poke);
}

// ===== 佛系模式：遇敌超时自动逃跑 =====
export function startAutoFleeTimer() {
  stopAutoFleeTimer();
  if (!gameData.settings?.autoFlee) return;
  setAutoFleeStartTime(Date.now());
  setAutoFleeTimer(setTimeout(() => {
    setAutoFleeTimer(null);
    clearInterval(_autoFleeBarInterval);
    setAutoFleeBarInterval(null);
    // 进度条归零
    const bar = $('statAutoBar');
    if (bar) bar.style.width = '0%';
    if (phase === 'encounter' && currentEncounter) fleeEncounter(true);
  }, AUTO_FLEE_TIMEOUT));
  // 启动进度条更新
  updateAutoFleeBar();
  setAutoFleeBarInterval(setInterval(updateAutoFleeBar, 200));
}

export function stopAutoFleeTimer() {
  if (_autoFleeTimer) {
    clearTimeout(_autoFleeTimer);
    setAutoFleeTimer(null);
  }
  if (_autoFleeBarInterval) {
    clearInterval(_autoFleeBarInterval);
    setAutoFleeBarInterval(null);
  }
  const bar = $('statAutoBar');
  if (bar) {
    bar.style.width = '100%';
    bar.style.display = 'none';
    if (bar.parentElement) bar.parentElement.style.display = 'none';
  }
}

export function updateAutoFleeBar() {
  if (!_autoFleeTimer) return;
  const elapsed = Date.now() - _autoFleeStartTime;
  const remaining = Math.max(0, AUTO_FLEE_TIMEOUT - elapsed);
  const pct = (remaining / AUTO_FLEE_TIMEOUT) * 100;
  const bar = $('statAutoBar');
  if (bar) {
    bar.style.width = pct + '%';
    bar.style.display = 'block';
    if (bar.parentElement) bar.parentElement.style.display = 'inline-block';
  }
}

// ===== 显示遇敌 =====
export function showEncounter(poke, skipAuto) {
  // 如果在非首页页面（图鉴/商店等），将遇敌挂起不切换视图
  const _onHome = $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none';
  // 判断自动模式下是否有可用球
  // 显示视觉画面（仅在首页时切换视图）
  if (_onHome) {
    road.pause();
    showView('encounterView');
    // 显示逃跑按钮
    $('fleeBtn').style.display = '';
  }
  // 设置屏幕背景色
  $('encounterName').innerHTML = (currentIsShiny
    ? '<span>' + poke.name + '</span><svg viewBox="0 0 1024 1024" width="14" height="14" style="flex-shrink:0;color:var(--ui-color);"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>'
    : poke.name);
  const img = $('encounterGif');
  img.src = '';
  img.style.width = '';
  img.style.height = '';
  const shinySuffix = currentIsShiny ? '_shiny' : '';
  // 有视觉画面才加载图片
  if (_onHome) {
    tryLoadPokemonImage(img, poke, shinySuffix);
  }

  $('encounterTypes').innerHTML = (poke.types||[]).map(t =>
    `<span class="type-badge" style="background:${TYPE_COLORS[t]||'#888'}">${t}</span>`
  ).join('');
  // 已捕获标记（默认显示，后续区分闪光）
  const havedIcon = $('encounterHavedIcon');
  if (havedIcon) {
    const entry = gameData.pokedex[String(poke.index)];
    const hasCaught = entry && (entry.caught > 0 || entry.shinyCaught > 0);
    havedIcon.style.display = hasCaught ? '' : 'none';
  }
  // 右上角捕获率等级 + 稀有度
  const crEl = $('encounterCatchRate');
  if (crEl) {
    const r = currentEncounter.catchRate ?? 1;
    let crLabel;
    if (r <= 0.1) crLabel = '极低';
    else if (r <= 0.25) crLabel = '低';
    else if (r <= 0.45) crLabel = '中低';
    else if (r <= 0.65) crLabel = '中';
    else if (r <= 0.85) crLabel = '中高';
    else crLabel = '高';
    const rarity = currentEncounter.rarity ?? 0.5;
    let rLabel;
    if (rarity <= 0.2) rLabel = '常见';
    else if (rarity <= 0.4) rLabel = '一般';
    else if (rarity <= 0.6) rLabel = '稀有';
    else if (rarity <= 0.8) rLabel = '罕见';
    else rLabel = '极稀有';
    crEl.innerHTML = `捕获率 ${crLabel}<br>稀有度 ${rLabel}`;
  }
  // 有视觉画面才更新文字
  if (_onHome) {
    updateTextBox(currentIsShiny ? '野生的 闪光' + poke.name + ' 跳出来了！' : '野生的 ' + poke.name + ' 跳出来了！', false);
    if (currentIsShiny) setTimeout(playShinySparkle, 200);
  }

  // 自动捕捉逻辑（仅在首页时才自动执行）
  if (!skipAuto) {
    if (_onHome && gameData.settings?.autoCatch) {
      if (hasAnyBall()) {
        // 有球 → 静默自动抛球
        setTimeout(() => autoCatch(), 500);
      } else {
        // 无球 → 展示画面后延迟逃跑（让玩家看到宝可梦）
        setTimeout(() => autoCatch(), 1200);
      }
      // 如果开启了闪光暂停且当前是闪光，则不接管，让用户手动处理
      if (currentIsShiny && gameData.settings?.shinyStop) {
        showView('encounterView');
        $('fleeBtn').style.display = '';
        tryLoadPokemonImage(img, poke, shinySuffix);
        updateTextBox('野生的 闪光' + poke.name + ' 跳出来了！', false);
      }
    }
    // 佛系模式：非自动操作时启动逃跑倒计时
    if (gameData.settings?.autoFlee && !gameData.settings?.autoCatch) {
      startAutoFleeTimer();
    }
  }
}

// ===== 丢球 =====
export async function throwBall(ballType) {
  if (phase !== 'encounter' || !currentEncounter) return;
  if (_throwing) return;
  if ((gameData.items[ballType]||0) <= 0) return;
  setThrowing(true);
  $('fleeBtn')?.classList.add('disabled');
  try {
    // 更新底部文字显示丢出的球种
    updateTextBox('丢出了' + (ITEM_NAMES[ballType] || ballType) + '！', false);

  gameData.items[ballType]--;
  setEncounterBallsUsed(encounterBallsUsed + 1);
  gameData.stats.totalBallsUsed++;
  currentEncounterBalls[ballType] = (currentEncounterBalls[ballType] || 0) + 1;
  updateBackpack();
  addSystemLog('item_use', { item: ballType });

  const catchBonus = Math.min(1 + _catchStreak * 0.15, 2);
  const rate = ballType === 'master-ball' ? 1.0 : (CATCH_RATES[ballType] || 0.30) * (currentEncounter.catchRate ?? 1) * catchBonus;
  const isCaught = Math.random() < rate;

  // 播放完整动画
  const anim = await playCatchSequence(ballType, isCaught);
  const name = currentEncounter.name;

  if (anim.result === 'caught') {
    setPhase('caught');
    $('fleeBtn').style.display = 'none';
    const idx = String(currentEncounter.index);
    if (!gameData.pokedex[idx]) {
      gameData.pokedex[idx] = {
        name: currentEncounter.name, seen: 1, caught: 0,
        lastTime: new Date().toISOString(), shinySeen: 0, shinyCaught: 0,
      };
    }
    gameData.pokedex[idx].caught = (gameData.pokedex[idx].caught || 0) + 1;
    if (currentIsShiny) {
      gameData.pokedex[idx].shinyCaught++;
      gameData.stats.totalShinyCaught++;
    }
    gameData.stats.totalCatches++;
    // 记录遭遇日志
    if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
    gameData.encounterLogs[idx].push({
      time: Date.now(), shiny: currentIsShiny, result: 'caught',
      balls: { ...currentEncounterBalls }
    });
    // 捕获文案（离开遇敌页则不弹出）
    let msg;
    if (currentIsShiny) {
      msg = '闪闪发光的 ' + name + ' 被捕获了！';
    } else if (anim.master) {
      msg = Math.random() < 0.5
        ? '大师球完美锁住了 ' + name + '！'
        : '大师球发挥奇效，顺利捕获 ' + name + '！';
    } else {
      msg = '搞定！' + name + ' 被收服了！';
    }
    if (isOnGameView()) updateTextBox(msg, true);
    addSystemLog('pokemon_caught', { pokemon: idx, name, shiny: currentIsShiny, ball: ballType });
    await saveGame();
    updateStats();
    if (gameData.settings?.autoCatch) {
      await delay(300);
      goIdle();
    }
    return;
  }

  // 挣脱/逃跑 通用文案
  const breakMsgs = BREAK_MSGS;

  if (anim.result === 'fled') {
    setPhase('fled'); // 立即阻止再次丢球/逃跑
    $('fleeBtn').style.display = 'none';
    // 先显示挣脱文案（离开遇敌页则不弹）
    const m = breakMsgs[anim.shakes] || breakMsgs[1];
    if (isOnGameView()) updateTextBox(m[randInt(0, m.length - 1)], false);
    await delay(800); // 停顿期间禁止丢球（phase='fled'已阻止丢球）
    // 记录遭遇日志
    gameData.stats.totalFlees++;
    const idx = String(currentEncounter.index);
    if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
    gameData.encounterLogs[idx].push({
      time: Date.now(), shiny: currentIsShiny, result: 'fled',
      balls: { ...currentEncounterBalls }
    });
    if (isOnGameView()) updateTextBox('精灵逃走了！', false);
    addSystemLog('pokemon_escaped', { pokemon: idx, name, shiny: currentIsShiny });
    await saveGame();
    updateStats();
    await delay(1500);
    goIdle();
    return;
  }

  // 没抓住 → 继续丢球（摇晃文案，离开遇敌页则不弹）
  setCatchStreak(_catchStreak + 1);
  const m = breakMsgs[anim.shakes] || breakMsgs[1];
  if (isOnGameView()) updateTextBox(m[randInt(0, m.length - 1)], false);
  } finally { setThrowing(false); $('fleeBtn')?.classList.remove('disabled'); }
  if (phase === 'encounter') startAutoFleeTimer();
}

// ===== 逃跑 =====
export async function fleeEncounter(isAutoFlee) {
  if (phase !== 'encounter' || !currentEncounter) return;
  if (_throwing) return;
  if (phase === 'fled') return; // 防重入
  stopAutoFleeTimer();
  setPhase('fled'); // 立即阻止后续丢球
  const idx = String(currentEncounter.index);
  if (!gameData.encounterLogs) gameData.encounterLogs = {};
  if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
  const logEntry = {
    time: Date.now(), shiny: currentIsShiny, result: 'fled',
    balls: { ...currentEncounterBalls }
  };
  if (!isAutoFlee) logEntry.manual = true;
  gameData.encounterLogs[idx].push(logEntry);
  if (isAutoFlee) {
    addSystemLog('pokemon_escaped', { pokemon: idx, name: currentEncounter.name, shiny: currentIsShiny });
    if (isOnGameView()) updateTextBox(currentEncounter.name + '逃走了！', false);
  } else {
    gameData.stats.totalFlees++;
    addSystemLog('player_fled', { pokemon: idx, name: currentEncounter.name, shiny: currentIsShiny, auto: false });
    if (isOnGameView()) updateTextBox('你逃走了！', false);
  }
  await saveGame();
  updateStats();
  setTimeout(() => goIdle(), 1200);
}

// ===== 返回空闲状态 =====
export function goIdle() {
  setPhase('idle');
  stopAutoFleeTimer();
  setCatchConfirmStep(false);
  setCurrentEncounter(null);
  setEncounterBallsUsed(0);
  // 重置 UI 主题色
  document.documentElement.style.removeProperty('--ui-color');
  document.documentElement.style.removeProperty('--ui-color-rgb');
  showView('idleView');
  updateStats();
  startIdleRotation();
  road.resume();
  $('screen').style.background = '';
  $('screen').style.borderColor = '';
  $('fleeBtn').style.display = 'none';
  setIdleCharacter('walk');
  // 恢复闪耀护符倒计时（优先级高于甜甜蜜）
  if (charmBuffActive && charmPausedRemaining > 0) {
    $('idleText').textContent = '✦ 闪耀护符生效中 ✦';
    setCharmCountdownEnd(Date.now() + charmPausedRemaining);
    const rem = charmPausedRemaining;
    setCharmPausedRemaining(0);
    // 快速遇敌
    setNextEncounterTimer(setTimeout(tryEncounter, rand(15, 30) * 1000));
    // 护符到期
    setCharmExpiryTimer(setTimeout(() => {
      setCharmBuffActive(false);
      setCharmCountdownEnd(0);
      clearCharmCountdown();
      particles.stop();
      setIdleCharacter('walk');
      $('idleText').textContent = '';
      setCharmExpiryTimer(null);
    }, rem));
    startCharmCountdown();
  } else if (honeyBuffActive && honeyPausedRemaining > 0) {
    // 恢复甜甜蜜倒计时
    setHoneyCountdownEnd(Date.now() + honeyPausedRemaining);
    const d = honeyPausedRemaining;
    setHoneyPausedRemaining(0);
    // 快速遇敌
    setNextEncounterTimer(setTimeout(tryEncounter, rand(15, 30) * 1000));
    // 甜甜蜜到期
    setHoneyExpiryTimer(setTimeout(() => {
      setHoneyBuffActive(false);
      setHoneyCountdownEnd(0);
      clearHoneyCountdown();
      particles.stop();
      setIdleCharacter('walk');
      setHoneyExpiryTimer(null);
    }, d));
    startHoneyCountdown();
  } else {
    scheduleNextEncounter();
  }

  // 战斗结束后检查自动buff是否要续杯（自动操作或佛系模式均触发）
  if (!honeyBuffActive && !charmBuffActive && gameData.settings && (gameData.settings.autoCatch || gameData.settings.autoFlee)) {
    if (gameData.settings.autoBuffHoney && (gameData.items['sweet-honey']||0) > 0) {
      console.log('[续杯] 战斗结束 → 自动甜甜蜜', { honeyBuffActive, autoBuffHoney: gameData.settings.autoBuffHoney });
      activateHoney();
    } else if (gameData.settings.autoBuffCharm && (gameData.items['shiny-charm']||0) > 0) {
      console.log('[续杯] 战斗结束 → 自动护符', { charmBuffActive, autoBuffCharm: gameData.settings.autoBuffCharm });
      activateShinyCharm();
    }
  }
}

// ===== 自动捕捉 =====
export async function autoCatch() {
  if (_autoCatching || phase !== 'encounter' || !currentEncounter) return;
  if (!gameData.settings?.autoCatch) return;
  setAutoCatching(true);
  try {

  while (phase === 'encounter' && gameData.settings?.autoCatch) {
    // 智能选球：根据精灵捕获率决定使用哪种球
    const enabledBalls = gameData.settings?.autoCatchBalls || { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true };
    const availableBalls = ['poke-ball', 'ultra-ball', 'master-ball'].filter(b => enabledBalls[b] !== false && (gameData.items[b]||0) > 0);
    let ballType = null;
    if (availableBalls.length > 0) {
      const cr = currentEncounter.catchRate ?? 1;
      // 捕获率 <= 0.2: 优先大师球 → 高级球 → 精灵球
      // 捕获率 0.2~0.5: 优先高级球 → 精灵球 → 大师球
      // 捕获率 > 0.5: 优先精灵球 → 高级球 → 大师球
      const preferred = cr <= 0.2
        ? ['master-ball', 'ultra-ball', 'poke-ball']
        : cr <= 0.5
        ? ['ultra-ball', 'poke-ball', 'master-ball']
        : ['poke-ball', 'ultra-ball', 'master-ball'];
      for (const b of preferred) {
        if (availableBalls.includes(b)) { ballType = b; break; }
      }
      if (!ballType) ballType = availableBalls[0]; // 兜底
    }

    if (!ballType) {
      // 无球 → 先展示遇敌画面再逃跑
      await delay(AUTO_FLEE_NO_BALL_DELAY);
      // 如果玩家已手动处理（逃跑/关闭），不再重复逃跑
      if (phase !== 'encounter') { setAutoCatching(false); return; }
      setPhase('fled');
      gameData.stats.totalFlees++;
      const idx = String(currentEncounter.index);
      addSystemLog('player_fled', { pokemon: idx, name: currentEncounter.name, shiny: currentIsShiny, auto: true });
      if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
      gameData.encounterLogs[idx].push({
        time: Date.now(), shiny: currentIsShiny, result: 'fled',
        balls: { ...currentEncounterBalls }, manual: false
      });
      await saveGame();
      updateStats();
      // 离开首页不弹出文案
      if ($('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none') {
        updateTextBox('你逃走了！', false);
        await delay(1500);
        goIdle();
      } else {
        setPhase('idle');
        setCurrentEncounter(null);
        setEncounterBallsUsed(0);
        document.documentElement.style.removeProperty('--ui-color');
        document.documentElement.style.removeProperty('--ui-color-rgb');
        $('screen').style.background = '';
        $('screen').style.borderColor = '';
        $('fleeBtn').style.display = 'none';
        if (nextEncounterTimer) clearTimeout(nextEncounterTimer);
        scheduleNextEncounter();
      }
      break;
    }

    // 消耗球种
    gameData.items[ballType]--;
    setEncounterBallsUsed(encounterBallsUsed + 1);
    gameData.stats.totalBallsUsed++;
    currentEncounterBalls[ballType] = (currentEncounterBalls[ballType] || 0) + 1;
    updateBackpack();
    addSystemLog('item_use', { item: ballType, auto: true });

    const catchBonus = Math.min(1 + _catchStreak * 0.15, 2);
    const rate = ballType === 'master-ball' ? 1.0 : (CATCH_RATES[ballType] || 0.30) * (currentEncounter.catchRate ?? 1) * catchBonus;
    const isCaught = Math.random() < rate;

    // 播放丢球动画
    if (isOnGameView()) {
      updateTextBox('丢出了' + (ITEM_NAMES[ballType] || ballType) + '！', false);
    }
    const animResult = await playCatchSequence(ballType, isCaught);
    const name = currentEncounter.name;

    if (animResult.result === 'caught') {
      setPhase('caught');
      $('fleeBtn').style.display = 'none';
      const idx = String(currentEncounter.index);
      if (!gameData.pokedex[idx]) {
        gameData.pokedex[idx] = {
          name: currentEncounter.name, seen: 1, caught: 0,
          lastTime: new Date().toISOString(), shinySeen: 0, shinyCaught: 0,
        };
      }
      gameData.pokedex[idx].caught = (gameData.pokedex[idx].caught || 0) + 1;
      if (currentIsShiny) {
        gameData.pokedex[idx].shinyCaught++;
        gameData.stats.totalShinyCaught++;
      }
      gameData.stats.totalCatches++;
      if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
      gameData.encounterLogs[idx].push({
        time: Date.now(), shiny: currentIsShiny, result: 'caught',
        balls: { ...currentEncounterBalls }
      });
      setCatchStreak(0);
       await saveGame();
       updateStats();
       addSystemLog('pokemon_caught', { pokemon: idx, name, shiny: currentIsShiny, ball: ballType, auto: true });
      if (gameData.settings?.autoCatch) {
         // 自动模式：仅在首页显示文案，不然静默回idle
        if (isOnGameView()) {
          updateTextBox('收服了 ' + name + '！', false);
          await delay(300);
        }
        if (phase === 'caught') {
          goIdle();
        }
      } else {
        // 手动模式（捕获时关闭了自动）
        if (isOnGameView()) {
          updateTextBox('搞定！' + name + ' 被收服了！', true);
        } else {
          goIdle();
        }
      }
      break;
    }

    if (animResult.result === 'fled') {
      setPhase('fled');
      gameData.stats.totalFlees++;
      const idx = String(currentEncounter.index);
      if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
      gameData.encounterLogs[idx].push({
        time: Date.now(), shiny: currentIsShiny, result: 'fled',
        balls: { ...currentEncounterBalls }
      });
      await saveGame();
      updateStats();
      addSystemLog('pokemon_escaped', { pokemon: idx, name: currentEncounter.name, shiny: currentIsShiny, auto: true });
      if (isOnGameView()) {
        const m = BREAK_MSGS[animResult.shakes] || BREAK_MSGS[1];
        updateTextBox(m[randInt(0, m.length - 1)], false);
        await delay(800);
        updateTextBox('精灵逃走了！', false);
        await delay(1500);
        goIdle();
      } else {
        await delay(1500);
        goIdle();
      }
      break;
    }

    // 继续丢球
    setCatchStreak(_catchStreak + 1);
    if (isOnGameView()) {
      const m = BREAK_MSGS[animResult.shakes] || BREAK_MSGS[1];
      updateTextBox(m[randInt(0, m.length - 1)], false);
      await delay(500);
    }
    await delay(500);
  }

  } catch (e) {
    console.error('autoCatch error:', e);
  } finally {
    setAutoCatching(false);
  }
}


