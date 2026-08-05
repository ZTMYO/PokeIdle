// ===== 道具相关逻辑 =====
import { ITEM_NAMES, CANDY_EXCHANGE, CATCH_RATES, ITEM_RATES, CANDY_DROP_MULT, SHINY_CHANCE, BUFF_DURATION, BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX, HONEY_RARITY_BOOST, CHARM_RARITY_BOOST, PX_PER_METER } from './config.js';
import { phase, gameData, allPokemon, getPokemonByIndex, setCurrentEncounter, setCurrentIsShiny, setPhase, _itemDropActive, honeyBuffActive, charmBuffActive, honeyCountdownEnd, charmCountdownEnd, honeyCountdownInterval, charmCountdownInterval, honeyPausedRemaining, charmPausedRemaining, honeyExpiryTimer, charmExpiryTimer, nextEncounterTimer, _charmEncounterCount, _eggHatching, saveGame, addSystemLog, randInt, rand, getCurrentRegion, setNextEncounterTimer, setItemDropActive, setEggHatching, _idleMsgIdx, setIdleMsgIdx, setHoneyBuffActive, setHoneyCountdownEnd, setCharmBuffActive, setCharmCountdownEnd, setHoneyPausedRemaining, setCharmPausedRemaining, setCharmEncounterCount, setHoneyExpiryTimer, setCharmExpiryTimer, setHoneyCountdownInterval, setCharmCountdownInterval, calcHatchDistance, getIncubatorUnlockCost, addRosterEntry, rarityLabel, setLastObtainedEntryId } from './state.js';
import { $, updateTextBox, updateBackpack, updateStats, showView, isOnGameView, fitPokemonImage, tryLoadPokemonImage, setIdleCharacter, renderIncubatorView, updateIncubatorBadge } from './ui.js';
import { showIdlePickup, showBuffExpired } from './messages.js';
import { animate, delay } from './animation.js';
import { computeObtainScore } from './scoring.js';
import { playCongratulation } from './audio.js';
import * as road from './road.js';
import * as particles from './particles.js';

// 宝可梦属性显示颜色（图鉴/战斗页类型标签用）
export const TYPE_COLORS = {
  '一般': '#B5B4AF', '格斗': '#BE4D47', '飞行': '#81b9ef', '毒': '#8943B0',
  '地面': '#9C5A59', '岩石': '#D3A865', '虫': '#9CAE1E', '幽灵': '#704170',
  '钢': '#60a1b8', '火': '#E75357', '水': '#3F98EA', '草': '#3fa129',
  '电': '#F9CE40', '超能': '#F8669C', '冰': '#3fd8ff', '龙': '#5060e1',
  '恶': '#61484B', '妖精': '#E259E7',
};

