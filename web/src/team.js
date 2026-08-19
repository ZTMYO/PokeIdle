import { $, showView, tryLoadImage } from './ui.js';
import { gameData, getPokemonByIndex, saveGame, pushNav, ensureGender, genderBadge, isPokemon } from './state.js';

export const TEAM_MAX = 6;

// 升级经验需求（与对战结算一致）
const expNeed = (lv) => 25 + lv * 20;

export function teamIds() {
  return Array.isArray(gameData.team) ? gameData.team : [];
}

let _hint = null;       // 底部提示文案（如对战前队伍为空跳转时给出引导）
// 战斗中替换：非空时配队页处于"选择上场宝可梦"模式
let _battleParty = null;   // 出战队伍 [{ entry, pd, mon }]
let _battleFieldIdx = -1;  // 当前场上成员下标（不可替换给自己）
let _battleCb = null;      // 选择回调：idx 为上场下标，-1 表示取消
let _battleCanCancel = false; // 战斗中替换是否可取消：主动替换可取消，宝可梦倒下必须换人
// 拖拽换位状态
let _dragFrom = -1;      // 正在拖拽的源槽位（-1 = 未拖拽）
let _dragTarget = -1;    // 指针当前悬停的目标槽位
let _dragGhost = null;   // 跟随指针的幽灵卡片
let _dragOnTrash = false; // 指针是否位于底部移除停靠区
let _suppressClick = false; // 拖拽结束后抑制本次 click（避免误弹菜单）

export function showTeamView(hint, prev) {
  _hint = hint || null;
  _battleCb = null; _battleParty = null; _battleFieldIdx = -1; _battleCanCancel = false;
  pushNav('teamView'); // 返回由导航栈逐级回来源页（战斗列表/手机主页）
  render();
  showView('teamView');
}

// 仓库选取取消/返回：回到配队页（配队页仍在导航栈中，返回路径不受影响）
export function restoreTeamView() {
  render();
  showView('teamView');
}

