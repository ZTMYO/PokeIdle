// ===== 口袋挂机 - 入口模块 =====
// 禁用全局右键菜单（桌面端 webview 的原生右键菜单）
document.addEventListener('contextmenu', e => e.preventDefault());
import { CATCH_RATES, SAVE_INTERVAL, ENCOUNTER_MIN, ENCOUNTER_MAX, ITEM_RATES, ITEM_NAMES, ROAD_SPECIAL_CHANCE, ROAD_WIDTH_MIN, ROAD_WIDTH_MAX, ROAD_SWITCH_CYCLES, BIKE_RESTORE_MAX_GAP_MS, PX_PER_METER } from './config.js';
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
  _catchConfirmStep, _pokedexInLogView, _idleMsgIdx,
  _lastRegionId, gameTick, _fishing,
  setAllPokemon, setGameData, setPhase, setCurrentEncounter,
  setCurrentIsShiny, setEncounterBallsUsed, setCurrentEncounterBalls,
  setGameTick, pushNav, popNav, resetNav, setLastRegionId,
  setHoneyBuffActive, setHoneyCountdownEnd, setCharmBuffActive, setCharmCountdownEnd,
  setHoneyPausedRemaining, setCharmPausedRemaining,
  setCharmEncounterCount, setIdleMsgIdx, setCatchConfirmStep,
  setBlockBuffActive, setBlockRecipe, setBlockStartWalk, setBlockQuality, setQteState,
  getDefaultSave, saveGame, getPokemonByIndex, ensureGpsState, defaultGpsState,
  restoreSessionState, calcOffline, addSystemLog, getCurrentRegion, addRosterEntry, getLastObtainedEntryId,
  hasAnyBall, saveSessionState, rand, randInt, formatNum,
  setEncounterMsg, addPlaySeconds, inMassZone, inTwistZone, setEncounterSource, setEncounterVariant,
  nextEncounterTimer,
} from './state.js';
import { computeObtainScore } from './scoring.js';
import { massTick, ensureMassInit as ensureMassInitEvents, forceRefreshMassOutbreak, twistTick, ensureTwistInit, forceRefreshTwist } from './events.js';
import {
  $, showView, updateTextBox, hideTextBox, showConfirmBar,
  isOnGameView, applyCharSprites, updateBackpack, updateStats, setIdleCharacter,
  renderIncubatorView, updateIncubatorTimers, updateIncubatorBadge, setupFoodTooltip,
  isIncubatorLogOpen, closeIncubatorLog, closeIncubatorEggView,
} from './ui.js';
import { spawnItemDrop, activateHoney, activateShinyCharm,
  startHoneyCountdown, startCharmCountdown, clearHoneyCountdown, clearCharmCountdown,
  doCandyExchange, grantItem, cancelItemDrop, rollCandyMult } from './items.js';
import { syncBlockVisual, startBlockCountdown, clearBlockCountdown, showMixerView } from './mixer.js';
import { scheduleNextEncounter, throwBall, fleeEncounter, goIdle,
  tryEncounter, pauseAutoFleeTimer, autoCatch, showEncounter, isLegendEncounter, setDebugNextEncounter, tryAutoRefill, catchFilterResult, catchUpEncounters, settleEncounterForBackground } from './battle.js';
import { startIdleRotation, buildIdleMessages } from './messages.js';
import { tryStartFishing, onRoadChanged, getFishingGuarantee, isFishingPending } from './fishing.js';
import { helperTick, refreshBerryView, showBerryView, catchUpHelper } from './berry.js';
import { startIntro, advanceIntro, confirmIntro } from './intro.js';
import { restorePokedex, setupRegionDropdown, setupStatusDropdown, setupTypeFilter,
  showPokedex, setupPokedexSearch } from './pokedex.js';
import { showRosterView, isRosterPicking, leaveRosterPicker, isRosterInDetail, isRosterDetailFromObtain, leaveRosterDetailToSource, restoreRosterList, isRosterDetailFromList, leaveRosterDetailToList, isRosterDetailJumpedToPokedex, returnRosterDetailFromPokedex, isRosterInMoveEdit, leaveMoveEditor, isBatchReleasing, cancelBatchRelease } from './roster.js';
import { isTradeInDetail, restoreTradeList, refreshTrades, renderTrade, showTradeView } from './trade.js';
import { showShopView, showSettingsView, showSystemLogs, showAchievementView,
  showTutorialView, renderSystemLogs, applyWindowScale } from './views.js';
import { showPhoneView, updateTradeBadge, updateBerryBadge, updateAchievementBadge, updatePhoneBadge, showIncubatorView } from './phone.js';
import { gpsAddDistance, showGpsView, setRoamEnabled, startBikeTarget, abandonBikeTarget, teleportToTwist } from './gps.js';
import { initAudio, playRegion, playCycling, endCycling, stopVictory, stopCongratulation, setMusicEnabled, isMusicEnabled, setSplashLocked, setShowCardOnEncounterEnd, setBattleMusic, setSfxEnabled } from './audio.js';
import { ensureBounty, updateBountyBadge, isBountyInTrade, restoreBountyList } from './bounty.js';
import { isNurseryPicking, leaveNurseryPick, isNurseryEggView, leaveNurseryEggView, showNurseryView } from './nursery.js';
import { isTrainPicking, leaveTrainPick, showTrainView } from './train.js';
import { isDispatchPicking, leaveDispatchPick } from './dispatch.js';
import { retreatBattle, isBattleActive, isBattleSettled, renderBattleList, restoreBattleTier, clearBattleTier, isLogOpen, closeLogPage, syncLogTitle, showBattleView } from './battle-view.js';
import { backFromBattlePick, isBattlePicking, migrateTeams, isTeamEditing, closeTeamEdit, isTeamPicking, leaveTeamPick, showTeamView } from './team.js';
import { refreshNpcs } from './npcs.js';
import { showCasinoView } from './casino.js';
import * as road from './road.js';
import * as particles from './particles.js';
import { initBackgroundCatchup, startBackgroundCatchup, bgCatchupEnabled, bgTakeAccum, bgTakeBike, bgTakeBuffRemainingMs } from './background-catchup.js';

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
    // 大量出没/时空扭曲事件区域内强制非骑行：刷新/初始化恢复时，若玩家正停在事件点
    // 而恢复的场景是自行车场景，避免刷新后站在事件点却在骑行（事件区域内不轮播，
    // 非过渡加载只发生在初始化/刷新恢复）
    road.setBike((inMassZone() || inTwistZone()) ? false : !!p.game.bike);
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
  const wasRoadBike = road.isRoadBike();
  // 大量出没/时空扭曲事件区域内强制非骑行：场景是动态轮播的，玩家可能在到达事件点前
  // 场景恰好是自行车场景（过渡已触发、_pendingBike=true）；若此时过渡完成应用
  // 骑行状态，玩家会站在事件点却无法遭遇事件宝可梦。事件区域内一律忽略目标场景骑行状态。
  road.setBike((inMassZone() || inTwistZone()) ? false : _pendingBike);
  _pendingBike = null;
  // 离开随机自行车路段：结算「自行车 ×1」（手动骑行中不结算，避免路段切换误发/打断）
  if (wasRoadBike && !road.isRoadBike() && !road.isManualBike()) {
    grantItem('bike', 1);
  }
  if (road.isBike()) playCycling();
  else endCycling();
  setIdleCharacter('walk');
});

