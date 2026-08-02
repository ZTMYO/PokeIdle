// ===== 地区悬赏 =====
// 每天 0 点刷新，生成后当天不变：每个地区指定若干只宝可梦（从全国图鉴加权随机抽取）
// ，按稀有度/捕获难度生成随机糖果奖励。
// 仓库中拥有该宝可梦（在仓个体）即可提交（交出一只个体）。
// 只有今日到访过的地区才显示悬赏内容（离开后仍可查看）；提交必须到达该地区。
import { REGION_CYCLE, BOUNTY_PER_REGION, BOUNTY_CANDY_MIN, BOUNTY_CANDY_MAX, BOUNTY_JITTER, BOUNTY_RARE_WEIGHT } from './config.js';
import { gameData, allPokemon, getPokemonByIndex, getCurrentRegion, phase, setPrevView, saveGame, addSystemLog } from './state.js';
import { $, showView, updateStats, tryLoadImage } from './ui.js';
import { showGoodbyeConfirm } from './animation.js';

// 日期字符串（YYYY-MM-DD，本地时区）
function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 加权随机索引（权重 = 0.3 + 稀有度 × BOUNTY_RARE_WEIGHT）
function weightedIndex(pool) {
  let total = 0;
  const weights = pool.map(p => {
    const w = 0.3 + (p.rarity ?? 0.5) * BOUNTY_RARE_WEIGHT;
    total += w;
    return w;
  });
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return pool.length - 1;
}

// 从全国图鉴加权随机抽取 count 只宝可梦（各地区独立抽样，允许重复）
function sampleBountyPokemon(count) {
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(allPokemon[weightedIndex(allPokemon)]);
  }
  return picked;
}

// 糖果奖励公式：难度 = (1-捕获率)/2 + 稀有度/2（0~1），越难捕获奖励越多，再叠加随机浮动（不超上限）
function calcBountyCandy(poke) {
  const catchRate = Math.min(Math.max(poke.catchRate ?? 0.5, 0), 1);
  const rarity = Math.min(Math.max(poke.rarity ?? 0.5, 0), 1);
  const difficulty = 0.5 * (1 - catchRate) + 0.5 * rarity;
  const base = BOUNTY_CANDY_MIN + (BOUNTY_CANDY_MAX - BOUNTY_CANDY_MIN) * difficulty;
  const jitter = 1 + (Math.random() * 2 - 1) * BOUNTY_JITTER;
  return Math.min(BOUNTY_CANDY_MAX, Math.max(BOUNTY_CANDY_MIN, Math.round(base * jitter)));
}

// 生成/刷新当日悬赏：跨过 0 点（日期变化）或旧格式存档时全部重新生成，当天保持不变；
// 同时把当前所在地区标记为今日已到访
export function ensureBounty() {
  if (!gameData) return;
  const today = dateStr();
  const b = gameData.bounty;
  // 旧格式：每地区单条悬赏或条数不符（rewards[i] 不是数组或长度不等于 BOUNTY_PER_REGION）→ 重新生成
  const legacy = b && Array.isArray(b.rewards) && b.rewards.length > 0
    && (!Array.isArray(b.rewards[0]) || b.rewards[0].length !== BOUNTY_PER_REGION);
  if (!b || b.date !== today || !Array.isArray(b.rewards) || legacy) {
    const sampled = sampleBountyPokemon(REGION_CYCLE.length * BOUNTY_PER_REGION);
    let k = 0;
    gameData.bounty = {
      date: today,
      visited: REGION_CYCLE.map(() => false),
      rewards: REGION_CYCLE.map(() => {
        const arr = Array.from({ length: BOUNTY_PER_REGION }, () => {
          const poke = sampled[k++];
          if (!poke) return null;
          return { pokemon: String(poke.index), candy: calcBountyCandy(poke), claimed: false };
        });
        // 每页按糖果奖励从低到高排序
        return arr.sort((a, b) => {
          if (a && b) return a.candy - b.candy;
          return a ? -1 : 1;
        });
      }),
    };
  } else if (!Array.isArray(b.visited)) {
    // 兼容缺少 visited 字段的存档：视为今日尚未到访任何地区
    b.visited = REGION_CYCLE.map(() => false);
  }
  // 标记当前所在地区今日已到访（离开该地区后仍可查看其悬赏）
  const g = gameData.bounty;
  const cur = gameData.gps?.curIdx ?? 2;
  if (cur >= 0 && cur < g.visited.length) g.visited[cur] = true;
}

