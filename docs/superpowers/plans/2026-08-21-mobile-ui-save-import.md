# 手机主页与存档导入优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans`（当前会话内联执行）。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 合并可审查的 upstream 修复，优化手机主页触控布局，增加道具栏手势翻页，并修复 Android 导入存档的持久化与反馈问题。

**架构：** 手机主页继续由 `APPS` 单一数组渲染，改为固定 `5 × 4` 网格；背包继续复用现有两页 DOM，只在现有翻页控制旁增加 pointer 手势判定。存档导入保持“备份 → 应用 → 持久化 → 刷新”事务顺序，将 Android 主文件写入作为必需来源，备用来源错误只记录并显示提示。

**技术栈：** 原生 ES modules、CSS Grid、Pointer Events、Capacitor Filesystem、Node.js `node:test`。

---

### 任务 0：收拢上一轮道路坐标修复

**文件：**
- 修改：`src/ui.js`、`src/items.js`、`src/battle.js`、`src/events.js`、`src/follower.js`
- 创建：`test/road-coordinate-contract.test.mjs`
- 创建：`docs/superpowers/plans/2026-08-19-road-coordinate-fix.md`
- 保护：`src/save-platform.js`、`.superpowers/`

- [ ] **步骤 1：重新验证道路坐标修复**

运行：

```bash
node --test test/road-coordinate-contract.test.mjs
npm run test:mobile
node --test test/*.test.mjs
git diff --check
```

预期：道路契约、移动端测试和完整测试全部通过；`git diff --check` 无输出。

- [ ] **步骤 2：只暂存道路修复文件**

```bash
git add src/ui.js src/items.js src/battle.js src/events.js src/follower.js test/road-coordinate-contract.test.mjs docs/superpowers/plans/2026-08-19-road-coordinate-fix.md
git diff --cached --stat
```

预期：暂存区不包含 `src/save-platform.js` 或 `.superpowers/`。

- [ ] **步骤 3：提交道路坐标修复**

```bash
git commit -m "fix(道路): 修复手机缩放下实体坐标偏移"
```

预期：道路修复形成独立提交，用户的 `src/save-platform.js` 和 `.superpowers/` 仍保留在工作区。

### 任务 1：同步并审查 upstream fork

**文件：**
- Git 引用：`upstream/main`
- 保护：`src/save-platform.js`、`src/battle.js`、`src/events.js`、`src/follower.js`、`src/items.js`、`src/ui.js`、`.superpowers/`

- [ ] **步骤 1：记录工作区与远程状态**

运行：

```bash
git status --short --branch
git log --oneline --decorate -8
git remote -v
```

预期：确认当前为 `feature/save-transfer`，记录用户未提交文件，不做覆盖操作。

- [ ] **步骤 2：拉取 upstream 引用**

运行：`git fetch upstream --prune`

预期：成功更新 `upstream/main`；若外部审核服务返回 503，停止此任务并报告阻塞，不使用替代命令绕过。

- [ ] **步骤 3：检查待合并提交与文件**

运行：

```bash
git log --oneline HEAD..upstream/main
git diff --stat HEAD..upstream/main
git diff --name-only HEAD..upstream/main
```

预期：列出每个 upstream 提交和影响文件；如果提交涉及受保护文件，逐段审查后再合并。

- [ ] **步骤 4：执行不自动提交的合并**

运行：`git merge --no-commit --no-ff upstream/main`

预期：无冲突则停在合并待提交状态；有冲突时只解决 upstream 与当前目标相关的冲突，保留受保护文件中的当前实现。

- [ ] **步骤 5：验证合并结果并提交**

运行：`git diff --check && git status --short`

提交：

运行 `git status --short` 确认合并暂存区只包含 upstream 合并结果，然后执行：

```bash
git commit -m "chore(上游): 合并 fork 最新修复"
```

预期：提交只包含审查后的 upstream 内容，不包含本次功能实现或用户本地改动。

### 任务 2：为手机主页网格和道具栏手势编写失败测试

**文件：**
- 创建：`test/mobile-phone-ui-contract.test.mjs`
- 参考：`src/phone.js`、`src/styles.css`、`src/main.js`

