// ===== 道具相关逻辑 =====
import { ITEM_NAMES, CANDY_EXCHANGE, ITEM_SELL_RATE, CATCH_RATES, ITEM_RATES, CANDY_DROP_MULT, SHINY_CHANCE, BUFF_DURATION, BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX, HONEY_RARITY_BOOST, CHARM_RARITY_BOOST, PX_PER_METER } from './config.js';
import { phase, gameData, allPokemon, getPokemonByIndex, currentEncounter, currentIsShiny, encounterLevel, encounterBallsUsed, currentEncounterBalls, encounterMsg, setCurrentEncounter, setEncounterLevel, setEncounterBallsUsed, setCurrentEncounterBalls, setEncounterMsg, setCurrentIsShiny, setPhase, _itemDropActive, honeyBuffActive, charmBuffActive, honeyCountdownEnd, charmCountdownEnd, honeyCountdownInterval, charmCountdownInterval, honeyPausedRemaining, charmPausedRemaining, honeyExpiryTimer, charmExpiryTimer, nextEncounterTimer, _charmEncounterCount, _eggHatching, saveGame, addSystemLog, addIncubatorLog, randInt, rand, getCurrentRegion, setNextEncounterTimer, setItemDropActive, setEggHatching, _idleMsgIdx, setIdleMsgIdx, setHoneyBuffActive, setHoneyCountdownEnd, setCharmBuffActive, setCharmCountdownEnd, setHoneyPausedRemaining, setCharmPausedRemaining, setCharmEncounterCount, setHoneyExpiryTimer, setCharmExpiryTimer, setHoneyCountdownInterval, setCharmCountdownInterval, calcHatchDistance, getIncubatorUnlockCost, addRosterEntry, rarityLabel, setLastObtainedEntryId, isPokemon } from './state.js';
import { $, updateTextBox, updateBackpack, updateStats, showView, isOnHatchView, fitPokemonImage, tryLoadPokemonImage, setIdleCharacter, renderIncubatorView, updateIncubatorBadge } from './ui.js';
import { showIdlePickup, showBuffExpired } from './messages.js';
import { animate, delay } from './animation.js';
import { computeObtainScore } from './scoring.js';
import { playCongratulation, stopCongratulation } from './audio.js';
import * as road from './road.js';
import * as particles from './particles.js';

// 宝可梦属性显示颜色（图鉴/战斗页类型标签用）
export const TYPE_COLORS = {
  '一般': '#9F9E9A', '格斗': '#A7443E', '飞行': '#72A3D2', '毒': '#793B9B',
  '地面': '#894F4E', '岩石': '#BA9459', '虫': '#89991A', '幽灵': '#633963',
  '钢': '#548EA2', '火': '#CB494D', '水': '#3786CE', '草': '#378E24',
  '电': '#DBB538', '超能': '#DA5A89', '冰': '#37BEE0', '龙': '#4654C6',
  '恶': '#553F42', '妖精': '#C74ECB',
};

// 列表行来源徽章（仓库 / 放入 / 交换等列表共用，与 roster 一致）：
// 普通闪光 → ★；时空扭曲 RGB/污染 → ○；扭曲闪光 → ★○
export const POKE_BADGE_STAR = '<svg class="pokedex-star-svg" viewBox="2 2 20.2 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.77272 14.5899L5.24822 20.9745C5.1866 21.2304 5.28549 21.498 5.49671 21.6536C5.70873 21.8087 5.99207 21.8238 6.21922 21.6891L11.9527 18.2844L17.6835 21.6891C17.787 21.7505 17.9027 21.7812 18.0178 21.7812C18.1547 21.7812 18.2907 21.7387 18.406 21.6543C18.6173 21.4985 18.7162 21.231 18.6545 20.9752L17.13 14.5905L22.1907 10.3017C22.3931 10.131 22.4721 9.85483 22.3911 9.60288C22.3106 9.35093 22.0855 9.17223 21.8217 9.15074L15.1466 8.59969L12.5534 2.54696C12.4506 2.30605 12.2138 2.15039 11.952 2.15039C11.6902 2.15039 11.4534 2.30605 11.3507 2.54696L8.7555 8.59969L2.08241 9.14997C1.81862 9.17165 1.59348 9.35026 1.51299 9.60226C1.43185 9.85421 1.51107 10.1304 1.7133 10.301L6.77272 14.5899Z" fill="currentColor"></path></svg>';
export const POKE_BADGE_TWIST = '<svg class="pokedex-star-svg" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M512 0c282.7776 0 512 229.2224 512 512s-229.2224 512-512 512S0 794.7776 0 512 229.2224 0 512 0z m0 947.2c240.3584 0 435.2-194.8416 435.2-435.2S752.3584 76.8 512 76.8v870.4z" fill="currentColor"></path></svg>';
export const POKE_BADGE_TWIST_SHINY = '<svg class="pokedex-star-svg" viewBox="1.9 2 20.2 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21.3357 8.67501L15.3966 8.23626L13.1615 2.76251C13.076 2.53826 12.9196 2.3446 12.7136 2.2081C12.5076 2.07159 12.2623 1.99891 12.0111 2.00001C11.7577 2.00048 11.5104 2.0735 11.3014 2.20953C11.0924 2.34556 10.9315 2.53828 10.8396 2.76251L8.60456 8.23626L2.66547 8.67626C1.53478 8.78751 1.09119 10.1625 1.94941 10.8775L6.47744 14.7038L5.0677 20.4538C5.03842 20.5699 5.02689 20.6895 5.03347 20.8088C5.03479 20.8438 5.04137 20.8775 5.04532 20.9125C5.05585 20.9925 5.07165 21.0688 5.09666 21.1438C5.1085 21.1775 5.11903 21.2113 5.13351 21.2438C5.16721 21.3212 5.20957 21.3949 5.25988 21.4638C5.27304 21.4825 5.28357 21.5038 5.29805 21.5225C5.36518 21.6063 5.44284 21.68 5.5284 21.7437C5.54946 21.76 5.57315 21.7712 5.59553 21.7862C5.69221 21.8497 5.79762 21.9001 5.90881 21.9363C5.98366 21.9596 6.06085 21.9755 6.13916 21.9837C6.17075 21.9875 6.20234 21.9937 6.23393 21.995C6.24841 21.995 6.26157 22 6.27605 22C6.34055 22 6.40636 21.9825 6.47218 21.9725C6.51166 21.9663 6.55115 21.9663 6.59064 21.9563C6.71572 21.9228 6.83468 21.8713 6.94341 21.8037L11.9993 18.6925L12.0098 18.6988L17.0551 21.8025C17.2464 21.923 17.4706 21.9877 17.7001 21.9888C18.4504 21.9888 19.1256 21.2875 18.9308 20.4525L17.5211 14.7025L22.0518 10.8775C22.9073 10.1613 22.4664 8.75876 21.3357 8.67501ZM21.1791 9.94251L16.6484 13.7675C16.4714 13.9168 16.34 14.1087 16.2682 14.323C16.1964 14.5373 16.1868 14.766 16.2403 14.985L17.6922 20.7038L12.7153 17.6425C12.505 17.5134 12.2602 17.444 12.0098 17.4425V3.40376L14.1685 8.68876C14.2579 8.90857 14.4111 9.0998 14.6103 9.24029C14.8095 9.38078 15.0465 9.46477 15.2939 9.48251L21.1909 9.91876C21.1856 9.92126 21.1804 9.92876 21.1791 9.94251Z" fill="currentColor"></path></svg>';
// 按闪光 / 时空扭曲变体返回对应徽章 SVG（非闪非扭曲 → 空字符串）
export function pokemonSourceBadge(p) {
  return p.shiny
    ? (p.variant === 'rgb' || p.variant === 'polluted') ? POKE_BADGE_TWIST_SHINY : POKE_BADGE_STAR
    : (p.variant === 'rgb' || p.variant === 'polluted') ? POKE_BADGE_TWIST : '';
}

