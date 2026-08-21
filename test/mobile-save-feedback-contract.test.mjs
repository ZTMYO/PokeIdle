import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('设置页提供存档操作提示区域', () => {
  const source = fs.readFileSync('src/views.js', 'utf8');
  assert.match(source, /saveTransferStatus/);
  assert.match(source, /aria-live=["']polite["']/);
  assert.match(source, /saveCurrent:\s*\(\)\s*=>\s*saveGame\(\{/);
  assert.match(source, /requiredSource:\s*requiredSaveSource/);
  assert.match(source, /typeof\s+mobileReload\s*===\s*['"]function['"]/);
  assert.doesNotMatch(source, /showMessage:\s*updateTextBox/);
});

test('移动端提供安全刷新入口', () => {
  const source = fs.readFileSync('mobile/bridge-source.js', 'utf8');
  assert.match(source, /__POKEIDLE_MOBILE_RELOAD__/);
});
