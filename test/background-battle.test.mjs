import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { settleBackgroundSlice } from '../src/background-settlement.js';
import { resolveBackgroundEncounter } from '../src/background-battle.js';
import { getDefaultSave, normalizeBackgroundState } from '../src/state.js';
import { computeMeetScore, computeObtainScore } from '../src/scoring.js';

const pokemon = {
  index: '0025',
  name: '皮卡丘',
  catchRate: 1,
  rarity: 0.4,
  legend: false,
};

function data() {
  return {
    items: { 'poke-ball': 2, 'ultra-ball': 0, 'master-ball': 0 },
    settings: {
      autoCatch: true,
      autoCatchBalls: { 'poke-ball': true, 'ultra-ball': false, 'master-ball': false },
      catchFilter: { rows: { normal: { action: 'catch', levelMin: 0, levelMax: 0, uncaughtOnly: false } } },
    },
    pokedex: {}, roster: [], team: [], encounterLogs: {}, systemLogs: [],
    stats: { totalCatches: 0, totalFlees: 0, totalBallsUsed: 0, totalShinyCaught: 0, totalShinySeen: 0 },
  };
}

function makeEntry({ species, shiny, level, gender }) {
  return { id: `${species}-${level}`, species, shiny, level, gender, ivs: { hp: 1 } };
}

test('后台捕获会扣一球、入库并更新图鉴与日志', () => {
  const gameData = data();
  const state = { balls: { 'poke-ball': 2 }, gameData };
  const result = resolveBackgroundEncounter({
    state,
    pokemon,
    shiny: false,
    level: 7,
    now: 1_000,
    random: () => 0,
    makeRosterEntry: makeEntry,
  });

  assert.equal(result.result, 'caught');
  assert.deepEqual(result.ballCosts, { 'poke-ball': 1 });
  assert.equal(gameData.roster.length, 1);
  assert.equal(gameData.pokedex['0025'].caught, 1);
  assert.equal(gameData.stats.totalCatches, 1);
  assert.equal(gameData.stats.totalBallsUsed, 1);
  assert.equal(gameData.encounterLogs['0025'][0].result, 'caught');
});

test('后台无球时记录主动逃跑且不计入宝可梦逃走统计', () => {
  const gameData = data();
  const result = resolveBackgroundEncounter({
    state: { balls: {}, gameData },
    pokemon,
    random: () => 0,
    makeRosterEntry: makeEntry,
  });

  assert.equal(result.result, 'fled');
  assert.deepEqual(result.ballCosts, {});
  assert.equal(gameData.stats.totalFlees, 0);
  assert.equal(gameData.encounterLogs['0025'][0].selfFlee, true);
  assert.equal(gameData.encounterLogs['0025'][0].score, computeMeetScore({ pokemon }));
});

test('投球失败后宝可梦逃走才增加逃走统计', () => {
  const gameData = data();
  const randomValues = [0.99, 0];
  const result = resolveBackgroundEncounter({
    state: { balls: { 'poke-ball': 1 }, gameData },
    pokemon: { ...pokemon, catchRate: 0 },
    random: () => randomValues.shift(),
    makeRosterEntry: makeEntry,
  });

  assert.equal(result.result, 'fled');
  assert.equal(gameData.stats.totalFlees, 1);
  assert.equal(gameData.encounterLogs['0025'][0].selfFlee, false);
  assert.equal(gameData.systemLogs.at(-1).type, 'pokemon_escaped');
});

test('后台捕获复用物种性别和前台欧气评分规则', () => {
  const gameData = data();
  let genderSpecies = null;
  const result = resolveBackgroundEncounter({
    state: { balls: { 'poke-ball': 1 }, gameData },
    pokemon,
    shiny: true,
    level: 7,
    charmBuff: true,
    honeyBuff: true,
    random: () => 0,
    makeGender: species => {
      genderSpecies = species;
      return 'genderless';
    },
    makeRosterEntry: makeEntry,
  });

  const entry = gameData.roster[0];
  const log = gameData.encounterLogs['0025'][0];
  assert.equal(result.result, 'caught');
  assert.equal(genderSpecies, '0025');
  assert.equal(entry.gender, 'genderless');
  assert.equal(log.charmBuff, true);
  assert.equal(log.score, computeObtainScore({
    pokemon,
    shiny: true,
    charmBuff: true,
    honeyBuff: true,
    balls: { 'poke-ball': 1 },
    finalRate: log.finalRate,
    ivs: entry.ivs,
  }));
});

test('后台捕捉沿用有效随从的捕获增益', () => {
  const gameData = data();
  gameData.follower = { groups: ['catch'], boost: 0.5, endsAt: 5_000 };
  const result = resolveBackgroundEncounter({
    state: { balls: { 'poke-ball': 1 }, gameData },
    pokemon,
    now: 4_000,
    random: () => 0.4,
    makeRosterEntry: makeEntry,
  });

  assert.equal(result.result, 'caught');
});

