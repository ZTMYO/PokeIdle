// ===== 宝可梦仓库 =====
// 查看当前拥有的每只宝可梦个体（个体值/闪光/来源/在仓状态），
// 交互与图鉴对齐：搜索 / 来源筛选 / 表头排序 / 点击进入个体详情，详情页可返回列表。
import { $, showView, tryLoadImage, tryLoadPokemonImage } from './ui.js';
import { phase, gameData, getPokemonByIndex, getNature, setPrevView, saveGame, setPokedexInLogView } from './state.js';
import { TYPE_COLORS } from './items.js';
import { matchPinyinPartial, describeLogEntry } from './pokedex.js';
import { showGoodbyeConfirm, startShinySparkleOn, stopShinySparkleLoop } from './animation.js';

// 获得来源 → 中文
const SOURCE_NAMES = { normal: '野生', fishing: '钓鱼', egg: '孵蛋', honey: '甜甜蜜', trade: '交换' };
// 筛选下拉选项：全部 / 闪光 / 各来源（甜甜蜜不参与筛选）
const FILTER_OPTIONS = [['', '全部'], ['shiny', '闪光'], ...Object.entries(SOURCE_NAMES).filter(([k]) => k !== 'honey')];
// 六围个体值明细（键 → 显示名）
const IV_KEYS = [['hp', 'HP'], ['atk', '攻击'], ['def', '防御'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速度']];

// 性格 key → 中文名
function natureText(key) {
  const n = getNature(key);
  return n ? n.cn : '未知';
}

// 六维个体值 → 六边形雷达图
function ivHexagon(p) {
  const cx = 50, cy = 50, r = 34;
  const pt = (i, ratio) => {
    const a = (Math.PI / 180) * (-90 + 60 * i);
    return [cx + r * ratio * Math.cos(a), cy + r * ratio * Math.sin(a)];
  };
  const poly = ratio => IV_KEYS.map((_, i) => pt(i, ratio).map(n => n.toFixed(1)).join(',')).join(' ');
  const data = IV_KEYS.map(([k], i) => {
    const v = p.ivs ? (p.ivs[k] ?? 0) : 0;
    return pt(i, v / 31).map(n => n.toFixed(1)).join(',');
  }).join(' ');
  const axes = IV_KEYS.map((_, i) => {
    const [x, y] = pt(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(48,98,48,0.15)" stroke-width="0.5"/>`;
  }).join('');
  const labels = IV_KEYS.map(([, label], i) => {
    const [x, y] = pt(i, 1.32);
    return `<text x="${x.toFixed(1)}" y="${(y + 2).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="var(--ui-color)">${label}</text>`;
  }).join('');
  const dots = IV_KEYS.map(([k], i) => {
    const v = p.ivs ? (p.ivs[k] ?? 0) : 0;
    const [x, y] = pt(i, v / 31);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.7" fill="var(--ui-color)"/>`;
  }).join('');
  return `<svg viewBox="0 0 100 100" class="roster-hex">
    <polygon points="${poly(0.34)}" fill="none" stroke="rgba(48,98,48,0.18)" stroke-width="0.5"/>
    <polygon points="${poly(0.67)}" fill="none" stroke="rgba(48,98,48,0.18)" stroke-width="0.5"/>
    <polygon points="${poly(1)}" fill="none" stroke="rgba(48,98,48,0.18)" stroke-width="0.5"/>
    ${axes}
    <polygon points="${data}" fill="rgba(48,98,48,0.22)" stroke="var(--ui-color)" stroke-width="1.2"/>
    ${dots}
    ${labels}
  </svg>`;
}

let _sortBy = 'time';  // 当前排序列：time | name | iv | source
let _sortDir = -1;     // 1 升序 / -1 降序
let _filter = '';      // 来源/闪光筛选（''=全部）
let _detailId = null;  // 当前详情个体 id（非空=处于详情页）
let _detailFromView = null; // 详情跳转来源（捕获/孵蛋后“查看详情”进入时记录，返回列表后再返回时优先回来源）
let _detailReturnFn = null; // 从悬赏提交/交换选择列表进入详情时注册的返回回调（返回时恢复来源列表）
let _detailJumpedToPokedex = false; // 详情页跳转图鉴中（返回键应先回详情页，再按来源返回）

// 个体值总和
function ivSum(p) {
  if (!p.ivs) return 0;
  return p.ivs.hp + p.ivs.atk + p.ivs.def + p.ivs.spa + p.ivs.spd + p.ivs.spe;
}

function srcName(s) { return SOURCE_NAMES[s] || s || '野生'; }

function fmtTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 在仓个体列表
function inRoster() {
  return (gameData.roster || []).filter(p => p.inRoster);
}

// 搜索词是否命中该个体（名称 / 拼音 / 首字母）
function matchesQuery(p, q) {
  if (!q) return true;
  const poke = getPokemonByIndex(String(p.species));
  if (!poke) return true;
  const upper = q.toUpperCase();
  return poke.name.includes(q) ||
    poke.pinyin.toUpperCase().includes(upper) ||
    poke.pinyinInitials.toUpperCase().includes(upper) ||
    matchPinyinPartial(q, poke.pinyin);
}

// 过滤 + 排序 + 渲染列表
function renderList() {
  const list = $('rosterList');
  if (!list) return;
  const q = ($('rosterSearchInput')?.value || '').trim();
  let pool = inRoster();
  // 筛选：闪光 / 来源
  if (_filter === 'shiny') pool = pool.filter(p => p.shiny);
  else if (_filter) pool = pool.filter(p => p.source === _filter);
  // 搜索
  if (q) pool = pool.filter(p => matchesQuery(p, q));
  // 进度显示（与图鉴顶部统计一致的样式）
  const prog = $('rosterProgress');
  if (prog) {
    const total = inRoster().length;
    const shinyCount = inRoster().filter(p => p.shiny).length;
    prog.textContent = q || _filter
      ? `共 ${total} 只 · 匹配 ${pool.length} 只`
      : `共 ${total} 只 · 闪光 ${shinyCount} 只`;
  }
  // 排序
  const sorted = [...pool].sort((a, b) => {
    let va, vb;
    if (_sortBy === 'index') {
      va = a.species; vb = b.species;
    } else if (_sortBy === 'name') {
      va = getPokemonByIndex(String(a.species))?.name || '';
      vb = getPokemonByIndex(String(b.species))?.name || '';
    } else if (_sortBy === 'iv') {
      va = ivSum(a); vb = ivSum(b);
    } else if (_sortBy === 'source') {
      va = srcName(a.source); vb = srcName(b.source);
    } else {
      va = a.obtainedAt; vb = b.obtainedAt;
    }
    if (typeof va === 'string') return va.localeCompare(vb) * _sortDir;
    return (va - vb) * _sortDir;
  });
  // 渲染行（复用图鉴 .pokedex-entry 样式）
  list.innerHTML = sorted.length === 0
    ? '<div class="roster-empty">仓库空空如也，去捕获一些宝可梦吧</div>'
    : sorted.map(rowHtml).join('');
  // 加载个体图标
  list.querySelectorAll('.roster-icon-img').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
  // 点击行 → 详情（从列表进入时清除"查看详情来源"，返回走回列表）
  list.onclick = (e) => {
    const row = e.target.closest('.roster-row');
    if (row) { _detailFromView = null; showRosterDetail(row.dataset.rid); }
  };
  // 表头排序指示符（限定仓库视图，避免匹配到悬赏/交换列表的同名表头）
  const header = $('rosterView')?.querySelector('.roster-header');
  if (header) {
    header.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
    const cur = header.querySelector(`[data-sort="${_sortBy}"]`);
    if (cur) cur.classList.add(_sortDir === 1 ? 'sort-asc' : 'sort-desc');
  }
}

function rowHtml(p) {
  const poke = getPokemonByIndex(String(p.species));
  const name = poke ? poke.name : `#${p.species}`;
  const icon = poke?.icon ? `<img class="roster-icon-img" data-icon="${p.species}" alt="" />` : '';
  return `
    <div class="pokedex-entry roster-row" data-rid="${p.id}">
      <span class="roster-icon">${icon}</span>
      <span class="pokedex-star">${p.shiny ? '★' : ''}</span>
      <span class="pokedex-idx">#${p.species}</span>
      <span class="pokedex-name">${name}</span>
      <span class="roster-iv">${ivSum(p)}</span>
      <span class="roster-src">${srcName(p.source)}</span>
    </div>`;
}

// ---------- 搜索 / 筛选 / 排序 ----------
function setupSearch() {
  const input = $('rosterSearchInput');
  if (!input) return;
  const clearBtn = $('rosterSearchClear');
  // 清空按钮只在有输入时显示
  const syncClear = () => {
    if (clearBtn) clearBtn.style.display = input.value.trim() ? '' : 'none';
  };
  syncClear();
  input.oninput = () => {
    if (!_detailId) renderList();
    syncClear();
  };
  // 清空按钮：清空输入并恢复完整列表
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      if (!_detailId) renderList();
      syncClear();
      input.focus();
    });
  }
}

