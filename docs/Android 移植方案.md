# 口袋挂机 · Android 移植方案（Capacitor）

> 目标：用 **Capacitor** 将现有前端（`src/` 纯静态 HTML/JS）打包为 Android APK。
> 结论：**可行，且比 Tauri 官方 Android 路线改造量小一个量级**——前端无框架无构建、全部 Tauri 调用均已可选链保护（在 Capacitor 下静默跳过），真正要适配的只有「存档落盘」「返回键」「打开外链」三处平台差异。

---

## 0. 为什么选 Capacitor（弃用 Tauri 官方 Android 路线）

| 对比项 | Tauri 2 Android | Capacitor |
|---|---|---|
| 后端 | 需 Rust 条件编译（tray-icon / window-vibrancy / windows crate / global-shortcut 在 Android 全部编译失败） | 纯前端 + Gradle，不碰 Rust |
| 权限 | 需为移动端单独拆 capabilities（tray / global-shortcut 权限在 Android 不存在） | 无此概念 |
| 资源加载 | 自定义协议 + resource_dir 路径在 APK 内要适配 | 直接把 webDir 打进 assets，相对路径照常 |
| 前端改造 | 需逐处适配 | 多数调用已可选链，自动跳过 |
| 工具链 | Node + Rust + NDK + Android SDK | Node + JDK 17 + Android SDK（NDK 非必需） |
| 后端代码风险 | 高（Rust 编译/平台 cfg） | 无 |

---

## 1. 现状盘点（Capacitor 兼容性）

### 1.1 前端形态

- `src-tauri/tauri.conf.json` 中 `frontendDist: "../src"`：游戏是**纯静态 HTML/JS**（无框架、无构建步骤），资源全部相对路径（`./items/...`、`./terrain/...`、`./audio/...`）。
- `src/index.html` 可直接作为 Capacitor 的 `webDir` 入口。✅ 开箱即用。

### 1.2 Tauri API 使用面

以下调用全部形如 `window.__TAURI__?.xxx?.invoke`，**在 Capacitor 下自动 no-op，无需改动**：

| 调用 | 位置 | Capacitor 处理 |
|---|---|---|
| `core.invoke('mark_show'/'set_window_pinned'/'set_window_scale')` | main.js / views.js | 移动端跳过（窗口相关） |
| `core.invoke('hide_to_tray'/'force_close_window')` | main.js | 移动端跳过（无托盘概念） |
| `window.*`（minimize/close/startDragging/setAlwaysOnTop） | main.js | 已有 `?.` + try/catch，不崩 |
| `event.listen('close-requested')` | main.js | 移动端不监听，改用返回键（见 §3.2） |
| `core.invoke('read_gif_base64')` | ui.js | 跳过，走 URL 加载（4 级 fallback 兜底） |
| `tray.js`（托盘动画） | tray.js | 移动端不启动 |

**真正要适配的只有三处**：

| 事项 | 位置 | 适配方式 |
|---|---|---|
| 存档落盘 | state.js / main.js | localStorage 兜底已存在；建议升级 Filesystem（见 §3.1） |
| 返回键 | main.js | `@capacitor/app` 的 `backButton` 事件 |
| 打开外链 | views.js ×2 | 平台抽象：Tauri `opener` / Capacitor `App.openUrl` |

### 1.3 存档读写现状（关键利好）

