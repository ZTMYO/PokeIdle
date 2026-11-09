// 炫彩描边：单张精灵图按 3×3 源像素偏移取并集，conic-gradient 只填外圈。
// 精灵和遮罩都放在同一个 SVG 里，保证像素格完全对齐；detail / 净化演出共用。
const NS = 'http://www.w3.org/2000/svg';
let _uid = 0;

export function createRainbowSprite(src, sw, sh) {
  const width = Math.max(1, Math.round(sw || 1));
  const height = Math.max(1, Math.round(sh || 1));
  const pad = 1;
  const viewW = width + pad * 2;
  const viewH = height + pad * 2;
  const id = `rainbow-${++_uid}`;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', 'rainbow-sprite');

  const defs = document.createElementNS(NS, 'defs');
  const image = document.createElementNS(NS, 'image');
  image.setAttribute('id', `${id}-src`);
  image.setAttribute('href', src);
  image.setAttribute('width', width);
  image.setAttribute('height', height);
  image.setAttribute('preserveAspectRatio', 'none');
  image.style.imageRendering = 'pixelated';
  defs.appendChild(image);

  const mask = document.createElementNS(NS, 'mask');
  mask.setAttribute('id', `${id}-mask`);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', 0);
  mask.setAttribute('y', 0);
  mask.setAttribute('width', viewW);
  mask.setAttribute('height', viewH);
  mask.setAttribute('class', 'rainbow-mask');
  mask.style.maskType = 'alpha';
  for (let dy = -pad; dy <= pad; dy++) {
    for (let dx = -pad; dx <= pad; dx++) {
      const use = document.createElementNS(NS, 'use');
      use.setAttribute('href', `#${id}-src`);
      use.setAttribute('x', pad + dx);
      use.setAttribute('y', pad + dy);
      mask.appendChild(use);
    }
  }
  defs.appendChild(mask);
  svg.appendChild(defs);

  const band = document.createElementNS(NS, 'foreignObject');
  band.setAttribute('x', 0);
  band.setAttribute('y', 0);
  band.setAttribute('width', viewW);
  band.setAttribute('height', viewH);
  band.setAttribute('mask', `url(#${id}-mask)`);
  const fill = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  fill.setAttribute('class', 'rainbow-band-fill');
  band.appendChild(fill);
  svg.appendChild(band);

  const sprite = document.createElementNS(NS, 'use');
  sprite.setAttribute('href', `#${id}-src`);
  sprite.setAttribute('x', pad);
  sprite.setAttribute('y', pad);
  svg.appendChild(sprite);
  return svg;
}
