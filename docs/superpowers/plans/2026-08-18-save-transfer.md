# 跨平台存档导入导出实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 Android、Tauri 桌面版和浏览器中提供安全、可确认、可恢复的 JSON 存档双向导入导出，并发布 `v1.0.9` 正式签名 APK。

**架构：** `src/save-transfer.js` 只处理格式、校验、摘要和时间戳，`src/save-platform.js` 统一平台文件语义，`src/save-transfer-controller.js` 负责备份优先的导入事务与设置页交互。`state.js` 通过可测试的持久化助手增加严格写入模式；Android bridge 和 Tauri 命令仅负责各自原生文件能力。

**技术栈：** 原生 ES Modules、Node.js 内置测试运行器、Capacitor 7 Filesystem/Share、Tauri 2/Rust、原生 HTML/CSS。

---

## 文件结构

- 创建 `src/save-transfer.js`：无 DOM 的存档格式、大小、摘要和导入副本规则。
- 创建 `src/save-persistence.js`：将序列化存档写入可用持久化来源，并汇总错误。
- 创建 `src/save-platform.js`：统一桌面、Android 和浏览器的文件选择、导出及导入前备份。
- 创建 `src/save-transfer-controller.js`：导出、确认导入、失败回滚和恢复备份的流程控制。
- 创建 `test/mobile-save-transfer.test.mjs`：共享格式规则的行为测试。
- 创建 `test/mobile-save-persistence.test.mjs`：严格持久化和普通持久化的行为测试。
- 创建 `test/mobile-save-platform.test.mjs`：浏览器回退与平台路由测试。
- 创建 `test/mobile-save-transaction.test.mjs`：备份顺序、取消、失败回滚和恢复行为测试。
- 创建 `test/mobile-save-native-contract.test.mjs`：Capacitor 与 Tauri 原生接口静态契约测试。
- 修改 `src/state.js`：让 `saveGame()` 支持严格错误传播和保留导入时间戳。
- 修改 `src/views.js`：移除旧导入导出逻辑，接入控制器并显示存档活动日志。
- 修改 `src/index.html`：增加复用的存档摘要确认层。
- 修改 `src/styles.css`：增加稳定尺寸的确认层、摘要表格和按钮状态样式。
- 修改 `mobile/bridge-source.js`：增加 Android 分享和独立导入前备份。
- 修改 `src-tauri/src/game_data.rs`：增加建议文件名、取消语义、大小检查和私有备份命令。
- 修改 `src-tauri/src/lib.rs`：注册新增的 Tauri 命令。
- 修改 `package.json`、`package-lock.json`：增加 Capacitor Share，并在发布任务中升到 `1.0.9`。
- 修改 `android/capacitor.settings.gradle`、`android/app/capacitor.build.gradle`：由 `cap sync` 注册 Share 插件。
- 修改 `src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`android/app/build.gradle`、`update_log.md`：同步 `v1.0.9` 发布信息。

### 任务 1：实现共享存档格式规则

**文件：**
- 创建：`src/save-transfer.js`
- 创建：`test/mobile-save-transfer.test.mjs`

- [ ] **步骤 1：编写格式、校验、摘要和不可变性的失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_MAX_BYTES,
  SaveTransferError,
  buildExportFileName,
  parseSaveTransfer,
  prepareImportedSave,
  serializeSaveForExport,
  summarizeSave,
} from '../src/save-transfer.js';

const complete = {
  items: { candy: 321 },
  stats: { lastSaveTime: 100 },
  settings: { gender: 'may' },
  team: ['a'],
  roster: [{ id: 'a' }, { id: 'b' }],
  pokedex: { 1: true, 4: true },
};

test('旧存档和格式 1 存档可解析，未来格式被拒绝', () => {
  assert.equal(parseSaveTransfer(JSON.stringify(complete)).formatVersion, 0);
  const current = { ...complete, __pokeidleMeta: { formatVersion: 1 } };
  assert.equal(parseSaveTransfer(JSON.stringify(current)).formatVersion, 1);
  assert.throws(
    () => parseSaveTransfer(JSON.stringify({ ...complete, __pokeidleMeta: { formatVersion: 2 } })),
    error => error instanceof SaveTransferError && error.code === 'FUTURE_VERSION',
  );
});

test('拒绝损坏 JSON、数组、缺少 items 或 stats 以及超过 20 MB 的内容', () => {
  for (const raw of ['{bad', '[]', '{"items":{}}', '{"stats":{}}']) {
    assert.throws(() => parseSaveTransfer(raw), SaveTransferError);
  }
  assert.equal(SAVE_MAX_BYTES, 20 * 1024 * 1024);
  assert.throws(() => parseSaveTransfer(' '.repeat(SAVE_MAX_BYTES + 1)), /20 MB/);
});

test('摘要使用固定字段，缺失可选字段返回 null', () => {
  assert.deepEqual(summarizeSave(complete), {
    lastSaveTime: 100,
    gender: 'may',
    candy: 321,
    teamCount: 1,
    rosterCount: 2,
    pokedexCount: 2,
  });
  assert.equal(summarizeSave({ items: {}, stats: {} }).gender, null);
});

test('导出和导入副本均不修改原对象', () => {
  const original = structuredClone(complete);
  const exported = serializeSaveForExport(complete, { appVersion: '1.0.9', now: 200 });
  assert.deepEqual(complete, original);
  assert.equal(JSON.parse(exported.json).__pokeidleMeta.exportedAt, 200);
  assert.equal(JSON.parse(exported.json).stats.lastSaveTime, 100);

  const imported = prepareImportedSave(
    { ...complete, __pokeidleMeta: { formatVersion: 1 } },
    { currentSave: { stats: { lastSaveTime: 500 } }, now: 400 },
  );
  assert.equal(imported.stats.lastSaveTime, 501);
  assert.equal('__pokeidleMeta' in imported, false);
  assert.deepEqual(complete, original);
});

test('文件名使用本地时间且只包含合法字符', () => {
  assert.match(buildExportFileName(new Date(2026, 7, 18, 9, 5, 7)), /^pokeidle-save-20260818-090507\.json$/);
});
```

