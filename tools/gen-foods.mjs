// 重排全部宝可梦的喜爱树果（pokedex.json 的 foods，下标对应 items.js 的 BERRY_ICONS）
// 档位（作者 2026-10-10 定）：神兽/幻兽与极稀有 → 1 颗（最苛刻，孵蛋/训练只能用那一种）；
//                             中间 → 2 颗；常见 → 3 颗。
// 约束：同地区"能被树果方块召唤的"物种（非神兽/非强化形态/非进化终点）之间组合不能重复——
//       方块按配方精确匹配，撞了就只能召唤到其中一只。某档在当前地区被占满时自动往上让一档（档位界限不卡死）。
// 神兽与进化终点本来就不是方块目标，组合允许重复，只按档位随机给一个。
// 输出：只改 pokedex.json 的 foods 字段（固定种子，重跑结果一致）。用法：node tools/gen-foods.mjs [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEX = path.join(ROOT, 'src/pokemon-data/pokedex.json');
const EVO = path.join(ROOT, 'src/pokemon-data/evolution.json');
const BERRY_COUNT = 12;

// 固定种子 RNG：保证重跑一致，只在数据变化时才不同
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const shuffle = (arr, rnd) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const dex = JSON.parse(readFileSync(DEX, 'utf8'));
const evo = JSON.parse(readFileSync(EVO, 'utf8'));
const keep = new Set((evo.wildKeep || []).map(String));
const excluded = new Set();
for (const row of Object.values(evo.edges || {})) for (const to of Object.keys(row)) if (!keep.has(to) && !evo.edges[to]) excluded.add(String(to));
const powerForms = new Set(Object.keys(evo.stones || {}));

// 档位：神兽/幻兽与极稀有 1 颗、0.6 以上 2 颗、其余 3 颗
const tierOf = (p) => (p.legend || (p.rarity ?? 0.5) >= 0.8) ? 1 : ((p.rarity ?? 0.5) >= 0.6 ? 2 : 3);

// 组合池：1 / 2 / 3 颗（12 颗树果）
const combos = { 1: [], 2: [], 3: [] };
for (let a = 0; a < BERRY_COUNT; a++) {
  combos[1].push([a]);
  for (let b = a + 1; b < BERRY_COUNT; b++) {
    combos[2].push([a, b]);
    for (let c = b + 1; c < BERRY_COUNT; c++) combos[3].push([a, b, c]);
  }
}
const keyOf = (f) => [...f].sort((x, y) => x - y).join(',');

const byRegion = new Map();
for (const p of dex) { const r = p.region || '(无地区)'; if (!byRegion.has(r)) byRegion.set(r, []); byRegion.get(r).push(p); }

const dist = {};
let collisions = 0;
for (const [region, list] of byRegion) {
  const canSummon = (p) => !p.legend && !powerForms.has(String(p.index)) && !excluded.has(String(p.index));
  const candidates = list.filter(canSummon).sort((a, b) => (b.rarity ?? 0.5) - (a.rarity ?? 0.5) || String(a.index).localeCompare(String(b.index)));
  const candidateIdx = new Set(candidates.map((p) => p.index));
  const used = new Set();
  const pools = { 1: shuffle(combos[1], mulberry32(hash(region + '|1'))), 2: shuffle(combos[2], mulberry32(hash(region + '|2'))), 3: shuffle(combos[3], mulberry32(hash(region + '|3'))) };

  // 1) 方块目标：组合唯一；本档占满就往上让一档
  for (const p of candidates) {
    let pick = null, tier = tierOf(p);
    for (let n = tier; n <= 3 && !pick; n++) {
      const free = pools[n].find((c) => !used.has(keyOf(c)));
      if (free) { pick = free; tier = n; }
    }
    if (!pick) { // 极端兜底：3 颗也满了（每地区 298 个组合，正常不会发生）
      collisions++;
      pick = combos[3][hash(String(p.index)) % combos[3].length];
    }
    used.add(keyOf(pick));
    p.foods = pick;
    dist[tier] = (dist[tier] || 0) + 1;
  }
  // 2) 非目标（神兽/幻兽/强化形态/进化终点）：允许重复，只按档位随机
  for (const p of list) {
    if (candidateIdx.has(p.index)) continue;
    const tier = tierOf(p);
    p.foods = combos[tier][hash(String(p.index)) % combos[tier].length];
    dist[tier] = (dist[tier] || 0) + 1;
  }
}

// 自检：同地区方块目标之间不重复
let dup = 0;
for (const [, list] of byRegion) {
  const seen = new Set();
  for (const p of list) {
    if (p.legend || powerForms.has(String(p.index)) || excluded.has(String(p.index))) continue;
    const k = keyOf(p.foods);
    if (seen.has(k)) dup++;
    seen.add(k);
  }
}
console.log('档位分布（1/2/3 颗）:', JSON.stringify(dist));
console.log('方块目标组合冲突:', dup, '| 极端兜底:', collisions);
console.log('例：', dex.filter((p) => ['0001', '0133', '0144', '0150', '0383', '0257', '0490'].includes(p.index)).map((p) => `${p.index} ${p.name} ${JSON.stringify(p.foods)}`).join(' | '));

if (process.argv.includes('--dry')) {
  console.log('（--dry：未写入）');
} else {
  writeFileSync(DEX, JSON.stringify(dex, null, 4).split('\n').join('\r\n'));
  console.log('已写入', DEX);
}
