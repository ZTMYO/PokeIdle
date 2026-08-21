# 手机道路实体坐标修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans`（当前会话内联执行）。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复 Android 手机模式 CSS 缩放导致道路道具、遇敌图标、事件图标和随从坐标被放大并裁剪的问题，同时保持桌面端行为不变。

**架构：** 在 `src/ui.js` 提供以 `#screen` 为原点的布局坐标快照，将 `clientWidth/clientHeight` 与物理矩形缩放比例统一封装。道路实体只读取该快照，不再直接把 transform 后的矩形差值写入内部 CSS 坐标；无效布局返回 `null` 并等待现有动画帧重试。

**技术栈：** 原生 ES modules、浏览器 DOM/CSS、Node.js `node:test` 静态契约测试、现有移动端构建脚本。

---

### 任务 1：建立坐标换算失败测试

**文件：**
- 创建：`test/road-coordinate-contract.test.mjs`
- 参考：`src/ui.js`、`src/items.js`、`src/battle.js`、`src/events.js`、`src/follower.js`

- [ ] **步骤 1：编写失败的测试**

测试读取 `src/ui.js` 的导出函数，验证 `clientWidth/clientHeight`、缩放比例还原和无效布局返回 `null`；同时检查四个调用模块引用 `getScreenLayoutMetrics`，且道路坐标代码不再直接使用 `screen.getBoundingClientRect()`。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('按 CSS transform 比例把物理矩形还原为 screen 内部坐标', async () => {
  const source = fs.readFileSync('src/ui.js', 'utf8');
  const match = source.match(/export function getScreenLayoutMetrics\(\)[\s\S]*?\n}\n/);
  assert.ok(match, 'ui.js 应导出 getScreenLayoutMetrics');
  const body = match[0].replace(/^export /, '');
  const context = {
    document: {
      querySelector(selector) {
        if (selector !== '#screen') return null;
        return {
          clientWidth: 400,
          clientHeight: 240,
          getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 480 }),
        };
      },
    },
  };
  vm.runInNewContext(`(${body})`, context);
  const metrics = vm.runInNewContext(`getScreenLayoutMetrics()`, context);
  assert.equal(metrics.width, 400);
  assert.equal(metrics.height, 240);
  assert.deepEqual(metrics.rect({ getBoundingClientRect: () => ({ left: 300, top: 170, width: 80, height: 40 }) }), {
    left: 100,
    top: 60,
    width: 40,
    height: 20,
  });
});

test('无效 screen 布局返回 null，不产生零坐标', () => {
  const source = fs.readFileSync('src/ui.js', 'utf8');
  const match = source.match(/export function getScreenLayoutMetrics\(\)[\s\S]*?\n}\n/);
  assert.ok(match);
  const context = { document: { querySelector: () => ({ clientWidth: 0, clientHeight: 0, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) }) } };
  vm.runInNewContext(`(${match[0].replace(/^export /, '')})`, context);
  assert.equal(vm.runInNewContext('getScreenLayoutMetrics()', context), null);
});