// 道具图标文件名（位于 src/items/ 目录）
export const ITEM_ICONS = {
  'poke-ball': 'poke-ball.png', 'ultra-ball': 'ultra-ball.png',
  'master-ball': 'master-ball.png', 'candy': 'candy.png',
  'sweet-honey': 'honey.png', 'mystery-egg': 'mystery-egg.png', 'shiny-charm': 'shiny-charm.png',
  'bike': 'bike.png', 'exp-candy': 'xp-candy.png',
};

// 树果图标文件名（宝可梦喜欢的食物，位于 src/items/berries/ 与 src/items/berry-trees/ 目录）
// 下标与 pokedex.json 的 foods 字段一一对应
export const BERRY_ICONS = ['aspear.png', 'cheri.png', 'chesto.png', 'leppa.png', 'lum.png', 'tamato.png', 'oran.png', 'pecha.png', 'rawst.png', 'sitrus.png', 'figy.png', 'wiki.png'];

// 树果中文名（hover 提示用，键为图标文件名）
export const BERRY_NAMES = {
  'aspear.png': '利木果', 'cheri.png': '樱子果', 'chesto.png': '零余果', 'leppa.png': '苹野果',
  'lum.png': '木子果', 'tamato.png': '茄番果', 'oran.png': '橙橙果', 'pecha.png': '桃桃果',
  'rawst.png': '莓莓果', 'sitrus.png': '文柚果', 'figy.png': '勿花果', 'wiki.png': '异奇果',
};

// 树果固有色：
// 用于树果方块按配方树果加权平均混合出最终颜色
export const BERRY_COLORS = [
  '#c0d369', // 利木果
  '#e61b23', // 樱子果
  '#5b77c7', // 零余果
  '#e5a12c', // 苹野果
  '#57a435', // 木子果
  '#ec3d2f', // 茄番果
  '#41a1d3', // 橙橙果
  '#f1a49e', // 桃桃果
  '#77dbf5', // 莓莓果
  '#e5e632', // 文柚果
  '#ed9856', // 勿花果
  '#6f61ac', // 异奇果
];

// 孵蛋结果展示在独立页面 hatchView；若开始孵蛋时已有野生遭遇，先把现场挂起，
// 等孵蛋结果结束后再恢复，保证两条流程都能继续。
let _suspendedEncounter = null;

function suspendEncounterForEgg() {
  if ((phase !== 'encounter' && phase !== 'caught' && phase !== 'fled') || !currentEncounter) return false;
  _suspendedEncounter = {
    phase,
    poke: currentEncounter,
    isShiny: currentIsShiny,
    level: encounterLevel,
    ballsUsed: encounterBallsUsed,
    balls: { ...(currentEncounterBalls || {}) },
    msg: encounterMsg || null,
    settled: false, // 孵蛋期间若该遭遇在后台被结算（飞行中的丢球收尾等），置位后不再恢复现场
  };
  return true;
}

