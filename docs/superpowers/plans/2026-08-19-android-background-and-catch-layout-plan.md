# Android 后台挂机与捕捉布局修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 Android 增加带常驻通知的后台自动遇敌/抓捕，并修复扔球后整个战斗场景偏移。

**架构：** JavaScript 负责可测试的时间戳结算和现有战斗规则，Capacitor/Java 前台服务只负责保活、通知和心跳。捕捉动画在启动时保存容器内联样式，在所有结束路径恢复；舞台尺寸缓存按实际视口尺寸失效。

**技术栈：** 原生 Java Android Service、Capacitor 7 bridge、ES modules、Node 内置 `node:test`、现有 Gradle/Android SDK。

---

## 文件职责

- 创建：`src/background-settlement.js`，无 DOM 的时间片结算与幂等游标。
- 修改：`src/battle.js`，抽取/复用遭遇捕获结算，接入后台无动画路径。
- 修改：`src/state.js`、`src/main.js`，保存后台运行快照、前后台切换和恢复刷新。
- 修改：`mobile/bridge-source.js`，暴露后台模式接口并转发原生心跳。
- 创建：`mobile/background-mode.mjs`，浏览器/桌面兼容的空实现和时间片桥接契约。
- 创建：`android/app/src/main/java/com/pokemon/idle/PokeIdleBackgroundPlugin.java`，Capacitor 插件接口。
- 创建：`android/app/src/main/java/com/pokemon/idle/PokeIdleBackgroundService.java`，前台服务、通知和心跳。
- 修改：`android/app/src/main/java/com/pokemon/idle/MainActivity.java`、`android/app/src/main/AndroidManifest.xml`、`android/app/build.gradle`，注册插件、声明服务和权限。
- 修改：`src/animation.js`、`src/ui.js`、`mobile/bridge-source.js`，恢复捕捉布局并让舞台尺寸缓存失效。
- 创建：`test/background-settlement.test.mjs`、`test/mobile-background-contract.test.mjs`、`test/catch-layout-contract.test.mjs`，覆盖纯逻辑和静态契约。

### 任务 1：锁定后台结算契约（TDD）

**文件：** 创建 `test/background-settlement.test.mjs`；创建 `src/background-settlement.js`。

- [ ] **步骤 1：先写失败测试**

测试固定随机源和时间，定义纯函数接口：

```js
import { settleBackgroundSlice } from '../src/background-settlement.js';

test('按经过时间生成遭遇并保证同一游标幂等', () => {
  const state = { settledAt: 0, candy: 0, balls: { 'poke-ball': 3 }, stats: {} };
  const first = settleBackgroundSlice(state, {
    now: 31_000,
    encounterEveryMs: 15_000,
    random: () => 0,
    resolveEncounter: () => ({ result: 'caught', ball: 'poke-ball' }),
  });
  assert.equal(first.encounters, 2);
  assert.equal(first.state.balls['poke-ball'], 1);
  const repeat = settleBackgroundSlice(first.state, {
    now: 31_000,
    encounterEveryMs: 15_000,
    random: () => 0,
    resolveEncounter: () => ({ result: 'caught', ball: 'poke-ball' }),
  });
  assert.equal(repeat.encounters, 0);
  assert.equal(repeat.state.balls['poke-ball'], 1);
});

test('时间回拨不结算，单次最多结算 24 小时', () => {
  const state = { settledAt: 100_000, balls: {}, stats: {} };
  assert.equal(settleBackgroundSlice(state, { now: 99_000 }).encounters, 0);
  const capped = settleBackgroundSlice(state, {
    now: 100_000 + 48 * 60 * 60 * 1000,
    encounterEveryMs: 60_000,
    maxElapsedMs: 24 * 60 * 60 * 1000,
    resolveEncounter: () => ({ result: 'fled' }),
  });
  assert.equal(capped.elapsedMs, 24 * 60 * 60 * 1000);
});
```

- [ ] **步骤 2：运行失败测试**

运行：`node --test test/background-settlement.test.mjs`

预期：因 `src/background-settlement.js` 尚不存在而失败。

- [ ] **步骤 3：实现最小纯函数**

实现 `settleBackgroundSlice(state, options)`：复制状态而非原地修改；处理 `now <= settledAt`、`maxElapsedMs`、遇敌间隔和每次 `resolveEncounter` 返回的 `caught`/`fled`/`continue`；把 `settledAt` 推进到 `now` 或截断后的时间，并返回 `{ state, encounters, elapsedMs, results }`。函数不导入 DOM、`window`、Android API 或随机全局状态。

- [ ] **步骤 4：运行测试确认通过**

运行：`node --test test/background-settlement.test.mjs`

