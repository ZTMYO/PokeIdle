import { $, showView, tryLoadImage, showConfirmBar } from './ui.js';
import { gameData, getPokemonByIndex, saveGame, pushNav, ensureGender, genderBadge, isPokemon } from './state.js';
import { matchPinyinPartial } from './pokedex.js';
import { TYPE_COLORS, pokemonSourceBadge } from './items.js';
import { REGION_CYCLE } from './config.js';
import { setupSourceFilter, closeAllDropdowns, sourceFilterLabel } from './filters.js';

export const TEAM_MAX = 6;

// 升级经验需求（与对战结算一致）
const expNeed = (lv) => 25 + lv * 20;

export function teamIds() {
  return Array.isArray(gameData.team) ? gameData.team : [];
}

// ---------- 6 组配队数据 ----------
// 存档结构：teams = [{ name, ids }] ×6，activeTeam 为当前上场队伍下标；
// gameData.team 始终保持 = teams[activeTeam].ids 的引用（战斗/训练/饲育屋直接读它，切队只换引用）。

// 老存档迁移：无 teams 字段时把旧 team 数组迁入队伍 1，并建立镜像引用
export function migrateTeams() {
  if (!gameData) return;
  if (!Array.isArray(gameData.teams)) {
    const old = Array.isArray(gameData.team) ? gameData.team : [];
    gameData.teams = Array.from({ length: 6 }, (_, i) => ({ name: `队伍${i + 1}`, ids: [] }));
    gameData.teams[0].ids = old;
    gameData.activeTeam = 0;
  } else {
    gameData.teams = gameData.teams.map((t, i) => ({
      name: (t && t.name) || `队伍${i + 1}`,
      ids: (t && Array.isArray(t.ids)) ? t.ids : [],
    }));
    if (gameData.activeTeam == null) gameData.activeTeam = 0;
    if (gameData.activeTeam < 0 || gameData.activeTeam >= gameData.teams.length) gameData.activeTeam = 0;
  }
  syncTeamRef();
  saveGame();
}

// 重新建立镜像引用（切队伍 / 加载后调用）
function syncTeamRef() {
  gameData.team = gameData.teams[gameData.activeTeam].ids;
}

// 当前编辑队伍的下标（列表页返回 -1）
let _editing = -1;
// 编辑页标题接管缓存（进入编辑页保存原标题，返回列表时恢复）
let _prevTitle = null;

// 设置当前上场队伍
export function setActiveTeam(i) {
  if (gameData.activeTeam === i) return;
  gameData.activeTeam = i;
  syncTeamRef();
  saveGame();
  render();
}

// 训练/饲育屋占用某只宝可梦时，从所有配队中移除它（任意队伍都不得占用被训练/配对的宝可梦）
export function removePokemonFromAllTeams(id) {
  const tms = Array.isArray(gameData.teams) ? gameData.teams : null;
  if (tms) {
    for (const t of tms) {
      if (!t || !Array.isArray(t.ids)) continue;
      const i = t.ids.indexOf(id);
      if (i >= 0) t.ids.splice(i, 1);
    }
  } else if (Array.isArray(gameData.team)) {
    gameData.team = gameData.team.filter(x => x !== id);
  }
}

// 是否正处配队编辑子页（列表页返回 false；战斗替换模式不算子页，标题返回走原逻辑）
export function isTeamEditing() {
  return !_battleCb && _editing >= 0;
}

// 返回队伍列表页（配队子页标题返回调用），恢复标题栏
export function closeTeamEdit() {
  if (_battleCb || _editing < 0) return false;
  _editing = -1;
  const t = $('appTitle');
  if (t && _prevTitle != null) {
    t.innerHTML = _prevTitle;
    _prevTitle = null;
  }
  render();
  return true;
}

// 子页标题栏接管：显示"队伍N"，返回走 closeTeamEdit
function enterTeamEditTitle(name) {
  const t = $('appTitle');
  if (!t) return;
  if (_prevTitle == null) _prevTitle = t.innerHTML;
  t.innerHTML = `<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> ${name}`;
  t.dataset.action = 'back';
}

// 编辑页跳仓库选人/查看个体后返回时，showView 会重置标题为"配队"，这里补回"队伍N"
function ensureEditTitle() {
  if (_editing >= 0 && !_battleCb) {
    enterTeamEditTitle(`队伍${_editing + 1}`);
  }
}

// 当前操作队伍的 ids（编辑页 = 被编辑队伍；否则 = 当前上场队伍）
function editIds() {
  return _editing >= 0 ? gameData.teams[_editing].ids : teamIds();
}

let _hint = null;       // 底部提示文案（如对战前队伍为空跳转时给出引导）
// 战斗中替换：非空时配队页处于"选择上场宝可梦"模式
let _battleParty = null;   // 出战队伍 [{ entry, pd, mon }]
let _battleFieldIdx = -1;  // 当前场上成员下标（不可替换给自己）
let _battleCb = null;      // 选择回调：idx 为上场下标，-1 表示取消
let _battleCanCancel = false; // 战斗中替换是否可取消：主动替换可取消，宝可梦倒下必须换人
// "加入队伍"放入页状态（空槽点击进入，与训练/饲育屋放入页一致的样式与交互）
let _pickSlot = null;        // 目标槽位（非空 = 处于放入页）
let _pickSearch = '';
let _pickSortBy = null;
let _pickSortDir = 1;
let _pickTypeFilter = '';
let _pickRegionFilter = '';
let _pickSrc = '';
let _pickLegend = '';
let _pickShiny = '';
let _pickVariant = '';
let _pickListScroll = 0;
let _pickRenderSeq = 0;
// 拖拽换位状态
let _dragFrom = -1;      // 正在拖拽的源槽位（-1 = 未拖拽）
let _dragTarget = -1;    // 指针当前悬停的目标槽位
let _dragGhost = null;   // 跟随指针的幽灵卡片
let _dragOnTrash = false; // 指针是否位于底部移除停靠区
let _suppressClick = false; // 拖拽结束后抑制本次 click（避免误弹菜单）

