// ===== 本机匿名标识 =====
// 心跳与每日抽奖共用：首次生成 16 字节随机数转 32 位 hex，存 localStorage，不包含任何设备信息。
const KEY = 'pokemon_idle_install';
let _fallback = null;

export function installId() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch (_) {}
  if (!v) v = _fallback;
  if (!v) {
    v = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    _fallback = v;
    try { localStorage.setItem(KEY, v); } catch (_) {}
  }
  return v;
}
