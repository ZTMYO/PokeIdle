import { $, showView, updateStats, tryLoadImage, hideTextBox, showConfirmBar } from './ui.js';
import { gameData, saveGame, pushNav, formatNum, addSystemLog } from './state.js';
import { playMahjongSfx } from './audio.js';
import { HAND_SIZE, RIICHI_COST } from './config.js';
import { showCasinoHistoryView } from './casino.js';


// ---------- 牌种（14 种 / 106 张） ----------
// 结构：5 对同系进化羁绊各含 10 点主力 + 5 点幼态一对（每种 9 张），4 只 20 点神兽（每种 4 张）
const SPECIES = [
  // 10 点主力（每种 9 张）
  { id: 94,  name: '耿鬼',     type: 'ghost',    pts: 10, tier: 'adv',    icon: './pokemon-data/icon/0094-耿鬼.png' },
  { id: 6,   name: '喷火龙',   type: 'fire',     pts: 10,  tier: 'adv',    icon: './pokemon-data/icon/0006-喷火龙.png' },
  { id: 9,   name: '水箭龟',   type: 'water',    pts: 10,  tier: 'adv',    icon: './pokemon-data/icon/0009-水箭龟.png' },
  { id: 3,   name: '妙蛙花',   type: 'grass',    pts: 10,  tier: 'adv',    icon: './pokemon-data/icon/0003-妙蛙花.png' },
  { id: 25,  name: '皮卡丘',   type: 'electric', pts: 10, tier: 'adv',    icon: './pokemon-data/icon/0025-皮卡丘.png' },
  // 5 点幼态（每种 9 张）
  { id: 92,  name: '鬼斯',     type: 'ghost',    pts: 5,  tier: 'low',    icon: './pokemon-data/icon/0092-鬼斯.png' },
  { id: 4,   name: '小火龙',   type: 'fire',     pts: 5, tier: 'low',    icon: './pokemon-data/icon/0004-小火龙.png' },
  { id: 7,   name: '杰尼龟',   type: 'water',    pts: 5, tier: 'low',    icon: './pokemon-data/icon/0007-杰尼龟.png' },
  { id: 1,   name: '妙蛙种子', type: 'grass',    pts: 5, tier: 'low',    icon: './pokemon-data/icon/0001-妙蛙种子.png' },
  { id: 172, name: '皮丘',     type: 'electric', pts: 5,  tier: 'low',    icon: './pokemon-data/icon/0172-皮丘.png' },
  // 20 点神兽（每种 4 张）
  { id: 151, name: '梦幻',     type: 'psychic',  pts: 20, tier: 'legend', icon: './pokemon-data/icon/0151-梦幻.png' },
  { id: 150, name: '超梦',     type: 'psychic',  pts: 20, tier: 'legend', icon: './pokemon-data/icon/0150-超梦.png' },
  { id: 250, name: '凤王',     type: 'fire',     pts: 20, tier: 'legend', icon: './pokemon-data/icon/0250-凤王.png' },
  { id: 249, name: '洛奇亚',   type: 'water',    pts: 20, tier: 'legend', icon: './pokemon-data/icon/0249-洛奇亚.png' },
];
const SPECIES_MAP = new Map(SPECIES.map(s => [s.id, s]));
const TIER_COUNT = { adv: 9, low: 9, legend: 4 };

const TYPE_COLORS = {
  electric: '#f6c700', fire: '#e75357', water: '#3f98ea', grass: '#3fa129',
  flying: '#81b9ef', normal: '#a8a095', bug: '#9cae1e', psychic: '#f8669c', ghost: '#7b4fa2',
};

const BETS = [5, 10, 25, 50, 100, 250];
const AI_NAMES = ['对家', '左家', '右家'];
const SEAT_NAMES = ['你', '对家', '左家', '右家']; // 座位号 0=玩家 1=对家 2=左家 3=右家
const NEXT = [2, 3, 1, 0]; // 顺时针下家（与发牌 DEAL_ORDER 同向）：玩家→左家→对家→右家→玩家
const DICE_CHARS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const DEAL_ORDER = [0, 2, 1, 3]; // 顺时针发牌：玩家→左家→对家→右家
const DEAL_STEP = 4;             // 每家每次发 4 张

// ---------- 对局状态 ----------
const st = {
  phase: 'bet',      // bet=下注 | player=玩家回合 | ai=AI 回合 | settle=结算
  turn: 0,           // 0=玩家 1/2/3=AI
  dealer: 0,         // 庄家座位（骰子决定，0=玩家 1=对家 2=左家 3=右家），庄家先手
  bet: 5,
  stake: 0,
  matchRound: 1,     // 东1局~东4局
  matchNet: 0,       // 本场累计净胜（游戏币）
  scores: [300, 300, 300, 300], // 四家本场累计分（0=你 1=对家 2=左家 3=右家，零和；整场以 300 分开局，符合本作低注额量级）
  resultStage: 1,    // 结算页阶段：1=结果+继续 2=四家分数+下一局 3=全场结算
  discarder: -1,     // 荣和放铳者座位（-1=无），结算四家局分用
  deck: [],
  dora: null,        // 宝牌（指示牌）
  player: [],
  ai: [[], [], []],
  meld: [],          // 玩家副露组
  aiMeld: [[], [], []],
  riichi: false,
  riichiPendingDiscard: false,
  riichiIdx: null,   // 宣言牌在弃牌河中的下标（侧放标记）
  aiRiichi: [false, false, false],
  aiRiichiPending: [false, false, false],
  aiRiichiIdx: [null, null, null],
  pendingPon: null,  // 玩家待碰 { id, from }
  pendingRon: null,   // 玩家待荣和 { id, from }（他家弃牌可胡，可选）
  pendingTsumo: false, // 玩家待自摸确认（摸牌即胡，可选）
  ponJust: false,    // 玩家刚碰完待打 1 张
  pDiscard: [],
  aDiscard: [[], [], []],
  lastDraw: null,
  result: null,
  lastResult: null,  // 上局结果文案（下注页展示）
  busy: false,
  dealing: false,    // 发牌中（禁用手牌 hover，且每次重建 DOM 后仍生效）
  ippatsu: false,    // 玩家立直后的一发窗口（他家有人碰即失效）
  wRiichi: false,    // 双重立直：本局第一张打出即宣言立直
  haitei: false,     // 海底：已摸到牌山最后一张（此后胡牌得海底役）
  tenhou: false,     // 天和：庄家第一摸即成胡（放弃则清除）
  firstDraw: false,  // 本局首摸标记（庄家第一摸，供天和判定）
  yakuPage: 0,       // 番型参考页当前页
  _resultPlayed: false, // 结算动画已播放（防二次 render 重播）
};

const coin = () => gameData.items['casinoCoin'] || 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 存档恢复 ----------
let _saveTimer = null;
function saveMahjongState() {
  // 防抖 300ms，避免短时间内多次写入
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (st.dealing) return; // 发牌中不存档，手牌不完整会导致恢复后卡死
    if (st.phase === 'bet' && st.matchRound === 1 && st.matchNet === 0) {
      delete gameData._mahjongState;
    } else {
      gameData._mahjongState = {
        phase: st.phase, turn: st.turn, dealer: st.dealer,
        bet: st.bet, stake: st.stake, matchRound: st.matchRound, matchNet: st.matchNet,
        scores: [...st.scores], deck: [...st.deck], dora: st.dora,
        player: [...st.player], ai: st.ai.map(a => [...a]),
        meld: st.meld.map(g => ({ id: g.id })),
        aiMeld: st.aiMeld.map(m => m.map(g => ({ id: g.id }))),
        riichi: st.riichi, riichiPendingDiscard: st.riichiPendingDiscard, riichiIdx: st.riichiIdx,
        aiRiichi: [...st.aiRiichi], aiRiichiPending: [...st.aiRiichiPending], aiRiichiIdx: [...st.aiRiichiIdx],
        pendingPon: st.pendingPon ? { id: st.pendingPon.id, from: st.pendingPon.from } : null,
        pendingRon: st.pendingRon ? { id: st.pendingRon.id, from: st.pendingRon.from } : null,
        pendingTsumo: st.pendingTsumo, ponJust: st.ponJust,
        pDiscard: [...st.pDiscard], aDiscard: st.aDiscard.map(d => [...d]),
        lastDraw: st.lastDraw, discarder: st.discarder,
        ippatsu: st.ippatsu, wRiichi: st.wRiichi, haitei: st.haitei,
        tenhou: st.tenhou, firstDraw: st.firstDraw,
        yakuPage: st.yakuPage, resultStage: st.resultStage, lastResult: st.lastResult,
        result: st.result ? { ...st.result, yaku: st.result.yaku.map(y => ({ ...y })), scores: [...st.result.scores], deltas: [...st.result.deltas], rank: [...st.result.rank], tiles: [...st.result.tiles] } : null,
      };
    }
    saveGame().then(updateStats);
  }, 300);
}
function restoreMahjongState(s) {
  st.phase = s.phase; st.turn = s.turn; st.dealer = s.dealer;
  st.bet = s.bet; st.stake = s.stake; st.matchRound = s.matchRound; st.matchNet = s.matchNet;
  st.scores = s.scores; st.deck = s.deck; st.dora = s.dora;
  st.player = s.player; st.ai = s.ai; st.meld = s.meld; st.aiMeld = s.aiMeld;
  st.riichi = s.riichi; st.riichiPendingDiscard = s.riichiPendingDiscard; st.riichiIdx = s.riichiIdx;
  st.aiRiichi = s.aiRiichi; st.aiRiichiPending = s.aiRiichiPending; st.aiRiichiIdx = s.aiRiichiIdx;
  st.pendingPon = s.pendingPon; st.pendingRon = s.pendingRon; st.pendingTsumo = s.pendingTsumo; st.ponJust = s.ponJust;
  st.pDiscard = s.pDiscard; st.aDiscard = s.aDiscard;
  st.lastDraw = s.lastDraw; st.discarder = s.discarder;
  st.ippatsu = s.ippatsu; st.wRiichi = s.wRiichi; st.haitei = s.haitei;
  st.tenhou = s.tenhou; st.firstDraw = s.firstDraw;
  st.yakuPage = s.yakuPage; st.resultStage = s.resultStage; st.lastResult = s.lastResult;
  st.result = s.result || null;
  st.busy = false; st.dealing = false;
  // 修复存档手牌总数异常：正常只有 8（待摸）或 9（待打）
  if (st.phase !== 'bet') {
    const total = playerTileTotal();
    if (total > 9) {
      const extra = total - 9;
      for (let i = 0; i < extra && st.player.length > 0; i++) {
        st.player.splice(Math.floor(Math.random() * st.player.length), 1);
      }
    } else if (total < 8 && st.deck.length >= (8 - total)) {
      for (let i = 0; i < (8 - total); i++) st.player.push(st.deck.pop());
    }
    sortHand(st.player);
  }
  delete gameData._mahjongState;
}

