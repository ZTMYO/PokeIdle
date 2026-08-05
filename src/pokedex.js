// ===== 图鉴模块 =====
import { ITEM_NAMES } from './config.js';
import { phase, gameData, allPokemon, getPokemonByIndex, currentEncounter, _pokedexInLogView, _pokedexSortBy, _pokedexSortDir, pad, randInt, setPrevView, setPokedexInLogView, setPokedexSortBy, setPokedexSortDir } from './state.js';
import { $, showView, tryLoadPokemonImage, tryLoadImage, fitPokemonImage, setupFoodTooltip } from './ui.js';
import { TYPE_COLORS, BERRY_ICONS, BERRY_NAMES } from './items.js';

// 图鉴/统计页的地区筛选选项
const REGION_OPTIONS = ['全部地区', '关都', '城都', '丰缘', '神奥', '合众', '卡洛斯', '阿罗拉', '伽勒尔', '帕底亚'];

export function formatLogTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function describeLogEntry(log) {
  // 统计使用的球种
  const ballTypes = [];
  for (const [type, count] of Object.entries(log.balls)) {
    if (count > 0) ballTypes.push({ type, count });
  }
  const multi = ballTypes.length > 1;

  // 结果描述
  let desc;
  if (ballTypes.length === 0) {
    if (log.manual !== undefined) {
      desc = '你直接逃跑了';
    } else if (log.source === 'trade') {
      desc = log.gave ? `用${log.gave}交换而来` : '通过交换获得';
    } else if (log.result === 'caught') {
      desc = '通过孵化获得';
    } else {
      desc = '精灵逃走了';
    }
  } else if (log.result === 'caught') {
    if (multi) {
      const parts = ballTypes.map(b => `${b.count} 颗${ITEM_NAMES[b.type]}`);
      desc = '先后消耗 ' + parts.join('、') + '后成功捕获';
    } else {
      desc = `仅消耗 ${ballTypes[0].count} 颗${ITEM_NAMES[ballTypes[0].type]}就抓住了`;
    }
  } else if (log.manual !== undefined) {
    if (ballTypes.length === 0) {
      desc = '你直接逃跑了';
    } else if (multi) {
      const parts = ballTypes.map(b => `${b.count} 颗${ITEM_NAMES[b.type]}`);
      desc = '先后消耗 ' + parts.join('、') + '后，你选择了逃跑';
    } else {
      desc = `消耗 ${ballTypes[0].count} 颗${ITEM_NAMES[ballTypes[0].type]}后，你选择了逃跑`;
    }
  } else {
    if (multi) {
      const parts = ballTypes.map(b => `${b.count} 颗${ITEM_NAMES[b.type]}`);
      desc = '消耗 ' + parts.join('、') + '，精灵最终逃跑了';
    } else {
      desc = `消耗 ${ballTypes[0].count} 颗${ITEM_NAMES[ballTypes[0].type]}后精灵逃跑了`;
    }
  }

  return desc;
}

