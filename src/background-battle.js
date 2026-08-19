import {
  CATCH_RATES,
  CANDY_EXCHANGE,
  FLEE_CHANCE,
  FLEE_CHANCE_INC,
  FLEE_CHANCE_MAX,
  ULTRA_BALL_ADD,
} from './config.js';
import { catchBonusFor, computeMeetScore, computeObtainScore } from './scoring.js';

const BALLS = ['poke-ball', 'ultra-ball', 'master-ball'];

export function pickBackgroundBall(pokemon, inventory, enabled = {}) {
  const available = BALLS.filter(ball => enabled[ball] !== false && (inventory[ball] || 0) > 0);
  const rate = pokemon?.catchRate ?? 1;
  const preferred = pokemon?.legend || rate <= 0.2
    ? ['master-ball', 'ultra-ball', 'poke-ball']
    : rate <= 0.5
      ? ['ultra-ball', 'poke-ball', 'master-ball']
      : ['poke-ball', 'ultra-ball', 'master-ball'];
  return preferred.find(ball => available.includes(ball)) || available[0] || null;
}

function ensureData(data) {
  data.items ||= {};
  data.settings ||= {};
  data.pokedex ||= {};
  data.roster ||= [];
  data.encounterLogs ||= {};
  data.systemLogs ||= [];
  data.stats ||= {};
}

function addLog(data, type, details, now) {
  data.systemLogs.push({ time: now, type, details });
  if (data.systemLogs.length > 50) data.systemLogs.splice(0, data.systemLogs.length - 50);
}

function filterAction(data, pokemon, shiny, level) {
  const rows = data.settings?.catchFilter?.rows || {};
  const row = (pokemon?.legend
    ? (shiny ? rows.legendShiny : rows.legend)
    : (shiny ? rows.normalShiny : rows.normal)) || { action: 'catch' };
  if (row.action === 'flee' || row.action === 'stop') return row.action;
  const caught = data.pokedex[String(pokemon.index)];
  if (row.uncaughtOnly && (shiny ? caught?.shinyCaught : caught?.caught)) return 'flee';
  if ((row.levelMin > 0 && level < row.levelMin) || (row.levelMax > 0 && level > row.levelMax)) return 'flee';
  return 'catch';
}

function refillBackgroundBall(data, inventory, now) {
  if (!data.settings.autoRefill) return null;
  const enabled = data.settings.autoRefillBalls || {};
  const order = Array.isArray(data.settings.autoRefillOrder)
    ? data.settings.autoRefillOrder
    : BALLS;
  for (const ball of order) {
    if (enabled[ball] === false || (inventory[ball] || 0) > 0) continue;
    const price = CANDY_EXCHANGE[ball];
    if (price == null || (data.items.candy || 0) < price) continue;
    data.items.candy -= price;
    inventory[ball] = 1;
    data.stats.totalItemsEarned ||= {};
    data.stats.totalItemsEarned[ball] = (data.stats.totalItemsEarned[ball] || 0) + 1;
    addLog(data, 'auto_refill', { ball, cost: price, background: true }, now);
    return ball;
  }
  return null;
}

function followerBoost(data, group, now) {
  const follower = data.follower;
  if (!follower || !Array.isArray(follower.groups) || follower.endsAt <= now) return 0;
  return follower.groups.includes(group) && Number.isFinite(follower.boost) && follower.boost > 0
    ? follower.boost
    : 0;
}

