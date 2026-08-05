// 回合制战斗引擎（第一版原语子集）：
// 伤害（物理/特殊/多段/固定/吸血/反伤）+ 概率附加状态 + 能力升降 + 回复 + 常见异常状态
import { typeMult } from './type-chart.js';

// ---------- 性格（25 种，英文 key 与存档一致；statIndex: 0攻 1防 2特攻 3特防 4速） ----------
export const NATURES = {
  hardy: null, docile: null, bashful: null, quirky: null, serious: null,
  lonely: { up: 0, down: 1 }, adamant: { up: 0, down: 2 }, naughty: { up: 0, down: 3 }, brave: { up: 0, down: 4 },
  bold: { up: 1, down: 0 }, impish: { up: 1, down: 2 }, lax: { up: 1, down: 3 }, relaxed: { up: 1, down: 4 },
  modest: { up: 2, down: 0 }, mild: { up: 2, down: 1 }, rash: { up: 2, down: 3 }, quiet: { up: 2, down: 4 },
  calm: { up: 3, down: 0 }, gentle: { up: 3, down: 1 }, careful: { up: 3, down: 2 }, sassy: { up: 3, down: 4 },
  timid: { up: 4, down: 0 }, hasty: { up: 4, down: 1 }, jolly: { up: 4, down: 2 }, naive: { up: 4, down: 3 },
};

export const STATUS_TEXT = {
  paralysis: '麻痹了', sleep: '睡着了', poison: '中毒了',
  burn: '灼伤了', freeze: '被冰冻了', confusion: '混乱了', flinch: '畏缩了',
};
export const STAT_INDEX = { 攻击: 0, 防御: 1, 特攻: 2, 特防: 3, 速度: 4 };
const STAGE_MULT = [2 / 8, 2 / 7, 2 / 6, 2 / 5, 2 / 4, 2 / 3, 1, 3 / 2, 4 / 2, 5 / 2, 6 / 2, 7 / 2, 8 / 2];

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const msg = (text) => ({ t: 'msg', text });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- 能力值 ----------
function calcHp(base, iv, level) {
  return Math.floor(((2 * base + iv) * level) / 100 + level + 10);
}
function calcStat(base, iv, level, mult) {
  return Math.floor(((2 * base + iv) * level) / 100 + 5) * mult;
}
// natures: {up, down}，修正 ×1.1 / ×0.9
// ivs: 存档对象 { hp, atk, def, spa, spd, spe }
export function createMon(pokeData, level, ivsObj, natureKey, moveIds) {
  const nature = NATURES[natureKey] || null;
  const base = pokeData.stats; // [HP,攻,防,特攻,特防,速]
  const ivs = [ivsObj.hp, ivsObj.atk, ivsObj.def, ivsObj.spa, ivsObj.spd, ivsObj.spe];
  const stats = base.map((b, i) => {
    if (i === 0) return calcHp(b, ivs[i], level);
    let mult = 1;
    if (nature && i === nature.up) mult = 1.1;
    if (nature && i === nature.down) mult = 0.9;
    return calcStat(b, ivs[i], level, mult);
  });
  return {
    idx: pokeData.index, name: pokeData.name, types: pokeData.types, level,
    ivs: ivsObj, nature: natureKey, moves: moveIds,
    stats, maxHp: stats[0], hp: stats[0],
    stages: [0, 0, 0, 0, 0],
    stageTypes: [null, null, null, null, null], // 每项能力最近一次变化来源招式的属性（能力圆点按此着色）
    status: null, statusType: null, sleepTurns: 0, confusionTurns: 0, flinch: false,
    hitByPhys: false, physDmg: 0, // 双倍奉还结算：最近一次受到的物理伤害（回合开始清零）
    hitBySpec: false, specDmg: 0, // 镜面反射结算：最近一次受到的特殊伤害（回合开始清零）
    protected: false, endure: false, seeded: false, seedSrc: null, subHp: 0, // 守住/挺住/寄生种子/替身
    effStat(i) {
      let v = this.stats[i] * STAGE_MULT[this.stages[i] + 6];
      if (i === 4 && this.status === 'paralysis') v *= 0.5;
      if (i === 0 && this.status === 'burn') v *= 0.5;
      return Math.floor(v);
    },
  };
}

