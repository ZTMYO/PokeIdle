import { access, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const MOBILE_BRIDGE_TAG = '<script src="./mobile-bridge.js"></script>';
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

export function injectBridgeScript(html) {
  if (html.includes(MOBILE_BRIDGE_TAG)) return html;
  if (!html.includes('</head>')) throw new Error('src/index.html 缺少 </head>，无法注入移动端 bridge');
  return html.replace('</head>', `  ${MOBILE_BRIDGE_TAG}\n</head>`);
}

export async function copyWebSource(sourceDir, outputDir) {
  await rm(outputDir, { recursive: true, force: true });
  await cp(sourceDir, outputDir, { recursive: true });
}

export async function buildMobileWeb({
  sourceDir = join(projectRoot, 'src'),
  outputDir = join(projectRoot, 'mobile', 'web'),
  bridgeEntry = join(projectRoot, 'mobile', 'bridge-source.js'),
} = {}) {
  await copyWebSource(sourceDir, outputDir);

  await build({
    entryPoints: [bridgeEntry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome109'],
    minify: true,
    outfile: join(outputDir, 'mobile-bridge.js'),
  });

  const indexPath = join(outputDir, 'index.html');
  const indexHtml = await readFile(indexPath, 'utf8');
  await writeFile(indexPath, injectBridgeScript(indexHtml));

  await Promise.all([
    access(join(outputDir, 'mobile-bridge.js')),
    access(join(outputDir, 'audio', 'Battle.mp3')),
    access(join(outputDir, 'pokemon-data', 'pokedex.json')),
  ]);

  return outputDir;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const outputDir = await buildMobileWeb();
  console.log(`[android] Web 资源已生成：${outputDir}`);
}
