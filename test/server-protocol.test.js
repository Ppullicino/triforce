import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const token = 'protocol-test-token';

async function startServer() {
  const port = 31_000 + Math.floor(Math.random() * 10_000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), TRIFORCE_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code]) => { throw new Error(`server exited ${code}: ${stderr}`); }),
  ]);
  return { child, port };
}

test('protects protocol discovery and negotiates WebSocket versions', async () => {
  const { child, port } = await startServer();
  const origin = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${origin}/api/capabilities`)).status, 401);
    const legacyLogin = await fetch(`${origin}/auth?token=${token}`, { redirect: 'manual' });
    assert.equal(legacyLogin.status, 410);
    assert.doesNotMatch(await legacyLogin.text(), new RegExp(token));
    const loginPage = await fetch(`${origin}/login`);
    assert.equal(loginPage.status, 200);
    assert.equal(loginPage.headers.get('cache-control'), 'no-store');
    assert.match(loginPage.headers.get('content-security-policy'), /script-src 'self'/);
    const login = await fetch(`${origin}/api/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
    });
    assert.equal(login.status, 204);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.doesNotMatch(login.url, new RegExp(token));
    const response = await fetch(`${origin}/api/capabilities`, { headers: { cookie: `triforce_token=${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.protocolMajor, 1);
    assert.equal(body.sandbox, 'systemd');

    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { cookie: `triforce_token=${token}`, origin } });
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'capabilities', protocolVersion: '2.0.0' }));
    const [raw] = await once(ws, 'message');
    assert.equal(JSON.parse(raw).code, 'INCOMPATIBLE_VERSION');
    ws.close();
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => {});
  }
});

test('server startup logs a warning if models.config.json contains unknown model', async () => {
  const { readFile, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const configPath = join(import.meta.dirname, '../models.config.json');
  const originalConfig = await readFile(configPath, 'utf8');
  const badConfig = {
    architect: { provider: 'anthropic', model: 'claude-unknown-model' },
    developer: { provider: 'google', model: 'gemini-2.5-flash' },
    reviewer: { provider: 'google', model: 'gemini-2.5-flash' }
  };
  await writeFile(configPath, JSON.stringify(badConfig), 'utf8');

  try {
    const port = 32_000 + Math.floor(Math.random() * 8_000);
    const child = spawn(process.execPath, ['server.js'], {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, PORT: String(port), TRIFORCE_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    
    await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(([code]) => { throw new Error(`exited ${code}`); }),
    ]);

    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => {});

    assert.match(stderr, /Warning: Configuration entry for "architect" uses model "claude-unknown-model" \(provider "anthropic"\) which is missing from the catalog\./);
  } finally {
    await writeFile(configPath, originalConfig, 'utf8');
  }
});

test('allows native origins with header/protocol auth and rejects hostile WebSocket origins', async () => {
  const { child, port } = await startServer();
  const server = `http://127.0.0.1:${port}`;
  const nativeOrigin = 'https://appassets.androidplatform.net';
  try {
    const preflight = await fetch(`${server}/api/session`, {
      method: 'OPTIONS',
      headers: { origin: nativeOrigin, 'access-control-request-headers': 'authorization, content-type' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), nativeOrigin);

    const capabilities = await fetch(`${server}/api/capabilities`, {
      headers: { origin: nativeOrigin, authorization: `Bearer ${token}` },
    });
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.headers.get('access-control-allow-origin'), nativeOrigin);

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}`,
      ['triforce.v1', `triforce.auth.${encodeURIComponent(token)}`],
      { headers: { origin: nativeOrigin } },
    );
    await once(ws, 'open');
    assert.equal(ws.protocol, 'triforce.v1');
    ws.close();

    const hostile = new WebSocket(
      `ws://127.0.0.1:${port}`,
      ['triforce.v1', `triforce.auth.${encodeURIComponent(token)}`],
      { headers: { origin: 'https://attacker.example' } },
    );
    await once(hostile, 'error');
    assert.notEqual(hostile.readyState, WebSocket.OPEN);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => {});
  }
});