export function showTeamView(hint, prev) {
  _hint = hint || null;
  _battleCb = null; _battleParty = null; _battleFieldIdx = -1; _battleCanCancel = false;
  _editing = -1; // 从列表页进入
  _prevTitle = null;
  pushNav('teamView'); // 返回由导航栈逐级回来源页（战斗列表/手机主页）
  render();
  showView('teamView');
}

// 仓库选取取消/返回：回到配队页（配队页仍在导航栈中，返回路径不受影响）
export function restoreTeamView() {
  ensureEditTitle();
  render();
  showView('teamView');
}

// 战斗中替换：进入配队页面，点击成员直接替换场上宝可梦；canCancel=false 表示必须换人（如倒下换下一只），隐藏"返回"按钮
export function showTeamViewForBattle(party, fieldIdx, onPick, canCancel = true) {
  _battleParty = party;
  _battleFieldIdx = fieldIdx;
  _battleCb = onPick;
  _battleCanCancel = canCancel;
  _editing = gameData.activeTeam; // 直接编辑当前上场队伍
  _prevTitle = null;
  render();
  showView('teamView');
}

// 配队替换选择页的标题栏返回：强制替换（宝可梦倒下必须换人）→ 返回 true，
// 由调用方撤退回对战列表；主动替换 → 等同页脚"返回"按钮，取消选择回战斗操作界面，返回 false。
export function backFromBattlePick() {
  if (!_battleCb) return false;
  const forced = !_battleCanCancel;
  const cb = _battleCb;
  _battleCb = null; _battleParty = null; _battleFieldIdx = -1; _battleCanCancel = false;
  if (!forced) cb(-1); // 主动替换：取消选择
  return forced;
}

// 是否处于战斗替换选择模式（主动替换 / 宝可梦倒下换人）
export function isBattlePicking() {
  return !!_battleCb;
}

// 该个体是否在任意队伍中（放入页占用确认用）
export function isInAnyTeam(id) {
  const tms = Array.isArray(gameData.teams) ? gameData.teams : null;
  if (tms) return tms.some(t => t && Array.isArray(t.ids) && t.ids.includes(id));
  return Array.isArray(gameData.team) && gameData.team.includes(id);
}

// 仓库选取：从列表项加入队伍（空槽点击跳转仓库后由列表项触发），按被点击的槽位落位。
// 若该个体正被训练/饲育屋占用，先弹确认框，确认后才入队（自动撤下原占用方）
export function addToTeam(id, slot) {
  const arr = editIds();
  // 按实际成员数判断满员（数组可能含空位）；已占用的槽位视为替换，不受满员限制
  if ((!arr[slot] && arr.filter(Boolean).length >= TEAM_MAX) || arr.includes(id)) return;
  Promise.all([
    import('./train.js').then(m => m.isTrainingPokemon(id)),
    import('./nursery.js').then(m => m.isNurseryPokemon(id)),
    import('./dispatch.js').then(m => m.isDispatchPokemon(id)),
  ]).then(([inTrain, inNursery, inDispatch]) => {
    const occ = [];
    if (inTrain) occ.push('训练');
    if (inNursery) occ.push('饲育屋');
    if (inDispatch) occ.push('派遣');
    if (occ.length) {
      showConfirmBar(`这只宝可梦正在${occ.join('、')}中。加入队伍将自动将其撤下，确定加入？`, () => doAddToTeam(id, slot), null, { overlay: true });
      return;
    }
    doAddToTeam(id, slot);
  });
}

function doAddToTeam(id, slot) {
  const arr = editIds();
  // 按实际成员数判断满员（数组可能含空位）；已占用的槽位视为替换，不受满员限制
  if ((!arr[slot] && arr.filter(Boolean).length >= TEAM_MAX) || arr.includes(id)) return;
  const next = [...arr];
  next[slot] = id;
  // 原地更新保持引用（gameData.team 镜像可能正指向该数组）
  arr.splice(0, arr.length, ...next);
  _hint = null; // 加入成员后不再提示"队伍为空"
  saveGame();
  // 训练/饲育屋/队伍/派遣互斥：入队后从其它槽位移除
  import('./train.js').then(m => m.removeTrainingByPokemon(id));
  import('./nursery.js').then(m => m.removeNurseryByPokemon(id));
  import('./dispatch.js').then(m => m.removeDispatchByPokemon(id));
  ensureEditTitle();
  render();
  showView('teamView');
}

// 重新渲染配队页（恢复替换选择页用，状态仍保留在模块内）
export function rerenderTeamView() {
  render();
}

function render() {
  closeTeamMenu();
  const box = $('teamContent');
  if (!box) return;
  if (_battleCb) { renderBattlePick(box); return; }
  if (_pickSlot != null) { renderTeamPick(box); return; }
  if (_editing >= 0) { renderTeamEdit(box); return; }
  renderTeamList(box);
}

