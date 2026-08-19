# 手机对战操作区布局修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复 Android 手机模式下 NPC 对战操作按钮重叠、技能按钮超出掌机画面的问题。

**架构：** 保留现有战斗 DOM、操作逻辑和桌面端 `56px` 底栏，只在 `html.mobile-mode` 下将战斗底栏覆盖为 `92px`。使用 Node.js 源码契约测试锁定移动端触控高度与底栏高度关系，防止全局按钮样式再次破坏战斗布局。

**技术栈：** 原生 CSS、原生 ES 模块、Node.js 内置 `node:test`、Capacitor Android 构建链。

---

## 文件清单与职责

- 创建：`test/mobile-battle-controls.test.mjs`，验证桌面和手机战斗底栏的高度契约及两种操作状态的结构。
- 修改：`src/styles.css:6162`，增加手机模式专用的战斗底栏高度覆盖。
- 生成但不提交：`mobile/web/`，验证 Android Web 资源包含修复后的样式。
- 生成但不提交：`dist/android/pokeidle-android-v1.0.12.apk` 及对应 SHA-256 文件。

### 任务 1：建立手机战斗底栏回归契约

**文件：**
- 创建：`test/mobile-battle-controls.test.mjs`
- 参考：`src/styles.css:71-84`
- 参考：`src/styles.css:6162-6435`
- 参考：`src/battle-view.js:1877-1965`

- [ ] **步骤 1：编写失败测试**

创建 `test/mobile-battle-controls.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesSource = () => readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const battleSource = () => readFile(new URL('../src/battle-view.js', import.meta.url), 'utf8');

test('手机战斗底栏覆盖桌面高度并容纳两行触控按钮', async () => {
  const styles = await stylesSource();
  const desktop = styles.match(/\.b-bottom\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';
  const mobile = styles.match(/html\.mobile-mode \.b-bottom\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';

  assert.match(desktop, /height:\s*56px/);
  assert.match(styles, /html\.mobile-mode button,[\s\S]*?\{\s*min-height:\s*34px/);
  assert.match(mobile, /height:\s*92px/);

  const mobileHeight = Number(mobile.match(/height:\s*(\d+)px/)?.[1]);
  const requiredHeight = 2 + 6 + (34 * 2) + 1 + 2 + 10;
  assert.ok(mobileHeight >= requiredHeight);
});

test('操作态和选招态继续使用两行布局', async () => {
  const [styles, battle] = await Promise.all([stylesSource(), battleSource()]);

  assert.match(styles, /\.b-cmd\s*\{[^}]*grid-template-rows:\s*1fr 1fr/s);
  assert.match(styles, /\.b-actions\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(battle, /id="act-fight">攻击<\/button>/);
  assert.match(battle, /id="act-pkm">替换<\/button>/);
  assert.match(battle, /id="act-auto">自动<\/button>/);
  assert.match(battle, /actions\.className = 'b-actions detail'/);
  assert.match(battle, /class="b-move[^"$]*\$\{dis\}"/);
});
```

- [ ] **步骤 2：运行测试并确认红灯**

运行：

```bash
node --test test/mobile-battle-controls.test.mjs
```

预期：第 1 个测试失败，错误指出手机模式 `.b-bottom` 中未找到 `height: 92px`；第 2 个结构测试通过。失败原因必须是移动端高度覆盖尚未实现，而不是测试语法或文件路径错误。

### 任务 2：实施最小移动端 CSS 修复

**文件：**
- 修改：`src/styles.css:6162-6172`
- 测试：`test/mobile-battle-controls.test.mjs`

- [ ] **步骤 1：增加手机模式高度覆盖**

在基础 `.b-bottom` 规则之后添加：

```css
html.mobile-mode .b-bottom {
  height: 92px;
}
```

不要修改基础 `.b-bottom` 的 `56px`，不要降低全局移动端按钮的 `34px` 最小高度，也不要改变 `.b-left`、`.b-right`、`.b-cmd`、`.b-actions` 或战斗 JavaScript。

- [ ] **步骤 2：运行测试并确认绿灯**

运行：

```bash
node --test test/mobile-battle-controls.test.mjs
```

预期：2 个测试全部通过，无警告和错误。

- [ ] **步骤 3：检查本任务差异**

运行：

```bash
git diff --check -- src/styles.css test/mobile-battle-controls.test.mjs
git diff -- src/styles.css test/mobile-battle-controls.test.mjs
```

预期：只有一条移动端 CSS 覆盖和新增测试，不包含战斗逻辑或其他页面样式改动。

### 任务 3：运行完整回归并提交修复

**文件：**
- 验证：`src/styles.css`
- 验证：`test/mobile-battle-controls.test.mjs`
- 生成但不提交：`mobile/web/`

- [ ] **步骤 1：运行移动端和完整 Node.js 测试**

运行：

```bash
npm run test:mobile
node --test test/*.test.mjs
```

预期：所有测试通过；不得出现失败、取消或意外跳过的测试。

- [ ] **步骤 2：生成 Android Web 资源并检查样式**

运行：

```bash
node mobile/build-web.mjs
rg -n "html\.mobile-mode \.b-bottom" mobile/web/styles.css
```

预期：Web 资源构建成功，`mobile/web/styles.css` 包含手机战斗底栏覆盖规则。

- [ ] **步骤 3：检查工作区范围**

运行：

```bash
git diff --check
git status --short
git diff --stat
```

预期：本次实现只新增 `test/mobile-battle-controls.test.mjs` 并修改 `src/styles.css`；保留用户已有的 `src/save-platform.js` 和 `.superpowers/` 改动，不暂存 `mobile/web/` 或 `dist/android/`。

- [ ] **步骤 4：提交修复**

运行：

```bash
git add src/styles.css test/mobile-battle-controls.test.mjs
git commit -m "fix(对战): 修复手机操作按钮溢出"
```

预期：提交只包含 CSS 修复和回归测试。

### 任务 4：生成并校验正式签名 APK

**文件：**
- 生成但不提交：`dist/android/pokeidle-android-v1.0.12.apk`
- 生成但不提交：`dist/android/pokeidle-android-v1.0.12.apk.sha256`

- [ ] **步骤 1：构建 release APK**

运行：

```bash
npm run android:build
```

预期：Gradle 输出 `BUILD SUCCESSFUL`，构建脚本输出 APK 和 SHA-256 文件的绝对路径。

- [ ] **步骤 2：验证文件校验值和签名**

运行：

```bash
shasum -a 256 -c dist/android/pokeidle-android-v1.0.12.apk.sha256
jarsigner -verify -verbose -certs dist/android/pokeidle-android-v1.0.12.apk
```

预期：SHA-256 检查输出 `OK`，`jarsigner` 退出码为 `0` 并报告 JAR/APK 已验证。

- [ ] **步骤 3：真机验收**

在 Android 手机上安装 APK，进入「手机」→「对战」并开始 NPC 战斗：

1. 检查「攻击」「替换」「自动」互不覆盖并可点击。
2. 点击「攻击」，检查 4 个技能按钮全部位于掌机画面内。
3. 点击技能、返回、替换和自动，确认交互功能正常。
4. 完成一场战斗，确认上方宝可梦、血条和动画未出现新增裁切。

- [ ] **步骤 4：确认最终 Git 状态**

运行：

```bash
git status --short --branch
```

预期：源码修复已提交；只保留任务开始前已有的 `src/save-platform.js` 和 `.superpowers/` 用户改动，APK 产物不进入 Git。