// ---------- 工具 ----------
function buildDeck() {
  const deck = [];
  for (const s of SPECIES) for (let i = 0; i < TIER_COUNT[s.tier]; i++) deck.push(s.id);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function countsOf(cards) {
  const m = new Map();
  for (const id of cards) m.set(id, (m.get(id) || 0) + 1);
  return m;
}
// 胡牌判定：手牌 + 副露共凑满 3 组刻子（无副露 9 张 / 1 组副露 6 张 / 2 组副露 3 张）
// 同种牌可拆多组刻子：6 张 = 2 刻、9 张 = 3 刻
function canWin(cards, meldCount = 0) {
  const target = 3 - meldCount;
  if (cards.length !== target * 3) return false;
  const m = countsOf(cards);
  let tris = 0;
  for (const n of m.values()) {
    if (n % 3 !== 0) return false;
    tris += n / 3;
  }
  return tris === target;
}
// 听牌：门清 9 张，打出 1 张单牌后剩余 8 张 = 2 组刻子 + 1 对（对子牌型牌堆仍有剩余）
// 同种牌可拆刻子+对子：5 张 = 1 刻 + 1 对、8 张 = 2 刻 + 1 对
function isReady(cards) {
  if (cards.length !== 9 || canWin(cards, 0)) return false;
  for (let i = 0; i < cards.length; i++) {
    const rest = cards.slice(0, i).concat(cards.slice(i + 1)); // 立直宣言需打 1 张
    const m = countsOf(rest);
    let tri = 0, pairId = null, ok = true;
    for (const [id, n] of m) {
      tri += (n - n % 3) / 3;          // 完整刻子数
      const rest2 = n % 3;
      if (rest2 === 2) { if (pairId !== null) { ok = false; break; } pairId = id; }
      else if (rest2 === 1) { ok = false; break; } // 单张→非听牌
    }
    if (ok && tri === 2 && pairId !== null && st.deck.includes(pairId)) return true;
  }
  return false;
}
// 打出第 i 张后是否仍听牌：返回听的牌 id 与牌堆剩余张数，无听返回 null
function tenpaiAfter(cards, i) {
  const rest = cards.slice(0, i).concat(cards.slice(i + 1));
  const m = countsOf(rest);
  let tri = 0, pairId = null, ok = true;
  for (const [id, n] of m) {
    tri += (n - n % 3) / 3;
    const r = n % 3;
    if (r === 2) { if (pairId !== null) { ok = false; break; } pairId = id; }
    else if (r === 1) { ok = false; break; }
  }
  if (!ok || tri !== 2 || pairId === null) return null;
  const left = st.deck.filter(id => id === pairId).length;
  return left > 0 ? { id: pairId, left } : null;
}
// 番型结算：手牌+副露合并；倍率=2+番数；役满固定×10
const EVO_PAIRS = [
  { adv: 94,  low: 92,  name: '幽影之绊' },    // 幽灵系进化对
  { adv: 4,   low: 6,   name: '烈焰之绊' },    // 火系进化对
  { adv: 7,   low: 9,   name: '激流之绊' },    // 水系进化对
  { adv: 1,   low: 3,   name: '绿叶之绊' },    // 草系进化对
  { adv: 25,  low: 172, name: '电气之绊' },    // 电系进化对
];
// 4 神兽役对照：20 点神兽（梦幻=幻之宝可梦 / 超梦=基因宝可梦 / 凤王=虹色圣鸟 / 洛奇亚=海神化身）
const LEGEND_YAKU = [
  { id: 151, name: '幻梦显现' },
  { id: 150, name: '超能觉醒' },
  { id: 250, name: '虹翼圣火' },
  { id: 249, name: '深蓝化身' },
];
// 5 种幻神组合役满：三组刻子恰好命中下列组合 → 固定 ×10
const MYTH_YAKUMAN = [
  { name: '幻神共鸣',     ids: [151, 249, 150] },  // 梦幻 + 洛奇亚 + 超梦
  { name: '幽冥幻境',     ids: [94, 151, 150] },   // 耿鬼 + 梦幻 + 超梦
  { name: '深渊梦魇',     ids: [94, 249, 150] },   // 耿鬼 + 洛奇亚 + 超梦
  { name: '梦境三重奏',   ids: [92, 151, 150] },   // 鬼斯 + 梦幻 + 超梦
  { name: '月夜魅影',     ids: [94, 92, 151] },    // 耿鬼 + 鬼斯 + 梦幻
];
// 番型参考（相助页展示）：name/番数/说明/关联卡牌
const YAKU_REF = [
  { name: '立直', fans: '1番', desc: '门清听牌时宣言，付1000游戏币立直', cards: [] },
  { name: 'W立直', fans: '1番', desc: '首巡宣言立直', cards: [] },
  { name: '自摸', fans: '1番', desc: '自己摸牌成胡', cards: [] },
  { name: '一发', fans: '1番', desc: '立直后一巡内胡牌', cards: [] },
  { name: '门清', fans: '1番', desc: '无碰牌副露直接胡牌', cards: [] },
  { name: '海底', fans: '1番', desc: '摸到牌山最后一张胡牌', cards: [] },
  { name: '宝牌', fans: '每组+1', desc: '宝牌刻子每组额外+1番（纯奖励番）', cards: [] },
  { name: '幽影之绊', fans: '1番', desc: '耿鬼 × 鬼斯', cards: [94, 92] },
  { name: '烈焰之绊', fans: '1番', desc: '喷火龙 × 小火龙', cards: [6, 4] },
  { name: '激流之绊', fans: '1番', desc: '水箭龟 × 杰尼龟', cards: [9, 7] },
  { name: '绿叶之绊', fans: '1番', desc: '妙蛙花 × 妙蛙种子', cards: [3, 1] },
  { name: '电气之绊', fans: '1番', desc: '皮卡丘 × 皮丘', cards: [25, 172] },
  { name: '幻梦显现', fans: '1番', desc: '梦幻刻子', cards: [151] },
  { name: '超能觉醒', fans: '1番', desc: '超梦刻子', cards: [150] },
  { name: '虹翼圣火', fans: '1番', desc: '凤王刻子', cards: [250] },
  { name: '深蓝化身', fans: '1番', desc: '洛奇亚刻子', cards: [249] },
  { name: '二组同刻', fans: '1番', desc: '同种牌凑齐2组刻子（共6张）', cards: [] },
  { name: '三色同刻', fans: '1番', desc: '3组刻子分属3种不同属性', cards: [] },
  { name: '混一色', fans: '2番', desc: '2组同属性刻子 + 1组神兽', cards: [] },
  { name: '清一色', fans: '4番', desc: '3组刻子全部同属性', cards: [] },
  { name: '王牌三刻', fans: '2番', desc: '3组全部为10点主力', cards: [] },
  { name: '潜力三刻', fans: '2番', desc: '3组全部为5点幼态', cards: [] },
  { name: '初始伙伴', fans: '3番', desc: '妙蛙种子 + 小火龙 + 杰尼龟', cards: [1, 4, 7] },
  { name: '自然之灵', fans: '4番', desc: '妙蛙种子 + 皮卡丘 + 凤王', cards: [1, 25, 250] },
  { name: '深海幽影', fans: '5番', desc: '鬼斯 + 洛奇亚 + 超梦', cards: [92, 249, 150] },
  { name: '单一种一色', fans: '役满', desc: '3组刻子全同种（×10）', cards: [] },
  { name: '天和', fans: '役满', desc: '庄家第一摸即胡（×10）', cards: [] },
  { name: '幻神共鸣', fans: '役满', desc: '梦幻+洛奇亚+超梦', cards: [151, 249, 150] },
  { name: '幽冥幻境', fans: '役满', desc: '耿鬼+梦幻+超梦', cards: [94, 151, 150] },
  { name: '深渊梦魇', fans: '役满', desc: '耿鬼+洛奇亚+超梦', cards: [94, 249, 150] },
  { name: '梦境三重奏', fans: '役满', desc: '鬼斯+梦幻+超梦', cards: [92, 151, 150] },
  { name: '月夜魅影', fans: '役满', desc: '耿鬼+鬼斯+梦幻', cards: [94, 92, 151] },
  { name: '神兽一色', fans: '役满', desc: '3组全神兽刻子（×10）', cards: [] },
];
function getYaku(cards, dora, meldIds = [], opts = {}) {
  const ids = [...countsOf([...cards, ...meldIds]).keys()];
  const groups = ids.map(id => SPECIES_MAP.get(id));
  const total = countsOf([...cards, ...meldIds]);
  const yaku = [];
  // 役满：单一种一色（3 组同种刻子）/ 天和（庄家第一摸）/ 5 种幻神组合 / 神兽一色（3 组神兽刻子）→ 固定 ×10，跳过其余所有番
  if (ids.length === 1 && total.get(ids[0]) === 9) {
    return { yaku: [{ name: '单一种一色', fans: '役满' }], fans: 0, mult: 10 };
  }
  if (opts.tenhou) {
    return { yaku: [{ name: '天和', fans: '役满' }], fans: 0, mult: 10 };
  }
  for (const c of MYTH_YAKUMAN) {
    if (ids.length === 3 && c.ids.every(id => ids.includes(id))) {
      return { yaku: [{ name: c.name, fans: '役满' }], fans: 0, mult: 10 };
    }
  }
  if (ids.length === 3 && groups.every(s => s.tier === 'legend')) {
    return { yaku: [{ name: '神兽一色', fans: '役满' }], fans: 0, mult: 10 };
  }
  // 流程役（立直/自摸/一发/门清/海底/W立直）
  if (opts.riichi) yaku.push({ name: '立直', fans: 1 });
  if (opts.wRiichi) yaku.push({ name: 'W立直', fans: 1 });
  if (opts.tsumo) yaku.push({ name: '自摸', fans: 1 });
  if (opts.ippatsu) yaku.push({ name: '一发', fans: 1 });
  if (opts.menzen) yaku.push({ name: '门清', fans: 1 });
  if (opts.haitei) yaku.push({ name: '海底', fans: 1 });
  // 宝牌：纯奖励番（无法单独作为胡牌役），每有一组宝牌刻子 +1（st.dora 为牌种 id，直接计数）
  if (dora) {
    const tris = Math.floor((total.get(dora) || 0) / 3);
    if (tris > 0) yaku.push({ name: '宝牌', fans: tris });
  }
  // 5 羁绊役：主力刻子 + 同系幼态刻子
  for (const p of EVO_PAIRS) {
    if (ids.includes(p.adv) && ids.includes(p.low)) yaku.push({ name: p.name, fans: 1 });
  }
  // 4 神兽役：每个神兽刻子 +1
  for (const l of LEGEND_YAKU) {
    if (ids.includes(l.id)) yaku.push({ name: l.name, fans: 1 });
  }
  // 二组同刻：同种牌凑齐 2 组完全一样的刻子（共 6 张）
  if ([...total.values()].some(n => n === 6)) yaku.push({ name: '二组同刻', fans: 1 });
  // 三色 / 混一色 / 清一色：神兽不计入色系判定，等同「白色功能牌」
  const normals = groups.filter(s => s.tier !== 'legend');
  if (normals.length === 3) {
    const types = new Set(normals.map(s => s.type));
    if (types.size === 1) yaku.push({ name: '清一色', fans: 4 });        // 3 组同属性
    else if (types.size === 3) yaku.push({ name: '三色同刻', fans: 1 }); // 3 组分属 3 种属性
  } else if (normals.length === 2 && new Set(normals.map(s => s.type)).size === 1) {
    yaku.push({ name: '混一色', fans: 2 }); // 同属性 + 神兽
  }
  // 复合役：王牌三刻（3 组 10 点主力）/ 潜力三刻（3 组 5 点幼态）
  if (ids.length === 3 && groups.every(s => s.tier === 'adv')) yaku.push({ name: '王牌三刻', fans: 2 });
  if (ids.length === 3 && groups.every(s => s.tier === 'low')) yaku.push({ name: '潜力三刻', fans: 2 });
  // 初始伙伴：妙蛙种子 + 小火龙 + 杰尼龟
  if ([1, 4, 7].every(id => ids.includes(id))) yaku.push({ name: '初始伙伴', fans: 3 });
  // 自然之灵：妙蛙种子 + 皮卡丘 + 凤王
  if ([1, 25, 250].every(id => ids.includes(id))) yaku.push({ name: '自然之灵', fans: 4 });
  // 深海幽影：鬼斯 + 洛奇亚 + 超梦
  if ([92, 249, 150].every(id => ids.includes(id))) yaku.push({ name: '深海幽影', fans: 5 });
  const fans = yaku.reduce((s, y) => s + y.fans, 0);
  return { yaku, fans, mult: 2 + fans };
}
// 属性彩虹排序（牌河从左到右）：火→电→草→水→幽灵（神兽系殿后，实际由 sortHand 置最左）；组内按点数降序
const TYPE_ORDER = ['fire', 'electric', 'grass', 'water', 'ghost', 'psychic'];
// 手牌排序：传说（粉色神兽）整体置最左，其余按彩虹顺序分属性排，组内点数降序（原地排序）
function sortHand(cards) {
  const isLegend = id => SPECIES_MAP.get(id).tier === 'legend';
  const legend = cards.filter(isLegend)
    .sort((a, b) => SPECIES_MAP.get(b).pts - SPECIES_MAP.get(a).pts || a - b);
  const typeRank = id => TYPE_ORDER.indexOf(SPECIES_MAP.get(id).type);
  const rest = cards.filter(id => !isLegend(id))
    .sort((a, b) => typeRank(a) - typeRank(b)
      || SPECIES_MAP.get(b).pts - SPECIES_MAP.get(a).pts
      || a - b);
  cards.length = 0;
  cards.push(...legend, ...rest);
  return cards;
}
// 玩家总牌数（含副露折算）：碰 1 次后手牌基准少 2 张，判断统一按此不变量
function playerTileTotal() {
  return st.player.length + st.meld.length * 3;
}
function cardHtml(id, opts = {}) {
  const s = SPECIES_MAP.get(id);
  const isLegend = s.tier === 'legend';
  const cls = ['mj-card', opts.fresh ? 'mj-fresh' : '', opts.mini ? 'mj-mini' : '', opts.flat ? 'mj-flat' : '', opts.riichi ? 'mj-riichi' : '', opts.doraHit ? 'mj-dora-hit' : ''].filter(Boolean).join(' ');
  const color = isLegend ? '#ff7eb3' : TYPE_COLORS[s.type];
  const card = `<div class="${cls}" style="--tc:${color}" data-id="${id}">
    <img class="mj-img" data-icon="${s.icon}" alt="${s.name}" draggable="false">
    <span class="mj-pts">${s.pts}</span>
  </div>`;
  // 夹层结构：绿 z1 → 白 z2 → 卡面 z3
  if (!opts.thick) return card;
  return `<div class="mj-stack">
    <span class="mj-layer mj-layer-outer"></span>
    <span class="mj-layer mj-layer-inner"></span>
    ${card}
  </div>`;
}

// ---------- 渲染 ----------
function render() {
  const box = $('mahjongContent');
  if (!box) return;
  if (st.phase === 'bet') {
    box.innerHTML = betHtml();
    // 加载番型参考 minicard 图片
    box.querySelectorAll('#mjYakuRef .mj-img').forEach(img => tryLoadImage(img, img.dataset.icon));
    bindBet(box);
    return;
  }
  box.innerHTML = tableHtml();
  fillTable(box);
  bindTable(box);
  startDoraShine();
  // 每次重绘后立即触发扫光，避免 AI 出牌时重建 DOM 导致扫光中断
  if (st.dora && st.phase !== 'bet') triggerDoraShine();
  // 每帧重绘后保存对局进度（发牌中不保存，避免手牌不完整）
  if ((st.phase === 'player' || st.phase === 'ai') && !st.dealing) saveMahjongState();
}

// ---------- 宝牌扫光 ----------
// 定时器独立触发，与 DOM 重渲染解耦
let _lastShineAt = 0;
function triggerDoraShine() {
  const now = Date.now();
  if (now - _lastShineAt < 3000) return; // 3 秒冷却，避免 AI 快速出牌时扫光狂闪
  _lastShineAt = now;
  $('mahjongContent')?.querySelectorAll('.mj-dora-hit').forEach(el => {
    el.classList.remove('mj-dora-flash');
    void el.offsetWidth; // 强制 reflow，确保动画重播
    el.classList.add('mj-dora-flash');
  });
}
let _doraShineTimer = null;
function startDoraShine() {
  if (_doraShineTimer) return;
  _doraShineTimer = setInterval(() => {
    if (!$('mahjongView') || $('mahjongView').style.display === 'none' || !st.dora) return;
    triggerDoraShine();
  }, 3500);
}

// ---------- 座位事件浮标 ----------
// 碰=绿色 / 胡&自摸=红色
function popSeatTag(seat, text, cls = '') {
  const el = $(`mjFloat${seat}`);
  if (!el) return;
  el.classList.remove('mj-float-show', 'mj-float-win');
  if (cls) el.classList.add(cls);
  // 保留 img 子元素，仅更新文本部分
  let txt = el.querySelector('.mj-float-txt');
  if (!txt) {
    txt = document.createElement('span');
    txt.className = 'mj-float-txt';
    el.appendChild(txt);
  }
  txt.textContent = text;
  void el.offsetWidth; // 强制 reflow，确保动画重播
  el.classList.add('mj-float-show');
}
function hideSeatTag(seat) {
  const el = $(`mjFloat${seat}`);
  if (el) el.classList.remove('mj-float-show');
}
// 浮标位置固定常量坐标（见 CSS）

// ---------- 碰/胡牌中央图标 ----------
// 在座位浮标旁显示半透明宝可梦 icon
function showPonIcon(seat, id) {
  const s = SPECIES_MAP.get(id);
  if (!s) return;
  const float = document.getElementById(`mjFloat${seat}`);
  if (!float) return;
  // 查找或创建 img
  let img = float.querySelector('.mj-float-icon');
  if (!img) {
    img = document.createElement('img');
    img.className = 'mj-float-icon';
    img.alt = '';
    float.insertBefore(img, float.firstChild);
  }
  tryLoadImage(img, s.icon);
}

function betHtml() {
  const balance = coin();
  const maxAffIdx = BETS.findIndex(b => b * 40 > balance);
  const sliderMax = maxAffIdx === -1 ? BETS.length - 1 : maxAffIdx - 1;
  if (sliderMax >= 0 && st.bet > BETS[sliderMax]) st.bet = BETS[sliderMax];
  const disabled = sliderMax < 0;
  const ticks = BETS.map((b, i) => `
    <div class="casino-bet-tick${b * 40 > balance ? ' off' : ''}${b === st.bet ? ' sel' : ''}"
      data-i="${i}" style="left:${(i / (BETS.length - 1)) * 100}%">
      <img class="casino-bet-coin" src="./items/coin.png" alt="">
      <span class="casino-bet-dot"></span>
      <span class="casino-bet-value">${formatNum(b)}</span>
    </div>`).join('');
  return `
    <div class="casino-app">
      <div class="casino-bet-area">
        <div class="casino-bet-body">
          <div class="casino-bet-label-row">
            <div class="casino-bet-label">选择下注档位</div>
            <button class="casino-history-btn" id="mjHistoryBtn">战绩</button>
          </div>
          <div class="casino-bet-slider${disabled ? ' disabled' : ''}">
            <div class="casino-bet-ticks">${ticks}</div>
          </div>
          <div class="casino-bet-row">
            <span class="casino-bet-amount">当前注额 <b>${formatNum(st.bet)}</b></span>
          </div>
          ${st.lastResult ? `<div class="casino-last">上一把：${st.lastResult}</div>` : ''}
        </div>
        <div class="mj-yaku-ref" id="mjYakuRef">
          ${yakuRefInner()}
        </div>
        <button class="bottom-dock" id="mStart" ${disabled ? 'disabled' : ''}>${balance <= 0 ? '请在柜台兑换游戏币再来' : '开始对局'}</button>
      </div>
    </div>`;
}

// 仅刷新番型参考区域，避免重建整个下注页 DOM
function refreshYakuRef() {
  const el = $('mjYakuRef');
  if (!el) return;
  el.innerHTML = yakuRefInner();
  el.querySelectorAll('.mj-img').forEach(img => tryLoadImage(img, img.dataset.icon));
  // 重建后重新绑定翻页按钮
  el.querySelector('#mjYakuPrev')?.addEventListener('click', () => {
    st.yakuPage = (st.yakuPage - 1 + YAKU_REF.length) % YAKU_REF.length;
    refreshYakuRef();
  });
  el.querySelector('#mjYakuNext')?.addEventListener('click', () => {
    st.yakuPage = (st.yakuPage + 1) % YAKU_REF.length;
    refreshYakuRef();
  });
}

function yakuRefInner() {
  const yaku = YAKU_REF[st.yakuPage] || YAKU_REF[0];
  const yakuCardsHtml = yaku.cards.length
    ? yaku.cards.flatMap(id => [id, id, id]).map(id => cardHtml(id, { mini: true })).join('')
    : `<span class="mj-yaku-desc">${yaku.desc}</span>`;
  const isYakuman = yaku.fans === '役满';
  return `
    <div class="mj-yaku-info">
      <span class="mj-yaku-name">${yaku.name}</span>
      <span class="mj-yaku-fans${isYakuman ? ' yakuman' : ''}">${yaku.fans}</span>
    </div>
    <div class="mj-yaku-row">
      <div class="mj-yaku-cards">${yakuCardsHtml}</div>
      <div class="mj-yaku-nav">
        <button class="mj-yaku-nav-btn" id="mjYakuPrev" title="上一个番型"><svg class="mj-yaku-arrow"><use xlink:href="./icons/sprites.svg#icon-unfold"></use></svg></button>
        <button class="mj-yaku-nav-btn" id="mjYakuNext" title="下一个番型"><svg class="mj-yaku-arrow"><use xlink:href="./icons/sprites.svg#icon-unfold"></use></svg></button>
      </div>
    </div>`;
}

function bindBet(box) {
  for (const t of box.querySelectorAll('.casino-bet-tick')) t.addEventListener('click', () => {
    if (t.classList.contains('off') || st.phase !== 'bet') return;
    st.bet = BETS[+t.dataset.i];
    render();
  });
  box.querySelector('#mStart')?.addEventListener('click', beginMatch);
  box.querySelector('#mjHistoryBtn')?.addEventListener('click', () => showCasinoHistoryView('mj'));
  box.querySelector('#mjYakuPrev')?.addEventListener('click', () => {
    st.yakuPage = (st.yakuPage - 1 + YAKU_REF.length) % YAKU_REF.length;
    refreshYakuRef();
  });
  box.querySelector('#mjYakuNext')?.addEventListener('click', () => {
    st.yakuPage = (st.yakuPage + 1) % YAKU_REF.length;
    refreshYakuRef();
  });
}

function tableHtml() {
  return `
    <div class="mahjong-app">
      <div class="mj-table">
        <div class="mj-seat top" id="mjSeatOpp">
          <div class="mj-meld mj-meld-h" id="mjMeld0"></div>
          <div class="mj-wall mj-wall-h" id="mjWall0"></div>
        </div>
        <div class="mj-seat left" id="mjSeatL">
          <div class="mj-wall mj-wall-v" id="mjWall1"></div>
          <div class="mj-meld mj-meld-v" id="mjMeld1"></div>
        </div>
        <div class="mj-seat right" id="mjSeatR">
          <div class="mj-wall mj-wall-v" id="mjWall2"></div>
          <div class="mj-meld mj-meld-v" id="mjMeld2"></div>
        </div>
        <div class="mj-seat bottom" id="mjSeatP">
          <div class="mj-hand" id="mjPlayerHand"></div>
          <div class="mj-meld mj-meld-h mj-player-meld" id="mjPlayerMeld"></div>
        </div>
        <div class="mj-center">
          <div class="mj-river-box">
            <div class="mj-river-ring">
              <div class="mj-riichi-slot top" id="mjRiichi0"></div>
              <div class="mj-riichi-slot left" id="mjRiichi1"></div>
              <div class="mj-riichi-slot right" id="mjRiichi2"></div>
              <div class="mj-riichi-slot bottom" id="mjRiichiP"></div>
            </div>
            <div class="mj-river" id="mjRiver"></div>
            <div class="mj-river-center">
              <div class="mj-center-main">
                <div class="mj-dora"><div class="mj-dora-card" id="mjDora"></div></div>
                <div class="mj-c-info">
                  <span class="mj-c-label" id="mjRound">东1局</span>
                  <span class="mj-c-label" id="mjStake"></span>
                </div>
              </div>
              <div class="mj-msg" id="mjMsg"></div>
            </div>
            <div class="mj-msg-actions" id="mjMsgBtns" hidden>
              <div class="mj-pon-card" id="mjPonCard"></div>
              <button class="casino-btn main" id="mjRon" hidden>胡！</button>
              <button class="casino-btn" id="mjPon">碰！</button>
              <button class="casino-btn" id="mjPass">放弃</button>
              <button class="casino-btn main" id="mjRiichi">立直</button>
            </div>
          </div>
        </div>
      </div>
      <div class="mj-result" id="mjResult" hidden></div>
      <div class="mj-tenpai-pop" id="mjTenpaiPop" hidden></div>
      <!-- 座位事件浮标顶层浮层：放在最顶层（高于结算遮罩），每次渲染后按座位实际位置对齐 -->
      <div class="mj-float-layer" id="mjFloatLayer">
        <div class="mj-float" id="mjFloat1"></div>
        <div class="mj-float" id="mjFloat2"></div>
        <div class="mj-float" id="mjFloat3"></div>
        <div class="mj-float" id="mjFloat0"></div>
      </div>
    </div>`;
}

function fillTable(box) {
  box.querySelector('#mjRound').textContent = `东${st.matchRound}局`;
  box.querySelector('#mjStake').textContent = `下注 ${formatNum(st.stake)}`;
  box.querySelector('#mjDora').innerHTML = st.dora == null ? '' : cardHtml(st.dora, { mini: true });

  // 各家暗牌：对家牌背叠层 / 左右家竖向盖牌；赢家手牌移至副露
  const revealSeat = st.phase === 'settle' && typeof st.result?.winner === 'number' ? st.result.winner : -1;
  const wallHtml = (i) => {
    const cards = st.ai[i];
    if (revealSeat === i + 1) return ''; // 赢家手牌已移至 meld
    if (i === 0) return cards.map(() => `
      <div class="mj-stack mj-back-stack">
        <span class="mj-layer mj-layer-outer"></span>
        <span class="mj-layer mj-layer-inner"></span>
        <div class="mj-back-card">
          <svg class="mj-back-icon"><use xlink:href="./icons/sprites.svg#icon-owned"></use></svg>
        </div>
      </div>`).join('');
    return cards.map(() => `<div class="mj-back-v"></div>`).join('');
  };
  box.querySelector('#mjWall0').innerHTML = wallHtml(0);
  box.querySelector('#mjWall1').innerHTML = wallHtml(1);
  box.querySelector('#mjWall2').innerHTML = wallHtml(2);

  // 立直标记
  const riichiTag = '<span class="mj-riichi-tag">立直</span>';
  box.querySelector('#mjRiichi0').innerHTML = st.aiRiichi[0] ? riichiTag : '';
  box.querySelector('#mjRiichi1').innerHTML = st.aiRiichi[1] ? riichiTag : '';
  box.querySelector('#mjRiichi2').innerHTML = st.aiRiichi[2] ? riichiTag : '';
  box.querySelector('#mjRiichiP').innerHTML = st.riichi ? riichiTag : '';

  // 副露：玩家/对家 横向平躺大卡；左右家 竖向旋转朝向桌心
  const meld3 = (g, mini, flat = false, thick = false) => [0, 1, 2].map(() => cardHtml(g.id, { meld: true, mini, flat, thick, doraHit: st.dora != null && g.id === st.dora })).join('');
  const playerWin = st.phase === 'settle' && st.result?.winner === 0;
  box.querySelector('#mjPlayerMeld').innerHTML = st.meld.map(g => meld3(g, false, true, true)).join('');
  box.querySelector('#mjMeld0').innerHTML = st.aiMeld[0].map(g => meld3(g, false, true, true)).join('');
  box.querySelector('#mjMeld1').innerHTML = st.aiMeld[1].map(g => meld3(g, false, true, true)).join('');
  box.querySelector('#mjMeld2').innerHTML = st.aiMeld[2].map(g => meld3(g, false, true, true)).join('');

  // AI 赢家手牌：按刻子分组追加到副露区
  if (revealSeat >= 1) {
    const aiIdx = revealSeat - 1;
    const cnt = countsOf(st.ai[aiIdx]);
    let html = '';
    for (const [id, n] of cnt) {
      for (let j = 0; j < n / 3; j++) {
        html += meld3({ id }, false, true, true);
      }
    }
    box.querySelector(`#mjMeld${aiIdx}`).innerHTML += html;
  }

  // 玩家手牌
  const freshIdx = st.player.lastIndexOf(st.lastDraw);
  if (playerWin) {
    // 胡牌亮牌：按刻子分组，与副露视觉统一
    const cnt = countsOf(st.player);
    let html = '';
    for (const [id, n] of cnt) {
      for (let j = 0; j < n / 3; j++) {
        html += meld3({ id }, false, true, true);
      }
    }
    box.querySelector('#mjPlayerMeld').innerHTML += html;
    box.querySelector('#mjPlayerHand').innerHTML = '';
  } else {
    box.querySelector('#mjPlayerHand').innerHTML = st.player.map((id, i) =>
      cardHtml(id, { fresh: i === freshIdx, thick: true, doraHit: st.dora != null && id === st.dora })
    ).join('');
  }
  // 非玩家回合/发牌中禁用 hover
  const handEl = box.querySelector('#mjPlayerHand');
  handEl.classList.toggle('mj-dealing', st.phase !== 'player' || !!st.dealing);

  // 立直宣言时不能打的牌置灰禁点，可打牌悬停弹出听牌信息
  const popEl = box.querySelector('#mjTenpaiPop');
  const tableEl = box.querySelector('.mj-table');
  const canChoose = !playerWin && st.phase === 'player' && !st.busy && st.player.length === 9;
  if (canChoose) {
    [...handEl.children].forEach((stack, i) => {
        // 立直宣言中只能打「打出后仍听牌」的牌，其余置灰
      if (st.riichiPendingDiscard) {
        const t = tenpaiAfter(st.player, i);
        if (!t) {
          stack.classList.add('mj-no');
          return;
        }
        stack.addEventListener('mouseenter', () => {
          // mini 卡 + 剩余张数
          popEl.innerHTML = `
            <div class="mj-tenpai-wait">
              <div class="mj-tenpai-cards">${cardHtml(t.id, { mini: true })}</div>
              <div class="mj-tenpai-left">${t.left}</div>
            </div>`;
          // mini 卡图需手动加载
          popEl.querySelectorAll('.mj-img').forEach(img => tryLoadImage(img, img.dataset.icon));
          popEl.hidden = false; // 先显示再测量宽度，用于边界收敛
          const tr = tableEl.getBoundingClientRect();
          const cr = stack.getBoundingClientRect();
          const w = popEl.offsetWidth;
          const px = cr.left - tr.left + cr.width / 2;
          popEl.style.left = `${Math.max(w / 2 + 2, Math.min(px, tr.width - w / 2 - 2))}px`;
          popEl.style.top = `${cr.top - tr.top - 4}px`;
        });
        stack.addEventListener('mouseleave', () => { popEl.hidden = true; });
      }
    });
  } else {
    popEl.hidden = true;
  }

  // 中央牌河：四家弃牌区
  box.querySelector('#mjRiver').innerHTML = [
    ['opp',    st.aDiscard[0], st.aiRiichiIdx[0]],
    ['left',   st.aDiscard[1], st.aiRiichiIdx[1]],
    ['right',  st.aDiscard[2], st.aiRiichiIdx[2]],
    ['player', st.pDiscard,    st.riichiIdx],
  ].map(([side, list, rIdx]) => `
    <div class="mj-river-lane" data-side="${side}">
      <div class="mj-river-cards">${list.map((id, i) => cardHtml(id, { mini: true, riichi: i === rIdx })).join('')}</div>
    </div>`).join('');

  // 结算三阶段：① 结果+继续 ② 四家分数+下一局 ③ 全场总结
  const banner = box.querySelector('#mjResult');
  if (st.phase === 'settle' && st.result) {
    const r = st.result;
    const stage2 = st.resultStage === 2;
    const stage3 = st.resultStage === 3;
    banner.hidden = false;
    if (banner.dataset.stage !== (stage2 ? '2' : stage3 ? '3' : '1')) {
      delete banner.dataset.played;
      banner.dataset.stage = stage2 ? '2' : stage3 ? '3' : '1';
    }
    if (stage3) {
      // 全场结算：垂直排行 + 每人游戏币输赢
      // ⚠️ 只有玩家（seat=0）的净胜用真实的 st.matchNet（含立直棒/流局杂费，和最终 coin 入账一致）
      //    AI 三家无 coin 账户，用「分数差」近似展示即可，零和不要求与玩家匹配
      const totals = [0, 1, 2, 3].map(i => ({
        seat: i,
        score: st.scores[i],
        net: i === 0 ? st.matchNet : (st.scores[i] - 300),
      }));
      totals.sort((a, b) => b.score - a.score);
      const endCell = (t, rank) => {
        const netSign = t.net > 0 ? '+' : '';
        const netCls = t.net > 0 ? 'mj-delta-up' : t.net < 0 ? 'mj-delta-down' : '';
        const rankCls = rank === 1 ? ' lead' : '';
        return `<div class="mj-end-cell${t.seat === 0 ? ' self' : ''}" data-rank="${rank}">
          <span class="mj-rank${rankCls}">${rank}</span>
          <span class="mj-seat-name">${SEAT_NAMES[t.seat]}</span>
          <span class="mj-end-net ${netCls}">${netSign}${t.net} <img src="./items/coin.png" class="mj-coin-icon" /></span>
        </div>`;
      };
      banner.innerHTML = `
        <div class="mj-res-title">全场结算</div>
        <div class="mj-end-list">
          ${totals.map((t, i) => endCell(t, i + 1)).join('')}
        </div>
        <button class="casino-btn main mj-res-btn mj-end-btn" id="mjEndBack">返回</button>`;
    } else if (stage2) {
      // data-rank 记录名次，playResult 按名次浮现
      const seatCell = seat => {
        const pos = r.rank.indexOf(seat); // 名次（0-based）
        // 玩家：delta = 本局 coin 净变化（已含立直棒杂费，与 matchNet/入账一致）
        // AI：delta = 零和分数变化（无 coin 账户，直接展示即可）
        const delta = seat === 0 ? r.net : r.deltas[seat];
        const prev = r.scores[seat] - r.deltas[seat]; // 滚动数字：按累计分数本身走（分数行），玩家delta单独展示
        const sign = delta > 0 ? '+' : '-';
        const deltaCls = delta > 0 ? ' up' : delta < 0 ? ' down' : '';
        const deltaHtml = delta !== 0 ? `<span class="mj-delta${deltaCls}">${sign}${Math.abs(delta)}</span>` : '';
        return `<div class="mj-seat-cell${seat === 0 ? ' self' : ''}${pos === 0 ? ' lead' : ''}" data-seat="${seat}" data-rank="${pos + 1}">
          <span class="mj-rank">${pos + 1}</span>
          <span class="mj-seat-name">${SEAT_NAMES[seat]}</span>
          <span class="mj-seat-score"><b class="mj-seat-num" data-from="${prev}" data-to="${r.scores[seat]}">${prev}</b>${deltaHtml}</span>
        </div>`;
      };
      banner.innerHTML = `
        <div class="mj-res-title">东${st.matchRound}局 结果</div>
        <div class="mj-scores">
          ${seatCell(1)}
          <div class="mj-scores-mid">${seatCell(2)}${seatCell(3)}</div>
          ${seatCell(0)}
        </div>
        <button class="casino-btn main mj-res-btn" id="mjAgain">${st.matchRound < 4 ? '下一局' : '再来一局'}</button>`;
    } else {
      // 结算第一屏：番型左右两列，中央番数
      const isYakuman = !!(r.yaku && r.yaku.some(y => y.fans === '役满'));
      const centerNum = isYakuman ? '役满' : `${r.fans}`;
      const tailHtml = isYakuman ? '' : '<b class="mj-res-label">番</b>'; // 番 label 与数字同一行
      const yakuTags = r.yaku && r.yaku.length
        ? r.yaku.map(y => `<span class="mj-res-yaku-tag">${y.name} ${y.fans === '役满' ? '<b>役满</b>' : `<b>×${y.fans}</b>`}</span>`)
        : ['<span class="mj-res-yaku-tag">无役</span>'];
      const half = Math.ceil(yakuTags.length / 2);
      const tilesHtml = r.tiles && r.tiles.length
        ? `<div class="mj-res-cards">${r.tiles.map(id => cardHtml(id, { mini: true })).join('')}</div>`
        : '';
      banner.innerHTML = `
        <div class="mj-res-title">${r.msg}</div>
        ${tilesHtml}
        <div class="mj-result-body">
          <div class="mj-res-col mj-res-col-l">${yakuTags.slice(0, half).join('')}</div>
          <div class="mj-res-center"><span class="mj-res-num${isYakuman ? ' mj-res-ym' : ''}">${centerNum}${tailHtml}</span></div>
          <div class="mj-res-col mj-res-col-r">${yakuTags.slice(half).join('')}</div>
        </div>
        <button class="casino-btn main mj-res-btn" id="mjContinue">继续</button>`;
    }
    if (!st._resultPlayed) {
      st._resultPlayed = true;
      playResult(banner, stage2);
    } else {
      banner.querySelectorAll('.mj-res-title, .mj-res-cards, .mj-res-yaku-tag, .mj-res-num, .mj-seat-cell, .mj-res-btn, .mj-res-cap, .mj-scores, .mj-rank, .mj-end-cell, .mj-end-btn').forEach(el => el.classList.add('mj-res-in'));
    }
  } else {
    st._resultPlayed = false;
    delete banner.dataset.stage;
    banner.hidden = true;
  }

  // 消息与操作按钮
  const msg = box.querySelector('#mjMsg');
  const msgBtns = box.querySelector('#mjMsgBtns');
  const ponCard = box.querySelector('#mjPonCard');
  const ponBtn = box.querySelector('#mjPon');
  const ronBtn = box.querySelector('#mjRon');
  const passBtn = box.querySelector('#mjPass');
  const riichiBtn = box.querySelector('#mjRiichi');
  // 碰/荣和时在按钮左侧展示对应弃牌（平卡，不带夹层叠层）；自摸牌已在手牌中
  ponCard.innerHTML = st.pendingPon ? cardHtml(st.pendingPon.id)
    : (st.pendingRon ? cardHtml(st.pendingRon.id) : '');
  if (st.pendingRon) {
    msgBtns.hidden = false;
    ponBtn.hidden = true;
    ronBtn.hidden = false;
    ronBtn.textContent = '胡！';
    passBtn.hidden = false;
    riichiBtn.hidden = true;
    msg.textContent = '';
  } else if (st.pendingPon) {
    msgBtns.hidden = false;
    ponBtn.hidden = false;
    ronBtn.hidden = true;
    passBtn.hidden = false;
    riichiBtn.hidden = true;
    msg.textContent = '';
  } else if (st.pendingTsumo) {
    msgBtns.hidden = false;
    ponBtn.hidden = true;
    ronBtn.hidden = false;
    ronBtn.textContent = '自摸';
    passBtn.hidden = false;
    riichiBtn.hidden = true;
    msg.textContent = '你的回合';
  } else if (st.phase === 'player' && !st.busy && st.player.length === 9 &&
             !st.riichi && st.meld.length === 0 && coin() >= RIICHI_COST && isReady(st.player)) {
    msgBtns.hidden = false;
    ponBtn.hidden = true;
    ronBtn.hidden = true;
    passBtn.hidden = true;
    riichiBtn.hidden = false;
    // 左侧展示立直宣言牌（刚摸的那张，点立直后必须打出它）：避免空槽把按钮挤偏
    ponCard.innerHTML = st.lastDraw != null ? cardHtml(st.lastDraw) : '';
    msg.textContent = '立直';
  } else if (st.phase === 'player') {
    msgBtns.hidden = true;
    msg.textContent = (playerTileTotal() === 9) ? '你的回合' : '';
  } else if (st.phase === 'ai') {
    msgBtns.hidden = true;
    msg.textContent = '';
  } else {
    msgBtns.hidden = true;
    msg.textContent = '';
  }

  // 图标统一走 tryLoadImage（Tauri 下中文文件名需编码/读文件回退链，与全游戏其他列表一致）
  box.querySelectorAll('.mj-img').forEach(img => tryLoadImage(img, img.dataset.icon));
}

// 结算展示：第一屏 标题→番型(逐个)→番数→继续；第二屏 标题→各家分数→名次标→下一局；第三屏 全场总结
async function playResult(banner, stage2 = false) {
  const showOne = async (parent, sel, delay = 200) => {
    const el = parent.querySelector(sel);
    if (el) { el.classList.add('mj-res-in'); await sleep(delay); }
    return el;
  };
  if (st.resultStage === 3) {
    await showOne(banner, '.mj-res-title', 200);
    const cells = [...banner.querySelectorAll('.mj-end-cell')];
    for (const el of cells) {
      el.classList.add('mj-res-in');
      const rank = el.querySelector('.mj-rank');
      if (rank) rank.classList.add('mj-rank-show');
      await sleep(250);
    }
    await showOne(banner, '#mjEndBack', 200);
    return;
  }
  if (stage2) {
    // 第二屏：所有分数卡同时浮现 → 数字同时滚动 → 名次标按名次依次弹出
    const show = async els => { for (const el of els) if (el) { el.classList.add('mj-res-in'); await sleep(200); } };
    await show([banner.querySelector('.mj-res-title')]);
    const cells = [...banner.querySelectorAll('.mj-seat-cell')].sort((a, b) => a.dataset.rank - b.dataset.rank);
    cells.forEach(el => el.classList.add('mj-res-in')); // 同时浮现
    await sleep(250);                                   // 等浮现动画完成
    cells.forEach(el => {                                // 同时滚动数字（原分 → 最终分）
      const num = el.querySelector('.mj-seat-num');
      if (num) rollScore(num);
    });
    await sleep(500);                                    // 等滚动完成
    for (const el of cells) {                            // 依次弹出名次标
      const rank = el.querySelector('.mj-rank');
      if (rank) rank.classList.add('mj-rank-show');
      await sleep(200);
    }
    await show([banner.querySelector('.mj-res-cap')]);
    await show([banner.querySelector('#mjAgain')]);
    return;
  }
  const groups = [
    [banner.querySelector('.mj-res-title')],
    [banner.querySelector('.mj-res-cards')],
    [...banner.querySelectorAll('.mj-res-yaku-tag')],
    [banner.querySelector('.mj-res-num')],
    [banner.querySelector('#mjContinue')],
  ];
  for (const els of groups) {
    for (const el of els) {
      if (!el) continue;
      el.classList.add('mj-res-in');
      await sleep(360);
    }
  }
}

// 结算分数滚动：数字从 data-from（原分）滚动到 data-to（最终分），滚动期间高亮闪烁
function rollScore(el) {
  const from = +el.dataset.from || 0;
  const to = +el.dataset.to || 0;
  if (from === to) return;
  const start = performance.now();
  const dur = 650;
  el.classList.add('mj-counting');
  const step = now => {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3); // ease-out
    el.textContent = String(Math.round(from + (to - from) * e));
    if (t < 1) requestAnimationFrame(step);
    else {
      el.textContent = String(to);
      el.classList.remove('mj-counting');
    }
  };
  requestAnimationFrame(step);
}

