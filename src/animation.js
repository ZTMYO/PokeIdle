// ==================== 捕捉动画函数 ====================
import { $, fitPokemonImage, getStageSize, tryLoadPokemonImage } from './ui.js';
import { gameData, rarityLabel } from './state.js';

// 精灵球捕捉动画用的图片（位于 src/items/）
const BATTLE_BALLS = {
  'poke-ball': { closed: 'ball-00.png', open: 'ball-00-open.png' },
  'ultra-ball': { closed: 'ball-03.png', open: 'ball-03-open.png' },
  'master-ball': { closed: 'ball-04.png', open: 'ball-04-open.png' },
};

const CATCH_LAYOUT_PROPERTIES = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height'];
let _catchLayoutSnapshot = null;

export function captureCatchLayout(view, stage) {
  if (_catchLayoutSnapshot || !view || !stage) return;
  const snapshot = element => Object.fromEntries(
    CATCH_LAYOUT_PROPERTIES.map(property => [property, element.style[property]])
  );
  _catchLayoutSnapshot = { view, stage, viewStyle: snapshot(view), stageStyle: snapshot(stage) };
}

export function restoreCatchLayout() {
  const snapshot = _catchLayoutSnapshot;
  if (!snapshot) return;
  for (const [element, styles] of [[snapshot.view, snapshot.viewStyle], [snapshot.stage, snapshot.stageStyle]]) {
    for (const property of CATCH_LAYOUT_PROPERTIES) element.style[property] = styles[property] || '';
  }
  _catchLayoutSnapshot = null;
}

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

  captureCatchLayout($('encounterView'), stage);

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

  // 宝可梦位置：动态获取图片实际尺寸。
  // 优先用适配后的内联宽高（fitPokemonImage 已写）或自然尺寸，再退到 offsetWidth；
  // 后台自动捕捉时 encounterView 处于 display:none，offsetWidth 恒为 0，落到 100 兜底
  // 会让像素定位与真实渲染尺寸不符，挣脱/摇晃动画中精灵整体偏移
  const pkmnW = parseFloat(pkmn.style.width) || pkmn.naturalWidth || pkmn.offsetWidth || 100;
  const pkmnH = parseFloat(pkmn.style.height) || pkmn.naturalHeight || pkmn.offsetHeight || 100;
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
  // 必须精确选中战斗页文本框 #textBox：项目里还有 #confirmBar 等动态 .text-box，
  // document.querySelector('.text-box') 可能命中错误节点（display:none 时 rect 全为 0），
  // 导致 dx/dy 被方向保护钳制为 20px 的小位移。
  const box = document.getElementById('textBox');
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
  if (pkmn) {
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
  }
  // 移除丢球角色动画状态（回到默认最后一帧）
  const tc = $('animThrowChar');
  if (tc) { tc.classList.remove('throwing'); }
  // 清理精灵球残留（可能在上一次捕捉动画后未被清除）
  const ball = $('animBall');
  if (ball) {
    ball.classList.remove('visible');
    ball.style.cssText = '';
    ball.style.display = 'none';
    // 捕获成功流程会把球临时移到 encounterView 保持显示；
    // 若不移回 catchStage，`.catch-stage .anim-ball` 的定位/尺寸样式会失效，
    // 下次丢球时球失去 absolute 与 40x40 尺寸，变成自然尺寸大图且坐标错乱
    const stage = $('catchStage');
    if (stage && ball.parentNode !== stage) {
      stage.appendChild(ball);
    }
  }
  restoreCatchLayout();
  // 强制重新计算布局，确保样式立即生效
  if (pkmn) void pkmn.offsetHeight;
}

