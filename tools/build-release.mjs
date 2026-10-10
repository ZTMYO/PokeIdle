// 一次构建两端：PC（Tauri/NSIS 安装包）+ 安卓（Capacitor 签名 APK），产物统一收进 dist/，只留两个文件。
// 用法：npm run build            —— PC + 安卓
//       npm run build -- --skip-pc       —— 只出安卓（dist 里已有的 PC 包保持不动）
//       npm run build -- --skip-android  —— 只出 PC
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const nsisDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const args = process.argv.slice(2);
// 支持命令行参数，也支持环境变量（PowerShell 下 npm run 不会转发 `-- xxx` 参数，用 SKIP_PC=1 更稳）
const skipPc = args.includes('--skip-pc') || process.env.SKIP_PC === '1';
const skipAndroid = args.includes('--skip-android') || process.env.SKIP_ANDROID === '1';

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

function run(title, script) {
  console.log(`\n===== ${title} =====`);
  const r = spawnSync('npm', ['run', script], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error) throw r.error;
  return r.status === 0;
}

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');

// 两端各自构建；一个失败不拦另一个，最后统一报（失败的端不收集产物）
const pcOk = skipPc || run('1/2 构建 PC 版（Tauri · NSIS 安装包）', 'build:pc');
const apkOk = skipAndroid || run('2/2 构建安卓版（Capacitor · 签名 APK）', 'android:build');
if (skipPc) console.log('\n[release] 已跳过 PC 构建（--skip-pc）');
if (skipAndroid) console.log('\n[release] 已跳过安卓构建（--skip-android）');

// PC 安装包搬进 dist/（优先本次版本名，取不到用最新的一个），并逐字节校验拷贝
// （--skip-pc 时也照常收集：等于"刷新安卓包 + 把已有的 PC 包装回 dist"）
await mkdir(distDir, { recursive: true });
if (pcOk) {
  const exes = (await readdir(nsisDir).catch(() => [])).filter(f => f.endsWith('.exe'));
  let picked = exes.filter(f => f.includes(`_${version}_`)).sort().pop();
  if (!picked && exes.length) {
    const times = [];
    for (const f of exes) times.push({ f, m: (await stat(join(nsisDir, f))).mtimeMs });
    times.sort((a, b) => b.m - a.m);
    picked = times[0].f;
  }
  if (!picked) {
    console.log(`[release] 没在 ${nsisDir} 找到安装包`);
  } else {
    const target = join(distDir, basename(picked));
    await copyFile(join(nsisDir, picked), target);
    const [a, b] = [await sha256(join(nsisDir, picked)), await sha256(target)];
    if (a !== b) throw new Error('PC 安装包拷贝校验失败，请重跑');
  }
}

console.log('\n===== 产物（dist/）=====');
for (const f of (await readdir(distDir)).sort()) {
  const st = await stat(join(distDir, f));
  if (st.isDirectory()) { console.log(`  多余目录  ${f}/`); continue; }
  const sha = await sha256(join(distDir, f));
  const fresh = f.endsWith('.apk') ? (!skipAndroid && apkOk)
    : f.endsWith('.exe') ? (!skipPc && pcOk)
      : null;
  const mark = fresh === null ? '多余文件' : (fresh ? '本次生成' : '未更新  ');
  console.log(`  ${mark}  ${(st.size / 1048576).toFixed(0)} MB  ${sha.slice(0, 12)}…  ${f}`);
}
const failed = [!pcOk && 'PC 版', !apkOk && '安卓版'].filter(Boolean);
if (failed.length) {
  console.log(`\n[release] 失败：${failed.join(' / ')} —— 标「未更新」的是上一次的产物，别发包。`);
  process.exit(1);
}
console.log(`\n[release] 完成：v${version}，两个包都在 ${distDir}`);
