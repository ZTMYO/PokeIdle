// ===== 闲置轮播消息 + 地区文案 =====
import { $, showView } from './ui.js';
import { phase, gameData, allPokemon, getPokemonByIndex, charmBuffActive, honeyBuffActive, blockBuffActive, getCurrentRegion, randInt, formatNum, _idleMsgs, _idleMsgIdx, _regionMsgInterval, _idleMsgTimer, _idlePickupTimer, setGameData, honeyCountdownEnd, charmCountdownEnd, setIdleMsgs, setIdleMsgIdx, setRegionMsgInterval, setIdleMsgTimer, setIdlePickupTimer, _fishing, getMassOutbreak, inMassZone, getTwist, inTwistZone, getRoadNumForEdge } from './state.js';
import { REGION_CYCLE } from './config.js';
import { ACHIEVEMENTS, earnedTiers, claimedTiers } from './achievements.js';
import * as road from './road.js';

// 对应9个世代大区的氛围文案
export const regionMsg = {
  0: [ // 关都 第1世代
    '一切冒险与羁绊，都从这片大陆启程。',
    '真新镇的晨风拂过草地，草丛中传来细微的动静。',
    '一百五十一种生灵，是图鉴最初的模样。',
    '常青森林的浓荫深处，栖身着关都最初的野生精灵。',
    '岩石隧道幽深曲折，地下通道连接着关都的各个角落。',
    '三圣鸟在传说中掌管着大陆的雷电、火焰与冰雪。',
    '华蓝洞窟的最深处，沉睡着最强的人工精灵。',
    '紫苑镇的灯塔照亮亡魂，也照亮了每个过客的勇气。',
    '金黄市与彩虹市一静一动，构成关都最繁华的十字路口。',
    '巍峨山巅之上风云际会，流传着关于最强宝可梦的传说。',
    '图鉴里写满了关于宝可梦的知识与热爱。',
    '最初的伙伴就在身边，属于这里的冒险故事刚刚开始。'
  ],
  1: [ // 城都 第2世代
    '与关都以常青森林为界，城都保留着更古朴的风貌。',
    '若叶镇的晨雾里，每一片叶子都承载着相遇的露珠。',
    '喇叭芽之塔的钟声，在每个清晨召唤虔诚的祈祷。',
    '烧焦塔的废墟之中，至今回荡着百年前的大火与悲鸣。',
    '桧皮镇的桐木林里，某种缓慢的精灵是乡亲们的牵挂。',
    '湛蓝市的瀑布之下，据说隐藏着远古海神的洞穴。',
    '圆朱市的双塔曾并肩伫立，如今只剩一座俯瞰沧海桑田。',
    '浅葱市的灯塔照亮了城都的整个西海岸。',
    '烟墨山中的龙之祠，古老龙族精灵世代栖息于此。',
    '白银山巅白雪皑皑，风雪之中隐藏着无数传说。',
    '从城都到关都的列车，串联起两片大陆的精灵生态。',
    '山间道路上，随处能偶遇性情温顺的野生精灵。'
  ],
  2: [ // 丰缘 第3世代
    '远古时代，大地与海洋的巨兽曾掀起惊天纷争。',
    '天空中的巨龙平息了绵延千年的海陆之战。',
    '大地与海洋的化身沉睡在不同的极端深处。',
    '未白镇的草丛随风摇曳，丰缘的野生精灵在此栖居。',
    '橙华森林深处，丰缘最初的虫系精灵等待邂逅。',
    '卡那兹市的得文公司，推动了丰缘的科技与精灵研究。',
    '武斗镇的潮汐洞窟随海流时隐时现。',
    '紫堇市的过山车游乐场是丰缘最繁华的地标。',
    '烟囱山顶与海底洞窟，勾勒出超古代之战的壮阔轮廓。',
    '流星瀑布里藏着诸多龙系精灵的秘密与遗骸。',
    '琉璃岛的海底是海陆之战最后的战场。',
    '飞流直下的瀑布群前，自然之力在此磅礴汇聚。'
  ],
  3: [ // 神奥 第4世代
    '天冠山如巨刃般贯穿大陆，分割了神奥的时空。',
    '世界诞生之初，时间与空间的神明在此降临。',
    '三座静谧的湖泊里，沉睡着掌管意志与感情的神灵。',
    '祝庆市是神奥最繁华的都市，也是探索的起点。',
    '百代森林里的森之洋馆，幽灵系精灵在此徘徊。',
    '黑金市的矿坑之下，岩石与钢系的精灵组成了一个地下世界。',
    '天冠山巅的枪之柱，是创世神话的核心所在。',
    '神和镇的古老传说，记录了世界被创造的完整史诗。',
    '雪峰市终年积雪，冰系精灵在这里自在地生活。',
    '河岸城市的湿原地带，孕育了多种草系与水系精灵。',
    '立志湖畔水波粼粼，无数精灵在此栖息繁衍。',
    '反转世界与现实交错，轮换之间守护着空间的裂隙。',
    '悬崖边的神殿里，传说的守护者曾在此筑巢。'
  ],
  4: [ // 合众 第5世代
    '鹿子镇的风车缓缓转动，迎来了合众的第一缕阳光。',
    '理想与真实，化作两条背道而驰的传说之龙。',
    '三曜市的三种属性精灵各据一方，构成奇妙的生态格局。',
    '飞云市的摩天楼群，是合众最繁华的商业与文化中心。',
    '七宝市的博物馆里，陈列着合众远古时期的精灵化石。',
    '雷文市的夜晚比白天更热闹，摩天轮的灯光照亮整个街区。',
    '帆巴吊桥横跨峡谷，脚下是常年弥漫的白色浓雾。',
    '吹寄市的机场连接着合众与世界的天空。',
    '雪花市的皑皑白雪下，沉睡着古老的冰系遗迹。',
    '蜿蜒道路的尽头，城堡从地底升起，宣告远古传说的终局。',
    '双龙市的古老传说中，两条龙系精灵曾在此决战。',
    '世界各地的精灵汇聚于此，展现着各自的风采与力量。',
    '古代城堡的深处，沙暴之中隐藏着合众最古老的秘密。'
  ],
  5: [ // 卡洛斯 第6世代
    '朝香镇的花海随风起伏，是卡洛斯最温柔的序章。',
    '生命与毁灭的双神，执掌着万物的轮回。',
    '白檀市的林间栖息着虫系精灵，翅膀在阳光下闪闪发光。',
    '密阿雷市的棱镜塔在夕阳下闪耀着六色光芒。',
    '比翼市的石雕与潺潺流水，诉说着卡洛斯的历史与浪漫。',
    '娑娜市的咖啡馆飘着香气，精灵与人们在此共享悠闲时光。',
    '百刻市的日晷核心，与超进化的秘密息息相关。',
    '荒废酒店与精灵村之间，幽灵系精灵的传说从未间断。',
    '风絮镇的风车缓缓转动，妖精系的精灵在花丛中起舞。',
    '地下秘密基地里，藏着卡洛斯最危险的野心。',
    '峭壁之间的核心精灵，静静守护着整片大陆的生态平衡。',
    '卡洛斯地区的每一处古堡，都藏着与超进化相关的秘密。'
  ],
  6: [ // 阿罗拉 第7世代
    '同样的精灵，在阿罗拉的热带阳光下演化出了全新的模样。',
    '四座岛屿各有守护神，世代庇佑一方生灵。',
    '好奥乐市的白色沙滩上，阳光与海风是永恒的背景音乐。',
    '利利小镇的花田中，年幼的精灵在草丛间嬉戏。',
    '葱郁洞窟里栖息着多种虫系与草系的区域形态。',
    '波尼古道的熔岩地带，火系的区域形态精灵随处可见。',
    '以太乐园的海上穹顶下，人工培育的精灵拥有全新的基因。',
    '乌拉乌拉岛的超市遗迹里，幽灵系精灵半夜会出来逛街。',
    '雪山之巅的冰雪中，隐藏着冰系区域形态的稀有身影。',
    '地下隧道穿越整座岛屿，连接着阿罗拉的过去与现在。',
    '环岛水域里，栖息着阿罗拉最独特的水系精灵。',
    '四座岛屿的最高处，自然之力在此交汇共鸣。',
    '波尼岛的远古遗迹里，守护神的守护之力至今仍在脉动。'
  ],
  7: [ // 伽勒尔 第8世代
    '化朗镇宁静的牧场清晨，双剑与盾的英雄传说仍在风中回荡。',
    '广袤的旷野地带连接着多个城镇，无数精灵在此自由地漫游。',
    '极巨化的红色能量云是伽勒尔独有的自然现象。',
    '木杆镇的火车驶过草间，旷野之上的精灵随之惊醒。',
    '机擎市的工业区里，钢系与火系精灵与机械共存。',
    '草路镇的古老石阵与微寐森林，封存着英雄的远古传说。',
    '溯传镇的遗迹之上，伽勒尔的历史层层叠加。',
    '舞姿镇的街头每天都上演着精灵与人类的舞蹈庆典。',
    '战竞镇的岩山之上，格斗系的精灵日夜锤炼。',
    '拳关丘陵的地下遗迹里，英雄的史诗仍在传颂。',
    '王冠雪原的冰封大地下，沉睡着一代又一代的上古传说。',
    '远海的孤岛与极寒的雪原，为伽勒尔补全了被遗忘的历史。'
  ],
  8: [ // 帕底亚 第9世代
    '传说神兽一为远古一为未来，驰骋整片大地。',
    '太晶化的璀璨结晶之力，让每只精灵都焕发出新的光彩。',
    '学院的三条校规——学习、探索、结交伙伴——在帕底亚代代相传。',
    '桌台市的钟楼俯瞰四方，来自各地的精灵在此和谐共处。',
    '南区的平原上，最寻常的草系精灵在草丛里安家。',
    '东区的山脉中，岩石与格斗系的精灵守护着古老的洞窟。',
    '西区的海岸线绵延不绝，水系与飞行系的精灵在海风中翱翔。',
    '北区的雪山上，冰系与超能系的精灵静候来访者。',
    '第零区的时空异象里，悖谬精灵的存在挑战着进化论的边界。',
    '渍沁镇的陶艺与酿光市的科技，代表了帕底亚的两张面孔。',
    '锦穴山道贯通南北，太晶碎片在地面下闪闪发光。',
    '群山环绕的盆地中央，自然之力静静等候着新的见证。'
  ]
};

