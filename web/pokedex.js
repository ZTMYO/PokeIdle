// ===== 宝可梦图鉴独立页（pokedex.html）=====
// 数据来自 src/pokemon-data/pokedex.json（构建时由 sync-src.mjs 同步到 public）。
// 展示字段与 tools/update_dex_xlsx.py 生成的表格一致：
//   编号 / 名称(含变体) / 属性 / 地区 / 稀有度 / 捕捉率 / 性别比例 / 蛋组 / 孵蛋里程 / 六维 / 爱吃树果
// 排序与 Excel 相同：全国图鉴顺序，变体紧跟所属本体（0001 → 0001-1）。
import './style.css';
// 交换概率与神兽池概率公示要用的常量，由 sync-src.mjs 同步过来
import { TRADE_COUNT, TRADE_BASE_FORM_CHANCE, LEGEND_ENCOUNTER_RATE, LEGEND_ENCOUNTER_RATE_BUFF } from './src/config.js';

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

// 宝可梦图标：雪碧图 + 位置表（tools/build-icon-sprite.mjs 生成）。元素尺寸 = 图标显示尺寸，外框只负责居中
const ICON_SPRITE = './pokeicons.png';
const ICON_BOX = 24; // 行内方框边长（与游戏里仓库列表的 24px 一致）
let ICONS = null;
function iconSpanHtml(index, box = ICON_BOX) {
  const rect = ICONS && ICONS.icons[index];
  if (!rect) return '';
  const [x, y, w, h] = rect;
  const k = Math.min(box / w, box / h);
  const px = (n) => `${Math.round(n * 100) / 100}px`;
  const style = `width:${px(w * k)};height:${px(h * k)};background-image:url('${ICON_SPRITE}');`
    + `background-size:${px(ICONS.w * k)} ${px(ICONS.h * k)};`
    + `background-position:${px(-x * k)} ${px(-y * k)};`;
  return `<span class="dex-ico" style="${style}"></span>`;
}

