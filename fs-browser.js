// fs-browser.js — server-side, root-confined filesystem navigator for the
// Mode 1/2/3 folder picker (protocol 1.2 `fs.*`). Reads only; writes happen
// solely through the explicit `apply` flow. Absorbs the P1 folder-context reader.

import { readdir, readFile, realpath, stat, lstat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path';

/** Names never listed or read, even inside an allowed root (secret material). */
export const DENY_NAMES = new Set([
  '.env', '.env.local', '.env.production', '.envrc',
  '.ssh', '.aws', '.gnupg', '.kube', '.docker',
  '.claude', '.claude.json', '.codex', '.gemini', '.config',
  '.npmrc', '.netrc', '.git-credentials', '.pgpass',
  'id_rsa', 'id_ed25519', 'credentials',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'coverage', '.next', '.cache', '.venv', 'venv']);

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt', '.py',
  '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.c', '.h', '.hpp', '.cpp', '.cc',
  '.css', '.scss', '.html', '.vue', '.svelte', '.yml', '.yaml', '.toml', '.ini',
  '.sh', '.bash', '.zsh', '.sql', '.graphql', '.proto', '.xml', '.gradle',
]);
const ALWAYS_TEXT_FILES = new Set(['package.json', 'README', 'Dockerfile', 'Makefile', 'tsconfig.json', '.gitignore']);

const READ_MAX_FILES = 24;
const READ_MAX_TOTAL_BYTES = 64 * 1024;
const READ_MAX_FILE_BYTES = 16 * 1024;

/** @returns {string[]} configured roots (realpath'd where they exist). */
export function roots(envValue = process.env.TRIFORCE_FS_ROOTS) {
  const raw = String(envValue || homedir()).split(':').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const r of raw) {
    if (!isAbsolute(r)) continue;
    try { out.push(existsSync(r) ? realpathSync(r) : resolve(r)); } catch { out.push(resolve(r)); }
  }
  return out.length ? [...new Set(out)] : [resolve(homedir())];
}

function underRoot(target, rootList) {
  return rootList.some(root => target === root || target.startsWith(root.endsWith(sep) ? root : root + sep));
}

/**
 * Resolve `target` and verify it (and every symlink hop) stays inside an allowed
 * root and hits no denylisted name. Returns the realpath.
 * @param {string} target
 * @param {string[]} [rootList]
 * @returns {Promise<string>}
 * @throws on traversal, symlink escape, or denylist hit
 */
export async function confinePath(target, rootList = roots()) {
  if (typeof target !== 'string' || !target || target.includes('\0')) throw new Error('Invalid path');
  const resolved = resolve(target);
  const resolvedRoots = [];
  for (const r of rootList) {
    try { resolvedRoots.push(await realpath(r)); } catch { resolvedRoots.push(resolve(r)); }
  }
  const containingRoot = resolvedRoots.find(r => resolved === r || resolved.startsWith((r.endsWith(sep) ? r : r + sep)));
  if (!containingRoot) throw new Error('Path is outside the allowed roots');

  // Walk only the segments at or below the root, resolving symlinks and
  // re-checking confinement + denylist at each hop.
  const rest = resolved === containingRoot ? [] : resolved.slice(containingRoot.length + 1).split(sep).filter(Boolean);
  let current = containingRoot;
  for (const part of rest) {
    if (DENY_NAMES.has(part)) throw new Error(`Path segment "${part}" is not accessible`);
    current = join(current, part);
    let real;
    try { real = await realpath(current); } catch { break; } // a not-yet-existing tail is fine for callers that create it
    if (!underRoot(real, resolvedRoots)) throw new Error('Symlink escapes the allowed roots');
    if (DENY_NAMES.has(basename(real))) throw new Error('Path resolves into a denylisted location');
  }
  try { return await realpath(resolved); } catch { return resolved; }
}

async function describe(dirent, fullPath) {
  const out = { name: dirent.name, type: dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : 'other', isSymlink: dirent.isSymbolicLink(), size: 0, mtime: null, isGitRepo: false };
  try {
    const info = await stat(fullPath);
    out.size = info.size;
    out.mtime = info.mtimeMs;
    if (out.type === 'dir') out.isGitRepo = existsSync(join(fullPath, '.git'));
  } catch { /* broken symlink etc. — report what we have */ }
  return out;
}

/**
 * One directory level. Dotfiles and denylisted names are hidden by default.
 * @param {string} dirPath
 * @param {{ roots?: string[], showHidden?: boolean }} [opts]
 */
export async function list(dirPath, opts = {}) {
  const rootList = opts.roots ?? roots();
  const real = await confinePath(dirPath, rootList);
  const info = await stat(real);
  if (!info.isDirectory()) throw new Error('Not a directory');
  const entries = await readdir(real, { withFileTypes: true });
  const visible = [];
  for (const entry of entries) {
    if (DENY_NAMES.has(entry.name)) continue;
    if (!opts.showHidden && entry.name.startsWith('.')) continue;
    visible.push(await describe(entry, join(real, entry.name)));
  }
  visible.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { path: real, entries: visible };
}

/** Single-entry detail (breadcrumb / preview). */
export async function statEntry(entryPath, opts = {}) {
  const rootList = opts.roots ?? roots();
  const real = await confinePath(entryPath, rootList);
  const info = await lstat(real);
  return {
    path: real,
    name: basename(real),
    type: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other',
    size: info.size,
    mtime: info.mtimeMs,
    isSymlink: info.isSymbolicLink(),
    isGitRepo: info.isDirectory() && existsSync(join(real, '.git')),
  };
}

function looksTextual(name) {
  return TEXT_EXT.has(extname(name)) || ALWAYS_TEXT_FILES.has(name);
}

/**
 * Read-only, size-budgeted text bundle of a directory tree — Mode 3 folder
 * context and the Mode 1 briefing. Confined to roots; skips secrets and vendored dirs.
 * @param {string} dirPath
 * @param {{ roots?: string[], maxFiles?: number, maxBytes?: number }} [opts]
 * @returns {Promise<string>}  `=== rel/path ===\n<content>` blocks joined by blank lines
 */
export async function readBudgeted(dirPath, opts = {}) {
  const rootList = opts.roots ?? roots();
  const maxFiles = opts.maxFiles ?? READ_MAX_FILES;
  const maxBytes = opts.maxBytes ?? READ_MAX_TOTAL_BYTES;
  let root;
  try { root = await confinePath(dirPath, rootList); } catch { return ''; }

  const picked = [];
  let bytes = 0;
  const queue = [root];
  while (queue.length && picked.length < maxFiles && bytes < maxBytes) {
    const dir = queue.shift();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => Number(b.isFile()) - Number(a.isFile()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || DENY_NAMES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      let real;
      try { real = await realpath(full); } catch { continue; }
      if (!underRoot(real, rootList.map(r => resolve(r))) && !real.startsWith(root + sep) && real !== root) continue;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) queue.push(full); continue; }
      if (!entry.isFile() || !looksTextual(entry.name)) continue;
      let info;
      try { info = await stat(real); } catch { continue; }
      if (info.size > READ_MAX_FILE_BYTES || bytes + Math.min(info.size, READ_MAX_FILE_BYTES) > maxBytes) continue;
      let content;
      try { content = await readFile(real, 'utf8'); } catch { continue; }
      const rel = real.startsWith(root + sep) ? real.slice(root.length + 1) : entry.name;
      picked.push(`=== ${rel} ===\n${content}`);
      bytes += Buffer.byteLength(content);
      if (picked.length >= maxFiles || bytes >= maxBytes) break;
    }
  }
  return picked.join('\n\n');
}
