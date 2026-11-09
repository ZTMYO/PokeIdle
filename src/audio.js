// ===== 背景音乐管理 =====
// 三条通道互斥发声：地区曲 / 覆盖曲（战斗、骑行）/ 瞬发音（胜利、孵蛋、道具）
import { REGION_PLAYLISTS, REGION_GENS, SFX, INTRO_TRACK, TRACK_GAINS } from './regions.js';
import { TRACK_META } from './audio-meta.js';
import { showNowPlaying } from './ui.js';

let _volume = 0.6;
let _musicEnabled = true;  // 背景音乐开关
let _sfxEnabled = true;    // 音效开关（独立于音乐，闪光登场等短促效果音）
let _splashLocked = false; // splash 动画期间禁声
let _bulkQuiet = false;    // 批量结算（后台补算逐场结算）期间禁声，结束后统一恢复
let _battleMusic = true;   // 战斗音乐开关（关闭时战斗保持地区曲）
let _regionTracks = [];    // 当前地区歌单
let _lastIdx = -1;         // 当前播放下标
let _regionQueue = [];     // 当前歌单洗牌序列（全部播完才重洗，保证每首都能轮到）
let _regionActive = false; // 地区曲「应该」在播放
let _overlayActive = false;
let _overlayType = null;   // null | 'battle' | 'cycling' | 'casino'
let _casinoActive = false; // 游戏厅模式：阻断战斗/骑行音乐
let _casinoPrevOverlay = null; // 进游戏厅前的覆盖曲：退出时恢复（否则逛一趟游戏厅就把遇敌曲弄丢）
let _casinoWantBattle = false; // 游戏厅期间仍有未结束的遭遇：退出时直接接回战斗曲
let _currentTitle = '';    // 当前地区曲标题（手机页展示用）
let _currentArtist = '';
// 点播模式（音乐页）：region=当前地区（默认）/ album=固定某一世代 / list=我的喜爱
let _musicMode = 'region';
let _musicAlbumGen = 3;
let _customTracks = [];      // 我的喜爱曲目（音乐页传进来，存档那边自己存）
let _currentRegionName = ''; // 最近一次 playRegion 的地区名：换歌单时当"当前地区"用
let _pendingModeApply = false; // 游戏厅里改过模式：出场时补上

const REGION_FADE_MS = 700; // 地区曲切歌淡入淡出时长（跨地区这种自动切换）
const QUICK_FADE_MS = 150;  // 玩家点歌/换歌单：只够躲开爆音，听着是立刻切
let _regionSwitchToken = 0; // 连续切歌只让最后一次生效
let _currentRegionPath = ''; // 当前地区曲路径
let _regionGainLinear = 1;   // 地区曲响度补偿目标

// ===== 核心改动 1：地区曲音频缓存 =====
// 每首歌一个 Audio 对象，按路径缓存。同一首歌再次播放时复用，不再触发网络请求。
const _regionAudioCache = new Map(); // path -> Audio
let regionAudio = null; // 当前正在用的地区曲 Audio（从缓存里取）

const overlayAudio = new Audio();
overlayAudio.preload = 'auto';
const sfxAudio = new Audio();
sfxAudio.preload = 'auto';

// ---------- 响度统一 ----------
let _actx = null;
let _userGestured = false;
const _gainNodes = { region: null, overlay: null, sfx: null };
const _trackGain = { region: 1, overlay: 1, sfx: 1 };
let _loopSfx = null;
const _spinBuffers = new Map();
const _spinLoading = new Map();

function ensureCtx() {
  if (!_userGestured) return null;
  if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
  if (_actx.state === 'suspended') _actx.resume().catch(() => {});
  return _actx;
}

// 元素 -> 增益节点 -> 输出
function wireGain(el, key) {
  if (_gainNodes[key]) return;
  if (!el) return;
  try {
    const ctx = ensureCtx();
    if (!ctx) return;
    const src = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    src.connect(g);
    g.connect(ctx.destination);
    _gainNodes[key] = g;
  } catch (_) { /* 环境不支持 MediaElementSource 时跳过补偿 */ }
}

