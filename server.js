import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { RunRegistry } from './run-registry.js';
import { SubscriptionLedger } from './subscription-ledger.js';
import { capabilities, isCompatibleProtocol, normalizePipelineConfig, validateClientCommand } from './packages/protocol/src/index.js';
import { executePipeline } from './pipeline.js';
import { runVerifiedChat } from './verified-chat.js';
import { runCreditExtender } from './credit-extender.js';
import * as fsBrowser from './fs-browser.js';
import { applyDiff, createWorkspaceFromDir } from './workspace.js';
import { execFile } from 'node:child_process';
import { ALLOWED_MODELS, checkConfigForWarnings, getCatalog } from './models.js';
import { gcWorkspaces } from './workspace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPTS_DIR = join(__dirname, 'transcripts');
const WORKSPACES_DIR = process.env.TRIFORCE_WORKSPACE_ROOT || join(homedir(), '.local', 'share', 'triforce', 'workspaces');
if (process.env.TRIFORCE_TRANSCRIPTS === '1') await mkdir(TRANSCRIPTS_DIR, { recursive: true, mode: 0o700 });
const AUTH_TOKEN = process.env.TRIFORCE_TOKEN || randomBytes(32).toString('hex');
if (!process.env.TRIFORCE_TOKEN) console.warn(`TRIFORCE_TOKEN was not set; generated one-time token: ${AUTH_TOKEN}`);

// Filesystem navigator roots (protocol 1.2). Reads are confined to these.
const FS_ROOTS = String(process.env.TRIFORCE_FS_ROOTS || homedir())
  .split(':').map(value => value.trim()).filter(Boolean);

const ledger = new SubscriptionLedger();
const runRegistry = new RunRegistry({ ledger });

// Mode 3 conversation memory (in-process; the per-run jsonl is the durable
// transcript for reconnect/replay of the current turn).
const chatHistories = new Map();
const CHAT_HISTORY_MAX_MESSAGES = 40;

// runId -> { workspaceDir, realDir, snapshot } for the `apply` diff-back flow.
const runContexts = new Map();
const APPLY_GIT_POLICY = process.env.TRIFORCE_APPLY_GIT_POLICY || 'branch';

let serverCapabilities = {
  ...capabilities,
  fsRoots: FS_ROOTS,
  sandbox: 'unavailable',
};

let sandboxStatus = 'unavailable';

function probeSandbox() {
  return new Promise((resolve) => {
    try {
      const child = execFile('systemd-run', ['--user', 'true'], { timeout: 2000 }, (error) => {
        if (error) {
          resolve('unavailable');
        } else {
          resolve('systemd');
        }
      });
    } catch (err) {
      resolve('unavailable');
    }
  });
}
const NATIVE_CLIENT_ORIGINS = new Set([
  'https://appassets.androidplatform.net',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  ...String(process.env.TRIFORCE_CLIENT_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
]);



async function runValidationPipeline(ws, task, _config, mode, signal) {
  const send = event => ws.send(JSON.stringify(event));
  send({ type: 'status', stage: 'architect', label: `Validating mode ${mode}` });

  if (signal?.aborted) {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  }

  const fakeDurationMs = Number.parseInt(process.env.TRIFORCE_E2E_FAKE_PIPELINE_DELAY_MS ?? '', 10) || 75;
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    };
    const timeoutId = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, fakeDurationMs);
    if (signal) signal.addEventListener('abort', onAbort);
  });
  
  if (signal?.aborted) {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  }

  for (const role of ['architect', 'developer', 'reviewer']) {
    send({ type: 'output', role, text: `${role} completed ${task} in mode ${mode}` });
  }
  send({ type: 'pty', role: 'developer', data: `representative remote output for mode ${mode}\n` });
  send({ type: 'done', elapsed: '0.08', passed: true });
}

/**
 * Executes the Triforce Mode 1 structured-build pipeline
 * (Prompt Designer → Supervisor → Coder → Supervisor), optionally seeded from a
 * selected real folder. `run` commands for modes 2/3 fall through here until
 * their dedicated engines land (P3); Mode 3 chat has its own `chat` command.
 */
