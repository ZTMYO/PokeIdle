import { ENCOUNTER_MIN, ENCOUNTER_MAX, BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX, BUFF_DURATION, BLOCK_TARGET_CHANCE, BLOCK_QUALITY, SHINY_CHANCE, SQUARE_SHINY_CHANCE, CHARM_SHINY_CHANCE, CHARM_UNCAUGHT_CHANCE, CHARM_RARITY_BOOST, HONEY_RARITY_BOOST, ITEM_NAMES, CATCH_RATES, ULTRA_BALL_ADD, AUTO_FLEE_TIMEOUT, AUTO_FLEE_NO_BALL_DELAY, FLEE_CHANCE, FLEE_CHANCE_INC, FLEE_CHANCE_MAX, CANDY_EXCHANGE, TWIST_SHINY_CHANCE, TWIST_GUARANTEED_IVS, LEGEND_LEVEL, massShinyChance, AUTO_CATCH_BALLS_DEFAULT } from './config.js';
import { phase, gameData, allPokemon, getPokemonByIndex, isPowerForm, isWildExcluded, currentEncounter, currentIsShiny, currentIsSquareShiny, encounterLevel, encounterBallsUsed, currentEncounterBalls, nextEncounterTimer, honeyBuffActive, charmBuffActive, charmGuaranteed, blockBuffActive, blockRecipe, blockQuality, honeyCountdownEnd, charmCountdownEnd, honeyPausedRemaining, charmPausedRemaining, honeyExpiryTimer, charmExpiryTimer, honeyCountdownInterval, charmCountdownInterval, _charmEncounterCount, _autoFleeTimer, _autoFleeStartTime, _autoFleeBarInterval, _autoCatching, _throwing, _fishing, _eggHatching, encounterMsg, encounterSource, encounterVariant, saveGame, addSystemLog, getCurrentRegion, hasAnyBall, rand, randInt, setSaveSuspended, inMassZone, inTwistZone, rollGuaranteedIvs, setPhase, setCurrentEncounter, setEncounterLevel, setCurrentIsShiny, setEncounterBallsUsed, setCurrentEncounterBalls, setHoneyBuffActive, setCharmBuffActive, setCharmGuaranteed, setCharmEncounterCount, setHoneyPausedRemaining, setCharmPausedRemaining, setHoneyCountdownEnd, setCharmCountdownEnd, setNextEncounterTimer, setAutoCatching, setThrowing, setCatchConfirmStep, setAutoFleeTimer, setAutoFleeStartTime, setAutoFleeBarInterval, setHoneyExpiryTimer, setCharmExpiryTimer, setHoneyCountdownInterval, setCharmCountdownInterval, setEncounterMsg, addRosterEntry, addEncounterLog, setLastObtainedEntryId, rollGender, genderBadge, wildLevelCap, dexUnlocked, dexShinyOwned, rollShinyResult, setEncounterSource, setEncounterVariant, simNow, setSimClock } from './state.js';
import { $, showView, updateTextBox, hideTextBox, showTextBoxNow, setIdleCharacter, isOnGameView, isIdleStageVisible, isDualLayout, isPageHidden, updateBackpack, updateStats, tryLoadPokemonImage, tryLoadPokemonIcon, isEvolutionShowActive, isEggShowActive, isStageOccupied } from './ui.js';
import { getBountyTargetIndexes } from './bounty.js';
import { pickRandomPokemon, pickWeightedPokemon, findBerryTarget, rollLegendEncounter, activateHoney, activateShinyCharm, clearCharmCountdown, clearHoneyCountdown, startCharmCountdown, startHoneyCountdown, handleHoneyExpired, handleCharmExpired, takeBuffForRenew, clearBuffRenewPending, TYPE_COLORS, cancelSuspendedEncounterForEgg, pickFamily } from './items.js';
import { eatBlock } from './mixer.js';
import { delay, playCatchSequence, playFleeAnim, startShinySparkleLoop, stopShinySparkleLoop } from './animation.js';
import { catchBonusFor, computeObtainScore, computeMeetScore, recordLuck } from './scoring.js';
import { startIdleRotation } from './messages.js';
import { playBattle, endBattle, playVictory, stopVictory, consumeShowCardOnEncounterEnd, showRegionNowPlaying, playShiny, setBulkQuiet } from './audio.js';
import * as road from './road.js';
import * as particles from './particles.js';
import { bgCatchupEnabled } from './background-catchup.js';

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
// 当前遭遇外观变体（时空扭曲：'rgb' / 'polluted' / null）；仅外观，功能等同普通宝可梦
let _encounterVariant = null;
// 丢球动画期间暂停逃跑倒计时保留的剩余毫秒数（null 表示未暂停）
let _autoFleePausedRemaining = null;
// 遭遇被 NPC 对战等打断后转后台结算：置位后丢球/逃跑流程在 phase!=='encounter' 时仍可运行，
// 自动捕捉在后台继续结算（判定立即落库），战斗期间不受影响
let _bgCatch = false;
// 后台挂机补算标记：置位期间自动捕捉按"后台快速结算"处理（不播动画、不切视图），
// 用于恢复前台时把后台停摆期间错过的遭遇批量补算
let _bgCatchup = false;
// 跨越切后台的那只遭遇：结算时间按"切走那一刻"记（10:00 遇到、10:00 收服）。
// 它不是补算出来的，但也绝不能写成回前台的时间，否则相遇日志里会和相遇时刻差几十分钟
let _encounterAt = 0;
export function setEncounterAt(at) { _encounterAt = at > 0 ? at : 0; }
const encounterStamp = () => _encounterAt || simNow();
// 当前遭遇宝可梦性别（每次遇敌 roll 一次；currentEncounter 是共享图鉴对象，直接写 gender 会污染数据源）
let _encounterGender = 'male';
// 事件遭遇（大量出没/时空扭曲）已在后台结算的标记：防止 goIdle 与 cleanupEncounterState
// 两条路径对同一遭遇重复扣减剩余数量（孵蛋挂起期间遭遇被后台结算后又走 goIdle 的场景）
let _eventEncounterSettled = false;
// 指定下一次遇敌的宝可梦（debug.js 的 window.__nextEncounter 写入，用后即焚）
let _debugNextEncounter = null;
export function setDebugNextEncounter(idx, shiny, squareShiny = false) {
  // 纯数字按 4 位编号补零；扩展编号（如 "0058-1"）原样匹配
  const raw = String(idx);
  const dexIdx = /^\d+$/.test(raw) ? raw.padStart(4, '0') : raw;
  _debugNextEncounter = { index: dexIdx, shiny: !!shiny, squareShiny: !!shiny && !!squareShiny };
}

// 手动捕获成功后停在"是否查看详情"确认框（phase='caught'）时离开游戏页（切图鉴/商店/对战列表等）：
// 确认框随视图隐藏后无人点击，若不收尾，返回挂机页会停在"对战中"——道路暂停、不再遇敌，
// 而捕获判定早已落库（宝可梦已在仓库/图鉴）。离开即视为放弃查看详情，直接收尾回空闲。
export function finalizePendingCatch() {
  if (_encPhase !== 'caught' || _bgCatch || _autoCatching || _eggHatching) return false;
  goIdle();
  return true;
}

// ===== 遇敌调度 =====
export function scheduleNextEncounter(delay) {
  if (nextEncounterTimer) { clearTimeout(nextEncounterTimer); setNextEncounterTimer(null); }
  if (phase !== 'idle' && phase !== 'battle') return; // 战斗中也能排：遭遇与对战互不干扰
  // 树果方块：始终按普通间隔遇敌，仅提高目标宝可梦的出现概率
  let d = delay || rand(ENCOUNTER_MIN, ENCOUNTER_MAX) * 1000;
  setNextEncounterTimer(setTimeout(tryEncounter, d));
}

// ===== 遇敌 =====
export async function tryEncounter() {
  // 计时器已触发（或由外部直接调用）：句柄作废，避免后续提前返回时残留旧 id，
  // 使主循环的"调度丢失即补排"兜底误判为已有调度而不再遇敌
  setNextEncounterTimer(null);
  if (_bgCatchup) return; // 后台补算期间由补算循环统一处理遭遇，续杯等定时器触发的遇敌一律忽略
  if (phase !== 'idle' && phase !== 'battle') return; // 战斗中也能遇敌：遭遇有自己的状态，不抢 phase
  if (_encPhase) return; // 已有进行中的遭遇
  if (gameData.wildEncounter) return; // 已有待开战的一只（图标滚动中/未结算）：不再排新的
  if (_fishing) return; // 钓鱼中不遇敌
  // 大量出没/时空扭曲事件路段内不触发普通遇敌：事件宝可梦滚动触发战斗，
  // 数量抓完由 endMassOutbreak / endTwist 重新调度普通遇敌
  if (inMassZone() || inTwistZone()) return;
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

  // 调试辅助：已指定下一次遇敌 → 直接遇这只（用后即焚，不受方块/护符/地区池影响）
  const dbg = _debugNextEncounter;
  if (dbg) {
    _debugNextEncounter = null;
    const dbgPoke = allPokemon.find(p => String(p.index) === dbg.index);
    if (dbgPoke) {
      setCurrentEncounter(dbgPoke);
      setCurrentIsShiny(dbg.shiny, dbg.squareShiny);
      if (charmBuffActive) setCharmEncounterCount(_charmEncounterCount + 1);
      spawnEncounterPoke(dbgPoke, currentIsShiny, () => startRoadEncounter(dbgPoke));
      return;
    }
    console.warn('__nextEncounter: 未找到编号 ' + dbg.index);
  }

  // 选择宝可梦：确保 poke 和 currentEncounter 始终指向同一对象（方块/护符/闪光等判定见 resolveEncounterPoke）
  const poke = resolveEncounterPoke();
  if (!poke) { updateStats(); return; }

  // 遇敌不立即开战：宝可梦图标在道路上从右向左滚向主角（同大量出没表现），
  // 碰到主角才真正进入战斗；滚动期间 buff 照常计时，开战时再暂停
  spawnEncounterPoke(poke, currentIsShiny, () => startRoadEncounter(poke));
}