- [ ] **步骤 2：运行测试并确认因模块不存在而失败**

运行：`node --test test/mobile-save-transfer.test.mjs`

预期：FAIL，包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现共享模块的最少完整行为**

```js
export const SAVE_FORMAT_VERSION = 1;
export const SAVE_MAX_BYTES = 20 * 1024 * 1024;

export class SaveTransferError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SaveTransferError';
    this.code = code;
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = text => new TextEncoder().encode(text).byteLength;
const count = value => Array.isArray(value) ? value.length : null;

export function summarizeSave(data) {
  return {
    lastSaveTime: Number.isFinite(data?.stats?.lastSaveTime) ? data.stats.lastSaveTime : null,
    gender: typeof data?.settings?.gender === 'string' ? data.settings.gender : null,
    candy: Number.isFinite(data?.items?.candy) ? data.items.candy : null,
    teamCount: count(data?.team),
    rosterCount: count(data?.roster),
    pokedexCount: isObject(data?.pokedex) ? Object.keys(data.pokedex).length : null,
  };
}

export function parseSaveTransfer(raw) {
  if (typeof raw !== 'string' || bytes(raw) > SAVE_MAX_BYTES) {
    throw new SaveTransferError('TOO_LARGE', '存档文件不能超过 20 MB');
  }
  let data;
  try { data = JSON.parse(raw); }
  catch (_) { throw new SaveTransferError('INVALID_JSON', '文件不是有效的 JSON 存档'); }
  if (!isObject(data)) throw new SaveTransferError('INVALID_ROOT', '存档顶层必须是对象');
  if (!isObject(data.items) || !isObject(data.stats)) {
    throw new SaveTransferError('MISSING_FIELDS', '存档缺少 items 或 stats');
  }
  const formatVersion = data.__pokeidleMeta?.formatVersion ?? 0;
  if (!Number.isInteger(formatVersion) || formatVersion < 0) {
    throw new SaveTransferError('INVALID_VERSION', '存档格式版本无效');
  }
  if (formatVersion > SAVE_FORMAT_VERSION) {
    throw new SaveTransferError('FUTURE_VERSION', '请升级应用后再导入此存档');
  }
  return { data, formatVersion, summary: summarizeSave(data) };
}

const pad2 = value => String(value).padStart(2, '0');
export function buildExportFileName(date = new Date()) {
  return `pokeidle-save-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}.json`;
}

export function serializeSaveForExport(data, { appVersion, now = Date.now() } = {}) {
  const copy = clone(data);
  copy.__pokeidleMeta = { formatVersion: SAVE_FORMAT_VERSION, appVersion, exportedAt: now };
  return { json: JSON.stringify(copy, null, 2), fileName: buildExportFileName(new Date(now)) };
}

export function prepareImportedSave(data, { currentSave, now = Date.now() } = {}) {
  const copy = clone(data);
  delete copy.__pokeidleMeta;
  copy.stats.lastSaveTime = Math.max(now, Number(currentSave?.stats?.lastSaveTime) || 0) + 1;
  return copy;
}
```

