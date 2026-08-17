// ===== 大量出没（随机道路事件）=====
// 随机间隔在道路网络上生成一个「大量出没」事件点：某只宝可梦在某条路段大量出现。
// 玩家可在地图点击事件点导航过去；进入事件路段后，事件宝可梦会像道路道具一样滚向主角，
// 碰到即进入战斗（锁定该宝可梦、闪光率提升、不吃闪耀护符但可吃甜甜蜜加速下一只）。
// 抓完剩余数量或事件到期后结束。
import {
  MASS_GEN_MIN, MASS_GEN_MAX, MASS_DURATION,
  MASS_COUNT_MIN, MASS_COUNT_MAX,
  MASS_SPAWN_MIN, MASS_SPAWN_MAX, MASS_SPAWN_HONEY_MIN, MASS_SPAWN_HONEY_MAX,
  MASS_SHINY_CHANCE, REGION_CYCLE,
  TWIST_GEN_MIN, TWIST_GEN_MAX, TWIST_DURATION,
  TWIST_COUNT_MIN, TWIST_COUNT_MAX,
  TWIST_SPAWN_MIN, TWIST_SPAWN_MAX,
  TWIST_SHINY_CHANCE, TWIST_RGB_CHANCE, TWIST_POLLUTED_CHANCE,
} from './config.js';
import {
  gameData, allPokemon, getPokemonByIndex, getMassOutbreak, getTwist, honeyBuffActive, phase,
  randInt, rand, saveGame, addSystemLog, inMassZone, inTwistZone, normalizeMassRemainToEnd, _fishing,
} from './state.js';
import { $, tryLoadPokemonIcon, setIdleCharacter, isOnGameView } from './ui.js';
import { endCycling } from './audio.js';
import { MAP_EDGES, showGpsView } from './gps.js';
import { startMassEncounter, startTwistEncounter, scheduleNextEncounter } from './battle.js';
import { notifyMassStart, notifyMassEnd, massMsgTick, notifyTwistStart, notifyTwistEnd, twistMsgTick } from './messages.js';
import { pickFamily } from './items.js';
import * as road from './road.js';

// ===== 生成 / 结束 =====

// 随机选一条事件路段：大量出没与时空扭曲可同时活跃，必须避开另一事件所在路段，
// 否则玩家停在事件点时会同时满足两个事件区域（inMassZone 与 inTwistZone 共用 massArrived），
// 两套滚动精灵同时撞向主角，战斗会被后触发的覆盖（串台）。
function pickEventEdge(excludeEdge) {
  const candidates = MAP_EDGES.filter(([a, b]) => !excludeEdge
    || !((a === excludeEdge[0] && b === excludeEdge[1]) || (a === excludeEdge[1] && b === excludeEdge[0])));
  if (candidates.length === 0) return null;
  return candidates[randInt(0, candidates.length - 1)];
}

// 初始化下次生成时间（旧存档/新档缺字段时兜底）
export function ensureMassInit() {
  if (!gameData) return;
  if (typeof gameData.massNextGenAt !== 'number' || !(gameData.massNextGenAt > 0)) {
    gameData.massNextGenAt = Date.now() + randInt(MASS_GEN_MIN, MASS_GEN_MAX) * 60000;
  }
}

