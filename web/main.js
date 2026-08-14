// ===== 口袋挂机 · 展示页逻辑 =====
import './style.css';
import { initTutorial, openTutorial } from './tutorial.js';

/* ============================================================
   下载选项：加Q群下载（复制群号）/ GitHub Release
   ============================================================ */
// QQ 群下载：点击复制群号，加群后从群文件下载安装包
const QQ_GROUP = '1011321822';
const dQQ = document.getElementById('downloadQQ');
if (dQQ) {
  dQQ.addEventListener('click', e => {
    e.preventDefault();
    copyText(QQ_GROUP).then(() => {
      const sub = dQQ.querySelector('.dl-s');
      if (!sub) return;
      const old = sub.textContent;
      sub.textContent = `群号已复制，去 QQ 加群下载`;
      setTimeout(() => { sub.textContent = old; }, 1600);
    });
  });
}
// GitHub Releases 下载，更换仓库时只需改这里
const RELEASES_URL = 'https://github.com/ZTMYO/PokeIdle/releases';
const dGh = document.getElementById('downloadGh');
if (dGh) {
  dGh.href = RELEASES_URL;
  dGh.target = '_blank';
  dGh.rel = 'noopener';
}
// 复制到剪贴板：https 环境用新版 API，否则退回 execCommand（兼容 http 部署）
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); resolve(); }
    catch (err) { reject(err); }
    ta.remove();
  });
}
// 下载按钮：点击展开「加Q群下载 / GitHub Release」两个选项，点外部收起
const dlWrap = document.getElementById('downloadWrap');
const dlMain = document.getElementById('downloadMain');
if (dlWrap && dlMain) {
  dlMain.addEventListener('click', e => {
    e.preventDefault();
    dlWrap.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!dlWrap.contains(e.target)) dlWrap.classList.remove('open');
  });
}

// 禁用浏览器刷新后的滚动位置恢复：每次进入页面都从顶部开始
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

/* ============================================================
   遭遇展示（复刻游戏内 #encounterView）
   ============================================================ */

// 随展示页分发的 20 只宝可梦素材（其余素材不打包）
const GIF_NAMES = new Set([
  '0001-妙蛙种子.gif', '0004-小火龙.gif', '0007-杰尼龟.gif', '0025-皮卡丘.gif', '0059-风速狗.gif',
  '0094-耿鬼.gif', '0129-鲤鱼王.gif', '0130-暴鲤龙.gif', '0133-伊布.gif', '0143-卡比兽.gif',
  '0149-快龙.gif', '0150-超梦.gif', '0151-梦幻.gif', '0248-班基拉斯.gif', '0249-洛奇亚.gif',
  '0250-凤王.gif', '0257-火焰鸡.gif', '0384-烈空坐.gif', '0448-路卡利欧.gif', '0493-阿尔宙斯.gif',
  // 历代御三家（第二世代起，草/火/水）
  '0152-菊草叶.gif', '0155-火球鼠.gif', '0158-小锯鳄.gif',
  '0252-木守宫.gif', '0255-火稚鸡.gif', '0258-水跃鱼.gif',
  '0387-草苗龟.gif', '0390-小火焰猴.gif', '0393-波加曼.gif',
  '0495-藤藤蛇.gif', '0498-暖暖猪.gif', '0501-水水獭.gif',
  '0650-哈力栗.gif', '0653-火狐狸.gif', '0656-呱呱泡蛙.gif',
  '0722-木木枭.gif', '0725-火斑喵.gif', '0728-球球海狮.gif',
  '0810-敲音猴.gif', '0813-炎兔儿.gif', '0816-泪眼蜥.gif',
  '0906-新叶喵.gif', '0909-呆火鳄.gif', '0912-润水鸭.gif',
]);

// 精灵球帧图（closed / open），与游戏内 ball-0X.png 对应
const BALL_IMGS = {
  poke: ['ball-00.png', 'ball-00-open.png'],
  ultra: ['ball-03.png', 'ball-03-open.png'],
  master: ['ball-04.png', 'ball-04-open.png'],
};

// 丢球挣脱文案（复刻游戏 battle.js BREAK_MSGS，按摇晃轮数 0~3 分组）
const BREAK_MSGS = {
  0: [
    '精灵球刚落地就被挣脱了！',
    '精灵球没稳住，它直接冲出来了！',
    '刚落地，宝可梦就突破了精灵球！',
    '精灵球一碰地面就被挣脱开来！',
    '落地一瞬，它便从精灵球脱身！'
  ],
  1: [
    '宝可梦冲了出来！',
    '可恶，没能抓住它！',
    '真是可惜，差一点就抓住了！',
    '明明差一点就要成功了！'
  ],
  2: [
    '就差一点点，没能收服它！',
    '哎呀，差一点就抓到了！',
    '眼看就要成功，可恶！',
    '这一次差一点就成功了！'
  ],
  3: [
    '可惜！这都没抓住它！',
    '就差最后一下了！',
    '可惜！明明就差一点了！',
    '几乎要成功了！',
    '太可惜了！就差那么一下！',
    '我去！这都没抓到！'
  ]
};

// 精灵球基础捕获率 / 名称（复刻游戏 config.js CATCH_RATES 与丢球文案）
const CATCH_RATES = { poke: 0.30, ultra: 0.70, master: 1.00 };
const ITEM_NAMES = { poke: '精灵球', ultra: '高级球', master: '大师球' };

