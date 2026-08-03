// 系统托盘走路动画
// 走路动画实际循环 4 段（0.6s/4 = 150ms 一段）：帧0 → 帧6 → 帧1 → 帧6
// 其中帧6 重复出现（第2段与第4段同一帧），因此只需裁好的 3 张图 walk-1/2/3
// 前端把 4 帧 RGBA 一次性发给 Rust，Rust 后台线程按 150ms 逐帧切换托盘图标
//
// 托盘状态优先级：
//   1. 遭遇中（遇敌/钓到精灵）→ 推当前精灵图鉴图标，原位/上移两帧上下跳动
//   2. 孵蛋中               → 推蛋图标，中/左/右三态左右摇摆
//   3. 农场有地块缺水    → 推 sprout-1/sprout-2 两帧树苗动画（提醒浇水）
//   4. 主角走动中       → 推 4 帧走路动画
//   5. 主角不动         → 只推 walk-2 单帧，托盘静止
import { getCharPrefix, tryLoadImage } from './ui.js';
import * as road from './road.js';
import { hasDryBerries, getFarmStats } from './berry.js';
import { countTradableOffers } from './trade.js';
import { hasRedeemableBounty } from './bounty.js';
import { isFishing } from './fishing.js';
import { phase, currentEncounter, currentIsShiny, _eggHatching, gameData, getPokemonByIndex, getCurrentRegion, getCurrentRoadInfo } from './state.js';

const FRAME_SEQ = [0, 2, 1, 2]; // walk-1 / walk-3 / walk-2 / walk-3
const SPRITES = {
  walk: prefix => [1, 2, 3].map(n => `./icons/${prefix}-walk-${n}.png`),
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
const _boundsCache = new Map();
function cropBounds(img) {
  const key = img.currentSrc || img.src;
  const hit = _boundsCache.get(key);
  if (hit !== undefined) return hit;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
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
    const b = crop ? cropBounds(img) : null;
    const srcW = b ? b.w : img.naturalWidth;
    const srcH = b ? b.h : img.naturalHeight;
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

async function buildFrames(srcs) {
  return renderFrames(await loadImages(srcs));
}

function hasIncubatingEgg() {
  return _eggHatching || (gameData?.incubators || []).some(s => s && s.hatched);
}

// 把当前状态对应的动画帧推送给 Rust：
// 遭遇中推精灵图标；否则按缺水/走路/静止推对应帧
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
    const encIdx = phase === 'encounter' && currentEncounter ? currentEncounter.index : null;
    if (prefix === pushedPrefix && paused === pushedPaused && dry === pushedDry && encIdx === pushedEncIdx && egg === pushedEgg) return; // 状态未变不重推
    let frames;
    let seq;
    if (encIdx != null) {
      // 遭遇中：托盘显示当前遭遇的精灵图标，并在原位/上移两帧间跳动
      const poke = getPokemonByIndex(encIdx);
      if (!poke?.icon) return; // 查不到图标时保持现状
      const imgs = await loadImages([poke.icon]);
      const normal = renderFrames(imgs)[0];
      const up = renderFrames(imgs, 1, -4)[0];
      seq = [normal, up]; // 150ms 原位 / 150ms 上移，上下跳动
    } else if (egg) {
      // 孵蛋中：托盘显示蛋图标，居中/左/右三态左右摇摆
      const imgs = await loadImages(SPRITES.egg());
      const center = renderFrames(imgs)[0];
      const left = renderFrames(imgs, 1, 0, -4)[0];
      const right = renderFrames(imgs, 1, 0, 4)[0];
      seq = [center, left, center, right]; // 150ms×4 = 中→左→中→右，左右摇摆
    } else if (dry) {
      frames = renderFrames(await loadImages(SPRITES.sprout()), 1, 0, 0, false); // 树苗两帧循环，不裁剪保持原构图
      seq = frames;
    } else {
      frames = await buildFrames(SPRITES.walk(prefix));
      seq = paused ? [frames[1]] : FRAME_SEQ.map(i => frames[i]);
    }
    await invoke('set_tray_frames', { frames: seq });
    pushedPrefix = prefix;
    pushedPaused = paused;
    pushedDry = dry;
    pushedEncIdx = encIdx;
    pushedEgg = egg;
  } catch (_) { /* 托盘动画失败时静默降级为静态图标，下轮重试 */ }
  finally { pushing = false; }
}

// ---------- 托盘悬停状态提示 ----------
// 组装游戏状态为多行文本（\n 换行，Windows 原生 tooltip 渲染成 QQ 式多行提示）
function buildStatusText() {
  const g = gameData;
  // 遭遇时：悬停只显示当前宝可梦名字（单独显示，不混入其他状态）
  if (phase === 'encounter' && currentEncounter) {
    const name = currentEncounter.name || getPokemonByIndex(currentEncounter.index)?.name || '未知';
    return (currentIsShiny ? '闪光' : '') + name;
  }
  const region = g ? getCurrentRegion() : { id: 2, name: '丰缘' };
  const roadInfo = g ? getCurrentRoadInfo() : null;
  const loc = roadInfo ? `${roadInfo.num}#道路（${roadInfo.name}）` : region.name;

  let hero = '静止中';
  if (phase === 'encounter') hero = '战斗中';
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

  return ['地点：' + loc, '主角：' + hero, '模式：' + mode, '农场：' + farmTxt, '悬赏：' + bountyTxt, tradeTxt, egg].join('\n');
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
    const encIdx = phase === 'encounter' && currentEncounter ? currentEncounter.index : null;
    if (prefix !== pushedPrefix || paused !== pushedPaused || dry !== pushedDry || encIdx !== pushedEncIdx || egg !== pushedEgg) pushFrames();
    pushStatus();
  }, 1000);
}
