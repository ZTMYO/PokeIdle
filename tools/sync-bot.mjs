// 根据项目数据重建 bot/ 下的派生物，并生成「待上传清单」报告。
//
// 派生物（每次运行覆盖）：
//   bot/knowledge/data/图鉴-{地区}.md、招式学习-{地区}.md、招式数据.md、进化数据.md、形态总表.md
//   bot/astrbot_plugin_pokeidle_query/data/pokeidle.json（走 tools/export-pokeidle-json.mjs）
//   bot/astrbot_plugin_pokeidle_query.zip（插件安装包）
// 手写文件（脚本不动，只在报告里列为“无需同步”）：
//   00-总览 / FAQ / 术语与别名 / 联网与活动 / 故障排查 / 版本与更新 / 道具数据.md / 教程里那两篇补充文档
//
// 用法：
//   node tools/sync-bot.mjs          重建覆盖 + 打 zip + 写报告
//   node tools/sync-bot.mjs --check  只比对不落盘（看会改哪些文件）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as cfg from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOT = path.join(ROOT, 'bot');
const KB = path.join(BOT, 'knowledge');
const DATA = path.join(KB, 'data');
const PLUGIN = path.join(BOT, 'astrbot_plugin_pokeidle_query');
const CHECK = process.argv.includes('--check');
const DIFF = process.argv.includes('--diff');

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const dex = readJSON('src/pokemon-data/pokedex.json');
const moveDoc = readJSON('src/pokemon-data/moves.json');
const learnset = readJSON('src/pokemon-data/learnset.json');
const evo = readJSON('src/pokemon-data/evolution.json');
const acquire = readJSON('src/pokemon-data/acquire.json');

const MOVES = moveDoc.moves;
const TM_SET = new Set(Object.values(learnset).flatMap((l) => (l && l.tm) || []).map(Number));
const byIdx = new Map(dex.map((p) => [String(p.index), p]));
const REGIONS = ['关都', '城都', '丰缘', '神奥', '合众', '卡洛斯', '阿罗拉', '伽勒尔', '帕底亚'];
const BERRY_NAMES = ['利木果', '樱子果', '零余果', '苹野果', '木子果', '茄番果', '橙橙果', '桃桃果', '莓莓果', '文柚果', '勿花果', '异奇果'];
const STATS = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
const STATUS_CN = { sleep: '睡眠', poison: '中毒', burn: '灼伤', paralysis: '麻痹', freeze: '冰冻', confusion: '混乱', flinch: '畏缩' };

const displayName = (p) => (p && (p.form || p.name)) || '';
const idxParts = (k) => { const m = String(k).match(/^(\d+)(?:-(\d+))?$/); return m ? [Number(m[1]), m[2] === undefined ? -1 : Number(m[2])] : [Infinity, 0]; };
const cmpIdx = (a, b) => idxParts(a)[0] - idxParts(b)[0] || idxParts(a)[1] - idxParts(b)[1];
const nameOf = (i) => displayName(byIdx.get(String(i))) || `#${i}`;
// 亲本只写物种名：本体编号带着默认形态名（霜奶仙-草莓糖饰-奶香香草），名单里不该出现
const parentOf = (i) => {
  const p = byIdx.get(String(i));
  if (!p) return `#${i}`;
  return String(i).includes('-') ? (p.form || p.name) : p.name;
};
const rarityText = (r) => (r <= 0.2 ? '常见' : r <= 0.4 ? '一般' : r <= 0.6 ? '稀有' : r <= 0.8 ? '罕见' : '极稀有');
const pct = (x) => `${+(x * 100).toFixed(1)}%`;
function genderText(rate) {
  if (rate === undefined || rate === null) return '—';
  if (rate === -1) return '无性别';
  if (rate === 0) return '仅雄性';
  if (rate === 8) return '仅雌性';
  return `雌 ${pct(rate / 8)} / 雄 ${pct((8 - rate) / 8)}`;
}
const totalOf = (p) => (p.stats || []).reduce((a, b) => a + b, 0);
const moveName = (id) => (MOVES[id] ? MOVES[id].name : `#${id}`);
const moveImplemented = (id) => !!(MOVES[id] && MOVES[id].impl !== false);

