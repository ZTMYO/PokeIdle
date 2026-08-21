// 派遣 App：把宝可梦派出去探险，按真实时间完成（唯一离线收益来源），完成后带回糖果与道具
// 离线期间派遣照常计时：calcOffline 对派遣槽不做 startAt += ms 后移
import { $, showView, tryLoadImage, showConfirmBar } from './ui.js';
import { gameData, getPokemonByIndex, saveGame, pushNav, addSystemLog, ensureGender, genderBadge, getIncubatorUnlockCost } from './state.js';
import {
  DISPATCH_SLOTS, DISPATCH_FREE_SLOTS, DISPATCH_DURATIONS, DISPATCH_DUR_MULT,
  DISPATCH_CANDY_PER_HOUR, DISPATCH_EXTRA_CHANCE, DISPATCH_SPEED_REF, DISPATCH_SPEED_MIN, DISPATCH_SPEED_MAX, DISPATCH_SPEED_DECAY, DISPATCH_SPEED_FLAT,
  DISPATCH_BASE_WEIGHTS, DISPATCH_TYPE_BOOST, DISPATCH_ITEM_VALUE, DISPATCH_ITEM_CAP,
  DISPATCH_VALUE_PER_HOUR, DISPATCH_PICKS_MAX, REGION_CYCLE, ITEM_NAMES, DISPATCH_BOOST_DISCOUNT, DISPATCH_CANDY_JITTER,
} from './config.js';
import { removePokemonFromAllTeams, isInAnyTeam } from './team.js';
import { grantItem, TYPE_COLORS, ITEM_ICONS } from './items.js';
import { NATURES } from './battle-core.js';
import { matchPinyinPartial } from './pokedex.js';
import { setupSourceFilter, closeAllDropdowns, sourceFilterLabel } from './filters.js';

let _timer = null;

// "放入派遣"全页列表状态（与训练放入页同构）
let _pickSlot = null;          // 当前放入槽位；null = 不在放入页
let _pickPreset = null;        // 替换场景带入的原槽位时长（分钟），放入时沿用
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
let _pickRefreshT = null;
let _pending = null;           // 待出发派遣：{ id, slot }
let _durSel = DISPATCH_DURATIONS[0] * 60; // 时长面板当前选中档（分钟）

// 当前打开的筛选下拉（放入页）
let _openDd = null;
function closeOpenDd() {
  if (!_openDd) return;
  _openDd.dd.style.display = 'none';
  _openDd.trigger.classList.remove('open');
  _openDd = null;
}
document.addEventListener('click', closeOpenDd);

// 保证派遣数据存在并补齐槽位数（兼容旧存档）
export function ensureDispatch() {
  if (!gameData.dispatch || !Array.isArray(gameData.dispatch.slots)) {
    gameData.dispatch = { unlockedSlots: DISPATCH_FREE_SLOTS, slots: [] };
  }
  if (typeof gameData.dispatch.unlockedSlots !== 'number') gameData.dispatch.unlockedSlots = DISPATCH_FREE_SLOTS;
  while (gameData.dispatch.slots.length < DISPATCH_SLOTS) gameData.dispatch.slots.push(null);
  return gameData.dispatch;
}

// 面板速度：种族值 + 个体值 + 性格修正（与战斗能力值公式一致），速度索引 5
function speedOf(entry) {
  const poke = getPokemonByIndex(String(entry.species));
  const base = poke?.stats?.[5] || DISPATCH_SPEED_REF;
  const level = entry.level || 1;
  const iv = entry.ivs?.spe ?? 31;
  let mult = 1;
  const n = NATURES[entry.nature];
  if (n) { if (n.up === 5) mult = 1.1; if (n.down === 5) mult = 0.9; }
  return Math.floor(((2 * base + iv) * level) / 100 + 5) * mult;
}

// 面板速度 → 派遣耗时系数：低速（≤FLAT）按档位满时长，再快收敛到 MIN，永不超过档位时长
function speedMultOf(entry) {
  const s = speedOf(entry);
  if (s <= DISPATCH_SPEED_FLAT) return DISPATCH_SPEED_MAX;
  const ratio = Math.exp(-s / DISPATCH_SPEED_DECAY);
  return Math.max(DISPATCH_SPEED_MIN, Math.min(DISPATCH_SPEED_MAX,
    DISPATCH_SPEED_MIN + (DISPATCH_SPEED_MAX - DISPATCH_SPEED_MIN) * ratio));
}

function durMultOf(durationMin) {
  const idx = DISPATCH_DURATIONS.indexOf(durationMin / 60);
  return idx >= 0 ? DISPATCH_DUR_MULT[idx] : 1;
}

// 该槽实际结束时间戳（含速度系数）
function slotEndAt(slot, entry) {
  return slot.startAt + slot.durationMin * 60000 * speedMultOf(entry);
}

// 按权重抽一个道具 key
function weightedPick(weights) {
  let total = 0;
  for (const v of Object.values(weights)) total += v;
  let r = Math.random() * total;
  for (const [k, v] of Object.entries(weights)) {
    r -= v;
    if (r < 0) return k;
  }
  return Object.keys(weights)[0];
}

// 道具抽取次数随时长增长：每满 4 小时 1 次，另 50% 概率 +1（上限 DISPATCH_PICKS_MAX，返回区间）
function itemPickRange(hours) {
  const lo = Math.min(DISPATCH_PICKS_MAX, Math.max(1, Math.floor(hours / 4)));
  const hi = Math.min(DISPATCH_PICKS_MAX, lo + 1);
  return [lo, hi];
}
function itemPicks(hours) {
  return Math.min(DISPATCH_PICKS_MAX, Math.max(1, Math.floor(hours / 4)) + (Math.random() < DISPATCH_EXTRA_CHANCE ? 1 : 0));
}

