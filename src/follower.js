// ===== 随从系统 =====
// 糖果抽卡：抽出一只宝可梦限时跟随，到期即走；同时只能跟 1 只。
// 属性归类到 9 大增益类，同类去重，双属性两类同时生效、不减半
import { FOLLOWER_DRAW_COST, FOLLOWER_TIER_CHANCE, FOLLOWER_TIER_BOOST, FOLLOWER_MAIN, FOLLOWER_STAR_MIN, FOLLOWER_EFFECTS, FOLLOWER_TIER_ROMAN, FOLLOWER_TYPE_GROUP, FOLLOWER_GROUP_BOOST } from './config.js';
import { gameData, allPokemon, getPokemonByIndex, phase, saveGame, pushNav, popNav, addSystemLog } from './state.js';
import { $, showView, isOnGameView, updateBackpack, updateStats, tryLoadImage, tryLoadPokemonIcon, consoleLayerStyle } from './ui.js';
import { TYPE_COLORS } from './items.js';
import { playSpinSfx } from './audio.js';
import * as road from './road.js';
import { fourDirGeom, fourDirSrc, fourDirAnim, fourDirStaticAnim, fourDirDelay, fourDirFitBox, fourDirFitContent, fourDirRowBox, DIR_ROW } from './four-dir.js';

const FOLLOWER_STEP_MS = { walk: 150, run: 112, bike: 62 }; // 由主角 0.6s/0.45s/0.25s 循环 ÷4 帧得来
const FOLLOWER_SCALE = 1.35;  // 路上随从按源像素的固定倍率放大（不做归一，保留宝可梦之间的体型差）
const FOLLOWER_MAX = 60;      // 单只随从内容最长边的上限，只给传说级/巨鲸这类封顶
const FOLLOWER_GAP = 10;      // 随从内容右边界到主角贴图左边缘的横向间距（主角骑车时贴图更宽，按左缘算才不会蹭到车轮）
const LOCK_WALK_PX_PER_S = 220; // 抽出后走向卡片的移动速度（像素/秒），按恒定速度分两段走
const LOCK_WALK_BOX = 48;       // 走过去时的显示尺寸，与走马灯一致；到位后才放大到卡片尺寸
const LOCK_CARD_SIZE = 74;      // 卡片里的大图尺寸（内容最长边）
const ROLL_ITEM_STEP = 56;      // 滚动格步进：54px 项宽 + 2px 间距，与 .follower-roll-item 一致
const ROLL_POOL_SIZE = 14;      // 滚动格复用池大小：屏幕同时只可见约 7 格，14 只循环铺满看不出重复
const FOLLOWER_TIER_LABEL = { N: '常见', R: '稀有', SR: '超稀有', UR: '传说' };
let _followerAnimRaf = null;
let _followerEl = null;       // 跟随宝可梦 DOM 元素
let _followerRoadGeom = null; // 路上随从的四向几何表
let _followerFootOffset = 0;  // 四向素材画布顶到脚底的距离（已乘缩放），用于和主角落地对齐
let _followerRightEdge = 0;   // 随从右向内容右边界到画布左缘的距离（已乘缩放），用于贴边定位

// 变体（index 含 -）没有四向素材
function followerGeom(index) {
  const key = String(index);
  return key.includes('-') ? null : fourDirGeom(key);
}

// 随从池就是有四向图的宝可梦；走动取 walk
function followerSpriteRel(index, anim = 'walk') {
  return fourDirSrc(followerGeom(index), anim);
}

// 静止展示用正面 idle；素材 idle 只有一帧时退回正面行走帧
function followerStaticRel(index) {
  const geom = followerGeom(index);
  return fourDirSrc(geom, fourDirStaticAnim(geom));
}

function loadFollowerStatic(img, index) {
  const geom = followerGeom(index);
  if (!geom) return Promise.resolve({ ok: false, geom: null, anim: 'walk' });
  const anim = fourDirStaticAnim(geom);
  return tryLoadImage(img, fourDirSrc(geom, anim)).then(ok => ({ ok, geom, anim }));
}

function loadFollowerSprite(img, index, anim = 'walk') {
  const geom = followerGeom(index);
  if (!geom) return Promise.resolve({ ok: false, geom: null });
  return tryLoadImage(img, fourDirSrc(geom, anim)).then(ok => ({ ok, geom }));
}

// ===== 四向 UI 动画（走马灯 / 滚动格 / 卡片大图共用）=====
let _fdImgs = [];
let _fdRaf = null;
let _fdGate = null; // 可见性门控：滚动一次几十张图，只有真看得见的才需要逐帧重写

