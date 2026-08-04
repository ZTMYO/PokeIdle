<p align="center">
  <img src="src-tauri/icons/icon.png" width="120" alt="口袋挂机" />
</p>

<h1 align="center">口袋挂机</h1>

<p align="center">
  <em>基于 Tauri v2 的桌面挂机游戏 · 纯前端 HTML/CSS/JS + Rust 后端存档</em>
</p>

<p align="center">
  <img alt="Stars" src="https://img.shields.io/github/stars/ZTMYO/PokeIdle?style=for-the-badge&label=Stars&color=brightgreen" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT%20%2B%20CC%20BY--NC--ND%204.0-blue?style=for-the-badge" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-v2.0-blueviolet?style=for-the-badge" />
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows-0078d6?style=for-the-badge" />
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-informational?style=for-the-badge" />
</p>

## 玩法

- **挂机冒险** — 九大地区陆路打通，挂机遇敌、自动拾取，目标完成全图鉴
- **手机系统** — 标题栏手机按钮进入主页，内置导航、图鉴、仓库、交换、孵蛋器、树果农场、混合器、日志、统计等应用
- **导航** — 手动选择目的地走最短路线；开启漫游自动沿环国路线循环，到达后自动续接
- **大量出没** — 随机路段生成大量出没事件点，点击导航抵达后自动停下触发，锁定该宝可梦连续遭遇，闪光率提升
- **捕捉** — 三种精灵球，基础捕获率 30%/70%/100%；挣脱后逃跑率递增，支持主动逃跑
- **闪光** — 1/1000 概率遇见闪光，使用闪耀护符大幅提升概率
- **道具与商店** — 挂机掉落与钓鱼收获道具，商店消耗糖果兑换
- **增益** — 甜甜蜜/闪耀护符持续 60 秒，大幅缩短遇敌间隔并提升稀有/闪光概率
- **孵蛋** — 神秘蛋按行走里程孵化，最多 8 个槽位，结果随机
- **交换** — 每半小时刷新 NPC 交换请求，按条件交换个体并计入图鉴
- **宝可梦仓库** — 管理所有个体：搜索、筛选、排序、详情、放生
- **钓鱼** — 带垂钓点的水域自动停下钓鱼，每段路一次，收获道具或宝可梦
- **树果农场** — 种植浇水收获树果，告示牌兑换糖果、招募帮手自动打理
- **树果混合器** — 树果配方制成树果方块，按键时机评分决定遇敌概率
- **地区悬赏** — 每日刷新悬赏，捕获指定宝可梦领取糖果奖励
- **成就** — 每项累计统计达成等级即可领取糖果，等级按 1-2-5 规整序列无限递进
- **图鉴** — 1025 只宝可梦全收录，支持搜索、筛选、排序、详情
- **自动操作** — 遇敌自动捕获或逃跑，增益自动续杯；佛系模式遇敌超时自动逃跑
- **离线挂机** — 离线仅结算每日刷新内容，回到游戏自动结算
- **存档** — 每 30 秒自动保存，多重保障防丢失

## 游戏亮点

- **导航系统** — 内置导航按最短路算法实时规划路线；
- **大量出没** — 地图上点击事件点即可导航抵达，事件宝可梦滚向主角连续遭遇，甜甜蜜可加速下一只出现；
- **欧非评定** — 每次遭遇按稀有度与捕获运气打分，映射「大欧皇」「小非酋」等 9 档称号
- **轻松抓闪** — 1/1000 概率遇见闪光个体，闪耀护符可大幅提升概率
- **钓鱼与孵蛋** — 水域自动钓鱼，能钓到道具也可能钓上宝可梦；神秘蛋按行走里程孵化，里程由体重与稀有度决定（正态分布采样）
- **农场帮手** — 招募帮手，自动寻路帮忙收获、浇水、播种，分阶段工作并按时休息；
- **树果方块** — 小游戏玩法，QTE评分决定方块品质，轻松刷取已解锁完整图鉴的宝可梦
- **音乐体验** — 各世代原声洗牌播放整轮不重复，并按每首实测响度自动补偿，切歌音量不突兀
- **自动挂机** — 支持遇敌自动捕获或逃跑、增益自动续杯；
- **托盘图标** — 系统托盘动态实时展示游戏状态相关的图标，悬停可查看多行实时状态；

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

## 主要素材来源

- 宝可梦 GIF 动画：[play.pokemonshowdown.com](https://play.pokemonshowdown.com/)
- 宝可梦游戏原声：[khinsider.com](https://downloads.khinsider.com/game-soundtracks)

## 开源协议

本项目采用**双协议授权**：

- **源代码**（前端 / Tauri Rust / 配置）：[MIT License](LICENSE-MIT)。允许自由修改、Fork、提交 PR，但衍生代码不可商业售卖、打包盈利
- **原创资源**（作者绘制配图、文案、定制音效）：CC BY-NC-ND 4.0。署名转发须标注原项目地址，禁止商用，禁止修改后二次分发传播

**第三方 IP 特别声明**：项目内宝可梦形象、立绘、图标、原声 BGM、专有名称、世界观设定等官方 IP 素材，著作权归 **Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company** 所有，不受以上两份协议覆盖，无论商用、非商用场景，严禁私自提取、拆分、商用传播。

完整条款见 [LICENSE](LICENSE)。

## 版权声明

- **Pokémon** 及其所有相关角色、名称、标志、音乐、插图与动画，版权均归 **Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company** 所有。
- 本项目为粉丝自制的个人挂机游戏，仅用于学习与娱乐交流，**非官方作品，与官方无任何关联**，不用于任何商业用途。
- 项目使用的宝可梦动画素材来自非官方社区资源，版权归属其原始权利方，本项目不主张任何所有权。
- 如涉及侵权，请联系项目作者删除相关内容。