// ===== 核心改动 2：地区曲增益节点重新接线 =====
// 切换到缓存的另一个 Audio 时，旧的增益节点绑在旧元素上，必须断开重建。
function rewireRegionGain() {
  const old = _gainNodes.region;
  if (old) {
    try { old.disconnect(); } catch (_) {}
    _gainNodes.region = null;
  }
  if (regionAudio) wireGain(regionAudio, 'region');
}

function applyTrackGain(key, path) {
  if (key === 'region') {
    rewireRegionGain();
  } else {
    wireGain(key === 'overlay' ? overlayAudio : sfxAudio, key);
  }
  const db = TRACK_GAINS[path] ?? 0;
  const comp = Math.pow(10, db / 20);
  _trackGain[key] = comp;
  if (key === 'region') _regionGainLinear = comp;
  const g = _gainNodes[key];
  if (g) g.gain.value = comp;
  applyVolume();
}

function regionFadeTo(value, ms) {
  const g = _gainNodes.region;
  if (!g || !_actx) return;
  const now = _actx.currentTime;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
  g.gain.linearRampToValueAtTime(value, now + ms / 1000);
}

function regionFadeIn(ms = REGION_FADE_MS) {
  const g = _gainNodes.region;
  if (!g || !_actx) return;
  const now = _actx.currentTime;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(_regionGainLinear, now + ms / 1000);
}

function urlFor(path) {
  return './audio/' + path.split('/').map(encodeURIComponent).join('/');
}

let _pending = null;
let _sfxInterrupted = false;

function tryPlay(el) {
  if (!el) return;
  if (document.hidden) return;
  if (_splashLocked || _bulkQuiet) return;
  if (!_musicEnabled) return;
  if (el !== sfxAudio && !sfxAudio.paused && sfxAudio.getAttribute('src')) sfxAudio.pause();
  if (el === overlayAudio && regionAudio && !regionAudio.paused) regionAudio.pause();
  if (el === regionAudio && _overlayActive && overlayAudio.src && !overlayAudio.paused) return;
  const p = el.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => { _pending = el; });
  }
}

function applyVolume() {
  const vol = (key, el) => {
    if (!el) return;
    const comp = _trackGain[key];
    el.volume = _gainNodes[key]
      ? Math.min(_volume, 1 / Math.max(comp, 1))
      : Math.min(1, _volume * comp);
  };
  vol('region', regionAudio);
  vol('overlay', overlayAudio);
  vol('sfx', sfxAudio);
  if (_loopSfx) _loopSfx.gain.gain.value = _volume;
}

function resumeAudio() {
  if (!_actx) ensureCtx();
  if (_actx && _actx.state === 'suspended') _actx.resume().catch(() => {});
  if (!sfxAudio.paused) return;
  if (!_overlayActive && _regionActive && regionAudio && regionAudio.paused && regionAudio.src) { regionFadeIn(300); tryPlay(regionAudio); }
  if (_overlayActive && overlayAudio.paused && overlayAudio.src) tryPlay(overlayAudio);
  if (regionAudio && !regionAudio.paused && !overlayAudio.paused) {
    if (_overlayActive) regionAudio.pause();
    else { overlayAudio.pause(); overlayAudio.currentTime = 0; }
  }
}

function pauseAudioForBackground() {
  if (regionAudio && !regionAudio.paused) regionAudio.pause();
  if (!overlayAudio.paused) overlayAudio.pause();
  if (!sfxAudio.paused) sfxAudio.pause();
  stopLoopSfx();
}