// 随机生成一次事件
function spawnMassOutbreak() {
  if (!gameData || gameData.massOutbreak?.active) return;
  if (MAP_EDGES.length === 0) return;
  // 随机选一条路段 + 路段中段位置（20%~80%，避开节点）；避开时空扭曲正在发生的路段
  const edge = pickEventEdge(gameData.twist?.edge);
  if (!edge) return;
  const t = 0.2 + Math.random() * 0.6;
  // 事件宝可梦：从事件点归属地区随机选（t<0.5 归小号端地区，否则归大号端）
  const regionIdx = t < 0.5 ? Math.min(edge[0], edge[1]) : Math.max(edge[0], edge[1]);
  const regionName = REGION_CYCLE[regionIdx];
  const pool = allPokemon.filter(p => p.region === regionName);
  if (pool.length === 0) {
    gameData.massNextGenAt = Date.now() + randInt(10, 30) * 60000; // 该地区无精灵则稍后重试
    return;
  }
  // 家族归一：多变体家族（未知图腾、彩粉蝶等）按单个形态计，不因形态数叠加
  const poke = pickFamily(pool, () => 1);
  const remain = randInt(MASS_COUNT_MIN, MASS_COUNT_MAX);
  gameData.massOutbreak = {
    edge, t,                       // 事件路段 + 事件点在路段上的位置比例
    pokemon: poke.index,           // 事件宝可梦编号
    remain,                        // 剩余可遭遇数量
    expiresAt: Date.now() + MASS_DURATION * 60000, // 事件到期时间
    nextSpawnAt: 0,                // 下一只事件宝可梦出现时间（0=立即）
    active: true,
  };
  gameData.massNextGenAt = Date.now() + randInt(MASS_GEN_MIN, MASS_GEN_MAX) * 60000;
  addSystemLog('mass_outbreak_start', { edge, t, pokemon: poke.index, remain });
  saveGame();
  notifyMassStart();
}

// 结束事件（抓完或到期）
export function endMassOutbreak() {
  if (!gameData?.massOutbreak) return;
  const mo = gameData.massOutbreak;
  addSystemLog('mass_outbreak_end', { pokemon: mo.pokemon });
  gameData.massOutbreak = null;
  // 事件结束：先换算事件边上的剩余语义再取消目标，避免残留的"到事件点剩余"被当普通路段读导致瞬移
  if (gameData.gps) {
    normalizeMassRemainToEnd(gameData.gps);
    const hadMassTarget = !!gameData.gps.massTarget;
    gameData.gps.massTarget = null;
    gameData.gps.massArrived = false;
    // 事件结束且玩家正骑行导航到该事件点：目的地已失效，手动骑行立即下车。
    // 否则会停在「骑行中 + 地图禁止改选目的地（planRoute 拦截）+ 取消按钮不显示（hasDest=false）」
    // 的不可操作死锁状态；forceStopBikeInMassZone 依赖 massOutbreak.active，此刻已失效，必须在此兜底。
    if (hadMassTarget && road.isManualBike()) {
      road.setManualBike(false);
    }
  }
  saveGame();
  notifyMassEnd(mo);
  // 事件结束：恢复正常遇敌调度（在战斗中到期时由 goIdle 的 scheduleNextEncounter 兜底）
  scheduleNextEncounter();
}

// 遭遇结束后由 battle.js 调用：剩余数量 -1，未抓完则调度下一只出现
export function onMassEncounterEnded() {
  const mo = gameData?.massOutbreak;
  if (!mo || !mo.active) return;
  mo.remain--;
  if (mo.remain <= 0) { endMassOutbreak(); return; }
  scheduleMassSpawn();
}

// 调度下一只事件宝可梦出现（甜甜蜜生效时更快，可享受加成）
export function scheduleMassSpawn() {
  const mo = gameData?.massOutbreak;
  if (!mo || !mo.active) return;
  const min = honeyBuffActive ? MASS_SPAWN_HONEY_MIN : MASS_SPAWN_MIN;
  const max = honeyBuffActive ? MASS_SPAWN_HONEY_MAX : MASS_SPAWN_MAX;
  mo.nextSpawnAt = Date.now() + rand(min, max) * 1000;
}

// 主循环 tick（main.js 每秒调用）：生成 / 到期 / 滚动出现
export function massTick() {
  if (!gameData) return;
  ensureMassInit();
  const now = Date.now();
  if (!gameData.massOutbreak?.active) {
    if (now >= gameData.massNextGenAt) spawnMassOutbreak();
    return;
  }
  if (now >= gameData.massOutbreak.expiresAt) { endMassOutbreak(); return; }
  massMsgTick(now);      // 大量出没提示文案轮播（远处 / 区域内）
  updateMassSpawner(now);
}