const TYPE_COLORS = {
  '一般': '#B5B4AF', '格斗': '#BE4D47', '飞行': '#81b9ef', '毒': '#8943B0',
  '地面': '#9C5A59', '岩石': '#D3A865', '虫': '#9CAE1E', '幽灵': '#704170',
  '钢': '#60a1b8', '火': '#E75357', '水': '#3F98EA', '草': '#3fa129',
  '电': '#F9CE40', '超能': '#F8669C', '冰': '#3fd8ff', '龙': '#5060e1',
  '恶': '#61484B', '妖精': '#E259E7',
};

// 捕获率 → 稀有度（越低越稀有）
function rarityLabel(catchRate) {
  if (catchRate >= 0.6) return '常见';
  if (catchRate >= 0.4) return '中等';
  if (catchRate >= 0.25) return '稀有';
  if (catchRate >= 0.1) return '罕见';
  return '极稀有';
}

// 复刻游戏内 rollGender：性别按物种比例（genderRate，-1=无性别；0~8=雌性概率/8）
function rollGender(p) {
  const rate = p?.genderRate ?? 4; // 数据缺失兜底 50/50
  if (rate === -1) return 'genderless';
  return Math.random() * 8 < rate ? 'female' : 'male';
}

// 复刻游戏内 genderBadge：性别 → 雪碧图图标（♂ 蓝 / ♀ 粉；无性别用 ♂♀ 组合图标，同尺寸占位）
function genderBadge(g) {
  if (g === 'female') return '<svg class="g-sym g-female" viewBox="0 0 24 24" width="12" height="12"><use href="./sprites.svg#icon-female"/></svg>';
  if (g === 'male') return '<svg class="g-sym g-male" viewBox="0 0 24 24" width="12" height="12"><use href="./sprites.svg#icon-male"/></svg>';
  return '<svg class="g-sym g-genderless" viewBox="0 0 24 24" width="12" height="12"><use href="./sprites.svg#icon-genderless"/></svg>';
}

const encName = document.getElementById('encName');
const encTypes = document.getElementById('encTypes');
const encCr = document.getElementById('encCr');
const encNew = document.getElementById('encNew');
const encGif = document.getElementById('encGif');
const encThrow = document.getElementById('encThrow');
const encBall = document.getElementById('encBall');
const encStars = document.getElementById('encStars');
const encMsg = document.getElementById('encMsg');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function animate(ms, fn) {
  return new Promise(res => {
    const t0 = performance.now();
    (function tick(t) {
      const p = Math.min((t - t0) / ms, 1);
      fn(p);
      if (p < 1) requestAnimationFrame(tick);
      else res();
    })(t0);
  });
}

// ---- 遭遇展示（复刻游戏内 renderEncounterScene） ----
function showEncounter(p) {
  current = p;
  ballsUsed = 0;
  const file = p.image.split('/').pop();
  // 复刻游戏内 renderEncounterScene：名字后跟性别图标 + Lv（性别每场 roll、等级 1~20）
  const gSpan = genderBadge(rollGender(p));
  encName.innerHTML = `${p.name}<span class="encounter-lv">${gSpan}Lv${1 + Math.floor(Math.random() * 20)}</span>`;
  encTypes.innerHTML = p.types.map(t =>
    `<span class="type-badge" style="background:${TYPE_COLORS[t]}">${t}</span>`
  ).join('');
  const pct = Math.round(p.catchRate * 100);
  encCr.innerHTML = `捕获率 ${pct}%<br>稀有度 ${rarityLabel(p.catchRate)}`;
  encNew.style.display = '';
  encMsg.textContent = `野生的 ${p.name} 出现了！`;
  // 宝可梦 GIF 重新入场
  encGif.style.cssText = '';
  encGif.style.animation = 'none';
  void encGif.offsetWidth;
  encGif.style.animation = 'encGrow .8s cubic-bezier(0.22, 1, 0.36, 1) both';
  encGif.src = `./pokemon/${file}`;
  // 重置丢球角色与球
  encThrow.classList.remove('throwing');
  encBall.className = 'enc-ball';
  encBall.style.cssText = '';
  encStars.innerHTML = '';
}

// 随机换一只遭遇
function nextEncounter() {
  if (busy) return;
  showEncounter(POOL[Math.floor(Math.random() * POOL.length)]);
  clearTimeout(autoTimer);
  // 6 秒没丢球就自动换下一只
  autoTimer = setTimeout(nextEncounter, 6000);
}