// 战斗中替换：进入配队页面，点击成员直接替换场上宝可梦；canCancel=false 表示必须换人（如倒下换下一只），隐藏"返回"按钮
export function showTeamViewForBattle(party, fieldIdx, onPick, canCancel = true) {
  _battleParty = party;
  _battleFieldIdx = fieldIdx;
  _battleCb = onPick;
  _battleCanCancel = canCancel;
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

// 仓库选取：从列表项加入队伍（空槽点击跳转仓库后由列表项触发），按被点击的槽位落位
export function addToTeam(id, slot) {
  const cur = teamIds();
  // 按实际成员数判断满员（数组可能含空位）；已占用的槽位视为替换，不受满员限制
  if ((!cur[slot] && cur.filter(Boolean).length >= TEAM_MAX) || cur.includes(id)) return;
  const next = [...cur];
  next[slot] = id;
  gameData.team = next;
  _hint = null; // 加入成员后不再提示"队伍为空"
  saveGame();
  // 训练/饲育屋/队伍三方互斥：入队后从训练槽与饲育屋移除
  import('./train.js').then(m => m.removeTrainingByPokemon(id));
  import('./nursery.js').then(m => m.removeNurseryByPokemon(id));
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
  const roster = (gameData.roster || []).filter(p => p.inRoster !== false && isPokemon(p));
  const rosterIds = new Set(roster.map(p => p.id));
  // 清理已失效的队伍成员（被放生等）：残留 id 会渲染成空槽却仍被当成非空槽（可拖拽/换位）
  const rawIds = teamIds();
  if (rawIds.some(id => !rosterIds.has(id))) {
    gameData.team = rawIds.filter(id => rosterIds.has(id));
    saveGame();
  }
  const ids = teamIds();
  const byId = new Map(roster.map(p => [p.id, p]));
  const slotPokes = _battleCb
    ? _battleParty.map(x => x.entry) // 战斗替换：直接显示出战队伍
    : ids.map(id => byId.get(id) || null); // 已放生的失效 id 显示为空槽

  box.innerHTML = `
    <div class="team-app">
      <div class="team-party">
        ${[0, 1, 2, 3, 4, 5].map(i => {
          const p = slotPokes[i];
          const disabled = _battleCb && (!p || _battleParty[i].mon.hp <= 0 || i === _battleFieldIdx);
          return slotHtml(i, p, disabled);
        }).join('')}
      </div>
    </div>
    ${_battleCb || _hint ? '' : trashDockHtml()}
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
  // 槽位点击：空槽跳转仓库选择；已有宝可梦弹操作菜单（拖拽换位由 bindDrag 接管）
  box.querySelectorAll('[data-slot]').forEach(slot => {
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_suppressClick) return; // 刚拖拽结束，本次点击只算收尾，不弹菜单
      const i = Number(slot.dataset.slot);
      if (_battleCb) {
        const member = _battleParty[i];
        if (!member || member.mon.hp <= 0 || i === _battleFieldIdx) return;
        const cb = _battleCb;
        _battleCb = null; _battleParty = null; _battleFieldIdx = -1; _battleCanCancel = false;
        showView('battleView');
        cb(i);
        return;
      }
      if (!slotPokes[i]) {
        import('./roster.js').then(m => m.showRosterPicker({ mode: 'team', slot: i, from: 'teamView', exclude: teamIds() }));
        return;
      }
      openTeamMenu(e, i, slotPokes[i]);
    });
  });
  // 空白区域右键：弹出队伍管理菜单（随机配队 / 清空）；战斗替换模式下不提供
  if (!_battleCb) {
    const app = box.querySelector('.team-app');
    app?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation(); // 阻止冒泡到全局右键监听
      if (e.target.closest('.team-member')) return; // 卡片上右键不弹，保持原有行为
      openTeamCtxMenu(e);
    });
  }
  bindDrag(box);
  // 拖拽移除停靠区定位：无页脚时贴底，有页脚（提示条）时停在页脚上方
  const dockEl = $('teamTrashDock');
  if (dockEl) {
    const footer = box.querySelector('.team-footer');
    dockEl.style.bottom = footer ? `${footer.offsetHeight + 2}px` : '0px';
  }
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
// - 队伍未满且已有成员：保留现有成员原位，以队内最低等级为基准，从可选池挑等级最接近的补满空位，
//   等级差相同的候选随机选取。
function autoBuildTeam() {
  const trainingIds = new Set((gameData.training?.slots || []).map((s) => s && s.id).filter(Boolean));
  const roster = (gameData.roster || []).filter((p) => p.inRoster !== false && !trainingIds.has(p.id));
  if (!roster.length) return;
  const byId = new Map(roster.map((p) => [p.id, p]));
  const cur = teamIds();
  const members = cur.map((id) => byId.get(id)).filter(Boolean); // 队内有效成员（放生失效 id 视作空位）
  // 未满员且有至少一只确定宝可梦：补满队伍
  if (members.length > 0 && members.length < TEAM_MAX) {
    const base = Math.min(...members.map((p) => p.level || 1)); // 以队内最低等级为基准
    const used = new Set(cur.filter((id) => byId.has(id)));
    const cands = roster
      .filter((p) => !used.has(p.id))
      .sort((a, b) => (Math.abs((a.level || 1) - base) - Math.abs((b.level || 1) - base)) || Math.random() - 0.5);
    const picks = cands.slice(0, TEAM_MAX - members.length);
    const next = cur.map((id) => (byId.has(id) ? id : null)); // 有效成员保持原位
    let k = 0;
    for (let i = 0; i < TEAM_MAX && k < picks.length; i++) {
      if (!next[i]) next[i] = picks[k++].id;
    }
    while (next.length < TEAM_MAX && k < picks.length) next.push(picks[k++].id);
    gameData.team = next;
    saveGame();
    render();
    return;
  }
  // 空队或满员：整队随机
  const sorted = [...roster].sort((a, b) => (a.level || 1) - (b.level || 1));
  let pick;
  if (sorted.length <= TEAM_MAX) {
    pick = sorted;
  } else {
    // 滑窗寻找等级跨度最小的连续 6 只
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
  gameData.team = team.map((p) => p.id);
  saveGame();
  render();
}

// 清空配队
function clearTeam() {
  gameData.team = [];
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

// 点击宝可梦时在点击位置弹出操作菜单（交换 / 移除）
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
      // 从仓库选一只替换该位置（弹层保留配队页，选完回到配队）
      import('./roster.js').then(m => m.showRosterPicker({ mode: 'team', slot: idx, from: 'teamView', exclude: teamIds() }));
    }
  });
  box.appendChild(menu);
  // 追加后按实际尺寸定位（菜单内容变化时高度随按钮数浮动）
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.max(0, Math.min(e.clientX - r.left, r.width - mw - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(e.clientY - r.top, r.height - mh - 4))}px`;
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
  const cur = teamIds();
  const next = [...cur];
  next[a] = cur[b];
  next[b] = cur[a];
  gameData.team = next;
  saveGame();
  render();
}

// 从队伍移除指定槽位
function removeFromTeam(i) {
  const cur = teamIds();
  gameData.team = cur.filter((_, idx) => idx !== i);
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
