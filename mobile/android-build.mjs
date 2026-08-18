import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactFileName, gradleExecutable, sha256Text } from './android-utils.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const androidDir = join(projectRoot, 'android');
const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));

async function exists(path) {
  if (!path) return false;
  try { await access(path); return true; } catch (_) { return false; }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败，退出码：${result.status ?? 'unknown'}`);
}

function javaMajorVersion(env) {
  const result = spawnSync('java', ['-version'], { env, encoding: 'utf8' });
  if (result.status !== 0) return 0;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = output.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  return Number(match[1]) === 1 ? Number(match[2]) : Number(match[1]);
}

async function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'darwin' ? join(homedir(), 'Library', 'Android', 'sdk') : null,
    process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
  ];
  for (const candidate of candidates) {
    if (candidate && await exists(join(candidate, 'platform-tools'))) return candidate;
  }
  return null;
}

async function buildEnvironment(mode) {
  const env = { ...process.env };
  if (javaMajorVersion(env) < 17) {
    throw new Error('未检测到可用的 JDK 17+。请安装 JDK 17，并设置 JAVA_HOME 后重试。');
  }
  const sdk = await resolveAndroidSdk();
  if (!sdk) throw new Error('未检测到 Android SDK。请安装 API 35，并设置 ANDROID_HOME。');
  env.ANDROID_HOME = sdk;
  env.ANDROID_SDK_ROOT = sdk;

  if (mode === 'release' && !await exists(join(here, 'keystore.properties'))) {
    throw new Error('缺少 mobile/keystore.properties。请先运行 npm run android:signing:init。');
  }
  return env;
}

async function prepareAndroid(env) {
  run(process.execPath, [join(here, 'build-web.mjs')], { env });
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(npx, ['cap', 'sync', 'android'], { env });
}

async function assemble(variant, env) {
  await prepareAndroid(env);
  const task = variant === 'release' ? 'assembleRelease' : 'assembleDebug';
  run(gradleExecutable(), [task], { cwd: androidDir, env });
  return join(androidDir, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
}

async function publishRelease(apkPath) {
  const outputDir = join(projectRoot, 'dist', 'android');
  const outputName = artifactFileName(packageJson.version);
  const outputPath = join(outputDir, outputName);
  await mkdir(outputDir, { recursive: true });
  await copyFile(apkPath, outputPath);
  const apk = await readFile(outputPath);
  await writeFile(`${outputPath}.sha256`, sha256Text(apk, basename(outputPath)));
  console.log(`[android] release APK：${outputPath}`);
  console.log(`[android] SHA-256：${outputPath}.sha256`);
}

async function installDebug(apkPath, env) {
  const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const adbPath = join(env.ANDROID_HOME, 'platform-tools', adbName);
  run(adbPath, ['install', '-r', apkPath], { env });
}

const mode = process.argv[2] || 'release';
if (!['release', 'debug', 'install'].includes(mode)) {
  throw new Error(`未知 Android 构建模式：${mode}`);
}

const variant = mode === 'release' ? 'release' : 'debug';
const env = await buildEnvironment(variant);
const apkPath = await assemble(variant, env);
if (mode === 'release') await publishRelease(apkPath);
else if (mode === 'install') await installDebug(apkPath, env);
else console.log(`[android] debug APK：${apkPath}`);