// 闪光星星粒子单次爆发：围绕 view 内 target 元素中心
// opts: { cls: 额外类名, scale: 粒子尺寸与飞行距离倍率 }
function _sparkleBurst(view, target, opts) {
  if (!view || view.style.display === 'none') return;
  const scale = opts?.scale || 1;
  const cls = opts?.cls || '';
  // 以 target 中心为爆发点；target 不可见时退回 view 上部
  let cx, cy;
  if (target && target.offsetWidth > 0 && target.offsetHeight > 0) {
    const tr = target.getBoundingClientRect();
    const vr = view.getBoundingClientRect();
    cx = tr.left - vr.left + tr.width / 2;
    cy = tr.top - vr.top + tr.height / 2;
  } else {
    const rect = view.getBoundingClientRect();
    cx = rect.width / 2;
    cy = rect.height * 0.4;
  }
  const count = 10;
  const particles = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'shiny-sparkle' + (cls ? ' ' + cls : '');
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    view.appendChild(el);
    const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.4;
    const dist = (25 + Math.random() * 40) * scale;
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
  _sparkleBurst($('encounterView'), $('encounterGif'));
  _shinySparkleTimer = setInterval(() => _sparkleBurst($('encounterView'), $('encounterGif')), 3000);
}

// 指定 view 内围绕 target 循环闪光（供个体详情页等复用）
export function startShinySparkleOn(view, target, opts) {
  stopShinySparkleLoop();
  _sparkleBurst(view, target, opts);
  _shinySparkleTimer = setInterval(() => _sparkleBurst(view, target, opts), 3000);
}

// 单次闪光爆发（战斗出场用：闪一下就停，不循环）
export function burstShinySparkle(view, target, opts) {
  _sparkleBurst(view, target, opts);
}

// 停止循环闪光
export function stopShinySparkleLoop() {
  if (_shinySparkleTimer) {
    clearInterval(_shinySparkleTimer);
    _shinySparkleTimer = null;
  }
}

