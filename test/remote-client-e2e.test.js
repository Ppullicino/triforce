import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const token = 'remote-e2e-token';
const nativeOrigins = ['https://appassets.androidplatform.net', 'tauri://localhost', 'https://tauri.localhost'];
const config = {
  architect: { provider: 'test', model: 'deterministic' },
  developer: { provider: 'test', model: 'deterministic' },
  reviewer: { provider: 'test', model: 'deterministic' },
};

async function startServer() {
  const port = 41_000 + Math.floor(Math.random() * 8_000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), TRIFORCE_TOKEN: token, TRIFORCE_E2E_FAKE_PIPELINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code]) => { throw new Error(`server exited ${code}: ${stderr}`); }),
  ]);
  return { child, port, origin: `http://127.0.0.1:${port}` };
}

function nativeSocket(port, origin = nativeOrigins[0], authToken = token) {
  return new WebSocket(`ws://127.0.0.1:${port}`, ['triforce.v1', `triforce.auth.${encodeURIComponent(authToken)}`], { headers: { origin } });
}

function messages(socket) {
  const received = [];
  const waiters = new Set();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    received.push(message);
    for (const waiter of waiters) waiter();
  });
  return {
    received,
    waitFor(predicate, timeout = 3_000) {
      return new Promise((resolve, reject) => {
        const inspect = () => {
          const found = received.find(predicate);
          if (!found) return;
          clearTimeout(timer); waiters.delete(inspect); resolve(found);
        };
        const timer = setTimeout(() => { waiters.delete(inspect); reject(new Error(`timed out; received ${JSON.stringify(received)}`)); }, timeout);
        waiters.add(inspect); inspect();
      });
    },
  };
}

test('representative Android, Windows, and macOS origins authenticate independently', async () => {
  const server = await startServer();
  try {
    assert.equal((await fetch(`${server.origin}/api/capabilities`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    for (const origin of nativeOrigins) {
      const response = await fetch(`${server.origin}/api/capabilities`, { headers: { origin, authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      const socket = nativeSocket(server.port, origin);
      await once(socket, 'open');
      assert.equal(socket.protocol, 'triforce.v1');
      socket.close();
    }
  } finally {
    server.child.kill('SIGTERM');
    await once(server.child, 'exit').catch(() => {});
  }
});

test('all pipeline modes complete and a disconnected client recovers the authoritative run', async () => {
  const server = await startServer();
  try {
    const socket = nativeSocket(server.port);
    const stream = messages(socket);
    await once(socket, 'open');
    for (const mode of [1, 2, 3]) {
      socket.send(JSON.stringify({ type: 'run', protocolVersion: '1.0.0', task: `mode-${mode}`, config, mode }));
      const started = await stream.waitFor(message => message.type === 'run_started' && message.run?.mode === mode);
      const runId = started.run.id;
      await stream.waitFor(message => message.type === 'run_state' && message.runId === runId && message.status === 'completed');
      assert.ok(stream.received.some(message => message.type === 'done' && message.runId === runId && message.passed));
    }

    socket.send(JSON.stringify({ type: 'run', protocolVersion: '1.0.0', task: 'resume-me', config, mode: 2 }));
    const started = await stream.waitFor(message => message.type === 'run_started' && message.run?.task === 'resume-me');
    socket.close();
    await once(socket, 'close');
    await new Promise(resolve => setTimeout(resolve, 150));

    const resumed = nativeSocket(server.port);
    const replay = messages(resumed);
    await once(resumed, 'open');
    resumed.send(JSON.stringify({ type: 'subscribe', protocolVersion: '1.0.0', runId: started.run.id, afterEventId: 0 }));
    const snapshot = await replay.waitFor(message => message.type === 'run_snapshot');
    assert.equal(snapshot.run.status, 'completed');
    await replay.waitFor(message => message.type === 'done' && message.runId === started.run.id);
    resumed.close();
  } finally {
    server.child.kill('SIGTERM');
    await once(server.child, 'exit').catch(() => {});
  }
});
