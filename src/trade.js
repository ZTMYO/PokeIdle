// ===== 交换（宝可梦交换） =====
// 每半小时刷新一波：若干 NPC 在交换广场挂出「想要的宝可梦（可指定性别/某项个体值下限）」和
// 「愿意给的宝可梦（个体值/性格/闪光具体可见）」，玩家拿符合要求的在仓个体与其交换，
// 得到的宝可梦来源记为「交换」。
import { TRADE_COUNT, TRADE_REFRESH_MS, TRADE_GENDER_CHANCE, TRADE_IV_CHANCE, TRADE_IV_MIN, TRADE_SHINY_CHANCE, TRADE_IV_SUM_MIN, TRADE_LEVEL_CHANCE, TRADE_WANT_LEVEL_MIN, TRADE_WANT_LEVEL_MAX, TRADE_GIVE_LEVEL_MAX, EXP_CANDY_XP, MAX_LEVEL } from './config.js';
import { gameData, allPokemon, getPokemonByIndex, getNature, pushNav, saveGame, addSystemLog, randInt, rollIvs, rollLegendIvs, rollNature, rollGender, addRosterEntry, setLastObtainedEntryId, ensureGender, genderBadge, isPokemon } from './state.js';
import { $, showView, updateStats, tryLoadImage, tryLoadPokemonImage, logicViewport } from './ui.js';
import { showGoodbyeConfirm, showTradeReceive, startShinySparkleOn, stopShinySparkleLoop } from './animation.js';
import { TYPE_COLORS, pickFamily, pokemonSourceBadge } from './items.js';
import { NATURES } from './battle-core.js';
import { playCongratulation } from './audio.js';

// ---------- NPC ----------
// 图源 src/character/npc 的 9 帧行走图（等宽 16px），同名角色共用名字
// 顺序必须与 npcs.png 拼图坐标一致：行0 = 0..12，行1 = 13..25；
// 末尾的作者彩蛋追加在行0 的第 14 列（物理位置不变，下标注 26 用固定偏移定位）
const NPCS = [
  { id: 'boy_1', name: '男孩' },
  { id: 'boy_2', name: '男孩' },
  { id: 'boy_3', name: '男孩' },
  { id: 'bug_catcher', name: '捕虫少年' },
  { id: 'camper', name: '露营者' },
  { id: 'fisherman', name: '钓鱼人' },
  { id: 'gentleman', name: '绅士' },
  { id: 'girl_1', name: '女孩' },
  { id: 'girl_2', name: '女孩' },
  { id: 'girl_3', name: '女孩' },
  { id: 'hiker', name: '登山者' },
  { id: 'little_boy', name: '小男孩' },
  { id: 'little_girl', name: '小女孩' },
  { id: 'man_1', name: '男人' },
  { id: 'man_2', name: '男人' },
  { id: 'man_3', name: '男人' },
  { id: 'man_4', name: '男人' },
  { id: 'man_5', name: '男人' },
  { id: 'rich_boy', name: '富家少爷' },
  { id: 'scientist_1', name: '科学家' },
  { id: 'scientist_2', name: '科学家' },
  { id: 'woman_1', name: '女人' },
  { id: 'woman_2', name: '女人' },
  { id: 'woman_3', name: '女人' },
  { id: 'woman_4', name: '女人' },
  { id: 'woman_5', name: '女人' },
  { id: 'author', name: 'ZTMYO' }, // 彩蛋 NPC：极低概率出现在交易市场，给出闪光 6V 神兽
  { id: 'imiti', name: '伊美蒂' }, // 彩蛋 NPC：与 ZTMYO 同概率出现在交易市场，只给百变怪（10% 概率 6V）
];
const IV_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const IV_LABELS = { hp: 'HP', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };
// 性格 tooltip 文案：与仓库详情页一致（NATURES 下标 1攻 2防 3特攻 4特防 5速）
const _NATURE_STAT_CN = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
function natureBoostText(key) {
  const n = NATURES[key];
  if (!n) return '无性格修正';
  const parts = [];
  if (n.up) parts.push(`${_NATURE_STAT_CN[n.up]}＋10%`);
  if (n.down) parts.push(`${_NATURE_STAT_CN[n.down]}－10%`);
  return parts.join('\n');
}

// 当前正在选择交出个体的 offer（null 表示在广场列表页）
let _tradeMode = null;
let _tSortBy = null; // 选择列表排序列：iv | level（null=保持仓库顺序）
let _tSortDir = 1;   // 1 升序 / -1 降序
let _tQuery = '';    // 选择列表昵称搜索词（候选均为同一物种，仅按昵称）
// 当前正在查看「NPC 给出宝可梦」详情的 offer（null 表示未在详情页）
let _tradeDetail = null;
// 进入子页面时保存的列表滚动位置，返回列表时恢复
let _tradeListScroll = 0;
// 告别场景播放中，防重入
let _goodbyeAnim = false;
// 交换页定时刷新已由 interval 在子页面时跳过（见 startRefreshCountdown 内 _tradeMode/_tradeDetail 判断），
// 无需额外冻结刷新倒计时；以下保留为空实现兼容旧调用点。
function pauseTradeRefresh() {}
function resumeTradeRefresh() {}

// ---------- 波次生成 ----------
// 交易物种：按演化家族聚类后等概率抽取（家族内成员再等概率随机）
function pickTradePokemon() {
  return pickFamily(allPokemon, () => 1);
}

