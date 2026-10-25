// ===== 手机应用注册表 =====
// 桌面顺序存在存档的 phoneLayout 里，这里只描述"应用是什么"：名字、图标、怎么打开、有没有红点。
// available() 为 false 的应用不渲染（例如没有限时活动时的活动入口），但仍留在布局里不删。
import { pushNav, anyIncubatorReady } from './state.js';
import { hasTradableOffers } from './trade.js';
import { hasDryBerries } from './berry.js';
import { hasClaimableAchievements } from './achievements.js';
import { hasUnclaimedTutorialRewards } from './views.js';
import { activityEntries } from './activity.js';
import { hasSchedule } from './server-events.js';

// 红点：返回布尔或 Promise<boolean>（nursery / dispatch 体积大，保持按需加载）
export const APPS = [
  { id: 'gps', name: '导航', icon: 'icon-gps',
    open: () => import('./gps.js').then((m) => { pushNav('gpsView'); m.showGpsView(); }) },
  { id: 'book', name: '图鉴', icon: 'icon-book',
    open: () => import('./pokedex.js').then((m) => m.showPokedex()) },
  { id: 'roster', name: '宝可梦', icon: 'icon-owned',
    open: () => import('./roster.js').then((m) => m.showRosterView()) },
  { id: 'trade', name: '交换', icon: 'icon-trade', dot: hasTradableOffers,
    open: () => import('./trade.js').then((m) => m.showTradeView()) },
  { id: 'incubator', name: '孵蛋器', icon: 'icon-egg', dot: anyIncubatorReady,
    open: () => import('./phone.js').then((m) => m.showIncubatorView()) },
  { id: 'berry', name: '农场', icon: 'icon-tree', dot: hasDryBerries,
    open: () => import('./berry.js').then((m) => m.showBerryView()) },
  { id: 'mixer', name: '混合器', icon: 'icon-mixer',
    open: () => import('./mixer.js').then((m) => m.showMixerView()) },
  { id: 'achievement', name: '成就', icon: 'icon-achievement', dot: hasClaimableAchievements,
    open: () => import('./views.js').then((m) => m.showAchievementView()) },
  { id: 'data', name: '统计', icon: 'icon-data',
    open: () => import('./views.js').then((m) => m.showDataView()) },
  { id: 'tutorial', name: '教程', icon: 'icon-tutorial', dot: hasUnclaimedTutorialRewards,
    open: () => import('./views.js').then((m) => m.showTutorialView()) },
  { id: 'log', name: '日志', icon: 'icon-log',
    open: () => import('./views.js').then((m) => m.showSystemLogs()) },
  { id: 'nursery', name: '饲育屋', icon: 'icon-heart',
    dot: () => import('./nursery.js').then((m) => m.hasNurseryDot()),
    open: () => import('./nursery.js').then((m) => m.showNurseryView()) },
  { id: 'train', name: '训练', icon: 'icon-train',
    open: () => import('./train.js').then((m) => m.showTrainView()) },
  { id: 'team', name: '配队', icon: 'icon-edit',
    open: () => import('./team.js').then((m) => m.showTeamView()) },
  { id: 'battle', name: '对战', icon: 'icon-versus',
    open: () => import('./battle-view.js').then((m) => m.showBattleView()) },
  { id: 'casino', name: '游戏厅', icon: 'icon-casino',
    open: () => import('./casino.js').then((m) => m.showCasinoView()) },
  { id: 'album', name: '卡册', icon: 'icon-album',
    open: () => import('./album.js').then((m) => m.showAlbumView()) },
  { id: 'itembox', name: '道具盒', icon: 'icon-itembox',
    open: () => import('./itembox.js').then((m) => m.showItemBoxView()) },
  { id: 'follower', name: '随从', icon: 'icon-follower',
    open: () => import('./follower.js').then((m) => m.showFollowerView()) },
  { id: 'dispatch', name: '派遣', icon: 'icon-dispatch',
    dot: () => import('./dispatch.js').then((m) => m.hasDispatchRewards()),
    open: () => import('./dispatch.js').then((m) => m.showDispatchView()) },
  // 限时活动不在这里：每个活动各出一个图标，见下面的 dynamicApps()
  // 拿不到排期就不摆这个图标（和限时活动一个口径：没内容别放个点不开的应用）
  { id: 'events', name: '全服事件', icon: 'icon-events', available: hasSchedule,
    open: () => import('./events-view.js').then((m) => m.showEventsView()) },
];

// 表里没有的活动回退到气球
const ACT_ICONS = {
  'mass-bounty': 'icon-station',
  'voyage': 'icon-voyage',
  'poke-flip': 'icon-poke-flip',
  'bird-stack': 'icon-bird-stack',
  'flow-link': 'icon-flow-link',
  'power-flow': 'icon-power-flow',   // 电力输送：闪电图标
  'guess-name': 'icon-guess-name',
  'sweet-workshop': 'icon-sweet-shop',
  'treasure-hunt': 'icon-magnifier',   // 放大镜
  'seal-slide': 'icon-seal-slide',     // 雪花
};

// 限时活动：每个活动各占一个图标（id 前缀 act: + 活动 id，桌面位置各记各的）。
// 活动结束这个 id 就成了未知应用，会被布局对账清掉，下次再开回到列表末尾
function activityApp(appId, actId, name) {
  return {
    id: appId,
    name,
    icon: ACT_ICONS[actId] || 'icon-activity',
    open: () => import('./activity.js').then((m) => m.openActivityById(actId)),
  };
}

export function dynamicApps() {
  return activityEntries().map((e) => activityApp(`act:${e.id}`, e.id, e.name));
}

export function allApps() {
  return [...APPS, ...dynamicApps()];
}

export function appById(id) {
  const fixed = APPS.find((a) => a.id === id);
  if (fixed) return fixed;
  if (!id.startsWith('act:')) return null;   // 固定应用不用翻活动清单，省得每次查都算一遍
  const actId = id.slice(4);
  const e = activityEntries().find((x) => x.id === actId);
  return e ? activityApp(id, actId, e.name) : null;
}

export function appAvailable(a) {
  return !a.available || !!a.available();
}
