import { expect, test, vi } from 'vitest';
import { TriforceConnection } from './connection';

class MockSocket extends EventTarget {
  readyState = 0;
  sent: string[] = [];
  send(value: string) { this.sent.push(value); }
  close() { this.dispatchEvent(new Event('close')); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  message(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}

test('authenticates with a request body and never puts the token in the URL', async () => {
  const socket = new MockSocket();
  let socketProtocols: string[] | undefined;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ protocolMajor: 1 }), { status: 200 }));
  const connection = new TriforceConnection('https://host.example', { fetch: fetcher, createSocket: (_url, protocols) => { socketProtocols = protocols; return socket; } });
  await connection.connect('top-secret');
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://host.example/api/session');
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'top-secret' }));
  expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({ authorization: 'Bearer top-secret' });
  expect(fetcher.mock.calls.flat().map(call => call[0]).join()).not.toContain('top-secret');
  socket.open();
  expect(connection.state).toBe('connected');
  expect(socketProtocols).toEqual(['triforce.v1', 'triforce.auth.top-secret']);
});

test('drops malformed, duplicate, and out-of-order events without corrupting the replay cursor', async () => {
  const socket = new MockSocket();
  const resumed = new MockSocket();
  const events: unknown[] = [];
  const scheduled: Array<() => void> = [];
  const sockets = [socket, resumed];
  const connection = new TriforceConnection('https://host.example', {
    fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ protocolMajor: 1 }), { status: 200 })),
    createSocket: () => sockets.shift()!,
    schedule: callback => { scheduled.push(callback); return 1 as unknown as ReturnType<typeof setTimeout>; },
  });
  connection.onEvent(event => events.push(event));
  await connection.connect(); socket.open();
  const runId = crypto.randomUUID();
  socket.message({ type: 'status', runId, eventId: 2 });
  socket.message({ type: 'status', runId, eventId: 2 });
  socket.message({ type: 'status', runId, eventId: 1 });
  socket.message({ type: 'made_up', runId, eventId: 3 });
  expect(events).toHaveLength(1);
  socket.close(); scheduled[0]!();
  resumed.open();
  expect(resumed.sent.map(value => JSON.parse(value))).toContainEqual(expect.objectContaining({ type: 'subscribe', runId, afterEventId: 2 }));
});

test.each([[401, 'unauthorized'], [503, 'unreachable']])('maps HTTP %s to %s state', async (status, expected) => {
  const connection = new TriforceConnection('https://host.example', { fetch: vi.fn().mockResolvedValue(new Response(null, { status })) });
  await connection.connect();
  expect(connection.state).toBe(expected);
});

test('reconnects with bounded backoff and resumes after the last event', async () => {
  const sockets: MockSocket[] = [];
  const scheduled: Array<() => void> = [];
  const connection = new TriforceConnection('https://host.example', {
    fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ protocolMajor: 1 }), { status: 200 })),
    createSocket: () => { const socket = new MockSocket(); sockets.push(socket); return socket; },
    schedule: callback => { scheduled.push(callback); return 1 as unknown as ReturnType<typeof setTimeout>; },
  });
  await connection.connect();
  sockets[0]!.open();
  sockets[0]!.message({ type: 'status', runId: crypto.randomUUID(), eventId: 7 });
  sockets[0]!.close();
  expect(connection.state).toBe('reconnecting');
  scheduled[0]!();
  sockets[1]!.open();
  expect(sockets[1]!.sent.map(value => JSON.parse(value))).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'subscribe', afterEventId: 7 }),
  ]));
});

test('sends all three pipeline modes through the shared protocol', async () => {
  const socket = new MockSocket();
  const connection = new TriforceConnection('https://host.example', {
    fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ protocolMajor: 1 }), { status: 200 })),
    createSocket: () => socket,
  });
  await connection.connect(); socket.open();
  const config = {
    architect: { provider: 'openai', model: 'gpt-4.1' }, developer: { provider: 'openai', model: 'gpt-4.1' }, reviewer: { provider: 'openai', model: 'gpt-4.1' },
  };
  for (const mode of [1, 2, 3] as const) connection.run('build', config, mode);
  expect(socket.sent.map(value => JSON.parse(value)).filter(value => value.type === 'run').map(value => value.mode)).toEqual([1, 2, 3]);
});
