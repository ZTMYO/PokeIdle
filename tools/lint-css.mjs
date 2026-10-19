// ===== CSS 清洗体检 =====
// 扫游戏样式表，出四类报告：
//   1. 死代码：源码里找不到引用的 class、没人用的 @keyframes
//   2. 硬编码颜色：跟主题变量肉眼分不出的（CIEDE2000 色差 < 2），建议收敛成变量
//   3. 重复：完全一样的规则块、同一条规则里重复写的属性
//   4. !important 用量
//
// 用法（项目根目录）：
//   node tools/lint-css.mjs                    只出报告
//   node tools/lint-css.mjs --fix              自动替换 A 类硬编码色（值与变量完全一致、且不与其他变量歧义）
//   node tools/lint-css.mjs --fix-dead         删除死 class 所在规则与死 @keyframes（建议先跑一遍看清单）
//   node tools/lint-css.mjs --json out.json    额外导出一份 JSON 清单
//   node tools/lint-css.mjs --de 3             调色差阈值（默认 2）
//
// 动态 class 说明：源码里 tier-${x}、'fx-' + st 这类拼接无法静态还原，
// 工具会按「动态前缀」豁免，单独列出来供人工核对，不计入死代码。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const FIX = has('--fix');
const FIX_DEAD = has('--fix-dead');
const JSON_OUT = argOf('--json', '');
const DE_MAX = parseFloat(argOf('--de', '2'));

const CSS_FILES = ['src/styles.css', 'src/battle-fx.css'];
const SRC_DIRS = ['src', 'web/src', 'mobile'];
const SKIP = /(node_modules|\.git|[\\/]dist[\\/]|[\\/]\.gradle-home[\\/]|res-manifest|package-lock|pokemon-4dir|assets[\\/])/;
const SCAN_EXT = /\.(js|mjs|html|json)$/;

// ---------- 颜色 ----------
function parseColor(raw) {
  const s = raw.trim().toLowerCase();
  let m;
  if ((m = s.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a };
  }
  if ((m = s.match(/^rgba?\(([^)]+)\)$/))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const num = (v, max) => (v.endsWith('%') ? (parseFloat(v) / 100) * max : parseFloat(v));
    const r = num(p[0], 255), g = num(p[1], 255), b = num(p[2], 255);
    const a = p[3] !== undefined ? (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1;
    if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
    return { r, g, b, a };
  }
  return null;
}

function rgb2lab({ r, g, b }) {
  const f = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const k = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = k(X); Y = k(Y); Z = k(Z);
  return { L: 116 * Y - 16, a: 500 * (X - Y), b: 200 * (Y - Z) };
}

// CIEDE2000：比欧氏距离更贴合人眼「分不分得出来」
function de2000(p, q) {
  const [L1, a1, b1] = [p.L, p.a, p.b];
  const [L2, a2, b2] = [q.L, q.a, q.b];
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hue = (x, y) => { if (x === 0 && y === 0) return 0; let h = Math.atan2(y, x) * 180 / Math.PI; return h < 0 ? h + 360 : h; };
  const hp1 = hue(ap1, b1), hp2 = hue(ap2, b2);
  const dLp = L2 - L1, dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) { dhp = hp2 - hp1; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dhp * Math.PI / 360);
  const Lbp = (L1 + L2) / 2, Cbp = (Cp1 + Cp2) / 2;
  let hbp;
  if (Cp1 * Cp2 === 0) hbp = hp1 + hp2;
  else { const d = Math.abs(hp1 - hp2); hbp = d <= 180 ? (hp1 + hp2) / 2 : (hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2); }
  const rad = (d) => d * Math.PI / 180;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.20 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}

const normHex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') + (c.a < 0.999 ? Math.round(c.a * 255).toString(16).padStart(2, '0') : '');