// 糖果基准值（档位小时 × 倍率 + 属性糖果侧重），结算与预览共用；结算时另加随机浮动
function candyBase(entry, durationMin) {
  const poke = getPokemonByIndex(String(entry.species));
  const boost = poke ? DISPATCH_TYPE_BOOST[poke.types?.[0]] : null;
  const hours = durationMin / 60;
  const mult = durMultOf(durationMin);
  let candy = Math.max(1, Math.round(DISPATCH_CANDY_PER_HOUR * hours * mult));
  // 属性糖果侧重（一般/岩石/地面）：直接附赠糖果，每 5 权重 → 额外 2 颗/小时
  const candyBoost = boost ? (boost['candy'] || 0) : 0;
  if (candyBoost) candy += Math.round((candyBoost / 5) * hours * 2);
  return candy;
}

// 结算奖励：糖果与道具价值按「所选档位小时」计算（收益与速度无关，速度只影响完成时间），
// 糖果固定给大头；道具按价值反比分配数量：便宜的掉得多（精灵球 10 个）、贵重的掉得少（闪耀护符 1 个）
function rollRewards(entry, durationMin) {
  const poke = getPokemonByIndex(String(entry.species));
  const boost = poke ? DISPATCH_TYPE_BOOST[poke.types?.[0]] : null;
  const weights = { ...DISPATCH_BASE_WEIGHTS };
  if (boost) {
    // 侧重道具外的其他道具权重打折（突出侧重）；糖果侧重无道具增强，但同样让整体道具少一点
    const boosted = Object.keys(boost).filter(k => k !== 'candy');
    for (const k of Object.keys(weights)) {
      if (k !== 'candy' && !boosted.includes(k)) {
        weights[k] = Math.max(1, Math.floor(weights[k] * DISPATCH_BOOST_DISCOUNT));
      }
    }
    for (const [k, v] of Object.entries(boost)) weights[k] = (weights[k] || 0) + v;
  }
  delete weights['candy']; // 糖果固定给大头，不参与道具抽取
  const hours = durationMin / 60; // 档位小时（收益基准，与速度无关）
  // 糖果 = 基准值 ±5% 随机浮动（属性糖果侧重已计入基准）
  let candyCount = candyBase(entry, durationMin);
  candyCount = Math.max(1, Math.round(candyCount * (1 + (Math.random() * 2 - 1) * DISPATCH_CANDY_JITTER)));
  const merged = new Map();
  let budget = DISPATCH_VALUE_PER_HOUR * hours;
  const minUnit = Math.min(...Object.values(DISPATCH_ITEM_VALUE));
  const picks = itemPicks(hours);
  for (let i = 0; i < picks && budget >= minUnit; i++) {
    const k = weightedPick(weights);
    const unit = DISPATCH_ITEM_VALUE[k] || 10;
    const cap = DISPATCH_ITEM_CAP[k] || 5;
    const used = merged.get(k) || 0;
    if (used >= cap) continue; // 该种已满，整次派遣累计封顶，跳过本轮
    let qty = Math.max(1, Math.round((budget / (picks - i) / unit) * (0.6 + Math.random() * 0.8)));
    qty = Math.min(qty, cap - used);
    budget -= qty * unit;
    merged.set(k, used + qty);
  }
  merged.set('candy', candyCount);
  return [...merged].map(([key, qty]) => ({ key, qty }));
}

// 推进完成检测：到点未标记完成的槽置 done 并预计算奖励；放生的清空；返回本次新完成数
export function processDispatch(now = Date.now()) {
  const d = ensureDispatch();
  let changed = false, doneCount = 0;
  for (let i = 0; i < d.slots.length; i++) {
    const slot = d.slots[i];
    if (!slot || slot.done || slot.startAt == null) continue; // 待出发槽不计时
    const entry = (gameData.roster || []).find(x => x.id === slot.id);
    if (!entry || entry.inRoster === false) { d.slots[i] = null; changed = true; continue; }
    if (now - slot.startAt < slotEndAt(slot, entry) - slot.startAt) continue;
    slot.done = true;
    slot.rewards = rollRewards(entry, slot.durationMin);
    addSystemLog('dispatch_done', { pokemon: entry.species, rewards: slot.rewards });
    doneCount++;
  }
  if (doneCount || changed) {
    saveGame();
    if (doneCount) window.dispatchEvent(new Event('dispatch-changed')); // 手机红点即时刷新
  }
  return doneCount;
}

// 是否有完成待领取的派遣（手机红点）
export function hasDispatchRewards() {
  const d = gameData?.dispatch;
  if (!d || !Array.isArray(d.slots)) return false;
  return d.slots.some(s => s && s.done);
}

// 领取结果页单行：宝可梦图标 + 各道具图标与数量
function resultRowHtml(entry, slot) {
  const items = (slot.rewards || []).map(r =>
    `<span class="dispatch-result-item"><img src="./items/${ITEM_ICONS[r.key] || r.key + '.png'}" alt="" /><b>×${r.qty}</b></span>`
  ).join('');
  return `<div class="dispatch-result-row"><img class="dispatch-result-poke" data-icon="${entry.species}" alt="" /><span class="dispatch-result-items">${items}</span></div>`;
}

// 结果页宝可梦图标加载（静态精灵图，与主列表同款）
function loadResultIcons(list) {
  list.querySelectorAll('.dispatch-result-poke').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
}

