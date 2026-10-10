// ===== 道具相关逻辑 =====
import { ITEM_NAMES, ITEM_DESC, CANDY_EXCHANGE, ITEM_SELL_RATE, ITEM_SELL_OVERRIDE, CANDY_DROP_MULT, SHINY_CHANCE, BUFF_DURATION, BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX, HONEY_RARITY_BOOST, CHARM_RARITY_BOOST, PX_PER_METER, EVO_PRICES, EVO_EXCLUSIVE_PRICE, EVO_SHOP_DAILY, EVO_SHOP_WEIGHTS, EVO_SHOP_EXCLUSIVE_SLOTS, EVO_SHOP_EXCLUSIVE_WEIGHT, EVO_SHOP_MINT_WEIGHT, MINT_NATURES, MINT_PRICE, BREED_ONLY_IDS, LEGEND_POOL_DIVISOR, LEGEND_ENCOUNTER_RATE, LEGEND_ENCOUNTER_RATE_BUFF, LEGEND_PITY, hatchSprite } from './config.js';
import { phase, gameData, allPokemon, getPokemonByIndex, isPowerForm, isWildExcluded, currentEncounter, currentIsShiny, encounterLevel, encounterBallsUsed, currentEncounterBalls, encounterMsg, setCurrentEncounter, setEncounterLevel, setEncounterBallsUsed, setCurrentEncounterBalls, setEncounterMsg, setCurrentIsShiny, setPhase, _itemDropActive, honeyBuffActive, charmBuffActive, honeyCountdownEnd, charmCountdownEnd, honeyCountdownInterval, charmCountdownInterval, honeyExpiryTimer, charmExpiryTimer, nextEncounterTimer, _charmEncounterCount, _eggHatching, saveGame, addSystemLog, addIncubatorLog, randInt, rand, getCurrentRegion, setNextEncounterTimer, setItemDropActive, setEggHatching, setIdleMsgIdx, setHoneyBuffActive, setHoneyCountdownEnd, setCharmBuffActive, setCharmGuaranteed, setCharmCountdownEnd, setHoneyPausedRemaining, setCharmPausedRemaining, setCharmEncounterCount, setHoneyExpiryTimer, setCharmExpiryTimer, setHoneyCountdownInterval, setCharmCountdownInterval, calcHatchDistance, getIncubatorUnlockCost, addRosterEntry, rarityLabel, setLastObtainedEntryId, getLastObtainedEntryId, isPokemon, rollGender, ensureGender, genderBadge, dexUnlocked, dexShinyOwned } from './state.js';
import { $, updateTextBox, updateBackpack, updateStats, showView, isOnHatchView, isIdleStageVisible, isPageHidden, fitPokemonImage, tryLoadPokemonImage, setIdleCharacter, renderIncubatorView, updateIncubatorBadge, showConfirmBar, hideConfirmBar, isEvolutionShowActive } from './ui.js';
import { showIdlePickup, showBuffExpired } from './messages.js';
import { animate, delay, burstShinySparkle } from './animation.js';
import { computeObtainScore } from './scoring.js';
import { NATURES } from './battle-core.js';
import { playCongratulation, stopCongratulation, playShiny } from './audio.js';
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

// 属性徽章上的图标色：图标是 currentColor，底色偏亮时换深色，避免白图标看不清
export function typeIconColor(type) {
  const hex = String(TYPE_COLORS[type] || '888888').replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.5 ? '#262626' : '#fff';
}

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
  'poke-ball': 'balls/poke-ball.png', 'ultra-ball': 'balls/ultra-ball.png',
  'master-ball': 'balls/master-ball.png', 'candy': 'goods/candy.png',
  'sweet-honey': 'goods/honey.png', 'mystery-egg': 'goods/mystery-egg.png', 'shiny-charm': 'goods/shiny-charm.png',
  'bike': 'goods/bike.png', 'exp-candy': 'goods/xp-candy.png',
  // 14 种通用进化道具（存档键 = 中文名，与 evolution.json 一致；文件名一律英文）
  '火之石': 'evo/fire-stone.png', '水之石': 'evo/water-stone.png', '雷之石': 'evo/thunder-stone.png', '叶之石': 'evo/leaf-stone.png',
  '冰之石': 'evo/ice-stone.png', '月之石': 'evo/moon-stone.png', '日之石': 'evo/sun-stone.png', '光之石': 'evo/shiny-stone.png',
  '暗之石': 'evo/dusk-stone.png', '觉醒之石': 'evo/dawn-stone.png',
  '联系绳': 'evo/linking-cord.png', '奇异石': 'evo/strange-stone.png', '心之石': 'evo/heart-stone.png',
  // 21 种薄荷共用 6 张图（items/mints/），按提升的能力分组：mint_0 攻击 / 1 防御 / 2 特攻 / 3 特防 / 4 速度 / 5 中性
  '怕寂寞薄荷': 'mints/mint_0.png', '固执薄荷': 'mints/mint_0.png', '顽皮薄荷': 'mints/mint_0.png', '勇敢薄荷': 'mints/mint_0.png',
  '大胆薄荷': 'mints/mint_1.png', '淘气薄荷': 'mints/mint_1.png', '乐天薄荷': 'mints/mint_1.png', '悠闲薄荷': 'mints/mint_1.png',
  '内敛薄荷': 'mints/mint_2.png', '慢吞吞薄荷': 'mints/mint_2.png', '马虎薄荷': 'mints/mint_2.png', '冷静薄荷': 'mints/mint_2.png',
  '温和薄荷': 'mints/mint_3.png', '温顺薄荷': 'mints/mint_3.png', '慎重薄荷': 'mints/mint_3.png', '自大薄荷': 'mints/mint_3.png',
  '胆小薄荷': 'mints/mint_4.png', '急躁薄荷': 'mints/mint_4.png', '爽朗薄荷': 'mints/mint_4.png', '天真薄荷': 'mints/mint_4.png',
  '认真薄荷': 'mints/mint_5.png',
};

// 进化/专属道具图标：通用道具查 ITEM_ICONS，形态道具查 evolution.json 的 stoneIcons（中文名 → 英文文件名）
let _exclusiveIcons = null;
export function setExclusiveIcons(map) { _exclusiveIcons = map || null; }
export const evoIconSrc = (key) => {
  if (ITEM_ICONS[key]) return `./items/${ITEM_ICONS[key]}`;
  const f = _exclusiveIcons && _exclusiveIcons[key];
  return `./items/evo/stones/${f ? `${f}.png` : `${key}.png`}`;
};

