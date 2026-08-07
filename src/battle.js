import { ENCOUNTER_MIN, ENCOUNTER_MAX, BLOCK_TARGET_CHANCE, BLOCK_QUALITY, SHINY_CHANCE, CHARM_SHINY_CHANCE, CHARM_RARITY_BOOST, ITEM_NAMES, CATCH_RATES, ULTRA_BALL_ADD, AUTO_FLEE_TIMEOUT, AUTO_FLEE_NO_BALL_DELAY, FLEE_CHANCE, FLEE_CHANCE_INC, FLEE_CHANCE_MAX, MASS_SHINY_CHANCE } from './config.js';
import { phase, gameData, allPokemon, currentEncounter, currentIsShiny, encounterLevel, encounterBallsUsed, currentEncounterBalls, nextEncounterTimer, honeyBuffActive, charmBuffActive, blockBuffActive, blockRecipe, blockQuality, honeyCountdownEnd, charmCountdownEnd, honeyPausedRemaining, charmPausedRemaining, honeyExpiryTimer, charmExpiryTimer, honeyCountdownInterval, charmCountdownInterval, _charmEncounterCount, _autoFleeTimer, _autoFleeStartTime, _autoFleeBarInterval, _autoCatching, _throwing, _catchConfirmStep, _lastRegionId, _idleMsgIdx, _fishing, _eggHatching, encounterMsg, saveGame, addSystemLog, getCurrentRegion, hasAnyBall, rand, randInt, formatNum, saveSessionState, inMassZone, setPhase, setCurrentEncounter, setEncounterLevel, setCurrentIsShiny, setEncounterBallsUsed, setCurrentEncounterBalls, setHoneyBuffActive, setCharmBuffActive, setCharmEncounterCount, setHoneyPausedRemaining, setCharmPausedRemaining, setHoneyCountdownEnd, setCharmCountdownEnd, setNextEncounterTimer, setAutoCatching, setThrowing, setCatchConfirmStep, setAutoFleeTimer, setAutoFleeStartTime, setAutoFleeBarInterval, setHoneyExpiryTimer, setCharmExpiryTimer, setHoneyCountdownInterval, setCharmCountdownInterval, setEncounterMsg, addRosterEntry, setLastObtainedEntryId, rollGender, genderBadge } from './state.js';
import { $, showView, updateTextBox, hideTextBox, setIdleCharacter, isOnGameView, updateBackpack, updateStats, tryLoadPokemonImage, tryLoadPokemonIcon, fitPokemonImage } from './ui.js';
import { pickRandomPokemon, pickWeightedPokemon, findBerryTarget, activateHoney, activateShinyCharm, clearCharmCountdown, clearHoneyCountdown, startCharmCountdown, startHoneyCountdown, handleHoneyExpired, handleCharmExpired, TYPE_COLORS, cancelSuspendedEncounterForEgg } from './items.js';
import { eatBlock } from './mixer.js';
import { delay, playCatchSequence, playFleeAnim, startShinySparkleLoop, stopShinySparkleLoop } from './animation.js';
import { catchBonusFor, computeObtainScore, computeMeetScore } from './scoring.js';
import { startIdleRotation } from './messages.js';
import { playBattle, endBattle, playVictory, stopVictory, consumeShowCardOnEncounterEnd, showRegionNowPlaying } from './audio.js';
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
    '太可惜了！就差那么一下！',
    '我去！这都没抓到！'
  ]
};

// 当前遭遇来源（'normal' 普通遇敌 / 'fishing' 钓鱼钓到），记录进遭遇日志与系统日志
let _encounterSource = 'normal';
// 丢球动画期间暂停逃跑倒计时保留的剩余毫秒数（null 表示未暂停）
let _autoFleePausedRemaining = null;
// 遭遇被 NPC 对战等打断后转后台结算：置位后丢球/逃跑流程在 phase!=='encounter' 时仍可运行，
// 自动捕捉在后台继续结算（判定立即落库），战斗期间不受影响
let _bgCatch = false;
// 后台结算结果快照：最终判定已在后台落库，玩家切回游戏页时补播完整捕捉/逃跑动画
let _bgResult = null;
// 后台结果补播只是视觉回放，不允许再次参与真实遭遇结算。
let _bgReplayActive = false;
let _bgReplayToken = 0;
// 当前遭遇宝可梦性别（每次遇敌 roll 一次；currentEncounter 是共享图鉴对象，直接写 gender 会污染数据源）
let _encounterGender = 'male';

