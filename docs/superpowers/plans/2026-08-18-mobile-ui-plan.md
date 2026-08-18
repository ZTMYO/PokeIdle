# Android 移动端自适应 UI 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框跟踪进度。

**目标：** 让 Android 端在安全区内利用完整竖屏高度，保留掌机风格并改善触控、滚动和弹层操作；桌面端布局保持不变。

**架构：** 视口工具提供 `scale` 与动态设计高度，移动桥接层将其写入 CSS 变量。移动端 CSS 只在 `.mobile-mode` 下改变外壳高度、页面滚动和触控尺寸；游戏业务、存档结构和桌面样式不改。

**技术栈：** 原生 JavaScript ES modules、CSS、Node.js `node:test`、Capacitor Android、Gradle JDK 21。

---

### 任务 1：扩展移动端视口计算

**文件：**
- 修改：`mobile/viewport-utils.mjs`
- 测试：`test/mobile-viewport-utils.test.mjs`

- [ ] **步骤 1：编写失败的测试**

新增 `calculateMobileLayout(width, height, insets)` 测试：

```js
test('竖屏设备返回按缩放反算的动态设计高度', () => {
  assert.deepEqual(calculateMobileLayout(360, 800), {
    scale: 360 / 274,
    designHeight: 800 / (360 / 274),
  });
});

test('矮屏设备动态高度不小于基础高度', () => {
  assert.deepEqual(calculateMobileLayout(360, 400, { top: 20, bottom: 20 }), {
    scale: 360 / 342,
    designHeight: 342,
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/mobile-viewport-utils.test.mjs`

预期：新增测试因 `calculateMobileLayout` 尚未导出而失败，现有缩放测试继续通过。

- [ ] **步骤 3：实现最少计算逻辑**

在 `mobile/viewport-utils.mjs` 导出 `calculateMobileLayout`：

```js
export function calculateMobileLayout(width, height, insets = {}) {
  const availableWidth = Number(width) - (Number(insets.left) || 0) - (Number(insets.right) || 0);
  const availableHeight = Number(height) - (Number(insets.top) || 0) - (Number(insets.bottom) || 0);
  if (availableWidth <= 0 || availableHeight <= 0) return { scale: 1, designHeight: DESIGN_HEIGHT };
  const scale = Math.min(availableWidth / DESIGN_WIDTH, availableHeight / DESIGN_HEIGHT);
  return { scale, designHeight: Math.max(DESIGN_HEIGHT, availableHeight / scale) };
}
```

保留 `calculateMobileScale`，让现有调用方和旧测试继续兼容，并让它返回 `calculateMobileLayout(...).scale`。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/mobile-viewport-utils.test.mjs`

预期：所有视口测试通过。

- [ ] **步骤 5：Commit**

```bash
git add mobile/viewport-utils.mjs test/mobile-viewport-utils.test.mjs
git commit -m "feat(移动端): 增加动态竖屏高度计算"
```

### 任务 2：把动态布局传给移动桥接层

**文件：**
- 修改：`mobile/bridge-source.js`
- 测试：`test/mobile-viewport-utils.test.mjs`、`test/mobile-build-web.test.mjs`

- [ ] **步骤 1：编写失败的桥接契约测试**

读取 `mobile/bridge-source.js`，断言它导入 `calculateMobileLayout`，并同时写入 `--mobile-scale` 与 `--mobile-layout-height`。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:mobile`

预期：桥接契约断言失败，现有测试保持通过。

- [ ] **步骤 3：实现桥接变量同步**

将导入和同步逻辑改为：

```js
import { calculateMobileLayout } from './viewport-utils.mjs';
const { scale, designHeight } = calculateMobileLayout(width, height, insets);
const root = document.documentElement;
root.style.setProperty('--mobile-scale', String(scale));
root.style.setProperty('--mobile-layout-height', `${designHeight}px`);
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run test:mobile`

预期：桥接、构建 Web 和所有现有移动端测试通过。

- [ ] **步骤 5：Commit**

```bash
git add mobile/bridge-source.js test/mobile-viewport-utils.test.mjs test/mobile-build-web.test.mjs
git commit -m "feat(移动端): 同步动态掌机高度变量"
```

### 任务 3：实现移动端自适应外壳和页面滚动

**文件：**
- 修改：`src/styles.css`
- 测试：`test/mobile-build-web.test.mjs`

- [ ] **步骤 1：编写失败的样式契约测试**

