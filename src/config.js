// ===== 游戏常量配置 =====

// 道具概率权重（行走掉落 & 钓鱼收获共用）：
// 每秒累计一次该概率，达到 1 时掉落 1 个道具
export const ITEM_RATES = {
  'poke-ball':   1 / 90,   // 精灵球
  'ultra-ball':  1 / 220,  // 高级球
  'master-ball': 1 / 900,  // 大师球
  'candy':       1 / 30,   // 糖果
  'sweet-honey': 1 / 400,  // 甜甜蜜
  'mystery-egg': 1 / 800,  // 神秘蛋
  'shiny-charm': 1 / 1000, // 闪耀护符
};

// 道具显示名称
export const ITEM_NAMES = {
  'poke-ball': '精灵球', 'ultra-ball': '高级球',
  'master-ball': '大师球', 'candy': '糖果',
  'sweet-honey': '甜甜蜜', 'mystery-egg': '神秘蛋', 'shiny-charm': '闪耀护符',
};

// 精灵球基础捕获率（最终 = 基础率 × 宝可梦 catchRate × 丢球加成；加成仅在逃跑率拉满后每球 +10%，见 battle.js）
export const CATCH_RATES = {
  'poke-ball': 0.30, 'ultra-ball': 0.70, 'master-ball': 1.00,
};

// 逃跑率上限后丢球的捕获加成
export const CATCH_BONUS_INC = 0.10;

// 糖果商店兑换价格
export const CANDY_EXCHANGE = {
  'poke-ball': 10, 'ultra-ball': 25, 'master-ball': 50,
  'sweet-honey': 15, 'mystery-egg': 100, 'shiny-charm': 1000,
};

// 丢球挣脱后宝可梦逃跑的概率
// 逃跑率随丢球次数递增：第 1 球为基础 FLEE_CHANCE，之后每多丢一球 +FLEE_CHANCE_INC，最高不超过 FLEE_CHANCE_MAX
export const FLEE_CHANCE = 0.05;     // 第 1 球挣脱后的逃跑概率
export const FLEE_CHANCE_INC = 0.05; // 每多丢一球额外增加的逃跑概率
export const FLEE_CHANCE_MAX = 0.5; // 逃跑概率上限

// 普通遇敌间隔（秒，范围内随机）
export const ENCOUNTER_MIN = 120;
export const ENCOUNTER_MAX = 240;

// 甜甜蜜 / 闪耀护符：增益持续时间（秒）
export const BUFF_DURATION = 60;
// 甜甜蜜 / 闪耀护符：增益期间的快速遇敌间隔（秒，范围内随机）
export const BUFF_ENCOUNTER_MIN = 15;
export const BUFF_ENCOUNTER_MAX = 30;
// 甜甜蜜 / 闪耀护符：稀有度加成权重（越高极稀有出现概率越大，见 items.js pickWeightedPokemon）
export const HONEY_RARITY_BOOST = 0.5;
export const CHARM_RARITY_BOOST = 0.7;

// 野生/钓鱼/孵蛋的基础闪光概率
export const SHINY_CHANCE = 1 / 1000;
// 闪耀护符生效时，遇敌/钓鱼出宝可梦的闪光概率
export const CHARM_SHINY_CHANCE = 0.8;

// ===== 孵蛋 =====
// 神秘蛋孵化时间（秒）：体重/稀有度决定分布峰值（正态分布的 mid），
// 叠加相对峰值的正态随机（标准差 = mid × HATCH_TIME_SIGMA），超出 [MIN, MAX] 时重新采样（截断正态）
export const HATCH_TIME_MIN = 1800;   // 最短孵化时间（秒，30 分钟）
export const HATCH_TIME_MAX = 28800;  // 最长孵化时间（秒，8 小时）
export const HATCH_TIME_SIGMA = 0.2;  // 正态分布宽度系数（标准差 = mid × 该系数，0~1）

// 地区列表（下标 0~8，也是 GPS 距离矩阵的索引：0关都 1城都 2丰缘 3神奥 4合众 5卡洛斯 6阿罗拉 7伽勒尔 8帕底亚）
export const REGION_CYCLE = ['关都', '城都', '丰缘', '神奥', '合众', '卡洛斯', '阿罗拉', '伽勒尔', '帕底亚'];

// 像素 ↔ 米换算（用于统计行走距离展示；26px ≈ 1m，约为步行速度 0.6px/帧 × 60fps ≈ 5km/h）
export const PX_PER_METER = 26;

// 自动存档间隔（秒）
export const SAVE_INTERVAL = 30;

// 佛系模式：遇敌后自动逃跑的倒计时（毫秒）
export const AUTO_FLEE_TIMEOUT = 30000;

// 佛系模式：自动操作无球时，展示遇敌画面后逃跑的等待（毫秒）
export const AUTO_FLEE_NO_BALL_DELAY = 800;

// ===== 钓鱼 =====
export const FISH_POKEMON_CHANCE = 0.1;   // 每次钓鱼钓到宝可梦的几率（无 buff 时）
export const FISH_BUFF_POKEMON_CHANCE = 0.5; // 甜甜蜜/闪耀护符生效期间，每次钓鱼钓到宝可梦的几率
export const FISH_RARE_RATE = 0.6;      // 钓到宝可梦时，极稀有所占比例（其余为当地水系，含双属性）
export const FISH_WAIT_MIN = 6;         // 等待上钩最短秒数
export const FISH_WAIT_MAX = 30;        // 等待上钩最长秒数（范围内随机）
export const FISH_QTY_MIN = 1;          // 钓到道具最少数量
export const FISH_QTY_MAX = 10;         // 钓到道具最多数量（范围内随机）
export const FISH_TRIGGER_MIN = 5;      // 进入垂钓路段后，预定开始钓鱼的最短秒数
export const FISH_TRIGGER_MAX = 20;     // 进入垂钓路段后，预定开始钓鱼的最长秒数（范围内随机）

// ===== 路段生成 =====
export const ROAD_WATER_CHANCE = 0.05;     // 新路段为水域（可钓鱼）的概率，其余从陆地池中选取
export const ROAD_WIDTH_MIN = 50;          // prob（随机生成）类路段的最短格数
export const ROAD_WIDTH_MAX = 200;         // prob（随机生成）类路段的最长格数（范围内均匀随机）

// ===== 路面滚动速度 =====
export const ROAD_SPEED_WALK = 0.6;   // 走路时瓦片滚动速度
export const ROAD_SPEED_RUN  = 1.1;   // 跑步时（buff生效）瓦片滚动速度
