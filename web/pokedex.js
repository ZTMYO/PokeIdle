// ===== 宝可梦图鉴独立页（pokedex.html）=====
// 数据来自 src/pokemon-data/pokedex.json（构建时由 sync-src.mjs 同步到 public）。
// 展示字段与 tools/update_dex_xlsx.py 生成的表格一致：
//   编号 / 名称(含变体) / 属性 / 地区 / 稀有度 / 捕捉率 / 性别比例 / 蛋组 / 孵蛋里程 / 六维 / 爱吃树果
// 排序与 Excel 相同：全国图鉴顺序，变体紧跟所属本体（0001 → 0001-1）。
import './style.css';

// 属性 → 颜色（与游戏 src/items.js TYPE_COLORS 一致）
const TYPE_COLORS = {
  '一般': '#9F9E9A', '格斗': '#A7443E', '飞行': '#72A3D2', '毒': '#793B9B',
  '地面': '#894F4E', '岩石': '#BA9459', '虫': '#89991A', '幽灵': '#633963',
  '钢': '#548EA2', '火': '#CB494D', '水': '#3786CE', '草': '#378E24',
  '电': '#DBB538', '超能': '#DA5A89', '冰': '#37BEE0', '龙': '#4654C6',
  '恶': '#553F42', '妖精': '#C74ECB',
};
// 树果索引 → 中文名（与游戏 src/items.js BERRY_NAMES 一致）
const BERRY_NAMES = { 0: '利木果', 1: '樱子果', 2: '零余果', 3: '苹野果', 4: '木子果', 5: '茄番果',
                      6: '橙橙果', 7: '桃桃果', 8: '莓莓果', 9: '文柚果', 10: '勿花果', 11: '异奇果' };
const STAT_LABELS = ['HP', '攻击', '防御', '特攻', '特防', '速度'];

// 孵蛋里程参考区间：与游戏 calcHatchDistance 同规则（峰值±σ，按体重/稀有度），舍入到公里
const HATCH_MIN = 2000, HATCH_MAX = 30000;
// 区间中间值（排序键用）
function hatchMid(p) {
  const w = Math.min((p.weight || 100) / 5000, 1);
  const r = p.rarity || 0.5;
  const factor = Math.min(w * 0.6 + r * 0.4, 1);
  return HATCH_MIN * Math.pow(HATCH_MAX / HATCH_MIN, factor);
}
function hatchRange(p) {
  const mid = hatchMid(p);
  const sigma = Math.max(20, mid * 0.2);
  return `${Math.round((mid - sigma) / 1000)}~${Math.round((mid + sigma) / 1000)} 公里`;
}
// 性别比例文案（genderRate: -1 无性别；0-8 雌性份数/8）
function genderText(p) {
  const rate = p.genderRate;
  if (rate === undefined || rate === null) return '—';
  if (rate === -1) return '无性别';
  const male = (8 - rate) / 8, female = rate / 8;
  const pct = x => `${x * 100}%`.replace(/\.?0+%$/, '%');
  if (male === 0) return '♀100%';
  if (female === 0) return '♂100%';
  return `♂${pct(male)} ♀${pct(female)}`;
}

// 解析编号：["0493", "2"] → [493, 2]（无变体后缀视作 0，本体自然排变体前）
function indexParts(s) {
  const [a, b] = String(s).split('-');
  return [+a || 0, b == null ? 0 : +b || 0];
}

// 排序：变体紧跟本体，本体按全国图鉴顺序（与 Excel 生成脚本一致）
function orderDex(list) {
  const bases = {};
  for (const p of list) (bases[p.index.split('-')[0]] ||= []).push(p);
  const out = [];
  const seen = new Set();
  for (const p of list) {
    const base = p.index.split('-')[0];
    if (seen.has(base)) continue;
    seen.add(base);
    bases[base].sort((a, b) => indexParts(a.index)[1] - indexParts(b.index)[1]);
    out.push(...bases[base]);
  }
  return out;
}

