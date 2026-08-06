# 口袋挂机 · Android 移植方案（供二创者参考）

> 目标：将当前 Tauri 2 桌面应用编译为 Android APK。
> 结论：**可行**。Tauri 2 官方支持 Android（`tauri android dev / build`），但本项目是纯桌面架构，需先完成 Rust 条件编译、权限配置、前端平台适配三步，才能通过编译；随后还有移动端 UI 交互适配（需确认方向）。

---

## 1. 现状盘点（哪些代码在 Android 上会出问题）

### 1.1 Rust 依赖（`src-tauri/Cargo.toml`）

| 依赖 | 现状 | Android 问题 |
|---|---|---|
| `tauri` features `["tray-icon"]` | 通用依赖 | tray-icon 无 Android 实现，编译失败 |
| `tauri-plugin-global-shortcut` | 通用依赖 | 仅桌面平台，Android 不可用 |
| `window-vibrancy` | 通用依赖 | 仅 Windows/macOS，Android 编译失败 |
| `windows` crate | 通用依赖 | 纯 Windows crate，Android 编译失败 |
| `base64` / `serde` / `serde_json` | 通用依赖 | 跨平台，保留 |

### 1.2 Rust 代码（`src-tauri/src/lib.rs`）

| 功能 | 位置 | 处理 |
|---|---|---|
| 托盘动画（TrayFrames/TrayDelay/TrayStatus、set_tray_frames/set_tray_status、托盘图标线程） | lib.rs 全域 | 整块 `#[cfg(not(target_os = "android"))]` |
| 全局快捷键 Ctrl+Alt+1 + 插件注册 | lib.rs | 整块 `#[cfg(not(target_os = "android"))]` |
| `toggle_window_visibility`（托盘点击显隐） | lib.rs | `#[cfg(not(target_os = "android"))]` |
| `hide_to_tray` command | lib.rs | Android 无托盘概念，跳过注册 |
| Windows Acrylic 圆角 | lib.rs setup | 已有 `#[cfg(target_os = "windows")]`，无需改 |
| `on_window_event` CloseRequested 拦截 | lib.rs | 桌面行为；Android 返回键需单独处理（见 §4.3） |
| `window_manager`（缩放/置顶/模糊忽略） | window_manager.rs | Android 无窗口概念，命令可不注册；`set_window_scale` 不再调用 |
| 存档读写 `save_game_data/load_game_data` | game_data.rs | `app_data_dir()` 跨平台可用，无需改（存档不互通） |
| `read_gif_base64` | game_data.rs | resource_dir 路径在 APK 内不同，前端有 4 级 fallback 兜底，仅作保底（见 §4.2） |

### 1.3 权限（`src-tauri/capabilities/default.json`）

- 当前含 `core:tray:*`、`global-shortcut:*`，这些权限在未启用对应插件的 Android 构建下**不存在**，会导致 `generate_context!` 构建失败。
- 需为移动端单独提供一套 capability，去掉 tray / global-shortcut / 窗口控制类权限。

### 1.4 前端 Tauri API 使用面

| 调用 | 文件 | Android 处理 |
|---|---|---|
| `core.invoke('save_game_data'/'load_game_data')` | state.js / main.js | 保留 |
| `core.invoke('read_gif_base64')` | ui.js | 保留（兜底） |
| `core.invoke('mark_show'/'set_window_pinned'/'set_window_scale')` | main.js / views.js | 移动端跳过（窗口相关） |
| `core.invoke('hide_to_tray'/'force_close_window')` | main.js | 移动端关闭确认框整块跳过 |
| `window.*`（minimize / close / startDragging / setAlwaysOnTop） | main.js | 已有 `?.` + try/catch 保护，不崩；但标题栏窗口按钮在移动端应隐藏 |
| `event.listen('close-requested')` | main.js | 移动端不监听，改用返回键逻辑 |
| `opener.openUrl` | views.js | 跨平台可用，保留 |
| `tray.js`（托盘动画前端驱动） | tray.js | 移动端不启动 |

---

## 2. 环境准备（一次性）

1. 安装 **Android Studio**（用于 SDK Manager 管理 SDK/NDK/模拟器）
2. SDK Manager 安装：
   - Platform：**API 34+**
   - Platform Tools、Build Tools、**Command-line Tools**
   - **NDK 25.x / 26.x** 与 CMake
3. 安装 **JDK 17**，设置 `JAVA_HOME`（指向 JDK 根目录）
4. 设置环境变量：
   - `ANDROID_HOME` → SDK 根目录（如 `%LOCALAPPDATA%\Android\Sdk`）
   - `ANDROID_NDK_HOME` → NDK 目录（如 `<SDK>\ndk\26.x.x`
   - `%ANDROID_HOME%\platform-tools` 加入 PATH
5. 验证：`adb --version`、`java -version`、`rustc --version`
6. 准备测试设备：真机开 USB 调试，或 Android Studio 创建模拟器

---

## 3. 分阶段实施

### Phase 1 — Rust 条件编译（可先行开发，无环境也能改）

**Cargo.toml** 按目标平台拆分依赖：

```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri-plugin-opener = "2"

[target.'cfg(not(target_os = "android"))'.dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
tauri-plugin-global-shortcut = "2"
window-vibrancy = "0.6"
windows = "0.61"
base64 = "0.22"

[target.'cfg(target_os = "android")'.dependencies]
tauri = { version = "2", features = ["image-png"] }
base64 = "0.22"
```

