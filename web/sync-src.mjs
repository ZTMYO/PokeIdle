// ===== 源码同步脚本 =====
// 构建/开发前把游戏源码中教程解析所需的三份文件复制到 web/src/，
// 使 web 目录脱离父级 src 也能独立构建。tutorial.js 以 ?raw / import 引用 web/src 下的本地副本。
// 同时把根目录 update_log.md 复制到 web/public/（更新日志子页面运行时 fetch 渲染）。
// 每次 dev / build 都会重新同步，源码/日志更新后无需手动复制。
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FILES = ['views.js', 'config.js', 'team.js'];
const destDir = join(here, 'src');
const srcDir = join(here, '..', 'src');

mkdirSync(destDir, { recursive: true });
for (const f of FILES) {
  const src = join(srcDir, f);
  if (!existsSync(src)) {
    console.error(`[sync-src] 源文件不存在：${src}`);
    process.exit(1);
  }
  copyFileSync(src, join(destDir, f));
}
console.log(`[sync-src] 已同步 ${FILES.join(', ')} -> web/src/`);

// 更新日志：根目录 update_log.md -> web/public/update_log.md
const publicDir = join(here, 'public');
mkdirSync(publicDir, { recursive: true });
const logSrc = join(here, '..', 'update_log.md');
if (existsSync(logSrc)) {
  copyFileSync(logSrc, join(publicDir, 'update_log.md'));
  console.log('[sync-src] 已同步 update_log.md -> web/public/');
} else {
  console.warn('[sync-src] 未找到根目录 update_log.md，跳过更新日志同步');
}