// ---------- 队伍列表页：2 列 × 3 行卡片预览 ----------
function renderTeamList(box) {
  const roster = (gameData.roster || []).filter(p => p.inRoster !== false && isPokemon(p));
  const byId = new Map(roster.map(p => [p.id, p]));
  const active = gameData.activeTeam;
  const teams = gameData.teams || [];
  box.innerHTML = `
    ${_hint ? `<div class="team-list-hint">${_hint}</div>` : ''}
    <div class="team-list-grid">
      ${teams.map((t, i) => {
        const isActive = i === active;
        const count = (t.ids || []).filter(id => byId.has(id)).length;
        return `
        <div class="team-list-card${isActive ? ' active' : ''}" data-open-team="${i}">
          <div class="team-card-head">
            <span class="team-card-name" data-rename="${i}" title="点击改名">${t.name || `队伍${i + 1}`}</span>
            <svg class="team-card-rename" data-rename="${i}" viewBox="0 0 24 24" fill="none"><use xlink:href="#icon-rename"/></svg>
          </div>
          <div class="team-card-preview">
            ${[0, 1, 2, 3, 4, 5].map(s => {
              const id = (t.ids || [])[s];
              const p = id != null ? byId.get(id) : null;
              if (!p) return '<div class="team-card-mon empty"></div>';
              const poke = getPokemonByIndex(String(p.species));
              return `<div class="team-card-mon${p.shiny ? ' shiny' : ''}" data-tip="${p.nickname || (poke ? poke.name : `#${p.species}`)}"><img data-icon="${p.species}" alt=""></div>`;
            }).join('')}
          </div>
          <div class="team-card-foot">
            <span class="team-card-count">${count}/${TEAM_MAX}</span>
            <button class="team-card-set${isActive ? ' on' : ''}" data-act-team="${i}">${isActive ? '上场中' : '设为上场'}</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  // 加载成员图标
  box.querySelectorAll('img[data-icon]').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
  // 点击卡片进入编辑
  box.querySelectorAll('[data-open-team]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-rename]') || e.target.closest('[data-act-team]')) return;
      const i = Number(card.dataset.openTeam);
      _editing = i;
      enterTeamEditTitle(`队伍${i + 1}`);
      render();
    });
  });
  // 设为上场
  box.querySelectorAll('[data-act-team]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setActiveTeam(Number(btn.dataset.actTeam));
    });
  });
  // 队伍命名：点击名称/笔图标就地编辑，回车/失焦保存
  box.querySelectorAll('[data-rename]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = Number(el.dataset.rename);
      const card = el.closest('.team-list-card');
      const head = card?.querySelector('.team-card-head');
      if (!head) return;
      const oldName = gameData.teams[i].name || `队伍${i + 1}`;
      head.innerHTML = `<input class="team-name-input" maxlength="8" value="${oldName}">`;
      const input = head.querySelector('input');
      input.focus();
      input.select();
      const commit = () => {
        const v = input.value.trim() || `队伍${i + 1}`;
        gameData.teams[i].name = v;
        saveGame();
        render();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') commit();
        else if (ev.key === 'Escape') render();
      });
      input.addEventListener('blur', commit);
      input.addEventListener('click', (ev) => ev.stopPropagation());
    });
  });
}

// ---------- "加入队伍"全页列表（与训练/饲育屋放入页一致：搜索/筛选/排序/详情，标题栏为「放入」） ----------

// 点击队伍编辑页空槽：切到全页放入列表
function openTeamPick(slot) {
  _pickSlot = slot;
  render();
}

// 放入页是否打开（供 main.js 标题栏返回使用）
export function isTeamPicking() {
  return _pickSlot != null && $('teamView')?.style.display !== 'none';
}

// 标题栏返回：退出放入页，回队伍编辑页并恢复子页标题
export function leaveTeamPick() {
  if (_pickSlot == null) return;
  _pickSlot = null;
  _pickSearch = '';
  _pickTypeFilter = '';
  _pickRegionFilter = '';
  _pickSrc = '';
  _pickLegend = '';
  _pickShiny = '';
  _pickVariant = '';
  render();
  enterTeamEditTitle(`队伍${_editing + 1}`); // 恢复队伍编辑子页标题
}

// 全页"加入队伍"列表：顶部搜索/筛选/排序，行点击跳个体详情，按钮加入该槽位
function renderTeamPick(box) {
  box.innerHTML = `
    <div class="view-list" style="display:flex;flex-direction:column;flex:1;min-height:0;">
      <div class="pokedex-progress" id="teamPickProgress">
        <span id="teamPickProgressCount"></span>
      </div>
      <div class="pokedex-search">
        <div class="pokedex-search-row">
          <div class="pokedex-search-input-wrap">
            <input id="teamPickSearch" class="pokedex-search-input" type="text" placeholder="搜索宝可梦"
              autocomplete="off" value="${_pickSearch.replace(/"/g, '&quot;')}" />
            <button class="pokedex-search-clear" id="teamPickSearchClear" style="${_pickSearch ? '' : 'display:none'}" aria-label="清空搜索">
              <svg><use xlink:href="#icon-close"></use></svg>
            </button>
          </div>
          <div id="teamPickSrcFilter" class="pokedex-region-select" tabindex="0" title="按来源筛选">
            <span id="teamPickSrcFilterLabel">${sourceFilterLabel({ src: _pickSrc, legend: _pickLegend, shiny: _pickShiny, variant: _pickVariant })}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="teamPickSrcFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
          <div id="teamPickTypeFilter" class="pokedex-region-select" tabindex="0" title="按属性筛选">
            <span id="teamPickTypeFilterLabel">${_pickTypeFilter ? _pickTypeFilter : '属性'}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="teamPickTypeFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
          <div id="teamPickRegionFilter" class="pokedex-region-select" tabindex="0" title="按地区筛选">
            <span id="teamPickRegionFilterLabel">${_pickRegionFilter || '地区'}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="teamPickRegionFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
        </div>
      </div>
      <div class="pokedex-header roster-header nursery-pick-header team-pick-header">
        <span class="roster-icon"></span>
        <span class="pokedex-star"></span>
        <span class="pokedex-name" data-sort="name">名称</span>
        <span class="roster-lv-col" data-sort="level">等级</span>
        <span class="roster-iv" data-sort="iv">个体值</span>
        <span class="bounty-trade-btn-col">加入</span>
      </div>
      <div class="list-scroll nursery-pick-list team-pick-list">
      </div>
    </div>`;
  // 进度：可加入总数（已排除当前队伍内个体）
  const prog = box.querySelector('#teamPickProgressCount');
  if (prog) prog.textContent = `共 ${teamPickRows().length} 只可加入`;
  // 设置标题栏
  const title = $('appTitle');
  if (title) {
    title.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 放入';
    title.dataset.action = 'back';
  }
  // 行事件委托：行 DOM 由分片渲染动态插入，委托绑定一次，避免每片重复绑定
  const list = box.querySelector('.team-pick-list');
  if (list) {
    list.onclick = (e) => {
      const btn = e.target.closest('[data-pick-submit]');
      if (btn) {
        e.stopPropagation();
        const slot = _pickSlot;
        _pickSlot = null;
        addToTeam(btn.dataset.pickSubmit, slot);
        return;
      }
      const row = e.target.closest('[data-pick-view]');
      if (!row) return;
      e.stopPropagation();
      _pickListScroll = list.scrollTop; // 记住列表位置，返回后恢复
      import('./roster.js').then(m => m.showRosterDetailFromList(row.dataset.pickView, () => {
        showView('teamView');
        render(); // _pickSlot 未清空，仍显示放入列表
      }));
    };
    // 分片渲染完成后恢复详情返回前的滚动位置
    renderTeamPickRows(list, () => { list.scrollTop = _pickListScroll; });
  }
  bindTeamPickPersistent(box);
  bindTeamPickFilters(box);
}

