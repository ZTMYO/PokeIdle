// ===== 宝可梦仓库 =====
// 查看当前拥有的每只宝可梦个体（个体值/闪光/来源/在仓状态），
// 交互与图鉴对齐：搜索 / 来源筛选 / 表头排序 / 点击进入个体详情，详情页可返回列表。
import { $, showView, tryLoadImage, tryLoadPokemonImage } from './ui.js';
import { gameData, getPokemonByIndex, getNature, pushNav, resetNav, saveGame, addSystemLog, setPokedexInLogView, ensureGender, genderBadge, isPokemon } from './state.js';
import { TYPE_COLORS } from './items.js';
import { matchPinyinPartial, describeLogEntry } from './pokedex.js';
import { showGoodbyeConfirm, startShinySparkleOn, stopShinySparkleLoop } from './animation.js';
import { chooseMoves, fallbackMoves } from './moves.js';

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

let _sortBy = 'time';  // 当前排序列：time | name | iv | level
let _sortDir = -1;     // 1 升序 / -1 降序
let _filter = '';      // 来源/闪光筛选（''=全部）
let _typeFilter = '';  // 属性筛选（''=全部）
let _detailId = null;  // 当前详情个体 id（非空=处于详情页）
let _detailFromView = null; // 详情跳转来源（捕获/孵蛋后“查看详情”进入时记录，返回列表后再返回时优先回来源）
let _detailReturnFn = null; // 从悬赏提交/交换选择列表进入详情时注册的返回回调（返回时恢复来源列表）
let _detailJumpedToPokedex = false; // 详情页跳转图鉴中（返回键应先回详情页，再按来源返回）
let _picker = null; // 选取模式：配队/训练点击空位跳转仓库选择，{ mode:'team'|'train', slot, from, exclude[] }

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

// 在仓个体列表（只含宝可梦：蛋条目不占仓库，仅孵蛋器「宝可梦蛋」列表可查看/放入）
function inRoster() {
  return (gameData.roster || []).filter(p => p.inRoster && isPokemon(p));
}