- [ ] **步骤 4：运行共享规则测试**

运行：`node --test test/mobile-save-transfer.test.mjs`

预期：PASS，5 个测试全部通过。

- [ ] **步骤 5：提交共享规则**

```bash
git add src/save-transfer.js test/mobile-save-transfer.test.mjs
git commit -m "feat(存档): 添加跨平台存档格式规则"
```

### 任务 2：增加可验证的严格持久化

**文件：**
- 创建：`src/save-persistence.js`
- 创建：`test/mobile-save-persistence.test.mjs`
- 修改：`src/state.js:409`

- [ ] **步骤 1：编写多来源写入与严格失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { persistSerializedSave } from '../src/save-persistence.js';

test('写入桌面文件和 localStorage', async () => {
  const calls = [];
  await persistSerializedSave('{}', {
    tauriInvoke: async (command, args) => calls.push([command, args]),
    storage: { setItem: (...args) => calls.push(['local', args]) },
  });
  assert.deepEqual(calls.map(call => call[0]), ['save_game_data', 'local']);
});

test('普通保存吞掉单来源错误，严格保存抛出汇总错误', async () => {
  const options = { mobile: { saveGameData: async () => { throw new Error('disk full'); } } };
  assert.equal((await persistSerializedSave('{}', options)).errors.length, 1);
  await assert.rejects(() => persistSerializedSave('{}', { ...options, strict: true }), /mobile/);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/mobile-save-persistence.test.mjs`

预期：FAIL，包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现持久化助手并让 `saveGame()` 支持严格模式**

`src/save-persistence.js` 提供以下接口；所有可用来源都尝试写入，`strict: true` 时最后抛出带来源名的 `AggregateError`：

```js
export async function persistSerializedSave(serialized, {
  tauriInvoke,
  mobile,
  storage,
  strict = false,
} = {}) {
  const writes = [];
  if (tauriInvoke) writes.push(['tauri', () => tauriInvoke('save_game_data', { data: serialized })]);
  if (storage) writes.push(['localStorage', () => storage.setItem('pokemon_idle_save', serialized)]);
  if (mobile?.saveGameData) writes.push(['mobile', () => mobile.saveGameData(serialized)]);
  const errors = [];
  for (const [source, write] of writes) {
    try { await write(); }
    catch (error) { errors.push(Object.assign(new Error(`${source}: ${error?.message || error}`), { source, cause: error })); }
  }
  if (strict && errors.length) throw new AggregateError(errors, `存档写入失败：${errors.map(error => error.source).join(', ')}`);
  return { errors, written: writes.length - errors.length };
}
```

将 `state.js` 的签名改为：

```js
export async function saveGame({ strict = false, preserveTimestamp = false } = {}) {
  if (!gameData) return { errors: [], written: 0 };
  if (!preserveTimestamp) gameData.stats.lastSaveTime = Date.now();
  syncGpsPosition();
  return persistSerializedSave(JSON.stringify(gameData), {
    tauriInvoke: window.__TAURI__?.core?.invoke,
    mobile: window.__POKEIDLE_MOBILE__,
    storage: localStorage,
    strict,
  });
}
```

- [ ] **步骤 4：运行持久化测试和现有移动端测试**

运行：`node --test test/mobile-save-persistence.test.mjs && npm run test:mobile`

预期：PASS；现有测试无回归。

- [ ] **步骤 5：提交持久化改造**

```bash
git add src/save-persistence.js src/state.js test/mobile-save-persistence.test.mjs
git commit -m "refactor(存档): 增加严格持久化模式"
```

### 任务 3：实现跨平台文件适配层

**文件：**
- 创建：`src/save-platform.js`
- 创建：`test/mobile-save-platform.test.mjs`

- [ ] **步骤 1：编写平台路由和浏览器回退测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavePlatform } from '../src/save-platform.js';

test('Android 导出优先调用移动 bridge', async () => {
  const calls = [];
  const platform = createSavePlatform({
    win: { __POKEIDLE_MOBILE__: { exportSaveData: (...args) => calls.push(args) } },
    doc: {}, storage: {},
  });
  await platform.exportSaveData('{}', 'pokeidle-save.json');
  assert.deepEqual(calls, [['{}', 'pokeidle-save.json']]);
});

test('浏览器导入前备份使用独立 key', async () => {
  const values = new Map();
  const storage = { setItem: (k, v) => values.set(k, v), getItem: k => values.get(k) ?? null };
  const platform = createSavePlatform({ win: {}, doc: {}, storage });
  await platform.createImportBackup('{"items":{},"stats":{}}');
  assert.equal(await platform.loadImportBackup(), '{"items":{},"stats":{}}');
  assert.equal(values.has('pokemon_idle_import_backup'), true);
});

test('Tauri 取消导入返回 null 而不是错误', async () => {
  const platform = createSavePlatform({
    win: { __TAURI__: { core: { invoke: async () => null } } }, doc: {}, storage: {},
  });
  assert.equal(await platform.pickImportFile(), null);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/mobile-save-platform.test.mjs`

预期：FAIL，包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现统一平台接口**

`createSavePlatform({ win = window, doc = document, storage = localStorage })` 返回：

```js
{
  pickImportFile,       // Promise<null | { name, content, size }>
  exportSaveData,       // Promise<{ path?: string } | void>
  createImportBackup,   // Promise<void>
  loadImportBackup,     // Promise<string | null>
  getAppVersion,        // Promise<string>
}
```

实现规则：

```js
const IMPORT_BACKUP_KEY = 'pokemon_idle_import_backup';

async function exportSaveData(data, fileName) {
  if (win.__POKEIDLE_MOBILE__?.exportSaveData) {
    return win.__POKEIDLE_MOBILE__.exportSaveData(data, fileName);
  }
  if (win.__TAURI__?.core?.invoke) {
    const path = await win.__TAURI__.core.invoke('export_save_data', { data, fileName });
    return path ? { path } : null;
  }
  const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
```

桌面导入调用 `import_save_data`；Android/浏览器创建一次性隐藏文件输入，设置 `accept="application/json,.json"`，在读取文本前以 `file.size` 检查 `SAVE_MAX_BYTES`。备份优先调用移动 bridge，其次调用 Tauri 命令，最后使用独立 `localStorage` key。`getAppVersion()` 在 Android 调用移动 bridge，在桌面调用 `window.__TAURI__.app.getVersion()`，纯浏览器返回 `web`。

- [ ] **步骤 4：运行平台适配测试**

运行：`node --test test/mobile-save-platform.test.mjs`

预期：PASS，3 个测试全部通过。

- [ ] **步骤 5：提交平台适配层**

```bash
git add src/save-platform.js test/mobile-save-platform.test.mjs
git commit -m "feat(存档): 添加跨平台文件适配层"
```

### 任务 4：接入 Android 分享与独立导入备份

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`mobile/bridge-source.js`
- 修改：`android/capacitor.settings.gradle`
- 修改：`android/app/capacitor.build.gradle`
- 创建：`test/mobile-save-native-contract.test.mjs`

- [ ] **步骤 1：编写 Android 原生契约失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Android bridge 使用 Share、缓存临时文件和独立导入备份', async () => {
  const source = await readFile(new URL('../mobile/bridge-source.js', import.meta.url), 'utf8');
  assert.match(source, /@capacitor\/share/);
  assert.match(source, /Directory\.Cache/);
  assert.match(source, /Share\.share/);
  assert.match(source, /save\.import-backup\.json/);
  assert.doesNotMatch(source, /Directory\.(Documents|ExternalStorage)/);
});
```

- [ ] **步骤 2：运行契约测试并确认失败**

运行：`node --test test/mobile-save-native-contract.test.mjs`

预期：FAIL，缺少 `@capacitor/share`。

- [ ] **步骤 3：安装 Share 插件并同步 Android 工程**

运行：`npm install @capacitor/share@^7.0.0 && npx cap sync android`

预期：`package-lock.json`、`android/capacitor.settings.gradle` 和 `android/app/capacitor.build.gradle` 出现 `capacitor-share`。

- [ ] **步骤 4：实现 Android 分享和备份接口**

在 bridge 中新增：

```js
import { Share } from '@capacitor/share';

