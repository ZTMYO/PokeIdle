import { ENCOUNTER_MIN, ENCOUNTER_MAX, BLOCK_TARGET_CHANCE, BLOCK_QUALITY, SHINY_CHANCE, CHARM_SHINY_CHANCE, CHARM_RARITY_BOOST, ITEM_NAMES, CATCH_RATES, AUTO_FLEE_TIMEOUT, AUTO_FLEE_NO_BALL_DELAY } from './config.js';
import { phase, gameData, allPokemon, currentEncounter, currentIsShiny, encounterBallsUsed, currentEncounterBalls, nextEncounterTimer, honeyBuffActive, charmBuffActive, blockBuffActive, blockRecipe, blockQuality, honeyCountdownEnd, charmCountdownEnd, honeyPausedRemaining, charmPausedRemaining, honeyExpiryTimer, charmExpiryTimer, honeyCountdownInterval, charmCountdownInterval, _honeyEncounterCount, _charmEncounterCount, _autoFleeTimer, _autoFleeStartTime, _autoFleeBarInterval, _autoCatching, _throwing, _catchConfirmStep, _lastRegionId, _idleMsgIdx, _fishing, encounterMsg, saveGame, addSystemLog, getCurrentRegion, hasAnyBall, rand, randInt, formatNum, saveSessionState, setPhase, setCurrentEncounter, setCurrentIsShiny, setEncounterBallsUsed, setCurrentEncounterBalls, setHoneyBuffActive, setCharmBuffActive, setHoneyEncounterCount, setCharmEncounterCount, setHoneyPausedRemaining, setCharmPausedRemaining, setHoneyCountdownEnd, setCharmCountdownEnd, setNextEncounterTimer, setAutoCatching, setThrowing, setCatchConfirmStep, setAutoFleeTimer, setAutoFleeStartTime, setAutoFleeBarInterval, setHoneyExpiryTimer, setCharmExpiryTimer, setHoneyCountdownInterval, setCharmCountdownInterval, setEncounterMsg } from './state.js';
import { $, showView, updateTextBox, hideTextBox, setIdleCharacter, isOnGameView, updateBackpack, updateStats, tryLoadPokemonImage, fitPokemonImage } from './ui.js';
import { pickRandomPokemon, pickWeightedPokemon, findBerryTarget, activateHoney, activateShinyCharm, clearCharmCountdown, clearHoneyCountdown, startCharmCountdown, startHoneyCountdown, handleHoneyExpired, handleCharmExpired, TYPE_COLORS } from './items.js';
import { eatBlock } from './mixer.js';
import { delay, playCatchSequence, playFleeAnim, startShinySparkleLoop, stopShinySparkleLoop } from './animation.js';
import { catchBonusFor, computeObtainScore, computeMeetScore } from './scoring.js';
import { startIdleRotation } from './messages.js';
import * as road from './road.js';
import * as particles from './particles.js';

// 丢球挣脱文案（按摇晃轮数 0~3 分组）
const BREAK_MSGS = {
  0: [
    '精灵球刚落地就被挣脱了！',
    '精灵球没稳住，它直接冲出来了！',
    '刚落地，宝可梦就突破了精灵球！',
    '精灵球一碰地面就被挣脱开来！',
    '落地一瞬，它便从精灵球脱身！'
  ],
  1: [
    '宝可梦冲了出来！',
    '可恶，没能抓住它！',
    '真是可惜，差一点就抓住了！',
    '明明差一点就要成功了！'
  ],
  2: [
    '就差一点点，没能收服它！',
    '哎呀，差一点就抓到了！',
    '眼看就要成功，可恶！',
    '这一次差一点就成功了！'
  ],
  3: [
    '可惜！这都没抓住它！',
    '就差最后一下了！',
    '可惜！明明就差一点了！',
    '几乎要成功了！',
    '太可惜了！就差那么一下！'
  ]
};

// 当前遭遇来源（'normal' 普通遇敌 / 'fishing' 钓鱼钓到），记录进遭遇日志与系统日志
let _encounterSource = 'normal';
// 丢球动画期间暂停逃跑倒计时保留的剩余毫秒数（null 表示未暂停）
let _autoFleePausedRemaining = null;

