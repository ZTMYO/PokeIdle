// ===== 限时活动注册表 =====
// 写活动只改这个文件：键 = 服务端 activity.json 里那条的 id。
// 容器负责标题、倒计时、进出与"到点自动收起"，活动只管自己的界面和结算。
// 能用的东西都在 ctx 里（见 activity.js 的 ctxFor）：from / to / payload / slot / left / grant / take / confirm / save / refresh。
// 约定：改游戏状态一律走 ctx（grant / take），别的地方只读。

import { getPokemonByIndex, gameData, allPokemon, isPowerForm, isPokemon, isWildExcluded, POKEMON_NATURES } from './state.js';
import { tryLoadImage, tryLoadPokemonImage, showConfirmBar } from './ui.js';
import { itemIconSrc, MINT_KEYS, pickFamilyBySeed } from './items.js';
import { ITEM_NAMES, EVO_PRICES, eggSprite, ALCREMIE_DECOS, ALCREMIE_FLAVORS } from './config.js';
import { MG_LEVELS, levelOf } from './memory-game.js';
import { BG_LEVELS, bgLevelOf } from './bird-game.js';
import { FLOW_LEVELS, flowLevelOf } from './flow-game.js';
import { GUESS_LEVELS, guessLevelOf, guessReady } from './guess-game.js';
import { SW_LEVELS, swLevelOf } from './sweet-game.js';

const TIERS = 4;      // 四档：进化道具 / 薄荷·王冠 / 大师球·闪耀护符 / 闪光蛋
const PER_TIER = 3;   // 每档交 3 只（payload.perTier 可覆盖），四档共 12 只
const TIER_NAMES = ['奖励1', '奖励2', '奖励3', '奖励4'];
const perTierOf = ctx => Math.max(1, Number(ctx.payload && ctx.payload.perTier) || PER_TIER);
const tiersDone = ctx => Math.min(TIERS, Math.max(0, Number(ctx.slot && ctx.slot.tiers) || 0));

// 活动固定那一只：由活动种子从"全野池"里挑 —— 全服同一只，而且它在自己地区的路边池里
// 本来就会正常刷新，玩家任何时段都能去抓（不用赶某一小时的出没）
function wildPool() {
  return allPokemon.filter(p => !p.legend && !isPowerForm(p) && !isWildExcluded(p));
}
function targetPoke(ctx) {
  const poke = pickFamilyBySeed(wildPool(), seedOf(ctx));   // 多变体家族先折一簇，再在簇内定一只
  return poke && poke.index ? poke : null;
}

// 活动种子：payload.seed 这一个数决定"目标是哪只 + 奖励是什么"（同一份配置 → 全服完全一致），
// 改它就换一只、换一份奖励；老配置没写种子则退回用活动开始时刻，效果一样是全服同一份。
function seedOf(ctx) {
  const raw = (ctx.payload || {}).seed;
  const n = Number(raw);
  const s = raw != null && raw !== '' && Number.isFinite(n) ? n : null;   // 手写配置里写成字符串也认
  return strSeed(`${ctx.id}|${s != null ? s : Math.round(Number(ctx.from) || 0)}`);
}
// 字符串 → 32 位种子（FNV-1a）
function strSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// mulberry32：小而稳的种子随机
function rngFrom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
// ---- 奖励：四档各摇一件，全部由活动种子摇 ----
//   ① 进化道具 ×1（EVO_PRICES 里的通用道具；形态专属要等进化表加载，会把"全服一致"弄丢就不放）
//   ② 薄荷 / 王冠 ×1（21 种薄荷 + 银冠 + 金冠）
//   ③ 大师球 / 闪耀护符 ×1
//   ④ 闪光蛋 ×1
// 摇法固定成一条 r 流（谁先谁后写死），所以同一个种子在任何客户端都得到同一份结果。
// 结果存进活动存档槽做缓存，页面直接按它显示图标；领取时照发。
const EVO_REWARD_POOL = Object.keys(EVO_PRICES).filter(k => !k.endsWith('crown'));
const MINT_CROWN_POOL = [...MINT_KEYS, 'silver-crown', 'golden-crown'];
const RARE_POOL = ['master-ball', 'shiny-charm'];
const CROWN_POOL = ['silver-crown', 'golden-crown'];
const EGG_SPECIES_POOL = () => allPokemon.filter(p => !p.legend && !isPowerForm(p));   // 神兽与超级/超极巨形态不发蛋
const REWARD_V = 2;   // 奖励结构版本：v1 是三条槽，对不上就重摇（不用管老存档）

// 闪光蛋：物种可指定（payload.eggSpecies），留空就按种子从"除神兽与强化形态"里随机一只，
// 全服都是同一只蛋；个体值改成每个玩家自己摇（同一颗蛋，谁孵出什么个体看手气），性格仍按种子
function eggFrom(ctx, r) {
  const pick = list => list[Math.floor(r() * list.length)];
  const want = String((ctx.payload && ctx.payload.eggSpecies) || '').trim();
  const poke = want ? getPokemonByIndex(want) : null;
  const species = poke && !poke.legend && !isPowerForm(poke) ? poke.index : pick(EGG_SPECIES_POOL()).index;
  const ivs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  for (const k of Object.keys(ivs)) ivs[k] = Math.floor(Math.random() * 32);
  return { species, ivs, nature: pick(POKEMON_NATURES)[0], shiny: true };
}

function rollReward(ctx) {
  const r = rngFrom(seedOf(ctx));
  const pick = list => list[Math.floor(r() * list.length)];
  const items = [pick(EVO_REWARD_POOL), pick(MINT_CROWN_POOL), pick(RARE_POOL)];   // 前三档
  return { v: REWARD_V, items, egg: eggFrom(ctx, r) };
}

// 奖励只在第一次打开页面时摇一次并落盘（页面上显示的、发出去的必须是同一份）。
// 缓存里记着是按哪个种子摇的 —— 改了 payload.seed 就会重摇。
function rewardOf(ctx) {
  const seed = seedOf(ctx);
  const rw = ctx.slot.reward;
  if (!rw || rw.v !== REWARD_V || !rw.egg || !Array.isArray(rw.items) || ctx.slot.rewardSeed !== seed) {
    ctx.slot.reward = rollReward(ctx);
    ctx.slot.rewardSeed = seed;
    ctx.save();
  }
  return ctx.slot.reward;
}

// 展示用图标：act-anim 是动图立绘（目标宝可梦），其余小图标走静态 icon
function pokeAnimHtml(index, box) {
  const poke = getPokemonByIndex(String(index));
  if (!poke) return '';
  return `<img class="act-anim" data-anim="${poke.index}" alt="" style="width:${box}px;height:${box}px;">`;
}
function itemIconHtml(key, box = 24) {
  return `<img src="${itemIconSrc(key)}" alt="" title="${ITEM_NAMES[key] || key}" style="width:${box}px;height:${box}px;">`;
}
function loadIcons(root) {
  root.querySelectorAll('.act-anim[data-anim]').forEach((img) => {
    const poke = getPokemonByIndex(img.dataset.anim);
    if (poke) tryLoadPokemonImage(img, poke, '');
  });
  root.querySelectorAll('img[data-icon]').forEach((img) => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
}

// 挑提交用的个体：只认"活动期间在路上抓到的"（孵蛋、交换来的都不算，
// 否则饲育屋喂树果批量孵就能白拿）；等级最低优先（再比个体值总和），锁定/蛋/已不在仓库的不算
const ivSum = p => ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].reduce((s, k) => s + ((p.ivs || {})[k] || 0), 0);
function submittable(species, from) {
  return (gameData?.roster || [])
    .filter(p => String(p.species) === String(species) && isPokemon(p) && !p.locked && p.inRoster !== false
      && p.source !== 'egg' && p.source !== 'trade' && (p.obtainedAt || 0) >= (from || 0))
    .sort((a, b) => (a.level || 1) - (b.level || 1) || ivSum(a) - ivSum(b));
}

// 槽位：空位显示「＋」，放入后显示这只的图标（点一下取出）
function slotHtml(ctx, i) {
  const entry = (gameData?.roster || []).find(p => p.id === ctx.picks[i]);
  if (!entry) return `<div class="act-slot empty" data-slot="${i}" title="点击放入宝可梦">＋</div>`;
  return `<div class="act-slot" data-slot="${i}" title="点击取出">
    <img class="act-slot-icon" data-icon="${entry.species}" alt="">
  </div>`;
}