// 给出的宝可梦个体值：神兽保底 3 项 31（与玩家捕获到的一致），
// 普通宝可梦随机生成，总个体值太低时补强 1~2 项到 31，保证交换物有价值
function rollTradeIvs(isLegend) {
  if (isLegend) return rollLegendIvs();
  const ivs = rollIvs();
  const sum = IV_KEYS.reduce((a, k) => a + ivs[k], 0);
  if (sum < TRADE_IV_SUM_MIN) {
    for (let i = 0, n = randInt(1, 2); i < n; i++) ivs[IV_KEYS[randInt(0, IV_KEYS.length - 1)]] = 31;
  }
  return ivs;
}

function makeOffer(npc) {
  const wantPoke = pickTradePokemon();
  const givePoke = pickTradePokemon();
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    npc: npc.id,
    want: {
      species: String(wantPoke.index),
      gender: wantPoke.genderRate !== -1 && Math.random() < TRADE_GENDER_CHANCE ? rollGender(String(wantPoke.index)) : null,
      iv: Math.random() < TRADE_IV_CHANCE ? { stat: IV_KEYS[randInt(0, IV_KEYS.length - 1)], min: randInt(TRADE_IV_MIN, 31) } : null,
      level: Math.random() < TRADE_LEVEL_CHANCE ? randInt(TRADE_WANT_LEVEL_MIN, TRADE_WANT_LEVEL_MAX) : null,
    },
    give: {
      species: String(givePoke.index),
      // 随从增益：trade 类提升交换 NPC 给出闪光的概率
      shiny: Math.random() < (window.__followerBoostMechanic?.('tradeShiny', TRADE_SHINY_CHANCE) ?? TRADE_SHINY_CHANCE),
      nature: rollNature(),
      ivs: rollTradeIvs(givePoke.legend === true), // 神兽保底 3 项 31
      level: randInt(1, TRADE_GIVE_LEVEL_MAX),
      // 生成时即固定性别：预览与交换实得共用同一字段，避免两次 roll 导致不一致
      gender: givePoke.genderRate === -1 ? 'genderless' : rollGender(String(givePoke.index)),
    },
    traded: false,
  };
}

// 波次生成：每波 TRADE_COUNT 个 offer；作者彩蛋以该概率取代某一格普通 offer
const AUTHOR_CHANCE = 0.01;
// 作者彩蛋 offer：需求与普通 offer 一致（玩家仍需付出），
// 但给出随机【神兽】闪光 6V（个体全 31）、满级
// 性格按神兽种族值最高项匹配：哪项种族最高就加哪项（HP 不吃性格修正，改给耐久向），
// 避免出现"特攻手带固执"这类属性浪费的废性格（固执=物攻+10%/特攻-10%）
// stats 下标：0HP 1攻 2防 3特攻 4特防 5速（与 battle-core NATURES 的 up/down 对应）
const AUTHOR_NATURE_POOLS = {
  0: ['bold', 'impish', 'calm', 'careful'],       // HP 最高：耐久向（加防/特防）
  1: ['adamant', 'lonely', 'brave', 'naughty'],   // 物攻最高：加物攻
  2: ['bold', 'impish', 'lax', 'relaxed'],        // 防御最高：加防御
  3: ['modest', 'mild', 'quiet', 'rash'],         // 特攻最高：加特攻
  4: ['calm', 'gentle', 'careful', 'sassy'],      // 特防最高：加特防
  5: ['jolly', 'timid', 'hasty', 'naive'],        // 速度最高：加速度
};
function pickAuthorNature(poke) {
  const s = poke.stats || [0, 0, 0, 0, 0, 0];
  let top = 0;
  for (let i = 1; i < s.length; i++) if (s[i] > s[top]) top = i;
  const pool = AUTHOR_NATURE_POOLS[top];
  return pool[randInt(0, pool.length - 1)];
}
function makeAuthorOffer() {
  const base = makeOffer({ id: 'author' }); // 复用需求生成，npc 先用作者占位
  const legends = allPokemon.filter(p => p.legend === true && p.noEggGroup);
  const givePoke = legends.length ? legends[randInt(0, legends.length - 1)] : allPokemon[0];
  base.npc = 'author';
  base.give = {
    species: String(givePoke.index),
    shiny: true,
    nature: pickAuthorNature(givePoke),
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: MAX_LEVEL,
    // 与普通 offer 一致：生成时固定性别
    gender: givePoke.genderRate === -1 ? 'genderless' : rollGender(String(givePoke.index)),
  };
  return base;
}

// 彩蛋 NPC「伊美蒂」offer：需求与普通 offer 一致，但只给【百变怪】；
// 10% 概率给出 6V 闪光百变怪，其余为普通百变怪；等级/性格按普通随机
const IMITI_6V_CHANCE = 0.1;
function makeImitiOffer() {
  const base = makeOffer({ id: 'imiti' });
  const ditto = allPokemon.find(p => String(p.index) === '0132') || allPokemon[0];
  base.npc = 'imiti';
  const sixV = Math.random() < IMITI_6V_CHANCE;
  base.give = {
    species: String(ditto.index),
    shiny: sixV,
    nature: rollNature(),
    ivs: sixV
      ? { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
      : rollTradeIvs(false),
    level: randInt(1, TRADE_GIVE_LEVEL_MAX),
    gender: ditto.genderRate === -1 ? 'genderless' : rollGender(String(ditto.index)),
  };
  return base;
}

// 生成并写入新一波交换 offers（重置刷新时间；通知手机主页红点按新一波刷新）
function regenerateOffers() {
  // 作者是彩蛋用 makeAuthorOffer 单独生成，普通 NPC 池必须剔除，否则会以普通 offer 冒充 ZTMYO
  const pool = NPCS.filter(n => n.id !== 'author' && n.id !== 'imiti');
  const offers = [];
  const count = Math.min(TRADE_COUNT, pool.length);
  // 作者彩蛋：以 0.01 概率取代某一格普通 offer
  const authorSlot = Math.random() < AUTHOR_CHANCE ? randInt(0, count - 1) : -1;
  // 伊美蒂彩蛋：与作者独立 roll 一格（避免同格冲突，若撞格则本波不出伊美蒂）
  let imitiSlot = Math.random() < AUTHOR_CHANCE ? randInt(0, count - 1) : -1;
  if (imitiSlot === authorSlot) imitiSlot = -1;
  for (let i = 0; i < count; i++) {
    if (i === authorSlot) { offers.push(makeAuthorOffer()); continue; }
    if (i === imitiSlot) { offers.push(makeImitiOffer()); continue; }
    offers.push(makeOffer(pool.splice(randInt(0, pool.length - 1), 1)[0]));
  }
  gameData.trades = { refreshedAt: Date.now(), offers };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('trade-wave-changed'));
}

