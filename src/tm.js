// ===== 招式机（商店在售）：糖果解锁，解锁后能学会它的宝可梦直接学会 =====
// 货架每天只上架还没解锁的招式，收齐后自然收摊；蛋招式不在这里（只有孵蛋个体能学）。
import { gameData, saveGame, addSystemLog, isTmUnlocked } from './state.js';
import { TM_PRICE_TIERS, TM_SHOP_DAILY } from './config.js';
import { TM_ICONS, TYPE_COLORS, typeIconColor } from './items.js';
import { $, showConfirmBar, updateBackpack, updateStats } from './ui.js';
import { moveDataset, learnTmForAll, catIconHtml, moveDesc } from './roster.js';

let _pool = null;   // 全部可解锁招式：{ id, name, type, power, price }
let _moves = null;  // moves.json 引用（详情卡片用）

function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function priceOf(power) {
  for (const t of TM_PRICE_TIERS) if ((power || 0) <= t.max) return t.price;
  return TM_PRICE_TIERS[TM_PRICE_TIERS.length - 1].price;
}

async function ensurePool() {
  if (_pool) return _pool;
  const { moves, learnset } = await moveDataset();
  _moves = moves;
  const ids = new Set();
  for (const idx of Object.keys(learnset)) {
    for (const m of learnset[idx].tm || []) ids.add(m);
  }
  const rows = [];
  for (const id of ids) {
    const mv = moves.moves[id];
    if (!mv || mv.effect.kind === 'unimplemented') continue; // 未实装招式不上架
    rows.push({ id, name: mv.name, type: mv.type, power: mv.effect.power || 0, price: priceOf(mv.effect.power) });
  }
  rows.sort((a, b) => a.power - b.power || a.name.localeCompare(b.name, 'zh'));
  _pool = rows;
  return rows;
}

// 今日货架：只抽还没解锁的招式
function ensureShop(pool) {
  const today = dateStr();
  if (gameData.tmShop?.date === today && Array.isArray(gameData.tmShop.ids)) return gameData.tmShop;
  const rest = pool.filter((r) => !isTmUnlocked(r.id));
  const ids = [];
  while (ids.length < TM_SHOP_DAILY && rest.length) {
    ids.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0].id);
  }
  gameData.tmShop = { date: today, ids };
  saveGame();
  return gameData.tmShop;
}

const rowOf = (id) => (_pool || []).find((r) => r.id === id);

const tmIcon = (type, cls) => `<img class="${cls || 'shop-icon'}" src="./items/${TM_ICONS[type] || 'tm/tm-normal.png'}" alt="${type}" />`;

const typeBadge = (type) =>
  `<span class="b-move-type" style="background:${TYPE_COLORS[type] || '#888'};color:${typeIconColor(type)}"><svg class="b-move-type-icon"><use xlink:href="#icon-type-${type}"></use></svg></span>`;

function buyTm(id, onBought) {
  const row = rowOf(id);
  if (!row || isTmUnlocked(id)) return;
  const candy = gameData.items['candy'] || 0;
  if (candy < row.price) {
    showConfirmBar('糖果不够', null, null, { singleButton: true });
    return;
  }
  showConfirmBar(`花费糖果 ×${row.price} 解锁「${row.name}」？能学会它的宝可梦会直接学会。`, () => {
    gameData.items['candy'] = candy - row.price;
    gameData.tmUnlocked[id] = Date.now();
    const learned = learnTmForAll(id);
    addSystemLog('tm_unlock', { move: row.name, cost: row.price, learned });
    updateBackpack('candy');
    updateStats();
    saveGame();
    markRowUnlocked(id); // 原地改这一行，不重建商店（重建会把滚动位置顶回顶部）
    onBought?.();
  });
}

// 解锁后就地更新货架：该行换成「已解锁」、标题的计数加一
function markRowUnlocked(id) {
  const box = $('shopTmBox');
  if (!box) return;
  const cell = box.querySelector(`.shop-item[data-tm="${id}"] .shop-item-right`);
  if (cell) cell.innerHTML = '<span class="shop-cost">已解锁</span>';
  const count = box.querySelector('.shop-tm-head span:last-child');
  if (count && _pool) count.textContent = `已解锁 ${_pool.filter((r) => isTmUnlocked(r.id)).length}/${_pool.length}`;
}

// 招式详情（交给商店的详情卡片渲染）
function tmDetail(id) {
  const r = rowOf(id);
  const mv = _moves && _moves.moves[id];
  if (!r || !mv) return null;
  return {
    badgeHtml: tmIcon(r.type),
    title: r.name,
    statsHtml: `<div><span>属性</span><b>${typeBadge(r.type)}</b></div>
      <div><span>类别</span><b>${catIconHtml(mv)}</b></div>
      <div><span>威力</span><b>${mv.effect.power ?? '—'}</b></div>
      <div><span>命中</span><b>${mv.accuracy == null ? '—' : mv.accuracy === 0 ? '必中' : mv.accuracy}</b></div>
      <div><span>PP</span><b>${mv.pp ?? '—'}</b></div>`,
    desc: moveDesc(mv),
  };
}

// 商店的「招式机」区块（只在兑换模式显示；异步填内容，不阻塞商店首帧）
export async function renderShopTmSection(box, { onBought, onDetail } = {}) {
  if (!box) return;
  const pool = await ensurePool();
  const shop = ensureShop(pool);
  const unlockedCount = pool.filter((r) => isTmUnlocked(r.id)).length;
  const shelf = shop.ids.map(rowOf).filter(Boolean);
  const candy = gameData.items['candy'] || 0;
  box.innerHTML = `
    <div class="shop-tm-head"><span>今日招式机</span><span>已解锁 ${unlockedCount}/${pool.length}</span></div>
    ${shelf.length ? shelf.map((r) => {
      const unlocked = isTmUnlocked(r.id);
      const canBuy = !unlocked && candy >= r.price;
      return `<div class="shop-item" data-tm="${r.id}">
        <div class="shop-item-left">
          ${tmIcon(r.type)}
          <span class="shop-item-name">${r.name}</span>
        </div>
        <div class="shop-item-right">
          ${unlocked
            ? '<span class="shop-cost">已解锁</span>'
            : `<span class="shop-cost"><img src="./items/goods/candy.png" style="width:14px;height:14px;vertical-align:middle;image-rendering:pixelated;" /> ×${r.price}</span><span class="shop-btn${canBuy ? '' : ' inert'}">解锁</span>`}
        </div>
      </div>`;
    }).join('') : `<div class="rec-empty">${pool.length && unlockedCount >= pool.length ? '全部招式机都已解锁' : '今日没有新货'}</div>`}`;
  // 点按钮解锁，点条目本身看招式详情（自己截住冒泡，避免被商店的道具兑换逻辑接走）
  box.onclick = (e) => {
    const row = e.target.closest('.shop-item[data-tm]');
    if (!row) return;
    e.stopPropagation();
    const btn = e.target.closest('.shop-btn');
    if (btn && !btn.classList.contains('inert')) {
      onDetail(null); // 关掉详情卡片，露出确认条
      buyTm(Number(row.dataset.tm), onBought);
      return;
    }
    const detail = tmDetail(Number(row.dataset.tm));
    if (detail) onDetail(detail);
  };
}
