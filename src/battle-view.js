// 流程：NPC 列表 → 自动编队（仓库中等级最高 6 只）→ 回合制战斗（动画）→ 结算（经验/糖果）
// 与挂机主循环解耦：战斗只在手机 App 内进行，不影响地图/遇敌/离线
import { $, showView, tryLoadPokemonImage, tryLoadPokemonIcon, updateStats, updateBackpack, logicViewport, popupBounds, watchOutsidePress, isDualLayout, showConfirmBar } from './ui.js';
import { gameData, getPokemonByIndex, addSystemLog, saveGame, pushNav, setPhase, ensureGender, rollGender, genderBadge, isPokemon, randInt, effIvs, setNpcBattleActive } from './state.js';
import { createMon, useMove, preTurn, postTurn, aiMove, aiMoveByNature, tickBattleTurns, transformMon, STRUGGLE_ID } from './battle-core.js';
import { typeMult } from './type-chart.js';
import { grantItem, itemIconSrc, pickEvoDrop, MINT_KEYS, typeIconColor } from './items.js';
import { chooseMoves } from './moves.js';
import { ensureNpcs, refreshNpcs, buildNpcTeam, npcBaseLevel } from './npcs.js';
import { BATTLE_REFRESH_MS, BATTLE_TIER_ITEMS, BATTLE_EVO_POOLS, MAX_LEVEL, SPECIAL_SPRITE_SCALE, ITEM_NAMES, alcremieSuffix } from './config.js';
import { playBattle, endBattle, playVictory, stopVictory, playShiny } from './audio.js';
import { burstShinySparkle } from './animation.js';
import { createRainbowSprite } from './rainbow-fx.js';
import { playPeMove, playPeLabel, setPeSpeedFactor, setPeEnabled } from './pe-battle-anim.js';
import * as road from './road.js';

// ===== 对战无动画（设置项 battleNoAnim）=====
// CSS 动画/过渡由 .battle-fight.no-anim 压到 1ms（见 battle-fx.css）；代码里用 Web Animations API
// 播的特效在这里统一截短到 1ms —— finished/animationend 照常触发，流程不变，只是屏幕上看不到过程，
// 因此不必逐个改上百处特效函数。原作动画引擎另用 setPeEnabled 关掉（见 applyBattleNoAnim）。
const _nativeAnimate = Element.prototype.animate;
Element.prototype.animate = function (frames, opts) {
  if (this.closest && this.closest('.battle-fight.no-anim')) {
    const o = typeof opts === 'number' ? { duration: opts } : { ...(opts || {}) };
    o.duration = 1;
    o.delay = 0;
    o.endDelay = 0;
    o.iterations = 1;
    return _nativeAnimate.call(this, frames, o);
  }
  return _nativeAnimate.call(this, frames, opts);
};

const battleNoAnim = () => gameData.settings?.battleNoAnim === true;
// 渲染战斗页 / 重新进入战斗页时同步（设置可能在战斗进行中被改）
export function applyBattleNoAnim() {
  const on = battleNoAnim();
  $('battleContent')?.querySelector('.battle-fight')?.classList.toggle('no-anim', on);
  setPeEnabled(!on);
}

// 18 属性标签色（与图鉴/遇敌一致）
export const TYPE_COLORS = {
  '一般': '#9F9E9A', '格斗': '#A7443E', '飞行': '#72A3D2', '毒': '#793B9B',
  '地面': '#894F4E', '岩石': '#BA9459', '虫': '#89991A', '幽灵': '#633963',
  '钢': '#548EA2', '火': '#CB494D', '水': '#3786CE', '草': '#378E24',
  '电': '#DBB538', '超能': '#DA5A89', '冰': '#37BEE0', '龙': '#4654C6',
  '恶': '#553F42', '妖精': '#C74ECB',
};

// 命中染色：这些属性的伤害招式会在命中时给对手叠一层属性色（见 spawnImpactTint）
const IMPACT_TINT_TYPES = new Set(['火', '水', '草', '毒', '冰']);
const METEOR_MOVES = new Set(['流星群', '流星闪冲', '流星突击', '流星光束']);
const FANG_COLORS = { 雷电牙: '#ffe066', 冰冻牙: '#23d7ff', 火焰牙: '#ff9a4d', 精神之牙: '#f08bd0', 剧毒牙: '#b35cff', 虫咬: '#a8c93f' };
const HAND_CLAMP_MOVES = new Set(['拍落', '小偷', '渴望', '击掌奇袭']);
// 原作 FlyingParticle 粒子流招式：命中结算时补一个左右颤抖，避免打完没打击感
const PARTICLE_HIT_SHAKE_MOVES = new Set(['银色旋风', '爆炸烈焰', '岩石封锁', '尖刺臂', '撕裂爪']);

let _data = null;
let _learnset = null;
let _busy = false; // 战斗动画播放中禁止操作
let _activeBattle = null; // 当前战斗（标题栏撤退 / 挂起选择用）
let _settled = false;     // 结算页显示中（goBack 判断返回应回 NPC 战斗列表）
let _pendingAsk = null;   // 挂起的玩家选择 resolve（撤退时强制结束）
let _fleeing = false;     // 已请求撤退
let _auto = false;        // 自动战斗模式：点操作栏「自动」按钮启动，点遮罩恢复手动
let _retryAuto = false;   // 记住上一把战斗结束时的自动状态（「再战一次」沿用）
let _battleLogs = [];     // 本次对战的完整文本日志（右键文案区可查看）
let _logCtx = null;       // 本局日志上下文（双方宝可梦名 + NPC 名），结算后「回顾」仍可正确渲染敌我
let _logMenu = null;      // 右键菜单元素
// 招式调试面板：在真实战斗里用克隆个体跑 doAttackInner，动作/节奏与正式战斗同一条代码
let _fxdbgSpeed = 1;      // 调试播放倍速（battleSleep 与 PE 引擎共用，播放结束复位）
let _fxdbgPlaying = false;
let _fxdbgLast = null;    // { id, side } 最近一次调试播放
let _fxdbgRestore = null; // 面板关闭/播放结束后恢复玩家操作界面（askPlayerMove 注册）

// 僵局判定：连续多少回合双方均未造成伤害（回合首尾 HP 均无变化）视为死循环，自动战斗主动换人/判负
const STALL_LIMIT = 10;

// 异常状态 → 展示名称（状态圆点颜色取造成该状态的招式属性色，见 renderMon）
const STATUS_NAMES = {
  paralysis: '麻痹', sleep: '睡眠', poison: '中毒',
  burn: '灼伤', freeze: '冰冻', confusion: '混乱', curse: '诅咒', infatuation: '着迷',
};
// 能力等级顺序（与 createMon 的 stages 数组一致）：0攻 1防 2特攻 3特防 4速 5命中率 6闪避率
const STAT_NAMES = ['攻击', '防御', '特攻', '特防', '速度', '命中率', '闪避率'];

// 招式类别中文名与判定（物理/特殊/变化；伤害类招式按 effect.cat 归类），与配招页同款
const MOVE_CAT_CN = { phys: '物理', spec: '特殊', status: '变化' };
function moveCat(mv) {
  const ef = mv.effect || {};
  if (ef.kind === 'damage' || ef.kind === 'explode' || ef.kind === 'multihit' || ef.kind === 'drain' || ef.kind === 'recoil' || ef.kind === 'fixed' || ef.kind === 'finalGambit' || ef.kind === 'counter' || ef.kind === 'mirrorCoat') {
    if (ef.kind === 'mirrorCoat') return 'spec'; // 镜面反射：返还特殊伤害，属特殊攻击
    return ef.cat === 'spec' ? 'spec' : 'phys';
  }
  return 'status';
}
// 招式先制度：反击类永远最后出手，守住类 +4，其余先制招式按正作数值；未列出的为 0
const MOVE_PRIORITY = {
  '帮助': 5,
  '王者盾牌': 4,
  '击掌奇袭': 3, '快速防守': 3, '广域防守': 3,
  '神速': 2, '迎头一击': 2, '佯攻': 2,
  '电光一闪': 1, '音速拳': 1, '子弹拳': 1, '冰砾': 1,
  '影子偷袭': 1, '水流喷射': 1, '突袭': 1,
};
function movePriority(mv) {
  if (!mv) return 0;
  const k = (mv.effect || {}).kind;
  if (k === 'counter' || k === 'mirrorCoat') return -5;
  const p = MOVE_PRIORITY[mv.name];
  if (p != null) return p;
  if (k === 'protect' || k === 'endure') return 4;
  return 0;
}
// 换人/新宝可梦上场：清空反击/镜面反射记录及替身/寄生种子/两回合蓄力等仅对当前个体的战斗标记
function resetCounter(mon) {
  if (!mon) return;
  mon.hitByPhys = false; mon.physDmg = 0;
  mon.hitBySpec = false; mon.specDmg = 0;
  mon.flinch = false;                            // 畏缩为本回合瞬时标记，换人即清
  mon.protected = false; mon.endure = false; mon.protectStreak = 0;
  mon.subHp = 0;
  mon.seeded = false; mon.seedSrc = null;
  mon.chargeMove = null; mon.chargeHidden = false; // 换人中断两回合蓄力
  mon.disabledMove = null; mon.disableTurns = 0;   // 定身法/无理取闹：换人后解除
  mon.lockedMove = null; mon.encoreTurns = 0;      // 再来一次：换人后解除
  mon.tauntTurns = 0;                              // 挑衅：换人后解除
  mon.recharge = false;                            // 破坏光线类：换人后不再需要休息
  mon.protectMove = null;                          // 守护招式名随本回合结束失效
  mon.entryRound = null;                           // 击掌奇袭：换人/上场后视为刚出场
}

// 战斗是否进行中（标题栏返回判断）
// 调试：把当前对战双方所有宝可梦的 PP 清空（用来快速验证「挣扎」兜底）
export function debugClearPp() {
  const b = _activeBattle;
  if (!b) return 0;
  let n = 0;
  for (const side of ['pTeam', 'eTeam']) {
    for (const x of (b[side] || [])) {
      if (!x || !x.mon || !Array.isArray(x.mon.pp)) continue;
      x.mon.pp = x.mon.pp.map(() => 0);
      n++;
    }
  }
  return n;
}

export function isBattleActive() {
  return !!_activeBattle;
}

// 是否处于战斗结算页（返回应回 NPC 战斗列表，而非弹栈回来源页）
export function isBattleSettled() {
  return _settled;
}

// 撤退（由标题栏返回触发）：结束挂起选择并中断战斗循环
export function retreatBattle() {
  if (!_activeBattle) return;
  // 自定义对战（对战帐篷）：标题栏返回等于放弃本轮，先确认，避免误触
  const custom = _activeBattle.custom;
  if (custom?.confirmText && !custom.confirmed) {
    custom.confirmed = true;
    showConfirmBar(custom.confirmText, () => { retreatBattle(); }, () => { custom.confirmed = false; }, { overlay: true });
    return;
  }
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
  setNpcBattleActive(false);
  battle.winner = null;
  if (!isDualLayout()) import('./battle.js').then(m => m.resumePhaseAfterBattle()); // 单屏：遭遇还在就回遭遇态，否则回挂机
  endBattle(); // 撤退 → 停止战斗曲，恢复地区曲
  if (battle.custom?.onEnd) {
    _settled = true;
    if (battle._ended) return;
    battle._ended = true;
    battle.custom.onEnd({ win: false, retreat: true, pTeam: battle.pTeam, eTeam: battle.eTeam, rounds: battle.round });
    return;
  }
  showBattleView();
  addSystemLog('战斗', `与「${battle.preset.name}」的战斗中撤退了`);
}

// 可中断暂停：撤退请求时抛错中断战斗循环，避免继续操作已销毁的战斗 DOM
class BattleFled extends Error {}

// 战斗精灵按身高缩放：1.0m（10 分米）为 1 倍参照；1m 以下用开方曲线柔和放大（线性比例
// 会让矮个宝可梦小到看不清贴图），1m 以上同样开方放缓，夹取到安全范围
const SPRITE_REF_H = 10;   // 参照身高（分米）＝ 1 倍
const SPRITE_BASE_H = 50;  // 参照身高对应的基准像素高度
const SPRITE_MIN = 0.42;   // 缩放下限：极矮宝可梦至少 21px，不至于小到看不见
const SPRITE_MAX = 2.0;    // 缩放上限：最高 100px，精灵向上生长不挤 UI
const SPRITE_MAX_W = 120;  // 宽度上限：宽体宝可梦（如长翅鸥 143×24）防止横向溢出

// 按真实身高缩放战斗精灵，并让脚部对齐地面底座、底座跟随精灵横向中心
function applySpriteSize(img, side, pd) {
  const h = pd && pd.height ? pd.height : SPRITE_REF_H;
  // 统一开方曲线：1m 以下不再线性等比例缩（矮个宝可梦贴图会小到看不清），
  // 1m 以上开方放缓，避免 20m 之类的极端身高直接顶满布局
  const s = Math.sqrt(h / SPRITE_REF_H);
  // 盘绕/长身类宝可梦（图鉴身高为拉直总长，立绘蜷缩成团）：按个体修正系数缩小
  const mult = (pd && SPECIAL_SPRITE_SCALE[pd.index]) || 1;
  const scale = Math.max(SPRITE_MIN, Math.min(SPRITE_MAX, s * mult));
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
  // 钉子容器与底座同一锚点（底座按图片宽度动态定位，固定 CSS 坐标会随体型错位）
  const hz = $(side === 'be' ? 'be-hazards' : 'bp-hazards');
  if (hz) {
    if (side === 'be') hz.style.right = (14 + w / 2) + 'px';
    else hz.style.left = (8 + w / 2) + 'px';
  }
}
const battleSleep = (ms) => new Promise((res, rej) => {
  setTimeout(() => {
    if (_fleeing) rej(new BattleFled());
    else res();
  }, ms / _fxdbgSpeed);
});

// 挣扎：四招全没 PP 时的兜底招式（无属性=不被免疫也不吃克制，必中；按伤害的 1/4 反伤）
const STRUGGLE_MOVE = {
  id: STRUGGLE_ID, name: '挣扎', type: '无', category: '物理', power: 50, accuracy: 0, pp: null,
  effect: { kind: 'recoil', ratio: 0.25, cat: 'phys', power: 50 },
};

async function ensureData() {
  if (_data && _learnset) return;
  const [d, l] = await Promise.all([
    fetch('./pokemon-data/moves.json').then((r) => r.json()),
    fetch('./pokemon-data/learnset.json').then((r) => r.json()),
  ]);
  _data = d;
  _data.moves[STRUGGLE_ID] = STRUGGLE_MOVE; // 数据表里没有挣扎，进战斗前补一条
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
  const bv = $('battleView');
  if (bv) delete bv.dataset.viewTitle;
  pushNav('battleView');
  _settled = false; // 回到列表页：清除结算标志，后续返回按普通逐级弹栈
  _battleLogs = []; // 彻底离开本局：清空对战记录缓存
  _logCtx = null;
  // 回到对战列表：清除战斗期间的屏幕难度边框色
  clearBattleTier();
  renderBattleList();
  showView('battleView');
  startRefreshCountdown();
}

// 渲染 NPC 挑战列表（供进入页面 / 到点刷新 / 聚合刷新调用）
export function renderBattleList() {
  const box = $('battleContent');
  if (!box) return;
  clearBattleTier(); // 列表页无难度边框：清除结算页残留的难度边框色（到点刷新直接落在结算页时）
  _settled = false; // 列表已渲染，不再处于结算状态（结算页被强制替换后返回不再走结算路径）
  const { list } = ensureNpcs();
  if (list.length === 0) {
    // 打完所有 NPC：空列表状态，糖果充足（≥50）时显示「强制刷新」按钮
    const hasCandy = (gameData.items.candy || 0) >= 50;
    box.innerHTML = `
      <div class="battle-app">
        <div id="battleRefreshTip">距离下一波刷新：${refreshText()}</div>
        <div class="battle-empty">
          <div class="battle-empty-text">这波NPC都被你打败啦！</div>
          ${hasCandy ? `
          <button class="battle-btn main battle-refresh-btn" id="bForceRefresh">
            强制刷新
            <span class="battle-refresh-cost"><img class="candy-icon" src="./items/goods/candy.png" alt="">×50</span>
          </button>` : ''}
        </div>
      </div>`;
    if (hasCandy) $('bForceRefresh').addEventListener('click', forceRefreshWave);
    return;
  }
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

// 打完所有 NPC：提交 50 糖果强制刷新下一波（复用 refreshNpcs，刷新时间一并重置）
async function forceRefreshWave() {
  const gd = gameData;
  if ((gd.items.candy || 0) < 50) return; // 按钮仅在糖果充足时渲染，此处为兜底
  gd.items.candy -= 50;
  refreshNpcs();
  await saveGame();
  updateStats(); // 顶部糖果计数即时刷新
  renderBattleList();
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
    if (_settled) return; // 结算页展示中不强制替换，返回列表时自动生成新一波
    // 空列表时按当前糖果实时同步「强制刷新」按钮的显示/隐藏（糖果增减不触发列表重渲染）
    if (document.querySelector('.battle-empty')) {
      const hasCandy = (gameData.items.candy || 0) >= 50;
      if (hasCandy !== !!$('bForceRefresh')) {
        renderBattleList();
        return;
      }
    }
    if (BATTLE_REFRESH_MS - (Date.now() - (gameData.battleNpcs?.refreshedAt || 0)) <= 0) {
      renderBattleList(); // 到点生成新一波
      return;
    }
    const t = $('battleRefreshTip');
    if (t) t.textContent = `距离下一波刷新：${refreshText()}`;
  }, 1000);
}

function npcCardHtml(npc) {
  const base = npcBaseLevel(npc); // 档位固定区间：列表上直接能看出该打哪一档
  // NPC 首帧拼图（npcs.png：13列×3行，每格 16×21，2x 显示），按下标定位（与交换页同款）
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
          <div class="npc-reward">胜 <img class="candy-icon" src="./items/goods/candy.png" alt="">×${npc.candy}</div>
        </div>
      </div>
    </div>`;
}

// ---------- 我方/敌方队伍构建 ----------
// 挑选实际出战的队伍条目：只出配队（gameData.team，按保存顺序）；NPC 难度跟随配队，练新宠只带弱队即可
function pickBattleEntries() {
  const gd = gameData;
  const all = (gd.roster || []).filter((p) => p.inRoster !== false && isPokemon(p));
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

// 按招式基础 PP 初始化战斗个体当前 PP（与 moves 数组对齐；无 PP 数据的招式置 null 按无限处理）
function fillPp(mon) {
  mon.pp = mon.moves.map((id) => (id != null && _data.moves[id] ? _data.moves[id].pp ?? null : null));
}

// AI 无可用招式时的兜底：找第一个还有 PP 的招式（null PP 视为无限）
function firstUsableMove(mon) {
  return mon.moves.find((m) => {
    if (m == null) return false;
    const pi = mon.moves.indexOf(m);
    return !Array.isArray(mon.pp) || mon.pp[pi] == null || mon.pp[pi] > 0;
  }) ?? STRUGGLE_ID; // 一招都用不了 → 挣扎
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
      : chooseMoves(_learnset[entry.species] || {}, entry.level || 1, _data, {
          types: pd ? pd.types : [],
          tmIds: new Set(Object.keys(gameData.tmUnlocked || {}).map(Number)),
          allowEgg: entry.source === 'egg',
        }); // 与仓库详情页的自动配招保持一致：只算已解锁的招式机，蛋招式仅孵蛋个体可用
    return (() => {
      const mon = createMon(pd, entry.level || 1, effIvs(entry), entry.nature, moveIds); // 王冠练过的个体值按有效值进战斗
      mon.shiny = !!entry.shiny; // 战斗大图按闪光贴图（_shiny 后缀）加载
      mon.squareShiny = !!entry.squareShiny;
      mon.variant = entry.variant || null; // 时空扭曲外观变体（RGB / 污染）：仅渲染特效
      mon.gender = ensureGender(entry); // 玩家个体性别（旧存档无 gender 字段则按物种比例补 roll 并写回）
      if (entry.nickname) mon.name = entry.nickname; // 玩家昵称覆盖物种名
      mon.participated = false; // 经验结算条件：参战（上过场）且存活
      fillPp(mon); // 按招式基础 PP 初始化当前 PP
      return { entry, pd, mon };
    })();
  });
}

// ---------- 战斗 ----------
async function startNpcBattle(npcId, startAuto = false) {
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
  const eTeam = buildNpcTeam(npc, _data, _learnset, battleMaxLv()).map((x) => {
    const mon = createMon(x.pd, x.level, x.ivs, x.nature, x.moveIds);
    mon.gender = x.gender || rollGender(x.pd.index); // NPC 性别：正常由 buildNpcTeam 缓存，旧缓存缺失时按物种补 roll
    mon.shiny = !!x.shiny; // NPC 闪光：buildNpcTeam 按 SHINY_CHANCE 概率 roll 定（大图/星标/登场特效）
    mon.squareShiny = !!x.squareShiny;
    fillPp(mon); // 按招式基础 PP 初始化当前 PP
    return { pd: x.pd, mon };
  });
  const battle = { preset: npc, pTeam, eTeam, pIdx: 0, eIdx: 0, winner: null, round: 1,
    weather: null, weatherTurns: 0, field: null, fieldTurns: 0, // 天气/场地（useMove 的 ctx）
    hazards: { p: { spikes: 0, toxic: 0, rock: false }, e: { spikes: 0, toxic: 0, rock: false } }, // 撒菱/毒菱/隐形岩
    stall: 0, // 僵局连续回合计数（双方 HP 均无变化），见 battleLoop
  };
  _activeBattle = battle;
  setNpcBattleActive(true);
  _fleeing = false;
  _auto = startAuto; // 新战斗默认手动模式；「再战一次」沿袭上一把结束时的自动状态
  _battleLogs = []; // 新战斗清空上一把的对战记录
  _logCtx = { p: pTeam.map((x) => x.mon.name), e: eTeam.map((x) => x.mon.name), npc: npc.name };
  // 单屏（PC 经典布局）：对战占着唯一一屏，用 phase 保护战斗页并停排野遇；
  // 双屏（手游/桌面双屏）：下屏对战和迷你游戏一样独立，不碰全局 phase，上屏照常走路/遇敌/烧甜甜蜜
  if (!isDualLayout()) setPhase('battle');
  if (!isDualLayout()) import('./battle.js').then(m => m.pauseBuffsForBattle());
  // 双屏上屏的遭遇与下屏对战各走各的，战斗结束不回收上屏；单屏仍由 phase 保护战斗页
  _busy = true; // 开场精灵球登场动画期间也禁止刷新/重进战斗
  const pageReady = renderBattlePage(battle);
  playBattle(); // 进入 NPC 挑战 → 切换为战斗曲（覆盖地区曲）
  await pageReady; // 等双方精灵球登场动画播完再进入回合
  // 开场自动变身：双方若有百变怪在场上立即变身成对手
  autoTransform(battle, 'p');
  autoTransform(battle, 'e');
  // 重试自动：开局直接铺自动遮罩，进入自动出招
  if (startAuto) {
    const mask = $('b-auto-mask');
    if (mask) mask.style.display = 'flex';
    setText(`${curMon(battle, 'p').name} 进入自动战斗`);
  }
  await battleLoop(battle);
}

// 自定义对战（对战帐篷）：双方队伍由调用方传入；手动攻击/换人，不写经验/糖果/NPC 列表，
// 结果回调给调用方。
export async function startCustomBattle({ pTeam, eTeam, preset, onEnd, confirmText = '' }) {
  await ensureData();
  if (_busy) return false;
  const battle = {
    preset: preset || { name: '对战', tier: 'champion' },
    pTeam, eTeam, pIdx: 0, eIdx: 0, winner: null, round: 1,
    weather: preset?.weather || null, weatherTurns: preset?.weather ? 5 : 0,
    field: null, fieldTurns: 0,
    hazards: { p: { spikes: 0, toxic: 0, rock: false }, e: { spikes: 0, toxic: 0, rock: false } },
    stall: 0,
    tentEndure: true,
    custom: { onEnd, confirmText, confirmed: false, tentBattle: true },
  };
  _activeBattle = battle;
  setNpcBattleActive(true);
  _fleeing = false;
  _auto = false;
  _battleLogs = [];
  _logCtx = { p: pTeam.map((x) => x.mon.name), e: eTeam.map((x) => x.mon.name), npc: battle.preset.name };
  // 双屏：下屏独立对战，不碰主 phase；单屏：临时占用唯一一屏
  if (!isDualLayout()) setPhase('battle');
  if (!isDualLayout()) import('./battle.js').then((m) => m.pauseBuffsForBattle());
  _busy = true;
  const pageReady = renderBattlePage(battle);
  playBattle();
  await pageReady;
  autoTransform(battle, 'p');
  autoTransform(battle, 'e');
  if (battle.custom?.tentBattle) setText(`${curMon(battle, 'p').name}上场了！`);
  await battleLoop(battle);
  return true;
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
// 新宝可梦上场时结算对方场地的钉子：隐形岩按属性克制倍率扣血、撒菱按层数扣血、毒菱施加中毒。
// 钉子伤害保底 1 HP（避免"上场即倒下"的连锁替换），毒菱对毒系/钢系免疫
function applyEntryHazards(battle, side, events) {
  const hz = side === 'p' ? battle.hazards.p : battle.hazards.e;
  const mon = curMon(battle, side);
  if (!mon || mon.hp <= 0) return;
  const hurt = (d, text) => {
    d = Math.max(1, Math.floor(d));
    const before = mon.hp;
    mon.hp = Math.max(1, mon.hp - d); // 保底 1 HP，防止钉子直接击倒
    if (mon.hp === before) {
      // 只剩 1 HP 时保底生效：这时别再报"受到 0 点伤害"，给一句说得通的话（不然看着像锁血）
      events.push({ t: 'msg', text: `${mon.name}撑住了，钉子没有造成伤害！` });
      return;
    }
    events.push({ t: 'dmg', who: mon.name, uid: mon.uid, amount: before - mon.hp, from: before, to: mon.hp, text });
  };
  let stepped = false; // 是否实际踩中钉子（隐形岩被免疫/毒菱免疫时不触发碎片高亮）
  if (hz.rock) {
    const m = typeMult('岩石', mon.types);
    if (m > 0) { hurt((mon.maxHp / 8) * m, `${mon.name}受到了隐形岩的伤害！`); stepped = true; }
    else events.push({ t: 'msg', text: `隐形岩对${mon.name}没有效果！` });
  }
  if (hz.spikes > 0) {
    const ratio = { 1: 1 / 8, 2: 1 / 6, 3: 1 / 4 }[hz.spikes];
    hurt(mon.maxHp * ratio, `${mon.name}踩中了撒菱，受到了伤害！`);
    stepped = true;
  }
  if (hz.toxic > 0 && !mon.types.some((t) => t === '毒' || t === '钢') && !mon.status) {
    mon.status = 'poison';
    mon.statusType = '毒';
    events.push({ t: 'status', who: mon.name, uid: mon.uid, status: 'poison', text: `${mon.name}被毒菱刺中，中毒了！` });
    stepped = true;
  }
  if (stepped) {
    const color = hz.toxic > 0 ? '#a23df0' : hz.spikes > 0 ? '#b98f5e' : '#b59162';
    hzHitFx(side === 'p' ? 'bp' : 'be', color);
  }
}

// 百变怪登场自动变身：复制对手外观/招式（对手同为百变怪或已变身则无效，HP 不复制）
function autoTransform(battle, side) {
  const me = curMon(battle, side);
  const foe = curMon(battle, side === 'p' ? 'e' : 'p');
  if (!me || !foe || me.hp <= 0 || foe.hp <= 0) return;
  if (String(me.idx) !== '0132' || me._transformOf) return; // 仅百变怪，且未变身
  if (String(foe.idx) === '0132' || foe._transformOf) return; // 对手同为百变怪/已变身则不生效
  const panel = side === 'p' ? 'bp' : 'be';
  const before = me.name;
  if (transformMon(me, foe)) {
    setText(`${before}变成了${foe.name}的样子！`);
    renderMon(me, panel);
    renderTeamInfo(battle);
  }
}

// 强制换人（吹飞/吼叫的随机替换、接棒的能力传递）：随机选一只存活后备登场
async function doForcedSwitch(battle, side, keepStats) {
  const team = side === 'p' ? battle.pTeam : battle.eTeam;
  const i = side === 'p' ? battle.pIdx : battle.eIdx;
  const alive = team.map((x, idx) => ({ idx, mon: x.mon })).filter((x) => x.idx !== i && x.mon.hp > 0);
  if (!alive.length) return false;
  const pick = alive[Math.floor(Math.random() * alive.length)];
  // 接棒：把当前宝可梦的能力变化原样传给新上场者
  const stages = keepStats ? team[i].mon.stages.slice() : null;
  const stageTypes = keepStats ? team[i].mon.stageTypes.slice() : null;
  const panel = side === 'p' ? 'bp' : 'be';
  panelOut(panel);
  await battleSleep(260);
  if (side === 'p') battle.pIdx = pick.idx; else battle.eIdx = pick.idx;
  const mon = curMon(battle, side);
  markParticipated(battle, side);
  resetCounter(mon);
  if (keepStats) {
    mon.stages = stages;
    mon.stageTypes = stageTypes;
  }
  setText(`${mon.name}上场了！`);
  const ball = renderMon(mon, panel, true);
  renderTeamInfo(battle);
  panelIn(panel);
  if (ball) await ball;
  const hazEvs = [];
  applyEntryHazards(battle, side, hazEvs);
  if (hazEvs.length) await playEvents(hazEvs, battle, curMon(battle, side));
  await battleSleep(400);
  autoTransform(battle, side); // 强制换上场的若是百变怪，登场后立即变身
  return true;
}
// 自动换人：取当前下标之后下一只存活（队尾回绕），无存活返回 -1
function nextAliveIdx(battle, side) {
  const team = side === 'p' ? battle.pTeam : battle.eTeam;
  const cur = side === 'p' ? battle.pIdx : battle.eIdx;
  for (let i = cur + 1; i < team.length; i++) if (team[i].mon.hp > 0) return i;
  for (let i = 0; i < cur; i++) if (team[i].mon.hp > 0) return i;
  return -1;
}
// 我方倒下后弹出队伍选择下一只上场（复用配队页替换逻辑）；撤退时以 -1 强制结束
function promptSwitchAfterFaint(battle) {
  return new Promise((resolve) => {
    // 自动战斗：不弹队伍选择，直接换上当前下标之后下一只存活（队尾之后回绕）
    if (_auto) {
      resolve(nextAliveIdx(battle, 'p'));
      return;
    }
    // 只剩最后一只：没有选择余地，直接上场
    const alive = battle.pTeam.filter((x) => x.mon.hp > 0);
    if (alive.length <= 1) {
      resolve(alive.length ? battle.pTeam.findIndex((x) => x.mon.hp > 0) : -1);
      return;
    }
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

// 离开战斗页（进入设置等）时清除难度边框色：跳变恢复默认，避免其它页面沿用战斗配色
// 也避免切页瞬间边框色渐变过渡（战斗配色→默认绿）的拉扯感
// 难度边框色画在「战斗页所在的那块屏」上：手游双屏下战斗在下屏，不能染到上面挂机屏
function battleScreenEl() {
  // 经典单屏：appScreen 的边框是透明的，真正可见的是舞台屏
  if (!isDualLayout()) return $('screen');
  return document.getElementById('battleView')?.closest('.screen') || $('screen');
}

export function clearBattleTier() {
  const sc = battleScreenEl();
  if (!sc.classList.contains('t-novice') && !sc.classList.contains('t-veteran') && !sc.classList.contains('t-leader') && !sc.classList.contains('t-champion') && !sc.classList.contains('t-tent')) return;
  sc.classList.add('no-theme-trans'); // 切页时的主题色变化禁用过渡，直接跳变
  sc.classList.remove('t-novice', 't-veteran', 't-leader', 't-champion', 't-tent');
  void sc.offsetWidth; // 强制重排，让"无过渡"立即生效
  sc.classList.remove('no-theme-trans');
}

// 战斗页重新显示（从设置返回等）时恢复当前战斗的难度边框色：同样跳变，
// 返回战斗页属于切换页面，不做渐变过渡
export function restoreBattleTier() {
  const sc = battleScreenEl();
  sc.classList.remove('t-novice', 't-veteran', 't-leader', 't-champion', 't-tent');
  if (_activeBattle?.preset?.tier) {
    sc.classList.add('no-theme-trans');
    sc.classList.add('t-' + _activeBattle.preset.tier);
    void sc.offsetWidth; // 强制重排，让"无过渡"立即生效
    sc.classList.remove('no-theme-trans');
  }
  applyBattleNoAnim(); // 设置可能在战斗进行中被改：回到战斗页时重新同步无动画状态
}

async function renderBattlePage(battle) {
  const box = $('battleContent');
  // 战斗期间屏幕边框按 NPC 难度着色（返回对战列表时清除）：
  // 进入战斗算场景切换，边框色直接跳变，不做渐变过渡
  const sc = battleScreenEl();
  sc.classList.add('no-theme-trans');
  sc.classList.remove('t-novice', 't-veteran', 't-leader', 't-champion', 't-tent');
  if (battle.preset.tier) sc.classList.add('t-' + battle.preset.tier);
  void sc.offsetWidth; // 强制重排，让"无过渡"立即生效
  sc.classList.remove('no-theme-trans');
  const bottomHtml = battle.custom?.tentBattle
    ? `<div class="b-bottom tent-battle-bottom">
         <div class="text-box tent-battle-box"><div class="text-box-content" id="b-text"></div></div>
         <div class="b-actions tent-battle-dock" id="b-actions">
           <button class="tent-battle-btn main" id="act-fight">攻击</button>
           <button class="tent-battle-btn" id="act-pkm">宝可梦</button>
         </div>
       </div>`
    : `<div class="b-bottom">
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
        <div class="b-auto-mask" id="b-auto-mask"><span class="b-auto-label">自动战斗中…</span></div>
      </div>`;
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
          <span class="b-hazards" id="be-hazards"></span>
          <img id="be-img" alt="">
        </div>
        <div class="b-player-box" id="bp-box">
          <span class="b-base" id="bp-base"></span>
          <span class="b-hazards" id="bp-hazards"></span>
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
${bottomHtml}
    </div>`;
  const npcName = $('b-npc-name'); if (npcName) npcName.textContent = battle.preset.name;
  _fxdbgRestore = null; // 上一场战斗的恢复回调不能留到这一场
  applyBattleNoAnim(); // 对战无动画：挂 no-anim 类并关掉原作动画引擎
  // 自动战斗遮罩：点击恢复手动操作（同时清除遮罩与隐藏态右栏）
  $('b-auto-mask')?.addEventListener('click', () => {
    _auto = false;
    $('b-auto-mask').style.display = 'none';
    showRight();
    setText('已切回手动操作');
  });
  // 右键文案区（含自动战斗遮罩覆盖时）→ 弹出菜单（查看本次对战记录）
  const onLogCtx = (e) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到全局右键禁用监听
    showLogMenu(e.clientX, e.clientY);
  };
  // 招式调试只在控制台用 __fxdbg() 打开，战斗界面不显示入口
  (box.querySelector('.b-left') || box.querySelector('.tent-battle-text'))?.addEventListener('contextmenu', onLogCtx);
  box.querySelector('.b-auto-mask')?.addEventListener('contextmenu', onLogCtx);
  const balls = [
    renderMon(curMon(battle, 'p'), 'bp', true),
    renderMon(curMon(battle, 'e'), 'be', true),
  ];
  renderTeamInfo(battle);
  panelIn('bp'); // 开场：双方信息卡片滑入屏幕
  panelIn('be');
  setText(battle.custom?.tentBattle ? '' : `${battle.preset.name} 发起了挑战！`);
  await Promise.all(balls); // 等双方精灵球登场动画播完再进入回合，避免对手提前行动
}

