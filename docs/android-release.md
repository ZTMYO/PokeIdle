# Android 正式版构建与发布

本项目使用 Capacitor 7 将 `src/` 中的完整游戏和资源封装为离线 Android APK。最低支持 Android 8.0（API 26），目标 SDK 为 API 35。

## 环境要求

- Node.js 18 或更高版本。
- JDK 21 或更高版本，建议使用 JDK 21。
- Android SDK Platform 35。
- Android SDK Build-Tools 35。
- Android SDK Platform-Tools。
- Android SDK Command-line Tools。

macOS 常用环境变量示例：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Windows 可在 Android Studio 的 SDK Manager 中安装相同组件，并将 `JAVA_HOME`、`ANDROID_HOME` 和 `%ANDROID_HOME%\platform-tools` 配置到系统环境变量。

验证工具链：

```bash
java -version
adb version
sdkmanager --list
```

## 安装依赖

```bash
npm install
```

Capacitor 会将 `src/` 复制到忽略跟踪的 `mobile/web/`，再同步到 Android 工程。不要手工修改 `mobile/web/` 或 `android/app/src/main/assets/public/`，这些目录会在每次构建时重新生成。

## 初始化 release 签名

首次发布前运行一次：

```bash
npm run android:signing:init
```

命令会创建：

- `mobile/keystore/pokeidle-release.jks`
- `mobile/keystore.properties`

这两个文件已被 `.gitignore` 忽略，不会提交到仓库。请立即离线备份两者，并确保只有发布者可以读取。密钥丢失后，无法使用 `com.pokemon.idle` 包名覆盖安装后续版本。

脚本检测到已有密钥时会停止，不会覆盖现有签名。

## 构建 APK

正式签名构建：

```bash
npm run android:build
```

构建流程会依次执行：

1. 复制完整 Web 游戏和资源。
2. 使用 esbuild 打包 Capacitor bridge。
3. 执行 `cap sync android`。
4. 执行 Gradle `assembleRelease`。
5. 复制并重命名 APK。
6. 生成 SHA-256 校验文件。

产物位置：

```text
dist/android/pokeidle-android-v1.0.8.apk
dist/android/pokeidle-android-v1.0.8.apk.sha256
```

游戏资源约 500 MB，生成的移动 Web 目录约 600 MB。APK 和安装时所需空间会随 Android 压缩结果变化，发布页面建议提示用户至少预留 1.5 GB 可用空间。

## Debug 构建与真机安装

生成 debug APK：

```bash
npm run android:debug
```

连接已开启 USB 调试的设备并覆盖安装：

```bash
npm run android:install
```

也可以手工安装正式版：

```bash
adb install -r dist/android/pokeidle-android-v1.0.8.apk
```

## 校验签名与文件

```bash
apksigner verify --verbose dist/android/pokeidle-android-v1.0.8.apk
shasum -a 256 -c dist/android/pokeidle-android-v1.0.8.apk.sha256
```

Windows 可使用 Android SDK 中的 `apksigner.bat`，SHA-256 可使用 PowerShell：

```powershell
Get-FileHash .\dist\android\pokeidle-android-v1.0.8.apk -Algorithm SHA256
```

## 发布前验收

- Android 8.0 或更高版本可以安装并离线启动。
- 开场选择、背景音乐和音效正常。
- 挂机、遇敌、捕捉、孵蛋、导航、商店和设置可操作。
- 竖屏画面等比居中，无状态栏或导航栏遮挡。
- 触控点击、拖拽和列表滚动无明显误触。
- Android 返回键逐级返回，挂机根页面显示退出确认。
- 切到后台、锁屏和恢复后，存档、音乐和离线结算正常。
- 强制结束进程并重启后，可恢复最新存档。
- 主存档损坏时，可从 `save.json.bak` 或 `localStorage` 恢复。
- 使用同一 keystore 构建的新版本可以覆盖安装旧版本。
- `npm run test:mobile` 全部通过。

Android 存档位于应用私有数据目录，不申请公共存储权限。卸载应用会删除应用私有存档；卸载前应在游戏设置中导出存档。

## 版本升级

发布新版本时同步修改：

- `package.json` 的 `version`。
- `src-tauri/tauri.conf.json` 的 `version`。
- `android/app/build.gradle` 的 `versionName` 和递增的 `versionCode`。

`versionCode` 必须严格递增，否则 Android 会拒绝覆盖安装。

## 免费分发与版权声明

APK 只能通过 GitHub Release、网盘等渠道免费、非商业分发。发布页面必须保留：

- 原作者 `@ZTMYO` 和项目地址 <https://github.com/ZTMYO/PokeIdle>。
- MIT 源码许可与 CC BY-NC-ND 原创资源许可。
- Pokémon 相关素材、名称和音乐归原权利方所有的声明。
- “粉丝自制、非官方、与 Pokémon 官方无关联”的声明。

不得售卖 APK、加入广告或付费下载，不得移除署名，也不得将其描述为 Pokémon 官方产品。
