// 把本地 bot/knowledge 镜像到服务器 AstrBot 的「口袋挂机」知识库。
// 走 AstrBot 自己的上传 API（分块 + embedding + FAISS 一致），不手改 kb.db/index.faiss。
//
//   node tools/sync-kb.mjs                只对比（缺篇 / 变化 / 重复 / 多余）
//   node tools/sync-kb.mjs --apply        上传缺失/变化、删除重复旧副本
//   node tools/sync-kb.mjs --apply --prune  同时删除本地已不存在的远端文档（完整镜像）
//
// 依赖 tools/pokeidledeploy.config.json 里的 SSH（host/user/key）、本机 tar/scp/ssh。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CFG_PATH = join(ROOT, 'tools', 'pokeidledeploy.config.json');
const REMOTE_DIR = '/tmp/pokeidle-kb-sync';
const REMOTE_PY = '/root/.local/share/uv/tools/astrbot/bin/python';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const prune = args.includes('--prune');

if (!existsSync(CFG_PATH)) {
  console.error('缺少 tools/pokeidledeploy.config.json（SSH 配置）');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
const key = cfg.key.replace(/^~/, homedir());
const target = `${cfg.user}@${cfg.host}`;
const sshArgs = ['-i', key, '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new'];

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} 失败（${r.status}）`);
}

const tmp = mkdtempSync(join(tmpdir(), 'pokeidle-kb-'));
const tarPath = join(tmp, 'knowledge.tar.gz');
try {
  console.log('[sync-kb] 打包 bot/knowledge …');
  run('tar', ['-czf', tarPath, '-C', join(ROOT, 'bot'), 'knowledge']);

  console.log('[sync-kb] 上传脚本与打包文件 …');
  run('ssh', [...sshArgs, target, `mkdir -p ${REMOTE_DIR}`]);
  run('scp', [...sshArgs, join(ROOT, 'tools', 'sync-kb-remote.py'), tarPath, `${target}:${REMOTE_DIR}/`]);

  const remoteArgs = [
    `${REMOTE_DIR}/sync-kb-remote.py`,
    '--tar', `${REMOTE_DIR}/knowledge.tar.gz`,
    ...(apply ? ['--apply'] : []),
    ...(prune ? ['--prune'] : []),
  ];
  console.log(`[sync-kb] 远端执行${apply ? '（应用）' : '（对比）'} …\n`);
  run('ssh', [...sshArgs, target, `${REMOTE_PY} ${remoteArgs.join(' ')}`]);
} finally {
  try { spawnSync('ssh', [...sshArgs, target, `rm -rf ${REMOTE_DIR}`], { stdio: 'ignore' }); } catch (_) {}
  rmSync(tmp, { recursive: true, force: true });
}
