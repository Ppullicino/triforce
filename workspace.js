import { mkdir, rm, symlink, writeFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

let gitAvailable = null;
export async function checkGit() {
  if (gitAvailable !== null) return gitAvailable;
  try {
    await execFileAsync('git', ['--version']);
    gitAvailable = true;
  } catch (err) {
    gitAvailable = false;
    console.warn('Warning: git binary is not available. Git workspace history tracking will be disabled.');
  }
  return gitAvailable;
}

export async function runGit(cwd, args) {
  const { stdout } = await execFileAsync('git', [
    '-c', 'user.email=agent@triforce.local',
    '-c', 'user.name=Triforce Agent',
    ...args
  ], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
    }
  });
  return stdout;
}

async function cleanWorkspaceDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }
    const fullPath = join(directory, entry.name);
    await rm(fullPath, { recursive: true, force: true });
  }
}

// Matches directory names produced by createWorkspace: ISO timestamp with ':' → '-', then '-' + 5 random bytes as hex.
const WORKSPACE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[0-9a-f]{10}$/;

export const DEFAULT_WORKSPACE_KEEP = 20;

export async function gcWorkspaces(root, { keep, protect = [] } = {}) {
  const removed = [];
  const kept = [];
  if (typeof root !== 'string' || !root) return { removed, kept };
  const configured = Number.parseInt(keep ?? process.env.TRIFORCE_WORKSPACE_KEEP ?? '', 10);
  const keepCount = Number.isInteger(configured) && configured >= 0 ? configured : DEFAULT_WORKSPACE_KEEP;

  let rootReal;
  let entries;
  try {
    rootReal = await realpath(root);
    entries = await readdir(rootReal, { withFileTypes: true });
  } catch {
    return { removed, kept }; // root missing or unreadable — nothing to collect
  }

  const protectedPaths = new Set();
  for (const path of protect) {
    if (!path) continue;
    try { protectedPaths.add(await realpath(path)); } catch { /* already gone */ }
  }

  // Only real directories (never symlinks) whose names we generated; newest first (ISO names sort lexicographically).
  const candidates = entries
    .filter(entry => entry.isDirectory() && WORKSPACE_DIR_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .reverse();

  for (const [index, name] of candidates.entries()) {
    const fullPath = join(rootReal, name);
    let real;
    try { real = await realpath(fullPath); } catch { continue; }
    if (real !== fullPath || !real.startsWith(rootReal + sep)) continue; // resolves outside WORKSPACES_DIR — never touch
    if (index < keepCount || protectedPaths.has(real)) {
      kept.push(name);
      continue;
    }
    try {
      await rm(real, { recursive: true, force: true });
      removed.push(name);
    } catch (err) {
      console.warn(`Warning: failed to remove old workspace ${name}: ${err.message}`);
    }
  }
  return { removed, kept };
}

export async function getWorkspaceDiff(workspace) {
  const isGit = await checkGit();
  if (!isGit || !workspace || !workspace.directory) return '';
  try {
    const diffText = await runGit(workspace.directory, ['diff', 'HEAD~1', 'HEAD']);
    return diffText;
  } catch (err) {
    return '';
  }
}

export async function createWorkspace(manifest, root, { dependencyRoot, existingWorkspace, iteration = 1 } = {}) {
  const isGit = await checkGit();
  if (existingWorkspace) {
    const directory = existingWorkspace.directory;
    await cleanWorkspaceDirectory(directory);
    for (const file of manifest.files) {
      const target = join(directory, file.path);
      if (target !== directory && !target.startsWith(directory + sep)) throw new Error(`Workspace path escapes project: ${file.path}`);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, file.content, { encoding: 'utf8', mode: 0o600 });
    }
    if (isGit) {
      try {
        await runGit(directory, ['add', '-A']);
        await runGit(directory, ['commit', '--allow-empty', '-m', `iteration-${iteration}`]);
      } catch (err) {
        console.warn(`Warning: failed to commit git iteration-${iteration}: ${err.message}`);
      }
    }
    return { ...existingWorkspace, files: manifest.files.map(file => file.path) };
  } else {
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
      if (isGit) {
        try {
          await runGit(directory, ['init']);
          await runGit(directory, ['commit', '--allow-empty', '-m', 'initial commit']);
          await runGit(directory, ['add', '-A']);
          await runGit(directory, ['commit', '-m', 'iteration-1']);
        } catch (err) {
          console.warn(`Warning: failed to initialize git repository: ${err.message}`);
        }
      }
      return { id, directory, testFile: manifest.testFile, files: manifest.files.map(file => file.path) };
    } catch (err) {
      await rm(directory, { recursive: true, force: true });
      throw err;
    }
  }
}

export function runWorkspaceTest(workspace, { packageRoot, timeoutMs = 30000, onOutput = () => {}, signal } = {}) {
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
    
    let onAbort;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        kill();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        finish(reject, err);
        return;
      }
      onAbort = () => {
        kill();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        finish(reject, err);
      };
      signal.addEventListener('abort', onAbort);
    }

    const collect = (current, data, kind) => {
      bytes += data.length;
      if (bytes > MAX_OUTPUT_BYTES) { kill(); return current; }
      const value = data.toString(); onOutput(value, kind); return current + value;
    };
    child.stdout.on('data', data => { stdout = collect(stdout, data, 'stdout'); });
    child.stderr.on('data', data => { stderr = collect(stderr, data, 'stderr'); });
    child.once('error', err => finish(reject, new Error(`Unable to start workspace test: ${err.message}`)));
    child.once('close', code => finish(resolve, { stdout, stderr, exitCode: code ?? 1, timedOut }));
  });
}
