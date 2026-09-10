import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, '..');

test('`triforce doctor` reports dependency, login and server status and exits 0', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['cli.js', 'doctor'], {
    cwd: repoRoot,
    env: { ...process.env, TRIFORCE_TOKEN: '', PATH: '/nonexistent' },
    timeout: 60_000,
  });
  assert.match(stdout, /triforce doctor/);
  assert.match(stdout, /CLI logins:/);
  assert.match(stdout, /Server:/);
  assert.match(stdout, /Workspace root:/);
});

test('`triforce doctor` surfaces capabilities when a server + token are present', async () => {
  // Run a throwaway server, point doctor at it via a temp .env copy of the repo.
  const dir = await mkdtemp(join(tmpdir(), 'triforce-doctor-'));
  try {
    await cp(repoRoot, dir, {
      recursive: true,
      filter: src => !src.includes('/node_modules') && !src.includes('/.git/') && !src.endsWith('/.git'),
    });
    await writeFile(join(dir, '.env'), 'TRIFORCE_TOKEN=doctor-token\n', { mode: 0o600 });
    // symlink node_modules so the copied server can resolve deps
    await rm(join(dir, 'node_modules'), { recursive: true, force: true });
    const { symlink } = await import('node:fs/promises');
    await symlink(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');

    const { spawn } = await import('node:child_process');
    const { once } = await import('node:events');
    const port = String(37_000 + Math.floor(Math.random() * 5_000));
    const server = spawn(process.execPath, ['server.js'], {
      cwd: dir, env: { ...process.env, PORT: port, TRIFORCE_TOKEN: 'doctor-token' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await Promise.race([once(server.stdout, 'data'), new Promise((_, r) => setTimeout(() => r(new Error('server never started')), 15000))]);
      const { stdout } = await execFileAsync(process.execPath, ['cli.js', 'doctor'], { cwd: dir, env: { ...process.env, TRIFORCE_TOKEN: 'doctor-token', PORT: port }, timeout: 60_000 });
      assert.match(stdout, /reachable — protocol 1\.2\.0/);
      assert.match(stdout, /modes: \[1,2,3\]/);
      assert.match(stdout, /Triforce access/);
    } finally {
      server.kill('SIGTERM');
      await once(server, 'exit').catch(() => {});
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
