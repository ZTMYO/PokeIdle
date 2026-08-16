// ===== 游戏常量配置 =====

export const START_CANDY = 450; // 新存档启动资金
// 道具概率权重
export const ITEM_RATES = {
  'poke-ball':   1 / 90,   // 精灵球
  'ultra-ball':  1 / 220,  // 高级球
  'master-ball': 1 / 900,  // 大师球
  'candy':       1 / 20,   // 糖果
  'sweet-honey': 1 / 400,  // 甜甜蜜
  'mystery-egg': 1 / 800,  // 神秘蛋
  'shiny-charm': 1 / 1000, // 闪耀护符
};

// 糖果掉落数量倍率：掉落糖果时按权重抽取一次（×1 最常见，×100 极小概率大奖）
export const CANDY_DROP_MULT = [
  { mult: 1, weight: 100 },
  { mult: 2, weight: 30 },
  { mult: 5, weight: 15 },
  { mult: 50, weight: 4 },
  { mult: 100, weight: 2 },
];

// 道具显示名称
export const ITEM_NAMES = {
  'poke-ball': '精灵球', 'ultra-ball': '高级球',
  'master-ball': '大师球', 'candy': '糖果',
  'sweet-honey': '甜甜蜜', 'mystery-egg': '神秘蛋', 'shiny-charm': '闪耀护符',
  'bike': '自行车', 'exp-candy': '经验糖果',
};

// 精灵球基础捕获率（最终 = 基础率 × 宝可梦 catchRate × 丢球加成）
export const CATCH_RATES = {
  'poke-ball': 0.35, 'ultra-ball': 0.70, 'master-ball': 1.00,
};

// 高级球绝对捕获率加成：捕获率 = (基础率 × catchRate + 加成) × 丢球加成
// 对低 catchRate 的稀有/神兽增幅显著，体现「抓神兽用高级球」的定位
export const ULTRA_BALL_ADD = 0.06;

// 逃跑率拉满后每多丢一球的捕获加成
export const CATCH_BONUS_INC = 0.10;

// 糖果商店兑换价格
export const CANDY_EXCHANGE = {
  'poke-ball': 10, 'ultra-ball': 25, 'master-ball': 500,
  'sweet-honey': 40, 'mystery-egg': 100, 'shiny-charm': 1000,
  'bike': 200, // 自行车：赶路工具（骑行路段也能免费获得，商店是保底渠道）
};

// 丢球挣脱后宝可梦逃跑的概率（随丢球次数递增，上限 FLEE_CHANCE_MAX）
export const FLEE_CHANCE = 0.04;     // 第 1 球挣脱后的逃跑概率
export const FLEE_CHANCE_INC = 0.04; // 每多丢一球额外增加的逃跑概率
export const FLEE_CHANCE_MAX = 0.4;  // 逃跑概率上限

// 普通遇敌间隔（秒，范围内随机）
export const ENCOUNTER_MIN = 120;
export const ENCOUNTER_MAX = 240;

// 甜甜蜜 / 闪耀护符增益
export const BUFF_DURATION = 60;      // 持续时间（秒）
export const BUFF_ENCOUNTER_MIN = 15; // 增益期间遇敌间隔下限（秒）
export const BUFF_ENCOUNTER_MAX = 30; // 增益期间遇敌间隔上限（秒）
export const HONEY_RARITY_BOOST = 0.5; // 甜甜蜜稀有度加成权重
export const CHARM_RARITY_BOOST = 0.7; // 闪耀护符稀有度加成权重

// 闪光概率
export const SHINY_CHANCE = 1 / 1000;  // 野生/钓鱼/孵蛋基础闪光概率
export const CHARM_SHINY_CHANCE = 0.8; // 闪耀护符生效时的遇敌/钓鱼闪光概率

// ===== 大量出没（随机道路事件）=====
export const MASS_GEN_MIN = 20;      // 事件点生成间隔下限（分钟）
export const MASS_GEN_MAX = 60;      // 事件点生成间隔上限（分钟）
export const MASS_DURATION = 60;     // 事件点存在时长（分钟）
export const MASS_COUNT_MIN = 10;    // 大量出没数量下限
export const MASS_COUNT_MAX = 20;    // 大量出没数量上限
export const MASS_SHINY_CHANCE = 1 / 200; // 大量出没闪光率（不吃闪耀护符加成）
export const MASS_SPAWN_MIN = 8;     // 遭遇结束后下一只出现间隔下限（秒）
export const MASS_SPAWN_MAX = 15;    // 遭遇结束后下一只出现间隔上限（秒）
export const MASS_SPAWN_HONEY_MIN = 3;  // 甜甜蜜生效期间下一只出现间隔下限（秒）
export const MASS_SPAWN_HONEY_MAX = 6;  // 甜甜蜜生效期间下一只出现间隔上限（秒）