const IMPORT_BACKUP_PATH = 'save.import-backup.json';

async function exportSaveData(data, fileName) {
  await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
    return await Share.share({ title: '导出存档', dialogTitle: '分享口袋挂机存档', url: uri });
  } finally {
    await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache }).catch(error => {
      console.warn('[mobile] 清理导出临时文件失败', error);
    });
  }
}

async function createImportBackup(data) {
  await Filesystem.writeFile({ path: IMPORT_BACKUP_PATH, data, directory: Directory.Data, encoding: Encoding.UTF8 });
}

async function getAppVersion() {
  return (await App.getInfo()).version;
}
```

`loadImportBackup()` 只把明确的“不存在”映射为 `null`，权限、I/O 和损坏错误继续抛出。把 `exportSaveData`、`createImportBackup`、`loadImportBackup` 和 `getAppVersion` 挂到 `mobileBridge`。

- [ ] **步骤 5：运行 Android 契约和 Web 打包测试**

运行：`node --test test/mobile-save-native-contract.test.mjs test/mobile-build-web.test.mjs && npm run android:prepare`

预期：PASS；`cap sync` 列出 `@capacitor/share`，且不新增公共存储权限。

- [ ] **步骤 6：提交 Android 原生适配**

```bash
git add package.json package-lock.json mobile/bridge-source.js android/capacitor.settings.gradle android/app/capacitor.build.gradle test/mobile-save-native-contract.test.mjs
git commit -m "feat(Android): 支持分享存档和导入备份"
```

### 任务 5：扩展 Tauri 文件与备份命令

**文件：**
- 修改：`src-tauri/src/game_data.rs`
- 修改：`src-tauri/src/lib.rs:247`
- 修改：`test/mobile-save-native-contract.test.mjs`

- [ ] **步骤 1：补充 Tauri 命令静态契约测试**

```js
test('Tauri 提供可取消的文件选择和导入前备份命令', async () => {
  const source = await readFile(new URL('../src-tauri/src/game_data.rs', import.meta.url), 'utf8');
  const lib = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(source, /set_file_name/);
  assert.match(source, /SAVE_MAX_BYTES[^]*20 \* 1024 \* 1024/);
  assert.match(source, /create_import_backup/);
  assert.match(source, /load_import_backup/);
  assert.match(source, /save\.import-backup\.json/);
  assert.match(lib, /game_data::create_import_backup/);
  assert.match(lib, /game_data::load_import_backup/);
});
```

- [ ] **步骤 2：运行测试并确认缺少命令**

运行：`node --test test/mobile-save-native-contract.test.mjs`

预期：FAIL，缺少 `create_import_backup`。

- [ ] **步骤 3：实现桌面文件和备份命令**

在 `game_data.rs` 定义：

```rust
const SAVE_MAX_BYTES: u64 = 20 * 1024 * 1024;
const IMPORT_BACKUP_FILE: &str = "save.import-backup.json";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSaveFile {
    name: String,
    content: String,
    size: u64,
}
```

命令签名固定为：

```rust
pub fn export_save_data(data: String, file_name: String) -> Result<Option<String>, String>;
pub fn import_save_data() -> Result<Option<ImportedSaveFile>, String>;
pub fn create_import_backup(app: tauri::AppHandle, data: String) -> Result<(), String>;
pub fn load_import_backup(app: tauri::AppHandle) -> Result<Option<String>, String>;
```

导出使用 `FileDialog::save_file()`、JSON filter 和 `set_file_name(&file_name)`；取消返回 `Ok(None)`。导入先读取 `metadata.len()`，超过上限返回 `SAVE_TOO_LARGE`，再返回文件名、正文和字节数。备份写入 `app_data_dir()/save.import-backup.json`，不存在时读取返回 `Ok(None)`。

- [ ] **步骤 4：注册命令并运行 Rust 检查**

在 `tauri::generate_handler!` 增加 `create_import_backup` 和 `load_import_backup`。

运行：`cargo check --manifest-path src-tauri/Cargo.toml`

预期：PASS，无 Rust 编译错误。

- [ ] **步骤 5：运行原生契约测试**

运行：`node --test test/mobile-save-native-contract.test.mjs`

预期：PASS，Android 与 Tauri 契约均满足。

- [ ] **步骤 6：提交桌面适配**

```bash
git add src-tauri/src/game_data.rs src-tauri/src/lib.rs test/mobile-save-native-contract.test.mjs
git commit -m "feat(桌面): 支持存档文件和导入备份"
```

### 任务 6：实现安全导入、回滚和恢复事务

**文件：**
- 创建：`src/save-transfer-controller.js`
- 创建：`test/mobile-save-transaction.test.mjs`

- [ ] **步骤 1：编写事务顺序和失败回滚测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceSaveWithBackup, restoreBackupSave } from '../src/save-transfer-controller.js';

const current = { items: { candy: 1 }, stats: { lastSaveTime: 10 } };
const incoming = { items: { candy: 9 }, stats: { lastSaveTime: 2 } };

test('确认导入严格按保存当前、备份、应用、持久化执行', async () => {
  const events = [];
  let active = structuredClone(current);
  await replaceSaveWithBackup({
    getCurrent: () => active,
    incoming,
    saveCurrent: async () => events.push('save-current'),
    createBackup: async raw => events.push(`backup:${JSON.parse(raw).items.candy}`),
    apply: value => { active = value; events.push(`apply:${value.items.candy}`); },
    persist: async () => events.push('persist'),
    now: 20,
  });
  assert.deepEqual(events, ['save-current', 'backup:1', 'apply:9', 'persist']);
  assert.equal(active.stats.lastSaveTime, 21);
});

test('备份失败时不应用导入存档', async () => {
  let applied = false;
  await assert.rejects(() => replaceSaveWithBackup({
    getCurrent: () => current,
    incoming,
    saveCurrent: async () => {},
    createBackup: async () => { throw new Error('backup failed'); },
    apply: () => { applied = true; },
    persist: async () => {},
  }));
  assert.equal(applied, false);
});

test('主存档写入失败时恢复内存和持久化的原存档', async () => {
  const applied = [];
  let writes = 0;
  await assert.rejects(() => replaceSaveWithBackup({
    getCurrent: () => current,
    incoming,
    saveCurrent: async () => {},
    createBackup: async () => {},
    apply: value => applied.push(value.items.candy),
    persist: async () => { if (++writes === 1) throw new Error('write failed'); },
  }));
  assert.deepEqual(applied, [9, 1]);
  assert.equal(writes, 2);
});

test('恢复备份不会创建新的导入前备份', async () => {
  let backupCalls = 0;
  await restoreBackupSave({
    getCurrent: () => current,
    backupData: incoming,
    apply: () => {},
    persist: async () => {},
    createBackup: () => { backupCalls++; },
  });
  assert.equal(backupCalls, 0);
});
```