**lib.rs** 用 `#[cfg(not(target_os = "android"))]` 包裹：托盘结构体/命令/图标线程、全局快捷键插件、`toggle_window_visibility`、`hide_to_tray`；`invoke_handler` 按平台注册不同命令集。`run()` 已带 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`（Tauri 脚手架已生成，无需改）。

### Phase 2 — capabilities / 配置

- `tauri.conf.json`：`bundle.targets` 增加 `"apk"`（或保留 nsis，Android 构建不受影响）；桌面窗口参数（320×400 / transparent / resizable:false）对 Android 无影响，可保留。
- capabilities：新建移动端专属文件（如 `capabilities/android.json`），声明 `"platforms": ["android"]`，只含 `core:default`、`opener:default`、`core:webview:allow-internal-toggle-devtools`；原 `default.json` 限定 `"platforms": ["windows","macos","linux"]`。

### Phase 3 — 前端平台适配

- 平台判断：`const isAndroid = /android/i.test(navigator.userAgent)`（或 `__TAURI__.plugins` 探测）。
- `main.js`：`isAndroid` 时跳过——关闭二次确认整块（quitDialog 监听、hide_to_tray / force_close_window、close-requested 监听）；窗口控制（minimize/close/startDragging/setAlwaysOnTop）；`tray.js` 不启动。
- `views.js`：设置页隐藏「窗口倍率」「置顶」等桌面项；`applyWindowScale` 在 Android 直接 return。
- 标题栏：移动端隐藏右上角窗口控制按钮（或改为系统返回）。

### Phase 4 — 移动端 UI / 交互方向（**需确认**）

| 方案 | 做法 | 成本 | 体验 |
|---|---|---|---|
| A 掌机居中（推荐首期） | 320×400 内容在屏幕中央，四周留机身色/纯色背景，布局零改动 | 低 | 竖屏小画面，但立刻可玩 |
| B 等比放大铺满 | 用 CSS `zoom` 或 meta viewport 把 320×400 等比放大到尽量占满屏幕（同桌面窗口倍率思路），居中裁剪或留边 | 中 | 画面大，可能左右留黑边 |
| C 移动端原生重排 | 按手机尺寸重新设计各页面布局与触控 | 高 | 最佳，适合后续迭代 |

建议：首期 A + B 二选一上线，C 作为 V2 迭代。

### Phase 5 — 构建与打包

```bash
npm run tauri android init          # 生成 src-tauri/gen/android 工程（需环境就绪）
npm run tauri android dev           # 连真机/模拟器调试（热编译，首次较慢）
npm run tauri android build -- --apk   # 产出 APK
```

- 正式发布还需：应用图标（`tauri icon` 生成 Android 各尺寸）、版本号、签名配置（APK 用 debug 签名可安装测试；上架需 release keystore）。
- 手机上点击「允许安装未知来源」后即可安装 APK。

---

## 4. 风险与注意事项

1. **音频 autoplay**：桌面版在 `additionalBrowserArgs` 里加了 `--autoplay-policy=no-user-gesture-required`，该参数不适用于 Android WebView。Android 上首次用户点击后音频才解锁——本项目有开场按钮/交互，**首次点击后即有声音，影响可控**；若首次进入的挂机阶段需要静默 BGM，需在 Android 工程中设置 `setMediaPlaybackRequiresUserGesture(false)`。
2. **存档不互通**：Windows 存档在 `%APPDATA%\com.pokemon.idle\save.json`，Android 在应用私有目录，**数据不迁移**。仅做新档体验。
3. **静态资源**：`fetch('./road-data.json')`、音频、GIF 在 Android 经 Tauri 自定义协议加载，前端已有 4 级图片 fallback，理论上可直出；若 `read_gif_base64` 的 resource_dir 路径在 APK 内失效，需将候选路径适配到 Android assets。
4. **返回键**：Android 返回键默认走 WebView 历史，需在 Tauri 移动端处理（返回导航 / 确认退出），桌面「关闭二次确认」语义不适用。
5. **性能**：宝可梦 GIF 较多，Android 低端机需留意内存；必要时缩小图片尺寸缓存策略。
6. **`console.log` 调试**：Android 可用 `adb logcat` 或 DevTools（`allow-internal-toggle-devtools` 已含）。

---

## 5. 验收清单

- [ ] `npm run tauri android dev` 在真机/模拟器成功启动
- [ ] 挂机、遇敌、捕捉、商店、设置等核心页面可操作
- [ ] 存档落盘 / 重启读档正常（Android 私有目录）
- [ ] 音频在首次交互后正常
- [ ] 桌面构建（`npm run tauri build`）不受条件编译影响，回归正常
- [ ] 返回键行为符合预期（先定方案）
- [ ] APK 安装包产出（`tauri android build -- --apk`）

---

## 6. 待确认决策

1. **移动端 UI 方向**：A（掌机居中）/ B（等比放大铺满）/ C（原生重排）
2. **返回键行为**：返回上一页 vs 直接最小化/退出
3. **是否保留桌面托盘/关闭确认**在移动端的对应逻辑（建议去掉）
4. **首期范围**：全部功能跑通 vs 只做核心玩法（挂机/捕捉/图鉴）
