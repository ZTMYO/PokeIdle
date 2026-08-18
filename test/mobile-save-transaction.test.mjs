import test from 'node:test';
import assert from 'node:assert/strict';

import { replaceSaveWithBackup, restoreBackupSave } from '../src/save-transfer-controller.js';

const current = { items: { candy: 1 }, stats: { lastSaveTime: 10 } };
const incoming = { items: { candy: 9 }, stats: { lastSaveTime: 2 } };

test('确认导入严格按保存当前、备份、应用、持久化执行', async () => {
  const events = [];
  let active = structuredClone(current);

  await replaceSaveWithBackup({
    getCurrent: () => active,
    incoming,
    saveCurrent: async () => events.push('save-current'),
    createBackup: async raw => events.push(`backup:${JSON.parse(raw).items.candy}`),
    apply: value => { active = value; events.push(`apply:${value.items.candy}`); },
    persist: async () => events.push('persist'),
    now: 20,
  });

  assert.deepEqual(events, ['save-current', 'backup:1', 'apply:9', 'persist']);
  assert.equal(active.stats.lastSaveTime, 21);
});

test('备份失败时不应用导入存档', async () => {
  let applied = false;

  await assert.rejects(() => replaceSaveWithBackup({
    getCurrent: () => current,
    incoming,
    saveCurrent: async () => {},
    createBackup: async () => { throw new Error('backup failed'); },
    apply: () => { applied = true; },
    persist: async () => {},
  }));
  assert.equal(applied, false);
});

test('主存档写入失败时恢复内存和持久化的原存档', async () => {
  const applied = [];
  let writes = 0;

  await assert.rejects(() => replaceSaveWithBackup({
    getCurrent: () => current,
    incoming,
    saveCurrent: async () => {},
    createBackup: async () => {},
    apply: value => applied.push(value.items.candy),
    persist: async () => { if (++writes === 1) throw new Error('write failed'); },
  }));
  assert.deepEqual(applied, [9, 1]);
  assert.equal(writes, 2);
});

test('恢复备份不会创建新的导入前备份', async () => {
  let backupCalls = 0;

  await restoreBackupSave({
    getCurrent: () => current,
    backupData: incoming,
    apply: () => {},
    persist: async () => {},
    createBackup: () => { backupCalls++; },
  });
  assert.equal(backupCalls, 0);
});
