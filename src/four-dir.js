// 四向走路/待机素材的共享入口：查几何表、拼路径
// 网格布局为「列=帧、行=方向」，行序固定 下/右/上/左；帧时长单位 1/60 秒
import META from './pokemon-data/pokemon-4dir/meta.js';

const BY_DEX = new Map(META.map(m => [m.dex, m]));

// 源美术 1px 对应屏幕 1.3px（TILE_SRC 16 → TILE 24，四向素材按视觉再收一点）
export const FOUR_DIR_SCALE = 1.3;
export const DIR_ROW = { down: 0, right: 1, up: 2, left: 3 };
// 生成时每帧四边留的透明边（build-4dir.py 的 PAD），按尺寸算缩放时要扣掉
export const FOUR_DIR_PAD = 2;

export function fourDirGeom(dex) {
  return BY_DEX.get(Number(dex)) || null;
}

// anim: 'walk' | 'idle'
export function fourDirSrc(geom, anim) {
  if (!geom) return '';
  return './pokemon-data/pokemon-4dir/' + anim + '/' + geom.file;
}

// 'Walk' | 'Idle' 取不到时退回 Walk（素材两套画布一致）
export function fourDirAnim(geom, anim) {
  if (!geom) return null;
  return (anim === 'idle' ? geom.Idle : geom.Walk) || geom.Walk;
}

// 静止展示该用哪个动作：有 Idle 就用 idle（只一帧时即静止不动），缺素材才退回 Walk
export function fourDirStaticAnim(geom) {
  return geom && geom.Idle ? 'idle' : 'walk';
}

// 一帧的显示时长（毫秒），d[] 单位 1/60 秒
export function fourDirDelay(anim, frame) {
  return Math.max(16, ((anim.d[frame] || 6) * 1000) / 60);
}

// 铺成单帧：元素尺寸设为帧宽高，objectPosition 按行列取帧
function layout(img, anim, row, k, origin) {
  img.style.width = anim.w + 'px';
  img.style.height = anim.h + 'px';
  img.style.objectFit = 'none';
  img.style.objectPosition = `0px -${row * anim.h}px`;
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';
  img.style.transformOrigin = origin;
  img.style.transform = `scale(${k})`;
}

// 缩略图 / 卡片：等比缩进边长为 box 的方框，避免宽体素材被容器裁掉
export function fourDirFitBox(img, geom, anim, box, opts = {}) {
  const a = fourDirAnim(geom, anim);
  const k = box / Math.max(a.w - FOUR_DIR_PAD * 2, a.h - FOUR_DIR_PAD * 2);
  layout(img, a, opts.row || 0, k, opts.origin || 'center');
  return k;
}

// 需要脚底对齐的场景：按视觉高度缩放，宽度随比例
export function fourDirFitHeight(img, geom, anim, viewH, opts = {}) {
  const a = fourDirAnim(geom, anim);
  const k = viewH / (a.h - FOUR_DIR_PAD * 2);
  layout(img, a, opts.row || 0, k, opts.origin || 'center');
  return k;
}

// 某行实际内容框 [左,上,右,下]（闭区间，帧内像素），生成时量的是右向行走行；缺数据则退回整格
export function fourDirRowBox(geom, anim) {
  const a = fourDirAnim(geom, anim);
  const b = geom && geom.boxR;
  if (b && b.length === 4) return [b[0], b[1], b[2], b[3]];
  return [0, 0, a.w - 1, a.h - 1];
}

// 按内容框等比缩放：内容的高、宽都不超过 maxSize，宽体受宽度限制；返回缩放系数
export function fourDirFitContent(img, geom, anim, maxSize, opts = {}) {
  const a = fourDirAnim(geom, anim);
  const b = fourDirRowBox(geom, anim);
  const cw = Math.max(1, b[2] - b[0] + 1);
  const ch = Math.max(1, b[3] - b[1] + 1);
  const k = maxSize / Math.max(cw, ch);
  layout(img, a, opts.row || 0, k, opts.origin || 'center');
  return k;
}