// ---------- 命中 & 伤害 ----------
function hit(actor, target, mv, ef, events) {
  const acc = mv.accuracy;
  if (acc != null && Math.random() * 100 > acc) {
    events.push({ t: 'miss', who: actor.name, text: `${actor.name}的${mv.name}没有命中！` });
    return false;
  }
  const atkType = mv.type;
  const m = typeMult(atkType, target.types);
  if (m === 0) {
    events.push(msg(`${mv.name}对${target.name}没有效果…`));
    return false;
  }
  // 守住：本回合免疫一切招式伤害
  if (target.protected) {
    events.push(msg(`${target.name}用守住挡住了${mv.name}！`));
    return false;
  }
  const stab = actor.types.includes(atkType) ? 1.5 : 1;
  const atk = actor.effStat(ef.cat === 'phys' ? 0 : 2);
  const def = target.effStat(ef.cat === 'phys' ? 1 : 3);
  const pw = ef.power || 0;
  let dmg = Math.floor(((((2 * actor.level) / 5 + 2) * pw * atk) / def / 50 + 2) * stab * m * (0.85 + Math.random() * 0.15));
  dmg = Math.max(1, dmg);
  // 替身：伤害由替身承受，本体不受影响（替身破裂后多余伤害不传递）
  if (target.subHp > 0) {
    target.subHp -= dmg;
    events.push(msg(`${target.name}的替身挡住了伤害！`));
    if (target.subHp <= 0) {
      target.subHp = 0;
      events.push(msg(`${target.name}的替身消失了！`));
    }
    if (m > 1) events.push(msg('效果绝佳！'));
    else if (m < 1) events.push(msg('收效甚微…'));
    return true;
  }
  // 记录命中前后的 HP：连击等多次伤害事件回放时，播放层据此把血条逐段扣，而不是一次扣到底
  const fromHp = target.hp;
  target.hp -= dmg;
  // 挺住：受到致命伤害时保留 1 点 HP（一次性）
  if (target.endure && target.hp <= 0) {
    target.hp = 1;
    target.endure = false;
    events.push(msg(`${target.name}挺住了！`));
  }
  // 双倍奉还/镜面反射记录：覆盖为最近一次受到的物理/特殊伤害（官方：反击最近一次攻击，不累加）
  if (ef.cat === 'phys' && dmg > 0) {
    target.hitByPhys = true;
    target.physDmg = dmg;
  } else if (ef.cat === 'spec' && dmg > 0) {
    target.hitBySpec = true;
    target.specDmg = dmg;
  }
  events.push({ t: 'dmg', who: target.name, amount: dmg, from: fromHp, to: target.hp, text: `${actor.name}使用${mv.name}！` });
  if (m > 1) events.push(msg('效果绝佳！'));
  else if (m < 1) events.push(msg('收效甚微…'));
  // 概率附加状态 / 能力变化
  if (ef.attach && target.hp > 0) {
    const st = Array.isArray(ef.attach.statuses) ? ef.attach.statuses[Math.floor(Math.random() * ef.attach.statuses.length)] : ef.attach.status;
    applyStatus(target, st, events, ef.attach.chance, mv.type);
  }
  if (ef.stat && target.hp > 0) applyStat(ef.stat.target === 'self' ? actor : target, ef.stat.stats, events, mv.type, ef.stat.chance);
  if (target.hp <= 0) events.push({ t: 'faint', who: target.name, text: `${target.name}倒下了！` });
  return true;
}

function applyStatus(mon, st, events, chance = 100, moveType = null) {
  if (Math.random() * 100 > chance) return;
  if (st === 'flinch') { mon.flinch = true; events.push(msg(`${mon.name}畏缩了！`)); return; } // 畏缩为瞬时行动打断，不占用异常槽
  if (mon.status) { events.push(msg(`${mon.name}已经处于${STATUS_TEXT[st]}状态。`)); return; }
  mon.status = st;
  mon.statusType = moveType; // 记录来源招式属性，状态圆点按此着色
  if (st === 'sleep') mon.sleepTurns = rand(1, 3);
  if (st === 'confusion') mon.confusionTurns = rand(2, 4);
  events.push({ t: 'status', who: mon.name, status: st, text: `${mon.name}${STATUS_TEXT[st]}！` });
}

