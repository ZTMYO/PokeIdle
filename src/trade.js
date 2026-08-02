// ===== 交换（宝可梦交换） =====
// 每半小时刷新一波：若干 NPC 在交换广场挂出「想要的宝可梦（可指定性格/某项个体值下限）」和
// 「愿意给的宝可梦（个体值/性格/闪光具体可见）」，玩家拿符合要求的在仓个体与其交换，
// 得到的宝可梦来源记为「交换」。
import { TRADE_COUNT, TRADE_REFRESH_MS, TRADE_NATURE_CHANCE, TRADE_IV_CHANCE, TRADE_IV_MIN, TRADE_SHINY_CHANCE, TRADE_IV_SUM_MIN } from './config.js';
import { gameData, allPokemon, getPokemonByIndex, getNature, setPrevView, saveGame, addSystemLog, randInt, rollIvs, rollNature, addRosterEntry, setLastObtainedEntryId } from './state.js';
import { $, showView, updateStats, tryLoadImage, tryLoadPokemonImage } from './ui.js';
import { showGoodbyeConfirm, showTradeReceive } from './animation.js';
import { computeObtainScore } from './scoring.js';
import { TYPE_COLORS } from './items.js';

// ---------- NPC ----------
// 图源 src/character/npc 的 9 帧行走图（等宽 16px），同名角色共用名字
// 顺序必须与 npcs.png 拼图坐标一致：行0 = 0..12，行1 = 13..25
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
];
const IV_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const IV_LABELS = { hp: 'HP', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };

// 当前正在选择交出个体的 offer（null 表示在广场列表页）
let _tradeMode = null;
// 当前正在查看「NPC 给出宝可梦」详情的 offer（null 表示未在详情页）
let _tradeDetail = null;
// 进入子页面时保存的列表滚动位置，返回列表时恢复
let _tradeListScroll = 0;
// 告别场景播放中，防重入
let _goodbyeAnim = false;
// 处于「选择交出个体」子页面时冻结刷新倒计时的起始时间戳（0 = 未在暂停）
let _tradePauseStart = 0;

// 进入选择子页面：冻结波次刷新倒计时，避免玩家还在纠结时到期刷新
function pauseTradeRefresh() {
  if (!_tradePauseStart) _tradePauseStart = Date.now();
}
// 离开选择子页面：把暂停期补回刷新基准，等效恢复倒计时
function resumeTradeRefresh() {
  if (_tradePauseStart && gameData.trades) {
    gameData.trades.refreshedAt += Date.now() - _tradePauseStart;
    _tradePauseStart = 0;
    saveGame();
  }
}

// ---------- 波次生成 ----------
// 权重 = 0.3 + 稀有度 × 0.7（与悬赏选角一致的稀有度倾向）
function weightedIndex(pool) {
  const weights = pool.map(p => 0.3 + (p.rarity || 0) * 0.7);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return pool.length - 1;
}

// 给出的宝可梦个体值：随机生成，总个体值太低时补强 1~2 项到 31，保证交换物有价值
function rollTradeIvs() {
  const ivs = rollIvs();
  const sum = IV_KEYS.reduce((a, k) => a + ivs[k], 0);
  if (sum < TRADE_IV_SUM_MIN) {
    for (let i = 0, n = randInt(1, 2); i < n; i++) ivs[IV_KEYS[randInt(0, IV_KEYS.length - 1)]] = 31;
  }
  return ivs;
}

function makeOffer(npc) {
  const wantPoke = allPokemon[weightedIndex(allPokemon)];
  const givePoke = allPokemon[weightedIndex(allPokemon)];
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    npc: npc.id,
    want: {
      species: String(wantPoke.index),
      nature: Math.random() < TRADE_NATURE_CHANCE ? rollNature() : null,
      iv: Math.random() < TRADE_IV_CHANCE ? { stat: IV_KEYS[randInt(0, IV_KEYS.length - 1)], min: randInt(TRADE_IV_MIN, 31) } : null,
    },
    give: {
      species: String(givePoke.index),
      shiny: Math.random() < TRADE_SHINY_CHANCE,
      nature: rollNature(),
      ivs: rollTradeIvs(),
    },
    traded: false,
  };
}