function bindTable(box) {
  const handEl0 = box.querySelector('#mjPlayerHand');
  handEl0.onclick = e => {
    const card = e.target.closest('.mj-card');
    if (!card) return;
    onPlayerDiscard(+card.dataset.id);
  };
  // 右键按住手牌：显示牌库剩余张数
  handEl0.addEventListener('contextmenu', e => e.preventDefault());
  handEl0.addEventListener('mousedown', e => {
    if (e.button !== 2) return;
    const card = e.target.closest('.mj-card');
    if (!card) return;
    const id = +card.dataset.id;
    const sp = SPECIES.find(s => s.id === id);
    const total = TIER_COUNT[sp.tier];
    // 可见牌 = 玩家手牌 + 玩家副露(每组3张) + 玩家牌河 + AI副露(每组3张) + AI牌河
    let visible = st.player.filter(p => p === id).length;
    visible += st.meld.filter(g => g.id === id).length * 3;
    visible += st.pDiscard.filter(d => d === id).length;
    for (const m of st.aiMeld) visible += m.filter(g => g.id === id).length * 3;
    for (const d of st.aDiscard) visible += d.filter(dd => dd === id).length;
    const left = Math.max(0, total - visible);
    const popEl = box.querySelector('#mjTenpaiPop');
    const tableEl = box.querySelector('.mj-table');
    popEl.innerHTML = `<div class="mj-tenpai-wait"><div class="mj-tenpai-left">${left}</div></div>`;
    popEl.hidden = false;
    const tr = tableEl.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const w = popEl.offsetWidth;
    popEl.style.left = `${Math.max(w / 2 + 2, Math.min(cr.left - tr.left + cr.width / 2, tr.width - w / 2 - 2))}px`;
    popEl.style.top = `${cr.top - tr.top - 4}px`;
  });
  handEl0.addEventListener('mouseup', e => {
    if (e.button !== 2) return;
    box.querySelector('#mjTenpaiPop').hidden = true;
  });
  box.querySelector('#mjPon')?.addEventListener('click', onPlayerPon);
  box.querySelector('#mjRon')?.addEventListener('click', () => {
    if (st.pendingRon) onPlayerRon();
    else if (st.pendingTsumo) onPlayerTsumo();
  });
  box.querySelector('#mjPass')?.addEventListener('click', () => {
    if (st.pendingRon) onPlayerRonPass();
    else if (st.pendingTsumo) onPlayerTsumoPass();
    else onPlayerPonPass();
  });
  box.querySelector('#mjRiichi')?.addEventListener('click', onRiichi);
  // 结算第一屏「继续」→ 第二屏四家分数与名次
  box.querySelector('#mjContinue')?.addEventListener('click', () => {
    st.resultStage = 2;
    st._resultPlayed = false;
    render();
  });
  box.querySelector('#mjAgain')?.addEventListener('click', nextRound);
  box.querySelector('#mjEndBack')?.addEventListener('click', () => {
    st.phase = 'bet';
    st.result = null;
    st.resultStage = 1;
    st.yakuPage = 0;
    render();
    saveMahjongState();
  });
}