// 选择器的候选范围：只留能上交的（本种、未锁定、在仓库里），再扣掉别的槽位已经占用的
function pickerExclude(ctx, slot) {
  const poke = targetPoke(ctx);
  const ok = new Set(poke ? submittable(poke.index, ctx.from).map(p => p.id) : []);
  const used = new Set(ctx.picks.filter((rid, i) => rid && i !== slot));
  return (gameData?.roster || [])
    .filter(p => !ok.has(p.id) || used.has(p.id))
    .map(p => p.id);
}

// 蛋的图标（按属性）与名字「闪光×××的蛋」：档位与兑换所两处共用
function eggIconHtml(species, box = 24, title = '闪光蛋') {
  const ep = getPokemonByIndex(String(species));
  return `<img src="${eggSprite(ep?.types?.[0])}" alt="蛋" title="${title}" style="width:${box}px;height:${box}px;">`;
}
function eggLabel(species) {
  const ep = getPokemonByIndex(String(species));
  return `闪光${ep ? (ep.name || ep.form) : species}的蛋`;
}

// 某一档给什么：前三档是道具图标，第四档是属性蛋图 + 「闪光×××的蛋」
function giftHtml(i, rw) {
  if (i < TIERS - 1) {
    const k = rw.items[i];
    return `${itemIconHtml(k)}<i>${ITEM_NAMES[k] || k}</i>`;
  }
  return `${eggIconHtml(rw.egg.species)}<i>${eggLabel(rw.egg.species)}</i>`;
}

// 取某一档的槽位内容：picks 是按槽位下标写入的，跳着放会留下空洞，
// 而 slice 保留的空洞会被 every/some 跳过（判断成"已放满"），take 里的
// for...of 又不会跳过（undefined 去 splice 会删掉仓库末尾的个体）。
// 统一在这里补齐成定长数组，空位显式记为 null
function picksAt(ctx, base, per) {
  return Array.from({ length: per }, (_, j) => ctx.picks[base + j] || null);
}

// 一档一行：档位 + 这档给什么 + 状态；当前这一档才画槽位和领取按钮
function tierHtml(ctx, i, rw, per, done) {
  const cur = i === done;
  const base = i * per;
  const ids = picksAt(ctx, base, per);
  const full = ids.every(Boolean);
  const state = i < done
    ? '<span class="catch-confirm-btn off">已领取</span>'
    : cur
      ? `<span class="catch-confirm-btn${full ? '' : ' off'}" data-claim="${i}">领取</span>`
      : '';
  return `
    <div class="act-tier ${i < done ? 'done' : cur ? 'cur' : 'locked'}">
      <div class="act-tier-head">
        <span class="act-tier-no">${TIER_NAMES[i] || `奖励${i + 1}`}</span>
        <span class="act-tier-gift">${giftHtml(i, rw)}</span>
        ${state}
      </div>
      ${cur ? `<div class="act-slots">${Array.from({ length: per }, (_, j) => slotHtml(ctx, base + j)).join('')}</div>` : ''}
    </div>`;
}

// ===== 宝可翻牌（id: poke-flip）：玩配对翻牌赚气球，在兑换所换道具（每样限一次，换完即止）=====
const BALLOON_ICON = './items/goods/balloon-cyan.png';
// 每个活动的代币气球换一个颜色；没写的（宝可翻牌）沿用青色
const COIN_ICONS = {
  'bird-stack': './items/goods/balloon-teal.png',
  'flow-link': './items/goods/balloon-pink.png',
  'guess-name': './items/goods/balloon-lime.png',
  'sweet-workshop': './items/goods/balloon-cream.png',
};
const coinIcon = (ctx) => COIN_ICONS[ctx && ctx.id] || BALLOON_ICON;
// 兑换表：价格按"一周活动能换完"配（合计 4250）；每样限一次，所以不用怕刷。
// 没写 name 的那几项是随机货，具体摇到哪个由活动种子定（见 shopGrantOf），页面上直接把那个摆出来
const SHOP_ITEMS = [
  { id: 'candy', price: 150,  qty: 2, name: '经验糖果 ×2', icon: 'exp-candy' },
  { id: 'ultra', price: 200,  qty: 5, name: '高级球 ×5',   icon: 'ultra-ball' },
  { id: 'mint',  price: 300,  qty: 1, icon: MINT_KEYS[0] },
  { id: 'stone', price: 400,  qty: 1, icon: EVO_REWARD_POOL[0] },
  { id: 'crown', price: 700,  qty: 1, icon: 'golden-crown' },
  { id: 'rare',  price: 1000, qty: 1, icon: 'master-ball' },
  { id: 'egg',   price: 1500, qty: 1, egg: true },
];

// 鸟了个鸟单独一份兑换表：王冠那一档换成神秘蛋，其余照旧
const BIRD_SHOP_ITEMS = SHOP_ITEMS.map(it => (
  it.id === 'crown' ? { id: 'mystery', price: 300, qty: 1, icon: 'mystery-egg' } : it
));
// 甜蜜工坊单独一份兑换表：最后那颗蛋换成指定外观的霜奶仙
const SWEET_SHOP_ITEMS = SHOP_ITEMS.map(it => (
  it.id === 'egg' ? { id: 'alcremie', price: 1500, qty: 1, alcremie: true } : it
));
const shopItemsOf = (ctx) => (
  ctx.id === 'bird-stack' ? BIRD_SHOP_ITEMS
    : ctx.id === 'sweet-workshop' ? SWEET_SHOP_ITEMS
      : SHOP_ITEMS
);

const coinsOf = ctx => Math.max(0, Math.round(Number(ctx.slot && ctx.slot.coins) || 0));
// 统计行：难度档上方那一行，仿猜宝可梦的"已答对 N 题"
const clearedRow = ctx => `<div class="act-own">已通关 <b>${Number(ctx.slot.cleared) || 0}</b> 局</div>`;
function boughtOf(ctx) {
  if (!ctx.slot.bought || typeof ctx.slot.bought !== 'object') ctx.slot.bought = {};
  return ctx.slot.bought;
}
// 随机货最终给哪个道具：种子只挂在"活动 + 商品 id"上，不掺购买顺序 ——
// 所以能提前算出来直接摆给玩家看，领取时拿到的也必然是同一个
function shopGrantOf(ctx, item) {
  const r = rngFrom((seedOf(ctx) ^ strSeed(item.id)) >>> 0);
  if (item.id === 'mint') return MINT_KEYS[Math.floor(r() * MINT_KEYS.length)];
  if (item.id === 'stone') return EVO_REWARD_POOL[Math.floor(r() * EVO_REWARD_POOL.length)];
  if (item.id === 'crown') return CROWN_POOL[Math.floor(r() * CROWN_POOL.length)];
  if (item.id === 'rare') return RARE_POOL[Math.floor(r() * RARE_POOL.length)];
  return item.icon;   // 固定货
}
// 兑换所那颗蛋：和大量悬赏同口径（可指定物种，否则按活动种子摇，全服同一只），定下来就存着
function shopEgg(ctx) {
  if (!ctx.slot.egg) {
    ctx.slot.egg = eggFrom(ctx, rngFrom(seedOf(ctx) ^ 0x9e3779b9));
    ctx.save();
  }
  return ctx.slot.egg;
}
// 甜蜜工坊那颗蛋：霜奶仙，随机一种糖饰-口味外观，个体全满、固定雌性（不走闪光）
// 外观用本机随机（不挂活动种子）：同一场活动，各玩家换到的形态都不一样
const ALCREMIE_SPECIES = '0869';
const ALCREMIE_EGG_LABEL = '限定霜奶仙的蛋';
// 草莓糖饰-奶香香草就是基础立绘那张（默认形态），活动蛋只从其余 62 种里摇
const ALCREMIE_DEFAULT = '草莓糖饰-奶香香草';
const ALCREMIE_POOL = ALCREMIE_DECOS
  .flatMap(d => ALCREMIE_FLAVORS.map(f => `${d}-${f}`))
  .filter(v => v !== ALCREMIE_DEFAULT);