// 仓库中是否有该物种的在仓个体（获得时间不限，任意来源均可提交）
function hasInRoster(pokemonIdx) {
  const idx = String(pokemonIdx);
  return (gameData.roster || []).some(p => String(p.species) === idx && p.inRoster);
}

// ---------- 渲染 ----------
const CANDY_IMG = '<img src="./items/candy.png" style="width:12px;height:12px;vertical-align:middle;image-rendering:pixelated;" />';
const BACK_ICON = '<svg viewBox="0 0 1024 1024" width="14" height="14"><use xlink:href="./icons/sprites.svg#icon-back"/></svg>';
// 当前翻页所在地区索引（打开页面时默认定位到当前地区）
let _pageIdx = 2;

function renderBounty() {
  const content = $('bountyContent');
  if (!content) return;
  ensureBounty();
  // 提交悬赏中：页面切换为仓库样式列表
  if (_tradeMode) { renderBountyTrade(content, _tradeMode.regionIdx, _tradeMode.bi); return; }
  const g = gameData.bounty;
  const cur = getCurrentRegion();
  const d = new Date();
  const head = `${d.getMonth() + 1}月${d.getDate()}日 · 每日0点刷新`;
  const i = Math.min(Math.max(_pageIdx, 0), REGION_CYCLE.length - 1);
  const name = REGION_CYCLE[i];
  const visited = !!g.visited[i];
  const isCur = i === cur.id;

  let body;
  if (!visited) {
    // 未到访：不展示悬赏内容
    body = `
      <div class="bounty-card unknown">
        <div class="bounty-unknown">今日未到访</div>
      </div>`;
  } else {
    const lines = (g.rewards[i] || []).map((b, k) => {
      const poke = b ? getPokemonByIndex(b.pokemon) : null;
      if (!poke) return '';
      const claimed = !!b.claimed;
      const has = hasInRoster(b.pokemon);
      // 提交按钮状态：当前地区且仓库有该个体可提交；已提交/无个体/在其他地区为锁定态
      // （仓库有但不在当前地区 → pending「可提交」，加边框区别于「无个体」）
      const btnCls = claimed ? 'done' : !has ? 'locked' : !isCur ? 'pending' : '';
      const btnText = claimed ? '已提交' : has ? (isCur ? '提交' : '可提交') : '未拥有';
      const btnTip = has && !isCur ? `到达${name}提交` : '';
      return `
      <div class="bounty-line${claimed ? ' claimed' : ''}">
        <span class="bounty-name">${poke.name}</span>
        <span class="bounty-candy">${CANDY_IMG}×${b.candy}</span>
        <span class="bounty-claim ${btnCls}" data-region="${i}" data-bi="${k}"${btnTip ? ` title="${btnTip}"` : ''}>${btnText}</span>
      </div>`;
    }).join('');
    body = `
    <div class="bounty-card${isCur ? ' cur' : ''}">
      ${lines}
    </div>`;
  }

  // 今日统计：已完成 = 已提交；待提交 = 今日已到访地区中仓库已拥有但未提交
  let claimedCount = 0, pendingCount = 0;
  for (let i = 0; i < g.rewards.length; i++) {
    if (!g.visited[i]) continue; // 未到访地区不统计（玩家未知，看不到内容）
    for (const b of g.rewards[i]) {
      if (!b) continue;
      if (b.claimed) claimedCount++;
      else if (hasInRoster(b.pokemon)) pendingCount++;
    }
  }
  const totalCount = REGION_CYCLE.length * BOUNTY_PER_REGION;

  content.innerHTML = `
    <div class="bounty-wrap">
      <div class="bounty-title">${name}${isCur ? '（当前）' : ''}</div>
      <div class="bounty-head">${head}</div>
      <div class="bounty-pager">
        <button class="bounty-arrow prev" data-page="prev" aria-label="上一个地区">${BACK_ICON}</button>
        <div class="bounty-page">${body}</div>
        <button class="bounty-arrow next" data-page="next" aria-label="下一个地区">${BACK_ICON}</button>
      </div>
      <div class="bounty-refresh" id="bountyRefresh">今日已完成 ${claimedCount}/${totalCount} · 待提交 ${pendingCount}</div>
    </div>`;
}