// 到点或数据缺失时刷新一波
export function ensureTrades() {
  if (!gameData) return;
  const t = gameData.trades;
  if (!t || !Array.isArray(t.offers) || !t.refreshedAt || Date.now() - t.refreshedAt >= TRADE_REFRESH_MS) {
    regenerateOffers();
  }
  return gameData.trades;
}

// 强制刷新一波交换（无视是否到期，重置刷新时间）
export function refreshTrades() {
  if (!gameData) return;
  regenerateOffers();
}

// ---------- 匹配 ----------
// 在仓个体中找出符合 offer 要求（物种/性别/等级/个体值下限）的个体
function eligible(o) {
  return (gameData.roster || []).filter(p => p.inRoster && isPokemon(p)
    && String(p.species) === o.want.species
    && (!o.want.gender || ensureGender(p) === o.want.gender)
    && (!o.want.level || (p.level || 1) >= o.want.level)
    && (!o.want.iv || !p.ivs || (p.ivs[o.want.iv.stat] ?? 0) >= o.want.iv.min));
}

// 该个体用经验糖果升到目标等级需要的糖果数（升满级所需经验逐级累加，向上取整）
function candiesToReach(p, targetLv) {
  if (!targetLv || (p.level || 1) >= targetLv) return 0;
  let need = 0;
  for (let l = (p.level || 1); l < targetLv && l < MAX_LEVEL; l++) need += 25 + l * 20;
  need = Math.max(0, need - (p.exp || 0));
  return Math.ceil(need / EXP_CANDY_XP);
}

// 可培养候选：物种/性别/个体值符合 offer 要求，但等级不足，
// 且手中经验糖果数量足够将该个体升到 offer 要求等级
function cultivable(o) {
  if (!o.want.level) return [];
  const stock = gameData.items['exp-candy'] || 0;
  return (gameData.roster || []).filter(p => p.inRoster && isPokemon(p)
    && String(p.species) === o.want.species
    && (!o.want.gender || ensureGender(p) === o.want.gender)
    && (!o.want.iv || !p.ivs || (p.ivs[o.want.iv.stat] ?? 0) >= o.want.iv.min)
    && (p.level || 1) < o.want.level
    && candiesToReach(p, o.want.level) <= stock);
}

// 是否有可交换的宝可梦（手机主页红点）：存在未交换、未忽略且仓库有符合要求个体或可培养个体的 offer
export function hasTradableOffers() {
  return (gameData?.trades?.offers || []).some(o => !o.traded && !o.ignored && (eligible(o).length > 0 || cultivable(o).length > 0));
}

// 可交换 offer 数量（托盘悬停提示用）
export function countTradableOffers() {
  return (gameData?.trades?.offers || []).filter(o => !o.traded && !o.ignored && (eligible(o).length > 0 || cultivable(o).length > 0)).length;
}

// ---------- 渲染 ----------
export function showTradeView() {
  pushNav('tradeView');
  _tradeMode = null;
  _tradeDetail = null;
  _tradeListScroll = 0;
  renderTrade();
  showView('tradeView');
  const tc = $('tradeContent');
  if (tc) tc.scrollTop = 0; // 首次进入交换页从顶部开始
  startRefreshCountdown();
}

