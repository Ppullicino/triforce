#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn, fork, execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';
import os from 'node:os';

const rl = readline.createInterface({ input, output });

let isRunning = false;
let resolveRunPromise = null;

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

async function checkAndInstallDependencies(forceUpdate = false) {
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

  // 1. Claude Code
  const hasClaude = checkCommand('claude');
  if (!hasClaude || forceUpdate) {
    const action = !hasClaude ? 'Installing' : 'Updating';
    console.log(`⚠️ ${action} Claude Code CLI globally...`);
    try {
      execSync('npm install -g @anthropic-ai/claude-code@latest', { stdio: 'inherit' });
      console.log('✅ Claude Code installed/updated successfully!');
    } catch (err) {
      console.error('❌ Failed to install/update Claude Code:', err.message);
    }
  } else {
    console.log('✅ Claude Code is installed.');
  }

  // 2. Codex
  const hasCodex = checkCommand('codex');
  if (!hasCodex || forceUpdate) {
    const action = !hasCodex ? 'Installing' : 'Updating';
    console.log(`⚠️ ${action} Codex CLI globally...`);
    try {
      execSync('npm install -g @openai/codex@latest', { stdio: 'inherit' });
      console.log('✅ Codex installed/updated successfully!');
    } catch (err) {
      console.error('❌ Failed to install/update Codex:', err.message);
    }
  } else {
    console.log('✅ Codex is installed.');
  }

  // 3. Antigravity (agy)
  const hasAgy = checkCommand('agy');
  if (!hasAgy || forceUpdate) {
    const action = !hasAgy ? 'Installing' : 'Updating';
    console.log(`⚠️ ${action} Antigravity CLI (agy) using installer...`);
    try {
      const hasCurl = checkCommand('curl');
      const installCmd = hasCurl
        ? 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
        : 'wget -qO- https://antigravity.google/cli/install.sh | bash';
      execSync(installCmd, { stdio: 'inherit' });
      console.log('✅ Antigravity CLI (agy) installed/updated successfully!');
    } catch (err) {
      console.error('❌ Failed to install/update Antigravity CLI (agy):', err.message);
    }
  } else {
    console.log('✅ Antigravity CLI (agy) is installed.');
  }

  // 4. Graphify (graphifyy)
  const hasGraphify = checkCommand('graphify');
  if (!hasGraphify || forceUpdate) {
    const action = !hasGraphify ? 'Installing' : 'Updating';
    console.log(`⚠️ ${action} Graphify via uv/pip...`);
    try {
      // If uv is not installed, install it locally to ~/.local/bin
      if (!checkCommand('uv')) {
        console.log('⚠️ uv is not installed. Attempting to install uv locally...');
        try {
          const uvInstallCmd = checkCommand('curl')
            ? 'curl -LsSf https://astral.sh/uv/install.sh | sh'
            : 'wget -qO- https://astral.sh/uv/install.sh | sh';
          execSync(uvInstallCmd, { stdio: 'inherit' });
        } catch (err) {
          console.log('⚠️ Failed to install uv via installer:', err.message);
        }
      }

      // Check if uv is now available (either in PATH or via resolveBinPath)
      const uvPath = resolveBinPath('uv');
      const hasLocalUv = existsSync(uvPath) || checkCommand('uv');

      if (hasLocalUv) {
        execSync(`${uvPath} tool install --force graphifyy`, { stdio: 'inherit' });
      } else if (checkCommand('pipx')) {
        execSync('pipx install --force graphifyy', { stdio: 'inherit' });
      } else {
        execSync('pip install --upgrade graphifyy', { stdio: 'inherit' });
      }
      console.log('✅ Graphify installed/updated successfully!');
    } catch (err) {
      console.error('❌ Failed to install/update Graphify:', err.message);
    }
  } else {
    console.log('✅ Graphify is installed.');
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
  const updateCLIs = await rl.question('Check and update all three CLIs to their latest versions? (y/n) [n]: ');
  await checkAndInstallDependencies(updateCLIs.toLowerCase().startsWith('y'));

  // Step 1: Log in
  console.log('\n[Step 1/4] Log in to the CLI tools (uses your consumer accounts/subscriptions)');

  // 1a: Claude Code
  const authClaude = await rl.question('Authenticate with Claude Code CLI now? (y/n) [y]: ');
  if (!authClaude.toLowerCase().startsWith('n')) {
    console.log('\nRunning "claude auth login"... Please follow the browser instructions.');
    await new Promise((resolve) => {
      const child = spawn(resolveBinPath('claude'), ['auth', 'login'], { stdio: 'inherit' });
      child.on('close', resolve);
    });
  }

  // 1b: Codex CLI
  const authCodex = await rl.question('\nAuthenticate with Codex CLI now? (y/n) [y]: ');
  if (!authCodex.toLowerCase().startsWith('n')) {
    const useDeviceAuth = await rl.question('Are you on a remote/headless VM? (y/n) [y]: ');
    const codexArgs = !useDeviceAuth.toLowerCase().startsWith('n') ? ['login', '--device-auth'] : ['login'];
    console.log(`\nRunning "codex ${codexArgs.join(' ')}"... Please follow the instructions.`);
    await new Promise((resolve) => {
      const child = spawn(resolveBinPath('codex'), codexArgs, { stdio: 'inherit' });
      child.on('close', resolve);
    });
  }

  // 1c: Antigravity CLI
  const authAgy = await rl.question('\nAuthenticate with Antigravity CLI (agy) now? (y/n) [y]: ');
  if (!authAgy.toLowerCase().startsWith('n')) {
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
  const defaultModeStr = await rl.question('Select default pipeline mode [1]: ');
  const defaultMode = defaultModeStr.trim() === '2' ? 2 : 1;

  // Step 4/4: Configure Role Assignments & Max Iterations
  console.log('\n[Step 4/4] Role Assignments & Loop Limits');
  
  const customRoles = await rl.question('Customize agent role assignments (Planner, Coder, Supervisor)? (y/n) [n]: ');
  
  const config = {
    maxIterations: 3,
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

  const itersStr = await rl.question('\nEnter maximum loop iterations (cap) for feedback loop [3]: ');
  const parsedIters = parseInt(itersStr.trim(), 10);
  config.maxIterations = isNaN(parsedIters) ? 3 : parsedIters;

  await writeFile('./models.config.json', JSON.stringify(config, null, 2), 'utf8');
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

function startServer() {
  console.log('\nSpinning up the Triforce backend server...');
  const serverProcess = fork(join(__dirname, 'server.js'), [], {
    stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, PORT: '3000' }
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
  });
  
  // Clean up server process when CLI exits
  process.on('exit', () => serverProcess.kill());
  process.on('SIGINT', () => {
    serverProcess.kill();
    process.exit(0);
  });
}

function connectWebSocket(defaultMode, config) {
  const ws = new WebSocket('ws://localhost:3000');

  ws.on('open', () => {
    console.log('\n🚀 Connected to Triforce Server!');
    console.log('🌐 Visual Dashboard (Local):   http://localhost:3000');
    
    try {
      const networkIPs = getNetworkIPs();
      for (const ip of networkIPs) {
        console.log(`🌐 Visual Dashboard (Network): http://${ip}:3000`);
      }
    } catch (err) {}

    console.log('\n💡 TIP: If you are running on a remote VM, you can access the dashboard by:');
    console.log('   1. Opening port 3000 in your VM\'s firewall/security group.');
    console.log('   2. Or using an SSH tunnel from your local machine:');
    console.log('      ssh -L 3000:localhost:3000 <user>@<vm-ip>\n');
    promptLoop(ws, defaultMode, config);
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
    console.log('\nBackend connection lost. Retrying...');
    setTimeout(() => connectWebSocket(defaultMode, config), 2000);
  });

  ws.on('error', () => {
    // Fail silently, ws close event will handle reconnection
  });
}

async function promptLoop(ws, defaultMode, config) {
  while (true) {
    if (isRunning) {
      await new Promise(r => { resolveRunPromise = r; });
    }
    
    const task = await rl.question('Triforce> ');
    if (!task.trim()) continue;
    if (task.trim().toLowerCase() === 'exit') {
      process.exit(0);
    }

    isRunning = true;
    ws.send(JSON.stringify({
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
    const existing = await readFile('./models.config.json', 'utf8');
    config = JSON.parse(existing);
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

  startServer();
  
  // Wait 1.5 seconds for the server to bind to port 3000
  setTimeout(() => {
    connectWebSocket(defaultMode, config);
  }, 1500);
}

main().catch(err => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
