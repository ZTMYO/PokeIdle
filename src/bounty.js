// ===== 地区悬赏 =====
// 每天 0 点刷新，生成后当天不变：每个地区指定若干只宝可梦（从全国图鉴加权随机抽取）
// ，按稀有度/捕获难度生成随机糖果奖励。
// 仓库中拥有该宝可梦（在仓个体）即可提交（交出一只个体）。
// 只有今日到访过的地区才显示悬赏内容（离开后仍可查看）；提交必须到达该地区。
import { REGION_CYCLE, BOUNTY_PER_REGION, BOUNTY_CANDY_MIN, BOUNTY_CANDY_MAX, BOUNTY_JITTER, BOUNTY_RARE_WEIGHT } from './config.js';
import { gameData, allPokemon, getPokemonByIndex, getCurrentRegion, pushNav, saveGame, addSystemLog, ensureGender, genderBadge, isPokemon } from './state.js';
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
  // 以 gps.curIdx（到达的节点）为准：在途中不标记，只有真正抵达节点才算今日到访
  const g = gameData.bounty;
  const cur = gameData.gps?.curIdx ?? 2;
  if (cur >= 0 && cur < g.visited.length) g.visited[cur] = true;
}

// 仓库中是否有该物种的在仓个体（获得时间不限，任意来源均可提交）
function hasInRoster(pokemonIdx) {
  const idx = String(pokemonIdx);
  return (gameData.roster || []).some(p => String(p.species) === idx && p.inRoster);
}

// 标题栏悬赏入口红点：当前地区是否有可提交的悬赏（未提交且仓库有该个体）
export function hasRedeemableBounty() {
  ensureBounty();
  const g = gameData.bounty;
  if (!g || !Array.isArray(g.rewards)) return false;
  const rid = getCurrentRegion().id;
  // 未到访地区不亮红点：与页面「今日未到访」展示一致，避免红点亮着却无法提交
  // （在途时 getCurrentRegion 按实际位置折算地区，可能还没到访；到达节点后才亮红点）
  if (!Array.isArray(g.visited) || !g.visited[rid]) return false;
  const rewards = g.rewards[rid];
  if (!Array.isArray(rewards)) return false;
  return rewards.some(b => b && !b.claimed && !b.ignored && hasInRoster(b.pokemon));
}

// 刷新标题栏悬赏入口红点（提交/换地区/仓库变化后调用）
export function updateBountyBadge() {
  const badge = $('title-badge-bounty');
  if (badge) badge.style.display = hasRedeemableBounty() ? '' : 'none';
}