// 保存后台结算结果（供切回游戏页后重放动画）
function storeBgResult(outcome, breakRound, ballType, opts = {}) {
  if (!currentEncounter) return;
  _bgResult = {
    poke: currentEncounter,
    shiny: currentIsShiny,
    level: encounterLevel,
    source: _encounterSource,
    msg: encounterMsg,
    outcome,
    breakRound,
    ballType: ballType || null,
    noBall: !!opts.noBall,        // 无球逃跑：不播丢球动画，直接播逃跑文案
    fleeMsg: opts.fleeMsg || null, // 逃跑文案（无球/主动逃跑用）
    fleeAnim: !!opts.fleeAnim,     // 是否需要播放宝可梦逃走的离场动画
  };
}

// 取出并清除后台结算结果
export function consumeBgResult() {
  const r = _bgResult;
  _bgResult = null;
  return r;
}

function isBgReplayCurrent(token) {
  return _bgReplayActive && _bgReplayToken === token;
}

export function cancelBgResultReplay() {
  if (!_bgReplayActive) return false;
  _bgReplayToken++;
  _bgReplayActive = false;
  stopVictory();
  endBattle();
  cleanupEncounterState();
  if (phase !== 'battle') setPhase('idle');
  return true;
}

// 手动捕获成功后停在"是否查看详情"确认框（phase='caught'）时离开游戏页（切图鉴/商店/对战列表等）：
// 确认框随视图隐藏后无人点击，若不收尾，返回挂机页会停在"对战中"——道路暂停、不再遇敌，
// 而捕获判定早已落库（宝可梦已在仓库/图鉴）。离开即视为放弃查看详情，直接收尾回空闲。
export function finalizePendingCatch() {
  if (phase !== 'caught' || _bgCatch || _autoCatching || _eggHatching) return false;
  goIdle();
  return true;
}

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
  // 大量出没事件路段内不触发普通遇敌：事件宝可梦滚动触发战斗，
  // 数量抓完由 endMassOutbreak 重新调度普通遇敌
  if (inMassZone()) return;
  // 自行车道上不遇敌：本次调度延后，离开自行车道后再遇
  if (road.isBike()) {
    scheduleNextEncounter(rand(ENCOUNTER_MIN, ENCOUNTER_MAX) * 1000);
    return;
  }

  // 垂钓路段钓鱼触发前的等待窗口内不遇敌：本次调度延后，开始钓鱼后由 _fishing 守卫接管
  if (road.getFishingRow()) {
    const { isFishingPending } = await import('./fishing.js');
    if (isFishingPending()) {
      scheduleNextEncounter(rand(ENCOUNTER_MIN, ENCOUNTER_MAX) * 1000);
      return;
    }
  }

  // // 无精灵球时不触发遇敌（自动操作模式例外，由自动逻辑处理逃跑）
  // if (!gameData.settings?.autoCatch && !hasAnyBall()) {
  //   scheduleNextEncounter(rand(ENCOUNTER_MIN, ENCOUNTER_MAX) * 1000);
  //   return;
  // }

  let poke;

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
  if (charmBuffActive) setCharmEncounterCount(_charmEncounterCount + 1);

  // 遇敌不立即开战：宝可梦图标在道路上从右向左滚向主角（同大量出没表现），
  // 碰到主角才真正进入战斗；滚动期间 buff 照常计时，开战时再暂停
  spawnEncounterPoke(poke, currentIsShiny, () => startRoadEncounter(poke));
}

// ===== 道路遇敌宝可梦（普通遇敌改为像大量出没一样滚向主角）=====
// 遇敌时机到后先在主界面道路上生成宝可梦图标，从右向左滚向主角（上下跳动），
// 碰到主角才进入战斗；后台挂机时图标隐藏但照常滚动，碰到后按后台流程自动处理
let _encPokeEl = null;      // 滚动的宝可梦 <img>
let _encPokeX = 0;          // 宝可梦当前 X
let _encPokeCharX = 0;      // 主角碰撞点 X
let _encPokeCb = null;      // 碰到主角后的回调（真正开始战斗）
let _encPokeRafActive = false;