// ---------- CSS 规则扫描 ----------
function scanRules(css) {
  const rules = [];
  const stack = [];
  let i = 0, bufStart = 0, line = 1;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '\n') line++;
    else if (ch === '{') {
      const raw = css.slice(bufStart, i);
      const sel = raw.trim().replace(/\s+/g, ' ');
      const selLine = line - (raw.match(/\n/g) || []).length;
      stack.push({ sel, line: selLine, start: i + 1, bodyLine: line, selStart: bufStart, selAbs: bufStart + (raw.length - raw.trimStart().length) });
      bufStart = i + 1;
    } else if (ch === '}') {
      const top = stack.pop();
      if (top) rules.push({ sel: top.sel, line: top.line, bodyStart: top.start, bodyLine: top.bodyLine, body: css.slice(top.start, i), depth: stack.length + 1, parent: stack.map((s) => s.sel).join(' '), selStart: top.selStart, selAbs: top.selAbs, end: i });
      bufStart = i + 1;
    } else if (ch === ';' && stack.length === 0) bufStart = i + 1;
    i++;
  }
  return rules;
}

// ---------- 读源码文本 ----------
function walk(dir, out = []) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && SCAN_EXT.test(e.name)) out.push(p);
  }
  return out;
}

const srcFiles = SRC_DIRS.flatMap((d) => walk(resolve(ROOT, d)));
const srcBlob = srcFiles.map((p) => readFileSync(p, 'utf8')).join('\n');

// 动态拼接前缀：`tier-${x}` / 'b-proj-fx proj-' + shape  →  收集 "xxx-"
// 取 ${ 或引号前那个以 - 结尾的标识符（stage-${x}、'b-type-fx tf-' + s 都能取到）
const dynPrefixes = new Set();
const PREFIX = /([A-Za-z][A-Za-z0-9_-]*-)/;
for (const m of srcBlob.matchAll(new RegExp(`${PREFIX.source}\\$\\{`, 'g'))) dynPrefixes.add(m[1]);
for (const m of srcBlob.matchAll(new RegExp(`${PREFIX.source}['"\`]\\s*\\+`, 'g'))) dynPrefixes.add(m[1]);
for (const m of srcBlob.matchAll(new RegExp(`\\+\\s*['"\`]${PREFIX.source}['"\`]`, 'g'))) dynPrefixes.add(m[1]);

const usedInSrc = (name) => new RegExp(`(?<![\\w-])${name.replace(/[-]/g, '\\-')}(?![\\w-])`).test(srcBlob);
const dynHit = (name) => [...dynPrefixes].find((p) => name.startsWith(p));

// ---------- 逐文件分析 ----------
const css = {};
for (const f of CSS_FILES) {
  const text = readFileSync(resolve(ROOT, f), 'utf8');
  const noComment = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  css[f] = { text, noComment, rules: scanRules(noComment) };
}

