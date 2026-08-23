// ===== 成就系统 =====
// 每个成就按「等级」递进：达标一级即可领取一次糖果，领取后自动进入下一级。
// 等级无限：阈值/糖果都按 1-2-5 规整序列递进（10,20,50,100,200,500…），数字好记、等级多。
// 领取一级一级来；未领取的等级会一直累计。图鉴类（maxTiers）达到上限即完结。
import { gameData, saveGame, formatNum } from './state.js';
import { updateBackpack, updateStats } from './ui.js';
import { PX_PER_METER } from './config.js';

// 糖果图标（显示在按钮左侧）
const CANDY_ICON = '<img src="./items/candy.png" style="width:12px;height:12px;vertical-align:-2px;image-rendering:pixelated;" />';

// 图鉴已捕获种类数（去重）
function dexCount() {
  if (!gameData?.pokedex) return 0;
  return Object.values(gameData.pokedex).filter(e => e && (e.caught || 0) > 0).length;
}

// 规整等级系数：1, 2, 5, 10, 20, 50, 100, ...（每 3 级一个数量级，等级多且数字好记）
function niceValue(n) {
  return [1, 2, 5][n % 3] * Math.pow(10, Math.floor(n / 3));
}

// 成就定义：metric 读当前统计值；base 为首级阈值，reward 为首级糖果，
// 后续等级 = base/reward × niceValue(n)（无限递进）；maxTiers 可选（图鉴类上限）。
export const ACHIEVEMENTS = [
  {
    id: 'candy', name: '糖果富翁', desc: '累计糖果数',
    // 首级阈值 500：新档启动资金 450 已计入累计统计，若阈值过低开局就会直接解锁
    metric: d => d.stats.totalItemsEarned?.candy || 0, base: 500, reward: 10,
    fmt: v => `${formatNum(v)} 个`,
  },
  {
    id: 'play', name: '时间旅人', desc: '累计挂机时长',
    metric: d => Math.floor((d.stats.totalPlaySeconds || 0) / 3600), base: 1, reward: 20,
    fmt: v => `${formatNum(v)} 小时`,
  },
  {
    id: 'catch', name: '收服之旅', desc: '累计捕捉宝可梦',
    metric: d => d.stats.totalCatches || 0, base: 5, reward: 10,
    fmt: v => `${formatNum(v)} 只`,
  },
  {
    id: 'walk', name: '漫步者', desc: '累计行走距离',
    metric: d => Math.floor((d.stats.walkDistance || 0) / PX_PER_METER), base: 1000, reward: 20,
    fmt: v => v >= 1000 ? `${formatNum(v / 1000)} 公里` : `${v} 米`,
  },
  {
    id: 'harvest', name: '农场主', desc: '累计收获树果',
    metric: d => d.stats.totalBerriesHarvested || 0, base: 10, reward: 20,
    fmt: v => `${formatNum(v)} 颗`,
  },
  {
    id: 'hatch', name: '孵化师', desc: '累计孵化宝可梦',
    metric: d => d.stats.totalEggsHatched || 0, base: 1, reward: 30,
    fmt: v => `${formatNum(v)} 只`,
  },
  {
    id: 'breed', name: '育种大师', desc: '累计繁殖产蛋',
    metric: d => d.stats.totalEggsProduced || 0, base: 1, reward: 30,
    fmt: v => `${formatNum(v)} 枚`,
  },
  {
    id: 'block', name: '树果大师', desc: '累计合成树果方块',
    metric: d => d.stats.totalBlockMade || 0, base: 1, reward: 20,
    fmt: v => `${formatNum(v)} 个`,
  },
  {
    id: 'trade', name: '交换达人', desc: '累计完成交换',
    metric: d => d.stats.totalTrades || 0, base: 1, reward: 30,
    fmt: v => `${formatNum(v)} 次`,
  },
  {
    id: 'npcCandy', name: '对战丰收', desc: '累计通过 NPC 对战获得糖果',
    metric: d => d.stats.totalNpcCandy || 0, base: 100, reward: 30,
    fmt: v => `${formatNum(v)} 个`,
  },
  {
    id: 'npcWin', name: '百战百胜', desc: '累计战胜 NPC 训练家',
    metric: d => d.stats.totalNpcWins || 0, base: 1, reward: 30,
    fmt: v => `${formatNum(v)} 次`,
  },
  {
    id: 'bounty', name: '赏金猎人', desc: '累计完成地区悬赏',
    metric: d => d.stats.totalBountyClaims || 0, base: 1, reward: 50,
    fmt: v => `${formatNum(v)} 次`,
  },
  {
    id: 'npcElite', name: '精英猎人', desc: '累计战胜精英 NPC 训练家',
    metric: d => d.stats.totalNpcEliteWins || 0, base: 1, reward: 60,
    fmt: v => `${formatNum(v)} 次`,
  },
  {
    id: 'npcChampion', name: '冠军挑战者', desc: '累计战胜冠军 NPC 训练家',
    metric: d => d.stats.totalNpcChampionWins || 0, base: 1, reward: 120,
    fmt: v => `${formatNum(v)} 次`,
  },
  {
    id: 'dex', name: '图鉴收藏家', desc: '图鉴中累计捕获不同种类',
    metric: () => dexCount(), base: 10, reward: 30, maxTiers: 7,
    // 满级阈值对齐当前全图鉴 1403 种，最后一级 1403
    tiers: [10, 20, 50, 100, 200, 500, 1403],
    // 不改 formatNum：避免 1.3K 缩写，图鉴进度显示具体数字
    fmt: v => `${Number(v)} 种`,
  },
  {
    id: 'shinyCaught', name: '闪光收藏家', desc: '累计捕获闪光宝可梦',
    metric: d => d.stats.totalShinyCaught || 0, base: 1, reward: 100,
    fmt: v => `${formatNum(v)} 只`,
  },
  {
    id: 'cardCollect', name: '卡牌收藏家', desc: '累计收集卡牌种类',
    metric: () => {
      if (!gameData.collectedCards) return 0;
      return Object.keys(gameData.collectedCards).length;
    }, base: 5, reward: 50, maxTiers: 7,
    // 满级阈值对齐全部卡牌 60 张（抽卡机 1、2 号池各 30 张），最后一级 60
    tiers: [5, 10, 20, 30, 40, 50, 60],
    fmt: v => `${formatNum(v)} 种`,
  },
];