// 手动骑行状态变更（上车/下车）：同步骑行音乐、角色外观、速度、日志与存档
let _silentBikeRestore = false; 
road.onManualBikeChanged(v => {
  if (!_silentBikeRestore) {
    if (v) addSystemLog('bike_ride', {});
    else addSystemLog('bike_stop', {});
  }
  _silentBikeRestore = false;
  gameData.manualBike = !!v; // 随主存档持久化（saveGame 兜底），刷新/重开可恢复骑行状态
  if (road.isBike()) playCycling();
  else endCycling();
  setIdleCharacter('walk'); // 重新应用骑行/走路外观与速度（isBike 已含手动骑行）
  // 骑行中自行车槽位半透明、数量显示「下车」（下车后恢复数量）
  const slot = document.querySelector('.bag-slot[data-item="bike"]');
  const qtyEl = document.getElementById('bag-bike');
  if (slot && qtyEl) {
    if (v) { slot.classList.add('disabled'); qtyEl.textContent = '下车'; }
    else { slot.classList.remove('disabled'); qtyEl.textContent = gameData.items['bike'] || 0; }
  }
  // 骑行中禁点增益道具（交互拦截见 onBagClick）：上车置灰，下车恢复
  // 若下车时对应 buff 仍在生效（倒计时遮罩），保留 disabled 由倒计时逻辑管理
  const slotH = document.querySelector('.bag-slot[data-item="sweet-honey"]');
  const slotC = document.querySelector('.bag-slot[data-item="shiny-charm"]');
  if (slotH) v ? slotH.classList.add('disabled') : (!honeyBuffActive && slotH.classList.remove('disabled'));
  if (slotC) v ? slotC.classList.add('disabled') : (!charmBuffActive && slotC.classList.remove('disabled'));
  updateStats();
  saveGame();
});

// 依次按 水域/自行车道 → 普通陆地 抽取下一段路：
// ROAD_SPECIAL_CHANCE 概率出特殊路段，其中水域与自行车道对半开，
// 目标子池为空时换另一个子池，两个都空则退回普通陆地。
// 随从增益可倾斜特殊路段倾向：bike 类抬升自行车道、fishing 类抬升水域
function _pickNextRoad() {
  let pool = ROAD_LAND;
  const followerBoost = _followerSpecialBoost(); // 随从对特殊路段的倾向调整
  const waterPref = followerBoost === 'fishing' ? 0.85 : (followerBoost === 'bike' ? 0.15 : 0.5);
  if (ROAD_WATER.length + ROAD_BIKE.length > 0 && Math.random() < ROAD_SPECIAL_CHANCE) {
    pool = Math.random() < waterPref
      ? (ROAD_WATER.length > 0 ? ROAD_WATER : ROAD_BIKE)
      : (ROAD_BIKE.length > 0 ? ROAD_BIKE : ROAD_WATER);
  }
  if (pool.length === 0) pool = ROAD_PRESETS.map((_, i) => i); // 目标池为空时退回全量
  if (pool.length === 1) return pool[0];
  let next;
  do { next = pool[Math.floor(Math.random() * pool.length)]; } while (next === _roadIdx);
  return next;
}

// 随从活跃时返回对特殊路段的倾向类别（'fishing'/'bike'/null）；无增益时返回 null
function _followerSpecialBoost() {
  const b = window.__followerActiveBoost?.();
  if (!b) return null;
  if (b.groups.includes('fishing')) return 'fishing';
  if (b.groups.includes('bike')) return 'bike';
  return null;
}

// ---------- 返回按钮 ----------
function goBack() {
  stopVictory(); // 任何返回离开当前视图：若胜利/抓捕音效还在播则立即停止（无播放时无副作用）
  // 经验糖果使用场景浮层：返回 = 取消并关闭场景（按进入来源回详情页/主界面）
  if ($('expCandyView')?.style.display === 'flex') {
    import('./exp-candy.js').then(m => m.cancelExpCandyScene());
    return;
  }
  // 手机页面是导航的"安全出口"：无论之前从哪进来、栈里压了什么，在手机页点返回一律回挂机页
  if ($('phoneView')?.style.display === 'flex') {
    resetNav();
    showView('idleView');
    return;
  }
  // 战斗中点击标题栏返回 = 撤退（配队替换模式在 teamView，返回只取消替换）
  if (isBattleActive() && $('battleView')?.style.display === 'flex') {
    retreatBattle();
    return;
  }
  // 孵蛋动画独立页（appTitle 显示"孵化"）：返回回孵蛋器页面，不弹导航栈（孵化页未压栈）；
  // 动画进行中则由 hatchFromIncubator 的后台结算兜底，完成后自动恢复挂起遭遇 / 回到空闲
  if ($('hatchView')?.style.display === 'flex') {
    stopCongratulation(); // 立即停止祝贺音效，避免残留
    $('catchConfirmBtns').style.display = 'none';
    setCatchConfirmStep(false);
    renderIncubatorView();
    showView('incubatorView');
    return;
  }
  // 孵化全部独立页（appTitle 显示"孵化全部"）：动画进行中锁定不可退出；
  // 全部播完（确认条已弹）时点返回 = 确认离开，回孵蛋器页面（未压栈）
  if ($('hatchAllView')?.style.display === 'flex') {
    import('./items.js').then(m => m.leaveHatchAllPage());
    return;
  }
  // 放入蛋独立页：点击标题栏返回孵蛋器
  if ($('incubatorEggView')?.style.display === 'flex') { closeIncubatorEggView(); return; }
  // 战斗替换选择页（teamView）：主动替换 → 取消选择回战斗操作界面；倒下换人 → 直接撤退回对战列表
  if (isBattlePicking() && $('teamView')?.style.display === 'flex') {
    if (backFromBattlePick()) retreatBattle();
    return;
  }
  // 仓库选取模式（配队/训练点击空位进入）：返回恢复来源页
  if (isRosterPicking() && $('rosterView')?.style.display === 'flex') { leaveRosterPicker(); return; }
  // 批量放生模式：返回 = 取消批量放生（留在仓库列表）
  if (isBatchReleasing() && $('rosterView')?.style.display === 'flex') { cancelBatchRelease(); return; }
  // 手动配招独立页：返回回个体详情
  if (isRosterInMoveEdit() && $('moveEditView')?.style.display === 'flex') { leaveMoveEditor(); return; }
  // 详情页跳转图鉴（第 4 层子页）：返回先回详情页，再按详情返回逻辑走
  if (isRosterDetailJumpedToPokedex()) { returnRosterDetailFromPokedex(); return; }
  if (_pokedexInLogView && $('pokedexView')?.style.display === 'flex') { restorePokedex(); return; }
  // 从悬赏提交/交换选择列表进入的详情，或「仓库情况」列表搜索（无详情）：按返回直接回来源视图
  if (isRosterDetailFromList() && $('rosterView')?.style.display === 'flex') {
    leaveRosterDetailToList();
    return;
  }
  if (isRosterInDetail() && $('rosterView')?.style.display === 'flex') {
    // 仅当正显示仓库详情时按返回才离开详情；从详情跳设置/商店等压栈页面返回时走 popNav 回到详情本身
    if (isRosterDetailFromObtain()) { leaveRosterDetailToSource(); }
    else { restoreRosterList(); }
    return;
  }
  if (isTradeInDetail() && $('tradeView')?.style.display === 'flex') { restoreTradeList(); return; }
  // 悬赏提交列表：标题栏返回先回悬赏列表
  if (isBountyInTrade() && $('bountyView')?.style.display === 'flex') { restoreBountyList(); return; }
  // 饲育屋蛋仓库视图：标题栏返回回饲育屋场地
  if (isNurseryEggView()) { leaveNurseryEggView(); return; }
  // 饲育屋放入列表：标题栏返回回饲育屋场地（选取页未压栈）
  if (isNurseryPicking()) { leaveNurseryPick(); return; }
  // 训练放入列表：标题栏返回回训练场地（放入页未压栈）
  if (isTrainPicking()) { leaveTrainPick(); return; }
  // 派遣放入列表：标题栏返回回派遣主列表（放入页未压栈）
  if (isDispatchPicking()) { leaveDispatchPick(); return; }
  // 配队"加入队伍"放入列表：标题栏返回回队伍编辑页（放入页未压栈）
  if (isTeamPicking()) { leaveTeamPick(); return; }
  // 结算页返回：回 NPC 战斗列表（与「返回列表」按钮一致），不弹栈（列表页仍在 battleView 内）
  if (isBattleSettled() && $('battleView')?.style.display === 'flex') {
    import('./battle-view.js').then(m => m.showBattleView());
    return;
  }
  const target = popNav();
  if (target === 'battleView') {
    // 战斗替换选择中从 teamView 跳设置/商店返回：恢复替换选择页，不打断替换
    if (isBattlePicking()) {
      import('./team.js').then(m => { m.rerenderTeamView(); showView('teamView'); });
      return;
    }
    // 战斗进行中：回到战斗页继续（不中断战斗）
    if (isBattleActive()) {
      showView('battleView');
      restoreBattleTier(); // 战斗页重新显示：恢复 NPC 难度边框色
      syncLogTitle(); // 记录页还开着则恢复「对战记录」标题（设置页返回场景）
    } else {
      // 战斗已结束（结算页）或列表页：与「返回列表」按钮一致，回到 NPC 战斗列表
      import('./battle-view.js').then(m => m.showBattleView());
    }
    return;
  }
  if (target === 'rosterView' && isRosterInMoveEdit()) {
    // 配招独立页跳设置/商店返回：恢复配招页（配招页未压栈）
    import('./roster.js').then(m => { m.renderMoveEditor(); showView('moveEditView'); });
    return;
  }
  showView(target);
  // 其它情况（含挑战结算页返回）：清除屏幕难度背景色，避免其它页面沿用战斗配色
  clearBattleTier();
  // 返回手机主页时兜底同步红点（showView 不重建页面，避免漏刷新）
  if (target === 'phoneView') { updateTradeBadge(); updateBerryBadge(); updateAchievementBadge(); updatePhoneBadge(); }
}

