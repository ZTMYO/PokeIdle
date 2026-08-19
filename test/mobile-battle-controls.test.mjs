import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesSource = () => readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const battleSource = () => readFile(new URL('../src/battle-view.js', import.meta.url), 'utf8');

test('手机战斗底栏覆盖桌面高度并容纳两行触控按钮', async () => {
  const styles = await stylesSource();
  const desktop = styles.match(/\.b-bottom\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';
  const mobile = styles.match(/html\.mobile-mode \.b-bottom\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';

  assert.match(desktop, /height:\s*56px/);
  assert.match(styles, /html\.mobile-mode button,[\s\S]*?\{\s*min-height:\s*34px/);
  assert.match(mobile, /height:\s*92px/);

  const mobileHeight = Number(mobile.match(/height:\s*(\d+)px/)?.[1]);
  const requiredHeight = 2 + 6 + (34 * 2) + 1 + 2 + 10;
  assert.ok(mobileHeight >= requiredHeight);
});

test('操作态和选招态继续使用两行布局', async () => {
  const [styles, battle] = await Promise.all([stylesSource(), battleSource()]);

  assert.match(styles, /\.b-cmd\s*\{[^}]*grid-template-rows:\s*1fr 1fr/s);
  assert.match(styles, /\.b-actions\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(battle, /id="act-fight">攻击<\/button>/);
  assert.match(battle, /id="act-pkm">替换<\/button>/);
  assert.match(battle, /id="act-auto">自动<\/button>/);
  assert.match(battle, /actions\.className = 'b-actions detail'/);
  assert.match(battle, /class="b-move[^"$]*\$\{dis\}"/);
});
