// ===== 服务端部署 =====
// 把 server/server.mjs、src/config.js、src/build-info.js 推到服务器并重启 pm2，最后自检接口。
// 同时补一个 src/package.json（type=module），否则 Node 会把 src 下的 .js 当成 CommonJS，动态 import 失败。
// 不保留备份：直接覆盖（源码在仓库里，出事重跑一次这个脚本就回去了）。
//
// 用法（项目根目录）：
//   node tools/deploy-server.mjs           推送 + 重启 + 自检
//   node tools/deploy-server.mjs --dry     只做本地语法检查，不连服务器
//
// 配置沿用 tools/deploy.config.json：key / host / user / port
//   remoteServer  server.mjs 落在服务器哪里（默认 /www/wwwroot/pokeidle/server.mjs）
//   remoteConfig  src/config.js 落在哪里（server.mjs 会 await import('../src/config.js') 读事件参数）
//   pm2Name       pm2 里的应用名（默认 pokeidle-server）
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const CFG_PATH = join(ROOT, 'tools', 'pokeidledeploy.config.json');
const SERVER_FILE = join(ROOT, 'server', 'server.mjs');
const CONFIG_FILE = join(ROOT, 'src', 'config.js');
const BUILD_INFO_FILE = join(ROOT, 'src', 'build-info.js');
const SERVER_PKG_FILE = join(ROOT, 'tools', 'server-src-package.json');
const dry = process.argv.includes('--dry');

function run(cmd, opts = {}) {
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.status !== 0) { console.error(`命令失败（${r.status}）：${cmd.split(' ').slice(0, 4).join(' ')}…`); process.exit(1); }
}
function capture(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log('[1/4] 本地语法检查');
run(`node --check "${SERVER_FILE}"`);
run(`node --check "${CONFIG_FILE}"`);
run(`node --check "${BUILD_INFO_FILE}"`);
if (dry) { console.log('      --dry：不连服务器，结束'); process.exit(0); }

if (!existsSync(CFG_PATH)) { console.error(`缺少配置：${CFG_PATH}`); process.exit(1); }
const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
const key = String(cfg.key || '~/.ssh/rainyun-pokeidle.pem').replace(/^~/, homedir());
const scpBase = `scp -i "${key}" -P ${cfg.port || 22} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
const sshBase = `ssh -i "${key}" -p ${cfg.port || 22} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${cfg.user || 'root'}@${cfg.host}`;
const remoteServer = cfg.remoteServer || '/www/wwwroot/pokeidle/server.mjs';
const remoteConfig = cfg.remoteConfig || '/www/wwwroot/src/config.js';
const pm2Name = cfg.pm2Name || 'pokeidle-server';
const remoteCfgDir = remoteConfig.slice(0, remoteConfig.lastIndexOf('/'));
const remoteBuildInfo = cfg.remoteBuildInfo || `${remoteCfgDir}/build-info.js`;
const remoteSrcPkg = cfg.remoteSrcPkg || `${remoteCfgDir}/package.json`;

console.log(`[2/4] 推送 server.mjs → ${remoteServer}`);
run(`${sshBase} "mkdir -p '${remoteCfgDir}'"`);
run(`${scpBase} "${SERVER_FILE}" ${cfg.user || 'root'}@${cfg.host}:"${remoteServer}"`);
console.log(`      推送 config.js → ${remoteConfig}（事件参数，服务器启动时读它，读不到就用内置兜底值）`);
run(`${scpBase} "${CONFIG_FILE}" ${cfg.user || 'root'}@${cfg.host}:"${remoteConfig}"`);
console.log(`      推送 build-info.js → ${remoteBuildInfo}（最新版本号，防止客户端伪造版本号污染更新提示）`);
run(`${scpBase} "${BUILD_INFO_FILE}" ${cfg.user || 'root'}@${cfg.host}:"${remoteBuildInfo}"`);
console.log(`      推送 package.json → ${remoteSrcPkg}（让 src 下的 .js 按 ES Module 读取）`);
run(`${scpBase} "${SERVER_PKG_FILE}" ${cfg.user || 'root'}@${cfg.host}:"${remoteSrcPkg}"`);

console.log(`[3/4] 重启 pm2：${pm2Name}`);
run(`${sshBase} "pm2 restart ${pm2Name} >/dev/null 2>&1; sleep 2; pm2 list | grep -E '${pm2Name}'"`);

console.log('[4/4] 接口自检');
const base = cfg.apiBase ? cfg.apiBase.replace(/\/hot$/, '') : 'https://pokeidle.shiliu.space/api';
for (const path of ['/activity/', '/events/', '/hot/manifest.json', '/telemetry/stats/']) {
  const { out } = capture(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${base}${path}"`);
  console.log(`      ${path.padEnd(20)} HTTP ${out}`);
}
console.log('完成。');