// 路边拾取道具的随机动作/结果文案
export const PICKUP_ACTIONS = ['踢了一下', '随手拨开', '扒拉了几下', '俯身翻看', '无意中踢到', '随手一翻', '扒开小土坑', '扫开灰尘', '蹲下来翻找', '拂开落叶', '刨开沙土', '伸手摸索', '掀开树皮', '轻踹土块', '伸手掏了掏', '扫开细沙'];
export const PICKUP_RESULTS = ['捡到了', '发现了', '找到了', '翻出了', '捞到了', '寻获了', '意外拾获', '顺手拾起', '居然是', '竟挖到', '无意间摸出', '凑巧找到', '意外翻出', '随手摸出', '掘出了', '捞起了'];

// 上次构建闲置消息时的数据快照：物品/图鉴/统计/成就/悬赏任一变，文案都需重建以保持同步
let _msgSnapshot = '';

// 当前闲置消息依赖数据的稳定字符串快照。
function msgDataSnapshot() {
  const d = gameData || {};
  const s = d.stats || {};
  const items = Object.entries(d.items || {})
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
  const dex = Object.entries(d.pokedex || {})
    .filter(([, e]) => e && (e.seen > 0 || e.caught > 0))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, e]) => `${k}:${e.seen || 0}:${e.caught || 0}:${e.shinyCaught || 0}`)
    .join('|');
  const ach = Object.entries(d.achievements || {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
  const b = d.bounty;
  return [
    items,
    `${s.totalShinySeen || 0}|${s.totalShinyCaught || 0}|${s.totalCatches || 0}|${s.totalPlaySeconds || 0}|${s.totalBallsUsed || 0}|${s.totalFlees || 0}|${s.totalEggsHatched || 0}`,
    dex,
    ach,
    b ? `${b.date || ''}|${(b.visited || []).join(',')}|${JSON.stringify(b.rewards)}` : '',
  ].join(';;');
}

export function buildIdleMessages() {
  if (!gameData) return;
  _msgSnapshot = msgDataSnapshot();
  const stats = gameData.stats;
  const pokedex = gameData.pokedex;
  const caught = Object.values(pokedex).filter(e => e.caught > 0).length;
  const total = allPokemon.length;
  const shinySeen = stats.totalShinySeen;
  const shinyCaught = stats.totalShinyCaught;
  const entries = Object.entries(pokedex).filter(([, e]) => e.seen > 0).map(([idx, e]) => ({ ...e, _idx: idx }));
  // 编号查名字（存档只存编号，名字从图鉴数据查表）
  const nameOf = idx => { const p = getPokemonByIndex(idx); return p ? p.name : '#' + idx; };
  const msgs = [];

  // ——— 教程指引类 ———
  const guideMsgs = [
    '点击精灵球可丢出，收服野生的宝可梦！',
    '手机里的图鉴应用，记录着你的每一次相遇。',
    '糖果可以在商店兑换成各种精灵球。',
    '甜甜蜜可以吸引更多宝可梦来访。',
    '捡到的神秘蛋会孵出随机宝可梦！',
    '手机里的孵蛋器，可以管理正在孵化的神秘蛋。',
    '遇见的宝可梦都会记录在图鉴。',
    '闪光宝可梦非常稀有，遇见了不要错过！',
    '大师球百分百捕获，留给最想要的宝可梦吧。',
    '高级球对稀有宝可梦有额外捕获加成，抓神兽时更稳。',
    '手机里的导航应用，可以规划前往其他地区的路线。',
    '这是由ZTMYO个人开发的同人游戏。',
    '这是由ZTMYO个人开发的同人游戏。',
    '完成地区悬赏，能换来一大笔糖果奖励！',
    '混合器把树果做成树果方块，能吸引特定的宝可梦。',
    '饲育屋让两只宝可梦配对繁殖，培育出高个体值后代。',
    '同蛋组的宝可梦可以配对繁殖，培育出高个体值后代。',
    '战胜训练家，有机会掉落经验糖果。',
    '训练家对战中，上场且最终存活的宝可梦将得到经验。',
    '在水域场景，有机会钓起稀有的宝可梦！',
    '事件点会明显提高闪光率且闪耀护符不生效！',
    '开启自动操作，遇敌会自动捕捉或逃跑，挂机更省心。',
    '在自行车道上捡到的自行车可以在需要的时候用来赶路。',
    '手机里的交换应用，可以和训练家互换宝可梦。',
    '游戏厅里能玩 21 点、口袋麻将，赚游戏币抽卡！',
    '训练中的宝可梦会饿，给他们准备足够的树果吧！',
    '在宝可梦详情页可以给宝可梦配置招式。',
    '点击列表的表头可以对列表进行对应的排序。',
    '在商店右键购买按钮可以批量购买道具。',
    '在配队页面右键可以随机配队和清空配队。',
    '在招式列表右键可以对招式进行不同的排序。',
    '到达指定的地区才可以提交地区悬赏。',
    '放生宝可梦会返还经验，累积可获得经验糖果。',
    '在设置页面可以导出和导入游戏存档。',
    '抽取宝可梦随从可以获得限时增益！'
  ];
  // 教程指引类分散投入数组：轮播按顺序推进，若连续 push 会连排出现，此处只投开头 1 条
  msgs.push(guideMsgs[randInt(0, guideMsgs.length - 1)]);

// ——— 原作致敬情怀短句 ———
const tributeMsgs = [
  '我的目标，是成为宝可梦大师！',
  '和宝可梦一同踏上冒险之旅吧。',
  '相遇即是缘分，好好珍惜每一只伙伴。',
  '广阔世界，还有无数宝可梦等待邂逅。',
  '每一次相遇，都是独一无二的回忆。',
  '哪怕路途遥远，也不要停下脚步。',
  '闪光的相遇，是独一份的幸运。',
  '草丛之中，藏着无限惊喜。',
  '不必急于求成，慢慢收集所有伙伴。',
  '精灵球承载着我与宝可梦的约定。',
  '只要心怀热爱，冒险永远不会结束。',
  '每一只宝可梦，都拥有属于自己的温柔。',
  '怀揣期待踏入草丛，下一份邂逅就在前方。',
  '羁绊不分强弱，遇见便是最好的馈赠。',
  '就算孤身前行，草丛里的伙伴也会等候你。',
  '追寻闪光的旅途，本身就是一种浪漫。',
  '精灵球轻晃的声响，是冒险的序曲。',
  '走遍每一片原野，收录所有珍贵身影。',
  '永远保持初次踏上旅途时的那份热忱。',
  '世间万千宝可梦，每一只都值得被铭记。',
];
msgs.push(tributeMsgs[randInt(0, tributeMsgs.length - 1)]);
// 教程指引第 2 条：夹在致敬与闲聊之间，避免与首尾的指引连排
msgs.push(guideMsgs[randInt(0, guideMsgs.length - 1)]);

// ——— 轻松趣味闲聊 ———
const chatMsgs = [
  '今天会不会遇见稀有闪光宝可梦呢？',
  '多攒一些糖果，去商店兑换些好东西吧。',
  '再多准备几颗精灵球，防止宝可梦逃走。',
  '手机里的统计应用，记录着一路的收获与欧气。',
  '不知道下一次草丛里会出现谁。',
  '错过的闪光精灵，下次一定要抓住！',
  '今天的运气还不错，继续前进吧！',
  '宝可梦的世界总是在发生新的故事……',
  '囤一点甜甜蜜，加快遇见宝可梦的速度吧。',
  '神秘蛋里藏着未知的惊喜。',
  '回头看看手机里的图鉴，全是一路走来的回忆。',
  '大师球要省着用，留给难得一见的闪光。',
  '草丛静悄悄的，说不定稀有宝可梦正在靠近。',
  '已经遇见那么多伙伴，离全图鉴又近一步。',
  '要是遇上闪光个体，可千万别让它逃跑啦。',
  '挂机攒糖果的时光，也是冒险的一部分。',
  '清点一下背包，精灵球储备还充足吗？',
  '孵化一颗神秘蛋，收获全新的伙伴。',
  '运气正在慢慢积攒，闪光或许马上出现。',
];
msgs.push(chatMsgs[randInt(0, chatMsgs.length - 1)]);
  // ——— 里程碑收集类 ———
  if (caught > 0) {
    if (caught >= total) msgs.push('全部宝可梦都已收录！你当之无愧是宝可梦大师！');
    else {
      const pct = Math.round(caught / total * 100);
      if (pct >= 75) msgs.push(`图鉴收集进度${pct}%，只差一点就能集齐所有伙伴！`);
      else if (pct >= 50) msgs.push(`图鉴完成${pct}%，继续去草丛寻找新伙伴吧！`);
      else if (pct >= 25) msgs.push(`图鉴进度${pct}%，探索之路刚刚开始！`);
      else msgs.push(`已经收服${caught}只宝可梦，冒险才刚刚开始！`);
    }
  } else {
    msgs.push('还没有收服过宝可梦……随时会有野生的出现！');
  }
  if (stats.totalCatches > 0) {
    if (stats.totalCatches >= 1000) msgs.push(`累计收服${formatNum(stats.totalCatches)}只宝可梦，一路上邂逅了无数伙伴！`);
    else if (stats.totalCatches >= 500) msgs.push(`已经收服了${stats.totalCatches}只宝可梦，收获满满！`);
    else if (stats.totalCatches >= 100) msgs.push('已经收服上百只宝可梦，收获满满！');
    else msgs.push(`成功收服${stats.totalCatches}只野生宝可梦！`);
  }
  if (stats.totalPlaySeconds >= 3600) {
    const hours = Math.round(stats.totalPlaySeconds / 3600);
    if (hours >= 168) msgs.push(`已经连续冒险${Math.round(hours/24)}天，准备好成为宝可梦大师了。`);
    else msgs.push(`已经连续冒险${hours}小时，，准备好成为宝可梦大师了。`);
  }
  if (stats.totalBallsUsed > 0) msgs.push(`至今一共抛出${stats.totalBallsUsed}颗精灵球。`);
  if (stats.totalFlees > 0) msgs.push(`有${stats.totalFlees}只宝可梦挣脱精灵球逃走了……`);
  if (stats.totalEggsHatched > 0) msgs.push(`孵化出${stats.totalEggsHatched}颗神秘蛋，见证了许多新生。`);

  // ——— 闪光专属文案 ———
  if (shinySeen > 0) {
    msgs.push(`已经邂逅${shinySeen}次罕见闪光宝可梦！`);
    if (shinyCaught > 0) msgs.push(`成功留住${shinyCaught}只闪光宝可梦！`);
    if (shinyCaught >= 3) msgs.push('你的闪光收藏队伍越来越耀眼！');
    if (shinyCaught < shinySeen) msgs.push('闪光精灵曾经现身，下次别让它逃走！');
  } else {
    msgs.push('还没有邂逅闪光宝可梦，耐心等待惊喜到来。');
  }

  // ——— 图鉴回忆类 ———
  if (entries.length > 0) {
    // 从所有相遇过的宝可梦中平等概率抽取（已捕获→回忆；遇见但未捕获→草丛等待，两条文案概率均等）
    const pick1 = entries[randInt(0, entries.length - 1)];
    if (pick1.caught > 0) {
      msgs.push(`还记得初次遇见${nameOf(pick1._idx)}的时刻，它是珍贵的伙伴。`);
      if (pick1.shinyCaught > 0) msgs.push(`你拥有一只闪光${nameOf(pick1._idx)}，这般运气十分难得！`);
    } else {
      msgs.push(`${nameOf(pick1._idx)}仍藏在野外草丛，期待与你的再次相遇。`);
      msgs.push(`你遇到过${nameOf(pick1._idx)}${pick1.seen}次了，下次一定要抓住它！`);
    }

    if (entries.length > 3) {
      let pick2 = entries[randInt(0, entries.length - 1)];
      let tries = 0;
      while (pick2 === pick1 && entries.length > 1 && tries < 10) {
        pick2 = entries[randInt(0, entries.length - 1)];
        tries++;
      }
      if (pick2 && pick2.caught > 0) msgs.push(`和${nameOf(pick2._idx)}一起经历了许多冒险呢。`);
    }

    const sorted = [...entries].sort((a, b) => b.seen - a.seen);
    const top = sorted[0];
    if (top.seen >= 3) msgs.push(`最容易遇到的是${nameOf(top._idx)}（${top.seen}次）。`);
    if (sorted.length > 1 && sorted[1].seen >= 3) {
      msgs.push(`第二常见的是${nameOf(sorted[1]._idx)}（${sorted[1].seen}次）。`);
    }
    if (top.seen >= 20) msgs.push(`${nameOf(top._idx)}已经见了${top.seen}次了，真有缘分！`);

    // 最稀有：被看到但从未捕获的
    const uncaptured = entries.filter(e => e.caught === 0);
    if (uncaptured.length > 0) {
      const rarest = uncaptured.sort((a, b) => b.seen - a.seen)[0];
      if (rarest.seen >= 2) msgs.push(`${nameOf(rarest._idx)}逃走了${rarest.seen}次，下次一定要抓住它！`);
    }
  }

  // ——— 种类数统计 ———
  const seenSpecies = Object.values(pokedex).filter(e => e.seen > 0).length;
  msgs.push(`已相遇 ${seenSpecies}/${total} 种宝可梦。`);
  if (caught > 0) msgs.push(`已捕获 ${caught}/${total} 种，继续加油！`);
  if (shinySeen > 0) msgs.push(`遇到了 ${shinySeen} 只闪光宝可梦！`);
  if (shinyCaught > 0) msgs.push(`捕获了 ${shinyCaught} 只闪光宝可梦！`);

  // ——— 道具资源类 ———
  const items = gameData.items;
  const ballCount = (items['poke-ball']||0) + (items['ultra-ball']||0) + (items['master-ball']||0);
  if (ballCount > 0) {
    if (ballCount >= 100) msgs.push(`背包里有${ballCount}颗精灵球，弹药充足！`);
    else msgs.push(`背包里有${ballCount}颗精灵球，随时准备出发！`);
  }
  if ((items['ultra-ball']||0) > 0) msgs.push(`高级球${items['ultra-ball']}颗在手，高级的宝可梦也不怕！`);
  if ((items['master-ball']||0) > 0) msgs.push(`你有${items['master-ball']}颗大师球！无惧任何宝可梦！`);
  if ((items['candy']||0) > 0) msgs.push(`攒了${items['candy']}颗糖果，去商店看看有什么好东西吧！`);
  if ((items['candy']||0) >= 100) msgs.push(`糖果已经${items['candy']}颗了，兑换一些精灵球如何？`);
  if ((items['sweet-honey']||0) > 0) msgs.push(`甜甜蜜还剩${items['sweet-honey']}瓶，涂上它会更容易遇到宝可梦！`);
  if ((items['mystery-egg']||0) > 0) msgs.push(`神秘蛋×${items['mystery-egg']}，孵化看看是什么宝可梦！`);
  if ((items['mystery-egg']||0) >= 5) msgs.push(`攒了${items['mystery-egg']}颗蛋了，来一次批量孵化吧！`);
  if ((items['shiny-charm']||0) > 0) msgs.push(`闪耀护符×${items['shiny-charm']}，价值不菲的珍稀道具！`);
  if ((items['shiny-charm']||0) > 0) msgs.push('闪耀护符可以提升遇见闪光宝可梦的几率！');
  if ((items['shiny-charm']||0) >= 2) msgs.push(`手握${items['shiny-charm']}个闪耀护符，随时准备迎接奇迹降临！`);

  // ——— 成就类 ———
  const ach = gameData.achievements || {};
  const achCount = Object.values(ach).reduce((s, v) => s + (v || 0), 0);
  if (achCount > 0) {
    msgs.push(`已在成就列表领取 ${formatNum(achCount)} 级奖励，每一步冒险都被铭记。`);
    if ((ach['candy'] || 0) > 0) msgs.push(`「糖果富翁」已达成 ${ach['candy']} 级，糖果越攒越丰厚！`);
    if ((ach['dex'] || 0) >= 5) msgs.push('「图鉴收藏家」几近满级，离全图鉴只差一步！');
    if ((ach['hatch'] || 0) > 0) msgs.push(`孵化成就已达成 ${ach['hatch']} 级，见证了许多新生命的诞生。`);
    if ((ach['shinyCaught'] || 0) > 0) msgs.push(`「闪光猎手」已达 ${ach['shinyCaught']} 级，运气非同一般！`);
    if ((ach['bounty'] || 0) > 0) msgs.push(`赏金猎人成就已领 ${ach['bounty']} 级，悬赏之路稳步前行。`);
  }
  const pendingAch = ACHIEVEMENTS.filter(a => earnedTiers(a) > claimedTiers(a.id)).length;
  if (pendingAch > 0) msgs.push(`有 ${pendingAch} 项成就达到领取条件，打开手机里的「成就」应用领取奖励吧！`);

  // ——— 地区悬赏类 ———
  const bounty = gameData.bounty;
  if (bounty && Array.isArray(bounty.rewards)) {
    // 从今日已到访地区的悬赏目标中随机挑一只未提交的，附上实际出没地区，
    // 这样即使没见过它，看到文案也知道该去哪里抓
    const targets = [];
    for (let i = 0; i < bounty.rewards.length; i++) {
      if (bounty.visited && !bounty.visited[i]) continue;
      for (const b of bounty.rewards[i]) {
        if (b && !b.claimed) {
          const p = getPokemonByIndex(b.pokemon);
          if (p) targets.push(p);
        }
      }
    }
    if (targets.length > 0) {
      const pick = targets[randInt(0, targets.length - 1)];
      msgs.push(`「${pick.name}」正在${pick.region}地区等待你的捕捉！`);
    }
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (bounty.date === todayStr) {
      let total = 0, claimed = 0;
      for (const list of bounty.rewards) {
        for (const b of list) {
          if (!b) continue;
          total++;
          if (b.claimed) claimed++;
        }
      }
      const unclaimed = total - claimed;
      if (unclaimed > 0) msgs.push(`今日悬赏还有${unclaimed}份糖果奖励没提交，抓到目标就去提交！`);
      else if (total > 0) msgs.push('今日悬赏已全部提交，明天零点又会刷新新目标！');
    }
    msgs.push('完成地区悬赏能换来糖果作为奖励。');
    msgs.push('各个地区的悬赏目标，能获得大量糖果奖励。');
  } else {
    msgs.push('地区悬赏每天零点刷新，别忘了去查看目标。');
  }

  // 教程指引第 3 条：落在数组末尾，其后补一条闲聊收尾，
  // 保证轮播从末尾跳回开头时不会出现两条指引连排
  msgs.push(guideMsgs[randInt(0, guideMsgs.length - 1)]);
  msgs.push(chatMsgs[randInt(0, chatMsgs.length - 1)]);

  // 加入当前地区氛围文案（由 rotateIdleMessage 按间隔插入，此处不移入）
  setIdleMsgs(msgs);
}

// buff 效果轮播文案（闪耀护符 / 树果方块 / 甜甜蜜）：
// 单独轮播时按各自数组轮换，与普通/闲聊/教学文案混在同一显示序列
const CHARM_BUFF_MSGS = [
  '✦ 闪耀护符的光芒照亮了天空...',
  '✦ 前方似乎有稀有的气息...',
  '✦ 奇迹随时可能发生...',
  '✦ 闪耀护符在微微发烫！',
  '✦ 直觉告诉你，好东西要来了...',
];
const BLOCK_BUFF_MSGS = [
  '✦ 树果方块的香气随风飘散...',
  '✦ 似乎有宝可梦被树果方块吸引过来了！',
  '✦ 树果方块散发着诱人的果香...',
  '✦ 好像有宝可梦在靠近...',
];
const HONEY_BUFF_MSGS = [
  '✦ 甜甜蜜的芬芳随风飘散...',
  '✦ 附近的宝可梦被吸引了！',
  '✦ 草丛里传来了动静...',
  '✦ 甜甜蜜的味道越来越浓...',
  '✦ 好像有什么在靠近...',
];

export function rotateIdleMessage() {
  if (phase !== 'idle') return;
  // 数据变化后重建消息列表（拾取/消费/捕获/成就/悬赏等都会改变），保持文案与实况同步
  if (msgDataSnapshot() !== _msgSnapshot) buildIdleMessages();
  // 自行车道文案优先级最高（优先于 buff 轮播）：骑行期间只显示骑行相关文案；
  // 例外是 buff 到期，到期文案由 items.js 直接写入 idleText，不经过本函数
  if (road.isBike()) {
    const msgs = [
      '风声从耳边掠过！',
      '车轮碾过天桥的缝隙...',
      '这段路，专心骑行。',
      '一路生风，向前冲刺！',
      '天桥在脚下延伸。',
      '骑行节奏越来越稳。',
      '高架之上，畅快骑行。',
      '咔嚓，咔嚓——链条轻响。',
      '骑到天桥尽头去！',
      '骑上我心爱的自行车！'
    ];
    setIdleMsgIdx((_idleMsgIdx + 1) % msgs.length);
    $('idleText').textContent = msgs[_idleMsgIdx];
    return;
  }
  if (charmBuffActive) {
    setIdleMsgIdx((_idleMsgIdx + 1) % CHARM_BUFF_MSGS.length);
    $('idleText').textContent = CHARM_BUFF_MSGS[_idleMsgIdx];
    return;
  }
  if (blockBuffActive) {
    setIdleMsgIdx((_idleMsgIdx + 1) % BLOCK_BUFF_MSGS.length);
    $('idleText').textContent = BLOCK_BUFF_MSGS[_idleMsgIdx];
    return;
  }
  if (honeyBuffActive) {
    setIdleMsgIdx((_idleMsgIdx + 1) % HONEY_BUFF_MSGS.length);
    $('idleText').textContent = HONEY_BUFF_MSGS[_idleMsgIdx];
    return;
  }
  // 每 3 条普通文案后插入一条地区氛围文案
  setRegionMsgInterval(_regionMsgInterval + 1);
  if (_regionMsgInterval >= 3) {
    setRegionMsgInterval(0);
    const region = getCurrentRegion();
    const msgs = regionMsg[region.id];
    if (msgs && msgs.length > 0) {
      $('idleText').textContent = msgs[randInt(0, msgs.length - 1)];
      return;
    }
  }
  // 普通消息轮播
  if (_idleMsgs.length === 0) buildIdleMessages();
  if (_idleMsgs.length > 0) {
    setIdleMsgIdx((_idleMsgIdx + 1) % _idleMsgs.length);
    $('idleText').textContent = _idleMsgs[_idleMsgIdx];
  }
}

export function showIdlePickup(itemName, place) {
  const loc = place;
  const action = PICKUP_ACTIONS[randInt(0, PICKUP_ACTIONS.length - 1)];
  const result = PICKUP_RESULTS[randInt(0, PICKUP_RESULTS.length - 1)];
  $('idleText').textContent = `${loc}${action}，${result}${itemName}！`;
  // 重置轮播间隔，道具文案展示 10 秒后自然过渡到下一条
  if (_idleMsgTimer) {
    clearInterval(_idleMsgTimer);
    setIdleMsgTimer(setInterval(rotateIdleMessage, 10000));
  }
}

// ===== 钓鱼轮播文字 =====
export const FISHING_WAIT_MSGS = [
  '✦ 水面泛起层层涟漪...',
  '✦ 鱼竿在轻轻晃动...',
  '✦ 耐心等待，浮漂微微下沉...',
  '✦ 水面下传来微弱的动静...',
  '✦ 波纹一圈圈扩散开去...',
  '✦ 鱼线绷紧了！再等等...',
  '✦ 静静垂钓，享受此刻的宁静...',
  '✦ 浮漂轻轻点动，有东西就在附近...',
  '✦ 远处水花溅起，今天运气如何呢？',
  '✦ 握住鱼竿，感受水下的节奏...',
];

export const FISHING_RESULTS = ['钓到了','钓上来','收获了','拽上来','稳稳收起'];

// 钓鱼等待期间：每 5 秒轮换一条钓鱼文案
export function showFishingWait() {
  if (_idleMsgTimer) clearInterval(_idleMsgTimer);
  setIdleMsgIdx(-1);
  $('idleText').textContent = FISHING_WAIT_MSGS[0];
  setIdleMsgTimer(setInterval(() => {
    setIdleMsgIdx(_idleMsgIdx + 1);
    $('idleText').textContent = FISHING_WAIT_MSGS[_idleMsgIdx % FISHING_WAIT_MSGS.length];
  }, 5000));
}

// 钓鱼收获：结果文案展示 10 秒后自然过渡回普通轮播
export function showFishingResult(itemName, qty, place) {
  const loc = place || '在河边';
  const result = FISHING_RESULTS[randInt(0, FISHING_RESULTS.length - 1)];
  $('idleText').textContent = `${loc}，${result}${itemName}×${qty}！`;
  if (_idleMsgTimer) {
    clearInterval(_idleMsgTimer);
    setIdleMsgTimer(setInterval(rotateIdleMessage, 10000));
  }
}

// 显示 buff 结束的"效果渐渐褪去"轮播文案
export function showBuffExpired(kind) {
  $('idleText').textContent = kind === 'honey'
    ? '✦ 甜蜜蜜的效果渐渐褪去了...'
    : '✦ 闪耀护符的效果渐渐褪去了...';
}

export function startIdleRotation() {
  if (_idleMsgTimer) clearInterval(_idleMsgTimer);
  setRegionMsgInterval(0);
  // 初始显示第一个
  buildIdleMessages();
  if (_idleMsgs.length > 0) {
    setIdleMsgIdx(0);
    $('idleText').textContent = _idleMsgs[0];
  }
  // 每 10 秒轮换
  setIdleMsgTimer(setInterval(rotateIdleMessage, 10000));
}

// ===== 大量出没提示文案 =====
// 玩家在别的区域 → 随机「xxx在xx道路大量出没」；玩家在事件路段 → 对应区域文案
const MASS_FAR_MSGS = (name, road, remain) => [
  `✦ ${name}在${road}大量出没，去看看吧！`,
  `✦ ${road}一带${name}成群出没，还剩${remain}只！`,
  `✦ ${road}方向传来骚动，似乎是${name}大量出没！`,
];
const MASS_ZONE_MSGS = (name, remain) => [
  `✦ 大量出没的${name}就在附近！`,
  `✦ 草丛里${name}的动静不断，还剩${remain}只！`,
  `✦ ${name}成群结队地出现了，抓紧捕捉！`,
  `✦ 大量出没中！还剩${remain}只${name}！`,
  `✦ 附近全是${name}，别让它们溜走了！`,
];

// 事件路段的道路编号（如「6#道路」）；不在道路网络时退化为地区间描述
function massRoadStr(mo) {
  const num = getRoadNumForEdge(mo.edge, mo.t);
  if (num != null) return `${num}#道路`;
  return `${REGION_CYCLE[Math.min(mo.edge[0], mo.edge[1])]}↔${REGION_CYCLE[Math.max(mo.edge[0], mo.edge[1])]}的道路`;
}

// 按玩家所处位置随机挑一条提示文案
function pickMassMsg() {
  const mo = getMassOutbreak();
  if (!mo) return '';
  const poke = getPokemonByIndex(mo.pokemon);
  // 消息区显示全名，便于识别大量出没的具体形态
  const name = poke ? (poke.form || poke.name) : '宝可梦';
  const remain = Math.max(0, mo.remain);
  if (inMassZone()) {
    const list = MASS_ZONE_MSGS(name, remain);
    return list[randInt(0, list.length - 1)];
  }
  const list = MASS_FAR_MSGS(name, massRoadStr(mo), remain);
  return list[randInt(0, list.length - 1)];
}

// 向闲置文案写入一条即时提示，并重置 10 秒轮播计时
function pushIdleEventMsg(text) {
  if (!text) return;
  $('idleText').textContent = text;
  setIdleMsgIdx(-1);
  if (_idleMsgTimer) {
    clearInterval(_idleMsgTimer);
    setIdleMsgTimer(setInterval(rotateIdleMessage, 10000));
  }
}

// 事件活跃期间的提示轮播状态
let _lastMassMsgAt = 0;
let _wasInMassZone = false;

// 事件生成：以"此刻"为起点推送一条随机提示，避免立即重复推送
export function notifyMassStart() {
  _lastMassMsgAt = Date.now();
  _wasInMassZone = inMassZone();
  pushIdleEventMsg(pickMassMsg());
}

// 事件结束：提示散去并复位轮播状态
export function notifyMassEnd(mo) {
  const poke = getPokemonByIndex(mo.pokemon);
  pushIdleEventMsg(`大量出没的${poke ? (poke.form || poke.name) : '宝可梦'}渐渐散去了……`);
  _lastMassMsgAt = 0;
  _wasInMassZone = false;
}

// 事件活跃期间按玩家位置轮播提示：刚进入事件路段立即提示，其余按远近间隔补充
export function massMsgTick(now) {
  const mo = getMassOutbreak();
  if (!mo || phase !== 'idle' || _fishing) return;
  if ($('idleView')?.style.display === 'none') return; // 非主界面不打扰
  const zone = inMassZone();
  if (zone && !_wasInMassZone) {
    // 刚进入事件路段：立即提示，让玩家意识到已经在事件区域内
    _wasInMassZone = true;
    _lastMassMsgAt = now;
    pushIdleEventMsg(pickMassMsg());
    return;
  }
  if (!zone) _wasInMassZone = false;
  // 区域内每 3 分钟轮播一次、区域外每 5 分钟提醒一次：事件频繁发生（一次 1~2 小时），
  // 太密的提示会让玩家疲于应付；只需要在接近/身处事件时保持存在感即可
  const interval = zone ? 180000 : 300000;
  if (now - _lastMassMsgAt >= interval) {
    _lastMassMsgAt = now;
    pushIdleEventMsg(pickMassMsg());
  }
}

// ===== 时空扭曲提示文案 =====
// 与大量出没共用一套轮播机制，文案突出"跨地区异时空"的稀有感
const TWIST_FAR_MSGS = (road, remain) => [
  `✦ ${road}上空裂开了异时空的缝隙，时空扭曲出现了！`,
  `✦ 异时空的波动从${road}方向传来，还剩${remain}只可遭遇！`,
  `✦ ${road}一带时空扭曲，来自各地的宝可梦正在汇聚！`,
  `✦ 时空扭曲出现在${road}，抓紧时间前去查看！`,
];
const TWIST_ZONE_MSGS = (remain) => [
  `✦ 时空扭曲近在眼前，异时空的宝可梦正在现身！`,
  `✦ 扭曲深处传来陌生的气息，还剩${remain}只可遭遇！`,
  `✦ 附近的空间不断扭曲闪烁，宝可梦一只接一只出现！`,
  `✦ 抓住机会！扭曲中的宝可梦还剩${remain}只！`,
];

// 时空扭曲事件点所在路段描述
function twistRoadStr(tw) {
  const num = getRoadNumForEdge(tw.edge, tw.t);
  if (num != null) return `${num}#道路`;
  return `${REGION_CYCLE[Math.min(tw.edge[0], tw.edge[1])]}↔${REGION_CYCLE[Math.max(tw.edge[0], tw.edge[1])]}的道路`;
}

// 按玩家所处位置随机挑一条扭曲提示
function pickTwistMsg() {
  const tw = getTwist();
  if (!tw) return '';
  const remain = Math.max(0, tw.remain);
  if (inTwistZone()) {
    const list = TWIST_ZONE_MSGS(remain);
    return list[randInt(0, list.length - 1)];
  }
  const list = TWIST_FAR_MSGS(twistRoadStr(tw), remain);
  return list[randInt(0, list.length - 1)];
}

// 时空扭曲轮播状态（与大量出没独立）
let _lastTwistMsgAt = 0;
let _wasInTwistZone = false;

// 事件生成：以"此刻"为起点推送一条提示
export function notifyTwistStart() {
  _lastTwistMsgAt = Date.now();
  _wasInTwistZone = inTwistZone();
  pushIdleEventMsg(pickTwistMsg());
}

// 事件结束：提示散去并复位轮播状态
export function notifyTwistEnd() {
  pushIdleEventMsg(`✦ 时空扭曲逐渐平息，空间恢复如常……`);
  _lastTwistMsgAt = 0;
  _wasInTwistZone = false;
}

// 事件活跃期间按玩家位置轮播提示：刚进入扭曲区域立即提示，其余按远近间隔补充
export function twistMsgTick(now) {
  const tw = getTwist();
  if (!tw || phase !== 'idle' || _fishing) return;
  if ($('idleView')?.style.display === 'none') return; // 非主界面不打扰
  const zone = inTwistZone();
  if (zone && !_wasInTwistZone) {
    // 刚进入事件路段：立即提示，让玩家意识到已经在扭曲区域内
    _wasInTwistZone = true;
    _lastTwistMsgAt = now;
    pushIdleEventMsg(pickTwistMsg());
    return;
  }
  if (!zone) _wasInTwistZone = false;
  // 区域内每 3 分钟轮播一次、区域外每 5 分钟提醒一次（与大量出没一致的低频，
  // 避免事件期间提示刷屏）
  const interval = zone ? 180000 : 300000;
  if (now - _lastTwistMsgAt >= interval) {
    _lastTwistMsgAt = now;
    pushIdleEventMsg(pickTwistMsg());
  }
}
