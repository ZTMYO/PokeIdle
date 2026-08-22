// ===== 控制台调试命令（window.__*）统一登记处 =====
// 用法：游戏加载完成后，F12 控制台直接调用示例：
//   __addCandy(500)                   增加糖果
//   __matureBerries()                 农场树果全部成熟
//   __teleport(3)                     传送到指定地区（1关都…9帕底亚）
//   __finishAll()                     一键完成：孵蛋器+繁殖+派遣
//   __addEgg(25)                      添加宝可梦蛋（6V）
//   __addPoke(25) / __addShinyPoke(25) 写入 6V / 闪光精灵
//   __addPokeLv(25, 50)               写入指定等级
//   __unlockAllPokedex(true)          解锁全图鉴（含闪光）
//   __nextEncounter(25, true)         指定下次遇敌（用后即焚）
//   __refreshAll()                    一键刷新：对战/交换/大量出没/时空扭曲
//   __npcTeam(25, 6, 149)             对战 NPC 全部使用指定精灵
import {
  gameData, allPokemon, getPokemonByIndex, addRosterEntry, saveGame,
  ensureGpsState, setLastRegionId, syncGpsPosition, rollGender, rollNature,
} from './state.js';
import { REGION_CYCLE } from './config.js';
import { $, updateBackpack, updateStats, renderIncubatorView, updateIncubatorBadge } from './ui.js';
import { refreshBerryView } from './berry.js';
import { showGpsView } from './gps.js';
import { forceRefreshMassOutbreak, forceRefreshTwist } from './events.js';
import { setDebugNextEncounter } from './battle.js';
import { isBattleActive, renderBattleList } from './battle-view.js';
import { refreshNpcs } from './npcs.js';
import { refreshTrades, renderTrade } from './trade.js';
import { isRosterInDetail, restoreRosterList, showRosterView } from './roster.js';
import { showPokedex } from './pokedex.js';
import { computeObtainScore } from './scoring.js';
import { ensureNursery, settleBreeding, renderEggView, render as renderNursery, isNurseryEggView } from './nursery.js';
import { ensureDispatch, rollRewards, render as renderDispatch } from './dispatch.js';

// ---------- 背包 / 储备 ----------
// 快速增加糖果
window.__addCandy = (n = 1000) => {
  const amount = Number(n) || 1000;
  gameData.items['candy'] = (gameData.items['candy'] || 0) + amount;
  gameData.stats.totalItemsEarned = gameData.stats.totalItemsEarned || {};
  gameData.stats.totalItemsEarned.candy = (gameData.stats.totalItemsEarned.candy || 0) + amount;
  saveGame();
  updateBackpack('candy');
  updateStats();
  console.log('糖果 +' + amount);
};

// ---------- 农场 / GPS / 事件 ----------
// 一键让农场所有已种植地块成熟
window.__matureBerries = () => {
  const f = gameData.berryFarm;
  if (!f || !Array.isArray(f.plots)) { console.warn('__matureBerries: 尚未开启农场'); return; }
  let n = 0;
  f.plots.forEach(p => {
    if (!p) return;
    p.grownMs = p.totalMs || 30 * 60 * 1000; // 生长进度直接拉满，进入「可收获」
    n++;
  });
  if (!n) { console.warn('__matureBerries: 农场没有已种植的树果'); return; }
  saveGame();
  refreshBerryView();
  console.log(`__matureBerries: ${n} 棵树果已成熟，可以收获了`);
};

// 传送到指定地区：__teleport(1~9)，对应 1关都 2城都 3丰缘 4神奥 5合众 6卡洛斯 7阿罗拉 8伽勒尔 9帕底亚
window.__teleport = async (n) => {
  const idx = Number(n);
  if (!Number.isInteger(idx) || idx < 1 || idx > 9) {
    console.warn('__teleport: 请输入 1~9（1关都 2城都 3丰缘 4神奥 5合众 6卡洛斯 7阿罗拉 8伽勒尔 9帕底亚）');
    return;
  }
  const target = idx - 1;
  const g = ensureGpsState();
  // 关闭漫游/导航，直接落位目标地区节点（构造与 clearRouteAt 一致的停止态，避免上次残留路径干扰）
  g.roamEnabled = false;
  g.destIdx = null;
  g.massTarget = null;
  g.massArrived = false;
  g.path = null;
  g.seg = 0;
  g.units = 0;
  g.totalPx = 0;
  g.remainPx = 0;
  g.curIdx = target;
  setLastRegionId(target);
  syncGpsPosition();
  await saveGame();
  updateStats();
  if ($('gpsView')?.style.display === 'flex') showGpsView();
  console.log(`已传送至 ${REGION_CYCLE[target]}（第${idx}地区）`);
};