// 滚动格与走马灯都会被 overflow 容器裁掉，IntersectionObserver 会连带算上祖先裁剪，
// 视口外的格子自动落榜，不再每帧写 objectPosition（该属性非合成，写一次就要重采样一次）
function fdGateObserver() {
  if (_fdGate) return _fdGate;
  _fdGate = new IntersectionObserver(entries => {
    for (const e of entries) {
      const m = e.target.__fdItem;
      if (m) m.visible = e.isIntersecting;
    }
  });
  return _fdGate;
}

// opts.content 按内容框归一（消除透明留白）；否则 opts.box 按画布边长
function startFourDirAnim(img, geom, opts = {}) {
  const row = opts.row || 0;
  const anim = opts.anim || 'walk';
  if (opts.content) fourDirFitContent(img, geom, anim, opts.content, { row });
  else fourDirFitBox(img, geom, anim, opts.box || 48, { row });
  const item = { img, anim: fourDirAnim(geom, anim), row, frame: 0, nextAt: performance.now(), visible: true };
  const i = _fdImgs.findIndex(m => m.img === img);
  if (i >= 0) _fdImgs.splice(i, 1);
  _fdImgs.push(item);
  img.__fdItem = item;
  fdGateObserver().observe(img);
  if (!_fdRaf) _fdRaf = requestAnimationFrame(fdAnimTick);
}

function fdAnimTick() {
  const now = performance.now();
  _fdImgs = _fdImgs.filter(m => {
    if (m.img && m.img.isConnected) return true;
    if (m.img) { _fdGate.unobserve(m.img); m.img.__fdItem = null; }
    return false;
  });
  for (const m of _fdImgs) {
    if (!m.visible || now < m.nextAt) continue;
    const n = Math.max(1, m.anim.n);
    if (m.frame >= n) m.frame = 0;
    m.img.style.objectPosition = `-${m.frame * m.anim.w}px -${m.row * m.anim.h}px`;
    m.nextAt = now + fourDirDelay(m.anim, m.frame);
    m.frame = (m.frame + 1) % n;
  }
  _fdRaf = _fdImgs.length ? requestAnimationFrame(fdAnimTick) : null;
}

// 切换已播动画的方向行（锁定到位后转正面用）
function setFourDirRow(img, row) {
  const m = _fdImgs.find(it => it.img === img);
  if (!m) return;
  m.row = row;
  m.frame = 0;
  m.nextAt = performance.now();
  img.style.objectPosition = `0px -${row * m.anim.h}px`;
}

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

// 卡池 = 所有带四向走路贴图的宝可梦（变体无贴图，自然排除）
function getFollowerPool() {
  return (allPokemon || []).filter(p => !!followerGeom(p.index));
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
  // 先把这一趟要展示的阶段定好，再切视图：切视图会广播 view-changed，按阶段自愈
  if (gameData?.followerPending && !gameData?.follower) {
    // 有待处理结果：装回内存展示结果页（重启恢复 / 抽到一半切走再回来）
    restorePendingFollower();
  } else if (!gameData?.follower) {
    // 正常进入：回到空闲态，避免残留上一轮的滚动/锁定动画
    _drawPhase = 'idle';
    _drawResult = null;
  }
  showView('followerView');
  bindFollowerDexBtn();
  renderFollowerView();
}

// 从别的页面回到随从页（返回键等不经过 showFollowerView 的路径）：
// 动画阶段如果还停在 rolling / locking，按待处理结果收尾成结果页，别让跑马灯定格在那
window.addEventListener('view-changed', (e) => {
  if (e.detail !== 'followerView' || !gameData || gameData.follower) return;
  if (_drawPhase !== 'rolling' && _drawPhase !== 'locking' && _drawPhase !== 'multi-rolling') return;
  if (gameData.followerPending) restorePendingFollower();
  else { _drawPhase = 'idle'; _drawResult = null; }
  if (followerVisible()) renderFollowerView();
});

const followerVisible = () => $('followerView')?.style.display === 'flex';

