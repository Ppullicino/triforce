import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const MAX_OUTPUT_BYTES = Number(process.env.SANDBOX_MAX_OUTPUT_BYTES) || 2 * 1024 * 1024;

export async function runSandboxed(code, { timeoutMs = 10000, onOutput = () => {}, signal } = {}) {
  if (typeof code !== 'string') throw new TypeError('Sandbox code must be a string');
  if (Buffer.byteLength(code) > 1024 * 1024) throw new Error('Generated code exceeds 1 MiB limit');

  const workDir = await mkdtemp(join(tmpdir(), 'triforce-run-'));
  await writeFile(join(workDir, 'main.js'), code, { encoding: 'utf8', mode: 0o600 });

  const nodeRoot = dirname(dirname(process.execPath));
  const unit = `triforce-sandbox-${process.pid}-${randomBytes(6).toString('hex')}`;
  const args = [
    '--user', '--pipe', '--wait', '--collect', '--quiet', `--unit=${unit}`,
    '--property=PrivateNetwork=yes', '--property=ProtectSystem=strict',
    '--property=RestrictAddressFamilies=AF_UNIX',
    '--property=ProtectHome=tmpfs', '--property=PrivateTmp=yes',
    '--property=NoNewPrivileges=yes', '--property=RestrictSUIDSGID=yes',
    '--property=LockPersonality=yes', '--property=MemoryMax=192M',
    '--property=TasksMax=32', `--property=RuntimeMaxSec=${Math.ceil(timeoutMs / 1000)}`,
    `--property=BindReadOnlyPaths=${nodeRoot} ${workDir}`,
    `--working-directory=${workDir}`, '--setenv=HOME=/tmp',
    process.execPath, '--permission', `--allow-fs-read=${workDir}`,
    '--max-old-space-size=128', join(workDir, 'main.js'),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/systemd-run', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, timedOut = false, settled = false;
    const cleanup = async () => { await rm(workDir, { recursive: true, force: true }); };
    const killTree = () => { spawn('/usr/bin/systemctl', ['--user', 'kill', '--kill-whom=all', unit], { stdio: 'ignore' }); };
    
    let onAbort;
    const finish = async (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      await cleanup();
      fn(value);
    };
    
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        killTree();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        finish(reject, err);
        return;
      }
      onAbort = () => {
        killTree();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        finish(reject, err);
      };
      signal.addEventListener('abort', onAbort);
    }

    const collect = (stream, data, kind) => {
      bytes += data.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        stderr += '\nSandbox output limit exceeded';
        killTree();
        return stream;
      }
      const text = data.toString();
      onOutput(text, kind);
      return stream + text;
    };

    child.stdout.on('data', data => { stdout = collect(stdout, data, 'stdout'); });
    child.stderr.on('data', data => { stderr = collect(stderr, data, 'stderr'); });
    child.on('error', err => finish(reject, new Error(`Unable to start sandbox: ${err.message}`)));
    child.on('close', code => finish(resolve, { stdout, stderr, exitCode: code ?? 1, timedOut }));
  });
}
