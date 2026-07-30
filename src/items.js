// ===== 道具相关逻辑 =====
import { ITEM_NAMES, ITEM_ICONS, CANDY_EXCHANGE, CATCH_RATES, ITEM_RATES, SHINY_CHANCE, TYPE_COLORS } from './config.js';
import { phase, gameData, allPokemon, currentEncounter, currentIsShiny, setCurrentEncounter, setCurrentIsShiny, setPhase, _itemDropActive, honeyBuffActive, charmBuffActive, honeyCountdownEnd, charmCountdownEnd, honeyCountdownInterval, charmCountdownInterval, honeyPausedRemaining, charmPausedRemaining, honeyExpiryTimer, charmExpiryTimer, nextEncounterTimer, _honeyEncounterCount, _charmEncounterCount, _eggHatching, saveGame, addSystemLog, randInt, rand, getCurrentRegion, _catchStreak, setCatchStreak, setNextEncounterTimer, setItemDropActive, setEggHatching, _idleMsgIdx, setIdleMsgIdx, setHoneyBuffActive, setHoneyCountdownEnd, setCharmBuffActive, setCharmCountdownEnd, setHoneyPausedRemaining, setCharmPausedRemaining, setHoneyEncounterCount, setCharmEncounterCount, setHoneyExpiryTimer, setCharmExpiryTimer, setHoneyCountdownInterval, setCharmCountdownInterval } from './state.js';
import { $, updateTextBox, updateBackpack, updateStats, showView, isOnGameView, fitPokemonImage, tryLoadPokemonImage, setIdleCharacter } from './ui.js';
import { showIdlePickup } from './messages.js';
import { animate, delay } from './animation.js';
import * as road from './road.js';
import * as particles from './particles.js';

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
  // 筛选当前地区的宝可梦
  const pool = allPokemon.filter(p => p.region === region.name);
  if (pool.length === 0) return null;
  let rarityBoost = 0;
  if (honeyBuffActive) rarityBoost = Math.max(rarityBoost, 0.5);
  if (charmBuffActive) rarityBoost = Math.max(rarityBoost, 0.7);
  return pickWeightedPokemon(rarityBoost, pool);
}

