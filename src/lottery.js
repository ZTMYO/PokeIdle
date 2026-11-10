// ===== 每日抽奖 =====
// 服务器每天固定时间抽一二三等奖；奖品支持道具和蛋。没有账号，只上传匿名标识 + 昵称。
import { $, showView, showConfirmBar, hideConfirmBar, tryLoadImage } from './ui.js';
import { pushNav } from './state.js';
import { prizeName, prizeIcon, grantPrize, normalizePrize } from './prizes.js';
import { DEV } from './build-info.js';
import { installId } from './identity.js';

const ENDPOINT = 'https://pokeidle.shiliu.space/api/lottery';
const CACHE_KEY = 'pokeidle_lottery_cache_v1';
const NAME_KEY = 'pokeidle_lottery_name';
const SEEN_KEY = 'pokeidle_lottery_seen';
const REFRESH_MS = 10 * 60 * 1000;
const MAX_NAME = 8;

let _status = null;
let _srvAt = 0;
let _perfAt = 0;
let _freshAt = 0;
let _loading = null;
let _tick = 0;
let _offline = false;
let _hasLoaded = false;
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

function normTiers(list) {
  return (Array.isArray(list) ? list : []).map((t, i) => {
    const prize = normalizePrize(t && t.prize);
    if (!prize) return null;
    return {
      id: Number(t.id) || i + 1,
      name: String(t.name || `第${i + 1}等奖`),
      count: Math.max(1, Number(t.count) || 1),
      prize,
      winners: (Array.isArray(t.winners) ? t.winners : [])
        .map((w) => (typeof w === 'string' ? { name: w } : w))
        .filter((w) => w && w.name),
    };
  }).filter(Boolean);
}

function tiersOf(s) {
  const tiers = normTiers(s && s.tiers);
  if (tiers.length) return tiers;
  const prize = normalizePrize(s && s.prize);
  if (!prize) return [];
  return [{
    id: 1,
    name: '一等奖',
    count: 1,
    prize,
    winners: s && s.winner ? [{ name: s.winner.name, at: s.winner.at }] : [],
  }];
}

function winsOf(s) {
  if (Array.isArray(s && s.wins)) {
    return s.wins.map((w) => ({
      ...w,
      prize: normalizePrize(w && w.prize),
      tier: w && w.tier ? w.tier : { id: 1, name: '一等奖' },
    })).filter((w) => w.prize);
  }
  if (s && s.winPrize) {
    return [{
      day: s.winDay,
      tier: { id: 1, name: '一等奖' },
      prize: normalizePrize(s.winPrize),
      claimed: !!s.claimed,
      at: 0,
    }].filter((w) => w.prize);
  }
  return [];
}

function afterStatus() {
  announceResult();
  promptWin();
  renderIfOpen();
}

function announceResult() {
  const last = _status && _status.last;
  if (!last || !last.name) return;
  let seen = 0;
  try { seen = Number(localStorage.getItem(SEEN_KEY) || 0); } catch (_) {}
  if ((last.at || 0) <= seen) return;
  try { localStorage.setItem(SEEN_KEY, String(last.at || 0)); } catch (_) {}
  if (!seen) return; // 首次安装不播旧结果
  if (winsOf(_status).some((w) => !w.claimed && w.day === last.date)) return;
  showConfirmBar(`${esc(last.name)} 在每日抽奖中获得了 ${esc(prizeName(last.prizeObj || last.prize))}`, null, null, { noButtons: true });
  const bar = document.getElementById('confirmBar');
  setTimeout(() => { if (bar && document.getElementById('confirmBar') === bar) hideConfirmBar(); }, 4000);
}

function promptWin() {
  const win = winsOf(_status).find((w) => !w.claimed);
  if (!win) return;
  const key = `${win.day}|${win.tier && win.tier.id}`;
  if (_promptedKey === key) return;
  _promptedKey = key;
  showConfirmBar(
    `你被抽中了：${esc(prizeName(win.prize))}<br><span style="opacity:.7">${esc(win.day)} · ${esc((win.tier && win.tier.name) || '一等奖')}</span>`,
    () => { claimLottery(win.day, win.tier && win.tier.id); },
    null,
    { overlay: true },
  );
}

