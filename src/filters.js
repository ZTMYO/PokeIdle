// ===== 通用筛选下拉 =====
// 来源筛选（roster / 训练放入页共用）：一级=来源（全部/神兽/野生/钓鱼/孵蛋/交换/时空扭曲），
// 二级=完整组合（闪光/变体/普通/神兽/非闪），神兽为独立入口；闪光与变体两个带三级展开项置顶。

// 全局关闭所有下拉：模块级注册一次 document 点击。
// 训练放入页每次进入会重新调用 setupSourceFilter，若在函数内注册会重复累积监听
let _ddBound = false;
export function closeAllDropdowns() {
  document.querySelectorAll('.region-dropdown').forEach(d => { d.style.display = 'none'; });
  document.querySelectorAll('.pokedex-region-select').forEach(s => s.classList.remove('open'));
}
if (!_ddBound) {
  _ddBound = true;
  document.addEventListener('click', closeAllDropdowns);
}

// 来源筛选选中后的标签短名（如"野·闪""钓·普闪"；神兽入口显示"神"）
export function sourceFilterLabel(s) {
  const srcShort = { normal: '野', fishing: '钓', egg: '蛋', trade: '换', twist: '扭' };
  const comboShort = { '|': '全部', 'legend|': '神', 'normal|normal': '普', 'legend|normal': '神', '|normal': '非闪', '|shiny': '闪', 'normal|shiny': '普闪', 'legend|shiny': '神闪' };
  if (!s.src) return comboShort[`${s.legend}|${s.shiny}`] || '全部';
  if (s.variant) {
    const vShort = { any: '变', rgb: 'RGB', polluted: '污染' };
    return `${srcShort[s.src]}·${vShort[s.variant]}`;
  }
  return `${srcShort[s.src]}·${comboShort[`${s.legend}|${s.shiny}`]}`;
}

// 通用来源筛选下拉。opts: { trigger, label, dd, state, onPick }
// state 需提供 src/legend/shiny/variant 四个可读写字段；onPick 选中后回调（刷新列表）
export function setupSourceFilter({ trigger, label, dd, state, onPick }) {
  if (!trigger || !label || !dd) return;

  const SRC_ORDER = [['', '全部'], ['legend', '神兽'], ['normal', '野生'], ['fishing', '钓鱼'], ['egg', '孵蛋'], ['trade', '交换'], ['twist', '扭曲']];
  const COMBO_ORDER = [
    ['normal', 'normal', '普通'],
    ['legend', 'normal', '神兽'],
    ['', 'normal', '非闪'],
  ];
  const SHINY_ORDER = [
    ['normal', 'shiny', '普通闪光'],
    ['legend', 'shiny', '神兽闪光'],
  ];

  function buildOptions() {
    dd.innerHTML = SRC_ORDER.map(([k, name]) => {
      if (!k) {
        return `<div class="region-dropdown-item${!state.src && !state.legend && !state.shiny && !state.variant ? ' active' : ''}" data-src="" data-legend="" data-shiny="">全部</div>`;
      }
      const sub = [];
      if (k === 'legend') {
        // 神兽独立入口：子菜单仅「非闪光」「闪光」
        sub.push(`<div class="region-dropdown-item${state.legend === 'legend' && state.shiny === 'normal' && !state.src ? ' active' : ''}"
             data-src="" data-legend="legend" data-shiny="normal">非闪光</div>`);
        sub.push(`<div class="region-dropdown-item${state.legend === 'legend' && state.shiny === 'shiny' && !state.src ? ' active' : ''}"
             data-src="" data-legend="legend" data-shiny="shiny">闪光</div>`);
      } else if (k === 'twist') {
        // 时空扭曲专属：二级直接列出 RGB / 污染 / 闪光三个叶子项
        sub.push(`<div class="region-dropdown-item${state.src === k && state.variant === 'rgb' && !state.legend && !state.shiny ? ' active' : ''}"
             data-src="${k}" data-legend="" data-shiny="" data-variant="rgb">RGB</div>`);
        sub.push(`<div class="region-dropdown-item${state.src === k && state.variant === 'polluted' && !state.legend && !state.shiny ? ' active' : ''}"
             data-src="${k}" data-legend="" data-shiny="" data-variant="polluted">污染</div>`);
        sub.push(`<div class="region-dropdown-item${state.src === k && state.shiny === 'shiny' && !state.legend && !state.variant ? ' active' : ''}"
             data-src="${k}" data-legend="" data-shiny="shiny">闪光</div>`);
      } else {
        // 闪光三级：置顶，hover 展开普通闪光/神兽闪光
        sub.push(`<div class="roster-filter-item">
          <span class="roster-filter-leaf${state.src === k && state.shiny === 'shiny' && !state.legend ? ' active' : ''}"
                data-src="${k}" data-legend="" data-shiny="shiny">闪光</span>
          <span class="roster-filter-arrow">▸</span>
          <div class="roster-sub-menu">
            ${SHINY_ORDER.map(([lk, shk, cname]) => `
            <div class="region-dropdown-item${state.src === k && state.legend === lk && state.shiny === shk ? ' active' : ''}"
                 data-src="${k}" data-legend="${lk}" data-shiny="${shk}">${cname}</div>`).join('')}
          </div>
        </div>`);
        // 普通/神兽/非闪叶子
        sub.push(COMBO_ORDER.map(([lk, shk, cname]) => `
          <div class="region-dropdown-item${state.src === k && state.legend === lk && state.shiny === shk && !state.variant ? ' active' : ''}"
               data-src="${k}" data-legend="${lk}" data-shiny="${shk}">${cname}</div>`).join(''));
      }
      return `<div class="roster-filter-item">
        <span class="roster-filter-src${(k === 'legend' ? state.legend === 'legend' && !state.src && !state.shiny && !state.variant : state.src === k && !state.legend && !state.shiny && !state.variant) ? ' active' : ''}" data-src="${k}">${name}</span>
        <span class="roster-filter-arrow">▸</span>
        <div class="roster-sub-menu">
          ${sub.join('')}
        </div>
      </div>`;
    }).join('');
  }

  function pickItem(el) {
    state.src = el.dataset.src || '';
    state.legend = el.dataset.legend || '';
    state.shiny = el.dataset.shiny || '';
    state.variant = el.dataset.variant || '';
    label.textContent = sourceFilterLabel(state);
    dd.style.display = 'none';
    trigger.classList.remove('open');
    onPick();
  }

  // 点击叶子项（带完整组合值）直接选中
  dd.addEventListener('click', (e) => {
    e.stopPropagation();
    const el = e.target.closest('[data-src][data-legend]');
    if (el) { pickItem(el); return; }
    // 点击来源标题（如「扭曲」）：直接筛出该来源全部，不限普/神/闪/变体；
    // 神兽独立入口，点击 = 筛选全部神兽
    const srcEl = e.target.closest('.roster-filter-src');
    if (srcEl) {
      pickItem(srcEl.dataset.src === 'legend'
        ? { dataset: { src: '', legend: 'legend', shiny: '', variant: '' } }
        : { dataset: { src: srcEl.dataset.src || '', legend: '', shiny: '', variant: '' } });
    }
  });
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dd.style.display !== 'none';
    closeAllDropdowns();
    if (!open) {
      buildOptions();
      dd.style.display = '';
      trigger.classList.add('open');
    }
  });
}
