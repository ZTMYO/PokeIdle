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

const regionAudio = new Audio();
regionAudio.preload = 'auto';
const overlayAudio = new Audio();
overlayAudio.preload = 'auto';
const sfxAudio = new Audio();
sfxAudio.preload = 'auto';

// ---------- 响度统一 ----------
// 各曲目响度参差，按 TRACK_GAINS 的 dB 差值实时补偿到未白镇 BGM 的响度，不改音频文件。
let _actx = null;
let _userGestured = false; // 是否已获得用户手势（浏览器 autoplay 解除后才创建 AudioContext）
const _gainNodes = { region: null, overlay: null, sfx: null };
const _trackGain = { region: 1, overlay: 1, sfx: 1 }; // 每路当前的响度补偿系数
let _loopSfx = null; // Web Audio 循环音效：{ source, gain }
const _spinBuffers = new Map();
const _spinLoading = new Map();

function ensureCtx() {
  // 无用户手势时浏览器禁止 AudioContext 启动，创建即输出 "not allowed to start" 且无法拦截：
  // 因此手势前不创建，由 installResumeListener 在首次手势后统一创建并恢复播放
  if (!_userGestured) return null;
  if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
  // 自动播放策略下无用户手势时 resume 会被拒：吞掉该 rejection，待用户手势后由 installResumeListener 统一恢复
  if (_actx.state === 'suspended') _actx.resume().catch(() => {});
  return _actx;
}

// 元素 -> 增益节点 -> 输出
function wireGain(el, key) {
  if (_gainNodes[key]) return;
  try {
    const ctx = ensureCtx();
    if (!ctx) return; // 手势前不建增益节点，音量走元素 volume，恢复后自动补齐响度补偿
    const src = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    src.connect(g);
    g.connect(ctx.destination);
    _gainNodes[key] = g;
  } catch (_) { /* 环境不支持 MediaElementSource 时跳过补偿 */ }
}

function applyTrackGain(key, path) {
  wireGain(key === 'region' ? regionAudio : key === 'overlay' ? overlayAudio : sfxAudio, key);
  const db = TRACK_GAINS[path] ?? 0;
  const comp = Math.pow(10, db / 20);
  _trackGain[key] = comp;
  if (key === 'region') _regionGainLinear = comp;
  const g = _gainNodes[key];
  if (g) g.gain.value = comp;
  applyVolume(); // 元素音量按补偿重算：音量拉高时别让两者相乘超过 1
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
let _sfxInterrupted = false; // 瞬发音效（胜利等）被音乐开关/splash 暂停时置位，恢复时优先补播它

function tryPlay(el) {
  // 页面不可见不起播：隐藏期间新起的曲会一直响到回前台
  if (document.hidden) return;
  if (_splashLocked || _bulkQuiet) return; // splash/批量结算期间不实际发声（状态保留，放行后恢复）
  // 音乐关闭时全局阻断：地区曲/覆盖曲/瞬发音效（victory、孵蛋、交换等）一律不发声
  if (!_musicEnabled) return;
  // 互斥兜底：背景曲/覆盖曲起播前，未播完的瞬发音效（victory 等）一律停掉，保证同时只响一路
  if (el !== sfxAudio && !sfxAudio.paused && sfxAudio.getAttribute('src')) sfxAudio.pause();
  // 互斥兜底：播放覆盖曲前先暂停地区曲；覆盖曲实际发声时禁止地区曲起播，避免两首叠加
  if (el === overlayAudio && !regionAudio.paused) regionAudio.pause();
  if (el === regionAudio && _overlayActive && overlayAudio.src && !overlayAudio.paused) return;
  const p = el.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => { _pending = el; });
  }
}