export function resolveBackgroundEncounter({
  state,
  pokemon,
  shiny = false,
  level = 1,
  source = 'normal',
  variant = null,
  now = Date.now(),
  random = Math.random,
  charmBuff = false,
  honeyBuff = false,
  makeGender,
  makeRosterEntry,
}) {
  const data = state.gameData;
  ensureData(data);
  if (!pokemon) return { result: 'fled', ballCosts: {} };

  const index = String(pokemon.index);
  const dex = data.pokedex[index] ||= { seen: 0, caught: 0, lastTime: null, shinySeen: 0, shinyCaught: 0 };
  dex.seen += 1;
  dex.lastTime = new Date(now).toISOString();
  if (shiny) {
    dex.shinySeen = (dex.shinySeen || 0) + 1;
    data.stats.totalShinySeen = (data.stats.totalShinySeen || 0) + 1;
  }
  addLog(data, 'encounter', { pokemon: index, shiny, source, background: true }, now);

  const action = filterAction(data, pokemon, shiny, level);
  if (action === 'stop') {
    return { result: 'paused', ballCosts: {}, pokemon: index, shiny, level, source, variant };
  }

  const ballCosts = {};
  const available = { ...(state.balls || {}) };
  const used = {};
  let ballsUsed = 0;
  let finalRate = 0;
  let escaped = false;
  let result = action === 'flee' || data.settings.autoCatch === false ? 'fled' : 'continue';

  while (result === 'continue') {
    let ball = pickBackgroundBall(pokemon, available, data.settings.autoCatchBalls);
    if (!ball && refillBackgroundBall(data, available, now)) {
      ball = pickBackgroundBall(pokemon, available, data.settings.autoCatchBalls);
    }
    if (!ball) { result = 'fled'; break; }
    available[ball] -= 1;
    ballCosts[ball] = (ballCosts[ball] || 0) + 1;
    used[ball] = (used[ball] || 0) + 1;
    ballsUsed += 1;
    data.stats.totalBallsUsed = (data.stats.totalBallsUsed || 0) + 1;

    const catchBoost = ball === 'poke-ball' ? (1 + followerBoost(data, 'catch', now)) : 1;
    finalRate = ball === 'master-ball' ? 1 :
      ((CATCH_RATES[ball] || 0.3) * (pokemon.catchRate ?? 1)
        * catchBoost + (ball === 'ultra-ball' ? ULTRA_BALL_ADD : 0)) * catchBonusFor(ballsUsed);
    if (random() < finalRate) result = 'caught';
    else {
      const fleeRate = Math.min(
        (FLEE_CHANCE + (ballsUsed - 1) * FLEE_CHANCE_INC)
          * Math.max(0, 1 - followerBoost(data, 'flee', now)),
        FLEE_CHANCE_MAX,
      );
      if (random() < fleeRate) {
        escaped = true;
        result = 'fled';
      }
    }
  }

  let entry = null;
  if (result === 'caught') {
    const rate = pokemon.genderRate ?? 4;
    const fallbackGender = rate === -1 ? 'genderless' : (random() * 8 < rate ? 'female' : 'male');
    const gender = makeGender ? makeGender(index) : fallbackGender;
    entry = makeRosterEntry({ species: pokemon.index, shiny, source, level, gender, variant });
    data.roster.push(entry);
    dex.caught = (dex.caught || 0) + 1;
    if (shiny) {
      dex.shinyCaught = (dex.shinyCaught || 0) + 1;
      data.stats.totalShinyCaught = (data.stats.totalShinyCaught || 0) + 1;
    }
    data.stats.totalCatches = (data.stats.totalCatches || 0) + 1;
    addLog(data, 'pokemon_caught', { pokemon: index, shiny, background: true }, now);
  } else if (escaped) {
    data.stats.totalFlees = (data.stats.totalFlees || 0) + 1;
    addLog(data, 'pokemon_escaped', { pokemon: index, shiny, auto: true, background: true }, now);
  } else {
    addLog(data, 'player_fled', { pokemon: index, shiny, auto: true, background: true }, now);
  }

  const score = result === 'caught'
    ? computeObtainScore({
      pokemon, source, shiny, charmBuff, honeyBuff,
      balls: used, finalRate, ivs: entry?.ivs,
    })
    : computeMeetScore({ pokemon, source, shiny, charmBuff, honeyBuff });
  data.encounterLogs[index] ||= [];
  data.encounterLogs[index].push({
    time: now,
    shiny,
    result,
    balls: used,
    source,
    charmBuff,
    selfFlee: result === 'fled' && !escaped,
    background: true,
    finalRate,
    score,
  });
  return { result, ballCosts, pokemon: index, shiny, ballsUsed };
}