function sweetEgg(ctx) {
  if (!ctx.slot.alcremie) {
    ctx.slot.alcremie = {
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      gender: 'female',
      variant: ALCREMIE_POOL[Math.floor(Math.random() * ALCREMIE_POOL.length)],
      shiny: false,
    };
    ctx.save();
  }
  return ctx.slot.alcremie;
}
function shopName(ctx, item) {
  if (item.alcremie) return ALCREMIE_EGG_LABEL;
  if (item.egg) return eggLabel(shopEgg(ctx).species);
  return item.name || ITEM_NAMES[shopGrantOf(ctx, item)] || item.id;
}
function shopRowHtml(ctx, item) {
  const bought = !!boughtOf(ctx)[item.id];
  const can = !bought && coinsOf(ctx) >= item.price;
  const icon = item.alcremie ? eggIconHtml(ALCREMIE_SPECIES, 24, ALCREMIE_EGG_LABEL)
    : item.egg ? eggIconHtml(shopEgg(ctx).species)
      : itemIconHtml(shopGrantOf(ctx, item));
  return `
    <div class="act-shop-row${bought ? ' done' : ''}">
      ${icon}
      <span class="act-shop-name">${shopName(ctx, item)}</span>
      <span class="act-shop-price"><img src="${coinIcon(ctx)}" alt="">${item.price}</span>
      <span class="catch-confirm-btn${can ? '' : ' off'}" data-buy="${item.id}">${bought ? '已兑换' : '兑换'}</span>
    </div>`;
}
function buyShopItem(ctx, id) {
  const item = shopItemsOf(ctx).find(x => x.id === id);
  if (!item) return;
  const bought = boughtOf(ctx);
  if (bought[item.id] || coinsOf(ctx) < item.price) return;
  ctx.confirm(`花 ${item.price} 个气球换「${shopName(ctx, item)}」？`, () => {
    if (bought[item.id] || coinsOf(ctx) < item.price) { ctx.refresh(); return; }
    if (item.alcremie) {
      ctx.grantEgg(ALCREMIE_SPECIES, sweetEgg(ctx));
    } else if (item.egg) {
      const egg = shopEgg(ctx);
      ctx.grantEgg(egg.species, egg);
    } else {
      ctx.grant(shopGrantOf(ctx, item), item.qty);   // 显示什么就发什么（同一个种子算出来的）
    }
    ctx.slot.coins = coinsOf(ctx) - item.price;
    bought[item.id] = true;
    ctx.save();
    ctx.refresh();
  });
}

// 币类小游戏顶栏那格：气球图标接个数字（翻牌 / 鸟了个鸟 / 连线 / 甜蜜工坊 / 猜宝可梦共用）
const coinBadge = (ctx) => `<img src="${coinIcon(ctx)}" alt="">${coinsOf(ctx)}`;

// 币类小游戏统一的每秒巡检：币数 / 兑换状态 / 计分 / 难度有变化才重画
// scoreKey 是计分字段名（通关数 cleared、答对数 solved）
function coinTick(root, ctx, scoreKey) {
  const key = `${coinsOf(ctx)}|${Object.keys(boughtOf(ctx)).sort().join(',')}|${Number(ctx.slot[scoreKey]) || 0}|${ctx.slot.level || ''}`;
  if (root.dataset.key !== key) { root.dataset.key = key; ctx.refresh(); }
}

// 翻牌 / 鸟了个鸟 / 连线 / 甜蜜工坊四个活动的外壳一样：
// 规则文案 + 通关统计 + 难度档 + 兑换所，点难度直接开局，结算回币。
// 各活动只传自己的难度数据、属性名、规则文案和游戏模块。
function coinGame({ name, levels, levelOf, attr, rules, levelDesc, start }) {
  const dsKey = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());   // 'bg-level' → 'bgLevel'
  return {
    name,
    badge: coinBadge,

    render(ctx) {
      const lv = levelOf(ctx.slot.level || 'normal');
      return `
        <div class="act-card act-rules">${rules}</div>
        ${clearedRow(ctx)}
        <div class="act-levels">${levels.map(l => `<span class="act-level${l.id === lv.id ? ' on' : ''}" data-${attr}="${l.id}">${l.name}<em>${levelDesc(l)}</em></span>`).join('')}</div>
        <div class="act-shop">${shopItemsOf(ctx).map(it => shopRowHtml(ctx, it)).join('')}</div>`;
    },

    mount(root, ctx) {
      root.querySelectorAll(`[data-${attr}]`).forEach((el) => el.addEventListener('click', () => {
        const id = el.dataset[dsKey];
        ctx.slot.level = id;
        ctx.save();
        // 结算回调：币记账，页面的数字等回来时重画
        start(id, (coins, cleared) => {
          ctx.slot.coins = coinsOf(ctx) + coins;
          if (cleared) ctx.slot.cleared = (Number(ctx.slot.cleared) || 0) + 1;
          ctx.save();
        });
      }));
      root.querySelectorAll('[data-buy]').forEach((btn) => {
        btn.addEventListener('click', () => buyShopItem(ctx, btn.dataset.buy));
      });
    },

    // 每秒看一眼：币数/兑换状态/通关数/难度有变化才重画
    tick(root, ctx) { coinTick(root, ctx, 'cleared'); },
  };
}

// ===== 航海寻宝（id: voyage）：用船票起航，转盘抽里程，边开边打捞拼图 =====
// w 是权重（总和不必是 100）：起航时按权重摇出结果，再凑一组候选铺到转盘上滚动
// 各里程等概率，这里 w 全给同一个值
const VOYAGE_MILES = [
  { nm: 30,  w: 1 },
  { nm: 45,  w: 1 },
  { nm: 65,  w: 1 },
  { nm: 90,  w: 1 },
  { nm: 120, w: 1 },
  { nm: 160, w: 1 },
  { nm: 220, w: 1 },
];
const VOYAGE_WHEEL_SLOTS = 6;   // 转盘上铺几个候选
const VOYAGE_WHEEL_D = 84;      // 圆盘直径（像素）
// 拼图板 4 列 × 3 行 = 12 格：nm 是落格门槛，跨过点亮该格，奖励等玩家点开再发
const VOYAGE_EVO_POOL = Object.keys(EVO_PRICES).filter(k => EVO_PRICES[k] >= 500 && !k.endsWith('crown'));
const VOYAGE_POOLS = { evo: VOYAGE_EVO_POOL, mint: MINT_KEYS, crown: CROWN_POOL };
const VOYAGE_PUZZLE = [
  { nm: 100,  give: [{ item: 'exp-candy',   qty: 5  }] },
  { nm: 250,  give: [{ item: 'ultra-ball',  qty: 10 }] },
  { nm: 450,  give: [{ pool: 'mint',        qty: 2  }] },
  { nm: 700,  give: [{ pool: 'crown',       qty: 1  }] },
  { nm: 1000, give: [{ pool: 'evo',         qty: 1  }] },
  { nm: 1350, give: [{ item: 'exp-candy',   qty: 10 }] },
  { nm: 1700, give: [{ pool: 'crown',       qty: 2  }] },
  { nm: 2100, give: [{ item: 'master-ball', qty: 1  }] },
  { nm: 2550, give: [{ pool: 'evo',         qty: 2  }] },
  { nm: 3000, give: [{ egg: true }] },
  { nm: 3500, give: [{ item: 'master-ball', qty: 3  }] },
  { nm: 4000, give: [{ item: 'shiny-charm', qty: 2  }] },
];
// 拼图集齐后每再跑这么多海里满一轮，发一件随机奖励（五类等概率）
const VOYAGE_REWARD_NM = 500;
// 顶部航线刻度尺：每海里多少像素、小船钉在左侧的像素位置、刻度间隔（海里）
const VOYAGE_GAUGE = { pxPerNm: 1.5, shipX: 34, tick: 25 };
// 航行途中的补给点：每跑这么多海里即时发一次（糖果或精灵球，单点单样）
const VOYAGE_SUPPLY_NM = 25;
const VOYAGE_CANDY = { min: 50, max: 300 };    // 糖果补给点的数量区间
const VOYAGE_BALL_CHANCE = 0.3;                // 补给点出精灵球（而非糖果）的概率
const VOYAGE_BALL = { min: 5, max: 15 };
const VOYAGE_SPEED = 90;                       // 海面滚动速度（像素/秒）
const VOYAGE_SEG_SECONDS = 8;                  // 单段航行时长（别让玩家干等）
const VOYAGE_HOLD_MS = 900;                    // 转盘停稳后停一会儿再开船，让玩家看清抽到的里程
const VOYAGE_PICS = 7;                         // 拼图底图张数：本地随机分一张，只决定外观
const VOYAGE_COLS = 4, VOYAGE_ROWS = 3;        // 12 格；底图按百分比切片，格子宽度自适应容器
const VOYAGE_WATER = { src: 16, col: 16, row: 57 };   // terrain-tileset 里那块水纹

