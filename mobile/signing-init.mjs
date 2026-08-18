import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { formatSigningProperties } from './android-utils.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const keystoreDir = join(here, 'keystore');
const keystorePath = join(keystoreDir, 'pokeidle-release.jks');
const propertiesPath = join(here, 'keystore.properties');
const alias = 'pokeidle-release';

async function exists(path) {
  try { await access(path); return true; } catch (_) { return false; }
}

if (await exists(keystorePath) || await exists(propertiesPath)) {
  throw new Error('签名文件已存在。为避免破坏后续升级能力，脚本不会覆盖 mobile/keystore 或 mobile/keystore.properties。');
}

const keytoolCheck = spawnSync('keytool', ['-help'], { encoding: 'utf8' });
if (keytoolCheck.status !== 0) {
  throw new Error('未检测到可用的 keytool。请先安装 JDK 21，并确认 java 和 keytool 可在 PATH 中执行。');
}

const password = randomBytes(32).toString('base64url');
await mkdir(keystoreDir, { recursive: true });

const generated = spawnSync('keytool', [
  '-genkeypair',
  '-v',
  '-keystore', keystorePath,
  '-storetype', 'PKCS12',
  '-storepass', password,
  '-alias', alias,
  '-keypass', password,
  '-keyalg', 'RSA',
  '-keysize', '4096',
  '-validity', '10000',
  '-dname', 'CN=PokeIdle Android Release, OU=PokeIdle, O=PokeIdle Community, L=Shanghai, ST=Shanghai, C=CN',
], { cwd: projectRoot, stdio: 'inherit' });

if (generated.status !== 0) {
  throw new Error(`keytool 生成签名失败，退出码：${generated.status ?? 'unknown'}`);
}

await writeFile(propertiesPath, formatSigningProperties({ password, alias }), { mode: 0o600 });
await chmod(propertiesPath, 0o600);
await chmod(keystorePath, 0o600);

console.log('[android] release 签名已创建：');
console.log(`  keystore: ${keystorePath}`);
console.log(`  config:   ${propertiesPath}`);
console.log('[android] 请离线备份以上两个文件。丢失后无法覆盖升级 com.pokemon.idle。');
