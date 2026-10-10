// ===== 随从系统 =====
// 糖果抽卡：抽出一只宝可梦限时跟随，到期即走；同时只能跟 1 只。
// 属性归类到 9 大增益类，同类去重，双属性两类同时生效、不减半
import { FOLLOWER_DRAW_COST, FOLLOWER_TIER_CHANCE, FOLLOWER_TIER_BOOST, FOLLOWER_MAIN, FOLLOWER_STAR_MIN, FOLLOWER_EFFECTS, FOLLOWER_TIER_ROMAN, FOLLOWER_TYPE_GROUP, FOLLOWER_GROUP_BOOST } from './config.js';
import { gameData, allPokemon, getPokemonByIndex, phase, saveGame, pushNav, popNav } from './state.js';
import { $, showView, isOnGameView, updateBackpack, updateStats, tryLoadImage, tryLoadPokemonIcon, consoleLayerStyle } from './ui.js';
import { TYPE_COLORS } from './items.js';
import * as road from './road.js';

// 走路帧序 1-7-2-7（1-indexed）→ 0-indexed；随从没有跑/骑动作，只加快帧率
const FOLLOWER_FRAME_SEQ = [0, 6, 1, 6];
const FOLLOWER_STEP_MS = { walk: 150, run: 112, bike: 62 }; // 由主角 0.6s/0.45s/0.25s 循环 ÷4 帧得来
const FOLLOWER_TIER_LABEL = { N: '常见', R: '稀有', SR: '超稀有', UR: '传说' };
let _followerAnimRaf = null;
let _followerEl = null;       // 跟随宝可梦 DOM 元素
let _followerFrame = 0;       // 当前帧索引（FOLLOWER_FRAME_SEQ 下标）
let _followerLastSwap = 0;    // 上次换帧时间
let _followerFrameCount = 1;  // 总帧数（由图片宽度决定）

// 按主角步态返回随从换帧间隔（毫秒）
function followerStepMs() {
  const s = road.getSpeed();
  if (road.isBike()) return FOLLOWER_STEP_MS.bike;
  if (s >= 1.0) return FOLLOWER_STEP_MS.run;
  return FOLLOWER_STEP_MS.walk;
}

// ===== 卡池 =====
// 稀有度分桶：<0.4 / 0.4~0.6 / 0.6~0.8 / ≥0.8
function tierOfRarity(r) { return r < 0.4 ? 'N' : r < 0.6 ? 'R' : r < 0.8 ? 'SR' : 'UR'; }

// 只有编号 ≤ 649 的宝可梦带走路动画，卡池只收这批
function getFollowerPool() {
  return (allPokemon || []).filter(p => {
    const idx = Number(p.index);
    return idx >= 1 && idx <= 649;
  });
}

// 按稀有度概率抽一个档位
function rollTier() {
  const r = Math.random();
  let acc = 0;
  for (const [tier, chance] of Object.entries(FOLLOWER_TIER_CHANCE)) {
    acc += chance;
    if (r < acc) return tier;
  }
  return 'UR'; // 兜底
}

// 先按概率定档，再从该档的池子里均匀抽一只
function drawCard() {
  const pool = getFollowerPool();
  if (pool.length === 0) return null;
  const tier = rollTier();
  const tierPool = pool.filter(p => tierOfRarity(p.rarity || 0) === tier);
  const actualPool = tierPool.length > 0 ? tierPool : pool;
  const poke = actualPool[Math.floor(Math.random() * actualPool.length)];
  return {
    index: String(poke.index).padStart(4, '0'),
    name: poke.name,
    tier,
    types: poke.types || [],
  };
}

// 属性 → 增益类别（9 大类，双属性去重后可能只有一类）
function getFollowerGroups(types) {
  const ts = Array.isArray(types) && types.length > 0 ? types : ['一般'];
  const groups = [];
  for (const t of ts) {
    const g = FOLLOWER_TYPE_GROUP[t];
    if (g && !groups.includes(g)) groups.push(g);
  }
  return groups.length > 0 ? groups : ['catch'];
}

// 每个类别一对 tag：主增益固定文案 + 副增益带稀有度罗马数字（同类只出一对）
function followerGainTagsHtml(types, boostPct, tier) {
  const list = (types && types.length) ? types : ['一般'];
  const groups = [];
  for (const t of list) {
    const g = FOLLOWER_TYPE_GROUP[t] || 'catch';
    if (!groups.includes(g)) groups.push(g);
  }
  const roman = FOLLOWER_TIER_ROMAN[tier] || '';
  return groups.map(g => {
    const e = FOLLOWER_EFFECTS[g];
    return `<span class="follower-effect-tag main" data-tip="${e.main}">${e.tag}</span>`
      + `<span class="follower-effect-tag sub" data-tip="${e.sub(boostPct)}">${e.subTag}${roman ? ' ' + roman : ''}</span>`;
  }).join('');
}

// 增益幅度只看稀有度档位（双属性不叠加、不减半）
function getEffectiveBoost(tier) {
  return FOLLOWER_TIER_BOOST[tier] || 0;
}

// 当前活跃随从；已过期就地清理并返回 null
function getActiveBoost() {
  const f = gameData?.follower;
  if (!f || !f.endsAt) return null;
  if (Date.now() >= f.endsAt) {
    // 过期清理走内存路径（调 stopFollower 会与全局 hook 互相递归）
    gameData.follower = null;
    saveGame();
    removeFollowerFromRoad();
    syncFollowerBoostHook();
    return null;
  }
  return {
    groups: f.groups || [],
    tier: f.tier,
    boost: f.boost || 0,        // 每类增益幅度
    endsAt: f.endsAt,
  };
}

function startFollower(poke, tier, groups) {
  const star = followerDexInfo(poke.index).star;      // 星级来自随从图鉴的抽到次数
  const endsAt = Date.now() + followerDurMs(poke.index);
  gameData.follower = {
    index: poke.index,
    name: poke.name,
    tier,
    groups,
    star,
    boost: getEffectiveBoost(tier),
    endsAt,
  };
  saveGame();
  syncFollowerBoostHook();
  renderFollowerOnRoad();
  if ($('followerView')?.style.display === 'flex') renderFollowerView();
  // 交换列表的闪光在生成时就定了，装配 trade 类随从要强制刷新一波
  if (groups.includes('trade')) {
    import('./trade.js').then(m => {
      m.refreshTrades();
      // 交换页正开着时同步重渲染列表（倒计时文本会被 renderTrade 重建，但 ensureTrades 不再重生成）
      if (document.getElementById('tradeView')?.style.display !== 'none') m.renderTrade();
    });
  }
}

function stopFollower() {
  gameData.follower = null;
  syncFollowerBoostHook();
  removeFollowerFromRoad();
  saveGame();
  if ($('followerView')?.style.display === 'flex') renderFollowerView();
}

function expireFollower() {
  gameData.follower = null;
  saveGame();
  syncFollowerBoostHook();
  removeFollowerFromRoad();
}

// 机制分两类：主效果（固定幅度，见 FOLLOWER_MAIN）与副效果（按稀有度幅度放大）
const FOLLOWER_FLAG_MECHS = new Set(['expCandyGuarantee', 'tradeOfferBonus', 'extraFishingItem']);