// 显示名：优先昵称，回退物种名
function rosterName(p) {
  if (p.nickname) return p.nickname;
  const poke = getPokemonByIndex(String(p.species));
  return poke ? poke.name : `#${p.species}`;
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
    matchPinyinPartial(q, poke.pinyin) ||
    (p.nickname && p.nickname.includes(q));  // 中文昵称匹配，拼音不参与
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
  // 属性筛选：含有目标属性的宝可梦都筛出来（单属性/双属性均可命中）
  if (_typeFilter) pool = pool.filter(p => {
    const poke = getPokemonByIndex(String(p.species));
    return poke?.types?.includes(_typeFilter);
  });
  // 搜索
  if (q) pool = pool.filter(p => matchesQuery(p, q));
  // 选取模式：排除已在队伍/训练中的个体
  if (_picker?.exclude?.length) {
    const ex = new Set(_picker.exclude);
    pool = pool.filter(p => !ex.has(p.id));
  }
  // 选取模式（配队/训练）：蛋不可作为宝可梦使用（M3 全站过滤）
  if (_picker) pool = pool.filter(p => isPokemon(p));
  // 进度显示（与图鉴顶部统计一致的样式）
  const prog = $('rosterProgress');
  if (prog) {
    if (_picker) {
      prog.textContent = _picker.mode === 'team'
        ? `选择加入队伍 · 共 ${pool.length} 只`
        : _picker.mode === 'train'
          ? `选择放入训练 · 共 ${pool.length} 只`
          : `选择放入饲育屋 · 共 ${pool.length} 只`;
    } else {
      const total = inRoster().length;
      const shinyCount = inRoster().filter(p => p.shiny).length;
      prog.textContent = q || _filter || _typeFilter
        ? `共 ${total} 只 · 匹配 ${pool.length} 只`
        : `共 ${total} 只 · 闪光 ${shinyCount} 只`;
    }
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
    } else if (_sortBy === 'level') {
      va = a.level || 1; vb = b.level || 1;
    } else {
      va = a.obtainedAt; vb = b.obtainedAt;
    }
    if (typeof va === 'string') return va.localeCompare(vb) * _sortDir;
    return (va - vb) * _sortDir;
  });
  // 渲染行（复用图鉴 .pokedex-entry 样式）
  list.innerHTML = sorted.length === 0
    ? `<div class="roster-empty">${_picker ? '没有可选择的宝可梦' : '仓库空空如也，去捕获一些宝可梦吧'}</div>`
    : sorted.map(p => {
        const sel = _batchRelease && _batchSelected.has(p.id);
        return rowHtml(p).replace('<div class="pokedex-entry roster-row"', 
          `<div class="pokedex-entry roster-row${sel ? ' roster-batch-sel' : ''}"`);
      }).join('');
  // 加载个体图标
  list.querySelectorAll('.roster-icon-img').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
  // 点击行：选取模式直接加入目标；批量模式切换选中；否则进详情
  list.onclick = (e) => {
    const row = e.target.closest('.roster-row');
    if (!row) return;
    if (_picker) { e.stopPropagation(); pickRow(row.dataset.rid); return; }
    if (_batchRelease) {
      toggleBatchRow(row);
      return;
    }
    _detailFromView = null;
    showRosterDetail(row.dataset.rid);
  };
  // 批量模式底部栏
  if (_batchRelease) updateBatchBar();
  // 右键菜单
  list.oncontextmenu = (e) => {
    e.preventDefault();
    if (_batchRelease) { cancelBatchRelease(); return; }
    showContextMenu(e.clientX, e.clientY);
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
  const gSpan = genderBadge(ensureGender(p));
  const icon = poke?.icon ? `<img class="roster-icon-img" data-icon="${p.species}" alt="" />` : '';
  return `
    <div class="pokedex-entry roster-row" data-rid="${p.id}">
      <span class="roster-icon">${icon}</span>
      <span class="pokedex-star">${p.shiny ? '★' : ''}</span>
      <span class="pokedex-idx">#${p.species}</span>
      <span class="pokedex-name">${rosterName(p)}</span>
      <span class="roster-lv-col">${gSpan}Lv${p.level || 1}</span>
      <span class="roster-iv">${ivSum(p)}</span>
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

// 属性筛选下拉（含目标属性的宝可梦都筛出来）：选项带属性色圆点，选中后标签同步显示属性
function setupTypeFilter() {
  const trigger = $('rosterTypeFilter');
  const label = $('rosterTypeFilterLabel');
  const dd = $('rosterTypeFilterDropdown');
  if (!trigger || !label || !dd) return;
  const typeList = Object.keys(TYPE_COLORS); // 18 属性
  function typeOption(t) {
    return `<div class="region-dropdown-item${t === _typeFilter ? ' active' : ''}" data-type="${t}">
      <span class="roster-type-dot" style="background:${TYPE_COLORS[t]}"></span>${t}
    </div>`;
  }
  function buildOptions() {
    dd.innerHTML = `<div class="region-dropdown-item${!_typeFilter ? ' active' : ''}" data-type="">全部</div>`
      + typeList.map(typeOption).join('');
    dd.querySelectorAll('.region-dropdown-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        _typeFilter = el.dataset.type || '';
        if (_typeFilter) {
          label.innerHTML = `<span class="roster-type-dot" style="background:${TYPE_COLORS[_typeFilter]}"></span>${_typeFilter}`;
        } else {
          label.textContent = '属性';
        }
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

// ---------- 配招 ----------
let _moveData = null;   // moves.json（id2name + moves 详情）
let _learnset = null;   // learnset.json（{ lv:[[等级,招式id]...], tm:[], egg:[] }）
let _moveEditId = null; // 当前手动配招的个体 id（非空=处于配招独立页）
let _moveSel = null;    // 配招页当前选中的候选招式 id
let _moveSort = 'default'; // 候选列表排序：default 学习等级 / type 属性 / cat 类别（右键菜单切换）

async function ensureMoveData() {
  if (_moveData && _learnset) return;
  const [d, l] = await Promise.all([
    fetch('./pokemon-data/moves.json').then((r) => r.json()),
    fetch('./pokemon-data/learnset.json').then((r) => r.json()),
  ]);
  _moveData = d;
  _learnset = l;
}

// 当前实际招式：已手动配过（p.moves）则直接使用（保留空位），否则按自动配招计算
function currentMoveIds(p) {
  if (Array.isArray(p.moves) && p.moves.length) {
    return [0, 1, 2, 3].map((i) => {
      const id = p.moves[i];
      return id != null && _moveData.moves[id] && _moveData.moves[id].effect.kind !== 'unimplemented' ? id : null;
    });
  }
  const pd = getPokemonByIndex(String(p.species));
  return chooseMoves(_learnset[p.species], p.level || 1, _moveData, { types: pd ? pd.types : [], includeTm: true });
}

// 可学习候选：升级习得（≤当前等级）+ 蛋招式 + 招式机，过滤未实现招式，按学习等级升序（TM 排最后）
function candidateMoves(p) {
  const ls = _learnset[p.species] || { lv: [], tm: [], egg: [] };
  const out = [];
  for (const [lv, m] of ls.lv || []) {
    if (lv <= (p.level || 1)) out.push({ id: m, lv, egg: false });
  }
  for (const m of ls.egg || []) out.push({ id: m, lv: null, egg: true });
  for (const m of ls.tm || []) out.push({ id: m, lv: null, tm: true });
  const seen = new Set();
  const res = [];
  for (const c of out) {
    if (seen.has(c.id)) continue;
    const mv = _moveData.moves[c.id];
    if (!mv || mv.effect.kind === 'unimplemented') continue;
    seen.add(c.id);
    res.push(c);
  }
  // 学不到任何已实现招式（如百变怪只有变身、图图犬只有写生且均未实装）：
  // 候选列表补通用兜底攻击招，保证配招页有招可选、移除后可恢复
  if (res.length === 0) {
    for (const id of fallbackMoves(_moveData)) {
      if (seen.has(id)) continue;
      seen.add(id);
      res.push({ id, lv: null, egg: false });
    }
  }
  res.sort((a, b) => (a.lv ?? (a.tm ? 9999 : 999)) - (b.lv ?? (b.tm ? 9999 : 999)));
  return res;
}

function movesBlockHtml(p) {
  const ids = currentMoveIds(p);
  const slots = [0, 1, 2, 3].map((i) => {
    const mv = ids[i] ? _moveData.moves[ids[i]] : null;
    return `<div class="roster-move-slot${mv ? '' : ' empty'}" data-move="${mv ? ids[i] : ''}">
      ${mv
        ? `<span class="b-move-type" style="background:${TYPE_COLORS[mv.type] || '#888'}">
             <svg class="b-move-type-icon"><use xlink:href="./icons/sprites.svg#icon-type-${mv.type}"></use></svg>
           </span>
           <span class="roster-move-slot-name">${mv.name}</span>`
        : `<span class="roster-move-slot-name slot-empty">空</span>`}
    </div>`;
  }).join('');
  return `
    <div class="roster-move-title-row">
      <div class="roster-detail-title">招式 <span style="opacity:0.6;">${ids.filter(m => m != null).length}/4</span></div>
      <div class="roster-move-tools">
        <button class="roster-release roster-auto-btn" id="rosterAutoSet">自动配招</button>
        <button class="roster-release roster-auto-btn" id="rosterManualSet">手动配招</button>
      </div>
    </div>
    <div class="roster-moves-grid">
      ${slots}
    </div>`;
}

function renderMovesBlock(id) {
  const p = (gameData.roster || []).find((r) => r.id === id);
  const box = $('rosterMovesBox');
  if (!p || !box) return;
  box.innerHTML = movesBlockHtml(p);
  bindMovesBlock(id);
}

function bindMovesBlock(id) {
  const box = $('rosterMovesBox');
  if (!box) return;
  const p = (gameData.roster || []).find((r) => r.id === id);
  if (!p) return;
  box.querySelector('#rosterAutoSet')?.addEventListener('click', () => {
    const pd = getPokemonByIndex(String(p.species));
    p.moves = chooseMoves(_learnset[p.species], p.level || 1, _moveData, { types: pd ? pd.types : [], includeTm: true });
    saveGame();
    renderMovesBlock(id);
  });
  box.querySelector('#rosterManualSet')?.addEventListener('click', () => {
    openMoveEditor(id);
  });
  // 点击具体招式槽 → 跳转配招页并选中该招式
  box.querySelectorAll('.roster-move-slot').forEach((el) => {
    el.addEventListener('click', () => {
      const mid = parseInt(el.dataset.move, 10);
      if (mid) openMoveEditor(id, mid);
    });
  });
}

// ---------- 手动配招独立页 ----------
const MOVE_STATUS_CN = { sleep: '睡眠', poison: '中毒', paralysis: '麻痹', burn: '灼伤', confusion: '混乱', flinch: '畏缩', freeze: '冰冻' };

// 招式类别 → 图标文件与中文名（物理/特殊/变化；伤害类招式按 effect.cat 归类）
const MOVE_CAT_ICON = { phys: 'physical.png', spec: 'special.png', status: 'status.png' };
const MOVE_CAT_CN = { phys: '物理', spec: '特殊', status: '变化' };
function moveCat(mv) {
  const ef = mv.effect || {};
  if (ef.kind === 'damage' || ef.kind === 'multihit' || ef.kind === 'drain' || ef.kind === 'recoil' || ef.kind === 'fixed' || ef.kind === 'counter') {
    return ef.cat === 'spec' ? 'spec' : 'phys';
  }
  return 'status';
}
function catIconHtml(mv) {
  const c = moveCat(mv);
  return `<span class="move-cat-icon"><img src="./icons/${MOVE_CAT_ICON[c]}" alt="${MOVE_CAT_CN[c]}" data-tip="${MOVE_CAT_CN[c]}"></span>`;
}

// 按 effect.kind 生成招式描述
function moveDesc(mv) {
  const ef = mv.effect || {};
  switch (ef.kind) {
    case 'damage': {
      let d = '对目标造成伤害。';
      if (ef.stat) {
        const parts = (ef.stat.stats || []).map((s) => `${s.stat}${s.delta > 0 ? '+' : ''}${s.delta}`);
        const chance = ef.stat.chance ?? 100;
        const who = ef.stat.target === 'self' ? '使用者' : '目标';
        d += `使${who}${parts.join('、')}${chance < 100 ? `（几率 ${chance}%）` : ''}。`;
      }
      if (ef.attach) {
        const sts = ef.attach.statuses || [ef.attach.status];
        const stTxt = sts.map((s) => MOVE_STATUS_CN[s] || s).join('、');
        d += `有 ${ef.attach.chance ?? 100}% 几率使目标${stTxt}。`;
      }
      return d;
    }
    case 'multihit': return `连续攻击 ${ef.hits?.[0]}~${ef.hits?.[1]} 次。`;
    case 'status': return `使对手陷入「${MOVE_STATUS_CN[ef.status] || ef.status}」状态。`;
    case 'stat': {
      const parts = (ef.stats || []).map((s) => `${s.stat}${s.delta > 0 ? '+' : ''}${s.delta}`);
      return `${ef.target === 'self' ? '提升自身' : '降低对手'} ${parts.join('、')}。`;
    }
    case 'drain': return `造成伤害，并回复造成伤害${ef.ratio ? Math.round(ef.ratio * 100) + '%' : ''}的HP。`;
    case 'recoil': return `造成伤害，但自身也会承受${Math.round((ef.ratio || 0.25) * 100)}%的反噬伤害。`;
    case 'fixed': return '无视对手防御，造成固定伤害。';
    case 'counter': return '本回合受到物理攻击后使用，可将该伤害翻倍返还给对手。';
    case 'heal': return `回复最大HP的${Math.round((ef.ratio || 0.5) * 100)}%。`;
    case 'sleepRest': return '回复全部HP，同时陷入睡眠状态。';
    case 'cure': return '治愈全队的异常状态。';
    case 'protect': return '本回合免疫所有招式造成的伤害，但连续使用容易失败。';
    case 'endure': return '本回合受到致命伤害时，保留至少 1 点 HP。';
    case 'leechSeed': return '在对手脚下种下寄生种子，每回合吸取其 HP 回复自己。对草系无效。';
    case 'substitute': return '消耗 1/4 最大 HP 制造替身，替身替自己承受伤害。';
    case 'unimplemented': return ef.note || '该招式暂未实装。';
    default: return ef.note || ''; // 其余已实现机制（场地/天气/吹飞/接棒等）直接展示官方描述
  }
}

// 把选中的招式装入指定槽位（已在其它槽则顺移，保留空位）
function assignMove(p, moveId, slot) {
  const cur = currentMoveIds(p); // 手动配过则基于 p.moves，否则基于自动配招（避免首次操作清空自动配招）
  const arr = [0, 1, 2, 3].map((i) => cur[i] ?? null);
  if (arr[slot] === moveId) return;
  const oldIdx = arr.indexOf(moveId);
  if (oldIdx >= 0) arr[oldIdx] = null;
  arr[slot] = moveId;
  p.moves = arr;
}

export function isRosterInMoveEdit() {
  return _moveEditId != null;
}

export function openMoveEditor(id, moveId) {
  _moveEditId = id;
  _moveSel = moveId ?? null; // 从详情页招式槽跳入时选中该招式（在候选列表高亮并显示详情）
  _moveSort = 'default';     // 每次进入恢复默认排序
  renderMoveEditor();
  showView('moveEditView');
}

// 返回：刷新详情页配招块后回到个体详情
export function leaveMoveEditor() {
  const id = _moveEditId;
  _moveEditId = null;
  _moveSel = null;
  if (id != null) {
    renderMovesBlock(id);
    showView('rosterView');
  }
}

// ---------- 配招页拖拽：候选招式拖入槽位（鼠标）/ 槽位间交换（鼠标+触摸） ----------
// 与配招页原有点击逻辑并存：拖过（移动>6px）才走拖拽并吞掉收尾 click，纯点击仍按原逻辑
let _meDrag = null;       // { kind:'row'|'slot', slot, moveId, name, type }
let _meDragTarget = -1;   // 悬停目标槽位
let _meSuppress = false;  // 拖拽收尾抑制 click

function meDragGhost() {
  return $('moveEditView')?.querySelector('.move-edit-drag-ghost');
}
function meClearTarget() {
  $('moveEditView')?.querySelector(`.move-edit-slot[data-slot="${_meDragTarget}"]`)?.classList.remove('drag-over');
  _meDragTarget = -1;
}
function meMoveGhost(e) {
  const g = meDragGhost();
  if (!g) return;
  const r = $('moveEditView').getBoundingClientRect();
  g.style.left = (e.clientX - r.left) + 'px';
  g.style.top = (e.clientY - r.top) + 'px';
}

function bindMoveEditDrag(box) {
  const p = (gameData.roster || []).find((r) => r.id === _moveEditId);
  if (!p) return;
  let startX = 0, startY = 0, moved = false;
  function begin(e, src, info) {
    startX = e.clientX; startY = e.clientY; moved = false;
    _meDrag = info;
    _meDragTarget = -1;
    src.setPointerCapture(e.pointerId);
    src.classList.add('dragging');
    const g = document.createElement('div');
    g.className = 'move-edit-drag-ghost';
    if (info.type) {
      const t = document.createElement('span');
      t.className = 'b-move-type';
      t.style.background = TYPE_COLORS[info.type] || '#888';
      t.innerHTML = `<svg class="b-move-type-icon"><use xlink:href="./icons/sprites.svg#icon-type-${info.type}"></use></svg>`;
      g.appendChild(t);
    }
    const n = document.createElement('span');
    n.className = 'move-edit-ghost-name';
    n.textContent = info.name;
    g.appendChild(n);
    $('moveEditView').appendChild(g);
    meMoveGhost(e);
  }
  function onMove(e) {
    if (!_meDrag) return;
    if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) moved = true;
    meMoveGhost(e);
    // 命中检测：指针下最近的招式槽（幽灵 pointer-events:none 不影响）
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.move-edit-slot[data-slot]');
    const t = el ? parseInt(el.dataset.slot, 10) : -1;
    if (t !== _meDragTarget) {
      meClearTarget();
      if (t >= 0 && !(_meDrag.kind === 'slot' && t === _meDrag.slot)) {
        _meDragTarget = t;
        el.classList.add('drag-over');
      }
    }
  }
  function end() {
    if (!_meDrag) return;
    const d = _meDrag;
    const to = _meDragTarget;
    _meDrag = null;
    meClearTarget();
    meDragGhost()?.remove();
    box.querySelector('.dragging')?.classList.remove('dragging');
    if (moved) { _meSuppress = true; setTimeout(() => { _meSuppress = false; }, 0); } // 拖过就吞掉收尾 click
    if (to < 0) return;
    if (d.kind === 'row') {
      // 候选招式拖入槽位：已在其它槽则顺移过来（assignMove 会清掉旧位置）
      assignMove(p, d.moveId, to);
      saveGame();
      renderMoveEditor();
    } else {
      // 槽位间交换（目标为空槽 = 移过去）
      const ids = currentMoveIds(p);
      const arr = [0, 1, 2, 3].map((i) => ids[i] ?? null);
      const a = d.slot, b = to;
      const tmp = arr[a]; arr[a] = arr[b]; arr[b] = tmp;
      p.moves = arr;
      saveGame();
      renderMoveEditor();
    }
  }
  // 已装招式槽 → 拖到另一槽交换/移动：鼠标/触摸都支持（槽位区不可滚动，touch-action:none 已放开拖拽）
  box.querySelectorAll('.move-edit-slot[data-slot]').forEach((slot) => {
    const slotIdx = parseInt(slot.dataset.slot, 10);
    const mid = currentMoveIds(p)[slotIdx];
    if (mid == null) return; // 空槽不能作为拖拽源
    const mv = _moveData.moves[mid];
    slot.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return; // 右键不拖
      if (e.target.closest('.move-edit-slot-x')) return; // 叉号不拖
      e.preventDefault();
      begin(e, slot, { kind: 'slot', slot: slotIdx, name: mv?.name || '', type: mv?.type || '' });
    });
    slot.addEventListener('pointermove', onMove);
    slot.addEventListener('pointerup', end);
    slot.addEventListener('pointercancel', end);
  });
  // 候选招式行 → 拖入槽位装招：仅鼠标（触摸用于滚动候选列表，装招仍走"点击选中→点空槽装入"）
  box.querySelectorAll('.move-edit-row').forEach((row) => {
    const moveId = parseInt(row.dataset.move, 10);
    const mv = _moveData.moves[moveId];
    row.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 2) return;
      e.preventDefault();
      begin(e, row, { kind: 'row', slot: -1, moveId, name: mv?.name || '', type: mv?.type || '' });
    });
    row.addEventListener('pointermove', onMove);
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
  });
}

// 候选列表排序：default 保持学习等级升序（TM 最后）/ type 按属性 / cat 按物理·特殊·变化 / power 按威力降序
const CAT_SORT_ORDER = { phys: 0, spec: 1, status: 2 };
function sortMoveCands(cands) {
  const list = cands.slice();
  if (_moveSort === 'type') {
    const order = new Map(Object.keys(TYPE_COLORS).map((t, i) => [t, i]));
    list.sort((a, b) => {
      const ta = order.get(_moveData.moves[a.id]?.type) ?? 99;
      const tb = order.get(_moveData.moves[b.id]?.type) ?? 99;
      return ta - tb || (a.lv ?? 999) - (b.lv ?? 999);
    });
  } else if (_moveSort === 'cat') {
    list.sort((a, b) => {
      const ca = CAT_SORT_ORDER[moveCat(_moveData.moves[a.id])] ?? 9;
      const cb = CAT_SORT_ORDER[moveCat(_moveData.moves[b.id])] ?? 9;
      return ca - cb || (a.lv ?? 999) - (b.lv ?? 999);
    });
  } else if (_moveSort === 'power') {
    // 威力降序；变化/回复类无威力视为 0 排最后，同威力按学习等级升序
    list.sort((a, b) => {
      const pa = _moveData.moves[a.id]?.power ?? 0;
      const pb = _moveData.moves[b.id]?.power ?? 0;
      return (pb - pa) || (a.lv ?? 999) - (b.lv ?? 999);
    });
  }
  return list;
}

// 候选列表右键排序菜单（样式复用商店批量购买菜单）
const MOVE_SORT_OPTIONS = [
  { key: 'default', label: '默认排序' },
  { key: 'type', label: '按属性排序' },
  { key: 'cat', label: '按类别排序' },
  { key: 'power', label: '按威力排序' },
];
function showMoveSortMenu(x, y) {
  hideMoveSortMenu();
  let menu = $('moveSortCtxMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'moveSortCtxMenu';
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = MOVE_SORT_OPTIONS.map((o) =>
    `<div class="shop-ctx-item${_moveSort === o.key ? ' sel' : ''}" data-sort="${o.key}"><span class="shop-ctx-qty">${o.label}</span></div>`
  ).join('');
  menu.style.display = '';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(0, Math.min(x - 24, window.innerWidth - mw - 4)) + 'px';
  menu.style.top = Math.max(0, Math.min(y, window.innerHeight - mh - 4)) + 'px';
  // 菜单内点击不触发外部关闭；点击外部任意位置关闭
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.onclick = (e) => {
    const opt = e.target.closest('.shop-ctx-item');
    if (!opt) return;
    hideMoveSortMenu();
    _moveSort = opt.dataset.sort;
    renderMoveEditor();
  };
  document.addEventListener('pointerdown', hideMoveSortMenu);
}
function hideMoveSortMenu() {
  const menu = $('moveSortCtxMenu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('pointerdown', hideMoveSortMenu);
}

export function renderMoveEditor() {
  const p = (gameData.roster || []).find((r) => r.id === _moveEditId);
  const box = $('moveEditContent');
  if (!p || !box) return;
  // innerHTML 重建会重置候选列表滚动位置：先记住再还原，避免点选招式后列表跳回顶部
  const prevScroll = box.querySelector('.move-edit-list')?.scrollTop || 0;
  const ids = currentMoveIds(p); // 已配招（固定 4 格，空位为 null）
  const cands = sortMoveCands(candidateMoves(p));
  box.innerHTML = `
    <div class="move-edit-slots">
      ${Array.from({ length: 4 }, (_, i) => {
        const mv = ids[i] ? _moveData.moves[ids[i]] : null;
        return `<div class="move-edit-slot${mv ? '' : ' empty'}" data-slot="${i}"${mv ? '' : ' title="点击装入选中的招式"'}>
          ${mv
            ? `<span class="b-move-type" style="background:${TYPE_COLORS[mv.type] || '#888'}">
                 <svg class="b-move-type-icon"><use xlink:href="./icons/sprites.svg#icon-type-${mv.type}"></use></svg>
               </span>
               <span class="move-edit-slot-name">${mv.name}</span>
               <button class="move-edit-slot-x" data-slot="${i}" title="移出该招式">
                 <svg viewBox="0 0 1024 1024"><use xlink:href="./icons/sprites.svg#icon-close"></use></svg>
               </button>`
            : `<span class="move-edit-slot-name slot-empty">空</span>`}
        </div>`;
      }).join('')}
    </div>
    <div class="move-edit-main">
      <div class="move-edit-list">
        ${cands.map((c) => {
          const mv = _moveData.moves[c.id];
          const active = ids.includes(c.id);
          const sel = c.id === _moveSel;
          return `<button class="move-edit-row${active ? ' active' : ''}${sel ? ' sel' : ''}" data-move="${c.id}">
            <span class="b-move-type" style="background:${TYPE_COLORS[mv.type] || '#888'}">
              <svg class="b-move-type-icon"><use xlink:href="./icons/sprites.svg#icon-type-${mv.type}"></use></svg>
            </span>
            <span class="move-edit-row-name">${mv.name}</span>
            <span class="move-edit-row-lv">${c.tm ? '招式机' : c.egg ? '蛋招式' : c.lv ? `Lv${c.lv}` : ''}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="move-edit-detail">${renderMoveDetail(p, ids)}</div>
    </div>`;
  // 还原候选列表滚动位置（内容重建后 scrollTop 已被清 0）
  const listEl = box.querySelector('.move-edit-list');
  if (listEl && prevScroll > 0) listEl.scrollTop = prevScroll;
  // 右键候选列表 → 弹出排序菜单（默认 / 属性 / 类别）
  listEl?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMoveSortMenu(e.clientX, e.clientY);
  });
  // 点击候选行 → 仅查看详情，不自动配招
  box.querySelectorAll('.move-edit-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (_meSuppress) return; // 刚拖拽结束，本次点击只算收尾
      _moveSel = parseInt(btn.dataset.move, 10);
      renderMoveEditor();
    });
  });
  // 槽位叉号 → 清空该槽（保留位置）；点击槽位 → 已有招式查看详情 / 空槽装入选中招式
  box.querySelectorAll('.move-edit-slot-x').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = parseInt(btn.dataset.slot, 10);
      const cur = currentMoveIds(p); // 首次进入（p.moves 未初始化）时基于自动配招，避免叉一下清空全部
      const arr = [0, 1, 2, 3].map((i) => cur[i] ?? null);
      arr[slot] = null;
      p.moves = arr;
      // 仅当被移出的招式恰是当前选中项时清空选中；否则保留选中，方便移除后直接点空槽装入
      if ((cur[slot] ?? null) === _moveSel) _moveSel = null;
      saveGame();
      renderMoveEditor();
    });
  });
  box.querySelectorAll('.move-edit-slot').forEach((el) => {
    el.addEventListener('click', () => {
      if (_meSuppress) return; // 刚拖拽结束，本次点击只算收尾
      const slot = parseInt(el.dataset.slot, 10);
      const mid = ids[slot];
      if (mid != null) {
        _moveSel = mid;
      } else if (_moveSel != null) {
        assignMove(p, _moveSel, slot);
        saveGame();
      }
      renderMoveEditor();
    });
  });
  bindMoveEditDrag(box);
}

