// ===== 欧气评分系统 =====
// 每次"获得宝可梦"（普通遭遇 / 钓鱼 / 孵蛋）按真实概率链打分：
//   score = round(-log10(P_obtain) * 10) + fleeBonus  →  0~100，分越高越难得（越欧）
//
// P_obtain = P_pick × P_shiny × P_catch
//   P_pick  选中这只宝可梦的概率：普通遭遇=加权随机（含甜甜蜜/护符稀有度加成）、
//           钓鱼=钓到宝可梦概率 × 稀有/水系池占比、孵蛋=全图鉴均匀
//   P_shiny 本次闪光与否的概率：无护符 1/1000，护符 0.8；孵蛋恒为 1/1000（护符不影响蛋）
//   P_catch 捕获运气 = 1 - (1 - r)^N
//           r = 捕获成功那一下的实时捕获率（含捕获加成，越低越欧）
//           N = 总丢球数
//           一球抓到 → P = r（最难得，最欧）；丢球越多 → 累计成功率越高 → 越拖越不欧
//           （大师球 r=1 → P=1，0 分：用必中道具毫无运气成分）
//
// fleeBonus  逃跑判定运气：每次挣脱后按递增逃跑率判定（与 animation.js 一致），
//            连续躲过判定的运气只作次要加分（封顶 +5），
//            不会反过来让"丢很多球才抓住"比"一球抓住"更欧
//
// 说明：
// - 甜甜蜜/护符会放大稀有度权重与钓鱼出怪率，因此"带 buff 得到稀有"分数更低
// - 护符把闪光率拉到 0.8，护符下的闪光远不如无护符闪光珍贵
// - 未能捕获的记录（fled）不产生得分，score 记为 0

import {
  FLEE_CHANCE, FLEE_CHANCE_INC, FLEE_CHANCE_MAX, CATCH_BONUS_INC,
  SHINY_CHANCE, CHARM_SHINY_CHANCE,
  FISH_POKEMON_CHANCE, FISH_BUFF_POKEMON_CHANCE, FISH_RARE_RATE,
  HONEY_RARITY_BOOST, CHARM_RARITY_BOOST,
} from './config.js';
import { allPokemon, getCurrentRegion } from './state.js';

// 捕获加成生效阈值（与 battle.js 原逻辑一致）：逃跑率拉满（50%）后每多丢一球 +10%
const FLEE_MAXED_AT = Math.ceil((FLEE_CHANCE_MAX - FLEE_CHANCE) / FLEE_CHANCE_INC) + 1;

// 第 n 球的捕获加成系数（供 battle.js 丢球判定复用，保证打分与真实判定同源）
export function catchBonusFor(ballsUsed) {
  return 1 + Math.max(0, ballsUsed - FLEE_MAXED_AT) * CATCH_BONUS_INC;
}

// ---- P_pick：选中这只宝可梦的概率 ----
function pickProbability(pokemon, source, honeyBuff, charmBuff) {
  if (source === 'egg') {
    return allPokemon.length > 0 ? 1 / allPokemon.length : 1;
  }

  if (source === 'fishing') {
    const pool = allPokemon.filter(p => p.region === getCurrentRegion().name);
    const rarePool = pool.filter(p => (p.rarity || 0.5) > 0.8);
    const waterPool = pool.filter(p => (p.types || []).includes('水'));
    // 与 fishing.js pickFishingPokemon 一致：60% 稀有池 / 40% 水系池；所选池为空时退回另一池
    const pickRare = rarePool.includes(pokemon)
      ? 1 / rarePool.length
      : (rarePool.length === 0 && waterPool.includes(pokemon) ? 1 / waterPool.length : 0);
    const pickWater = waterPool.includes(pokemon)
      ? 1 / waterPool.length
      : (waterPool.length === 0 && rarePool.includes(pokemon) ? 1 / rarePool.length : 0);
    const fishChance = (honeyBuff || charmBuff) ? FISH_BUFF_POKEMON_CHANCE : FISH_POKEMON_CHANCE;
    const p = fishChance * (FISH_RARE_RATE * pickRare + (1 - FISH_RARE_RATE) * pickWater);
    return p > 0 ? p : 1;
  }

  // 普通遭遇：与 items.js pickRandomPokemon / pickWeightedPokemon 同款权重
  const pool = allPokemon.filter(p => p.region === getCurrentRegion().name);
  if (!pool.includes(pokemon)) return allPokemon.length > 0 ? 1 / allPokemon.length : 1; // 地区异常时兜底
  let rarityBoost = 0;
  if (honeyBuff) rarityBoost = Math.max(rarityBoost, HONEY_RARITY_BOOST);
  if (charmBuff) rarityBoost = Math.max(rarityBoost, CHARM_RARITY_BOOST);
  const penalty = Math.max(0.2, 0.8 - rarityBoost * 0.5);
  let total = 0;
  for (const p of pool) total += Math.max(0.01, 1 - (p.rarity ?? 0.5) * penalty);
  const w = Math.max(0.01, 1 - (pokemon.rarity ?? 0.5) * penalty);
  return w / total;
}