// 任意道具的图标：ITEM_ICONS 里没有的（进化/专属道具）走 evoIconSrc
export const itemIconSrc = (key) => (ITEM_ICONS[key] ? `./items/${ITEM_ICONS[key]}` : evoIconSrc(key));

// 专属道具说明：道具名 → 形态编号（由 ensureEvoMeta 注入）
let _exclusiveForms = null;
export function setExclusiveForms(map) { _exclusiveForms = map || null; }
const FORM_VERB = [['超级', '超级进化'], ['超极巨', '超极巨化'], ['原始', '原始回归'], ['究极', '究极爆发']];
// 任意道具的说明文字：配置里有就用配置；薄荷按性格生成；专属道具按数据现生成
const MINT_STAT_CN = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
export function itemDescOf(key) {
  if (ITEM_DESC[key]) return ITEM_DESC[key];
  const nature = NATURES[MINT_NATURES[key]];
  if (MINT_NATURES[key]) {
    if (!nature) return '使用后改变宝可梦的性格\n（无能力修正）';
    return `使用后改变宝可梦的性格\n${MINT_STAT_CN[nature.up]}＋10%、${MINT_STAT_CN[nature.down]}－10%`;
  }
  const idx = _exclusiveForms && _exclusiveForms[key];
  const form = idx ? getPokemonByIndex(String(idx)) : null;
  if (form) {
    const base = getPokemonByIndex(String(idx).split('-')[0]);
    const fname = form.form || form.name;
    const verb = (FORM_VERB.find(([p]) => fname.includes(p)) || [])[1];
    if (verb) return `让${base ? base.name : '宝可梦'}${verb}的石头`;
    return `让${base ? base.name : '宝可梦'}变成${fname}的道具`;
  }
  return '进化道具';
}

// ---------- 今日道具（商店里进化道具的唯一来源）----------
// 每天上架 EVO_SHOP_DAILY 件、每件限 1 个、按基础价卖；专属道具按整类权重占一份额。
// 存档 gameData.evoShop = { date, ids, sold }
function evoDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const MINT_KEYS = Object.keys(MINT_NATURES);
const isMint = (key) => MINT_NATURES[key] != null;

export const evoBasePrice = (id) => EVO_PRICES[id] ?? (isMint(id) ? MINT_PRICE : EVO_EXCLUSIVE_PRICE);

// 道具的统一回收价：基础道具查 CANDY_EXCHANGE（贵重品有固定价），通用进化道具查 EVO_PRICES，
// 薄荷按 MINT_PRICE，形态专属道具按 EVO_EXCLUSIVE_PRICE；都不匹配的视为不卖（返回 0，出售列表里不出现）
const NOT_SELLABLE = new Set(['candy', 'casinoCoin']); // 货币不卖
export function sellPriceOf(key) {
  if (NOT_SELLABLE.has(key)) return 0;
  const fixed = ITEM_SELL_OVERRIDE[key];
  if (fixed != null) return fixed;
  const base = CANDY_EXCHANGE[key] ?? EVO_PRICES[key] ?? (isMint(key) ? MINT_PRICE : null);
  if (base != null) return Math.round(base * ITEM_SELL_RATE);
  if (evoExclusivePool().includes(key)) return Math.round(EVO_EXCLUSIVE_PRICE * ITEM_SELL_RATE);
  return 0;
}

// 基础道具的固定顺序 = 首页背包那排槽
export const BASIC_ITEM_ORDER = ['poke-ball', 'ultra-ball', 'master-ball', 'mystery-egg', 'sweet-honey', 'shiny-charm', 'bike', 'exp-candy'];

// 出售列表顺序：基础道具（背包槽顺序）→ 进化道具（配置表顺序）→ 薄荷 → 专属道具（数据表顺序）
const BASIC_RANK = new Map(BASIC_ITEM_ORDER.map((k, i) => [k, i]));
const EVO_RANK = new Map(Object.keys(EVO_PRICES).map((k, i) => [k, i]));
const MINT_RANK = new Map(MINT_KEYS.map((k, i) => [k, i]));
export function sellSortRank(key) {
  const basic = BASIC_RANK.get(key);
  if (basic != null) return basic;
  const evo = EVO_RANK.get(key);
  if (evo != null) return 100 + evo;
  const mint = MINT_RANK.get(key);
  if (mint != null) return 500 + mint;
  const ex = evoExclusivePool().indexOf(key);
  if (ex >= 0) return 1000 + ex;
  return 5000;
}

let _exclusiveNames = null; // 专属道具名单，由 ensureEvoMeta 异步注入

// 通用道具有基础价，形态道具（专属道具）按整类权重平摊
const exclusivePool = () => (_exclusiveNames || []).filter((n) => EVO_PRICES[n] == null);
export const evoExclusivePool = () => exclusivePool();
// 掉落池：派遣与钓鱼共用（通用进化道具 + 形态专属道具 + 薄荷）
export const evoDropPool = () => [...Object.keys(EVO_PRICES), ...exclusivePool(), ...MINT_KEYS];

// 进化表只拉一次：注入图标名、形态编号、专属道具名单
let _evoMeta = null;
export function ensureEvoMeta() {
  if (!_evoMeta) {
    _evoMeta = import('./evolution.js').then(async (m) => {
      await m.loadEvolution();
      _exclusiveNames = m.evoExclusiveNames();
      setExclusiveIcons(m.evoExclusiveIcons());
      setExclusiveForms(m.evoExclusiveForms());
    }).catch(() => { _exclusiveNames = null; }); // 表加载失败就只剩通用道具
  }
  return _evoMeta;
}

// 货架抽池：通用道具（各自权重）+ 专属道具（整类权重）+ 薄荷（整类权重，21 种平分）
function evoCandidates() {
  const list = Object.entries(EVO_SHOP_WEIGHTS).map(([id, w]) => [id, w]);
  const pool = exclusivePool();
  if (pool.length) {
    const each = EVO_SHOP_EXCLUSIVE_WEIGHT / pool.length;
    for (const n of pool) list.push([n, each]);
  }
  const eachMint = EVO_SHOP_MINT_WEIGHT / MINT_KEYS.length;
  for (const n of MINT_KEYS) list.push([n, eachMint]);
  return list;
}

function pickWeightedId(cands) {
  const total = cands.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of cands) { r -= w; if (r < 0) return id; }
  return cands[cands.length - 1][0];
}

