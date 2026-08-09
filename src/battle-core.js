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
  infatuation: '着迷了',
};
export const STAT_INDEX = { 攻击: 0, 防御: 1, 特攻: 2, 特防: 3, 速度: 4, 命中率: 5, 闪避率: 6 };
const STAGE_MULT = [2 / 8, 2 / 7, 2 / 6, 2 / 5, 2 / 4, 2 / 3, 1, 3 / 2, 4 / 2, 5 / 2, 6 / 2, 7 / 2, 8 / 2];

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const msg = (text) => ({ t: 'msg', text });
// 战斗个体唯一标识：播放层优先用 uid 定位承受者，避免百变怪变身（改名为对手名）或双方同种时同名错位
let _uidSeq = 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 清除异常状态：置空状态并推渲染事件（单纯 msg 不会刷新状态圆点/粒子特效）
const clearStatus = (mon, events, text) => {
  mon.status = null;
  mon.sleepTurns = 0;
  events.push({ t: 'status', who: mon.name, uid: mon.uid, status: null, text });
};

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
    uid: ++_uidSeq, // 战斗个体唯一标识（变身只改外观，定位仍指向原个体）
    stats, maxHp: stats[0], hp: stats[0],
    stages: [0, 0, 0, 0, 0, 0, 0],
    stageTypes: [null, null, null, null, null, null, null], // 每项能力最近一次变化来源招式的属性（能力圆点按此着色）
    status: null, statusType: null, sleepTurns: 0, confusionTurns: 0, flinch: false,
    hitByPhys: false, physDmg: 0, // 双倍奉还结算：最近一次受到的物理伤害（回合开始清零）
    hitBySpec: false, specDmg: 0, // 镜面反射结算：最近一次受到的特殊伤害（回合开始清零）
    protected: false, endure: false, protectStreak: 0, seeded: false, seedSrc: null, subHp: 0, // 守住/挺住/寄生种子/替身
    wallPhys: 0, wallSpec: 0, // 反射壁/光墙剩余回合数（0=无）
    regen: false,             // 水流环：回合末回复 1/16
    destinyBond: false,       // 同命：本回合被击倒时对手一并倒下
    perishTurns: 0,           // 终焉之歌倒计时（0=未触发）
    lastMove: null,           // 最近使用的招式 id（模仿/定身法/再来一次依赖）
    disabledMove: null, disableTurns: 0, // 定身法/无理取闹：封印的招式
    lockedMove: null, encoreTurns: 0,    // 再来一次：锁定的招式
    tauntTurns: 0,            // 挑衅：只能使用攻击招式
    whirlwinded: false,       // 吹飞/吼叫：本回合被强制换人
    batonPass: false,         // 接棒：本回合下场并传递能力
    effStat(i) {
      // 战斗有效能力值（含等级修正与状态影响）
      // 0=速度, 1=物攻, 2=物防, 3=特攻, 4=特防, 5=命中率, 6=闪避率
      if (i >= 5) return this.stages[i];           // ACC/EVA 不乘能力值
      if (i === 0) {
        let v = this.stats[5] * STAGE_MULT[this.stages[4] + 6];
        if (this.status === 'paralysis') v *= 0.5;  // 麻痹减速
        return Math.floor(v);
      }
      let v = this.stats[i] * STAGE_MULT[this.stages[i - 1] + 6];
      if (i === 1 && this.status === 'burn') v *= 0.5; // 烧伤减物攻
      return Math.floor(v);
    },
  };
}

// ---------- 命中 & 伤害 ----------
function hit(actor, target, mv, ef, events, ctx = null) {
  const acc = mv.accuracy;
  if (acc != null) {
    // 命中率/闪避率等级修正：命中等级×2/8~8/2，闪避等级反向
    const accMult = STAGE_MULT[(actor.stages[5] || 0) - (target.stages[6] || 0) + 6];
    if (Math.random() * 100 > acc * accMult) {
      events.push({ t: 'miss', who: actor.name, uid: actor.uid, text: `${actor.name}的${mv.name}没有命中！` });
      return false;
    }
  }
  const atkType = mv.type;
  const m = typeMult(atkType, target.types);
  if (m === 0) {
    events.push(msg(`${mv.name}对${target.name}没有效果…`));
    return false;
  }
  // 守住：本回合免疫一切招式伤害（专用 block 事件让播放层做护盾挡下反馈）
  if (target.protected) {
    events.push({ t: 'block', who: target.name, uid: target.uid, text: `${target.name}用守住挡住了${mv.name}！` });
    return false;
  }
  const stab = actor.types.includes(atkType) ? 1.5 : 1;
  const atk = actor.effStat(ef.cat === 'phys' ? 1 : 3);
  const def = target.effStat(ef.cat === 'phys' ? 2 : 4);
  const pw = ef.power || 0;
  let dmg = Math.floor(((((2 * actor.level) / 5 + 2) * pw * atk) / def / 50 + 2) * stab * m * (0.85 + Math.random() * 0.15));
  // 天气与场地修正：求雨/大晴天增减水火伤害，青草/电气场地增幅对应属性
  if (ctx) {
    if (ctx.weather === 'sun' && mv.type === '火') dmg = Math.floor(dmg * 1.5);
    else if (ctx.weather === 'sun' && mv.type === '水') dmg = Math.floor(dmg * 0.5);
    else if (ctx.weather === 'rain' && mv.type === '水') dmg = Math.floor(dmg * 1.5);
    else if (ctx.weather === 'rain' && mv.type === '火') dmg = Math.floor(dmg * 0.5);
    if (ctx.field === 'grass' && mv.type === '草') dmg = Math.floor(dmg * 1.3);
    if (ctx.field === 'electric' && mv.type === '电') dmg = Math.floor(dmg * 1.3);
  }
  // 光墙/反射壁：对应类别的伤害减半
  if (ef.cat === 'phys' && target.wallPhys > 0) dmg = Math.floor(dmg / 2);
  else if (ef.cat === 'spec' && target.wallSpec > 0) dmg = Math.floor(dmg / 2);
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
  events.push({ t: 'dmg', who: target.name, uid: target.uid, amount: dmg, from: fromHp, to: target.hp });
  if (m > 1) events.push(msg('效果绝佳！'));
  else if (m < 1) events.push(msg('收效甚微…'));
  // 概率附加状态 / 能力变化
  if (ef.attach && target.hp > 0) {
    const st = Array.isArray(ef.attach.statuses) ? ef.attach.statuses[Math.floor(Math.random() * ef.attach.statuses.length)] : ef.attach.status;
    applyStatus(target, st, events, ef.attach.chance, mv.type, ctx);
  }
  if (ef.stat && target.hp > 0) applyStat(ef.stat.target === 'self' ? actor : target, ef.stat.stats, events, mv.type, ef.stat.chance);
  if (target.hp <= 0) events.push({ t: 'faint', who: target.name, uid: target.uid, text: `${target.name}倒下了！` });
  return true;
}