// 变量表：name -> { root, dark, twist, voyage }
const scopeOf = (sel) => {
  if (/:root/.test(sel)) return 'root';
  if (/data-theme\s*=\s*["']dark["']/.test(sel)) return 'dark';
  if (/twist-active/.test(sel)) return 'twist';
  if (/voyage/.test(sel)) return 'voyage';
  return null;
};
const vars = {};
for (const f of CSS_FILES) {
  for (const r of css[f].rules) {
    const sc = scopeOf(r.sel);
    if (!sc) continue;
    for (const m of r.body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      const c = parseColor(m[2]);
      if (!c) continue;
      (vars[m[1]] ||= {})[sc] = c;
    }
  }
}
const varNames = Object.keys(vars);

// 硬编码颜色出现点（只算真正用色的声明；变量定义 --x: <色> 不算，url() 里的不算）
const colorHits = [];  // { file, line, sel, scope, value, abs, len, fallback }
const hexRe = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;
const declRe = /([a-zA-Z-][\w-]*)\s*:\s*([^;{}]+)/g;
for (const f of CSS_FILES) {
  for (const r of css[f].rules) {
    if (r.sel.startsWith('@') || r.body.includes('{')) continue;  // @ 规则(@keyframes/@property…)与容器规则交给内层
    const sc = scopeOf(r.sel) || scopeOf(r.parent) || 'root';
    for (const d of r.body.matchAll(declRe)) {
      if (d[1].startsWith('--')) continue;
      const val = d[2].replace(/url\([^)]*\)/g, (m) => m.replace(/[^\n]/g, ' '));
      const valAt = d.index + (d[0].length - d[2].length);
      for (const m of val.matchAll(hexRe)) {
        const raw = m[0];
        const c = parseColor(raw);
        if (!c) continue;
        const inBody = valAt + m.index;
        const before = r.body.slice(Math.max(0, inBody - 40), inBody);
        if (/var\([^)]*$/.test(before)) continue;   // var(--x, #兜底) 本身就是变量写法，不算硬编码
        const line = r.bodyLine + (r.body.slice(0, inBody).match(/\n/g) || []).length;
        colorHits.push({ file: f, line, sel: r.sel, scope: sc, value: normHex(c), raw, lab: rgb2lab(c), alpha: c.a, abs: r.bodyStart + inBody, len: raw.length });
      }
    }
  }
}

// ---------- 1. 死 class ----------
const cssClasses = new Map(); // name -> [{file,line}]
for (const f of CSS_FILES) {
  for (const r of css[f].rules) {
    if (r.sel.startsWith('@')) continue;
    for (const m of r.sel.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) {
      const name = m[1];
      if (!cssClasses.has(name)) cssClasses.set(name, []);
      cssClasses.get(name).push({ file: f, line: r.line });
    }
  }
}
const deadClasses = [], dynClasses = [];
for (const [name, locs] of cssClasses) {
  if (usedInSrc(name)) continue;
  const p = dynHit(name);
  if (p) dynClasses.push({ name, prefix: p, loc: locs[0] });
  else deadClasses.push({ name, loc: locs[0], count: locs.length });
}
deadClasses.sort((a, b) => a.name.localeCompare(b.name));
const dynByPrefix = {};
for (const d of dynClasses) (dynByPrefix[d.prefix] ||= []).push(d.name);

// ---------- 2. 死 keyframes ----------
const keyframes = [];
for (const f of CSS_FILES) {
  for (const r of css[f].rules) {
    const m = r.sel.match(/^@keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)$/);
    if (m) keyframes.push({ name: m[1], file: f, line: r.line });
  }
}
const allCss = CSS_FILES.map((f) => css[f].noComment).join('\n');
const deadKeyframes = [], dynKeyframes = [];
for (const k of keyframes) {
  const re = new RegExp(`(?<![\\w-])${k.name}(?![\\w-])`, 'g');
  const defCount = (allCss.match(re) || []).length;
  const usedInJs = new RegExp(`(?<![\\w-])${k.name}(?![\\w-])`).test(srcBlob);
  if (defCount > 1 || usedInJs) continue;
  const p = dynHit(k.name);
  if (p) dynKeyframes.push({ ...k, prefix: p });
  else deadKeyframes.push(k);
}

// ---------- 3. 硬编码色 → 变量 ----------
const colorGroups = new Map(); // value -> { hits:[], lab, alpha }
for (const h of colorHits) {
  if (!colorGroups.has(h.value)) colorGroups.set(h.value, { hits: [], lab: h.lab, alpha: h.alpha });
  colorGroups.get(h.value).hits.push(h);
}
const colorSuggest = []; // { value, count, var, de, cls, why, hits }
for (const [value, g] of colorGroups) {
  const cands = [];
  for (const vn of varNames) {
    const def = vars[vn];
    if (!def.root) continue;
    if (Math.abs(def.root.a - g.alpha) > 0.01) continue;   // 透明度不同就别硬套
    const de = de2000(g.lab, rgb2lab(def.root));
    if (de < DE_MAX) cands.push({ vn, de, def });
  }
  if (!cands.length) continue;
  cands.sort((a, b) => a.de - b.de);
  const best = cands[0];
  const exact = best.de < 0.5;                       // 值几乎完全一样
  const special = g.hits.some((h) => h.scope !== 'root');
  const ambiguous = cands.length > 1;
  const themed = !!(best.def.dark || best.def.twist || best.def.voyage);
  const cls = exact && !special && !ambiguous ? 'A' : 'B';
  const why = !exact ? `近似色 ΔE=${best.de.toFixed(2)}`
    : ambiguous ? `多个变量都够格：${cands.map((c) => c.vn).join(' / ')}`
      : special ? '落在特殊主题作用域里'
        : themed ? '亮色下完全一致，暗色下跟着主题走' : '任何主题下都不变';
  colorSuggest.push({ value, count: g.hits.length, var: best.vn, de: best.de, cls, why, cands: cands.map((c) => c.vn), hits: g.hits });
}
colorSuggest.sort((a, b) => a.cls.localeCompare(b.cls) || a.de - b.de);