function setupFilter() {
  const trigger = $('rosterFilter');
  const label = $('rosterFilterLabel');
  const dd = $('rosterFilterDropdown');
  if (!trigger || !label || !dd) return;
  function buildOptions() {
    dd.innerHTML = FILTER_OPTIONS.map(([k, name]) =>
      `<div class="region-dropdown-item${k === _filter ? ' active' : ''}" data-filter="${k}">${name}</div>`
    ).join('');
    dd.querySelectorAll('.region-dropdown-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        _filter = el.dataset.filter;
        label.textContent = el.textContent;
        dd.style.display = 'none';
        trigger.classList.remove('open');
        renderList();
      });
    });
  }
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dd.style.display !== 'none';
    document.querySelectorAll('.region-dropdown').forEach(d => d.style.display = 'none');
    document.querySelectorAll('.pokedex-region-select').forEach(s => s.classList.remove('open'));
    if (!open) {
      buildOptions();
      dd.style.display = '';
      trigger.classList.add('open');
    }
  });
  document.addEventListener('click', () => {
    dd.style.display = 'none';
    trigger.classList.remove('open');
  });
}

// 表头点击排序（限定仓库视图，避免绑定到悬赏/交换列表的同名表头）
function setupHeaderSort() {
  const header = $('rosterView')?.querySelector('.roster-header');
  if (!header) return;
  header.onclick = (e) => {
    const span = e.target.closest('[data-sort]');
    if (!span) return;
    const field = span.dataset.sort;
    if (_sortBy === field) _sortDir *= -1; // 同字段切换升降序
    else { _sortBy = field; _sortDir = -1; } // 新字段默认降序
    renderList();
  };
}