预期：全部 PASS。

- [ ] **步骤 5：提交**

```bash
git add src/background-settlement.js test/background-settlement.test.mjs
git commit -m "feat(后台): 添加可幂等的时间片结算核心"
```

### 任务 2：接入现有战斗规则和存档

**文件：** 修改 `src/state.js`、`src/battle.js`、`src/main.js`；创建 `test/background-battle.test.mjs`。

- [ ] **步骤 1：写失败测试**

覆盖自动选球、无球逃跑、捕获入库、图鉴/统计/遭遇日志更新，以及相同 `settledAt` 不重复扣球。测试通过依赖注入调用后台 resolver，不启动动画或读取 DOM。

- [ ] **步骤 2：运行测试确认失败**

运行：`node --test test/background-battle.test.mjs`

预期：后台结算入口未定义而失败。

- [ ] **步骤 3：实现后台入口**

在 `battle.js` 中抽取 `resolveBackgroundEncounter()`，复用 `pickAutoBallType`、捕获率、逃跑率、性别、变体、个体值、日志和 `saveGame` 使用的记录逻辑；该函数不得调用 `playCatchSequence`、`showView` 或音频函数。

在 `state.js` 的会话状态中增加 `backgroundModeEnabled`、`backgroundStartedAt`、`backgroundSettledAt`、`backgroundStats`、`backgroundLastResult`，旧存档缺失时按关闭处理。`main.js` 在前台恢复和 bridge 心跳时串行调用 `settleBackgroundSlice`，结算成功后刷新背包、统计和最近结果文案。

- [ ] **步骤 4：运行测试确认通过**

运行：`node --test test/background-*.test.mjs`

预期：后台业务测试全部 PASS，且不产生 DOM 动画调用。

- [ ] **步骤 5：提交**

```bash
git add src/state.js src/battle.js src/main.js test/background-battle.test.mjs
git commit -m "feat(后台): 接入自动遇敌与抓捕结算"
```

### 任务 3：实现 Capacitor bridge 控制面

**文件：** 创建 `mobile/background-mode.mjs`；修改 `mobile/bridge-source.js`；创建 `test/mobile-background-contract.test.mjs`。

- [ ] **步骤 1：写失败契约测试**

断言 bridge 暴露 `startBackgroundMode`、`stopBackgroundMode`、`isBackgroundModeSupported` 和 `onBackgroundTick`，且桌面/浏览器空实现不抛异常。

- [ ] **步骤 2：运行失败测试**

运行：`node --test test/mobile-background-contract.test.mjs`

预期：接口字符串和模块不存在而失败。

- [ ] **步骤 3：实现 bridge**

在 `background-mode.mjs` 中封装 `Capacitor.Plugins.PokeIdleBackground` 调用；不可用时返回 `false` 或 `null`。bridge 在 `appStateChange` 非活动时保存时间戳并请求启动服务，活动时先触发一次前台结算；原生事件只传 `{ now }`，由 `main.js` 触发串行结算。

- [ ] **步骤 4：运行测试确认通过**

运行：`node --test test/mobile-background-contract.test.mjs test/mobile-build-web.test.mjs`

预期：契约和移动端资源测试全部 PASS。

- [ ] **步骤 5：提交**

```bash
git add mobile/background-mode.mjs mobile/bridge-source.js test/mobile-background-contract.test.mjs
git commit -m "feat(Android): 接入后台挂机 bridge 控制面"
```

### 任务 4：实现 Android 前台服务和通知

**文件：** 创建 `android/app/src/main/java/com/pokemon/idle/PokeIdleBackgroundPlugin.java`、`PokeIdleBackgroundService.java`；修改 `MainActivity.java`、`AndroidManifest.xml`、`android/app/build.gradle`。

- [ ] **步骤 1：先添加静态契约测试**

在 `test/mobile-background-contract.test.mjs` 断言 Java 文件包含 `startForeground`、通知停止 action、`START_NOT_STICKY`、`POST_NOTIFICATIONS` 兼容判断和服务声明。

- [ ] **步骤 2：运行失败测试**

运行：`node --test test/mobile-background-contract.test.mjs`

预期：原生类和声明不存在而失败。

- [ ] **步骤 3：实现原生组件**

插件提供 `start`、`stop`、`isSupported`，服务创建 notification channel，调用 `startForeground`，使用 `Handler` 按固定心跳发送 `backgroundTick` 事件，通知 action 发送停止命令并停止自身。心跳属于尽力触发：锁屏或 WebView 被暂停时允许事件延迟，由前台恢复时的时间戳结算补齐，正确性不得依赖心跳准时执行。`MainActivity` 注册插件；Manifest 声明 `FOREGROUND_SERVICE`、Android 13+ 通知权限和 service 节点，Android 14 使用 `dataSync` 类型；不申请公共存储权限。