function spawnEncounterPoke(poke, shiny, cb) {
  const screen = $('screen');
  const charEl = $('walkGif');
  if (!screen || !charEl) return;
  // 后台挂机（不在主界面）：不做滚动动画，直接进入遇敌（同拾取道具的后台直收逻辑，
  // 且后台 RAF 不推进，动画会永远停在原地）
  if ($('idleView')?.style.display === 'none') {
    if (cb) cb();
    return;
  }
  if (_encPokeEl) return;
  // 容器内放头像 icon，闪光时右上角叠星星标记（同交换页面 NPC 旁的闪光表示）
  const el = document.createElement('div');
  el.className = 'mass-poke';
  screen.appendChild(el);
  const img = document.createElement('img');
  img.className = 'mass-poke-img';
  el.appendChild(img);
  if (shiny) {
    const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    star.setAttribute('viewBox', '0 0 1024 1024');
    star.classList.add('mass-poke-shiny');
    star.innerHTML = '<use xlink:href="./icons/sprites.svg#icon-star"/>';
    el.appendChild(star);
  }
  // 异步加载头像 icon；加载失败则移除并重调度
  tryLoadPokemonIcon(img, poke).then(ok => {
    if (!ok || !el.isConnected) { el.remove(); if (_encPokeEl === el) _encPokeEl = null; }
  });
  const sRect = screen.getBoundingClientRect();
  const cRect = charEl.getBoundingClientRect();
  _encPokeCharX = cRect.left - sRect.left + 24;
  const roadEl = document.querySelector('.road-layer');
  const rRect = roadEl ? roadEl.getBoundingClientRect() : cRect;
  const y = (rRect.top - sRect.top) + 14; // 底边贴近路面
  _encPokeX = sRect.width + 16;
  el.style.left = _encPokeX + 'px';
  el.style.top = y + 'px';
  _encPokeEl = el;
  _encPokeCb = cb;
  startEncPokeRaf();
}

function despawnEncounterPoke() {
  if (_encPokeEl) { _encPokeEl.remove(); _encPokeEl = null; }
  _encPokeCb = null;
  stopEncPokeRaf();
}

function startEncPokeRaf() {
  if (_encPokeRafActive) return;
  _encPokeRafActive = true;
  requestAnimationFrame(_encPokeFrame);
}

function stopEncPokeRaf() {
  _encPokeRafActive = false;
}

function _encPokeFrame() {
  if (!_encPokeRafActive) return;
  // 游戏被占用（已开战/钓鱼中/大量出没事件点）：移除图标，之后重新调度遇敌
  if (phase !== 'idle' || _fishing || inMassZone()) {
    despawnEncounterPoke();
    if (phase === 'idle') scheduleNextEncounter();
    return;
  }
  // 图标丢失（图片加载失败被移除）：结束本次滚动，稍后重新调度遇敌
  if (!_encPokeEl) { despawnEncounterPoke(); scheduleNextEncounter(); return; }
  const isIdleView = $('idleView')?.style.display !== 'none';
  // 后台挂机：图标隐藏但继续滚动，碰到后按后台流程自动处理
  if (!isIdleView) { _encPokeEl.style.display = 'none'; requestAnimationFrame(_encPokeFrame); return; }
  // 道路暂停（拾取道具等）：原地等待
  if (!road.isActive()) { requestAnimationFrame(_encPokeFrame); return; }
  _encPokeEl.style.display = '';
  // 骑车时宝可梦原地等待（与大量出没一致）
  if (road.isBike()) { requestAnimationFrame(_encPokeFrame); return; }

  _encPokeX -= road.getSpeed();
  _encPokeEl.style.left = _encPokeX + 'px';
  if (_encPokeX <= _encPokeCharX) {
    const cb = _encPokeCb;
    despawnEncounterPoke();
    if (cb) cb();
    return;
  }
  if (_encPokeX < -120) { despawnEncounterPoke(); scheduleNextEncounter(); return; } // 走过头（异常兜底）重调度
  requestAnimationFrame(_encPokeFrame);
}

// 道路遇敌宝可梦碰到主角：暂停 buff 倒计时并真正进入战斗
function startRoadEncounter(poke) {
  // 闪耀护符倒计时暂停（滚动期间照常计时，开战才暂停）
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

// ===== 大量出没遭遇：事件宝可梦滚向主角时直接进入战斗 =====
// 锁定事件宝可梦；闪光率固定为大量出没概率，不享受闪耀护符加成（甜甜蜜只加快下一只出现）。
// shiny 为生成时已判定的闪光状态（滚动图标用星星标记），缺省时兜底随机。
export function startMassEncounter(poke, shiny) {
  if (!poke) return;
  setPhase('encounter');
  setEncounterBallsUsed(0);
  setCurrentEncounter(poke);
  setCurrentIsShiny(shiny != null ? shiny : Math.random() < MASS_SHINY_CHANCE);
  beginEncounter(poke, { message: (currentIsShiny ? '野生的 闪光 ' : '野生的 ') + poke.name + ' 迎面冲了过来！', source: 'mass' });
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
    // 互斥恢复：进度条隐藏时「佛系模式」文字重新显示
    const text = $('statAutoText');
    if (text) text.style.display = '';
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
    // 与「佛系模式」文字互斥：倒计时期间只显示进度条
    const text = $('statAutoText');
    if (text) text.style.display = 'none';
  }
}

