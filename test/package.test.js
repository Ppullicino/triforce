import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('npm package contains every backend runtime module', async () => {
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024,
  });
  // npm <=11 emits an array of manifests; npm >=12 emits an object keyed by package name.
  const parsed = JSON.parse(stdout);
  const [manifest] = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const files = new Set(manifest.files.map(file => file.path));

  for (const required of ['agent.js', 'cli-input.js', 'credit-extender.js', 'fs-browser.js', 'router.js', 'run-registry.js', 'sandbox.js', 'server.js', 'subscription-ledger.js', 'verified-chat.js', 'workspace.js', 'packages/protocol/src/index.js']) {
    assert.ok(files.has(required), `npm package is missing ${required}`);
  }
});