// ---------- 渲染 ----------
const CANDY_IMG = '<img src="./items/candy.png" style="width:12px;height:12px;vertical-align:middle;image-rendering:pixelated;" />';
const BACK_ICON = '<svg viewBox="0 0 1024 1024" width="14" height="14"><use xlink:href="./icons/sprites.svg#icon-back"/></svg>';
// 标题右侧导航图标（纸飞机样式），fill 跟随主题色
const GO_ICON = '<svg viewBox="0 0 1024 1024" width="13" height="13" aria-hidden="true"><path d="M123.92 555.9a32 32 0 0 1-14.82-60.38l719.19-374.9a32 32 0 0 1 29.59 56.76l-719.2 374.89a31.87 31.87 0 0 1-14.76 3.63z"/><path d="M608.6 957.7a32 32 0 0 1-30.6-41.27l234.64-776.34a32 32 0 0 1 61.26 18.52L639.22 935a32 32 0 0 1-30.62 22.7zM505.92 580.44c-0.68 0-1.36 0-2.05-0.07l-381.46-24.12a32 32 0 1 1 4-63.88l381.5 24.13a32 32 0 0 1-2 63.94z"/><path d="M608.14 957.32a32 32 0 0 1-30.87-23.63L475 556.82a32 32 0 1 1 61.77-16.76L639 916.93a32 32 0 0 1-22.51 39.26 31.61 31.61 0 0 1-8.35 1.13z"/></svg>';
// 当前翻页所在地区索引（打开页面时默认定位到当前地区）
let _pageIdx = 2;
// 鼠标滚轮翻页：节流窗口内累计滚动量，解锁时按每 100px 一页翻多页，连续滚动不吞格
let _wheelLock = 0;
let _wheelAcc = 0;

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
  // 导航图标：已在当前地区时不显示（标题也不标注"当前"）

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
      const ignored = !!b.ignored;
      // 提交按钮状态：当前地区且仓库有该个体可提交；已提交/无个体/在其他地区为锁定态
      // （仓库有但不在当前地区 → pending「可提交」，加边框区别于「无个体」）
      const btnCls = claimed ? 'done' : !has ? 'locked' : !isCur ? 'pending' : '';
      const btnText = claimed ? '已提交' : has ? (isCur ? '提交' : '可提交') : '未拥有';
      const btnTip = has && !isCur ? `到达${name}提交` : '';
      return `
      <div class="bounty-line${claimed ? ' claimed' : ignored ? ' ignored' : ''}" data-region="${i}" data-bi="${k}">
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
      else if (!b.ignored && hasInRoster(b.pokemon)) pendingCount++;
    }
  }
  const totalCount = REGION_CYCLE.length * BOUNTY_PER_REGION;

  content.innerHTML = `
    <div class="bounty-wrap">
      <div class="bounty-title-row">
        <span class="bounty-title">${name}</span>
        ${isCur ? '' : `<button class="bounty-go" data-bounty-go aria-label="前往${name}" title="前往${name}">${GO_ICON}</button>`}
      </div>
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

// 切换悬赏「忽略」状态：忽略后不再计入标题栏红点与待提交统计，但随时可恢复/正常提交
function toggleIgnoreBounty(regionIdx, bi) {
  ensureBounty();
  const b = (gameData.bounty?.rewards || [])[regionIdx]?.[bi] || null;
  if (!b || b.claimed) return;
  b.ignored = !b.ignored;
  saveGame();
  updateBountyBadge();
  renderBounty();
}

