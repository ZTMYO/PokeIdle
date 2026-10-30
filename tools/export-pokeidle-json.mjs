// 生成 AstrBot 插件用的本地查询数据。不调用任何模型。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ITEM_NAMES, ITEM_DESC, CANDY_EXCHANGE, EVO_PRICES, MINT_NATURES, MINT_PRICE,
  EVO_EXCLUSIVE_PRICE, ITEM_SELL_RATE, ITEM_SELL_OVERRIDE, TM_SHOP_DAILY,
} from '../src/config.js';
import { NATURES } from '../src/battle-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'bot', 'astrbot_plugin_pokeidle_query', 'data', 'pokeidle.json');
const VER = '1.21.3';
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const dex = readJSON('src/pokemon-data/pokedex.json');
const moveDoc = readJSON('src/pokemon-data/moves.json');
const learnset = readJSON('src/pokemon-data/learnset.json');
const acquire = readJSON('src/pokemon-data/acquire.json');
const evo = readJSON('src/pokemon-data/evolution.json');
const moves = moveDoc.moves;
// 从 items.js 读取道具图标映射（纯对象字面量，运行时会求值）
const itemsSrc = fs.readFileSync(path.join(ROOT, 'src', 'items.js'), 'utf8');
const iconsAt = itemsSrc.indexOf('export const ITEM_ICONS = {');
const iconsEnd = iconsAt >= 0 ? itemsSrc.indexOf(String.fromCharCode(10) + '};', iconsAt) : -1;
const ITEM_ICONS = iconsAt >= 0 && iconsEnd > iconsAt
  ? Function('return (' + itemsSrc.slice(itemsSrc.indexOf('{', iconsAt), iconsEnd + 2) + ')')()
  : {};

const BERRY_FILES = ['aspear.png', 'cheri.png', 'chesto.png', 'leppa.png', 'lum.png', 'tamato.png', 'oran.png', 'pecha.png', 'rawst.png', 'sitrus.png', 'figy.png', 'wiki.png'];
const BERRY_NAMES = {
  'aspear.png': '利木果', 'cheri.png': '樱子果', 'chesto.png': '零余果', 'leppa.png': '苹野果',
  'lum.png': '木子果', 'tamato.png': '茄番果', 'oran.png': '橙橙果', 'pecha.png': '桃桃果',
  'rawst.png': '莓莓果', 'sitrus.png': '文柚果', 'figy.png': '勿花果', 'wiki.png': '异奇果',
};
const BERRY_DESC = {
  'cheri.png': '红得发亮的小巧红果，一口下去辣得舌尖发麻',
  'chesto.png': '深蓝色硬壳坚果状果子，入口带着浓重涩味',
  'pecha.png': '桃形的粉润果子，甜香醇厚，是很常见的树果',
  'rawst.png': '带着绿叶的蓝果，苦味突出，回味清冽凉爽',
  'aspear.png': '表皮带斑纹的小黄硬果，酸度极强，一咬就皱起眉头',
  'leppa.png': '形似小苹果的红橙果子，脆嫩多汁，越嚼越有风味',
  'oran.png': '圆润的深蓝色小果，随处可见，最为普通常见的树果',
  'sitrus.png': '个头偏大的梨形黄果，果肉厚实饱满，汁水充沛',
  'lum.png': '圆润青绿色果子，自带淡香，传言只生长在光照充足之处',
  'tamato.png': '外形酷似番茄的红果，辣度惊人，常用来做调味品',
  'figy.png': '外形酷似无花果的果子，辣中藏甜，味道浓烈刺激',
  'wiki.png': '表皮带凸起的紫果，名字奇特，清甜爽口，深受宝可梦喜爱',
};

const displayName = (p) => p?.form || p?.name || '';
const monByIndex = new Map(dex.map(p => [String(p.index), p]));
const nameOf = (idx) => {
  const p = monByIndex.get(String(idx));
  return p ? displayName(p) : `#${idx}`;
};
const idxKey = (s) => {
  const [a, b = '0'] = String(s).split('-');
  return [Number(a) || 0, Number(b) || 0];
};
const sortIndex = (a, b) => {
  const x = idxKey(a), y = idxKey(b);
  return x[0] - y[0] || x[1] - y[1];
};
const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const statNames = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
const clean = (v) => String(v ?? '').replace(/\r?\n/g, '；').replace(/\s+/g, ' ').trim();
const STATUS_CN = {
  sleep: '睡眠', poison: '中毒', burn: '灼伤', freeze: '冰冻',
  paralysis: '麻痹', confusion: '混乱', flinch: '畏缩', infatuation: '着迷',
};
const statusName = (s) => STATUS_CN[s] || s;
const statDelta = (s) => `${s.stat} ${s.delta > 0 ? '+' : ''}${s.delta}`;

