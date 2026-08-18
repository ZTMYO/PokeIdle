import test from 'node:test';
import assert from 'node:assert/strict';

import { SAVE_MAX_BYTES, SaveTransferError } from '../src/save-transfer.js';
import { createSavePlatform, pickBrowserImportFile } from '../src/save-platform.js';

test('Android 导出和备份优先调用移动 bridge', async () => {
  const calls = [];
  const mobile = {
    exportSaveData: async (...args) => calls.push(['export', ...args]),
    createImportBackup: async data => calls.push(['backup', data]),
    loadImportBackup: async () => '{"mobile":true}',
    getAppVersion: async () => '1.0.9',
  };
  const platform = createSavePlatform({
    win: { __POKEIDLE_MOBILE__: mobile, __TAURI__: { core: { invoke: async () => calls.push(['tauri']) } } },
    doc: {},
    storage: {},
  });

  await platform.exportSaveData('{}', 'pokeidle-save.json');
  await platform.createImportBackup('{"backup":true}');

  assert.deepEqual(calls, [
    ['export', '{}', 'pokeidle-save.json'],
    ['backup', '{"backup":true}'],
  ]);
  assert.equal(await platform.loadImportBackup(), '{"mobile":true}');
  assert.equal(await platform.getAppVersion(), '1.0.9');
});

test('Tauri 取消导入和导出时返回 null', async () => {
  const commands = [];
  const platform = createSavePlatform({
    win: {
      __TAURI__: {
        core: { invoke: async (command, args) => { commands.push([command, args]); return null; } },
        app: { getVersion: async () => '1.0.9' },
      },
    },
    doc: {},
    storage: {},
  });

  assert.equal(await platform.pickImportFile(), null);
  assert.equal(await platform.exportSaveData('{}', 'save.json'), null);
  assert.equal(await platform.getAppVersion(), '1.0.9');
  assert.deepEqual(commands, [
    ['import_save_data', undefined],
    ['export_save_data', { data: '{}', fileName: 'save.json' }],
  ]);
});

test('浏览器导入前备份使用独立 localStorage key', async () => {
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: key => values.get(key) ?? null,
  };
  const platform = createSavePlatform({ win: {}, doc: {}, storage });

  await platform.createImportBackup('{"items":{},"stats":{}}');

  assert.equal(values.has('pokemon_idle_save'), false);
  assert.equal(values.get('pokemon_idle_import_backup'), '{"items":{},"stats":{}}');
  assert.equal(await platform.loadImportBackup(), '{"items":{},"stats":{}}');
  assert.equal(await platform.getAppVersion(), 'web');
});

function createFileInputDocument(file) {
  const listeners = new Map();
  const input = {
    files: file ? [file] : [],
    addEventListener: (type, listener) => listeners.set(type, listener),
    remove: () => { input.removed = true; },
    click: () => queueMicrotask(() => listeners.get('change')?.()),
  };
  return {
    input,
    doc: {
      createElement: tag => {
        assert.equal(tag, 'input');
        return input;
      },
      body: { appendChild: element => assert.equal(element, input) },
    },
  };
}

test('浏览器在读取文本前拒绝超过 20 MB 的文件', async () => {
  let textRead = false;
  const file = {
    name: 'too-large.json',
    size: SAVE_MAX_BYTES + 1,
    text: async () => { textRead = true; return '{}'; },
  };
  const { doc, input } = createFileInputDocument(file);

  await assert.rejects(
    () => pickBrowserImportFile(doc),
    error => error instanceof SaveTransferError && error.code === 'SAVE_TOO_LARGE',
  );
  assert.equal(textRead, false);
  assert.equal(input.type, 'file');
  assert.equal(input.accept, 'application/json,.json');
  assert.equal(input.removed, true);
});

test('浏览器返回文件名、正文和字节数', async () => {
  const file = { name: 'save.json', size: 12, text: async () => '{"ok":true}' };
  const { doc } = createFileInputDocument(file);

  assert.deepEqual(await pickBrowserImportFile(doc), {
    name: 'save.json',
    content: '{"ok":true}',
    size: 12,
  });
});