// 队伍剩余数量：显示两侧各自存活的宝可梦数（精灵球图标，复用游戏已捕获标记 icon-owned）
function renderTeamInfo(battle) {
  const be = $('be-team'), bp = $('bp-team');
  if (!be || !bp) return; // 战斗页已卸载
  const ball = (n) => '<svg class="b-ball"><use xlink:href="#icon-owned"></use></svg>'.repeat(Math.max(0, n));
  be.innerHTML = ball(battle.eTeam.filter((x) => x.mon.hp > 0).length);
  bp.innerHTML = ball(battle.pTeam.filter((x) => x.mon.hp > 0).length);
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

const RAINBOW_IMG_CLS = 'b-rainbow-img';

function clearBattleRainbow(img) {
  if (!img) return;
  if (img._rainbowCleanup) {
    img._rainbowCleanup();
    img._rainbowCleanup = null;
  }
  img.classList.remove(RAINBOW_IMG_CLS);
}

// 炫彩描边：原图隐藏，SVG 层按原图位置/尺寸铺开，每帧跟着战斗动画的 transform/opacity/filter 走
function applyBattleRainbow(side, img) {
  const src = img.currentSrc || img.src;
  if (!src || !img.naturalWidth || !img.naturalHeight) return false;
  if (img._rainbowCleanup && img._rainbowSrc === src) return true;
  if (img._rainbowCleanup) {
    img._rainbowCleanup();
    img._rainbowCleanup = null;
  }
  const host = side === 'bp' ? img.closest('.b-flip') : img.closest('.b-enemy-box');
  if (!host) return false;
  const svg = createRainbowSprite(src, img.naturalWidth, img.naturalHeight);
  host.appendChild(svg);
  let raf = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    svg.remove();
    if (img._rainbowCleanup === stop) {
      img._rainbowCleanup = null;
      img._rainbowSrc = null;
    }
  };
  const tick = () => {
    if (stopped) return;
    if (!img.isConnected) { stop(); return; }
    if ($('battleView')?.style.display === 'none') {
      raf = requestAnimationFrame(tick);
      return;
    }
    const cs = getComputedStyle(img);
    svg.style.right = 'auto';
    svg.style.bottom = 'auto';
    svg.style.left = img.offsetLeft + 'px';
    svg.style.top = img.offsetTop + 'px';
    svg.style.width = img.offsetWidth + 'px';
    svg.style.height = img.offsetHeight + 'px';
    svg.style.transform = cs.transform === 'none' ? '' : cs.transform;
    svg.style.opacity = cs.opacity;
    svg.style.filter = cs.filter === 'none' ? '' : cs.filter;
    svg.style.visibility = img.style.visibility === 'hidden' ? 'hidden' : '';
    svg.style.zIndex = img.style.zIndex || '1';
    raf = requestAnimationFrame(tick);
  };
  img._rainbowCleanup = stop;
  img._rainbowSrc = src;
  tick();
  return true;
}

function renderMon(mon, side, enter) {
  // 变身后的百变怪：以复制对象的外观渲染（图片/属性随 _transformOf 切换）
  const pd = getPokemonByIndex(mon._transformOf || mon.idx);
  const img = $(`${side}-img`);
  if (!img) return null; // 战斗页已卸载/被替换（撤退或界面切走），异步出场直接放弃
  // 清除上一只残留的战斗动画类（faint 带 forwards 会停在不可见状态；其余互斥类按 CSS 后定义覆盖）
  img.classList.remove(...B_ANIM_CLS);
  if (mon.variant !== 'rainbow') clearBattleRainbow(img);
  const rainbowSeq = (img._rainbowSeq = (img._rainbowSeq || 0) + 1);
  // 时空扭曲外观变体：按个体 variant 应用 CSS 特效（RGB 分离 / 污染紫）；炫彩走 SVG 描边层
  img.classList.remove('fx-variant-rgb', 'fx-variant-polluted');
  if (mon.variant === 'rgb') img.classList.add('fx-variant-rgb');
  else if (mon.variant === 'polluted') img.classList.add('fx-variant-polluted');
  if (mon.variant === 'rainbow') img.classList.add(RAINBOW_IMG_CLS);
  lowerAttacker(side); // 换宠/刷新时恢复默认层级（动画被中断时 animationend 不会触发）
  // 登场球动画期间隐藏精灵；两回合招式蓄力（钻地/升空/入水）期间同样保持隐藏
  img.style.visibility = (enter || mon.chargeHidden) ? 'hidden' : '';
  // 无动画模式：已昏厥的宝可梦保持隐藏，避免同一回合后续事件刷新时把它又显示出来
  if (battleNoAnim() && mon.hp <= 0) img.style.visibility = 'hidden';
  img.dataset.charged = mon.chargeHidden ? '1' : ''; // 蓄力离场标记与逻辑状态同步（换人/刷新时清除残留）
  // 战斗大图优先，失败回退小图标；霜奶仙特殊外观取组合图（无闪光版），否则闪光取 _shiny（路径含中文，走 tryLoad 的编码/兜底加载）
  const loaded = tryLoadPokemonImage(img, pd, alcremieSuffix(mon.variant) || (mon.shiny ? '_shiny' : '')).then(ok => {
    if (!ok) return tryLoadPokemonIcon(img, pd);
  }).then(() => {
    applySpriteSize(img, side, pd); // 按真实身高缩放（仅战斗页生效）
    syncStatusFx(side, mon, true); // 图片尺寸确定后校正异常状态粒子挂点位置
    syncSeedFx(side, mon, true); // 同上：校正寄生种子幼芽挂点位置
    if (img._rainbowSeq !== rainbowSeq) return;
    if (mon.variant === 'rainbow' && !applyBattleRainbow(side, img)) img.classList.remove(RAINBOW_IMG_CLS);
  });
  const nameEl = $(`${side}-name`);
  nameEl.textContent = mon.name;
  if (mon.shiny) { // 闪光个体：名字后追加星标（复用图鉴/仓库的闪光星 SVG）
    nameEl.insertAdjacentHTML('beforeend', '<svg class="roster-shiny" viewBox="0 0 1024 1024" width="10" height="10" style="flex-shrink:0;vertical-align:-2px;transform:translateY(-2px);"><use xlink:href="#icon-star"/></svg>');
  }
  // 等级区：性别图标（♂ 蓝 / ♀ 粉）跟在 Lv 前（跟等级绑定，不跟名字）
  $(`${side}-lv`).innerHTML = `${genderBadge(mon.gender)}Lv${mon.level}`;
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
  // 血条容器记录当前血量数值，hover 时自制 tooltip 显示（随 renderMon 刷新）；溢伤不显示负数
  const hpBox = bar.closest('.b-hp');
  if (hpBox) hpBox.dataset.tip = `${Math.max(0, mon.hp)}/${mon.maxHp}`;
  syncStatusFx(side, mon); // 异常状态粒子（睡眠 Zzz / 混乱旋星 / 麻痹火花 / 灼伤火焰 / 中毒毒泡 / 冰冻冰晶）
  syncSeedFx(side, mon); // 寄生种子幼芽（被寄生期间常驻脚下，换宠/解除后移除）
  syncShieldFx(side, mon); // 守住系护盾（当前回合 protected 才显示，回合重置/换人自动撤下）
  // 上阵/换人：等图片加载完成（此时尺寸才是最终尺寸）再放球，落点为精灵图片底部居中；
  // 无动画模式不放球也不淡入，等新图解码完再直接显示（否则会先露出上一只的残留画面）
  const entryP = enter
    ? loaded.then(() => (battleNoAnim() ? showEntryInstant(img) : ballEntry(side, img)))
    : loaded;
  // 闪光个体登场：球落地精灵淡入后单次闪光粒子 + 登场音效（开战首只与中途换人都触发，敌我双方通用）
  if (enter && mon.shiny) {
    entryP.then(() => {
      burstShinySparkle($('battleContent'), img, { squareShiny: !!mon.squareShiny });
      playShiny();
    });
  }
  return entryP;
}

// 无动画模式的登场：不放球、不做淡入；等浏览器把新图解码完再解除隐藏，
// 避免换人瞬间还显示着上一只（已倒下）的旧画面
function showEntryInstant(img) {
  if (!img) return Promise.resolve();
  const reveal = () => { img.style.visibility = ''; };
  const decoded = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
  return decoded.then(reveal, reveal);
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
    closed.src = './items/balls/ball-00.png';
    const open = document.createElement('img');
    open.className = 'b-ball-open';
    open.src = './items/balls/ball-00-open.png';
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
  const el = $('b-text');
  if (el) el.textContent = t;
  if (t) {
    _battleLogs.push(t); // 收集本次对战日志（右键文案区可查看）
    appendLogLine(t); // 记录页打开时实时追加新日志并滚到底部
  }
}
// 日志实时追加：记录页开着时战斗仍在后台推进，新日志逐条插入列表
function appendLogLine(t) {
  const list = $('battleContent')?.querySelector('.battle-fight .list-scroll');
  if (!list) return;
  const line = document.createElement('div');
  line.className = 'rec-row ' + logSide(t);
  line.innerHTML = `<span class="rec-dot"></span><span class="rec-main">${renderLogLine(t)}</span>`;
  list.appendChild(line);
  list.scrollTop = list.scrollHeight;
}

// 日志行敌我判定：以我方/敌方宝可梦名开头的行动归对应方，NPC 宣言归敌方，其余为中立提示
function logSide(t) {
  const c = _logCtx;
  if (!c) return 'n';
  if (c.p.some((n) => t.startsWith(n))) return 'p';
  if (c.e.some((n) => t.startsWith(n))) return 'e';
  if (t.startsWith(c.npc)) return 'e';
  return 'n';
}
// 日志行渲染：宝可梦名加粗，招式名前置属性图标并加粗（长名优先，避免短招名截断长名）
function renderLogLine(t) {
  const esc = t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const nameSet = new Set();
  if (_logCtx) {
    _logCtx.p.forEach((n) => nameSet.add(n));
    _logCtx.e.forEach((n) => nameSet.add(n));
  }
  const moveByName = new Map();
  if (_data) {
    for (const id in _data.moves) {
      const mv = _data.moves[id];
      if (mv && mv.name) {
        nameSet.add(mv.name);
        moveByName.set(mv.name, mv);
      }
    }
  }
  const arr = [...nameSet].filter(Boolean).sort((a, b) => b.length - a.length);
  let html = esc;
  if (arr.length) {
    const re = new RegExp(arr.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    html = esc.replace(re, (m) => {
      const mv = moveByName.get(m);
      const icon = mv
        ? `<span class="b-move-type" style="background:${TYPE_COLORS[mv.type] || '#888'};color:${typeIconColor(mv.type)};transform:scale(0.8)"><svg class="b-move-type-icon"><use xlink:href="#icon-type-${mv.type}"></use></svg></span>`
        : '';
      return icon + '<b>' + m + '</b>';
    });
  }
  return html;
}
// 底部右栏（操作按钮 + NPC/回合信息）：仅玩家需要操作时显示，动画播放期间整体隐藏
function showRight() { const el = $('b-right'); if (el) el.style.display = ''; }
function hideRight() { const el = $('b-right'); if (el) el.style.display = 'none'; }

// 右键菜单：位置贴近光标，菜单内点击不触发外部关闭，点击外部任意位置关闭
function showLogMenu(x, y) {
  hideLogMenu();
  let menu = _logMenu;
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
    _logMenu = menu;
  }
  menu.innerHTML = '<div class="shop-ctx-item"><span class="shop-ctx-qty">查看对战记录</span></div>';
  menu.style.display = '';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const { x: lx, y: ly } = logicViewport(x, y); // zoom 下还原逻辑坐标
  const b = popupBounds(); // 夹紧在机身内：手游双屏下机身只占屏幕中间一块
  menu.style.left = Math.max(b.left, Math.min(lx - 24, b.right - mw - 4)) + 'px';
  menu.style.top = Math.max(b.top, Math.min(ly, b.bottom - mh - 4)) + 'px';
  menu.onclick = (e) => {
    if (!e.target.closest('.shop-ctx-item')) return;
    hideLogMenu();
    showBattleLogs();
  };
  _logMenuUnwatch?.();
  _logMenuUnwatch = watchOutsidePress(menu, hideLogMenu);
}
let _logMenuUnwatch = null;
function hideLogMenu() {
  const menu = _logMenu;
  if (menu) menu.style.display = 'none';
  _logMenuUnwatch?.();
  _logMenuUnwatch = null;
}

// 记录页承载容器：战斗页为 .battle-fight，结算页回顾为 .battle-result
function logContainer() {
  return $('battleContent')?.querySelector('.battle-fight, .battle-result');
}

