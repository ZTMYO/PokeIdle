// ===== 奖励发放：抽奖/活动共用的道具与蛋 =====
import { gameData, saveGame, getPokemonByIndex, rollGender } from './state.js';
import { grantItem, itemIconSrc } from './items.js';
import { ITEM_NAMES, eggSprite } from './config.js';

const IV_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const cleanIvs = (ivs) => {
  const out = {};
  for (const k of IV_KEYS) out[k] = Math.max(0, Math.min(31, Number(ivs && ivs[k]) || 0));
  return out;
};

export function normalizePrize(raw) {
  if (typeof raw === 'string') return raw ? { kind: 'item', key: raw, qty: 1 } : null;
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'egg') {
    const species = String(raw.species || '').trim();
    if (!/^\d{1,4}(-\d+)?$/.test(species)) return null;
    return {
      kind: 'egg',
      species,
      shiny: !!raw.shiny,
      squareShiny: !!raw.shiny && !!raw.squareShiny,
      ivs: raw.ivs ? cleanIvs(raw.ivs) : null,
      nature: raw.nature ? String(raw.nature) : null,
      gender: raw.gender ? String(raw.gender) : null,
      variant: raw.variant ? String(raw.variant) : null,
      ivRandomKey: raw.ivRandomKey ? String(raw.ivRandomKey) : null,
    };
  }
  const key = String(raw.key || '').trim();
  if (!key) return null;
  return { kind: 'item', key, qty: Math.max(1, Math.min(999, Number(raw.qty) || 1)) };
}

export function prizeName(raw) {
  const p = normalizePrize(raw);
  if (!p) return '神秘奖品';
  if (p.kind === 'item') return (ITEM_NAMES[p.key] || p.key) + (p.qty > 1 ? ` ×${p.qty}` : '');
  const poke = getPokemonByIndex(String(p.species));
  return `${poke ? poke.name : `#${p.species}`}的蛋${p.shiny ? ' ★' : ''}`;
}

export function prizeIcon(raw) {
  const p = normalizePrize(raw);
  if (!p) return '';
  if (p.kind === 'item') return itemIconSrc(p.key);
  const poke = getPokemonByIndex(String(p.species));
  return eggSprite(poke?.types?.[0]);
}

export function grantPrize(raw) {
  const p = normalizePrize(raw);
  if (!p) return false;
  if (p.kind === 'item') {
    grantItem(p.key, p.qty, '抽奖');
    saveGame();
    return true;
  }
  const arr = Array.isArray(gameData.roster) ? gameData.roster : null;
  if (!arr) return false;
  arr.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    kind: 'egg',
    species: String(p.species),
    originSpecies: String(p.species),
    gender: p.gender || rollGender(String(p.species)),
    level: 1,
    exp: 0,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: p.ivs || cleanIvs(null),
    nature: p.nature || 'hardy',
    shiny: !!p.shiny,
    squareShiny: !!p.squareShiny,
    ivRandomKey: p.ivRandomKey || null,
    variant: p.variant || null,
    source: 'egg',
    obtainedAt: Date.now(),
    inRoster: true,
  });
  saveGame();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('roster-changed'));
  return true;
}
