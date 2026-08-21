// ===== 游戏教程子页面 =====
// 本模块在构建/开发时解析 web/src/ 下的游戏源码副本，把游戏内的教程章节还原到展示页上：
//   1) 用 Vite 的 ?raw 原样导入 web/src/views.js、web/src/team.js 的源码文本；
//   2) 从 views.js 中截取教程代码块（tutorialTable / ITEM_DROP_ROWS /
//      FISH_ITEM_ROWS / rarityWeightBoost / TUTORIAL_SECTIONS）；
//   3) 用真实游戏配置（web/src/config.js 的全部常量 + team.js 解析出的 TEAM_MAX）
//      执行这段代码，还原出教程 HTML——其中的 ${...} 模板占位符会被真实数值替换。
// web/src 下的三份副本由 sync-src.mjs 在每次 npm run dev / build 前自动从 ../src 同步，
// 游戏内教程文案/数值更新后无需手动复制，重新构建即可自动同步。

import viewsSource from './src/views.js?raw';
import teamSource from './src/team.js?raw';
import * as cfg from './src/config.js';

/* ============================================================
   源码解析
   ============================================================ */

// 用括号深度扫描截取从 markStart 起的一个数组字面量。
// 扫描时跳过引号/模板字符串内的内容（含 ${...} 里出现的引号），
// 返回"const TUTORIAL_SECTIONS = [...]"整段（含收尾分号）。
function extractArrayLiteral(src, markStart) {
  const open = src.indexOf('[', markStart);
  if (open < 0) throw new Error('array open bracket not found');
  let depth = 0;
  let quote = null; // '"' / "'" / '`'
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; } // 转义字符跳过
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return src.slice(markStart, i + 1 + (src[i + 1] === ';' ? 1 : 0));
    }
  }
  throw new Error('unbalanced array literal');
}

// 截取 views.js 中从 tutorialTable 到 TUTORIAL_SECTIONS 收尾的整个教程代码块
function extractTutorialCode(src) {
  const helpersStart = src.indexOf('function tutorialTable(');
  const arrayStart = src.indexOf('const TUTORIAL_SECTIONS = [');
  if (helpersStart < 0 || arrayStart < 0 || arrayStart <= helpersStart) {
    throw new Error('tutorial block not found in views.js');
  }
  return src.slice(helpersStart, arrayStart) + extractArrayLiteral(src, arrayStart);
}

// 从 team.js 中解析出 TEAM_MAX 常量（该文件依赖浏览器模块，不能整体导入，只取值）
function extractTeamMax(src) {
  const m = src.match(/export const TEAM_MAX\s*=\s*(\d+)/);
  if (!m) throw new Error('TEAM_MAX not found in team.js');
  return Number(m[1]);
}

/* ============================================================
   还原教程数据（[{ title, html }] 数组）
   ============================================================ */
const scope = { ...cfg, TEAM_MAX: extractTeamMax(teamSource) };
const scopeNames = Object.keys(scope);
let TUTORIAL_DATA = [];
try {
  const tutorialCode = extractTutorialCode(viewsSource);
  // 把全部配置常量作为函数参数注入，教程代码块里的 ${常量} 模板占位符即可真实求值
  const factory = new Function(...scopeNames, `"use strict";\n${tutorialCode}\nreturn TUTORIAL_SECTIONS;`);
  TUTORIAL_DATA = factory(...scopeNames.map(n => scope[n])) || [];
} catch (err) {
  console.error('[tutorial] 教程内容解析失败：', err);
  TUTORIAL_DATA = [];
}

/* ============================================================
   章节图标：列表项前的图标尽量复用游戏内已有的图标（手机应用/功能图标）
   ============================================================ */