// ===== 时空扭曲（跨地区稀有事件，参考大量出没但更稀有）=====
export const TWIST_GEN_MIN = 40;        // 事件点生成间隔下限（分钟）
export const TWIST_GEN_MAX = 90;        // 事件点生成间隔上限（分钟）
export const TWIST_DURATION = 30;       // 事件点存在时长（分钟）
export const TWIST_COUNT_MIN = 5;       // 可遭遇数量（固定 5 只）
export const TWIST_COUNT_MAX = 5;       // 可遭遇数量（固定 5 只）
export const TWIST_SHINY_CHANCE = 1 / 200; // 时空扭曲闪光率（同大量出没）
export const TWIST_SPAWN_MIN = 12;      // 遭遇结束后下一只出现间隔下限（秒）
export const TWIST_SPAWN_MAX = 20;      // 遭遇结束后下一只出现间隔上限（秒）
export const TWIST_GUARANTEED_IVS = 2;  // 个体值保底 V 数（随机 2 项 31）
export const TWIST_RGB_CHANCE = 0.20;   // 遭遇为 RGB 变体概率
export const TWIST_POLLUTED_CHANCE = 0.20; // 遭遇为污染变体概率（RGB+污染合计 40%）

// ===== 孵蛋 =====
export const HATCH_DIST_MIN = 2000;   // 最短（2 公里）
export const HATCH_DIST_MAX = 30000;  // 最长（30 公里）
export const HATCH_DIST_SIGMA = 0.2;  // 分布宽度系数（标准差 = 峰值 × 系数）

// 地区列表
export const REGION_CYCLE = ['关都', '城都', '丰缘', '神奥', '合众', '卡洛斯', '阿罗拉', '伽勒尔', '帕底亚'];

// 像素 ↔ 米换算（统计行走距离用）
export const PX_PER_METER = 26;

// ===== 地区悬赏 =====
export const BOUNTY_PER_REGION = 5;   // 每地区每日悬赏条数
export const BOUNTY_CANDY_MIN = 30;    // 最低糖果奖励
export const BOUNTY_CANDY_MAX = 500;    // 最高糖果奖励
export const BOUNTY_JITTER = 0.25;     // 糖果奖励随机浮动（±25%）
export const BOUNTY_RARE_WEIGHT = 0.7; // 选角稀有度权重

// ---- 交换 ----
export const TRADE_COUNT = 6;          // 每波上架的交换 offer 数量
export const TRADE_REFRESH_MS = 10 * 60 * 1000; // 刷新间隔（10 分钟）
export const TRADE_GENDER_CHANCE = 0.35; // NPC 指定「想要宝可梦」性别的概率（仅可区分性别的物种）
export const TRADE_IV_CHANCE = 0.35;    // NPC 指定某一项个体值下限的概率
export const TRADE_IV_MIN = 20;         // 指定个体值下限的最低值（20~31）
export const TRADE_LEVEL_CHANCE = 0.35; // NPC 指定「想要宝可梦」等级下限的概率
export const TRADE_WANT_LEVEL_MIN = 10; // 需求等级下限随机范围（10~40）
export const TRADE_WANT_LEVEL_MAX = 40;
export const TRADE_GIVE_LEVEL_MAX = 60; // 给出宝可梦等级随机上限（1~60）
export const TRADE_SHINY_CHANCE = 1 / 10; // NPC 给出闪光宝可梦的概率
export const TRADE_IV_SUM_MIN = 100;    // 个体值总和过低时补强 1~2 项到 31

// ---- 对战（NPC 挑战）----
export const BATTLE_REFRESH_MS = 20 * 60 * 1000; // NPC 挑战刷新间隔（20 分钟）
export const BATTLE_NPC_COUNTS = { novice: 3, veteran: 2, champion: 1 }; // 每波各档 NPC 数量
export const BATTLE_MONS_COUNT = { novice: 3, veteran: 5, champion: 6 };  // 各档队伍宝可梦数量

