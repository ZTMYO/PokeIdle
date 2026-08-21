import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelSaveTransferDialog,
  createSaveTransferController,
  formatSaveTransferError,
  replaceSaveWithBackup,
  restoreBackupSave,
  showSaveTransferDialog,
} from '../src/save-transfer-controller.js';

const current = { items: { candy: 1 }, stats: { lastSaveTime: 10 } };
const incoming = { items: { candy: 9 }, stats: { lastSaveTime: 2 } };

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.hidden = true;
    this.children = [];
  }

  replaceChildren(...children) {
    this.children = children;
  }

  append(...children) {
    this.children.push(...children);
  }

  focus() {}
}

function createDialogDocument() {
  const elements = new Map([
    ['#saveTransferDialog', new FakeElement()],
    ['#saveTransferConfirm', new FakeElement()],
    ['#saveTransferCancel', new FakeElement()],
    ['#saveTransferSource', new FakeElement()],
    ['#saveTransferTitle', new FakeElement()],
    ['#saveTransferComparison', new FakeElement()],
  ]);
  const doc = new EventTarget();
  doc.querySelector = selector => elements.get(selector) || null;
  doc.createElement = () => new FakeElement();
  return { doc, elements };
}

for (const [name, selector, expected] of [
  ['取消', '#saveTransferCancel', false],
  ['覆盖', '#saveTransferConfirm', true],
]) {
  test(`Android pointerup 可以${name}存档确认弹窗`, async () => {
    const { doc, elements } = createDialogDocument();
    const result = showSaveTransferDialog(doc, { current, incoming });

    elements.get(selector).dispatchEvent(new Event('pointerup'));

    assert.equal(await Promise.race([
      result,
      new Promise(resolve => setTimeout(() => resolve('pending'), 20)),
    ]), expected);
    assert.equal(elements.get('#saveTransferDialog').hidden, true);
  });

  test(`Android touchend 可以${name}存档确认弹窗`, async () => {
    const { doc, elements } = createDialogDocument();
    const result = showSaveTransferDialog(doc, { current, incoming });

    elements.get(selector).dispatchEvent(new Event('touchend'));

    assert.equal(await Promise.race([
      result,
      new Promise(resolve => setTimeout(() => resolve('pending'), 20)),
    ]), expected);
    assert.equal(elements.get('#saveTransferDialog').hidden, true);
  });
}

test('Android 返回键可以取消打开的存档确认弹窗', async () => {
  const { doc, elements } = createDialogDocument();
  const result = showSaveTransferDialog(doc, { current, incoming });

  assert.equal(cancelSaveTransferDialog(doc), true);
  assert.equal(await result, false);
  assert.equal(elements.get('#saveTransferDialog').hidden, true);
  assert.equal(cancelSaveTransferDialog(doc), false);
});

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

test('用户取消文件选择时不备份也不显示错误', async () => {
  const events = [];
  const controller = createSaveTransferController({
    platform: { pickImportFile: async () => null },
    showMessage: message => events.push(message),
  });

  assert.equal(await controller.importSave(), null);
  assert.deepEqual(events, []);
});

test('用户拒绝确认时不覆盖当前存档', async () => {
  const events = [];
  const controller = createSaveTransferController({
    platform: { pickImportFile: async () => ({ name: 'save.json', content: JSON.stringify(incoming), size: 42 }) },
    getCurrent: () => current,
    confirm: async () => false,
    saveCurrent: async () => events.push('save-current'),
    createBackup: async () => events.push('backup'),
    apply: () => events.push('apply'),
    persist: async () => events.push('persist'),
    showMessage: message => events.push(message),
  });

  assert.equal(await controller.importSave(), null);
  assert.deepEqual(events, []);
});

test('恢复导入存档的写入失败映射为稳定提示', async () => {
  const messages = [];
  const controller = createSaveTransferController({
    platform: {
      loadImportBackup: async () => JSON.stringify(incoming),
    },
    getCurrent: () => current,
    confirm: async () => true,
    apply: () => {},
    persist: async () => { throw new Error('write failed'); },
    showMessage: message => messages.push(message),
  });

  assert.equal(await controller.restoreSave(), null);
  assert.deepEqual(messages, ['存档写入失败，已尝试恢复当前存档']);
});

test('存档错误映射为稳定的中文提示', () => {
  assert.equal(formatSaveTransferError({ code: 'FUTURE_VERSION' }), '此存档来自更新版本，请先升级应用');
  assert.equal(formatSaveTransferError({ code: 'SAVE_TOO_LARGE' }), '存档文件不能超过 20 MB');
  assert.equal(formatSaveTransferError({ code: 'IMPORT_BACKUP_FAILED' }), '导入前备份失败，当前存档未改变');
  assert.equal(formatSaveTransferError({ code: 'SAVE_WRITE_FAILED' }), '存档写入失败，已尝试恢复当前存档');
});