function installResumeListener() {
  const resume = () => {
    _userGestured = true;
    if (_pending) { const el = _pending; _pending = null; tryPlay(el); return; }
    resumeAudio();
    preloadShinySfx();
  };
  document.addEventListener('pointerdown', resume, true);
  document.addEventListener('click', resume, true);
  document.addEventListener('keydown', resume, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAudioForBackground();
    else resumeAudio();
  });
  window.__POKEIDLE_AUDIO_PAUSE__ = pauseAudioForBackground;
  window.__POKEIDLE_AUDIO_RESUME__ = resumeAudio;
}

// ---------- 地区曲 ----------
function sourceTracks() {
  if (_musicMode === 'album') {
    const hit = REGION_GENS.find((it) => it.gen === _musicAlbumGen) || REGION_GENS[2];
    return REGION_PLAYLISTS[hit.region] || [];
  }
  if (_musicMode === 'list') return _customTracks;
  return REGION_PLAYLISTS[_currentRegionName] || [];
}

const sameTracks = (a, b) => a.length === b.length && a.every((p, i) => p === b[i]);

function applyTracks(tracks, firstTrack = null, { keepCurrent = false, quick = false } = {}) {
  if (!firstTrack && sameTracks(tracks, _regionTracks)) return;
  _regionTracks = tracks;
  _regionQueue = [];
  _lastIdx = tracks.indexOf(_currentRegionPath);
  if (keepCurrent) return;
  if (_overlayActive) { prepareRegionTrack(firstTrack); return; }
  playRegionTrack(firstTrack, quick ? QUICK_FADE_MS : REGION_FADE_MS);
}

function pickRegionTrack(first) {
  if (_regionTracks.length === 0) return -1;
  if (first) {
    const i = _regionTracks.indexOf(first);
    if (i >= 0) { _lastIdx = i; _regionQueue = []; return i; }
  }
  if (_regionTracks.length === 1) { _lastIdx = 0; return 0; }
  if (_regionQueue.length === 0) {
    _regionQueue = _regionTracks.map((_, i) => i);
    for (let i = _regionQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [_regionQueue[i], _regionQueue[j]] = [_regionQueue[j], _regionQueue[i]];
    }
    if (_lastIdx >= 0 && _regionQueue[0] === _lastIdx && _regionQueue.length > 1) {
      [_regionQueue[0], _regionQueue[1]] = [_regionQueue[1], _regionQueue[0]];
    }
  }
  _lastIdx = _regionQueue.shift();
  return _lastIdx;
}

// ===== 核心改动 3：从缓存取音频，而不是重设 src =====
function prepareRegionTrack(first) {
  if (_regionTracks.length === 0) { _regionActive = false; return; }
  const i = pickRegionTrack(first);
  _currentRegionPath = _regionTracks[i];
  const path = _currentRegionPath;

  // 从缓存取；没有才新建，并且只在这时发起一次网络请求
  let audio = _regionAudioCache.get(path);
  if (!audio) {
    audio = new Audio(urlFor(path));
    audio.preload = 'auto';
    _regionAudioCache.set(path, audio);
  }

  // 切换当前地区曲元素；旧元素停止，避免两首同时响
  if (regionAudio && regionAudio !== audio) {
    try { regionAudio.pause(); } catch (_) {}
  }
  regionAudio = audio;
  regionAudio.loop = false;
  regionAudio.onended = () => playRegionTrack();

  applyTrackGain('region', path);
  _regionActive = true;
}

function playRegionTrack(first, fadeMs = REGION_FADE_MS) {
  const token = ++_regionSwitchToken;
  const doPlay = () => {
    if (token !== _regionSwitchToken) return;
    prepareRegionTrack(first);
    if (!_regionActive || !regionAudio) return;
    regionAudio.currentTime = 0;
    regionFadeIn();
    tryPlay(regionAudio);
    showNowPlayingFromMeta(_currentRegionPath);
  };
  if (regionAudio && !regionAudio.paused && regionAudio.src) {
    regionFadeTo(0.0001, fadeMs);
    setTimeout(doPlay, fadeMs);
  } else {
    doPlay();
  }
}