// 距下一波刷新剩余时间文案
function refreshText() {
  const left = Math.max(0, TRADE_REFRESH_MS - (Date.now() - (gameData.trades?.refreshedAt || 0)));
  const s = Math.ceil(left / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}时${m}分${sec}秒` : `${m}分${sec}秒`;
}

// 每秒更新顶部倒计时；到点自动刷新一波
function startRefreshCountdown() {
  if (startRefreshCountdown._timer) return;
  startRefreshCountdown._timer = setInterval(() => {
    if ($('tradeView')?.style.display === 'none') {
      clearInterval(startRefreshCountdown._timer);
      startRefreshCountdown._timer = null;
      return;
    }
    if (_tradeMode || _tradeDetail) return; // 子页面不刷新
    if (TRADE_REFRESH_MS - (Date.now() - (gameData.trades?.refreshedAt || 0)) <= 0) {
      renderTrade(); // 到点生成新一波
      return;
    }
    const t = $('tradeRefreshTip');
    if (t) t.textContent = `距离下一波刷新：${refreshText()}`;
  }, 1000);
}

// 处于子页面（选交出个体 / 查看给出详情）时返回走标题栏
export function isTradeInDetail() {
  return _tradeMode != null || _tradeDetail != null;
}
export function restoreTradeList() {
  stopShinySparkleLoop(); // 离开详情/选择子页面：停止闪光粒子循环
  _tradeMode = null;
  _tradeDetail = null;
  resumeTradeRefresh(); // 离开选择子页面：恢复刷新倒计时
  renderTrade();
  // 恢复进入子页面前的列表滚动位置
  const tc = $('tradeContent');
  if (tc) tc.scrollTop = _tradeListScroll;
}

// 渲染交换页（列表或当前子页面）；供 showTradeView / 定时刷新 / 聚合刷新调用
export function renderTrade() {
  const content = $('tradeContent');
  if (!content) return;
  ensureTrades();
  // 滚动位置由各入口（进入子页面滚顶 / 返回列表恢复）控制，这里不干预
  if (_tradeDetail) { renderGiveDetail(content, _tradeDetail); return; }
  if (_tradeMode) { renderSelect(content, _tradeMode); return; }
  const offers = gameData.trades.offers.filter(o => !o.traded); // 已交换的条目直接隐藏
  content.innerHTML = `
    <div id="tradeRefreshTip">距离下一波刷新：${refreshText()}</div>
    <div class="trade-list">${offers.map(offerCard).join('')}</div>`;
  // 加载 NPC 给出宝可梦的小图标
  content.querySelectorAll('[data-give-icon]').forEach(el => {
    const o = offers.find(x => x.id === el.dataset.giveIcon);
    const poke = o && getPokemonByIndex(o.give.species);
    if (poke?.icon) tryLoadImage(el, poke.icon);
  });
  // 右键未交换的 offer 行：弹出「忽略/恢复」菜单（可去掉手机主页红点，参考悬赏右键）
  content.oncontextmenu = (e) => {
    const row = e.target.closest('.trade-row');
    if (!row) return;
    const offerBtn = row.querySelector('[data-offer]');
    if (!offerBtn || offerBtn.disabled) return; // 已交换/未拥有无需提醒
    const o = offers.find(x => x.id === offerBtn.dataset.offer);
    if (!o) return;
    e.preventDefault();
    showTradeContextMenu(!!o.ignored, offerBtn.dataset.offer, e.clientX, e.clientY);
  };
}

// 单张 offer 卡片：NPC 行走动画 + 想要/给出说明 + 交换按钮
function offerCard(o) {
  const npc = NPCS.find(n => n.id === o.npc) || NPCS[0];
  // NPC 首帧拼图（npcs.png：13列×2行 + 行0末列追加的作者彩蛋，每格 16×21，2x 显示），按下标定位；
  // 普通 NPC 用 13 列公式（图片物理位置未变），作者固定取新增列（x=208 → -416px）
  const npcIdx = Math.max(0, NPCS.indexOf(npc));
  const npcPos = npc.id === 'author'
    ? 'background-position:-416px 0px'
    : npc.id === 'imiti'
    ? 'background-position:-416px -42px'
    : `background-position:${-(npcIdx % 13) * 32}px ${-Math.floor(npcIdx / 13) * 42}px`;
  const wantPoke = getPokemonByIndex(o.want.species);
  const givePoke = getPokemonByIndex(o.give.species);
  if (!wantPoke || !givePoke) return '';
  const traded = !!o.traded;
  const ignored = !!o.ignored;
  const count = eligible(o).length;
  // 无可直接交换个体时，若糖果足够把某只升到要求等级，按钮仅显示「可培养」（不可点击，只作提示）
  const cultCount = cultivable(o).length;

  // 需求连成一句话：想要 Lv30以上 ，攻击 ≥ 26 的雌性皮卡丘
  const wantParts = [
    o.want.level ? `Lv${o.want.level}以上` : '',
    o.want.iv ? `${IV_LABELS[o.want.iv.stat]} ≥ ${o.want.iv.min} ` : '',
  ].filter(Boolean);
  const wantGender = o.want.gender === 'female' ? '雌性' : o.want.gender === 'male' ? '雄性' : '';
  const wantText = '想要' + (wantParts.length ? wantParts.join('，') + '的' : '') + wantGender + (wantPoke.form || wantPoke.name);

  const giveIcon = givePoke.icon
    ? `<img class="trade-give-img" data-give-icon="${o.id}" alt="" />`
    : '';
  // 每个宝可梦随机起跳相位，避免整排同时跳
  const jumpDelay = '-' + (Math.random() * 1.2).toFixed(2);

  return `
    <div class="trade-row${traded ? ' traded' : ignored ? ' ignored' : ''}">
      <div class="trade-main">
        <div class="npc-sprite" style="${npcPos}"></div>
        <button class="trade-give" style="animation-delay:${jumpDelay}s" data-give-detail="${o.id}" title="查看${givePoke.form || givePoke.name}详情">${giveIcon}</button>
        <div class="trade-text">${wantText}</div>
        <button class="trade-btn${traded ? ' done' : (count === 0 && cultCount === 0) ? ' locked' : ''}" data-offer="${o.id}"${traded || count === 0 ? ' disabled' : ''}>${traded ? '已交换' : count > 0 ? '交换' : cultCount > 0 ? '可培养' : '未拥有'}</button>
      </div>
      <div class="trade-footer">
        <span class="trade-npc-name">${npc.name}</span>
        <span class="trade-give-name">${givePoke.form || givePoke.name}${o.give.shiny ? ' <svg class="trade-shiny" viewBox="0 0 1024 1024" width="10" height="10"><use xlink:href="#icon-star"/></svg>' : ''} <em>${genderBadge(ensureGender(o.give))}Lv${o.give.level || 1}</em></span>
      </div>
    </div>`;
}

// 六围个体值 → 六边形雷达图（与仓库详情一致）
function ivHexagon(ivs) {
  const cx = 50, cy = 50, r = 34;
  const pt = (i, ratio) => {
    const a = (Math.PI / 180) * (-90 + 60 * i);
    return [cx + r * ratio * Math.cos(a), cy + r * ratio * Math.sin(a)];
  };
  const poly = ratio => IV_KEYS.map((_, i) => pt(i, ratio).map(n => n.toFixed(1)).join(',')).join(' ');
  const data = IV_KEYS.map((k, i) => pt(i, (ivs[k] || 0) / 31).map(n => n.toFixed(1)).join(',')).join(' ');
  const axes = IV_KEYS.map((_, i) => {
    const [x, y] = pt(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(var(--ui-color-rgb),0.15)" stroke-width="0.5"/>`;
  }).join('');
  const labels = IV_KEYS.map((k, i) => {
    const [x, y] = pt(i, 1.32);
    return `<text x="${x.toFixed(1)}" y="${(y + 2).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="var(--ui-color)">${IV_LABELS[k]}</text>`;
  }).join('');
  const dots = IV_KEYS.map((k, i) => {
    const [x, y] = pt(i, (ivs[k] || 0) / 31);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.7" fill="var(--ui-color)"/>`;
  }).join('');
  return `<svg viewBox="0 0 100 100" class="roster-hex">
    <polygon points="${poly(0.34)}" fill="none" stroke="rgba(var(--ui-color-rgb),0.18)" stroke-width="0.5"/>
    <polygon points="${poly(0.67)}" fill="none" stroke="rgba(var(--ui-color-rgb),0.18)" stroke-width="0.5"/>
    <polygon points="${poly(1)}" fill="none" stroke="rgba(var(--ui-color-rgb),0.18)" stroke-width="0.5"/>
    ${axes}
    <polygon points="${data}" fill="rgba(var(--ui-color-rgb),0.22)" stroke="var(--ui-color)" stroke-width="1.2"/>
    ${dots}
    ${labels}
  </svg>`;
}

