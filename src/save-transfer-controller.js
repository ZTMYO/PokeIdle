import {
  parseSaveTransfer,
  prepareImportedSave,
  serializeSaveForExport,
  summarizeSave,
} from './save-transfer.js';
import { createSavePlatform } from './save-platform.js';

const clone = value => JSON.parse(JSON.stringify(value));

async function applyAndPersist({ original, replacement, apply, persist }) {
  apply(replacement);
  try {
    await persist();
  } catch (error) {
    apply(original);
    try {
      await persist();
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
  return replacement;
}

export async function replaceSaveWithBackup({
  getCurrent,
  incoming,
  saveCurrent,
  createBackup,
  apply,
  persist,
  now = Date.now(),
}) {
  await saveCurrent();
  const original = clone(getCurrent());
  await createBackup(JSON.stringify(original));
  const replacement = prepareImportedSave(incoming, { currentSave: original, now });
  return applyAndPersist({ original, replacement, apply, persist });
}

export async function restoreBackupSave({ getCurrent, backupData, apply, persist }) {
  const original = clone(getCurrent());
  const replacement = clone(backupData);
  return applyAndPersist({ original, replacement, apply, persist });
}

export function formatSaveTransferError(error) {
  const code = error?.code || String(error?.message || error);
  if (code.includes('FUTURE_VERSION')) return '此存档来自更新版本，请先升级应用';
  if (code.includes('TOO_LARGE') || code.includes('SAVE_TOO_LARGE')) return '存档文件不能超过 20 MB';
  if (code.includes('INVALID_JSON')) return '文件不是有效的 JSON 存档';
  if (code.includes('MISSING_FIELDS')) return '存档缺少必要字段';
  if (code.includes('INVALID_VERSION')) return '存档格式版本无效';
  if (code.includes('backup') || code.includes('IMPORT_BACKUP_FAILED')) return '导入前备份失败，当前存档未改变';
  if (code.includes('SAVE_WRITE_FAILED')) return '存档写入失败，已尝试恢复当前存档';
  if (code.includes('AggregateError') || error instanceof AggregateError) return '存档写入失败，已尝试恢复当前存档';
  return '存档操作失败，请稍后重试';
}

const SUMMARY_FIELDS = [
  ['lastSaveTime', '保存时间'],
  ['gender', '角色'],
  ['candy', '糖果'],
  ['teamCount', '队伍'],
  ['rosterCount', '仓库'],
  ['pokedexCount', '图鉴'],
];

const activeDialogCancels = new WeakMap();

export function cancelSaveTransferDialog(doc) {
  const dialog = doc?.querySelector?.('#saveTransferDialog');
  if (!dialog || dialog.hidden) return false;
  const cancel = activeDialogCancels.get(dialog);
  if (cancel) cancel();
  else {
    dialog.hidden = true;
    dialog.style.display = 'none';
  }
  return true;
}

function formatSummaryValue(key, value) {
  if (value == null) return '未知';
  if (key === 'gender') return { brendan: '小悠', may: '小遥' }[value] || '未知';
  if (key === 'lastSaveTime') return new Date(value).toLocaleString();
  return String(value);
}

export function showSaveTransferDialog(doc, details) {
  const dialog = doc?.querySelector?.('#saveTransferDialog');
  const confirmButton = doc?.querySelector?.('#saveTransferConfirm');
  const cancelButton = doc?.querySelector?.('#saveTransferCancel');
  const source = doc?.querySelector?.('#saveTransferSource');
  const title = doc?.querySelector?.('#saveTransferTitle');
  const comparison = doc?.querySelector?.('#saveTransferComparison');
  if (!dialog || !confirmButton || !cancelButton || !source || !title || !comparison) return Promise.resolve(false);

  title.textContent = details.restore ? '恢复导入前存档' : '确认覆盖存档';
  source.textContent = details.restore ? '导入前自动备份' : `文件：${details.source || '未命名存档'}`;
  comparison.replaceChildren();
  const currentSummary = details.current ? summarizeSave(details.current) : {};
  const incomingSummary = details.incoming ? summarizeSave(details.incoming) : {};
  for (const [key, label] of SUMMARY_FIELDS) {
    const row = doc.createElement('div');
    row.className = 'save-transfer-summary-row';
    const name = doc.createElement('span');
    name.className = 'save-transfer-summary-label';
    name.textContent = label;
    const values = doc.createElement('span');
    values.className = 'save-transfer-summary-values';
    const oldValue = doc.createElement('span');
    oldValue.textContent = formatSummaryValue(key, currentSummary[key]);
    const arrow = doc.createElement('span');
    arrow.textContent = '→';
    const newValue = doc.createElement('span');
    newValue.textContent = formatSummaryValue(key, incomingSummary[key]);
    values.append(oldValue, arrow, newValue);
    row.append(name, values);
    comparison.append(row);
  }

  dialog.hidden = false;
  dialog.style.display = 'flex';
  return new Promise(resolve => {
    let settled = false;
    const activationEvents = ['pointerup', 'touchend', 'click'];
    const removeActivationListeners = (button, handler) => {
      activationEvents.forEach(type => button.removeEventListener(type, handler));
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      dialog.hidden = true;
      dialog.style.display = 'none';
      activeDialogCancels.delete(dialog);
      removeActivationListeners(confirmButton, onConfirm);
      removeActivationListeners(cancelButton, onCancel);
      doc.removeEventListener('keydown', onKeyDown);
      resolve(result);
    };
    const onConfirm = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = event => {
      if (event.key === 'Escape') finish(false);
    };
    activationEvents.forEach(type => confirmButton.addEventListener(type, onConfirm));
    activationEvents.forEach(type => cancelButton.addEventListener(type, onCancel));
    doc.addEventListener('keydown', onKeyDown);
    activeDialogCancels.set(dialog, onCancel);
    confirmButton.focus?.();
  });
}

export function createSaveTransferController({
  platform = createSavePlatform(),
  getCurrent = () => null,
  saveGame = async () => {},
  saveCurrent,
  createBackup,
  apply = () => {},
  persist,
  confirm = async () => true,
  showMessage = () => {},
  addLog = () => {},
  reload = () => {},
  now = () => Date.now(),
} = {}) {
  const saveBeforeImport = saveCurrent || (() => saveGame({ strict: true }));
  const persistReplacement = persist || (() => saveGame({ strict: true, preserveTimestamp: true }));
  const backupCurrent = createBackup || (raw => platform.createImportBackup(raw));

  async function exportSave() {
    try {
      await saveGame();
      const current = getCurrent();
      const appVersion = await platform.getAppVersion();
      const output = serializeSaveForExport(current, { appVersion, now: now() });
      const result = await platform.exportSaveData(output.json, output.fileName);
      if (result == null) return null;
      addLog('export', { fileName: output.fileName, result });
      showMessage('存档已导出');
      return output;
    } catch (error) {
      showMessage(formatSaveTransferError(error));
      return null;
    }
  }

  async function importSave() {
    let file;
    let persistenceWarnings = [];
    try {
      file = await platform.pickImportFile();
      if (!file) return null;
      const parsed = parseSaveTransfer(file.content);
      const current = getCurrent();
      if (!await confirm({ source: file.name, current, incoming: parsed.data, summary: parsed.summary })) return null;
      const replacement = await replaceSaveWithBackup({
        getCurrent,
        incoming: parsed.data,
        saveCurrent: saveBeforeImport,
        createBackup: async raw => {
          try {
            await backupCurrent(raw);
          } catch (error) {
            if (!error.code) error.code = 'IMPORT_BACKUP_FAILED';
            throw error;
          }
        },
        apply,
        persist: async () => {
          try {
            const result = await persistReplacement();
            persistenceWarnings = result?.warnings || [];
            return result;
          } catch (error) {
            if (!error.code) error.code = 'SAVE_WRITE_FAILED';
            throw error;
          }
        },
        now: now(),
      });
      addLog('import', { fileName: file.name, summary: parsed.summary });
      if (persistenceWarnings.length) {
        addLog('save_warning', { sources: persistenceWarnings.map(error => error.source) });
      }
      showMessage(persistenceWarnings.length
        ? '存档导入成功，备用存储不可用，即将刷新'
        : '存档导入成功，即将刷新');
      reload();
      return replacement;
    } catch (error) {
      showMessage(formatSaveTransferError(error));
      return null;
    }
  }

  async function restoreSave() {
    let persistenceWarnings = [];
    try {
      const raw = await platform.loadImportBackup();
      if (!raw) return null;
      const parsed = parseSaveTransfer(raw);
      const current = getCurrent();
      if (!await confirm({ source: '导入前存档', current, incoming: parsed.data, summary: parsed.summary, restore: true })) return null;
      const replacement = await restoreBackupSave({
        getCurrent,
        backupData: parsed.data,
        apply,
        persist: async () => {
          try {
            const result = await persistReplacement();
            persistenceWarnings = result?.warnings || [];
            return result;
          } catch (error) {
            if (!error.code) error.code = 'SAVE_WRITE_FAILED';
            throw error;
          }
        },
      });
      addLog('restore_import_backup');
      if (persistenceWarnings.length) {
        addLog('save_warning', { sources: persistenceWarnings.map(error => error.source) });
      }
      showMessage(persistenceWarnings.length
        ? '已恢复导入前存档，备用存储不可用，即将刷新'
        : '已恢复导入前存档，即将刷新');
      reload();
      return replacement;
    } catch (error) {
      showMessage(formatSaveTransferError(error));
      return null;
    }
  }

  return { exportSave, importSave, restoreSave };
}

export function bindSaveTransferControls(container, options = {}) {
  const controller = createSaveTransferController(options);
  const buttons = ['exportSaveBtn', 'importSaveBtn', 'restoreSaveBtn']
    .map(id => container.querySelector(`#${id}`))
    .filter(Boolean);
  const run = (button, operation) => async () => {
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.classList.add('is-busy');
    try {
      await operation();
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-disabled');
      button.classList.remove('is-busy');
    }
  };
  const exportButton = container.querySelector('#exportSaveBtn');
  const importButton = container.querySelector('#importSaveBtn');
  const restoreButton = container.querySelector('#restoreSaveBtn');
  exportButton?.addEventListener('click', run(exportButton, controller.exportSave));
  importButton?.addEventListener('click', run(importButton, controller.importSave));
  restoreButton?.addEventListener('click', run(restoreButton, controller.restoreSave));
  return controller;
}

export async function refreshImportBackupState(container, platform = createSavePlatform()) {
  const button = container.querySelector('#restoreSaveBtn');
  if (!button) return false;
  try {
    const raw = await platform.loadImportBackup();
    const available = Boolean(raw && parseSaveTransfer(raw));
    button.disabled = !available;
    button.setAttribute('aria-disabled', String(!available));
    return available;
  } catch (_) {
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    return false;
  }
}
