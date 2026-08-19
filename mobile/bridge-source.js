import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { createMobileSaveTransfer } from './save-native.mjs';
import { calculateMobileLayout } from './viewport-utils.mjs';
import { createBackgroundMode } from './background-mode.mjs';

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

const saveTransfer = createMobileSaveTransfer({ Filesystem, Share, App, Directory, Encoding });
const backgroundMode = createBackgroundMode({ capacitor: Capacitor });

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

  ...saveTransfer,

  startBackgroundMode: () => backgroundMode.startBackgroundMode(),
  stopBackgroundMode: () => backgroundMode.stopBackgroundMode(),
  isBackgroundModeSupported: () => backgroundMode.isBackgroundModeSupported(),
  onBackgroundTick: callback => backgroundMode.onBackgroundTick(callback),

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
  const { scale, designHeight } = calculateMobileLayout(width, height, insets);
  const root = document.documentElement;
  root.style.setProperty('--mobile-scale', String(scale));
  root.style.setProperty('--mobile-layout-height', `${designHeight}px`);
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
  if (isActive) {
    Promise.resolve(window.__POKEIDLE_BACKGROUND_RESUME__?.())
      .catch(() => {})
      .finally(() => backgroundMode.stopBackgroundMode().catch?.(() => {}));
    window.__POKEIDLE_AUDIO_RESUME__?.();
  } else {
    Promise.resolve(window.__POKEIDLE_BACKGROUND_ENTER__?.())
      .then(started => {
        if (started !== false) return backgroundMode.startBackgroundMode();
        return null;
      })
      .catch(() => {});
    window.__POKEIDLE_SAVE_NOW__?.();
  }
});

App.addListener('pause', () => window.__POKEIDLE_SAVE_NOW__?.());

backgroundMode.onBackgroundTick(({ now }) => {
  Promise.resolve(window.__POKEIDLE_BACKGROUND_TICK__?.(now)).catch(() => {});
});