// 存档槽补齐默认值（槽本身由总线按活动窗口重置）
function voyageSlot(ctx) {
  const s = ctx.slot;
  if (!Number.isFinite(s.miles)) s.miles = 0;
  if (!Array.isArray(s.got)) s.got = [];
  if (!Array.isArray(s.opened)) s.opened = [];   // 已经点开看过奖励的格子
  if (!s.pic) s.pic = 1 + Math.floor(rngFrom(seedOf(ctx))() * VOYAGE_PICS);
  if (s.seg === undefined) s.seg = null;
  if (!Number.isFinite(s.spends)) s.spends = 0;
  if (!Number.isFinite(s.rewarded)) s.rewarded = 0;   // 拼图集齐后已领过几轮奖励
  // 已领过的补给点数；老存档按已有里程折算，避免一次性补发一大串
  if (!Number.isFinite(s.supplied)) {
    s.supplied = 0;
    while (s.miles >= voyageSupplyNm(s.supplied)) s.supplied += 1;
  }
  return s;
}
// 闪光蛋：定下来就存着（同大量悬赏口径，可被 payload.eggSpecies 指定）
function voyageEgg(ctx) {
  if (!ctx.slot.egg) {
    ctx.slot.egg = eggFrom(ctx, rngFrom((seedOf(ctx) ^ strSeed('voyage-egg')) >>> 0));
    ctx.save();
  }
  return ctx.slot.egg;
}
// 门槛 → 格子的映射：按种子打乱一次，碎片解锁位置是散的，不按行列顺序
function voyagePerm(ctx) {
  const n = VOYAGE_PUZZLE.length;
  const r = rngFrom((seedOf(ctx) ^ strSeed('voyage-perm')) >>> 0);
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
// 某格给什么：显示与发放共用一份口径；i 是门槛下标
// 同一池子（薄荷 / 王冠 / 进化道具）在各格里不重复出，池子抽空了才允许重复
let _voyageGiftCache = null;   // { key, list }，种子不变就复用
function voyageGiftAll(ctx) {
  const key = seedOf(ctx);
  if (_voyageGiftCache && _voyageGiftCache.key === key) return _voyageGiftCache.list;
  const used = {};
  const list = VOYAGE_PUZZLE.map((p, i) => {
    const g = p.give[0];
    if (g.egg) { const e = voyageEgg(ctx); return { egg: true, species: e.species }; }
    if (g.pool) {
      const pool = VOYAGE_POOLS[g.pool];
      const taken = used[g.pool] || (used[g.pool] = []);
      const left = pool.filter(k => !taken.includes(k));
      const src = left.length ? left : pool;
      const r = rngFrom((seedOf(ctx) ^ strSeed(`voyage-pool${g.pool}${i}`)) >>> 0);
      const k = src[Math.floor(r() * src.length)];
      taken.push(k);
      return { key: k, qty: g.qty };
    }
    return { key: g.item, qty: g.qty };
  });
  _voyageGiftCache = { key, list };
  return list;
}
function voyageGiftOf(ctx, i) {
  return voyageGiftAll(ctx)[i];
}
function voyageGiftHtml(ctx, i, size = 20) {
  const g = voyageGiftOf(ctx, i);
  if (g.egg) return `${eggIconHtml(g.species, size)}<i>${eggLabel(g.species)}</i>`;
  return `${itemIconHtml(g.key, size)}<i>${ITEM_NAMES[g.key] || g.key} ×${g.qty}</i>`;
}
// 拼图集齐后已跑满几轮奖励
function voyageRewardCycles(ctx) {
  const over = ctx.slot.miles - VOYAGE_PUZZLE[VOYAGE_PUZZLE.length - 1].nm;
  return over <= 0 ? 0 : Math.floor(over / VOYAGE_REWARD_NM);
}
// 第 j 轮给哪件：王冠 / 大师球 / 闪耀护符 / 稀有进化道具 / 薄荷，五类等概率；同轮结果固定
function voyageRewardOf(ctx, j) {
  const r = rngFrom((seedOf(ctx) ^ strSeed(`voyage-reward${j}`)) >>> 0);
  const pick = list => list[Math.floor(r() * list.length)];
  const kind = Math.floor(r() * 5);
  if (kind === 0) return { key: pick(CROWN_POOL), qty: 1 };
  if (kind === 1) return { key: 'master-ball', qty: 1 };
  if (kind === 2) return { key: 'shiny-charm', qty: 1 };
  if (kind === 3) return { key: pick(VOYAGE_EVO_POOL), qty: 1 };
  return { key: pick(MINT_KEYS), qty: 1 };
}
// 被碎片门槛或奖励轮次占用的里程（都是 25 的整数倍），补给点生成时跳过这些档
function voyageNmTaken(nm) {
  if (VOYAGE_PUZZLE.some(p => p.nm === nm)) return true;
  const base = VOYAGE_PUZZLE[VOYAGE_PUZZLE.length - 1].nm;
  return nm > base && (nm - base) % VOYAGE_REWARD_NM === 0;
}
// 第 i 个补给点的里程：从 25 起每 25 一档往后数，跳过被占用的档
function voyageSupplyNm(i) {
  let nm = 0, k = -1;
  while (k < i) {
    do { nm += VOYAGE_SUPPLY_NM; } while (voyageNmTaken(nm));
    k += 1;
  }
  return nm;
}
// 第 i 个补给点给什么：种子决定是糖果还是精灵球，单点单样；种子挂在序号上，尺子上可提前预览
function voyageSupplyOf(ctx, i) {
  const r = rngFrom((seedOf(ctx) ^ strSeed(`voyage-supply${i}`)) >>> 0);
  if (r() < VOYAGE_BALL_CHANCE) {
    const qty = VOYAGE_BALL.min + Math.floor(r() * (VOYAGE_BALL.max - VOYAGE_BALL.min + 1));
    return { nm: voyageSupplyNm(i), key: 'poke-ball', qty };
  }
  const qty = VOYAGE_CANDY.min + Math.floor(r() * (VOYAGE_CANDY.max - VOYAGE_CANDY.min + 1));
  return { nm: voyageSupplyNm(i), key: 'candy', qty };
}
// 刻度尺上要摆的节点：航行补给 + 拼图碎片 + 集齐后的奖励轮次，只取落在可视里程段内的
function voyageGaugeNodes(ctx, fromNm, toNm) {
  const s = ctx.slot, perm = voyagePerm(ctx);
  const out = [];
  // 定位窗口内第一个补给点：从估算档位出发前后校准，避免从 0 扫
  let i = Math.max(0, Math.floor(fromNm / VOYAGE_SUPPLY_NM) - 1);
  while (i > 0 && voyageSupplyNm(i) > fromNm) i -= 1;
  while (voyageSupplyNm(i) < fromNm) i += 1;
  for (;; i++) {
    const nm = voyageSupplyNm(i);
    if (nm > toNm) break;
    const g = voyageSupplyOf(ctx, i);
    const title = `${ITEM_NAMES[g.key] || g.key} +${g.qty}`;
    out.push({ nm, src: itemIconSrc(g.key), done: i < s.supplied, title });
  }
  VOYAGE_PUZZLE.forEach((p, k) => {
    if (p.nm < fromNm || p.nm > toNm) return;
    out.push({ nm: p.nm, src: './items/goods/jigsaw.png', done: s.got.includes(perm[k] + 1), title: '拼图碎片' });
  });
  const base = VOYAGE_PUZZLE[VOYAGE_PUZZLE.length - 1].nm;
  const j0 = Math.max(0, Math.floor((fromNm - base) / VOYAGE_REWARD_NM));
  const j1 = Math.ceil((toNm - base) / VOYAGE_REWARD_NM);
  for (let j = j0; j <= j1; j++) {
    const nm = base + (j + 1) * VOYAGE_REWARD_NM;
    if (nm < fromNm || nm > toNm) continue;
    const g = voyageRewardOf(ctx, j);
    out.push({ nm, src: itemIconSrc(g.key), done: j < s.rewarded, title: ITEM_NAMES[g.key] || g.key });
  }
  out.sort((a, b) => a.nm - b.nm);
  return out;
}
// 刷刻度尺：小船钉在 shipX，刻度线与奖励节点按里程向左平移；滚过小船即表示已到手
function voyageGaugeUpdate(ctx, r) {
  if (!r.gaugeEl) return;
  let W = r.gaugeW;
  if (!W) { W = r.gaugeW = r.gaugeEl.clientWidth; if (!W) return; }
  const k = VOYAGE_GAUGE.pxPerNm, shipX = VOYAGE_GAUGE.shipX, miles = ctx.slot.miles;
  if (r.rulerEl) r.rulerEl.style.backgroundPositionX = `${-miles * k}px`;
  const fromNm = miles - shipX / k, toNm = miles + (W - shipX) / k;
  const nodes = voyageGaugeNodes(ctx, fromNm, toNm);
  const keep = new Set();
  for (const n of nodes) {
    keep.add(n.nm);
    let el = r.nodeMap.get(n.nm);
    if (!el) {
      el = document.createElement('span');
      el.className = 'voyage-gauge-node';
      el.innerHTML = '<img alt="">';
      r.gaugeEl.appendChild(el);
      r.nodeMap.set(n.nm, el);
    }
    const img = el.firstChild;
    if (el.dataset.src !== n.src) { el.dataset.src = n.src; img.src = n.src; }
    img.alt = n.title;
    el.title = n.title;
    el.style.left = `${shipX + (n.nm - miles) * k}px`;
    el.classList.toggle('done', !!n.done);
  }
  for (const [nm, el] of r.nodeMap) {
    if (!keep.has(nm)) { el.remove(); r.nodeMap.delete(nm); }
  }
}
// 拼图一格：底图按列行切成百分比背景；未落格 cover 盖实，落格变淡，点开收掉只留图案
function voyageCellHtml(ctx, i) {
  const s = ctx.slot;
  const k = voyagePerm(ctx).indexOf(i);   // 这一格对应哪个门槛，奖励跟着门槛走
  const col = i % VOYAGE_COLS, row = Math.floor(i / VOYAGE_COLS);
  const bg = `background-image:url(./items/jigsaws/jigsaw_${s.pic}.png);`
    + `background-size:${VOYAGE_COLS * 100}% ${VOYAGE_ROWS * 100}%;`
    + `background-position:${(col * 100) / (VOYAGE_COLS - 1)}% ${(row * 100) / (VOYAGE_ROWS - 1)}%;`;
  const cls = s.opened.includes(i + 1) ? ' opened' : (s.got.includes(i + 1) ? ' got' : '');
  return `<div class="voyage-pc${cls}" data-cell="${i + 1}" style="${bg}">
    <span class="voyage-cover">${voyageGiftHtml(ctx, k)}</span>
  </div>`;
}
// 抽一段航程：摇出结果 + 凑一组候选（必含结果）打乱铺盘。种子挂在"活动 + 第几张票"，刷新不重抽
function voyageRollSeg(ctx) {
  const s = voyageSlot(ctx);
  const r = rngFrom((seedOf(ctx) ^ strSeed(`voyage-seg${s.spends}`)) >>> 0);
  const total = VOYAGE_MILES.reduce((a, x) => a + x.w, 0);
  let t = r() * total, pick = 0;
  for (let i = 0; i < VOYAGE_MILES.length; i++) { t -= VOYAGE_MILES[i].w; if (t < 0) { pick = i; break; } }
  const nm = VOYAGE_MILES[pick].nm;
  const others = VOYAGE_MILES.filter(m => m.nm !== nm);
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  const slots = [nm, ...others.slice(0, VOYAGE_WHEEL_SLOTS - 1).map(m => m.nm)];
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  return { nm, slots, target: slots.indexOf(nm), remain: 0 };
}

// 航海页的动画状态（同一时刻只开一个活动页，所以放模块级；mount 时重建，unmount 时清掉）
let _voyageRun = null;
let _voyageWater = null, _voyageShip = null;
function voyageAssets() {
  if (!_voyageWater) { _voyageWater = new Image(); _voyageWater.src = './terrain/terrain-tileset.png'; }
  if (!_voyageShip) { _voyageShip = new Image(); _voyageShip.src = './icons/ship.png'; }
  return { water: _voyageWater, ship: _voyageShip };
}
function voyageStopRun() {
  const r = _voyageRun;
  if (!r) return;
  if (r.raf) cancelAnimationFrame(r.raf);
  if (r.onResize) window.removeEventListener('resize', r.onResize);
  _voyageRun = null;
}
// 活动视图是否还显示着（showView 用 display 切换）
function voyageVisible() {
  const v = document.getElementById('activityView');
  return !v || v.style.display !== 'none';
}
// 高 DPI：后端分辨率按 dpr 放大，绘制尺寸仍用逻辑像素
function voyageSizing(r) {
  const canvas = r.canvas;
  if (!canvas) return;
  if (r.stageEl) {
    const h = Math.max(170, Math.round(r.root ? r.root.clientHeight : 0));
    r.stageEl.style.height = `${h}px`;
  }
  if (r.gaugeEl) {
    r.gaugeW = r.gaugeEl.clientWidth;
    if (r.rulerEl) {
      // 小刻度每 tick 海里一格，大刻度每 4 格一个；两层都贴轴底，形成长短刻度
      const t = VOYAGE_GAUGE.tick * VOYAGE_GAUGE.pxPerNm;
      r.rulerEl.style.backgroundImage =
        'linear-gradient(to right, rgba(255,255,255,.9) 0 1px, transparent 1px),' +
        'linear-gradient(to right, rgba(255,255,255,.5) 0 1px, transparent 1px)';
      r.rulerEl.style.backgroundSize = `${t * 4}px 12px, ${t}px 6px`;
      r.rulerEl.style.backgroundPosition = '0 100%';
    }
    if (r.shipEl) r.shipEl.style.left = `${VOYAGE_GAUGE.shipX}px`;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  r.dpr = dpr;
  r.w = Math.max(1, rect.width);
  r.h = Math.max(1, rect.height);
  canvas.width = Math.round(r.w * dpr);
  canvas.height = Math.round(r.h * dpr);
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.imageSmoothingEnabled = false;
  r.c2d = c;
}
// 画一帧：平铺水纹（偏移对齐设备像素网格，免得接缝随滚动"呼吸"）+ 颠簸的船
function voyageDraw(r, now) {
  const c = r.c2d;
  if (!c) return;
  const w = r.w, h = r.h;
  c.clearRect(0, 0, w, h);
  const water = r.water;
  if (water && water.complete && water.naturalWidth) {
    const S = VOYAGE_WATER.src;
    const sx = VOYAGE_WATER.col * S, sy = VOYAGE_WATER.row * S;
    const off = Math.round((-r.scrollX % S) * r.dpr) / r.dpr;
    for (let x = off - S; x < w + S; x += S) {
      for (let y = 0; y < h; y += S) {
        c.drawImage(water, sx, sy, S, S, Math.round(x), Math.round(y), S, S);
      }
    }
  }
  const ship = r.ship;
  if (ship && ship.complete && ship.naturalWidth) {
    const sc = 2;   // 整数倍放大，像素不糊
    const sw = ship.naturalWidth * sc, sh = ship.naturalHeight * sc;
    const bob = Math.sin(now / 420) * 4;
    const tilt = Math.sin(now / 420) * 2 * Math.PI / 180;
    const cy = Math.max(64, h * 0.62 - 14);   // 顶部刻度尺和底部转盘之间，稍偏下留出间距
    c.save();
    c.translate(w * 0.22, cy + bob);
    c.rotate(tilt);
    c.drawImage(ship, -sw / 2, -sh / 2, sw, sh);
    c.restore();
  }
}
// 画圆盘：按候选数均分扇区，扇区里径向写里程数；hi 是结果格（-1 = 还没抽）
function voyageWheelDraw(r, seg, hi) {
  const cv = r.wheelCv;
  if (!cv) return;
  const D = VOYAGE_WHEEL_D;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(D * dpr);
  cv.height = Math.round(D * dpr);
  cv.style.width = `${D}px`;
  cv.style.height = `${D}px`;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, D, D);
  const cx = D / 2, cy = D / 2, R = D / 2 - 2;
  const n = seg ? seg.slots.length : VOYAGE_WHEEL_SLOTS;
  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * step;
    const a1 = a0 + step;
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, R, a0, a1);
    c.closePath();
    c.fillStyle = i === hi ? '#ffcb05' : (i % 2 ? '#eef5fc' : '#ffffff');
    c.fill();
    c.strokeStyle = '#cfe0f2';
    c.lineWidth = 1;
    c.stroke();
    // 数字沿扇区中线摆放
    const am = a0 + step / 2;
    c.save();
    c.translate(cx + Math.cos(am) * R * 0.66, cy + Math.sin(am) * R * 0.66);
    c.rotate(am + Math.PI / 2);
    c.fillStyle = i === hi ? '#5a4200' : '#2e6db4';
    c.font = '700 10px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(seg ? String(seg.slots[i]) : '?', 0, 0);
    c.restore();
  }
  c.beginPath();
  c.arc(cx, cy, R - 1, 0, Math.PI * 2);
  c.strokeStyle = '#cfe0f2';
  c.lineWidth = 2;
  c.stroke();
  // 圆心不画轴心：指针（水滴形）由 CSS 叠在中心
}
// 航行途中打捞到的东西：累积起来盖在海面上，玩家点一下就收掉
function voyageLootPush(r, html) {
  r.loot.push(html);
  if (!r.lootEl) return;
  r.lootEl.innerHTML = r.loot.join('');
  r.lootEl.classList.add('on');
}
function voyageLootClear(r) {
  r.loot = [];
  if (r.lootEl) { r.lootEl.innerHTML = ''; r.lootEl.classList.remove('on'); }
}
// 只刷进度条/按钮，不整页重画（重画会把 canvas 和 rAF 一起拆掉）
function voyageHud(ctx, r) {
  const s = voyageSlot(ctx);
  voyageGaugeUpdate(ctx, r);
  const n = ctx.count('ticket');
  // 页头徽标也显示票数：起航扣票后不等整页重画就跟着变
  if (r.badgeEl && r.badgeN !== n) {
    r.badgeN = n;
    r.badgeEl.innerHTML = `<img src="./items/goods/ticket.png" alt="">${n}`;
  }
  const wheelOn = r.phase === 'spin' || r.phase === 'hold';
  if (r.wheelEl) r.wheelEl.classList.toggle('on', wheelOn);   // 转盘只在抽里程期间露面
  if (r.goEl) {
    const sailing = r.phase === 'sail';
    if (r.goTextEl) r.goTextEl.textContent = sailing ? `前进 ${Math.round(s.seg.nm)} 海里` : '起航';
    r.goEl.classList.toggle('hide', wheelOn);
    r.goEl.classList.toggle('sail', sailing);
    r.goEl.classList.toggle('off', !wheelOn && !sailing && n < 1);
  }
  const cellsKey = `${s.got.join(',')}|${s.opened.join(',')}`;
  if (r.gotKey !== cellsKey) {
    r.gotKey = cellsKey;
    r.puzzleCells.forEach((el, i) => {
      el.classList.toggle('got', s.got.includes(i + 1));
      el.classList.toggle('opened', s.opened.includes(i + 1));
    });
  }
}
// 跨过门槛就落格（只点亮格子，奖励等玩家点开再发；一帧跨过多个门槛就一次补齐）
function voyageLand(ctx, r) {
  const s = ctx.slot;
  const perm = voyagePerm(ctx);
  let changed = false;
  VOYAGE_PUZZLE.forEach((p, k) => {
    const cell = perm[k] + 1;
    if (s.got.includes(cell) || s.miles < p.nm) return;
    s.got.push(cell);
    voyageLootPush(r, `<span class="voyage-loot-row"><img src="./items/goods/jigsaw.png" alt="" style="width:16px;height:16px;"><i>拼图 +1</i></span>`);
    changed = true;
  });
  // 拼图集齐后里程继续推进奖励轮次：每满一轮发一件（一帧跨多轮也补齐）
  const cycles = voyageRewardCycles(ctx);
  while (s.rewarded < cycles) {
    const g = voyageRewardOf(ctx, s.rewarded);
    s.rewarded += 1;
    ctx.grant(g.key, g.qty);
    voyageLootPush(r, `<span class="voyage-loot-row">${itemIconHtml(g.key, 16)}<i>${ITEM_NAMES[g.key] || g.key} +${g.qty}</i></span>`);
    changed = true;
  }
  if (changed) ctx.save();
}
// 里程推进跨过补给点就即时发放（一帧跨多个点也补齐）
function voyageSupplyLand(ctx, r) {
  const s = ctx.slot;
  let changed = false;
  while (s.miles >= voyageSupplyNm(s.supplied)) {
    const g = voyageSupplyOf(ctx, s.supplied);
    s.supplied += 1;
    ctx.grant(g.key, g.qty);
    voyageLootPush(r, `<span class="voyage-loot-row">${itemIconHtml(g.key, 16)}<i>${ITEM_NAMES[g.key] || g.key} +${g.qty}</i></span>`);
    changed = true;
  }
  if (changed) ctx.save();
}
// 点格子：碎片已到手就领奖并亮出图案；还没打捞到就提示怎么拿
function voyageOpenCell(ctx, cell) {
  const s = voyageSlot(ctx);
  if (!cell || s.opened.includes(cell)) return;
  const k = voyagePerm(ctx).indexOf(cell - 1);
  if (!s.got.includes(cell)) {
    showConfirmBar('航行中打捞到这块拼图后，即可领取奖励', null, null,
      { singleButton: true, host: document.getElementById('activityView') });
    return;
  }
  s.opened.push(cell);
  const g = voyageGiftOf(ctx, k);
  if (g.egg) ctx.grantEgg(g.species, voyageEgg(ctx));
  else ctx.grant(g.key, g.qty);
  ctx.save();
  const text = g.egg ? eggLabel(g.species) : `${ITEM_NAMES[g.key] || g.key} ×${g.qty}`;
  showConfirmBar(`获得 ${text}`, null, null,
    { singleButton: true, host: document.getElementById('activityView') });
}
// 一段开完：回到待机（糖果等奖励已随里程即时发放，这里不再结算）
function voyageFinishSeg(ctx, r) {
  ctx.slot.seg = null;
  ctx.save();
  r.phase = 'idle';
}
function voyageAdvance(ctx, r, dt) {
  const s = ctx.slot;
  const seg = s.seg;
  if (!seg) { r.phase = 'idle'; return; }
  const rate = seg.nm / VOYAGE_SEG_SECONDS;   // 用 dt 推进，掉帧时里程增速不变
  const d = Math.min(rate * dt, seg.remain);
  seg.remain -= d;
  s.miles += d;
  voyageLand(ctx, r);
  voyageSupplyLand(ctx, r);
  if (seg.remain <= 1e-6) voyageFinishSeg(ctx, r);
  else {
    r.saveAcc += dt;
    if (r.saveAcc >= 1) { r.saveAcc = 0; ctx.save(); }   // 不必每帧落盘
  }
}
// 转盘：缓动（ease-out）转几圈后停在结果扇区，扇区中心对准顶部指针
function voyageSpinStep(r, now) {
  const sp = r.spin;
  if (!sp) { r.phase = 'idle'; return; }
  const p = Math.min(1, (now - sp.t0) / sp.dur);
  const eased = 1 - Math.pow(1 - p, 3);
  r.wheelCv.style.transform = `rotate(${(eased * sp.total).toFixed(2)}deg)`;
  if (p >= 1) {
    r.spin = null;
    r.phase = 'hold';
    r.holdUntil = now + VOYAGE_HOLD_MS;
    voyageWheelDraw(r, r.ctx.slot.seg, r.ctx.slot.seg.target);   // 停下后把结果扇区点亮
  }
}
// 起航：扣 1 张票 → 抽航段（立刻落盘）→ 圆盘开转 → 开船
function voyageStart(ctx, r) {
  const s = voyageSlot(ctx);
  if (s.seg) return;                         // 正在航行（互斥，防连点吞票）
  if (ctx.count('ticket') < 1) return;
  if (!ctx.spend('ticket', 1)) return;
  s.spends += 1;
  s.seg = voyageRollSeg(ctx);
  s.seg.remain = s.seg.nm;
  ctx.save();
  voyageLootClear(r);
  voyageWheelDraw(r, s.seg, -1);
  r.wheelCv.style.transform = 'rotate(0deg)';
  const segDeg = 360 / s.seg.slots.length;
  r.spin = { t0: performance.now(), total: 360 * 3 - (s.seg.target + 0.5) * segDeg, dur: 1800 };
  r.phase = 'spin';
}
function voyageLoop(now) {
  const r = _voyageRun;
  if (!r) return;
  // 视图被切走（容器不调 unmount）就停掉循环，别在后台空转；回页由容器每秒 tick 唤醒
  if (!voyageVisible()) { r.raf = 0; return; }
  if (!r.sized && r.canvas) { voyageSizing(r); if (r.w > 2) r.sized = true; }   // 首帧容器可能还没量到宽
  const dt = Math.min(0.05, (now - (r.last || now)) / 1000);
  r.last = now;
  if (r.phase === 'sail') {
    r.scrollX += VOYAGE_SPEED * dt;
    voyageAdvance(r.ctx, r, dt);
  } else if (r.phase === 'spin') {
    voyageSpinStep(r, now);
  } else if (r.phase === 'hold') {
    if (now >= r.holdUntil) r.phase = 'sail';   // 停一会儿收掉转盘，船接着开
  } else {
    r.scrollX += 6 * dt;   // 待机时海面极慢漂，画面不僵
  }
  voyageHud(r.ctx, r);
  voyageDraw(r, now);
  r.raf = requestAnimationFrame(voyageLoop);
}

