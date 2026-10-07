import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const keystoreDir = join(here, 'keystore');
const keystorePath = join(keystoreDir, 'pokeidle-release.jks');
const propertiesPath = join(here, 'keystore.properties');
const alias = 'pokeidle';

const exists = async path => {
  try { await access(path); return true; } catch (_) { return false; }
};

if (await exists(keystorePath) || await exists(propertiesPath)) {
  throw new Error('签名已存在。keystore 是应用的永久身份，脚本不会覆盖。');
}

const password = randomBytes(32).toString('base64url');
await mkdir(keystoreDir, { recursive: true });

const generated = spawnSync('keytool', [
  '-genkeypair',
  '-keystore', keystorePath,
  '-storetype', 'PKCS12',
  '-storepass', password,
  '-alias', alias,
  '-keypass', password,
  '-keyalg', 'RSA',
  '-keysize', '4096',
  '-validity', '10000',
  '-dname', 'CN=PokeIdle Android Release, O=PokeIdle, C=CN',
], { cwd: resolve(here, '..'), stdio: 'inherit' });

if (generated.error || generated.status !== 0) {
  throw new Error('keytool 生成失败，请确认 JDK 21 的 keytool 在 PATH 中。');
}

await writeFile(propertiesPath, [
  'storeFile=../mobile/keystore/pokeidle-release.jks',
  `storePassword=${password}`,
  `keyAlias=${alias}`,
  `keyPassword=${password}`,
  '',
].join('\n'), { mode: 0o600 });

await chmod(keystorePath, 0o600).catch(() => {});
await chmod(propertiesPath, 0o600).catch(() => {});

console.log('');
console.log('  签名已生成（两个文件都在 .gitignore 里，不会入库）：');
console.log(`    ${keystorePath}`);
console.log(`    ${propertiesPath}`);
console.log('');
console.log('  ⚠ 立刻离线备份 mobile/keystore/ 和 mobile/keystore.properties。');
console.log('    丢失后无法再为 com.pokemon.idle 发布覆盖升级包，玩家只能卸载重装（存档一并清除）。');
console.log('');
