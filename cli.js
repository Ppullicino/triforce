#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn, fork } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';

const rl = readline.createInterface({ input, output });

let isRunning = false;
let resolveRunPromise = null;

async function setupWizard() {
  console.log(`
==================================================
         TRIFORCE MULTI-AGENT SETUP
==================================================
`);

  // Step 1: Log in
  console.log('[Step 1/3] Log in to Claude Code (uses your Claude Pro subscription)');
  const authClaude = await rl.question('Authenticate with Claude Code CLI now? (y/n) [y]: ');
  if (!authClaude.toLowerCase().startsWith('n')) {
    console.log('\nRunning "claude auth login"... Please follow the browser instructions.');
    await new Promise((resolve) => {
      const child = spawn('claude', ['auth', 'login'], { stdio: 'inherit' });
      child.on('close', resolve);
    });
  }

  // Step 2: Dangerously skip permissions
  console.log('\n[Step 2/3] Skip permission approvals');
  const skipPerms = await rl.question('Enable Dangerously Skip Permission Mode for all 3 agents? (y/n) [y]: ');
  const skipMode = !skipPerms.toLowerCase().startsWith('n');

  // Step 3: Select mode
  console.log('\n[Step 3/3] Default Pipeline Mode');
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

function startServer() {
  console.log('\nSpinning up the Triforce backend server...');
  const serverProcess = fork('server.js', [], {
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