// 到点或数据缺失时刷新一波
export function ensureTrades() {
  if (!gameData) return;
  const t = gameData.trades;
  if (!t || !Array.isArray(t.offers) || !t.refreshedAt || Date.now() - t.refreshedAt >= TRADE_REFRESH_MS) {
    const pool = [...NPCS];
    const offers = [];
    for (let i = 0, n = Math.min(TRADE_COUNT, pool.length); i < n; i++) {
      offers.push(makeOffer(pool.splice(randInt(0, pool.length - 1), 1)[0]));
    }
    gameData.trades = { refreshedAt: Date.now(), offers };
    // 通知手机主页红点按新一波刷新（新一波无可交换时熄灭）
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('trade-wave-changed'));
  }
  return gameData.trades;
}

// ---------- 匹配 ----------
// 在仓个体中找出符合 offer 要求（物种/性格/个体值下限）的个体
function eligible(o) {
  return (gameData.roster || []).filter(p => p.inRoster
    && String(p.species) === o.want.species
    && (!o.want.nature || p.nature === o.want.nature)
    && (!o.want.iv || !p.ivs || (p.ivs[o.want.iv.stat] ?? 0) >= o.want.iv.min));
}

// 是否有可交换的宝可梦（手机主页红点）：存在未交换且仓库有符合要求个体的 offer
export function hasTradableOffers() {
  return (gameData?.trades?.offers || []).some(o => !o.traded && eligible(o).length > 0);
}

// ---------- 渲染 ----------
export function showTradeView() {
  setPrevView('phoneView');
  _tradeMode = null;
  _tradeDetail = null;
  _tradeListScroll = 0;
  renderTrade();
  showView('tradeView');
  const tv = $('tradeView');
  if (tv) tv.scrollTop = 0; // 首次进入交换页从顶部开始
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
  _tradeMode = null;
  _tradeDetail = null;
  resumeTradeRefresh(); // 离开选择子页面：恢复刷新倒计时
  renderTrade();
  // 恢复进入子页面前的列表滚动位置
  const tv = $('tradeView');
  if (tv) tv.scrollTop = _tradeListScroll;
}

function renderTrade() {
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
}