// ===== 遇敌调度 =====
export function scheduleNextEncounter(delay) {
  if (nextEncounterTimer) clearTimeout(nextEncounterTimer);
  if (phase !== 'idle') return;
  // 树果方块：始终按普通间隔遇敌，仅提高目标宝可梦的出现概率
  let d = delay || rand(ENCOUNTER_MIN, ENCOUNTER_MAX) * 1000;
  setNextEncounterTimer(setTimeout(tryEncounter, d));
}

// ===== 遇敌 =====
export async function tryEncounter() {
  if (phase !== 'idle') return;
  if (_fishing) return; // 钓鱼中不遇敌
  // 自行车道上不遇敌：本次调度延后，离开自行车道后再遇
  if (road.isBike()) {
    scheduleNextEncounter(rand(ENCOUNTER_MIN, ENCOUNTER_MAX) * 1000);
    return;
  }

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

  // 选择宝可梦：确保 poke 和 currentEncounter 始终指向同一对象
  const regionPool = allPokemon.filter(p => p.region === getCurrentRegion().name);
  // 树果方块：按 BLOCK_TARGET_CHANCE 提高目标宝可梦的出现概率（命中则方块被吃掉 → buff 结束）
  // 只有图鉴中成功捕获过的目标才具备吸引力；未捕获时等同没有宝可梦吃，方块仅走里程
  const blockTarget = (blockBuffActive && blockRecipe.length > 0) ? findBerryTarget(blockRecipe) : null;
  const blockTargetCaught = !!blockTarget && (gameData.pokedex?.[String(blockTarget.index)]?.caught || 0) > 0;
  // 命中概率随方块品质浮动（无品质记录按兜底概率）
  const blockChance = BLOCK_QUALITY[blockQuality]?.chance ?? BLOCK_TARGET_CHANCE;
  if (blockTargetCaught && Math.random() < blockChance) {
    // 高概率直接遇到目标宝可梦
    poke = blockTarget;
    setCurrentEncounter(poke);
    setCurrentIsShiny(Math.random() < SHINY_CHANCE);
  } else if (charmBuffActive && regionPool.length > 0) {
    const roll = Math.random();
    if (roll < CHARM_SHINY_CHANCE) {
      // CHARM_SHINY_CHANCE: 任意精灵 + 闪光（权重选择，倾向稀有）
      poke = pickWeightedPokemon(CHARM_RARITY_BOOST, regionPool);
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
        poke = pickWeightedPokemon(CHARM_RARITY_BOOST, regionPool);
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
  // 无论哪条路径，只要选中目标宝可梦（未触发直接命中的情况下恰好抽中），方块即被吃掉
  // 未捕获的目标不算：抽中仅普通遇敌，方块继续走里程
  if (blockTargetCaught && poke === blockTarget) eatBlock('encounter');
  if (honeyBuffActive) setHoneyEncounterCount(_honeyEncounterCount + 1);
  if (charmBuffActive) setCharmEncounterCount(_charmEncounterCount + 1);

  beginEncounter(poke);
}

// ===== 记录遭遇并展示战斗画面（普通遇敌 / 钓鱼上钩共用） =====
function beginEncounter(poke, opts = {}) {
  _encounterSource = opts.source || 'normal';
  setCurrentEncounterBalls({ 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 });

  // 更新图鉴遭遇统计
  const idx = String(poke.index);
  if (!gameData.pokedex[idx]) {
    gameData.pokedex[idx] = {
      seen: 0, caught: 0,
      lastTime: null, shinySeen: 0, shinyCaught: 0,
    };
  }
  gameData.pokedex[idx].seen++;
  gameData.pokedex[idx].lastTime = new Date().toISOString();
  if (currentIsShiny) {
    gameData.pokedex[idx].shinySeen++;
    gameData.stats.totalShinySeen++;
  }

  addSystemLog('encounter', { pokemon: poke.index, shiny: currentIsShiny, source: _encounterSource });

  showEncounter(poke, opts);
}

// ===== 钓鱼钓到宝可梦：直接进入战斗（文案用"上钩了"） =====
export function startFishingEncounter(poke) {
  if (!poke) return;
  setPhase('encounter');
  setEncounterBallsUsed(0);
  setCurrentEncounter(poke);
  // 闪耀护符生效期间，钓鱼钓到的宝可梦同样享受护符闪光加成
  setCurrentIsShiny(Math.random() < (charmBuffActive ? CHARM_SHINY_CHANCE : SHINY_CHANCE));
  beginEncounter(poke, { message: (currentIsShiny ? '野生的 闪光' : '野生的 ') + poke.name + ' 上钩了！', source: 'fishing' });
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
  _autoFleePausedRemaining = null;
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

// 暂停逃跑倒计时（丢球动画期间）：保留剩余时间，进度条冻结在当前位置不隐藏
export function pauseAutoFleeTimer() {
  if (!_autoFleeTimer) return;
  clearTimeout(_autoFleeTimer);
  setAutoFleeTimer(null);
  if (_autoFleeBarInterval) {
    clearInterval(_autoFleeBarInterval);
    setAutoFleeBarInterval(null);
  }
  _autoFleePausedRemaining = Math.max(0, _autoFleeStartTime + AUTO_FLEE_TIMEOUT - Date.now());
}

// 丢球动画结束后重置逃跑倒计时：进度条恢复满格重新计时（丢球时重置）
export function resetAutoFleeTimer() {
  _autoFleePausedRemaining = null;
  startAutoFleeTimer();
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
export function showEncounter(poke, opts = {}) {
  // 兼容旧调用 showEncounter(poke, true)：第二个参数传 true 表示跳过自动操作
  const skipAuto = opts === true || !!opts.skipAuto;
  const msg = opts && typeof opts === 'object' ? (opts.message || null) : null;
  // 如果在非首页页面（图鉴/商店等），将遇敌挂起不切换视图
  const _onHome = $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none';
  // 显示视觉画面（仅在首页时切换视图；入场"文案顶起主角"动画由 showView 统一处理）
  if (_onHome) {
    road.pause();
    showView('encounterView');
    $('fleeBtn').style.display = '';
  }
  // 渲染遭遇画面（名字/图片/类型/标签/文案等）
  // 仅在有自定义文案时写入（如钓鱼"上钩了"）；恢复会话走 showEncounter(poke, true) 时 msg 为 null，
  // 需保留 main.js 从会话状态恢复的 encounterMsg，不能被覆写
  if (msg) setEncounterMsg(msg);
  const loadPromise = renderEncounterScene(poke);

  // 自动捕捉/自动逃跑：无论玩家当前在哪个页面都照常执行。
  // 后台操作已有 isOnGameView() 分支（不切视图、不弹文案），导航/统计等页面
  // 遇敌后同样立即自动处理，无需切回战斗页才触发。
  if (!skipAuto) {
    if (gameData.settings?.autoCatch) {
      // 闪光暂停优先 — 如果开启则不自动处理，强制切到战斗页让用户手动
      if (currentIsShiny && gameData.settings?.shinyStop) {
        showView('encounterView');
        $('fleeBtn').style.display = '';
      } else {
        const waitMs = hasAnyBall() ? 1500 : 2000;
        setTimeout(async () => {
          await loadPromise; // 等图片加载完再丢球，避免尺寸错乱
          autoCatch();
        }, waitMs);
      }
    }
    // 佛系模式：非自动操作时启动逃跑倒计时
    if (gameData.settings?.autoFlee && !gameData.settings?.autoCatch) {
      startAutoFleeTimer();
    }
  }
}

// ===== 渲染遭遇画面（可被回到游戏页时重新调用同步） =====
export function renderEncounterScene(poke) {
  const _onHome = $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none';
  $('encounterName').innerHTML = (currentIsShiny
    ? '<span>' + poke.name + '</span><svg viewBox="0 0 1024 1024" width="14" height="14" style="flex-shrink:0;color:var(--ui-color);"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>'
    : poke.name);
  const img = $('encounterGif');
  // 丢球/判定动画进行中（宝可梦在球里）：跳过图片重置与重新加载，
  // 否则会把球里正在摇晃判定的宝可梦又显示出来
  if (!_throwing) {
    img.src = '';
    img.style.width = '';
    img.style.height = '';
    img.style.display = '';
    img.style.opacity = '';
    img.style.position = '';
    img.style.left = '';
    img.style.top = '';
    img.style.zIndex = '';
    img.style.transition = '';
    img.style.transform = '';
    img.style.animation = '';
  }
  const shinySuffix = currentIsShiny ? '_shiny' : '';
  // 后台（导航/统计等页面）同样加载图片：自动捕捉/逃跑在非首页照常执行丢球动画，
  // setupCatchAnim 依赖图片加载完成来确定尺寸；若仅首页加载，后台遭遇的 img.src
  // 为空且 error 早已触发，等待图片的 Promise 会永久挂起 → 丢一球后卡死、切回无图。
  const loadPromise = !_throwing ? tryLoadPokemonImage(img, poke, shinySuffix) : Promise.resolve(false);

  $('encounterTypes').innerHTML = (poke.types||[]).map(t =>
    `<span class="type-badge" style="background:${TYPE_COLORS[t]}">${t}</span>`
  ).join('');
  // 新发现标记（普通/闪光分开）
  const newLabel = $('encounterNewLabel');
  if (newLabel) {
    const entry = gameData.pokedex[String(poke.index)];
    // tryEncounter 中 pokedex 已先 seen++ / shinySeen++，所以首次为 1
    const isNew = !entry
      ? true
      : currentIsShiny ? entry.shinySeen === 1 : entry.seen === 1;
    newLabel.style.display = isNew ? '' : 'none';
  }
  // 已捕获标记（普通/闪光分开）：hover 图标显示"首次捕获"时间
  const ownedWrap = $('encounterOwnedWrap');
  if (ownedWrap) {
    const entry = gameData.pokedex[String(poke.index)];
    const hasCaught = entry && (currentIsShiny ? entry.shinyCaught > 0 : entry.caught > 0);
    ownedWrap.style.display = hasCaught ? '' : 'none';
    if (hasCaught) {
      const tip = $('encounterOwnedTip');
      if (tip) {
        // 首次捕获时间：从遭遇日志取该形态（普通/闪光）第一条 caught 记录
        const logs = (gameData.encounterLogs || {})[String(poke.index)] || [];
        const first = logs.find(l => l.result === 'caught' && !!l.shiny === currentIsShiny);
        if (first && first.time) {
          const d = new Date(first.time);
          const pad = n => String(n).padStart(2, '0');
          tip.textContent = `首次捕获：${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } else {
          tip.textContent = '首次捕获：较早前';
        }
      }
    }
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
    updateTextBox(encounterMsg || (currentIsShiny ? '野生的 闪光' + poke.name + ' 跳出来了！' : '野生的 ' + poke.name + ' 跳出来了！'), false);
    // 宝可梦在场上（非丢球/判定中）才循环闪光；球内判定中不显示
    if (currentIsShiny && !_throwing) startShinySparkleLoop();
  }
  return loadPromise;
}

// ===== 丢球 =====

export async function throwBall(ballType) {
  if (phase !== 'encounter' || !currentEncounter) return;
  if (_throwing) return;
  if ((gameData.items[ballType]||0) <= 0) return;
  setThrowing(true);
  $('fleeBtn')?.classList.add('disabled');
  if (currentIsShiny) stopShinySparkleLoop();
  try {
    // 更新底部文字显示丢出的球种
    updateTextBox('丢出了' + (ITEM_NAMES[ballType] || ballType) + '！', false);

  gameData.items[ballType]--;
  setEncounterBallsUsed(encounterBallsUsed + 1);
  gameData.stats.totalBallsUsed++;
  currentEncounterBalls[ballType] = (currentEncounterBalls[ballType] || 0) + 1;
  updateBackpack();
  addSystemLog('item_use', { item: ballType, auto: _autoCatching });

  // 捕获加成：逃跑率拉满（50%）后，每多丢一球 +10%，上限 2 倍 —— 能撑过逃跑率上限的奖励
  const catchBonus = catchBonusFor(encounterBallsUsed);
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
        seen: 1, caught: 0,
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
      balls: { ...currentEncounterBalls }, source: _encounterSource,
      charmBuff: charmBuffActive, // 该遭遇是否处于闪耀护符 buff（影响闪光率评分）
      score: computeObtainScore({
        pokemon: currentEncounter, source: _encounterSource, shiny: currentIsShiny,
        charmBuff: charmBuffActive, honeyBuff: honeyBuffActive,
        balls: currentEncounterBalls, finalRate: rate,
      }),
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
    addSystemLog('pokemon_caught', { pokemon: idx, shiny: currentIsShiny, ball: ballType, auto: _autoCatching });
    await saveGame();
    updateStats();
    // 仅当自动捕捉循环真正接管时，捕获后直接回挂机；
    // 闪光暂停转手动等场景保留手动捕获后的交互（点箭头询问是否查看图鉴）
    if (_autoCatching) {
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
      balls: { ...currentEncounterBalls }, source: _encounterSource,
      charmBuff: charmBuffActive,
      // 未获得宝可梦：score 记"相遇欧气分"（遇到稀有本身也值得加分，无 buff 更高）
      score: computeMeetScore({
        pokemon: currentEncounter, source: _encounterSource, shiny: currentIsShiny,
        charmBuff: charmBuffActive, honeyBuff: honeyBuffActive,
      }),
    });
    if (isOnGameView()) updateTextBox('精灵逃走了！', false);
    addSystemLog('pokemon_escaped', { pokemon: idx, shiny: currentIsShiny, auto: _autoCatching });
    await saveGame();
    updateStats();
    // 宝可梦水平翻转并向右下平移出屏的逃跑动画
    if (isOnGameView()) await playFleeAnim();
    await delay(300);
    goIdle();
    return;
  }

  // 没抓住 → 继续丢球（摇晃文案，离开遇敌页则不弹）
  const m = breakMsgs[anim.shakes] || breakMsgs[1];
  if (isOnGameView()) updateTextBox(m[randInt(0, m.length - 1)], false);
  } finally { setThrowing(false); $('fleeBtn')?.classList.remove('disabled'); if (currentIsShiny && phase === 'encounter') startShinySparkleLoop(); }
  // 丢球动画结束，进度条重置满格重新计时（丢球时重置）
  if (phase === 'encounter') resetAutoFleeTimer();
}

// ===== 逃跑 =====
export async function fleeEncounter(isAutoFlee) {
  if (phase !== 'encounter' || !currentEncounter) return;
  if (_throwing) return;
  if (phase === 'fled') return; // 防重入
  stopAutoFleeTimer();
  stopShinySparkleLoop();
  setPhase('fled'); // 立即阻止后续丢球
  const idx = String(currentEncounter.index);
  if (!gameData.encounterLogs) gameData.encounterLogs = {};
  if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
  const logEntry = {
    time: Date.now(), shiny: currentIsShiny, result: 'fled',
    balls: { ...currentEncounterBalls }, source: _encounterSource,
    charmBuff: charmBuffActive,
    // 主动逃跑（手动 / 佛系自动）属于玩家策略选择，不参与欧气评定
    selfFlee: true,
    // 未获得宝可梦：score 记"相遇欧气分"（遇到稀有本身也值得加分，无 buff 更高）
    score: computeMeetScore({
      pokemon: currentEncounter, source: _encounterSource, shiny: currentIsShiny,
      charmBuff: charmBuffActive, honeyBuff: honeyBuffActive,
    }),
  };
  if (!isAutoFlee) logEntry.manual = true;
  gameData.encounterLogs[idx].push(logEntry);
  if (isAutoFlee) {
    addSystemLog('pokemon_escaped', { pokemon: idx, shiny: currentIsShiny });
    if (isOnGameView()) updateTextBox(currentEncounter.name + '逃走了！', false);
    // 宝可梦水平翻转并向右下平移出屏的逃跑动画
    if (isOnGameView()) await playFleeAnim();
  } else {
    gameData.stats.totalFlees++;
    addSystemLog('player_fled', { pokemon: idx, shiny: currentIsShiny, auto: false });
    if (isOnGameView()) updateTextBox('你逃走了！', false);
  }
  await saveGame();
  updateStats();
  setTimeout(() => goIdle(), isAutoFlee ? 300 : 1200);
}

// ===== 返回空闲状态 =====
export function goIdle() {
  setPhase('idle');
  stopAutoFleeTimer();
  stopShinySparkleLoop();
  setCatchConfirmStep(false);
  setCurrentEncounter(null);
  setEncounterBallsUsed(0);
  setEncounterMsg(null);
  _encounterSource = 'normal';
  // 重置 UI 主题色
  document.documentElement.style.removeProperty('--ui-color');
  document.documentElement.style.removeProperty('--ui-color-rgb');
  // 仅在游戏页时切换回空闲视图，浏览其他页面（图鉴/商店等）时不打扰
  if (isOnGameView()) {
    showView('idleView');
  }
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
    // 护符到期：走统一公共回调（关闭+文案+自动续杯+保底），与激活时的到期行为一致
    setCharmExpiryTimer(setTimeout(handleCharmExpired, rem));
    startCharmCountdown();
  } else if (honeyBuffActive && honeyPausedRemaining > 0) {
    // 恢复甜甜蜜倒计时
    setHoneyCountdownEnd(Date.now() + honeyPausedRemaining);
    const d = honeyPausedRemaining;
    setHoneyPausedRemaining(0);
    // 快速遇敌
    setNextEncounterTimer(setTimeout(tryEncounter, rand(15, 30) * 1000));
    // 甜甜蜜到期：走统一公共回调（关闭+文案+自动续杯+保底），与激活时的到期行为一致
    setHoneyExpiryTimer(setTimeout(handleHoneyExpired, d));
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
let _abortAutoCatch = false;

export function setAbortAutoCatch() { _abortAutoCatch = true; }

export async function autoCatch() {
  if (_autoCatching || phase !== 'encounter' || !currentEncounter) return;
  if (!gameData.settings?.autoCatch) return;
  setAutoCatching(true);
  if (currentIsShiny) stopShinySparkleLoop();
  $('fleeBtn')?.classList.add('disabled');
  try {

  while (phase === 'encounter' && gameData.settings?.autoCatch && !_abortAutoCatch) {
    // 智能选球：根据精灵捕获率决定使用哪种球
    const enabledBalls = gameData.settings?.autoCatchBalls || { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true };
    const availableBalls = ['poke-ball', 'ultra-ball', 'master-ball'].filter(b => enabledBalls[b] !== false && (gameData.items[b]||0) > 0);
    let ballType = null;
    if (availableBalls.length > 0) {
      const cr = currentEncounter.catchRate ?? 1;
      const preferred = cr <= 0.2
        ? ['master-ball', 'ultra-ball', 'poke-ball']
        : cr <= 0.5
        ? ['ultra-ball', 'poke-ball', 'master-ball']
        : ['poke-ball', 'ultra-ball', 'master-ball'];
      for (const b of preferred) {
        if (availableBalls.includes(b)) { ballType = b; break; }
      }
      if (!ballType) ballType = availableBalls[0];
    }

    if (!ballType) {
      // 无球 → 先展示遇敌画面再逃跑
      await delay(AUTO_FLEE_NO_BALL_DELAY);
      if (phase !== 'encounter') { setAutoCatching(false); return; }
      setPhase('fled');
      gameData.stats.totalFlees++;
      const idx = String(currentEncounter.index);
      addSystemLog('player_fled', { pokemon: idx, shiny: currentIsShiny, auto: true });
      if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
      gameData.encounterLogs[idx].push({
        time: Date.now(), shiny: currentIsShiny, result: 'fled',
        balls: { ...currentEncounterBalls }, manual: false, source: _encounterSource,
        charmBuff: charmBuffActive,
        // 无球自动逃跑属于自动操作策略，不参与欧气评定
        selfFlee: true,
        // 未获得宝可梦：score 记"相遇欧气分"（遇到稀有本身也值得加分，无 buff 更高）
        score: computeMeetScore({
          pokemon: currentEncounter, source: _encounterSource, shiny: currentIsShiny,
          charmBuff: charmBuffActive, honeyBuff: honeyBuffActive,
        }),
      });
      await saveGame();
      updateStats();
      if ($('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none') {
        updateTextBox('你逃走了！', false);
        await delay(1500);
      }
      goIdle();
      break;
    }

    // 委托 throwBall 统一处理丢球逻辑（动画、捕获、逃跑、UI文案等）
    $('fleeBtn')?.classList.add('disabled');
    await throwBall(ballType);

    // 如果仍处于遇敌中（没抓到也没逃跑），加一点延迟继续丢球
    if (phase === 'encounter') {
      await delay(500);
    }
  }

  } catch (e) {
    console.error('autoCatch error:', e);
  } finally {
    if (_abortAutoCatch) {
      _abortAutoCatch = false;
      // 中止自动捕捉：只恢复逃跑按钮，不跳转页面（用户可能在设置页操作）
      if (currentIsShiny && phase === 'encounter') {
        $('fleeBtn').style.display = '';
      }
    }
    if (currentIsShiny && phase === 'encounter') startShinySparkleLoop();
    $('fleeBtn')?.classList.remove('disabled');
    setAutoCatching(false);
  }
}


