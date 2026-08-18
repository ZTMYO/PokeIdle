# 口袋挂机 Android 正式版设计规格

## 1. 背景与目标

将现有 PokeIdle 纯前端游戏封装为可公开下载的 Android 正式签名 APK，支持 Android 8.0（API 26）及以上版本。APK 必须能够离线运行，保留现有桌面版功能，并针对触控设备改善缩放、返回键、后台恢复和存档可靠性。

发布渠道为 GitHub Release、网盘等直接下载，不接入应用商店。分发必须保持免费，保留原作者署名、原项目链接、许可证和 Pokémon 非官方声明。

## 2. 已确认的范围

### 2.1 交付内容

- Capacitor Android 工程和 Gradle release 构建流程。
- 一套新的 Android release keystore；密钥和密码不进入 Git。
- 带版本号的正式签名 APK，以及 SHA-256 校验文件。
- Android 构建、安装、签名配置和真机验收文档。
- 桌面 Tauri 构建不受移动端改造影响。

### 2.2 不在本期范围

- Google Play 或其他应用商店上架。
- 账号系统、云存档、联网排行榜和支付。
- 修改或重新压缩受 CC BY-NC-ND 约束的原创资源。
- 将项目改造成原生 Android UI；游戏仍由 WebView 渲染。

## 3. 方案选择

### 3.1 采用方案：Capacitor 离线完整包

Capacitor 只承担 Android 容器和少量平台能力，游戏逻辑继续运行在现有 HTML/CSS/JavaScript 中。所有游戏资源复制到 APK 内，安装后不依赖网络。

选择原因：

1. 现有游戏已经是相对路径的静态资源，适合 WebView 离线加载。
2. Tauri 桌面端包含托盘、窗口、Rust 插件等 Android 不需要的能力，直接移植会引入更大的条件编译风险。
3. Capacitor 的 Android 工程由 Gradle 管理，适合产出可重复的 release APK。

### 3.2 未采用方案

- 在线 WebView 或 TWA：APK 体积较小，但离线不可玩，且线上资源变化会影响已发布客户端。
- Tauri Android：需要拆分桌面专属 Rust 能力，构建和维护成本高于本期收益。

## 4. 工程结构与构建流

### 4.1 目录边界

- `src/`：唯一游戏源码和资源源目录，继续供 Tauri 桌面端使用。
- `mobile/`：Android 构建脚本、平台 bridge 源码、签名说明和临时 Web 目录生成逻辑。
- `android/`：Capacitor 生成的 Android Gradle 工程，不手工修改生成的依赖缓存。
- `dist/android/`：release APK 和校验文件输出目录，加入 `.gitignore`。

### 4.2 Web 资源生成

`mobile/build-web.mjs` 执行以下步骤：

1. 清理并创建临时 Web 输出目录。
2. 完整复制 `src/`，保持 GIF、音频、地图、精灵和 JSON 的相对路径。
3. 将 Capacitor bridge 编译为浏览器可加载的脚本，并注入临时 `index.html`。
4. 将生成目录交给 Capacitor 的 `webDir`，执行 `cap sync`。

桥接脚本通过 `window.__POKEIDLE_MOBILE__` 暴露稳定的最小接口，桌面端不存在该对象时保持原有 Tauri 和 `localStorage` 分支。

### 4.3 Android 基本配置

- 应用名：`口袋挂机`。
- 包名：`com.pokemon.idle`。
- 最低 SDK：API 26。
- 目标 SDK：API 35（Android 15）。
- 方向：竖屏。
- 主题：不显示桌面标题栏，使用游戏自身标题栏。
- 权限：仅保留 WebView 和外部链接所需的最小权限，不申请定位、通讯录、存储等无关权限。

## 5. 平台能力设计

### 5.1 存档写入

现有 `saveGame()` 保持调用频率和数据格式不变，并增加移动端分支：

1. 序列化 `gameData`，更新 `stats.lastSaveTime`。
2. 使用 Capacitor `Directory.Data` 写入 Android 应用私有数据目录的 `save.json`，不申请公共存储权限。
3. 将上一份有效存档保留为 `save.json.bak`，写入失败时保留旧文件。
4. 继续写入 `localStorage` 作为快速读取和兼容兜底。

Filesystem 写入失败只记录日志，不阻塞挂机、捕捉和其他游戏操作。

### 5.2 存档读取与迁移

启动时读取 Android Filesystem、`localStorage` 和 Tauri 文件（仅桌面端可用）中的候选存档，过滤无法解析或缺少 `items` 字段的内容，按 `stats.lastSaveTime` 选择最新版本。

若最新文件 JSON 损坏，则按顺序尝试备份和其他候选；所有候选均无效时创建默认存档，并在系统日志中提示。现有旧版本字段迁移逻辑继续执行。

### 5.3 生命周期

- `pause`、`appStateChange` 或 WebView 进入后台时调用一次 `saveGame()`。
- 回到前台时重新初始化音频上下文，并依靠现有离线结算按真实时间补算收益。
- 不在后台启动高频新计时器；恢复时由现有游戏 tick 继续调度。