// ---- P_shiny：本次闪光与否的概率 ----
function shinyProbability(shiny, charmBuff, source) {
  if (charmBuff && source !== 'egg') {
    return shiny ? CHARM_SHINY_CHANCE : (1 - CHARM_SHINY_CHANCE);
  }
  return shiny ? SHINY_CHANCE : (1 - SHINY_CHANCE);
}

// ---- 捕获运气 + 逃跑判定运气 ----
// P_catch = 1 - (1 - r)^N：抓到的时间点落在 N 球内的累计成功率（N=1 时即成功那一下的捕获率 r）。
// 一球抓中 = 最难得 = 最欧；每多丢一球，累计成功率上升，运气成分相应下降。
// fleeBonus：N-1 次挣脱后各按递增逃跑率判定存活（animation.js 同款公式），
// 连续躲过判定的运气仅作次要加分，封顶 +5。
function catchLuck(balls, finalRate) {
  const N = balls ? Object.values(balls).reduce((a, b) => a + (b || 0), 0) : 0;
  if (N <= 0) return { p: 1, fleeBonus: 0 }; // 孵蛋等无丢球场景：无捕获运气成分
  const r = Math.min(finalRate, 1);
  const p = 1 - Math.pow(1 - r, N);
  let survive = 1;
  for (let i = 1; i < N; i++) {
    const flee = Math.min(FLEE_CHANCE + (i - 1) * FLEE_CHANCE_INC, FLEE_CHANCE_MAX);
    survive *= (1 - flee);
  }
  const fleeBonus = survive >= 1 ? 0 : Math.min(5, Math.round(-Math.log10(survive) * 3));
  return { p, fleeBonus };
}

// 相遇欧气分：即使没抓住（fled），遇到稀有宝可梦（尤其无 buff 时）本身也是欧气。
// P_meet = P_pick × P_shiny，即获得评分的前两项（不含捕获运气）。
export function computeMeetScore({ pokemon, source = 'normal', shiny = false, charmBuff = false, honeyBuff = false }) {
  const p = pickProbability(pokemon, source, honeyBuff, charmBuff) * shinyProbability(shiny, charmBuff, source);
  if (p <= 0 || !isFinite(p)) return 100;
  return Math.min(100, Math.max(0, Math.round(-Math.log10(p) * 10)));
}

// 计算一次"获得宝可梦"的欧气评分
// 参数：
//   pokemon    宝可梦对象（含 rarity / catchRate）
//   source     'normal' 普通遭遇 | 'fishing' 钓鱼 | 'egg' 孵蛋
//   shiny      是否闪光
//   charmBuff  该遭遇是否在闪耀护符 buff 下（护符把闪光率提到 0.8；孵蛋恒 false）
//   honeyBuff  该遭遇是否在甜甜蜜 buff 下（影响稀有度权重与钓鱼出怪率）
//   balls      累计已用球 { 'poke-ball': n, 'ultra-ball': n, 'master-ball': n }（含成功那颗）
//   finalRate  捕获成功那一下的实际捕获率（含捕获加成；无丢球场景传 1）
export function computeObtainScore({ pokemon, source = 'normal', shiny = false, charmBuff = false, honeyBuff = false, balls = {}, finalRate = 1 }) {
  const pPick = pickProbability(pokemon, source, honeyBuff, charmBuff);
  const pShiny = shinyProbability(shiny, charmBuff, source);
  const { p: pCatch, fleeBonus } = catchLuck(balls, finalRate);
  const p = pPick * pShiny * pCatch;
  if (p <= 0 || !isFinite(p)) return 100; // 概率下溢 → 顶格欧
  const score = Math.round(-Math.log10(p) * 10) + fleeBonus;
  return Math.min(100, Math.max(0, score));
}
