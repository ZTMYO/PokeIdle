// 系统托盘走路动画
// 走路动画实际循环 4 段（0.6s/4 = 150ms 一段）：帧0 → 帧6 → 帧1 → 帧6
// 直接从游戏真实角色雪碧图（./character/{prefix}-walk.png，横向 9 帧）切帧，
// 与游戏内 styles.css 的 brendanWalk 动画帧序一致
// 前端把 4 帧 RGBA 一次性发给 Rust，Rust 后台线程按 150ms 逐帧切换托盘图标
//
// 托盘状态优先级：
//   1. 遭遇中（遇敌/钓到精灵）→ 推当前精灵图鉴图标，原位/上移两帧上下跳动
//   2. 钓鱼中               → 推游戏真实钓鱼雪碧图，甩竿/待机两帧交替
//   3. 孵蛋中               → 推蛋图标，中/左/右三态左右摇摆
//   4. 农场有地块缺水    → 推 sprout-1/sprout-2 两帧树苗动画（提醒浇水）
//   5. 骑车中               → 推游戏真实骑车雪碧图，2 帧踩踏板循环
//   6. 跑步中（增益生效） → 推游戏真实跑步雪碧图 4 帧动画
//   7. 主角走动中       → 推游戏真实走路雪碧图 4 帧动画
//   8. 主角不动         → 只推站立帧单帧，托盘静止
import { getCharPrefix, tryLoadImage, isBuffActive } from './ui.js';
import * as road from './road.js';
import { hasDryBerries, getFarmStats } from './berry.js';
import { countTradableOffers } from './trade.js';
import { hasRedeemableBounty } from './bounty.js';
import { isFishing } from './fishing.js';
import { phase, currentEncounter, currentIsShiny, _eggHatching, gameData, getPokemonByIndex, getCurrentRegion, getCurrentRoadInfo } from './state.js';

const FRAME_SEQ = [0, 6, 1, 6]; // 游戏真实走路雪碧帧序（与 styles.css brendanWalk 一致）
// 遭遇展示判定：encounter（丢球中）/ caught（捕获确认）/ fled（逃跑动画）都算战斗进行中。
// currentEncounter 直到 goIdle() 才清空，这样托盘精灵图标在整段收尾动画（挣脱/逃跑动画、
// 捕获确认对话框）期间不提前消失，动画播完、用户确认后才恢复主角显示。
function inEncounter() {
  return !!currentEncounter && (phase === 'encounter' || phase === 'caught' || phase === 'fled');
}
const SPRITES = {
  sprout: () => ['./icons/sprout-1.png', './icons/sprout-2.png'],
  egg: () => ['./items/mystery-egg.png'],
};
const TRAY_SIZE = 64;
let started = false;
let pushing = false;
let pushedPrefix = null;
let pushedPaused = null;
let pushedDry = null;
let pushedEncIdx = null;
let pushedEgg = false;
let pushedFishing = false;
let pushedBike = false;
let pushedRun = false;
let pushedStatus = null;

function getInvoke() {
  return window.__TAURI__?.core?.invoke || null;
}

// 加载图片（精灵图标文件名含中文，必须走 tryLoadImage 的多级回退
// raw → encodeURI → fetch blob → Tauri base64，否则打包后的 asset 协议下加载失败）
function loadImages(srcs) {
  return Promise.all(srcs.map(src => new Promise((res, rej) => {
    const img = new Image();
    tryLoadImage(img, src).then(ok => (ok ? res(img) : rej(new Error('load failed: ' + src))));
  })));
}

