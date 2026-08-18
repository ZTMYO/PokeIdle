# Android 正式版实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 使用 Capacitor 将 PokeIdle 打包为 Android 8.0+ 可离线游玩的正式签名 APK，并加入可靠存档、返回键和触控适配。

**架构：** 保留 `src/` 作为桌面和移动端共用的游戏源码。`mobile/build-web.mjs` 将其复制到临时 Web 目录并注入由 esbuild 打包的 Capacitor bridge；Android 工程只承载 WebView、Filesystem、App 生命周期和系统浏览器能力。移动端专用逻辑通过 `window.__POKEIDLE_MOBILE__` 与主游戏模块通信。

**技术栈：** Capacitor 7、Android Gradle Plugin、Node.js 18+、esbuild、JDK 21、Android SDK API 35、Node 内置测试运行器。

---

## 文件清单与职责

- 修改：`package.json`、`package-lock.json`，加入 Capacitor、esbuild 和 Android 构建命令。
- 修改：`.gitignore`，忽略生成 Web 目录、Android 构建产物和签名私密文件。
- 创建：`capacitor.config.json`，声明应用标识和 `mobile/web` Web 目录。
- 创建：`mobile/bridge-source.js`，实现 Filesystem 存档、生命周期、返回键、退出和外链桥接。
- 创建：`mobile/build-web.mjs`，复制 `src/`、注入 bridge、生成 Capacitor Web 目录。
- 创建：`mobile/android-build.mjs`，检查工具链、执行 `cap sync` 和 Gradle release/debug 构建。
- 创建：`mobile/signing-init.mjs`，生成本机 release keystore 和 `keystore.properties`。
- 创建：`mobile/save-utils.mjs`，提供无 DOM 的候选存档过滤、排序和备份策略函数。
- 创建：`test/mobile-save-utils.test.mjs`，覆盖存档选择和损坏候选过滤。
- 修改：`src/state.js`，在现有 localStorage/Tauri 保存逻辑旁接入移动端 Filesystem 保存。
- 修改：`src/main.js`，接入移动端存档读取、生命周期保存入口、返回键入口和移动端退出分支。
- 修改：`src/views.js`，将 GitHub/声明页外链交给移动端系统浏览器桥接。
- 修改：`src/index.html`，补充 Android 安全区 viewport 元信息。
- 修改：`src/styles.css`，增加移动端等比缩放、触控反馈、安全区和桌面控件隐藏样式。
- 修改：`.gitignore`，确保 Android 私密配置和 APK 不被提交。
- 生成：`android/`，由 Capacitor 生成的 Gradle Android 工程；只保留必要的 MainActivity/WebView 音频设置和应用元数据修改。
- 创建：`mobile/keystore.properties.example`，说明签名配置字段，不包含真实密码。
- 创建：`docs/android-release.md`，记录环境准备、签名备份、构建、校验和发布流程。

### 任务 1：先建立存档候选工具和失败测试

**文件：**
- 创建：`mobile/save-utils.mjs`
- 测试：`test/mobile-save-utils.test.mjs`

- [ ] **步骤 1：编写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseNewestSave, parseSaveCandidate } from '../mobile/save-utils.mjs';

test('只接受包含 items 的合法 JSON 存档', () => {
  assert.deepEqual(parseSaveCandidate('{"items":{},"stats":{"lastSaveTime":4}}'), {
    items: {}, stats: { lastSaveTime: 4 },
  });
  assert.equal(parseSaveCandidate('{"stats":{}}'), null);
  assert.equal(parseSaveCandidate('{bad json'), null);
});

test('从多个来源选择 lastSaveTime 最大的存档', () => {
  const selected = chooseNewestSave([
    { source: 'local', raw: '{"items":{},"stats":{"lastSaveTime":10}}' },
    { source: 'mobile', raw: '{"items":{},"stats":{"lastSaveTime":20}}' },
  ]);
  assert.equal(selected.source, 'mobile');
  assert.equal(selected.data.stats.lastSaveTime, 20);
});

test('相同时间戳保留候选顺序，保证读取稳定', () => {
  const selected = chooseNewestSave([
    { source: 'mobile', raw: '{"items":{},"stats":{"lastSaveTime":20}}' },
    { source: 'local', raw: '{"items":{},"stats":{"lastSaveTime":20}}' },
  ]);
  assert.equal(selected.source, 'mobile');
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`node --test test/mobile-save-utils.test.mjs`

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`，因为 `mobile/save-utils.mjs` 尚未创建。

- [ ] **步骤 3：实现最小工具**

```js
export function parseSaveCandidate(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.items || typeof data.items !== 'object') return null;
    return data;
  } catch (_) {
    return null;
  }
}