- [ ] **步骤 2：运行事务测试并确认失败**

运行：`node --test test/mobile-save-transaction.test.mjs`

预期：FAIL，包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现导入和恢复事务函数**

```js
export async function replaceSaveWithBackup({
  getCurrent, incoming, saveCurrent, createBackup, apply, persist, now = Date.now(),
}) {
  await saveCurrent();
  const original = JSON.parse(JSON.stringify(getCurrent()));
  await createBackup(JSON.stringify(original));
  const replacement = prepareImportedSave(incoming, { currentSave: original, now });
  apply(replacement);
  try {
    await persist();
  } catch (error) {
    apply(original);
    try { await persist(); }
    catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  }
  return replacement;
}
```

`restoreBackupSave()` 使用相同的应用与失败回滚逻辑，但不接收也不调用 `createBackup`。生产接线时 `saveCurrent` 为 `saveGame({ strict: true })`，`persist` 为 `saveGame({ strict: true, preserveTimestamp: true })`。

- [ ] **步骤 4：运行事务和共享规则测试**

运行：`node --test test/mobile-save-transaction.test.mjs test/mobile-save-transfer.test.mjs`

预期：PASS，所有事务测试通过。

- [ ] **步骤 5：提交事务逻辑**

```bash
git add src/save-transfer-controller.js test/mobile-save-transaction.test.mjs
git commit -m "feat(存档): 添加安全导入和恢复事务"
```