function applyStat(mon, stats, events, moveType, chance = 100) {
  if (Math.random() * 100 > chance) return;
  for (const { stat, delta } of stats) {
    const i = STAT_INDEX[stat];
    const ns = clamp(mon.stages[i] + delta, -6, 6);
    if (ns === mon.stages[i]) { events.push(msg(`${mon.name}的${stat}不会再变化了。`)); continue; }
    mon.stages[i] = ns;
    mon.stageTypes[i] = moveType; // 记录来源招式属性，能力圆点按此着色
    // stat 事件：让战斗界面刷新对应侧，属性后展示能力变化圆点
    events.push({ t: 'stat', who: mon.name, text: `${mon.name}的${stat}${delta > 0 ? '提高了' : '降低了'}！` });
  }
}

// 反击/镜面反射：本回合受到对应类别的伤害时返还其 2 倍（按自身属性走克制），成功后伤害记录清零
function retaliate(actor, target, mv, events, spec) {
  events.push(msg(`${actor.name}使用${mv.name}！`));
  const hit = spec ? actor.hitBySpec : actor.hitByPhys;
  const dmg = spec ? actor.specDmg : actor.physDmg;
  if (!hit || dmg <= 0) {
    events.push(msg(`但是没有效果！（本回合未受到${spec ? '特殊' : '物理'}伤害）`));
    return;
  }
  const m = typeMult(mv.type, target.types);
  if (m === 0) {
    events.push(msg(`${mv.name}对${target.name}没有效果…`));
    return;
  }
  const final = Math.floor(dmg * 2 * m);
  const fromHp = target.hp;
  target.hp -= final;
  events.push({ t: 'dmg', who: target.name, amount: final, from: fromHp, to: target.hp, text: `${actor.name}使用${mv.name}！` });
  if (m > 1) events.push(msg('效果绝佳！'));
  else if (m < 1) events.push(msg('收效甚微…'));
  // 反击成功：对应伤害记录清零，需再次受到同类别伤害才能再次反击
  if (spec) { actor.hitBySpec = false; actor.specDmg = 0; }
  else { actor.hitByPhys = false; actor.physDmg = 0; }
  if (target.hp <= 0) events.push({ t: 'faint', who: target.name, text: `${target.name}倒下了！` });
}

