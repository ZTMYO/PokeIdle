import test from 'node:test';
import assert from 'node:assert/strict';

import { settleBackgroundSlice } from '../src/background-settlement.js';

const DAY_MS = 24 * 60 * 60 * 1000;

test('按经过时间生成遭遇并保证同一游标幂等', () => {
  const state = { settledAt: 0, candy: 0, balls: { 'poke-ball': 3 }, stats: {} };
  const randomValues = [0.1, 0.2];
  const seenRandomValues = [];
  const options = {
    now: 31_000,
    encounterEveryMs: 15_000,
    random: () => randomValues.shift(),
    resolveEncounter: ({ random }) => {
      seenRandomValues.push(random);
      return { result: 'caught', ball: 'poke-ball' };
    },
  };

  const first = settleBackgroundSlice(state, options);

  assert.equal(first.encounters, 2);
  assert.equal(first.elapsedMs, 31_000);
  assert.equal(first.state.settledAt, 31_000);
  assert.equal(first.state.balls['poke-ball'], 1);
  assert.deepEqual(first.results, [
    { result: 'caught', ball: 'poke-ball' },
    { result: 'caught', ball: 'poke-ball' },
  ]);
  assert.deepEqual(seenRandomValues, [0.1, 0.2]);

  const repeat = settleBackgroundSlice(first.state, options);

  assert.equal(repeat.encounters, 0);
  assert.equal(repeat.elapsedMs, 0);
  assert.equal(repeat.state.balls['poke-ball'], 1);
  assert.deepEqual(repeat.results, []);
});

test('跨多个短时间片累计不足一个遇敌间隔的余数', () => {
  const options = {
    encounterEveryMs: 15_000,
    random: () => 0,
    resolveEncounter: () => ({ result: 'fled' }),
  };
  const initial = { settledAt: 0, balls: {}, stats: {} };

  const first = settleBackgroundSlice(initial, { ...options, now: 10_000 });
  const second = settleBackgroundSlice(first.state, { ...options, now: 20_000 });
  const third = settleBackgroundSlice(second.state, { ...options, now: 30_000 });
  const repeat = settleBackgroundSlice(third.state, { ...options, now: 30_000 });

  assert.deepEqual(
    [first.encounters, second.encounters, third.encounters, repeat.encounters],
    [0, 1, 1, 0],
  );
  assert.equal(first.state.encounterRemainderMs, 10_000);
  assert.equal(second.state.encounterRemainderMs, 5_000);
  assert.equal(third.state.encounterRemainderMs, 0);
  assert.equal(repeat.state.encounterRemainderMs, 0);
});

test('resolver 接收片内序号和包含前片余数的准确遭遇时间', () => {
  const calls = [];
  const state = {
    settledAt: 10_000,
    encounterRemainderMs: 400,
    balls: {},
    stats: {},
  };

  const settled = settleBackgroundSlice(state, {
    now: 12_600,
    encounterEveryMs: 1_000,
    random: () => 0,
    resolveEncounter: ({ encounterIndex, at }) => {
      calls.push({ encounterIndex, at });
      return { result: 'fled' };
    },
  });

  assert.equal(settled.encounters, 3);
  assert.deepEqual(calls, [
    { encounterIndex: 0, at: 10_600 },
    { encounterIndex: 1, at: 11_600 },
    { encounterIndex: 2, at: 12_600 },
  ]);
});

test('累计 caught、fled 和 continue 结果并扣除各自返回的球', () => {
  const resolutions = [
    { result: 'caught', ball: 'poke-ball' },
    { result: 'fled', ball: 'great-ball' },
    { result: 'continue', ball: 'poke-ball' },
  ];
  const state = {
    settledAt: 10_000,
    balls: { 'poke-ball': 2, 'great-ball': 1 },
    stats: { totalCatches: 4 },
  };

  const settled = settleBackgroundSlice(state, {
    now: 40_000,
    encounterEveryMs: 10_000,
    random: () => 0,
    resolveEncounter: () => resolutions.shift(),
  });

  assert.equal(settled.encounters, 3);
  assert.deepEqual(settled.results.map(item => item.result), ['caught', 'fled', 'continue']);
  assert.deepEqual(settled.state.balls, { 'poke-ball': 0, 'great-ball': 0 });
});

test('时间相等或回拨时不结算，并从回拨后的时间继续推进', () => {
  const state = {
    settledAt: 100_000,
    encounterRemainderMs: 900,
    balls: { 'poke-ball': 1 },
    stats: {},
  };
  let resolutions = 0;
  const options = {
    encounterEveryMs: 1_000,
    random: () => 0,
    resolveEncounter: () => {
      resolutions += 1;
      return { result: 'caught', ball: 'poke-ball' };
    },
  };

  const equal = settleBackgroundSlice(state, { ...options, now: 100_000 });
  const rolledBack = settleBackgroundSlice(equal.state, { ...options, now: 99_000 });

  assert.equal(equal.encounters, 0);
  assert.equal(rolledBack.encounters, 0);
  assert.equal(rolledBack.elapsedMs, 0);
  assert.equal(rolledBack.state.settledAt, 99_000);
  assert.equal(rolledBack.state.encounterRemainderMs, 0);
  assert.equal(resolutions, 0);

  const partial = settleBackgroundSlice(rolledBack.state, { ...options, now: 99_500 });
  const resumed = settleBackgroundSlice(partial.state, { ...options, now: 100_000 });
  assert.equal(partial.encounters, 0);
  assert.equal(partial.state.encounterRemainderMs, 500);
  assert.equal(resumed.encounters, 1);
  assert.equal(resumed.state.encounterRemainderMs, 0);
  assert.equal(resumed.state.balls['poke-ball'], 0);
});

