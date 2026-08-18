import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { calculateMobileScale } from './viewport-utils.mjs';

const SAVE_PATH = 'save.json';
const BACKUP_PATH = 'save.json.bak';
let saveQueue = Promise.resolve();

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

  saveGameData(data) {
    const operation = saveQueue.catch(() => {}).then(async () => {
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
    });
    saveQueue = operation;
    return operation;
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

function syncMobileViewport() {
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const bodyStyle = document.body ? getComputedStyle(document.body) : null;
  const insets = bodyStyle ? {
    top: parseFloat(bodyStyle.paddingTop) || 0,
    right: parseFloat(bodyStyle.paddingRight) || 0,
    bottom: parseFloat(bodyStyle.paddingBottom) || 0,
    left: parseFloat(bodyStyle.paddingLeft) || 0,
  } : {};
  const scale = calculateMobileScale(width, height, insets);
  document.documentElement.style.setProperty('--mobile-scale', String(scale));
}

function enableMobileLayout() {
  document.body?.classList.add('mobile-mode');
  syncMobileViewport();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enableMobileLayout, { once: true });
else enableMobileLayout();
window.addEventListener('resize', syncMobileViewport);
window.visualViewport?.addEventListener('resize', syncMobileViewport);

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