// 排序列取值：total=六维总和，statN=对应项，rarity/catchRate 直接取数，hatch=孵蛋里程中间值，index 单独按编号处理
function sortVal(p) {
  if (_sortKey === 'total') return (p.stats || []).reduce((s, x) => s + (x || 0), 0);
  if (_sortKey.startsWith('stat')) return (p.stats || [])[+_sortKey.slice(4)] ?? -1;
  if (_sortKey === 'rarity') return p.rarity ?? 0;
  if (_sortKey === 'catchRate') return p.catchRate ?? 0;
  if (_sortKey === 'hatch') return hatchMid(p);
  return 0;
}
// 按当前排序列重排数据并重建行缓存（稳定排序，编号升序时变体仍紧跟本体）
function sortDex() {
  const arr = DEX.slice();
  if (_sortKey === 'index') {
    arr.sort((a, b) => {
      const [ab, av] = indexParts(a.index);
      const [bb, bv] = indexParts(b.index);
      return (ab - bb) * _sortDir || (av - bv) * _sortDir;
    });
  } else {
    arr.sort((a, b) => (sortVal(a) - sortVal(b)) * _sortDir);
  }
  SORTED = arr;
}
function updateSortIndicators() {
  document.querySelectorAll('.dex-table thead th[data-sort]').forEach(th => {
    const ind = th.querySelector('.sort-ind');
    if (ind) ind.textContent = th.dataset.sort === _sortKey ? (_sortDir > 0 ? '▲' : '▼') : '';
  });
}
document.querySelector('.dex-table thead').addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  if (_sortKey === key) _sortDir *= -1;
  else { _sortKey = key; _sortDir = 1; }
  sortDex();
  updateSortIndicators();
  applyFilters();
});

const regionRoot = document.getElementById('dexRegionSelect');
const regionLabel = document.getElementById('dexRegionLabel');
const regionDd = document.getElementById('dexRegionDropdown');
const legendRoot = document.getElementById('dexLegendSelect');
const legendLabel = document.getElementById('dexLegendLabel');
const legendDd = document.getElementById('dexLegendDropdown');
const type1Root = document.getElementById('dexType1Select');
const type1Label = document.getElementById('dexType1Label');
const type1Dd = document.getElementById('dexType1Dropdown');
const type2Root = document.getElementById('dexType2Select');
const type2Label = document.getElementById('dexType2Label');
const type2Dd = document.getElementById('dexType2Dropdown');
const egg1Root = document.getElementById('dexEgg1Select');
const egg1Label = document.getElementById('dexEgg1Label');
const egg1Dd = document.getElementById('dexEgg1Dropdown');
const egg2Root = document.getElementById('dexEgg2Select');
const egg2Label = document.getElementById('dexEgg2Label');
const egg2Dd = document.getElementById('dexEgg2Dropdown');
const searchInput = document.getElementById('dexSearchInput');
const clearBtn = document.getElementById('dexSearchClear');

let DEX = [];          // 已排序的全量数据
let SORTED = [];       // 按当前排序列重排后的数据
let _shownList = [];   // 当前筛选后的可见列表（虚拟滚动按它渲染）
let _type1 = '';       // 第一属性筛选（''=全部）
let _type2 = '';       // 第二属性筛选（''=全部，可与属性1组合出双属性）
let _egg1 = '';        // 第一蛋组筛选（''=全部）
let _egg2 = '';        // 第二蛋组筛选（''=全部，可与蛋组1组合）
let _region = '';      // 当前地区筛选（''=全部）
let _legend = '';      // 当前类别筛选（''=全部）
let _search = '';      // 当前关键词
let _sortKey = 'index'; // 当前排序列（index/total/stat0-5）
let _sortDir = 1;       // 排序方向（1 升序，-1 降序）

// 懒加载渲染：行 HTML 按对象缓存，DOM 只渲染可视窗口（+缓冲），不在排序/筛选时全量重建
const ROW_CACHE = new Map(); // 宝可梦对象 → 行 HTML
const ROW_H = 30;            // 固定行高，与 CSS .dex-table tbody tr 保持一致
const dexWrap = document.getElementById('dexWrap');
const dexBody = document.getElementById('dexBody');
const dexCount = document.getElementById('dexCount');
function getRowHtml(p) {
  let h = ROW_CACHE.get(p);
  if (!h) { h = rowHtml(p); ROW_CACHE.set(p, h); }
  return h;
}
function renderVisible(resetTop) {
  if (resetTop) dexWrap.scrollTop = 0;
  const total = _shownList.length;
  if (total === 0) {
    dexBody.innerHTML = `<tr><td colspan="17" class="dex-error">没有符合条件的宝可梦</td></tr>`;
    return;
  }
  const scrollTop = dexWrap.scrollTop;
  const viewH = dexWrap.clientHeight;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + 8);
  let html = `<tr class="dex-spacer"><td colspan="17" style="height:${start * ROW_H}px;padding:0;border:none;"></td></tr>`;
  for (let i = start; i < end; i++) html += getRowHtml(_shownList[i]);
  html += `<tr class="dex-spacer"><td colspan="17" style="height:${(total - end) * ROW_H}px;padding:0;border:none;"></td></tr>`;
  dexBody.innerHTML = html;
}
let _scrollPending = false;
dexWrap.addEventListener('scroll', () => {
  if (_scrollPending) return;
  _scrollPending = true;
  requestAnimationFrame(() => { _scrollPending = false; renderVisible(); });
});
window.addEventListener('resize', renderVisible);