// 个体值总和
function pickIvSum(p) {
  if (!p.ivs) return 0;
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].reduce((s, k) => s + (p.ivs[k] || 0), 0);
}
// 个体值明细（hover 个体值单元格的 tooltip 显示；HP 用全角 ＨＰ，与中文标签同宽，数值自然对齐）
function pickIvTip(p) {
  return [['ＨＰ', 'hp'], ['攻击', 'atk'], ['防御', 'def'], ['特攻', 'spa'], ['特防', 'spd'], ['速度', 'spe']]
    .map(([label, k]) => `${label}  ${p.ivs ? (p.ivs[k] || 0) : 0}`)
    .join('\n');
}

// 放入列表来源筛选状态（供共享来源下拉读写）
function pickSrcState() {
  return {
    get src() { return _pickSrc; }, set src(v) { _pickSrc = v; },
    get legend() { return _pickLegend; }, set legend(v) { _pickLegend = v; },
    get shiny() { return _pickShiny; }, set shiny(v) { _pickShiny = v; },
    get variant() { return _pickVariant; }, set variant(v) { _pickVariant = v; },
  };
}

// "加入队伍"列表候选：全部在仓个体（排除当前队伍内个体与蛋），行结构与训练/饲育屋放入页一致
function teamPickRows() {
  const exclude = new Set(editIds().filter(Boolean));
  const q = _pickSearch.trim();
  return (gameData.roster || [])
    .filter(p => p.inRoster && !exclude.has(p.id))
    .filter(p => !p.kind || p.kind !== 'egg') // 宝可梦蛋不能入队
    // 属性筛选
    .filter(p => {
      if (!_pickTypeFilter) return true;
      const poke = getPokemonByIndex(String(p.species));
      return poke?.types?.includes(_pickTypeFilter);
    })
    // 地区筛选
    .filter(p => {
      if (!_pickRegionFilter) return true;
      const poke = getPokemonByIndex(String(p.species));
      return poke?.region === _pickRegionFilter;
    })
    // 来源筛选：来源 → 神兽 → 闪光 → 变体（与 roster 一致；mass 归入「野生」）
    .filter(p => {
      if (_pickSrc) return _pickSrc === 'normal' ? (p.source === 'normal' || p.source === 'mass') : p.source === _pickSrc;
      return true;
    })
    .filter(p => {
      if (!_pickLegend) return true;
      const poke = getPokemonByIndex(String(p.species));
      const isLegend = poke?.legend === true;
      return _pickLegend === 'legend' ? isLegend : !isLegend;
    })
    .filter(p => {
      if (!_pickShiny) return true;
      return _pickShiny === 'shiny' ? p.shiny : !p.shiny;
    })
    .filter(p => {
      if (!_pickVariant) return true;
      return _pickVariant === 'any' ? !!p.variant : p.variant === _pickVariant;
    })
    // 搜索过滤：名称 / 拼音 / 首字母 / 昵称
    .filter(p => {
      if (!q) return true;
      const poke = getPokemonByIndex(String(p.species));
      if (!poke) return true;
      const upper = q.toUpperCase();
      return poke.name.includes(q) ||
        (poke.pinyin || '').toUpperCase().includes(upper) ||
        (poke.pinyinInitials || '').toUpperCase().includes(upper) ||
        matchPinyinPartial(q, poke.pinyin) ||
        (p.nickname && p.nickname.includes(q));
    })
    .sort((a, b) => {
      let va, vb;
      if (_pickSortBy === 'name') {
        va = getPokemonByIndex(String(a.species))?.name || '';
        vb = getPokemonByIndex(String(b.species))?.name || '';
      } else if (_pickSortBy === 'iv') {
        va = pickIvSum(a); vb = pickIvSum(b);
      } else if (_pickSortBy === 'level') {
        va = a.level || 1; vb = b.level || 1;
      } else {
        // 默认按编号排序：纯数字保持"编号+等级"语义，扩展编号（变体）按字符串比较
        const ai = String(a.species), bi = String(b.species);
        const an = Number(ai), bn = Number(bi);
        if (Number.isFinite(an) && Number.isFinite(bn)) {
          va = an * 1000 + (a.level || 1);
          vb = bn * 1000 + (b.level || 1);
        } else {
          va = ai; vb = bi;
        }
      }
      if (typeof va === 'string') return va.localeCompare(vb) * _pickSortDir;
      return (va - vb) * _pickSortDir;
    });
}

// 放入列表单行渲染
function teamPickRowHtml(p) {
  const poke = getPokemonByIndex(String(p.species));
  const name = p.nickname || (poke ? poke.name : `#${p.species}`);
  const icon = poke?.icon ? `<img class="roster-icon-img" data-icon="${p.species}" alt="" />` : '';
  return `
  <div class="pokedex-entry roster-row bounty-trade-row" data-pick-view="${p.id}">
    <span class="roster-icon">${icon}</span>
    <span class="pokedex-star">${pokemonSourceBadge(p)}</span>
    <span class="pokedex-name">${name}</span>
    <span class="roster-lv-col">${genderBadge(ensureGender(p))}Lv${p.level || 1}</span>
    <span class="roster-iv" data-tip="${pickIvTip(p)}">${pickIvSum(p)}</span>
    <span class="bounty-trade-btn-col"><button class="bounty-trade-btn" data-pick-submit="${p.id}">加入</button></span>
  </div>`;
}

