# Android 构建

用 Capacitor 7 把 `src/` 打包成离线 APK。前端不做任何构建改造，`src/` 仍是唯一源码目录。

## 环境

| 项 | 要求 |
|---|---|
| Node.js | 18+ |
| JDK | **21+**（AGP 8 与 Capacitor 生成的 `VERSION_21` 字节码都要求） |
| Android SDK | Platform 35、Build-Tools 35、Platform-Tools、Command-line Tools |

`JAVA_HOME` 必须指向 JDK 21。系统里另装了 JDK 8/17 也没关系，构建时临时覆盖即可：

```bash
JAVA_HOME='D:\zulu21.34.19-ca-jdk21.0.3-win_x64' npm run android:debug
```

缺 SDK 组件时构建脚本会直接报出要执行的 `sdkmanager` 命令。`ANDROID_HOME` 未设置时会自动回退到 `%LOCALAPPDATA%\Android\Sdk`。

### 国内网络

Gradle 分发包与 Maven 依赖默认源在国内不可用（`services.gradle.org` 会 307 跳到 GitHub，Java 的 HTTP 客户端握手直接失败）。仓库里已改好两处：

- `android/gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 指向腾讯云镜像。
- `android/build.gradle` 的 `buildscript` / `allprojects` 优先走阿里云 Maven 镜像，`google()` 与 `mavenCentral()` 作为回退。

在海外网络下把 `distributionUrl` 改回 `https\://services.gradle.org/distributions/gradle-8.11.1-all.zip` 即可。

## 命令

```bash
npm run android:debug     # debug APK，无需签名
npm run android:install   # debug 构建后 adb install -r（覆盖安装）
npm run android:build     # release APK，需要先初始化签名
npm run android:web       # 只重建 mobile/web/，不碰 Gradle
```

release 产物：`dist/android/pokeidle-android-v<version>.apk`。

## 版本号

**只改 `package.json` 的 `version`。** 构建脚本按 `major*10000 + minor*100 + patch` 自动写入 `android/app/build.gradle` 的 `versionCode` / `versionName`（写入后是工作区改动，需要一起提交）。

`versionCode` 必须严格递增，否则 Android 拒绝覆盖安装。已发布过的版本：

| 版本 | versionCode |
|---|---|
| 1.1.1 | 10101 |
| 1.1.2 | 10102 |

## 签名

首次发布前执行一次（生成后立刻离线备份两个文件）：

```bash
npm run android:keystore
```

- `mobile/keystore/pokeidle-release.jks`
- `mobile/keystore.properties`（含随机密码）

两者都在 `.gitignore` 中。**丢失后无法再为 `com.pokemon.idle` 发布覆盖升级包**，玩家只能卸载重装，而存档在应用私有目录，卸载即清除。

## 构建流程与目录

`npm run android:build` 依次执行：

1. 校验 JDK 与 SDK Platform。
2. 把 `src/` 复制到 `mobile/web/`，用 esbuild 把 `mobile/bridge.js` 打成 IIFE 注入 `<script>`。
3. `cap sync android` 同步到 `android/app/src/main/assets/public/`。
4. `gradlew assembleRelease`。
5. 产物复制到 `dist/android/`。

`mobile/web/`、`mobile/.gradle-home/`、`android/build/` 都是生成物，不要手工改。Gradle 缓存放在项目内（`mobile/.gradle-home`）以避开系统盘空间。

## 图标与启动图

图标（`mipmap-*` 15 个）与启动图（`drawable*/splash.png` 11 个）是已生成好的位图，直接入库，构建不参与生成。自适应图标的底色在 `values/ic_launcher_background.xml`（当前 `#73C5A4`）。

要换图时重新生成整套密度，或直接替换这几个目录下的同名文件：

```bash
npx @capacitor/assets generate --android
```

该工具依赖 `sharp` 的原生二进制。若安装失败（国内镜像常缺失 `@img/*` 平台包，npm 会退回 node-gyp 源码编译并因缺少 VS 构建工具报错），可以改用官方 npm 源单独装：`npm i -D @img/sharp-win32-x64`。

## 与桌面端的差异

只有四处平台差异，全部通过 `window.__POKEIDLE_MOBILE__` 判定，桌面端代码路径不受影响：

- **存档**：`Directory.Data/save.json`（应用私有目录），与 Tauri 文件、`localStorage` 三方按 `lastSaveTime` 取最新。切后台与退出前立即落盘。
- **返回键**：等价标题栏返回；在挂机根页面弹出退出确认。
- **外链**：走 `Browser` 插件在系统浏览器打开。
- **导出存档**：写缓存目录后调 `Share` 分享（不走 `<a download>`，WebView 下该路径不可靠）。

画面缩放复用已有的 `browser-mode` 逻辑（`src/main.js` 中按 UA 走 `transform: scale` + `getBoundingClientRect` 补偿），移动端不另立一套。
