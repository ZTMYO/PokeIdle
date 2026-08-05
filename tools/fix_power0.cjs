// 修复：给条件威力/特殊效果类攻击招补合理基础威力，使其正常输出伤害
import { readFileSync, writeFileSync } from 'fs';
const path = 'src/pokemon-data/moves.json';
const data = JSON.parse(readFileSync(path, 'utf8'));

// id -> 合理基础威力（取原作该类型招式的常见中间值）
const FIX = {
  12: 100, 32: 100, 90: 100, 329: 100,   // 一击必杀类（acc30，高风险高收益）
  67: 80,  447: 80,                       // 体重类 踢倒/打草结
  360: 80, 486: 80,                       // 速度类 陀螺球/电球
  484: 80, 535: 80,                       // 体重类 重磅冲撞/高温重压
  378: 100, 462: 100, 912: 100,           // HP类 绞紧/捏碎/硬压
  162: 90, 717: 90, 877: 90,              // 减半HP类 愤怒门牙/自然之怒/大灾难
  68: 100, 243: 100, 368: 100, 894: 100,  // 反击类 双倍奉还/镜面反射/金属爆炸/复仇
  117: 100,                               // 忍耐
  179: 120, 255: 150,                     // HP越低越强/蓄力类
  216: 102, 218: 102, 217: 90,            // 亲密度/礼物
  283: 100, 515: 100, 374: 60,            // 蛮干/搏命/投掷
  251: 25,                                // 围攻 → 多段攻击
};
const list = [];
for (const [id, pw] of Object.entries(FIX)) {
  const mv = data.moves[id];
  if (!mv) { console.log('missing', id); continue; }
  if (id === '251') {
    mv.effect = { kind: 'multihit', hits: [2, 5], cat: 'phys', power: pw };
  } else {
    mv.effect.power = pw;
    if (mv.power == null) mv.power = pw;
  }
  list.push(`${id}:${mv.name} -> ${pw}`);
}
writeFileSync(path, JSON.stringify(data), 'utf8');
writeFileSync('fix_result.txt', list.join('\n'), 'utf8');
console.log('fixed', list.length);
