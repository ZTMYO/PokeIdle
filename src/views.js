import { CANDY_EXCHANGE, ITEM_NAMES, ITEM_ICONS, ITEM_RATES, CATCH_RATES, FLEE_CHANCE, SHINY_CHANCE, ENCOUNTER_MIN, ENCOUNTER_MAX } from './config.js';
import { phase, gameData, allPokemon, currentEncounter, honeyBuffActive, charmBuffActive, saveGame, addSystemLog, formatNum, formatTime, pad, randInt, setPrevView } from './state.js';
import { $, showView, updateTextBox, updateBackpack, updateStats } from './ui.js';
import { doCandyExchange, activateHoney, activateShinyCharm } from './items.js';
import { formatLogTime, showEncounterLogs, restorePokedex } from './pokedex.js';
import { stopAutoFleeTimer, startAutoFleeTimer, fleeEncounter, autoCatch } from './battle.js';

// ===== 数据统计视图 =====
export function showDataView() {
  setPrevView(phase === 'encounter' ? 'encounterView' : 'idleView');
  const stats = gameData.stats;
  const pokedex = gameData.pokedex;

  // 基础统计
  let totalSeen = 0;
  let totalCaught = 0;
  let mostSeen = { name: '', count: 0 };
  let mostBalls = { name: '', count: 0 };
  for (const entry of Object.values(pokedex)) {
    totalSeen += entry.seen || 0;
    totalCaught += entry.caught || 0;
    if ((entry.seen||0) > mostSeen.count) {
      mostSeen = { name: entry.name, count: entry.seen||0 };
    }
  }

  const totalUnique = Object.values(pokedex).filter(e => e.caught > 0).length;
  const totalSpecies = allPokemon.length;
  const pct = totalSpecies > 0 ? (totalUnique / totalSpecies * 100).toFixed(1) : '0.0';
  const catchRate = (totalCaught + stats.totalCatches) > 0
    ? ((stats.totalCatches / (stats.totalCatches + stats.totalFlees)) * 100).toFixed(1)
    : '0.0';
  const shinyRate = stats.totalShinySeen > 0
    ? ((stats.totalShinyCaught / stats.totalShinySeen) * 100).toFixed(1)
    : '0.0';

  // 道具获得统计
  const earned = stats.totalItemsEarned || {};
  let earnedHtml = '';
  for (const [k, v] of Object.entries(earned)) {
    earnedHtml += `<div class="stat-row">
      <span>${ITEM_NAMES[k]||k}</span><span>×${v}</span>
    </div>`;
  }

  const content = $('dataContent');
  content.innerHTML = `
    <div class="stat-inner">
      <div class="stat-section">全局统计</div>
      <div class="stat-row"><span>挂机时长</span><span>${formatTime(stats.totalPlaySeconds)}</span></div>
      <div class="stat-row"><span>总遭遇</span><span>${totalSeen}</span></div>
      <div class="stat-row"><span>总捕获</span><span>${stats.totalCatches}</span></div>
      <div class="stat-row"><span>逃跑数</span><span>${stats.totalFlees}</span></div>
      <div class="stat-row"><span>捕获率</span><span>${catchRate}%</span></div>
      <div class="stat-row"><span>图鉴完成度</span><span>${totalUnique}/${totalSpecies} (${pct}%)</span></div>

      <div class="stat-section">闪光统计</div>
      <div class="stat-row"><span>闪光遇见</span><span>${stats.totalShinySeen}</span></div>
      <div class="stat-row"><span>闪光捕获</span><span>${stats.totalShinyCaught}</span></div>
      <div class="stat-row"><span>闪光捕获率</span><span>${shinyRate}%</span></div>

      <div class="stat-section">消耗统计</div>
      <div class="stat-row"><span>精灵球使用</span><span>${stats.totalBallsUsed}</span></div>
      <div class="stat-row"><span>蛋孵化</span><span>${stats.totalEggsHatched}</span></div>
      <div class="stat-row"><span>平均球/遇敌</span><span>${totalSeen > 0 ? (stats.totalBallsUsed / totalSeen).toFixed(2) : '0'}</span></div>

      <div class="stat-section">遇见排行</div>
      <div class="stat-row"><span>遇见最多</span><span>${mostSeen.name} (${mostSeen.count}次)</span></div>

      <div class="stat-section">道具累计获得</div>
      ${earnedHtml || '<div>暂无数据</div>'}
    </div>
  `;
  showView('dataView');
}

