import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const phoneSource = () => readFile(new URL('../src/phone.js', import.meta.url), 'utf8');
const stylesSource = () => readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('手机主页直接渲染 18 个应用且不包含分页运行时', async () => {
  const source = await phoneSource();
  const appsBlock = source.match(/const APPS = \[(?<apps>[\s\S]*?)\n\];/)?.groups?.apps || '';
  assert.equal((appsBlock.match(/\bid:\s*'/g) || []).length, 18);
  assert.doesNotMatch(source, /PAGE_SIZE|phone-dots|addEventListener\(['"]wheel['"]|\.map\(page/);
  assert.match(source, /<div class="phone-pages" id="phonePages">[\s\S]*?<div class="phone-page">\s*\$\{APPS\.map/);
});

test('手机主页使用不可横向滚动的 5 列 4 行网格', async () => {
  const styles = await stylesSource();
  const pagesBlock = styles.match(/\.phone-pages\s*\{(?<pages>[\s\S]*?)\n\}/)?.groups?.pages || '';
  const pageBlock = styles.match(/\.phone-page\s*\{(?<page>[\s\S]*?)\n\}/)?.groups?.page || '';
  const appBlock = styles.match(/\.phone-app\s*\{(?<app>[\s\S]*?)\n\}/)?.groups?.app || '';
  assert.match(pagesBlock, /overflow-x:\s*hidden/);
  assert.match(pageBlock, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(pageBlock, /grid-template-rows:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(appBlock, /width:\s*100%/);
  assert.match(appBlock, /height:\s*100%/);
  assert.match(appBlock, /justify-content:\s*center/);
});