// ---------- 流程 ----------
// 下注页开始对局：开启一场东4局新对局（游戏币整场一次性结算，开桌前余额须覆盖最大可能亏损 = 注额×40）
function beginMatch() {
  if (coin() < st.bet * 40) return; // 余额不足无法开整场（下注页已禁选不够的档位）
  st.matchRound = 1;
  st.matchNet = 0;
  st.scores = [300, 300, 300, 300]; // 整场以 300 分开局（低注额量级，胜负数同游戏币结算）
  st.resultStage = 1;
  st.yakuPage = 0;
  dealRound();
}
// 每一小局：掷骰 → 顺时针发牌 → 摸打（不逐局扣注，输赢随东4终局一次性结算）
async function dealRound() {
  st.stake = st.bet;
  st.deck = buildDeck();
  st.dora = null; // 发完牌再翻开宝牌
  st.player = [];
  st.ai = [[], [], []];
  st.meld = [];
  st.aiMeld = [[], [], []];
  st.riichi = false;
  st.riichiPendingDiscard = false;
  st.riichiIdx = null;
  st.aiRiichi = [false, false, false];
  st.aiRiichiPending = [false, false, false];
  st.aiRiichiIdx = [null, null, null];
  st.pendingPon = null;
  st.pendingRon = null;
  st.pendingTsumo = false;
  st.ponJust = false;
  st.pDiscard = [];
  st.aDiscard = [[], [], []];
  st.lastDraw = null;
  st.result = null;
  st._resultPlayed = false;
  st.discarder = -1;
  st.ippatsu = false;
  st.wRiichi = false;
  st.haitei = false;
  st.tenhou = false;
  st.firstDraw = false;
  st.busy = true;
  st.turn = 0;
  st.phase = 'player';
  st.dealing = true; // 发牌中禁止手牌 hover
  render();
  const msg = $('mahjongContent').querySelector('#mjMsg');
  const infoEl = $('mahjongContent').querySelector('.mj-center-main');
  // 开局投骰子：文字闪烁滚动后停在最终点数（期间隐藏宝牌/局况，骰子居中）
  const d1 = 1 + (Math.random() * 6 | 0);
  const d2 = 1 + (Math.random() * 6 | 0);
  playMahjongSfx('dice');
  if (infoEl) infoEl.style.display = 'none';
  if (msg) {
    msg.style.marginTop = '0';   // 掷骰时去除偏移，让骰子垂直居中
    msg.style.height = 'auto';
    msg.innerHTML = '<span class="mj-dice">⚀ ⚀</span>';
  }
  const diceEl = msg ? msg.querySelector('.mj-dice') : null;
  if (diceEl) {
    for (let i = 0; i < 3; i++) { // 少闪几下，快速开始发牌
      const a = 1 + (Math.random() * 6 | 0);
      const b = 1 + (Math.random() * 6 | 0);
      diceEl.textContent = `${DICE_CHARS[a - 1]} ${DICE_CHARS[b - 1]}`;
      await sleep(30 + i * 20);
    }
    diceEl.textContent = `${DICE_CHARS[d1 - 1]} ${DICE_CHARS[d2 - 1]}`;
  }
  // 骰子点数决定庄家（先手）：两骰之和取模 4 落到四家之一
  st.dealer = (d1 + d2) % 4;
  if (msg) msg.textContent = `${SEAT_NAMES[st.dealer]} 先手`;
   await sleep(250);
  if (infoEl) infoEl.style.display = '';
  if (msg) { msg.style.marginTop = ''; msg.style.height = ''; }
  // 顺时针发牌：从庄家开始，每家每次 4 张
  const sIdx = DEAL_ORDER.indexOf(st.dealer);
  const dealOrder = DEAL_ORDER.slice(sIdx).concat(DEAL_ORDER.slice(0, sIdx));
  for (let dealt = 0; dealt < HAND_SIZE; dealt += DEAL_STEP) {
    for (const seat of dealOrder) {
      const hand = seat === 0 ? st.player : st.ai[seat - 1];
      for (let k = 0; k < DEAL_STEP; k++) hand.push(st.deck.pop());
      render();
      if (msg) msg.textContent = '发牌中…';
      playMahjongSfx('draw');
      await sleep(160);
    }
  }
  st.dora = st.deck.pop(); // 发牌结束翻开宝牌
  st.firstDraw = true;     // 翻开宝牌后即进入庄家第一摸（天和判定窗口）
  sortHand(st.player);
  st.busy = false;
  st.dealing = false; // 发牌结束恢复 hover
  render();
  triggerDoraShine(); // 翻宝牌即扫光一次，提示玩家场上有哪些宝牌
  if (st.dealer === 0) autoPlayerDraw(); // 玩家坐庄先摸
  else { st.turn = st.dealer; runAi(st.dealer); } // AI 坐庄先摸（参数即座位号）
}
function autoPlayerDraw() {
  setTimeout(onPlayerDraw, 380);
}
async function onPlayerDraw() {
  if (st.phase !== 'player' || st.busy) return;
  st.busy = true;
  if (!st.deck.length) return settle('draw');
  const isFirstDraw = st.firstDraw;
  st.firstDraw = false; // 首摸已消耗（无论是否成胡，天和只属于本局第一摸）
  const id = st.deck.pop();
  st.player.push(id);
  st.lastDraw = id;
  if (!st.deck.length) st.haitei = true; // 海底：摸到牌山最后一张（此后荣和他家最后弃牌同样算海底）
  render();
  if (canWin(st.player, st.meld.length)) {
    // 天和：庄家第一摸即成胡（役满）；自摸可胡：弹出「胡！」/「放弃」悬浮框，由玩家决定（立直中同样可选）
    if (isFirstDraw && st.dealer === 0) st.tenhou = true;
    st.pendingTsumo = true;
    render();
    return;
  }
  if (st.riichi) { // 立直中只能打刚摸的牌
    $('mahjongContent').querySelector('#mjMsg').textContent = '你的回合';
    await sleep(250);
    onPlayerDiscard(id, true);
    st.busy = false;
    return;
  }
  st.busy = false;
  render(); // 摸牌后重新渲染（此时 busy=false）：听牌时立直按钮才会出现
}
function onPlayerDiscard(id, force = false) {
  if (st.phase !== 'player' || (st.busy && !force)) return;
  if (playerTileTotal() !== 9) return;
  // 立直宣言：只能打「打出后仍听牌」的牌（其余置灰禁点）；立直中摸打只能打刚摸的那张
  if (st.riichiPendingDiscard) {
    const idx = st.player.indexOf(id);
    if (idx < 0 || !tenpaiAfter(st.player, idx)) return;
  } else if (st.riichi && id !== st.lastDraw) {
    return;
  }
  st.player.splice(st.player.indexOf(id), 1);
  sortHand(st.player);
  st.pDiscard.push(id);
  playMahjongSfx('draw');
  if (st.riichiPendingDiscard) {
    st.riichiIdx = st.pDiscard.length - 1;
    st.riichiPendingDiscard = false;
  } else if (st.riichi) {
    st.ippatsu = false; // 立直宣言牌已打出，一圈后再次出牌：一发窗口关闭
  }
  st.lastDraw = null;
  const wasPon = st.ponJust;
  st.ponJust = false;
  render();
  // 荣和判定（优先于碰）：有 AI 能以该弃牌直接胡牌
  const ronAi = aiCanRon(id);
  if (ronAi) {
    st.ai[ronAi - 1].push(id);
    sortHand(st.ai[ronAi - 1]);
    st.phase = 'ai';
    st.busy = true;
    st.discarder = 0; // 玩家弃牌被荣和
    render();
    setTimeout(() => settle(ronAi, 'ron'), 650);
    return;
  }
  if (wasPon) {
    st.phase = 'ai';
    st.turn = NEXT[0]; // 碰后玩家已出牌，轮到下家（左家）
    runAi(NEXT[0]);
    return;
  }
  const pon = aiCanPon(id);
  if (pon) {
    aiPon(pon, id, 0);
    return;
  }
  st.phase = 'ai';
  st.turn = NEXT[0];
  runAi(NEXT[0]);
}

