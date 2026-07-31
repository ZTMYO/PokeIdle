// ===== Buff 粒子特效 (Canvas) =====
import { $ } from './ui.js';

const PARTICLE_COUNT = 12;
const BASE_SPEED = 0.2;

let canvas = null;
let ctx = null;
let particles = [];
let rafId = null;
let active = false;

function _resize() {
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  for (const p of particles) {
    p.x = Math.random() * w;
    p.y = Math.random() * h;
  }
}

function _drawStar(cx, cy, r, sharpness) {
  // sharpness: 0~1, 0=圆润, 1=尖锐
  const inner = r * (0.2 + sharpness * 0.2);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    const radius = i % 2 === 0 ? r : inner;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function _createParticles(w, h, color, shape) {
  const pts = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    pts.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -(Math.random() * 0.8 + BASE_SPEED),
      size: Math.random() * 3 + 3,
      alpha: Math.random() * 0.4 + 0.5,
      phase: Math.random() * Math.PI * 2,
      color: color || 'rgba(255, 255, 200, 1)',
      shape: shape || 'circle',
    });
  }
  return pts;
}

function _draw() {
  if (!ctx || !canvas) return;
  const isIdleView = $('idleView')?.style.display !== 'none';
  if (!isIdleView) {
    if (canvas) ctx?.clearRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
    rafId = requestAnimationFrame(_draw);
    return;
  }
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  for (const p of particles) {
    p.phase += 0.02;
    p.x += p.vx + Math.sin(p.phase) * 0.3;
    p.y += p.vy;
    p.alpha -= 0.002;

    if (p.y < -10 || p.alpha <= 0) {
      p.x = Math.random() * w;
      p.y = h + 5;
      p.alpha = Math.random() * 0.4 + 0.5;
      p.vy = -(Math.random() * 0.8 + BASE_SPEED);
    }

    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;

    if (p.shape === 'star') {
      _drawStar(p.x, p.y, p.size, 0.7);
      // Soft glow
      ctx.globalAlpha = p.alpha * 0.25;
      _drawStar(p.x, p.y, p.size * 2.5, 0.3);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      // Soft glow
      ctx.globalAlpha = p.alpha * 0.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  rafId = requestAnimationFrame(_draw);
}

export function start(color, shape) {
  if (active) return;
  const container = $('screen');
  if (!container) return;

  canvas = document.createElement('canvas');
  canvas.className = 'particles-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:9999;image-rendering:auto;';
  container.appendChild(canvas);

  const w = container.clientWidth;
  const h = container.clientHeight;
  particles = _createParticles(w, h, color || 'rgba(255,255,200,1)', shape || 'circle');
  _resize();
  active = true;
  rafId = requestAnimationFrame(_draw);
  window.addEventListener('resize', _resize);
}

export function stop() {
  active = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (canvas) {
    canvas.remove();
    canvas = null;
    ctx = null;
  }
  particles = [];
  window.removeEventListener('resize', _resize);
}