// 对战记录页：全屏覆盖当前页面（遮住全部按钮 = 锁 UI），滚动列出本次对战全部日志。
// 标题栏替换为「对战记录」，点击 appTitle 返回（由 main.js 的标题返回逻辑调用 closeLogPage）
let _logTitlePrev = null; // 打开记录页前的标题栏内容（关闭时还原）
function showBattleLogs() {
  const host = logContainer();
  if (!host || host.querySelector('.b-log-page')) return;
  hideLogMenu();
  const wrap = document.createElement('div');
  wrap.className = 'b-log-page';
  const header = document.createElement('div');
  header.className = 'rec-header';
  header.textContent = `本次对战 ${_battleLogs.length} 条记录`;
  const list = document.createElement('div');
  list.className = 'list-scroll';
  if (!_battleLogs.length) {
    const empty = document.createElement('div');
    empty.className = 'rec-empty';
    empty.textContent = '暂无对战记录';
    list.appendChild(empty);
  } else {
    for (const t of _battleLogs) {
      const line = document.createElement('div');
      line.className = 'rec-row ' + logSide(t);
      line.innerHTML = `<span class="rec-dot"></span><span class="rec-main">${renderLogLine(t)}</span>`;
      list.appendChild(line);
    }
  }
  wrap.appendChild(header);
  wrap.appendChild(list);
  host.appendChild(wrap);
  setLogTitle();
}
// 标题栏切为「对战记录」（记录页打开时调用；从设置等页面返回战斗页时由 syncLogTitle 重新断言）
function setLogTitle() {
  const t = $('appTitle');
  if (!t) return;
  _logTitlePrev = t.innerHTML;
  t.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 对战记录';
  t.dataset.action = 'back';
}
// 从设置等其它页面返回战斗页时：记录页若还开着，重新把标题栏切回「对战记录」
export function syncLogTitle() {
  if (isLogOpen()) setLogTitle();
}
// 对战记录页是否打开（main.js 标题返回时判断：开 → 只关记录页，不走返回）
export function isLogOpen() {
  return !!logContainer()?.querySelector('.b-log-page');
}
// 关闭记录页并还原标题栏（仅在战斗视图上还原，避免覆盖设置等页面的标题）
export function closeLogPage() {
  logContainer()?.querySelector('.b-log-page')?.remove();
  const t = $('appTitle');
  if (t && _logTitlePrev != null && $('battleView')?.style.display === 'flex') {
    t.innerHTML = _logTitlePrev;
    _logTitlePrev = null;
  }
}
// 战斗动画互斥：lunge/hit/faint 同时存在时会按 CSS 后定义者覆盖，取动画前必须清掉全部
const B_ANIM_CLS = ['lunge', 'lunge-attack', 'hit', 'hit-recoil', 'faint', 'lunge-stay', 'b-strike', 'flinch', 'b-enter', 'thunder-hit', 'shell-tuck',
  'cg-sink', 'cg-rise', 'cg-vanish', 'cg-glow', 'cg-out-sink', 'cg-out-rise', 'cg-out-vanish'];
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
// 攻击目标定位：目标离场蓄力（挖洞/飞翔等，dataset.charged 标记）时，
// 物理/特殊攻击应瞄准对方底座（地面位置）而非飞向隐藏中的精灵图片
function lungeTargetRect(side) {
  const tSide = side === 'bp' ? 'be' : 'bp';
  const foe = $(`${tSide}-img`);
  if (foe && foe.dataset.charged === '1') {
    const base = $(`${tSide}-base`);
    if (base) return base.getBoundingClientRect();
  }
  return foe ? foe.getBoundingClientRect() : null;
}
// 特殊攻击：朝对手方向摆动一小段施法动作（位移量由 --lunge-dx/--lunge-dy 传入，
// 按双方精灵实际位置计算——固定向侧边摆动对缩放后的精灵方向会偏）
function lunge(side) {
  const el = $(`${side}-img`);
  const f = lungeTargetRect(side);
  if (!el || !f) return;
  resetAnim(el);
  void el.offsetWidth;
  raiseAttacker(side);
  el.classList.add('lunge');
  const r = el.getBoundingClientRect();
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
  const f = lungeTargetRect(side);
  if (!el || !f) return;
  resetAnim(el);
  void el.offsetWidth;
  raiseAttacker(side);
  el.classList.add('lunge-attack');
  const r = el.getBoundingClientRect();
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
// 简化位移：只向目标平移一小段再回原位，不贴脸
function nudgeAttacker(side) {
  const el = $(`${side}-img`);
  const f = lungeTargetRect(side);
  if (!el || !f) return;
  resetAnim(el);
  void el.offsetWidth;
  raiseAttacker(side);
  const r = el.getBoundingClientRect();
  let dx = (f.left + f.width / 2 - (r.left + r.width / 2)) * 0.18;
  const dy = (f.top + f.height / 2 - (r.top + r.height / 2)) * 0.12;
  if (side === 'bp') dx = -dx;
  el.animate([
    { transform: 'translate(0, 0)' },
    { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`, offset: 0.4 },
    { transform: 'translate(0, 0)' },
  ], { duration: 280, easing: 'ease-out' });
  setTimeout(() => lowerAttacker(side), 300);
}
// 目标侧命中贴图（风/斩击到达即出现，不和伤害结算的旧粒子错位）
function spawnImpactAsset(boxSide) {
  const img = $(`${boxSide}-img`);
  const box = $(`${boxSide}-box`);
  if (!img || !box) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'b-charge-asset';
  el.style.width = '32px';
  el.style.height = '32px';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  el.style.backgroundImage = "url('./pe-battle/move-fx-assets/impact.png')";
  el.style.backgroundSize = '32px 32px';
  el.style.transform = 'translate(-50%, -50%) scale(1)';
  box.appendChild(el);
  el.animate([
    { opacity: 0, transform: 'translate(-50%, -50%) scale(.65)' },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1.12)', offset: 0.3 },
    { opacity: 0, transform: 'translate(-50%, -50%) scale(1.2)' },
  ], { duration: 300, easing: 'ease-out', fill: 'both' });
  setTimeout(() => el.remove(), 340);
}
function shake(side) { playAnim(side, 'hit'); }
// 定向受击：目标沿远离攻击方的方向弹一下（我方向左、敌方向右）。
// 我方图片在 scaleX(-1) 容器里，同一个正 translateX 渲染出来正好是向左。
function hitRecoil(side) {
  const el = $(`${side}-img`);
  if (!el) return;
  el.classList.remove('hit-recoil');
  void el.offsetWidth;
  el.classList.add('hit-recoil');
  el.addEventListener('animationend', function h(ev) {
    if (ev.target !== el) return;
    el.classList.remove('hit-recoil');
    el.removeEventListener('animationend', h);
  });
}
function popDmg(side, amount, mon) {
  const s = document.createElement('span');
  s.className = 'b-dmg';
  // 伤害占最大 HP 比例高时标红（红=重创）
  if (mon && mon.maxHp > 0 && amount / mon.maxHp >= 0.25) s.classList.add('heavy');
  s.textContent = '-' + amount;
  const box = $(`${side}-box`);
  if (!box) return; // 战斗页已卸载
  box.appendChild(s);
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
  // 无动画模式：不走倒下动画（被压成 1ms 后残影不好看），直接隐藏，等换人时由 renderMon 恢复
  if (battleNoAnim()) el.style.visibility = 'hidden';
  else el.classList.add('faint');
  panelOut(side); // 宝可梦倒下退场：信息卡片同步滑出屏幕
}
// 回复：统一使用原作 Gfx_BlueStar 星星粒子
function spawnHealFx(side) {
  spawnBlueStarBurst(side, 10);
}
const SOUND_MOVES = new Set([
  '叫声', '吼叫', '唱歌', '超音波', '音爆', '刺耳声', '打鼾', '终焉之歌', '治愈铃声',
  '巨声', '金属音', '长嚎', '虫鸣', '轮唱', '回声', '大声咆哮', '打嗝', '战吼',
  '魅惑之声', '爆音波', '密语', '古老之歌', '破音', '精神噪音', '龙声鼓舞', '魅诱之声',
  '闪焰高歌', '鳞片噪音', '魂舞烈音爆', '怪异电波', '吵闹', '哈欠', '梦话',
]);
const BIND_MOVES = new Set(['缠绕', '紧束', '绑紧']);
const FIST_MOVES = new Set(['子弹拳', '增强拳', '等离子闪电拳', '钢拳双击', '极巨拳斗', '喷射拳', '愤怒之拳']);
const STONE_RANGED = new Set(['尖石攻击', '岩石炮', '钻石风暴', '岩斧', '冲岩']);
// 远程多段物理招式（种子机关枪/冰锥/岩石爆击/飞弹针/骨棒乱打/鳞射/尖刺加农炮）：
// 攻击方不贴脸，站原地朝对手逐发喷射实心粒子，粒子形状按招区分、颜色取属性色
const RANGED_PHYS_MULTI = {
  '种子机关枪': { shape: 'pill',    color: TYPE_COLORS['草'] },
  '冰锥':       { shape: 'crystal', color: TYPE_COLORS['冰'] },
  '岩石爆击':   { shape: 'jag',     color: TYPE_COLORS['岩石'] },
  '飞弹针':     { shape: 'needle',  color: TYPE_COLORS['虫'] },
  '骨棒乱打':   { shape: 'bone',    color: TYPE_COLORS['地面'] },
  '骨头回力镖': { shape: 'bone',    color: TYPE_COLORS['地面'] },
  '投球':       { shape: 'ball',    color: '#d85b4b' },
  '鳞射':       { shape: 'scale',   color: TYPE_COLORS['龙'] },
  '尖刺加农炮': { shape: 'pill',    color: TYPE_COLORS['一般'] },
};
// 远程单体物理（冰砾/毒针/毒千针/垃圾射击/种子炸弹）：不贴脸，发射一发粒子/团块直射对手
const RANGED_SINGLE = {
  '冰砾':     { shape: 'sphere', color: TYPE_COLORS['冰'] },
  '毒针':     { shape: 'needle', color: TYPE_COLORS['毒'] },
  '毒千针':   { shape: 'needle', color: TYPE_COLORS['毒'] },
  '垃圾射击': { shape: 'blob',   color: TYPE_COLORS['毒'] },
  // 种子炸弹：复用种子机关枪的原作种子素材，单发大种子 + 命中后炸开一簇树叶
  '种子炸弹': { shape: 'seed',   color: TYPE_COLORS['草'], size: 1.4, leafBurst: true },
};

// 弹道粒子：一串粒子从攻击方位置飞向目标，逐一在目标处消失（shape: 'bubble' 气泡 / 'star' 星形 / 'pebble' 圆石 / 'flame' 火焰 / 'ball' 圆球 / 'confuse' 柔和球）。
// 我方（左下→右上）由大变小，敌方（右上→左下）由小变大；始末大小/位移/错峰由 CSS 变量传入。
// 圆球类招式仅发射单球：先在攻击方位置蓄力变大，再沿直线飞向目标（动画见 ballCharge）；
// solid 为 true 时去掉柔和光晕（实心岩石球，如击落）
function spawnProjStream(side, shape, color, solid, tex) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-proj-fx proj-' + shape;
  if (color) fx.style.setProperty('--fc', color);
  const sx = fr.left - br.left + fr.width / 2;
  const yk = shape === 'ball' ? 0.5 : 0.38;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  if (shape === 'ball' || shape === 'confuse') {
    if (tex) {
      fx.className = 'b-proj-fx proj-img';
      fx.style.setProperty('--img', `url(${new URL('./pe-battle/move-fx-assets/pe/' + tex.img, import.meta.url).href})`);
    }
    const b = document.createElement('i');
    b.style.setProperty('--bx', (ex - sx).toFixed(1) + 'px');
    b.style.setProperty('--by', (ey - sy).toFixed(1) + 'px');
    b.style.setProperty('--bs', (16 + Math.random() * 4).toFixed(1) + 'px');
    if (solid) b.style.boxShadow = 'none';
    if (tex) {
      b.style.setProperty('--bs', tex.px + 'px');
      b.style.setProperty('--frames', String(tex.frames));
      b.style.setProperty('--bgy', (tex.frames > 1 ? (tex.frame / (tex.frames - 1)) * 100 : 0) + '%');
      if (tex.filter) b.style.filter = tex.filter;
    }
    fx.appendChild(b);
    box.appendChild(fx);
    return new Promise((resolve) => setTimeout(() => { fx.remove(); resolve(); }, 740));
  }
  const shrink = side === 'bp';
  const n = 6;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i');
    b.style.setProperty('--bx', (ex - sx + (Math.random() * 12 - 6)).toFixed(1) + 'px');
    b.style.setProperty('--by', (ey - sy + (Math.random() * 10 - 5)).toFixed(1) + 'px');
    b.style.setProperty('--sf', shrink ? 1.5 : 0.45);
    b.style.setProperty('--se', shrink ? 0.45 : 1.5);
    b.style.setProperty('--bs', (10 + Math.random() * 7).toFixed(1) + 'px');
    b.style.setProperty('--bd', (i * 0.06).toFixed(2) + 's');
    // 树叶/花瓣素材是多帧纵向图：每片随机取一帧，避免整串长得一模一样
    if (shape === 'leaf' || shape === 'petal') {
      const frames = shape === 'leaf' ? 9 : 4;
      const f = Math.floor(Math.random() * frames);
      b.style.backgroundPosition = `0 ${((f / (frames - 1)) * 100).toFixed(1)}%`;
    }
    fx.appendChild(b);
  }
  box.appendChild(fx);
  return new Promise((resolve) => setTimeout(() => { fx.remove(); resolve(); }, 700));
}
function spawnProjOne(side, shape, color, size = 1) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-proj-fx proj-' + shape;
  if (color) fx.style.setProperty('--fc', color);
  // 起点：攻击方中心略偏上（模拟喷射口）；终点：目标中心略偏上，带随机散布
  const sx = fr.left - br.left + fr.width / 2;
  const yk = shape === 'ball' ? 0.5 : 0.38;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  const b = document.createElement('i');
  const shrink = side === 'bp'; // 我方大→小；敌方小→大
  b.style.setProperty('--bx', (ex - sx + (Math.random() * 14 - 7)).toFixed(1) + 'px');
  b.style.setProperty('--by', (ey - sy + (Math.random() * 12 - 6)).toFixed(1) + 'px');
  b.style.setProperty('--sf', shrink ? 1.5 : 0.45);
  b.style.setProperty('--se', shrink ? 0.45 : 1.5);
  b.style.setProperty('--bs', ((9 + Math.random() * 5) * size).toFixed(1) + 'px');
  fx.appendChild(b);
  box.appendChild(fx);
  // 飞行动画 0.35s：等待其飞抵目标（略留余量覆盖起始延迟），随后移除粒子
  return new Promise((resolve) => {
    setTimeout(() => { fx.remove(); resolve(); }, 380);
  });
}
// 空气之刃/空气利刃：复用气旋攻击的 Gfx_AirWave2 风刃，少量发射
function spawnAirBladeStream(side, count = 2) {
  const tSide = side === 'bp' ? 'be' : 'bp';
  const from = $(`${side}-img`);
  const to = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!from || !to || !box) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.42;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.42;
  const ang = (Math.atan2(ey - sy, ex - sx) * 180) / Math.PI;
  const url = new URL('./pe-battle/move-fx-assets/pe/Gfx_AirWave2__32x16.png', import.meta.url).href;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = sx + 'px';
    el.style.top = (sy + (i - (count - 1) / 2) * 12) + 'px';
    el.style.width = '32px';
    el.style.height = '16px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = '32px 16px';
    el.style.filter = 'drop-shadow(0 0 5px #dff6ff)';
    el.style.zIndex = '9';
    el.style.transform = `translate(-50%,-50%) rotate(${ang.toFixed(1)}deg)`;
    box.appendChild(el);
    const dy = ey - (sy + (i - (count - 1) / 2) * 12);
    el.animate([
      { transform: `translate(-50%,-50%) rotate(${ang.toFixed(1)}deg) scale(.7)`, opacity: 0 },
      { transform: `translate(-50%,-50%) rotate(${ang.toFixed(1)}deg) scale(1)`, opacity: 1, offset: .12 },
      { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${ang.toFixed(1)}deg) scale(1.15)`, opacity: 1, offset: .9 },
      { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${ang.toFixed(1)}deg) scale(1.2)`, opacity: 0 },
    ], { duration: 320, delay: i * 55, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), 360 + i * 55);
  }
  return new Promise((resolve) => setTimeout(resolve, 320 + (count - 1) * 55 + 50));
}
// 原作针形弹道：用 Gfx_Needle 贴图沿飞行方向旋转射出（双针/毒针同素材）
function spawnNeedleAsset(side, tSide) {
  const from = $(`${side}-img`);
  const to = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = 0.4;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  const ang = (Math.atan2(ey - sy, ex - sx) * 180) / Math.PI + 90;
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = sx + 'px';
  el.style.top = sy + 'px';
  el.style.width = '20px';
  el.style.height = '20px';
  el.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_Needle__16x16.png')";
  el.style.backgroundSize = '20px 20px';
  el.style.zIndex = '9';
  box.appendChild(el);
  const trs = `translate(-50%,-50%) rotate(${ang.toFixed(1)}deg)`;
  el.animate([
    { transform: trs, opacity: 0 },
    { opacity: 1, offset: .1 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) rotate(${ang.toFixed(1)}deg)`, opacity: 1, offset: .86 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) rotate(${ang.toFixed(1)}deg)`, opacity: 0 },
  ], { duration: 330, easing: 'linear', fill: 'both' });
  setTimeout(() => el.remove(), 370);
}
// 日光束：从对手地面底座椭圆中心向上射出一根柔光淡黄细柱
function spawnSolarBeam(tSide) {
  const box = $(`${tSide}-box`);
  const base = $(`${tSide}-base`);
  if (!box || !base) return;
  const br = box.getBoundingClientRect();
  const bsr = base.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-solar-fx';
  // 底座椭圆中心（精灵脚底站位的圆心）作为光束起点
  fx.style.left = (bsr.left - br.left + bsr.width / 2) + 'px';
  fx.style.top = (bsr.top - br.top + bsr.height / 2) + 'px';
  const b = document.createElement('i');
  b.className = 'beam';
  fx.appendChild(b);
  const g = document.createElement('i');
  g.className = 'glow';
  fx.appendChild(g);
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 650);
}
// 电系招式命中：Gfx_Lightning 纵向拼接成从屏幕顶劈到对手头顶的闪电
// 电系强度对应的分片：3=细弱电（电击），0=常规，2=粗壮分叉
function lightningVariant(mv) {
  const p = Number(mv.power) || 0;
  if (p >= 100) return 1;
  if (p >= 85) return 2;
  if (p >= 55) return 0;
  return 3;
}
function spawnLightningStrike(tSide, variant = 3) {
  spawnVoltFlash();
  spawnLightningAsset(tSide, variant);
}
// 麻痹：原作 Gfx_Spark2 三帧电花，在目标身上连续闪烁
function spawnParalysisBurst(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const k = Math.max(0.7, Math.min(1.6, ir.width / 80));
  const offs = [[5, 0], [-5, 10], [15, 20], [-15, -10], [25, 0], [-8, 8], [2, -8], [-20, 15]];
  offs.forEach(([ox, oy], i) => {
    const el = document.createElement('span');
    el.className = 'fx-spark-asset';
    el.style.left = (cx + ox * k) + 'px';
    el.style.top = (cy + oy * k) + 'px';
    el.style.animationDelay = (i * 0.03).toFixed(2) + 's';
    box.appendChild(el);
    setTimeout(() => el.remove(), 760);
  });
  const orbUrl = './pe-battle/move-fx-assets/pe/Gfx_ElectricOrbs__8x8.png';
  for (let i = 0; i < 5; i++) {
    const size = 14 + randInt(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + randInt(-24, 24)) + 'px';
    el.style.top = (cy + randInt(-20, 20)) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${orbUrl})`;
    el.style.backgroundSize = `${size}px ${size * 4}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    let f = randInt(0, 3);
    const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * size}px`; }, 60);
    const dx = randInt(-30, 30), dy = randInt(-36, 16);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`, opacity: 0 },
    ], { duration: 420, delay: i * 30, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 480 + i * 30);
  }
}
function spawnLightningAsset(tSide, variant = 3) {
  const field = document.querySelector('.battle-fight');
  const img = $(`${tSide}-img`);
  if (!field || !img) return;
  const fr = field.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - fr.left + ir.width / 2;
  const headY = ir.top - fr.top + ir.height * 0.12;
  const url = new URL('./pe-battle/move-fx-assets/pe/Gfx_Lightning__32x32.png', import.meta.url).href;
  const step = 24;
  const count = Math.max(1, Math.ceil(headY / step));
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.zIndex = '8';
    el.style.width = '32px';
    el.style.height = '32px';
    el.style.left = (cx + randInt(-3, 3)) + 'px';
    el.style.top = (headY - i * step) + 'px';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = '32px 160px';
    el.style.backgroundPosition = `0 -${variant * 32}px`;
    el.style.transform = 'translate(-50%,-50%) scale(1.05)';
    field.appendChild(el);
    el.animate([
      { opacity: 0 },
      { opacity: 1, offset: .15 },
      { opacity: .35, offset: .4 },
      { opacity: 1, offset: .55 },
      { opacity: 0 },
    ], { duration: 340, fill: 'both' });
    setTimeout(() => el.remove(), 380);
  }
  setTimeout(() => spawnParalysisBurst(tSide), 220);
}
function spawnVoltFlash() {
  const stage = document.querySelector('.battle-fight');
  if (!stage) return;
  const el = document.createElement('span');
  el.className = 'b-volt-flash';
  stage.appendChild(el);
  setTimeout(() => el.remove(), 320);
}
function spawnElectricBall(side, variant = 2) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.42;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.42;
  const ball = document.createElement('span');
  ball.className = 'fx-orig';
  ball.style.left = sx + 'px';
  ball.style.top = sy + 'px';
  ball.style.width = '58px';
  ball.style.height = '58px';
  ball.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_CircleOfLight__64x64.png')";
  ball.style.backgroundSize = '58px 58px';
  ball.style.filter = 'drop-shadow(0 0 12px #ffe45c)';
  ball.style.zIndex = '9';
  box.appendChild(ball);
  ball.animate([
    { transform: 'translate(-50%,-50%) scale(.35)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .2 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) scale(1.15)`, opacity: 1 },
  ], { duration: 420, easing: 'cubic-bezier(.3,.1,.8,1)', fill: 'both' });
  setTimeout(() => {
    ball.remove();
    spawnLightningStrike(side === 'bp' ? 'be' : 'bp', variant);
  }, 420);
}
function spawnRockSlide(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const url = './pe-battle/move-fx-assets/pe/Gfx_Rocks__32x32.png';
  for (let i = 0; i < 9; i++) {
    const size = 22 + randInt(0, 16);
    const endX = cx + randInt(-Math.round(ir.width * 0.45), Math.round(ir.width * 0.45));
    const endY = ir.top - br.top + ir.height * (0.06 + Math.random() * 0.28);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = endX + 'px';
    el.style.top = endY + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${randInt(0, 5) * size}px`;
    el.style.zIndex = '8';
    box.appendChild(el);
    el.animate([
      { transform: `translate(-50%,-50%) translateY(-${(ir.height + randInt(90, 190)).toFixed(0)}px) rotate(0deg)`, opacity: 0 },
      { opacity: 1, offset: .1 },
      { transform: 'translate(-50%,-50%) translateY(0) rotate(240deg)', opacity: 1, offset: .88 },
      { transform: 'translate(-50%,-50%) translateY(0) rotate(240deg)', opacity: 0 },
    ], { duration: 500 + randInt(0, 120), delay: randInt(0, 220), easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), 720 + i * 25);
  }
}
function spawnRockDrop(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const url = './pe-battle/move-fx-assets/pe/Gfx_Rocks__32x32.png';
  for (let i = 0; i < 5; i++) {
    const size = 30 + randInt(0, 16);
    const endX = cx + randInt(-Math.round(ir.width * 0.28), Math.round(ir.width * 0.28));
    const endY = ir.top - br.top + ir.height * (0.08 + Math.random() * 0.24);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = endX + 'px';
    el.style.top = endY + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${randInt(0, 5) * size}px`;
    el.style.zIndex = '8';
    box.appendChild(el);
    el.animate([
      { transform: `translate(-50%,-50%) translateY(-${(ir.height + randInt(100, 180)).toFixed(0)}px) rotate(0deg)`, opacity: 0 },
      { opacity: 1, offset: .1 },
      { transform: 'translate(-50%,-50%) translateY(0) rotate(200deg)', opacity: 1, offset: .9 },
      { transform: 'translate(-50%,-50%) translateY(0) rotate(200deg)', opacity: 0 },
    ], { duration: 560 + randInt(0, 100), delay: i * 35, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), 700 + i * 35);
  }
}
function spawnSnowSlide(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-snow-fx';
  const cx = ir.left - br.left + ir.width / 2; // 目标横向中心
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('i');
    const size = 7 + Math.random() * 12; // 雪球大小不一
    const dropY = 130 + Math.random() * 70; // 各自的下落起点高度
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = (cx + (Math.random() * 100 - 50)) + 'px'; // 头顶上方横向散布
    s.style.top = (ir.top - br.top - dropY) + 'px';
    s.style.setProperty('--by', (dropY + ir.height * 0.35).toFixed(0) + 'px'); // 落到身体上
    s.style.setProperty('--bd', (Math.random() * 0.3).toFixed(2) + 's'); // 错峰砸落
    fx.appendChild(s);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 950);
}
// 发声招式（叫声/唱歌/哈欠/巨声/金属音/长嚎/治愈铃声/虫鸣）：从攻击方发出扩散的声波圈，
// 圆环逐波涌向目标方向并放大淡出
// 声音招式：攻击方身边弹出原作 NoiseLine 声纹，再配合扩散声波圈
function spawnNoiseLines(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const dir = side === 'bp' ? 1 : -1;
  const url = './pe-battle/move-fx-assets/pe/Gfx_NoiseLine__32x32.png';
  const rows = [-10, 0, 10];
  rows.forEach((dy, i) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = cx + 'px';
    el.style.top = (cy + dy) + 'px';
    el.style.width = '28px';
    el.style.height = '28px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = '28px 112px';
    el.style.zIndex = '8';
    box.appendChild(el);
    let f = i === 2 ? 2 : 0;
    const timer = setInterval(() => { f = f === 0 ? 1 : f === 1 ? 0 : f === 2 ? 3 : 2; el.style.backgroundPosition = `0 -${f * 28}px`; }, 90);
    const dur = 480;
    el.animate([
      { transform: `translate(-50%,-50%) scaleX(${dir}) scale(.7)`, opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: `translate(calc(-50% + ${dir * 64}px), calc(-50% + ${dy * 0.4}px)) scaleX(${dir}) scale(1.05)`, opacity: 0 },
    ], { duration: dur, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, dur + 40);
  });
}
function spawnSoundWave(side, tSide = side === 'bp' ? 'be' : 'bp') {
  spawnNoiseLines(side);
  const from = $(`${side}-img`);
  const to = $(`${tSide}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-sonic-fx';
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.35;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.35;
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  for (let i = 0; i < 3; i++) {
    const w = document.createElement('i');
    w.style.setProperty('--bx', ((ex - sx) * 0.72).toFixed(1) + 'px');
    w.style.setProperty('--by', ((ey - sy) * 0.72).toFixed(1) + 'px');
    w.style.setProperty('--bd', (i * 0.16).toFixed(2) + 's'); // 逐波错峰
    fx.appendChild(w);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 850);
}
// 冰冻光束：从攻击方射出一道淡蓝色直线光束到对手（光线容器旋转对准目标方向，内部沿长度方向展开）
function spawnIceBeam(side) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.35;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.35;
  const dx = ex - sx, dy = ey - sy;
  const fx = document.createElement('span');
  fx.className = 'b-beam-fx';
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  fx.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`; // 旋转指向目标
  const b = document.createElement('i');
  b.style.width = Math.hypot(dx, dy) + 'px'; // 光线长度 = 攻击方到目标距离
  fx.appendChild(b);
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 450);
}
// 极光束：彩虹光束从攻击方射向对手，光束上错峰飞出一串彩虹光环（不再用原作那套看不清的圆环素材）
function spawnAuroraBeam(side) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.35;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.35;
  const dx = ex - sx, dy = ey - sy;
  const dist = Math.hypot(dx, dy);
  const fx = document.createElement('span');
  fx.className = 'b-aurora-fx';
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  fx.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`; // 光束指向目标
  const core = document.createElement('b');
  core.style.width = dist + 'px';
  fx.appendChild(core);
  for (let i = 0; i < 5; i++) {
    const r = document.createElement('i');
    r.style.setProperty('--tx', (dist * (0.5 + i * 0.12)).toFixed(1) + 'px');
    r.style.setProperty('--bd', (i * 0.07).toFixed(2) + 's');
    fx.appendChild(r);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 950);
}
// 极光束：原作极光背景，出招时浮现、光束射完淡出
let _auroraBgFx = null;
function hideAuroraBg() {
  if (_auroraBgFx) {
    _auroraBgFx.remove();
    _auroraBgFx = null;
  }
}
function spawnAuroraBg() {
  const field = document.querySelector('.battle-fight');
  if (!field) return;
  hideAuroraBg();
  const fx = document.createElement('span');
  fx.className = 'b-aurora-bg-fx';
  fx.style.backgroundImage = "url('./pe-battle/move-fx-assets/bg/bg_aurora.png')";
  field.appendChild(fx);
  _auroraBgFx = fx;
  setTimeout(() => { if (_auroraBgFx === fx) hideAuroraBg(); }, 1100);
}
// 全屏遮罩闪光（魔法闪耀/电光/精神强念）：半透明粉紫色遮罩覆盖整个战场，从中心扩散后迅速淡出（无方向性）
function spawnScreenFlash() {
  const stage = document.querySelector('.battle-fight');
  if (!stage) return;
  const fx = document.createElement('span');
  fx.className = 'b-fairy-fx';
  stage.appendChild(fx);
  setTimeout(() => fx.remove(), 420);
}
// 抓狂：攻击方左右来回平移两次，之后走普通受击
async function flailWindup(side) {
  const img = $(`${side}-img`);
  if (!img) return;
  img.style.transformOrigin = '50% 100%';
  const a = img.animate([
    { transform: 'translateX(0)' },
    { transform: 'translateX(-14px)', offset: 0.15 },
    { transform: 'translateX(14px)', offset: 0.35 },
    { transform: 'translateX(-14px)', offset: 0.55 },
    { transform: 'translateX(14px)', offset: 0.75 },
    { transform: 'translateX(0)' },
  ], { duration: 420, easing: 'ease-in-out', fill: 'both' });
  await battleSleep(440);
  a.cancel();
  img.style.transformOrigin = '';
  img.style.transform = '';
}
// 临别礼物：紫黑色柔光椭圆先在攻击方身上向上拉长，再在目标身上压缩
async function playMementoFx(side) {
  const stage = document.querySelector('.battle-fight');
  const foe = side === 'bp' ? 'be' : 'bp';
  const atk = $(`${side}-img`);
  const tgt = $(`${foe}-img`);
  if (!stage || !atk || !tgt) return;
  const sr = stage.getBoundingClientRect();
  const orb = (img) => {
    const r = img.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'b-memento-orb';
    el.style.left = (r.left - sr.left + r.width / 2) + 'px';
    el.style.top = (r.top - sr.top + r.height * 0.52) + 'px';
    el.style.width = (r.width * 1.08) + 'px';
    el.style.height = (r.height * 0.86) + 'px';
    stage.appendChild(el);
    return el;
  };
  const run = (img, frames, dur, orbFrames) => {
    img.style.transformOrigin = '50% 100%';
    const a = img.animate(frames, { duration: dur, easing: 'ease-in-out', fill: 'both' });
    const el = orb(img);
    el.animate(orbFrames, { duration: dur, easing: 'ease-in-out', fill: 'both' });
    return { a, el };
  };
  const first = run(atk, [
    { transform: 'scale(1,1)' },
    { transform: 'scale(1.06,1.45)', offset: 0.55 },
    { transform: 'scale(1.06,1.45)', offset: 0.78 },
    { transform: 'scale(1,1)' },
  ], 520, [
    { opacity: 0, transform: 'translate(-50%,-50%) scaleY(.5)' },
    { opacity: .85, transform: 'translate(-50%,-50%) scaleY(1.45)', offset: .5 },
    { opacity: .8, transform: 'translate(-50%,-50%) scaleY(1.55)', offset: .78 },
    { opacity: 0, transform: 'translate(-50%,-50%) scaleY(1.6)' },
  ]);
  await battleSleep(560);
  first.a.cancel();
  first.el.remove();
  atk.style.transformOrigin = '';
  atk.style.transform = '';
  await battleSleep(70);
  const second = run(tgt, [
    { transform: 'scale(1,1)' },
    { transform: 'scale(1.08,.5)', offset: .35 },
    { transform: 'scale(1.08,.5)', offset: .7 },
    { transform: 'scale(1,1)' },
  ], 560, [
    { opacity: 0, transform: 'translate(-50%,-50%) scaleY(1.55)' },
    { opacity: .85, transform: 'translate(-50%,-50%) scaleY(1.55)', offset: .25 },
    { opacity: .7, transform: 'translate(-50%,-50%) scaleY(.55)', offset: .7 },
    { opacity: 0, transform: 'translate(-50%,-50%) scaleY(.35)' },
  ]);
  await battleSleep(600);
  second.a.cancel();
  second.el.remove();
  tgt.style.transformOrigin = '';
  tgt.style.transform = '';
}
const SURF_WAVE_SRC = {
  bp: './pe-battle/move-fx-assets/surf-player.png',
  be: './pe-battle/move-fx-assets/surf-enemy.png',
};
function spawnSurfWave(side, tint = 'water') {
  const stage = document.querySelector('.battle-fight');
  if (!stage) return;
  const fx = document.createElement('span');
  fx.className = 'b-surf-fx ' + (side === 'bp' ? 'is-player' : 'is-enemy')
    + (tint === 'mud' ? ' is-muddy' : tint === 'sludge' ? ' is-sludge' : '');
  const water = document.createElement('span');
  water.className = 'b-surf-water';
  const wave = document.createElement('img');
  wave.className = 'b-surf-wave';
  wave.src = SURF_WAVE_SRC[side === 'bp' ? 'bp' : 'be'];
  wave.alt = '';
  water.appendChild(wave);
  fx.appendChild(water);
  if (tint === 'sludge') {
    for (let i = 0; i < 10; i++) {
      const b = document.createElement('span');
      b.className = 'b-sludge-bubble';
      b.style.left = (8 + Math.random() * 84).toFixed(1) + '%';
      b.style.bottom = (4 + Math.random() * 22).toFixed(1) + '%';
      b.style.setProperty('--bd', (Math.random() * 0.35).toFixed(2) + 's');
      b.style.setProperty('--bsz', (8 + Math.random() * 8).toFixed(0) + 'px');
      fx.appendChild(b);
    }
  }
  stage.appendChild(fx);
  setTimeout(() => fx.remove(), 1000);
}
// 风系/龙卷风类招式：彩色旋风（旋转的风团）从攻击方刮向对手，逐团错峰；
// 热风红色/妖精之风粉色/冰冻之风蓝色，其余默认青白（--fc 由 JS 传入）
function spawnWindTornado(side, color) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = 0.4;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  const url = new URL('./pe-battle/move-fx-assets/gust.png', import.meta.url).href;
  for (let i = 0; i < 3; i++) {
    const el = document.createElement('span');
    el.className = 'b-gust-stream';
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.style.backgroundImage = `url(${url})`;
    if (color) el.style.filter = `drop-shadow(0 0 6px ${color})`;
    box.appendChild(el);
    let frame = 0;
    const timer = setInterval(() => {
      frame = (frame + 1) % 2;
      el.style.backgroundPosition = `0 -${frame * 32}px`;
    }, 90);
    const dx = ex - sx + (Math.random() * 28 - 14);
    const dy = ey - sy + (Math.random() * 16 - 8);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.8)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(dx * .45).toFixed(1)}px), calc(-50% + ${(dy * .45).toFixed(1)}px)) scale(1)`, opacity: .75, offset: .4 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1.2)`, opacity: 0 },
    ], { duration: 500, delay: i * 100, easing: 'linear', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 500 + i * 100 + 120);
  }
}
// 龙系特殊招式（龙息/龙之波动/流星群/时光咆哮/亚空裂斩/鳞片噪音/巨龙威能/归无之光/随机光）：
// 一团紫蓝色龙息能量粒子，起点聚拢成团，飞向目标途中逐渐散开（动画见 .b-dragon-fx）
// 冰冻之风：白色柔光雾气从攻击方喷向对手
function spawnFireBurst(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = new URL('./pe-battle/move-fx-assets/fire_plume.png', import.meta.url).href;
  for (let i = 0; i < 7; i++) {
    const el = document.createElement('span');
    el.className = 'b-fire-burst';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.backgroundImage = `url(${url})`;
    box.appendChild(el);
    let frame = 0;
    const timer = setInterval(() => {
      frame = (frame + 1) % 5;
      el.style.backgroundPosition = `0 -${frame * 32}px`;
    }, 90);
    const ang = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 30;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - 8;
    const s0 = .45 + Math.random() * .3;
    const s1 = .8 + Math.random() * .5;
    el.animate([
      { transform: `translate(-50%,-50%) scale(${s0})`, opacity: 0 },
      { transform: `translate(calc(-50% + ${(dx * .45).toFixed(1)}px), calc(-50% + ${(dy * .45).toFixed(1)}px)) scale(${s1})`, opacity: 1, offset: .35 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(${s0})`, opacity: 0 },
    ], { duration: 360 + Math.random() * 120, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 620);
  }
}
function spawnImpactTint(side, color) {
  if (!color) return;
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'b-impact-tint';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  el.style.background = `radial-gradient(circle, ${color} 0%, ${color}66 38%, transparent 70%)`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 340);
}
function spawnWaterImpact(tSide) {
  const img = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!img || !box) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const el = document.createElement('span');
  el.style.position = 'absolute';
  el.style.zIndex = '9';
  el.style.width = '32px';
  el.style.height = '32px';
  el.style.pointerEvents = 'none';
  el.style.imageRendering = 'pixelated';
  el.style.backgroundImage = `url(${new URL('./pe-battle/move-fx-assets/pe/Gfx_WaterImpact__32x32.png', import.meta.url).href})`;
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  box.appendChild(el);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.55)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.35)', opacity: 1, offset: .3 },
    { transform: 'translate(-50%,-50%) scale(1.55)', opacity: 0 },
  ], { duration: 280, easing: 'ease-out', fill: 'both' });
  setTimeout(() => el.remove(), 320);
}
// 蟹钳锤小气泡：原作 gSmallBubblePair（Gfx_IceCrystals 第 12/13 帧）围目标错峰上浮
function spawnSmallBubblesFx(tSide) {
  const img = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!img || !box) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = "url('./pe-battle/move-fx-assets/pe/Gfx_IceCrystals__8x8.png')";
  const offs = [[10, 10], [20, -20], [-15, 15], [0, 0], [-10, -20], [16, -8], [5, 8], [-16, 0]];
  offs.forEach(([ox, oy], i) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + ox) + 'px';
    el.style.top = (cy + oy) + 'px';
    el.style.width = '10px';
    el.style.height = '10px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = '10px 140px'; // 14 帧，第 12/13 帧是气泡
    el.style.zIndex = '10';
    box.appendChild(el);
    let frame = 12;
    const timer = setInterval(() => {
      frame = frame === 12 ? 13 : 12;
      el.style.backgroundPosition = `0 -${frame * 10}px`;
    }, 70);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { opacity: 1, offset: .2 },
      { transform: `translate(calc(-50% + ${(Math.random() * 8 - 4).toFixed(1)}px), calc(-50% - ${20 + Math.random() * 14}px)) scale(1)`, opacity: 0 },
    ], { duration: 520, delay: i * 40, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 560 + i * 40);
  });
}
function spawnHydroOrbStream(side) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.42;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.42;
  const url = new URL('./pe-battle/move-fx-assets/pe/Gfx_WaterOrb__16x16.png', import.meta.url).href;
  for (let i = 0; i < 7; i++) {
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.zIndex = '8';
    el.style.width = '16px';
    el.style.height = '16px';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = '16px 64px';
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    box.appendChild(el);
    let frame = 0;
    const timer = setInterval(() => {
      frame = (frame + 1) % 4;
      el.style.backgroundPosition = `0 -${frame * 16}px`;
    }, 70);
    const dx = ex - sx + (Math.random() * 16 - 8);
    const dy = ey - sy + (Math.random() * 10 - 5);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { opacity: .95, offset: .2 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1)`, opacity: 0 },
    ], { duration: 420, delay: i * 55, easing: 'linear', fill: 'both' });
    setTimeout(() => spawnWaterImpact(side === 'bp' ? 'be' : 'bp'), 420 + i * 55);
    setTimeout(() => { clearInterval(timer); el.remove(); }, 420 + i * 55 + 100);
  }
}
function spawnBrineRain(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const top = ir.top - br.top;
  const fall = ir.height * 0.55 + 8;
  const url = new URL('./pe-battle/move-fx-assets/bubble.png', import.meta.url).href;
  for (let i = 0; i < 10; i++) {
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.zIndex = '8';
    el.style.width = '16px';
    el.style.height = '16px';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = '16px 48px';
    el.style.left = (cx + randInt(-24, 24)) + 'px';
    el.style.top = (top - 70 - randInt(0, 40)) + 'px';
    box.appendChild(el);
    let frame = 0;
    const timer = setInterval(() => {
      frame = (frame + 1) % 3;
      el.style.backgroundPosition = `0 -${frame * 16}px`;
    }, 90);
    const dur = 360 + randInt(0, 140);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.75)', opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: `translate(-50%, calc(-50% + ${fall.toFixed(0)}px)) scale(1)`, opacity: 0 },
    ], { duration: dur, delay: i * 35, easing: 'ease-in', fill: 'both' });
    setTimeout(() => spawnWaterImpact(tSide), dur + i * 35 + 40);
    setTimeout(() => { clearInterval(timer); el.remove(); }, dur + i * 35 + 80);
  }
}
function spawnAquaRing(side) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const host = document.createElement('span');
  host.className = 'b-aqua-ring';
  host.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  host.style.top = (ir.top - br.top + ir.height * 0.5) + 'px';
  box.appendChild(host);
  const band = document.createElement('span');
  band.className = 'aqua-band';
  host.appendChild(band);
  const drops = [];
  for (let i = 0; i < 10; i++) {
    const el = document.createElement('span');
    el.className = 'aqua-drop';
    host.appendChild(el);
    drops.push({ el, phase: (i / 10) * Math.PI * 2 });
  }
  const start = performance.now();
  const dur = 900;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const spin = t * Math.PI * 2 * 1.15;
    for (const d of drops) {
      const ang = spin + d.phase;
      const x = Math.cos(ang) * 34;
      const y = Math.sin(ang) * 13 + Math.sin(ang * 2) * 2;
      d.el.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px))`;
    }
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(() => host.remove(), 980);
}
// 缩入壳中：上下两片水色壳盖合拢把宝可梦收进去（本体同步压扁变暗），
// 闭合瞬间闪白，停顿后张开并向外推出一圈防御脉冲
function spawnShellTuckFx(side) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const host = document.createElement('span');
  host.className = 'b-shell-fx';
  host.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  host.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  host.style.width = Math.max(30, Math.round(ir.width * 1.35)) + 'px';
  host.style.height = Math.max(28, Math.round(ir.height * 1.1)) + 'px';
  host.innerHTML = '<i class="b-shell-half is-top"></i><i class="b-shell-half is-bottom"></i>'
    + '<i class="b-shell-flash"></i><i class="b-shell-pulse"></i>';
  box.appendChild(host);
  playAnim(side, 'shell-tuck'); // 本体缩一下：壳合拢时看得出"钻进去"
  setTimeout(() => host.remove(), 1250);
}
function spawnMistStream(side) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = 0.4;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  for (let i = 0; i < 10; i++) {
    const el = document.createElement('span');
    el.className = 'b-mist-stream';
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    box.appendChild(el);
    const dx = ex - sx + (Math.random() * 28 - 14);
    const dy = ey - sy + (Math.random() * 14 - 7);
    const dur = 480 + Math.random() * 180;
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(dx * .45).toFixed(1)}px), calc(-50% + ${(dy * .45).toFixed(1)}px)) scale(1.15)`, opacity: .85, offset: .4 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1.45)`, opacity: 0 },
    ], { duration: dur, delay: i * 45, easing: 'linear', fill: 'both' });
    setTimeout(() => el.remove(), dur + i * 45 + 120);
  }
}
function spawnDragonWave(side) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.38; // 攻击方躯干中心
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.38;
  const fx = document.createElement('span');
  fx.className = 'b-dragon-fx';
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('i');
    const spread = Math.random() * 26; // 终点散开幅度
    const ang = Math.random() * Math.PI * 2;
    p.style.setProperty('--bx', (ex - sx + Math.cos(ang) * spread).toFixed(1) + 'px');
    p.style.setProperty('--by', (ey - sy + Math.sin(ang) * spread).toFixed(1) + 'px');
    p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's'; // 错峰出发
    p.style.animationDuration = (0.5 + Math.random() * 0.15).toFixed(2) + 's';
    fx.appendChild(p);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 750);
}
// 吸血粒子：从来源精灵身上飞出一串原作吸收光球，收拢吸回目标。
function spawnDrainParticles(fromSide, toSide, count = 10) {
  const from = $(`${fromSide}-img`);
  const to = $(`${toSide}-img`);
  const box = $(`${toSide}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.4; // 来源精灵躯干中心
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.4;
  const url = new URL('./pe-battle/move-fx-assets/pe/Gfx_Orbs__16x16.png', import.meta.url).href;
  for (let i = 0; i < count; i++) {
    const size = 14 + randInt(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = sx + 'px';
    el.style.top = (sy + randInt(-5, 5)) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 3}px`;
    el.style.backgroundPosition = `0 -${2 * size}px`;
    el.style.filter = 'drop-shadow(0 0 5px rgba(150, 225, 255, .8))';
    el.style.zIndex = '9';
    el.style.pointerEvents = 'none';
    box.appendChild(el);
    const spread = randInt(0, 20);
    const ang = Math.random() * Math.PI * 2;
    const dx = ex - sx + Math.cos(ang) * spread;
    const dy = ey - sy + Math.sin(ang) * spread;
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.45)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .16 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(.55)`, opacity: 0 },
    ], { duration: 480, delay: i * 22, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), 540 + i * 22);
  }
}
function spawnFireBlastShot(side) {
  const tSide = side === 'bp' ? 'be' : 'bp';
  const from = $(`${side}-img`);
  const to = $(`${tSide}-img`);
  const box = $(`${tSide}-box`);
  if (!from || !to || !box) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height / 2;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height / 2;
  const size = 42;
  const url = new URL('./pe-battle/move-fx-assets/pe/Gfx_FirePlume__32x32.png', import.meta.url).href;
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = sx + 'px';
  el.style.top = sy + 'px';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.backgroundImage = `url(${url})`;
  el.style.backgroundSize = `${size}px ${size * 5}px`;
  el.style.zIndex = '10';
  box.appendChild(el);
  let f = 0;
  const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * size}px`; }, 70);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.55)', opacity: 0 },
    { opacity: 1, offset: .12 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) scale(1)`, opacity: 1, offset: .92 },
    { transform: `translate(calc(-50% + ${(ex - sx).toFixed(1)}px), calc(-50% + ${(ey - sy).toFixed(1)}px)) scale(1.15)`, opacity: 0 },
  ], { duration: 330, easing: 'linear', fill: 'both' });
  setTimeout(() => { clearInterval(timer); el.remove(); }, 380);
  return new Promise((resolve) => setTimeout(resolve, 350));
}
function spawnFireBigExplosion(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.46;
  const big = Math.max(74, Math.min(118, ir.width * 0.8));
  const half = big / 2;
  const pts = [
    [-half, -half * 0.38], [-half * 0.5, -half * 0.38], [0, -half * 0.38], [half * 0.5, -half * 0.38], [half, -half * 0.38],
    [0, -half * 0.42], [-half * 0.28, -half * 0.08], [-half * 0.55, half * 0.35], [-half * 0.78, half * 0.78],
    [0, -half * 0.42], [half * 0.28, -half * 0.08], [half * 0.55, half * 0.35], [half * 0.78, half * 0.78],
  ];
  const url = new URL('./pe-battle/move-fx-assets/pe/Gfx_FirePlume__32x32.png', import.meta.url).href;
  pts.forEach(([dx, dy], i) => {
    const size = 24 + randInt(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + dx) + 'px';
    el.style.top = (cy + dy) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 5}px`;
    el.style.backgroundPosition = `0 -${randInt(0, 4) * size}px`;
    el.style.zIndex = '10';
    box.appendChild(el);
    let f = randInt(0, 4);
    const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * size}px`; }, 70);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.35)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.12)', opacity: 1, offset: .22 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
    ], { duration: 420, delay: i * 18, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 500 + i * 18);
  });
}
// 花瓣舞：花朵和花瓣都使用特效素材，前后分层绕目标旋转
function spawnPetalDanceFx(targetSide) {
  const box = $(`${targetSide}-box`);
  const img = $(`${targetSide}-img`);
  if (!box || !img) return Promise.resolve();
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.46;
  const back = document.createElement('span');
  const front = document.createElement('span');
  back.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none';
  front.style.cssText = 'position:absolute;inset:0;z-index:9;pointer-events:none';
  box.insertBefore(back, box.firstChild);
  box.appendChild(front);
  const petalUrl = new URL('./pe-battle/move-fx-assets/pe/Gfx_PinkPetal__8x8.png', import.meta.url).href;
  const bigFlowerUrl = new URL('./pe-battle/move-fx-assets/pe/Gfx_Flower__16x16.png', import.meta.url).href;
  const smallFlowerUrl = new URL('./pe-battle/move-fx-assets/pe/Gfx_Flower__8x8.png', import.meta.url).href;
  const parts = [];
  const add = (kind) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = '0';
    el.style.top = '0';
    el.style.zIndex = '0';
    let size = 12 + randInt(0, 3);
    let frames = 4;
    if (kind === 'big') { size = 22 + randInt(0, 5); frames = 1; el.style.backgroundImage = `url(${bigFlowerUrl})`; }
    else if (kind === 'small') { size = 13 + randInt(0, 3); frames = 5; el.style.backgroundImage = `url(${smallFlowerUrl})`; }
    else el.style.backgroundImage = `url(${petalUrl})`;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundSize = `${size}px ${size * frames}px`;
    el.style.backgroundPosition = `0 -${randInt(0, frames - 1) * size}px`;
    back.appendChild(el);
    if (frames > 1) {
      let f = randInt(0, frames - 1);
      el._timer = setInterval(() => { f = (f + 1) % frames; el.style.backgroundPosition = `0 -${f * size}px`; }, 80);
    }
    parts.push({
      el,
      phase: (parts.length / 19) * Math.PI * 2 + Math.random() * 0.6,
      r: (kind === 'petal' ? 48 : 42) * (0.75 + Math.random() * 0.35),
      spin: kind === 'petal' ? 1.8 + Math.random() * 0.9 : 0.7 + Math.random() * 0.6,
      bob: randInt(0, 8),
      rise: kind === 'petal' ? 26 : 18,
      kind,
    });
  };
  for (let i = 0; i < 12; i++) add('petal');
  for (let i = 0; i < 3; i++) add('big');
  for (let i = 0; i < 4; i++) add('small');
  const dur = 1050;
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      for (const p of parts) {
        const ang = p.phase + t * Math.PI * 2 * p.spin;
        const depth = Math.sin(ang);
        const x = cx + Math.cos(ang) * p.r * (1 - t * 0.3);
        const y = cy + Math.sin(ang) * (p.kind === 'petal' ? 15 : 13) * (1 - t * 0.15) - t * p.rise + p.bob;
        const sc = p.kind === 'petal' ? 0.7 + 0.3 * Math.cos(ang) : 0.9 + 0.15 * Math.cos(ang);
        p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) rotate(${(ang * (p.kind === 'petal' ? 57.3 : 22)).toFixed(0)}deg) scale(${sc.toFixed(2)})`;
        p.el.style.opacity = String(Math.min(1, t * 5) * (t > 0.82 ? (1 - t) / 0.18 : 1));
        const dest = depth < 0 ? back : front;
        if (p.el.parentNode !== dest) dest.appendChild(p.el);
      }
      if (t < 1) requestAnimationFrame(tick);
      else {
        for (const p of parts) {
          if (p.el._timer) clearInterval(p.el._timer);
          p.el.remove();
        }
        back.remove();
        front.remove();
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}
// 吸取之吻：目标处粉色爱心炸开，再顺着连线飞回攻击方
function spawnDrainingKissFx(atkSide, tSide) {
  const tBox = $(`${tSide}-box`);
  const tImg = $(`${tSide}-img`);
  const aImg = $(`${atkSide}-img`);
  if (!tBox || !tImg || !aImg) return;
  const br = tBox.getBoundingClientRect();
  const tr = tImg.getBoundingClientRect();
  const ar = aImg.getBoundingClientRect();
  const cx = tr.left - br.left + tr.width / 2;
  const cy = tr.top - br.top + tr.height / 2;
  const ax = ar.left - br.left + ar.width / 2;
  const ay = ar.top - br.top + ar.height / 2;
  for (let i = 0; i < 8; i++) {
    const h = document.createElement('span');
    h.style.position = 'absolute';
    h.style.zIndex = '9';
    h.style.left = cx + 'px';
    h.style.top = cy + 'px';
    h.style.width = '14px';
    h.style.height = '14px';
    h.style.pointerEvents = 'none';
    h.style.color = '#ff78b8';
    h.style.filter = 'drop-shadow(0 0 3px #ff78b8)';
    h.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><use xlink:href="#icon-liked"/></svg>';
    tBox.appendChild(h);
    const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
    const burst = 12 + Math.random() * 12;
    const dx = Math.cos(ang) * burst;
    const dy = Math.sin(ang) * burst;
    h.animate([
      { transform: 'translate(-50%, -50%) scale(.25)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1)`, opacity: 1, offset: .3 },
      { transform: `translate(calc(-50% + ${(ax - cx).toFixed(1)}px), calc(-50% + ${(ay - cy).toFixed(1)}px)) scale(.65)`, opacity: 0 },
    ], { duration: 420, delay: i * 22, easing: 'ease-out', fill: 'both' });
    setTimeout(() => h.remove(), 520 + i * 22);
  }
}
// 超能系命中：目标身上产生一个扭动变形的粉色圆环，和 impact 同时叠放
function spawnPsychicWrap(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-psy-fx';
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height * 0.35) + 'px'; // 目标身体中心
  fx.appendChild(document.createElement('i'));
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 950);
}
// 牙类招式：Gfx_FangAttack 上下牙合拢
function spawnFangBite(tSide, name) {
  const color = FANG_COLORS[name];
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!color || !box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = "url('./pe-battle/move-fx-assets/pe/Gfx_SharpTeeth__64x64.png')";
  const makeJaw = (mirror) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.width = '64px';
    el.style.height = '64px';
    el.style.backgroundImage = url;
    el.style.zIndex = '10';
    box.appendChild(el);
    const start = mirror ? 'translate(-50%, -50%) translateY(28px) scaleY(-1)' : 'translate(-50%, -50%) translateY(-28px)';
    const close = mirror ? 'translate(-50%, -50%) scaleY(-1)' : 'translate(-50%, -50%)';
    const hot = name === '剧毒牙';
    const biteFilter = hot
      ? 'sepia(1) saturate(4) hue-rotate(250deg) brightness(1.08)'
      : `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 8px ${color})`;
    el.animate([
      { transform: start, opacity: 0, filter: 'none' },
      { transform: close, opacity: 1, filter: biteFilter, offset: 0.38 },
      { transform: close, opacity: 0, filter: biteFilter },
    ], { duration: 460, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), 520);
  };
  makeJaw(false);
  makeJaw(true);
}
// 拍落/小偷/渴望：Gfx_TagHand 下半只手，左右对称夹击目标两侧
function spawnClampHands(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.44;
  const edge = ir.width / 2 + 2;
  const url = "url('./pe-battle/move-fx-assets/pe/Gfx_TagHand__32x32.png')";
  const makeHand = (dir) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + dir * edge) + 'px';
    el.style.top = cy + 'px';
    el.style.width = '32px';
    el.style.height = '32px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = '32px 64px';
    el.style.backgroundPosition = '0 -32px';
    el.style.zIndex = '10';
    box.appendChild(el);
    const flip = dir > 0 ? ' scaleX(-1)' : '';
    const base = `translate(-50%,-50%) translateX(${dir * 40}px)${flip} rotate(8deg)`;
    const hit = `translate(-50%,-50%)${flip} rotate(8deg) scale(1.08)`;
    const press = `translate(-50%,-50%) translateX(${-dir * 3}px)${flip} rotate(8deg) scale(1.08)`;
    const out = `translate(-50%,-50%) translateX(${dir * 34}px)${flip} rotate(8deg)`;
    el.animate([
      { transform: base, opacity: 0, easing: 'ease-in' },
      { transform: hit, opacity: 1, offset: 0.42 },
      { transform: press, opacity: 1, offset: 0.6 },
      { transform: out, opacity: 0, easing: 'ease-out' },
    ], { duration: 420, fill: 'both' });
    setTimeout(() => el.remove(), 460);
  };
  makeHand(-1);
  makeHand(1);
}
// 紧束/绑紧/缠绕：原作 Gfx_Tendrils 四帧藤蔓缠住目标，左右交错收紧两轮（约 0.56s）
function spawnBindWrapFx(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const scale = Math.max(0.8, Math.min(1.35, ir.width / 64)); // 藤蔓宽度跟随目标体型
  const sway = 11 * scale;
  const el = document.createElement('span');
  el.className = 'fx-orig b-bind-wrap';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height * 0.55) + 'px';
  el.style.width = 64 * scale + 'px';
  el.style.height = 32 * scale + 'px';
  el.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_Tendrils__64x32.png')";
  el.style.backgroundSize = `${64 * scale}px ${128 * scale}px`;
  el.style.backgroundPosition = '0 0';
  el.style.zIndex = '10';
  box.appendChild(el);
  // 四帧 ×4 tick 循环两轮，与原作 an 数据一致
  let frame = 0;
  const timer = setInterval(() => {
    frame = (frame + 1) % 4;
    el.style.backgroundPosition = `0 ${-32 * scale * frame}px`;
  }, 66);
  const anim = el.animate([
    { transform: 'translate(-50%,-50%) scale(0.86)', opacity: 0 },
    { transform: `translate(-50%,-50%) translateX(${-sway}px) scale(1)`, opacity: 1, offset: 0.14 },
    { transform: `translate(-50%,-50%) translateX(${sway}px) scale(1.04)`, opacity: 1, offset: 0.32 },
    { transform: `translate(-50%,-50%) translateX(${-sway}px) scale(1.04)`, opacity: 1, offset: 0.52 },
    { transform: `translate(-50%,-50%) translateX(${sway}px) scale(1.04)`, opacity: 1, offset: 0.72 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.84 },
    { transform: 'translate(-50%,-50%) scale(0.92)', opacity: 0 },
  ], { duration: 560, easing: 'ease-in-out', fill: 'both' });
  // 目标同步被勒紧：横向压、纵向拉
  const squeeze = img.animate([
    { transform: 'scale(1, 1)' },
    { transform: 'scale(0.94, 1.06)', offset: 0.2 },
    { transform: 'scale(1.04, 0.96)', offset: 0.38 },
    { transform: 'scale(0.96, 1.04)', offset: 0.56 },
    { transform: 'scale(1, 1)' },
  ], { duration: 560, easing: 'ease-in-out' });
  const done = () => {
    clearInterval(timer);
    anim.cancel();
    squeeze.cancel();
    el.remove();
  };
  anim.onfinish = done;
  setTimeout(done, 650); // 兜底：动画被中断也要收掉
}
// 喝牛奶：增益瓶始终在施放者自己身上，玩家右侧、对手左侧，瓶口转向自身中心
function spawnMilkDrinkFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const dir = side === 'bp' ? 1 : -1;
  const bx = cx + dir * 20;
  const by = cy - 14;
  let aim = (Math.atan2(cy - by, cx - bx) * 180) / Math.PI + 90;
  if (aim > 180) aim -= 360;
  if (aim < -180) aim += 360;
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = bx + 'px';
  el.style.top = by + 'px';
  el.style.width = '32px';
  el.style.height = '32px';
  el.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_MilkBottle__32x32.png')";
  el.style.backgroundSize = '32px 32px';
  el.style.zIndex = '10';
  box.appendChild(el);
  el.animate([
    { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 0 },
    { opacity: 1, offset: .12 },
    { transform: `translate(-50%,-50%) rotate(${aim.toFixed(1)}deg)`, offset: .34 },
    { transform: `translate(-50%,-50%) rotate(${(aim * 0.92).toFixed(1)}deg)`, offset: .62 },
    { transform: `translate(-50%,-50%) rotate(${(aim * 1.06).toFixed(1)}deg)`, opacity: 1, offset: .82 },
    { transform: `translate(-50%,-50%) rotate(${aim.toFixed(1)}deg)`, opacity: 0 },
  ], { duration: 780, easing: 'ease-in-out', fill: 'both' });
  setTimeout(() => el.remove(), 820);
}
// 龙卷风：从目标脚下卷起树叶和碎石，螺旋上升到目标身上
function spawnTwisterFx(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.42;
  const groundY = ir.top - br.top + ir.height * 0.96;
  const leafUrl = "url('./pe-battle/move-fx-assets/pe/Gfx_Leaf__16x16.png')";
  const rockUrl = "url('./pe-battle/move-fx-assets/pe/Gfx_Rocks__32x32.png')";
  for (let i = 0; i < 12; i++) {
    const rock = i >= 8;
    const el = document.createElement('span');
    el.className = 'fx-orig';
    const size = rock ? 28 + randInt(0, 10) : 16 + randInt(0, 6);
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.backgroundImage = rock ? rockUrl : leafUrl;
    el.style.backgroundSize = `${size}px ${size * (rock ? 6 : 9)}px`;
    el.style.backgroundPosition = `0 -${randInt(0, rock ? 5 : 8) * size}px`;
    el.style.zIndex = '10';
    el.style.transform = 'translate(-50%,-50%)';
    box.appendChild(el);
    const ang = Math.random() * Math.PI * 2;
    const radius = 44 + randInt(0, 26);
    const dy0 = groundY - cy + randInt(0, 14);
    const a1 = ang + Math.PI * 0.9;
    const a2 = ang + Math.PI * 1.7;
    const delay = randInt(0, 160) + (rock ? 40 : 0);
    const dur = 520 + randInt(0, 160);
    el.animate([
      { transform: `translate(-50%,-50%) translate(${(Math.cos(ang) * 14).toFixed(1)}px, ${dy0.toFixed(1)}px) rotate(0deg) scale(.55)`, opacity: 0 },
      { opacity: 1, offset: .14 },
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a1) * radius).toFixed(1)}px, ${(dy0 * 0.62 + Math.sin(a1) * 10).toFixed(1)}px) rotate(170deg) scale(1)`, offset: .42 },
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a2) * radius * 0.42).toFixed(1)}px, ${(dy0 * 0.25 + Math.sin(a2) * 7).toFixed(1)}px) rotate(310deg) scale(1.12)`, offset: .7 },
      { transform: 'translate(-50%,-50%) translate(0, 0) rotate(420deg) scale(1.2)', opacity: 0 },
    ], { duration: dur, delay, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), dur + delay + 30);
  }
}
// 黑雾：整片暗雾横扫战场，配合压暗遮罩
function spawnHazeFx() {
  const field = document.querySelector('.battle-fight');
  if (!field) return;
  const fr = field.getBoundingClientRect();
  const url = './pe-battle/move-fx-assets/pe/Gfx_GraySmoke__32x32.png';
  const shade = document.createElement('span');
  shade.style.position = 'absolute';
  shade.style.inset = '0';
  shade.style.zIndex = '6';
  shade.style.background = 'rgba(8, 8, 14, 0.42)';
  shade.style.opacity = '0';
  shade.style.pointerEvents = 'none';
  field.appendChild(shade);
  shade.animate([{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: 1, offset: .65 }, { opacity: 0 }], { duration: 950, fill: 'both' });
  setTimeout(() => shade.remove(), 1000);
  for (let i = 0; i < 12; i++) {
    const dir = i % 2 ? 1 : -1;
    const w = 60 + randInt(0, 50);
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.left = (dir > 0 ? -w / 2 : fr.width + w / 2) + 'px';
    el.style.top = fr.height * (0.12 + Math.random() * 0.7) + 'px';
    el.style.width = w + 'px';
    el.style.height = w + 'px';
    el.style.zIndex = '7';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${w}px ${w * 5}px`;
    el.style.filter = 'brightness(.2) saturate(.12)';
    el.style.opacity = '0';
    field.appendChild(el);
    let f = randInt(0, 4);
    const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * w}px`; }, 80);
    const dur = 900 + randInt(0, 260);
    el.animate([
      { transform: 'translate(-50%,-50%) translateX(0)', opacity: 0 },
      { opacity: .9, offset: .2 },
      { transform: `translate(-50%,-50%) translateX(${dir * (fr.width + w) * 0.55}px)`, opacity: .85, offset: .6 },
      { transform: `translate(-50%,-50%) translateX(${dir * (fr.width + w)}px)`, opacity: 0 },
    ], { duration: dur, easing: 'linear', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, dur + 50);
  }
}
// 蓝色星星粒子：自身强化/月光类招式复用
function spawnBlueStarBurst(side, count = 8) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = './pe-battle/move-fx-assets/pe/Gfx_BlueStar__32x32.png';
  for (let i = 0; i < count; i++) {
    const size = 20 + randInt(0, 12);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + randInt(-Math.round(ir.width * 0.35), Math.round(ir.width * 0.35))) + 'px';
    el.style.top = (cy + randInt(-Math.round(ir.height * 0.3), Math.round(ir.height * 0.25))) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 7}px`;
    el.style.backgroundPosition = `0 -${randInt(0, 6) * size}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    let f = randInt(0, 6);
    const timer = setInterval(() => { f = (f + 1) % 7; el.style.backgroundPosition = `0 -${f * size}px`; }, 70);
    el.animate([
      { transform: 'translate(-50%,-50%) translateY(8px) scale(.5)', opacity: 0 },
      { opacity: 1, offset: .2 },
      { transform: 'translate(-50%,-50%) translateY(-28px) scale(1.1) rotate(120deg)', opacity: 0 },
    ], { duration: 780, delay: i * 45, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 850 + i * 45);
  }
}
// 岩石封锁：四块岩石从脚下升起围住目标，最后在目标中心打叉
function spawnRockTombFx(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const groundY = ir.top - br.top + ir.height * 0.96;
  const url = './pe-battle/move-fx-assets/pe/Gfx_Rocks__32x32.png';
  const spots = [[-0.34, -0.05], [0.34, -0.05], [-0.27, 0.22], [0.27, 0.22]];
  spots.forEach(([dx, dy], i) => {
    const size = 34 + randInt(0, 10);
    const endX = cx + dx * ir.width;
    const endY = cy + dy * ir.height;
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = endX + 'px';
    el.style.top = endY + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${randInt(0, 5) * size}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    el.animate([
      { transform: `translate(-50%,-50%) translateY(${(groundY - endY).toFixed(0)}px) scale(.7) rotate(0deg)`, opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: 'translate(-50%,-50%) translateY(0) scale(1) rotate(180deg)', opacity: 1, offset: .8 },
      { transform: 'translate(-50%,-50%) translateY(0) scale(1) rotate(180deg)', opacity: 0 },
    ], { duration: 520, delay: i * 40, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), 580 + i * 40);
  });
}
function spawnXMark(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  el.style.width = '56px';
  el.style.height = '56px';
  el.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_XSign__64x64.png')";
  el.style.backgroundSize = '56px 56px';
  el.style.zIndex = '10';
  box.appendChild(el);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.35)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.12)', opacity: 1, offset: .45 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .7 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
  ], { duration: 520, fill: 'both' });
  setTimeout(() => el.remove(), 560);
}
// 尖石攻击/岩石炮等：石块沿抛物线从攻击方砸向目标
function spawnStoneBarrageFx(atkSide, tSide, count = 6) {
  const box = $(`${tSide}-box`);
  const from = $(`${atkSide}-img`);
  const to = $(`${tSide}-img`);
  if (!box || !from || !to) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = fr.left - br.left + fr.width / 2;
  const yk = 0.4;
  const sy = fr.top - br.top + fr.height * yk;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * yk;
  const url = './pe-battle/move-fx-assets/pe/Gfx_Rocks__32x32.png';
  for (let i = 0; i < count; i++) {
    const size = 26 + randInt(0, 12);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${randInt(0, 5) * size}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    const tx = ex + randInt(-18, 18);
    const ty = ey + randInt(-12, 12);
    el.animate([
      { transform: 'translate(-50%,-50%) translate(0,0) rotate(0deg)', opacity: 0 },
      { opacity: 1, offset: .12 },
      { transform: `translate(-50%,-50%) translate(${((tx - sx) * .5).toFixed(1)}px, ${((ty - sy) * .5 - 90).toFixed(1)}px) rotate(220deg)`, opacity: 1, offset: .55 },
      { transform: `translate(-50%,-50%) translate(${(tx - sx).toFixed(1)}px, ${(ty - sy).toFixed(1)}px) rotate(400deg)`, opacity: 0 },
    ], { duration: 560, delay: i * 45, easing: 'ease-in', fill: 'both' });
    setTimeout(() => el.remove(), 620 + i * 45);
  }
}
// 月亮：压黑背景显示月亮，月光用自身蓝星，月亮之力用蓝星飞向目标
function spawnMoonFx(side, tSide, mode) {
  const field = document.querySelector('.battle-fight');
  if (!field) return;
  const fr = field.getBoundingClientRect();
  const shade = document.createElement('span');
  shade.style.position = 'absolute';
  shade.style.inset = '0';
  shade.style.zIndex = '6';
  shade.style.background = '#050510';
  shade.style.opacity = '0';
  shade.style.pointerEvents = 'none';
  field.appendChild(shade);
  shade.animate([{ opacity: 0 }, { opacity: .58, offset: .25 }, { opacity: .58, offset: .75 }, { opacity: 0 }], { duration: 950, fill: 'both' });
  setTimeout(() => shade.remove(), 1000);
  const moon = document.createElement('span');
  moon.className = 'fx-orig';
  moon.style.left = (fr.width / 2) + 'px';
  moon.style.top = (fr.height * 0.16) + 'px';
  moon.style.width = '96px';
  moon.style.height = '96px';
  moon.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_Moon__64x64.png')";
  moon.style.backgroundSize = '96px 96px';
  moon.style.zIndex = '7';
  field.appendChild(moon);
  moon.animate([
    { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .25 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .75 },
    { transform: 'translate(-50%,-50%) scale(.8)', opacity: 0 },
  ], { duration: 950, fill: 'both' });
  setTimeout(() => moon.remove(), 1000);
  if (mode === 'heal') {
    spawnBlueStarBurst(side, 10);
    return;
  }
  const box = $(`${tSide}-box`);
  const tgt = $(`${tSide}-img`);
  if (!box || !tgt) return;
  const tr = tgt.getBoundingClientRect();
  // 粒子挂在 .battle-fight 上，落点必须用战场坐标；以前拿目标 box 的坐标当战场坐标，方向会乱飞
  const tx = tr.left - fr.left + tr.width / 2;
  const ty = tr.top - fr.top + tr.height / 2;
  const mx = fr.width / 2;
  const my = fr.height * 0.16;
  const url = './pe-battle/move-fx-assets/pe/Gfx_BlueStar__32x32.png';
  for (let i = 0; i < 8; i++) {
    const size = 18 + randInt(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = mx + 'px';
    el.style.top = my + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 7}px`;
    el.style.zIndex = '9';
    field.appendChild(el);
    let f = randInt(0, 6);
    const timer = setInterval(() => { f = (f + 1) % 7; el.style.backgroundPosition = `0 -${f * size}px`; }, 70);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
      { opacity: 1, offset: .15 },
      { transform: `translate(calc(-50% + ${((tx - mx) * .5).toFixed(1)}px), calc(-50% + ${((ty - my) * .5).toFixed(1)}px)) scale(1.1) rotate(160deg)`, opacity: 1, offset: .55 },
      { transform: `translate(calc(-50% + ${(tx - mx).toFixed(1)}px), calc(-50% + ${(ty - my).toFixed(1)}px)) scale(.8) rotate(300deg)`, opacity: 0 },
    ], { duration: 620, delay: 120 + i * 55, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 820 + i * 55);
  }
}
// 地球上投后半段：显隐攻击方，临时替身在对手位置随背景一起下坠
// 地球上投命中后：背景浮现，攻击方从贴身位置向下滑出，结束后回原位
// 地球上投命中后：攻击方先钻到对手下方上顶，再随背景一起坠出画面
function spawnSeismicRocks(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = './pe-battle/move-fx-assets/pe/Gfx_Rocks__32x32.png';
  for (let i = 0; i < 7; i++) {
    const size = 14 + randInt(0, 10);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + randInt(-18, 18)) + 'px';
    el.style.top = (cy + randInt(-16, 16)) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = `${size}px ${size * 6}px`;
    el.style.backgroundPosition = `0 -${randInt(0, 5) * size}px`;
    el.style.zIndex = '9';
    box.appendChild(el);
    const ang = Math.random() * Math.PI * 2;
    const dist = 30 + randInt(0, 45);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.5) rotate(0deg)', opacity: 0 },
      { opacity: 1, offset: .15 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist - 35).toFixed(1)}px)) scale(.9) rotate(220deg)`, opacity: 1, offset: .6 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist * 1.2).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist * 1.2 + 35).toFixed(1)}px)) scale(.7) rotate(400deg)`, opacity: 0 },
    ], { duration: 620, delay: i * 25, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), 700 + i * 25);
  }
}
function spawnSeismicLiftFx(side, tSide, onImpact) {
  const field = document.querySelector('.battle-fight');
  const atk = $(`${side}-img`);
  const tgt = $(`${tSide}-img`);
  if (!field || !atk || !tgt) return Promise.resolve();
  resetAnim(atk);
  atk.style.transform = '';
  const ar = atk.getBoundingClientRect();
  const tr = tgt.getBoundingClientRect();
  const acx = ar.left + ar.width / 2;
  const acy = ar.top + ar.height / 2;
  const tcx = tr.left + tr.width / 2;
  const tcy = tr.top + tr.height / 2;
  // 我方在 scaleX(-1) 容器内，translateX 方向与屏幕相反
  const dx = (side === 'bp' ? -1 : 1) * (tcx - acx);
  // 位移目标（对手正下方）：攻击方头顶贴住对手脚底
  const belowDy = (tcy + tr.height * 0.5 + ar.height * 0.5) - acy;
  // 向上顶：攻击方中心顶到对手下半身（接触点），不再继续上冲
  const strikeDy = (tcy + tr.height * 0.15) - acy;
  raiseAttacker(side);
  const anim = atk.animate([
    // 从原位快速冲到对手正下方（不闪现）
    { transform: 'translate(0, 0) scale(1)', offset: 0, easing: 'cubic-bezier(.35,.8,.35,1)' },
    { transform: `translate(${dx.toFixed(1)}px, ${belowDy.toFixed(1)}px) scale(.96)`, offset: .18, easing: 'ease-out' },
    { transform: `translate(${dx.toFixed(1)}px, ${belowDy.toFixed(1)}px) scale(1)`, offset: .24, easing: 'ease-in' },
    // 下蹲蓄力
    { transform: `translate(${dx.toFixed(1)}px, ${(belowDy + 6).toFixed(1)}px) scale(.9, 1.12)`, offset: .31, easing: 'cubic-bezier(.15,.85,.3,1)' },
    // 向上顶：接触瞬间压扁拉长
    { transform: `translate(${dx.toFixed(1)}px, ${strikeDy.toFixed(1)}px) scale(1.08, .94)`, offset: .41, easing: 'ease-out' },
    { transform: `translate(${dx.toFixed(1)}px, ${(strikeDy - 4).toFixed(1)}px) scale(1.03, .98)`, offset: .44, easing: 'cubic-bezier(.4,0,.9,.6)' },
    // 顶完以很快的速度向下坠落出视口（衬托对手被巨力打飞到天上）
    { transform: `translate(${dx.toFixed(1)}px, ${(strikeDy + 420).toFixed(1)}px) scale(1)`, offset: .60 },
    { transform: `translate(${dx.toFixed(1)}px, ${(strikeDy + 420).toFixed(1)}px) scale(1)`, offset: 1 },
  ], { duration: 1200, fill: 'both' });
  // 被顶飞：受击压扁 → 被巨力打飞到天上 → 落回原处（结束时回到原位，不留下位移残留）
  const squash = tgt.animate([
    { transform: 'translateY(0) scale(1,1)', offset: 0 },
    { transform: 'translateY(4px) scale(.84,1.18)', offset: .06, easing: 'ease-out' },
    { transform: 'translateY(-34px) scale(1.1,.9)', offset: .18, easing: 'ease-out' },
    { transform: 'translateY(-102px) scale(1.03,.97)', offset: .44, easing: 'ease-in' },
    { transform: 'translateY(-108px) scale(1,1)', offset: .54, easing: 'cubic-bezier(.6,0,.9,.5)' },
    { transform: 'translateY(-16px) scale(1,1)', offset: .84, easing: 'ease-in' },
    { transform: 'translateY(0) scale(.9,1.12)', offset: .93 },
    { transform: 'translateY(0) scale(1,1)', offset: 1 },
  ], { duration: 710, delay: 490, fill: 'forwards' });
  const bg = document.createElement('span');
  bg.style.position = 'absolute';
  bg.style.inset = '0';
  bg.style.zIndex = '0';
  bg.style.pointerEvents = 'none';
  bg.style.backgroundImage = "url('./pe-battle/move-fx-assets/bg/bg_in_air.png')";
  bg.style.backgroundRepeat = 'repeat';
  bg.style.backgroundSize = 'auto';
  bg.style.backgroundPosition = '0 0';
  bg.style.opacity = '0';
  field.insertBefore(bg, field.firstChild);
  // 背景等攻击方顶完、开始向下坠的这一刻才浮现并向上滚动，
  // 攻击方下落 + 背景上移形成相对运动，衬托对手被打飞到高空
  bg.animate([
    { opacity: 0, backgroundPosition: '0 0' },
    { opacity: 1, offset: .18 },
    { opacity: 1, offset: .82 },
    { opacity: 0, backgroundPosition: '0 520px' },
  ], { duration: 660, delay: 520, fill: 'both' });
  setTimeout(() => { spawnSeismicRocks(tSide); if (onImpact) onImpact(); }, 490);
  setTimeout(spawnSeismicRocks, 650, tSide);
  return new Promise((resolve) => {
    setTimeout(() => {
      anim.cancel();
      squash.cancel();
      atk.style.transform = '';
      atk.style.visibility = '';
      lowerAttacker(side);
      bg.remove();
      resolve();
    }, 1210);
  });
}
// 充电：小电球环绕自身螺旋上升，最后聚成大光球
function spawnChargeFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const orbUrl = './pe-battle/move-fx-assets/pe/Gfx_ElectricOrbs__8x8.png';
  for (let i = 0; i < 12; i++) {
    const size = 18 + randInt(0, 12);
    const a0 = (i / 12) * Math.PI * 2;
    const radius = 46 + randInt(0, 22);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = `url(${orbUrl})`;
    el.style.backgroundSize = `${size}px ${size * 4}px`;
    el.style.zIndex = '10';
    box.appendChild(el);
    let f = randInt(0, 3);
    const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * size}px`; }, 70);
    const a1 = a0 + Math.PI * 1.15;
    const a2 = a0 + Math.PI * 2.2;
    el.animate([
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a0) * radius).toFixed(1)}px, ${(Math.sin(a0) * radius * .55 + 46).toFixed(1)}px) scale(.6)`, opacity: 0 },
      { opacity: 1, offset: .14 },
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a1) * radius * .8).toFixed(1)}px, ${(Math.sin(a1) * radius * .4 + 8).toFixed(1)}px) scale(1)`, opacity: 1, offset: .48 },
      { transform: `translate(-50%,-50%) translate(${(Math.cos(a2) * radius * .35).toFixed(1)}px, ${(Math.sin(a2) * radius * .25 - 58).toFixed(1)}px) scale(1.15)`, opacity: 0 },
    ], { duration: 820, delay: i * 34, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 940 + i * 34);
  }
  const orb = document.createElement('span');
  orb.className = 'fx-orig';
  orb.style.left = cx + 'px';
  orb.style.top = (cy - 12) + 'px';
  orb.style.width = '64px';
  orb.style.height = '64px';
  orb.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_CircleOfLight__64x64.png')";
  orb.style.backgroundSize = '64px 64px';
  orb.style.filter = 'drop-shadow(0 0 12px #ffe45c)';
  orb.style.zIndex = '11';
  box.appendChild(orb);
  orb.animate([
    { transform: 'translate(-50%,-50%) scale(.25)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: .45 },
    { transform: 'translate(-50%,-50%) scale(1.35)', opacity: 1, offset: .72 },
    { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
  ], { duration: 720, delay: 320, fill: 'both' });
  setTimeout(() => orb.remove(), 1100);
}
// 恶之波动：四帧紫焰从施法者中心向外扩散
function spawnDarkPulseFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = new URL('./pe-battle/move-fx-assets/pe/Gfx_PurpleFlame__16x32.png', import.meta.url).href;
  for (let wave = 0; wave < 3; wave++) {
    for (let i = 0; i < 8; i++) {
      const w = 16 + randInt(0, 6);
      const h = w * 2;
      const ang = (i / 8) * Math.PI * 2 + wave * 0.3 + Math.random() * 0.2;
      const dist = 56 + wave * 26 + randInt(0, 22);
      const el = document.createElement('span');
      el.className = 'fx-orig';
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = `${w}px ${h * 4}px`;
      el.style.backgroundPosition = '0 0';
      el.style.filter = 'drop-shadow(0 0 5px #b35cff)';
      el.style.zIndex = '9';
      box.appendChild(el);
      let f = randInt(0, 3);
      const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * h}px`; }, 65);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist * 0.8;
      const rot = (ang * 180) / Math.PI + 90;
      el.animate([
        { transform: `translate(-50%,-50%) rotate(${rot.toFixed(1)}deg) scale(.55)`, opacity: 0 },
        { opacity: 1, offset: .12 },
        { transform: `translate(calc(-50% + ${(dx * .55).toFixed(1)}px), calc(-50% + ${(dy * .55).toFixed(1)}px)) rotate(${rot.toFixed(1)}deg) scale(1)`, opacity: 1, offset: .5 },
        { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${rot.toFixed(1)}deg) scale(1.15)`, opacity: 0 },
      ], { duration: 520, delay: wave * 75 + i * 10, easing: 'ease-out', fill: 'both' });
      setTimeout(() => { clearInterval(timer); el.remove(); }, 820 + wave * 75 + i * 10);
    }
  }
}
// 喷出：自身短暂压扁蓄力，回弹时以自身为中心爆出多圈橙黄色光球
function spawnSpitUpFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  img.animate([
    { transform: 'scale(1,1)' },
    { transform: 'scale(1.16,.72)', offset: .3 },
    { transform: 'scale(.95,1.12)', offset: .58 },
    { transform: 'scale(1,1)' },
  ], { duration: 420, easing: 'ease-out' });
  const url = './pe-battle/move-fx-assets/pe/Gfx_Orbs__8x8.png';
  for (let wave = 0; wave < 3; wave++) {
    for (let i = 0; i < 9; i++) {
      const size = 10 + randInt(0, 7);
      const ang = (i / 9) * Math.PI * 2 + wave * 0.35 + Math.random() * 0.15;
      const dist = 64 + wave * 24 + randInt(0, 24);
      const el = document.createElement('span');
      el.className = 'fx-orig';
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = `${size}px ${size * 4}px`;
      el.style.backgroundPosition = `0 -${randInt(0, 3) * size}px`;
      el.style.filter = 'sepia(1) saturate(3) hue-rotate(-12deg) brightness(1.18)';
      el.style.zIndex = '9';
      box.appendChild(el);
      let f = randInt(0, 3);
      const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * size}px`; }, 55);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist * 0.8;
      el.animate([
        { transform: 'translate(-50%,-50%) translate(0,0) scale(.45)', opacity: 0 },
        { opacity: 1, offset: .12 },
        { transform: `translate(calc(-50% + ${(dx * .55).toFixed(1)}px), calc(-50% + ${(dy * .55).toFixed(1)}px)) scale(1)`, opacity: 1, offset: .5 },
        { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1.65)`, opacity: 0 },
      ], { duration: 520, delay: wave * 80 + i * 10, easing: 'ease-out', fill: 'both' });
      setTimeout(() => { clearInterval(timer); el.remove(); }, 820 + wave * 80 + i * 10);
    }
  }
}
// 拳类招式通用拳头素材
// 重击背景：命中瞬间从战场后方浮现，随后淡出
function spawnImpactBg(tSide) {
  const field = document.querySelector('.battle-fight');
  if (!field) return;
  const file = tSide === 'be' ? 'bg_impact_opponent.png' : 'bg_impact_player.png';
  const el = document.createElement('span');
  el.className = 'b-impact-bg';
  el.style.backgroundImage = `url(${new URL('./pe-battle/move-fx-assets/bg/' + file, import.meta.url).href})`;
  field.appendChild(el);
  setTimeout(() => el.remove(), 760);
}
function spawnPunchFist(tSide, opts = {}) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const size = opts.size || 30;
  const count = opts.count || 1;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (ir.left - br.left + ir.width / 2 + (i ? 12 : -8)) + 'px';
    el.style.top = (ir.top - br.top + ir.height * 0.42 + (i ? -6 : 6)) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_HandsAndFeet__32x32.png')";
    el.style.backgroundSize = `${size}px ${size * 4}px`;
    el.style.backgroundPosition = '0 0';
    el.style.zIndex = '10';
    box.appendChild(el);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.45) rotate(-8deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.08) rotate(4deg)', opacity: 1, offset: .22 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 0 },
    ], { duration: 260, delay: i * 90, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), 310 + i * 90);
  }
}
// 暗影爪/克命爪：复用金属爪的 Gfx_ClawSlash 五帧爪痕
function spawnClawSlashFx(tSide, color) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const size = 54;
  const url = "url('./pe-battle/move-fx-assets/pe/Gfx_ClawSlash__32x32.png')";
  for (let i = 0; i < 2; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
    el.style.top = (ir.top - br.top + ir.height * 0.46) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = `${size}px ${size * 5}px`;
    el.style.backgroundPosition = '0 0';
    el.style.zIndex = '10';
    if (color) el.style.filter = `drop-shadow(0 0 5px ${color})`;
    box.appendChild(el);
    let f = 0;
    const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * size}px`; }, 55);
    const rot = i ? 24 : -24;
    el.animate([
      { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(.75)`, opacity: 0 },
      { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(1.15)`, opacity: 1, offset: .25 },
      { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(1.05)`, opacity: 0 },
    ], { duration: 320, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 370);
  }
}
// 贝壳刃：Sparkle4 第四个分片作为斩击特效
function spawnSparkleSlash(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  el.style.top = (ir.top - br.top + ir.height * 0.46) + 'px';
  el.style.width = '52px';
  el.style.height = '52px';
  el.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_Sparkle4__32x32.png')";
  el.style.backgroundSize = '52px 260px';
  el.style.backgroundPosition = '0 -156px';
  el.style.zIndex = '10';
  box.appendChild(el);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.45) rotate(-35deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.16) rotate(-10deg)', opacity: 1, offset: .24 },
    { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 0 },
  ], { duration: 300, easing: 'ease-out', fill: 'both' });
  setTimeout(() => el.remove(), 340);
}
// 拍击/连环巴掌：Gfx_TagHand 上半部分的手掌从上方拍向目标
function spawnTagHandStrike(tSide, index = 0) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.46;
  const size = 40;
  const dir = index % 2 ? -1 : 1;
  const el = document.createElement('span');
  el.className = 'fx-orig';
  el.style.left = (cx + dir * 6) + 'px';
  el.style.top = (cy + 3) + 'px';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_TagHand__32x32.png')";
  el.style.backgroundSize = `${size}px ${size * 2}px`;
  el.style.backgroundPosition = '0 0';
  el.style.zIndex = '10';
  box.appendChild(el);
  el.animate([
    { transform: `translate(-50%,-120%) translateX(${dir * -10}px) rotate(${dir * -10}deg) scale(.8)`, opacity: 0 },
    { transform: `translate(-50%,-50%) rotate(${dir * 4}deg) scale(1.08)`, opacity: 1, offset: .35 },
    { transform: 'translate(-50%,-50%) rotate(0deg) scale(1)', opacity: 0 },
  ], { duration: 300, delay: index * 55, easing: 'ease-out', fill: 'both' });
  setTimeout(() => el.remove(), 380 + index * 55);
}
// 再来一次：下方手掌固定，上方手掌出现/隐藏三次，并撒彩带
function spawnEncoreClap(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.46;
  const size = 40;
  const handUrl = "url('./pe-battle/move-fx-assets/pe/Gfx_TagHand__32x32.png')";
  const makeHand = (top) => {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = cx + 'px';
    el.style.top = top + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = handUrl;
    el.style.backgroundSize = `${size}px ${size * 2}px`;
    el.style.backgroundPosition = '0 0';
    el.style.zIndex = '10';
    el.style.transform = 'translate(-50%,-50%)';
    box.appendChild(el);
    return el;
  };
  const lower = makeHand(cy + 18);
  const upper = makeHand(cy - 8);
  upper.animate([
    { transform: 'translate(-50%,-50%) translateY(-18px) scale(.9)', opacity: 0 },
    { transform: 'translate(-50%,-50%) translateY(0) scale(1)', opacity: 1, offset: .2 },
    { transform: 'translate(-50%,-50%) translateY(0) scale(1)', opacity: 1, offset: .55 },
    { transform: 'translate(-50%,-50%) translateY(3px) scale(1)', opacity: 0, offset: .8 },
    { transform: 'translate(-50%,-50%) translateY(3px) scale(1)', opacity: 0 },
  ], { duration: 300, delay: 80, iterations: 3, easing: 'ease-in-out', fill: 'both' });
  const confettiUrl = new URL('./pe-battle/move-fx-assets/pe/Gfx_Confetti__8x8.png', import.meta.url).href;
  for (let i = 0; i < 10; i++) {
    const sizeC = 9 + randInt(0, 5);
    const p = document.createElement('span');
    p.className = 'fx-orig';
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.width = sizeC + 'px';
    p.style.height = sizeC + 'px';
    p.style.backgroundImage = `url(${confettiUrl})`;
    p.style.backgroundSize = `${sizeC}px ${sizeC * 12}px`;
    p.style.backgroundPosition = `0 -${randInt(0, 11) * sizeC}px`;
    p.style.zIndex = '9';
    box.appendChild(p);
    const dx = randInt(-42, 42);
    const dy = -42 - randInt(0, 38);
    const rot = randInt(-180, 180);
    p.animate([
      { transform: 'translate(-50%,-50%) scale(.6) rotate(0deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * .35}px), calc(-50% + ${dy * .35}px)) scale(1) rotate(${rot * .4}deg)`, opacity: 1, offset: .25 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.8) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: 650, delay: 120 + i * 25, easing: 'ease-out', fill: 'both' });
    setTimeout(() => p.remove(), 840 + i * 25);
  }
  setTimeout(() => { lower.remove(); upper.remove(); }, 1100);
}
// 斜向光束（破坏光线）：白芯光束 + 起点几颗光球
function spawnCrossBeamFx(side, tSide, color) {
  const field = document.querySelector('.battle-fight');
  const atk = $(`${side}-img`);
  const tgt = $(`${tSide}-img`);
  if (!field || !atk || !tgt) return;
  const br = field.getBoundingClientRect();
  const ar = atk.getBoundingClientRect();
  const tr = tgt.getBoundingClientRect();
  const x1 = ar.left - br.left + ar.width / 2;
  const y1 = ar.top - br.top + ar.height * 0.48;
  const x2 = tr.left - br.left + tr.width / 2;
  const y2 = tr.top - br.top + tr.height * 0.48;
  const len = Math.max(8, Math.hypot(x2 - x1, y2 - y1));
  const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  const beam = document.createElement('span');
  beam.className = 'fx-beam';
  beam.style.setProperty('--beam', color);
  beam.style.left = x1 + 'px';
  beam.style.top = (y1 - 6) + 'px';
  beam.style.transform = `rotate(${ang}deg)`;
  field.appendChild(beam);
  beam.animate([
    { width: '0px', opacity: 0 },
    { width: (len * 0.72).toFixed(1) + 'px', opacity: 1, offset: 0.2 },
    { width: len.toFixed(1) + 'px', opacity: 1, offset: 0.48 },
    { width: len.toFixed(1) + 'px', opacity: 0 },
  ], { duration: 560, easing: 'ease-out', fill: 'both' });
  setTimeout(() => beam.remove(), 700);
  // 光球：不是弹道，而是光束打到对手之后在对手身上生成并炸开
  const url = './pe-battle/move-fx-assets/pe/Gfx_Orbs__16x16.png';
  setTimeout(() => {
    if (!field.isConnected) return;
    for (let i = 0; i < 6; i++) {
      const size = 16 + randInt(0, 8);
      const el = document.createElement('span');
      el.className = 'fx-orig';
      el.style.left = (x2 + randInt(-8, 8)) + 'px';
      el.style.top = (y2 + randInt(-8, 8)) + 'px';
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = `${size}px ${size * 3}px`;
      el.style.backgroundPosition = `0 -${size * 2}px`;
      el.style.zIndex = '9';
      field.appendChild(el);
      const ang = (i / 6) * Math.PI * 2 + Math.random() * 0.6;
      const dist = 26 + randInt(0, 24);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist;
      el.animate([
        { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.05)', opacity: 1, offset: .22 },
        { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(.7)`, opacity: 0 },
      ], { duration: 420, delay: i * 30, easing: 'ease-out', fill: 'both' });
      setTimeout(() => el.remove(), 480 + i * 30);
    }
  }, 300);
}
function spawnSmokeScreen(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.42;
  const url = "url('./pe-battle/move-fx-assets/pe/Gfx_GraySmoke__32x32.png')";
  for (let i = 0; i < 9; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    const w = 42 + randInt(0, 20);
    el.style.width = w + 'px';
    el.style.height = w + 'px';
    el.style.left = (cx + randInt(-Math.round(ir.width * 0.34), Math.round(ir.width * 0.34))) + 'px';
    el.style.top = (cy + randInt(-Math.round(ir.height * 0.3), Math.round(ir.height * 0.08))) + 'px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = `${w}px ${w * 5}px`;
    el.style.filter = 'brightness(.34) saturate(.15)';
    el.style.zIndex = '10';
    el.style.opacity = '0';
    box.appendChild(el);
    let f = randInt(0, 4);
    const timer = setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * w}px`; }, 80);
    const dur = 520 + randInt(0, 160);
    el.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.7)' },
      { opacity: .95, offset: .18 },
      { opacity: .82, offset: .55 },
      { opacity: .9, offset: .78 },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.08)' },
    ], { duration: dur, fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, dur + 40);
  }
  const imp = document.createElement('span');
  imp.className = 'fx-orig';
  imp.style.left = cx + 'px';
  imp.style.top = cy + 'px';
  imp.style.width = '28px';
  imp.style.height = '28px';
  imp.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_SmokescreenImpact__16x16.png')";
  imp.style.backgroundSize = '28px 84px';
  imp.style.zIndex = '11';
  box.appendChild(imp);
  let f = 0;
  const timer = setInterval(() => { f = (f + 1) % 3; imp.style.backgroundPosition = `0 -${f * 28}px`; }, 55);
  setTimeout(() => { clearInterval(timer); imp.remove(); }, 220);
}
// 清除之烟：一缕缕紫灰毒烟从攻击方飘向对手，抵达后炸开一团烟气（复用烟幕的灰烟素材）
function spawnClearSmogFx(atkSide, tSide) {
  const box = $(`${tSide}-box`);
  const atk = $(`${atkSide}-img`);
  const tgt = $(`${tSide}-img`);
  if (!box || !atk || !tgt) return;
  const br = box.getBoundingClientRect();
  const ar = atk.getBoundingClientRect();
  const tr = tgt.getBoundingClientRect();
  const ax = ar.left - br.left + ar.width / 2;
  const ay = ar.top - br.top + ar.height * 0.42;
  const tx = tr.left - br.left + tr.width / 2;
  const ty = tr.top - br.top + tr.height * 0.42;
  const smoke = "url('./pe-battle/move-fx-assets/pe/Gfx_GraySmoke__32x32.png')";
  // 灰烟整体染成毒系紫灰
  const tint = 'sepia(1) saturate(3.5) hue-rotate(245deg) brightness(1.15)';
  const playFrames = (el, w, speed) => {
    let f = randInt(0, 4);
    return setInterval(() => { f = (f + 1) % 5; el.style.backgroundPosition = `0 -${f * w}px`; }, speed);
  };
  // 前进的烟团：从攻击方身前往对手飘，边飘边翻帧
  for (let i = 0; i < 6; i++) {
    const w = 28 + randInt(0, 14);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.width = w + 'px';
    el.style.height = w + 'px';
    el.style.left = (ax + randInt(-12, 12)) + 'px';
    el.style.top = (ay + randInt(-16, 10)) + 'px';
    el.style.backgroundImage = smoke;
    el.style.backgroundSize = `${w}px ${w * 5}px`;
    el.style.filter = tint;
    el.style.opacity = '0';
    box.appendChild(el);
    const timer = playFrames(el, w, 90);
    const delay = i * 55;
    const dx = tx - ax + randInt(-16, 16);
    const dy = ty - ay + randInt(-12, 12);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.55)', opacity: 0 },
      { opacity: .8, offset: .22 },
      { transform: `translate(calc(-50% + ${(dx * .68).toFixed(0)}px), calc(-50% + ${(dy * .68 - 8).toFixed(0)}px)) scale(1.02)`, opacity: .7, offset: .68 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.3)`, opacity: 0 },
    ], { duration: 620, delay, easing: 'ease-out', fill: 'both' });
    setTimeout(() => { clearInterval(timer); el.remove(); }, 660 + delay);
  }
  // 抵达对手：原作烟雾冲击帧 + 几团在对手身上散开的烟
  setTimeout(() => {
    if (!box.isConnected) return;
    const imp = document.createElement('span');
    imp.className = 'fx-orig';
    imp.style.left = tx + 'px';
    imp.style.top = ty + 'px';
    imp.style.width = '30px';
    imp.style.height = '30px';
    imp.style.backgroundImage = "url('./pe-battle/move-fx-assets/pe/Gfx_SmokescreenImpact__16x16.png')";
    imp.style.backgroundSize = '30px 90px';
    imp.style.filter = tint;
    imp.style.zIndex = '11';
    box.appendChild(imp);
    let f = 0;
    const timer = setInterval(() => { f = (f + 1) % 3; imp.style.backgroundPosition = `0 -${f * 30}px`; }, 55);
    setTimeout(() => { clearInterval(timer); imp.remove(); }, 200);
    for (let i = 0; i < 4; i++) {
      const w = 34 + randInt(0, 16);
      const el = document.createElement('span');
      el.className = 'fx-orig';
      el.style.width = w + 'px';
      el.style.height = w + 'px';
      el.style.left = (tx + randInt(-Math.round(tr.width * 0.3), Math.round(tr.width * 0.3))) + 'px';
      el.style.top = (ty + randInt(-Math.round(tr.height * 0.28), Math.round(tr.height * 0.2))) + 'px';
      el.style.backgroundImage = smoke;
      el.style.backgroundSize = `${w}px ${w * 5}px`;
      el.style.filter = tint;
      el.style.zIndex = '10';
      el.style.opacity = '0';
      box.appendChild(el);
      const t2 = playFrames(el, w, 90);
      el.animate([
        { transform: 'translate(-50%,-50%) scale(.7)', opacity: 0 },
        { opacity: .9, offset: .2 },
        { opacity: .75, offset: .6 },
        { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 0 },
      ], { duration: 460, fill: 'both' });
      setTimeout(() => { clearInterval(t2); el.remove(); }, 500);
    }
  }, 620);
}
// 打草结命中：一簇树叶在对手身上炸开
function spawnLeafBurstFx(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height * 0.45;
  const url = "url('./pe-battle/move-fx-assets/pe/Gfx_Leaf__16x16.png')";
  for (let i = 0; i < 14; i++) {
    const size = 12 + randInt(0, 8);
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = `${size}px ${size * 9}px`;
    el.style.backgroundPosition = `0 -${randInt(0, 8) * size}px`;
    el.style.zIndex = '10';
    box.appendChild(el);
    const ang = (i / 14) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 34 + randInt(0, 34);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - 10; // 整体略向上散开
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.4) rotate(0deg)', opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: `translate(calc(-50% + ${(dx * .7).toFixed(0)}px), calc(-50% + ${(dy * .7).toFixed(0)}px)) scale(1) rotate(${randInt(-160, 160)}deg)`, opacity: 1, offset: .68 },
      { transform: `translate(calc(-50% + ${dx.toFixed(0)}px), calc(-50% + ${(dy + 14).toFixed(0)}px)) scale(.75) rotate(${randInt(-220, 220)}deg)`, opacity: 0 },
    ], { duration: 520 + randInt(0, 140), easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), 700);
  }
}
// 电击波：原作 8x8 电花从攻击方连成一串冲向目标
function spawnShockWaveFx(atkSide, tSide) {
  const box = $(`${tSide}-box`);
  const atk = $(`${atkSide}-img`);
  const tgt = $(`${tSide}-img`);
  if (!box || !atk || !tgt) return;
  const br = box.getBoundingClientRect();
  const ar = atk.getBoundingClientRect();
  const tr = tgt.getBoundingClientRect();
  const ax = ar.left - br.left + ar.width / 2;
  const ay = ar.top - br.top + ar.height / 2;
  const tx = tr.left - br.left + tr.width / 2;
  const ty = tr.top - br.top + tr.height / 2;
  const url = "url('./pe-battle/move-fx-assets/pe/Gfx_Spark__8x8.png')";
  const n = 12;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.zIndex = '9';
    el.style.width = '12px';
    el.style.height = '12px';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = url;
    el.style.backgroundSize = '12px 432px';
    el.style.backgroundPosition = `0 -${randInt(0, 35) * 12}px`;
    el.style.left = (ax + (tx - ax) * k + (i % 2 ? -1 : 1) * randInt(7, 14)) + 'px';
    el.style.top = (ay + (ty - ay) * k + (i % 2 ? -1 : 1) * randInt(6, 12)) + 'px';
    el.style.transform = 'translate(-50%,-50%)';
    box.appendChild(el);
    el.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' },
      { opacity: 1, offset: .25, transform: 'translate(-50%,-50%) scale(1.15)' },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.8)' },
    ], { duration: 170, delay: i * 24, fill: 'both' });
    setTimeout(() => el.remove(), 220 + i * 24);
  }
  setTimeout(() => spawnLightningStrike(tSide, 0), 320);
}
// 连续抓痕：乱抓等多段爪击只重复抓痕，不再每击贴身
function spawnFurySwipes(tSide, hits) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  const url = "url('./pe-battle/move-fx-assets/pe/Gfx_Swipe__32x32.png')";
  const total = Math.max(2, hits * 2);
  for (let i = 0; i < total; i++) {
    const el = document.createElement('span');
    el.className = 'fx-orig';
    el.style.left = (cx + (i % 2 ? -1 : 1) * randInt(6, 18)) + 'px';
    el.style.top = (cy + randInt(-14, 14)) + 'px';
    el.style.width = '36px';
    el.style.height = '36px';
    el.style.backgroundImage = url;
    el.style.backgroundSize = '36px 180px';
    el.style.zIndex = '10';
    el.style.transform = `translate(-50%,-50%) scaleX(${i % 2 ? -1 : 1})`;
    box.appendChild(el);
    el.animate([
      { opacity: 0, transform: `translate(-50%,-50%) scaleX(${i % 2 ? -1 : 1}) scale(.8)` },
      { opacity: 1, offset: .2, transform: `translate(-50%,-50%) scaleX(${i % 2 ? -1 : 1}) scale(1.15)` },
      { opacity: 0, transform: `translate(-50%,-50%) scaleX(${i % 2 ? -1 : 1}) scale(1)` },
    ], { duration: 300, delay: i * 105, fill: 'both' });
    let f = 0;
    const timer = setInterval(() => { f = (f + 1) % 4; el.style.backgroundPosition = `0 -${f * 36}px`; }, 42);
    setTimeout(() => { clearInterval(timer); el.remove(); }, 320 + i * 105);
  }
}
function spawnPoisonOrbBurst(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - br.left + ir.width / 2;
  const cy = ir.top - br.top + ir.height / 2;
  // 毒系泡泡统一用 Gfx_PoisonBubble 的第一份（最上面的圆形毒泡泡），
  // 与中毒状态的 .fx-poison-bubble 切帧一致：贴图高按 3 倍铺，只露最上面 1/3
  const url = new URL('./pe-battle/move-fx-assets/pe/Gfx_PoisonBubble__16x16.png', import.meta.url).href;
  for (let i = 0; i < 7; i++) {
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.zIndex = '9';
    el.style.width = '18px';
    el.style.height = '18px';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.pointerEvents = 'none';
    el.style.imageRendering = 'pixelated';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundPosition = '0 0';
    el.style.backgroundSize = '18px 54px';
    el.style.filter = 'drop-shadow(0 0 4px #b35cff)';
    box.appendChild(el);
    const ang = (i / 7) * Math.PI * 2 + Math.random() * 0.45;
    const dist = 18 + Math.random() * 20;
    const delay = i * 24;
    el.animate([
      { transform: 'translate(-50%, -50%) scale(.45)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist * .45).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist * .45 - 8).toFixed(1)}px)) scale(1)`, opacity: 1, offset: .3 },
      { transform: `translate(calc(-50% + ${(Math.cos(ang) * dist).toFixed(1)}px), calc(-50% + ${(Math.sin(ang) * dist).toFixed(1)}px)) scale(.7)`, opacity: 0 },
    ], { duration: 430, delay, easing: 'ease-out', fill: 'both' });
    setTimeout(() => el.remove(), 440 + delay);
  }
}
// 牙招命中粒子：雷电牙复用闪电贴图，剧毒牙撒圆形毒泡泡，火焰牙火团
// （其余牙招只用牙齿咬合 + 命中贴图，不再撒菱形碎片）
function spawnFangParticles(tSide, name) {
  if (name === '雷电牙') {
    spawnVoltFlash();
    spawnLightningAsset(tSide, 0);
    return;
  }
  if (name === '剧毒牙') {
    spawnPoisonOrbBurst(tSide);
    return;
  }
  if (name === '火焰牙') {
    spawnFireBurst(tSide);
    return;
  }
}
// 精神突进：攻击方自身的紫粉柔光蓄力
function spawnPsyCharge(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-psy-charge';
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height / 2) + 'px';
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 650);
}
// 流星类招式：宇宙背景
let _cosmicFx = null;
function hideCosmicBg() {
  if (_cosmicFx) {
    _cosmicFx.remove();
    _cosmicFx = null;
  }
}
function spawnCosmicBg() {
  const field = document.querySelector('.battle-fight');
  if (!field) return;
  hideCosmicBg();
  const fx = document.createElement('span');
  fx.className = 'b-cosmic-fx';
  fx.style.backgroundImage = "url('./pe-battle/move-fx-assets/bg/bg_cosmic.png')";
  field.appendChild(fx);
  _cosmicFx = fx;
  setTimeout(() => { if (_cosmicFx === fx) hideCosmicBg(); }, 3000);
}
// 流星群：从左上斜向砸下多颗彩色描边陨石，逐颗命中
function spawnMeteorRain(tSide, count = 6) {
  const field = document.querySelector('.battle-fight');
  const img = $(`${tSide}-img`);
  if (!field || !img) return 0;
  const fr = field.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const cx = ir.left - fr.left + ir.width / 2;
  const cy = ir.top - fr.top + ir.height / 2;
  const colors = ['#ff6ec7', '#69e7ff', '#ffe36a', '#b98cff', '#80ffb0', '#ff9d6b'];
  const fx = document.createElement('span');
  fx.className = 'b-meteor-fx';
  let end = 0;
  for (let i = 0; i < count; i++) {
    const rock = document.createElement('i');
    rock.className = 'meteor';
    rock.style.left = cx + 'px';
    rock.style.top = cy + 'px';
    rock.style.setProperty('--sx', `${-150 - (i % 3) * 34}px`);
    rock.style.setProperty('--sy', `${-150 - (i % 2) * 26}px`);
    rock.style.setProperty('--mc', colors[i % colors.length]);
    rock.style.setProperty('--ms', `${18 + (i % 4) * 4}px`);
    const delay = i * 95;
    const dur = 480 + (i % 3) * 45;
    rock.style.setProperty('--delay', `${delay}ms`);
    rock.style.setProperty('--md', `${dur}ms`);
    fx.appendChild(rock);
    const land = delay + dur;
    end = Math.max(end, land);
    setTimeout(() => {
      if (!field.isConnected) return;
      spawnImpactAsset(tSide);
      shake(tSide);
    }, land);
  }
  field.appendChild(fx);
  setTimeout(() => fx.remove(), end + 260);
  return end;
}
// 灼伤触发闪红：精灵本体红光脉冲两下（与预览页同一套 .b-burn-flash）
function burnFlash(side) {
  const img = $(`${side}-img`);
  if (!img) return;
  img.classList.remove('b-burn-flash');
  void img.offsetWidth;
  img.classList.add('b-burn-flash');
  clearTimeout(img._burnFlashT);
  img._burnFlashT = setTimeout(() => img.classList.remove('b-burn-flash'), 620);
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
  } else if (st === 'infatuation') {
    // 着迷：头顶四周漂浮粉红爱心（错峰上浮）
    for (let i = 0; i < 4; i++) {
      const p = document.createElement('i');
      p.innerHTML = '<svg viewBox="0 0 24 24"><use xlink:href="#icon-liked"/></svg>';
      p.style.left = (Math.random() * ir.width - ir.width / 2) + 'px';
      p.style.top = (-ir.height / 2 - 2) + 'px';
      p.style.animationDelay = (i * 0.4).toFixed(2) + 's';
      fx.appendChild(p);
    }
  } else if (st === 'curse') {
    // 诅咒：紫黑"呪"字怨气围绕头顶上浮消散（错峰）
    for (let i = 0; i < 4; i++) {
      const p = document.createElement('i');
      p.textContent = '呪';
      p.style.left = (Math.random() * ir.width - ir.width / 2) + 'px';
      p.style.top = (-ir.height / 2 - 2) + 'px';
      p.style.animationDelay = (i * 0.5).toFixed(2) + 's';
      fx.appendChild(p);
    }
  } else if (st === 'poison') {
    // 中毒：原作 Gfx_PoisonBubble 第一帧毒泡，大大小小从身上冒出
    for (let i = 0; i < 7; i++) {
      const p = document.createElement('i');
      p.className = 'fx-poison-bubble';
      p.style.setProperty('--s', randInt(10, 22) + 'px');
      p.style.left = randInt(-ir.width / 2 + 6, ir.width / 2 - 6) + 'px';
      p.style.top = randInt(-ir.height * 0.25, ir.height * 0.3) + 'px';
      p.style.animationDelay = (Math.random() * 2.4).toFixed(2) + 's';
      p.style.animationDuration = (2.2 + Math.random() * 1.2).toFixed(2) + 's';
      fx.appendChild(p);
    }
  } else if (st === 'paralysis') {
    // 麻痹：原作 Gfx_Spark2 三帧电花绕身明灭
    const offs = [[-12, -10], [10, -6], [-6, 10], [12, 12], [0, -2]];
    offs.forEach(([ox, oy], i) => {
      const p = document.createElement('i');
      p.className = 'fx-spark-asset';
      p.style.left = ox + 'px';
      p.style.top = oy + 'px';
      p.style.animationDelay = (i * 0.11).toFixed(2) + 's';
      fx.appendChild(p);
    });
  } else {
    const counts = { burn: 5, freeze: 5, confusion: 4 };
    const n = counts[st] || 5;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      if (st === 'burn') {
        // 灼伤：原作 Gfx_SmallEmber 火苗绕身窜动
        p.className = 'fx-burn-spr';
        p.style.left = (Math.random() * ir.width - ir.width / 2) + 'px';
        p.style.top = (Math.random() * ir.height * 0.8 - ir.height * 0.4) + 'px';
        p.style.animationDelay = (i * 0.12).toFixed(2) + 's';
      } else if (st === 'confusion') {
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
// 寄生种子幼芽特效：被寄生宝可梦脚下长出几根 Y 形豆芽（茎+两片小叶），错峰左右摆动（高矮交替）。
// 生命周期与 syncStatusFx 一致：被寄生期间常驻显示，换宠/解除后移除；
// force 用于图片尺寸确定后（applySpriteSize 异步缩放完成）校正挂点位置
function syncSeedFx(side, mon, force) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  const seeded = !!mon.seeded;
  let fx = box.querySelector('.b-seed-fx');
  if (fx) {
    if (!force && fx._mon === mon && fx._seeded === seeded) return;
    fx.remove();
  }
  if (!seeded) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  fx = document.createElement('span');
  fx.className = 'b-seed-fx';
  fx._mon = mon;
  fx._seeded = seeded;
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height) + 'px'; // 幼芽从脚部地面长出
  for (let i = 0; i < 3; i++) {
    const p = document.createElement('i');
    p.className = 'b-seed-sprout';
    p.style.left = ((i - 1) * 12 + randInt(-2, 2)) + 'px';
    p.style.animationDelay = (i * 0.18).toFixed(2) + 's';
    fx.appendChild(p);
  }
  box.appendChild(fx);
}
// 守住系护盾特效：宝可梦当前回合带 protected 标记时，Gfx_GuardRing 圆环从脚下往头顶依次出现，
// 全部亮起后整组一起收起；被挡下（block 事件）时再短暂亮一次。
// 生命周期与 syncStatusFx 一致：回合重置（protected=false）或换人后撤下
function syncShieldFx(side, mon) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img || !mon) return;
  let fx = box.querySelector('.b-shield');
  if (mon.protected) {
    if (fx && fx._mon === mon) return; // 同宠护盾已挂载：不重建，避免重触发出现动画
    if (fx) fx.remove();
    // 用元素自身的布局坐标定位：rect 在手机 transform 缩放/桌面 zoom 下会整体放大偏移
    const flip = side === 'bp' ? img.closest('.b-flip') : null;
    const cx = (flip ? flip.offsetLeft + img.offsetLeft : img.offsetLeft) + img.offsetWidth / 2;
    const cy = (flip ? flip.offsetTop + img.offsetTop : img.offsetTop) + img.offsetHeight / 2;
    fx = document.createElement('span');
    fx.className = 'b-shield';
    fx._mon = mon;
    fx.style.left = cx + 'px';
    fx.style.top = cy + 'px';
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    const ringW = Math.max(28, Math.min(80, w * 0.78));
    const ringH = Math.min(ringW / 2, Math.max(7, h * 0.24)); // 扁环贴着身体叠
    const n = 6;
    // 整组高度压到身高的 0.7 以内，环距不再按环高放大
    const span = Math.min(h * 0.7, ringH * 2.2);
    const step = span / (n - 1);
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'b-shield-ring';
      p.style.width = ringW + 'px';
      p.style.height = ringH + 'px';
      p.style.top = (step * ((n - 1) / 2 - i)) + 'px'; // i=0 在最下，向上依次出现
      p.style.opacity = '0';
      p.animate([
        { opacity: 0, transform: 'translate(-50%,-50%) scale(0.7)' },
        { opacity: 0.9, transform: 'translate(-50%,-50%) scale(1)', offset: 0.6 },
        { opacity: 0.9, transform: 'translate(-50%,-50%) scale(1.02)' },
      ], { duration: 170, delay: i * 90, easing: 'ease-out', fill: 'both' });
      fx.appendChild(p);
    }
    box.appendChild(fx);
    // 最后一环亮完停一小拍，整组同时隐掉
    const hold = (n - 1) * 90 + 170 + 140;
    const fade = fx.animate([
      { opacity: 1 },
      { opacity: 1, offset: hold / (hold + 220) },
      { opacity: 0 },
    ], { duration: hold + 220, easing: 'linear' });
    fade.onfinish = () => { fx.style.opacity = '0'; };
  } else if (fx) {
    fx.remove();
  }
}
// 护盾挡下攻击（block 事件）：白光一闪 + 光圈扩张；护盾成形后已收起，先短暂亮出来
function shieldHit(side) {
  const fx = $(`${side}-box`)?.querySelector('.b-shield');
  if (!fx) return;
  fx.classList.remove('b-shield-hit');
  void fx.offsetWidth;
  fx.classList.add('b-shield-hit');
  fx.animate([
    { opacity: 0 },
    { opacity: 1, offset: 0.3 },
    { opacity: 1, offset: 0.6 },
    { opacity: 0 },
  ], { duration: 420, easing: 'ease-out' });
  setTimeout(() => fx.classList.remove('b-shield-hit'), 420);
}
// 钉子图标：使用原作尖刺/岩块贴图，每层 1 枚，毒菱用紫色滤镜
function hazardHtml(hz) {
  const SPIKE = './pe-battle/move-fx-assets/pe/Gfx_Spikes__16x16.png';
  const ROCK = './pe-battle/move-fx-assets/pe/Gfx_FlatRock__16x16.png';
  let h = '';
  let d = 0;
  const add = (kind, n) => {
    for (let k = 0; k < n; k++) {
      const cls = kind === 'tox' ? ' b-hz-tox' : kind === 'rck' ? ' b-hz-rck' : '';
      const src = kind === 'rck' ? ROCK : SPIKE;
      h += `<i class="b-hz b-hz-img${cls}" style="animation-delay:${(d++ * 0.045).toFixed(2)}s;background-image:url('${src}')"></i>`;
    }
  };
  add('spk', hz.spikes || 0);
  add('tox', hz.toxic || 0);
  if (hz.rock) add('rck', 1);
  return h;
}
// 同步双方场地钉子图标：种类/层数变化时重建容器并播放掉落入场动画
function syncHazards(battle) {
  for (const [boxSide, key] of [['bp', 'p'], ['be', 'e']]) {
    const el = $(`${boxSide}-hazards`);
    if (!el) continue;
    const hz = battle.hazards[key] || { spikes: 0, toxic: 0, rock: false };
    const sig = `${hz.spikes}|${hz.toxic}|${hz.rock ? 1 : 0}`;
    const img = $(`${boxSide}-img`);
    if (img) {
      const ir = img.getBoundingClientRect();
      const br = el.parentElement.getBoundingClientRect();
      el.style.top = 'auto';
      el.style.bottom = Math.round(br.bottom - ir.bottom) + 'px';
      el.style.transform = 'translate(-50%, 0)';
    }
    if (el.dataset.sig === sig) continue;
    el.dataset.sig = sig;
    el.innerHTML = `<span class="b-hz-stack">${hazardHtml(hz)}</span>`;
    if (sig !== '0|0|0') {
      el.classList.remove('b-hz-pop');
      void el.offsetWidth;
      el.classList.add('b-hz-pop');
    }
  }
}
// 踩中钉子：对应侧图标白亮一瞬，脚底溅起同色碎片
function hzHitFx(boxSide, color) {
  const el = $(`${boxSide}-hazards`);
  if (el) {
    el.classList.remove('b-hz-hit');
    void el.offsetWidth;
    el.classList.add('b-hz-hit');
  }
  spawnGroundBurst(boxSide, color, 6);
}
// 每回合开/出招结算后统一刷新护盾与钉子表现
function syncFieldFx(battle) {
  syncShieldFx('bp', curMon(battle, 'p'));
  syncShieldFx('be', curMon(battle, 'e'));
  syncHazards(battle);
}
// 重踏/地震：攻击方原地跳起后砸地，落地瞬间整个战斗画面震动，双方宝可梦跟着地面颠动
function quakeRattle() {
  for (const s of ['bp', 'be']) {
    const img = $(`${s}-img`);
    if (!img) continue;
    img.classList.remove('quake-rattle');
    void img.offsetWidth;
    img.classList.add('quake-rattle');
    setTimeout(() => img.classList.remove('quake-rattle'), 620);
  }
}
function quakeAttack(side) {
  const img = $(`${side}-img`);
  if (img) {
    img.classList.remove('quake-hop');
    void img.offsetWidth;
    img.classList.add('quake-hop');
    setTimeout(() => img.classList.remove('quake-hop'), 450);
  }
  setTimeout(() => {
    quakeRattle(); // 落地：双方宝可梦跟着一起震
    stageShake();
  }, 300); // 跳起动画 0.4s，约 75% 处落地触发震屏
}
// 重创（伤害 ≥25% 最大 HP）：战斗画面整体震动一下
function stageShake() {
  if (isLogOpen()) return; // 查看对战记录时不做全屏震动
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

// 对战帐篷：敌方也会在明显劣势时主动换人
const TENT_DMG_KINDS = new Set(['damage', 'explode', 'multihit', 'fixed', 'drain', 'recoil', 'finalGambit', 'counter', 'mirrorCoat']);
function enemyOffense(mon, foe) {
  let off = 0;
  for (const id of mon.moves) {
    const mv = _data.moves[id];
    const ef = mv?.effect || {};
    if (!TENT_DMG_KINDS.has(ef.kind)) continue;
    const pow = ef.kind === 'fixed' ? 40 : (ef.power || 0);
    off = Math.max(off, typeMult(mv.type, foe.types) * (mon.types.includes(mv.type) ? 1.5 : 1) * (1 + Math.min(pow, 120) / 80));
  }
  return off;
}
function enemyMoveScore(mon, foe) {
  const off = enemyOffense(mon, foe);
  let threat = 0;
  for (const id of foe.moves) {
    const mv = _data.moves[id];
    const ef = mv?.effect || {};
    if (!TENT_DMG_KINDS.has(ef.kind)) continue;
    const pow = ef.kind === 'fixed' ? 40 : (ef.power || 0);
    threat = Math.max(threat, typeMult(mv.type, mon.types) * (foe.types.includes(mv.type) ? 1.5 : 1) * (1 + Math.min(pow, 120) / 80));
  }
  return off * 6 - threat * 3 + (mon.hp / mon.maxHp) * 7 + (mon.effStat(0) >= foe.effStat(0) ? 2 : 0);
}

function pickEnemySwitch(battle, mon, foe) {
  if (!battle.custom?.tentBattle || battle.round < 2) return -1;
  if (battle.round - (battle._eSwitchRound || -10) < 2) return -1;
  const bench = battle.eTeam.map((x, i) => (x.mon.hp > 0 && i !== battle.eIdx ? i : -1)).filter((i) => i >= 0);
  if (!bench.length) return -1;
  const score = (m) => enemyMoveScore(m, foe);
  const curScore = score(mon);
  const best = bench.map((i) => [i, score(battle.eTeam[i].mon)]).sort((a, b) => b[1] - a[1])[0];
  const hp = mon.hp / mon.maxHp;
  if (!best || best[1] <= curScore + 6) return -1;
  if (hp < 0.45 || enemyOffense(mon, foe) < 1) {
    if (Math.random() < 0.8) {
      battle._eSwitchRound = battle.round;
      return best[0];
    }
  }
  return -1;
}

// 普通 NPC 对战沿用旧 AI；对战帐篷让双方按性格出招
function aiFor(battle, actor, enemy) {
  return battle?.custom?.tentBattle
    ? aiMoveByNature(actor, enemy, _data)
    : aiMove(actor, enemy, _data);
}

// 对战帐篷：底部两个大按钮，攻击由宝可梦按性格自动选招
function askTentMove(battle) {
  return new Promise((resolve) => {
    _pendingAsk = resolve;
    const done = (act) => { _pendingAsk = null; resolve(act); };
    const pMon = curMon(battle, 'p');
    const eMon = curMon(battle, 'e');
    const dock = $('b-actions');
    const fight = $('act-fight');
    const pkm = $('act-pkm');
    const show = () => { if (dock) dock.style.display = 'flex'; };
    const hide = () => { if (dock) dock.style.display = 'none'; };
    // 只剩最后一只时没有可换目标，直接自动出招
    if (battle.pTeam.filter((x) => x.mon.hp > 0).length <= 1) {
      hide();
      if (!battle._tentSolo) {
        battle._tentSolo = true;
        setText('只剩最后一只，自动战斗中');
      }
      const mid = aiMoveByNature(pMon, eMon, _data) ?? firstUsableMove(pMon);
      done({ type: 'move', id: mid });
      return;
    }
    show();
    if (fight) fight.onclick = () => {
      hide();
      const mid = aiMoveByNature(pMon, eMon, _data) ?? firstUsableMove(pMon);
      done({ type: 'move', id: mid });
    };
    if (pkm) pkm.onclick = () => {
      hide();
      import('./team.js').then((m) => {
        m.showTeamViewForBattle(battle.pTeam, battle.pIdx, (idx) => {
          showView('battleView');
          if (idx < 0) { show(); return; }
          done({ type: 'switch', idx });
        });
      });
    };
  });
}

// 等待玩家选招；返回行动对象：{type:'move',id} / {type:'switch',idx}（撤退由标题栏返回触发）
// 布局：左栏文案/技能，右栏操作按钮；选招时右栏切换为招式详情 + 返回按钮
function askPlayerMove(battle) {
  if (battle.custom?.tentBattle) return askTentMove(battle);
  return new Promise((resolve) => {
    _pendingAsk = resolve; // 撤退时强制结束挂起的选择
    const done = (act) => { _pendingAsk = null; _fxdbgRestore = null; resolve(act); };
    const pMon = curMon(battle, 'p');
    // 招式调试面板关闭/播放结束后恢复行动按钮（showActions 是同作用域函数声明，向上提升）
    _fxdbgRestore = () => { if (_activeBattle === battle && !_auto) showActions(); };
    // 自动战斗：不弹操作界面，直接按 AI 逻辑自动出招（遮罩在点「自动」按钮时已显示）
    if (_auto) {
      const mid = aiMove(pMon, curMon(battle, 'e'), _data) ?? firstUsableMove(pMon);
      setTimeout(() => done({ type: 'move', id: mid }), 280); // 留一小拍播「想要做什么？」再自动行动
      return;
    }
    const cmd = $('b-cmd');
    const actions = $('b-actions');

    setText(`${pMon.name} 想要做什么？`);
    showActions();

    function showActions() {
      actions.className = 'b-actions';
      actions.innerHTML = `
        <div class="b-act-row">
          <button class="b-act" id="act-fight">攻击</button>
          <button class="b-act" id="act-pkm">替换</button>
        </div>
        <button class="b-act auto" id="act-auto">自动</button>`;
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
      // 自动战斗：隐藏右栏、铺上遮罩，本回合立刻按 AI 出招，后续回合持续自动
      $('act-auto')?.addEventListener('click', () => {
        _auto = true;
        const mid = aiMove(pMon, curMon(battle, 'e'), _data) ?? firstUsableMove(pMon);
        clearBottom();
        setText(`${pMon.name} 进入自动战斗`);
        const mask = $('b-auto-mask');
        if (mask) mask.style.display = 'flex';
        done({ type: 'move', id: mid });
      });
    }

    // 左下角克制提示：随 hover 的招式刷新（无效/收效甚微/有效/效果绝佳）
    // 变化/回复类招式不造成伤害，无克制概念，统一显示横杠
    function updateEffHint(mid) {
      const hint = $('b-eff-hint');
      const eMon = curMon(battle, 'e');
      const mv = mid != null ? _data.moves[mid] : null;
      if (!hint || !mv) return;
      if (moveCat(mv) === 'status') {
        hint.textContent = '——';
        hint.className = 'b-eff-hint';
        return;
      }
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
      const slotHtml = moves.map((m) => {
        const mv = m != null ? _data.moves[m] : null;
        const ef = mv && mv.effect;
        // 当前 PP（与 moves 对齐），用于按钮显示与耗尽判定
        const pi = moves.findIndex((mm) => mm != null && String(mm) === String(m));
        const curPp = pi >= 0 && pMon.pp ? pMon.pp[pi] : null;
        // 行动限制：再来一次锁定 / 定身法封印 / 挑衅只能攻击 / PP 耗尽，不可选招式置灰并附说明
        let dis = '', tip = '';
        if (!mv || !ef || ef.kind === 'unimplemented') { dis = ' disabled'; tip = '招式未实现'; }
        else if (pMon.lockedMove != null && String(m) !== pMon.lockedMove) { dis = ' disabled'; tip = '被「再来一次」锁定'; }
        else if (pMon.disabledMove != null && String(m) === pMon.disabledMove) { dis = ' disabled'; tip = '招式被封印'; }
        else if (pMon.tauntTurns > 0 && moveCat(mv) === 'status') { dis = ' disabled'; tip = '被挑衅，只能使用攻击招式'; }
        else if (curPp === 0) { dis = ' disabled'; tip = 'PP 不足'; }
        const badge = mv && mv.type !== '无' // 挣扎是无属性的伪招式，没有配色与图标
          ? `<span class="b-move-type" style="background:${TYPE_COLORS[mv.type]};color:${typeIconColor(mv.type)}">
            <svg class="b-move-type-icon"><use xlink:href="#icon-type-${mv.type}"></use></svg>
          </span>` : '';
        return { dis: !!dis, html: `<button class="b-move${dis}" data-move="${m}" title="${tip}"${dis ? ' disabled' : ''}>
          <span class="b-move-name">${mv ? mv.name : '—'}</span>
          ${badge}
        </button>` };
      });
      // 四招全都不可用（PP 耗尽 / 被封印 / 被挑衅…）时补一个「挣扎」：否则玩家只剩撤退一条路
      if (slotHtml.every((x) => x.dis)) {
        slotHtml.push({ dis: false, html: `<button class="b-move" data-move="${STRUGGLE_ID}" title="没有可用的招式了">
          <span class="b-move-name">挣扎</span>
        </button>` });
      }
      cmd.innerHTML = slotHtml.map((x) => x.html).join('');
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
      const pi = pMon.moves.findIndex((mm) => mm != null && String(mm) === String(mid));
      const cur = pi >= 0 && pMon.pp ? pMon.pp[pi] : null;
      el.innerHTML = `
        <div class="b-detail-grid">
          <div class="b-detail-col">
            <div class="b-detail-line"><span>PP</span><b${cur === 0 ? ' class="b-pp-zero"' : ''}>${cur != null ? `${cur}/${mv.pp ?? '?'}` : '∞'}</b></div>
            <div class="b-detail-line"><span>类型</span><b>${MOVE_CAT_CN[moveCat(mv)]}</b></div>
          </div>
          <div class="b-detail-col">
            <div class="b-detail-line"><span>威力</span><b>${mv.power ?? '—'}</b></div>
            <div class="b-detail-line"><span>命中</span><b>${mv.accuracy == null ? '—' : mv.accuracy === 0 ? '必中' : mv.accuracy}</b></div>
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
// 事件承受者定位：优先按 uid（百变怪变身/双方同种时名字撞车会定位错侧），名字匹配兜底
function evMon(battle, ev) {
  const p = curMon(battle, 'p');
  const e = curMon(battle, 'e');
  if (ev.uid != null) {
    if (p.uid === ev.uid) return p;
    if (e.uid === ev.uid) return e;
  }
  if (ev.who === p.name && ev.who !== e.name) return p;
  if (ev.who === e.name && ev.who !== p.name) return e;
  return null;
}
// 事件承受者所在侧：uid 优先，名字按 hitRef 二分兜底
function evSide(battle, ev, hitRef, hitSide, otherSide) {
  const m = evMon(battle, ev);
  if (m) return m === curMon(battle, 'p') ? 'bp' : 'be';
  return ev.who === hitRef.name ? hitSide : otherSide;
}

async function playEvents(events, battle, hitRef, hitType, multiSide, rangedOpts, opts = null) {
  const hitSide = hitRef === curMon(battle, 'p') ? 'bp' : 'be';
  const otherSide = hitSide === 'bp' ? 'be' : 'bp';
  // 防御：事件承受方已不在场（换人后局部变量残留指向旧宠）时，仅保留文本并等待，
  // 跳过伤害数字/受击震动/faint 动画——否则会误播到新上场的宝可梦身上
  const onField = hitRef === curMon(battle, 'p') || hitRef === curMon(battle, 'e');
  _multiHits = 0;
  const nSteps = events.filter((e) => e.t === 'step').length;
  const skipFx = !!opts?.skipFx; // 原作动画已播时，不再叠加旧粒子
  for (const ev of events) {
    if (ev.t === 'step') {
      // 物理连击：近战=首击冲贴脸停留，之后在贴脸位小幅挥砍，末击回位；
      // 远程=攻击方站原地逐击喷射一发粒子，等其飞抵目标再结算该段伤害，末击结束回位
      _multiHits++;
      if (opts?.skipStepAnim) continue;
      if (rangedOpts) {
        await spawnProjOne(multiSide, rangedOpts.shape, rangedOpts.color);
        if (_multiHits === nSteps) lowerAttacker(multiSide);
      } else {
        await swingOnce(multiSide, _multiHits === 1, _multiHits === nSteps);
      }
      continue;
    }
    if (ev.t === 'seedDrain') {
      // 寄生种子回合末吸血：绿色粒子从被吸者身上吸回施种者（双方都在场时才播）
      const pCur = curMon(battle, 'p');
      const eCur = curMon(battle, 'e');
      const fromSide = ev.from === pCur ? 'bp' : ev.from === eCur ? 'be' : null;
      const toSide = ev.to === pCur ? 'bp' : ev.to === eCur ? 'be' : null;
      if (fromSide && toSide && !skipFx) spawnDrainParticles(fromSide, toSide, 9);
      continue;
    }
    if (ev.t === 'flinch') {
      // 畏缩：头顶感叹号 + 向后退一步（我方屏幕向左、敌方屏幕向右，方向由镜像容器处理）
      setText(ev.text || `${ev.who}畏缩了！`);
      if (onField) {
        playAnim(hitSide, 'flinch');
        if (!skipFx) flinchFx(hitSide);
      }
      await battleSleep(350);
      continue;
    }
    if (ev.t === 'miss') {
      // 未命中：目标头顶弹出灰色 MISS（挥空反馈），正文保留招式文案
      setText(ev.text || '没有命中！');
      if (onField && !skipFx) missFx(hitSide);
      await battleSleep(450);
      continue;
    }
    if (ev.t === 'dmg') {
      // 按承受者定位播放侧：攻击伤害=目标侧，替身消耗/混乱自伤/回合伤害=自身侧
      const dMon = evMon(battle, ev);
      const dSide = dMon === curMon(battle, 'p') ? 'bp' : 'be';
      if (!dMon) { setText(ev.text || `${ev.who}受到 ${ev.amount} 点伤害！`); await battleSleep(300); continue; }
      popDmg(dSide, ev.amount, dMon);
      setText(ev.text || `${ev.who}受到 ${ev.amount} 点伤害！`);
      renderMon(dMon, dSide);
      // 连击等多次伤害：useMove 提前把 HP 全部扣光，renderMon 读到的是最终值；
      // 这里按本次命中前后的 HP 回放血条过渡，逐段扣血，不一次扣完
      if (ev.from != null) animateHpBar(dSide, ev.from, ev.to, dMon.maxHp);
      // 原作粒子流招式命中时补抖动/后撤；knockback 用定向后撤（远离攻击方）
      if (opts?.knockback) hitRecoil(dSide);
      else if (!skipFx || opts?.hitShake) shake(dSide);
      if (!skipFx && !opts?.skipImpact) {
        spawnImpactAsset(dSide);
      }
      // 水系近战命中：原作 WaterImpact 水花 + 蟹钳锤同款小气泡
      if (opts?.waterBubbles) {
        spawnWaterImpact(dSide);
        spawnSmallBubblesFx(dSide);
      }
      if (hitType === '超能') spawnPsychicWrap(dSide);
      flashHitPanel(dSide);
      if (!skipFx && dMon.maxHp > 0 && ev.amount / dMon.maxHp >= 0.25) stageShake(); // 重创（占比高）才全屏震动
      // 连击命中段：等待缩短到挥砍动画后立即衔接下一击（约 0.2s 动画 + 0.43s 停顿 ≈ 0.6s 一击）；
      // 原作动画已经演过命中，受了伤马上接下一句，不再额外停半秒
      await battleSleep(skipFx ? (nSteps ? 150 : 220) : (nSteps ? 300 : 500));
      hideCosmicBg();
    } else if (ev.t === 'heal') {
      const side = evSide(battle, ev, hitRef, hitSide, otherSide);
      popHeal(side, ev.amount);
      if (!skipFx) spawnHealFx(side); // 回复：BlueStar 星光粒子
      setText(ev.text);
      renderMon(side === 'bp' ? curMon(battle, 'p') : curMon(battle, 'e'), side);
      await battleSleep(500);
    } else if (ev.t === 'seed') {
      // 寄生种子种下：刷新目标侧精灵，触发脚下幼芽特效挂载
      const dMon = evMon(battle, ev);
      if (dMon) renderMon(dMon, dMon === curMon(battle, 'p') ? 'bp' : 'be');
      setText(ev.text);
      await battleSleep(450);
    } else if (ev.t === 'faint') {
      // 换人后旧宠残留的 faint 事件：只播文本，避免把新上场的宝可梦闪掉
      if (ev.uid === hitRef.uid && !onField) { setText(ev.text); await battleSleep(850); continue; }
      faintAnim(ev.uid === hitRef.uid ? hitSide : otherSide);
      setText(ev.text);
      await battleSleep(600);
    } else if (ev.t === 'status') {
      // 换人后旧宠残留的 status 事件：只播文本，避免震动误震新上场的宝可梦
      if (ev.uid === hitRef.uid && !onField) { setText(ev.text); await battleSleep(700); continue; }
      setText(ev.text);
      renderMon(hitRef, hitSide); // 立即刷新，属性后显示状态圆点
      // 灼伤用红光闪烁代替受击白闪，其它状态照常震动
      if (ev.status === 'burn') burnFlash(hitSide);
      else shake(hitSide); // 渲染后再震，避免被 renderMon 清掉动画类
      await battleSleep(450);
    } else if (ev.t === 'transform') {
      // 变身成功：立即切换对应侧外观/属性/招式（手动使用变身招式时触发；登场自动变身走 autoTransform）
      const side = evSide(battle, ev, hitRef, hitSide, otherSide);
      const mon = side === 'bp' ? curMon(battle, 'p') : curMon(battle, 'e');
      setText(ev.text);
      renderMon(mon, side);
      renderTeamInfo(battle);
      await battleSleep(700);
    } else if (ev.t === 'stat') {
      // 能力升降：立即刷新对应侧，属性后显示能力变化圆点（buff/debuff）
      const side = evSide(battle, ev, hitRef, hitSide, otherSide);
      const mon = side === 'bp' ? curMon(battle, 'p') : curMon(battle, 'e');
      setText(ev.text);
      renderMon(mon, side);
      await battleSleep(450);
    } else if (ev.t === 'block') {
      // 守住系护盾挡下招式：目标侧护盾白光一闪（换人后旧宠残留事件只播文本）
      if (ev.uid === hitRef.uid && !onField) { setText(ev.text); await battleSleep(450); continue; }
      const dMon = evMon(battle, ev);
      if (dMon) shieldHit(dMon === curMon(battle, 'p') ? 'bp' : 'be');
      setText(ev.text);
      await battleSleep(500);
    } else {
      setText(ev.text);
      await battleSleep(450);
    }
  }
}

let _multiHits = 0; // 物理连击已播放的击次计数（用于首/末击判定）

// 物理连击逐击摆动：首击冲到对手面前停留，之后在贴脸位小幅挥砍，末击动画结束回位
function swingOnce(side, first, last) {
  return new Promise((resolve) => {
    const el = $(`${side}-img`);
    if (!el) return resolve();
    resetAnim(el);
    void el.offsetWidth;
    raiseAttacker(side);
    const r = el.getBoundingClientRect();
    const f = lungeTargetRect(side);
    if (!f) return resolve();
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

// 未命中：目标头顶弹出灰色 MISS 大字（挥空反馈），弹出后上浮淡出；
// 目标离场蓄力（挖洞/飞翔等）时改显示在地面底座上方，避免出现在天上的精灵位置
function missFx(side) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img) return;
  let ir = img.getBoundingClientRect();
  if (img.dataset.charged === '1') {
    const base = $(`${side}-base`);
    if (base) ir = base.getBoundingClientRect();
  }
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
  // 畏缩（击掌奇袭等本回合瞬时打断）：无法行动，不标记为已行动
  if (mon.flinch) {
    mon.flinch = false;
    setText(`${mon.name}畏缩了，无法行动！`);
    playAnim(side, 'flinch');
    flinchFx(side);
    await battleSleep(450);
    return;
  }
  battle._acted.add(mon.uid); // 记录本回合已行动（供畏缩判定：已行动者不再畏缩）
  if (mon.status === 'sleep' && mon.sleepTurns > 0) {
    mon.sleepTurns--; // 本回合入睡消耗 1 个睡眠回合（与 preTurn 先判后减语义一致）
    setText(`${mon.name}正在呼呼大睡。`);
    await battleSleep(450);
    return;
  }
  await doAttack(mon, side, moveId, battle);
}

// ---------- 两回合招式（挖洞/飞翔/潜水/弹跳/神鸟猛击/潜灵奇袭/日光束/日光刃） ----------
// 第一回合进入蓄力状态（chargeMove 挂起），第二回合自动出招结算伤害
const CHARGE_MOVES = new Set(['挖洞', '飞翔', '潜水', '弹跳', '神鸟猛击', '潜灵奇袭', '日光束', '日光刃']);
// 蓄力期间是否离场隐藏（神鸟猛击/日光束/日光刃为原地蓄力，不隐藏）
const CHARGE_HIDES = { 挖洞: true, 飞翔: true, 潜水: true, 弹跳: true, 潜灵奇袭: true, 神鸟猛击: false, 日光束: false, 日光刃: false };
const CHARGE_ENTER_TEXT = {
  挖洞: (n) => `${n} 挖洞钻入了地下！`,
  飞翔: (n) => `${n} 飞向了高空！`,
  潜水: (n) => `${n} 潜入了水中！`,
  弹跳: (n) => `${n} 高高跃起！`,
  神鸟猛击: (n) => `${n} 开始积蓄力量！`,
  潜灵奇袭: (n) => `${n} 消失在了暗影中！`,
  日光束: (n) => `${n} 吸收了阳光！`,
  日光刃: (n) => `${n} 吸收了阳光！`,
};
// 进入蓄力的精灵位移动画类：下潜（挖洞/潜水）/ 升空（飞翔/弹跳）/ 原地蓄光 / 隐身
const CHARGE_ENTER_CLS = {
  挖洞: 'cg-sink', 潜水: 'cg-sink',
  飞翔: 'cg-rise', 弹跳: 'cg-rise',
  神鸟猛击: 'cg-glow',
  日光束: 'cg-glow', 日光刃: 'cg-glow',
  潜灵奇袭: 'cg-vanish',
};
// 第二回合现身攻击的动画类：从地下破土而出 / 从空中俯冲而下 / 显现冲刺
const CHARGE_OUT_CLS = {
  挖洞: 'cg-out-sink', 潜水: 'cg-out-sink',
  飞翔: 'cg-out-rise', 弹跳: 'cg-out-rise', 神鸟猛击: 'cg-out-rise',
  日光刃: 'cg-glow',
  潜灵奇袭: 'cg-out-vanish',
};
// 第一回合蓄力进入：播放对应离场动画（飞翔升空/挖洞钻地等，过程完整可见），钻地/潜水在脚部溅起尘土与水花。
// 离场状态用 dataset.charged 标记（供对方攻击瞄准底座），不直接隐藏本体以免遮掉动画
async function playChargeEnter(side, mvName, moveId) {
  if (mvName === '神鸟猛击') {
    nudgeAttacker(side); // 跳过原作耗时的调色前摇，只保留施法平移
    await battleSleep(300);
    return true;
  }
  const pe = await playPeMove(moveId, side, { twoTurn: true, turn: 1 });
  if (pe) return true;
  const el = $(`${side}-img`);
  if (!el) return false;
  resetAnim(el);
  void el.offsetWidth;
  el.classList.add(CHARGE_ENTER_CLS[mvName] || 'cg-vanish');
  el.dataset.charged = CHARGE_HIDES[mvName] ? '1' : ''; // 神鸟猛击原地蓄光不标记离场
  if (mvName === '挖洞') spawnGroundBurst(side, '#b98f5e', 9);
  else if (mvName === '潜水') spawnGroundBurst(side, '#7fd0f5', 7);
  return false;
}
// 第二回合攻击：先播现身动画（破土/俯冲/跃出），再冲到对手面前结算伤害；日光束原地发射光柱
async function playChargeAttack(actor, side, moveId, battle) {
  const mv = _data.moves[moveId];
  const foe = curMon(battle, side === 'bp' ? 'e' : 'p');
  const el = $(`${side}-img`);
  const solarBeam = mv.name === '日光束';
  const waterPhys = mv.type === '水' && moveCat(mv) === 'phys'; // 潜水等水系近战：命中补小气泡
  setText(`${actor.name}使用${mv.name}攻击！`);
  const evs = [];
  useMove(actor, foe, moveId, _data, evs, battle);
  const missed = evs.some((e) => e.t === 'miss') && !evs.some((e) => e.t === 'dmg' && e.uid === foe.uid);
  const peDone = missed ? false : await playPeMove(moveId, side, {
    twoTurn: true,
    turn: 2,
    melee: true,
    cast: mv.name === '神鸟猛击',
    keepHidden: mv.name === '飞翔' || mv.name === '挖洞',
    onReveal: () => { if (el) el.style.visibility = ''; },
  });
  if (peDone) {
    if (el && CHARGE_HIDES[mv.name]) el.style.visibility = '';
    if (_fleeing || (_activeBattle !== battle && !battle.__fxdbg)) return;
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true, waterBubbles: waterPhys });
    return;
  }
  if (el) {
    el.style.visibility = ''; // 飞翔等 PE 蓄力会隐藏本体，miss 时也要归位
    el.dataset.charged = ''; // 结束离场蓄力，恢复可被瞄准的在场状态
    resetAnim(el);
    void el.offsetWidth;
    if (!solarBeam) el.classList.add(CHARGE_OUT_CLS[mv.name] || 'cg-out-vanish');
  }
  if (mv.name === '挖洞') spawnGroundBurst(side, '#b98f5e', 10);
  else if (mv.name === '潜水') spawnGroundBurst(side, '#7fd0f5', 8);
  await battleSleep(340); // 等现身动画播完
  if (!missed) {
    if (solarBeam) {
      spawnSolarBeam(side === 'bp' ? 'be' : 'bp'); // 对手脚下向上射出一根柔光细柱
      await battleSleep(500);
    } else {
      lungeAttack(side); // 近身招式：冲撞对手
      await battleSleep(280);
    }
  } else {
    await battleSleep(200);
  }
  await playEvents(evs, battle, foe, mv.type, null, null, missed ? { skipStepAnim: true, skipFx: true } : (waterPhys ? { waterBubbles: true } : null));
}
// 尘土/水花：精灵脚部向两侧溅起一圈小颗粒（挖洞钻地/破土、潜水入水/跃出用）
function spawnGroundBurst(side, color, count) {
  const img = $(`${side}-img`);
  const box = $(`${side}-box`);
  if (!img || !box) return;
  const ir = img.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-ground-fx';
  fx.style.setProperty('--fc', color);
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top + ir.height - 3) + 'px'; // 脚底
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const dir = Math.random() < 0.5 ? -1 : 1;
    p.style.setProperty('--dx', (dir * (8 + Math.random() * 24)).toFixed(1) + 'px');
    p.style.setProperty('--dy', -(5 + Math.random() * 20).toFixed(1) + 'px'); // 向上溅
    p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
    p.style.animationDuration = (0.35 + Math.random() * 0.3).toFixed(2) + 's';
    fx.appendChild(p);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 800);
}

// 执行一次出招：攻击方前冲使用招式，目标实时取对方当前在场宝可梦；
// 任一方已倒下（先动者击倒后动者）则后动者本回合不再行动，避免对已倒下目标出手
async function doAttack(actor, side, moveId, battle) {
  // 麻痹的宝可梦成功出招时，先收起身上常驻的电花，动画结束再恢复
  const statusFx = actor.status === 'paralysis'
    ? $(`${side}-box`)?.querySelector('.b-status-fx')
    : null;
  if (statusFx) statusFx.style.visibility = 'hidden';
  try {
    await doAttackInner(actor, side, moveId, battle);
  } finally {
    if (statusFx && statusFx.isConnected && actor.hp > 0 && actor.status === 'paralysis') statusFx.style.visibility = '';
  }
}

async function doAttackInner(actor, side, moveId, battle) {
  if (!moveId || actor.hp <= 0) return;
  const foe = curMon(battle, side === 'bp' ? 'e' : 'p');
  if (foe.hp <= 0) return; // 对手已被击倒：本回合不再行动
  // 两回合招式第二回合：chargeMove 已挂起（选招阶段自动带出），强制执行攻击阶段
  if (actor.chargeMove != null) {
    const cm = actor.chargeMove;
    actor.chargeMove = null;
    actor.chargeHidden = false;
    await playChargeAttack(actor, side, cm, battle);
    return;
  }
  const mv = _data.moves[moveId];
  // 两回合招式第一回合：进入蓄力（钻地/升空/入水/隐身/蓄光），本回合不出伤
  if (CHARGE_MOVES.has(mv.name)) {
    actor.chargeMove = moveId;
    actor.chargeHidden = !!CHARGE_HIDES[mv.name];
    setText(CHARGE_ENTER_TEXT[mv.name](actor.name));
    const pePrep = await playChargeEnter(side, mv.name, moveId);
    if (pePrep && CHARGE_HIDES[mv.name]) $(`${side}-img`).style.visibility = 'hidden';
    await battleSleep(pePrep ? (mv.name === '挖洞' ? 120 : 260) : 720); // 等蓄力动画播完，本回合行动结束
    return;
  }
  setText(`${actor.name}使用了${mv.name}！`);
  const evs = [];
  useMove(actor, foe, moveId, _data, evs, battle);
  const missed = evs.some((e) => e.t === 'miss') && !evs.some((e) => e.t === 'dmg' && e.uid === foe.uid);
  if (missed) {
    await battleSleep(200);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    return;
  }
  if (mv.name === '吸取之吻') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    await battleSleep(80);
    spawnDrainingKissFx(side, tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '拍击') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    await battleSleep(220);
    spawnTagHandStrike(tSide, 0);
    spawnImpactAsset(tSide);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '连环巴掌') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    const hits = evs.filter((e) => e.t === 'step').length || 2;
    lungeAttack(side);
    await battleSleep(220);
    const hands = (async () => {
      for (let i = 0; i < hits; i++) {
        spawnTagHandStrike(tSide, i);
        shake(tSide);
        await battleSleep(170);
      }
    })();
    await Promise.all([hands, playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true })]);
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '再来一次') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnEncoreClap(tSide);
    await battleSleep(900);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '暗影爪' || mv.name === '克命爪') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    await battleSleep(220);
    spawnClawSlashFx(tSide, mv.name === '暗影爪' ? '#9a6cd0' : '#b35cff');
    spawnImpactAsset(tSide);
    shake(tSide);
    await battleSleep(280);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '大字爆炎') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    await spawnFireBlastShot(side);
    spawnFireBigExplosion(tSide);
    shake(tSide);
    await battleSleep(380);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '贝壳刃') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    await battleSleep(220);
    spawnSparkleSlash(tSide);
    spawnImpactAsset(tSide);
    spawnWaterImpact(tSide); // 水系近战命中：水花与小气泡和命中贴图同帧叠加
    spawnSmallBubblesFx(tSide);
    shake(tSide);
    await battleSleep(260);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '头锤' || mv.name === '火箭头锤') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    await battleSleep(240);
    spawnImpactAsset(tSide);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '百万吨重拳') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    await battleSleep(240);
    spawnImpactBg(tSide);
    spawnPunchFist(tSide, { size: 46 });
    spawnImpactAsset(tSide);
    shake(tSide);
    await battleSleep(320);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '花瓣舞') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    await spawnPetalDanceFx(tSide);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '归天之翼') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    await spawnAirBladeStream(side, 2);
    shake(tSide);
    spawnImpactAsset(tSide);
    spawnDrainParticles(tSide, side, 8);
    await battleSleep(520);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    spawnHealFx(side);
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '幻象光线' || mv.name === '精神波') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    await spawnProjStream(side, 'ring', '#F8669C');
    spawnImpactAsset(tSide);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '空气之刃' || mv.name === '空气利刃') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side); // 施法前倾，同时把风刃甩出去
    await spawnAirBladeStream(side, 2);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '十万伏特' || mv.name === '伏特攻击') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    if (mv.name === '伏特攻击') lungeAttack(side);
    else lunge(side); // 特殊十万伏特：施法前倾与闪电同时
    spawnVoltFlash();
    spawnLightningAsset(tSide, mv.name === '伏特攻击' ? 1 : 2);
    await battleSleep(300);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '雷电牙' || mv.name === '冰冻牙' || mv.name === '火焰牙' || mv.name === '精神之牙' || mv.name === '剧毒牙' || mv.name === '虫咬') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    spawnFangBite(tSide, mv.name);
    await battleSleep(170);
    spawnFangParticles(tSide, mv.name);
    spawnImpactAsset(tSide);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '精神突进') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnPsyCharge(side);
    await battleSleep(600);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null);
    syncFieldFx(battle);
    return;
  }
  if (METEOR_MOVES.has(mv.name)) spawnCosmicBg();
  if (mv.name === '流星群') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    const dur = spawnMeteorRain(tSide, 6);
    await battleSleep(dur);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    hideCosmicBg();
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '临别礼物') {
    await playMementoFx(side);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    return;
  }
  if (mv.name === '抓狂') {
    await flailWindup(side);
    await playEvents(evs, battle, foe, mv.type, null, null);
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '冰冻之风') {
    lunge(side); // 施法前倾与寒气同时
    spawnMistStream(side);
    await battleSleep(560);
    await playEvents(evs, battle, foe, mv.type, null, null);
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '极光束') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side); // 施法前倾与彩虹光束同时
    spawnAuroraBg(); // 原作同款极光背景
    spawnAuroraBeam(side);
    await battleSleep(460); // 等光束与彩虹光环射到对手再结算
    shake(tSide);
    spawnImpactAsset(tSide);
    spawnImpactTint(tSide, TYPE_COLORS['冰']);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '水枪' || mv.name === '喷水') {
    lunge(side); // 施法前倾与水流同时（之前漏了前倾）
    spawnHydroOrbStream(side);
    await battleSleep(420);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '盐水') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnBrineRain(tSide);
    await battleSleep(520);
    spawnImpactTint(tSide, TYPE_COLORS['水']);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '水流环') {
    spawnAquaRing(side);
    await battleSleep(1000);
    await playEvents(evs, battle, foe, mv.type, null, null);
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '电击') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side); // 施法前倾与落雷同时
    spawnVoltFlash();
    spawnLightningAsset(tSide, 3);
    await battleSleep(360);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '电击波') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    spawnShockWaveFx(side, tSide);
    await battleSleep(520);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '喝牛奶') {
    spawnMilkDrinkFx(side);
    await battleSleep(780);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '双针') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnNeedleAsset(side, tSide);
    await battleSleep(160);
    spawnNeedleAsset(side, tSide);
    await battleSleep(380);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '溶解液') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    await spawnProjStream(side, 'acid', TYPE_COLORS['毒']);
    spawnPoisonOrbBurst(tSide);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '毒千针') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    const ok = await playPeMove(40, side, { melee: false, cast: true });
    if (!ok) {
      spawnNeedleAsset(side, tSide);
      await battleSleep(380);
      spawnPoisonOrbBurst(tSide);
    }
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '破坏光线') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    spawnCrossBeamFx(side, tSide, '#ffc46b');
    await battleSleep(360);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '撒菱' || mv.name === '毒菱') {
    const toxic = mv.name === '毒菱';
    const host = document.querySelector('.battle-stage-top') || document.querySelector('.battle-fight');
    if (toxic) host?.classList.add('pe-toxic-hazards');
    try {
      await playPeMove(191, side, { melee: false, cast: true });
    } finally {
      if (toxic) host?.classList.remove('pe-toxic-hazards');
    }
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '汲取') {
    await playPeMove(141, side, { melee: false, cast: true });
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (BIND_MOVES.has(mv.name)) {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    await battleSleep(160);
    spawnBindWrapFx(tSide);
    await battleSleep(560);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '蟹钳锤') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side); // 贴脸：攻击方冲到对手面前再挥钳
    await battleSleep(220);
    spawnWaterImpact(tSide);
    spawnSmallBubblesFx(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true, knockback: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '踢倒') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    await battleSleep(300);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '吸取拳') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    await battleSleep(200);
    spawnPunchFist(tSide);
    shake(tSide);
    spawnImpactAsset(tSide);
    // 等贴身冲撞回到原位后，再完整播放吸取的吸取段
    await battleSleep(340);
    await playPeLabel('AbsorbEffect', side);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (FIST_MOVES.has(mv.name)) {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    await battleSleep(200);
    spawnPunchFist(tSide, {
      count: mv.name === '钢拳双击' ? 2 : 1,
      size: mv.name === '极巨拳斗' ? 50 : 30,
    });
    if (mv.name === '等离子闪电拳') {
      spawnVoltFlash();
      spawnParalysisBurst(tSide);
    }
    shake(tSide);
    spawnImpactAsset(tSide);
    if (mv.type === '水') {
      spawnWaterImpact(tSide); // 水系拳招（喷射拳）：水花与小气泡和命中贴图同帧叠加
      spawnSmallBubblesFx(tSide);
    }
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '恶之波动' || mv.name === '怒火中烧') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    spawnDarkPulseFx(side);
    await battleSleep(620);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '喷出') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    spawnSpitUpFx(side);
    await battleSleep(560);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '缩入壳中') {
    spawnShellTuckFx(side); // 壳盖合拢收进去，张开时弹出防御脉冲
    await battleSleep(840);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '充电') {
    spawnChargeFx(side);
    await battleSleep(1000);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '地球上投') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    // 命中帧只叠打击视觉；扣血与倒下一律等整套抛起落地动画播完再执行
    await spawnSeismicLiftFx(side, tSide, () => {
      shake(tSide);
      spawnImpactAsset(tSide);
    });
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '模仿') {
    // 模仿：原作脚本复用的是命中泼溅帧，观感不对；改成把对手身上的能量吸过来
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    await battleSleep(160);
    spawnDrainParticles(tSide, side, 12);
    await battleSleep(600);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '岩崩') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnRockSlide(tSide);
    await battleSleep(820);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '击落') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnStoneBarrageFx(side, tSide, 1);
    await battleSleep(800);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '原始之力') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnStoneBarrageFx(side, tSide, 4);
    await battleSleep(800);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '岩石爆击') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    const hits = evs.filter((e) => e.t === 'step').length || 3;
    spawnStoneBarrageFx(side, tSide, hits);
    await battleSleep(800);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '岩石封锁') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnRockTombFx(tSide);
    await battleSleep(620);
    spawnXMark(tSide);
    shake(tSide);
    await battleSleep(260);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '岩石打磨') {
    spawnBlueStarBurst(side, 10);
    await battleSleep(760);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (STONE_RANGED.has(mv.name)) {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnStoneBarrageFx(side, tSide);
    await battleSleep(700);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '月光' || mv.name === '新月祈祷') {
    spawnMoonFx(side, side, 'heal');
    await battleSleep(960);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '月亮之力') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnMoonFx(side, tSide, 'attack');
    await battleSleep(960);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '落石') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnRockDrop(tSide);
    await battleSleep(760);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '黑雾') {
    spawnHazeFx();
    await battleSleep(1000);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '烟幕') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnSmokeScreen(tSide);
    await battleSleep(160);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '清除之烟') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnClearSmogFx(side, tSide);
    await battleSleep(780);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '打草结') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side); // 施法前倾
    shake(tSide);
    spawnLeafBurstFx(tSide); // 直接在对手身上炸开树叶
    await battleSleep(320);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '龙卷风') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    spawnTwisterFx(tSide);
    await battleSleep(900);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '乱抓') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    const hits = evs.filter((e) => e.t === 'step').length || 2;
    spawnFurySwipes(tSide, hits);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '电磁炮' || mv.name === '电球') {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lunge(side);
    spawnElectricBall(side, mv.name === '电磁炮' ? 1 : 2);
    await battleSleep(440);
    shake(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  if (mv.name === '火之舞' || mv.name === '烈火深渊') {
    await playPeMove(83, side, { melee: false, cast: true });
    await playEvents(evs, battle, foe, mv.type, null, null);
    syncFieldFx(battle);
    return;
  }
  if (HAND_CLAMP_MOVES.has(mv.name)) {
    const tSide = side === 'bp' ? 'be' : 'bp';
    lungeAttack(side);
    await battleSleep(60);
    spawnClampHands(tSide);
    await battleSleep(150);
    shake(tSide);
    spawnImpactAsset(tSide);
    await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
    syncFieldFx(battle);
    return;
  }
  const hitShakeOnImpact = PARTICLE_HIT_SHAKE_MOVES.has(mv.name);
  // 水系近战 + 活活气泡：命中时补水花 + 小气泡（和命中贴图同帧叠加，不另起一段）
  const waterBubbles = mv.type === '水' && (moveCat(mv) === 'phys' || mv.name === '活活气泡');
  const playImpact = () => playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true, hitShake: hitShakeOnImpact, waterBubbles });
  const peId = mv.name === '骨棒乱打' ? 125 : mv.name === '蛮力' ? 70 : mv.name === '龙之怒' ? 225
    : mv.name === '雷击' ? 87 : moveId; // 雷击复用打雷（已简化为单段落雷）
  // 重踏/地震：原作动画一开场就是地面震动，让双方宝可梦同步跟着颠动
  if (mv.name === '地震' || mv.name === '重踏') quakeRattle();
  // 冰冻光束：原作那套冰晶串在游戏里看不清光束，改走手写的直线光束
  const peDone = (mv.name === '冲浪' || mv.name === '浊流' || mv.name === '冰冻光束') ? false : await playPeMove(peId, side, {
    speed: mv.name === '晨光' ? 2 : 1,
    type: mv.type,
    // 暗影球：弹道命中时没有命中类 sprite，把命中帧挂在目标被震那一帧，好补 impact 贴图
    hitOnShake: mv.name === '暗影球',
    // 远程物理/多段远程由原作脚本自己发射弹道，不能再叠加贴身扑击
    // 雷击复用打雷的施法式落雷，不做近身冲撞
    melee: mv.name !== '雷击' && moveCat(mv) === 'phys' && !RANGED_SINGLE[mv.name] && !RANGED_PHYS_MULTI[mv.name],
    cast: mv.name === '雷击' || moveCat(mv) === 'spec'
      || (moveCat(mv) === 'phys' && (mv.name === '攀瀑' || !!(RANGED_SINGLE[mv.name] || RANGED_PHYS_MULTI[mv.name])))
      || (moveCat(mv) === 'status' && mv.effect?.target === 'foe'),
    // 命中帧只叠打击视觉；扣血、伤害数字与倒下一律等整段动画播完再执行
    onImpact: () => {
      // 打雷/雷击：保留击中瞬间的震屏与头顶落雷，打击感更强
      if (mv.name === '打雷' || mv.name === '雷击') {
        const tSide = foe === curMon(battle, 'p') ? 'bp' : 'be';
        const img = $(`${tSide}-img`);
        const layer = tSide === 'bp' ? img?.parentElement : img;
        const prevZ = layer?.style.zIndex;
        if (layer) layer.style.zIndex = '7';
        shake(tSide);
        spawnLightningAsset(tSide, 1);
        setTimeout(() => { if (layer && layer.isConnected) layer.style.zIndex = prevZ; }, 520);
      }
      // 暗影球：命中帧在对手身上叠一张 impact 贴图，增强打击感
      if (mv.name === '暗影球') {
        const tSide = foe === curMon(battle, 'p') ? 'bp' : 'be';
        spawnImpactAsset(tSide);
      }
      // 种子机关枪：原作脚本只有种子 sprite、没有命中贴图，每颗种子飞抵时补一张 impact
      if (mv.name === '种子机关枪') {
        const tSide = foe === curMon(battle, 'p') ? 'bp' : 'be';
        spawnImpactAsset(tSide);
      }
    },
  });
  if (peDone) {
    if (_fleeing || (_activeBattle !== battle && !battle.__fxdbg)) return;
    await playImpact();
    return;
  }
  const isPhys = moveCat(mv) === 'phys';
  const isSound = SOUND_MOVES.has(mv.name); // 发声招式：声波弹道
  const isBubble = mv.name === '泡沫' || mv.name === '泡沫光线' || mv.name === '水枪' || mv.name === '喷水' || mv.name === '活活气泡'; // 水系弹道招式：气泡特效
  const isStar = mv.name === '高速星星'; // 高速星星：星形弹道特效
  // 圆环弹道（幻象光线/精神波 超能粉；水炮 水系蓝）
  const isRing = mv.name === '幻象光线' || mv.name === '精神波' || mv.name === '水炮';
  const RING_COLOR = { '幻象光线': '#F8669C', '精神波': '#F8669C', '水炮': '#3F98EA' };
  const isPsychicWrap = mv.name === '念力'; // 念力：目标身上扭动圆环
  const isIceBeam = mv.name === '冰冻光束' || mv.name === '铁蹄光线'; // 冰冻光束/铁蹄光线：直线光束
  const isSolarBeam = mv.name === '日光束'; // 日光束：对手脚下向上射出一根柔光细柱
  const isConfuse = mv.name === '奇异之光'; // 奇异之光：柔和描边黄色球
  const isFireStream = mv.name === '喷射火焰' || mv.name === '喷火'; // 喷射火焰/喷火：火系一串弹道
  const isAcidStream = mv.name === '溶解液'; // 溶解液：毒系一串酸液滴弹道
  const isScreenFlash = mv.name === '魔法闪耀' || mv.name === '电光' || mv.name === '精神强念'; // 全屏遮罩闪光：魔法闪耀/电光/精神强念
  // 叶片弹道：飞叶快刀/飞叶风暴 用原作树叶素材，花瓣舞用原作粉色花瓣素材
  const isLeafStream = mv.name === '飞叶快刀' || mv.name === '花瓣舞' || mv.name === '飞叶风暴';
  // 风系/龙卷风类招式（起风/翅膀攻击/龙卷风/暴风/空气利刃 青白，热风红，妖精之风粉，冰冻之风蓝）
  const isWind = mv.name === '起风' || mv.name === '翅膀攻击' || mv.name === '暴风' || mv.name === '空气利刃' || mv.name === '热风' || mv.name === '妖精之风' || mv.name === '冰冻之风';
  const WIND_COLOR = { '热风': '#ff5a3c', '妖精之风': '#f8669c', '冰冻之风': '#7fd0f5' };
  // 龙系特殊招式（龙息/龙之波动/流星群/时光咆哮/亚空裂斩/鳞片噪音/巨龙威能/归无之光/随机光）：龙息能量波弹道；龙卷风走旋风特效
  const isDragon = mv.type === '龙' && moveCat(mv) === 'spec' && mv.name !== '龙卷风';
  // 吸血招式（吸取/超级吸取/终极吸取/吸取拳/吸取之吻等 drain 类）：命中后粒子从目标吸回攻击方
  const isDrain = mv.effect && mv.effect.kind === 'drain';
  // 大范围水系招式（冲浪/浊流）：原作浪花贴图横扫战场（其余水系招式都有原作脚本或有自己的弹道特效）
  const isSurfWave = mv.name === '冲浪' || mv.name === '浊流';
  const isSludgeWave = mv.name === '污泥波';
  const isHotWater = mv.name === '热水';
  const BALL_COLOR = { '暗影球': '#7a52c9', '火花': '#ff7a2e', '磷火': '#ff7a2e', '大字爆炎': '#ff7a2e' };
  const BALL_IMG = {
    '能量球': { img: 'Gfx_Orbs__16x16.png', frames: 3, frame: 2, px: 28 },
    '电球': { img: 'Gfx_Shock3__32x32.png', frames: 3, frame: 2, px: 30 },
    '火焰球': { img: 'Gfx_WispFire__32x32.png', frames: 4, frame: 3, px: 30 },
    '意念头锤': { img: 'Gfx_HollowOrb__16x16.png', frames: 1, frame: 0, px: 30, filter: 'sepia(1) saturate(6) hue-rotate(-55deg) brightness(1.05)' },
    '击落': { img: 'Gfx_Rocks__32x32.png', frames: 6, frame: 0, px: 30 },
    '加农光炮': { img: 'Gfx_WeatherBall__32x32.png', frames: 1, frame: 0, px: 30 },
  };
  const isBall = Object.prototype.hasOwnProperty.call(BALL_COLOR, mv.name) || Object.prototype.hasOwnProperty.call(BALL_IMG, mv.name);
  // 圆石弹道（原始之力 岩石 / 掷泥 地面）：一串实心圆粒飞向对手，颜色按属性取
  const isPebble = mv.name === '原始之力' || mv.name === '掷泥';
  const PEBBLE_COLOR = { '原始之力': '#D3A865', '掷泥': '#9C5A59' };
  const isElectric = mv.type === '电' && moveCat(mv) === 'spec'; // 电系特殊招式：头顶闪电特效（物理电系如伏特攻击走普通冲撞）
  const isQuake = mv.name === '重踏' || mv.name === '地震'; // 地面系砸地招式：原地跳起砸地震屏
  const isRockSlide = mv.name === '岩崩'; // 岩崩：目标头顶砸落一堆岩石
  const isRockThrow = mv.name === '落石'; // 落石：目标头顶砸下一颗大石头
  const isSnowSlide = mv.name === '雪崩'; // 雪崩：目标头顶砸落雪球
  // 物理连击：不预摆，由 playEvents 的 step 标记逐击摆动
  const multiPhys = mv.effect.kind === 'multihit' && isPhys;
  // 远程多段物理：攻击方站原地逐发喷射（不贴脸），每发与 playEvents 的击次同步
  const rangedPhys = multiPhys && RANGED_PHYS_MULTI[mv.name];
  // 远程单体物理（冰砾/毒针/毒千针/垃圾射击）：不贴脸，发射一发粒子飞向对手（形状/颜色见 RANGED_SINGLE）
  const rangedSingle = RANGED_SINGLE[mv.name];
  if (!multiPhys) {
    // 特攻弹道招式：出手的同一下前倾，和发射物同帧（物理冲撞走下面的 lungeAttack，吸血招式在命中段自带前倾）
    if (!isPhys && !isDrain && moveCat(mv) === 'spec' && mv.effect?.target !== 'self' && mv.name !== '能量球') lunge(side);
    if (isSound) {
      const selfSound = mv.effect?.target === 'self' || mv.effect?.kind === 'cure';
      spawnSoundWave(side, selfSound ? side : (side === 'bp' ? 'be' : 'bp')); // 从攻击方发出声波，自身增益只原地扩散
      await battleSleep(320); // 等声波扩散起效再结算
    } else if (isWind) {
      spawnWindTornado(side, WIND_COLOR[mv.name]); // 彩色旋风刮向对手
      await battleSleep(mv.name === '翅膀攻击' ? 500 : 430); // 等旋风消失时再结算
    } else if (isHotWater) {
      await spawnProjStream(side, 'drop', '#ffb36b');
    } else if (isSurfWave) {
      spawnSurfWave(side, mv.name === '浊流' ? 'mud' : 'water'); // 冲浪/浊流：原版浪花贴图
      // 水层 0.9s 才涌到对面，等浪拍到目标身上再结算（受击颤抖与浪头同帧）
      await battleSleep(700);
    } else if (isSludgeWave) {
      spawnSurfWave(side, 'sludge');
      await battleSleep(700);
    } else if (isDragon) {
      spawnDragonWave(side); // 龙息能量波弹道
      await battleSleep(480); // 等能量波飞抵目标再结算伤害（动画 0.6s，到位约 0.5s）
    } else if (isBubble) {
      await spawnProjStream(side, 'bubble');
    } else if (isStar) {
      await spawnProjStream(side, 'star');
    } else if (isPebble) {
      await spawnProjStream(side, 'pebble', PEBBLE_COLOR[mv.name]);
    } else if (isRing) {
      await spawnProjStream(side, 'ring', RING_COLOR[mv.name]);
    } else if (isPsychicWrap) {
      await battleSleep(480); // 等念力前摇结束，粉色圆环随命中结算出现
    } else if (isConfuse) {
      await spawnProjStream(side, 'confuse');
    } else if (isFireStream) {
      await spawnProjStream(side, 'flame', '#ff7a2e');
    } else if (isAcidStream) {
      await spawnProjStream(side, 'acid', TYPE_COLORS['毒']);
    } else if (isScreenFlash) {
      spawnScreenFlash(); // 粉色半透明遮罩全屏一闪
      await battleSleep(320); // 等遮罩闪光扩散完再结算伤害
    } else if (isLeafStream) {
      await spawnProjStream(side, mv.name === '花瓣舞' ? 'petal' : 'leaf');
    } else if (isBall) {
      const proj = spawnProjStream(side, 'ball', BALL_COLOR[mv.name], mv.name === '击落', BALL_IMG[mv.name]);
      if (mv.name === '能量球') {
        await battleSleep(170);
        lunge(side);
      }
      await proj;
    } else if (isIceBeam) {
      spawnIceBeam(side); // 一道淡蓝色直线射到对手
      await battleSleep(360); // 等光束射到对手处再结算伤害
    } else if (isSolarBeam) {
      spawnSolarBeam(side === 'bp' ? 'be' : 'bp'); // 对手脚下向上射出一根柔光细柱
      await battleSleep(500); // 等光束从脚下升起再结算伤害
    } else if (isQuake) {
      quakeAttack(side); // 原地快速跳起后砸地，落地震屏
      await battleSleep(400); // 等落地震屏起效时再结算伤害
    } else if (isRockSlide) {
      spawnRockSlide(side === 'bp' ? 'be' : 'bp'); // 目标头顶砸落一堆岩石
      await battleSleep(520); // 等岩石砸中目标再结算伤害
    } else if (isRockThrow) {
      spawnRockDrop(side === 'bp' ? 'be' : 'bp'); // 目标头顶砸下一颗大石头
      await battleSleep(560); // 等大石头砸中目标再结算伤害
    } else if (isSnowSlide) {
      spawnSnowSlide(side === 'bp' ? 'be' : 'bp'); // 目标头顶砸落雪球
      await battleSleep(520); // 等雪球砸中目标再结算伤害
    } else if (isElectric) {
      // 物理电系（伏特攻击/疯狂伏特/雷电拳等）：贴身冲撞撞进对手，同时头顶闪电劈下
      if (isPhys) lungeAttack(side);
      const tSide = side === 'bp' ? 'be' : 'bp';
      spawnLightningStrike(tSide, lightningVariant(mv)); // 闪电劈中对手头部
      await battleSleep(isPhys ? 430 : 400); // 等冲撞贴脸/闪电劈到再结算伤害
      shake(tSide);
      await playEvents(evs, battle, foe, mv.type, null, null, { skipStepAnim: true, skipFx: true });
      syncFieldFx(battle);
      return;
    } else if (isDrain) {
      // 吸血招式：先攻击命中，命中后粒子从目标身上吸回攻击方
      if (isPhys) lungeAttack(side);
      else lunge(side);
      await battleSleep(isPhys ? 280 : 160);
      spawnDrainParticles(side === 'bp' ? 'be' : 'bp', side);
      await battleSleep(520); // 等粒子吸回再结算伤害（粒子约 0.45-0.65s）
    } else {
      // 远程单体物理（冰砾/种子炸弹）：留原位射一发弹道，粒子飞抵对手即算命中
      if (rangedSingle) {
        raiseAttacker(side);
        await spawnProjOne(side, rangedSingle.shape, rangedSingle.color, rangedSingle.size);
        // impact 与弹道同帧落在对手身上；若等到结算事件再补，粒子淡出后会有明显空档
        const tSide = side === 'bp' ? 'be' : 'bp';
        spawnImpactAsset(tSide);
        if (rangedSingle.leafBurst) spawnLeafBurstFx(tSide); // 种子炸弹：命中处炸开一簇树叶
        lowerAttacker(side);
      } else {
        if (isPhys) lungeAttack(side);
        else lunge(side);
        // 伤害/状态在攻击"贴脸/命中"瞬间爆出（物理=挥砍一击时刻，特殊=施法摆动到位），而非回退时
        await battleSleep(isPhys ? 280 : 160);
      }
    }
  }
  if (rangedPhys) raiseAttacker(side); // 远程连击：攻击方留在原位，期间置顶层
  // 近战多段：各击在 playEvents 的 step 里逐击摆动；远程多段：逐击喷射粒子，弹到即结算伤害
  if (mv.type === '火' && moveCat(mv) !== 'status') spawnFireBurst(side === 'bp' ? 'be' : 'bp');
  if (moveCat(mv) !== 'status' && IMPACT_TINT_TYPES.has(mv.type)) spawnImpactTint(side === 'bp' ? 'be' : 'bp', TYPE_COLORS[mv.type]);
  const evOpts = {};
  if (waterBubbles) evOpts.waterBubbles = true;
  if (rangedSingle) evOpts.skipImpact = true; // 单体弹道的 impact 已在飞抵目标时播放，结算时不再重复
  await playEvents(evs, battle, foe, mv.type, multiPhys ? side : null, rangedPhys || null,
    Object.keys(evOpts).length ? evOpts : null);
  hideCosmicBg();
  syncFieldFx(battle); // 出招结算后刷新护盾/钉子表现（守住生效、撒菱/毒菱/隐形岩落场）
}

// ==================== 招式调试面板（开发用） ====================
// 播放直接走真实战斗的 doAttackInner：把双方战斗个体克隆一份给调试用，
// 招式/节奏/命中反馈与正式战斗完全同一条代码，不用再在预览页维护第二份特效副本。
const FXDBG_TYPES = ['一般', '格斗', '飞行', '毒', '地面', '岩石', '虫', '幽灵', '钢', '火', '水', '草', '电', '超能', '冰', '龙', '恶', '妖精'];
let _fxdbgFiltered = [];

function fxdbgMoves() {
  if (!_data?.moves) return [];
  return Object.values(_data.moves)
    .filter((m) => m && m.id !== STRUGGLE_ID && m.effect && m.effect.kind !== 'unimplemented')
    .sort((a, b) => a.id - b.id);
}

// 调试用战斗个体：浅拷贝本体可变的几项，所有消耗/伤害都只落在副本上
function fxdbgCloneMon(mon) {
  const c = {
    ...mon,
    types: [...(mon.types || [])],
    moves: [...(mon.moves || [])],
    pp: (mon.moves || []).map((id) => (id != null && _data?.moves?.[id] ? _data.moves[id].pp ?? null : null)), // 不让真实 PP 耗尽挡住调试
    stats: [...mon.stats],
    stages: [...(mon.stages || [])],
    stageTypes: [...(mon.stageTypes || [])],
    ivs: { ...(mon.ivs || {}) },
  };
  c.chargeMove = null; // 永远从第一回合开始，蓄力招式会由调试面板自己补播第二段
  c.chargeHidden = false;
  c.entryRound = null; // 击掌奇袭等"刚出场"招式在调试里一律可用
  return c;
}

function fxdbgBattleOf(battle) {
  return {
    ...battle,
    pIdx: 0,
    eIdx: 0,
    __fxdbg: true, // 放行 doAttackInner/playChargeAttack 里的「战斗是否还在」身份判断
    // 场地/天气是值拷贝，但 hazards 是对象：必须另开一层，否则调试招式（撒菱等）会改到真实战斗
    hazards: {
      p: { ...(battle.hazards?.p || {}) },
      e: { ...(battle.hazards?.e || {}) },
    },
    pTeam: [{ ...battle.pTeam[battle.pIdx], mon: fxdbgCloneMon(curMon(battle, 'p')) }],
    eTeam: [{ ...battle.eTeam[battle.eIdx], mon: fxdbgCloneMon(curMon(battle, 'e')) }],
  };
}

function fxdbgSide() {
  return $('fxdbgOpp')?.checked ? 'be' : 'bp';
}

function renderFxdbgList() {
  const list = $('fxdbgList');
  if (!list) return;
  const q = ($('fxdbgSearch')?.value || '').trim().toLowerCase();
  const type = $('fxdbgType')?.value || '';
  const cat = $('fxdbgCat')?.value || '';
  const all = fxdbgMoves();
  _fxdbgFiltered = all.filter((m) => (!q || m.name.toLowerCase().includes(q) || String(m.id).includes(q))
    && (!type || m.type === type)
    && (!cat || m.category === cat));
  const count = $('fxdbgCount');
  if (count) count.textContent = `${_fxdbgFiltered.length} / ${all.length}`;
  const shown = _fxdbgFiltered.slice(0, 200); // 手机上一次铺 200 行够用，再多用搜索缩小
  list.innerHTML = shown.length ? shown.map((m) => `<button type="button" class="b-fxdbg-row" data-id="${m.id}">
      <span class="b-fxdbg-id">${String(m.id).padStart(3, '0')}</span>
      <span class="b-fxdbg-name">${m.name}${CHARGE_MOVES.has(m.name) ? '<i class="b-fxdbg-tag">两回合</i>' : ''}</span>
      <span class="b-fxdbg-type" style="background:${TYPE_COLORS[m.type] || '#9F9E9A'}">${m.type}</span>
      <span class="b-fxdbg-cat">${m.category || ''}</span>
    </button>`).join('') : '<div class="b-fxdbg-empty">没有匹配的招式</div>';
}

function openFxDebugPanel(battle) {
  if (_fxdbgPlaying || _activeBattle !== battle) return;
  if (!_pendingAsk || _auto) return; // 只在轮到玩家选行动时开，否则战斗会从面板底下继续走
  const fight = $('battleContent')?.querySelector('.battle-fight');
  if (!fight) return;
  const old = $('b-fxdbg');
  if (old) { old.style.display = 'flex'; return; }
  const panel = document.createElement('div');
  panel.id = 'b-fxdbg';
  panel.className = 'b-fxdbg';
  panel.innerHTML = `
    <div class="b-fxdbg-head">
      <b class="b-fxdbg-title">招式调试</b>
      <span class="b-fxdbg-count" id="fxdbgCount"></span>
      <button class="b-fxdbg-x" id="fxdbgClose" type="button">关闭</button>
    </div>
    <div class="b-fxdbg-bar">
      <input class="b-fxdbg-search" id="fxdbgSearch" type="search" placeholder="搜索招式名 / 编号">
      <select class="b-fxdbg-sel" id="fxdbgType"><option value="">属性</option>${FXDBG_TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
      <select class="b-fxdbg-sel" id="fxdbgCat">
        <option value="">类别</option><option>物理</option><option>特殊</option><option>变化</option>
      </select>
    </div>
    <div class="b-fxdbg-bar">
      <label class="b-fxdbg-check"><input type="checkbox" id="fxdbgOpp"> 对手出招</label>
      <label class="b-fxdbg-check"><input type="checkbox" id="fxdbgHit" checked> 必中</label>
      <label class="b-fxdbg-check"><input type="checkbox" id="fxdbgPe" checked> 原作动画</label>
      <label class="b-fxdbg-check">速度<select class="b-fxdbg-sel" id="fxdbgSpeed">
        <option value="0.5">0.5×</option><option value="1" selected>1×</option>
        <option value="1.5">1.5×</option><option value="2">2×</option>
      </select></label>
      <span class="b-fxdbg-now" id="fxdbgNow"></span>
    </div>
    <div class="b-fxdbg-list" id="fxdbgList"></div>
    <div class="b-fxdbg-foot">
      <button class="b-fxdbg-btn2" id="fxdbgPrev" type="button">上一个</button>
      <button class="b-fxdbg-btn2" id="fxdbgReplay" type="button">重播</button>
      <button class="b-fxdbg-btn2" id="fxdbgNext" type="button">下一个</button>
    </div>`;
  fight.appendChild(panel);
  const close = () => {
    panel.remove();
    _fxdbgRestore?.();
  };
  $('fxdbgClose')?.addEventListener('click', close);
  ['fxdbgSearch', 'fxdbgType', 'fxdbgCat'].forEach((id) => {
    $(id)?.addEventListener('input', renderFxdbgList);
    $(id)?.addEventListener('change', renderFxdbgList);
  });
  $('fxdbgList')?.addEventListener('click', (e) => {
    const row = e.target.closest('.b-fxdbg-row');
    if (row) fxdbgPlay(battle, Number(row.dataset.id), fxdbgSide());
  });
  $('fxdbgSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && _fxdbgFiltered[0]) fxdbgPlay(battle, _fxdbgFiltered[0].id, fxdbgSide());
  });
  $('fxdbgReplay')?.addEventListener('click', () => {
    if (_fxdbgLast) fxdbgPlay(battle, _fxdbgLast.id, fxdbgSide());
  });
  const step = (dir) => {
    if (!_fxdbgFiltered.length) return;
    let i = _fxdbgLast ? _fxdbgFiltered.findIndex((m) => String(m.id) === String(_fxdbgLast.id)) : -1;
    i = i < 0 ? (dir > 0 ? 0 : _fxdbgFiltered.length - 1) : (i + dir + _fxdbgFiltered.length) % _fxdbgFiltered.length;
    fxdbgPlay(battle, _fxdbgFiltered[i].id, fxdbgSide());
  };
  $('fxdbgPrev')?.addEventListener('click', () => step(-1));
  $('fxdbgNext')?.addEventListener('click', () => step(1));
  renderFxdbgList();
}

// 播放结束后把真实个体重新画回界面（调试期间所有数值变化都只发生在克隆上）
function fxdbgRestoreDom(battle) {
  const fight = $('battleContent')?.querySelector('.battle-fight');
  if (!fight) return;
  // 动画被打断时原作引擎的临时层可能残留（pe-surf 以前不清理，这里一并扫掉）
  fight.querySelectorAll('.pe-root, .pe-bg, .pe-surf, .pe-tint').forEach((el) => el.remove());
  // 一次性特效若没等到 animationend 也会残留，重播前统一清场（常驻状态粒子不动）
  fight.querySelectorAll('.b-dmg, .b-proj-fx, .b-solar-fx,'
    + ' .b-lightning-fx, .b-rock-fx, .b-snow-fx, .b-sonic-fx, .b-beam-fx, .b-aurora-fx, .b-aurora-bg-fx, .b-fairy-fx, .b-surf-fx, .b-shell-fx,'
    + ' .fx-orbit-back, .fx-orbit-front, .b-charge-asset, .b-wind-fx, .b-dragon-fx, .b-psy-fx, .b-ground-fx, .fx-spark-asset, .fx-orig,'
    + ' .b-screen-flash, .b-cosmic-bg, .b-impact-bg, .b-impact-tint, .b-fire-burst, .b-gust-stream,'
    + ' .b-memento-orb, .b-mist-stream, .b-volt-flash, .b-aqua-ring, .aqua-band, .aqua-drop')
    .forEach((el) => el.remove());
  for (const side of ['bp', 'be']) {
    const img = $(`${side}-img`);
    if (!img) continue;
    resetAnim(img);
    img.style.visibility = '';
    img.style.zIndex = '';
    img.style.removeProperty('transform');
    img.style.removeProperty('filter');
    img.style.removeProperty('opacity');
    img.dataset.charged = '';
    renderMon(curMon(battle, side === 'bp' ? 'p' : 'e'), side);
  }
  const flip = $('bp-box')?.querySelector('.b-flip');
  if (flip) flip.style.transform = '';
  panelIn('bp'); // 调试时若把克隆打到倒下，信息卡会被 panelOut 滑出，这里滑回来
  panelIn('be');
  renderTeamInfo(battle);
  syncFieldFx(battle);
}

async function fxdbgPlay(battle, id, side) {
  const mv = _data?.moves?.[id];
  if (!mv || _fxdbgPlaying || _activeBattle !== battle) return;
  const panel = $('b-fxdbg');
  const now = $('fxdbgNow');
  _fxdbgPlaying = true;
  _fxdbgLast = { id, side };
  if (now) now.textContent = `${String(mv.id).padStart(3, '0')} ${mv.name}`;
  if (panel) panel.style.display = 'none'; // 先收起面板，让整块战场都能看到
  _fxdbgSpeed = Number($('fxdbgSpeed')?.value || 1) || 1;
  setPeSpeedFactor(_fxdbgSpeed);
  setPeEnabled($('fxdbgPe')?.checked !== false);
  try {
    const dbg = fxdbgBattleOf(battle);
    const actor = curMon(dbg, side === 'bp' ? 'p' : 'e');
    const foe = curMon(dbg, side === 'bp' ? 'e' : 'p');
    // 必中：命中率等级拉满（×4 上限）、对方闪避归零，低命中招式也能稳定看到完整动作
    if ($('fxdbgHit')?.checked !== false) { actor.stages[5] = 6; foe.stages[6] = 0; }
    setText(`${actor.name}使用了${mv.name}！`);
    await doAttackInner(actor, side, id, dbg);
    if (CHARGE_MOVES.has(mv.name) && actor.chargeMove != null) {
      await doAttackInner(actor, side, id, dbg); // 两回合招式：紧接着补播攻击段
    }
  } catch (e) {
    if (!(e instanceof BattleFled)) console.warn('fxdbg', e);
  } finally {
    _fxdbgSpeed = 1;
    setPeSpeedFactor(1);
    setPeEnabled(true);
    _fxdbgPlaying = false;
    if (_activeBattle === battle) {
      fxdbgRestoreDom(battle);
      _fxdbgRestore?.(); // 恢复「攻击/替换/自动」操作界面
      const p = $('b-fxdbg');
      if (p) p.style.display = 'flex';
    }
  }
}

// 控制台入口：战斗中点 __fxdbg() 直接打开面板
export function openMoveFxDebug() {
  if (!_activeBattle) { console.warn('openMoveFxDebug: 当前没有进行中的战斗'); return false; }
  if (!_pendingAsk || _auto) { console.warn('openMoveFxDebug: 只在手动战斗、轮到玩家选行动时可用'); return false; }
  openFxDebugPanel(_activeBattle);
  return true;
}

async function battleLoop(battle) {
  _busy = true;
  try {
    while (!battle.winner && !_fleeing) {
      // 战斗页被卸载/替换（撤退、界面切走）后不再继续空跑
      if (!$('battleContent')?.querySelector('.battle-fight')) { doRetreat(battle); return; }
      // 每回合开始标记当前出战宝可梦为"参战"（含开场首只与换人上场的，供经验结算判定）
      markParticipated(battle, 'p');
      battle._acted = new Set(); // 本回合已行动的个体（畏缩判定：已行动者不再畏缩）
      // 记录回合开场双方：击掌奇袭仅在"本回合开始时在场"的宝可梦身上结算刚出场标记（换人上场的跳过）
      battle._pStartUid = curMon(battle, 'p').uid;
      battle._eStartUid = curMon(battle, 'e').uid;

      // 僵局检测：记录回合开始双方 HP，回合末对比是否互不造成伤害
      battle._turnHp = { p: curMon(battle, 'p').hp, e: curMon(battle, 'e').hp };

      // ---------- 双方选择行动：换人优先执行，出招按速度决定先后 ----------
      let pMon = curMon(battle, 'p');
      let eMon = curMon(battle, 'e');
      // 每回合开始清零：双倍奉还记录（严格同回合）+ 守住/挺住/同命标记（先制防护仅当回合生效）
      pMon.hitByPhys = false; pMon.physDmg = 0; pMon.hitBySpec = false; pMon.specDmg = 0; pMon.protected = false; pMon.protectMove = null; pMon.endure = false; pMon.destinyBond = false; pMon.whirlwinded = false; pMon.batonPass = false;
      eMon.hitByPhys = false; eMon.physDmg = 0; eMon.hitBySpec = false; eMon.specDmg = 0; eMon.protected = false; eMon.protectMove = null; eMon.endure = false; eMon.destinyBond = false; eMon.whirlwinded = false; eMon.batonPass = false;
      syncFieldFx(battle); // 回合重置：撤掉上一回合的守住护盾
      const pPre = []; // 我方回合前状态事件（睡眠/麻痹/畏缩/混乱自伤等）
      const ePre = []; // 敌方回合前状态事件
      let pAct = null; // 我方选择：{type:'move',id} / {type:'switch',idx}
      let eAct = null; // 敌方选择：{type:'move',id} / {type:'switch',idx}
      let eMove = null; // 敌方本回合出招（null = 不行动/换人）

      if (preTurn(pMon, pPre)) {
        if (pMon.chargeMove != null) {
          pAct = { type: 'move', id: pMon.chargeMove }; // 两回合招式第二回合：自动出招
        } else {
          pAct = await askPlayerMove(battle);
          if (pAct.type === 'flee') { // 撤退（标题栏返回触发）
            doRetreat(battle);
            return;
          }
        }
      }
      if (preTurn(eMon, ePre)) {
        if (eMon.chargeMove != null) eAct = { type: 'move', id: eMon.chargeMove }; // 蓄力招式第二回合自动出招
        else {
          const sw = pickEnemySwitch(battle, eMon, pMon);
          eAct = sw >= 0 ? { type: 'switch', idx: sw } : { type: 'move', id: aiFor(battle, eMon, pMon) };
        }
        if (eAct.type === 'move') eMove = eAct.id;
      }

      // 先播行动前状态事件（双方各自的状态检查结果）
      if (pPre.length) await playEvents(pPre, battle, pMon);
      if (ePre.length) await playEvents(ePre, battle, eMon);

      // 换人优先于出招（宝可梦规则：换人动作先于双方出招结算）
      if (pAct && pAct.type === 'switch') {
        panelOut('bp'); // 主动换人：当前宝可梦退场，信息卡片滑出
        await battleSleep(260); // 等卡片滑出后再渲染新宝可梦
        battle.pIdx = pAct.idx;
        pMon = curMon(battle, 'p');
        markParticipated(battle, 'p');
        resetCounter(pMon);
        setText(`${pMon.name}上场了！`);
        const ballP = renderMon(pMon, 'bp', true);
        renderTeamInfo(battle);
        panelIn('bp'); // 新宝可梦上场：信息卡片滑入屏幕
        if (ballP) await ballP; // 等精灵球登场动画播完，避免对手在动画期间行动
        const hazEvs = [];
        applyEntryHazards(battle, 'p', hazEvs);
        if (hazEvs.length) await playEvents(hazEvs, battle, curMon(battle, 'p'));
        await battleSleep(400);
        autoTransform(battle, 'p'); // 换上的若是百变怪，登场后立即变身
        pAct = null; // 本回合行动已消耗在换人上
      }

      // 敌方主动换人：和出招一样，换人优先于本回合出招
      if (eAct && eAct.type === 'switch') {
        panelOut('be');
        await battleSleep(260);
        battle.eIdx = eAct.idx;
        eMon = curMon(battle, 'e');
        resetCounter(eMon);
        setText(`${eMon.name}上场了！`);
        const ballE = renderMon(eMon, 'be', true);
        renderTeamInfo(battle);
        panelIn('be');
        if (ballE) await ballE;
        const hazEvs = [];
        applyEntryHazards(battle, 'e', hazEvs);
        if (hazEvs.length) await playEvents(hazEvs, battle, curMon(battle, 'e'));
        await battleSleep(400);
        autoTransform(battle, 'e');
        eAct = null;
        eMove = null;
      }

      // 出招：双方都出招时按先制度、再按速度决定先后（速度平手随机）；
      // 反击招先制度 -5 强制后手，否则本回合还没吃到伤害就出手必然失败
      const pMove = pAct && pAct.type === 'move' ? pAct.id : null;
      let pFirst;
      if (pMove != null && eMove != null) {
        const pPri = movePriority(_data.moves[pMove]);
        const ePri = movePriority(_data.moves[eMove]);
        if (pPri !== ePri) {
          pFirst = pPri > ePri; // 先制度更高者先动（counter 优先级低 → 后手）
        } else {
          const ps = pMon.effStat(0);
          const es = eMon.effStat(0);
          pFirst = ps > es || (ps === es && Math.random() < 0.5);
        }
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

      // 出招后强制换人：吹飞/吼叫将目标吹下（敌方对我方=我方换人，反之亦然）、
      // 接棒主动下场并传递能力；换人动作发生在回合末结算之前，新上场者本回合不再行动
      if (curMon(battle, 'p').whirlwinded) {
        curMon(battle, 'p').whirlwinded = false;
        await doForcedSwitch(battle, 'p', false);
      }
      if (curMon(battle, 'e').whirlwinded) {
        curMon(battle, 'e').whirlwinded = false;
        await doForcedSwitch(battle, 'e', false);
      }
      if (curMon(battle, 'p').batonPass) {
        curMon(battle, 'p').batonPass = false;
        await doForcedSwitch(battle, 'p', true);
      }
      if (curMon(battle, 'e').batonPass) {
        curMon(battle, 'e').batonPass = false;
        await doForcedSwitch(battle, 'e', true);
      }

      // 回合末持续伤害：作用于本回合结束时在场（含昏厥）的宝可梦；
      // 昏厥者 hp=0 由 postTurn 自动跳过，未倒下的正常结算中毒/灼伤/天气/场地/水流环等
      const pEvs = [];
      const eEvs = [];
      postTurn(curMon(battle, 'p'), pEvs, battle);
      postTurn(curMon(battle, 'e'), eEvs, battle);
      await playEvents(pEvs, battle, curMon(battle, 'p'));
      await playEvents(eEvs, battle, curMon(battle, 'e'));
      // 天气/场地/光墙剩余回合倒计时
      const turnEvs = [];
      tickBattleTurns(battle, turnEvs);
      // 同命结算：本回合内使用方倒下，对手一并倒下（追加到同一事件流）
      const bpMon = curMon(battle, 'p');
      const beMon = curMon(battle, 'e');
      if (bpMon.destinyBond && bpMon.hp <= 0 && beMon.hp > 0) {
        beMon.hp = 0;
        turnEvs.push({ t: 'faint', who: beMon.name, uid: beMon.uid, text: `${beMon.name}被同命带走了！` });
      }
      if (beMon.destinyBond && beMon.hp <= 0 && bpMon.hp > 0) {
        bpMon.hp = 0;
        turnEvs.push({ t: 'faint', who: bpMon.name, uid: bpMon.uid, text: `${bpMon.name}被同命带走了！` });
      }
      if (turnEvs.length) await playEvents(turnEvs, battle, curMon(battle, 'p'));

      // 回合结束强制替换：昏厥宝可梦留在场上直到本回合全部结算完毕（含回合末伤害），
      // 之后才替换；新上场者本回合无行动指令，下一回合起才能自由操作
      if (curMon(battle, 'p').hp <= 0) {
        if (!hasAlive(battle, 'p')) { battle.winner = 'e'; break; }
        const idx = await promptSwitchAfterFaint(battle);
        if (_fleeing) break;
        if (idx < 0) continue; // 取消：回到换人检查，重新弹出选择
        battle.pIdx = idx;
        markParticipated(battle, 'p');
        resetCounter(curMon(battle, 'p'));
        setText(`${curMon(battle, 'p').name}上场了！`);
        const ballP = renderMon(curMon(battle, 'p'), 'bp', true);
        if (!ballP) { doRetreat(battle); return; } // 战斗页已卸载：不再继续异步出场
        renderTeamInfo(battle);
        panelIn('bp'); // 新宝可梦上场：信息卡片滑入屏幕
        if (ballP) await ballP; // 等精灵球登场动画播完，避免对手在动画期间行动
        const hazEvs = [];
        applyEntryHazards(battle, 'p', hazEvs);
        if (hazEvs.length) await playEvents(hazEvs, battle, curMon(battle, 'p'));
        await battleSleep(400);
        autoTransform(battle, 'p'); // 换上的若是百变怪，登场后立即变身
      }
      if (curMon(battle, 'e').hp <= 0) {
        if (!nextMon(battle, 'e')) { battle.winner = 'p'; break; }
        resetCounter(curMon(battle, 'e'));
        setText(`${curMon(battle, 'e').name}上场了！`);
        const ballE = renderMon(curMon(battle, 'e'), 'be', true);
        if (!ballE) { doRetreat(battle); return; } // 战斗页已卸载：不再继续异步出场
        renderTeamInfo(battle);
        panelIn('be'); // 新宝可梦上场：信息卡片滑入屏幕
        if (ballE) await ballE; // 等精灵球登场动画播完，避免对手在动画期间行动
        const hazEvs = [];
        applyEntryHazards(battle, 'e', hazEvs);
        if (hazEvs.length) await playEvents(hazEvs, battle, curMon(battle, 'e'));
        await battleSleep(400);
        autoTransform(battle, 'e'); // 换上的若是百变怪，登场后立即变身
      }
      if (battle.winner) break;

      // 僵局脱出：连续多回合双方 HP 均无变化视为死循环（如双方只会用强化/变化招式），
      // 自动战斗时主动换人打破僵局，无宝可梦可换则直接结算失败
      const pNow = curMon(battle, 'p').hp;
      const eNow = curMon(battle, 'e').hp;
      battle.stall = (pNow === battle._turnHp.p && eNow === battle._turnHp.e) ? battle.stall + 1 : 0;
      if (battle.stall >= STALL_LIMIT && _auto) {
        battle.stall = 0;
        const nextIdx = nextAliveIdx(battle, 'p');
        if (nextIdx < 0) {
          setText('双方僵持不下，无宝可梦可换，自动认输……');
          battle.winner = 'e';
          break;
        }
        setText('双方僵持不下，自动切换宝可梦！');
        panelOut('bp');
        await battleSleep(260);
        battle.pIdx = nextIdx;
        const mon = curMon(battle, 'p');
        markParticipated(battle, 'p');
        resetCounter(mon);
        setText(`${mon.name}上场了！`);
        const ballP = renderMon(mon, 'bp', true);
        renderTeamInfo(battle);
        panelIn('bp');
        if (ballP) await ballP;
        const hazEvs = [];
        applyEntryHazards(battle, 'p', hazEvs);
        if (hazEvs.length) await playEvents(hazEvs, battle, curMon(battle, 'p'));
        await battleSleep(400);
      }

      // 击掌奇袭结算：本回合未换人的在场者，其"出场第一回合"至此结束，下回合起失效
      if (curMon(battle, 'p').uid === battle._pStartUid) curMon(battle, 'p').entryRound = battle.round;
      if (curMon(battle, 'e').uid === battle._eStartUid) curMon(battle, 'e').entryRound = battle.round;
      // 畏缩为本回合瞬时标记：回合末清零，不带到下一回合
      curMon(battle, 'p').flinch = false;
      curMon(battle, 'e').flinch = false;
      battle.round++;
      const roundEl = $('b-round'); if (roundEl) roundEl.textContent = battle.round;
    }
    if (_fleeing) { doRetreat(battle); return; }
    finishBattle(battle);
  } catch (e) {
    // 异常也按撤退收尾，避免 Promise 未处理把整场战斗卡在动画里
    if (!(e instanceof BattleFled)) console.warn('battle loop', e);
    doRetreat(battle);
  } finally {
    _busy = false;
    _fleeing = false;
    _auto = false; // 战斗结束（含撤退/异常）自动战斗一并复位
    hideLogMenu(); // 战斗结束时若右键菜单还开着，一并收起
    closeLogPage(); // 记录页开着则关闭并还原标题栏（战斗已结束，无返回战斗一说）
    if (_activeBattle === battle) {
      _activeBattle = null;
      setNpcBattleActive(false);
    }
    // 单屏才需要把战斗占用的 phase / 遇敌调度还给主界面；双屏上屏从未被战斗暂停
    if (!isDualLayout()) {
      import('./battle.js').then(m => m.resumePhaseAfterBattle()); // 遭遇还在就回遭遇态，否则回挂机
      road.resume(); // 若进战斗前道路被其他流程暂停（如挂机遇敌）未恢复，回到主界面需恢复滚动
      // 战斗结束：恢复 buff 倒计时与遇敌调度。
      // 遭遇还压在屏上时 resumeEncounterFlow 内部会拒绝恢复，交给遭遇收尾
      import('./battle.js').then(m => m.resumeEncounterFlow());
      import('./battle.js').then(m => m.fireWaitingEncounter());
    }
  }
}

// ---------- 结算 ----------
// 档位追加道具抽取：写 key 是固定道具，写 pool 是从池子里随机一件（结算页与调试共用这一份）
export function rollTierDrops(tier) {
  const drops = [];
  for (const r of BATTLE_TIER_ITEMS[tier] || []) {
    if (r.chance != null && Math.random() >= r.chance) continue;
    let key = r.key;
    if (r.pool === 'evoAll') {
      key = pickEvoDrop() || r.key; // 全池走稀有度权重（王冠被压低）
    } else if (r.pool) {
      const pool = r.pool === 'mint' ? MINT_KEYS : BATTLE_EVO_POOLS[r.pool] || null;
      if (pool && pool.length) key = pool[randInt(0, pool.length - 1)];
    }
    if (key) drops.push({ key, qty: r.qty });
  }
  return drops;
}

function finishBattle(battle) {
  // 自定义对战：不结算经验/糖果/NPC 列表，只把结果交回调用方
  if (battle.custom?.onEnd) {
    _activeBattle = null;
    setNpcBattleActive(false);
    _settled = true;
    endBattle();
    if (battle._ended) return;
    battle._ended = true;
    battle.custom.onEnd({ win: battle.winner === 'p', pTeam: battle.pTeam, eTeam: battle.eTeam, rounds: battle.round });
    return;
  }
  _retryAuto = _auto; // 记住战斗结束时的自动状态：「再战一次」沿袭（战斗中切回手动的则手动重试）
  const win = battle.winner === 'p';
  _activeBattle = null; // 战斗已结束：清空活动战斗（后续返回走普通视图切换，不再误判为撤退）
  setNpcBattleActive(false);
  _settled = true; // 结算页显示中：标题栏返回应回 NPC 战斗列表
  const gd = gameData;
  // 随从增益：battleexp 类提升对战胜利经验。拆出基础值与加成部分，供结算页黄色标注
  const expMult = (window.__followerBoostMechanic?.('battleExp', 1) ?? 1);
  const expBaseLv = battle.eTeam.reduce((s, x) => s + x.mon.level, 0) * 8;
  const avgLv = battle.eTeam.reduce((s, x) => s + x.mon.level, 0) / battle.eTeam.length;
  const results = [];
  let dropCandy = false; // 经验糖果掉落（仅胜利按档位概率判定）
  const tierDrops = []; // 本场拿到的档位道具，结算页展示用
  if (win) {
    // 经验：参战（上过场）且存活才分；等级差倍率——低级打高级最多 3 倍，高级打低级骤减
    for (const { entry, mon } of battle.pTeam) {
      if (!mon.participated || mon.hp <= 0) continue;
      const mult = Math.max(0.2, Math.min(3, avgLv / Math.max(1, mon.level)));
      // 拆基础经验（无随从加成）与加成部分，供结算页黄色标注
      const baseGain = Math.round(expBaseLv * mult);
      const totalGain = Math.round(expBaseLv * expMult * mult);
      const bonusGain = totalGain - baseGain;
      entry.exp = (entry.exp || 0) + totalGain;
      let up = 0;
      while (entry.level < MAX_LEVEL && entry.exp >= expNeed(entry.level)) {
        entry.exp -= expNeed(entry.level);
        entry.level++;
        up++;
      }
      if (entry.level >= MAX_LEVEL) entry.exp = 0; // 满级后不再积累经验
      results.push({ name: mon.name, lv: entry.level, up, baseGain, bonusGain });
    }
    gd.items.candy = (gd.items.candy || 0) + battle.preset.candy;
    // 经验糖果掉落：按 NPC 档位概率判定，胜利才有、失败没有
    // 随从（格斗/恶）主效果：胜利必定掉经验糖果
    const expChance = window.__followerBoostMechanic?.('expCandyGuarantee', battle.preset.expChance || 0) ?? (battle.preset.expChance || 0);
    dropCandy = Math.random() < expChance;
    // 档位追加道具：练度够才打得到高档，这是"力量换得到东西"的出口
    for (const d of rollTierDrops(battle.preset.tier)) {
      grantItem(d.key, d.qty); // grantItem 自带日志与背包刷新
      tierDrops.push(d);
    }
    if (dropCandy) {
      gd.items['exp-candy'] = (gd.items['exp-candy'] || 0) + 1;
      updateBackpack('exp-candy'); // 掉落瞬间立即刷新背包栏数量，不等 5 秒 tick
    }
    // NPC 对战成就统计：累计胜场 / 精英与冠军胜场 / 对战糖果
    gd.stats.totalNpcWins = (gd.stats.totalNpcWins || 0) + 1;
    gd.stats.totalNpcCandy = (gd.stats.totalNpcCandy || 0) + battle.preset.candy;
    if (battle.preset.tier === 'novice') gd.stats.totalNpcNoviceWins = (gd.stats.totalNpcNoviceWins || 0) + 1;
    else if (battle.preset.tier === 'veteran') gd.stats.totalNpcEliteWins = (gd.stats.totalNpcEliteWins || 0) + 1;
    else if (battle.preset.tier === 'leader') gd.stats.totalNpcLeaderWins = (gd.stats.totalNpcLeaderWins || 0) + 1;
    else if (battle.preset.tier === 'champion') gd.stats.totalNpcChampionWins = (gd.stats.totalNpcChampionWins || 0) + 1;
    if (gd.battleNpcs?.list) {
      // 战胜领奖后从当前一波中移除该 NPC
      gd.battleNpcs.list = gd.battleNpcs.list.filter((n) => n.id !== battle.preset.id);
    }
  }
  saveGame();
  addSystemLog('战斗', `${win ? '战胜' : '输给'}了「${battle.preset.name}」${win ? `，获得 ${battle.preset.candy} 糖果${dropCandy ? '，经验糖果 ×1' : ''}${tierDrops.map(d => `，${ITEM_NAMES[d.key] || d.key} ×${d.qty}`).join('')}` : ''}`);
  endBattle(); // 战斗结束 → 停止战斗曲，恢复地区曲
  if (win) playVictory(); // 胜利音效（播完自动恢复地区曲）
  if (win) window.dispatchEvent(new Event('achievements-changed')); // 胜利可能解锁对战成就，即时刷新手机红点

  const box = $('battleContent');
  box.innerHTML = `
    <div class="battle-app battle-result t-${battle.preset.tier}">
      <div class="battle-result-title">${win ? '挑战成功！' : '挑战失败…'}</div>
      <div class="battle-result-detail">
        ${win ? results.map((r) => `<div>${r.name} 升级到 Lv${r.lv}${r.up ? `（+${r.up}级）` : ''}${r.bonusGain > 0 ? ` <span class="exp-bonus">+${r.bonusGain}经验</span>` : ''}</div>`).join('') : '<div>失败无经验，调整队伍或招式再来试试吧！</div>'}
        ${win ? `<div class="candy-gain"><span class="gain-label">获得</span><div class="gain-list">`
          + `<span class="gain-chip" data-tip="${ITEM_NAMES.candy || '糖果'}"><img class="candy-icon" src="./items/goods/candy.png" alt="">×${battle.preset.candy}</span>`
          + (dropCandy ? `<span class="gain-chip" data-tip="${ITEM_NAMES['xp-candy'] || '经验糖果'}"><img class="candy-icon" src="./items/goods/xp-candy.png" alt="">×1</span>` : '')
          // 奖励图标悬停用项目自带的 tooltip（同树果）：带上物品名
          + tierDrops.map((d) => `<span class="gain-chip" data-tip="${ITEM_NAMES[d.key] || d.key}"><img class="candy-icon" src="${itemIconSrc(d.key)}" alt="">×${d.qty}</span>`).join('')
          + `</div></div>` : ''}
      </div>
      ${win
        ? `<div class="battle-result-btns"><button class="battle-btn" id="b-review">回顾</button><button class="battle-btn main" id="b-confirm">确定</button></div>`
        : `<div class="battle-result-btns">
            <button class="battle-btn" id="b-retry">重试</button>
            <button class="battle-btn" id="b-review">回顾</button>
            <button class="battle-btn main" id="b-back">返回</button>
          </div>`}
    </div>`;
  $('b-retry')?.addEventListener('click', () => startNpcBattle(battle.preset.id, _retryAuto));
  $('b-back')?.addEventListener('click', () => showBattleView());
  $('b-confirm')?.addEventListener('click', () => showBattleView());
  // 回顾：打开本局对战记录，返回仍回到结算页
  $('b-review')?.addEventListener('click', () => showBattleLogs());
}
