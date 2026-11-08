// ===== 后台挂机补发：开关 + 隐藏记账 + visibilitychange 监听 =====
// 只处理"进程还活着、切到后台/最小化"的停摆补发（里程/掉落/遇敌/帮手/农场）。
// 大退/被杀后重开走 calcOffline：只把不走的计时器基准后移，不补资源，只有派遣按真实时间推进。
export const BACKGROUND_CATCHUP = true;

export function bgCatchupEnabled() {
  return BACKGROUND_CATCHUP;
}

// 是否处在"切后台/最小化"的停摆窗口：这期间 buff 到期不该当场续杯（没有遭遇，续了也是白烧），
// 余量留给回前台的挂机补发按时间线模拟
export function bgAway() {
  return _inBg || _bgSecAccum > 0;
}

// 只判“是否正在后台”（补发窗口还没消费不算），逐秒计时用这个，别用 bgAway
export function bgInBackground() {
  return _inBg;
}

// 隐藏开始时间戳 / 停摆累计秒数 / 停摆时步态(是否骑行) / 停摆时 buff 剩余毫秒快照
let _hiddenAt = 0;
let _bgSecAccum = 0;
let _statSecAccum = 0;   // 同一会话里切后台的秒数：补记"挂机时长"用；离线秒数已由 calcOffline 记过，不进这个桶
let _hiddenIsBike = false;
let _hiddenBuffRemainingMs = 0;
let _nativeSource = false; // 安卓壳的原生切后台信号已接管，visibilitychange 退场（两个源同时用会打架）
let _inBg = false;         // 当前是否已判为后台：两个信号源先后到达时只记一次

// main.js 注入的依赖（避免本模块反向 import battle/road 造成循环依赖）
let deps = null;

export function initBackgroundCatchup(d) {
  deps = d;
}

// 只读停摆累计秒数（不清零）：给"跨越停摆的遭遇"取切走时刻用
export function bgPeekAccum() { return _bgSecAccum; }

// 读取停摆累计秒数并清零
export function bgTakeAccum() {
  const s = _bgSecAccum;
  _bgSecAccum = 0;
  return s;
}

// 读取"该补记挂机时长"的停摆秒数并清零（只有同一会话切后台才往里加）
export function bgTakeStatSeconds() {
  const s = _statSecAccum;
  _statSecAccum = 0;
  return s;
}

// 读取停摆时步态（是否骑行）并复位
export function bgTakeBike() {
  const b = _hiddenIsBike;
  _hiddenIsBike = false;
  return b;
}

// 读取停摆时 buff 剩余毫秒快照并清零
export function bgTakeBuffRemainingMs() {
  const m = _hiddenBuffRemainingMs;
  _hiddenBuffRemainingMs = 0;
  return m;
}

// 进入后台：挂机态才记停摆起点（顺带快照步态/buff），并通知结算进行中的遭遇
function enterBg() {
  if (_inBg) return;
  _inBg = true;
  if (deps.isIdleRoadActive()) {
    _hiddenAt = Date.now();
    _hiddenIsBike = deps.isBike(); // 记录停摆期间步态：骑行停摆不产生掉落/遭遇，里程按骑行速度补
    // 快照离开时刻 buff 剩余时长。每次切后台都以这一次为准，不能和上一次没消费的旧快照取 max：
    // 那样会把早已过期的 buff 越攒越长，补算时整段停摆都被按增益判（神兽/闪光率虚高）
    _hiddenBuffRemainingMs = deps.buffRemaining() || 0;
  } else {
    _hiddenBuffRemainingMs = 0;
  }
  deps.onHidden(); // 遭遇中切后台：立即结算进行中的遭遇（autoCatch 定时器会被冻结卡画面）
}

// 回到前台：把这段停摆累计进账，按需结算压屏的遭遇
function leaveBg() {
  if (!_inBg) return;
  _inBg = false;
  if (!_hiddenAt) return;   // 切走时不在挂机态：没有停摆秒数可补，只是把标志收回来
  const awaySec = (Date.now() - _hiddenAt) / 1000;
  _bgSecAccum += awaySec;
  _statSecAccum += awaySec;   // 挂机时长也要算上这段：这段时间没有 tick，逐秒累加走不到
  _hiddenAt = 0;
  deps.onShown(awaySec); // 停摆窗口内刷出的遭遇还压在屏幕上：回前台按当前模式结掉
}

// 安卓壳的原生切后台信号（Capacitor appStateChange，走 Activity onPause/onResume）：
// 壳里 WebView 的 View 不 detach，document.hidden 可能恒 false、visibilitychange 也不触发，原生信号更准。
// 一旦接了原生源，visibilitychange 就退场，避免两个源把同一段停摆记两遍、或互相提前结算
export function notifyAppState(isActive) {
  if (!bgCatchupEnabled() || !deps) return;
  _nativeSource = true;
  if (isActive) leaveBg();
  else enterBg();
}

// 注册 visibilitychange：隐藏记账，恢复累计停摆秒数；遭遇中切后台立即结算
export function startBackgroundCatchup() {
  if (!bgCatchupEnabled() || !deps) return;
  document.addEventListener('visibilitychange', () => {
    if (_nativeSource) return;
    if (document.hidden) enterBg();
    else leaveBg();
  });
}