// 机制级钩子：各游戏机制调 __followerBoostMechanic('berryGrow', base)，
// 随从生效时返回放大后的值，否则返回 base 原值
function syncFollowerBoostHook() {
  if (typeof window === 'undefined') return;
  window.__followerBoostMechanic = (mechanic, base) => {
    const act = getActiveBoost();
    if (!act) return base;
    const boost = act.boost || 0;
    const has = (act.groups || []).some(g => (FOLLOWER_GROUP_BOOST[g] || []).includes(mechanic));
    if (!has) return base;
    // 主效果：固定幅度（与稀有度无关）
    if (FOLLOWER_FLAG_MECHS.has(mechanic)) return 1;                         // 固定档：活跃即成立（必定掉糖果 / 多一件 / 多挂一个）
    if (mechanic === 'itemDropExtra') return FOLLOWER_MAIN.itemExtraChance;
    if (mechanic === 'extraBerry') return FOLLOWER_MAIN.berryExtraChance;
    if (mechanic === 'twistDexWeight') return FOLLOWER_MAIN.twistDexMult;
    if (mechanic === 'massShinyRate') return base * FOLLOWER_MAIN.massShinyMult;
    if (mechanic === 'mysteryEggRate') return base * (1 + FOLLOWER_MAIN.mysteryEggBonus);
    if (mechanic === 'bikeSpeed') return base * (1 + FOLLOWER_MAIN.bikeSpeedBonus);
    // 特殊路段：水系把倾向推到水域，飞行/妖精推到自行车道
    if (mechanic === 'roadWaterPref') {
      return act.groups.includes('fishing') ? FOLLOWER_MAIN.roadWaterPref : 1 - FOLLOWER_MAIN.roadWaterPref;
    }
    // 副效果：按幅度放大，减益方向的两条（逃跑率 / 孵蛋里程）取反
    if (mechanic === 'fleeRate' || mechanic === 'hatchDist') return Math.max(0, base * (1 - boost));
    return base * (1 + boost);
  };
}

// ===== 随从图鉴（只记收藏，不产生永久能力）=====
// 只记次数，星级 = min(5, 次数)，只影响任期时长
function followerStar(count) { return Math.max(1, Math.min(5, Math.round(count) || 1)); }
function followerDexCount() { return Object.keys(gameData?.followerDex || {}).length; }
function followerDexInfo(index) {
  const e = (gameData?.followerDex || {})[String(index)];
  const count = (e && e.count) || 0;
  return { count, star: followerStar(Math.max(1, count)) };
}
// 抽出即记账（与最后带哪只走无关）；返回值供结果页显示星级
function recordFollowerDraw(index) {
  if (!gameData.followerDex) gameData.followerDex = {};
  const key = String(index);
  const e = gameData.followerDex[key] || (gameData.followerDex[key] = { count: 0 });
  e.count += 1;
  return { count: e.count, star: followerStar(e.count) };
}
// 任期时长（毫秒）：按星级查表，稀有度不影响时长
function followerDurMs(index) {
  const star = followerDexInfo(index).star;
  return FOLLOWER_STAR_MIN[star - 1] * 60000;
}
// 结算界面用多颗星表达星级（图鉴页仍用 ★N）
function starIcons(star) { return '★'.repeat(Math.max(1, star || 1)); }
// 图鉴入口只绑一次
function bindFollowerDexBtn() {
  const btn = $('followerDexBtn');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', showFollowerDexView);
}

// ===== 随从视图（手机 App）=====
export function showFollowerView() {
  pushNav('followerView');
  showView('followerView');
  bindFollowerDexBtn();
  if (gameData?.followerPending && !gameData?.follower) {
    // 有待处理结果：装回内存展示结果页（重启恢复场景）
    restorePendingFollower();
  } else {
    // 正常进入：回到空闲态，避免残留上一轮的滚动/锁定动画
    _drawPhase = 'idle';
    _drawResult = null;
  }
  renderFollowerView();
}

