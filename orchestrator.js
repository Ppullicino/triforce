import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { track, printSummary } from './usage.js';
import { executePipeline } from './pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TASK = `Create a JavaScript function that takes an array of numbers, removes duplicates, sorts them in ascending order, and returns the result. Include a test that proves it works.`;

const PROVIDER_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  google:    'GEMINI_API_KEY',
  openai:    'OPENAI_API_KEY',
};

async function loadConfig() {
  const raw = await readFile(new URL('./models.config.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

function validateApiKeys(config) {
  const needed = new Set(Object.values(config).map(c => c.provider));
  for (const provider of needed) {
    const envVar = PROVIDER_ENV[provider];
    if (envVar && !process.env[envVar]) {
      console.error(`ERROR: ${envVar} is not set (required for provider "${provider}")`);
      process.exit(1);
    }
  }
}

export async function runArchitect(agent, task) {
  console.log(`\n=== STAGE 1: CLAUDE CODE (${agent.provider}/${agent.model}) ===`);
  const { text, usage } = await agent.call(task);
  track('architect', agent.model, usage);
  console.log(text);
  return text;
}

/**
 * Entry point for CLI execution.
 * Supports:
 * Mode 1 (Sequential Handoff): Chained prompts where task context is passed through stages.
 * Mode 2 (Cooperative Loop): Multi-agent iteration loops where a Supervisor checks prompt specifications
 *        and compiled sandbox code, requesting revisions on failure (max 3 loops).
 * Mode 3 (Workspace Loop): Multi-file project workspace test loop.
 */
async function main() {
  const startTime = Date.now();
  const config = await loadConfig();
  validateApiKeys(config);
  const taskArgs = process.argv.slice(2).filter((arg, i, args) => arg !== '--mode' && args[i - 1] !== '--mode');
  const TASK = taskArgs.join(' ').trim() || DEFAULT_TASK;

  const modeArgIdx = process.argv.indexOf('--mode');
  const mode = modeArgIdx !== -1 ? parseInt(process.argv[modeArgIdx + 1], 10) : 1;

  console.log(`TRIFORCE PHASE 1 — Starting pipeline in MODE ${mode}...`);
  console.log(`Task: ${TASK}`);

  try {
    await executePipeline(
      TASK,
      config,
      mode,
      {
        workspacesDir: join(__dirname, 'workspaces'),
        packageRoot: __dirname,
        dependencyRoot: join(__dirname, 'node_modules'),
      },
      (event) => {
        switch (event.type) {
          case 'status':
            console.log(`\n=== ${event.label.toUpperCase()} ===`);
            break;
          case 'output':
            console.log(event.text);
            break;
          case 'pty':
            process.stdout.write(event.data);
            break;
          case 'sandbox':
            if (event.timedOut) {
              console.log('[TIMED OUT after 10 seconds]');
            }
            if (!event.stdout && !event.stderr && !event.timedOut) {
              console.log('[No output]');
            }
            break;
          case 'workspace':
            break;
          case 'error':
            console.error(`\nERROR: ${event.message}`);
            process.exit(1);
        }
      }
    );
  } catch (err) {
    console.error(`\nPIPELINE FAILED: ${err.message}`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n=== TRIFORCE PHASE 1 COMPLETE === (${elapsed}s)`);
  printSummary();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