// ---------- 提交 ----------
function claimBounty(regionIdx, bi) {
  ensureBounty();
  const cur = getCurrentRegion();
  if (regionIdx !== cur.id) return; // 必须到达该地区才能提交
  const b = (gameData.bounty?.rewards || [])[regionIdx]?.[bi] || null;
  if (!b || b.claimed) return;
  if (!hasInRoster(b.pokemon)) return;
  // 进入提交列表：页面切换为仓库样式列表，选个体后点行右侧「提交」
  _tradeMode = { regionIdx, bi };
  renderBounty();
}

// 实际提交流程（选定交出个体后执行）
function doClaimBounty(regionIdx, bi) {
  const b = (gameData.bounty?.rewards || [])[regionIdx]?.[bi] || null;
  if (!b || b.claimed) return;
  b.claimed = true;
  gameData.items.candy = (gameData.items.candy || 0) + b.candy;
  gameData.stats.totalItemsEarned.candy = (gameData.stats.totalItemsEarned.candy || 0) + b.candy; // 提交悬赏也计入道具获得
  gameData.stats.totalBountyClaims = (gameData.stats.totalBountyClaims || 0) + 1;
  gameData.stats.totalBountyCandy = (gameData.stats.totalBountyCandy || 0) + b.candy;
  // 今日完成数：跨天自动清零
  if (gameData.stats.lastBountyDate !== dateStr()) {
    gameData.stats.lastBountyDate = dateStr();
    gameData.stats.bountyClaimsToday = 0;
  }
  gameData.stats.bountyClaimsToday = (gameData.stats.bountyClaimsToday || 0) + 1;
  addSystemLog('bounty_claim', { pokemon: b.pokemon, candy: b.candy });
  saveGame();
  updateStats();
  renderBounty();
}

// ---------- 提交列表（类似仓库列表） ----------
let _tradeMode = null; // 正在提交的悬赏：{ regionIdx, bi }，非 null 时悬赏页显示提交列表