// 打开领取结果页并绑定确定结算；rows = [{ i, entry, slot }]，确定时统一入包清槽
let _claimAnim = false;
let _savedTitle = null;
function openResultPage(rows) {
  closeDispatchMenu();
  const view = $('dispatchResultView');
  if (!view || !rows.length) return;
  const list = view.querySelector('#dispatchResultList');
  list.innerHTML = rows.map(({ entry, slot }) => resultRowHtml(entry, slot)).join('');
  // 末尾追加道具总计行（所有派遣同类合并）
  const merged = {};
  for (const { slot } of rows) {
    for (const r of slot.rewards || []) merged[r.key] = (merged[r.key] || 0) + r.qty;
  }
  const keys = Object.keys(merged);
  if (keys.length) {
    const totalItems = keys.map(k =>
      `<span class="dispatch-result-item"><img src="./items/${ITEM_ICONS[k] || k + '.png'}" alt="" /><b>×${merged[k]}</b></span>`
    ).join('');
    list.insertAdjacentHTML('beforeend',
      `<div class="dispatch-result-row dispatch-result-total"><span class="dispatch-result-total-label">总</span><span class="dispatch-result-items">${totalItems}</span></div>`);
  }
  loadResultIcons(list);
  view.querySelector('#dispatchResultText').textContent = '派遣完成！';
  // 确定结算：入包清槽、存档、关页并恢复 appTitle
  const okFn = () => {
    if (!_claimAnim) return;
    _claimAnim = false;
    for (const { i, slot } of rows) {
      for (const r of slot.rewards || []) grantItem(r.key, r.qty);
      // 领取后宝可梦留在槽位待出发，可直接下一轮派遣（保留所选时长）
      ensureDispatch().slots[i] = { id: slot.id, durationMin: slot.durationMin, startAt: null, done: false };
    }
    saveGame();
    window.dispatchEvent(new Event('dispatch-changed'));
    window.dispatchEvent(new Event('achievements-changed')); // 领到糖果/道具可能达成成就，即时刷新手机红点
    view.style.display = 'none';
    view.classList.remove('open');
    if (_savedTitle) {
      const t = $('appTitle');
      if (t) {
        t.innerHTML = _savedTitle.html;
        t.dataset.action = _savedTitle.action;
        t.onclick = _savedTitle.onclick;
      }
      _savedTitle = null;
    }
    render();
  };
  view.querySelector('#dispatchResultOk').onclick = okFn;
  // 接管 appTitle：结果页点击返回视为确认（不做二次弹出）。
  // dataset.action 置空，避免 main.js 的 handleAppTitleBack 同时触发 goBack() 把派遣页 pop 掉
  const t = $('appTitle');
  if (t && !_savedTitle) {
    _savedTitle = { html: t.innerHTML, action: t.dataset.action || '', onclick: t.onclick };
    t.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 派遣完成';
    t.dataset.action = '';
    t.onclick = okFn;
  }
  // 显示页面，textbox 下一帧滑出
  view.style.display = 'flex';
  view.classList.remove('open');
  requestAnimationFrame(() => requestAnimationFrame(() => view.classList.add('open')));
  _claimAnim = true;
}

// 领取单个已完成槽：进结果页展示一行（宝可梦图标 + 道具图标），确定后入包清槽
function claimSlot(i) {
  const d = ensureDispatch();
  const slot = d.slots[i];
  if (!slot || !slot.done || _claimAnim) return;
  const entry = (gameData.roster || []).find(x => x.id === slot.id);
  if (!entry || entry.inRoster === false) return;
  openResultPage([{ i, entry, slot }]);
}

// 一键领取全部已完成槽：进结果页多行展示，确定后统一结算
function claimAll() {
  const d = ensureDispatch();
  const rows = [];
  for (let i = 0; i < d.slots.length; i++) {
    const slot = d.slots[i];
    if (!slot || !slot.done) continue;
    const entry = (gameData.roster || []).find(x => x.id === slot.id);
    if (!entry || entry.inRoster === false) continue;
    rows.push({ i, entry, slot });
  }
  if (!rows.length) return;
  openResultPage(rows);
}

// 解锁格子（糖果扣款，价格与孵蛋器一致）
function unlockSlot(i) {
  closeDispatchMenu();
  const d = ensureDispatch();
  const cost = getIncubatorUnlockCost(i);
  if (!cost || i !== d.unlockedSlots) return;
  if ((gameData.items['candy'] || 0) < cost) {
    showConfirmBar('糖果不足，无法解锁派遣格', null, null, { noButtons: true });
    return;
  }
  gameData.items['candy'] -= cost;
  d.unlockedSlots = i + 1;
  addSystemLog('item_use', { item: 'candy', qty: cost, auto: false });
  saveGame();
  render();
}

// 该个体是否在派遣槽中（放入页占用确认用；已完成待领取的也算占用）
export function isDispatchPokemon(id) {
  return ensureDispatch().slots.some(s => s && s.id === id);
}

// 撤离派遣：被放入训练/饲育屋/配队时调用。已完成待领取的保留（奖励已预计算，不算作废），只撤进行中的
export function removeDispatchByPokemon(id) {
  const d = ensureDispatch();
  let changed = false;
  for (let i = 0; i < d.slots.length; i++) {
    const slot = d.slots[i];
    if (slot && slot.id === id && !slot.done) {
      d.slots[i] = null;
      changed = true;
    }
  }
  if (changed) saveGame();
  return changed;
}

// 仓库选取：从列表项放入派遣（空槽点击跳转仓库后由列表项触发）。
// 若该个体正被训练/饲育屋/队伍占用，先弹确认框，确认后才放入（自动撤下原占用方）。
// 放入不选时长：使用默认档，配置面板由槽位「配置」按钮负责
function addToDispatch(id, slot) {
  const d = ensureDispatch();
  if (slot >= d.unlockedSlots) return;
  Promise.all([
    import('./train.js').then(m => m.isTrainingPokemon(id)),
    import('./nursery.js').then(m => m.isNurseryPokemon(id)),
  ]).then(([inTrain, inNursery]) => {
    const occ = [];
    if (inTrain) occ.push('训练');
    if (inNursery) occ.push('饲育屋');
    if (isInAnyTeam(id)) occ.push('队伍');
    if (occ.length) {
      showConfirmBar(`这只宝可梦正在${occ.join('、')}中。派遣将自动将其撤下，确定派出？`, () => { doAddToDispatch(id, slot); }, null, { overlay: true });
      return;
    }
    doAddToDispatch(id, slot);
  });
}

