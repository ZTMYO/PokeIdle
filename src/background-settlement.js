const DEFAULT_MAX_ELAPSED_MS = 24 * 60 * 60 * 1000;

function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
  }
  return value;
}

function copyState(state) {
  const copy = copyValue(state);
  copy.balls = copy.balls || {};
  copy.stats = copy.stats || {};
  return copy;
}

/**
 * Settles one time slice against an internal state copy.
 * `balls` is the pending inventory map. The resolver may update other fields
 * on the provided next state, but must not deduct balls; this core deducts
 * the returned `ballCosts` map (or one legacy `ball`) so adapters cannot
 * double-charge. A `paused` result stops the slice at that encounter and
 * leaves the remaining time after that encounter for the next settlement.
 */
export function settleBackgroundSlice(state, options = {}) {
  const nextState = copyState(state);
  const settledAt = typeof state.settledAt === 'number' && Number.isFinite(state.settledAt)
    ? state.settledAt
    : 0;
  const now = options.now;

  if (typeof now !== 'number' || !Number.isFinite(now) || now <= settledAt) {
    if (typeof now === 'number' && Number.isFinite(now) && now < settledAt) {
      nextState.settledAt = now;
      nextState.encounterRemainderMs = 0;
    }
    return { state: nextState, encounters: 0, elapsedMs: 0, results: [] };
  }

  const configuredMax = options.maxElapsedMs;
  const maxElapsedMs = typeof configuredMax === 'number'
    && Number.isFinite(configuredMax)
    && configuredMax >= 0
    ? Math.min(configuredMax, DEFAULT_MAX_ELAPSED_MS)
    : DEFAULT_MAX_ELAPSED_MS;
  const actualElapsedMs = now - settledAt;
  const elapsedMs = Math.min(actualElapsedMs, maxElapsedMs);
  const capped = actualElapsedMs > elapsedMs;
  const encounterEveryMs = options.encounterEveryMs;
  const hasEncounterInterval = Number.isFinite(encounterEveryMs) && encounterEveryMs > 0;
  const configuredRemainder = state.encounterRemainderMs;
  const previousRemainderMs = hasEncounterInterval
    && !capped
    && typeof configuredRemainder === 'number'
    && Number.isFinite(configuredRemainder)
    && configuredRemainder >= 0
    ? configuredRemainder % encounterEveryMs
    : 0;
  const processingStart = capped ? now - elapsedMs : settledAt;
  const accumulatedEncounterMs = previousRemainderMs + elapsedMs;
  const plannedEncounters = hasEncounterInterval
    ? Math.floor(accumulatedEncounterMs / encounterEveryMs)
    : 0;
  const results = [];
  let encounters = 0;
  let pausedAt = null;

  for (let index = 0; index < plannedEncounters; index += 1) {
    const at = processingStart + (encounterEveryMs - previousRemainderMs) + (index * encounterEveryMs);
    const result = options.resolveEncounter({
      state: nextState,
      random: options.random?.(),
      encounterIndex: index,
      at,
    });
    results.push(result);
    encounters += 1;

    const costs = result?.ballCosts || (result?.ball ? { [result.ball]: 1 } : {});
    for (const [ball, rawCount] of Object.entries(costs)) {
      const count = Number.isInteger(rawCount) && rawCount > 0 ? rawCount : 0;
      nextState.balls[ball] = Math.max(0, (nextState.balls[ball] || 0) - count);
    }
    if (result?.result === 'paused') {
      pausedAt = at;
      break;
    }
  }

  if (pausedAt != null) {
    nextState.encounterRemainderMs = 0;
    nextState.settledAt = pausedAt;
    return {
      state: nextState,
      encounters,
      elapsedMs: Math.max(0, pausedAt - processingStart),
      results,
    };
  }
  if (hasEncounterInterval) {
    nextState.encounterRemainderMs = accumulatedEncounterMs % encounterEveryMs;
  }
  nextState.settledAt = now;
  return { state: nextState, encounters, elapsedMs, results };
}
