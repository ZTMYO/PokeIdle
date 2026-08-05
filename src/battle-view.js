// 流程：NPC 列表 → 自动编队（仓库中等级最高 6 只）→ 回合制战斗（动画）→ 结算（经验/糖果）
// 与挂机主循环解耦：战斗只在手机 App 内进行，不影响地图/遇敌/离线
import { $, showView, tryLoadPokemonImage, tryLoadPokemonIcon } from './ui.js';
import { gameData, getPokemonByIndex, addSystemLog, saveGame, setPrevView, setPhase, currentEncounter, phase } from './state.js';
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

// 属性特攻特效：命中瞬间按招式属性迸发专属粒子（12 个元素系属性专属，其余属性保留默认白火花）。
// 值为粒子形状类名，颜色直接取 TYPE_COLORS，纯扁平无阴影。
const TYPE_FX = {
  火: 'flame', 水: 'drop', 草: 'leaf', 电: 'spark', 冰: 'ice', 毒: 'bubble',
  地面: 'clump', 岩石: 'rock', 飞行: 'streak', 虫: 'dot', 超能: 'swirl', 龙: 'dragon',
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
  setPhase('idle'); // 撤退恢复主界面挂机状态
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

// 渲染 NPC 挑战列表（供进入页面 / 到点刷新 / 聚合刷新调用）
export function renderBattleList() {
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
  const base = Math.max(3, Math.min(MAX_LEVEL, battleMaxLv() + npc.lvBonus));
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
          <div class="npc-reward">胜 <img class="candy-icon" src="./items/candy.png" alt="">×${npc.candy}</div>
        </div>
      </div>
    </div>`;
}

// ---------- 我方/敌方队伍构建 ----------
// 挑选实际出战的队伍条目：只出配队（gameData.team，按保存顺序）；NPC 难度跟随配队，练新宠只带弱队即可
function pickBattleEntries() {
  const gd = gameData;
  const all = (gd.roster || []).filter((p) => p.inRoster !== false);
  const byId = new Map(all.map((p) => [p.id, p]));
  const ids = Array.isArray(gd.team) ? gd.team.filter((id) => byId.has(id)) : [];
  const entries = ids.slice(0, 6).map((id) => byId.get(id));
  // 配队为空时兜底取仓库最高 6 只（正常流程 hasBattleTeam 已拦截，此处防异常路径）
  if (!entries.length) {
    entries.push(...all.sort((a, b) => (b.level || 1) - (a.level || 1)).slice(0, 6));
  }
  return entries;
}

// 出战队伍最高等级：NPC 难度锚点（带谁打，NPC 就跟随谁；想练新宠只带弱队即可轻松获胜）
function battleMaxLv() {
  return pickBattleEntries().reduce((m, e) => Math.max(m, e.level || 1), 1);
}

function buildPlayerTeam() {
  return pickBattleEntries().map((entry) => {
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
      mon.participated = false; // 经验结算条件：参战（上过场）且存活
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
  const eTeam = buildNpcTeam(npc, _data, _learnset, battleMaxLv()).map((x) => ({
    pd: x.pd, mon: createMon(x.pd, x.level, x.ivs, x.nature, x.moveIds),
  }));
  const battle = { preset: npc, pTeam, eTeam, pIdx: 0, eIdx: 0, winner: null, round: 1 };
  // 进战斗前存在进行中的野生遭遇：转后台异步结算（自动捕捉继续丢球 / 或记录逃跑），
  // 避免 setPhase('battle') 中断遭遇流程导致遇敌直接丢失。
  // 记录打断前的遭遇 phase（setPhase('battle') 后已不可再取）：'encounter' 未出结果，
  // 后台继续捕捉或逃跑；'caught'/'fled' 判定已落库，只交给原流程收尾清理，防止重复捕捉/记录
  const pendingEncounter = (phase === 'encounter' || phase === 'caught' || phase === 'fled') && !!currentEncounter;
  battle._hadPendingEncounter = pendingEncounter;
  battle._pendingEncounterPhase = pendingEncounter ? phase : null;
  _activeBattle = battle;
  _fleeing = false;
  setPhase('battle'); // 战斗中：主界面道路暂停切段/骑行切换，避免挂机 BGM 覆盖战斗曲
  if (battle._hadPendingEncounter) {
    import('./battle.js').then(m => m.handoffEncounterToBackground(battle._pendingEncounterPhase));
  }
  _busy = true; // 开场精灵球登场动画期间也禁止刷新/重进战斗
  const pageReady = renderBattlePage(battle);
  playBattle(); // 进入 NPC 挑战 → 切换为战斗曲（覆盖地区曲）
  await pageReady; // 等双方精灵球登场动画播完再进入回合
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
// 标记当前出战宝可梦为"参战"（经验结算条件之一）
function markParticipated(battle, side) {
  const team = side === 'p' ? battle.pTeam : battle.eTeam;
  const i = side === 'p' ? battle.pIdx : battle.eIdx;
  const m = team[i]?.mon;
  if (m) m.participated = true;
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
      // 倒下必须换人：canCancel=false，配队页不显示"返回"按钮
      m.showTeamViewForBattle(battle.pTeam, battle.pIdx, (idx) => {
        _pendingAsk = null;
        resolve(idx);
      }, false);
    });
  });
}

// 离开战斗页（进入设置等）时清除难度边框色，避免其它页面沿用战斗配色
export function clearBattleTier() {
  const sc = $('screen');
  sc.classList.remove('t-novice', 't-veteran', 't-champion');
}

// 战斗页重新显示（从设置返回等）时恢复当前战斗的难度边框色
export function restoreBattleTier() {
  const sc = $('screen');
  sc.classList.remove('t-novice', 't-veteran', 't-champion');
  if (_activeBattle?.preset?.tier) sc.classList.add('t-' + _activeBattle.preset.tier);
}

async function renderBattlePage(battle) {
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
  const balls = [
    renderMon(curMon(battle, 'p'), 'bp', true),
    renderMon(curMon(battle, 'e'), 'be', true),
  ];
  renderTeamInfo(battle);
  panelIn('bp'); // 开场：双方信息卡片滑入屏幕
  panelIn('be');
  setText(`${battle.preset.name} 发起了挑战！`);
  await Promise.all(balls); // 等双方精灵球登场动画播完再进入回合，避免对手提前行动
}

// 队伍剩余数量：显示两侧各自存活的宝可梦数（精灵球图标，复用游戏已捕获标记 icon-owned）
function renderTeamInfo(battle) {
  const ball = (n) => '<svg class="b-ball"><use xlink:href="./icons/sprites.svg#icon-owned"></use></svg>'.repeat(Math.max(0, n));
  $('be-team').innerHTML = ball(battle.eTeam.filter((x) => x.mon.hp > 0).length);
  $('bp-team').innerHTML = ball(battle.pTeam.filter((x) => x.mon.hp > 0).length);
}

// 血条按指定 HP 区间做过渡：先关过渡瞬时定位到"命中前"血量，再开过渡滑到"命中后"。
// 连击等多次伤害事件回放时逐段扣血，而不是一次扣到底
function animateHpBar(side, from, to, maxHp) {
  const bar = $(`${side}-hp`);
  if (!bar || maxHp <= 0) return;
  const f = Math.max(0, Math.round((from / maxHp) * 100));
  const t = Math.max(0, Math.round((to / maxHp) * 100));
  bar.classList.add('no-trans');
  bar.style.width = f + '%';
  bar.getBoundingClientRect(); // 强制回流：让下一句宽度变化走 transition
  bar.classList.remove('no-trans');
  bar.style.width = t + '%';
  bar.className = t < 30 ? 'low' : t < 60 ? 'mid' : '';
  bar.style.background = t < 30 ? '#f95a4c' : t < 60 ? '#fce653' : '#2cb065';
}

function renderMon(mon, side, enter) {
  const pd = getPokemonByIndex(mon.idx);
  const img = $(`${side}-img`);
  // 清除上一只残留的战斗动画类（faint 带 forwards 会停在不可见状态；其余互斥类按 CSS 后定义覆盖）
  img.classList.remove(...B_ANIM_CLS);
  lowerAttacker(side); // 换宠/刷新时恢复默认层级（动画被中断时 animationend 不会触发）
  if (enter) img.style.visibility = 'hidden'; // 球登场期间隐藏精灵，等动画结束再淡入
  // 战斗大图优先，失败回退小图标；闪光个体使用 _shiny 贴图（路径含中文，走 tryLoad 的编码/兜底加载）
  const loaded = tryLoadPokemonImage(img, pd, mon.shiny ? '_shiny' : '').then(ok => {
    if (!ok) return tryLoadPokemonIcon(img, pd);
  }).then(() => {
    applySpriteSize(img, side, pd); // 按真实身高缩放（仅战斗页生效）
    syncStatusFx(side, mon, true); // 图片尺寸确定后校正异常状态粒子挂点位置
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
  syncStatusFx(side, mon); // 异常状态粒子（睡眠 Zzz / 混乱旋星 / 麻痹火花 / 灼伤火焰 / 中毒毒泡 / 冰冻冰晶）
  // 上阵/换人：等图片加载完成（此时尺寸才是最终尺寸）再放球，落点为精灵图片底部居中
  return enter ? loaded.then(() => ballEntry(side, img)) : loaded;
}

// 精灵球登场：闭合球落入弹跳 → 球盖打开闪光 → 精灵淡入（显示在球上层）。播放期间隐藏精灵
function ballEntry(side, img) {
  return new Promise((resolve) => {
    const box = $(`${side}-box`);
    if (!box || !img) return resolve();
    let wrap = box.querySelector('.b-ball-entry');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'b-ball-entry';
      box.appendChild(wrap);
    }
    wrap.innerHTML = '';
    const closed = document.createElement('img');
    closed.className = 'b-ball-closed';
    closed.src = './items/ball-00.png';
    const open = document.createElement('img');
    open.className = 'b-ball-open';
    open.src = './items/ball-00-open.png';
    wrap.append(closed, open);
    // 落点：精灵图片底部居中。不同宝可梦宽度不同，锚点随图片实际渲染尺寸自适应；
    // 图片加载失败（无尺寸）时退回面板固定锚点
    const br = box.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    let cx, cy;
    if (ir.width > 0) {
      cx = ir.left - br.left + ir.width / 2;
      cy = ir.top - br.top + ir.height;
      if (side === 'be') cy -= 16;
    } else {
      cx = side === 'bp' ? br.width * 0.32 : br.width * 0.68;
      cy = side === 'bp' ? br.height * 0.66 : br.height * 0.36;
    }
    wrap.style.left = cx + 'px';
    wrap.style.top = cy + 'px';
    img.style.visibility = 'hidden';
    let fin = false;
    const finish = () => {
      if (fin) return;
      fin = true;
      clearTimeout(guard);
      wrap.remove();
      img.style.visibility = '';
      img.classList.add('b-enter'); // 精灵淡入登场，覆盖球的位置
      img.addEventListener('animationend', function h(ev) {
        if (ev.target !== img) return;
        img.classList.remove('b-enter');
        img.removeEventListener('animationend', h);
      });
      resolve();
    };
    const guard = setTimeout(() => finish(), 1000); // 动画事件丢失时的兜底，避免精灵一直隐藏
    closed.addEventListener('animationend', function h1() {
      closed.removeEventListener('animationend', h1);
      closed.style.display = 'none';
      open.classList.add('show'); // 立即开盖展开 + 闪光
      setTimeout(finish, 180);
    });
  });
}

function setText(t) {
  hideRight(); // 动画播放期间隐藏右栏（操作按钮 + NPC 信息），左栏拉满全宽显示文本
  $('b-text').textContent = t;
}
// 底部右栏（操作按钮 + NPC/回合信息）：仅玩家需要操作时显示，动画播放期间整体隐藏
function showRight() { const el = $('b-right'); if (el) el.style.display = ''; }
function hideRight() { const el = $('b-right'); if (el) el.style.display = 'none'; }
// 战斗动画互斥：lunge/hit/faint 同时存在时会按 CSS 后定义者覆盖，取动画前必须清掉全部
const B_ANIM_CLS = ['lunge', 'lunge-attack', 'hit', 'faint', 'lunge-stay', 'b-strike', 'flinch', 'b-enter'];
function resetAnim(el) {
  el.classList.remove(...B_ANIM_CLS);
}
// 攻击方层级提升/恢复：攻击动画期间攻击方精灵显示在对手上层
function raiseAttacker(side) {
  if (side === 'bp') {
    const flip = $('bp-box')?.querySelector('.b-flip');
    if (flip) flip.style.zIndex = '6';
  } else {
    const img = $('be-img');
    if (img) img.style.zIndex = '6';
  }
}
function lowerAttacker(side) {
  if (side === 'bp') {
    const flip = $('bp-box')?.querySelector('.b-flip');
    if (flip) flip.style.zIndex = '';
  } else {
    const img = $('be-img');
    if (img) img.style.zIndex = '';
  }
}
// 触发一次性动画（受击）并确保播完即移除类：残留类会在元素重绘或
// display 切换（如去配队选宠后返回战斗页）时被 CSS 重放，表现为"无端动一下"
function playAnim(side, cls) {
  const el = $(`${side}-img`);
  resetAnim(el);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', function h(ev) {
    if (ev.target !== el) return;
    el.classList.remove(cls);
    el.removeEventListener('animationend', h);
  });
}
// 特殊攻击：朝对手方向摆动一小段施法动作（位移量由 --lunge-dx/--lunge-dy 传入，
// 按双方精灵实际位置计算——固定向侧边摆动对缩放后的精灵方向会偏）
function lunge(side) {
  const el = $(`${side}-img`);
  const foe = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  resetAnim(el);
  void el.offsetWidth;
  raiseAttacker(side);
  el.classList.add('lunge');
  const r = el.getBoundingClientRect();
  const f = foe.getBoundingClientRect();
  // 朝对手中心方向的单位向量 × 固定摆动距离
  let vx = f.left + f.width / 2 - (r.left + r.width / 2);
  const vy = f.top + f.height / 2 - (r.top + r.height / 2);
  const len = Math.hypot(vx, vy) || 1;
  vx = (vx / len) * 42;
  const dy = (vy / len) * 42;
  if (side === 'bp') vx = -vx; // 我方在 scaleX(-1) 容器内，x 方向与屏幕相反
  el.style.setProperty('--lunge-dx', vx.toFixed(1) + 'px');
  el.style.setProperty('--lunge-dy', dy.toFixed(1) + 'px');
  el.addEventListener('animationend', function h(ev) {
    if (ev.target !== el) return;
    el.classList.remove('lunge');
    lowerAttacker(side);
    el.removeEventListener('animationend', h);
  });
}
// 物理攻击：图片冲向对方面前（由 CSS 按我方/敌方分方向）。
// 位移按双方精灵实际间距动态计算——攻击方边缘正好触到对手边缘，不重叠；精灵按身高缩放后固定像素会打不中/打过对手
function lungeAttack(side) {
  const el = $(`${side}-img`);
  const foe = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  resetAnim(el);
  void el.offsetWidth;
  raiseAttacker(side);
  el.classList.add('lunge-attack');
  const r = el.getBoundingClientRect();
  const f = foe.getBoundingClientRect();
  // 横向位移：让攻击方边缘恰好贴住对手边缘（我方右缘→敌方左缘；敌方左缘→我方右缘）；已接触/重叠则不动
  const dx = side === 'bp'
    ? -(Math.max(0, f.left - r.right))   // 我方在 scaleX(-1) 容器内，x 方向与屏幕相反
    : Math.min(0, f.right - r.left);     // 敌方（右上）向左下方冲，左缘贴我方右缘
  const dy = f.top + f.height / 2 - (r.top + r.height / 2); // 纵向中心对齐
  el.style.setProperty('--lunge-dx', dx.toFixed(1) + 'px');
  el.style.setProperty('--lunge-dy', dy.toFixed(1) + 'px');
  el.addEventListener('animationend', function h(ev) {
    if (ev.target !== el) return;
    el.classList.remove('lunge-attack');
    lowerAttacker(side);
    el.removeEventListener('animationend', h);
  });
}
function shake(side) { playAnim(side, 'hit'); }
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
// 宝可梦退场/上场：信息卡片滑出/滑入屏幕（敌方卡片在左上滑出左边界，我方卡片在右下滑出右边界）
function battlePanel(side) {
  return $(`${side}-box`)?.querySelector('.b-panel') || null;
}
function panelOut(side) {
  const p = battlePanel(side);
  if (!p) return;
  p.classList.remove('panel-in-l', 'panel-in-r', 'panel-out-l', 'panel-out-r');
  void p.offsetWidth; // 强制重排，确保动画重新触发
  p.classList.add(side === 'be' ? 'panel-out-l' : 'panel-out-r');
}
function panelIn(side) {
  const p = battlePanel(side);
  if (!p) return;
  p.classList.remove('panel-out-l', 'panel-out-r', 'panel-in-l', 'panel-in-r');
  void p.offsetWidth;
  p.classList.add(side === 'be' ? 'panel-in-l' : 'panel-in-r');
  p.addEventListener('animationend', function onEnd(ev) {
    if (ev.target !== p) return;
    p.classList.remove('panel-in-l', 'panel-in-r'); // 播完回位，避免残留偏移
    p.removeEventListener('animationend', onEnd);
  });
}
function faintAnim(side) {
  const el = $(`${side}-img`);
  resetAnim(el);
  el.classList.add('faint');
  panelOut(side); // 宝可梦倒下退场：信息卡片同步滑出屏幕
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
// 属性专属命中爆发：命中瞬间围绕受击宝可梦迸发一圈该属性的扁平粒子。
// 颜色取自 TYPE_COLORS（--fc），粒子按属性形状（火苗/水滴/叶片/星芒…）由 CSS 类区分，
// 全部共用同一个 tfFly 扩散动画（沿 --dx/--dy 飞散淡出），无阴影纯扁平。
const TYPE_FX_COUNT = { flame: 6, drop: 6, leaf: 6, spark: 7, ice: 5, bubble: 6, clump: 5, rock: 5, streak: 5, dot: 6, swirl: 5, dragon: 6 };
function spawnTypeFx(side, type) {
  const shape = TYPE_FX[type];
  if (!shape) return;
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const fx = document.createElement('span');
  fx.className = 'b-type-fx tf-' + shape;
  fx.style.setProperty('--fc', TYPE_COLORS[type] || '#fff');
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  const n = TYPE_FX_COUNT[shape] || 5;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.8;
    const dist = 12 + Math.random() * 12;
    p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
    p.style.animationDuration = (0.5 + Math.random() * 0.3).toFixed(2) + 's';
    fx.appendChild(p);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 900);
}
// 回复加号粒子：受回复宝可梦身上迸发绿色十字，治疗能量向上飘散（纯 CSS 扁平，无阴影）
function spawnHealFx(side) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const fx = document.createElement('span');
  fx.className = 'b-heal-fx';
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  for (let i = 0; i < 6; i++) {
    const p = document.createElement('i');
    // 上半圆扩散（y 轴向下，sin 为负即向上）：198°~342° 覆盖左上到右上的扇形
    const ang = Math.PI * (1.1 + Math.random() * 0.8);
    const dist = 14 + Math.random() * 12;
    p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
    fx.appendChild(p);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 900);
}
// 异常状态粒子特效：在精灵处生成循环粒子（睡眠头顶飘 Zzz / 混乱旋星 / 麻痹电火花 /
// 灼伤火焰 / 中毒毒泡 / 冰冻冰晶）。状态未变化时保留现有粒子，避免每次 renderMon 重排跳动；
// force 用于图片尺寸确定后（applySpriteSize 异步缩放完成）校正粒子挂点位置
function syncStatusFx(side, mon, force) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const st = mon.status || '';
  let fx = box.querySelector('.b-status-fx');
  if (fx) {
    if (!force && fx._mon === mon && fx.dataset.status === st) return;
    fx.remove();
  }
  if (!st) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  fx = document.createElement('div');
  fx.className = 'b-status-fx fx-' + st;
  fx.dataset.status = st;
  fx._mon = mon; // 换宠后同状态也重建，避免粒子挂点停留在旧精灵身上
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  if (st === 'sleep') {
    // 睡眠：头顶上方飘 Zzz（容器原点放到头部上方）
    fx.style.top = (ir.top - br.top - 2) + 'px';
    for (let i = 0; i < 2; i++) {
      const z = document.createElement('i');
      z.textContent = 'Z';
      z.style.animationDelay = (i * 1.2) + 's';
      fx.appendChild(z);
    }
  } else {
    const counts = { paralysis: 6, burn: 5, poison: 5, freeze: 5, confusion: 4 };
    const n = counts[st] || 5;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      if (st === 'confusion') {
        // 混乱：小星围绕头顶盘旋
        p.textContent = '✧';
        p.style.left = (Math.random() * 28 - 14) + 'px';
        p.style.top = (-ir.height / 2 - 4) + 'px';
        p.style.animationDelay = (i * 0.3).toFixed(2) + 's';
      } else {
        p.style.left = (Math.random() * ir.width - ir.width / 2) + 'px';
        p.style.top = (Math.random() * ir.height * 0.8 - ir.height * 0.4) + 'px';
        p.style.animationDelay = (Math.random() * 1.2).toFixed(2) + 's';
        p.style.animationDuration = (0.8 + Math.random() * 0.5).toFixed(2) + 's';
      }
      fx.appendChild(p);
    }
  }
  box.appendChild(fx);
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

// 播放事件：hitRef 为承受伤害方（我方回合=敌方、敌方回合=我方、preTurn/postTurn=自身）；
// hitType 为造成该伤害的招式属性（攻击出招时传入，用于属性专属命中特效；状态/回合伤害不传则用默认白火花）
async function playEvents(events, battle, hitRef, hitType, multiSide) {
  const hitSide = hitRef === curMon(battle, 'p') ? 'bp' : 'be';
  const otherSide = hitSide === 'bp' ? 'be' : 'bp';
  // 防御：事件承受方已不在场（换人后局部变量残留指向旧宠）时，仅保留文本并等待，
  // 跳过伤害数字/受击震动/faint 动画——否则会误播到新上场的宝可梦身上
  const onField = hitRef === curMon(battle, 'p') || hitRef === curMon(battle, 'e');
  _multiHits = 0;
  const nSteps = events.filter((e) => e.t === 'step').length;
  for (const ev of events) {
    if (ev.t === 'step') {
      // 物理连击：首击冲贴脸停留，之后在贴脸位小幅挥砍，末击回位
      if (multiSide) {
        _multiHits++;
        await swingOnce(multiSide, _multiHits === 1, _multiHits === nSteps);
      }
      continue;
    }
    if (ev.t === 'flinch') {
      // 畏缩：头顶感叹号 + 向后退一步（我方屏幕向左、敌方屏幕向右，方向由镜像容器处理）
      setText(ev.text || `${ev.who}畏缩了！`);
      if (onField) {
        playAnim(hitSide, 'flinch');
        flinchFx(hitSide);
      }
      await battleSleep(500);
      continue;
    }
    if (ev.t === 'miss') {
      // 未命中：目标头顶弹出灰色 MISS（挥空反馈），正文保留招式文案
      setText(ev.text || '没有命中！');
      if (onField) missFx(hitSide);
      await battleSleep(700);
      continue;
    }
    if (ev.t === 'dmg') {
      if (!onField) { setText(ev.text || `${ev.who} 受到 ${ev.amount} 点伤害！`); await battleSleep(450); continue; }
      popDmg(hitSide, ev.amount, hitRef);
      setText(ev.text || `${ev.who} 受到 ${ev.amount} 点伤害！`);
      renderMon(hitRef, hitSide);
      // 连击等多次伤害：useMove 提前把 HP 全部扣光，renderMon 读到的是最终值；
      // 这里按本次命中前后的 HP 回放血条过渡，逐段扣血，不一次扣完
      if (ev.from != null) animateHpBar(hitSide, ev.from, ev.to, hitRef.maxHp);
      shake(hitSide); // 渲染后再震：renderMon 会清掉动画类，先渲染才能让受击动画真正播完
      if (hitType && TYPE_FX[hitType]) spawnTypeFx(hitSide, hitType); // 12 元素系属性：专属粒子爆发
      else spawnHitSpark(hitSide); // 其余属性：默认白火花
      flashHitPanel(hitSide);
      if (hitRef.maxHp > 0 && ev.amount / hitRef.maxHp >= 0.25) stageShake(); // 重创（占比高）才全屏震动
      // 连击命中段：等待缩短到挥砍动画后立即衔接下一击（约 0.2s 动画 + 0.43s 停顿 ≈ 0.6s 一击）；
      // 普通单发伤害保留 750ms，维持重创一击的停顿感
      await battleSleep(nSteps ? 430 : 750);
    } else if (ev.t === 'heal') {
      const side = ev.who === hitRef.name ? hitSide : otherSide;
      popHeal(side, ev.amount);
      spawnHealFx(side); // 回复加号粒子：绿色十字能量向上飘散
      setText(ev.text);
      renderMon(side === 'bp' ? curMon(battle, 'p') : curMon(battle, 'e'), side);
      await battleSleep(750);
    } else if (ev.t === 'faint') {
      // 换人后旧宠残留的 faint 事件：只播文本，避免把新上场的宝可梦闪掉
      if (ev.who === hitRef.name && !onField) { setText(ev.text); await battleSleep(850); continue; }
      faintAnim(ev.who === hitRef.name ? hitSide : otherSide);
      setText(ev.text);
      await battleSleep(850);
    } else if (ev.t === 'status') {
      // 换人后旧宠残留的 status 事件：只播文本，避免震动误震新上场的宝可梦
      if (ev.who === hitRef.name && !onField) { setText(ev.text); await battleSleep(700); continue; }
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

let _multiHits = 0; // 物理连击已播放的击次计数（用于首/末击判定）

// 物理连击逐击摆动：首击冲到对手面前停留，之后在贴脸位小幅挥砍，末击动画结束回位
function swingOnce(side, first, last) {
  return new Promise((resolve) => {
    const el = $(`${side}-img`);
    const foe = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
    if (!el || !foe) return resolve();
    resetAnim(el);
    void el.offsetWidth;
    raiseAttacker(side);
    const r = el.getBoundingClientRect();
    const f = foe.getBoundingClientRect();
    const dx = side === 'bp'
      ? -(Math.max(0, f.left - r.right))
      : Math.min(0, f.right - r.left);
    const dy = f.top + f.height / 2 - (r.top + r.height / 2);
    el.style.setProperty('--lunge-dx', dx.toFixed(1) + 'px');
    el.style.setProperty('--lunge-dy', dy.toFixed(1) + 'px');
    el.classList.add(first ? 'lunge-stay' : 'b-strike');
    el.addEventListener('animationend', function h(ev) {
      if (ev.target !== el) return;
      el.removeEventListener('animationend', h);
      if (last) {
        resetAnim(el); // 末击回位
        lowerAttacker(side);
      }
      resolve();
    });
  });
}

// 畏缩感叹号：出现在精灵头顶并上浮淡出
function flinchFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const s = document.createElement('span');
  s.className = 'b-flinch-mark';
  s.textContent = '！';
  s.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  s.style.top = (ir.top - br.top) + 'px';
  box.appendChild(s);
  setTimeout(() => s.remove(), 800);
}

// 未命中：目标头顶弹出灰色 MISS 大字（挥空反馈），弹出后上浮淡出
function missFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const s = document.createElement('span');
  s.className = 'b-miss-mark';
  s.textContent = 'MISS';
  s.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  s.style.top = (ir.top - br.top) + 'px';
  box.appendChild(s);
  setTimeout(() => s.remove(), 850);
}

// 中途睡眠检查：先动方使出睡眠招式命中后，后动方即使本回合已选好行动也不能出手
// （preTurn 只在回合开始检查一次，先动方先命中时对方此刻才刚入睡）
async function sleepCheckAttack(mon, side, moveId, battle) {
  if (moveId == null || mon.hp <= 0) return;
  if (mon.status === 'sleep' && mon.sleepTurns > 0) {
    mon.sleepTurns--; // 本回合入睡消耗 1 个睡眠回合（与 preTurn 先判后减语义一致）
    setText(`${mon.name}正在呼呼大睡。`);
    await battleSleep(650);
    return;
  }
  await doAttack(mon, side, moveId, battle);
}
// 执行一次出招：攻击方前冲使用招式，目标实时取对方当前在场宝可梦；
// 任一方已倒下（先动者击倒后动者）则后动者本回合不再行动，避免对已倒下目标出手
async function doAttack(actor, side, moveId, battle) {
  if (!moveId || actor.hp <= 0) return;
  const foe = curMon(battle, side === 'bp' ? 'e' : 'p');
  if (foe.hp <= 0) return; // 对手已被击倒：本回合不再行动
  const mv = _data.moves[moveId];
  setText(`${actor.name} 使用了 ${mv.name}！`);
  const isPhys = moveCat(mv) === 'phys';
  // 物理连击：不预摆，由 playEvents 的 step 标记逐击摆动
  const multiPhys = mv.effect.kind === 'multihit' && isPhys;
  if (!multiPhys) {
    if (isPhys) lungeAttack(side);
    else lunge(side);
    // 伤害/状态在攻击"贴脸/命中"瞬间爆出（物理=挥砍一击时刻，特殊=施法摆动到位），而非回退时
    await battleSleep(isPhys ? 340 : 190);
  }
  const evs = [];
  useMove(actor, foe, moveId, _data, evs);
  await playEvents(evs, battle, foe, mv.type, multiPhys ? side : null);
}

async function battleLoop(battle) {
  _busy = true;
  try {
    while (!battle.winner && !_fleeing) {
      // 每回合开始标记当前出战宝可梦为"参战"（含开场首只与换人上场的，供经验结算判定）
      markParticipated(battle, 'p');
      // 换人检查：我方倒下弹出队伍选择下一只；敌方自动换下一只存活
      if (curMon(battle, 'p').hp <= 0) {
        if (!hasAlive(battle, 'p')) { battle.winner = 'e'; break; }
        const idx = await promptSwitchAfterFaint(battle);
        if (_fleeing) break;
        if (idx < 0) continue; // 取消：回到换人检查，重新弹出选择
        battle.pIdx = idx;
        markParticipated(battle, 'p');
        setText(`${curMon(battle, 'p').name} 上场了！`);
        const ballP = renderMon(curMon(battle, 'p'), 'bp', true);
        renderTeamInfo(battle);
        panelIn('bp'); // 新宝可梦上场：信息卡片滑入屏幕
        if (ballP) await ballP; // 等精灵球登场动画播完，避免对手在动画期间行动
        await battleSleep(500);
      }
      if (curMon(battle, 'e').hp <= 0) {
        if (!nextMon(battle, 'e')) { battle.winner = 'p'; break; }
        setText(`${curMon(battle, 'e').name} 上场了！`);
        const ballE = renderMon(curMon(battle, 'e'), 'be', true);
        renderTeamInfo(battle);
        panelIn('be'); // 新宝可梦上场：信息卡片滑入屏幕
        if (ballE) await ballE; // 等精灵球登场动画播完，避免对手在动画期间行动
        await battleSleep(500);
      }

      // ---------- 双方选择行动：换人优先执行，出招按速度决定先后 ----------
      let pMon = curMon(battle, 'p');
      let eMon = curMon(battle, 'e');
      const pPre = []; // 我方回合前状态事件（睡眠/麻痹/畏缩/混乱自伤等）
      const ePre = []; // 敌方回合前状态事件
      let pAct = null; // 我方选择：{type:'move',id} / {type:'switch',idx}
      let eMove = null; // 敌方 AI 选择（null = 本回合不行动）

      if (preTurn(pMon, pPre)) {
        pAct = await askPlayerMove(battle);
        if (pAct.type === 'flee') { // 撤退（标题栏返回触发）
          doRetreat(battle);
          return;
        }
      }
      if (preTurn(eMon, ePre)) {
        eMove = aiMove(eMon, pMon, _data);
      }

      // 先播行动前状态事件（双方各自的状态检查结果）
      if (pPre.length) await playEvents(pPre, battle, pMon);
      if (ePre.length) await playEvents(ePre, battle, eMon);

      // 换人优先于出招（宝可梦规则：换人动作先于双方出招结算）
      if (pAct && pAct.type === 'switch') {
        panelOut('bp'); // 主动换人：当前宝可梦退场，信息卡片滑出
        await battleSleep(320); // 等卡片滑出后再渲染新宝可梦
        battle.pIdx = pAct.idx;
        pMon = curMon(battle, 'p');
        markParticipated(battle, 'p');
        setText(`${pMon.name} 上场了！`);
        const ballP = renderMon(pMon, 'bp', true);
        renderTeamInfo(battle);
        panelIn('bp'); // 新宝可梦上场：信息卡片滑入屏幕
        if (ballP) await ballP; // 等精灵球登场动画播完，避免对手在动画期间行动
        await battleSleep(500);
        pAct = null; // 本回合行动已消耗在换人上
      }

      // 出招：双方都出招时按速度先后（速度更高者先动；平手随机）
      const pMove = pAct && pAct.type === 'move' ? pAct.id : null;
      let pFirst;
      if (pMove != null && eMove != null) {
        const ps = pMon.effStat(4);
        const es = eMon.effStat(4);
        pFirst = ps > es || (ps === es && Math.random() < 0.5);
      } else {
        pFirst = pMove != null; // 仅一方出招时自然先执行
      }
      if (pFirst) {
        await sleepCheckAttack(pMon, 'bp', pMove, battle);
        await sleepCheckAttack(eMon, 'be', eMove, battle);
      } else {
        await sleepCheckAttack(eMon, 'be', eMove, battle);
        await sleepCheckAttack(pMon, 'bp', pMove, battle);
      }

      // 出招后的倒下换人（本轮双方行动已结算，新上场者不再被追加攻击）
      if (curMon(battle, 'p').hp <= 0) {
        if (!hasAlive(battle, 'p')) { battle.winner = 'e'; break; }
        const idx = await promptSwitchAfterFaint(battle);
        if (_fleeing) break;
        if (idx < 0) continue; // 取消：回到换人检查，重新弹出选择
        battle.pIdx = idx;
        markParticipated(battle, 'p');
        setText(`${curMon(battle, 'p').name} 上场了！`);
        const ballP = renderMon(curMon(battle, 'p'), 'bp', true);
        renderTeamInfo(battle);
        panelIn('bp'); // 新宝可梦上场：信息卡片滑入屏幕
        if (ballP) await ballP; // 等精灵球登场动画播完，避免对手在动画期间行动
        await battleSleep(500);
      }
      if (curMon(battle, 'e').hp <= 0) {
        if (!nextMon(battle, 'e')) { battle.winner = 'p'; break; }
        setText(`${curMon(battle, 'e').name} 上场了！`);
        const ballE = renderMon(curMon(battle, 'e'), 'be', true);
        renderTeamInfo(battle);
        panelIn('be'); // 新宝可梦上场：信息卡片滑入屏幕
        if (ballE) await ballE; // 等精灵球登场动画播完，避免对手在动画期间行动
        await battleSleep(500);
      }

      // 回合末持续伤害
      const pEvs = [];
      const eEvs = [];
      postTurn(curMon(battle, 'p'), pEvs);
      postTurn(curMon(battle, 'e'), eEvs);
      await playEvents(pEvs, battle, curMon(battle, 'p'));
      await playEvents(eEvs, battle, curMon(battle, 'e'));
      if (curMon(battle, 'p').hp <= 0 && !hasAlive(battle, 'p')) battle.winner = 'e';
      if (curMon(battle, 'e').hp <= 0 && !hasAlive(battle, 'e')) battle.winner = 'p';
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
    // 进战斗前有被打断的野生遭遇：战斗结束后恢复 buff 倒计时与遇敌调度
    if (battle._hadPendingEncounter) {
      import('./battle.js').then(m => m.resumeEncounterFlow());
    }
  }
}

// ---------- 结算 ----------
function finishBattle(battle) {
  const win = battle.winner === 'p';
  _activeBattle = null; // 战斗已结束：清空活动战斗（后续返回走普通视图切换，不再误判为撤退）
  const gd = gameData;
  const expBase = battle.eTeam.reduce((s, x) => s + x.mon.level, 0) * 8;
  const avgLv = battle.eTeam.reduce((s, x) => s + x.mon.level, 0) / battle.eTeam.length;
  const results = [];
  if (win) {
    // 经验：参战（上过场）且存活才分；等级差倍率——低级打高级最多 3 倍，高级打低级骤减
    for (const { entry, mon } of battle.pTeam) {
      if (!mon.participated || mon.hp <= 0) continue;
      const mult = Math.max(0.2, Math.min(3, avgLv / Math.max(1, mon.level)));
      entry.exp = (entry.exp || 0) + Math.round(expBase * mult);
      let up = 0;
      while (entry.level < MAX_LEVEL && entry.exp >= expNeed(entry.level)) {
        entry.exp -= expNeed(entry.level);
        entry.level++;
        up++;
      }
      if (entry.level >= MAX_LEVEL) entry.exp = 0; // 满级后不再积累经验
      results.push({ name: mon.name, lv: entry.level, up });
    }
    gd.items.candy = (gd.items.candy || 0) + battle.preset.candy;
    // NPC 对战成就统计：累计胜场 / 精英与冠军胜场 / 对战糖果
    gd.stats.totalNpcWins = (gd.stats.totalNpcWins || 0) + 1;
    gd.stats.totalNpcCandy = (gd.stats.totalNpcCandy || 0) + battle.preset.candy;
    if (battle.preset.tier === 'novice') gd.stats.totalNpcNoviceWins = (gd.stats.totalNpcNoviceWins || 0) + 1;
    else if (battle.preset.tier === 'veteran') gd.stats.totalNpcEliteWins = (gd.stats.totalNpcEliteWins || 0) + 1;
    else if (battle.preset.tier === 'champion') gd.stats.totalNpcChampionWins = (gd.stats.totalNpcChampionWins || 0) + 1;
    if (gd.battleNpcs?.list) {
      // 战胜领奖后从当前一波中移除该 NPC
      gd.battleNpcs.list = gd.battleNpcs.list.filter((n) => n.id !== battle.preset.id);
    }
  }
  saveGame();
  addSystemLog('战斗', `${win ? '战胜' : '输给'}了「${battle.preset.name}」${win ? `，获得 ${battle.preset.candy} 糖果` : ''}。`);
  endBattle(); // 战斗结束 → 停止战斗曲，恢复地区曲
  if (win) playVictory(); // 胜利音效（播完自动恢复地区曲）
  if (win) window.dispatchEvent(new Event('achievements-changed')); // 胜利可能解锁对战成就，即时刷新手机红点

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