// 选择本次遭遇的宝可梦（含树果方块/闪耀护符/闪光等 buff 判定），设置 currentEncounter/currentIsShiny；
// 返回 null 表示本次不遇敌（当前地区无可用精灵池）。前台 tryEncounter 与后台补算共用同一套判定
// buffed：这一刻 buff 是否生效。前台调用默认按当前状态，补发时按该场模拟时刻算
function resolveEncounterPoke(buffed = (honeyBuffActive || charmBuffActive),
  buffItem = honeyBuffActive ? 'sweet-honey' : charmBuffActive ? 'shiny-charm' : null) {
  // 确保 poke 和 currentEncounter 始终指向同一对象
  // 神兽与强化形态不进普通遇敌池：神兽只从时空扭曲（加权后）与后续的日程型来源出现
  const regionPool = allPokemon.filter(p => p.region === getCurrentRegion().name && !p.legend && !isPowerForm(p) && !isWildExcluded(p));
  // 稀有度加成跟着「这一刻在跑的那瓶」走：补发模拟时不能读实时 buff 状态
  const rarityBoost = buffItem === 'sweet-honey' ? HONEY_RARITY_BOOST
    : buffItem === 'shiny-charm' ? CHARM_RARITY_BOOST : 0;
  // 树果方块：按 BLOCK_TARGET_CHANCE 提高目标宝可梦的出现概率（命中则方块被吃掉 → buff 结束）
  // 只有已经拥有的目标才具备吸引力，没有时方块仅走里程
  const blockTarget = (blockBuffActive && blockRecipe.length > 0) ? findBerryTarget(blockRecipe) : null;
  const blockTargetOwned = !!blockTarget && dexUnlocked(blockTarget.index);
  // 命中概率随方块品质浮动（无品质记录按兜底概率）
  const blockChance = BLOCK_QUALITY[blockQuality]?.chance ?? BLOCK_TARGET_CHANCE;
  let poke;
  let legendTarget = null;
  if (blockTargetOwned && Math.random() < blockChance) {
    // 高概率直接遇到目标宝可梦
    poke = blockTarget;
    setCurrentEncounter(poke);
    const sr = rollShinyResult();
    setCurrentIsShiny(sr.shiny, sr.squareShiny);
  } else if ((legendTarget = rollLegendEncounter(buffed))) {
    // 每日神兽池：当天在这个地区现身的某只，现身等级固定 20
    poke = legendTarget;
    setCurrentEncounter(poke);
    setEncounterLevel(LEGEND_LEVEL);
    const sr = rollShinyResult();
    setCurrentIsShiny(sr.shiny, sr.squareShiny);
  } else if (((buffed && buffItem === 'shiny-charm') || charmGuaranteed) && regionPool.length > 0) {
    // 护符生效中，或保底还没兑现（到期时没用掉、方块/扭曲压过去了）——后者也要在这里兑现
    const roll = Math.random();
    if (charmGuaranteed || roll < CHARM_SHINY_CHANCE) {
      // 闪光（护符保底的首只必定命中）：保底锁星闪；随机命中才二次判方闪
      const square = charmGuaranteed ? false : Math.random() < SQUARE_SHINY_CHANCE;
      if (charmGuaranteed) setCharmGuaranteed(false);
      poke = pickWeightedPokemon(CHARM_RARITY_BOOST, regionPool);
      setCurrentEncounter(poke);
      setCurrentIsShiny(true, square);
    } else if (roll < CHARM_SHINY_CHANCE + CHARM_UNCAUGHT_CHANCE) {
      // 还没有的精灵（限当前地区）：进化得到的也算已有
      const uncaught = regionPool.filter(p => !dexUnlocked(p.index));
      if (uncaught.length > 0) {
        // 家族归一：多变体家族（未知图腾字母等）只占一个名额，随机出其中一种形态
        poke = pickFamily(uncaught, () => 1);
      } else {
        poke = pickWeightedPokemon(CHARM_RARITY_BOOST, regionPool);
      }
      setCurrentEncounter(poke);
      setCurrentIsShiny(false);
    } else {
      // 其余走普通遇敌：闪光按基础概率重判（稀有度加成由 pickRandomPokemon 内部按增益生效）
      poke = pickRandomPokemon(rarityBoost);
      if (!poke) return null;
      setCurrentEncounter(poke);
      const sr = rollShinyResult();
      setCurrentIsShiny(sr.shiny, sr.squareShiny);
    }
  } else {
    poke = pickRandomPokemon(rarityBoost);
    if (!poke) return null;
    setCurrentEncounter(poke);
    const sr = rollShinyResult();
    setCurrentIsShiny(sr.shiny, sr.squareShiny);
  }
  // 无论哪条路径，只要选中目标宝可梦（未触发直接命中的情况下恰好抽中），方块即被吃掉
  // 还没拥有的目标不算：抽中仅普通遇敌，方块继续走里程
  const blockHit = blockTargetOwned && poke === blockTarget;
  if (blockHit) eatBlock('encounter');
  // 方块期间不吃增益（闪光也走基础概率），被方块吃掉的这只就不算护符的一次遭遇计数
  if (charmBuffActive && !blockHit) setCharmEncounterCount(_charmEncounterCount + 1);
  return poke;
}

// ===== 道路遇敌宝可梦（普通遇敌改为像大量出没一样滚向主角）=====
// 遇敌时机到后先在主界面道路上生成宝可梦图标，从右向左滚向主角（上下跳动），
// 碰到主角才进入战斗；后台挂机时图标隐藏但照常滚动，碰到后按后台流程自动处理
let _encPokeEl = null;      // 滚动的宝可梦 <img>
let _encPokeX = 0;          // 宝可梦当前 X
let _encPokeCharX = 0;      // 主角碰撞点 X
// 遭遇自己的子状态：'encounter' | 'caught' | 'fled' | null。
// NPC 对战期间 phase 归 'battle'，遭遇要能和它并存，所以不能再借 phase 记自己走到哪一步
let _encPhase = null;
// 这一场是否已经结算过（入袋或逃跑）：后台结算（_bgCatch）不切 phase，
// 光靠 _encPhase 防不住第二个流程再结算一次——同一只会既进仓库又记一条逃跑
let _encSettled = false;
export const encState = () => _encPhase;
export function setEncPhase(p) {
  _encPhase = p;
  if (p === 'encounter') _encSettled = false; // 新一场：结算标记复位
  if (phase === 'battle') {
    // 战斗中遭遇收尾（收服/逃跑）：上屏直接回挂机，别等玩家去点文字框箭头——
    // 那时玩家正在下屏打对战，永远等不到，上屏就卡住了
    if (!p) {
      showView('idleView');
      hideTextBox();
    }
    return; // 战斗中：phase 归对战，遭遇只管自己
  }
  // 只有当前 phase 本来就是遭遇态（或本来就没有遭遇、要回到挂机）时才回写，
  // 否则会把别的流程（NPC 对战）的状态顶掉——两边各占一套状态才不会打架
  if (!p && phase !== 'encounter' && phase !== 'caught' && phase !== 'fled') return;
  setPhase(p || 'idle');
}
// 对战结束后 phase 回到哪：遭遇还在就回遭遇，否则回挂机
export function resumePhaseAfterBattle() {
  // 只有确实在战斗中、或还有遭遇在进行时才动 phase：别把孵蛋结算这类状态顶掉
  if (!_encPhase && phase !== 'battle') return;
  setPhase(_encPhase || 'idle');
}
let _encPokeCb = null;      // 碰到主角后的回调（真正开始战斗）
let _encPokeWaitTimer = null; // 上屏被顶掉时自走用的定时器（世界步进器够不着时替代它）
let _encPokeWaiting = false;  // 已在主角脚下等着开战（上屏一腾出来立刻开）
let _encPokeHooked = false; // 已注册到世界步进器（step/render）
// 这只待开战个体自己的种类/闪光/等级：图标滚到脚下这段时间里，这三个全局值可能被别的流程改写
// （孵蛋页等），开战时按这份快照还原，保证打的是图标上亮着的那一只（种类/闪光/等级都不会串）
let _encPokeSnapshot = null;

// 这只图标是否允许存在：挂机中，或上屏被别的流程占着（NPC 对战 / 孵蛋演出，见 _encPokeRender）
function encPokeAlivePhase() {
  return phase === 'idle' || isStageOccupied();
}

// 谁在推进这只图标：路面在走就跟着路面（世界步进器），路面停摆时改用等待定时器。
// 两者只能有一个在推，否则双屏下会两倍速滑向主角
function encPokeWorldDriven() {
  return road.isActive() && !road.isBike() && !_fishing;
}

function spawnEncounterPoke(poke, shiny, cb) {
  const screen = $('screen');
  const charEl = $('walkGif');
  if (!screen || !charEl) return;
  // 待开战这一只落主存档：图标已亮明种类/闪光/等级，刷新或被杀进程后必须还是同一只，否则可无限重摇
  const squareShiny = !!shiny && !!currentIsSquareShiny;
  gameData.wildEncounter = {
    index: poke.index,
    isShiny: !!shiny,
    squareShiny,
    level: encounterLevel,
    source: encounterSource || 'normal',
    variant: encounterVariant || null,
    started: false,
  };
  if (!_bgCatchup) saveGame(); // 后台补算期间逐场落盘会写爆写队列，补算结束统一保存
  // 后台挂机（不在主界面 / 页面不可见）：不做滚动动画，直接进入遇敌（同拾取道具的后台直收逻辑，
  // 且后台 RAF 不推进，动画会永远停在原地）
  if (isPageHidden() || !isIdleStageVisible()) {
    if (road.isBike()) {
      // 骑行中不能遇敌：直接作废这只，避免下车后凭空冒出一场
      gameData.wildEncounter = null;
      scheduleNextEncounter();
      return;
    }
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
    star.innerHTML = '<use xlink:href="#icon-star"/>';
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
  _encPokeSnapshot = { poke, shiny: !!shiny, squareShiny, level: encounterLevel };
  startEncPokeRaf();
}

function despawnEncounterPoke() {
  if (_encPokeEl) { _encPokeEl.remove(); _encPokeEl = null; }
  _encPokeCb = null;
  _encPokeSnapshot = null;
  _encPokeWaiting = false;
  stopEncPokeRaf();
  stopEncPokeWait();
}

// 上屏被顶掉时自己往前走：路面停了（单屏下画面被对战/孵蛋页盖住），步进器不再被调用，
// 这里按同样的 px/秒 推进，让它照常走到主角脚下停住
function startEncPokeWait() {
  if (_encPokeWaitTimer || _encPokeWaiting || !_encPokeEl) return;
  let last = Date.now();
  _encPokeWaitTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    if (!_encPokeEl) { stopEncPokeWait(); return; }
    if (road.isBike()) { stopEncPokeWait(); return; }
    // 上屏交回（占用结束，或世界重新推进这只）：停表，交给步进器 / 立刻开战
    if (!isStageOccupied() || encPokeWorldDriven()) { stopEncPokeWait(); fireEncPokeIfReady(); return; }
    _encPokeX = Math.max(_encPokeCharX, _encPokeX - road.getPxPerSec() * dt);
    _encPokeEl.style.left = road.snapPx(_encPokeX) + 'px';
    if (_encPokeX <= _encPokeCharX) hitEncounterPoke(); // 到脚下：立刻开战
  }, 100);
}

function stopEncPokeWait() {
  if (_encPokeWaitTimer) { clearInterval(_encPokeWaitTimer); _encPokeWaitTimer = null; }
}

// 战斗结束的收尾也调一下：万一脚下那只在等着（计时器没跑到），这里补开
export function fireWaitingEncounter() { fireEncPokeIfReady(); }

// 到主角脚下：立刻开战（遭遇与对战/孵蛋演出并存，各走各的状态）
function hitEncounterPoke() {
  _encPokeWaiting = true;
  fireEncPokeIfReady();
}

// 脚下等着的那只：上屏腾出来了就开战（对战中也能开，遭遇和对战互不干扰）
function fireEncPokeIfReady() {
  if (!_encPokeWaiting) return;
  if (road.isBike()) return; // 骑行中不遇敌：脚下这只留着，下车后再开
  const cb = _encPokeCb;
  const snap = _encPokeSnapshot;
  _encPokeWaiting = false;
  despawnEncounterPoke();
  // 还原这只自己的种类/闪光/等级（别的流程可能借走过这三个全局值）
  if (snap) {
    setCurrentEncounter(snap.poke); // 内部会重摇等级，下面按快照覆盖
    setEncounterLevel(snap.level);
    setCurrentIsShiny(snap.shiny, snap.squareShiny);
  }
  if (cb) cb();
}

// 注册到世界步进器：位置由世界步推进（px/步，与路面同速、与刷新率无关）
function startEncPokeRaf() {
  if (_encPokeHooked) return;
  _encPokeHooked = true;
  road.addStepper(_encPokeStep);
  road.addRender(_encPokeRender);
}

function stopEncPokeRaf() {
  if (!_encPokeHooked) return;
  _encPokeHooked = false;
  road.removeStepper(_encPokeStep);
  road.removeRender(_encPokeRender);
}

// 世界步：图标随路面推进（被占用/离开主界面/骑行时冻结，由 render 负责显隐与收尾）
function _encPokeStep(spd) {
  if (!_encPokeEl) return;
  if (!encPokeAlivePhase()) return;
  if (_fishing || inMassZone() || inTwistZone()) return;
  if (!encPokeWorldDriven()) return; // 上屏被顶掉（单屏对战/孵蛋）：改由等待定时器推进，这里不重复推
  _encPokeX = Math.max(_encPokeCharX, _encPokeX - spd);
  if (_encPokeX <= _encPokeCharX) { hitEncounterPoke(); return; } // 到脚下：立刻开战
  if (_encPokeX < -120) { despawnEncounterPoke(); scheduleNextEncounter(); } // 走过头（异常兜底）重调度
}