function renderFollowerView() {
  const content = $('followerContent');
  if (!content) return;
  // 上一次锁定动画被打断时残留的全屏 overlay 先收掉，免得叠在一起
  document.getElementById('followerLockOverlay')?.remove();
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
    const movePath = followerStaticRel(f.index);

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
    if (animImg) loadFollowerStatic(animImg, f.index).then(r => {
      if (r.ok) startFourDirAnim(animImg, r.geom, { content: 74, anim: r.anim });
    });
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
      const movePath = followerSpriteRel(_drawResult.index);
      // 结果页大图走静止素材（与走路不是同一张），提前抢载，收尾切换不闪空
      preloadMoveImages([followerStaticRel(_drawResult.index)]);
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
      if (lockImg) loadFollowerSprite(lockImg, _drawResult.index).then(r => {
        if (!r.ok) return;
        // 抽出后不停帧：保持朝左走的行走帧，以走马灯同尺寸一路走到左侧卡片；到位再转身正面并放大
        if (r.geom) startFourDirAnim(lockImg, r.geom, { box: LOCK_WALK_BOX, row: DIR_ROW.left });
        if (lockImg.naturalWidth && lockImg.naturalHeight) lockImg.style.display = '';
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
            const geom = followerGeom(p.index);
            const rel = fourDirSrc(geom, 'walk');
            return `<div class="follower-lock-ghost"><img ${geom ? `data-fd="${p.index}"` : ''} data-src="${rel}" alt="${p.name}"></div>`;
          }).join('');
          // 残影行以显示区中心为锚点；中间留目标格空位，左右两排从两侧散开
          ghosts.innerHTML = `
            <div class="follower-lock-mid" style="left:${(dRect.left + dRect.width / 2 - sLeft)}px;top:${(dRect.top + dRect.height / 2 - sTop)}px">
              <div class="follower-lock-row is-left">${mk(leftItems)}</div>
              <div class="follower-lock-holder"></div>
              <div class="follower-lock-row is-right">${mk(rightItems)}</div>
            </div>`;
          // 残影沿用滚动格的朝向（朝右走），与滚动现场一致
          animateMoveImgs(ghosts, 'img', { box: 40, row: DIR_ROW.right });
        }
        // 以走马灯尺寸淡入显示区中央，按这个尺寸走到卡片位，到位后才放大
        lockWrap.style.transition = 'none';
        lockWrap.style.transform = `translate(${dx}px, ${dy}px)`;
        lockWrap.style.opacity = '0';
        requestAnimationFrame(() => {
          lockWrap.style.transition = 'opacity 0.18s ease';
          lockWrap.style.opacity = '1';
          // 恒速分两段走：先纵向到卡片同高，再横向走到卡片，两段都按行走速度，不做斜向滑行
          const walkMs = px => Math.max(180, Math.abs(px) / LOCK_WALK_PX_PER_S * 1000);
          const tY = Math.round(walkMs(dy));
          const tX = Math.round(walkMs(dx));
          requestAnimationFrame(() => {
            lockWrap.style.transition = `transform ${tY}ms linear`;
            lockWrap.style.transform = `translate(${dx}px, 0)`;
            setTimeout(() => {
              lockWrap.style.transition = `transform ${tX}ms linear`;
              lockWrap.style.transform = 'translate(0, 0)';
              setTimeout(() => {
                // 到位：转身朝前，同时放大进卡片。放大倍数 = 卡片尺寸 / 走过的尺寸
                const geom = followerGeom(_drawResult.index);
                let grow = 1;
                if (geom) {
                  const kWalk = fourDirFitBox(lockImg, geom, 'walk', LOCK_WALK_BOX, { row: DIR_ROW.left });
                  const b = fourDirRowBox(geom, 'walk');
                  const kCard = LOCK_CARD_SIZE / Math.max(1, b[2] - b[0] + 1, b[3] - b[1] + 1);
                  grow = kCard / kWalk;
                }
                setFourDirRow(lockImg, DIR_ROW.down);
                lockWrap.style.transition = 'transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1)';
                lockWrap.style.transform = `translate(0, 0) scale(${grow})`;
                setTimeout(() => {
                  // 放大结束后换成卡片布局，同时把 wrap 缩放归位（两者同一帧，视觉不变）
                  if (geom) fourDirFitContent(lockImg, geom, 'walk', LOCK_CARD_SIZE, { row: DIR_ROW.down });
                  lockWrap.style.transition = 'none';
                  lockWrap.style.transform = 'translate(0, 0)';
                  lockArea.style.transition = 'background 0.3s ease';
                  lockArea.style.background = '';
                  setTimeout(finishLock, 60);
                }, 230);
              }, tX);
            }, tY);
          });
        });
      });
      // 切结果页：图已停在卡片区，与结果页同尺寸、同位置
      let lockDone = false;
      const finishLock = () => {
        if (lockDone) return;
        lockDone = true;
        _drawPhase = 'idle';
        // 结果页大图与锁定动画不是同一张素材：等新图真加载出来再撤 overlay，免得卡片区闪空
        const ready = renderDrawResult(_drawResult, getFollowerGroups(_drawResult.types));
        let dropped = false;
        const drop = () => { if (!dropped) { dropped = true; overlay.remove(); } };
        Promise.resolve(ready).then(drop, drop);
        setTimeout(drop, 600);
      };
      setTimeout(finishLock, 2400);
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
      // 空闲走马灯播放朝右行走帧
      animateMoveImgs(content, '.follower-marquee-item img', { box: 48, row: DIR_ROW.right });
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
    const geom = followerGeom(p.index);
    const rel = fourDirSrc(geom, 'walk');
    return `<div class="follower-marquee-item tier-${tierOfRarity(p.rarity || 0)}">
      <img ${geom ? `data-fd="${p.index}"` : ''} data-src="${rel}" alt="${p.name}">
    </div>`;
  });
  return items.join('') + items.join('');
}