// 当前遭遇是否极稀有（神兽暂停判定，与稀有度体系一致）
export function isLegendEncounter() {
  return !!currentEncounter && (currentEncounter.rarity ?? 0.5) > 0.8;
}

// ===== 显示遇敌 =====
export function showEncounter(poke, opts = {}) {
  playBattle(); // 进入战斗 → 切换为战斗曲（覆盖地区曲）
  // 每次遇敌 roll 定性别（同一遭遇内固定，供名字/后续"着迷"等性别机制使用）
  _encounterGender = rollGender(poke.index);
  // 兼容旧调用 showEncounter(poke, true)：第二个参数传 true 表示跳过自动操作
  const skipAuto = opts === true || !!opts.skipAuto;
  const msg = opts && typeof opts === 'object' ? (opts.message || null) : null;
  // 如果在非首页页面（图鉴/商店等），将遇敌挂起不切换视图
  const _onHome = $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none';
  // 进入战斗道路必须暂停（后台遇敌同样暂停），结束由 goIdle 统一恢复
  road.pause();
  // 显示视觉画面（仅在首页时切换视图；入场"文案顶起主角"动画由 showView 统一处理）
  if (_onHome) {
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
      // 闪光暂停 / 神兽暂停优先 — 如果开启则不自动处理，强制切到战斗页让用户手动
      if ((currentIsShiny && gameData.settings?.shinyStop) || ((poke.rarity ?? 0.5) > 0.8 && gameData.settings?.legendStop)) {
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
  const gSpan = genderBadge(_encounterGender); // 性别图标（♂ 蓝 / ♀ 粉），放在 Lv 前（跟等级绑定，不跟名字）
  $('encounterName').innerHTML = (currentIsShiny
    ? '<span>' + poke.name + '</span><svg viewBox="0 0 1024 1024" width="14" height="14" style="flex-shrink:0;color:var(--ui-color);"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>'
    : poke.name) + `<span class="encounter-lv">${gSpan}Lv${encounterLevel}</span>`;
  $('encounterName').style.display = '';
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
  $('encounterTypes').style.display = '';
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
  if (_bgReplayActive) return;
  if ((phase !== 'encounter' && !_bgCatch) || !currentEncounter) return;
  if (_throwing) return;
  if ((gameData.items[ballType]||0) <= 0) return;
  setThrowing(true);
  $('fleeBtn')?.classList.add('disabled');
  if (currentIsShiny) stopShinySparkleLoop();
  try {
    // 更新底部文字显示丢出的球种（仅在游戏页显示；孵蛋页等非游戏页不弹）
    if (isOnGameView()) updateTextBox('丢出了' + (ITEM_NAMES[ballType] || ballType) + '！', false);

    gameData.items[ballType]--;
    setEncounterBallsUsed(encounterBallsUsed + 1);
    gameData.stats.totalBallsUsed++;
    currentEncounterBalls[ballType] = (currentEncounterBalls[ballType] || 0) + 1;
    updateBackpack();
    addSystemLog('item_use', { item: ballType, auto: _autoCatching });

    // 捕获加成：逃跑率拉满（50%）后，每多丢一球 +10%，上限 2 倍 —— 能撑过逃跑率上限的奖励
    const catchBonus = catchBonusFor(encounterBallsUsed);
    // 高级球额外 +ULTRA_BALL_ADD 绝对捕获率：对低 catchRate 的稀有宝可梦增幅显著（定位：抓神兽用高级球）
    const rate = ballType === 'master-ball' ? 1.0
      : ((CATCH_RATES[ballType] || 0.30) * (currentEncounter.catchRate ?? 1) + (ballType === 'ultra-ball' ? ULTRA_BALL_ADD : 0)) * catchBonus;
    const isCaught = Math.random() < rate;

    // 丢球瞬间生成全部判定（挣脱轮数 / 是否逃跑）并立即落库：动画只做展示，刷新/重启不丢数据
    let breakRound = 0;
    let willFlee = false;
    if (!isCaught) {
      breakRound = Math.random() < 0.3 ? 0 : (Math.random() < 0.4 ? 1 : (Math.random() < 0.6 ? 2 : 3));
      const fleeChance = Math.min(FLEE_CHANCE + (encounterBallsUsed - 1) * FLEE_CHANCE_INC, FLEE_CHANCE_MAX);
      willFlee = Math.random() < fleeChance;
    }
    const outcome = isCaught ? 'caught' : willFlee ? 'fled' : 'continue';
    const name = currentEncounter.name;
    const idx = String(currentEncounter.index);

    // 立即落库判定（动画播放前）
    if (outcome === 'caught') {
      if (!_bgCatch) setPhase('caught');
      $('fleeBtn').style.display = 'none';
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
      // 入仓库（随机个体值 + 野生等级取当前遇敌等级）
      const entry = addRosterEntry({ species: currentEncounter.index, shiny: currentIsShiny, source: _encounterSource, level: encounterLevel });
      setLastObtainedEntryId(entry.id);
      addSystemLog('pokemon_caught', { pokemon: idx, shiny: currentIsShiny, ball: ballType, auto: _autoCatching });
    } else if (outcome === 'fled') {
      if (!_bgCatch) setPhase('fled'); // 立即阻止再次丢球/逃跑
      $('fleeBtn').style.display = 'none';
      // 记录遭遇日志
      gameData.stats.totalFlees++;
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
      addSystemLog('pokemon_escaped', { pokemon: idx, shiny: currentIsShiny, auto: _autoCatching });
    }
    await saveGame(); // 立即存档：扣球 + 判定结果

    // 后台结算（遭遇被 NPC 对战等打断且玩家不在游戏页）：判定已落库，快照结果跳过动画，
    // 玩家切回游戏页后由 replayBgResult 补播；玩家已在游戏页则照常播放动画
    if (_bgCatch && !isOnGameView()) {
      if (outcome === 'caught' || outcome === 'fled') {
        storeBgResult(outcome, breakRound, ballType);
        cleanupEncounterState();
      }
      return;
    }

    // 播放完整动画（结果已定，纯展示）
    const anim = await playCatchSequence(ballType, outcome, breakRound);

    if (outcome === 'caught') {
      // 后台结算兜底：前台丢球动画中被战斗打断的判定，动画播完后再清理；
      // 玩家不在游戏页时快照结果，切回后补播最终动画
      if (_bgCatch && !isOnGameView()) { storeBgResult('caught', breakRound, ballType); cleanupEncounterState(); return; }
      endBattle(); // 战斗结束：捕捉成功即停战斗曲，胜利音效播完后恢复地区曲
      playVictory(); // 抓捕成功 → 胜利音效
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
      updateStats();
      // 后台结算（遭遇曾被战斗打断）、自动捕捉，或丢球动画期间玩家已离开游戏页（如切到图鉴/商店）：
      // 播完动画即统一收尾。否则手动捕获在离开游戏页后 phase 停在 'caught'、currentEncounter 不清理、
      // 道路不恢复 → 切回挂机页会"主角在跑步但地块不动、不再遇敌"，而图鉴/日志早已记下捕获成功
      if (_bgCatch || _autoCatching || !isOnGameView()) {
        await delay(300);
        stopVictory(); // 与自动捕捉流程一致，关闭胜利音效并恢复背景曲（离开游戏页时确认框不可见，无人点按钮触发）
        // 孵蛋动画进行中：判定已落库，只清理现场不切视图，等孵蛋结束后统一回空闲
        if (_eggHatching || phase === 'eggResult') { cleanupEncounterState(); return; }
        goIdle();
      }
      return;
    }

    // 挣脱/逃跑 通用文案
    const breakMsgs = BREAK_MSGS;

    if (outcome === 'fled') {
      // 后台结算兜底：前台丢球动画中被战斗打断的判定，动画播完后再清理；
      // 玩家不在游戏页时快照结果，切回后补播最终动画
      if (_bgCatch && !isOnGameView()) { storeBgResult('fled', breakRound, ballType); cleanupEncounterState(); return; }
      // 先显示挣脱文案（离开遇敌页则不弹）
      const m = breakMsgs[breakRound] || breakMsgs[1];
      if (isOnGameView()) updateTextBox(m[randInt(0, m.length - 1)], false);
      await delay(800); // 停顿期间禁止丢球（phase='fled'已阻止丢球）
      if (isOnGameView()) updateTextBox('精灵逃走了！', false);
      updateStats();
      // 宝可梦水平翻转并向右下平移出屏
      if (isOnGameView()) await playFleeAnim();
      await delay(300);
      // 孵蛋动画进行中：判定已落库，只清理现场不切视图，等孵蛋结束后统一回空闲
      if (_eggHatching || phase === 'eggResult') { cleanupEncounterState(); return; }
      goIdle();
      return;
    }

    // 没抓住 → 继续丢球（摇晃文案，离开遇敌页则不弹）
    const m = breakMsgs[breakRound] || breakMsgs[1];
    if (isOnGameView()) updateTextBox(m[randInt(0, m.length - 1)], false);
  } finally { setThrowing(false); $('fleeBtn')?.classList.remove('disabled'); if (currentIsShiny && phase === 'encounter') startShinySparkleLoop(); }
  // 丢球动画结束，进度条重置满格重新计时（丢球时重置）
  if (phase === 'encounter') resetAutoFleeTimer();
}

// ===== 逃跑 =====
export async function fleeEncounter(isAutoFlee) {
  if (_bgReplayActive) return;
  if ((phase !== 'encounter' && !_bgCatch) || !currentEncounter) return;
  if (_throwing) return;
  if (phase === 'fled') return; // 防重入
  if (phase === 'caught') return; // 已捕获落库的遭遇不得再标记逃跑，防止覆盖捕获结果
  stopAutoFleeTimer();
  stopShinySparkleLoop();
  if (!_bgCatch) setPhase('fled'); // 立即阻止后续丢球
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
    addSystemLog('player_fled', { pokemon: idx, shiny: currentIsShiny, auto: false });
    if (isOnGameView()) updateTextBox('你逃走了！', false);
  }
  await saveGame();
  updateStats();
  if (_bgCatch && !isOnGameView()) {
    // 后台结算：判定已落库，快照结果供玩家切回游戏页时补播逃跑动画
    storeBgResult('fled', 0, null, { noBall: true, fleeMsg: currentEncounter.name + '逃走了！', fleeAnim: true });
    cleanupEncounterState();
    return;
  }
  setTimeout(() => {
    // 孵蛋动画进行中：判定已落库，只清理现场不切视图，等孵蛋结束后统一回空闲
    if (_eggHatching || phase === 'eggResult') { cleanupEncounterState(); return; }
    goIdle();
  }, isAutoFlee ? 300 : 1200);
}

// ===== 返回空闲状态 =====
export function goIdle() {
  // NPC 对战进行中触发的遭遇收尾（自动捕捉被战斗打断等）：只清理遭遇状态，
  // 不动战斗的 phase / 音乐 / 道路，避免与战斗流程互相干扰
  if (phase === 'battle') {
    cleanupEncounterState();
    return;
  }
  setPhase('idle');
  endBattle(); // 战斗结束 → 停止战斗曲，恢复地区曲
  // 启动即遭遇时 splash 后没弹过歌曲卡：地区曲恢复后补弹一次（仅一次）
  if (consumeShowCardOnEncounterEnd()) showRegionNowPlaying();
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
  // 大量出没事件遭遇结束：剩余数量-1，未抓完则调度下一只事件宝可梦出现（事件区域内由滚动触发遇敌）
  if (inMassZone()) {
    import('./events.js').then(m => m.onMassEncounterEnded());
  }
  // 恢复暂停的 buff 倒计时并重新调度遇敌（遭遇正常结束 / NPC 对战打断后恢复共用）
  resumeEncounterFlow();

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

// ===== 遭遇状态清理（后台结算 / 战斗打断场景共用） =====
// 只清理遭遇相关状态，不动 phase / 战斗音乐 / 道路 / 视图，避免干扰 NPC 对战流程
function cleanupEncounterState() {
  stopAutoFleeTimer();
  stopShinySparkleLoop();
  setCatchConfirmStep(false);
  setCurrentEncounter(null);
  setEncounterBallsUsed(0);
  setCurrentEncounterBalls({ 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 });
  setEncounterMsg(null);
  _encounterSource = 'normal';
  _bgCatch = false;
  // 孵蛋挂起期间遭遇在后台被结算（飞行中的丢球/逃跑收尾等）：取消挂起现场的恢复，
  // 避免孵蛋结束后复活一个已被结算的遭遇
  cancelSuspendedEncounterForEgg();
  document.documentElement.style.removeProperty('--ui-color');
  document.documentElement.style.removeProperty('--ui-color-rgb');
  updateStats();
  if (inMassZone()) {
    import('./events.js').then(m => m.onMassEncounterEnded());
  }
}

// ===== 恢复暂停的 buff 倒计时并重新调度遇敌（goIdle / NPC 对战结束后共用） =====
export function resumeEncounterFlow() {
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
    // 甜甜蜜到期：走统一公共回调（关闭+文案+自动续杯），与激活时的到期行为一致
    setHoneyExpiryTimer(setTimeout(handleHoneyExpired, d));
    startHoneyCountdown();
  } else {
    scheduleNextEncounter();
  }
}

// ===== 遭遇被 NPC 对战打断：转后台异步结算 =====
// 自动捕捉在后台继续丢球（无动画、判定立即落库），战斗期间不受影响；
// 非自动捕捉（或闪光暂停）的遭遇则直接记录为逃跑，避免遇敌静默丢失
export function handoffEncounterToBackground(prevPhase) {
  if (!currentEncounter) return;
  if (prevPhase !== 'encounter' && prevPhase !== 'caught' && prevPhase !== 'fled' && prevPhase !== 'battle') return;
  _bgCatch = true;
  stopAutoFleeTimer();
  stopShinySparkleLoop();
  // 判定已落库的收尾流程中（捕捉成功 / 逃跑的动画或收尾倒计时）：
  // 交给原流程（throwBall / fleeEncounter / goIdle 的 battle 守卫）经 _bgCatch 分支自行清理，
  // 避免对已收服的宝可梦重复丢球或重复记录
  if (prevPhase === 'caught' || prevPhase === 'fled') {
    // 手动捕捉成功后停在"是否查看详情"询问页（无在途丢球动画）：直接清理残留遭遇状态
    if (prevPhase === 'caught' && !_throwing) cleanupEncounterState();
    return;
  }
  if (!gameData.settings?.autoCatch || (currentIsShiny && gameData.settings?.shinyStop) || (isLegendEncounter() && gameData.settings?.legendStop)) {
    // 非自动捕捉（或闪光暂停 / 神兽暂停）：后台直接记录逃跑
    handoffFlee();
    return;
  }
  // 已在捕捉中则由其循环通过 _bgCatch 自动转入后台模式
  if (!_autoCatching) autoCatch();
}

// 等待可能飞行中的手动丢球结束后再后台记录逃跑（避免与 throwBall 的 _throwing 冲突）
async function handoffFlee() {
  while (_throwing) await delay(100);
  await fleeEncounter(true);
}

// ===== 自动捕捉 =====
let _abortAutoCatch = false;

export function setAbortAutoCatch() { _abortAutoCatch = true; }

export async function autoCatch() {
  if (_bgReplayActive) return;
  if (_autoCatching || !currentEncounter) return;
  if (!gameData.settings?.autoCatch) return;
  if ((currentIsShiny && gameData.settings?.shinyStop) || (isLegendEncounter() && gameData.settings?.legendStop)) return;
  if (phase === 'eggResult' || _eggHatching) return; // 孵蛋动画进行中不自动捕捉
  if (phase === 'caught' || phase === 'fled') return; // 判定已落库（捕获/逃跑）的遭遇不再重复捕捉
  const bg = phase !== 'encounter'; // 遭遇被 NPC 对战等打断时进入后台结算模式
  if (bg) _bgCatch = true;
  setAutoCatching(true);
  if (currentIsShiny) stopShinySparkleLoop();
  $('fleeBtn')?.classList.add('disabled');
  try {

  while (currentEncounter && gameData.settings?.autoCatch && !_abortAutoCatch && (phase === 'encounter' || _bgCatch)) {
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
      // 无球 → 记录自动逃跑（后台结算不展示画面、不切换 phase）
      if (!_bgCatch) await delay(AUTO_FLEE_NO_BALL_DELAY);
      if (!_bgCatch && phase !== 'encounter') { setAutoCatching(false); return; }
      if (!_bgCatch) setPhase('fled');
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
      if (_bgCatch && !isOnGameView()) {
        // 后台结算：判定已落库，快照结果供玩家切回游戏页时补播逃跑文案
        storeBgResult('fled', 0, null, { noBall: true, fleeMsg: '你逃走了！' });
        cleanupEncounterState();
      } else {
        if (isOnGameView()) {
          updateTextBox('你逃走了！', false);
          await delay(1500);
        }
        // 孵蛋动画进行中：判定已落库，只清理现场不切视图，等孵蛋结束后统一回空闲
        if (_eggHatching || phase === 'eggResult') { cleanupEncounterState(); }
        else goIdle();
      }
      break;
    }

    // 委托 throwBall 统一处理丢球逻辑（动画、捕获、逃跑、UI文案等）
    $('fleeBtn')?.classList.add('disabled');
    if (_throwing) await delay(100); // 手动丢球在途：等其结束再继续，避免空转 busy-loop
    await throwBall(ballType);

    // 如果仍处于遇敌中（没抓到也没逃跑），加一点延迟继续丢球
    if (phase === 'encounter') {
      await delay(500);
    }
  }

  } catch (e) {
    console.error('autoCatch error:', e);
  } finally {
    _bgCatch = false; // 后台结算结束（无论是否被中止）
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

// ===== 切回游戏页时的后台遭遇恢复 =====
// 后台捕捉仍在进行（_bgCatch 置位且遭遇未结束）：遭遇画面其实仍渲染在 encounterView，
// 直接切回并恢复遇敌相位，后续丢球动画在玩家可见状态下照常播放
export async function resumeBgEncounter() {
  if (!_bgCatch || !currentEncounter) return false;
  setPhase('encounter');
  $('fleeBtn').style.display = 'none';
  showView('encounterView');
  updateTextBox(encounterMsg || (currentIsShiny
    ? '野生的 闪光' + currentEncounter.name + ' 跳出来了！'
    : '野生的 ' + currentEncounter.name + ' 跳出来了！'), false);
  return true;
}

// ===== 补播后台结算结果 =====
// 后台结算（遭遇被 NPC 对战打断）已把最终判定落库并清理遭遇状态；玩家切回游戏页时
// 重建遭遇现场并播放完整捕捉/逃跑动画，避免"结果静默算出、毫无过程"的观感。
// 期间若已开启新的遭遇（玩家离开较久），则不覆盖新遭遇，直接放弃补播。
export async function replayBgResult() {
  const res = consumeBgResult();
  if (!res || !res.poke) return false;
  if (phase === 'encounter' && currentEncounter && currentEncounter !== res.poke) return false;
  const replayToken = ++_bgReplayToken;
  _bgReplayActive = true;

  try {
    // 重建遭遇现场（后台结算时已清理）
    setPhase('encounter');
    setCurrentEncounter(res.poke);
    setEncounterLevel(res.level);
    setCurrentIsShiny(res.shiny);
    setEncounterBallsUsed(0);
    setCurrentEncounterBalls({ 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 });
    setEncounterMsg(res.msg || null);
    _encounterSource = res.source || 'normal';
    showView('encounterView');
    $('fleeBtn').style.display = 'none';
    await renderEncounterScene(res.poke);
    if (!isBgReplayCurrent(replayToken)) return true;

    // 无球逃跑：不播丢球动画，直接播逃跑文案/离场动画
    if (res.noBall) {
      updateTextBox(res.fleeMsg || '你逃走了！', false);
      await delay(1500);
      if (!isBgReplayCurrent(replayToken)) return true;
      updateStats();
      if (res.fleeAnim) {
        await playFleeAnim();
        if (!isBgReplayCurrent(replayToken)) return true;
        await delay(300);
        if (!isBgReplayCurrent(replayToken)) return true;
      }
      goIdle();
      return true;
    }

    // 播放完整丢球动画（判定结果已在后台落库，动画纯展示）
    const anim = await playCatchSequence(res.ballType || 'poke-ball', res.outcome, res.breakRound);
    if (!isBgReplayCurrent(replayToken)) return true;

    if (res.outcome === 'caught') {
      endBattle(); // 战斗结束：捕捉成功即停战斗曲，胜利音效播完后恢复地区曲
      playVictory(); // 抓捕成功 → 胜利音效
      let msg;
      if (res.shiny) {
        msg = '闪闪发光的 ' + res.poke.name + ' 被捕获了！';
      } else if (anim.master) {
        msg = Math.random() < 0.5
          ? '大师球完美锁住了 ' + res.poke.name + '！'
          : '大师球发挥奇效，顺利捕获 ' + res.poke.name + '！';
      } else {
        msg = '搞定！' + res.poke.name + ' 被收服了！';
      }
      updateTextBox(msg, true);
      updateStats();
      await delay(300);
      if (!isBgReplayCurrent(replayToken)) return true;
      stopVictory();
      goIdle();
    } else {
      // 挣脱后逃跑：先播挣脱文案，再播逃走文案与离场动画
      const m = BREAK_MSGS[res.breakRound] || BREAK_MSGS[1];
      updateTextBox(m[randInt(0, m.length - 1)], false);
      await delay(800);
      if (!isBgReplayCurrent(replayToken)) return true;
      updateTextBox('精灵逃走了！', false);
      updateStats();
      await playFleeAnim();
      if (!isBgReplayCurrent(replayToken)) return true;
      await delay(300);
      if (!isBgReplayCurrent(replayToken)) return true;
      goIdle();
    }
  } finally {
    if (_bgReplayToken === replayToken) _bgReplayActive = false;
  }
  return true;
}