### 5.4 Android 返回键

bridge 注册 Capacitor `backButton` 事件，并调用主模块暴露的移动端返回入口。返回优先级如下：

1. 关闭当前浮层、记录页或选择页。
2. 调用现有 `goBack()`，按导航栈逐级返回。
3. 已在挂机根页面时显示退出确认，并先保存存档。
4. 用户确认后调用 Android `exitApp`；取消则保持游戏运行。

桌面端的最小化、关闭窗口、托盘和窗口拖拽逻辑在 Android 中不执行。

### 5.5 外部链接

GitHub 和声明页链接在 Android 中交给系统浏览器打开；Tauri 继续使用原有 opener API，普通浏览器环境保留默认链接行为。

## 6. 移动端游玩体验

### 6.1 画面缩放

游戏内部设计尺寸保持 274 × 342。Android 端锁定竖屏，计算安全区内可用尺寸后按比例缩放并居中，不拉伸像素素材。状态栏和导航栏区域不遮挡游戏内容。

### 6.2 触控行为

- 启用 `touch-action: manipulation`，移除点击延迟和系统长按菜单。
- 保留现有拖拽、滚动和点击语义，增加触控按下反馈。
- 数据列表、图鉴和日志仍可纵向滚动，页面不产生整屏橡皮筋回弹。
- 隐藏最小化、关闭等桌面窗口控件，保留手机、悬赏、商店和设置入口。
- 不改变核心数值、捕捉概率、离线收益和战斗规则。

### 6.3 音频

首次开场按钮点击后启动音乐和音效。Android WebView 关闭“必须用户手势才能播放”的限制；前后台切换后重新恢复 `AudioContext`，失败时保持静音而不影响游戏逻辑。

### 6.4 性能边界

不修改受许可约束的图片和音频内容。通过 APK 压缩、避免重复复制、在移动端关闭托盘和窗口轮询来降低额外开销。资源总体积预计仍为数百 MB，发布说明中明确安装空间要求。

## 7. 签名与发布

### 7.1 密钥管理

- 使用 `keytool` 新建 release keystore。
- keystore、密码文件、`keystore.properties` 和中间构建目录全部加入 `.gitignore`。
- Gradle 仅从本机私有配置读取签名参数；缺少参数时明确失败，不生成未签名的“正式版”假产物。
- 发布者必须备份 keystore 和密码；丢失后无法覆盖升级同一包名的 APK。

### 7.2 产物

release 构建输出到 `dist/android/`：

- `pokeidle-android-v1.0.8.apk`：正式签名 APK。
- `pokeidle-android-v1.0.8.apk.sha256`：SHA-256 校验值。

发布说明同时提供 Android 最低版本、文件大小、安装步骤、存档位置和许可证声明。

## 8. 错误处理

| 场景 | 处理方式 |
| --- | --- |
| Filesystem 不可用 | 继续使用 `localStorage`，记录系统日志 |
| 存档 JSON 损坏 | 尝试 `.bak` 和其他候选，全部失败才新建默认存档 |
| 音频初始化失败 | 保持静音并允许用户在设置中重试，不阻塞游戏 |
| 外部浏览器不可用 | 回退到普通 `window.open`，不影响页面操作 |
| Android 返回事件重复触发 | bridge 使用单次处理锁，完成后释放 |
| release 签名配置缺失 | 构建脚本返回非零状态并说明缺少的配置项 |

## 9. 验收标准

### 9.1 构建验收

- Node.js、JDK 17、Android SDK 和 Gradle 检查通过。
- `npm run android:build` 生成正式签名 APK 和 SHA-256 文件。
- `apksigner verify` 验证签名通过。
- `npm run build` 桌面构建通过，移动端文件不改变桌面行为。

### 9.2 真机验收

- Android 8.0+ 真机可安装、启动和离线进入游戏。
- 首次开场、挂机、遇敌、捕捉、孵蛋、导航、商店、设置和自动操作可完成。
- 触控点击、拖拽、列表滚动和等比缩放无明显遮挡或误触。
- 返回键按导航层级返回，根页面显示退出确认。
- 切后台、锁屏、恢复后音乐状态和挂机收益正确。
- 保存后强制结束并重启，最新存档可恢复；损坏主存档时备份可恢复。
- 使用同一 keystore 构建的新版本可以覆盖安装旧版本。

## 10. 许可与分发约束

APK 只能免费、非商业分发。发布包和说明必须保留：

- 原项目作者和 GitHub 仓库链接。
- MIT 源码许可和 CC BY-NC-ND 原创资源许可。
- Pokémon 相关素材、名称和音乐归属其原权利方的声明。
- “粉丝自制、非官方、与 Pokémon 官方无关联”的声明。

本期不修改原始素材，不移除署名，不将 APK 标注为官方产品，也不提供付费下载或广告变现。