// 每帧渲染：显隐与位置；游戏被占用 / 图标丢失的收尾也在这里
function _encPokeRender() {
  // 骑行中不遇敌：图标隐藏并冻结，等下车后再恢复推进/开战
  if (road.isBike()) {
    if (_encPokeEl) _encPokeEl.style.display = 'none';
    stopEncPokeWait();
    return;
  }
  // 上屏被别的流程占着（NPC 对战 / 孵蛋演出在下屏）：这只不清理、照常推进 —— 撞到主角就开战，
  // 遭遇与它们并存（各走各的状态，见 setEncPhase）。世界在走就由步进器推，画面被顶掉时用等待定时器
  if (isStageOccupied() && !inMassZone() && !inTwistZone()) {
    // 上屏还在（双屏：图标照常显示在挂机页上）才画出来；画面被对战/孵蛋页盖住时先藏着，
    // 位置照常推进，等画面回来自然出现在该在的地方（图标 z-index 高于应用页，不藏会飘在页面上）
    if (_encPokeEl) {
      _encPokeEl.style.display = isIdleStageVisible() ? '' : 'none';
      _encPokeEl.style.left = road.snapPx(_encPokeX) + 'px';
    }
    if (encPokeWorldDriven()) stopEncPokeWait(); else startEncPokeWait();
    return;
  }
  stopEncPokeWait();    // 非占用态：推进交回步进器
  fireEncPokeIfReady(); // 占用已结束且这只已经在脚下等着：立刻开战
  // 游戏被占用（已开战/钓鱼中/大量出没/时空扭曲事件点）：移除图标，之后重新调度遇敌
  if (phase !== 'idle' || _fishing || inMassZone() || inTwistZone()) {
    despawnEncounterPoke();
    if (phase === 'idle') scheduleNextEncounter();
    return;
  }
  // 图标丢失（图片加载失败被移除）：结束本次滚动，稍后重新调度遇敌
  if (!_encPokeEl) { despawnEncounterPoke(); scheduleNextEncounter(); return; }
  // 离开主界面：隐藏图标、位置冻结（回来继续滚）
  if (!isIdleStageVisible()) { _encPokeEl.style.display = 'none'; return; }
  _encPokeEl.style.display = '';
  _encPokeEl.style.left = road.snapPx(_encPokeX) + 'px'; // 对齐设备像素：像素材质不因小数偏移反复重采样
}

// 道路遇敌宝可梦碰到主角：暂停 buff 倒计时并真正进入战斗
// 进入战斗前统一暂停 buff 倒计时（普通道路遇敌 / 大量出没共用）：
// 闪耀护符、甜甜蜜暂停计时并清掉到期与遇敌调度，战斗结束后由 resumeEncounterFlow 恢复。
// 滚动期间照常计时，开战才暂停。
// 补算/后台恢复前的 buff 状态同步：倒计时已到期的 buff 走正常到期流程（含自动续杯），
// 避免补算时 buff 已过期却仍按生效状态判定遭遇；补算模拟真实时间推进，因此不暂停倒计时
function syncBuffExpiry() {
  if (charmBuffActive && charmCountdownEnd > 0 && charmCountdownEnd <= Date.now()) handleCharmExpired();
  if (honeyBuffActive && honeyCountdownEnd > 0 && honeyCountdownEnd <= Date.now()) handleHoneyExpired();
}

function pauseEncounterBuffs() {
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
}

function startRoadEncounter(poke, opts) {
  pauseEncounterBuffs();
  setEncPhase('encounter');
  setEncounterBallsUsed(0);
  beginEncounter(poke, opts);
}

// ===== 记录遭遇并展示战斗画面（普通遇敌 / 钓鱼上钩共用） =====
// 遭遇成立时的图鉴记账：普通遇敌 / 钓鱼 / 大量出没 / 时空扭曲 / 后台补算共用这一处。
// 时间戳走 simNow()：后台补算期间会沿用模拟时钟，别写成回前台那一刻
function markEncounterSeen(poke, shiny, source) {
  const idx = String(poke.index);
  if (!gameData.pokedex[idx]) {
    gameData.pokedex[idx] = { seen: 0, caught: 0, lastTime: null, shinySeen: 0, shinyCaught: 0 };
  }
  const d = gameData.pokedex[idx];
  d.seen++;
  d.lastTime = new Date(simNow()).toISOString();
  if (shiny) { d.shinySeen++; gameData.stats.totalShinySeen++; }
  addSystemLog('encounter', { pokemon: poke.index, shiny, source }, simNow());
}

function beginEncounter(poke, opts = {}) {
  _eventEncounterSettled = false; // 新遭遇开始：事件结算标记复位
  _encounterSource = opts.source || 'normal';
  setEncounterSource(_encounterSource); // 同步会话变量：刷新页面恢复遭遇时重建来源
  setCurrentEncounterBalls({ 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 });
  // 遭遇成立：把待开战记录标为已开战，刷新后继续这一场
  gameData.wildEncounter = {
    index: poke.index,
    isShiny: currentIsShiny,
    squareShiny: currentIsShiny && currentIsSquareShiny,
    level: encounterLevel,
    source: _encounterSource,
    variant: encounterVariant || null,
    started: true,
  };
  if (!_bgCatchup) saveGame();

  // 更新图鉴遭遇统计（与后台补算共用一处，免得哪条路径漏记）
  markEncounterSeen(poke, currentIsShiny, _encounterSource);

  showEncounter(poke, opts);
}

// ===== 钓鱼钓到宝可梦：直接进入战斗（文案用"上钩了"） =====
export function startFishingEncounter(poke) {
  if (!poke) return;
  setEncPhase('encounter');
  setEncounterBallsUsed(0);
  setCurrentEncounter(poke);
  // 闪耀护符生效期间，钓鱼钓到的宝可梦同样享受护符闪光加成
  const sr = rollShinyResult(charmBuffActive ? CHARM_SHINY_CHANCE : SHINY_CHANCE);
  setCurrentIsShiny(sr.shiny, sr.squareShiny);
  beginEncounter(poke, { message: (currentIsShiny ? '野生的 闪光' : '野生的 ') + poke.name + ' 上钩了！', source: 'fishing' });
}

// ===== 大量出没遭遇：事件宝可梦滚向主角时直接进入战斗 =====
// 锁定事件宝可梦；闪光率固定为大量出没概率，不享受闪耀护符加成（甜甜蜜只加快下一只出现）。
// shiny 为生成时已判定的闪光状态（滚动图标用星星标记），缺省时兜底随机。
export function startMassEncounter(poke, shiny, squareShiny = false) {
  if (!poke) return;
  // 与普通道路遇敌一致：进入战斗暂停 buff 倒计时（战斗中 buff 不计时，结束后由 resumeEncounterFlow 恢复）
  pauseEncounterBuffs();
  setEncPhase('encounter');
  setEncounterBallsUsed(0);
  setCurrentEncounter(poke);
  if (shiny != null) setCurrentIsShiny(shiny, squareShiny);
  else {
    const sr = rollShinyResult(massShinyChance());
    setCurrentIsShiny(sr.shiny, sr.squareShiny);
  }
  beginEncounter(poke, { message: (currentIsShiny ? '野生的 闪光 ' : '野生的 ') + poke.name + ' 迎面冲了过来！', source: 'mass' });
}

// ===== 时空扭曲遭遇：事件宝可梦滚向主角时直接进入战斗 =====
// 宝可梦与闪光/变体在滚动精灵生成时已判定并随碰撞传入；闪光率固定（不享受闪耀护符）。
// variant：'rgb' / 'polluted' / null，仅外观特效，捕获入库时记录在 entry.variant。
export function startTwistEncounter(poke, shiny, variant, squareShiny = false) {
  if (!poke) return;
  _encounterVariant = variant || null;
  setEncounterVariant(_encounterVariant); // 同步会话变量：刷新恢复后仍显示 RGB/污染特效
  // 与普通道路遇敌一致：进入战斗暂停 buff 倒计时
  pauseEncounterBuffs();
  setEncPhase('encounter');
  setEncounterBallsUsed(0);
  setCurrentEncounter(poke);
  setEncounterLevel(wildLevelCap(poke.index)); // 按野池上限现身
  if (shiny != null) setCurrentIsShiny(shiny, squareShiny);
  else {
    const sr = rollShinyResult(TWIST_SHINY_CHANCE);
    setCurrentIsShiny(sr.shiny, sr.squareShiny);
  }
  beginEncounter(poke, { message: (currentIsShiny ? '野生的 闪光 ' : '野生的 ') + poke.name + ' 从时空扭曲中现身！', source: 'twist' });
}

