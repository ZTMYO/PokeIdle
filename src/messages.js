// ===== 闲置轮播消息 + 地区文案 =====
import { $, showView } from './ui.js';
import { phase, gameData, allPokemon, charmBuffActive, honeyBuffActive, getCurrentRegion, randInt, formatNum, _idleMsgs, _idleMsgIdx, _regionMsgInterval, _idleMsgTimer, _idlePickupTimer, setGameData, honeyCountdownEnd, charmCountdownEnd, setIdleMsgs, setIdleMsgIdx, setRegionMsgInterval, setIdleMsgTimer, setIdlePickupTimer } from './state.js';

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

export const PICKUP_PLACES = ['在草丛里','在路边','在树荫下','在石头缝中','在花丛里','在水边','在泥土里','在落叶堆里','在沙地里','在墙角边','在小路上','在灌木丛中','在岩石下','在藤蔓旁','在溪滩边','在古树根','在青苔石','在碎石坡','在芦苇丛','在树洞中','在野莓丛','在干草堆','在卵石滩','在树桩旁'];
export const PICKUP_ACTIONS = ['踢了一下','随手拨开','扒拉了几下','俯身翻看','无意中踢到','随手一翻','扒开小土坑','扫开灰尘','蹲下来翻找','拂开落叶','刨开沙土','伸手摸索','掀开树皮','轻踹土块','伸手掏了掏','扫开细沙'];
export const PICKUP_RESULTS = ['捡到了','发现了','找到了','翻出了','捞到了','寻获了','意外拾获','顺手拾起','居然是','竟挖到','无意间摸出','凑巧找到','意外翻出','随手摸出','掘出了','捞起了'];

