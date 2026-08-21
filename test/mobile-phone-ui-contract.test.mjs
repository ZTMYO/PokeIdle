import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('手机主页使用 5 列 4 行并保留 18 个应用', () => {
  const js = fs.readFileSync('src/phone.js', 'utf8');
  const css = fs.readFileSync('src/styles.css', 'utf8');
  assert.equal((js.match(/\{ id: '/g) || []).length, 18);
  assert.match(css, /\.phone-page\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,/);
  assert.match(css, /\.phone-page\s*\{[\s\S]*?grid-template-rows:\s*repeat\(4,/);
  assert.match(css, /\.phone-page\s*\{[\s\S]*?gap:\s*(?!0)/);
});

test('背包横滑翻页不会捕获短按指针或误触道具', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  assert.match(source, /backpackEl\.addEventListener\(['"]pointerdown['"]/);
  assert.match(source, /backpackEl\.addEventListener\(['"]pointerup['"]/);
  assert.match(source, /Math\.abs\(dx\)\s*<=\s*Math\.abs\(dy\)/);
  assert.match(source, /Math\.abs\(dx\).*?backpackEl\.clientWidth/);
  assert.doesNotMatch(source, /backpackEl\.setPointerCapture/);
  assert.match(source, /let suppressNextBagClick = false/);
  assert.match(source, /backpackEl\.addEventListener\(['"]click['"],[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?true\s*\)/);
});
