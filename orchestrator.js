import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { Agent } from './agent.js';
import { track, printSummary } from './usage.js';

const TASK = `Create a JavaScript function that takes an array of numbers, removes duplicates, sorts them in ascending order, and returns the result. Include a test that proves it works.`;

const SYSTEM_PROMPTS = {
  architect: 'You are the Architect agent in the Triforce system. Your job is to analyze a coding task and produce a clear, structured implementation plan. Output ONLY the plan as numbered steps. No code. No markdown formatting. No preamble.',
  developer: 'You are the Developer agent in the Triforce system. You receive an implementation plan and your job is to write the code. Output ONLY valid, executable JavaScript. No markdown code fences. No explanatory text. No comments unless they are inline code comments. The code must run directly with Node.js.',
  reviewer:  'You are the Reviewer agent in the Triforce system. You receive code written by another agent and the terminal output from executing that code. Analyze both and produce a clear Pass/Fail verdict. If Pass: confirm what worked. If Fail: identify exactly what went wrong and what should be fixed. Be concise and specific.',
};

const SYSTEM_PROMPTS_MODE2 = {
  designer: 'You are the Prompt Designer agent in the Triforce system. Your job is to analyze a coding task and produce a clear, detailed specification/prompt for a programmer. If you receive feedback from the Supervisor, refine the specification accordingly. Output ONLY the specification. No conversational preamble. No markdown formatting.',
  coder: 'You are the Coder agent in the Triforce system. Your job is to write valid, executable JavaScript code based on the specification provided. If you receive feedback/errors from the Supervisor/Sandbox, update the code to fix the issues. Output ONLY valid, executable JavaScript. No markdown code fences. No explanatory text. No comments unless they are inline code comments. The code must run directly with Node.js.',
  supervisorPromptCheck: 'You are the Supervisor agent in the Triforce system. Your job is to review a coding specification designed by another agent. Decide if it is ready for the coder (Greenlight) or needs refinement (Fix). If it needs refinement, provide specific feedback. Output your verdict in this exact format:\nVERDICT: [GREENLIGHT or FIX]\nFEEDBACK: [Your feedback if verdict is FIX]',
  supervisorCodeCheck: 'You are the Supervisor agent in the Triforce system. You receive the coder\'s Javascript code and the terminal output from executing it in a sandbox. Analyze both and produce a clear Pass/Fail verdict. If it works, output \'VERDICT: PASS\'. If it fails, output \'VERDICT: FAIL\' and specify what needs to be fixed. Output format:\nVERDICT: [PASS or FAIL]\nFEEDBACK: [Your feedback if verdict is FAIL]'
};

const PROVIDER_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  google:    'GEMINI_API_KEY',
  openai:    'OPENAI_API_KEY',
};

function stripCodeFences(text) {
  return text
    .replace(/^```(?:javascript|js)?\n?/gm, '')
    .replace(/^```\n?/gm, '')
    .trim();
}

function runInSandbox(code, timeoutMs = 10000) {
  return new Promise(async (resolve) => {
    await writeFile('sandbox.js', code, 'utf8');
    exec('node sandbox.js', { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, exitCode: err ? err.code : 0, timedOut: err?.killed ?? false });
    });
  });
}

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

async function runArchitect(agent) {
  console.log(`\n=== STAGE 1: CLAUDE CODE (${agent.provider}/${agent.model}) ===`);
  const { text, usage } = await agent.call(TASK);
  track('architect', agent.model, usage);
  console.log(text);
  return text;
}

async function runDeveloper(agent, plan) {
  console.log(`\n=== STAGE 2: DEVELOPER (${agent.provider}/${agent.model}) ===`);
  const { text, usage } = await agent.call(plan);
  track('developer', agent.model, usage);
  const code = stripCodeFences(text);
  console.log(code);
  return code;
}

async function runSandbox(code) {
  console.log('\n=== STAGE 3: SANDBOX EXECUTION ===');
  const result = await runInSandbox(code);
  if (result.timedOut) console.log('[TIMED OUT after 10 seconds]');
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error('[stderr]', result.stderr);
  if (!result.stdout && !result.stderr && !result.timedOut) console.log('[No output]');
  return result;
}

