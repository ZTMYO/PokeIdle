export function parseSaveCandidate(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.items || typeof data.items !== 'object') {
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

export function chooseNewestSave(candidates = []) {
  return candidates
    .map(candidate => ({ ...candidate, data: parseSaveCandidate(candidate.raw) }))
    .filter(candidate => candidate.data)
    .sort((a, b) => (b.data.stats?.lastSaveTime || 0) - (a.data.stats?.lastSaveTime || 0))[0] || null;
}