// 调试/测试用：清掉当前事件并立即生成一次新事件，同时刷新地图显示（挂在 window.__resetMassOutbreak）
export function forceRefreshMassOutbreak() {
  if (!gameData) return;
  if (gameData.massOutbreak) {
    addSystemLog('mass_outbreak_end', { pokemon: gameData.massOutbreak.pokemon, forced: true });
    gameData.massOutbreak = null;
    if (gameData.gps) { normalizeMassRemainToEnd(gameData.gps); gameData.gps.massTarget = null; gameData.gps.massArrived = false; }
  }
  spawnMassOutbreak();
  if (!gameData.massOutbreak) gameData.massNextGenAt = Date.now() + 1000; // 生成失败（该地区无精灵）则 1 秒后重试
  saveGame();
  if ($('gpsView')?.style.display === 'flex') showGpsView(); // 地图打开时刷新事件点标记
}

// ===== 事件点精灵（主界面滚动）=====
// 在事件路段内，事件宝可梦像道路道具一样从右向左滚向主角（上下跳动），碰到即进入战斗
let _massPokeEl = null;    // 滚动的宝可梦容器 <div>
let _massPokeX = 0;        // 宝可梦当前 X
let _massCharX = 0;        // 主角碰撞点 X
let _massPokeShiny = false; // 本只是否闪光（生成时判定，碰到时复用）
let _massRafActive = false;

function spawnMassPoke() {
  const mo = getMassOutbreak();
  if (!mo) return;
  // 优先恢复持久化的当前精灵（刷新后与刷新前的 icon 一致：种类锁定、闪光标记不丢）；
  // 没有记录（新生成/上一只已遭遇）则重新判定闪光并持久化
  const saved = mo.cur && getPokemonByIndex(mo.cur.species) ? mo.cur : null;
  const poke = saved
    ? getPokemonByIndex(saved.species)
    : getPokemonByIndex(mo.pokemon);
  const screen = $('screen');
  const charEl = $('walkGif');
  if (!poke || !screen || !charEl) return;

  // 闪光判定提前到生成时刻：滚动图标能像交换页面一样用星星标记闪光，
  // 碰到时复用同一判定，保证显示与战斗一致
  _massPokeShiny = saved ? !!saved.shiny : Math.random() < MASS_SHINY_CHANCE;
  if (!saved) {
    mo.cur = { species: poke.index, shiny: _massPokeShiny };
    saveGame();
  }

  // 容器内放头像 icon，闪光时右上角叠星星标记（同交换页面 NPC 旁的闪光表示）
  const el = document.createElement('div');
  el.className = 'mass-poke';
  screen.appendChild(el);
  const img = document.createElement('img');
  img.className = 'mass-poke-img';
  el.appendChild(img);
  if (_massPokeShiny) {
    const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    star.setAttribute('viewBox', '0 0 1024 1024');
    star.classList.add('mass-poke-shiny');
    star.innerHTML = '<use xlink:href="#icon-star"/>';
    el.appendChild(star);
  }
  // 异步加载头像 icon；加载失败则移除，等待下一只
  tryLoadPokemonIcon(img, poke).then(ok => {
    if (!ok || !el.isConnected) { el.remove(); if (_massPokeEl === el) _massPokeEl = null; }
  });

  const sRect = screen.getBoundingClientRect();
  const cRect = charEl.getBoundingClientRect();
  _massCharX = cRect.left - sRect.left + 24;
  const roadEl = document.querySelector('.road-layer');
  const rRect = roadEl ? roadEl.getBoundingClientRect() : cRect;
  const y = (rRect.top - sRect.top) + 14; // 底边贴近路面
  _massPokeX = sRect.width + 16;
  el.style.left = _massPokeX + 'px';
  el.style.top = y + 'px';
  _massPokeEl = el;
}

