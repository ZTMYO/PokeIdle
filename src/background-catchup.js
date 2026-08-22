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
let _hiddenIsBike = false;
let _hiddenBuffRemainingMs = 0;

// main.js 注入的依赖（避免本模块反向 import battle/road 造成循环依赖）
let deps = null;

export function initBackgroundCatchup(d) {
  deps = d;
}

// 读取停摆累计秒数并清零
export function bgTakeAccum() {
  const s = _bgSecAccum;
  _bgSecAccum = 0;
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

// 注册 visibilitychange：隐藏记账，恢复累计停摆秒数；遭遇中切后台立即结算
export function startBackgroundCatchup() {
  if (!bgCatchupEnabled() || !deps) return;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // 仅 idle 且道路行驶中（非遇敌/钓鱼/战斗中）记录：停摆补算只对应当前在"正常挂机"的状态
      if (deps.isIdleRoadActive()) {
        _hiddenAt = Date.now();
        _hiddenIsBike = deps.isBike(); // 记录停摆期间步态：骑行停摆不产生掉落/遭遇，里程按骑行速度补
        // 快照离开时刻 buff 剩余时长（甜甜蜜/护符互斥，取剩余较多者），供补算分段模拟遇敌节奏
        _hiddenBuffRemainingMs = Math.max(_hiddenBuffRemainingMs, deps.buffRemaining() || 0);
      }
      deps.onHidden(); // 遭遇中切后台：立即结算进行中的遭遇（autoCatch 定时器会被冻结卡画面）
    } else if (_hiddenAt) {
      _bgSecAccum += (Date.now() - _hiddenAt) / 1000;
      _hiddenAt = 0;
    }
  });
}
