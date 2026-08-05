// 生成招式补全清单：把 learnset 引用但 unimplemented（或机制降级）的招式按机制族归类
const { readFileSync, writeFileSync } = require('fs');

const data = JSON.parse(readFileSync('src/pokemon-data/moves.json', 'utf8'));
const learnset = JSON.parse(readFileSync('src/pokemon-data/learnset.json', 'utf8'));
const moves = data.moves;

// learnset 引用关系：招式id -> [宝可梦key]
const refBy = new Map();
for (const [pkey, e] of Object.entries(learnset)) {
  const ids = new Set();
  for (const [lv, m] of (e.lv || [])) ids.add(String(m));
  for (const m of (e.egg || [])) ids.add(String(m));
  for (const m of (e.tm || [])) ids.add(String(m));
  for (const id of ids) {
    if (!refBy.has(id)) refBy.set(id, new Set());
    refBy.get(id).add(pkey);
  }
}

// 机制族归类关键词：优先匹配更具体的族
const FAMILIES = [
  ['天气', /求雨|大晴天|沙暴|冰雹/],
  ['场地', /场地/],
  ['持续伤害/束缚', /寄生种子|绑紧|紧束|火焰旋涡|潮旋|流沙深渊|缠绕|勒住|灼热岩石/],
  ['回复类', /生蛋|喝牛奶|自我再生|偷懒|晨光|光合作用|月光|祈愿|羽栖|治愈波动|生命水滴|水流环|复生祈祷|新月舞|新月祈祷|丛林治疗|花疗|治愈铃声|焕然一新|芳香治疗/],
  ['光墙/反射壁', /光墙|反射壁|极光幕/],
  ['守住/先制', /守住|看穿|挺住|忍耐|击掌奇袭|快速防守|尖刺防守|碉堡|广域防守|火焰守护/],
  ['钉子/陷阱', /撒菱|毒菱|隐形岩/],
  ['换人/延迟', /接棒|追打|预知未来|同命|临别礼物|延后/],
  ['复制/模仿', /写生|模仿|仿效|挥指|鹦鹉学舌|扮演|变身|化为己用|特性互换|纹理|镜面属性|力量互换|防守互换|心灵互换|速度互换|单纯光束/],
  ['能力变化类', /剑舞|健美|冥想|龙之舞|高速移动|铁壁|破壳|诡计|岩切|磨爪|自我暗示|力量戏法|肚子鼓|腹鼓|重力|宇宙力量|生长|磨砺|号令|龙声鼓舞/],
  ['异常状态类', /催眠|麻痹|中毒|剧毒|灼伤|冰冻|混乱|畏缩|睡眠|睡觉|迷人|恶魔之吻|天使之吻|哈欠|催眠粉|蘑菇孢子/],
  ['挑衅/封印/阻挠', /挑衅|无理取闹|再来一次|定身法|封印|挡路|黑色目光|妖精之锁|烦恼种子|胃液/],
  ['伤害类', /吹飞|吼叫|拍落|蓄力|喷出|吞下/],
  ['其他', /.*/],
];

const famOf = (name) => {
  for (const [fam, re] of FAMILIES) if (re.test(name)) return fam;
  return '其他';
};

const lines = [];
lines.push('# 招式补全清单');
lines.push(`生成时间：${new Date().toISOString().slice(0, 10)}`);
lines.push('');
lines.push('说明：本清单列出 learnset 引用的、但战斗引擎暂未实现（unimplemented）或被降级的招式。');
lines.push('编号规则：招式id | 名称 | 属性/分类 | 被哪些宝可梦引用（示例）');
lines.push('');

// 收集所有被引用且 unimplemented 的招式
const used = new Map(); // id -> {name, fam, pokes}
for (const [id, mv] of Object.entries(moves)) {
  const refs = refBy.get(id);
  if (!refs || refs.size === 0) continue;
  if (mv.effect.kind !== 'unimplemented') continue;
  if (!used.has(id)) used.set(id, { name: mv.name, type: mv.type, cat: mv.category, fam: famOf(mv.name), pokes: new Set() });
  for (const p of refs) used.get(id).pokes.add(p);
}

// 按机制族分组
const byFam = new Map();
for (const [id, info] of used) {
  if (!byFam.has(info.fam)) byFam.set(info.fam, []);
  byFam.get(info.fam).push({ id, ...info });
}
for (const [, list] of byFam) list.sort((a, b) => Number(a.id) - Number(b.id));

const pokedex = (() => {
  try { return JSON.parse(readFileSync('src/pokemon-data/pokedex.json', 'utf8')); } catch { return null; }
})();

const pokeName = (key) => {
  if (!pokedex) return key;
  // pokedex 结构可能是 {id: {name}} 或 {key: {name}} 等，模糊取
  const e = pokedex[key] || pokedex[String(Number(key))];
  return e?.name || key;
};

const famOrder = [...byFam.keys()].sort((a, b) => {
  const idx = (f) => FAMILIES.findIndex(([n]) => n === f);
  return idx(a) - idx(b);
});

for (const fam of famOrder) {
  const list = byFam.get(fam);
  lines.push(`## ${fam}（${list.length} 个招式）`);
  for (const it of list) {
    const pokes = [...it.pokes].sort((a, b) => Number(a) - Number(b)).slice(0, 5).map(pokeName);
    const more = it.pokes.size > 5 ? `等${it.pokes.size}只` : '';
    lines.push(`- ${it.id} ${it.name} [${it.type}/${it.cat}] → ${pokes.join('、')}${more}`);
  }
  lines.push('');
}

writeFileSync('tools/补全清单.md', lines.join('\n'), 'utf8');
console.log('families:', famOrder.length, 'moves:', used.size);