function effectText(mv) {
  const e = mv.effect || {};
  if (mv.impl === false || e.kind === 'unimplemented') {
    return `未实装${e.note ? `（${clean(e.note)}）` : ''}`;
  }
  if (e.note) return clean(e.note);
  switch (e.kind) {
    case 'damage': {
      let s = `造成${e.cat === 'phys' ? '物理' : '特殊'}伤害`;
      if (e.attach) {
        const st = e.attach.statuses ? e.attach.statuses.map(statusName).join('/') : statusName(e.attach.status);
        s += `；${e.attach.chance || 100}% 使对手${st}`;
      }
      if (e.stat) s += `；${e.stat.chance || 100}% ${e.stat.target === 'self' ? '自身' : '对手'}${(e.stat.stats || []).map(statDelta).join('、')}`;
      return s;
    }
    case 'multihit':
      return `连续攻击 ${e.hits?.[0] === e.hits?.[1] ? e.hits[0] : `${e.hits?.[0]}~${e.hits?.[1]}`} 次，每次威力 ${e.power}`;
    case 'recoil':
      return `造成${e.cat === 'phys' ? '物理' : '特殊'}伤害；自身${e.halfHp ? '损失最大 HP 的一半' : `受到伤害的 1/${Math.round(1 / (e.ratio || 0.25))} 反伤`}`;
    case 'drain':
      return `造成${e.cat === 'phys' ? '物理' : '特殊'}伤害；回复伤害的 ${Math.round((e.ratio || 0.5) * 100)}%`;
    case 'stat':
      return `${e.target === 'self' ? '自身' : '对手'}${(e.stats || []).map(statDelta).join('、')}`;
    case 'status':
      return `${e.chance || 100}% 使${e.target === 'self' ? '自身' : '对手'}${statusName(e.status)}`;
    case 'heal':
      return `回复自身最大 HP 的 ${Math.round((e.ratio || 0.5) * 100)}%`;
    case 'fixed':
      if (mv.name === '音爆') return '固定造成 20 点伤害';
      if (mv.name === '龙之怒') return '固定造成 40 点伤害';
      return '固定造成等于自身等级的伤害';
    case 'wall':
      return `${e.wall === 'aura' ? '5 回合内物理和特殊伤害减弱' : `5 回合内${e.wall === 'phys' ? '物理' : '特殊'}伤害减半`}`;
    case 'weather':
      return `天气变为${({ sand: '沙暴', rain: '下雨', sun: '大晴天', hail: '冰雹' })[e.weather] || e.weather}`;
    case 'field':
      return `场地变为${({ grass: '青草', mist: '薄雾', electric: '电气', psychic: '精神' })[e.field] || e.field}场地`;
    case 'hazard':
      return `在对手场地布置${({ spikes: '撒菱', toxic: '毒菱', rock: '隐形岩' })[e.hazard] || e.hazard}`;
    case 'explode': return '造成伤害后自身倒下';
    case 'finalGambit': return '消耗自身剩余 HP 造成伤害';
    case 'counter': return '反弹受到的物理伤害';
    case 'mirrorCoat': return '反弹受到的特殊伤害';
    case 'protect': return '本回合守住，挡住对手攻击';
    case 'endure': return '受到致命伤害时保留 1 HP';
    case 'transform': return '变身为对手';
    case 'sleepRest': return '睡两回合并回满 HP';
    case 'substitute': return '消耗 1/4 最大 HP 制造替身';
    case 'bellyDrum': return '损失一半最大 HP，攻击提升到最大';
    case 'destinyBond': return '被击倒时对手一起倒下';
    case 'perishSong': return '3 回合后双方倒下';
    case 'haze': return '清除双方能力变化';
    case 'whirlwind': return '强制把对手换下场';
    case 'disable': return '封锁对手的招式';
    case 'mimic': return '复制对手最近使用的招式';
    case 'leechSeed': return '在对手身上种下寄生种子';
    case 'metronome': return '随机使用一个招式';
    case 'curse': return '诅咒（幽灵属性与其他属性效果不同）';
    case 'attract': return '使对手着迷';
    case 'cure': return '治愈全队异常状态';
    case 'healCure': return '回复 HP 并治愈异常状态';
    case 'regen': return '每回合回复少量 HP';
    case 'acupressure': return '随机大幅提升一项能力';
    case 'powerTrick': return '交换自身的攻击和防御';
    case 'swapStats': return `交换双方${(e.stats || []).join('、')}的能力变化`;
    case 'averageStats': return `平分双方${(e.stats || []).join('、')}的能力`;
    case 'topsyTurvy': return '颠倒对手的能力变化';
    case 'defog': return '清除场地障碍并降低对手闪避率';
    case 'memento': return '自身倒下，大幅降低对手攻击和防御';
    case 'painSplit': return '平分双方当前 HP';
    case 'batonPass': return '换人并保留自身能力变化';
    case 'encore': return '让对手重复使用上一招';
    case 'psychUp': return '复制对手的能力变化';
    case 'taunt': return '3 回合内对手只能使用攻击招式';
    default: return e.kind || '特殊效果';
  }
}

