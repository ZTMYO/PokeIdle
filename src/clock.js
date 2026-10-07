// ===== 世界时钟：把真实经过时间兑换成整数个"世界步" =====
// 1 步 = 1/60 秒。刷新率只决定同一状态画几次，不决定世界走多快：
// 高刷屏多数帧是 0 步（只重绘），低刷屏一帧补多步，速度一致。
// 暂停（遇敌/钓鱼/拾取）与页面隐藏/长停摆不在这里逐帧补，记停摆秒数交给挂机补算入账。

const STEP_MS = 1000 / 60;      // 一个世界步的时长
const MAX_STEP_BATCH_MS = 1000; // 单帧最多补 1 秒；更长的间隔算停摆

let _accMs = 0;      // 攒够一步走一步，余数留到下一帧（长期不漂）
let _afkMs = 0;      // 待补算的停摆毫秒（页面隐藏 / 单帧间隔超过 1 秒）
let _simMs = 0;      // 已推进的世界毫秒（真实走动时长，掉落折算用）
let _running = false;
let _last = 0;

export function start() {
  _last = performance.now();
  _accMs = 0;
  _running = true;
}

// 有意暂停（遇敌/钓鱼/拾取道具）：不兑换步数，也不计入停摆
export function pause() {
  _running = false;
}

// 恢复：重置时间戳与余数，暂停时长不计入
export function resume() {
  _last = performance.now();
  _accMs = 0;
  _running = true;
}

export function stop() {
  _running = false;
  _accMs = 0;
  _afkMs = 0;
  _simMs = 0;
}

// 每帧调用一次（road.js 的 rAF 驱动）：返回本帧要推进的世界步数
export function stepsThisFrame() {
  const now = performance.now();
  const dt = now - _last;
  _last = now;
  if (!_running) return 0;

  // 页面隐藏或单帧间隔超过 1 秒：整段交给挂机补算，避免恢复瞬间跳段
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (hidden || dt > MAX_STEP_BATCH_MS) {
    _afkMs += dt;
    return 0;
  }

  _accMs += dt;
  const steps = Math.floor(_accMs / STEP_MS);
  if (steps <= 0) return 0;
  _accMs -= steps * STEP_MS;
  _simMs += steps * STEP_MS;
  return steps;
}

// 已推进的世界秒数（真实走动时长，掉落/概率按它折算）
export function simSeconds() { return _simMs / 1000; }

// 取走并清零停摆秒数（挂机补算用）
export function takeAfkSeconds() {
  const s = _afkMs / 1000;
  _afkMs = 0;
  return s;
}
