// ===== 背景音乐管理 =====
// 三条通道互斥发声：地区曲 / 覆盖曲（战斗、骑行）/ 瞬发音（胜利、孵蛋、道具）
import { REGION_PLAYLISTS, SFX, INTRO_TRACK, TRACK_GAINS } from './regions.js';
import { showNowPlaying } from './ui.js';

let _volume = 0.6;
let _musicEnabled = true;  // 音乐开关
let _splashLocked = false; // splash 动画期间禁声
let _battleMusic = true;   // 战斗音乐开关（关闭时战斗保持地区曲）
let _regionTracks = [];    // 当前地区歌单
let _lastIdx = -1;         // 当前播放下标
let _regionQueue = [];     // 当前歌单洗牌序列（全部播完才重洗，保证每首都能轮到）
let _regionActive = false; // 地区曲「应该」在播放
let _overlayActive = false;
let _overlayType = null;   // null | 'battle' | 'cycling'
let _currentTitle = '';    // 当前地区曲标题（手机页展示用）
let _currentArtist = '';

const REGION_FADE_MS = 700; // 地区曲切歌淡入淡出时长
let _regionSwitchToken = 0; // 连续切歌只让最后一次生效
let _currentRegionPath = ''; // 当前地区曲路径
let _regionGainLinear = 1;   // 地区曲响度补偿目标

const regionAudio = new Audio();
regionAudio.preload = 'auto';
const overlayAudio = new Audio();
overlayAudio.preload = 'auto';
const sfxAudio = new Audio();
sfxAudio.preload = 'auto';

// ---------- 响度统一 ----------
// 各曲目响度参差，按 TRACK_GAINS 的 dB 差值实时补偿到未白镇 BGM 的响度，不改音频文件。
let _actx = null;
const _gainNodes = { region: null, overlay: null, sfx: null };

function ensureCtx() {
  if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
  if (_actx.state === 'suspended') _actx.resume();
  return _actx;
}

// 元素 -> 增益节点 -> 输出
function wireGain(el, key) {
  if (_gainNodes[key]) return;
  try {
    const ctx = ensureCtx();
    const src = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    src.connect(g);
    g.connect(ctx.destination);
    _gainNodes[key] = g;
  } catch (_) { /* 环境不支持 MediaElementSource 时跳过补偿 */ }
}

function applyTrackGain(key, path) {
  wireGain(key === 'region' ? regionAudio : key === 'overlay' ? overlayAudio : sfxAudio, key);
  const g = _gainNodes[key];
  if (!g) return;
  const db = TRACK_GAINS[path] ?? 0;
  g.gain.value = Math.pow(10, db / 20);
  if (key === 'region') _regionGainLinear = g.gain.value;
}

function regionFadeTo(value, ms) {
  const g = _gainNodes.region;
  if (!g || !_actx) return;
  const now = _actx.currentTime;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
  g.gain.linearRampToValueAtTime(value, now + ms / 1000);
}

// 地区曲从静音淡入到目标响度
function regionFadeIn(ms = REGION_FADE_MS) {
  const g = _gainNodes.region;
  if (!g || !_actx) return;
  const now = _actx.currentTime;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(_regionGainLinear, now + ms / 1000);
}

function urlFor(path) {
  // 逐段编码，处理文件名里的空格、é、括号等字符
  return './audio/' + path.split('/').map(encodeURIComponent).join('/');
}

let _pending = null; // 自动播放被拦截时挂起，等用户交互后补播
let _sfxInterrupted = false; // 瞬发音效（胜利等）被音乐开关/静音/splash 暂停时置位，恢复时优先补播它

function tryPlay(el) {
  if (_splashLocked) return; // splash 期间不实际发声（状态保留，放行后恢复）
  // 音乐关闭时全局阻断：地区曲/覆盖曲/瞬发音效（victory、孵蛋、交换等）一律不发声
  if (!_musicEnabled) return;
  const p = el.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => { _pending = el; });
  }
}

function applyVolume() {
  regionAudio.volume = _volume;
  overlayAudio.volume = _volume;
  sfxAudio.volume = _volume;
}

// 任何用户交互时补播被拦截的音频；音效/覆盖曲播放中不打断
function installResumeListener() {
  const resume = () => {
    if (_actx && _actx.state === 'suspended') _actx.resume();
    if (_pending) { const el = _pending; _pending = null; tryPlay(el); return; }
    if (!sfxAudio.paused) return;
    if (!_overlayActive && _regionActive && regionAudio.paused && regionAudio.src) { regionFadeIn(300); tryPlay(regionAudio); }
    if (_overlayActive && overlayAudio.paused && overlayAudio.src) tryPlay(overlayAudio);
  };
  document.addEventListener('pointerdown', resume, true);
  document.addEventListener('click', resume, true);
  document.addEventListener('keydown', resume, true);
}

