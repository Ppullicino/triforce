import { mkdir, rm, symlink, writeFile, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
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

// ── Real-folder snapshot / apply (protocol 1.2 filesystem navigator) ──

const SNAPSHOT_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', 'coverage', '.next', '.cache', '.venv', 'venv']);
const HASH_MAX_FILES = 5000;

function parseGitignore(text) {
  const rules = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    const body = (negate ? line.slice(1) : line).replace(/^\/+/, '').replace(/\/+$/, '');
    if (!body) continue;
    rules.push({ negate, body, dirOnly: raw.trimEnd().endsWith('/') });
  }
  return rules;
}

function gitignoreMatch(rules, relPath, isDir) {
  let ignored = false;
  const segments = relPath.split('/');
  for (const rule of rules) {
    const { body } = rule;
    let hit = false;
    if (body.includes('/')) {
      hit = relPath === body || relPath.startsWith(body + '/');
    } else if (body.startsWith('*.')) {
      const ext = body.slice(1);
      hit = relPath.endsWith(ext);
    } else {
      hit = segments.includes(body);
    }
    if (hit && rule.dirOnly && !isDir && !relPath.includes(body + '/')) hit = false;
    if (hit) ignored = !rule.negate;
  }
  return ignored;
}

async function isBinary(path) {
  try {
    const fd = await readFile(path);
    const slice = fd.subarray(0, 8192);
    return slice.includes(0);
  } catch { return true; }
}

/**
 * Walk a real directory, honouring .gitignore, and return its text files plus a
 * content hash per file. Used to seed a workspace and to detect drift before apply.
 * @param {string} realDir
 * @param {{ maxFiles?: number, maxBytes?: number, hashOnly?: boolean }} [opts]
 */
