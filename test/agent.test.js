import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Agent } from '../agent.js';

test('CLI startup errors reject instead of crashing or hanging', async () => {
  const child = spawn('/definitely/not/a/triforce-binary', [], { detached: true });
  await assert.rejects(new Promise((resolve, reject) => {
    Agent.prototype._collectChild(child, null, 'missing', resolve, reject);
  }), /Failed to start missing CLI/);
});

test('CLI output is collected into the provider result', async () => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ok')"], { detached: true });
  const result = await new Promise((resolve, reject) => {
    Agent.prototype._collectChild(child, null, 'node', resolve, reject);
  });
  assert.equal(result.text, 'ok');
});

test('CLI early exit with large stdin rejects with the CLI error without uncaught EPIPE', async () => {
  const child = spawn(process.execPath, ['-e', "process.stderr.write('intentional failure'); process.exit(1)"], {
    detached: process.platform !== 'win32',
  });

  await assert.rejects(new Promise((resolve, reject) => {
    Agent.prototype._collectChild(child, 'x'.repeat(16 * 1024 * 1024), 'node', resolve, reject);
  }), /node CLI exited with code 1\. Stderr: intentional failure/);
});

test('CLI timeout kills the child tree once and settles once', async () => {
  const child = new EventEmitter();
  child.pid = 123456789;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { killCount++; };

  let killCount = 0;
  const originalProcessKill = process.kill;
  process.kill = () => { killCount++; return true; };
  try {
    await assert.rejects(new Promise((resolve, reject) => {
      Agent.prototype._collectChild(child, null, 'hanging', resolve, reject, 10);
    }), /hanging CLI timed out after 10ms/);
    child.emit('close', 1);
    child.emit('error', new Error('late error'));
  } finally {
    process.kill = originalProcessKill;
  }

  assert.equal(killCount, 1);
});

test('Codex CLI can run when Triforce starts outside a Git repository', () => {
  const args = Agent.prototype._codexCLIArgs.call({
    unsafePermissions: false,
    systemPrompt: '',
  });

  assert.deepEqual(args, ['exec', '--skip-git-repo-check', '--json', '-']);
});

test('Codex CLI preserves configured permissions and system prompt', () => {
  const args = Agent.prototype._codexCLIArgs.call({
    unsafePermissions: true,
    systemPrompt: 'Review carefully',
  });

  assert.deepEqual(args, [
    'exec',
    '--skip-git-repo-check',
    '--json',
    '--dangerously-bypass-approvals-and-sandbox',
    '-c',
    'system_prompt="Review carefully"',
    '-',
  ]);
});

test('a stubbed 429 with Retry-After: 2 waits ~2s', async () => {
  const agent = new Agent({ provider: 'claude-cli', model: 'claude-cli-default' });
  let callCount = 0;
  agent._callProvider = async () => {
    callCount++;
    if (callCount === 1) {
      const err = new Error('Rate limit exceeded');
      err.status = 429;
      err.headers = { 'retry-after': '2' };
      throw err;
    }
    return { text: 'success', usage: { inputTokens: 0, outputTokens: 0 } };
  };

  const start = Date.now();
  const res = await agent.call('test');
  const duration = Date.now() - start;
  
  assert.equal(res.text, 'success');
  assert.equal(callCount, 2);
  assert.ok(duration >= 1900 && duration < 5000, `Expected duration around 2s, got ${duration}ms`);
});

test('a fake CLI exiting 1 with "rate limit" on stderr is classified as retryable 429', async () => {
  const agent = new Agent({ provider: 'claude-cli', model: 'claude-cli-default' });
  const child = spawn(process.execPath, ['-e', "process.stderr.write('rate limit exceeded'); process.exit(1)"], {
    detached: process.platform !== 'win32',
  });

  let error;
  try {
    await new Promise((resolve, reject) => {
      agent._collectChild(child, null, 'node', resolve, reject);
    });
  } catch (err) {
    error = err;
  }

  assert.ok(error, 'expected promise to reject');
  assert.equal(error.status, 429);
});