// 计算图片非透明像素的包围盒并缓存：去除图标四周透明留白，让精灵在托盘里更大更清晰
// 兼容 Image 与切帧产生的 Canvas 元素
const _boundsCache = new Map();
function cropBounds(img) {
  const key = img.currentSrc || img.src || `${img.width}x${img.height}`;
  const hit = _boundsCache.get(key);
  if (hit !== undefined) return hit;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > 0) {
      const x = (i / 4) % c.width;
      const y = Math.floor(i / 4 / c.width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const b = maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
  if (_boundsCache.size > 300) _boundsCache.clear();
  _boundsCache.set(key, b);
  return b;
}

// 把已加载的图片（可选裁掉留白）等比缩放居中铺满 TRAY_SIZE x TRAY_SIZE，
// alpha 用于生成半透明帧，dy/dx 用于纵向/横向偏移（生成跳动、摇摆帧，负值上移/左移）
// crop=false 时保留原图全部内容（可浇水提醒的树苗图标按原构图显示，不裁剪四周留白）
function renderFrames(imgs, alpha = 1, dy = 0, dx = 0, crop = true) {
  const canvas = document.createElement('canvas');
  canvas.width = TRAY_SIZE;
  canvas.height = TRAY_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  return imgs.map(img => {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const b = crop ? cropBounds(img) : null;
    const srcW = b ? b.w : iw;
    const srcH = b ? b.h : ih;
    const srcX = b ? b.x : 0;
    const srcY = b ? b.y : 0;
    const scale = Math.min((TRAY_SIZE - 2) / srcH, (TRAY_SIZE - 2) / srcW); // 尽量铺满且不超出画布
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    ctx.clearRect(0, 0, TRAY_SIZE, TRAY_SIZE);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, srcX, srcY, srcW, srcH, Math.round((TRAY_SIZE - w) / 2) + dx, Math.round((TRAY_SIZE - h) / 2) + dy, w, h);
    ctx.globalAlpha = 1;
    const data = ctx.getImageData(0, 0, TRAY_SIZE, TRAY_SIZE).data;
    return { rgba: Array.from(data), width: TRAY_SIZE, height: TRAY_SIZE };
  });
}

// 从横向雪碧图按帧序切帧，返回 canvas 数组（用于走路/钓鱼/骑车等真实角色动画）
function sliceFrames(img, fw, fh, seq) {
  return seq.map(f => {
    const c = document.createElement('canvas');
    c.width = fw;
    c.height = fh;
    c.getContext('2d').drawImage(img, f * fw, 0, fw, fh, 0, 0, fw, fh);
    return c;
  });
}

// 走路雪碧图（brendan/may-walk.png）横向 9 帧，约 16×22/帧
// 帧宽取 Math.ceil(width/9)，兼容 brendan-walk.png（143px，末帧略窄）等不齐的图
function sliceWalkFrames(img, seq) {
  const fw = Math.ceil((img.naturalWidth || img.width) / 9);
  return sliceFrames(img, fw, img.naturalHeight || img.height, seq);
}

function hasIncubatingEgg() {
  return _eggHatching || (gameData?.incubators || []).some(s => s && s.hatched);
}