// ---------- 地区曲 ----------
function pickRegionTrack(first) {
  if (_regionTracks.length === 0) return -1;
  // 指定曲目优先（如开场未白镇），并作为新一轮序列的开头
  if (first) {
    const i = _regionTracks.indexOf(first);
    if (i >= 0) { _lastIdx = i; _regionQueue = []; return i; }
  }
  if (_regionTracks.length === 1) { _lastIdx = 0; return 0; }
  // 序列为空时洗牌一次，整轮播完才重洗，避免老重复同一两首
  if (_regionQueue.length === 0) {
    _regionQueue = _regionTracks.map((_, i) => i);
    for (let i = _regionQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [_regionQueue[i], _regionQueue[j]] = [_regionQueue[j], _regionQueue[i]];
    }
    // 避免与上一首（含跨循环边界）连续重复
    if (_lastIdx >= 0 && _regionQueue[0] === _lastIdx && _regionQueue.length > 1) {
      [_regionQueue[0], _regionQueue[1]] = [_regionQueue[1], _regionQueue[0]];
    }
  }
  _lastIdx = _regionQueue.shift();
  return _lastIdx;
}

function prepareRegionTrack(first) {
  if (_regionTracks.length === 0) { _regionActive = false; return; }
  const i = pickRegionTrack(first);
  _currentRegionPath = _regionTracks[i];
  const url = urlFor(_currentRegionPath);
  // 用 getAttribute 与相对路径比较（audio.src 返回绝对 URL）
  if (regionAudio.getAttribute('src') !== url) regionAudio.src = url;
  applyTrackGain('region', _currentRegionPath);
  regionAudio.onended = () => playRegionTrack(); // 播完自动切下一首
  _regionActive = true;
}

// 旧曲淡出后再淡入新曲；无旧曲播放时直接淡入
function playRegionTrack(first) {
  const token = ++_regionSwitchToken;
  const doPlay = () => {
    if (token !== _regionSwitchToken) return; // 期间又切了歌，放弃本次
    prepareRegionTrack(first);
    if (!_regionActive) return;
    regionAudio.currentTime = 0;
    regionFadeIn();
    tryPlay(regionAudio);
    showNowPlayingFromMeta(_currentRegionPath); // 切歌提示
  };
  if (!regionAudio.paused && regionAudio.src) {
    regionFadeTo(0.0001, REGION_FADE_MS);
    setTimeout(doPlay, REGION_FADE_MS);
  } else {
    doPlay();
  }
}

// 切换地区歌单（firstTrack 可指定第一首）
export function playRegion(name, firstTrack) {
  _regionTracks = REGION_PLAYLISTS[name] || [];
  _lastIdx = -1;
  _regionQueue = []; // 换地区后重置洗牌序列
  if (_overlayActive) {
    // 覆盖曲播放中只备好地区曲，等覆盖曲结束再继续
    prepareRegionTrack(firstTrack);
    return;
  }
  playRegionTrack(firstTrack);
}

// ---------- 覆盖曲（战斗 / 骑行） ----------
function playOverlay(type, src) {
  _overlayActive = true;
  // 同类覆盖曲已在播放时不打断（避免道路切换时骑行曲重播）
  if (_overlayType === type && overlayAudio.getAttribute('src') === src) {
    tryPlay(overlayAudio);
    return;
  }
  _overlayType = type;
  if (!regionAudio.paused) regionAudio.pause();
  if (overlayAudio.getAttribute('src') !== src) overlayAudio.src = src;
  applyTrackGain('overlay', type === 'battle' ? SFX.battle : SFX.cycling);
  overlayAudio.loop = true;
  overlayAudio.currentTime = 0;
  tryPlay(overlayAudio);
}

function endOverlay() {
  if (!_overlayActive) return;
  _overlayActive = false;
  _overlayType = null;
  overlayAudio.pause();
  overlayAudio.currentTime = 0;
  overlayAudio.loop = false;
  // 恢复地区曲，短淡入避免音量骤跳
  if (_regionActive && _regionTracks.length > 0) {
    regionFadeIn(300);
    tryPlay(regionAudio);
  }
}