// ---------- 招式执行（返回事件数组） ----------
export function useMove(actor, target, moveId, data, events = []) {
  const mv = data.moves[moveId];
  if (!mv) { events.push(msg(`${actor.name}没有可用招式！`)); return events; }
  // 蓄力回避：目标正处两回合招式离场蓄力（挖洞/飞翔/潜水/弹跳/潜灵奇袭），任何招式都无法命中
  if (target.chargeMove != null && target.chargeHidden) {
    events.push({ t: 'miss', who: actor.name, text: `${actor.name}的攻击对${target.name}没有命中！` });
    return events;
  }
  const ef = mv.effect;
  switch (ef.kind) {
    case 'damage':
      hit(actor, target, mv, ef, events);
      break;
    case 'multihit': {
      const n = rand(ef.hits[0], ef.hits[1]);
      events.push(msg(`${actor.name}使用${mv.name}！`));
      for (let i = 0; i < n; i++) {
        events.push({ t: 'step' });
        if (hit(actor, target, mv, ef, events) && target.hp <= 0) break;
      }
      events.push(msg(`攻击了 ${n} 次！`));
      break;
    }
    case 'fixed': {
      const names = { 音爆: 20, 龙之怒: 40 };
      let dmg = names[mv.name];
      if (dmg == null) dmg = actor.level; // 地球上投/黑夜魔影：等值等级伤害
      events.push(msg(`${actor.name}使用${mv.name}！`));
      const acc = mv.accuracy;
      if (acc != null && Math.random() * 100 > acc) {
        events.push({ t: 'miss', who: actor.name, text: `${actor.name}的${mv.name}没有命中！` });
        break;
      }
      // 属性免疫：固定伤害招式同样受克制表约束（音爆对幽灵、龙之怒对妖精等无效）
      if (typeMult(mv.type, target.types) === 0) {
        events.push(msg(`${mv.name}对${target.name}没有效果…`));
        break;
      }
      const fromHp = target.hp;
      target.hp -= dmg;
      events.push({ t: 'dmg', who: target.name, amount: dmg, from: fromHp, to: target.hp, text: `造成了 ${dmg} 点伤害。` });
      if (target.hp <= 0) events.push({ t: 'faint', who: target.name, text: `${target.name}倒下了！` });
      break;
    }
    case 'drain': {
      const before = target.hp;
      if (hit(actor, target, mv, ef, events)) {
        const healed = Math.floor((before - Math.max(0, target.hp)) / 2);
        actor.hp = Math.min(actor.maxHp, actor.hp + healed);
        events.push({ t: 'heal', who: actor.name, amount: healed, text: `${actor.name}吸收了 ${healed} 点HP！` });
      }
      break;
    }
    case 'recoil': {
      const before = target.hp;
      if (hit(actor, target, mv, ef, events)) {
        const recoil = Math.floor((before - Math.max(0, target.hp)) * 0.25);
        actor.hp -= recoil;
        events.push(msg(`${actor.name}受到了 ${recoil} 点反作用力伤害！`));
        if (actor.hp <= 0) events.push({ t: 'faint', who: actor.name, text: `${actor.name}倒下了！` });
      }
      break;
    }
    case 'counter':
      retaliate(actor, target, mv, events, false);
      break;
    case 'mirrorCoat':
      retaliate(actor, target, mv, events, true);
      break;
    case 'heal': {
      const healed = Math.floor(actor.maxHp * ef.ratio);
      actor.hp = Math.min(actor.maxHp, actor.hp + healed);
      events.push({ t: 'heal', who: actor.name, amount: healed, text: `${actor.name}回复了 ${healed} 点HP！` });
      break;
    }
    case 'sleepRest': {
      actor.hp = actor.maxHp;
      actor.status = 'sleep';
      actor.statusType = mv.type; // 睡觉：状态圆点按招式属性着色
      actor.sleepTurns = rand(2, 3);
      events.push({ t: 'heal', who: actor.name, amount: actor.maxHp, text: `${actor.name}睡着了，并回复了全部HP！` });
      break;
    }
    case 'cure': {
      if (actor.status) { actor.status = null; events.push(msg(`${actor.name}的异常状态解除了！`)); }
      else events.push(msg(`${actor.name}恢复了清爽状态！`));
      break;
    }
    case 'status': {
      events.push(msg(`${actor.name}使用${mv.name}！`));
      const acc = mv.accuracy;
      if (acc != null && Math.random() * 100 > acc) {
        events.push({ t: 'miss', who: actor.name, text: `${actor.name}的${mv.name}没有命中！` });
        break;
      }
      applyStatus(target, ef.status, events, ef.chance, mv.type);
      break;
    }
    case 'stat': {
      events.push(msg(`${actor.name}使用${mv.name}！`));
      if (ef.target === 'foe') {
        const acc = mv.accuracy;
        if (acc != null && Math.random() * 100 > acc) {
          events.push({ t: 'miss', who: actor.name, text: `${actor.name}的${mv.name}没有命中！` });
          break;
        }
      }
      applyStat(ef.target === 'foe' ? target : actor, ef.stats, events, mv.type);
      break;
    }
    case 'protect': {
      events.push(msg(`${actor.name}使用${mv.name}！`));
      actor.protected = true;
      break;
    }
    case 'endure': {
      events.push(msg(`${actor.name}使用${mv.name}！`));
      actor.endure = true;
      break;
    }
    case 'leechSeed': {
      events.push(msg(`${actor.name}使用${mv.name}！`));
      const acc = mv.accuracy;
      if (acc != null && Math.random() * 100 > acc) {
        events.push({ t: 'miss', who: actor.name, text: `${actor.name}的${mv.name}没有命中！` });
        break;
      }
      if (target.types.includes('草')) {
        events.push(msg(`${mv.name}对${target.name}没有效果…`));
        break;
      }
      if (target.seeded) {
        events.push(msg(`${target.name}已经被寄生种子寄生。`));
        break;
      }
      target.seeded = true;
      target.seedSrc = actor;
      events.push({ t: 'seed', who: target.name, text: `${target.name}被种下了寄生种子！` });
      break;
    }
    case 'substitute': {
      events.push(msg(`${actor.name}使用${mv.name}！`));
      if (actor.subHp > 0) {
        events.push(msg(`${actor.name}已经有替身了。`));
        break;
      }
      const cost = Math.max(1, Math.floor(actor.maxHp / 4));
      if (actor.hp <= cost) {
        events.push(msg(`但是没有效果！（体力不足，无法制造替身）`));
        break;
      }
      const fromHp = actor.hp;
      actor.hp -= cost;
      actor.subHp = cost;
      events.push({ t: 'dmg', who: actor.name, amount: cost, from: fromHp, to: actor.hp, text: `${actor.name}消耗 ${cost} 点体力，制造出替身！` });
      break;
    }
    default:
      events.push(msg(`${mv.name}：暂未实现。`));
  }
  return events;
}

