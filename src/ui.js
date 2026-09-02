// ===== UI 管理 =====
import { phase, currentEncounter, currentIsShiny, gameData, saveGame, _fishing, _eggHatching, _navStack, allPokemon } from './state.js';
import { formatNum, getCurrentRegion, getCurrentRoadInfo, anyIncubatorReady, getIncubatorUnlockCost, getMassOutbreak, getTwist, getRoadNumForEdge, getPokemonByIndex, isPokemon, genderBadge } from './state.js';
import { ROAD_SPEED_WALK, ROAD_SPEED_RUN, ROAD_SPEED_BIKE, PX_PER_METER } from './config.js';
import { formatLogTime } from './pokedex.js';
import * as road from './road.js';

// DOM 快捷获取
export const $ = id => document.getElementById(id);

// ---------- 切歌提示 ----------
let _npInT = null;
let _npOutT = null;
function setRoll(container, text) {
  if (!container) return;
  let inner = container.firstElementChild;
  if (!inner) { inner = document.createElement('span'); container.appendChild(inner); }
  inner.textContent = text;
  const overflow = inner.scrollWidth > container.clientWidth;
  container.classList.toggle('scrolling', overflow);
  if (overflow) {
    container.style.setProperty('--marquee', (container.clientWidth - inner.scrollWidth) + 'px');
    inner.style.animation = 'none';
    void inner.offsetWidth;
    inner.style.animation = '';
  }
}
export function showNowPlaying(title, artist) {
  const el = $('nowPlaying');
  if (!el) return;
  const idle = $('idleView');
  if (!idle || idle.style.display !== 'flex') return;
  const t = el.querySelector('.now-playing-title');
  const a = el.querySelector('.now-playing-artist');
  clearTimeout(_npInT);
  clearTimeout(_npOutT);
  el.classList.remove('np-in', 'np-out');
  el.style.display = 'flex';
  void el.offsetWidth;
  setRoll(t, title);
  setRoll(a, artist || '');
  void el.offsetWidth; // 重启动画
  el.classList.add('np-in');
  _npInT = setTimeout(() => {
    el.classList.remove('np-in');
    el.classList.add('np-out');
    _npOutT = setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('np-out');
    }, 650);
  }, 2800);
}

// ---------- 视图切换 ----------
// 全部全屏视图 id：显示切换与"记录返回来源"共用同一份列表
const VIEW_IDS = ['idleView','introView','phoneView','pokedexView','encounterView','hatchView','hatchAllView','gpsView','bountyView','dataView','achievementView','shopView','settingsView','tutorialView','declarationView','systemLogView','incubatorView','incubatorEggView','mixerView','berryView','rosterView','moveEditView','tradeView','battleView','teamView','trainView','nurseryView','casinoView','casinoGameView','mahjongView','gachaView','gachaHistoryView','casinoHistoryView','albumView','followerView','dispatchView'];
const CASINO_VIEWS = new Set(['casinoView', 'casinoGameView', 'mahjongView', 'gachaView', 'gachaHistoryView', 'casinoHistoryView']);
let _currentView = 'idleView';

// 当前可见视图 id（背包经验糖果等浮层来源导航用：从哪个页面进入，返回就回哪个页面）
export function getCurrentView() { return _currentView; }

export function showView(id) {
  // 切换视图即关闭残留确认框（如游戏币不足提示），避免离开页面后再次进入仍显示
  hideConfirmBar();
  if (id === 'idleView' && phase === 'encounter') {
    id = 'encounterView';
  }
  if (id === 'encounterView' && phase === 'idle') {
    id = 'idleView';
  }
  // 离开游戏厅：仅当 nav 栈中不再有任何游戏厅页面时才停止音乐
  if (CASINO_VIEWS.has(_currentView) && !CASINO_VIEWS.has(id)) {
    if (!_navStack.some(v => CASINO_VIEWS.has(v))) {
      import('./audio.js').then(m => m.endCasino());
    }
  }
  // 离开导航页时若仍停在「待选骑行目的地」（点了背包自行车、未选目的地就退出/返回/切换页面）：
  // 放弃待选并恢复进入待选前的导航，保证下次进入导航页是正常状态，不会卡在选择骑行目的地。
  // 选好目的地后 pendingBike 已被 consumePendingBike 清空，不会误恢复。
  if (id !== 'gpsView' && $('gpsView')?.style.display === 'flex' && gameData?.gps?.pendingBike) {
    import('./gps.js').then(m => m.abandonBikeTarget());
  }
  const wasOnGameView = $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none' || $('hatchView')?.style.display !== 'none';
  VIEW_IDS.forEach(v => {
    const el = $(v);
    if (el) el.style.display = v === id ? 'flex' : 'none';
  });
  _currentView = id;
  // 视图切换立即同步时空扭曲配色（紫色主题仅在挂机/遭遇页生效，离开即恢复）
  import('./events.js').then(m => m.syncTwistTheme());
  updateStats(); // 视图切换立即刷新状态栏：进入游戏厅立刻显示 coin，离开立刻隐藏
  // 重新进入孵蛋器：重置记录页/选蛋页状态，总是回到主列表
  if (id === 'incubatorView') {
    _incLogOpen = false;
    _eggPickSlot = null;
    // 保留 _eggPickQuery：放入蛋后仍保留上次搜索词，方便继续放同种蛋（点清空按钮才重置）
    _incLogPrevTitle = null;
  }
  // 孵蛋结果确认页离开游戏页时：若期间挂起过野生遭遇则恢复该遭遇，
  // 否则按原流程回到空闲，避免 phase 停留在 eggResult。
  if (wasOnGameView && phase === 'eggResult' && !_eggHatching && id !== 'encounterView') {
    import('./items.js').then(m => m.finalizeEggResultContext());
  }
  if (wasOnGameView && id !== 'idleView' && id !== 'encounterView') {
    import('./battle.js').then(m => {
      m.cancelBgResultReplay();
      // 离开游戏页时若正停在手动捕获的"是否查看详情"确认框（phase='caught'）：
      // 确认框随视图隐藏后无人点击，不清理会导致返回挂机页时道路不移动、不再遇敌
      m.finalizePendingCatch();
    });
  }
  if (!wasOnGameView && (id === 'idleView' || id === 'encounterView')) {
    setTimeout(() => {
      // 返回游戏页：随从可能因 road-layer 重建或此前被隐藏，重新挂载/恢复显示
      import('./follower.js').then(m => m.refreshRoadFollower());
      import('./battle.js').then(async m => {
        // 后台结算（遭遇被 NPC 对战打断）结果补播：切回游戏页时重放最终捕捉/逃跑动画
        if (await m.replayBgResult()) return;
        // 后台捕捉仍在进行：切回遭遇画面，后续丢球动画在可见状态下照常播放
        if (await m.resumeBgEncounter()) return;
        if (phase === 'encounter' && currentEncounter) {
          // 遭遇待处理（暂停策略等后台遭遇）：切到战斗页展示，避免回到挂机页看不见
          showView('encounterView');
          $('fleeBtn').style.display = '';
          const loadPromise = m.renderEncounterScene(currentEncounter);
          const fr = m.catchFilterResult();
          if (gameData.settings?.autoCatch && fr === 'catch') {
            await loadPromise; // 等图片加载完再丢球，避免尺寸错乱
            m.autoCatch();
          } else if (gameData.settings?.autoCatch && fr === 'flee') {
            await loadPromise; // 等图片加载完再逃跑，避免画面残留
            m.fleeEncounter(true);
          } else if (gameData.settings?.autoFlee && !gameData.settings?.autoCatch && fr !== 'stop') {
            m.startAutoFleeTimer();
          }
        }
      });
    }, 0);
  }
  const PHONE_VIEWS = new Set(['phoneView','gpsView','pokedexView','incubatorView','hatchView','hatchAllView','berryView','mixerView','dataView','achievementView','systemLogView','tutorialView','rosterView','moveEditView','tradeView','battleView','teamView','trainView','nurseryView','casinoView','albumView']);
  document.querySelectorAll('.control-btn.window-icon[data-view]').forEach(btn => {
    const on = btn.dataset.view === id || (btn.dataset.view === 'phoneView' && PHONE_VIEWS.has(id));
    btn.classList.toggle('active', on);
  });
  if (id === 'idleView') {
    if (_fishing) {
      import('./fishing.js').then(m => m.applyFishingVisual());
    } else {
      setIdleCharacter('walk');
    }
    road.refreshSize();
  }

  if (id !== 'encounterView' && id !== 'hatchView') {
    hideTextBox();
  } else if (id === 'encounterView' && phase === 'encounter' && currentEncounter) {
    const box = $('textBox');
    const tc = $('animThrowChar');
    if (box && !box.classList.contains('show')) {
      const screen = $('screen');
      if (screen) {
        screen.classList.add('encounter-intro');
        setTimeout(() => screen.classList.remove('encounter-intro'), 750);
      }
      box.style.display = 'flex';
      box.style.transform = 'translateY(100%)';
      void box.offsetHeight;
      box.classList.add('show');
      box.style.transform = 'translateY(0)';
      if (tc) {
        tc.style.transition = 'none';
        tc.style.bottom = '0';
        void tc.offsetHeight;
        tc.style.transition = 'bottom 0.7s cubic-bezier(0.22, 1, 0.36, 1)';
        tc.style.bottom = '52px';
      }
    }
    $('fleeBtn').style.display = '';
    if (tc) tc.style.display = '';
    if (tc) tc.classList.remove('throwing');
  }
  const title = $('appTitle');
  if (id === 'idleView' || id === 'encounterView' || id === 'introView') {
    title.innerHTML = '口袋挂机';
    title.dataset.action = '';
  } else {
    const names = { phoneView:'手机', pokedexView:'图鉴', gpsView:'导航', bountyView:'地区悬赏', dataView:'统计', achievementView:'成就', shopView:'商店', settingsView:'设置', tutorialView:'教程', declarationView:'版权声明', systemLogView:'系统日志', incubatorView:'孵蛋器', incubatorEggView:'放入蛋', hatchView:'孵化', hatchAllView:'孵化全部', mixerView:'混合器', berryView:'农场', rosterView:'宝可梦', moveEditView:'配招', tradeView:'交换', battleView:'对战', teamView:'配队', trainView:'训练', nurseryView:'饲育屋', dispatchView:'派遣', casinoView:'游戏厅', casinoGameView:'21 点', mahjongView:'口袋麻将', gachaView:'抽卡机', gachaHistoryView:'抽卡记录', casinoHistoryView:'战绩记录', albumView:'卡册', followerView:'随从' };
    title.innerHTML = `<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> ${names[id]||''}`;
    title.dataset.action = 'back';
  }
}