// ---- 丢球捕捉动画（复刻游戏 playCatchSequence：成功 / 挣脱 / 逃跑 三分支） ----
async function throwSequence(ball) {
  const stageW = encBall.parentElement.clientWidth || 340;
  const stageH = encBall.parentElement.clientHeight || 252;
  const [closed, open] = BALL_IMGS[ball];

  // 丢球瞬间生成全部判定（复刻游戏 throwBall：球种 × 捕获率 → 挣脱轮数 / 逃跑）
  ballsUsed++;
  const rate = ball === 'master' ? 1.0 : (CATCH_RATES[ball] || 0.30) * (current.catchRate ?? 1) * (1 + Math.max(0, ballsUsed - 10) * 0.10);
  const isCaught = Math.random() < rate;
  let breakRound = 0;
  let willFlee = false;
  if (!isCaught) {
    breakRound = Math.random() < 0.3 ? 0 : (Math.random() < 0.4 ? 1 : (Math.random() < 0.6 ? 2 : 3));
    willFlee = Math.random() < Math.min(0.05 + (ballsUsed - 1) * 0.05, 0.5);
  }
  const outcome = isCaught ? 'caught' : willFlee ? 'fled' : 'continue';

  // 阶段1：角色投掷姿势 + 球起手
  encMsg.textContent = `丢出了${ITEM_NAMES[ball]}！`;
  encThrow.classList.add('throwing');
  encBall.src = `./items/${closed}`;
  encBall.classList.add('visible');
  encBall.style.opacity = '1'; // 上次丢球结束把 opacity 置 0，重新丢球前必须重置
  encBall.style.width = '22px';
  encBall.style.height = '22px';
  encBall.style.left = '-3px';
  encBall.style.top = (stageH - 86) + 'px';
  await delay(150);
  encBall.style.left = '2px';
  encBall.style.top = (stageH - 100) + 'px';
  await delay(150);
  encBall.style.width = '40px';
  encBall.style.height = '40px';
  encBall.style.top = (stageH - 120) + 'px';

  // 宝可梦定位改为像素坐标，供吸收动画操纵
  const pkmnW = encGif.offsetWidth || 100;
  const pkmnH = encGif.offsetHeight || 100;
  const pkmnOrigX = stageW / 2 - pkmnW / 2;
  const pkmnOrigY = stageH * 0.58 - pkmnH;
  encGif.style.position = 'absolute';
  encGif.style.left = pkmnOrigX + 'px';
  encGif.style.top = pkmnOrigY + 'px';
  encGif.style.bottom = 'auto';
  encGif.style.transform = 'none';
  encGif.style.animation = 'none';

  // 抛物线飞向宝可梦（peak 上抛）
  const startX = 14, startY = stageH - 120;
  const endX = stageW / 2 - 20;
  const endY = Math.min(stageH * 0.2, pkmnOrigY - 20);
  const peak = 60;
  await animate(350, t => {
    const x = startX + (endX - startX) * t;
    const y = startY + (endY - startY) * t - 4 * peak * t * (1 - t);
    encBall.style.left = x + 'px';
    encBall.style.top = y + 'px';
  });

  // 阶段2：球张开，宝可梦吸收入球
  encBall.src = `./items/${open}`;
  const ballCX = parseFloat(encBall.style.left) + 12;
  const ballCY = parseFloat(encBall.style.top) + 12;
  const pkmnCX = pkmnOrigX + pkmnW / 2;
  const pkmnCY = pkmnOrigY + pkmnH / 2;
  const dx = ballCX - pkmnCX, dy = ballCY - pkmnCY;
  await animate(500, t => {
    const ease = t * t;
    encGif.style.transform = `translate(${dx * ease}px, ${dy * ease}px) scale(${Math.max(1 - ease, 0)})`;
    if (t > 0.85) encGif.style.opacity = '0';
  });
  encGif.style.opacity = '0';

  // 阶段3：球合上下坠 + 弹跳2次
  encBall.src = `./items/${closed}`;
  const groundY = stageH * 0.4;
  encBall.style.transform = 'none';
  await animate(300, t => {
    const ease = t * t;
    encBall.style.top = (endY + (groundY - endY) * ease) + 'px';
  });
  await animate(700, t => {
    let bounceY = 0;
    if (t < 0.35) bounceY = -42 * Math.sin((t / 0.35) * Math.PI);
    else if (t < 0.65) bounceY = -18 * Math.sin(((t - 0.35) / 0.3) * Math.PI);
    else if (t < 0.85) bounceY = -5 * Math.sin(((t - 0.65) / 0.2) * Math.PI);
    encBall.style.transform = `translateY(${bounceY}px)`;
  });
  encBall.style.transform = 'none';

  // 阶段4：摇晃判定轮数（成功=3轮 / 大师球跳过 / 失败=挣脱轮数 breakRound）
  const shakeRounds = outcome === 'caught' ? (ball === 'master' ? 0 : 3) : breakRound;
  for (let r = 1; r <= shakeRounds; r++) {
    encBall.style.animation = 'none';
    void encBall.offsetHeight;
    encBall.style.animation = (r % 2 === 1 ? 'ballSwingRight' : 'ballSwingLeft') + ' .5s ease-in-out';
    await delay(500);
  }
  encBall.style.animation = 'none';

  // 阶段5：结果分支
  if (outcome === 'caught') {
    // 捕捉成功——黄色星星 + 球消失（复刻 animCatchSuccess，起点下移避免偏上）
    const starOriginX = ballCX + 6, starOriginY = ballCY + 42;
    const angles = [-Math.PI / 3, -Math.PI / 9, Math.PI / 9, Math.PI / 3];
    for (const a of angles) {
      const star = document.createElement('div');
      star.className = 'star-particle';
      star.style.left = starOriginX + 'px';
      star.style.top = starOriginY + 'px';
      encStars.appendChild(star);
      const dist = 30 + Math.random() * 10;
      const sx = Math.sin(a) * dist, sy = -Math.cos(a) * dist - 5;
      animate(550, t => {
        const fall = 60 * t * t;
        star.style.transform = `translate(${sx * t}px, ${sy * t + fall}px)`;
        star.style.opacity = 1 - Math.pow(t, 1.5);
      });
    }
    await delay(700);
    await delay(200);
    encStars.innerHTML = '';
    encMsg.textContent = ball === 'master'
      ? (Math.random() < 0.5 ? `大师球完美锁住了 ${current.name}！` : `大师球发挥奇效，顺利捕获 ${current.name}！`)
      : `搞定！${current.name} 被收服了！`;
    await animate(300, t => {
      encBall.style.opacity = 1 - t;
    });
    encBall.classList.remove('visible');
    encThrow.classList.remove('throwing');
    return 'caught';
  }

  // 挣脱——球张开，宝可梦从球位置放大现身（复刻 animBreakFree）
  encBall.src = `./items/${open}`;
  encGif.style.opacity = '1';
  const curBallX = parseFloat(encBall.style.left) + 20;
  const curBallY = parseFloat(encBall.style.top) + 20;
  const bfX = curBallX - pkmnOrigX;
  const bfY = curBallY - pkmnOrigY;
  encGif.style.transform = `translate(${bfX}px, ${bfY}px) scale(0.2)`;
  await animate(500, t => {
    const ease = 1 - Math.pow(1 - t, 2);
    encGif.style.transform = `translate(${bfX - bfX * ease}px, ${bfY - bfY * ease}px) scale(${0.2 + 0.8 * ease})`;
  });
  encGif.style.transform = 'none';
  encBall.style.transform = 'none';
  await animate(300, t => {
    encBall.style.opacity = 1 - t;
  });
  encBall.classList.remove('visible');
  encThrow.classList.remove('throwing');

  // 先显示挣脱文案；逃跑则在停顿后追加"精灵逃走了！"
  const msgs = BREAK_MSGS[breakRound] || BREAK_MSGS[1];
  encMsg.textContent = msgs[Math.floor(Math.random() * msgs.length)];
  if (outcome === 'fled') {
    await delay(800);
    encMsg.textContent = '精灵逃走了！';
    return 'fled';
  }
  return 'continue';
}

