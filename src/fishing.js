// ===== 钓鱼系统 =====
// 进入有垂钓点的路段后停下钓鱼一次：甩竿 → 等待上钩（随机6~30s）→ 上钩抖动 → 收获随机道具×1~10
import { ITEM_NAMES, ITEM_RATES, FISH_POKEMON_CHANCE, FISH_BUFF_POKEMON_CHANCE, FISH_RARE_RATE, FISH_WAIT_MIN, FISH_WAIT_MAX, FISH_QTY_MIN, FISH_QTY_MAX, FISH_TRIGGER_MIN, FISH_TRIGGER_MAX, BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX } from './config.js';
import { ITEM_ICONS, clearHoneyCountdown, clearCharmCountdown, startHoneyCountdown, startCharmCountdown, pickFamily } from './items.js';
import { phase, gameData, nextEncounterTimer, honeyBuffActive, charmBuffActive, honeyCountdownEnd, charmCountdownEnd, honeyCountdownInterval, charmCountdownInterval, honeyPausedRemaining, charmPausedRemaining, honeyExpiryTimer, charmExpiryTimer, _itemDropActive, _fishing, gameTick, allPokemon, getCurrentRegion, setFishing, setNextEncounterTimer, saveGame, addSystemLog, randInt, rand, setHoneyBuffActive, setCharmBuffActive, setHoneyCountdownEnd, setCharmCountdownEnd, setHoneyPausedRemaining, setCharmPausedRemaining, setHoneyExpiryTimer, setCharmExpiryTimer, setHoneyCountdownInterval, setCharmCountdownInterval } from './state.js';
import { $, setIdleCharacter, updateBackpack, updateStats, getCharPrefix } from './ui.js';
import { showFishingWait, showFishingResult, showBuffExpired } from './messages.js';
import { delay } from './animation.js';
import { scheduleNextEncounter, startFishingEncounter, tryEncounter } from './battle.js';
import * as road from './road.js';
import * as particles from './particles.js';

const FISH_FRAME_W = 64; // 每帧 32px，2x 显示

// 每个有垂钓点的路段恰好钓一次：进入路段时预定一个应钓鱼的 tick
let _fishingDueTick = 0;
let _fishedInSegment = false;

// 钓鱼期间水域上的漂浮物品（DOM 元素列表）
let _floatItems = [];
const FLOAT_OPACITY = 0.35;

// 随机摆放一个漂浮物品
function placeFloatItem(img, layer, rowY, topMin, topMax) {
  const layerW = layer.clientWidth || 300;
  img.style.left = Math.floor(Math.random() * layerW) + 'px';
  img.style.top = Math.floor(rowY + topMin + Math.random() * (topMax - topMin)) + 'px';
}

// 若隐若现：淡入 → 停留 → 淡出 → 换一个位置重新淡入，循环往复
function cycleFloatItem(img, layer, rowY, topMin, topMax) {
  if (!img.isConnected) return;
  img.style.opacity = String(FLOAT_OPACITY);                 // 淡入
  const hold = 1500 + Math.random() * 2500;                  // 停留 1.5~4s
  setTimeout(() => {
    if (!img.isConnected) return;
    img.style.opacity = '0';                                 // 淡出
    setTimeout(() => {
      if (!img.isConnected) return;
      placeFloatItem(img, layer, rowY, topMin, topMax);      // 换个位置
      cycleFloatItem(img, layer, rowY, topMin, topMax);
    }, 1000);
  }, hold);
}