export function chooseNewestSave(candidates = []) {
  return candidates
    .map(candidate => ({ ...candidate, data: parseSaveCandidate(candidate.raw) }))
    .filter(candidate => candidate.data)
    .sort((a, b) => (b.data.stats?.lastSaveTime || 0) - (a.data.stats?.lastSaveTime || 0))[0] || null;
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`node --test test/mobile-save-utils.test.mjs`

预期：3 个测试全部 PASS。

- [ ] **步骤 5：提交**

```bash
git add mobile/save-utils.mjs test/mobile-save-utils.test.mjs
git commit -m "test(Android): 添加移动端存档候选测试"
```

### 任务 2：加入 Capacitor 依赖、配置和构建忽略项

**文件：**
- 修改：`package.json`、`package-lock.json`、`.gitignore`
- 创建：`capacitor.config.json`、`mobile/keystore.properties.example`

- [ ] **步骤 1：修改依赖和脚本**

在 `package.json` 中加入以下脚本和依赖：

```json
{
  "scripts": {
    "android:prepare": "node mobile/build-web.mjs && npx cap sync android",
    "android:build": "node mobile/android-build.mjs release",
    "android:debug": "node mobile/android-build.mjs debug",
    "android:install": "node mobile/android-build.mjs install"
  },
  "devDependencies": {
    "@capacitor/android": "^7.4.0",
    "@capacitor/app": "^7.1.0",
    "@capacitor/browser": "^7.0.0",
    "@capacitor/cli": "^7.4.0",
    "@capacitor/core": "^7.4.0",
    "@capacitor/filesystem": "^7.1.0",
    "esbuild": "^0.25.0"
  }
}
```

保留已有 `dev`、`build` 和 `icon` 脚本；运行 `npm install` 更新 lockfile。

- [ ] **步骤 2：创建 Capacitor 配置**

```json
{
  "appId": "com.pokemon.idle",
  "appName": "口袋挂机",
  "webDir": "mobile/web",
  "bundledWebRuntime": false,
  "server": { "androidScheme": "https" }
}
```

- [ ] **步骤 3：补充忽略项和私有配置模板**

`.gitignore` 增加：

```gitignore
mobile/web/
mobile/.tmp/
android/.gradle/
android/build/
android/app/build/
mobile/keystore/
mobile/keystore.properties
dist/android/
```

`mobile/keystore.properties.example` 只包含 `storeFile`、`storePassword`、`keyAlias`、`keyPassword` 四个字段名。

- [ ] **步骤 4：运行依赖和配置检查**

运行：`npm install && node -e "JSON.parse(require('fs').readFileSync('capacitor.config.json'))"`

预期：npm 安装成功，配置 JSON 可解析；若网络或工具链不可用，记录具体错误后继续进行不依赖安装的源码任务。

- [ ] **步骤 5：提交**

```bash
git add package.json package-lock.json capacitor.config.json .gitignore mobile/keystore.properties.example
git commit -m "chore(Android): 初始化 Capacitor 构建配置"
```

### 任务 3：实现移动端 bridge 和 Web 资源生成

**文件：**
- 创建：`mobile/bridge-source.js`
- 创建：`mobile/build-web.mjs`

- [ ] **步骤 1：实现 bridge API**

bridge 使用 Capacitor 插件导出以下接口：

```js
const MOBILE = {
  async loadGameData() {
    const main = await Filesystem.readFile({ path: 'save.json', directory: Directory.Data });
    const backup = await Filesystem.readFile({ path: 'save.json.bak', directory: Directory.Data });
    return { main: main.data || null, backup: backup.data || null };
  },
  async saveGameData(data) {
    const current = await Filesystem.readFile({ path: 'save.json', directory: Directory.Data }).catch(() => null);
    if (current?.data) await Filesystem.writeFile({ path: 'save.json.bak', data: current.data, directory: Directory.Data });
    await Filesystem.writeFile({ path: 'save.json', data, directory: Directory.Data });
  },
  async openExternal(url) { return Browser.open({ url }); },
  async exitApp() { return App.exitApp(); },
};
window.__POKEIDLE_MOBILE__ = MOBILE;
App.addListener('backButton', () => window.__POKEIDLE_MOBILE_BACK__?.());
App.addListener('appStateChange', ({ isActive }) => {
  if (!isActive) window.__POKEIDLE_SAVE_NOW__?.();
  else window.__POKEIDLE_AUDIO_RESUME__?.();
});
```

Filesystem 读取失败返回空候选，不让启动异常阻塞游戏。

- [ ] **步骤 2：实现资源复制和 bridge 打包**

`mobile/build-web.mjs` 使用 `fs.cpSync(src, webDir, { recursive: true })` 复制 `src/`，调用 `esbuild.build({ entryPoints: ['mobile/bridge-source.js'], bundle: true, format: 'iife', platform: 'browser', outfile: 'mobile/web/mobile-bridge.js' })`，再将 `<script src="./mobile-bridge.js"></script>` 插入生成目录的 `index.html`。

- [ ] **步骤 3：验证生成目录**

运行：`node mobile/build-web.mjs`

预期：`mobile/web/index.html`、`mobile/web/mobile-bridge.js` 和 `mobile/web/audio/Battle.mp3` 存在，源 `src/` 不被修改。

- [ ] **步骤 4：提交**

```bash
git add mobile/bridge-source.js mobile/build-web.mjs
git commit -m "feat(Android): 添加离线 Web 资源和平台桥接"
```

### 任务 4：接入游戏存档、生命周期和返回键

**文件：**
- 修改：`src/state.js`
- 修改：`src/main.js`
- 修改：`src/views.js`

- [ ] **步骤 1：接入移动端保存**

在 `saveGame()` 中保留现有 Tauri 和 localStorage 分支，并追加：

```js
try {
  await window.__POKEIDLE_MOBILE__?.saveGameData(s);
} catch (error) {
  console.warn('[mobile] save failed', error);
}
```

- [ ] **步骤 2：接入移动端读取**

初始化时把 bridge 返回的 `main`、`backup` 加入现有候选数组，并通过 `chooseNewestSave` 规则过滤损坏 JSON；不改变桌面 Tauri 文件和 localStorage 的优先级兼容行为。

- [ ] **步骤 3：暴露返回和生命周期入口**

在 `main.js` 初始化完成后设置：

```js
window.__POKEIDLE_SAVE_NOW__ = () => saveGame();
window.__POKEIDLE_AUDIO_RESUME__ = () => initAudio(gameData.settings?.musicVolume ?? 0.6);
window.__POKEIDLE_MOBILE_BACK__ = () => {
  if ($('appTitle')?.dataset.action === 'back') handleAppTitleBack();
  else openQuitDialog();
};
```

移动端退出按钮调用 bridge 的 `exitApp()`，桌面端继续调用 Tauri `force_close_window`。

- [ ] **步骤 4：接入外链**

在 `views.js` 的 GitHub 和声明页点击处理器中按顺序调用 `window.__POKEIDLE_MOBILE__?.openExternal(url)`、Tauri opener 和 `window.open` 回退。

- [ ] **步骤 5：运行桌面回归检查**

运行：`npm run build`

预期：桌面构建行为不变；非 Tauri 浏览器没有 bridge 时仍使用 localStorage 和普通外链。

- [ ] **步骤 6：提交**

```bash
git add src/state.js src/main.js src/views.js
git commit -m "feat(Android): 接入移动端存档和返回键"
```

### 任务 5：实现触控、缩放和 Android 音频设置

**文件：**
- 修改：`src/index.html`、`src/styles.css`
- 修改：生成的 `android/app/src/main/.../MainActivity.java`

- [ ] **步骤 1：增加移动端 viewport 和样式**

将 viewport 改为：

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
```

增加 `body.mobile-mode` 样式：根据安全区计算可用空间，固定 274 × 342 基准尺寸并使用 `transform: scale()` 等比居中；设置 `touch-action: manipulation`、`overscroll-behavior: none`，隐藏 `.minimize` 和 `.close`，为 `.control-btn` 和 `.bag-slot` 增加按下反馈。

- [ ] **步骤 2：设置 Android WebView 音频策略**

在 MainActivity 的 `onCreate` 中调用：

```java
getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
```

同时在 Android manifest 固定竖屏，并保留 Capacitor 默认启动主题。

- [ ] **步骤 3：在 Android 容器加载完成后标记移动端**

由 bridge 注入 `document.body.classList.add('mobile-mode')`，确保桌面 Tauri 和普通浏览器不改变现有 274 × 342 样式。

- [ ] **步骤 4：运行静态检查**

运行：`node --check mobile/bridge-source.js`、`git diff --check`

预期：无语法错误和空白错误。

- [ ] **步骤 5：提交**

```bash
git add src/index.html src/styles.css android
git commit -m "feat(Android): 优化竖屏触控和音频体验"
```

### 任务 6：生成签名配置并实现 Android 构建脚本

**文件：**
- 创建：`mobile/signing-init.mjs`
- 创建：`mobile/android-build.mjs`
- 修改：`android/app/build.gradle`

- [ ] **步骤 1：实现 keystore 初始化命令**

`mobile/signing-init.mjs` 检查 `keytool`，创建 `mobile/keystore/pokeidle-release.jks`，生成随机密码并写入权限为 `0600` 的 `mobile/keystore.properties`；文件已被 `.gitignore` 忽略，并在终端打印一次备份提示。

- [ ] **步骤 2：配置 Gradle release signing**

`android/app/build.gradle` 读取 `rootProject.file('../mobile/keystore.properties')`，缺少文件或字段时对 release 构建抛出带路径的错误；debug 构建继续使用默认 debug 签名。

- [ ] **步骤 3：实现跨平台构建脚本**

`mobile/android-build.mjs`：

1. 检查 `node`、`java`、`adb` 和 `ANDROID_HOME`。
2. `release` 模式先执行 Web 资源复制和 `npx cap sync android`。
3. 根据平台选择 `android/gradlew` 或 `android/gradlew.bat`，执行 `assembleRelease`。
4. 将 APK 复制到 `dist/android/pokeidle-android-v1.0.8.apk`。
5. 调用 `sha256sum` 或 Node `crypto` 生成 `.sha256`。
6. `install` 模式先构建 debug，再执行 `adb install -r`。

- [ ] **步骤 4：运行构建前检查**

运行：`node mobile/android-build.mjs release`

预期：工具链未安装时返回非零状态并明确指出缺失工具；工具链完整时生成签名 APK。

- [ ] **步骤 5：提交**

```bash
git add mobile/signing-init.mjs mobile/android-build.mjs android/app/build.gradle
git commit -m "feat(Android): 添加 release 签名和构建脚本"
```

### 任务 7：补齐发布文档并执行验收

**文件：**
- 创建：`docs/android-release.md`
- 修改：`README.md`（仅增加 Android 下载和许可说明）

- [ ] **步骤 1：编写发布说明**

文档列出 JDK 21、Android SDK API 35、`npm install`、`node mobile/signing-init.mjs`、`npm run android:build`、SHA-256 校验、APK 安装、签名密钥备份、存档位置和免费非商业分发限制。

- [ ] **步骤 2：运行自动化测试**

运行：`node --test test/mobile-save-utils.test.mjs`、`npm run build`。

预期：存档测试全部 PASS；桌面构建成功。

- [ ] **步骤 3：运行 Android 构建和签名验收**

运行：`npm run android:build`、`apksigner verify --verbose dist/android/pokeidle-android-v1.0.8.apk`。

预期：生成 APK，签名验证通过，并生成 SHA-256 文件。

- [ ] **步骤 4：真机验收**

安装 APK 后逐项验证：离线启动、开场音频、挂机/遇敌/捕捉、孵蛋/导航/商店/设置、触控缩放、返回键、切后台恢复、存档重启和损坏存档备份回退。

- [ ] **步骤 5：提交发布文档**

```bash
git add docs/android-release.md README.md
git commit -m "docs(Android): 补充 APK 发布和验收说明"
```

## 计划自检

- 规格中的离线资源、Filesystem 存档、备份回退、生命周期、返回键、触控缩放、音频、签名、校验、桌面回归和许可约束均有对应任务。
- 已扫描计划中的占位词；所有步骤均给出具体文件、命令、函数名或代码结构，范围完整且可执行。
- `window.__POKEIDLE_MOBILE__`、`window.__POKEIDLE_SAVE_NOW__`、`window.__POKEIDLE_AUDIO_RESUME__` 和 `window.__POKEIDLE_MOBILE_BACK__` 在任务 3、4 中定义和使用一致。