export function playBattle() {
  if (!_battleMusic) return; // 关闭战斗音乐：战斗期间保持地区曲
  playOverlay('battle', urlFor(SFX.battle));
}
export function endBattle() { if (_overlayType === 'battle') endOverlay(); }
export function playCycling() { playOverlay('cycling', urlFor(SFX.cycling)); }
export function endCycling() { if (_overlayType === 'cycling') endOverlay(); }

// ---------- 瞬发音 ----------
// 播放前暂停背景曲，播完恢复，保证同一时刻只响一首
function playSfx(path) {
  if (!path) return;
  const url = urlFor(path);
  _sfxInterrupted = false; // 新瞬发音效接管，清掉被中断的旧音效标记
  const resumeOverlay = _overlayActive && !overlayAudio.paused;
  const resumeRegion = _regionActive && !regionAudio.paused;
  if (resumeOverlay) overlayAudio.pause();
  if (resumeRegion) regionAudio.pause();
  if (sfxAudio.getAttribute('src') !== url) sfxAudio.src = url;
  applyTrackGain('sfx', path);
  sfxAudio.currentTime = 0;
  sfxAudio.onended = () => {
    _sfxInterrupted = false;
    // 恢复前再校验：覆盖曲可能已结束（如抓捕胜利后战斗已退场）
    if (resumeOverlay && _overlayActive && overlayAudio.getAttribute('src')) tryPlay(overlayAudio);
    else if (resumeRegion && _regionActive && regionAudio.getAttribute('src')) tryPlay(regionAudio);
  };
  tryPlay(sfxAudio);
}

export function playVictory() {
  if (!_battleMusic) return;
  playSfx(SFX.victory);
}
export function playCongratulation() { playSfx(SFX.congratulation); }
export function playObtained() { playSfx(SFX.obtained); }

// 停止胜利音效并恢复背景曲（图鉴对话框交互后调用）
export function stopVictory() {
  if (sfxAudio.getAttribute('src') !== urlFor(SFX.victory)) return;
  _sfxInterrupted = false; // 显式停止胜利音效，清理被中断标记
  if (sfxAudio.paused) return;
  sfxAudio.pause();
  sfxAudio.currentTime = 0;
  if (_overlayActive && overlayAudio.getAttribute('src') && overlayAudio.paused) tryPlay(overlayAudio);
  else if (_regionActive && regionAudio.getAttribute('src') && regionAudio.paused) tryPlay(regionAudio);
}

// ---------- 切歌提示 ----------
// 从 MP3 的 ID3v2 标签读标题/艺术家（文件已重命名为序号）
const _metaCache = {}; // path -> { title, artist }

async function readTrackMeta(path) {
  if (_metaCache[path]) return _metaCache[path];
  try {
    const resp = await fetch(urlFor(path));
    const u8 = new Uint8Array(await resp.arrayBuffer());
    _metaCache[path] = parseId3v2(u8);
  } catch (_) {
    _metaCache[path] = null;
  }
  return _metaCache[path];
}

function showNowPlayingFromMeta(path) {
  readTrackMeta(path).then(meta => {
    const title = meta?.title || path.split('/').pop().replace(/\.mp3$/i, '');
    const artist = meta?.artist || '';
    _currentTitle = title;
    _currentArtist = artist;
    if (_volume <= 0 || _splashLocked || !_musicEnabled) return;
    showNowPlaying(title, artist);
  });
}

// 解析 ID3v2 标签（TIT2=标题, TPE1=艺术家），兼容 v2.3/v2.4
function parseId3v2(u8) {
  if (u8.length < 10 || String.fromCharCode(u8[0], u8[1], u8[2]) !== 'ID3') return null;
  const ver = u8[3];
  const flags = u8[5];
  const size = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
  let off = 10;
  if (flags & 0x40) { // 扩展头
    const extLen = ver >= 4
      ? ((u8[off] & 0x7f) << 21) | ((u8[off + 1] & 0x7f) << 14) | ((u8[off + 2] & 0x7f) << 7) | (u8[off + 3] & 0x7f)
      : (u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3];
    off += ver >= 4 ? extLen : 4 + extLen;
  }
  const end = Math.min(u8.length, 10 + size);
  const tags = {};
  while (off + 10 <= end) {
    const id = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
    if (id.charCodeAt(0) === 0) break;
    const fsize = ver >= 4
      ? ((u8[off + 4] & 0x7f) << 21) | ((u8[off + 5] & 0x7f) << 14) | ((u8[off + 6] & 0x7f) << 7) | (u8[off + 7] & 0x7f)
      : (u8[off + 4] << 24) | (u8[off + 5] << 16) | (u8[off + 6] << 8) | u8[off + 7];
    off += 10; // 跳过帧头与标志位
    if (off + fsize > end) break;
    if (id === 'TIT2' || id === 'TPE1') {
      const enc = u8[off];
      let text = '';
      try {
        if (enc === 1) { // UTF-16（带 BOM）
          const bom = (u8[off + 1] << 8) | u8[off + 2];
          text = new TextDecoder(bom === 0xfeff ? 'utf-16be' : 'utf-16le').decode(u8.subarray(off + 1, off + fsize));
        } else if (enc === 2) { // UTF-16BE
          text = new TextDecoder('utf-16be').decode(u8.subarray(off + 1, off + fsize));
        } else if (enc === 3) { // UTF-8
          text = new TextDecoder('utf-8').decode(u8.subarray(off + 1, off + fsize));
        } else { // 0 = ISO-8859-1
          text = new TextDecoder('latin1').decode(u8.subarray(off + 1, off + fsize));
        }
      } catch (_) {}
      tags[id] = text.replace(/[\u0000\uFEFF]/g, '').trim();
    }
    off += fsize;
  }
  return { title: tags.TIT2, artist: tags.TPE1 };
}