// 告别场景（放生 / 提交悬赏复用）：确认框询问，确认后播放图标缩小动画并显示「再见！xxx」
// confirmText：可选，确认动画第二阶段展示的文本（字符串或返回字符串的函数；缺省为「再见！xxx」）
// poolText：可选，宝可梦隐藏后在其原位置展示的文本（字符串或函数），与 confirmText 一同在动画结束后显示
// twoStep：可选，启用两阶段展示——确认后先显示「再见！xxx」+ 缩小动画，动画结束后自动切换 confirmText 并结束
// title：可选，场景打开时接管顶部 appTitle 显示该标题，点击标题等同于取消（关闭场景时自动恢复原标题）
let _savedTitle = null; // 被接管前的 appTitle 状态
export function showGoodbyeConfirm({ poke, prompt, onConfirm, onCancel, shiny = false, nick = '', confirmText = null, poolText = null, twoStep = false, title = null }) {    
  const view = $('goodbyeView');
  if (!poke || !view) { onConfirm && onConfirm(); return; }
  if (view._busy) return;
  view._busy = true;
  const img = view.querySelector('.goodbye-scene-img');
  const textEl = view.querySelector('.goodbye-box-text');
  const okBtn = view.querySelector('[data-goodbye-ok]');
  const cancelBtn = view.querySelector('[data-goodbye-cancel]');
  const arrow = view.querySelector('[data-goodbye-arrow]');
  // 重置场景：移除 leaving/arrive 重播入场动画、清空旧图、还原按钮文案、隐藏箭头与池子数值
  img.classList.remove('leaving');
  img.classList.remove('arrive');
  okBtn.textContent = '确定';
  cancelBtn.textContent = '取消';
  if (arrow) arrow.style.display = 'none';
  const poolEl = view.querySelector('#goodbyeXpPool');
  if (poolEl) poolEl.style.display = 'none';
  img.src = '';
  // 先显示场景再加载图片：隐藏状态下中文路径直接加载会失败（WebView2）
  textEl.textContent = prompt; 
  okBtn.style.display = '';
  cancelBtn.style.display = '';
  view.style.display = 'flex';
  // 接管顶部标题：显示 title，点击等同于取消（仅询问阶段可取消，动画播放中忽略）
  if (title) {
    const t = $('appTitle');
    if (t) {
      _savedTitle = { html: t.innerHTML, action: t.dataset.action || '', onclick: t.onclick };
      t.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> ' + title;
      t.dataset.action = 'back';
      t.onclick = () => {
        if (okBtn.style.display === 'none') return; // 已确认进入动画，忽略点击
        finish(false);
      };
    }
  }
  // 后缀必须显式传入，否则文件名会拼入 undefined 导致加载失败
  tryLoadPokemonImage(img, poke, shiny ? '_shiny' : '');

  const finish = (ok) => {
    // 关闭场景时恢复被接管的 appTitle
    if (_savedTitle) {
      const t = $('appTitle');
      if (t) {
        t.innerHTML = _savedTitle.html;
        t.dataset.action = _savedTitle.action;
        t.onclick = _savedTitle.onclick;
      }
      _savedTitle = null;
    }
    view.style.display = 'none';
    view._busy = false;
    ok ? onConfirm && onConfirm() : onCancel && onCancel();
  };
  okBtn.onclick = () => {
    // 确认：图标缩小淡出 + 文案「再见！xxx」
    textEl.textContent = `再见！${nick || poke.name}`;
    okBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    img.classList.add('leaving');
    if (twoStep) {
      // 两阶段：宝可梦隐藏动画（1.2s + 0.15s 延迟）播完后自动切换为 confirmText，无需点击箭头
      arrow.style.display = 'none';
      setTimeout(async () => {
        // 先结算 confirmText（可能累加经验池并产出糖果），再读取池子数值展示在原宝可梦位置
        textEl.textContent = confirmText != null
          ? (typeof confirmText === 'function' ? confirmText() : confirmText)
          : `再见！${nick || poke.name}`;
        const poolWrap = view.querySelector('#goodbyeXpPool');
        if (poolWrap) {
          const pool = poolText != null ? (typeof poolText === 'function' ? poolText() : poolText) : null;
          if (pool && typeof pool === 'object') {
            // 进度条 + 数字滚动（同经验糖果页样式）；攒满产糖时先滚满 → 弹出糖果 → 清零后从 0 重新累积
            const fill = view.querySelector('#goodbyeXpFill');
            const poolTextEl = view.querySelector('#goodbyeXpText');
            const candyEl = view.querySelector('#goodbyeXpCandy');
            const before = pool.before || 0;
            const after = pool.after || 0;
            const max = pool.max || 1;
            const candies = pool.candies || 0;
            const pct = (v) => Math.min(100, Math.max(0, (v / max) * 100));
            const setVal = (v) => {
              if (fill) fill.style.width = pct(v) + '%';
              if (poolTextEl) poolTextEl.textContent = `经验池 ${v} / ${max}`;
            };
            if (fill) fill.style.transition = 'none'; // 逐帧动画期间禁用 CSS transition，避免滞后
            if (candyEl) candyEl.style.display = 'none';
            setVal(before);
            poolWrap.style.display = 'flex';
            if (candies > 0) {
              // 阶段1：从旧值滚到满
              await animate(700, t => {
                const e = 1 - Math.pow(1 - t, 3); // easeOutCubic：先快后慢
                setVal(Math.round(before + (max - before) * e));
              });
              // 阶段2：弹出糖果图标（display 切换会重播弹入动画）
              if (candyEl) candyEl.style.display = 'block';
              await delay(900);
              // 阶段3：图标隐藏，清零后从 0 重新累积到余数
              if (candyEl) candyEl.style.display = 'none';
              setVal(0);
              await animate(600, t => {
                const e = 1 - Math.pow(1 - t, 3);
                setVal(Math.round(after * e));
              });
            } else {
              // 未产糖：直接从旧值滚到新值
              await animate(900, t => {
                const e = 1 - Math.pow(1 - t, 3);
                setVal(Math.round(before + (after - before) * e));
              });
            }
            if (fill) fill.style.transition = '';
          } else if (pool != null) {
            poolWrap.style.display = 'flex';
            const poolTextEl = view.querySelector('#goodbyeXpText');
            if (poolTextEl) poolTextEl.textContent = pool;
          }
        }
        okBtn.textContent = '确定';
        okBtn.style.display = '';
        okBtn.onclick = () => finish(true);
      }, 1400);
      return;
    }
    setTimeout(() => finish(true), 1600);
  };
  cancelBtn.onclick = () => finish(false);
}