function renderMoveDetail(p, ids) {
  const mv = _moveSel != null ? _moveData.moves[_moveSel] : null;
  if (!mv) {
    return `<div class="move-edit-detail-empty">从左侧选择招式查看</div>`;
  }
  return `
    <div class="move-edit-detail-head">
      <span class="b-move-type big" style="background:${TYPE_COLORS[mv.type] || '#888'}">
        <svg class="b-move-type-icon"><use xlink:href="./icons/sprites.svg#icon-type-${mv.type}"></use></svg>
      </span>
      <div class="move-edit-detail-name">${mv.name}</div>
    </div>
    <div class="move-edit-detail-stats">
      <div><span>类别</span><b>${catIconHtml(mv)}</b></div>
      <div><span>威力</span><b>${mv.power ?? '—'}</b></div>
      <div><span>命中</span><b>${mv.accuracy ?? '—'}</b></div>
    </div>
    <div class="move-edit-detail-desc">${moveDesc(mv)}</div>`;
}

// 详情页数据就绪后渲染配招块（异步加载招式数据，避免阻塞详情首帧）
async function loadMovesBlock(id) {
  await ensureMoveData();
  if (_detailId !== id) return; // 已切走则放弃
  renderMovesBlock(id);
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
  const dGSpan = genderBadge(ensureGender(p));
  const lastLog = latestLogLine(String(p.species));
  const list = $('rosterList');
  if (!list) return;
  list.innerHTML = `
    <div style="font-size:13px;font-weight:700;padding:4px 5px 2px;display:flex;align-items:center;justify-content:space-between;">
      <span><span id="rosterNickSpan">${rosterName(p)}</span><button class="roster-nick-btn" id="rosterNickBtn" title="改名"><svg t="1786243847045" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="13" height="13"><path d="M138.666667 810.666667V213.333333c0-41.216 33.450667-74.666667 74.666666-74.666666h469.333334v64H213.333333a10.666667 10.666667 0 0 0-10.666666 10.666666v597.333334c0 5.888 4.778667 10.666667 10.666666 10.666666h597.333334a10.666667 10.666667 0 0 0 10.666666-10.666666V352h64V810.666667A74.666667 74.666667 0 0 1 810.666667 885.333333H213.333333A74.666667 74.666667 0 0 1 138.666667 810.666667z" fill="currentColor"></path><path d="M444.330667 540.032L856.362667 128l45.226666 45.226667-411.989333 412.032-45.226667-45.226667z" fill="currentColor"></path></svg></button><span class="roster-detail-lv">${dGSpan}Lv${p.level || 1}</span>${p.shiny ? ' <svg class="roster-shiny" viewBox="0 0 1024 1024" width="14" height="14" style="flex-shrink:0;vertical-align:-2px;transform:translateY(-2px);"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>' : ''}</span>
      <div style="display:flex;flex-direction:row;align-items:flex-end;gap:2px;flex-shrink:0;">
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
        <div style="font-size:10px;opacity:0.7;line-height:1.6;">
          <div style="display:flex;flex-wrap:wrap;column-gap:8px;">性格：${natureText(p.nature)}<span>来源：${srcName(p.source)}</span></div>
          <div style="display:flex;flex-wrap:wrap;column-gap:8px;">获得时间：${fmtTime(p.obtainedAt)}${lastLog ? `<span>${lastLog}</span>` : ''}</div>
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
    <div class="roster-detail-block roster-moves-block" id="rosterMovesBox"></div>
  `;
  const img = $('rosterDetailImg');
  if (img && poke) {
    // 等图片加载完成再启动粒子，否则 burst 时图片尺寸为 0 会定位到页面中心
    tryLoadPokemonImage(img, poke, p.shiny ? '_shiny' : '').then(() => {
      // 闪光个体：图片周围循环播放星星粒子（详情页图小 → 粒子缩小、飞行更近）
      if (p.shiny && _detailId === id) startShinySparkleOn($('rosterView'), img, { cls: 'sm', scale: 0.6 });
    });
  }
  // 改名按钮
  const nickBtn = $('rosterNickBtn');
  if (nickBtn) {
    nickBtn.addEventListener('click', () => {
      const nickSpan = $('rosterNickSpan');
      if (!nickSpan) return;
      const orig = p.nickname || '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = orig;
      input.maxLength = 5;
      input.className = 'roster-nick-input';
      nickSpan.replaceWith(input);
      input.focus();
      input.select();
      const save = () => {
        const v = input.value.trim();
        if (v && v !== poke.name) p.nickname = v;
        else delete p.nickname;
        saveGame();
      };
      input.addEventListener('blur', () => { save(); showRosterDetail(id); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { save(); showRosterDetail(id); }
        else if (e.key === 'Escape') { showRosterDetail(id); }
      });
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
  loadMovesBlock(id);
}

// 放生：确认后移除个体、播告别动画，结束后返回列表
let _releasing = false; // 场景播放中防重复触发

// 批量放生
let _batchRelease = false;
let _batchSelected = new Set();

function showContextMenu(x, y) {
  let menu = document.getElementById('rosterCtxMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'rosterCtxMenu';
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = `<div class="shop-ctx-item" data-action="batchRelease">批量放生</div>`;
  menu.style.left = Math.min(x, window.innerWidth - 120) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 50) + 'px';
  menu.style.display = 'block';
  menu.onclick = (e) => {
    const act = e.target.closest('[data-action]')?.dataset.action;
    hideContextMenu();
    if (act === 'batchRelease') startBatchRelease();
  };
  setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 0);
}

function hideContextMenu() {
  const menu = document.getElementById('rosterCtxMenu');
  if (menu) menu.style.display = 'none';
}

function startBatchRelease() {
  _batchRelease = true;
  _batchSelected = new Set();
  renderList();
}

function cancelBatchRelease() {
  _batchRelease = false;
  _batchSelected = new Set();
  removeBatchBar();
  renderList();
}

function toggleBatchRow(row) {
  const id = row.dataset.rid;
  if (_batchSelected.has(id)) { _batchSelected.delete(id); row.classList.remove('roster-batch-sel'); }
  else { _batchSelected.add(id); row.classList.add('roster-batch-sel'); }
  updateBatchBar();
}

function updateBatchBar() {
  const n = _batchSelected.size;
  let bar = document.getElementById('rosterBatchBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'rosterBatchBar';
    bar.className = 'text-box';
    bar.style.height = '32px';
    const view = document.getElementById('rosterView');
    if (view) view.appendChild(bar);
  }
  bar.innerHTML = n > 0
    ? `<span class="text-box-content">已选中 ${n} 只，确定放生？</span><span class="roster-batch-btn" id="rosterBatchConfirm">确定</span>`
    : `<span class="text-box-content">请点击列表项选择要放生的宝可梦</span>`;
  bar.style.display = 'flex';
  const btn = bar.querySelector('#rosterBatchConfirm');
  if (btn) btn.onclick = doBatchRelease;
}

function removeBatchBar() {
  const bar = document.getElementById('rosterBatchBar');
  if (bar) bar.style.display = 'none';
}

function doBatchRelease() {
  if (_batchSelected.size === 0) return;
  const arr = gameData.roster || [];
  const names = [];
  const toRemove = new Set([..._batchSelected]);
  for (let i = arr.length - 1; i >= 0; i--) {
    if (toRemove.has(arr[i].id)) {
      names.push(rosterName(arr[i]));
      arr.splice(i, 1);
    }
  }
  addSystemLog(`批量放生了 ${names.length} 只宝可梦`);
  saveGame();
  const n = names.length;
  _batchRelease = false;
  _batchSelected = new Set();
  // 显示结果
  const bar = document.getElementById('rosterBatchBar');
  if (bar) {
    bar.innerHTML = `<span class="text-box-content">已放生 ${n} 只宝可梦</span>`;
    bar.style.display = 'flex';
    setTimeout(() => {
      removeBatchBar();
      renderList();
    }, 1500);
  } else {
    renderList();
  }
}
function releasePokemon(id) {
  const p = (gameData.roster || []).find(r => r.id === id);
  if (!p || _releasing) return;
  _releasing = true;
  const poke = getPokemonByIndex(String(p.species));
  showGoodbyeConfirm({
    poke,
    nick: p.nickname || '',
    prompt: '确定要放生吗？',
    shiny: !!p.shiny,
    onConfirm: () => {
      const arr = gameData.roster || [];
      const ri = arr.findIndex(r => r.id === id);
      if (ri >= 0) {
        arr.splice(ri, 1);
        // 若该个体正放在饲育屋繁育：同步清出亲本槽并终止繁殖（否则场地贴图/配对预览残留）
        import('./nursery.js').then(m => m.removeNurseryByPokemon(id));
      }
      stopShinySparkleLoop();
      _releasing = false;
      addSystemLog('pokemon_release', { pokemon: p.species, shiny: !!p.shiny });
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
  resetNav(); // 直接回来源页/挂机页，清空导航栈（等价于原先"返回回挂机页"）
}

// ---------- 页面入口 ----------
let _uiBound = false; // 搜索/筛选/表头事件只需初始化一次

// ---------- 选取模式（配队/训练） ----------
// 配队/训练页点击空位跳转仓库列表，点击列表项直接把该宝可梦加入目标

export function isRosterPicking() {
  return _picker != null;
}

// 进入选取模式；picker.from 为返回目标视图（teamView / trainView）
export function showRosterPicker(picker) {
  _picker = picker || null;
  _detailFromView = null;
  showRosterView(true); // 选取模式不压栈：返回由配队/训练页的返回链处理
}

// 返回按钮：离开选取模式并恢复来源页（配队/训练重新渲染）
export function leaveRosterPicker() {
  const p = _picker;
  _picker = null;
  if (p?.mode === 'team') import('./team.js').then(m => m.restoreTeamView());
  else if (p?.mode === 'train') import('./train.js').then(m => m.showTrainView());
  else if (p?.mode === 'nursery') import('./nursery.js').then(m => m.showNurseryView());
  else showView(p?.from || 'idleView');
}

// 点击列表项：直接加入目标（配队/训练）并返回来源页
function pickRow(rid) {
  const p = _picker;
  _picker = null;
  if (!p) return;
  if (p.mode === 'team') import('./team.js').then(m => m.addToTeam(rid, p.slot));
  else if (p.mode === 'train') import('./train.js').then(m => m.addToTraining(rid, p.slot));
  else if (p.mode === 'nursery') import('./nursery.js').then(m => m.addToNursery(rid, p.slot));
}

export function showRosterView(noNav) {
  // 正常入口压栈（返回回来源页）；选取/子流程模式传 true 跳过，避免污染导航栈
  if (!noNav) pushNav('rosterView');
  if (!_uiBound) {
    setupSearch();
    setupFilter();
    setupTypeFilter();
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