- [ ] **步骤 1：编写静态网格契约和手势行为测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('手机主页使用 5 列 4 行并保留 18 个应用', () => {
  const js = fs.readFileSync('src/phone.js', 'utf8');
  const css = fs.readFileSync('src/styles.css', 'utf8');
  assert.equal((js.match(/\{ id: '/g) || []).length, 18);
  assert.match(css, /\.phone-page\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,/);
  assert.match(css, /\.phone-page\s*\{[\s\S]*?grid-template-rows:\s*repeat\(4,/);
  assert.match(css, /\.phone-page\s*\{[\s\S]*?gap:\s*(?!0)/);
});

test('背包绑定 pointer 手势且短按不切页', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  assert.match(source, /backpackEl\.addEventListener\(['"]pointerdown['"]/);
  assert.match(source, /backpackEl\.addEventListener\(['"]pointerup['"]/);
  assert.match(source, /Math\.abs\(dx\)\s*<=\s*Math\.abs\(dy\)/);
  assert.match(source, /Math\.abs\(dx\).*?backpackEl\.clientWidth/);
});
```

- [ ] **步骤 2：运行测试确认红灯**

运行：`node --test test/mobile-phone-ui-contract.test.mjs`

预期：失败，当前 CSS 为 6×3，`main.js` 没有 pointerdown/pointerup 手势。

### 任务 3：实现主页舒适网格和道具栏左右滑动

**文件：**
- 修改：`src/styles.css:1719-1728`
- 修改：`src/main.js:1067-1092`

- [ ] **步骤 1：实现 5×4 舒适网格**

将 `.phone-page` 改为：

```css
.phone-page {
  height: 100%;
  width: 100%;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(0, 1fr));
  gap: 10px 7px;
  justify-items: center;
  align-content: center;
  padding: 5px 8px 7px;
}
```

保持 `.phone-app-icon` 现有尺寸，不扩大图标；增加 `.phone-app-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }`，避免长名称出界。

- [ ] **步骤 2：实现 pointer 手势翻页**

在现有 `wheel` 绑定前加入：

```js
    let swipeStart = null;
    backpackEl.style.touchAction = 'pan-y';
    backpackEl.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      swipeStart = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId };
      backpackEl.setPointerCapture?.(event.pointerId);
    });
    backpackEl.addEventListener('pointerup', event => {
      if (!swipeStart || event.pointerId !== swipeStart.id) return;
      const { x, y, time } = swipeStart;
      swipeStart = null;
      const dx = event.clientX - x;
      const dy = event.clientY - y;
      const duration = Math.max(1, performance.now() - time);
      const width = backpackEl.clientWidth || 1;
      const horizontal = Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) >= width * 0.25 || Math.abs(dx) / duration >= 0.45);
      if (!horizontal) return;
      if (dx < 0 && _bagPage < 2) showBagPage(2);
      else if (dx > 0 && _bagPage > 1) showBagPage(1);
    });
    backpackEl.addEventListener('pointercancel', () => { swipeStart = null; });
```

保持现有 wheel、页码点击和槽位 click 不变。

- [ ] **步骤 3：运行针对性测试**

运行：`node --test test/mobile-phone-ui-contract.test.mjs`

预期：网格和手势契约全部通过。

- [ ] **步骤 4：提交 UI 改动**

```bash
git add src/phone.js src/styles.css src/main.js test/mobile-phone-ui-contract.test.mjs
git commit -m "feat(手机): 优化主页间距并支持道具栏滑动翻页"
```

### 任务 4：为 Android 导入事务和手机提示编写失败测试

**文件：**
- 修改：`test/mobile-save-persistence.test.mjs`
- 修改：`test/mobile-save-transaction.test.mjs`
- 创建：`test/mobile-save-feedback-contract.test.mjs`

- [ ] **步骤 1：添加备用来源失败仍成功的测试**

```js
test('Android 主存档成功时备用来源失败不回滚导入', async () => {
  const writes = [];
  const result = await persistSerializedSave('{"items":{"candy":9}}', {
    mobile: { saveGameData: async data => writes.push(['mobile', data]) },
    storage: { setItem: () => { throw new Error('storage blocked'); } },
    strict: true,
    requiredSource: 'mobile',
  });
  assert.equal(result.written, 1);
  assert.deepEqual(writes.map(([source]) => source), ['mobile']);
  assert.equal(result.warnings.length, 1);
});
```

- [ ] **步骤 2：添加手机提示契约测试**

```js
test('设置页提供存档操作提示区域', () => {
  const source = fs.readFileSync('src/views.js', 'utf8');
  assert.match(source, /saveTransferStatus/);
  assert.match(source, /aria-live=["']polite["']/);
});
```

- [ ] **步骤 3：运行测试确认红灯**

运行：`node --test test/mobile-save-persistence.test.mjs test/mobile-save-transaction.test.mjs test/mobile-save-feedback-contract.test.mjs`

预期：备用来源参数和设置页提示区域尚未实现，测试失败。

### 任务 5：实现 Android 导入必需写入与设置页反馈

**文件：**
- 修改：`src/save-persistence.js`
- 修改：`src/state.js`
- 修改：`src/save-transfer-controller.js`
- 修改：`src/views.js`
- 修改：`src/styles.css`
- 修改：`mobile/bridge-source.js`
- 修改：相关测试文件

- [ ] **步骤 1：扩展持久化函数的来源策略**

将 `persistSerializedSave` 增加 `requiredSource` 参数，返回 `{ errors, warnings, written }`。Android 主写入失败时抛出稳定错误，备用来源失败写入 `warnings`，不触发导入回滚；普通保存保持当前 strict 行为。

扩展 `src/state.js:saveGame`：

```js
export async function saveGame({
  strict = false,
  preserveTimestamp = false,
  requiredSource = null,
} = {}) {
  // 现有序列化逻辑保持不变，将 requiredSource 传给 persistSerializedSave。
}
```

- [ ] **步骤 2：保留导入事务回滚边界**

`replaceSaveWithBackup` 在主存档必需写入失败时执行 `apply(original)` 和原存档持久化；备用来源失败只将 warnings 返回给控制器。

- [ ] **步骤 3：增加设置页状态提示**

在设置页角色与存档组增加：

```html
<div id="saveTransferStatus" class="save-transfer-status" aria-live="polite" role="status"></div>
```

将 `showMessage` 改为同时更新该元素和必要时的 `updateTextBox`。

- [ ] **步骤 4：使用安全刷新入口**

在 `src/views.js` 为导入事务传入：

```js
persist: () => saveGame({
  strict: true,
  preserveTimestamp: true,
  requiredSource: window.__POKEIDLE_MOBILE__?.saveGameData ? 'mobile' : null,
}),
```

同时传入移动端安全 reload 函数；在 `mobile/bridge-source.js` 暴露 `window.__POKEIDLE_MOBILE_RELOAD__`，优先刷新页面，失败时调用 `App.exitApp()`。

- [ ] **步骤 5：运行导入针对性测试**

运行：`node --test test/mobile-save-persistence.test.mjs test/mobile-save-transaction.test.mjs test/mobile-save-feedback-contract.test.mjs`

预期：全部通过。

- [ ] **步骤 6：提交存档修复**

```bash
git add src/save-persistence.js src/state.js src/save-transfer-controller.js src/views.js src/styles.css mobile/bridge-source.js test/mobile-save-persistence.test.mjs test/mobile-save-transaction.test.mjs test/mobile-save-feedback-contract.test.mjs
git commit -m "fix(存档): 修复 Android 导入持久化和手机提示"
```

### 任务 6：完整回归与 Android 验收

**文件：**
- 生成：`mobile/web`
- 生成：`dist/android/pokeidle-android-v1.0.13.apk`
- 生成：`dist/android/pokeidle-android-v1.0.13.apk.sha256`

- [ ] **步骤 1：运行完整测试**

```bash
npm run test:mobile
node --test test/*.test.mjs
```

预期：全部测试通过。

- [ ] **步骤 2：构建 Web 资源**

运行：`node mobile/build-web.mjs`

预期：`mobile/web` 包含主页 5×4 网格、道具栏 pointer 处理和导入状态提示。

- [ ] **步骤 3：构建正式 APK**

```bash
env JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
PATH=/opt/homebrew/opt/openjdk@21/bin:/opt/homebrew/bin:/usr/local/bin:/Users/nayo/.nvm/versions/node/v25.5.0/bin:/usr/bin:/bin:/usr/sbin:/sbin \
npm run android:build
```

预期：`BUILD SUCCESSFUL`，输出 release APK 和 SHA-256 文件。

- [ ] **步骤 4：校验 APK**

```bash
cd dist/android
shasum -a 256 -c pokeidle-android-v1.0.13.apk.sha256
/Users/nayo/Library/Android/sdk/build-tools/35.0.0/apksigner verify --verbose --print-certs pokeidle-android-v1.0.13.apk
```

预期：哈希显示 `OK`，签名校验报告 v2/v3 有效。