async function runReviewer(agent, code, sandboxResult) {
  console.log(`\n=== STAGE 4: REVIEWER (${agent.provider}/${agent.model}) ===`);
  const executionSummary = [
    `Exit code: ${sandboxResult.exitCode ?? 0}`,
    sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
    sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
    sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `CODE:\n${code}\n\nEXECUTION RESULTS:\n${executionSummary}`;
  const { text, usage } = await agent.call(prompt);
  track('reviewer', agent.model, usage);
  console.log(text);
}

/**
 * Entry point for CLI execution.
 * Supports:
 * Mode 1 (Sequential Handoff): Chained prompts where task context is passed through stages.
 * Mode 2 (Cooperative Loop): Multi-agent iteration loops where a Supervisor checks prompt specifications
 *        and compiled sandbox code, requesting revisions on failure (max 3 loops).
 */
async function main() {
  const startTime = Date.now();
  const config = await loadConfig();
  validateApiKeys(config);

  const modeArgIdx = process.argv.indexOf('--mode');
  const mode = modeArgIdx !== -1 ? parseInt(process.argv[modeArgIdx + 1], 10) : 1;

  console.log(`TRIFORCE PHASE 1 — Starting pipeline in MODE ${mode}...`);
  console.log(`Task: ${TASK}`);

  if (mode === 2) {
    // ── Mode 2 Cooperative Loop ──
    const designerAgent = new Agent({ ...config.architect, systemPrompt: SYSTEM_PROMPTS_MODE2.designer });
    const coderAgent = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS_MODE2.coder });
    const promptSupervisor = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS_MODE2.supervisorPromptCheck });
    const codeSupervisor = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS_MODE2.supervisorCodeCheck });

    let spec = '';
    let specApproved = false;
    let runLog = { architect: '', developer: '', reviewer: '' };

    // ── Stage 1 & 4 (Prompt Loop) ──
    let designerPrompt = `TASK:\n${TASK}`;
    let promptLoopCount = 0;

    while (promptLoopCount < 3 && !specApproved) {
      promptLoopCount++;
      const iterHeader = `\n--- ITERATION ${promptLoopCount} ---\n`;
      
      // Call Prompt Designer
      console.log(`\n=== STAGE 1: PROMPT DESIGNER (Iteration ${promptLoopCount}) (${designerAgent.provider}/${designerAgent.model}) ===`);
      try {
        const { text, usage } = await designerAgent.call(designerPrompt);
        track('architect', designerAgent.model, usage);
        spec = text;
        runLog.architect += iterHeader + text + '\n';
        console.log(text);
      } catch (err) {
        console.error(`\nPROMPT DESIGNER FAILED: ${err.message}`);
        process.exit(1);
      }

      // Call Supervisor for Prompt Check
      console.log(`\n=== STAGE 4: SUPERVISOR (Prompt Check Iteration ${promptLoopCount}) (${promptSupervisor.provider}/${promptSupervisor.model}) ===`);
      let supervisorResult;
      try {
        const { text, usage } = await promptSupervisor.call(`SPECIFICATION TO REVIEW:\n${spec}`);
        track('reviewer', promptSupervisor.model, usage);
        supervisorResult = text;
        runLog.reviewer += iterHeader + '[Prompt Check]\n' + text + '\n';
        console.log(text);
      } catch (err) {
        console.error(`\nSUPERVISOR PROMPT CHECK FAILED: ${err.message}`);
        process.exit(1);
      }

      // Parse verdict
      const verdictMatch = supervisorResult.match(/VERDICT:\s*(\w+)/i);
      const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'FIX';
      if (verdict === 'GREENLIGHT') {
        specApproved = true;
        console.log(`\n\x1b[32m[GREENLIGHT] Specification approved by Supervisor.\x1b[0m`);
      } else {
        const feedbackMatch = supervisorResult.match(/FEEDBACK:\s*([\s\S]+)/i);
        const feedback = feedbackMatch ? feedbackMatch[1].trim() : 'Please refine the specification.';
        console.log(`\n\x1b[31m[FIX] Supervisor requested refinement.\x1b[0m`);
        
        // Update Prompt Designer's next prompt with feedback
        designerPrompt = `SPECIFICATION GENERATED:\n${spec}\n\nSUPERVISOR FEEDBACK:\n${feedback}\n\nPlease update the specification to address this feedback.`;
      }
    }

    if (!specApproved) {
      console.error('\nERROR: Failed to design a specification acceptable to the Supervisor after 3 iterations.');
      process.exit(1);
    }

    // ── Stage 2 & 4 (Code Loop) ──
    let codeApproved = false;
    let codeLoopCount = 0;
    let coderPrompt = `SPECIFICATION:\n${spec}`;
    let code = '';
    let sandboxResult;

    while (codeLoopCount < 3 && !codeApproved) {
      codeLoopCount++;
      const iterHeader = `\n--- ITERATION ${codeLoopCount} ---\n`;

      // Call Coder (Developer)
      console.log(`\n=== STAGE 2: CODER (Iteration ${codeLoopCount}) (${coderAgent.provider}/${coderAgent.model}) ===`);
      try {
        const { text, usage } = await coderAgent.call(coderPrompt);
        track('developer', coderAgent.model, usage);
        code = stripCodeFences(text);
        runLog.developer += iterHeader + code + '\n';
        console.log(code);
      } catch (err) {
        console.error(`\nCODER FAILED: ${err.message}`);
        process.exit(1);
      }

      // Run Sandbox
      console.log('\n=== STAGE 3: SANDBOX EXECUTION ===');
      try {
        sandboxResult = await runSandbox(code);
      } catch (err) {
        console.error(`\nSTAGE 3 FAILED unexpectedly: ${err.message}`);
        sandboxResult = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
      }

      // Call Supervisor for Code Check
      console.log(`\n=== STAGE 4: SUPERVISOR (Code Check Iteration ${codeLoopCount}) (${codeSupervisor.provider}/${codeSupervisor.model}) ===`);

      const executionSummary = [
        `Exit code: ${sandboxResult.exitCode ?? 0}`,
        sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
        sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
        sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
      ].filter(Boolean).join('\n');

      let supervisorResult;
      try {
        const prompt = `SPECIFICATION:\n${spec}\n\nCODE GENERATED:\n${code}\n\nSANDBOX RUN RESULTS:\n${executionSummary}`;
        const { text, usage } = await codeSupervisor.call(prompt);
        track('reviewer', codeSupervisor.model, usage);
        supervisorResult = text;
        runLog.reviewer += iterHeader + '[Code Check]\n' + text + '\n';
        console.log(text);
      } catch (err) {
        console.error(`\nSUPERVISOR CODE CHECK FAILED: ${err.message}`);
        process.exit(1);
      }

      // Parse verdict
      const verdictMatch = supervisorResult.match(/VERDICT:\s*(\w+)/i);
      const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'FAIL';
      if (verdict === 'PASS') {
        codeApproved = true;
        console.log(`\n\x1b[32m[PASS] Code approved by Supervisor.\x1b[0m`);
      } else {
        const feedbackMatch = supervisorResult.match(/FEEDBACK:\s*([\s\S]+)/i);
        const feedback = feedbackMatch ? feedbackMatch[1].trim() : 'Please fix the code.';
        console.log(`\n\x1b[31m[FAIL] Supervisor flagged code issues.\x1b[0m`);

        // Update Coder's prompt with feedback and sandbox results
        coderPrompt = `PREVIOUS CODE:\n${code}\n\nSANDBOX RUN RESULTS:\n${executionSummary}\n\nSUPERVISOR FEEDBACK:\n${feedback}\n\nPlease update the code to fix these issues. Output ONLY the updated Javascript code, no comments or markdown.`;
      }
    }

    if (!codeApproved) {
      console.error('\nERROR: Failed to write code that passes Supervisor checks after 3 iterations.');
      process.exit(1);
    }

  } else {
    // ── Mode 1: Sequential Pipeline (Task + Plan Context Piggybacking) ──
    const agents = Object.fromEntries(
      Object.entries(config).map(([role, { provider, model }]) => [
        role,
        new Agent({ provider, model, systemPrompt: SYSTEM_PROMPTS[role] }),
      ])
    );

    let plan;
    try {
      plan = await runArchitect(agents.architect);
    } catch (err) {
      console.error(`\nSTAGE 1 FAILED: ${err.message}`);
      process.exit(1);
    }

    // Pass Task + Plan context to Developer
    console.log(`\n=== STAGE 2: CODEX (${agents.developer.provider}/${agents.developer.model}) ===`);
    let code;
    try {
      const prompt = `TASK:\n${TASK}\n\nPLAN:\n${plan}`;
      const { text, usage } = await agents.developer.call(prompt);
      track('developer', agents.developer.model, usage);
      code = stripCodeFences(text);
      console.log(code);
    } catch (err) {
      console.error(`\nSTAGE 2 FAILED: ${err.message}`);
      process.exit(1);
    }

    // Run Sandbox
    let sandboxResult;
    try {
      sandboxResult = await runSandbox(code);
    } catch (err) {
      console.error(`\nSTAGE 3 FAILED unexpectedly: ${err.message}`);
      sandboxResult = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
    }

    // Pass Task + Plan + Code + Sandbox context to Reviewer
    console.log(`\n=== STAGE 4: ANTIGRAVITY (${agents.reviewer.provider}/${agents.reviewer.model}) ===`);
    try {
      const executionSummary = [
        `Exit code: ${sandboxResult.exitCode ?? 0}`,
        sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
        sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
        sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
      ].filter(Boolean).join('\n');

      const prompt = `TASK:\n${TASK}\n\nARCHITECT PLAN:\n${plan}\n\nCODE:\n${code}\n\nEXECUTION RESULTS:\n${executionSummary}`;
      const { text, usage } = await agents.reviewer.call(prompt);
      track('reviewer', agents.reviewer.model, usage);
      console.log(text);
    } catch (err) {
      console.error(`\nSTAGE 4 FAILED: ${err.message}`);
      process.exit(1);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n=== TRIFORCE PHASE 1 COMPLETE === (${elapsed}s)`);
  printSummary();
}

main();
