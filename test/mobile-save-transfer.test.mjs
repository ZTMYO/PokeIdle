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

function buildSaveTextAtByteLength(byteLength) {
  const prefix = '{"items":{},"stats":{},"padding":"';
  const suffix = '"}';
  const fixedBytes = new TextEncoder().encode(prefix + suffix).byteLength;
  const paddingBytes = byteLength - fixedBytes;
  const multibyteCount = Math.floor(paddingBytes / 3);

  return prefix + '存'.repeat(multibyteCount) + 'a'.repeat(paddingBytes % 3) + suffix;
}

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

test('接受显式标记为格式 0 的存档', () => {
  const data = {
    ...complete,
    __pokeidleMeta: { formatVersion: 0 },
  };

  assert.equal(parseSaveTransfer(JSON.stringify(data)).formatVersion, 0);
});

const invalidVersions = [
  ['null 元数据', null],
  ['数组元数据', []],
  ['字符串元数据', 'metadata'],
  ['缺失版本', {}],
  ['null 版本', { formatVersion: null }],
  ['负数版本', { formatVersion: -1 }],
  ['字符串版本', { formatVersion: '1' }],
  ['布尔版本', { formatVersion: true }],
  ['对象版本', { formatVersion: {} }],
  ['数组版本', { formatVersion: [] }],
  ['小数版本', { formatVersion: 0.5 }],
];

for (const [name, __pokeidleMeta] of invalidVersions) {
  test(`以 INVALID_VERSION 拒绝${name}`, () => {
    const data = { ...complete, __pokeidleMeta };

    assert.throws(
      () => parseSaveTransfer(JSON.stringify(data)),
      error => error instanceof SaveTransferError && error.code === 'INVALID_VERSION',
    );
  });
}

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

test('接受 UTF-8 编码后正好 20 MB 的合法存档', () => {
  const raw = buildSaveTextAtByteLength(SAVE_MAX_BYTES);

  assert.equal(new TextEncoder().encode(raw).byteLength, SAVE_MAX_BYTES);
  assert.equal(parseSaveTransfer(raw).formatVersion, 0);
});

test('拒绝 UTF-8 编码后超过上限 1 字节的合法存档', () => {
  const raw = buildSaveTextAtByteLength(SAVE_MAX_BYTES + 1);

  assert.equal(new TextEncoder().encode(raw).byteLength, SAVE_MAX_BYTES + 1);
  assert.throws(
    () => parseSaveTransfer(raw),
    error => error instanceof SaveTransferError && error.code === 'SAVE_TOO_LARGE',
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

const invalidSummaryValues = [
  ['字符串保存时间', 'lastSaveTime', data => { data.stats.lastSaveTime = '100'; }],
  ['NaN 保存时间', 'lastSaveTime', data => { data.stats.lastSaveTime = NaN; }],
  ['无限保存时间', 'lastSaveTime', data => { data.stats.lastSaveTime = Infinity; }],
  ['字符串糖果数', 'candy', data => { data.items.candy = '321'; }],
  ['NaN 糖果数', 'candy', data => { data.items.candy = NaN; }],
  ['无限糖果数', 'candy', data => { data.items.candy = Infinity; }],
  ['数字角色', 'gender', data => { data.settings.gender = 1; }],
  ['布尔角色', 'gender', data => { data.settings.gender = false; }],
  ['对象角色', 'gender', data => { data.settings.gender = {}; }],
];

for (const [name, field, setInvalidValue] of invalidSummaryValues) {
  test(`摘要将${name}归一化为 null`, () => {
    const data = structuredClone(complete);
    setInvalidValue(data);

    assert.equal(summarizeSave(data)[field], null);
  });
}

test('使用本地时间生成带零填充的导出文件名', () => {
  const now = new Date(2026, 7, 18, 9, 5, 7).getTime();

  assert.equal(buildExportFileName(now), 'pokeidle-save-20260818-090507.json');
});

test('序列化导出副本并保持原存档不变', () => {
  const now = new Date(2026, 7, 18, 9, 5, 7).getTime();
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
    exportedAt: now,
  });
  assert.equal(serialized.stats.lastSaveTime, 100);
  assert.deepEqual(serialized.unknown, { nested: ['keep'] });
  assert.deepEqual(data, original);
});

test('未指定导出时间时仍写入毫秒时间戳', () => {
  const before = Date.now();
  const exported = serializeSaveForExport(complete, { appVersion: '1.0.8' });
  const after = Date.now();
  const exportedAt = JSON.parse(exported.json).__pokeidleMeta.exportedAt;

  assert.equal(typeof exportedAt, 'number');
  assert.ok(Number.isFinite(exportedAt));
  assert.ok(exportedAt >= before && exportedAt <= after);
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