test('agent.call retries on retryable errors and succeeds on second attempt', async () => {
  const agent = new Agent({ provider: 'claude-cli', model: 'claude-cli-default' });
  let callCount = 0;
  agent._callProvider = async () => {
    callCount++;
    if (callCount === 1) {
      const err = new Error('rate limit');
      err.status = 429;
      throw err;
    }
    return { text: 'success', usage: { inputTokens: 0, outputTokens: 0 } };
  };

  const start = Date.now();
  process.env.TRIFORCE_BACKOFF_CAP_MS = '10';
  const res = await agent.call('test');
  delete process.env.TRIFORCE_BACKOFF_CAP_MS;

  assert.equal(res.text, 'success');
  assert.equal(callCount, 2);
});

test('terminal errors (400, auth) still fail fast with no retries', async () => {
  const agent = new Agent({ provider: 'claude-cli', model: 'claude-cli-default' });
  let callCount = 0;
  agent._callProvider = async () => {
    callCount++;
    const err = new Error('Bad Request');
    err.status = 400;
    throw err;
  };

  await assert.rejects(agent.call('test'), /Bad Request/);
  assert.equal(callCount, 1);
});

async function withStubCli(name, script, run) {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'triforce-cli-stub-'));
  const previousPath = process.env.PATH;
  try {
    await writeFile(join(dir, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    process.env.PATH = `${dir}:${previousPath}`;
    return await run();
  } finally {
    process.env.PATH = previousPath;
    await rm(dir, { recursive: true, force: true });
  }
}

test('stubbed claude CLI emitting a JSON envelope yields real token usage', async () => {
  const envelope = '{"type":"result","result":"hello from stub","usage":{"input_tokens":12,"cache_read_input_tokens":3,"output_tokens":34}}';
  const result = await withStubCli('claude', `cat > /dev/null\necho '${envelope}'`, () => {
    const agent = new Agent({ provider: 'claude-cli', model: 'claude-cli-default' });
    return agent._callClaudeCLI('hi');
  });
  assert.equal(result.text, 'hello from stub');
  assert.deepEqual(result.usage, { inputTokens: 15, outputTokens: 34 });
});

test('stubbed plain-text claude CLI still succeeds and flags usage as unknown', async () => {
  const result = await withStubCli('claude', `cat > /dev/null\necho 'plain response'`, () => {
    const agent = new Agent({ provider: 'claude-cli', model: 'claude-cli-default' });
    return agent._callClaudeCLI('hi');
  });
  assert.equal(result.text, 'plain response');
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, usageUnknown: true });
});

test('stubbed codex CLI JSONL event stream yields message text and token usage', async () => {
  const script = [
    'cat > /dev/null',
    `echo '{"type":"item.completed","item":{"item_type":"agent_message","text":"codex says hi"}}'`,
    `echo '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":7}}'`,
  ].join('\n');
  const result = await withStubCli('codex', script, () => {
    const agent = new Agent({ provider: 'codex-cli', model: 'codex-cli-default' });
    return agent._callCodexCLI('hi');
  });
  assert.equal(result.text, 'codex says hi');
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 7 });
});

test('agy CLI (no structured output) resolves with usageUnknown zeros', async () => {
  const result = await withStubCli('agy', `echo 'agy answer'`, () => {
    const agent = new Agent({ provider: 'agy-cli', model: 'agy-cli-default' });
    return agent._callAgyCLI('hi');
  });
  assert.equal(result.text, 'agy answer');
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, usageUnknown: true });
});

test('_collectChild aborts and kills child process on signal abort', async () => {
  const controller = new AbortController();
  const child = spawn(process.execPath, ['-e', "setTimeout(() => {}, 60000)"], {
    detached: process.platform !== 'win32',
  });

  const p = new Promise((resolve, reject) => {
    Agent.prototype._collectChild(child, null, 'node', resolve, reject, 30000, controller.signal);
  });

  controller.abort();

  await assert.rejects(p, err => {
    return err.name === 'AbortError';
  });
});

test('Agent.call rejects immediately on abort during retry backoff sleep', async () => {
  const agent = new Agent({ provider: 'claude-cli', model: 'claude-cli-default' });
  const controller = new AbortController();
  
  let callCount = 0;
  agent._callProvider = async () => {
    callCount++;
    const err = new Error('rate limit');
    err.status = 429;
    throw err;
  };

  const p = agent.call('test', controller.signal);

  await new Promise(resolve => setTimeout(resolve, 50));
  controller.abort();

  await assert.rejects(p, err => {
    return err.name === 'AbortError';
  });
  
  assert.equal(callCount, 1);
});
