// ===== 后台挂机补发：开关 + 隐藏记账 + visibilitychange 监听 =====
// 桌面浏览器 / Tauri 窗口最小化时 rAF 被节流、定时器被冻结，恢复后按隐藏秒数补发挂机收益
// （里程/掉落/遇敌/帮手/农场）。安卓 WebView 切后台 JS 冻结、进程可能被杀，若安卓端沿用
// "离线暂停"哲学（calcOffline），把 BACKGROUND_CATCHUP 改为 false 即可整体关闭补发——
// 记账、补算、遭遇结算等全部入口都会跳过，主循环保持前台原行为。
export const BACKGROUND_CATCHUP = true;

export function bgCatchupEnabled() {
  return BACKGROUND_CATCHUP;
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

// 启动时把"关掉 App / 被杀进程"期间的离线秒数并进停摆累计，与切后台共用同一套补发管线；
// 否则这段时间只加在线时长，一点挂机收益都不给
export function seedBgOfflineSeconds(sec, isBike) {
  if (!bgCatchupEnabled() || !(sec > 0)) return;
  _bgSecAccum += sec;
  _hiddenIsBike = !!isBike; // 离线期间在骑行：不掉落不遇敌，里程按骑行速度补
  _hiddenBuffRemainingMs = 0; // 离线期间增益暂停（会话恢复按余量续上），补算按无 buff 段估
}

// 进入后台：挂机态才记停摆起点（顺带快照步态/buff），并通知结算进行中的遭遇
function enterBg() {
  if (_inBg) return;
  _inBg = true;
  if (deps.isIdleRoadActive()) {
    _hiddenAt = Date.now();
    _hiddenIsBike = deps.isBike(); // 记录停摆期间步态：骑行停摆不产生掉落/遭遇，里程按骑行速度补
    // 快照离开时刻 buff 剩余时长（甜甜蜜/护符互斥，取剩余较多者），供补算分段模拟遇敌节奏
    _hiddenBuffRemainingMs = Math.max(_hiddenBuffRemainingMs, deps.buffRemaining() || 0);
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
