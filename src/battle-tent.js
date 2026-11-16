// ===== 对战帐篷（游戏厅二楼 4 号机）=====
// 下注 → 随机 3 只租借 → 手动出招/换人 → 最多 5 层；赢了继续或收手拿游戏币，输了归零。
// 玩家不选招式，靠性格/属性/外观和战后替换宝可梦做判断。
import {
  TENT_DEX_GATE, TENT_TEAM_SIZE, TENT_FLOOR_LEVELS, TENT_PAYOUT_MULT,
  TENT_FLOOR_BST, TENT_LEGEND_CHANCE, TENT_SHINY_RATE, TENT_SQUARE_SHINY_RATE,
  TENT_VARIANT_RATE, TENT_SURRENDER_REFUND,
  TENT_RECORD_MAX,
} from './config.js';
import {
  gameData, allPokemon, getPokemonByIndex, saveGame, addSystemLog, dexUnlocked,
  formatNum, POKEMON_NATURES, isPowerForm, popNav, pushNav, randInt, rollGender,
} from './state.js';
import { $, showView, getCurrentView, showConfirmBar, tryLoadPokemonIcon, tryLoadPokemonImage, viewportToLogic } from './ui.js';
import { createMon, natureProfileOf } from './battle-core.js';
import { chooseMoves } from './moves.js';
import { TYPE_COLORS, typeIconColor } from './items.js';
import { pokemonSourceBadge } from './badges.js';
import { startCustomBattle, clearBattleTier } from './battle-view.js';
import { BETS, renderBetAreaCommon, showCasinoHistoryView } from './casino.js';
import { showRulesPanel } from './rules-panel.js';
import { createRainbowSprite } from './rainbow-fx.js';

const VIEW = 'battleTentView';
const DRAW_VERSION = 2; // 抽取池按家族聚类后，旧一轮的随机队伍作废
const BOX = 'battleTentContent';
const NATURE_CN = new Map(POKEMON_NATURES);
const PROFILE_NAMES = { aggressive: '强攻', special: '炮台', speed: '高速', tank: '耐久', balanced: '均衡' };
const DAMAGE_KINDS = new Set(['damage', 'explode', 'multihit', 'fixed', 'drain', 'recoil', 'finalGambit', 'counter', 'mirrorCoat']);

let _data = null;
let _learnset = null;
let _loading = null;
let _run = null;
let _step = 'lobby';
let _bet = BETS[0];
let _result = null;
let _detail = null;
let _detailList = [];
let _busy = false;
let _lastStep = null;
let _lastResult = null;
let _tentDragAt = 0;

const hasSpecial = (p) => !!(p && (p.shiny || p.squareShiny || p.variant));
const coin = () => gameData.items['casinoCoin'] || 0;
const natureName = (key) => NATURE_CN.get(key) || key;
const famOf = (p) => String(p.index).split('-')[0];
const payoutFor = (floors, bet) => Math.floor(bet * (TENT_PAYOUT_MULT[Math.min(5, Math.max(0, floors))] || 0));

// ---------- 数据 ----------
function ensureData() {
  if (_data && _learnset) return Promise.resolve();
  if (_loading) return _loading;
  _loading = Promise.all([
    fetch('./pokemon-data/moves.json').then((r) => { if (!r.ok) throw new Error('moves'); return r.json(); }),
    fetch('./pokemon-data/learnset.json').then((r) => { if (!r.ok) throw new Error('learnset'); return r.json(); }),
  ]).then(([m, l]) => { _data = m; _learnset = l; }).catch((e) => { _loading = null; throw e; });
  return _loading;
}

function ensureTent() {
  const gd = gameData;
  if (!gd.battleTent || typeof gd.battleTent !== 'object') {
    gd.battleTent = { records: [], run: null };
  }
  const t = gd.battleTent;
  if (!Array.isArray(t.records)) t.records = [];
  t.records = t.records.slice(0, TENT_RECORD_MAX);
  if (t.hall) delete t.hall;
  return t;
}

function dexCount() {
  if (!gameData?.pokedex) return 0;
  let n = 0;
  for (const k in gameData.pokedex) if (dexUnlocked(k)) n++;
  return n;
}

// ---------- 外观 ----------
function rollAppearance() {
  const sr = Math.random();
  let shiny = false;
  let squareShiny = false;
  if (sr < TENT_SQUARE_SHINY_RATE) { shiny = true; squareShiny = true; }
  else if (sr < TENT_SHINY_RATE + TENT_SQUARE_SHINY_RATE) { shiny = true; }
  const vr = Math.random();
  let variant = null;
  if (vr < TENT_VARIANT_RATE) variant = 'rgb';
  else if (vr < TENT_VARIANT_RATE * 2) variant = 'polluted';
  else if (vr < TENT_VARIANT_RATE * 3) variant = 'rainbow';
  return { shiny, squareShiny, variant };
}

// ---------- 随机队伍 ----------
let _poolCache = new Map();
// 和野池同一套家族口径：形态编号按基础编号合并，先抽家族再抽具体形态
const familyKey = (pd) => famOf(pd);