function despawnMassPoke() {
  if (_massPokeEl) { _massPokeEl.remove(); _massPokeEl = null; }
  _massPokeShiny = false;
  // 清除持久化的当前精灵：遭遇后/走过头/离开区域后，下一只重新生成
  if (gameData?.massOutbreak) gameData.massOutbreak.cur = null;
}

function hitMassPoke() {
  const mo = gameData?.massOutbreak;
  const poke = mo ? getPokemonByIndex(mo.pokemon) : null;
  const shiny = _massPokeShiny;
  despawnMassPoke();
  if (!poke) return;
  startMassEncounter(poke, shiny); // 战斗画面/暂停道路由 showEncounter 处理
}

// 后台挂机（不在主界面）时的后台遭遇：与普通遇敌后台直收一致，到点直接触发战斗。
// 优先复用持久化的当前精灵（刷新场景下闪光与刷新前一致）；无记录才另行重 roll。
function backgroundHitMass() {
  const mo = gameData?.massOutbreak;
  const poke = mo ? getPokemonByIndex(mo.pokemon) : null;
  if (!poke) return;
  const saved = mo.cur;
  const shiny = saved ? !!saved.shiny : Math.random() < MASS_SHINY_CHANCE;
  mo.cur = null;
  startMassEncounter(poke, shiny);
}

function _massFrame() {
  if (!_massRafActive) return;
  const mo = gameData?.massOutbreak;
  const runOk = !!mo && phase === 'idle' && inMassZone()
    && $('idleView')?.style.display !== 'none';
  if (!runOk) {
    stopMassRaf();
    despawnMassPoke();
    return;
  }
  // 道路暂停（拾取道具等）：宝可梦原地等待，捡完恢复滚动，避免"捡完球 icon 消失"
  if (!road.isActive()) { requestAnimationFrame(_massFrame); return; }
  if (road.isBike()) { requestAnimationFrame(_massFrame); return; }

  // 无精灵且到点 → 生成下一只（nextSpawnAt 初始 0，进区域立即出现）
  if (!_massPokeEl && Date.now() >= mo.nextSpawnAt) spawnMassPoke();

  if (_massPokeEl) {
    _massPokeX -= road.getSpeed();
    _massPokeEl.style.left = _massPokeX + 'px';
    if (_massPokeX <= _massCharX) { hitMassPoke(); return; }
    if (_massPokeX < -120) despawnMassPoke();
  }
  requestAnimationFrame(_massFrame);
}

function startMassRaf() {
  if (_massRafActive) return;
  _massRafActive = true;
  requestAnimationFrame(_massFrame);
}

function stopMassRaf() {
  _massRafActive = false;
}

function updateMassSpawner(now) {
  const mo = getMassOutbreak();
  const idleHidden = $('idleView')?.style.display === 'none';
  // 事件宝可梦只在事件区域内遭遇；离页时同样判断区域（位置不变，玩家停留处仍在事件路段内）
  if (!mo || phase !== 'idle' || !inMassZone()) { stopMassRaf(); despawnMassPoke(); return; }
  if (idleHidden) {
    // 后台挂机：不做滚动动画但保留持久化的当前精灵（cur），到点直接触发战斗；
    // 元素随 RAF 停止后仍在屏幕位置，此处手动移除，避免离页时残留
    stopMassRaf();
    if (_massPokeEl) { _massPokeEl.remove(); _massPokeEl = null; }
    _massPokeShiny = false;
    if (Date.now() >= mo.nextSpawnAt) backgroundHitMass();
    return;
  }
  // 注意不含 road.isActive()：拾取道具等道路暂停时保持 RAF，由 _massFrame 原地等待，避免捡完球 icon 消失
  // 大量出没事件点可能落在自行车路段上：骑行中事件宝可梦不滚动、普通遭遇也不触发，
  // 玩家到了点位却在骑车会错过事件。进入事件区域立即强制下车，恢复正常遭遇等非骑行功能。
  forceStopBikeInMassZone();
  startMassRaf();
}