// 进化条件 → 文案（图鉴与进化数据共用）：等级 → 道具/招式 → 性别/地区/性格 → 说明
function edgeCondText(cond) {
  const c = cond || {};
  const bits = [];
  if (c.lv) bits.push(`Lv${c.lv}`);
  if (c.item) bits.push(`使用${Array.isArray(c.item) ? c.item.join('或') : c.item}`);
  if (c.move) bits.push(/属性招式$/.test(c.move) ? `掌握「${c.move}」` : `掌握「${c.move}」`);
  if (c.candy) bits.push(`消耗${c.candy}糖果`);
  if (c.coin) bits.push(`消耗${c.coin}游戏币`);
  if (c.gender) bits.push(c.gender === 'female' ? '雌性' : '雄性');
  if (c.region) bits.push(`在${c.region}`);
  if (c.nature) bits.push(`性格为${Array.isArray(c.nature) ? c.nature.join('/') : c.nature}`);
  if (c.incense) bits.push('开熏香');
  if (c.note) bits.push(c.note);
  return bits.join('、');
}

// 获取方式 → 文案（图鉴用）
function methodText(m, p) {
  switch (m.type) {
    case 'wild':
      return p.legend ? `地区遭遇（${m.region || p.region}，神兽约 1/600、Lv20）` : `地区遭遇（${m.region || p.region}）`;
    case 'tree': return `树果方块（${m.region || p.region}）`;
    case 'twist': return '时空扭曲';
    case 'trade': return '交换';
    case 'egg_shop': return '神秘蛋';
    case 'easter_author': return '彩蛋 ZTMYO（闪光 6V 神兽）';
    case 'easter_imiti': return '彩蛋 伊美蒂（百变怪，10% 6V）';
    case 'breed': {
      const parts = [];
      if (m.parents && m.parents.length) parts.push(`亲本：${m.parents.map(parentOf).join('、')}`);
      if (m.parentsIncense && m.parentsIncense.length) parts.push(`需开熏香：${m.parentsIncense.map(parentOf).join('、')}`);
      if (m.note) parts.push(m.note);
      return parts.length ? `繁育（${parts.join('；')}）` : '繁育';
    }
    case 'evolve': {
      const cond = m.item ? `使用${m.item}` : edgeCondText(m.cond);
      return `进化（由${nameOf(m.from)}；${cond}）`;
    }
    default: return m.type;
  }
}

const outEdges = (idx) => Object.entries((evo.edges || {})[String(idx)] || {}).map(([to, cond]) => ({ to, cond }));
const inEdges = (idx) => {
  const out = [];
  for (const [from, row] of Object.entries(evo.edges || {})) if (row[String(idx)]) out.push({ from, cond: row[String(idx)] });
  return out;
};