function condText(c) {
  if (!c) return '特殊条件';
  const p = [];
  if (c.lv != null) p.push(`Lv${c.lv}`);
  if (c.item) p.push(`使用${Array.isArray(c.item) ? c.item.join('或') : c.item}`);
  if (c.move) p.push(`掌握「${c.move}」`);
  if (c.region) p.push(`在${c.region}`);
  if (c.gender) p.push(c.gender === 'male' ? '雄性' : '雌性');
  if (c.incense) p.push('开熏香');
  if (c.candy) p.push(`消耗${c.candy}糖果`);
  if (c.coin) p.push(`消耗${c.coin}游戏币`);
  if (c.nature) p.push(`性格为${Array.isArray(c.nature) ? c.nature.join('/') : c.nature}`);
  if (c.note) p.push(clean(c.note));
  return p.join('、') || '特殊条件';
}

const outgoing = new Map();
const incoming = new Map();
for (const [from, targets] of Object.entries(evo.edges || {})) {
  for (const [to, cond] of Object.entries(targets || {})) {
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push({ to, cond });
    if (!incoming.has(to)) incoming.set(to, []);
    incoming.get(to).push({ from, cond });
  }
}
// acquire.json 里有进化表没收录的形态进化（超级进化/超极巨化等），补进同一张图
const seenEdges = new Set();
for (const [from, list] of outgoing) for (const e of list) seenEdges.add(`${from}>${e.to}`);
for (const p of acquire.pokemon) {
  for (const m of p.methods || []) {
    if (m.type !== 'evolve' || !m.from || seenEdges.has(`${m.from}>${p.index}`)) continue;
    const cond = m.cond || (m.item ? { item: m.item } : {});
    if (!outgoing.has(m.from)) outgoing.set(m.from, []);
    outgoing.get(m.from).push({ to: p.index, cond });
    if (!incoming.has(p.index)) incoming.set(p.index, []);
    incoming.get(p.index).push({ from: m.from, cond });
    seenEdges.add(`${m.from}>${p.index}`);
  }
}

function methodText(m, mon) {
  switch (m.type) {
    case 'wild': return `地区遭遇（${m.region}${mon?.legend ? '，神兽约 1/600、Lv20' : ''}）`;
    case 'tree': return `树果方块（${m.region}）`;
    case 'twist': return '时空扭曲';
    case 'trade': return '交换';
    case 'egg_shop': return '神秘蛋';
    case 'easter_author': return '彩蛋 ZTMYO（闪光 6V 神兽）';
    case 'easter_imiti': return '彩蛋 伊美蒂（百变怪，10% 6V）';
    case 'breed': {
      const p = [];
      if (m.parents?.length) p.push(`亲本：${m.parents.map(nameOf).join('、')}`);
      if (m.parentsIncense?.length) p.push(`需开熏香：${m.parentsIncense.map(nameOf).join('、')}`);
      if (m.note) p.push(clean(m.note));
      return `繁育${p.length ? `（${p.join('；')}）` : ''}`;
    }
    case 'evolve': {
      const p = [];
      if (m.from) p.push(`由${nameOf(m.from)}`);
      if (m.item) p.push(`使用${m.item}`);
      if (m.cond) p.push(condText(m.cond));
      return `进化${p.length ? `（${p.join('；')}）` : ''}`;
    }
    default: return m.type;
  }
}