// 大量出没区域内强制结束骑行状态（自行车路段 _bike 和/或手动骑行 _manualBike）
function forceStopBikeInMassZone() {
  if (!road.isBike()) return;
  // 先清路段骑行状态，再清手动骑行：onManualBikeChanged 回调里 road.isBike() 已是 false，
  // 骑行音乐 / 角色外观 / 存档 / 背包槽 / buff 禁用都会按「下车」正确处理
  road.setBike(false);
  if (road.isManualBike()) road.setManualBike(false);
  endCycling();             // 兜底：停止骑行音乐
  setIdleCharacter('walk'); // 恢复走路外观与速度
}

// ===== 时空扭曲（跨地区稀有事件）=====
// 随机间隔在道路网络上生成一个「时空扭曲」事件点：异时空宝可梦在该路段大量出现。
// 与大量出没复用同一套 gps 事件点导航机制（massTarget/massArrived），但事件对象独立存放。
// 每次遭遇：从「排除事件点归属地区」的全局宝可梦池随机抽一只，
// 个体值保底 2V，并可能 roll 出 RGB / 污染外观变体（仅外观，闪光判定正常）。
// 宝可梦池每次生成事件时快照，不会因玩家跨地区移动而漂移。
function spawnTwist() {
  if (!gameData || gameData.twist?.active) return;
  if (MAP_EDGES.length === 0) return;
  // 随机选一条路段 + 路段中段位置（20%~80%，避开节点）；避开大量出没正在发生的路段
  const edge = pickEventEdge(gameData.massOutbreak?.edge);
  if (!edge) return;
  const t = 0.2 + Math.random() * 0.6;
  // 事件点归属地区（t<0.5 归小号端地区，否则归大号端）；池 = 该地区以外的全部宝可梦
  const regionIdx = t < 0.5 ? Math.min(edge[0], edge[1]) : Math.max(edge[0], edge[1]);
  const regionName = REGION_CYCLE[regionIdx];
  const pool = allPokemon.filter(p => p.region !== regionName);
  if (pool.length === 0) {
    gameData.twistNextGenAt = Date.now() + randInt(10, 30) * 60000; // 无可用池则稍后重试
    return;
  }
  const remain = randInt(TWIST_COUNT_MIN, TWIST_COUNT_MAX);
  gameData.twist = {
    edge, t,                       // 事件路段 + 事件点在路段上的位置比例
    pool: pool.map(p => p.index),  // 该局可遭遇的宝可梦编号池（排除归属地区）
    remain,                        // 剩余可遭遇数量
    expiresAt: Date.now() + TWIST_DURATION * 60000, // 事件到期时间
    nextSpawnAt: 0,                // 下一只事件宝可梦出现时间（0=立即）
    active: true,
  };
  gameData.twistNextGenAt = Date.now() + randInt(TWIST_GEN_MIN, TWIST_GEN_MAX) * 60000;
  addSystemLog('twist_start', { edge, t, remain });
  saveGame();
  notifyTwistStart();
}

// 结束事件（抓完或到期）：与大量出没一致，先换算事件边剩余语义再取消 gps 目标
export function endTwist() {
  if (!gameData?.twist) return;
  const tw = gameData.twist;
  addSystemLog('twist_end', {});
  gameData.twist = null;
  if (gameData.gps) {
    normalizeMassRemainToEnd(gameData.gps);
    const hadMassTarget = !!gameData.gps.massTarget;
    gameData.gps.massTarget = null;
    gameData.gps.massArrived = false;
    if (hadMassTarget && road.isManualBike()) {
      road.setManualBike(false);
    }
  }
  saveGame();
  notifyTwistEnd();
  scheduleNextEncounter();
}