// ---------- 碰 ----------
function aiCanPon(id) {
  for (let i = 1; i <= 3; i++) {
    if (st.aiRiichi[i - 1]) continue;
    if ((countsOf(st.ai[i - 1]).get(id) || 0) >= 2 && shouldAiPon(i, id)) return i;
  }
  return 0;
}
// AI 荣和判定：手牌 + 弃牌恰好凑满 3 组刻子即可胡（立直听牌同样可荣和）
function aiCanRon(id) {
  for (let i = 1; i <= 3; i++) {
    if (canWin(st.ai[i - 1].concat([id]), st.aiMeld[i - 1].length)) return i;
  }
  return 0;
}
async function onPlayerPon() {
  if (!st.pendingPon) return;
  const { id, from } = st.pendingPon;
  st.ippatsu = false; // 任意一家碰牌：打断立直方的一发窗口
  $('mahjongContent').querySelector('#mjMsgBtns').hidden = true; // 先收起操作按钮
  popSeatTag(0, '碰'); // 先弹「碰」浮标…
  showPonIcon(0, id);
  playMahjongSfx('pon');
  await sleep(400);    // …停顿一下再把牌副露
  st.player.splice(st.player.indexOf(id), 1);
  st.player.splice(st.player.indexOf(id), 1);
  st.meld.push({ id });
  const dIdx = st.aDiscard[from - 1].indexOf(id);
  if (dIdx >= 0) st.aDiscard[from - 1].splice(dIdx, 1);
  st.pendingPon = null; // 碰牌完成后再清，防止退游导致存档丢失碰牌状态
  sortHand(st.player);
  st.ponJust = true;
  st.phase = 'player';
  render();
  $('mahjongContent').querySelector('#mjMsg').textContent = '你的回合';
  // 碰后手牌即成 2 组刻子（+副露）＝胡牌，直接结算不再打牌（吃他弃牌成胡 = 荣和）
  if (canWin(st.player, st.meld.length)) {
    st.busy = true;
    st.discarder = from; // 碰他家弃牌成胡 = 荣和
    setTimeout(() => settle(0, 'ron'), 700);
    return;
  }
}
function onPlayerPonPass() {
  if (!st.pendingPon) return;
  const { from } = st.pendingPon;
  st.pendingPon = null;
  const next = NEXT[from]; // 放弃碰：轮到弃牌者下家
  if (next === 0) {
    st.turn = 0;
    st.phase = 'player';
    render();
    autoPlayerDraw();
  } else {
    st.turn = next;
    render();
    runAi(next);
  }
}
// 荣和：收入他家弃牌成胡（从弃牌河移除该牌，与碰一致）
async function onPlayerRon() {
  if (!st.pendingRon) return;
  const { id, from } = st.pendingRon;
  st.pendingRon = null;
  $('mahjongContent').querySelector('#mjMsgBtns').hidden = true;
  st.player.push(id);
  sortHand(st.player);
  st.lastDraw = null;
  const dIdx = st.aDiscard[from - 1].indexOf(id);
  if (dIdx >= 0) {
    st.aDiscard[from - 1].splice(dIdx, 1);
  }
  render();
  st.discarder = from; // 荣和他家弃牌
  setTimeout(() => settle(0, 'ron'), 600);
}
// 放弃荣和：回到弃牌后的正常流程（仍可碰该弃牌）
function onPlayerRonPass() {
  if (!st.pendingRon) return;
  const { id, from } = st.pendingRon;
  st.pendingRon = null;
  if (!st.riichi && playerTileTotal() === 8 && (countsOf(st.player).get(id) || 0) >= 2) {
    st.pendingPon = { id, from };
    render();
    return;
  }
  st.turn = NEXT[from]; // 放弃荣和：轮到弃牌者下家
  if (st.turn === 0) {
    st.phase = 'player';
    render();
    autoPlayerDraw();
  } else {
    render();
    runAi(st.turn);
  }
}
// 自摸：摸牌成胡直接结算
function onPlayerTsumo() {
  if (!st.pendingTsumo) return;
  st.pendingTsumo = false;
  st.busy = false;
  const box = $('mahjongContent');
  if (box) {
    const b = box.querySelector('#mjMsgBtns');
    if (b) b.hidden = true;
  }
  settle(0, 'tsumo');
}
// 放弃自摸：恢复出牌（立直中只能打刚摸的牌）
function onPlayerTsumoPass() {
  if (!st.pendingTsumo) return;
  st.pendingTsumo = false;
  st.busy = false;
  st.tenhou = false; // 放弃天和：役满判定作废，继续正常出牌
  render();
}
async function aiPon(i, id, from) {
  const hand = st.ai[i - 1];
  st.ippatsu = false; // 任意一家碰牌：打断立直方的一发窗口
  st.turn = i;
  st.phase = 'ai';
  const src = from === 0 ? st.pDiscard : st.aDiscard[from - 1];
  const dIdx = src.indexOf(id);
  popSeatTag(i, '碰'); // 先弹「碰」浮标…
  showPonIcon(i, id);
  playMahjongSfx('pon');
  await sleep(400);    // …停顿一下再把牌副露
  hand.splice(hand.indexOf(id), 1);
  hand.splice(hand.indexOf(id), 1);
  st.aiMeld[i - 1].push({ id });
  if (dIdx >= 0) src.splice(dIdx, 1);
  render();
  // 碰后即成胡牌形，直接结算（吃玩家弃牌成胡 = 荣和）
  if (canWin(hand, st.aiMeld[i - 1].length)) {
    await sleep(300);
    st.discarder = from;
    return settle(i, 'ron');
  }
  if (!st.deck.length) return settle('draw');
  const pickIdx = aiPickDiscard(i, hand, false, null);
  const out = hand[pickIdx];
  hand.splice(pickIdx, 1);
  st.aDiscard[i - 1].push(out);
  playMahjongSfx('draw');
  const next = NEXT[i]; // 碰后 AI 已出牌，轮到其下家
  if (next === 0) {
    st.turn = 0;
    st.phase = 'player';
    render();
    autoPlayerDraw();
  } else {
    st.turn = next;
    render();
    runAi(next);
  }
}