// 跨天或首次进店时重抽，当天不变（存档 gameData.evoShop = { date, ids, sold }）
export function ensureEvoShop() {
  const today = evoDateStr();
  if (gameData.evoShop?.date === today && Array.isArray(gameData.evoShop.ids)) {
    if (!Array.isArray(gameData.evoShop.sold)) gameData.evoShop.sold = [];
    return gameData.evoShop;
  }
  const ids = [];
  // 保底格：一定从专属道具里出
  for (let i = 0; i < Math.min(EVO_SHOP_EXCLUSIVE_SLOTS, EVO_SHOP_DAILY); i++) {
    const pool = exclusivePool().filter((id) => !ids.includes(id)).map((id) => [id, 1]);
    if (!pool.length) break;
    ids.push(pickWeightedId(pool));
  }
  while (ids.length < EVO_SHOP_DAILY) { // 其余格子：通用 + 专属按权重混抽
    const cands = evoCandidates().filter(([id]) => !ids.includes(id));
    if (!cands.length) break;
    ids.push(pickWeightedId(cands));
  }
  gameData.evoShop = { date: today, ids, sold: [] };
  saveGame();
  return gameData.evoShop;
}

// 商店详情卡片的数据
export function itemDetailOf(key) {
  return {
    badgeHtml: `<img class="shop-icon" src="${itemIconSrc(key)}" alt="">`,
    title: ITEM_NAMES[key] || key,
    statsHtml: '',
    desc: itemDescOf(key),
  };
}

// 商店的「今日道具」区块（买完只改那一行，不重建整页）
export async function renderShopEvoSection(box, { onBought, onDetail } = {}) {
  if (!box) return;
  await ensureEvoMeta();
  const shop = ensureEvoShop();
  const candy = gameData.items['candy'] || 0;
  const sold = shop.sold || [];
  const row = (id) => {
    const price = evoBasePrice(id);
    const bought = sold.includes(id);
    const enough = candy >= price;
    return `<div class="shop-item" data-evo="${encodeURIComponent(id)}">
      <div class="shop-item-left">
        <img src="${evoIconSrc(id)}" class="shop-icon" alt="${id}" />
        <span class="shop-item-name">${ITEM_NAMES[id] || id}</span>
      </div>
      <div class="shop-item-right">
        <span class="shop-cost"${bought ? ' style="opacity:0.5"' : ''}><img src="./items/goods/candy.png" style="width:14px;height:14px;vertical-align:middle;image-rendering:pixelated;" /> ×${price}</span>
        <span class="shop-btn${bought ? ' inert' : (enough ? '' : ' inert')}">${bought ? '已售罄' : '购买'}</span>
      </div>
    </div>`;
  };
  box.innerHTML = `<div class="shop-tm-head"><span>今日道具</span><span>每件限 1 个</span></div>`
    + (shop.ids.length ? shop.ids.map(row).join('') : '<div class="rec-empty">今日没有新货</div>');

  box.onclick = (e) => {
    const item = e.target.closest('.shop-item[data-evo]');
    if (!item) return;
    e.stopPropagation(); // 别被商店的道具兑换逻辑接走
    const id = decodeURIComponent(item.dataset.evo);
    const btn = e.target.closest('.shop-btn');
    if (!btn) { onDetail?.(itemDetailOf(id)); return; } // 点条目本身 → 详情卡片
    if (btn.classList.contains('inert')) {
      if (btn.textContent === '已售罄') onDetail?.(itemDetailOf(id)); // 售罄时点按钮也给卡片
      return;
    }
    const shop = ensureEvoShop();
    if ((shop.sold || []).includes(id)) return;
    const price = evoBasePrice(id);
    if ((gameData.items['candy'] || 0) < price) return;
    gameData.items['candy'] -= price;
    grantItem(id, 1, '商店');
    shop.sold = [...(shop.sold || []), id];
    saveGame();
    // 原地改这一行：按钮变已售罄、糖果数刷新
    btn.classList.add('inert');
    btn.textContent = '已售罄';
    const costEl = item.querySelector('.shop-cost');
    if (costEl) costEl.style.opacity = '0.5';
    onBought?.();
  };
}

