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
} from './config.js';
import {
  gameData, allPokemon, getPokemonByIndex, getMassOutbreak, honeyBuffActive, phase,
  randInt, rand, saveGame, addSystemLog, inMassZone, normalizeMassRemainToEnd,
} from './state.js';
import { $, tryLoadPokemonIcon } from './ui.js';
import { MAP_EDGES, showGpsView } from './gps.js';
import { startMassEncounter, scheduleNextEncounter } from './battle.js';
import { notifyMassStart, notifyMassEnd, massMsgTick } from './messages.js';
import * as road from './road.js';

// ===== 生成 / 结束 =====

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
  // 随机选一条路段 + 路段中段位置（20%~80%，避开节点）
  const edge = MAP_EDGES[randInt(0, MAP_EDGES.length - 1)];
  const t = 0.2 + Math.random() * 0.6;
  // 事件宝可梦：从事件点归属地区随机选（t<0.5 归小号端地区，否则归大号端）
  const regionIdx = t < 0.5 ? Math.min(edge[0], edge[1]) : Math.max(edge[0], edge[1]);
  const regionName = REGION_CYCLE[regionIdx];
  const pool = allPokemon.filter(p => p.region === regionName);
  if (pool.length === 0) {
    gameData.massNextGenAt = Date.now() + randInt(10, 30) * 60000; // 该地区无精灵则稍后重试
    return;
  }
  const poke = pool[randInt(0, pool.length - 1)];
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
  if (gameData.gps) { normalizeMassRemainToEnd(gameData.gps); gameData.gps.massTarget = null; gameData.gps.massArrived = false; } // 事件结束，取消残留的事件点导航目标与到达标记
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
  const poke = getPokemonByIndex(mo.pokemon);
  const screen = $('screen');
  const charEl = $('walkGif');
  if (!poke || !screen || !charEl) return;

  // 闪光判定提前到生成时刻：滚动图标能像交换页面一样用星星标记闪光，
  // 碰到时复用同一判定，保证显示与战斗一致
  _massPokeShiny = Math.random() < MASS_SHINY_CHANCE;

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
    star.innerHTML = '<use xlink:href="./icons/sprites.svg#icon-star"/>';
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
}

function hitMassPoke() {
  const mo = gameData?.massOutbreak;
  const poke = mo ? getPokemonByIndex(mo.pokemon) : null;
  const shiny = _massPokeShiny;
  despawnMassPoke();
  if (!poke) return;
  startMassEncounter(poke, shiny); // 战斗画面/暂停道路由 showEncounter 处理
}

function _massFrame() {
  if (!_massRafActive) return;
  const mo = gameData?.massOutbreak;
  const runOk = !!mo && phase === 'idle' && inMassZone()
    && $('idleView')?.style.display !== 'none' && road.isActive();
  if (!runOk) {
    stopMassRaf();
    despawnMassPoke();
    return;
  }
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
  const shouldRun = !!mo && phase === 'idle' && inMassZone()
    && $('idleView')?.style.display !== 'none' && road.isActive();
  if (!shouldRun) { stopMassRaf(); despawnMassPoke(); return; }
  startMassRaf();
}
