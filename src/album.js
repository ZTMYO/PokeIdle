// ===== 卡册 =====
// 翻页式缩略图网格，点击已拥有卡牌放大到屏幕中心，点击遮罩关闭。
import { $, showView } from './ui.js';
import { gameData, pushNav } from './state.js';

const CARDS_PER_PAGE = 12;  // 4列 × 3行

let _allCards = [];      // 所有卡片（含 poolId）
let _currentPage = 0;
let _loaded = false;

async function loadPools() {
  if (_loaded) return;
  _allCards = [];
  for (const pid of [1, 2]) {
    try {
      const r = await fetch(`./tcg-cards/pool${pid}/rarity.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      for (const [, set] of Object.entries(data.sets || {})) {
        for (const [filename, card] of Object.entries(set.cards || {})) {
          _allCards.push({
            filename, tier: card.tier, cnName: card.cnName, enName: card.enName,
            poolId: pid, poolDir: `pool${pid}`,
          });
        }
      }
      console.log(`[album] pool${pid} 加载成功: ${data.total} 张`);
    } catch(e) { console.error(`[album] pool${pid} 加载失败:`, e); }
  }
  const tierOrder = { SR: 0, R: 1, N: 2 };
  _allCards.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);
  _loaded = true;
}

function ensureCards() {
  if (!gameData.collectedCards) gameData.collectedCards = {};
}

// 卡册收集统计（统计页「游戏厅战绩」使用）：返回 { owned, total }
export async function getCardCollectionStats() {
  ensureCards();
  await loadPools();
  const collected = gameData.collectedCards;
  const owned = _allCards.filter(c => collected[c.filename]).length;
  return { owned, total: _allCards.length };
}

export async function showAlbumView() {
  pushNav('albumView');
  showView('albumView');
  ensureCards();
  await loadPools();
  _currentPage = 0;
  renderAlbum();
}

// ── 放大预览 ──

// 获得时间格式化：YYYY-MM-DD HH:mm
function fmtObtained(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openPreview(filename) {
  closePreview();
  const card = _allCards.find(c => c.filename === filename);
  if (!card) return;
  const info = gameData.collectedCards[filename] || {};
  const imgSrc = `./tcg-cards/${card.poolDir}/${card.tier}/${filename}`;
  const overlay = document.createElement('div');
  overlay.className = 'album-overlay';
  overlay.innerHTML = `
    <div class="album-overlay-stage">
      <img class="album-overlay-card" src="${imgSrc}" alt="${info.cnName || card.cnName}" />
    </div>
    <div class="album-overlay-meta">
      <div class="album-overlay-name">${info.cnName || card.cnName}</div>
      ${info.obtainedAt ? `<div class="album-overlay-time">获得于 ${fmtObtained(info.obtainedAt)}</div>` : ''}
    </div>`;
  overlay.addEventListener('click', closePreview);

  // 3D 倾斜效果
  const cardEl = overlay.querySelector('.album-overlay-card');
  overlay.addEventListener('mousemove', e => {
    const rect = cardEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;   // -0.5 ~ 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5;    // -0.5 ~ 0.5
    cardEl.style.transform = `perspective(800px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
    cardEl.style.transition = 'none';
  });
  overlay.addEventListener('mouseleave', () => {
    cardEl.style.transform = 'perspective(800px) rotateY(0deg) rotateX(0deg)';
    cardEl.style.transition = 'transform 0.35s ease-out';
  });

  $('albumContent')?.appendChild(overlay);
}

function closePreview() {
  document.querySelector('.album-overlay')?.remove();
}

// ── 渲染 ──

function renderAlbum() {
  const box = $('albumContent');
  if (!box) return;
  ensureCards();

  const collected = gameData.collectedCards;
  const totalPages = Math.ceil(_allCards.length / CARDS_PER_PAGE) || 1;
  const start = _currentPage * CARDS_PER_PAGE;
  const pageCards = _allCards.slice(start, start + CARDS_PER_PAGE);

  const pool1Owned = _allCards.filter(c => c.poolId === 1 && collected[c.filename]).length;
  const pool2Owned = _allCards.filter(c => c.poolId === 2 && collected[c.filename]).length;
  const pool1Total = _allCards.filter(c => c.poolId === 1).length;
  const pool2Total = _allCards.filter(c => c.poolId === 2).length;

  let html = `<div class="album-app">
    <div class="album-stats">
      <span>1号卡池 ${pool1Owned}/${pool1Total}</span>
      <span>2号卡池 ${pool2Owned}/${pool2Total}</span>
    </div>
    <div class="album-grid">`;

  for (const card of pageCards) {
    const isOwned = !!collected[card.filename];
    const imgSrc = isOwned
      ? `./tcg-cards/${card.poolDir}/${card.tier}/${card.filename}`
      : `./tcg-cards/Cardback.png`;
    html += `<div class="album-card tier-${card.tier} ${isOwned ? 'owned' : 'locked'}"
      ${isOwned ? `data-preview="${card.filename}"` : ''}>
      <img src="${imgSrc}" alt="${isOwned ? card.cnName : '?'}" loading="lazy" onerror="this.parentElement.classList.add('err')" />
    </div>`;
  }

  html += `</div>
    ${totalPages > 1 ? `<div class="album-dots">${Array.from({length: totalPages}, (_, i) =>
      `<span class="album-dot${i === _currentPage ? ' active' : ''}" data-page="${i}"></span>`
    ).join('')}</div>` : ''}
  </div>`;

  box.innerHTML = html;

  // 翻页
  box.querySelectorAll('.album-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      _currentPage = Number(dot.dataset.page);
      renderAlbum();
    });
  });

  // 点击已拥有卡片 → 放大
  box.querySelectorAll('.album-card.owned').forEach(el => {
    const filename = el.dataset.preview;
    if (filename) el.addEventListener('click', (e) => { e.stopPropagation(); openPreview(filename); });
  });

  // 触摸滑动翻页
  let touchStartX = 0;
  const pageEl = box.querySelector('.album-grid');
  if (pageEl && totalPages > 1) {
    pageEl.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    pageEl.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) {
        if (dx < 0 && _currentPage < totalPages - 1) _currentPage++;
        else if (dx > 0 && _currentPage > 0) _currentPage--;
        renderAlbum();
      }
    });
  }

  // 鼠标滚轮翻页
  box.querySelector('.album-app')?.addEventListener('wheel', e => {
    if (totalPages <= 1) return;
    e.preventDefault();
    if (e.deltaY > 0 && _currentPage < totalPages - 1) _currentPage++;
    else if (e.deltaY < 0 && _currentPage > 0) _currentPage--;
    else return;
    renderAlbum();
  }, { passive: false });
}
