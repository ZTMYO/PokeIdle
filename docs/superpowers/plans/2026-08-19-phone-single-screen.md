# 手机主页单屏整合实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将手机主页两页应用列表改为保留状态栏的 6 × 3 单屏应用网格。

**架构：** 保留 `phone.js` 的应用数据、事件委托和导航逻辑，只移除分页计算及其滚动事件；使用现有 `.phone-pages` 容器承载单层 CSS Grid，以降低 DOM 和样式改动范围。

**技术栈：** 原生 ES 模块、CSS Grid、Node.js 内置 `node:test`。

---

### 任务 1：建立单屏行为契约

**文件：**
- 创建：`test/phone-single-screen.test.mjs`
- 参考：`src/phone.js`、`src/styles.css`

- [x] **步骤 1：编写失败测试**

测试源码文本应断言：`phone.js` 不含 `PAGE_SIZE`、`phone-dots`、`addEventListener('wheel'` 和分页 `.map(page`；保留 18 个 `id` 定义；样式包含 6 列、3 行、`overflow-x: hidden` 或 `overflow: hidden`。

- [x] **步骤 2：运行测试确认失败**

运行：`node --test test/phone-single-screen.test.mjs`

预期：失败，指出当前源码仍包含分页常量或分页逻辑。

### 任务 2：实现单层网格渲染

**文件：**
- 修改：`src/phone.js:28-190`
- 修改：`src/styles.css:1704-1745`

- [x] **步骤 1：删除分页运行时代码**

保留 `APPS`、红点和点击逻辑，删除 `PAGE_SIZE` 常量；将 `showPhoneView()` 中的分页构建替换为单个 `.phone-pages > .phone-page`，直接 `APPS.map(...)` 生成 18 项；删除页码点击、scroll 同步和 wheel 翻页监听。

- [x] **步骤 2：改写手机主页网格样式**

将 `.phone-pages` 设为 `display: block; overflow: hidden;`，将 `.phone-page` 设为填满剩余空间的 `display: grid`，使用 `grid-template-columns: repeat(6, minmax(0, 1fr))`、`grid-template-rows: repeat(3, minmax(0, 1fr))`，保留应用居中和红点定位。

- [x] **步骤 3：运行契约测试确认通过**

运行：`node --test test/phone-single-screen.test.mjs`

预期：新增契约全部通过。

### 任务 3：完整验证与提交

**文件：**
- 验证：`src/phone.js`、`src/styles.css`、`test/phone-single-screen.test.mjs`

- [x] **步骤 1：运行完整验证**

运行：`npm run test:mobile && node --test test/*.test.mjs && node --check src/phone.js && node mobile/build-web.mjs && git diff --check`

预期：所有测试通过，Web 资源生成成功，差异检查无输出。

- [x] **步骤 2：检查差异范围**

运行：`git status --short && git diff --stat`

确认不包含 `src/save-platform.js`、`.superpowers/` 或 `mobile/web/` 生成目录。

- [x] **步骤 3：提交功能改动**

运行：`git add src/phone.js src/styles.css test/phone-single-screen.test.mjs docs/superpowers/specs/2026-08-19-phone-single-screen-design.md docs/superpowers/plans/2026-08-19-phone-single-screen.md && git commit -m "feat(手机): 整合主页应用为单屏网格"`