export async function snapshotDir(realDir, opts = {}) {
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const maxBytes = opts.maxBytes ?? MAX_TOTAL_BYTES;
  const root = await realpath(realDir);
  let gitRules = [];
  try { gitRules = parseGitignore(await readFile(join(root, '.gitignore'), 'utf8')); } catch { /* none */ }

  const files = [];
  const hashes = {};
  const mtimes = {};
  let total = 0;
  let truncated = false;
  const queue = [''];
  while (queue.length) {
    const relDir = queue.shift();
    let entries;
    try { entries = await readdir(join(root, relDir), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (SNAPSHOT_SKIP_DIRS.has(entry.name)) continue;
      if (gitignoreMatch(gitRules, rel, entry.isDirectory())) continue;
      const full = join(root, rel);
      if (entry.isDirectory()) { queue.push(rel); continue; }
      if (!entry.isFile()) continue;
      let info;
      try { info = await stat(full); } catch { continue; }
      const hashOnly = opts.hashOnly === true;
      if (!hashOnly) {
        if (files.length >= maxFiles || total + info.size > maxBytes) { truncated = true; continue; }
        if (info.size > MAX_FILE_BYTES || await isBinary(full)) { truncated = true; continue; }
      }
      if (Object.keys(hashes).length >= HASH_MAX_FILES) { truncated = true; break; }
      let content;
      try { content = await readFile(full, 'utf8'); } catch { continue; }
      hashes[rel] = createHash('sha256').update(content).digest('hex');
      mtimes[rel] = info.mtimeMs;
      if (!hashOnly) { files.push({ path: rel, content }); total += Buffer.byteLength(content); }
    }
  }
  return { root, files, hashes, mtimes, truncated };
}

/** Content-hash map of a real dir (drift detection for apply pre-flight). */
export async function hashTree(realDir) {
  const { hashes } = await snapshotDir(realDir, { hashOnly: true });
  return hashes;
}

/**
 * Seed a fresh workspace copy from a real directory's current contents.
 * @param {string} realDir
 * @param {string} root  TRIFORCE_WORKSPACE_ROOT
 */
export async function createWorkspaceFromDir(realDir, root, { dependencyRoot } = {}) {
  const snapshot = await snapshotDir(realDir);
  const detectedTest = snapshot.files.find(f => /(^|\/)(test\.[cm]?js|.*\.test\.[cm]?js)$/.test(f.path))?.path;
  const files = [...snapshot.files];
  let testFile = detectedTest;
  if (!testFile) {
    testFile = 'triforce.smoke.test.js';
    files.push({ path: testFile, content: "// Triforce seed smoke test (no project test detected)\nprocess.exit(0);\n" });
  }
  const workspace = await createWorkspace({ files, testFile }, root, { dependencyRoot });
  return { ...workspace, sourceDir: snapshot.root, snapshot };
}

/**
 * Write a completed run's changes back into the real folder.
 * @param {string} workspaceDir  the sandboxed copy after a run
 * @param {string} realDir       the user's real folder
 * @param {object} opts
 * @param {{ hashes: Record<string,string> }} opts.snapshot  from createWorkspaceFromDir
 * @param {'branch'|'refuse'|'force'} [opts.gitPolicy]
 * @param {string[]} [opts.paths]  restrict apply to these relative paths
 * @returns {Promise<{ applied: string[], deleted: string[], skipped: string[], branch: string|null, reason?: string }>}
 */
export async function applyDiff(workspaceDir, realDir, opts = {}) {
  const { snapshot, gitPolicy = 'branch', paths } = opts;
  const realRoot = await realpath(realDir);
  const allow = paths ? new Set(paths.map(p => safePath(p))) : null;

  // 1. Drift check — the real folder must be unchanged since the snapshot.
  if (snapshot?.hashes) {
    const current = await hashTree(realRoot);
    const drifted = [];
    for (const [rel, hash] of Object.entries(snapshot.hashes)) {
      if (current[rel] !== hash) drifted.push(rel);
    }
    for (const rel of Object.keys(current)) {
      if (!(rel in snapshot.hashes)) drifted.push(rel);
    }
    if (drifted.length) {
      return { applied: [], deleted: [], skipped: drifted, branch: null, reason: `real folder changed since snapshot (${drifted.slice(0, 5).join(', ')}${drifted.length > 5 ? ', …' : ''})` };
    }
  }

  // 2. Git policy.
  let branch = null;
  const isGit = (await checkGit()) && await realpath(join(realRoot, '.git')).then(() => true, () => false);
  if (isGit) {
    let dirty = '';
    try { dirty = (await runGit(realRoot, ['status', '--porcelain'])).trim(); } catch { /* treat as clean */ }
    if (dirty && gitPolicy === 'refuse') {
      return { applied: [], deleted: [], skipped: [], branch: null, reason: 'real folder is a dirty git tree (gitPolicy=refuse)' };
    }
    if (gitPolicy === 'branch') {
      branch = `triforce/apply-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
      try { await runGit(realRoot, ['checkout', '-b', branch]); } catch (err) { return { applied: [], deleted: [], skipped: [], branch: null, reason: `could not create branch: ${err.message}` }; }
    }
  }

  // 3. Diff workspace vs snapshot, write into the real folder.
  const after = await snapshotDir(workspaceDir);
  const afterByPath = new Map(after.files.map(f => [f.path, f.content]));
  const applied = [];
  const deleted = [];
  const skipped = [];

  for (const [rel, content] of afterByPath) {
    if (rel === 'triforce.smoke.test.js' || rel === 'node_modules') continue;
    let safe;
    try { safe = safePath(rel); } catch { skipped.push(rel); continue; }
    if (allow && !allow.has(safe)) continue;
    if (snapshot?.hashes?.[rel] === createHash('sha256').update(content).digest('hex')) continue; // unchanged
    const target = join(realRoot, safe);
    if (target !== realRoot && !target.startsWith(realRoot + sep)) { skipped.push(rel); continue; }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    applied.push(safe);
  }
  for (const rel of Object.keys(snapshot?.hashes ?? {})) {
    if (afterByPath.has(rel)) continue;
    let safe;
    try { safe = safePath(rel); } catch { continue; }
    if (allow && !allow.has(safe)) continue;
    try { await rm(join(realRoot, safe), { force: true }); deleted.push(safe); } catch { skipped.push(safe); }
  }

  return { applied, deleted, skipped, branch };
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
