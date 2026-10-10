import { CANDY_EXCHANGE, ITEM_NAMES, ITEM_RATES, CATCH_RATES, CATCH_BONUS_INC, ULTRA_BALL_ADD, FLEE_CHANCE, FLEE_CHANCE_INC, FLEE_CHANCE_MAX, SHINY_CHANCE, CHARM_SHINY_CHANCE, CHARM_UNCAUGHT_CHANCE, ENCOUNTER_MIN, ENCOUNTER_MAX, BUFF_DURATION, BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX, HONEY_RARITY_BOOST, CHARM_RARITY_BOOST, FISH_POKEMON_CHANCE, FISH_BUFF_POKEMON_CHANCE, FISH_RARE_RATE, FISH_WAIT_MIN, FISH_WAIT_MAX, FISH_QTY_MIN, FISH_QTY_MAX, FISH_TRIGGER_MIN, FISH_TRIGGER_MAX, FISH_EVO_CHANCE, REGION_CYCLE, PX_PER_METER, AUTO_FLEE_TIMEOUT, ROAD_SPECIAL_CHANCE, ROAD_SPEED_WALK, ROAD_SPEED_RUN, ROAD_SPEED_BIKE, HATCH_DIST_MIN, HATCH_DIST_MAX, BOUNTY_PER_REGION, TM_PRICE_TIERS, TM_SHOP_DAILY, BOUNTY_CANDY_MIN, BOUNTY_CANDY_MAX, BOUNTY_COMMON_QTY_MIN, BOUNTY_COMMON_QTY_MAX, BLOCK_DISTANCE, BLOCK_QUALITY, TRADE_REFRESH_MS, TRADE_SHINY_CHANCE, FARM_PLANT_COST, FARM_MATURE_MIN, FARM_MATURE_MAX, FARM_HARVEST_MIN, FARM_HARVEST_MAX, FARM_MAX_WATER, FARM_WATER_DROP, FARM_BOARD_DEMANDS, FARM_BOARD_BIG_QTY_MIN, FARM_BOARD_BIG_QTY_MAX, FARM_BOARD_MEGA_QTY_MIN, FARM_BOARD_MEGA_QTY_MAX, FARM_HELPER_WORK_STAGE, FARM_HELPER_REST, MASS_GEN_MIN, MASS_GEN_MAX, MASS_DURATION, MASS_COUNT_MIN, MASS_COUNT_MAX, MASS_SPAWN_MIN, MASS_SPAWN_MAX, MASS_SPAWN_HONEY_MIN, MASS_SPAWN_HONEY_MAX, MASS_SHINY_CHANCE, TWIST_GEN_MIN, TWIST_GEN_MAX, TWIST_DURATION, TWIST_COUNT_MIN, TWIST_SHINY_CHANCE, TWIST_GUARANTEED_IVS, TWIST_RGB_CHANCE, TWIST_POLLUTED_CHANCE, WILD_LEVEL_MAX, LEGEND_ENCOUNTER_RATE, LEGEND_ENCOUNTER_RATE_BUFF, LEGEND_PITY, LEGEND_LEVEL, TRAIN_SLOTS, TRAIN_XP_PER_MIN, TRAIN_LAZY, TRAIN_SATIETY_MAX, TRAIN_SATIETY_DRAIN_PER_MIN, TRAIN_SATIETY_EAT_AT, TRAIN_SATIETY_PER_BERRY, BATTLE_REFRESH_MS, BATTLE_TIER_BAND, COIN_RATE, DEALER_STAND, BJ_MULT, HAND_SIZE, RIICHI_COST, GACHA_DRAW_COST, GACHA_DUP_REFUND, EXP_CANDY_XP, EXP_CANDY_DROP, RELEASE_XP_RATE, TRADE_LEVEL_CHANCE, TRADE_WANT_LEVEL_MIN, TRADE_WANT_LEVEL_MAX, FOLLOWER_DRAW_COST, FOLLOWER_TIER_CHANCE, FOLLOWER_TIER_DUR, FOLLOWER_TIER_BOOST, DISPATCH_DURATIONS, DISPATCH_DUR_MULT, DISPATCH_CANDY_PER_HOUR, DISPATCH_CANDY_JITTER, DISPATCH_FREE_SLOTS, DISPATCH_TYPE_BOOST, DISPATCH_VARIANT_CANDY_BONUS, DISPATCH_EVO_MAX_CHANCE } from './config.js';
import { phase, gameData, allPokemon, getPokemonByIndex, getCurrentRegion, currentEncounter, honeyBuffActive, charmBuffActive, saveGame, formatNum, pad, pushNav, setGameData, getDefaultSave, ensureGpsState, _fishing } from './state.js';
import { $, showView, updateTextBox, hideTextBox, updateBackpack, updateStats, isOnGameView, isUiMobile, applyCharSprites, showConfirmBar, logicViewport, popupBounds, getUiMode, applyUiMode, isMobilePlatform } from './ui.js';
import { doCandyExchange, doSellBall, activateHoney, activateShinyCharm, ITEM_ICONS, BERRY_ICONS, BERRY_NAMES, sellPriceOf, sellSortRank, itemIconSrc, itemDetailOf } from './items.js';
import { formatLogTime } from './pokedex.js';
import { stopAutoFleeTimer, startAutoFleeTimer, autoCatch } from './battle.js';
import { setVolume, setBattleMusic, setMusicEnabled, setSfxEnabled, playBattle, endBattle } from './audio.js';
import { renderAchievements, refreshAchievements } from './achievements.js';
import { TEAM_MAX } from './team.js';
import { clearBattleTier } from './battle-view.js';

// ===== 欧气综合评定 =====
// 取"最好的那一批场次"的平均分（前 10%，至少 10 场）映射到 9 档称号。
// 为什么不取全场平均：稀有度复位后闪光 1/1000、神兽只在事件出现，单场分的方差虽大，
// 但几百场求平均会把运气抹平——实测全场平均的玩家间差距只有 1.6 分（几乎人人相同），
// 而"前 10% 场次平均"差距有 3.2 分，才分得出欧非。
// 玩家主动逃跑（手动 / 佛系 / 无球自动）属于策略选择，不参与评定。
// 参考分布（8000 名玩家 × 200 场模拟）：前 10% 平均 均值 38.6、P25 38.0、P75 39.3、P90 39.9、P97 40.6、P99.5 41.4
const LUCKY_TIERS = [
  { min: 39.3, name: '天运所归' },   // 前 ~1%
  { min: 38.1, name: '大欧皇' },     // 前 ~6%
  { min: 37.1, name: '小欧皇' },     // 前 ~16%
  { min: 36.3, name: '小有运气' },   // 前 ~40%
  { min: 35.3, name: '平凡训练家' }, // 中位附近
  { min: 34.5, name: '小非酋' },
  { min: 33.9, name: '大非酋' },
  { min: 33.0, name: '终极非酋' },
  { min: -Infinity, name: '终极无敌至尊非酋' },
];

// 汇总全部遭遇日志 + 抽卡欧气累计，取分数最高的一批（前 10%，至少 10 场）求平均，返回对应称号
function calcLuckyRating() {
  const logs = gameData.encounterLogs || {};
  const scores = [];
  for (const arr of Object.values(logs)) {
    if (!Array.isArray(arr)) continue;
    for (const l of arr) {
      // 跳过无有效评分的旧记录（旧 fled 无相遇分，score=0）
      if (!l || typeof l.score !== 'number' || l.score <= 0) continue;
      // 主动逃跑（selfFlee）是策略选择，不计入欧气评定
      if (l.selfFlee === true) continue;
      scores.push(l.score);
    }
  }
  // 抽卡欧气：独立累计字段（不受抽卡日志 50 条窗口影响），按"累计分/次数"折算成等量场次并入
  const gachaScore = gameData.stats?.luckyGachaScore || 0;
  const gachaCount = gameData.stats?.luckyGachaCount || 0;
  if (gachaCount > 0) {
    const avgGacha = gachaScore / gachaCount;
    for (let i = 0; i < gachaCount; i++) scores.push(avgGacha);
  }
  if (scores.length === 0) return null;
  scores.sort((a, b) => b - a); // 高到低
  const topN = Math.max(10, Math.ceil(scores.length * 0.1));
  const pool = scores.slice(0, topN);
  const avg = pool.reduce((a, b) => a + b, 0) / pool.length;
  return LUCKY_TIERS.find(t => avg >= t.min) || null;
}

// ===== 数据统计视图 =====

// 今日统计：从遭遇日志按"今天 0 点后"筛选（孵蛋/交换单独计数，不算道路遭遇；逃跑只算挣脱，不含主动逃跑）
// 当天日期键（YYYY-MM-DD，本地时区）
function dayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 每次调用重新取当天零点，跨天自动归零
function calcTodayStats() {
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const t = { seen: 0, caught: 0, fled: 0, shinySeen: 0, shinyCaught: 0, hatched: 0, shinyHatched: 0, trades: 0, shinyTraded: 0, evolutions: 0, catchRate: '0.0' };
  for (const arr of Object.values(gameData.encounterLogs || {})) {
    for (const l of arr) {
      if (!l || !l.time || l.time < todayStart) continue;
      if (l.source === 'egg' || !l.source) {
        t.hatched++;
        if (l.shiny) t.shinyHatched++;
        continue;
      }
      if (l.source === 'trade') {
        t.trades++;
        if (l.shiny) t.shinyTraded++;
        continue;
      }
      t.seen++;
      if (l.result === 'caught') { t.caught++; if (l.shiny) t.shinyCaught++; }
      else if (l.result === 'fled' && !l.selfFlee) t.fled++;
      if (l.shiny) t.shinySeen++;
    }
  }
  t.evolutions = (gameData.stats && gameData.stats.lastEvoDate === dayKey()) ? (gameData.stats.evolutionsToday || 0) : 0;
  t.catchRate = (t.caught + t.fled) > 0 ? (t.caught / (t.caught + t.fled) * 100).toFixed(1) : '0.0';
  return t;
}