// ---------- 每日神兽池 ----------
// 每天给每个地区分几只神兽/幻兽：按该地区神兽数量浮动，多的多分、少的至少 1 只，当天池内不重复。
// 遇敌时由 battle.js 掷一次极低概率，命中才从当天池里抽；表随 __refreshAll() 的 clearDailyStock() 清掉
export function ensureLegendPool() {
  const today = evoDateStr();
  if (gameData.legendPool && gameData.legendPool.date === today) return gameData.legendPool;
  const byRegion = {};
  for (const p of allPokemon) {
    if (!p.legend || isPowerForm(p) || BREED_ONLY_IDS.includes(String(p.index))) continue;
    (byRegion[p.region] = byRegion[p.region] || []).push(String(p.index));
  }
  const picked = {};
  for (const [region, list] of Object.entries(byRegion)) {
    const n = Math.min(list.length, Math.max(1, Math.round(list.length / LEGEND_POOL_DIVISOR)));
    const bag = [...list];
    for (let i = bag.length - 1; i > 0; i--) { const j = randInt(0, i); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    picked[region] = bag.slice(0, n);
  }
  gameData.legendPool = { date: today, byRegion: picked };
  saveGame();
  return gameData.legendPool;
}

// 遇敌时掷一次：命中就从当天这个地区的池里抽一只；软保底到点必出
export function rollLegendEncounter() {
  const pool = ensureLegendPool();
  const list = pool.byRegion[getCurrentRegion().name] || [];
  if (!list.length) return null;
  const rate = (honeyBuffActive || charmBuffActive) ? LEGEND_ENCOUNTER_RATE_BUFF : LEGEND_ENCOUNTER_RATE;
  if ((gameData.legendPity || 0) < LEGEND_PITY && Math.random() >= rate) {
    gameData.legendPity = (gameData.legendPity || 0) + 1;
    return null;
  }
  gameData.legendPity = 0;
  return getPokemonByIndex(list[randInt(0, list.length - 1)]) || null;
}

// 清掉每日限量货与每日神兽池（{ date, ids } 或 { date, byRegion }），__refreshAll() 用它做调试刷新
export function clearDailyStock() {
  let n = 0;
  for (const k of Object.keys(gameData)) {
    const v = gameData[k];
    if (v && typeof v === 'object' && typeof v.date === 'string' && (Array.isArray(v.ids) || v.byRegion)) {
      gameData[k] = null;
      n++;
    }
  }
  return n;
}

// 招式机图标（属性 → src/items/tm/ 下的文件）；妖精官方那版没有，先用超能图标占位
export const TM_ICONS = {
  '一般': 'tm/tm-normal.png', '格斗': 'tm/tm-fighting.png', '飞行': 'tm/tm-flying.png', '毒': 'tm/tm-poison.png',
  '地面': 'tm/tm-ground.png', '岩石': 'tm/tm-rock.png', '虫': 'tm/tm-bug.png', '幽灵': 'tm/tm-ghost.png',
  '钢': 'tm/tm-steel.png', '火': 'tm/tm-fire.png', '水': 'tm/tm-water.png', '草': 'tm/tm-grass.png',
  '电': 'tm/tm-electric.png', '超能': 'tm/tm-psychic.png', '冰': 'tm/tm-ice.png', '龙': 'tm/tm-dragon.png',
  '恶': 'tm/tm-dark.png', '妖精': 'tm/tm-fairy.png',
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
// 避免同一宝可梦的多形态（未知图腾 28 字母、彩粉蝶 20 花纹等）叠加放大出现概率
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

export function pickWeightedPokemon(rarityBoost, pool, weightMul) {
  const source = pool || allPokemon;
  if (source.length === 0) return null;
  const penalty = Math.max(0.2, 0.8 - rarityBoost * 0.5); // 正常 0.8，蜜 0.65，护符 0.55
  // 三次方：线性权重下神兽只比常见稀有 3 倍（护符 1.6 倍），压平了稀有度梯度
  // weightMul：可选权重回调（随从的扭曲池偏置等按物种加权）
  return pickFamily(source, p => Math.pow(Math.max(0.01, 1 - (p.rarity ?? 0.5) * penalty), 3) * (weightMul ? weightMul(p) : 1));
}

export function pickRandomPokemon() {
  if (allPokemon.length === 0) return null;
  const region = getCurrentRegion();
  const pool = allPokemon.filter(p => p.region === region.name && !p.legend && !isPowerForm(p) && !isWildExcluded(p)); // 神兽与强化形态不进普通遇敌池
  if (pool.length === 0) return null;
  let rarityBoost = 0;
  if (honeyBuffActive) rarityBoost = Math.max(rarityBoost, HONEY_RARITY_BOOST);
  if (charmBuffActive) rarityBoost = Math.max(rarityBoost, CHARM_RARITY_BOOST);
  return pickWeightedPokemon(rarityBoost, pool);
}

// 孵蛋：全图鉴纯随机，不受地区限制、无稀有度加权（神兽与强化形态除外）
export function pickAnyPokemon() {
  const pool = allPokemon.filter(p => !p.legend && !isPowerForm(p));
  if (pool.length === 0) return null;
  return pickFamily(pool, () => 1);
}

// 树果方块：当前地区中 foods 与配方完全一致的宝可梦；神兽/幻兽不吃方块，免得抓到一只后无限召唤刷闪光
export function findBerryTarget(recipe) {
  if (!Array.isArray(recipe) || recipe.length === 0) return null;
  const region = getCurrentRegion();
  const sorted = [...recipe].sort((a, b) => a - b);
  return allPokemon.find(p =>
    p.region === region.name &&
    !p.legend &&
    !isPowerForm(p) &&
    !isWildExcluded(p) &&
    Array.isArray(p.foods) &&
    p.foods.length === sorted.length &&
    sorted.every(s => p.foods.includes(s))
  ) || null;
}

// 掉落提示互斥恢复定时器（获得道具时短暂显示掉落信息，之后恢复自动模式状态）
let _dropStatusTimer = null;

// 掉落糖果的数量倍率：按 CANDY_DROP_MULT 权重抽一次（掉落发生时即确定）
export function rollCandyMult() {
  const total = CANDY_DROP_MULT.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const c of CANDY_DROP_MULT) {
    r -= c.weight;
    if (r <= 0) return c.mult;
  }
  return 1;
}

// 道具入库：背包/统计/日志统一处理（qty 支持糖果翻倍掉落）
// from 是来源标签（如 '派遣' / '悬赏'），日志渲染成「【派遣】获得 糖果 ×120」，方便看清来源
export function grantItem(itemKey, qty = 1, from = null) {
  gameData.items[itemKey] = (gameData.items[itemKey] || 0) + qty;
  gameData.stats.totalItemsEarned[itemKey] = (gameData.stats.totalItemsEarned[itemKey] || 0) + qty;
  addSystemLog('item_gain', { item: itemKey, qty, from: from || null });
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
// 取消面前这件道具的演出。opts.collect=true 表示照常收下：
// 道具在生成时已从累积值扣掉，白白取消等于没收玩家的东西）
// 路面上是否已有一件正在滚入/等待拾取的道具（主循环按记录恢复前先问一句）
export function hasActiveDrop() { return !!_dropCancelCb; }

export function cancelItemDrop(opts = {}) {
  if (!_dropCancelCb) return false;
  _dropCancelCb(opts);
  return true;
}

// 生成道路掉落实体并播放滚动/拾取动画。返回是否真正生成（false 表示本次未生成，
// 由调用方把累积值保留，避免道具丢失）；后台（非主界面）直接入账也算成功。
// opts.qty / opts.remaining：恢复存档里那一件时沿用原数量倍率与剩余距离
export function spawnItemDrop(itemKey, opts = {}) {
  if (phase !== 'idle') return false;
  // 掉落糖果时先确定本次数量倍率（×1/×2/×5/×50/×100）
  const qty = opts.qty != null ? opts.qty : (itemKey === 'candy' ? rollCandyMult() : 1);
  const screen = $('screen');
  const charEl = $('walkGif');
  if (!screen || !charEl) return false;

  // 页面真的不可见（切后台/最小化/WebView 切走）：后台直接入账，不播滚动/拾取动画。
  // 注意这里不再判断"舞台屏是否可见"——单屏下开着 app 页只是看不到舞台，掉落照常滚动拾取
  if (isPageHidden()) {
    grantItem(itemKey, qty);
    // 已即时入账：清掉恢复记录。否则主循环每 tick 都会按这条记录再发一次，变成每秒白送一件
    if (gameData.roadItem && gameData.roadItem.key === itemKey) gameData.roadItem = null;
    saveGame(); // 后台入账立即存档，避免依赖 30 秒周期存档导致刷新丢日志/丢道具
    return true;
  }

  if (_itemDropActive) return false;

  setItemDropActive(true);

  const el = document.createElement('img');
  el.className = 'item-fly';
  el.src = itemIconSrc(itemKey);
  el.alt = ITEM_NAMES[itemKey] || itemKey;
  screen.appendChild(el);
  _dropEl = el;
  _dropCancelCb = (opts = {}) => {
    if (!_dropCancelCb) return;
    _dropCancelCb = null;
    _dropEl = null;
    active = false;
    road.removeStepper(step);
    road.removeRender(render);
    el.remove();
    setItemDropActive(false);
    gameData.roadItem = null; // 演出已结束：不再恢复这一件
    // 清场但照常收下：直接入账并记掉落日志
    if (opts.collect) grantItem(itemKey, qty);
    saveGame();
    if (phase === 'idle') { setIdleCharacter('walk'); road.resume(); }
  };

  // 动画受理成功：后续由 step/fly 驱动滚动与拾取入账，这里返回 true 让调用方扣减累积值
  // （否则累积值永不扣减，糖果等高频道具会一直出动画）

  // 几何快照：生成时算一次；窗口尺寸变化（旋转/缩放）后由 refreshGeometry 重算，
  // 避免拾取阈值/高度参照一直用旧尺寸
  let sRect = screen.getBoundingClientRect();
  let cRect = charEl.getBoundingClientRect();
  let charLeft = cRect.left - sRect.left;

  // 物品放在路面上
  const roadEl = document.querySelector('.road-layer');
  let rRect = roadEl ? roadEl.getBoundingClientRect() : cRect;
  let itemY = (rRect.top - sRect.top) + 24;

  let itemX = sRect.width + 10;
  let pickupX = charLeft + 10;
  // 恢复存档里的这一件：按剩余距离摆在主角前方，超屏宽则退回右缘
  if (opts.remaining != null) {
    itemX = Math.min(pickupX + Math.max(0, opts.remaining), sRect.width + 10);
  }
  // 路面上的这一件落档：退出/被杀进程后按同一件同剩余距离继续，
  // 否则累积值已扣、道具却随进程消失
  gameData.roadItem = { key: itemKey, qty, left: Math.max(0, Math.round(itemX - pickupX)) };
  saveGame();
  el.style.left = itemX + 'px';
  el.style.top = itemY + 'px';
  el.style.opacity = '1';

  let cTop = cRect.top - sRect.top;
  let _geomW = window.innerWidth;
  let _geomH = window.innerHeight;
  let active = true;

  function refreshGeometry() {
    if (window.innerWidth === _geomW && window.innerHeight === _geomH) return;
    _geomW = window.innerWidth;
    _geomH = window.innerHeight;
    sRect = screen.getBoundingClientRect();
    cRect = charEl.getBoundingClientRect();
    charLeft = cRect.left - sRect.left;
    rRect = roadEl ? roadEl.getBoundingClientRect() : cRect;
    itemY = (rRect.top - sRect.top) + 24;
    pickupX = charLeft + 10;
    cTop = cRect.top - sRect.top;
  }

  function cleanup() {
    active = false;
    _dropCancelCb = null;
    _dropEl = null;
    road.removeStepper(step);
    road.removeRender(render);
    el.remove();
    setItemDropActive(false);
    gameData.roadItem = null; // 滑出屏/异常回收：这一件不再恢复
    saveGame();
    if (phase === 'idle') { setIdleCharacter('walk'); road.resume(); }
  }

  // 世界步（每步一次，与路面同速）：位置推进 + 拾取判定
  function step(spd) {
    if (!active) return;
    // 舞台不可见（单屏下开着 app 页）不冻结：与双屏一致，照常滚动与拾取，看不见只是看不见
    itemX -= spd;
    // 剩余距离只写内存：随周期存档 / 切后台落盘，恢复时就能停在退出时的位置附近
    if (gameData.roadItem) gameData.roadItem.left = Math.max(0, Math.round(itemX - pickupX));

    if (itemX > sRect.width + 100) { cleanup(); return; } // 兜底：异常位置直接回收

    if (road.isBike()) {
      // 骑行：道具继续随路面左移但不拾取，滑出屏幕即回收
      if (itemX < -40) cleanup();
      return;
    }

    if (itemX <= pickupX) {
      active = false;
      _dropCancelCb = null; // 已判定为拾取：后续不能再被"取消"打断（避免重复入账）
      road.removeStepper(step);
      road.removeRender(render);
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

        const isIdleView = isIdleStageVisible();
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
          gameData.roadItem = null; // 已拾取：清档
          grantItem(itemKey, qty);
          saveGame(); // 拾取入账立即存档，避免刷新时丢失最新掉落日志/道具
          showIdlePickup(ITEM_NAMES[itemKey], road.getPlace());
        }
      })(performance.now());
      return;
    }
  }

  // 每帧渲染（不推进世界）：写位置与显隐
  function render() {
    if (!active) return;
    refreshGeometry();
    if (!isIdleStageVisible() || !road.isActive()) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.left = road.snapPx(itemX) + 'px'; // 对齐设备像素：像素材质不因小数偏移反复重采样
  }

  setIdleCharacter('walk');
  road.addStepper(step);
  road.addRender(render);
  return true;
}

