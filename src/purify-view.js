// 净化演出：污染阶段暗，羽毛飞入后化成粒子落到宝可梦身上，闪白后背景转柔和。
// 只负责画面；存档结算在调用方确认时已经完成，这里结束时回调刷新详情。
import { itemIconSrc } from './items.js';
import { createRainbowSprite } from './rainbow-fx.js';

const CLAMP01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

export function playPurify({ host, src, sw, sh, name, onClose }) {
  if (!host || !src || !sw || !sh) { onClose && onClose(); return; }
  host.querySelector('.purify-overlay')?.remove();

  const view = document.createElement('div');
  view.className = 'purify-overlay';
  view.innerHTML = `
    <div class="purify-glow"></div>
    <div class="purify-mon-wrap">
      <img class="purify-mon fx-variant-polluted" alt="" />
      <div class="purify-rainbow"></div>
    </div>
    <img class="purify-item" alt="" />
    <canvas class="purify-fx"></canvas>
    <div class="text-box" id="purifyDone" style="display:none;transform:translateY(100%);">
      <div class="text-box-content" id="purifyDoneText"></div>
      <div class="catch-confirm-btns">
        <span class="catch-confirm-btn" id="purifyDoneOk">确定</span>
      </div>
    </div>
  `;
  host.appendChild(view);

  const mon = view.querySelector('.purify-mon');
  const rainbow = view.querySelector('.purify-rainbow');
  const item = view.querySelector('.purify-item');
  const canvas = view.querySelector('.purify-fx');
  const done = view.querySelector('#purifyDone');
  const doneText = view.querySelector('#purifyDoneText');
  const ok = view.querySelector('#purifyDoneOk');
  let closed = false;
  let raf = 0;

  const finish = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    view.remove();
    onClose && onClose();
  };
  ok.addEventListener('click', finish);

  mon.src = src;
  item.src = itemIconSrc('虹色之羽');
  doneText.textContent = `「${name || '宝可梦'}」净化成了炫彩`;

  mon.animate([{ transform: 'scale(.85)' }, { transform: 'scale(1)' }], {
    duration: 240, easing: 'ease-out', fill: 'forwards',
  });

  item.animate([
    { bottom: '12%', transform: 'scale(.35) rotate(-24deg)', opacity: 0 },
    { bottom: '42%', transform: 'scale(1.15) rotate(8deg)', opacity: 1, offset: 0.55 },
    { bottom: '50%', transform: 'scale(.5) rotate(20deg)', opacity: 0 },
  ], { duration: 900, easing: 'ease-in-out', fill: 'forwards' });

  const spawnParticles = () => {
    const viewRect = view.getBoundingClientRect();
    const monRect = mon.getBoundingClientRect();
    const W = view.clientWidth;
    const H = view.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = monRect.left - viewRect.left + monRect.width / 2;
    const cy = monRect.top - viewRect.top + monRect.height / 2;
    const colors = ['#ffd76a', '#ff9ecb', '#7fe7ff', '#b9a6ff', '#9dffcf'];
    const parts = Array.from({ length: 42 }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const spread = 18 + Math.random() * 42;
      return {
        x0: cx + (Math.random() - 0.5) * 10,
        y0: cy + (Math.random() - 0.5) * 10,
        mx: cx + Math.cos(angle) * spread,
        my: cy + Math.sin(angle) * spread,
        tx: monRect.left - viewRect.left + monRect.width * (0.18 + Math.random() * 0.64),
        ty: monRect.top - viewRect.top + monRect.height * (0.18 + Math.random() * 0.64),
        color: colors[i % colors.length],
        delay: Math.random() * 180,
        dur: 620 + Math.random() * 420,
        size: 1.2 + Math.random() * 2.2,
      };
    });
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const frame = (now) => {
      if (closed) return;
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      let alive = false;
      for (const p of parts) {
        const u = (t - p.delay) / p.dur;
        if (u < 0) { alive = true; continue; }
        if (u >= 1) continue;
        alive = true;
        const k = ease(CLAMP01(u));
        const x = (1 - k) * (1 - k) * p.x0 + 2 * (1 - k) * k * p.mx + k * k * p.tx;
        const y = (1 - k) * (1 - k) * p.y0 + 2 * (1 - k) * k * p.my + k * k * p.ty;
        const a = Math.sin(Math.PI * CLAMP01(u));
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (alive) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  };

  setTimeout(() => {
    if (closed) return;
    item.style.display = 'none';
    view.classList.add('purified');
    spawnParticles();
  }, 780);

  setTimeout(() => {
    if (closed) return;
    rainbow.appendChild(createRainbowSprite(src, sw, sh));
    rainbow.style.opacity = '1';
    mon.style.opacity = '0';
  }, 1020);

  setTimeout(() => {
    if (closed) return;
    done.style.display = 'flex';
    requestAnimationFrame(() => {
      done.classList.add('show');
      done.style.transform = 'translateY(0)';
    });
  }, 1180);
}