### 任务 7：接入设置页确认层和操作状态

**文件：**
- 修改：`src/save-transfer-controller.js`
- 修改：`src/views.js:724`
- 修改：`src/index.html:493`
- 修改：`src/styles.css:4189`
- 修改：`test/mobile-save-transaction.test.mjs`

- [ ] **步骤 1：补充控制器取消和错误映射测试**

测试必须覆盖：文件选择返回 `null` 时不提示错误；确认返回 false 时不备份；`FUTURE_VERSION`、`TOO_LARGE`、损坏 JSON、备份失败、主存档失败分别映射为中文用户提示；导出前调用一次 `saveGame()` 且不改变原 `lastSaveTime` 为未来值。

```js
test('用户取消文件选择时不备份也不显示错误', async () => {
  const events = [];
  const controller = createSaveTransferController({
    platform: { pickImportFile: async () => null },
    showMessage: message => events.push(message),
  });
  await controller.importSave();
  assert.deepEqual(events, []);
});
```

- [ ] **步骤 2：运行测试并确认新增断言失败**

运行：`node --test test/mobile-save-transaction.test.mjs`

预期：FAIL，缺少 `createSaveTransferController`。

- [ ] **步骤 3：在控制器中接入生产依赖和按钮状态**

控制器导出以下 API：

