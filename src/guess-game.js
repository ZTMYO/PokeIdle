// ===== 猜宝可梦名字（限时活动「猜宝可梦」的玩法页）=====
// 从候选字里拼出宝可梦名字，答对累加气球。无限刷：答对当场记气球，随时可退。
// 一局的随机（答案、干扰字）用本地随机就够 —— 气球单价是固定的，没有"全服同一份奖励"的问题。
import { $, showView, getCurrentView, tryLoadImage } from './ui.js';
import { pushNav, popNav, allPokemon } from './state.js';
import { TYPE_COLORS, typeIconColor } from './items.js';
import { playMahjongSfx } from './audio.js';

const GUESS_CANDS = 18;    // 候选字格数（3 行 × 6 字）
const GUESS_HINT_BAN = 4;  // 提示一次从候选区划掉几个用不到的字

// 三档难度：答案长短照旧随机，只差候选区里有多少线索 —— 奖励按档给
export const GUESS_LEVELS = [
  { id: 'easy',   name: '简单', reward: 30 },
  { id: 'normal', name: '普通', reward: 60 },
  { id: 'hard',   name: '困难', reward: 120 },
];
export const guessLevelOf = (id) => GUESS_LEVELS.find(l => l.id === id) || GUESS_LEVELS[1];
export const guessReward = (lv, hinted) => (hinted ? Math.round(lv.reward / 2) : lv.reward);