// ---------- 图鉴 ----------
function dexMd(region) {
  const list = dex.filter((p) => p.region === region).sort((a, b) => cmpIdx(a.index, b.index));
  const body = list.map((p) => {
    const outs = outEdges(p.index);
    const ins = inEdges(p.index);
    const evoBits = [];
    if (outs.length) evoBits.push(outs.map((e) => `${nameOf(e.to)}（${edgeCondText(e.cond)}）`).join('；'));
    else evoBits.push('无进一步进化');
    if (ins.length) evoBits.push(`进化前身：${ins.map((e) => `${nameOf(e.from)}（${edgeCondText(e.cond)}）`).join('；')}`);
    return `### ${p.index} ${displayName(p)}（${p.name_en || ''}）
- 属性：${(p.types || []).join(' / ')}｜种族值：${totalOf(p)}（${(p.stats || []).map((v, i) => `${STATS[i]} ${v}`).join(' / ')}）
- 分类：${p.genus || '未知'}｜身高 ${(Number(p.height) / 10).toFixed(1)} m｜体重 ${(Number(p.weight) / 10).toFixed(1)} kg｜地区：${p.region}｜稀有度：${Number(p.rarity || 0).toFixed(4)}（${rarityText(Number(p.rarity || 0))}）
- 捕获率：${pct(Number(p.catchRate || 0))}｜性别：${genderText(p.genderRate)}｜蛋组：${(p.eggGroup || []).join('、') || '未发现蛋组'}｜神兽：${p.legend ? '是' : '否'}
- 图鉴：${p.description || ''}
- 爱吃：${(p.foods || []).map((i) => BERRY_NAMES[i] || `树果#${i}`).join('、') || '无'}
- 进化：${evoBits.join('｜')}
- 获取：${(acquire.pokemon.find((x) => x.index === p.index)?.methods || []).map((m) => methodText(m, p)).join('；')}
- 招式：${learnsetLine(p)}`;
  }).join('\n\n');
  return `# 宝可梦图鉴：${region}

> 共 ${list.length} 个条目。每条含属性、种族值、捕获率、稀有度、性别、蛋组、图鉴说明、爱吃树果、进化和获取方式；完整招式见同目录「招式学习-${region}」。

${body}
`;
}

function learnsetLine(p) {
  const l = learnset[p.index] || {};
  const lv = (l.lv || []);
  const tm = (l.tm || []);
  const egg = (l.egg || []);
  const head = lv.slice(0, 4).map(([level, id]) => `Lv${level} ${moveName(id)}`);
  return `升级 ${lv.length} 个、招式机 ${tm.length} 个、蛋招式 ${egg.length} 个；升级前几招：${head.join('、')}。完整列表见「招式学习-${p.region}」${p.index} 条。`;
}

// ---------- 招式学习 ----------
function learnsetMd(region) {
  const list = dex.filter((p) => p.region === region).sort((a, b) => cmpIdx(a.index, b.index));
  const body = list.map((p) => {
    const l = learnset[p.index] || {};
    const lv = (l.lv || []).map(([level, id]) => (level ? `Lv${level} ` : '') + moveName(id) + (moveImplemented(id) ? '' : '*'));
    const tm = (l.tm || []).map((id) => `${moveName(id)}${moveImplemented(id) ? '' : '*'}`);
    const egg = (l.egg || []).map((id) => `${moveName(id)}${moveImplemented(id) ? '' : '*'}`);
    const lines = [`### ${p.index} ${displayName(p)}`];
    lines.push(`- 升级：${lv.join('、') || '无'}`);
    lines.push(`- 招式机：${tm.join('、') || '无'}`);
    lines.push(`- 蛋招式：${egg.join('、') || '无'}`);
    return lines.join('\n');
  }).join('\n\n');
  return `# 招式学习：${region}

> 共 ${list.length} 个条目。升级招式按等级；招式机需先在商店解锁；蛋招式只有孵化得到的个体能学。带 * 的招式当前战斗未实装。

${body}
`;
}