// ---------- 个体详情 ----------
// 点击列表行进入；返回按钮（标题栏 back）→ restoreRosterList 回到列表
function showRosterDetail(id) {
  const p = (gameData.roster || []).find(r => r.id === id);
  if (!p) return;
  _detailId = id;
  const rootEl = $('rosterView');
  if (!rootEl) return;
  const listEl = $('rosterList');
  if (listEl) { listEl.dataset.savedScroll = listEl.scrollTop; listEl.scrollTop = 0; } // 记住列表位置，详情从顶部开始
  // 隐藏搜索框、表头和进度（与图鉴详情一致）
  rootEl.querySelector('.pokedex-search').style.display = 'none';
  rootEl.querySelector('.roster-header').style.display = 'none';
  const prog = $('rosterProgress');
  if (prog) prog.style.display = 'none';

  const poke = getPokemonByIndex(String(p.species));
  const name = poke ? poke.name : `#${p.species}`;
  const lastLog = latestLogLine(String(p.species));
  const list = $('rosterList');
  if (!list) return;
  list.innerHTML = `
    <div style="font-size:14px;font-weight:700;padding:6px 5px 2px;display:flex;align-items:center;justify-content:space-between;">
      <span>${name}${p.shiny ? ' <svg class="roster-shiny" viewBox="0 0 1024 1024" width="14" height="14" style="flex-shrink:0;vertical-align:-2px;transform:translateY(-2px);"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>' : ''}</span>
      <div style="display:flex;flex-direction:row;align-items:flex-end;gap:2px;">
        <button class="roster-release" data-pokedex title="查看图鉴">图鉴</button>
        <button class="roster-release" data-release>放生</button>
      </div>
    </div>
    <div class="roster-detail-head">
      <div class="poke-img-grid"><img id="rosterDetailImg" class="poke-img-in-grid" alt="" /></div>
      <div style="min-width:0;">
        <div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:3px;">
          ${(poke && poke.types || []).map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`).join('')}
        </div>
        <div style="font-size:10px;opacity:0.7;line-height:1.5;">
          <div>性格：${natureText(p.nature)}</div>
          <div>来源：${srcName(p.source)}</div>
          <div>获得时间：${fmtTime(p.obtainedAt)}</div>
          ${lastLog ? `<div>${lastLog}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="roster-detail-block">
      <div class="roster-detail-title">个体值 <span style="opacity:0.6;">${ivSum(p)}/186</span></div>
      <div class="roster-iv-flex">
        ${ivHexagon(p)}
        <div class="roster-iv-bars">
          ${IV_KEYS.map(([k, label]) => {
            const v = p.ivs ? (p.ivs[k] ?? 0) : 0;
            return `<div class="roster-iv-item"><span>${label}</span>
              <div class="roster-iv-bar"><div class="roster-iv-fill" style="width:${(v / 31 * 100).toFixed(0)}%"></div></div>
              <span>${v}</span></div>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;
  const img = $('rosterDetailImg');
  if (img && poke) {
    // 等图片加载完成再启动粒子，否则 burst 时图片尺寸为 0 会定位到页面中心
    tryLoadPokemonImage(img, poke, p.shiny ? '_shiny' : '').then(() => {
      // 闪光个体：图片周围循环播放星星粒子（详情页图小 → 粒子缩小、飞行更近）
      if (p.shiny && _detailId === id) startShinySparkleOn($('rosterView'), img, { cls: 'sm', scale: 0.6 });
    });
  }
  // 右上角放生：移除个体并播放告别动画
  list.querySelector('[data-release]')?.addEventListener('click', () => releasePokemon(id));
  // 图鉴：跳转到该宝可梦的图鉴详情页（第 4 层子页），返回键先回详情页
  list.querySelector('[data-pokedex]')?.addEventListener('click', () => {
    stopShinySparkleLoop();
    _detailJumpedToPokedex = true;
    import('./pokedex.js').then(m => {
      m.showEncounterLogs(p.species);
      showView('pokedexView');
    });
  });
}