// ---------- 音量 ----------
export function setVolume(v) {
  _volume = Math.max(0, Math.min(1, Number(v) || 0));
  applyVolume();
}

// ---------- 静音 ----------
// 暂停全部通道时记录被中断的瞬发音效（胜利等），恢复时优先补播它，
// 避免背景曲（如战斗曲）抢跑，造成「捕捉已完成但战斗音乐又响起」的状态错乱
function pauseAll() {
  _sfxInterrupted = !sfxAudio.paused && sfxAudio.getAttribute('src');
  if (!sfxAudio.paused) sfxAudio.pause();
  if (!overlayAudio.paused) overlayAudio.pause();
  if (!regionAudio.paused) regionAudio.pause();
}

function resumeBackground() {
  // 瞬发音效被中断时先恢复它（onended 后再由 playSfx 恢复对应背景曲）
  if (_sfxInterrupted && sfxAudio.getAttribute('src')) {
    _sfxInterrupted = false;
    tryPlay(sfxAudio);
    return;
  }
  _sfxInterrupted = false;
  // 恢复背景曲：覆盖曲 > 地区曲
  if (_overlayActive && overlayAudio.getAttribute('src') && overlayAudio.paused) tryPlay(overlayAudio);
  else if (_regionActive && regionAudio.getAttribute('src') && regionAudio.paused) { regionFadeIn(300); tryPlay(regionAudio); }
}

// 音乐开关（设置页/开场顶栏按钮共用）：关闭时暂停所有音频通道（含瞬发音效），重开恢复（覆盖曲 > 地区曲）
export function setMusicEnabled(on) {
  _musicEnabled = on !== false;
  if (!_musicEnabled) pauseAll();
  else resumeBackground();
}

export function isMusicEnabled() { return _musicEnabled; }

// 战斗音乐开关（设置页切换）：关闭后 playBattle 直接忽略，战斗期间地区曲不受影响
export function setBattleMusic(on) { _battleMusic = on !== false; }

// 当前地区曲信息（手机页展示）：playing 表示地区曲此刻实际在发声
export function getNowPlaying() {
  return {
    title: _currentTitle,
    artist: _currentArtist,
    playing: _regionActive && _currentRegionPath && !_splashLocked && _musicEnabled && _volume > 0 && !regionAudio.paused,
  };
}

// splash 动画期间禁声，结束放行并恢复被暂停的背景曲
export function setSplashLocked(locked) {
  _splashLocked = !!locked;
  if (_splashLocked) pauseAll();
  else resumeBackground();
}

// 启动即遭遇时，等这场遭遇结束再补弹一次歌曲卡
let _showCardOnEncounterEnd = false;

export function setShowCardOnEncounterEnd(b) { _showCardOnEncounterEnd = !!b; }

export function consumeShowCardOnEncounterEnd() {
  const v = _showCardOnEncounterEnd;
  _showCardOnEncounterEnd = false;
  return v;
}

// 展示当前地区曲歌曲卡
export function showRegionNowPlaying() {
  if (_volume <= 0 || _splashLocked || !_musicEnabled) return;
  if (!_regionActive || !_currentRegionPath) return;
  showNowPlayingFromMeta(_currentRegionPath);
}

// 初始化：读取存档音量，挂载自动播放恢复监听
export function initAudio(volume) {
  setVolume(volume);
  installResumeListener();
}

// 开场曲（选完主角进入场景后播放未白镇）
export function playIntro() {
  playRegion('丰缘', INTRO_TRACK);
}
