// ===== 每日抽奖 =====
// 服务器每天 21:00 从当天报名的安装标识里抽一名，奖品是超级进化石。
// 没有账号：只上传本机匿名标识 + 玩家自己填的昵称，服务器存哈希与昵称；开奖结果公开，领奖凭同一个标识。
import { $, showView, showConfirmBar, hideConfirmBar, tryLoadImage } from './ui.js';
import { pushNav, saveGame } from './state.js';
import { grantItem, itemIconSrc } from './items.js';
import { ITEM_NAMES } from './config.js';
import { DEV } from './build-info.js';
import { installId } from './identity.js';

const ENDPOINT = 'https://pokeidle.shiliu.space/api/lottery';
const CACHE_KEY = 'pokeidle_lottery_cache_v1';
const NAME_KEY = 'pokeidle_lottery_name';
const SEEN_KEY = 'pokeidle_lottery_seen';
const REFRESH_MS = 10 * 60 * 1000;
const MAX_NAME = 8;

let _status = null;      // 服务器最近一次返回的完整状态
let _srvAt = 0;          // 对齐用的服务器时刻
let _perfAt = 0;
let _freshAt = 0;
let _loading = null;
let _tick = 0;
let _offline = false;
let _hasLoaded = false;  // 本次启动成功连上过服务器：没连上时手机里不摆这个入口
let _uiTimer = null;
let _drawFetchAt = 0;
let _promptedKey = '';
let _claiming = false;

function onlineAllowed() {
  if (!DEV) return true;
  try { return localStorage.getItem('pokeidle_online') === '1'; } catch (_) { return false; }
}

function serverNow() {
  return _perfAt ? _srvAt + (performance.now() - _perfAt) : Date.now();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function apply(data) {
  if (!data || !data.ok) return false;
  const first = !_hasLoaded;
  _hasLoaded = true;
  _status = data;
  _srvAt = Number(data.serverNow) || Date.now();
  _perfAt = performance.now();
  _freshAt = Date.now();
  _offline = false;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch (_) {}
  if (first) import('./phone.js').then((m) => m.refreshPhoneHome()).catch(() => {});
  return true;
}

export function hasLottery() { return _hasLoaded; }

function loadCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!data || !data.ok || typeof data.serverNow !== 'number') return false;
    _status = data;
    const drift = Math.max(0, Date.now() - (data.savedAt || Date.now()));
    _srvAt = data.serverNow + drift;
    _perfAt = performance.now();
    return true;
  } catch (_) { return false; }
}