// 把当前状态对应的动画帧推送给 Rust：
// 遭遇中推精灵图标；否则按钓鱼/孵蛋/缺水/骑车/走路/静止推对应帧
// 推送成功后才记录已推状态；失败不记录，下一轮 tick 会自动重试
async function pushFrames() {
  const invoke = getInvoke();
  if (!invoke || pushing) return;
  pushing = true;
  try {
    const prefix = getCharPrefix();
    const dry = hasDryBerries();
    const paused = !road.isActive();
    const egg = hasIncubatingEgg();
    const fishing = isFishing();
    const bike = road.isBike();
    const run = isBuffActive() && !bike; // 增益生效时跑步（骑车优先）
    const encIdx = inEncounter() ? currentEncounter.index : null;
    if (prefix === pushedPrefix && paused === pushedPaused && dry === pushedDry && encIdx === pushedEncIdx && egg === pushedEgg && fishing === pushedFishing && bike === pushedBike && run === pushedRun) return; // 状态未变不重推
    let frames;
    let seq;
    let delay; // 每帧间隔（毫秒），与游戏内对应动画节奏一致
    if (encIdx != null) {
      // 遭遇中：托盘显示当前遭遇的精灵图标，并在原位/上移两帧间跳动
      const poke = getPokemonByIndex(encIdx);
      if (!poke?.icon) return; // 查不到图标时保持现状
      const imgs = await loadImages([poke.icon]);
      const normal = renderFrames(imgs)[0];
      const up = renderFrames(imgs, 1, -4)[0];
      seq = [normal, up]; // 原位/上移交替跳动
      delay = 250; // pokeJump 0.5s 一个起落循环（2 帧）
    } else if (fishing) {
      // 钓鱼中：用游戏真实钓鱼雪碧图，甩竿/待机两帧交替（与游戏等待上钩动画一致）
      // 第3行垂钓点用后 4 帧（待机帧 9），第1行用前 4 帧（待机帧 8）
      const row = road.getFishingRow();
      const base = row >= 3 ? 4 : 0;
      const idle = row >= 3 ? 9 : 8;
      const [sheet] = await loadImages([`./character/${prefix}-fishing.png`]);
      seq = renderFrames(sliceFrames(sheet, 32, sheet.naturalHeight || sheet.height, [base + 3, idle]));
      delay = 800; // 与 fishing.js 待机动画的 800ms 切换一致
    } else if (egg) {
      // 孵蛋中：托盘显示蛋图标，居中/左/右三态左右摇摆
      const imgs = await loadImages(SPRITES.egg());
      const center = renderFrames(imgs)[0];
      const left = renderFrames(imgs, 1, 0, -4)[0];
      const right = renderFrames(imgs, 1, 0, 4)[0];
      seq = [center, left, center, right]; // 中→左→中→右，左右摇摆
      delay = 300; // eggBob 1.2s 一个摆动循环（4 帧）
    } else if (dry) {
      frames = renderFrames(await loadImages(SPRITES.sprout()), 1, 0, 0, false); // 树苗两帧循环，不裁剪保持原构图
      seq = frames;
      delay = 500; // 树苗两帧 1s 一个循环
    } else if (bike) {
      // 骑车中：用游戏真实骑车雪碧图（2 帧踩踏板循环）
      const [sheet] = await loadImages([`./character/${prefix}-bike.png`]);
      seq = renderFrames(sliceFrames(sheet, 32, sheet.naturalHeight || sheet.height, [0, 1]));
      delay = 125; // 骑车 0.25s 一个踩踏板循环（2 帧）
    } else {
      // 跑步/走路/静止：增益生效用真实跑步雪碧图，否则走路雪碧图；静止只显示站立帧（帧0）
      const [sheet] = await loadImages([`./character/${prefix}-${run ? 'run' : 'walk'}.png`]);
      frames = renderFrames(sliceWalkFrames(sheet, FRAME_SEQ));
      seq = paused ? [frames[0]] : frames;
      delay = run ? 113 : 150; // 跑步 0.45s/4 帧≈113ms，走路 0.6s/4 帧=150ms
    }
    await invoke('set_tray_frames', { frames: seq, delay });
    pushedPrefix = prefix;
    pushedPaused = paused;
    pushedDry = dry;
    pushedEncIdx = encIdx;
    pushedEgg = egg;
    pushedFishing = fishing;
    pushedBike = bike;
    pushedRun = run;
  } catch (_) { /* 托盘动画失败时静默降级为静态图标，下轮重试 */ }
  finally { pushing = false; }
}

