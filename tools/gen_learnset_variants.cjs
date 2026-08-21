// 重新生成全部变体的 learnset：按 form 匹配素材包数据，修复变体错用"一般"形态招式的问题。
// 等级转换：— / 进化 → 1，回忆 → 过滤（与本体一致）
const fs = require('fs');
const path = require('path');
const PK = 'src/pokemon-data/pokedex.json';
const LK = 'src/pokemon-data/learnset.json';
const MK = 'src/pokemon-data/moves.json';
const P = 'D:/zc/游戏开发素材包/pokemon-dataset-zh-main/data/pokemon';

const pokedex = JSON.parse(fs.readFileSync(PK, 'utf8'));
const learnset = JSON.parse(fs.readFileSync(LK, 'utf8'));
const moves = JSON.parse(fs.readFileSync(MK, 'utf8'));

// name → id 反查（id2name 是 id→name，反转，冲突取第一个）
const name2id = {};
for (const [id, name] of Object.entries(moves.id2name)) {
  if (!(name in name2id)) name2id[name] = Number(id);
}
const idOf = name => name2id[name] ?? null;

// form 关键词双向包含匹配（去掉"的样子/形态"后缀，支持"红、蓝条纹"合并 form）
function cleanForm(f) {
  return String(f || '').replace(/的样子$/, '').replace(/形态$/, '').replace(/模式$/, '');
}
function formMatch(pForm, sForm) {
  if (!pForm || !sForm) return false;
  if (pForm === sForm) return true;
  const part = pForm.includes('-') ? pForm.split('-')[1] : pForm;
  const p = cleanForm(part || pForm);
  const s = cleanForm(sForm);
  if (p === s) return true;
  if (p.includes(s) || s.includes(p)) return true;
  const segs = s.split(/[、,，和及\/]/);
  if (segs.some(x => x && (p.includes(x) || x.includes(p)))) return true;
  return false;
}

// 选中素材包数组中对应 form 的下标，匹配失败返回 -1
function pickFormIdx(arr, pForm, n) {
  if (!Array.isArray(arr) || arr.length === 0) return -1;
  const byForm = arr.findIndex(f => formMatch(pForm, f.form));
  if (byForm !== -1) return byForm;
  // 下标兜底（forms/learnable 基本按顺序对应）
  if (n >= 0 && n < arr.length && arr[n].form !== '一般') return n;
  return -1;
}

// 招式条目 → id（跳过匹配不到或未实现的）
function toIds(items, mvMap) {
  const ids = [];
  for (const d of items) {
    const id = idOf(d.name);
    if (id === null) continue;
    ids.push(id);
  }
  return ids;
}

const files = fs.readdirSync(P);
const variants = Object.values(pokedex).filter(e => e && e.index && e.index.includes('-'));
let rebuilt = 0, noForm = 0, missingFile = 0;

for (const e of variants) {
  const idx = e.index;
  const [base, ns] = idx.split('-');
  const n = parseInt(ns, 10);
  const file = files.find(f => f.startsWith(base + '-'));
  if (!file) { missingFile++; continue; }
  const j = JSON.parse(fs.readFileSync(path.join(P, file), 'utf8'));

  // 按 form 匹配三个数组
  const li = pickFormIdx(j.learnable_moves, e.form, n);
  const mi = pickFormIdx(j.machine_moves, e.form, n);
  const ei = pickFormIdx(j.egg_moves, e.form, n);

  if (li === -1 && mi === -1 && ei === -1) { noForm++; continue; }

  const lv = [], tm = [], egg = [];
  const baseEntry = learnset[base];
  if (li !== -1) {
    for (const d of j.learnable_moves[li].data) {
      const id = idOf(d.name);
      if (id === null) continue;
      const lvlStr = String(d.level);
      if (lvlStr === '回忆') continue; // 回忆招式本体不收录
      const lvl = ['—', '进化'].includes(lvlStr) || lvlStr === '' ? 1 : Number(lvlStr);
      lv.push([lvl, id]);
    }
  } else if (baseEntry) {
    lv.push(...(baseEntry.lv || []).map(x => [x[0], x[1]]));
  }
  // tm/egg 匹配不到对应 form 时兜底用本体数据，避免空列表
  if (mi !== -1) tm.push(...toIds(j.machine_moves[mi].data));
  else if (baseEntry) tm.push(...(baseEntry.tm || []));
  if (ei !== -1) egg.push(...toIds(j.egg_moves[ei].data));
  else if (baseEntry) egg.push(...(baseEntry.egg || []));

  // 全部匹配失败则保留原样（复制本体场景），避免覆盖成空数据
  if (li === -1 && lv.length === 0 && tm.length === 0 && egg.length === 0) { noForm++; continue; }

  learnset[idx] = { lv, tm, egg };
  rebuilt++;
}

// 无独立形态数据的纯外观变体（未知图腾/彩粉蝶/花蓓蓓/多丽米亚/阿尔宙斯等）：复制本体
const pure = variants.filter(e => {
  const idx = e.index;
  const base = idx.split('-')[0];
  const file = files.find(f => f.startsWith(base + '-'));
  if (!file) return true;
  const j = JSON.parse(fs.readFileSync(path.join(P, file), 'utf8'));
  return pickFormIdx(j.learnable_moves, e.form, parseInt(idx.split('-')[1], 10)) === -1 &&
         pickFormIdx(j.machine_moves, e.form, parseInt(idx.split('-')[1], 10)) === -1 &&
         pickFormIdx(j.egg_moves, e.form, parseInt(idx.split('-')[1], 10)) === -1;
});
for (const e of pure) {
  const base = e.index.split('-')[0];
  if (learnset[base]) learnset[e.index] = JSON.parse(JSON.stringify(learnset[base]));
}
fs.writeFileSync(LK, JSON.stringify(learnset));
console.log(`variants=${variants.length} rebuilt=${rebuilt} noForm=${noForm} missingFile=${missingFile} copiedBase=${pure.length}`);