// 统计页所有动态数值统一刷新（初始渲染与每秒定时器共用）。
// 统计页打开时游戏仍在后台运行：道路持续滚动累计行走距离、自动捕捉/逃跑推进遭遇、
// 道具持续拾取、GPS 导航推进地区，因此所有数值都需实时同步。
// 按 id 更新而非整页重建，避免滚动位置被重置。
// 挂机时长（仅统计页使用）：隐藏秒数，统一 HH:MM，如 00:04 或 02:35
const fmtPlayTime = s => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}`;
};

function refreshDataStats() {
  const stats = gameData.stats;
  const pokedex = gameData.pokedex;

  // 累计数据
  let totalSeen = 0;
  let totalCaught = 0;
  for (const entry of Object.values(pokedex)) {
    totalSeen += entry.seen || 0;
    totalCaught += entry.caught || 0;
  }
  const totalUnique = Object.values(pokedex).filter(e => e.caught > 0).length;
  const totalSpecies = allPokemon.length;
  const pct = totalSpecies > 0 ? (totalUnique / totalSpecies * 100).toFixed(1) : '0.0';
  const catchRate = (totalCaught + stats.totalCatches) > 0
    ? ((stats.totalCatches / (stats.totalCatches + stats.totalFlees)) * 100).toFixed(1)
    : '0.0';

  // 冒险进度：当前地区由 GPS 位置决定；行走距离按真实移动像素累计换算
  const region = getCurrentRegion();
  const walkDist = stats.walkDistance || 0;
  const walkMeters = Math.round(walkDist / PX_PER_METER);
  const walkText = walkMeters >= 1000 ? (walkMeters / 1000).toFixed(2) + ' 公里' : walkMeters + ' 米';

  // 道具获得统计（后台拾取持续增加）
  const earned = stats.totalItemsEarned || {};

  // 今日统计（日志时间跨天自动归零）
  const t = calcTodayStats();
  const rating = calcLuckyRating();

  // 累计的孵化闪光/交换闪光：从全部日志统计（日志不裁剪），口径与今日一致，
  // 兼容旧存档（新字段 totalShinyTraded 出现前交换的闪光也能正确累计）
  let totalShinyHatched = 0;
  let totalShinyTraded = 0;
  for (const arr of Object.values(gameData.encounterLogs || {})) {
    for (const l of arr) {
      if (!l) continue;
      if ((l.source === 'egg' || !l.source) && l.shiny) totalShinyHatched++;
      else if (l.source === 'trade' && l.shiny) totalShinyTraded++;
    }
  }

  $('dataPlayTotal').textContent = fmtPlayTime(stats.totalPlaySeconds);
  $('dataPlayToday').textContent = fmtPlayTime(stats.playSecondsToday || 0);
  $('dataTodaySeen').textContent = formatNum(t.seen);
  $('dataTodayCaught').textContent = formatNum(t.caught);
  $('dataTodayFled').textContent = formatNum(t.fled);
  $('dataTodayRate').textContent = t.catchRate + '%';
  $('dataTodayShinySeen').textContent = formatNum(t.shinySeen);
  $('dataTodayShinyCaught').textContent = formatNum(t.shinyCaught);
  $('dataTodayHatched').textContent = formatNum(t.hatched);
  $('dataTodayShinyHatched').textContent = formatNum(t.shinyHatched);
  $('dataTodayShinyTraded').textContent = formatNum(t.shinyTraded);
  $('dataTodayEvolved').textContent = formatNum(t.evolutions);
  $('dataTotalEvolved').textContent = formatNum(stats.totalEvolutions || 0);
  $('dataTradesToday').textContent = formatNum(stats.tradesToday || 0);
  $('dataRating').textContent = rating ? rating.name : '暂无评定，先去冒险吧';
  $('dataTotalSeen').textContent = formatNum(totalSeen);
  $('dataTotalCaught').textContent = formatNum(stats.totalCatches);
  $('dataTotalFled').textContent = formatNum(stats.totalFlees);
  $('dataTotalRate').textContent = catchRate + '%';
  $('dataTotalShinySeen').textContent = formatNum(stats.totalShinySeen);
  $('dataTotalShinyCaught').textContent = formatNum(stats.totalShinyCaught);
  $('dataTotalHatched').textContent = formatNum(stats.totalEggsHatched);
  $('dataTotalShinyHatched').textContent = formatNum(totalShinyHatched);
  $('dataTotalShinyTraded').textContent = formatNum(totalShinyTraded);
  $('dataTradesTotal').textContent = formatNum(stats.totalTrades || 0);
  $('dataRegion').textContent = region.name;
  $('dataWalkDist').textContent = walkText;
  $('dataDexPct').textContent = `${totalUnique}/${totalSpecies} (${pct}%)`;
  $('dataBallsUsed').textContent = formatNum(stats.totalBallsUsed);
  $('dataBallsAvg').textContent = totalSeen > 0 ? (stats.totalBallsUsed / totalSeen).toFixed(2) : '0';
  $('dataBlockMade').textContent = formatNum(stats.totalBlockMade || 0);
  $('dataPlantings').textContent = formatNum(stats.totalPlantings || 0);
  $('dataHarvests').textContent = formatNum(stats.totalHarvests || 0);
  $('dataBerriesHarvested').textContent = formatNum(stats.totalBerriesHarvested || 0);
  $('dataBoardTrades').textContent = formatNum(stats.totalBoardTrades || 0);
  $('dataBountyClaims').textContent = formatNum(stats.totalBountyClaims || 0);
  $('dataBountyToday').textContent = formatNum(stats.bountyClaimsToday || 0);
  $('dataBountyCandy').textContent = formatNum(stats.totalBountyCandy || 0);
  $('dataNpcWins').textContent = formatNum(stats.totalNpcWins || 0);
  $('dataNpcNoviceWins').textContent = formatNum(stats.totalNpcNoviceWins || 0);
  $('dataNpcEliteWins').textContent = formatNum(stats.totalNpcEliteWins || 0);
  $('dataNpcLeaderWins').textContent = formatNum(stats.totalNpcLeaderWins || 0);
  $('dataNpcChampionWins').textContent = formatNum(stats.totalNpcChampionWins || 0);
  $('dataNpcCandy').textContent = formatNum(stats.totalNpcCandy || 0);

  // 游戏厅战绩（基于 50 条滑动窗口记录统计）
  const wlStat = (records, isMj) => {
    let w = 0, l = 0, p = 0, net = 0;
    for (const r of records) {
      net += r.net;
      if (isMj) { if (r.net > 0) w++; else if (r.net < 0) l++; else p++; }
      else { if (r.action === 'win' || r.action === 'blackjack') w++; else if (r.action === 'lose') l++; else p++; }
    }
    return { w, l, p, net };
  };
  const cs = wlStat(gameData.casinoRecords || [], false);
  const mj = wlStat(gameData.mahjongRecords || [], true);
  $('dataCasinoWL').textContent = `胜 ${cs.w} / 负 ${cs.l} / 平 ${cs.p}`;
  $('dataCasinoNet').textContent = `${cs.net > 0 ? '+' : ''}${formatNum(cs.net)} 币`;
  $('dataMjWL').textContent = `胜 ${mj.w} / 负 ${mj.l} / 平 ${mj.p}`;
  $('dataMjNet').textContent = `${mj.net > 0 ? '+' : ''}${formatNum(mj.net)} 币`;
  const earnedEl = $('dataEarned');
  if (earnedEl) {
    // 糖果置顶，其余保持原顺序
    const entries = Object.entries(earned);
    const rows = entries.filter(([k]) => k === 'candy').concat(entries.filter(([k]) => k !== 'candy'));
    earnedEl.innerHTML = rows.map(([k, v]) =>
      `<div class="stat-row"><span>${ITEM_NAMES[k] || k}</span><span>×${formatNum(v)}</span></div>`
    ).join('') || '<div>暂无数据</div>';
  }
}

export function showDataView() {
  pushNav('dataView');

  const content = $('dataContent');
  // 数值 span 由 refreshDataStats 按 id 填充，避免整页重建导致滚动位置丢失
  content.innerHTML = `
    <div class="stat-inner">
      <div class="stat-section">欧非评定</div>
      <div class="stat-row"><span>称号</span><span id="dataRating"></span></div>

      <div class="stat-section">数据总览</div>
      <table class="stat-table">
        <thead>
          <tr><th>项目</th><th>今日</th><th>累计</th></tr>
        </thead>
        <tbody>
          <tr><td>挂机时长</td><td id="dataPlayToday"></td><td id="dataPlayTotal"></td></tr>
          <tr><td>遭遇</td><td id="dataTodaySeen"></td><td id="dataTotalSeen"></td></tr>
          <tr><td>捕获</td><td id="dataTodayCaught"></td><td id="dataTotalCaught"></td></tr>
          <tr><td>逃跑</td><td id="dataTodayFled"></td><td id="dataTotalFled"></td></tr>
          <tr><td>捕获率</td><td id="dataTodayRate"></td><td id="dataTotalRate"></td></tr>
          <tr><td>闪光遇见</td><td id="dataTodayShinySeen"></td><td id="dataTotalShinySeen"></td></tr>
          <tr><td>闪光捕获</td><td id="dataTodayShinyCaught"></td><td id="dataTotalShinyCaught"></td></tr>
          <tr><td>孵化次数</td><td id="dataTodayHatched"></td><td id="dataTotalHatched"></td></tr>
          <tr><td>孵化闪光</td><td id="dataTodayShinyHatched"></td><td id="dataTotalShinyHatched"></td></tr>
          <tr><td>交换次数</td><td id="dataTradesToday"></td><td id="dataTradesTotal"></td></tr>
          <tr><td>交换闪光</td><td id="dataTodayShinyTraded"></td><td id="dataTotalShinyTraded"></td></tr>
          <tr><td>进化次数</td><td id="dataTodayEvolved"></td><td id="dataTotalEvolved"></td></tr>
        </tbody>
      </table>

      <div class="stat-section">冒险进度</div>
      <div class="stat-row"><span>当前地区</span><span id="dataRegion"></span></div>
      <div class="stat-row"><span>行走距离</span><span id="dataWalkDist"></span></div>
      <div class="stat-row"><span>图鉴完成度</span><span id="dataDexPct"></span></div>

      <div class="stat-section">消耗统计</div>
      <div class="stat-row"><span>精灵球使用</span><span id="dataBallsUsed"></span></div>
      <div class="stat-row"><span>平均球/遇敌</span><span id="dataBallsAvg"></span></div>

      <div class="stat-section">农场与合成</div>
      <div class="stat-row"><span>合成树果方块</span><span id="dataBlockMade"></span></div>
      <div class="stat-row"><span>种植次数</span><span id="dataPlantings"></span></div>
      <div class="stat-row"><span>收获次数</span><span id="dataHarvests"></span></div>
      <div class="stat-row"><span>收获树果</span><span id="dataBerriesHarvested"></span></div>
      <div class="stat-row"><span>完成需求</span><span id="dataBoardTrades"></span></div>

      <div class="stat-section">地区悬赏</div>
      <div class="stat-row"><span>累计完成悬赏</span><span id="dataBountyClaims"></span></div>
      <div class="stat-row"><span>今日完成悬赏</span><span id="dataBountyToday"></span></div>
      <div class="stat-row"><span>悬赏糖果</span><span id="dataBountyCandy"></span></div>

      <div class="stat-section">NPC 对战</div>
      <div class="stat-row"><span>累计战胜训练家</span><span id="dataNpcWins"></span></div>
      <div class="stat-row"><span>战胜普通训练家</span><span id="dataNpcNoviceWins"></span></div>
      <div class="stat-row"><span>战胜精英</span><span id="dataNpcEliteWins"></span></div>
      <div class="stat-row"><span>战胜馆主</span><span id="dataNpcLeaderWins"></span></div>
      <div class="stat-row"><span>战胜冠军</span><span id="dataNpcChampionWins"></span></div>
      <div class="stat-row"><span>对战糖果</span><span id="dataNpcCandy"></span></div>

      <div class="stat-section">游戏厅战绩</div>
      <div class="stat-row"><span>21点 胜/负/平</span><span id="dataCasinoWL"></span></div>
      <div class="stat-row"><span>21点 净盈亏</span><span id="dataCasinoNet"></span></div>
      <div class="stat-row"><span>麻将 胜/负/平</span><span id="dataMjWL"></span></div>
      <div class="stat-row"><span>麻将 净盈亏</span><span id="dataMjNet"></span></div>
      <div class="stat-row"><span>卡册收集进度</span><span id="dataCardPct"></span></div>

      <div class="stat-section">道具累计获得</div>
      <div id="dataEarned"></div>
    </div>
  `;
  // 初始填充 + 每秒实时刷新全部动态值；离开统计页后定时器自动停止
  refreshDataStats();
  // 卡册收集进度：卡池数据异步加载（有缓存），加载完成后填入
  import('./album.js').then(m => m.getCardCollectionStats()).then(s => {
    const el = $('dataCardPct');
    if (el) el.textContent = s.total > 0 ? `${s.owned}/${s.total} (${(s.owned / s.total * 100).toFixed(1)}%)` : '—';
  });
  if (showDataView._timer) clearInterval(showDataView._timer);
  showDataView._timer = setInterval(() => {
    if ($('dataView')?.style.display === 'none') {
      clearInterval(showDataView._timer);
      showDataView._timer = null;
      return;
    }
    refreshDataStats();
  }, 1000);
  showView('dataView');
}

// ===== 成就独立页面 =====
export function showAchievementView() {
  pushNav('achievementView');
  const content = $('achievementContent');
  if (!content) return;
  content.innerHTML = '<div id="achievementList"></div>';
  renderAchievements();
  const av = $('achievementView');
  av.onwheel = (e) => {
    e.preventDefault();
    av.scrollTop += e.deltaY * 0.4;
  };
  // 轻量刷新进度（挂机数据持续变化）；离开成就页后定时器自动停止
  if (showAchievementView._timer) clearInterval(showAchievementView._timer);
  showAchievementView._timer = setInterval(() => {
    if ($('achievementView')?.style.display === 'none') {
      clearInterval(showAchievementView._timer);
      showAchievementView._timer = null;
      return;
    }
    refreshAchievements();
  }, 1000);
  showView('achievementView');
}

// ===== 系统日志独立页面 =====
export function renderSystemLogs() {
  const logs = gameData.systemLogs || [];
  const sorted = [...logs].reverse();
  // 日志只存宝可梦编号，名字从图鉴数据查表；有形态显示全称（如 地鼠-阿罗拉），无形态显示本体名
  const logName = log => {
    const n = log.details?.pokemon;
    if (n == null) return log.details?.name || '';
    const p = getPokemonByIndex(n);
    return p ? (p.form || p.name) : '#' + n;
  };

  const content = $('systemLogContent');
  if (!content) return;
  content.innerHTML = `
    <div class="rec-header">最近 ${Math.min(sorted.length, 50)} 条活动记录</div>
    ${sorted.length === 0 ? '<div class="rec-empty">暂无活动记录</div>' : ''}
    ${sorted.map(log => {
    const time = formatLogTime(log.time);
    let desc = '';
    switch (log.type) {
      case 'item_gain':
        desc = `${log.details.from ? `【${log.details.from}】` : ''}获得 ${ITEM_NAMES[log.details.item] || log.details.item} ×${log.details.qty}`;
        break;
      case 'achievement_claim':
        desc = `【成就】领取 ${log.details.tiers} 级奖励，糖果 ×${log.details.candy}`;
        break;
      case 'tm_unlock':
        desc = `【招式】解锁 ${log.details.move}（消耗${log.details.cost}糖果${log.details.learned ? `，${log.details.learned} 只学会` : ''}）`;
        break;
      case 'item_use':
        desc = `${log.details.auto ? '[自动] ' : ''}使用了${ITEM_NAMES[log.details.item] || log.details.item}`;
        break;
      case 'fishing':
        desc = `钓鱼获得 ${ITEM_NAMES[log.details.item] || log.details.item}×${log.details.qty}`;
        break;
      case 'shop_purchase':
        desc = `商店兑换${ITEM_NAMES[log.details.item] || log.details.item}×${log.details.qty}（消耗${log.details.cost}糖果）`;
        break;
      case 'shop_sell':
        desc = `商店出售${ITEM_NAMES[log.details.item] || log.details.item}×${log.details.qty}（获得${log.details.gain}糖果）`;
        break;
      case 'encounter':
        desc = log.details.source === 'fishing'
          ? ` 钓鱼上钩了 ${log.details.shiny ? '闪光' : ''}${logName(log)}`
          : `遇到 ${log.details.shiny ? '闪光' : ''}${logName(log)}`;
        break;
      case 'pokemon_caught':
        desc = `${log.details.auto ? '[自动] ' : ''}收服了${log.details.shiny ? '闪光' : ''}${logName(log)}`;
        break;
      case 'player_fled':
        desc = log.details.auto ? '[自动] 你逃走了' : '你逃走了';
        break;
      case 'pokemon_escaped':
        desc = `${log.details.auto ? '[自动] ' : ''}${logName(log)} 逃走了`;
        break;
      case 'egg_hatch':
        desc = `孵化出 ${log.details.shiny ? '闪光' : ''}${logName(log)}`;
        break;
      case 'region_change':
        desc = `进入 ${log.details.region} 地区`;
        break;
      case 'bounty_claim':
        desc = log.details.item
          ? `完成地区悬赏，获得${ITEM_NAMES[log.details.item] || log.details.item} ×${log.details.qty || 1}`
          : `完成地区悬赏，获得糖果 ×${log.details.candy}`;
        break;
      case 'berry_helper':
        desc = `招募了帮手${log.details.stages ? `（工作 ${log.details.stages} 阶段）` : ''}`;
        break;
      case 'berry_helper_end':
        desc = '树果帮手服务结束';
        break;
      case 'berry_plant':
        desc = `种植了${BERRY_NAMES[BERRY_ICONS[log.details.berry]] || BERRY_ICONS[log.details.berry]}`;
        break;
      case 'berry_harvest':
        desc = `收获 ${BERRY_NAMES[BERRY_ICONS[log.details.berry]] || BERRY_ICONS[log.details.berry]} ×${log.details.qty}`;
        break;
      case 'berry_trade':
        desc = `交付${BERRY_NAMES[BERRY_ICONS[log.details.berry]] || BERRY_ICONS[log.details.berry]}×${log.details.qty}，获得糖果 ×${log.details.candy}`;
        break;
      case '战斗':
        desc = typeof log.details === 'string' ? log.details : '未知战斗记录';
        break;
      case 'trade':
        desc = `与「${log.details.npcName}」交换：送出${logName({ details: { pokemon: log.details.take } })}，换得${log.details.shiny ? '闪光' : ''}${logName({ details: { pokemon: log.details.give } })}`;
        break;
      case 'mixer': {
        const berryNames = (log.details.recipe || []).map(i => BERRY_NAMES[BERRY_ICONS[i]] || BERRY_ICONS[i]).join('、');
        switch (log.details.action) {
          case 'make': desc = `制作树果方块（${berryNames}）`; break;
          case 'qte': desc = `混合小游戏完成，品质 ${(BLOCK_QUALITY[log.details.quality] || {}).label || log.details.quality}`; break;
          case 'claim': desc = `领取树果方块（${berryNames}）`; break;
          case 'eaten': desc = '树果方块被宝可梦吃掉了'; break;
          case 'expired': desc = '树果方块的效果结束了'; break;
          case 'cancel': desc = '取消了树果方块'; break;
          default: desc = '树果方块操作'; break;
        }
        break;
      }
      case 'mass_outbreak_start':
        desc = `${logName(log)}大量出没`;
        break;
      case 'mass_outbreak_end':
        desc = '大量出没结束';
        break;
      case 'twist_start':
        desc = '时空扭曲出现';
        break;
      case 'twist_end':
        desc = log.details.forced ? '时空扭曲提前结束' : '时空扭曲结束';
        break;
      case 'train_start':
        desc = `开始训练 ${logName(log)}`;
        break;
      case 'train_end':
        desc = `结束训练 ${logName(log)}`;
        break;
      case 'train_levelup':
        desc = `${logName(log)} 训练升级至 Lv${log.details.level}`;
        break;
      case 'train_lazy':
        desc = `${logName(log)} 开始偷懒了`;
        break;
      case 'train_wake':
        desc = `叫醒了偷懒的 ${logName(log)}`;
        break;
      case 'train_feed':
        desc = `${logName(log)} 吃掉一颗${BERRY_NAMES[BERRY_ICONS[log.details.berry]] || BERRY_ICONS[log.details.berry]}补充饱食度`;
        break;
      case 'exp_candy_use':
        desc = `${logName(log)} 使用 ${log.details.qty} 颗经验糖果升至 Lv${log.details.level}`;
        break;
      case 'evolve': {
        const fromP = getPokemonByIndex(String(log.details.from));
        const toP = getPokemonByIndex(String(log.details.to));
        const me = (gameData.roster || []).find((r) => r.id === log.details.id);
        const who = me && me.nickname ? `「${me.nickname}」` : '';
        desc = `${who}由 ${fromP ? (fromP.form || fromP.name) : log.details.from} 进化成了 ${toP ? (toP.form || toP.name) : log.details.to}`;
        break;
      }
      case 'gacha':
        desc = `抽到 ${log.details.tier || ''} ${log.details.cnName || log.details.card || ''}${log.details.isNew ? '（新）' : '（重复）'}`;
        break;
      case 'nursery_breed_start': {
        const na = getPokemonByIndex(String(log.details.a));
        const nb = getPokemonByIndex(String(log.details.b));
        desc = `开始繁殖 ${na ? na.name : '#' + log.details.a} × ${nb ? nb.name : '#' + log.details.b}`;
        break;
      }
      case 'nursery_egg':
        desc = `产下 ${log.details.shiny ? '闪光' : ''}${logName(log)} 的蛋`;
        break;
      case 'dispatch_start':
        desc = `${logName(log)} 出发派遣 ${log.details.duration / 60} 小时`;
        break;
      case 'dispatch_done':
        desc = `${logName(log)} 完成派遣，带回${(log.details.rewards || []).map(r => `${ITEM_NAMES[r.key] || r.key}×${r.qty}`).join('、')}`;
        break;
      case 'pokemon_release':
        desc = `放生了${log.details.shiny ? '闪光' : ''}${logName(log)}`;
        break;
      case 'buff_expired':
        desc = `${ITEM_NAMES[log.details.item] || log.details.item}的效果结束了`;
        break;
      case 'bike_ride':
        desc = '开始骑自行车';
        break;
      case 'bike_stop':
        desc = '自行车骑行结束';
        break;
      case 'auto_refill':
        desc = `[自动] 补了${ITEM_NAMES[log.details.ball] || log.details.ball} ×1`;
        break;
      case 'casino': {
        const p = log.details.profit;
        const t = { blackjack: '黑杰克', win: '你赢了', lose: '输了', push: '平局' }[log.details.action] || '一局';
        desc = `游戏厅：${t} ${p > 0 ? '+' + p : p} 糖果`;
        break;
      }
      case 'mahjong': {
        const p = log.details.profit;
        const t = log.details.winner === 0 ? `你胡了${log.details.yaku && log.details.yaku.length ? '（' + log.details.yaku.join('/') + '）' : ''}`
          : log.details.winner === 'draw' ? '流局'
          : ['对家', '左家', '右家'][log.details.winner - 1] + ' 胡牌';
        desc = `麻将：${t} ${p > 0 ? '+' + p : p} 糖果`;
        break;
      }
      default:
        desc = `未知事件 (${log.type})`;
    }
    // 所有日志统一不以句号结尾（历史存档中的旧日志也会在展示时剥掉）
    desc = desc.replace(/。\s*$/, '');
    return `<div class="rec-row">
        <span class="rec-time">${time}</span>
        <span class="rec-main">${desc}</span>
      </div>`;
  }).join('')}
  `;
}

export function showSystemLogs() {
  pushNav('systemLogView');
  showView('systemLogView');
  const sv = $('systemLogView');
  if (sv) sv.scrollTop = 0;
  renderSystemLogs();
}

// ===== 商店视图 =====
// 右键兑换按钮弹出的批量购买数量选项（按余额置灰）
const BUY_QTY_OPTIONS = [5, 10, 20, 50];
// 右键出售按钮弹出的批量出售数量选项（按持有量置灰）
const SELL_QTY_OPTIONS = [5, 20, 50, 100];
// 出售模式开关：顶部按钮切换「兑换 / 出售」两种列表
let _shopSellMode = false;

// ===== 商店兑换确认（行内二次确认，替代弹框） =====
let _pendingExchange = null; // { item, qty } 待确认的兑换项

// 进入行内确认态：把该行的「兑换」按钮替换成确认文字，点击确认才结算
function requestCandyExchange(itemKey, qty = 1) {
  const cost = CANDY_EXCHANGE[itemKey];
  const total = cost * qty;
  if (!cost || (gameData.items['candy'] || 0) < total) return; // 余额不足不进入确认
  cancelPendingExchange(); // 已有其他行的确认态先取消
  _pendingExchange = { item: itemKey, qty };
  const row = document.querySelector(`.shop-item[data-item="${itemKey}"]`);
  if (!row) return;
  const btnArea = row.querySelector('.shop-btn');
  if (!btnArea) return;
  row.classList.add('shop-confirming');
  const confirm = document.createElement('span');
  confirm.className = 'shop-btn shop-confirm';
  confirm.textContent = `确认兑换 ×${qty}`;
  btnArea.replaceWith(confirm);
}

// 确认结算：执行兑换并清空确认态（结算后重渲染会重建按钮区）
function confirmCandyExchange() {
  if (!_pendingExchange) return;
  const { item, qty } = _pendingExchange;
  _pendingExchange = null;
  doCandyExchange(item, qty);
}

// 取消行内确认：恢复「兑换」按钮
function cancelPendingExchange() {
  if (!_pendingExchange) return;
  _pendingExchange = null;
  const row = document.querySelector(`.shop-item.shop-confirming`);
  const confirm = row?.querySelector('.shop-confirm');
  if (confirm) {
    const btn = document.createElement('span');
    btn.className = 'shop-btn';
    btn.textContent = '兑换';
    confirm.replaceWith(btn);
  }
  row?.classList.remove('shop-confirming');
}

// ===== 商店详情弹框 =====
// 道具/招式机的介绍都在这里看：小卡片挂在商店页容器内（双屏下也留在下屏），点空白处关闭
function showShopDetail(detail) {
  if (!detail) { hideShopDetail(); return; } // 传空 = 收起卡片
  const { badgeHtml, title, statsHtml, desc } = detail;
  const host = $('shopView');
  if (!host) return;
  let mask = $('shopDetailMask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'shopDetailMask';
    mask.className = 'shop-detail-mask';
    mask.innerHTML = `<div class="shop-detail-card">
      <div class="shop-detail-head">
        <span class="shop-detail-badge"></span>
        <span class="shop-detail-name"></span>
      </div>
      <div class="move-edit-detail-stats"></div>
      <div class="shop-detail-desc"></div>
    </div>`;
    host.appendChild(mask);
    mask.addEventListener('click', hideShopDetail); // 点卡片外的空白关闭
    mask.querySelector('.shop-detail-card').addEventListener('click', (e) => e.stopPropagation());
  }
  mask.querySelector('.shop-detail-badge').innerHTML = badgeHtml || '';
  mask.querySelector('.shop-detail-name').textContent = title || '';
  mask.querySelector('.move-edit-detail-stats').innerHTML = statsHtml || '';
  mask.querySelector('.shop-detail-desc').textContent = desc || '';
  mask.style.display = 'flex';
}

function hideShopDetail() {
  const mask = $('shopDetailMask');
  if (mask) mask.style.display = 'none';
}

// 就地刷新商店顶部的糖果数（招式机解锁后调用，避免为了一个数字重建整页把滚动位置顶掉）
function refreshShopCandy() {
  const el = $('shopCandyNum');
  if (el) el.textContent = String(gameData.items['candy'] || 0);
}

// 道具详情：只给介绍文字（价格在列表行上已经有了）
function showItemDetail(item) {
  showShopDetail(itemDetailOf(item));
}

export function showShopView(opts) {
  // 兑换结算后 doCandyExchange 会重渲染本页：此时文案框保持固定，不清空不隐藏
  const isReRender = $('shopView')?.style.display === 'flex';
  pushNav('shopView');
  if (!isReRender) hideShopContextMenu(); // 重新进入商店时清理可能残留的批量菜单
  if (!isReRender) {
    // 真正进入商店：清空待确认的兑换，并重置为兑换模式（避免玩家上次停在出售，
    // 下次进来本想购买却错看成出售列表）
    _pendingExchange = null;
    _shopSellMode = false;
  }
  const content = $('shopContent');
  // 结算后的重渲染会重建整个列表：带上原滚动位置，否则买完东西会被弹回顶部（商店下半部尤其明显）
  const keepScroll = opts?.keepScroll ? (content?.scrollTop || 0) : 0;
  const candy = gameData.items['candy'] || 0;

  let itemsHtml = '';
  if (_shopSellMode) {
    // 出售列表 = 实际持有的道具（含进化/专属），顺序：基础道具 → 进化道具 → 专属道具
    const owned = Object.entries(gameData.items)
      .filter(([k, n]) => n > 0 && k !== 'casinoCoin' && sellPriceOf(k) > 0)
      .sort((a, b) => sellSortRank(a[0]) - sellSortRank(b[0]) || b[1] - a[1]);
    itemsHtml = owned.length ? owned.map(([item, n]) => {
      const price = sellPriceOf(item);
      return `
      <div class="shop-item" data-item="${item}">
        <div class="shop-item-left">
          <img src="${itemIconSrc(item)}" class="shop-icon" alt="${ITEM_NAMES[item] || item}" />
          <span class="shop-item-name">${ITEM_NAMES[item] || item}</span><span class="idx">×${n}</span>
        </div>
        <div class="shop-item-right">
          <span class="shop-cost"><img src="./items/goods/candy.png" style="width:14px;height:14px;vertical-align:middle;image-rendering:pixelated;" /> ×${price}</span>
          <span class="shop-btn" title="右键可批量出售">出售</span>
        </div>
      </div>`;
    }).join('') : '<div class="rec-empty">背包里还没有可出售的道具</div>';
  } else {
    for (const [item, cost] of Object.entries(CANDY_EXCHANGE)) {
      const enough = candy >= cost;
      itemsHtml += `
      <div class="shop-item" data-item="${item}">
        <div class="shop-item-left">
          <img src="./items/${ITEM_ICONS[item]}" class="shop-icon" alt="${ITEM_NAMES[item]}" />
          <span class="shop-item-name">${ITEM_NAMES[item]}</span>
        </div>
        <div class="shop-item-right">
          <span class="shop-cost"><img src="./items/goods/candy.png" style="width:14px;height:14px;vertical-align:middle;image-rendering:pixelated;" /> ×${cost}</span>
          <span class="shop-btn${enough ? '' : ' inert'}" title="右键可批量购买">兑换</span>
        </div>
      </div>`;
    }
  }

  content.innerHTML = `
    <div style="padding:6px 8px;color:var(--ui-color);">
      <div style="position:relative;text-align:center;font-weight:700;margin-bottom:6px;">
        <span class="shop-mode-btn" id="shopModeBtn" style="position:absolute;left:0;top:50%;transform:translateY(-50%);">${_shopSellMode ? '兑换' : '出售'}</span>
        当前糖果：<img src="./items/goods/candy.png" style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated;" /> <span id="shopCandyNum">${candy}</span>
      </div>
      ${itemsHtml}
      ${_shopSellMode ? '' : '<div id="shopTmBox"></div><div id="shopEvoBox"></div>'}
    </div>
  `;
  // 事件委托：
  // 顶部模式按钮切换列表；兑换模式左键点「兑换」进入行内确认，确认态点确认文字结算；
  // 出售模式左键点「出售」直接卖出 1 个；点其他区域取消兑换确认
  content.onclick = (e) => {
    const modeBtn = e.target.closest('#shopModeBtn');
    if (modeBtn) {
      _shopSellMode = !_shopSellMode;
      cancelPendingExchange();
      hideShopDetail();
      showShopView();
      return;
    }
    const confirm = e.target.closest('.shop-confirm');
    if (confirm) {
      confirmCandyExchange();
      return;
    }
    const btn = e.target.closest('.shop-btn');
    if (btn) {
      const item = btn.closest('.shop-item');
      if (!item || !item.dataset.item || btn.classList.contains('inert')) return; // 招式机行由 tm.js 自己处理
      if (_shopSellMode) {
        doSellBall(item.dataset.item, 1);
        return;
      }
      requestCandyExchange(item.dataset.item);
      return;
    }
    // 点条目本身 → 弹框看详情（糖果不够 / 没有库存的条目也能看）
    const row = e.target.closest('.shop-item[data-item]');
    cancelPendingExchange();
    if (row) showItemDetail(row.dataset.item);
  };
  // 右键"兑换/出售"按钮弹出批量菜单（确认态下右键同样有效）
  content.oncontextmenu = (e) => {
    const btn = e.target.closest('.shop-btn, .shop-confirm');
    if (!btn) return;
    const item = btn.closest('.shop-item');
    if (!item || !item.dataset.item || btn.classList.contains('inert')) return;
    e.preventDefault();
    showShopContextMenu(item.dataset.item, e.clientX, e.clientY, _shopSellMode ? 'sell' : 'buy');
  };
  showView('shopView');
  if (keepScroll && content) content.scrollTop = keepScroll;
  if (!isReRender) hideShopDetail(); // 真正进入商店：关掉上次残留的详情弹框
  // 招式机区块：每天轮换的招式机（异步填内容，招式数据不在商店首帧拉取）
  if (!_shopSellMode) {
    const tmBox = $('shopTmBox');
    if (tmBox) import('./tm.js').then((m) => m.renderShopTmSection(tmBox, { onBought: refreshShopCandy, onDetail: showShopDetail }));
    // 今日道具（放在招式机下面）
    const evoBox = $('shopEvoBox');
    if (evoBox) import('./items.js').then((m) => m.renderShopEvoSection(evoBox, { onBought: refreshShopCandy, onDetail: showShopDetail }));
  }
  // 出售模式：标题栏显示「出售」，切回兑换模式时由 showView 恢复「商店」
  if (_shopSellMode) {
    const t = $('appTitle');
    t.innerHTML = `<svg style="width:16px;height:16px;vertical-align:middle;fill:var(--ui-color);transform:translateY(-1px);" viewBox="0 0 1024 1024"><use xlink:href="#icon-back"/></svg> 出售`;
    t.dataset.action = 'back';
  }
}

// 批量菜单：在右键位置弹出。mode='buy' 为兑换（糖果不够的选项置灰），'sell' 为出售（持有不够的置灰）。
// 点击选项结算后菜单保持打开并刷新可操作状态，可连续批量操作（同游戏厅兑换游戏币）
function showShopContextMenu(itemKey, x, y, mode = 'buy') {
  hideShopContextMenu();
  let menu = $('shopCtxMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'shopCtxMenu';
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
  }
  const renderMenu = () => {
    const candyNow = gameData.items['candy'] || 0;
    const options = mode === 'sell' ? SELL_QTY_OPTIONS : BUY_QTY_OPTIONS;
    menu.innerHTML = options.map(q => {
      if (mode === 'sell') {
        const have = gameData.items[itemKey] || 0;
        const gain = sellPriceOf(itemKey) * q;
        const ok = have >= q;
        return `<div class="shop-ctx-item${ok ? '' : ' disabled'}" data-item="${itemKey}" data-q="${q}">
      <span class="shop-ctx-qty">×${q}</span>
      <span class="shop-ctx-cost"><img src="./items/goods/candy.png" style="width:12px;height:12px;vertical-align:middle;image-rendering:pixelated;" /> ×${gain}</span>
    </div>`;
      }
      const cost = CANDY_EXCHANGE[itemKey];
      const total = cost * q;
      const ok = candyNow >= total;
      return `<div class="shop-ctx-item${ok ? '' : ' disabled'}" data-item="${itemKey}" data-q="${q}">
      <span class="shop-ctx-qty">×${q}</span>
      <span class="shop-ctx-cost"><img src="./items/goods/candy.png" style="width:12px;height:12px;vertical-align:middle;image-rendering:pixelated;" /> ×${total}</span>
    </div>`;
    }).join('');
  };
  renderMenu();
  menu.style.display = '';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const { x: lx, y: ly } = logicViewport(x, y); // zoom 下还原逻辑坐标
  const b = popupBounds(); // 夹紧在机身内：手游双屏下机身只占屏幕中间一块
  menu.style.left = Math.max(b.left, Math.min(lx - 24, b.right - mw - 4)) + 'px';
  menu.style.top = Math.max(b.top, Math.min(ly, b.bottom - mh - 4)) + 'px';
  // 菜单内点击不触发外部关闭；点击外部任意位置关闭
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.onclick = async (e) => {
    const opt = e.target.closest('.shop-ctx-item');
    if (!opt || opt.classList.contains('disabled')) return;
    cancelPendingExchange(); // 清掉可能存在的行内确认态，批量操作无需二次确认
    if (mode === 'sell') await doSellBall(opt.dataset.item, Number(opt.dataset.q));
    else await doCandyExchange(opt.dataset.item, Number(opt.dataset.q));
    renderMenu(); // 结算后刷新可操作状态，菜单保持打开可连续操作
  };
  document.addEventListener('pointerdown', hideShopContextMenu);
}

function hideShopContextMenu() {
  const menu = $('shopCtxMenu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('pointerdown', hideShopContextMenu);
}

// ===== 设置视图 =====
// 窗口倍率档位（相对 320×400 基础尺寸的等比缩放，尺寸换算在 Rust 侧 set_window_scale 完成）
// 1 / 1.5 / 2~10 整数档；超出显示器容纳上限时由 Rust 侧自动钳制到实际生效倍率
const WINDOW_SCALES = [1, 1.5, ...Array.from({ length: 9 }, (_, i) => i + 2)];

// 当前 WebView2 zoom 因子（Rust set_window_scale 返回，初始 1）。
// 用于把 window.devicePixelRatio 还原成系统 dpr：WebView2 的 devicePixelRatio 包含 zoom，
// 不排除会导致调整倍率后上报的 dpr 偏大，Rust 算出的 zoom 趋近 1 → 表现为「调高倍不生效」。
let currentZoom = 1;

// 按倍率等比缩放：窗口放大 + webview 内容缩放均在 Rust set_window_scale 内完成。
// 双屏布局机身更高（手游 540 / 桌面双屏 561），窗口基准随之变高、窗口尺寸自适应（否则窗口按 274×342 开、
// 机身缩到约 63% 才塞得下，左右会留边）
export async function applyWindowScale(scale) {
  if (!window.__TAURI__?.core?.invoke) return;
  const s = WINDOW_SCALES.includes(scale) ? scale : 2; // 未设置/非法值兜底默认 2 倍（1 倍物理窗口偏小）
  const mode = getUiMode();
  const baseH = mode === 'mobile' ? 540 : mode === 'dual' ? 561 : 342;
  const invoke = window.__TAURI__.core.invoke;
  const applyOnce = async () => {
    // 上报「系统 dpr」= devicePixelRatio / 当前 zoom（排除已生效的缩放）
    const sysDpr = (window.devicePixelRatio || 1) / (currentZoom || 1);
    await invoke('set_device_pixel_ratio', { dpr: sysDpr });
    const zoom = await invoke('set_window_scale', { scale: s, mode });
    if (typeof zoom === 'number' && zoom > 0) currentZoom = zoom;
  };
  try {
    await applyOnce();
    // 二次校准：窗口 resize 后若 CSS 视口仍偏离基准（274×baseH），用稳定后的 dpr 重设
    await new Promise(r => setTimeout(r, 250));
    if (Math.abs(window.innerWidth - 274) > 1 || Math.abs(window.innerHeight - baseH) > 1) {
      await applyOnce();
    }
  } catch (_) {
  }
  try { await invoke('show_main_window'); } catch (_) {}
}

// 设置页选择窗口倍率：持久化到存档并立即缩放
function setWindowScale(scale) {
  ensureSettings();
  gameData.settings.windowScale = scale;
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  applyWindowScale(scale);
}

// 窗口倍率下拉：点击其它区域自动收起（模块级只绑定一次）
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.window-scale-select')) return;
  document.querySelectorAll('.window-scale-select').forEach(s => {
    s.classList.remove('open');
    const dd = s.querySelector('.region-dropdown');
    if (dd) dd.style.display = 'none';
  });
});

export function showSettingsView() {
  pushNav('settingsView');
  ensureSettings(); // 保证旧档迁移（含捕捉条件四行表格结构）先于渲染执行
  clearBattleTier(); // 战斗中进入设置：清除 NPC 难度边框色，让设置页恢复正常配色
  const content = $('settingsContent');
  const s = gameData.settings || {};
  renderSettings(content, s);
  // 滚轮减速：设置项较多，避免原生滚动一次翻太多
  const sv = $('settingsView');
  sv.onwheel = (e) => {
    e.preventDefault();
    sv.scrollTop += e.deltaY * 0.4;
  };
  showView('settingsView');
}

// 捕捉条件表格：遇敌类型 × 三态策略（普通 / 普通闪 / 神兽 / 神兽闪 / 可悬赏 / 特效）
// 优先级：特效 > 神兽/神兽闪 > 普通/普通闪 > 可悬赏；特效行接管该事件全部遭遇
// 行顺序即优先级，与 battle.js catchFilterResult 的判断次序保持一致
const CF_ROWS = [
  { key: 'twist', label: '特效' },
  { key: 'legend', label: '神兽' },
  { key: 'legendShiny', label: '神兽闪' },
  { key: 'normal', label: '普通' },
  { key: 'normalShiny', label: '普通闪' },
  { key: 'bounty', label: '可悬赏' },
];
const CF_ACTIONS = [
  { v: 'catch', t: '捕捉' },
  { v: 'stop', t: '暂停' },
  { v: 'flee', t: '逃跑' },
];

// 存档导出/导入提示：显示 2.5 秒后收起，文案被替换则不动
function flashSaveHint(text) {
  updateTextBox(text, false, 'app');
  setTimeout(() => {
    if ($('textBoxContent')?.textContent === text) hideTextBox('stage');
    if ($('appTextBoxContent')?.textContent === text) hideTextBox('app');
  }, 2500);
}

export function renderSettings(container, s) {
  const ballLabels = { 'poke-ball': '精灵球', 'ultra-ball': '高级球', 'master-ball': '大师球' };
  const autoCatch = s.autoCatch || false;
  const autoFlee = s.autoFlee || false;
  const windowPinned = s.windowPinned || false;
  const windowScale = WINDOW_SCALES.includes(s.windowScale) ? s.windowScale : 2;
  // 窗口设置只对桌面端有意义：浏览器版与手机端都不显示
  const windowGroupHtml = (document.body.classList.contains('browser-mode') || isUiMobile()) ? '' : `
      <div class="settings-group">
        <div class="settings-group-title">窗口</div>
        <div class="auto-catch-row">
          <div class="auto-catch-label">固定窗口</div>
          <div class="toggle-switch" id="toggleWindowPinned">
            <div class="toggle-track ${windowPinned ? 'on' : ''}"></div>
            <div class="toggle-knob"></div>
          </div>
        </div>
        <div class="auto-catch-row">
          <div class="auto-catch-label">窗口倍率</div>
          <div class="pokedex-region-select window-scale-select" id="windowScaleSelect">
            <span class="scale-value">${windowScale} 倍</span>
            <svg class="region-arrow" viewBox="0 0 8 6" width="8" height="6">
              <path d="M0,1 L4,5 L8,1" stroke="currentColor" fill="none" stroke-width="1.2" />
            </svg>
            <div class="region-dropdown window-scale-dd" style="display:none;">
              ${WINDOW_SCALES.map(x => `<div class="region-dropdown-item${x === windowScale ? ' active' : ''}" data-scale="${x}">${x} 倍</div>`).join('')}
            </div>
          </div>
        </div>
      </div>
