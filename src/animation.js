﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿// ==================== 捕捉动画函数 ====================
import { $, fitPokemonImage, getStageSize } from './ui.js';
import { currentEncounter, currentIsShiny, encounterBallsUsed } from './state.js';
import { FLEE_CHANCE, FLEE_CHANCE_INC, FLEE_CHANCE_MAX } from './config.js';

// 精灵球捕捉动画用的图片（位于 src/items/）
const BATTLE_BALLS = {
  'poke-ball': { closed: 'ball-00.png', open: 'ball-00-open.png' },
  'ultra-ball': { closed: 'ball-03.png', open: 'ball-03-open.png' },
  'master-ball': { closed: 'ball-04.png', open: 'ball-04-open.png' },
};

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
  ball.src = `./items/${state === 'open' ? info.open : info.closed}`;
}

export async function setupCatchAnim(ballType) {
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

  // 舞台基准：以屏幕内层（screenInner）真实内容区为准（首次布局后缓存，
  // 避免从设置页等切回瞬间 encounterView/screenInner 布局未稳定取到收缩值，
  // 曾实测内容区被收缩为 248×211 导致宝可梦/精灵球像素定位整体偏移）。
  // 这里同时强制 encounterView 与 catchStage 铺满舞台，保证坐标系一致
  const { w: stageW, h: stageH } = getStageSize();
  // 强制遭遇视图与动画舞台铺满舞台尺寸（inline 显式定位，不依赖 CSS inset 兼容性），
  // 使宝可梦/精灵球等绝对定位子元素的定位基准与舞台一致
  const view = $('encounterView');
  view.style.position = 'absolute';
  view.style.left = '0';
  view.style.top = '0';
  view.style.width = stageW + 'px';
  view.style.height = stageH + 'px';
  stage.style.position = 'absolute';
  stage.style.left = '0';
  stage.style.top = '0';
  stage.style.width = stageW + 'px';
  stage.style.height = stageH + 'px';

  // 等待宝可梦图片加载完成，确保获取实际尺寸
  if (!pkmn.naturalWidth || !pkmn.naturalHeight) {
    await new Promise(resolve => {
      const onLoad = () => { fitPokemonImage(pkmn); resolve(); };
      pkmn.addEventListener('load', onLoad, { once: true });
      pkmn.addEventListener('error', () => resolve(), { once: true });
      // 如果在上面的空隙间完成了加载
      if (pkmn.complete && pkmn.naturalWidth) {
        pkmn.removeEventListener('load', onLoad);
        fitPokemonImage(pkmn);
        resolve();
      }
    });
  } else {
    fitPokemonImage(pkmn);
  }

  // 宝可梦位置：动态获取图片实际尺寸
  const pkmnW = pkmn.offsetWidth || 100;
  const pkmnH = pkmn.offsetHeight || 100;
  const pkmnOrigX = stageW / 2 - pkmnW / 2;
  // CSS bottom:42% → 图片底部在 stageH * 0.58 处
  const pkmnOrigY = stageH * 0.58 - pkmnH;

  // 把宝可梦从 CSS 居中改为像素定位，供动画操纵
  // 需同时停掉 encGrow 动画（both 填充的 translateX(-50%) 会覆盖内联 transform，导致图片左移半个身位）
  pkmn.style.animation = 'none';
  pkmn.style.position = 'absolute';
  pkmn.style.left = pkmnOrigX + 'px';
  pkmn.style.top = pkmnOrigY + 'px';
  pkmn.style.transform = 'none';
  pkmn.style.opacity = '1';
  pkmn.style.zIndex = '21';

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

// 宝可梦逃跑动画：水平翻转后向中下方向平移，最终停在底部文字框右上角附近（用于宝可梦逃走场景）
export function playFleeAnim(duration = 1000) {
  const pkmn = $('encounterGif');
  if (!pkmn) return Promise.resolve();
  // 还原为 CSS 居中定位（若处于丢球动画的像素定位）
  pkmn.style.position = '';
  pkmn.style.left = '';
  pkmn.style.top = '';
  pkmn.style.animation = 'none';
  pkmn.style.zIndex = '';
  pkmn.style.transform = '';
  // 强制重排，确保 transition 从当前状态开始
  void pkmn.offsetWidth;
  // 终点：底部文字框右上角附近（水平靠右、底部贴文字框顶沿）
  const box = document.querySelector('.text-box');
  const start = pkmn.getBoundingClientRect();
  const w = pkmn.offsetWidth || start.width;
  const h = pkmn.offsetHeight || start.height;
  let dx = 40, dy = 120;
  if (box) {
    const br = box.getBoundingClientRect();
    // 图片左缘超出视口右缘至少 20px（或 20% 图片宽），确保完全跑出屏幕
    const targetX = br.right + Math.max(20, w * 0.2);
    const targetY = br.top - h + br.height * 0.3; // 底部略微压进文字框
    dx = targetX - start.left;
    dy = targetY - start.top;
  }
  // 保持水平居中的 translateX(-50%)，叠加水平翻转 + 向终点平移
  // 第一步：瞬间完成 2D 水平翻转（scaleX(-1)，不做缩放插值，避免"3D 翻转"观感）
  pkmn.style.transition = 'none';
  pkmn.style.transform = 'translateX(-50%) scaleX(-1)';
  void pkmn.offsetWidth;
  // 第二步：匀速平移到终点（不用缓动；scaleX(-1) 位于位移外层会镜像水平位移，故 dx 取负才能向右移动）
  pkmn.style.transition = `transform ${duration}ms linear`;
  pkmn.style.transform = `translateX(-50%) scaleX(-1) translate(${-dx}px, ${dy}px)`;
  // 动画结束后保持终点位置（不清理 transform），由下次 renderEncounterScene 重置，避免弹回原位
  return new Promise(resolve => setTimeout(resolve, duration));
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
  pkmn.style.zIndex = '';
  // 保持 animation:none，避免恢复 CSS 的 encGrow 放大动画（挣脱/摇晃结束后会重新从头播放）
  // 新遭遇的入场动画由 renderEncounterScene 重新启用
  pkmn.style.animation = 'none';
  // 移除丢球角色动画状态（回到默认最后一帧）
  const tc = $('animThrowChar');
  if (tc) { tc.classList.remove('throwing'); }
  // 清理精灵球残留（可能在上一次捕捉动画后未被清除）
  const ball = $('animBall');
  if (ball) {
    ball.classList.remove('visible');
    ball.style.cssText = '';
    ball.style.display = 'none';
  }
  // 强制重新计算布局，确保样式立即生效
  void pkmn.offsetHeight;
}

// 闪光白色星星粒子特效（单次爆发）
function _sparkleBurst() {
  const view = $('encounterView');
  if (!view) return;
  const gif = $('encounterGif');
  let cx, cy;
  if (gif && gif.offsetWidth > 0 && gif.offsetHeight > 0) {
    const gifRect = gif.getBoundingClientRect();
    const viewRect = view.getBoundingClientRect();
    cx = gifRect.left - viewRect.left + gifRect.width / 2;
    cy = gifRect.top - viewRect.top + gifRect.height / 2;
  } else {
    const rect = view.getBoundingClientRect();
    cx = rect.width / 2;
    cy = rect.height * 0.4;
  }
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

let _shinySparkleTimer = null;

// 开始循环闪光（间隔 ~3s 爆发一次）
export function startShinySparkleLoop() {
  stopShinySparkleLoop();
  _sparkleBurst();
  _shinySparkleTimer = setInterval(_sparkleBurst, 3000);
}

// 停止循环闪光
export function stopShinySparkleLoop() {
  if (_shinySparkleTimer) {
    clearInterval(_shinySparkleTimer);
    _shinySparkleTimer = null;
  }
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
  const { stage, ball, ballType: bt, pkmn, stars, msg, stageW, stageH, pkmnOrigX, pkmnOrigY, pkmnW, pkmnH, throwChar } = await setupCatchAnim(ballType);
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

  // 逃跑概率随丢球次数递增（encounterBallsUsed 为本次丢球后的计数）
  const fleeChance = Math.min(FLEE_CHANCE + (encounterBallsUsed - 1) * FLEE_CHANCE_INC, FLEE_CHANCE_MAX);
  if (Math.random() < fleeChance) return { result: 'fled', shakes: breakRound };
  return { result: 'continue', shakes: breakRound };
}
