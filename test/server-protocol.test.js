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
    const response = await fetch(`${origin}/api/capabilities`, { headers: { cookie: `triforce_token=${token}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).protocolMajor, 1);

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