`;
  const balls = s.autoCatchBalls || { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true };
  const autoBuffHoney = s.autoBuffHoney || false;
  const autoBuffCharm = s.autoBuffCharm || false;
  const autoRefill = s.autoRefill || false;
  const shinyMasterBall = s.shinyMasterBall || false;
  const variantMasterBall = s.variantMasterBall || false;
  const refillBalls = s.autoRefillBalls || { 'poke-ball': true, 'ultra-ball': false, 'master-ball': false };
  const order = (Array.isArray(s.autoRefillOrder) && s.autoRefillOrder.length === 3)
    ? s.autoRefillOrder : ['poke-ball', 'ultra-ball', 'master-ball'];
  const cf = s.catchFilter || {};
  const gender = s.gender || 'brendan';
  const musicVolume = s.musicVolume ?? 0.6;
  const musicEnabled = s.musicEnabled !== false;
  const sfxEnabled = s.sfxEnabled !== false;
  const battleMusic = s.battleMusic !== false;
  const darkMode = s.darkMode || false;
  const uiMobile = getUiMode() !== 'classic'; // 双屏布局（手游模式/桌面双屏），存档未设置时按平台取默认
  // 捕捉条件表格：各遇敌类型行，策略列选中即换底色
  const cfRow = key => (cf.rows && cf.rows[key]) || { action: 'catch', levelMin: 1, levelMax: 20, uncaughtOnly: false };
  const cfTbody = CF_ROWS.map(({ key, label }) => {
    const r = cfRow(key);
    const actCells = CF_ACTIONS.map(a => `
      <td class="cf-cell act ${r.action === a.v ? 'on' : ''}" data-row="${key}" data-act="${a.v}">${a.t}</td>`).join('');
    const dim = r.action === 'catch' ? '' : ' dim'; // 非捕捉行：等级/未捕获不生效，弱化显示
    // 仅「捕捉」行显示等级输入框，其余行占位
    const lvCell = (r.action === 'catch') ? `
      <td class="cf-cell lv">
        <div class="cf-lv-inner">
          <input type="text" class="filter-lv-input cf-lv-input" data-row="${key}" data-lv="min" inputmode="numeric" autocomplete="off" maxlength="2" value="${r.levelMin || 1}" />
          <input type="text" class="filter-lv-input cf-lv-input" data-row="${key}" data-lv="max" inputmode="numeric" autocomplete="off" maxlength="2" value="${r.levelMax || 20}" />
        </div>
      </td>` : `<td class="cf-cell lv${dim}">—</td>`;
    // 未拥有仅在「捕捉」策略下生效：非捕捉行显示 —，避免误以为勾选对暂停/逃跑有影响
    const uncaughtCell = (r.action === 'catch') ? `
      <td class="cf-cell uncaught ${r.uncaughtOnly ? 'on' : ''}" data-row="${key}">${r.uncaughtOnly ? '☑' : '☐'}</td>` : `<td class="cf-cell uncaught${dim}">—</td>`;
    return `
      <tr data-row="${key}">
        <th class="cf-row-label">${label}</th>
        ${actCells}
        ${lvCell}
        ${uncaughtCell}
      </tr>`;
  }).join('');
  container.innerHTML = `
    <div style="padding:6px 8px;">
      <div class="settings-group">
        <div class="settings-group-title">遇敌与捕捉</div>
        <div class="auto-catch-row">
          <div class="auto-catch-label">自动操作</div>
          <div class="toggle-switch" id="toggleAutoCatch">
            <div class="toggle-track ${autoCatch ? 'on' : ''}"></div>
            <div class="toggle-knob"></div>
          </div>
        </div>
        ${autoCatch ? `
        <div style="padding:4px 4px 2px;">
          <div class="settings-sub-title">自动使用精灵球(按捕获率)</div>
          <div class="ball-check-row">
            ${['poke-ball', 'ultra-ball', 'master-ball'].map(b => `
              <span class="ball-check ${(balls[b] !== false) ? 'on' : ''}" data-ball="${b}">${(balls[b] !== false) ? '☑' : '☐'}${ballLabels[b]}</span>
            `).join('')}
          </div>
        </div>
        ${balls['master-ball'] !== false ? `
        <div style="padding:4px 4px 2px;">
          <div class="settings-sub-title">闪光使用大师球</div>
          <div class="ball-check-row">
            <span class="ball-check ${shinyMasterBall ? 'on' : ''}" id="toggleShinyMaster">${shinyMasterBall ? '☑' : '☐'}启用</span>
          </div>
        </div>
        <div style="padding:4px 4px 2px;">
          <div class="settings-sub-title">外观特效(RGB/污染)使用大师球</div>
          <div class="ball-check-row">
            <span class="ball-check ${variantMasterBall ? 'on' : ''}" id="toggleVariantMaster">${variantMasterBall ? '☑' : '☐'}启用</span>
          </div>
        </div>
        ` : ''}
        <div style="padding:4px 4px 2px;">
          <div class="settings-sub-title">自动使用增益道具</div>
          <div class="ball-check-row">
            <span class="ball-check ${autoBuffHoney ? 'on' : ''}" id="toggleBuffHoney">${autoBuffHoney ? '☑' : '☐'}甜甜蜜</span>
            <span class="ball-check ${autoBuffCharm ? 'on' : ''}" id="toggleBuffCharm">${autoBuffCharm ? '☑' : '☐'}闪耀护符</span>
          </div>
        </div>
        <div class="filter-panel">
          <div class="settings-sub-title">捕捉条件</div>
          <table class="cf-table">
            <thead>
              <tr>
                <th class="cf-corner"></th>
                <th>捕捉</th>
                <th>暂停</th>
                <th>逃跑</th>
                <th class="cf-col-lv">捕捉等级</th>
                <th>未拥有</th>
              </tr>
            </thead>
            <tbody>${cfTbody}</tbody>
          </table>
          <div class="cf-hint-row">
            <div class="cf-hint">捕捉等级范围外的自动逃跑</div>
            <button class="cf-reset-btn" id="cfReset">恢复默认</button>
          </div>
        </div>
        ` : ''}
        <div class="auto-catch-row">
          <div class="auto-catch-label">佛系模式</div>
          <div class="toggle-switch" id="toggleAutoFlee">
            <div class="toggle-track ${autoFlee ? 'on' : ''}"></div>
            <div class="toggle-knob"></div>
          </div>
        </div>
        <div class="cf-hint" style="padding:0 4px 4px;">遇敌后 30 秒未处理宝可梦会自动逃跑，防止挂机进度卡住</div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">背包与补球</div>
        <div class="auto-catch-row">
          <div class="auto-catch-label">自动补球</div>
          <div class="toggle-switch" id="toggleAutoRefill">
            <div class="toggle-track ${autoRefill ? 'on' : ''}"></div>
            <div class="toggle-knob"></div>
          </div>
        </div>
        ${autoRefill ? `
        <div style="padding:6px 4px 2px 8px;">
          <div class="settings-sub-title">补球优先级（左高右低）</div>
          <div class="refill-order-row" id="refillOrderList">
            ${order.map((b, i) => `
              <span class="refill-order-item${refillBalls[b] === false ? ' off' : ''}" data-ball="${b}">
                <span class="refill-order-arrow left ${i === 0 ? 'hidden' : ''}" data-dir="-1">‹</span>
                <span class="refill-order-name">${ballLabels[b]}</span>
                <span class="refill-order-arrow right ${i === order.length - 1 ? 'hidden' : ''}" data-dir="1">›</span>
              </span>
            `).join('')}
          </div>
        </div>
        ` : ''}
      </div>

      ${windowGroupHtml}
      <div class="settings-group">
        <div class="settings-group-title">外观</div>
        <div class="auto-catch-row">
          <div class="auto-catch-label">夜间模式</div>
          <div class="toggle-switch" id="toggleDarkMode">
            <div class="toggle-track ${darkMode ? 'on' : ''}"></div>
            <div class="toggle-knob"></div>
          </div>
        </div>
        <div class="auto-catch-row">
          <div class="auto-catch-label">${isMobilePlatform() ? '手游模式' : '双屏模式'}</div>
          <div class="toggle-switch" id="toggleUiMode">
            <div class="toggle-track ${uiMobile ? 'on' : ''}"></div>
            <div class="toggle-knob"></div>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">声音</div>
        <div class="auto-catch-row">
          <div class="auto-catch-label">音乐</div>
          <div class="toggle-switch" id="toggleMusicEnabled">
            <div class="toggle-track ${musicEnabled ? 'on' : ''}"></div>
            <div class="toggle-knob"></div>
          </div>
        </div>
        ${musicEnabled ? `
        <div class="auto-catch-row" style="padding-left:8px;">
          <div class="auto-catch-label">战斗音乐</div>
          <div class="toggle-switch" id="toggleBattleMusic">
            <div class="toggle-track ${battleMusic ? 'on' : ''}"></div>
            <div class="toggle-knob"></div>
          </div>
        </div>
        <div class="auto-catch-row" style="padding-left:8px;">
          <div class="auto-catch-label">音量</div>
          <div class="volume-row">
            <input type="range" class="volume-slider" id="musicVolumeSlider" min="0" max="1" step="0.05" value="${musicVolume}" />
          </div>
        </div>
        ` : ''}
        <div class="auto-catch-row">
          <div class="auto-catch-label">音效</div>
          <div class="toggle-switch" id="toggleSfxEnabled">
            <div class="toggle-track ${sfxEnabled ? 'on' : ''}"></div>
            <div class="toggle-knob"></div>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">角色与存档</div>
        <div class="auto-catch-row">
          <div class="auto-catch-label">角色</div>
          <div class="gender-check-row">
            <span class="ball-check ${gender === 'brendan' ? 'on' : ''}" id="genderBrendan">${gender === 'brendan' ? '☑' : '☐'}小悠</span>
            <span class="ball-check ${gender === 'may' ? 'on' : ''}" id="genderMay">${gender === 'may' ? '☑' : '☐'}小遥</span>
          </div>
        </div>
        <div class="reset-save-row">
          <span class="auto-catch-label">导出存档</span>
          <span class="reset-save-btn" id="exportSaveBtn">导出</span>
        </div>
        <div class="reset-save-row">
          <span class="auto-catch-label">导入存档</span>
          <span class="reset-save-btn" id="importSaveBtn">导入</span>
        </div>
        <div class="reset-save-row">
          <span class="auto-catch-label">重置存档</span>
          <span class="reset-save-btn" id="resetSaveBtn">重置</span>
        </div>
        <div class="reset-save-row">
          <span class="auto-catch-label">刷新游戏</span>
          <span class="reset-save-btn" id="reloadGameBtn">刷新</span>
        </div>
      </div>
      <a href="https://github.com/ZTMYO/PokeIdle" id="githubLink" class="settings-footer-link" target="_blank" rel="noopener">
        <svg viewBox="0 0 1024 1024" width="16" height="16" style="flex-shrink:0;"><use xlink:href="#icon-github"/></svg>
        <span style="font-weight:600;">ZTMYO</span>
      </a>
      <div class="settings-version" id="settingsVersion"></div>
      <div id="declarationBtn" style="text-align:center;font-size:9px;opacity:0.5;padding:2px 0 4px;cursor:pointer;">版权声明</div>
    </div>
  `;
  container.querySelector('#toggleAutoCatch')?.addEventListener('click', toggleAutoCatch);
  container.querySelector('#toggleShinyMaster')?.addEventListener('click', toggleShinyMasterBall);
  container.querySelector('#toggleVariantMaster')?.addEventListener('click', toggleVariantMasterBall);
  container.querySelector('#toggleMusicEnabled')?.addEventListener('click', toggleMusicEnabled);
  container.querySelector('#toggleSfxEnabled')?.addEventListener('click', toggleSfxEnabled);
  container.querySelector('#genderBrendan')?.addEventListener('click', () => toggleGender('brendan'));
  container.querySelector('#genderMay')?.addEventListener('click', () => toggleGender('may'));
  container.querySelector('#toggleAutoFlee')?.addEventListener('click', toggleAutoFlee);
  container.querySelector('#toggleWindowPinned')?.addEventListener('click', toggleWindowPinned);
  container.querySelector('#toggleDarkMode')?.addEventListener('click', toggleDarkMode);
  container.querySelector('#toggleUiMode')?.addEventListener('click', toggleUiMode);
  // 窗口倍率下拉：展开/收起（同一时刻只开一个）
  const scaleSel = container.querySelector('#windowScaleSelect');
  scaleSel?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = scaleSel.querySelector('.region-dropdown');
    const open = dd.style.display !== 'none';
    document.querySelectorAll('.window-scale-select').forEach(s => {
      s.classList.remove('open');
      const d = s.querySelector('.region-dropdown');
      if (d) d.style.display = 'none';
    });
    if (!open) {
      dd.style.display = '';
      scaleSel.classList.add('open');
    }
  });
  scaleSel?.querySelectorAll('.region-dropdown-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      setWindowScale(Number(el.dataset.scale));
    });
  });
  container.querySelector('#toggleBattleMusic')?.addEventListener('click', toggleBattleMusic);
  // 重置存档：二次点击确认，防误触
  container.querySelector('#resetSaveBtn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = '确定重置？';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => {
        btn.classList.remove('confirm');
        btn.textContent = '重置';
      }, 3000);
      return;
    }
    resetSave();
  });
  // 刷新游戏：先保存再重载，等效 Ctrl+R 调试刷新
  container.querySelector('#reloadGameBtn')?.addEventListener('click', () => {
    saveGame();
    location.reload();
  });
  // 导出存档：桌面版调 Tauri 命令打开目录选择器；网页版直接下载 JSON 文件。
  // 两种途径都会上调 lastSaveTime，迁移到新设备后不会被 localStorage 旧数据覆盖
  container.querySelector('#exportSaveBtn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#exportSaveBtn');
    gameData.stats.lastSaveTime = Date.now() + 10 * 365 * 24 * 3600 * 1000;
    if (window.__POKEIDLE_MOBILE__?.exportSave) {
      btn.textContent = '导出中…';
      try {
        await window.__POKEIDLE_MOBILE__.exportSave(JSON.stringify(gameData));
        flashSaveHint('存档已导出');
        btn.textContent = '已导出 ✓';
      } catch (e) {
        flashSaveHint('存档导出失败');
        btn.textContent = '导出失败';
      }
      setTimeout(() => { btn.textContent = '导出'; }, 2500);
      return;
    }
    if (!window.__TAURI__?.core?.invoke) {
      // 网页版：生成 JSON 触发浏览器下载
      const blob = new Blob([JSON.stringify(gameData)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pokemon-idle-save.json';
      a.click();
      URL.revokeObjectURL(url);
      flashSaveHint('存档已导出');
      btn.textContent = '已导出 ✓';
      setTimeout(() => { btn.textContent = '导出'; }, 2500);
      return;
    }
    btn.textContent = '导出中…';
    try {
      const path = await window.__TAURI__.core.invoke('export_save_data', { data: JSON.stringify(gameData) });
      flashSaveHint('存档已导出');
      btn.textContent = '已导出 ✓';
    } catch (e) {
      if (typeof e === 'string' && e.includes('取消')) {
        btn.textContent = '导出';
        return;
      }
      flashSaveHint('存档导出失败');
      btn.textContent = '导出失败';
    }
    setTimeout(() => { btn.textContent = '导出'; }, 2500);
  });
  // 导入存档：桌面版调 Tauri 命令选文件；网页版用浏览器文件选择器读取 JSON。
  // 两种途径都会比对时间戳，确保导入的 lastSaveTime > 当前，防止被旧数据回滚
  container.querySelector('#importSaveBtn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#importSaveBtn');
    if (!window.__TAURI__?.core?.invoke) {
      // 网页版：弹出文件选择器读取 JSON
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        btn.textContent = '导入中…';
        try {
          const jsonStr = await file.text();
          const imported = JSON.parse(jsonStr);
          if (!imported || typeof imported !== 'object' || !imported.stats) {
            flashSaveHint('存档格式无效');
            btn.textContent = '导入失败';
            setTimeout(() => { btn.textContent = '导入'; }, 2500);
            return;
          }
          applyImportedSave(imported);
        } catch (e) {
          flashSaveHint('存档导入失败');
          btn.textContent = '导入失败';
          setTimeout(() => { btn.textContent = '导入'; }, 2500);
        }
      };
      input.click();
      return;
    }
    btn.textContent = '导入中…';
    try {
      const jsonStr = await window.__TAURI__.core.invoke('import_save_data');
      const imported = JSON.parse(jsonStr);
      if (!imported || typeof imported !== 'object' || !imported.stats) {
        flashSaveHint('存档格式无效');
        btn.textContent = '导入失败';
        setTimeout(() => { btn.textContent = '导入'; }, 2500);
        return;
      }
      applyImportedSave(imported);
    } catch (e) {
      if (typeof e === 'string' && e.includes('取消')) {
        btn.textContent = '导入';
        return;
      }
      flashSaveHint('存档导入失败');
      btn.textContent = '导入失败';
      setTimeout(() => { btn.textContent = '导入'; }, 2500);
    }
  });
  // 导入的存档：比对时间戳后覆盖并刷新（桌面版/网页版共用）
  function applyImportedSave(imported) {
    const importedTime = imported.stats.lastSaveTime || 0;
    const currentTime = gameData.stats.lastSaveTime || 0;
    if (importedTime <= currentTime) {
      imported.stats.lastSaveTime = currentTime + 1;
    }
    setGameData(imported);
    ensureGpsState();
    saveGame().then(() => {
      flashSaveHint('存档导入成功，即将刷新');
      const b = container.querySelector('#importSaveBtn');
      if (b) b.textContent = '已导入 ✓';
      setTimeout(() => { location.reload(); }, 800);
    });
  }
  container.querySelector('#toggleBuffHoney')?.addEventListener('click', toggleAutoBuffHoney);
  container.querySelector('#toggleBuffCharm')?.addEventListener('click', toggleAutoBuffCharm);
  container.querySelector('#toggleAutoRefill')?.addEventListener('click', toggleAutoRefill);
  const volSlider = container.querySelector('#musicVolumeSlider');
  volSlider?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    e.target.style.setProperty('--volume-fill', v * 100 + '%'); // appearance:none 后原生填充失效，用 CSS 变量画轨道进度
    setMusicVolume(v);
  });
  // 初始填充与当前音量一致
  if (volSlider) volSlider.style.setProperty('--volume-fill', (Number(volSlider.value) * 100) + '%');
  container.querySelectorAll('.ball-check[data-ball]').forEach(el => {
    el.addEventListener('click', () => toggleAutoCatchBall(el.dataset.ball));
  });
  container.querySelectorAll('.ball-check[data-refill-ball]').forEach(el => {
    el.addEventListener('click', () => toggleAutoRefillBall(el.dataset.refillBall));
  });
  // 捕捉条件表格：点击策略单元格（捕捉/暂停/逃跑）切换该行策略并高亮
  container.querySelectorAll('.cf-cell.act').forEach(el => {
    el.addEventListener('click', () => {
      const rows = gameData.settings.catchFilter?.rows;
      if (!rows || !rows[el.dataset.row]) return;
      rows[el.dataset.row].action = el.dataset.act;
      renderSettings(container, gameData.settings);
      saveGame();
    });
  });
  // 捕捉条件表格：点击「未捕获」单元格开关（仅该行为捕捉时生效）
  container.querySelectorAll('.cf-cell.uncaught').forEach(el => {
    el.addEventListener('click', () => {
      const rows = gameData.settings.catchFilter?.rows;
      const r = rows && rows[el.dataset.row];
      if (!r || r.action !== 'catch') return; // 非捕捉行：等级/未捕获不生效，禁止点亮
      r.uncaughtOnly = !r.uncaughtOnly;
      renderSettings(container, gameData.settings);
      saveGame();
    });
  });
  // 捕捉条件表格：各行等级范围（野生等级 1~20）。实时过滤输入（只留数字、最多 2 位、超 20 截断），change 时落库
  container.querySelectorAll('.cf-lv-input').forEach(el => {
    const rows = gameData.settings.catchFilter?.rows;
    const r = rows && rows[el.dataset.row];
    el.addEventListener('input', () => {
      let v = el.value.replace(/\D/g, '').slice(0, 2);
      if (v !== '' && Number(v) > 20) v = '20';
      if (v === '0') v = ''; // 野生等级 1~20，不允许输入 0（0 仅作为清空=不限）
      el.value = v;
    });
    el.addEventListener('change', () => {
      if (!r) return;
      const isMin = el.dataset.lv === 'min';
      const lo = r.levelMin || 1;   // 0=不限，等效最低 1
      const hi = r.levelMax || 20;  // 0=不限，等效最高 20
      let v = Number(el.value) || 0;
      if (v === 0) v = isMin ? lo : hi; // 清空不允许空白：最低回落 1、最高回落 20
      if (isMin) {
        if (v > hi) { r.levelMin = hi; r.levelMax = v; } // 最低超过最高 → 两者换位
        else r.levelMin = v;
      } else {
        if (v < lo) { r.levelMax = lo; r.levelMin = v; } // 最高低于最低 → 两者换位
        else r.levelMax = v;
      }
      saveGame();
      // 换位会改动对端值，统一回写两个输入框显示（保证不空白）
      container.querySelectorAll(`.cf-lv-input[data-row="${el.dataset.row}"]`).forEach(i => {
        i.value = (i.dataset.lv === 'min' ? r.levelMin : r.levelMax) || (i.dataset.lv === 'min' ? 1 : 20);
      });
    });
  });
  // 捕捉条件：恢复默认（全部行复位为 捕捉 / 等级 1~20 / 不勾选未捕获）
  container.querySelector('#cfReset')?.addEventListener('click', () => {
    const rows = gameData.settings.catchFilter?.rows;
    if (!rows) return;
    for (const key of Object.keys(rows)) {
      rows[key] = { action: 'catch', levelMin: 1, levelMax: 20, uncaughtOnly: false };
    }
    renderSettings(container, gameData.settings);
    saveGame();
  });
  // 补球优先级：左右箭头调整顺序（从左到右优先级从高到低），点击格子切换启用/禁用
  const orderList = container.querySelector('#refillOrderList');
  if (orderList) {
    const moveInOrder = (ball, dir) => {
      const arr = [...(gameData.settings.autoRefillOrder || [])];
      const i = arr.indexOf(ball);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      gameData.settings.autoRefillOrder = arr;
      renderSettings(container, gameData.settings);
      saveGame();
    };
    orderList.querySelectorAll('.refill-order-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const arrow = e.target.closest('.refill-order-arrow');
        if (arrow) { moveInOrder(el.dataset.ball, Number(arrow.dataset.dir)); return; }
        toggleAutoRefillBall(el.dataset.ball); // 点击格子本体：切换该球是否自动补
      });
    });
  }
  // GitHub 仓库链接：Tauri 下用 opener 插件在系统浏览器打开
  container.querySelector('#githubLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    const url = 'https://github.com/ZTMYO/PokeIdle';
    if (window.__POKEIDLE_MOBILE__?.openExternal) window.__POKEIDLE_MOBILE__.openExternal(url);
    else if (window.__TAURI__?.opener?.openUrl) window.__TAURI__.opener.openUrl(url);
    else window.open(url, '_blank');
  });
  (async () => {
    let v = '';
    try { v = await window.__TAURI__?.app?.getVersion?.(); } catch (_) {}
    const el = container.querySelector('#settingsVersion');
    if (el) el.textContent = v ? `v${v}` : 'v1.1.3';
  })();
  // 版权声明：跳转声明视图
  container.querySelector('#declarationBtn')?.addEventListener('click', () => showDeclarationView());
}

// 重置存档：清空本地存档并开新档
export async function resetSave() {
  window.__resettingSave = true;
  try { localStorage.removeItem('pokemon_idle_save'); } catch (_) { }
  try { localStorage.removeItem('pokemon_idle_road'); } catch (_) { }
  try { localStorage.removeItem('pokemon_idle_session'); } catch (_) { }
  setGameData(getDefaultSave());
  ensureGpsState();
  await saveGame();
  location.reload();
}

// 确保设置存在（旧存档可能缺 settings 或 autoCatchBalls）
function ensureSettings() {
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, shinyStop: false, legendStop: false, autoBuffHoney: false, autoBuffCharm: false, gender: 'brendan' };
  if (!gameData.settings.autoCatchBalls) gameData.settings.autoCatchBalls = { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true };
  if (gameData.settings.autoRefill == null) gameData.settings.autoRefill = false;
  if (gameData.settings.shinyMasterBall == null) gameData.settings.shinyMasterBall = false; // 闪光使用大师球（默认关）
  if (gameData.settings.variantMasterBall == null) gameData.settings.variantMasterBall = false; // 特效使用大师球（默认关）
  if (!gameData.settings.autoRefillBalls) gameData.settings.autoRefillBalls = { 'poke-ball': true, 'ultra-ball': false, 'master-ball': false };
  if (!Array.isArray(gameData.settings.autoRefillOrder) || gameData.settings.autoRefillOrder.length !== 3) {
    gameData.settings.autoRefillOrder = ['poke-ball', 'ultra-ball', 'master-ball']; // 默认便宜优先
  }
  if (!gameData.settings.catchFilter) gameData.settings.catchFilter = {};
  // 旧档迁移：扁平三态（normal/shiny/legend + levelMin/Max + uncaughtOnly）→ 四行表格 rows
  if (!gameData.settings.catchFilter.rows) {
    const f = gameData.settings.catchFilter;
    const clampLv = v => Math.max(0, Math.min(20, Number(v) || 0)); // 野生等级上限 20，0 表示不限制
    const mk = action => ({ action: action || 'catch', levelMin: 1, levelMax: 20, uncaughtOnly: false }); // 默认最低 1（野生最低等级）、最高 20（野生上限，等效不限制）
    gameData.settings.catchFilter = {
      rows: {
        normal:      { action: f.normal == null ? 'catch' : f.normal, levelMin: clampLv(f.levelMin), levelMax: clampLv(f.levelMax), uncaughtOnly: !!f.uncaughtOnly },
        normalShiny: mk(f.shiny),
        legend:      mk(f.legend),
        legendShiny: mk(f.shiny),
      },
    };
  }
  // 各行字段兜底 + 等级收敛
  for (const k of ['twist', 'normal', 'normalShiny', 'legend', 'legendShiny', 'bounty']) {
    const r = gameData.settings.catchFilter.rows[k] = gameData.settings.catchFilter.rows[k] || { action: 'catch', levelMin: 1, levelMax: 20, uncaughtOnly: false };
    if (!['catch', 'stop', 'flee'].includes(r.action)) r.action = 'catch';
    r.levelMin = Math.max(0, Math.min(20, Number(r.levelMin) || 0));
    r.levelMax = Math.max(0, Math.min(20, Number(r.levelMax) || 0));
    r.uncaughtOnly = !!r.uncaughtOnly;
  }
  if (gameData.settings.windowScale == null) gameData.settings.windowScale = 2; // 默认 2 倍（1 倍物理窗口偏小）
  if (gameData.settings.musicVolume == null) gameData.settings.musicVolume = 0.6;
  if (gameData.settings.musicEnabled == null) gameData.settings.musicEnabled = true;
  if (gameData.settings.sfxEnabled == null) gameData.settings.sfxEnabled = true;
  if (gameData.settings.darkMode == null) gameData.settings.darkMode = false; // 夜间模式（默认关闭）
}

// 夜间模式开关：立即应用到根元素 data-theme（样式层已定义深色变量覆盖），并持久化
export function toggleDarkMode() {
  ensureSettings();
  gameData.settings.darkMode = !gameData.settings.darkMode;
  document.documentElement.dataset.theme = gameData.settings.darkMode ? 'dark' : 'light';
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

// 双屏开关（桌面「双屏模式」/ 手机「手游模式」）：两套布局的视图归属/导航栈完全不同，写档后直接重启界面
export async function toggleUiMode() {
  ensureSettings();
  const next = getUiMode() === 'classic' ? (isMobilePlatform() ? 'mobile' : 'dual') : 'classic';
  gameData.settings.uiMode = next;
  applyUiMode(next);
  await saveGame();
  location.reload();
}

// 音乐总开关：关闭时暂停所有背景音乐（地区曲/覆盖曲），音效不受影响；重开恢复播放
export function toggleMusicEnabled() {
  ensureSettings();
  gameData.settings.musicEnabled = !(gameData.settings.musicEnabled !== false);
  setMusicEnabled(gameData.settings.musicEnabled);
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

// 音效开关：独立于音乐，只控制短促效果音（闪光登场等）
function toggleSfxEnabled() {
  ensureSettings();
  gameData.settings.sfxEnabled = !(gameData.settings.sfxEnabled !== false);
  setSfxEnabled(gameData.settings.sfxEnabled);
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

// 音乐音量：滑条实时调节（0 ~ 100%）
function setMusicVolume(v) {
  ensureSettings();
  v = Math.max(0, Math.min(1, Number(v) || 0));
  gameData.settings.musicVolume = v;
  setVolume(v);
  saveGame();
}

export function toggleAutoBuffHoney() {
  ensureSettings();
  gameData.settings.autoBuffHoney = !gameData.settings.autoBuffHoney;
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  // 刚开启且闲置中，立即使用一个
  if (gameData.settings.autoBuffHoney && phase === 'idle' && !honeyBuffActive && !charmBuffActive) {
    activateHoney();
  }
}

export function toggleAutoBuffCharm() {
  ensureSettings();
  gameData.settings.autoBuffCharm = !gameData.settings.autoBuffCharm;
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  // 刚开启且闲置中，立即使用一个（甜甜蜜生效期间不叠加护符）
  if (gameData.settings.autoBuffCharm && phase === 'idle' && !charmBuffActive && !honeyBuffActive) {
    activateShinyCharm();
  }
}

// 闪光使用大师球：勾选后自动捕捉遇到闪光优先用大师球（捕获率极高不逃跑）
function toggleShinyMasterBall() {
  ensureSettings();
  gameData.settings.shinyMasterBall = !gameData.settings.shinyMasterBall;
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

// 外观特效(RGB/污染)使用大师球：勾选后时空扭曲的特效宝可梦优先用大师球（与闪光选项并存）
function toggleVariantMasterBall() {
  ensureSettings();
  gameData.settings.variantMasterBall = !gameData.settings.variantMasterBall;
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

export function toggleAutoCatch() {
  ensureSettings();
  gameData.settings.autoCatch = !gameData.settings.autoCatch;
  if (gameData.settings.autoCatch) {
    gameData.settings.autoFlee = false;
    stopAutoFleeTimer(); // 关闭佛系倒计时
  }
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  updateStats(); // 立即刷新底部状态栏（自动模式文字显示/隐藏）
  // 若当前正在遇敌且刚开启了自动捕捉：仅在游戏页立即接管。
  // 非游戏页（设置页等）下 encounterView 隐藏，丢球动画取不到真实尺寸会错位，
  // 交给切回游戏页时的 showView 统一接管
  if (gameData.settings.autoCatch && phase === 'encounter' && currentEncounter && isOnGameView()) {
    autoCatch();
  }
}

export function toggleAutoFlee() {
  ensureSettings();
  gameData.settings.autoFlee = !gameData.settings.autoFlee;
  if (gameData.settings.autoFlee) gameData.settings.autoCatch = false;
  else stopAutoFleeTimer(); // 关闭佛系：立即停止逃跑倒计时并隐藏进度条
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  updateStats(); // 立即刷新底部状态栏（佛系文字显示/隐藏）
  // 若当前正在遇敌且刚开启了佛系模式，启动倒计时
  if (gameData.settings.autoFlee && phase === 'encounter' && currentEncounter) {
    stopAutoFleeTimer(); // 先清旧计时
    startAutoFleeTimer();
  }
}

function toggleWindowPinned() {
  ensureSettings();
  gameData.settings.windowPinned = !gameData.settings.windowPinned;
  const pinned = gameData.settings.windowPinned;
  // 调用 Tauri API 固定/取消固定窗口
  if (window.__TAURI__?.core?.invoke) {
    window.__TAURI__.core.invoke('set_window_pinned', { pinned }).catch(() => { });
    try {
      const tw = window.__TAURI__?.window;
      if (tw?.getCurrentWindow) tw.getCurrentWindow().setAlwaysOnTop(pinned);
      else if (tw?.appWindow?.setAlwaysOnTop) tw.appWindow.setAlwaysOnTop(pinned);
    } catch (_) { }
  }
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

// 战斗音乐开关：关闭后战斗保持地区曲
function toggleBattleMusic() {
  ensureSettings();
  gameData.settings.battleMusic = !(gameData.settings.battleMusic !== false);
  setBattleMusic(gameData.settings.battleMusic);
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  // 战斗中即时生效：开启切入战斗曲，关闭恢复地区曲
  if (phase === 'encounter') {
    if (gameData.settings.battleMusic) playBattle();
    else endBattle();
  }
}

export function toggleAutoCatchBall(ballType) {
  ensureSettings();
  gameData.settings.autoCatchBalls[ballType] = !(gameData.settings.autoCatchBalls[ballType] !== false);
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  updateStats(); // 立即刷新「自动捕捉中/自动逃跑中」文字
}

// 自动补球总开关
export function toggleAutoRefill() {
  ensureSettings();
  gameData.settings.autoRefill = !gameData.settings.autoRefill;
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

// 自动补球：勾选指定球种（勾选的球数量为 0 时自动用糖果补 1 个）
export function toggleAutoRefillBall(ballType) {
  ensureSettings();
  gameData.settings.autoRefillBalls[ballType] = !(gameData.settings.autoRefillBalls[ballType] !== false);
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

export function toggleGender(g) {
  ensureSettings();
  gameData.settings.gender = g;
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  // 立即刷新角色画面：走路/跑步/骑车/捡道具 + 遇敌页丢球背影；钓鱼中恢复钓鱼画面
  applyCharSprites();
  if (_fishing) {
    import('./fishing.js').then(m => m.applyFishingVisual());
  }
}

// ===== 教程视图 =====
// 左侧导航列表 + 右侧详情文案（数值实时引用 config，随配置变动保持同步）

// 渲染数据表：表头数组 + 行数组（每行与表头同列数），带边框表格（数据驱动）
// widths 可选：每列宽度数组（数字=px，字符串按原样，如 '28%'/'auto'），缺省列按 fixed 布局平分剩余
function tutorialTable(rows, headers, widths) {
  const head = headers.map((h, i) =>
    `<th${widths ? ` style="width:${typeof widths[i] === 'number' ? widths[i] + 'px' : widths[i]}"` : ''}>${h}</th>`).join('');
  const body = rows.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="tutorial-table"><tr>${head}</tr>${body}</table>`;
}