```js
export function bindSaveTransferControls(container, {
  platform = createSavePlatform(),
  reload = () => location.reload(),
} = {});

export async function refreshImportBackupState(container, platform = createSavePlatform());
```

操作中给 `exportSaveBtn`、`importSaveBtn`、`restoreSaveBtn` 增加 `aria-disabled="true"` 和 `.is-busy`，不改变按钮宽高。导出流程先调用 `saveGame()`，再调用 `platform.getAppVersion()` 和 `serializeSaveForExport()`，因此元数据版本来自运行平台且不会改写导出前的真实时间戳。导入流程为：选择文件、解析、显示新旧摘要、确认、事务写入、日志与刷新；生产环境的 `apply` 固定为 `setGameData(value); ensureGpsState();`，重载后继续执行 `main.js` 中已有的旧档迁移。恢复流程先读取并解析备份，再显示摘要并确认。所有文件名使用 `textContent` 写入，禁止拼接未转义文件名。

- [ ] **步骤 4：增加确认层 HTML 和固定摘要字段**

在 `#screen` 内增加一个复用层：

```html
<div id="saveTransferDialog" class="save-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="saveTransferTitle">
  <div class="save-transfer-box">
    <div class="save-transfer-title" id="saveTransferTitle">确认覆盖存档</div>
    <div class="save-transfer-source" id="saveTransferSource"></div>
    <div class="save-transfer-comparison" id="saveTransferComparison"></div>
    <div class="save-transfer-actions">
      <button type="button" id="saveTransferCancel">取消</button>
      <button type="button" id="saveTransferConfirm" class="danger">覆盖当前存档</button>
    </div>
  </div>
</div>
```

摘要顺序固定为：保存时间、角色、糖果、队伍、仓库、图鉴；缺失值显示「未知」，`brendan`/`may` 分别显示「小悠」/「小遥」。

- [ ] **步骤 5：替换设置页旧逻辑并增加恢复入口**

在“角色与存档”组加入：

```html
<div class="reset-save-row">
  <span class="auto-catch-label">恢复导入前存档</span>
  <button class="reset-save-btn" id="restoreSaveBtn" type="button" disabled>恢复</button>
</div>
```

删除 `views.js` 中直接调用 `export_save_data`、把时间增加 10 年和直接 `JSON.parse()` 覆盖的旧事件处理，改为在 `renderSettings()` 末尾调用 `bindSaveTransferControls(container)`。`showSettingsView()` 渲染后异步调用 `refreshImportBackupState()`。

同时在 `renderSystemLogs()` 增加：

