import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const MAX_FILES = 80;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function safePath(path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path)) throw new Error(`Invalid workspace path: ${path}`);
  const clean = normalize(path).replaceAll('\\', '/');
  if (clean === '..' || clean.startsWith('../') || clean.split('/').includes('..')) throw new Error(`Workspace path escapes project: ${path}`);
  if (clean === '.' || clean.startsWith('.git/') || clean === '.git' || clean === 'node_modules' || clean.startsWith('node_modules/')) throw new Error(`Reserved workspace path: ${path}`);
  return clean;
}

export function parseWorkspaceManifest(text) {
  if (typeof text !== 'string') throw new TypeError('Workspace manifest must be text');
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let manifest;
  try { manifest = JSON.parse(cleaned); }
  catch (err) { throw new Error(`Coder returned invalid workspace JSON: ${err.message}`); }
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES) throw new Error(`Workspace must contain 1-${MAX_FILES} files`);
  const seen = new Set();
  let total = 0;
  const files = manifest.files.map(file => {
    const path = safePath(file?.path);
    if (seen.has(path)) throw new Error(`Duplicate workspace path: ${path}`);
    if (typeof file?.content !== 'string') throw new Error(`Workspace file ${path} has no text content`);
    const bytes = Buffer.byteLength(file.content);
    if (bytes > MAX_FILE_BYTES) throw new Error(`Workspace file exceeds 512 KiB: ${path}`);
    total += bytes;
    seen.add(path);
    return { path, content: file.content };
  });
  if (total > MAX_TOTAL_BYTES) throw new Error('Workspace exceeds 3 MiB total');
  const testFile = safePath(manifest.testFile || 'test.js');
  if (!seen.has(testFile) || !/\.(?:c?js|mjs)$/.test(testFile)) throw new Error('testFile must name a generated JavaScript file');
  return { files, testFile };
}

export async function createWorkspace(manifest, root, { dependencyRoot } = {}) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const id = `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(5).toString('hex')}`;
  const directory = join(root, id);
  await mkdir(directory, { mode: 0o700 });
  try {
    if (dependencyRoot) await symlink(dependencyRoot, join(directory, 'node_modules'), 'dir');
    for (const file of manifest.files) {
      const target = join(directory, file.path);
      if (target !== directory && !target.startsWith(directory + sep)) throw new Error(`Workspace path escapes project: ${file.path}`);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, file.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
    return { id, directory, testFile: manifest.testFile, files: manifest.files.map(file => file.path) };
  } catch (err) {
    await rm(directory, { recursive: true, force: true });
    throw err;
  }
}

export function runWorkspaceTest(workspace, { packageRoot, timeoutMs = 30000, onOutput = () => {} } = {}) {
  const nodeRoot = dirname(dirname(process.execPath));
  const unit = `triforce-workspace-${process.pid}-${randomBytes(5).toString('hex')}`;
  const testPath = join(workspace.directory, workspace.testFile);
  const args = [
    '--user', '--pipe', '--wait', '--collect', '--quiet', `--unit=${unit}`,
    '--property=PrivateNetwork=yes', '--property=ProtectSystem=strict',
    '--property=ProtectHome=tmpfs', '--property=NoNewPrivileges=yes',
    '--property=RestrictSUIDSGID=yes', '--property=LockPersonality=yes',
    '--property=MemoryMax=384M', '--property=TasksMax=64',
    `--property=RuntimeMaxSec=${Math.ceil(timeoutMs / 1000)}`,
    `--property=BindReadOnlyPaths=${nodeRoot} ${join(packageRoot, 'node_modules')}`,
    `--property=BindPaths=${workspace.directory}`, `--working-directory=${workspace.directory}`,
    '/usr/bin/env', '-i', `PATH=${dirname(process.execPath)}:/usr/bin:/bin`, 'HOME=/tmp', 'NODE_ENV=test',
    process.execPath, '--permission', `--allow-fs-read=${workspace.directory}`,
    `--allow-fs-read=${join(packageRoot, 'node_modules')}`, `--allow-fs-write=${workspace.directory}`, testPath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/systemd-run', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, timedOut = false, settled = false;
    const kill = () => spawn('/usr/bin/systemctl', ['--user', 'kill', '--kill-whom=all', unit], { stdio: 'ignore' });
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const collect = (current, data, kind) => {
      bytes += data.length;
      if (bytes > MAX_OUTPUT_BYTES) { kill(); return current; }
      const value = data.toString(); onOutput(value, kind); return current + value;
    };
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    child.stdout.on('data', data => { stdout = collect(stdout, data, 'stdout'); });
    child.stderr.on('data', data => { stderr = collect(stderr, data, 'stderr'); });
    child.once('error', err => finish(reject, new Error(`Unable to start workspace test: ${err.message}`)));
    child.once('close', code => finish(resolve, { stdout, stderr, exitCode: code ?? 1, timedOut }));
  });
}