function applyVolume() {
  // 有增益节点：补偿走节点，元素音量只管"滑块 × 补偿 ≤ 1"防削波；
  // 还没有节点（首次手势前没有 AudioContext）就把补偿折进元素音量，免得启动那首按原始音量响、比之后都大
  const vol = (key, el) => {
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

// 把该继续播放的曲目接回去：被系统挂起、或被自动播放策略拦下后调用
function resumeAudio() {
  if (!_actx) ensureCtx();
  if (_actx && _actx.state === 'suspended') _actx.resume().catch(() => {});
  if (!sfxAudio.paused) return;
  if (!_overlayActive && _regionActive && regionAudio.paused && regionAudio.src) { regionFadeIn(300); tryPlay(regionAudio); }
  if (_overlayActive && overlayAudio.paused && overlayAudio.src) tryPlay(overlayAudio);
  // 兜底：两条通道不该同时出声，按当前覆盖曲状态留一条
  if (!regionAudio.paused && !overlayAudio.paused) {
    if (_overlayActive) regionAudio.pause();
    else { overlayAudio.pause(); overlayAudio.currentTime = 0; }
  }
}

// 页面不可见时停掉音乐与音效，回前台由 resumeAudio 接回；
// 手机端壳层的 appStateChange 也调这对钩子，重复调用无副作用
function pauseAudioForBackground() {
  if (!regionAudio.paused) regionAudio.pause();
  if (!overlayAudio.paused) overlayAudio.pause();
  if (!sfxAudio.paused) sfxAudio.pause();
  stopLoopSfx();
}

// 任何用户交互时补播被拦截的音频；音效/覆盖曲播放中不打断
function installResumeListener() {
  const resume = () => {
    _userGestured = true; // 首次手势后允许创建 AudioContext（autoplay 已解除）
    if (_pending) { const el = _pending; _pending = null; tryPlay(el); return; }
    resumeAudio();
  };
  document.addEventListener('pointerdown', resume, true);
  document.addEventListener('click', resume, true);
  document.addEventListener('keydown', resume, true);
  // 切后台即停乐，回前台接回
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAudioForBackground();
    else resumeAudio();
  });
  window.__POKEIDLE_AUDIO_PAUSE__ = pauseAudioForBackground;
  window.__POKEIDLE_AUDIO_RESUME__ = resumeAudio;
}

// ---------- 地区曲 ----------
// 当前该放哪张歌单：点播模式决定，默认跟着地区
function sourceTracks() {
  if (_musicMode === 'album') {
    const hit = REGION_GENS.find((it) => it.gen === _musicAlbumGen) || REGION_GENS[2];
    return REGION_PLAYLISTS[hit.region] || [];
  }
  if (_musicMode === 'list') return _customTracks;
  return REGION_PLAYLISTS[_currentRegionName] || [];
}

const sameTracks = (a, b) => a.length === b.length && a.every((p, i) => p === b[i]);

// 换掉当前歌单并从它里面接着播（firstTrack 指定时先播那首）
// keepCurrent：保留正在放的那首不切，播完再从新表接（改喜爱列表时用）
function applyTracks(tracks, firstTrack = null, { keepCurrent = false, quick = false } = {}) {
  // 目标歌单和当前这份一模一样：无缝，什么都不动（如人在卡洛斯、点过卡洛斯歌单再点「当前地区」）
  if (!firstTrack && sameTracks(tracks, _regionTracks)) return;
  _regionTracks = tracks;
  _regionQueue = [];
  _lastIdx = tracks.indexOf(_currentRegionPath); // 别一换歌单就重播正在放的那首
  if (keepCurrent) return; // 保持正在放的那首（它不在新表里也照放，播完从新表接下一首）
  if (_overlayActive) { prepareRegionTrack(firstTrack); return; }
  playRegionTrack(firstTrack, quick ? QUICK_FADE_MS : REGION_FADE_MS);
}

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

// 旧曲淡出后再淡入新曲；无旧曲播放时直接淡入。fadeMs 见 QUICK_FADE_MS
function playRegionTrack(first, fadeMs = REGION_FADE_MS) {
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
    regionFadeTo(0.0001, fadeMs);
    setTimeout(doPlay, fadeMs);
  } else {
    doPlay();
  }
}

// 切换地区歌单（firstTrack 可指定第一首）；点播选了固定歌单时，地区不再影响播放内容
export function playRegion(name, firstTrack) {
  const sameRegion = name === _currentRegionName;
  _currentRegionName = name;
  if (_casinoActive) return; // 游戏厅模式：不切换地区曲
  if (_musicMode !== 'region') { // 固定歌单 / 我的喜爱：跨地区不插手
    if (_regionTracks.length && _regionActive) return;
  } else if (sameRegion && !firstTrack && _regionActive) {
    return; // 同一地区被重复触发（启动时开场曲与漫游各叫一次）：别把正在放的这首重开
  }
  applyTracks(sourceTracks(), firstTrack); // 跨地区：走常规 0.7 秒交叉淡出
}