// ===== AI 辅助判断 =====
// 手牌属性分布：{ type: count }，用于混一色/清一色判断
function handTypeDist(hand) {
  const dist = {};
  for (const id of hand) {
    const s = SPECIES_MAP.get(id);
    if (!s || s.tier === 'legend') continue;
    dist[s.type] = (dist[s.type] || 0) + 1;
  }
  return dist;
}
// 手牌最大属性集中度：返回最多的属性及其张数
function bestType(hand) {
  const dist = handTypeDist(hand);
  let best = null, max = 0;
  for (const [t, n] of Object.entries(dist)) {
    if (n > max) { max = n; best = t; }
  }
  return { type: best, count: max };
}
// 检查某 tile 是否已在指定对手的弃牌河中出现过（安全牌判断）
function isSafeTile(id, seat) {
  const river = seat === 0 ? st.pDiscard : st.aDiscard[seat - 1];
  return river.includes(id);
}
// 检查某 tile 是否在所有立直者的弃牌河中都是安全牌
function isSafeVsRiichi(id) {
  for (let i = 0; i < 3; i++) {
    if (st.aiRiichi[i] && !isSafeTile(id, i + 1)) return false;
  }
  return true;
}
// 对子、刻子统计：返回 { pairs: number, tris: number }
function pairTriCount(hand) {
  const m = countsOf(hand);
  let pairs = 0, tris = 0;
  for (const n of m.values()) {
    tris += Math.floor(n / 3);
    pairs += Math.floor((n % 3) / 2);
  }
  return { pairs, tris };
}
// 单张数统计（仅出现 1 次的牌种）
function loneCount(hand) {
  const m = countsOf(hand);
  let n = 0;
  for (const c of m.values()) if (c === 1) n++;
  return n;
}
// AI 弃牌打分：分数越低越该打掉
function aiDiscardScore(id, hand, idx, isRiichi, lastDraw) {
  const info = SPECIES_MAP.get(id);
  if (!info) return 0;
  const m = countsOf(hand);
  const count = m.get(id) || 0;
  // 立直后只能打刚摸的牌
  if (isRiichi && id !== lastDraw) return 999;
  // 千万不要拆已有 2 张的对子（核心）
  if (count >= 2) return 100;
  // 宝牌保留
  if (id === st.dora) return 60;
  const best = bestType(hand);
  const isTopType = best.type && info.type === best.type;
  // 属性集中：与手牌主流属性相同的单张保留
  if (isTopType && best.count >= 4) return 50;
  if (isTopType && best.count >= 2) return 40;
  // 进化羁绊：同系进化对在场时保留
  if (info.tier === 'low') {
    const advId = EVO_PAIRS.find(p => p.low === id)?.adv;
    if (advId && hand.includes(advId)) return 45;
  }
  if (info.tier === 'adv') {
    const lowId = EVO_PAIRS.find(p => p.adv === id)?.low;
    if (lowId && hand.includes(lowId)) return 45;
  }
  // 神兽尽量保留
  if (info.tier === 'legend') {
    if (count >= 1) return 55;
  }
  // 10 点主力比 5 点幼态更值得留
  if (info.pts >= 10) return 20;
  // 幼态单张最优先丢弃
  return 10;
}
// AI 弃牌选择：综合打分 + 防守
function aiPickDiscard(i, hand, isRiichi, lastDraw) {
  const m = countsOf(hand);
  const anyoneRiichi = st.riichi || st.aiRiichi.some(r => r);
  // 立直后只能打刚摸的牌
  if (isRiichi) return hand.indexOf(lastDraw);
  // 打分
  const scored = hand.map((id, idx) => ({
    idx,
    id,
    score: aiDiscardScore(id, hand, idx, isRiichi, lastDraw),
  }));
  // 有人立直时：安全牌降分优先打出
  if (anyoneRiichi) {
    const safeBonus = -30; // 安全牌减 30 分（更倾向打出）
    for (const s of scored) {
      if (isSafeVsRiichi(s.id) || (st.riichi && isSafeTile(s.id, 0))) {
        s.score += safeBonus;
      }
    }
  }
  // 按分数升序排列：最低分优先打
  scored.sort((a, b) => a.score - b.score);
  return scored[0].idx;
}
// AI 碰牌评估：碰了是否改善手牌结构
function shouldAiPon(i, id) {
  const hand = st.ai[i - 1].slice();
  const idx1 = hand.indexOf(id);
  const idx2 = hand.lastIndexOf(id);
  if (idx1 === idx2) return false; // 不足 2 张
  // 模拟碰后手牌
  hand.splice(idx2, 1);
  hand.splice(idx1, 1);
  const afterMeld = st.aiMeld[i - 1].length + 1;
  // 碰后孤张太多（≥ 半手牌），放弃
  const loners = loneCount(hand);
  if (loners >= Math.ceil(hand.length / 2)) return false;
  // 碰后若直接成胡，必碰
  if (canWin(hand, afterMeld)) return true;
  // 碰后手牌还有成对潜力，允许
  const pt = pairTriCount(hand);
  if (pt.pairs + pt.tris >= 1) return true;
  // 属性有利：碰的牌是主流属性
  const best = bestType(hand);
  const info = SPECIES_MAP.get(id);
  if (best.type && info && info.type === best.type && best.count >= 3) return true;
  // 宝牌必碰
  if (id === st.dora) return true;
  return false;
}