// 分片渲染放入列表：每帧插一批 + 分片加载图标（与仓库/训练/饲育屋同款方案）
function renderTeamPickRows(list, onDone) {
  const sorted = teamPickRows();
  _pickRenderSeq++;
  const seq = _pickRenderSeq;
  list.innerHTML = '';
  if (!sorted.length) {
    list.innerHTML = _pickSearch.trim()
      ? `<div class="roster-trade-empty">没有匹配的宝可梦</div>`
      : `<div class="roster-trade-empty">仓库里没有可以加入的宝可梦</div>`;
    onDone?.();
    return;
  }
  let i = 0;
  const CHUNK = 40;
  const step = () => {
    if (seq !== _pickRenderSeq || !list.isConnected) return; // 已被新一轮渲染取代或列表已卸载
    const view = $('teamView');
    if (view && view.style.display === 'none') return; // 视图已隐藏：暂停分片，避免后台继续抢图片 I/O
    const rows = [];
    const end = Math.min(i + CHUNK, sorted.length);
    for (; i < end; i++) rows.push(teamPickRowHtml(sorted[i]));
    const before = list.querySelectorAll('.roster-icon-img').length;
    list.insertAdjacentHTML('beforeend', rows.join(''));
    const imgs = list.querySelectorAll('.roster-icon-img');
    for (let k = before; k < imgs.length; k++) {
      const poke = getPokemonByIndex(imgs[k].dataset.icon);
      if (poke?.icon) tryLoadImage(imgs[k], poke.icon);
    }
    if (i < sorted.length) { requestAnimationFrame(step); return; }
    onDone?.(); // 分片完成
  };
  requestAnimationFrame(step);
}

// 局部刷新放入列表（搜索/排序时只重建列表，不重建搜索框避免失焦）。
// 防抖合并快速连续触发（连点排序/连续输入）：否则多轮分片渲染的图标请求并发叠加，
// 触发浏览器资源上限 ERR_INSUFFICIENT_RESOURCES
let _pickRefreshT = null;
function refreshTeamPick() {
  clearTimeout(_pickRefreshT);
  _pickRefreshT = setTimeout(() => {
    const page = $('teamContent');
    if (!page || _pickSlot == null) return;
    const list = page.querySelector('.team-pick-list');
    if (!list) return;
    renderTeamPickRows(list); // 新一轮分片渲染自动取代旧轮（行 DOM 由委托绑定）
    const prog = page.querySelector('#teamPickProgressCount');
    if (prog) prog.textContent = `共 ${teamPickRows().length} 只可加入`;
    markTeamPickSort(page); // 点击排序后同步三角箭头（表头是持久 DOM，需主动刷新标记）
  }, 80);
}

// 页面级持久监听（搜索 / 表头排序）：仅在 render() 重建页面时绑定一次
function bindTeamPickPersistent(root) {
  // 搜索输入：实时过滤列表，不清空排序状态
  const searchInput = root.querySelector('#teamPickSearch');
  const searchClear = root.querySelector('#teamPickSearchClear');
  if (searchInput) {
    const doSearch = () => {
      _pickSearch = searchInput.value.trim();
      if (searchClear) searchClear.style.display = _pickSearch ? '' : 'none';
      refreshTeamPick();
    };
    searchInput.addEventListener('input', doSearch);
    searchClear?.addEventListener('click', () => {
      searchInput.value = '';
      doSearch();
      searchInput.focus();
    });
  }
  // 表头点击排序（3 段 toggle：升序 → 降序 → 回到默认编号排序）
  root.querySelectorAll('.team-pick-header [data-sort]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const field = el.dataset.sort;
      if (_pickSortBy === field) {
        if (_pickSortDir === 1) _pickSortDir = -1;
        else { _pickSortBy = null; _pickSortDir = 1; }
      } else { _pickSortBy = field; _pickSortDir = 1; }
      refreshTeamPick();
    });
  });
  markTeamPickSort(root);
}

// 标记当前排序列的三角箭头（先清旧标记再加新标记）
function markTeamPickSort(root) {
  const header = root.querySelector('.team-pick-header');
  if (!header) return;
  header.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
  const cur = _pickSortBy ? header.querySelector(`[data-sort="${_pickSortBy}"]`) : null;
  if (cur) cur.classList.add(_pickSortDir === 1 ? 'sort-asc' : 'sort-desc');
}

// 筛选下拉菜单绑定（只在 renderTeamPick 时调用一次，避免 refreshTeamPick 重复绑定）
function bindTeamPickFilters(root) {
  // 属性筛选下拉
  const typeTrigger = root.querySelector('#teamPickTypeFilter');
  const typeLabel = root.querySelector('#teamPickTypeFilterLabel');
  const typeDd = root.querySelector('#teamPickTypeFilterDropdown');
  if (typeTrigger && typeLabel && typeDd) {
    const typeList = Object.keys(TYPE_COLORS);
    function buildTypeOptions() {
      typeDd.innerHTML = `<div class="region-dropdown-item${!_pickTypeFilter ? ' active' : ''}" data-type="">全部</div>`
        + typeList.map(t => `<div class="region-dropdown-item${t === _pickTypeFilter ? ' active' : ''}" data-type="${t}"><span class="roster-type-dot" style="background:${TYPE_COLORS[t]}"></span>${t}</div>`).join('');
      typeDd.querySelectorAll('.region-dropdown-item').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          _pickTypeFilter = el.dataset.type || '';
          typeLabel.innerHTML = _pickTypeFilter
            ? `<span class="roster-type-dot" style="background:${TYPE_COLORS[_pickTypeFilter]}"></span>${_pickTypeFilter}`
            : '属性';
          closeAllDropdowns();
          refreshTeamPick();
        });
      });
    }
    typeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = typeDd.style.display !== 'none';
      closeAllDropdowns(); // 关闭全部下拉（含来源）
      if (!isOpen) {
        buildTypeOptions();
        typeDd.style.display = '';
        typeTrigger.classList.add('open');
      }
    });
  }
  // 地区筛选下拉
  const regionTrigger = root.querySelector('#teamPickRegionFilter');
  const regionLabel = root.querySelector('#teamPickRegionFilterLabel');
  const regionDd = root.querySelector('#teamPickRegionFilterDropdown');
  if (regionTrigger && regionLabel && regionDd) {
    function buildRegionOptions() {
      regionDd.innerHTML = `<div class="region-dropdown-item${!_pickRegionFilter ? ' active' : ''}" data-region="">全部</div>`
        + REGION_CYCLE.map(r => `<div class="region-dropdown-item${r === _pickRegionFilter ? ' active' : ''}" data-region="${r}">${r}</div>`).join('');
      regionDd.querySelectorAll('.region-dropdown-item').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          _pickRegionFilter = el.dataset.region || '';
          regionLabel.textContent = _pickRegionFilter || '地区';
          closeAllDropdowns();
          refreshTeamPick();
        });
      });
    }
    regionTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = regionDd.style.display !== 'none';
      closeAllDropdowns(); // 关闭全部下拉（含来源）
      if (!isOpen) {
        buildRegionOptions();
        regionDd.style.display = '';
        regionTrigger.classList.add('open');
      }
    });
  }
  // 来源筛选下拉（与 roster 共用的二级三级菜单）
  setupSourceFilter({
    trigger: root.querySelector('#teamPickSrcFilter'),
    label: root.querySelector('#teamPickSrcFilterLabel'),
    dd: root.querySelector('#teamPickSrcFilterDropdown'),
    state: pickSrcState(),
    onPick: refreshTeamPick,
  });
}

