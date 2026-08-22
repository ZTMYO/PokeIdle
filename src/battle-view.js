// 流程：NPC 列表 → 自动编队（仓库中等级最高 6 只）→ 回合制战斗（动画）→ 结算（经验/糖果）
// 与挂机主循环解耦：战斗只在手机 App 内进行，不影响地图/遇敌/离线
import { $, showView, tryLoadPokemonImage, tryLoadPokemonIcon, updateStats, updateBackpack, logicViewport } from './ui.js';
import { gameData, getPokemonByIndex, addSystemLog, saveGame, pushNav, setPhase, currentEncounter, phase, ensureGender, rollGender, genderBadge, isPokemon } from './state.js';
import { createMon, useMove, preTurn, postTurn, aiMove, tickBattleTurns, transformMon } from './battle-core.js';
import { typeMult } from './type-chart.js';
import { chooseMoves } from './moves.js';
import { ensureNpcs, refreshNpcs, buildNpcTeam } from './npcs.js';
import { BATTLE_REFRESH_MS, MAX_LEVEL, SPECIAL_SPRITE_SCALE } from './config.js';
import { playBattle, endBattle, playVictory, stopVictory, playShiny } from './audio.js';
import { burstShinySparkle } from './animation.js';
import * as road from './road.js';

// 18 属性标签色（与图鉴/遇敌一致）
export const TYPE_COLORS = {
  '一般': '#9F9E9A', '格斗': '#A7443E', '飞行': '#72A3D2', '毒': '#793B9B',
  '地面': '#894F4E', '岩石': '#BA9459', '虫': '#89991A', '幽灵': '#633963',
  '钢': '#548EA2', '火': '#CB494D', '水': '#3786CE', '草': '#378E24',
  '电': '#DBB538', '超能': '#DA5A89', '冰': '#37BEE0', '龙': '#4654C6',
  '恶': '#553F42', '妖精': '#C74ECB',
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
let _settled = false;     // 结算页显示中（goBack 判断返回应回 NPC 战斗列表）
let _pendingAsk = null;   // 挂起的玩家选择 resolve（撤退时强制结束）
let _fleeing = false;     // 已请求撤退
let _auto = false;        // 自动战斗模式：点操作栏「自动」按钮启动，点遮罩恢复手动
let _retryAuto = false;   // 记住上一把战斗结束时的自动状态（「再战一次」沿用）
let _battleLogs = [];     // 本次对战的完整文本日志（右键文案区可查看）
let _logCtx = null;       // 本局日志上下文（双方宝可梦名 + NPC 名），结算后「回顾」仍可正确渲染敌我
let _logMenu = null;      // 右键菜单元素

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
  if (ef.kind === 'damage' || ef.kind === 'explode' || ef.kind === 'multihit' || ef.kind === 'drain' || ef.kind === 'recoil' || ef.kind === 'fixed' || ef.kind === 'counter' || ef.kind === 'mirrorCoat') {
    if (ef.kind === 'mirrorCoat') return 'spec'; // 镜面反射：返还特殊伤害，属特殊攻击
    return ef.cat === 'spec' ? 'spec' : 'phys';
  }
  return 'status';
}
// 招式先制度：双倍奉还/镜面反射等反击招先制度 -5（永远最后出手），守住/挺住先制 +4，
// 击掌奇袭/迎头一击优先度 +3（仅出场第一回合使用，且必定先手）
function movePriority(mv) {
  const k = (mv.effect || {}).kind;
  if (k === 'counter' || k === 'mirrorCoat') return -5;
  if (k === 'protect' || k === 'endure') return 4;
  if (mv.name === '击掌奇袭' || mv.name === '迎头一击') return 3;
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
  mon.entryRound = null;                           // 击掌奇袭：换人/上场后视为刚出场
}

// 战斗是否进行中（标题栏返回判断）
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
            <span class="battle-refresh-cost"><img class="candy-icon" src="./items/candy.png" alt="">×50</span>
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
  }) ?? null;
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
      : chooseMoves(_learnset[entry.species] || {}, entry.level, _data, { types: pd ? pd.types : [], includeTm: true });
    return (() => {
      const mon = createMon(pd, entry.level || 1, entry.ivs, entry.nature, moveIds);
      mon.shiny = !!entry.shiny; // 战斗大图按闪光贴图（_shiny 后缀）加载
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
    fillPp(mon); // 按招式基础 PP 初始化当前 PP
    return { pd: x.pd, mon };
  });
  const battle = { preset: npc, pTeam, eTeam, pIdx: 0, eIdx: 0, winner: null, round: 1,
    weather: null, weatherTurns: 0, field: null, fieldTurns: 0, // 天气/场地（useMove 的 ctx）
    hazards: { p: { spikes: 0, toxic: 0, rock: false }, e: { spikes: 0, toxic: 0, rock: false } }, // 撒菱/毒菱/隐形岩
    stall: 0, // 僵局连续回合计数（双方 HP 均无变化），见 battleLoop
  };
  // 后台结果补播只是视觉回放；开始 NPC 对战前若仍在补播，直接取消，
  // 避免把已结算的遭遇再次交给后台继续捕捉/逃跑。
  const canceledReplay = await import('./battle.js').then(m => m.cancelBgResultReplay());
  // 进战斗前存在进行中的野生遭遇：转后台异步结算（自动捕捉继续丢球 / 或记录逃跑），
  // 避免 setPhase('battle') 中断遭遇流程导致遇敌直接丢失。
  // 记录打断前的遭遇 phase（setPhase('battle') 后已不可再取）：'encounter' 未出结果，
  // 后台继续捕捉或逃跑；'caught'/'fled' 判定已落库，只交给原流程收尾清理，防止重复捕捉/记录
  const pendingEncounter = (phase === 'encounter' || phase === 'caught' || phase === 'fled') && !!currentEncounter;
  // 补播被本场战斗取消也算"有被打断的遭遇"：遭遇已结算但遇敌调度也被清空，
  // 战斗结束后同样要恢复调度，否则会永远不再遇敌
  battle._hadPendingEncounter = pendingEncounter || canceledReplay;
  battle._pendingEncounterPhase = pendingEncounter ? phase : null;
  _activeBattle = battle;
  _fleeing = false;
  _auto = startAuto; // 新战斗默认手动模式；「再战一次」沿袭上一把结束时的自动状态
  _battleLogs = []; // 新战斗清空上一把的对战记录
  _logCtx = { p: pTeam.map((x) => x.mon.name), e: eTeam.map((x) => x.mon.name), npc: npc.name };
  setPhase('battle'); // 战斗中：主界面道路暂停切段/骑行切换，避免挂机 BGM 覆盖战斗曲
  if (battle._hadPendingEncounter) {
    import('./battle.js').then(m => m.handoffEncounterToBackground(battle._pendingEncounterPhase));
  }
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
export function clearBattleTier() {
  const sc = $('screen');
  if (!sc.classList.contains('t-novice') && !sc.classList.contains('t-veteran') && !sc.classList.contains('t-champion')) return;
  sc.classList.add('no-theme-trans'); // 切页时的主题色变化禁用过渡，直接跳变
  sc.classList.remove('t-novice', 't-veteran', 't-champion');
  void sc.offsetWidth; // 强制重排，让"无过渡"立即生效
  sc.classList.remove('no-theme-trans');
}