// ---- 背包球槽：点击丢球捕捉，抓到/逃跑自动换下一只，挣脱则留在同一只 ----
document.querySelectorAll('.ball-slot').forEach(slot => {
  slot.addEventListener('click', () => {
    if (busy || !current) return;
    busy = true;
    clearTimeout(autoTimer);
    throwSequence(slot.dataset.ball).then(res => {
      busy = false;
      if (res === 'caught' || res === 'fled') {
        nextEncounter();
      } else {
        // 挣脱后继续同一只：重新武装 6 秒无操作自动换怪
        autoTimer = setTimeout(nextEncounter, 6000);
      }
    });
  });
});

// ---- 加载图鉴数据后开始遭遇循环 ----
const POOL = [];
let current = null;
let busy = false;
let autoTimer = null;
let ballsUsed = 0; // 当前遭遇已丢球数（复刻游戏 encounterBallsUsed，用于捕获加成）

fetch('./pokedex.json')
  .then(r => r.json())
  .then(list => {
    POOL.length = 0;
    POOL.push(...list.filter(p => GIF_NAMES.has(p.image.split('/').pop())));
    if (!POOL.length) POOL.push(...list.slice(0, 30));
    nextEncounter();
  })
  .catch(() => {
    // 兜底：json 缺失时用文件名占位
    POOL.push(...[...GIF_NAMES].map(f => ({
      name: f.split('-')[1].replace('.gif', ''),
      image: 'pokemon-data/images/' + f,
      types: [], catchRate: 0.3,
    })));
    nextEncounter();
  });

/* ============================================================
   全图鉴滚动条
   ============================================================ */
const MQ_A = [
  '0025-皮卡丘.gif', '0059-风速狗.gif', '0150-超梦.gif', '0143-卡比兽.gif',
  '0248-班基拉斯.gif', '0493-阿尔宙斯.gif', '0130-暴鲤龙.gif', '0149-快龙.gif',
  '0129-鲤鱼王.gif', '0001-妙蛙种子.gif', '0007-杰尼龟.gif', '0133-伊布.gif',
  // 历代草/水系御三家
  '0152-菊草叶.gif', '0252-木守宫.gif', '0387-草苗龟.gif', '0495-藤藤蛇.gif',
  '0650-哈力栗.gif', '0722-木木枭.gif', '0810-敲音猴.gif', '0906-新叶喵.gif',
  '0158-小锯鳄.gif', '0258-水跃鱼.gif', '0393-波加曼.gif', '0501-水水獭.gif',
];
const MQ_B = [
  '0257-火焰鸡.gif', '0384-烈空坐.gif', '0448-路卡利欧.gif', '0094-耿鬼.gif',
  '0004-小火龙.gif', '0249-洛奇亚.gif', '0250-凤王.gif', '0151-梦幻.gif',
  '0149-快龙.gif', '0130-暴鲤龙.gif', '0025-皮卡丘.gif', '0129-鲤鱼王.gif',
  // 历代火/水系御三家
  '0155-火球鼠.gif', '0255-火稚鸡.gif', '0390-小火焰猴.gif', '0498-暖暖猪.gif',
  '0653-火狐狸.gif', '0725-火斑喵.gif', '0813-炎兔儿.gif', '0909-呆火鳄.gif',
  '0656-呱呱泡蛙.gif', '0728-球球海狮.gif', '0816-泪眼蜥.gif', '0912-润水鸭.gif',
];

function fillMarquee(el, list) {
  const html = list.map(f => {
    const name = f.slice(5, -4);
    return `<div class="m-item" title="${name}"><img src="./pokemon/${f}" alt="${name}" loading="lazy" /></div>`;
  }).join('');
  // 双份内容实现无缝循环
  el.innerHTML = html + html;
}
fillMarquee(document.getElementById('mq1'), MQ_A);
fillMarquee(document.getElementById('mq2'), MQ_B);

