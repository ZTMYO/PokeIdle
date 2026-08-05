﻿﻿﻿﻿﻿﻿﻿﻿﻿// 流程：NPC 列表 → 自动编队（仓库中等级最高 6 只）→ 回合制战斗（动画）→ 结算（经验/糖果）
// 与挂机主循环解耦：战斗只在手机 App 内进行，不影响地图/遇敌/离线
import { $, showView, tryLoadPokemonImage, tryLoadPokemonIcon } from './ui.js';
import { gameData, getPokemonByIndex, addSystemLog, saveGame, setPrevView, setPhase } from './state.js';
import { createMon, useMove, preTurn, postTurn, aiMove } from './battle-core.js';
import { typeMult } from './type-chart.js';
import { chooseMoves } from './moves.js';
import { ensureNpcs, buildNpcTeam } from './npcs.js';
import { BATTLE_REFRESH_MS, MAX_LEVEL } from './config.js';
import { playBattle, endBattle, playVictory, stopVictory } from './audio.js';
import * as road from './road.js';

// 18 属性标签色（与图鉴/遇敌一致）
export const TYPE_COLORS = {
  '一般': '#B5B4AF', '格斗': '#BE4D47', '飞行': '#81b9ef', '毒': '#8943B0',
  '地面': '#9C5A59', '岩石': '#D3A865', '虫': '#9CAE1E', '幽灵': '#704170',
  '钢': '#60a1b8', '火': '#E75357', '水': '#3F98EA', '草': '#3fa129',
  '电': '#F9CE40', '超能': '#F8669C', '冰': '#3fd8ff', '龙': '#5060e1',
  '恶': '#61484B', '妖精': '#E259E7',
};

let _data = null;
let _learnset = null;
let _busy = false; // 战斗动画播放中禁止操作
let _activeBattle = null; // 当前战斗（标题栏撤退 / 挂起选择用）
let _pendingAsk = null;   // 挂起的玩家选择 resolve（撤退时强制结束）
let _fleeing = false;     // 已请求撤退

// 异常状态 → 展示名称（状态圆点颜色取造成该状态的招式属性色，见 renderMon）
const STATUS_NAMES = {
  paralysis: '麻痹', sleep: '睡眠', poison: '中毒',
  burn: '灼伤', freeze: '冰冻', confusion: '混乱',
};
// 能力等级顺序（与 createMon 的 stages 数组一致）：0攻 1防 2特攻 3特防 4速
const STAT_NAMES = ['攻击', '防御', '特攻', '特防', '速度'];

// 招式类别中文名与判定（物理/特殊/变化；伤害类招式按 effect.cat 归类），与配招页同款
const MOVE_CAT_CN = { phys: '物理', spec: '特殊', status: '变化' };
function moveCat(mv) {
  const ef = mv.effect || {};
  if (ef.kind === 'damage' || ef.kind === 'multihit' || ef.kind === 'drain' || ef.kind === 'recoil' || ef.kind === 'fixed') {
    return ef.cat === 'spec' ? 'spec' : 'phys';
  }
  return 'status';
}

// 战斗是否进行中（标题栏返回判断）
export function isBattleActive() {
  return !!_activeBattle;
}

// 撤退（由标题栏返回触发）：结束挂起选择并中断战斗循环
export function retreatBattle() {
  if (!_activeBattle) return;
  _fleeing = true;
  if (_pendingAsk) {
    _pendingAsk({ type: 'flee' });
    _pendingAsk = null;
  } else {
    doRetreat(_activeBattle); // 动画阶段：直接撤退，循环在下一处暂停点退出
  }
}

function doRetreat(battle) {
  if (_activeBattle !== battle) return; // 防重复执行
  _activeBattle = null;
  battle.winner = null;
  endBattle(); // 撤退 → 停止战斗曲，恢复地区曲
  showBattleView();
  addSystemLog('战斗', `与「${battle.preset.name}」的战斗中撤退了。`);
}

// 可中断暂停：撤退请求时抛错中断战斗循环，避免继续操作已销毁的战斗 DOM
class BattleFled extends Error {}

// 战斗精灵按身高缩放：1.0m（10 分米）为 1 倍参照；1m 以下线性、以上开方曲线放缓，夹取到安全范围
const SPRITE_REF_H = 10;   // 参照身高（分米）＝ 1 倍
const SPRITE_BASE_H = 50;  // 参照身高对应的基准像素高度
const SPRITE_MIN = 0.35;   // 缩放下限：极矮宝可梦不至于小到看不见
const SPRITE_MAX = 2.0;    // 缩放上限：最高 100px，精灵向上生长不挤 UI
const SPRITE_MAX_W = 120;  // 宽度上限：宽体宝可梦（如长翅鸥 143×24）防止横向溢出

