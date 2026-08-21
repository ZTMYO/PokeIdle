import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { persistSerializedSave } from '../src/save-persistence.js';

test('按桌面、本地和移动端顺序写入所有可用来源', async () => {
  const calls = [];
  const result = await persistSerializedSave('{"save":1}', {
    tauriInvoke: async (command, args) => calls.push([command, args]),
    storage: { setItem: (...args) => calls.push(['localStorage', args]) },
    mobile: { saveGameData: async data => calls.push(['mobile', data]) },
  });

  assert.deepEqual(calls, [
    ['save_game_data', { data: '{"save":1}' }],
    ['localStorage', ['pokemon_idle_save', '{"save":1}']],
    ['mobile', '{"save":1}'],
  ]);
  assert.deepEqual(result, { errors: [], written: 3 });
});

test('普通保存记录单来源错误并继续写入其他来源', async () => {
  const calls = [];
  const result = await persistSerializedSave('{}', {
    tauriInvoke: async () => { throw new Error('desktop failed'); },
    storage: { setItem: () => calls.push('localStorage') },
    mobile: { saveGameData: async () => calls.push('mobile') },
  });

  assert.deepEqual(calls, ['localStorage', 'mobile']);
  assert.equal(result.written, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].source, 'tauri');
  assert.match(result.errors[0].message, /desktop failed/);
});

test('Android 主存档成功时备用来源失败不回滚导入', async () => {
  const writes = [];
  const result = await persistSerializedSave('{"items":{"candy":9}}', {
    mobile: { saveGameData: async data => writes.push(['mobile', data]) },
    storage: { setItem: () => { throw new Error('storage blocked'); } },
    strict: true,
    requiredSource: 'mobile',
  });
  assert.equal(result.written, 1);
  assert.deepEqual(writes.map(([source]) => source), ['mobile']);
  assert.equal(result.warnings.length, 1);
});

test('严格保存尝试全部来源后抛出包含来源的 AggregateError', async () => {
  const calls = [];
  await assert.rejects(
    () => persistSerializedSave('{}', {
      tauriInvoke: async () => { calls.push('tauri'); throw new Error('desktop failed'); },
      storage: { setItem: () => { calls.push('localStorage'); throw new Error('quota'); } },
      mobile: { saveGameData: async () => calls.push('mobile') },
      strict: true,
    }),
    error => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /tauri, localStorage/);
      assert.deepEqual(error.errors.map(item => item.source), ['tauri', 'localStorage']);
      return true;
    },
  );
  assert.deepEqual(calls, ['tauri', 'localStorage', 'mobile']);
});

test('state.saveGame 接入严格模式、保留时间戳和必需来源选项', async () => {
  const source = await readFile(new URL('../src/state.js', import.meta.url), 'utf8');

  assert.match(source, /saveGame\(\{\s*strict\s*=\s*false,\s*preserveTimestamp\s*=\s*false,\s*requiredSource\s*=\s*null,?\s*\}\s*=\s*\{\}\)/);
  assert.match(source, /persistSerializedSave/);
  assert.match(source, /if\s*\(!preserveTimestamp\)\s*gameData\.stats\.lastSaveTime\s*=\s*Date\.now\(\)/);
  assert.match(source, /requiredSource,?/);
});