// ---- 游戏截图轮播：左图右文，右侧卡片（图标+标题+描述）充当指示器 ----
const SHOT_CARDS = [
  { title: '手机系统', icon: 'icon-phone', desc: '一个手机搞定全部：导航、图鉴、仓库、交换、孵蛋器、农场。' },
  { title: '智能导航', icon: 'icon-gps', desc: '指定目的地自动规划路线，环国漫游一路畅通，事件地点轻松到达。' },
  { title: '宝可梦详情', icon: 'icon-book', desc: '属性、个体值、来源一目了然，收藏进度尽在掌握。' },
  { title: '孵蛋器', icon: 'icon-egg', desc: '挂机孵化神秘蛋，随机出宠，还有概率孵出闪。' },
  { title: '树果农场', icon: 'icon-tree', desc: '种植、浇水、收获一气呵成，还能招募帮手自动打理。' },
  { title: '树果混合器', icon: 'icon-mixer', desc: '按配方混合树果制成树果方块，吸引特定宝可梦。' },
  { title: '交换广场', icon: 'icon-trade', desc: '与 NPC 训练家交换个体，补全图鉴更快一步。' },
  { title: '地区悬赏', icon: 'icon-station', desc: '接取悬赏任务，提交指定宝可梦，换取丰厚奖励。' },
  { title: '培育', icon: 'icon-heart', desc: '饲育屋配对繁育，个体值遗传可锁定，培养高个体后代。' },
  { title: '闪光宝可梦', icon: 'icon-star', desc: '1/1000 概率遇见闪光，搭配闪耀护符大幅提升。' },
  { title: '随从', icon: 'icon-follower', desc: '糖果抽取宝可梦随从，九类限时增益。' },
  { title: '成就', icon: 'icon-achievement', desc: '累计统计达标即可领取糖果，1-2-5 规整序列无限递进。' },
  { title: '大量出没', icon: 'icon-pin', desc: '随机路段事件点，锁定宝可梦连续遭遇，闪光率提升至 1/200。' },
  { title: 'NPC 对战', icon: 'icon-versus', desc: '普通/精英/冠军三档队伍刷新，回合制赢取经验与糖果。' },
  { title: '配队', icon: 'icon-edit', desc: '从仓库挑选六只组成出战小队。' },
  { title: '配招', icon: 'icon-moves', desc: '自动配招一键成型，手动微调自由组合技能搭配。' },
  { title: '训练', icon: 'icon-train', desc: '训练场挂机自动获得经验，树果补充饱食度持续升级。' },
  { title: '21点', icon: 'icon-blackjack', desc: '标准 52 张牌，要牌/停牌/加倍任选，黑杰克 1.5 倍赔付。' },
  { title: '口袋麻将', icon: 'icon-mahjong', desc: '四人立直麻将，押注立直搏高番，天和役满一局翻盘。' },
  { title: '抽卡机', icon: 'icon-album', desc: '使用游戏币抽卡，N/R/SR 三大稀有度，在卡册收藏和查看。' },
];

const shotStage = document.getElementById('shotStage');
if (shotStage) {
  const shots = shotStage.children;
  const shotCards = document.getElementById('shotCards');
  const shotMobileInfo = document.getElementById('shotMobileInfo');
  let shotIndex = 0;
  let shotTimer = null;

  // 右侧卡片（图标 + 标题 + 描述）：3 行轮换，PC 上同时只显示 2 行
  // 顶部行播完向上滚出、下一行从底部滚入；播放到第 3 行时第 1 行回到最底下，循环往复
  const CARD_PER_ROW = 5;
  const cardGap = 10; // 与 .shot-cards-stage 的 gap 一致
  const cardStage = document.createElement('div');
  cardStage.className = 'shot-cards-stage';
  // 尾部补一行第 1 行副本，让第 3 行播放时第 1 行出现在底部
  cardStage.innerHTML = SHOT_CARDS.concat(SHOT_CARDS.slice(0, CARD_PER_ROW)).map((c, i) => `
    <button class="shot-card${i === 0 ? ' active' : ''}" data-i="${i}" type="button">
      <span class="shot-card-icon"><svg><use href="./sprites.svg#${c.icon}" /></svg></span>
      <span class="shot-card-title">${c.title}</span>
      <span class="shot-card-desc">${c.desc}</span>
    </button>`).join('');
  shotCards.appendChild(cardStage);

  // 行高 = 单卡高度 + 行间距；视图区高度固定为 2 行（切换前测量，行高等高才滚动精准）
  let rowH = 0;
  function measureCardRows() {
    const first = cardStage.firstElementChild;
    if (!first) return;
    rowH = first.offsetHeight + cardGap;
    shotCards.style.height = (rowH * 2 - cardGap) + 'px';
  }
  measureCardRows();
  window.addEventListener('resize', measureCardRows);

  let topRow = 0;
  // 行切换：向上滚动一行露出下一行；回绕到第 1 行时瞬间复位不滚动
  function setCardRow(row, animate) {
    if (row === topRow || !rowH) return;
    topRow = row;
    cardStage.classList.toggle('no-anim', !animate);
    cardStage.style.transform = `translateY(${-row * rowH}px)`;
    if (!animate) requestAnimationFrame(() => cardStage.classList.remove('no-anim'));
  }

  // 移动端信息区（图标 + 标题 + 描述）
  function renderMobileInfo(i) {
    const c = SHOT_CARDS[i];
    shotMobileInfo.innerHTML = `
      <span class="shot-mi-icon"><svg><use href="./sprites.svg#${c.icon}" /></svg></span>
      <span class="shot-mi-title">${c.title}</span>
      <span class="shot-mi-desc">${c.desc}</span>`;
  }

  function goShot(i) {
    shotIndex = (i + shots.length) % shots.length;
    // 图片渐淡切换
    [...shots].forEach((el, k) => el.classList.toggle('active', k === shotIndex));
    // 高亮对应卡片，跨行时行跟着滚动
    const row = Math.floor(shotIndex / CARD_PER_ROW);
    setCardRow(row, row > topRow);
    [...cardStage.children].forEach((card, k) => card.classList.toggle('active', k === shotIndex));
    renderMobileInfo(shotIndex);
  }

  // 自动播放，点击卡片后重新计时
  function restartShotTimer() {
    clearInterval(shotTimer);
    shotTimer = setInterval(() => goShot(shotIndex + 1), 4500);
  }

  shotCards.addEventListener('click', e => {
    const card = e.target.closest('.shot-card');
    if (!card) return;
    goShot(+card.dataset.i);
    restartShotTimer();
  });

  goShot(0);
  restartShotTimer();
}