// 道具掉落：按稀有度从低到高（常见→稀有）排序，配置变化自动同步（单位秒，1/X 秒掉落一个）
const ITEM_DROP_ROWS = Object.entries(ITEM_RATES)
  .sort((a, b) => b[1] - a[1])
  .map(([k, rate]) => [ITEM_NAMES[k], `<b>1/${Math.round(1 / rate)}</b>`]);

// 钓鱼收获道具的概率：按 ITEM_RATES 权重占比计算，配置变化自动同步。
// 小概率保留两位小数——直接取整会得到一串 0%
const FISH_ITEM_ROWS = (() => {
  const total = Object.values(ITEM_RATES).reduce((a, b) => a + b, 0);
  return Object.entries(ITEM_RATES)
    .sort((a, b) => b[1] - a[1])
    .map(([k, rate]) => {
      const pct = (rate / total) * 100;
      return [ITEM_NAMES[k], `<b>${pct >= 1 ? Math.round(pct) : pct.toFixed(2)}</b>%`];
    });
})();

// 极稀有（稀有度≈1）出现权重相对无 buff 的倍率（公式与 items.js pickWeightedPokemon 一致）
function rarityWeightBoost(boost) {
  const penalty = Math.max(0.2, 0.8 - boost * 0.5);
  return ((1 - penalty) / 0.2).toFixed(2);
}