function genderText(g) {
  if (g === -1) return '无性别';
  if (g === 0) return '仅雄性';
  if (g === 8) return '仅雌性';
  const f = (g / 8) * 100;
  return `雌 ${f}% / 雄 ${100 - f}%`;
}
function rarityText(v) {
  const n = Number(v) || 0;
  return n <= 0.2 ? '常见' : n <= 0.4 ? '一般' : n <= 0.6 ? '稀有' : n <= 0.8 ? '罕见' : '极稀有';
}

const tmIds = new Set();
const learners = new Map();
for (const [idx, ls] of Object.entries(learnset)) {
  const name = nameOf(idx);
  for (const id of ls.tm || []) { tmIds.add(Number(id)); learners.get(Number(id))?.push?.(name) || learners.set(Number(id), [name]); }
  for (const [, id] of ls.lv || []) { if (!learners.has(Number(id))) learners.set(Number(id), []); learners.get(Number(id)).push(name); }
  for (const id of ls.egg || []) { if (!learners.has(Number(id))) learners.set(Number(id), []); learners.get(Number(id)).push(name); }
}
for (const [id, arr] of learners) learners.set(id, [...new Set(arr)].sort());

const pokemon = dex.map(p => {
  const stats = p.stats || [];
  const total = stats.reduce((s, n) => s + (Number(n) || 0), 0);
  const ls = learnset[String(p.index)] || {};
  const out = (outgoing.get(String(p.index)) || []).sort((a, b) => sortIndex(a.to, b.to));
  const inc = (incoming.get(String(p.index)) || []).sort((a, b) => sortIndex(a.from, b.from));
  return {
    index: String(p.index),
    name: p.name,
    display: displayName(p),
    image: p.image || '',
    icon: p.icon || '',
    en: p.name_en || '',
    pinyin: p.pinyin || '',
    initials: p.pinyinInitials || '',
    types: p.types || [],
    stats: stats,
    total,
    catchRate: Number(p.catchRate) || 0,
    rarity: Number(p.rarity) || 0,
    rarityLabel: rarityText(p.rarity),
    region: p.region,
    legend: !!p.legend,
    genus: p.genus || '',
    heightM: (Number(p.height) || 0) / 10,
    weightKg: (Number(p.weight) || 0) / 10,
    description: p.description || '',
    foods: (p.foods || []).map(i => BERRY_NAMES[BERRY_FILES[i]] || `树果#${i}`),
    gender: genderText(Number(p.genderRate)),
    eggGroups: p.noEggGroup ? ['未发现蛋组（不能繁育）'] : (p.eggGroup || []),
    noEggGroup: !!p.noEggGroup,
    evolveOut: out.map(e => ({ to: e.to, name: nameOf(e.to), cond: condText(e.cond) })),
    evolveIn: inc.map(e => ({ from: e.from, name: nameOf(e.from), cond: condText(e.cond) })),
    acquire: (acquire.pokemon.find(x => x.index === p.index)?.methods || []).map(m => methodText(m, p)),
    moves: {
      lv: (ls.lv || []).map(([lv, id]) => ({ lv, name: moveOf(id)?.name || `#${id}`, id: Number(id) })),
      tm: (ls.tm || []).map(id => ({ name: moveOf(id)?.name || `#${id}`, id: Number(id) })),
      egg: (ls.egg || []).map(id => ({ name: moveOf(id)?.name || `#${id}`, id: Number(id) })),
    },
  };
});

function moveOf(id) { return moves[String(id)] || null; }

