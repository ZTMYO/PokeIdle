// ===== 开场剧情（首次进入游戏） =====
// 流程：选择角色 → 主角与小田卷正面碰上（主角左、小田卷右，面对面停住）→ 底部文字框逐句剧情 → 小田卷询问 → 点击确定开始
// 开场完成前不保存 introDone，中途退出下次进入需重新播放
import { $, showView, applyCharSprites } from './ui.js';
import { gameData } from './state.js';
import { playIntro } from './audio.js';

// 故事背景以及小田卷的台词
const SCRIPT = [
  "距离那场丰缘的冒险，已然过了许多年。",
  "好久不见，老朋友，我是小田卷博士。",
  "当初多亏了你，丰缘的图鉴才圆满收官。",
  "可整个宝可梦世界，远比丰缘更加辽阔。",
  "如今九大地区已连通，跨地区不再困难，",
  "这为收集宝可梦全图鉴创造了绝佳条件！",
  "再次开启旅行如何？昔日的冠军。",
  "考虑到你要辗转各地长途旅行，",
  "我准备了一台特制手机送给你。",
  "既能导航、查阅图鉴，还能管理宝可梦。",
  "内置帮助APP，随时可以查看使用教程。",
];
const ASK_LINE = '准备好了吗？这就出发吧！';
const PHONE_LINE = SCRIPT.findIndex(l => l.includes('特制手机')) + 1;
const CHOICE_LINE = SCRIPT.findIndex(l => l.includes('再次开启旅行如何')) + 1;

// ===== tile 场景=====
const SCENE_TILESET = './terrain/terrain-tileset.png';
const SCENE_TILE = 24;
const SCENE_SRC = 16;
const INTRO_SCENE = {
  width: 11,
  height: 11,
  tiles: [
    [[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]],
    [[1,0],[67,2],[5,1],[5,1],[1,0],[1,0],[67,2],[69,1],[1,0],[5,1],[69,1]],
    [[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41],[1,41]],
    [[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]],
    [[1,0],[0,1],[1,1],[2,1],[1,0],[1,0],[1,0],[0,9],[1,9],[2,9],[3,9]],
    [[1,0],[0,2],[1,2],[2,2],[1,0],[1,0],[1,0],[0,10],[1,10],[2,10],[3,10]],
    [[4,0],[0,3],[1,3],[2,3],[1,0],[1,0],[1,0],[0,11],[1,11],[2,11],[3,11]],
    [[4,0],[0,4],[1,4],[2,4],[3,0],[1,0],[1,0],[0,12],[1,12],[2,12],[3,12]],
    [[1,0],[4,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]],
    [[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]],
    [[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]],
  ],
};
let _sceneImg = null;      // 瓦片图缓存
let _sceneImgPromise = null;

function _loadSceneTileset() {
  if (_sceneImg) return Promise.resolve(_sceneImg);
  if (_sceneImgPromise) return _sceneImgPromise;
  _sceneImgPromise = new Promise(resolve => {
    const img = new Image();
    img.onload = () => { _sceneImg = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = SCENE_TILESET;
  });
  return _sceneImgPromise;
}

// 渲染 tile 场景：10×8 地图横向重复铺满宽度，底部路径带对齐角色脚底（bottom 24%）
function renderTileScene() {
  let cv = $('introSceneCanvas');
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = 'introSceneCanvas';
    $('introStage').appendChild(cv);
  }
  _loadSceneTileset().then(img => {
    if (!img) return;
    const stage = $('introStage');
    const w = stage.clientWidth || cv.parentElement.clientWidth || 600;
    const h = SCENE_TILE * INTRO_SCENE.height;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const tiles = INTRO_SCENE.tiles;
    const pw = INTRO_SCENE.width * SCENE_TILE;
    const copies = Math.ceil(w / pw) + 1;
    for (let i = 0; i < copies; i++) {
      const ox = i * pw;
      for (let r = 0; r < tiles.length; r++) {
        const row = tiles[r];
        for (let c = 0; c < row.length; c++) {
          const t = row[c];
          if (!t) continue;
          ctx.drawImage(img, t[0] * SCENE_SRC, t[1] * SCENE_SRC, SCENE_SRC, SCENE_SRC,
                        ox + c * SCENE_TILE, r * SCENE_TILE, SCENE_TILE, SCENE_TILE);
        }
      }
    }
    const iv = $('introView');
    const feet = iv.clientHeight * 0.24;
    cv.style.bottom = Math.max(56, feet - 16) + 'px';
  });
}

let _onDone = null;
let _step = 0; // 0=选角色；1..SCRIPT.length=逐句剧情；之后为询问句
let _choiceOpen = false; // 询问句按钮已显示（替代三角箭头）

