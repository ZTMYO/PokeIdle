import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
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

// 本机可用的 JDK 21 候选：JAVA_HOME 优先，其次常见安装位置（Android Studio 自带的 JBR 也够用）
async function pickJavaHome(env) {
  const candidates = [
    process.env.JAVA_HOME,
    'D:/zulu21.34.19-ca-jdk21.0.3-win_x64',
    'C:/Program Files/Android/Android Studio/jbr',
  ];
  for (const parent of ['C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Java']) {
    try { for (const name of await readdir(parent)) candidates.push(join(parent, name)); } catch (_) { /* 目录不存在就算了 */ }
  }
  for (const home of candidates.filter(Boolean)) {
    if (!await exists(join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))) continue;
    if (javaMajorVersion({ ...env, JAVA_HOME: home }) >= REQUIRED_JAVA) return home;
  }
  return null;
}

async function buildEnv() {
  const env = { ...process.env };
  env.GRADLE_USER_HOME = gradleHome;
  if (javaMajorVersion(env) < REQUIRED_JAVA) {
    const home = await pickJavaHome(env);
    if (!home) {
      throw new Error(`需要 JDK ${REQUIRED_JAVA} 或更高版本（当前 JAVA_HOME=${process.env.JAVA_HOME || '未设置'}），也没在常见位置找到可用的 JDK。`);
    }
    env.JAVA_HOME = home;
    // PATH 的键名在 Windows 上可能是 Path：按真实键名追加，绝不要新建大写键（那会让子进程只剩 JDK 一条 PATH）
    const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH');
    const joined = join(home, 'bin') + (process.platform === 'win32' ? ';' : ':');
    if (pathKey) env[pathKey] = joined + env[pathKey];
    else env.PATH = join(home, 'bin');
    console.log(`[android] 系统默认 JDK 版本过低，自动改用 ${home}`);
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
  // 直接让跑本脚本的这个 node 去执行 Capacitor CLI：npx(.cmd) 依赖 PATH，换个终端就可能找不到
  run(process.execPath, [join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'], { cwd: root, env });
  run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [`assemble${variant === 'release' ? 'Release' : 'Debug'}`], { cwd: androidDir, env });
  // 产物名由 app/build.gradle 定制（口袋挂机_<version>.apk），这里扫目录取最新的，别写死文件名
  const apkDir = join(androidDir, 'app', 'build', 'outputs', 'apk', variant);
  const apks = [];
  for (const f of await readdir(apkDir)) {
    if (!f.endsWith('.apk')) continue;
    apks.push({ path: join(apkDir, f), mtime: (await stat(join(apkDir, f))).mtimeMs });
  }
  if (apks.length === 0) throw new Error(`没找到 ${variant} 产物：${apkDir}`);
  apks.sort((a, b) => b.mtime - a.mtime);
  return apks[0].path;
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
  const outDir = join(root, 'dist');
  const outPath = join(outDir, `口袋挂机_${version}.apk`);
  await mkdir(outDir, { recursive: true });
  await copyFile(apk, outPath);
  // 校验拷贝完整（源与目标逐字节一致）后打印校验和；不落 .sha256 文件，dist/ 只留产物本身
  const srcSha = createHash('sha256').update(await readFile(apk)).digest('hex');
  const dstSha = createHash('sha256').update(await readFile(outPath)).digest('hex');
  if (srcSha !== dstSha) throw new Error('APK 拷贝校验失败，请重跑');
  console.log(`[android] ${outPath}`);
  console.log(`[android] sha256 ${dstSha}`);
} else if (mode === 'install') {
  run(join(env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'), ['install', '-r', apk], { env });
} else {
  console.log(`[android] ${apk}`);
}
