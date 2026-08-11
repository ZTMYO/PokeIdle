<p align="center">
  <img src="src-tauri/icons/icon.png" width="120" alt="口袋挂机" />
</p>

<h1 align="center">口袋挂机</h1>

<p align="center">
  <em>基于 Tauri v2 的桌面挂机游戏 · 纯前端 HTML/CSS/JS + Rust 后端存档</em>
</p>

<p align="center">
  <a href="https://github.com/ZTMYO/PokeIdle/stargazers">
    <img src="https://img.shields.io/github/stars/ZTMYO/PokeIdle?style=flat&logo=github&color=brightgreen&label=Stars" />
  </a>
  <a href="https://github.com/ZTMYO/PokeIdle/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT%20%2B%20CC%20BY--NC--ND%204.0-blue?style=flat&logo=creativecommons" />
  </a>
  <a href="https://github.com/ZTMYO/PokeIdle">
    <img src="https://img.shields.io/badge/Tauri-v2.0-blueviolet?style=flat&logo=tauri" />
  </a>
</p>
<p align="center">
  <a href="https://github.com/ZTMYO/PokeIdle">https://pokeidle.shiliu.space/</a>
</p>


## 截图预览

<table align="center">
<tr>
<td align="center"><img src="web/public/images/手机.png" width="180"></td>
<td align="center"><img src="web/public/images/导航.png" width="180"></td>
<td align="center"><img src="web/public/images/宝可梦详情.png" width="180"></td>
<td align="center"><img src="web/public/images/孵蛋.png" width="180"></td>
<td align="center"><img src="web/public/images/农场.png" width="180"></td>
</tr>
</table>

<table align="center">
<tr>
<td align="center"><img src="web/public/images/树果混合.png" width="180"></td>
<td align="center"><img src="web/public/images/交换广场.png" width="180"></td>
<td align="center"><img src="web/public/images/地区悬赏.png" width="180"></td>
<td align="center"><img src="web/public/images/培育.png" width="180"></td>
<td align="center"><img src="web/public/images/闪光宝可梦.png" width="180"></td>
</tr>
</table>

<table align="center">
<tr>
<td align="center"><img src="web/public/images/成就.png" width="180"></td>
<td align="center"><img src="web/public/images/大量出没.png" width="180"></td>
<td align="center"><img src="web/public/images/对战.png" width="180"></td>
<td align="center"><img src="web/public/images/配队.png" width="180"></td>
<td align="center"><img src="web/public/images/训练.png" width="180"></td>
</tr>
</table>

## 玩法

- **挂机冒险** — 九大地区陆路打通，挂机遇敌、自动拾取，目标完成全图鉴
- **手机系统** — 标题栏手机按钮进入主页，内置导航、图鉴、仓库、交换、孵蛋器、树果农场、混合器、日志、统计等应用
- **导航** — 手动选择目的地走最短路线；开启漫游自动沿环国路线循环，到达后自动续接
- **大量出没** — 随机路段生成大量出没事件点，点击导航抵达后自动停下触发，锁定该宝可梦连续遭遇，闪光率提升
- **NPC 对战** — 每 20 分钟刷新一批分级训练家，NPC 队伍等级跟随你的出战队伍生成，失败可随时再战，支持自动出招
- **游戏厅** — 手机第二页「游戏厅」应用：21 点、口袋麻将；场景内还可使用抽卡机收集 TCG 卡牌，卡册应用查看收集
- **卡牌收集** — 游戏厅抽卡机消耗游戏币抽 TCG 卡牌（N 60% / R 32% / SR 8%），重复卡退还游戏币，卡册应用收藏查看
- **随从** — 手机「随从」应用消耗糖果抽取宝可梦随行，按属性归入 9 类限时增益（战斗经验、闪光率、孵蛋里程等），双属性跨类同时生效；孵蛋/树果进度条用黄色段直观显示加成
- **训练场** — 6 个槽位按真实时间挂机练级，宝可梦会偷懒，点击唤醒，喂食树果让宝可梦不容易偷懒
- **训练喂食** — 训练中的宝可梦消耗饱食度，自动吃树果补充
- **配队 / 配招** — 独立配队页支持拖拽操作，支持随机配队；支持自动配招以及手动配招
- **捕捉** — 三种精灵球，基础捕获率 30%/70%/100%；挣脱后逃跑率递增，支持主动逃跑
- **闪光** — 1/1000 概率遇见闪光，使用闪耀护符大幅提升概率
- **道具与商店** — 挂机掉落与钓鱼收获道具，商店消耗糖果兑换
- **增益** — 甜甜蜜/闪耀护符持续 60 秒，大幅缩短遇敌间隔并提升稀有/闪光概率
- **孵蛋** — 神秘蛋与宝可梦蛋按行走里程孵化，最多 8 个槽位，结果随机；
- **培育** — 饲育屋配对繁殖：一雄一雌共蛋组或百变怪万能配对，投喂树果开始繁殖产蛋，收取后放入孵蛋器孵化
- **交换** — 每半小时刷新 NPC 交换请求，按条件交换个体并计入图鉴
- **宝可梦仓库** — 管理所有个体：搜索、筛选、排序、详情、放生
- **钓鱼** — 带垂钓点的水域自动停下钓鱼，每段路一次，收获道具或宝可梦
- **树果农场** — 种植浇水收获树果，告示牌兑换糖果、招募帮手自动打理
- **树果混合器** — 树果配方制成树果方块，按键时机评分决定遇敌概率
- **地区悬赏** — 每日刷新悬赏，捕获指定宝可梦领取糖果奖励
- **成就** — 每项累计统计达成等级即可领取糖果，等级按 1-2-5 规整序列无限递进
- **图鉴** — 1025 只宝可梦全收录，支持搜索、筛选、排序、详情
- **自动操作** — 遇敌自动捕获或逃跑，增益自动续杯；佛系模式遇敌超时自动逃跑；
- **离线挂机** — 离线仅结算每日刷新内容，回到游戏自动结算
- **存档** — 每 30 秒自动保存，多重保障防丢失