// 放生：确认后移除个体、播告别动画，结束后返回列表
let _releasing = false; // 场景播放中防重复触发
function releasePokemon(id) {
  const p = (gameData.roster || []).find(r => r.id === id);
  if (!p || _releasing) return;
  _releasing = true;
  const poke = getPokemonByIndex(String(p.species));
  showGoodbyeConfirm({
    poke,
    prompt: '确认要放生吗？',
    shiny: !!p.shiny,
    onConfirm: () => {
      const arr = gameData.roster || [];
      const ri = arr.findIndex(r => r.id === id);
      if (ri >= 0) arr.splice(ri, 1);
      stopShinySparkleLoop();
      _releasing = false;
      saveGame();
      restoreRosterList();
    },
    onCancel: () => {
      _releasing = false;
    },
  });
}

// 该物种最近一次遭遇日志（一行小字，附在获得时间下）
function latestLogLine(idx) {
  const logs = (gameData.encounterLogs || {})[idx] || [];
  if (logs.length === 0) return null;
  const log = [...logs].sort((a, b) => b.time - a.time)[0];
  return describeLogEntry(log);
}

// 详情页返回列表
export function restoreRosterList() {
  stopShinySparkleLoop();
  if (_detailId == null) return;
  _detailJumpedToPokedex = false;
  // 从悬赏提交/交换选择列表进入的详情：返回直接恢复来源列表
  if (_detailReturnFn) { leaveRosterDetailToList(); return; }
  _detailId = null;
  const rootEl = $('rosterView');
  if (rootEl) {
    rootEl.querySelector('.pokedex-search').style.display = '';
    rootEl.querySelector('.roster-header').style.display = '';
  }
  const prog = $('rosterProgress');
  if (prog) prog.style.display = '';
  showRosterView();
  // 从“获得宝可梦→查看详情”进入时，返回列表后再返回优先回到来源页（孵蛋器/游戏页）
  if (_detailFromView) { setPrevView(_detailFromView); _detailFromView = null; }
  // 恢复进入详情前的列表滚动位置
  const list = $('rosterList');
  if (list) requestAnimationFrame(() => { list.scrollTop = Number(list.dataset.savedScroll || 0); });
}

export function isRosterInDetail() {
  return _detailId != null;
}

// 是否通过"获得宝可梦→查看详情"进入的详情页（返回时应直接回来源页而非仓库列表）
export function isRosterDetailFromObtain() {
  return _detailFromView != null;
}

