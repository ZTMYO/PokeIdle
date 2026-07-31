// ===== 地区悬赏 =====
// 每天 0 点刷新，生成后当天不变：每个地区指定若干只宝可梦（来自全国图鉴，各地区互不重复），
// 按稀有度/捕获难度生成随机糖果奖励。当天内捕获即可领取。
// 只有今日到访过的地区才显示悬赏内容（离开后仍可查看）；领取奖励必须到达该地区。
import { REGION_CYCLE, BOUNTY_PER_REGION, BOUNTY_CANDY_MIN, BOUNTY_CANDY_MAX, BOUNTY_JITTER, BOUNTY_RARE_WEIGHT } from './config.js';
import { gameData, allPokemon, getPokemonByIndex, getCurrentRegion, phase, setPrevView, saveGame, addSystemLog, formatTime } from './state.js';
import { $, showView, updateStats } from './ui.js';

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

// 从全国图鉴抽取 count 只互不重复的宝可梦（加权抽样后剔除，避免各地区悬赏重复）
function sampleBountyPokemon(count) {
  const bag = [...allPokemon];
  const picked = [];
  while (picked.length < count && bag.length > 0) {
    picked.push(bag.splice(weightedIndex(bag), 1)[0]);
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

// 悬赏日期当天是否捕获过该宝可梦（野生/钓鱼捕获才算，孵蛋获得不算）
function caughtOnBountyDay(pokemonIdx, dateStrVal) {
  const logs = (gameData.encounterLogs || {})[String(pokemonIdx)] || [];
  return logs.some(l => l.result === 'caught' && l.source != null && dateStr(new Date(l.time)) === dateStrVal);
}

// 距次日 0 点的剩余秒数（刷新倒计时）
function untilMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(0, Math.round((next - now) / 1000));
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
      const caught = caughtOnBountyDay(b.pokemon, g.date);
      // 领取按钮状态：当前地区已捕获可领取；已领取/未捕获/在其他地区为锁定态
      const btnCls = claimed ? 'done' : (!caught || !isCur) ? 'locked' : '';
      const btnText = claimed ? '已领取' : caught ? (isCur ? '领取' : '可领取') : '未捕获';
      const btnTip = caught && !isCur ? `到达${name}后可领取` : '';
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

  content.innerHTML = `
    <div class="bounty-wrap">
      <div class="bounty-title">${name}${isCur ? '（当前）' : ''}-地区悬赏</div>
      <div class="bounty-head">${head}</div>
      <div class="bounty-pager">
        <button class="bounty-arrow prev" data-page="prev" aria-label="上一个地区">${BACK_ICON}</button>
        <div class="bounty-page">${body}</div>
        <button class="bounty-arrow next" data-page="next" aria-label="下一个地区">${BACK_ICON}</button>
      </div>
      <div class="bounty-refresh" id="bountyRefresh">距下次刷新 ${formatTime(untilMidnight())}</div>
    </div>`;
}

// ---------- 领取 ----------
function claimBounty(regionIdx, bi) {
  ensureBounty();
  const cur = getCurrentRegion();
  if (regionIdx !== cur.id) return; // 必须到达该地区才能领取
  const b = (gameData.bounty?.rewards || [])[regionIdx]?.[bi] || null;
  if (!b || b.claimed) return;
  if (!caughtOnBountyDay(b.pokemon, gameData.bounty.date)) return;
  b.claimed = true;
  gameData.items.candy = (gameData.items.candy || 0) + b.candy;
  addSystemLog('bounty_claim', { pokemon: b.pokemon, candy: b.candy });
  saveGame();
  updateStats();
  renderBounty();
}

export function showBountyView() {
  setPrevView(phase === 'encounter' ? 'encounterView' : 'idleView');
  _pageIdx = getCurrentRegion().id; // 打开时默认定位到当前地区
  renderBounty();
  showView('bountyView');
  const content = $('bountyContent');
  content.onclick = (e) => {
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
  // 刷新倒计时：仅在本页打开时每秒更新，离开后自动停止
  if (showBountyView._timer) clearInterval(showBountyView._timer);
  showBountyView._timer = setInterval(() => {
    if ($('bountyView')?.style.display !== 'flex') {
      clearInterval(showBountyView._timer);
      showBountyView._timer = null;
      return;
    }
    const el = $('bountyRefresh');
    if (el) el.textContent = '距下次刷新 ' + formatTime(untilMidnight());
  }, 1000);
}
