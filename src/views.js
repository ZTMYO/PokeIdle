import { CANDY_EXCHANGE, ITEM_NAMES, ITEM_RATES, CATCH_RATES, CATCH_BONUS_INC, FLEE_CHANCE, FLEE_CHANCE_INC, FLEE_CHANCE_MAX, SHINY_CHANCE, CHARM_SHINY_CHANCE, ENCOUNTER_MIN, ENCOUNTER_MAX, BUFF_DURATION, BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX, HONEY_RARITY_BOOST, CHARM_RARITY_BOOST, FISH_POKEMON_CHANCE, FISH_BUFF_POKEMON_CHANCE, FISH_RARE_RATE, FISH_WAIT_MIN, FISH_WAIT_MAX, FISH_QTY_MIN, FISH_QTY_MAX, FISH_TRIGGER_MIN, FISH_TRIGGER_MAX, REGION_CYCLE, PX_PER_METER, AUTO_FLEE_TIMEOUT, ROAD_SPECIAL_CHANCE, ROAD_WIDTH_MIN, ROAD_WIDTH_MAX, ROAD_SPEED_WALK, ROAD_SPEED_RUN, ROAD_SWITCH_CYCLES, HATCH_TIME_MIN, HATCH_TIME_MAX, BOUNTY_PER_REGION, BOUNTY_CANDY_MIN, BOUNTY_CANDY_MAX, BLOCK_DISTANCE, BLOCK_TARGET_CHANCE, BLOCK_QUALITY, TRADE_REFRESH_MS, TRADE_SHINY_CHANCE, FARM_PLANT_COST, FARM_MATURE_MIN, FARM_MATURE_MAX, FARM_HARVEST_MIN, FARM_HARVEST_MAX, FARM_MAX_WATER, FARM_WATER_DROP } from './config.js';
import { phase, gameData, allPokemon, getPokemonByIndex, getCurrentRegion, currentEncounter, currentIsShiny, honeyBuffActive, charmBuffActive, saveGame, addSystemLog, formatNum, formatTime, pad, randInt, setPrevView, getIncubatorUnlockCost, setGameData, getDefaultSave, ensureGpsState, _fishing } from './state.js';
import { $, showView, updateTextBox, updateBackpack, updateStats, isOnGameView, applyCharSprites } from './ui.js';
import { doCandyExchange, activateHoney, activateShinyCharm, ITEM_ICONS, BERRY_ICONS } from './items.js';
import { formatLogTime, showEncounterLogs, restorePokedex } from './pokedex.js';
import { stopAutoFleeTimer, startAutoFleeTimer, fleeEncounter, autoCatch, setAbortAutoCatch } from './battle.js';

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
function refreshDataStats() {
  const stats = gameData.stats;
  const pokedex = gameData.pokedex;

  // 累计数据
  let totalSeen = 0;
  let totalCaught = 0;
  let mostSeen = { name: '', count: 0 };
  for (const [pIdx, entry] of Object.entries(pokedex)) {
    totalSeen += entry.seen || 0;
    totalCaught += entry.caught || 0;
    if ((entry.seen || 0) > mostSeen.count) {
      const p = getPokemonByIndex(pIdx);
      mostSeen = { name: p ? p.name : '#' + pIdx, count: entry.seen || 0 };
    }
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

  $('dataPlayTotal').textContent = formatTime(stats.totalPlaySeconds);
  $('dataPlayToday').textContent = formatTime(stats.playSecondsToday || 0);
  $('dataTodaySeen').textContent = t.seen;
  $('dataTodayCaught').textContent = t.caught;
  $('dataTodayFled').textContent = t.fled;
  $('dataTodayRate').textContent = t.catchRate + '%';
  $('dataTodayShinySeen').textContent = t.shinySeen;
  $('dataTodayShinyCaught').textContent = t.shinyCaught;
  $('dataTodayHatched').textContent = t.hatched;
  $('dataRating').textContent = rating ? rating.name : '暂无评定，先去冒险吧';
  $('dataTotalSeen').textContent = totalSeen;
  $('dataTotalCaught').textContent = stats.totalCatches;
  $('dataTotalFled').textContent = stats.totalFlees;
  $('dataTotalRate').textContent = catchRate + '%';
  $('dataTotalShinySeen').textContent = stats.totalShinySeen;
  $('dataTotalShinyCaught').textContent = stats.totalShinyCaught;
  $('dataTotalHatched').textContent = stats.totalEggsHatched;
  $('dataRegion').textContent = region.name;
  $('dataWalkDist').textContent = walkText;
  $('dataDexPct').textContent = `${totalUnique}/${totalSpecies} (${pct}%)`;
  $('dataBallsUsed').textContent = stats.totalBallsUsed;
  $('dataBallsAvg').textContent = totalSeen > 0 ? (stats.totalBallsUsed / totalSeen).toFixed(2) : '0';
  $('dataBlockMade').textContent = stats.totalBlockMade || 0;
  $('dataPlantings').textContent = stats.totalPlantings || 0;
  $('dataHarvests').textContent = stats.totalHarvests || 0;
  $('dataBerriesHarvested').textContent = stats.totalBerriesHarvested || 0;
  $('dataBoardTrades').textContent = stats.totalBoardTrades || 0;
  $('dataBountyClaims').textContent = stats.totalBountyClaims || 0;
  $('dataBountyToday').textContent = stats.bountyClaimsToday || 0;
  $('dataBountyCandy').textContent = stats.totalBountyCandy || 0;
  $('dataMostSeen').textContent = mostSeen.count > 0 ? `${mostSeen.name} (${mostSeen.count}次)` : '暂无';
  const earnedEl = $('dataEarned');
  if (earnedEl) {
    // 糖果置顶，其余保持原顺序
    const entries = Object.entries(earned);
    const rows = entries.filter(([k]) => k === 'candy').concat(entries.filter(([k]) => k !== 'candy'));
    earnedEl.innerHTML = rows.map(([k, v]) =>
      `<div class="stat-row"><span>${ITEM_NAMES[k] || k}</span><span>×${v}</span></div>`
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

      <div class="stat-section">今日数据</div>
      <div class="stat-row"><span>今日挂机</span><span id="dataPlayToday"></span></div>
      <div class="stat-row"><span>今日遭遇</span><span id="dataTodaySeen"></span></div>
      <div class="stat-row"><span>今日捕获</span><span id="dataTodayCaught"></span></div>
      <div class="stat-row"><span>今日逃跑</span><span id="dataTodayFled"></span></div>
      <div class="stat-row"><span>今日捕获率</span><span id="dataTodayRate"></span></div>
      <div class="stat-row"><span>今日闪光遇见</span><span id="dataTodayShinySeen"></span></div>
      <div class="stat-row"><span>今日闪光捕获</span><span id="dataTodayShinyCaught"></span></div>
      <div class="stat-row"><span>今日孵化</span><span id="dataTodayHatched"></span></div>

      <div class="stat-section">累计数据</div>
      <div class="stat-row"><span>挂机时长</span><span id="dataPlayTotal"></span></div>
      <div class="stat-row"><span>总遭遇</span><span id="dataTotalSeen"></span></div>
      <div class="stat-row"><span>总捕获</span><span id="dataTotalCaught"></span></div>
      <div class="stat-row"><span>逃跑数</span><span id="dataTotalFled"></span></div>
      <div class="stat-row"><span>捕获率</span><span id="dataTotalRate"></span></div>
      <div class="stat-row"><span>闪光遇见</span><span id="dataTotalShinySeen"></span></div>
      <div class="stat-row"><span>闪光捕获</span><span id="dataTotalShinyCaught"></span></div>
      <div class="stat-row"><span>蛋孵化</span><span id="dataTotalHatched"></span></div>

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

      <div class="stat-section">遇见排行</div>
      <div class="stat-row"><span>遇见最多</span><span id="dataMostSeen"></span></div>

      <div class="stat-section">道具累计获得</div>
      <div id="dataEarned"></div>
    </div>
  `;
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
export function showShopView() {
  setPrevView(phase === 'encounter' ? 'encounterView' : 'idleView');
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
          <span class="shop-btn">兑换</span>
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
  showView('shopView');
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
  container.querySelector('#genderBrendan')?.addEventListener('click', () => toggleGender('brendan'));
  container.querySelector('#genderMay')?.addEventListener('click', () => toggleGender('may'));
  container.querySelector('#toggleAutoFlee')?.addEventListener('click', toggleAutoFlee);
  container.querySelector('#toggleWindowPinned')?.addEventListener('click', toggleWindowPinned);
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
export function resetSave() {
  try { localStorage.removeItem('pokemon_idle_save'); } catch (_) { }
  try { localStorage.removeItem('pokemon_idle_road'); } catch (_) { }
  try { localStorage.removeItem('pokemon_idle_session'); } catch (_) { }
  setGameData(getDefaultSave());
  ensureGpsState();
  saveGame();
  location.reload();
}

export function toggleAutoBuffHoney() {
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true }, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false };
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
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true }, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false };
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
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true }, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false };
  gameData.settings.autoCatch = !gameData.settings.autoCatch;
  if (gameData.settings.autoCatch) {
    gameData.settings.autoFlee = false;
    stopAutoFleeTimer(); // 关闭佛系倒计时
  }
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  // 若当前正在遇敌且刚开启了自动捕捉：仅在游戏页立即接管。
  // 非游戏页（设置页等）下 encounterView 隐藏，丢球动画取不到真实尺寸会错位，
  // 交给切回游戏页时的 showView 统一接管
  if (gameData.settings.autoCatch && phase === 'encounter' && currentEncounter && isOnGameView()) {
    autoCatch();
  }
}

export function toggleAutoFlee() {
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true }, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false };
  gameData.settings.autoFlee = !gameData.settings.autoFlee;
  if (gameData.settings.autoFlee) gameData.settings.autoCatch = false;
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
  // 若当前正在遇敌且刚开启了佛系模式，启动倒计时
  if (gameData.settings.autoFlee && phase === 'encounter' && currentEncounter) {
    stopAutoFleeTimer(); // 先清旧计时
    startAutoFleeTimer();
  }
}

function toggleWindowPinned() {
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true }, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false };
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

export function toggleAutoCatchBall(ballType) {
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true }, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false };
  if (!gameData.settings.autoCatchBalls) gameData.settings.autoCatchBalls = { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true };
  gameData.settings.autoCatchBalls[ballType] = !(gameData.settings.autoCatchBalls[ballType] !== false);
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

export function toggleShinyStop() {
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true }, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false };
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
}

export function toggleGender(g) {
  if (!gameData.settings) gameData.settings = { autoCatch: false, autoFlee: false, windowPinned: false, autoCatchBalls: { 'poke-ball': true, 'ultra-ball': true, 'master-ball': true }, shinyStop: false, autoBuffHoney: false, autoBuffCharm: false, gender: 'brendan' };
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
    .map(([k, rate]) => [ITEM_NAMES[k], `<b>${Math.round((rate / total) * 100)}%</b>`]);
})();

// 极稀有（稀有度≈1）出现权重相对无 buff 的倍率（公式与 items.js pickWeightedPokemon 一致）
function rarityWeightBoost(boost) {
  const penalty = Math.max(0.2, 0.8 - boost * 0.5);
  return ((1 - penalty) / 0.2).toFixed(2);
}

const TUTORIAL_SECTIONS = [
  {
    title: '序章',
    html: `<p>你是在<b>丰缘</b>长大的训练家，早已帮助<b>小田卷博士</b>完成了丰缘地区的图鉴，身经百战，是这片地区公认的冠军级训练家。</p>`
      + `<p>然而世界远比丰缘辽阔——如今<b>九大地区</b>（关都、城都、丰缘、神奥、合众、卡洛斯、阿罗拉、伽勒尔、帕底亚）早已打通陆路，各地的宝可梦正等着被收录进更完整的图鉴。</p>`
      + `<p>出发之前，小田卷博士将一部<b>手机</b>交到你手中：导航、图鉴、孵蛋器、混合器、树果农场……里面的应用足以支撑一场全新的旅行。</p>`
      + `<p>你背起行囊再次出发。前方的每一条道路、每一次遭遇，都将写下属于你的冒险故事。</p>`,
  },
  {
    title: '目标',
    html: `<p>挂机收集道具，捕捉宝可梦，完成全图鉴！</p>`,
  },
  {
    title: '道具',
    html: `<p>挂机时主角会拾取到道具，稀有度从低到高如下：</p>` + tutorialTable(ITEM_DROP_ROWS, ['道具', '概率（秒/个）'], [52, 'auto']),
  },
  {
    title: '遭遇',
    html: `<p>拥有精灵球时，每隔 <b>${Math.round(ENCOUNTER_MIN / 60)}~${Math.round(ENCOUNTER_MAX / 60)} 分钟</b>遇到一只野生宝可梦。</p>`
      + `<p><b>没有精灵球时不触发遇敌</b>。</p>`,
  },
  {
    title: '手机',
    html: `<p>点击标题栏的<b>手机</b>按钮进入，里面放着常用的应用（导航、图鉴、孵蛋器、混合器、树果农场、交换……），也可以查看当前系统时间。科学的力量真伟大！</p>`
  },
  {
    title: '图鉴',
    html: `<p>在<b>手机</b>页面打开<b>图鉴</b>应用，支持<b>搜索</b>（输入名称快速检索）与<b>地区筛选</b>。点击表头可按相应字段<b>排序</b>，再次点击同一表头切换升/降序。</p>`
      + `<p>在<b>手机</b>页面打开<b>统计</b>应用可查看冒险数据（详见「统计」章节）。</p>`
      + `<p>点击条目查看详情：<b>未遇到过</b>显示"？？？"且不可点击；<b>遇到过未捕获</b>显示基础信息+完整日志；<b>已捕获</b>额外解锁精确数值、种族值条、图鉴描述与爱吃的食物。</p>`
  },

  {
    title: '统计',
    html: `<p>在<b>手机</b>页面打开<b>统计</b>应用可查看冒险数据，含欧非评定、今日数据、累计数据、冒险进度、消耗统计、农场与合成、地区悬赏、遇见排行与道具累计获得等板块，每秒自动刷新。</p>`
      + `<p>欧非评定按每次遭遇的稀有度与捕获运气综合评价出称号；其余板块按时间（今日/累计）与类型（进度/消耗/收益）汇总各项数据。</p>`,
  },
  {
    title: '地区',
    html: `<p>游戏共 ${REGION_CYCLE.length} 个地区：${REGION_CYCLE.map(r => `<b>${r}</b>`).join('、')}。不同地区遇到的宝可梦各不相同：对于地区之间的道路，每段路<b>前半程</b>算出发地区、<b>后半程</b>算目标地区。</p>`
  },
  {
    title: '导航',
    html: `<p>在<b>手机</b>页面打开<b>导航</b>应用：选择目的地即可<b>手动导航</b>；开启<b>漫游</b>后，没有目的地时会自动沿<b>环国路线</b>（合众→关都→卡洛斯→城都→阿罗拉→丰缘→伽勒尔→神奥→帕底亚→合众…循环）选择下一站。</p>`
      + `<p>到达目的地后<b>导航结束</b>（若开启漫游，会自动选择下一站）。</p>`
      + `<p>进度由<b>主角实际移动</b>驱动——跑步更快，遇敌或钓鱼时暂停（详见「钓鱼」章节）。</p>`,
  },
  {
    title: '悬赏',
    html: `<p>每个地区每天<b>0 点</b>刷新<b>${BOUNTY_PER_REGION} 条地区悬赏</b>：指定宝可梦来自<b>全国图鉴</b>（可能不在该地区出没），悬赏糖果奖励 <b>${BOUNTY_CANDY_MIN}~${BOUNTY_CANDY_MAX} 颗</b>，越难捕获奖励越高。</p>`
      + `<p><b>今日到访过</b>的地区才能看到悬赏内容；仓库中拥有指定宝可梦即可<b>提交</b>，但<b>提交必须到达对应地区</b>。</p>`
      + `<p>标题右侧的<b>纸飞机图标</b>可将该地区设为<b>导航</b>目的地：自动跳到导航页并规划路线。</p>`
  },
  {
    title: '交换',
    html: `<p>在<b>手机</b>页面打开<b>交换</b>应用，NPC 挂出<b>想要的宝可梦</b>与<b>愿意给的宝可梦</b>有<b>${TRADE_SHINY_CHANCE * 100}%</b>的概率给出闪光宝可梦。</p>`
      + `<p>仓库中有符合要求的个体即可与之互换，收到的宝可梦来源记为「交换」；每 <b>${TRADE_REFRESH_MS / 60000}</b> 分钟刷新一波。</p>`,
  },
  {
    title: '场景',
    html: `<p>挂机时场景会自动轮换：每段场景的<b>长度随机生成</b>，整段滚动 <b>${ROAD_SWITCH_CYCLES}</b> 遍后切换到下一个随机场景。</p>`
      + `<p>生成下一个场景时，有 <b>${Math.round(ROAD_SPECIAL_CHANCE * 100)}%</b> 的概率是特殊场景（可钓鱼的水域或自行车道，各占一半概率），其余 <b>${Math.round((1 - ROAD_SPECIAL_CHANCE) * 100)}%</b> 为普通场景。</p>`
      + `<p>水域场景有垂钓点（详见「钓鱼」章节）；自行车道快速推进里程，但不触发遭遇与道具拾取。</p>`,
  },
  {
    title: '捕捉',
    html: `<p>丢出精灵球进行捕捉，不同球种捕获率：</p>`
      + tutorialTable([
        ['精灵球', `<b>${CATCH_RATES['poke-ball'] * 100}%</b>`],
        ['高级球', `<b>${CATCH_RATES['ultra-ball'] * 100}%</b>`],
        ['大师球', `<b>${CATCH_RATES['master-ball'] * 100}%</b>`],
      ], ['球种', '捕获率'], [48, 'auto'])
      + `<p>每一次捕捉失败后宝可梦都有几率挣脱逃跑（首球 <b>${FLEE_CHANCE * 100}%</b>，每多丢一球 <b>+${FLEE_CHANCE_INC * 100}%</b>，上限 <b>${FLEE_CHANCE_MAX * 100}%</b>）。</p>`
      + `<p>当逃跑率达到上限后，每多丢一球捕获率 <b>+${Math.round(CATCH_BONUS_INC * 100)}%</b>，无上限。</p>`
      + `<p>也可主动点击<b>"逃跑"</b>按钮逃离宝可梦。</p>`,
  },
  {
    title: '闪光',
    html: `<p>闪光宝可梦是<b>稀有变种</b>（配色不同），默认出现概率 <b>1/${Math.round(1 / SHINY_CHANCE)}</b>。</p>`
      + `<p>捕获后图鉴有<b>特殊标记</b>，并计入<b>闪光统计</b>。</p>`
      + `<p>使用<b>闪耀护符</b>可大幅提升遇闪概率（详见「增益」章节）。</p>`,
  },

  {
    title: '糖果',
    html: `<p>糖果是本游戏的唯一货币，通过挂机掉落、钓鱼、完成委托获得，能在手机里虚拟存储，用于解锁孵蛋器槽位、农场购买种子，也可在<b>商店</b>兑换道具（详见「商店」章节）。</p>`,
  },
  {
    title: '商店',
    html: `<p>商店消耗<b>糖果</b>兑换道具，糖果通过<b>挂机自动掉落</b>获得。</p>`
      + `<p>兑换价格（糖果）：</p>`
      + tutorialTable(Object.entries(CANDY_EXCHANGE).map(([item, cost]) => [ITEM_NAMES[item], `<b>${cost} 糖果</b>`]), ['道具', '价格'], [52, 'auto']),
  },
  {
    title: '增益',
    html: `<p>甜甜蜜与闪耀护符都是 <b>${BUFF_DURATION} 秒</b>增益，使用后主角进入跑步姿态，跑图速度提升。</p>`
      + `<p>期间遇敌间隔从普通 <b>${Math.round(ENCOUNTER_MIN / 60)}~${Math.round(ENCOUNTER_MAX / 60)} 分钟</b>缩短到 <b>${BUFF_ENCOUNTER_MIN}~${BUFF_ENCOUNTER_MAX} 秒</b>。</p>`
      + `<p>倒计时仅在挂机等待时消耗，<b>遇敌/钓鱼</b>期间暂停。</p>`
      + tutorialTable([
        ['生效', `<b>${BUFF_DURATION} 秒</b>`, `<b>${BUFF_DURATION} 秒</b>`],
        ['遇敌', `<b>${BUFF_ENCOUNTER_MIN}~${BUFF_ENCOUNTER_MAX} 秒</b>`, `<b>${BUFF_ENCOUNTER_MIN}~${BUFF_ENCOUNTER_MAX} 秒</b>`],
        ['稀有', `极稀有出现权重 ×<b>${rarityWeightBoost(HONEY_RARITY_BOOST)}</b>`, `极稀有出现权重 ×<b>${rarityWeightBoost(CHARM_RARITY_BOOST)}</b>`],
        ['闪光', '无加成', `<b>${Math.round(CHARM_SHINY_CHANCE * 100)}%</b> 闪光、<b>${Math.round((1 - CHARM_SHINY_CHANCE) * 100)}%</b> 未收录宝可梦`],
        ['钓鱼', `钓到宝可梦概率提升至 <b>${Math.round(FISH_BUFF_POKEMON_CHANCE * 100)}%</b>`, `钓到宝可梦概率提升至 <b>${Math.round(FISH_BUFF_POKEMON_CHANCE * 100)}%</b>，闪光率 <b>${Math.round(CHARM_SHINY_CHANCE * 100)}%</b>`],
      ], ['特性', '甜甜蜜', '闪耀护符'], [32, '40%', 'auto']),
  },
  {
    title: '孵蛋',
    html: `<p>在<b>手机</b>主页打开<b>孵蛋器</b>应用，将背包里的<b>神秘蛋</b>放入空闲槽位开始孵化。</p>`
      + `<p>孵化时间由宝可梦的<b>体重</b>和<b>稀有度</b>决定（<b>${Math.round(HATCH_TIME_MIN / 60)} 分钟~${Math.round(HATCH_TIME_MAX / 3600)} 小时</b>）。</p>`
      + `<p>孵化完成后点击<b>孵化</b>按钮即可获得宝可梦，结果<b>完全随机</b>，有 <b>1/${Math.round(1 / SHINY_CHANCE)}</b> 概率出闪光。</p>`
      + `<p>槽位解锁价格（糖果）：</p>`
      + tutorialTable(Array.from({ length: 8 }, (_, i) => [`槽位 <b>${i + 1}</b>`, `<b>${getIncubatorUnlockCost(i)} 糖果</b>`]), ['槽位', '价格'], [56, 'auto']),
  },
  {
    title: '钓鱼',
    html: `<p>经过有垂钓点的水域场景（如石桥）时会停下钓鱼。每段场景<b>只钓一次</b>：进入场景 <b>${FISH_TRIGGER_MIN}~${FISH_TRIGGER_MAX} 秒</b>后开始，等待上钩（<b>${FISH_WAIT_MIN}~${FISH_WAIT_MAX} 秒</b>）后收获随机道具 <b>${FISH_QTY_MIN}~${FISH_QTY_MAX}</b> 个。</p>`
      + `<p>钓到宝可梦的概率：</p>`
      + tutorialTable([
        ['无增益时', `<b>${Math.round(FISH_POKEMON_CHANCE * 100)}%</b>`],
        ['增益期间', `<b>${Math.round(FISH_BUFF_POKEMON_CHANCE * 100)}%</b>`],
      ], ['情况', '概率'], [80, 'auto'])
      + `<p>钓到宝可梦的种类：</p>`
      + tutorialTable([
        ['极稀有宝可梦', `<b>${Math.round(FISH_RARE_RATE * 100)}%</b>`],
        ['水系宝可梦', `<b>${Math.round((1 - FISH_RARE_RATE) * 100)}%</b>`],
      ], ['种类', '占比'], [80, 'auto'])
      + `<p>钓到道具时的种类概率（按掉率权重占比）：</p>`
      + tutorialTable(FISH_ITEM_ROWS, ['道具', '概率'], [52, 'auto'])
      + `<p>增益加成：护符期间钓到的宝可梦更容易<b>闪光</b>；等待上钩时间<b>不计入</b>增益时长。</p>`,
  },
  {
    title: '树果',
    html: `<p>树果是<b>树果农场</b>收获的作物，也是<b>树果混合器</b>的唯一原料，更是<b>宝可梦爱吃的食物</b>。</p>`
      + `<p><b>获取</b>：种下种子、浇水养护，成熟后收获（详见「农场」章节）。</p>`
      + `<p><b>用途</b>：作为配方制成<b>树果方块</b>（详见「树果方块」章节），或<b>出售</b>换糖果。</p>`,
  },
  {
    title: '农场',
    html: `<p>在<b>手机</b>主页打开<b>树果农场</b>，点击<b>空地</b>种下树果种子（消耗 <b>${FARM_PLANT_COST} 糖果</b>）。</p>`
      + `<p>刚种下<b>湿度为 0</b>，点击<b>浇水</b>才会生长；湿度随时间下降（每 <b>${Math.round(1 / FARM_WATER_DROP)} 秒</b>降 1 点，满湿度可撑 <b>${Math.round(FARM_MAX_WATER / FARM_WATER_DROP / 60)} 分钟</b>），<b>归 0 停止生长</b>，需及时补浇。</p>`
      + `<p>历经<b>刚种下→发芽→成长→开花结果</b>后成熟（每棵 <b>${Math.round(FARM_MATURE_MIN / 60000)}~${Math.round(FARM_MATURE_MAX / 60000)} 分钟</b>随机），点击<b>收获</b>得 <b>${FARM_HARVEST_MIN}~${FARM_HARVEST_MAX}</b> 颗树果。</p>`
      + `<p>收获的树果存入<b>库存</b>（点田地<b>左上角库存箱</b>查看）；库存的树果<b>不能当种子</b>，种地只能另买新种子。</p>`
      + `<p>树果可以<b>出售</b>换糖果：点田地<b>右上角告示牌</b>查看<b>树果委托</b>（每天刷新，需求越多报酬越高）；也可以作为<b>树果混合器</b>的原料（详见「混合器」章节）。</p>`,
  },  
  {
    title: '宝可梦',
    html: `<p>在<b>手机</b>页面打开<b>宝可梦</b>应用查看宝可梦仓库：每只捕获/孵化的宝可梦都是<b>独立个体</b>，支持搜索、来源筛选与表头排序。</p>`
      + `<p>每只个体带有随机<b>个体值</b>（HP/攻击/防御/特攻/特防/速度，各 0~31）与随机<b>性格</b>（共 25 种）。</p>`
      + `<p>点击个体列表项即可查看详情。</p>`
      + `<p>详情页右上角的<b>放生</b>按钮可移除该个体（确认后不可恢复）。</p>`
      + `<p>个体可用来<b>提交地区悬赏</b>——提交后该宝可梦会从仓库中移除（详见「悬赏」章节）。</p>`,
  },
  {
    title: '混合器',
    html: `<p>在<b>手机</b>主页打开<b>混合器</b>，从<b>农场库存</b>选 <b>1~4</b> 颗树果作为<b>配方</b>，确认后消耗它们制成<b>树果方块</b>（效果详见「树果方块」章节）。</p>`
      + `<p><b>开始混合</b>：确认后进入<b>转盘 QTE</b>——内指针旋转，内圈顶部有一段色带（中间<b>完美</b>、两侧<b>良好</b>），在内指针扫过色带中央的瞬间按下按钮，共 5 轮、速度渐快；按五轮总分评定方块品质（${Object.values(BLOCK_QUALITY).map(q => q.label).join(' / ')}）。</p>`,
  },
  {
    title: '树果方块',
    html: `<p><b>树果方块</b>是<b>混合器</b>的产物：用配方树果制成，用于吸引特定的宝可梦。</p>`
      + `<p><b>品质决定效果</b>：品质越高，遇敌时直接遇到目标宝可梦的概率越高（${Object.values(BLOCK_QUALITY).map(q => `${q.label} ${Math.round(q.chance * 100)}%`).join(' / ')}）。</p>`
      + `<p><b>按行走里程计时</b>：主角再走 <b>${BLOCK_DISTANCE}</b> 米没被吃掉则风干失效（停下不走不消耗），期间<b>不改变正常遇敌节奏</b>。</p>`
      + `<p>配方在当前地区没有宝可梦爱吃则<b>无效</b>；对于已收服的宝可梦，可以在图鉴查看它爱吃的食物（配方）。</p>`
      + `<p><b>注意</b>：方块<b>命中</b>目标的那次遇敌，闪光按默认 <b>1/${Math.round(1 / SHINY_CHANCE)}</b> 判定，<b>不享受闪耀护符</b>加成；</p>`,
  },
  {
    title: '自动操作',
    html: `<p>开启后遇敌<b>自动处理</b>：</p>`
      + `<p><b>勾选球种</b>：自动捕获（会根据捕获率智能选择勾选的球种）。</p>`
      + `<p><b>不勾选任何球种</b>：自动逃跑。</p>`
      + `<p><b>勾选增益道具</b>：增益结束后自动续杯（同时勾选优先甜甜蜜）。</p>`
      + `<p><b>开启闪光暂停</b>：闪光出现时不自动操作。</p>`,
  },
  {
    title: '佛系模式',
    html: `<p>与自动操作互斥，开启后遇敌不自动处理。</p>`
      + `<p><b>${AUTO_FLEE_TIMEOUT / 1000} 秒</b>内未操作则宝可梦自行逃跑，不会卡住进度，适合挂后台偶尔手动抓两把的场合。</p>`,
  },
  {
    title: '系统日志',
    html: `<p>记录最近的活动（获得道具、遇敌、捕捉等），在<b>手机</b>页面打开<b>日志</b>应用即可查看。</p>`,
  },
  {
    title: '宝可梦难度',
    html: `<p>不同宝可梦基础捕获难度不同（极低~高）。</p>`
      + `<p>每只宝可梦还有<b>稀有度</b>（常见/一般/稀有/罕见/极稀有），由<b>捕获率</b>和<b>种族值总和</b>共同决定，越稀有的宝可梦出现概率越低。</p>`
      + `<p>在<b>甜甜蜜</b>和<b>闪耀护符</b>期间，稀有精灵的出现概率会大幅提升（详见「增益」章节）。</p>`,
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
      <p style="margin:4px 0;">宝可梦（Pokémon）及其相关角色、名称、标志、插图与动画，版权均归 Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company 所有。</p>
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