// 本批图先抢载进缓存并等解码完成：每次滚动都是全新一批图，等到首帧才解码会集中卡一下
function preloadMoveImages(rels) {
  const done = new Set();
  const jobs = [];
  rels.forEach(rel => {
    if (!rel || done.has(rel)) return;
    done.add(rel);
    const img = new Image();
    jobs.push(tryLoadImage(img, rel).then(ok => {
      if (ok && img.decode) img.decode().catch(() => {});
    }));
  });
  return Promise.all(jobs);
}

// 容器内的图走标准加载通道（Tauri 下相对 src 会失败），加载完播帧动画
function animateMoveImgs(scope, selector, opts = {}) {
  scope.querySelectorAll(selector).forEach(img => {
    const rel = img.dataset.src;
    if (!rel) return;
    const geom = followerGeom(img.dataset.fd);
    if (!geom) return;
    const anim = opts.anim === 'idle' ? fourDirStaticAnim(geom) : opts.anim;
    // 先铺好尺寸与帧位再加载：图片一解码就按整张 sheet 的自然尺寸渲染，
    // 等 onload 回来才设样式的话，中间会闪出一片没裁切的原始大图
    if (opts.content) fourDirFitContent(img, geom, anim, opts.content, { row: opts.row || 0 });
    else fourDirFitBox(img, geom, anim, opts.box || 48, { row: opts.row || 0 });
    tryLoadImage(img, rel).then(ok => {
      if (!ok) return;
      startFourDirAnim(img, geom, { box: opts.box || 48, row: opts.row, anim });
    });
  });
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
  addSystemLog('follower_draw', { pokemon: result.index, name: result.name, tier: result.tier, star: result.dex.star });
  _drawResult = result;
  _drawPhase = 'rolling';
  playSpinSfx('spin2');
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
    addSystemLog('follower_draw', { pokemon: r.index, name: r.name, tier: r.tier, star: r.dex.star });
    results.push(r);
  }
  if (results.length === 0) return;
  _multiResult = results;
  _multiSel = 0;
  _drawResult = results[0];
  _drawPhase = 'multi-rolling';
  playSpinSfx('spin2');
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

// 滚动格复用池：从卡池随机取 n 只循环铺满整条轨道（排除 exclude，免得残影里撞到目标那只）。
// 屏幕同时只可见约 7 格，看不出重复，但同屏解码的贴图从 30/44 张降到 n 张
function rollPoolOf(pool, n, exclude) {
  let a = pool.filter(p => !exclude || String(p.index).padStart(4, '0') !== exclude);
  if (a.length === 0) a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, Math.max(1, Math.min(n, a.length)));
}

// 生成一批滚动格（pick(i) 决定第 i 格是谁）。图没到就开滚会先空一片（加载期间是
// 透明占位），所以等预热完再插图起滚；预热万一卡住，最多等 600ms 就带空图开滚
function buildRollTrack(track, count, pick) {
  const rels = [];
  let html = '';
  _rollItems = [];
  for (let i = 0; i < count; i++) {
    const p = pick(i);
    _rollItems.push(p);
    const geom = followerGeom(p.index);
    const rel = fourDirSrc(geom, 'walk');
    rels.push(rel);
    html += `<div class="follower-roll-item"><img class="follower-roll-img" ${geom ? `data-fd="${p.index}"` : ''} data-src="${rel}" alt="${p.name}"></div>`;
  }
  return Promise.race([
    preloadMoveImages(rels),
    new Promise(r => setTimeout(r, 600)),
  ]).then(() => {
    if (!track.isConnected) return;
    track.innerHTML = html;
    // 滚动格同样播朝右行走帧
    animateMoveImgs(track, '.follower-roll-img', { box: 48, row: DIR_ROW.right });
  });
}