const TUTORIAL_SECTIONS = [
  {
    title: '序章',
    html: `<p>你是在丰缘长大的训练家，早已帮助小田卷博士完成了丰缘地区的图鉴，身经百战，是这片地区公认的冠军级训练家。</p>`
      + `<p>然而世界远比丰缘辽阔——如今九大地区（关都、城都、丰缘、神奥、合众、卡洛斯、阿罗拉、伽勒尔、帕底亚）早已打通陆路，各地的宝可梦正等着被收录进更完整的图鉴。</p>`
      + `<p>出发之前，小田卷博士将一部<b>手机</b>交到你手中：<b>导航</b>、<b>图鉴</b>、<b>孵蛋器</b>、<b>混合器</b>、<b>农场</b>……里面的应用足以支撑一场全新的旅行。</p>`
      + `<p>你背起行囊再次出发。前方的每一条道路、每一次遭遇，都将写下属于你的冒险故事。</p>`,
  },
  {
    title: '目标',
    html: `<p>挂机收集道具，捕捉宝可梦，完成全图鉴！</p>`
  },
  {
    title: '道具',
    html: `<p>挂机时主角会拾取到道具，稀有度从低到高如下：</p>` + tutorialTable(ITEM_DROP_ROWS, ['道具', '概率（秒/个）'], [52, 'auto'])
      + `<p>拾取<b>糖果</b>时还有概率一次获得更多：×2、×5、×50 甚至一次 <b>×100</b> 颗。</p>`
      + `<p><b>球</b>（精灵球 / 高级球 / 大师球）与<b>增益</b>（甜甜蜜 / 闪耀护符）：挂机拾取、商店兑换、NPC 对战掉落。</p>`
      + `<p><b>神秘蛋</b>挂机也能捡到；<b>自行车</b>骑完自行车道路段 +1；两者都能在商店兑换。</p>`
      + `<p><b>糖果</b>是货币，<b>经验糖果</b>给宝可梦加经验，<b>招式机</b>永久解锁招式，<b>树果</b>来自农场——各自渠道见对应章节。</p>`
      + `<p><b>进化道具</b>与<b>薄荷</b>不能在路上拾取，只有这几条渠道：</p>`
      + tutorialTable([
        ['今日道具', '每天一批，每件限买 1 个'],
        ['悬赏', '中档给常见，高阶给稀有'],
        ['派遣', '每槽额外 1 件，时长越长概率越高'],
        ['钓鱼', '钓到道具时有概率改给 1 件'],
        ['对战', '四档都有概率，越难越贵'],
      ], ['渠道', '给什么'], [56, 'auto'])
      + `<p>道具都是<b>一次性消耗品</b>；<b>道具盒</b>里能查看持有数与来源，用不上的可在商店回收：按<b>基础价的 40%</b> 折算糖果（进化道具、专属道具、薄荷都照此办理）。</p>`,
  },
  {
    title: '遭遇',
    html: `<p>每隔 <b>${Math.round(ENCOUNTER_MIN / 60)}~${Math.round(ENCOUNTER_MAX / 60)}</b> 分钟遇到一只当前地区的野生宝可梦。</p>`
      + `<p>野生宝可梦的<b>等级在 ${1}~${WILD_LEVEL_MAX} 级</b>之间随机生成，但不会到它自己的进化等级（免得一抓来就能进化）。</p>`
      + `<p>每个地区每天还有几只<b>神兽 / 幻兽</b>混在野池里（数量随该地区神兽多少浮动，少的至少 1 只）：遇敌时约 <b>1/${Math.round(1 / LEGEND_ENCOUNTER_RATE)}</b> 的概率直接遇到，甜甜蜜 / 闪耀护符生效期间约 <b>1/${Math.round(1 / LEGEND_ENCOUNTER_RATE_BUFF)}</b>，现身等级固定 <b>${LEGEND_LEVEL}</b>。</p>`
      + `<p>连着 <b>${LEGEND_PITY}</b> 次遇敌都没出过神兽的话，下一只必定是。</p>`
  },
  {
    title: '手机',
    html: `<p>点击标题栏的<b>手机</b>按钮进入，里面放着常用的应用（<b>导航</b>、<b>图鉴</b>、<b>孵蛋器</b>、<b>混合器</b>、<b>农场</b>、<b>交换</b>、<b>成就</b>、<b>统计</b>……），也可以查看当前系统时间。</p>`
      + `<p>滚动滚轮或点击底部圆点可翻到<b>第二页</b>，那里放着<b>日志</b>、<b>饲育屋</b>、<b>训练</b>、<b>配队</b>、<b>对战</b>、<b>游戏厅</b>、<b>卡册</b>、<b>道具盒</b>与<b>派遣</b>应用。科学的力量真伟大！</p>`
  },
  {
    title: '图鉴',
    html: `<p>在<b>手机</b>页面打开<b>图鉴</b>应用，支持<b>搜索</b>（输入名称快速检索）与地区筛选，点表头可以按该字段排序。</p>`
      + `<p>点进详情：遇到过能看到基础信息与完整日志，<b>获得后</b>解锁精确数值、种族值条与爱吃的食物。</p>`
  },
  {
    title: '统计',
    html: `<p>在<b>手机</b>页面打开<b>统计</b>应用可查看冒险数据：<b>欧非评定</b>按每次遭遇的稀有度与捕获运气综合评价称号；</p>`
      + `<p>板块分为：数据总览、冒险进度、消耗统计、农场与合成、地区悬赏、NPC对战、游戏厅战绩、道具累计获得。</p>`
  },
  {
    title: '成就',
    html: `<p>在<b>手机</b>页面打开<b>成就</b>应用领取：每项累计统计达标<b>一级</b>即可领一次糖果。</p>`
      + `<p>等级按 <b>1-2-5</b> 规整序列无限递进，未领的等级会一直累计；除「图鉴收藏家」到上限完结外，其余成就等级<b>无限</b>。</p>`,
  },
  {
    title: '地区',
    html: `<p>游戏共 <b>${REGION_CYCLE.length}</b> 个地区：${REGION_CYCLE.map(r => `<b>${r}</b>`).join('、')}。</p>`
      + `<p>不同地区遇到的宝可梦各不相同：对于地区之间的道路，每段路<b>前半程</b>算出发地区、<b>后半程</b>算目标地区。</p>`
  },
  {
    title: '导航',
    html: `<p>在<b>手机</b>页面打开<b>导航</b>应用（或点主界面的位置文字）选目的地即可手动导航。</p>`
      + `<p>开启<b>漫游</b>后，没有目的地时会自动沿<b>环国路线</b>（合众→帕底亚→阿罗拉→丰缘→关都→城都→神奥→卡洛斯→伽勒尔→合众…循环）选择下一站。</p>`
      + `<p>到达目的地后导航结束（若开启<b>漫游</b>，会自动选择下一站）。</p>`
      + `<p>进度由主角实际移动驱动——跑步更快，遇敌或钓鱼时暂停（详见「<b>钓鱼</b>」章节）。</p>`
      + `<p>导航推进的是<b>所在地区</b>（决定遇敌池、地区悬赏、大量出没事件）；<b>孵蛋</b>与<b>树果方块</b>按<b>行走里程</b>计算，与是否导航<b>无关</b>。</p>`
  },
  {
    title: '事件',
    html: `<p>道路网络上会随机出现两种<b>道路事件</b>：<b>大量出没</b>与<b>时空扭曲</b>，各有独立的事件点。</p>`
      + `<p>在<b>导航</b>页地图上能看到事件点标记，<b>点击即可导航过去</b>。</p>`
      + `<p>事件点是一个<b>点</b>而不是整条路：只有抵达事件点并停下才算进入事件区域，<b>途经该路段不算</b>；到达后（未开启漫游）会<b>自动停在事件点</b>。</p>`
      + `<p><b>大量出没</b>：每隔 <b>${MASS_GEN_MIN}~${MASS_GEN_MAX}</b> 分钟出现一次，<b>锁定该地区的一只宝可梦</b>大量出现，闪光率 <b>1/${Math.round(1 / MASS_SHINY_CHANCE)}</b>（不吃闪耀护符加成）。</p>`
      + `<p>使用<b>甜甜蜜</b>可让大量出没的下一只出现得更快（<b>${MASS_SPAWN_HONEY_MIN}~${MASS_SPAWN_HONEY_MAX}</b> 秒，普通 <b>${MASS_SPAWN_MIN}~${MASS_SPAWN_MAX}</b> 秒）。事件持续 <b>${MASS_DURATION}</b> 分钟，抓完剩余数量（<b>${MASS_COUNT_MIN}~${MASS_COUNT_MAX}</b> 只）或到期后结束。</p>`
      + `<p><b>时空扭曲</b>：每隔 <b>${TWIST_GEN_MIN}~${TWIST_GEN_MAX}</b> 分钟出现一次，从<b>全地区（排除事件所在地）</b>的宝可梦中随机现身，每次遭遇都不同；<b>超级进化 / 超极巨化</b>这类强化形态<b>不会现身</b>，它们只能靠进化获得。</p>`
      + `<p>时空扭曲的宝可梦<b>按野池等级上限现身</b>（没有等级进化的一律 <b>${WILD_LEVEL_MAX}</b> 级，有等级进化的压在自己的进化等级之下），<b>个体值保底 ${TWIST_GUARANTEED_IVS}V</b>，闪光率 <b>1/${Math.round(1 / TWIST_SHINY_CHANCE)}</b>（不吃闪耀护符加成），有 <b>${Math.round(TWIST_RGB_CHANCE * 100)}%</b> 概率是 <b>RGB 分离</b>宝可梦、<b>${Math.round(TWIST_POLLUTED_CHANCE * 100)}%</b> 概率是<b>污染宝可梦</b>。</p>`
      + `<p>当这两类带有特效的宝可梦被<b>派遣</b>探险时，带回的糖果数量提升 <b>${Math.round(DISPATCH_VARIANT_CANDY_BONUS * 100)}%</b>（详见「<b>派遣</b>」章节）。</p>`
      + `<p>事件持续 <b>${TWIST_DURATION}</b> 分钟，抓完剩余数量（<b>${TWIST_COUNT_MIN}</b> 只）或到期后结束。</p>`,
  },
  {
    title: '悬赏',
    html: `<p>每个地区每天<b>0</b> 点刷新<b>${BOUNTY_PER_REGION}</b> 条<b>地区悬赏</b>：指定宝可梦来自全国图鉴（可能不在该地区出没）。</p>`
      + `<p>今日到访过的地区才能看到悬赏内容；仓库中拥有指定宝可梦即可提交，但提交必须到达对应地区。</p>`
      + `<p>奖励按目标的<b>获取成本</b>分三档：容易的给<b>糖果</b>（<b>${BOUNTY_CANDY_MIN}~${BOUNTY_CANDY_MAX}</b> 颗），难一些给 <b>1 件进化道具</b>，再难就改成 <b>1 件稀有道具</b>（含形态专属道具、薄荷）或 <b>${BOUNTY_COMMON_QTY_MIN}~${BOUNTY_COMMON_QTY_MAX} 件</b>常见道具。</p>`
      + `<p>纸飞机图标可将该地区设为<b>导航</b>目的地：自动规划路线。</p>`
      + `<p>右键点击提交按钮可选择将该悬赏忽略（随时可恢复）。</p>`
  },
  {
    title: '交换',
    html: `<p>在<b>手机</b>页面打开<b>交换</b>应用，NPC 挂出想要的宝可梦与愿意给的宝可梦，有 <b>1/${Math.round(1 / TRADE_SHINY_CHANCE)}</b> 的概率给出闪光宝可梦。</p>`
      + `<p>NPC 有 <b>${TRADE_LEVEL_CHANCE * 100}</b>% 的概率指定想要的宝可梦<b>等级下限</b>（<b>${TRADE_WANT_LEVEL_MIN}~${TRADE_WANT_LEVEL_MAX}</b> 级）：个体必须达到等级要求才能提交。孵化攒下的 1 级宝可梦可用<b>经验糖果</b>快速拉到等级线（详见「<b>经验糖果</b>」章节）。</p>`
      + `<p>仓库中有符合要求的个体即可与之互换，收到的宝可梦来源记为「<b>交换</b>」；每 <b>${TRADE_REFRESH_MS / 60000}</b> 分钟刷新一波。</p>`
      + `<p>跟随<b>毒 / 超能</b>属性随从（增益「<b>交换闪光概率提升</b>」）时，会<b>强制刷新一波交易</b>，让新加成立即生效。</p>`
      + `<p>右键可交换的条目可「<b>忽略</b>」：忽略后随时可右键恢复，仍可正常交换。</p>`,
  },
  {
    title: '场景',
    html: `<p>挂机时场景会自动轮换：每段场景的长度随机生成，结束后切换到下一个随机场景。</p>`
      + `<p>生成下一个场景时，有 <b>${Math.round(ROAD_SPECIAL_CHANCE * 100)}</b>% 的概率是<b>特殊场景</b>（可钓鱼的水域或自行车道，各占一半概率），其余 <b>${Math.round((1 - ROAD_SPECIAL_CHANCE) * 100)}</b>% 为普通场景。</p>`
      + `<p>水域场景有<b>垂钓点</b>（详见「<b>钓鱼</b>」章节）；<b>自行车道</b>自动进入骑行，骑行结束后背包获得 <b>自行车 ×1</b>（详见「<b>自行车</b>」章节）。</p>`,
  },
  {
    title: '自行车',
    html: `<p><b>自行车</b>是赶路道具：骑行速度 <b>${ROAD_SPEED_BIKE / ROAD_SPEED_WALK}×</b> 走路，期间<b>不遇敌、不钓鱼、不拾取道具</b>，适合快速跨地区赶路。</p>`
      + `<p><b>获取</b>：随机<b>自行车道</b>骑行结束后背包 <b>+1</b>（详见「<b>场景</b>」章节），也可在<b>商店</b>用糖果兑换（<b>${CANDY_EXCHANGE['bike']}</b> 颗）。</p>`
      + `<p><b>使用</b>：背包<b>滚轮翻到第二页</b>，点击<b>自行车</b>停止当前导航并进入<b>导航页</b>；<b>选好骑行目的地才消耗 1 个</b>上车骑行。骑行中背包再点可<b>手动下车</b>（不结束导航）。</p>`
      + `<p><b>放弃骑行</b>：未选目的地时再点背包「自行车」，或在导航页点「<b>退出</b>」结束导航。</p>`
      + `<p><b>自动下车</b>：骑行到<b>导航目的地</b>自动下车（中途经过的地区节点<b>不停车</b>，连续骑行）；<b>手动结束导航</b>也会直接下车；抵达<b>大量出没 / 时空扭曲</b>事件点自动下车（骑行中不遇敌，下车后才能进战斗）。</p>`
      + `<p><b>骑行中</b>不能改选目的地，只能等到达自动下车、手动下车或退出导航。</p>`
  },
  {
    title: '捕捉',
    html: `<p>丢出精灵球进行捕捉，不同球种捕获率：</p>`
      + tutorialTable([
        ['精灵球', `<b>${CATCH_RATES['poke-ball'] * 100}</b>%`],
        ['高级球', `<b>${CATCH_RATES['ultra-ball'] * 100}</b>%`],
        ['大师球', `<b>${CATCH_RATES['master-ball'] * 100}</b>%`],
      ], ['球种', '捕获率'], [48, 'auto'])
      + `<p>捕获率 = 球种基础率 × 宝可梦捕获率 × 丢球加成。高级球还额外附加 <b>${(ULTRA_BALL_ADD * 100)}%</b> 绝对捕获率，对捕获率低的<b>稀有/神兽</b>增幅更明显，抓神兽建议用高级球。</p>`
      + `<p>每一次捕捉失败后宝可梦都有几率<b>挣脱逃跑</b>（首球 <b>${FLEE_CHANCE * 100}</b>%，每多丢一球 <b>+${FLEE_CHANCE_INC * 100}</b>%，上限 <b>${FLEE_CHANCE_MAX * 100}</b>%）。</p>`
      + `<p>当逃跑率达到上限后，每多丢一球捕获率 <b>+${Math.round(CATCH_BONUS_INC * 100)}</b>%，无上限。</p>`
      + `<p>也可主动点击"逃跑"按钮逃离宝可梦。</p>`,
  },
  {
    title: '闪光',
    html: `<p><b>闪光宝可梦</b>是稀有变种（配色不同），默认出现概率 <b>1/${Math.round(1 / SHINY_CHANCE)}</b>。</p>`
      + `<p>捕获后图鉴有特殊标记，并计入闪光统计。</p>`
      + `<p>使用<b>闪耀护符</b>可大幅提升遇闪概率（详见「<b>增益</b>」章节）。</p>`,
  },
  {
    title: '糖果',
    html: `<p><b>糖果</b>是本游戏的唯一货币，通过挂机掉落、钓鱼、完成委托、完成悬赏、对战、成就、派遣、出售道具等获得，能在手机里虚拟存储，用于解锁<b>孵蛋器</b>槽位、<b>农场</b>购买种子、解锁<b>派遣</b>格子，也可在<b>商店</b>兑换道具（详见「<b>商店</b>」章节）。</p>`
      + `<p>注意区分道具<b>经验糖果</b>：它不是货币，而是给宝可梦直接加经验的消耗品，主要从 NPC 对战掉落、悬赏中档发放与放生返还的经验池产出（详见「<b>经验糖果</b>」章节）。</p>`
  },
  {
    title: '商店',
    html: `<p>在标题栏点商店按钮（或点主界面的糖果数量）进入<b>商店</b>，消耗<b>糖果</b>兑换基础道具。</p>`
      + `<p>点击「兑换」买 1 个，<b>右键</b>可批量购买。</p>`
      + `<p>进入「出售」模式后：道具按<b>基础价的 40%</b> 回收成糖果（<b>大师球 / 闪耀护符 / 经验糖果</b>是固定回收价，不按 40%）；点击卖 1 个，<b>右键</b>可批量出售。</p>`
      + `<p>兑换价格（糖果）：</p>`
      + tutorialTable(Object.entries(CANDY_EXCHANGE).map(([item, cost]) => [ITEM_NAMES[item], `<b>${cost}</b> 糖果`]), ['道具', '价格'], [52, 'auto'])
      + `<p><b>今日招式机</b>：每天上架 <b>${TM_SHOP_DAILY}</b> 个还没有解锁的招式，价格按威力 <b>${TM_PRICE_TIERS[0].price}~${TM_PRICE_TIERS[TM_PRICE_TIERS.length - 1].price}</b> 糖果。</p>`
      + `<p>招式机<b>解锁后永久有效</b>：仓库里能学会这招的宝可梦会直接学会（满 4 招的保留你自己配的，可以在配招页替换）。蛋招式不在这里卖——只有<b>孵蛋</b>得到的宝可梦能学，详见「<b>孵蛋</b>」章节。</p>`
      + `<p><b>今日道具</b>：进化道具与薄荷每天换一批，每件限买 1 个。</p>`
  },
  {
    title: '增益',
    html: `<p><b>甜甜蜜</b>与<b>闪耀护符</b>都是 <b>${BUFF_DURATION}</b> 秒增益，使用后主角进入跑步姿态，跑图速度提升。</p>`
      + `<p><b>闪耀护符</b>额外带保底：<b>使用后的下一只遭遇必定闪光</b>，之后这段时间内继续按提升后的概率判定。</p>`
      + `<p>骑行中速度以 <b>${ROAD_SPEED_BIKE / ROAD_SPEED_WALK}×</b> 优先，增益的跑步提速不生效（详见「<b>自行车</b>」章节）。</p>`
      + `<p>期间遇敌间隔从普通 <b>${Math.round(ENCOUNTER_MIN / 60)}~${Math.round(ENCOUNTER_MAX / 60)}</b> 分钟缩短到 <b>${BUFF_ENCOUNTER_MIN}~${BUFF_ENCOUNTER_MAX}</b> 秒。</p>`
      + `<p>倒计时仅在挂机等待时消耗，遇敌/钓鱼期间暂停。</p>`
      + tutorialTable([
        ['生效', `<b>${BUFF_DURATION}</b> 秒`, `<b>${BUFF_DURATION}</b> 秒`],
        ['遇敌', `<b>${BUFF_ENCOUNTER_MIN}~${BUFF_ENCOUNTER_MAX}</b> 秒`, `<b>${BUFF_ENCOUNTER_MIN}~${BUFF_ENCOUNTER_MAX}</b> 秒`],
        ['稀有', `极稀有出现权重 ×<b>${rarityWeightBoost(HONEY_RARITY_BOOST)}</b>`, `极稀有出现权重 ×<b>${rarityWeightBoost(CHARM_RARITY_BOOST)}</b>`],
        ['闪光', '无加成', `<b>${Math.round(CHARM_SHINY_CHANCE * 100)}</b>% 闪光、<b>${Math.round(CHARM_UNCAUGHT_CHANCE * 100)}</b>% 未收录宝可梦，其余走普通遇敌`],
        ['钓鱼', `钓到宝可梦概率提升至 <b>${Math.round(FISH_BUFF_POKEMON_CHANCE * 100)}</b>%`, `钓到宝可梦概率提升至 <b>${Math.round(FISH_BUFF_POKEMON_CHANCE * 100)}</b>%，闪光率 <b>${Math.round(CHARM_SHINY_CHANCE * 100)}</b>%`],
      ], ['特性', '甜甜蜜', '闪耀护符'], [32, '40%', 'auto']),
  },
  {
    title: '孵蛋',
    html: `<p>在<b>手机</b>主页打开<b>孵蛋器</b>应用，将背包里的<b>神秘蛋</b>或繁殖得到的<b>宝可梦蛋</b>放入空闲槽位开始<b>孵化</b>。</p>`
      + `<p>孵蛋得到的宝可梦还能学会本物种的<b>蛋招式</b>（野外抓到的同类学不了），另有独立的个体值、性格与闪光判定。</p>`
      + `<p>孵化里程由宝可梦的体重和稀有度决定（<b>${HATCH_DIST_MIN / 1000}~${HATCH_DIST_MAX / 1000}</b> 公里）。</p>`
      + `<p>主角行走累计到所需里程即孵化完成——停下不走不推进，跑步/骑车走得更快。</p>`
      + `<p>不同移动方式的推进速度（走完 <b>1 公里</b>所需时间）：</p>`
      + tutorialTable([
        ['走路（挂机默认）', `<b>${Math.round((1000 * PX_PER_METER) / (ROAD_SPEED_WALK * 60) / 60 * 10) / 10}</b> 分钟`],
        ['跑步（增益生效）', `<b>${Math.round((1000 * PX_PER_METER) / (ROAD_SPEED_RUN * 60) / 60 * 10) / 10}</b> 分钟`],
        ['骑行', `<b>${Math.round((1000 * PX_PER_METER) / (ROAD_SPEED_BIKE * 60) / 60 * 10) / 10}</b> 分钟`],
      ], ['移动方式', '1 公里耗时'], [92, 'auto'])
      + `<p>孵化完成后点击孵化按钮即可获得宝可梦，结果完全随机，有 <b>1/${Math.round(1 / SHINY_CHANCE)}</b> 概率出闪光。</p>`,
  },
  {
    title: '培育',
    html: `<p>在<b>手机</b>主页打开<b>饲育屋</b>：点<b>告示牌</b>放入两只宝可梦配对。普通配对要求<b>一雄一雌</b>且<b>至少共有一个蛋组</b>——只有<b>同蛋组</b>的宝可梦才能一起孵蛋。</p>`
      + `<p><b>百变怪</b>可无视性别，与<b>任意非「未发现蛋组」</b>的宝可梦繁殖（后代按那一族的最低阶算）；但神兽幻兽等<b>「未发现蛋组」</b>的宝可梦<b>不能</b>与百变怪配对。</p>`
      + `<p>投喂它们爱吃的<b>树果</b>开始繁殖：先选择<b>连续繁殖轮数</b>（<b>1~10 轮</b>），树果按轮数 <b>×N</b> 一次性扣除；每轮 <b>5~10 分钟</b>产一枚蛋并<b>自动入库</b>、自动续下一轮，无需手动收蛋；一批完成后直接恢复轮数选择界面，可立即开始下一批。</p>`
      + `<p>繁殖期间取出亲本会<b>终止剩余轮次</b>（树果不退，已产蛋不丢）；产出的<b>宝可梦蛋</b>放入<b>孵蛋器</b>里孵化（详见「<b>孵蛋</b>」章节）。</p>`
      + `<p><b>个体值遗传</b>：<b>1 项</b>完全随机，<b>5 项</b>继承自双亲（默认 50% 随机取父或母）。可从这 5 项中<b>锁定一项</b>，指定该维固定继承父方或母方的数值。</p>`
      + `<p><b>如何培育 6V</b>：优先找两只高个体亲本繁殖，用后代中更优秀的替换亲本，反复迭代拉高双亲基础。遗传的 5 项中，双亲都到 31 的项必然还是 31（从双亲二选一，任意一方都是 31）；但唯一纯随机项完全随机（0~31），有 1/6 概率正好落在某一维——所以最终要赌的还是这 <b>1 个随机项</b>（出 31 的概率 1/32）。锁定功能可在关键维缺一只亲本时帮补短板。</p>`
      + `<p>「<b>纸箱</b>」里可以查看仓库中所有宝可梦蛋。</p>`
      + `<p>有的族要开「<b>熏香</b>」开关才产得出最低阶的幼体，不开就产中间阶。</p>`
  },
  {
    title: '钓鱼',
    html: `<p>经过有<b>垂钓点</b>的水域场景（如石桥）时会停下<b>钓鱼</b>。每段场景只钓一次：进入场景 <b>${FISH_TRIGGER_MIN}~${FISH_TRIGGER_MAX}</b> 秒后开始，等待上钩（<b>${FISH_WAIT_MIN}~${FISH_WAIT_MAX}</b> 秒）后收获随机道具 <b>${FISH_QTY_MIN}~${FISH_QTY_MAX}</b> 个。</p>`
      + `<p>钓到宝可梦的概率：</p>`
      + tutorialTable([
        ['无增益时', `<b>${Math.round(FISH_POKEMON_CHANCE * 100)}</b>%`],
        ['增益期间', `<b>${Math.round(FISH_BUFF_POKEMON_CHANCE * 100)}</b>%`],
      ], ['情况', '概率'], [80, 'auto'])
      + `<p>钓到宝可梦的种类（都只从本地野池里出，神兽与只能靠进化的最终形态钓不到）：</p>`
      + tutorialTable([
        ['当地稀有宝可梦', `<b>${Math.round(FISH_RARE_RATE * 100)}</b>%`],
        ['当地水系宝可梦', `<b>${Math.round((1 - FISH_RARE_RATE) * 100)}</b>%`],
      ], ['种类', '占比'], [80, 'auto'])
      + `<p>钓到道具时的种类概率（按掉率权重占比）：</p>`
      + tutorialTable(FISH_ITEM_ROWS, ['道具', '概率'], [52, 'auto'])
      + `<p>此外有 <b>${Math.round(FISH_EVO_CHANCE * 100)}</b>% 的概率改钓到 <b>1 件进化道具</b>（含形态专属道具、薄荷）。</p>`
      + `<p>增益加成：护符期间钓到的宝可梦更容易<b>闪光</b>；等待上钩时间不计入增益时长。</p>`,
  },
  {
    title: '树果',
    html: `<p><b>树果</b>是<b>农场</b>收获的作物，也是<b>树果混合器</b>的唯一原料，更是宝可梦爱吃的食物。</p>`
      + `<p>获取：种下种子、浇水养护，成熟后收获（详见「<b>农场</b>」章节）。</p>`
      + `<p>用途：作为配方制成<b>树果方块</b>（详见「<b>树果方块</b>」章节），喂食训练中的宝可梦（详见「<b>训练</b>」章节），在树果委托出售换糖果（详见「<b>农场</b>」章节），作为宝可梦繁殖的消耗品（详见「<b>培育</b>」章节）。</p>`,
  },
  {
    title: '农场',
    html: `<p>在<b>手机</b>主页打开<b>农场</b>，点击空地种下树果种子（消耗 <b>${FARM_PLANT_COST}</b> 糖果）。</p>`
      + `<p>刚种下<b>湿度</b>为 <b>0</b>，点击<b>浇水</b>才会生长；湿度随时间下降（每 <b>${Math.round(1 / FARM_WATER_DROP)}</b> 秒降 <b>1</b> 点，满湿度可撑 <b>${Math.round(FARM_MAX_WATER / FARM_WATER_DROP / 60)}</b> 分钟），归 <b>0</b> 停止生长，需及时补浇。</p>`
      + `<p>历经刚种下→发芽→成长→开花结果后成熟（每棵 <b>${Math.round(FARM_MATURE_MIN / 60000)}~${Math.round(FARM_MATURE_MAX / 60000)}</b> 分钟随机），点击收获得 <b>${FARM_HARVEST_MIN}~${FARM_HARVEST_MAX}</b> 颗树果。</p>`
      + `<p>右键生长的植物可<b>铲除</b>，回收地块重新种植。</p>`
      + `<p>收获的树果存入库存；库存的树果不能当种子，种地只能另买新种子。</p>`
      + `<p>点田地右上角告示牌查看树果委托（每天刷新 <b>${FARM_BOARD_DEMANDS}</b> 条，其中 <b>1</b> 条为大量需求 <b>${FARM_BOARD_BIG_QTY_MIN}~${FARM_BOARD_BIG_QTY_MAX}</b> 颗、<b>1</b> 条为巨量需求 <b>${FARM_BOARD_MEGA_QTY_MIN}~${FARM_BOARD_MEGA_QTY_MAX}</b> 颗，需专门种植较久；需求越多报酬越高）。也可以在此面板招募帮手（详见「<b>招募帮手</b>」章节）。</p>`,
  },  
  {
    title: '宝可梦',
    html: `<p>在<b>手机</b>页面打开<b>宝可梦</b>应用查看宝可梦仓库：每只捕获/孵化的宝可梦都是独立个体。</p>`
      + `<p>每只个体带有随机<b>个体值</b>（HP/攻击/防御/特攻/特防/速度，各 <b>0~31</b>）与随机<b>性格</b>（共 <b>25</b> 种）。</p>`
      + `<p>点进详情可以重命名宝可梦（最多 <b>5</b> 个字），改名后搜索中文可匹配昵称。</p>`
      + `<p>详情页右上角的<b>放生</b>按钮可移除该个体（确定后不可恢复）同时返还（<b>${RELEASE_XP_RATE * 100}%</b>）经验（详见「<b>经验糖果</b>」章节）。</p>`
      + `<p>在仓库<b>列表页右键</b>可<b>批量放生</b>：勾选多只个体统一放生并返还总经验。</p>`
      + `<p>右键也可<b>高级筛选</b>（按名称、属性、等级等条件），方便批量处理。</p>`
      + `<p>个体可用来提交地区悬赏——提交后该宝可梦会从仓库中移除（详见「<b>悬赏</b>」章节）。</p>`,
  },
  {
    title: '配队',
    html: `<p>在<b>手机</b>页面打开<b>配队</b>应用：一共可以保存 <b>6 组</b>队伍，每队最多 <b>${TEAM_MAX}</b> 只。进入后是<b>队伍列表</b>，每张卡片显示成员预览，点名称或笔图标可<b>改名</b>，点卡片进入<b>编辑</b>对应队伍。</p>`
      + `<p><b>设为上场</b>的队伍会用于<b>对战</b>出战与自动配招参考，切换上场队伍无需重新组建阵容。</p>`
      + `<p>编辑队伍时点击<b>空位</b>从仓库选择宝可梦加入；点击<b>已有成员</b>弹出菜单：<b>查看</b>个体详情、<b>替换</b>（从仓库换一只到该位置）、<b>移除</b>（放回仓库）。</p>`
      + `<p><b>拖拽</b>可以对队伍中的宝可梦进行快速排序。<b>右键</b>空白处可<b>自动配队</b>或清空当前队伍。</p>`
      + `<p><b>自动配队</b>：直接挑仓库里（排除训练中）<b>等级最高</b>的 6 只——同一等级有一批时从里面<b>随机入选</b>，入选后的<b>站位顺序也是随机</b>的；队伍<b>未满</b>时<b>保留现有成员</b>，空位用等级最高的补齐。</p>`
      + `<p>入队的宝可梦会从<b>训练</b>、<b>饲育屋</b>中自动撤下，训练/配对中的宝可梦也不能留在任何队伍里（三者<b>互斥</b>）。</p>`,
  },
  {
    title: '训练',
    html: `<p>在<b>手机</b>页面打开<b>训练</b>应用即可进入训练场。</p>`
      + `<p>点场地上的<b>告示牌</b>打开管理面板：共 <b>${TRAIN_SLOTS}</b> 个槽位，点空位去仓库放入一只、再点已有取出。</p>`
      + `<p>挂机自动获得经验 <b>${TRAIN_XP_PER_MIN}</b>/分钟，不消耗糖果；</p>`
      + `<p>训练会消耗<b>饱食度</b>（上限 <b>${TRAIN_SATIETY_MAX}</b>、每分钟降 <b>${TRAIN_SATIETY_DRAIN_PER_MIN}</b>）：降到 <b>${TRAIN_SATIETY_EAT_AT}</b> 时自动吃库存里它爱吃的树果补充 <b>${TRAIN_SATIETY_PER_BERRY}</b> 点，正好回满（<b>图鉴</b>可查爱吃的食物），没存货就会饿到<b>饱食度归零并一直偷懒</b>。</p>`
      + `<p>训练中偶尔会<b>偷懒</b>（约 <b>${Math.round(TRAIN_LAZY.chancePerMin * 100)}</b>%/分钟，暂停 <b>${TRAIN_LAZY.durationMin / 1000 / 60}~${TRAIN_LAZY.durationMax / 1000 / 60}</b> 分钟）；饱食度越低越容易偷懒，饱食度<b>归零</b>时会一直偷懒，直到吃上树果才恢复。</p>`
      + `<p>偷懒的宝可梦会睡觉，点击即可叫醒；</p>`,
  },
  {
    title: '对战',
    html: `<p>在<b>手机</b>页面打开<b>对战</b>应用，向路过的训练家发起挑战（NPC 队伍分<b>普通 / 精英 / 馆主 / 冠军</b>四档，每 <b>${BATTLE_REFRESH_MS / 60000}</b> 分钟刷新一波）。</p>`
      + `<p>各档<b>等级区间固定</b>、<b>不随你的队伍变化</b>（普通 <b>Lv${BATTLE_TIER_BAND.novice[0]}~${BATTLE_TIER_BAND.novice[1]}</b>、精英 <b>Lv${BATTLE_TIER_BAND.veteran[0]}~${BATTLE_TIER_BAND.veteran[1]}</b>、馆主 <b>Lv${BATTLE_TIER_BAND.leader[0]}~${BATTLE_TIER_BAND.leader[1]}</b>、冠军 <b>Lv${BATTLE_TIER_BAND.champion[0]}~${BATTLE_TIER_BAND.champion[1]}</b>）：<b>练度决定你打得过哪一档</b>，练强了不会再被对手追平。</p>`
      + `<p>所以开局抓来的宝可梦打不过普通档很正常——先在<b>训练场</b>养到十几级再回来（训练每分钟 <b>${TRAIN_XP_PER_MIN}</b> 经验）。</p>`
      + `<p>战胜后经验只分给<b>上过场且存活</b>的宝可梦，并按<b>等级差</b>结算：打高等级最多 <b>3 倍</b>、打低等级最低 <b>0.2 倍</b>，回头刷低档几乎没经验，该往上打。</p>`
      + `<p>各档胜利都会额外给<b>消耗品</b>（精灵球 → 高级球 / 甜甜蜜 / 神秘蛋，档位越高越好），并且都有概率掉 <b>1 件进化道具</b>或 <b>1 颗薄荷</b>——档位越高概率越大、道具越贵，<b>专属道具只有冠军档掉</b>。</p>`
      + `<p>战胜后还有概率掉落<b>经验糖果</b>：普通 <b>${EXP_CANDY_DROP.novice * 100}</b>%、精英 <b>${EXP_CANDY_DROP.veteran * 100}</b>%、馆主 <b>${EXP_CANDY_DROP.leader * 100}</b>%、冠军 <b>${EXP_CANDY_DROP.champion * 100}</b>%（详见「<b>经验糖果</b>」章节）。</p>`
      + `<p>挑战失败可<b>再战一次</b>，随时都能重复挑战。</p>`
      + `<p>右键点击底部文字区域可查看实时<b>对战记录</b>。</p>`
      + `<p><b>伤害计算</b>（NPC 对战）：</p>`
      + `<p>伤害 = ⌊( 2×等级÷5 + 2 ) × 招式威力 × 攻击 ÷ 防御 ÷ 50 + 2 ⌋ × 本系 × 克制 × 随机(0.85~1.00)</p>`
      + `<p><b>本系</b>：招式属性与自身属性相同 ×1.5，否则 ×1；<b>克制</b>按标准属性克制表（效果绝佳 ×2、收效甚微 ×0.5、无效 ×0，双属性连乘）；<b>攻击/防御</b>按招式类别取物攻/物防或特攻/特防，为受等级、个体值、性格影响的面板能力值。</p>`
      + `<p>实际伤害最终保底 <b>1</b> 点。</p>`,
  },
  {
    title: '经验糖果',
    html: `<p>给宝可梦直接增加经验的消耗道具。获取方式：</p>`
      + `<p>① 战胜<b>NPC 训练家</b>概率掉落（普通 <b>${EXP_CANDY_DROP.novice * 100}</b>%、精英 <b>${EXP_CANDY_DROP.veteran * 100}</b>%、馆主 <b>${EXP_CANDY_DROP.leader * 100}</b>%、冠军 <b>${EXP_CANDY_DROP.champion * 100}</b>%）。</p>`
      + `<p>② <b>悬赏</b>中档（"1 件常见道具"）里会随机给到。</p>`
      + `<p>③ 放生宝可梦返还 <b>${RELEASE_XP_RATE * 100}%</b> 的累计经验，存入「经验池」，攒满 <b>${EXP_CANDY_XP}</b> 经验自动产出 <b>1</b> 颗经验糖果并清零。</p>`
      + `<p>背包第二页点击使用：选择宝可梦后调整数量（单颗 <b>${EXP_CANDY_XP}</b> 经验），确认后一次性结算。</p>`
      + `<p>满级宝可梦无法使用。</p>`,
  },
  {
    title: '薄荷',
    html: `<p>薄荷可以把宝可梦的<b>性格</b>改成对应性格。</p>`
      + `<p>在<b>宝可梦详情页</b>点<b>性格</b>，选一颗薄荷吃掉就改好了——只有从宝可梦列表点进详情才能改。</p>`
      + `<p>薄荷和<b>进化道具</b>走同一批渠道（详见「<b>道具</b>」章节）。</p>`,
  },
  {
    title: '招式',
    html: `<p>每只宝可梦最多携带 <b>4</b> 招；招式有<b>属性</b>、<b>类别</b>（物理 / 特殊 / 变化）、<b>威力</b>、<b>命中</b>和 <b>PP</b>，伤害按属性克制与本系加成结算（详见「<b>对战</b>」章节）。</p>`
      + `<p>招式有四种来源：<b>等级招式</b>（等级到了就能配）、<b>招式机</b>、<b>蛋招式</b>（只有孵蛋得到的宝可梦能学）、<b>继承</b>（进化时从前形态带过来的，详见「<b>进化</b>」章节）。</p>`
      + `<p>来源只决定能不能配：<b>招式机</b>要先在商店解锁，未解锁的配不了（详见「<b>商店</b>」章节）。少数原作招式暂未实装，不会出现在候选里。</p>`,
  },
  {
    title: '配招',
    html: `<p>在<b>宝可梦</b>仓库的个体详情页配置招式（最多 <b>4</b> 个）：<b>自动</b>按等级搭配；<b>手动</b>进入独立的配招页自由调整。</p>`
      + `<p>点招式可以查看详细解释，把招式拖进槽位即可装备；<b>右键点击</b>招式列表可以排序。</p>`
  },
  {
    title: '进化',
    html: `<p>在<b>宝可梦详情页</b>（从宝可梦仓库点进去）能看到这只的<b>进化链</b>：符合条件的点击按钮即可进化；图鉴里还没见过的形态显示 <b>？？？</b>（遇到过就显示名字，不用先抓到）。</p>`
      + `<p>条件有等级、道具、招式、地区、性别几种（<b>招式看当前携带的 4 招</b>），<b>双道具要两件都够</b>；<b>超级进化 / 超极巨化</b>也在这里，消耗对应的专属道具。</p>`
      + `<p>有的分支形态由<b>性格</b>或<b>性别</b>决定（比如毒电婴、妙喵）：这种不让你挑，进化链里只显示这只对应的那一条——性格不合可以改（见「<b>薄荷</b>」章节），性别改不了。</p>`
      + `<p>进化来的宝可梦计进图鉴（不算捕获数）；进化道具在<b>道具盒</b>里能查看，获取渠道统一列在「<b>道具</b>」章节。</p>`,
  },
  {
    title: '混合器',
    html: `<p>在<b>手机</b>主页打开<b>混合器</b>，从农场库存选 <b>1~3</b> 颗树果作为<b>配方</b>，确认后消耗它们制成<b>树果方块</b>（详见「<b>树果方块</b>」章节）。</p>`
      + `<p>开始混合：确认后进入<b>转盘 QTE</b>——内指针旋转，内圈顶部有一段色带（中间完美、两侧良好），在内指针扫过色带中央的瞬间按下按钮，共 <b>5</b> 轮、速度渐快；按五轮总分评定方块品质（${Object.values(BLOCK_QUALITY).map(q => q.label).join(' / ')}）。</p>`,
  },
  {
    title: '树果方块',
    html: `<p><b>树果方块</b>是<b>混合器</b>的产物：用配方树果制成，用于吸引特定的宝可梦。</p>`
      + `<p><b>品质</b>决定效果：品质越高，遇敌时直接遇到目标宝可梦的概率越高（${Object.values(BLOCK_QUALITY).map(q => `${q.label} <b>${Math.round(q.chance * 100)}</b>%`).join(' / ')}）。</p>`
      + `<p>按行走里程计时：主角再走 <b>${BLOCK_DISTANCE}</b> 米没被吃掉则风干失效（停下不走不消耗），期间不改变正常遇敌节奏。</p>`
      + `<p>配方在当前地区野外没有宝可梦爱吃则无效；方块只对<b>已经拥有</b>的宝可梦有效，可以在图鉴查看它爱吃的配方；<b>神兽与幻兽</b>不会被方块吸引。</p>`
      + `<p>注意：方块命中目标的那次遇敌，闪光按默认 <b>1/${Math.round(1 / SHINY_CHANCE)}</b> 判定，不享受闪耀护符加成，也不计入闪耀护符的遭遇计数。</p>`,
  },
  {
    title: '招募帮手',
    html: `<p>点田地右上角<b>告示牌</b>可在弹出的面板中花费糖果招募<b>帮手</b>，可设置连续工作时间段（每阶段 <b>${FARM_HELPER_WORK_STAGE}</b> 分钟），价格按阶段累进。</p>`
      + `<p>帮手自动劳作：每次从<b>随机地块</b>起点扫描——优先收获成熟树果、给干涸树果浇水、在空地播种（「自动种植」开启后自动扣种子钱）；播种的树果<b>种类随机</b>。</p>`
      + `<p>帮手每工作 <b>${FARM_HELPER_WORK_STAGE}</b> 分钟休息 <b>${FARM_HELPER_REST}</b> 分钟再继续；</p>`,
  },
  {
    title: '游戏厅',
    html: `<p>在<b>手机</b>第二页打开<b>游戏厅</b>应用。点击前台区域可以用<b>糖果</b>兑换<b>游戏币</b>（<b>${COIN_RATE} 糖果 = 1 游戏币</b>），柜台处选择兑换档位即可。</p>`
      + `<p>游戏厅目前提供：<b>21点</b>（详见「<b>21点</b>」章节）、<b>口袋麻将</b>（详见「<b>口袋麻将</b>」章节），<b>抽卡机</b>（详见「<b>抽卡机</b>」章节）。</p>`,
  },
  {
    title: '21点',
    html: `<p>在<b>手机</b>第二页打开<b>游戏厅</b>应用，点击赌桌进入<b>21点</b>。</p>`
      + `<p><b>规则</b>：与庄家比点数更接近 <b>21</b> 且不爆牌；A 可算 <b>1 或 11</b>、J/Q/K 计 <b>10</b>。可<b>要牌</b>补一张、<b>停牌</b>交给庄家、<b>加倍</b>再押一份只补 1 张。</p>`
      + `<p>庄家不足 <b>${DEALER_STAND}</b> 必须继续要牌。<b>黑杰克</b>（前两张即 21）按 <b>${BJ_MULT} 倍</b>赔付；双方黑杰克平局返还，庄家黑杰克压制普通 21。</p>`,
  },
  {
    title: '口袋麻将',
    html: `<p>在<b>手机</b>第二页打开<b>游戏厅</b>应用，点击<b>口袋麻将</b>进入。</p>`
      + `<p><b>基础规则</b>：凑齐<b>三组相同宝可梦的刻子</b>（每组 3 张同种牌）即可胡牌。每局 <b>${HAND_SIZE}</b> 张手牌起手，轮流<b>摸 1 打 1</b>，凑满 9 张胡牌。</p>`
      + `<p><b>碰</b>：他家打出与你手牌 2 张相同的牌时可碰成副露。<b>荣和</b>：他家弃牌直接凑齐你的最后一组刻子。<b>自摸</b>：自己摸牌成胡。</p>`
      + `<p><b>立直</b>：门清（无副露）听牌时可支付 ${RIICHI_COST} 游戏币宣言立直，立直后只能打刚摸的牌；若立直后<b>自摸或荣和</b>，立直棒 ${RIICHI_COST} 游戏币<b>随胡牌一并退还</b>。</p>`
      + `<p>赢家按番数计算倍率（底倍 ×2 + 番数），番型举例：</p>`
      + tutorialTable([
          ['立直 / 自摸 / 一发 / 门清 / 海底', '各 +1', '流程役'],
          ['三色同刻', '+1', '三组不同属性'],
          ['潜力三刻 / 王牌三刻', '+2', '三组全 5 分 / 全 10 分'],
          ['清一色', '+4', '三组同属性'],
          ['天和 / 全同种 / 幻神组合 / 神兽一色', '×10', '役满（封顶不叠加）'],
        ], ['役种', '番数', '说明'], ['auto', 46, 'auto']),
  },
  {
    title: '抽卡机',
    html: `<p>在<b>游戏厅</b>场景点击<b>抽卡机</b>进入。</p>`
      + `<p>消耗<b>游戏币</b>抽卡，<b>${GACHA_DRAW_COST} 币单抽、${GACHA_DRAW_COST * 10} 币十连</b>。抽到重复卡片退还 <b>${GACHA_DUP_REFUND} 币</b>。卡片共分三个品级，概率如下：</p>`
      + tutorialTable([
          ['N（普通）', '60%'],
          ['R（稀有）', '32%'],
          ['SR（超稀有）', '8%'],
        ], ['品级', '概率'], ['auto', 'auto'])
      + `<p>已收集的卡片可在<b>卡册</b>应用中查看，点击缩略图可放大预览。</p>`,
  },
  {
    title: '随从',
    html: `<p>在<b>手机</b>第二页打开<b>随从</b>应用：消耗 <b>${FOLLOWER_DRAW_COST} 颗糖果</b>抽一只宝可梦当随从，跟随期间获得限时增益，<b>同时只能跟随 1 只</b>。</p>`
      + `<p>稀有度概率：N <b>${Math.round(FOLLOWER_TIER_CHANCE.N * 100)}%</b> / R <b>${Math.round(FOLLOWER_TIER_CHANCE.R * 100)}%</b> / SR <b>${Math.round(FOLLOWER_TIER_CHANCE.SR * 100)}%</b> / UR <b>${Math.round(FOLLOWER_TIER_CHANCE.UR * 100)}%</b>；跟随时长：N <b>${FOLLOWER_TIER_DUR.N}</b> 分 / R <b>${FOLLOWER_TIER_DUR.R}</b> 分 / SR <b>${FOLLOWER_TIER_DUR.SR}</b> 分 / UR <b>${FOLLOWER_TIER_DUR.UR}</b> 分。</p>`
      + `<p>随从按<b>属性</b>归入 <b>9</b> 大类，每类对应一种增益（按稀有度 <b>${Math.round(FOLLOWER_TIER_BOOST.N * 100)}% ~ ${Math.round(FOLLOWER_TIER_BOOST.UR * 100)}%</b> 递增），双属性跨类时两类增益<b>同时生效</b>：</p>`
      + tutorialTable([
          ['飞行、妖精', '自行车道路段概率提升'],
          ['水', '钓鱼路段概率提升'],
          ['草、虫', '树果成熟速度提升'],
          ['地面、岩石、钢', '挂机道具掉落率提升'],
          ['格斗、恶', '对战胜利经验提升'],
          ['一般、幽灵', '精灵球捕捉率提升'],
          ['电、冰', '宝可梦逃跑率降低'],
          ['龙、火', '孵蛋所需里程降低'],
          ['毒、超能', '交换时NPC闪光概率提升'],
        ], ['属性', '增益'], ['auto', 'auto'])
  },
  {
    title: '派遣',
    html: `<p>在<b>手机</b>第二页打开<b>派遣</b>应用：把仓库里的宝可梦派出去探险，带回<b>糖果</b>与道具。初始 <b>${DISPATCH_FREE_SLOTS}</b> 格，更多格子用<b>糖果</b>解锁。</p>`
      + `<p>选好时长、点<b>出发</b>才开始计时；速度越快的宝可梦完成得越早。糖果按档位结算（已含档位加成，另有 <b>±${Math.round(DISPATCH_CANDY_JITTER * 100)}%</b> 浮动）：</p>`
      + tutorialTable(DISPATCH_DURATIONS.map((h, i) => [`<b>${h}</b> 小时`, `<b>${Math.round(h * DISPATCH_CANDY_PER_HOUR * DISPATCH_DUR_MULT[i])}</b> 颗`, `×<b>${DISPATCH_DUR_MULT[i]}</b>`]), ['时长', '糖果', '档位加成'], [56, 'auto', 'auto'])
      + `<p>道具方面：便宜的掉得多（精灵球一次能有 <b>10</b> 个），贵重的掉得少。</p>`
      + `<p>派出的宝可梦按<b>主属性</b>侧重带回对应道具（双属性只看第一个）：</p>`
      + tutorialTable(Object.entries(Object.entries(DISPATCH_TYPE_BOOST).reduce((acc, [type, boost]) => {
        for (const k of Object.keys(boost)) (acc[k] ||= []).push(type);
        return acc;
      }, {})).map(([k, types]) => [ITEM_NAMES[k] || k, types.join('、')]), ['道具', '属性'], ['auto', 'auto'])
      + `<p>此外每次结算另掷一次<b>进化道具或薄荷</b>：概率随档位上升（<b>1 小时 ${(DISPATCH_EVO_MAX_CHANCE / 24 * 100).toFixed(1)}%</b> → <b>24 小时 ${Math.round(DISPATCH_EVO_MAX_CHANCE * 100)}%</b>），命中随机带回 <b>1</b> 件。</p>`
      + `<p>时空扭曲出没的 <b>RGB</b> / <b>污染</b> 宝可梦派遣时糖果额外 <b>+${Math.round(DISPATCH_VARIANT_CANDY_BONUS * 100)}%</b>（详见「<b>事件</b>」章节）。</p>`
      + `<p>派遣是<b>唯一的离线收益</b>：离线照常计时，完成后领取，宝可梦留在槽位可直接再出发。</p>`,
  },
  {
    title: '自动操作',
    html: `<p>开启后遇敌自动处理：勾选球种即<b>自动捕获</b>（按捕获率智能选球），一个球都不勾则<b>自动逃跑</b>。</p>`
      + `<p><b>自动丢球</b>：判定为「捕捉」后会自动<b>连续丢球直到捕获或逃跑</b>。球种按<b>智能选球</b>——<b>神兽或捕获率低</b>的宝可梦优先 <b>大师球→高级球→精灵球</b>，捕获率高的普通宝可梦优先 <b>精灵球</b> 省资源；只在勾选的球种中挑选，优先球种没库存自动顺延。</p>`
      + `<p><b>捕捉条件</b>：给 <b>普通 / 普通闪 / 神兽 / 神兽闪 / 可悬赏 / 特效</b> 六类各自设置 捕捉 / 暂停 / 逃跑——「逃跑」主角直接逃跑、「暂停」停手留给你手动；还能填<b>捕捉等级</b>范围（范围外的自动逃跑）、勾选<b>仅捕捉未拥有过的</b>（仓库里已有对应形态直接放跑）。<b>特效</b>类对应时空扭曲（RGB/污染）遭遇，优先级最高。</p>`
      + `<p>勾选增益道具到期自动<b>续杯</b>；<b>自动补球</b>：球用光自动用糖果补 1 个（「‹ ›」调优先级）。</p>`,
  },
  {
    title: '佛系模式',
    html: `<p>与<b>自动操作</b>互斥：遇敌不自动丢球，<b>${AUTO_FLEE_TIMEOUT / 1000}</b> 秒没操作就自动逃跑，挂机不卡进度。</p>`,
  },
  {
    title: '系统日志',
    html: `<p>打开<b>日志</b>应用即可查看最近的活动（获得道具、遇敌、捕捉等），最多存储 <b>50</b> 条记录。</p>`
  },
  {
    title: '宝可梦难度',
    html: `<p>不同宝可梦基础<b>捕获难度</b>不同（极低~高）。</p>`
      + `<p>每只宝可梦还有<b>稀有度</b>（常见/一般/稀有/罕见/极稀有），由捕获率和种族值总和共同决定，越稀有的宝可梦出现概率越低。</p>`
      + `<p>在甜甜蜜和闪耀护符期间，稀有精灵的出现概率会大幅提升（详见「<b>增益</b>」章节）。</p>`,
  },
  {
    title: '状态栏图标',
    desktopOnly: true, // Windows 任务栏托盘：浏览器版与手机端没有对应功能
    html: `<p>把窗口<b>最小化</b>后主角依然在挂机冒险。Windows 任务栏右下角（系统托盘）会出现<b>口袋挂机</b>图标。</p>`
      + `<p>点击图标：窗口<b>打开时</b>点一下收起，<b>最小化或收起后</b>再点一下即可弹回前台。</p>`
      + `<p>Windows 默认会把不常用的图标收进「<b>显示隐藏的图标</b>」弹层里：点开它找到口袋挂机图标，<b>按住拖到外面的任务栏</b>即可固定显示，游戏状态一眼可见。</p>`
      + `<p>鼠标<b>悬停</b>在图标上会弹出多行状态提示：地点、主角动作、操作模式、农场、悬赏、交换、可孵化等信息一目了然；</p>`
      + `<p>图标还会动：角色前进、钓鱼、可孵化、遭遇、可浇水时各有对应提示动画；</p>`,
  },
];

