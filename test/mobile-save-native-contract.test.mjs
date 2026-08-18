import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createMobileSaveTransfer } from '../mobile/save-native.mjs';

function createNativeHarness(overrides = {}) {
  const events = [];
  const Filesystem = {
    writeFile: async options => { events.push(['write', options]); },
    getUri: async options => { events.push(['uri', options]); return { uri: 'file:///data/user/0/com.pokemon.idle/cache/save.json' }; },
    deleteFile: async options => { events.push(['delete', options]); },
    readFile: async options => { events.push(['read', options]); return { data: '{"ok":true}' }; },
    ...overrides.Filesystem,
  };
  const Share = {
    share: async options => { events.push(['share', options]); return { activityType: 'files' }; },
    ...overrides.Share,
  };
  const App = { getInfo: async () => ({ version: '1.0.9' }), ...overrides.App };
  const logger = { warn: (...args) => events.push(['warn', ...args]) };
  const transfer = createMobileSaveTransfer({
    Filesystem,
    Share,
    App,
    Directory: { Cache: 'CACHE', Data: 'DATA' },
    Encoding: { UTF8: 'UTF8' },
    logger,
  });
  return { events, transfer };
}

test('Android bridge 使用 Share、缓存临时文件和独立导入备份', async () => {
  const bridgeSource = await readFile(new URL('../mobile/bridge-source.js', import.meta.url), 'utf8');
  const nativeSource = await readFile(new URL('../mobile/save-native.mjs', import.meta.url), 'utf8');
  const source = `${bridgeSource}\n${nativeSource}`;
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const settingsGradle = await readFile(new URL('../android/capacitor.settings.gradle', import.meta.url), 'utf8');
  const capacitorGradle = await readFile(new URL('../android/app/capacitor.build.gradle', import.meta.url), 'utf8');

  assert.equal(typeof packageJson.dependencies['@capacitor/share'], 'string');
  assert.match(source, /from '@capacitor\/share'/);
  assert.match(source, /Directory\.Cache/);
  assert.match(source, /Filesystem\.getUri/);
  assert.match(source, /Filesystem\.deleteFile/);
  assert.match(source, /Share\.share/);
  assert.match(source, /save\.import-backup\.json/);
  assert.match(source, /createImportBackup/);
  assert.match(source, /loadImportBackup/);
  assert.match(source, /getAppVersion/);
  assert.match(source, /App\.getInfo/);
  assert.match(source, /OS-PLUG-FILE-0008/);
  assert.doesNotMatch(source, /Directory\.(Documents|ExternalStorage)/);
  assert.match(settingsGradle, /capacitor-share/);
  assert.match(capacitorGradle, /capacitor-share/);
});

test('Android manifest 不申请公共存储权限', async () => {
  const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

  assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/);
});

test('Android 分享成功后清理缓存文件', async () => {
  const { events, transfer } = createNativeHarness();

  assert.deepEqual(await transfer.exportSaveData('{}', 'save.json'), { activityType: 'files' });
  assert.deepEqual(events.map(event => event[0]), ['write', 'uri', 'share', 'delete']);
  assert.equal(events[0][1].directory, 'CACHE');
  assert.equal(events[2][1].url, 'file:///data/user/0/com.pokemon.idle/cache/save.json');
  assert.equal(events[3][1].directory, 'CACHE');
});

for (const label of ['失败', '取消']) {
  test(`Android 分享${label}时仍清理缓存文件并保留原错误`, async () => {
    const shareError = new Error(`share ${label}`);
    const { events, transfer } = createNativeHarness({
      Share: { share: async options => { events.push(['share', options]); throw shareError; } },
    });

    await assert.rejects(() => transfer.exportSaveData('{}', 'save.json'), error => error === shareError);
    assert.deepEqual(events.map(event => event[0]), ['write', 'uri', 'share', 'delete']);
  });
}

test('Android 清理失败不会覆盖分享结果', async () => {
  const cleanupError = new Error('cleanup failed');
  const { events, transfer } = createNativeHarness({
    Filesystem: { deleteFile: async options => { events.push(['delete', options]); throw cleanupError; } },
  });

  assert.deepEqual(await transfer.exportSaveData('{}', 'save.json'), { activityType: 'files' });
  assert.deepEqual(events.map(event => event[0]), ['write', 'uri', 'share', 'delete', 'warn']);
});

test('Android 导入前备份固定写入私有 Data 目录', async () => {
  const { events, transfer } = createNativeHarness();

  await transfer.createImportBackup('{}');

  assert.deepEqual(events, [['write', {
    path: 'save.import-backup.json',
    data: '{}',
    directory: 'DATA',
    encoding: 'UTF8',
  }]]);
});

test('Android 应用版本来自 Capacitor App 信息', async () => {
  const { transfer } = createNativeHarness();

  assert.equal(await transfer.getAppVersion(), '1.0.9');
});

test('Android 仅将明确的备份不存在错误映射为 null', async () => {
  for (const missingError of [
    Object.assign(new Error('missing'), { code: 'OS-PLUG-FILE-0008' }),
    new Error("'readFile' failed because file at 'save.import-backup.json' does not exist."),
    new Error('File does not exist.'),
  ]) {
    const { transfer } = createNativeHarness({ Filesystem: { readFile: async () => { throw missingError; } } });
    assert.equal(await transfer.loadImportBackup(), null);
  }

  for (const realError of [new Error('permission denied'), new Error('disk I/O failed')]) {
    const { transfer } = createNativeHarness({ Filesystem: { readFile: async () => { throw realError; } } });
    await assert.rejects(() => transfer.loadImportBackup(), error => error === realError);
  }
});

test('Android 备份读取到非文本数据时明确失败', async () => {
  const { transfer } = createNativeHarness({ Filesystem: { readFile: async () => ({ data: new Blob(['bad']) }) } });

  await assert.rejects(() => transfer.loadImportBackup(), /非文本数据/);
});