export function playRegion(name, firstTrack) {
  const sameRegion = name === _currentRegionName;
  _currentRegionName = name;
  if (_casinoActive) return;
  if (_musicMode !== 'region') {
    if (_regionTracks.length && _regionActive) return;
  } else if (sameRegion && !firstTrack && _regionActive) {
    return;
  }
  applyTracks(sourceTracks(), firstTrack);
}

export function setMusicMode(mode, { album = 0, playlist = null, keepCurrent = false } = {}) {
  if (mode === 'list' && !(Array.isArray(playlist) && playlist.length)) return false;
  _musicMode = (mode === 'album' || mode === 'list') ? mode : 'region';
  if (_musicMode === 'album') _musicAlbumGen = Math.min(9, Math.max(1, Number(album) || 3));
  if (_musicMode === 'list') _customTracks = playlist.slice();
  if (_casinoActive) { _pendingModeApply = true; return false; }
  if (!_currentRegionName) return true;
  applyTracks(sourceTracks(), null, { keepCurrent, quick: true });
  return true;
}

export function playTrack(path) {
  if (_casinoActive) return false;
  if (!path || !_regionTracks.includes(path)) return false;
  _currentRegionPath = path;
  playRegionTrack(path, QUICK_FADE_MS);
  return true;
}

// ---------- 覆盖曲（战斗 / 骑行） ----------
function playOverlay(type, src) {
  _overlayActive = true;
  _overlayType = type;
  if (regionAudio && !regionAudio.paused) regionAudio.pause();
  if (overlayAudio.getAttribute('src') !== src) overlayAudio.src = src;
  applyTrackGain('overlay', type === 'battle' ? SFX.battle : type === 'cycling' ? SFX.cycling : SFX.casino);
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
  if (_regionActive && _regionTracks.length > 0 && regionAudio) {
    regionFadeIn(300);
    tryPlay(regionAudio);
  }
}

export function playBattle() {
  if (_casinoActive) { _casinoWantBattle = true; return; }
  if (!_battleMusic) return;
  playOverlay('battle', urlFor(SFX.battle));
}
export function endBattle() {
  if (_overlayType === 'battle') endOverlay();
  else if (_casinoActive) {
    _casinoWantBattle = false;
    if (_casinoPrevOverlay === 'battle') _casinoPrevOverlay = null;
  }
}
export function playCycling() {
  if (_casinoActive) return;
  if (_overlayType === 'cycling') return;
  playOverlay('cycling', urlFor(SFX.cycling));
}
export function endCycling() {
  if (_overlayType === 'cycling') endOverlay();
  else if (_casinoActive && _casinoPrevOverlay === 'cycling') _casinoPrevOverlay = null;
}

// ---------- 游戏厅 ----------
export function playCasino() {
  if (_casinoActive && _overlayType === 'casino') return;
  _casinoPrevOverlay = _overlayActive && _overlayType !== 'casino' ? _overlayType : null;
  _casinoActive = true;
  if (!sfxAudio.paused) sfxAudio.pause();
  if (!overlayAudio.paused) overlayAudio.pause();
  if (regionAudio && !regionAudio.paused) regionAudio.pause();
  _overlayActive = false;
  _overlayType = null;
  _regionActive = false;
  playOverlay('casino', urlFor(SFX.casino));
}
export function endCasino() {
  if (!_casinoActive) return;
  _casinoActive = false;
  if (_overlayType === 'casino') endOverlay();
  const prev = _casinoPrevOverlay;
  const wantBattle = _casinoWantBattle;
  _casinoPrevOverlay = null;
  _casinoWantBattle = false;
  if ((wantBattle || prev === 'battle') && _battleMusic) {
    playOverlay('battle', urlFor(SFX.battle));
    return;
  }
  if (prev === 'cycling') {
    playOverlay('cycling', urlFor(SFX.cycling));
    return;
  }
  if (_pendingModeApply) {
    _pendingModeApply = false;
    applyTracks(sourceTracks(), null, { quick: true });
    return;
  }
  if (_regionTracks.length > 0 && regionAudio && regionAudio.getAttribute('src')) {
    _regionActive = true;
    regionFadeIn(300);
    tryPlay(regionAudio);
  }
}

