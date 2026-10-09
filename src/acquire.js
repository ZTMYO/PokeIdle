import { getPokemonByIndex } from './state.js';

// ===== 获取方式表（pokemon-data/acquire.json，由研究目录 generate-acquire.mjs 生成）=====
// 图鉴详情用：懒加载，第一次用到才取；表没到时返回 null，界面先显示"加载中"
let _data = null;
let _maps = null;      // index → methods[]
let _labels = null;    // 途径 id → 中文名（取自数据里的 sources）
let _loading = null;

export function loadAcquire() {
  if (_data) return Promise.resolve(_data);
  if (!_loading) {
    _loading = fetch('./pokemon-data/acquire.json')
      .then((r) => r.json())
      .then((d) => {
        _data = d;
        _maps = new Map((d.pokemon || []).map((p) => [String(p.index), p.methods || []]));
        _labels = new Map((d.sources || []).map((s) => [s.id, s.label]));
        return d;
      })
      .catch((e) => { _loading = null; throw e; });
  }
  return _loading;
}

const nameOf = (idx) => { const p = getPokemonByIndex(String(idx)); return p ? (p.form || p.name) : `#${idx}`; };
// 雌雄异形的两条形态压成一条（轻飘飘-雄性/雌性）：同一个编号、同一个名字的两条只占一个名额
const parentNames = (list) => {
  const arr = (list || []).map(String);
  const isSexForm = (idx) => /-(雄性|雌性)$/.test(getPokemonByIndex(idx)?.form || '');
  const done = new Set();
  const out = [];
  for (const idx of arr) {
    const base = idx.split('-')[0];
    const sib = isSexForm(idx) && arr.some(o => o !== idx && o.split('-')[0] === base && isSexForm(o));
    if (!sib) { out.push(nameOf(idx)); continue; }
    if (done.has(base)) continue;
    done.add(base);
    out.push(`${getPokemonByIndex(idx).name}-雄性/雌性`);
  }
  return out;
};

// 彩蛋 NPC 藏在交易市场里：对外统一并进「交换」，不点破
const TYPE_ALIAS = { easter_author: 'trade', easter_imiti: 'trade' };

// 图鉴详情用：返回 [{ label, text }]；表还没到时返回 null
export function acquireEntries(idx) {
  const methods = _maps && _maps.get(String(idx));
  if (!methods) return _maps ? [] : null;
  const out = methods.map((m) => {
    const type = TYPE_ALIAS[m.type] || m.type;
    const label = (_labels && _labels.get(type)) || type;
    if (type === 'wild' || type === 'tree') return { label, text: m.region || '' };
    if (type === 'breed') {
      const p = parentNames(m.parents).join('、'), pi = parentNames(m.parentsIncense).join('、');
      let text = p ? `亲本 ${p}` : '';
      if (pi) text += `${text ? '；' : ''}开熏香 ${pi}`;
      if (m.note) text += `${text ? '，' : ''}${m.note}`;
      return { label, text };
    }
    // 强化形态带挂靠道具：途径写清"由谁 + 哪颗道具"
    if (type === 'evolve') return { label, text: `由 ${nameOf(m.from)}${m.item ? ` · ${m.item}` : ''}` };
    return { label, text: '' };
  });
  // 并进交换后可能出现两条同标签，去重
  const seen = new Set();
  return out.filter((e) => (seen.has(e.label) ? false : (seen.add(e.label), true)));
}
