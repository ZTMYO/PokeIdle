import { CANDY_EXCHANGE, ITEM_NAMES, ITEM_RATES, CATCH_RATES, CATCH_BONUS_INC, FLEE_CHANCE, FLEE_CHANCE_INC, FLEE_CHANCE_MAX, SHINY_CHANCE, CHARM_SHINY_CHANCE, ENCOUNTER_MIN, ENCOUNTER_MAX, BUFF_DURATION, BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX, HONEY_RARITY_BOOST, CHARM_RARITY_BOOST, FISH_POKEMON_CHANCE, FISH_BUFF_POKEMON_CHANCE, FISH_RARE_RATE, FISH_WAIT_MIN, FISH_WAIT_MAX, FISH_QTY_MIN, FISH_QTY_MAX, FISH_TRIGGER_MIN, FISH_TRIGGER_MAX, REGION_CYCLE, PX_PER_METER, AUTO_FLEE_TIMEOUT, ROAD_SPECIAL_CHANCE, ROAD_WIDTH_MIN, ROAD_WIDTH_MAX, ROAD_SPEED_WALK, ROAD_SPEED_RUN, ROAD_SWITCH_CYCLES, HATCH_DIST_MIN, HATCH_DIST_MAX, BOUNTY_PER_REGION, BOUNTY_CANDY_MIN, BOUNTY_CANDY_MAX, BLOCK_DISTANCE, BLOCK_TARGET_CHANCE, BLOCK_QUALITY, TRADE_REFRESH_MS, TRADE_SHINY_CHANCE, FARM_PLANT_COST, FARM_MATURE_MIN, FARM_MATURE_MAX, FARM_HARVEST_MIN, FARM_HARVEST_MAX, FARM_MAX_WATER, FARM_WATER_DROP, FARM_BOARD_DEMANDS, FARM_BOARD_BIG_QTY_MIN, FARM_BOARD_BIG_QTY_MAX, FARM_HELPER_WORK_STAGE, FARM_HELPER_REST, FARM_HELPER_STAGE_COST, FARM_HELPER_STAGE_INC, FARM_HELPER_WORK_MIN, FARM_HELPER_WORK_MAX,
  MASS_GEN_MIN, MASS_GEN_MAX, MASS_DURATION, MASS_COUNT_MIN, MASS_COUNT_MAX,
  MASS_SPAWN_MIN, MASS_SPAWN_MAX, MASS_SPAWN_HONEY_MIN, MASS_SPAWN_HONEY_MAX, MASS_SHINY_CHANCE,
  TRAIN_SLOTS, TRAIN_XP_PER_MIN, TRAIN_LAZY,
  TRAIN_SATIETY_MAX, TRAIN_SATIETY_DRAIN_PER_MIN, TRAIN_SATIETY_EAT_AT,
  TRAIN_SATIETY_PER_BERRY, TRAIN_HUNGRY_LAZY_MULT,
  BATTLE_REFRESH_MS, BATTLE_NPC_COUNTS, BATTLE_MONS_COUNT } from './config.js';
import { phase, gameData, allPokemon, getPokemonByIndex, getCurrentRegion, currentEncounter, currentIsShiny, honeyBuffActive, charmBuffActive, saveGame, addSystemLog, formatNum, pad, randInt, setPrevView, setGameData, getDefaultSave, ensureGpsState, _fishing } from './state.js';
import { $, showView, updateTextBox, updateBackpack, updateStats, isOnGameView, applyCharSprites } from './ui.js';
import { doCandyExchange, activateHoney, activateShinyCharm, ITEM_ICONS, BERRY_ICONS } from './items.js';
import { formatLogTime, showEncounterLogs, restorePokedex } from './pokedex.js';
import { stopAutoFleeTimer, startAutoFleeTimer, fleeEncounter, autoCatch, setAbortAutoCatch } from './battle.js';
import { setVolume, setBattleMusic, setMusicEnabled, playBattle, endBattle } from './audio.js';
import { renderAchievements, refreshAchievements } from './achievements.js';
import { TEAM_MAX } from './team.js';

// ===== 欧气综合评定 =====
// 每场遭遇的欧气分（捕获用获得分 score，宝可梦挣脱逃跑用相遇分）取平均，映射到 9 档称号。
// 玩家主动逃跑（手动 / 佛系 / 无球自动）属于策略选择，不参与评定。
// 参考分布：普通遭遇 20~26、捕获 26~48、闪光 50~78、钓鱼 20~29、孵蛋 30/60；
// 正常玩家平均约 25~27，欧皇（多稀有/闪光）可达 30+，极欧 45+。
const LUCKY_TIERS = [
  { min: 42, name: '天运所归' },
  { min: 33, name: '大欧皇' },
  { min: 29, name: '小欧皇' },
  { min: 26, name: '小有运气' },
  { min: 23.5, name: '平凡训练家' },
  { min: 22, name: '小非酋' },
  { min: 20.5, name: '大非酋' },
  { min: 19, name: '终极非酋' },
  { min: -Infinity, name: '终极无敌至尊非酋' },
];

// 汇总全部遭遇日志，计算平均欧气分并返回对应称号（无有效记录返回 null）
function calcLuckyRating() {
  const logs = gameData.encounterLogs || {};
  let total = 0, count = 0;
  for (const arr of Object.values(logs)) {
    if (!Array.isArray(arr)) continue;
    for (const l of arr) {
      // 跳过无有效评分的旧记录（旧 fled 无相遇分，score=0），避免拉低平均
      if (!l || typeof l.score !== 'number' || l.score <= 0) continue;
      // 主动逃跑（selfFlee）是策略选择，不计入欧气评定
      if (l.selfFlee === true) continue;
      total += l.score;
      count++;
    }
  }
  if (count === 0) return null;
  const avg = total / count;
  return LUCKY_TIERS.find(t => avg >= t.min) || null;
}

// ===== 数据统计视图 =====