function buildPool(minBst, maxBst) {
  const key = `${minBst}-${maxBst}`;
  if (_poolCache.has(key)) return _poolCache.get(key);
  const byFam = new Map();
  for (const p of allPokemon) {
    if (!p || !Array.isArray(p.stats) || p.stats.length !== 6 || isPowerForm(p)) continue;
    const bst = p.stats.reduce((a, b) => a + (+b || 0), 0);
    if (bst < minBst || bst > maxBst) continue;
    const fam = familyKey(p);
    if (!byFam.has(fam)) byFam.set(fam, []);
    byFam.get(fam).push({ p, bst });
  }
  const out = [];
  for (const [fam, forms] of byFam) {
    out.push({ fam, forms, legend: forms.some((f) => !!f.p.legend) });
  }
  _poolCache.set(key, out);
  return out;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function isDamagingMove(id) {
  const ef = _data.moves[id]?.effect;
  return !!ef && DAMAGE_KINDS.has(ef.kind);
}

function ensureDamageMove(moves, pd, level) {
  if (moves.some(isDamagingMove)) return moves;
  const build = (shuffleMoves) => chooseMoves(_learnset[pd.index] || {}, level, _data, {
    types: pd.types || [], includeTm: true, allowEgg: true, shuffle: shuffleMoves,
  });
  const fallback = build(false);
  let dmg = fallback.find((id) => isDamagingMove(id) && !moves.includes(id));
  if (dmg == null) {
    const cands = [];
    for (const [l, id] of (_learnset[pd.index]?.lv || [])) if (l <= level) cands.push(id);
    for (const id of (_learnset[pd.index]?.egg || [])) cands.push(id);
    for (const id of (_learnset[pd.index]?.tm || [])) cands.push(id);
    dmg = cands.find((id) => isDamagingMove(id) && !moves.includes(id));
  }
  if (dmg == null) return null;
  moves[0] = dmg;
  return moves;
}

function makePlain(pd, level) {
  let moves = chooseMoves(_learnset[pd.index] || {}, level, _data, {
    types: pd.types || [], includeTm: true, allowEgg: true, shuffle: true,
  });
  if (!moves || moves.length < 2) return null;
  moves = ensureDamageMove(moves.slice(), pd, level);
  if (!moves) return null;
  const ivs = {};
  for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) ivs[k] = randInt(0, 31);
  const nature = POKEMON_NATURES[randInt(0, POKEMON_NATURES.length - 1)][0];
  return { species: String(pd.index), level, ivs, nature, moves: moves.map(Number), ...rollAppearance() };
}

function legendRowsFor(pool) {
  const inPool = pool.filter((r) => r.legend);
  if (inPool.length) return inPool;
  const byFam = new Map();
  for (const p of allPokemon) {
    if (!p || !p.legend || !Array.isArray(p.stats) || p.stats.length !== 6 || isPowerForm(p)) continue;
    const fam = familyKey(p);
    if (!byFam.has(fam)) byFam.set(fam, []);
    byFam.get(fam).push({ p, bst: p.stats.reduce((a, b) => a + (+b || 0), 0) });
  }
  return [...byFam.entries()].map(([fam, forms]) => ({ fam, forms, legend: true }));
}

function pickForm(row, level, blockedTypes, legendOnly = false) {
  const forms = shuffle((row.forms || []).slice());
  for (const f of forms) {
    const pd = f.p;
    if (legendOnly && !pd.legend) continue;
    if (blockedTypes && (pd.types || []).some((t) => blockedTypes.has(t))) continue;
    const plain = makePlain(pd, level);
    if (plain) return { pd, plain };
  }
  return null;
}

function pickTeam(pool, level, legendChance, guaranteedLegend) {
  const out = [];
  const fams = new Set();
  const types = new Set();
  const isLegendPicked = () => out.some((x) => getPokemonByIndex(x.species)?.legend);
  const add = (row, blockedTypes, legendOnly = false) => {
    if (out.length >= TENT_TEAM_SIZE || fams.has(row.fam)) return false;
    if (row.legend && isLegendPicked()) return false;
    const picked = pickForm(row, level, blockedTypes, legendOnly);
    if (!picked) return false;
    out.push(picked.plain);
    fams.add(row.fam);
    for (const t of (picked.pd.types || [])) types.add(t);
    return true;
  };
  const wantLegend = guaranteedLegend || Math.random() < legendChance;
  if (wantLegend) {
    const rows = legendRowsFor(pool);
    if (rows.length) add(rows[randInt(0, rows.length - 1)], null, true);
  }
  const shuffled = shuffle(pool.slice());
  for (const row of shuffled) {
    if (out.length >= TENT_TEAM_SIZE) break;
    // 前 3 只尽量不共享任何属性（不只主属性），避免出现三只飞行副属性这种同质感
    add(row, out.length < TENT_TEAM_SIZE ? types : null);
  }
  if (out.length < TENT_TEAM_SIZE) {
    for (const row of shuffled) {
      if (out.length >= TENT_TEAM_SIZE) break;
      add(row, null);
    }
  }
  if (out.length < TENT_TEAM_SIZE) {
    for (const row of shuffled) {
      if (out.length >= TENT_TEAM_SIZE) break;
      const picked = pickForm(row, level, null);
      if (picked && !out.some((x) => x.species === picked.plain.species)) out.push(picked.plain);
    }
  }
  return out.slice(0, TENT_TEAM_SIZE);
}

function buildInitialSquad() {
  const pool = buildPool(TENT_FLOOR_BST[0][0], TENT_FLOOR_BST[0][1]);
  const plains = pickTeam(pool, TENT_FLOOR_LEVELS[0], TENT_LEGEND_CHANCE[0], false);
  return plains.map((p) => buildMon(p, 1)).filter(Boolean);
}

function buildOpponents() {
  const teams = [];
  for (let i = 0; i < TENT_FLOOR_LEVELS.length; i++) {
    const pool = buildPool(TENT_FLOOR_BST[i][0], TENT_FLOOR_BST[i][1]);
    teams.push(pickTeam(pool, TENT_FLOOR_LEVELS[i], TENT_LEGEND_CHANCE[i], i === TENT_FLOOR_LEVELS.length - 1));
  }
  return teams;
}

