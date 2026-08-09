// ===== 抽卡机 =====
// 走马灯滚动抽卡动画系统
// 流程: idle → rollFlip(翻面) → rolling(JS减速滚动) → locking(锁定放大) → waiting(翻开) → done(信息) → summary(十连总览)
// 十连: waiting/done 循环，每次 done→waiting 时下一张从上方滑入
import { $, showView, updateStats } from './ui.js';
import { gameData, saveGame, pushNav, addSystemLog } from './state.js';
import { GACHA_DRAW_COST, GACHA_DUP_REFUND, GACHA_TIER_WEIGHT } from './config.js';

const DRAW_COST = GACHA_DRAW_COST;
const DUP_REFUND = GACHA_DUP_REFUND;
const TIER_WEIGHT = GACHA_TIER_WEIGHT;
const ROLL_FLIP_MS = 530;
const ROLL_ITEM_W = 56; // 54px 牌宽 + 2px 间距
const LOCK_MS = 450;
const SLIDE_IN_MS = 380;

function fmtShortTime(ms) {
  const d = new Date(ms);
  return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

let _pool1 = null;
let _pool2 = null;
let _currentPool = null;
let _currentPoolId = null;
let _drawing = false;
let _results = [];               // [{ card, isNew, revealed }]
let _dealIdx = 0;
let _totalDeal = 0;
let _phase = 'idle';            // idle | rollFlip | rolling | locking | waiting | done | summary
let _actionLock = false;
let _rollState = null;          // RAF 动画状态
let _slideNext = false;         // 十连下一张是否带滑入动画

function coin() { return gameData.items['casinoCoin'] || 0; }

function ensureCards() {
  if (!gameData.collectedCards) gameData.collectedCards = {};
}

function gachaPoolStats() {
  if (!_currentPool) return '';
  const collected = gameData.collectedCards;
  const owned = _currentPool.cards.filter(c => collected[c.filename]).length;
  return `收集 ${owned}/${_currentPool.total}`;
}

// ── 空闲态走马灯（展示卡池） ──
function buildMarquee() {
  if (!_currentPool) return '';
  const poolDir = `pool${_currentPoolId}`;
  const items = _currentPool.cards.map(c =>
    `<div class="gacha-marquee-item tier-${c.tier}">
      <img src="./tcg-cards/${poolDir}/${c.tier}/${c.filename}" alt="${c.cnName}" loading="lazy" />
    </div>`
  ).join('');
  const track = items + items;
  return `<div class="gacha-marquee"><div class="gacha-marquee-track">${track}</div></div>`;
}

// ── 滚动走马灯项（含3D翻面结构） ──
// flipState: 'anim' = 翻面动画中, 'back' = 已翻面, '' = 正面
function buildRollItems(totalDeal, flipState) {
  if (!_currentPool) return '';
  const poolDir = `pool${_currentPoolId}`;
  const poolCards = _currentPool.cards;
  const count = 30;
  const flipClass = flipState === 'anim' ? ' roll-flip-in' : (flipState === 'back' ? ' flip-back' : '');

  let html = '';
  for (let i = 0; i < count; i++) {
    const rc = poolCards[Math.floor(Math.random() * poolCards.length)];
    const faceHtml = `<div class="gacha-roll-face"><img src="./tcg-cards/${poolDir}/${rc.tier}/${rc.filename}" /></div>`;

    if (totalDeal > 1) {
      // 十连：背面叠堆，容器高度统一用单卡48px，叠堆从背面 visible 溢出
      let stackHtml = '';
      for (let j = 0; j < totalDeal; j++) {
        stackHtml += `<div class="gacha-stack-card" style="top:${j * 3}px"><img src="./tcg-cards/Cardback.png" alt="?" /></div>`;
      }
      html += `<div class="gacha-roll-item gacha-roll-stack">
        <div class="gacha-roll-3d${flipClass}">
          ${faceHtml}
          <div class="gacha-roll-back">${stackHtml}</div>
        </div>
      </div>`;
    } else {
      html += `<div class="gacha-roll-item">
        <div class="gacha-roll-3d${flipClass}">
          ${faceHtml}
          <div class="gacha-roll-back"><img src="./tcg-cards/Cardback.png" alt="?" /></div>
        </div>
      </div>`;
    }
  }
  return html;
}

// ── 加载卡池 ──
async function loadPool(id) {
  try {
    const r = await fetch(`./tcg-cards/pool${id}/rarity.json`);
    if (!r.ok) return null;
    const data = await r.json();
    const cards = [];
    for (const [, set] of Object.entries(data.sets || {})) {
      for (const [filename, card] of Object.entries(set.cards || {})) {
        cards.push({ filename, ...card });
      }
    }
    // Fisher-Yates 洗牌，避免同类稀有度扎堆
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return { cards, total: data.total };
  } catch(e) { console.error('loadPool error:', e); return null; }
}

export async function showGachaView(poolId) {
  _currentPoolId = poolId;
  _results = [];
  _dealIdx = 0;
  _totalDeal = 0;
  _phase = 'idle';
  _drawing = false;
  _rollState = null;
  _slideNext = false;

  const cached = poolId === 1 ? _pool1 : _pool2;
  if (!cached) {
    _currentPool = await loadPool(poolId);
    if (poolId === 1) _pool1 = _currentPool;
    else _pool2 = _currentPool;
  } else {
    _currentPool = cached;
  }

  pushNav('gachaView');
  showView('gachaView');
  renderGacha();
}

// ════════════════════════════════════════════
//  主渲染
// ════════════════════════════════════════════

function renderGacha() {
  const box = $('gachaContent');
  if (!box) return;
  ensureCards();

  let displayHtml, actionsHtml;
  // 收集标签只在空闲态（走马灯预览页）显示
  const headerHtml = _phase === 'idle'
    ? `<div class="gacha-header">卡池${_currentPoolId} · ${gachaPoolStats()}<button class="gacha-rec-btn" id="gachaHistoryBtn">记录</button></div>`
    : '';

  switch (_phase) {
    case 'idle':
      displayHtml = `<div class="gacha-display">${buildMarquee()}</div>`;
      actionsHtml = buildIdleActions();
      break;

    case 'rollFlip':
      // 翻面动画中：显示走马灯（所有牌从正面翻到背面）
      displayHtml = `<div class="gacha-display gacha-display-roll">
        <div class="gacha-roll-container">
          <div class="gacha-roll-track" style="transform:translateX(0px)">${buildRollItems(_totalDeal, 'anim')}</div>
        </div>
      </div>`;
      actionsHtml = buildRollingActions();
      break;

    case 'rolling':
      // 滚动中：由 RAF 驱动
      displayHtml = `<div class="gacha-display gacha-display-roll">
        <div class="gacha-roll-container">
          <div class="gacha-roll-track" style="transform:translateX(0px)">${buildRollItems(_totalDeal, 'back')}</div>
        </div>
      </div>`;
      actionsHtml = buildRollingActions();
      break;

    case 'locking':
      // 锁定：其他牌淡出，目标放大
      displayHtml = buildLockingDisplay();
      actionsHtml = buildRollingActions();
      break;

    case 'waiting':
      displayHtml = buildWaitingDisplay();
      actionsHtml = `<div class="gacha-actions gacha-actions-single">
        <button class="gacha-btn" id="gachaActionBtn">翻开</button>
      </div>`;
      break;

    case 'done':
      displayHtml = buildDoneDisplay();
      actionsHtml = buildDoneActions();
      break;

    case 'summary':
      displayHtml = buildSummaryDisplay();
      actionsHtml = `<div class="gacha-actions gacha-actions-single">
        <button class="gacha-btn" id="gachaActionBtn">确定</button>
      </div>`;
      break;
  }

  box.innerHTML = `<div class="gacha-app">${headerHtml}${displayHtml}${actionsHtml}</div>`;

  // ── 事件绑定 ──
  bindEvents(box);
}

// ════════════════════════════════════════════
//  各阶段 HTML 构建
// ════════════════════════════════════════════

function buildIdleActions() {
  const balance = coin();
  const canSingle = balance >= DRAW_COST;
  const canMulti = balance >= DRAW_COST * 10;
  return `<div class="gacha-actions">
    <button class="gacha-btn" id="gachaSingle" ${canSingle ? '' : 'disabled'}>单抽 ${DRAW_COST}<img class="gacha-coin-icon" src="./items/coin.png"></button>
    <button class="gacha-btn gacha-btn-sec" id="gachaMulti" ${canMulti ? '' : 'disabled'}>十连 ${DRAW_COST * 10}<img class="gacha-coin-icon" src="./items/coin.png"></button>
  </div>`;
}

function buildRollingActions() {
  return `<div class="gacha-actions gacha-actions-single">
    <button class="gacha-btn" disabled>抽卡中…</button>
  </div>`;
}

function buildLockingDisplay() {
  // 锁定阶段：目标卡牌从走马灯位置放大出现，面朝下（单抽和十连统一用单卡放大）
  return `<div class="gacha-display" style="justify-content:center;align-items:center">
    <div class="gacha-card-wrap gacha-lock-zoom" style="width:100px">
      <img src="./tcg-cards/Cardback.png" alt="?" style="width:100%;height:auto;display:block" />
    </div>
  </div>`;
}

function buildWaitingDisplay() {
  const r = _results[_dealIdx];
  const card = r.card;
  const poolDir = `pool${_currentPoolId}`;
  const slideClass = _slideNext ? ' gacha-card-slide-in' : '';
  const displayClass = _slideNext ? ' gacha-display-slide' : '';

  return `<div class="gacha-display${displayClass}">
    <div class="gacha-card-wrap${slideClass}">
      <div class="gacha-card-inner" data-idx="${_dealIdx}">
        <div class="gacha-card-front">
          <img src="./tcg-cards/Cardback.png" alt="?" />
        </div>
        <div class="gacha-card-back tier-${card.tier}">
          <img src="./tcg-cards/${poolDir}/${card.tier}/${card.filename}" alt="${card.cnName}" onerror="this.style.display='none'" />
        </div>
      </div>
    </div>
  </div>`;
}

function buildDoneDisplay() {
  const r = _results[_dealIdx];
  const { card, revealed, isNew } = r || {};
  const poolDir = `pool${_currentPoolId}`;

  const cardHtml = `<div class="gacha-card-wrap">
    <div class="gacha-card-inner flipped" data-idx="${_dealIdx}">
      <div class="gacha-card-front">
        <img src="./tcg-cards/Cardback.png" alt="?" />
      </div>
      <div class="gacha-card-back tier-${card.tier}">
        <img src="./tcg-cards/${poolDir}/${card.tier}/${card.filename}" alt="${card.cnName}" onerror="this.style.display='none'" />
      </div>
    </div>
  </div>`;

  return `<div class="gacha-display gacha-display-revealed">
    <div style="display:flex;flex-direction:row;align-items:flex-start;gap:12px;margin:auto 0;">
      <div class="gacha-card-area">${cardHtml}</div>
      <div class="gacha-info">
        <div class="gacha-info-line gacha-info-name" style="animation-delay:0.05s">${card.cnName}</div>
        <div class="gacha-info-line gacha-info-tier" style="animation-delay:0.15s"><span class="tier-badge tier-${card.tier}">${card.tier}</span></div>
        ${isNew ? `<div class="gacha-info-line" style="animation-delay:0.25s"><span class="new-badge">NEW</span></div>` : ''}
        ${!isNew ? `<div class="gacha-info-line" style="animation-delay:0.25s"><span class="dup-badge">重复</span></div>` : ''}
      </div>
    </div>
  </div>`;
}

function buildDoneActions() {
  let btnText;
  if (_totalDeal > 1) {
    btnText = _dealIdx < _totalDeal - 1 ? '下一张' : '查看总览';
  } else {
    btnText = '确定';
  }
  return `<div class="gacha-actions gacha-actions-single">
    <button class="gacha-btn" id="gachaActionBtn">${btnText}</button>
  </div>`;
}

function buildSummaryDisplay() {
  const poolDir = `pool${_currentPoolId}`;
  let cardsHtml = '';
  _results.forEach(r => {
    const c = r.card;
    cardsHtml += `<div class="gacha-summary-card tier-${c.tier}">
      <img src="./tcg-cards/${poolDir}/${c.tier}/${c.filename}" alt="${c.cnName}" loading="lazy" onerror="this.parentElement.classList.add('err')" />
    </div>`;
  });
  return `<div class="gacha-display">
    <div class="gacha-summary-grid">${cardsHtml}</div>
  </div>`;
}

// ── 抽卡记录独立页面 ──
export function showGachaHistoryView() {
  if (!_currentPoolId) {
    import('./ui.js').then(m => m.showView('idleView'));
    return;
  }
  pushNav('gachaHistoryView');
  const content = $('gachaHistoryContent');
  if (!content) return;

  const logs = gameData.gachaLogs[_currentPoolId] || [];
  const tierOrder = ['SR', 'R', 'N'];
  const tierCount = {};
  let newCount = 0;
  logs.forEach(l => {
    tierCount[l.tier] = (tierCount[l.tier] || 0) + 1;
    if (l.isNew) newCount++;
  });
  const partStats = tierOrder.filter(t => tierCount[t]).map(t => `${t}:${tierCount[t]}`).join('  ');
  content.innerHTML = `
    <div style="border-bottom:1px solid var(--ui-color);margin-bottom:3px;font-size:10px;">卡池${_currentPoolId} · ${logs.length} 抽 · 新卡 ${newCount} · ${partStats}</div>
    ${logs.length === 0 ? '<div style="padding:12px 4px;text-align:center;">暂无抽卡记录</div>' : ''}
    ${logs.map(l => {
    const time = fmtShortTime(l.time);
    const tierLabel = `<span style="font-size:8px;padding:0 3px;border-radius:2px;color:#fff;margin:0 8px;min-width:18px;text-align:center;display:inline-block;background:${l.tier==='SR'?'#d4850a':l.tier==='R'?'#4477cc':'#7a8a8a'}">${l.tier}</span>`;
    const newLabel = l.isNew
      ? '<span style="margin-left:14px;color:#4c8d73">NEW</span>'
      : '<span style="margin-left:14px;opacity:0.35">重复</span>';
    return `<div style="font-size:10px;line-height:1.8;padding:1px 0;display:flex;align-items:baseline;">
        <span style="opacity:0.6;margin-right:12px;flex-shrink:0;">${time}</span>
        ${tierLabel}<span style="flex:1;">${l.cnName}</span>
        <span style="flex-shrink:0;margin-left:14px;">${newLabel}</span>
      </div>`;
  }).join('')}
  `;

  showView('gachaHistoryView');
}

// ════════════════════════════════════════════
//  事件绑定
// ════════════════════════════════════════════

function bindEvents(box) {
  switch (_phase) {
    case 'idle':
      $('gachaSingle')?.addEventListener('click', () => doDraw(1));
      $('gachaMulti')?.addEventListener('click', () => doDraw(10));
      $('gachaHistoryBtn')?.addEventListener('click', () => {
        showGachaHistoryView();
      });
      break;

    case 'rollFlip':
      // 翻面动画结束后 → 进入滚动阶段
      setTimeout(() => {
        _phase = 'rolling';
        renderGacha();
      }, ROLL_FLIP_MS);
      break;

    case 'rolling':
      // RAF 由 startRolling 启动
      startRollAnimation();
      break;

    case 'locking':
      // 锁定动画结束后 → waiting
      setTimeout(() => {
        _phase = 'waiting';
        _slideNext = false;
        renderGacha();
      }, LOCK_MS);
      break;

    case 'waiting':
      box.querySelector('.gacha-card-inner')?.addEventListener('click', (e) => {
        const el = e.currentTarget;
        onCardFlip(el);
      });
      $('gachaActionBtn')?.addEventListener('click', () => {
        const inner = box.querySelector('.gacha-card-inner:not(.flipped)');
        if (inner) onCardFlip(inner);
      });
      break;

    case 'done':
      $('gachaActionBtn')?.addEventListener('click', onActionBtn);
      break;

    case 'summary':
      $('gachaActionBtn')?.addEventListener('click', () => {
        _phase = 'idle';
        _results = [];
        _dealIdx = 0;
        _totalDeal = 0;
        _drawing = false;
        _slideNext = false;
        updateStats();
        renderGacha();
      });
      break;
  }
}

// ════════════════════════════════════════════
//  JS 驱动减速滚动动画
// ════════════════════════════════════════════

function startRollAnimation() {
  const container = document.querySelector('#gachaContent .gacha-roll-container');
  const track = document.querySelector('#gachaContent .gacha-roll-track');
  if (!container || !track) return;

  const containerW = container.clientWidth;
  const itemCount = 30;

  // 目标索引：从中间区域随机选，保证最终锁定牌在可视区中央附近
  const midStart = Math.floor(itemCount * 0.35);
  const midEnd = Math.floor(itemCount * 0.65);
  const targetIdx = midStart + Math.floor(Math.random() * (midEnd - midStart));

  // 初始速度：每秒跑 ~12 个牌 (~480px/s)，decay 0.985 → 约 4.5s 减速到位
  _rollState = {
    rafId: null,
    position: 0,
    velocity: 12,
    decay: 0.985,
    itemCount,
    containerW,
    targetIdx,
    locked: false,
  };

  _rollState.rafId = requestAnimationFrame(rollTick);
}

function rollTick() {
  if (!_rollState || _rollState.locked) return;
  const rs = _rollState;

  // 安全检查：如果抽卡视图已不可见，停止动画
  const track = document.querySelector('#gachaContent .gacha-roll-track');
  if (!track) {
    _rollState = null;
    return;
  }

  rs.position += rs.velocity;
  rs.velocity *= rs.decay;

  track.style.transform = `translateX(${-rs.position}px)`;

  if (rs.velocity < 0.2) {
    // 锁定：计算当前最接近中央的牌
    doLock();
  } else {
    rs.rafId = requestAnimationFrame(rollTick);
  }
}

function doLock() {
  if (!_rollState) return;
  const rs = _rollState;
  cancelAnimationFrame(rs.rafId);
  rs.locked = true;

  // 找最接近视口中央的牌索引
  const centerPx = rs.containerW / 2;
  const centerIdx = Math.round((rs.position + centerPx - ROLL_ITEM_W / 2) / ROLL_ITEM_W);
  const clampedIdx = ((centerIdx % rs.itemCount) + rs.itemCount) % rs.itemCount;

  // 吸附到该牌中央
  const snapPos = clampedIdx * ROLL_ITEM_W - centerPx + ROLL_ITEM_W / 2;
  const track = document.querySelector('#gachaContent .gacha-roll-track');
  if (track) {
    track.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    track.style.transform = `translateX(${-snapPos}px)`;
  }

  // 吸附完成后 → 锁定阶段
  setTimeout(() => {
    _phase = 'locking';
    _rollState = null;
    renderGacha();
  }, 350);
}

// ════════════════════════════════════════════
//  抽卡逻辑
// ════════════════════════════════════════════

function drawOne() {
  const r = Math.random() * 100;
  let tier;
  if (r < TIER_WEIGHT.SR) tier = 'SR';
  else if (r < TIER_WEIGHT.SR + TIER_WEIGHT.R) tier = 'R';
  else tier = 'N';

  const candidates = _currentPool.cards.filter(c => c.tier === tier);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function doDraw(count) {
  if (_drawing || !_currentPool) return;
  if (coin() < DRAW_COST * count) return;

  _drawing = true;
  _results = [];
  _dealIdx = 0;
  _totalDeal = count;
  _slideNext = false;

  const totalCost = DRAW_COST * count;
  gameData.items['casinoCoin'] -= totalCost;
  ensureCards();
  updateStats();

  for (let i = 0; i < count; i++) {
    const card = drawOne();
    if (!card) continue;
    const isNew = !gameData.collectedCards[card.filename];
    if (isNew) {
      gameData.collectedCards[card.filename] = { tier: card.tier, cnName: card.cnName, enName: card.enName, obtainedAt: Date.now() };
    } else {
      gameData.items['casinoCoin'] += DUP_REFUND;
    }
    // 抽卡欧气累计：SR 新卡最高，N 重复最低（独立累计，不受 50 条日志窗口影响）
    const scoreMap = { SR: isNew ? 52 : 48, R: isNew ? 32 : 30, N: isNew ? 24 : 22 };
    gameData.stats.luckyGachaScore = (gameData.stats.luckyGachaScore || 0) + (scoreMap[card.tier] || 24);
    gameData.stats.luckyGachaCount = (gameData.stats.luckyGachaCount || 0) + 1;
    _results.push({ card, isNew, revealed: false });
    addSystemLog('gacha', { pool: _currentPoolId, card: card.filename, cnName: card.cnName, tier: card.tier, isNew });
    // 记录到抽卡历史
    if (!gameData.gachaLogs[_currentPoolId]) gameData.gachaLogs[_currentPoolId] = [];
    gameData.gachaLogs[_currentPoolId].unshift({ time: Date.now(), card: card.filename, tier: card.tier, cnName: card.cnName, isNew });
    // 保留最近50条
    if (gameData.gachaLogs[_currentPoolId].length > 50) gameData.gachaLogs[_currentPoolId].length = 50;
  }
  await saveGame();

  // 翻面动画 → 滚动
  _phase = 'rollFlip';
  renderGacha();
}

// ════════════════════════════════════════════
//  翻牌 & 按钮交互
// ════════════════════════════════════════════

function onCardFlip(el) {
  if (_phase !== 'waiting') return;
  if (_actionLock) return;
  _actionLock = true;
  setTimeout(() => { _actionLock = false; }, 400);

  const idx = Number(el.dataset.idx);
  if (isNaN(idx) || _results[idx].revealed) return;
  _results[idx].revealed = true;
  _phase = 'done';
  el.classList.add('flipped');

  // 翻面动画 520ms 后显示信息面板
  setTimeout(() => renderGacha(), 520);
}

function onActionBtn() {
  if (_actionLock) return;
  _actionLock = true;
  setTimeout(() => { _actionLock = false; }, 400);

  if (_phase === 'done') {
    if (_totalDeal > 1 && _dealIdx < _totalDeal - 1) {
      // 十连：下一张 → waiting（带滑入动画）
      _dealIdx++;
      _phase = 'waiting';
      _slideNext = true;
      renderGacha();
    } else if (_totalDeal > 1) {
      // 十连最后一张 → 总览
      _phase = 'summary';
      updateStats();
      renderGacha();
    } else {
      // 单抽 → 回到 idle
      _phase = 'idle';
      _results = [];
      _dealIdx = 0;
      _totalDeal = 0;
      _drawing = false;
      updateStats();
      renderGacha();
    }
  }
}
