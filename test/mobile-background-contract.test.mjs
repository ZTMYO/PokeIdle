import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createBackgroundMode,
  isBackgroundModeSupported,
} from '../mobile/background-mode.mjs';

test('浏览器环境的后台模式安全降级且不抛异常', async () => {
  const mode = createBackgroundMode({ capacitor: null });

  assert.equal(isBackgroundModeSupported({ capacitor: null }), false);
  assert.equal(await mode.startBackgroundMode(), false);
  assert.equal(await mode.stopBackgroundMode(), false);
  assert.equal(await mode.isBackgroundModeSupported(), false);
  assert.equal(typeof await mode.onBackgroundTick(() => {}), 'function');
});

test('后台模式封装调用原生插件并转发心跳时间戳', async () => {
  const calls = [];
  const listeners = new Map();
  const plugin = {
    async start() { calls.push('start'); return { started: true }; },
    async stop() { calls.push('stop'); return { stopped: true }; },
    async isSupported() { calls.push('supported'); return { supported: true }; },
    addListener(name, callback) { listeners.set(name, callback); return { remove: async () => listeners.delete(name) }; },
  };
  const mode = createBackgroundMode({ capacitor: { Plugins: { PokeIdleBackground: plugin } } });
  const ticks = [];

  assert.equal(isBackgroundModeSupported({ capacitor: { Plugins: { PokeIdleBackground: plugin } } }), true);
  assert.deepEqual(await mode.startBackgroundMode(), { started: true });
  assert.deepEqual(await mode.stopBackgroundMode(), { stopped: true });
  assert.deepEqual(await mode.isBackgroundModeSupported(), { supported: true });
  await mode.onBackgroundTick(event => ticks.push(event));
  listeners.get('backgroundTick')({ now: 1234 });

  assert.deepEqual(calls, ['start', 'stop', 'supported']);
  assert.deepEqual(ticks, [{ now: 1234 }]);
});

test('移动端 bridge 暴露后台模式并绑定前后台生命周期', async () => {
  const bridge = await readFile(new URL('../mobile/bridge-source.js', import.meta.url), 'utf8');

  assert.match(bridge, /background-mode\.mjs/);
  assert.match(bridge, /startBackgroundMode/);
  assert.match(bridge, /stopBackgroundMode/);
  assert.match(bridge, /isBackgroundModeSupported/);
  assert.match(bridge, /onBackgroundTick/);
  assert.match(bridge, /__POKEIDLE_BACKGROUND_ENTER__/);
  assert.match(bridge, /__POKEIDLE_BACKGROUND_TICK__/);
  assert.match(bridge, /__POKEIDLE_BACKGROUND_RESUME__/);
});

test('Android 前台服务和插件声明启动、停止、心跳与通知权限契约', async () => {
  const plugin = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/PokeIdleBackgroundPlugin.java', import.meta.url), 'utf8');
  const service = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/PokeIdleBackgroundService.java', import.meta.url), 'utf8');
  const activity = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/MainActivity.java', import.meta.url), 'utf8');
  const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

  assert.match(plugin, /@CapacitorPlugin\(name\s*=\s*"PokeIdleBackground"/);
  assert.match(plugin, /@PluginMethod[\s\S]*start\(/);
  assert.match(plugin, /@PluginMethod[\s\S]*stop\(/);
  assert.match(plugin, /@PluginMethod[\s\S]*isSupported\(/);
  assert.match(plugin, /PokeIdleBackgroundService/);
  assert.match(plugin, /notifyListeners\(["']backgroundTick["']/);
  assert.match(service, /startForeground\(/);
  assert.match(service, /START_NOT_STICKY/);
  assert.match(service, /ACTION_STOP/);
  assert.match(activity, /registerPlugin\(PokeIdleBackgroundPlugin\.class\)/);
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE/);
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(manifest, /PokeIdleBackgroundService/);
  assert.match(manifest, /foregroundServiceType="dataSync"/);
});
