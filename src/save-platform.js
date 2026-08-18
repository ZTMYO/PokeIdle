import { SAVE_MAX_BYTES, SaveTransferError } from './save-transfer.js';

const IMPORT_BACKUP_KEY = 'pokemon_idle_import_backup';

export function pickBrowserImportFile(doc = globalThis.document) {
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      input.remove();
      callback(value);
    };

    input.addEventListener('cancel', () => finish(resolve, null), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        finish(resolve, null);
        return;
      }
      if (file.size > SAVE_MAX_BYTES) {
        finish(reject, new SaveTransferError('SAVE_TOO_LARGE', '存档大小超过 20 MB'));
        return;
      }
      try {
        const content = await file.text();
        finish(resolve, { name: file.name, content, size: file.size });
      } catch (error) {
        finish(reject, error);
      }
    }, { once: true });

    doc.body.appendChild(input);
    input.click();
  });
}

export function createSavePlatform({
  win = globalThis.window ?? {},
  doc = globalThis.document,
  storage = globalThis.localStorage,
} = {}) {
  const mobile = win.__POKEIDLE_MOBILE__;
  const tauri = win.__TAURI__;

  return {
    async pickImportFile() {
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('import_save_data') || null;
      }
      return pickBrowserImportFile(doc);
    },

    async exportSaveData(data, fileName) {
      if (mobile?.exportSaveData) {
        return mobile.exportSaveData(data, fileName);
      }
      if (tauri?.core?.invoke) {
        const path = await tauri.core.invoke('export_save_data', { data, fileName });
        return path ? { path } : null;
      }

      const BlobCtor = win.Blob ?? globalThis.Blob;
      const urlApi = win.URL ?? globalThis.URL;
      const blob = new BlobCtor([data], { type: 'application/json;charset=utf-8' });
      const url = urlApi.createObjectURL(blob);
      const link = doc.createElement('a');
      link.href = url;
      link.download = fileName;
      doc.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        urlApi.revokeObjectURL(url);
      }
      return {};
    },

    async createImportBackup(data) {
      if (mobile?.createImportBackup) return mobile.createImportBackup(data);
      if (tauri?.core?.invoke) return tauri.core.invoke('create_import_backup', { data });
      storage.setItem(IMPORT_BACKUP_KEY, data);
    },

    async loadImportBackup() {
      if (mobile?.loadImportBackup) return mobile.loadImportBackup();
      if (tauri?.core?.invoke) return tauri.core.invoke('load_import_backup');
      return storage.getItem(IMPORT_BACKUP_KEY);
    },

    async getAppVersion() {
      if (mobile?.getAppVersion) return mobile.getAppVersion();
      if (tauri?.app?.getVersion) return tauri.app.getVersion();
      return 'web';
    },
  };
}
