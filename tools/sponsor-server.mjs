// 赞助者名单本地编辑器服务：静态文件 + POST /__sponsor-save
// 用法：在仓库根目录运行 `node tools/sponsor-server.mjs`，打开 http://127.0.0.1:8080/tools/sponsor-maker.html
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url || '/', 'http://127.0.0.1');
  } catch (_) {
    res.statusCode = 400;
    res.end('bad request');
    return;
  }

  if (url.pathname === '/__sponsor-save') {
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method' }); return; }
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
      json(res, 415, { ok: false, error: 'content-type' });
      return;
    }
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2_000_000) throw new Error('payload too large');
      }
      const data = JSON.parse(body);
      const text = String(data.text || '');
      if (!/export const SPONSORS\s*=/.test(text)) throw new Error('invalid sponsors file');
      const target = path.join(root, 'src', 'sponsors.js');
      await fsp.copyFile(target, target + '.bak').catch(() => {});
      await fsp.writeFile(target, text, 'utf8');
      json(res, 200, { ok: true, path: target });
    } catch (e) {
      json(res, 400, { ok: false, error: String(e.message || e) });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end('method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (_) {
    res.statusCode = 400;
    res.end('bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';

  const file = path.join(root, pathname);
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`sponsor editor: http://127.0.0.1:${port}/tools/sponsor-maker.html`);
});
