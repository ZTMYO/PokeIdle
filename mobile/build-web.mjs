import { access, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_TAG = '<script src="./mobile-bridge.js"></script>';

export async function buildWeb() {
  const outDir = join(root, 'mobile', 'web');
  await rm(outDir, { recursive: true, force: true });
  await cp(join(root, 'src'), outDir, { recursive: true });

  await build({
    entryPoints: [join(root, 'mobile', 'bridge.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome109'],
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
