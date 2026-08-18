export async function persistSerializedSave(serialized, {
  tauriInvoke,
  mobile,
  storage,
  strict = false,
} = {}) {
  const writes = [];
  if (tauriInvoke) {
    writes.push(['tauri', () => tauriInvoke('save_game_data', { data: serialized })]);
  }
  if (storage) {
    writes.push(['localStorage', () => storage.setItem('pokemon_idle_save', serialized)]);
  }
  if (mobile?.saveGameData) {
    writes.push(['mobile', () => mobile.saveGameData(serialized)]);
  }

  const errors = [];
  for (const [source, write] of writes) {
    try {
      await write();
    } catch (cause) {
      const error = new Error(`${source}: ${cause?.message || cause}`, { cause });
      error.source = source;
      errors.push(error);
    }
  }

  if (strict && errors.length) {
    throw new AggregateError(errors, `存档写入失败：${errors.map(error => error.source).join(', ')}`);
  }

  return { errors, written: writes.length - errors.length };
}