// 蛋壳精灵：属性版加载失败（图缺失）时回退到基础版 hatch.png
async function resolveHatchSprite(src) {
  const base = './items/eggs/hatch.png';
  if (src === base) return src;
  const ok = await new Promise((res) => {
    const im = new Image();
    im.onload = () => res(true);
    im.onerror = () => res(false);
    im.src = src;
  });
  return ok ? src : base;
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

// 孵化结果落库公共部分（单只/批量共用）：图鉴/仓库/遭遇日志/统计/孵蛋记录，并清空该槽位。
// 只整理存档数据，不涉及任何 DOM 展示。presetGender：批量孵化动画已预判的性别，神秘蛋建档时沿用保证显示一致。
function applyHatchEntry(slotIndex, presetGender) {
  const slot = gameData.incubators[slotIndex];
  if (!slot) return;
  const poke = getPokemonByIndex(slot.eggIndex);
  if (!poke) return;
  const idx = String(poke.index);
  const eggIsShiny = slot.isShiny || false;

  if (!gameData.pokedex[idx]) {
    gameData.pokedex[idx] = { seen: 0, caught: 0, lastTime: null, shinySeen: 0, shinyCaught: 0, };
  }
  gameData.pokedex[idx].seen++;
  gameData.pokedex[idx].caught = (gameData.pokedex[idx].caught || 0) + 1;
  gameData.pokedex[idx].lastTime = new Date().toISOString();
  if (eggIsShiny) {
    gameData.pokedex[idx].shinySeen = (gameData.pokedex[idx].shinySeen || 0) + 1; // 孵出闪光也算见过，野外再遇不再提示新发现
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
  if (!entry) entry = addRosterEntry({ species: poke.index, shiny: eggIsShiny, source: 'egg', gender: presetGender || undefined });
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

  addSystemLog('egg_hatch', { pokemon: poke.index, shiny: eggIsShiny });
  // 孵蛋记录：仅记录时间/名字/性别（性别沿用蛋条目，神秘蛋为建档时 roll 的结果）
  addIncubatorLog({ species: poke.index, gender: entry.gender, shiny: eggIsShiny });

  gameData.incubators[slotIndex] = { eggIndex: null, hatched: false, hatchStart: 0, hatchDuration: 0, isShiny: false };
}

// ---------- 从孵蛋器取出孵化 ----------
export async function hatchFromIncubator(slotIndex) {
  if (_eggHatching) return;
  if (phase === 'battle' || phase === 'eggResult') return;                      // NPC 对战 / 孵蛋结果期间禁止孵化
  if (isEvolutionShowActive()) return;                                        // 进化演出期间禁止孵化（不再往演出上叠一层）
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

  // 蛋壳精灵：培育蛋用属性配色版，神秘蛋用基础版；属性图缺失时回退基础版
  const hatchSrc = await resolveHatchSprite(hatchSprite(slot.eggRef ? poke.types?.[0] : null));
  const tmp = new Image();
  tmp.src = hatchSrc;
  await new Promise(r => { tmp.onload = r; tmp.onerror = r; });
  const frameW = tmp.naturalWidth;
  const frameH = tmp.naturalHeight / 4;

  const displayW = 80;
  const displayH = displayW * (frameH / frameW);

  const sprite = document.createElement('div');
  sprite.id = 'hatchGif';
  sprite.className = 'encounter-gif';
  sprite.style.cssText = `
    background-image: url(${hatchSrc});
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
    updateTextBox('蛋在微微晃动...', false, 'app');
  });

  // 第二帧 — 蛋裂
  if (watchedAnim) await hatchFrame(300, () => { sprite.className = 'encounter-gif'; });
  if (watchedAnim) await hatchFrame(350, () => { sprite.style.backgroundPosition = `0 -${displayH}px`; });

  // 第三帧 — 裂缝更大
  if (watchedAnim) await hatchFrame(350, () => {
    sprite.style.backgroundPosition = `0 -${displayH * 2}px`;
    updateTextBox('蛋裂开了！', false, 'app');
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
    // 闪光蛋加载 _shiny 贴图，与图鉴/批量孵化保持一致
    await tryLoadPokemonImage(img, poke, eggIsShiny ? '_shiny' : '').then(ok => { imageLoaded = ok; });

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

  // 闪光蛋：出场动画结束后播放闪光音效并爆发星星粒子（与批量/图鉴同款）；
  // 等闪光音效播完再继续（后续庆祝音乐会紧接着播放，避免两音叠加）
  if (eggIsShiny && isOnHatchView()) {
    burstShinySparkle($('hatchView'), img, { cls: 'sm', scale: 0.9 });
    const a = playShiny();
    if (a) {
      await new Promise(r => {
        const done = () => r();
        a.addEventListener('ended', done, { once: true });
        a.addEventListener('error', done, { once: true });
        setTimeout(done, 3000); // 兜底：音效加载/播放异常时不能卡死孵化流程
      });
    }
  }

  $('hatchTypes').style.display = 'none';
  // 新发现标记（普通/闪光分开）
  const existingEntry = gameData.pokedex[idx];
  const isNewDiscovery = !existingEntry
    ? true
    : eggIsShiny ? existingEntry.shinySeen === 0 : existingEntry.seen === 0;
  const newLabel = $('hatchNewLabel');
  if (newLabel) newLabel.style.display = isNewDiscovery ? '' : 'none';

  // 已拥有标记（普通/闪光分开）：抓到过或进化/孵蛋得到过
  const alreadyOwned = eggIsShiny ? dexShinyOwned(idx) : dexUnlocked(idx);
  $('hatchOwnedWrap').style.display = alreadyOwned ? '' : 'none';
  if (alreadyOwned) {
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

  applyHatchEntry(slotIndex);

  // 左上角显示孵化出的宝可梦全名 + 性别图标（建档后读取，性别与实际存档一致；右上角保留已拥有/稀有度/新发现）
  const hatchEntry = (gameData.roster || []).find(r => r.id === getLastObtainedEntryId());
  const hatchGender = hatchEntry ? ensureGender(hatchEntry) : 'genderless';
  $('hatchName').innerHTML = poke.name + genderBadge(hatchGender);
  $('hatchName').style.display = '';

  // 玩家仍在本页才播放祝贺音效（已切走则后台静默结算，避免音效打断其他页面背景曲）
  if (isOnHatchView()) playCongratulation();

  if (isOnHatchView()) updateTextBox(eggIsShiny ? '孵化出闪光的 ' + poke.name + ' 了！' : '孵化成功！获得了 ' + poke.name, true, 'app');

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

// ---------- 孵化全部：一次孵化所有已就绪的蛋 ----------
// 独立页面 hatchAllView：全部蛋同屏展示（≤6 只一行 3 个、7~8 只一行 4 个，两行居中），
// 逐个播放破壳动画 → 宝可梦大图 + 名字（依次进行），全部完成后弹底部确认条
// （同时播放与单只孵化同款的祝贺音效），确认后收起页面回孵蛋器。
// 播放中点画面 = 跳过剩余破壳动画，剩下的蛋直接出结果
let _hatchAllSkip = false;     // 本次批量是否已点画面跳过
let _hatchAllRunning = false;  // 批量序列是否在播（只有播放中才响应点击）
let _hatchAllWait = null;      // 当前等待的延时（跳过时立刻放行）
let _hatchAllSkipBound = false;
function bindHatchAllSkip() {
  if (_hatchAllSkipBound) return;
  const view = $('hatchAllView');
  if (!view) return;
  _hatchAllSkipBound = true;
  view.addEventListener('click', () => {
    if (!_hatchAllRunning || _hatchAllSkip) return;
    _hatchAllSkip = true;
    if (_hatchAllWait) _hatchAllWait();
  });
}
// 可跳过的等待：点了画面就立刻返回
function hatchDelay(ms) {
  if (_hatchAllSkip) return Promise.resolve();
  return new Promise((res) => {
    const timer = setTimeout(() => { _hatchAllWait = null; res(); }, ms);
    _hatchAllWait = () => { clearTimeout(timer); _hatchAllWait = null; res(); };
  });
}
export async function hatchAllFromIncubator() {
  if (_eggHatching) return;
  if (phase === 'battle' || phase === 'eggResult') return;                      // NPC 对战 / 孵蛋结果期间禁止孵化
  if (isEvolutionShowActive()) return;                                        // 进化演出期间禁止孵化（不再往演出上叠一层）
  if (phase !== 'idle' && phase !== 'encounter' && phase !== 'caught' && phase !== 'fled') return;
  const incubators = gameData.incubators;
  if (!incubators || !incubators.length) return;
  const slots = [];
  for (let i = 0; i < Math.min(incubators.length, 8); i++) {
    // 忽略只影响提醒，不影响孵化：批量孵化仍包含全部已就绪的蛋
    if (incubators[i] && incubators[i].hatched) slots.push(i);
  }
  if (!slots.length) return;
  // 只有一个蛋时走单只孵化路径（复用 hatchView 页面），不进入批量专属页面
  if (slots.length === 1) {
    await hatchFromIncubator(slots[0]);
    return;
  }
  suspendEncounterForEgg();

  setEggHatching(true);

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

  setPhase('eggResult');
  showView('hatchAllView');

  // 网格：统一一行 4 个，小格子两行放完（≤4 只一行，5~8 只两行）
  const view = $('hatchAllView');
  const grid = $('hatchAllGrid');
  grid.innerHTML = '';

  const cells = [];
  for (const slotIdx of slots) {
    const poke = getPokemonByIndex(incubators[slotIdx].eggIndex);
    if (!poke) continue;
    const cell = document.createElement('div');
    cell.className = 'hatch-all-cell';
    cell.innerHTML = '<div class="hatch-all-stage"></div><div class="hatch-all-name"></div>';
    grid.appendChild(cell);
    cells.push({ slot: slotIdx, poke, eggShiny: !!(incubators[slotIdx].isShiny), stage: cell.firstElementChild, nameEl: cell.lastElementChild });
  }
  if (!cells.length) {
    setEggHatching(false);
    // 无有效蛋时仍要恢复挂起遭遇 / 回空闲
    if (restoreSuspendedEncounter()) {
      renderIncubatorView();
    } else {
      const m = await import('./battle.js');
      m.goIdle();
    }
    showView('incubatorView');
    renderIncubatorView();
    return;
  }

  // 依次孵化：每只播放破壳动画 → 大图出现 → 显示名字后立即落库；点画面跳过剩余演出
  _hatchAllSkip = false;
  _hatchAllRunning = true;
  bindHatchAllSkip();
  for (let k = 0; k < cells.length; k++) {
    const { slot, poke, eggShiny, stage, nameEl } = cells[k];
    const cellGender = hatchCellGender(incubators[slot], poke); // 预判性别：动画与建档共用，保证显示一致
    const cellHatchSrc = await resolveHatchSprite(hatchSprite(incubators[slot].eggRef ? poke.types?.[0] : null));
    await playHatchAllCell(stage, poke, eggShiny, nameEl, cellGender, cellHatchSrc);
    applyHatchEntry(slot, cellGender); // 名字/闪光星标/性别/粒子已随图片在 playHatchAllCell 内同步出现
    await saveGame(); // 每只完成后落盘，中途崩溃也不丢已孵化结果
    if (k < cells.length - 1) await hatchDelay(180);
  }
  _hatchAllRunning = false;
  await saveGame();
  updateStats();
  updateIncubatorBadge();
  setEggHatching(false);

  // 立即恢复挂起遭遇 / 回空闲：确认离开时只剩纯同步收尾，避免点击后卡住
  if (restoreSuspendedEncounter()) {
    // 有挂起遭遇：恢复现场后停留在孵蛋器，玩家稍后回游戏页继续
  } else {
    const m = await import('./battle.js');
    m.goIdle();
  }

  // 完成后弹确认条（与单只同款祝贺音效），点确定即可离开批量页回孵蛋器。
  // singleButton 模式：只保留「确定」一个按钮，无需取消
  playCongratulation();
  showConfirmBar(`孵化全部完成！共获得 ${cells.length} 只宝可梦`, () => { leaveHatchAllPage(); }, null, { host: view, singleButton: true });
}

// 批孵性别预判：蛋条目（eggRef）用其孵化时已定的性别；神秘蛋先 roll 一次性别，
// 由 applyHatchEntry 建档时沿用（传给 addRosterEntry），保证动画里显示的性别与存档一致
function hatchCellGender(slot, poke) {
  if (slot.eggRef) {
    const e = (gameData.roster || []).find(r => r.id === slot.eggRef);
    if (e) return ensureGender(e);
  }
  return rollGender(poke.index);
}

// 单个蛋的完整孵出流程：直接从蛋裂一帧开始快速播放破壳动画 → 宝可梦大图从蛋中心缩放出现
// nameEl 传入后与图片同步显示名字（名字后跟性别图标，闪光时性别左侧追加雪碧图星标）
// 已点画面跳过：不建蛋壳、不走缩放，直接把大图 + 名字摆出来
async function playHatchAllCell(stage, poke, eggShiny, nameEl, gender, hatchSrc) {
  if (!_hatchAllSkip) {
    // 蛋精灵：培育蛋用属性配色版，神秘蛋用基础版（hatch.png 竖排 4 帧）
    const tmp = new Image();
    tmp.src = hatchSrc;
    await new Promise(r => { tmp.onload = r; tmp.onerror = r; });
    const frameW = tmp.naturalWidth;
    const frameH = tmp.naturalHeight / 4;
    const displayW = 48;
    const displayH = displayW * (frameH / frameW);
    const sprite = document.createElement('div');
    sprite.className = 'hatch-all-egg';
    sprite.style.cssText = `
      background-image: url(${hatchSrc});
      background-size: ${displayW}px ${displayH * 4}px;
      background-position: 0 0;
      background-repeat: no-repeat;
      width: ${displayW}px; height: ${displayH}px;
      image-rendering: pixelated;
    `;
    stage.appendChild(sprite);

    // 跳过摇晃帧，直接从蛋裂开始快速连播（帧率高、节奏紧凑）
    await hatchDelay(120);
    sprite.style.backgroundPosition = `0 -${displayH}px`; // 蛋裂
    await hatchDelay(150);
    sprite.style.backgroundPosition = `0 -${displayH * 2}px`; // 裂缝更大
    await hatchDelay(160);
    sprite.style.backgroundPosition = `0 -${displayH * 3}px`; // 破壳
    await hatchDelay(100);
    sprite.remove();
  }

  // 宝可梦大图出现（缩放 + 淡入）。尺寸不设固定值，交给 .hatch-all-stage img 的
  // max-width/max-height 自适应各列宽高，避免大图溢出格子与邻近内容重叠
  const img = document.createElement('img');
  img.style.opacity = '0';
  img.style.objectFit = 'contain';
  stage.appendChild(img);
  const loaded = await tryLoadPokemonImage(img, poke, eggShiny ? '_shiny' : '');
  if (!loaded) {
    img.style.width = '100%';
    img.style.height = '100%';
  }
  // 图片出场的同时显示名字（名字 → 闪光星标 → 性别图标）并爆发闪光粒子
  const showName = () => {
    if (!nameEl) return;
    let nameHtml = `<span>${poke.name}</span>`;
    if (eggShiny) {
      nameHtml += '<svg viewBox="0 0 1024 1024" width="8" height="8" style="flex-shrink:0;color:var(--ui-color);vertical-align:0px;"><use xlink:href="#icon-star"/></svg>';
      burstShinySparkle($('hatchAllView'), stage, { cls: 'sm', scale: 0.9 }); // 以蛋格为爆点同步爆发
      playShiny(); // 闪光登场音效（批量无需等待，庆祝在全部播完后统一播放）
    }
    nameHtml += genderBadge(gender, 8);
    nameEl.innerHTML = nameHtml;
  };
  if (_hatchAllSkip) {
    img.style.opacity = '1';
    showName();
    return;
  }
  img.style.transform = 'translate(-50%, -50%) scale(0)';
  void img.offsetHeight;
  showName();
  const dur = 250;
  await animate(dur, t => {
    img.style.transform = `translate(-50%, -50%) scale(${t < 0.15 ? t / 0.15 : 1})`;
    img.style.opacity = t < 0.2 ? t / 0.2 : 1;
  });
  img.style.transform = '';
}

// 离开孵化全部页：批量动画播完后恢复遭遇/回空闲已在 hatchAllFromIncubator 内完成，
// 此处仅收起确认条并回孵蛋器（纯同步收尾，确认后立即生效）
export function leaveHatchAllPage() {
  if (_eggHatching) return; // 动画进行中锁定（goBack 触达处已被导航锁拦截，双保险）
  hideConfirmBar();
  stopCongratulation();
  showView('incubatorView');
  renderIncubatorView();
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
    showShopView({ keepScroll: true });
  }
}

// 商店出售道具换糖果（与兑换对称）：扣道具加糖。
// 价格必须走统一的 sellPriceOf()——只查 CANDY_EXCHANGE 的话，进化道具/专属道具/经验糖果会被算成 0 价而卖不掉
export async function doSellBall(itemKey, qty = 1) {
  const price = sellPriceOf(itemKey);
  if (!price || qty <= 0) return;
  if ((gameData.items[itemKey] || 0) < qty) return;
  gameData.items[itemKey] -= qty;
  gameData.items['candy'] = (gameData.items['candy'] || 0) + price * qty;
  addSystemLog('shop_sell', { item: itemKey, qty, gain: price * qty });
  updateBackpack(itemKey);
  updateStats();
  if ($('shopView')?.style.display === 'flex') {
    const { showShopView } = await import('./views.js');
    showShopView({ keepScroll: true });
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
  saveGame(); // 立即落盘：强杀进程也能靠主存档的 buff 记录续上
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
  setCharmGuaranteed(true); // 保底：下一只遭遇必定闪光（不然 60 秒里遇不到闪会像白花钱）
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
  saveGame(); // 立即落盘：强杀进程也能靠主存档的 buff 记录续上
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
  saveGame(); // 清掉主存档里的 buff 记录，避免下次启动复活已到期的增益
}

export function handleCharmExpired() {
  setCharmBuffActive(false);
  setCharmGuaranteed(false);
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
  saveGame(); // 清掉主存档里的 buff 记录，避免下次启动复活已到期的增益
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

// ===== 重进游戏恢复生效中的增益 =====
// rec 来自会话存档或主存档的耐久记录；
// keepPaused：启动时正有遭遇要恢复，倒计时先挂起，等这场收尾由 resumeEncounterFlow 续上
function buffLeft(rec) {
  const left = Math.max(0, rec?.left || 0);
  const paused = Math.max(0, rec?.paused || 0);
  return { left, paused, total: left || paused };
}

export function restoreHoneyRecord(rec, keepPaused) {
  const { left, total } = buffLeft(rec);
  if (!rec || !total) {
    if (rec) { setHoneyBuffActive(false); clearHoneyCountdown(); }
    return;
  }
  setHoneyBuffActive(true);
  setHoneyPausedRemaining(0);
  setHoneyCountdownEnd(0);
  if (isIdleStageVisible() || !left) {
    $('idleText').textContent = '✦ 甜蜜蜜生效中 ✦';
    setIdleMsgIdx(-1);
    particles.stop();
    particles.start('rgba(255,215,0,1)', 'circle', { sizeMult: 0.7, alphaMult: 0.6 });
  }
  if (keepPaused) {
    setHoneyPausedRemaining(total);
    const slot = document.querySelector('.bag-slot[data-item="sweet-honey"]');
    if (slot) slot.classList.add('disabled');
    const qtyEl = document.getElementById('bag-sweet-honey');
    if (qtyEl) qtyEl.textContent = Math.ceil(total / 1000) + 's';
    return;
  }
  // 没有遭遇要等：余量接着跑，并补排遇敌与到期计时器
  setHoneyCountdownEnd(Date.now() + total);
  setNextEncounterTimer(setTimeout(async () => {
    const { tryEncounter } = await import('./battle.js');
    tryEncounter();
  }, rand(BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX) * 1000));
  setHoneyExpiryTimer(setTimeout(() => handleHoneyExpired(), total));
  if (isIdleStageVisible()) startHoneyCountdown();
}

export function restoreCharmRecord(rec, keepPaused) {
  if (rec?.count) setCharmEncounterCount(rec.count);
  if (rec) setCharmGuaranteed(!!rec.guaranteed);
  const { left, total } = buffLeft(rec);
  if (!rec || !total) {
    if (rec) { setCharmBuffActive(false); clearCharmCountdown(); }
    return;
  }
  setCharmBuffActive(true);
  setCharmPausedRemaining(0);
  setCharmCountdownEnd(0);
  if (isIdleStageVisible() || !left) {
    $('idleText').textContent = '✦ 闪耀护符生效中 ✦';
    setIdleMsgIdx(-1);
    particles.stop();
    particles.start('rgba(180,230,255,1)', 'star');
  }
  if (keepPaused) {
    setCharmPausedRemaining(total);
    const slot = document.querySelector('.bag-slot[data-item="shiny-charm"]');
    if (slot) slot.classList.add('disabled');
    const qtyEl = document.getElementById('bag-shiny-charm');
    if (qtyEl) qtyEl.textContent = Math.ceil(total / 1000) + 's';
    return;
  }
  setCharmCountdownEnd(Date.now() + total);
  setNextEncounterTimer(setTimeout(async () => {
    const { tryEncounter } = await import('./battle.js');
    tryEncounter();
  }, rand(BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX) * 1000));
  setCharmExpiryTimer(setTimeout(() => handleCharmExpired(), total));
  if (isIdleStageVisible()) startCharmCountdown();
}
