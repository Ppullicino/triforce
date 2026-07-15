#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn, fork, execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

const rl = readline.createInterface({ input, output });

let isRunning = false;
let resolveRunPromise = null;

async function checkAndInstallDependencies(forceUpdate = false) {
  console.log('\nChecking required CLI tools...');

  const checkCommand = (cmd) => {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
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
    console.log(`⚠️ ${action} Antigravity CLI (agy) to ~/.local/bin/agy...`);
    try {
      const installCmd = `
        mkdir -p /tmp/agy-install && 
        cd /tmp/agy-install && 
        wget -q https://antigravity.google/cli/releases/latest/agy-linux-amd64-v1.tar.gz && 
        tar -xzf agy-linux-amd64-v1.tar.gz && 
        mkdir -p ~/.local/bin && 
        mv agy ~/.local/bin/agy && 
        chmod +x ~/.local/bin/agy && 
        rm -rf /tmp/agy-install
      `;
      execSync(installCmd, { stdio: 'inherit' });
      console.log('✅ Antigravity CLI (agy) installed/updated successfully!');
    } catch (err) {
      console.error('❌ Failed to install/update Antigravity CLI (agy):', err.message);
    }
  } else {
    console.log('✅ Antigravity CLI (agy) is installed.');
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
  console.log('\n[Step 1/4] Log in to Claude Code (uses your Claude Pro subscription)');
  const authClaude = await rl.question('Authenticate with Claude Code CLI now? (y/n) [y]: ');
  if (!authClaude.toLowerCase().startsWith('n')) {
    console.log('\nRunning "claude auth login"... Please follow the browser instructions.');
    await new Promise((resolve) => {
      const child = spawn('claude', ['auth', 'login'], { stdio: 'inherit' });
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

  // Build model configuration mapping to local claude-cli
  const config = {
    architect: { provider: 'claude-cli', model: 'claude-cli-default' },
    developer: { provider: 'claude-cli', model: 'claude-cli-default' },
    reviewer:  { provider: 'claude-cli', model: 'claude-cli-default' }
  };

  await writeFile('./models.config.json', JSON.stringify(config, null, 2), 'utf8');
  console.log('\n✅ Configuration saved successfully to models.config.json.');
  
  return { skipMode, defaultMode, config };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function startServer() {
  console.log('\nSpinning up the Triforce backend server...');
  const serverProcess = fork(join(__dirname, 'server.js'), [], {
    stdio: 'ignore', // Let it run silently in the background
    env: { ...process.env, PORT: '3000' }
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
    console.log('🌐 Visual Dashboard: http://localhost:3000\n');
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
