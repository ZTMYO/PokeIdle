const IMPORT_BACKUP_PATH = 'save.import-backup.json';
const FILE_NOT_FOUND_CODE = 'OS-PLUG-FILE-0008';

function isMissingFileError(error) {
  if (error?.code === FILE_NOT_FOUND_CODE) return true;
  const message = String(error?.message || '');
  return /^file does not exist\.?$/i.test(message)
    || /^'readFile' failed because file(?: at '.+')? does not exist\.?$/i.test(message);
}

function requireTextData(result) {
  if (typeof result?.data !== 'string') throw new TypeError('Android 备份读取返回了非文本数据');
  return result.data;
}

export function createMobileSaveTransfer({ Filesystem, Share, App, Directory, Encoding, logger = console }) {
  async function exportSaveData(data, fileName) {
    await Filesystem.writeFile({
      path: fileName,
      data,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      return await Share.share({
        title: '导出存档',
        dialogTitle: '分享口袋挂机存档',
        url: uri,
      });
    } finally {
      await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache }).catch(error => {
        logger.warn('[mobile] 清理导出临时文件失败', error);
      });
    }
  }

  function createImportBackup(data) {
    return Filesystem.writeFile({
      path: IMPORT_BACKUP_PATH,
      data,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
  }

  async function loadImportBackup() {
    try {
      const result = await Filesystem.readFile({
        path: IMPORT_BACKUP_PATH,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return requireTextData(result);
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }
  }

  async function getAppVersion() {
    return (await App.getInfo()).version;
  }

  return { exportSaveData, createImportBackup, loadImportBackup, getAppVersion };
}