// ===== 系统日志独立页面 =====
export function renderSystemLogs() {
  const logs = gameData.systemLogs || [];
  const sorted = [...logs].reverse();

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
        case 'shop_purchase':
          desc = `商店兑换${ITEM_NAMES[log.details.item] || log.details.item}×${log.details.qty}（消耗${log.details.cost}糖果）`;
          break;
        case 'encounter':
          desc = `遇到 ${log.details.shiny ? '闪光' : ''}${log.details.name}`;
          break;
        case 'pokemon_caught':
          desc = `${log.details.auto ? '[自动] ' : ''}收服了${log.details.shiny ? '闪光' : ''}${log.details.name}`;
          break;
        case 'player_fled':
          desc = log.details.auto ? '[自动] 你逃走了' : '你逃走了';
          break;
        case 'pokemon_escaped':
          desc = `${log.details.auto ? '[自动] ' : ''}${log.details.name} 逃走了。`;
          break;
        case 'egg_hatch':
          desc = `孵化出${log.details.shiny ? '闪光' : ''}${log.details.name}`;
          break;
        case 'region_change':
          desc = `进入 ${log.details.region} 地区`;
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
  setPrevView(phase === 'encounter' ? 'encounterView' : 'idleView');
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
  // 事件委托处理兑换点击
  content.onclick = (e) => {
    const item = e.target.closest('.shop-item');
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
      <div class="tutorial-btn" id="tutorialBtn">游戏教程</div>
    </div>
  `;
  container.querySelector('#toggleAutoCatch')?.addEventListener('click', toggleAutoCatch);
  container.querySelector('#toggleAutoFlee')?.addEventListener('click', toggleAutoFlee);
  container.querySelector('#toggleWindowPinned')?.addEventListener('click', toggleWindowPinned);
  container.querySelector('#toggleShinyStop')?.addEventListener('click', toggleShinyStop);
  container.querySelector('#tutorialBtn')?.addEventListener('click', showTutorialView);
  container.querySelector('#toggleBuffHoney')?.addEventListener('click', toggleAutoBuffHoney);
  container.querySelector('#toggleBuffCharm')?.addEventListener('click', toggleAutoBuffCharm);
  container.querySelectorAll('.ball-check[data-ball]').forEach(el => {
    el.addEventListener('click', () => toggleAutoCatchBall(el.dataset.ball));
  });
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
  // 刚开启且闲置中，立即使用一个
  if (gameData.settings.autoBuffCharm && phase === 'idle' && !charmBuffActive) {
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
  // 若当前正在遇敌且刚开启了自动捕捉，立即接管
  if (gameData.settings.autoCatch && phase === 'encounter' && currentEncounter) {
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
    window.__TAURI__.core.invoke('set_window_pinned', { pinned }).catch(() => {});
    try {
      const tw = window.__TAURI__?.window;
      if (tw?.getCurrentWindow) tw.getCurrentWindow().setAlwaysOnTop(pinned);
      else if (tw?.appWindow?.setAlwaysOnTop) tw.appWindow.setAlwaysOnTop(pinned);
    } catch (_) {}
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
  const container = $('settingsContent');
  renderSettings(container, gameData.settings);
  saveGame();
}

// ===== 教程视图 =====
export function showTutorialView() {
  setPrevView('settingsView');
  const content = $('tutorialContent');
  content.innerHTML = `
    <p><b>目标</b>：挂机收集道具，捕捉宝可梦，完成全图鉴！</p>
    <p><b>道具掉落</b>：挂机会自动产出道具，稀有度从高到低如下：</p>
    <span class="item-row"><b>糖果</b> 1/${Math.round(1/ITEM_RATES['candy'])}秒 |
    <b>精灵球</b> 1/${Math.round(1/ITEM_RATES['poke-ball'])}秒 |
    <b>高级球</b> 1/${Math.round(1/ITEM_RATES['ultra-ball'])}秒 |
    <b>甜甜蜜</b> 1/${Math.round(1/ITEM_RATES['sweet-honey'])}秒 |
    <b>神秘蛋</b> 1/${Math.round(1/ITEM_RATES['mystery-egg'])}秒 |
    <b>大师球</b> 1/${Math.round(1/ITEM_RATES['master-ball'])}秒 |
    <b>闪耀护符</b> 1/${Math.round(1/ITEM_RATES['shiny-charm'])}秒</span>
    <p><b>遇敌</b>：拥有精灵球时，每隔 <b>${Math.round(ENCOUNTER_MIN/60)}~${Math.round(ENCOUNTER_MAX/60)} 分钟</b>遇到一只野生宝可梦。</p>
    <p><b>捕捉</b>：丢出精灵球进行捕捉，不同球种捕获率：</p>
    <span class="indent"><b>精灵球</b> <b>${CATCH_RATES['poke-ball']*100}%</b> ｜ <b>高级球</b> <b>${CATCH_RATES['ultra-ball']*100}%</b> ｜ <b>大师球</b> <b>${CATCH_RATES['master-ball']*100}%</b></span>
    <p><b>捕获率递增</b>：连续丢球未击中时，捕获率每次 <b>+15%</b> 递增（最高<b>翻倍</b>）。</p>
    <p><b>宝可梦难度</b>：不同宝可梦基础捕获难度不同，右上角标注了<b>捕获率等级</b>（极低~高）。同时每只宝可梦有<b>稀有度</b>（常见/一般/稀有/罕见/极稀有），由<b>捕获率</b>和<b>种族值总和</b>共同决定。越稀有的宝可梦出现概率越低，但在<b>甜甜蜜</b>和<b>闪耀护符</b>期间稀有精灵的出现概率会大幅提升。</p>
    <p><b>逃跑</b>：丢球后宝可梦有 <b>${FLEE_CHANCE*100}%</b> 概率挣脱逃跑，也可主动点击<b>"逃跑"</b>按钮。</p>
    <p><b>糖果</b>：可兑换各种道具，在商店页面操作。</p>
    <p><b>甜甜蜜</b>：使用后 <b>1 分钟</b>内宝可梦会频繁出现，且稀有宝可梦出现概率提升。效果结束时若一次都没遇到则保底触发一次。可在设置中勾选自动续杯。</p>
    <p><b>神秘蛋</b>：点击孵化随机获得一只宝可梦（无需丢球）。<b>1/${Math.round(1/SHINY_CHANCE)}</b> 概率出闪光。</p>
    <p><b>闪耀护符</b>：价值 <b>${CANDY_EXCHANGE['shiny-charm']} 糖果</b>的珍稀道具。使用后 <b>60 秒</b>内快速遇敌（15~30秒一次），<b>80%</b> 为闪光 / <b>20%</b> 为未捕获品种，且稀有宝可梦出现概率大幅提升。效果结束时若一次都没遇到则保底触发一次。极小概率挂机捡到。</p>
    <p><b>闪光</b>：默认概率 <b>1/${Math.round(1/SHINY_CHANCE)}</b>，捕获后图鉴有特殊标记。使用闪耀护符可大量遇闪。</p>
    <p><b>图鉴详情</b>：点击图鉴条目查看详情。<b>未遇到过</b>显示"???"且不可点击；<b>遇到过未捕获</b>显示基础信息+完整日志；<b>已捕获</b>额外解锁精确数值、种族值条和图鉴描述。</p>
    <p><b>自动操作</b>：设置中开启后遇敌自动处理。勾选球种则自动捕获（<b>智能选球</b>：捕获率低的精灵优先使用高级球/大师球），不勾选任何球种则自动逃跑。勾选<b>自动甜甜蜜/自动护符</b>可在结束后自动续杯（两者都勾选时优先甜甜蜜）。开启<b>"闪光暂停"</b>可让闪光出现时转手动操作。</p>
    <p><b>佛系模式</b>：与自动操作互斥。开启后遇敌不自动处理，但 <b>30 秒</b>内未操作则宝可梦自行逃跑，不会卡住进度。适合挂后台偶尔手动抓两把的场合。</p>
    <p><b>存档</b>：自动保存，退出重开会自动加载。</p>
    <p><b>系统日志</b>：记录最近的活动（获得道具、遇敌、捕捉等）。点击右下角<b>挂机时间</b>即可查看。</p>
  `;
  showView('tutorialView');
}

