// ===== 宝可梦仓库 =====
// 查看当前拥有的每只宝可梦个体（个体值/闪光/来源/在仓状态），
// 交互与图鉴对齐：搜索 / 来源筛选 / 表头排序 / 点击进入个体详情，详情页可返回列表。
import { $, showView, tryLoadImage, tryLoadPokemonImage } from './ui.js';
import { phase, gameData, getPokemonByIndex, getNature, setPrevView, saveGame } from './state.js';
import { TYPE_COLORS } from './items.js';
import { matchPinyinPartial, describeLogEntry } from './pokedex.js';
import { showGoodbyeConfirm, startShinySparkleOn, stopShinySparkleLoop } from './animation.js';

// 获得来源 → 中文
const SOURCE_NAMES = { normal: '野生', fishing: '钓鱼', egg: '孵蛋', honey: '甜甜蜜' };
// 筛选下拉选项：全部 / 闪光 / 各来源（甜甜蜜不参与筛选）
const FILTER_OPTIONS = [['', '全部'], ['shiny', '闪光'], ...Object.entries(SOURCE_NAMES).filter(([k]) => k !== 'honey')];
// 六围个体值明细（键 → 显示名）
const IV_KEYS = [['hp', 'HP'], ['atk', '攻击'], ['def', '防御'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速度']];

// 性格 key → 中文名
function natureText(key) {
  const n = getNature(key);
  return n ? n.cn : '未知';
}

// 六维个体值 → 六边形雷达图（顶点自顶部起顺时针排列，满值 31 对应外圈）
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

// 个体值总和（六围 0~31，最大 186）
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
  // 点击行 → 详情
  list.onclick = (e) => {
    const row = e.target.closest('.roster-row');
    if (row) showRosterDetail(row.dataset.rid);
  };
  // 表头排序指示符
  const header = document.querySelector('.roster-header');
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
  input.oninput = () => { if (!_detailId) renderList(); };
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

// 表头点击排序
function setupHeaderSort() {
  const header = document.querySelector('.roster-header');
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
  $('rosterList').scrollTop = 0;
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
      <button class="roster-release" data-release>放生</button>
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
  _detailId = null;
  const rootEl = $('rosterView');
  if (rootEl) {
    rootEl.querySelector('.pokedex-search').style.display = '';
    rootEl.querySelector('.roster-header').style.display = '';
  }
  const prog = $('rosterProgress');
  if (prog) prog.style.display = '';
  showRosterView();
}

export function isRosterInDetail() {
  return _detailId != null;
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
  renderList();
  showView('rosterView');
}
