import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { RunRegistry } from './run-registry.js';
import { capabilities, isCompatibleProtocol, validateClientCommand } from './packages/protocol/src/index.js';
import { executePipeline } from './pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPTS_DIR = join(__dirname, 'transcripts');
const WORKSPACES_DIR = process.env.TRIFORCE_WORKSPACE_ROOT || join(homedir(), '.local', 'share', 'triforce', 'workspaces');
if (process.env.TRIFORCE_TRANSCRIPTS === '1') await mkdir(TRANSCRIPTS_DIR, { recursive: true, mode: 0o700 });
const AUTH_TOKEN = process.env.TRIFORCE_TOKEN || randomBytes(32).toString('hex');
if (!process.env.TRIFORCE_TOKEN) console.warn(`TRIFORCE_TOKEN was not set; generated one-time token: ${AUTH_TOKEN}`);
const runRegistry = new RunRegistry();
const NATIVE_CLIENT_ORIGINS = new Set([
  'https://appassets.androidplatform.net',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  ...String(process.env.TRIFORCE_CLIENT_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
]);

const ALLOWED_MODELS = new Map([
  ['anthropic', new Set(['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5', 'claude-3-5-sonnet-latest'])],
  ['google', new Set(['gemini-2.5-flash', 'gemini-2.5-pro'])],
  ['openai', new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'])],
  ['claude-cli', new Set(['claude-cli-default'])],
  ['codex-cli', new Set(['codex-cli-default'])],
  ['agy-cli', new Set(['agy-cli-default'])],
]);

let latestUsage = {
  architect: { inputTokens: 0, outputTokens: 0, cost: 0 },
  developer: { inputTokens: 0, outputTokens: 0, cost: 0 },
  reviewer:  { inputTokens: 0, outputTokens: 0, cost: 0 },
};

async function runValidationPipeline(ws, task, _config, mode) {
  const send = event => ws.send(JSON.stringify(event));
  send({ type: 'status', stage: 'architect', label: `Validating mode ${mode}` });
  await new Promise(resolve => setTimeout(resolve, 75));
  for (const role of ['architect', 'developer', 'reviewer']) {
    send({ type: 'output', role, text: `${role} completed ${task} in mode ${mode}` });
  }
  send({ type: 'pty', role: 'developer', data: `representative remote output for mode ${mode}\n` });
  send({ type: 'done', elapsed: '0.08', passed: true });
}

/**
 * Executes the Triforce multi-agent pipeline.
 * Supports two modes:
 * Mode 1 (Sequential Handoff): Run standard sequence (Architect -> Developer -> Sandbox -> Reviewer)
 *        with full task/plan context passed forward (piggybacking) to save costs and reduce reasoning gaps.
 * Mode 2 (Cooperative Loop): Run a prompt designer specification loop and coder loop, where the
 *        Supervisor checks the specification/code and requests corrections in up to 3 iterative loops.
 */
async function runPipeline(ws, task, config, mode = 1) {
  if (typeof task !== 'string' || !task.trim() || task.length > 50000) throw new Error('Task must be 1-50000 characters');
  if (!config || typeof config !== 'object') throw new Error('Invalid pipeline configuration');
  const maxIterations = Math.min(10, Math.max(1, Number.parseInt(config.maxIterations ?? 3, 10) || 3));
  for (const role of ['architect', 'developer', 'reviewer']) {
    if (!config[role] || typeof config[role].provider !== 'string' || typeof config[role].model !== 'string') throw new Error(`Invalid ${role} configuration`);
    if (!ALLOWED_MODELS.get(config[role].provider)?.has(config[role].model)) throw new Error(`Unsupported ${role} provider/model`);
  }
  mode = [2, 3].includes(mode) ? mode : 1;
  const send = (data) => { if (ws.readyState === 1) ws.send(JSON.stringify(data)); };

  const runLog = { architect: '', developer: '', reviewer: '' };

  try {
    await executePipeline(
      task,
      config,
      mode,
      {
        workspacesDir: WORKSPACES_DIR,
        packageRoot: __dirname,
        dependencyRoot: join(__dirname, 'node_modules'),
      },
      (event) => {
        if (ws.readyState !== 1) return;

        if (event.type === 'output') {
          const { role, text, iteration } = event;
          if (mode === 2) {
            const iterHeader = `\n--- ITERATION ${iteration} ---\n`;
            const textToSave = role === 'reviewer'
              ? (event.label === 'Prompt Check' ? iterHeader + '[Prompt Check]\n' + text + '\n' : iterHeader + '[Code Check]\n' + text + '\n')
              : iterHeader + text + '\n';
            runLog[role] += textToSave;
            send({ type: 'output', role, text: runLog[role] });
          } else if (mode === 3) {
            if (role === 'reviewer') {
              runLog.reviewer += `\n--- ITERATION ${iteration} ---\n${text}\n`;
              send({ type: 'output', role: 'reviewer', text: runLog.reviewer });
            } else {
              runLog[role] = text;
              send({ type: 'output', role, text });
            }
          } else {
            runLog[role] = text;
            send({ type: 'output', role, text });
          }
        } else if (event.type === 'usage') {
          latestUsage = structuredClone(event.usage);
          send(event);
        } else if (event.type === 'cost') {
          send(event);
        } else if (event.type === 'done') {
          send(event);
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
  const total = Object.values(latestUsage).reduce(
    (acc, r) => ({
      inputTokens:  acc.inputTokens  + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cost: acc.cost + r.cost,
    }),
    { inputTokens: 0, outputTokens: 0, cost: 0 }
  );
  res.json({ ...latestUsage, total });
});

app.get('/api/config', async (req, res) => {
  try {
    const raw = await readFile(join(__dirname, 'models.config.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/capabilities', (_req, res) => res.json(capabilities));
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
  const origin = req.headers.origin;
  const expectedOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const originAllowed = origin === expectedOrigin || NATIVE_CLIENT_ORIGINS.has(origin);
  const authorized = requestIsAuthorized(req) || tokenMatches(webSocketProtocolToken(req));
  if (!authorized || !originAllowed) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const unsubscribe = new Set();
  ws.on('close', () => {
    for (const remove of unsubscribe) remove();
    unsubscribe.clear();
  });
  ws.on('message', async (raw) => {
    if (raw.length > 1024 * 1024) return ws.close(1009, 'Message too large');
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!['run', 'subscribe', 'capabilities'].includes(msg.type)) return;
    const parsed = validateClientCommand(msg);
    if (!parsed.success) {
      return ws.send(JSON.stringify({ type: 'protocol_error', code: 'INVALID_COMMAND', message: parsed.error.issues[0]?.message || 'Invalid command' }));
    }
    const command = parsed.data;
    if (command.protocolVersion && !isCompatibleProtocol(command.protocolVersion)) {
      return ws.send(JSON.stringify({ type: 'protocol_error', code: 'INCOMPATIBLE_VERSION', message: `Server requires protocol major ${capabilities.protocolMajor}`, capabilities }));
    }
    if (command.type === 'capabilities') {
      return ws.send(JSON.stringify({ type: 'capabilities', capabilities }));
    }
    if (command.type === 'subscribe') {
      const run = runRegistry.get(command.runId);
      if (!run) return ws.send(JSON.stringify({ type: 'protocol_error', code: 'RUN_NOT_FOUND', message: 'Run not found' }));
      unsubscribe.add(runRegistry.subscribe(run, ws, command.afterEventId));
      return;
    }
    if (command.type === 'run') {
      try {
        const useValidationPipeline = process.env.NODE_ENV === 'test' && process.env.TRIFORCE_E2E_FAKE_PIPELINE === '1';
        const run = runRegistry.start(command, pipelineSocket => useValidationPipeline
          ? runValidationPipeline(pipelineSocket, command.task, command.config, command.mode)
          : runPipeline(pipelineSocket, command.task, command.config, command.mode));
        ws.send(JSON.stringify({ type: 'run_started', run: runRegistry.snapshot(run) }));
        unsubscribe.add(runRegistry.subscribe(run, ws));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', stage: 'architect', message: err.message }));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Triforce server running on http://localhost:${PORT}`));
