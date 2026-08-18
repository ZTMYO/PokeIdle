import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const SAVE_PATH = 'save.json';
const BACKUP_PATH = 'save.json.bak';

async function readData(path) {
  try {
    const result = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
    return typeof result.data === 'string' ? result.data : null;
  } catch (_) {
    return null;
  }
}

const mobileBridge = {
  isMobile: true,

  async loadGameData() {
    const [main, backup] = await Promise.all([readData(SAVE_PATH), readData(BACKUP_PATH)]);
    return { main, backup };
  },

  async saveGameData(data) {
    const current = await readData(SAVE_PATH);
    if (current) {
      await Filesystem.writeFile({
        path: BACKUP_PATH,
        data: current,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
    }
    await Filesystem.writeFile({
      path: SAVE_PATH,
      data,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
  },

  openExternal(url) {
    return Browser.open({ url });
  },

  exitApp() {
    return App.exitApp();
  },
};

window.__POKEIDLE_MOBILE__ = mobileBridge;
document.documentElement.classList.add('mobile-mode');

let handlingBack = false;
App.addListener('backButton', async () => {
  if (handlingBack) return;
  handlingBack = true;
  try {
    await window.__POKEIDLE_MOBILE_BACK__?.();
  } finally {
    handlingBack = false;
  }
});

App.addListener('appStateChange', ({ isActive }) => {
  if (isActive) window.__POKEIDLE_AUDIO_RESUME__?.();
  else window.__POKEIDLE_SAVE_NOW__?.();
});

App.addListener('pause', () => window.__POKEIDLE_SAVE_NOW__?.());
