// 浏览器调试用静态服务器：修正 SVG 等 MIME 类型（Python http.server 对 .svg 返回 image/svg 非标准）
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = join(process.cwd(), 'src');
const PORT = Number(process.argv[2]) || 8000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(normalize(ROOT))) { res.writeHead(403); res.end(); return; }
    const st = await stat(filePath);
    if (st.isDirectory()) { res.writeHead(404); res.end(); return; }
    const data = await readFile(filePath);
    console.log('200', urlPath, MIME[extname(filePath).toLowerCase()]);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (_) {
    console.log('404', req.url);
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`));