/* ============================================================
   九大地区地图（复刻游戏内地图：节点 + 半段道路归属）
   ============================================================ */
const REGIONS = ['关都', '城都', '丰缘', '神奥', '合众', '卡洛斯', '阿罗拉', '伽勒尔', '帕底亚'];
const REGION_COLORS = ['#E3350D', '#F6C700', '#3DAE5B', '#4FC3F7', '#757575', '#F06292', '#FF9800', '#5C6BC0', '#AB47BC'];
const LIGHT_NODES = [1, 3, 4, 5, 6];
const REGION_POS = {
  0: [821, 299], 1: [762, 361], 2: [689, 484], 3: [845, 169],
  4: [165, 311], 5: [388, 202], 6: [424, 615], 7: [370, 85], 8: [365, 316],
};

function delaunay(pts) {
  const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
  const minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
  const d = Math.max(maxX - minX, maxY - minY) * 20;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const sup = [[cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]];
  const circum = (a, b, c) => {
    const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-9) return [Infinity, Infinity, Infinity];
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
    return [ux, uy, (ux - ax) ** 2 + (uy - ay) ** 2];
  };
  let tris = [[sup[0], sup[1], sup[2]]];
  for (const p of pts) {
    const bad = tris.filter(t => {
      const [ux, uy, r2] = circum(t[0], t[1], t[2]);
      return (p[0] - ux) ** 2 + (p[1] - uy) ** 2 <= r2;
    });
    const poly = [];
    for (const t of bad) {
      for (let k = 0; k < 3; k++) {
        const e = [t[k], t[(k + 1) % 3]];
        const shared = bad.some(t2 => t2 !== t && t2.includes(e[0]) && t2.includes(e[1]));
        if (!shared) poly.push(e);
      }
    }
    tris = tris.filter(t => !bad.includes(t));
    for (const e of poly) tris.push([e[0], e[1], p]);
  }
  const edges = new Set();
  for (const t of tris) {
    if (t.some(v => sup.includes(v))) continue;
    for (let k = 0; k < 3; k++) {
      const a = pts.indexOf(t[k]), b = pts.indexOf(t[(k + 1) % 3]);
      if (a < b) edges.add(`${a}-${b}`);
    }
  }
  return [...edges].map(s => s.split('-').map(Number));
}

// label 位置微调（key=地区下标）：合众放节点左侧、卡洛斯右上、帕底亚左下，其余默认节点右侧
const LABEL_OFFSETS = {
  4: { x: -26, y: 0, anchor: 'end' },
  5: { x: 26, y: -10, anchor: 'start' },
  8: { x: -26, y: 26, anchor: 'end' },
};