function ensureAchievements() {
  if (!gameData.achievements) gameData.achievements = {};
}

// 某成就已领取的等级数
export function claimedTiers(id) {
  ensureAchievements();
  return gameData.achievements[id] || 0;
}

// 第 n 级（0 起）的 { threshold, reward }：默认 threshold/reward = base×nice、reward = reward×nice；
// 成就自带 tiers 数组时（如图鉴满级对齐全图鉴数），阈值用自定义值，reward 取相邻默认档
function tierAt(a, n) {
  if (a.tiers) {
    const threshold = a.tiers[n] ?? a.tiers[a.tiers.length - 1];
    const k = niceValue(n);
    return { threshold, reward: a.reward * k };
  }
  const k = niceValue(n);
  return { threshold: a.base * k, reward: a.reward * k };
}

// 是否有未领取的成就奖励（供手机"成就"app 及标题栏手机图标红点使用）
export function hasClaimableAchievements() {
  ensureAchievements();
  return ACHIEVEMENTS.some(a => {
    const claimed = gameData.achievements[a.id] || 0;
    if (a.maxTiers != null && claimed >= a.maxTiers) return false; // 已达成全部，不再提示
    return earnedTiers(a) > claimed;
  });
}

// 当前值达标的总等级数（逐级累加，阈值按乘法增长，循环次数很少）
export function earnedTiers(a) {
  const v = a.metric(gameData) || 0;
  let n = 0;
  while (tierAt(a, n).threshold <= v) {
    n++;
    if (n > 100000) break; // 安全阀，正常到不了
  }
  return n;
}

// 一键领取全部
// 点任意一个「领取」按钮都会走这里。循环领取直到不再有新达标：
// 领取会发放糖果，可能联动解锁「糖果富翁」，因此发糖后需重新评估再领一轮。
export function claimAllAchievements() {
  ensureAchievements();
  let total = 0;
  while (true) {
    let round = 0; // 本轮领取的糖果
    for (const a of ACHIEVEMENTS) {
      const earned = earnedTiers(a);
      let claimed = gameData.achievements[a.id] || 0;
      while (earned > claimed) {
        if (a.maxTiers != null && claimed >= a.maxTiers) break; // 图鉴类已达上限，不再继续
        round += tierAt(a, claimed).reward;
        gameData.achievements[a.id] = claimed + 1;
        claimed++;
      }
    }
    if (round === 0) break; // 本轮没有任何可领 → 结束
    total += round;
    gameData.items['candy'] = (gameData.items['candy'] || 0) + round;
    // 计入「道具累计获得」，与商店/悬赏等来源口径一致
    gameData.stats.totalItemsEarned = gameData.stats.totalItemsEarned || {};
    gameData.stats.totalItemsEarned.candy = (gameData.stats.totalItemsEarned.candy || 0) + round;
    // 糖果入账后「糖果富翁」可能新达标，进入下一轮继续领
  }
  if (total > 0) {
    saveGame();
    updateBackpack('candy');
    updateStats();
    // 通知手机"成就"app 红点刷新（领取后可能仍有剩余可领或全部领完）
    window.dispatchEvent(new Event('achievements-changed'));
  }
  return total;
}