// ---------- 队伍编辑页（子页）：槽位/拖拽/菜单 ----------
function renderTeamEdit(box) {
  const roster = (gameData.roster || []).filter(p => p.inRoster !== false && isPokemon(p));
  const rosterIds = new Set(roster.map(p => p.id));
  const arr = editIds();
  // 清理已失效的队伍成员（被放生等）
  if (arr.some(id => !rosterIds.has(id))) {
    arr.splice(0, arr.length, ...arr.filter(id => rosterIds.has(id)));
    saveGame();
  }
  const byId = new Map(roster.map(p => [p.id, p]));
  const slotPokes = arr.map(id => byId.get(id) || null);

  box.innerHTML = `
    <div class="team-app">
      <div class="team-party">
        ${[0, 1, 2, 3, 4, 5].map(i => slotHtml(i, slotPokes[i], false)).join('')}
      </div>
    </div>
    ${_hint ? '' : trashDockHtml()}
    ${footerHtml()}`;
  // 加载个体图标
  box.querySelectorAll('img[data-icon]').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
  // 槽位点击：空槽跳转仓库选择；已有宝可梦弹操作菜单（拖拽换位由 bindDrag 接管）
  box.querySelectorAll('[data-slot]').forEach(slot => {
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_suppressClick) return; // 刚拖拽结束，本次点击只算收尾，不弹菜单
      const i = Number(slot.dataset.slot);
      if (!slotPokes[i]) {
        openTeamPick(i); // 空槽：进入全页"加入队伍"列表
        return;
      }
      openTeamMenu(e, i, slotPokes[i]);
    });
  });
  // 空白区域右键：弹出队伍管理菜单（随机配队 / 清空）
  const app = box.querySelector('.team-app');
  app?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到全局右键监听
    if (e.target.closest('.team-member')) return; // 卡片上右键不弹，保持原有行为
    openTeamCtxMenu(e);
  });
  bindDrag(box);
  // 拖拽移除停靠区定位：无页脚时贴底，有页脚（提示条）时停在页脚上方
  const dockEl = $('teamTrashDock');
  if (dockEl) {
    const footer = box.querySelector('.team-footer');
    dockEl.style.bottom = footer ? `${footer.offsetHeight + 2}px` : '0px';
  }
}

// ---------- 战斗中替换（原 _battleCb 模式） ----------
function renderBattlePick(box) {
  const slotPokes = _battleParty.map(x => x.entry); // 直接显示出战队伍
  box.innerHTML = `
    <div class="team-app">
      <div class="team-party">
        ${[0, 1, 2, 3, 4, 5].map(i => {
          const p = slotPokes[i];
          const disabled = !p || _battleParty[i].mon.hp <= 0 || i === _battleFieldIdx;
          return slotHtml(i, p, disabled);
        }).join('')}
      </div>
    </div>
    ${footerHtml()}`;
  // 加载个体图标
  box.querySelectorAll('img[data-icon]').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
  // 战斗替换：返回战斗，不换人
  $('teamBattleBack')?.addEventListener('click', () => {
    const cb = _battleCb;
    _battleCb = null; _battleParty = null; _battleFieldIdx = -1; _battleCanCancel = false;
    showView('battleView');
    if (cb) cb(-1);
  });
  // 槽位点击：选择上场
  box.querySelectorAll('[data-slot]').forEach(slot => {
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_suppressClick) return;
      const i = Number(slot.dataset.slot);
      const member = _battleParty[i];
      if (!member || member.mon.hp <= 0 || i === _battleFieldIdx) return;
      const cb = _battleCb;
      _battleCb = null; _battleParty = null; _battleFieldIdx = -1; _battleCanCancel = false;
      showView('battleView');
      cb(i);
    });
  });
}

// 底部移除停靠区：全宽横条，拖拽宝可梦进入即相当于菜单「移除」
function trashDockHtml() {
  return `<div class="team-trash-dock" id="teamTrashDock">
    <svg viewBox="0 0 1024 1024" width="13" height="13"><use xlink:href="#icon-delete"/></svg>
    <span>拖到此处移除</span>
  </div>`;
}