export function showEncounterLogs(pokemonIndex) {
  setupFoodTooltip();
  const idx = String(pokemonIndex);
  if (!gameData.encounterLogs) gameData.encounterLogs = {};
  const logs = gameData.encounterLogs[idx];
  const poke = getPokemonByIndex(pokemonIndex);
  const caughtEntry = gameData.pokedex[idx];
  const seenCount = caughtEntry?.seen || 0;
  const caughtCount = caughtEntry?.caught || 0;
  const displayName = seenCount > 0 ? (poke?.name || `#${pokemonIndex}`) : '？？？';
  const list = $('pokedexList');
  if (!list) return;

  setPokedexInLogView(true);
  // 保存滚动位置并滚到顶部
  const pl = $('pokedexList');
  if (pl) { pl.dataset.savedScroll = pl.scrollTop; pl.scrollTop = 0; }
  // 隐藏搜索框、表头和进度
  document.querySelector('.pokedex-search').style.display = 'none';
  document.querySelector('.pokedex-header').style.display = 'none';
  const progEl = $('pokedexProgress');
  if (progEl) progEl.style.display = 'none';

  // 构建 HTML：宝可梦素材 + 日志列表
  let html = `<div style="font-size:14px;font-weight:700;padding:6px 5px 2px;">${displayName}</div>`;
  // 未遇到：不展示素材
  if (seenCount > 0) {
    html += `<div style="display:flex;gap:8px;padding:2px 3px;align-items:center;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0;">
        <div class="poke-img-grid" title="点击切换闪光">
          <img id="logPokeImg" class="poke-img-in-grid" />
        </div>
        ${(caughtCount > 0 && poke && poke.genus) ? `<div style="font-size:9px;">${poke.genus}</div>` : ''}
      </div>
      <div style="min-width:0;">
        <div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:2px;">
          ${(poke && poke.types || []).map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t]||'#888'}">${t}</span>`).join('')}
        </div>
        <div style="font-size:10px;line-height:1.5;">${poke && poke.region ? `<div>地区：${poke.region}</div>` : ''}
        ${(() => {
          const r = (poke && poke.catchRate !== undefined) ? poke.catchRate : 0.5;
          const rarity = (poke && poke.rarity !== undefined) ? poke.rarity : 0.5;
          if (caughtCount > 0) {
            return `<div>捕获率：${(r * 100).toFixed(0)}%</div><div>稀有度：${rarity.toFixed(2)}</div>`;
          } else {
            let crLabel;
            if (r <= 0.1) crLabel = '极低';
            else if (r <= 0.25) crLabel = '低';
            else if (r <= 0.45) crLabel = '中低';
            else if (r <= 0.65) crLabel = '中';
            else if (r <= 0.85) crLabel = '中高';
            else crLabel = '高';
            let rLabel;
            if (rarity <= 0.2) rLabel = '常见';
            else if (rarity <= 0.4) rLabel = '一般';
            else if (rarity <= 0.6) rLabel = '稀有';
            else if (rarity <= 0.8) rLabel = '罕见';
            else rLabel = '极稀有';
            return `<div>捕获率：${crLabel}</div><div>稀有度：${rLabel}</div>`;
          }
        })()}
        ${(poke && poke.height != null) ? `<div>身高：${(poke.height/10).toFixed(1)}m</div>` : ''}
        ${(poke && poke.weight != null) ? `<div>体重：${(poke.weight/10).toFixed(1)}kg</div>` : ''}
      </div>
      </div>
      ${(caughtCount > 0 && poke && poke.stats && poke.stats.length) ? `<div style="font-size:10px;flex:1;min-width:0;overflow:hidden;">${(() => {
        // stats 为固定顺序数字数组：0=HP, 1=物攻, 2=物防, 3=特攻, 4=特防, 5=速度
        const statNames = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
        const maxStat = 255;
        return poke.stats.map((v, i) => `<div style="display:flex;align-items:center;gap:2px;line-height:1.4;">
          <span style="width:24px;flex-shrink:0;">${statNames[i]||i}</span>
          <span style="width:16px;text-align:right;flex-shrink:0;">${v}</span>
          <div style="flex:1;height:4px;background:rgba(var(--ui-color-rgb),0.12);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${(v/maxStat*100).toFixed(0)}%;background:rgba(var(--ui-color-rgb),0.5);border-radius:2px;"></div>
          </div>
        </div>`).join('');
      })()}</div>` : ''}
    </div>`;
    // 描述文本（仅捕获后显示）
    if (caughtCount > 0 && poke && poke.description) {
      html += `<div style="font-size:10px;line-height:1.5;padding:2px 0 4px;">${poke.description}</div>`;
    }
    // 喜欢的食物（仅捕获后显示）
    if (caughtCount > 0 && poke && poke.foods && poke.foods.length) {
      const foodIcons = poke.foods.map(i =>
        `<img class="berry-icon" data-berry="${i}" data-tip="${BERRY_NAMES[BERRY_ICONS[i]]}" alt="树果${i + 1}" style="width:16px;height:16px;vertical-align:middle;cursor:pointer;" />`).join('');
      html += `<div style="font-size:10px;line-height:1.6;padding:2px 0 4px;display:flex;align-items:center;"><span style="flex-shrink:0;">爱吃的食物：</span><span style="display:flex;align-items:center;">${foodIcons}</span></div>`;
    }
  }

  const renderLogContent = () => {
    if (!logs || logs.length === 0) {
      return '<div style="padding:20px 4px;text-align:center;">暂无任何遭遇日志</div>';
    }
    const sorted = [...logs].sort((a, b) => b.time - a.time);
    let content = '<div style="padding:0 4px;">';
    for (const log of sorted) {
      // 孵化与交换都不消耗球（balls 为空对象），需排除交换来源避免误判为孵化
      const isHatch = log.result === 'caught' && log.source !== 'trade' && Object.values(log.balls).every(v => v === 0);
      let label;
      if (isHatch) {
        label = '☆ 孵化获得';
      } else if (log.result === 'caught') {
        label = log.source === 'fishing' ? '☆ 钓鱼捕获' : (log.source === 'trade' ? (log.npcName ? `和${log.npcName}交换获得` : '☆ 交换获得') : '☆ 捕获成功');
      } else if (log.manual !== undefined) {
        label = log.source === 'fishing' ? '钓鱼遭遇后逃跑' : '主动逃跑';
      } else {
        label = log.source === 'fishing' ? '钓鱼遭遇后逃脱' : '精灵逃跑';
      }
      const typeLabel = (() => {
        // 孵化与交换都不消耗球：不标注「未丢球」
        if (isHatch || log.source === 'trade') return '';
        const cnt = Object.values(log.balls).filter(v => v > 0).length;
        if (cnt <= 1) {
          const bt = Object.entries(log.balls).find(([,v]) => v > 0);
          return bt ? `仅${ITEM_NAMES[bt[0]]}` : '未丢球';
        }
        return '多种球混用';
      })();
      const shinyIcon = '<svg viewBox="0 0 1024 1024" width="10" height="10" style="vertical-align:-1px;color:var(--ui-color);"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>';
      content += `<div style="padding:4px 0;border-bottom:1px solid rgba(48,98,48,0.06);">
        <div style="font-size:9px;opacity:0.4;line-height:1.4;">${formatLogTime(log.time)}</div>
        <div >${label}${log.shiny ? ' ' + shinyIcon : ''}${typeLabel ? '，' + typeLabel : ''}</div>
        <div style="font-size:10px;line-height:1.4;">${describeLogEntry(log)}</div>
      </div>`;
    }
    content += '</div>';
    return content;
  };

  html += renderLogContent();
  list.innerHTML = html;

  // 树果图标走降级链加载（中文文件名直接 <img> 在部分 WebView 下会失败）
  list.querySelectorAll('.berry-icon').forEach(icon => {
    const bi = Number(icon.dataset.berry);
    tryLoadImage(icon, `./items/berries/${BERRY_ICONS[bi]}`);
  });

  // 加载宝可梦素材，点击切换闪光
  const img = $('logPokeImg');
  if (img && poke) {
    img.dataset.shiny = 'false';
    tryLoadPokemonImage(img, poke, '');
    img.onclick = () => {
      const isShiny = img.dataset.shiny === 'true';
      const suffix = isShiny ? '' : '_shiny';
      // 短暂隐藏，用完整 fallback 链加载，加载完再显示
      img.style.visibility = 'hidden';
      tryLoadPokemonImage(img, poke, suffix).then(() => {
        img.style.visibility = 'visible';
        img.dataset.shiny = isShiny ? 'false' : 'true';
      });
    };
  }
}

export function restorePokedex() {
  setPokedexInLogView(false);
  // 恢复搜索框、表头和进度
  document.querySelector('.pokedex-search').style.display = '';
  document.querySelector('.pokedex-header').style.display = '';
  const progEl = $('pokedexProgress');
  if (progEl) progEl.style.display = '';
  showPokedex();
  // 恢复滚动位置（列表容器的滚动）
  const pl = $('pokedexList');
  if (pl && pl.dataset.savedScroll) {
    requestAnimationFrame(() => { pl.scrollTop = Number(pl.dataset.savedScroll); });
  }
}

export function matchPinyinPartial(query, pinyin) {
  const q = query.toLowerCase();
  // 按大写字母拆分音节
  const syllables = [];
  let cur = '';
  for (let i = 0; i < pinyin.length; i++) {
    const ch = pinyin[i];
    if (i > 0 && ch >= 'A' && ch <= 'Z' && cur.length > 0) {
      syllables.push(cur.toLowerCase());
      cur = ch.toLowerCase();
    } else {
      cur += ch.toLowerCase();
    }
  }
  if (cur) syllables.push(cur.toLowerCase());
  if (syllables.length === 0) return false;

  // DFS：从 query 第 qIdx 位开始在音节上匹配
  function dfs(sylIdx, qIdx) {
    if (qIdx >= q.length) return true;
    if (sylIdx >= syllables.length) return false;
    const syl = syllables[sylIdx];
    if (q[qIdx] !== syl[0]) return false;
    // 尝试匹配 1~n 个字符（首字母或前半截）
    for (let len = 1; len <= syl.length && qIdx + len <= q.length; len++) {
      if (q.substring(qIdx, qIdx + len) === syl.substring(0, len)) {
        if (dfs(sylIdx + 1, qIdx + len)) return true;
      }
    }
    return false;
  }
  return dfs(0, 0);
}

export function setupPokedexSearch() {
  const input = $('pokedexSearchInput');
  const dropdown = $('pokedexSearchDropdown');
  const clearBtn = $('pokedexSearchClear');
  if (!input || !dropdown) return;

  // 清空按钮只在有输入时显示
  const syncClear = () => {
    if (clearBtn) clearBtn.style.display = input.value.trim() ? '' : 'none';
  };
  syncClear();

  let hideTimer = null;

  input.addEventListener('input', () => {
    syncClear();
    const q = input.value.trim();
    if (!q) { dropdown.style.display = 'none'; return; }

    const upper = q.toUpperCase();
    const matched = allPokemon.filter(p =>
      (gameData.pokedex?.[p.index]?.seen || 0) > 0 && (
        p.name.includes(q) ||
        p.pinyin.toUpperCase().includes(upper) ||
        p.pinyinInitials.toUpperCase().includes(upper) ||
        matchPinyinPartial(q, p.pinyin)
      )
    ).slice(0, 50); // 最多50条

    if (matched.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    let html = '';
    for (const p of matched) {
      html += `<div class="pokedex-dropdown-item" data-index="${p.index}">
        <span class="dd-idx">#${p.index}</span>
        <span class="dd-name">${p.name}</span>
      </div>`;
    }
    dropdown.innerHTML = html;
    dropdown.style.display = '';

    // 点击下拉项跳转到目标
    dropdown.querySelectorAll('.pokedex-dropdown-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = el.dataset.index;
        const target = document.querySelector(`.pokedex-entry[data-index="${idx}"]`);
        if (target) {
          target.scrollIntoView({ block: 'center', behavior: 'instant' });
          target.classList.remove('flash');
          void target.offsetHeight; // reflow 让动画重新触发
          target.classList.add('flash');
        }
        input.value = '';
        dropdown.style.display = 'none';
        syncClear();
      });
    });
  });

  input.addEventListener('blur', () => {
    hideTimer = setTimeout(() => { dropdown.style.display = 'none'; }, 200);
  });
  input.addEventListener('focus', () => {
    if (hideTimer) clearTimeout(hideTimer);
    if (input.value.trim() && dropdown.children.length > 0) {
      dropdown.style.display = '';
    }
  });

  // 清空按钮：清空输入并收起下拉
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      dropdown.style.display = 'none';
      syncClear();
      input.focus();
    });
  }
}

// 地区筛选自定义下拉（原为 IIFE，现改为可导出的函数）
export function setupRegionDropdown() {
  const trigger = $('pokedexRegionFilter');
  const label = $('pokedexRegionLabel');
  const dd = $('pokedexRegionDropdown');
  if (!trigger || !label || !dd) return;

  function buildOptions() {
    dd.innerHTML = REGION_OPTIONS.map(r =>
      `<div class="region-dropdown-item${r === label.textContent ? ' active' : ''}" data-region="${r}">${r}</div>`
    ).join('');

    dd.querySelectorAll('.region-dropdown-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        label.textContent = el.dataset.region;
        dd.style.display = 'none';
        trigger.classList.remove('open');
        if ($('pokedexView').style.display !== 'none') showPokedex();
      });
    });
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dd.style.display !== 'none';
    // 关闭所有其它下拉
    document.querySelectorAll('.region-dropdown').forEach(d => d.style.display = 'none');
    document.querySelectorAll('.pokedex-region-select').forEach(s => s.classList.remove('open'));

    if (!open) {
      buildOptions();
      dd.style.display = '';
      trigger.classList.add('open');
    }
  });

  // 点击外部关闭
  document.addEventListener('click', () => {
    dd.style.display = 'none';
    trigger.classList.remove('open');
  });
}

// ===== 图鉴列表 =====
export function showPokedex() {
  // 从手机主页进入时，返回应回到手机主页
  setPrevView($('phoneView')?.style.display !== 'none' ? 'phoneView' : (phase === 'encounter' ? 'encounterView' : 'idleView'));
  const list = $('pokedexList');
  if (!list) return;
  delete list.dataset.savedHtml;
  const caughtMap = gameData.pokedex || {};
  const regionLabel = $('pokedexRegionLabel')?.textContent || '';
  const regionFilter = regionLabel === '全部地区' ? '' : regionLabel;
  const filtered = regionFilter ? allPokemon.filter(p => p.region === regionFilter) : allPokemon;
  // 更新捕获进度
  const progEl = $('pokedexProgress');
  if (progEl) {
    const total = filtered.length;
    const seen = filtered.filter(p => (caughtMap[p.index]?.seen||0) > 0).length;
    const caught = filtered.filter(p => (caughtMap[p.index]?.caught||0) > 0).length;
    progEl.textContent = `已相遇 ${seen}/${total}  ·  已捕获 ${caught}/${total}`;
  }
  // 排序
  const sorted = [...filtered].sort((a, b) => {
    const va = _pokedexSortBy === 'name' ? a.name : _pokedexSortBy === 'index' ? a.index : (caughtMap[a.index]?.[_pokedexSortBy] || 0);
    const vb = _pokedexSortBy === 'name' ? b.name : _pokedexSortBy === 'index' ? b.index : (caughtMap[b.index]?.[_pokedexSortBy] || 0);
    if (typeof va === 'string') return va.localeCompare(vb) * _pokedexSortDir;
    return (va - vb) * _pokedexSortDir;
  });
  let html = '';
  for (const p of sorted) {
    const entry = caughtMap[p.index];
    const seen = entry?.seen || 0;
    const caught = entry?.caught || 0;
    const shinySeen = entry?.shinySeen || 0;
    const shinyCaught = entry?.shinyCaught || 0;
    const shinyTag = caught > 0 ? (shinyCaught > 0 ? '★' : '☆') : '';
    html += `<div class="pokedex-entry${seen > 0 ? '' : ' disabled'}" data-index="${p.index}" data-seen="${seen > 0 ? '1' : '0'}">
      <span class="pokedex-star">${shinyTag}</span>
      <span class="pokedex-idx">#${p.index}</span>
      <span class="pokedex-name">${seen > 0 ? p.name : '？？？'}</span>
      <span class="pokedex-stat">${seen}</span>
      <span class="pokedex-stat">${caught}</span>
      <span class="pokedex-stat">${shinySeen}</span>
      <span class="pokedex-stat">${shinyCaught}</span>
    </div>`;
  }
  list.innerHTML = html;
  // 点击条目弹出遭遇日志（仅已看到过的）
  list.onclick = (e) => {
    const entry = e.target.closest('.pokedex-entry');
    if (entry && entry.dataset.seen === '1') showEncounterLogs(entry.dataset.index);
  };
  // 表头点击排序
  sortHeaderClick();
  // 标记当前排序列
  const header = document.querySelector('.pokedex-header');
  if (header) {
    header.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
    const cur = header.querySelector(`[data-sort="${_pokedexSortBy}"]`);
    if (cur) cur.classList.add(_pokedexSortDir === 1 ? 'sort-asc' : 'sort-desc');
  }
  showView('pokedexView');
}

export function sortHeaderClick() {
  const header = document.querySelector('.pokedex-header');
  if (!header) return;
  header.onclick = (e) => {
    const span = e.target.closest('[data-sort]');
    if (!span) return;
    const field = span.dataset.sort;
    if (_pokedexSortBy === field) {
      setPokedexSortDir(_pokedexSortDir * -1); // 同字段切换升降序
    } else {
      setPokedexSortBy(field);
      setPokedexSortDir(-1);   // 新字段默认降序
    }
    // 更新表头指示符
    header.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
    span.classList.add(_pokedexSortDir === 1 ? 'sort-asc' : 'sort-desc');
    showPokedex();
  };
}