// 滚动抽卡：全新随机一批随从格，向右减速滚动后吸附到目标格居中
function startFollowerRoll() {
  const track = $('followerRollTrack');
  const container = track?.closest('.gacha-roll-container');
  if (!track || !container) return;
  const pool = getFollowerPool();
  if (pool.length === 0) return;
  const itemCount = 30;
  // 目标格靠 track 左段，向右滚动后正好停在视口中央
  const targetIdx = 2 + Math.floor(Math.random() * 5);
  _rollTargetIdx = targetIdx;
  // 每批全新随机（避免提前暴露卡池），目标格放本次抽到的那只
  const rollPool = rollPoolOf(pool, ROLL_POOL_SIZE, _drawResult.index);
  buildRollTrack(track, itemCount, i => i === targetIdx
    ? (getPokemonByIndex(_drawResult.index) || pool[0])
    : rollPool[i % rollPool.length]).then(() => {
    if (!track.isConnected) return;
    const centerPx = container.clientWidth / 2;
    // 向右减速滑行到目标格居中：固定时间线 + easeOut，末尾速度趋零不滑过头
    const tFinal = centerPx - targetIdx * ROLL_ITEM_STEP - ROLL_ITEM_STEP / 2;
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
        // 停在目标格居中 → 直接进锁定放大。切走时只记阶段，回来再按阶段重画
        _drawPhase = 'locking';
        if (followerVisible()) renderFollowerView();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
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
  // 预热 5 只结果图，槽位上浮时直接命中缓存
  preloadMoveImages(results.map(r => followerStaticRel(r.index)));
  const itemCount = 44;
  const rollPool = rollPoolOf(pool, ROLL_POOL_SIZE);
  buildRollTrack(track, itemCount, i => rollPool[i % rollPool.length]).then(() => {
    if (!track.isConnected) return;
    // 滚动参数与单抽相同：右移减速滑行约 1100px
    const centerPx = container.clientWidth / 2;
    const tStart = centerPx - 25 * ROLL_ITEM_STEP - ROLL_ITEM_STEP / 2;
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
        _drawPhase = 'multi-result';
        if (followerVisible()) renderFollowerView();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

// 第 i 格停稳：把宝可梦放进收集槽 i（从下方 24px 飞入）
function collectMultiPoke(i, cur) {
  const collect = $('followerMultiCollect');
  if (!collect) return;
  const geom = followerGeom(cur.index);
  const anim = fourDirStaticAnim(geom);
  const movePath = fourDirSrc(geom, anim);
  const slots = collect.querySelectorAll('.follower-multi-slot');
  const slot = slots[i];
  if (slot) {
    // 透明占位避免加载前闪空；超稀有黄星、传说红星
    const star = cur.tier === 'UR' ? '<span class="follower-slot-star ur">✦</span>'
      : cur.tier === 'SR' ? '<span class="follower-slot-star">✦</span>' : '';
    slot.innerHTML = `<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="${movePath}" alt="${cur.name}">${star}`;
    const img = slot.querySelector('img');
    if (img) {
      // 同滚动格：先铺好尺寸与帧位，避免缓存命中时闪出一帧原始大图
      fourDirFitBox(img, geom, anim, 34, { row: DIR_ROW.down });
      tryLoadImage(img, movePath).then(ok => {
        if (ok) startFourDirAnim(img, geom, { box: 34, anim });
      });
    }
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

// 抽卡结果页：左侧大图 + 右侧信息，底部跟随/放走
function renderDrawResult(result, groups) {
  const content = $('followerContent');
  if (!content) return;
  const boostPct = Math.round(getEffectiveBoost(result.tier) * 100);
  const movePath = followerStaticRel(result.index);
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
  // 返回大图就绪的 promise，锁定收尾要等它出来再撤 overlay
  const imgReady = animImg ? loadFollowerStatic(animImg, result.index).then(r => {
    if (r.ok) startFourDirAnim(animImg, r.geom, { content: 74, anim: r.anim });
  }) : Promise.resolve();
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
  return imgReady;
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
  const movePath = followerStaticRel(sel.index);
  const dex = sel.dex || followerDexInfo(sel.index);
  // 顶部收集槽：填满已抽到图片，选中槽高亮，点击切换
  const slots = results.map((r, i) => {
    const geom = followerGeom(r.index);
    const p = fourDirSrc(geom, fourDirStaticAnim(geom));
    const star = r.tier === 'UR' ? '<span class="follower-slot-star ur">✦</span>'
      : r.tier === 'SR' ? '<span class="follower-slot-star">✦</span>' : '';
    return `<div class="follower-multi-slot${i === _multiSel ? ' selected' : ''}" data-mi="${i}">
      <img ${geom ? `data-fd="${r.index}"` : ''} data-src="${p}" alt="${r.name}">${star}
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
  animateMoveImgs(content, '#followerMultiCollect img', { box: 34, anim: 'idle' });
  const big = $('followerMultiBig');
  if (big) loadFollowerStatic(big, sel.index).then(r => {
    if (r.ok) startFourDirAnim(big, r.geom, { content: 74, anim: r.anim });
  });
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
  _followerDetailIndex = null;
  leaveFollowerDetailTitle();
  pushNav('followerDexView');
  showView('followerDexView');
  ensureFollowerDexShell();
  renderFollowerDexList();
}

export function closeFollowerDexView() {
  // 详情态下返回先回列表，再返一次才离开图鉴
  if (_followerDetailIndex != null) { backToFollowerDexList(); return; }
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
    return `<div class="pokedex-entry follower-dex-row${got ? '' : ' disabled'}" data-fdx-idx="${key}">
      <span class="fdx-name"><img class="roster-icon-img" ${got ? `data-fd-icon="${key}"` : 'data-fd-unknown'} alt="" style="width:18px;height:18px;" />${name}</span>
      <span class="fdx-type">${got ? typeBadgesHtml(p.types) : ''}</span>
      <span class="fdx-star">${got ? `★${info.star}` : ''}</span>
      <span class="fdx-count">${got ? info.count : ''}</span>
    </div>`;
  }).join('');
}

function followerDexHeaderHtml() {
  // 排序箭头类名要拼进 class 属性
  const cls = (k) => _followerDexSortBy === k ? (_followerDexSortDir === 1 ? 'sort-desc' : 'sort-asc') : '';
  return `<div class="follower-dex-header">
    <span class="fdx-name">随从</span>
    <span class="fdx-type">属性</span>
    <span class="fdx-star ${cls('star')}" data-fdx-sort="star">星级</span>
    <span class="fdx-count ${cls('count')}" data-fdx-sort="count">次数</span>
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
  // 表头排序（三段：升序 → 降序 → 取消回默认编号序）
  page.querySelectorAll('[data-fdx-sort]').forEach(el => el.addEventListener('click', () => {
    const k = el.dataset.fdxSort;
    if (_followerDexSortBy === k) {
      if (_followerDexSortDir === 1) _followerDexSortDir = -1;
      else { _followerDexSortBy = ''; _followerDexSortDir = 1; } // 第三次点：取消排序
    } else { _followerDexSortBy = k; _followerDexSortDir = 1; }
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
  // 已获得的行可点进详情；未获得的不绑定
  list.querySelectorAll('.follower-dex-row:not(.disabled)').forEach(row => {
    row.addEventListener('click', () => showFollowerDetail(row.dataset.fdxIdx));
  });
  // 已获得的行加载真实图标，未获得的加载 unknown 占位图
  list.querySelectorAll('[data-fd-unknown]').forEach(img => tryLoadImage(img, 'pokemon-data/icon/unknown.png'));
  list.querySelectorAll('[data-fd-icon]').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.fdIcon);
    if (poke) tryLoadPokemonIcon(img, poke);
  });
}

// ===== 随从详情页（图鉴列表点已获得的随从进入，版式照抽取结果页）=====
let _followerDetailIndex = null;
let _followerDetailTitle = null; // 接管前的 appTitle 状态

// 返回链入口：详情是否开着（main.js 用不到，保留给外部判断）
export function isFollowerDetailOpen() { return _followerDetailIndex != null; }

// 标题栏接管为「随从详情」+ 返回箭头（照图鉴相遇日志的写法）
function enterFollowerDetailTitle() {
  const t = $('appTitle');
  if (!t || _followerDetailTitle != null) return;
  _followerDetailTitle = { html: t.innerHTML, action: t.dataset.action || '' };
  t.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 随从详情';
  t.dataset.action = 'back';
}

function leaveFollowerDetailTitle() {
  const t = $('appTitle');
  if (t && _followerDetailTitle != null) {
    t.innerHTML = _followerDetailTitle.html;
    t.dataset.action = _followerDetailTitle.action;
  }
  _followerDetailTitle = null;
}

function followerDetailPageHtml(key) {
  const p = getPokemonByIndex(key);
  if (!p) return '';
  const info = followerDexInfo(key);
  const tier = tierOfRarity(p.rarity || 0);
  const boostPct = Math.round(getEffectiveBoost(tier) * 100);
  const name = p.form || p.name;
  // 不加 .view-list 的水平内缩：左右各多收 6px 会挤掉信息区宽度，主/副增益 tag 会换行
  return `<div class="follower-dex-page view-list" style="flex:1;display:flex;flex-direction:column;min-height:0;padding:0 0 4px;">
    <div class="follower-display">
      <div class="follower-display-inner">
        <div class="follower-card-col">
          <div class="follower-card-area">
            <img class="follower-big-img" id="followerDetailImg" src="${followerStaticRel(key)}" alt="${name}">
          </div>
          <div class="follower-time-line">时长：${Math.round(followerDurMs(key) / 60000)} 分钟</div>
        </div>
        <div class="follower-info">
          <div class="follower-info-name">${name}</div>
          <div class="follower-info-line"><span class="tier-badge tier-${tier} follower-tier-badge">${FOLLOWER_TIER_LABEL[tier] || tier}</span><span style="font-weight:700;">${starIcons(info.star)}</span></div>
          <div class="follower-info-line">${typeBadgesHtml(p.types)}</div>
          <div class="follower-info-line follower-effect-row">${followerGainTagsHtml(p.types, boostPct, tier)}</div>
        </div>
      </div>
    </div>
    <div class="follower-dex-detail-meta">
      <span>图鉴编号 #${key}</span>
      <span>已抽到 ${info.count} 次</span>
    </div>
  </div>`;
}

// 详情页里的大图播正面待机帧，与结果页一致
function loadFollowerDetailImg(key) {
  const img = $('followerDetailImg');
  const p = getPokemonByIndex(key);
  if (!img || !p) return;
  loadFollowerStatic(img, key).then(r => {
    if (r.ok) startFourDirAnim(img, r.geom, { content: LOCK_CARD_SIZE, anim: r.anim });
  });
}

export function showFollowerDetail(index) {
  const key = String(index);
  if (!(gameData?.followerDex || {})[key]) return; // 只放已解锁的进来
  const box = $('followerDexView');
  if (!box) return;
  _followerDetailIndex = key;
  enterFollowerDetailTitle();
  box.innerHTML = followerDetailPageHtml(key);
  loadFollowerDetailImg(key);
}

function backToFollowerDexList() {
  _followerDetailIndex = null;
  leaveFollowerDetailTitle();
  const box = $('followerDexView');
  if (box) box.innerHTML = '';
  ensureFollowerDexShell();
  renderFollowerDexList();
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

  loadFollowerSprite(img, f.index).then(r => {
    if (!r.ok) return;
    _followerRoadGeom = r.geom;
    // 待机表也预热：钓鱼/捡道具时要切过去播正面待机，冷加载会闪一下空白
    preloadMoveImages([fourDirSrc(r.geom, fourDirStaticAnim(r.geom))]);
    // 四向素材横向朝右（行 1）：按源像素固定倍率缩放，只对超大体型封顶
    const box = fourDirRowBox(r.geom, 'walk');
    const maxEdge = Math.max(box[2] - box[0] + 1, box[3] - box[1] + 1);
    const target = maxEdge * Math.min(FOLLOWER_SCALE, FOLLOWER_MAX / maxEdge);
    const k = fourDirFitContent(img, r.geom, 'walk', target, { row: DIR_ROW.right, origin: 'left top' });
    // 脚底 = 右向内容框底边（与贴边定位同一套数据；ay 与实际脚底有偏差不用）
    _followerFootOffset = (box[3] + 1) * k;
    _followerRightEdge = (box[2] + 1) * k;
    // 定位到主角左侧：以 screen 为参考系，与主角行走图底部对齐
    positionFollowerOnRoad();
    startFollowerAnim();
    // 重新按当前视图状态决定显隐（避免 startFollower 在随从弹窗里被误隐藏）
    updateFollowerVisibility();
  });
  _followerEl = el;
  updateFollowerVisibility();
}

// 主角贴图某些姿势带 transform 位移（钓鱼 translate(-10,15)、捡道具/骑车 translateX）：
// rect 含变形，直接把随从贴在 rect 上，钓鱼结束回走路后就会一直偏低。取掉位移按布局位贴边
function charTransformShift(el) {
  try {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return { x: 0, y: 0 };
    const nums = t.slice(t.indexOf('(') + 1, -1).split(',').map(Number);
    const is3d = t.startsWith('matrix3d');
    return { x: nums[is3d ? 12 : 4] || 0, y: nums[is3d ? 13 : 5] || 0 };
  } catch (_) {
    return { x: 0, y: 0 };
  }
}

// 随从定位：贴在主角左侧，脚底与主角对齐
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
  // #screen 有 3px 边框：绝对定位以 padding box 为原点，rect 是 border box，需补偿
  const originX = sRect.left + screen.clientLeft;
  const originY = sRect.top + screen.clientTop;
  const shift = charTransformShift(charEl);
  // 锚主角贴图左缘，随从按内容右边界贴边，骑车贴图更宽也不顶到车轮
  const charLeft = cRect.left - shift.x - originX;
  el.style.left = (charLeft - FOLLOWER_GAP - _followerRightEdge) + 'px';
  const charBottomRel = cRect.bottom - shift.y - originY;
  el.style.top = (charBottomRel - _followerFootOffset) + 'px';
}

function removeFollowerFromRoad() {
  stopFollowerAnim();
  _followerRoadGeom = null;
  _followerFootOffset = 0;
  _followerRightEdge = 0;
  if (_followerEl) {
    _followerEl.remove();
    _followerEl = null;
  }
}

// 路上随从：走动时朝右（行 1）播行走帧、步频跟随主角速度；
// 主角停下（钓鱼 / 捡道具）时转正面（行 0）播待机帧——这时主角是面朝前方的
function startRoadFourDirAnim(img, geom) {
  const walk = fourDirAnim(geom, 'walk');
  const idleAnim = fourDirStaticAnim(geom); // 有 idle 素材就用，缺了退回 walk
  const idle = fourDirAnim(geom, idleAnim);
  const base = FOLLOWER_STEP_MS.walk;
  let sheet = 'walk'; // 当前贴图：walk | idle（两套画布同尺寸，换表只影响取帧的行与帧数）
  let frame = 0;
  let nextAt = performance.now();
  // 换表：走标准加载通道，命中缓存时同步生效
  function useSheet(name) {
    if (sheet === name) return;
    sheet = name;
    frame = 0;
    nextAt = performance.now();
    tryLoadImage(img, fourDirSrc(geom, name));
  }
  function advance() {
    if (!_followerEl || !_followerEl.isConnected) { _followerAnimRaf = null; return; }
    const hide = !isOnGameView() || phase !== 'idle';
    _followerEl.style.display = hide ? 'none' : '';
    if (hide) { _followerAnimRaf = requestAnimationFrame(advance); return; }
    // 可见兜底：此前定位时主角/屏幕无布局被跳过，或布局后位置仍无效（越界），重算一次
    if (!_followerEl.style.left || !_followerEl.style.top) positionFollowerOnRoad();
    const wg = $('walkGif');
    const stopped = wg ? (wg.classList.contains('get-item') || wg.classList.contains('fishing')) : false;
    // 主角背对镜头钓鱼（水域在路面从下往上第一行，fishing.js 里 row < 3 用前 4 帧）时随从也转背面
    const backView = stopped && !!wg && wg.classList.contains('fishing') && road.getFishingRow() < 3;
    const now = performance.now();
    const a = stopped ? idle : walk;
    useSheet(stopped ? idleAnim : 'walk');
    const n = Math.max(1, a.n);
    const row = stopped ? (backView ? DIR_ROW.up : DIR_ROW.down) : DIR_ROW.right;
    if (now >= nextAt) {
      if (frame >= n) frame = 0;
      img.style.objectPosition = `-${frame * a.w}px -${row * a.h}px`;
      nextAt = now + fourDirDelay(a, frame) * (stopped ? 1 : followerStepMs() / base);
      frame = (frame + 1) % n;
    }
    _followerAnimRaf = requestAnimationFrame(advance);
  }
  _followerAnimRaf = requestAnimationFrame(advance);
}

function startFollowerAnim() {
  stopFollowerAnim();
  const img = $('followerRoadImg');
  if (!img || !_followerRoadGeom) return;
  startRoadFourDirAnim(img, _followerRoadGeom);
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