// 音乐页选歌单：mode = 'region' | 'album'（世代 1~9）| 'list'（我的喜爱）
// 返回 false 表示这次没能切（游戏厅里/歌单为空），页面负责给提示
export function setMusicMode(mode, { album = 0, playlist = null, keepCurrent = false } = {}) {
  // 空歌单不切：切了就没曲目表可放（会静音），保留原来的播放
  if (mode === 'list' && !(Array.isArray(playlist) && playlist.length)) return false;
  _musicMode = (mode === 'album' || mode === 'list') ? mode : 'region';
  if (_musicMode === 'album') _musicAlbumGen = Math.min(9, Math.max(1, Number(album) || 3));
  if (_musicMode === 'list') _customTracks = playlist.slice();
  if (_casinoActive) { _pendingModeApply = true; return false; } // 游戏厅里先记下，出场补
  if (!_currentRegionName) return true; // 还没进过地区（开场前）：交给第一次 playRegion
  applyTracks(sourceTracks(), null, { keepCurrent, quick: true }); // 玩家自己点的：立刻切
  return true;
}

// 音乐页点某首：在当前歌单内立刻切过去，之后继续按这份歌单洗牌
export function playTrack(path) {
  if (_casinoActive) return false;
  if (!path || !_regionTracks.includes(path)) return false;
  _currentRegionPath = path; // 先记上：手机上那行高亮/频谱立刻跟手，不用等淡出完
  playRegionTrack(path, QUICK_FADE_MS);
  return true;
}

// ---------- 覆盖曲（战斗 / 骑行） ----------
function playOverlay(type, src) {
  _overlayActive = true;
  _overlayType = type;
  // 覆盖曲播放时保证地区曲暂停（同源重播也走此分支），避免两首叠加
  if (!regionAudio.paused) regionAudio.pause();
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
  // 恢复地区曲，短淡入避免音量骤跳
  if (_regionActive && _regionTracks.length > 0) {
    regionFadeIn(300);
    tryPlay(regionAudio);
  }
}

export function playBattle() {
  if (_casinoActive) { _casinoWantBattle = true; return; } // 游戏厅内不打断，出场时补回战斗曲
  if (!_battleMusic) return; // 关闭战斗音乐：战斗期间保持地区曲
  playOverlay('battle', urlFor(SFX.battle));
}
export function endBattle() {
  if (_overlayType === 'battle') endOverlay();
  else if (_casinoActive) { // 游戏厅期间遭遇已结束：出场时不必再补战斗曲
    _casinoWantBattle = false;
    if (_casinoPrevOverlay === 'battle') _casinoPrevOverlay = null;
  }
}
export function playCycling() {
  if (_casinoActive) return; // 游戏厅模式：阻断骑行音乐
  if (_overlayType === 'cycling') return; // 已在播放骑行曲：直接复用，避免路段轮播反复重置重播
  playOverlay('cycling', urlFor(SFX.cycling));
}
export function endCycling() {
  if (_overlayType === 'cycling') endOverlay();
  else if (_casinoActive && _casinoPrevOverlay === 'cycling') _casinoPrevOverlay = null;
}

// ---------- 游戏厅 ----------
// 进入游戏厅：停掉当前所有音乐（地区曲/覆盖曲/瞬发音），播放 GameCorner.mp3
// 游戏厅内子页面切换不会重复调用此函数，音乐持续播放不中断
export function playCasino() {
  if (_casinoActive && _overlayType === 'casino') return; // 已在播放，不重置
  // 记住进场前的覆盖曲：退出时要还原，否则遇敌/骑行曲会被游戏厅音乐顶掉后回不来
  _casinoPrevOverlay = _overlayActive && _overlayType !== 'casino' ? _overlayType : null;
  _casinoActive = true;
  // 静默停止所有通道
  if (!sfxAudio.paused) sfxAudio.pause();
  if (!overlayAudio.paused) overlayAudio.pause();
  if (!regionAudio.paused) regionAudio.pause();
  _overlayActive = false;
  _overlayType = null;
  _regionActive = false;
  // 使用覆盖曲通道播放游戏厅音乐（与战斗/骑行同组，保证互斥层级）
  playOverlay('casino', urlFor(SFX.casino));
}
// 退出游戏厅：停止游戏厅音乐，按当前上下文恢复覆盖曲或地区曲
export function endCasino() {
  if (!_casinoActive) return;
  _casinoActive = false;
  if (_overlayType === 'casino') endOverlay();
  const prev = _casinoPrevOverlay;
  const wantBattle = _casinoWantBattle;
  _casinoPrevOverlay = null;
  _casinoWantBattle = false;
  // 遭遇未结束：直接接回战斗曲
  if ((wantBattle || prev === 'battle') && _battleMusic) {
    playOverlay('battle', urlFor(SFX.battle));
    return;
  }
  if (prev === 'cycling') {
    playOverlay('cycling', urlFor(SFX.cycling));
    return;
  }
  // 游戏厅里改过点播模式：出场按新模式重开歌单（比接着放旧歌单更符合玩家预期）
  if (_pendingModeApply) {
    _pendingModeApply = false;
    applyTracks(sourceTracks(), null, { quick: true });
    return;
  }
  // 恢复地区曲：endOverlay 因为 _regionActive=false 不会自动恢复，手动补播
  if (_regionTracks.length > 0 && regionAudio.getAttribute('src')) {
    _regionActive = true;
    regionFadeIn(300);
    tryPlay(regionAudio);
  }
}

