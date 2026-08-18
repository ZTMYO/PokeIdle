import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseNewestSave, parseSaveCandidate } from '../mobile/save-utils.mjs';

test('只接受包含 items 的合法 JSON 存档', () => {
  assert.deepEqual(parseSaveCandidate('{"items":{},"stats":{"lastSaveTime":4}}'), {
    items: {},
    stats: { lastSaveTime: 4 },
  });
  assert.equal(parseSaveCandidate('{"stats":{}}'), null);
  assert.equal(parseSaveCandidate('{bad json'), null);
});

test('从多个来源选择 lastSaveTime 最大的存档', () => {
  const selected = chooseNewestSave([
    { source: 'local', raw: '{"items":{},"stats":{"lastSaveTime":10}}' },
    { source: 'mobile', raw: '{"items":{},"stats":{"lastSaveTime":20}}' },
  ]);

  assert.equal(selected.source, 'mobile');
  assert.equal(selected.data.stats.lastSaveTime, 20);
});

test('相同时间戳保留候选顺序', () => {
  const selected = chooseNewestSave([
    { source: 'mobile', raw: '{"items":{},"stats":{"lastSaveTime":20}}' },
    { source: 'local', raw: '{"items":{},"stats":{"lastSaveTime":20}}' },
  ]);

  assert.equal(selected.source, 'mobile');
});
