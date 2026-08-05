// NPC 挑战：每 20 分钟刷新一波训练家（3 普通 + 2 精英 + 1 冠军）
// 名字/立绘取自 npcs.png 通用形象（与交换页同源）；队伍由各档宝可梦池随机组出，等级随玩家出战队伍最高等级递进
import { gameData, getPokemonByIndex, rollIvs, rollNature, randInt } from './state.js';
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

// 各档宝可梦池（图鉴号字符串，learnset.json 均有覆盖）
const MON_POOLS = {
  novice: ['0016', '0019', '0023', '0027', '0032', '0041', '0043', '0050', '0052', '0056',
           '0060', '0063', '0066', '0069', '0074', '0077', '0081', '0086', '0092', '0100',
           '0104', '0118', '0129', '0133', '0163', '0179', '0194', '0209', '0263', '0265',
           '0270', '0273', '0278', '0283', '0304', '0309', '0316', '0322', '0325', '0331',
           '0333', '0363', '0399', '0401', '0403', '0420'],
  veteran: ['0025', '0028', '0034', '0045', '0051', '0054', '0055', '0058', '0059', '0064',
            '0065', '0067', '0068', '0071', '0073', '0075', '0078', '0082', '0085', '0087',
            '0094', '0099', '0101', '0103', '0105', '0108', '0114', '0119', '0121', '0122',
            '0123', '0127', '0130', '0134', '0135', '0136', '0142', '0148', '0164', '0171',
            '0181', '0189', '0195', '0210', '0227', '0232', '0242'],
  champion: ['0003', '0006', '0009', '0034', '0059', '0065', '0068', '0094', '0112', '0130',
             '0143', '0145', '0146', '0149', '0150', '0248', '0380', '0381', '0384', '0445',
             '0448', '0475', '0491', '0534', '0635', '0645', '0646', '0706', '0784', '0800',
             '0809', '0887', '0892', '0908', '0911', '0914'],
};

const TIER_CFG = {
  novice:   { title: '普通', lvBonus: 0, candy: 5 },
  veteran:  { title: '精英', lvBonus: 4, candy: 10 },
  champion: { title: '冠军', lvBonus: 8, candy: 20 },
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
        mons: shuffle([...MON_POOLS[tier]]).slice(0, BATTLE_MONS_COUNT[tier]),
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

// 按玩家出战队伍最高等级生成 NPC 队伍（首只=基准等级，往后逐只低一级）；带谁打 NPC 就跟随谁，上限 MAX_LEVEL
export function buildNpcTeam(npc, data, learnset, maxLv) {
  const base = Math.max(3, Math.min(MAX_LEVEL, maxLv + npc.lvBonus));
  return npc.mons.map((idx, i) => {
    const pd = getPokemonByIndex(idx);
    const level = Math.min(MAX_LEVEL, base - i);
    const moveIds = chooseMoves(learnset[idx], level, data, { types: pd.types });
    return { pd, level, ivs: rollIvs(), nature: rollNature(), moveIds };
  });
}