// ---------- 队伍 / 图鉴 ----------
// 按宝可梦编号直接写入一只 6V 孵蛋宝可梦（如 __addPoke(25) 写入皮卡丘）。
// 默认 Lv10（调试状态异常等招式时等级太低学不到招式）；includePokeLv 可指定等级
async function addDebugPoke(idx, shiny, level = 10) {
  // 纯数字按 4 位编号补零；扩展编号（如 "0058-1"）原样匹配
  const raw = String(idx);
  const dexIdx = /^\d+$/.test(raw) ? raw.padStart(4, '0') : raw;
  const poke = getPokemonByIndex(dexIdx);
  if (!poke) { console.warn(`__addPoke: 未找到编号 ${idx}`); return null; }
  const entry = addRosterEntry({ species: poke.index, source: 'egg', shiny, level });
  if (entry) entry.ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  // 同步解锁图鉴（与孵蛋流程一致）
  const pdx = String(poke.index);
  if (!gameData.pokedex[pdx]) {
    gameData.pokedex[pdx] = { seen: 0, caught: 0, lastTime: null, shinySeen: 0, shinyCaught: 0 };
  }
  gameData.pokedex[pdx].seen++;
  gameData.pokedex[pdx].caught = (gameData.pokedex[pdx].caught || 0) + 1;
  gameData.pokedex[pdx].lastTime = new Date().toISOString();
  if (shiny) {
    gameData.pokedex[pdx].shinyCaught = (gameData.pokedex[pdx].shinyCaught || 0) + 1;
    gameData.stats.totalShinyEggsHatched = (gameData.stats.totalShinyEggsHatched || 0) + 1;
  }
  gameData.stats.totalCatches++;
  gameData.stats.totalEggsHatched++;
  // 配套写一条「孵蛋获得」遭遇日志，详情页的日志行才有内容
  if (!gameData.encounterLogs) gameData.encounterLogs = {};
  if (!gameData.encounterLogs[poke.index]) gameData.encounterLogs[poke.index] = [];
  gameData.encounterLogs[poke.index].push({
    time: Date.now(),
    shiny,
    result: 'caught',
    balls: {},
    charmBuff: false,
    score: computeObtainScore({ pokemon: poke, source: 'egg', shiny, charmBuff: false, honeyBuff: false, balls: {}, finalRate: 1, ivs: entry.ivs }),
  });
  await saveGame();
  if (isRosterInDetail()) restoreRosterList();
  else if ($('rosterView')?.style.display === 'flex') showRosterView();
  console.log(`__addPoke: 已添加 6V Lv${level} ${shiny ? '闪光 ' : ''}${poke.name}（${shiny ? '蛋闪' : '孵蛋'}）`);
  return entry;
}
window.__addPoke = idx => addDebugPoke(idx, false);
window.__addShinyPoke = idx => addDebugPoke(idx, true);
window.__addPokeLv = (idx, lv) => addDebugPoke(idx, false, lv);
window.__addShinyPokeLv = (idx, lv) => addDebugPoke(idx, true, lv);

// 一键解锁全图鉴（含变体）。默认只解锁普通记录，传 true 额外把闪光也标记为已见/已捕获
window.__unlockAllPokedex = async (withShiny = false) => {
  if (!gameData.pokedex) gameData.pokedex = {};
  const now = new Date().toISOString();
  let n = 0;
  for (const poke of allPokemon) {
    const key = String(poke.index);
    const rec = gameData.pokedex[key] || { seen: 0, caught: 0, lastTime: null, shinySeen: 0, shinyCaught: 0 };
    rec.seen = Math.max(rec.seen, 1);
    rec.caught = Math.max(rec.caught, 1);
    rec.lastTime = now;
    if (withShiny) {
      rec.shinySeen = Math.max(rec.shinySeen, 1);
      rec.shinyCaught = Math.max(rec.shinyCaught, 1);
    }
    gameData.pokedex[key] = rec;
    n++;
  }
  await saveGame();
  if ($('pokedexView')?.style.display !== 'none') showPokedex();
  console.log(`__unlockAllPokedex: 已解锁 ${n} 条图鉴记录${withShiny ? '（含闪光）' : ''}`);
  return n;
};

// ---------- 战斗 ----------
// 指定下一次遇敌的宝可梦（__nextEncounter(25) 下次遇皮卡丘；传 true 遇闪光；遇到后自动清空）
window.__nextEncounter = (idx, shiny = false) => {
  setDebugNextEncounter(idx, shiny);
  const raw = String(idx);
  const dexIdx = /^\d+$/.test(raw) ? raw.padStart(4, '0') : raw;
  const poke = getPokemonByIndex(dexIdx);
  console.log(`__nextEncounter: 下次遇敌已指定为 ${poke ? poke.name : '#' + idx}${shiny ? '（闪光）' : ''}，用后即焚`);
};

