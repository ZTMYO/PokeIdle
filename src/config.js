// ===== 游戏常量配置 =====

export const TYPE_COLORS = {
  '一般':'#B5B4AF','格斗':'#BE4D47','飞行':'#81b9ef','毒':'#8943B0',
  '地面':'#9C5A59','岩石':'#D3A865','虫':'#9CAE1E','幽灵':'#704170',
  '钢':'#60a1b8','火':'#E75357','水':'#3F98EA','草':'#3fa129',
  '电':'#F9CE40','超能':'#F8669C','冰':'#3fd8ff','龙':'#5060e1',
  '恶':'#61484B','妖精':'#E259E7',
};

export const ITEM_RATES = {
  'poke-ball': 1/90, 'ultra-ball': 1/220, 'master-ball': 1/900,
  'candy': 1/30, 'sweet-honey': 1/400, 'mystery-egg': 1/800, 'shiny-charm': 1/1000,
};

export const ITEM_NAMES = {
  'poke-ball':'精灵球','ultra-ball':'高级球',
  'master-ball':'大师球','candy':'糖果',
  'sweet-honey':'甜甜蜜','mystery-egg':'神秘蛋','shiny-charm':'闪耀护符',
};

export const ITEM_ICONS = {
  'poke-ball':'poke-ball.png','ultra-ball':'ultra-ball.png',
  'master-ball':'master-ball.png','candy':'candy.png',
  'sweet-honey':'honey.png','mystery-egg':'mystery-egg.png','shiny-charm':'shiny-charm.png',
};

export const CATCH_RATES = {
  'poke-ball':0.30,'ultra-ball':0.70,'master-ball':1.00,
};

export const CANDY_EXCHANGE = {
  'poke-ball': 10, 'ultra-ball': 25, 'master-ball': 50,
  'sweet-honey': 15, 'mystery-egg': 100, 'shiny-charm': 1000,
};

export const FLEE_CHANCE = 0.10;
export const ENCOUNTER_MIN = 120;
export const ENCOUNTER_MAX = 240;
export const SHINY_CHANCE = 1 / 1000;
export const REGION_CYCLE = ['关都','城都','丰缘','神奥','合众','卡洛斯','阿罗拉','伽勒尔','帕底亚'];
export const REGION_DURATION = 3600;
export const SAVE_INTERVAL = 30;
export const AUTO_FLEE_TIMEOUT = 30000;
export const AUTO_FLEE_NO_BALL_DELAY = 800;

export const BREAK_MSGS = {
  0: [
      '精灵球刚落地就被挣脱了！',
      '精灵球没稳住，它直接冲出来了！',
      '刚落地，宝可梦就突破了精灵球！',
      '精灵球一碰地面就被挣脱开来！',
      '落地一瞬，它便从精灵球脱身！'
  ],
  1: [
    '它一下就弹开了！',
    '宝可梦冲了出来！',
    '可恶，没能抓住它！',
    '真是可惜，差一点就抓住了！'
  ],
  2: [
    '就差一点点，没能收服它！',
    '哎呀，差一点就抓到了！',
    '眼看就要成功，可恶！',
    '这一次差一点就成功了！'
  ],
  3: [
    '明明差一点就要成功了！',
    '就差最后一下了！',
    '可惜！明明就差一点了！',
    '几乎要成功了！',
    '太可惜了！就差那么一下！'
  ]
};

export const REGION_OPTIONS = ['全部地区', '关都', '城都', '丰缘', '神奥', '合众', '卡洛斯', '阿罗拉', '伽勒尔', '帕底亚'];

export const BATTLE_BALLS = {
  'poke-ball': { closed: 'ball-00.png', open: 'ball-00-open.png' },
  'ultra-ball': { closed: 'ball-03.png', open: 'ball-03-open.png' },
  'master-ball': { closed: 'ball-04.png', open: 'ball-04-open.png' },
};

export const PICKUP_PLACES = ['在草丛里','在路边','在树荫下','在石头缝中','在花丛里','在水边','在泥土里','在落叶堆里','在沙地里','在墙角边','在小路上','在灌木丛中','在岩石下','在藤蔓旁','在溪滩边','在古树根','在青苔石','在碎石坡','在芦苇丛','在树洞中','在野莓丛','在干草堆','在卵石滩','在树桩旁'];
export const PICKUP_ACTIONS = ['踢了一下','随手拨开','扒拉了几下','俯身翻看','无意中踢到','随手一翻','扒开小土坑','扫开灰尘','蹲下来翻找','拂开落叶','刨开沙土','伸手摸索','掀开树皮','轻踹土块','伸手掏了掏','扫开细沙'];
export const PICKUP_RESULTS = ['捡到了','发现了','找到了','翻出了','捞到了','寻获了','意外拾获','顺手拾起','居然是','竟挖到','无意间摸出','凑巧找到','意外翻出','随手摸出','掘出了','捞起了'];

// ===== 路面滚动速度 =====
export const ROAD_SPEED_WALK = 0.6;   // 走路时瓦片滚动速度
export const ROAD_SPEED_RUN  = 1.1;   // 跑步时（buff生效）瓦片滚动速度
