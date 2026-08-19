import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('捕捉动画保存并恢复遭遇视图与动画舞台的内联布局', async () => {
  const source = await readFile(new URL('../src/animation.js', import.meta.url), 'utf8');

  assert.match(source, /captureCatchLayout/);
  assert.match(source, /restoreCatchLayout/);
  for (const property of ['position', 'left', 'top', 'width', 'height']) {
    assert.match(source, new RegExp(`\\b${property}\\b`));
  }
  assert.match(source, /finally\s*\{[\s\S]*restoreCatchAnim\(\)/);
});

test('舞台尺寸使用未经过 CSS transform 缩放的布局尺寸并支持显式失效', async () => {
  const source = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
  const bridge = await readFile(new URL('../mobile/bridge-source.js', import.meta.url), 'utf8');

  assert.match(source, /export function invalidateStageSize\(/);
  assert.match(source, /clientWidth/);
  assert.match(source, /clientHeight/);
  assert.match(source, /Math\.abs\(_stageCache\.w - w\) <= 1/);
  assert.match(source, /Math\.abs\(_stageCache\.h - h\) <= 1/);
  assert.doesNotMatch(source, /innerRect\?\.width/);
  assert.doesNotMatch(source, /innerRect\?\.height/);
  assert.match(source, /__POKEIDLE_INVALIDATE_STAGE_SIZE__/);
  assert.match(bridge, /__POKEIDLE_INVALIDATE_STAGE_SIZE__/);
});