// ---------- 背包点击 ----------
// 使用自行车：骑行中再点 = 手动下车；待选骑行目的地中再点 = 放弃待选（未消耗）；
// 有存货且未骑行 = 进入待选骑行目的地（停止当前导航 + 跳转导航页，玩家选好目的地才消耗 1 个上车）。
// 上车前先取消面前滑入/拾取中的道具，保证骑行界面干净（遇敌中不可使用，见 onBagClick）。
function tryUseBike() {
  if (road.isManualBike()) {
    // 骑行中再点 = 手动下车：弹二次确认，下车不返还已消耗的自行车道具
    showConfirmBar('确认下车？不返还自行车', () => { road.setManualBike(false); }, null, { host: $('screen') });
    return;
  }
  if (gameData.gps.pendingBike) {
    // 待选中再点：放弃选择，恢复进入待选前的导航（未消耗道具，下次再点重新进入待选）
    abandonBikeTarget();
    return;
  }
  if ((gameData.items['bike'] || 0) <= 0) return;
  cancelItemDrop();
  startBikeTarget();
}

// 告别场景（放生确认/悬赏提交/交换展示）是否打开：期间锁定顶部导航、底部三区与背包，防止误点打断流程
const isGoodbyeActive = () => $('goodbyeView')?.style.display === 'flex';
// 全屏确认场景总锁：告别/派遣结算/孵蛋动画/经验糖/批量放生期间，
// 顶部导航、底部三区、标题返回、全局快捷键一律禁用，防止误触打断流程。
// 注意：NPC 对战（isBattleActive）不在此列——战斗中的「撤退」是合法操作（标题返回/Esc 均可），
// 跳转锁定由各入口自己的 isBattleActive() 拦截单独负责（header/footer 已实现）
const isModalLocked = () =>
  $('goodbyeView')?.style.display === 'flex' ||
  $('dispatchResultView')?.style.display === 'flex' ||
  $('hatchView')?.style.display === 'flex' ||
  $('hatchAllView')?.style.display === 'flex' ||
  $('expCandyView')?.style.display === 'flex' ||
  (isBatchReleasing() && $('rosterView')?.style.display === 'flex');

function onBagClick(itemKey) {
  // 告别场景中锁定背包：禁止点击任何道具
  if (isGoodbyeActive()) return;
  if (phase === 'encounter') {
    // 遇敌中可点击神秘蛋：直接跳孵蛋器（省掉「手机→孵蛋器」两步，没蛋也允许），返回由 showView 自动回战斗页
    if (itemKey === 'mystery-egg') {
      pushNav('incubatorView');
      showView('incubatorView');
      renderIncubatorView();
      return;
    }
    // 遇敌中可点击经验糖果：与放生同理，遭遇转后台自动处理，打开仓库选取宝可梦使用
    if (itemKey === 'exp-candy') {
      import('./exp-candy.js').then(m => m.openExpCandyPicker());
      return;
    }
    // 遇敌中不可点击自行车（与甜甜蜜/护符同规则，防止误触放弃当前宝可梦）
    if (gameData.settings?.autoCatch) {
      // 遇敌过滤设为"暂停"的遭遇：停在战斗页等玩家手动丢球，不受自动选球配置限制
      const stoppedForManual = catchFilterResult() === 'stop';
      if (!stoppedForManual) {
        const balls = gameData.settings?.autoCatchBalls || {};
        const hasStock = ['poke-ball', 'ultra-ball', 'master-ball'].some(b => balls[b] !== false && (gameData.items[b] || 0) > 0);
        if (!hasStock) return;
      }
    }
    // 球数量为 0 也放行：throwBall 内部按自动补球配置决定补球或作废（手动模式同样生效）
    if (CATCH_RATES[itemKey]) {
      pauseAutoFleeTimer();
      throwBall(itemKey);
    }
    return;
  }
  if (phase !== 'idle') return;
  // 钓鱼中禁止使用 buff/骑行道具/经验糖果（会与暂停的道路/角色状态冲突，经验糖果会打开选取页打断流程）
  if (_fishing && (itemKey === 'sweet-honey' || itemKey === 'shiny-charm' || itemKey === 'bike' || itemKey === 'exp-candy')) return;
  // 骑行中禁止使用增益道具（骑行速度已封顶且不遇敌，buff 无收益还浪费）；经验糖果不打断骑行，允许使用
  if (road.isManualBike() && (itemKey === 'sweet-honey' || itemKey === 'shiny-charm')) return;
  // 钓鱼等待中禁止使用自行车/经验糖果（会与即将开始的钓鱼动画冲突）
  if ((itemKey === 'bike' || itemKey === 'exp-candy') && isFishingPending()) return;
  if (itemKey === 'sweet-honey') { activateHoney(); }
  else if (itemKey === 'shiny-charm') {
    if (honeyBuffActive) return;
    activateShinyCharm();
  } else if (itemKey === 'bike') {
    tryUseBike();
  } else if (itemKey === 'mystery-egg') {
    // 点击背包神秘蛋：单纯跳转到孵蛋器查看（不放入槽位，没蛋也允许），返回由导航栈回到主界面
    pushNav('incubatorView');
    showView('incubatorView');
    renderIncubatorView();
  } else if (itemKey === 'exp-candy') {
    // 经验糖果：打开仓库选择目标宝可梦使用（库存为 0 时弹提示）
    import('./exp-candy.js').then(m => m.openExpCandyPicker());
  }
}

