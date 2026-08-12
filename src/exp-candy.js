// ===== 经验糖果 =====
import { $, showConfirmBar, updateBackpack, tryLoadPokemonImage, getCurrentView } from './ui.js';
import { gameData, getPokemonByIndex, saveGame, addSystemLog } from './state.js';
import { applyXp } from './train.js';
import { EXP_CANDY_XP, MAX_LEVEL } from './config.js';
import { playLevelUp } from './audio.js';

// 当前场景上下文：null = 场景未打开
let _scene = null; // { rid, fromDetail, from, stock, maxUse, poke, shiny }
function expToCap(lv, curExp) {
  let need = 0;
  for (let l = lv; l < MAX_LEVEL; l++) need += 25 + l * 20;
  return Math.max(0, need - (curExp || 0));
}

// 纯函数模拟：加 amount 经验后到达的 (level, exp)，不改动个体数据（预览用）
function simulateXp(lv, curExp, amount) {
  let exp = (curExp || 0) + amount;
  let level = lv;
  while (level < MAX_LEVEL && exp >= 25 + level * 20) {
    exp -= 25 + level * 20;
    level++;
  }
  if (level >= MAX_LEVEL) exp = 0; // 满级后不再积累经验
  return { level, exp };
}

export function openExpCandyPicker() {
  const from = getCurrentView();
  // 库存为 0 时不响应，不跳转宝可梦列表
  if ((gameData.items['exp-candy'] || 0) <= 0) return;
  import('./roster.js').then(m => m.showRosterPicker({ mode: 'expcandy', from }));
}

export function useExpCandyOn(rid, fromDetail, fromView) {
  const entry = (gameData.roster || []).find(x => x.id === rid);
  if (!entry) return;
  const stock = gameData.items['exp-candy'] || 0;
  if (stock <= 0) return; // 库存 0 不响应（不跳转、不提示）
  const lv = entry.level || 1;
  if (lv >= MAX_LEVEL) {
    showConfirmBar('该宝可梦已满级，无法使用经验糖果', null, null, { singleButton: true });
    return;
  }
  const poke = getPokemonByIndex(String(entry.species));
  const maxUse = Math.max(1, Math.min(stock, Math.ceil(expToCap(lv, entry.exp) / EXP_CANDY_XP)));
  _scene = { rid, fromDetail, from: fromView, stock, maxUse, poke, shiny: !!entry.shiny };
  openScene();
}

function openScene() {
  const view = $('expCandyView');
  if (!view || !_scene) return;
  view._qty = 1;
  const img = $('expCandyImg');
  img.classList.remove('leaving'); // 清除上一次离场动画
  img.src = '';
  $('expCandyBox').style.display = 'none';
  const stage = view.querySelector('.expcandy-stepper');
  if (stage) stage.style.display = 'flex';
  view.style.display = 'flex';
  tryLoadPokemonImage(img, _scene.poke, _scene.shiny ? '_shiny' : '');
  renderScene();
  if (!view._bound) {
    view._bound = true;
    $('expCandyMinus').addEventListener('click', () => {
      if (!_scene) return;
      view._qty = Math.max(1, view._qty - 1);
      renderScene();
    });
    $('expCandyPlus').addEventListener('click', () => {
      if (!_scene) return;
      view._qty = Math.min(_scene.maxUse, view._qty + 1);
      renderScene();
    });
    // max：一键拉满——升满级或耗尽全部库存糖果（maxUse 已取两者较小值）
    $('expCandyMax').addEventListener('click', () => {
      if (!_scene) return;
      view._qty = _scene.maxUse;
      renderScene();
    });
    $('expCandyUse').addEventListener('click', confirmUse);
    $('expCandyOk').addEventListener('click', finishUse);
  }
}

// 按当前数量刷新场景预览：等级变化 + 经验条（不显示名字）
function renderScene() {
  const view = $('expCandyView');
  if (!view || !_scene) return;
  const s = _scene;
  const qty = view._qty;
  const entry = (gameData.roster || []).find(x => x.id === s.rid);
  if (!entry) return;
  const curLv = entry.level || 1;
  const curExp = entry.exp || 0;
  const after = simulateXp(curLv, curExp, EXP_CANDY_XP * qty);
  $('expCandyLv').textContent = `Lv${curLv} → Lv${after.level}`;
  // 经验条：满级显示满，否则显示模拟后的当前等级经验进度
  const need = after.level >= MAX_LEVEL ? 1 : 25 + after.level * 20;
  const pct = after.level >= MAX_LEVEL ? 100 : Math.min(100, (after.exp / need) * 100);
  $('expCandyExpFill').style.width = pct.toFixed(1) + '%';
  $('expCandyQty').textContent = qty;
  $('expCandyMinus').disabled = qty <= 1;
  $('expCandyPlus').disabled = qty >= s.maxUse;
}

// 确认使用：扣库存 → 应用经验 → 记档 → 收起加减组件，文案框弹出显示等级变化
function confirmUse() {
  const view = $('expCandyView');
  if (!view || !_scene) return;
  const s = _scene;
  const entry = (gameData.roster || []).find(x => x.id === s.rid);
  if (!entry) return;
  const qty = Math.max(1, Math.min(s.maxUse, view._qty || 1));
  const before = entry.level || 1;
  gameData.items['exp-candy'] = s.stock - qty;
  applyXp(entry, EXP_CANDY_XP * qty);
  // 等级/经验变化：通知交换按钮、手机红点等依赖仓库状态的界面刷新
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('roster-changed'));
  // 只有真正升级才播放升级音效（音乐类，仅音乐总开关控制）
  if ((entry.level || 1) > before) playLevelUp();
  addSystemLog('exp_candy_use', { pokemon: entry.species, qty, level: entry.level || 1 });
  saveGame();
  updateBackpack('exp-candy');
  // 结算完成：收起加减组件，等级显示最终值，底部文案框弹出（点「确定」后关闭场景）
  const stage = view.querySelector('.expcandy-stepper');
  if (stage) stage.style.display = 'none';
  $('expCandyLv').textContent = `Lv${before} → Lv${entry.level || 1}`;
  $('expCandyExpFill').style.width = '100%';
  const pname = entry.nickname || s.poke?.name || `#${entry.species}`;
  $('expCandyText').innerHTML = `${pname} 升到 ${entry.level || 1} 级了！`;
  $('expCandyBox').style.display = 'flex';
}

// 点「确定」：关闭场景并返回仓库选取列表（可继续给其它宝可梦使用，列表返回才回来源页）
function finishUse() {
  const view = $('expCandyView');
  if (!view || !_scene) return;
  const s = _scene;
  const fromDetail = s.fromDetail;
  const rid = s.rid;
  closeScene();
  // 结算后返回：详情入口刷新详情页，选取入口回到仓库选取列表
  if (fromDetail) import('./roster.js').then(m => m.refreshRosterDetail(rid));
  else import('./roster.js').then(m => m.showRosterPicker({ mode: 'expcandy', from: s.from }));
}

// 关闭场景
function closeScene() {
  const view = $('expCandyView');
  if (!view) return;
  view.style.display = 'none';
  _scene = null;
}

// 场景内 appTitle 返回：取消并关闭场景，详情入口留详情页，选取入口回到仓库选取列表
export function cancelExpCandyScene() {
  const view = $('expCandyView');
  if (!view || !_scene) return;
  const s = _scene;
  closeScene();
  if (s.fromDetail) return;
  import('./roster.js').then(m => m.showRosterPicker({ mode: 'expcandy', from: s.from }));
}