// 在垂钓行随机生成几个淡淡的漂浮物品图标
function spawnFloatingItems() {
  const layer = $('roadLayer');
  const row = road.getFishingRow();
  if (!layer || !row) return;
  const rowY = (row - 1) * 24;                     // 该行在路面层内的 y（每行 24px）
  const topMin = row === 1 ? 0 : 12;               // 第1行(上)图标靠上半，第3行(下)图标靠下半
  const topMax = row === 1 ? 12 : 24;
  const icons = Object.keys(ITEM_RATES);
  const count = randInt(3, 5);
  for (let i = 0; i < count; i++) {
    const img = document.createElement('img');
    img.className = 'fish-float';
    img.src = `./items/${ITEM_ICONS[icons[randInt(0, icons.length - 1)]]}`;
    img.style.opacity = '0';
    img.style.transition = 'opacity 1s ease';
    img.style.animationDuration = (4 + Math.random() * 5).toFixed(2) + 's';
    img.style.animationDelay = (-Math.random() * 5).toFixed(2) + 's';
    layer.appendChild(img);
    _floatItems.push(img);
    placeFloatItem(img, layer, rowY, topMin, topMax);
    cycleFloatItem(img, layer, rowY, topMin, topMax);
  }
}

function clearFloatingItems() {
  for (const el of _floatItems) el.remove();
  _floatItems = [];
}

export function isFishing() { return _fishing; }

// 垂钓路段的等待窗口（进入路段后、开始钓鱼前）：窗口内不触发普通遇敌
export function isFishingPending() { return gameTick < _fishingDueTick; }

// 路段切换时调用：若该路段有垂钓点，预定 5~15 秒后触发一次钓鱼
// opts.fished 为 true 表示该路段本次循环已钓过（刷新页面后恢复），不再触发
export function onRoadChanged(fishingRow, opts = {}) {
  _fishedInSegment = !!opts.fished;
  _fishingDueTick = _fishedInSegment ? 0 : (fishingRow ? gameTick + randInt(FISH_TRIGGER_MIN, FISH_TRIGGER_MAX) : 0);
}

// 供存档使用：当前路段是否已钓过（随 pokemon_idle_road 持久化）
export function getFishingGuarantee() {
  return { fished: _fishedInSegment };
}

// 游戏 tick 每 1 秒调用一次：到预定时刻触发钓鱼（每段路只钓一次）
export function tryStartFishing() {
  if (_fishing) return;
  if (phase !== 'idle') return;
  if (_itemDropActive) return;                     // 有道路道具飞行中不钓鱼
  if (!road.getFishingRow()) return;               // 当前路段无垂钓点
  if (road.isTransitioning() || !road.isActive()) return;
  if (_fishedInSegment) return;                    // 每段路只钓一次
  if (gameTick < _fishingDueTick) return;          // 还没到预定时刻
  startFishing();
}

function applyFishingFrame(el, idx) {
  el.style.backgroundPosition = `${-idx * FISH_FRAME_W}px 0`;
}

// 恢复钓鱼中的角色画面（从其他页面切回游戏页时调用）
export function applyFishingVisual() {
  const el = $('walkGif');
  if (!el) return;
  const row = road.getFishingRow();
  const base = row >= 3 ? 4 : 0;
  const prefix = getCharPrefix();
  el.className = `walk-gif fishing ${prefix}`;
  el.style.backgroundImage = `url("./character/${prefix}-fishing.png")`;
  el.style.backgroundSize = '640px 74px';
  applyFishingFrame(el, base + 3);
}

