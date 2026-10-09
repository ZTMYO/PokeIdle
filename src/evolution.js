// ===== 进化系统 =====
// 数据表 src/pokemon-data/evolution.json：{ wildKeep, stones: { 形态编号: 道具名 }, stoneIcons, edges: { 来源: { 目标: 条件 } } }
// 条件字段 lv / item / move / region / candy / coin / pick / gender / incense，列出的都要满足。
// 本模块只读表与查询；条件判定与进化执行在第 4 步补上。

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