// ---------- 底部文字框 ----------
export function updateTextBox(text, showArrow) {
  // 底部文字框只在游戏页（挂机/遇敌）或孵蛋页显示；孵蛋页文案由孵蛋流程显式调用，
  // 其他页面一律隐藏。遭遇页的文案调用方都用 isOnGameView() 先做判断，不会漏到孵蛋页。
  if (!isOnGameView() && !isOnHatchView()) return;
  const box = $('textBox');
  const content = $('textBoxContent');
  const arrow = $('textBoxArrow');
  if (!box || !content) return;
  content.textContent = text;
  if (arrow) arrow.style.display = showArrow ? 'flex' : 'none';
  if (box.classList.contains('show')) return;
  box.style.display = 'flex';
  requestAnimationFrame(() => {
    box.style.transform = 'translateY(100%)';
    void box.offsetHeight;
    box.classList.add('show');
    box.style.transform = 'translateY(0)';
  });
}

export function hideTextBox() {
  const box = $('textBox');
  if (!box) return;
  box.classList.remove('show');
  box.style.transform = 'translateY(100%)';
  box.style.display = 'none';
  $('textBoxArrow').style.display = 'none';
}

// ---------- 通用底部确认文案框 ----------
// 复用 .text-box.shop-text-box 样式，动态创建、用完即删。
// 传入文案和确定/取消回调；onYes 返回 true 则保持显示（用于结算结果停留），返回 falsy 则关闭。
let _confirmBarId = 0;
export function showConfirmBar(text, onYes, onNo, opts = {}) {
  hideConfirmBar();
  const bar = document.createElement('div');
  bar.id = 'confirmBar';
  bar.className = 'text-box shop-text-box';
  // opts.singleButton：仅显示一个「确定」按钮（无需确认/取消的提示场景）
  const btnsHtml = opts.noButtons ? '' : `<div class="shop-confirm-btns">
      <span class="catch-confirm-btn" data-cb-yes>确定</span>
      ${opts.singleButton ? '' : `<span class="catch-confirm-btn" data-cb-no>取消</span>`}
    </div>`;
  bar.innerHTML = `<div class="text-box-content">${text}</div>${btnsHtml}`;
  const host = opts.host
    || document.querySelector('.view-fixed[style*="display: flex"], .view-fixed[style*="display:flex"]')
    || document.querySelector('.view-scroll[style*="display: flex"], .view-scroll[style*="display:flex"]')
    || document.body;
  host.appendChild(bar);
  // opts.overlay：加全屏透明遮罩，点击遮罩（textbox 以外）视为取消；同时挡住下层按钮防止重复触发
  let overlay = null;
  if (opts.overlay) {
    overlay = document.createElement('div');
    overlay.id = 'confirmOverlay';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:40;background:transparent;';
    host.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onNo) onNo();
      hideConfirmBar();
    });
  }
  bar.style.display = 'flex';
  bar.style.transform = 'translateY(100%)'; // 先藏在底部
  // 下一帧滑入，触发 .text-box 的 transition: transform 0.25s
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bar.style.transform = '';
    });
  });
  if (opts.height) bar.style.height = opts.height;
  if (!opts.noButtons) {
    bar.querySelector('[data-cb-yes]').addEventListener('click', (e) => {
      // 确认按钮不冒泡：避免误触 document 级"点击面板外部关闭"等监听（如确认后刚打开的面板被瞬间关闭）
      e.stopPropagation();
      const keep = onYes ? onYes() : undefined;
      if (!keep) hideConfirmBar();
    });
    // singleButton 模式无「取消」按钮，需判空再绑定
    const noBtn = bar.querySelector('[data-cb-no]');
    if (noBtn) noBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onNo) onNo();
      hideConfirmBar();
    });
  }
  return bar;
}

export function hideConfirmBar() {
  const bar = document.getElementById('confirmBar');
  if (bar) bar.remove();
  const ov = document.getElementById('confirmOverlay');
  if (ov) ov.remove();
}

export function isOnGameView() {
  // 仅主界面 / 遇敌页属于"游戏页"：孵蛋页是独立页面，遭遇/丢球文案、动画与视图切换都不得作用其上
  return $('idleView').style.display !== 'none' || $('encounterView').style.display !== 'none';
}

// 是否在孵蛋独立页（hatchView）：孵蛋动画/结果文案的可见性判断专用，与游戏页完全隔离
export function isOnHatchView() {
  return $('hatchView')?.style.display !== 'none';
}

// ---------- 角色系统 ----------
// 增益（甜甜蜜/闪耀护符）生效时主角改为跑步
export function isBuffActive() {
  return !!(window.__honeyBuffActive__ || window.__charmBuffActive__);
}

export function applyCharSprites() {
  const prefix = getCharPrefix();
  const backImg = document.querySelector('#animThrowChar .anim-throw-char-img');
  if (backImg) backImg.src = `./character/${prefix}-back.png`;
  const hero = document.querySelector('.splash-hero');
  if (hero) hero.src = `./character/${prefix}-front.png`;
  setIdleCharacter('walk');
}

// 当前角色前缀（按设置里的性别）：'brendan' 或 'may'
export function getCharPrefix() {
  return gameData.settings?.gender === 'may' ? 'may' : 'brendan';
}

const GET_ITEM_Y = {
  'poke-ball': 0,     'ultra-ball': -46,   'master-ball': -92,
  'mystery-egg': -138,      'sweet-honey': -184,
  'shiny-charm': -230, 'candy': -276,
};

let _getItemRaf = null;

function startGetItemAnim(el, yOffset) {
  if (_getItemRaf) { cancelAnimationFrame(_getItemRaf); _getItemRaf = null; }
  const frames = 5;
  const frameW = 64;
  const dur = 800;
  const startT = performance.now();
  function frame(now) {
    const t = Math.min((now - startT) / dur, 1);
    const idx = Math.min(Math.floor(t * frames), frames - 1);
    el.style.backgroundPosition = `${-idx * frameW}px ${yOffset}px`;
    if (t < 1) {
      _getItemRaf = requestAnimationFrame(frame);
    }
  }
  _getItemRaf = requestAnimationFrame(frame);
}