test('低捕获率宝可梦优先使用已启用的高级球', () => {
  const gameData = data();
  gameData.items['ultra-ball'] = 1;
  gameData.settings.autoCatchBalls['ultra-ball'] = true;
  const result = resolveBackgroundEncounter({
    state: { balls: { 'poke-ball': 1, 'ultra-ball': 1 }, gameData },
    pokemon: { ...pokemon, catchRate: 0.1 },
    random: () => 0,
    makeRosterEntry: makeEntry,
  });

  assert.deepEqual(result.ballCosts, { 'ultra-ball': 1 });
});

test('无球时按自动补球设置消耗糖果后继续捕获', () => {
  const gameData = data();
  gameData.items.candy = 20;
  gameData.settings.autoRefill = true;
  gameData.settings.autoRefillBalls = { 'poke-ball': true };
  gameData.settings.autoRefillOrder = ['poke-ball', 'ultra-ball', 'master-ball'];
  const state = { balls: {}, gameData };
  const result = resolveBackgroundEncounter({
    state,
    pokemon,
    random: () => 0,
    makeRosterEntry: makeEntry,
  });

  assert.equal(result.result, 'caught');
  assert.deepEqual(result.ballCosts, { 'poke-ball': 1 });
  assert.equal(gameData.items.candy, 10);
});

test('时间片结算会应用后台捕获返回的多球消耗且相同游标不重复', () => {
  const initial = { settledAt: 0, balls: { 'poke-ball': 2 }, gameData: data() };
  const options = {
    now: 1_000,
    encounterEveryMs: 1_000,
    random: () => 0,
    resolveEncounter: ({ state }) => resolveBackgroundEncounter({
      state,
      pokemon,
      random: () => 0,
      makeRosterEntry: makeEntry,
    }),
  };

  const first = settleBackgroundSlice(initial, options);
  assert.equal(first.encounters, 1);
  assert.equal(first.state.balls['poke-ball'], 1);
  const repeat = settleBackgroundSlice(first.state, options);
  assert.equal(repeat.encounters, 0);
  assert.equal(repeat.state.balls['poke-ball'], 1);
});

test('过滤器暂停后停止当前时间片并保留后续时间', () => {
  const gameData = data();
  gameData.settings.catchFilter.rows.normal.action = 'stop';
  let resolutions = 0;
  const settled = settleBackgroundSlice({
    settledAt: 0,
    balls: { 'poke-ball': 3 },
    gameData,
  }, {
    now: 3_000,
    encounterEveryMs: 1_000,
    random: () => 0,
    resolveEncounter: ({ state, at }) => {
      resolutions += 1;
      return resolveBackgroundEncounter({
        state,
        pokemon,
        now: at,
        random: () => 0,
        makeRosterEntry: makeEntry,
      });
    },
  });

  assert.equal(resolutions, 1);
  assert.equal(settled.encounters, 1);
  assert.equal(settled.state.settledAt, 1_000);
  assert.equal(settled.state.gameData.pokedex['0025'].seen, 1);
});

test('暂停结果保留恢复手动遭遇所需的来源、变体和等级', () => {
  const gameData = data();
  gameData.settings.catchFilter.rows.normalShiny = { action: 'stop' };
  const result = resolveBackgroundEncounter({
    state: { balls: {}, gameData },
    pokemon,
    shiny: true,
    level: 18,
    source: 'twist',
    variant: 'rgb',
    now: 4_000,
    random: () => 0,
    makeRosterEntry: makeEntry,
  });

  assert.deepEqual(result, {
    result: 'paused',
    ballCosts: {},
    pokemon: '0025',
    shiny: true,
    level: 18,
    source: 'twist',
    variant: 'rgb',
  });
});

test('新旧存档的后台状态默认安全关闭', () => {
  const save = getDefaultSave();
  assert.equal(save.background.enabled, false);
  assert.equal(save.background.stats.encounters, 0);
});

test('后台存档字段归一化会拒绝非法时间、余数和统计值', () => {
  assert.deepEqual(normalizeBackgroundState({
    enabled: true,
    startedAt: -1,
    settledAt: 'future',
    encounterRemainderMs: Number.NaN,
    stats: { encounters: -1, caught: 1.5, fled: '2', ballsUsed: Infinity },
    pendingEncounter: { index: '0025' },
  }, 10_000), {
    enabled: true,
    startedAt: 0,
    settledAt: 10_000,
    encounterRemainderMs: 0,
    stats: { encounters: 0, caught: 0, fled: 0, ballsUsed: 0 },
    lastResult: null,
    pendingEncounter: { index: '0025' },
  });
});

test('后台结算入口不依赖战斗动画或页面渲染', async () => {
  const domain = await readFile(new URL('../src/background-battle.js', import.meta.url), 'utf8');
  const battle = await readFile(new URL('../src/battle.js', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

  assert.doesNotMatch(domain, /playCatchSequence|showView|updateTextBox|\.\/audio\.js/);
  assert.match(battle, /export function settleBackgroundEncounters/);
  assert.match(main, /__POKEIDLE_BACKGROUND_TICK__/);
  assert.match(main, /__POKEIDLE_BACKGROUND_RESUME__/);
  assert.match(main, /delete gameData\.background\.pendingEncounter;[\s\S]{0,160}await saveGame\(\{ strict: true \}\)/);
});