async function startFishing() {
  const row = road.getFishingRow();
  if (!row) return;
  const el = $('walkGif');
  if (!el) return;
  setFishing(true);
  // 取消预定的遇敌，钓鱼期间不遇敌
  if (nextEncounterTimer) { clearTimeout(nextEncounterTimer); setNextEncounterTimer(null); }
  pauseBuffCountdown(); // 钓鱼（等待上钩）期间 buff 暂停计时，钓完恢复
  road.pause();
  spawnFloatingItems();

  // 第3行垂钓点 → 用后4帧（4-7）；第1行 → 用前4帧（0-3）
  const base = row >= 3 ? 4 : 0;
  applyFishingVisual();

  // 甩竿动画：4帧，最后停在第4帧
  for (let i = 0; i < 4; i++) {
    if (phase !== 'idle') { abortFishing(); return; }
    applyFishingFrame(el, base + i);
    await delay(200);
  }
  if (phase !== 'idle') { abortFishing(); return; }

  // 等待上钩：第4/8帧 ↔ 对应待机帧来回切换（待机动画）+ 钓鱼轮播文字（随机 6~30s）
  const waitMs = randInt(FISH_WAIT_MIN, FISH_WAIT_MAX) * 1000;
  showFishingWait();
  const idleFrame = row >= 3 ? 9 : 8;   // 待机帧：第3行→第10帧(索引9)，第1行→第9帧(索引8)
  const startT = Date.now();
  let idleToggle = 0;
  while (Date.now() - startT < waitMs) {
    if (phase !== 'idle') { abortFishing(); return; }
    idleToggle = 1 - idleToggle;
    applyFishingFrame(el, idleToggle ? idleFrame : base + 3);
    await delay(800);
  }
  applyFishingFrame(el, base + 3);

  // 上钩判定完成：第3/4帧来回抖动（鱼咬钩）
  const tugStart = Date.now();
  let toggle = 0;
  while (Date.now() - tugStart < 1200) {
    if (phase !== 'idle') { abortFishing(); return; }
    toggle = 1 - toggle;
    applyFishingFrame(el, base + 2 + toggle);
    await delay(180);
  }
  applyFishingFrame(el, base + 3);

  // 有一定几率钓到宝可梦：不做道具收获动画，直接进入战斗
  // 甜甜蜜/闪耀护符生效期间，直接按 FISH_BUFF_POKEMON_CHANCE 决定是否钓到宝可梦
  const fishPokemonChance = (honeyBuffActive || charmBuffActive)
    ? FISH_BUFF_POKEMON_CHANCE
    : FISH_POKEMON_CHANCE;
  if (Math.random() < fishPokemonChance) {
    const poke = pickFishingPokemon();
    if (poke) {
      finishFishing(true);              // 静默收杆：清理钓鱼状态，遇敌调度交给战斗结束后统一处理
      startFishingEncounter(poke);
      return;
    }
  }

  // 钓到随机道具 ×1~10
  const itemKey = pickFishingReward();
  const qty = randInt(FISH_QTY_MIN, FISH_QTY_MAX);
  gameData.items[itemKey] = (gameData.items[itemKey] || 0) + qty;
  gameData.stats.totalItemsEarned[itemKey] = (gameData.stats.totalItemsEarned[itemKey] || 0) + qty;
  addSystemLog('fishing', { item: itemKey, qty });
  saveGame();
  updateBackpack(itemKey);
  updateStats();

  // 收获动画 + 结果文案
  setIdleCharacter('get-item', itemKey);
  showFishingResult(ITEM_NAMES[itemKey] || itemKey, qty, road.getPlace());
  await delay(800);

  finishFishing();
}

// 外部介入（如孵蛋动画）中断钓鱼：统一走结束逻辑恢复道路，避免道路永久暂停导致游戏卡死
function abortFishing() {
  if (_fishing) finishFishing();
}

function finishFishing(silent = false) {
  _fishedInSegment = true;   // 本路段已钓过，本段不再触发
  _fishingDueTick = 0;
  clearFloatingItems();
  setFishing(false);
  // 战斗中道路保持暂停（由 goIdle 统一恢复）
  if (phase === 'idle') { setIdleCharacter('walk'); road.resume(); }
  if (!silent) {
    // 有 buff 被暂停 → 恢复倒计时（由 buff 接管后续遇敌调度）；否则正常安排下次遇敌
    if (!resumeBuffCountdown()) scheduleNextEncounter();
  }
}

