// ===== 页面操作引导 =====
// 第一次进某个页面时挡一层，依次高亮几个入口教玩家怎么用。位置用目标的 offset 布局像素写
// （高亮环挂在它自己的定位父级里），跟整体缩放无关。新增引导只要往 GUIDES 里加一条。
import { gameData, saveGame } from './state.js';
import { logicViewport, popupBounds, consoleScaled, viewportToLogic } from './ui.js';

// 气泡与机身左右边缘留的安全区：不留的话贴边时文字会被切掉
const BUBBLE_PAD = 12;

const GUIDES = {
  // 宝可梦个体详情：三个道具入口
  detail: {
    flag: 'detailGuideSeen',
    view: 'rosterView',
    steps: [
      { sel: '[data-exp-candy-open]', title: '经验糖果', text: '点「等级」使用「经验糖果」给它加经验' },
      { sel: '[data-mint-open]',      title: '薄荷',     text: '点「性格」使用「薄荷」换成想要的性格' },
      { sel: '[data-crown-open]',     title: '王冠',     text: '点「个体值」使用「王冠」练个体值' },
    ],
  },
  // 饲育屋：左上的纸箱（蛋仓库）+ 右上的告示牌（配对管理）
  nursery: {
    flag: 'nurseryGuideSeen',
    view: 'nurseryView',
    steps: [
      { sel: '.nursery-box-sign',   title: '纸箱',   text: '点击看仓库里的宝可梦蛋' },
      { sel: '.nursery-board-sign', title: '告示牌', text: '点击放宝可梦进来配对生蛋' },
    ],
  },
  // 训练：左边的纸箱（树果库存）+ 右边的告示牌（管理宝可梦）
  train: {
    flag: 'trainGuideSeen',
    view: 'trainView',
    steps: [
      { sel: '.train-box-sign',   title: '纸箱',   text: '点击看树果库存' },
      { sel: '.train-board-sign', title: '告示牌', text: '点击放宝可梦进来挂机练级' },
    ],
  },
  // 农场：纸箱（库存）→ 告示牌（每日委托）→ 地块（种 / 浇水 / 收）
  farm: {
    flag: 'farmGuideSeen',
    view: 'berryView',
    steps: [
      { sel: '.berry-box-sign',   title: '纸箱',   text: '点击看树果库存' },
      { sel: '.berry-board-sign', title: '告示牌', text: '点击看今日的树果委托' },
      { sel: '.berry-frame, .berry-plot-add', title: '地块', text: '点空地种下，点击作物浇水' },
    ],
  },
  // 游戏厅：场景里几处热区；两张桌子在场景下半部，气泡往上放，另外两个往下放
  casino: {
    flag: 'casinoGuideSeen',
    view: 'casinoView',
    steps: [
      { sel: '.casino-coin-exchange',  title: '兑换游戏币', text: '用糖果在这里兑换游戏币' },
      { sel: '[data-tip="21 点"]',     title: '21 点',    text: '点这张赌桌玩 21 点', above: true },
      { sel: '[data-tip="口袋麻将"]',  title: '口袋麻将', text: '点这张麻将桌打口袋麻将', above: true },
      { sel: '[data-tip="1号抽卡机"]', title: '抽卡机',   text: '两台抽卡机都可以用游戏币抽卡' },
      { sel: '.casino-hot-up',        title: '上二楼',   text: '楼梯上二楼，还有一排游戏机' },
    ],
  },
};

let _active = false;
let _watch = 0;

// 入口：页面渲染完成后调用（目标不全时不引导，也不记标记）
export function maybeShowGuide(name) {
  const cfg = GUIDES[name];
  if (_active || !cfg || gameData?.[cfg.flag]) return;
  const targets = cfg.steps.map((s) => document.querySelector(s.sel));
  if (targets.some((t) => !t)) return;
  start(cfg, targets);
}