export function setIdleCharacter(state, itemKey) {
  const el = $('walkGif');
  if (!el) return;
  el.className = 'walk-gif';
  el.style.backgroundImage = '';
  el.style.backgroundSize = '';
  el.style.backgroundPosition = '';
  if (state === 'get-item') {
    el.classList.add('get-item');
    if (itemKey && GET_ITEM_Y[itemKey] !== undefined) {
      el.style.backgroundImage = `url("./character/${getCharPrefix()}-get-all.png")`;
      el.style.backgroundSize = '320px 322px';
      startGetItemAnim(el, GET_ITEM_Y[itemKey]);
    }
  } else {
    if (road.isBike()) {
      el.classList.add('bike');
      road.setSpeed(ROAD_SPEED_BIKE);
    } else if (isBuffActive()) {
      el.classList.add('run');
      road.setSpeed(ROAD_SPEED_RUN);
    } else {
      el.classList.add('walk');
      road.setSpeed(ROAD_SPEED_WALK);
    }
    el.classList.add(getCharPrefix());
  }
  if ($('gpsView')?.style.display === 'flex') {
    import('./gps.js').then(m => m.refreshGpsRender());
  }
}

// ---------- 图片尺寸自适应 ----------
let _stageCache = null;
export function getStageSize() {
  if (_stageCache && _stageCache.w >= 280 && _stageCache.h >= 250) return _stageCache;
  const innerRect = $('screenInner')?.getBoundingClientRect();
  let w = innerRect?.width || 0;
  let h = innerRect?.height || 0;
  if (w < 50 || h < 50) {
    const screenRect = document.querySelector('.screen')?.getBoundingClientRect();
    w = (screenRect?.width || 0) - 6;
    h = (screenRect?.height || 0) - 6;
  }
  if (w < 50 || h < 50) {
    w = window.innerWidth;
    h = window.innerHeight;
  }
  if (w >= 280 && h >= 250) _stageCache = { w, h };
  return { w, h };
}

export function fitPokemonImage(img) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return;
  img.style.width = '';
  img.style.height = '';
  img.style.objectFit = '';
  if (!img.closest('#encounterView') && !img.closest('#hatchView')) return;
  const { h: stageH } = getStageSize();
  const maxH = stageH * 0.58;
  if (img.naturalHeight > maxH) {
    const scale = maxH / img.naturalHeight;
    img.style.width = Math.floor(img.naturalWidth * scale) + 'px';
    img.style.height = Math.floor(maxH) + 'px';
  }
}

// ---------- 图片加载 ----------
const _imgCache = new Map();
// 加载失败路径缓存（negative cache）：失败后不再重试，避免大列表反复请求不存在的图标
// 耗尽浏览器资源（ERR_INSUFFICIENT_RESOURCES）；重启会话后清空可重新尝试
const _imgFail = new Set();
// 同一路径正在加载中的队列：多个 img 元素（如多只同种宝可梦）请求同一图标时，
// 只发一次网络请求，其余挂入等待列表，加载完成后统一回填
const _imgLoads = new Map(); // relPath -> { imgs: [{img, resolve}] }
function _cacheSet(key, val) {
  if (_imgCache.size >= 800) {
    const oldKey = _imgCache.keys().next().value;
    const oldVal = _imgCache.get(oldKey);
    // 淘汰时释放 blob URL，否则反复渲染大列表会持续泄漏内存直至资源耗尽
    if (oldVal && oldVal.startsWith('blob:')) URL.revokeObjectURL(oldVal);
    _imgCache.delete(oldKey);
  }
  _imgCache.set(key, val);
}

// 加载中的透明占位图（1px 透明 gif）：未命中缓存的图在加载期间显示它，
// 避免浏览器默认破图图标一闪而过；加载成功/失败后都会替换
const _TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function tryLoadImage(img, relPath) {
  // 竞态防护：记录当前期望加载的目标路径。旧请求的慢通道（fetch/IPC）完成时，
  // 若发现目标已被新请求接管则作废，防止把遭遇图等覆盖回上一只宝可梦
  img.dataset.loadTarget = relPath;
  if (_imgFail.has(relPath)) {
    // 之前已确认加载失败：直接透明占位，不再发任何请求
    img.onload = null; img.onerror = null;
    if (img.src !== _TRANSPARENT) img.src = _TRANSPARENT;
    return Promise.resolve(false);
  }
  const hit = _imgCache.get(relPath);
  if (hit) {
    return new Promise(resolve => {
      img.onload = () => { img.onerror = null; resolve(true); };
      img.onerror = () => { if (img.dataset.loadTarget !== relPath) { resolve(true); return; } _imgCache.delete(relPath); img.src = _TRANSPARENT; resolve(false); };
      img.src = hit;
      if (img.complete) resolve(true);
    });
  }
  // 同一路径已有加载流程在跑：挂入等待列表，完成后统一回填，避免多只同种个体并发重复请求
  const existing = _imgLoads.get(relPath);
  if (existing) {
    // 等待期间先透明占位，避免空 src 露出破图
    if (img.src !== _TRANSPARENT) img.src = _TRANSPARENT;
    return new Promise(resolve => {
      const w = { img, resolve };
      existing.imgs.push(w);
      // 兜底：首请求若卡死（如行图标被移出 DOM 后加载中断、onload/onerror 不再触发），
      // 等待者 3s 后自行建立加载链路，避免永久不显示
      w.timer = setTimeout(() => {
        const i = existing.imgs.indexOf(w);
        if (i >= 0) existing.imgs.splice(i, 1);
        _imgLoads.delete(relPath);
        tryLoadImage(img, relPath).then(resolve);
      }, 3000);
    });
  }
  // 立即切透明占位：加载期间与失败后都不会露出浏览器破图图标
  if (img.src !== _TRANSPARENT) img.src = _TRANSPARENT;
  const entry = { imgs: [] };
  _imgLoads.set(relPath, entry);
  return new Promise(resolve => {
    const ext = (relPath.split('.').pop() || 'png').toLowerCase();
    const dbg = { raw: 0, encoded: 0, fetch: 0, tauri: 0, fail: 0, key: relPath };
    const dbgLog = () => console.warn('[img] load path ->', JSON.stringify(dbg));
    // 注意：onerror 内不得改写 img.src（会触发新的 onload 事件，污染各通道的成败判定），
    // 透明占位已在函数入口设置，失败时保持透明即可
    const doRaw = () => new Promise(r => {
      dbg.raw++;
      // 兜底超时：img 被移出 DOM 时浏览器可能不再触发 onload/onerror，避免链路永久挂起
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; r(false); } }, 4000);
      img.onload = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        img.onerror = null;
        // 网络加载成功即入缓存：即使首请求已被新请求接管（作废），缓存仍供等待者回填
        _cacheSet(relPath, relPath);
        r(true);
      };
      img.onerror = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (img.dataset.loadTarget !== relPath) { r(true); return; }
        r(false);
      };
      img.src = relPath;
    });
    const doEncoded = () => new Promise(r => {
      dbg.encoded++;
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; r(false); } }, 4000);
      img.onload = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        img.onerror = null;
        _cacheSet(relPath, encodeURI(relPath));
        r(true);
      };
      img.onerror = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (img.dataset.loadTarget !== relPath) { r(true); return; }
        r(false);
      };
      img.src = encodeURI(relPath);
    });
    const doFetch = () => fetch(encodeURI(relPath)).then(r => {
      if (!r.ok) return false;
      return r.blob().then(blob => {
        // 文件不存在时可能返回 200+空内容，校验 blob 类型避免坏数据入缓存导致破图
        if (!blob || blob.size === 0 || (blob.type && !blob.type.startsWith('image/'))) return false;
        dbg.fetch++;
        const url = URL.createObjectURL(blob);
        const prev = _imgCache.get(relPath);
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        _cacheSet(relPath, url);
        return new Promise(r => {
          img.onload = () => { if (img.dataset.loadTarget !== relPath) { r(true); return; } r(true); };
          img.onerror = () => { URL.revokeObjectURL(url); if (_imgCache.get(relPath) === url) _imgCache.delete(relPath); if (img.dataset.loadTarget !== relPath) { r(true); return; } r(false); };
          // 等待期间目标已被新请求接管：blob 已入缓存供等待者回填，不再写回旧图
          if (img.dataset.loadTarget !== relPath) { r(true); return; }
          img.src = url;
        });
      });
    }).catch(() => false);
    const doTauri = () => {
      if (!window.__TAURI__?.core?.invoke) return Promise.resolve(false);
      dbg.tauri++;
      const fp = relPath.replace(/^\.\//, '');
      // IPC 读图可能被其他后台命令阻塞，加超时避免 Promise 永久挂起（否则遭遇图等待会一直 pending）
      return new Promise(r => {
        let done = false;
        const timer = setTimeout(() => { if (!done) { done = true; r(false); } }, 3000);
        window.__TAURI__.core.invoke('read_gif_base64', { path: fp })
          .then(b64 => {
            if (done) return;
            done = true; clearTimeout(timer);
            new Promise(r2 => {
              img.onload = () => { if (img.dataset.loadTarget !== relPath) { r2(true); return; } _cacheSet(relPath, `data:image/${ext};base64,${b64}`); r2(true); };
              img.onerror = () => { if (img.dataset.loadTarget !== relPath) { r2(true); return; } r2(false); };
              // 等待期间目标已被新请求接管：数据仍入缓存供等待者回填，不再写回旧图
              if (img.dataset.loadTarget !== relPath) { _cacheSet(relPath, `data:image/${ext};base64,${b64}`); r2(true); return; }
              img.src = `data:image/${ext};base64,${b64}`;
            }).then(r);
          })
          .catch(() => { if (!done) { done = true; clearTimeout(timer); r(false); } });
      });
    };
    // 首个加载流程完成：登记失败缓存并回填所有等待的 img（成功用缓存 URL，失败透明占位）
    const finish = (ok) => {
      _imgLoads.delete(relPath);
      if (!ok) {
        _imgFail.add(relPath); dbg.fail++; dbgLog();
        // 首图失败时恢复透明占位：避免 src 停留在失败 URL 露出破图
        if (img.dataset.loadTarget === relPath && img.src !== _TRANSPARENT) img.src = _TRANSPARENT;
      }
      const url = _imgCache.get(relPath);
      entry.imgs.forEach(w => {
        clearTimeout(w.timer);
        w.img.onload = null; w.img.onerror = null;
        if (ok && url) {
          w.img.src = url;
          if (!w.img.complete) w.img.onload = () => { w.img.onerror = null; w.resolve(true); };
          w.resolve(true);
        } else {
          if (w.img.src !== _TRANSPARENT) w.img.src = _TRANSPARENT;
          w.resolve(false);
        }
      });
      resolve(ok);
    };
    // 依次尝试各通道：任一成功即短路（返回 true 沿链路传播），全失败才记录日志
    doRaw()
      .then(ok => (ok ? true : doEncoded()))
      .then(ok => (ok ? true : doFetch()))
      .then(ok => (ok ? true : doTauri()))
      .then(finish)
      .catch(() => finish(false));
  });
}