// 按真实身高缩放战斗精灵，并让脚部对齐地面底座、底座跟随精灵横向中心
function applySpriteSize(img, side, pd) {
  const h = pd && pd.height ? pd.height : SPRITE_REF_H;
  // 1m 以下线性保持精确比例；以上开方放缓，避免 20m 之类的极端身高直接顶满布局
  const s = h <= SPRITE_REF_H ? h / SPRITE_REF_H : Math.sqrt(h / SPRITE_REF_H);
  const scale = Math.max(SPRITE_MIN, Math.min(SPRITE_MAX, s));
  let px = Math.round(SPRITE_BASE_H * scale); // 高度目标（像素）
  let w = px;
  if (img.naturalWidth && img.naturalHeight) {
    const aspect = img.naturalWidth / img.naturalHeight;
    w = Math.round(px * aspect);
    // 宽体宝可梦（如长翅鸥）按高度推算出的宽度可能远超封顶：宽度设限并反推高度保持比例
    if (w > SPRITE_MAX_W) {
      w = SPRITE_MAX_W;
      px = Math.max(8, Math.round(SPRITE_MAX_W / aspect));
    }
  }
  img.style.height = px + 'px';
  img.style.width = w + 'px';
  // 我方图片包在 .b-flip 容器里，对齐该容器底部（图片自身 margin-bottom 已负责脚部对齐底座）；
  // 敌方图片是盒子直接子元素，对齐盒子底部
  const flip = img.closest('.b-flip');
  if (flip) {
    flip.style.alignSelf = 'flex-end';
  } else {
    img.style.alignSelf = 'flex-end';
  }
  // 底座横向跟随精灵中心（敌方贴右、我方贴左，间距与图片 margin 一致）
  const base = $(side === 'be' ? 'be-base' : 'bp-base');
  if (base) {
    if (side === 'be') base.style.right = (14 + w / 2) + 'px';
    else base.style.left = (8 + w / 2) + 'px';
  }
}
const battleSleep = (ms) => new Promise((res, rej) => {
  setTimeout(() => {
    if (_fleeing) rej(new BattleFled());
    else res();
  }, ms);
});

async function ensureData() {
  if (_data && _learnset) return;
  const [d, l] = await Promise.all([
    fetch('./pokemon-data/moves.json').then((r) => r.json()),
    fetch('./pokemon-data/learnset.json').then((r) => r.json()),
  ]);
  _data = d;
  _learnset = l;
}

// 升级经验需求（简化曲线）
const expNeed = (lv) => 25 + lv * 20;

// 实际可用队伍：过滤已放生等失效 id 后仍有成员才算有队伍
function hasBattleTeam() {
  if (!Array.isArray(gameData.team)) return false;
  const valid = new Set((gameData.roster || []).filter(p => p.inRoster !== false).map(p => p.id));
  return gameData.team.some(id => valid.has(id));
}

// ---------- NPC 列表页 ----------
export async function showBattleView() {
  stopVictory(); // 返回对战列表：若胜利音效还在播则立即停止并恢复背景曲（无播放时无副作用）
  await ensureData();
  setPrevView('phoneView');
  // 回到对战列表：清除战斗期间的屏幕难度边框色
  const sc = $('screen');
  sc.classList.remove('t-novice', 't-veteran', 't-champion');
  renderBattleList();
  showView('battleView');
  startRefreshCountdown();
}

function renderBattleList() {
  const box = $('battleContent');
  if (!box) return;
  const { list } = ensureNpcs();
  box.innerHTML = `
    <div class="battle-app">
      <div id="battleRefreshTip">距离下一波刷新：${refreshText()}</div>
      <div class="battle-npc-list">
        ${list.map(npcCardHtml).join('')}
      </div>
    </div>`;
  box.querySelectorAll('.npc-item').forEach((el) => {
    el.addEventListener('click', () => startNpcBattle(el.dataset.id));
  });
}