// ---------- 立直 ----------
function onRiichi() {
  if (st.phase !== 'player' || st.busy) return;
  if (st.player.length !== 9 || st.meld.length !== 0) return;
  if (!isReady(st.player)) return;
  // 立直棒记入整场总分
  st.matchNet -= RIICHI_COST;
  st.riichi = true;
  playMahjongSfx('riichi');
  st.riichiPendingDiscard = true;
  st.ippatsu = true; // 一发窗口开启：直到他家有人碰或自己再次出牌
  // 双重立直：本局尚无任何一家弃牌（只能发生在玩家坐庄的第一摸）
  st.wRiichi = st.pDiscard.length === 0 && st.aDiscard.every(d => d.length === 0);
  render();
  $('mahjongContent').querySelector('#mjMsg').textContent = '你的回合';
}

async function runAi(i) {
  await sleep(350);
  if (!st.deck.length) return settle('draw');
  st.firstDraw = false; // 首摸已消耗（庄家为 AI 时同样关闭天和窗口）
  const id = st.deck.pop();
  st.ai[i - 1].push(id);
  if (!st.deck.length) st.haitei = true;
  render();
  if (canWin(st.ai[i - 1], st.aiMeld[i - 1].length)) {
    await sleep(280);
    return settle(i);
  }
  // AI 立直：门清听牌，概率基于手牌质量
  if (!st.aiRiichi[i - 1] && st.aiMeld[i - 1].length === 0 && isReady(st.ai[i - 1])) {
    const pt = pairTriCount(st.ai[i - 1]);
    const best = bestType(st.ai[i - 1]);
    let chance = 0.3 + pt.pairs * 0.12 + Math.min(best.count || 0, 6) * 0.05;
    if (st.dora && st.ai[i - 1].includes(st.dora)) chance += 0.15;
    if (Math.random() < Math.min(chance, 0.9)) {
      st.aiRiichi[i - 1] = true;
      st.aiRiichiPending[i - 1] = true;
      playMahjongSfx('riichi');
      render();
      await sleep(600);
    }
  }
  // 智能弃牌：立直中只能打刚摸的牌
  const isRiichiDiscard = st.aiRiichi[i - 1] && !st.aiRiichiPending[i - 1];
  const pickIdx = aiPickDiscard(i, st.ai[i - 1], isRiichiDiscard, id);
  const out = st.ai[i - 1][pickIdx];
  if (st.aiRiichiPending[i - 1]) {
    st.aiRiichiIdx[i - 1] = st.aDiscard[i - 1].length;
    st.aiRiichiPending[i - 1] = false;
  }
  st.ai[i - 1].splice(st.ai[i - 1].indexOf(out), 1);
  st.aDiscard[i - 1].push(out);
  playMahjongSfx('draw');
  // 荣和判定（优先于碰）：玩家可胡该弃牌，弹出「胡！」/「放弃」悬浮框（立直听牌同样可荣和）
  if (canWin(st.player.concat([out]), st.meld.length)) {
    st.pendingRon = { id: out, from: i };
    render();
    return;
  }
  // 玩家碰判定：打完稳态 8 张且有 2 张相同；立直中不可碰
  if (!st.riichi && playerTileTotal() === 8 && (countsOf(st.player).get(out) || 0) >= 2) {
    st.pendingPon = { id: out, from: i };
    render();
    return;
  }
  st.turn = NEXT[i]; // 顺时针轮到下家（NEXT[i] 为 0 时回到玩家）
  if (st.turn === 0) {
    st.phase = 'player';
    render();
    autoPlayerDraw();
  } else {
    render();
    runAi(st.turn);
  }
  saveMahjongState();
}