export function tryLoadPokemonImage(img, poke, suffix) {
  const idx = String(poke.index);
  // 变体条目 form 存形态全名（如"风速狗-洗翠"），图片文件名按全名命名；本体无 form 用 name
  const name = poke.form || poke.name;
  const primaryExt = poke.image?.endsWith('.png') ? 'png' : 'gif';
  const fallbackExt = primaryExt === 'png' ? 'gif' : 'png';
  function tryLoad(ext) {
    const ip = `./pokemon-data/images/${idx}-${name}${suffix}.${ext}`;
    return tryLoadImage(img, ip).then(ok => { if (ok) fitPokemonImage(img); return ok; });
  }
  return tryLoad(primaryExt).then(ok => ok ? true : tryLoad(fallbackExt));
}

// 加载宝可梦头像 icon
export function tryLoadPokemonIcon(img, poke) {
  const idx = String(poke.index);
  const ip = `./pokemon-data/icon/${idx}-${poke.form || poke.name}.png`;
  return tryLoadImage(img, ip);
}

// ---------- 背包更新 ----------
export function updateBackpack(popItem) {
  for (const [item, qty] of Object.entries(gameData.items)) {
    const el = document.getElementById(`bag-${item}`);
    if (el) {
      const slot = el.closest('.bag-slot');
      // 骑行中自行车槽：半透明（与增益道具激活同款）+ 数量显示「下车」，下车后恢复
      if (item === 'bike' && road.isManualBike()) {
        slot?.classList.add('disabled');
        el.textContent = '下车';
        _prevBagCounts[item] = qty;
        continue;
      }
      // 骑行中增益道具槽：持续置灰（交互拦截在 onBagClick，视觉防误点；骑行中不拾取，数量不变）
      if (road.isManualBike() && (item === 'sweet-honey' || item === 'shiny-charm')) {
        slot?.classList.add('disabled');
        _prevBagCounts[item] = qty;
        continue;
      }
      if (!slot?.classList.contains('disabled')) {
        el.textContent = formatNum(qty);
      }
      const prev = _prevBagCounts[item] ?? qty;
      if (qty > prev) {
        const icon = el.closest('.bag-slot')?.querySelector('.bag-icon');
        if (icon) {
          icon.classList.remove('pop');
          void icon.offsetHeight;
          icon.classList.add('pop');
          setTimeout(() => icon.classList.remove('pop'), 500);
        }
      }
      _prevBagCounts[item] = qty;
    }
  }
  if (popItem) {
    const icon = document.querySelector(`.bag-slot[data-item="${popItem}"] .bag-icon`);
    if (icon) {
      icon.classList.remove('pop');
      void icon.offsetHeight;
      icon.classList.add('pop');
      setTimeout(() => icon.classList.remove('pop'), 500);
    }
  }
}
let _prevBagCounts = {};

// ---------- 状态栏更新 ----------
export function updateStats() {
  const candy = gameData.items['candy'] || 0;
  const coin = gameData.items['casinoCoin'] || 0;
  const coinHtml = /casino|mahjong|gacha/i.test(_currentView) ? ` <img src="./items/coin.png" style="width:14px;height:14px;vertical-align:middle;image-rendering:pixelated;margin-left:4px;" /> ${formatNum(coin)}` : '';
  $('statProgress').innerHTML = `<img src="./items/candy.png" style="width:14px;height:14px;vertical-align:middle;image-rendering:pixelated;" /> ${formatNum(candy)}${coinHtml}`;
  const g = gameData?.gps;
  const region = getCurrentRegion();
  const onRoad = !!(g && g.path && g.path.length >= 2 && g.seg < g.path.length - 1 && g.totalPx > 0);
  const road = onRoad ? getCurrentRoadInfo() : null;
  $('statTime').textContent = road
    ? `${road.num}#道路（${road.name}）`
    : region.name;
  const autoEl = $('statAutoStatus');
  const autoText = $('statAutoText');
  const autoBar = $('statAutoBar');
  if (autoEl && autoText && autoBar) {
    const hint = $('statDropHint');
    if (hint && hint.style.display !== 'none' && hint.textContent) {
      // 掉落提示显示期间互斥：整个自动模式状态栏隐藏（含佛系进度条）
      autoEl.style.display = 'none';
    } else if (gameData.settings?.autoCatch) {
      const balls = gameData.settings?.autoCatchBalls || {};
      const enabled = ['poke-ball','ultra-ball','master-ball'].filter(b => balls[b] !== false);
      const hasStock = enabled.some(b => (gameData.items[b]||0) > 0);
      autoText.textContent = hasStock ? '自动捕捉中' : '自动逃跑中';
      autoEl.style.display = '';
      autoBar.style.display = 'none';
      if (autoBar.parentElement) autoBar.parentElement.style.display = 'none';
    } else if (gameData.settings?.autoFlee) {
      autoText.textContent = '佛系模式';
      autoEl.style.display = '';
      if (phase !== 'encounter') {
        autoBar.style.display = 'none';
        if (autoBar.parentElement) autoBar.parentElement.style.display = 'none';
      }
    } else {
      autoText.textContent = '手动模式';
      autoEl.style.display = '';
      autoBar.style.display = 'none';
      if (autoBar.parentElement) autoBar.parentElement.style.display = 'none';
    }
  }
}