// 悬赏提示浮层：淡入显示、短暂停留后淡出（连续触发时重置计时）
let _bountyToastTimer = null;
function showBountyToast(msg) {
  const t = $('bountyToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  if (_bountyToastTimer) clearTimeout(_bountyToastTimer);
  _bountyToastTimer = setTimeout(() => {
    _bountyToastTimer = null;
    t.classList.remove('show');
  }, 2000);
}

function claimBounty(regionIdx, bi) {
  ensureBounty();
  const cur = getCurrentRegion();
  if (regionIdx !== cur.id) {
    showBountyToast(`前往${REGION_CYCLE[regionIdx] || '对应地区'}即可提交`);
    return; // 必须到达该地区才能提交
  }
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
  updateBountyBadge(); // 当前地区无剩余可提交时熄灭红点
  renderBounty();
}

// ---------- 提交列表（类似仓库列表） ----------
let _tradeMode = null; // 正在提交的悬赏：{ regionIdx, bi }，非 null 时悬赏页显示提交列表
let _bSortBy = null;   // 提交列表排序列：iv | level（null=保持仓库顺序）
let _bSortDir = 1;     // 1 升序 / -1 降序

// 是否处于提交列表子页（标题栏返回时先回悬赏列表）
export function isBountyInTrade() {
  return _tradeMode != null;
}
// 退出提交列表，返回悬赏列表
export function restoreBountyList() {
  _tradeMode = null;
  renderBounty();
}

// 渲染提交列表：复用仓库行样式，每行右侧为「提交」按钮
function renderBountyTrade(content, regionIdx, bi) {
  const b = (gameData.bounty?.rewards || [])[regionIdx]?.[bi] || null;
  const poke = b ? getPokemonByIndex(b.pokemon) : null;
  const candidates = (gameData.roster || []).filter(p => String(p.species) === String(b?.pokemon) && p.inRoster && isPokemon(p));
  const pokeName = poke ? poke.name : (b ? `#${b.pokemon}` : '');
  // 表头点击排序：个体值/等级（同物种候选按数值排）
  let pool = candidates;
  if (_bSortBy) {
    pool = [...candidates].sort((a, b) => {
      const va = _bSortBy === 'level' ? (a.level || 1) : (a.ivs ? a.ivs.hp + a.ivs.atk + a.ivs.def + a.ivs.spa + a.ivs.spd + a.ivs.spe : 0);
      const vb = _bSortBy === 'level' ? (b.level || 1) : (b.ivs ? b.ivs.hp + b.ivs.atk + b.ivs.def + b.ivs.spa + b.ivs.spd + b.ivs.spe : 0);
      return (va - vb) * _bSortDir;
    });
  }
  const rows = pool.length === 0
    ? '<div class="roster-trade-empty">仓库中没有该宝可梦，无法提交</div>'
    : pool.map((p, i) => {
        const ivsText = p.ivs ? ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => p.ivs[k] || 0).join('/') : '';
        const icon = poke?.icon ? '<img class="roster-icon-img" data-trade-icon alt="" />' : '';
        return `
        <div class="pokedex-entry roster-row bounty-trade-row" data-trade-view="${p.id}">
          <span class="roster-icon">${icon}</span>
          <span class="pokedex-star">${p.shiny ? '★' : ''}</span>
          <span class="roster-ivs">${ivsText}</span>
          <span class="roster-nature">${genderBadge(ensureGender(p))}Lv${p.level || 1}</span>
          <span class="bounty-trade-btn-col"><button class="bounty-trade-btn" data-trade-submit="${p.id}">提交</button></span>
        </div>`;
      }).join('');
  // 表头排序指示：当前排序列文本后直接加 ▲/▼（与仓库/图鉴箭头一致）
  const sortMark = k => k === _bSortBy ? (_bSortDir === 1 ? ' ▲' : ' ▼') : '';
  content.innerHTML = `
    <div class="bounty-trade-list">
      <div class="bounty-trade-head">
        <span>提交 ${pokeName}</span>
      </div>
      <div class="pokedex-header roster-header">
        <span class="roster-icon"></span>
        <span class="pokedex-star"></span>
        <span class="roster-ivs" data-sort="iv">个体值${sortMark('iv')}</span>
        <span class="roster-nature" data-sort="level">等级${sortMark('level')}</span>
        <span class="bounty-trade-btn-col">提交</span>
      </div>
      <div class="bounty-trade-rows list-scroll">
        ${rows}
      </div>
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
    prompt: '确定要提交吗？',
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
  pushNav('bountyView');
  _tradeMode = null; // 重新打开悬赏页时退出提交列表
  _pageIdx = getCurrentRegion().id; // 打开时默认定位到当前地区
  renderBounty();
  showView('bountyView');
  const content = $('bountyContent');
  content.onclick = (e) => {
    // 提交列表模式：行内「提交」按钮执行交换；点击行进入仓库个体详情（返回恢复本列表）
    if (_tradeMode) {
      // 表头点击排序（与仓库一致：同字段切换升降序，新字段默认升序）
      const sortEl = e.target.closest('.bounty-trade-list .pokedex-header [data-sort]');
      if (sortEl) {
        const f = sortEl.dataset.sort;
        if (_bSortBy === f) _bSortDir *= -1;
        else { _bSortBy = f; _bSortDir = 1; }
        renderBounty();
        return;
      }
      const btn = e.target.closest('[data-trade-submit]');
      if (btn) { submitTrade(btn.dataset.tradeSubmit); return; }
      const row = e.target.closest('[data-trade-view]');
      if (row) {
        import('./roster.js').then(m => m.showRosterDetailFromList(row.dataset.tradeView, () => {
          showView('bountyView');
          renderBounty();
        }));
      }
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
    // 「前往」：跳转导航页并自动规划前往当前展示地区
    const go = e.target.closest('.bounty-go');
    if (go) {
      if (go.disabled) return;
      pushNav('gpsView'); // 从悬赏前往地区：返回时回悬赏页
      import('./gps.js').then(m => { m.navigateToRegion(_pageIdx); m.showGpsView(); });
      return;
    }
    const btn = e.target.closest('.bounty-claim:not(.locked):not(.done)');
    if (!btn) return;
    claimBounty(Number(btn.dataset.region), Number(btn.dataset.bi));
  };
  // 鼠标滚轮翻页（参考手机 App 主屏翻页）：纵向滚轮映射为地区翻页，首尾循环同箭头。
  // 解锁周期内累计滚动量、解锁时按每 100px 一页翻多页（封顶 4 页），快速连滚不吞格；
  // 提交列表是仓库滚动列表，不劫持滚轮
  content.onwheel = (e) => {
    if (_tradeMode) return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; // 横向滚轮交给原生滚动
    e.preventDefault();
    const now = Date.now();
    if (now - _wheelLock < 180) {
      _wheelAcc += e.deltaY; // 节流窗口内先累计，避免快速滚动被吞
      return;
    }
    _wheelLock = now;
    const total = _wheelAcc + e.deltaY; // 把窗口内累计量 + 当前这一格一起结算
    _wheelAcc = 0;
    if (Math.abs(total) < 40) return; // 累计量太小（反向抵消），忽略
    const steps = Math.max(1, Math.min(4, Math.round(Math.abs(total) / 100)));
    const n = REGION_CYCLE.length;
    _pageIdx = (_pageIdx + (total > 0 ? steps : -steps) + n * 4) % n;
    renderBounty();
  };
  // 右键可提交的悬赏行：弹出「忽略/恢复」菜单（参考商店批量购买右键菜单）
  content.oncontextmenu = (e) => {
    const row = e.target.closest('.bounty-line');
    if (!row) return;
    const claim = row.querySelector('.bounty-claim');
    // 仅未提交且仓库拥有（可忽略/恢复）时弹出；已提交/未拥有无需提醒
    if (!claim || claim.classList.contains('done') || claim.classList.contains('locked')) return;
    const b = (gameData.bounty?.rewards || [])[Number(row.dataset.region)]?.[Number(row.dataset.bi)] || null;
    if (!b) return;
    e.preventDefault();
    showBountyContextMenu(!!b.ignored, Number(row.dataset.region), Number(row.dataset.bi), e.clientX, e.clientY);
  };
}

// 悬赏右键菜单：在右键位置弹出「忽略/恢复」项（样式复用商店批量购买菜单）
function showBountyContextMenu(ignored, regionIdx, bi, x, y) {
  hideBountyContextMenu();
  let menu = $('bountyCtxMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'bountyCtxMenu';
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = `<div class="shop-ctx-item" data-region="${regionIdx}" data-bi="${bi}">${ignored ? '恢复红点提醒' : '忽略此悬赏'}</div>`;
  menu.style.display = '';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(0, Math.min(x - 24, window.innerWidth - mw - 4)) + 'px';
  menu.style.top = Math.max(0, Math.min(y, window.innerHeight - mh - 4)) + 'px';
  // 菜单内点击不触发外部关闭；点击外部任意位置关闭
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.onclick = (e) => {
    const opt = e.target.closest('.shop-ctx-item');
    if (!opt) return;
    hideBountyContextMenu();
    toggleIgnoreBounty(Number(opt.dataset.region), Number(opt.dataset.bi));
  };
  document.addEventListener('pointerdown', hideBountyContextMenu);
}

function hideBountyContextMenu() {
  const menu = $('bountyCtxMenu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('pointerdown', hideBountyContextMenu);
}

// 后台新增宝可梦（捕获/孵化/交换）时，悬赏页若可见则实时刷新按钮/列表状态；同时刷新标题栏红点
window.addEventListener('roster-changed', () => {
  updateBountyBadge();
  const tv = $('bountyView');
  if (!tv || tv.style.display !== 'flex') return;
  renderBounty();
});
