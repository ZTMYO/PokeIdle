// ===== 道具盒 =====
// 只读陈列册：顶部搜索 + 五个页签（基础 / 树果 / 进化 / 专属 / 薄荷）；每行只有图标、名字、个数，个数为 0 的不显示。
// 搜索时页签换成单个「搜索结果」。出售在商店的「出售」列表。
import { $, showView } from './ui.js';
import { gameData, pushNav } from './state.js';
import { ensureBerryFarm } from './berry.js';
import { ITEM_NAMES, CANDY_EXCHANGE, EVO_PRICES } from './config.js';
import { BERRY_ICONS, BERRY_NAMES, itemIconSrc, evoIconSrc, evoExclusivePool, MINT_KEYS, ensureEvoMeta, BASIC_ITEM_ORDER } from './items.js';

const BERRY_DIR = './items/berries/';

// 树果库存按 BERRY_ICONS 下标存，所以 berry: 后面跟的是下标
const qtyOf = (key) => (key.startsWith('berry:')
  ? (ensureBerryFarm().stock[Number(key.slice(6))] || 0)
  : (gameData.items[key] || 0));

const rowHtml = (it) => `<div class="ib-row">
  <img src="${it.icon}" alt="" />
  <span class="ib-name">${it.name}</span>
  <span class="ib-qty">×${it.qty}</span>
</div>`;

// 只列持有中的，数量多的在前
function itemsOf(keys, iconOf, nameOf) {
  return keys
    .map((k) => ({ k, qty: qtyOf(k) }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.qty - a.qty || String(nameOf(a.k)).localeCompare(String(nameOf(b.k)), 'zh'))
    .map((x) => ({ name: String(nameOf(x.k)), icon: iconOf(x.k), qty: x.qty }));
}

const TABS = [
  { key: 'basic', label: '基础' },
  { key: 'berry', label: '树果' },
  { key: 'evo', label: '进化' },
  { key: 'stone', label: '专属' },
  { key: 'mint', label: '薄荷' },
];
let _tab = 'basic';
let _query = '';     // 搜索词，非空时页签只剩「搜索结果」
let _groups = {};    // 各类各自的持有道具
let _all = [];       // 四类合并，搜索结果用

export async function renderItemBox() {
  await ensureEvoMeta();
  _query = '';

  const basicKeys = BASIC_ITEM_ORDER.concat(Object.keys(CANDY_EXCHANGE).filter((k) => !EVO_PRICES[k] && !BASIC_ITEM_ORDER.includes(k)));
  _groups = {
    basic: itemsOf(basicKeys, itemIconSrc, (k) => ITEM_NAMES[k] || k),
    berry: itemsOf(BERRY_ICONS.map((_, i) => `berry:${i}`), (k) => BERRY_DIR + BERRY_ICONS[Number(k.slice(6))], (k) => BERRY_NAMES[BERRY_ICONS[Number(k.slice(6))]] || '树果'),
    evo: itemsOf(Object.keys(EVO_PRICES), evoIconSrc, (k) => ITEM_NAMES[k] || k),
    stone: itemsOf(evoExclusivePool(), evoIconSrc, (k) => k),
    mint: itemsOf(MINT_KEYS, itemIconSrc, (k) => k),
  };
  _all = ['basic', 'berry', 'evo', 'stone', 'mint'].flatMap((k) => _groups[k]);
  paint();
}

function paint() {
  const box = $('itemBoxContent');
  if (!box || !_groups.basic) return;
  box.innerHTML = `
    <div class="pokedex-search ib-search">
      <div class="pokedex-search-row">
        <div class="pokedex-search-input-wrap">
          <input id="itemBoxSearch" class="pokedex-search-input" type="text" placeholder="搜索道具" autocomplete="off" />
          <button class="pokedex-search-clear" id="itemBoxSearchClear" style="display:none" aria-label="清空搜索">
            <svg><use xlink:href="#icon-close"></use></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="ib-tabs"></div>
    <div class="ib-list"></div>`;
  const input = box.querySelector('#itemBoxSearch');
  const clear = box.querySelector('#itemBoxSearchClear');
  const onSearch = () => {
    _query = input.value.trim();
    clear.style.display = _query ? '' : 'none';
    paintTabs(box);
    paintList(box);
  };
  input.oninput = onSearch;
  clear.onclick = () => { input.value = ''; onSearch(); input.focus(); };
  paintTabs(box);
  paintList(box);
}

// 页签行：搜索时只剩一个「搜索结果」，清空搜索后回到五个分类
function paintTabs(box) {
  const host = box.querySelector('.ib-tabs');
  if (!host) return;
  const tabs = _query ? [{ key: 'search', label: '搜索结果' }] : TABS;
  const cur = _query ? 'search' : _tab;
  host.className = `ib-tabs${_query ? ' solo' : ''}`; // solo：单页签贴左，下划线只到文字宽度
  host.innerHTML = tabs.map((t) => `<div class="ib-tab${t.key === cur ? ' on' : ''}" data-tab="${t.key}">${t.label}</div>`).join('');
  host.onclick = (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t || t.dataset.tab === 'search') return; // 搜索结果不是分类
    _tab = t.dataset.tab;
    paintTabs(box);
    paintList(box);
  };
}

function paintList(box) {
  const host = box.querySelector('.ib-list');
  if (!host) return;
  let items;
  if (_query) {
    const q = _query.toLowerCase();
    items = _all
      .filter((it) => it.name.toLowerCase().includes(q))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'zh'));
  } else {
    items = _groups[_tab] || [];
  }
  host.innerHTML = items.length
    ? items.map(rowHtml).join('')
    : `<div class="ib-empty">${_query ? '没有匹配的道具' : '还没有这类道具'}</div>`;
  host.scrollTop = 0;
}

// ===== 页面入口 =====
export function showItemBoxView() {
  pushNav('itemBoxView');
  showView('itemBoxView');
  renderItemBox();
}