// NPC 给出宝可梦详情：仿照仓库个体详情页（图片/类型/性格 + 六边形雷达图 + 个体条），返回走标题栏
function renderGiveDetail(content, offerId) {
  const o = (gameData.trades?.offers || []).find(x => x.id === offerId);
  if (!o) { _tradeDetail = null; renderTrade(); return; }
  const givePoke = getPokemonByIndex(o.give.species);
  if (!givePoke) { _tradeDetail = null; renderTrade(); return; }
  const ivs = o.give.ivs || {};
  const ivTotal = IV_KEYS.reduce((a, k) => a + (ivs[k] || 0), 0);
  const bars = IV_KEYS.map(k => {
    const v = ivs[k] || 0;
    return `<div class="roster-iv-item"><span>${IV_LABELS[k]}</span>
      <div class="roster-iv-bar"><div class="roster-iv-fill" style="width:${(v / 31 * 100).toFixed(0)}%"></div></div>
      <span>${v}</span></div>`;
  }).join('');
  content.innerHTML = `
    <div style="font-size:14px;font-weight:700;padding:6px 5px 2px;display:flex;align-items:center;justify-content:space-between;">
      <span>${givePoke.form || givePoke.name}<span class="roster-detail-lv">${genderBadge(ensureGender(o.give))}Lv${o.give.level || 1}</span>${o.give.shiny ? ' <svg class="roster-shiny" viewBox="0 0 1024 1024" width="14" height="14" style="flex-shrink:0;vertical-align:-2px;transform:translateY(-2px);"><use xlink:href="#icon-star"/></svg>' : ''}</span>
      <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <button class="trade-check-roster" data-trade-roster>仓库情况</button>
        <span class="encounter-owned-wrap" id="tradeGiveOwnedWrap" style="display:none;">
          <svg class="encounter-owned" viewBox="0 0 1024 1024" width="18" height="18"><use xlink:href="#icon-owned" /></svg>
          <span class="encounter-tooltip" id="tradeGiveOwnedTip"></span>
        </span>
      </span>
    </div>
    <div class="roster-detail-head">
      <div class="poke-img-grid"><img id="tradeGiveDetailImg" class="poke-img-in-grid" alt="" /></div>
      <div style="min-width:0;">
        <div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:3px;">
          ${(givePoke.types || []).map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`).join('')}
        </div>
        <div style="font-size:10px;opacity:0.7;line-height:1.5;">
          <div data-tip="${natureBoostText(o.give.nature)}" style="cursor:pointer;">性格：${(getNature(o.give.nature) || { cn: '—' }).cn}</div>
        </div>
      </div>
    </div>
    <div class="roster-detail-block">
      <div class="roster-detail-title">个体值 <span style="opacity:0.6;">${ivTotal}/186</span></div>
      <div class="roster-iv-flex">
        ${ivHexagon(ivs)}
        <div class="roster-iv-bars">${bars}</div>
      </div>
    </div>`;
  // 已捕获标记：右上角 owned 图标（普通/闪光分开），hover 显示首次捕获时间
  const ownedWrap = $('tradeGiveOwnedWrap');
  if (ownedWrap) {
    const entry = gameData.pokedex[String(o.give.species)];
    const hasCaught = entry && (o.give.shiny ? entry.shinyCaught > 0 : entry.caught > 0);
    ownedWrap.style.display = hasCaught ? '' : 'none';
    if (hasCaught) {
      const tip = $('tradeGiveOwnedTip');
      if (tip) {
        const logs = (gameData.encounterLogs || {})[String(o.give.species)] || [];
        const first = logs.find(l => l.result === 'caught' && !!l.shiny === !!o.give.shiny);
        if (first && first.time) {
          const d = new Date(first.time);
          const pad = n => String(n).padStart(2, '0');
          tip.textContent = `首次捕获：${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } else {
          tip.textContent = '首次捕获：较早前';
        }
      }
    }
  }
  const img = $('tradeGiveDetailImg');
  if (img) {
    // 时空扭曲外观变体：按个体 variant 应用 CSS 特效（RGB 分离 / 污染紫）
    img.classList.remove('fx-variant-rgb', 'fx-variant-polluted');
    if (o.give.variant === 'rgb') img.classList.add('fx-variant-rgb');
    else if (o.give.variant === 'polluted') img.classList.add('fx-variant-polluted');
    tryLoadPokemonImage(img, givePoke, o.give.shiny ? '_shiny' : '').then(() => {
      // 闪光个体：图片周围循环播放星星粒子（与个体详情页同款）
      if (o.give.shiny) startShinySparkleOn($('tradeView'), img, { cls: 'sm', scale: 0.6 });
    });
  }
}