// ---------- 个体 ----------
function buildMon(plain, hpPct = 1) {
  if (!plain || !_data) return null;
  const pd = getPokemonByIndex(plain.species);
  if (!pd) return null;
  const level = plain.level || TENT_FLOOR_LEVELS[0];
  const moves = Array.isArray(plain.moves) ? plain.moves.filter((id) => _data.moves[id]) : [];
  if (!moves.length) return null;
  const mon = createMon(pd, level, plain.ivs, plain.nature, moves);
  mon.shiny = !!plain.shiny;
  mon.squareShiny = !!plain.squareShiny;
  mon.variant = plain.variant || null;
  mon.gender = rollGender(plain.species);
  mon.tentEndure = hasSpecial(plain);
  mon.tentEndureUsed = false;
  mon.pp = moves.map((id) => _data.moves[id]?.pp ?? null);
  mon.hp = Math.max(0, Math.min(mon.maxHp, Math.round(mon.maxHp * Math.max(0, Math.min(1, hpPct)))));
  return { plain: { ...plain, level, moves: moves.slice() }, pd, mon };
}

function entryFor(member) {
  const p = member.plain;
  return {
    id: `tent_${p.species}_${member.mon.uid}`,
    species: p.species,
    level: p.level,
    ivs: p.ivs,
    nature: p.nature,
    moves: p.moves.slice(),
    shiny: !!p.shiny,
    squareShiny: !!p.squareShiny,
    variant: p.variant || null,
    gender: member.mon.gender,
    rental: true,
  };
}

function enemyTeam(team) {
  return team.map((plain) => {
    const pd = getPokemonByIndex(plain.species);
    if (!pd) return null;
    const moves = (plain.moves || []).filter((id) => _data.moves[id]);
    const mon = createMon(pd, plain.level, plain.ivs, plain.nature, moves);
    mon.shiny = !!plain.shiny;
    mon.squareShiny = !!plain.squareShiny;
    mon.variant = plain.variant || null;
    mon.gender = rollGender(plain.species);
    mon.tentEndure = hasSpecial(plain);
    mon.tentEndureUsed = false;
    mon.pp = moves.map((id) => _data.moves[id]?.pp ?? null);
    return { pd, mon };
  }).filter(Boolean);
}

// ---------- 存读档 ----------
function persistRun() {
  const t = ensureTent();
  if (!_run) {
    t.run = null;
    saveGame();
    return;
  }
  t.run = {
    v: DRAW_VERSION,
    bet: _run.bet,
    floors: _run.floors,
    phase: _run.phase || 'start',
    swapDone: !!_run.swapDone,
    opponents: _run.opponents,
    squad: _run.squad.map((m) => ({ plain: m.plain })),
  };
  saveGame();
}

function hydrateRun(saved) {
  if (!saved || Number(saved.v) !== DRAW_VERSION) return null;
  if (!Array.isArray(saved.squad) || !Array.isArray(saved.opponents)) return null;
  const floors = Number(saved.floors);
  const bet = Number(saved.bet);
  if (!(floors >= 0 && floors < TENT_FLOOR_LEVELS.length)) return null;
  if (!BETS.includes(bet)) return null;
  if (saved.opponents.length !== TENT_FLOOR_LEVELS.length) return null;
  if (saved.opponents.some((t) => !Array.isArray(t) || t.length !== TENT_TEAM_SIZE)) return null;
  const level = TENT_FLOOR_LEVELS[floors];
  const squad = saved.squad.map((s) => {
    if (!s || !s.plain) return null;
    return buildMon({ ...s.plain, level }, 1);
  }).filter(Boolean);
  if (squad.length !== TENT_TEAM_SIZE) return null;
  return {
    bet,
    floors,
    phase: saved.phase || 'start',
    swapDone: !!saved.swapDone,
    squad,
    opponents: saved.opponents,
  };
}

// ---------- 入口 ----------
export function showBattleTentView() {
  const dex = dexCount();
  if (dex < TENT_DEX_GATE) {
    // 和老虎机一样：条件不足时只弹提示，不进入页面
    showConfirmBar(`图鉴还差 ${TENT_DEX_GATE - dex} 种（${dex}/${TENT_DEX_GATE}），集齐后开放对战帐篷`, null, null, { singleButton: true, overlay: true });
    return;
  }
  pushNav(VIEW);
  showView(VIEW);
  const box = $(BOX);
  if (box) box.innerHTML = '<div class="tent-loading">正在准备…</div>';
  ensureData().then(() => {
    const t = ensureTent();
    _run = hydrateRun(t.run);
    if (!_run && t.run) {
      t.run = null;
      saveGame();
    }
    _result = null;
    _detail = null;
    _detailList = [];
    _lastStep = null;
    if (!_run) _step = 'lobby';
    else if (_run.phase === 'decision') _step = 'decision';
    else if (_run.phase === 'swap') _step = 'swap';
    else _step = 'vs';
    render();
  }).catch(() => {
    if (box) box.innerHTML = '<div class="tent-loading">数据加载失败，请重试</div>';
  });
}

// ---------- 页面 ----------
function render() {
  const box = $(BOX);
  if (!box) return;
  if ((_step === 'vs' || _step === 'decision' || _step === 'swap') && !_run) _step = 'lobby';
  if (_step === 'result' && !_result) _step = 'lobby';
  _detailList = [];
  const page = pageForStep();
  // 下注页直接塞进 tent-app，和电球翻牌一样让下注区自己撑满；其他页面才套滚动层
  const bodyHtml = _step === 'lobby' ? page.body
    : (_step === 'result' || _step === 'decision') ? `<div class="tent-result-wrap">${page.body}</div>`
      : `<div class="tent-scroll">${page.body}</div>`;
  box.innerHTML = `<div class="tent-app">`
    + bodyHtml
    + (page.foot ? `<div class="tent-dock">${page.foot}</div>` : '')
    + (_detail ? detailModalHtml() : '')
    + `</div>`;
  bind(box);
  loadIcons(box);
  loadDetailSprite(box);
  const scroll = box.querySelector('.tent-scroll');
  if (scroll && _lastStep !== _step) scroll.scrollTop = 0;
  _lastStep = _step;
}