// 战斗页重新显示（从设置返回等）时恢复当前战斗的难度边框色：同样跳变，
// 返回战斗页属于切换页面，不做渐变过渡
export function restoreBattleTier() {
  const sc = $('screen');
  sc.classList.remove('t-novice', 't-veteran', 't-champion');
  if (_activeBattle?.preset?.tier) {
    sc.classList.add('no-theme-trans');
    sc.classList.add('t-' + _activeBattle.preset.tier);
    void sc.offsetWidth; // 强制重排，让"无过渡"立即生效
    sc.classList.remove('no-theme-trans');
  }
}

async function renderBattlePage(battle) {
  const box = $('battleContent');
  // 战斗期间屏幕边框按 NPC 难度着色（返回对战列表时清除）：
  // 进入战斗算场景切换，边框色直接跳变，不做渐变过渡
  const sc = $('screen');
  sc.classList.add('no-theme-trans');
  sc.classList.remove('t-novice', 't-veteran', 't-champion');
  if (battle.preset.tier) sc.classList.add('t-' + battle.preset.tier);
  void sc.offsetWidth; // 强制重排，让"无过渡"立即生效
  sc.classList.remove('no-theme-trans');
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
        <div class="b-auto-mask" id="b-auto-mask"><span class="b-auto-label">自动战斗中…</span></div>
      </div>
    </div>`;
  $('b-npc-name').textContent = battle.preset.name;
  // 自动战斗遮罩：点击恢复手动操作（同时清除遮罩与隐藏态右栏）
  $('b-auto-mask').addEventListener('click', () => {
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
  box.querySelector('.b-left')?.addEventListener('contextmenu', onLogCtx);
  box.querySelector('.b-auto-mask')?.addEventListener('contextmenu', onLogCtx);
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
  const ball = (n) => '<svg class="b-ball"><use xlink:href="#icon-owned"></use></svg>'.repeat(Math.max(0, n));
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
  // 变身后的百变怪：以复制对象的外观渲染（图片/属性随 _transformOf 切换）
  const pd = getPokemonByIndex(mon._transformOf || mon.idx);
  const img = $(`${side}-img`);
  // 清除上一只残留的战斗动画类（faint 带 forwards 会停在不可见状态；其余互斥类按 CSS 后定义覆盖）
  img.classList.remove(...B_ANIM_CLS);
  // 时空扭曲外观变体：按个体 variant 应用 CSS 特效（RGB 分离 / 污染紫），与详情页一致
  img.classList.remove('fx-variant-rgb', 'fx-variant-polluted');
  if (mon.variant === 'rgb') img.classList.add('fx-variant-rgb');
  else if (mon.variant === 'polluted') img.classList.add('fx-variant-polluted');
  lowerAttacker(side); // 换宠/刷新时恢复默认层级（动画被中断时 animationend 不会触发）
  // 登场球动画期间隐藏精灵；两回合招式蓄力（钻地/升空/入水）期间同样保持隐藏
  img.style.visibility = (enter || mon.chargeHidden) ? 'hidden' : '';
  img.dataset.charged = mon.chargeHidden ? '1' : ''; // 蓄力离场标记与逻辑状态同步（换人/刷新时清除残留）
  // 战斗大图优先，失败回退小图标；闪光个体使用 _shiny 贴图（路径含中文，走 tryLoad 的编码/兜底加载）
  const loaded = tryLoadPokemonImage(img, pd, mon.shiny ? '_shiny' : '').then(ok => {
    if (!ok) return tryLoadPokemonIcon(img, pd);
  }).then(() => {
    applySpriteSize(img, side, pd); // 按真实身高缩放（仅战斗页生效）
    syncStatusFx(side, mon, true); // 图片尺寸确定后校正异常状态粒子挂点位置
    syncSeedFx(side, mon, true); // 同上：校正寄生种子幼芽挂点位置
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
  // 上阵/换人：等图片加载完成（此时尺寸才是最终尺寸）再放球，落点为精灵图片底部居中
  const entryP = enter ? loaded.then(() => ballEntry(side, img)) : loaded;
  // 闪光个体登场：球落地精灵淡入后单次闪光粒子 + 登场音效（开战首只与中途换人都触发，敌我双方通用）
  if (enter && mon.shiny) {
    entryP.then(() => {
      burstShinySparkle($('battleContent'), img);
      playShiny();
    });
  }
  return entryP;
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
        ? `<span class="b-move-type" style="background:${TYPE_COLORS[mv.type] || '#888'};transform:scale(0.8)"><svg class="b-move-type-icon"><use xlink:href="#icon-type-${mv.type}"></use></svg></span>`
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
  const { x: lx, y: ly, w: vw, h: vh } = logicViewport(x, y); // zoom 下还原逻辑坐标
  menu.style.left = Math.max(0, Math.min(lx - 24, vw - mw - 4)) + 'px';
  menu.style.top = Math.max(0, Math.min(ly, vh - mh - 4)) + 'px';
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.onclick = (e) => {
    if (!e.target.closest('.shop-ctx-item')) return;
    hideLogMenu();
    showBattleLogs();
  };
  document.addEventListener('pointerdown', hideLogMenu);
}
function hideLogMenu() {
  const menu = _logMenu;
  if (menu) menu.style.display = 'none';
  document.removeEventListener('pointerdown', hideLogMenu);
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
const B_ANIM_CLS = ['lunge', 'lunge-attack', 'hit', 'faint', 'lunge-stay', 'b-strike', 'flinch', 'b-enter',
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
// 远程多段物理招式（种子机关枪/冰锥/岩石暴击/飞弹针/骨棒乱打/鳞射/尖刺加农炮）：
// 攻击方不贴脸，站原地朝对手逐发喷射实心粒子，粒子形状按招区分、颜色取属性色
const RANGED_PHYS_MULTI = {
  '种子机关枪': { shape: 'pill',    color: TYPE_COLORS['草'] },
  '冰锥':       { shape: 'crystal', color: TYPE_COLORS['冰'] },
  '岩石暴击':   { shape: 'jag',     color: TYPE_COLORS['岩石'] },
  '飞弹针':     { shape: 'needle',  color: TYPE_COLORS['虫'] },
  '骨棒乱打':   { shape: 'bone',    color: TYPE_COLORS['地面'] },
  '鳞射':       { shape: 'scale',   color: TYPE_COLORS['龙'] },
  '尖刺加农炮': { shape: 'pill',    color: TYPE_COLORS['一般'] },
};
// 远程单体物理（冰砾/毒针/毒千针/垃圾射击）：不贴脸，发射一发粒子/团块直射对手
const RANGED_SINGLE = {
  '冰砾':     { shape: 'sphere', color: TYPE_COLORS['冰'] },
  '毒针':     { shape: 'needle', color: TYPE_COLORS['毒'] },
  '毒千针':   { shape: 'needle', color: TYPE_COLORS['毒'] },
  '垃圾射击': { shape: 'blob',   color: TYPE_COLORS['毒'] },
};

// 弹道粒子：一串粒子从攻击方位置飞向目标，逐一在目标处消失（shape: 'bubble' 气泡 / 'star' 星形 / 'pebble' 圆石 / 'flame' 火焰 / 'ball' 圆球 / 'confuse' 柔和球）。
// 我方（左下→右上）由大变小，敌方（右上→左下）由小变大；始末大小/位移/错峰由 CSS 变量传入。
// 圆球类招式仅发射单球：先在攻击方位置蓄力变大，再沿直线飞向目标（动画见 ballCharge）；
// solid 为 true 时去掉柔和光晕（实心岩石球，如击落）
function spawnProjStream(side, shape, color, solid) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
  const box = $(`${side}-box`);
  if (!from || !to || !box) return;
  const br = box.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-proj-fx proj-' + shape;
  if (color) fx.style.setProperty('--fc', color); // 圆球类招式按属性着色
  // 起点：攻击方中心略偏上（模拟喷出点）；终点：目标中心略偏上
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.38;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.38;
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  if (shape === 'ball' || shape === 'confuse') {
    const b = document.createElement('i');
    b.style.setProperty('--bx', (ex - sx).toFixed(1) + 'px');
    b.style.setProperty('--by', (ey - sy).toFixed(1) + 'px');
    b.style.setProperty('--bs', (16 + Math.random() * 4).toFixed(1) + 'px');
    if (solid) b.style.boxShadow = 'none'; // 实心球：去掉柔和光晕
    fx.appendChild(b);
    box.appendChild(fx);
    setTimeout(() => fx.remove(), 800);
    return;
  }
  const shrink = side === 'bp'; // 我方大→小；敌方小→大
  const n = 7;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i');
    b.style.setProperty('--bx', (ex - sx + (Math.random() * 12 - 6)).toFixed(1) + 'px');
    b.style.setProperty('--by', (ey - sy + (Math.random() * 10 - 5)).toFixed(1) + 'px');
    b.style.setProperty('--sf', shrink ? 1.5 : 0.45);
    b.style.setProperty('--se', shrink ? 0.45 : 1.5);
    b.style.setProperty('--bs', (10 + Math.random() * 7).toFixed(1) + 'px');
    b.style.setProperty('--bd', (i * 0.08).toFixed(2) + 's'); // 逐发错开，在目标处逐一消失
    fx.appendChild(b);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 600 + n * 90);
}
// 远程多段物理：单发实心粒子从攻击方飞向目标（供逐击喷射，shape 见 RANGED_PHYS_MULTI）。
// 返回 Promise：等粒子飞抵目标后 resolve，调用方据此再结算该段伤害，保证"弹到即扣血"
function spawnProjOne(side, shape, color) {
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
  const sy = fr.top - br.top + fr.height * 0.38;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.38;
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  const b = document.createElement('i');
  const shrink = side === 'bp'; // 我方大→小；敌方小→大
  b.style.setProperty('--bx', (ex - sx + (Math.random() * 14 - 7)).toFixed(1) + 'px');
  b.style.setProperty('--by', (ey - sy + (Math.random() * 12 - 6)).toFixed(1) + 'px');
  b.style.setProperty('--sf', shrink ? 1.5 : 0.45);
  b.style.setProperty('--se', shrink ? 0.45 : 1.5);
  b.style.setProperty('--bs', (9 + Math.random() * 5).toFixed(1) + 'px');
  fx.appendChild(b);
  box.appendChild(fx);
  // 飞行动画 0.35s：等待其飞抵目标（略留余量覆盖起始延迟），随后移除粒子
  return new Promise((resolve) => {
    setTimeout(() => { fx.remove(); resolve(); }, 380);
  });
}
// 破坏光线：一截橙色带白边光段，从攻击方中心沿目标方向飞出，穿过对手后冲出屏幕。
// 发射点为容器原点并旋转对齐方向；--td 为沿该方向的飞行总距离
function spawnLightSweep(side) {
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
  const fx = document.createElement('span');
  fx.className = 'b-light-fx';
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  fx.style.transform = `rotate(${Math.atan2(ey - sy, ex - sx)}rad)`;
  const seg = document.createElement('i');
  seg.className = 'seg';
  // 飞行距离超出目标继续延伸，冲向屏幕边缘后淡出
  seg.style.setProperty('--td', (Math.hypot(ex - sx, ey - sy) * 1.9).toFixed(0) + 'px');
  fx.appendChild(seg);
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 1000);
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
// 电系招式：一道闪电从目标头顶上方劈下命中头部（短暂闪灭）。
// 闪电挂在目标盒子、以头部为原点向上延伸，超出舞台部分被裁剪（表现为从屏幕顶劈下）
function spawnLightningStrike(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-lightning-fx';
  fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
  fx.style.top = (ir.top - br.top) + 'px'; // 头部
  const bolt = document.createElement('i');
  bolt.className = 'bolt';
  fx.appendChild(bolt);
  const flash = document.createElement('i');
  flash.className = 'flash';
  fx.appendChild(flash);
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 600);
}
// 岩崩：目标头顶上方掉下大小不一的圆形岩石，错峰砸落（从盒子顶部上方落下，超出舞台部分被裁剪，
// 表现为从屏幕上方滚落；落在目标身上后消失）
function spawnRockSlide(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-rock-fx';
  const cx = ir.left - br.left + ir.width / 2; // 目标横向中心
  for (let i = 0; i < 8; i++) {
    const r = document.createElement('i');
    const size = 6 + Math.random() * 10; // 大小不一
    const dropY = 130 + Math.random() * 70; // 各自的下落起点高度
    r.style.width = size + 'px';
    r.style.height = size + 'px';
    r.style.left = (cx + (Math.random() * 100 - 50)) + 'px'; // 头顶上方横向散布
    r.style.top = (ir.top - br.top - dropY) + 'px';
    r.style.setProperty('--by', (dropY + ir.height * 0.35).toFixed(0) + 'px'); // 落到身体上
    r.style.setProperty('--bd', (Math.random() * 0.3).toFixed(2) + 's'); // 错峰砸落
    fx.appendChild(r);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 950);
}
// 落石：目标头顶上方砸下一颗大石头（单颗、不规则石块，落地旋转后淡出）
function spawnRockDrop(tSide) {
  const box = $(`${tSide}-box`);
  const img = $(`${tSide}-img`);
  if (!box || !img) return;
  const br = box.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'b-rock-fx';
  const size = 46;
  const dropY = ir.height * 0.9 + 130; // 从目标头顶更高的地方砸下
  const r = document.createElement('i');
  r.classList.add('big');
  r.style.width = size + 'px';
  r.style.height = size + 'px';
  r.style.left = (ir.left - br.left + ir.width / 2 - size / 2) + 'px';
  r.style.top = (ir.top - br.top - dropY) + 'px';
  r.style.setProperty('--by', (dropY + ir.height * 0.08).toFixed(0) + 'px'); // 砸中头部位置，不落到身体下方
  fx.appendChild(r);
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 900);
}
// 雪崩：目标头顶上方掉下大小不一的白色雪球，错峰砸落（表现同岩崩，颜色换冰白）
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
function spawnSoundWave(side) {
  const from = $(`${side}-img`);
  const to = $(`${side === 'bp' ? 'be' : 'bp'}-img`);
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
// 全屏遮罩闪光（魔法闪耀/电光/精神强念）：半透明粉紫色遮罩覆盖整个战场，从中心扩散后迅速淡出（无方向性）
function spawnScreenFlash() {
  const stage = document.querySelector('.battle-fight');
  if (!stage) return;
  const fx = document.createElement('span');
  fx.className = 'b-fairy-fx';
  stage.appendChild(fx);
  setTimeout(() => fx.remove(), 420);
}
// 大面积水系招式（潮旋/水之波动/泼冷水/冲浪/热水）：蓝色半透明水幕整片覆盖战场，
// 沿对角线涌过（我方从左下角涌向右上角，敌方从右上角涌向左下角，由 --dx/--dy 控制位移）
function spawnWaterSweep(side) {
  const stage = document.querySelector('.battle-fight');
  if (!stage) return;
  const fx = document.createElement('span');
  fx.className = 'b-water-fx';
  const wave = document.createElement('i');
  if (side === 'bp') {
    wave.style.setProperty('--dx', '30%');  // 左下 → 右上
    wave.style.setProperty('--dy', '-30%');
  } else {
    wave.classList.add('be'); // 锚点翻到右上角，再向左下涌（与我方镜像）
    wave.style.setProperty('--dx', '-30%'); // 右上 → 左下
    wave.style.setProperty('--dy', '30%');
  }
  fx.appendChild(wave);
  stage.appendChild(fx);
  setTimeout(() => fx.remove(), 700);
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
  const fx = document.createElement('span');
  fx.className = 'b-wind-fx';
  if (color) fx.style.setProperty('--fc', color);
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height * 0.35;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height * 0.35;
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  for (let i = 0; i < 3; i++) {
    const w = document.createElement('i');
    w.style.setProperty('--bx', (ex - sx + (Math.random() * 20 - 10)).toFixed(1) + 'px');
    w.style.setProperty('--by', (ey - sy + (Math.random() * 16 - 8)).toFixed(1) + 'px');
    w.style.setProperty('--bd', (i * 0.12).toFixed(2) + 's'); // 逐团错峰
    fx.appendChild(w);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 750);
}
// 龙系特殊招式（龙息/龙之波动/流星群/时光咆哮/亚空裂斩/鳞片噪音/巨龙威能/归无之光/随机光）：
// 一团紫蓝色龙息能量粒子，起点聚拢成团，飞向目标途中逐渐散开（动画见 .b-dragon-fx）
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
// 吸血粒子：从来源精灵身上飞出一串能量粒子，收拢吸回目标。
// 即时吸血招式（吸取/终极吸取等 drain 类）与寄生种子回合末吸血通用（颜色经 color 传入）
function spawnDrainParticles(fromSide, toSide, color, count = 10) {
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
  const fx = document.createElement('span');
  fx.className = 'b-drain-fx';
  fx.style.setProperty('--fc', color);
  fx.style.left = sx + 'px';
  fx.style.top = sy + 'px';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    // 粒子先从来源身上散开，再收拢吸回目标
    const spread = Math.random() * 20;
    const ang = Math.random() * Math.PI * 2;
    p.style.setProperty('--bx', (ex - sx + Math.cos(ang) * spread).toFixed(1) + 'px');
    p.style.setProperty('--by', (ey - sy + Math.sin(ang) * spread).toFixed(1) + 'px');
    p.style.animationDelay = (Math.random() * 0.2).toFixed(2) + 's'; // 错峰出发
    p.style.animationDuration = (0.45 + Math.random() * 0.2).toFixed(2) + 's';
    fx.appendChild(p);
  }
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 800);
}
// 念力/精神强念：目标身上产生一个扭动变形的圆环（超能系精神波动扭曲空气），绕目标中心起伏后消失
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
      p.textContent = '♥';
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
  for (let i = 0; i < 4; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--hd', (i * 0.16).toFixed(2) + 's'); // 错峰起跳
    p.style.setProperty('--sh', (10 + (i % 2) * 5) + 'px');    // 高矮交替
    p.style.left = ((i - 1.5) * 7) + 'px';
    fx.appendChild(p);
  }
  box.appendChild(fx);
}
// 守住系护盾特效：宝可梦当前回合带 protected 标记时，周身罩一层淡蓝护盾光圈（扁平样式）。
// 生命周期与 syncStatusFx 一致：回合重置（protected=false）或换人后自动撤下
function syncShieldFx(side, mon) {
  const box = $(`${side}-box`);
  const img = $(`${side}-img`);
  if (!box || !img || !mon) return;
  let fx = box.querySelector('.b-shield');
  if (mon.protected) {
    if (fx && fx._mon === mon) return; // 同宠护盾已挂载：不重建，避免重触发入场动画
    if (fx) fx.remove();
    const ir = img.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    fx = document.createElement('span');
    fx.className = 'b-shield';
    fx._mon = mon;
    fx.style.left = (ir.left - br.left + ir.width / 2) + 'px';
    fx.style.top = (ir.top - br.top + ir.height / 2) + 'px';
    fx.style.width = Math.max(48, ir.width + 26) + 'px';
    fx.style.height = Math.max(48, ir.height + 26) + 'px';
    box.appendChild(fx);
  } else if (fx) {
    fx.remove();
  }
}
// 护盾挡下攻击（block 事件）：白光一闪 + 光圈扩张，短暂覆盖常驻的脉冲动画后复原
function shieldHit(side) {
  const fx = $(`${side}-box`)?.querySelector('.b-shield');
  if (!fx) return;
  fx.classList.remove('b-shield-hit');
  void fx.offsetWidth;
  fx.classList.add('b-shield-hit');
  setTimeout(() => fx.classList.remove('b-shield-hit'), 420);
}
// 钉子图标：撒菱每层 4 枚尖刺、毒菱每层 2 枚毒滴、隐形岩 3 枚岩块，
// 整组渲染在椭圆底座上，每颗错峰掉落入场；层数为 0 时不渲染任何图标
function hazardHtml(hz) {
  let h = '';
  let d = 0;
  const add = (cls, n) => {
    for (let k = 0; k < n; k++) h += `<i class="b-hz ${cls}" style="animation-delay:${(d++ * 0.045).toFixed(2)}s"></i>`;
  };
  add('spk', (hz.spikes || 0) * 4); // 撒菱每层 4 枚
  add('tox', (hz.toxic || 0) * 2);  // 毒菱每层 2 枚
  if (hz.rock) add('rck', 3);       // 隐形岩 3 枚岩块
  return h;
}
// 同步双方场地钉子图标：种类/层数变化时重建容器并播放掉落入场动画
function syncHazards(battle) {
  for (const [boxSide, key] of [['bp', 'p'], ['be', 'e']]) {
    const el = $(`${boxSide}-hazards`);
    if (!el) continue;
    const hz = battle.hazards[key] || { spikes: 0, toxic: 0, rock: false };
    const sig = `${hz.spikes}|${hz.toxic}|${hz.rock ? 1 : 0}`;
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
// 重踏/地震：攻击方原地跳起后砸地，落地瞬间整个战斗画面震动
function quakeAttack(side) {
  const img = $(`${side}-img`);
  if (img) {
    img.classList.remove('quake-hop');
    void img.offsetWidth;
    img.classList.add('quake-hop');
    setTimeout(() => img.classList.remove('quake-hop'), 450);
  }
  setTimeout(stageShake, 300); // 跳起动画 0.4s，约 75% 处落地触发震屏
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

// 等待玩家选招；返回行动对象：{type:'move',id} / {type:'switch',idx}（撤退由标题栏返回触发）
// 布局：左栏文案/技能，右栏操作按钮；选招时右栏切换为招式详情 + 返回按钮
function askPlayerMove(battle) {
  return new Promise((resolve) => {
    _pendingAsk = resolve; // 撤退时强制结束挂起的选择
    const done = (act) => { _pendingAsk = null; resolve(act); };
    const pMon = curMon(battle, 'p');
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
      $('act-auto').addEventListener('click', () => {
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
      cmd.innerHTML = moves.map((m) => {
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
        return `<button class="b-move${dis}" data-move="${m}" title="${tip}"${dis ? ' disabled' : ''}>
          <span class="b-move-name">${mv ? mv.name : '—'}</span>
          ${mv ? `<span class="b-move-type" style="background:${TYPE_COLORS[mv.type]}">
            <svg class="b-move-type-icon"><use xlink:href="#icon-type-${mv.type}"></use></svg>
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

async function playEvents(events, battle, hitRef, hitType, multiSide, rangedOpts) {
  const hitSide = hitRef === curMon(battle, 'p') ? 'bp' : 'be';
  const otherSide = hitSide === 'bp' ? 'be' : 'bp';
  // 防御：事件承受方已不在场（换人后局部变量残留指向旧宠）时，仅保留文本并等待，
  // 跳过伤害数字/受击震动/faint 动画——否则会误播到新上场的宝可梦身上
  const onField = hitRef === curMon(battle, 'p') || hitRef === curMon(battle, 'e');
  _multiHits = 0;
  const nSteps = events.filter((e) => e.t === 'step').length;
  for (const ev of events) {
    if (ev.t === 'step') {
      // 物理连击：近战=首击冲贴脸停留，之后在贴脸位小幅挥砍，末击回位；
      // 远程=攻击方站原地逐击喷射一发粒子，等其飞抵目标再结算该段伤害，末击结束回位
      _multiHits++;
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
      if (fromSide && toSide) spawnDrainParticles(fromSide, toSide, '#7dc84a', 9);
      continue;
    }
    if (ev.t === 'flinch') {
      // 畏缩：头顶感叹号 + 向后退一步（我方屏幕向左、敌方屏幕向右，方向由镜像容器处理）
      setText(ev.text || `${ev.who}畏缩了！`);
      if (onField) {
        playAnim(hitSide, 'flinch');
        flinchFx(hitSide);
      }
      await battleSleep(350);
      continue;
    }
    if (ev.t === 'miss') {
      // 未命中：目标头顶弹出灰色 MISS（挥空反馈），正文保留招式文案
      setText(ev.text || '没有命中！');
      if (onField) missFx(hitSide);
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
      shake(dSide); // 渲染后再震：renderMon 会清掉动画类，先渲染才能让受击动画真正播完
      if (hitType && TYPE_FX[hitType]) spawnTypeFx(dSide, hitType); // 12 元素系属性：专属粒子爆发
      else spawnHitSpark(dSide); // 其余属性：默认白火花
      flashHitPanel(dSide);
      if (dMon.maxHp > 0 && ev.amount / dMon.maxHp >= 0.25) stageShake(); // 重创（占比高）才全屏震动
      // 连击命中段：等待缩短到挥砍动画后立即衔接下一击（约 0.2s 动画 + 0.43s 停顿 ≈ 0.6s 一击）；
      // 普通单发伤害保留 750ms，维持重创一击的停顿感
      await battleSleep(nSteps ? 300 : 500);
    } else if (ev.t === 'heal') {
      const side = evSide(battle, ev, hitRef, hitSide, otherSide);
      popHeal(side, ev.amount);
      spawnHealFx(side); // 回复加号粒子：绿色十字能量向上飘散
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
      shake(hitSide); // 渲染后再震，避免被 renderMon 清掉动画类
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

// ---------- 两回合招式（挖洞/飞翔/潜水/弹跳/神鸟猛击/潜灵奇袭） ----------
// 第一回合进入蓄力状态（chargeMove 挂起），第二回合自动出招结算伤害
const CHARGE_MOVES = new Set(['挖洞', '飞翔', '潜水', '弹跳', '神鸟猛击', '潜灵奇袭']);
// 蓄力期间是否离场隐藏（神鸟猛击为原地蓄光，不隐藏）
const CHARGE_HIDES = { 挖洞: true, 飞翔: true, 潜水: true, 弹跳: true, 潜灵奇袭: true, 神鸟猛击: false };
const CHARGE_ENTER_TEXT = {
  挖洞: (n) => `${n} 挖洞钻入了地下！`,
  飞翔: (n) => `${n} 飞向了高空！`,
  潜水: (n) => `${n} 潜入了水中！`,
  弹跳: (n) => `${n} 高高跃起！`,
  神鸟猛击: (n) => `${n} 开始积蓄力量！`,
  潜灵奇袭: (n) => `${n} 消失在了暗影中！`,
};
// 进入蓄力的精灵位移动画类：下潜（挖洞/潜水）/ 升空（飞翔/弹跳）/ 原地蓄光 / 隐身
const CHARGE_ENTER_CLS = {
  挖洞: 'cg-sink', 潜水: 'cg-sink',
  飞翔: 'cg-rise', 弹跳: 'cg-rise',
  神鸟猛击: 'cg-glow',
  潜灵奇袭: 'cg-vanish',
};
// 第二回合现身攻击的动画类：从地下破土而出 / 从空中俯冲而下 / 显现冲刺
const CHARGE_OUT_CLS = {
  挖洞: 'cg-out-sink', 潜水: 'cg-out-sink',
  飞翔: 'cg-out-rise', 弹跳: 'cg-out-rise', 神鸟猛击: 'cg-out-rise',
  潜灵奇袭: 'cg-out-vanish',
};
// 第一回合蓄力进入：播放对应离场动画（飞翔升空/挖洞钻地等，过程完整可见），钻地/潜水在脚部溅起尘土与水花。
// 离场状态用 dataset.charged 标记（供对方攻击瞄准底座），不直接隐藏本体以免遮掉动画
function playChargeEnter(side, mvName) {
  const el = $(`${side}-img`);
  if (!el) return;
  resetAnim(el);
  void el.offsetWidth;
  el.classList.add(CHARGE_ENTER_CLS[mvName] || 'cg-vanish');
  el.dataset.charged = CHARGE_HIDES[mvName] ? '1' : ''; // 神鸟猛击原地蓄光不标记离场
  if (mvName === '挖洞') spawnGroundBurst(side, '#b98f5e', 9);
  else if (mvName === '潜水') spawnGroundBurst(side, '#7fd0f5', 7);
}
// 第二回合攻击：先播现身动画（破土/俯冲/跃出），再物理冲刺结算伤害
async function playChargeAttack(actor, side, moveId, battle) {
  const mv = _data.moves[moveId];
  const foe = curMon(battle, side === 'bp' ? 'e' : 'p');
  const el = $(`${side}-img`);
  setText(`${actor.name}使用${mv.name}攻击！`);
  if (el) {
    el.dataset.charged = ''; // 结束离场蓄力，恢复可被瞄准的在场状态
    resetAnim(el);
    void el.offsetWidth;
    el.classList.add(CHARGE_OUT_CLS[mv.name] || 'cg-out-vanish');
  }
  if (mv.name === '挖洞') spawnGroundBurst(side, '#b98f5e', 10);
  else if (mv.name === '潜水') spawnGroundBurst(side, '#7fd0f5', 8);
  await battleSleep(340); // 等现身动画播完
  lungeAttack(side); // 两回合招式均为物理攻击：冲撞对手
  await battleSleep(280);
  const evs = [];
  useMove(actor, foe, moveId, _data, evs, battle);
  await playEvents(evs, battle, foe, mv.type);
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
    playChargeEnter(side, mv.name);
    await battleSleep(720); // 等蓄力动画播完，本回合行动结束
    return;
  }
  setText(`${actor.name}使用了${mv.name}！`);
  const isPhys = moveCat(mv) === 'phys';
  const isSound = mv.name === '叫声' || mv.name === '唱歌' || mv.name === '哈欠' || mv.name === '巨声' || mv.name === '金属音' || mv.name === '长嚎' || mv.name === '治愈铃声' || mv.name === '虫鸣' || mv.name === '梦话' || mv.name === '超音波' || mv.name === '打嗝'; // 发声招式：声波弹道
  const isBubble = mv.name === '泡沫' || mv.name === '泡沫光线' || mv.name === '水枪' || mv.name === '喷水'; // 水系弹道招式：气泡特效
  const isStar = mv.name === '高速星星'; // 高速星星：星形弹道特效
  // 圆环弹道（幻象光线/精神波 超能粉；水炮 水系蓝）
  const isRing = mv.name === '幻象光线' || mv.name === '精神波' || mv.name === '水炮';
  const RING_COLOR = { '幻象光线': '#F8669C', '精神波': '#F8669C', '水炮': '#3F98EA' };
  const isPsychicWrap = mv.name === '念力'; // 念力：目标身上扭动圆环
  const isBeam = mv.name === '破坏光线'; // 破坏光线：光束弹道特效
  const isIceBeam = mv.name === '冰冻光束' || mv.name === '极光束' || mv.name === '铁蹄光线'; // 冰冻光束/极光束/铁蹄光线：直线光束
  const isSolarBeam = mv.name === '日光束'; // 日光束：对手脚下向上射出一根柔光细柱
  const isConfuse = mv.name === '奇异之光'; // 奇异之光：柔和描边黄色球
  const isFireStream = mv.name === '喷射火焰'; // 喷射火焰：火系一串弹道
  const isAcidStream = mv.name === '溶解液'; // 溶解液：毒系一串酸液滴弹道
  const isScreenFlash = mv.name === '魔法闪耀' || mv.name === '电光' || mv.name === '精神强念'; // 全屏遮罩闪光：魔法闪耀/电光/精神强念
  // 叶片弹道（飞叶快刀/飞叶风暴 绿 / 花瓣舞 粉）：一串叶片飞向对手，颜色按招注入
  const isLeafStream = mv.name === '飞叶快刀' || mv.name === '花瓣舞' || mv.name === '飞叶风暴';
  const LEAF_COLOR = { '飞叶快刀': '#3fa129', '花瓣舞': '#f8669c', '飞叶风暴': '#3fa129' };
  // 风系/龙卷风类招式（起风/翅膀攻击/龙卷风/暴风/空气利刃 青白，热风红，妖精之风粉，冰冻之风蓝）
  const isWind = mv.name === '起风' || mv.name === '翅膀攻击' || mv.name === '龙卷风' || mv.name === '暴风' || mv.name === '空气利刃' || mv.name === '热风' || mv.name === '妖精之风' || mv.name === '冰冻之风';
  const WIND_COLOR = { '热风': '#ff5a3c', '妖精之风': '#f8669c', '冰冻之风': '#7fd0f5' };
  // 龙系特殊招式（龙息/龙之波动/流星群/时光咆哮/亚空裂斩/鳞片噪音/巨龙威能/归无之光/随机光）：龙息能量波弹道；龙卷风走旋风特效
  const isDragon = mv.type === '龙' && moveCat(mv) === 'spec' && mv.name !== '龙卷风';
  // 吸血招式（吸取/超级吸取/终极吸取/吸取拳/吸取之吻等 drain 类）：命中后粒子从目标吸回攻击方
  const isDrain = mv.effect && mv.effect.kind === 'drain';
  const DRAIN_COLOR = {
    吸取: '#7dc84a', 超级吸取: '#7dc84a', 终极吸取: '#7dc84a', 强力吸取: '#7dc84a', // 草系绿
    吸取之吻: '#f8669c', // 妖精粉
    吸取拳: '#9CAE1E', 吸血: '#9CAE1E', 吸血轮盘: '#9CAE1E', // 虫系黄绿
    地狱突刺: '#9a6cd0', 灵魂吸取: '#9a6cd0', // 幽灵紫
    深渊汲取: '#3F98EA', // 水系蓝
  };
  // 大面积水系招式（潮旋/水之波动/泼冷水/冲浪/热水）：蓝色半透明水幕沿对角线涌过战场
  const isWaterSweep = mv.name === '潮旋' || mv.name === '水之波动' || mv.name === '泼冷水' || mv.name === '冲浪' || mv.name === '热水';
  // 圆球弹道招式（按属性着色）；火花/磷火复用火焰球
  const BALL_COLOR = { '能量球': '#3fa129', '暗影球': '#7a52c9', '电球': '#ffd93b', '火焰球': '#ff7a2e', '火花': '#ff7a2e', '磷火': '#ff7a2e', '大字爆炎': '#ff7a2e', '意念头锤': '#F8669C', '污泥炸弹': '#8943B0', '击落': '#D3A865', '加农光炮': '#60a1b8' };
  const isBall = Object.prototype.hasOwnProperty.call(BALL_COLOR, mv.name);
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
    if (isSound) {
      spawnSoundWave(side); // 从攻击方发出扩散的声波圈
      await battleSleep(320); // 等声波扩散起效再结算
    } else if (isWind) {
      spawnWindTornado(side, WIND_COLOR[mv.name]); // 彩色旋风刮向对手
      await battleSleep(430); // 等旋风刮到对手处再结算伤害
    } else if (isWaterSweep) {
      spawnWaterSweep(side); // 蓝色水幕沿对角线涌过战场
      await battleSleep(560); // 等水幕涌到对手处再结算伤害
    } else if (isDragon) {
      spawnDragonWave(side); // 龙息能量波弹道
      await battleSleep(480); // 等能量波飞抵目标再结算伤害（动画 0.6s，到位约 0.5s）
    } else if (isBubble) {
      spawnProjStream(side, 'bubble'); // 一串气泡飞向对手，逐一消失
      await battleSleep(300); // 等气泡飞到对手处再结算伤害
    } else if (isStar) {
      spawnProjStream(side, 'star'); // 一串星星飞向对手，逐一消失
      await battleSleep(300);
    } else if (isPebble) {
      spawnProjStream(side, 'pebble', PEBBLE_COLOR[mv.name]); // 一串圆石飞向对手，逐一命中
      await battleSleep(320); // 等圆石飞到对手处再结算伤害
    } else if (isRing) {
      spawnProjStream(side, 'ring', RING_COLOR[mv.name]); // 一串彩色圆环飞向对手，逐一消失
      await battleSleep(300);
    } else if (isPsychicWrap) {
      spawnPsychicWrap(side === 'bp' ? 'be' : 'bp'); // 目标身上扭动圆环（精神波动）
      await battleSleep(480); // 等圆环扭动起来再结算伤害
    } else if (isConfuse) {
      spawnProjStream(side, 'confuse'); // 一颗柔和描边黄色球飞向对手
      await battleSleep(560); // 等球蓄力完成并飞抵目标再结算伤害
    } else if (isFireStream) {
      spawnProjStream(side, 'flame', '#ff7a2e'); // 一串火焰弹飞向对手，逐一命中
      await battleSleep(320); // 等火焰飞到对手处再结算伤害
    } else if (isAcidStream) {
      spawnProjStream(side, 'acid', TYPE_COLORS['毒']); // 一串酸液滴飞向对手，逐一命中
      await battleSleep(320); // 等酸液飞到对手处再结算伤害
    } else if (isScreenFlash) {
      spawnScreenFlash(); // 粉色半透明遮罩全屏一闪
      await battleSleep(320); // 等遮罩闪光扩散完再结算伤害
    } else if (isLeafStream) {
      spawnProjStream(side, 'leaf', LEAF_COLOR[mv.name]); // 一串叶片/花瓣飞向对手，逐一命中
      await battleSleep(320); // 等叶片飞到对手处再结算伤害
    } else if (isBall) {
      spawnProjStream(side, 'ball', BALL_COLOR[mv.name], mv.name === '击落'); // 单球蓄力后飞向对手；击落为实心岩石球
      await battleSleep(560); // 等球蓄力完成并飞抵目标再结算伤害（动画 0.7s，飞行到位约 0.6s）
    } else if (isBeam) {
      spawnLightSweep(side); // 一截光段飞向对手并冲出屏幕
      await battleSleep(350); // 光段飞抵对手即结算伤害（飞行 0.7s、距离 1.9 倍，到点时刻恒定 ≈0.37s）
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
      spawnLightningStrike(side === 'bp' ? 'be' : 'bp'); // 闪电劈中对手头部
      await battleSleep(isPhys ? 430 : 400); // 等冲撞贴脸/闪电劈到再结算伤害
    } else if (isDrain) {
      // 吸血招式：先攻击命中，命中后粒子从目标身上吸回攻击方
      if (isPhys) lungeAttack(side);
      else lunge(side);
      await battleSleep(isPhys ? 280 : 160);
      spawnDrainParticles(side === 'bp' ? 'be' : 'bp', side, DRAIN_COLOR[mv.name] || '#7dc84a');
      await battleSleep(520); // 等粒子吸回再结算伤害（粒子约 0.45-0.65s）
    } else {
      // 远程单体物理（冰砾）：留原位射一发冰球，等弹到对手处再结算伤害
      if (rangedSingle) {
        raiseAttacker(side);
        await spawnProjOne(side, rangedSingle.shape, rangedSingle.color);
        await battleSleep(120); // 冰球落点后留一小拍再结算
        lowerAttacker(side);
      } else {
        if (isPhys) lungeAttack(side);
        else lunge(side);
        // 伤害/状态在攻击"贴脸/命中"瞬间爆出（物理=挥砍一击时刻，特殊=施法摆动到位），而非回退时
        await battleSleep(isPhys ? 280 : 160);
      }
    }
  }
  const evs = [];
  useMove(actor, foe, moveId, _data, evs, battle);
  if (rangedPhys) raiseAttacker(side); // 远程连击：攻击方留在原位，期间置顶层
  // 近战多段：各击在 playEvents 的 step 里逐击摆动；远程多段：逐击喷射粒子，弹到即结算伤害
  await playEvents(evs, battle, foe, mv.type, multiPhys ? side : null, rangedPhys || null);
  syncFieldFx(battle); // 出招结算后刷新护盾/钉子表现（守住生效、撒菱/毒菱/隐形岩落场）
}

async function battleLoop(battle) {
  _busy = true;
  try {
    while (!battle.winner && !_fleeing) {
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
      pMon.hitByPhys = false; pMon.physDmg = 0; pMon.hitBySpec = false; pMon.specDmg = 0; pMon.protected = false; pMon.endure = false; pMon.destinyBond = false; pMon.whirlwinded = false; pMon.batonPass = false;
      eMon.hitByPhys = false; eMon.physDmg = 0; eMon.hitBySpec = false; eMon.specDmg = 0; eMon.protected = false; eMon.endure = false; eMon.destinyBond = false; eMon.whirlwinded = false; eMon.batonPass = false;
      syncFieldFx(battle); // 回合重置：撤掉上一回合的守住护盾
      const pPre = []; // 我方回合前状态事件（睡眠/麻痹/畏缩/混乱自伤等）
      const ePre = []; // 敌方回合前状态事件
      let pAct = null; // 我方选择：{type:'move',id} / {type:'switch',idx}
      let eMove = null; // 敌方 AI 选择（null = 本回合不行动）

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
        eMove = eMon.chargeMove != null ? eMon.chargeMove : aiMove(eMon, pMon, _data); // 同上：AI 蓄力招式第二回合自动出招
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

      // 出招：双方都出招时按速度先后（速度更高者先动；平手随机）；
      // 反击招先制度 -4 强制后手，否则本回合还没吃到物理伤害就出手必然失败
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
    _auto = false; // 战斗结束（含撤退/异常）自动战斗一并复位
    hideLogMenu(); // 战斗结束时若右键菜单还开着，一并收起
    closeLogPage(); // 记录页开着则关闭并还原标题栏（战斗已结束，无返回战斗一说）
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
  _retryAuto = _auto; // 记住战斗结束时的自动状态：「再战一次」沿袭（战斗中切回手动的则手动重试）
  const win = battle.winner === 'p';
  _activeBattle = null; // 战斗已结束：清空活动战斗（后续返回走普通视图切换，不再误判为撤退）
  _settled = true; // 结算页显示中：标题栏返回应回 NPC 战斗列表
  const gd = gameData;
  // 随从增益：battleexp 类提升对战胜利经验。拆出基础值与加成部分，供结算页黄色标注
  const expMult = (window.__followerBoostMechanic?.('battleExp', 1) ?? 1);
  const expBaseLv = battle.eTeam.reduce((s, x) => s + x.mon.level, 0) * 8;
  const avgLv = battle.eTeam.reduce((s, x) => s + x.mon.level, 0) / battle.eTeam.length;
  const results = [];
  let dropCandy = false; // 经验糖果掉落（仅胜利按档位概率判定）
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
    dropCandy = Math.random() < (battle.preset.expChance || 0);
    if (dropCandy) {
      gd.items['exp-candy'] = (gd.items['exp-candy'] || 0) + 1;
      updateBackpack('exp-candy'); // 掉落瞬间立即刷新背包栏数量，不等 5 秒 tick
    }
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
  addSystemLog('战斗', `${win ? '战胜' : '输给'}了「${battle.preset.name}」${win ? `，获得 ${battle.preset.candy} 糖果${dropCandy ? '，经验糖果 ×1' : ''}` : ''}`);
  endBattle(); // 战斗结束 → 停止战斗曲，恢复地区曲
  if (win) playVictory(); // 胜利音效（播完自动恢复地区曲）
  if (win) window.dispatchEvent(new Event('achievements-changed')); // 胜利可能解锁对战成就，即时刷新手机红点

  const box = $('battleContent');
  box.innerHTML = `
    <div class="battle-app battle-result t-${battle.preset.tier}">
      <div class="battle-result-title">${win ? '挑战成功！' : '挑战失败…'}</div>
      <div class="battle-result-detail">
        ${win ? results.map((r) => `<div>${r.name} 升级到 Lv${r.lv}${r.up ? `（+${r.up}级）` : ''}${r.bonusGain > 0 ? ` <span class="exp-bonus">+${r.bonusGain}经验</span>` : ''}</div>`).join('') : '<div>失败无经验，调整队伍或招式再来试试吧！</div>'}
        ${win ? `<div class="candy-gain">获得 <img class="candy-icon" src="./items/candy.png" alt=""> × ${battle.preset.candy}${dropCandy ? ` <img class="candy-icon" src="./items/xp-candy.png" alt=""> × 1` : ''}</div>` : ''}
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