test('默认和显式上限都只结算最近 24 小时并直接推进到 now', () => {
  const state = { settledAt: 100_000, balls: {}, stats: {} };
  const now = 100_000 + 48 * 60 * 60 * 1000;
  const options = {
    now,
    encounterEveryMs: 60 * 60 * 1000,
    random: () => 0,
  };

  for (const maxElapsedMs of [undefined, DAY_MS]) {
    const encounterTimes = [];
    const settled = settleBackgroundSlice(state, {
      ...options,
      maxElapsedMs,
      resolveEncounter: ({ at }) => {
        encounterTimes.push(at);
        return { result: 'fled' };
      },
    });
    const repeat = settleBackgroundSlice(settled.state, {
      ...options,
      maxElapsedMs,
      resolveEncounter: () => ({ result: 'fled' }),
    });

    assert.equal(settled.elapsedMs, DAY_MS);
    assert.equal(settled.encounters, 24);
    assert.equal(encounterTimes[0], now - DAY_MS + 60 * 60 * 1000);
    assert.equal(encounterTimes.at(-1), now);
    assert.equal(settled.state.settledAt, now);
    assert.equal(repeat.encounters, 0);
  }
});

test('非法 now 不结算且不修改时间游标或余数', () => {
  const state = {
    settledAt: 5_000,
    encounterRemainderMs: 750,
    balls: {},
    stats: {},
  };

  for (const now of [null, '', Number.NaN, Number.POSITIVE_INFINITY]) {
    const settled = settleBackgroundSlice(state, {
      now,
      encounterEveryMs: 1_000,
      random: () => 0,
      resolveEncounter: () => ({ result: 'fled' }),
    });

    assert.equal(settled.encounters, 0);
    assert.equal(settled.elapsedMs, 0);
    assert.equal(settled.state.settledAt, state.settledAt);
    assert.equal(settled.state.encounterRemainderMs, state.encounterRemainderMs);
  }
});

test('maxElapsedMs 和 encounterEveryMs 不接受隐式数值转换', () => {
  const initial = { settledAt: 0, balls: {}, stats: {} };
  const invalidNumbers = [null, '', '1000', Number.NaN, Number.POSITIVE_INFINITY];

  for (const maxElapsedMs of invalidNumbers) {
    const settled = settleBackgroundSlice(initial, {
      now: 2_000,
      maxElapsedMs,
      encounterEveryMs: 1_000,
      random: () => 0,
      resolveEncounter: () => ({ result: 'fled' }),
    });
    assert.equal(settled.elapsedMs, 2_000);
    assert.equal(settled.encounters, 2);
    assert.equal(settled.state.settledAt, 2_000);
  }

  for (const encounterEveryMs of invalidNumbers) {
    const settled = settleBackgroundSlice(initial, {
      now: 2_000,
      encounterEveryMs,
      random: () => 0,
      resolveEncounter: () => ({ result: 'fled' }),
    });
    assert.equal(settled.encounters, 0);
    assert.equal(settled.state.settledAt, 2_000);
  }
});

test('不修改输入 state，并在无结算时也返回独立副本', () => {
  const state = {
    settledAt: 5_000,
    candy: 7,
    balls: { 'poke-ball': 2 },
    stats: { totalCatches: 1 },
  };
  const snapshot = structuredClone(state);

  const settled = settleBackgroundSlice(state, {
    now: 5_000,
    encounterEveryMs: 1_000,
    random: () => 0,
    resolveEncounter: () => ({ result: 'continue' }),
  });

  assert.deepEqual(state, snapshot);
  assert.deepEqual(settled.state, snapshot);
  assert.notEqual(settled.state, state);
  assert.notEqual(settled.state.balls, state.balls);
  assert.notEqual(settled.state.stats, state.stats);
});

test('未提供随机源时不读取全局随机状态', () => {
  let receivedRandom = 'not-called';

  const settled = settleBackgroundSlice({ settledAt: 0, balls: {}, stats: {} }, {
    now: 1_000,
    encounterEveryMs: 1_000,
    resolveEncounter: ({ random }) => {
      receivedRandom = random;
      return { result: 'fled' };
    },
  });

  assert.equal(settled.encounters, 1);
  assert.equal(receivedRandom, undefined);
});

test('resolver 修改返回状态的嵌套数据时不影响输入 state', () => {
  const state = {
    settledAt: 0,
    balls: {},
    stats: {},
    collection: [{ id: 25, metadata: { caught: false } }],
  };

  const settled = settleBackgroundSlice(state, {
    now: 1_000,
    encounterEveryMs: 1_000,
    random: () => 0,
    resolveEncounter: ({ state: nextState }) => {
      nextState.collection[0].metadata.caught = true;
      return { result: 'caught' };
    },
  });

  assert.equal(state.collection[0].metadata.caught, false);
  assert.equal(settled.state.collection[0].metadata.caught, true);
  assert.notEqual(settled.state.collection, state.collection);
});