// 遭遇结束后由 battle.js 调用：剩余数量 -1，未抓完则调度下一只出现
export function onTwistEncounterEnded() {
  const tw = gameData?.twist;
  if (!tw || !tw.active) return;
  tw.remain--;
  if (tw.remain <= 0) { endTwist(); return; }
  tw.nextSpawnAt = Date.now() + rand(TWIST_SPAWN_MIN, TWIST_SPAWN_MAX) * 1000;
}

// 主循环 tick（main.js 每秒调用）：生成 / 到期 / 滚动出现
export function twistTick() {
  if (!gameData) return;
  ensureTwistInit();
  const now = Date.now();
  if (!gameData.twist?.active) {
    updateTwistOverlay(); // 事件结束/不存在：确保遮罩收起
    if (now >= gameData.twistNextGenAt) spawnTwist();
    return;
  }
  if (now >= gameData.twist.expiresAt) { endTwist(); return; }
  twistMsgTick(now);      // 时空扭曲提示文案轮播（远处 / 区域内）
  updateTwistSpawner(now);
  updateTwistOverlay(now); // 主界面扭曲氛围遮罩
}

// 视图切换时立即同步扭曲配色（showView 调用），避免等下一帧 tick 才有反应
export function syncTwistTheme() {
  updateTwistOverlay();
}

// 主界面时空扭曲氛围遮罩 + 屏幕容器紫色化：
// 容器变色仅在位于扭曲区域且停留在游戏页（挂机 / 野遇遭遇）时保持；
// 切到图鉴/商店等其它页面立即恢复原配色（跳变，不做淡出），避免紫色主题外泄
function updateTwistOverlay() {
  const el = $('twistOverlay');
  const zone = inTwistZone();
  const onGame = isOnGameView();
  if (el) {
    const show = zone && phase === 'idle' && !_fishing;
    el.classList.toggle('on', show);
  }
  const scr = $('screen');
  if (!scr) return;
  const active = zone && onGame;
  if (scr.classList.contains('twist-active') === active) return;
  // 切离游戏页时禁用过渡实现立即跳变；留在游戏页内进入/离开扭曲区域则平滑过渡
  if (!onGame) scr.classList.add('no-theme-trans');
  scr.classList.toggle('twist-active', active);
  if (!onGame) {
    void scr.offsetWidth; // 强制重排，让"无过渡移除"立即生效
    scr.classList.remove('no-theme-trans');
  }
}

// 初始化下次生成时间（旧存档/新档缺字段时兜底）
export function ensureTwistInit() {
  if (!gameData) return;
  if (typeof gameData.twistNextGenAt !== 'number' || !(gameData.twistNextGenAt > 0)) {
    gameData.twistNextGenAt = Date.now() + randInt(TWIST_GEN_MIN, TWIST_GEN_MAX) * 60000;
  }
}

// 调试/测试用：清掉当前事件并立即生成一次新事件，同时刷新地图显示（挂在 window.__resetTwist）
export function forceRefreshTwist() {
  if (!gameData) return;
  if (gameData.twist) {
    addSystemLog('twist_end', { forced: true });
    gameData.twist = null;
    if (gameData.gps) { normalizeMassRemainToEnd(gameData.gps); gameData.gps.massTarget = null; gameData.gps.massArrived = false; }
  }
  spawnTwist();
  if (!gameData.twist) gameData.twistNextGenAt = Date.now() + 1000; // 生成失败（无可用池）则 1 秒后重试
  saveGame();
  if ($('gpsView')?.style.display === 'flex') showGpsView(); // 地图打开时刷新事件点标记
}

