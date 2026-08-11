// ===== 随从系统 =====
// 糖果抽卡的临时跟随增益玩法。抽出一只宝可梦，选择「跟随」获得限时增益，
// 用完即走；「放走」则糖果消耗无收益。同时只能跟随 1 只。
// 属性归类到 9 大增益类，同类去重；多属性每类增益同时生效、不减半
import { FOLLOWER_DRAW_COST, FOLLOWER_TIER_CHANCE, FOLLOWER_TIER_DUR, FOLLOWER_TIER_BOOST, FOLLOWER_TYPE_GROUP, FOLLOWER_GROUP_BOOST } from './config.js';
import { gameData, allPokemon, getPokemonByIndex, phase, saveGame, pushNav } from './state.js';
import { $, showView, isOnGameView, updateBackpack, updateStats, tryLoadImage } from './ui.js';
import { TYPE_COLORS } from './items.js';
import * as road from './road.js';

// 随从行走帧序：1-7-2-7（1-indexed），对应 0-indexed [0,6,1,6]；
// 主角走路/跑步/骑车时随从没有对应动作，只加快帧率模拟步伐
const FOLLOWER_FRAME_SEQ = [0, 6, 1, 6];
// 主角三种步态循环周期（ms），随从按比例加快帧率（帧间隔=步态周期/帧序列长）
const FOLLOWER_STEP_MS = { walk: 150, run: 112, bike: 62 }; // 由主角 0.6s/0.45s/0.25s 循环 ÷4 帧得来
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
// 从 pokedex 中筛选编号 ≤ 649 的宝可梦（全部有走路动画，含刚补的暴雪王）
export function getFollowerPool() {
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

// 从池中随机抽一只宝可梦（按档位均匀随机）
export function drawCard() {
  const pool = getFollowerPool();
  if (pool.length === 0) return null;
  const tier = rollTier();
  const tierPool = pool.filter(p => {
    const r = p.rarity || 0;
    if (tier === 'N') return r < 0.4;
    if (tier === 'R') return r >= 0.4 && r < 0.6;
    if (tier === 'SR') return r >= 0.6 && r < 0.8;
    return r >= 0.8;
  });
  const actualPool = tierPool.length > 0 ? tierPool : pool;
  const poke = actualPool[Math.floor(Math.random() * actualPool.length)];
  return {
    index: String(poke.index).padStart(4, '0'),
    name: poke.name,
    tier,
    types: poke.types || [],
  };
}

// 获取随从类别（一个属性 → 9 大类，单属性返回单类，双属性返回数组两类）
export function getFollowerGroups(types) {
  const ts = Array.isArray(types) && types.length > 0 ? types : ['一般'];
  const groups = [];
  for (const t of ts) {
    const g = FOLLOWER_TYPE_GROUP[t];
    if (g && !groups.includes(g)) groups.push(g);
  }
  return groups.length > 0 ? groups : ['catch'];
}

// 获取随从增益描述文案（多类时逐类列出）
export function getBoostLabel(groups) {
  const labels = {
    bike: '自行车道概率提升',
    fishing: '水域场景概率提升',
    berry: '树果成熟速度提升',
    itemdrop: '道具掉落率提升',
    battleexp: '对战胜利经验提升',
    catch: '精灵球捕捉率提升',
    flee: '宝可梦逃跑率降低',
    hatch: '孵蛋所需里程降低',
    trade: '交换闪光概率提升',
  };
  return groups.map(g => labels[g] || '未知增益').join('；');
}

// 有效增益幅度：每类都按稀有度基准强度，双属性不叠加不减半
export function getEffectiveBoost(tier, groups) {
  return FOLLOWER_TIER_BOOST[tier] || 0;
}

// 获取当前活跃随从的增益信息（供各机制挂钩调用）
export function getActiveBoost() {
  const f = gameData?.follower;
  if (!f || !f.endsAt) return null;
  if (Date.now() >= f.endsAt) {
    // 过期清理：清存档并同步移除路上 DOM，避免出现"路上还跟着、进 app 已是抽卡页"的残留状态。
    // 直接走内存清理，不走 stopFollower 避免与全局 hook 互相递归
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

// 启动跟随：写入存档、开始倒计时、渲染动画
export function startFollower(poke, tier, groups) {
  const dur = FOLLOWER_TIER_DUR[tier] || 15;
  const endsAt = Date.now() + dur * 60 * 1000;
  gameData.follower = {
    index: poke.index,
    name: poke.name,
    tier,
    groups,
    boost: getEffectiveBoost(tier, groups),
    endsAt,
  };
  saveGame();
  syncFollowerBoostHook();
  renderFollowerOnRoad();
  if ($('followerView')?.style.display === 'flex') renderFollowerView();
  // 装配 trade 类随从：交换列表是生成时定闪光的，需强制刷新一波才能吃到加成
  if (groups.includes('trade')) {
    import('./trade.js').then(m => {
      m.refreshTrades();
      // 交换页正开着时同步重渲染列表（倒计时文本会被 renderTrade 重建，但 ensureTrades 不再重生成）
      if (document.getElementById('tradeView')?.style.display !== 'none') m.renderTrade();
    });
  }
}

// 停止跟随：清理存档、移除 DOM、取消动画
export function stopFollower() {
  gameData.follower = null;
  syncFollowerBoostHook();
  removeFollowerFromRoad();
  saveGame();
  if ($('followerView')?.style.display === 'flex') renderFollowerView();
}

// 跟随到期：清理存档、同步增益 hook、移除挂机页随从 DOM
function expireFollower() {
  gameData.follower = null;
  saveGame();
  syncFollowerBoostHook();
  removeFollowerFromRoad();
}

// 把随从增益读取入口挂到全局（供各机制挂钩查询），无随从时返回 null
function syncFollowerBoostHook() {
  if (typeof window === 'undefined') return;
  window.__followerActiveBoost = () => getActiveBoost();
  // 机制级钩子：各游戏机制调用 __followerBoostMechanic('berryGrow', base)，
  // 随从生效时返回放大后的值，否则返回 base 原值
  window.__followerBoostMechanic = (mechanic, base) => {
    const act = getActiveBoost();
    if (!act) return base;
    const boost = act.boost || 0;
    const has = (act.groups || []).some(g => FOLLOWER_GROUP_BOOST[g] === mechanic);
    if (!has) return base;
    if (mechanic === 'fleeRate' || mechanic === 'hatchDist') {
      return Math.max(0, base * (1 - boost)); // 减益类：逃跑率/孵蛋里程
    }
    return base * (1 + boost); // 增益类：速度/掉落/经验/捕捉/闪光
  };
}

// ===== 随从视图（手机 App）=====
export function showFollowerView() {
  pushNav('followerView');
  showView('followerView');
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
  const candy = gameData?.items?.candy || 0;
  const canDraw = !f && candy >= FOLLOWER_DRAW_COST;
  const pool = getFollowerPool();
  const tierLabel = { N: '常见', R: '稀有', SR: '超稀有', UR: '传说' };

  if (f) {
    // 有随从跟随中：展示当前随从 + 倒计时 + 送走
    const poke = f.index ? getPokemonByIndex(f.index) : null;
    const remain = Math.max(0, f.endsAt - Date.now());
    const totalSec = Math.floor(remain / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const groups = f.groups || [];
    const boostPct = Math.round((f.boost || 0) * 100);
    // 强度文案：多类增益才标"每类"，单类直接标数值
    const boostStr = groups.length > 1 ? `强度：每类 +${boostPct}%` : `强度：+${boostPct}%`;
    const types = poke?.types || [];
    const movePath = `./pokemon-data/pokemon-move/${f.index}-${f.name}.png`;

    content.innerHTML = `
      <div class="follower-display">
        <div class="follower-display-inner">
          <div class="follower-card-area">
            <img class="follower-big-img" id="followerAnimImg" src="${movePath}" alt="${f.name}">
          </div>
          <div class="follower-info">
            <div class="follower-info-name">${f.name}</div>
            <div class="follower-info-line"><span class="tier-badge tier-${f.tier} follower-tier-badge">${tierLabel[f.tier] || f.tier}</span></div>
            <div class="follower-info-line">${typeBadgesHtml(types)}</div>
            ${groups.map(g => `<div class="follower-info-line">增益：${getBoostLabel([g])}</div>`).join('')}
          </div>
        </div>
        <div class="follower-dur-boost">
          <span>${boostStr}</span>
          <span>剩余：<span id="followerCountdown">${min}分${sec}秒</span></span>
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
      // 锁定阶段：图片放在全屏 overlay（overflow 可见）上自由放大+平移，
      // 不被任何容器裁剪；结果页卡片区只用来量目标坐标。
      // 锁定布局与结果页完全一致（右侧信息/下方行用占位透明），保证两阶段卡片区位置相同，动画结束无跳变
      const lockGroups = getFollowerGroups(_drawResult.types);
      const tierLabel = { N: '常见', R: '稀有', SR: '超稀有', UR: '传说' };
      const boostPct = Math.round(FOLLOWER_TIER_BOOST[_drawResult.tier] * 100);
      const lockBoostStr = lockGroups.length > 1 ? `强度：每类 +${boostPct}%` : `强度：+${boostPct}%`;
      content.innerHTML = `
        <div class="follower-display" id="followerLockDisplay">
          <div class="follower-display-inner">
            <div class="follower-card-area" id="followerLockArea" style="background:transparent"></div>
            <div class="follower-info" style="visibility:hidden">
              <div class="follower-info-name">${_drawResult.name}</div>
              <div class="follower-info-line"><span class="tier-badge tier-${_drawResult.tier} follower-tier-badge">${tierLabel[_drawResult.tier] || _drawResult.tier}</span></div>
              <div class="follower-info-line">${typeBadgesHtml(_drawResult.types)}</div>
              ${lockGroups.map(g => `<div class="follower-info-line">增益：${getBoostLabel([g])}</div>`).join('')}
            </div>
          </div>
          <div class="follower-dur-boost" style="visibility:hidden">
            <span>${lockBoostStr}</span>
            <span>时长：${FOLLOWER_TIER_DUR[_drawResult.tier]} 分钟</span>
          </div>
        </div>
        <div class="follower-actions"><button class="gacha-btn" disabled>抽取中…</button></div>`;
      const overlay = document.createElement('div');
      overlay.id = 'followerLockOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:visible;';
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
        // wrap 就位到结果页卡片区位置（overlay 与 viewport 同原点）
        lockWrap.style.left = cRect.left + 'px';
        lockWrap.style.top = cRect.top + 'px';
        // 残影：中央两侧各一排滚动格，锁定宝可梦出现时分别向左/右移出屏幕。
        // 容器对齐到 .screen（游戏屏幕）范围，移出即被屏幕边界裁掉，不溢出到屏幕外
        if (ghosts) {
          const screenEl = document.querySelector('.screen');
          let sLeft = 0, sTop = 0;
          if (screenEl) {
            const sRect = screenEl.getBoundingClientRect();
            sLeft = sRect.left;
            sTop = sRect.top;
            ghosts.style.left = sRect.left + 'px';
            ghosts.style.top = sRect.top + 'px';
            ghosts.style.width = sRect.width + 'px';
            ghosts.style.height = sRect.height + 'px';
            // 移出距离 = 屏幕宽度，保证残影完全滑出屏幕边界被裁掉
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
          // 左排用目标左侧相邻格（再镜像排序），右排用右侧相邻格
          const leftItems = adj([-1, -2, -3, -4]).reverse();
          const rightItems = adj([1, 2, 3, 4]);
          const mk = (items) => items.map(p => {
            const r = p.rarity || 0;
            const tier = r < 0.4 ? 'N' : r < 0.6 ? 'R' : r < 0.8 ? 'SR' : 'UR';
            return `<div class="follower-lock-ghost"><img data-src="./pokemon-data/pokemon-move/${String(p.index).padStart(4,'0')}-${p.name}.png" alt="${p.name}"></div>`;
          }).join('');
          // 残影行中心对齐宝可梦放大的位置（显示区中心），用 left/top + translate(-50%,-50%) 精确居中。
          // 中间留一个占位格（目标格位置），左右排从占位两侧散开，避免先靠拢再拉开
          ghosts.innerHTML = `
            <div class="follower-lock-mid" style="left:${(dRect.left + dRect.width / 2 - sLeft)}px;top:${(dRect.top + dRect.height / 2 - sTop)}px">
              <div class="follower-lock-row is-left">${mk(leftItems)}</div>
              <div class="follower-lock-holder"></div>
              <div class="follower-lock-row is-right">${mk(rightItems)}</div>
            </div>`;
          // 图片走标准加载通道 + 帧动画
          ghosts.querySelectorAll('img').forEach(im => {
            const rel = im.dataset.src;
            if (rel) tryLoadImage(im, rel).then(ok => { if (ok) startMarqueeAnim(im); });
          });
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
          // 第二步：放大完成后向左平移到卡片区位置
          setTimeout(() => {
            lockWrap.style.transition = 'transform 0.35s cubic-bezier(0.33, 0, 0.2, 1)';
            lockWrap.style.transform = 'translate(0, 0) scale(1)';
            // 平移结束前才淡入左侧卡片背景，避免提前露出圆角矩形
            setTimeout(() => {
              lockArea.style.transition = 'background 0.3s ease';
              lockArea.style.background = '';
            }, 300);
          }, 420);
        });
      });
      // 放大完成后移除 overlay 并切结果页（图已停在卡片区位置，补右侧信息，无跳变）
      setTimeout(() => {
        overlay.remove();
        _drawPhase = 'idle';
        renderDrawResult(_drawResult, getFollowerGroups(_drawResult.types));
      }, 950);
    } else {
      // 空闲态：走马灯预览 + 底部抽卡按钮（仿卡包抽卡机）
      content.innerHTML = `
        <div class="follower-display">
          <div class="follower-marquee"><div class="follower-marquee-track">${followerMarqueeItems()}</div></div>
        </div>
        <div class="follower-actions">
          <button class="gacha-btn" id="followerDrawBtn" ${canDraw ? '' : 'disabled'}>抽取随从 ${FOLLOWER_DRAW_COST}<img class="gacha-coin-icon" src="./items/candy.png" alt="糖"></button>
        </div>`;
      // 走马灯图片走标准加载通道（Tauri 下相对路径 src 会失败），加载完播帧动画
      content.querySelectorAll('.follower-marquee-item img').forEach(img => {
        const rel = img.dataset.src;
        if (rel) tryLoadImage(img, rel).then(ok => { if (ok) startMarqueeAnim(img); });
      });
      const drawBtn = $('followerDrawBtn');
      if (drawBtn) drawBtn.addEventListener('click', doDraw);
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

// 空闲走马灯：从卡池随机洗牌取 14 只互不重复的宝可梦，展示 move 走路帧动画做滚动预览
function followerMarqueeItems() {
  const pool = getFollowerPool();
  if (pool.length === 0) return '';
  // 洗牌后取前 14 只，保证预览不出现重复
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, Math.min(14, shuffled.length));
  const items = picked.map(p => {
    const r = p.rarity || 0;
    const tier = r < 0.4 ? 'N' : r < 0.6 ? 'R' : r < 0.8 ? 'SR' : 'UR';
    return `<div class="follower-marquee-item tier-${tier}">
      <img data-src="./pokemon-data/pokemon-move/${String(p.index).padStart(4,'0')}-${p.name}.png" alt="${p.name}">
    </div>`;
  });
  return items.join('') + items.join('');
}

// ===== 走马灯帧动画（共享 RAF 驱动全部走马灯项）=====
let _marqueeImgs = [];
let _marqueeRaf = null;

function startMarqueeAnim(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return;
  const frameCount = Math.max(1, Math.round(w / h));
  // 单帧布局 + 适度放大，占满 56px 走马灯格（以中心为原点放大，图片居中不偏移）
  img.style.width = h + 'px';
  img.style.height = h + 'px';
  img.style.objectFit = 'none';
  img.style.objectPosition = '0px 0px';
  img.style.transform = 'scale(1.6)';
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

// ===== 抽卡动画状态（仿卡包抽卡机：滚动 → 锁定 → 结果）=====
let _drawPhase = 'idle';     // idle | rolling | locking
let _drawResult = null;
let _rollItems = [];         // 本次滚动格序列（锁定阶段取目标相邻格作残影）
let _rollTargetIdx = 0;      // 本次滚动目标格在序列中的下标

// 抽卡逻辑：扣糖果 → 暂存结果 → 进入走马灯减速滚动动画
function doDraw() {
  const candy = gameData?.items?.candy || 0;
  if (candy < FOLLOWER_DRAW_COST) return;
  gameData.items.candy = candy - FOLLOWER_DRAW_COST;
  updateBackpack('candy');
  saveGame();
  updateStats();
  const result = drawCard();
  if (!result) return;
  _drawResult = result;
  _drawPhase = 'rolling';
  // 结果持久化：未选跟随/放走就退出时，重启后仍可恢复结果页
  gameData.followerPending = { index: result.index, name: result.name, tier: result.tier };
  saveGame();
  renderFollowerView();
}

// 重启恢复：把存档里的待处理结果装回内存，重进随从页时展示结果
export function restorePendingFollower() {
  if (!gameData?.followerPending || gameData?.follower) return;
  const pk = getPokemonByIndex(gameData.followerPending.index);
  if (!pk) return;
  _drawResult = {
    index: gameData.followerPending.index,
    name: gameData.followerPending.name,
    tier: gameData.followerPending.tier,
    types: pk.types || [],
  };
  _drawPhase = 'result';
}

// 处理完结果（跟随或放走）：清掉待处理标记与内存结果态，避免放走后仍停留结果页
function clearPending() {
  _drawPhase = 'idle';
  _drawResult = null;
  if (!gameData?.followerPending) return;
  gameData.followerPending = null;
  saveGame();
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
  // 每次抽卡重新随机生成整批（与预览走马灯无关，避免提前暴露卡池）
  let html = '';
  _rollItems = [];
  for (let i = 0; i < itemCount; i++) {
    const p = i === targetIdx
      ? (getPokemonByIndex(_drawResult.index) || pool[0])
      : pool[Math.floor(Math.random() * pool.length)];
    _rollItems.push(p);
    html += `<div class="follower-roll-item">
      <img class="follower-roll-img" data-src="./pokemon-data/pokemon-move/${String(p.index).padStart(4,'0')}-${p.name}.png" alt="${p.name}">
    </div>`;
  }
  track.innerHTML = html;
  track.querySelectorAll('.follower-roll-img').forEach(img => {
    const rel = img.dataset.src;
    if (rel) tryLoadImage(img, rel).then(ok => { if (ok) startMarqueeAnim(img); });
  });
  // 向右减速滚动：从起始位置经 easeOut 减速滑行到目标格居中，
  // 时间线固定、末尾速度趋零，不会惯性滑过头
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
      // 结束即停在目标格居中 → 立刻进入锁定放大，不额外停顿
      if ($('followerView')?.style.display !== 'flex') return;
      _drawPhase = 'locking';
      renderFollowerView();
    } else {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

// 抽卡结果页：左 move 帧动画 + 右信息，底部跟随/放走
function renderDrawResult(result, groups) {
  const content = $('followerContent');
  if (!content) return;
  stopMoveAnim();
  const tierLabel = { N: '常见', R: '稀有', SR: '超稀有', UR: '传说' };
  const boostPct = Math.round(FOLLOWER_TIER_BOOST[result.tier] * 100);
  const movePath = `./pokemon-data/pokemon-move/${result.index}-${result.name}.png`;

  // 信息条按顺序淡入（图片已由锁定动画带到位，不再淡入）
  const fadeDelay = (i) => `animation-delay:${i * 120}ms`;
  // 强度文案：多类增益才标"每类"，单类直接标数值
  const boostStr = groups.length > 1 ? `强度：每类 +${boostPct}%` : `强度：+${boostPct}%`;
  content.innerHTML = `
    <div class="follower-display">
      <div class="follower-display-inner">
        <div class="follower-card-area">
          <img class="follower-big-img" id="followerAnimImg" src="${movePath}" alt="${result.name}">
        </div>
        <div class="follower-info">
          <div class="follower-info-name follower-fade" style="${fadeDelay(0)}">${result.name}</div>
          <div class="follower-info-line follower-fade" style="${fadeDelay(1)}"><span class="tier-badge tier-${result.tier} follower-tier-badge">${tierLabel[result.tier] || result.tier}</span></div>
          <div class="follower-info-line follower-fade" style="${fadeDelay(2)}">${typeBadgesHtml(result.types)}</div>
          ${groups.map((g, gi) => `<div class="follower-info-line follower-fade" style="${fadeDelay(3 + gi)}">增益：${getBoostLabel([g])}</div>`).join('')}
        </div>
      </div>
      <div class="follower-dur-boost follower-fade" style="${fadeDelay(3 + groups.length)}">
        <span>${boostStr}</span>
        <span>时长：${FOLLOWER_TIER_DUR[result.tier]} 分钟</span>
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

// ===== 通用 move 帧动画 =====
// 在任意 img 上按 FOLLOWER_FRAME_SEQ（1-7-2-7）循环播放走路帧，stepMs 为每帧间隔
// viewSize：单帧放大后的视觉尺寸（px），需与容器一致，默认 80
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
    // 单帧布局 + transform 放大（同卡片区动画，避免露出多帧）
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
  // 布局有效性检查：主角或屏幕无布局（视图隐藏 / 刚切换尚未渲染）时跳过定位，
  // 避免用全 0 坐标把随从写到屏幕顶部外面，等可见后由动画帧兜底重定位
  if (cRect.width === 0 || cRect.height === 0 || sRect.width === 0 || sRect.height === 0) return;
  // 主角中心 x（相对 screen）
  const charCX = cRect.left - sRect.left + cRect.width / 2;
  // 放在主角左侧，隔开约 1.5 个身位，避免与主角行走图重叠
  const gap = 46;
  el.style.left = (charCX - gap - cRect.width) + 'px';
  // 随从脚底与主角脚底对齐：主角底部相对 screen 顶部的距离 - 随从视觉高度（含 transform 放大）
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
  // 主角拾取道具动画时随从停下，定格在第 3 帧（与主角姿势对应）
  function isStopped() {
    return $('walkGif')?.classList.contains('get-item');
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
      // 定格在第 9 帧（1-indexed），随从停下站立
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

// 按游戏状态更新随从可见性（不在游戏页 / 遭遇 / 战斗中/钓鱼时隐藏）
export function updateFollowerVisibility() {
  if (!_followerEl) return;
  const hide = !isOnGameView() || phase === 'encounter' || phase === 'battle';
  _followerEl.style.display = hide ? 'none' : '';
  // 恢复显示时若位置仍无效（此前无布局被跳过定位），立即重定位
  if (!hide && (!_followerEl.style.left || !_followerEl.style.top)) positionFollowerOnRoad();
}

// 返回游戏页时刷新随从：重新定位（主角/窗口布局可能变化）+ 恢复显隐
export function refreshRoadFollower() {
  if (!_followerEl) return;
  positionFollowerOnRoad();
  updateFollowerVisibility();
}

// 确保挂机页有随从 DOM（重启/重新进入游戏页时 road-layer 被清空后重建）
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