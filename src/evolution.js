// ===== 进化系统 =====
// 数据表 src/pokemon-data/evolution.json：{ wildKeep, stones: { 形态编号: 道具名 }, stoneIcons, edges: { 来源: { 目标: 条件 } } }
// 条件字段 lv / item / move / region / candy / coin / gender 列出的都要满足。
// incense 只给繁育用、不参与判定；nature 与 gender 是形态选择而不是门槛：由不得玩家挑，只列对得上的那条边。
import { gameData, getPokemonByIndex, getCurrentRegion, getNature, ensureGender, saveGame, addSystemLog } from './state.js';
import { updateBackpack, updateStats } from './ui.js';

let _data = null;
let _loading = null;

export function evolutionData() { return _data; }

export function loadEvolution() {
  if (_data) return Promise.resolve(_data);
  if (!_loading) {
    _loading = fetch('./pokemon-data/evolution.json')
      .then((r) => r.json())
      .then((d) => { _data = d; return d; })
      .catch((e) => { _loading = null; throw e; });
  }
  return _loading;
}

export function evoTargets(idx) {
  const row = _data && _data.edges[String(idx)];
  if (!row) return [];
  return Object.entries(row).map(([to, cond]) => ({ to, cond }));
}

// 野池可遇（路边口径）：进化链终点（有前代又不再进化）不进野池，幼体与中间态留在池里；
// wildKeep 里的形态例外照旧可遇。强化形态不归这里管（各处池子用 isPowerForm 挡）
export function isWildCatchable(idx) {
  if (!_data) return true;
  const key = String(idx);
  if ((_data.wildKeep || []).includes(key)) return true;
  return !(evoPreEvos(key).length > 0 && evoTargets(key).length === 0);
}

// 谁可以进化成它（含条件）：悬赏按获取成本定价要沿链往回找底子
let _rev = null;
export function evoPreEvos(idx) {
  if (!_data) return [];
  if (!_rev) {
    _rev = new Map();
    for (const [from, row] of Object.entries(_data.edges)) {
      for (const [to, cond] of Object.entries(row)) {
        if (!_rev.has(to)) _rev.set(to, []);
        _rev.get(to).push({ from, cond });
      }
    }
  }
  return _rev.get(String(idx)) || [];
}

// 强化形态要的道具名（去重），今日货架抽专属道具用
export function evoExclusiveNames() {
  if (!_data) return [];
  return [...new Set(Object.values(_data.stones))];
}

// 中文道具名 → 英文文件名
export function evoExclusiveIcons() {
  return (_data && _data.stoneIcons) || {};
}

// 中文道具名 → 形态编号（专属道具说明用）
export function evoExclusiveForms() {
  const out = {};
  if (!_data) return out;
  for (const [formIdx, name] of Object.entries(_data.stones)) if (!out[name]) out[name] = formIdx;
  return out;
}

// ---------- 条件判定 ----------
// 一条边要的道具；item 是数组时表示双道具，两件都要够
export function condItems(cond) {
  return cond.item ? (Array.isArray(cond.item) ? cond.item : [cond.item]) : [];
}

// 招式条件看当前携带的 4 招：entry.moves 手配过就用那 4 格，否则用自动配的那 4 招
// 「某招」＝带在身上，「X属性招式」＝带着的一招是该属性。moveIds / moveData 由调用方传入
function hasCondMove(entry, want, { moveIds, moveData } = {}) {
  if (!moveIds || !moveData) return false;
  if (/属性招式$/.test(want)) {
    const type = want.replace('属性招式', '');
    for (const id of moveIds) {
      const mv = moveData.moves[id];
      if (mv && mv.type === type) return true;
    }
    return false;
  }
  const id = Object.keys(moveData.id2name).find((k) => moveData.id2name[k] === want);
  return id != null && moveIds.has(String(id));
}