// 一键刷新：对战/交换/大量出没/时空扭曲（只重置生成与倒计时，不改变当前位置）
window.__refreshAll = () => {
  refreshNpcs();
  refreshTrades();
  forceRefreshMassOutbreak();
  forceRefreshTwist();
  if ($('gpsView')?.style.display === 'flex') showGpsView();
  const mo = gameData.massOutbreak;
  const tw = gameData.twist;
  console.log(`对战、交换已刷新；大量出没剩余 ${mo ? mo.remain : 0} 只，时空扭曲剩余 ${tw ? tw.remain : 0} 只（位置不变）`);
  if ($('battleView')?.style.display !== 'none' && !isBattleActive()) renderBattleList();
  if ($('tradeView')?.style.display !== 'none') renderTrade();
};

// 刷新一波对战 NPC，并让全部 NPC 的队伍都使用指定的宝可梦
// 用法：__npcTeam(25) 全部用皮卡丘；__npcTeam(25, 6, 149) 全部用这三只；也支持传数组
window.__npcTeam = (...ids) => {
  const list = ids.length === 1 && Array.isArray(ids[0]) ? ids[0] : ids;
  const mons = list.map((v) => String(v).padStart(4, '0'));
  const bad = mons.filter((idx) => !getPokemonByIndex(idx));
  if (!mons.length || bad.length) {
    console.warn(`__npcTeam: 无效编号 ${bad.join(', ')}，用法如 __npcTeam(25, 6)`);
    return;
  }
  refreshNpcs(); // 生成新一波并重置刷新倒计时
  gameData.battleNpcs.list.forEach((n) => { n.mons = [...mons]; });
  if ($('battleView')?.style.display !== 'none' && !isBattleActive()) renderBattleList();
  console.log(`__npcTeam: 对战 NPC 已刷新，全部队伍=${mons.join(', ')}`);
};

// ---------- 一键完成所有进度 ----------
// 完成：孵蛋器里的蛋、饲育屋当前繁殖批次、全部派遣（一次调用，返回各项完成数量）
window.__finishAll = () => {
  let eggs = 0;
  gameData.incubators.forEach(s => {
    if (s && s.eggIndex != null && !s.hatched) { s.hatched = true; eggs++; }
  });
  if ($('incubatorView')?.style.display === 'flex') renderIncubatorView();
  updateIncubatorBadge();

  const n = ensureNursery();
  let bred = 0;
  if (n && n.breeding) {
    // 把开始时间拨到足够早，直接走结算产蛋入库
    n.breeding.startedAt = Date.now() - (n.breeding.durMs || 1) * n.breeding.roundsTotal - 1;
    bred = settleBreeding();
    renderNursery();
  }

  const d = ensureDispatch();
  let dispatched = 0;
  if (d && Array.isArray(d.slots)) {
    d.slots.forEach((slot) => {
      if (!slot || slot.done) return;
      const entry = (gameData.roster || []).find(x => x.id === slot.id);
      if (!entry || entry.inRoster === false) return;
      slot.done = true;
      slot.rewards = rollRewards(entry, slot.durationMin);
      dispatched++;
    });
    if (dispatched) {
      window.dispatchEvent(new Event('dispatch-changed'));
      renderDispatch();
    }
  }

  saveGame();
  const parts = [];
  if (eggs) parts.push(`孵蛋${eggs}枚`);
  if (bred) parts.push(`繁殖${bred}枚蛋入库`);
  if (dispatched) parts.push(`派遣${dispatched}个完成`);
  console.log(`__finishAll: ${parts.length ? parts.join(' · ') : '当前无待完成的进度'}`);
  return { eggs, bred, dispatched };
};

// 直接添加宝可梦蛋到仓库（6V 个体值）。参数 speciesIndex 为图鉴编号，默认为 1（妙蛙种子）
// 用法：__addEgg(25) 获得一只皮卡丘的蛋；__addEgg() 获得妙蛙种子的蛋
window.__addEgg = function (speciesIndex) {
  const species = String(speciesIndex || 1).padStart(4, '0');
  const poke = getPokemonByIndex(species);
  if (!poke) { console.log('[调试] 无效的图鉴编号:', species); return false; }
  if (!Array.isArray(gameData.roster)) gameData.roster = [];
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    kind: 'egg',
    species,
    gender: rollGender(species),
    level: 1,
    exp: 0,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs,
    nature: rollNature(),
    shiny: false,
    source: 'egg',
    obtainedAt: Date.now(),
    inRoster: true,
  };
  gameData.roster.push(entry);
  saveGame();
  if (isNurseryEggView()) renderEggView();
  console.log(`[调试] 已添加 ${poke.name} 的蛋（6V），可在「饲育屋→纸箱」或「孵蛋器→宝可梦蛋」中查看`);
  return true;
};