function pageForStep() {
  if (_step === 'lobby') return lobbyPage();
  if (_step === 'vs') return vsPage();
  if (_step === 'decision') return decisionPage();
  if (_step === 'swap') return swapPage();
  if (_step === 'result') return resultPage();
  return lobbyPage();
}

function lobbyPage() {
  const balance = coin();
  const holder = { bet: _bet, lastResult: _lastResult };
  const startText = balance <= 0 ? '请在柜台兑换游戏币再来' : '开始挑战';
  const html = renderBetAreaCommon(balance, holder, 'tentStart', startText, { rulesId: 'tentRules' });
  _bet = holder.bet;
  return { body: html, foot: '' };
}

function vsPage() {
  const opp = _run.opponents[_run.floors];
  const level = TENT_FLOOR_LEVELS[_run.floors];
  const body = `
    <div class="rec-header">第 ${_run.floors + 1} 层 · Lv${level}</div>
    <div class="tent-vs-label">对手 <span class="tent-vs-hint">出场顺序随机</span></div>
    <div class="tent-vs-team">${opp.map((p) => teamCard(p)).join('')}</div>
    <div class="tent-vs"><span class="tent-vs-line"></span><span class="tent-vs-text">VS</span><span class="tent-vs-line"></span></div>
    <div class="tent-vs-label">我方 <span class="tent-vs-hint">拖动调整出场顺序</span></div>
    <div class="tent-vs-team">${_run.squad.map((m, i) => teamCard(m.plain, m, { orderIdx: i })).join('')}</div>`;
  const foot = _run.floors === 0
    ? '<button class="tent-dock-btn" id="tentSurrender">弃权</button><button class="tent-dock-btn main" id="tentFight">开始</button>'
    : `<button class="tent-dock-btn main" id="tentFight">开始第 ${_run.floors + 1} 层</button>`;
  return { body, foot };
}

function decisionPage() {
  const floors = _run.floors;
  const payout = payoutFor(floors, _run.bet);
  const nextMult = TENT_PAYOUT_MULT[floors + 1] || 0;
  const body = `
    <div class="tent-result tent-victory">
      <div class="tent-result-kicker">第 ${floors} 层胜利</div>
      <div class="tent-result-title">收手还是继续？</div>
      <div class="tent-result-payout"><img src="./items/goods/coin.png" alt=""><b>${formatNum(payout)}</b></div>
      <div class="tent-result-net">当前可提现</div>
      <div class="tent-victory-next">继续下一层 · ${nextMult}×</div>
    </div>`;
  const foot = `<button class="tent-dock-btn" id="tentCash">收手</button><button class="tent-dock-btn main" id="tentContinue">继续</button>`;
  return { body, foot };
}

function swapPage() {
  const defeated = _run.opponents[_run.floors - 1] || [];
  const nextLevel = TENT_FLOOR_LEVELS[_run.floors];
  const canSwap = !_run.swapDone;
  const body = `
    <div class="rec-header">第 ${_run.floors} 层胜利 · 调整阵容</div>
    <div class="tent-side-label">败者队伍 <span class="tent-vs-hint">${canSwap ? '可拖动一只宝可梦替换我方宝可梦' : '本层已替换'}</span></div>
    <div class="tent-vs-team">${defeated.map((p, i) => teamCard(p, null, canSwap ? { swapSrc: i } : {})).join('')}</div>
    <div class="tent-side-label blue">我方队伍 <span class="tent-vs-hint">拖拽调整出场顺序</span></div>
    <div class="tent-vs-team">${_run.squad.map((m, i) => teamCard({ ...m.plain, level: nextLevel }, m, canSwap ? { orderIdx: i, swapDst: i } : { orderIdx: i })).join('')}</div>`;
  const foot = `<button class="tent-dock-btn main" id="tentAdjustDone">调整完成，开始第 ${_run.floors + 1} 层</button>`;
  return { body, foot };
}

function resultPage() {
  const r = _result;
  const title = r.result === 'clear' ? '五层通关' : r.result === 'cash' ? '收手成功' : '挑战结束';
  const kicker = r.result === 'lose' ? `止步第 ${r.floors + 1} 层` : `${r.floors} 层`;
  const netCls = r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : '';
  const body = `
    <div class="tent-result">
      <div class="tent-result-kicker">${kicker}</div>
      <div class="tent-result-title">${title}</div>
      <div class="tent-result-payout"><img src="./items/goods/coin.png" alt=""><b>${formatNum(r.payout)}</b></div>
      <div class="tent-result-net ${netCls}">净收益 ${r.net > 0 ? '+' : ''}${formatNum(r.net)}</div>
      <div class="tent-result-team">${r.squad.map((p) => `<img data-poke="${p.species}" alt="">`).join('')}</div>
    </div>`;
  const foot = '<button class="tent-dock-btn" id="tentLobby">返回</button><button class="tent-dock-btn main" id="tentAgain">再来一轮</button>';
  return { body, foot };
}

// ---------- 组件 ----------
function badgeHtml(plain) {
  const svg = pokemonSourceBadge(plain);
  return svg ? `<span class="tent-badge" data-tip="特殊外观：每场可挺住一次">${svg}</span>` : '';
}