// 距下一波刷新剩余时间文案（与交换页同款）
function refreshText() {
  const left = Math.max(0, BATTLE_REFRESH_MS - (Date.now() - (gameData.battleNpcs?.refreshedAt || 0)));
  const s = Math.ceil(left / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}时${m}分${sec}秒` : `${m}分${sec}秒`;
}

// 每秒更新顶部倒计时；到点自动刷新一波
function startRefreshCountdown() {
  if (startRefreshCountdown._timer) return;
  startRefreshCountdown._timer = setInterval(() => {
    if ($('battleView')?.style.display === 'none') {
      clearInterval(startRefreshCountdown._timer);
      startRefreshCountdown._timer = null;
      return;
    }
    if (_busy) return; // 战斗中不刷新
    if (BATTLE_REFRESH_MS - (Date.now() - (gameData.battleNpcs?.refreshedAt || 0)) <= 0) {
      renderBattleList(); // 到点生成新一波
      return;
    }
    const t = $('battleRefreshTip');
    if (t) t.textContent = `距离下一波刷新：${refreshText()}`;
  }, 1000);
}

function npcCardHtml(npc) {
  const gd = gameData;
  const maxLv = (gd.roster || []).reduce((m, p) => Math.max(m, p.level || 1), 1);
  const base = Math.max(3, Math.min(60, maxLv + npc.lvBonus));
  // NPC 首帧拼图（npcs.png：13列×2行，每格 16×21，2x 显示），按下标定位（与交换页同款）
  const npcIdx = npc.sprite ?? 0;
  const npcPos = `background-position:${-(npcIdx % 13) * 32}px ${-Math.floor(npcIdx / 13) * 42}px`;
  return `
    <div class="npc-item" data-id="${npc.id}">
      <div class="npc-info">
        <div class="npc-sprite" style="${npcPos}"></div>
        <div class="npc-desc">
          <div class="npc-title-row">
            <span class="npc-title t-${npc.tier}">${npc.title}</span>
            <span class="npc-name">${npc.name}</span>
          </div>
          <div class="npc-meta">队伍 ${npc.mons.length} 只 · 约 Lv${base} 上下</div>
          <div class="npc-reward">胜 +${npc.candy} 糖果</div>
        </div>
      </div>
    </div>`;
}

// ---------- 我方/敌方队伍构建 ----------
function buildPlayerTeam() {
  const gd = gameData;
  const all = (gd.roster || []).filter((p) => p.inRoster !== false);
  // 优先使用配队（gameData.team 中的 entry id，按保存顺序）；失效/放生的 id 自动过滤
  const byId = new Map(all.map((p) => [p.id, p]));
  const ids = Array.isArray(gd.team) ? gd.team.filter((id) => byId.has(id)) : [];
  const entries = ids.slice(0, 6).map((id) => byId.get(id));
  const picked = new Set(entries.map((e) => e.id));
  // 不足 6 只按等级补齐
  if (entries.length < 6) {
    const rest = all
      .filter((p) => !picked.has(p.id))
      .sort((a, b) => (b.level || 1) - (a.level || 1));
    entries.push(...rest.slice(0, 6 - entries.length));
  }
  if (!entries.length) {
    entries.push(...all.sort((a, b) => (b.level || 1) - (a.level || 1)).slice(0, 6));
  }
  return entries.map((entry) => {
    const pd = getPokemonByIndex(entry.species);
    // 手动配过招（entry.moves）优先使用（保留空位），否则按等级自动配招
    const moveIds = Array.isArray(entry.moves) && entry.moves.length
      ? [0, 1, 2, 3].map((i) => {
          const m = entry.moves[i];
          return m && _data.moves[m] && _data.moves[m].effect.kind !== 'unimplemented' ? m : null;
        })
      : chooseMoves(_learnset[entry.species], entry.level, _data, { types: pd ? pd.types : [] });
    return (() => {
      const mon = createMon(pd, entry.level || 1, entry.ivs, entry.nature, moveIds);
      mon.shiny = !!entry.shiny; // 战斗大图按闪光贴图（_shiny 后缀）加载
      return { entry, pd, mon };
    })();
  });
}

// ---------- 战斗 ----------
async function startNpcBattle(npcId) {
  await ensureData();
  if (_busy) return;
  const npc = (ensureNpcs().list || []).find((n) => n.id === npcId);
  if (!npc) return;
  // 点击 NPC 开始挑战前校验队伍：为空则跳转配队页并底部提示（返回键回对战列表）
  if (!hasBattleTeam()) {
    import('./team.js').then((m) => m.showTeamView('队伍为空，请先配好队伍再挑战！', 'battleView'));
    return;
  }
  const pTeam = buildPlayerTeam();
  if (!pTeam.length) return;
  const eTeam = buildNpcTeam(npc, _data, _learnset).map((x) => ({
    pd: x.pd, mon: createMon(x.pd, x.level, x.ivs, x.nature, x.moveIds),
  }));
  const battle = { preset: npc, pTeam, eTeam, pIdx: 0, eIdx: 0, winner: null, round: 1 };
  _activeBattle = battle;
  _fleeing = false;
  setPhase('battle'); // 战斗中：主界面道路暂停切段/骑行切换，避免挂机 BGM 覆盖战斗曲
  renderBattlePage(battle);
  playBattle(); // 进入 NPC 挑战 → 切换为战斗曲（覆盖地区曲）
  await battleLoop(battle);
}

function curMon(battle, side) {
  return side === 'p' ? battle.pTeam[battle.pIdx].mon : battle.eTeam[battle.eIdx].mon;
}
// 换人：优先下一只存活，队尾之后从队首回绕；无存活返回 false（失败条件＝全灭，与当前下标无关）
function nextMon(battle, side) {
  const team = side === 'p' ? battle.pTeam : battle.eTeam;
  const cur = side === 'p' ? battle.pIdx : battle.eIdx;
  for (let i = cur + 1; i < team.length; i++) {
    if (team[i].mon.hp > 0) { if (side === 'p') battle.pIdx = i; else battle.eIdx = i; return true; }
  }
  for (let i = 0; i < cur; i++) {
    if (team[i].mon.hp > 0) { if (side === 'p') battle.pIdx = i; else battle.eIdx = i; return true; }
  }
  return false;
}
// 该侧是否还有存活宝可梦（当前倒下者 hp=0 天然被排除）
function hasAlive(battle, side) {
  const team = side === 'p' ? battle.pTeam : battle.eTeam;
  return team.some((x) => x.mon.hp > 0);
}
// 我方倒下后弹出队伍选择下一只上场（复用配队页替换逻辑）；撤退时以 -1 强制结束
function promptSwitchAfterFaint(battle) {
  return new Promise((resolve) => {
    _pendingAsk = () => { // 撤退：结束挂起的选择，交由循环判定
      _pendingAsk = null;
      resolve(-1);
    };
    import('./team.js').then((m) => {
      // 选择过程中已撤退：不再弹出队伍界面，直接结束
      if (_activeBattle !== battle || _fleeing) { resolve(-1); return; }
      m.showTeamViewForBattle(battle.pTeam, battle.pIdx, (idx) => {
        _pendingAsk = null;
        resolve(idx);
      });
    });
  });
}

function renderBattlePage(battle) {
  const box = $('battleContent');
  // 战斗期间屏幕边框按 NPC 难度着色（返回对战列表时清除）
  const sc = $('screen');
  sc.classList.remove('t-novice', 't-veteran', 't-champion');
  if (battle.preset.tier) sc.classList.add('t-' + battle.preset.tier);
  box.innerHTML = `
    <div class="battle-fight t-${battle.preset.tier}">
      <div class="battle-stage-top">
        <div class="b-enemy-box" id="be-box">
          <div class="b-info">
            <div class="b-panel">
              <div class="b-meta-row">
                <div class="b-name-row">
                  <div class="b-name" id="be-name"></div>
                  <div class="b-lv" id="be-lv"></div>
                </div>
                <div class="b-types" id="be-types"></div>
              </div>
              <div class="b-hp"><i id="be-hp"></i></div>
            </div>
            <div class="b-team" id="be-team"></div>
          </div>
          <span class="b-base" id="be-base"></span>
          <img id="be-img" alt="">
        </div>
        <div class="b-player-box" id="bp-box">
          <span class="b-base" id="bp-base"></span>
          <div class="b-flip"><img id="bp-img" alt=""></div>
          <div class="b-info">
            <div class="b-panel">
              <div class="b-meta-row">
                <div class="b-name-row">
                  <div class="b-name" id="bp-name"></div>
                  <div class="b-lv" id="bp-lv"></div>
                </div>
                <div class="b-types" id="bp-types"></div>
              </div>
              <div class="b-hp"><i id="bp-hp"></i></div>
            </div>
            <div class="b-team" id="bp-team"></div>
          </div>
        </div>
      </div>
      <div class="b-bottom">
        <div class="b-left">
          <div class="b-text" id="b-text"></div>
          <div class="b-cmd" id="b-cmd"></div>
        </div>
        <div class="b-right" id="b-right">
          <div class="b-actions" id="b-actions"></div>
          <div class="b-right-info" id="b-right-info">
            <div class="b-npc-name" id="b-npc-name"></div>
            <div class="b-round">回合 <span id="b-round">1</span></div>
          </div>
        </div>
      </div>
    </div>`;
  $('b-npc-name').textContent = battle.preset.name;
  renderMon(curMon(battle, 'p'), 'bp');
  renderMon(curMon(battle, 'e'), 'be');
  renderTeamInfo(battle);
  setText(`${battle.preset.name} 发起了挑战！`);
}

// 队伍剩余数量：显示两侧各自存活的宝可梦数（精灵球图标，复用游戏已捕获标记 icon-owned）
function renderTeamInfo(battle) {
  const ball = (n) => '<svg class="b-ball"><use xlink:href="./icons/sprites.svg#icon-owned"></use></svg>'.repeat(Math.max(0, n));
  $('be-team').innerHTML = ball(battle.eTeam.filter((x) => x.mon.hp > 0).length);
  $('bp-team').innerHTML = ball(battle.pTeam.filter((x) => x.mon.hp > 0).length);
}

function renderMon(mon, side) {
  const pd = getPokemonByIndex(mon.idx);
  const img = $(`${side}-img`);
  // 清除上一只残留的战斗动画类（faint 带 forwards 会停在不可见状态；其余互斥类按 CSS 后定义覆盖）
  img.classList.remove(...B_ANIM_CLS);
  // 战斗大图优先，失败回退小图标；闪光个体使用 _shiny 贴图（路径含中文，走 tryLoad 的编码/兜底加载）
  tryLoadPokemonImage(img, pd, mon.shiny ? '_shiny' : '').then(ok => {
    if (!ok) tryLoadPokemonIcon(img, pd);
    applySpriteSize(img, side, pd); // 按真实身高缩放（仅战斗页生效）
  });
  const nameEl = $(`${side}-name`);
  nameEl.textContent = mon.name;
  if (mon.shiny) { // 闪光个体：名字后追加星标（复用图鉴/仓库的闪光星 SVG）
    nameEl.insertAdjacentHTML('beforeend', '<svg class="roster-shiny" viewBox="0 0 1024 1024" width="10" height="10" style="flex-shrink:0;vertical-align:-2px;transform:translateY(-2px);"><use xlink:href="./icons/sprites.svg#icon-star"/></svg>');
  }
  $(`${side}-lv`).textContent = `Lv${mon.level}`;
  // 属性后追加异常状态圆点（自制 tooltip 显示状态名，跟随鼠标）；颜色取造成该状态的招式属性
  const stName = mon.status ? STATUS_NAMES[mon.status] : null;
  const statusDot = stName ? `<span class="b-status-dot" style="background:${TYPE_COLORS[mon.statusType] || '#888'}" data-tip="${stName}"></span>` : '';
  // 能力升降圆点（颜色随造成变化的招式属性），tooltip 显示如「防御-1」
  const statDots = (mon.stages || []).map((v, i) => {
    if (!v) return '';
    const c = TYPE_COLORS[mon.stageTypes[i]] || '#888';
    return `<span class="b-status-dot" style="background:${c}" data-tip="${STAT_NAMES[i]}${v > 0 ? '+' : ''}${v}"></span>`;
  }).join('');
  $(`${side}-types`).innerHTML = `<span class="b-status-area">${mon.types.map((t) => `<span class="b-type" style="background:${TYPE_COLORS[t]}">${t}</span>`).join('')}${statDots}${statusDot}</span>`;
  const pct = Math.max(0, Math.round((mon.hp / mon.maxHp) * 100));
  const bar = $(`${side}-hp`);
  bar.style.width = pct + '%';
  bar.className = pct < 30 ? 'low' : pct < 60 ? 'mid' : '';
  bar.style.background = pct < 30 ? '#f95a4c' : pct < 60 ? '#fce653' : '#2cb065';
  // 血条容器记录当前血量数值，hover 时自制 tooltip 显示（随 renderMon 刷新）
  const hpBox = bar.closest('.b-hp');
  if (hpBox) hpBox.dataset.tip = `${mon.hp}/${mon.maxHp}`;
}

function setText(t) {
  hideRight(); // 动画播放期间隐藏右栏（操作按钮 + NPC 信息），左栏拉满全宽显示文本
  $('b-text').textContent = t;
}
// 底部右栏（操作按钮 + NPC/回合信息）：仅玩家需要操作时显示，动画播放期间整体隐藏
function showRight() { const el = $('b-right'); if (el) el.style.display = ''; }
function hideRight() { const el = $('b-right'); if (el) el.style.display = 'none'; }
// 战斗动画互斥：lunge/hit/faint 同时存在时会按 CSS 后定义者覆盖，取动画前必须清掉全部
const B_ANIM_CLS = ['lunge', 'lunge-attack', 'hit', 'faint'];
function resetAnim(el) {
  el.classList.remove(...B_ANIM_CLS);
}
function lunge(side) {
  const el = $(`${side}-img`);
  resetAnim(el);
  void el.offsetWidth;
  el.classList.add('lunge');
}
// 物理攻击：宝可梦图片大幅冲向对方面前（由 CSS 按我方/敌方分方向）
function lungeAttack(side) {
  const el = $(`${side}-img`);
  resetAnim(el);
  void el.offsetWidth;
  el.classList.add('lunge-attack');
}
function shake(side) {
  const el = $(`${side}-img`);
  resetAnim(el);
  void el.offsetWidth;
  el.classList.add('hit');
}
function popDmg(side, amount, mon) {
  const s = document.createElement('span');
  s.className = 'b-dmg';
  // 伤害占最大 HP 比例高时标红（红=重创）
  if (mon && mon.maxHp > 0 && amount / mon.maxHp >= 0.25) s.classList.add('heavy');
  s.textContent = '-' + amount;
  $(`${side}-box`).appendChild(s);
  setTimeout(() => s.remove(), 900);
}
function popHeal(side, amount) {
  const s = document.createElement('span');
  s.className = 'b-dmg heal';
  s.textContent = '+' + amount;
  $(`${side}-box`).appendChild(s);
  setTimeout(() => s.remove(), 900);
}
function faintAnim(side) {
  const el = $(`${side}-img`);
  resetAnim(el);
  el.classList.add('faint');
}
// 受击火花：在受击宝可梦中心迸发一圈白色像素火花（纯 CSS 动画，无资源依赖）
function spawnHitSpark(side) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const spark = document.createElement('span');
  spark.className = 'b-spark';
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  spark.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  spark.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('i');
    const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.7;
    const dist = 13 + Math.random() * 9;
    p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    spark.appendChild(p);
  }
  box.appendChild(spark);
  setTimeout(() => spark.remove(), 480);
}
// 重创（伤害 ≥25% 最大 HP）：战斗画面整体震动一下
function stageShake() {
  const st = $('battleContent')?.querySelector('.battle-fight');
  if (!st) return;
  st.classList.remove('battle-shake');
  void st.offsetWidth;
  st.classList.add('battle-shake');
}
// 受击侧 HP 面板短暂红闪（配合受击动画的视觉反馈）
function flashHitPanel(side) {
  const panel = $(`${side}-box`)?.querySelector('.b-panel');
  if (!panel) return;
  panel.classList.remove('b-hit-panel');
  void panel.offsetWidth;
  panel.classList.add('b-hit-panel');
  setTimeout(() => panel.classList.remove('b-hit-panel'), 340);
}

// 等待玩家选招；返回行动对象：{type:'move',id} / {type:'switch',idx}（撤退由标题栏返回触发）
// 布局：左栏文案/技能，右栏操作按钮；选招时右栏切换为招式详情 + 返回按钮
function askPlayerMove(battle) {
  return new Promise((resolve) => {
    _pendingAsk = resolve; // 撤退时强制结束挂起的选择
    const done = (act) => { _pendingAsk = null; resolve(act); };
    const pMon = curMon(battle, 'p');
    const cmd = $('b-cmd');
    const actions = $('b-actions');

    setText(`${pMon.name} 想要做什么？`);
    showActions();

    function showActions() {
      actions.className = 'b-actions';
      actions.innerHTML = `
        <button class="b-act" id="act-fight">攻击</button>
        <button class="b-act" id="act-pkm">替换</button>`;
      $('b-text').style.display = '';
      showRight(); // 操作态：显示右栏（NPC 名 + 回合数）
      $('b-right-info').style.display = ''; // 操作按钮态：显示 NPC 名 + 回合数
      $('act-fight').addEventListener('click', showMoves);
      $('act-pkm').addEventListener('click', () => {
        // 去配队页选择上场的宝可梦（复用配队页替换逻辑）
        import('./team.js').then((m) => {
          m.showTeamViewForBattle(battle.pTeam, battle.pIdx, (idx) => {
            showView('battleView');
            if (idx < 0) return; // 取消：保留当前操作按钮，继续选择
            clearBottom();
            done({ type: 'switch', idx });
          });
        });
      });
    }

    // 左下角克制提示：随 hover 的招式刷新（无效/收效甚微/有效/效果绝佳）
    function updateEffHint(mid) {
      const hint = $('b-eff-hint');
      const eMon = curMon(battle, 'e');
      const mv = mid != null ? _data.moves[mid] : null;
      if (!hint || !mv) return;
      const mult = typeMult(mv.type, eMon.types);
      hint.textContent = mult === 0 ? '无效' : mult < 1 ? '收效甚微' : mult === 1 ? '有效' : '效果绝佳';
      hint.className = 'b-eff-hint ' + (mult === 0 ? 'no' : mult < 1 ? 'weak' : mult === 1 ? 'ok' : 'strong');
    }

    function showMoves() {
      const moves = pMon.moves;
      actions.className = 'b-actions detail';
      actions.innerHTML = `
        <div class="b-move-detail" id="b-move-detail"></div>
        <div class="b-act-row">
          <span class="b-eff-hint" id="b-eff-hint"></span>
          <button class="b-act" id="act-back">返回</button>
        </div>`;
      $('b-text').style.display = 'none'; // 选招时左栏全给技能，节省空间
      showRight(); // 选招态：右栏显示招式详情 + 返回
      $('b-right-info').style.display = 'none'; // 选招态隐藏 NPC 名 + 回合数
      cmd.innerHTML = moves.map((m) => {
        const mv = m != null ? _data.moves[m] : null;
        const dis = !mv || mv.effect.kind === 'unimplemented' ? ' disabled' : '';
        return `<button class="b-move${dis}" data-move="${m}">
          <span class="b-move-name">${mv ? mv.name : '—'}</span>
          ${mv ? `<span class="b-move-type" style="background:${TYPE_COLORS[mv.type]}">
            <svg class="b-move-type-icon"><use xlink:href="./icons/sprites.svg#icon-type-${mv.type}"></use></svg>
          </span>` : ''}
        </button>`;
      }).join('');
      cmd.querySelectorAll('.b-move').forEach((btn) => {
        btn.addEventListener('mouseenter', () => {
          showMoveDetail(btn.dataset.move);
          updateEffHint(btn.dataset.move);
        });
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          clearBottom();
          done({ type: 'move', id: parseInt(btn.dataset.move, 10) });
        });
      });
      $('act-back').addEventListener('click', () => {
        cmd.innerHTML = '';
        showActions(); // 返回 攻击/宝可梦 选择
      });
    }

    function showMoveDetail(mid) {
      const mv = _data.moves[mid];
      const el = $('b-move-detail');
      if (!mv || !el) return;
      el.innerHTML = `
        <div class="b-detail-grid">
          <div class="b-detail-col">
            <div class="b-detail-line"><span>属性</span><b>${mv.type}</b></div>
            <div class="b-detail-line"><span>类型</span><b>${MOVE_CAT_CN[moveCat(mv)]}</b></div>
          </div>
          <div class="b-detail-col">
            <div class="b-detail-line"><span>威力</span><b>${mv.power ?? '—'}</b></div>
            <div class="b-detail-line"><span>命中</span><b>${mv.accuracy ?? '—'}</b></div>
          </div>
        </div>`;
    }

    function clearBottom() {
      cmd.innerHTML = '';
      actions.innerHTML = '';
      $('b-text').style.display = '';
      hideRight(); // 进入动画播放：隐藏右栏（操作按钮 + NPC 信息）
    }
  });
}

// 播放事件：hitRef 为承受伤害方（我方回合=敌方、敌方回合=我方、preTurn/postTurn=自身）
async function playEvents(events, battle, hitRef) {
  const hitSide = hitRef === curMon(battle, 'p') ? 'bp' : 'be';
  const otherSide = hitSide === 'bp' ? 'be' : 'bp';
  for (const ev of events) {
    if (ev.t === 'dmg') {
      popDmg(hitSide, ev.amount, hitRef);
      setText(ev.text || `${ev.who} 受到 ${ev.amount} 点伤害！`);
      renderMon(hitRef, hitSide);
      shake(hitSide); // 渲染后再震：renderMon 会清掉动画类，先渲染才能让受击动画真正播完
      spawnHitSpark(hitSide);
      flashHitPanel(hitSide);
      if (hitRef.maxHp > 0 && ev.amount / hitRef.maxHp >= 0.25) stageShake(); // 重创（占比高）才全屏震动
      await battleSleep(750);
    } else if (ev.t === 'heal') {
      const side = ev.who === hitRef.name ? hitSide : otherSide;
      popHeal(side, ev.amount);
      setText(ev.text);
      renderMon(side === 'bp' ? curMon(battle, 'p') : curMon(battle, 'e'), side);
      await battleSleep(750);
    } else if (ev.t === 'faint') {
      faintAnim(ev.who === hitRef.name ? hitSide : otherSide);
      setText(ev.text);
      await battleSleep(850);
    } else if (ev.t === 'status') {
      setText(ev.text);
      renderMon(hitRef, hitSide); // 立即刷新，属性后显示状态圆点
      shake(hitSide); // 渲染后再震，避免被 renderMon 清掉动画类
      await battleSleep(700);
    } else if (ev.t === 'stat') {
      // 能力升降：立即刷新对应侧，属性后显示能力变化圆点（buff/debuff）
      const side = ev.who === curMon(battle, 'p').name ? 'bp' : 'be';
      const mon = side === 'bp' ? curMon(battle, 'p') : curMon(battle, 'e');
      setText(ev.text);
      renderMon(mon, side);
      await battleSleep(700);
    } else {
      setText(ev.text);
      await battleSleep(700);
    }
  }
}

async function battleLoop(battle) {
  _busy = true;
  try {
    while (!battle.winner && !_fleeing) {
      // 换人检查：我方倒下弹出队伍选择下一只；敌方自动换下一只存活
      if (curMon(battle, 'p').hp <= 0) {
        if (!hasAlive(battle, 'p')) { battle.winner = 'e'; break; }
        const idx = await promptSwitchAfterFaint(battle);
        if (_fleeing) break;
        if (idx < 0) continue; // 取消：回到换人检查，重新弹出选择
        battle.pIdx = idx;
        setText(`${curMon(battle, 'p').name} 上场了！`);
        renderMon(curMon(battle, 'p'), 'bp');
        renderTeamInfo(battle);
        await battleSleep(500);
      }
      if (curMon(battle, 'e').hp <= 0) {
        if (!nextMon(battle, 'e')) { battle.winner = 'p'; break; }
        setText(`${curMon(battle, 'e').name} 上场了！`);
        renderMon(curMon(battle, 'e'), 'be');
        renderTeamInfo(battle);
        await battleSleep(500);
      }

      // 我方回合
      let pMon = curMon(battle, 'p');
      const eMon = curMon(battle, 'e');
      const evs = [];
      if (!preTurn(pMon, evs)) {
        await playEvents(evs, battle, pMon);
      } else {
        const pAct = await askPlayerMove(battle);
        if (pAct.type === 'flee') { // 撤退（标题栏返回触发）
          doRetreat(battle);
          return;
        }
        if (pAct.type === 'switch') { // 换人上场（消耗本回合行动）
          battle.pIdx = pAct.idx;
          pMon = curMon(battle, 'p');
          setText(`${pMon.name} 上场了！`);
          renderMon(pMon, 'bp');
          renderTeamInfo(battle);
          await battleSleep(500);
        } else {
          const mv = _data.moves[pAct.id];
          setText(`${pMon.name} 使用了 ${mv.name}！`);
          if (moveCat(mv) === 'phys') lungeAttack('bp');
          else lunge('bp');
          await battleSleep(430);
          useMove(pMon, eMon, pAct.id, _data, evs);
          await playEvents(evs, battle, eMon);
        }
      }
      if (eMon.hp <= 0 && !hasAlive(battle, 'e')) battle.winner = 'p';
      if (pMon.hp <= 0 && !hasAlive(battle, 'p')) battle.winner = 'e';
      if (battle.winner) break;

      // 敌方回合
      const evs2 = [];
      if (!preTurn(eMon, evs2)) {
        await playEvents(evs2, battle, eMon);
      } else {
        const m = aiMove(eMon, pMon, _data);
        if (m != null) {
          const mv = _data.moves[m];
          setText(`${eMon.name} 使用了 ${mv.name}！`);
          if (moveCat(mv) === 'phys') lungeAttack('be');
          else lunge('be');
          await battleSleep(430);
          useMove(eMon, pMon, m, _data, evs2);
          await playEvents(evs2, battle, pMon);
        }
      }
      if (pMon.hp <= 0 && !hasAlive(battle, 'p')) battle.winner = 'e';
      if (eMon.hp <= 0 && !hasAlive(battle, 'e')) battle.winner = 'p';
      if (battle.winner) break;

      // 回合末持续伤害
      const pEvs = [];
      const eEvs = [];
      postTurn(pMon, pEvs);
      postTurn(eMon, eEvs);
      await playEvents(pEvs, battle, pMon);
      await playEvents(eEvs, battle, eMon);
      if (pMon.hp <= 0 && !hasAlive(battle, 'p')) battle.winner = 'e';
      if (eMon.hp <= 0 && !hasAlive(battle, 'e')) battle.winner = 'p';
      if (battle.winner) break;

      battle.round++;
        $('b-round').textContent = battle.round;
      }
    if (_fleeing) { doRetreat(battle); return; }
    finishBattle(battle);
  } catch (e) {
    if (!(e instanceof BattleFled)) throw e;
    doRetreat(battle); // 撤退请求中断：不结算
  } finally {
    _busy = false;
    _fleeing = false;
    if (_activeBattle === battle) _activeBattle = null;
    setPhase('idle'); // 战斗结束（含撤退/异常）恢复主界面挂机状态
    road.resume(); // 若进战斗前道路被其他流程暂停（如挂机遇敌）未恢复，回到主界面需恢复滚动
  }
}

// ---------- 结算 ----------
function finishBattle(battle) {
  const win = battle.winner === 'p';
  _activeBattle = null; // 战斗已结束：清空活动战斗（后续返回走普通视图切换，不再误判为撤退）
  const gd = gameData;
  const expGain = battle.eTeam.reduce((s, x) => s + x.mon.level, 0) * 8;
  const leveled = [];
  const results = [];
  for (const { entry, mon } of battle.pTeam) {
    if (!win) continue;
    entry.exp = (entry.exp || 0) + expGain;
    let gained = 0;
    while (entry.level < MAX_LEVEL && entry.exp >= expNeed(entry.level)) {
      entry.exp -= expNeed(entry.level);
      entry.level++;
      gained++;
    }
    if (entry.level >= MAX_LEVEL) entry.exp = 0; // 满级后不再积累经验
    results.push({ name: mon.name, lv: entry.level, up: gained });
    if (gained) leveled.push(mon.name);
  }
  if (win) gd.items.candy = (gd.items.candy || 0) + battle.preset.candy;
  if (win && gd.battleNpcs?.list) {
    // 战胜领奖后从当前一波中移除该 NPC
    gd.battleNpcs.list = gd.battleNpcs.list.filter((n) => n.id !== battle.preset.id);
  }
  saveGame();
  addSystemLog('战斗', `${win ? '战胜' : '输给'}了「${battle.preset.name}」${win ? `，获得 ${battle.preset.candy} 糖果` : ''}。`);
  endBattle(); // 战斗结束 → 停止战斗曲，恢复地区曲
  if (win) playVictory(); // 胜利音效（播完自动恢复地区曲）

  const box = $('battleContent');
  box.innerHTML = `
    <div class="battle-app battle-result t-${battle.preset.tier}">
      ${win ? '<button class="battle-result-back" id="b-result-back">返回</button>' : ''}
      <div class="battle-result-title">${win ? '挑战成功！' : '挑战失败…'}</div>
      <div class="battle-result-detail">
        ${win ? results.map((r) => `<div>${r.name} 升级到 Lv${r.lv}${r.up ? `（+${r.up}级）` : ''}</div>`).join('') : '<div>失败无经验，调整队伍或提升等级再来！</div>'}
        ${win ? `<div class="candy-gain">获得 <img class="candy-icon" src="./items/candy.png" alt=""> × ${battle.preset.candy}</div>` : ''}
      </div>
      ${win ? '' : `<div class="battle-result-btns">
        <button class="battle-btn" id="b-retry">再战一次</button><button class="battle-btn main" id="b-back">返回列表</button>
      </div>`}
    </div>`;
  $('b-retry')?.addEventListener('click', () => startNpcBattle(battle.preset.id));
  $('b-back')?.addEventListener('click', () => showBattleView());
  // 胜利结算页左上角返回按钮：返回对战列表
  $('b-result-back')?.addEventListener('click', () => showBattleView());
}