function applyStatus(mon, st, events, chance = 100, moveType = null, ctx = null) {
  if (Math.random() * 100 > chance) return;
  if (st === 'flinch') { mon.flinch = true; events.push(msg(`${mon.name}畏缩了！`)); return; } // 畏缩为瞬时行动打断，不占用异常槽
  // 场地免疫：薄雾场地免疫一切异常，电气场地防睡眠
  if (ctx) {
    if (ctx.field === 'mist') {
      events.push(msg(`${mon.name}被薄雾场地保护，没有陷入异常状态！`));
      return;
    }
    if (ctx.field === 'electric' && st === 'sleep') {
      events.push(msg(`${mon.name}在电气场地上无法入睡！`));
      return;
    }
  }
  if (mon.status) { events.push(msg(`${mon.name}已经处于${STATUS_TEXT[st]}状态。`)); return; }
  mon.status = st;
  mon.statusType = moveType; // 记录来源招式属性，状态圆点按此着色
  if (st === 'sleep') mon.sleepTurns = rand(1, 3);
  if (st === 'confusion') mon.confusionTurns = rand(2, 4);
  events.push({ t: 'status', who: mon.name, uid: mon.uid, status: st, text: `${mon.name}${STATUS_TEXT[st]}！` });
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
    events.push({ t: 'stat', who: mon.name, uid: mon.uid, text: `${mon.name}的${stat}${delta > 0 ? '提高了' : '降低了'}！` });
  }
}

// 反击/镜面反射：本回合受到对应类别的伤害时返还其 2 倍（按自身属性走克制），成功后伤害记录清零
function retaliate(actor, target, mv, events, spec) {
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
  events.push({ t: 'dmg', who: target.name, uid: target.uid, amount: final, from: fromHp, to: target.hp });
  if (m > 1) events.push(msg('效果绝佳！'));
  else if (m < 1) events.push(msg('收效甚微…'));
  // 反击成功：对应伤害记录清零，需再次受到同类别伤害才能再次反击
  if (spec) { actor.hitBySpec = false; actor.specDmg = 0; }
  else { actor.hitByPhys = false; actor.physDmg = 0; }
  if (target.hp <= 0) events.push({ t: 'faint', who: target.name, uid: target.uid, text: `${target.name}倒下了！` });
}

// ---------- 变身（百变怪） ----------
// 复制对手外观：属性 / 能力值（HP 除外）/ 招式；保留自身 HP、等级、性别与异常状态。
// 对自身或已变身的对手无效。
export function transformMon(mon, source) {
  if (!source || !source.idx || source.idx === mon.idx || source._transformOf) return false;
  mon.types = source.types.slice();
  mon.stats = [mon.stats[0], ...source.stats.slice(1)];
  mon.moves = (source.moves || []).slice();
  mon._transformOf = source.idx;
  if (source.name) mon.name = source.name;
  return true;
}