// ---------- 孵蛋器红点 ----------
export function updateIncubatorBadge() {
  const badge = $('phone-badge-incubator');
  if (badge) badge.style.display = anyIncubatorReady() ? '' : 'none';
}

// ---------- 孵蛋器视图渲染 ----------
// 空槽点加号弹出选择菜单（神秘蛋 / 宝可梦蛋），无需顶部页签
let _eggPickSlot = null; // 菜单选「宝可梦蛋」后正在选蛋的槽位下标；null = 未在选蛋
let _eggPickSortBy = null;  // 选蛋列表排序列：null=默认按获得时间 | name | iv
let _eggPickSortDir = 1;    // 1 升序 / -1 降序
let _eggPickQuery = '';     // 选蛋列表搜索文本
let _incLogOpen = false; // 孵蛋记录页是否打开（点顶部"孵蛋记录"进入，返回后关闭）
let _incLogPrevTitle = null; // 打开记录页前的标题栏内容（关闭时还原）

// 孵蛋记录页是否打开（main.js 标题返回时判断：开 → 只关记录页，不走正常返回）
export function isIncubatorLogOpen() { return _incLogOpen; }
// 关闭记录页并还原标题栏，回主列表
export function closeIncubatorLog() {
  _incLogOpen = false;
  const t = $('appTitle');
  if (t && _incLogPrevTitle != null) {
    t.innerHTML = _incLogPrevTitle;
    _incLogPrevTitle = null;
  }
  renderIncubatorView();
}

// 槽位内蛋的 hover 提示名：宝可梦蛋显示「XX的蛋」，神秘蛋显示「神秘蛋」；
// 槽位列表统一显示「蛋」，hover 时经 data-tip 弹出具体名称
function slotEggName(s) {
  if (s && s.eggRef) {
    const eggEntry = (gameData.roster || []).find(r => r.id === s.eggRef);
    if (eggEntry) {
      const poke = getPokemonByIndex(String(eggEntry.species));
      return (poke ? poke.name : `#${eggEntry.species}`) + '的蛋';
    }
  }
  return '神秘蛋';
}

// 六维个体值斜杠串：31/31/31/31/31/31（HP/攻击/防御/特攻/特防/速度，与繁殖页面一致；
// 蛋条目在生成时已 roll 好个体值，是孵蛋前唯一已知的信息）
function eggIvSlash(p) {
  if (!p || !p.ivs) return '0/0/0/0/0/0';
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => p.ivs[k] || 0).join('/');
}