async function post(path, body, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${ENDPOINT}${path}`, { method: 'POST', body, cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadLottery(force = false) {
  if (!onlineAllowed()) return false;
  if (_loading) return _loading;
  if (!force && _freshAt && Date.now() - _freshAt < REFRESH_MS) return true;
  _loading = (async () => {
    try {
      const data = await post('/me', installId());
      if (!apply(data)) throw new Error('格式不对');
      afterStatus();
      return true;
    } catch (e) {
      _offline = true;
      console.warn('[抽奖] 拉取失败：', e.name === 'AbortError' ? '超时(8s)' : e.message);
      renderIfOpen();
      return false;
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

function afterStatus() {
  announceResult();
  promptWin();
  renderIfOpen();
}

function announceResult() {
  const last = _status && _status.last;
  if (!last || !last.at || !last.name) return;
  let seen = 0;
  try { seen = Number(localStorage.getItem(SEEN_KEY) || 0); } catch (_) {}
  if (last.at <= seen) return;
  try { localStorage.setItem(SEEN_KEY, String(last.at)); } catch (_) {}
  if (!seen) return;   // 首次安装不播旧结果
  if (_status.won && _status.winDay === last.date) return;   // 自己中了，走领奖弹窗
  showConfirmBar(`${esc(last.name)} 在每日抽奖中获得了 ${esc(ITEM_NAMES[last.prize] || last.prize)}`, null, null, { noButtons: true });
  const bar = document.getElementById('confirmBar');
  setTimeout(() => { if (bar && document.getElementById('confirmBar') === bar) hideConfirmBar(); }, 4000);
}

function promptWin() {
  if (!_status || !_status.won || _status.claimed) return;
  const key = `${_status.winDay}|${_status.winPrize}`;
  if (_promptedKey === key) return;
  _promptedKey = key;
  const prize = esc(ITEM_NAMES[_status.winPrize] || _status.winPrize);
  showConfirmBar(`你被抽中了：${prize}<br><span style="opacity:.7">${esc(_status.winDay)} 的每日抽奖</span>`, () => { claimLottery(); }, null, { overlay: true });
}

export function hasLotteryDot() {
  return !!(_hasLoaded && _status && _status.won && !_status.claimed);
}

async function enterLottery(rawName) {
  if (!onlineAllowed()) return { ok: false, error: 'offline' };
  const name = String(rawName || '').trim();
  if (!name) return { ok: false, error: 'empty' };
  if (name.includes('|')) return { ok: false, error: 'bad' };
  if (Array.from(name).length > MAX_NAME) return { ok: false, error: 'long' };
  try {
    const data = await post('/enter', `${installId()}|${name}`);
    if (data && data.ok) {
      try { localStorage.setItem(NAME_KEY, name); } catch (_) {}
      if (_status) {
        _status.entered = true;
        _status.count = data.count;
        _status.drawAt = data.drawAt;
        _status.drawn = false;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ..._status, savedAt: Date.now() })); } catch (_) {}
      }
    } else if (data && data.error === 'closed') {
      loadLottery(true);
    }
    return data || { ok: false, error: 'network' };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

async function claimLottery() {
  if (_claiming) return { ok: false, error: 'busy' };
  if (!onlineAllowed()) {
    showConfirmBar('连不上服务器，稍后再试', null, null, { singleButton: true });
    return { ok: false, error: 'offline' };
  }
  _claiming = true;
  try {
    const data = await post('/claim', installId());
    if (data.ok && !data.already && data.prize) {
      grantItem(data.prize, 1, '抽奖');
      await saveGame();
      if (_status) {
        _status.claimed = true;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ..._status, savedAt: Date.now() })); } catch (_) {}
        renderIfOpen();
      }
      showConfirmBar(`已领取 ${esc(ITEM_NAMES[data.prize] || data.prize)} ×1`, null, null, { singleButton: true });
      loadLottery(true);
    } else if (data.already) {
      showConfirmBar('这个奖品已经领取过了', null, null, { singleButton: true });
      loadLottery(true);
    } else {
      showConfirmBar('没有可领取的奖品', null, null, { singleButton: true });
      loadLottery(true);
    }
    return data;
  } catch (e) {
    showConfirmBar('领取失败，请稍后再试', null, null, { singleButton: true });
    return { ok: false, error: 'network' };
  } finally {
    _claiming = false;
  }
}

// ---------- 页面 ----------
function ensureLotteryView() {
  let view = $('lotteryView');
  if (!view) {
    const host = $('phoneView')?.parentElement;
    if (!host) return null;
    view = document.createElement('div');
    view.id = 'lotteryView';
    view.className = 'view-fixed view-list';
    view.style.display = 'none';
    const content = document.createElement('div');
    content.id = 'lotteryContent';
    content.className = 'list-scroll';
    view.appendChild(content);
    host.appendChild(view);
  }
  return view;
}

export function showLotteryView() {
  if (!ensureLotteryView()) return;
  pushNav('lotteryView');
  showView('lotteryView');
  renderLotteryView();
  if (!_status) {
    loadCache();
    renderLotteryView();
  }
  startUiTimer();
  if (!_status || Date.now() - _freshAt > 60000) loadLottery(true);
}

function startUiTimer() {
  clearInterval(_uiTimer);
  _uiTimer = setInterval(() => {
    const view = $('lotteryView');
    if (!view || view.style.display === 'none') {
      clearInterval(_uiTimer);
      _uiTimer = null;
      return;
    }
    tickCountdown();
  }, 1000);
}

function dayText(ms) {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function drawHourOf(s) {
  const h = Number(s && s.drawHour);
  return Number.isFinite(h) ? h : new Date(s.drawAt).getHours();
}

function fmtLeft(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function tickCountdown() {
  const el = $('lotCountdown');
  if (!el || !_status) return;
  if (_status.drawn) {
    el.textContent = '今日已开奖';
    return;
  }
  const left = _status.drawAt - serverNow();
  if (left <= 0) {
    el.textContent = '正在开奖…';
    if (Date.now() - _drawFetchAt > 30000) {
      _drawFetchAt = Date.now();
      loadLottery(true);
    }
    return;
  }
  el.textContent = `距开奖 ${fmtLeft(left)}`;
}

function renderIfOpen() {
  const view = $('lotteryView');
  if (!view || view.style.display === 'none') return;
  // 正在输入昵称时不重画，免得轮询把输入框清掉
  const input = $('lotName');
  if (input && (document.activeElement === input || input.value.trim())) return;
  renderLotteryView();
}

function renderLotteryView() {
  const box = $('lotteryContent');
  if (!box) return;
  const s = _status;
  if (!s) {
    box.innerHTML = `<div class="roster-empty">${_offline ? '连不上服务器<br>稍后再试' : '正在连接服务器…'}</div>`;
    return;
  }
  const savedName = (() => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; } })();
  const prizeName = ITEM_NAMES[s.prize] || s.prize || '待定';
  const prizeIcon = s.prize ? itemIconSrc(s.prize) : '';
  const wonHtml = s.won && !s.claimed
    ? `<div class="lot-win">
        <div class="lot-win-title">你被抽中了</div>
        <div class="lot-win-prize">${esc(ITEM_NAMES[s.winPrize] || s.winPrize)}</div>
        <div class="lot-win-sub">${esc(s.winDay)} 的抽奖 · 未领取</div>
        <button class="lot-btn lot-claim" id="lotClaim">领取奖品</button>
      </div>`
    : '';
  let stateHtml = '';
  if (s.drawn) {
    stateHtml = `<div class="lot-state">
        <div class="lot-state-main">${s.winner ? `中奖者：${esc(s.winner.name)}` : '今日无人参与'}</div>
        <div class="lot-state-hint">下一次开奖：明天 ${String(drawHourOf(s)).padStart(2, '0')}:00</div>
      </div>`;
  } else if (s.entered) {
    stateHtml = `<div class="lot-state">
        <div class="lot-state-main">已参与</div>
        <div class="lot-state-sub">等待 ${String(drawHourOf(s)).padStart(2, '0')}:00 开奖</div>
      </div>`;
  } else {
    stateHtml = `<div class="lot-state">
        <div class="lot-input-row">
          <input id="lotName" class="lot-input" maxlength="${MAX_NAME}" autocomplete="off" placeholder="输入昵称，最多 ${MAX_NAME} 个字" value="${esc(savedName)}" />
          <button class="lot-btn" id="lotEnter">参与抽奖</button>
        </div>
        <div class="lot-msg" id="lotMsg"></div>
      </div>`;
  }
  const history = Array.isArray(s.history) ? s.history : [];
  const historyHtml = history.length
    ? history.map((h) => `<div class="lot-row">
        <span class="lot-row-date">${h.date ? String(h.date).slice(5) : dayText(h.at)}</span>
        <span class="lot-row-name">${esc(h.name || '—')}</span>
        <span class="lot-row-prize">${esc(ITEM_NAMES[h.prize] || h.prize)}</span>
      </div>`).join('')
    : '<div class="lot-empty">还没有开奖记录</div>';

  box.innerHTML = `<div class="lot-wrap">
    <div class="act-head">
      <span class="act-title">每日抽奖</span>
      <span class="act-badge">今日 <b>${Number(s.count) || 0}</b> 人参与</span>
      <span class="act-left" id="lotCountdown">${s.drawn ? '今日已开奖' : '距开奖 --:--:--'}</span>
    </div>
    ${wonHtml}
    <div class="lot-prize act-card">
      ${prizeIcon ? `<img class="lot-prize-icon" data-icon="${esc(prizeIcon)}" alt="">` : ''}
      <div class="lot-prize-info">
        <div class="lot-prize-label">今日奖品</div>
        <div class="lot-prize-name">${esc(prizeName)}</div>
      </div>
    </div>
    ${stateHtml}
    <div class="lot-history-title">最近开奖</div>
    <div class="lot-history">${historyHtml}</div>
  </div>`;

  box.querySelectorAll('img[data-icon]').forEach((img) => tryLoadImage(img, img.dataset.icon));
  tickCountdown();
  bindLotteryEvents();
}

function bindLotteryEvents() {
  const input = $('lotName');
  if (input) {
    input.addEventListener('input', () => {
      const chars = Array.from(input.value);
      if (chars.length > MAX_NAME) input.value = chars.slice(0, MAX_NAME).join('');
      // 输入即缓存：没报名就退出，下次打开也能接着用；清空则删掉
      try {
        if (input.value.trim()) localStorage.setItem(NAME_KEY, input.value);
        else localStorage.removeItem(NAME_KEY);
      } catch (_) {}
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doEnter(); }
    });
  }
  $('lotEnter')?.addEventListener('click', doEnter);
  $('lotClaim')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '领取中…';
    claimLottery().then(() => renderLotteryView());
  });
}

async function doEnter() {
  const input = $('lotName');
  const msg = $('lotMsg');
  const btn = $('lotEnter');
  if (!input || !btn || btn.disabled) return;
  const name = input.value.trim();
  if (!name) { if (msg) msg.textContent = '先填一个昵称'; input.focus(); return; }
  if (Array.from(name).length > MAX_NAME) { if (msg) msg.textContent = `最多 ${MAX_NAME} 个字`; return; }
  btn.disabled = true;
  btn.textContent = '提交中…';
  const res = await enterLottery(name);
  if (res.ok) {
    showConfirmBar('已参与今日抽奖', null, null, { noButtons: true });
    const bar = document.getElementById('confirmBar');
    setTimeout(() => { if (bar && document.getElementById('confirmBar') === bar) hideConfirmBar(); }, 2200);
    renderLotteryView();
    return;
  }
  btn.disabled = false;
  btn.textContent = '参与抽奖';
  const text = res.error === 'closed' ? '今日已开奖，明天再来'
    : res.error === 'network' ? '连不上服务器，稍后再试'
      : res.error === 'long' ? `最多 ${MAX_NAME} 个字`
        : res.error === 'bad' ? '昵称里不能有竖线'
          : '报名失败，稍后再试';
  if (msg) msg.textContent = text;
}

export function startLotteryRefresh() {
  loadCache();
  loadLottery(true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadLottery(); });
  window.addEventListener('online', () => loadLottery(true));
  setInterval(() => {
    if (document.hidden) return;
    if (_status && !_status.drawn && serverNow() >= _status.drawAt) loadLottery(true);
    else if (++_tick % 10 === 0) loadLottery();
  }, 60000);
}