// ---------- 4. 重复规则块 / 重复声明 ----------
const blockMap = new Map();
for (const f of CSS_FILES) {
  for (const r of css[f].rules) {
    if (r.sel.startsWith('@') || /^[0-9]+%$|^from$|^to$/.test(r.sel)) continue;
    const key = r.sel + '||' + r.body.replace(/\s+/g, ' ').trim();
    if (!blockMap.has(key)) blockMap.set(key, []);
    blockMap.get(key).push({ file: f, line: r.line });
  }
}
const dupBlocks = [...blockMap.values()].filter((v) => v.length > 1);

const dupDecls = [];
for (const f of CSS_FILES) {
  for (const r of css[f].rules) {
    if (r.sel.startsWith('@') || r.body.includes('{')) continue;
    const seen = new Map();
    for (const m of r.body.matchAll(/([a-zA-Z-]+)\s*:\s*([^;]+);/g)) {
      const prop = m[1].trim();
      if (prop.startsWith('--')) continue;
      if (seen.has(prop)) dupDecls.push({ file: f, line: r.line, sel: r.sel, prop });
      else seen.set(prop, 1);
    }
  }
}
const importantCount = (allCss.match(/!important/g) || []).length;

// ---------- 输出 ----------
const rel = (p) => relative(ROOT, p).split(/[\\/]/).join('/');
const out = [];
const P = (s = '') => out.push(s);
const head = (t) => { P(''); P(`== ${t} ==`); };

head(`死 class（源码里找不到引用）  共 ${deadClasses.length} 个`);
for (const d of deadClasses) P(`  .${d.name.padEnd(30)} ${rel(resolve(ROOT, d.loc.file))}:${d.loc.line}${d.count > 1 ? `  (共 ${d.count} 处)` : ''}`);

if (Object.keys(dynByPrefix).length) {
  head('动态拼接豁免（无法静态判定，请人工核对）');
  for (const [p, names] of Object.entries(dynByPrefix)) P(`  ${p}*  →  ${names.join(' ')}`);
}

head(`死 @keyframes  共 ${deadKeyframes.length} 个`);
for (const k of deadKeyframes) P(`  ${k.name.padEnd(30)} ${rel(resolve(ROOT, k.file))}:${k.line}`);
if (dynKeyframes.length) for (const k of dynKeyframes) P(`  (动态) ${k.name}  ← 前缀 ${k.prefix}*`);

const aList = colorSuggest.filter((c) => c.cls === 'A');
const bList = colorSuggest.filter((c) => c.cls === 'B');
head(`硬编码色 → 变量  A 类(安全，可 --fix)  ${aList.length} 组 / B 类(会随主题变)  ${bList.length} 组`);
for (const c of [...aList, ...bList]) {
  const at = c.hits.slice(0, 4).map((h) => `${rel(resolve(ROOT, h.file))}:${h.line}`).join(', ');
  P(`  [${c.cls}] ${c.value.padEnd(9)} ×${String(c.count).padStart(2)}  →  var(${c.var})  ΔE=${c.de.toFixed(2)}  ${c.why}`);
  P(`       ${at}${c.hits.length > 4 ? ` … 共 ${c.hits.length} 处` : ''}`);
}