// 自定义下拉：沿用游戏内图鉴 region-dropdown 交互（点击开关、选中即关、点外关闭）
// items 项可带 html 自定义选项内容、labelRenderer 自定义选中后触发器文案
function closeAllDropdowns() {
  document.querySelectorAll('.pokedex-region-select.open').forEach(s => {
    s.classList.remove('open');
    const dd = s.querySelector('.region-dropdown');
    if (dd) dd.style.display = 'none';
  });
}
function initDropdown({ root, labelEl, ddEl, items, onPick, labelRenderer }) {
  ddEl.innerHTML = items.map((it, i) =>
    `<div class="region-dropdown-item${i === 0 ? ' active' : ''}" data-v="${it.value}">${it.html || it.label}</div>`
  ).join('');
  root.addEventListener('click', e => {
    if (e.target.closest('.region-dropdown')) return;
    e.stopPropagation();
    const open = ddEl.style.display !== 'none';
    closeAllDropdowns();
    if (!open) {
      ddEl.style.display = 'block';
      root.classList.add('open');
    }
  });
  ddEl.addEventListener('click', e => {
    const item = e.target.closest('.region-dropdown-item');
    if (!item) return;
    e.stopPropagation();
    onPick(item.dataset.v);
    labelEl.innerHTML = labelRenderer ? labelRenderer(item.dataset.v) : item.textContent;
    ddEl.querySelectorAll('.region-dropdown-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    closeAllDropdowns();
  });
}
document.addEventListener('click', closeAllDropdowns);

// 属性选项：色点 + 属性名（下拉项与触发器共用）
function typeItemHtml(t) {
  return `<span class="roster-type-dot" style="background:${TYPE_COLORS[t]}"></span>${t}`;
}
function typeItems(placeholder) {
  return [{ value: '', label: placeholder },
    ...Object.keys(TYPE_COLORS).map(t => ({ value: t, label: t, html: typeItemHtml(t) }))];
}

// 树果图标：12 格横向雪碧图（web/public/berries.png，格序与游戏 BERRY_ICONS 一致）
const BERRY_SPRITE = './berries.png';
function berryIconHtml(i) {
  if (!BERRY_NAMES[i]) return '';
  const bg = `url('${BERRY_SPRITE}') -${i * 18}px 0/216px 18px no-repeat`;
  return `<span class="berry-ico" title="${BERRY_NAMES[i]}" style="background:${bg};"></span>`;
}

// 行 HTML（列顺序与表头/Excel 一致）
function rowHtml(p) {
  const types = (p.types || []).map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`).join('');
  const stats = p.stats || [];
  const total = stats.reduce((s, x) => s + (x || 0), 0);
  const foods = (p.foods || []).some(i => BERRY_NAMES[i])
    ? (p.foods || []).map(i => berryIconHtml(i)).join('')
    : '—';
  return `<tr class="${p.legend ? 'legend' : ''}">
    <td class="c-index">${p.index}</td>
    <td class="c-name">${p.form || p.name}</td>
    <td class="c-type">${types}</td>
    <td class="c-region">${p.region || '—'}</td>
    <td class="c-num">${p.rarity.toFixed(2)}</td>
    <td class="c-num">${Math.round((p.catchRate || 0) * 100)}%</td>
    <td class="c-gender">${genderText(p)}</td>
    <td class="c-egg">${(p.eggGroup || []).join('、') || '—'}</td>
    <td class="c-hatch">${hatchRange(p)}</td>
    ${STAT_LABELS.map((_, i) => `<td class="c-num">${stats[i] ?? '—'}</td>`).join('')}
    <td class="c-num">${total}</td>
    <td class="c-food">${foods}</td>
  </tr>`;
}

// 过滤 + 渲染（resetTop=true 表示筛选条件变化，重置滚动到顶部）
function applyFilters(resetTop) {
  const kw = _search.trim().toLowerCase();
  const list = [];
  for (const p of SORTED) {
    if (_region && p.region !== _region) continue;
    if (_legend === 'legend' && !p.legend) continue;
    if (_legend === 'normal' && p.legend) continue;
    if (_type1 && _type1 === _type2) {
      // 两下拉同属性 → 纯种：仅含该单一属性
      const t = p.types || [];
      if (t.length !== 1 || t[0] !== _type1) continue;
    } else {
      if (_type1 && !(p.types || []).includes(_type1)) continue;
      if (_type2 && !(p.types || []).includes(_type2)) continue;
    }
    if (_egg1 && _egg1 === _egg2) {
      // 两下拉同蛋组 → 纯种：仅含该单一蛋组
      const g = p.eggGroup || [];
      if (g.length !== 1 || g[0] !== _egg1) continue;
    } else {
      if (_egg1 && !(p.eggGroup || []).includes(_egg1)) continue;
      if (_egg2 && !(p.eggGroup || []).includes(_egg2)) continue;
    }
    if (kw) {
      const hay = `${p.index} ${p.name} ${p.form || ''} ${p.pinyin || ''} ${p.pinyinInitials || ''}`.toLowerCase();
      if (!hay.includes(kw)) continue;
    }
    list.push(p);
  }
  _shownList = list;
  dexCount.textContent = `${list.length}/${DEX.length}`;
  renderVisible(resetTop);
}

// 初始化筛选下拉（地区选项取自数据，类别/属性固定）
function initFilters() {
  const regions = [...new Set(DEX.map(p => p.region).filter(Boolean))];
  initDropdown({
    root: regionRoot, labelEl: regionLabel, ddEl: regionDd,
    items: [{ value: '', label: '全部地区' }, ...regions.map(r => ({ value: r, label: r }))],
    onPick: v => { _region = v; applyFilters(true); },
  });
  initDropdown({
    root: legendRoot, labelEl: legendLabel, ddEl: legendDd,
    items: [
      { value: '', label: '全部' },
      { value: 'legend', label: '神兽' },
      { value: 'normal', label: '普通' },
    ],
    onPick: v => { _legend = v; applyFilters(true); },
  });
  initDropdown({
    root: type1Root, labelEl: type1Label, ddEl: type1Dd,
    items: typeItems('属性1'),
    labelRenderer: v => v ? typeItemHtml(v) : '属性1',
    onPick: v => { _type1 = v; applyFilters(true); },
  });
  initDropdown({
    root: type2Root, labelEl: type2Label, ddEl: type2Dd,
    items: typeItems('属性2'),
    labelRenderer: v => v ? typeItemHtml(v) : '属性2',
    onPick: v => { _type2 = v; applyFilters(true); },
  });
  // 蛋组下拉：选项取自数据，两下拉同项即纯种单蛋组
  const eggs = [...new Set(DEX.flatMap(p => p.eggGroup || []).filter(Boolean))].sort();
  const eggItems = placeholder => [{ value: '', label: placeholder },
    ...eggs.map(g => ({ value: g, label: g }))];
  initDropdown({
    root: egg1Root, labelEl: egg1Label, ddEl: egg1Dd,
    items: eggItems('蛋组1'),
    onPick: v => { _egg1 = v; applyFilters(true); },
  });
  initDropdown({
    root: egg2Root, labelEl: egg2Label, ddEl: egg2Dd,
    items: eggItems('蛋组2'),
    onPick: v => { _egg2 = v; applyFilters(true); },
  });
}

async function loadDex() {
  try {
    const res = await fetch('./pokedex.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DEX = orderDex(await res.json());
    sortDex();
    updateSortIndicators();
    initFilters();
    applyFilters(true);
  } catch (err) {
    dexBody.innerHTML = `<tr><td colspan="17" class="dex-error">图鉴数据加载失败，请刷新或稍后重试</td></tr>`;
    console.error('[pokedex] 加载失败：', err);
  }
}

// 搜索：防抖 + 清空按钮
let deb = null;
searchInput.addEventListener('input', () => {
  clearTimeout(deb);
  deb = setTimeout(() => {
    _search = searchInput.value;
    clearBtn.hidden = !_search;
    applyFilters(true);
  }, 120);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { searchInput.value = ''; _search = ''; clearBtn.hidden = true; applyFilters(true); }
});
clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  _search = '';
  clearBtn.hidden = true;
  applyFilters(true);
  searchInput.focus();
});

loadDex();