// ---------- 瞬发音 ----------
// 播放前暂停背景曲，播完恢复，保证同一时刻只响一首
function playSfx(path) {
  if (!path) return;
  if (document.hidden) return; // 页面不可见：一次性的胜利/升级等音效直接丢弃，别在后台响
  if (_splashLocked || _bulkQuiet) return; // splash / 批量结算（后台补算）期间禁声
  const url = urlFor(path);
  _sfxInterrupted = false; // 新瞬发音效接管，清掉被中断的旧音效标记
  // 以"该响什么"为准决定播完恢复谁，而不是此刻的 paused 状态——
  // endBattle 恢复地区曲紧接着 playVictory，region.play() 刚被调用时 paused 可能仍是 true，
  // 若据此判断会漏暂停，导致地区曲与 victory 叠加。改为无条件让位（对已暂停元素 pause 无副作用）
  const resumeOverlay = _overlayActive;
  const resumeRegion = _regionActive;
  if (resumeOverlay && overlayAudio.getAttribute('src')) overlayAudio.pause();
  if (resumeRegion && regionAudio.getAttribute('src')) regionAudio.pause();
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
  if (_casinoActive) return; // 游戏厅模式：阻断胜利音效
  if (!_battleMusic) return;
  playSfx(SFX.victory);
}
export function playCongratulation() {
  if (_casinoActive) return; // 游戏厅模式：阻断祝贺音效
  playSfx(SFX.congratulation);
}
export function playObtained() { playSfx(SFX.obtained); }

// 使用经验糖果升级音效：短促一声、走 playSfx 通道归类「音乐」总开关控制（不受音效/战斗音乐开关影响）
export function playLevelUp() { playSfx(SFX.levelUp); }

// 闪光宝可梦登场音效：短促一声、单独 Audio 叠加不打断背景音乐；
// 归类「音效」开关（_sfxEnabled）控制，独立于音乐/战斗音乐开关
// splash 动画期间调用时不丢弃：记下待补播标记，等 splash 结束（背景曲同时恢复）再补播
// 音量在总音量基础上提响一档（闪光登场是重要提示音，0.6 常见设置下会被背景曲盖住）
// 返回创建的 Audio 实例（splash 锁定或音效关闭时返回 null），供调用方等待播完再衔接后续声音
let _pendingShiny = false;
export function playShiny() {
  if (!_sfxEnabled) return null;
  if (document.hidden) return null; // 页面不可见：直接丢弃，不在后台响
  if (_splashLocked || _bulkQuiet) { _pendingShiny = true; return null; } // 禁声期间记下，放行后补播
  _pendingShiny = false;
  const a = new Audio(urlFor(SFX.shiny));
  a.volume = Math.min(1, _volume * 1.5);
  a.play().catch(() => {});
  return a;
}

// 消费并播放待补播的闪光提示音（splash 结束时由 setSplashLocked(false) 调用）
function flushPendingShiny() {
  if (!_pendingShiny) return;
  _pendingShiny = false;
  if (!_sfxEnabled || document.hidden) return;
  const a = new Audio(urlFor(SFX.shiny));
  a.volume = Math.min(1, _volume * 1.5);
  a.play().catch(() => {});
}

