// folder-context.js — read-only, size-budgeted text bundle of a real directory,
// for Mode 3 (verified chat) folder context. Confined to allowed roots.
// P2's fs-browser will absorb this (shared budgeted reader); keep the surface small.

import { realpath, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt', '.py',
  '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.css', '.html',
  '.yml', '.yaml', '.toml', '.sh', '.sql', '.env.example',
]);
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'coverage', '.next', '.cache']);
const DEFAULT_MAX_FILES = 24;
const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 16 * 1024;

function withinRoot(target, roots) {
  return roots.some(root => target === root || target.startsWith(root.endsWith(sep) ? root : root + sep));
}

/**
 * @param {string} dir            absolute path to read
 * @param {string[]} roots        allowed roots (reads confined here)
 * @param {{ maxFiles?: number, maxBytes?: number }} [limits]
 * @returns {Promise<string>}     concatenated `=== path ===\n<content>` blocks, or ''
 */
export async function readFolderContext(dir, roots, limits = {}) {
  if (!dir || !Array.isArray(roots) || !roots.length) return '';
  const maxFiles = limits.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;

  let realRoot;
  const resolvedRoots = [];
  try {
    realRoot = await realpath(resolve(dir));
    for (const r of roots) {
      try { resolvedRoots.push(await realpath(resolve(r))); } catch { /* skip */ }
    }
  } catch {
    return '';
  }
  if (!withinRoot(realRoot, resolvedRoots)) return '';

  const picked = [];
  let bytes = 0;
  const queue = [realRoot];
  while (queue.length && picked.length < maxFiles && bytes < maxBytes) {
    const current = queue.shift();
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => Number(b.isFile()) - Number(a.isFile()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(current, entry.name);
      let realFull;
      try { realFull = await realpath(full); } catch { continue; }
      if (!withinRoot(realFull, resolvedRoots)) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIR.has(entry.name)) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!TEXT_EXT.has(extname(entry.name)) && entry.name !== 'package.json' && entry.name !== 'README') continue;
      let info;
      try { info = await stat(realFull); } catch { continue; }
      if (info.size > MAX_FILE_BYTES || bytes + Math.min(info.size, MAX_FILE_BYTES) > maxBytes) continue;
      let content;
      try { content = await readFile(realFull, 'utf8'); } catch { continue; }
      const rel = realFull.startsWith(realRoot + sep) ? realFull.slice(realRoot.length + 1) : entry.name;
      picked.push(`=== ${rel} ===\n${content}`);
      bytes += Buffer.byteLength(content);
      if (picked.length >= maxFiles || bytes >= maxBytes) break;
    }
  }
  return picked.join('\n\n');
}