function buildRegionMap() {
  const svg = document.getElementById('regionMap');
  if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    return n;
  };

  // 每条路拆成前后两段：前半段归出发地区、后半段归目标地区；
  // 丰缘-关都、城都-神奥 为水路/不直连剔除；关都-神奥 为陆路手动补上
  // 编号中点基于「扣除两端节点圆半径后的可见线段」计算，避免编号压到节点圆上；
  // 前后半段沿道路法线分居两侧，避免编号叠在道路线或彼此身上
  const segments = [];
  let segNum = 1;
  const NODE_R = 15; // 节点圆半径（与下方 circle r 一致）
  const rawEdges = delaunay([0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => REGION_POS[i]))
    .filter(([a, b]) => !(a === 0 && b === 2) && !(a === 1 && b === 3));
  if (!rawEdges.some(([a, b]) => a === 0 && b === 3)) rawEdges.push([0, 3]);
  for (const [a, b] of rawEdges) {
    const [ax, ay] = REGION_POS[a], [bx, by] = REGION_POS[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len <= NODE_R * 2) continue; // 过短的边无法安放编号，跳过
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;              // 道路法线
    const visLen = len - NODE_R * 2;      // 可见线段长度（扣除两端圆）
    const sx = ax + ux * NODE_R;          // 可见线段起点（A 圆边缘）
    const sy = ay + uy * NODE_R;
    const mx = ax + ux * (len / 2), my = ay + uy * (len / 2); // 几何中点（画线用）
    // 前半段编号在可见段 1/4 处、后半段在 3/4 处，各沿法线偏一侧
    segments.push(
      { num: segNum++, a, b, from: a, half: 0,
        d: `M ${ax} ${ay} L ${mx} ${my}`,
        lx: sx + ux * (visLen * 0.25) + nx * 12,
        ly: sy + uy * (visLen * 0.25) + ny * 12 },
      { num: segNum++, a, b, from: b, half: 1,
        d: `M ${mx} ${my} L ${bx} ${by}`,
        lx: sx + ux * (visLen * 0.75) - nx * 12,
        ly: sy + uy * (visLen * 0.75) - ny * 12 }
    );
  }

  const edgeGroups = new Map();
  const roadLabels = []; // 道路编号：最后统一渲染，保证不被节点遮挡
  segments.forEach(s => {
    const path = el('path', {
      d: s.d, stroke: REGION_COLORS[s.from], 'stroke-width': 2.5, 'stroke-linecap': 'round',
      fill: 'none', opacity: 0.55, class: 'edge-line'
    });
    svg.appendChild(path);
    const t = el('text', {
      x: s.lx, y: s.ly + 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#1f1f1f',
    });
    t.textContent = `${s.num}#道路`;
    roadLabels.push(t);
    const key = `${Math.min(s.a, s.b)}-${Math.max(s.a, s.b)}`;
    if (!edgeGroups.has(key)) edgeGroups.set(key, { a: s.a, b: s.b, halves: [] });
    edgeGroups.get(key).halves.push({ path, label: t, from: s.from });
  });

  // 分界点（菱形，白边）
  const splits = [...new Set(segments.map(s => `${(REGION_POS[s.a][0] + REGION_POS[s.b][0]) / 2},${(REGION_POS[s.a][1] + REGION_POS[s.b][1]) / 2}`))];
  splits.forEach(k => {
    const [x, y] = k.split(',').map(Number);
    svg.appendChild(el('rect', {
      x: x - 4.5, y: y - 4.5, width: 9, height: 9,
      fill: '#fff', stroke: '#1f1f1f', 'stroke-width': 1.5, transform: `rotate(45 ${x} ${y})`
    }));
  });

  // 地区节点
  const nodeGroupEls = [];
  REGIONS.forEach((name, i) => {
    const [x, y] = REGION_POS[i];
    const g = el('g', { style: 'cursor:pointer' });
    g.appendChild(el('circle', { cx: x, cy: y, r: 15, fill: REGION_COLORS[i], stroke: '#fff', 'stroke-width': 2 }));
    const n = el('text', {
      x: x, y: y + 4.5, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700,
      fill: LIGHT_NODES.includes(i) ? '#1f1f1f' : '#fff'
    });
    n.textContent = String(i + 1);
    g.appendChild(n);
    const off = LABEL_OFFSETS[i] || { x: 26, y: 0, anchor: 'start' };
    const l = el('text', {
      x: x + off.x, y: y + 4.5 + off.y, 'text-anchor': off.anchor, 'font-size': 12.5, 'font-weight': 700, fill: '#1f1f1f',
      style: 'paint-order:stroke;stroke:#d0c4a4;'
    });
    l.textContent = name;
    g.appendChild(l);
    svg.appendChild(g);
    nodeGroupEls[i] = g;
  });

  // 道路编号最后渲染置顶：避免被节点圆点遮挡
  roadLabels.forEach(t => svg.appendChild(t));

  // 交互：hover 节点高亮归属该地区的半段路；hover 道路高亮该段
  const clearHover = () => {
    edgeGroups.forEach(eg => eg.halves.forEach(h => {
      h.path.classList.remove('hl', 'dim');
      h.label.setAttribute('font-weight', 400);
    }));
  };
  nodeGroupEls.forEach((g, i) => {
    g.addEventListener('mouseenter', () => {
      edgeGroups.forEach(eg => eg.halves.forEach(h => {
        const hit = h.from === i;
        h.path.classList.toggle('hl', hit);
        h.path.classList.toggle('dim', !hit);
        h.label.setAttribute('font-weight', hit ? 700 : 400);
      }));
    });
    g.addEventListener('mouseleave', clearHover);
  });
  edgeGroups.forEach(eg => eg.halves.forEach(h => {
    h.path.addEventListener('mouseenter', () => {
      h.path.classList.add('hl');
      h.label.setAttribute('font-weight', 700);
    });
    h.path.addEventListener('mouseleave', clearHover);
  }));
}

/* ============================================================
   启动
   ============================================================ */
buildRegionMap();

/* ============================================================
   树果农场：女主角来回走动 + 到每棵果树旁浇水（复刻游戏 helper 逻辑）
   ============================================================ */