// 孵蛋挂起期间遭遇已在后台被结算（捕捉/逃跑判定落库）：取消其现场恢复，
// 由 battle.js 的后台结算流程在遭遇清理时调用
export function cancelSuspendedEncounterForEgg() {
  if (_suspendedEncounter) _suspendedEncounter.settled = true;
}

function restoreSuspendedEncounter() {
  if (!_suspendedEncounter) return false;
  const snap = _suspendedEncounter;
  _suspendedEncounter = null;
  if (snap.settled) return false; // 已结算的遭遇不再恢复，交给 goIdle 正常收尾
  setCurrentEncounter(snap.poke);
  setEncounterLevel(snap.level);
  setCurrentIsShiny(snap.isShiny);
  setEncounterBallsUsed(snap.ballsUsed);
  setCurrentEncounterBalls({ ...snap.balls });
  setEncounterMsg(snap.msg);
  setPhase(snap.phase);
  return true;
}

export function hasSuspendedEncounterForEgg() {
  return !!_suspendedEncounter;
}

export async function finalizeEggResultContext() {
  stopCongratulation(); // 离开孵蛋结果场景：立即停止祝贺音效，避免残留到其他页面
  if (restoreSuspendedEncounter()) {
    renderIncubatorView();
    return;
  }
  const m = await import('./battle.js');
  m.goIdle();
  renderIncubatorView();
}

// ---------- 权重随机选精灵 ----------
// rarityBoost 越高稀有精灵出现概率越大
// rarity 已在 pokedex.json 中预计算（基于捕获率 + 种族值）

// 把池子按本体编号（index 的 `-` 前缀）归并为家族，
// 避免同一宝可梦的多形态（未知图腾 27 字母、彩粉蝶 18 花纹等）叠加放大出现概率
export function foldFamilies(pool) {
  const map = new Map();
  for (const p of pool) {
    const base = String(p.index).split('-')[0];
    let g = map.get(base);
    if (!g) map.set(base, g = []);
    g.push(p);
  }
  return [...map.values()];
}

// 家族权重采样：家族权重取成员中单个最大权重（形态数量不叠加），
// 命中家族后在家族内均匀随机选一个具体形态
export function pickFamily(pool, weightOf) {
  const source = pool || allPokemon;
  if (source.length === 0) return null;
  const groups = foldFamilies(source);
  const weights = groups.map(g => {
    let w = 0;
    for (const p of g) w = Math.max(w, weightOf(p));
    return Math.max(w, 1e-9);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < groups.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      const g = groups[i];
      return g[randInt(0, g.length - 1)];
    }
  }
  const last = groups[groups.length - 1];
  return last[randInt(0, last.length - 1)];
}

export function pickWeightedPokemon(rarityBoost, pool) {
  const source = pool || allPokemon;
  if (source.length === 0) return null;
  const penalty = Math.max(0.2, 0.8 - rarityBoost * 0.5); // 正常 0.8，蜜 0.55，护符 0.45
  return pickFamily(source, p => Math.max(0.01, 1 - (p.rarity ?? 0.5) * penalty));
}

export function pickRandomPokemon() {
  if (allPokemon.length === 0) return null;
  const region = getCurrentRegion();
  const pool = allPokemon.filter(p => p.region === region.name);
  if (pool.length === 0) return null;
  let rarityBoost = 0;
  if (honeyBuffActive) rarityBoost = Math.max(rarityBoost, HONEY_RARITY_BOOST);
  if (charmBuffActive) rarityBoost = Math.max(rarityBoost, CHARM_RARITY_BOOST);
  return pickWeightedPokemon(rarityBoost, pool);
}

// 孵蛋：全图鉴纯随机，不受地区限制、无稀有度加权
export function pickAnyPokemon() {
  if (allPokemon.length === 0) return null;
  return pickFamily(allPokemon, () => 1);
}

// 树果方块：当前地区中 foods 与配方完全一致的宝可梦
export function findBerryTarget(recipe) {
  if (!Array.isArray(recipe) || recipe.length === 0) return null;
  const region = getCurrentRegion();
  const sorted = [...recipe].sort((a, b) => a - b);
  return allPokemon.find(p =>
    p.region === region.name &&
    Array.isArray(p.foods) &&
    p.foods.length === sorted.length &&
    sorted.every(s => p.foods.includes(s))
  ) || null;
}

// 掉落提示互斥恢复定时器（获得道具时短暂显示掉落信息，之后恢复自动模式状态）
let _dropStatusTimer = null;

// 掉落糖果的数量倍率：按 CANDY_DROP_MULT 权重抽一次（掉落发生时即确定）
function rollCandyMult() {
  const total = CANDY_DROP_MULT.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const c of CANDY_DROP_MULT) {
    r -= c.weight;
    if (r <= 0) return c.mult;
  }
  return 1;
}

// 道具入库：背包/统计/日志统一处理（qty 支持糖果翻倍掉落）
export function grantItem(itemKey, qty = 1) {
  gameData.items[itemKey] = (gameData.items[itemKey] || 0) + qty;
  gameData.stats.totalItemsEarned[itemKey] = (gameData.stats.totalItemsEarned[itemKey] || 0) + qty;
  addSystemLog('item_gain', { item: itemKey, qty });
  updateBackpack(itemKey);
  // 独立掉落提示：获得道具时显示「精灵球 + 1」/「糖果 ×5」，短暂停留后自动隐藏
  const hint = $('statDropHint');
  if (hint) {
    hint.textContent = `${ITEM_NAMES[itemKey] || itemKey} ${qty > 1 ? `×${qty}` : '+ 1'}`;
    hint.style.display = '';
  }
  // 互斥：掉落显示期间隐藏自动模式状态栏（自动捕捉/自动逃跑/佛系模式及其进度条）
  const autoEl = $('statAutoStatus');
  if (autoEl) autoEl.style.display = 'none';
  // 短暂停留后恢复自动状态（多个道具连续掉落时重置计时）
  if (_dropStatusTimer) clearTimeout(_dropStatusTimer);
  _dropStatusTimer = setTimeout(() => {
    _dropStatusTimer = null;
    const h = $('statDropHint');
    if (h) h.style.display = 'none';
    updateStats();
  }, 1500);
  updateStats();
}