for (const file of ['src/items.js', 'src/battle.js', 'src/events.js', 'src/follower.js']) {
  test(`${file} 使用统一道路坐标辅助函数`, () => {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /getScreenLayoutMetrics/);
    assert.doesNotMatch(source, /screen\.getBoundingClientRect\(\)/);
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/road-coordinate-contract.test.mjs`

预期：失败，提示 `getScreenLayoutMetrics` 尚未导出且四个模块未引用统一辅助函数。

### 任务 2：实现统一 screen 布局快照

**文件：**
- 修改：`src/ui.js`（在 `getStageSize` 附近新增导出函数）

- [ ] **步骤 1：编写最少实现代码**

新增 `getScreenLayoutMetrics()`：读取 `#screen.clientWidth/clientHeight`，用 `getBoundingClientRect()` 计算正数缩放比例，并提供 `rect(element)` 将物理矩形还原为内部坐标；任一布局无效时返回 `null`。

```js
export function getScreenLayoutMetrics() {
  const screen = $('screen');
  if (!screen) return null;
  const width = Number(screen.clientWidth) || 0;
  const height = Number(screen.clientHeight) || 0;
  const screenRect = screen.getBoundingClientRect?.();
  if (!screenRect || width <= 0 || height <= 0 || screenRect.width <= 0 || screenRect.height <= 0) return null;
  const scaleX = Number.isFinite(screenRect.width / width) && screenRect.width / width > 0 ? screenRect.width / width : 1;
  const scaleY = Number.isFinite(screenRect.height / height) && screenRect.height / height > 0 ? screenRect.height / height : 1;
  return {
    width,
    height,
    rect(element) {
      const rect = element?.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return {
        left: (rect.left - screenRect.left) / scaleX,
        top: (rect.top - screenRect.top) / scaleY,
        width: rect.width / scaleX,
        height: rect.height / scaleY,
      };
    },
  };
}
```

- [ ] **步骤 2：运行测试验证通过**

运行：`node --test test/road-coordinate-contract.test.mjs`

预期：坐标换算和模块契约测试全部通过。

### 任务 3：接入道具与道路遇敌坐标

**文件：**
- 修改：`src/items.js:spawnItemDrop`
- 修改：`src/battle.js:spawnEncounterPoke`

- [ ] **步骤 1：替换道具坐标来源**

在生成时读取 `const layout = getScreenLayoutMetrics();`，用 `layout.rect(charEl)` 和 `layout.rect(roadEl || charEl)` 计算 `charLeft`、`itemY`、`pickupX`、`cTop`；用 `layout.width` 代替 `sRect.width`。布局无效时移除已创建元素、恢复掉落状态并返回。

- [ ] **步骤 2：替换普通遇敌坐标来源**

用同一快照计算主角碰撞点、道路 `y` 和初始 `x`，并用 `layout.width` 替代物理 `sRect.width`；布局无效时移除临时元素并保持原有调度路径。

- [ ] **步骤 3：运行针对性测试**

运行：`node --test test/road-coordinate-contract.test.mjs test/catch-layout-contract.test.mjs`

预期：全部通过。

### 任务 4：接入大量出没、时空扭曲和道路随从

**文件：**
- 修改：`src/events.js:spawnMassPoke`
- 修改：`src/events.js:spawnTwistPoke`
- 修改：`src/follower.js:positionFollowerOnRoad`

- [ ] **步骤 1：替换事件图标坐标来源**

两处事件生成均用 `layout.rect(charEl)`、`layout.rect(roadEl || charEl)` 和 `layout.width`；加载前布局无效时移除新建元素，不写入无效位置。

- [ ] **步骤 2：替换随从相对定位**

用内部坐标矩形计算主角中心、主角底边和随从视觉高度；随从图片高度通过 `layout.rect(imgEl)?.height` 还原，缺失时回退现有 `64` CSS 像素。

- [ ] **步骤 3：运行完整 Node 测试**

运行：`node --test test/road-coordinate-contract.test.mjs`

预期：统一坐标契约全部通过。

### 任务 5：移动端回归验证与 Web 资源构建

**文件：**
- 修改：无（仅生成 `mobile/web` 和构建产物）

- [ ] **步骤 1：运行移动端测试**

运行：`npm run test:mobile`

预期：全部移动端测试通过。

- [ ] **步骤 2：运行完整测试**

运行：`node --test test/*.test.mjs`

预期：退出码 `0` 且无失败测试。

- [ ] **步骤 3：构建 Web 资源**

运行：`node mobile/build-web.mjs`

预期：生成包含 `getScreenLayoutMetrics` 及四个调用模块的 `mobile/web`。

- [ ] **步骤 4：检查工作区差异**

运行：`git diff --stat && git status --short`

预期：仅包含道路坐标实现、契约测试、计划文档和构建输出；保留用户已有的 `src/save-platform.js`、`.superpowers/` 改动。

### 任务 6：Android release 验收

**文件：**
- 生成：`dist/android/pokeidle-android-v1.0.13.apk`
- 生成：`dist/android/pokeidle-android-v1.0.13.apk.sha256`

- [ ] **步骤 1：构建正式 APK**

运行：

```bash
env JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
PATH=/opt/homebrew/opt/openjdk@21/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
npm run android:build
```

预期：`BUILD SUCCESSFUL`，输出 release APK 路径和 SHA-256 文件。

- [ ] **步骤 2：校验哈希与签名**

运行：

```bash
cd dist/android
shasum -a 256 -c pokeidle-android-v1.0.13.apk.sha256
/Users/nayo/Library/Android/sdk/build-tools/35.0.0/apksigner verify --verbose --print-certs pokeidle-android-v1.0.13.apk
```

预期：哈希显示 `OK`，`apksigner` 报告 v2/v3 签名有效。