head(`重复规则块  共 ${dupBlocks.length} 组`);
for (const g of dupBlocks) P(`  ${rel(resolve(ROOT, g[0].file))}:${g[0].line}  与  ${g.slice(1).map((x) => `${rel(resolve(ROOT, x.file))}:${x.line}`).join(', ')}`);

head(`规则内重复声明  共 ${dupDecls.length} 处`);
for (const d of dupDecls.slice(0, 40)) P(`  ${rel(resolve(ROOT, d.file))}:${d.line}  ${d.sel}  →  ${d.prop}`);
if (dupDecls.length > 40) P(`  … 还有 ${dupDecls.length - 40} 处`);

head('!important 用量');
P(`  共 ${importantCount} 处`);

P('');
P(`扫描范围：${CSS_FILES.join(', ')} ｜ 源码 ${srcFiles.length} 个文件 ｜ 色差阈值 ΔE<${DE_MAX}`);

const report = out.join('\n');
console.log(report);

if (JSON_OUT) {
  writeFileSync(resolve(ROOT, JSON_OUT), JSON.stringify({ deadClasses, dynClasses, deadKeyframes, dynKeyframes, colorSuggest, dupBlocks, dupDecls, importantCount }, null, 2));
  console.log(`\nJSON 清单已写入 ${JSON_OUT}`);
}

// ---------- --fix：只动 A 类 ----------
if (FIX) {
  const edits = [];
  for (const c of aList) {
    for (const h of c.hits) {
      edits.push({ file: h.file, abs: h.abs, len: h.len, to: `var(${c.var})`, from: h.raw, line: h.line });
    }
  }
  const byFile = {};
  for (const e of edits) (byFile[e.file] ||= []).push(e);
  let changed = 0;
  for (const f of Object.keys(byFile)) {
    const path = resolve(ROOT, f);
    let text = readFileSync(path, 'utf8');
    const list = byFile[f].sort((a, b) => b.abs - a.abs);
    for (const e of list) {
      if (text.slice(e.abs, e.abs + e.len).toLowerCase() !== e.from.toLowerCase()) continue;
      text = text.slice(0, e.abs) + e.to + text.slice(e.abs + e.len);
      changed++;
    }
    writeFileSync(path, text);
  }
  console.log(`\n--fix 完成：替换 ${changed} 处（仅 A 类，且跳过 var() 的兜底值）`);
}

// ---------- --fix-dead：删死 class 所在规则 + 死 @keyframes ----------
if (FIX_DEAD) {
  const deadNames = new Set(deadClasses.map((d) => d.name));
  const deadKf = new Set(deadKeyframes.map((k) => k.name));
  let removed = 0;
  for (const f of CSS_FILES) {
    const text = readFileSync(resolve(ROOT, f), 'utf8');
    const spans = [];
    for (const r of css[f].rules) {
      const kf = r.sel.match(/^@keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)$/);
      if (kf) {
        if (!deadKf.has(kf[1])) continue;
      } else {
        if (r.sel.startsWith('@') || r.body.includes('{')) continue;
        if (r.sel.includes(':not(')) continue;   // :not(.dead) 照样能命中，不能删
        const names = [...r.sel.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
        if (!names.some((n) => deadNames.has(n))) continue;
      }
      // 整行删掉（选择器可能跨行，从它所在行首删到规则结尾换行），不留空行
      const a = text.lastIndexOf('\n', r.selAbs - 1) + 1;
      let b = r.end + 1;
      if (text[b] === '\n') b++;
      spans.push([a, b]);
      removed++;
    }
    spans.sort((x, y) => y[0] - x[0]);
    let out2 = text;
    for (const [a, b] of spans) out2 = out2.slice(0, a) + out2.slice(b);
    if (out2 !== text) writeFileSync(resolve(ROOT, f), out2);
  }
  console.log(`\n--fix-dead 完成：删除 ${removed} 条规则（死 class ${deadNames.size} 个 / 死 keyframes ${deadKf.size} 个）`);
}