// ---------- 招式数据 ----------
function effectText(mv) {
  const ef = mv.effect || {};
  if (mv.impl === false || ef.kind === 'unimplemented') return `未实装（${ef.note || ''}）`;
  if (ef.note) return ef.note;
  const cat = ef.cat === 'spec' ? '特殊' : '物理';
  switch (ef.kind) {
    case 'damage': {
      const base = `造成${cat}伤害`;
      const who = ef.stat && ef.stat.target === 'self' ? '自身' : '对手';
      const bits = [];
      if (ef.attach) {
        const list = (ef.attach.statuses || [ef.attach.status]).map((x) => STATUS_CN[x] || x).join('/');
        bits.push(`${ef.attach.chance ?? 100}% 使${who}${list}`);
      }
      if (ef.stat) {
        const stats = (ef.stat.stats || []).map((s) => `${s.stat} ${s.delta > 0 ? '+' : ''}${s.delta}`).join('、');
        bits.push(`${ef.stat.chance ?? 100}% ${who}${stats}`);
      }
      return bits.length ? `${base}；${bits.join('；')}` : base;
    }
    case 'multihit': {
      const [a, b] = ef.hits || [2, 5];
      return a === b ? `连续攻击 ${a} 次，每次威力 ${ef.power}` : `连续攻击 ${a}~${b} 次，每次威力 ${ef.power}`;
    }
    case 'stat': {
      const who = ef.target === 'self' ? '自身' : '对手';
      return (ef.stats || []).map((s, i) => `${i === 0 ? who : ''}${s.stat} ${s.delta > 0 ? '+' : ''}${s.delta}`).join('、');
    }
    case 'status': return `${ef.chance ?? 100}% 使对手${STATUS_CN[ef.status] || ef.status}`;
    case 'fixed': {
      const fixedPower = { 音爆: 20, 龙之怒: 40 }[mv.name];
      return fixedPower ? `固定造成 ${fixedPower} 点伤害` : '固定造成等于自身等级的伤害';
    }
    case 'recoil': return ef.halfHp
      ? `造成${cat}伤害；自身损失最大 HP 的一半`
      : `造成${cat}伤害；自身受到伤害的 1/${Math.round(1 / (ef.ratio || 0.25))} 反伤`;
    case 'attract': return `使${ef.target === 'self' ? '自身' : '对手'}着迷`;
    case 'drain': return `造成${cat}伤害；回复伤害的 ${Math.round((ef.ratio || 0.5) * 100)}%`;
    case 'heal': return `回复自身最大 HP 的 ${Math.round((ef.ratio || 0.5) * 100)}%`;
    case 'explode': return '造成伤害后自身倒下';
    case 'transform': return '变身为对手';
    case 'sleepRest': return '睡两回合并回满 HP';
    case 'substitute': return '消耗 1/4 最大 HP 制造替身';
    case 'protect': return '本回合守住，挡住对手攻击';
    case 'counter': return '反弹受到的物理伤害';
    case 'mirrorCoat': return '反弹受到的特殊伤害';
    case 'leechSeed': return '在对手身上种下寄生种子';
    case 'cure': return '治愈全队异常状态';
    case 'finalGambit': return '消耗自身剩余 HP 造成伤害';
    case 'endure': return '受到致命伤害时保留 1 HP';
    default: return ef.note || '';
  }
}

function movesMd() {
  const idOf = (m) => (Number.isFinite(m.id) ? m.id : 0);
  const list = Object.values(MOVES).sort((a, b) => idOf(a) - idOf(b));
  const body = list.map((m) => {
    const ef = m.effect || {};
    const power = m.power;
    return `- **${String(idOf(m)).padStart(3, '0')} ${m.name}**｜${m.type}｜${m.category}｜威力 ${power ? power : '—'}｜命中 ${m.accuracy == null || m.accuracy === 0 ? '—' : m.accuracy}｜PP ${m.pp == null ? '—' : m.pp}｜实装：${m.impl === false ? '否' : '是'}｜可作招式机：${TM_SET.has(Number(m.id)) ? '是' : '否'}｜效果：${effectText(m)}`;
  }).join('\n');
  return `# 招式数据

> 共 ${list.length} 个招式。威力/命中为 — 表示变化招或必中；「实装：否」表示数据里有、当前战斗未实现；「可作招式机」表示能通过商店招式机学习。

${body}
`;
}

