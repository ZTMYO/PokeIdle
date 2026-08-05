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
   子页面渲染（左导航 + 右详情，复刻游戏内教程视图）
   ============================================================ */
let pageEl = null;
let listEl = null;
let contentEl = null;

export function initTutorial() {
  pageEl = document.getElementById('tutorialPage');
  listEl = document.getElementById('tutList');
  contentEl = document.getElementById('tutContent');

  document.getElementById('openTutorialBtn')?.addEventListener('click', openTutorial);
  document.getElementById('tutClose')?.addEventListener('click', closeTutorial);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pageEl && !pageEl.hidden) closeTutorial();
  });

  // 左侧章节导航
  if (listEl) {
    listEl.innerHTML = TUTORIAL_DATA.map((s, i) =>
      `<div class="tut-nav-item" data-i="${i}">${s.title}</div>`).join('');
    listEl.onclick = e => {
      const item = e.target.closest('.tut-nav-item');
      if (!item) return;
      renderTutorial(Number(item.dataset.i));
    };
    // 滚轮快速滚动导航（横向 wrap 时不拦截）
    listEl.onwheel = e => {
      if (listEl.scrollHeight <= listEl.clientHeight) return;
      e.preventDefault();
      listEl.scrollTop += e.deltaY * 0.35;
    };
  }
}

function renderTutorial(idx) {
  if (!TUTORIAL_DATA.length || !contentEl) return;
  const s = TUTORIAL_DATA[idx] || TUTORIAL_DATA[0];
  contentEl.innerHTML = `<p class="tut-title">${s.title}</p>` + s.html;
  listEl?.querySelectorAll('.tut-nav-item').forEach((el, i) => el.classList.toggle('active', i === idx));
  contentEl.scrollTop = 0;
}

export function openTutorial() {
  if (!pageEl) return;
  pageEl.hidden = false;
  document.body.style.overflow = 'hidden';
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
  document.body.style.overflow = '';
}