// 题目池：非变体、名字是 2~5 个汉字（多边兽Ⅱ / 属性：空 这类带符号的不要）
// 互为字符重排的名字（奇麒麟 / 麒麟奇）用同一组字，答案选其一时候选区必然也能拼出另一个，
// 没法保证唯一解，同一组字只留一只。存档数据异步加载，池子空时不缓存。
let _pool = null;
function guessPool() {
  if (!_pool || !_pool.length) {
    const all = allPokemon.filter(p => !p.form && /^[\u4e00-\u9fa5]{2,5}$/.test(p.name || ''));
    const seen = new Set();
    _pool = all.filter((p) => {
      const key = [...p.name].sort().join('');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return _pool;
}
export function guessReady() { return guessPool().length > 0; }

let _byName = null;
function guessByName() {
  if (!_byName || !_byName.size) {
    _byName = new Map();
    allPokemon.forEach((p) => {
      const n = p.name || '';
      if (!/^[\u4e00-\u9fa5]{2,5}$/.test(n)) return;
      const prev = _byName.get(n);
      if (!prev || (prev.form && !p.form)) _byName.set(n, p);
    });
  }
  return _byName;
}
const guessNameList = () => [...guessByName().values()];

// 干扰字池：全题库出现过的字去重（答案自身的字另外保留，重复字照留）
let _chars = null;
function guessChars() {
  if (!_chars || !_chars.length) _chars = [...new Set(guessPool().flatMap(p => [...p.name]))];
  return _chars;
}
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 同字数的其他宝可梦，当干扰用（变体已经不在池子里了）
function sameLen(answer) {
  const n = [...answer.name].length;
  return guessPool().filter(p => p.index !== answer.index && [...p.name].length === n);
}

// 简单档：候选区的字都从"完整的同字数名字"里来，铺满后再整片打乱
function easyCands(answer) {
  const n = [...answer.name].length;
  const groups = Math.max(1, Math.floor(GUESS_CANDS / n));
  const picked = shuffled(sameLen(answer)).slice(0, groups - 1);
  const seq = shuffled([answer, ...picked]).flatMap(p => [...p.name]);
  const rest = shuffled(guessChars().filter(c => !seq.includes(c))).slice(0, GUESS_CANDS - seq.length);
  return shuffled([...seq, ...rest]);   // 整片打乱，答案的字不连排，不然一眼就看出来了
}

// 候选字里还能拼出哪些"同字数的合法名字"（排除给定答案）—— 非空说明这题多解了
function extraOf(cands, answers) {
  const cnt = new Map();
  for (const c of cands) cnt.set(c, (cnt.get(c) || 0) + 1);
  const skip = new Set(answers.map(p => p.index));
  const n = [...answers[0].name].length;
  return guessNameList().filter((p) => {
    if (skip.has(p.index) || [...p.name].length !== n) return false;
    const need = new Map();
    for (const c of p.name) need.set(c, (need.get(c) || 0) + 1);
    for (const [c, k] of need) if ((cnt.get(c) || 0) < k) return false;
    return true;
  });
}

// 普通档：答案的字打底，干扰字一个个往上加，加了会拼出别的合法名字就不要 —— 候选区里只剩唯一解
function uniqueCands(answer, src) {
  const chars = [...answer.name];
  const out = chars.slice();
  for (const c of shuffled(src.filter(c => !chars.includes(c)))) {
    if (out.length >= GUESS_CANDS) break;
    out.push(c);
    if (extraOf(out, [answer]).length) out.pop();
  }
  // 干扰字池不够铺满时，再从全字库补
  if (out.length < GUESS_CANDS) {
    for (const c of shuffled(guessChars().filter(c => !chars.includes(c)))) {
      if (out.length >= GUESS_CANDS) break;
      out.push(c);
      if (extraOf(out, [answer]).length) out.pop();
    }
  }
  return shuffled(out);
}

// 困难档出题：两只字数相同、属性完全不重叠的宝可梦，两行各靠行首属性图标认领
function hardPair() {
  const pool = guessPool();
  for (let t = 0; t < 80; t++) {
    const a = pool[Math.floor(Math.random() * pool.length)];
    const n = [...a.name].length;
    const mates = pool.filter(p => p.index !== a.index && [...p.name].length === n
      && !(p.types || []).some(x => (a.types || []).includes(x)));
    if (!mates.length) continue;
    const b = mates[Math.floor(Math.random() * mates.length)];
    if (extraOf([...a.name, ...b.name], [a, b]).length) continue;   // 两只的字自己就能拼出第三只，换一对
    return [a, b];
  }
  return null;
}

// 困难档候选区：干扰字优先从"名字里带答案字的其他宝可梦"里取 —— 字面上跟答案同族，
// 混在一起很难一眼挑出答案；加进去会拼出第三只合法名字的就不要，关联字不够铺满时再借通用字
function hardCands(pair) {
  const base = [...pair[0].name, ...pair[1].name];
  const used = new Set(base);
  const kin = new Set();
  for (const p of guessPool()) {
    const nm = [...p.name];
    if (!nm.some(c => used.has(c))) continue;   // 名字里带答案的某个字
    for (const c of nm) if (!used.has(c)) kin.add(c);   // 这个"同族名字"的其他字
  }
  const out = base.slice();
  const fill = (src) => {
    for (const c of shuffled(src)) {
      if (out.length >= GUESS_CANDS) break;
      out.push(c);
      if (extraOf(out, pair).length) out.pop();
    }
  };
  fill([...kin]);
  if (out.length < GUESS_CANDS) fill(guessChars().filter(c => !used.has(c)));
  return shuffled(out);
}

let _g = null;      // 这一轮的进度（气球、答对数）+ 当前这一题
let _timer = null;  // 换题 / 清空用的延时

// 快照：把还没答完的这一题存下来，退出重进接着答同一题（答对的题不留，重进直接出新题）
function snapshot() {
  if (!_g) return null;
  if (_g.state === 'ok') return null;   // 已经答对记过账了，没必要再留着
  return {
    answers: _g.answers.map(p => p.index),
    cands: _g.cands.slice(),
    slots: _g.slots.slice(),
    src: _g.src.slice(),
    used: _g.used.slice(),
    hinted: _g.hinted,
    banned: _g.banned.slice(),   // 提示划掉的字，留着
  };
}

function saveRound() {
  if (!_g || !_g.onRound) return;
  try { _g.onRound(snapshot()); } catch (e) { console.error('[猜宝可梦] 保存题目出错：', e); }
}

// 恢复上次没答完的题：存档对不上（题库改了、字段缺了）就返回 false，外面重新出题
function restoreRound(r) {
  const ids = Array.isArray(r.answers) ? r.answers : [];
  const answers = ids.map((id) => guessPool().find((p) => p.index === id));
  if (answers.some((p) => !p)) return false;
  if (answers.length !== (_g.lv?.id === 'hard' ? 2 : 1)) return false;   // 存档的档位要和现在选的档位对得上
  const total = answers.reduce((s, p) => s + [...p.name].length, 0);
  if (!Array.isArray(r.cands) || r.cands.length !== GUESS_CANDS) return false;
  if (!Array.isArray(r.slots) || r.slots.length !== total) return false;
  if (!Array.isArray(r.src) || r.src.length !== total) return false;
  if (!Array.isArray(r.used) || r.used.length !== GUESS_CANDS) return false;
  // 存档里答案要用的字不够就重出题
  const need = new Map();
  for (const p of answers) for (const c of p.name) need.set(c, (need.get(c) || 0) + 1);
  const have = new Map();
  for (const c of r.cands) have.set(c, (have.get(c) || 0) + 1);
  for (const [c, k] of need) if ((have.get(c) || 0) < k) return false;
  _g.answers = answers;
  _g.cands = r.cands.slice();
  _g.slots = r.slots.slice();
  _g.src = r.src.slice();
  _g.used = r.used.slice();
  _g.hinted = !!r.hinted;
  _g.banned = Array.isArray(r.banned) ? r.banned.filter((i) => Number.isInteger(i) && i >= 0 && i < GUESS_CANDS) : [];
  // 划掉的字按"整字"对齐：老存档可能只划了同字的一部分，框里被划掉的同字也一并收回
  banChars(new Set(_g.banned.map((i) => _g.cands[i])));
  const first = _g.slots.indexOf('');   // 光标落在最左边的空格上
  _g.cursor = first >= 0 ? first : _g.slots.length - 1;
  _g.gaveUp = false;
  _g.state = 'play';
  return true;
}

// 换一题：简单/普通档一个答案，困难档两只（同字数、属性不重叠），答案长短都随机
function newRound() {
  if (!_g) return;
  const pool = guessPool();
  if (!pool.length) return;
  const lvId = _g.lv?.id || 'normal';
  if (lvId === 'hard') {
    const pair = hardPair();
    if (!pair) return;
    _g.answers = pair;
    _g.cands = hardCands(pair);
  } else {
    const answer = pool[Math.floor(Math.random() * pool.length)];
    _g.answers = [answer];
    _g.cands = lvId === 'easy' ? easyCands(answer) : uniqueCands(answer, guessChars());
  }
  const total = _g.answers.reduce((s, p) => s + [...p.name].length, 0);
  _g.slots = new Array(total).fill('');
  _g.src = new Array(total).fill(-1);
  _g.used = _g.cands.map(() => false);
  _g.hinted = false;   // 这一题有没有用过提示（用过奖励减半）
  _g.banned = [];      // 提示划掉的候选字
  _g.cursor = 0;       // 光标：默认第一个格子
  _g.gaveUp = false;   // 这一题是不是点了放弃（亮答案等"下一题"）
  _g.state = 'play';   // play / ok / bad
  saveRound();
}

function renderHead() {
  if (!_g) return;
  const c = $('gsCoins'), s = $('gsSolved');
  if (c) c.textContent = String(_g.coins);
  if (s) s.textContent = `已答对 ${_g.solved} 题`;
}

// 行首属性图标：困难档当线索一直露着（双属性两个并排）
function typeBadges(types) {
  return (types || []).map(t => `<span class="gs-type" style="background:${TYPE_COLORS[t] || '#888'};color:${typeIconColor(t)}"><svg class="b-move-type-icon"><use xlink:href="#icon-type-${t}"></use></svg></span>`).join('');
}

// 答对揭晓：行首换成这只宝可梦的头像
function pokeBadge(p) {
  return `<span class="gs-type-slot"><img class="gs-poke" data-icon="${p.index}" alt=""></span>`;
}

function renderRound() {
  const slots = $('gsSlots'), cands = $('gsCands');
  if (!_g || !slots || !cands) return;
  const hard = _g.lv?.id === 'hard';
  const done = _g.state === 'ok';
  const cur = _g.state === 'play' ? cursorAt() : -1;   // 光标格（正在等字 / 等着被换掉）
  let base = 0;
  slots.className = 'gs-rows' + (done ? ' ok' : '');
  slots.innerHTML = _g.answers.map((p) => {
    const cells = [...p.name].map((_, k) => {
      const i = base + k, c = _g.slots[i];
      let cls = 'gs-slot' + (c ? ' filled' : '');
      if (done) cls += ' ok';
      else if (_g.state === 'bad') cls += ' bad shake';
      else if (i === cur) cls += ' cur';
      return `<span class="${cls}" data-slot="${i}">${c}</span>`;
    }).join('');
    base += [...p.name].length;
    const icon = done ? pokeBadge(p) : hard ? `<span class="gs-type-slot">${typeBadges(p.types)}</span>` : '';
    return `<div class="gs-row">${icon}${cells}</div>`;
  }).join('');
  if (done) slots.querySelectorAll('img[data-icon]').forEach((img) => {
    const p = _g.answers.find((x) => String(x.index) === img.dataset.icon);
    if (p && p.icon) tryLoadImage(img, p.icon);
  });
  cands.innerHTML = _g.cands.map((c, i) => {
    const cls = 'gs-cand' + (_g.banned.includes(i) ? ' banned' : _g.used[i] ? ' used' : '');
    return `<span class="${cls}" data-cand="${i}">${c}</span>`;
  }).join('');
  const hint = $('gsHint');
  if (hint) hint.className = `catch-confirm-btn${_g.hinted || _g.state !== 'play' ? ' off' : ''}`;
  const ok = $('gsOk');   // 填满了才让点
  if (ok) ok.className = `catch-confirm-btn${_g.state === 'play' && !_g.slots.includes('') ? '' : ' off'}`;
  const skip = $('gsSkip');
  if (skip) {
    if (_g.gaveUp) { skip.textContent = '下一题'; skip.className = 'catch-confirm-btn'; }
    else { skip.textContent = '放弃'; skip.className = `catch-confirm-btn${_g.state !== 'play' ? ' off' : ''}`; }
  }
}

// 光标：当前要填的那一格。点格子能挪它，点候选字就填进去
function cursorAt() {
  if (!_g) return -1;
  const c = _g.cursor;
  return Number.isInteger(c) && c >= 0 && c < _g.slots.length ? c : _g.slots.indexOf('');
}
function nextEmpty(from) {
  for (let i = from + 1; i < _g.slots.length; i++) if (!_g.slots[i]) return i;
  return -1;
}

// 点候选字：填进光标那一格；这格已经有字就先把旧字退回候选区（等于改写）
function pick(ci) {
  if (!_g || _g.state !== 'play' || _g.used[ci] || _g.banned.includes(ci)) return;
  const i = cursorAt();
  if (i < 0) return;
  playMahjongSfx('ui');
  if (_g.slots[i]) _g.used[_g.src[i]] = false;
  _g.slots[i] = _g.cands[ci];
  _g.src[i] = ci;
  _g.used[ci] = true;
  const nxt = nextEmpty(i);   // 光标顺移到下一个空格，连着点字就是从前往后填
  _g.cursor = nxt >= 0 ? nxt : i;
  renderRound();
}

// 点已填的格子：把它退回候选区
function unpick(i) {
  if (!_g || _g.state !== 'play' || !_g.slots[i]) return;
  playMahjongSfx('ui');
  _g.used[_g.src[i]] = false;
  _g.src[i] = -1;
  _g.slots[i] = '';
  _g.cursor = i;   // 光标停在这儿，等着重填
  renderRound();
}

// 点格子：有字的直接拿下来退回候选区，空格的就把光标挪过去
function clickSlot(i) {
  if (!_g || _g.state !== 'play') return;
  if (_g.slots[i]) { unpick(i); return; }
  if (_g.cursor === i) return;
  playMahjongSfx('ui');
  _g.cursor = i;
  renderRound();
}

// 拼出的名字算不算这一行：同字重排，或者任意一只属性对得上的合法宝可梦
function sameName(got, answer) {
  const p = guessByName().get(got);
  if (!p) return null;
  if ([...p.name].sort().join('') === [...answer.name].sort().join('')) return p;
  const at = p.types || [];
  const bt = answer.types || [];
  return at.some(t => bt.includes(t)) ? p : null;
}

// 点「确定」时判定：答对当场记气球、换下一题；答错整排框变红抖一下，填进去的字留着接着改
function check() {
  if (!_g) return;
  const hard = _g.lv?.id === 'hard';
  let hit;   // 简单/普通档 = 拼出的那只宝可梦；困难档 = 两行是否都对上
  if (hard) {
    let base = 0;
    const got = [];
    let ok = true;
    for (const p of _g.answers) {
      const n = [...p.name].length;
      const m = sameName(_g.slots.slice(base, base + n).join(''), p);
      base += n;
      if (!m) { ok = false; break }
      got.push(m);
    }
    if (ok && new Set(got.map(p => p.name)).size !== got.length) ok = false;
    hit = ok ? got : null;
    if (hit) _g.answers = got;
  } else {
    hit = guessByName().get(_g.slots.join('')) || null;   // 拼出的是不是一只宝可梦
  }
  if (hit) {
    const gain = guessReward(_g.lv || guessLevelOf(), _g.hinted);   // 用过提示奖励减半
    if (!hard) _g.answers = [hit];   // 简单档拼出的可能不是出题时选的那只，揭晓就显示拼出来的
    _g.state = 'ok';
    _g.coins += gain;
    _g.solved++;
    if (_g.onFinish) { try { _g.onFinish(gain); } catch (e) { console.error('[猜宝可梦] 结算出错：', e); } }
    saveRound();   // 这题已经结算，存档立刻清掉 —— 不然在换题的间隙刷新还能重答一次
    renderHead();
    renderRound();
    confetti();
    later(() => { if (!_g) return; newRound(); renderRound(); }, 1400);   // 停一下让人看清答案再换题
    return;
  }
  _g.state = 'bad';
  renderRound();
  later(() => {
    if (!_g || _g.state !== 'bad') return;
    _g.state = 'play';   // 只收回红框，字留着
    renderRound();
  }, 900);
}

// 提示划掉的字：整字划掉 —— 候选区里同一个字的所有格子一起划，框里已经放着的同字也一并收回。
// 只划其中一格会出现"同一个字一半划掉一半还能点"，手动退字时划掉的那格还会复活成可用
function banChars(kill) {
  if (!_g || !kill.size) return;
  _g.banned = _g.cands.map((c, i) => i).filter(i => kill.has(_g.cands[i]));
  _g.slots.forEach((c, i) => {
    if (!c || !kill.has(c)) return;
    if (_g.src[i] >= 0) _g.used[_g.src[i]] = false;
    _g.src[i] = -1;
    _g.slots[i] = '';
  });
}

// 提示：从候选区划掉几个用不到的字（每题一次，用过奖励减半）
function hint() {
  if (!_g || _g.state !== 'play' || _g.hinted) return;
  const need = new Set(_g.answers.flatMap(p => [...p.name]));   // 答案要用到的字一个都不能划
  // 按字去重后再挑：同一个字在候选区可能有多个，划掉的是字不是格子
  const spare = [...new Set(_g.cands.filter(c => !need.has(c)))];
  if (!spare.length) return;
  banChars(new Set(shuffled(spare).slice(0, GUESS_HINT_BAN)));
  // 光标别停在已填的格子上：提示刚清出来的空格才是接下来要填的
  if (_g.slots[cursorAt()]) { const e = _g.slots.indexOf(''); if (e >= 0) _g.cursor = e; }
  _g.hinted = true;
  renderRound();
  saveRound();   // 划掉的字当场落盘，退出重进还在
}

// 放弃：把答案直接铺进格子亮出来（不计气球、不算答对），按钮随之变成"下一题"
function giveUp() {
  if (!_g || _g.state !== 'play') return;
  _g.slots = _g.answers.flatMap(p => [...p.name]);
  _g.src = _g.slots.map(() => -1);
  _g.state = 'ok';
  _g.gaveUp = true;
  saveRound();   // 答案都亮出来了，这题不能再续 —— 存档立刻清掉，否则刷新回来能照抄
  renderRound();
}

function later(fn, ms) {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => { _timer = null; fn(); }, ms);
}

// 答对撒彩带：左右下角各抛一波，抛上去再落下来
function confetti() {
  const view = $('guessView');
  if (!view) return;
  const wrap = document.createElement('div');
  wrap.className = 'gs-confetti';
  for (let side = 0; side < 2; side++) {
    const left = side === 0;
    for (let i = 0; i < 16; i++) {
      const el = document.createElement('i');
      const off = 6 + Math.random() * 36;   // 贴着角，稍微散开一点
      el.style.left = left ? `${off}px` : `calc(100% - ${off}px)`;
      el.style.setProperty('--dx', `${((left ? 1 : -1) * (30 + Math.random() * 80)).toFixed(0)}px`);
      el.style.setProperty('--dy', `${(-150 - Math.random() * 110).toFixed(0)}px`);
      el.style.setProperty('--rot', `${(Math.random() * 800 - 400).toFixed(0)}deg`);
      el.style.animation = `gsConfetti ${(1 + Math.random() * 0.45).toFixed(2)}s ease-out ${(Math.random() * 0.12).toFixed(2)}s forwards`;
      wrap.appendChild(el);
    }
  }
  view.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1800);
}

// 页面的 DOM 是固定的，用 onclick 覆盖式绑定，重复进页面也不会叠加
function bindEvents() {
  const slots = $('gsSlots');
  if (slots) slots.onclick = (e) => {
    const el = e.target.closest('.gs-slot');
    if (el) clickSlot(Number(el.dataset.slot));
  };
  const cands = $('gsCands');
  if (cands) cands.onclick = (e) => {
    const el = e.target.closest('.gs-cand');
    if (el) pick(Number(el.dataset.cand));
  };
  const okBtn = $('gsOk');
  if (okBtn) okBtn.onclick = () => {
    if (!_g || _g.state !== 'play' || _g.slots.includes('')) return;
    playMahjongSfx('ui');
    check();
  };
  const skip = $('gsSkip');
  if (skip) skip.onclick = () => {
    if (!_g) return;
    if (_g.gaveUp) {   // 答案已经亮出来了，这一下就是换下一题
      if (_timer) { clearTimeout(_timer); _timer = null; }
      playMahjongSfx('ui');
      newRound();
      renderRound();
      return;
    }
    if (_g.state !== 'play') return;
    playMahjongSfx('ui');
    giveUp();
  };
  const rev = $('gsHint');
  if (rev) rev.onclick = () => {
    if (!_g || _g.state !== 'play' || _g.hinted) return;
    playMahjongSfx('ui');
    hint();
  };
  const back = $('gsBack');
  if (back) back.onclick = () => {
    if (!_g) return;
    playMahjongSfx('ui');
    leaveGuessGame();
  };
}

export function startGuessGame(opts = {}) {
  if (!$('guessView') || !guessReady()) return;
  _g = {
    coins: Number(opts.coins) || 0,   // 顶部数字从活动页带进来，之后每答对一题自己往上加
    solved: Number(opts.solved) || 0,
    lv: guessLevelOf(opts.level),     // 难度档：只影响候选区线索多少和奖励，不影响答案长短
    onFinish: opts.onFinish || null,
    onRound: opts.onRound || null,    // 存题用：换题 / 离开时回调一次，交给活动页落盘
    answers: [], cands: [], slots: [], src: [], used: [], banned: [], hinted: false, gaveUp: false, state: 'play', cursor: 0,
  };
  pushNav('guessView');
  showView('guessView');
  bindEvents();
  // 上次退出去查图鉴留下的题接着答，存档对不上才重新出题
  if (!opts.round || !restoreRound(opts.round)) newRound();
  renderHead();
  renderRound();
}

// 离开：气球在答对时就记过账了，这里不用结算；把当前这题存下来，重进接着答
export function leaveGuessGame() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  saveRound();
  _g = null;
  if (getCurrentView() !== 'guessView') return;
  popNav();
  import('./activity.js').then((m) => {
    if (!m.reopenActivity()) showView('phoneView');   // 活动已下架：退回手机首页
  });
}