// ---------- 道具随路面滚动进入 ----------
// 当前在滚/拾取中的道具元素与取消回调（外部（手动骑行上车）可立即取消并隐藏）
let _dropEl = null;
let _dropCancelCb = null;

// 立即取消并隐藏正在滑入/拾取的道具（返回是否真的有道具被取消）
export function cancelItemDrop() {
  if (!_dropCancelCb) return false;
  _dropCancelCb();
  return true;
}

// 生成道路掉落实体并播放滚动/拾取动画。返回是否真正生成（false 表示本次未生成，
// 由调用方把累积值保留，避免道具丢失）；后台（非主界面）直接入账也算成功。
export function spawnItemDrop(itemKey) {
  if (phase !== 'idle') return false;
  // 掉落糖果时先确定本次数量倍率（×1/×2/×5/×50/×100）
  const qty = itemKey === 'candy' ? rollCandyMult() : 1;
  const screen = $('screen');
  const charEl = $('walkGif');
  if (!screen || !charEl) return false;

  // 不在主界面（在其他页面挂机中）或页面本身不可见（浏览器/WebView 切走或最小化）：
  // 后台直接模拟拾取入库，不播放滚动/拾取动画，避免恢复前台后逐一出补发动画
  if (document.hidden || $('idleView')?.style.display === 'none') {
    grantItem(itemKey, qty);
    saveGame(); // 后台入账立即存档，避免依赖 30 秒周期存档导致刷新丢日志/丢道具
    return true;
  }

  if (_itemDropActive) return false;

  setItemDropActive(true);

  const el = document.createElement('img');
  el.className = 'item-fly';
  el.src = `./items/${ITEM_ICONS[itemKey] || itemKey + '.png'}`;
  el.alt = ITEM_NAMES[itemKey] || itemKey;
  screen.appendChild(el);
  _dropEl = el;
  _dropCancelCb = () => {
    if (!_dropCancelCb) return;
    _dropCancelCb = null;
    _dropEl = null;
    active = false;
    el.remove();
    setItemDropActive(false);
    if (phase === 'idle') { setIdleCharacter('walk'); road.resume(); }
  };

  // 动画受理成功：后续由 frame/fly 驱动滚动与拾取入账，这里返回 true 让调用方扣减累积值
  // （否则累积值永不扣减，糖果等高频道具会一直出动画）

  const sRect = screen.getBoundingClientRect();
  const cRect = charEl.getBoundingClientRect();
  const charLeft = cRect.left - sRect.left;

  // 物品放在路面上
  const roadEl = document.querySelector('.road-layer');
  const rRect = roadEl ? roadEl.getBoundingClientRect() : cRect;
  const itemY = (rRect.top - sRect.top) + 24;

  let itemX = sRect.width + 10;
  el.style.left = itemX + 'px';
  el.style.top = itemY + 'px';
  el.style.opacity = '1';

  const pickupX = charLeft + 10;
  const cTop = cRect.top - sRect.top;
  let active = true;

  function cleanup() {
    active = false;
    _dropCancelCb = null;
    _dropEl = null;
    el.remove();
    setItemDropActive(false);
    if (phase === 'idle') { setIdleCharacter('walk'); road.resume(); }
  }

  function frame() {
    if (!active) return;

    const isIdleView = $('idleView')?.style.display !== 'none';
    if (!isIdleView) {
      el.style.display = 'none';
      requestAnimationFrame(frame);
      return;
    }
    if (!road.isActive()) {
      el.style.display = 'none';
      requestAnimationFrame(frame);
      return;
    }
    el.style.display = '';

    const roadSpeed = road.getSpeed();
    itemX -= roadSpeed;

    if (itemX > sRect.width + 100) { cleanup(); return; }

    if (road.isBike()) {
      el.style.left = itemX + 'px';
      if (itemX < -40) { cleanup(); return; }
      requestAnimationFrame(frame);
      return;
    }

    el.style.left = itemX + 'px';

    if (itemX <= pickupX) {
      active = false;
      road.pause();
      setIdleCharacter('get-item', itemKey);

      const startX = itemX;
      const targetX = charLeft + 6;
      const startY = itemY;
      const targetY = cTop + 12;
      const startT = performance.now();
      const flyDuration = 500;

      (function fly(now) {
        const t = Math.min((now - startT) / flyDuration, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        const isIdleView = $('idleView')?.style.display !== 'none';
        if (!isIdleView) {
          el.style.display = 'none';
        } else {
          el.style.display = '';
          el.style.left = (startX + (targetX - startX) * ease) + 'px';
          el.style.top = (startY + (targetY - startY) * ease) + 'px';
          const scale = 1 - ease * 0.7;
          el.style.transform = `scale(${scale})`;
        }

        if (t < 1) {
          requestAnimationFrame(fly);
        } else {
          _dropCancelCb = null;
          _dropEl = null;
          el.remove();
          setItemDropActive(false);
          if (phase === 'idle') { setIdleCharacter('walk'); road.resume(); }
          grantItem(itemKey, qty);
          saveGame(); // 拾取入账立即存档，避免刷新时丢失最新掉落日志/道具
          showIdlePickup(ITEM_NAMES[itemKey], road.getPlace());
        }
      })(performance.now());
      return;
    }

    requestAnimationFrame(frame);
  }

  setIdleCharacter('walk');
  requestAnimationFrame(frame);
  return true;
}

// ---------- 放入孵蛋器 ----------
export function placeEggInIncubator(slotIndex) {
  if (_eggHatching) return;
  if ((gameData.items['mystery-egg']||0) <= 0) return;
  const incubators = gameData.incubators;
  if (!incubators || !incubators[slotIndex]) return;
  if (incubators[slotIndex].eggIndex != null) return; // 已有蛋

  gameData.items['mystery-egg']--;
  updateBackpack();

  const poke = pickAnyPokemon();
  if (!poke) return;

  const eggIsShiny = Math.random() < SHINY_CHANCE;
  const distance = calcHatchDistance(poke);

  incubators[slotIndex] = {
    eggIndex: poke.index,
    hatchStart: gameData.stats?.walkDistance || 0, // 放蛋时累计行走像素，行走增量达标即孵化
    hatchDuration: distance * PX_PER_METER, // 原始所需里程；随从减免在达标判断时动态计算
    hatched: false,
    isShiny: eggIsShiny,
  };

  saveGame();
  renderIncubatorView();
}

// ---------- 放入宝可梦蛋（饲育屋产，M3） ----------
// 蛋是仓库条目（kind:'egg'，个体值/性别/性格/闪光出生即定），放入槽位记 eggRef；
// 孵化时蛋条目原地转正，个体完全沿用蛋，实现"挑蛋培养 6V"。
export function placePokemonEggInIncubator(slotIndex, entryId) {
  if (_eggHatching) return;
  const incubators = gameData.incubators;
  if (!incubators || !incubators[slotIndex]) return;
  if (incubators[slotIndex].eggIndex != null) return; // 已有蛋
  const entry = (gameData.roster || []).find(r => r.id === entryId && r.inRoster && !isPokemon(r));
  if (!entry) return;
  const poke = getPokemonByIndex(String(entry.species));
  if (!poke) return;

  const distance = calcHatchDistance(poke);
  incubators[slotIndex] = {
    eggIndex: poke.index,
    eggRef: entry.id,
    hatchStart: gameData.stats?.walkDistance || 0, // 放蛋时累计行走像素，行走增量达标即孵化
    hatchDuration: distance * PX_PER_METER, // 原始所需里程；随从减免在达标判断时动态计算
    hatched: false,
    isShiny: !!entry.shiny,
  };

  saveGame();
  renderIncubatorView();
}

// ---------- 糖果解锁孵蛋器槽位 ----------
export function unlockIncubatorSlot(slotIndex) {
  const unlocked = gameData.incubatorUnlockedSlots ?? 0;
  if (slotIndex !== unlocked) return; // 必须按顺序解锁当前槽位（UI 已禁用其他按钮）
  const cost = getIncubatorUnlockCost(slotIndex);
  if ((gameData.items['candy'] || 0) < cost) return;
  gameData.items['candy'] -= cost;
  gameData.incubatorUnlockedSlots = slotIndex + 1;
  saveGame();
  updateBackpack();
  renderIncubatorView();
}

// ---------- 从孵蛋器取出孵化 ----------
export async function hatchFromIncubator(slotIndex) {
  if (_eggHatching) return;
  if (phase === 'battle' || phase === 'eggResult') return; // NPC 对战 / 孵蛋结果确认期间仍禁止孵化
  if (phase !== 'idle' && phase !== 'encounter' && phase !== 'caught' && phase !== 'fled') return;
  const incubators = gameData.incubators;
  if (!incubators || !incubators[slotIndex]) return;
  const slot = incubators[slotIndex];
  if (!slot || !slot.hatched) return;
  suspendEncounterForEgg();

  setEggHatching(true);

  const poke = getPokemonByIndex(slot.eggIndex);
  if (!poke) { setEggHatching(false); return; }

  const eggIsShiny = slot.isShiny || false;

  const idx = String(poke.index);

  setPhase('eggResult');
  setCurrentIsShiny(eggIsShiny);

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

  setCurrentEncounter(poke);
  showView('hatchView');
  $('fleeBtn').style.display = 'none';
  $('hatchName').textContent = '';
  $('hatchTypes').innerHTML = '';
  $('hatchOwnedWrap').style.display = 'none';
  $('hatchCatchRate').textContent = '';
  $('hatchNewLabel').style.display = 'none';

  const oldImg = $('hatchGif');
  const parent = oldImg.parentNode;

  const tmp = new Image();
  tmp.src = './items/hatch.png';
  await new Promise(r => { tmp.onload = r; tmp.onerror = r; });
  const frameW = tmp.naturalWidth;
  const frameH = tmp.naturalHeight / 4;

  const displayW = 80;
  const displayH = displayW * (frameH / frameW);

  const sprite = document.createElement('div');
  sprite.id = 'hatchGif';
  sprite.className = 'encounter-gif';
  sprite.style.cssText = `
    background-image: url(./items/hatch.png);
    background-size: ${displayW}px ${displayH * 4}px;
    background-position: 0 0;
    background-repeat: no-repeat;
    width: ${displayW}px; height: ${displayH}px;
    image-rendering: pixelated;
  `;
  parent.replaceChild(sprite, oldImg);

  // 孵蛋动画：玩家中途跳到其他页面（孵化转入后台）→ 跳过剩余动画帧，后台直接结算
  let watchedAnim = true;
  async function hatchFrame(ms, before) {
    if (!isOnHatchView()) { watchedAnim = false; return; }
    if (before) before();
    await delay(ms);
    if (!isOnHatchView()) watchedAnim = false;
  }

  // 第一帧 — 摇晃
  await hatchFrame(1200, () => {
    sprite.className = 'encounter-gif egg-shake';
    updateTextBox('蛋在微微晃动...', false);
  });

  // 第二帧 — 蛋裂
  if (watchedAnim) await hatchFrame(300, () => { sprite.className = 'encounter-gif'; });
  if (watchedAnim) await hatchFrame(350, () => { sprite.style.backgroundPosition = `0 -${displayH}px`; });

  // 第三帧 — 裂缝更大
  if (watchedAnim) await hatchFrame(350, () => {
    sprite.style.backgroundPosition = `0 -${displayH * 2}px`;
    updateTextBox('蛋裂开了！', false);
  });

  // 第四帧 — 破壳
  if (watchedAnim) await hatchFrame(400, () => { sprite.style.backgroundPosition = `0 -${displayH * 3}px`; });

  // 无论是否跳过动画，都恢复为 <img> 元素（避免残留 div 撑大/遮挡）
  const img = document.createElement('img');
  img.id = 'hatchGif';
  img.className = 'encounter-gif';
  parent.replaceChild(img, sprite);

  // 宝可梦出场动画（仅玩家仍在游戏页时播放；已离开则后台直接结算）
  if (watchedAnim) {
    img.style.opacity = '0';
    let imageLoaded = false;
    await tryLoadPokemonImage(img, poke, '').then(ok => { imageLoaded = ok; });

    img.style.transform = 'translateX(-50%) scale(0)';
    if (imageLoaded) {
      fitPokemonImage(img);
    } else {
      img.removeAttribute('src');
      img.style.width = '80px';
      img.style.height = '80px';
      img.style.objectFit = 'contain';
    }

    void img.offsetHeight;

    await animate(350, t => {
      const s = t;
      const o = t < 0.2 ? t / 0.2 : 1;
      img.style.transform = `translateX(-50%) scale(${s})`;
      img.style.opacity = o;
    });

    img.style.transform = '';
  }

  $('hatchName').style.display = 'none';
  $('hatchTypes').style.display = 'none';
  // 新发现标记（普通/闪光分开）
  const existingEntry = gameData.pokedex[idx];
  const isNewDiscovery = !existingEntry
    ? true
    : eggIsShiny ? existingEntry.shinySeen === 0 : existingEntry.seen === 0;
  const newLabel = $('hatchNewLabel');
  if (newLabel) newLabel.style.display = isNewDiscovery ? '' : 'none';

  // 已捕获标记（普通/闪光分开）
  $('hatchOwnedWrap').style.display = (existingEntry && (eggIsShiny ? existingEntry.shinyCaught > 0 : existingEntry.caught > 0)) ? '' : 'none';
  if (existingEntry && (eggIsShiny ? existingEntry.shinyCaught > 0 : existingEntry.caught > 0)) {
    const tipEl = $('hatchOwnedTip');
    if (tipEl) {
      const logs = (gameData.encounterLogs || {})[idx] || [];
      const first = logs.find(l => l.result === 'caught' && !!l.shiny === eggIsShiny);
      if (first && first.time) {
        const d = new Date(first.time);
        const pad = n => String(n).padStart(2, '0');
        tipEl.textContent = `首次捕获：${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } else {
        tipEl.textContent = '首次捕获：较早前';
      }
    }
  }
  $('hatchCatchRate').innerHTML = '稀有度 ' + rarityLabel(poke.rarity ?? 0.5);

  if (!gameData.pokedex[idx]) {
    gameData.pokedex[idx] = {
      seen: 0, caught: 0,
      lastTime: null, shinySeen: 0, shinyCaught: 0,
    };
  }
  gameData.pokedex[idx].seen++;
  gameData.pokedex[idx].caught = (gameData.pokedex[idx].caught || 0) + 1;
  gameData.pokedex[idx].lastTime = new Date().toISOString();
  if (eggIsShiny) {
    gameData.pokedex[idx].shinyCaught = (gameData.pokedex[idx].shinyCaught || 0) + 1;
    // 孵化闪光单独计数，不算入"闪光捕获"（捕获仅统计道路遇敌）
    gameData.stats.totalShinyEggsHatched = (gameData.stats.totalShinyEggsHatched || 0) + 1;
  }
  gameData.stats.totalCatches++;
  gameData.stats.totalEggsHatched++;
  // 宝可梦蛋（eggRef）：蛋条目原地转正为宝可梦（删 kind:'egg'、level 置 1），
  // 个体值/性格/性别/闪光完全沿用蛋（这就是"挑蛋培养 6V"的基础）；
  // 神秘蛋（无 eggRef）：无对应条目，随机建档加入仓库。
  let entry = null;
  let ivRandomKey = null;
  if (slot.eggRef) {
    const eggEntry = (gameData.roster || []).find(r => r.id === slot.eggRef);
    if (eggEntry) {
      delete eggEntry.kind;
      eggEntry.level = 1;
      eggEntry.inRoster = true;
      eggEntry.obtainedAt = Date.now(); // 获得时间记录为点击孵化完成的时刻，而非放入孵蛋器
      ivRandomKey = eggEntry.ivRandomKey || null; // 培育蛋：仅该纯随机项是个体值运气
      entry = eggEntry;
    }
  }
  if (!entry) entry = addRosterEntry({ species: poke.index, shiny: eggIsShiny, source: 'egg' });
  setLastObtainedEntryId(entry.id);
  if (!gameData.encounterLogs) gameData.encounterLogs = {};
  if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
  gameData.encounterLogs[idx].push({
    time: Date.now(), shiny: eggIsShiny, result: 'caught', balls: {}, source: 'egg', // source 供统计页区分孵蛋/交换/遭遇
    charmBuff: false, // 闪耀护符不提升孵蛋闪光率（蛋的闪光在放入孵蛋器时已按 1/1000 判定），恒为 false
    score: computeObtainScore({
      pokemon: poke, source: 'egg', shiny: eggIsShiny,
      charmBuff: false, honeyBuff: false, balls: {}, finalRate: 1,
      ivs: entry.ivs, ivRandomKey,
    }),
  });
  // 玩家仍在本页才播放祝贺音效（已切走则后台静默结算，避免音效打断其他页面背景曲）
  if (isOnHatchView()) playCongratulation();

  incubators[slotIndex] = { eggIndex: null, hatched: false, hatchStart: 0, hatchDuration: 0, isShiny: false };

  addSystemLog('egg_hatch', { pokemon: poke.index, shiny: eggIsShiny });
  // 孵蛋记录：仅记录时间/名字/性别（性别沿用蛋条目，神秘蛋为建档时 roll 的结果）
  addIncubatorLog({ species: poke.index, gender: entry.gender, shiny: eggIsShiny });
  if (isOnHatchView()) updateTextBox(eggIsShiny ? '孵化出闪光的 ' + poke.name + ' 了！' : '孵化成功！获得了 ' + poke.name, true);

  await saveGame();
  updateStats();
  updateIncubatorBadge();

  setEggHatching(false);

  // 玩家已离开孵蛋页（后台孵化）：跳过「查看详情」确认流程，直接回到空闲状态，
  // 若有挂起中的遭遇则恢复该遭遇，保证稍后回游戏页还能继续。
  if (!isOnHatchView()) {
    await finalizeEggResultContext();
  }
}

export async function doCandyExchange(itemKey, qty = 1) {
  const cost = CANDY_EXCHANGE[itemKey];
  if (!cost) return;
  const total = cost * qty;
  if ((gameData.items['candy']||0) < total) return;
  gameData.items['candy'] -= total;
  gameData.items[itemKey] = (gameData.items[itemKey]||0) + qty;
  gameData.stats.totalItemsEarned[itemKey] = (gameData.stats.totalItemsEarned[itemKey]||0) + qty; // 商店购买也计入道具获得
  addSystemLog('shop_purchase', { item: itemKey, qty, cost: total });
  updateBackpack(itemKey);
  updateStats();
  if ($('shopView')?.style.display === 'flex') {
    const { showShopView } = await import('./views.js');
    showShopView();
  }
}

// 商店出售道具换糖果（与兑换对称）：扣道具加糖，出售价 = 兑换价 × ITEM_SELL_RATE
export async function doSellBall(itemKey, qty = 1) {
  const price = Math.round((CANDY_EXCHANGE[itemKey] || 0) * ITEM_SELL_RATE);
  if (!price || qty <= 0) return;
  if ((gameData.items[itemKey] || 0) < qty) return;
  gameData.items[itemKey] -= qty;
  gameData.items['candy'] = (gameData.items['candy'] || 0) + price * qty;
  addSystemLog('shop_sell', { item: itemKey, qty, gain: price * qty });
  updateBackpack(itemKey);
  updateStats();
  if ($('shopView')?.style.display === 'flex') {
    const { showShopView } = await import('./views.js');
    showShopView();
  }
}

// ===== 甜甜蜜 =====
export function activateHoney() {
  if ((gameData.items['sweet-honey']||0) <= 0) return;
  if (honeyBuffActive) return; // 已有buff
  if (charmBuffActive) return; // 闪耀护符期间不能使用
  console.log('[续杯] activateHoney 被调用', { autoBuffHoney: gameData.settings?.autoBuffHoney, autoBuffCharm: gameData.settings?.autoBuffCharm, battlePhase: phase });
  gameData.items['sweet-honey']--;
  addSystemLog('item_use', { item: 'sweet-honey' });
  setHoneyBuffActive(true);
  setIdleCharacter('walk');
  particles.stop();
  particles.start('rgba(255,215,0,1)', 'circle', { sizeMult: 0.7, alphaMult: 0.6 });

  $('idleText').textContent = '✦ 甜蜜蜜生效中 ✦';
  setIdleMsgIdx(-1);
  if (nextEncounterTimer) clearTimeout(nextEncounterTimer);
  if (honeyExpiryTimer) clearTimeout(honeyExpiryTimer);
  const d = BUFF_DURATION * 1000;
  setHoneyCountdownEnd(Date.now() + d);
  setNextEncounterTimer(setTimeout(async () => {
    const { tryEncounter } = await import('./battle.js');
    tryEncounter();
  }, rand(BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX) * 1000));
  setHoneyExpiryTimer(setTimeout(() => handleHoneyExpired(), d));
  updateBackpack();
  startHoneyCountdown();
}

export function startHoneyCountdown() {
  clearHoneyCountdown();
  const slot = document.querySelector('.bag-slot[data-item="sweet-honey"]');
  const qtyEl = document.getElementById('bag-sweet-honey');
  if (!slot || !qtyEl) return;
  slot.classList.add('disabled');
  const initial = Math.max(0, Math.ceil((honeyCountdownEnd - Date.now()) / 1000));
  qtyEl.textContent = initial + 's';
  setHoneyCountdownInterval(setInterval(() => {
    const remaining = Math.max(0, Math.ceil((honeyCountdownEnd - Date.now()) / 1000));
    qtyEl.textContent = remaining + 's';
    if (remaining <= 0) clearHoneyCountdown();
  }, 200));
}

export function clearHoneyCountdown() {
  if (honeyCountdownInterval) { clearInterval(honeyCountdownInterval); setHoneyCountdownInterval(null); }
  const slot = document.querySelector('.bag-slot[data-item="sweet-honey"]');
  if (slot) slot.classList.remove('disabled');
  const qtyEl = document.getElementById('bag-sweet-honey');
  if (qtyEl && gameData) qtyEl.textContent = gameData.items['sweet-honey'] || 0;
}

// ===== 闪耀护符 =====
export function activateShinyCharm() {
  if ((gameData.items['shiny-charm']||0) <= 0) return;
  if (charmBuffActive) return;
  if (honeyBuffActive) return; // 甜甜蜜生效期间不能使用（两个 buff 互斥）
  gameData.items['shiny-charm']--;
  setCharmEncounterCount(0);
  addSystemLog('item_use', { item: 'shiny-charm' });
  setCharmBuffActive(true);
  setIdleCharacter('walk');
  particles.stop();
  particles.start('rgba(180,230,255,1)', 'star');

  $('idleText').textContent = '✦ 闪耀护符生效中 ✦';
  setIdleMsgIdx(-1);

  if (nextEncounterTimer) { clearTimeout(nextEncounterTimer); setNextEncounterTimer(null); }
  if (charmExpiryTimer) { clearTimeout(charmExpiryTimer); setCharmExpiryTimer(null); }
  const d = BUFF_DURATION * 1000;
  setCharmCountdownEnd(Date.now() + d);

  setNextEncounterTimer(setTimeout(async () => {
    const { tryEncounter } = await import('./battle.js');
    tryEncounter();
  }, rand(BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX) * 1000));

  setCharmExpiryTimer(setTimeout(() => handleCharmExpired(), d));

  updateBackpack();
  startCharmCountdown();
}

// ===== Buff 到期公共回调 =====
export function handleHoneyExpired() {
  setHoneyBuffActive(false);
  setHoneyCountdownEnd(0);
  clearHoneyCountdown();
  $('idleText').textContent = '✦ 甜蜜蜜的效果渐渐褪去了';
  if (gameData.settings?.autoBuffHoney && (gameData.items['sweet-honey']||0) > 0) {
    setHoneyExpiryTimer(null);
    activateHoney();
    return;
  }
  if (gameData.settings?.autoBuffCharm && (gameData.items['shiny-charm']||0) > 0 && !charmBuffActive) {
    setHoneyExpiryTimer(null);
    activateShinyCharm();
    return;
  }
  setIdleCharacter('walk');
  particles.stop();
  setHoneyExpiryTimer(null);
  addSystemLog('buff_expired', { item: 'sweet-honey' });
}

export function handleCharmExpired() {
  setCharmBuffActive(false);
  setCharmCountdownEnd(0);
  clearCharmCountdown();
  showBuffExpired('charm');
  if (gameData.settings?.autoBuffHoney && (gameData.items['sweet-honey']||0) > 0) {
    setCharmExpiryTimer(null);
    activateHoney();
    return;
  }
  if (gameData.settings?.autoBuffCharm && (gameData.items['shiny-charm']||0) > 0) {
    setCharmExpiryTimer(null);
    activateShinyCharm();
    return;
  }
  if (_charmEncounterCount === 0 && phase === 'idle') {
    import('./battle.js').then(m => m.tryEncounter());
  }
  setCharmEncounterCount(0);
  setIdleCharacter('walk');
  particles.stop();
  setCharmExpiryTimer(null);
  addSystemLog('buff_expired', { item: 'shiny-charm' });
}

export function startCharmCountdown() {
  clearCharmCountdown();
  const slot = document.querySelector('.bag-slot[data-item="shiny-charm"]');
  const qtyEl = document.getElementById('bag-shiny-charm');
  if (!slot || !qtyEl) return;
  slot.classList.add('disabled');
  const initial = Math.max(0, Math.ceil((charmCountdownEnd - Date.now()) / 1000));
  qtyEl.textContent = initial + 's';
  setCharmCountdownInterval(setInterval(() => {
    const remaining = Math.max(0, Math.ceil((charmCountdownEnd - Date.now()) / 1000));
    qtyEl.textContent = remaining + 's';
    if (remaining <= 0) clearCharmCountdown();
  }, 200));
}

export function clearCharmCountdown() {
  if (charmCountdownInterval) { clearInterval(charmCountdownInterval); setCharmCountdownInterval(null); }
  const slot = document.querySelector('.bag-slot[data-item="shiny-charm"]');
  if (slot) slot.classList.remove('disabled');
  const qtyEl = document.getElementById('bag-shiny-charm');
  if (qtyEl && gameData) qtyEl.textContent = gameData.items['shiny-charm'] || 0;
}