// ===== 佛系模式：遇敌超时自动逃跑 =====
export function startAutoFleeTimer() {
  stopAutoFleeTimer();
  if (!gameData.settings?.autoFlee) return;
  // 遇敌过滤设为"暂停"：禁止自动逃跑，停在战斗页等玩家手动丢球
  if (catchFilterResult() === 'stop') return;
  setAutoFleeStartTime(Date.now());
  setAutoFleeTimer(setTimeout(() => {
    setAutoFleeTimer(null);
    clearInterval(_autoFleeBarInterval);
    setAutoFleeBarInterval(null);
    // 进度条归零
    const bar = $('statAutoBar');
    if (bar) bar.style.width = '0%';
    // 倒计时结束前复查：期间若开启闪光/神兽暂停则不逃跑，保留手动丢球机会
    if (_encPhase === 'encounter' && currentEncounter
        && catchFilterResult() !== 'stop') {
      fleeEncounter(true);
    }
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

// 回前台校准战斗曲：后台期间遭遇可能已结算完，残留的战斗曲会和地区曲叠着放。
// 仍在遭遇/战斗中则不动
export function syncBattleMusic() {
  const fighting = !!_encPhase || phase === 'battle';
  if (!fighting) endBattle();
}

// 当前遭遇是否神兽（神兽暂停判定，读 pokedex.json 的 legend 字段）
export function isLegendEncounter() {
  return !!currentEncounter && currentEncounter.legend === true;
}

// 恢复待开战记录：同一只、同闪光/等级/来源；started=false 重新滚入，true 直接回战斗画面
// gapSecs：这次启动/回前台跨越的停摆秒数（>0 说明这只遭遇跨了后台，
// 它的结算时间要记回"切走那一刻"，不能记成回来后的时间）
export function restoreWildEncounter(rec, gapSecs = 0) {
  if (!rec) return false;
  if (gapSecs > 0) setEncounterAt(Date.now() - gapSecs * 1000);
  const poke = getPokemonByIndex(String(rec.index));
  if (!poke) {
    gameData.wildEncounter = null;
    return false;
  }
  setCurrentEncounter(poke); // 内部会重摇等级，下面按记录覆盖
  setEncounterLevel(rec.level || encounterLevel);
  setCurrentIsShiny(!!rec.isShiny, !!rec.squareShiny);
  setEncounterSource(rec.source || 'normal');
  setEncounterVariant(rec.variant || null);
  if (rec.started) {
    setEncounterBallsUsed(0);
    setCurrentEncounterBalls({ 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 });
    setEncPhase('encounter');
    showEncounter(poke);
  } else {
    spawnEncounterPoke(poke, !!rec.isShiny, () => startRoadEncounter(poke, { source: rec.source || 'normal' }));
  }
  return true;
}

// 每次遭遇都要重掷性别（同一遭遇内固定，供名字/"着迷"等性别机制使用）。
// 必须两边都调：showEncounter 管正常遭遇，后台补算不走它——只在 showEncounter 里掷的话，
// 补算出的宝可梦会沿用上一只的性别（上一只是无性别宝可梦时，下一只就跟着变成无性别）
function rollEncounterGender(poke) { _encounterGender = rollGender(poke.index); }

// ===== 显示遇敌 =====
export function showEncounter(poke, opts = {}) {
  playBattle(); // 进入战斗 → 切换为战斗曲（覆盖地区曲）
  rollEncounterGender(poke);
  // 兼容旧调用 showEncounter(poke, true)：第二个参数传 true 表示跳过自动操作
  const skipAuto = opts === true || !!opts.skipAuto;
  const msg = opts && typeof opts === 'object' ? (opts.message || null) : null;
  // 如果在非首页页面（图鉴/商店等），将遇敌挂起不切换视图
  const _onHome = isOnGameView();
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
  // 闪光/神兽遭遇：播放闪光音效提示（音效开关控制，独立于音乐/战斗音乐）
  if (currentIsShiny || poke.legend) playShiny();

  // 自动捕捉/自动逃跑：无论玩家当前在哪个页面都照常执行。
  // 后台操作已有 isOnGameView() 分支（不切视图、不弹文案），导航/统计等页面
  // 遇敌后同样立即自动处理，无需切回战斗页才触发。
  if (!skipAuto) {
    // 立绘加载可能卡死（资源协议没回调时 onload/onerror 都不触发，Promise 永远不 resolve）：
    // 自动操作不能等它，否则这一场会一直停在画面上、既不丢球也不结算（玩家看到的就是"上屏卡死"）
    const waitImage = Promise.race([
      loadPromise.catch(() => false),
      new Promise((r) => setTimeout(() => r(false), 4000)),
    ]);
    if (gameData.settings?.autoCatch) {
      // 遇敌过滤优先 — "暂停"则不自动处理，玩家在游戏页时展示战斗页等手动；
      // 在其他页面（图鉴/手机等）不强制跳转，切回游戏页时由 showView 统一接管
      const fr = catchFilterResult();
      if (fr === 'stop') {
        if (_onHome) {
          showView('encounterView');
          $('fleeBtn').style.display = '';
        }
      } else if (fr === 'flee') {
        setTimeout(async () => {
          await waitImage; // 等图片加载完再逃，避免画面残留（最多等 4 秒）
          // 期间玩家关闭了自动模式：取消这次残留的自动逃跑，避免未开自动却出现 [自动] 记录
          if (!gameData.settings?.autoCatch) return;
          fleeEncounter(true);
        }, 800);
      } else {
        const waitMs = hasAnyBall() ? 1500 : 2000;
        setTimeout(async () => {
          await waitImage; // 等图片加载完再丢球，避免尺寸错乱（最多等 4 秒）
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
  // 从会话变量同步来源/变体：刷新页面恢复遭遇时 main.js 已 setEncounterSource/Variant，
  // 这里统一收口，保证私有变量与 state 一致（正常遭遇路径两者本已一致）
  _encounterSource = encounterSource;
  _encounterVariant = encounterVariant;
  const _onHome = isOnGameView();
  const gSpan = genderBadge(_encounterGender); // 性别图标（♂ 蓝 / ♀ 粉），放在 Lv 前（跟等级绑定，不跟名字）
  // 遭遇页标题显示全名（变体如"风速狗-洗翠"），让玩家看清遇到的形态
  $('encounterName').innerHTML = (currentIsShiny
    ? '<span>' + (poke.form || poke.name) + '</span><svg viewBox="0 0 1024 1024" width="14" height="14" style="flex-shrink:0;color:var(--ui-color);"><use xlink:href="#icon-star"/></svg>'
    : (poke.form || poke.name)) + `<span class="encounter-lv">${gSpan}Lv${encounterLevel}</span>`;
  $('encounterName').style.display = '';
  const img = $('encounterGif');
  // 丢球/判定动画进行中（宝可梦在球里）：跳过图片重置与重新加载，
  // 否则会把球里正在摇晃判定的宝可梦又显示出来
  if (!_throwing) {
    // 上一场丢球留下的固定像素舞台会污染新遭遇的首帧，先收回 CSS 铺满规则
    const view = $('encounterView');
    const stage = $('catchStage');
    for (const el of [view, stage]) {
      if (!el) continue;
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
    }
    img.src = '';
    img.style.width = '';
    img.style.height = '';
    img.style.display = '';
    img.style.opacity = '';
    img.style.position = '';
    img.style.left = '';
    img.style.top = '';
    img.style.right = '';
    img.style.bottom = '';
    img.style.margin = '';
    img.style.zIndex = '';
    img.style.transition = '';
    img.style.transform = '';
    img.style.animation = '';
  }
  const shinySuffix = currentIsShiny ? '_shiny' : '';
  // 时空扭曲外观变体特效（RGB / 污染）：作用于宝可梦图片元素，仅外观展示
  img.classList.remove('fx-variant-rgb', 'fx-variant-polluted');
  if (_encounterVariant === 'rgb') img.classList.add('fx-variant-rgb');
  else if (_encounterVariant === 'polluted') img.classList.add('fx-variant-polluted');
  // 右上角外观变体标签（RGB 分离 / 污染）：仅遭遇变体时显示，与图片特效一致
  const variantLabel = $('encounterVariantLabel');
  if (variantLabel) {
    variantLabel.textContent = _encounterVariant === 'rgb' ? '外观：RGB'
      : _encounterVariant === 'polluted' ? '外观：污染' : '';
    variantLabel.style.display = _encounterVariant ? '' : 'none';
  }
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
  // 已拥有标记（普通/闪光分开）：抓到过或进化得到过
  const ownedWrap = $('encounterOwnedWrap');
  if (ownedWrap) {
    const hasOwned = currentIsShiny ? dexShinyOwned(poke.index) : dexUnlocked(poke.index);
    ownedWrap.style.display = hasOwned ? '' : 'none';
    if (hasOwned) {
      const tip = $('encounterOwnedTip');
      if (tip) {
        // 首次捕获时间：取该形态第一条 caught 日志；进化/孵蛋得到的没有
        const logs = (gameData.encounterLogs || {})[String(poke.index)] || [];
        const first = logs.find(l => l.result === 'caught' && !!l.shiny === currentIsShiny);
        if (first && first.time) {
          const d = new Date(first.time);
          const pad = n => String(n).padStart(2, '0');
          tip.textContent = `首次捕获：${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } else if (first) {
          tip.textContent = '首次捕获：较早前';
        } else {
          tip.textContent = '不是亲手捕捉到的，没有捕获记录';
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
    // 宝可梦在场上（非丢球/判定中）才循环闪光；等图片加载完再起，避免第一下拿不到尺寸退到页面中心
    if (currentIsShiny && !_throwing) {
      loadPromise.then(() => requestAnimationFrame(() => {
        if (currentIsShiny && !_throwing && _encPhase === 'encounter') {
          startShinySparkleLoop(currentIsSquareShiny);
        }
      }));
    }
  }
  return loadPromise;
}

// ===== 丢球 =====

export async function throwBall(ballType) {
  if ((_encPhase !== 'encounter' && !_bgCatch) || !currentEncounter) return;
  if (_encSettled) return; // 这一场已结算过（入袋/逃跑），别再丢
  if (_throwing) return;
  // 该球数量为 0：若已勾选自动补球，用糖果补 1 个再丢（手动模式同样生效）；补不了则直接作废
  if ((gameData.items[ballType]||0) <= 0) {
    if (!tryAutoRefill(ballType)) return;
  }
  setThrowing(true);
  $('fleeBtn')?.classList.add('disabled');
  if (currentIsShiny) stopShinySparkleLoop($('encounterView'));
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
      // 随从增益：flee 类降低宝可梦逃跑率（下限 0）
      const fleeChanceRaw = Math.min(FLEE_CHANCE + (encounterBallsUsed - 1) * FLEE_CHANCE_INC, FLEE_CHANCE_MAX);
      const fleeChance = window.__followerBoostMechanic?.('fleeRate', fleeChanceRaw) ?? fleeChanceRaw;
      willFlee = Math.random() < fleeChance;
    }
    const outcome = isCaught ? 'caught' : willFlee ? 'fled' : 'continue';
    if (outcome !== 'continue') _encSettled = true; // 判定落库：这一场不能再被别的流程结算一次
    const name = currentEncounter.name;
    const idx = String(currentEncounter.index);

    // 立即落库判定（动画播放前）
    if (outcome === 'caught') {
      setEncPhase('caught');
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
      // 入仓库（随机个体值 + 野生等级取当前遇敌等级；性别沿用遭遇时 roll 的性别，与遭遇界面一致）
      // 时空扭曲来源：个体值保底 2V（随机 2 项 31），并记录外观变体（仅外观，功能等同普通宝可梦）
      const entry = addRosterEntry({
        species: currentEncounter.index, shiny: currentIsShiny, squareShiny: currentIsSquareShiny, source: _encounterSource,
        level: encounterLevel, gender: _encounterGender,
        ivs: _encounterSource === 'twist' ? rollGuaranteedIvs(currentEncounter.legend ? 3 : TWIST_GUARANTEED_IVS) : undefined,
        variant: _encounterVariant,
        at: _encounterAt, // 跨界遭遇：按切走时刻入档
        ball: ballType,   // 捕获球种（高级筛选「球种」按它筛）
      });
      setLastObtainedEntryId(entry.id);
      // 记录遭遇日志（score 含个体值加成，需先建档拿到 ivs）
      addEncounterLog(idx, {
        time: encounterStamp(), shiny: currentIsShiny, squareShiny: currentIsSquareShiny, result: 'caught',
        balls: { ...currentEncounterBalls }, source: _encounterSource,
        charmBuff: charmBuffActive, // 该遭遇是否处于闪耀护符 buff（影响闪光率评分）
        score: recordLuck(gameData, computeObtainScore({
          pokemon: currentEncounter, source: _encounterSource, shiny: currentIsShiny, squareShiny: currentIsSquareShiny,
          charmBuff: charmBuffActive, honeyBuff: honeyBuffActive,
          balls: currentEncounterBalls, finalRate: rate, ivs: entry.ivs,
          guaranteedIvs: _encounterSource === 'twist' ? (currentEncounter.legend ? 3 : TWIST_GUARANTEED_IVS) : 0,
        })),
      });
      addSystemLog('pokemon_caught', { pokemon: idx, shiny: currentIsShiny, squareShiny: currentIsSquareShiny, ball: ballType, auto: _autoCatching }, encounterStamp());
    } else if (outcome === 'fled') {
      setEncPhase('fled'); // 立即阻止再次丢球/逃跑
      $('fleeBtn').style.display = 'none';
      // 记录遭遇日志
      gameData.stats.totalFlees++;
      addEncounterLog(idx, {
        time: encounterStamp(), shiny: currentIsShiny, squareShiny: currentIsSquareShiny, result: 'fled',
        balls: { ...currentEncounterBalls }, source: _encounterSource,
        charmBuff: charmBuffActive,
        // 未获得宝可梦：score 记"相遇欧气分"（遇到稀有本身也值得加分，无 buff 更高）
        score: recordLuck(gameData, computeMeetScore({
          pokemon: currentEncounter, source: _encounterSource, shiny: currentIsShiny, squareShiny: currentIsSquareShiny,
          charmBuff: charmBuffActive, honeyBuff: honeyBuffActive,
        })),
      });
      addSystemLog('pokemon_escaped', { pokemon: idx, shiny: currentIsShiny, squareShiny: currentIsSquareShiny, auto: _autoCatching }, encounterStamp());
    }
    // 只有这只已经离场（捕获 / 逃走）才作废待开战记录；没抓住、继续丢球时保留，
    // 否则中途被系统杀掉/大退后再进来就找不到这一场了（安卓强杀不写会话存档，只能靠主存档恢复）。
    // 捕获/逃走分支最后都会走 goIdle，那里也会再清一次。
    if (outcome !== 'continue') gameData.wildEncounter = null;
    await saveGame(); // 立即存档：扣球 + 判定结果

    // 浏览器后台（页面不可见，rAF 停摆 / 后台补算）：判定已落库，跳过动画直接收尾，
    // 避免丢球动画在后台卡死（切走时正在丢球，回来还停在宝可梦画面）。无动画无文案，直接回主界面
    if ((document.hidden || _bgCatchup) && !_bgCatch) {
      if (outcome === 'caught' || outcome === 'fled') {
        goIdle();
      }
      return;
    }

    // 舞台不可见（单屏下切到了图鉴/商店等页面）：跳过纯展示的丢球动画，逻辑照常收尾；
    // 可见时（挂机/遇敌页，或双屏常驻的上屏）照常播放
    const stageVisible = isOnGameView();
    const anim = stageVisible ? await playCatchSequence(ballType, outcome, breakRound) : null;

    if (outcome === 'caught') {
      // 收尾判定用"当前"是否在游戏页：丢球动画期间玩家可能已切走
      const onView = isOnGameView();
      if (onView) {
        endBattle(); // 战斗结束：捕捉成功即停战斗曲，胜利音效播完后恢复地区曲
        playVictory(); // 抓捕成功 → 胜利音效
        let msg;
        if (currentIsShiny) {
          msg = '闪闪发光的 ' + name + ' 被捕获了！';
        } else if (anim && anim.master) {
          msg = Math.random() < 0.5
            ? '大师球完美锁住了 ' + name + '！'
            : '大师球发挥奇效，顺利捕获 ' + name + '！';
        } else {
          msg = '搞定！' + name + ' 被收服了！';
        }
        updateTextBox(msg, true);
      }
      updateStats();
      // 自动捕捉、遭遇被对战打断、或玩家不在游戏页时统一收尾。
      // 一律走 goIdle（恢复道路 / 清理遭遇 / 恢复遇敌调度），不再有"只清理不恢复道路"的分支
      if (_bgCatch || _autoCatching || !onView) {
        if (onView) { await delay(300); stopVictory(); } // 离开游戏页时确认框不可见、无人点按钮，这里直接收尾
        // 孵蛋 / 进化演出进行中：单屏时演出占着唯一的屏，只清理现场不切视图（等演出结束再回空闲）；
        // 双屏时演出在下屏、上屏归上屏，照常 goIdle 让上屏回挂机（showView 只切舞台通道，不会动下屏）
        if (!isDualLayout() && (isEggShowActive() || isEvolutionShowActive())) { cleanupEncounterBehindShow(); return; }
        goIdle();
      }
      return;
    }

    // 挣脱/逃跑 通用文案
    const breakMsgs = BREAK_MSGS;

    if (outcome === 'fled') {
      const onView = isOnGameView();
      if (onView) {
        // 先显示挣脱文案，停顿期间禁止丢球（phase='fled' 已阻止丢球）
        const m = breakMsgs[breakRound] || breakMsgs[1];
        updateTextBox(m[randInt(0, m.length - 1)], false);
        await delay(800);
        updateTextBox('精灵逃走了！', false);
      }
      updateStats();
      // 宝可梦水平翻转并向右下平移出屏
      if (onView) { await playFleeAnim(); await delay(300); }
      // 孵蛋 / 进化演出进行中：单屏时演出占着唯一的屏，只清理现场不切视图（等演出结束再回空闲）；
      // 双屏时演出在下屏、上屏归上屏，照常 goIdle 让上屏回挂机（showView 只切舞台通道，不会动下屏）
      if (!isDualLayout() && (isEggShowActive() || isEvolutionShowActive())) { cleanupEncounterBehindShow(); return; }
      goIdle();
      return;
    }

    // 没抓住 → 继续丢球（摇晃文案，离开遇敌页则不弹）
    const m = breakMsgs[breakRound] || breakMsgs[1];
    if (isOnGameView()) updateTextBox(m[randInt(0, m.length - 1)], false);
  } finally { setThrowing(false); $('fleeBtn')?.classList.remove('disabled'); if (currentIsShiny && _encPhase === 'encounter') startShinySparkleLoop(currentIsSquareShiny); }
  // 丢球动画结束，进度条重置满格重新计时（丢球时重置）
  if (_encPhase === 'encounter') resetAutoFleeTimer();
}

// ===== 逃跑 =====
export async function fleeEncounter(isAutoFlee) {
  // 兜底：触发时自动/佛系模式若已全关（定时器/延迟残留走到的自动逃跑路径），
  // 降级为手动逃跑记录，避免日志出现误导性的 [自动] 标识
  if (isAutoFlee && !gameData.settings?.autoFlee && !gameData.settings?.autoCatch) {
    isAutoFlee = false;
  }
  if ((_encPhase !== 'encounter' && !_bgCatch) || !currentEncounter) return;
  if (_throwing) return;
  if (_encSettled) return; // 已结算过（尤其后台结算的捕获）：不再补记一条逃跑
  if (_encPhase === 'fled') return; // 防重入
  if (_encPhase === 'caught') return; // 已捕获落库的遭遇不得再标记逃跑，防止覆盖捕获结果
  stopAutoFleeTimer();
  stopShinySparkleLoop($('encounterView'));
  setEncPhase('fled'); // 立即阻止后续丢球
  const idx = String(currentEncounter.index);
  const logEntry = {
    time: encounterStamp(), shiny: currentIsShiny, squareShiny: currentIsSquareShiny, result: 'fled',
    balls: { ...currentEncounterBalls }, source: _encounterSource,
    charmBuff: charmBuffActive,
    // 主动逃跑（手动 / 佛系自动）属于玩家策略选择，不参与欧气评定（所以不进 recordLuck 窗口）
    selfFlee: true,
    // 未获得宝可梦：score 记"相遇欧气分"（遇到稀有本身也值得加分，无 buff 更高）
    score: computeMeetScore({
      pokemon: currentEncounter, source: _encounterSource, shiny: currentIsShiny, squareShiny: currentIsSquareShiny,
      charmBuff: charmBuffActive, honeyBuff: honeyBuffActive,
    }),
  };
  if (!isAutoFlee) logEntry.manual = true;
  addEncounterLog(idx, logEntry);
  // 自动/手动逃跑都是玩家主动离开：放走宝可梦，不发生精灵逃走动画
  addSystemLog('player_fled', { pokemon: idx, shiny: currentIsShiny, squareShiny: currentIsSquareShiny, auto: !!isAutoFlee }, encounterStamp());
  if (isOnGameView() && !_bgCatchup) updateTextBox('你逃走了！', false);
  await saveGame();
  updateStats();
  if (!isOnGameView()) {
    // 不在游戏页（单屏切到了别的页面）：判定已落库，直接收尾恢复挂机
    goIdle();
    return;
  }
  if (_bgCatchup) { goIdle(); return; } // 后台补算：跳过延迟直接收尾
  setTimeout(() => {
    // 孵蛋 / 进化演出进行中：单屏时演出占着唯一的屏，只清理现场不切视图（等演出结束再回空闲）；
    // 双屏时演出在下屏、上屏归上屏，照常 goIdle 让上屏回挂机（showView 只切舞台通道，不会动下屏）
    if (!isDualLayout() && (isEggShowActive() || isEvolutionShowActive())) { cleanupEncounterBehindShow(); return; }
    goIdle();
  }, isAutoFlee ? 300 : 1200);
}

// ===== 返回空闲状态 =====
export function goIdle() {
  // NPC 对战进行中触发的遭遇收尾（自动捕捉被战斗打断等）：只清理遭遇状态，
  // 不动战斗的 phase 与音乐，避免与战斗流程互相干扰
  if (phase === 'battle') {
    cleanupEncounterState();
    // 道路暂停来自被打断的遭遇开场：收尾后恢复滚动，钓鱼等待期间不动
    if (!_fishing && !road.isActive()) road.resume();
    // 角色姿势必须一并收回走路：拾取等动画的收尾被战斗打断时会跳过自己的恢复，卡在动作帧
    if (!_fishing) setIdleCharacter('walk');
    return;
  }
  setPhase('idle');
  endBattle(); // 战斗结束 → 停止战斗曲，恢复地区曲
  // 这次收尾的遭遇来自哪里：事件计数只认事件来源的遭遇，且要在下面重置来源之前取走。
  // 孵蛋/进化等流程收尾时也会走到 goIdle，那时玩家正好站在事件区域内，白扣一次会让事件提前结束
  const endedSource = _encounterSource;
  // 启动即遭遇时 splash 后没弹过歌曲卡：地区曲恢复后补弹一次（仅一次）
  if (consumeShowCardOnEncounterEnd()) showRegionNowPlaying();
  stopAutoFleeTimer();
  stopShinySparkleLoop($('encounterView'));
  setCatchConfirmStep(false);
  setCurrentEncounter(null);
  setEncPhase(null); // 遭遇态清空：战斗还在的话 phase 保持 'battle'，否则回 idle
  // 这次遭遇的现场到此为止：孵蛋演出挂起的那份快照一并作废，否则孵蛋结束会把已收尾的遭遇复活成僵尸
  cancelSuspendedEncounterForEgg();
  setEncounterBallsUsed(0);
  setCurrentEncounterBalls({ 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 }); // 丢球计数清零，防后台补算跨遭遇累积
  setEncounterMsg(null);
  _encounterSource = 'normal';
  _encounterVariant = null;
  setEncounterSource('normal');
  setEncounterVariant(null);
  // 遭遇已结算：清掉待开战记录并立即落盘，避免刷新后把上一场重新拉出来
  if (gameData.wildEncounter) {
    gameData.wildEncounter = null;
    if (!_bgCatchup) saveGame();
  }
  // 重置 UI 主题色
  document.documentElement.style.removeProperty('--ui-color');
  document.documentElement.style.removeProperty('--ui-color-rgb');
  // 仅在游戏页时切换回空闲视图，浏览其他页面（图鉴/商店等）时不打扰；
  // 后台补算期间玩家本就在主界面，跳过视图切换避免 DOM 反复重建
  // 双屏下上屏是独立通道：下屏在 NPC 对战/其它应用里时同样要收掉上屏的遭遇画面，
  // 否则会停在没有贴图、也没有文字框的半渲染状态
  if (!_bgCatchup && (isOnGameView() || isDualLayout())) {
    showView('idleView');
  }
  updateStats();
  startIdleRotation();
  road.resume();
  $('screen').style.background = '';
  $('screen').style.borderColor = '';
  $('fleeBtn').style.display = 'none';
  setIdleCharacter('walk');
  // 事件遭遇结束：剩余数量-1，未抓完则调度下一只事件宝可梦出现（事件区域内由滚动触发遇敌）；
  // 只有确实来自事件的遭遇才扣（endedSource），否则孵蛋等收尾路过这里会白扣一只；
  // 若已被 cleanupEncounterState 后台结算过（孵蛋挂起等场景）则跳过，避免同一遭遇重复扣减
  if (!_eventEncounterSettled) {
    if (endedSource === 'mass' && inMassZone()) {
      import('./events.js').then(m => m.onMassEncounterEnded());
    }
    if (endedSource === 'twist' && inTwistZone()) {
      import('./events.js').then(m => m.onTwistEncounterEnded());
    }
  }
  _eventEncounterSettled = false;
  // 恢复暂停的 buff 倒计时并重新调度遇敌（遭遇正常结束 / NPC 对战打断后恢复共用）；
  // 后台补算期间不重新调度，避免与补算循环重复遇敌，补算结束时统一收尾
  if (!_bgCatchup) resumeEncounterFlow();
  fireEncPokeIfReady(); // 战斗期间走到脚下等着的这只：现在开战
  // 回到空闲即隐藏底部文本框：showView('idleView') 的隐藏受 isOnGameView 条件限制，
  // 补算/打断等路径可能不触发，这里无条件兜底
  hideTextBox();

  // 战斗结束后检查自动buff是否要续杯（自动操作或佛系模式均触发）
  if (!honeyBuffActive && !charmBuffActive && gameData.settings && (gameData.settings.autoCatch || gameData.settings.autoFlee)) {
    if (takeBuffForRenew('sweet-honey')) {
      console.log('[续杯] 战斗结束 → 自动甜甜蜜', { honeyBuffActive, autoBuffHoney: gameData.settings.autoBuffHoney });
      activateHoney();
    } else if (takeBuffForRenew('shiny-charm')) {
      console.log('[续杯] 战斗结束 → 自动护符', { charmBuffActive, autoBuffCharm: gameData.settings.autoBuffCharm });
      activateShinyCharm();
    }
  }
}

// ===== 孵蛋演出收尾（items.js 的 finalizeEggResultContext 调用）=====
// 孵蛋演出不占游戏阶段：孵蛋期间上屏新打起来的遭遇要能接着打（它有自己的一套状态，见 setEncPhase）。
// 所以这里遇到"还有遭遇在进行"就只把孵蛋这边收手，绝不走 goIdle —— 那会把正在打的那只清掉。
// 确实没有遭遇在进行时才做完整收尾（恢复 buff 倒计时、重排遇敌、回挂机）
export function finishEggResult() {
  if (_encPhase) return;
  goIdle();
}

// 单屏下演出（孵蛋 / 进化）占着唯一那块屏：遭遇只能静默收尾，不切视图（切了会把演出画面顶掉）。
// 阶段交回挂机、道路也放回去（都是遭遇开场时占下的），别让挂机世界一直停着；演出不占阶段，不受影响
function cleanupEncounterBehindShow() {
  cleanupEncounterState();
  setPhase('idle');
  if (!_fishing && !road.isActive()) road.resume();
}

// ===== 遭遇状态清理（后台结算 / 战斗打断场景共用） =====
// 只清理遭遇相关状态，不动 phase / 战斗音乐 / 道路 / 视图，避免干扰 NPC 对战流程
function cleanupEncounterState() {
  stopAutoFleeTimer();
  stopShinySparkleLoop($('encounterView'));
  setCatchConfirmStep(false);
  // 这次收尾的遭遇来自哪里：事件计数只认事件来源的遭遇，要在下面重置来源之前取走
  const endedSource = _encounterSource;
  setCurrentEncounter(null);
  setEncPhase(null); // 遭遇态清空：战斗还在的话 phase 保持 'battle'，否则回 idle
  setEncounterBallsUsed(0);
  setCurrentEncounterBalls({ 'poke-ball': 0, 'ultra-ball': 0, 'master-ball': 0 });
  setEncounterMsg(null);
  _encounterSource = 'normal';
  _encounterVariant = null;
  setEncounterSource('normal');
  setEncounterVariant(null);
  _bgCatch = false;
  // 孵蛋挂起期间遭遇在后台被结算（飞行中的丢球/逃跑收尾等）：取消挂起现场的恢复，
  // 避免孵蛋结束后复活一个已被结算的遭遇
  cancelSuspendedEncounterForEgg();
  // 遭遇已结算：待开战记录同时作废并落盘，否则此时被杀进程重开会把已结算的这一只复活成新遭遇
  if (gameData.wildEncounter) {
    gameData.wildEncounter = null;
    if (!_bgCatchup) saveGame();
  }
  document.documentElement.style.removeProperty('--ui-color');
  document.documentElement.style.removeProperty('--ui-color-rgb');
  updateStats();
  // 事件遭遇结束：剩余数量-1（只有事件来源的遭遇才算，普通清理路过事件区域不能白扣）
  if (endedSource === 'mass' && inMassZone()) {
    import('./events.js').then(m => m.onMassEncounterEnded());
  }
  if (endedSource === 'twist' && inTwistZone()) {
    import('./events.js').then(m => m.onTwistEncounterEnded());
  }
  // 事件结算已在后台执行，后续 goIdle 不再重复扣减
  _eventEncounterSettled = true;
  // 遭遇现场已清理：兜底隐藏底部文本框（后台结算/打断路径不切视图，showView 的隐藏不会触发）
  hideTextBox();
  // 清掉上一只留下的内联位移（逃跑/丢球动画的终点）：不清的话下一只出现时会先闪在上一只的终点位置
  const gif = $('encounterGif');
  if (gif) {
    gif.style.transition = 'none';
    gif.style.transform = '';
    void gif.offsetWidth;
    gif.style.transition = '';
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
  stopShinySparkleLoop($('encounterView'));
  // 判定已落库的收尾流程中（捕捉成功 / 逃跑的动画或收尾倒计时）：
  // 交给原流程（throwBall / fleeEncounter / goIdle 的 battle 守卫）经 _bgCatch 分支自行清理，
  // 避免对已收服的宝可梦重复丢球或重复记录
  if (prevPhase === 'caught' || prevPhase === 'fled') {
    // 手动捕捉成功后停在"是否查看详情"询问页（无在途丢球动画）：直接清理残留遭遇状态
    if (prevPhase === 'caught' && !_throwing) cleanupEncounterState();
    return;
  }
  if (!gameData.settings?.autoCatch) {
    // 未开自动模式：遭遇被打断后后台记逃跑。不标 [自动]，避免玩家误以为开过自动
    handoffFlee(false);
    return;
  }
  if (catchFilterResult() !== 'catch') {
    // 自动捕捉的遇敌过滤命中：属于自动操作，标注 [自动]
    handoffFlee(true);
    return;
  }
  // 已在捕捉中则由其循环通过 _bgCatch 自动转入后台模式
  if (!_autoCatching) autoCatch();
}

// 等待可能飞行中的手动丢球结束后再后台记录逃跑（避免与 throwBall 的 _throwing 冲突）
async function handoffFlee(isAuto) {
  while (_throwing) await delay(100);
  await fleeEncounter(isAuto);
}

// ===== 自动捕捉 =====
// 智能选球：根据精灵捕获率与当前可用球，选出本次丢球用哪种球。
// 设置-自动捕捉里的「闪光 / 神兽使用大师球」勾选后，这两类优先大师球（捕获率极高不逃跑）
function pickAutoBallType(availableBalls) {
  const cr = currentEncounter?.catchRate ?? 1;
  // 两个「专供」开关：勾上任意一个就把大师球留给这几类，普通遭遇不再拿它兜底，
  // 免得前两种球用光后把大师球丢在随手碰到的宝可梦身上。都不勾 = 老样子（大师球仍可兜底）
  const enabledBalls = gameData.settings?.autoCatchBalls || AUTO_CATCH_BALLS_DEFAULT;
  const shinyLegendOn = !!gameData.settings?.shinyLegendMasterBall;
  const variantOn = !!gameData.settings?.variantMasterBall && !!_encounterVariant;
  const reserve = shinyLegendOn || !!gameData.settings?.variantMasterBall;
  const useMaster = (shinyLegendOn && (!!currentIsShiny || !!currentEncounter?.legend))
    || variantOn
    || !!currentEncounter?.legend; // 神兽保持老规矩：无条件优先大师球
  // 除大师球外还有别的球被勾选吗：没有的话（只勾了大师球）预留逻辑不成立 ——
  // 大师球就是唯一能用的球，扔它好过逃跑（手上有大师球却把闪光放跑）
  const othersEnabled = ['poke-ball', 'ultra-ball'].some((b) => enabledBalls[b] !== false);
  // 难抓（≤10%）时老规矩是直接上大师球；但勾了「专供」就不许它再兜底，
  // 否则这两类之外的宝可梦（哪怕只是难抓的普通货）也会被大师球吃掉
  const preferred = useMaster || (!reserve && cr <= 0.1)
    ? ['master-ball', 'ultra-ball', 'poke-ball']
    : reserve
    ? (cr <= 0.5 ? ['ultra-ball', 'poke-ball'] : ['poke-ball', 'ultra-ball'])
    : (cr <= 0.5 ? ['ultra-ball', 'poke-ball', 'master-ball'] : ['poke-ball', 'ultra-ball', 'master-ball']);
  for (const b of preferred) {
    if (availableBalls.includes(b)) return b;
  }
  // 没球可用：勾了专供、这场又不值得动大师球、且还有别的球可选 → 返回空，交给上层按"无球"自动逃跑；
  // 否则照老样子兜底（只勾了大师球时必须兜底，不能逃跑）
  return reserve && !useMaster && othersEnabled ? null : (availableBalls[0] || null);
}

// 单行策略判定：逃跑 > 暂停 > 未拥有 > 等级范围（skipLevel 行不参与等级筛选）
function evalCatchRow(row, skipLevel = false) {
  if (row.action === 'flee') return 'flee';
  if (row.action === 'stop') return 'stop';
  // 捕捉：仅捕捉未捕获过的 → 仓库里已有对应形态直接放跑（普通看非闪个体、闪光看闪光个体）
  if (row.uncaughtOnly) {
    const idx = String(currentEncounter?.index);
    const has = (gameData.roster || []).some(p => p.inRoster && String(p.species) === idx && (currentIsShiny ? p.shiny : !p.shiny));
    if (has) return 'flee';
  }
  // 等级范围（0 = 不限制）
  if (!skipLevel) {
    const lvMin = row.levelMin || 0;
    const lvMax = row.levelMax || 0;
    if ((lvMin > 0 && encounterLevel < lvMin) || (lvMax > 0 && encounterLevel > lvMax)) return 'flee';
  }
  return 'catch';
}

// 遇敌过滤（设置-捕捉条件表格）：返回 'catch'（照常捕捉）| 'stop'（暂停自动操作等手动）| 'flee'（直接逃跑）
// 六类策略：普通 / 普通闪 / 神兽 / 神兽闪 / 可悬赏 / 特效，各自独立选择 捕捉/暂停/逃跑，
// 并各自带等级范围（0=不限制）与「仅捕捉未拥有过的」（普通看仓库非闪个体、闪光看仓库闪光个体）。
// 优先级：特效 > 神兽/神兽闪 > 普通/普通闪 > 可悬赏。特效行接管该事件全部遭遇（含神兽/闪光）；
// 神兽按类型行硬约束判定；普通遭遇命中今日悬赏时，先由普通/普通闪行裁决，放行捕捉后才轮到可悬赏行兜底。
export function catchFilterResult() {
  const f = gameData.settings?.catchFilter || {};
  const rows = f.rows || {};
  // 特效（时空扭曲事件）专属行（最高优先级）：事件内普通/神兽/闪光一律按此行裁决，不再受普通/神兽行与等级/未捕获约束
  if (_encounterSource === 'twist') {
    return evalCatchRow(rows.twist || { action: 'catch', levelMin: 0, levelMax: 0, uncaughtOnly: false });
  }
  const isLegend = isLegendEncounter();
  // 神兽/神兽闪行（最高优先级）：神兽按类型行判定，可悬赏行不作用于神兽
  if (isLegend) {
    const row = (currentIsShiny ? rows.legendShiny : rows.legend)
      || { action: 'catch', levelMin: 0, levelMax: 0, uncaughtOnly: false };
    return evalCatchRow(row);
  }
  // 普通/普通闪行（优先于可悬赏行）：普通遭遇一律先按该行策略执行
  const typeRow = (currentIsShiny ? rows.normalShiny : rows.normal)
    || { action: 'catch', levelMin: 0, levelMax: 0, uncaughtOnly: false };
  const fr = evalCatchRow(typeRow);
  // 普通/普通闪行明确暂停/逃跑时直接采纳，不再落入可悬赏行
  if (fr !== 'catch') return fr;
  // 普通/普通闪行放行捕捉，且命中今日悬赏目标 → 由可悬赏行兜底最终决策
  if (currentEncounter && getBountyTargetIndexes().has(String(currentEncounter.index))) {
    return evalCatchRow(rows.bounty || { action: 'catch', levelMin: 0, levelMax: 0, uncaughtOnly: false });
  }
  return 'catch';
}

// 自动补球：勾选的球数量为 0 时，用糖果按补球优先级补 1 个（手动/自动丢球都生效）。
// onlyBall 指定时只补该球（手动点击丢球用）；否则在勾选且为 0 的球里按 autoRefillOrder 顺序补。
// 返回是否补到了球
export function tryAutoRefill(onlyBall = null) {
  if (!gameData.settings?.autoRefill) return false;
  const refillBalls = gameData.settings?.autoRefillBalls || {};
  let targets;
  if (onlyBall) {
    targets = refillBalls[onlyBall] !== false ? [onlyBall] : [];
  } else {
    const order = Array.isArray(gameData.settings?.autoRefillOrder) && gameData.settings.autoRefillOrder.length === 3
      ? gameData.settings.autoRefillOrder
      : ['poke-ball', 'ultra-ball', 'master-ball']; // 默认便宜优先
    targets = order.filter(b => refillBalls[b] !== false && (gameData.items[b] || 0) === 0);
  }
  for (const b of targets) {
    const price = CANDY_EXCHANGE[b];
    if (price != null && (gameData.items.candy || 0) >= price) {
      gameData.items.candy -= price;
      gameData.items[b] = (gameData.items[b] || 0) + 1;
      gameData.stats.totalItemsEarned[b] = (gameData.stats.totalItemsEarned[b] || 0) + 1; // 自动补球计入道具获得
      addSystemLog('auto_refill', { ball: b, cost: price });
      updateBackpack();
      return true;
    }
  }
  return false;
}

export async function autoCatch() {
  if (_autoCatching || !currentEncounter) return;
  if (!gameData.settings?.autoCatch) return;
  // 遇敌过滤：不匹配直接逃跑；设为"暂停"则停手等手动丢球
  const fr = catchFilterResult();
  if (fr === 'flee') { stopAutoFleeTimer(); await fleeEncounter(true); return; }
  if (fr === 'stop') return;
  // 孵蛋 / 进化演出不再拦自动捕捉：双屏下遭遇在上屏照常打（下屏演出各走各的），
  // 单屏下演出占着唯一那块屏，下面的 throwBall/flee 分支会静默结算、不切视图
  if (_encPhase === 'caught' || _encPhase === 'fled') return; // 判定已落库（捕获/逃跑）的遭遇不再重复捕捉
  const bg = _encPhase !== 'encounter'; // 遭遇被 NPC 对战等打断时进入后台结算模式
  if (bg) _bgCatch = true;
  setAutoCatching(true);
  if (currentIsShiny) stopShinySparkleLoop($('encounterView'));
  $('fleeBtn')?.classList.add('disabled');
  try {

  while (currentEncounter && gameData.settings?.autoCatch && (_encPhase === 'encounter' || _bgCatch)) {
    // 上一只收尾时 goIdle 可能同步开出脚下排队的下一只：每轮都按当前这只重查过滤，
    // 否则会把新遇到的闪光/神兽直接沿用上一只的“捕捉”策略自动抓掉
    const fr = catchFilterResult();
    if (fr === 'stop') break;
    if (fr === 'flee') { stopAutoFleeTimer(); await fleeEncounter(true); break; }
    // 智能选球：根据精灵捕获率决定使用哪种球
    const enabledBalls = gameData.settings?.autoCatchBalls || AUTO_CATCH_BALLS_DEFAULT;
    let availableBalls = ['poke-ball', 'ultra-ball', 'master-ball'].filter(b => enabledBalls[b] !== false && (gameData.items[b]||0) > 0);
    let ballType = availableBalls.length > 0 ? pickAutoBallType(availableBalls) : null;

    // 自动补球：无球可用时用糖果补 1 个（便宜优先），补完重新选球（避免无球直接逃跑）
    if (!ballType && tryAutoRefill()) {
      availableBalls = ['poke-ball', 'ultra-ball', 'master-ball'].filter(b => enabledBalls[b] !== false && (gameData.items[b]||0) > 0);
      ballType = availableBalls.length > 0 ? pickAutoBallType(availableBalls) : null;
    }

    if (!ballType) {
      if (_encSettled) break; // 已结算过（后台入袋）：别再记一条无球逃跑
      // 无球 → 记录自动逃跑（后台结算不展示画面、不切换 phase）
      if (!_bgCatch && !document.hidden && !_bgCatchup) await delay(AUTO_FLEE_NO_BALL_DELAY);
      if (!_bgCatch && _encPhase !== 'encounter') { setAutoCatching(false); return; }
      setEncPhase('fled');
      const idx = String(currentEncounter.index);
      addSystemLog('player_fled', { pokemon: idx, shiny: currentIsShiny, squareShiny: currentIsSquareShiny, auto: true }, encounterStamp());
      addEncounterLog(idx, {
        time: encounterStamp(), shiny: currentIsShiny, squareShiny: currentIsSquareShiny, result: 'fled',
        balls: { ...currentEncounterBalls }, manual: false, source: _encounterSource,
        charmBuff: charmBuffActive,
        // 无球自动逃跑属于自动操作策略，不参与欧气评定（所以不进 recordLuck 窗口）
        selfFlee: true,
        // 未获得宝可梦：score 记"相遇欧气分"（遇到稀有本身也值得加分，无 buff 更高）
        score: computeMeetScore({
          pokemon: currentEncounter, source: _encounterSource, shiny: currentIsShiny, squareShiny: currentIsSquareShiny,
          charmBuff: charmBuffActive, honeyBuff: honeyBuffActive,
        }),
      });
      gameData.wildEncounter = null;   // 同上：判定落库即作废待开战记录
      await saveGame();
      updateStats();
      if (!isOnGameView()) {
        // 不在游戏页（单屏切到了别的页面）：判定已落库，直接收尾恢复挂机
        goIdle();
      } else {
        if (isOnGameView() && !document.hidden && !_bgCatchup) {
          updateTextBox('你逃走了！', false);
          await delay(1500);
        }
        // 孵蛋 / 进化演出进行中：单屏时演出占着唯一的屏，只清理现场不切视图（等演出结束再回空闲）；
        // 双屏时演出在下屏、上屏归上屏，照常 goIdle 让上屏回挂机（showView 只切舞台通道，不会动下屏）
        if (!isDualLayout() && isEggShowActive()) { cleanupEncounterBehindShow(); }
        else goIdle();
      }
      break;
    }

    // 委托 throwBall 统一处理丢球逻辑（动画、捕获、逃跑、UI文案等）
    $('fleeBtn')?.classList.add('disabled');
    if (_throwing && !_bgCatchup) await delay(100); // 手动丢球在途：等其结束再继续，避免空转 busy-loop
    await throwBall(ballType);

    // 如果仍处于遇敌中（没抓到也没逃跑），加一点延迟继续丢球；
    // 浏览器后台/补算时跳过等待，连续快速结算下一球
    if (_encPhase === 'encounter') {
      if (!document.hidden && !_bgCatchup) await delay(500);
    }
  }

  } catch (e) {
    console.error('autoCatch error:', e);
  } finally {
    _bgCatch = false; // 后台结算结束
    if (currentIsShiny && _encPhase === 'encounter') startShinySparkleLoop(currentIsSquareShiny);
    $('fleeBtn')?.classList.remove('disabled');
    setAutoCatching(false);
  }
}

// ===== 后台挂机遇敌补算 =====
// 浏览器后台期间遇敌调度被节流（15~30 秒 → 约 1 分钟），恢复前台时把停摆期间错过的遭遇
// 按前台节奏补算。仅自动操作（捕捉/佛系）开启时有效：逐次走真实选宝可梦 + 自动捕捉快速结算，
// 不播动画不切视图，判定/入账/日志全部复用正常流程，保证数据与前台等效。
// 补算途中撞上"暂停"即停：主角卡在那只上不前进，剩余停摆时长交回调用方丢弃

export async function catchUpEncounters(secs, buffRemainingMs) {
  if (!bgCatchupEnabled()) return; // 后台补发开关关闭时（如安卓沿用离线暂停哲学）不做任何遇敌补算
  // 「离开那一刻 buff 还剩多少」：快照优先；没有快照就把绝对到期时刻回推到离开时刻。
  // 以前这里取的是「现在还剩多少」，离开期间已经过期的会算成 0 —— 整段停摆就被当成全程无 buff，
  // 自动续杯自然也不会模拟，表现就是开着护符补发出一堆普通宝可梦。
  // 回推值按一瓶时长封顶：期间定时器可能已经续过杯，绝对时刻会变成新的到期点。
  const hideAt = Date.now() - secs * 1000;
  const leftAtHide = (endMs) => (endMs > 0 ? Math.min(BUFF_DURATION, Math.max(0, endMs - hideAt) / 1000) : 0);
  const honeyLeft = honeyPausedRemaining > 0 ? honeyPausedRemaining : leftAtHide(honeyCountdownEnd);
  const charmLeft = charmPausedRemaining > 0 ? charmPausedRemaining : leftAtHide(charmCountdownEnd);
  const simItem = (honeyBuffActive || honeyLeft > 0) ? 'sweet-honey'
    : (charmBuffActive || charmLeft > 0) ? 'shiny-charm' : null;
  const snapSec = Math.min(BUFF_DURATION, Math.max(0, (buffRemainingMs || 0) / 1000));
  const buffLeftSec = snapSec > 0 ? snapSec
    : simItem === 'sweet-honey' ? honeyLeft
      : simItem === 'shiny-charm' ? charmLeft
        : 0;
  syncBuffExpiry(); // 恢复前先同步 buff 到期状态（过期自动续杯）：与是否补遭遇无关，
                    // 骑行/钓鱼等暂停补算的守卫会提前 return，若不在此处先同步，骑行中后台到期的 buff 会漏续杯
  if (_bgCatchup || _bgCatch) return;
  if (phase !== 'idle' || _fishing || inMassZone() || inTwistZone() || road.isBike()) return;
  const autoActive = gameData.settings?.autoCatch || gameData.settings?.autoFlee;
  if (!autoActive) return;
  // 遇敌节奏与 buff 联动：buff 期间 15~30s 一次，平时 120~240s 一次
  const buffAvg = (BUFF_ENCOUNTER_MIN + BUFF_ENCOUNTER_MAX) / 2;
  const normalAvg = (ENCOUNTER_MIN + ENCOUNTER_MAX) / 2;
  const activeItem = simItem;   // 这段窗口里真正在跑的瓶子（按离开时算，回前台续的杯不算）
  let nextBottleAt = buffLeftSec;   // 下一瓶的起点：第一瓶剩下的用完后开始续
  // 离开时确实有 buff 在跑，才按自动续杯接着烧（一瓶 = BUFF_DURATION 秒）。
  // 这里只算"要续几瓶"，真扣道具放到补算结束后按实际模拟到的时刻结算（撞上暂停时不多扣）
  let buffSec = Math.min(secs, buffLeftSec);
  const renewPlan = [];
  if (buffLeftSec > 0) {
    // 这段窗口由补发按时间线自己续杯：清掉后台到期时记下的待续，免得回前台再白烧一瓶
    clearBuffRenewPending();
    const stock = { 'sweet-honey': gameData.items['sweet-honey'] || 0, 'shiny-charm': gameData.items['shiny-charm'] || 0 };
    const on = { 'sweet-honey': !!gameData.settings?.autoBuffHoney, 'shiny-charm': !!gameData.settings?.autoBuffCharm };
    for (let guard = 0; buffSec < secs && guard < 3000; guard++) {
      const item = ['sweet-honey', 'shiny-charm'].find((k) => on[k] && stock[k] > 0);
      if (!item) break;
      stock[item]--;
      renewPlan.push(item);
      buffSec = Math.min(secs, buffSec + BUFF_DURATION);
    }
  }
  const renewUse = { 'sweet-honey': 0, 'shiny-charm': 0 };
  const buffLeftover = Math.max(0, buffLeftSec - Math.min(secs, buffLeftSec)); // 停摆窗口走完后原 buff 的剩余
  const total = Math.min(Math.floor(buffSec / buffAvg) + Math.floor((secs - buffSec) / normalAvg), 2000); // 单次补算上限（防超长后台卡顿）
  if (total <= 0) return;
  // 路上还压着一只没走到主角面前的（刷新/重开后恢复的滚动图标）：把它并进补发的第一场，图标撤掉不再单独开战。
  // 否则补算会另摇一只，紧接着图标那只再开战，两只撞在一起——每日神兽池就一两只，撞上就是同一只神兽连出
  let pending = null;
  if (_encPokeEl) {
    const snap = _encPokeSnapshot;
    if (snap && snap.poke) {
      pending = { poke: snap.poke, shiny: !!snap.shiny, squareShiny: !!snap.squareShiny, level: snap.level };
    }
    despawnEncounterPoke(); // 不重排：这一场交给下面的补发循环
    gameData.wildEncounter = null;
  }
  _bgCatchup = true;
  // 逐场结算不播音效、不逐场落盘：一次返回连着结算上百场时既吵又慢，结束时统一保存
  setBulkQuiet(true);
  setSaveSuspended(true);
  let done = 0, balls = 0, shinies = 0;
  let stalledSec = null; // 停摆窗口里真正走过的秒数，全程走完为 null
  const caught = []; // 补算期间捕获成功的宝可梦（含形态名），随汇总日志打印便于核对
  // 把 total 场按停摆窗口均匀铺开：每场的日志/获得时间写成"当时"，日志页就是一条连续时间线
  const startAt = Date.now() - secs * 1000;
  const stepMs = total > 0 ? (secs * 1000) / total : 0;
  try {
    for (let i = 0; i < total; i++) {
      if (phase !== 'idle' || road.isBike()) break; // 玩家切走/进入战斗/开始骑行：中止剩余补算
      setSimClock(startAt + Math.round(i * stepMs));
      let poke;
      if (pending) {
        // 屏上压着的那只：按图标当时的种类/闪光/等级还原，不重摇
        poke = pending.poke;
        setCurrentEncounter(poke);
        setEncounterLevel(pending.level || encounterLevel);
        setCurrentIsShiny(pending.shiny, pending.squareShiny);
        pending = null;
      } else {
        const t = (i * stepMs) / 1000; // 这一场落在停摆窗口的第几秒
        // 每一瓶护符都自带一次保底闪光（activateShinyCharm 会置 charmGuaranteed）：
        // 补发按瓶推进，进到新的一瓶就把保底重新上膛，否则续十瓶也只兑现一次
        if (simItem === 'shiny-charm' && t >= nextBottleAt) {
          setCharmGuaranteed(true);
          nextBottleAt = t + BUFF_DURATION;
        }
        const buffed = t < buffSec; // 这一刻 buff 还在不在
        poke = resolveEncounterPoke(buffed, simItem);
        if (!poke) break;
      }
      rollEncounterGender(poke); // 补算不走 showEncounter，这里必须自己掷
      // 补算同样不走 beginEncounter：来源/变体按普通遇敌重置，图鉴「遭遇」也要记一笔——
      // 漏记会让统计页出现"今日遭遇比累计还多"（补发的捕获进了今日日志，累计却没加）
      _encounterSource = 'normal';
      _encounterVariant = null;
      setEncounterSource('normal');
      setEncounterVariant(null);
      markEncounterSeen(poke, currentIsShiny, 'normal');
      const ballsBefore = gameData.stats.totalBallsUsed;
      const catchesBefore = gameData.stats.totalCatches;
      const shiny = currentIsShiny;
      setEncPhase('encounter'); // 直接进入遭遇（跳过滚动图标，等同后台直收）
      if (gameData.settings?.autoCatch) {
        await autoCatch();
      } else {
        await fleeEncounter(true); // 仅佛系模式：直接记自动逃跑（跳过倒计时等待）
      }
      // 撞上"暂停"（或自动捕捉没能结算：异常 / 没球补不了）：主角停在这只上，后面的停摆时长不再补。
      // 这里打一行控制台，下次玩家再报"只有遇到没有结果"，能直接看出是哪条分支
      if (encState() === 'encounter') {
        stalledSec = Math.round((i * stepMs) / 1000);
        console.warn('[挂机补发] 停在未结算的遭遇：', (poke.form || poke.name),
          'filter=', catchFilterResult(), 'autoCatch=', !!gameData.settings?.autoCatch,
          'balls=', JSON.stringify(currentEncounterBalls), 'candy=', gameData.items?.candy || 0);
        // 暂停档（神兽/闪光）在补发里停下：这只必须真的回到屏上交给玩家，
        // 补发本身不切视图，不摆出来的话它会变成一个看不见的"进行中"遭遇，
        // 之后被随便哪个流程清掉，日志里就只剩一条没下文的「遇到」
        if (currentEncounter) {
          try { showEncounter(currentEncounter, { skipAuto: true }); } catch (_) {}
        }
        break;
      }
      done++;
      balls += gameData.stats.totalBallsUsed - ballsBefore;
      if (shiny) shinies++;
      if (gameData.stats.totalCatches > catchesBefore) caught.push((poke.form || poke.name) + (shiny ? '(闪光)' : ''));
      if (i % 20 === 19) await delay(0); // 让出主线程，保证 UI 响应
      if (i % 100 === 99) { // 每 100 场落一次盘：补算中途被杀进程不至于整段丢
        setSaveSuspended(false);
        await saveGame();
        setSaveSuspended(true);
      }
    }
  } catch (e) {
    console.error('[挂机补发] 遇敌补算异常:', e);
    // 异常把这一场断在半路时收个尾：只留一条"遇到"、没有捕获/逃跑记录的话，
    // 玩家会看到一条没下文的幽灵日志（图鉴也只涨"见过"却查不到任何相遇）
    if (encState() === 'encounter' && currentEncounter) {
      try { await fleeEncounter(true); } catch (_) {}
    }
  } finally {
    _bgCatchup = false;
    setSimClock(0);
    // 补发把这段 buff 真用掉了：从暂停剩余里扣掉；用光的走正常到期（自动续杯会真扣一瓶），
    // 否则会留下一个没有倒计时的“永久 buff”，神兽率一直被按加成判
    if (activeItem === 'sweet-honey') {
      if (honeyPausedRemaining > 0) setHoneyPausedRemaining(buffLeftover);
      else if (honeyCountdownEnd > 0) setHoneyCountdownEnd(Math.max(0, honeyCountdownEnd - buffSec * 1000));
    } else if (activeItem === 'shiny-charm') {
      if (charmPausedRemaining > 0) setCharmPausedRemaining(buffLeftover);
      else if (charmCountdownEnd > 0) setCharmCountdownEnd(Math.max(0, charmCountdownEnd - buffSec * 1000));
    }
    resumeEncounterFlow(); // 补算结束统一恢复 buff 倒计时与遇敌调度
    if (activeItem && buffLeftSec > 0 && buffLeftover <= 0) {
      if (activeItem === 'sweet-honey') handleHoneyExpired();
      else handleCharmExpired();
    }
    setBulkQuiet(false); // 恢复背景曲（补算期间的闪光提示音在此一并补播）
    // 补发续杯：按真正模拟到的时刻结算，撞上暂停就少扣
    const coveredSec = Math.max(0, Math.min(secs, stalledSec != null ? stalledSec : secs) - buffLeftSec);
    const usedBottles = Math.min(renewPlan.length, Math.ceil(coveredSec / BUFF_DURATION));
    for (const item of renewPlan.slice(0, usedBottles)) {
      gameData.items[item] = Math.max(0, (gameData.items[item] || 0) - 1);
      renewUse[item]++;
    }
    for (const [item, n] of Object.entries(renewUse)) {
      if (!n) continue;
      addSystemLog('item_use', { item, qty: n, auto: true });
      updateBackpack(item);
    }
    setSaveSuspended(false); // 解除挂起，否则这次收尾的 saveGame 会被直接挡掉，之后也一直存不了
    saveGame();
  }
  const renewText = Object.entries(renewUse).filter(([, n]) => n).map(([k, n]) => `${ITEM_NAMES[k]}×${n}`).join('、');
  // 补发结果记一条系统日志：桌面端开不了控制台，玩家只能在这里核对增益有没有被模拟
  if (done > 0) {
    addSystemLog('catchup', { n: done, shiny: shinies, buffMin: Math.round(Math.min(secs, buffSec) / 60), renew: renewText });
  }
  const result = { done, total, balls, shinies, caught, stalledSec };
  console.log(`[挂机补发] 遇敌补算 ${done}/${total} 次（消耗球 ${balls}，闪光 ${shinies}${caught.length ? `，捕获 ${caught.join('、')}` : ''}${renewText ? `，补发续杯 ${renewText}` : ''}${stalledSec != null ? `，模拟到 ${stalledSec}s 处遇暂停` : ''}）`);
  return result;
}

// 回前台时判定"屏上这只早就该结束了"的离开时长阈值（秒）
const STALE_AWAY_SEC = 15;

// ===== 回前台时清理"早就该结束"的遭遇 =====
// 离开时间够久的话，屏上这一只（自动模式）其实早该打完：静默结算（不播动画、不弹文案、
// 不留补播）然后把上屏刷新到当前状态，别让它顶着一个旧地区的画面继续摆着
export async function settleStaleEncounter(awaySec) {
  if (awaySec < STALE_AWAY_SEC) return;
  if (_encPhase !== 'encounter' || !currentEncounter) return;
  if (!gameData.settings?.autoCatch && !gameData.settings?.autoFlee) return;
  if (catchFilterResult() === 'stop') return; // 暂停档：留在屏上交给玩家
  _bgCatchup = true; // 借补算的静默开关：不播动画、不弹文案、不切视图
  try {
    if (gameData.settings?.autoCatch) await autoCatch();
    else await fleeEncounter(true);
  } catch (e) {
    console.error('[回前台结算] 异常:', e);
  } finally {
    _bgCatchup = false;
    if (typeof window !== 'undefined') showView('idleView');
  }
}

// 遭遇页在屏上却没有文字框（后台/恢复路径可能漏写）：补上文案。
// 主动逃跑的离场动画要按文字框位置算终点，缺了它宝可梦会往屏幕左上角飞。
// 不能只看 .show：冻结/中断会把升起动画停在屏幕外，类还在、框却看不见，所以每 tick 强制落位
export function ensureEncounterTextBox() {
  if (_bgCatchup || _encPhase !== 'encounter' || !currentEncounter) return;
  if (!isOnGameView()) return;
  showTextBoxNow('stage');
  if (!$('textBoxContent')?.textContent) {
    const name = currentEncounter.form || currentEncounter.name;
    updateTextBox(encounterMsg || (currentIsShiny ? '野生的 闪光' + name + ' 跳出来了！' : '野生的 ' + name + ' 跳出来了！'), false);
  }
}

// ===== 浏览器后台遭遇立即清算 =====
// 遭遇后自动丢球由 showEncounter 的 1500ms 定时器触发，最小化/切后台时该定时器被浏览器冻结，
// 遭遇会一直停在画面；切后台瞬间主动启动自动捕捉/逃跑，走后台快速结算（无动画、直接落库）。
// 与 catchUpEncounters 的分工：它补"后台期间错过的遭遇"，本函数结算"切走时正在进行的这一次"
export async function settleEncounterForBackground() {
  if (_encPhase !== 'encounter' || !currentEncounter) return;
  if (_autoCatching || _bgCatchup || _bgCatch) return;
  if (!gameData.settings?.autoCatch && !gameData.settings?.autoFlee) return;
  const poke = currentEncounter;
  const shiny = currentIsShiny;
  const label = (poke.form || poke.name) + (shiny ? '(闪光)' : '');
  if (gameData.settings?.autoCatch) {
    const fr = catchFilterResult();
    if (fr === 'stop') return; // 暂停策略：遭遇留待玩家切回后手动处理
    const catchesBefore = gameData.stats.totalCatches;
    if (fr === 'flee') {
      await fleeEncounter(true);
      console.log(`[后台清算] 遭遇结算：${label} → 自动逃跑`);
      return;
    }
    await autoCatch();
    const got = gameData.stats.totalCatches > catchesBefore;
    console.log(`[后台清算] 遭遇结算：${label} → ${got ? '已捕获' : '已逃跑/未抓获'}`);
  } else if (gameData.settings?.autoFlee) {
    startAutoFleeTimer();
  }
}

// ===== 切回游戏页时的后台遭遇恢复 =====
// 后台捕捉仍在进行（_bgCatch 置位且遭遇未结束）：遭遇画面其实仍渲染在 encounterView，
// 直接切回并恢复遇敌相位，后续丢球动画在玩家可见状态下照常播放
export async function resumeBgEncounter() {
  if (!_bgCatch || !currentEncounter) return false;
  setEncPhase('encounter');
  $('fleeBtn').style.display = 'none';
  showView('encounterView');
  updateTextBox(encounterMsg || (currentIsShiny
    ? '野生的 闪光' + currentEncounter.name + ' 跳出来了！'
    : '野生的 ' + currentEncounter.name + ' 跳出来了！'), false);
  return true;
}