const moveList = Object.values(moves).map(mv => {
  const id = Number(mv.id);
  return {
    id,
    name: mv.name,
    type: mv.type,
    category: mv.category,
    power: mv.power,
    accuracy: mv.accuracy,
    pp: mv.pp,
    impl: mv.impl !== false,
    tm: tmIds.has(id),
    effect: effectText(mv),
    learners: learners.get(id) || [],
    catIcon: ({ '物理': 'tools/bot-icons/move-physical.png', '特殊': 'tools/bot-icons/move-special.png', '变化': 'tools/bot-icons/move-status.png' })[mv.category] || '',
  };
}).sort((a, b) => a.id - b.id);

// 形态总表
const formGroups = {};
for (const p of dex) {
  const base = String(p.index).split('-')[0];
  if (!formGroups[base]) formGroups[base] = [];
  formGroups[base].push({ index: String(p.index), name: displayName(p), region: p.region });
}
for (const base of Object.keys(formGroups)) {
  formGroups[base].sort((a, b) => sortIndex(a.index, b.index));
}

// 道具
const exclusiveSet = new Set(Object.values(evo.stones || {}));
const itemUses = new Map();
function addUse(item, from, to, cond) {
  if (!item) return;
  const line = `${nameOf(from)}→${nameOf(to)}（${condText(cond)}）`;
  if (!itemUses.has(item)) itemUses.set(item, []);
  if (!itemUses.get(item).includes(line)) itemUses.get(item).push(line);
}
for (const [from, targets] of Object.entries(evo.edges || {})) {
  for (const [to, cond] of Object.entries(targets || {})) {
    const items = Array.isArray(cond.item) ? cond.item : (cond.item ? [cond.item] : []);
    for (const item of items) {
      addUse(item, from, to, cond);
      if (!EVO_PRICES[item] && !MINT_NATURES[item] && item !== '极巨汤') exclusiveSet.add(item);
    }
  }
}
for (const p of acquire.pokemon) for (const m of p.methods || []) {
  if (m.type === 'evolve' && m.item) {
    addUse(m.item, m.from, p.index, m.cond || { item: m.item });
    if (!EVO_PRICES[m.item] && !MINT_NATURES[m.item] && m.item !== '极巨汤') exclusiveSet.add(m.item);
  }
}
const allKeys = new Set([
  ...Object.keys(ITEM_NAMES), ...Object.keys(ITEM_DESC), ...Object.keys(CANDY_EXCHANGE),
  ...Object.keys(EVO_PRICES), ...Object.keys(MINT_NATURES), ...exclusiveSet,
]);
function itemPrice(key) {
  if (key === 'candy' || key === 'casinoCoin') return { shop: null, sell: null, shopKind: null };
  const fixed = ITEM_SELL_OVERRIDE[key];
  const base = CANDY_EXCHANGE[key] ?? EVO_PRICES[key] ?? (MINT_NATURES[key] ? MINT_PRICE : null)
    ?? (exclusiveSet.has(key) ? EVO_EXCLUSIVE_PRICE : null);
  const sell = fixed != null ? fixed : (base != null ? Math.round(base * ITEM_SELL_RATE) : null);
  const shopKind = CANDY_EXCHANGE[key] != null ? 'shop'
    : (EVO_PRICES[key] != null || MINT_NATURES[key] || exclusiveSet.has(key)) ? 'daily' : null;
  const shop = CANDY_EXCHANGE[key] != null ? CANDY_EXCHANGE[key]
    : EVO_PRICES[key] != null ? EVO_PRICES[key]
      : MINT_NATURES[key] ? MINT_PRICE
        : exclusiveSet.has(key) ? EVO_EXCLUSIVE_PRICE : null;
  return { shop, sell, shopKind };
}
function itemSource(key) {
  if (key === 'candy') return '挂机拾取、钓鱼、悬赏、对战、成就、派遣、出售道具、老虎机';
  if (key === 'casinoCoin') return '游戏厅柜台 20 糖果 = 1 游戏币；游戏厅玩法';
  if (key === 'ticket') return '限时活动「航海寻宝」提交悬赏';
  if (key === 'exp-candy') return 'NPC 对战掉落、悬赏中档、放生经验池（3000 经验 = 1 颗）';
  if (key === 'master-ball') return '挂机拾取、商店 2000 糖果、钓鱼、对战、派遣、悬赏、活动；老虎机不出';
  if (key === 'shiny-charm') return '挂机拾取、商店 20000 糖果、钓鱼、对战、派遣、悬赏、活动；老虎机不出';
  if (key === 'mystery-egg') return '挂机拾取、商店 100 糖果、钓鱼、老虎机、活动';
  if (key === 'sweet-honey') return '挂机拾取、商店 40 糖果、钓鱼、对战、活动';
  if (key === 'bike') return '自行车道骑完离开路段获得、商店 200 糖果';
  if (key === 'poke-ball' || key === 'ultra-ball') return '挂机拾取、商店兑换、钓鱼、对战、派遣、悬赏、活动';
  if (EVO_PRICES[key] != null || MINT_NATURES[key] || exclusiveSet.has(key)) {
    return '商店「今日道具」（每天一批、每件限 1）、悬赏、派遣、钓鱼约 10%、NPC 对战、限时活动；不能路上拾取，老虎机不出';
  }
  return '按游戏内常规渠道获取';
}
function itemEffect(key) {
  if (key === 'ultra-ball') return '高级精灵球；基础捕获率 70%，额外 +6% 绝对捕获率，对稀有/神兽更明显';
  if (key === 'sweet-honey') return '使用后 60 秒内遇敌间隔缩短到 15~30 秒，极稀有出现权重 ×1.75';
  if (key === 'shiny-charm') return '使用后下一只普通野生遭遇必定闪光；60 秒内遇敌/钓鱼闪光率 5%、极稀有权重 ×2.25，20% 优先未解锁；保底只触发普通野生';
  if (key === 'mystery-egg') return '放入孵蛋器，行走 2~30 公里孵化；全图鉴随机，排除神兽/超级进化/超极巨化；闪光率 1/1000';
  if (MINT_NATURES[key]) {
    const n = NATURES[MINT_NATURES[key]];
    if (!n) return '使用后改变宝可梦的性格（无能力修正）';
    return `使用后性格变为「${key.replace(/薄荷$/, '')}」：${statNames[n.up]} +10%、${statNames[n.down]} -10%；消耗品，详情页点性格使用，不遗传`;
  }
  if (key === 'exp-candy') return '给一只宝可梦增加 3000 经验；背包第二页使用，满级不能使用';
  if (key === 'candy') return '游戏唯一主货币；用于商店兑换、孵蛋器槽位、农场种子、派遣槽位等';
  if (key === 'casinoCoin') return '游戏厅筹码；20 糖果 = 1 游戏币，用于下注、抽卡、麻将立直和少数进化条件';
  if (key === 'ticket') return '限时活动「航海寻宝」的船票；活动期间提交悬赏可获得';
  if (ITEM_DESC[key]) return clean(ITEM_DESC[key]);
  if (exclusiveSet.has(key)) {
    const uses = itemUses.get(key) || [];
    return uses.length ? `形态专属道具：用于${uses.join('、')}` : '形态专属进化道具';
  }
  return '进化/强化道具';
}