// ---------- 游戏 Tick ----------
let _lastLogTs = -1; // 上次渲染时最新日志的时间戳（新日志或清空日志才会重渲染日志页）
// 后台挂机停摆记账与补发入口统一收敛在 background-catchup.js（含开关、visibilitychange 记账、
// 步态/buff 快照），onGameTick 只负责取秒数折算入账；安卓端可通过该模块的 BACKGROUND_CATCHUP 整体关闭
async function onGameTick() {
  if (window.__introActive) return; // 开场剧情期间不推进挂机
  // 自动补球：勾选的球为 0 时每秒自动补 1 个（便宜优先），背包数量即时可见（手动/自动都生效）
  tryAutoRefill();
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

  // 大量出没事件：生成 / 到期 / 事件宝可梦滚动出现
  massTick();
  // 时空扭曲事件：生成 / 到期 / 异时空宝可梦滚动出现
  twistTick();

  if (phase !== 'idle') { updateStats(); return; }

  // 浏览器后台挂机补算：后台/最小化期间按当前速度折算里程直接入账，不播放动画；掉落按
  // "实际走路秒数 + 停摆秒数"折算。停摆秒数以 visibilitychange 记录的隐藏时长为主（农场等
  // 非道路页面也有效），road 帧间隔检测作兜底（Tauri 端若 visibility 不触发仍可补）。
  // 遇敌/钓鱼等 road 暂停时两者均为 0，不会误补。Tauri 端窗口可见时均不触发
  const walkSec = road.takeWalkSeconds();
  // 后台补发开关关闭时（如安卓沿用离线暂停哲学）停摆秒数不参与任何补算，主循环保持前台原行为
  const afkSec = bgCatchupEnabled() ? Math.max(bgTakeAccum(), road.takeAfkSeconds()) : 0;
  // 骑行停摆期间不产生掉落/遭遇（骑行不遇敌、不拾取），里程仍按骑行速度补算：
  // 只把行走时段的停摆秒数计入掉落/遭遇补算，避免骑行结束瞬间的骑行秒数被误补
  const idleAfkSec = bgTakeBike() ? 0 : afkSec;
  let catchUpLog = null; // 补发汇总：后台挂机补算时打印控制台便于核对
  if (afkSec > 0) {
    catchUpLog = { afkSec: Math.round(afkSec), walk: 0, items: {} };
    // 按实际滚动速率折算里程（takeDistance 实测值，高刷屏帧率>60 时速率更高，与前台推进一致）
    const spd = road.getActualPxPerSec() || road.getSpeed() * 60;
    const extraWalk = Math.floor(spd * afkSec);
    if (extraWalk > 0) {
      gameData.stats.walkDistance = (gameData.stats.walkDistance || 0) + extraWalk;
      gpsAddDistance(extraWalk, spd);
      catchUpLog.walk = extraWalk;
    }
    saveGame(); // 补算入账立即落盘，避免依赖 30 秒周期存档
    // 树果帮手补算：后台 rAF 停摆期间帮手在线时长/劳作暂停，恢复时按前台节奏补齐
    const helper = catchUpHelper(afkSec);
    if (helper && helper.ok) {
      catchUpLog.helper = { works: helper.works, ended: helper.ended, errored: helper.errored };
    }
  }

  // 遇敌调度心跳：空闲但调度计时器丢失时（如补播被 NPC 对战取消等异常路径）自动补排，
  // 避免"玩完 NPC 对战后再也不遇敌"这类卡死；事件区/钓鱼/自行车内不预排，交给各自流程延后调度
  if (!nextEncounterTimer && !isFishingPending() && !inMassZone() && !inTwistZone() && !road.isBike()) {
    scheduleNextEncounter();
  }

  // 过渡完成：应用新路段的骑行状态（骑行/行走与骑行音乐一起切换）
  // 兜底分支：onTransitionCharReach 未触发时（过渡结束仍未消费 _pendingBike）同样结算"离开自行车路段"奖励
  if (_pendingBike !== null && !road.isTransitioning()) {
    const wasRoadBike = road.isRoadBike();
    // 大量出没/时空扭曲事件区域内强制非骑行（同 onTransitionCharReach 的处理）：
    // 场景动态轮播下，到达事件点前后都可能处于自行车场景过渡，事件区域内不允许骑行
    road.setBike((inMassZone() || inTwistZone()) ? false : _pendingBike);
    _pendingBike = null;
    if (wasRoadBike && !road.isRoadBike() && !road.isManualBike()) {
      grantItem('bike', 1);
    }
    if (road.isBike()) playCycling();
    else endCycling();
    setIdleCharacter('walk');
  }

  // 道路轮播：每 ROAD_SWITCH_CYCLES 个完整循环切下一个（过渡中/钓鱼中/大量出没/时空扭曲事件路段内不切）
  if (!road.isTransitioning() && !_fishing && !inMassZone() && !inTwistZone()) {
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
  // 过渡到自行车道期间也停止生成，避免遗留道具在骑行开始后滑过；大量出没/时空扭曲事件路段内不钓鱼）
  if (!road.isBike() && !inMassZone() && !inTwistZone()) tryStartFishing();
  if (!_fishing && !road.isBike() && _pendingBike !== true) {
    for (const [item, rate] of Object.entries(ITEM_RATES)) {
      const key = `_f_${item}`;
      if (!gameData[key]) gameData[key] = 0;
      // 随从增益：itemdrop 类提升挂机道具掉落率
      const effRate = window.__followerBoostMechanic?.('itemDrop', rate) ?? rate;
      // 按实际走路秒数累积：正常滚动帧间隔累计 + 后台停摆秒数一次补齐，挂机不掉产出
      gameData[key] += effRate * (walkSec + idleAfkSec);
      const gained = Math.floor(gameData[key]);
      if (gained > 0) {
        if (afkSec > 0) {
          // 后台补发：批量直接入账不播动画（日志在 grantItem 内记录），避免逐一出补发动画。
          // 糖果按掉落次数逐次 roll 倍率（与前台 spawnItemDrop 同节奏），汇总后一次性入账
          let gainedQty = 0;
          for (let i = 0; i < gained; i++) {
            gainedQty += item === 'candy' ? rollCandyMult() : 1;
          }
          grantItem(item, gainedQty);
          gameData[key] -= gained;
          if (catchUpLog) {
            const label = ITEM_NAMES[item] || item;
            catchUpLog.items[label] = (catchUpLog.items[label] || 0) + gainedQty;
          }
        } else {
          // 只扣减真正生成成功的数量：遇敌/钓鱼/锁占用等 spawn 失败时保留累积值，下次 tick 重试，避免道具凭空丢失
          let spawned = 0;
          for (let i = 0; i < gained; i++) {
            if (!spawnItemDrop(item)) break; // 失败即锁占用/非 idle，短时内重试结果相同，直接退出
            spawned++;
          }
          gameData[key] -= spawned;
        }
      }
    }
  }
  // 补发掉落入账后立即落盘：遇敌补算（battle.js）结束时已存档，这里补掉落部分，
  // 避免 30 秒周期存档前刷新/切走导致本次补发的道具丢失
  if (catchUpLog && Object.keys(catchUpLog.items).length > 0) saveGame();

  // 后台挂机补发汇总：遇敌补算为异步批量结算，完成后并入一并打印，便于核对每类补算了多少
  if (catchUpLog) {
    const enc = await catchUpEncounters(idleAfkSec, bgTakeBuffRemainingMs());
    if (enc) catchUpLog.enc = enc;
    const parts = [`挂机补发 ${catchUpLog.afkSec}s`];
    if (catchUpLog.walk > 0) parts.push(`里程 +${Math.round(catchUpLog.walk / PX_PER_METER)}m`);
    const itemNames = Object.keys(catchUpLog.items);
    if (itemNames.length > 0) parts.push(`掉落 ${itemNames.map(k => `${k}×${catchUpLog.items[k]}`).join('、')}`);
    if (catchUpLog.enc && catchUpLog.enc.done > 0) {
      parts.push(`遭遇 ${catchUpLog.enc.done} 只 / 抓到 ${catchUpLog.enc.caught.length} 只`);
      if (catchUpLog.enc.shinies > 0) parts.push(`闪光 ${catchUpLog.enc.shinies} 只`);
    }
    if (catchUpLog.helper) parts.push(`帮手劳作 ${catchUpLog.helper.works} 次${catchUpLog.helper.ended ? '（已到期）' : ''}`);
    console.log('[挂机补发]', parts.join('，'));
    if (catchUpLog.enc && catchUpLog.enc.caught.length > 0) console.log('[挂机补发] 捕获明细：', catchUpLog.enc.caught.join('、'));
  }

  if (gameTick % 5 === 0) { updateBackpack(); updateStats(); }

  // 孵蛋器状态检查（每 tick，先检查再渲染）
  let incubatorChanged = false;
  for (const s of (gameData.incubators || [])) {
    if (s && s.eggIndex != null && !s.hatched) {
      const used = (gameData.stats?.walkDistance || 0) - s.hatchStart;
      // 随从增益：hatch 类动态减免孵化所需里程（达标线 = 原始里程 × 当前随从倍率）
      const need = (s.hatchDuration || 0) * (window.__followerBoostMechanic?.('hatchDist', 1) ?? 1);
      // 检查里程达标（加 100px 容差）+ hatchStart 无效（NaN/负值）兜底
      if (isNaN(used) || used < 0 || (used + 100) >= need) {
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
    updateAchievementBadge();
    updateBountyBadge();
    updatePhoneBadge();
  }
  // 系统日志页开着：新日志实时追加（按最新日志时间戳判断，条数满 50 后"加一删一"条数不变也能感知）
  if ($('systemLogView')?.style.display === 'flex') {
    const logs = gameData.systemLogs || [];
    const ts = logs.length ? logs[logs.length - 1].time : -1;
    if (ts !== _lastLogTs) {
      _lastLogTs = ts;
      const sv = $('systemLogView');
      const st = sv ? sv.scrollTop : 0;
      renderSystemLogs();
      if (sv) sv.scrollTop = st;
    }
  }
}

// ---------- 开场剧情音乐开关（顶栏按钮，仅开场显示） ----------
// 与设置面板「音乐」开关共用同一逻辑（settings.musicEnabled）
function syncIntroMusicIcon() {
  const btn = document.getElementById('btnIntroMusic');
  const on = document.getElementById('introMusicIconOn');
  const off = document.getElementById('introMusicIconOff');
  const enabled = isMusicEnabled();
  if (on) on.style.display = enabled ? '' : 'none';
  if (off) off.style.display = enabled ? 'none' : '';
  if (btn) { btn.title = enabled ? '关闭音乐' : '打开音乐'; btn.setAttribute('aria-label', btn.title); }
}

function onIntroMusicClick() {
  const enabled = !isMusicEnabled();
  gameData.settings.musicEnabled = enabled;
  setMusicEnabled(enabled);
  saveGame();
  syncIntroMusicIcon();
  // 玩家点击过音乐开关：引导文案不再显示
  const hint = document.getElementById('introMusicHint');
  if (hint) hint.style.display = 'none';
}

// ---------- 初始化 ----------
// 全局快捷键：G 导航 / T 图鉴 / B 仓库 / J 交换 / F 孵蛋器 / N 农场 / H 混合器 / C 成就 / R 日志 / S 饲育屋 / X 训练 / P 配队 / D 对战 / Y 游戏厅
// 组合键、输入框聚焦、确认框弹出、开场剧情期间均不响应，避免误触打断流程
function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (window.__introActive) return;
    const key = e.key.toLowerCase();
    // 全屏场景锁定：字母快捷键一律不响应防误触跳页；Esc 放行（走 goBack 逐级安全退出场景）
    // 战斗中同样禁用字母键（跳页会打断对局），Esc 保留用于撤退
    if ((isModalLocked() || isBattleActive()) && key !== 'escape') return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (document.getElementById('confirmBar')) return;
    switch (key) {
      case 'g': showGpsView(); break;
      case 't': showPokedex(); break;
      case 'b': showRosterView(); break;
      case 'j': showTradeView(); break;
      case 'f': showIncubatorView(); break;
      case 'n': showBerryView(); break;
      case 'h': showMixerView(); break;
      case 'c': showAchievementView(); break;
      case 'r': showSystemLogs(); break;
      case 's': showNurseryView(); break;
      case 'x': showTrainView(); break;
      case 'p': showTeamView(); break;
      case 'd': showBattleView(); break;
      case 'y': showCasinoView(); break;
      // Esc 等同标题栏返回（与点击返回按钮同一套逐级逻辑）
      case 'escape': goBack(); break;
    }
  });
}

