import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('交换入库沿用预览时确定的性别', async () => {
  const source = await readFile(new URL('../src/trade.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /addRosterEntry\(\{[\s\S]{0,240}?species:\s*o\.give\.species,[\s\S]{0,240}?gender:\s*ensureGender\(o\.give\)/,
  );
});