// 今日统计：从遭遇日志按"今天 0 点后"筛选（孵蛋单独计数，不算遭遇；逃跑只算挣脱，不含主动逃跑）
// 每次调用重新取当天零点，跨天自动归零
function calcTodayStats() {
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const t = { seen: 0, caught: 0, fled: 0, shinySeen: 0, shinyCaught: 0, hatched: 0, catchRate: '0.0' };
  for (const arr of Object.values(gameData.encounterLogs || {})) {
    for (const l of arr) {
      if (!l || !l.time || l.time < todayStart) continue;
      if (l.source === 'egg') {
        t.hatched++;
        if (l.result === 'caught') { t.caught++; if (l.shiny) t.shinyCaught++; }
        continue;
      }
      t.seen++;
      if (l.result === 'caught') { t.caught++; if (l.shiny) t.shinyCaught++; }
      else if (l.result === 'fled' && !l.selfFlee) t.fled++;
      if (l.shiny) t.shinySeen++;
    }
  }
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

  $('dataPlayTotal').textContent = fmtPlayTime(stats.totalPlaySeconds);
  $('dataPlayToday').textContent = fmtPlayTime(stats.playSecondsToday || 0);
  $('dataTodaySeen').textContent = formatNum(t.seen);
  $('dataTodayCaught').textContent = formatNum(t.caught);
  $('dataTodayFled').textContent = formatNum(t.fled);
  $('dataTodayRate').textContent = t.catchRate + '%';
  $('dataTodayShinySeen').textContent = formatNum(t.shinySeen);
  $('dataTodayShinyCaught').textContent = formatNum(t.shinyCaught);
  $('dataTodayHatched').textContent = formatNum(t.hatched);
  $('dataTradesToday').textContent = formatNum(stats.tradesToday || 0);
  $('dataRating').textContent = rating ? rating.name : '暂无评定，先去冒险吧';
  $('dataTotalSeen').textContent = formatNum(totalSeen);
  $('dataTotalCaught').textContent = formatNum(stats.totalCatches);
  $('dataTotalFled').textContent = formatNum(stats.totalFlees);
  $('dataTotalRate').textContent = catchRate + '%';
  $('dataTotalShinySeen').textContent = formatNum(stats.totalShinySeen);
  $('dataTotalShinyCaught').textContent = formatNum(stats.totalShinyCaught);
  $('dataTotalHatched').textContent = formatNum(stats.totalEggsHatched);
  $('dataTradesTotal').textContent = formatNum(stats.totalTrades || 0);
  $('dataRegion').textContent = region.name;
  $('dataWalkDist').textContent = walkText;
  $('dataDexPct').textContent = `${formatNum(totalUnique)}/${formatNum(totalSpecies)} (${pct}%)`;
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
  // 从手机主页进入时，返回应回到手机主页
  setPrevView($('phoneView')?.style.display !== 'none' ? 'phoneView' : (phase === 'encounter' ? 'encounterView' : 'idleView'));

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
          <tr><td>孵化</td><td id="dataTodayHatched"></td><td id="dataTotalHatched"></td></tr>
          <tr><td>交换</td><td id="dataTradesToday"></td><td id="dataTradesTotal"></td></tr>
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

      <div class="stat-section">道具累计获得</div>
      <div id="dataEarned"></div>

      <div id="achievementList"></div>
    </div>
  `;
  renderAchievements();
  // 初始填充 + 每秒实时刷新全部动态值；离开统计页后定时器自动停止
  refreshDataStats();
  if (showDataView._timer) clearInterval(showDataView._timer);
  showDataView._timer = setInterval(() => {
    if ($('dataView')?.style.display === 'none') {
      clearInterval(showDataView._timer);
      showDataView._timer = null;
      return;
    }
    refreshDataStats();
    refreshAchievements();
  }, 1000);
  showView('dataView');
}

// ===== 系统日志独立页面 =====
export function renderSystemLogs() {
  const logs = gameData.systemLogs || [];
  const sorted = [...logs].reverse();
  // 日志只存宝可梦编号，名字从图鉴数据查表
  const logName = log => {
    const n = log.details?.pokemon;
    if (n == null) return log.details?.name || '';
    const p = getPokemonByIndex(n);
    return p ? p.name : '#' + n;
  };

  const content = $('systemLogContent');
  if (!content) return;
  content.innerHTML = `
    <div style="border-bottom:1px solid var(--ui-color);margin-bottom:3px;font-size:10px;">最近 ${Math.min(sorted.length, 50)} 条活动记录</div>
    ${sorted.length === 0 ? '<div style="padding:12px 4px;text-align:center;">暂无活动记录</div>' : ''}
    ${sorted.map(log => {
    const time = formatLogTime(log.time);
    let desc = '';
    switch (log.type) {
      case 'item_gain':
        desc = `获得 ${ITEM_NAMES[log.details.item] || log.details.item} ×${log.details.qty}`;
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
        desc = `${log.details.auto ? '[自动] ' : ''}${logName(log)} 逃走了。`;
        break;
      case 'egg_hatch':
        desc = `孵化出${log.details.shiny ? '闪光' : ''}${logName(log)}`;
        break;
      case 'region_change':
        desc = `进入 ${log.details.region} 地区`;
        break;
      case 'bounty_claim':
        desc = `完成地区悬赏，获得糖果 ×${log.details.candy}`;
        break;
      case 'berry_helper':
        desc = `招募了树果帮手`;
        break;
      default:
        desc = `未知事件 (${log.type})`;
    }
    return `<div style="font-size:10px;line-height:1.8;padding:1px 0;">
        <span style="opacity:0.6;">${time}</span>
        <span style="margin-left:6px;">${desc}</span>
      </div>`;
  }).join('')}
  `;
}

export function showSystemLogs() {
  setPrevView('phoneView');
  showView('systemLogView');
  const sv = $('systemLogView');
  if (sv) sv.scrollTop = 0;
  renderSystemLogs();
}

// ===== 商店视图 =====
// 右键兑换按钮弹出的批量购买数量选项（×1 始终可用，其余按余额置灰）
const BUY_QTY_OPTIONS = [1, 5, 10, 50];

export function showShopView() {
  setPrevView(phase === 'encounter' ? 'encounterView' : 'idleView');
  hideShopContextMenu(); // 重新进入商店时清理可能残留的批量菜单
  const content = $('shopContent');
  const candy = gameData.items['candy'] || 0;

  let itemsHtml = '';
  for (const [item, cost] of Object.entries(CANDY_EXCHANGE)) {
    const enough = candy >= cost;
    itemsHtml += `
      <div class="shop-item ${enough ? '' : 'disabled'}" data-item="${item}">
        <div class="shop-item-left">
          <img src="./items/${ITEM_ICONS[item]}" class="shop-icon" alt="${ITEM_NAMES[item]}" />
          <span class="shop-item-name">${ITEM_NAMES[item]}</span>
        </div>
        <div class="shop-item-right">
          <span class="shop-cost"><img src="./items/candy.png" style="width:14px;height:14px;vertical-align:middle;image-rendering:pixelated;" /> ×${cost}</span>
          <span class="shop-btn" title="右键可批量购买">兑换</span>
        </div>
      </div>`;
  }

  content.innerHTML = `
    <div style="padding:6px 8px;color:var(--ui-color);">
      <div style="text-align:center;font-weight:700;margin-bottom:6px;">
        当前糖果：<span><img src="./items/candy.png" style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated;" /> ${candy}</span>
      </div>
      ${itemsHtml}
    </div>
  `;
  // 事件委托处理兑换点击（仅"兑换"按钮可购买，点卡片其他区域无效）
  content.onclick = (e) => {
    const btn = e.target.closest('.shop-btn');
    if (!btn) return;
    const item = btn.closest('.shop-item');
    if (!item || item.classList.contains('disabled')) return;
    doCandyExchange(item.dataset.item);
  };
  // 右键"兑换"按钮弹出批量购买菜单
  content.oncontextmenu = (e) => {
    const btn = e.target.closest('.shop-btn');
    if (!btn) return;
    const item = btn.closest('.shop-item');
    if (!item || item.classList.contains('disabled')) return;
    e.preventDefault();
    showShopContextMenu(item.dataset.item, e.clientX, e.clientY);
  };
  showView('shopView');
}

// 批量购买菜单：在右键位置弹出，钱不够的选项降透明度并禁用
function showShopContextMenu(itemKey, x, y) {
  hideShopContextMenu();
  const cost = CANDY_EXCHANGE[itemKey];
  const candy = gameData.items['candy'] || 0;
  let menu = $('shopCtxMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'shopCtxMenu';
    menu.className = 'shop-ctx-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = BUY_QTY_OPTIONS.map(q => {
    const total = cost * q;
    const ok = candy >= total;
    return `<div class="shop-ctx-item${ok ? '' : ' disabled'}" data-item="${itemKey}" data-q="${q}">
      <span class="shop-ctx-qty">×${q}</span>
      <span class="shop-ctx-cost"><img src="./items/candy.png" style="width:12px;height:12px;vertical-align:middle;image-rendering:pixelated;" /> ×${total}</span>
    </div>`;
  }).join('');
  menu.style.display = '';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(0, Math.min(x - 24, window.innerWidth - mw - 4)) + 'px';
  menu.style.top = Math.max(0, Math.min(y, window.innerHeight - mh - 4)) + 'px';
  // 菜单内点击不触发外部关闭；点击外部任意位置关闭
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.onclick = (e) => {
    const opt = e.target.closest('.shop-ctx-item');
    if (!opt || opt.classList.contains('disabled')) return;
    hideShopContextMenu();
    doCandyExchange(opt.dataset.item, Number(opt.dataset.q));
  };
  document.addEventListener('pointerdown', hideShopContextMenu);
}

function hideShopContextMenu() {
  const menu = $('shopCtxMenu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('pointerdown', hideShopContextMenu);
}

// ===== 设置视图 =====
export function showSettingsView() {
  setPrevView(phase === 'encounter' ? 'encounterView' : 'idleView');
  const content = $('settingsContent');
  const s = gameData.settings || {};
  renderSettings(content, s);
  showView('settingsView');
}

export function renderSettings(container, s) {
  const ballLabels = { 'poke-ball': '精灵球', 'ultra-ball': '高级球', 'master-ball': '大师球' };
  const autoCatch = s.autoCatch || false;
  const autoFlee = s.autoFlee || false;
  const windowPinned = s.windowPinned || false;
  const balls = s.autoCatchBalls || { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true };
  const shinyStop = s.shinyStop || false;
  const autoBuffHoney = s.autoBuffHoney || false;
  const autoBuffCharm = s.autoBuffCharm || false;
  const gender = s.gender || 'brendan';
  const musicVolume = s.musicVolume ?? 0.6;
  const musicEnabled = s.musicEnabled !== false;
  const battleMusic = s.battleMusic !== false;
  container.innerHTML = `
    <div style="padding:6px 8px;">
      <div class="auto-catch-row">
        <div class="auto-catch-label">自动操作</div>
        <div class="toggle-switch" id="toggleAutoCatch">
          <div class="toggle-track ${autoCatch ? 'on' : ''}"></div>
          <div class="toggle-knob"></div>
        </div>
      </div>
      ${autoCatch ? `
      <div class="auto-catch-row" style="padding-left:8px;">
        <div class="auto-catch-label">闪光暂停</div>
        <div class="toggle-switch" id="toggleShinyStop">
          <div class="toggle-track ${shinyStop ? 'on' : ''}"></div>
          <div class="toggle-knob"></div>
        </div>
      </div>
      <div class="ball-check-row">
        ${['poke-ball', 'ultra-ball', 'master-ball'].map(b => `
          <span class="ball-check ${(balls[b] !== false) ? 'on' : ''}" data-ball="${b}">${(balls[b] !== false) ? '☑' : '☐'}${ballLabels[b]}</span>
        `).join('')}
      </div>
      <div class="ball-check-row" style="margin-top:3px;">
        <span class="ball-check ${autoBuffHoney ? 'on' : ''}" id="toggleBuffHoney">${autoBuffHoney ? '☑' : '☐'}甜甜蜜</span>
        <span class="ball-check ${autoBuffCharm ? 'on' : ''}" id="toggleBuffCharm">${autoBuffCharm ? '☑' : '☐'}闪耀护符</span>
      </div>
      ` : ''}
      <div class="auto-catch-row">
        <div class="auto-catch-label">佛系模式</div>
        <div class="toggle-switch" id="toggleAutoFlee">
          <div class="toggle-track ${autoFlee ? 'on' : ''}"></div>
          <div class="toggle-knob"></div>
        </div>
      </div>
      ${autoFlee ? '<div style="font-size:9px;color:var(--color-ui);padding:2px 0 4px 8px;">遇敌后 30 秒未操作，宝可梦会自行逃跑</div>' : ''}
      <div class="auto-catch-row">
        <div class="auto-catch-label">固定窗口</div>
        <div class="toggle-switch" id="toggleWindowPinned">
          <div class="toggle-track ${windowPinned ? 'on' : ''}"></div>
          <div class="toggle-knob"></div>
        </div>
      </div>
      <div class="auto-catch-row">
        <div class="auto-catch-label">音乐</div>
        <div class="toggle-switch" id="toggleMusicEnabled">
          <div class="toggle-track ${musicEnabled ? 'on' : ''}"></div>
          <div class="toggle-knob"></div>
        </div>
      </div>
      ${musicEnabled ? `
      <div class="auto-catch-row" style="padding-left:8px;">
        <div class="auto-catch-label">音乐音量</div>
        <div class="volume-row">
          <input type="range" class="volume-slider" id="musicVolumeSlider" min="0" max="1" step="0.05" value="${musicVolume}" />
        </div>
      </div>
      <div class="auto-catch-row" style="padding-left:8px;">
        <div class="auto-catch-label">战斗音乐</div>
        <div class="toggle-switch" id="toggleBattleMusic">
          <div class="toggle-track ${battleMusic ? 'on' : ''}"></div>
          <div class="toggle-knob"></div>
        </div>
      </div>
      ` : ''}
      <div class="auto-catch-row">
        <div class="auto-catch-label">角色</div>
        <div class="gender-check-row">
          <span class="ball-check ${gender === 'brendan' ? 'on' : ''}" id="genderBrendan">${gender === 'brendan' ? '☑' : '☐'}小悠</span>
          <span class="ball-check ${gender === 'may' ? 'on' : ''}" id="genderMay">${gender === 'may' ? '☑' : '☐'}小遥</span>
        </div>
      </div>
      <div class="reset-save-row">
        <span class="reset-save-label">重置存档</span>
        <span class="reset-save-btn" id="resetSaveBtn">重置</span>
      </div>
      <a href="https://github.com/ZTMYO/PokeIdle" id="githubLink" target="_blank" rel="noopener"
         style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;padding:6px 0;color:var(--ui-color);text-decoration:none;font-size:12px;cursor:pointer;">
        <svg viewBox="0 0 1024 1024" width="16" height="16" style="flex-shrink:0;"><use xlink:href="./icons/sprites.svg#icon-github"/></svg>
        <span style="font-weight:600;">ZTMYO</span>
      </a>
      <div id="declarationBtn" style="text-align:center;font-size:9px;opacity:0.5;padding:2px 0 4px;cursor:pointer;">版权声明</div>
    </div>
  `;
  container.querySelector('#toggleAutoCatch')?.addEventListener('click', toggleAutoCatch);
  container.querySelector('#toggleMusicEnabled')?.addEventListener('click', toggleMusicEnabled);
  container.querySelector('#genderBrendan')?.addEventListener('click', () => toggleGender('brendan'));
  container.querySelector('#genderMay')?.addEventListener('click', () => toggleGender('may'));
  container.querySelector('#toggleAutoFlee')?.addEventListener('click', toggleAutoFlee);
  container.querySelector('#toggleWindowPinned')?.addEventListener('click', toggleWindowPinned);
  container.querySelector('#toggleBattleMusic')?.addEventListener('click', toggleBattleMusic);
  container.querySelector('#toggleShinyStop')?.addEventListener('click', toggleShinyStop);
  // 重置存档：二次点击确认，防误触
  container.querySelector('#resetSaveBtn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = '确认重置？';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => {
        btn.classList.remove('confirm');
        btn.textContent = '重置';
      }, 3000);
      return;
    }
    resetSave();
  });
  container.querySelector('#toggleBuffHoney')?.addEventListener('click', toggleAutoBuffHoney);
  container.querySelector('#toggleBuffCharm')?.addEventListener('click', toggleAutoBuffCharm);
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
  // GitHub 仓库链接：Tauri 下用 opener 插件在系统浏览器打开
  container.querySelector('#githubLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    const url = 'https://github.com/ZTMYO/PokeIdle';
    if (window.__TAURI__?.opener?.openUrl) window.__TAURI__.opener.openUrl(url);
    else window.open(url, '_blank');
  });
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
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false, gender: 'brendan' };
  if (!gameData.settings.autoCatchBalls) gameData.settings.autoCatchBalls = { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true };
  if (gameData.settings.musicVolume == null) gameData.settings.musicVolume = 0.6;
  if (gameData.settings.musicEnabled == null) gameData.settings.musicEnabled = true;
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

export function toggleShinyStop() {
  ensureSettings();
  gameData.settings.shinyStop = !gameData.settings.shinyStop;
  if (gameData.settings.shinyStop) {
    gameData.settings.autoCatch = true;
    // 刚开启闪光暂停 → 中止当前闪光的自动丢球（不跳转页面，用户留在设置页；
    // 切回遭遇页时 fleeBtn 由渲染逻辑恢复显示）
    if (currentIsShiny && phase === 'encounter') {
      setAbortAutoCatch();
    }
  } else {
    // 刚关闭闪光暂停 → 仅当遭遇页可见时立即接管；
    // 在设置页时交给 showView 切回游戏页的统一接管（避免在隐藏页上丢球导致动画状态错乱）
    if (currentIsShiny && phase === 'encounter' && isOnGameView()) {
      import('./battle.js').then(m => m.autoCatch());
    }
  }
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  updateStats(); // 开启/关闭闪光暂停会联动自动捕捉，立即刷新底部状态文字
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

// 钓鱼收获道具的概率：按 ITEM_RATES 权重占比计算，配置变化自动同步
const FISH_ITEM_ROWS = (() => {
  const total = Object.values(ITEM_RATES).reduce((a, b) => a + b, 0);
  return Object.entries(ITEM_RATES)
    .sort((a, b) => b[1] - a[1])
    .map(([k, rate]) => [ITEM_NAMES[k], `<b>${Math.round((rate / total) * 100)}</b>%`]);
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
      + `<p>出发之前，小田卷博士将一部<b>手机</b>交到你手中：<b>导航</b>、<b>图鉴</b>、<b>孵蛋器</b>、<b>混合器</b>、<b>树果农场</b>……里面的应用足以支撑一场全新的旅行。</p>`
      + `<p>你背起行囊再次出发。前方的每一条道路、每一次遭遇，都将写下属于你的冒险故事。</p>`,
  },
  {
    title: '目标',
    html: `<p>挂机收集道具，捕捉宝可梦，完成全图鉴！</p>`,
  },
  {
    title: '道具',
    html: `<p>挂机时主角会拾取到道具，稀有度从低到高如下：</p>` + tutorialTable(ITEM_DROP_ROWS, ['道具', '概率（秒/个）'], [52, 'auto'])
      + `<p>拾取<b>糖果</b>时还有概率一次获得更多：×2、×5、×50 甚至一次 <b>×100</b> 颗，倍率越大越稀有。</p>`,
  },
  {
    title: '遭遇',
    html: `<p>拥有精灵球时，每隔 <b>${Math.round(ENCOUNTER_MIN / 60)}~${Math.round(ENCOUNTER_MAX / 60)}</b> 分钟遇到一只野生宝可梦。</p>`
      + `<p>没有<b>精灵球</b>时不触发遇敌。</p>`,
  },
  {
    title: '手机',
    html: `<p>点击标题栏的<b>手机</b>按钮进入，里面放着常用的应用（<b>导航</b>、<b>图鉴</b>、<b>孵蛋器</b>、<b>混合器</b>、<b>树果农场</b>、<b>交换</b>……），也可以查看当前系统时间。科学的力量真伟大！</p>`
  },
  {
    title: '图鉴',
    html: `<p>在<b>手机</b>页面打开<b>图鉴</b>应用，支持<b>搜索</b>（输入名称快速检索）与地区筛选。点击表头可按相应字段排序，再次点击同一表头切换升/降序。</p>`
      + `<p>在<b>手机</b>页面打开<b>统计</b>应用可查看冒险数据（详见「<b>统计</b>」章节）。</p>`
      + `<p>点击条目查看详情：未遇到过显示"？？？"且不可点击；遇到过未捕获显示基础信息+完整日志；已捕获额外解锁精确数值、种族值条、图鉴描述与爱吃的食物。</p>`
  },

  {
    title: '统计',
    html: `<p>在<b>手机</b>页面打开<b>统计</b>应用可查看冒险数据：<b>欧非评定</b>按每次遭遇的稀有度与捕获运气综合评价称号；数据总览以表格统一展示今日与累计的挂机时长、遭遇、捕获、逃跑、捕获率、闪光遇见/捕获、孵化与交换，每秒自动刷新。</p>`
      + `<p>其余板块按类别汇总：冒险进度（当前地区、行走距离、图鉴完成度）、消耗统计（精灵球使用与均耗）、农场与合成、地区悬赏与道具累计获得。</p>`
      + `<p>页面最下方是<b>成就奖励</b>板块：每项累计统计达成等级即可领取糖果（详见「<b>成就</b>」章节）。</p>`,
  },
  {
    title: '成就',
    html: `<p>在<b>统计</b>页最下方的<b>成就奖励</b>板块领取：每项累计统计达标<b>一级</b>即可领一次糖果。</p>`
      + `<p>等级按 <b>1-2-5</b> 规整序列无限递进，未领的等级会一直累计；除「图鉴收藏家」到上限完结外，其余成就等级<b>无限</b>。</p>`,
  },
  {
    title: '地区',
    html: `<p>游戏共 <b>${REGION_CYCLE.length}</b> 个地区：${REGION_CYCLE.map(r => `<b>${r}</b>`).join('、')}。不同地区遇到的宝可梦各不相同：对于地区之间的道路，每段路<b>前半程</b>算出发地区、<b>后半程</b>算目标地区。</p>`
  },
  {
    title: '导航',
    html: `<p>在<b>手机</b>页面打开<b>导航</b>应用或点击主界面右下角的位置文字：选择目的地即可手动导航；开启<b>漫游</b>后，没有目的地时会自动沿<b>环国路线</b>（合众→帕底亚→阿罗拉→丰缘→关都→城都→神奥→卡洛斯→伽勒尔→合众…循环）选择下一站。</p>`
      + `<p>到达目的地后导航结束（若开启<b>漫游</b>，会自动选择下一站）。</p>`
      + `<p>进度由主角实际移动驱动——跑步更快，遇敌或钓鱼时暂停（详见「<b>钓鱼</b>」章节）。</p>`
      + `<p>导航推进的是<b>所在地区</b>（决定遇敌池、地区悬赏、大量出没事件）；<b>孵蛋</b>与<b>树果方块</b>按<b>行走里程</b>计算，与是否导航<b>无关</b>。</p>`
  },
  {
    title: '事件',
    html: `<p>每隔 <b>${MASS_GEN_MIN}~${MASS_GEN_MAX}</b> 分钟，道路网络上会随机出现一个<b>大量出没</b>事件点：某只宝可梦在某条路段上大量出现。</p>`
      + `<p>在<b>导航</b>页地图上能看到事件点标记，<b>点击即可导航过去</b>。</p>`
      + `<p>事件点是一个<b>点</b>而不是整条路：只有抵达事件点并停下才算进入大量出没区域，<b>途经该路段不算</b>；到达后（未开启漫游）会<b>自动停在事件点</b>。</p>`
      + `<p>进入区域后，事件宝可梦会大量出现：<b>锁定该宝可梦</b>，闪光率 <b>1/${Math.round(1 / MASS_SHINY_CHANCE)}</b>（不吃闪耀护符加成）。</p>`
      + `<p>使用<b>甜甜蜜</b>可让下一只出现得更快（<b>${MASS_SPAWN_HONEY_MIN}~${MASS_SPAWN_HONEY_MAX}</b> 秒，普通 <b>${MASS_SPAWN_MIN}~${MASS_SPAWN_MAX}</b> 秒）。</p>`
      + `<p>事件持续 <b>${MASS_DURATION}</b> 分钟，抓完剩余数量（<b>${MASS_COUNT_MIN}~${MASS_COUNT_MAX}</b> 只）或到期后结束。</p>`,
  },
  {
    title: '悬赏',
    html: `<p>每个地区每天<b>0</b> 点刷新<b>${BOUNTY_PER_REGION}</b> 条<b>地区悬赏</b>：指定宝可梦来自全国图鉴（可能不在该地区出没），悬赏糖果奖励 <b>${BOUNTY_CANDY_MIN}~${BOUNTY_CANDY_MAX}</b> 颗，越难捕获奖励越高。</p>`
      + `<p>今日到访过的地区才能看到悬赏内容；仓库中拥有指定宝可梦即可提交，但提交必须到达对应地区。</p>`
      + `<p>标题右侧的纸飞机图标可将该地区设为<b>导航</b>目的地：自动跳到导航页并规划路线。</p>`
  },
  {
    title: '交换',
    html: `<p>在<b>手机</b>页面打开<b>交换</b>应用，NPC 挂出想要的宝可梦与愿意给的宝可梦，有 <b>${TRADE_SHINY_CHANCE * 100}</b>% 的概率给出闪光宝可梦。</p>`
      + `<p>仓库中有符合要求的个体即可与之互换，收到的宝可梦来源记为「<b>交换</b>」；每 <b>${TRADE_REFRESH_MS / 60000}</b> 分钟刷新一波。</p>`,
  },
  {
    title: '场景',
    html: `<p>挂机时场景会自动轮换：每段场景的长度随机生成，整段滚动 <b>${ROAD_SWITCH_CYCLES}</b> 遍后切换到下一个随机场景。</p>`
      + `<p>生成下一个场景时，有 <b>${Math.round(ROAD_SPECIAL_CHANCE * 100)}</b>% 的概率是<b>特殊场景</b>（可钓鱼的水域或自行车道，各占一半概率），其余 <b>${Math.round((1 - ROAD_SPECIAL_CHANCE) * 100)}</b>% 为普通场景。</p>`
      + `<p>水域场景有<b>垂钓点</b>（详见「<b>钓鱼</b>」章节）；<b>自行车道</b>快速推进里程，但不触发遭遇与道具拾取。</p>`,
  },
  {
    title: '捕捉',
    html: `<p>丢出精灵球进行捕捉，不同球种捕获率：</p>`
      + tutorialTable([
        ['精灵球', `<b>${CATCH_RATES['poke-ball'] * 100}</b>%`],
        ['高级球', `<b>${CATCH_RATES['ultra-ball'] * 100}</b>%`],
        ['大师球', `<b>${CATCH_RATES['master-ball'] * 100}</b>%`],
      ], ['球种', '捕获率'], [48, 'auto'])
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
    html: `<p><b>糖果</b>是本游戏的唯一货币，通过挂机掉落、钓鱼、完成委托获得，能在手机里虚拟存储，用于解锁<b>孵蛋器</b>槽位、<b>农场</b>购买种子，也可在<b>商店</b>兑换道具（详见「<b>商店</b>」章节）。</p>`
      + `<p>挂机掉落的糖果可能<b>翻倍</b>获得，最高一次 <b>100</b> 颗。</p>`,
  },
  {
    title: '商店',
    html: `<p>点击标题栏右侧区域的商店按钮者点击主界面左下角的糖果数量文字进入<b>商店</b>。可以消耗<b>糖果</b>兑换基础道具。</p>`
      + `<p>左键点击「兑换」兑换 1 个，<b>右键</b>兑换按钮可<b>批量购买</b>（一次 5 / 10 / 50 个，糖果不够的档位会置灰）。</p>`
      + `<p>兑换价格（糖果）：</p>`
      + tutorialTable(Object.entries(CANDY_EXCHANGE).map(([item, cost]) => [ITEM_NAMES[item], `<b>${cost}</b> 糖果`]), ['道具', '价格'], [52, 'auto']),
  },
  {
    title: '增益',
    html: `<p><b>甜甜蜜</b>与<b>闪耀护符</b>都是 <b>${BUFF_DURATION}</b> 秒增益，使用后主角进入跑步姿态，跑图速度提升。</p>`
      + `<p>期间遇敌间隔从普通 <b>${Math.round(ENCOUNTER_MIN / 60)}~${Math.round(ENCOUNTER_MAX / 60)}</b> 分钟缩短到 <b>${BUFF_ENCOUNTER_MIN}~${BUFF_ENCOUNTER_MAX}</b> 秒。</p>`
      + `<p>倒计时仅在挂机等待时消耗，遇敌/钓鱼期间暂停。</p>`
      + tutorialTable([
        ['生效', `<b>${BUFF_DURATION}</b> 秒`, `<b>${BUFF_DURATION}</b> 秒`],
        ['遇敌', `<b>${BUFF_ENCOUNTER_MIN}~${BUFF_ENCOUNTER_MAX}</b> 秒`, `<b>${BUFF_ENCOUNTER_MIN}~${BUFF_ENCOUNTER_MAX}</b> 秒`],
        ['稀有', `极稀有出现权重 ×<b>${rarityWeightBoost(HONEY_RARITY_BOOST)}</b>`, `极稀有出现权重 ×<b>${rarityWeightBoost(CHARM_RARITY_BOOST)}</b>`],
        ['闪光', '无加成', `<b>${Math.round(CHARM_SHINY_CHANCE * 100)}</b>% 闪光、<b>${Math.round((1 - CHARM_SHINY_CHANCE) * 100)}</b>% 未收录宝可梦`],
        ['钓鱼', `钓到宝可梦概率提升至 <b>${Math.round(FISH_BUFF_POKEMON_CHANCE * 100)}</b>%`, `钓到宝可梦概率提升至 <b>${Math.round(FISH_BUFF_POKEMON_CHANCE * 100)}</b>%，闪光率 <b>${Math.round(CHARM_SHINY_CHANCE * 100)}</b>%`],
      ], ['特性', '甜甜蜜', '闪耀护符'], [32, '40%', 'auto']),
  },
  {
    title: '孵蛋',
    html: `<p>在<b>手机</b>主页打开<b>孵蛋器</b>应用，将背包里的<b>神秘蛋</b>放入空闲槽位开始<b>孵化</b>。</p>`
      + `<p>孵化里程由宝可梦的体重和稀有度决定（<b>${HATCH_DIST_MIN / 1000}~${HATCH_DIST_MAX / 1000}</b> 公里）。</p>`
      + `<p>主角行走累计到所需里程即孵化完成——停下不走不推进，跑步/骑车走得更快。</p>`
      + `<p>孵化完成后点击孵化按钮即可获得宝可梦，结果完全随机，有 <b>1/${Math.round(1 / SHINY_CHANCE)}</b> 概率出闪光。</p>`,
  },
  {
    title: '钓鱼',
    html: `<p>经过有<b>垂钓点</b>的水域场景（如石桥）时会停下<b>钓鱼</b>。每段场景只钓一次：进入场景 <b>${FISH_TRIGGER_MIN}~${FISH_TRIGGER_MAX}</b> 秒后开始，等待上钩（<b>${FISH_WAIT_MIN}~${FISH_WAIT_MAX}</b> 秒）后收获随机道具 <b>${FISH_QTY_MIN}~${FISH_QTY_MAX}</b> 个。</p>`
      + `<p>钓到宝可梦的概率：</p>`
      + tutorialTable([
        ['无增益时', `<b>${Math.round(FISH_POKEMON_CHANCE * 100)}</b>%`],
        ['增益期间', `<b>${Math.round(FISH_BUFF_POKEMON_CHANCE * 100)}</b>%`],
      ], ['情况', '概率'], [80, 'auto'])
      + `<p>钓到宝可梦的种类：</p>`
      + tutorialTable([
        ['极稀有宝可梦', `<b>${Math.round(FISH_RARE_RATE * 100)}</b>%`],
        ['水系宝可梦', `<b>${Math.round((1 - FISH_RARE_RATE) * 100)}</b>%`],
      ], ['种类', '占比'], [80, 'auto'])
      + `<p>钓到道具时的种类概率（按掉率权重占比）：</p>`
      + tutorialTable(FISH_ITEM_ROWS, ['道具', '概率'], [52, 'auto'])
      + `<p>增益加成：护符期间钓到的宝可梦更容易<b>闪光</b>；等待上钩时间不计入增益时长。</p>`,
  },
  {
    title: '树果',
    html: `<p><b>树果</b>是<b>树果农场</b>收获的作物，也是<b>树果混合器</b>的唯一原料，更是宝可梦爱吃的食物。</p>`
      + `<p>获取：种下种子、浇水养护，成熟后收获（详见「<b>农场</b>」章节）。</p>`
      + `<p>用途：作为配方制成<b>树果方块</b>（详见「<b>树果方块</b>」章节），或出售换糖果。</p>`,
  },
  {
    title: '农场',
    html: `<p>在<b>手机</b>主页打开<b>树果农场</b>，点击空地种下树果种子（消耗 <b>${FARM_PLANT_COST}</b> 糖果）。</p>`
      + `<p>刚种下<b>湿度</b>为 <b>0</b>，点击<b>浇水</b>才会生长；湿度随时间下降（每 <b>${Math.round(1 / FARM_WATER_DROP)}</b> 秒降 <b>1</b> 点，满湿度可撑 <b>${Math.round(FARM_MAX_WATER / FARM_WATER_DROP / 60)}</b> 分钟），归 <b>0</b> 停止生长，需及时补浇。</p>`
      + `<p>历经刚种下→发芽→成长→开花结果后成熟（每棵 <b>${Math.round(FARM_MATURE_MIN / 60000)}~${Math.round(FARM_MATURE_MAX / 60000)}</b> 分钟随机），点击收获得 <b>${FARM_HARVEST_MIN}~${FARM_HARVEST_MAX}</b> 颗树果。</p>`
      + `<p>收获的树果存入库存（点田地左上角库存箱查看）；库存的树果不能当种子，种地只能另买新种子。</p>`
      + `<p>树果可以出售换糖果：点田地右上角告示牌查看树果委托（每天刷新 <b>${FARM_BOARD_DEMANDS}</b> 条，其中第 <b>1</b> 条为大量需求 <b>${FARM_BOARD_BIG_QTY_MIN}~${FARM_BOARD_BIG_QTY_MAX}</b> 颗，需专门种植较久；需求越多报酬越高）。</p>`,
  },  
  {
    title: '宝可梦',
    html: `<p>在<b>手机</b>页面打开<b>宝可梦</b>应用查看宝可梦仓库：每只捕获/孵化的宝可梦都是独立个体，支持搜索、来源筛选与表头排序。</p>`
      + `<p>每只个体带有随机<b>个体值</b>（HP/攻击/防御/特攻/特防/速度，各 <b>0~31</b>）与随机<b>性格</b>（共 <b>25</b> 种）。</p>`
      + `<p>点击个体列表项即可查看详情。</p>`
      + `<p>详情页右上角的<b>放生</b>按钮可移除该个体（确认后不可恢复）。</p>`
      + `<p>个体可用来提交地区悬赏——提交后该宝可梦会从仓库中移除（详见「<b>悬赏</b>」章节）。</p>`,
  },
  {
    title: '配队',
    html: `<p>在<b>手机</b>页面打开<b>配队</b>应用组建小队：点击<b>空位</b>从仓库选择宝可梦加入（最多 <b>${TEAM_MAX}</b> 只）。</p>`
      + `<p>点击<b>已有成员</b>弹出菜单：<b>替换</b>（从仓库换一只到该位置）、<b>交换</b>（与队伍中另一只互换位置）、<b>移除</b>（放回仓库）；<b>右键</b>点击可隐藏菜单。</p>`
      + `<p>加入队伍的宝可梦会从<b>训练</b>中自动撤下（训练/队伍<b>互斥</b>，详见「<b>训练</b>」章节）。</p>`,
  },
  {
    title: '训练',
    html: `<p>在<b>手机</b>页面打开<b>训练</b>应用即可进入训练场：</p>`
      + `<p>面板顶部有 <b>${TRAIN_SLOTS}</b> 个格子（显示宝可梦图标）：点击<b>空位</b>去仓库选一只放入，再次点击即可<b>取出</b>；底部列出每只的训练<b>状态、经验进度条与饱食度</b>。</p>`
      + `<p>挂机自动获得经验 <b>${TRAIN_XP_PER_MIN}</b>/分钟，不消耗糖果；放入训练后自动从<b>队伍</b>中撤下（互斥）。</p>`
      + `<p>场地左上角的<b>纸箱</b>是<b>树果库存</b>（与树果农场共用一份库存，点击可查看）：训练中的宝可梦会<b>消耗树果补充饱食度</b>。</p>`
      + `<p><b>饱食度</b>上限 <b>${TRAIN_SATIETY_MAX}</b>，训练时每分钟下降 <b>${TRAIN_SATIETY_DRAIN_PER_MIN}</b>；低于 <b>${TRAIN_SATIETY_EAT_AT}</b> 时会自动吃掉一颗它<b>爱吃</b>的树果（图鉴可查爱吃的食物），每颗补充 <b>${TRAIN_SATIETY_PER_BERRY}</b> 饱食度——没存货就只能饿着。</p>`
      + `<p>鼠标<b>悬停</b>在场地上的宝可梦可查看<b>名字 · 等级 · 饱食 · 状态</b>。</p>`
      + `<p>训练中偶尔会<b>偷懒</b>：约 <b>${Math.round(TRAIN_LAZY.chancePerMin * 100)}</b>%/分钟 触发一次，暂停训练 <b>${TRAIN_LAZY.durationMin / 1000 / 60}~${TRAIN_LAZY.durationMax / 1000 / 60}</b> 分钟（只暂停后续积累，已获得的经验保留）。</p>`
      + `<p><b>饱食度越低越容易偷懒</b>：满饱食时偷懒概率为 <b>1</b> 倍，饿到 <b>0</b> 时最多放大到 <b>${TRAIN_HUNGRY_LAZY_MULT}</b> 倍，记得常备爱吃的树果！</p>`
      + `<p>偷懒的宝可梦会<b>停止跳动</b>待在原地，鼠标移上去光标变成<b>手形</b>——点它一下就能把它<b>叫醒</b>，继续训练！</p>`,
  },
  {
    title: '对战',
    html: `<p>在<b>手机</b>页面打开<b>对战</b>应用，向路过的训练家发起挑战（NPC 队伍分<b>普通 / 精英 / 冠军</b>三档，每 <b>${BATTLE_REFRESH_MS / 60000}</b> 分钟刷新一波）。</p>`
      + `<p>挑战失败可<b>再战一次</b>，随时都能重复挑战。</p>`
      + `<p>各档挑战数量与队伍规模：普通 <b>${BATTLE_NPC_COUNTS.novice}</b> 名 / <b>${BATTLE_MONS_COUNT.novice}</b> 只、精英 <b>${BATTLE_NPC_COUNTS.veteran}</b> 名 / <b>${BATTLE_MONS_COUNT.veteran}</b> 只、冠军 <b>${BATTLE_NPC_COUNTS.champion}</b> 名 / <b>${BATTLE_MONS_COUNT.champion}</b> 只。</p>`,
  },
  {
    title: '配招',
    html: `<p>在<b>宝可梦</b>仓库的个体详情页配置招式（最多 <b>4</b> 个）：<b>自动</b>按等级搭配；<b>手动</b>进入独立的配招页自由调整。</p>`
      + `<p>配招页<b>左侧</b>是可学习的招式（带<b>属性图标</b>，<b>高亮</b>=已配入），点一下在<b>右侧</b>查看<b>详细解释</b>；再点<b>顶部空槽位</b>就把这招放进去。</p>`
      + `<p>槽位上的<b>叉号</b>可移除招式。</p>`,
  },
  {
    title: '混合器',
    html: `<p>在<b>手机</b>主页打开<b>混合器</b>，从农场库存选 <b>1~4</b> 颗树果作为<b>配方</b>，确认后消耗它们制成<b>树果方块</b>（效果详见「<b>树果方块</b>」章节）。</p>`
      + `<p>开始混合：确认后进入<b>转盘 QTE</b>——内指针旋转，内圈顶部有一段色带（中间完美、两侧良好），在内指针扫过色带中央的瞬间按下按钮，共 <b>5</b> 轮、速度渐快；按五轮总分评定方块品质（${Object.values(BLOCK_QUALITY).map(q => q.label).join(' / ')}）。</p>`,
  },
  {
    title: '树果方块',
    html: `<p><b>树果方块</b>是<b>混合器</b>的产物：用配方树果制成，用于吸引特定的宝可梦。</p>`
      + `<p><b>品质</b>决定效果：品质越高，遇敌时直接遇到目标宝可梦的概率越高（${Object.values(BLOCK_QUALITY).map(q => `${q.label} <b>${Math.round(q.chance * 100)}</b>%`).join(' / ')}）。</p>`
      + `<p>按行走里程计时：主角再走 <b>${BLOCK_DISTANCE}</b> 米没被吃掉则风干失效（停下不走不消耗），期间不改变正常遇敌节奏。</p>`
      + `<p>配方在当前地区没有宝可梦爱吃则无效；对于已收服的宝可梦，可以在图鉴查看它爱吃的食物（配方）。</p>`
      + `<p>注意：方块命中目标的那次遇敌，闪光按默认 <b>1/${Math.round(1 / SHINY_CHANCE)}</b> 判定，不享受闪耀护符加成；</p>`,
  },
  {
    title: '招募帮手',
    html: `<p>点田地右上角<b>告示牌</b>可在弹出的面板中花费糖果招募<b>帮手</b>，可设置连续工作时间段（每阶段 <b>${FARM_HELPER_WORK_STAGE}</b> 分钟），价格按阶段累进。</p>`
      + `<p>帮手自动劳作：优先收获成熟树果、给干涸树果浇水、在空地播种（「自动种植」开启后自动扣种子钱）。</p>`
      + `<p>帮手每工作 <b>${FARM_HELPER_WORK_STAGE}</b> 分钟休息 <b>${FARM_HELPER_REST}</b> 分钟再继续；</p>`,
  },
  {
    title: '自动操作',
    html: `<p>开启后遇敌自动处理：</p>`
      + `<p>勾选球种：<b>自动捕获</b>（会根据捕获率智能选择勾选的球种）。</p>`
      + `<p>不勾选任何球种：<b>自动逃跑</b>（期间禁止手动丢球）。</p>`
      + `<p>勾选增益道具：增益结束后自动<b>续杯</b>（同时勾选优先甜甜蜜）。</p>`
      + `<p>开启<b>闪光暂停</b>：闪光出现时不自动操作。</p>`,
  },
  {
    title: '佛系模式',
    html: `<p>与<b>自动操作</b>互斥，开启后遇敌不自动处理。</p>`
      + `<p><b>${AUTO_FLEE_TIMEOUT / 1000}</b> 秒内未操作则宝可梦自行逃跑，不会卡住进度，适合挂后台偶尔手动抓两把的场合。</p>`,
  },
  {
    title: '系统日志',
    html: `<p>在<b>手机</b>页面打开<b>日志</b>应用或点击主界面底部中间的状态文字即可查看记录最近的活动（获得道具、遇敌、捕捉等），最多存储 <b>50</b> 条记录。</p>`
  },
  {
    title: '宝可梦难度',
    html: `<p>不同宝可梦基础<b>捕获难度</b>不同（极低~高）。</p>`
      + `<p>每只宝可梦还有<b>稀有度</b>（常见/一般/稀有/罕见/极稀有），由捕获率和种族值总和共同决定，越稀有的宝可梦出现概率越低。</p>`
      + `<p>在甜甜蜜和闪耀护符期间，稀有精灵的出现概率会大幅提升（详见「<b>增益</b>」章节）。</p>`,
  },
  {
    title: '状态栏图标',
    html: `<p>把窗口<b>最小化</b>后主角依然在挂机冒险。Windows 任务栏右下角（系统托盘）会出现<b>口袋挂机</b>图标。</p>`
      + `<p>点击图标：窗口<b>打开时</b>点一下收起，<b>最小化或收起后</b>再点一下即可弹回前台。</p>`
      + `<p>Windows 默认会把不常用的图标收进「<b>显示隐藏的图标</b>」弹层里：点开它找到口袋挂机图标，<b>按住拖到外面的任务栏</b>即可固定显示，游戏状态一眼可见。</p>`
      + `<p>鼠标<b>悬停</b>在图标上会弹出多行状态提示：地点、主角动作、操作模式、农场、悬赏、交换、可孵化等信息一目了然；</p>`
      + `<p>图标还会动：角色前进、钓鱼、可孵化、遭遇、可浇水时各有对应提示动画；</p>`,
  },
];

export function showTutorialView() {
  setPrevView('phoneView');
  const list = $('tutorialList');
  const content = $('tutorialContent');
  // 渲染左侧导航列表
  list.innerHTML = TUTORIAL_SECTIONS.map((s, i) =>
    `<div class="tutorial-nav-item" data-i="${i}">${s.title}</div>`
  ).join('');
  function render(idx) {
    content.innerHTML = `<p class="tutorial-title">${TUTORIAL_SECTIONS[idx].title}</p>` + TUTORIAL_SECTIONS[idx].html;
    list.querySelectorAll('.tutorial-nav-item').forEach((el, i) => el.classList.toggle('active', i === idx));
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
  setPrevView('settingsView');
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
    if (window.__TAURI__?.opener?.openUrl) window.__TAURI__.opener.openUrl(url);
    else window.open(url, '_blank');
  });
  showView('declarationView');
}

