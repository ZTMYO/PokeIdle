# 宝可梦挂机

基于 Tauri v2 的桌面挂机游戏。纯前端 HTML/CSS/JS + Rust 后端存档。

## 功能

- **挂机遇敌** — 自动遇敌、丢球、捕获，支持智能选球
- **佛系模式** — 与自动操作互斥，遇敌 30 秒未操作则宝可梦自行逃跑，适合挂后台偶尔手动抓
- **9 个世代地区轮转** — 每 1 小时切换一个地区，只能遇到当前地区的宝可梦
- **1025 只宝可梦** — 涵盖第 1~9 世代全部宝可梦，带稀有度权重出率
- **闪光系统** — 极低概率遇见闪光个体，带出场粒子特效
- **图鉴** — 列表/详情/搜索/筛选/排序，记录每次遭遇与捕获
- **商店** — 糖果兑换精灵球、甜甜蜜、神秘蛋、闪耀护符
- **道具** — 甜甜蜜（吸引精灵）、闪耀护符（提升闪光率）、神秘蛋（随机孵化）
- **存档** — localStorage + Rust 后端双通道保存

## 截图

<!-- 占位 -->

## 开发

### 前置依赖

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) 1.70+
- [Tauri v2 CLI](https://v2.tauri.app/)

### 启动

```bash
npm install
npm run dev
```

### 构建

```bash
npm run build
```

构建产物输出到 `src-tauri/target/release/bundle/nsis/`，生成 NSIS 安装包。

## 素材来源

- 人物行走图：[screensmith.itch.io — Pokemon Style Characters: Townspeople](https://screensmith.itch.io/pokemon-style-characters-townspeople)
- 宝可梦 GIF 动画：[play.pokemonshowdown.com](https://play.pokemonshowdown.com/)
- 道具图标：自行绘制/整理