// ---------- 回合状态 ----------
// 行动前检查，返回是否能行动
export function preTurn(mon, events) {
  if (mon.hp <= 0) return false;
  if (mon.flinch) {
    mon.flinch = false;
    events.push({ t: 'flinch', who: mon.name, text: `${mon.name}畏缩了，无法行动！` });
    return false;
  }
  if (mon.status === 'freeze') {
    if (Math.random() < 0.2) { mon.status = null; events.push(msg(`${mon.name}解冻了！`)); }
    else { events.push(msg(`${mon.name}被冻住，无法行动。`)); return false; }
  }
  if (mon.status === 'sleep') {
    if (mon.sleepTurns <= 0) {
      mon.status = null;
      mon.sleepTurns = 0;
      events.push(msg(`${mon.name}醒了过来！`));
    } else {
      // 先判后减：保证入睡后至少有一回合无法行动（sleepTurns=1 也睡一回合，
      // 避免睡眠粉/催眠术随机到 1 时"刚睡着就醒来"等于没生效）
      mon.sleepTurns--;
      events.push(msg(`${mon.name}正在呼呼大睡。`));
      return false;
    }
  }
  if (mon.status === 'paralysis' && Math.random() < 0.25) {
    events.push(msg(`${mon.name}因麻痹无法行动！`));
    return false;
  }
  if (mon.status === 'confusion') {
    mon.confusionTurns--;
    if (Math.random() < 0.5) {
      events.push(msg(`${mon.name}混乱了，攻击了自己！`));
      const self = Math.max(1, Math.floor(mon.effStat(0) * 0.5));
      mon.hp -= self;
      events.push({ t: 'dmg', who: mon.name, amount: self, text: `${mon.name}被自己打掉 ${self} 点HP。` });
      if (mon.hp <= 0) events.push({ t: 'faint', who: mon.name, text: `${mon.name}倒下了！` });
    }
    if (mon.confusionTurns <= 0) { mon.status = null; events.push(msg(`${mon.name}清醒了过来！`)); }
    return mon.hp > 0;
  }
  return true;
}
// 回合末持续伤害（dmg 事件让播放层刷新 HP 条并弹出伤害数字）
export function postTurn(mon, events) {
  if (mon.hp <= 0) return;
  if (mon.status === 'poison') {
    const d = Math.floor(mon.maxHp / 8);
    mon.hp -= d;
    events.push({ t: 'dmg', who: mon.name, amount: d, text: `${mon.name}因为中毒受到 ${d} 点伤害！` });
  }
  if (mon.status === 'burn') {
    const d = Math.floor(mon.maxHp / 16);
    mon.hp -= d;
    events.push({ t: 'dmg', who: mon.name, amount: d, text: `${mon.name}因为灼伤受到 ${d} 点伤害！` });
  }
  // 寄生种子：每回合吸取目标 HP 回复施种者（施种者倒下则效果消失）
  if (mon.seeded && mon.seedSrc && mon.seedSrc.hp > 0 && mon.hp > 1) {
    const drain = Math.min(mon.hp - 1, Math.max(1, Math.floor(mon.maxHp / 8)));
    const src = mon.seedSrc;
    events.push({ t: 'seedDrain', from: mon, to: src }); // 吸血粒子：绿色能量从被吸者身上吸回施种者
    mon.hp -= drain;
    events.push({ t: 'dmg', who: mon.name, amount: drain, text: `${mon.name}被寄生种子吸走了 ${drain} 点HP！` });
    const healed = Math.min(src.maxHp - src.hp, drain);
    if (healed > 0) {
      src.hp += healed;
      events.push({ t: 'heal', who: src.name, amount: healed, text: `${src.name}回复了 ${healed} 点HP！` });
    }
  }
  if (mon.hp <= 0) events.push({ t: 'faint', who: mon.name, text: `${mon.name}倒下了！` });
}