function teamCard(plain, member = null, opts = {}) {
  const pd = getPokemonByIndex(plain.species);
  if (!pd) return '';
  const detailIdx = _detailList.length;
  _detailList.push({ plain, member });
  const keys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const ivSum = keys.reduce((n, k) => n + (Number(plain.ivs?.[k]) || 0), 0);
  const pct = Math.round((ivSum / 186) * 100);
  const perfect = keys.every((k) => Number(plain.ivs?.[k]) === 31);
  const ring = pd.legend ? ' legend-ring' : '';
  const frame = plain.variant === 'rgb' ? 'var-rgb' + ring
    : plain.variant === 'polluted' ? 'var-polluted' + ring
      : plain.variant === 'rainbow' ? 'var-rainbow' + ring
        : pd.legend ? 'rar-legend' : '';
  const detail = opts.detail === false ? '' : ` data-detail="${detailIdx}"`;
  const swapSrc = opts.swapSrc != null ? ` data-swap-src="${opts.swapSrc}"` : '';
  const swapDst = opts.swapDst != null ? ` data-swap-dst="${opts.swapDst}"` : '';
  const order = opts.orderIdx != null ? ` data-order-idx="${opts.orderIdx}"` : '';
  const dragCls = (opts.orderIdx != null || opts.swapSrc != null) ? ' tent-vs-drag' : '';
  return `<div class="pokedex-entry roster-row roster-box-cell tent-vs-box ${frame}${dragCls}"${detail}${swapSrc}${swapDst}${order}>
    <div class="box-iv"><div class="box-iv-fill${perfect ? ' perfect' : ''}" style="width:${pct}%"></div></div>
    <div class="box-icon-wrap"><img class="roster-icon-img" data-poke="${plain.species}" alt="" draggable="false"><span class="box-badges">${pokemonSourceBadge(plain)}</span></div>
    <div class="box-foot tent-vs-foot"><span class="tent-vs-name">${pd.name}</span></div>
  </div>`;
}

