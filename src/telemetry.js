// ===== 匿名在线统计 =====
// 游戏可见时每 60 秒发一次心跳（本机随机标识 + 版本号 + 所在全服事件）；下面填了接口地址才生效。
// 服务端顺便回报"你是不是旧版本"，设置页底部的版本号据此加一个（可更新）
import { APP_VERSION, DEV } from './build-info.js';
import { inMassZone, inTwistZone, getMassOutbreak, getTwist } from './state.js';
const TELEMETRY_ENDPOINT = 'https://pokeidle.shiliu.space/api/telemetry';
const KEY = 'pokemon_idle_install';
const HEARTBEAT_MS = 60000;

// 开发运行（npm run dev）一律不联网：免得把开发中的版本号当成正式版本报上去。
// 想在开发时联一次网，控制台执行 localStorage.setItem('pokeidle_online','1')
const onlineAllowed = () => !DEV || localStorage.getItem('pokeidle_online') === '1';

function installId() {
  let v = localStorage.getItem(KEY);
  if (!v) {
    v = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY, v);
  }
  return v;
}

// 服务端最近一次告诉我们的事：是否有比本机更新的版本
let _update = false;

// 当前所在的全服事件段：本地兜底事件没有 slotFrom，不计入全服人数
function presenceZone() {
  if (inMassZone()) {
    const mo = getMassOutbreak();
    return mo && mo.slotFrom > 0 ? `mass:${mo.slotFrom}` : '';
  }
  if (inTwistZone()) {
    const tw = getTwist();
    return tw && tw.slotFrom > 0 ? `twist:${tw.slotFrom}` : '';
  }
  return '';
}

const beat = () => {
  if (!TELEMETRY_ENDPOINT || !onlineAllowed() || document.hidden) return;
  try {
    const zone = presenceZone();
    const body = zone ? `${installId()}|${APP_VERSION}|${zone}` : `${installId()}|${APP_VERSION}`;
    fetch(`${TELEMETRY_ENDPOINT}/ping`, { method: 'POST', body })
      .then((r) => r.json())
      .then((j) => { if (j && typeof j.update === 'boolean') _update = j.update; })
      .catch(() => {});
  } catch (_) {}
};

// 事件页打开时拉一次在线/事件人数；短时间重复打开直接复用
let _presence = null;
let _presenceAt = 0;
export async function fetchPresenceStats() {
  if (!TELEMETRY_ENDPOINT || !onlineAllowed()) return null;
  if (_presence && Date.now() - _presenceAt < 30000) return _presence;
  try {
    const res = await fetch(`${TELEMETRY_ENDPOINT}/stats`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    _presence = {
      online: num(j.online),
      mass: num(j.mass),
      twist: num(j.twist),
      massFrom: j.massFrom || null,
      twistFrom: j.twistFrom || null,
    };
    _presenceAt = Date.now();
    return _presence;
  } catch (_) {
    return null;
  }
}

// 是否有更新版本（拿到新包并连过一次服务器后才会变 true；拿不到就一直是 false）
export const hasUpdate = () => onlineAllowed() && _update;

export function startTelemetry() {
  if (!TELEMETRY_ENDPOINT || !onlineAllowed()) return;
  beat();
  setInterval(beat, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
}