export function buildIdleMessages() {
  if (!gameData) return;
  const stats = gameData.stats;
  const pokedex = gameData.pokedex;
  const caught = Object.values(pokedex).filter(e => e.caught > 0).length;
  const total = allPokemon.length;
  const shinySeen = stats.totalShinySeen;
  const shinyCaught = stats.totalShinyCaught;
  const entries = Object.values(pokedex).filter(e => e.seen > 0);
  const msgs = [];

  // ——— 氛围感环境文案 ———
  const envMsgs = [
    '路边的野花随风轻轻晃动。',
    '潺潺溪流穿过整片森林。',
    '晚风带来了果实淡淡的甜香。',
    '静谧森林里只有虫鸣回荡。',
    '朝阳缓缓升起，照亮整片原野。',
    '薄雾笼罩着整片灌木丛。',
    '飞鸟掠过头顶的云层。',
    '绵绵细雨轻轻落在草丛间。',
    '山间传来不知名宝可梦的鸣叫。',
    '一轮圆月悬挂在漆黑夜空。',
  ];
  msgs.push(envMsgs[randInt(0, envMsgs.length - 1)]);

  // ——— 教程指引类 ———
  const guideMsgs = [
    '点击精灵球可丢出，收服野生的宝可梦！',
    '在图鉴中点击任意宝可梦，可查看它的遭遇日志。',
    '背包里的道具会自动产出，挂机就能获得！',
    '糖果可以在商店兑换成各种精灵球。',
    '甜甜蜜可以吸引更多宝可梦来访。',
    '捡到的神秘蛋会孵出随机宝可梦！',
    '图鉴按序号排列，点击条目查看详细日志。',
    '逃跑的宝可梦会记录在图鉴日志中。',
    '闪光宝可梦非常稀有，遇见了不要错过！',
    '大师球百分百捕获，留给最想要的宝可梦吧。',
    '点击下方进度条可快速打开图鉴。',
    '丢出精灵球后连摇三下，没挣脱就是捕获成功！',
  ];
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

// ——— 轻松趣味闲聊 ———
const chatMsgs = [
  '今天会不会遇见稀有闪光宝可梦呢？',
  '多攒一些糖果，去商店兑换些好东西吧。',
  '再多准备几颗精灵球，防止宝可梦逃走。',
  '翻翻图鉴，看看还有哪些精灵没收集。',
  '不知道下一次草丛里会出现谁。',
  '错过的闪光精灵，下次一定要抓住！',
  '今天的运气还不错，继续前进吧！',
  '宝可梦的世界总是在发生新的故事……',
  '囤一点甜甜蜜，加快遇见宝可梦的速度吧。',
  '神秘蛋里藏着未知的惊喜，慢慢攒糖果兑换。',
  '回头看看图鉴日志，全是一路走来的回忆。',
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
    if (caught >= total) msgs.push('🎉 全部宝可梦都已收录！你当之无愧是宝可梦大师！');
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
    if (hours >= 168) msgs.push(`已经连续冒险${Math.round(hours/24)}天，草丛始终为你等候。`);
    else msgs.push(`已经连续冒险${hours}小时，草丛始终为你等候。`);
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
    const pick1 = entries[randInt(0, entries.length - 1)];
    if (pick1.caught > 0) {
      msgs.push(`还记得初次遇见${pick1.name}的时刻，它是珍贵的伙伴。`);
      if (pick1.shinyCaught > 0) msgs.push(`你拥有一只闪光${pick1.name}，这般运气十分难得！`);
    } else {
      msgs.push(`${pick1.name}仍藏在野外草丛，期待与你的相遇。`);
      msgs.push(`你遇到过${pick1.name}${pick1.seen}次了，下次一定要抓住它！`);
    }

    if (entries.length > 3) {
      let pick2 = entries[randInt(0, entries.length - 1)];
      let tries = 0;
      while (pick2 === pick1 && entries.length > 1 && tries < 10) {
        pick2 = entries[randInt(0, entries.length - 1)];
        tries++;
      }
      if (pick2 && pick2.caught > 0) msgs.push(`和${pick2.name}一起经历了许多冒险呢。`);
    }

    const sorted = [...entries].sort((a, b) => b.seen - a.seen);
    const top = sorted[0];
    if (top.seen >= 3) msgs.push(`最容易遇到的是${top.name}（${top.seen}次）。`);
    if (sorted.length > 1 && sorted[1].seen >= 3) {
      msgs.push(`第二常见的是${sorted[1].name}（${sorted[1].seen}次）。`);
    }
    if (top.seen >= 20) msgs.push(`${top.name}已经见了${top.seen}次了，真有缘分！`);

    // 最稀有：被看到但从未捕获的
    const uncaptured = entries.filter(e => e.caught === 0);
    if (uncaptured.length > 0) {
      const rarest = uncaptured.sort((a, b) => b.seen - a.seen)[0];
      if (rarest.seen >= 2) msgs.push(`${rarest.name}逃走了${rarest.seen}次，下次一定要抓住它！`);
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

  // 加入当前地区氛围文案（由 rotateIdleMessage 按间隔插入，此处不移入）
  setIdleMsgs(msgs);
}

export function rotateIdleMessage() {
  if (phase !== 'idle') return;
  if (charmBuffActive) {
    const msgs = [
      '✦ 闪耀护符的光芒照亮了天空...',
      '✦ 前方似乎有稀有的气息...',
      '✦ 奇迹随时可能发生...',
      '✦ 闪耀护符在微微发烫！',
      '✦ 直觉告诉你，好东西要来了...',
    ];
    setIdleMsgIdx((_idleMsgIdx + 1) % msgs.length);
    $('idleText').textContent = msgs[_idleMsgIdx];
    return;
  }
  if (honeyBuffActive) {
    const msgs = [
      '✦ 甜甜蜜的芬芳随风飘散...',
      '✦ 附近的宝可梦被吸引了！',
      '✦ 草丛里传来了动静...',
      '✦ 甜甜蜜的味道越来越浓...',
      '✦ 好像有什么在靠近...',
    ];
    setIdleMsgIdx((_idleMsgIdx + 1) % msgs.length);
    $('idleText').textContent = msgs[_idleMsgIdx];
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
  const loc = place || PICKUP_PLACES[randInt(0, PICKUP_PLACES.length - 1)];
  const action = PICKUP_ACTIONS[randInt(0, PICKUP_ACTIONS.length - 1)];
  const result = PICKUP_RESULTS[randInt(0, PICKUP_RESULTS.length - 1)];
  $('idleText').textContent = `${loc}${action}，${result}${itemName}！`;
  // 重置轮播间隔，道具文案展示 10 秒后自然过渡到下一条
  if (_idleMsgTimer) {
    clearInterval(_idleMsgTimer);
    setIdleMsgTimer(setInterval(rotateIdleMessage, 10000));
  }
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
