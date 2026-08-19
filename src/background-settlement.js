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
 * exactly one returned `ball` itself so adapters cannot double-charge.
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
  const encounters = hasEncounterInterval
    ? Math.floor(accumulatedEncounterMs / encounterEveryMs)
    : 0;
  const results = [];

  for (let index = 0; index < encounters; index += 1) {
    const result = options.resolveEncounter({
      state: nextState,
      random: options.random?.(),
      encounterIndex: index,
      at: processingStart + (encounterEveryMs - previousRemainderMs) + (index * encounterEveryMs),
    });
    results.push(result);

    if (result?.ball && (nextState.balls[result.ball] || 0) > 0) {
      nextState.balls[result.ball] -= 1;
    }
  }

  if (hasEncounterInterval) {
    nextState.encounterRemainderMs = accumulatedEncounterMs % encounterEveryMs;
  }
  nextState.settledAt = now;
  return { state: nextState, encounters, elapsedMs, results };
}