// ---- 经验糖果 ----
// 不可用糖果购买，唯一来源：NPC 训练家对战胜利概率掉落（见 EXP_CANDY_DROP）
export const EXP_CANDY_XP = 3000; // 单颗经验值（1→17 级左右）
export const EXP_CANDY_DROP = { novice: 0.05, veteran: 0.25, champion: 0.50 }; // 各档 NPC 战胜掉落概率（普通/精英/冠军）
export const RELEASE_XP_RATE = 0.12; // 放生返还经验比例

// 特殊宝可梦战斗精灵缩放：图鉴身高是全身拉直总长，这类宝可梦立绘却蜷缩/盘绕成团，
// 直接按身高缩放会显得偏大，这里按图鉴编号乘以一个缩小系数修正（系数越小缩得越多）
export const SPECIAL_SPRITE_SCALE = {
  '0023': 0.7,  // 阿柏蛇
  '0024': 0.7,  // 阿柏怪
  '0059': 0.8,  // 风速狗
  '0095': 0.6,  // 大岩蛇
  '0130': 0.5,  // 暴鲤龙
  '0147': 0.7,  // 迷你龙
  '0148': 0.7,  // 哈克龙
  '0162': 0.75, // 大尾立
  '0178': 0.75, // 天然鸟
  '0206': 0.4,  // 土龙弟弟
  '0208': 0.6,  // 大钢蛇
  '0247': 0.7,  // 沙基拉斯
  '0287': 0.7,  // 懒人獭
  '0329': 0.7,  // 超音波幼虫
  '0336': 0.7, // 饭匙蛇
  '0350': 0.5, // 美纳斯
  '0362': 0.7, // 冰鬼护
  '0367': 0.7, // 猎斑鱼
  '0368': 0.7, // 樱花鱼
  '0384': 0.85, // 烈空坐
  '0450': 0.7, // 河马兽
  '0487': 0.85, // 骑拉帝纳
  '0497': 0.8,  // 君主蛇
  '0550': 0.7, // 野蛮鲈鱼
  '0604': 0.65,  // 麻麻鳗鱼王
  '0844': 0.5, // 沙螺蟒
  '0950': 0.7, // 毛崖蟹
  '0968': 0.7, // 拖拖蚓
  '0980': 0.7, // 土王
  '0982': 0.3,  // 土龙节节
};

// 自动存档间隔（秒）
export const SAVE_INTERVAL = 30;

// 佛系模式：遇敌后自动逃跑的倒计时（毫秒）
export const AUTO_FLEE_TIMEOUT = 30000;
// 无球时展示遇敌画面后逃跑的等待（毫秒）
export const AUTO_FLEE_NO_BALL_DELAY = 800;

// ===== 树果农场 =====
export const FARM_PLOT_COUNT = 6;          // 田地数量
export const FARM_MATURE_MIN = 20 * 60 * 1000; // 成熟总时长下限（毫秒）
export const FARM_MATURE_MAX = 40 * 60 * 1000; // 成熟总时长上限（毫秒）
// 各阶段占成熟时长的累计比例：刚种下/发芽/成长/开花结果
export const FARM_STAGE_DIRT = 2 / 30;
export const FARM_STAGE_SPROUT = 8 / 30;
export const FARM_STAGE_GROW = 18 / 30;
// 湿度：浇水回满，归 0 停止生长（满湿度可撑 10 分钟）
export const FARM_MAX_WATER = 100;
export const FARM_WATER_DROP = 100 / (10 * 60); // 每秒下降点数
// 种植消耗糖果 + 告示牌树果委托
export const FARM_PLANT_COST = 10;
export const FARM_BOARD_DEMANDS = 5;   // 委托条数
export const FARM_BOARD_QTY_MIN = 3;   // 单条需求最少树果数
export const FARM_BOARD_QTY_MAX = 10;   // 单条需求最多树果数
// 「大量需求」：需求量远超单轮产量，需专门种植较久
export const FARM_BOARD_BIG_QTY_MIN = 25;
export const FARM_BOARD_BIG_QTY_MAX = 45;
export const FARM_CANDY_PER_BERRY = 8; // 每颗树果兑换糖果数
export const FARM_HARVEST_MIN = 3;   // 收获最少树果数
export const FARM_HARVEST_MAX = 6;   // 收获最多树果数

// ===== 招募帮手 =====
export const FARM_HELPER_WORK_STAGE = 60; // 单阶段工作时长（分钟）
export const FARM_HELPER_REST = 10;       // 阶段间休息时长（分钟）
export const FARM_HELPER_STAGE_COST = 50; // 第 1 阶段价格（糖果）
export const FARM_HELPER_STAGE_INC = 10;  // 每阶段单价递增量（糖果）