// 渲染提交列表：复用仓库行样式，每行右侧为「提交」按钮
function renderBountyTrade(content, regionIdx, bi) {
  const b = (gameData.bounty?.rewards || [])[regionIdx]?.[bi] || null;
  const poke = b ? getPokemonByIndex(b.pokemon) : null;
  const candidates = (gameData.roster || []).filter(p => String(p.species) === String(b?.pokemon) && p.inRoster);
  const pokeName = poke ? poke.name : (b ? `#${b.pokemon}` : '');
  const rows = candidates.length === 0
    ? '<div class="roster-trade-empty">仓库中没有该宝可梦，无法提交</div>'
    : candidates.map((p, i) => {
        const sum = p.ivs ? p.ivs.hp + p.ivs.atk + p.ivs.def + p.ivs.spa + p.ivs.spd + p.ivs.spe : 0;
        const icon = poke?.icon ? '<img class="roster-icon-img" data-trade-icon alt="" />' : '';
        return `
        <div class="pokedex-entry roster-row bounty-trade-row">
          <span class="roster-icon">${icon}</span>
          <span class="pokedex-star">${p.shiny ? '★' : ''}</span>
          <span class="pokedex-idx">#${String(p.species)}</span>
          <span class="pokedex-name">${poke ? poke.name : '#' + String(p.species)}</span>
          <span class="roster-iv">${sum}</span>
          <span class="bounty-trade-btn-col"><button class="bounty-trade-btn" data-trade-submit="${p.id}">提交</button></span>
        </div>`;
      }).join('');
  content.innerHTML = `
    <div class="bounty-trade-list">
      <div class="bounty-trade-head">
        <span data-trade-back class="bounty-trade-back">${BACK_ICON}</span>
        <span>提交 ${pokeName}</span>
      </div>
      <div class="pokedex-header roster-header">
        <span class="roster-icon"></span>
        <span class="pokedex-star"></span>
        <span class="pokedex-idx">#</span>
        <span class="pokedex-name">名称</span>
        <span class="roster-iv">个体值</span>
        <span class="bounty-trade-btn-col">提交</span>
      </div>
      ${rows}
    </div>`;
  if (poke?.icon) {
    content.querySelectorAll('[data-trade-icon]').forEach(img => tryLoadImage(img, poke.icon));
  }
}

// 提交告别场景防重入（场景由 animation.js 的 showGoodbyeConfirm 展示）
let _goodbyeAnim = false;

// 提交指定个体：确认后移除个体并完成悬赏，返回悬赏列表
function submitTrade(rid) {
  const p = (gameData.roster || []).find(r => r.id === rid && r.inRoster);
  if (!p) return;
  if (_goodbyeAnim) return;
  const { regionIdx, bi } = _tradeMode || {};
  const b = (gameData.bounty?.rewards || [])[regionIdx]?.[bi] || null;
  const poke = b ? getPokemonByIndex(b.pokemon) : null;
  // 弹出告别场景询问确认；确认后移除个体、播告别动画并完成悬赏
  _goodbyeAnim = true;
  showGoodbyeConfirm({
    poke,
    prompt: '确认要提交吗？',
    shiny: !!p.shiny,
    onConfirm: () => {
      const arr = gameData.roster || [];
      const ri = arr.findIndex(r => r.id === rid);
      if (ri >= 0) arr.splice(ri, 1);
      _goodbyeAnim = false;
      _tradeMode = null;
      if (regionIdx != null) doClaimBounty(regionIdx, bi);
      else renderBounty();
    },
    onCancel: () => {
      _goodbyeAnim = false;
    },
  });
}

export function showBountyView() {
  setPrevView(phase === 'encounter' ? 'encounterView' : 'idleView');
  _tradeMode = null; // 重新打开悬赏页时退出提交列表
  _pageIdx = getCurrentRegion().id; // 打开时默认定位到当前地区
  renderBounty();
  showView('bountyView');
  const content = $('bountyContent');
  content.onclick = (e) => {
    // 提交列表模式：只响应返回与行内「提交」
    if (_tradeMode) {
      if (e.target.closest('[data-trade-back]')) {
        _tradeMode = null;
        renderBounty();
        return;
      }
      const btn = e.target.closest('[data-trade-submit]');
      if (btn) { submitTrade(btn.dataset.tradeSubmit); return; }
      return;
    }
    const arrow = e.target.closest('.bounty-arrow');
    if (arrow) {
      // 无限翻页：首尾循环
      const n = REGION_CYCLE.length;
      _pageIdx = (arrow.dataset.page === 'next' ? _pageIdx + 1 : _pageIdx - 1 + n) % n;
      renderBounty();
      return;
    }
    const btn = e.target.closest('.bounty-claim:not(.locked):not(.done)');
    if (!btn) return;
    claimBounty(Number(btn.dataset.region), Number(btn.dataset.bi));
  };
}