// 确认放入/重设配置：落槽待出发（startAt 为空），点击槽位「出发」后才开始计时。
// durationMin 由配置面板传入（_durSel）；替换场景沿用 _pickPreset，否则默认档
function doAddToDispatch(id, slot, durationMin) {
  const d = ensureDispatch();
  if (slot >= d.unlockedSlots) return;
  const entry = (gameData.roster || []).find(x => x.id === id);
  if (!entry) return;
  d.slots[slot] = { id, durationMin: durationMin || _pickPreset || DISPATCH_DURATIONS[0] * 60, startAt: null, done: false };
  _pending = null;
  _durSel = DISPATCH_DURATIONS[0] * 60;
  removePokemonFromAllTeams(id);
  import('./train.js').then(m => m.removeTrainingByPokemon(id));
  import('./nursery.js').then(m => m.removeNurseryByPokemon(id));
  saveGame();
  _pickSlot = null; // 退出放入页
  _pickPreset = null;
  _pickSearch = '';
  _pickTypeFilter = '';
  _pickRegionFilter = '';
  _pickSrc = '';
  _pickLegend = '';
  _pickShiny = '';
  _pickVariant = '';
  closeDurPanel();
  render();
  showView('dispatchView');
  startTimer();
}

export function showDispatchView() {
  pushNav('dispatchView');
  processDispatch();
  restoreDispatchTitle();
  render();
  showView('dispatchView');
  startTimer();
}

// 恢复派遣页标题（主列表/放入页/详情返回共用）
function restoreDispatchTitle() {
  const title = $('appTitle');
  if (title) {
    title.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 派遣';
    title.dataset.action = 'back';
  }
}

// ---------- 时长选择面板（放入后弹出） ----------
function durMask() {
  let mask = $('dispatchDurMask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'dispatchDurMask';
    mask.style.cssText = 'position:absolute;inset:0;z-index:10;background:transparent;';
    $('dispatchView').appendChild(mask);
    mask.addEventListener('click', closeDurPanel);
  }
  return mask;
}

function durHost() {
  let host = $('dispatchDurHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'dispatchDurHost';
    host.style.display = 'none';
    $('dispatchView').appendChild(host);
  }
  return host;
}

function closeDurPanel() {
  const host = $('dispatchDurHost');
  if (host) { host.innerHTML = ''; host.style.display = 'none'; }
  const mask = $('dispatchDurMask');
  if (mask) mask.style.display = 'none';
  _pending = null;
}

function openDurPanel(id, slot, presetMin) {
  const entry = (gameData.roster || []).find(x => x.id === id);
  if (!entry) return;
  const d = ensureDispatch();
  if (slot >= d.unlockedSlots) return;
  _pending = { id, slot };
  _durSel = presetMin || DISPATCH_DURATIONS[0] * 60;
  const host = durHost();
  host.innerHTML = durPanelHtml(entry);
  host.style.display = '';
  durMask().style.display = '';
  bindDurPanel(host, entry);
}

function durPanelHtml(entry) {
  const poke = getPokemonByIndex(String(entry.species));
  const name = entry.nickname || (poke ? poke.name : `#${entry.species}`);
  const speed = speedOf(entry);
  const mult = speedMultOf(entry);
  const shiny = entry.shiny ? '★' : '';
  return `
    <div class="berry-picker dispatch-dur-panel">
      <div class="berry-picker-head">
        <span class="berry-picker-title">派遣 ${name}${shiny}</span>
        <div class="berry-picker-x" data-dur-close>✕</div>
      </div>
      <div class="dispatch-dur-info">速度 ${Math.round(speed)} · 完成耗时 ×${mult.toFixed(2)}</div>
      <div class="dispatch-dur-row">
        ${DISPATCH_DURATIONS.map((h) => `
          <button class="dispatch-dur-btn${h * 60 === _durSel ? ' active' : ''}" data-dur="${h * 60}">
            <em>${h}h</em>
          </button>`).join('')}
      </div>
      <div class="dispatch-dur-preview" id="dispatchDurPreview"></div>
      <button class="dispatch-dur-start" data-dur-start>确定</button>
    </div>`;
}

function bindDurPanel(host, entry) {
  const btns = [...host.querySelectorAll('.dispatch-dur-btn')];
  const preview = host.querySelector('#dispatchDurPreview');
  const refreshPreview = () => {
    const base = candyBase(entry, _durSel); // 含属性侧重，不含随机浮动
    const lo = Math.floor(base * (1 - DISPATCH_CANDY_JITTER));
    const hi = Math.ceil(base * (1 + DISPATCH_CANDY_JITTER));
    const [pLo, pHi] = itemPickRange(_durSel / 60);
    if (preview) preview.textContent = `糖果 ${lo}~${hi} · 道具 ${pLo}~${pHi} 种`;
  };
  btns.forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _durSel = Number(btn.dataset.dur);
    btns.forEach(b => b.classList.toggle('active', b === btn));
    refreshPreview();
  }));
  host.querySelector('[data-dur-close]')?.addEventListener('click', closeDurPanel);
  host.querySelector('[data-dur-start]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!_pending) return;
    doAddToDispatch(_pending.id, _pending.slot, _durSel);
  });
  refreshPreview();
}

// 出发后的短暂提示（显示预计完成时间）
function openDurHint(entry) {
  const poke = getPokemonByIndex(String(entry.species));
  showConfirmBar(`${entry.nickname || (poke ? poke.name : '')} 出发了！回来会自动结算奖励`, null, null, { noButtons: true });
}

// ---------- 页面渲染（主列表复用孵蛋器 2 列网格；放入页与训练/饲育屋一致） ----------
function render() {
  const box = $('dispatchContent');
  if (!box) return;
  if (_pickSlot != null) { renderPickPage(box); return; }
  const d = ensureDispatch();
  const doneCount = d.slots.filter(s => s && s.done).length;
  const launchCount = d.slots.filter(s => s && !s.done && s.startAt == null).length;
  box.style.padding = '4px 3px'; // 主列表与孵蛋器一致的四周边距
  box.innerHTML = `
    <div class="incubator-head">
      <span></span>
      ${doneCount
        ? `<button class="incubator-log-btn" data-claim-all>一键领取</button>`
        : (launchCount ? `<button class="incubator-log-btn" data-launch-all>一键出发</button>` : '')}
    </div>
    <div class="incubator-grid">
      ${d.slots.map((slot, i) => cellHtml(slot, i, d)).join('')}
    </div>`;
  bindPage(box);
  loadCellIcons(box);
}

