// ===== 钓鱼系统 =====
// 进入有垂钓点的路段后停下钓鱼一次：甩竿 → 等待上钩（随机6~30s）→ 上钩抖动 → 收获随机道具×1~10
import { ITEM_NAMES, ITEM_RATES } from './config.js';
import { phase, gameData, nextEncounterTimer, honeyBuffActive, charmBuffActive, _itemDropActive, _fishing, gameTick, setFishing, setNextEncounterTimer, saveGame, addSystemLog, randInt } from './state.js';
import { $, setIdleCharacter, updateBackpack, updateStats } from './ui.js';
import { showFishingWait, showFishingResult } from './messages.js';
import { delay } from './animation.js';
import { scheduleNextEncounter } from './battle.js';
import * as road from './road.js';

const FISH_FRAME_W = 64; // 每帧 32px，2x 显示

// 每个有垂钓点的路段恰好钓一次：进入路段时预定一个应钓鱼的 tick
let _fishingDueTick = 0;
let _fishedInSegment = false;

export function isFishing() { return _fishing; }

// 路段切换时调用：若该路段有垂钓点，预定 5~15 秒后触发一次钓鱼
// opts.fished 为 true 表示该路段本次循环已钓过（刷新页面后恢复），不再触发
export function onRoadChanged(fishingRow, opts = {}) {
  _fishedInSegment = !!opts.fished;
  _fishingDueTick = _fishedInSegment ? 0 : (fishingRow ? gameTick + randInt(5, 15) : 0);
}

// 供存档使用：当前路段是否已钓过（随 pokemon_idle_road 持久化）
export function getFishingGuarantee() {
  return { fished: _fishedInSegment };
}

// 游戏 tick 每 1 秒调用一次：到预定时刻触发钓鱼（每段路只钓一次）
export function tryStartFishing() {
  if (_fishing) return;
  if (phase !== 'idle') return;
  if (honeyBuffActive || charmBuffActive) return; // buff 期间不钓鱼（避免和快速遇敌冲突）
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
  el.className = 'walk-gif brendan-fishing';
  el.style.backgroundImage = 'url("./character/brendan-fishing.png")';
  el.style.backgroundSize = '512px 74px';
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
  road.pause();

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

  // 等待上钩：保持第4帧 + 钓鱼轮播文字（随机 6~30s）
  const waitMs = randInt(6, 30) * 1000;
  showFishingWait();
  applyFishingFrame(el, base + 3);
  const startT = Date.now();
  while (Date.now() - startT < waitMs) {
    if (phase !== 'idle') { abortFishing(); return; }
    await delay(200);
  }

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

  // 钓到随机道具 ×1~10
  const itemKey = pickFishingReward();
  const qty = randInt(1, 10);
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

function finishFishing() {
  _fishedInSegment = true;   // 本路段已钓过，本段不再触发
  _fishingDueTick = 0;
  setFishing(false);
  setIdleCharacter('walk');
  road.resume();
  scheduleNextEncounter();
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