- [ ] **步骤 4：运行 Android 编译验证**

运行：`npm run android:build`

预期：`BUILD SUCCESSFUL`，release APK 生成到 `dist/android/`。若当前 shell 未设置 JDK 21，先使用项目约定的 `JAVA_HOME` 配置，不修改构建脚本绕过版本检查。

- [ ] **步骤 5：提交**

```bash
git add android/app/src/main android/app/build.gradle test/mobile-background-contract.test.mjs
git commit -m "feat(Android): 添加后台挂机前台服务"
```

### 任务 5：修复捕捉动画布局生命周期

**文件：** 修改 `src/animation.js`、`src/ui.js`；创建 `test/catch-layout-contract.test.mjs`。

- [ ] **步骤 1：写失败测试**

静态测试要求 `setupCatchAnim` 保存 `encounterView`/`catchStage` 样式，`restoreCatchAnim` 清理或恢复 `position`、`left`、`top`、`width`、`height`，并在 `finally` 路径调用恢复；舞台缓存测试要求宽高变化会重新测量。

- [ ] **步骤 2：运行失败测试**

运行：`node --test test/catch-layout-contract.test.mjs`

预期：现有实现因未恢复容器样式和永久缓存而失败。

- [ ] **步骤 3：实现最小修复**

增加容器样式快照和幂等恢复辅助函数；`playCatchSequence` 用 `try/finally` 包住抛球、吸收、摇晃、挣脱和成功收尾；异常时也移回球节点并恢复容器。`getStageSize()` 将缓存键改为当前 `screenInner` 宽高，新增显式失效函数；移动 bridge 在 `resize` 和 `visualViewport.resize` 后调用失效函数。

- [ ] **步骤 4：运行布局与现有测试**

运行：`node --test test/catch-layout-contract.test.mjs test/mobile-*.test.mjs test/trade-gender.test.mjs`

预期：全部 PASS。

- [ ] **步骤 5：提交**

```bash
git add src/animation.js src/ui.js mobile/bridge-source.js test/catch-layout-contract.test.mjs
git commit -m "fix(战斗): 恢复捕捉动画舞台布局"
```

### 任务 6：前台设置、通知状态和真机验收

**文件：** 修改 `src/views.js`、`src/styles.css`、`README.md`、`update_log.md`；必要时修改 `src/main.js`。

- [ ] **步骤 1：添加 UI 测试/契约**

验证设置页显示后台挂机开关、运行状态和停止入口；桌面端显示不支持提示，Android 端显示常驻通知和耗电说明。

- [ ] **步骤 2：实现 UI 与状态同步**

开关开启顺序为保存时间戳、请求原生服务、成功后写入 `backgroundModeEnabled`；启动失败回滚开关。返回前台先结算再刷新统计。通知停止动作通过 bridge 关闭开关并保存。

- [ ] **步骤 3：运行完整测试**

运行：`npm test`（若项目未定义则运行 `npm run test:mobile` 和 `node --test test/*.test.mjs`）。

预期：所有测试 PASS。

- [ ] **步骤 4：构建并安装 Debug APK**

运行：`npm run android:debug`，再使用 `adb install -r` 安装；验证 Android 8、Android 13/14 的通知权限和服务启动/停止。

- [ ] **步骤 5：真机验收**

开启自动捕捉和后台挂机，锁屏 5 分钟，解锁检查球库存、捕获/逃跑统计、日志和最近结果；从后台切回战斗页连续扔球，确认整个画面不偏移；改变系统导航栏/安全区后再次扔球，确认舞台与文字框对齐。

- [ ] **步骤 6：生成正式 release APK**

运行：`npm run android:build`。

预期：`BUILD SUCCESSFUL`，输出 `dist/android/pokeidle-android-v<version>.apk` 及对应 `.sha256`。

- [ ] **步骤 7：提交发布说明**

```bash
git add src/views.js src/styles.css src/main.js README.md update_log.md
git commit -m "feat(Android): 发布后台挂机与战斗布局修复"
```

## 计划自检

- 规格中的后台服务、通知权限、时间戳结算、幂等、进程重启补算、错误边界分别由任务 2、3、4、6 覆盖。
- 规格中的捕捉容器恢复、尺寸缓存失效、异常路径和回归测试由任务 5 覆盖。
- 所有任务均给出具体文件、测试命令和提交边界，没有占位章节或无定义的接口名称。
- Android 原生服务不直接修改游戏数据，后台规则仍由 JavaScript 结算模块维护，避免双重业务实现。
