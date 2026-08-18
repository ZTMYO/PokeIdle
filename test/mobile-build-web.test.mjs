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