// ---------- 招式执行（返回事件数组） ----------
export function useMove(actor, target, moveId, data, events = [], ctx = null) {
  const mv = data.moves[moveId];
  if (!mv) { events.push(msg(`${actor.name}没有可用招式！`)); return events; }
  // 蓄力回避：目标正处两回合招式离场蓄力（挖洞/飞翔/潜水/弹跳/潜灵奇袭），任何招式都无法命中
  if (target.chargeMove != null && target.chargeHidden) {
    events.push({ t: 'miss', who: actor.name, uid: actor.uid, text: `${actor.name}的攻击对${target.name}没有命中！` });
    return events;
  }
  const ef = mv.effect;
  actor.lastMove = String(moveId); // 记录最近使用的招式（模仿/定身法/再来一次依赖）
  // 守住连续成功计数：改用非守住招式时清零（守住失败在守住分支内清零）
  if (ef.kind !== 'protect') actor.protectStreak = 0;
  switch (ef.kind) {
    case 'damage':
      hit(actor, target, mv, ef, events);
      break;
    case 'multihit': {
      const n = rand(ef.hits[0], ef.hits[1]);
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
      const acc = mv.accuracy;
      if (acc != null && Math.random() * 100 > acc) {
        events.push({ t: 'miss', who: actor.name, uid: actor.uid, text: `${actor.name}的${mv.name}没有命中！` });
        break;
      }
      // 属性免疫：固定伤害招式同样受克制表约束（音爆对幽灵、龙之怒对妖精等无效）
      if (typeMult(mv.type, target.types) === 0) {
        events.push(msg(`${mv.name}对${target.name}没有效果…`));
        break;
      }
      const fromHp = target.hp;
      target.hp -= dmg;
      events.push({ t: 'dmg', who: target.name, uid: target.uid, amount: dmg, from: fromHp, to: target.hp, text: `造成了 ${dmg} 点伤害。` });
      if (target.hp <= 0) events.push({ t: 'faint', who: target.name, uid: target.uid, text: `${target.name}倒下了！` });
      break;
    }
    case 'drain': {
      const before = target.hp;
      if (hit(actor, target, mv, ef, events)) {
        const healed = Math.floor((before - Math.max(0, target.hp)) / 2);
        actor.hp = Math.min(actor.maxHp, actor.hp + healed);
        events.push({ t: 'heal', who: actor.name, uid: actor.uid, amount: healed, text: `${actor.name}吸收了 ${healed} 点HP！` });
      }
      break;
    }
    case 'recoil': {
      const before = target.hp;
      if (hit(actor, target, mv, ef, events)) {
        const ratio = ef.ratio || 0.25; // 每招各自的反噬比例（如双刃头锤 50%、舍身冲撞 33%）
        const recoil = Math.floor((before - Math.max(0, target.hp)) * ratio);
        const fromHp = actor.hp;
        actor.hp -= recoil;
        // dmg 事件（含前后血量）让播放层刷新血条/弹伤害数字，否则只显示文字血条不动
        events.push({ t: 'dmg', who: actor.name, uid: actor.uid, amount: recoil, from: fromHp, to: actor.hp, text: `${actor.name}受到了 ${recoil} 点反作用力伤害！` });
        if (actor.hp <= 0) events.push({ t: 'faint', who: actor.name, uid: actor.uid, text: `${actor.name}倒下了！` });
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
      events.push({ t: 'heal', who: actor.name, uid: actor.uid, amount: healed, text: `${actor.name}回复了 ${healed} 点HP！` });
      break;
    }
    case 'sleepRest': {
      actor.hp = actor.maxHp;
      actor.status = 'sleep';
      actor.statusType = mv.type; // 睡觉：状态圆点按招式属性着色
      actor.sleepTurns = rand(2, 3);
      events.push({ t: 'heal', who: actor.name, uid: actor.uid, amount: actor.maxHp, text: `${actor.name}睡着了，并回复了全部HP！` });
      break;
    }
    case 'cure': {
      if (actor.status) clearStatus(actor, events, `${actor.name}的异常状态解除了！`);
      else events.push(msg(`${actor.name}恢复了清爽状态！`));
      break;
    }
    case 'healCure': {
      // 治疗类：回复 1/4 HP 并清除自身异常状态
      const healed = Math.min(actor.maxHp - actor.hp, Math.floor(actor.maxHp / 4));
      if (healed > 0) {
        actor.hp += healed;
        events.push({ t: 'heal', who: actor.name, uid: actor.uid, amount: healed, text: `${actor.name}回复了 ${healed} 点HP！` });
      }
      if (actor.status) {
        clearStatus(actor, events, `${actor.name}的异常状态解除了！`);
      } else {
        events.push(msg(`${actor.name}恢复了清爽状态！`));
      }
      break;
    }
    case 'swapStats': {
      // 能力互换：交换双方指定能力的变化等级（力量/防守/速度/心灵互换）
      for (const name of ef.stats) {
        const i = STAT_INDEX[name];
        const at = actor.stages[i];
        actor.stages[i] = target.stages[i];
        target.stages[i] = at;
        const atType = actor.stageTypes[i];
        actor.stageTypes[i] = target.stageTypes[i];
        target.stageTypes[i] = atType;
      }
      events.push(msg(`${actor.name}与${target.name}交换了能力变化！`));
      break;
    }
    case 'destinyBond': {
      // 同命：本回合内自己被击倒时，对手一同倒下
      actor.destinyBond = true;
      events.push(msg(`${actor.name}作出了同归于尽的觉悟！`));
      break;
    }
    case 'memento': {
      // 临别礼物：自己倒下，大幅降低对手攻击与特攻
      events.push(msg(`${actor.name}留下了临别礼物！`));
      const fromHp = actor.hp;
      actor.hp = 0;
      // dmg 事件把血条扣到底，否则只播 faint 动画血条残留旧值
      events.push({ t: 'dmg', who: actor.name, uid: actor.uid, amount: fromHp, from: fromHp, to: 0, text: `${actor.name}倒下了！` });
      events.push({ t: 'faint', who: actor.name, uid: actor.uid, text: `${actor.name}倒下了！` });
      applyStat(target, [{ stat: '攻击', delta: -2 }, { stat: '特攻', delta: -2 }], events, mv.type);
      break;
    }
    case 'metronome': {
      // 挥指功：随机使用一个已实现招式（官方规则下守备/反制/召唤类招式不可被随机使出）
      const pool = Object.values(data.moves).filter((m) => m.effect && m.effect.kind !== 'unimplemented' && m.id !== mv.id
        && !['protect', 'metronome', 'mimic', 'counter', 'mirrorCoat', 'destinyBond', 'endure'].includes(m.effect.kind));
      if (!pool.length) { events.push(msg(`${mv.name}：没有可用的招式。`)); break; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      events.push(msg(`${actor.name}使出挥指，释放出${pick.name}！`));
      return useMove(actor, target, String(pick.id), data, events, ctx);
    }
    case 'haze': {
      // 黑雾：全场能力变化恢复原点
      for (const m of [actor, target]) {
        for (let i = 0; i < 7; i++) { m.stages[i] = 0; m.stageTypes[i] = null; }
      }
      events.push(msg('黑雾笼罩了战场，所有能力变化都恢复了！'));
      break;
    }
    case 'painSplit': {
      // 分担痛楚：双方 HP 变为平均值
      const avg = Math.floor((actor.hp + target.hp) / 2);
      const aFrom = actor.hp;
      const tFrom = target.hp;
      actor.hp = Math.max(1, avg);
      target.hp = Math.max(1, avg);
      events.push(msg(`${actor.name}与${target.name}分担了痛楚！`));
      // 双方 HP 变化分别推渲染事件（下降弹伤害、上升弹回复），否则血条不更新
      if (aFrom > actor.hp) events.push({ t: 'dmg', who: actor.name, uid: actor.uid, amount: aFrom - actor.hp, from: aFrom, to: actor.hp, text: '' });
      else if (aFrom < actor.hp) events.push({ t: 'heal', who: actor.name, uid: actor.uid, amount: actor.hp - aFrom, text: '' });
      if (tFrom > target.hp) events.push({ t: 'dmg', who: target.name, uid: target.uid, amount: tFrom - target.hp, from: tFrom, to: target.hp, text: '' });
      else if (tFrom < target.hp) events.push({ t: 'heal', who: target.name, uid: target.uid, amount: target.hp - tFrom, text: '' });
      break;
    }
    case 'curse': {
      // 咒术（简化）：诅咒对方，每回合结束受到 1/4 最大 HP 伤害
      if (target.status) { events.push(msg('但是没有效果！（目标已有状态）')); break; }
      target.status = 'curse';
      target.statusType = mv.type;
      events.push({ t: 'status', who: target.name, uid: target.uid, status: 'curse', text: `${target.name}被诅咒了！` });
      break;
    }
    case 'acupressure': {
      // 点穴：随机提升一项能力 2 级
      const keys = Object.keys(STAT_INDEX);
      const name = keys[Math.floor(Math.random() * keys.length)];
      applyStat(actor, [{ stat: name, delta: 2 }], events, mv.type);
      break;
    }
    case 'powerTrick': {
      // 力量戏法：交换自己的攻击与防御能力等级
      const atk = actor.stages[0];
      actor.stages[0] = actor.stages[1];
      actor.stages[1] = atk;
      const at = actor.stageTypes[0];
      actor.stageTypes[0] = actor.stageTypes[1];
      actor.stageTypes[1] = at;
      events.push(msg(`${actor.name}交换了攻击与防御！`));
      break;
    }
    case 'topsyTurvy': {
      // 颠倒：目标能力变化等级全部反转
      for (let i = 0; i < 7; i++) target.stages[i] = -target.stages[i];
      events.push(msg(`${target.name}的能力变化颠倒了！`));
      break;
    }
    case 'defog': {
      // 清除浓雾：清除对方场上的撒菱/毒菱/隐形岩
      const hz = ctx && ctx.hazards;
      if (!hz) { events.push(msg('但是没有效果！')); break; }
      const isP = (ctx.pTeam || []).some((x) => x.mon === actor);
      const foeSide = isP ? hz.e : hz.p;
      const cleared = foeSide.spikes + foeSide.toxic + (foeSide.rock ? 1 : 0);
      foeSide.spikes = 0; foeSide.toxic = 0; foeSide.rock = false;
      if (cleared) events.push(msg('清除了对方场上的陷阱！'));
      else events.push(msg('但是没有效果！'));
      break;
    }
    case 'averageStats': {
      // 防守平分/力量平分：双方指定能力等级取平均
      for (const name of ef.stats) {
        const i = STAT_INDEX[name];
        const avg = Math.floor((actor.stages[i] + target.stages[i]) / 2);
        actor.stages[i] = avg;
        target.stages[i] = avg;
      }
      events.push(msg(`${actor.name}与${target.name}平分了能力变化！`));
      break;
    }
    case 'perishSong': {
      // 终焉之歌：3回合后自己倒下（与原作一致作用于使用者）
      actor.perishTurns = 3;
      events.push(msg(`${actor.name}听见了终焉之歌！3回合后必将倒下！`));
      break;
    }
    case 'disable': {
      // 定身法/无理取闹：封印目标最近使用的招式 3 回合
      const last = target.lastMove;
      if (last == null) { events.push(msg('但是没有效果！（对方尚未使出招式）')); break; }
      target.disabledMove = last;
      target.disableTurns = 3;
      events.push(msg(`${target.name}的${data.moves[last] ? data.moves[last].name : '招式'}被封印了！`));
      break;
    }
    case 'encore': {
      // 再来一次：让目标连续 3 回合使用最近使用的招式
      const last = target.lastMove;
      if (last == null) { events.push(msg('但是没有效果！（对方尚未使出招式）')); break; }
      target.lockedMove = last;
      target.encoreTurns = 3;
      events.push(msg(`${target.name}被要求继续使用${data.moves[last] ? data.moves[last].name : '招式'}！`));
      break;
    }
    case 'taunt': {
      // 挑衅：目标 3 回合内只能使用攻击招式
      target.tauntTurns = 3;
      events.push(msg(`${target.name}被挑衅了，只能使出攻击招式！`));
      break;
    }
    case 'mimic': {
      // 模仿/仿效/写生/描绘：使出目标最近使用的招式
      const last = target.lastMove;
      if (last == null || !data.moves[last] || data.moves[last].effect.kind === 'unimplemented') {
        events.push(msg(`${mv.name}失败了！`));
        break;
      }
      events.push(msg(`${actor.name}模仿了${target.name}的${data.moves[last].name}！`));
      return useMove(actor, target, last, data, events, ctx);
    }
    case 'whirlwind': {
      // 吹飞/吼叫：强制对手换人（对手有后备时生效）
      const isP = !!(ctx && (ctx.pTeam || []).some((x) => x.mon === actor));
      const foeTeam = isP ? (ctx && ctx.eTeam) : (ctx && ctx.pTeam);
      const alive = foeTeam ? foeTeam.filter((x) => x.mon.hp > 0).length : 0;
      if (!foeTeam || alive <= 1) {
        events.push(msg('但是没有效果！（对方没有后备宝可梦）'));
        break;
      }
      target.whirlwinded = true;
      events.push(msg(`${target.name}被强风吹飞了！`));
      break;
    }
    case 'batonPass': {
      // 接棒：下场并将能力变化传递给下一只（换人动作由战斗流程执行）
      actor.batonPass = true;
      events.push(msg(`${actor.name}使出了接棒！`));
      break;
    }
    case 'status': {
      const acc = mv.accuracy;
      if (acc != null && Math.random() * 100 > acc) {
        events.push({ t: 'miss', who: actor.name, uid: actor.uid, text: `${actor.name}的${mv.name}没有命中！` });
        break;
      }
      applyStatus(target, ef.status, events, ef.chance, mv.type, ctx);
      break;
    }
    case 'attract': {
      // 诱惑：仅异性之间生效，任一方无性别则无效；成功后目标陷入"着迷"状态
      const acc = mv.accuracy;
      if (acc != null && Math.random() * 100 > acc) {
        events.push({ t: 'miss', who: actor.name, uid: actor.uid, text: `${actor.name}的${mv.name}没有命中！` });
        break;
      }
      const ag = actor.gender, tg = target.gender;
      if (!ag || !tg || ag === 'genderless' || tg === 'genderless' || ag === tg) {
        events.push(msg(`${mv.name}对${target.name}没有效果…`));
        break;
      }
      if (target.status) { events.push(msg(`${target.name}已经处于异常状态。`)); break; }
      target.status = 'infatuation';
      target.statusType = mv.type; // 记录来源招式属性，状态圆点按此着色
      events.push({ t: 'status', who: target.name, uid: target.uid, status: 'infatuation', text: `${target.name}着迷了！` });
      break;
    }
    case 'transform': {
      // 变身：复制对手外观/属性/能力（HP 除外）/招式；对已变身者或同为百变怪无效
      if (!transformMon(actor, target)) {
        events.push(msg(`${mv.name}失败了！`));
        break;
      }
      events.push({ t: 'transform', who: actor.name, uid: actor.uid, idx: actor.idx, of: target.idx, text: `${actor.name}变成了${target.name}的样子！` });
      break;
    }
    case 'stat': {
      if (ef.target === 'foe') {
        const acc = mv.accuracy;
        if (acc != null && Math.random() * 100 > acc) {
          events.push({ t: 'miss', who: actor.name, uid: actor.uid, text: `${actor.name}的${mv.name}没有命中！` });
          break;
        }
      }
      applyStat(ef.target === 'foe' ? target : actor, ef.stats, events, mv.type);
      break;
    }
    case 'protect': {
      // 守住：成功率随连续成功使用递减（官方 1/3^连续成功次数），失败则连续计数清零
      if (actor.protectStreak > 0 && Math.floor(Math.random() * Math.pow(3, actor.protectStreak)) !== 0) {
        actor.protectStreak = 0;
        events.push(msg(`${actor.name}使出了守住，但是没有成功！`));
        break;
      }
      actor.protectStreak++;
      actor.protected = true;
      events.push(msg(`${actor.name}使出了守住！`));
      break;
    }
    case 'endure': {
      actor.endure = true;
      break;
    }
    case 'leechSeed': {
      const acc = mv.accuracy;
      if (acc != null && Math.random() * 100 > acc) {
        events.push({ t: 'miss', who: actor.name, uid: actor.uid, text: `${actor.name}的${mv.name}没有命中！` });
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
      events.push({ t: 'seed', who: target.name, uid: target.uid, text: `${target.name}被种下了寄生种子！` });
      break;
    }
    case 'substitute': {
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
      events.push({ t: 'dmg', who: actor.name, uid: actor.uid, amount: cost, from: fromHp, to: actor.hp, text: `${actor.name}消耗 ${cost} 点体力，制造出替身！` });
      break;
    }
    case 'weather': {
      const WEATHER_NAME = { sun: '大晴天', rain: '求雨', sand: '沙暴', hail: '冰雹' };
      if (!ctx) { events.push(msg(`${mv.name}：没有效果。`)); break; }
      ctx.weather = ef.weather; // 'sun' | 'rain' | 'sand' | 'hail'
      ctx.weatherTurns = 5;
      events.push(msg(`${WEATHER_NAME[ef.weather] || mv.name}开始了！`));
      break;
    }
    case 'field': {
      const FIELD_NAME = { grass: '青草场地', mist: '薄雾场地', electric: '电气场地' };
      if (!ctx) { events.push(msg(`${mv.name}：没有效果。`)); break; }
      ctx.field = ef.field; // 'grass' | 'mist' | 'electric'
      ctx.fieldTurns = 5;
      events.push(msg(`${FIELD_NAME[ef.field] || mv.name}展开了！`));
      break;
    }
    case 'wall': {
      const side = ef.wall; // 'phys' 反射壁 | 'spec' 光墙 | 'aura' 极光幕（物理减半）
      if (side === 'aura' && (!ctx || ctx.weather !== 'hail')) {
        events.push(msg('但是没有效果！（极光幕需要冰雹天气）'));
        break;
      }
      if (side === 'phys' || side === 'aura') actor.wallPhys = 5;
      else actor.wallSpec = 5;
      events.push(msg(`${mv.name}展开了！`));
      break;
    }
    case 'regen': {
      actor.regen = true;
      events.push(msg(`${actor.name}被水流环包围了！`));
      break;
    }
    case 'bellyDrum': {
      const cost = Math.floor(actor.maxHp / 2);
      if (actor.hp <= cost) {
        events.push(msg('但是没有效果！（体力不足）'));
        break;
      }
      const fromHp = actor.hp;
      actor.hp -= cost;
      events.push({ t: 'dmg', who: actor.name, uid: actor.uid, amount: cost, from: fromHp, to: actor.hp, text: `${actor.name}削减了 ${cost} 点HP！` });
      actor.stages[0] = 6;
      actor.stageTypes[0] = mv.type;
      events.push({ t: 'stat', who: actor.name, uid: actor.uid, text: `${actor.name}的攻击提升到了极限！` });
      break;
    }
    case 'psychUp': {
      for (let i = 0; i < 7; i++) {
        actor.stages[i] = target.stages[i];
        actor.stageTypes[i] = target.stageTypes[i];
      }
      events.push(msg(`${actor.name}复制了${target.name}的能力变化！`));
      break;
    }
    case 'hazard': {
      const hz = ctx && ctx.hazards;
      if (!hz) { events.push(msg('但是没有效果！')); break; }
      const isP = (ctx.pTeam || []).some((x) => x.mon === actor);
      const side = isP ? hz.e : hz.p;
      const key = ef.hazard; // 'spikes' | 'toxic' | 'rock'
      if (key === 'spikes' && side.spikes < 3) {
        side.spikes++;
        events.push(msg('对方场地撒满了尖刺！'));
      } else if (key === 'toxic' && side.toxic < 2) {
        side.toxic++;
        events.push(msg('对方场地撒下了毒菱！'));
      } else if (key === 'rock' && !side.rock) {
        side.rock = true;
        events.push(msg('在对方场地布下了隐形岩！'));
      } else {
        events.push(msg('但是没有效果！'));
      }
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
    events.push({ t: 'flinch', who: mon.name, uid: mon.uid, text: `${mon.name}畏缩了，无法行动！` });
    return false;
  }
  if (mon.status === 'freeze') {
    if (Math.random() < 0.2) clearStatus(mon, events, `${mon.name}解冻了！`);
    else { events.push(msg(`${mon.name}被冻住，无法行动。`)); return false; }
  }
  if (mon.status === 'sleep') {
    if (mon.sleepTurns <= 0) {
      clearStatus(mon, events, `${mon.name}醒了过来！`);
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
  if (mon.status === 'infatuation' && Math.random() < 0.5) {
    events.push(msg(`${mon.name}因着迷而无法行动！`));
    return false;
  }
  if (mon.status === 'confusion') {
    mon.confusionTurns--;
    if (Math.random() < 0.5) {
      events.push(msg(`${mon.name}混乱了，攻击了自己！`));
      const self = Math.max(1, Math.floor(mon.effStat(1) * 0.5));
      mon.hp -= self;
      events.push({ t: 'dmg', who: mon.name, uid: mon.uid, amount: self, text: `${mon.name}被自己打掉 ${self} 点HP。` });
      if (mon.hp <= 0) events.push({ t: 'faint', who: mon.name, uid: mon.uid, text: `${mon.name}倒下了！` });
    }
    if (mon.confusionTurns <= 0) clearStatus(mon, events, `${mon.name}清醒了过来！`);
    return mon.hp > 0;
  }
  return true;
}
// 回合末持续伤害（dmg 事件让播放层刷新 HP 条并弹出伤害数字）
export function postTurn(mon, events, ctx = null) {
  if (mon.hp <= 0) return;
  // 天气持续伤害：沙暴（岩/地/钢免疫）、冰雹（冰免疫）
  if (ctx && ctx.weather === 'sand' && !mon.types.some((t) => t === '岩石' || t === '地面' || t === '钢')) {
    const d = Math.floor(mon.maxHp / 16);
    mon.hp -= d;
    events.push({ t: 'dmg', who: mon.name, uid: mon.uid, amount: d, text: `${mon.name}被沙暴刮得生疼，受到 ${d} 点伤害！` });
  } else if (ctx && ctx.weather === 'hail' && !mon.types.includes('冰')) {
    const d = Math.floor(mon.maxHp / 16);
    mon.hp -= d;
    events.push({ t: 'dmg', who: mon.name, uid: mon.uid, amount: d, text: `${mon.name}被冰雹砸中，受到 ${d} 点伤害！` });
  }
  // 青草场地：回合末回复 1/16
  if (ctx && ctx.field === 'grass') {
    const healed = Math.min(mon.maxHp - mon.hp, Math.floor(mon.maxHp / 16));
    if (healed > 0) {
      mon.hp += healed;
      events.push({ t: 'heal', who: mon.name, uid: mon.uid, amount: healed, text: `${mon.name}被青草场地滋养，回复了 ${healed} 点HP！` });
    }
  }
  // 水流环：回合末回复 1/16
  if (mon.regen) {
    const healed = Math.min(mon.maxHp - mon.hp, Math.floor(mon.maxHp / 16));
    if (healed > 0) {
      mon.hp += healed;
      events.push({ t: 'heal', who: mon.name, uid: mon.uid, amount: healed, text: `${mon.name}被水流环治愈，回复了 ${healed} 点HP！` });
    }
  }
  if (mon.status === 'poison') {
    const d = Math.floor(mon.maxHp / 8);
    mon.hp -= d;
    events.push({ t: 'dmg', who: mon.name, uid: mon.uid, amount: d, text: `${mon.name}因为中毒受到 ${d} 点伤害！` });
  }
  if (mon.status === 'burn') {
    const d = Math.floor(mon.maxHp / 16);
    mon.hp -= d;
    events.push({ t: 'dmg', who: mon.name, uid: mon.uid, amount: d, text: `${mon.name}因为灼伤受到 ${d} 点伤害！` });
  }
  if (mon.status === 'curse') {
    const d = Math.floor(mon.maxHp / 4);
    mon.hp -= d;
    events.push({ t: 'dmg', who: mon.name, uid: mon.uid, amount: d, text: `${mon.name}因诅咒受到 ${d} 点伤害！` });
  }
  if (mon.perishTurns > 0) {
    mon.perishTurns--;
    if (mon.perishTurns === 0) {
      // dmg 事件把血条扣到底，faint 由函数末尾统一追加
      events.push({ t: 'dmg', who: mon.name, uid: mon.uid, amount: mon.hp, from: mon.hp, to: 0, text: `${mon.name}被终焉之歌夺去了生命！` });
      mon.hp = 0;
    } else {
      events.push(msg(`${mon.name}的终焉之歌倒计时：${mon.perishTurns} 回合…`));
    }
  }
  // 行动限制倒计时：定身法/无理取闹、再来一次、挑衅
  if (mon.disableTurns > 0) {
    mon.disableTurns--;
    if (mon.disableTurns === 0) {
      mon.disabledMove = null;
      events.push(msg(`${mon.name}的招式封印解除了！`));
    }
  }
  if (mon.encoreTurns > 0) {
    mon.encoreTurns--;
    if (mon.encoreTurns === 0) {
      mon.lockedMove = null;
      events.push(msg(`${mon.name}的再来一次效果结束了！`));
    }
  }
  if (mon.tauntTurns > 0) {
    mon.tauntTurns--;
    if (mon.tauntTurns === 0) events.push(msg(`${mon.name}的挑衅效果结束了！`));
  }
  // 寄生种子：每回合吸取目标 HP 回复施种者（施种者倒下则效果消失）
  if (mon.seeded && mon.seedSrc && mon.seedSrc.hp > 0 && mon.hp > 1) {
    const drain = Math.min(mon.hp - 1, Math.max(1, Math.floor(mon.maxHp / 8)));
    const src = mon.seedSrc;
    events.push({ t: 'seedDrain', from: mon, to: src }); // 吸血粒子：绿色能量从被吸者身上吸回施种者
    mon.hp -= drain;
    events.push({ t: 'dmg', who: mon.name, uid: mon.uid, amount: drain, text: `${mon.name}被寄生种子吸走了 ${drain} 点HP！` });
    const healed = Math.min(src.maxHp - src.hp, drain);
    if (healed > 0) {
      src.hp += healed;
      events.push({ t: 'heal', who: src.name, uid: src.uid, amount: healed, text: `${src.name}回复了 ${healed} 点HP！` });
    }
  }
  if (mon.hp <= 0) events.push({ t: 'faint', who: mon.name, uid: mon.uid, text: `${mon.name}倒下了！` });
}

// 回合末倒计时：天气/场地剩余回合递减，光墙/反射壁剩余回合递减（只减当前出场宝可梦）
export function tickBattleTurns(battle, events) {
  if ((battle.weatherTurns || 0) > 0) {
    battle.weatherTurns--;
    if (battle.weatherTurns <= 0 && battle.weather) {
      battle.weather = null;
      events.push(msg('天气恢复了原状。'));
    }
  }
  if ((battle.fieldTurns || 0) > 0) {
    battle.fieldTurns--;
    if (battle.fieldTurns <= 0 && battle.field) {
      battle.field = null;
      events.push(msg('场地的效果消失了。'));
    }
  }
  for (const side of ['p', 'e']) {
    const mon = side === 'p' ? battle.pTeam[battle.pIdx].mon : battle.eTeam[battle.eIdx].mon;
    if (mon) {
      if (mon.wallPhys > 0) mon.wallPhys--;
      if (mon.wallSpec > 0) mon.wallSpec--;
    }
  }
}

// ---------- AI：按属性克制与威力择优（克制的招优先，免疫的尽量避开） ----------
const AI_DMG_KIND = ['damage', 'multihit', 'fixed', 'drain', 'recoil', 'counter', 'mirrorCoat'];
export function aiMove(actor, enemy, data) {
  const usable = actor.moves.filter((m) => {
    const ms = String(m);
    const ef = data.moves[m] && data.moves[m].effect;
    if (!ef || ef.kind === 'unimplemented') return false;
    if (actor.lockedMove != null && ms !== actor.lockedMove) return false; // 再来一次：锁定招式
    if (actor.disabledMove != null && ms === actor.disabledMove) return false; // 定身法/无理取闹：封印招式
    if (actor.tauntTurns > 0 && !AI_DMG_KIND.includes(ef.kind)) return false; // 挑衅：只能用攻击招式
    return true;
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
    } else if ((ef.kind === 'heal' || ef.kind === 'sleepRest' || ef.kind === 'healCure') && actor.hp < actor.maxHp * 0.45) {
      score += 10; // 血量低时优先回复
    } else if (ef.kind === 'swapStats') {
      score += Math.random() < 0.2 ? 5 : -6; // 能力互换：随机尝试
    } else if (ef.kind === 'destinyBond' || ef.kind === 'memento') {
      score += actor.hp < actor.maxHp * 0.3 && Math.random() < 0.4 ? 8 : -8; // 濒死时同命/临别礼物
    } else if (ef.kind === 'metronome') {
      score += Math.random() < 0.1 ? 3 : -7; // 挥指功：偶尔博一手
    } else if (ef.kind === 'haze') {
      score += Math.random() < 0.25 ? 5 : -6; // 黑雾：视情况重置能力
    } else if (ef.kind === 'painSplit') {
      score += actor.hp < actor.maxHp * 0.5 && Math.random() < 0.4 ? 7 : -7; // 分担痛楚：血量低时拉平
    } else if (ef.kind === 'curse') {
      score += !enemy.status && Math.random() < 0.3 ? 6 : -8; // 咒术：对方无状态时施放
    } else if (ef.kind === 'acupressure') {
      score += Math.random() < 0.2 ? 4 : -6; // 点穴：随机强化
    } else if (ef.kind === 'powerTrick') {
      score += Math.random() < 0.2 ? 4 : -7; // 力量戏法：赌一手
    } else if (ef.kind === 'topsyTurvy') {
      score += Math.random() < 0.2 ? 4 : -7; // 颠倒：反转对方能力
    } else if (ef.kind === 'defog') {
      score += Math.random() < 0.3 ? 5 : -6; // 清除浓雾：清理钉子
    } else if (ef.kind === 'averageStats') {
      score += Math.random() < 0.2 ? 4 : -6; // 平分能力：随机使用
    } else if (ef.kind === 'disable' || ef.kind === 'encore' || ef.kind === 'taunt') {
      score += Math.random() < 0.25 ? 6 : -5; // 定身法/再来一次/挑衅：干扰对方
    } else if (ef.kind === 'mimic') {
      score += Math.random() < 0.3 ? 4 : -5; // 模仿：随目标出招
    } else if (ef.kind === 'whirlwind') {
      score += Math.random() < 0.3 ? 5 : -6; // 吹飞/吼叫：强制对手换人
    } else if (ef.kind === 'batonPass') {
      const boosted = actor.stages.reduce((a, b) => a + Math.abs(b), 0);
      score += boosted >= 2 ? 6 : -7; // 接棒：能力提升后使用
    } else if (ef.kind === 'perishSong') {
      score += Math.random() < 0.1 ? 2 : -10; // 终焉之歌：自杀式，几乎不用
    } else if (ef.kind === 'weather' || ef.kind === 'field') {
      score += Math.random() < 0.5 ? 6 : -4; // 天气/场地：常驻收益
    } else if (ef.kind === 'wall') {
      score += Math.random() < 0.4 ? 7 : -5; // 光墙/反射壁/极光幕
    } else if (ef.kind === 'regen') {
      score += actor.regen ? -8 : 8; // 水流环：未开启时用
    } else if (ef.kind === 'bellyDrum') {
      score += actor.hp > actor.maxHp * 0.75 && Math.random() < 0.45 ? 8 : -8; // 腹鼓：血线健康时用
    } else if (ef.kind === 'psychUp') {
      score += Math.random() < 0.15 ? 3 : -7;
    } else if (ef.kind === 'hazard') {
      score += Math.random() < 0.4 ? 6 : -4;
    } else if (ef.kind === 'attract') {
      const ag = actor.gender, eg = enemy.gender;
      const ok = ag && eg && ag !== 'genderless' && eg !== 'genderless' && ag !== eg;
      score += ok && !enemy.status && Math.random() < 0.4 ? 8 : -8; // 诱惑：异性且对方无状态时施放
    } else {
      score -= 8;
    }
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