test('gracefully shuts down on SIGTERM, cancelling and persisting the active run', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const graceMs = 5000;
  const runsDir = await mkdtemp(join(tmpdir(), 'triforce-shutdown-runs-'));
  const port = 33_000 + Math.floor(Math.random() * 7_000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      TRIFORCE_TOKEN: token,
      NODE_ENV: 'test',
      TRIFORCE_E2E_FAKE_PIPELINE: '1',
      TRIFORCE_E2E_FAKE_PIPELINE_DELAY_MS: '60000',
      TRIFORCE_RUNS_DIR: runsDir,
      TRIFORCE_SHUTDOWN_GRACE_MS: String(graceMs),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(([code]) => { throw new Error(`server exited ${code}: ${stderr}`); }),
    ]);

    const origin = `http://127.0.0.1:${port}`;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { cookie: `triforce_token=${token}`, origin } });
    ws.on('error', () => {});
    await once(ws, 'open');
    ws.send(JSON.stringify({
      type: 'run',
      task: 'long-running fake pipeline for shutdown test',
      config: {
        architect: { provider: 'openai', model: 'gpt-4.1' },
        developer: { provider: 'openai', model: 'gpt-4.1' },
        reviewer: { provider: 'openai', model: 'gpt-4.1' },
      },
      mode: 1,
    }));
    let runId;
    while (!runId) {
      const [raw] = await once(ws, 'message');
      const msg = JSON.parse(raw);
      if (msg.type === 'run_started') runId = msg.run.id;
      if (msg.type === 'protocol_error' || msg.type === 'error') throw new Error(`run failed to start: ${raw}`);
    }

    const started = Date.now();
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    const elapsed = Date.now() - started;
    assert.equal(code, 0, `expected clean exit, stderr: ${stderr}`);
    assert.ok(elapsed < graceMs + 4000, `shutdown took ${elapsed}ms, beyond the grace period`);

    const index = JSON.parse(await readFile(join(runsDir, 'index.json'), 'utf8'));
    const persisted = index.runs.find(run => run.id === runId);
    assert.ok(persisted, 'active run missing from persisted index');
    assert.equal(persisted.status, 'cancelled');
    const jsonl = await readFile(join(runsDir, `${runId}.jsonl`), 'utf8');
    assert.match(jsonl, /"type":"run_state"[^\n]*"status":"cancelled"/);

    const units = await execFileAsync('systemctl', ['--user', 'list-units', 'triforce-sandbox-*', '--plain', '--no-legend'])
      .then(result => result.stdout)
      .catch(() => '');
    assert.equal(units.trim(), '', `orphaned sandbox units remain: ${units}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    }
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('handles missing systemd-run capability and refuses runs', async () => {
  const port = 31_000 + Math.floor(Math.random() * 10_000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), TRIFORCE_TOKEN: token, PATH: '/dev/null' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(([code]) => { throw new Error(`server exited ${code}: ${stderr}`); }),
    ]);

    const origin = `http://127.0.0.1:${port}`;
    const response = await fetch(`${origin}/api/capabilities`, { headers: { cookie: `triforce_token=${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sandbox, 'unavailable');

    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { cookie: `triforce_token=${token}`, origin } });
    await once(ws, 'open');
    ws.send(JSON.stringify({
      type: 'run',
      task: 'Build it',
      config: {
        architect: { provider: 'openai', model: 'gpt-4.1' },
        developer: { provider: 'openai', model: 'gpt-4.1' },
        reviewer: { provider: 'openai', model: 'gpt-4.1' },
      },
      mode: 1,
    }));
    const [raw] = await once(ws, 'message');
    const msg = JSON.parse(raw);
    assert.equal(msg.type, 'protocol_error');
    assert.equal(msg.code, 'SANDBOX_UNAVAILABLE');
    assert.match(msg.message, /systemd-run/);
    ws.close();
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => {});
  }
});