export const ACTIVITIES = {
  // ---- 大量悬赏（id: mass-bounty）：活动期间固定一只宝可梦，每交 3 只领一档，四档共 12 只 ----
  // 服务器 activity.json 里加一条：
  // { "id": "mass-bounty", "from": …, "to": …, "payload": { "seed": …, "perTier": 3, "eggSpecies": "0133" } }
  // seed 决定"固定哪一只（全野池随机、去神兽）+ 四档奖励"，改 seed 就整份重摇
  'mass-bounty': {
    name: '大量悬赏',

    // 页头标题：活动名 + 当前目标（"大量悬赏-皮卡丘"）
    title(ctx) {
      const poke = targetPoke(ctx);
      return poke ? `大量悬赏-${poke.form || poke.name}` : '大量悬赏';
    },

    // 拿不到排期就没法确定"固定那一只"，这种情况入口直接不显示
    ready(ctx) { return !!targetPoke(ctx); },

    render(ctx) {
      const poke = targetPoke(ctx);
      const rw = rewardOf(ctx);
      const per = perTierOf(ctx);
      const done = tiersDone(ctx);
      const have = poke ? submittable(poke.index, ctx.from).length : 0;
      return `
        <div class="act-hero">${pokeAnimHtml(poke.index, 48)}</div>
        <p class="act-own">活动期间在路上抓到 <b>${have}</b> 只</p>
        <div class="act-tiers">${Array.from({ length: TIERS }, (_, i) => tierHtml(ctx, i, rw, per, done)).join('')}</div>`;
    },

    mount(root, ctx) {
      loadIcons(root);
      const per = perTierOf(ctx);
      const done = tiersDone(ctx);
      const poke = targetPoke(ctx);
      // 槽位：空位去仓库挑一只放进去，已放的再点一下取出
      root.querySelectorAll('.act-slot[data-slot]').forEach((el) => {
        el.addEventListener('click', () => {
          const i = Number(el.dataset.slot);
          if (ctx.picks[i]) { ctx.setPick(i, null); ctx.refresh(); return; }
          ctx.openPicker(i, pickerExclude(ctx, i));
        });
      });
      if (!poke || done >= TIERS) return;
      const btn = root.querySelector(`[data-claim="${done}"]`);
      if (!btn) return;
      const base = done * per;
      const ids = picksAt(ctx, base, per);
      const ok = new Set(submittable(poke.index, ctx.from).map(p => p.id));
      if (ids.some(id => !ok.has(id))) return;   // 有没放满 / 失效的：按钮不接
      btn.addEventListener('click', () => {
        if (tiersDone(ctx) !== done) return;   // 页面重画前被连点：认准档位
        ctx.confirm(`上交这 ${per} 只「${poke.form || poke.name}」换${TIER_NAMES[done]}？上交后不可找回。`, () => {
          if (!ctx.take(ids, `大量悬赏：${poke.name} ×${per}`)) { ctx.refresh(); return; }
          const rw = rewardOf(ctx);
          if (done < TIERS - 1) ctx.grant(rw.items[done], 1);
          else ctx.grantEgg(rw.egg.species, rw.egg);
          ctx.slot.tiers = done + 1;
          for (let j = 0; j < per; j++) ctx.setPick(base + j, null);
          ctx.save();
          ctx.refresh();
        });
      });
    },

    // 每秒看一眼：换场/仓库/档位有变化才重画（容器已经在刷倒计时，这里不碰别的 DOM）
    tick(root, ctx) {
      const poke = targetPoke(ctx);
      const ok = new Set(poke ? submittable(poke.index, ctx.from).map(p => p.id) : []);
      // 槽位里那只被放生/进化了（id 变了）：直接清掉，别等提交时才失败
      for (let i = 0; i < ctx.picks.length; i++) if (ctx.picks[i] && !ok.has(ctx.picks[i])) ctx.picks[i] = null;
      const key = `${poke ? poke.index : '-'}|${ok.size}|${tiersDone(ctx)}|${seedOf(ctx)}|${ctx.picks.map(x => x || '-').join(',')}`;
      if (root.dataset.key !== key) { root.dataset.key = key; ctx.refresh(); }
    },
  },

  // ---- 宝可翻牌（poke-flip）：靠配对翻牌赚气球，换道具（每样限一次）----
  // 服务器 activity.json 里加一条 { "id": "poke-flip", "from": …, "to": …,
  //   "payload": { "seed": …, "eggSpecies": "0133" } }
  'poke-flip': coinGame({
    name: '宝可翻牌',
    levels: MG_LEVELS,
    levelOf,
    attr: 'level',
    rules: '点击卡片翻开，相同图案的配对，将所有卡片两两配对后获得气球奖励。<br>翻得次数越少、难度越高，获得的气球越多。<br>气球可以兑换下面的奖励，每样限一次。',
    levelDesc: l => `${l.time}秒 · ${l.tries}次`,
    start: (level, onFinish) => import('./memory-game.js').then(m => m.startMemoryGame({ level, onFinish })),
  }),

  // ---- 鸟了个鸟（bird-stack）：把叠成一堆的鸟点进槽位，凑三只抵消，换道具（每样限一次）----
  // 服务器 activity.json 里加一条 { "id": "bird-stack", "from": …, "to": … }
  'bird-stack': coinGame({
    name: '鸟了个鸟',
    levels: BG_LEVELS,
    levelOf: bgLevelOf,
    attr: 'bg-level',
    rules: '点击没被压住的鸟，把它放进下面的槽位，凑齐三只一样的自动抵消。<br>槽位放满 7 个就算输，整盘消完才有气球，难度越高给得越多。<br>气球可以兑换下面的奖励，每样限一次。',
    levelDesc: l => `${l.birds} 种 · ${l.layers.reduce((s, x) => s + x.n, 0)} 只`,
    start: (level, onFinish) => import('./bird-game.js').then(m => m.startBirdGame({ level, onFinish })),
  }),

  // ---- 宝可连线（flow-link）：拖出成对宝可梦之间的线，铺满全盘，换道具（每样限一次）----
  // 服务器 activity.json 里加一条 { "id": "flow-link", "from": …, "to": … }
  'flow-link': coinGame({
    name: '宝可连线',
    levels: FLOW_LEVELS,
    levelOf: flowLevelOf,
    attr: 'flow-level',
    rules: '连接成对的宝可梦并给格子铺上颜色，铺满全盘即可通关；不同连线不能交叉。<br>通关获得气球，可以兑换下面的奖励，每样限一次。',
    levelDesc: l => `${l.size}×${l.size} · ${l.flows} 对`,
    start: (level, onFinish) => import('./flow-game.js').then(m => m.startFlowGame({ level, onFinish })),
  }),

  // ---- 甜蜜工坊（sweet-workshop）：照顾客点单做冰激凌，按时机出货赚气球，换道具（每样限一次）----
  // 服务器 activity.json 里加一条 { "id": "sweet-workshop", "from": …, "to": … }
  'sweet-workshop': coinGame({
    name: '甜蜜工坊',
    levels: SW_LEVELS,
    levelOf: swLevelOf,
    attr: 'sw-level',
    rules: '照着顾客订单制作冰激凌，先选冰激凌再选糖饰，确认后按时机点击按钮出货。<br>出货越完美给的气球越多。困难模式需要按照顾客要求的顺序堆叠冰激凌。做错了需丢弃后重做。气球可以兑换下面的奖励，每样限一次。',
    levelDesc: l => `最高 ${l.perfect} 气球`,
    start: (level, onFinish) => import('./sweet-game.js').then(m => m.startSweetGame({ level, onFinish })),
  }),

  // ---- 猜宝可梦（guess-name）：独立小游戏页，从候选字里拼出宝可梦名字，答对累加气球 ----
  // 服务器 activity.json 里加一条 { "id": "guess-name", "from": …, "to": … }
  'guess-name': {
    name: '猜宝可梦',

    badge: coinBadge,

    ready() { return guessReady(); },

    render(ctx) {
      const solved = Number(ctx.slot.solved) || 0;
      const lv = guessLevelOf(ctx.slot.level || 'normal');
      return `
        <div class="act-card act-rules">从候选字里挑出能拼成名字的字，填满后点「确定」；点格子可以改填错的字。<br>
          困难档两行，按行首的属性图标把两只名字分行填；点「提示」划掉几个用不到的字，气球减半。</div>
        <div class="act-own">已答对 <b>${solved}</b> 题</div>
        <div class="act-levels">${GUESS_LEVELS.map(l => `<span class="act-level${l.id === lv.id ? ' on' : ''}" data-guess-level="${l.id}">${l.name}<em>${l.reward} 气球</em></span>`).join('')}</div>
        <div class="act-shop">${shopItemsOf(ctx).map(it => shopRowHtml(ctx, it)).join('')}</div>`;
    },

    mount(root, ctx) {
      // 点难度直接开局；换档就作废上一题，同档则是接着上次没答完的那题
      root.querySelectorAll('[data-guess-level]').forEach((el) => el.addEventListener('click', () => {
        const id = el.dataset.guessLevel;
        if ((ctx.slot.level || 'normal') !== id) { ctx.slot.level = id; ctx.slot.round = null; }
        ctx.save();
        import('./guess-game.js').then(m => m.startGuessGame({
          coins: coinsOf(ctx),
          solved: Number(ctx.slot.solved) || 0,
          level: ctx.slot.level || 'normal',
          round: ctx.slot.round || null,   // 上次退出去查图鉴时留下的那题
          // 每答对一题记一次账，中途退出也不丢
          onFinish: (coins) => {
            ctx.slot.coins = coinsOf(ctx) + coins;
            ctx.slot.solved = (Number(ctx.slot.solved) || 0) + 1;
            ctx.save();
          },
          // 换题 / 离开时把当前这题存下来，重进接着答
          onRound: (round) => { ctx.slot.round = round; ctx.save(); },
        }));
      }));
      root.querySelectorAll('[data-buy]').forEach((btn) => {
        btn.addEventListener('click', () => buyShopItem(ctx, btn.dataset.buy));
      });
    },

    // 每秒看一眼：气球/兑换状态/答对数/难度有变化才重画
    tick(root, ctx) {
      const key = `${coinsOf(ctx)}|${Object.keys(boughtOf(ctx)).sort().join(',')}|${Number(ctx.slot.solved) || 0}|${ctx.slot.level || ''}`;
      if (root.dataset.key !== key) { root.dataset.key = key; ctx.refresh(); }
    },
  },

  // ---- 航海寻宝（voyage）----
  // 服务器 activity.json 加 { "id": "voyage", "from": …, "to": …, "payload": { "seed": … } }
  // 数值（里程权重/门槛/零钱/速度）都是客户端常量，见文件顶部 VOYAGE_*
  'voyage': {
    name: '航海寻宝',

    badge(ctx) { return `<img src="./items/goods/ticket.png" alt="">${ctx.count('ticket')}`; },

    render(ctx) {
      voyageSlot(ctx);   // render 早于 mount，先把槽补全（pic/got 等）
      const board = VOYAGE_PUZZLE.map((_, i) => voyageCellHtml(ctx, i)).join('');
      return `
        <div class="voyage-stage">
          <canvas class="voyage-canvas"></canvas>
          <div class="voyage-hud">
            <div class="voyage-gauge" id="voyageGauge">
              <div class="voyage-gauge-ruler" id="voyageGaugeRuler"></div>
              <img class="voyage-gauge-ship" src="./icons/ship.png" alt="当前航程">
            </div>
          </div>
          <div class="voyage-wheel" id="voyageWheel">
            <canvas class="voyage-wheel-canvas" id="voyageWheelCv"></canvas>
            <svg class="voyage-wheel-pin" viewBox="0 0 20 32" aria-hidden="true">
              <path d="M10 0 L18.9 17.46 A10 10 0 1 1 1.1 17.46 Z"/>
            </svg>
          </div>
          <span class="catch-confirm-btn voyage-go" id="voyageGo">
            <img src="./items/goods/ticket.png" alt=""><i id="voyageGoText">起航</i>
          </span>
          <div class="voyage-toast" id="voyageToast"></div>
        </div>
        <div class="voyage-board" id="voyageBoard">${board}</div>`;
    },

    mount(root, ctx) {
      voyageStopRun();   // 重进/重画时先把上一次的 rAF 停掉，避免两套动画并存
      const s = voyageSlot(ctx);
      const assets = voyageAssets();
      const r = {
        ctx,
        root,
        stageEl: root.querySelector('.voyage-stage'),
        canvas: root.querySelector('.voyage-canvas'),
        gaugeEl: root.querySelector('#voyageGauge'),
        rulerEl: root.querySelector('#voyageGaugeRuler'),
        shipEl: root.querySelector('.voyage-gauge-ship'),
        nodeMap: new Map(),
        wheelEl: root.querySelector('#voyageWheel'),
        wheelCv: root.querySelector('#voyageWheelCv'),
        goEl: root.querySelector('#voyageGo'),
        goTextEl: root.querySelector('#voyageGoText'),
        lootEl: root.querySelector('#voyageToast'),
        badgeEl: document.getElementById('activityBadge'),
        puzzleCells: Array.from(root.querySelectorAll('.voyage-pc')),
        water: assets.water,
        ship: assets.ship,
        scrollX: 0, last: 0, saveAcc: 0, gotKey: '', badgeN: null, spin: null, loot: [],
        phase: s.seg ? 'sail' : 'idle',   // 刷新回来时若还在航行就接着开
      };
      voyageSizing(r);
      r.sized = r.w > 2;
      // 刷新回来时盘面仍是这一轮的候选，直接摆到结果位置
      voyageWheelDraw(r, s.seg, s.seg ? s.seg.target : -1);
      if (s.seg) r.wheelCv.style.transform = `rotate(${-(s.seg.target + 0.5) * (360 / s.seg.slots.length)}deg)`;
      // 点掉打捞提示等于确认看过，清空累积，之后只弹新打捞到的东西
      if (r.lootEl) r.lootEl.addEventListener('click', () => voyageLootClear(r));
      const boardEl = root.querySelector('#voyageBoard');
      if (boardEl) boardEl.addEventListener('click', (e) => {
        const pc = e.target.closest('.voyage-pc');
        if (pc) voyageOpenCell(ctx, Number(pc.dataset.cell));
      });
      if (r.goEl) r.goEl.addEventListener('click', () => {
        const cur = voyageSlot(ctx);
        // 置灰（票不足）时点一下给出获取途径；航行中点则不响应
        if (!cur.seg && ctx.count('ticket') < 1) {
          showConfirmBar('船票不足，活动期间提交悬赏可获得船票', null, null,
            { singleButton: true, host: document.getElementById('activityView') });
          return;
        }
        voyageStart(ctx, r);
      });
      r.onResize = () => { voyageSizing(r); r.sized = r.w > 2; };
      window.addEventListener('resize', r.onResize);
      _voyageRun = r;
      r.raf = requestAnimationFrame(voyageLoop);
    },

    // 页面在 rAF 里刷，这里不重画；只负责循环被切走暂停后把它唤醒
    tick() {
      const r = _voyageRun;
      if (r && !r.raf && voyageVisible()) { r.last = 0; r.raf = requestAnimationFrame(voyageLoop); }
    },

    unmount() { voyageStopRun(); },
  },
};