// ---------- 瞬发音 ----------
function playSfx(path) {
  if (!path) return;
  if (document.hidden) return;
  if (_splashLocked || _bulkQuiet) return;
  const url = urlFor(path);
  _sfxInterrupted = false;
  const resumeOverlay = _overlayActive;
  const resumeRegion = _regionActive;
  if (resumeOverlay && overlayAudio.getAttribute('src')) overlayAudio.pause();
  if (resumeRegion && regionAudio && regionAudio.getAttribute('src')) regionAudio.pause();
  if (sfxAudio.getAttribute('src') !== url) sfxAudio.src = url;
  applyTrackGain('sfx', path);
  sfxAudio.currentTime = 0;
  sfxAudio.onended = () => {
    _sfxInterrupted = false;
    if (resumeOverlay && _overlayActive && overlayAudio.getAttribute('src')) tryPlay(overlayAudio);
    else if (resumeRegion && _regionActive && regionAudio && regionAudio.getAttribute('src')) tryPlay(regionAudio);
  };
  tryPlay(sfxAudio);
}

export function playVictory() {
  if (_casinoActive) return;
  if (!_battleMusic) return;
  playSfx(SFX.victory);
}
export function playCongratulation() {
  if (_casinoActive) return;
  playSfx(SFX.congratulation);
}
export function playObtained() { playSfx(SFX.obtained); }
export function playLevelUp() { playSfx(SFX.levelUp); }

let _pendingShiny = false;
let _shinyAudio = null;
let _shinyBuffer = null;
let _shinyLoading = null;
let _shinyUntil = 0;

function getShinyAudio() {
  if (!_shinyAudio) {
    _shinyAudio = new Audio(urlFor(SFX.shiny));
    _shinyAudio.preload = 'auto';
  }
  return _shinyAudio;
}

export function preloadShinySfx() {
  const ctx = ensureCtx();
  if (!ctx) return;
  if (_shinyBuffer || _shinyLoading) return;
  _shinyLoading = fetch(urlFor(SFX.shiny))
    .then(r => r.arrayBuffer())
    .then(ab => ctx.decodeAudioData(ab))
    .then(buf => { _shinyBuffer = buf; return buf; })
    .catch(() => null)
    .finally(() => { _shinyLoading = null; });
}

function startShinyPlayback() {
  const ctx = ensureCtx();
  if (ctx && _shinyBuffer) {
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = _shinyBuffer;
    g.gain.value = Math.min(1, _volume * 1.5);
    src.connect(g);
    g.connect(ctx.destination);
    src.start();
    _shinyUntil = performance.now() + _shinyBuffer.duration * 1000;
    return src;
  }
  preloadShinySfx();
  const a = getShinyAudio();
  a.volume = Math.min(1, _volume * 1.5);
  try { a.currentTime = 0; } catch (_) {}
  a.play().catch(() => {});
  _shinyUntil = performance.now() + 1500;
  return a;
}

export function playShiny() {
  if (!_sfxEnabled) return null;
  if (document.hidden) return null;
  if (_splashLocked || _bulkQuiet) { _pendingShiny = true; return null; }
  _pendingShiny = false;
  if (performance.now() < _shinyUntil) return null;
  return startShinyPlayback();
}

function flushPendingShiny() {
  if (!_pendingShiny) return;
  _pendingShiny = false;
  if (!_sfxEnabled || document.hidden) return;
  startShinyPlayback();
}

