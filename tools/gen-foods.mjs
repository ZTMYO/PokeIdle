// 生成与同地区已有宝可梦互不冲突的树果组合（foods 3 元下标，对应 items.js 的 BERRY_ICONS）
// 用法：node tools/gen-foods.mjs --region <地区名> [--count N]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BERRY_NAMES = ['利木果', '樱子果', '零余果', '苹野果', '木子果', '茄番果', '橙橙果', '桃桃果', '莓莓果', '文柚果', '勿花果', '异奇果'];

function parseArgs(argv) {
  const args = { region: null, count: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--region') args.region = argv[++i];
    else if (argv[i] === '--count') args.count = parseInt(argv[++i], 10) || 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.region) {
  console.error('用法：node tools/gen-foods.mjs --region <地区名> [--count N]');
  process.exit(1);
}

const pokedex = JSON.parse(readFileSync(path.join(ROOT, 'src/pokemon-data/pokedex.json'), 'utf8'));

// 收集目标地区已用组合（排序后判等，与 findBerryTarget 同规则）
const used = new Set();
for (const p of pokedex) {
  if (p.region !== args.region || !Array.isArray(p.foods)) continue;
  used.add(JSON.stringify([...p.foods].sort((a, b) => a - b)));
}

// 枚举全部 C(12,3) 组合，剔除已用的
const all = [];
for (let a = 0; a < 10; a++) for (let b = a + 1; b < 11; b++) for (let c = b + 1; c < 12; c++) all.push([a, b, c]);
const available = all.filter(k => !used.has(JSON.stringify(k)));
if (available.length === 0) {
  console.error(`地区「${args.region}」所有树果组合都已被占用，无法生成新组合`);
  process.exit(1);
}

// Fisher-Yates 洗牌取前 N 个
for (let i = available.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [available[i], available[j]] = [available[j], available[i]];
}
const picks = available.slice(0, args.count);

console.log(`地区「${args.region}」：已用 ${used.size} 个组合，可用 ${available.length} 个`);
picks.forEach((k, i) => {
  const names = k.map(x => BERRY_NAMES[x]).join('、');
  console.log(`  ${i + 1}. [${k.join(',')}]  ← ${names}`);
});
console.log('可粘贴 JSON：');
console.log(JSON.stringify(picks));