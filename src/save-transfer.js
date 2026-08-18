export const SAVE_FORMAT_VERSION = 1;
export const SAVE_MAX_BYTES = 20 * 1024 * 1024;

export class SaveTransferError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SaveTransferError';
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function summarizeSave(data) {
  return {
    lastSaveTime: data.stats?.lastSaveTime ?? null,
    gender: data.settings?.gender ?? null,
    candy: data.items?.candy ?? null,
    teamCount: Array.isArray(data.team) ? data.team.length : null,
    rosterCount: Array.isArray(data.roster) ? data.roster.length : null,
    pokedexCount: isObject(data.pokedex) ? Object.keys(data.pokedex).length : null,
  };
}

export function parseSaveTransfer(raw) {
  if (typeof raw !== 'string') {
    throw new SaveTransferError('INVALID_JSON', '存档内容必须是 JSON 文本');
  }

  if (new TextEncoder().encode(raw).byteLength > SAVE_MAX_BYTES) {
    throw new SaveTransferError('SAVE_TOO_LARGE', '存档大小超过 20 MB');
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new SaveTransferError('INVALID_JSON', '存档不是有效 JSON');
  }

  if (!isObject(data) || !isObject(data.items) || !isObject(data.stats)) {
    throw new SaveTransferError('INVALID_SAVE', '存档缺少有效的 items 或 stats');
  }

  const formatVersion = data.__pokeidleMeta?.formatVersion ?? 0;

  if (formatVersion > SAVE_FORMAT_VERSION) {
    throw new SaveTransferError('FUTURE_VERSION', '存档格式版本高于当前支持版本');
  }

  return {
    data,
    formatVersion,
    summary: summarizeSave(data),
  };
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

export function buildExportFileName(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const datePart = [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('');
  const timePart = [
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
  ].join('');

  return `pokeidle-save-${datePart}-${timePart}.json`;
}

export function serializeSaveForExport(data, { appVersion, now = new Date() } = {}) {
  const copy = structuredClone(data);
  copy.__pokeidleMeta = {
    formatVersion: SAVE_FORMAT_VERSION,
    appVersion,
    exportedAt: now,
  };

  return {
    json: JSON.stringify(copy),
    fileName: buildExportFileName(now),
  };
}

export function prepareImportedSave(data, { currentSave, now = Date.now() } = {}) {
  const copy = structuredClone(data);
  delete copy.__pokeidleMeta;
  copy.stats.lastSaveTime = Math.max(
    Number(now),
    Number(currentSave?.stats?.lastSaveTime ?? 0),
  ) + 1;

  return copy;
}