export const FARM_HELPER_WORK_MIN = 4;         // 单次劳作间隔下限（秒）
export const FARM_HELPER_WORK_MAX = 8;         // 单次劳作间隔上限（秒）
export const FARM_HELPER_PATROL_PAUSE_MIN = 800;  // 巡逻站定下限（毫秒）
export const FARM_HELPER_PATROL_PAUSE_MAX = 1800; // 巡逻站定上限（毫秒）

// ===== 树果方块（混合器产物） =====
export const BLOCK_DISTANCE = 1000;    // 有效期（米）：再走该里程未吃掉则风干失效
export const BLOCK_TARGET_CHANCE = 0.6; // 无品质记录时的兜底命中概率
// 品质 → 遇敌直接命中目标宝可梦的概率
export const BLOCK_QUALITY = {
  perfect: { label: '完美', chance: 0.95 },
  great:   { label: '优秀', chance: 0.85 },
  good:    { label: '良好', chance: 0.70 },
  fair:    { label: '一般', chance: 0.50 },
  poor:    { label: '劣质', chance: 0.25 },
};

// ===== 训练场 =====
// 宝可梦等级上限（训练挂机与 NPC 对战结算均不可超过）
export const MAX_LEVEL = 100;

// ---- 训练（训练场） ----
export const TRAIN_SLOTS = 6;        // 训练槽位数
export const TRAIN_XP_PER_MIN = 30;  // 每分钟获得经验（挂机，不消耗糖果）
// 随机偷懒：类比农场帮手休息，但触发是随机的（不扣已结算经验，只暂停后续积累）
export const TRAIN_LAZY = {
  enabled: true,           // 是否启用随机偷懒
  chancePerMin: 0.3,       // 训练中每分钟触发偷懒的概率
  durationMin: 90 * 1000,  // 偷懒最短时长（毫秒）
  durationMax: 240 * 1000, // 偷懒最长时长（毫秒）
};
// 饱食度（喂食系统）：训练中的宝可梦随时间消耗饱食度，饿了会自动吃掉库存里爱吃的树果补充；饱食度越低越容易偷懒
export const TRAIN_SATIETY_MAX = 100;          // 饱食度上限
export const TRAIN_SATIETY_DRAIN_PER_MIN = 1;  // 训练中每分钟下降量
export const TRAIN_SATIETY_EAT_AT = 50;        // 饱食度低于该值自动进食
export const TRAIN_SATIETY_PER_BERRY = 35;     // 每颗爱吃的树果补充的饱食度
export const TRAIN_HUNGRY_LAZY_MULT = 3;       // 饱食度归零时偷懒概率的倍率上限（满饱食为 1 倍）

// ===== 钓鱼 =====
export const FISH_POKEMON_CHANCE = 0.1;   // 每次钓鱼钓到宝可梦的几率
export const FISH_BUFF_POKEMON_CHANCE = 0.5; // 增益期间钓到宝可梦的几率
export const FISH_RARE_RATE = 0.6;      // 钓到宝可梦时极稀有所占比例
export const FISH_WAIT_MIN = 6;         // 等待上钩最短秒数
export const FISH_WAIT_MAX = 30;        // 等待上钩最长秒数
export const FISH_QTY_MIN = 1;          // 钓到道具最少数量
export const FISH_QTY_MAX = 15;         // 钓到道具最多数量
export const FISH_TRIGGER_MIN = 5;      // 进入垂钓路段后预定开始钓鱼的最短秒数
export const FISH_TRIGGER_MAX = 20;     // 预定开始钓鱼的最长秒数

// ===== 路段生成 =====
export const ROAD_SPECIAL_CHANCE = 0.05;   // 特殊路段概率（水域与自行车道对半）
export const ROAD_WIDTH_MIN = 50;          // 随机路段最短格数
export const ROAD_WIDTH_MAX = 200;         // 随机路段最长格数
export const ROAD_SWITCH_CYCLES = 2;       // 滚动满几个循环后切换场景

// ===== 路面滚动速度 =====
export const ROAD_SPEED_WALK = 0.5;   // 走路
export const ROAD_SPEED_RUN  = 1.0;   // 跑步（增益生效时）
export const ROAD_SPEED_BIKE = 2.0;    // 自行车道骑行
export const BIKE_RESTORE_MAX_GAP_MS = 120000; // 手动骑行状态恢复的最大离档间隔（>此值视为长时间离线，不恢复骑行）