function start(cfg, targets) {
  _active = true;
  // 挡点击：body 级透明 fixed 层，盖住一切；点击就下一步
  const blocker = document.createElement('div');
  blocker.className = 'dg-blocker';
  document.body.appendChild(blocker);
  // 高亮环：插进目标的定位父级，与目标同坐标空间
  const ring = document.createElement('div');
  ring.className = 'dg-ring';
  // 气泡：挂在同一个父级里，左右各留 8px 吃满宽度 —— 永远不出容器
  const bubble = document.createElement('div');
  bubble.className = 'dg-bubble';
  bubble.innerHTML = '<div class="dg-title"></div><div class="dg-text"></div><div class="dg-hint"></div>';
  bubble.style.height = 'auto';   // 宿主可能带"子元素撑满"的规则（.app-host > div），这里锁回自适应
  let step = 0;

  const paint = () => {
    const el = targets[step];
    if (!el || !el.isConnected) { finish(false); return; }
    // 目标不在视野里先滚到中间，再摆位
    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > innerHeight) el.scrollIntoView({ block: 'center' });
    // 宿主固定用最近的那块手机屏：暗场铺满整屏、层级也站在屏幕根上
    // （挂在页面内层容器里会被场地自己的层级压住，宽度也只有场地那么宽）
    const host = el.closest('.screen') || el.offsetParent || el.parentElement || document.body;
    if (ring.parentElement !== host) { host.appendChild(ring); host.appendChild(bubble); }
    let ox = el.offsetLeft, oy = el.offsetTop;
    for (let n = el.offsetParent; n && n !== host; n = n.offsetParent) { ox += n.offsetLeft; oy += n.offsetTop; }
    const w = el.offsetWidth, h = el.offsetHeight;
    ring.style.left = `${ox - 4}px`;
    ring.style.top = `${oy - 4}px`;
    ring.style.width = `${w + 8}px`;
    ring.style.height = `${h + 8}px`;
    // 文案
    const st = cfg.steps[step];
    bubble.querySelector('.dg-title').textContent = st.title;
    bubble.querySelector('.dg-text').textContent = st.text;
    bubble.querySelector('.dg-hint').textContent = `点击继续 ${step + 1}/${cfg.steps.length}`;
    // 气泡定位与 tooltip 同一套：用视口坐标 + logicViewport 换算，夹在机身 popupBounds 内
    const vr = logicViewport(el.getBoundingClientRect().left, el.getBoundingClientRect().top);
    const vr2 = logicViewport(el.getBoundingClientRect().right, el.getBoundingClientRect().bottom);
    // 机身缩放时 popupBounds 给的是屏幕坐标，而气泡的 left/top 是机身逻辑坐标：不折到同一套，
    // 下面那两句"夹在机身内"就是摆设，气泡会从右边戳出去
    let b = popupBounds();
    if (consoleScaled()) {
      const l1 = viewportToLogic(b.left, b.top);
      const l2 = viewportToLogic(b.right, b.bottom);
      b = { left: l1.x, top: l1.y, right: l2.x, bottom: l2.y };
    }
    bubble.style.width = '';   // 先按内容量一次自然宽（上一轮夹过的话要清掉）
    const bw0 = bubble.offsetWidth, bh0 = bubble.offsetHeight;
    bubble.style.width = `${Math.min(bw0, b.right - b.left - BUBBLE_PAD * 2)}px`;   // 宽度也得真收进去
    const bw = bubble.offsetWidth;   // 夹完之后的真实占位宽
    bubble.style.left = `${Math.min(Math.max(vr.x + (vr2.x - vr.x) / 2 - bw / 2, b.left + BUBBLE_PAD), b.right - BUBBLE_PAD - bw)}px`;
    const belowTop = vr2.y + 10;
    const aboveTop = vr.y - 10 - bh0;
    let top = st.above ? aboveTop : belowTop;
    if (top < b.top + BUBBLE_PAD) top = belowTop;                                  // 上方放不下 → 翻到下方
    if (top + bh0 > b.bottom - BUBBLE_PAD) top = Math.max(b.top + BUBBLE_PAD, aboveTop);   // 下方放不下 → 翻到上方
    bubble.style.top = `${top}px`;
    bubble.style.transform = 'none';
  };
  const finish = (seen = true) => {
    if (!_active) return;
    _active = false;
    clearInterval(_watch);
    removeEventListener('resize', reflow);
    removeEventListener('scroll', reflow, true);
    blocker.remove();
    ring.remove();
    bubble.remove();
    if (seen) { gameData[cfg.flag] = true; saveGame(); }
  };
  blocker.addEventListener('click', () => {
    step++;
    if (step >= cfg.steps.length) finish(true);
    else paint();
  });
  // 图片加载完 / 滚动 / 转屏时重新摆位；页面被关掉就收摊（不记标记，下次进来再引导）
  const reflow = () => {
    if (!_active) return;
    if (document.getElementById(cfg.view)?.style.display === 'none') { finish(false); return; }
    paint();
  };
  _watch = setInterval(reflow, 250);
  addEventListener('resize', reflow);
  addEventListener('scroll', reflow, true);
  paint();
}
