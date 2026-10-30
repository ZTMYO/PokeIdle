// ===== 图鉴模块 =====
import { ITEM_NAMES } from './config.js';
import { gameData, allPokemon, getPokemonByIndex, _pokedexSortBy, _pokedexSortDir, pad, pushNav, setPokedexInLogView, setPokedexSortBy, setPokedexSortDir, dexUnlocked, dexShinyOwned, isPokemon } from './state.js';
import { $, showView, getCurrentView, tryLoadPokemonImage, tryLoadImage, setupFoodTooltip, logicViewport, popupBounds, watchOutsidePress } from './ui.js';
import { TYPE_COLORS, BERRY_ICONS, BERRY_NAMES } from './items.js';
import { startShinySparkleOn, stopShinySparkleLoop } from './animation.js';
import { acquireEntries, loadAcquire } from './acquire.js';

const REGION_OPTIONS = ['全部地区', '关都', '城都', '丰缘', '神奥', '合众', '卡洛斯', '阿罗拉', '伽勒尔', '帕底亚'];
const STAR_OUTLINE = '<svg class="pokedex-star-svg" viewBox="2 2 20.2 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.77272 14.5899L5.24822 20.9745C5.1866 21.2304 5.28549 21.498 5.49671 21.6536C5.70873 21.8087 5.99207 21.8238 6.21922 21.6891L11.9527 18.2844L17.6835 21.6891C17.787 21.7505 17.9027 21.7812 18.0178 21.7812C18.1547 21.7812 18.2907 21.7387 18.406 21.6543C18.6173 21.4985 18.7162 21.231 18.6545 20.9752L17.13 14.5905L22.1907 10.3017C22.3931 10.131 22.4721 9.85483 22.3911 9.60288C22.3106 9.35093 22.0855 9.17223 21.8217 9.15074L15.1466 8.59969L12.5534 2.54696C12.4506 2.30605 12.2138 2.15039 11.952 2.15039C11.6902 2.15039 11.4534 2.30605 11.3507 2.54696L8.7555 8.59969L2.08241 9.14997C1.81862 9.17165 1.59348 9.35026 1.51299 9.60226C1.43185 9.85421 1.51107 10.1304 1.7133 10.301L6.77272 14.5899ZM9.25537 9.87121C9.49689 9.85157 9.70763 9.69973 9.80309 9.47651L11.952 4.46477L14.0984 9.47589C14.1938 9.69898 14.4045 9.85095 14.646 9.87044L20.1387 10.3234L15.9763 13.851C15.7878 14.0102 15.7055 14.262 15.763 14.5023L17.022 19.7731L12.2871 16.9599C12.0816 16.837 11.8244 16.837 11.6189 16.9599L6.88149 19.7737L8.14037 14.5023C8.19791 14.262 8.11557 14.0102 7.92708 13.851L3.76593 10.3234L9.25537 9.87121Z" fill="currentColor"></path></svg>';
const STAR_FILLED = '<svg class="pokedex-star-svg" viewBox="2 2 20.2 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.77272 14.5899L5.24822 20.9745C5.1866 21.2304 5.28549 21.498 5.49671 21.6536C5.70873 21.8087 5.99207 21.8238 6.21922 21.6891L11.9527 18.2844L17.6835 21.6891C17.787 21.7505 17.9027 21.7812 18.0178 21.7812C18.1547 21.7812 18.2907 21.7387 18.406 21.6543C18.6173 21.4985 18.7162 21.231 18.6545 20.9752L17.13 14.5905L22.1907 10.3017C22.3931 10.131 22.4721 9.85483 22.3911 9.60288C22.3106 9.35093 22.0855 9.17223 21.8217 9.15074L15.1466 8.59969L12.5534 2.54696C12.4506 2.30605 12.2138 2.15039 11.952 2.15039C11.6902 2.15039 11.4534 2.30605 11.3507 2.54696L8.7555 8.59969L2.08241 9.14997C1.81862 9.17165 1.59348 9.35026 1.51299 9.60226C1.43185 9.85421 1.51107 10.1304 1.7133 10.301L6.77272 14.5899Z" fill="currentColor"></path></svg>';

// 图鉴解锁/稀有度/闪光筛选：与仓库多级筛选一致
// 解锁=已捕获过；普通/神兽按 legend；闪光=抓到过闪光（shinyCaught>0）
let _pokedexStatus = '';   // 一级：''=全部 | unlock | lock
let _pokedexLegend = 'all'; // 二级：all=不限 | normal(普通) | legend(神兽)
let _pokedexShiny = 'all';  // 二级：all=不限 | normal(非闪光) | shiny(闪光)
let _pokedexType = '';     // 属性筛选（''=全部）
let _pokedexBoxView = false; // 盒子（网格）视图：右键菜单切换，选择记到 localStorage
try { _pokedexBoxView = localStorage.getItem('pokedexBoxView') === '1'; } catch (e) {}

// 「图鉴认不认这一条」：遇到过，或已经获得过——孵蛋 / 交换 / 彩蛋 / 进化得到的常常没在野外遇见过
function dexKnown(idx, seen) {
  return (seen || 0) > 0 || dexUnlocked(idx);
}

// 性别比例文案（genderRate: -1 无性别；0-8 雌性概率/8）
function genderRatioText(poke) {
  const rate = poke?.genderRate;
  if (rate === undefined || rate === null) return '';
  if (rate === -1) return '性别：无性别';
  const m = 8 - rate; // 雄性份数
  const f = rate;     // 雌性份数
  if (m === 0) return '性别：全雌性';
  if (f === 0) return '性别：全雄性';
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(m, f);
  return `性别：♂:♀ ${m / g}:${f / g}`;
}

export function formatLogTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function describeLogEntry(log) {
  // 统计使用的球种
  const ballTypes = [];
  for (const [type, count] of Object.entries(log.balls || {})) {
    if (count > 0) ballTypes.push({ type, count });
  }
  const multi = ballTypes.length > 1;
  const ballParts = () => ballTypes.map((b) => `${b.count} 颗${ITEM_NAMES[b.type]}`).join('、');

  // 先看捕获结果：没有丢球记录的捕获（孵化/交换/后台入袋）不能被读成逃跑
  if (log.result === 'caught') {
    if (!ballTypes.length) {
      return log.source === 'trade' ? (log.gave ? `用${log.gave}交换而来` : '通过交换获得') : '通过孵化获得';
    }
    return multi ? `先后消耗 ${ballParts()}后成功捕获` : `仅消耗 ${ballTypes[0].count} 颗${ITEM_NAMES[ballTypes[0].type]}就抓住了`;
  }
  if (log.manual !== undefined) {
    if (!ballTypes.length) return '你直接逃跑了';
    return multi ? `先后消耗 ${ballParts()}后，你选择了逃跑` : `消耗 ${ballTypes[0].count} 颗${ITEM_NAMES[ballTypes[0].type]}后，你选择了逃跑`;
  }
  if (!ballTypes.length) {
    return log.source === 'trade' ? (log.gave ? `用${log.gave}交换而来` : '通过交换获得') : '精灵逃走了';
  }
  return multi ? `消耗 ${ballParts()}，精灵最终逃跑了` : `消耗 ${ballTypes[0].count} 颗${ITEM_NAMES[ballTypes[0].type]}后精灵逃跑了`;
}