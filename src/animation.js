﻿﻿﻿﻿﻿﻿// ==================== 捕捉动画函数 ====================
import { $ } from './ui.js';
import { currentEncounter, currentIsShiny } from './state.js';
import { BATTLE_BALLS, FLEE_CHANCE } from './config.js';

export function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export function animate(duration, fn) {
  return new Promise(resolve => {
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      fn(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

// 切换球图片 open/closed
function setBallImage(ball, ballType, state) {
  const info = BATTLE_BALLS[ballType];
  if (!info) return;
  ball.src = `./icons/${state === 'open' ? info.open : info.closed}`;
}

export function setupCatchAnim(ballType) {
  const stage = $('catchStage');
  const ball = $('animBall');
  const stars = $('animStars');
  const msg = $('animMsg');
  const pkmn = $('encounterGif');
  const throwChar = $('animThrowChar');

  // 设置球种图片（初始为 closed）
  setBallImage(ball, ballType, 'closed');

  // 重置丢球角色（始终可见，移除丢球动画状态）
  throwChar.classList.remove('throwing');

  // 先用 encounterView 获取尺寸（stage 初始 display:none，取不到尺寸）
  const encRect = $('encounterView').getBoundingClientRect();
  const stageW = encRect.width;
  const stageH = encRect.height;

  // 宝可梦位置：动态获取图片实际尺寸
  const pkmnW = pkmn.offsetWidth || 100;
  const pkmnH = pkmn.offsetHeight || 100;
  const pkmnOrigX = stageW / 2 - pkmnW / 2;
  const pkmnOrigY = stageH * 0.3 - pkmnH / 2;

  // 把宝可梦从 CSS 居中改为像素定位，供动画操纵
  pkmn.style.position = 'absolute';
  pkmn.style.left = pkmnOrigX + 'px';
  pkmn.style.top = pkmnOrigY + 'px';
  pkmn.style.transform = 'none';
  pkmn.style.opacity = '1';

  // 重置球
  ball.className = 'anim-ball';
  ball.style.cssText = '';
  ball.style.left = '0px';
  ball.style.top = '0px';

  stars.innerHTML = '';
  msg.className = 'catch-msg';
  msg.textContent = '';

  stage.classList.add('active');

  return { stage, ball, ballType, pkmn, stars, msg, stageW, stageH, pkmnOrigX, pkmnOrigY, pkmnW, pkmnH, throwChar };
}

export function restoreCatchAnim() {
  const pkmn = $('encounterGif');
  if (!pkmn) return;
  // 清除动画中的像素定位，恢复为 CSS 居中
  pkmn.style.position = '';
  pkmn.style.left = '';
  pkmn.style.top = '';
  pkmn.style.transform = '';
  pkmn.style.opacity = '';
  // 移除丢球角色动画状态（回到默认最后一帧）
  const tc = $('animThrowChar');
  if (tc) { tc.classList.remove('throwing'); }
  // 强制重新计算布局，确保样式立即生效
  void pkmn.offsetHeight;
}

// 闪光出场白色星星粒子特效
export function playShinySparkle() {
  const view = $('encounterView');
  if (!view) return;
  const rect = view.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height * 0.4;
  const count = 10;
  const particles = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'shiny-sparkle';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    view.appendChild(el);
    const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.4;
    const dist = 25 + Math.random() * 40;
    particles.push({ el, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, delay: Math.random() * 0.12 });
  }
  const startT = performance.now();
  const duration = 700;
  function frame(now) {
    const t = Math.min((now - startT) / duration, 1);
    for (const p of particles) {
      const pt = Math.max(0, Math.min(1, (t - p.delay / (duration / 1000)) / (1 - p.delay / (duration / 1000))));
      if (pt <= 0) { p.el.style.opacity = '0'; continue; }
      const ease = 1 - Math.pow(1 - pt, 3);
      const x = p.dx * ease;
      const y = p.dy * ease;
      const scale = pt < 0.25 ? pt / 0.25 * 1.3 : 1.3 - (pt - 0.25) / 0.75 * 1.3;
      const opacity = pt < 0.6 ? 1 : 1 - (pt - 0.6) / 0.4;
      p.el.style.transform = `translate(${x}px, ${y}px) scale(${Math.max(0, scale)})`;
      p.el.style.opacity = Math.max(0, opacity);
    }
    if (t < 1) requestAnimationFrame(frame);
    else particles.forEach(p => p.el.remove());
  }
  requestAnimationFrame(frame);
}

// === 阶段1：抛物线抛球 ===
export async function animThrow(stage, ball, ballType, stageW, stageH, pkmnOrigY, throwChar) {
  const ballSize = 40;
  throwChar.classList.add('throwing');

  // 帧1
  ball.classList.add('visible');
  ball.style.width = '22px';
  ball.style.height = '22px';
  ball.style.left = '-3px';
  ball.style.top = (stageH - 86) + 'px';
  await delay(150);

  // 帧2
  ball.style.left = '2px';
  ball.style.top = (stageH - 100) + 'px';
  await delay(150);

  // 帧3
  ball.style.width = '40px';
  ball.style.height = '40px';
  ball.style.top = (stageH - 120) + 'px';

  const startX = 14;
  const startY = stageH - 120;
  const endX = stageW / 2 - ballSize / 2;
  const endY = Math.min(stageH * 0.18, (pkmnOrigY || stageH * 0.15) - 20);
  const peak = 60;

  await animate(350, t => {
    const x = startX + (endX - startX) * t;
    const y = startY + (endY - startY) * t - 4 * peak * t * (1 - t);
    ball.style.left = x + 'px';
    ball.style.top = y + 'px';
  });

  setBallImage(ball, ballType, 'open');
}

// === 阶段2：宝可梦吸收入球 ===
async function animAbsorb(pkmn, pkmnCX, pkmnCY, ballCX, ballCY) {
  // 宝可梦朝向球的位置收缩
  const dx = ballCX - pkmnCX;
  const dy = ballCY - pkmnCY;

  await animate(500, t => {
    // ease-in 加速收缩
    const ease = t * t;
    const scale = 1 - ease;
    pkmn.style.transform = `translate(${dx * ease}px, ${dy * ease}px) scale(${Math.max(scale, 0)})`;
    if (t > 0.85) pkmn.style.opacity = '0';
  });
  pkmn.style.opacity = '0';
  pkmn.style.transform = `translate(${dx}px, ${dy}px) scale(0)`;
}

// === 阶段3：精灵球垂直下坠 + 弹跳2次 ===
async function animFallAndBounce(ball, ballType, fromY, groundY) {
  // 吸收完毕 → 合上球
  setBallImage(ball, ballType, 'closed');

  // 下坠
  ball.style.transform = 'none';
  await animate(300, t => {
    const ease = t * t; // 加速下落
    ball.style.top = (fromY + (groundY - fromY) * ease) + 'px';
  });

  // 连续弹跳 2 次
  await animate(700, t => {
    let bounceY = 0;
    if (t < 0.35) {
      const p = t / 0.35;
      bounceY = -42 * Math.sin(p * Math.PI);
    } else if (t < 0.65) {
      const p = (t - 0.35) / 0.30;
      bounceY = -18 * Math.sin(p * Math.PI);
    } else if (t < 0.85) {
      const p = (t - 0.65) / 0.20;
      bounceY = -5 * Math.sin(p * Math.PI);
    }
    ball.style.transform = `translateY(${bounceY}px)`;
  });
  ball.style.transform = 'none';
}

// === 阶段4：单轮摇晃（向右或向左带惯性过头） ===
async function animShakeRound(ball, dir) {
  // dir: 1 向右摆, -1 向左摆
  ball.style.animation = 'none';
  void ball.offsetHeight;
  ball.style.animation = dir > 0 ? 'ballSwingRight 0.5s ease-in-out' : 'ballSwingLeft 0.5s ease-in-out';
  await delay(500);
  ball.style.animation = 'none';
}

// === 分支1：捕捉失败 — 球张开 → 宝可梦重现 → 球消失 ===
async function animBreakFree(ball, ballType, pkmn, ballCX, ballCY, pkmnOrigX, pkmnOrigY) {
  // 1. 球张开释放宝可梦
  setBallImage(ball, ballType, 'open');

  // 2. 宝可梦从球位置逐渐放大出现（球保持可见）
  pkmn.style.opacity = '1';
  const startX = ballCX - pkmnOrigX;
  const startY = ballCY - pkmnOrigY;
  pkmn.style.transform = `translate(${startX}px, ${startY}px) scale(0.2)`;

  await animate(500, t => {
    const ease = 1 - Math.pow(1 - t, 2);
    const sx = startX - startX * ease;
    const sy = startY - startY * ease;
    const sc = 0.2 + 0.8 * ease;
    pkmn.style.transform = `translate(${sx}px, ${sy}px) scale(${sc})`;
  });

  // 3. 宝可梦完全显现后，球渐隐消失
  ball.style.transform = 'none';
  await animate(300, t => {
    ball.style.opacity = 1 - t;
  });
  ball.style.display = 'none';

  // 4. 恢复像素定位
  pkmn.style.transform = 'none';
  pkmn.style.left = pkmnOrigX + 'px';
  pkmn.style.top = pkmnOrigY + 'px';
}

// === 分支2：捕捉成功 — 锁球反馈 + 黄色星星 + 球消失 ===
async function animCatchSuccess(ball, starsContainer, ballCX, ballCY) {
  // 锁球：无放大效果
  ball.style.transform = 'scale(1)';

  // 从精灵球上方飞出4颗星，抛物线落下渐隐
  const starOriginX = ballCX + 12;
  const starOriginY = ballCY - 8;
  const angles = [-Math.PI / 3, -Math.PI / 9, Math.PI / 9, Math.PI / 3];

  for (const angle of angles) {
    const star = document.createElement('div');
    star.className = 'star-particle';
    star.style.left = starOriginX + 'px';
    star.style.top = starOriginY + 'px';
    starsContainer.appendChild(star);

    const dist = 30 + Math.random() * 10;
    const dx = Math.sin(angle) * dist;
    const dy = -Math.cos(angle) * dist - 15;

    animate(550, t => {
      const fall = 60 * t * t;
      const x = dx * t;
      const y = dy * t + fall;
      star.style.transform = `translate(${x}px, ${y}px)`;
      star.style.opacity = 1 - Math.pow(t, 1.5);
    });
  }

  // 等待星星动画完成
  await delay(700);

  // 清除星星
  await delay(200);
  starsContainer.innerHTML = '';
}

// === 动画序列编排 ===
export async function playCatchSequence(ballType, isCaught) {
  const { stage, ball, ballType: bt, pkmn, stars, msg, stageW, stageH, pkmnOrigX, pkmnOrigY, pkmnW, pkmnH, throwChar } = setupCatchAnim(ballType);
  await delay(50);

  // ---- 阶段1：抛球 ----
  await animThrow(stage, ball, bt, stageW, stageH, pkmnOrigY, throwChar);

  // ---- 阶段2：吸收 ----
  const ballCX = parseFloat(ball.style.left);
  const ballCY = parseFloat(ball.style.top);
  const pkmnCX = pkmnOrigX + pkmnW / 2;
  const pkmnCY = pkmnOrigY + pkmnH / 2;

  await animAbsorb(pkmn, pkmnCX, pkmnCY, ballCX + 12, ballCY + 12);

  // ---- 阶段3：下坠 + 弹跳（球落到屏幕统一位置）----
  const groundY = stageH * 0.38; // 统一降落点（上移）
  await animFallAndBounce(ball, bt, ballCY, groundY);

  // ---- 阶段4：摇晃判定 ----
  if (isCaught) {
    // 大师球 100% 捕获，跳过摇晃
    if (ballType === 'master-ball') {
      await delay(200);
    } else {
      // 捕获成功：完整3轮摇晃
      for (let r = 1; r <= 3; r++) {
        await animShakeRound(ball, r % 2 === 0 ? -1 : 1);
        if (r < 3) await delay(350);
      }
      await delay(400);
    }
    await animCatchSuccess(ball, stars, parseFloat(ball.style.left), groundY);
    // 隐藏宝可梦图片
    pkmn.style.display = 'none';
    // 把球移到 encounterView 保持显示
    ball.remove();
    ball.style.position = 'absolute';
    ball.style.width = '40px';
    ball.style.height = '40px';
    ball.style.objectFit = 'contain';
    ball.style.imageRendering = 'pixelated';
    ball.style.zIndex = '25';
    ball.style.pointerEvents = 'none';
    $('encounterView').appendChild(ball);
    stage.classList.remove('active');
    restoreCatchAnim();
    if (ballType === 'master-ball') return { result: 'caught', shakes: 0, master: true };
    return { result: 'caught', shakes: 3, master: false };
  }

  // 捕获失败：0~3 轮摇晃后挣脱
  const breakRound = Math.random() < 0.3 ? 0 : (Math.random() < 0.4 ? 1 : (Math.random() < 0.6 ? 2 : 3));

  for (let r = 1; r <= breakRound; r++) {
    await animShakeRound(ball, r % 2 === 0 ? -1 : 1);
    if (r < breakRound) await delay(350);
  }
  if (breakRound > 0) await delay(350); // 最后一摇后停顿再挣脱

  // 使用球的当前位置（落地后），不是过时的最高点坐标
  const curBallCX = parseFloat(ball.style.left) + 20;
  const curBallCY = parseFloat(ball.style.top) + 20;
  // 挣脱动画
  await animBreakFree(ball, bt, pkmn,
    curBallCX, curBallCY,
    pkmnOrigX + pkmnW / 2, pkmnOrigY + pkmnH / 2);

  stage.classList.remove('active');
  restoreCatchAnim();

  if (Math.random() < FLEE_CHANCE) return { result: 'fled', shakes: breakRound };
  return { result: 'continue', shakes: breakRound };
}
