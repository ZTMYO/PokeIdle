import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWeb } from './build-web.mjs';

const REQUIRED_JAVA = 21;
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const androidDir = join(root, 'android');
const gradleHome = join(here, '.gradle-home');

const exists = async path => {
  try { await access(path); return true; } catch (_) { return false; }
};

function javaMajorVersion(env) {
  const java = env.JAVA_HOME
    ? join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const { status, stdout, stderr } = spawnSync(java, ['-version'], { env, encoding: 'utf8' });
  if (status !== 0) return 0;
  const match = `${stdout || ''}\n${stderr || ''}`.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  return Number(match[1]) === 1 ? Number(match[2]) : Number(match[1]);
}

async function resolveSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' && process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.platform === 'darwin' && join(homedir(), 'Library', 'Android', 'sdk'),
    process.platform === 'linux' && join(homedir(), 'Android', 'Sdk'),
  ];
  for (const candidate of candidates) {
    if (candidate && await exists(join(candidate, 'platform-tools'))) return candidate;
  }
  return null;
}

// package.json 的 version 是唯一版本源；版本号只写在这一个地方，避免三处手改漂移
async function syncVersion() {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const [major, minor, patch] = version.split('.').map(Number);
  const versionCode = major * 10000 + minor * 100 + patch;
  const path = join(androidDir, 'app', 'build.gradle');
  const source = await readFile(path, 'utf8');
  const updated = source
    .replace(/versionCode \d+/, `versionCode ${versionCode}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`);
  if (updated !== source) await writeFile(path, updated);
  return { version, versionCode };
}

async function buildEnv() {
  const env = { ...process.env };
  env.GRADLE_USER_HOME = gradleHome;
  if (javaMajorVersion(env) < REQUIRED_JAVA) {
    throw new Error(`需要 JDK ${REQUIRED_JAVA} 或更高版本（当前 JAVA_HOME=${process.env.JAVA_HOME || '未设置'}）。`);
  }
  const sdk = await resolveSdk();
  if (!sdk) throw new Error('未检测到 Android SDK，请设置 ANDROID_HOME 指向 SDK 根目录。');
  env.ANDROID_HOME = sdk;
  env.ANDROID_SDK_ROOT = sdk;

  const variables = await readFile(join(androidDir, 'variables.gradle'), 'utf8');
  const platform = Number(variables.match(/compileSdkVersion\s*=\s*(\d+)/)?.[1]) || 35;
  if (!await exists(join(sdk, 'platforms', `android-${platform}`))) {
    throw new Error(`缺少 Android SDK Platform ${platform}，请先执行：\n  sdkmanager "platforms;android-${platform}" "build-tools;${platform}.0.0"`);
  }
  return env;
}

function run(command, args, options = {}) {
  // Windows 上 npx.cmd / gradlew.bat 无法被 CreateProcess 直接执行，必须交给 cmd.exe
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 退出码 ${result.status}`);
}

async function assemble(variant, env) {
  await syncVersion();
  await buildWeb();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(npx, ['cap', 'sync', 'android'], { cwd: root, env });
  run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [`assemble${variant === 'release' ? 'Release' : 'Debug'}`], { cwd: androidDir, env });
  return join(androidDir, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
}

const mode = process.argv[2] || 'debug';
if (!['debug', 'release', 'install'].includes(mode)) throw new Error(`未知构建模式：${mode}`);

const env = await buildEnv();
const variant = mode === 'release' ? 'release' : 'debug';
if (variant === 'release' && !await exists(join(here, 'keystore.properties'))) {
  throw new Error('缺少 mobile/keystore.properties，请先执行 npm run android:keystore。');
}

const apk = await assemble(variant, env);

if (mode === 'release') {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const outDir = join(root, 'dist', 'android');
  const outPath = join(outDir, `pokeidle-android-v${version}.apk`);
  await mkdir(outDir, { recursive: true });
  await copyFile(apk, outPath);
  console.log(`[android] ${outPath}`);
} else if (mode === 'install') {
  run(join(env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'), ['install', '-r', apk], { env });
} else {
  console.log(`[android] ${apk}`);
}