function setupFarmHelper() {
  const farm = document.querySelector('.farm');
  const helper = document.getElementById('farmHelper');
  if (!farm || !helper) return;
  const items = [...farm.querySelectorAll('.farm-item')];
  if (!items.length) return;
  // 只统计可见树（移动端会隐藏最右一棵，display:none 时 offsetWidth=0，需排除避免女主角走向左上角）
  const visibleItems = () => items.filter(it => it.offsetWidth > 0);

  const W = 32, H = 42; // may-walk 帧 16x21 → 2x

  // 目标树坐标：树图底部中心（女主脚底对齐，下移 10px 避免和树身重叠）
  const targetPos = item => {
    const berry = item.querySelector('.farm-berry');
    const bx = berry.offsetLeft;
    const by = berry.offsetTop;
    return { x: bx + berry.offsetWidth / 2 - W / 2, y: by + berry.offsetHeight - H + 10 };
  };

  // 浇水动效（复刻 spawnSpray）：喷壶在树头上方倾斜 + 12 颗水滴撒落
  const spawnSpray = berry => {
    const img = document.createElement('img');
    img.className = 'berry-spray';
    img.src = './items/berry-trees/spray3.png';
    img.alt = '';
    img.addEventListener('animationend', () => img.remove());
    berry.appendChild(img);
    for (let k = 0; k < 12; k++) {
      const drop = document.createElement('div');
      drop.className = 'berry-drop';
      const size = Math.random() < 0.7 ? 1 : 2;
      drop.style.width = size + 'px';
      drop.style.height = size + 'px';
      drop.style.setProperty('--dx', Math.floor(Math.random() * 33 - 16) + 'px');
      drop.style.setProperty('--delay', (Math.random() * 0.15).toFixed(2) + 's');
      drop.addEventListener('animationend', () => drop.remove(), { once: true });
      berry.appendChild(drop);
    }
  };

  // 初始落位到第一棵（关闭过渡，避免开场滑动）
  const p0 = targetPos(visibleItems()[0]);
  helper.style.transition = 'none';
  helper.style.left = p0.x + 'px';
  helper.style.top = p0.y + 'px';
  helper.style.transition = '';

  // 循环：走向当前树 → 站定 → 浇水 → 前进/折返
  let idx = 0, dir = 1;
  const tick = async () => {
    const vis = visibleItems();
    if (!vis.length) return;
    if (idx >= vis.length) idx = vis.length - 1; // 窗口缩放导致可见树变少时收拢
    const item = vis[idx];
    const pos = targetPos(item);
    helper.classList.remove('water', 'plant');
    helper.classList.add('walk');
    helper.classList.toggle('flip', dir < 0);
    helper.style.left = pos.x + 'px';
    helper.style.top = pos.y + 'px';
    await delay(550); // 行走（transition 0.55s）
    // 到达：面朝上站定
    helper.classList.remove('walk');
    helper.classList.add('plant');
    await delay(400);
    // 浇水：切 water 素材 + 喷壶/水滴
    helper.classList.remove('plant');
    helper.classList.add('water');
    spawnSpray(item.querySelector('.farm-berry'));
    await delay(900);
    helper.classList.remove('water');
    // 前进/折返
    const next = idx + dir;
    if (next < 0 || next >= vis.length) { // 到边界折返
      dir = -dir;
      idx += dir;
    } else {
      idx = next;
    }
    setTimeout(tick, 200);
  };
  tick();
}
setupFarmHelper();

// ============================================================
//   游戏教程子页面（解析 src/views.js 教程内容）
//   ============================================================ */
initTutorial();

// ============================================================
//   顶栏菜单：游戏教程 / 更新日志
//   ============================================================ */
(function setupTopbarMenu() {
  const menuBtn = document.getElementById('menuBtn');
  const menuDrop = document.getElementById('menuDrop');
  if (!menuBtn || !menuDrop) return;

  const closeDrop = () => {
    menuDrop.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    menuDrop.hidden = !menuDrop.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menuDrop.hidden));
  });
  // 点击页面其他区域收起
  document.addEventListener('click', () => { if (!menuDrop.hidden) closeDrop(); });
  menuDrop.addEventListener('click', e => {
    const item = e.target.closest('[data-menu]');
    if (!item) return;
    closeDrop();
    if (item.dataset.menu === 'tutorial') openTutorial();
    else if (item.dataset.menu === 'changelog') openChangelog();
  });
})();

// ============================================================
//   更新日志子页面（解析根目录 update_log.md，构建时同步到 public）
//   ============================================================ */
const changelogPage = document.getElementById('changelogPage');
const changelogContent = document.getElementById('changelogContent');
const clCloseBtn = document.getElementById('clClose');

// HTML 转义，杜绝注入
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// 行内标记：**粗体**
function mdInline(s) {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
// 极简 Markdown：仅支持 update_log.md 用到的 # / ## / ### / 有序列表 / 无序列表 / 粗体 / 分隔线
function renderChangelog(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let listType = null; // null | 'ol' | 'ul'
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s+/.test(line)) {
      closeList();
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      const level = m[1].length;
      const tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      html += `<${tag}>${mdInline(m[2])}</${tag}>`;
    } else if (/^\s*-{3,}\s*$/.test(line)) {
      closeList();
      html += '<hr>';
    } else if (/^\d+\.\s+/.test(line)) {
      if (listType !== 'ol') { closeList(); listType = 'ol'; html += '<ol>'; }
      html += `<li>${mdInline(line.replace(/^\d+\.\s+/, ''))}</li>`;
    } else if (/^[-*]\s+/.test(line)) {
      if (listType !== 'ul') { closeList(); listType = 'ul'; html += '<ul>'; }
      html += `<li>${mdInline(line.replace(/^[-*]\s+/, ''))}</li>`;
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += `<p>${mdInline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function openChangelog() {
  if (!changelogPage) return;
  if (changelogContent.dataset.loaded) { changelogPage.hidden = false; document.body.style.overflow = 'hidden'; return; }
  fetch('./update_log.md')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(md => {
      changelogContent.innerHTML = renderChangelog(md);
      changelogContent.dataset.loaded = '1';
      changelogPage.hidden = false;
      changelogPage.querySelector('.cl-body')?.scrollTo(0, 0);
      document.body.style.overflow = 'hidden';
    })
    .catch(() => {
      changelogContent.innerHTML = '<p class="cl-error">更新日志加载失败，请检查网络或稍后重试</p>';
      changelogPage.hidden = false;
      document.body.style.overflow = 'hidden';
    });
}
function closeChangelog() {
  if (!changelogPage) return;
  changelogPage.hidden = true;
  document.body.style.overflow = '';
}

clCloseBtn?.addEventListener('click', closeChangelog);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && changelogPage && !changelogPage.hidden) closeChangelog();
});