// 行 HTML（列顺序与表头/Excel 一致）
function rowHtml(p) {
  const types = (p.types || []).map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`).join('');
  const stats = p.stats || [];
  const total = stats.reduce((s, x) => s + (x || 0), 0);
  const foods = (p.foods || []).some(i => BERRY_NAMES[i])
    ? (p.foods || []).map(i => berryIconHtml(i)).join('')
    : '—';
  return `<tr class="${p.legend ? 'legend' : ''}" data-index="${p.index}" title="点击查看获取途径">
    <td class="c-index"><span class="dex-ico-box">${iconSpanHtml(p.index)}</span>${p.index}</td>
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

// ===== 获取途径模态框（点某一行弹出）=====
// 获取途径模态框：一行一种途径，左侧色 tag + 右侧说明；底部按 evolution.json 画带图标的进化链
const ACQ_TYPES = {
  wild: { label: '地区遭遇', color: '#3e8a68' },
  tree: { label: '树果方块', color: '#6f8f22' },
  twist: { label: '时空扭曲', color: '#7e5bb5' },
  trade: { label: '交换', color: '#2f7fb0' },
  egg_shop: { label: '神秘蛋', color: '#b5722f' },
  easter_author: { label: '彩蛋', color: '#c2456a' },
  easter_imiti: { label: '彩蛋', color: '#a05a8f' },
  breed: { label: '繁育', color: '#cf6f9d' },
  evolve: { label: '进化', color: '#8a6a3a' },
};
let ACQ = null, EVO = null, ACQ_LOADING = null;
// acquire.json（获取途径）+ evolution.json（进化链）：第一次点开时才取，首屏不受影响
function loadAcqData() {
  if (ACQ && EVO) return Promise.resolve();
  if (!ACQ_LOADING) {
    ACQ_LOADING = Promise.all([fetch('./acquire.json'), fetch('./evolution.json')])
      .then(([a, e]) => {
        if (!a.ok || !e.ok) throw new Error(`HTTP ${a.status}/${e.status}`);
        return Promise.all([a.json(), e.json()]);
      })
      .then(([a, e]) => {
        ACQ = new Map((a.pokemon || []).map((p) => [String(p.index), p.methods || []]));
        EVO = e;
      })
      .catch((err) => { ACQ_LOADING = null; throw err; });
  }
  return ACQ_LOADING;
}
let DEX_BY_IDX = new Map();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dexName = (i) => { const p = DEX_BY_IDX.get(String(i)); return p ? (p.form || p.name) : `#${i}`; };
// 雌雄异形的两条形态压成一条（轻飘飘-雄性/雌性）：同一个编号、同一个名字的两条只占一个名额
function parentNames(list) {
  const arr = (list || []).map(String);
  const isSexForm = (i) => /-(雄性|雌性)$/.test((DEX_BY_IDX.get(i) || {}).form || '');
  const done = new Set(), out = [];
  for (const i of arr) {
    const base = i.split('-')[0];
    const sib = isSexForm(i) && arr.some((o) => o !== i && o.split('-')[0] === base && isSexForm(o));
    if (!sib) { out.push(dexName(i)); continue; }
    if (done.has(base)) continue;
    done.add(base);
    const b = DEX_BY_IDX.get(base);
    out.push(`${b ? b.name : base}-雄性/雌性`);
  }
  return out;
}
// 条件 → 中文（只列玩家要满足的条件）
function condText(cond) {
  const c = cond || {};
  const bits = [];
  if (c.lv) bits.push(`达到 Lv${c.lv}`);
  if (c.item) bits.push(`使用${Array.isArray(c.item) ? c.item.join(' 和 ') : c.item}`); // 多件道具是"都要"，不是二选一（游戏里逐件检查）
  if (c.nature) bits.push(`性格 ${Array.isArray(c.nature) ? c.nature.join('/') : c.nature}`);
  // 招式条件是"带在身上"而不是"学过就行"；「X属性招式」本身就是完整说法，不再套「」招式
  if (c.move) bits.push(/属性招式$/.test(c.move) ? `携带${c.move}` : `携带「${c.move}」招式`);
  if (c.region) bits.push(`在${c.region}地区进化`);
  if (c.candy) bits.push(`消耗 ${c.candy} 糖果`);
  if (c.coin) bits.push(`消耗 ${c.coin} 游戏币`);
  return bits.join(' · ');
}
// 交换出现概率：按 trade.js 的规则实算
let _tradeFams = null;
function tradeChance(index) {
  if (!_tradeFams) {
    const fams = new Map();
    for (const p of DEX) {
      if (p.legend) continue;                    // 神兽不参与交换
      const k = String(p.index).split('-')[0];
      if (!fams.has(k)) fams.set(k, []);
      fams.get(k).push(String(p.index));
    }
    _tradeFams = [...fams.values()];
  }
  const key = String(index);
  const fam = _tradeFams.find((g) => g.includes(key));
  if (!fam) return null;
  const bases = fam.filter((i) => !i.includes('-'));
  const pOne = (1 / _tradeFams.length) * ((bases.includes(key) ? TRADE_BASE_FORM_CHANCE / bases.length : 0) + (1 - TRADE_BASE_FORM_CHANCE) / fam.length);
  return 1 - Math.pow(1 - pOne, TRADE_COUNT);
}
function methodDetail(p, m, type) {
  if (type === 'wild') {
    if (p.legend) {
      // 神兽 / 幻兽单独一套说法：不进普通野池，走每日神兽池，概率写清楚
      return `每日神兽池：每天随机分到各地区的几只神兽 / 幻兽混在普通遇敌里，遇敌时约 <b>1/${Math.round(1 / LEGEND_ENCOUNTER_RATE)}</b> 直接遇到，甜甜蜜 / 闪耀护符生效期间约 <b>1/${Math.round(1 / LEGEND_ENCOUNTER_RATE_BUFF)}</b>。本只排在 <b>${p.region || '本地'}</b> 地区。`;
    }
    return `在 <b>${p.region || '本地'}</b> 地区的野外遇到（普通遇敌 / 大量出没 / 钓鱼）`;
  }
  if (type === 'tree') {
    const foods = (p.foods || []).map((i) => berryIconHtml(i)).join('');
    return `用配方一致的树果方块吸引（需先拥有过它）${foods ? `<span class="pk-recipe">配方 ${foods}</span>` : ''}`;
  }
  if (type === 'twist') {
    const own = p.region ? `${p.region}以外` : '它所在地区以外';
    return `在<b>${own}</b>的地区触发时空扭曲时出现`;
  }
  if (type === 'trade') {
    const c = tradeChance(p.index);
    const pct = c == null ? null : c * 100;
    // 变体形态一族 15% 要分给几十个形态，概率极小 —— 别显示成 0.00%
    const rate = pct == null ? '' : ` <b>${pct < 0.01 ? '&lt;0.01' : pct.toFixed(pct < 1 ? 2 : 1)}%</b>`;
    return rate ? `交换广场约${rate} 概率挂出` : '交换广场挂出';
  }
  if (type === 'egg_shop') return '孵化神秘蛋';
  if (type === 'easter_author') return '交换广场偶尔出现彩蛋 NPC <b>ZTMYO</b>：赠送闪光 6V 神兽';
  if (type === 'easter_imiti') return '交换广场偶尔出现彩蛋 NPC <b>伊美蒂</b>：赠送百变怪';
  if (type === 'breed') {
    const ps = parentNames(m.parents).map(esc).join('、');
    const pi = parentNames(m.parentsIncense).map(esc).join('、');
    // 只能和百变怪配的（玛纳霏）并进一句话说；能正常配对的就不提百变怪
    const ditto = !!m.note && m.note.includes('百变怪');
    let s = ps ? `亲本 <b>${ps}</b>${ditto ? '和百变怪生蛋' : ''}` : '';
    if (pi) s += `${s ? '；' : ''}开熏香生蛋，亲本：<b>${pi}</b>`;
    if (m.note && !ditto) s += `${s ? '；' : ''}${esc(m.note)}`;
    return s;
  }
  if (type === 'evolve') return `由 <b>${esc(dexName(m.from))}</b> 满足 <b>${condText(m.cond) || '特定条件'}</b> 进化而来`;
  return '';
}
// 进化链：从这只沿反向边回到族根，再往下铺它这一支的后代，每级带图标与条件
function evolveChainHtml(idx) {
  if (!EVO) return '';
  const E = EVO.edges || {}, stones = EVO.stones || {}, srcOf = EVO.stoneSource || {};
  const self = String(idx);
  const preds = new Map();
  for (const [from, row] of Object.entries(E)) for (const to of Object.keys(row)) {
    if (!preds.has(to)) preds.set(to, []);
    preds.get(to).push(from);
  }
  const suffixOf = (i) => {
    const q = DEX_BY_IDX.get(String(i));
    const f = (q && q.form) || '', n = (q && q.name) || '';
    return f.startsWith(n + '-') ? f.slice(n.length + 1) : '';
  };
  // 某一级的下一级 = 普通边 + 挂在它身上的专属石头形态
  const childrenOf = (i) => [
    ...Object.keys(E[i] || {}).map((k) => ({ id: k, cond: condText(E[i][k]) })),
    ...Object.keys(stones).filter((k) => String(srcOf[k]) === String(i)).map((k) => ({ id: k, cond: condText({ item: stones[k] }) })),
  ];
  // 族根：沿反向边往上走（同后缀优先，与游戏 familyRoot 同规则；石头形态先回挂靠形态）
  let cur = self, guard = 0;
  while (guard++ < 12) {
    let from = null;
    if (stones[cur]) from = String(srcOf[cur] || cur.split('-')[0]);
    else {
      const list = preds.get(cur) || [];
      if (!list.length) break;
      const sfx = suffixOf(cur);
      from = (sfx && list.find((f) => suffixOf(f) === sfx)) || (sfx && list.find((f) => !String(f).includes('-'))) || list[0];
    }
    cur = from;
  }
  // 一行一层：主干（根 → 本只）排在一行，行内可自然换行；其余分支各自成行、按挂下来的层数缩进。
  // 不依赖固定列宽，所以再长的链也只换行，不会把容器撑出横向滚动条
  const nodeCell = (i) => {
    const isSelf = String(i) === self;
    return `<span class="pk-node${isSelf ? ' self' : ''}">${iconSpanHtml(i, 26)}<span class="pk-stage-name">${esc(dexName(i))}</span></span>`;
  };
  const conn = (glyph, cond) => `<span class="pk-conn"><span class="pk-arrow">${glyph}</span>`
    + (cond ? `<span class="pk-cond">${esc(cond)}</span><span class="pk-arrow">→</span>` : '') + '</span>';
  // 根在左、分支向右的横向树：节点占列 2d+1、连接符占列 2d，整块不换行交给外层横向滚动
  const root = pathOf(self)[0];
  const cells = new Map();
  const put = (row, col, html, cls) => { cells.set(`${row}:${col}`, { html, cls }); };
  let count = 0, maxDepth = 0;
  const place = (i, row, depth) => {          // 返回这棵子树用到的最后一行
    put(row, 2 * depth + 1, nodeCell(i));
    maxDepth = Math.max(maxDepth, depth);
    const kids = childrenOf(i);
    if (!kids.length) return row;
    const rows = [row];                       // 每个孩子占的行（第一个接在父节点同一行）
    let last = row;
    for (let n = 0; n < kids.length; n++) {
      if (count++ >= 40) { kids.length = n; break; }
      const childRow = n === 0 ? row : last + 1;
      rows.push(childRow);
      last = Math.max(last, place(kids[n].id, childRow, depth + 1));
    }
    const col = 2 * (depth + 1);              // 连接符列：夹在父节点与子节点之间
    for (let n = 0; n < kids.length; n++) {
      const elbow = n === 0 ? (kids.length > 1 ? '┬' : '─') : (n === kids.length - 1 ? '└' : '├');
      put(rows[n + 1], col, conn(elbow, kids[n].cond), 'pk-conn');
    }
    // 兄弟之间补竖线：非最后那个孩子整棵子树的行上都要有 │
    for (let n = 0; n < kids.length - 1; n++) {
      for (let r = rows[n + 1] + 1; r <= rows[n + 2] - 1; r++) put(r, col, '<span class="pk-bar">│</span>', 'pk-conn');
    }
    return last;
  };
  place(root, 1, 0);
  if (cells.size < 2) return '';
  const parts = [];
  for (const [key, cell] of cells) {
    const [r, c] = key.split(':').map(Number);
    parts.push(`<span class="${cell.cls || 'pk-node-cell'}" style="grid-row:${r};grid-column:${c}">${cell.html}</span>`);
  }
  const more = count >= 40 ? '<div class="pk-tree-more">…还有更多形态未展开</div>' : '';
  const cols = 2 * maxDepth + 1;
  const body = `<div class="pk-tree" style="grid-template-columns:repeat(${cols},max-content)">${parts.join('')}</div>`;
  return `<div class="pk-chain"><span class="pk-chain-label">进化链</span><div class="pk-tree-scroll">${body}</div>${more}</div>`;
}

// 从某只沿反向边回到族根，返回 [族根, …, 这一只]（同后缀优先）
function pathOf(start) {
  const E = EVO.edges || {}, stones = EVO.stones || {}, srcOf = EVO.stoneSource || {};
  const preds = new Map();
  for (const [from, row] of Object.entries(E)) for (const to of Object.keys(row)) {
    if (!preds.has(to)) preds.set(to, []);
    preds.get(to).push(from);
  }
  const suffixOf = (i) => {
    const q = DEX_BY_IDX.get(String(i));
    const f = (q && q.form) || '', n = (q && q.name) || '';
    return f.startsWith(n + '-') ? f.slice(n.length + 1) : '';
  };
  const out = [String(start)];
  let cur = String(start), guard = 0;
  while (guard++ < 12) {
    let from = null;
    if (stones[cur]) from = String(srcOf[cur] || cur.split('-')[0]);
    else {
      const list = preds.get(cur) || [];
      if (!list.length) break;
      const sfx = suffixOf(cur);
      from = (sfx && list.find((f) => suffixOf(f) === sfx)) || (sfx && list.find((f) => !String(f).includes('-'))) || list[0];
    }
    out.unshift(from);
    cur = from;
  }
  return out;
}
const pkModal = document.getElementById('pkModal');
function closeAcquire() { if (pkModal) pkModal.hidden = true; }
function openAcquire(index) {
  try {
    const p = DEX_BY_IDX.get(String(index));
    if (!pkModal || !p) { console.warn('[pk] 提前返回：pkModal 或图鉴记录缺失'); return; }
    // 图标跟着 .pk-ico 的方框放大，靠 image-rendering: pixelated 保持像素感
    document.getElementById('pkIco').innerHTML = iconSpanHtml(index, 46);
    document.getElementById('pkTitle').innerHTML = `${esc(p.form || p.name)}<em>#${esc(p.index)}</em>`;
    // 列表里没有的信息：英文名 / 分类 / 身高体重；描述另起一段，配色跟着主属性
    const bits = [p.name_en, p.genus, p.height != null ? `高 ${(p.height / 10).toFixed(1)}m` : '', p.weight != null ? `重 ${(p.weight / 10).toFixed(1)}kg` : ''].filter(Boolean);
    document.getElementById('pkSub').textContent = bits.join(' · ');
    const descEl = document.getElementById('pkDesc');
    descEl.textContent = (p.description || '').replace(/\s+/g, ' ').trim();
    descEl.style.setProperty('--tc', p.legend ? '#b8860b' : (TYPE_COLORS[(p.types || [])[0]] || 'var(--screen-bg)'));
    const numEl = document.getElementById('pkNum');
    const listEl = document.getElementById('pkPills');
    numEl.textContent = '';
    listEl.innerHTML = '<div class="pk-empty">加载中…</div>';
    pkModal.hidden = false;
    loadAcqData().then(() => {
      const methods = ACQ.get(String(index)) || [];
      const row = (type, txt) => {
        const meta = ACQ_TYPES[type] || { label: type, color: '#888' };
        return `<div class="pk-method"><span class="pk-tag" style="--c:${meta.color}">${esc(meta.label)}</span><div class="pk-txt">${txt}</div></div>`;
      };
      const rows = [];
      // 进化并成一行（绅士蛾这类：多种形态都能进化成它，细节交给下面的进化链）
      const evos = methods.filter((m) => m.type === 'evolve');
      if (evos.length) {
        // 条件不在这里写：下面进化链上每级都标了（绅士蛾这类多形态也并成一行）
        const froms = [...new Set(evos.map((m) => dexName(m.from)))].map(esc).join(' / ');
        rows.push(row('evolve', `由 <b>${froms}</b> 进化而来`));
      }
      for (const m of methods) if (m.type !== 'evolve') rows.push(row(m.type, methodDetail(p, m, m.type)));
      const chain = evolveChainHtml(index);
      numEl.textContent = rows.length ? `（${rows.length} 种）` : '';
      listEl.innerHTML = (rows.join('') || '<div class="pk-empty">暂无获取途径数据</div>') + chain;
    }).catch((err) => {
      console.error('[pk] 获取途径 / 进化数据加载失败：', err);
      listEl.innerHTML = '<div class="pk-empty">获取途径数据加载失败，刷新重试</div>';
    });
  } catch (err) {
    console.error('[pk] 打开模态框出错：', err);
  }
}
if (pkModal) {
  dexBody.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target : null;
    const tr = el ? el.closest('tr[data-index]') : null;
    if (tr) openAcquire(tr.dataset.index);
  });
  document.getElementById('pkClose').addEventListener('click', closeAcquire);
  pkModal.addEventListener('click', (e) => { if (e.target === pkModal) closeAcquire(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pkModal.hidden) closeAcquire(); });
} else {
  console.warn('[pk] 页面里没有 #pkModal，模态框逻辑没挂上');
}

async function loadDex() {
  try {
    // 图标位置表跟图鉴一起取：行 HTML 有缓存，必须先到齐再渲染
    const [res, ico] = await Promise.all([fetch('./pokedex.json'), fetch('./pokeicons.json').catch(() => null)]);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (ico && ico.ok) ICONS = await ico.json();
    DEX = orderDex(await res.json());
    DEX_BY_IDX = new Map(DEX.map((p) => [String(p.index), p]));
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