function cellHtml(slot, i, d) {
  if (i >= d.unlockedSlots) {
    const cost = getIncubatorUnlockCost(i);
    const isNext = i === d.unlockedSlots;
    const canAfford = (gameData.items['candy'] || 0) >= cost;
    const disabled = !isNext || !canAfford;
    return `
    <div class="incubator-row locked">
      <div class="incubator-lock-icon"><img src="./items/candy.png" alt="" style="width:18px;height:18px;image-rendering:pixelated;opacity:0.5;" /><span class="incubator-lock-cost">×${cost}</span></div>
      <span class="incubator-hatch-text${disabled ? ' disabled' : ''}" data-unlock="${i}" ${disabled ? 'style="pointer-events:none;"' : ''}>解锁</span>
    </div>`;
  }
  const entry = slot && (gameData.roster || []).find(x => x.id === slot.id);
  if (!slot || !entry || entry.inRoster === false) {
    const plus = '<span style="font-size:14px;color:var(--ui-color);transform:translateY(-2px);">+</span>';
    return `
    <div class="incubator-row">
      <div class="incubator-egg-slot" data-slot="${i}" style="cursor:pointer;">${plus}</div>
      <div class="incubator-info"><div class="incubator-name">空派遣格</div></div>
    </div>`;
  }
  if (slot.done) {
    return `
    <div class="incubator-row">
      <div class="incubator-egg-slot has-egg"><img class="dispatch-cell-icon" data-icon="${entry.species}" data-menu="${i}" style="cursor:pointer;" alt="" /></div>
      <div class="incubator-info"></div>
      <span class="incubator-hatch-text hatched" data-claim="${i}">领取</span>
    </div>`;
  }
  if (slot.startAt == null) {
    // 已放入未出发：上方配置/出发按钮，下方显示按速度折算的实际时长
    const hours = slot.durationMin * speedMultOf(entry) / 60;
    const hoursTxt = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
    return `
    <div class="incubator-row">
      <div class="incubator-egg-slot has-egg"><img class="dispatch-cell-icon" data-icon="${entry.species}" data-menu="${i}" style="cursor:pointer;" alt="" /></div>
      <div class="incubator-info">
        <div class="dispatch-launch-actions">
          <span class="incubator-hatch-text" data-config="${i}">配置</span>
          <span class="incubator-hatch-text" data-launch="${i}">出发</span>
        </div>
        <div class="dispatch-launch-time">预计 ${hoursTxt}h</div>
      </div>
    </div>`;
  }
  const endAt = slotEndAt(slot, entry);
  const total = endAt - slot.startAt;
  const remain = Math.max(0, endAt - Date.now());
  const ratio = Math.min(100, Math.max(0, (1 - remain / total) * 100));
  return `
    <div class="incubator-row">
      <div class="incubator-egg-slot has-egg"><img class="dispatch-cell-icon" data-icon="${entry.species}" data-menu="${i}" style="cursor:pointer;" alt="" /></div>
      <div class="incubator-info">
        <div class="incubator-progress-wrap">
          <div class="incubator-progress-fill" data-dfill="${i}" style="width:${ratio.toFixed(1)}%"></div>
          <div class="incubator-progress-text" data-dtime="${i}">${fmtRemain(remain)}</div>
        </div>
      </div>
    </div>`;
}

// ---------- 槽位操作菜单（查看/替换/移除，复用配队样式） ----------
let _menuEl = null;
let _menuSlot = -1;
let _menuSlotEl = null;

function closeDispatchMenu() {
  if (_menuEl) { _menuEl.remove(); _menuEl = null; }
  if (_menuSlotEl) { _menuSlotEl.classList.remove('menu-open'); _menuSlotEl = null; }
  _menuSlot = -1;
}

// 点击有宝可梦的槽位图标弹出操作菜单
function openDispatchMenu(e, i) {
  closeDispatchMenu();
  const d = ensureDispatch();
  const slot = d.slots[i];
  const entry = slot && (gameData.roster || []).find(x => x.id === slot.id);
  if (!slot || !entry || entry.inRoster === false) return;
  const sid = slot.id;
  _menuSlot = i;
  const slotEl = e.currentTarget.closest('.incubator-row');
  if (!slotEl) return;
  slotEl.classList.add('menu-open');
  _menuSlotEl = slotEl;
  const box = $('dispatchContent');
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
    closeDispatchMenu();
    if (act.dataset.menuAct === 'view') {
      // 查看个体详情，返回时恢复派遣主列表
      import('./roster.js').then(m => m.showRosterDetailFromList(sid, () => {
        restoreDispatchTitle();
        render();
        showView('dispatchView');
        startTimer();
      }));
    } else if (act.dataset.menuAct === 'replace') {
      replaceDispatch(idx);
    } else {
      cancelDispatch(idx);
    }
  });
  box.appendChild(menu);
  // 追加后按实际尺寸定位（菜单内容变化时高度随按钮数浮动），固定在槽位中部偏下
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const sr = slotEl.getBoundingClientRect();
  const left = sr.left - r.left + sr.width / 2 - mw / 2;
  const top = sr.top - r.top + sr.height * 0.65;
  menu.style.left = `${Math.max(0, Math.min(left, r.width - mw - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(top, r.height - mh - 4))}px`;
  _menuEl = menu;
}

// 替换该槽位：进入放入页重新选择（确认出发时才覆盖旧槽）
function replaceDispatch(i) {
  const d = ensureDispatch();
  const slot = d.slots[i];
  if (!slot) return;
  // 带入原槽位时长，替换后新宝可梦沿用
  const preset = slot.durationMin;
  if (slot.done) {
    showConfirmBar('该宝可梦已完成派遣，替换将作废其奖励，确定继续？', () => { openDispatchPick({ idx: i, preset }); }, null, { overlay: true });
    return;
  }
  openDispatchPick({ idx: i, preset });
}

