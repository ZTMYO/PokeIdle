// 分享卡片共用的立绘变体：RGB 分离、污染滤镜、炫彩描边
const RAINBOW = ['#ff3b3b', '#ffe83b', '#3bff8a', '#3bd9ff', '#b03bff', '#ff3b3b'];

function drawRainbow(ctx, img, x, y, w, h) {
  const pad = Math.max(2, Math.round(Math.max(w, h) / 60));
  const canvas = document.createElement('canvas');
  canvas.width = w + pad * 2;
  canvas.height = h + pad * 2;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;

  const mask = document.createElement('canvas');
  mask.width = canvas.width;
  mask.height = canvas.height;
  const m = mask.getContext('2d');
  m.imageSmoothingEnabled = false;
  m.drawImage(img, pad, pad, w, h);
  m.globalCompositeOperation = 'source-in';
  const grad = m.createLinearGradient(0, 0, canvas.width, canvas.height);
  RAINBOW.forEach((color, i) => grad.addColorStop(i / (RAINBOW.length - 1), color));
  m.fillStyle = grad;
  m.fillRect(0, 0, canvas.width, canvas.height);

  for (const [dx, dy] of [[-pad, 0], [pad, 0], [0, -pad], [0, pad], [-pad, -pad], [pad, -pad], [-pad, pad], [pad, pad]]) {
    g.drawImage(mask, dx, dy);
  }
  g.drawImage(img, pad, pad, w, h);
  ctx.drawImage(canvas, x - pad, y - pad);
}

export function drawVariantSprite(ctx, img, x, y, w, h, variant) {
  if (!img || !w || !h) return;
  if (variant === 'rainbow') {
    drawRainbow(ctx, img, x, y, w, h);
    return;
  }
  if (variant === 'rgb' || variant === 'polluted') {
    ctx.save();
    if (variant === 'rgb') {
      const off = Math.max(2, Math.round(w / 48));
      ctx.filter = `drop-shadow(${off}px 0 0 rgba(255, 0, 80, .65)) drop-shadow(-${off}px 0 0 rgba(0, 220, 255, .65))`;
    } else {
      ctx.filter = 'grayscale(1) sepia(1) hue-rotate(248deg) saturate(7) brightness(.65)';
    }
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
    return;
  }
  ctx.drawImage(img, x, y, w, h);
}