export function hasLotteryDot() {
  return !!(_hasLoaded && _status && winsOf(_status).some((w) => !w.claimed));
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

async function claimLottery(day, tier) {
  if (_claiming) return { ok: false, error: 'busy' };
  if (!onlineAllowed()) {
    showConfirmBar('连不上服务器，稍后再试', null, null, { singleButton: true });
    return { ok: false, error: 'offline' };
  }
  _claiming = true;
  try {
    const data = await post('/claim', `${installId()}|${day || ''}|${tier == null ? '' : tier}`);
    if (data.ok && !data.already && data.prize) {
      const p = normalizePrize(data.prize);
      if (p && grantPrize(p)) {
        showConfirmBar(`已领取 ${esc(prizeName(p))}${p.kind === 'egg' ? '，已放入仓库' : ''}`, null, null, { singleButton: true });
      } else {
        showConfirmBar('奖品发放失败，请联系管理员', null, null, { singleButton: true });
      }
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
  closeLotteryDetail();
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
  const input = $('lotName');
  if (input && (document.activeElement === input || input.value.trim())) return;
  renderLotteryView();
}

function tierCardHtml(t, drawn) {
  const icon = prizeIcon(t.prize);
  const names = (t.winners || []).map((w) => w.name).filter(Boolean);
  const count = drawn ? `${names.length} 名` : `${t.count} 名`;
  return `<div class="lot-tier">
    <span class="lot-tier-rank">${esc(t.name)}</span>
    ${icon ? `<img class="lot-tier-icon" data-icon="${esc(icon)}" alt="">` : ''}
    <span class="lot-tier-prize">${esc(prizeName(t.prize))}</span>
    <span class="lot-tier-right${drawn && !names.length ? ' muted' : ''}">${esc(count)}</span>
  </div>`;
}

function winHtml(w) {
  return `<div class="lot-win">
    <div class="lot-win-title">你被抽中了 · ${esc((w.tier && w.tier.name) || '一等奖')}</div>
    <div class="lot-win-prize">${esc(prizeName(w.prize))}</div>
    <div class="lot-win-sub">${esc(w.day)} 的抽奖 · 未领取</div>
    <button class="lot-btn lot-claim" data-claim-day="${esc(w.day)}" data-claim-tier="${esc((w.tier && w.tier.id) || 1)}">领取奖品</button>
  </div>`;
}

function historyTiers(h) {
  let tiers = normTiers(h && h.tiers);
  if (!tiers.length) {
    const p = normalizePrize(h && h.prize);
    if (p) tiers = [{ id: 1, name: '一等奖', count: 1, prize: p, winners: h && h.name ? [{ name: h.name }] : [] }];
  }
  return tiers;
}

function historyItemHtml(h) {
  const tiers = historyTiers(h);
  const first = tiers[0] || null;
  const firstWinner = first && first.winners && first.winners[0] ? first.winners[0].name : (h && h.name) || '';
  return `<div class="lot-hist-item">
    <div class="lot-row lot-hist-row" data-hist="${esc(h && h.date ? h.date : '')}">
      <span class="lot-row-date">${esc(h && h.date ? String(h.date).slice(5) : '')}</span>
      <span class="lot-row-name">${esc(firstWinner || '无人中奖')}</span>
      <span class="lot-row-prize">${esc(first ? prizeName(first.prize) : '—')}</span>
      <span class="lot-row-more">›</span>
    </div>
  </div>`;
}

function tierDetailHtml(t) {
  const names = (t.winners || []).map((w) => w.name).filter(Boolean);
  const icon = prizeIcon(t.prize);
  const count = `${names.length} 名`;
  return `<div class="lot-detail-tier">
    <div class="lot-detail-head"><span>${esc(t.name)}</span><span class="lot-detail-count">${esc(count)}</span></div>
    <div class="lot-detail-prize">${icon ? `<img class="lot-detail-icon" data-icon="${esc(icon)}" alt="">` : ''}<span>${esc(prizeName(t.prize))}</span></div>
    <div class="lot-detail-winners${names.length ? '' : ' muted'}">${esc(names.length ? names.join('、') : '无人中奖')}</div>
  </div>`;
}

function onLotDetailKey(e) {
  if (e.key === 'Escape') closeLotteryDetail();
}

function closeLotteryDetail() {
  $('lotteryDetailDialog')?.remove();
  document.removeEventListener('keydown', onLotDetailKey);
}

function openLotteryDetail(h) {
  const view = $('lotteryView');
  if (!view || !h) return;
  closeLotteryDetail();
  const tiers = historyTiers(h);
  const date = h.date ? String(h.date) : '';
  const count = Number(h.count) || 0;
  const dlg = document.createElement('div');
  dlg.id = 'lotteryDetailDialog';
  dlg.className = 'lot-detail-overlay';
  dlg.innerHTML = `<div class="lot-detail-panel" role="dialog" aria-modal="true" aria-label="开奖详情">
    <div class="lot-detail-title"><span>开奖详情</span><button type="button" class="lot-detail-close" data-lot-close aria-label="关闭">✕</button></div>
    <div class="lot-detail-body">
      <div class="lot-detail-sub">${esc(date)} · ${count} 人参与</div>
      <div class="lot-detail-list">${tiers.length ? tiers.map((t) => tierDetailHtml(t)).join('') : '<div class="lot-empty">无奖品记录</div>'}</div>
    </div>
    <div class="lot-detail-foot"><button type="button" class="lot-detail-ok" data-lot-close>关闭</button></div>
  </div>`;
  view.appendChild(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeLotteryDetail(); });
  dlg.querySelectorAll('[data-lot-close]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); closeLotteryDetail(); });
  });
  document.addEventListener('keydown', onLotDetailKey);
  dlg.querySelectorAll('img[data-icon]').forEach((img) => tryLoadImage(img, img.dataset.icon));
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
  const tiers = tiersOf(s);
  const wins = winsOf(s).filter((w) => !w.claimed);
  const wonHtml = wins.map(winHtml).join('');
  let stateHtml = '';
  if (s.drawn) {
    const names = tiers.flatMap((t) => (t.winners || []).map((w) => w.name)).filter(Boolean);
    stateHtml = `<div class="lot-state">
        <div class="lot-state-sub">${names.length ? `中奖者：${names.map(esc).join('、')}` : '今日无人中奖'}</div>
      </div>`;
  } else if (s.entered) {
    stateHtml = `<div class="lot-state">
        <div class="lot-state-sub">已参与 · 等待 ${String(drawHourOf(s)).padStart(2, '0')}:00 开奖</div>
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
    ? history.map((h) => historyItemHtml(h)).join('')
    : '<div class="lot-empty">还没有开奖记录</div>';

  box.innerHTML = `<div class="lot-wrap">
    <div class="act-head">
      <span class="act-title">每日抽奖</span>
      <span class="act-badge">今日 <b>${Number(s.count) || 0}</b> 人参与</span>
      <span class="act-left" id="lotCountdown">${s.drawn ? '今日已开奖' : '距开奖 --:--:--'}</span>
    </div>
    ${wonHtml}
    <div class="lot-tiers">${tiers.map((t) => tierCardHtml(t, !!s.drawn)).join('')}</div>
    ${stateHtml}
    <div class="lot-history-title">最近开奖</div>
    <div class="lot-history">${historyHtml}</div>
  </div>`;

  box.querySelectorAll('img[data-icon]').forEach((img) => tryLoadImage(img, img.dataset.icon));
  tickCountdown();
  bindLotteryEvents();
}

function bindLotteryEvents() {
  const box = $('lotteryContent');
  const input = $('lotName');
  if (input) {
    input.addEventListener('input', () => {
      const chars = Array.from(input.value);
      if (chars.length > MAX_NAME) input.value = chars.slice(0, MAX_NAME).join('');
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
  box?.querySelectorAll('[data-claim-day]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = '领取中…';
      claimLottery(btn.dataset.claimDay, btn.dataset.claimTier).then(() => renderLotteryView());
    });
  });
  box?.querySelectorAll('.lot-hist-row').forEach((row) => {
    row.addEventListener('click', () => {
      const list = _status && Array.isArray(_status.history) ? _status.history : [];
      const date = row.dataset.hist;
      const h = list.find((x) => String(x && x.date) === date);
      if (h) openLotteryDetail(h);
    });
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
    : res.error === 'duplicate-name' ? '这个昵称今天已经有人用了，换一个吧'
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