async function runPipeline(ws, task, config, mode = 1, signal, workingDir, seededWorkspace) {
  if (typeof task !== 'string' || !task.trim() || task.length > 50000) throw new Error('Task must be 1-50000 characters');
  if (!config || typeof config !== 'object') throw new Error('Invalid pipeline configuration');
  const effective = normalizePipelineConfig(config);
  for (const [position, legacy] of [['promptDesigner', 'architect'], ['coder', 'developer'], ['supervisor', 'reviewer']]) {
    const entry = effective[position] ?? effective[legacy];
    if (!entry || typeof entry.provider !== 'string' || typeof entry.model !== 'string') throw new Error(`Invalid ${position} configuration`);
    if (!ALLOWED_MODELS.get(entry.provider)?.has(entry.model)) throw new Error(`Unsupported ${position} provider/model`);
  }
  const send = (data) => { if (ws.readyState === 1) ws.send(JSON.stringify(data)); };
  const runLog = { architect: '', developer: '', reviewer: '' };

  try {
    await executePipeline(
      task,
      effective,
      1,
      {
        workspacesDir: WORKSPACES_DIR,
        packageRoot: __dirname,
        dependencyRoot: join(__dirname, 'node_modules'),
        workingDir: workingDir || undefined,
        seededWorkspace: seededWorkspace || undefined,
        signal,
      },
      (event) => {
        if (ws.readyState !== 1) return;
        if (event.type === 'output') {
          const { role, text, iteration, label } = event;
          const header = `\n--- ITERATION ${iteration ?? 1}${label ? ` · ${label}` : ''} ---\n`;
          runLog[role] = (runLog[role] || '') + header + text + '\n';
          send({ type: 'output', role, text: runLog[role] });
        } else {
          send(event);
        }
      }
    );
  } catch (err) {
    console.error(`Pipeline execution failed: ${err.message}`);
  }
}

// ── EXPRESS + HTTP SERVER ──
const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();
  if (!NATIVE_CLIENT_ORIGINS.has(origin)) {
    if (req.method === 'OPTIONS') return res.status(403).end();
    return next();
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json());

function tokenMatches(value) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(AUTH_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieToken(req) {
  return req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('triforce_token='))?.slice('triforce_token='.length);
}

function bearerToken(req) {
  const value = req.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : undefined;
}

function webSocketProtocolToken(req) {
  const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map(value => value.trim());
  const encoded = protocols.find(value => value.startsWith('triforce.auth.'))?.slice('triforce.auth.'.length);
  if (!encoded) return undefined;
  try { return decodeURIComponent(encoded); } catch { return undefined; }
}

function requestIsAuthorized(req) {
  return tokenMatches(cookieToken(req)) || tokenMatches(bearerToken(req));
}

function setSessionCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `triforce_token=${AUTH_TOKEN}; HttpOnly; SameSite=Strict; Path=/${secure}`);
}

app.get('/auth', (req, res) => {
  if (process.env.TRIFORCE_ALLOW_URL_TOKEN_AUTH !== '1') {
    return res.status(410).send('URL token authentication is disabled. Use /login.');
  }
  if (!tokenMatches(req.query.token)) return res.status(401).send('Invalid token');
  setSessionCookie(req, res);
  res.redirect('/');
});

app.post('/api/session', (req, res) => {
  if (!tokenMatches(req.body?.token)) return res.status(401).json({ error: 'invalid credentials' });
  setSessionCookie(req, res);
  res.status(204).end();
});

app.delete('/api/session', (_req, res) => {
  res.setHeader('Set-Cookie', 'triforce_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.status(204).end();
});

app.use('/api', (req, res, next) => requestIsAuthorized(req) ? next() : res.status(401).json({ error: 'unauthorized' }));

// PWA-critical headers
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile('sw.js', { root: join(__dirname, 'public') });
});
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile('manifest.json', { root: join(__dirname, 'public') });
});

app.use('/icons', express.static(join(__dirname, 'public/icons')));
app.get('/login', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.sendFile('login.html', { root: join(__dirname, 'public') });
});
app.use(express.static(join(__dirname, 'public')));

app.get('/api/usage', (req, res) => {
  const usage = runRegistry.getLatestUsage();
  const total = Object.values(usage).reduce(
    (acc, r) => ({
      inputTokens:  acc.inputTokens  + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cost: acc.cost + r.cost,
    }),
    { inputTokens: 0, outputTokens: 0, cost: 0 }
  );
  res.json({ ...usage, total });
});