function buildItem(a) {
  ensureAchievements();
  const v = a.metric(gameData) || 0;
  const earned = earnedTiers(a);
  const claimed = gameData.achievements[a.id] || 0;
  const claimable = earned - claimed;
  const done = a.maxTiers != null && claimed >= a.maxTiers;
  const tier = tierAt(a, claimed);
  const pct = done ? 100 : Math.min(99, Math.floor((v / tier.threshold) * 100));
  // 糖果图标 + 数量放在按钮左侧（按钮外），右侧统一「领取」
  const rewardHTML = `<span class="ach-reward">${CANDY_ICON}×${formatNum(tier.reward)}</span>`;
  const btnHTML = done ? '已达成全部' : '领取';
  return `
    <div class="ach-item" data-ach="${a.id}">
      <div class="ach-top">
        <span class="ach-name">${a.name}</span>
        <span class="ach-prog">${done ? '★ 已完成' : `${a.fmt(v)} / ${a.fmt(tier.threshold)}`}</span>
      </div>
      <div class="ach-bar"><div class="ach-bar-fill" style="width:${pct}%"></div></div>
      <div class="ach-bottom">
        <span class="ach-desc">${a.desc}</span>
        <div class="ach-actions">
          ${done ? '' : rewardHTML}
          <button class="ach-btn ${claimable > 0 && !done ? 'ach-btn-ready' : ''}" data-ach="${a.id}" ${claimable > 0 && !done ? '' : 'disabled'}>${btnHTML}</button>
        </div>
      </div>
    </div>`;
}

// 整页渲染成就区（打开成就页 / 领取后重建）
export function renderAchievements() {
  const wrap = document.getElementById('achievementList');
  if (!wrap) return;
  ensureAchievements();
  const claimedAll = ACHIEVEMENTS.reduce((s, a) => s + (gameData.achievements[a.id] || 0), 0);
  wrap.innerHTML = `
    <div class="ach-head">
      <span>成就奖励</span>
      <span class="ach-summary">已领取 ${claimedAll} 级奖励</span>
    </div>
    ${ACHIEVEMENTS.map(buildItem).join('')}
  `;
  wrap.querySelectorAll('.ach-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      claimAllAchievements();
      renderAchievements();
    });
  });
}

// 轻量刷新（统计页每秒定时器调用）：只更新数值/进度条/按钮状态，不重建 DOM
export function refreshAchievements() {
  const wrap = document.getElementById('achievementList');
  if (!wrap) return;
  const claimedAll = ACHIEVEMENTS.reduce((s, a) => s + (gameData.achievements[a.id] || 0), 0);
  const sum = wrap.querySelector('.ach-summary');
  if (sum) sum.textContent = `已领取 ${claimedAll} 级奖励`;
  for (const a of ACHIEVEMENTS) {
    const item = wrap.querySelector(`.ach-item[data-ach="${a.id}"]`);
    if (!item) continue;
    const v = a.metric(gameData) || 0;
    const earned = earnedTiers(a);
    const claimed = gameData.achievements[a.id] || 0;
    const claimable = earned - claimed;
    const done = a.maxTiers != null && claimed >= a.maxTiers;
    const tier = tierAt(a, claimed);
    const pct = done ? 100 : Math.min(99, Math.floor((v / tier.threshold) * 100));
    const prog = item.querySelector('.ach-prog');
    if (prog) prog.textContent = done ? '★ 已完成' : `${a.fmt(v)} / ${a.fmt(tier.threshold)}`;
    const bar = item.querySelector('.ach-bar-fill');
    if (bar) bar.style.width = pct + '%';
    const rewardEl = item.querySelector('.ach-reward');
    if (rewardEl) {
      if (done) rewardEl.style.display = 'none';
      else {
        rewardEl.style.display = '';
        rewardEl.innerHTML = `${CANDY_ICON}×${formatNum(tier.reward)}`;
      }
    }
    const btn = item.querySelector('.ach-btn');
    if (btn) {
      if (done) {
        btn.innerHTML = '已达成全部';
        btn.classList.remove('ach-btn-ready');
        btn.disabled = true;
      } else {
        btn.innerHTML = '领取';
        if (claimable > 0) {
          btn.classList.add('ach-btn-ready');
          btn.disabled = false;
        } else {
          btn.classList.remove('ach-btn-ready');
          btn.disabled = true;
        }
      }
    }
  }
}