// 道具作用简述（商店 hover 提示等统一 tooltip 文案）
// 数值全部引用上方常量动态生成，配置改动后 tooltip 自动同步
const pct = v => Math.round(v * 100) + '%';
export const ITEM_DESC = {
  'poke-ball': `普通精灵球\n基础捕获率 ${pct(CATCH_RATES['poke-ball'])}`,
  'ultra-ball': `高级精灵球\n基础捕获率 ${pct(CATCH_RATES['ultra-ball'])}`,
  'master-ball': '大师球\n必定捕获成功',
  'candy': '通用货币\n遇敌捕获、钓鱼、孵蛋等均可获得',
  'sweet-honey': `使用后 ${BUFF_DURATION} 秒内\n遇敌间隔大幅缩短`,
  'mystery-egg': `放入孵蛋器\n行走${Math.round(HATCH_DIST_MIN / 1000)}~${Math.round(HATCH_DIST_MAX / 1000)} 公里后孵化出宝可梦`,
  'shiny-charm': `使用后 ${BUFF_DURATION} 秒内\n遇敌/钓鱼闪光概率提升至 ${pct(CHARM_SHINY_CHANCE)}`,
  'bike': `骑行赶路工具\n速度 ${Math.round(ROAD_SPEED_BIKE / ROAD_SPEED_WALK)} 倍且不遇敌、不拾取`,
};

// ===== 抽卡机 =====
export const GACHA_DRAW_COST = 20;     // 单抽消耗游戏币
export const GACHA_DUP_REFUND = 10;    // 抽到重复卡片的返还
export const GACHA_TIER_WEIGHT = { N: 60, R: 32, SR: 8 };

// ===== 游戏厅 =====
export const COIN_RATE = 20;           // 1 游戏币 = 多少糖果
export const DEALER_STAND = 17;        // 庄家停牌点数
export const BJ_MULT = 1.5;            // 黑杰克赔付倍率

// ===== 口袋麻将 =====
export const HAND_SIZE = 8;            // 起手手牌数
export const RIICHI_COST = 50;         // 立直费用（游戏币）

// ===== 随从（糖果抽卡的临时跟随增益玩法）=====
// 用糖果抽出一只宝可梦，选择「跟随」获得限时增益，用完即走；「放走」则糖果消耗无收益
export const FOLLOWER_DRAW_COST = 100;              // 单抽糖果价格
export const FOLLOWER_TIER_CHANCE = { N: 0.55, R: 0.30, SR: 0.12, UR: 0.03 }; // 稀有度档位概率
export const FOLLOWER_TIER_DUR = { N: 15, R: 20, SR: 30, UR: 60 };            // 跟随时长（分钟）
export const FOLLOWER_TIER_BOOST = { N: 0.08, R: 0.10, SR: 0.12, UR: 0.15 };  // 增益幅度（稀有度缓递增）
// 宝可梦主属性 → 随从类别（9 类）
export const FOLLOWER_TYPE_GROUP = {
  '飞行': 'bike', '妖精': 'bike',
  '水': 'fishing',
  '草': 'berry', '虫': 'berry',
  '地面': 'itemdrop', '岩石': 'itemdrop', '钢': 'itemdrop',
  '格斗': 'battleexp', '恶': 'battleexp',
  '一般': 'catch', '幽灵': 'catch',
  '电': 'flee', '冰': 'flee',
  '龙': 'hatch', '火': 'hatch',
  '毒': 'trade', '超能': 'trade',
};
// 类别 → 生效机制（每类一种核心增益）
export const FOLLOWER_GROUP_BOOST = {
  bike:     'bikeSegment',    // 进入自行车道路段概率提升
  fishing:  'fishingSegment', // 进入钓鱼路段概率提升
  berry:    'berryGrow',      // 树果成熟速度提升
  itemdrop: 'itemDrop',       // 挂机道具掉落率提升
  battleexp:'battleExp',      // 对战胜利经验提升
  catch:    'catchRate',      // 精灵球（红白球）捕捉率提升
  flee:     'fleeRate',       // 宝可梦逃跑率降低
  hatch:    'hatchDist',      // 孵蛋所需里程降低
  trade:    'tradeShiny',     // 交换时 NPC 给出闪光概率提升
};