// 取消派遣：取出宝可梦直接作废，无任何结果
function cancelDispatch(i) {
  const d = ensureDispatch();
  const slot = d.slots[i];
  if (!slot) return;
  if (slot.done) {
    showConfirmBar('该宝可梦已完成派遣，取消将作废其奖励，确定？', () => {
      d.slots[i] = null;
      saveGame();
      render();
    }, null, { overlay: true });
    return;
  }
  d.slots[i] = null;
  saveGame();
  render();
}

// 待出发槽：点击「出发」才开始派遣（开始计时）
function launchSlot(i) {
  const d = ensureDispatch();
  const slot = d.slots[i];
  if (!slot || slot.done || slot.startAt != null) return;
  const entry = (gameData.roster || []).find(x => x.id === slot.id);
  if (!entry || entry.inRoster === false) return;
  slot.startAt = Date.now();
  addSystemLog('dispatch_start', { pokemon: entry.species, duration: slot.durationMin });
  saveGame();
  render();
}

// 待出发槽：重新打开时长面板调整配置，确定后按新时长重新落槽
function configSlot(i) {
  const d = ensureDispatch();
  const slot = d.slots[i];
  if (!slot || slot.done || slot.startAt != null) return;
  const entry = (gameData.roster || []).find(x => x.id === slot.id);
  if (!entry || entry.inRoster === false) return;
  openDurPanel(entry.id, i, slot.durationMin);
}

// 点击菜单外空白处关闭菜单
document.addEventListener('click', () => { closeDispatchMenu(); });

function fmtRemain(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 1) return `${h}小时${m}分`;
  return `${m}分${s % 60}秒`;
}

// 主页面交互：放入/解锁/领取/一键领取
function bindPage(box) {
  box.querySelectorAll('.incubator-egg-slot[data-slot]').forEach(el => {
    el.addEventListener('click', () => {
      openDispatchPick(Number(el.dataset.slot));
    });
  });
  box.querySelectorAll('[data-menu]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); openDispatchMenu(e, Number(el.dataset.menu)); });
  });
  box.querySelectorAll('[data-launch]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); launchSlot(Number(el.dataset.launch)); });
  });
  box.querySelectorAll('[data-config]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); configSlot(Number(el.dataset.config)); });
  });
  box.querySelectorAll('[data-unlock]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); unlockSlot(Number(el.dataset.unlock)); });
  });
  box.querySelectorAll('[data-claim]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); claimSlot(Number(el.dataset.claim)); });
  });
  box.querySelector('[data-claim-all]')?.addEventListener('click', () => claimAll());
  box.querySelector('[data-launch-all]')?.addEventListener('click', () => launchAll());
}

// 一键出发：启动所有待出发槽
function launchAll() {
  const d = ensureDispatch();
  let changed = false;
  for (let i = 0; i < d.slots.length; i++) {
    const slot = d.slots[i];
    if (!slot || slot.done || slot.startAt != null) continue;
    const entry = (gameData.roster || []).find(x => x.id === slot.id);
    if (!entry || entry.inRoster === false) continue;
    slot.startAt = Date.now();
    addSystemLog('dispatch_start', { pokemon: entry.species, duration: slot.durationMin });
    changed = true;
  }
  if (!changed) return;
  saveGame();
  render();
}