// 道具图标文件名（位于 src/items/ 目录）
export const ITEM_ICONS = {
  'poke-ball': 'poke-ball.png', 'ultra-ball': 'ultra-ball.png',
  'master-ball': 'master-ball.png', 'candy': 'candy.png',
  'sweet-honey': 'honey.png', 'mystery-egg': 'mystery-egg.png', 'shiny-charm': 'shiny-charm.png',
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

// ---------- 权重随机选精灵 ----------
// rarityBoost 越高稀有精灵出现概率越大
// rarity 已在 pokedex.json 中预计算（基于捕获率 + 种族值）
export function pickWeightedPokemon(rarityBoost, pool) {
  const source = pool || allPokemon;
  if (source.length === 0) return null;
  const penalty = Math.max(0.2, 0.8 - rarityBoost * 0.5); // 正常 0.8，蜜 0.55，护符 0.45
  const weights = source.map(p => Math.max(0.01, 1 - (p.rarity ?? 0.5) * penalty));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < source.length; i++) {
    r -= weights[i];
    if (r <= 0) return source[i];
  }
  return source[source.length - 1];
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
  return allPokemon[randInt(0, allPokemon.length - 1)];
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
function grantItem(itemKey, qty = 1) {
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
export function spawnItemDrop(itemKey) {
  if (phase !== 'idle') return;
  // 掉落糖果时先确定本次数量倍率（×1/×2/×5/×50/×100）
  const qty = itemKey === 'candy' ? rollCandyMult() : 1;
  const screen = $('screen');
  const charEl = $('walkGif');
  if (!screen || !charEl) return;

  // 不在主界面（在其他页面挂机中）：后台直接模拟拾取入库，不播放滚动/拾取动画
  if ($('idleView')?.style.display === 'none') {
    grantItem(itemKey, qty);
    return;
  }

  if (_itemDropActive) return;

  setItemDropActive(true);

  const el = document.createElement('img');
  el.className = 'item-fly';
  el.src = `./items/${ITEM_ICONS[itemKey] || itemKey + '.png'}`;
  el.alt = ITEM_NAMES[itemKey] || itemKey;
  screen.appendChild(el);

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
          el.remove();
          setItemDropActive(false);
          if (phase === 'idle') { setIdleCharacter('walk'); road.resume(); }
          grantItem(itemKey, qty);
          showIdlePickup(ITEM_NAMES[itemKey], road.getPlace());
        }
      })(performance.now());
      return;
    }

    requestAnimationFrame(frame);
  }

  setIdleCharacter('walk');
  requestAnimationFrame(frame);
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
    hatchDuration: distance * PX_PER_METER,
    hatched: false,
    isShiny: eggIsShiny,
  };

  addSystemLog('incubator_place', { slot: slotIndex, pokemon: poke.index, shiny: eggIsShiny });
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
  addSystemLog('incubator_unlock', { slot: slotIndex, cost });
  saveGame();
  updateBackpack();
  renderIncubatorView();
}