## 游戏亮点

- **导航系统** — 内置导航按最短路算法实时规划路线；
- **极速赶路** — 自行车 4× 速度骑行，导航选好目的地即自动骑行，中途地区节点不停车、到站自动下车；骑行中不遇敌不钓鱼，跨地区赶路利器；
- **大量出没** — 地图上点击事件点即可导航抵达，事件宝可梦滚向主角连续遭遇，甜甜蜜可加速下一只出现；
- **自动对战** — NPC对战模式支持自动对战，失败可随时再战；
- **游戏厅 21 点、口袋麻将与抽卡机** — 糖果兑换游戏币，21点黑杰克1.5倍赔付；口袋麻将四人立直打法，立直押注、胡牌赔付；消耗游戏币抽卡收集TCG卡牌，概率公示：N 60% / R 32% / SR 8%；
- **欧非评定** — 每次遭遇按稀有度与捕获运气打分，映射「大欧皇」「小非酋」等 9 档称号
- **轻松抓闪** — 1/1000 概率遇见闪光个体，闪耀护符可大幅提升概率
- **钓鱼与孵蛋** — 水域自动钓鱼，能钓到道具也可能钓上宝可梦；神秘蛋按行走里程孵化，里程由体重与稀有度决定（正态分布采样）
- **培育与遗传** — 饲育屋投喂树果繁殖产蛋，子代个体值 5 项继承双亲；锁定维度固定继承指定亲本（力量负重设定）；
- **农场帮手** — 招募帮手，自动寻路帮忙收获、浇水、播种，分阶段工作并按时休息；
- **树果方块** — 小游戏玩法，QTE评分决定方块品质，轻松刷取已解锁完整图鉴的宝可梦
- **音乐体验** — 各世代原声洗牌播放整轮不重复，并按每首实测响度自动补偿，切歌音量不突兀
- **对战记录** — 右键对战文案区实时查看本局记录
- **随从增益** — 随从按属性分类提供 9 类限时增益，双属性跨类叠加；装配战斗经验/交换闪光类随从即刻生效，增益在进度条上以黄色段可视化展示
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
- 精灵行走图素材：[TaTaTaZJJ/pokemon-overworld-for-gba](https://github.com/TaTaTaZJJ/pokemon-overworld-for-gba)

## 开源协议

> **⚠️ 反倒卖严正声明**
>
> 本项目为作者独立开发的免费开源项目，**严禁任何形式的商业化与倒卖行为**，包括但不限于：
>
> 1. **直接售卖** — 任何打包分发本项目（或仅替换名称、图标、界面就声称"原创"）并收取费用，均属**侵权行为**，发现即举报并举证追责；
> 2. **魔改倒卖** — 基于本项目修改、二次打包后售卖、众筹、引流变现（含直播间上架、网盘付费下载、网店兜售等），一律**不获授权**；
> 3. **抹除署名** — 删除作者信息、版权声明、原项目链接后传播或售卖，构成著作权与署名权双重侵权；
> 4. **素材挪用** — 擅自提取本项目中的宝可梦素材、作者原创配图/文案/音效用于其他商业项目，不受 MIT 协议覆盖（见下方原创资源条款）。
>
> 本项目所有版本均为**免费**，如你在任何渠道付费获得本游戏，请直接向平台举报。授权合作请先联系作者，仅在获得书面许可后才可进行商业使用。
>
> 请尊重每一位开发者的劳动成果。

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