// ---------- 托盘悬停状态提示 ----------
// 组装游戏状态为多行文本（\n 换行，Windows 原生 tooltip 渲染成 QQ 式多行提示）
function buildStatusText() {
  const g = gameData;
  // 遭遇时：悬停只显示当前宝可梦名字（单独显示，不混入其他状态）
  if (inEncounter()) {
    const name = currentEncounter.name || getPokemonByIndex(currentEncounter.index)?.name || '未知';
    return (currentIsShiny ? '闪光' : '') + name;
  }
  const region = g ? getCurrentRegion() : { id: 2, name: '丰缘' };
  const roadInfo = g ? getCurrentRoadInfo() : null;
  const loc = roadInfo ? `${roadInfo.num}#道路（${roadInfo.name}）` : region.name;

  let hero = '静止中';
  if (inEncounter()) hero = '战斗中';
  else if (isFishing()) hero = '钓鱼中';
  else if (road.isBike()) hero = '骑车中';
  else if (road.isActive()) hero = '前进中';

  // 设置里的操作模式：自动捕捉=自动，佛系=佛系，都关=手动
  const settings = (g && g.settings) || {};
  const mode = settings.autoCatch ? '自动' : settings.autoFlee ? '佛系' : '手动';

  const slots = (g && g.incubators) || [];
  const hatching = slots.filter(s => s && s.eggIndex != null && !s.hatched).length;
  const ready = slots.filter(s => s && s.hatched).length;
  let egg = '可孵化: 0';
  if (g) {
    if (_eggHatching) egg = '孵化中';
    else if (ready > 0) egg = `可孵化: ${ready}`;
    else if (hatching > 0) egg = `孵化中: ${hatching}`;
  }

  let farmTxt = '无';
  if (g) {
    const farm = getFarmStats();
    if (farm.dry > 0) farmTxt = `${farm.dry}缺水`;
    else if (farm.ripe > 0) farmTxt = `${farm.ripe}成熟`;
    else if (farm.growing > 0) farmTxt = `${farm.growing}成长中`;
    else farmTxt = '空闲';
  }

  // 饲育屋：繁殖中（含轮次）/ 待取蛋 / 已配对未开始 / 空闲
  let nurseryTxt = '空闲';
  if (g && g.nursery) {
    const n = g.nursery;
    if (n.breeding) {
      const b = n.breeding;
      nurseryTxt = b.roundsDone >= b.roundsTotal
        ? '待取蛋'
        : `繁殖中 ${b.roundsDone + 1}/${b.roundsTotal} 轮`;
    } else if (Array.isArray(n.parents)) {
      const cnt = n.parents.filter(p => p).length;
      if (cnt > 0) nurseryTxt = `已配对 ${cnt}/2`;
    }
  }

  let bountyTxt = '无';
  if (g && g.bounty && Array.isArray(g.bounty.rewards)) {
    // 地区悬赏：统计全部地区已完成条数 / 总条数
    const all = g.bounty.rewards.flat().filter(r => r);
    const claimed = all.filter(r => r.claimed).length;
    if (all.length > 0) {
      bountyTxt = `${claimed}/${all.length}${hasRedeemableBounty() ? '，当前可提交' : ''}`;
    }
  }

  let tradeTxt = '可交换: 0';
  if (g) tradeTxt = `可交换: ${countTradableOffers()}`;

  return ['地点：' + loc, '主角：' + hero, '模式：' + mode, '农场：' + farmTxt, '饲育屋：' + nurseryTxt, '悬赏：' + bountyTxt, tradeTxt, egg].join('\n');
}

// 推送悬停状态文本
async function pushStatus() {
  const invoke = getInvoke();
  if (!invoke) return;
  const text = buildStatusText();
  if (text === pushedStatus) return;
  try {
    await invoke('set_tray_status', { text });
    pushedStatus = text;
  } catch (_) {}
}

// 启动托盘动画：推送一次帧数据，并定期检查性别/道路暂停/农场缺水状态变化后重新推送
export function startTrayAnimation() {
  if (started) return;
  started = true;
  pushFrames();
  pushStatus();
  setInterval(() => {
    const prefix = getCharPrefix();
    const dry = hasDryBerries();
    const paused = !road.isActive();
    const egg = hasIncubatingEgg();
    const fishing = isFishing();
    const bike = road.isBike();
    const run = isBuffActive() && !bike;
    const encIdx = inEncounter() ? currentEncounter.index : null;
    if (prefix !== pushedPrefix || paused !== pushedPaused || dry !== pushedDry || encIdx !== pushedEncIdx || egg !== pushedEgg || fishing !== pushedFishing || bike !== pushedBike || run !== pushedRun) pushFrames();
    pushStatus();
  }, 1000);
}