function renderFollowerView() {
  const content = $('followerContent');
  if (!content) return;
  stopMoveAnim();
  const f = gameData?.follower;
  const pool = getFollowerPool();

  if (f) {
    // 有随从跟随中：展示当前随从 + 倒计时 + 送走
    const poke = f.index ? getPokemonByIndex(f.index) : null;
    const remain = Math.max(0, f.endsAt - Date.now());
    const totalSec = Math.floor(remain / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const groups = f.groups || [];
    const boostPct = Math.round((f.boost || 0) * 100);
    const types = poke?.types || [];
    const movePath = `./pokemon-data/pokemon-move/${f.index}-${f.name}.png`;

    content.innerHTML = `
      <div class="follower-display">
        <div class="follower-display-inner">
          <div class="follower-card-col">
            <div class="follower-card-area">
              <img class="follower-big-img" id="followerAnimImg" src="${movePath}" alt="${f.name}">
            </div>
            <div class="follower-time-line">剩余：<span id="followerCountdown">${min}分${sec}秒</span></div>
          </div>
          <div class="follower-info">
            <div class="follower-info-name">${f.name}</div>
            <div class="follower-info-line"><span class="tier-badge tier-${f.tier} follower-tier-badge">${FOLLOWER_TIER_LABEL[f.tier] || f.tier}</span>${f.star ? `<span style="font-weight:700;">${starIcons(f.star)}</span>` : ''}</div>
            <div class="follower-info-line">${typeBadgesHtml(types)}</div>
            <div class="follower-info-line follower-effect-row">${followerGainTagsHtml(types, boostPct, f.tier)}</div>
          </div>
        </div>
      </div>
      <div class="follower-actions">
        <button class="gacha-btn" id="followerDismissBtn">送走</button>
      </div>`;
    const animImg = $('followerAnimImg');
    if (animImg) tryLoadImage(animImg, movePath).then(ok => { if (ok) startMoveAnim(animImg, 150); });
    const dismissBtn = $('followerDismissBtn');
    if (dismissBtn) dismissBtn.addEventListener('click', stopFollower);
    // 倒计时只刷新文本，避免整页重渲染打断帧动画
    if (renderFollowerView._timer) return;
    renderFollowerView._timer = setInterval(() => {
      if ($('followerView')?.style.display !== 'flex') {
        clearInterval(renderFollowerView._timer);
        renderFollowerView._timer = null;
        return;
      }
      if (gameData?.follower && Date.now() >= gameData.follower.endsAt) {
        // 倒计时结束：清理随从并直接恢复抽卡页面
        clearInterval(renderFollowerView._timer);
        renderFollowerView._timer = null;
        expireFollower();
        renderFollowerView();
        return;
      }
      if (!gameData?.follower) {
        clearInterval(renderFollowerView._timer);
        renderFollowerView._timer = null;
        renderFollowerView();
        return;
      }
      const cd = $('followerCountdown');
      if (cd) {
        const r = Math.max(0, gameData.follower.endsAt - Date.now());
        const ts = Math.floor(r / 1000);
        cd.textContent = `${Math.floor(ts / 60)}分${ts % 60}秒`;
      }
    }, 1000);
  } else {
    // 无随从：按抽卡阶段展示（结果页 / 走马灯预览 / 滚动抽卡 / 锁定放大）
    if (_drawPhase === 'result' && _drawResult) {
      // 待处理结果：直接展示结果页（刚抽完或重启恢复）
      renderDrawResult(_drawResult, getFollowerGroups(_drawResult.types));
    } else if (_drawPhase === 'rolling') {
      content.innerHTML = `
        <div class="gacha-display gacha-display-roll">
          <div class="gacha-roll-container">
            <div class="gacha-roll-track" id="followerRollTrack" style="transform:translateX(0px)"></div>
          </div>
        </div>
        <div class="follower-actions"><button class="gacha-btn" disabled>抽取中…</button></div>`;
      startFollowerRoll();
    } else if (_drawPhase === 'locking') {
      const movePath = `./pokemon-data/pokemon-move/${_drawResult.index}-${_drawResult.name}.png`;
      // 锁定阶段：图片挂全屏 overlay 上自由放大平移，不被容器裁剪；卡片区只用来量坐标。
      // 布局与结果页一致（右侧信息占位透明），动画结束无跳变
      const lockGroups = getFollowerGroups(_drawResult.types);
          const boostPct = Math.round(getEffectiveBoost(_drawResult.tier) * 100);
      content.innerHTML = `
        <div class="follower-display" id="followerLockDisplay">
          <div class="follower-display-inner">
            <div class="follower-card-col" style="visibility:hidden">
              <div class="follower-card-area" id="followerLockArea" style="background:transparent"></div>
              <div class="follower-time-line">时长：${Math.round(followerDurMs(_drawResult.index) / 60000)} 分钟</div>
            </div>
            <div class="follower-info" style="visibility:hidden">
              <div class="follower-info-name">${_drawResult.name}</div>
              <div class="follower-info-line"><span class="tier-badge tier-${_drawResult.tier} follower-tier-badge">${FOLLOWER_TIER_LABEL[_drawResult.tier] || _drawResult.tier}</span><span style="font-weight:700;">${starIcons((_drawResult.dex || followerDexInfo(_drawResult.index)).star)}</span></div>
              <div class="follower-info-line">${typeBadgesHtml(_drawResult.types)}</div>
              <div class="follower-info-line follower-effect-row">${followerGainTagsHtml(_drawResult.types, boostPct, _drawResult.tier)}</div>
            </div>
          </div>
        </div>
        <div class="follower-actions"><button class="gacha-btn" disabled>抽取中…</button></div>`;
      const overlay = document.createElement('div');
      overlay.id = 'followerLockOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:visible;';
      // 手游双屏：铺在机身上的缩放画布，层内沿用机身逻辑坐标
      const layer = consoleLayerStyle();
      if (layer) {
        overlay.style.inset = 'auto';
        Object.assign(overlay.style, layer);
      }
      overlay.innerHTML = `
        <div class="follower-lock-ghosts" id="followerLockGhosts"></div>
        <div id="followerLockWrap" style="position:absolute;width:80px;height:80px;display:flex;align-items:center;justify-content:center;opacity:0">
          <img id="followerLockImg" src="${movePath}" style="width:32px;height:32px;object-fit:none;object-position:0px 0px;transform:scale(2.5);image-rendering:pixelated;display:none">
        </div>`;
      document.body.appendChild(overlay);
      const lockWrap = $('followerLockWrap');
      const lockImg = $('followerLockImg');
      const lockArea = $('followerLockArea');
      if (lockImg) tryLoadImage(lockImg, movePath).then(ok => {
        if (ok && lockImg.naturalWidth && lockImg.naturalHeight) {
          lockImg.style.display = '';
        }
      });
      // 渲染完成后量坐标：wrap 定位到卡片区，transform 从显示区中心放大，再平移归位
      requestAnimationFrame(() => {
        const display = $('followerLockDisplay');
        const ghosts = $('followerLockGhosts');
        if (!lockWrap || !display || !lockArea) return;
        const dRect = display.getBoundingClientRect();
        const cRect = lockArea.getBoundingClientRect();
        const dx = (dRect.left + dRect.width / 2) - (cRect.left + cRect.width / 2);
        const dy = (dRect.top + dRect.height / 2) - (cRect.top + cRect.height / 2);
        lockWrap.style.left = cRect.left + 'px';
        lockWrap.style.top = cRect.top + 'px';
        // 残影容器对齐到随从页所在的那块屏，移出即被裁掉
        if (ghosts) {
          const screenEl = $('followerView')?.closest('.screen') || document.querySelector('.screen');
          let sLeft = 0, sTop = 0;
          if (screenEl) {
            const sRect = screenEl.getBoundingClientRect();
            sLeft = sRect.left;
            sTop = sRect.top;
            ghosts.style.left = sRect.left + 'px';
            ghosts.style.top = sRect.top + 'px';
            ghosts.style.width = sRect.width + 'px';
            ghosts.style.height = sRect.height + 'px';
            ghosts.style.setProperty('--follower-ghost-dist', sRect.width + 'px');
          }
          // 残影：用滚动停止时与目标相邻的真实格（目标左右各若干），保持与滚动现场一致
          const adj = (offs) => {
            const items = [];
            for (const o of offs) {
              const idx = _rollTargetIdx + o;
              if (idx >= 0 && idx < _rollItems.length) items.push(_rollItems[idx]);
            }
            return items;
          };
          const leftItems = adj([-1, -2, -3, -4]).reverse();
          const rightItems = adj([1, 2, 3, 4]);
          const mk = (items) => items.map(p => {
            return `<div class="follower-lock-ghost"><img data-src="./pokemon-data/pokemon-move/${String(p.index).padStart(4,'0')}-${p.name}.png" alt="${p.name}"></div>`;
          }).join('');
          // 残影行以显示区中心为锚点；中间留目标格空位，左右两排从两侧散开
          ghosts.innerHTML = `
            <div class="follower-lock-mid" style="left:${(dRect.left + dRect.width / 2 - sLeft)}px;top:${(dRect.top + dRect.height / 2 - sTop)}px">
              <div class="follower-lock-row is-left">${mk(leftItems)}</div>
              <div class="follower-lock-holder"></div>
              <div class="follower-lock-row is-right">${mk(rightItems)}</div>
            </div>`;
          animateMoveImgs(ghosts, 'img');
        }
        // 分两步：先在显示区中央原地放大，再向左平移到卡片区位置。
        // 用双 rAF 保证初始态先渲染，过渡不会跳变
        lockWrap.style.transition = 'none';
        lockWrap.style.transform = `translate(${dx}px, ${dy}px) scale(0.3)`;
        lockWrap.style.opacity = '0';
        requestAnimationFrame(() => {
          lockWrap.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease';
          lockWrap.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
          lockWrap.style.opacity = '1';
          setTimeout(() => {
            lockWrap.style.transition = 'transform 0.35s cubic-bezier(0.33, 0, 0.2, 1)';
            lockWrap.style.transform = 'translate(0, 0) scale(1)';
            // 平移动画末尾才淡入卡片背景，避免提前露出圆角
            setTimeout(() => {
              lockArea.style.transition = 'background 0.3s ease';
              lockArea.style.background = '';
            }, 300);
          }, 420);
        });
      });
      // 移除 overlay 并切结果页（图已停在卡片区，无跳变）
      setTimeout(() => {
        overlay.remove();
        _drawPhase = 'idle';
        renderDrawResult(_drawResult, getFollowerGroups(_drawResult.types));
      }, 950);
    } else if (_drawPhase === 'multi-rolling') {
      // 5 连抽：顶部收集区（5 槽）+ 当前滚动格
      const slots = '<div class="follower-multi-slot"></div>'.repeat(5);
      content.innerHTML = `
        <div class="follower-display">
          <div class="follower-multi-collect overlay" id="followerMultiCollect">${slots}</div>
          <div class="gacha-roll-container" id="followerMultiRollC">
            <div class="gacha-roll-track" id="followerMultiTrack" style="transform:translateX(0px)"></div>
          </div>
        </div>
        <div class="follower-actions"><button class="gacha-btn" disabled>抽取中…</button></div>`;
      startMultiRoll();
    } else if (_drawPhase === 'multi-result' && _multiResult) {
      renderMultiResult();
    } else {
      // 空闲态：走马灯预览 + 底部抽卡按钮
      const canDraw = (gameData?.items?.candy || 0) >= FOLLOWER_DRAW_COST;
      const canDrawMulti = (gameData?.items?.candy || 0) >= FOLLOWER_DRAW_COST * 5;
      content.innerHTML = `
        <div class="follower-display">
          <div class="follower-marquee"><div class="follower-marquee-track">${followerMarqueeItems()}</div></div>
        </div>
        <div class="follower-actions">
          <button class="gacha-btn" id="followerDrawBtn" ${canDraw ? '' : 'disabled'}>抽取随从 ${FOLLOWER_DRAW_COST}<img class="gacha-coin-icon" src="./items/goods/candy.png" alt="糖"></button>
          <button class="gacha-btn" id="followerDrawMultiBtn" ${canDrawMulti ? '' : 'disabled'}>5连抽 ${FOLLOWER_DRAW_COST * 5}<img class="gacha-coin-icon" src="./items/goods/candy.png" alt="糖"></button>
        </div>`;
      animateMoveImgs(content, '.follower-marquee-item img');
      const drawBtn = $('followerDrawBtn');
      if (drawBtn) drawBtn.addEventListener('click', doDraw);
      const multiBtn = $('followerDrawMultiBtn');
      if (multiBtn) multiBtn.addEventListener('click', doDrawMulti);
    }
    if (renderFollowerView._timer) {
      clearInterval(renderFollowerView._timer);
      renderFollowerView._timer = null;
    }
  }
}

// 属性彩色标签
function typeBadgesHtml(types) {
  return (types || []).map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`).join('');
}

// 空闲走马灯：洗牌取 14 只不重复的做滚动预览
function followerMarqueeItems() {
  const pool = getFollowerPool();
  if (pool.length === 0) return '';
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, Math.min(14, shuffled.length));
  const items = picked.map(p => {
    return `<div class="follower-marquee-item tier-${tierOfRarity(p.rarity || 0)}">
      <img data-src="./pokemon-data/pokemon-move/${String(p.index).padStart(4,'0')}-${p.name}.png" alt="${p.name}">
    </div>`;
  });
  return items.join('') + items.join('');
}

// ===== 走马灯帧动画（共享 RAF 驱动全部走马灯项）=====
let _marqueeImgs = [];
let _marqueeRaf = null;

// 本批 move 图先抢载进缓存，滚动中不闪现未加载状态
function preloadMoveImages(rels) {
  rels.forEach(rel => tryLoadImage(new Image(), rel));
}

// 容器内的 move 图走标准加载通道（Tauri 下相对 src 会失败），加载完播帧动画
function animateMoveImgs(scope, selector, scale) {
  scope.querySelectorAll(selector).forEach(img => {
    const rel = img.dataset.src;
    if (rel) tryLoadImage(img, rel).then(ok => { if (ok) startMarqueeAnim(img, scale); });
  });
}

function startMarqueeAnim(img, scale = 1.6) {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return;
  const frameCount = Math.max(1, Math.round(w / h));
  // 单帧布局 + 以中心为原点放大；scale 供 5 连抽槽位这类小容器收小用
  img.style.width = h + 'px';
  img.style.height = h + 'px';
  img.style.objectFit = 'none';
  img.style.objectPosition = '0px 0px';
  img.style.transform = `scale(${scale})`;
  img.style.transformOrigin = 'center';
  _marqueeImgs.push({ img, frameCount, frameW: w / frameCount, frame: 0, last: performance.now() });
  if (!_marqueeRaf) _marqueeRaf = requestAnimationFrame(marqueeTick);
}

function marqueeTick() {
  const now = performance.now();
  // 过滤已被移除的项，空则停掉共享循环
  _marqueeImgs = _marqueeImgs.filter(m => m.img && m.img.isConnected);
  for (const m of _marqueeImgs) {
    if (now - m.last >= 200) {
      m.frame = (m.frame + 1) % FOLLOWER_FRAME_SEQ.length;
      m.last = now;
      const idx = FOLLOWER_FRAME_SEQ[m.frame] % m.frameCount;
      m.img.style.objectPosition = `-${idx * m.frameW}px 0px`;
    }
  }
  if (_marqueeImgs.length > 0) _marqueeRaf = requestAnimationFrame(marqueeTick);
  else _marqueeRaf = null;
}

// ===== 抽卡动画状态（滚动 → 锁定 → 结果）=====
let _drawPhase = 'idle';     // idle | rolling | locking | multi-rolling | multi-result
let _drawResult = null;
let _rollItems = [];         // 本次滚动格序列（锁定阶段取目标相邻格作残影）
let _rollTargetIdx = 0;      // 本次滚动目标格在序列中的下标
let _multiResult = null;     // 5 连抽结果数组
let _multiSel = 0;           // 5 连抽结果页当前选中的下标

// 扣糖果 → 抽一只 → 记图鉴与待处理标记 → 进滚动动画
function doDraw() {
  const candy = gameData?.items?.candy || 0;
  if (candy < FOLLOWER_DRAW_COST) return;
  gameData.items.candy = candy - FOLLOWER_DRAW_COST;
  updateBackpack('candy');
  saveGame();
  updateStats();
  const result = drawCard();
  if (!result) return;
  result.dex = recordFollowerDraw(result.index);      // 抽出即入图鉴（与最后带谁走无关）
  _drawResult = result;
  _drawPhase = 'rolling';
  // 结果持久化：未选跟随/放走就退出时，重启后仍可恢复结果页
  gameData.followerPending = { index: result.index, name: result.name, tier: result.tier, dex: result.dex };
  saveGame();
  renderFollowerView();
}

// 5 连抽：扣 5×糖果，连抽 5 只，依次滚动停格后进入多结果页
function doDrawMulti() {
  const candy = gameData?.items?.candy || 0;
  const cost = FOLLOWER_DRAW_COST * 5;
  if (candy < cost) return;
  gameData.items.candy = candy - cost;
  updateBackpack('candy');
  saveGame();
  updateStats();
  const results = [];
  for (let i = 0; i < 5; i++) {
    const r = drawCard();
    if (!r) continue;
    r.dex = recordFollowerDraw(r.index);             // 5 只全部入图鉴，带走的只有 1 只
    results.push(r);
  }
  if (results.length === 0) return;
  _multiResult = results;
  _multiSel = 0;
  _drawResult = results[0];
  _drawPhase = 'multi-rolling';
  // 待处理标记存完整 5 只（multi 区分单抽/5连抽），中途退出可完整恢复
  gameData.followerPending = {
    multi: true,
    results: results.map(r => ({ index: r.index, name: r.name, tier: r.tier, dex: r.dex })),
  };
  saveGame();
  renderFollowerView();
}

// 重启恢复：把存档里的待处理结果装回内存，重进随从页时展示结果
export function restorePendingFollower() {
  if (!gameData?.followerPending || gameData?.follower) return;
  const pend = gameData.followerPending;
  // 5 连抽待处理：恢复完整结果数组，直接进多结果页
  if (pend.multi && Array.isArray(pend.results) && pend.results.length > 0) {
    _multiResult = pend.results.map(r => {
      const pk = getPokemonByIndex(r.index);
      return { index: r.index, name: r.name, tier: r.tier, dex: r.dex, types: pk?.types || [] };
    });
    _multiSel = 0;
    _drawResult = _multiResult[0];
    _drawPhase = 'multi-result';
    return;
  }
  const pk = getPokemonByIndex(pend.index);
  if (!pk) return;
  _drawResult = {
    index: pend.index,
    name: pend.name,
    tier: pend.tier,
    dex: pend.dex,
    types: pk.types || [],
  };
  _drawPhase = 'result';
}

// 处理完结果（跟随或放走）：清掉待处理标记与内存结果态
function clearPending() {
  _drawPhase = 'idle';
  _drawResult = null;
  if (!gameData?.followerPending) return;
  gameData.followerPending = null;
  saveGame();
}

// 生成一批滚动格（pick(i) 决定第 i 格是谁），图先抢载再渲染
function buildRollTrack(track, count, pick) {
  const rels = [];
  let html = '';
  _rollItems = [];
  for (let i = 0; i < count; i++) {
    const p = pick(i);
    _rollItems.push(p);
    const rel = `./pokemon-data/pokemon-move/${String(p.index).padStart(4,'0')}-${p.name}.png`;
    rels.push(rel);
    html += `<div class="follower-roll-item"><img class="follower-roll-img" data-src="${rel}" alt="${p.name}"></div>`;
  }
  preloadMoveImages(rels);
  track.innerHTML = html;
  animateMoveImgs(track, '.follower-roll-img');
}

// 滚动抽卡：全新随机一批随从格，向右减速滚动后吸附到目标格居中
function startFollowerRoll() {
  const track = $('followerRollTrack');
  const container = track?.closest('.gacha-roll-container');
  if (!track || !container) return;
  const pool = getFollowerPool();
  if (pool.length === 0) return;
  const itemCount = 30;
  const ITEM_STEP = 56; // 54px 项宽 + 2px 间距，与 .follower-roll-item 保持一致
  const centerPx = container.clientWidth / 2;
  // 目标格靠 track 左段，向右滚动后正好停在视口中央
  const targetIdx = 2 + Math.floor(Math.random() * 5);
  _rollTargetIdx = targetIdx;
  // 每批全新随机（避免提前暴露卡池），目标格放本次抽到的那只
  buildRollTrack(track, itemCount, i => i === targetIdx
    ? (getPokemonByIndex(_drawResult.index) || pool[0])
    : pool[Math.floor(Math.random() * pool.length)]);
  // 向右减速滑行到目标格居中：固定时间线 + easeOut，末尾速度趋零不滑过头
  const tFinal = centerPx - targetIdx * ITEM_STEP - ITEM_STEP / 2;
  const tStart = tFinal - 1100;
  const DURATION = 200; // 总帧数（约 3.3s），让抽卡滚动多滑一会儿
  let frame = 0;
  let locked = false;
  const tick = () => {
    if (locked || !track.isConnected) return;
    frame++;
    const k = 1 - Math.pow(1 - Math.min(frame / DURATION, 1), 3); // easeOutCubic
    track.style.transform = `translateX(${tStart + (tFinal - tStart) * k}px)`;
    if (frame >= DURATION) {
      locked = true;
      // 停在目标格居中 → 直接进锁定放大
      if ($('followerView')?.style.display !== 'flex') return;
      _drawPhase = 'locking';
      renderFollowerView();
    } else {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

// 5 连抽滚动：单条长 track 全程不停滚动（方向与单抽一致：track 右移，内容从右往左流入），
// 滚到某目标格居中位置时即把该只上浮进收集槽（不打断滚动），滚到底后进结果页
function startMultiRoll() {
  const track = $('followerMultiTrack');
  const container = $('followerMultiRollC');
  if (!track || !container) return;
  const results = _multiResult || [];
  if (results.length === 0) return;
  const pool = getFollowerPool();
  const ITEM_STEP = 56;
  // 预热 5 只结果图，槽位上浮时直接命中缓存
  preloadMoveImages(results.map(r => `./pokemon-data/pokemon-move/${r.index}-${r.name}.png`));
  const itemCount = 44;
  buildRollTrack(track, itemCount, () => pool[Math.floor(Math.random() * pool.length)]);
  // 滚动参数与单抽相同：右移减速滑行约 1100px
  const centerPx = container.clientWidth / 2;
  const tStart = centerPx - 25 * ITEM_STEP - ITEM_STEP / 2;
  const tFinal = tStart + 1100;
  const DURATION = 200; // 与单抽相同的总帧数
  let frame = 0;
  let count = 0; // 已上浮数量
  let locked = false;
  const tick = () => {
    if (locked || !track.isConnected) return;
    frame++;
    const k = 1 - Math.pow(1 - Math.min(frame / DURATION, 1), 3); // easeOutCubic 与单抽一致
    const x = tStart + (tFinal - tStart) * k;
    track.style.transform = `translateX(${x}px)`;
    // 滚动途中依次上浮，最后一只在前 75% 进度内出现
    const target = Math.min(5, Math.floor(frame * 5 / (DURATION * 0.75)));
    while (count < target) {
      collectMultiPoke(count, results[count]);
      count++;
    }
    if (frame >= DURATION) {
      locked = true;
      while (count < 5) {
        collectMultiPoke(count, results[count]);
        count++;
      }
      if ($('followerView')?.style.display !== 'flex') return;
      _drawPhase = 'multi-result';
      renderFollowerView();
    } else {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

// 第 i 格停稳：把宝可梦放进收集槽 i（从下方 24px 飞入）
function collectMultiPoke(i, cur) {
  const collect = $('followerMultiCollect');
  if (!collect) return;
  const movePath = `./pokemon-data/pokemon-move/${cur.index}-${cur.name}.png`;
  const slots = collect.querySelectorAll('.follower-multi-slot');
  const slot = slots[i];
  if (slot) {
    // 透明占位避免加载前闪空；超稀有黄星、传说红星
    const star = cur.tier === 'UR' ? '<span class="follower-slot-star ur">✦</span>'
      : cur.tier === 'SR' ? '<span class="follower-slot-star">✦</span>' : '';
    slot.innerHTML = `<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="${movePath}" alt="${cur.name}">${star}`;
    const img = slot.querySelector('img');
    if (img) tryLoadImage(img, movePath).then(ok => { if (ok) startMarqueeAnim(img, 1.0); });
    slot.classList.add('filled');
    // 飞入动画：从下方 24px 移入槽位
    slot.style.opacity = '0';
    slot.style.transform = 'translateY(24px)';
    requestAnimationFrame(() => {
      slot.style.transition = 'opacity 0.25s ease, transform 0.35s cubic-bezier(0.33,0,0.2,1)';
      slot.style.opacity = '1';
      slot.style.transform = 'translateY(0)';
    });
  }
}

// 抽卡结果页：左 move 帧动画 + 右信息，底部跟随/放走
function renderDrawResult(result, groups) {
  const content = $('followerContent');
  if (!content) return;
  stopMoveAnim();
  const boostPct = Math.round(getEffectiveBoost(result.tier) * 100);
  const movePath = `./pokemon-data/pokemon-move/${result.index}-${result.name}.png`;
  const dex = result.dex || followerDexInfo(result.index);

  // 信息条按顺序淡入（图片已由锁定动画带到位，不再淡入）
  const fadeDelay = (i) => `animation-delay:${i * 120}ms`;
  content.innerHTML = `
    <div class="follower-display">
      <div class="follower-display-inner">
        <div class="follower-card-col">
          <div class="follower-card-area">
            <img class="follower-big-img" id="followerAnimImg" src="${movePath}" alt="${result.name}">
          </div>
          <div class="follower-time-line follower-fade" style="${fadeDelay(2)}">时长：${Math.round(followerDurMs(result.index) / 60000)} 分钟</div>
        </div>
        <div class="follower-info">
          <div class="follower-info-name follower-fade" style="${fadeDelay(0)}">${result.name}</div>
          <div class="follower-info-line follower-fade" style="${fadeDelay(1)}"><span class="tier-badge tier-${result.tier} follower-tier-badge">${FOLLOWER_TIER_LABEL[result.tier] || result.tier}</span><span style="font-weight:700;">${starIcons(dex.star)}</span></div>
          <div class="follower-info-line follower-fade" style="${fadeDelay(2)}">${typeBadgesHtml(result.types)}</div>
          <div class="follower-info-line follower-effect-row follower-fade" style="${fadeDelay(2)}">${followerGainTagsHtml(result.types, boostPct, result.tier)}</div>
        </div>
      </div>
    </div>
    <div class="follower-actions follower-fade" style="${fadeDelay(4 + groups.length)}">
      <button class="gacha-btn follower-follow-btn" id="followerFollowBtn">让它跟随</button>
      <button class="gacha-btn follower-release-btn" id="followerReleaseBtn">放走</button>
    </div>`;
  const animImg = $('followerAnimImg');
  if (animImg) tryLoadImage(animImg, movePath).then(ok => { if (ok) startMoveAnim(animImg, 150); });
  const followBtn = $('followerFollowBtn');
  const releaseBtn = $('followerReleaseBtn');
  if (followBtn) followBtn.addEventListener('click', () => {
    clearPending(); // 结果已处理：清除待处理标记
    startFollower({ index: result.index, name: result.name }, result.tier, groups);
    renderFollowerView();
  });
  if (releaseBtn) releaseBtn.addEventListener('click', () => {
    clearPending(); // 放走：结果作废，清除待处理标记
    renderFollowerView();
  });
}

// 5 连抽结果页：顶部收集槽（点击切换右侧信息），底部跟随/放走全部
function renderMultiResult() {
  const content = $('followerContent');
  if (!content) return;
  const results = _multiResult || [];
  if (results.length === 0) return;
  _multiSel = Math.min(_multiSel, results.length - 1);
  const sel = results[_multiSel];
  const boostPct = Math.round(getEffectiveBoost(sel.tier) * 100);
  const groups = getFollowerGroups(sel.types);
  const movePath = `./pokemon-data/pokemon-move/${sel.index}-${sel.name}.png`;
  const dex = sel.dex || followerDexInfo(sel.index);
  // 顶部收集槽：填满已抽到图片，选中槽高亮，点击切换
  const slots = results.map((r, i) => {
    const p = `./pokemon-data/pokemon-move/${r.index}-${r.name}.png`;
    const star = r.tier === 'UR' ? '<span class="follower-slot-star ur">✦</span>'
      : r.tier === 'SR' ? '<span class="follower-slot-star">✦</span>' : '';
    return `<div class="follower-multi-slot${i === _multiSel ? ' selected' : ''}" data-mi="${i}">
      <img data-src="${p}" alt="${r.name}">${star}
    </div>`;
  }).join('');
  content.innerHTML = `
    <div class="follower-display follower-multi-result-display">
      <div class="follower-multi-collect" id="followerMultiCollect">${slots}</div>
      <div class="follower-display-inner">
        <div class="follower-card-col">
          <div class="follower-card-area">
            <img class="follower-big-img" id="followerMultiBig" src="${movePath}" alt="${sel.name}">
          </div>
          <div class="follower-time-line">时长：${Math.round(followerDurMs(sel.index) / 60000)} 分钟</div>
        </div>
        <div class="follower-info">
          <div class="follower-info-name">${sel.name}</div>
          <div class="follower-info-line"><span class="tier-badge tier-${sel.tier} follower-tier-badge">${FOLLOWER_TIER_LABEL[sel.tier] || sel.tier}</span><span style="font-weight:700;">${starIcons(dex.star)}</span></div>
          <div class="follower-info-line">${typeBadgesHtml(sel.types)}</div>
          <div class="follower-info-line follower-effect-row">${followerGainTagsHtml(sel.types, boostPct, sel.tier)}</div>
        </div>
      </div>
    </div>
    <div class="follower-actions">
      <button class="gacha-btn follower-follow-btn" id="followerFollowBtn">让它跟随</button>
      <button class="gacha-btn follower-release-btn" id="followerReleaseBtn">放走全部</button>
    </div>`;
  animateMoveImgs(content, '#followerMultiCollect img', 1.0);
  const big = $('followerMultiBig');
  if (big) tryLoadImage(big, movePath).then(ok => { if (ok) startMoveAnim(big, 150); });
  // 点槽位切换右侧信息：重渲染整页
  content.querySelectorAll('.follower-multi-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      const i = Number(slot.dataset.mi);
      if (i === _multiSel) return;
      _multiSel = i;
      renderMultiResult();
    });
  });
  const followBtn = $('followerFollowBtn');
  const releaseBtn = $('followerReleaseBtn');
  if (followBtn) followBtn.addEventListener('click', () => {
    clearPending();
    startFollower({ index: sel.index, name: sel.name }, sel.tier, groups);
    renderFollowerView();
  });
  if (releaseBtn) releaseBtn.addEventListener('click', () => {
    clearPending();
    renderFollowerView();
  });
}

// ===== 随从图鉴页（表头：随从 / 属性 / 星级 / 次数；搜索 + 状态与属性筛选 + 排序）=====
const FOLLOWER_DEX_TYPES = ['一般', '火', '水', '草', '电', '冰', '格斗', '毒', '地面', '飞行', '超能', '虫', '岩石', '幽灵', '龙', '恶', '钢', '妖精'];

let _followerDexQuery = '';
let _followerDexStatus = '';     // '' 全部 | 'got' 已获得 | 'missing' 未获得
let _followerDexType = '';       // '' 全部 | 属性名
let _followerDexSortBy = '';     // '' 编号 | 'star' 星级 | 'count' 次数
let _followerDexSortDir = 1;     // 1 = 多到少，-1 = 少到多（仅星级/次数生效）

export function showFollowerDexView() {
  pushNav('followerDexView');
  showView('followerDexView');
  ensureFollowerDexShell();
  renderFollowerDexList();
}

export function closeFollowerDexView() {
  closeFollowerDexDropdowns();
  popNav();
  showView('followerView');
  renderFollowerView();
}

// 筛选 + 排序后的行数据
function followerDexFiltered() {
  const raw = _followerDexQuery;
  const q = raw.toLowerCase();
  let rows = getFollowerPool();
  if (raw) {
    rows = rows.filter(p => {
      const idx = String(p.index);
      return (p.name || '').includes(raw) || (p.form || '').includes(raw)
        || (p.pinyin || '').toLowerCase().includes(q) || (p.pinyinInitials || '').toLowerCase().includes(q) || idx.includes(q);
    });
  }
  if (_followerDexStatus) {
    rows = rows.filter(p => {
      const got = !!(gameData?.followerDex || {})[String(p.index)];
      return _followerDexStatus === 'got' ? got : !got;
    });
  }
  if (_followerDexType) rows = rows.filter(p => (p.types || []).includes(_followerDexType));
  const dir = _followerDexSortDir;
  return rows.slice().sort((a, b) => {
    if (_followerDexSortBy) {
      const ia = followerDexInfo(a.index);
      const ib = followerDexInfo(b.index);
      const va = _followerDexSortBy === 'star' ? ia.star : ia.count;
      const vb = _followerDexSortBy === 'star' ? ib.star : ib.count;
      if (va !== vb) return (vb - va) * dir;
    }
    return Number(a.index) - Number(b.index);
  });
}

function followerDexRowsHtml() {
  const rows = followerDexFiltered();
  if (!rows.length) return '<div class="roster-empty">没有符合条件的随从</div>';
  return rows.map(p => {
    const key = String(p.index);
    const got = !!(gameData?.followerDex || {})[key];
    const info = followerDexInfo(key);
    const name = got ? (p.form || p.name) : '？？？';
    return `<div class="pokedex-entry follower-dex-row${got ? '' : ' disabled'}">
      <span class="fdx-name"><img class="roster-icon-img" ${got ? `data-fd-icon="${key}"` : 'data-fd-unknown'} alt="" style="width:18px;height:18px;" />${name}</span>
      <span class="fdx-type">${got ? typeBadgesHtml(p.types) : ''}</span>
      <span class="fdx-star">${got ? `★${info.star}` : ''}</span>
      <span class="fdx-count">${got ? info.count : ''}</span>
    </div>`;
  }).join('');
}

function followerDexHeaderHtml() {
  const cls = (k) => _followerDexSortBy === k ? (_followerDexSortDir === 1 ? ' sort-desc' : ' sort-asc') : '';
  return `<div class="follower-dex-header">
    <span class="fdx-name">随从</span>
    <span class="fdx-type">属性</span>
    <span class="fdx-star" data-fdx-sort="star">星级${cls('star')}</span>
    <span class="fdx-count" data-fdx-sort="count">次数${cls('count')}</span>
  </div>`;
}

function followerDexPageHtml() {
  return `<div class="follower-dex-page view-list" style="flex:1;display:flex;flex-direction:column;min-height:0;">
    <div class="pokedex-progress">随从图鉴：已收集 <b>${followerDexCount()}</b> / ${getFollowerPool().length}</div>
    <div class="pokedex-search">
      <div class="pokedex-search-row">
        <div class="pokedex-search-input-wrap">
          <input id="followerDexSearch" class="pokedex-search-input" type="text" placeholder="名称 / 拼音 / 首字母" autocomplete="off" value="${_followerDexQuery}">
          <button class="pokedex-search-clear" id="followerDexSearchClear" style="display:${_followerDexQuery ? '' : 'none'};" aria-label="清空搜索"><svg><use xlink:href="#icon-close" /></svg></button>
        </div>
        <div id="followerDexStatusFilter" class="pokedex-region-select" tabindex="0">
          <span id="followerDexStatusLabel">全部</span>
          <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6"><path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" /></svg>
          <div id="followerDexStatusDropdown" class="region-dropdown" style="display:none;"></div>
        </div>
        <div id="followerDexTypeFilter" class="pokedex-region-select" tabindex="0">
          <span id="followerDexTypeLabel">属性</span>
          <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6"><path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" /></svg>
          <div id="followerDexTypeDropdown" class="region-dropdown" style="display:none;"></div>
        </div>
      </div>
    </div>
    ${followerDexHeaderHtml()}
    <div class="list-scroll" id="followerDexList"></div>
  </div>`;
}

// 下拉：容器内事件委托，只绑定一次；每次渲染刷新选项与选中态
function bindFollowerDexDropdown(triggerId, ddId, labelId, items, getCur, setCur) {
  const trigger = $(triggerId);
  const dd = $(ddId);
  const label = $(labelId);
  if (!trigger || !dd || !label) return;
  const select = (k) => {
    setCur(k);
    label.textContent = (items.find(it => it[0] === k) || ['', ''])[1];
    dd.style.display = 'none';
    renderFollowerDexList();
  };
  dd.innerHTML = items.map(([k, name]) => `<div class="region-dropdown-item${getCur() === k ? ' active' : ''}" data-dk="${k}">${name}</div>`).join('');
  label.textContent = (items.find(it => it[0] === getCur()) || ['', ''])[1];
  dd.onclick = (e) => {
    const it = e.target.closest('[data-dk]');
    if (!it) return;
    e.stopPropagation();
    select(it.dataset.dk);
  };
  trigger.onclick = (e) => {
    e.stopPropagation();
    const open = dd.style.display === 'block';
    closeFollowerDexDropdowns();
    if (!open) dd.style.display = 'block';
  };
}

function closeFollowerDexDropdowns() {
  for (const id of ['followerDexStatusDropdown', 'followerDexTypeDropdown']) {
    const el = $(id);
    if (el) el.style.display = 'none';
  }
}

function ensureFollowerDexShell() {
  const box = $('followerDexView');
  if (!box) return;
  if (!box.querySelector('.follower-dex-page')) {
    box.innerHTML = followerDexPageHtml();
    const input = $('followerDexSearch');
    const clearBtn = $('followerDexSearchClear');
    if (input) input.addEventListener('input', () => {
      _followerDexQuery = input.value.trim();
      if (clearBtn) clearBtn.style.display = _followerDexQuery ? '' : 'none';
      renderFollowerDexList();
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      _followerDexQuery = '';
      if (input) input.value = '';
      clearBtn.style.display = 'none';
      renderFollowerDexList();
    });
    bindFollowerDexDropdown('followerDexStatusFilter', 'followerDexStatusDropdown', 'followerDexStatusLabel',
      [['', '全部'], ['got', '已获得'], ['missing', '未获得']], () => _followerDexStatus, (k) => { _followerDexStatus = k; });
    bindFollowerDexDropdown('followerDexTypeFilter', 'followerDexTypeDropdown', 'followerDexTypeLabel',
      [['', '全部属性'], ...FOLLOWER_DEX_TYPES.map(t => [t, t])], () => _followerDexType, (k) => { _followerDexType = k; });
    // 点空白处收起下拉（只绑一次）
    if (!ensureFollowerDexShell._outsideBound) {
      ensureFollowerDexShell._outsideBound = true;
      document.addEventListener('click', closeFollowerDexDropdowns);
    }
  }
}

function renderFollowerDexList() {
  const box = $('followerDexView');
  if (!box) return;
  const list = $('followerDexList');
  const page = box.querySelector('.follower-dex-page');
  if (!list || !page) { box.innerHTML = ''; ensureFollowerDexShell(); renderFollowerDexList(); return; }
  // 只换列表与表头箭头，保住搜索框焦点与下拉开关状态
  page.querySelector('.follower-dex-header')?.remove();
  list.insertAdjacentHTML('beforebegin', followerDexHeaderHtml());
  list.innerHTML = followerDexRowsHtml();
  // 表头排序（重渲染后重新绑定当前表头）
  page.querySelectorAll('[data-fdx-sort]').forEach(el => el.addEventListener('click', () => {
    const k = el.dataset.fdxSort;
    if (_followerDexSortBy === k) _followerDexSortDir = -_followerDexSortDir;
    else { _followerDexSortBy = k; _followerDexSortDir = 1; }
    renderFollowerDexList();
  }));
  // 下拉选项的选中态（每次渲染刷新）
  const statusDd = $('followerDexStatusDropdown');
  if (statusDd) {
    statusDd.innerHTML = [['', '全部'], ['got', '已获得'], ['missing', '未获得']]
      .map(([k, n]) => `<div class="region-dropdown-item${_followerDexStatus === k ? ' active' : ''}" data-dk="${k}">${n}</div>`).join('');
  }
  const typeDd = $('followerDexTypeDropdown');
  if (typeDd) {
    typeDd.innerHTML = [['', '全部属性'], ...FOLLOWER_DEX_TYPES.map(t => [t, t])]
      .map(([k, n]) => `<div class="region-dropdown-item${_followerDexType === k ? ' active' : ''}" data-dk="${k}">${n}</div>`).join('');
  }
  // 已获得的行加载真实图标，未获得的加载 unknown 占位图
  list.querySelectorAll('[data-fd-unknown]').forEach(img => tryLoadImage(img, 'pokemon-data/icon/unknown.png'));
  list.querySelectorAll('[data-fd-icon]').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.fdIcon);
    if (poke) tryLoadPokemonIcon(img, poke);
  });
}

// ===== 通用 move 帧动画 =====
// 在任意 img 上按 FOLLOWER_FRAME_SEQ 循环播走路帧；viewSize 是放大后的视觉尺寸（px）
let _uiAnimRaf = null;
let _uiAnimImg = null;

function startMoveAnim(img, stepMs, viewSize = 80) {
  stopMoveAnim();
  _uiAnimImg = img;
  const tryInit = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) { _uiAnimImg = null; return; } // 图片尚未解码，交给 load 事件兜底
    const frameCount = Math.max(1, Math.round(w / h));
    const frameW = w / frameCount;
    // 单帧布局 + transform 放大（object-fit:none 下放大布局会露出多帧）
    img.style.width = h + 'px';
    img.style.height = h + 'px';
    img.style.objectFit = 'none';
    img.style.objectPosition = '0px 0px';
    img.style.transform = `scale(${viewSize / h})`;
    let frame = 0;
    let last = performance.now();
    function advance() {
      if (!_uiAnimImg || !_uiAnimImg.isConnected) { _uiAnimRaf = null; return; }
      const now = performance.now();
      if (now - last >= stepMs) {
        frame = (frame + 1) % FOLLOWER_FRAME_SEQ.length;
        last = now;
        const idx = FOLLOWER_FRAME_SEQ[frame] % frameCount;
        _uiAnimImg.style.objectPosition = `-${idx * frameW}px 0px`;
      }
      _uiAnimRaf = requestAnimationFrame(advance);
    }
    _uiAnimRaf = requestAnimationFrame(advance);
  };
  if (img.complete && img.naturalWidth) {
    tryInit();
  } else {
    img.addEventListener('load', tryInit, { once: true });
  }
}

function stopMoveAnim() {
  if (_uiAnimRaf) {
    cancelAnimationFrame(_uiAnimRaf);
    _uiAnimRaf = null;
  }
  _uiAnimImg = null;
}

// ===== 跟随渲染（挂机页主角身后）=====
function renderFollowerOnRoad() {
  removeFollowerFromRoad();
  const f = gameData?.follower;
  if (!f) return;
  // 挂到 screen 而非 road-layer：road-layer 高仅 72px 且 overflow hidden，放大后的随从会被裁剪
  const screen = $('screen');
  if (!screen) return;
  const el = document.createElement('div');
  el.className = 'follower-road';
  el.id = 'followerRoad';
  screen.appendChild(el);

  const img = document.createElement('img');
  img.className = 'follower-road-img';
  img.id = 'followerRoadImg';
  img.draggable = false;
  el.appendChild(img);

  const movePath = `./pokemon-data/pokemon-move/${f.index}-${f.name}.png`;
  tryLoadImage(img, movePath).then(ok => {
    if (!ok) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    _followerFrameCount = Math.max(1, Math.round(w / h));
    img.style.width = h + 'px';
    img.style.height = h + 'px';
    img.style.objectFit = 'none';
    img.style.objectPosition = '0px 0px';
    img.style.transform = 'scale(2)';
    img.style.transformOrigin = 'left top';
    // 定位到主角左侧：以 screen 为参考系，与主角行走图底部对齐
    positionFollowerOnRoad();
    _followerFrame = 0;
    _followerLastSwap = performance.now();
    startFollowerAnim();
    // 重新按当前视图状态决定显隐（避免 startFollower 在随从弹窗里被误隐藏）
    updateFollowerVisibility();
  });
  _followerEl = el;
  updateFollowerVisibility();
}

// 随从定位：主角左侧一格（主角行走图中心向左一个身位，脚底与主角脚底对齐）
function positionFollowerOnRoad() {
  const el = $('followerRoad');
  if (!el) return;
  const charEl = $('walkGif');
  const screen = $('screen');
  if (!charEl || !screen) return;
  const sRect = screen.getBoundingClientRect();
  const cRect = charEl.getBoundingClientRect();
  // 主角/屏幕无布局时跳过（全 0 坐标会把随从写到屏幕外），可见后由动画帧兜底重定位
  if (cRect.width === 0 || cRect.height === 0 || sRect.width === 0 || sRect.height === 0) return;
  // 主角中心 x（相对 screen）
  const charCX = cRect.left - sRect.left + cRect.width / 2;
  // 放在主角左侧，隔开约 1.5 个身位，避免与主角行走图重叠
  const gap = 46;
  el.style.left = (charCX - gap - cRect.width) + 'px';
  // 脚底对齐主角：主角底部相对 screen 的距离 - 随从视觉高度
  const charBottomRel = cRect.bottom - sRect.top;
  const imgEl = $('followerRoadImg');
  const fh = imgEl ? imgEl.getBoundingClientRect().height : 64;
  el.style.top = (charBottomRel - fh) + 'px';
}

function removeFollowerFromRoad() {
  stopFollowerAnim();
  if (_followerEl) {
    _followerEl.remove();
    _followerEl = null;
  }
  _followerFrame = 0;
}

function startFollowerAnim() {
  stopFollowerAnim();
  const img = $('followerRoadImg');
  if (!img) return;
  _followerFrame = 0;
  _followerLastSwap = performance.now();
  const frameW = img.naturalWidth / _followerFrameCount;
  // 主角拾取道具 / 钓鱼时随从停下，定格站立帧
  function isStopped() {
    const wg = $('walkGif');
    return wg ? (wg.classList.contains('get-item') || wg.classList.contains('fishing')) : false;
  }
  // 主角离开主界面/遭遇/战斗时随从隐藏，回主界面自动恢复（每帧同步，同主角动画的隐现节奏）
  function shouldHide() {
    return !isOnGameView() || phase !== 'idle';
  }
  function advance() {
    if (!_followerEl || !_followerEl.isConnected) { _followerAnimRaf = null; return; }
    const hide = shouldHide();
    _followerEl.style.display = hide ? 'none' : '';
    if (hide) { _followerAnimRaf = requestAnimationFrame(advance); return; }
    // 可见兜底：此前定位时主角/屏幕无布局被跳过，或布局后位置仍无效（越界），重算一次
    if (!_followerEl.style.left || !_followerEl.style.top) positionFollowerOnRoad();
    if (isStopped()) {
      // 定格第 9 帧（1-indexed）
      const idx = 8 % _followerFrameCount;
      img.style.objectPosition = `-${idx * frameW}px 0px`;
      _followerAnimRaf = requestAnimationFrame(advance);
      return;
    }
    const now = performance.now();
    if (now - _followerLastSwap >= followerStepMs()) {
      _followerFrame = (_followerFrame + 1) % FOLLOWER_FRAME_SEQ.length;
      _followerLastSwap = now;
      // 帧序映射：FOLLOWER_FRAME_SEQ 里的值对帧数取模（3 帧图同样适用）
      const idx = FOLLOWER_FRAME_SEQ[_followerFrame] % _followerFrameCount;
      img.style.objectPosition = `-${idx * frameW}px 0px`;
    }
    _followerAnimRaf = requestAnimationFrame(advance);
  }
  _followerAnimRaf = requestAnimationFrame(advance);
}

function stopFollowerAnim() {
  if (_followerAnimRaf) {
    cancelAnimationFrame(_followerAnimRaf);
    _followerAnimRaf = null;
  }
}

// 不在游戏页 / 遭遇 / 战斗中就隐藏随从
export function updateFollowerVisibility() {
  if (!_followerEl) return;
  const hide = !isOnGameView() || phase === 'encounter' || phase === 'battle';
  _followerEl.style.display = hide ? 'none' : '';
  // 恢复显示时若位置仍无效（此前无布局被跳过定位），立即重定位
  if (!hide && (!_followerEl.style.left || !_followerEl.style.top)) positionFollowerOnRoad();
}

// 返回游戏页：重新定位 + 恢复显隐
export function refreshRoadFollower() {
  if (!_followerEl) return;
  positionFollowerOnRoad();
  updateFollowerVisibility();
}

// 挂机页缺随从 DOM 时重建（重进游戏页 / 重启后 road-layer 已被清空）
export function ensureRoadFollower() {
  if (_followerEl && _followerEl.isConnected) {
    refreshRoadFollower();
    return;
  }
  if (!gameData?.follower) return;
  renderFollowerOnRoad();
  updateFollowerVisibility();
}

// 模块加载即挂载增益钩子：即使当前无随从，各机制也能安全查询（无随从时返回原值）
syncFollowerBoostHook();