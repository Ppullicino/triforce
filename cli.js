#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn, fork, execSync, execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { readTask } from './cli-input.js';

const rl = readline.createInterface({ input, output });

let isRunning = false;
let resolveRunPromise = null;
let activeSocket = null;
let promptStarted = false;
let backendExited = false;
let shuttingDown = false;

import { existsSync } from 'node:fs';

function resolveBinPath(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return cmd;
  } catch {
    const localBin = join(os.homedir(), '.local/bin', cmd);
    if (existsSync(localBin)) {
      return localBin;
    }
    return cmd;
  }
}

function checkClaudeLogin() {
  try {
    const claudePath = resolveBinPath('claude');
    const out = execFileSync(claudePath, ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
    return JSON.parse(out).loggedIn === true;
  } catch {
    return false;
  }
}

function checkCodexLogin() {
  try {
    execFileSync(resolveBinPath('codex'), ['login', 'status'], { stdio: 'ignore', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function checkAgyLogin() {
  try {
    execFileSync(resolveBinPath('agy'), ['-p', 'ping'], { stdio: 'ignore', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

async function checkAndInstallDependencies() {
  console.log('\nChecking required CLI tools...');

  const checkCommand = (cmd) => {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      const localBin = join(os.homedir(), '.local/bin', cmd);
      return existsSync(localBin);
    }
  };

  const tools = [
    ['Claude Code', 'claude'], ['Codex', 'codex'], ['Antigravity', 'agy'],
    ['Graphify', 'graphify'], ['systemd-run sandbox helper', 'systemd-run'],
  ];
  const missing = tools.filter(([, command]) => !checkCommand(command));
  for (const [name, command] of tools) console.log(`${checkCommand(command) ? '✅' : '❌'} ${name} (${command})`);
  if (missing.length) {
    console.warn('\nInstall missing tools from their official, versioned distribution instructions before selecting them.');
    console.warn('Triforce does not download or pipe remote installation scripts into a shell.');
  }
}

async function setupWizard() {
  console.log(`
==================================================
         TRIFORCE MULTI-AGENT SETUP
==================================================
`);

  // Step 0: Check dependencies
  console.log('[Step 0/4] Verify CLI dependencies (Claude Code, Codex, Antigravity)...');
  await checkAndInstallDependencies();

  // Step 1: Log in
  console.log('\n[Step 1/4] Log in to the CLI tools (uses your consumer accounts/subscriptions)');

  // 1a: Claude Code
  const isClaudeLoggedIn = checkClaudeLogin();
  if (isClaudeLoggedIn) {
    console.log('✅ Claude Code: Already logged in.');
  }
  const promptClaude = isClaudeLoggedIn 
    ? 'Re-authenticate with Claude Code CLI now? (y/n) [n]: ' 
    : 'Authenticate with Claude Code CLI now? (y/n) [y]: ';
  const authClaude = await rl.question(promptClaude);
  const shouldAuthClaude = isClaudeLoggedIn 
    ? authClaude.toLowerCase().startsWith('y') 
    : !authClaude.toLowerCase().startsWith('n');

  if (shouldAuthClaude) {
    console.log('\nRunning "claude auth login"... Please follow the browser instructions.');
    await new Promise((resolve) => {
      const child = spawn(resolveBinPath('claude'), ['auth', 'login'], { stdio: 'inherit' });
      child.on('close', resolve);
    });
  }

  // 1b: Codex CLI
  const isCodexLoggedIn = checkCodexLogin();
  if (isCodexLoggedIn) {
    console.log('✅ Codex CLI: Already configured/logged in.');
  }
  const promptCodex = isCodexLoggedIn 
    ? 'Re-authenticate with Codex CLI now? (y/n) [n]: ' 
    : 'Authenticate with Codex CLI now? (y/n) [y]: ';
  const authCodex = await rl.question(promptCodex);
  const shouldAuthCodex = isCodexLoggedIn 
    ? authCodex.toLowerCase().startsWith('y') 
    : !authCodex.toLowerCase().startsWith('n');

  if (shouldAuthCodex) {
    const useDeviceAuth = await rl.question('Are you on a remote/headless VM? (y/n) [y]: ');
    const codexArgs = !useDeviceAuth.toLowerCase().startsWith('n') ? ['login', '--device-auth'] : ['login'];
    console.log(`\nRunning "codex ${codexArgs.join(' ')}"... Please follow the instructions.`);
    await new Promise((resolve) => {
      const child = spawn(resolveBinPath('codex'), codexArgs, { stdio: 'inherit' });
      child.on('close', resolve);
    });
  }

  // 1c: Antigravity CLI
  const isAgyLoggedIn = checkAgyLogin();
  if (isAgyLoggedIn) {
    console.log('✅ Antigravity CLI (agy): Already configured/logged in.');
  }
  const promptAgy = isAgyLoggedIn 
    ? 'Re-authenticate with Antigravity CLI now? (y/n) [n]: ' 
    : 'Authenticate with Antigravity CLI (agy) now? (y/n) [y]: ';
  const authAgy = await rl.question(promptAgy);
  const shouldAuthAgy = isAgyLoggedIn 
    ? authAgy.toLowerCase().startsWith('y') 
    : !authAgy.toLowerCase().startsWith('n');

  if (shouldAuthAgy) {
    console.log('\nVerifying Antigravity CLI session... (Follow instructions to sign in if prompted)');
    await new Promise((resolve) => {
      const child = spawn(resolveBinPath('agy'), ['-p', 'ping'], { stdio: 'inherit' });
      child.on('close', resolve);
    });
  }

  // Step 2: Dangerously skip permissions
  console.log('\n[Step 2/4] Skip permission approvals');
  const skipPerms = await rl.question('Enable Dangerously Skip Permission Mode for all 3 agents? (y/n) [y]: ');
  const skipMode = !skipPerms.toLowerCase().startsWith('n');

  // Step 3: Select mode
  console.log('\n[Step 3/4] Default Pipeline Mode');
  console.log('  1: Sequential Pipeline (Architect -> Coder -> Sandbox -> Reviewer)');
  console.log('  2: Supervisor Specification Loop (Prompt Designer <-> Supervisor Loop)');
  console.log('  3: Project Workspace (multi-file project + isolated tests)');
  const defaultModeStr = await rl.question('Select default pipeline mode [1]: ');
  const defaultMode = ['2', '3'].includes(defaultModeStr.trim()) ? Number(defaultModeStr.trim()) : 1;

  // Step 4/4: Configure Role Assignments & Max Iterations
  console.log('\n[Step 4/4] Role Assignments & Loop Limits');
  
  const customRoles = await rl.question('Customize agent role assignments (Planner, Coder, Supervisor)? (y/n) [n]: ');
  
  const config = {
    maxIterations: 3,
    defaultMode,
    architect: { provider: 'claude-cli', model: 'claude-cli-default' },
    developer: { provider: 'claude-cli', model: 'claude-cli-default' },
    reviewer:  { provider: 'claude-cli', model: 'claude-cli-default' }
  };

  const providers = {
    1: { name: 'Local Claude Code CLI (Recommended)', provider: 'claude-cli', model: 'claude-cli-default' },
    2: { name: 'Local Codex CLI', provider: 'codex-cli', model: 'codex-cli-default' },
    3: { name: 'Local Antigravity CLI (agy)', provider: 'agy-cli', model: 'agy-cli-default' },
    4: { name: 'Google Gemini API', provider: 'google', model: 'gemini-2.5-flash' },
    5: { name: 'Anthropic API', provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
    6: { name: 'OpenAI API', provider: 'openai', model: 'gpt-4o' }
  };

  const askRole = async (roleName, defaultChoice) => {
    console.log(`\nSelect provider for ${roleName}:`);
    for (const [key, val] of Object.entries(providers)) {
      console.log(`  ${key}: ${val.name}`);
    }
    const choice = await rl.question(`Select [${defaultChoice}]: `);
    const selected = providers[choice.trim()] || providers[defaultChoice];
    return { provider: selected.provider, model: selected.model };
  };

  if (customRoles.toLowerCase().startsWith('y')) {
    config.architect = await askRole('Planner / Architect', 1);
    config.developer = await askRole('Coder / Developer', 1);
    config.reviewer  = await askRole('Supervisor / Reviewer', 1);
  }
  for (const role of ['architect', 'developer', 'reviewer']) config[role].unsafePermissions = skipMode;

  const itersStr = await rl.question('\nEnter maximum loop iterations (cap) for feedback loop [3]: ');
  const parsedIters = parseInt(itersStr.trim(), 10);
  config.maxIterations = isNaN(parsedIters) ? 3 : parsedIters;

  await writeFile(join(__dirname, 'models.config.json'), JSON.stringify(config, null, 2), 'utf8');
  console.log('\n✅ Configuration saved successfully to models.config.json.');
  
  return { skipMode, defaultMode, config };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function getNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function startServer(authToken) {
  console.log('\nSpinning up the Triforce backend server...');
  const serverProcess = fork(join(__dirname, 'server.js'), [], {
    stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, PORT: '3000', TRIFORCE_TOKEN: authToken }
  });

  serverProcess.stderr.on('data', (data) => {
    const str = data.toString();
    if (str.includes('EADDRINUSE')) {
      console.error('\n❌ Error: Port 3000 is already in use!');
      console.error('If the old systemd service or another Triforce instance is running, stop it first.');
      console.error('To stop the systemd service, run:');
      console.log('  sudo systemctl stop triforce\n');
      process.exit(1);
    }
    process.stderr.write(data);
  });

  serverProcess.stdout.on('data', (data) => {
    if (process.env.DEBUG) {
      process.stdout.write(data);
    }
  });

  serverProcess.once('exit', (code, signal) => {
    backendExited = true;
    if (shuttingDown) return;
    const detail = signal ? `signal ${signal}` : `exit code ${code}`;
    console.error(`\n❌ Triforce backend exited unexpectedly (${detail}).`);
    console.error('Review the backend error above, then reinstall or repair the Triforce package.');
    process.exit(code && code > 0 ? code : 1);
  });
  
  // Clean up server process when CLI exits
  process.on('exit', () => {
    shuttingDown = true;
    serverProcess.kill();
  });
  process.on('SIGINT', () => {
    shuttingDown = true;
    serverProcess.kill();
    process.exit(0);
  });
}

function connectWebSocket(defaultMode, config, authToken) {
  const ws = new WebSocket('ws://localhost:3000', { headers: { Cookie: `triforce_token=${authToken}`, Origin: 'http://localhost:3000' } });

  ws.on('open', () => {
    activeSocket = ws;
    console.log('\n🚀 Connected to Triforce Server!');
    console.log('🌐 Visual Dashboard (Local):   http://localhost:3000/login');
    
    try {
      const networkIPs = getNetworkIPs();
      for (const ip of networkIPs) {
        console.log(`🌐 Visual Dashboard (Network): http://${ip}:3000/login`);
      }
    } catch (err) {}

    console.log('\n💡 TIP: If you are running on a remote VM, you can access the dashboard by:');
    console.log('   1. Opening port 3000 in your VM\'s firewall/security group.');
    console.log('   2. Or using an SSH tunnel from your local machine:');
    console.log('      ssh -L 3000:localhost:3000 <user>@<vm-ip>\n');
    console.log('For multiline prompts, enter /paste, paste the full prompt, then enter /run.\n');
    if (!promptStarted) {
      promptStarted = true;
      promptLoop(defaultMode, config).catch(err => {
        console.error('Prompt loop failed:', err.message);
        process.exit(1);
      });
    }
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'pty') {
      // Print the streaming output from the agents
      process.stdout.write(msg.data);
    } else if (msg.type === 'status') {
      console.log(`\n\n🤖 STAGE: ${msg.label}`);
    } else if (msg.type === 'done') {
      console.log(`\n\n✅ PIPELINE COMPLETE in ${msg.elapsed}s!\n`);
      isRunning = false;
      if (resolveRunPromise) {
        resolveRunPromise();
        resolveRunPromise = null;
      }
    } else if (msg.type === 'error') {
      console.error(`\n❌ ERROR [Stage: ${msg.stage}]: ${msg.message}\n`);
      isRunning = false;
      if (resolveRunPromise) {
        resolveRunPromise();
        resolveRunPromise = null;
      }
    }
  });

  ws.on('close', () => {
    if (activeSocket === ws) activeSocket = null;
    if (isRunning) {
      isRunning = false;
      resolveRunPromise?.();
      resolveRunPromise = null;
    }
    if (!backendExited) {
      console.log('\nBackend connection lost. Retrying...');
      setTimeout(() => connectWebSocket(defaultMode, config, authToken), 2000);
    }
  });

  ws.on('error', (err) => {
    console.error(`\nBackend connection error: ${err.message}`);
  });
}

async function promptLoop(defaultMode, config) {
  while (true) {
    if (isRunning) {
      await new Promise(r => { resolveRunPromise = r; });
    }
    
    const task = await readTask(rl, message => console.log(message));
    if (task === null) continue;
    if (!task.trim()) continue;
    if (task.trim().toLowerCase() === 'exit') {
      process.exit(0);
    }

    isRunning = true;
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      console.log('Backend is reconnecting; task was not submitted.');
      isRunning = false;
      continue;
    }
    activeSocket.send(JSON.stringify({
      type: 'run',
      task: task,
      config: config,
      mode: defaultMode
    }));
  }
}

async function main() {
  let config;
  let defaultMode = 1;

  try {
    const existing = await readFile(join(__dirname, 'models.config.json'), 'utf8');
    config = JSON.parse(existing);
    defaultMode = [2, 3].includes(config.defaultMode) ? config.defaultMode : 1;
    console.log('Existing configuration found in models.config.json.');
    const reconfigure = await rl.question('Do you want to re-run the configuration setup? (y/n) [n]: ');
    if (reconfigure.toLowerCase().startsWith('y')) {
      const setup = await setupWizard();
      config = setup.config;
      defaultMode = setup.defaultMode;
    }
  } catch (err) {
    // Config doesn't exist
    const setup = await setupWizard();
    config = setup.config;
    defaultMode = setup.defaultMode;
  }

  const authToken = process.env.TRIFORCE_TOKEN || randomBytes(32).toString('hex');
  startServer(authToken);
  
  // Wait 1.5 seconds for the server to bind to port 3000
  setTimeout(() => {
    connectWebSocket(defaultMode, config, authToken);
  }, 1500);
}

main().catch(err => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
