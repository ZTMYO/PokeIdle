import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SAVE_FORMAT_VERSION,
  SAVE_MAX_BYTES,
  SaveTransferError,
  buildExportFileName,
  parseSaveTransfer,
  prepareImportedSave,
  serializeSaveForExport,
  summarizeSave,
} from '../src/save-transfer.js';

const complete = {
  items: { candy: 321 },
  stats: { lastSaveTime: 100 },
  settings: { gender: 'may' },
  team: ['a'],
  roster: [{ id: 'a' }, { id: 'b' }],
  pokedex: { 1: true, 4: true },
};

test('导出稳定的存档格式常量', () => {
  assert.equal(SAVE_FORMAT_VERSION, 1);
  assert.equal(SAVE_MAX_BYTES, 20 * 1024 * 1024);
});

test('将没有元数据的旧存档识别为格式 0', () => {
  const parsed = parseSaveTransfer(JSON.stringify(complete));

  assert.equal(parsed.formatVersion, 0);
  assert.deepEqual(parsed.data, complete);
  assert.deepEqual(parsed.summary, {
    lastSaveTime: 100,
    gender: 'may',
    candy: 321,
    teamCount: 1,
    rosterCount: 2,
    pokedexCount: 2,
  });
});

test('接受当前格式的存档', () => {
  const data = {
    ...complete,
    __pokeidleMeta: {
      formatVersion: 1,
      appVersion: '1.0.8',
      exportedAt: '2026-08-18T12:00:00.000Z',
    },
  };

  const parsed = parseSaveTransfer(JSON.stringify(data));

  assert.equal(parsed.formatVersion, 1);
  assert.deepEqual(parsed.data, data);
});

test('拒绝未来格式的存档并提供稳定错误码', () => {
  const data = {
    ...complete,
    __pokeidleMeta: { formatVersion: SAVE_FORMAT_VERSION + 1 },
  };

  assert.throws(
    () => parseSaveTransfer(JSON.stringify(data)),
    error => error instanceof SaveTransferError && error.code === 'FUTURE_VERSION',
  );
});

test('将损坏 JSON 包装为存档传输错误', () => {
  assert.throws(
    () => parseSaveTransfer('{bad json'),
    error => error instanceof SaveTransferError,
  );
});

test('拒绝数组和其他非对象根值', () => {
  for (const value of [null, [], 42, 'save']) {
    assert.throws(
      () => parseSaveTransfer(JSON.stringify(value)),
      error => error instanceof SaveTransferError,
    );
  }
});

test('拒绝缺少对象类型 items 或 stats 的存档', () => {
  const invalidSaves = [
    { stats: {} },
    { items: {} },
    { items: [], stats: {} },
    { items: {}, stats: null },
  ];

  for (const data of invalidSaves) {
    assert.throws(
      () => parseSaveTransfer(JSON.stringify(data)),
      error => error instanceof SaveTransferError,
    );
  }
});

test('按 UTF-8 字节数拒绝超过 20 MB 的存档', () => {
  const data = {
    items: {},
    stats: {},
    padding: '存'.repeat(Math.floor(SAVE_MAX_BYTES / 3)),
  };
  const raw = JSON.stringify(data);

  assert.ok(raw.length < SAVE_MAX_BYTES);
  assert.ok(new TextEncoder().encode(raw).byteLength > SAVE_MAX_BYTES);
  assert.throws(
    () => parseSaveTransfer(raw),
    error => error instanceof SaveTransferError,
  );
});

test('摘要缺失的可选值固定返回 null', () => {
  assert.deepEqual(summarizeSave({ items: {}, stats: {} }), {
    lastSaveTime: null,
    gender: null,
    candy: null,
    teamCount: null,
    rosterCount: null,
    pokedexCount: null,
  });
});

test('使用本地时间生成带零填充的导出文件名', () => {
  const now = new Date(2026, 7, 18, 9, 5, 7);

  assert.equal(buildExportFileName(now), 'pokeidle-save-20260818-090507.json');
});

test('序列化导出副本并保持原存档不变', () => {
  const now = new Date(2026, 7, 18, 9, 5, 7);
  const data = {
    ...structuredClone(complete),
    unknown: { nested: ['keep'] },
    __pokeidleMeta: { formatVersion: 0, appVersion: 'old' },
  };
  const original = structuredClone(data);

  const exported = serializeSaveForExport(data, {
    appVersion: '1.0.8',
    now,
  });
  const serialized = JSON.parse(exported.json);

  assert.equal(exported.fileName, 'pokeidle-save-20260818-090507.json');
  assert.deepEqual(serialized.__pokeidleMeta, {
    formatVersion: SAVE_FORMAT_VERSION,
    appVersion: '1.0.8',
    exportedAt: now.toJSON(),
  });
  assert.equal(serialized.stats.lastSaveTime, 100);
  assert.deepEqual(serialized.unknown, { nested: ['keep'] });
  assert.deepEqual(data, original);
});

test('准备导入副本时移除元数据并生成更新的保存时间', () => {
  const data = {
    ...structuredClone(complete),
    unknown: { nested: ['keep'] },
    __pokeidleMeta: { formatVersion: SAVE_FORMAT_VERSION },
  };
  const currentSave = { stats: { lastSaveTime: 500 } };
  const originalData = structuredClone(data);
  const originalCurrentSave = structuredClone(currentSave);

  const prepared = prepareImportedSave(data, { currentSave, now: 400 });

  assert.equal(prepared.stats.lastSaveTime, 501);
  assert.ok(prepared.stats.lastSaveTime > 400);
  assert.ok(prepared.stats.lastSaveTime > currentSave.stats.lastSaveTime);
  assert.equal('__pokeidleMeta' in prepared, false);
  assert.deepEqual(prepared.unknown, { nested: ['keep'] });
  assert.deepEqual(data, originalData);
  assert.deepEqual(currentSave, originalCurrentSave);

  prepared.unknown.nested.push('changed');
  assert.deepEqual(data.unknown, { nested: ['keep'] });
});