// ---------- 从孵蛋器取出孵化 ----------
export async function hatchFromIncubator(slotIndex) {
  if (_eggHatching) return;
  if (phase !== 'idle') return; // 战斗/捕捉/孵蛋动画期间禁止孵化（孵蛋动画期间不会遇敌）
  const incubators = gameData.incubators;
  if (!incubators || !incubators[slotIndex]) return;
  const slot = incubators[slotIndex];
  if (!slot || !slot.hatched) return;

  setEggHatching(true);

  const poke = getPokemonByIndex(slot.eggIndex);
  if (!poke) { setEggHatching(false); return; }

  const eggIsShiny = slot.isShiny || false;

  const idx = String(poke.index);

  setCurrentIsShiny(eggIsShiny);
  setPhase('eggResult');

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
  showView('encounterView');
  $('animThrowChar').style.display = 'none';
  $('fleeBtn').style.display = 'none';
  const strayBall = $('animBall');
  if (strayBall) { strayBall.classList.remove('visible'); strayBall.style.cssText = ''; strayBall.style.display = 'none'; }
  const strayStage = $('catchStage');
  if (strayStage) strayStage.classList.remove('active');
  $('encounterName').textContent = '';
  $('encounterTypes').innerHTML = '';
  $('encounterOwnedWrap').style.display = 'none';
  $('encounterCatchRate').textContent = '';
  $('encounterNewLabel').style.display = 'none';
  $('fleeBtn').style.display = 'none';

  const oldImg = $('encounterGif');
  const parent = oldImg.parentNode;

  const tmp = new Image();
  tmp.src = './items/hatch.png';
  await new Promise(r => { tmp.onload = r; tmp.onerror = r; });
  const frameW = tmp.naturalWidth;
  const frameH = tmp.naturalHeight / 4;

  const displayW = 80;
  const displayH = displayW * (frameH / frameW);

  const sprite = document.createElement('div');
  sprite.id = 'encounterGif';
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
    if (!isOnGameView()) { watchedAnim = false; return; }
    if (before) before();
    await delay(ms);
    if (!isOnGameView()) watchedAnim = false;
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

  // 无论是否跳过动画，都恢复为 <img> 元素（后续遭遇渲染依赖 #encounterGif 是 img）
  const img = document.createElement('img');
  img.id = 'encounterGif';
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

  $('encounterName').style.display = 'none';
  $('encounterTypes').style.display = 'none';
  // 新发现标记（普通/闪光分开）
  const existingEntry = gameData.pokedex[idx];
  const isNewDiscovery = !existingEntry
    ? true
    : eggIsShiny ? existingEntry.shinySeen === 0 : existingEntry.seen === 0;
  const newLabel = $('encounterNewLabel');
  if (newLabel) newLabel.style.display = isNewDiscovery ? '' : 'none';

  // 已捕获标记（普通/闪光分开）
  $('encounterOwnedWrap').style.display = (existingEntry && (eggIsShiny ? existingEntry.shinyCaught > 0 : existingEntry.caught > 0)) ? '' : 'none';
  if (existingEntry && (eggIsShiny ? existingEntry.shinyCaught > 0 : existingEntry.caught > 0)) {
    const tipEl = $('encounterOwnedTip');
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
  $('encounterCatchRate').innerHTML = '稀有度 ' + rarityLabel(poke.rarity ?? 0.5);

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
    gameData.stats.totalShinyCaught++;
    gameData.stats.totalShinyEggsHatched++;
  }
  gameData.stats.totalCatches++;
  gameData.stats.totalEggsHatched++;
  if (!gameData.encounterLogs) gameData.encounterLogs = {};
  if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
  gameData.encounterLogs[idx].push({
    time: Date.now(), shiny: eggIsShiny, result: 'caught', balls: {},
    charmBuff: false, // 闪耀护符不提升孵蛋闪光率（蛋的闪光在放入孵蛋器时已按 1/1000 判定），恒为 false
    score: computeObtainScore({
      pokemon: poke, source: 'egg', shiny: eggIsShiny,
      charmBuff: false, honeyBuff: false, balls: {}, finalRate: 1,
    }),
  });

  const entry = addRosterEntry({ species: poke.index, shiny: eggIsShiny, source: 'egg' });
  setLastObtainedEntryId(entry.id);
  playCongratulation(); // 孵蛋获得宝可梦 → 祝贺音效

  incubators[slotIndex] = { eggIndex: null, hatched: false, hatchStart: 0, hatchDuration: 0, isShiny: false };

  addSystemLog('egg_hatch', { pokemon: poke.index, shiny: eggIsShiny });
  if (isOnGameView()) updateTextBox(eggIsShiny ? '孵化出闪光的 ' + poke.name + ' 了！' : '孵化成功！获得了 ' + poke.name, true);

  await saveGame();
  updateStats();
  updateIncubatorBadge();

  setEggHatching(false);

  // 玩家已离开游戏页（后台孵化）：跳过「查看详情」确认流程，直接回到空闲状态，
  // 并刷新孵蛋器按钮（避免 phase 停留在 eggResult 导致孵化按钮一直禁用）
  if (!isOnGameView()) {
    import('./battle.js').then(m => {
      m.goIdle();
      renderIncubatorView();
    });
  }
}

// ===== 糖果兑换弹窗 =====
export function openCandyDialog() {
  const dlg = $('candyDialog');
  if (!dlg) return;
  dlg.querySelectorAll('.candy-opt').forEach(el => {
    const cost = parseInt(el.dataset.cost);
    const enough = (gameData.items['candy']||0) >= cost;
    el.classList.toggle('disabled', !enough);
  });
  dlg.classList.add('open');
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
  const dlg = $('candyDialog');
  if (dlg?.classList.contains('open')) openCandyDialog();
  if ($('shopView')?.style.display === 'flex') {
    const { showShopView } = await import('./views.js');
    showShopView();
  }
}

export function closeCandyDialog() {
  $('candyDialog')?.classList.remove('open');
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