// 宝可梦蛋列表：从仓库蛋条目选一枚放入空槽
// 复用 nursery 蛋仓库的样式（nursery-egg-page / nursery-egg-row）
function renderEggPickList() {
  const box = $('incubatorEggView');
  if (!box) return;
  const inUse = new Set((gameData.incubators || []).map(s => s && s.eggRef).filter(Boolean));
  const allEggs = (gameData.roster || [])
    .filter(p => p.inRoster && !isPokemon(p) && !inUse.has(p.id));
  // 搜索过滤
  let filtered = allEggs;
  const q = (_eggPickQuery || '');
  if (q) {
    const lq = q.toLowerCase();
    filtered = allEggs.filter(eg => {
      const poke = getPokemonByIndex(String(eg.species));
      if (!poke) return false;
      const idx = String(eg.species);
      return poke.name.includes(lq) || poke.pinyin?.toUpperCase().includes(lq.toUpperCase()) ||
        poke.pinyinInitials?.toUpperCase().includes(lq.toUpperCase()) || idx.includes(lq);
    });
  }
  // 排序
  const sorted = [...filtered].sort((a, b) => {
    let va, vb;
    if (_eggPickSortBy === 'name') {
      va = getPokemonByIndex(String(a.species))?.name || '';
      vb = getPokemonByIndex(String(b.species))?.name || '';
      return va.localeCompare(vb) * _eggPickSortDir;
    } else if (_eggPickSortBy === 'iv') {
      va = (a.ivs ? (a.ivs.hp + a.ivs.atk + a.ivs.def + a.ivs.spa + a.ivs.spd + a.ivs.spe) : 0);
      vb = (b.ivs ? (b.ivs.hp + b.ivs.atk + b.ivs.def + b.ivs.spa + b.ivs.spd + b.ivs.spe) : 0);
      return (va - vb) * _eggPickSortDir;
    }
    // time: newest first by default (_eggPickSortDir 控制）
    va = a.obtainedAt || 0; vb = b.obtainedAt || 0;
    return (va - vb) * _eggPickSortDir;
  });

  // 已渲染过选蛋页：只增量更新进度/排序标记/列表，避免重建销毁搜索框导致失焦
  const existingPage = box.querySelector('.nursery-egg-page');
  if (existingPage) {
    const progress = existingPage.querySelector('.pokedex-progress');
    if (progress) progress.textContent = allEggs.length ? `共 ${allEggs.length} 个蛋可选${q ? '（匹配 ' + sorted.length + ' 个）' : ''}` : '暂无宝可梦蛋';
    const inp = existingPage.querySelector('#incubatorEggSearch');
    if (inp && inp.value.trim() !== q) inp.value = _eggPickQuery;
    const clearBtn = existingPage.querySelector('#incubatorEggSearchClear');
    if (clearBtn) clearBtn.style.display = q ? '' : 'none';
    existingPage.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
    const cur = existingPage.querySelector(`[data-sort="${_eggPickSortBy}"]`);
    if (cur && _eggPickSortBy) cur.classList.add(_eggPickSortDir === 1 ? 'sort-asc' : 'sort-desc');
    const listScroll = existingPage.querySelector('.list-scroll');
    if (listScroll) {
      listScroll.innerHTML = sorted.length === 0
        ? (q ? '<div class="roster-empty">无匹配的蛋</div>' : '<div class="roster-empty">没有可放入的蛋<br>饲育屋收取的蛋会出现在这里</div>')
        : sorted.map(eg => {
            const poke = getPokemonByIndex(String(eg.species));
            const name = poke ? poke.name : `#${eg.species}`;
            return `
              <div class="pokedex-entry roster-row nursery-egg-row" data-egg-pick="${eg.id}">
                <span class="pokedex-name"><img class="roster-icon-img" src="./items/mystery-egg.png" alt="蛋" style="width:18px;height:18px;" />${name}的蛋${eg.shiny ? ' ★' : ''}</span>
                <span class="roster-iv">${eggIvSlash(eg)}</span>
              </div>`;
          }).join('');
      // 重新绑定行点击
      listScroll.querySelectorAll('[data-egg-pick]').forEach(item => {
        item.addEventListener('click', () => {
          const sid = _eggPickSlot;
          const eid = item.dataset.eggPick;
          _eggPickSlot = null;
          import('./items.js').then(m => m.placePokemonEggInIncubator(sid, eid));
          setTimeout(() => closeIncubatorEggView(), 0);
        });
      });
    }
    return;
  }

  box.innerHTML = `
    <div class="nursery-egg-page view-list">
      <div class="pokedex-progress">${allEggs.length ? `共 ${allEggs.length} 个蛋可选${q ? '（匹配 ' + sorted.length + ' 个）' : ''}` : '暂无宝可梦蛋'}</div>
      <div class="pokedex-search">
        <div class="pokedex-search-row">
          <div class="pokedex-search-input-wrap">
            <input id="incubatorEggSearch" class="pokedex-search-input" type="text" placeholder="名称 / 拼音 / 首字母" autocomplete="off" value="${_eggPickQuery}" />
            <button class="pokedex-search-clear" id="incubatorEggSearchClear" style="display:${q ? '' : 'none'};" aria-label="清空搜索">
              <svg><use xlink:href="#icon-close" /></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="pokedex-header roster-header nursery-egg-header">
        <span class="pokedex-name" data-sort="name">宝可梦蛋</span>
        <span class="roster-iv" data-sort="iv">个体值</span>
      </div>
      <div class="list-scroll">
        ${sorted.length === 0
          ? (q
              ? '<div class="roster-empty">无匹配的蛋</div>'
              : '<div class="roster-empty">没有可放入的蛋<br>饲育屋收取的蛋会出现在这里</div>')
          : sorted.map(eg => {
              const poke = getPokemonByIndex(String(eg.species));
              const name = poke ? poke.name : `#${eg.species}`;
              return `
                <div class="pokedex-entry roster-row nursery-egg-row" data-egg-pick="${eg.id}">
                  <span class="pokedex-name"><img class="roster-icon-img" src="./items/mystery-egg.png" alt="蛋" style="width:18px;height:18px;" />${name}的蛋${eg.shiny ? ' ★' : ''}</span>
                  <span class="roster-iv">${eggIvSlash(eg)}</span>
                </div>`;
            }).join('')}
      </div>
    </div>`;

  // 搜索
  const input = box.querySelector('#incubatorEggSearch');
  const clearBtn = box.querySelector('#incubatorEggSearchClear');
  if (input) {
    input.addEventListener('input', () => {
      _eggPickQuery = input.value.trim();
      if (clearBtn) clearBtn.style.display = _eggPickQuery ? '' : 'none';
      renderEggPickList();
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', () => { _eggPickQuery = ''; input.value = ''; clearBtn.style.display = 'none'; renderEggPickList(); });
  // 排序（3 段 toggle：升序 → 降序 → 回到默认时间排序）
  box.querySelectorAll('.nursery-egg-header [data-sort]').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.sort;
      if (_eggPickSortBy === k) {
        if (_eggPickSortDir === 1) _eggPickSortDir = -1;
        else { _eggPickSortBy = null; _eggPickSortDir = 1; }
      } else { _eggPickSortBy = k; _eggPickSortDir = 1; }
      renderEggPickList();
    });
  });
  // 标记当前排序列
  const eggHeader = box.querySelector('.nursery-egg-header');
  if (eggHeader) {
    const cur = eggHeader.querySelector(`[data-sort="${_eggPickSortBy}"]`);
    if (cur) cur.classList.add(_eggPickSortDir === 1 ? 'sort-asc' : 'sort-desc');
  }
  // 点击列表行即放入该蛋并返回孵蛋器（保留搜索词）
  box.querySelectorAll('[data-egg-pick]').forEach(item => {
    item.addEventListener('click', () => {
      const sid = _eggPickSlot;
      const eid = item.dataset.eggPick;
      _eggPickSlot = null;
      import('./items.js').then(m => m.placePokemonEggInIncubator(sid, eid));
      setTimeout(() => closeIncubatorEggView(), 0);
    });
  });
}

// 退出选蛋页：返回孵蛋器（保留 _eggPickQuery 供下次继续搜索）
export function closeIncubatorEggView() {
  _eggPickSlot = null;
  import('../state.js').then(m => m.popNav());
  renderIncubatorView();
  showView('incubatorView');
}

// 进入选蛋独立页面
export function showIncubatorEggView() {
  import('../state.js').then(m => m.pushNav('incubatorEggView'));
  showView('incubatorEggView');
  renderEggPickList();
}

// 孵蛋记录页：单列日志列表，每条仅显示时间 / 名字 / 性别（最多 50 条）
function renderIncubatorLogList(list) {
  const logs = (gameData.incubatorLogs || [])
    .filter(l => l && l.species != null)
    .slice()
    .reverse();
  list.style.gridTemplateColumns = '1fr';
  list.classList.add('list-scroll');
  list.innerHTML = `
    <div class="rec-header">最近 ${Math.min(logs.length, 50)} 条孵蛋记录</div>
      ${logs.length === 0
        ? '<div class="rec-empty">暂无孵蛋记录<br>孵化宝可梦后会记录在这里</div>'
        : logs.map(l => {
            const poke = getPokemonByIndex(String(l.species));
            const name = poke ? (poke.form || poke.name) : `#${l.species}`;
            return `
            <div class="rec-row">
              <span class="rec-time">${formatLogTime(l.time)}</span>
              <span class="rec-main">${name}</span>
              <span class="rec-right">${genderBadge(l.gender)}</span>
            </div>`;
          }).join('')}
    </div>`;
}

export function renderIncubatorView() {
  const list = $('incubatorList');
  if (!list) return;
  const incubators = gameData.incubators || [];
  if (!incubators.length) return;
  const unlocked = gameData.incubatorUnlockedSlots ?? 0;

  // 顶部"孵蛋记录"按钮行：仅主列表显示；选蛋/记录页是独立子页，整个头部行隐藏
  const incHead = $('incubatorHead');
  if (incHead) incHead.style.display = _incLogOpen ? 'none' : '';
  const logBtn = $('incubatorLogBtn');
  // 有已孵化的蛋时按钮变为「孵化全部」，点击进入批量孵化独立页
  // （忽略只影响提醒，不影响孵化：按钮判定与批量逻辑均按全部已孵蛋）
  if (logBtn) {
    const ready = (gameData.incubators || []).some(s => s && s.hatched);
    logBtn.textContent = ready ? '孵化全部' : '孵蛋记录';
    logBtn.onclick = () => {
      if (ready) import('./items.js').then(m => m.hatchAllFromIncubator());
      else { _incLogOpen = true; renderIncubatorView(); }
    };
  }

  // 孵蛋记录页：替换标题栏为「孵蛋记录」（点击 appTitle 返回主列表），并渲染单列日志列表
  if (_incLogOpen) {
    const t = $('appTitle');
    if (t && _incLogPrevTitle == null) {
      _incLogPrevTitle = t.innerHTML;
      t.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 孵蛋记录';
      t.dataset.action = 'back';
    }
    renderIncubatorLogList(list);
    return;
  }

  list.style.gridTemplateColumns = '1fr 1fr';
  list.classList.remove('list-scroll');

  const hatchBtnHtml = (i, disabled) => `<span class="incubator-hatch-text hatched${disabled ? ' disabled' : ''}" data-slot="${i}" ${disabled ? 'style="pointer-events:none;"' : ''}>孵化</span>`;
  // 野生遭遇期间允许保留孵蛋入口：点击时优先切回遭遇画面处理；
  // 仅在 NPC 对战 / 孵蛋动画自身进行中时真正禁用，避免复用 encounterView 互相覆盖。
  const hatchLocked = phase === 'battle' || phase === 'eggResult' || _eggHatching;
  // 基准里程 = 当前最长蛋的原始里程：进度条按里程比例渲染，黄色段宽度 = 实际免掉的里程
  let maxDur = 1;
  for (const s of incubators) {
    if (s && s.eggIndex != null && !s.hatched && (s.hatchDuration || 0) > maxDur) maxDur = s.hatchDuration;
  }
  let html = '';
  for (let i = 0; i < Math.min(incubators.length, 8); i++) {
    const s = incubators[i];
    const isUnlocked = i < unlocked;
    const hasEgg = s && s.eggIndex != null;
    if (!isUnlocked && !hasEgg) {
      const cost = getIncubatorUnlockCost(i);
      const isNext = i === unlocked;
      const canAfford = (gameData.items['candy'] || 0) >= cost;
      const disabled = !isNext || !canAfford;
      html += `<div class="incubator-row locked">
        <div class="incubator-lock-icon"><img src="./items/candy.png" style="width:18px;height:18px;image-rendering:pixelated;opacity:0.5;" /><span class="incubator-lock-cost">×${cost}</span></div>
        <span class="incubator-hatch-text${disabled ? ' disabled' : ''}" data-unlock="${i}" ${disabled ? 'style="pointer-events:none;"' : ''}>解锁</span>
      </div>`;
      continue;
    }
    const eggName = slotEggName(s);
    const rowCls = 'incubator-row' + (s?.ignored ? ' ignored' : '');
    if (s && s.hatched) {
      html += `<div class="${rowCls}">
        <div class="incubator-egg-slot has-egg" data-tip="${eggName}"><img src="./items/mystery-egg.png" alt="蛋" class="shake" /></div>
        <div class="incubator-info"><div class="incubator-name" data-tip="${eggName}">蛋</div></div>
        ${hatchBtnHtml(i, hatchLocked)}
      </div>`;
    } else if (hasEgg) {
      const used = (gameData.stats?.walkDistance || 0) - s.hatchStart;
      const usedValid = !isNaN(used) && used >= 0;
      // 随从增益：hatch 类动态减免孵化所需里程（达标线 = 原始里程 × 当前随从倍率）
      const need = (s.hatchDuration || 0) * (window.__followerBoostMechanic?.('hatchDist', 1) ?? 1);
      const shouldBeReady = (!usedValid || (used >= need)) && !s.hatched;
      if (shouldBeReady) {
        s.hatched = true;
        saveGame();
        updateIncubatorBadge();
      }
      if (s.hatched) {
        html += `<div class="${rowCls}">
          <div class="incubator-egg-slot has-egg" data-tip="${eggName}"><img src="./items/mystery-egg.png" alt="蛋" class="shake" /></div>
          <div class="incubator-info"><div class="incubator-name" data-tip="${eggName}">蛋</div></div>
          ${hatchBtnHtml(i, hatchLocked)}
        </div>`;
        continue;
      }
      const full = s.hatchDuration || 1;
      // 绝对里程刻度：宽度 = 里程 / 最长里程。绿色=已走，黄色=随从免掉的里程（从绿色末端延伸）
      const pct = Math.min(100, Math.max(0, used / maxDur * 100));
      const boostPct = Math.min(100, Math.max(0, (full - need) / maxDur * 100));
      const remain = Math.max(0, Math.ceil((need - used) / PX_PER_METER));
      const distStr = remain >= 1000 ? `${(remain / 1000).toFixed(1)}公里` : `${remain}米`;
      html += `<div class="incubator-row">
        <div class="incubator-egg-slot has-egg" data-tip="${eggName}"><img src="./items/mystery-egg.png" alt="蛋" /></div>
        <div class="incubator-info">
          <div class="incubator-name" data-tip="${eggName}">蛋</div>
          <div class="incubator-progress-wrap" data-slot="${i}">
            <div class="incubator-progress-fill${boostPct > 0 ? ' has-boost' : ''}" style="width:${pct}%"></div>
            ${boostPct > 0 ? `<div class="incubator-progress-boost" style="left:${pct}%;width:${boostPct}%"></div>` : ''}
            <div class="incubator-progress-text">还需 ${distStr}</div>
          </div>
        </div>
      </div>`;
    } else {
      const plus = '<span style="font-size:14px;color:var(--ui-color);transform:translateY(-2px);">+</span>';
      // 空槽：点 + 弹出「神秘蛋 / 宝可梦蛋」选择菜单
      html += `<div class="incubator-row">
        <div class="incubator-egg-slot" data-empty="${i}" style="cursor:pointer;">${plus}</div>
        <div class="incubator-info"><div class="incubator-name">空孵蛋器</div></div>
      </div>`;
    }
  }
  list.innerHTML = html;
  list.querySelectorAll('.incubator-hatch-text.hatched').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = parseInt(btn.dataset.slot);
      import('./items.js').then(m => m.hatchFromIncubator(slot));
    });
  });
  // 右键已孵化的蛋：忽略/恢复提醒（可去掉手机红点与托盘蛋动画提醒）
  list.querySelectorAll('.incubator-row').forEach(row => {
    row.addEventListener('contextmenu', (e) => {
      const btn = row.querySelector('.incubator-hatch-text.hatched');
      if (!btn) return;
      const slot = parseInt(btn.dataset.slot);
      const s = (gameData.incubators || [])[slot];
      if (!s || !s.hatched) return;
      e.preventDefault();
      showIncubatorCtxMenu(slot, e.clientX, e.clientY);
    });
  });
  list.querySelectorAll('.incubator-egg-slot[data-empty]').forEach(el => {
    el.addEventListener('click', () => {
      const slot = parseInt(el.dataset.empty);
      showIncubatorPickMenu(slot, el);
    });
  });
  list.querySelectorAll('.incubator-hatch-text[data-unlock]').forEach(el => {
    el.addEventListener('click', () => {
      const slot = parseInt(el.dataset.unlock);
      import('./items.js').then(m => m.unlockIncubatorSlot(slot));
    });
  });
}

// 孵化槽右键菜单：忽略/恢复提醒（复用交换右键菜单样式，可去掉手机红点与托盘蛋动画提醒）
function showIncubatorCtxMenu(slotIndex, x, y) {
  hideIncubatorCtxMenu();
  let menu = $('incubatorCtxMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'incubatorCtxMenu';
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
  }
  const s = (gameData.incubators || [])[slotIndex];
  const ignored = !!s?.ignored;
  menu.innerHTML = `<div class="shop-ctx-item">${ignored ? '恢复红点提醒' : '忽略此蛋'}</div>`;
  menu.style.display = '';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const { x: lx, y: ly, w: vw, h: vh } = logicViewport(x, y); // zoom 下还原逻辑坐标
  menu.style.left = Math.max(0, Math.min(lx - 24, vw - mw - 4)) + 'px';
  menu.style.top = Math.max(0, Math.min(ly, vh - mh - 4)) + 'px';
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.onclick = () => {
    hideIncubatorCtxMenu();
    toggleIncubatorIgnore(slotIndex);
  };
  document.addEventListener('pointerdown', hideIncubatorCtxMenu);
}

function hideIncubatorCtxMenu() {
  const menu = $('incubatorCtxMenu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('pointerdown', hideIncubatorCtxMenu);
}

// 切换蛋的忽略状态：忽略后手机/托盘不再提醒，但可随时恢复、仍可正常孵化
function toggleIncubatorIgnore(slotIndex) {
  const s = (gameData.incubators || [])[slotIndex];
  if (!s || !s.hatched) return;
  s.ignored = !s.ignored;
  saveGame();
  updateIncubatorBadge();
  renderIncubatorView();
  // 刷新手机主页聚合红点（孵蛋完成不再计入）
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('roster-changed'));
}

// 空槽加号选择菜单：两个选项（神秘蛋 / 宝可梦蛋），样式复用商店批量菜单；
// 库存为 0 的选项置灰禁用；点击外部任意位置关闭
function showIncubatorPickMenu(slot, anchorEl) {
  hideIncubatorPickMenu();
  const mysteryCount = gameData.items['mystery-egg'] || 0;
  const inUse = new Set((gameData.incubators || []).map(s => s && s.eggRef).filter(Boolean));
  const pokemonCount = (gameData.roster || [])
    .filter(p => p.inRoster && !isPokemon(p) && !inUse.has(p.id)).length;
  // 特判：没有宝可梦蛋但有神秘蛋时，点击加号直接放入神秘蛋（不弹选择菜单）
  if (pokemonCount === 0 && mysteryCount > 0) {
    import('./items.js').then(m => m.placeEggInIncubator(slot));
    return;
  }
  let menu = $('incubatorPickMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'incubatorPickMenu';
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = `
    <div class="shop-ctx-item${mysteryCount > 0 ? '' : ' disabled'}" data-pick="mystery">
      <span class="shop-ctx-qty">神秘蛋</span>
    </div>
    <div class="shop-ctx-item${pokemonCount > 0 ? '' : ' disabled'}" data-pick="pokemon">
      <span class="shop-ctx-qty">宝可梦蛋</span>
    </div>`;
  // 定位到加号正下方（越界自动翻转）
  const rect = anchorEl.getBoundingClientRect();
  menu.style.display = '';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const x = Math.max(0, Math.min(rect.left + rect.width / 2 - 24, window.innerWidth - mw - 4));
  const y = Math.max(0, Math.min(rect.bottom + 2, window.innerHeight - mh - 4));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.onclick = (e) => {
    const opt = e.target.closest('.shop-ctx-item');
    if (!opt || opt.classList.contains('disabled')) return;
    hideIncubatorPickMenu();
    if (opt.dataset.pick === 'mystery') {
      import('./items.js').then(m => m.placeEggInIncubator(slot));
    } else {
      _eggPickSlot = slot;
      showIncubatorEggView();
    }
  };
  document.addEventListener('pointerdown', hideIncubatorPickMenu);
}

function hideIncubatorPickMenu() {
  const menu = $('incubatorPickMenu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('pointerdown', hideIncubatorPickMenu);
}

export function updateIncubatorTimers() {
  const list = $('incubatorList');
  if (!list) return;
  const incubators = gameData.incubators || [];
  let changed = false;
  // 基准里程 = 当前最长蛋的原始里程（与列表渲染一致）
  let maxDur = 1;
  for (const s of incubators) {
    if (s && s.eggIndex != null && !s.hatched && (s.hatchDuration || 0) > maxDur) maxDur = s.hatchDuration;
  }
  list.querySelectorAll('.incubator-progress-wrap[data-slot]').forEach(wrap => {
    const i = parseInt(wrap.dataset.slot);
    const s = incubators[i];
    if (!s || s.eggIndex == null) return;
    if (s.hatched) { changed = true; return; }
    const used = (gameData.stats?.walkDistance || 0) - s.hatchStart;
    const usedValid = !isNaN(used) && used >= 0;
    // 随从增益：hatch 类动态减免孵化所需里程（达标线 = 原始里程 × 当前随从倍率）
    const need = (s.hatchDuration || 0) * (window.__followerBoostMechanic?.('hatchDist', 1) ?? 1);
    if (!usedValid || (used + 100) >= need) {
      s.hatched = true;
      saveGame();
      changed = true;
      return;
    }
    const full = s.hatchDuration || 1;
    // 绝对里程刻度：与列表渲染一致（宽度 = 里程 / 最长里程）
    const pct = usedValid ? Math.min(100, Math.max(0, used / maxDur * 100)) : 0;
    const boostPct = Math.min(100, Math.max(0, (full - need) / maxDur * 100));
    const remain = usedValid ? Math.max(0, Math.ceil((need - used) / PX_PER_METER)) : Math.ceil(need / PX_PER_METER);
    const distStr = remain >= 1000 ? `${(remain / 1000).toFixed(1)}公里` : `${remain}米`;
    const fill = wrap.querySelector('.incubator-progress-fill');
    const txt = wrap.querySelector('.incubator-progress-text');
    let boostEl = wrap.querySelector('.incubator-progress-boost');
    if (fill) {
      fill.style.width = pct + '%';
      // 有黄色段时绿色段右端改直角，避免两圆角相连
      fill.classList.toggle('has-boost', boostPct > 0);
    }
    if (boostPct > 0) {
      if (!boostEl) {
        boostEl = document.createElement('div');
        boostEl.className = 'incubator-progress-boost';
        wrap.appendChild(boostEl);
      }
      boostEl.style.left = pct + '%';
      boostEl.style.width = boostPct + '%';
    } else if (boostEl) {
      boostEl.remove();
    }
    if (txt) txt.textContent = `还需 ${distStr}`;
  });
  if (changed) {
    updateIncubatorBadge();
    renderIncubatorView();
  }
}

// ---------- 游戏内自制 tooltip（跟随鼠标，自动越界翻转）----------
// 浏览器端 html 级 zoom 缩放下，事件坐标返回物理像素，而 style.left/top 赋值渲染时还会被
// zoom 放大一次（与 main.js 的 getBoundingClientRect 还原逻辑一致）；浮层定位统一走这里
// 还原成逻辑像素，保证跟随鼠标/右键菜单不错位。Tauri 端 zoom=1 时原样返回。
export function logicViewport(x, y) {
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  if (z === 1) return { x, y, w: window.innerWidth, h: window.innerHeight };
  return { x: x / z, y: y / z, w: window.innerWidth / z, h: window.innerHeight / z };
}
let _foodTipEl = null;
let _foodTipInit = false;

function getFoodTipEl() {
  if (!_foodTipEl) {
    _foodTipEl = document.createElement('div');
    _foodTipEl.className = 'food-tooltip';
    _foodTipEl.style.display = 'none';
    document.body.appendChild(_foodTipEl);
  }
  return _foodTipEl;
}

export function hideFoodTip() {
  if (_foodTipEl) _foodTipEl.style.display = 'none';
}

export function showFoodTip(text, x, y) {
  const tip = getFoodTipEl();
  tip.textContent = text;
  // 多行文案（含 \n）时按行折行，单行文案保持 nowrap（如树果 tooltip）
  tip.style.whiteSpace = text.includes('\n') ? 'pre-line' : '';
  tip.style.display = '';
  // 浏览器端 html 级 zoom 下，style.left/top 赋值渲染时还会被 zoom 放大一次（与 main.js 的
  // getBoundingClientRect 还原逻辑一致）；这里把事件坐标与视口尺寸统一还原成逻辑像素，保证跟随鼠标不错位
  const { x: vx, y: vy, w: vw, h: vh } = logicViewport(x, y);
  // 定位：优先右下方，越界时翻转到左/上方；翻转后仍越界则夹紧在屏幕内，避免溢出屏幕外
  const pad = 10;
  let left = vx + 12;
  let top = vy + 14;
  const tw = tip.getBoundingClientRect().width; // 已被 main.js 还原为逻辑像素
  const th = tip.getBoundingClientRect().height;
  if (left + tw > vw - pad) {
    left = vx - tw - 12;
    if (left < pad) left = pad; // 左侧放不下：贴左边缘
    if (left + tw > vw - pad) left = vw - pad - tw; // 兜底防右侧再溢出
  }
  if (top + th > vh - pad) {
    top = vy - th - 10;
    if (top < pad) top = pad; // 上方放不下：贴顶
  }
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

// 命中可弹自定义 tooltip 的元素并取文案；不支持的元素返回 null
// 支持：树果图标（.berry-icon 的 dataset.tip）、大量出没地图标记（.gps-mass-marker，显示 宝可梦在 x#道路 大量出没 · 剩余时间/只数）、时空扭曲标记（.gps-twist-marker）、战斗状态圆点（.b-status-dot 的 dataset.tip）、战斗血条（.b-hp 的 dataset.tip）
function tooltipTextFor(target) {
  const icon = target && target.closest ? target.closest('.berry-icon') : null;
  if (icon) return icon.dataset.tip || '';
  const stDot = target && target.closest ? target.closest('.b-status-dot') : null;
  if (stDot) return stDot.dataset.tip || '';
  const hpBar = target && target.closest ? target.closest('.b-hp') : null;
  if (hpBar) return hpBar.dataset.tip || '';
  const catWrap = target && target.closest ? target.closest('.move-cat-icon') : null;
  if (catWrap) {
    // hover 目标是类别图标图片本身（data-tip 在 img 上）
    const catImg = catWrap.tagName === 'IMG' ? catWrap : catWrap.querySelector('img');
    return (catImg && catImg.dataset.tip) || catWrap.dataset.tip || '';
  }
  const mass = target && target.closest ? target.closest('.gps-mass-marker') : null;
  if (mass) {
    const mo = getMassOutbreak();
    const name = mass.dataset.name || '宝可梦';
    const remain = mass.dataset.remain != null ? mass.dataset.remain : '?';
    if (!mo) return `${name}（剩余 ${remain} 只）`;
    const num = getRoadNumForEdge(mo.edge, mo.t);
    const roadStr = num != null ? `${num}#道路` : '某道路';
    const sec = Math.max(0, Math.ceil((mo.expiresAt - Date.now()) / 1000));
    const timeStr = `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
    return `${name} ${remain} 只\n剩余${timeStr}`;
  }
  const twist = target && target.closest ? target.closest('.gps-twist-marker') : null;
  if (twist) {
    const tw = getTwist();
    const remain = twist.dataset.remain != null ? twist.dataset.remain : '?';
    if (!tw) return `时空扭曲（剩余 ${remain} 处）`;
    const num = getRoadNumForEdge(tw.edge, tw.t);
    const roadStr = num != null ? `${num}#道路` : '某道路';
    const sec = Math.max(0, Math.ceil((tw.expiresAt - Date.now()) / 1000));
    const timeStr = `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
    return `时空扭曲 · ${roadStr}\n可遭遇 ${remain} 只\n剩余${timeStr}`;
  }
  // 通用 data-tip：任意带 data-tip 的元素（如饲育屋放入列表的个体值单元格、场地亲本）
  const tipEl = target && target.closest ? target.closest('[data-tip]') : null;
  if (tipEl) return tipEl.dataset.tip || '';
  return null;
}

export function setupFoodTooltip() {
  if (_foodTipInit) return;
  _foodTipInit = true;

  // 事件委托：任何支持的元素悬停都走这里（图鉴日志列表、地图大量出没标记重建后依然生效）
  document.addEventListener('mouseover', (e) => {
    const text = tooltipTextFor(e.target);
    if (!text) { hideFoodTip(); return; }
    showFoodTip(text, e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (_foodTipEl && _foodTipEl.style.display !== 'none' && tooltipTextFor(e.target)) {
      // 重新取文案：大量出没剩余时间随鼠标移动实时刷新
      showFoodTip(tooltipTextFor(e.target), e.clientX, e.clientY);
    }
  });
  document.addEventListener('mouseout', (e) => {
    if (!tooltipTextFor(e.target)) hideFoodTip();
  });
  // 滚出/切页时隐藏
  document.addEventListener('scroll', hideFoodTip, true);
}
