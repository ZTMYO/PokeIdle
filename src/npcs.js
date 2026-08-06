// NPC 挑战：每 20 分钟刷新一波训练家（3 普通 + 2 精英 + 1 冠军）
// 名字/立绘取自 npcs.png 通用形象（与交换页同源）；队伍由各档宝可梦池随机组出，等级随玩家出战队伍最高等级递进
import { gameData, allPokemon, getPokemonByIndex, rollIvs, rollNature, randInt } from './state.js';
import { chooseMoves } from './moves.js';
import { BATTLE_REFRESH_MS, BATTLE_NPC_COUNTS, BATTLE_MONS_COUNT, MAX_LEVEL } from './config.js';

// 通用训练家形象（sprite 为 npcs.png 拼图下标，13 列 × 2 行）
const NPC_FACES = [
  { sprite: 0, name: '男孩' },   { sprite: 1, name: '男孩' },   { sprite: 2, name: '男孩' },
  { sprite: 3, name: '捕虫少年' }, { sprite: 4, name: '露营少年' }, { sprite: 5, name: '钓鱼大叔' },
  { sprite: 6, name: '绅士' },   { sprite: 7, name: '女孩' },   { sprite: 8, name: '女孩' },
  { sprite: 9, name: '女孩' },   { sprite: 10, name: '登山男' }, { sprite: 11, name: '小男孩' },
  { sprite: 12, name: '小女孩' }, { sprite: 13, name: '男青年' }, { sprite: 14, name: '男青年' },
  { sprite: 15, name: '男青年' }, { sprite: 16, name: '男青年' }, { sprite: 17, name: '男青年' },
  { sprite: 18, name: '富家少爷' }, { sprite: 19, name: '研究员' }, { sprite: 20, name: '研究员' },
  { sprite: 21, name: '女青年' }, { sprite: 22, name: '女青年' }, { sprite: 23, name: '女青年' },
  { sprite: 24, name: '女青年' }, { sprite: 25, name: '女青年' },
];

// 各档宝可梦池：按种族值总和（BST）自动分档全国图鉴，三档区间交错重叠：
// - novice   BST ≤ 480（低 → 中低，约 620 只）
// - veteran  320 ≤ BST ≤ 570（中低 → 中高，约 690 只）
// - champion BST ≥ 440 且 rarity ≥ 0.5（中高 → 顶，约 530 只，偏高端）
// 覆盖与重叠：三档并集 = 全部 1025 只（全覆盖），低档的宝可梦在高档池里同样可能出现。
// allPokemon 由 setAllPokemon 运行时注入，这里惰性构建、首次调用缓存
let _npcPools = null;
function buildNpcPools() {
  const rows = allPokemon.map((p) => {
    const stats = p.stats || [];
    const bst = stats.length === 6 ? stats.reduce((a, b) => a + (+b || 0), 0) : 0;
    return { idx: String(p.index), bst, rarity: p.rarity ?? 0.5 };
  });
  return {
    novice: rows.filter((r) => r.bst <= 480).map((r) => r.idx),
    veteran: rows.filter((r) => r.bst >= 320 && r.bst <= 570).map((r) => r.idx),
    champion: rows.filter((r) => r.bst >= 440 && r.rarity >= 0.5).map((r) => r.idx),
  };
}
function getNpcPools() {
  if (!_npcPools) _npcPools = buildNpcPools();
  return _npcPools;
}

const TIER_CFG = {
  novice:   { title: '普通', lvBonus: 0, candy: 5 },
  veteran:  { title: '精英', lvBonus: 0, candy: 10 },
  champion: { title: '冠军', lvBonus: 2, candy: 20 },
};

// 洗牌（原地）
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 生成一波 NPC
function generateWave() {
  const faces = shuffle([...NPC_FACES]);
  const list = [];
  for (const tier of ['novice', 'veteran', 'champion']) {
    const cfg = TIER_CFG[tier];
    for (let i = 0; i < BATTLE_NPC_COUNTS[tier]; i++) {
      const f = faces.pop();
      list.push({
        id: `${tier}_${i}`,
        tier,
        title: cfg.title,
        name: f.name,
        sprite: f.sprite,
        lvBonus: cfg.lvBonus,
        candy: cfg.candy,
        mons: shuffle([...getNpcPools()[tier]]).slice(0, BATTLE_MONS_COUNT[tier]),
      });
    }
  }
  return list;
}

// 过期或缺失时生成新一波，返回当前 NPC 状态
export function ensureNpcs() {
  const b = gameData.battleNpcs;
  if (!b || !Array.isArray(b.list) || !b.refreshedAt || Date.now() - b.refreshedAt >= BATTLE_REFRESH_MS) {
    gameData.battleNpcs = { refreshedAt: Date.now(), list: generateWave() };
  }
  return gameData.battleNpcs;
}

// 强制刷新一波 NPC（无视是否到期，重置刷新时间）
export function refreshNpcs() {
  gameData.battleNpcs = { refreshedAt: Date.now(), list: generateWave() };
}

// 按玩家出战队伍最高等级生成 NPC 队伍（首只=基准等级，往后逐只低一级）；带谁打 NPC 就跟随谁，上限 MAX_LEVEL。
// 队伍物种取自生成波次时抽好的 npc.mons：刷新一波后同一 NPC 保持一套队伍不变（等级/个体/招式每次挑战仍会重 roll）
export function buildNpcTeam(npc, data, learnset, maxLv) {
  const base = Math.max(3, Math.min(MAX_LEVEL, maxLv + npc.lvBonus));
  return npc.mons.map((idx, i) => {
    const pd = getPokemonByIndex(idx);
    const level = Math.min(MAX_LEVEL, base - i);
    const moveIds = chooseMoves(learnset[idx], level, data, { types: pd.types });
    return { pd, level, ivs: rollIvs(), nature: rollNature(), moveIds };
  });
}