// ---------- 进化数据 ----------
function familyIndex() {
  // 家族 = 进化关系的无向连通分量；表头取"没有进化前身"的最小成员（0440 小福蛋这种链根）
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const [from, row] of Object.entries(evo.edges || {})) {
    add(String(from));
    for (const to of Object.keys(row)) { add(String(to)); union(String(from), String(to)); }
  }
  const incoming = new Set();
  for (const [from, row] of Object.entries(evo.edges || {})) for (const to of Object.keys(row)) incoming.add(String(to));
  const comps = new Map();
  for (const node of parent.keys()) {
    const r = find(node);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(node);
  }
  const headOf = new Map();   // 成员 → 表头根编号
  for (const members of comps.values()) {
    const roots = members.filter((m) => !incoming.has(m)).sort(cmpIdx);
    const head = roots[0] || [...members].sort(cmpIdx)[0];
    for (const m of members) headOf.set(m, head);
  }
  return headOf;
}

function evolutionMd() {
  const headOf = familyIndex();
  const rows = [];
  for (const [from, row] of Object.entries(evo.edges || {})) {
    for (const [to, cond] of Object.entries(row)) rows.push({ from, to, cond, head: headOf.get(String(from)) });
  }
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.head)) groups.set(r.head, []);
    groups.get(r.head).push(r);
  }
  const parts = [...groups.keys()].sort(cmpIdx).map((head) => {
    const list = groups.get(head).sort((a, b) => cmpIdx(a.from, b.from) || cmpIdx(a.to, b.to));
    const body = list.map((r) => `- ${r.from} ${nameOf(r.from)} → ${r.to} ${nameOf(r.to)}：${edgeCondText(r.cond)}`).join('\n');
    return `## ${head} ${nameOf(head)}家族

${body}`;
  });
  return `# 进化数据

> 共 ${rows.length} 条进化关系。条件里的「掌握」指当前携带的 4 招；「使用」会消耗对应道具；「地区」要求人在该地区；形态编号带后缀（如 0003-1 是超级妙蛙花）。

${parts.join('\n\n')}
`;
}

// ---------- 形态总表 ----------
function formsMd() {
  const byBase = new Map();
  for (const p of dex) {
    const b = String(p.index).split('-')[0];
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(p);
  }
  const lines = [...byBase.keys()].sort(cmpIdx).map((b) => {
    const list = byBase.get(b).sort((x, y) => cmpIdx(x.index, y.index));
    if (list.length <= 1) return '';
    const base = list[0];
    return `- ${b} ${displayName(base)}（${base.region}，${list.length} 个形态）：${list.map((p) => `${p.index} ${displayName(p)}`).join('、')}`;
  }).filter(Boolean);
  return `# 形态总表

> 同一基础编号下的所有形态（换装、帽子、地区形态、超级进化、超极巨化等）合并成一行；问「XX 有哪些形态/品种」时优先用这一份。

${lines.join('\n')}
`;
}

// ---------- 教程章节（从 src/views.js 的 TUTORIAL_SECTIONS 还原） ----------
// views.js 依赖一堆浏览器模块，不能直接 import：只截出 tutorialTable + TUTORIAL_SECTIONS 这段，
// 用 config.js 的常量当参数在 Function 里求值，拿到每章的最终 HTML 再转文本。
function tutorialSections() {
  const viewsSrc = fs.readFileSync(path.join(ROOT, 'src', 'views.js'), 'utf8');
  const start = viewsSrc.indexOf('function tutorialTable(');
  const end = viewsSrc.indexOf('\n];', viewsSrc.indexOf('const TUTORIAL_SECTIONS = [')) + 3;
  if (start < 0 || end < 3) throw new Error('views.js 里找不到 TUTORIAL_SECTIONS');
  const grab = (file, name) => {
    const m = fs.readFileSync(path.join(ROOT, file), 'utf8').match(new RegExp(`export const ${name} = (\\d+);`));
    if (!m) throw new Error(`${file} 里找不到 ${name}`);
    return Number(m[1]);
  };
  const cfgKeys = Object.keys(cfg);
  const extra = { TEAM_MAX: grab('src/team.js', 'TEAM_MAX'), LUCK_WINDOW: grab('src/scoring.js', 'LUCK_WINDOW') };
  const fn = new Function(...cfgKeys, ...Object.keys(extra), viewsSrc.slice(start, end) + '\n; return TUTORIAL_SECTIONS;');
  return fn(...cfgKeys.map((k) => cfg[k]), ...Object.values(extra));
}