```js
case 'export': desc = '导出了存档'; break;
case 'import': desc = '导入了存档'; break;
case 'restore_import_backup': desc = '恢复了导入前存档'; break;
```

- [ ] **步骤 6：增加确认层与稳定按钮尺寸样式**

`.save-transfer-dialog` 复用现有遮罩配色，`.save-transfer-box` 使用不超过 `min(300px, calc(100% - 24px))` 的宽度和 6px 圆角；摘要使用两列 `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)`；`.reset-save-btn` 设置稳定 `min-width` 和 `min-height`；禁用、处理中和危险确认状态颜色清晰且文本不溢出。

- [ ] **步骤 7：运行自动化测试和格式检查**

运行：`npm run test:mobile && git diff --check`

预期：全部 Node 测试 PASS；无尾随空格。若 `README.md` 的用户既有尾随空格被 `git diff --check` 报告，只对本任务文件运行 `git diff --check -- src mobile test src-tauri package.json package-lock.json android update_log.md`，不得修改 `README.md`。

- [ ] **步骤 8：提交设置页交互**

```bash
git add src/save-transfer-controller.js src/views.js src/index.html src/styles.css test/mobile-save-transaction.test.mjs
git commit -m "feat(设置): 添加存档摘要确认和恢复入口"
```

### 任务 8：发布 `v1.0.9` 并完成端到端验证

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`src-tauri/Cargo.toml`
- 修改：`src-tauri/tauri.conf.json`
- 修改：`android/app/build.gradle`
- 修改：`update_log.md`

- [ ] **步骤 1：同步版本号和更新日志**

将版本同步为：

```text
package.json                 1.0.9
package-lock.json            1.0.9
src-tauri/Cargo.toml         1.0.9
src-tauri/tauri.conf.json    1.0.9
android/app/build.gradle     versionCode 10009 / versionName "1.0.9"
```

在 `update_log.md` 顶部增加 `v1.0.9`，记录 Android/桌面双向 JSON 迁移、摘要确认、导入前自动备份和恢复入口。

- [ ] **步骤 2：运行完整自动化验证**

运行：`npm run test:mobile && cargo check --manifest-path src-tauri/Cargo.toml && npm run android:prepare`

预期：Node 测试全部 PASS，Rust 检查 PASS，Capacitor 同步包含 Filesystem 和 Share。

- [ ] **步骤 3：构建正式签名 APK**

运行：`npm run android:build`

预期：输出：

```text
[android] release APK：.../dist/android/pokeidle-android-v1.0.9.apk
[android] SHA-256：.../dist/android/pokeidle-android-v1.0.9.apk.sha256
```

- [ ] **步骤 4：验签并校验摘要**

运行：

```bash
jarsigner -verify -verbose -certs dist/android/pokeidle-android-v1.0.9.apk
shasum -a 256 -c dist/android/pokeidle-android-v1.0.9.apk.sha256
```

预期：`jar verified.` 和 `pokeidle-android-v1.0.9.apk: OK`。

- [ ] **步骤 5：真机手工验收**

按以下顺序逐项确认：

1. Android 导出后系统分享面板可保存 JSON，导出不改变游戏内保存时间为未来值。
2. 桌面导入 Android 文件时显示正确文件名和 6 个摘要字段；取消不改存档。
3. 确认导入后强制结束并重启，仍加载新存档。
4. 设置页“恢复导入前存档”可恢复旧进度，重启后仍有效。
5. 桌面导出 JSON 可在 Android 文件选择器中导入。
6. 大于 20 MB、损坏 JSON、缺少 `items`/`stats`、未来格式都不能覆盖当前存档。
7. Android 应用权限中没有公共存储权限。

- [ ] **步骤 6：检查提交范围并提交发布信息**

运行：`git status --short && git diff --check -- package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json android/app/build.gradle update_log.md`

确认 `README.md` 仍未暂存，然后运行：

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json android/app/build.gradle update_log.md
git commit -m "chore(发布): 发布 v1.0.9 安卓正式版"
```

最终产物为 `dist/android/pokeidle-android-v1.0.9.apk` 和同目录 SHA-256 文件；二进制产物受 `.gitignore` 管理，不提交到源码仓库，发布时上传到 GitHub Release 或网盘。
