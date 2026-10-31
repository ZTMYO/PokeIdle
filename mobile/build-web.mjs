import { access, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { spawn } from 'node:child_process';

import { syncVersion } from '../tools/sync-version.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_TAG = '<script src="./mobile-bridge.js"></script>';

export async function buildWeb() {
  await syncVersion(); // 版本号/版本戳：package.json 是唯一手改处
  // 资源清单要在拷贝之前生成：客户端启动时拿它当基线，跟服务器清单比对做热更
  await new Promise((ok, bad) => {
    const p = spawn(process.execPath, [join(root, 'tools', 'gen-manifest.mjs')], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? ok() : bad(new Error('gen-manifest 失败'))));
  });
  const outDir = join(root, 'mobile', 'web');
  await rm(outDir, { recursive: true, force: true });
  await cp(join(root, 'src'), outDir, { recursive: true });

  await build({
    entryPoints: [join(root, 'mobile', 'bridge.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome83'],
    minify: true,
    outfile: join(outDir, 'mobile-bridge.js'),
  });

  const indexPath = join(outDir, 'index.html');
  const indexHtml = await readFile(indexPath, 'utf8');
  if (!indexHtml.includes(BRIDGE_TAG)) {
    if (!indexHtml.includes('</head>')) throw new Error('src/index.html 缺少 </head>，无法注入 bridge');
    await writeFile(indexPath, indexHtml.replace('</head>', `  ${BRIDGE_TAG}\n</head>`));
  }

  await Promise.all([
    access(join(outDir, 'mobile-bridge.js')),
    access(join(outDir, 'pokemon-data', 'pokedex.json')),
    access(join(outDir, 'audio', 'Battle.mp3')),
  ]);

  return outDir;
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '')) {
  console.log(`[android] Web 资源已生成：${await buildWeb()}`);
}