// ===== 时空扭曲事件点精灵（主界面滚动）=====
// 与大量出没滚动精灵结构相同：从右向左滚向主角，碰到进入战斗。
// 额外支持外观变体（RGB / 污染）：滚动图标即应用 CSS 滤镜特效。
let _twistPokeEl = null;     // 滚动的宝可梦容器 <div>
let _twistPokeX = 0;         // 宝可梦当前 X
let _twistCharX = 0;         // 主角碰撞点 X
let _twistPokeShiny = false; // 本只是否闪光（生成时判定，碰到时复用）
let _twistVariant = null;    // 本只外观变体：'rgb' / 'polluted' / null
let _twistPoke = null;       // 本只宝可梦（生成时选定，碰到时复用，滚动与战斗一致）
let _twistRafActive = false;

function spawnTwistPoke() {
  const tw = getTwist();
  if (!tw || tw.pool.length === 0) return;
  // 优先恢复持久化的当前精灵（刷新后与刷新前的 icon/闪光/变体保持一致）；
  // 无记录（新生成/上一只已遭遇）则重新随机并持久化
  const saved = tw.cur && tw.pool.includes(tw.cur.species) ? tw.cur : null;
  const poke = saved
    ? getPokemonByIndex(saved.species)
    : getPokemonByIndex(tw.pool[randInt(0, tw.pool.length - 1)]);
  const screen = $('screen');
  const charEl = $('walkGif');
  if (!poke || !screen || !charEl) return;

  if (saved) {
    _twistPokeShiny = !!saved.shiny;
    _twistVariant = saved.variant || null;
  } else {
    // 闪光与变体提前到生成时刻判定：滚动图标与应用与战斗一致
    _twistPokeShiny = Math.random() < TWIST_SHINY_CHANCE;
    const r = Math.random();
    _twistVariant = r < TWIST_RGB_CHANCE ? 'rgb' : (r < TWIST_RGB_CHANCE + TWIST_POLLUTED_CHANCE ? 'polluted' : null);
    tw.cur = { species: poke.index, shiny: _twistPokeShiny, variant: _twistVariant };
    saveGame();
  }

  const el = document.createElement('div');
  el.className = 'mass-poke';
  screen.appendChild(el);
  _twistPoke = poke; // 记录本只宝可梦：碰撞时复用，滚动图标与战斗个体一致
  const img = document.createElement('img');
  img.className = 'mass-poke-img';
  if (_twistVariant === 'rgb') img.classList.add('fx-variant-rgb');
  else if (_twistVariant === 'polluted') img.classList.add('fx-variant-polluted');
  el.appendChild(img);
  if (_twistPokeShiny) {
    const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    star.setAttribute('viewBox', '0 0 1024 1024');
    star.classList.add('mass-poke-shiny');
    star.innerHTML = '<use xlink:href="#icon-star"/>';
    el.appendChild(star);
  }
  tryLoadPokemonIcon(img, poke).then(ok => {
    if (!ok || !el.isConnected) { el.remove(); if (_twistPokeEl === el) _twistPokeEl = null; }
  });

  const sRect = screen.getBoundingClientRect();
  const cRect = charEl.getBoundingClientRect();
  _twistCharX = cRect.left - sRect.left + 24;
  const roadEl = document.querySelector('.road-layer');
  const rRect = roadEl ? roadEl.getBoundingClientRect() : cRect;
  const y = (rRect.top - sRect.top) + 14;
  _twistPokeX = sRect.width + 16;
  el.style.left = _twistPokeX + 'px';
  el.style.top = y + 'px';
  _twistPokeEl = el;
}

function despawnTwistPoke() {
  if (_twistPokeEl) { _twistPokeEl.remove(); _twistPokeEl = null; }
  _twistPokeShiny = false;
  _twistVariant = null;
  _twistPoke = null;
  // 清除持久化的当前精灵：遭遇后/走过头/离开区域后，下一只重新生成
  if (gameData?.twist) gameData.twist.cur = null;
}