// ---------- 道具随路面滚动进入 ----------
export function spawnItemDrop(itemKey) {
  if (phase !== 'idle') return;
  if (_itemDropActive) return;
  const screen = $('screen');
  const charEl = $('walkGif');
  if (!screen || !charEl) return;

  setItemDropActive(true);

  const el = document.createElement('img');
  el.className = 'item-fly';
  el.src = `./items/${ITEM_ICONS[itemKey] || itemKey + '.png'}`;
  el.alt = ITEM_NAMES[itemKey] || itemKey;
  screen.appendChild(el);

  const sRect = screen.getBoundingClientRect();
  const cRect = charEl.getBoundingClientRect();
  const charLeft = cRect.left - sRect.left;

  // 物品放在路面上（第二行瓦片高度）
  const roadEl = document.querySelector('.road-layer');
  const rRect = roadEl ? roadEl.getBoundingClientRect() : cRect;
  const itemY = (rRect.top - sRect.top) + 24;

  // 初始位置：屏幕右边缘外
  let itemX = sRect.width + 10;
  el.style.left = itemX + 'px';
  el.style.top = itemY + 'px';
  el.style.opacity = '1';

  const pickupX = charLeft + 10;
  let active = true;

  function cleanup() {
    active = false;
    el.remove();
    setItemDropActive(false);
    setIdleCharacter('walk');
    road.resume();
  }

  function frame() {
    if (!active) return;

    // 非空闲页面时隐藏，位置继续更新
    const isIdleView = $('idleView')?.style.display !== 'none';
    if (!isIdleView) {
      el.style.display = 'none';
      requestAnimationFrame(frame);
      return;
    }
    // 遇敌时暂停移动并隐藏，等道路恢复再继续
    if (!road.isActive()) {
      el.style.display = 'none';
      requestAnimationFrame(frame);
      return;
    }
    el.style.display = '';

    // 每帧随道路速度向左移动（和 road._frame 保持一致）
    const roadSpeed = road.getSpeed();
    itemX -= roadSpeed;

    // 回绕保护
    if (itemX > sRect.width + 100) { cleanup(); return; }

    el.style.left = itemX + 'px';

    if (itemX <= pickupX) {
      active = false;
      road.pause();
      setIdleCharacter('get-item', itemKey);

      // 道具飞向角色
      const startX = itemX;
      const targetX = charLeft + 6;
      const startY = itemY;
      const cTop = cRect.top - sRect.top;
      const targetY = cTop + 12;
      const startT = performance.now();
      const flyDuration = 500;

      (function fly(now) {
        const t = Math.min((now - startT) / flyDuration, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        el.style.left = (startX + (targetX - startX) * ease) + 'px';
        el.style.top = (startY + (targetY - startY) * ease) + 'px';
        const scale = 1 - ease * 0.7;
        el.style.transform = `scale(${scale})`;

        if (t < 1) {
          requestAnimationFrame(fly);
        } else {
          el.remove();
          setItemDropActive(false);
          setIdleCharacter('walk');
          road.resume();
          // 加入背包
          gameData.items[itemKey] = (gameData.items[itemKey] || 0) + 1;
          gameData.stats.totalItemsEarned[itemKey] = (gameData.stats.totalItemsEarned[itemKey] || 0) + 1;
          addSystemLog('item_gain', { item: itemKey, qty: 1 });
          updateBackpack(itemKey);
          showIdlePickup(ITEM_NAMES[itemKey]);
        }
      })(performance.now());
      return;
    }

    requestAnimationFrame(frame);
  }

  // 角色保持行走，道路继续滚动
  setIdleCharacter('walk');
  requestAnimationFrame(frame);
}

// ---------- 神秘蛋从背包孵化 ----------
export async function hatchEggFromBag() {
  if (_eggHatching) return;
  if ((gameData.items['mystery-egg']||0) <= 0) return;
  setEggHatching(true);

  gameData.items['mystery-egg']--;
  updateBackpack();

  const poke = pickRandomPokemon();
  if (!poke) { setEggHatching(false); return; }

  const eggIsShiny = Math.random() < 1/1000;

  setCurrentIsShiny(eggIsShiny);

  setPhase('eggResult');

  // 暂停 buff 倒计时（同 tryEncounter 逻辑）
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
  const idx = String(poke.index);
  if (!gameData.pokedex[idx]) {
    gameData.pokedex[idx] = {
      name: poke.name, seen: 0, caught: 0,
      lastTime: null, shinySeen: 0, shinyCaught: 0,
    };
  }
  gameData.pokedex[idx].seen++;
  gameData.pokedex[idx].caught = (gameData.pokedex[idx].caught || 0) + 1;
  gameData.pokedex[idx].lastTime = new Date().toISOString();
  if (eggIsShiny) {
    gameData.pokedex[idx].shinyCaught = (gameData.pokedex[idx].shinyCaught || 0) + 1;
    gameData.stats.totalShinyCaught++;
  }
  gameData.stats.totalCatches++;
  gameData.stats.totalEggsHatched++;
  // 记录遭遇日志
  if (!gameData.encounterLogs) gameData.encounterLogs = {};
  if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
  gameData.encounterLogs[idx].push({
    time: Date.now(), shiny: eggIsShiny, result: 'caught', balls: {}
  });

  showView('encounterView');
  // 清除遇敌UI
  $('encounterName').textContent = '';
  $('encounterTypes').innerHTML = '';
  $('encounterHavedIcon').style.display = 'none';
  $('encounterCatchRate').textContent = '';
  $('fleeBtn').style.display = 'none';

  // 第一步：显示蛋 + 摇晃动画（底部中心为支点）
  const img = $('encounterGif');
  img.src = './items/mystery-egg.png';
  img.style.width = '48px';
  img.style.height = '48px';
  img.className = 'encounter-gif egg-shake';
  img.style.setProperty('width', '48px', 'important');
  img.style.setProperty('height', '48px', 'important');

  if (isOnGameView()) updateTextBox('蛋在微微晃动...', false);
  await delay(1500);

  // 第二步：摇晃自然停止，蛋静止
  img.className = 'encounter-gif';
  await delay(200);

  if (isOnGameView()) updateTextBox('蛋裂开了！', false);
  await delay(600);

  // 预加载宝可梦图片（.gif → .png 自动回退）
  // 先隐藏 img，避免 src 切换过程中闪现
  img.style.opacity = '0';
  let imageLoaded = false;
  await tryLoadPokemonImage(img, poke, '').then(ok => { imageLoaded = ok; });

  // 第三步：从蛋中心放大出现
  img.style.transform = 'translate(-50%, -50%) scale(0)';

  // 清除蛋阶段的 !important 尺寸，重新适配宝可梦图片尺寸
  img.style.removeProperty('width');
  img.style.removeProperty('height');
  if (imageLoaded) {
    fitPokemonImage(img);
  } else {
    // 图片没加载出来时清空 src + 给默认尺寸，至少能看见占位框
    img.removeAttribute('src');
    img.style.width = '80px';
    img.style.height = '80px';
    img.style.objectFit = 'contain';
  }

  // 触发重排
  void img.offsetHeight;

  // 放大动画
  await animate(350, t => {
    const s = t; // 0 → 1
    const o = t < 0.2 ? t / 0.2 : 1; // 快速显现
    img.style.transform = `translate(-50%, -50%) scale(${s})`;
    img.style.opacity = o;
  });

  // 显示宝可梦信息
  $('encounterName').innerHTML = eggIsShiny
    ? '<span>' + poke.name + '</span><svg viewBox="0 0 1024 1024" width="14" height="14" style="flex-shrink:0;color:var(--ui-color);"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>'
    : poke.name;
  $('encounterTypes').innerHTML = (poke.types||[]).map(t =>
    `<span class="type-badge" style="background:${TYPE_COLORS[t]||'#888'}">${t}</span>`
  ).join('');
  $('encounterHavedIcon').style.display = '';

  addSystemLog('egg_hatch', { pokemon: poke.index, name: poke.name, shiny: eggIsShiny });
  if (isOnGameView()) updateTextBox(eggIsShiny ? '孵化出闪光的 ' + poke.name + ' 了！' : '孵化成功！获得了 ' + poke.name, true);

  await saveGame();
  updateStats();
  setEggHatching(false);
}

// ===== 糖果兑换弹窗 =====
export function openCandyDialog() {
  const dlg = $('candyDialog');
  if (!dlg) return;
  // 更新各选项状态
  dlg.querySelectorAll('.candy-opt').forEach(el => {
    const cost = parseInt(el.dataset.cost);
    const enough = (gameData.items['candy']||0) >= cost;
    el.classList.toggle('disabled', !enough);
  });
  dlg.classList.add('open');
}

export async function doCandyExchange(itemKey) {
  const cost = CANDY_EXCHANGE[itemKey];
  if (!cost) return;
  if ((gameData.items['candy']||0) < cost) return;
  gameData.items['candy'] -= cost;
  const qty = itemKey === 'sweet-honey' ? 2 : 1;
  gameData.items[itemKey] = (gameData.items[itemKey]||0) + qty;
  addSystemLog('shop_purchase', { item: itemKey, qty, cost });
  updateBackpack(itemKey);
  // 刷新弹窗
  const dlg = $('candyDialog');
  if (dlg?.classList.contains('open')) openCandyDialog();
  // 更新商店页面（动态导入避免循环依赖）
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
  setHoneyEncounterCount(0);
  addSystemLog('item_use', { item: 'sweet-honey' });
  setHoneyBuffActive(true);
  setIdleCharacter('walk');
  particles.stop();
  particles.start('rgba(255,215,0,1)');

  $('idleText').textContent = '✦ 甜蜜蜜生效中 ✦';
  setIdleMsgIdx(-1);
  // 甜甜蜜持续 1 分钟
  if (nextEncounterTimer) clearTimeout(nextEncounterTimer);
  if (honeyExpiryTimer) clearTimeout(honeyExpiryTimer);
  const d = 60000;
  setHoneyCountdownEnd(Date.now() + d);
  // 快速遇敌
  setNextEncounterTimer(setTimeout(async () => {
    const { tryEncounter } = await import('./battle.js');
    tryEncounter();
  }, rand(15, 30) * 1000));
  // 甜甜蜜到期
  setHoneyExpiryTimer(setTimeout(() => {
    setHoneyBuffActive(false);
    setHoneyCountdownEnd(0);
    clearHoneyCountdown();
    // 自动续杯
    if (gameData.settings?.autoBuffHoney && (gameData.items['sweet-honey']||0) > 0) {
      setHoneyExpiryTimer(null);
      activateHoney();
      return;
    }
    // 保底：整个buff期间一次都没遇到
    if (_honeyEncounterCount === 0 && phase === 'idle') {
      import('./battle.js').then(m => m.tryEncounter());
    }
    setHoneyEncounterCount(0);
    setIdleCharacter('walk');
    particles.stop();
    $('idleText').textContent = '';
    setHoneyExpiryTimer(null);
  }, d));
  updateBackpack();
  startHoneyCountdown();
}

export function startHoneyCountdown() {
  clearHoneyCountdown();
  const slot = document.querySelector('.bag-slot[data-item="sweet-honey"]');
  const qtyEl = document.getElementById('bag-sweet-honey');
  if (!slot || !qtyEl) return;
  slot.classList.add('disabled');
  // 立即设置初始值，避免 clearHoneyCountdown 重置为数量后闪一下
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
  // 注意：不要在这里清除 honeyExpiryTimer，否则自动续杯回调永不执行
  // 暂停倒计时时应由 pause 处的 tryEncounter 代码显式清除
  const slot = document.querySelector('.bag-slot[data-item="sweet-honey"]');
  if (slot) slot.classList.remove('disabled');
  const qtyEl = document.getElementById('bag-sweet-honey');
  if (qtyEl && gameData) qtyEl.textContent = gameData.items['sweet-honey'] || 0;
}

// ===== 闪耀护符 =====
export function activateShinyCharm() {
  if ((gameData.items['shiny-charm']||0) <= 0) return;
  if (charmBuffActive) return;
  gameData.items['shiny-charm']--;
  setCharmEncounterCount(0);
  addSystemLog('item_use', { item: 'shiny-charm' });
  setCharmBuffActive(true);
  setIdleCharacter('walk');
  particles.stop();
  particles.start('rgba(160,210,255,0.5)');

  $('idleText').textContent = '✦ 闪耀护符生效中 ✦';
  setIdleMsgIdx(-1);

  // 取消现有定时器
  if (nextEncounterTimer) { clearTimeout(nextEncounterTimer); setNextEncounterTimer(null); }
  if (charmExpiryTimer) { clearTimeout(charmExpiryTimer); setCharmExpiryTimer(null); }

  // 闪耀护符持续 60 秒，期间快速遇敌
  const d = 60000;
  setCharmCountdownEnd(Date.now() + d);

  // 首次遇敌（15-30秒后）
  setNextEncounterTimer(setTimeout(async () => {
    const { tryEncounter } = await import('./battle.js');
    tryEncounter();
  }, rand(15, 30) * 1000));

  // 护符到期
  setCharmExpiryTimer(setTimeout(() => {
    setCharmBuffActive(false);
    setCharmCountdownEnd(0);
    clearCharmCountdown();
    // 自动续杯：优先甜甜蜜
    if (gameData.settings?.autoBuffHoney && (gameData.items['sweet-honey']||0) > 0) {
      $('idleText').textContent = '';
      setCharmExpiryTimer(null);
      activateHoney();
      return;
    }
    if (gameData.settings?.autoBuffCharm && (gameData.items['shiny-charm']||0) > 0) {
      $('idleText').textContent = '';
      setCharmExpiryTimer(null);
      activateShinyCharm();
      return;
    }
    // 保底
    if (_charmEncounterCount === 0 && phase === 'idle') {
      import('./battle.js').then(m => m.tryEncounter());
    }
    setCharmEncounterCount(0);
    setIdleCharacter('walk');
    particles.stop();
    $('idleText').textContent = '';
    setCharmExpiryTimer(null);
  }, d));

  updateBackpack();
  startCharmCountdown();
}

export function startCharmCountdown() {
  clearCharmCountdown();
  const slot = document.querySelector('.bag-slot[data-item="shiny-charm"]');
  const qtyEl = document.getElementById('bag-shiny-charm');
  if (!slot || !qtyEl) return;
  slot.classList.add('disabled');
  // 立即设置初始值，避免 clearCharmCountdown 重置为数量后闪一下
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