// 判一组条件：notes 是还不满足的地方，空数组代表条件齐了；unmet 按字段标记，UI 拿它给单个条件格灰显。
// hard 表示换时间或个体也没用，比如地区、性别。
function judgeCond(entry, cond, ctx) {
  const notes = [];
  const unmet = { items: new Set() };
  let hard = false;
  const lv = entry.level || 1;
  if (cond.lv && lv < cond.lv) { notes.push(`差 ${cond.lv - lv} 级`); unmet.lv = true; }
  for (const it of condItems(cond)) if ((gameData.items[it] || 0) <= 0) { notes.push(`缺 1 个${it}`); unmet.items.add(it); }
  if (cond.candy && (gameData.items.candy || 0) < cond.candy) { notes.push(`缺 ${cond.candy} 糖果`); unmet.candy = true; }
  if (cond.coin && (gameData.items.casinoCoin || 0) < cond.coin) { notes.push(`缺 ${cond.coin} 游戏币`); unmet.coin = true; }
  if (cond.move && !hasCondMove(entry, cond.move, ctx)) {
    notes.push(/属性招式$/.test(cond.move) ? `未携带${cond.move}` : `未携带「${cond.move}」`);
    unmet.move = true;
  }
  if (cond.gender && ensureGender(entry) !== cond.gender) {
    notes.push(cond.gender === 'female' ? '需要雌性' : '需要雄性');
    unmet.gender = true;
    hard = true;
  }
  if (cond.region) {
    if (getCurrentRegion().name !== cond.region) {
      notes.push(`需在${cond.region}地区进化`);
      unmet.region = true;
      hard = true;
    }
  }
  return { notes, unmet, ok: notes.length === 0, hard };
}

// 形态挂在个体身上的边，比如毒电婴按性格、妙喵按性别：对不上就不列，不摆不可能的路线
function individualFits(entry, cond) {
  if (cond.nature && !cond.nature.includes((getNature(entry.nature) || {}).cn)) return false;
  if (cond.gender && ensureGender(entry) !== cond.gender) return false;
  return true;
}

// 一只宝可梦的进化链：一行一条路线，进化边或强化形态；条件相同的多条边是并列的分支，各占一行。
export function evolutionRows(entry, ctx) {
  const idx = String(entry.species);
  const rows = [];
  for (const { to, cond } of evoTargets(idx)) {
    if (!individualFits(entry, cond)) continue;
    rows.push({ kind: 'edge', cond, targets: [to], ...judgeCond(entry, cond, ctx) });
  }
  // 强化形态：stones 里挂在自己编号下的那几条，stoneSource 写明这枚石头挂谁身上；
  // 老数据没写来源就退回「本体挂自己的强化形态」
  for (const [formIdx, item] of Object.entries((_data && _data.stones) || {})) {
    const from = (_data.stoneSource && _data.stoneSource[formIdx]) || String(formIdx).split('-')[0];
    if (from !== idx || !getPokemonByIndex(formIdx)) continue;
    const cond = { item };
    rows.push({ kind: 'form', cond, targets: [formIdx], ...judgeCond(entry, cond, ctx) });
  }
  return rows;
}

// ---------- 执行进化 ----------
// 扣掉这次要的东西 → 改 species → 图鉴 seen/evolved +1、caught 不动 → 遭遇日志 source 记 evo
export function applyEvolution(entry, to, cond) {
  const gd = gameData;
  const items = condItems(cond);
  for (const it of items) gd.items[it] = Math.max(0, (gd.items[it] || 0) - 1);
  if (cond.candy) gd.items.candy = Math.max(0, (gd.items.candy || 0) - cond.candy);
  if (cond.coin) gd.items.casinoCoin = Math.max(0, (gd.items.casinoCoin || 0) - cond.coin);
  const from = String(entry.species);
  entry.species = String(to);
  entry.lineage = { from, at: Date.now() };
  if (!gd.pokedex) gd.pokedex = {};
  if (!gd.pokedex[to]) gd.pokedex[to] = { seen: 0, caught: 0, lastTime: null, shinySeen: 0, shinyCaught: 0 };
  gd.pokedex[to].seen++;
  gd.pokedex[to].evolved = (gd.pokedex[to].evolved || 0) + 1;
  if (!gd.encounterLogs) gd.encounterLogs = {};
  if (!gd.encounterLogs[to]) gd.encounterLogs[to] = [];
  gd.encounterLogs[to].push({
    time: Date.now(), shiny: !!entry.shiny, result: 'caught', balls: {},
    source: 'evo', charmBuff: false, score: 0,
  });
  addSystemLog('evolve', { from, to });
  gd.stats.totalEvolutions = (gd.stats.totalEvolutions || 0) + 1;
  saveGame();
  for (const it of items) updateBackpack(it);
  updateStats();
  window.dispatchEvent(new CustomEvent('roster-changed')); // 物种变了，图鉴/交换/派遣红点都要重算
}