function hitTwistPoke() {
  const tw = gameData?.twist;
  if (!tw) { despawnTwistPoke(); return; }
  const poke = _twistPoke || getPokemonByIndex(tw.pool[randInt(0, tw.pool.length - 1)]);
  const shiny = _twistPokeShiny;
  const variant = _twistVariant;
  despawnTwistPoke();
  if (!poke) return;
  startTwistEncounter(poke, shiny, variant);
}

// 后台挂机（不在主界面）时的时空扭曲后台遭遇：与大量出没/普通遇敌后台直收一致，
// 到点直接触发战斗。优先复用持久化的当前精灵（刷新场景下闪光/变体与刷新前一致）；
// 无记录才另行随机。
function backgroundHitTwist() {
  const tw = gameData?.twist;
  if (!tw) return;
  const saved = tw.cur && tw.pool.includes(tw.cur.species) ? tw.cur : null;
  const poke = saved
    ? getPokemonByIndex(saved.species)
    : getPokemonByIndex(tw.pool[randInt(0, tw.pool.length - 1)]);
  if (!poke) return;
  const shiny = saved ? !!saved.shiny : Math.random() < TWIST_SHINY_CHANCE;
  let variant = saved ? (saved.variant || null) : null;
  if (!saved) {
    const r = Math.random();
    variant = r < TWIST_RGB_CHANCE ? 'rgb' : (r < TWIST_RGB_CHANCE + TWIST_POLLUTED_CHANCE ? 'polluted' : null);
  }
  tw.cur = null;
  startTwistEncounter(poke, shiny, variant);
}

function _twistFrame() {
  if (!_twistRafActive) return;
  const tw = gameData?.twist;
  const runOk = !!tw && phase === 'idle' && inTwistZone()
    && $('idleView')?.style.display !== 'none';
  if (!runOk) {
    stopTwistRaf();
    despawnTwistPoke();
    return;
  }
  if (!road.isActive()) { requestAnimationFrame(_twistFrame); return; }
  if (road.isBike()) { requestAnimationFrame(_twistFrame); return; }

  if (!_twistPokeEl && Date.now() >= tw.nextSpawnAt) spawnTwistPoke();

  if (_twistPokeEl) {
    _twistPokeX -= road.getSpeed();
    _twistPokeEl.style.left = _twistPokeX + 'px';
    if (_twistPokeX <= _twistCharX) { hitTwistPoke(); return; }
    if (_twistPokeX < -120) despawnTwistPoke();
  }
  requestAnimationFrame(_twistFrame);
}

function startTwistRaf() {
  if (_twistRafActive) return;
  _twistRafActive = true;
  requestAnimationFrame(_twistFrame);
}

function stopTwistRaf() {
  _twistRafActive = false;
}

function updateTwistSpawner(now) {
  const tw = getTwist();
  const idleHidden = $('idleView')?.style.display === 'none';
  if (!tw || phase !== 'idle' || !inTwistZone()) { stopTwistRaf(); despawnTwistPoke(); return; }
  if (idleHidden) {
    // 后台挂机：不做滚动动画但保留持久化的当前精灵（cur），到点直接触发战斗；
    // 元素随 RAF 停止后仍在屏幕位置，此处手动移除，避免离页时残留
    stopTwistRaf();
    if (_twistPokeEl) { _twistPokeEl.remove(); _twistPokeEl = null; }
    _twistPokeShiny = false;
    _twistVariant = null;
    _twistPoke = null;
    if (Date.now() >= tw.nextSpawnAt) backgroundHitTwist();
    return;
  }
  forceStopBikeInTwistZone();
  startTwistRaf();
}

// 时空扭曲区域内强制结束骑行状态（同大量出没）
function forceStopBikeInTwistZone() {
  if (!road.isBike()) return;
  road.setBike(false);
  if (road.isManualBike()) road.setManualBike(false);
  endCycling();
  setIdleCharacter('walk');
}