// ===== 教程章节奖励 =====
// 每阅读一个章节可领取一次糖果（统一 30 颗，点击 title 右侧按钮直接领取）
// 新存档默认全部可领；老存档无 tutorialRewards 字段时视为全部可领，一次性吃满福利
const TUTORIAL_REWARD = 30;
// 各章节领取后弹出的总结重点（key 为章节 title，领取时展示）——一句话新手建议
const TUTORIAL_SUMMARIES = {
  '序章': '欢迎来到口袋挂机世界！',
  '目标': '我要成为宝可梦大师！',
  '道具': '挂机来获得更多道具吧！',
  '遭遇': '野生宝可梦最高等级是20级。',
  '手机': '手机可以翻页到第二页。',
  '图鉴': '没有遇到过的宝可梦无法被搜索到。',
  '统计': '想知道自己欧不欧，看统计里的欧非评定。',
  '成就': '点击任意一个领取按钮会领取所有成就奖励。',
  '地区': '不同地区的宝可梦都不相同且不重复。',
  '导航': '取消导航可以让主角停在当前所属地区。',
  '事件': '时不时看看导航以免错过离得近的事件点。',
  '悬赏': '到达对应地区后才可以提交宝可梦。',
  '交换': '点击npc旁边的宝可梦图标可以查看其详情。',
  '场景': '场景是随机的和导航系统无关。',
  '自行车': '中途不能改变目的地，取消导航会直接下车。',
  '捕捉': '高级球抓稀有和神兽有一定提升。',
  '闪光': '遭遇闪光时会听到提示音，宝可梦名字后面也有闪光图标。',
  '糖果': '奖励你30个糖果。',
  '商店': '鼠标悬停到商品上可以看简介，右键兑换按钮能批量买。',
  '增益': '闪耀护符有着甜甜蜜同样的增益。',
  '孵蛋': '拥有两种蛋的时候，需要二次点击选择放入蛋的种类。',
  '培育': '只有同蛋组才能繁殖。',
  '钓鱼': '每个可钓鱼场景会自动进行一次钓鱼。',
  '树果': '树果用处很多，多囤树果。',
  '农场': '每日刷新的树果委托可以换到糖果。',
  '宝可梦': '右键列表可以批量放生和高级筛选。',
  '配队': '可以存 6 组队伍，右键空白处能随机配队。',
  '训练': '挂机就长经验，别忘备够爱吃的树果。',
  '对战': 'NPC的等级受到队伍等级的影响。',
  '经验糖果': '经验糖果无法直接购买。',
  '薄荷': '详情页点的性格就能吃薄荷改性格。',
  '招式': '招式机买一次永久解锁，能学的宝可梦直接学会。',
  '配招': '出门前配好 4 招，自动配招不一定是最合适的。',
  '进化': '条件齐了在详情页点一下就能进化。',
  '混合器': '混合好后确认到了对应地区再使用。',
  '树果方块': '方块引诱的宝可梦闪光率为默认值不受增益加成。',
  '招募帮手': '帮手也是会休息的。',
  '游戏厅': '等糖果富余了再来玩吧。',
  '21点': '富贵险中求。',
  '口袋麻将': '玩法借鉴自原子碰将，只有对对胡。',
  '抽卡机': '单纯收集卡牌，无特殊作用。',
  '随从': '不知道干什么的时候可以抽一只随从。',
  '派遣': '离线也计入派遣时长。',
  '自动操作': '好好设置一下，解放双手必备。',
  '佛系模式': '慢节奏玩家可以开启。',
  '系统日志': '开启自动操作后可以经常看看。',
  '宝可梦难度': '稀有度越高越稀有。',
  '状态栏图标': '点击可以隐藏任务栏图标。',
};
function tutorialRewards() {
  return (gameData.tutorialRewards ||= { claimed: [] });
}
// 是否还有未领取的教程章节（手机"教程"app 图标与标题栏聚合红点共用）
// 教程章节的平台适配：桌面专属章节整章不展示；
// 触屏设备没有右键/滚轮/悬停，正文与总结按设备替换措辞——只维护这一套内容
function tutorialSectionVisible(i) {
  const sec = TUTORIAL_SECTIONS[i];
  if (!sec || !sec.desktopOnly) return true;
  return !document.body.classList.contains('browser-mode');
}
const TUTORIAL_TOUCH_TEXT = [
  [/右键/g, '长按'],
  [/滚动滚轮或点击底部圆点/g, '左右滑动或点击底部圆点'],
  [/背包滚轮翻到第二页/g, '背包滑动翻到第二页'],
  [/鼠标悬停到商品上可以看简介，/g, ''],
  [/鼠标移上去点一下即可叫醒/g, '点一下即可叫醒'],
];
function tutorialText(html) {
  if (!matchMedia('(hover: none)').matches) return html; // 有鼠标的设备保持原措辞
  return TUTORIAL_TOUCH_TEXT.reduce((t, [re, to]) => t.replace(re, to), html);
}