// ---------- 麻将 / 游戏厅瞬发音效 ----------
function playShortSfx(url, { loop = false } = {}) {
  if (!_sfxEnabled) return null;
  if (document.hidden) return null;
  if (_splashLocked || _bulkQuiet) return null;
  const a = new Audio(url);
  a.loop = !!loop;
  a.volume = _volume;
  a.play().catch(() => {});
  return a;
}

export function playMahjongSfx(name) {
  return playShortSfx(`./audio/mahjong/${encodeURIComponent(name)}.mp3`);
}

const SPIN_FILES = { spin1: 'spin1.wav', spin2: 'spin2.mp3', stop: 'stop.wav', win: 'win.wav' };

function spinUrl(name) {
  const file = SPIN_FILES[name] || `${name}.mp3`;
  return `./audio/spin/${encodeURIComponent(file)}`;
}

function stopLoopSfx() {
  if (!_loopSfx) return;
  try { _loopSfx.source.stop(); } catch (_) {}
  try { _loopSfx.source.disconnect(); _loopSfx.gain.disconnect(); } catch (_) {}
  _loopSfx = null;
}

function loadSpinBuffer(name) {
  const ctx = ensureCtx();
  if (!ctx) return Promise.resolve(null);
  if (_spinBuffers.has(name)) return Promise.resolve(_spinBuffers.get(name));
  if (_spinLoading.has(name)) return _spinLoading.get(name);
  const p = fetch(spinUrl(name))
    .then(r => r.arrayBuffer())
    .then(ab => ctx.decodeAudioData(ab))
    .then(buf => { _spinBuffers.set(name, buf); return buf; })
    .catch(() => null)
    .finally(() => _spinLoading.delete(name));
  _spinLoading.set(name, p);
  return p;
}

export function preloadSpinSfx(name = 'spin1') {
  loadSpinBuffer(name);
}

function startSpinLoop(name) {
  const ctx = ensureCtx();
  const buffer = _spinBuffers.get(name);
  if (!ctx || !buffer) return null;
  stopLoopSfx();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = _volume;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(0);
  _loopSfx = { source, gain };
  return { pause: stopLoopSfx };
}

export function playSpinSfx(name, opts = {}) {
  if (opts.loop) {
    if (!_sfxEnabled || document.hidden || _splashLocked || _bulkQuiet) return null;
    const loop = startSpinLoop(name);
    if (loop) return loop;
    loadSpinBuffer(name);
  }
  return playShortSfx(spinUrl(name), opts);
}

export function playCasinoSfx(name) {
  return playShortSfx(`./audio/casino/${encodeURIComponent(name)}.wav`);
}

export function stopVictory() {
  if (sfxAudio.getAttribute('src') !== urlFor(SFX.victory)) return;
  _sfxInterrupted = false;
  if (sfxAudio.paused) return;
  sfxAudio.pause();
  sfxAudio.currentTime = 0;
  if (_overlayActive && overlayAudio.getAttribute('src')) {
    if (overlayAudio.paused) tryPlay(overlayAudio);
  } else if (_regionActive && regionAudio && regionAudio.getAttribute('src') && regionAudio.paused) tryPlay(regionAudio);
}

export function stopCongratulation() {
  if (sfxAudio.getAttribute('src') !== urlFor(SFX.congratulation)) return;
  _sfxInterrupted = false;
  if (sfxAudio.paused) return;
  sfxAudio.pause();
  sfxAudio.currentTime = 0;
  if (_overlayActive && overlayAudio.getAttribute('src')) {
    if (overlayAudio.paused) tryPlay(overlayAudio);
  } else if (_regionActive && regionAudio && regionAudio.getAttribute('src') && regionAudio.paused) tryPlay(regionAudio);
}

// ---------- 切歌提示 ----------
const _metaCache = {};

async function readTrackMeta(path) {
  if (_metaCache[path]) return _metaCache[path];
  if (TRACK_META[path]) { _metaCache[path] = TRACK_META[path]; return TRACK_META[path]; }
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
    if (_volume <= 0 || _splashLocked || _bulkQuiet || !_musicEnabled) return;
    showNowPlaying(title, artist);
  });
}

