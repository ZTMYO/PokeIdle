import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyWebSource, injectBridgeScript } from '../mobile/build-web.mjs';

test('在 head 末尾注入一次移动端 bridge', () => {
  const source = '<!doctype html><html><head><title>Game</title></head><body></body></html>';
  const once = injectBridgeScript(source);
  const twice = injectBridgeScript(once);

  assert.match(once, /<script src="\.\/mobile-bridge\.js"><\/script>\s*<\/head>/);
  assert.equal(twice.match(/mobile-bridge\.js/g)?.length, 1);
});

test('递归复制 Web 源码且不修改源文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pokeidle-mobile-web-'));
  const sourceDir = join(root, 'source');
  const outputDir = join(root, 'output');
  await mkdir(join(sourceDir, 'audio'), { recursive: true });
  await writeFile(join(sourceDir, 'index.html'), '<html>source</html>');
  await writeFile(join(sourceDir, 'audio', 'battle.mp3'), 'audio');

  await copyWebSource(sourceDir, outputDir);

  assert.equal(await readFile(join(outputDir, 'audio', 'battle.mp3'), 'utf8'), 'audio');
  assert.equal(await readFile(join(sourceDir, 'index.html'), 'utf8'), '<html>source</html>');
});

test('移动端 bridge 同步动态掌机布局高度', async () => {
  const bridge = await readFile(new URL('../mobile/bridge-source.js', import.meta.url), 'utf8');

  assert.match(bridge, /import\s*\{\s*calculateMobileLayout\s*\}\s*from ['"]\.\/viewport-utils\.mjs['"]/);
  assert.match(bridge, /calculateMobileLayout\(width, height, insets\)/);
  assert.match(bridge, /setProperty\(['"]--mobile-scale['"],\s*String\(scale\)\)/);
  assert.match(bridge, /setProperty\(['"]--mobile-layout-height['"],\s*`\$\{designHeight\}px`\)/);
});

test('移动端外壳使用动态高度并保留页面滚动边界', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(css, /html\.mobile-mode \.console\s*\{[\s\S]*?height:\s*var\(--mobile-layout-height,\s*342px\)/);
  assert.match(css, /html\.mobile-mode \.screen-wrapper\s*\{[\s\S]*?min-height:\s*0/);
  assert.match(css, /html\.mobile-mode \.view-scroll,[\s\S]*?html\.mobile-mode \.view-fixed,[\s\S]*?html\.mobile-mode \.rec-view\s*\{[\s\S]*?min-height:\s*0/);
  assert.match(css, /html\.mobile-mode \.backpack-bar,[\s\S]*?html\.mobile-mode \.stats-bar\s*\{[\s\S]*?flex-shrink:\s*0/);
  assert.match(css, /html\.mobile-mode \.save-transfer-actions button\s*\{[\s\S]*?min-height:\s*44px/);
});