// ---------- 麻将 / 游戏厅瞬发音效 ----------
// 短促音效不打断背景音乐，单独 Audio 叠加；归类「音效」开关（_sfxEnabled），独立于音乐开关
function playShortSfx(url, { loop = false } = {}) {
  if (!_sfxEnabled) return null;
  if (document.hidden) return null; // 页面不可见：不在后台响
  if (_splashLocked || _bulkQuiet) return null; // splash/批量结算期间禁声
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

// 进入老虎机前预解码：首次按停也能走采样级循环，不依赖 HTMLAudio 的 loop 间隙
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

// 停止胜利音效并恢复背景曲（图鉴对话框交互后调用）
export function stopVictory() {
  if (sfxAudio.getAttribute('src') !== urlFor(SFX.victory)) return;
  _sfxInterrupted = false; // 显式停止胜利音效，清理被中断标记
  if (sfxAudio.paused) return;
  sfxAudio.pause();
  sfxAudio.currentTime = 0;
  // 恢复背景曲：覆盖曲 > 地区曲（覆盖曲活跃时绝不恢复地区曲，避免叠加）
  if (_overlayActive && overlayAudio.getAttribute('src')) {
    if (overlayAudio.paused) tryPlay(overlayAudio);
  } else if (_regionActive && regionAudio.getAttribute('src') && regionAudio.paused) tryPlay(regionAudio);
}

// 停止祝贺音效并恢复背景曲（孵蛋/交换页离开时立即停，避免音效残留到其他页面）
export function stopCongratulation() {
  if (sfxAudio.getAttribute('src') !== urlFor(SFX.congratulation)) return;
  _sfxInterrupted = false;
  if (sfxAudio.paused) return;
  sfxAudio.pause();
  sfxAudio.currentTime = 0;
  if (_overlayActive && overlayAudio.getAttribute('src')) {
    if (overlayAudio.paused) tryPlay(overlayAudio);
  } else if (_regionActive && regionAudio.getAttribute('src') && regionAudio.paused) tryPlay(regionAudio);
}

// ---------- 切歌提示 ----------
// 从 MP3 的 ID3v2 标签读标题/艺术家（文件已重命名为序号）
const _metaCache = {}; // path -> { title, artist }

async function readTrackMeta(path) {
  if (_metaCache[path]) return _metaCache[path];
  // 离线标签表优先：省掉整首 mp3 的请求
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

// ---------- 音乐开关 ----------
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
  // 恢复背景曲：覆盖曲 > 地区曲（覆盖曲活跃时绝不恢复地区曲，避免叠加）
  if (_overlayActive && overlayAudio.getAttribute('src')) {
    if (overlayAudio.paused) tryPlay(overlayAudio);
  } else if (_regionActive && regionAudio.getAttribute('src') && regionAudio.paused) {
    regionFadeIn(300); tryPlay(regionAudio);
  }
}

// 音乐开关（设置页与开场顶栏按钮共用）：关闭时暂停所有音频通道（含瞬发音效），重开恢复（覆盖曲 > 地区曲）
export function setMusicEnabled(on) {
  _musicEnabled = on !== false;
  if (!_musicEnabled) pauseAll();
  else resumeBackground();
}

export function isMusicEnabled() { return _musicEnabled; }

// 音效开关（设置页声音分组）：只控制短促效果音（闪光登场、麻将/21点等），独立于音乐开关
export function setSfxEnabled(on) {
  _sfxEnabled = on !== false;
  if (!_sfxEnabled) stopLoopSfx();
}

// 战斗音乐开关（设置页切换）：关闭后 playBattle 直接忽略，战斗期间地区曲不受影响
export function setBattleMusic(on) { _battleMusic = on !== false; }

// 当前地区曲信息（手机页展示）：playing 表示地区曲此刻实际在发声
export function getNowPlaying() {
  return {
    title: _currentTitle,
    artist: _currentArtist,
    path: _currentRegionPath,
    playing: _regionActive && _currentRegionPath && !_splashLocked && !_bulkQuiet && _musicEnabled && _volume > 0 && !regionAudio.paused,
  };
}

// splash 动画期间禁声，结束放行并恢复被暂停的背景曲
export function setSplashLocked(locked) {
  _splashLocked = !!locked;
  if (_splashLocked) pauseAll();
  else {
    resumeBackground();
    flushPendingShiny(); // splash 结束：补播被禁声的闪光提示音，与背景曲同时出来
  }
}

// 批量结算期间禁声：逐场结算不播胜利/闪光等音效，
// 结算结束按当前状态恢复背景曲
export function setBulkQuiet(quiet) {
  _bulkQuiet = !!quiet;
  if (_bulkQuiet) pauseAll();
  else {
    resumeBackground();
    flushPendingShiny();
  }
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