function tutorialMd(title, html) {
  // 表格：单元格转「 | 」，行尾换行；段落按 </p> 切，其余标签直接去掉
  const withTable = html.replace(/<table[^>]*>/g, '').replace(/<\/table>/g, '')
    .replace(/<t[hd][^>]*>/g, ' | ').replace(/<\/t[hd]>/g, '').replace(/<\/tr>/g, '\n');
  const paras = withTable.split('</p>')
    .map((s) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('| ') ? ` ${s}` : s));   // 表格首行前面留一个空格，与历史写法一致
  return `# 口袋挂机教程：${title}\n\n> 资料来自游戏内教程，数值可能随版本调整。\n\n${paras.join('\n\n')}\n`;
}


const changes = [];
// --diff：打印每个文件前几处行差异，方便调格式
function showDiff(rel, before, after) {
  if (!DIFF || before == null) return;
  const a = before.split('\n'), b = after.split('\n');
  let shown = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 3; i++) {
    if (a[i] === b[i]) continue;
    shown++;
    console.log(`[diff] ${rel}:${i + 1}\n  - ${(a[i] || '').slice(0, 160)}\n  + ${(b[i] || '').slice(0, 160)}`);
  }
}
function writeFile(rel, content) {
  const abs = path.join(ROOT, rel);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (before === content) return;
  showDiff(rel, before, content);
  const beforeLines = before == null ? 0 : before.split('\n').length;
  const afterLines = content.split('\n').length;
  changes.push({ rel, status: before == null ? '新增' : '更新', beforeLines, afterLines });
  if (!CHECK) fs.writeFileSync(abs, content, 'utf8');
}

// ---------- 插件安装包 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zipDir(dir) {
  const entries = [];
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '__pycache__') continue;
      const a = path.join(abs, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(a, r); }
      else entries.push({ name: r, data: fs.readFileSync(a) });
    }
  };
  const base = path.basename(dir);
  entries.push({ name: `${base}/`, data: null });
  walk(dir, base);
  entries.sort((a, b) => (a.name === `${base}/` ? -1 : b.name === `${base}/` ? 1 : 0));
  // 根目录条目必须排最前：AstrBot 解压按首条目建目录
  const ordered = [entries[0], ...entries.slice(1)];
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const en of ordered) {
    const nameBuf = Buffer.from(en.name, 'utf8');
    const raw = en.data || Buffer.alloc(0);
    const comp = raw.length ? zlib.deflateRawSync(raw) : Buffer.alloc(0);
    const crc = raw.length ? crc32(raw) : 0;
    const method = raw.length ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cenBuf, end]);
}

