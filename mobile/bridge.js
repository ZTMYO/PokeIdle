import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';

// 自写的安卓插件（KeepAlivePlugin.java）+ 前台服务（KeepAliveService.java）：不依赖任何第三方插件
const KeepAlive = registerPlugin('KeepAlive');
import { Browser } from '@capacitor/browser';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const SAVE_PATH = 'save.json';
const BACKUP_PATH = 'save.json.bak';

async function readFileText(path, directory = Directory.Data) {
  try {
    const { data } = await Filesystem.readFile({
      path,
      directory,
      encoding: Encoding.UTF8,
    });
    return typeof data === 'string' && data ? data : null;
  } catch (_) {
    return null;
  }
}

function readSave() {
  return readFileText(SAVE_PATH);
}

// 主存档写坏/写一半时的回退源：每次落盘前把上一份转存到这里
function readSaveBackup() {
  return readFileText(BACKUP_PATH);
}

// 外部私有目录那份镜像（Android/data/<包名>/files/save.json）：游戏起不来、内部目录又没 root 取不到时，
// 靠它把存档捞回来（adb pull 不需要 root，部分机型的文件管理器也能直接看到）
function readSaveMirror() {
  return readFileText(SAVE_PATH, Directory.External);
}

// 写入串行化：存档由 30 秒周期与多个事件同时触发，并发写会互相截断
let writeChain = Promise.resolve();

function writeSave(data) {
  writeChain = writeChain.catch(() => {}).then(async () => {
    const current = await readFileText(SAVE_PATH);
    if (current && current !== data) {
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
    // 顺手镜像一份到外部私有目录：写失败不影响主档
    await Filesystem.writeFile({
      path: SAVE_PATH,
      data,
      directory: Directory.External,
      encoding: Encoding.UTF8,
    }).catch(() => {});
  });
  return writeChain;
}

// 导出存档：先用 files 而不是 url —— Android 端只有 files 才会以文件流交给分享面板，
// 面板里才有「保存到文件」这类能自己挑存放位置的入口；url 会被当成纯文本，只能分享个链接。
// 返回值给调用方看：true = 面板里确实导出/保存了，false = 玩家在面板上点了取消
async function exportSave(data) {
  const { uri } = await Filesystem.writeFile({
    path: `pokeidle-save-${Date.now()}.json`,
    data,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({ title: '口袋挂机存档', dialogTitle: '导出存档', files: [uri] });
    return true;
  } catch (e) {
    // 取消在上层看来不该是"失败"，但也不能报成功，所以单独分出来
    if (/cancel/i.test(String((e && e.message) || e))) return false;
    throw e;
  }
}

// 分享图片：PNG(base64) 先写进缓存目录，再调系统分享面板
// （安卓 WebView 里没有 navigator.share，只能走原生插件；files 才会以文件流分享出去）
async function shareImage(base64, name) {
  const { uri } = await Filesystem.writeFile({
    path: name,
    data: base64,
    directory: Directory.Cache,
  });
  await Share.share({ title: '口袋挂机', files: [uri] });
}

// 后台常驻（前台服务）：常驻通知 + 进程提到前台优先级，防小米/红米这类系统清后台。
// 通知是 Android 强制的，藏不掉；开关在游戏设置里，默认关。
// 通知不做动态内容：切后台 JS 被冻结，推过去的捕捉/地区状态只会是停摆前的旧值
// 不去要通知权限：Android 13+ 没有它也照样起服务（只是通知看不见）
async function foregroundStart(title = '', text = '') {
  await KeepAlive.start({ title, text });
}
async function foregroundStop() {
  await KeepAlive.stop();
}
// 主题切换：同步安卓窗口底色（状态栏/导航栏露出的那条）
async function setWindowBg(color) {
  await KeepAlive.setWindowBg({ color });
}

window.__POKEIDLE_MOBILE__ = {
  readSave,
  foregroundStart,
  foregroundStop,
  setWindowBg,
  readSaveBackup,
  readSaveMirror,
  writeSave,
  exportSave,
  shareImage,
  openExternal: url => Browser.open({ url }),
  exitApp: () => App.exitApp(),
  attach({ saveNow, back, onAppStateChange }) {
    App.addListener('backButton', () => back());
    App.addListener('appStateChange', ({ isActive }) => {
      // 切后台：停乐 + 立刻落盘；回前台：把被系统挂起的音频接回去
      if (isActive) window.__POKEIDLE_AUDIO_RESUME__?.();
      else {
        window.__POKEIDLE_AUDIO_PAUSE__?.();
        saveNow();
      }
      // 挂机补发记账：原生信号比 WebView 的 visibilitychange 可靠，交给主脚本处理
      onAppStateChange?.(isActive);
    });
  },
};

document.documentElement.classList.add('mobile-app');