async function init() {
  try { await window.__TAURI__?.core?.invoke('mark_show'); } catch (_) {}

  // 浏览器端（非 Tauri）：console 基准 274×342，按窗口比例设置整体缩放，与 Tauri 端
  //（Rust set_window_scale 用 JS 真实 dpr 计算 zoom，CSS 视口恒为 274×342）保持一致的画面。
  // 必须缩放 <html> 而非 .console：局部 CSS zoom 会让 getBoundingClientRect() 与渲染坐标
  // 不一致（Chromium 已知 bug），导致道路道具/遭遇贴图/丢球动画错位；html 级 zoom 等价
  // 浏览器页面缩放。
  const consoleEl = document.querySelector('.console');
  if (consoleEl && !window.__TAURI__?.core?.invoke) {
    document.body.classList.add('browser-mode');
    // 移动端与桌面端浏览器对 CSS zoom 的 getBoundingClientRect 行为不一致：
    // 桌面 Chromium 返回缩放后坐标（现有代码按此补偿），部分移动浏览器（尤其 iOS Safari）
    // 返回未缩放坐标，导致基于 rect 差值定位的战斗贴图/道路道具/遭遇图标双重补偿错位。
    const isMobile = /Android|iPhone|iPad|iPod|Mobile|mobile/i.test(navigator.userAgent);
    if (isMobile) {
      // 移动端改用 transform: scale：canvas 保持逻辑尺寸绘制、由 GPU 合成缩放，不额外增加
      // 重绘开销（zoom 在移动端会强制整页按放大尺寸重绘，拖慢滚动）
      let _scale = 1;
      const fitConsole = () => {
        const vw = window.visualViewport?.width || window.innerWidth;
        const vh = window.visualViewport?.height || window.innerHeight;
        _scale = Math.max(1, Math.min(vw / 274, vh / 342));
        consoleEl.style.transform = `scale(${_scale})`;
      };
      fitConsole();
      window.addEventListener('resize', fitConsole);
      window.visualViewport?.addEventListener('resize', fitConsole);

      // transform: scale 是纯视觉变换：getBoundingClientRect 返回缩放后（物理）坐标，
      // 而 style.left/top 赋值是逻辑值（渲染时再 ×scale）。与桌面 zoom 分支的 /zoom 补偿
      // 同理，这里对 console 内元素统一除以 scale 还原逻辑坐标，避免遭遇贴图/道路道具/
      // 事件 icon 双重缩放错位（真机 UA 走本分支，F12 缩小窗口走 zoom 分支故两者表现不同）
      const _origGetBRC = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        const r = _origGetBRC.call(this);
        if (_scale === 1 || !consoleEl.contains(this)) return r;
        return new DOMRect(r.left / _scale, r.top / _scale, r.width / _scale, r.height / _scale);
      };
    } else {
      // 宽屏取高为限（上下贴边），窄屏取宽为限（左右贴边）；窗口不足基准尺寸时保持 100%
      const fitConsole = () => {
        const scale = Math.max(1, Math.min(innerWidth / 274, innerHeight / 342));
        document.documentElement.style.zoom = scale;
      };
      fitConsole();
      window.addEventListener('resize', fitConsole);

      // CSS zoom 是布局缩放：getBoundingClientRect 返回的是缩放后坐标，而 style.left/top 赋值
      // 在渲染时还会被 zoom 再放大一次，导致战斗贴图/道具/遭遇 icon 双重缩放错位。Tauri 端
      // 用 WebView2 页面缩放（Browser Zoom），getBoundingClientRect 始终返回逻辑 CSS 像素。
      // 这里把返回值统一除以 zoom，还原成与 Tauri 端一致的行为（动画/特效坐标全部对齐）。
      const _origGetBRC = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        const r = _origGetBRC.call(this);
        const z = parseFloat(document.documentElement.style.zoom) || 1;
        if (z === 1) return r;
        return new DOMRect(r.left / z, r.top / z, r.width / z, r.height / z);
      };
    }
  }

  // 系统托盘走路动画（异步加载，失败不影响主流程）
  import('./tray.js').then(m => m.startTrayAnimation()).catch(() => {});

  document.addEventListener('wheel', e => {
    const dv = document.getElementById('dataView');
    if (dv && dv.style.display !== 'none' && dv.contains(e.target)) {
      e.preventDefault();
      dv.scrollTop += e.deltaY * 0.4;
    }
  }, { passive: false });

  // 全局快捷键（输入框聚焦 / 确认框弹出 / 开场剧情期间不响应）
  setupShortcuts();

  // 加载宝可梦数据
  try {
    const resp = await fetch('./pokemon-data/pokedex.json');
    setAllPokemon(await resp.json());
  } catch (e) {
    console.error('加载数据失败');
    return;
  }

  // 随从增益查询入口：供各机制（路段抽取等）读取当前随从的活跃增益
  window.__followerActiveBoost = () => null;

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
  // 应用存档中的窗口倍率（未设置时默认 2 倍）
  applyWindowScale(gameData?.settings?.windowScale);
  // 应用夜间模式
  if (gameData.settings?.darkMode) document.documentElement.dataset.theme = 'dark';
  ensureGpsState(); // 初始化 GPS 状态（默认从丰缘出发）
  if (gameData.gps.roamEnabled && gameData.gps.destIdx == null) setRoamEnabled(true);
  if (!gameData.achievements) gameData.achievements = {}; // 旧存档补齐成就进度
  if (!gameData.collectedCards) gameData.collectedCards = {}; // 旧存档补齐卡牌收集
  if (!gameData.gachaLogs) gameData.gachaLogs = {}; // 旧存档补齐抽卡记录
  migrateTeams(); // 6 组配队：旧档 team 迁入队伍 1，并建立 gameData.team 镜像引用
  import('./dispatch.js').then(m => m.ensureDispatch()); // 旧档补齐派遣槽
  initAudio(gameData.settings?.musicVolume ?? 0.6); // 背景音乐：读取存档音量并初始化
  // 旧档迁移：静音开关已并入「音乐」开关（默认播放音乐），清理孤立的 muted 字段
  if (gameData.settings?.muted !== undefined) delete gameData.settings.muted;
  // 旧档迁移：战斗系统引入等级后，旧存档精灵没有 level 字段 → 统一按 1 级处理
  if (Array.isArray(gameData.roster)) {
    let upgraded = 0;
    for (const p of gameData.roster) {
      if (p && typeof p.level !== 'number') { p.level = 1; upgraded++; }
      if (p && typeof p.exp !== 'number') p.exp = 0;
      if (p && !p.evs) p.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    }
    if (upgraded > 0) console.log(`[迁移] 为 ${upgraded} 只旧存档精灵补充默认等级 Lv1`);
  }
  // 旧档迁移：8 只性别差异宝可梦雌雄拆分（base=雄性 / -1=雌性）
  // 旧版本雌雄共用 base 编号，将雌性个体分配到对应 -1 编号；
  // 无 gender 字段的旧个体按旧性别比例补 roll（新版已全雄/全雌，不能再用新比例判定）
  const SEXDIFF_OLD_RATE = { '0521': 4, '0592': 4, '0593': 4, '0668': 7 };
  const SEXDIFF_BASE = new Set(['0521', '0592', '0593', '0668', '0678', '0876', '0902', '0916']);
  if (Array.isArray(gameData.roster)) {
    let splitN = 0;
    for (const p of gameData.roster) {
      if (!p) continue;
      const key = String(p.species);
      if (!SEXDIFF_BASE.has(key)) continue;
      if (!p.gender) {
        const oldRate = SEXDIFF_OLD_RATE[key];
        p.gender = oldRate === undefined ? 'male' : (Math.random() * 8 < oldRate ? 'female' : 'male');
      }
      if (p.gender === 'female') { p.species = key + '-1'; splitN++; }
    }
    if (splitN > 0) console.log(`[迁移] 将 ${splitN} 只历史宝可梦拆分为雌性形态（-1 编号）`);
  }
  setMusicEnabled(gameData.settings?.musicEnabled !== false); // 音乐开关：沿用上次状态
  setBattleMusic(gameData.settings?.battleMusic !== false); // 战斗音乐开关：沿用上次状态
  setSfxEnabled(gameData.settings?.sfxEnabled !== false); // 音效开关：沿用上次状态
  ensureBounty();   // 生成/恢复当日地区悬赏
  ensureMassInitEvents(); // 大量出没事件：初始化下次生成时间
  ensureTwistInit();      // 时空扭曲事件：初始化下次生成时间
  setupFoodTooltip(); // 游戏内自制 tooltip 委托：全局激活，配招/战斗等所有页面 hover 可用
  updateBountyBadge(); // 初始化标题栏悬赏红点
  updatePhoneBadge(); // 初始化标题栏手机聚合红点

  setLastRegionId(getCurrentRegion().id);
  await saveGame();

  // 调试命令统一在 debug.js 中登记（F12 控制台 window.__* 系列）
  await import('./debug.js');

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
    // 开场剧情顶栏音乐开关（仅开场显示，位于最小化按钮左侧）
    syncIntroMusicIcon();
    const musicBtn = document.getElementById('btnIntroMusic');
    if (musicBtn) {
      musicBtn.style.display = 'flex';
      musicBtn.addEventListener('click', onIntroMusicClick);
    }
    // 音乐引导文案：与按钮一同显示在左侧，点击后消失
    const musicHint = document.getElementById('introMusicHint');
    if (musicHint) musicHint.style.display = 'flex';
    startIntro(() => {
      window.__introActive = false;
      gameData.introDone = true;
      // 开场结束：音乐开关与引导文案随开场一起隐藏
      const btn = document.getElementById('btnIntroMusic');
      if (btn) btn.style.display = 'none';
      const hint = document.getElementById('introMusicHint');
      if (hint) hint.style.display = 'none';
      // 底部背包/统计栏与顶部按钮的恢复由 startSplashDrop 统一处理（splash 显示后淡入，避免闪现）
      // 首次 splash（开场剧情结束后的首个开机动画）不静音：未白镇开场曲顺势延续
      saveGame().then(() => { beginGameplay(); startSplashDrop(null, false); });
    });
  } else {
    // 老玩家启动：splash 动画期间全局禁声。必须在 beginGameplay（恢复会话可能同步触发
    // showEncounter → playShiny 闪光音效）之前锁定，否则闪光提示音会绕过 splash 静音。
    // 此阶段背景曲尚未起播（playRegion 在 splash 落位动画结束后调用），提前锁定无副作用
    setSplashLocked(true);
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

    // 随从跟随状态在重启后重建：road.start() 清空了 road-layer，需重挂随从 DOM；
    // 同时恢复上次未处理的抽卡结果（未选跟随/放走就退出），重进随从页可继续处理
    import('./follower.js').then(m => {
      m.ensureRoadFollower();
      m.restorePendingFollower();
    });

    // 上次退出时若停留在「待选骑行目的地」（点了背包自行车、未选目的地就关闭游戏）：
    // 恢复进入待选前的导航，避免角色 GPS 停止推进、下次进导航页卡在选择骑行目的地
    if (gameData?.gps?.pendingBike && gameData?.gps?.bikePrevNav) {
      abandonBikeTarget();
    }

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

    // 恢复手动骑行：主存档持久化（上车即存 + 每 30s 自动存档，任何关闭方式都能恢复），
    // 会话（beforeunload 写入）作兜底；长时间离线（>BIKE_RESTORE_MAX_GAP_MS）不恢复，
    // 维持"离线按走路结算"的设定（calcOffline 也已清除主存档标记）
    if ((sessionState?.manualBike || gameData.manualBike) && Date.now() - (gameData.stats.lastSaveTime || 0) < BIKE_RESTORE_MAX_GAP_MS) {
      _silentBikeRestore = true; // 恢复骑行非真实操作，不写"开始骑自行车"日志
      road.setManualBike(true);
    }

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
        // 恢复遭遇来源与外观变体（时空扭曲 RGB/污染）：刷新后特效与捕获来源不丢失
        setEncounterSource(sessionState.encounter.source || 'normal');
        setEncounterVariant(sessionState.encounter.variant || null);
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

  // 背包翻页：鼠标滚轮在背包区域滚动切换第一/第二页
  const backpackEl = $('backpack');
  if (backpackEl) {
    let _bagPage = 1;
    const showBagPage = p => {
      // splash 落位动画期间禁止翻页：道具飞入背包依赖第一页槽位显示与 pop 缩放
      if ($('splash')?.style.display === 'flex') return;
      if (p === _bagPage) return; // 已在目标页：不重复切换
      _bagPage = p;
      const p1 = $('bagPage1'), p2 = $('bagPage2');
      if (p1) p1.style.display = p === 1 ? 'flex' : 'none';
      if (p2) p2.style.display = p === 2 ? 'flex' : 'none';
      // 页码指示条：亮起对应短段
      const ind = $('bagPageIndicator');
      if (ind) {
        ind.querySelectorAll('.seg-page').forEach(s => {
          s.classList.toggle('on', Number(s.dataset.page) === p);
        });
      }
    };
    backpackEl.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.deltaY > 0 && _bagPage < 2) showBagPage(2);
      else if (e.deltaY < 0 && _bagPage > 1) showBagPage(1);
    });
    // 触屏横滑翻页：记录滑动起点，结束时按横向位移与方向翻页
    let _bagTouchX = null;
    backpackEl.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      _bagTouchX = e.touches[0].clientX;
    }, { passive: true });
    backpackEl.addEventListener('touchend', e => {
      if (_bagTouchX == null) return;
      const dx = e.changedTouches[0].clientX - _bagTouchX;
      _bagTouchX = null;
      if (Math.abs(dx) < 30) return; // 位移过小视为点击
      if (dx < 0 && _bagPage < 2) showBagPage(2);
      else if (dx > 0 && _bagPage > 1) showBagPage(1);
    }, { passive: true });
    // 点击页码指示条的短段直接翻到对应页
    const bagInd = $('bagPageIndicator');
    if (bagInd) {
      bagInd.querySelectorAll('.seg-page').forEach(seg => {
        seg.addEventListener('click', () => showBagPage(Number(seg.dataset.page)));
      });
    }
  }

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
    const fromEgg = phase === 'eggResult'; // 必须在 goIdle 前判断（goIdle 会把 phase 置回 idle）
    if (fromEgg) {
      import('./items.js').then(async items => {
        await items.finalizeEggResultContext();
        if (entryId) import('./roster.js').then(m => m.showRosterDetailById(entryId, 'incubatorView'));
      });
      return;
    }
    // 先跳详情页再收尾：showRosterView 切走游戏页后 isOnGameView() 为 false，
    // 后续 finalizePendingCatch → goIdle 只清理战斗状态，不会切回挂机页，避免闪烁
    if (entryId) {
      import('./roster.js').then(m => m.showRosterDetailById(entryId, 'idleView'));
    } else {
      goIdle();
    }
  });
  $('confirmNo')?.addEventListener('click', () => {
    stopVictory(); // 交互完图鉴对话框 → 停止胜利音效
    $('catchConfirmBtns').style.display = 'none';
    setCatchConfirmStep(false);
    const fromEgg = phase === 'eggResult'; // 必须在 goIdle 前判断（goIdle 会把 phase 置回 idle）
    if (fromEgg) {
      import('./items.js').then(async items => {
        await items.finalizeEggResultContext();
        showView('incubatorView');
      });
      return;
    }
    goIdle();
  });

  // 逃跑
  $('fleeBtn')?.addEventListener('click', () => fleeEncounter(false));

  // 导航按钮
  // header 图标：当前页面体系内（图标高亮）再次点击 → 直接返回首页挂机页；否则打开对应页面
  const bindHeaderIcon = (btn, open) => {
    btn?.addEventListener('click', () => {
      // 全屏确认场景（告别/派遣结算）锁定：顶部导航全部禁用
      if (isModalLocked()) return;
      // 战斗中锁定：仅允许进入设置（返回仍回战斗页），其余页面一律拦截；
      // 中途退出战斗只能通过战斗页的标题栏返回按钮撤退
      if (isBattleActive()) {
        if (btn.dataset.view === 'settingsView') open();
        return;
      }
      if (btn.classList.contains('active')) {
        resetNav(); // 再次点击当前页图标：直接回挂机页并清空导航栈
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

  // 底部三区点击：糖果→商店、状态文字→日志、当前道路→导航。
  // 统一逻辑：在挂机页面时点击跳转对应页面；不在挂机页面时点击直接返回挂机页面（即"再次点击返回"）。
  // 跳转时同步 prevView，保证标题栏返回按钮也回到挂机/战斗页。
  const footerNav = (open) => () => {
    if (isModalLocked()) return; // 全屏确认场景锁定：底部三区禁止点击跳转
    if (isBattleActive()) return; // 战斗中锁定：底部三区同样禁止点击跳转
    open(); // 打开目标页，返回目标由导航栈记录（从哪来回哪去）
  };
  $('statProgress')?.addEventListener('click', footerNav(showShopView));
  $('statAutoStatus')?.addEventListener('click', footerNav(showSystemLogs));
  $('statDropHint')?.addEventListener('click', footerNav(showSystemLogs));
  $('statTime')?.addEventListener('click', footerNav(showGpsView));
  // 标题栏返回逻辑：点击 appTitle 与鼠标后侧键（button 4）共用
  const handleAppTitleBack = () => {
    if ($('appTitle').dataset.action !== 'back') return;
    // 经验糖果使用场景尚未结算时：返回 = 取消并关闭场景（结算后只能点「确定」退出，标题返回维持锁定）
    if ($('expCandyView')?.style.display === 'flex' && $('expCandyBox')?.style.display !== 'flex') {
      import('./exp-candy.js').then(m => m.cancelExpCandyScene());
      return;
    }
    if (isModalLocked() && !(isBatchReleasing() && $('rosterView')?.style.display === 'flex')) return; // 全屏确认场景锁定：标题返回也不处理，只能通过场景内确定退出（派遣结算确定=返回）；批量放生除外——其本身由 isModalLocked 锁定，但点标题应直接取消批量放生
    // 批量放生模式：点击标题 = 取消批量放生（留在仓库列表）
    if (isBatchReleasing() && $('rosterView')?.style.display === 'flex') { cancelBatchRelease(); return; }
    // 孵蛋记录页打开且正处孵蛋器视图：点击标题只关记录页回主列表，否则走正常返回
    if (isIncubatorLogOpen() && $('incubatorView')?.style.display === 'flex') { closeIncubatorLog(); return; }
    // 对战记录页打开且正处战斗视图：点击标题只关记录页，否则走正常返回
    if (isLogOpen() && $('battleView')?.style.display === 'flex') { closeLogPage(); return; }
    // 配队"加入队伍"放入页打开：只退出放入页回队伍编辑页
    if (isTeamPicking() && $('teamView')?.style.display === 'flex') { leaveTeamPick(); return; }
    // 配队子页（队伍编辑页）打开：只回队伍列表页
    if (isTeamEditing() && $('teamView')?.style.display === 'flex') { closeTeamEdit(); return; }
    goBack();
  };
  $('appTitle')?.addEventListener('click', handleAppTitleBack);
  // 鼠标后侧键（后退键，button 3）返回：mousedown 先阻止浏览器历史导航的默认行为，
  // mouseup 时模拟点击 appTitle
  document.addEventListener('mousedown', e => { if (e.button === 3) e.preventDefault(); });
  document.addEventListener('mouseup', e => { if (e.button === 3) { e.preventDefault(); handleAppTitleBack(); } });

  // 图鉴搜索
  setupPokedexSearch();
  // 地区筛选
  setupRegionDropdown();
  // 解锁/稀有度/闪光多级筛选
  setupStatusDropdown();
  // 属性筛选
  setupTypeFilter();

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
    // 触发窗口关闭流程：Rust 拦截 close-requested 后弹出二次确认，存档在确认框出现前统一保存
    try {
      const tw = window.__TAURI__?.window;
      if (tw?.getCurrentWindow) await tw.getCurrentWindow().close();
      else if (tw?.appWindow?.close) await tw.appWindow.close();
    } catch (_) {}
  });

  // 关闭二次确认（右上角叉 / 任务栏关闭共用，由 Rust 拦截后触发）
  const openQuitDialog = () => $('quitDialog')?.classList.add('open');
  const closeQuitDialog = () => $('quitDialog')?.classList.remove('open');
  $('quitHide')?.addEventListener('click', async () => {
    closeQuitDialog();
    try { await window.__TAURI__.core.invoke('hide_to_tray'); } catch (_) {}
  });
  $('quitExit')?.addEventListener('click', async () => {
    closeQuitDialog();
    try { await window.__TAURI__.core.invoke('force_close_window'); } catch (_) {}
  });
  $('quitClose')?.addEventListener('click', closeQuitDialog);
  // 点击空白遮罩处关闭确认框
  $('quitDialog')?.addEventListener('click', (e) => {
    if (e.target === $('quitDialog')) closeQuitDialog();
  });
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen('close-requested', async () => {
      // 任务栏右键关闭时窗口可能已最小化，先恢复显示并聚焦再弹确认框
      try {
        const win = window.__TAURI__.window.getCurrentWindow();
        await win.unminimize();
        await win.show();
        await win.setFocus();
      } catch (_) {}
      try { await saveGame(); } catch (_) {} // 先落盘；存档失败不阻塞确认框弹出
      openQuitDialog();
    }).catch(() => {});
  }

  // 页面关闭前保存
  window.addEventListener('beforeunload', () => {
    if (window.__resettingSave) return;
    saveSessionState({ manualBike: road.isManualBike() }); // 骑行中刷新/关闭：记录骑行状态供恢复
    if (gameData) {
      gameData.stats.lastSaveTime = Date.now();
      try { localStorage.setItem('pokemon_idle_save', encodeSaveToPngDataUrl(gameData)); } catch (_) {}
    }
    try { localStorage.setItem('pokemon_idle_road', JSON.stringify({ roadIdx: _roadIdx, fished: getFishingGuarantee().fished })); } catch (_) {}
  });

  // 浏览器最小化/切后台：记账 + 立即结算进行中的遭遇——遭遇中的自动丢球由 showEncounter 的
  // 1.5s 定时器触发，该定时器会被浏览器冻结导致画面卡住；切后台立即启动后台快速结算。
  // 记账/开关统一收敛在 background-catchup.js，此处只注入运行依赖
  initBackgroundCatchup({
    isIdleRoadActive: () => phase === 'idle' && road.isActive(),
    isBike: () => road.isBike(),
    buffRemaining: () => {
      let ms = 0;
      if (honeyBuffActive && honeyCountdownEnd > Date.now()) ms = Math.max(ms, honeyCountdownEnd - Date.now());
      if (charmBuffActive && charmCountdownEnd > Date.now()) ms = Math.max(ms, charmCountdownEnd - Date.now());
      return ms;
    },
    onHidden: () => settleEncounterForBackground(),
  });
  startBackgroundCatchup();
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
  const slots = [...document.querySelectorAll('#bagPage1 .bag-slot')];
  const candy = document.getElementById('statProgress');
  const autoStatus = document.getElementById('statAutoStatus');
  const timeEl = document.getElementById('statTime');
  if (!splash || !ring || items.length === 0) { onDone?.(); return; }
  if (silent) setSplashLocked(true);
  splash.style.display = 'flex';
  // splash 期间背包顶部改回 border-top 上边框线：指示条隐藏，等落位动画结束再恢复
  const bagBar = document.querySelector('.backpack-bar');
  const bagInd = $('bagPageIndicator');
  if (bagBar) bagBar.classList.add('splash-border-top');
  if (bagInd) bagInd.style.display = 'none';
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
            // splash 结束：恢复背包页码指示条，移除 border-top 兜底线
            if (bagBar) bagBar.classList.remove('splash-border-top');
            if (bagInd) bagInd.style.display = '';
            // 清理第一页槽位的落位弹出类：类还在时第一页从隐藏恢复显示（翻回第一页）会重放缩放动画
            slots.forEach(s => s.classList.remove('bag-slot--pop'));
            // 移除开机渐显动画类：否则 statAutoStatus/statTime 每次从隐藏恢复都会重播淡入，造成闪烁
            if (autoStatus) autoStatus.classList.remove('stats-fade');
            if (timeEl) timeEl.classList.remove('stats-fade');
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