断言 `src/styles.css` 在 `.mobile-mode .console` 中使用 `var(--mobile-layout-height, 342px)`，并包含移动端独立滚动和固定底栏规则。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:mobile`

预期：新增 CSS 契约失败。

- [ ] **步骤 3：实现移动端 CSS**

在现有移动规则中加入：

```css
html.mobile-mode .console {
  width: 274px;
  height: var(--mobile-layout-height, 342px);
  max-height: none;
  transform: scale(var(--mobile-scale, 1));
}
html.mobile-mode .screen-wrapper { min-height: 0; }
html.mobile-mode .view-scroll,
html.mobile-mode .view-fixed,
html.mobile-mode .rec-view { min-height: 0; }
html.mobile-mode .backpack-bar,
html.mobile-mode .stats-bar { flex-shrink: 0; }
html.mobile-mode button,
html.mobile-mode .bag-slot,
html.mobile-mode [role="button"] { min-height: 34px; }
```

保留桌面选择器原值；只为移动端增加滚动边界、固定栏和触控尺寸，不重写页面业务结构。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run test:mobile`

预期：CSS 契约和全部现有测试通过。

- [ ] **步骤 5：Commit**

```bash
git add src/styles.css test/mobile-build-web.test.mjs
git commit -m "feat(移动端): 使用动态高度铺满竖屏"
```

### 任务 4：优化移动端确认弹层与返回键

**文件：**
- 修改：`src/styles.css`、`src/main.js`、`src/save-transfer-controller.js`
- 测试：`test/mobile-save-transaction.test.mjs`、`test/mobile-save-platform.test.mjs`

- [ ] **步骤 1：编写失败的移动端弹层契约测试**

增加断言：弹层移动端规则包含底部布局、固定操作区、最小触控高度；返回入口在弹层可见时先隐藏并返回 `true`。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/mobile-save-transaction.test.mjs test/mobile-save-platform.test.mjs`

预期：新增弹层和返回契约失败。

- [ ] **步骤 3：实现最少交互与样式**

为 `showSaveTransferDialog` 提供可检查的打开状态，并在移动返回处理入口优先调用取消；CSS 使用移动端底部弹层和 `min-height: 44px` 操作按钮。保持 `pointerup`、`touchend`、`click` 三种激活事件。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/mobile-save-transaction.test.mjs test/mobile-save-platform.test.mjs`

预期：存档弹层和返回键测试通过。

- [ ] **步骤 5：Commit**

```bash
git add src/styles.css src/main.js src/save-transfer-controller.js test/mobile-save-transaction.test.mjs test/mobile-save-platform.test.mjs
git commit -m "fix(移动端): 优化确认弹层和返回键层级"
```

### 任务 5：全量验证与 Android 构建

**文件：**
- 修改：无新增业务文件；构建生成 `mobile/web` 和 `dist/android`
- 测试：`test/mobile-*.test.mjs`

- [ ] **步骤 1：运行全量测试**

运行：`npm run test:mobile`

预期：所有测试通过，包含视口、桥接、CSS、弹层和存档事务回归。

- [ ] **步骤 2：检查差异**

运行：`git diff --check && git status --short --branch`

预期：无空白错误；只包含本次移动端 UI 实现和既有未提交改动。

- [ ] **步骤 3：构建正式 APK**

运行：

```bash
JDK21_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home" \
JAVA_HOME="$JDK21_HOME" \
PATH="$JDK21_HOME/bin:$PATH" \
npm run android:build
```

预期：生成当前版本的 release APK 和 `.sha256` 文件。

- [ ] **步骤 4：验证 APK 产物**

运行：

```bash
shasum -a 256 -c dist/android/pokeidle-android-v1.0.11.apk.sha256
jarsigner -verify dist/android/pokeidle-android-v1.0.11.apk
```

预期：SHA-256 输出 `OK`，`jarsigner` 退出码为 `0` 并报告 APK 已验证。

- [ ] **步骤 5：Commit**

```bash
git add mobile/viewport-utils.mjs mobile/bridge-source.js src/styles.css src/main.js src/save-transfer-controller.js test/mobile-viewport-utils.test.mjs test/mobile-build-web.test.mjs test/mobile-save-transaction.test.mjs test/mobile-save-platform.test.mjs package.json package-lock.json android/app/build.gradle src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "feat(移动端): 完成竖屏游玩体验优化"
```
