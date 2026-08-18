import { prepareImportedSave } from './save-transfer.js';

const clone = value => JSON.parse(JSON.stringify(value));

async function applyAndPersist({ original, replacement, apply, persist }) {
  apply(replacement);
  try {
    await persist();
  } catch (error) {
    apply(original);
    try {
      await persist();
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
  return replacement;
}

export async function replaceSaveWithBackup({
  getCurrent,
  incoming,
  saveCurrent,
  createBackup,
  apply,
  persist,
  now = Date.now(),
}) {
  await saveCurrent();
  const original = clone(getCurrent());
  await createBackup(JSON.stringify(original));
  const replacement = prepareImportedSave(incoming, { currentSave: original, now });
  return applyAndPersist({ original, replacement, apply, persist });
}

export async function restoreBackupSave({ getCurrent, backupData, apply, persist }) {
  const original = clone(getCurrent());
  const replacement = clone(backupData);
  return applyAndPersist({ original, replacement, apply, persist });
}