// ---------- AI：按属性克制与威力择优（克制的招优先，免疫的尽量避开） ----------
const AI_DMG_KIND = ['damage', 'multihit', 'fixed', 'drain', 'recoil', 'counter', 'mirrorCoat'];
export function aiMove(actor, enemy, data) {
  const usable = actor.moves.filter((m) => {
    const ef = data.moves[m] && data.moves[m].effect;
    return ef && ef.kind !== 'unimplemented';
  });
  if (!usable.length) return null;
  // 当前最高打击倍率：打不动对方时更倾向用辅助招（降敌能力/自强化）
  const maxMult = usable.reduce((mx, m) => {
    const ef = data.moves[m].effect;
    return AI_DMG_KIND.includes(ef.kind) ? Math.max(mx, typeMult(data.moves[m].type, enemy.types)) : mx;
  }, 0);

  let best = usable[0];
  let bestScore = -Infinity;
  for (const m of usable) {
    const mv = data.moves[m];
    const ef = mv.effect;
    let score = Math.random() * 2; // 同分时打散，避免出招完全可预测
    if (AI_DMG_KIND.includes(ef.kind)) {
      const mult = typeMult(mv.type, enemy.types);
      if (mult === 0) {
        score -= 30; // 无效招：仅当无招可用时兜底
      } else {
        // 克制倍率主导，辅以本系加成与威力
        const pow = ef.kind === 'fixed' ? (mv.name === '音爆' ? 20 : mv.name === '龙之怒' ? 40 : actor.level) : (ef.power || 0);
        score += mult * 12 + (actor.types.includes(mv.type) ? 3 : 0) + Math.min(pow, 120) / 20;
      }
    } else if (ef.kind === 'stat') {
      score += maxMult < 1.5 && Math.random() < 0.6 ? 9 : -6;
    } else if (ef.kind === 'status') {
      score += !enemy.status && Math.random() < 0.3 ? 7 : -8; // 对方已中异常则不再施放
    } else if (ef.kind === 'protect') {
      score += actor.hp < actor.maxHp * 0.5 && Math.random() < 0.5 ? 8 : -6; // 守住：血量低时防御
    } else if (ef.kind === 'endure') {
      score += actor.hp < actor.maxHp * 0.3 && Math.random() < 0.4 ? 8 : -7; // 挺住：濒死保命
    } else if (ef.kind === 'leechSeed') {
      score += !enemy.seeded && maxMult < 1.5 && Math.random() < 0.5 ? 8 : -6; // 寄生种子：打不动时用
    } else if (ef.kind === 'substitute') {
      score += actor.subHp <= 0 && actor.hp > actor.maxHp * 0.5 && Math.random() < 0.35 ? 7 : -7; // 替身：血线健康时用
    } else if ((ef.kind === 'heal' || ef.kind === 'sleepRest') && actor.hp < actor.maxHp * 0.45) {
      score += 10; // 血量低时优先回复
    } else {
      score -= 8;
    }
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