app.get('/api/config', async (req, res) => {
  try {
    const raw = await readFile(join(__dirname, 'models.config.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/catalog', (_req, res) => res.json(getCatalog()));
app.get('/api/capabilities', (_req, res) => res.json(serverCapabilities));
app.get('/api/ledger', (_req, res) => res.json({ ledger: ledger.snapshot() }));
app.get('/api/runs', (_req, res) => res.json({ runs: runRegistry.list() }));
app.get('/api/runs/:runId', (req, res) => {
  const run = runRegistry.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json({ run: runRegistry.snapshot(run) });
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: protocols => protocols.has('triforce.v1') ? 'triforce.v1' : false,
});

httpServer.on('upgrade', (req, socket, head) => {
  if (shuttingDown) return socket.destroy();
  const origin = req.headers.origin;
  const expectedOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const originAllowed = origin === expectedOrigin || NATIVE_CLIENT_ORIGINS.has(origin);
  const authorized = requestIsAuthorized(req) || tokenMatches(webSocketProtocolToken(req));
  if (!authorized || !originAllowed) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const unsubscribe = new Set();
  let workingDir = null; // session-scoped selected real folder (fs.selectWorking)
  ws.on('close', () => {
    for (const remove of unsubscribe) remove();
    unsubscribe.clear();
  });
  ws.on('message', async (raw) => {
    if (raw.length > 1024 * 1024) return ws.close(1009, 'Message too large');
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!['run', 'subscribe', 'capabilities', 'cancel', 'chat', 'fs.roots', 'fs.list', 'fs.stat', 'fs.selectWorking', 'apply'].includes(msg.type)) return;
    const parsed = validateClientCommand(msg);
    if (!parsed.success) {
      return ws.send(JSON.stringify({ type: 'protocol_error', code: 'INVALID_COMMAND', message: parsed.error.issues[0]?.message || 'Invalid command' }));
    }
    const command = parsed.data;
    if (command.protocolVersion && !isCompatibleProtocol(command.protocolVersion)) {
      return ws.send(JSON.stringify({ type: 'protocol_error', code: 'INCOMPATIBLE_VERSION', message: `Server requires protocol major ${serverCapabilities.protocolMajor}`, capabilities: serverCapabilities }));
    }
    if (command.type === 'capabilities') {
      return ws.send(JSON.stringify({ type: 'capabilities', capabilities: serverCapabilities }));
    }
    if (command.type === 'subscribe') {
      const run = runRegistry.get(command.runId);
      if (!run) return ws.send(JSON.stringify({ type: 'protocol_error', code: 'RUN_NOT_FOUND', message: 'Run not found' }));
      unsubscribe.add(runRegistry.subscribe(run, ws, command.afterEventId));
      return;
    }
    if (command.type === 'cancel') {
      const success = runRegistry.cancel(command.runId);
      if (!success) {
        return ws.send(JSON.stringify({ type: 'protocol_error', code: 'RUN_NOT_FOUND', message: 'Run not found or not running' }));
      }
      return;
    }
    if (command.type === 'fs.roots') {
      return ws.send(JSON.stringify({ type: 'fs_list', kind: 'roots', roots: fsBrowser.roots(process.env.TRIFORCE_FS_ROOTS) }));
    }
    if (command.type === 'fs.list') {
      try {
        const { path, entries } = await fsBrowser.list(command.path, { roots: FS_ROOTS });
        return ws.send(JSON.stringify({ type: 'fs_list', kind: 'list', path, entries }));
      } catch (err) {
        return ws.send(JSON.stringify({ type: 'protocol_error', code: 'FS_DENIED', message: err.message }));
      }
    }
    if (command.type === 'fs.stat') {
      try {
        return ws.send(JSON.stringify({ type: 'fs_list', kind: 'stat', entry: await fsBrowser.statEntry(command.path, { roots: FS_ROOTS }) }));
      } catch (err) {
        return ws.send(JSON.stringify({ type: 'protocol_error', code: 'FS_DENIED', message: err.message }));
      }
    }
    if (command.type === 'fs.selectWorking') {
      try {
        const entry = await fsBrowser.statEntry(command.path, { roots: FS_ROOTS });
        if (entry.type !== 'dir') throw new Error('Working folder must be a directory');
        workingDir = entry.path;
        return ws.send(JSON.stringify({ type: 'fs_list', kind: 'working', path: workingDir, isGitRepo: entry.isGitRepo }));
      } catch (err) {
        return ws.send(JSON.stringify({ type: 'protocol_error', code: 'FS_DENIED', message: err.message }));
      }
    }
    if (command.type === 'apply') {
      const ctx = runContexts.get(command.runId);
      if (!ctx) return ws.send(JSON.stringify({ type: 'apply_result', runId: command.runId, ok: false, reason: 'no applyable context for this run (was it seeded from a folder?)' }));
      try {
        const result = await applyDiff(ctx.workspaceDir, ctx.realDir, {
          snapshot: ctx.snapshot,
          gitPolicy: APPLY_GIT_POLICY,
          paths: command.scope === 'files' ? command.paths : undefined,
        });
        return ws.send(JSON.stringify({ type: 'apply_result', runId: command.runId, ok: !result.reason, ...result }));
      } catch (err) {
        return ws.send(JSON.stringify({ type: 'apply_result', runId: command.runId, ok: false, reason: err.message }));
      }
    }
    if (command.type === 'chat') {
      if (shuttingDown) {
        return ws.send(JSON.stringify({
          type: 'protocol_error', code: 'SERVER_SHUTTING_DOWN',
          message: 'Server is shutting down and no longer accepts chat commands.',
        }));
      }
      const conversationId = command.conversationId || randomUUID();
      const history = chatHistories.get(conversationId) ?? [];
      let folderContext = '';
      if (command.folder) {
        folderContext = await fsBrowser.readBudgeted(command.folder, { roots: FS_ROOTS }).catch(() => '');
      }
      try {
        const run = runRegistry.start(
          { task: command.message, config: {}, mode: 3, kind: 'chat' },
          async (pipelineSocket, signal) => {
            const result = await runVerifiedChat(command.message, {
              history, folderContext, pool: command.pool, fast: command.fast,
              deliberate: command.deliberate, signal, ledger, conversationId,
            }, event => { if (pipelineSocket.readyState === 1) pipelineSocket.send(JSON.stringify(event)); });
            const next = [
              ...history,
              { role: 'user', text: command.message },
              { role: 'assistant', text: result.final },
            ].slice(-CHAT_HISTORY_MAX_MESSAGES);
            chatHistories.set(conversationId, next);
          });
        ws.send(JSON.stringify({ type: 'run_started', run: runRegistry.snapshot(run), conversationId }));
        unsubscribe.add(runRegistry.subscribe(run, ws));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', stage: 'architect', message: err.message }));
      }
      return;
    }
    if (command.type === 'run') {
      if (shuttingDown) {
        return ws.send(JSON.stringify({
          type: 'protocol_error',
          code: 'SERVER_SHUTTING_DOWN',
          message: 'Server is shutting down and no longer accepts run commands.',
        }));
      }
      if (sandboxStatus === 'unavailable') {
        return ws.send(JSON.stringify({
          type: 'protocol_error',
          code: 'SANDBOX_UNAVAILABLE',
          message: 'Sandbox execution requires systemd-run (--user), which is unavailable on this host.',
        }));
      }
      try {
        const useValidationPipeline = process.env.NODE_ENV === 'test' && process.env.TRIFORCE_E2E_FAKE_PIPELINE === '1';
        const creditMode = command.mode === 2 && !useValidationPipeline;
        let seed = null;
        if (workingDir && !useValidationPipeline) {
          seed = await createWorkspaceFromDir(workingDir, WORKSPACES_DIR, { dependencyRoot: join(__dirname, 'node_modules') });
        }
        const selectedFolder = workingDir;
        const seededWs = seed ? { id: seed.id, directory: seed.directory, testFile: seed.testFile, files: seed.files } : null;
        const run = runRegistry.start(
          { ...command, kind: creditMode ? 'credit' : 'build' },
          (pipelineSocket, signal) => {
            if (useValidationPipeline) return runValidationPipeline(pipelineSocket, command.task, command.config, command.mode, signal);
            if (creditMode) {
              return runCreditExtender(command.task, {
                config: normalizePipelineConfig(command.config), pool: command.config?.pool, deliberate: command.config?.deliberate,
                signal, ledger, workspacesDir: WORKSPACES_DIR, packageRoot: __dirname,
                dependencyRoot: join(__dirname, 'node_modules'), workingDir: selectedFolder || undefined, seededWorkspace: seededWs || undefined,
              }, event => { if (pipelineSocket.readyState === 1) pipelineSocket.send(JSON.stringify(event)); }).catch(err => {
                if (err.name !== 'AbortError') pipelineSocket.send(JSON.stringify({ type: 'error', stage: 'architect', message: err.message }));
              });
            }
            return runPipeline(pipelineSocket, command.task, command.config, command.mode, signal, selectedFolder, seededWs);
          });
        if (seed) {
          runContexts.set(run.id, { workspaceDir: seed.directory, realDir: selectedFolder, snapshot: seed.snapshot });
          while (runContexts.size > 50) runContexts.delete(runContexts.keys().next().value);
        }
        ws.send(JSON.stringify({ type: 'run_started', run: runRegistry.snapshot(run) }));
        unsubscribe.add(runRegistry.subscribe(run, ws));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', stage: 'architect', message: err.message }));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

// ── GRACEFUL SHUTDOWN ──
// Grace must stay below the unit's stop timeout (TimeoutStopSec=30 in triforce.service) or systemd SIGKILLs us mid-flush.
const SHUTDOWN_GRACE_MS = (() => {
  const parsed = Number.parseInt(process.env.TRIFORCE_SHUTDOWN_GRACE_MS ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10_000;
})();

let shuttingDown = false;

function killLingeringSandboxUnits() {
  const prefixes = [`triforce-sandbox-${process.pid}-`, `triforce-workspace-${process.pid}-`];
  return new Promise(resolve => {
    execFile('systemctl', ['--user', 'list-units', '--plain', '--no-legend', 'triforce-*'], { timeout: 2000 }, (err, stdout) => {
      if (err || !stdout) return resolve();
      const units = stdout.split('\n')
        .map(line => line.trim().split(/\s+/)[0])
        .filter(name => prefixes.some(prefix => name?.startsWith(prefix)));
      let pending = units.length;
      if (!pending) return resolve();
      for (const unit of units) {
        console.warn(`Shutdown: killing lingering sandbox unit ${unit}`);
        execFile('systemctl', ['--user', 'kill', '--kill-whom=all', unit], { timeout: 2000 }, () => { if (--pending === 0) resolve(); });
      }
    });
  });
}

async function shutdown(signalName) {
  if (shuttingDown) {
    console.warn(`Received ${signalName} during shutdown; forcing exit.`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`Received ${signalName}; shutting down (grace ${SHUTDOWN_GRACE_MS}ms)...`);
  setTimeout(() => {
    console.error('Graceful shutdown exceeded its deadline; forcing exit.');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS + 5000).unref();

  const active = runRegistry.activeRun;
  if (active) {
    runRegistry.cancel(active.id);
    await Promise.race([
      active.completion,
      new Promise(resolve => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
    ]);
  }
  await killLingeringSandboxUnits();
  await runRegistry.flush();
  for (const client of wss.clients) client.terminate();
  httpServer.closeIdleConnections?.();
  await new Promise(resolve => httpServer.close(resolve));
  process.exit(0);
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

runRegistry.load().then(async () => {
  sandboxStatus = await probeSandbox();
  serverCapabilities.sandbox = sandboxStatus;
  try {
    const rawConfig = await readFile(join(__dirname, 'models.config.json'), 'utf8');
    const configObj = JSON.parse(rawConfig);
    checkConfigForWarnings(configObj);
  } catch (err) {
    // ignore if models.config.json is missing or invalid
  }
  try {
    const { removed } = await gcWorkspaces(WORKSPACES_DIR);
    if (removed.length) console.log(`Workspace GC: removed ${removed.length} old workspace(s) from ${WORKSPACES_DIR}`);
  } catch (err) {
    console.warn(`Workspace GC failed at startup: ${err.message}`);
  }
  httpServer.listen(PORT, () => console.log(`Triforce server running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to load RunRegistry state:', err);
  process.exit(1);
});