const itemList = [...allKeys].map(key => {
  const price = itemPrice(key);
  return {
    key,
    name: ITEM_NAMES[key] || key,
    icon: ITEM_ICONS[key] ? 'items/' + ITEM_ICONS[key] : (evo.stoneIcons && evo.stoneIcons[key] ? 'items/evo/stones/' + evo.stoneIcons[key] + '.png' : ''),
    effect: itemEffect(key),
    shop: price.shop,
    sell: price.sell,
    shopKind: price.shopKind,
    source: itemSource(key),
    uses: (itemUses.get(key) || []).slice(0, 40),
  };
}).sort((a, b) => a.name.localeCompare(b.name, 'zh'));

const berries = BERRY_FILES.map(f => ({
  name: BERRY_NAMES[f],
  file: f,
  icon: 'items/berries/' + f,
  effect: BERRY_DESC[f],
  use: '农场、混合器、训练、繁育；树果委托出售 8 糖果/颗',
  source: '农场种植收获、老虎机',
}));

const data = {
  version: VER,
  generatedAt: new Date().toISOString(),
  pokemon,
  formGroups,
  moves: moveList,
  items: itemList,
  berries,
  tmShopDaily: TM_SHOP_DAILY,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data), 'utf8');
console.log('generated', OUT, {
  pokemon: pokemon.length,
  moves: moveList.length,
  items: itemList.length,
  berries: berries.length,
  sizeMB: (fs.statSync(OUT).size / 1048576).toFixed(2),
});