- [saveGame()](file:///PokeIdle/src/state.js#L386) 同时写 Tauri 文件 **和** `localStorage`；
- [加载逻辑](file:///PokeIdle/src/main.js#L392) 取 localStorage 与 Tauri 文件较新者。
- 即：**切到 Capacitor 后存档立刻能持久化**（localStorage），只是需评估长期稳定性（见 §4.2）。

### 1.4 资源与音频

- 静态资源打进 APK 后经 `https://localhost` 自定义 scheme 伺服，相对 `fetch` 可用。
- 音频 autoplay：Android WebView 默认要求用户手势，需在 MainActivity 关闭（见 §3.4）。

---

## 2. 环境准备（一次性）

1. Node（已有）
2. **JDK 17**，设置 `JAVA_HOME`
3. **Android Studio**（SDK Manager 安装 Platform **API 34/35** + Build Tools + Command-line Tools）
4. 环境变量：`ANDROID_HOME` → SDK 根目录；`%ANDROID_HOME%\platform-tools` 加入 PATH
5. 验证：`adb --version`、`java -version`
6. 测试设备：真机开 USB 调试，或 Android Studio 模拟器

> 无需 Rust / NDK（除非后续写自定义原生插件）。

---

## 3. 分阶段实施

### Phase 1 — 初始化 Capacitor 工程

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/android
npx cap init PokeIdle com.pokemon.idle --web-dir src
npx cap add android
```

- 生成的 `capacitor.config.json` 确认 `webDir: "src"`、`appId: "com.pokemon.idle"`。
- `android/` 工程为 Gradle 项目，模板自带 INTERNET 权限。

### Phase 2 — 平台适配（三处）

#### 2.1 存档落盘

**选项 A（零改动，立即可用）**：直接沿用现有 localStorage 逻辑，`saveGame()` / 加载分支不加任何代码。

**选项 B（推荐，长期更稳）**：`saveGame()` 增加 Capacitor 分支，localStorage 兜底不变：

```js
if (window.Capacitor?.Plugins?.Filesystem) {
  const { Filesystem, Directory, Encoding } = window.Capacitor.Plugins;
  await Filesystem.writeFile({
    path: 'save.json', data: s,
    directory: Directory.Documents, encoding: Encoding.UTF8,
  });
}
localStorage.setItem('pokemon_idle_save', s); // 兜底不变
```

> 注意：Capacitor 插件 JS 侧需打包进页面才挂在 `window.Capacitor.Plugins` 上。若保持 `src/` 零构建，选项 B 需给前端套一层 Vite（webDir 改为构建产物 `dist`，游戏纯 JS 模块化，配置成本低；可参考 `web/` 现有 Vite 工程）；否则退回选项 A 纯 localStorage。

#### 2.2 返回键

用 `@capacitor/app` 替代桌面的「关闭二次确认」语义：

```js
import { App } from '@capacitor/app';
App.addListener('backButton', () => {
  // 先按游戏内导航栈返回；无上级页面时弹「确定退出？」
});
```

#### 2.3 打开外链

views.js 两处 `window.__TAURI__?.opener?.openUrl(url)` 抽成平台 helper：

```js
export async function openExternal(url) {
  if (window.__TAURI__?.opener?.openUrl) return window.__TAURI__.opener.openUrl(url);
  if (window.Capacitor) return (await import('@capacitor/app')).App.openUrl({ url });
  window.open(url, '_blank');
}
```

### Phase 3 — 移动端 UI / 交互方向（需确认）

| 方案 | 做法 | 成本 | 体验 |
|---|---|---|---|
| A 掌机居中（推荐首期） | 320×400 内容居中，四周纯色背景，布局零改动 | 低 | 竖屏小画面，立刻可玩 |
| B 等比放大铺满 | CSS `zoom` / viewport 等比放大到尽量占满屏幕 | 中 | 画面大，可能左右留黑边 |
| C 移动端原生重排 | 按手机尺寸重新设计布局与触控 | 高 | 最佳，适合 V2 |

建议首期 A + B 二选一，C 留作迭代。

### Phase 4 — 原生微调与发布准备

1. **音频 autoplay**：`android/app/src/main/java/.../MainActivity.java` 的 `load()` 前后加
   ```java
   getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
   ```
2. **应用图标**：`npx @capacitor/assets generate` 从 `src/assets/icon.png` 生成 Android 各尺寸 mipmap。
3. **版本号**：与 `package.json` / `update_log.md` 保持一致。
4. **签名**：debug 签名 APK 可直接安装测试；上架需 release keystore。

### Phase 5 — 构建与打包

```bash
npx cap sync                      # 同步 web 资源到 android/assets + 插件
cd android
.\gradlew.bat assembleDebug       # Windows；或 Android Studio 直接 Run
```

- 产出：`android/app/build/outputs/apk/debug/app-debug.apk`
- 真机安装：开启「允许安装未知来源」后安装。

---

## 4. 风险与注意事项

1. **音频 autoplay**：Android WebView 默认要用户手势，需 Phase 4 的 MainActivity 一行；本项目有开场按钮，首次点击后即有声音，影响可控。
2. **存档持久化**：
   - localStorage 在 Capacitor 中随应用私有数据保留、重启不丢，但有 5MB 上限、可能被系统清理；
   - 推荐选项 B（Filesystem 写 Documents），localStorage 只作兜底；
   - **与桌面存档不互通**（`%APPDATA%\com.pokemon.idle\save.json`），Android 独立新档。
3. **APK 体积**：宝可梦 GIF 全量打进 APK，体积偏大；必要时压缩图片或按需加载。
4. **返回键**：需先定行为（返回上一页 vs 直接退出），桌面「关闭二次确认」语义不适用。
5. **性能**：GIF 较多，低端机留意内存，必要时缩小缓存策略（与桌面一致）。
6. **WebView 兼容性**：使用 Android 系统 WebView，旧机型内核版本差异可能影响个别 CSS/JS 特性。
7. **桌面回归**：新增的平台判断均为 `if (window.Capacitor)` 分支，桌面（`__TAURI__` 存在）行为完全不变。

---

## 5. 验收清单

- [ ] `npx cap sync` + Android Studio 在真机/模拟器成功启动
- [ ] 挂机、遇敌、捕捉、商店、设置等核心页面可操作
- [ ] 存档落盘 / 重启读档正常（localStorage 或 Filesystem）
- [ ] 音频在首次交互后正常（autoplay 微调生效）
- [ ] 返回键行为符合预期（先定方案）
- [ ] 桌面构建（`npm run build`）回归正常，不受影响
- [ ] debug APK 产出并可安装

---

## 6. 待确认决策

1. **移动端 UI 方向**：等比放大铺满
2. **返回键行为**：返回上一页
3. **存档方案**：选项 A（纯 localStorage，零改动）vs 选项 B（引入 Vite + Filesystem，更稳）
4. **首期范围**：全部功能跑通