export function startIntro(onDone) {
  _onDone = onDone;
  _step = 0;
  _choiceOpen = false;
  const iv = $('introView');
  // 角色直接贴在背景草地上，无容器框
  iv.innerHTML = `
    <div class="intro-stage" id="introStage">
      <div class="intro-title">选择你的角色</div>
      <button class="intro-pick-btn" data-gender="brendan"><img src="./character/brendan-front.png" alt="" /><span>小悠</span></button>
      <button class="intro-pick-btn" data-gender="may"><img src="./character/may-front.png" alt="" /><span>小遥</span></button>
      <div class="intro-player-wrap" id="introPlayerWrap"><div class="intro-player" id="introPlayer"></div></div>
      <div class="intro-birch-wrap" id="introBirchWrap"><div class="intro-birch" id="introBirch"></div></div>
    </div>
  `;
  iv.querySelectorAll('.intro-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => chooseGender(btn.dataset.gender));
  });
  showView('introView');
  showIntroText('欢迎来到宝可梦的世界！选择你的角色。', false, true);
}

function chooseGender(g) {
  gameData.settings.gender = g;
  applyCharSprites();
  $('introPlayer').style.backgroundImage = `url('./character/${g}-walk.png')`;
  document.querySelectorAll('.intro-title, .intro-pick-btn').forEach(el => { el.style.display = 'none'; });
  playIntro(); // 选完主角进入剧情 → 未白镇开场曲起播（首次进入无 splash，剧情即起播）
  _step = 1;
  renderTileScene();
  showIntroText(SCRIPT[0], false, true);
  playerEnter();
}

// 主角从屏幕外左侧走入，到位停稳后才显示第一句台词与继续按钮
function playerEnter() {
  const wrap = $('introPlayerWrap');
  const p = $('introPlayer');
  wrap.style.opacity = '1';
  // 从左侧屏幕外走入（播放 walk 帧动画，匀速），到位后停在站立帧
  wrap.style.transition = 'none';
  wrap.style.transform = 'translateX(-150px)';
  p.style.animation = 'brendanWalk 0.6s steps(1) infinite';
  p.style.backgroundPosition = '';
  void wrap.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    wrap.style.transition = 'transform 1.1s linear';
    wrap.style.transform = 'translateX(0)';
  }));
  setTimeout(() => {
    p.style.animation = 'none';
    p.style.backgroundPosition = '75% 0';
    // 主角停稳后，显示继续按钮
    $('textBoxArrow').style.display = 'flex';
  }, 1150);
}

// 小田卷从右侧跑入到右侧停稳；主角已先原地现身
function enterScene() {
  const player = $('introPlayerWrap');
  const wrap = $('introBirchWrap');
  $('textBoxArrow').style.display = 'none';
  player.style.opacity = '1';
  wrap.style.opacity = '1';
  wrap.style.transition = 'none';
  wrap.style.transform = 'translateX(150px)';
  const b = $('introBirch');
  b.style.animation = 'brendanWalk 0.6s steps(1) infinite';
  b.style.backgroundPosition = '';
  void wrap.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    wrap.style.transition = 'transform 1.1s linear';
    wrap.style.transform = 'translateX(0)';
  }));
  setTimeout(() => {
    b.style.animation = 'none';
    b.style.backgroundPosition = '75% 0';
    // 小田卷停稳后，推进到下一句台词
    showNextLine();
  }, 1150);
}

function showIntroText(text, done, instant) {
  const box = $('textBox');
  $('textBoxContent').textContent = '';
  $('textBoxArrow').style.display = 'none';
  if (box.classList.contains('show')) {
    startType(text, done, instant);
    return;
  }
  box.style.display = 'flex';
  box.style.transform = 'translateY(100%)';
  void box.offsetHeight;
  box.classList.add('show');
  box.style.transform = 'translateY(0)';
  startType(text, done, instant);
}

let _typeTimer = null; // 打字机定时器
let _typeFull = null;  // 当前打字中的完整文案 { text, done }

// 打字机逐字显示，全部打完才显示继续箭头；instant=true 时整句直接显示（不逐字）
function startType(text, done, instant) {
  if (_typeTimer) clearInterval(_typeTimer);
  const content = $('textBoxContent');
  _typeFull = { text, done };
  content.textContent = '';
  if (instant) {
    content.textContent = text;
    _typeTimer = null;
    _typeFull = null;
    if (done === true) $('textBoxArrow').style.display = 'flex';
    else if (typeof done === 'function') done();
    return;
  }
  let i = 0;
  _typeTimer = setInterval(() => {
    i++;
    content.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(_typeTimer);
      _typeTimer = null;
      _typeFull = null;
      if (done === true) $('textBoxArrow').style.display = 'flex';
      else if (typeof done === 'function') done();
    }
  }, 40);
}

// 点击时若仍在打字：立即补全整句并亮出箭头，但不推进剧情
function finishType() {
  if (!_typeTimer) return;
  clearInterval(_typeTimer);
  _typeTimer = null;
  const full = _typeFull;
  _typeFull = null;
  if (full) {
    $('textBoxContent').textContent = full.text;
    if (full.done === true) $('textBoxArrow').style.display = 'flex';
    else if (typeof full.done === 'function') full.done();
  }
}