// 配队页空白区域右键菜单
function openTeamCtxMenu(e) {
  closeTeamMenu();
  const box = $('teamContent');
  const r = box.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'team-menu';
  menu.innerHTML = `
    <button data-menu-act="auto">随机配队</button>
    <button data-menu-act="clear">清空</button>`;
  menu.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const act = ev.target.closest('[data-menu-act]');
    if (!act) return;
    closeTeamMenu();
    if (act.dataset.menuAct === 'auto') autoBuildTeam();
    else if (act.dataset.menuAct === 'clear') clearTeam();
  });
  box.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.max(0, Math.min(e.clientX - r.left, r.width - mw - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(e.clientY - r.top, r.height - mh - 4))}px`;
  _menuEl = menu;
}

// 随机配队：
// - 队伍为空或已满：从非训练状态的宝可梦中取一组合计等级差最小的 6 只整队入队。
//   按等级升序排序后滑窗取连续 6 只，使（最高级 - 最低级）最小；多个窗口并列最小时随机挑一个，
//   组内顺序再随机打散（打头阵的宝可梦不固定）。
// - 队伍未满且已有成员：默认保留现有成员原位，以队内最低等级为基准，从可选池挑等级最接近的补满空位，
//   等级差相同的候选随机选取。
// - 特例：现有成员明显偏弱（可选池够满编且整池等级都高于现有成员最高级）时直接整队重配，
//   避免保留几只低等级旧成员、放着整池高等级宝可梦不用。
function autoBuildTeam() {
  const trainingIds = new Set((gameData.training?.slots || []).map((s) => s && s.id).filter(Boolean));
  const roster = (gameData.roster || []).filter((p) => p.inRoster !== false && !trainingIds.has(p.id));
  if (!roster.length) return;
  const byId = new Map(roster.map((p) => [p.id, p]));
  const arr = editIds();
  const used = new Set(arr.filter((id) => byId.has(id)));
  const pool = roster.filter((p) => !used.has(p.id)); // 可用候选池（不含当前队内成员）
  const members = arr.map((id) => byId.get(id)).filter(Boolean); // 队内有效成员（放生失效 id 视作空位）
  // 未满员且有至少一只确定宝可梦：补满队伍（除非整池都更强 → 走下方整队重配）
  if (members.length > 0 && members.length < TEAM_MAX) {
    const maxMemberLv = Math.max(...members.map((p) => p.level || 1));
    const forceReplace = pool.length >= TEAM_MAX && pool.every((p) => (p.level || 1) > maxMemberLv);
    if (!forceReplace) {
      const base = Math.min(...members.map((p) => p.level || 1)); // 以队内最低等级为基准
      const cands = pool
        .sort((a, b) => (Math.abs((a.level || 1) - base) - Math.abs((b.level || 1) - base)) || Math.random() - 0.5);
      const picks = cands.slice(0, TEAM_MAX - members.length);
      const next = arr.map((id) => (byId.has(id) ? id : null)); // 有效成员保持原位
      let k = 0;
      for (let i = 0; i < TEAM_MAX && k < picks.length; i++) {
        if (!next[i]) next[i] = picks[k++].id;
      }
      while (next.length < TEAM_MAX && k < picks.length) next.push(picks[k++].id);
      arr.splice(0, arr.length, ...next);
      saveGame();
      render();
      return;
    }
  }
  // 空队 / 满员 / 整队替换：从候选池滑窗取等级跨度最小的 6 只
  const sorted = [...pool].sort((a, b) => (a.level || 1) - (b.level || 1));
  let pick;
  if (sorted.length <= TEAM_MAX) {
    pick = sorted;
  } else {
    let best = Infinity;
    const bestStarts = [];
    for (let i = 0; i + TEAM_MAX <= sorted.length; i++) {
      const spread = (sorted[i + TEAM_MAX - 1].level || 1) - (sorted[i].level || 1);
      if (spread < best) { best = spread; bestStarts.length = 0; bestStarts.push(i); }
      else if (spread === best) bestStarts.push(i);
    }
    const start = bestStarts[Math.floor(Math.random() * bestStarts.length)];
    pick = sorted.slice(start, start + TEAM_MAX);
  }
  // 组内顺序随机打散
  const team = pick.slice().sort(() => Math.random() - 0.5);
  arr.splice(0, arr.length, ...team.map((p) => p.id));
  saveGame();
  render();
}

// 清空配队
function clearTeam() {
  editIds().splice(0);
  saveGame();
  render();
}

// 单槽位渲染：统一布局（左侧图标占满高度 + 右侧名字/等级/经验三行）
function slotHtml(i, p, disabled) {
  const poke = p ? getPokemonByIndex(String(p.species)) : null;
  const name = p?.nickname || (poke ? poke.name : p ? `#${p.species}` : '');
  const shiny = p && p.shiny
    ? '<svg viewBox="0 0 1024 1024" width="10" height="10" style="flex-shrink:0;color:var(--ui-color);vertical-align:-1px;"><use xlink:href="#icon-star"/></svg>'
    : '';
  const dis = disabled ? ' swap-disabled' : '';
  if (!p) return `<div class="team-member empty${dis}" data-slot="${i}">
    <span class="member-empty">空</span>
  </div>`;
  const cur = p.exp || 0;
  const need = expNeed(p.level || 1);
  const ratio = Math.min(100, Math.max(0, (cur / need) * 100));
  return `<div class="team-member${dis}" data-slot="${i}">
    <img class="member-icon" data-icon="${p.species}" alt="" draggable="false">
    <div class="member-body">
      <div class="member-top"><span class="member-name">${name}${shiny}</span></div>
      <div class="member-mid">
        <span class="member-lv">${genderBadge(ensureGender(p))}Lv${p.level || 1}</span>
        <span class="xp-nums">${Math.floor(cur)} / ${need}</span>
      </div>
      <div class="member-xp-row">
        <span class="xp-label">XP</span>
        <div class="xp-bar"><div class="xp-fill" style="width:${ratio.toFixed(1)}%"></div></div>
      </div>
    </div>
  </div>`;
}

function footerHtml() {
  if (_battleCb) {
    return `<div class="team-footer">
      <span class="team-footer-text">点击要上场的宝可梦。</span>
      ${_battleCanCancel ? '<button class="team-footer-btn" id="teamBattleBack">返回</button>' : ''}
    </div>`;
  }
  if (_hint) {
    return `<div class="team-footer">
      <span class="team-footer-text">${_hint}</span>
    </div>`;
  }
  return '';
}

// 点击宝可梦时在卡片中部偏下弹出操作菜单（查看 / 替换 / 移除）
let _menuEl = null;
let _menuSlot = -1;
let _menuSlotEl = null;

function closeTeamMenu() {
  if (_menuEl) { _menuEl.remove(); _menuEl = null; }
  if (_menuSlotEl) { _menuSlotEl.classList.remove('menu-open'); _menuSlotEl = null; }
  _menuSlot = -1;
}