export function hasUnclaimedTutorialRewards() {
  const r = gameData?.tutorialRewards;
  if (!r) return true; // 老存档尚未有该字段：福利待领取
  // 不参与展示的章节不计入未领取，避免红点永远亮着
  return TUTORIAL_SECTIONS.some((_, i) => tutorialSectionVisible(i) && !r.claimed.includes(i));
}
function claimTutorialReward(idx) {
  const r = tutorialRewards();
  if (r.claimed.includes(idx)) return false;
  r.claimed.push(idx);
  gameData.items.candy = (gameData.items.candy || 0) + TUTORIAL_REWARD;
  gameData.stats.totalItemsEarned.candy = (gameData.stats.totalItemsEarned.candy || 0) + TUTORIAL_REWARD; // 教程奖励计入道具获得
  saveGame();
  updateBackpack('candy');
  updateStats();
  window.dispatchEvent(new Event('tutorial-rewards-changed')); // 通知手机红点即时刷新
  return true;
}

export function showTutorialView() {
  pushNav('tutorialView');
  const list = $('tutorialList');
  const content = $('tutorialContent');
  const r = tutorialRewards();
  // 渲染左侧导航列表（带图标的章节在标题前显示对应 svg 图标；未领取奖励的章节带红点）
  // 平台不适用的章节整章跳过，data-i 仍用原始章节下标：奖励记录按原下标存档，不受过滤影响
  list.innerHTML = TUTORIAL_SECTIONS.map((s, i) => {
    if (!tutorialSectionVisible(i)) return '';
    return `<div class="tutorial-nav-item" data-i="${i}">${s.icon ? `<svg class="tutorial-nav-icon"><use xlink:href="#${s.icon}"/></svg>` : ''}${s.title}${r.claimed.includes(i) ? '' : '<span class="tutorial-nav-badge"></span>'}</div>`;
  }).join('');
  function render(idx) {
    const sec = TUTORIAL_SECTIONS[idx];
    content.innerHTML = `<div class="tutorial-title-row"><p class="tutorial-title">${sec.title}</p>${
      r.claimed.includes(idx)
        ? ''
        : `<button class="ach-btn ach-btn-ready tutorial-claim-btn" data-claim="${idx}"><img class="candy-icon" src="./items/goods/candy.png" alt="">×${TUTORIAL_REWARD} 领取</button>`
    }</div>` + tutorialText(sec.html);
    list.querySelectorAll('.tutorial-nav-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.i) === idx));
    // 点击领取：直接发糖果，弹章节总结，重绘当前章节（按钮消失），并移除左侧导航红点
    const btn = content.querySelector('.tutorial-claim-btn');
    if (btn) btn.onclick = (e) => {
      e.stopPropagation();
      if (claimTutorialReward(idx)) {
        list.querySelector(`.tutorial-nav-item[data-i="${idx}"] .tutorial-nav-badge`)?.remove();
        showConfirmBar(tutorialText(TUTORIAL_SUMMARIES[sec.title] || ''), null, null, { singleButton: true });
        render(idx);
      }
    };
    content.scrollTop = 0;
  }
  // 用 onclick 赋值，避免每次进入页面重复累加监听
  list.onclick = e => {
    const item = e.target.closest('.tutorial-nav-item');
    if (!item) return;
    render(Number(item.dataset.i));
  };
  list.onwheel = e => {
    e.preventDefault();
    list.scrollTop += e.deltaY * 0.35;
  };
  render(0);
  showView('tutorialView');
}

// ===== 版权声明 =====
export function showDeclarationView() {
  pushNav('declarationView');
  const content = $('declarationContent');
  content.innerHTML = `
    <div style="text-align:center;padding:14px 0;">
      <div style="font-size:16px;font-weight:700;">口袋挂机</div>
      <div style="font-size:10px;opacity:0.6;margin-top:2px;">POKEMON IDLE · 粉丝自制挂机游戏</div>
    </div>
    <div style="font-size:11px;line-height:1.9;">
      <p style="margin:6px 0;"><b>作者</b>：@ZTMYO</p>
      <p style="margin:6px 0;"><b>项目地址</b>：<span id="declarationLink" style="text-decoration:underline;cursor:pointer;">github.com/ZTMYO/PokeIdle</span></p>
      <p style="margin:12px 0 4px;padding-top:8px;border-top:1px dashed rgba(var(--ui-color-rgb),0.2);"><b>版权声明</b></p>
      <p style="margin:4px 0;">宝可梦（Pokémon）及其相关角色、名称、标志、音乐、插图与动画，版权均归 Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company 所有。</p>
      <p style="margin:4px 0;">本项目为个人学习与娱乐交流的粉丝作品，<b>非官方游戏，与官方无任何关联</b>，不用于任何商业用途。</p>
      <p style="margin:4px 0;">项目使用的宝可梦动画素材来自非官方社区资源（Pokémon Showdown），版权归属其原始权利方，本项目不主张任何所有权。</p>
      <p style="margin:4px 0;">如涉及侵权，请联系作者删除相关内容。</p>
    </div>
  `;
  content.querySelector('#declarationLink')?.addEventListener('click', () => {
    const url = 'https://github.com/ZTMYO/PokeIdle';
    if (window.__POKEIDLE_MOBILE__?.openExternal) window.__POKEIDLE_MOBILE__.openExternal(url);
    else if (window.__TAURI__?.opener?.openUrl) window.__TAURI__.opener.openUrl(url);
    else window.open(url, '_blank');
  });
  showView('declarationView');
}

