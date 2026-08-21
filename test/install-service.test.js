import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

test('install-service.sh is syntactically valid bash', async () => {
  const scriptPath = fileURLToPath(new URL('../install-service.sh', import.meta.url));
  await execFileAsync('bash', ['-n', scriptPath]);
});

test('node discovery fallback chain finds nvm-managed node when nvm is wired only into .bashrc', async () => {
  // Reproduces the reported failure: nvm init lives only in .bashrc (the common
  // nvm-install default), never in .profile/.bash_profile. A login shell
  // (`bash -lc`, what the script originally used exclusively) never sources
  // .bashrc, so it never finds node even though every interactive prompt does.
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'triforce-nvm-home-'));
  try {
    const nvmDir = path.join(home, '.nvm');
    const nodeDir = path.join(nvmDir, 'versions', 'node', 'v99.0.0', 'bin');
    await fs.mkdir(nodeDir, { recursive: true });
    const fakeNode = path.join(nodeDir, 'node');
    await fs.writeFile(fakeNode, '#!/bin/sh\necho fake-node\n', { mode: 0o755 });
    await fs.writeFile(path.join(nvmDir, 'nvm.sh'), `export PATH="${nodeDir}:$PATH"\n`);
    await fs.writeFile(
      path.join(home, '.bashrc'),
      'export NVM_DIR="$HOME/.nvm"\n[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"\n'
    );
    // Deliberately no .profile/.bash_profile nvm wiring and no system PATH entry.

    const env = { ...process.env, HOME: home, PATH: '/usr/bin:/bin' };

    const loginShell = await execFileAsync('bash', ['-lc', 'command -v node'], { env }).catch(err => err);
    assert.equal((loginShell.stdout || '').trim(), '', 'login shell alone must reproduce the original bug (no node found)');

    // Fresh account (no ~/.sudo_as_admin_successful marker): interactive bash
    // startup on real Ubuntu systems prints a one-time sudo lecture to stdout
    // via /etc/bash.bashrc, ahead of `command -v node`'s own output. The
    // script must isolate the last line rather than trust the whole stream.
    const lastLine = out => out.trim().split('\n').pop();

    const interactiveShell = await execFileAsync('bash', ['-ic', 'command -v node'], { env });
    assert.equal(lastLine(interactiveShell.stdout), fakeNode, 'interactive-shell fallback (fix step 1) must find the nvm-managed node, ignoring any startup chatter');

    const explicitSource = await execFileAsync('bash', ['-c', `
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
      command -v node
    `], { env });
    assert.equal(lastLine(explicitSource.stdout), fakeNode, 'explicit nvm.sh sourcing fallback (fix step 2) must find the nvm-managed node');
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('install-service.sh node-discovery block includes the login, interactive, and explicit-nvm fallbacks', async () => {
  const scriptPath = fileURLToPath(new URL('../install-service.sh', import.meta.url));
  const source = await fs.readFile(scriptPath, 'utf8');
  assert.match(source, /bash -lc 'command -v node'/, 'retains the login-shell attempt');
  assert.match(source, /bash -ic 'command -v node'/, 'adds the interactive-shell fallback');
  assert.match(source, /NVM_DIR="\$HOME\/\.nvm"/, 'adds the explicit nvm.sh sourcing fallback');
  assert.match(source, /tail -n1/, 'isolates the last output line so first-login sudo-lecture chatter cannot corrupt NODE_BIN');
});