// 选择交出哪只个体（布局与蛋仓库一致：进度 + 昵称搜索 + 表头 + 滚动列表）
function renderSelect(content, offerId) {
  const o = (gameData.trades?.offers || []).find(x => x.id === offerId);
  if (!o) { _tradeMode = null; renderTrade(); return; }
  const wantPoke = getPokemonByIndex(o.want.species);
  const candidates = eligible(o);
  const wantName = wantPoke ? (wantPoke.form || wantPoke.name) : '';
  // 昵称搜索过滤
  let pool = candidates;
  const q = _tQuery.trim();
  if (q) pool = candidates.filter(p => p.nickname && p.nickname.includes(q));
  // 表头点击排序：个体值/等级（同物种候选按数值排）
  if (_tSortBy) {
    pool = [...pool].sort((a, b) => {
      const ivSum = p => p.ivs ? p.ivs.hp + p.ivs.atk + p.ivs.def + p.ivs.spa + p.ivs.spd + p.ivs.spe : 0;
      const va = _tSortBy === 'level' ? (a.level || 1) : ivSum(a);
      const vb = _tSortBy === 'level' ? (b.level || 1) : ivSum(b);
      return (va - vb) * _tSortDir;
    });
  }
  const rowsHtml = pool.length === 0
    ? '<div class="trade-empty">没有符合条件的宝可梦</div>'
    : pool.map(p => {
        const ivStat = o.want.iv ? o.want.iv.stat : null;
        const ivsText = p.ivs ? IV_KEYS.map(k => {
          const v = p.ivs[k] || 0;
          return k === ivStat ? `<b class="roster-iv-hl">${v}</b>` : String(v);
        }).join('/') : '';
        return `
        <div class="pokedex-entry roster-row bounty-trade-row" data-trade-view="${p.id}">
          <span class="roster-icon"><img class="roster-icon-img" data-trade-icon="${p.id}" alt="" /></span>
          <span class="pokedex-star">${pokemonSourceBadge(p)}</span>
          <span class="roster-ivs">${ivsText}</span>
          <span class="roster-nature">${genderBadge(ensureGender(p))}Lv${p.level || 1}</span>
          <span class="bounty-trade-btn-col"><button class="bounty-trade-btn" data-trade-submit="${p.id}">交换</button></span>
        </div>`;
      }).join('');
  const syncIcons = () => {
    content.querySelectorAll('[data-trade-icon]').forEach(el => {
      const p = (gameData.roster || []).find(r => r.id === el.dataset.tradeIcon);
      const poke = p && getPokemonByIndex(String(p.species));
      if (poke?.icon) tryLoadImage(el, poke.icon);
    });
  };
  // 已有完整页面：只增量更新进度/列表/表头排序标记（保留搜索框焦点）
  const existing = content.querySelector('.bounty-trade-list');
  if (existing) {
    const progress = existing.querySelector('.pokedex-progress');
    if (progress) progress.textContent = `交换 ${wantName} · 共 ${candidates.length} 只`;
    const list = existing.querySelector('.list-scroll');
    if (list) list.innerHTML = rowsHtml;
    existing.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
    const cur = existing.querySelector(`[data-sort="${_tSortBy}"]`);
    if (cur) cur.classList.add(_tSortDir === 1 ? 'sort-asc' : 'sort-desc');
    const clearBtn = existing.querySelector('#tradeSelectSearchClear');
    if (clearBtn) clearBtn.style.display = q ? '' : 'none';
    syncIcons();
    return;
  }
  // 首次渲染：创建完整页面（进度 + 搜索框 + 表头 + 滚动列表）
  content.innerHTML = `
    <div class="bounty-trade-list">
      <div class="pokedex-progress">交换 ${wantName} · 共 ${candidates.length} 只</div>
      <div class="pokedex-search">
        <div class="pokedex-search-row">
          <div class="pokedex-search-input-wrap">
            <input id="tradeSelectSearch" class="pokedex-search-input" type="text" placeholder="昵称搜索" autocomplete="off" value="${_tQuery}" />
            <button class="pokedex-search-clear" id="tradeSelectSearchClear" style="display:${q ? '' : 'none'};" aria-label="清空搜索">
              <svg><use xlink:href="#icon-close" /></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="pokedex-header roster-header">
        <span class="roster-icon"></span>
        <span class="pokedex-star"></span>
        <span class="roster-ivs" data-sort="iv">个体值</span>
        <span class="roster-nature" data-sort="level">等级</span>
        <span class="bounty-trade-btn-col">交换</span>
      </div>
      <div class="list-scroll">
        ${rowsHtml}
      </div>
    </div>`;
  // 搜索：输入即过滤（增量更新保留焦点）；清空按钮只在有输入时显示
  const input = content.querySelector('#tradeSelectSearch');
  const clearBtn = content.querySelector('#tradeSelectSearchClear');
  if (input) {
    input.addEventListener('input', () => {
      _tQuery = input.value;
      renderTrade();
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', () => {
    _tQuery = '';
    if (input) input.value = '';
    renderTrade();
  });
  // 标记当前排序列
  const header = content.querySelector('.pokedex-header');
  if (header && _tSortBy) {
    const cur = header.querySelector(`[data-sort="${_tSortBy}"]`);
    if (cur) cur.classList.add(_tSortDir === 1 ? 'sort-asc' : 'sort-desc');
  }
  syncIcons();
}

// ---------- 交换执行 ----------
function doTrade(offerId, rid) {
  const o = (gameData.trades?.offers || []).find(x => x.id === offerId);
  if (!o || o.traded || _goodbyeAnim) return;
  const p = (gameData.roster || []).find(r => r.id === rid && r.inRoster);
  if (!p || !eligible(o).some(x => x.id === rid)) return;
  const givePoke = getPokemonByIndex(o.give.species);
  const npc = NPCS.find(n => n.id === o.npc) || NPCS[0];
  _goodbyeAnim = true;
  // 第一阶段：交出的宝可梦告别
  showGoodbyeConfirm({
    poke: getPokemonByIndex(String(p.species)),
    prompt: `和${npc.name}交换吗？`,
    shiny: !!p.shiny,
    variant: p.variant || null,
    onConfirm: () => {
      const arr = gameData.roster || [];
      const ri = arr.findIndex(r => r.id === rid);
      if (ri >= 0) arr.splice(ri, 1);
      const entry = addRosterEntry({ species: o.give.species, shiny: o.give.shiny, source: 'trade', level: o.give.level || 1, gender: ensureGender(o.give) });
      if (entry) { entry.ivs = o.give.ivs; entry.nature = o.give.nature; setLastObtainedEntryId(entry.id); }
      playCongratulation(); // 交换获得宝可梦 → 祝贺音效
      // 记录交换前的图鉴状态（右上角「已捕获/新发现」按交换前判定，与孵蛋一致）
      const idx = o.give.species;
      const beforePdx = gameData.pokedex[idx];
      const wasOwned = !!beforePdx && (o.give.shiny ? beforePdx.shinyCaught > 0 : beforePdx.caught > 0);
      const isNew = !beforePdx ? true : o.give.shiny ? beforePdx.shinySeen === 0 : beforePdx.seen === 0;
      // 图鉴解锁 + 遭遇日志（与孵化流程一致）
      if (!gameData.pokedex[idx]) gameData.pokedex[idx] = { seen: 0, caught: 0, lastTime: null, shinySeen: 0, shinyCaught: 0 };
      gameData.pokedex[idx].seen++;
      gameData.pokedex[idx].caught = (gameData.pokedex[idx].caught || 0) + 1;
      gameData.pokedex[idx].lastTime = new Date().toISOString();
      if (o.give.shiny) {
        gameData.pokedex[idx].shinyCaught = (gameData.pokedex[idx].shinyCaught || 0) + 1;
        gameData.stats.totalShinyTraded = (gameData.stats.totalShinyTraded || 0) + 1; // 交换闪光：单独计数，不算闪光捕获
      }
      gameData.stats.totalCatches = (gameData.stats.totalCatches || 0) + 1;
      gameData.stats.totalTrades = (gameData.stats.totalTrades || 0) + 1;
      // 今日交换数：跨天自动清零
      const td = new Date();
      const ds = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}-${String(td.getDate()).padStart(2, '0')}`;
      if (gameData.stats.lastTradeDate !== ds) {
        gameData.stats.lastTradeDate = ds;
        gameData.stats.tradesToday = 0;
      }
      gameData.stats.tradesToday = (gameData.stats.tradesToday || 0) + 1;
      if (!gameData.encounterLogs) gameData.encounterLogs = {};
      if (!gameData.encounterLogs[idx]) gameData.encounterLogs[idx] = [];
      gameData.encounterLogs[idx].push({
        time: Date.now(),
        shiny: o.give.shiny,
        result: 'caught',
        balls: {},
        charmBuff: false,
        source: 'trade',
        npcName: npc.name, // 与谁交换
        gave: (() => { const gp = getPokemonByIndex(String(p.species)); return gp ? (gp.form || gp.name) : ''; })(), // 用哪只换来的
        score: 0, // 交换为固定提议，玩家主动选择，不涉及随机运气，不计欧气分
      });
      o.traded = true;
      addSystemLog('trade', { npc: npc.id, npcName: npc.name, take: o.want.species, give: o.give.species, shiny: o.give.shiny });
      _goodbyeAnim = false;
      _tradeMode = null;
      resumeTradeRefresh(); // 交换成功：恢复刷新倒计时（若已到期，返回列表时自动刷新新一波）
      saveGame();
      updateStats();
      // 第二阶段：收到的宝可梦从小放大显示，精简显示右上角信息，点击询问是否查看仓库详情
      showTradeReceive({
        poke: givePoke,
        shiny: !!o.give.shiny,
        variant: o.give.variant || null,
        isNew,
        wasOwned,
        onYes: () => {
          // 先刷新交换列表（该 offer 已标记交换），再跳转仓库中该个体的详情
          renderTrade();
          const tc = $('tradeContent');
          if (tc) tc.scrollTop = _tradeListScroll;
          import('./roster.js').then(m => m.showRosterDetailById(entry.id, 'tradeView'));
        },
        onClose: () => {
          renderTrade();
          const tc = $('tradeContent');
          if (tc) tc.scrollTop = _tradeListScroll; // 回到列表，恢复位置
        },
      });
    },
    onCancel: () => { _goodbyeAnim = false; },
  });
}

// 交换右键菜单：在右键位置弹出「忽略/恢复」项（样式复用商店批量购买菜单）
function showTradeContextMenu(ignored, offerId, x, y) {
  hideTradeContextMenu();
  let menu = $('tradeCtxMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'tradeCtxMenu';
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = `<div class="shop-ctx-item" data-ctx-offer="${offerId}">${ignored ? '恢复红点提醒' : '忽略此交换'}</div>`;
  menu.style.display = '';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const { x: lx, y: ly, w: vw, h: vh } = logicViewport(x, y); // zoom 下还原逻辑坐标
  menu.style.left = Math.max(0, Math.min(lx - 24, vw - mw - 4)) + 'px';
  menu.style.top = Math.max(0, Math.min(ly, vh - mh - 4)) + 'px';
  // 菜单内点击不触发外部关闭；点击外部任意位置关闭
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.onclick = (e) => {
    const opt = e.target.closest('.shop-ctx-item');
    if (!opt) return;
    hideTradeContextMenu();
    toggleIgnoreOffer(opt.dataset.ctxOffer);
  };
  document.addEventListener('pointerdown', hideTradeContextMenu);
}

function hideTradeContextMenu() {
  const menu = $('tradeCtxMenu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('pointerdown', hideTradeContextMenu);
}

// 切换 offer「忽略」状态：忽略后不再计入手机主页红点与托盘可交换计数，但随时可恢复/正常交换
function toggleIgnoreOffer(offerId) {
  const o = (gameData.trades?.offers || []).find(x => x.id === offerId);
  if (!o) return;
  o.ignored = !o.ignored;
  saveGame();
  renderTrade();
  // 刷新手机主页红点与托盘提示
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('trade-wave-changed'));
}

// ---------- 事件绑定 ----------
// 后台新增/培养宝可梦（捕获/孵化/交换/经验糖果升级）时，刷新交换按钮的可用状态。
// 不要求交换页可见：DOM 在隐藏时也更新，返回交换页即显示最新状态
function refreshTradeButtons() {
  if (_tradeMode != null || _tradeDetail != null) return;
  const content = $('tradeContent');
  if (!content) return;
  (gameData.trades?.offers || []).forEach(o => {
    const btn = content.querySelector(`[data-offer="${o.id}"]`);
    if (!btn) return;
    const traded = !!o.traded;
    const count = eligible(o).length;
    const cultCount = cultivable(o).length;
    btn.className = `trade-btn${traded ? ' done' : (count === 0 && cultCount === 0) ? ' locked' : ''}`;
    btn.disabled = traded || count === 0;
    btn.textContent = traded ? '已交换' : count > 0 ? '交换' : cultCount > 0 ? '可培养' : '未拥有';
  });
}
window.addEventListener('roster-changed', refreshTradeButtons);

document.addEventListener('click', e => {
  const content = $('tradeContent');
  if (!content || $('tradeView').style.display !== 'flex') return;

  const offerBtn = e.target.closest('[data-offer]');
  if (offerBtn && !offerBtn.disabled) {
    const tc = $('tradeContent');
    if (tc) { _tradeListScroll = tc.scrollTop; tc.scrollTop = 0; } // 记住列表位置，子页面从顶部开始
    pauseTradeRefresh(); // 进入选择子页面：冻结刷新倒计时
    _tradeMode = offerBtn.dataset.offer;
    _tQuery = ''; // 进入新的候选列表：昵称搜索词一律重置，不与上次残留词混用
    renderTrade();
    return;
  }
  const submitBtn = e.target.closest('[data-trade-submit]');
  if (submitBtn) {
    doTrade(_tradeMode, submitBtn.dataset.tradeSubmit);
    return;
  }
  // 选择列表表头点击排序（3 段 toggle：升序 → 降序 → 回到默认保持仓库顺序）
  const sortEl = e.target.closest('.bounty-trade-list .pokedex-header [data-sort]');
  if (sortEl && _tradeMode) {
    const f = sortEl.dataset.sort;
    if (_tSortBy === f) {
      if (_tSortDir === 1) _tSortDir = -1;
      else { _tSortBy = null; _tSortDir = 1; }
    } else { _tSortBy = f; _tSortDir = 1; }
    renderTrade();
    return;
  }
  // 点击候选个体行：进入仓库个体详情（第三层），返回时恢复选择列表
  const viewRow = e.target.closest('[data-trade-view]');
  if (viewRow && _tradeMode) {
    pauseTradeRefresh(); // 详情期间同样冻结刷新倒计时
    import('./roster.js').then(m => m.showRosterDetailFromList(viewRow.dataset.tradeView, () => {
      resumeTradeRefresh(); // 返回选择列表：恢复刷新倒计时
      showView('tradeView');
      renderTrade();
    }));
    return;
  }
  // 详情页右上角「仓库情况」：跳转仓库列表并预填该宝可梦名称搜索，返回恢复交换详情
  const rosterBtn = e.target.closest('[data-trade-roster]');
  if (rosterBtn) {
    const o = (gameData.trades?.offers || []).find(x => x.id === _tradeDetail);
    const givePoke = o && getPokemonByIndex(o.give.species);
    if (!givePoke) return;
    pauseTradeRefresh(); // 查看仓库期间冻结刷新倒计时
    import('./roster.js').then(m => m.showRosterSearch(givePoke.name, () => {
      resumeTradeRefresh(); // 返回交换详情：恢复刷新倒计时
      showView('tradeView');
      renderTrade();
    }));
    return;
  }
  const giveBtn = e.target.closest('[data-give-detail]');
  if (giveBtn) {
    const tc = $('tradeContent');
    if (tc) { _tradeListScroll = tc.scrollTop; tc.scrollTop = 0; } // 记住列表位置，子页面从顶部开始
    _tradeDetail = giveBtn.dataset.giveDetail;
    renderTrade();
    return;
  }
});