function main() {
  // 1) 知识库数据文档
  for (const region of REGIONS) {
    writeFile(`bot/knowledge/data/图鉴-${region}.md`, dexMd(region));
    writeFile(`bot/knowledge/data/招式学习-${region}.md`, learnsetMd(region));
  }
  writeFile('bot/knowledge/data/招式数据.md', movesMd());
  writeFile('bot/knowledge/data/进化数据.md', evolutionMd());
  writeFile('bot/knowledge/data/形态总表.md', formsMd());

  // 2) 教程章节（views.js 改了要跟着重出）
  try {
    const sections = tutorialSections();
    sections.forEach((sec, i) => {
      writeFile(`bot/knowledge/tutorial/${String(i + 1).padStart(2, '0')}-${sec.title}.md`, tutorialMd(sec.title, sec.html));
    });
  } catch (e) {
    console.warn('[sync-bot] 教程导出失败（其余文件照常处理）：' + e.message);
  }

  // 3) 插件数据与安装包
  if (!CHECK) {
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'export-pokeidle-json.mjs')], { cwd: ROOT, stdio: 'inherit' });
    const zipPath = path.join(BOT, 'astrbot_plugin_pokeidle_query.zip');
    const buf = zipDir(PLUGIN);
    const before = fs.existsSync(zipPath) ? fs.statSync(zipPath).size : 0;
    if (!fs.existsSync(zipPath) || fs.readFileSync(zipPath).compare(buf) !== 0) {
      fs.writeFileSync(zipPath, buf);
      changes.push({ rel: 'bot/astrbot_plugin_pokeidle_query.zip', status: before ? '更新' : '新增', beforeLines: before, afterLines: buf.length });
    }
  }

  // 4) 报告
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines = [];
  lines.push('# bot 同步报告', '');
  lines.push(`> 生成时间 ${stamp}｜模式 ${CHECK ? '只比对（--check）' : '已写入'}`, '');
  lines.push('## 本次变更', '');
  if (!changes.length) lines.push('派生物与项目数据一致，没有文件需要更新。');
  else {
    lines.push('| 文件 | 状态 | 变化 |', '|---|---|---|');
    for (const c of changes) lines.push(`| ${c.rel} | ${c.status} | ${c.beforeLines} → ${c.afterLines} ${c.rel.endsWith('.zip') ? '字节' : '行'} |`);
  }
  lines.push('');
  lines.push('## 需要手动上传到 AstrBot', '');
  if (!changes.length) lines.push('本次没有变更，不需要上传。');
  else {
    const kb = changes.filter((c) => c.rel.startsWith('bot/knowledge/'));
    if (kb.length) {
      lines.push('**知识库**（WebUI → 知识库：先删旧文档再传新文档，传完重建索引）：');
      for (const c of kb) lines.push(`- ${c.rel}`);
    }
    if (changes.some((c) => c.rel.endsWith('.zip'))) {
      lines.push('');
      lines.push('**插件**：`bot/astrbot_plugin_pokeidle_query.zip`');
      lines.push('- WebUI 直接传 zip 常 408 超时：改为把 zip 解压后的 `astrbot_plugin_pokeidle_query/` 覆盖到 `data/plugins/`，然后重启 AstrBot；日志里看到新版本号才算装上。');
    }
  }
  lines.push('');
  lines.push('## 脚本不动的文件（手写，改这些要自己动）', '');
  for (const f of ['bot/knowledge/00-总览.md', 'bot/knowledge/FAQ.md', 'bot/knowledge/术语与别名.md', 'bot/knowledge/联网与活动.md', 'bot/knowledge/故障排查.md', 'bot/knowledge/版本与更新.md', 'bot/knowledge/data/道具数据.md', 'bot/knowledge/tutorial/口袋麻将规则.md', 'bot/knowledge/tutorial/神兽机制说明.md', 'bot/prompts/system-prompt.md']) lines.push(`- ${f}`);
  lines.push('');
  lines.push('> 教程 01-49 章、图鉴 / 招式学习 / 招式 / 进化 / 形态都由本脚本重出；上面的手写文件改了才需要单独传。');
  lines.push('> 插件 zip 每次都算“有变化”（pokeidle.json 里带生成时间戳），数据没动时也可以不传。');
  lines.push('');
  writeFile('bot/同步报告.md', lines.join('\n'));
  // 报告本身不参与“变更”统计，单独打印
  changes.pop();

  const out = changes.length
    ? changes.map((c) => `  ${c.status} ${c.rel}`).join('\n')
    : '  没有变更';
  console.log(`[sync-bot] ${CHECK ? '只比对' : '已写入'}：\n${out}`);
  if (CHECK) console.log('（--check 模式不写文件）');
}

main();