const TUT_ICONS = {
  序章: 'icon-send', 目标: 'icon-target', 道具: 'icon-item', 遭遇: 'icon-view',
  手机: 'icon-phone', 图鉴: 'icon-book', 统计: 'icon-data', 成就: 'icon-achievement',
  地区: 'icon-region', 导航: 'icon-gps', 事件: 'icon-event', 悬赏: 'icon-station',
  交换: 'icon-trade', 场景: 'icon-scene', 捕捉: 'icon-owned', 闪光: 'icon-star',
  糖果: 'icon-candy', 商店: 'icon-shop', 增益: 'icon-buff', 孵蛋: 'icon-egg',
  钓鱼: 'icon-fishing', 树果: 'icon-berry', 农场: 'icon-tree', 宝可梦: 'icon-owned',
  配队: 'icon-edit', 训练: 'icon-train', 对战: 'icon-versus', 配招: 'icon-moves', 培育: 'icon-heart',
  混合器: 'icon-mixer', '树果方块': 'icon-poffin', '招募帮手': 'icon-emoji',
  自动操作: 'icon-auto', 佛系模式: 'icon-zen', 系统日志: 'icon-log',
  宝可梦难度: 'icon-type-chart', 状态栏图标: 'icon-pin',
  自行车: 'icon-bike',
  游戏厅: 'icon-casino', '21点': 'icon-blackjack', '口袋麻将': 'icon-mahjong',
  抽卡机: 'icon-album','经验糖果': 'icon-poffin',
  随从: 'icon-follower', 派遣: 'icon-dispatch',
};
const tutIcon = (title) => TUT_ICONS[title] || 'icon-tutorial';
// 判断图标是否为内联 SVG（TUT_ICONS 值以 '<' 开头）而不是 sprite 引用
const isInlineIcon = icon => icon.startsWith('<');
// 生成章节导航图标 HTML：内联 path 直接嵌入 <svg>；sprite id 用 <use> 引用
const navIconHtml = icon => isInlineIcon(icon)
  ? `<svg class="tut-nav-icon" viewBox="0 0 1024 1024" aria-hidden="true">${icon}</svg>`
  : `<svg class="tut-nav-icon" aria-hidden="true"><use href="./sprites.svg#${icon}"/></svg>`;

/* ============================================================
   子页面渲染（左导航 + 右详情，复刻游戏内教程视图）
   ============================================================ */
let pageEl = null;
let listEl = null;
let contentEl = null;
let footEl = null;
let currentIdx = 0;
let searchEl = null;  // 顶部搜索输入框
let dropEl = null;    // 搜索下拉结果容器
let _searchKw = '';   // 当前关键词（跳转后用于正文高亮）