// 单张 offer 卡片：NPC 行走动画 + 想要/给出说明 + 交换按钮
function offerCard(o) {
  const npc = NPCS.find(n => n.id === o.npc) || NPCS[0];
  // NPC 首帧拼图（npcs.png：13列×2行，每格 16×21，2x 显示），按下标定位
  const npcIdx = Math.max(0, NPCS.indexOf(npc));
  const npcPos = `background-position:${-(npcIdx % 13) * 32}px ${-Math.floor(npcIdx / 13) * 42}px`;
  const wantPoke = getPokemonByIndex(o.want.species);
  const givePoke = getPokemonByIndex(o.give.species);
  if (!wantPoke || !givePoke) return '';
  const traded = !!o.traded;
  const count = eligible(o).length;

  // 需求连成一句话：想要性格 怕寂寞 ，攻击 ≥ 26 的皮卡丘（性格与数值前后带空格）
  const wantParts = [
    o.want.nature ? `性格 ${getNature(o.want.nature).cn} ` : '',
    o.want.iv ? `${IV_LABELS[o.want.iv.stat]} ≥ ${o.want.iv.min} ` : '',
  ].filter(Boolean);
  const wantText = '想要' + (wantParts.length ? wantParts.join('，') + '的' : '') + wantPoke.name;

  const giveIcon = givePoke.icon
    ? `<img class="trade-give-img" data-give-icon="${o.id}" alt="" />`
    : '';
  // 每个宝可梦随机起跳相位，避免整排同时跳
  const jumpDelay = '-' + (Math.random() * 1.2).toFixed(2);

  return `
    <div class="trade-row${traded ? ' traded' : ''}">
      <div class="trade-main">
        <div class="npc-sprite" style="${npcPos}"></div>
        <button class="trade-give" style="animation-delay:${jumpDelay}s" data-give-detail="${o.id}" title="查看${givePoke.name}详情">${giveIcon}</button>
        <div class="trade-text">${wantText}</div>
        <button class="trade-btn${traded ? ' done' : count === 0 ? ' locked' : ''}" data-offer="${o.id}"${traded || count === 0 ? ' disabled' : ''}>${traded ? '已交换' : count === 0 ? '未拥有' : '交换'}</button>
      </div>
      <div class="trade-footer">
        <span class="trade-npc-name">${npc.name}</span>
        <span class="trade-give-name">${givePoke.name}${o.give.shiny ? ' <svg class="trade-shiny" viewBox="0 0 1024 1024" width="10" height="10"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>' : ''}</span>
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
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(48,98,48,0.15)" stroke-width="0.5"/>`;
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
    <polygon points="${poly(0.34)}" fill="none" stroke="rgba(48,98,48,0.18)" stroke-width="0.5"/>
    <polygon points="${poly(0.67)}" fill="none" stroke="rgba(48,98,48,0.18)" stroke-width="0.5"/>
    <polygon points="${poly(1)}" fill="none" stroke="rgba(48,98,48,0.18)" stroke-width="0.5"/>
    ${axes}
    <polygon points="${data}" fill="rgba(48,98,48,0.22)" stroke="var(--ui-color)" stroke-width="1.2"/>
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
      <span>${givePoke.name}${o.give.shiny ? ' <svg class="roster-shiny" viewBox="0 0 1024 1024" width="14" height="14" style="flex-shrink:0;vertical-align:-2px;transform:translateY(-2px);"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>' : ''}</span>
    </div>
    <div class="roster-detail-head">
      <div class="poke-img-grid"><img id="tradeGiveDetailImg" class="poke-img-in-grid" alt="" /></div>
      <div style="min-width:0;">
        <div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:3px;">
          ${(givePoke.types || []).map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`).join('')}
        </div>
        <div style="font-size:10px;opacity:0.7;line-height:1.5;">
          <div>性格：${getNature(o.give.nature).cn}</div>
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
  const img = $('tradeGiveDetailImg');
  if (img) tryLoadPokemonImage(img, givePoke, o.give.shiny ? '_shiny' : '');
}

// 选择交出哪只个体（复用悬赏提交列表样式）
function renderSelect(content, offerId) {
  const o = (gameData.trades?.offers || []).find(x => x.id === offerId);
  if (!o) { _tradeMode = null; renderTrade(); return; }
  const wantPoke = getPokemonByIndex(o.want.species);
  const matches = eligible(o);
  const rows = matches.length === 0
    ? '<div class="trade-empty">没有符合条件的宝可梦</div>'
    : matches.map(p => {
        const ivStat = o.want.iv ? o.want.iv.stat : null;
        const ivsText = p.ivs ? IV_KEYS.map(k => {
          const v = p.ivs[k] || 0;
          return k === ivStat ? `<b class="roster-iv-hl">${v}</b>` : String(v);
        }).join('/') : '';
        return `
        <div class="pokedex-entry roster-row bounty-trade-row">
          <span class="roster-icon"><img class="roster-icon-img" data-trade-icon="${p.id}" alt="" /></span>
          <span class="pokedex-star">${p.shiny ? '★' : ''}</span>
          <span class="roster-ivs">${ivsText}</span>
          <span class="roster-nature">${getNature(p.nature).cn}</span>
          <span class="bounty-trade-btn-col"><button class="bounty-trade-btn" data-trade-submit="${p.id}">交换</button></span>
        </div>`;
      }).join('');

  content.innerHTML = `
    <div class="bounty-trade-list">
      <div class="bounty-trade-head">
        <span data-trade-back class="bounty-trade-back"><svg viewBox="0 0 1024 1024" width="14" height="14"><use xlink:href="./icons/sprites.svg#icon-back"/></svg></span>
        <span>提交 ${wantPoke ? wantPoke.name : ''}</span>
      </div>
      <div class="pokedex-header roster-header">
        <span class="roster-icon"></span>
        <span class="pokedex-star"></span>
        <span class="roster-ivs">个体值</span>
        <span class="roster-nature">性格</span>
        <span class="bounty-trade-btn-col">交换</span>
      </div>
      ${rows}
    </div>`;

  // 加载个体图标
  content.querySelectorAll('[data-trade-icon]').forEach(el => {
    const p = (gameData.roster || []).find(r => r.id === el.dataset.tradeIcon);
    const poke = p && getPokemonByIndex(String(p.species));
    if (poke?.icon) tryLoadImage(el, poke.icon);
  });
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
    onConfirm: () => {
      const arr = gameData.roster || [];
      const ri = arr.findIndex(r => r.id === rid);
      if (ri >= 0) arr.splice(ri, 1);
      const entry = addRosterEntry({ species: o.give.species, shiny: o.give.shiny, source: 'trade' });
      if (entry) { entry.ivs = o.give.ivs; entry.nature = o.give.nature; setLastObtainedEntryId(entry.id); }
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
        gameData.stats.totalShinyCaught = (gameData.stats.totalShinyCaught || 0) + 1;
      }
      gameData.stats.totalCatches = (gameData.stats.totalCatches || 0) + 1;
      gameData.stats.totalTrades = (gameData.stats.totalTrades || 0) + 1;
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
        gave: (getPokemonByIndex(String(p.species)) || {}).name || '', // 用哪只换来的
        score: computeObtainScore({ pokemon: givePoke, source: 'trade', shiny: o.give.shiny, charmBuff: false, honeyBuff: false, balls: {}, finalRate: 1 }),
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
        isNew,
        wasOwned,
        onYes: () => {
          // 先刷新交换列表（该 offer 已标记交换），再跳转仓库中该个体的详情
          renderTrade();
          const tv = $('tradeView');
          if (tv) tv.scrollTop = _tradeListScroll;
          import('./roster.js').then(m => m.showRosterDetailById(entry.id, 'tradeView'));
        },
        onClose: () => {
          renderTrade();
          const tv = $('tradeView');
          if (tv) tv.scrollTop = _tradeListScroll; // 回到列表，恢复位置
        },
      });
    },
    onCancel: () => { _goodbyeAnim = false; },
  });
}

// ---------- 事件绑定 ----------
// 后台新增宝可梦（捕获/孵化/交换）时，若停留在列表页则局部刷新交换按钮的可用状态
function refreshTradeButtons() {
  if (_tradeMode != null || _tradeDetail != null) return;
  const tv = $('tradeView');
  if (!tv || tv.style.display !== 'flex') return;
  const content = $('tradeContent');
  if (!content) return;
  (gameData.trades?.offers || []).forEach(o => {
    const btn = content.querySelector(`[data-offer="${o.id}"]`);
    if (!btn) return;
    const traded = !!o.traded;
    const count = eligible(o).length;
    btn.className = `trade-btn${traded ? ' done' : count === 0 ? ' locked' : ''}`;
    btn.disabled = traded || count === 0;
    btn.textContent = traded ? '已交换' : count === 0 ? '未拥有' : '交换';
  });
}
window.addEventListener('roster-changed', refreshTradeButtons);

document.addEventListener('click', e => {
  const content = $('tradeContent');
  if (!content || $('tradeView').style.display !== 'flex') return;

  const offerBtn = e.target.closest('[data-offer]');
  if (offerBtn && !offerBtn.disabled) {
    const tv = $('tradeView');
    if (tv) { _tradeListScroll = tv.scrollTop; tv.scrollTop = 0; } // 记住列表位置，子页面从顶部开始
    pauseTradeRefresh(); // 进入选择子页面：冻结刷新倒计时
    _tradeMode = offerBtn.dataset.offer;
    renderTrade();
    return;
  }
  const submitBtn = e.target.closest('[data-trade-submit]');
  if (submitBtn) {
    doTrade(_tradeMode, submitBtn.dataset.tradeSubmit);
    return;
  }
  const giveBtn = e.target.closest('[data-give-detail]');
  if (giveBtn) {
    const tv = $('tradeView');
    if (tv) { _tradeListScroll = tv.scrollTop; tv.scrollTop = 0; } // 记住列表位置，子页面从顶部开始
    _tradeDetail = giveBtn.dataset.giveDetail;
    renderTrade();
    return;
  }
  if (e.target.closest('[data-trade-back]')) {
    _tradeMode = null;
    resumeTradeRefresh(); // 离开选择子页面：恢复刷新倒计时
    renderTrade();
    const tv = $('tradeView');
    if (tv) tv.scrollTop = _tradeListScroll; // 恢复列表位置
  }
});
