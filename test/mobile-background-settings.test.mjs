import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('设置页提供后台挂机开关、运行状态和平台提示', async () => {
  const views = await readFile(new URL('../src/views.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(views, /id="toggleBackgroundMode"/);
  assert.match(views, /后台挂机/);
  assert.match(views, /常驻通知/);
  assert.match(views, /耗电/);
  assert.match(views, /当前平台不支持/);
  assert.match(views, /toggleBackgroundMode/);
  assert.match(css, /background-mode-status/);
});

test('后台开关在原生启动成功后保存，关闭时停止服务', async () => {
  const views = await readFile(new URL('../src/views.js', import.meta.url), 'utf8');

  assert.match(views, /startBackgroundMode\(\)/);
  assert.match(views, /stopBackgroundMode\(\)/);
  assert.match(views, /background\.enabled\s*=\s*true/);
  assert.match(views, /background\.enabled\s*=\s*false/);
  assert.match(views, /await saveGame/);
});

test('通知停止操作回传 JavaScript 并关闭存档开关', async () => {
  const service = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/PokeIdleBackgroundService.java', import.meta.url), 'utf8');
  const plugin = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/PokeIdleBackgroundPlugin.java', import.meta.url), 'utf8');
  const mode = await readFile(new URL('../mobile/background-mode.mjs', import.meta.url), 'utf8');
  const bridge = await readFile(new URL('../mobile/bridge-source.js', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

  assert.match(service, /emitBackgroundStopped/);
  assert.match(plugin, /notifyListeners\(["']backgroundStopped["']/);
  assert.match(mode, /onBackgroundStopped/);
  assert.match(bridge, /__POKEIDLE_BACKGROUND_STOPPED__/);
  assert.match(main, /__POKEIDLE_BACKGROUND_STOPPED__/);
});