function parseId3v2(u8) {
  if (u8.length < 10 || String.fromCharCode(u8[0], u8[1], u8[2]) !== 'ID3') return null;
  const ver = u8[3];
  const flags = u8[5];
  const size = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
  let off = 10;
  if (flags & 0x40) {
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
    off += 10;
    if (off + fsize > end) break;
    if (id === 'TIT2' || id === 'TPE1') {
      const enc = u8[off];
      let text = '';
      try {
        if (enc === 1) {
          const bom = (u8[off + 1] << 8) | u8[off + 2];
          text = new TextDecoder(bom === 0xfeff ? 'utf-16be' : 'utf-16le').decode(u8.subarray(off + 1, off + fsize));
        } else if (enc === 2) {
          text = new TextDecoder('utf-16be').decode(u8.subarray(off + 1, off + fsize));
        } else if (enc === 3) {
          text = new TextDecoder('utf-8').decode(u8.subarray(off + 1, off + fsize));
        } else {
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

// ---------- 音乐开关 ----------
function pauseAll() {
  _sfxInterrupted = !sfxAudio.paused && sfxAudio.getAttribute('src');
  if (!sfxAudio.paused) sfxAudio.pause();
  if (!overlayAudio.paused) overlayAudio.pause();
  if (regionAudio && !regionAudio.paused) regionAudio.pause();
}

function resumeBackground() {
  if (_sfxInterrupted && sfxAudio.getAttribute('src')) {
    _sfxInterrupted = false;
    tryPlay(sfxAudio);
    return;
  }
  _sfxInterrupted = false;
  if (_overlayActive && overlayAudio.getAttribute('src')) {
    if (overlayAudio.paused) tryPlay(overlayAudio);
  } else if (_regionActive && regionAudio && regionAudio.getAttribute('src') && regionAudio.paused) {
    regionFadeIn(300); tryPlay(regionAudio);
  }
}

export function setMusicEnabled(on) {
  _musicEnabled = on !== false;
  if (!_musicEnabled) pauseAll();
  else resumeBackground();
}

export function isMusicEnabled() { return _musicEnabled; }

export function setSfxEnabled(on) {
  _sfxEnabled = on !== false;
  if (!_sfxEnabled) stopLoopSfx();
}

export function setBattleMusic(on) { _battleMusic = on !== false; }

export function getNowPlaying() {
  return {
    title: _currentTitle,
    artist: _currentArtist,
    path: _currentRegionPath,
    playing: _regionActive && _currentRegionPath && !_splashLocked && !_bulkQuiet && _musicEnabled && _volume > 0 && !!regionAudio && !regionAudio.paused,
  };
}

export function setSplashLocked(locked) {
  _splashLocked = !!locked;
  if (_splashLocked) pauseAll();
  else {
    resumeBackground();
    flushPendingShiny();
  }
}

export function setBulkQuiet(quiet) {
  _bulkQuiet = !!quiet;
  if (_bulkQuiet) pauseAll();
  else {
    resumeBackground();
    flushPendingShiny();
  }
}

let _showCardOnEncounterEnd = false;

export function setShowCardOnEncounterEnd(b) { _showCardOnEncounterEnd = !!b; }

export function consumeShowCardOnEncounterEnd() {
  const v = _showCardOnEncounterEnd;
  _showCardOnEncounterEnd = false;
  return v;
}

export function showRegionNowPlaying() {
  if (_volume <= 0 || _splashLocked || !_musicEnabled) return;
  if (!_regionActive || !_currentRegionPath) return;
  showNowPlayingFromMeta(_currentRegionPath);
}

export function initAudio(volume) {
  setVolume(volume);
  installResumeListener();
}

export function playIntro() {
  playRegion('丰缘', INTRO_TRACK);
}