function hideIntroText() {
  if (_typeTimer) clearInterval(_typeTimer);
  _typeTimer = null;
  _typeFull = null;
  $('textBox').classList.remove('show');
  $('textBox').style.transform = 'translateY(100%)';
  $('textBox').style.display = 'none';
  $('textBoxArrow').style.display = 'none';
}

function showNextLine() {
  if (_step > SCRIPT.length + 1) return;
  if (_step <= SCRIPT.length) {
    if (_step === CHOICE_LINE) {
      showIntroText(SCRIPT[_step - 1], () => {
        _choiceOpen = true;
        $('confirmYes').textContent = '好！';
        $('confirmNo').style.display = 'none';
        $('catchConfirmBtns').style.display = 'flex';
      });
    } else if (_step === PHONE_LINE) {
      showIntroText(SCRIPT[_step - 1], false);
      birchStepForward();
    } else {
      showIntroText(SCRIPT[_step - 1], true);
    }
  } else {
    showIntroText(ASK_LINE, false);
    $('confirmYes').textContent = '准备好了';
    $('confirmNo').style.display = 'none';
    $('catchConfirmBtns').style.display = 'flex';
  }
  _step++;
}

function birchStepForward() {
  const wrap = $('introBirchWrap');
  const b = $('introBirch');
  b.style.animation = 'brendanWalk 0.6s steps(1) infinite';
  b.style.backgroundPosition = '';
  wrap.style.transition = 'none';
  wrap.style.transform = '';
  wrap.style.left = '74%';
  void wrap.offsetHeight;
  wrap.style.transition = 'left 1.1s linear';
  wrap.style.left = '38%';
  setTimeout(() => {
    b.style.animation = 'none';
    b.style.backgroundPosition = '75% 0';
    $('textBoxArrow').style.display = 'flex';
  }, 1150);
}

export function advanceIntro() {
  if (_step < 1 || _step > SCRIPT.length + 1) return;
  if (_typeTimer) {
    finishType();
    return;
  }
  if (_step === 1) {
    _step = 2;
    enterScene();
    return;
  }
  showNextLine();
}

export async function confirmIntro() {
  if (_choiceOpen) {
    _choiceOpen = false;
    $('catchConfirmBtns').style.display = 'none';
    showNextLine();
    return;
  }
  hideIntroText();
  // 恢复游戏内确认按钮的默认文本与布局（intro 期间被改成「准备好了」/「好！」）
  $('confirmYes').textContent = '确定';
  $('confirmNo').style.display = '';
  $('catchConfirmBtns').style.display = 'none';
  const done = _onDone;
  _onDone = null;
  _step = 0;
  const iv = $('introView');
  if (iv) iv.style.display = 'none';
  const sw = document.querySelector('.screen-wrapper');
  const fullH = sw.offsetHeight;
  // 动态测量收缩目标高度：console 高度 − 标题栏 − 背包栏。
  // 不硬编码（原 230px 只在固定视口下成立，不同 DPR/浏览器视口会缩过头）；
  // 背包栏在 boot-no-ui 下 display:none，临时显示测量后立即恢复（同步无闪烁）。
  const backpackBar = document.querySelector('.backpack-bar');
  let targetH;
  if (backpackBar) {
    // boot-no-ui 会隐藏背包栏（display:none），测量目标高度前临时移除，
    // 确保 offsetHeight 取到背包栏真实高度（内联覆盖 + 强制回流在个别环境仍可能为 0）。
    const body = document.body;
    const hadBoot = body.classList.contains('boot-no-ui');
    if (hadBoot) body.classList.remove('boot-no-ui');
    void body.offsetHeight; // 强制同步回流，使 display:none 解除立即生效
    const barH = backpackBar.offsetHeight;
    const consoleEl = document.querySelector('.console');
    const titleBar = document.querySelector('.title-bar');
    const consoleH = consoleEl ? consoleEl.offsetHeight : (fullH + barH);
    targetH = Math.max(80, consoleH - (titleBar ? titleBar.offsetHeight : 32) - barH);
    if (hadBoot) body.classList.add('boot-no-ui');
  } else {
    targetH = 230; // 兜底：无背包栏时退回旧值
  }
  sw.classList.add('boot-collapse');
  sw.style.flex = 'none';
  sw.style.transition = 'none';
  sw.style.height = fullH + 'px';
  void sw.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sw.style.transition = '';
    sw.style.height = targetH + 'px';
  }));
  await new Promise(r => setTimeout(r, 1050));
  // 收缩完成：保持收缩状态与 UI 隐藏，由 startSplashDrop 在 splash 显示后统一恢复布局
  // （过早释放会让屏幕在 splash 出现前跳回原高度，产生闪现）
  if (done) await done();
}