// 加载格子宝可梦图标
function loadCellIcons(root) {
  // 主列表图标（放入列表的行图标走 pickRowHtml 内部分片加载）
  if (_pickSlot != null) return;
  root.querySelectorAll('.dispatch-cell-icon[data-icon]').forEach(img => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
}

// 每秒刷新：推进完成检测、更新剩余时间与进度条
function startTimer() {
  if (_timer) return;
  _timer = setInterval(() => {
    if ($('dispatchView')?.style.display === 'none') { clearInterval(_timer); _timer = null; return; }
    const before = hasDispatchRewards();
    const newly = processDispatch();
    const page = $('dispatchContent');
    if (!page) return;
    if (_pickSlot != null) return; // 放入列表页无需走秒刷新
    if (newly > 0 || before !== hasDispatchRewards()) { render(); return; } // 有新完成的，重建页面显示领取按钮
    // 局部更新剩余时间/进度
    const d = ensureDispatch();
    for (let i = 0; i < d.slots.length; i++) {
      const slot = d.slots[i];
      if (!slot || slot.done || slot.startAt == null) continue;
      const entry = (gameData.roster || []).find(x => x.id === slot.id);
      if (!entry) { render(); return; }
      const t = page.querySelector(`[data-dtime="${i}"]`);
      if (t) t.textContent = fmtRemain(slotEndAt(slot, entry) - Date.now());
      const f = page.querySelector(`[data-dfill="${i}"]`);
      if (f) {
        const endAt = slotEndAt(slot, entry);
        const ratio = Math.max(0, Math.min(100, (1 - (endAt - Date.now()) / (endAt - slot.startAt)) * 100));
        f.style.width = ratio.toFixed(1) + '%';
      }
    }
  }, 1000);
}

// ---------- "放入派遣"全页列表（与训练/饲育屋放入页一致：搜索/筛选/排序/详情，标题栏为「放入」） ----------
function openDispatchPick(slot) {
  _pickSlot = slot;
  if (typeof slot === 'object') { _pickPreset = slot.preset; _pickSlot = slot.idx; }
  else _pickPreset = null;
  render();
}

export function isDispatchPicking() {
  return _pickSlot != null && $('dispatchView')?.style.display !== 'none';
}

export function leaveDispatchPick() {
  if (_pickSlot == null) return;
  _pickSlot = null;
  _pickPreset = null;
  _pickSearch = '';
  _pickTypeFilter = '';
  _pickRegionFilter = '';
  _pickSrc = '';
  _pickLegend = '';
  _pickShiny = '';
  _pickVariant = '';
  closeDurPanel();
  render();
  restoreDispatchTitle();
}

function renderPickPage(box) {
  box.style.padding = '0';
  box.innerHTML = `
    <div class="view-list" style="display:flex;flex-direction:column;flex:1;min-height:0;">
      <div class="pokedex-progress" id="dispatchPickProgress">
        <span id="dispatchPickProgressCount"></span>
      </div>
      <div class="pokedex-search">
        <div class="pokedex-search-row">
          <div class="pokedex-search-input-wrap">
            <input id="dispatchPickSearch" class="pokedex-search-input" type="text" placeholder="搜索宝可梦"
              autocomplete="off" value="${_pickSearch.replace(/"/g, '&quot;')}" />
            <button class="pokedex-search-clear" id="dispatchPickSearchClear" style="${_pickSearch ? '' : 'display:none'}" aria-label="清空搜索">
              <svg><use xlink:href="#icon-close"></use></svg>
            </button>
          </div>
          <div id="dispatchPickSrcFilter" class="pokedex-region-select" tabindex="0" title="按来源筛选">
            <span id="dispatchPickSrcFilterLabel">${sourceFilterLabel({ src: _pickSrc, legend: _pickLegend, shiny: _pickShiny, variant: _pickVariant })}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="dispatchPickSrcFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
          <div id="dispatchPickTypeFilter" class="pokedex-region-select" tabindex="0" title="按属性筛选">
            <span id="dispatchPickTypeFilterLabel">${_pickTypeFilter ? _pickTypeFilter : '属性'}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="dispatchPickTypeFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
          <div id="dispatchPickRegionFilter" class="pokedex-region-select" tabindex="0" title="按地区筛选">
            <span id="dispatchPickRegionFilterLabel">${_pickRegionFilter || '地区'}</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div id="dispatchPickRegionFilterDropdown" class="region-dropdown" style="display:none;"></div>
          </div>
        </div>
      </div>
      <div class="pokedex-header roster-header nursery-pick-header train-pick-header dispatch-pick-header">
        <span class="roster-icon"></span>
        <span class="pokedex-star"></span>
        <span class="pokedex-name" data-sort="name">名称</span>
        <span class="roster-lv-col" data-sort="level">等级</span>
        <span class="roster-iv" data-sort="speed">速度</span>
        <span class="bounty-trade-btn-col">放入</span>
      </div>
      <div class="list-scroll nursery-pick-list train-pick-list dispatch-pick-list">
      </div>
    </div>`;
  const prog = box.querySelector('#dispatchPickProgressCount');
  if (prog) prog.textContent = `共 ${pickCandidates().length} 只可派遣`;
  const title = $('appTitle');
  if (title) {
    title.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 放入';
    title.dataset.action = 'back';
  }
  const list = box.querySelector('.dispatch-pick-list');
  if (list) {
    list.onclick = (e) => {
      const btn = e.target.closest('[data-pick-submit]');
      if (btn) {
        e.stopPropagation();
        addToDispatch(btn.dataset.pickSubmit, _pickSlot);
        return;
      }
      const row = e.target.closest('[data-pick-view]');
      if (!row) return;
      e.stopPropagation();
      _pickListScroll = list.scrollTop;
      import('./roster.js').then(m => m.showRosterDetailFromList(row.dataset.pickView, () => {
        showView('dispatchView');
        render();
        startTimer();
      }));
    };
    renderPickRows(list, () => { list.scrollTop = _pickListScroll; });
  }
  bindPick(box);
  bindPickFilters(box);
}

function pickCandidates() {
  const d = ensureDispatch();
  const exclude = new Set(d.slots.filter(s => s && s.id).map(s => s.id));
  const q = _pickSearch.trim();
  return (gameData.roster || [])
    .filter(p => p.inRoster && !exclude.has(p.id))
    .filter(p => !p.kind || p.kind !== 'egg')
    .filter(p => {
      if (!_pickTypeFilter) return true;
      const poke = getPokemonByIndex(String(p.species));
      return poke?.types?.includes(_pickTypeFilter);
    })
    .filter(p => {
      if (!_pickRegionFilter) return true;
      const poke = getPokemonByIndex(String(p.species));
      return poke?.region === _pickRegionFilter;
    })
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
      } else if (_pickSortBy === 'speed') {
        va = speedOf(a); vb = speedOf(b);
      } else if (_pickSortBy === 'level') {
        va = a.level || 1; vb = b.level || 1;
      } else {
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

function pickRowHtml(p) {
  const poke = getPokemonByIndex(String(p.species));
  const name = p.nickname || (poke ? poke.name : `#${p.species}`);
  const icon = poke?.icon ? `<img class="roster-icon-img" data-icon="${p.species}" alt="" />` : '';
  return `
  <div class="pokedex-entry roster-row bounty-trade-row" data-pick-view="${p.id}">
    <span class="roster-icon">${icon}</span>
    <span class="pokedex-star">${p.shiny ? '★' : ''}</span>
    <span class="pokedex-name">${name}</span>
    <span class="roster-lv-col">${genderBadge(ensureGender(p))}Lv${p.level || 1}</span>
    <span class="roster-iv">${Math.round(speedOf(p))}</span>
    <span class="bounty-trade-btn-col"><button class="bounty-trade-btn" data-pick-submit="${p.id}">放入</button></span>
  </div>`;
}

// 放入列表图标懒加载：进入视口附近才加载，避免一次发出上百个请求打爆 WebView2 资源
let _pickIconObs = null;
function observePickIcons(img) {
  if (!('IntersectionObserver' in window)) {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
    return;
  }
  if (!_pickIconObs) {
    _pickIconObs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        _pickIconObs.unobserve(en.target);
        const poke = getPokemonByIndex(en.target.dataset.icon);
        if (poke?.icon) tryLoadImage(en.target, poke.icon);
      }
    }, { rootMargin: '200px 0px' });
  }
  _pickIconObs.observe(img);
}