// 四家本局分数变化（零和）：自摸三家各付 stake×倍率；荣和放铳者独付；流局不变
function calcDeltas(winner, mode, mult) {
  const d = [0, 0, 0, 0];
  if (winner === 'draw') return d;
  if (mode === 'tsumo') {
    d[winner] = 3 * st.stake * mult;
    for (let i = 0; i < 4; i++) if (i !== winner) d[i] = -st.stake * mult;
  } else {
    d[winner] = st.stake * mult;
    const loser = st.discarder;
    if (loser >= 0 && loser !== winner) d[loser] = -st.stake * mult;
  }
  return d;
}

// 获取胡牌手牌（含副露）的 tile id 列表，按 id 排序
// 副露每组为 3 枚相同牌（碰/刻子），存储为 {id}，需展开为 [id, id, id]
function getWinTiles(winner) {
  let tiles = [];
  if (winner === 0) {
    tiles = [...st.player, ...st.meld.flatMap(g => [g.id, g.id, g.id])];
  } else if (typeof winner === 'number') {
    const idx = winner - 1;
    const hand = st.ai[idx] ? st.ai[idx] : [];
    const melds = st.aiMeld[idx] ? st.aiMeld[idx].flatMap(g => [g.id, g.id, g.id]) : [];
    tiles = [...hand, ...melds];
  }
  tiles.sort((a, b) => a - b);
  return tiles;
}

async function settle(winner, mode = 'tsumo') {
  if (winner !== 'draw') playMahjongSfx(mode === 'ron' ? 'ron' : 'tsumo');
  let net = 0, msg = '', yaku = [], fans = 0, mult = 2;
  if (winner === 0) {
    const y = getYaku(st.player, st.dora, st.meld.map(g => g.id), {
      riichi: st.riichi,
      wRiichi: st.wRiichi,
      tsumo: mode === 'tsumo',
      ippatsu: st.ippatsu,
      menzen: st.meld.length === 0,
      haitei: st.haitei,
      tenhou: st.tenhou,
    });
    net = st.stake * y.mult + (st.riichi ? RIICHI_COST : 0); // 立直棒：胡牌退还
    yaku = y.yaku;
    fans = y.fans;
    mult = y.mult;
    msg = mode === 'ron' ? '荣和！' : '自摸！';
  } else if (typeof winner === 'number') {
    net = -st.stake; // AI 胡牌固定 -注额（倍率不参与 AI 收益，仅用于面板展示）
    msg = `${AI_NAMES[winner - 1]} ${mode === 'ron' ? '荣和' : '自摸'}…`;
    // AI 胡牌同样结算役种供结算面板展示（AI 荣和时弃牌已并入其手牌；碰后成胡时副露已计入）
    const aiY = getYaku(st.ai[winner - 1], st.dora, st.aiMeld[winner - 1].map(g => g.id), {
      riichi: st.aiRiichi[winner - 1],
      tsumo: mode === 'tsumo',
      menzen: st.aiMeld[winner - 1].length === 0,
      haitei: st.haitei,
    });
    yaku = aiY.yaku;
    fans = aiY.fans;
    mult = aiY.mult;
  } else {
    net = -Math.round(st.stake / 2); // 流局：不再扣注，直接按半注计入本场总分（与旧「退回一半」等价）
    msg = '流局';
  }
  // 四家局分：本局变化 → 累计 → 名次（分数降序，同分按座位号）
  const deltas = calcDeltas(winner, mode, mult);
  st.scores = st.scores.map((v, i) => v + deltas[i]);
  // 本局玩家实际金币变动 = 零和分数变化 + 立直棒退还（若有）；流局固定扣半注
  net = winner === 'draw' ? -Math.round(st.stake / 2) : deltas[0] + (winner === 0 && st.riichi ? RIICHI_COST : 0);
  st.matchNet += net; // 整场结算：本局变化先记入总分，游戏币随东4终局一次性入账
  const rank = [0, 1, 2, 3].slice().sort((a, b) => st.scores[b] - st.scores[a] || a - b);
  st.result = { net, msg, yaku, fans, mult, winner, mode, deltas, scores: [...st.scores], rank, tiles: getWinTiles(winner) };
  st.resultStage = 1; // 每次结算回到第一屏（结果+继续）
  const CN = ['零', '一', '二', '三', '四'];
  const playerRank = rank.indexOf(0) + 1;
  st.lastResult = `第${CN[playerRank]}名 ${net > 0 ? '+' : ''}${net} 游戏币`;
  if (st.matchRound === 4) {
    st.lastResult = `第${CN[playerRank]}名 ${st.matchNet >= 0 ? '+' : ''}${st.matchNet} 游戏币`;
  }
  gameData._mahjongLastResult = st.lastResult; // 跨会话持久化，独立于对局存档
  st.phase = 'settle';
  st.busy = true; // 结算演出中禁止操作：浮标停留期间手牌/按钮不可点
  addSystemLog('mahjong', { winner: winner === 'draw' ? 'draw' : winner, winMode: winner === 'draw' ? null : mode, stake: st.stake, profit: net, matchRound: st.matchRound, total: st.matchNet, yaku: yaku.map(y => y.name) });
  saveGame().then(updateStats);
  // 胡/自摸演出：先重绘牌桌使赢家摊牌（手牌移至副露区展开），再弹浮标
  if (typeof winner === 'number') {
    render(); // 立即重绘：赢家手牌变为摊牌状态
    const winHand = winner === 0 ? st.player : st.ai[winner - 1];
    showPonIcon(winner, winHand[winHand.length - 1]);
    popSeatTag(winner, mode === 'tsumo' ? '自摸' : '胡', 'mj-float-win'); // 自摸弹「自摸」、荣和弹「胡」，红色
    await sleep(1300); // 浮标动画约 0.8s 播完后再停留片刻
    hideSeatTag(winner);
    await sleep(280);  // 浮标淡出间隔，避免瞬间切屏
  }
  st.busy = false;
  render();
  saveMahjongState();
}
// 结算后：东1~东3 直接进下一小局；东4 结束一次性结算全场总分，展示全场总结后回下注页
function nextRound() {
  if (st.matchRound < 4) {
    st.matchRound++;
    dealRound();
  } else {
    gameData.items['casinoCoin'] = Math.max(0, coin() + st.matchNet);
    // 战绩存储（滑动窗口 50 条，整场一条）
    const rank = [0, 1, 2, 3].slice().sort((a, b) => st.scores[b] - st.scores[a] || a - b).indexOf(0) + 1;
    gameData.mahjongRecords = gameData.mahjongRecords || [];
    gameData.mahjongRecords.unshift({ time: Date.now(), net: st.matchNet, rank, stake: st.stake });
    if (gameData.mahjongRecords.length > 50) gameData.mahjongRecords.length = 50;
    saveGame().then(updateStats);
    st.resultStage = 3; // 全场结算总结页
    st._resultPlayed = false;
    render();
    delete gameData._mahjongState;
    saveGame().then(updateStats);
  }
}

// ---------- 入口 ----------
export function showMahjongView() {
  // 余额连最低注额都玩不起 → 弹出确认框阻止
  if (coin() < BETS[0] * 40) {
    addSystemLog('mahjong', { blocked: 'entry-min', min: BETS[0] * 40, balance: coin() });
    showConfirmBar(`游戏币不足 ${BETS[0] * 40}，无法进入口袋麻将`, null, null, { noButtons: false });
    // 只有一个"确定"按钮时改文字
    const noBtn = document.querySelector('#confirmBar [data-cb-no]');
    if (noBtn) noBtn.style.display = 'none';
    const yesBtn = document.querySelector('#confirmBar [data-cb-yes]');
    if (yesBtn) yesBtn.textContent = '确定';
    return;
  }
  // 恢复存档中的对局进度（含结算页，跳过浮标动画直接进结算）
  const saved = gameData._mahjongState;
  if (saved && (saved.phase === 'player' || saved.phase === 'ai' || saved.phase === 'settle')) {
    restoreMahjongState(saved);
  } else if (gameData._mahjongLastResult) {
    st.lastResult = gameData._mahjongLastResult; // 无进行中对局时，恢复上一场结算文字
  }
  pushNav('mahjongView');
  showView('mahjongView');
  render();
  if (st.phase === 'ai') runAi(st.turn);
  else if (st.phase === 'player' && playerTileTotal() === 8 && !st.busy
    && !st.pendingPon && !st.pendingRon && !st.pendingTsumo && !st.ponJust) autoPlayerDraw();
}