function openTeamMenu(e, i, p) {
  closeTeamMenu();
  if (!p) return; // 空槽不弹菜单
  _menuSlot = i;
  const slotEl = e.currentTarget; // 高亮被点击的槽位，标识菜单归属
  slotEl.classList.add('menu-open');
  _menuSlotEl = slotEl;
  const box = $('teamContent');
  const r = box.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'team-menu';
  menu.innerHTML = `
    <button data-menu-act="view">查看</button>
    <button data-menu-act="replace">替换</button>
    <button data-menu-act="remove">移除</button>`;
  menu.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const act = ev.target.closest('[data-menu-act]');
    if (!act) return;
    const idx = _menuSlot;
    closeTeamMenu();
    if (act.dataset.menuAct === 'remove') removeFromTeam(idx);
    else if (act.dataset.menuAct === 'view') {
      // 查看个体详情（方便配队时配招），返回时恢复配队页
      import('./roster.js').then(m => m.showRosterDetailFromList(p.id, () => restoreTeamView()));
    } else {
      // 替换该位置：进入全页"加入队伍"列表（选中后按槽位落位）
      openTeamPick(idx);
    }
  });
  box.appendChild(menu);
  // 追加后按实际尺寸定位（菜单内容变化时高度随按钮数浮动）
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  // 菜单固定在卡片中部偏下，不跟随点击位置
  const sr = slotEl.getBoundingClientRect();
  const left = sr.left - r.left + sr.width / 2 - mw / 2;
  const top = sr.top - r.top + sr.height * 0.65;
  menu.style.left = `${Math.max(0, Math.min(left, r.width - mw - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(top, r.height - mh - 4))}px`;
  _menuEl = menu;
}

// 点击菜单外空白处关闭菜单（槽位/菜单点击均已 stopPropagation）
document.addEventListener('click', () => { closeTeamMenu(); });
// 右键隐藏菜单（同时屏蔽配队页的原生右键菜单）
document.addEventListener('contextmenu', (e) => {
  if ($('teamView')?.style.display !== 'none') e.preventDefault();
  closeTeamMenu();
});

// 交换两个槽位（保留空位，维持成员所在位置），由拖拽换位调用
function swapSlots(a, b) {
  const arr = editIds();
  const next = [...arr];
  next[a] = arr[b];
  next[b] = arr[a];
  arr.splice(0, arr.length, ...next);
  saveGame();
  render();
}

// 从队伍移除指定槽位
function removeFromTeam(i) {
  const arr = editIds();
  arr.splice(i, 1);
  saveGame();
  render();
}

// ---------- 拖拽换位（指针事件，鼠标/触摸通用） ----------
function clearDragTarget() {
  if (_dragTarget >= 0) {
    const el = $('teamContent')?.querySelector(`.team-member[data-slot="${_dragTarget}"]`);
    el?.classList.remove('drag-over');
  }
  _dragTarget = -1;
}

function bindDrag(host) {
  if (_battleCb) return; // 战斗中替换模式：点击即上场，不拖拽
  host.querySelectorAll('.team-member[data-slot]').forEach(slot => {
    const i = Number(slot.dataset.slot);
    if (slot.classList.contains('empty')) return; // 空槽不可拖（渲染层兜底：即使数据残留失效 id 也不可拖）
    let startX = 0, startY = 0, moved = false; // 移动超过阈值才算拖拽，纯点击仍弹菜单
    slot.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return; // 右键不拖
      e.preventDefault();
      startX = e.clientX; startY = e.clientY; moved = false;
      _dragFrom = i;
      _dragTarget = -1;
      _dragOnTrash = false;
      slot.setPointerCapture(e.pointerId);
      slot.classList.add('dragging');
      // 开始拖拽：点亮底部移除停靠区
      host.querySelector('#teamTrashDock')?.classList.add('active');
      // 幽灵卡片：复制图标 + 名字跟随指针
      _dragGhost = document.createElement('div');
      _dragGhost.className = 'team-drag-ghost';
      const img = slot.querySelector('.member-icon');
      if (img) _dragGhost.appendChild(img.cloneNode(true));
      const nm = slot.querySelector('.member-name');
      if (nm) {
        const t = document.createElement('span');
        t.className = 'team-drag-ghost-name';
        t.textContent = nm.textContent;
        _dragGhost.appendChild(t);
      }
      $('teamContent').appendChild(_dragGhost);
      moveGhost(e);
    });
    slot.addEventListener('pointermove', (e) => {
      if (_dragFrom < 0) return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) moved = true;
      moveGhost(e);
      // 命中检测：指针下最近的槽位（幽灵 pointer-events:none 不影响）
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-slot]');
      const t = el ? Number(el.dataset.slot) : -1;
      if (t !== _dragTarget) {
        clearDragTarget();
        if (t >= 0 && t !== _dragFrom) {
          _dragTarget = t;
          el.classList.add('drag-over');
        }
      }
      // 移除停靠区命中检测：指针进入底部横条范围 → 高亮，松开即移除
      const dock = host.querySelector('#teamTrashDock');
      if (dock) {
        const r = dock.getBoundingClientRect();
        const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (over !== _dragOnTrash) {
          _dragOnTrash = over;
          dock.classList.toggle('remove-over', over);
        }
      }
    });
    const endDrag = (e) => {
      if (_dragFrom < 0) return;
      const from = _dragFrom, to = _dragTarget;
      const onTrash = _dragOnTrash;
      _dragOnTrash = false;
      _dragFrom = -1;
      clearDragTarget();
      host.querySelector('#teamTrashDock')?.classList.remove('active', 'remove-over');
      slot.classList.remove('dragging');
      if (_dragGhost) { _dragGhost.remove(); _dragGhost = null; }
      if (moved) { _suppressClick = true; setTimeout(() => { _suppressClick = false; }, 0); } // 拖拽过就吞掉收尾 click
      if (onTrash) removeFromTeam(from);
      else if (to >= 0 && to !== from) swapSlots(from, to);
    };
    slot.addEventListener('pointerup', endDrag);
    slot.addEventListener('pointercancel', endDrag);
  });
}

// 幽灵卡片跟随指针（居中对齐指针，避免遮住目标槽位）
function moveGhost(e) {
  if (!_dragGhost) return;
  const r = $('teamContent').getBoundingClientRect();
  _dragGhost.style.left = (e.clientX - r.left) + 'px';
  _dragGhost.style.top = (e.clientY - r.top) + 'px';
}
