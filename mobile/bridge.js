import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const SAVE_PATH = 'save.json';

async function readSave() {
  try {
    const { data } = await Filesystem.readFile({
      path: SAVE_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return typeof data === 'string' && data ? data : null;
  } catch (_) {
    return null;
  }
}

// 写入串行化：存档由 30 秒周期与多个事件同时触发，并发写会互相截断
let writeChain = Promise.resolve();

function writeSave(data) {
  writeChain = writeChain.catch(() => {}).then(() => Filesystem.writeFile({
    path: SAVE_PATH,
    data,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  }));
  return writeChain;
}

async function exportSave(data) {
  const { uri } = await Filesystem.writeFile({
    path: `pokeidle-save-${Date.now()}.json`,
    data,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({ title: '口袋挂机存档', url: uri });
}

window.__POKEIDLE_MOBILE__ = {
  readSave,
  writeSave,
  exportSave,
  openExternal: url => Browser.open({ url }),
  exitApp: () => App.exitApp(),
  attach({ saveNow, back }) {
    App.addListener('backButton', () => back());
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) saveNow();
    });
  },
};

document.documentElement.classList.add('mobile-app');
