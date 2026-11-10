// ===== 孵蛋周：培育奶奶的摊位 =====
// 普通饲育屋的繁殖规则，活动期内可反复开批次；每轮 2~5 分钟，结束后亲本自动回仓库。
import { gameData, getPokemonByIndex, isPokemon, ensureGender, genderBadge } from './state.js';
import { tryLoadImage } from './ui.js';
import { checkPairing, berryDemand, createEggEntry, pairStatusHtml, pairRole, removeNurseryByPokemon, MAX_BREED_ROUNDS } from './nursery.js';

const EGG_WEEK_DAYS = 7;
const ROUND_MIN = 2 * 60 * 1000;
const ROUND_MAX = 5 * 60 * 1000;
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ensureSlot(ctx) {
  const s = ctx.slot;
  if (!Array.isArray(s.parents)) s.parents = [null, null];
  while (s.parents.length < 2) s.parents.push(null);
  s.rounds = Math.max(1, Math.min(MAX_BREED_ROUNDS, Math.round(Number(s.rounds) || 1)));
  if (!('lockedIv' in s)) s.lockedIv = null;
  if (!s.lockInit) {
    s.lockInit = true;
    s.lockedIv = { key: 'hp', source: 'a' };
  }
  if (!('useIncense' in s)) s.useIncense = false;
  if (!('breeding' in s)) s.breeding = null;
  if (!('lastEggAt' in s)) s.lastEggAt = 0;
  s.breedFillId = 'eggWeekFill';
  s.breedRemainId = 'eggWeekRemain';
  s.eventTo = Number(ctx.to) || 0;
  return s;
}

const parentId = (p) => p && (p.id || p);
function rosterEntry(id) {
  return id ? (gameData.roster || []).find((x) => x.id === id) : null;
}
function pairInfo(s) {
  const ea = rosterEntry(parentId(s.parents[0]));
  const eb = rosterEntry(parentId(s.parents[1]));
  const valid = !!(ea && eb && ea.inRoster !== false && eb.inRoster !== false);
  return { ea, eb, valid, r: valid ? checkPairing(ea, eb, false) : null };
}

// 第二个槽只列出能和另一只配对的；蛋组/性别/百变怪规则都在 checkPairing 里
function excludeForSlot(s, i) {
  const ex = new Set();
  const otherId = parentId(s.parents[1 - i]);
  if (otherId) ex.add(otherId);
  const other = rosterEntry(otherId);
  for (const p of gameData.roster || []) {
    if (!p.inRoster || (p.kind && p.kind === 'egg')) { ex.add(p.id); continue; }
    const poke = getPokemonByIndex(String(p.species));
    if (!poke || poke.noEggGroup) { ex.add(p.id); continue; }
    if (other && !checkPairing(other, p).ok) ex.add(p.id);
  }
  return [...ex];
}

// 占用的宝可梦也显示在列表里；选中后按训练/配队的做法确认，再撤下原占用
function handlePicks(ctx, s) {
  for (let i = 0; i < 2; i++) {
    const rid = ctx.picks?.[i];
    if (!rid) continue;
    ctx.setPick(i, null);
    handlePick(ctx, s, i, rid);
  }
}

