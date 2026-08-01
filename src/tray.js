// 系统托盘走路动画
// 走路动画实际循环 4 段（0.6s/4 = 150ms 一段）：帧0 → 帧6 → 帧1 → 帧6
// 其中帧6 重复出现（第2段与第4段同一帧），因此只需裁好的 3 张图 walk-1/2/3
// 前端把 4 帧 RGBA 一次性发给 Rust，Rust 后台线程按 150ms 逐帧切换托盘图标
import { getCharPrefix } from './ui.js';
import * as road from './road.js';

const FRAME_SEQ = [0, 2, 1, 2]; // walk-1 / walk-3 / walk-2 / walk-3
const TRAY_SIZE = 64;
let started = false;
let pushedPrefix = null;
let pushedPaused = null;

function getInvoke() {
  return window.__TAURI__?.core?.invoke || null;
}

// 加载 3 帧并缩放为 TRAY_SIZE x TRAY_SIZE（角色等比缩放、透明背景居中）
async function buildFrames(prefix) {
  const imgs = await Promise.all([1, 2, 3].map(n => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = `./icons/${prefix}-walk-${n}.png`;
  })));
  const canvas = document.createElement('canvas');
  canvas.width = TRAY_SIZE;
  canvas.height = TRAY_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  return imgs.map(img => {
    const h = TRAY_SIZE - 4;
    const w = Math.round(img.width * h / img.height);
    ctx.clearRect(0, 0, TRAY_SIZE, TRAY_SIZE);
    ctx.drawImage(img, Math.round((TRAY_SIZE - w) / 2), 2, w, h);
    const data = ctx.getImageData(0, 0, TRAY_SIZE, TRAY_SIZE).data;
    return { rgba: Array.from(data), width: TRAY_SIZE, height: TRAY_SIZE };
  });
}

// 把当前性别对应的动画帧推送给 Rust：
// 行走中推 4 帧动画序列；主角不动（里程暂停：钓鱼/遇敌等）时只推 walk-2 单帧，托盘静止
async function pushFrames() {
  const invoke = getInvoke();
  if (!invoke) return;
  try {
    const prefix = getCharPrefix();
    const paused = !road.isActive();
    if (prefix === pushedPrefix && paused === pushedPaused) return; // 状态未变不重推
    pushedPrefix = prefix;
    pushedPaused = paused;
    const frames = await buildFrames(prefix);
    const seq = paused ? [frames[1]] : FRAME_SEQ.map(i => frames[i]);
    await invoke('set_tray_frames', { frames: seq });
  } catch (_) { /* 托盘动画失败时静默降级为静态图标 */ }
}

// 启动托盘动画：推送一次帧数据，并定期检查性别/道路暂停状态变化后重新推送
export function startTrayAnimation() {
  if (started) return;
  started = true;
  pushFrames();
  setInterval(() => {
    const prefix = getCharPrefix();
    const paused = !road.isActive();
    if (prefix !== pushedPrefix || paused !== pushedPaused) pushFrames();
  }, 1000);
}