// 交换第二阶段：收到的宝可梦从小放大显示，右上角精简信息（已捕获/新发现/稀有度），
// 底部文案分两步询问是否查看仓库详情（与抓捕成功一致：展示 → 点继续 → 询问）
export function showTradeReceive({ poke, shiny = false, isNew = false, wasOwned = false, onYes, onClose }) {
  const view = $('goodbyeView');
  if (!view || view._busy || !poke) { onClose && onClose(); return; }
  view._busy = true;
  const img = view.querySelector('.goodbye-scene-img');
  const textEl = view.querySelector('.goodbye-box-text');
  const okBtn = view.querySelector('[data-goodbye-ok]');
  const cancelBtn = view.querySelector('[data-goodbye-cancel]');
  const arrow = view.querySelector('[data-goodbye-arrow]');
  const right = view.querySelector('#goodbyeRight');
  // 重置场景：移除 leaving、重播从小放大入场动画、清空旧图、隐藏按钮
  img.classList.remove('leaving');
  img.classList.add('arrive');
  img.src = '';
  textEl.textContent = '';
  view.style.display = 'flex';
  // 右上角精简信息：已捕获图标（按交换前判定）/ 新发现 / 稀有度
  if (right) {
    const ownedWrap = right.querySelector('.encounter-owned-wrap');
    const tipEl = right.querySelector('.encounter-tooltip');
    const rarityEl = right.querySelector('.encounter-catch-rate');
    const newLabel = right.querySelector('.encounter-new-label');
    right.style.display = '';
    if (ownedWrap) ownedWrap.style.display = wasOwned ? '' : 'none';
    if (tipEl) {
      const logs = (gameData.encounterLogs || {})[String(poke.index)] || [];
      const first = logs.find(l => l.result === 'caught' && !!l.shiny === shiny);
      if (first && first.time) {
        const d = new Date(first.time);
        const pad = n => String(n).padStart(2, '0');
        tipEl.textContent = `首次捕获：${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } else {
        tipEl.textContent = '首次捕获：较早前';
      }
    }
    if (rarityEl) rarityEl.textContent = '稀有度 ' + rarityLabel(poke.rarity ?? 0.5);
    if (newLabel) newLabel.style.display = isNew ? '' : 'none';
  }
  // 后缀必须显式传入，否则文件名会拼入 undefined 导致加载失败
  tryLoadPokemonImage(img, poke, shiny ? '_shiny' : '');
  // 第一步：展示获得的宝可梦 + 底部倒三角箭头（与抓捕成功同款），点击进入下一步
  textEl.textContent = `交换获得 ${poke.name}！`;
  okBtn.style.display = 'none';
  cancelBtn.style.display = 'none';
  arrow.style.display = 'flex';
  arrow.onclick = () => {
    // 第二步：询问是否查看仓库详情
    textEl.textContent = '是否查看该宝可梦的详情？';
    arrow.style.display = 'none';
    okBtn.textContent = '确定';
    cancelBtn.textContent = '取消';
    okBtn.style.display = '';
    cancelBtn.style.display = '';
    const close = () => {
      img.classList.remove('arrive');
      view.style.display = 'none';
      view._busy = false;
      if (right) right.style.display = 'none';
    };
    okBtn.onclick = () => { close(); onYes && onYes(); };
    cancelBtn.onclick = () => { close(); onClose && onClose(); };
  };
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

  pkmn.style.transform = 'none';
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
export async function playCatchSequence(ballType, outcome, breakRound) {
  let stage, ball, bt, pkmn, stars, msg, stageW, stageH, pkmnOrigX, pkmnOrigY, pkmnW, pkmnH, throwChar;
  try {
    const anim = await setupCatchAnim(ballType);
    ({ stage, ball, ballType: bt, pkmn, stars, msg, stageW, stageH, pkmnOrigX, pkmnOrigY, pkmnW, pkmnH, throwChar } = anim);
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

  // ---- 阶段4：摇晃判定（结果已由调用方 throwBall 提前判定，这里只做展示）----
  if (outcome === 'caught') {
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
    if (ballType === 'master-ball') return { result: 'caught', shakes: 0, master: true };
    return { result: 'caught', shakes: 3, master: false };
  }

  // 捕获失败：breakRound 已由调用方（throwBall 丢球瞬间）随机生成
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

  // 是否逃跑也已由调用方提前判定
  if (outcome === 'fled') return { result: 'fled', shakes: breakRound };
  return { result: 'continue', shakes: breakRound };
  } finally {
    stage?.classList.remove('active');
    restoreCatchAnim();
  }
}