// 钓鱼开始：暂停进行中的 buff 倒计时（等待上钩不消耗 buff 时间，钓完恢复）
function pauseBuffCountdown() {
  if (charmBuffActive && charmCountdownEnd > Date.now()) {
    setCharmPausedRemaining(charmCountdownEnd - Date.now());
    setCharmCountdownEnd(0);
    if (charmCountdownInterval) { clearInterval(charmCountdownInterval); setCharmCountdownInterval(null); }
    if (charmExpiryTimer) { clearTimeout(charmExpiryTimer); setCharmExpiryTimer(null); }
  } else if (charmCountdownEnd > 0 && charmCountdownEnd <= Date.now()) {
    setCharmBuffActive(false);
    setCharmCountdownEnd(0);
    clearCharmCountdown();
  }
  if (honeyBuffActive && honeyCountdownEnd > Date.now()) {
    setHoneyPausedRemaining(honeyCountdownEnd - Date.now());
    setHoneyCountdownEnd(0);
    if (honeyCountdownInterval) { clearInterval(honeyCountdownInterval); setHoneyCountdownInterval(null); }
    if (honeyExpiryTimer) { clearTimeout(honeyExpiryTimer); setHoneyExpiryTimer(null); }
  } else if (honeyCountdownEnd > 0 && honeyCountdownEnd <= Date.now()) {
    setHoneyBuffActive(false);
    setHoneyCountdownEnd(0);
    clearHoneyCountdown();
  }
}

// 钓鱼结束（钓到道具）：恢复被暂停的 buff 倒计时；返回 true 表示已恢复（后续遇敌调度由 buff 接管）
function resumeBuffCountdown() {
  if (charmBuffActive && charmPausedRemaining > 0) {
    $('idleText').textContent = '✦ 闪耀护符生效中 ✦';
    setCharmCountdownEnd(Date.now() + charmPausedRemaining);
    const rem = charmPausedRemaining;
    setCharmPausedRemaining(0);
    // 快速遇敌
    setNextEncounterTimer(setTimeout(tryEncounter, rand(BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX) * 1000));
    // 护符到期
    setCharmExpiryTimer(setTimeout(() => {
      setCharmBuffActive(false);
      setCharmCountdownEnd(0);
      clearCharmCountdown();
      particles.stop();
      setIdleCharacter('walk');
      // buff 结束：立即显示"效果渐渐褪去"（无条件覆盖，避免空白）
      showBuffExpired('charm');
      setCharmExpiryTimer(null);
    }, rem));
    startCharmCountdown();
    return true;
  }
  if (honeyBuffActive && honeyPausedRemaining > 0) {
    $('idleText').textContent = '✦ 甜蜜蜜生效中 ✦';
    setHoneyCountdownEnd(Date.now() + honeyPausedRemaining);
    const d = honeyPausedRemaining;
    setHoneyPausedRemaining(0);
    // 快速遇敌
    setNextEncounterTimer(setTimeout(tryEncounter, rand(BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX) * 1000));
    // 甜甜蜜到期
    setHoneyExpiryTimer(setTimeout(() => {
      setHoneyBuffActive(false);
      setHoneyCountdownEnd(0);
      clearHoneyCountdown();
      particles.stop();
      setIdleCharacter('walk');
      // buff 结束：立即显示"效果渐渐褪去"（无条件覆盖，避免空白）
      showBuffExpired('honey');
      setHoneyExpiryTimer(null);
    }, d));
    startHoneyCountdown();
    return true;
  }
  return false;
}

// 按道具掉率加权：越常见的道具越容易钓到
function pickFishingReward() {
  const entries = Object.entries(ITEM_RATES);
  const weights = entries.map(([, rate]) => rate);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i];
    if (r <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

// 钓到宝可梦：60% 当前地区极稀有（rarity>0.8），40% 当地水系（含双属性）
function pickFishingPokemon() {
  const regionName = getCurrentRegion().name;
  const pool = allPokemon.filter(p => p.region === regionName);
  const rarePool = pool.filter(p => (p.rarity || 0.5) > 0.8);      // 极稀有
  const waterPool = pool.filter(p => (p.types || []).includes('水')); // 水系（含双属性）
  // FISH_RARE_RATE 比例钓到极稀有 / 其余为当地水系；选定池子为空则退回另一池
  const wantRare = Math.random() < FISH_RARE_RATE;
  let candidates = wantRare ? rarePool : waterPool;
  if (candidates.length === 0) candidates = wantRare ? waterPool : rarePool;
  if (candidates.length === 0) return null;
  // 家族归一：多变体家族（彩粉蝶等）按单个形态权重计，不因形态数叠加
  return pickFamily(candidates, () => 1);
}