export function initTutorial() {
  pageEl = document.getElementById('tutorialPage');
  listEl = document.getElementById('tutList');
  contentEl = document.getElementById('tutContent');
  footEl = document.getElementById('tutFoot');

  document.getElementById('openTutorialBtn')?.addEventListener('click', openTutorial);
  document.getElementById('tutClose')?.addEventListener('click', closeTutorial);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pageEl && !pageEl.hidden) {
      if (pageEl.classList.contains('sidebar-open')) pageEl.classList.remove('sidebar-open');
      else closeTutorial();
    }
  });

  // 移动端：menu 按钮展开侧边栏，点遮罩收起
  document.getElementById('tutMenu')?.addEventListener('click', () => pageEl?.classList.add('sidebar-open'));
  document.getElementById('tutMask')?.addEventListener('click', () => pageEl?.classList.remove('sidebar-open'));

  // 左侧章节导航
  if (listEl) {
    listEl.innerHTML = TUTORIAL_DATA.map((s, i) =>
      `<div class="tut-nav-item" data-i="${i}">${navIconHtml(tutIcon(s.title))}<span class="tut-nav-text">${s.title}</span></div>`).join('');
    listEl.onclick = e => {
      const item = e.target.closest('.tut-nav-item');
      if (!item) return;
      renderTutorial(Number(item.dataset.i));
      // 移动端选完章节后收起侧边栏
      pageEl?.classList.remove('sidebar-open');
    };
    // 滚轮快速滚动导航（横向 wrap 时不拦截）
    listEl.onwheel = e => {
      if (listEl.scrollHeight <= listEl.clientHeight) return;
      e.preventDefault();
      listEl.scrollTop += e.deltaY * 0.35;
    };
  }

  // 底部固定栏"下一节"按钮（事件委托，footer 每次重绘后仍有效）
  footEl?.addEventListener('click', e => {
    const btn = e.target.closest('[data-next]');
    if (!btn || btn.disabled) return;
    renderTutorial(currentIdx + 1);
  });

  // 「详见『xx』章节」交叉引用：点击跳转到对应章节
  contentEl?.addEventListener('click', e => {
    const ref = e.target.closest('.tut-ref');
    if (!ref) return;
    const idx = TUTORIAL_DATA.findIndex(s => s.title === ref.dataset.tutRef);
    if (idx >= 0) renderTutorial(idx);
  });

  // 关键词搜索：输入时防抖过滤，下拉左侧章节名 / 右侧含关键词句子摘录
  searchEl = document.getElementById('tutSearchInput');
  dropEl = document.getElementById('tutSearchDrop');
  const clearEl = document.getElementById('tutSearchClear');
  if (searchEl && dropEl) {
    const index = buildSearchIndex();
    let deb = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => onSearchInput(index, clearEl), 120);
    });
    searchEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { searchEl.value = ''; _searchKw = ''; if (clearEl) clearEl.hidden = true; closeSearchDrop(); }
      if (e.key === 'Enter') { // 回车直接跳到第一个结果
        const first = dropEl.querySelector('.tut-search-item');
        if (first) first.click();
      }
    });
    clearEl?.addEventListener('click', () => {
      searchEl.value = '';
      _searchKw = '';
      clearEl.hidden = true;
      closeSearchDrop();
      searchEl.focus();
    });
    // 先于 blur 触发点击，避免下拉先关闭导致点不中
    dropEl.addEventListener('mousedown', e => e.preventDefault());
    dropEl.addEventListener('click', e => {
      const item = e.target.closest('.tut-search-item');
      if (!item) return;
      _searchKw = searchEl.value.trim().toLowerCase();
      renderTutorial(Number(item.dataset.idx));
      closeSearchDrop();
    });
    document.addEventListener('click', e => {
      if (dropEl.hidden) return;
      if (!searchEl.contains(e.target) && !dropEl.contains(e.target)) closeSearchDrop();
    });
  }
}

// 把章节 HTML 转纯文本后按句号/换行拆句，供搜索按句子摘录展示
function buildSearchIndex() {
  return TUTORIAL_DATA.map((s, idx) => {
    const doc = new DOMParser().parseFromString(s.html, 'text/html');
    const text = doc.body.textContent.replace(/\s+/g, ' ').trim();
    const sentences = text.split(/[。！？；\n]/).map(x => x.trim()).filter(Boolean);
    return { idx, title: s.title, sentences };
  });
}

function onSearchInput(index, clearEl) {
  const q = searchEl.value.trim().toLowerCase();
  _searchKw = q || '';
  if (clearEl) clearEl.hidden = !q; // 有输入时显示清空按钮
  if (!q) { closeSearchDrop(); return; }
  const results = [];
  for (const sec of index) {
    for (const sent of sec.sentences) {
      if (sent.toLowerCase().includes(q)) results.push({ idx: sec.idx, title: sec.title, sent });
    }
  }
  if (!results.length) {
    dropEl.innerHTML = `<div class="tut-search-empty">没有找到包含「${searchEl.value}」的内容</div>`;
  } else {
    // 只展示前 20 条；摘录以关键词为中心截取（长句/表格合句从开头取会显示不下）
    dropEl.innerHTML = results.slice(0, 20).map(r => {
      const i = r.sent.toLowerCase().indexOf(q);
      let frag = r.sent;
      if (i >= 0) {
        const s = Math.max(0, i - 8);
        const e = Math.min(r.sent.length, i + q.length + 14);
        const head = s > 0 ? '…' : '';
        const tail = e < r.sent.length ? '…' : '';
        frag = head + r.sent.slice(s, i) + '<mark>' + r.sent.slice(i, i + q.length) + '</mark>' + r.sent.slice(i + q.length, e) + tail;
      }
      return `<div class="tut-search-item" data-idx="${r.idx}"><span class="tut-search-title">${r.title}</span><span class="tut-search-text">${frag}</span></div>`;
    }).join('');
  }
  dropEl.hidden = false;
}