function ivRadarSvg(ivs) {
  const keys = [['hp', 'HP'], ['atk', '攻击'], ['def', '防御'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速度']];
  const vOf = (k) => Math.max(0, Math.min(31, Number(ivs?.[k]) || 0));
  const cx = 50, cy = 50, r = 34;
  const pt = (i, ratio) => {
    const a = (Math.PI / 180) * (-90 + 60 * i);
    return [cx + r * ratio * Math.cos(a), cy + r * ratio * Math.sin(a)];
  };
  const poly = (ratio) => keys.map((_, i) => pt(i, ratio).map((n) => n.toFixed(1)).join(',')).join(' ');
  const data = keys.map(([k], i) => pt(i, vOf(k) / 31).map((n) => n.toFixed(1)).join(',')).join(' ');
  const axes = keys.map((_, i) => {
    const [x, y] = pt(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(var(--ui-color-rgb),0.15)" stroke-width="0.5"/>`;
  }).join('');
  const labels = keys.map(([, label], i) => {
    const [x, y] = pt(i, (i === 0 || i === 3) ? 1.16 : 1.32);
    return `<text x="${x.toFixed(1)}" y="${(y + 2).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="var(--ui-color)">${label}</text>`;
  }).join('');
  const dots = keys.map(([k], i) => {
    const [x, y] = pt(i, vOf(k) / 31);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.7" fill="var(--ui-color)"/>`;
  }).join('');
  return `<svg viewBox="0 6 100 88" class="roster-hex">
    <polygon points="${poly(0.34)}" fill="none" stroke="rgba(var(--ui-color-rgb),0.18)" stroke-width="0.5"/>
    <polygon points="${poly(0.67)}" fill="none" stroke="rgba(var(--ui-color-rgb),0.18)" stroke-width="0.5"/>
    <polygon points="${poly(1)}" fill="none" stroke="rgba(var(--ui-color-rgb),0.18)" stroke-width="0.5"/>
    ${axes}
    <polygon points="${data}" fill="rgba(var(--ui-color-rgb),0.22)" stroke="var(--ui-color)" stroke-width="1.2"/>
    ${dots}
    ${labels}
  </svg>`;
}

// 招式类别（物理/特殊/变化）：与配招页同款 mask 图标
function tentMoveCat(mv) {
  const ef = mv.effect || {};
  if (['damage', 'explode', 'multihit', 'drain', 'recoil', 'fixed', 'finalGambit', 'counter', 'mirrorCoat'].includes(ef.kind)) {
    return ef.kind === 'mirrorCoat' || ef.cat === 'spec' ? 'spec' : 'phys';
  }
  return 'status';
}
const TENT_CAT_CN = { phys: '物理', spec: '特殊', status: '变化' };

function detailModalHtml() {
  const { plain, member } = _detail;
  const pd = getPokemonByIndex(plain.species);
  if (!pd) return '';
  const prof = natureProfileOf(plain.nature);
  const ivs = plain.ivs || {};
  const ivKeys = [['hp', 'HP'], ['atk', '攻击'], ['def', '防御'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速度']];
  const ivBars = ivKeys.map(([k, label]) => {
    const v = Math.max(0, Math.min(31, Number(ivs[k]) || 0));
    return `<div class="roster-iv-item"><span>${label}</span><div class="roster-iv-bar"><div class="roster-iv-fill" style="width:${(v / 31 * 100).toFixed(0)}%"></div></div><span>${v}</span></div>`;
  }).join('');
  const moves = (plain.moves || []).map((id, i) => {
    const mv = _data.moves[id];
    if (!mv) return '';
    const pp = member && Array.isArray(member.mon.pp) ? member.mon.pp[i] : mv.pp;
    const cat = tentMoveCat(mv);
    const catName = TENT_CAT_CN[cat];
    const typeIcon = `<span class="b-move-type" style="background:${TYPE_COLORS[mv.type] || '#888'};color:${typeIconColor(mv.type)}"><svg class="b-move-type-icon"><use xlink:href="#icon-type-${mv.type}"></use></svg></span>`;
    return `<div class="tent-detail-move">
      ${typeIcon}
      <div class="tent-move-main">
        <div class="tent-move-name">${mv.name}</div>
        <div class="tent-move-meta"><span class="move-cat-icon cat-${cat}" data-tip="${catName}" aria-label="${catName}"></span><b>${cat === 'status' ? '—' : (mv.power || '—')}</b><em>PP ${pp == null ? '∞' : pp}</em></div>
      </div>
    </div>`;
  }).join('');
  return `<div class="cf-modal" id="tentModal">
    <div class="cf-modal-panel tent-detail-panel" id="tentModalPanel">
      <div class="cf-modal-head"><span>${pd.name}</span><button type="button" class="cf-modal-close" id="tentModalClose">×</button></div>
      <div class="cf-modal-body">
        <div class="tent-detail-head">
          <div class="tent-detail-pic"><img class="tent-detail-icon" id="tentDetailImg" alt=""></div>
          <div class="tent-detail-main">
            <div class="tent-detail-line">
              <span class="tent-detail-lv">Lv${plain.level}</span>
              ${badgeHtml(plain)}
              <span class="tent-detail-types">${(pd.types || []).map((t) => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`).join('')}</span>
            </div>
            <div class="tent-detail-sub">性格：${natureName(plain.nature)} · ${PROFILE_NAMES[prof] || '均衡'}</div>
          </div>
        </div>
        <div class="tent-detail-title">个体值</div>
        <div class="roster-iv-flex">
          ${ivRadarSvg(ivs)}
          <div class="roster-iv-bars">${ivBars}</div>
        </div>
        <div class="tent-detail-title">招式</div>
        <div class="tent-detail-moves">${moves}</div>
        ${hasSpecial(plain) ? '<div class="tent-detail-endure">特殊外观：每场可挺住一次致死伤害</div>' : ''}
      </div>
    </div>
  </div>`;
}

function resultText(kind) {
  return kind === 'cash' ? '收手' : kind === 'clear' ? '通关' : '出局';
}

function bind(box) {
  box.querySelectorAll('.casino-bet-tick').forEach((el) => el.addEventListener('click', () => {
    if (el.classList.contains('off')) return;
    _bet = BETS[+el.dataset.i];
    render();
  }));
  box.querySelector('#tentStart')?.addEventListener('click', beginRun);
  box.querySelector('#tentRules')?.addEventListener('click', showTentRules);
  box.querySelector('#casinoHistoryBtn')?.addEventListener('click', () => showCasinoHistoryView('tent'));
  box.querySelector('#tentSurrender')?.addEventListener('click', surrender);
  box.querySelector('#tentFight')?.addEventListener('click', startBattle);
  box.querySelector('#tentCash')?.addEventListener('click', () => finishRun('cash'));
  box.querySelector('#tentContinue')?.addEventListener('click', () => {
    if (!_run) return;
    _run.phase = 'swap';
    persistRun();
    _step = 'swap';
    render();
  });
  box.querySelector('#tentAdjustDone')?.addEventListener('click', startBattle);
  box.querySelector('#tentAgain')?.addEventListener('click', () => {
    if (_result) _bet = _result.bet;
    beginRun();
  });
  box.querySelector('#tentLobby')?.addEventListener('click', () => {
    _step = 'lobby';
    _result = null;
    _detail = null;
    render();
  });
  box.querySelectorAll('[data-detail]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Date.now() - _tentDragAt < 250) return;
    const d = _detailList[Number(el.dataset.detail)];
    if (d) { _detail = d; render(); }
  }));
  box.querySelector('#tentModalClose')?.addEventListener('click', () => { _detail = null; render(); });
  box.querySelector('#tentModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tentModal') { _detail = null; render(); }
  });
  box.querySelector('#tentModalPanel')?.addEventListener('click', (e) => e.stopPropagation());
  bindSwapDrag(box);
  bindTeamOrderDrag(box);
}

// 替换页：把败者队伍的格子拖到我方格子上
function bindSwapDrag(box) {
  const srcs = [...box.querySelectorAll('[data-swap-src]')];
  const dsts = [...box.querySelectorAll('[data-swap-dst]')];
  if (!srcs.length || !dsts.length) return;
  let drag = null;
  const clearTargets = () => dsts.forEach((d) => d.classList.remove('drop-target'));
  for (const el of srcs) {
    let suppressClick = false;
    el.addEventListener('click', (e) => {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressClick = false;
    }, true);
    el.addEventListener('pointerdown', (e) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { el, id: e.pointerId, src: Number(el.dataset.swapSrc), dst: null, moved: false, sx: e.clientX, sy: e.clientY, layer: null, ghost: null };
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.el !== el || drag.id !== e.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        const ghost = makeTeamGhost(el);
        if (ghost) { drag.layer = ghost.layer; drag.ghost = ghost.ghost; }
        el.classList.add('dragging');
      }
      e.preventDefault();
      moveTeamGhost(drag, e.clientX, e.clientY);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-swap-dst]');
      clearTargets();
      if (hit && dsts.includes(hit)) {
        hit.classList.add('drop-target');
        drag.dst = Number(hit.dataset.swapDst);
      } else {
        drag.dst = null;
      }
    });
    const end = (e, cancelled) => {
      if (!drag || drag.el !== el || drag.id !== e.pointerId) return;
      const { moved, src, dst, layer } = drag;
      drag = null;
      clearTargets();
      el.classList.remove('dragging');
      layer?.remove();
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!moved || cancelled || dst == null) return;
      _tentDragAt = Date.now();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      askSwap(src, dst);
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
  }
}

function askSwap(srcIdx, dstIdx) {
  if (_run?.swapDone) return;
  const defeated = _run?.opponents?.[_run.floors - 1] || [];
  const incoming = defeated[srcIdx];
  const outgoing = _run?.squad?.[dstIdx]?.plain;
  if (!incoming || !outgoing) return;
  const inPd = getPokemonByIndex(incoming.species);
  const outPd = getPokemonByIndex(outgoing.species);
  showConfirmBar(`用${inPd ? inPd.name : '这只宝可梦'}替换${outPd ? outPd.name : '我方宝可梦'}？`, () => {
    doSwap(srcIdx, dstIdx);
  }, null, { overlay: true });
}

// 出征前拖拽我方格子调整顺序；点按仍然打开详情
function bindTeamOrderDrag(box) {
  const cells = [...box.querySelectorAll('[data-order-idx]')];
  if (cells.length < 2) return;
  let drag = null;
  const clearTargets = () => cells.forEach((c) => c.classList.remove('drop-target'));
  for (const el of cells) {
    let suppressClick = false;
    el.addEventListener('click', (e) => {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressClick = false;
    }, true);
    el.addEventListener('pointerdown', (e) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { el, id: e.pointerId, from: Number(el.dataset.orderIdx), to: Number(el.dataset.orderIdx), moved: false, sx: e.clientX, sy: e.clientY, layer: null, ghost: null };
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.el !== el || drag.id !== e.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        const ghost = makeTeamGhost(el);
        if (ghost) { drag.layer = ghost.layer; drag.ghost = ghost.ghost; }
        el.classList.add('dragging');
      }
      e.preventDefault();
      moveTeamGhost(drag, e.clientX, e.clientY);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-order-idx]');
      clearTargets();
      if (hit && cells.includes(hit) && hit !== el) {
        hit.classList.add('drop-target');
        drag.to = Number(hit.dataset.orderIdx);
      } else {
        drag.to = drag.from;
      }
    });
    const end = (e, cancelled) => {
      if (!drag || drag.el !== el || drag.id !== e.pointerId) return;
      const { moved, from, to, layer } = drag;
      drag = null;
      clearTargets();
      el.classList.remove('dragging');
      layer?.remove();
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!moved || cancelled) return;
      _tentDragAt = Date.now();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (to !== from) reorderSquad(from, to);
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
  }
}

function makeTeamGhost(el) {
  const host = el.closest('.tent-app');
  if (!host) return null;
  const layer = document.createElement('div');
  layer.className = 'tent-drag-layer';
  const ghost = el.cloneNode(true);
  ghost.classList.remove('dragging', 'drop-target', 'sel');
  ghost.removeAttribute('data-detail');
  ghost.removeAttribute('data-swap-src');
  ghost.removeAttribute('data-swap-dst');
  ghost.removeAttribute('data-order-idx');
  ghost.classList.add('tent-vs-ghost');
  const cs = getComputedStyle(el);
  ghost.style.width = cs.width;
  ghost.style.height = cs.height;
  layer.appendChild(ghost);
  host.appendChild(layer);
  return { layer, ghost };
}

function moveTeamGhost(drag, px, py) {
  if (!drag?.ghost || !drag.layer) return;
  // 幽灵的 left/top 是相对层的逻辑像素，指针要先拉回同一套坐标再相减
  const r = drag.layer.getBoundingClientRect();
  const p = viewportToLogic(px, py);
  drag.ghost.style.left = `${p.x - r.left}px`;
  drag.ghost.style.top = `${p.y - r.top}px`;
}

function reorderSquad(from, to) {
  if (!_run) return;
  const list = _run.squad;
  if (!(from >= 0 && from < list.length && to >= 0 && to < list.length) || from === to) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  persistRun();
  render();
}

function showTentRules() {
  showRulesPanel('battleTentContent', '对战帐篷规则', `
    <p>随机租借 3 只，不能挑选；每层手动战斗。</p>
    <p>点「攻击」让宝可梦按性格自动出招；点「宝可梦」换后备上场；打倒对方 3 只过关。</p>
    <p>赢了下注倍率提升，可继续或收手；输了归零。</p>
    <p>每层胜利后可 3 选 1 替换宝可梦；每层开始全队满血。</p>
    <p>特殊外观每场可挺住一次致死伤害。</p>
  `);
}

function loadIcons(box) {
  box.querySelectorAll('img[data-poke]').forEach((img) => {
    const pd = getPokemonByIndex(img.dataset.poke);
    if (pd) tryLoadPokemonIcon(img, pd);
  });
}

function loadDetailSprite(box) {
  if (!_detail) return;
  const img = box.querySelector('#tentDetailImg');
  const pd = getPokemonByIndex(_detail.plain.species);
  if (!img || !pd) return;
  const p = _detail.plain;
  img.classList.remove('fx-variant-rgb', 'fx-variant-polluted');
  if (p.variant === 'rgb') img.classList.add('fx-variant-rgb');
  else if (p.variant === 'polluted') img.classList.add('fx-variant-polluted');
  tryLoadPokemonImage(img, pd, p.shiny ? '_shiny' : '').then(() => {
    const host = img.parentElement;
    if (!host) return;
    host.querySelector('.rainbow-sprite')?.remove();
    img.style.opacity = '';
    if (p.variant === 'rainbow' && img.naturalWidth && img.naturalHeight) {
      host.appendChild(createRainbowSprite(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight));
      img.style.opacity = '0';
    }
  });
}

// ---------- 流程 ----------
function createRun(bet) {
  const squad = buildInitialSquad();
  if (squad.length !== TENT_TEAM_SIZE) return null;
  const opponents = buildOpponents();
  if (opponents.length !== TENT_FLOOR_LEVELS.length) return null;
  if (opponents.some((t) => !Array.isArray(t) || t.length !== TENT_TEAM_SIZE)) return null;
  return { bet, floors: 0, phase: 'start', squad, opponents, swapDone: false };
}

function beginRun() {
  if (_busy) return;
  if (!BETS.includes(_bet)) _bet = BETS[0];
  if (coin() < _bet) {
    showConfirmBar('游戏币不足，先在柜台用糖果兑换。', null, null, { singleButton: true });
    return;
  }
  _busy = true;
  gameData.items.casinoCoin = coin() - _bet;
  const run = createRun(_bet);
  if (!run) {
    gameData.items.casinoCoin = coin() + _bet;
    saveGame();
    _busy = false;
    showConfirmBar('生成队伍失败，下注已退回。', null, null, { singleButton: true });
    return;
  }
  addSystemLog('战斗', `对战帐篷：下注 ${_bet} 游戏币`);
  _run = run;
  _result = null;
  _detail = null;
  _step = 'vs';
  persistRun();
  _busy = false;
  render();
}

function surrender() {
  if (!_run) return;
  const refund = Math.floor(_run.bet * TENT_SURRENDER_REFUND);
  showConfirmBar(`弃权退回 ${refund} 游戏币，本轮结束。确定？`, () => {
    gameData.items.casinoCoin = coin() + refund;
    addSystemLog('战斗', `对战帐篷：弃权，退回 ${refund} 游戏币`);
    _run = null;
    _detail = null;
    _lastResult = '弃权';
    const t = ensureTent();
    t.run = null;
    saveGame();
    _step = 'lobby';
    render();
  }, null, { overlay: true });
}

async function startBattle() {
  if (!_run || _busy) return;
  _busy = true;
  try {
    const level = TENT_FLOOR_LEVELS[_run.floors];
    // 每层开始全队满血
    _run.squad = _run.squad.map((m) => buildMon({ ...m.plain, level }, 1) || m);
    _run.phase = 'start';
    persistRun();
    _detail = null;
    const opp = _run.opponents[_run.floors];
    const pTeam = _run.squad.map((m) => ({ entry: entryFor(m), pd: m.pd, mon: m.mon }));
    const eTeam = enemyTeam(shuffle(opp.slice()));
    if (pTeam.length !== TENT_TEAM_SIZE || eTeam.length !== TENT_TEAM_SIZE) {
      showConfirmBar('队伍数据异常，请重试。', null, null, { singleButton: true });
      return;
    }
    const bv = $('battleView');
    if (bv) bv.dataset.viewTitle = `第${_run.floors + 1}层`;
    pushNav('battleView');
    showView('battleView');
    const ok = await startCustomBattle({
      pTeam,
      eTeam,
      preset: { name: '对战帐篷', tier: 'tent' },
      confirmText: '离开战斗将按失败处理，本轮下注和已赢层数都会作废。确定？',
      onEnd: onBattleEnd,
    });
    if (!ok) returnToTent();
  } catch (e) {
    console.error('[tent] battle failed', e);
    returnToTent();
  } finally {
    _busy = false;
  }
}

function onBattleEnd(info) {
  _busy = false;
  if (!_run) return;
  if (!info.win) {
    finishRun('lose');
    return;
  }
  _run.floors += 1;
  if (_run.floors >= TENT_FLOOR_LEVELS.length) {
    finishRun('clear');
    return;
  }
  _run.swapDone = false;
  _run.phase = 'decision';
  persistRun();
  _step = 'decision';
  returnToTent();
}

function doSwap(srcIdx, squadIdx) {
  if (!_run) return;
  const defeated = _run.opponents[_run.floors - 1] || [];
  const plain = defeated[srcIdx];
  if (!plain) return;
  const outgoing = _run.squad[squadIdx]?.plain;
  const level = TENT_FLOOR_LEVELS[_run.floors];
  const next = buildMon({ ...plain, level }, 1);
  if (!next) return;
  _run.squad[squadIdx] = next;
  // 视觉上交换：换下来的宝可梦放进败者队伍原来的格子
  if (outgoing) defeated[srcIdx] = { ...outgoing };
  _run.swapDone = true;
  persistRun();
  render();
}

function finishRun(kind) {
  if (!_run) return;
  const t = ensureTent();
  const floors = _run.floors;
  const bet = _run.bet;
  const payout = kind === 'lose' ? 0 : payoutFor(floors, bet);
  const net = payout - bet;
  gameData.items.casinoCoin = coin() + payout;
  const rec = { time: Date.now(), bet, floors, result: kind, payout, net, team: _run.squad.map((m) => ({ ...m.plain })) };
  t.records.unshift(rec);
  t.records = t.records.slice(0, TENT_RECORD_MAX);
  _result = { ...rec, squad: _run.squad.map((m) => ({ ...m.plain })) };
  _lastResult = `${floors} 层 · ${resultText(kind)} · ${net >= 0 ? '+' : ''}${formatNum(net)}`;
  addSystemLog('战斗', `对战帐篷：${kind === 'clear' ? '五层通关' : kind === 'cash' ? '收手' : '出局'}，下注 ${bet}，赢 ${floors} 层，提现 ${payout}，净收益 ${net >= 0 ? '+' : ''}${net}`);
  _run = null;
  _detail = null;
  t.run = null;
  saveGame();
  _step = 'result';
  returnToTent();
}

function returnToTent() {
  const bv = $('battleView');
  if (bv) delete bv.dataset.viewTitle;
  if (getCurrentView() === 'battleView') popNav();
  clearBattleTier();
  pushNav(VIEW);
  showView(VIEW);
  render();
}
