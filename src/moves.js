// 配招逻辑：从 learnset 过滤已实现招式 → 按规则选 4 招（STAB/打击面优先）→ 兜底补通用攻击招
// 输入：
//   learnsetEntry: { lv:[[等级,招式id]...], tm:[], egg:[] }
//   level: 当前等级
//   data: moves.json（{ id2name, moves }）
//   opts: { includeTm: false, types: [] }
// 输出：[招式id, ...] 最多 4 个

export function chooseMoves(learnsetEntry, level, data, opts = {}) {
  const { moves } = data;
  const includeTm = !!opts.includeTm;
  const cands = [];

  const lvMap = new Map();
  for (const [l, m] of learnsetEntry.lv || []) {
    if (!lvMap.has(m) || l < lvMap.get(m)) lvMap.set(m, l);
  }
  for (const [m, l] of lvMap) if (l <= level) cands.push(m);
  for (const m of learnsetEntry.egg || []) cands.push(m);
  if (includeTm) for (const m of learnsetEntry.tm || []) cands.push(m);

  const ok = new Set();
  for (const m of cands) {
    const mv = moves[m];
    if (!mv || mv.effect.kind === 'unimplemented') continue;
    ok.add(m);
  }
  if (ok.size === 0) return fallbackMoves(data);

  // 评分：攻击招优先 + STAB + 威力/命中加权
  const pokeTypes = opts.types || [];
  const scored = [...ok].map((m) => {
    const mv = moves[m];
    const ef = mv.effect;
    let s = 0;
    const isAtk = ef.kind === 'damage' || ef.kind === 'fixed' || ef.kind === 'multihit' || ef.kind === 'drain' || ef.kind === 'recoil' || ef.kind === 'counter';
    if (isAtk) {
      s += 20;
      const pw = ef.power || 0;
      const hits = ef.kind === 'multihit' ? 3 : 1; // 多段按 3 次期望
      s += pw * hits;
      s += (mv.accuracy || 100) / 100 * 12;
      if (pokeTypes.includes(mv.type)) s += 18; // STAB
      if (ef.attach) s += 8;                    // 附带状态
    } else {
      s += 6;
      if (ef.kind === 'heal') s += 6;
      if (ef.kind === 'stat') s += 4;
      if (ef.kind === 'protect' || ef.kind === 'endure') s += 8; // 守住/挺住：保命防护
      if (ef.kind === 'substitute') s += 6;                     // 替身：承伤站场
      if (ef.kind === 'leechSeed') s += 8;                      // 寄生种子：持续吸血
    }
    return { m, s };
  }).sort((a, b) => b.s - a.s);

  // 洗牌模式（NPC 队伍）：按评分加权随机选招——同品种同等级也会配出不同招式，
  // 评分越高越常被选中，仍受属性去重约束，保证质量下限
  if (opts.shuffle) {
    const picked = [];
    const typeCount = {};
    while (picked.length < 4) {
      // 属性去重：已选 2 招后，同属性攻击招限 1 个（与确定性分支一致）
      const pool = scored.filter(({ m }) =>
        !picked.includes(m) && !(picked.length >= 2 && (typeCount[moves[m].type] || 0) >= 1));
      if (!pool.length) break;
      const total = pool.reduce((a, b) => a + Math.max(b.s, 0) + 1, 0);
      let r = Math.random() * total;
      let pick = pool[pool.length - 1];
      for (const it of pool) {
        r -= Math.max(it.s, 0) + 1;
        if (r <= 0) { pick = it; break; }
      }
      picked.push(pick.m);
      typeCount[moves[pick.m].type] = (typeCount[moves[pick.m].type] || 0) + 1;
    }
    return picked;
  }

  // 打击面去重：贪心选 4，攻击招尽量不同属性（同属性最多 2 个）
  const picked = [];
  const typeCount = {};
  for (const { m } of scored) {
    if (picked.length >= 4) break;
    const mv = moves[m];
    if (picked.length >= 2) {
      // 已选 2 个后，同属性攻击招限 1 个（保证覆盖面）
      const atkCnt = typeCount[mv.type] || 0;
      if (atkCnt >= 1) continue;
    }
    picked.push(m);
    typeCount[mv.type] = (typeCount[mv.type] || 0) + 1;
  }
  // 若仍不足 4 招（变化招被限流），放宽属性限制补满
  for (const { m } of scored) {
    if (picked.length >= 4) break;
    if (!picked.includes(m)) picked.push(m);
  }
  return picked;
}

// 兜底：不足 4 招时补通用攻击招（撞击/抓/拍击）
export function fallbackMoves(data) {
  const want = ['撞击', '抓', '拍击'];
  const out = [];
  for (const name of want) {
    const id = Object.keys(data.id2name).find((k) => data.id2name[k] === name);
    if (id && data.moves[id] && data.moves[id].effect.kind !== 'unimplemented') out.push(parseInt(id, 10));
  }
  return out;
}