function closeSearchDrop() {
  if (!dropEl) return;
  dropEl.hidden = true;
  dropEl.innerHTML = '';
}

// 正文关键词高亮：遍历文本节点，把命中片段包进 <mark>
function highlightKeyword(root, kw) {
  if (!root || !kw) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const low = node.nodeValue.toLowerCase();
    if (!low.includes(kw)) continue;
    const frag = document.createDocumentFragment();
    const s = node.nodeValue;
    let start = 0;
    while (true) {
      const i = low.indexOf(kw, start);
      if (i < 0) { frag.appendChild(document.createTextNode(s.slice(start))); break; }
      frag.appendChild(document.createTextNode(s.slice(start, i)));
      const mk = document.createElement('mark');
      mk.textContent = s.slice(i, i + kw.length);
      frag.appendChild(mk);
      start = i + kw.length;
    }
    node.replaceWith(frag);
  }
}

// 识别教程文案里的「详见『xx』章节」引用（章节名可能被 <b> 包裹），转为可点击跳转链接
const TUT_REF_RE = /详见「<b>([^<」]+)<\/b>」章节/g;
function linkTutorialRefs(html) {
  return html.replace(TUT_REF_RE, (m, name) =>
    `<a class="tut-ref" data-tut-ref="${name}">详见「${name}」章节</a>`);
}

function renderTutorial(idx) {
  if (!TUTORIAL_DATA.length || !contentEl) return;
  currentIdx = Math.max(0, Math.min(idx, TUTORIAL_DATA.length - 1));
  const s = TUTORIAL_DATA[currentIdx];
  contentEl.innerHTML = linkTutorialRefs(`<p class="tut-title">${s.title}</p>` + s.html);
  highlightKeyword(contentEl, _searchKw); // 从搜索结果跳入时高亮关键词
  listEl?.querySelectorAll('.tut-nav-item').forEach((el, i) => el.classList.toggle('active', i === currentIdx));
  // 左侧导航滚到当前章节可见（PC 侧边栏常驻时交叉引用跳转也能定位）
  const active = listEl?.querySelector('.tut-nav-item.active');
  if (active) {
    const lr = listEl.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    if (ar.top < lr.top) listEl.scrollTop += ar.top - lr.top - 4;
    else if (ar.bottom > lr.bottom) listEl.scrollTop += ar.bottom - lr.bottom + 4;
  }
  contentEl.scrollTop = 0;
  renderFoot();
}

// 底部固定栏：下一节按钮（主文案 + 下一节标题小字）；最后一章显示禁用态
function renderFoot() {
  if (!footEl) return;
  const hasNext = currentIdx < TUTORIAL_DATA.length - 1;
  if (!hasNext) {
    footEl.innerHTML = `<button class="tut-next-btn" type="button" data-next disabled><span class="tut-next-label">已是最后一节</span></button>`;
    return;
  }
  const next = TUTORIAL_DATA[currentIdx + 1];
  footEl.innerHTML = `<button class="tut-next-btn" type="button" data-next><span class="tut-next-label">下一节</span><span class="tut-next-title">${next.title}</span></button>`;
}

export function openTutorial() {
  if (!pageEl) return;
  pageEl.hidden = false;
  pageEl.classList.remove('sidebar-open');
  document.body.style.overflow = 'hidden';
  // 重开教程：清空搜索状态，避免上次关键词继续高亮正文
  _searchKw = '';
  if (searchEl) searchEl.value = '';
  closeSearchDrop();
  if (!TUTORIAL_DATA.length) {
    if (contentEl) contentEl.innerHTML = '<p class="tut-title">教程</p><p>教程内容解析失败，请检查构建环境（src/views.js 是否可读）。</p>';
    return;
  }
  renderTutorial(0);
  if (listEl) listEl.scrollTop = 0;
}

export function closeTutorial() {
  if (!pageEl) return;
  pageEl.hidden = true;
  pageEl.classList.remove('sidebar-open');
  document.body.style.overflow = '';
  _searchKw = '';
  if (searchEl) searchEl.value = '';
  closeSearchDrop();
}