function handlePick(ctx, s, i, rid) {
  const entry = rosterEntry(rid);
  const other = parentId(s.parents[1 - i]);
  if (!entry || !isPokemon(entry) || rid === other) return;
  Promise.all([
    import('./train.js').then((m) => m.isTrainingPokemon(rid)),
    import('./team.js').then((m) => m.isInAnyTeam(rid)),
    import('./dispatch.js').then((m) => m.isDispatchPokemon(rid)),
  ]).then(([inTrain, inTeam, inDispatch]) => {
    const inMain = (gameData.nursery?.parents || []).some((p) => p && (p.id || p) === rid);
    const inStall = (s.parents || []).some((p, j) => j !== i && p && (p.id || p) === rid);
    const occ = [];
    if (inTeam) occ.push('队伍');
    if (inTrain) occ.push('训练');
    if (inDispatch) occ.push('派遣');
    if (inMain) occ.push('饲育屋');
    if (inStall) occ.push('孵蛋周');
    const place = () => {
      if (inTeam) import('./team.js').then((m) => m.removePokemonFromAllTeams(rid));
      if (inTrain) import('./train.js').then((m) => m.removeTrainingByPokemon(rid));
      if (inDispatch) import('./dispatch.js').then((m) => m.removeDispatchByPokemon(rid));
      if (inMain || inStall) removeNurseryByPokemon(rid);
      s.parents[i] = { id: rid, placedAt: Date.now() };
      ctx.save();
      ctx.refresh();
    };
    if (occ.length) {
      ctx.confirm(`这只宝可梦正在${occ.join('、')}中。放入孵蛋周将自动将其撤下，确定放入？`, place);
    } else {
      place();
    }
  }).catch(() => {});
}

function slotHtml(s, i, running) {
  const id = parentId(s.parents[i]);
  const entry = rosterEntry(id);
  if (!entry || entry.inRoster === false) {
    return `<div class="nursery-slot empty eggweek-slot" data-slot="${i}" title="点击放入宝可梦">＋</div>`;
  }
  const poke = getPokemonByIndex(String(entry.species));
  const name = entry.nickname || (poke ? poke.name : `#${entry.species}`);
  const egg = poke && (poke.eggGroup || []).length
    ? poke.eggGroup.join(' / ')
    : poke?.noEggGroup ? '未发现蛋组' : '—';
  return `<div class="nursery-slot eggweek-slot" data-slot="${i}" title="${running ? '繁殖中，点击取出会终止剩余轮次' : '点击取出'}">
    <img class="nursery-slot-icon" data-icon="${entry.species}" alt="">
    <div class="nursery-slot-info">
      <div class="nursery-slot-name"><span class="nursery-slot-nick">${esc(name)}</span><em>${genderBadge(ensureGender(entry))}</em></div>
      <div class="nursery-slot-egg">${esc(egg)}</div>
    </div>
  </div>`;
}