// 分片渲染放入列表（与训练同款，避免大仓库一次性渲染卡顿）
function renderPickRows(list, onDone) {
  const sorted = pickCandidates();
  _pickRenderSeq++;
  const seq = _pickRenderSeq;
  list.innerHTML = '';
  if (!sorted.length) {
    list.innerHTML = _pickSearch.trim()
      ? `<div class="roster-trade-empty">没有匹配的宝可梦</div>`
      : `<div class="roster-trade-empty">仓库里没有可以派遣的宝可梦</div>`;
    onDone?.();
    return;
  }
  let i = 0;
  const CHUNK = 40;
  const step = () => {
    if (seq !== _pickRenderSeq || !list.isConnected) return;
    const view = $('dispatchView');
    if (view && view.style.display === 'none') return;
    const rows = [];
    const end = Math.min(i + CHUNK, sorted.length);
    for (; i < end; i++) rows.push(pickRowHtml(sorted[i]));
    list.insertAdjacentHTML('beforeend', rows.join(''));
    const imgs = list.querySelectorAll('.roster-icon-img');
    for (let k = imgs.length - rows.length; k < imgs.length; k++) observePickIcons(imgs[k]);
    if (i < sorted.length) { requestAnimationFrame(step); return; }
    onDone?.();
  };
  requestAnimationFrame(step);
}

function refreshPickList() {
  clearTimeout(_pickRefreshT);
  _pickRefreshT = setTimeout(() => {
    const page = $('dispatchContent');
    if (!page || _pickSlot == null) return;
    const list = page.querySelector('.dispatch-pick-list');
    if (!list) return;
    renderPickRows(list);
    const prog = page.querySelector('#dispatchPickProgressCount');
    if (prog) prog.textContent = `共 ${pickCandidates().length} 只可派遣`;
    markPickSort(page);
  }, 80);
}

function bindPick(root) {
  if (_pickSlot == null) return;
  bindPickPersistent(root);
}

function bindPickPersistent(root) {
  const searchInput = root.querySelector('#dispatchPickSearch');
  const searchClear = root.querySelector('#dispatchPickSearchClear');
  if (searchInput) {
    const doSearch = () => {
      _pickSearch = searchInput.value.trim();
      if (searchClear) searchClear.style.display = _pickSearch ? '' : 'none';
      refreshPickList();
    };
    searchInput.addEventListener('input', doSearch);
    searchClear?.addEventListener('click', () => {
      searchInput.value = '';
      doSearch();
      searchInput.focus();
    });
  }
  root.querySelectorAll('.dispatch-pick-header [data-sort]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const field = el.dataset.sort;
      if (_pickSortBy === field) {
        if (_pickSortDir === 1) _pickSortDir = -1;
        else { _pickSortBy = null; _pickSortDir = 1; }
      } else { _pickSortBy = field; _pickSortDir = 1; }
      refreshPickList();
    });
  });
  markPickSort(root);
}

function markPickSort(root) {
  const header = root.querySelector('.dispatch-pick-header');
  if (!header) return;
  header.querySelectorAll('[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
  const cur = _pickSortBy ? header.querySelector(`[data-sort="${_pickSortBy}"]`) : null;
  if (cur) cur.classList.add(_pickSortDir === 1 ? 'sort-asc' : 'sort-desc');
}

// 三个筛选下拉（属性/地区/来源），只在 renderPickPage 绑定一次
function bindPickFilters(root) {
  const typeTrigger = root.querySelector('#dispatchPickTypeFilter');
  const typeLabel = root.querySelector('#dispatchPickTypeFilterLabel');
  const typeDd = root.querySelector('#dispatchPickTypeFilterDropdown');
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
          refreshPickList();
        });
      });
    }
    typeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = typeDd.style.display !== 'none';
      closeAllDropdowns();
      if (!isOpen) {
        buildTypeOptions();
        typeDd.style.display = '';
        typeTrigger.classList.add('open');
        _openDd = { dd: typeDd, trigger: typeTrigger };
      }
    });
  }
  const regionTrigger = root.querySelector('#dispatchPickRegionFilter');
  const regionLabel = root.querySelector('#dispatchPickRegionFilterLabel');
  const regionDd = root.querySelector('#dispatchPickRegionFilterDropdown');
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
          refreshPickList();
        });
      });
    }
    regionTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = regionDd.style.display !== 'none';
      closeAllDropdowns();
      if (!isOpen) {
        buildRegionOptions();
        regionDd.style.display = '';
        regionTrigger.classList.add('open');
        _openDd = { dd: regionDd, trigger: regionTrigger };
      }
    });
  }
  setupSourceFilter({
    trigger: root.querySelector('#dispatchPickSrcFilter'),
    label: root.querySelector('#dispatchPickSrcFilterLabel'),
    dd: root.querySelector('#dispatchPickSrcFilterDropdown'),
    state: {
      get src() { return _pickSrc; }, set src(v) { _pickSrc = v; },
      get legend() { return _pickLegend; }, set legend(v) { _pickLegend = v; },
      get shiny() { return _pickShiny; }, set shiny(v) { _pickShiny = v; },
      get variant() { return _pickVariant; }, set variant(v) { _pickVariant = v; },
    },
    onPick: refreshPickList,
  });
}

// 调试辅助：DevTools 控制台一键完成所有派遣（window.__finishAllDispatch()）
window.__finishAllDispatch = () => {
  const d = ensureDispatch();
  if (!d || !Array.isArray(d.slots)) return 0;
  let n = 0;
  d.slots.forEach((slot) => {
    if (!slot || slot.done) return;
    const entry = (gameData.roster || []).find(x => x.id === slot.id);
    if (!entry || entry.inRoster === false) return;
    slot.done = true;
    slot.rewards = rollRewards(entry, slot.durationMin);
    n++;
  });
  if (n) {
    saveGame();
    window.dispatchEvent(new Event('dispatch-changed'));
    render();
  }
  console.log(`__finishAllDispatch: ${n} 个派遣已完成`);
  return n;
};