// 从"获得宝可梦→查看详情"进入的详情页按返回：清理详情状态，直接回来源页
export function leaveRosterDetailToSource() {
  stopShinySparkleLoop();
  if (_detailId == null) return;
  _detailId = null;
  _detailReturnFn = null;
  _detailJumpedToPokedex = false;
  const rootEl = $('rosterView');
  if (rootEl) {
    rootEl.querySelector('.pokedex-search').style.display = '';
    rootEl.querySelector('.roster-header').style.display = '';
  }
  const prog = $('rosterProgress');
  if (prog) prog.style.display = '';
  const target = _detailFromView || 'idleView';
  _detailFromView = null;
  showView(target);
  setPrevView('idleView');
}

// ---------- 页面入口 ----------
let _uiBound = false; // 搜索/筛选/表头事件只需初始化一次

export function showRosterView() {
  setPrevView($('phoneView')?.style.display !== 'none' ? 'phoneView' : (phase === 'encounter' || phase === 'caught') ? 'encounterView' : 'idleView');
  if (!_uiBound) {
    setupSearch();
    setupFilter();
    setupHeaderSort();
    _uiBound = true;
  }
  _detailId = null;
  _detailJumpedToPokedex = false;
  const rootEl = $('rosterView');
  if (rootEl) {
    const s = rootEl.querySelector('.pokedex-search');
    if (s) s.style.display = '';
    const h = rootEl.querySelector('.roster-header');
    if (h) h.style.display = '';
  }
  const prog = $('rosterProgress');
  if (prog) prog.style.display = '';
  renderList();
  showView('rosterView');
}

// 从“获得宝可梦→查看详情”进入仓库个体详情（捕获/孵蛋/交换成功后的确认跳转）
// fromView：从该页面离开后，详情返回列表时再返回优先回到这里
export function showRosterDetailById(id, fromView) {
  _detailFromView = fromView || 'idleView';
  showRosterView();    // 先渲染并显示仓库列表
  showRosterDetail(id); // 再进入该个体的详情
}

// 从悬赏提交/交换选择列表进入个体详情（第三层）
// returnFn：详情页按返回时执行，负责切回来源视图并恢复其子页状态
export function showRosterDetailFromList(id, returnFn) {
  _detailFromView = null;
  _detailReturnFn = typeof returnFn === 'function' ? returnFn : null;
  showRosterView();    // 先渲染并显示仓库列表
  showRosterDetail(id); // 再进入该个体的详情
}

// 是否从悬赏提交/交换选择列表进入的详情页（返回时应直接恢复来源列表）
export function isRosterDetailFromList() {
  return _detailReturnFn != null;
}

// 从悬赏提交/交换选择列表进入的详情页按返回：清理详情状态，恢复来源列表
export function leaveRosterDetailToList() {
  stopShinySparkleLoop();
  if (_detailId == null) return;
  _detailId = null;
  _detailJumpedToPokedex = false;
  const rootEl = $('rosterView');
  if (rootEl) {
    rootEl.querySelector('.pokedex-search').style.display = '';
    rootEl.querySelector('.roster-header').style.display = '';
  }
  const prog = $('rosterProgress');
  if (prog) prog.style.display = '';
  const fn = _detailReturnFn;
  _detailReturnFn = null;
  showView('idleView'); // 先隐藏仓库详情页，由来源列表自行显示
  if (fn) fn();
}

// 详情页跳转图鉴中：仅在图鉴页可见时生效（返回键应回到详情页）
export function isRosterDetailJumpedToPokedex() {
  return _detailJumpedToPokedex && $('pokedexView')?.style.display !== 'none';
}

// 从图鉴返回仓库详情页（图鉴页按返回 → 回到详情页，再按返回走原详情返回逻辑）
export function returnRosterDetailFromPokedex() {
  _detailJumpedToPokedex = false;
  // 恢复图鉴列表状态：清除日志视图标志，恢复搜索框/表头/进度显示（无需重建列表）
  setPokedexInLogView(false);
  const s = document.querySelector('.pokedex-search');
  if (s) s.style.display = '';
  const h = document.querySelector('.pokedex-header');
  if (h) h.style.display = '';
  const prog = $('pokedexProgress');
  if (prog) prog.style.display = '';
  stopShinySparkleLoop();
  if (_detailId == null) return;
  showView('rosterView');
  showRosterDetail(_detailId);
}