function fmtRemain(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const BREED_LINES = [
  '{pair}相处得不错，再等等看吧。',
  '看样子{pair}合得来，蛋还在孕育着呢。',
  '不必心急，{pair}正待在一块儿。',
  '{pair}关系挺好，再过一阵子或许会有惊喜。',
  '{pair}正相伴静养，奶奶会好好看着的。',
  '{pair}相处和睦，耐心等候一阵吧。',
  '{pair}聊得很投机，说不定很快就有蛋了。',
  '我会好好照看{pair}，你不用太着急。',
  '{pair}暂时还没什么动静，再稍等片刻。',
  '{pair}相处得十分要好，奶奶看着也高兴。',
  '{pair}正凑在一起说悄悄话呢。',
  '奶奶给{pair}添了点暖，再等一会儿。',
  '{pair}都挺乖的，蛋的事交给奶奶。',
];
const PAIR_WORDS = ['两个小家伙', '这两个小家伙', '它们俩', '这对小家伙'];

function nameOf(id) {
  const entry = rosterEntry(id);
  if (!entry) return '宝可梦';
  const poke = getPokemonByIndex(String(entry.species));
  return entry.nickname || (poke ? poke.name : `#${entry.species}`);
}

// 同一批/同一轮用同一句，刷新不会闪字；每产出一轮换一句
function breedingLine(s) {
  const a = nameOf(parentId(s.parents[0]));
  const b = nameOf(parentId(s.parents[1]));
  const b0 = s.breeding || {};
  const seed = (Number(b0.startedAt) || 0) + (Number(b0.roundsDone) || 0) * 7919;
  const usePairWord = seed % 10 < 3;
  const pair = usePairWord
    ? PAIR_WORDS[Math.floor(seed / 10) % PAIR_WORDS.length]
    : `${a}和${b}`;
  return BREED_LINES[Math.floor(seed / 37) % BREED_LINES.length].replace('{pair}', pair);
}

function sayText(ctx, s, pair) {
  if (s.breeding) return breedingLine(s);
  if (ctx.left < 10 * 60 * 1000) return '摊子快收啦，要孵就趁现在。';
  if (pair.ea && pair.eb) {
    if (pair.valid && pair.r && pair.r.ok) return '嗯，这两只挺般配。';
    return '这两个小家伙凑不到一块儿呀。';
  }
  if (pair.ea || pair.eb) return '再挑一只吧。';
  if (s.lastEggAt) return '这批蛋都放你仓库了。';
  return '今天想孵点什么？';
}

function settle(ctx) {
  const s = ensureSlot(ctx);
  const b = s.breeding;
  if (!b) return 0;
  const ea = rosterEntry(parentId(s.parents[0]));
  const eb = rosterEntry(parentId(s.parents[1]));
  if (!ea || !eb || ea.inRoster === false || eb.inRoster === false) {
    s.breeding = null;
    s.parents = [null, null];
    ctx.save();
    return 0;
  }
  const target = Math.min(b.roundsTotal, Math.floor((Date.now() - b.startedAt) / b.durMs));
  let produced = 0;
  while (b.roundsDone < target) {
    const r0 = checkPairing(ea, eb, false);
    const r1 = checkPairing(ea, eb, true);
    const useIncense = !!s.useIncense && r0.ok && r1.ok && r1.childSpecies !== r0.childSpecies;
    const r = useIncense ? r1 : r0;
    if (!r.ok) {
      s.breeding = null;
      ctx.save();
      break;
    }
    const entry = createEggEntry(ea, eb, r.childSpecies, s.lockedIv || null);
    ctx.grantEgg(entry.species, {
      ivs: entry.ivs,
      nature: entry.nature,
      gender: entry.gender,
      shiny: entry.shiny,
      squareShiny: entry.squareShiny,
      ivRandomKey: entry.ivRandomKey,
    });
    gameData.stats = gameData.stats || {};
    gameData.stats.totalEggsProduced = (gameData.stats.totalEggsProduced || 0) + 1;
    ctx.log('nursery_egg', { pokemon: entry.species, shiny: entry.shiny });
    b.roundsDone++;
    produced++;
  }
  if (b.roundsDone >= b.roundsTotal) {
    s.breeding = null;
    s.lastEggAt = Date.now();
  }
  if (produced) ctx.save();
  return produced;
}

function start(ctx) {
  const s = ensureSlot(ctx);
  if (s.breeding) return;
  const { ea, eb, r } = pairInfo(s);
  if (!ea || !eb || !r || !r.ok) return;
  const rounds = s.rounds;
  if (ctx.left < rounds * ROUND_MAX + 60 * 1000) return;
  const demand = berryDemand(ea, eb).map(({ type, qty }) => ({ type, qty: qty * rounds }));
  if (!ctx.spendBerries(demand)) { ctx.refresh(); return; }
  s.breeding = {
    startedAt: Date.now(),
    durMs: randInt(ROUND_MIN / 60000, ROUND_MAX / 60000) * 60 * 1000,
    roundsTotal: rounds,
    roundsDone: 0,
  };
  s.lastEggAt = 0;
  ctx.save();
  ctx.refresh();
}

function render(ctx) {
  const s = ensureSlot(ctx);
  handlePicks(ctx, s);
  const pair = pairInfo(s);
  return `<div class="eggweek">
    <div class="eggweek-npc">
      <div class="eggweek-npc-img" role="img" aria-label="培育奶奶"></div>
      <div class="eggweek-bubble">${esc(sayText(ctx, s, pair))}</div>
    </div>
    <div class="eggweek-card act-card">
      <div class="nursery-pair-row">${slotHtml(s, 0, !!s.breeding)}<span class="nursery-pair-plus">＋</span>${slotHtml(s, 1, !!s.breeding)}</div>
      ${pairStatusHtml(s)}
    </div>
    <div class="eggweek-note">活动期间可反复培育，每轮 2~5 分钟；结束后亲本自动回仓库。</div>
  </div>`;
}

function mount(root, ctx) {
  const s = ensureSlot(ctx);
  root.querySelectorAll('[data-icon]').forEach((img) => {
    const poke = getPokemonByIndex(img.dataset.icon);
    if (poke?.icon) tryLoadImage(img, poke.icon);
  });
  root.querySelectorAll('img[data-src]').forEach((img) => tryLoadImage(img, img.dataset.src));

  root.querySelectorAll('.eggweek-slot').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = Number(el.dataset.slot);
      const id = parentId(s.parents[i]);
      if (!id) {
        const other = rosterEntry(parentId(s.parents[1 - i]));
        ctx.openPicker(i, excludeForSlot(s, i), { label: other ? '选择能与它配对的宝可梦' : '选择放入孵蛋周的宝可梦' });
        return;
      }
      const remove = () => {
        s.parents[i] = null;
        if (s.breeding) s.breeding = null;
        ctx.save();
        ctx.refresh();
      };
      if (s.breeding) ctx.confirm('取出这只亲本会终止剩余轮次，已经产出的蛋已自动入库。确定取出？', remove);
      else remove();
    });
  });

  root.querySelectorAll('.nursery-pair-lock-btn[data-lock]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = btn.dataset.lock;
      if (s.lockedIv && s.lockedIv.key === v) {
        s.lockedIv = null;
      } else {
        const { ea, eb } = pairInfo(s);
        const r = ea && eb ? checkPairing(ea, eb) : null;
        let src = 'a';
        if (r && r.ok) src = pairRole(ea, eb, 'a') === 'mother' ? 'a' : 'b';
        s.lockedIv = { key: v, source: src };
      }
      ctx.save();
      ctx.refresh();
    });
  });
  root.querySelectorAll('[data-incense]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      s.useIncense = !s.useIncense;
      ctx.save();
      ctx.refresh();
    });
  });
  root.querySelectorAll('[data-lock-src]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!s.lockedIv) return;
      s.lockedIv.source = btn.dataset.lockSrc;
      ctx.save();
      ctx.refresh();
    });
  });
  root.querySelectorAll('[data-round-minus]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (s.rounds > 1) {
        s.rounds--;
        ctx.save();
        ctx.refresh();
      }
    });
  });
  root.querySelectorAll('[data-round-plus]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (s.rounds < MAX_BREED_ROUNDS) {
        s.rounds++;
        ctx.save();
        ctx.refresh();
      }
    });
  });
  const startBtn = root.querySelector('[data-start-breed]');
  if (startBtn) {
    if (ctx.left < s.rounds * ROUND_MAX + 60 * 1000) {
      startBtn.disabled = true;
      startBtn.classList.add('locked');
      startBtn.textContent = '活动快结束了';
    }
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (startBtn.disabled) return;
      start(ctx);
    });
  }
}

function tick(root, ctx) {
  const s = ensureSlot(ctx);
  const produced = settle(ctx);
  if (produced) {
    ctx.refresh();
    return;
  }
  const b = s.breeding;
  if (!b) return;
  const remain = b.startedAt + (b.roundsDone + 1) * b.durMs - Date.now();
  if (remain <= 0) {
    ctx.refresh();
    return;
  }
  const fill = root.querySelector('#eggWeekFill');
  const text = root.querySelector('#eggWeekRemain');
  const pct = Math.max(0, Math.min(100, (1 - remain / b.durMs) * 100));
  if (fill) fill.style.width = pct.toFixed(1) + '%';
  if (text) text.textContent = `剩余 ${fmtRemain(remain)}`;
}

function unmount(ctx) {
  settle(ctx);
  const s = ensureSlot(ctx);
  if (Number(ctx.to) && ctx.left <= 0) {
    s.breeding = null;
    s.parents = [null, null];
    ctx.save();
  }
}

export const EGG_WEEK = {
  name: '孵蛋周',
  title() { return '孵蛋周'; },
  ready() { return true; },
  render,
  mount,
  tick,
  unmount,
};
