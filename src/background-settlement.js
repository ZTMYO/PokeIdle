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

export function settleBackgroundSlice(state, options = {}) {
  const nextState = copyState(state);
  const settledAt = Number(state.settledAt) || 0;
  const now = Number(options.now);

  if (!Number.isFinite(now) || now <= settledAt) {
    if (Number.isFinite(now) && now < settledAt) {
      nextState.settledAt = now;
      nextState.encounterRemainderMs = 0;
    }
    return { state: nextState, encounters: 0, elapsedMs: 0, results: [] };
  }

  const configuredMax = Number(options.maxElapsedMs);
  const maxElapsedMs = Number.isFinite(configuredMax) && configuredMax >= 0
    ? Math.min(configuredMax, DEFAULT_MAX_ELAPSED_MS)
    : DEFAULT_MAX_ELAPSED_MS;
  const elapsedMs = Math.min(now - settledAt, maxElapsedMs);
  const encounterEveryMs = Number(options.encounterEveryMs);
  const hasEncounterInterval = Number.isFinite(encounterEveryMs) && encounterEveryMs > 0;
  const configuredRemainder = Number(state.encounterRemainderMs);
  const previousRemainderMs = hasEncounterInterval
    && Number.isFinite(configuredRemainder)
    && configuredRemainder >= 0
    ? configuredRemainder % encounterEveryMs
    : 0;
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
      at: settledAt + (encounterEveryMs - previousRemainderMs) + (index * encounterEveryMs),
    });
    results.push(result);

    if (result?.ball && (nextState.balls[result.ball] || 0) > 0) {
      nextState.balls[result.ball] -= 1;
    }
  }

  if (hasEncounterInterval) {
    nextState.encounterRemainderMs = accumulatedEncounterMs % encounterEveryMs;
  }
  nextState.settledAt = settledAt + elapsedMs;
  return { state: nextState, encounters, elapsedMs, results };
}
