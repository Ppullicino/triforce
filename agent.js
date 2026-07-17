import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function resolveBinPath(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return cmd;
  } catch {
    const localBin = join(os.homedir(), '.local/bin', cmd);
    if (existsSync(localBin)) {
      return localBin;
    }
    return cmd;
  }
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const BASE_DELAY_MS = 1000;
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS) || 120000;
const MAX_PROVIDER_OUTPUT_BYTES = Number(process.env.MAX_PROVIDER_OUTPUT_BYTES) || 10 * 1024 * 1024;
const CLI_PROVIDERS = new Set(['claude-cli', 'codex-cli', 'agy-cli']);

function getErrorStatus(err) {
  const status = err?.status ?? err?.statusCode ?? err?.error?.status ?? err?.error?.code ?? err?.code ?? null;
  if (status !== null) {
    if (typeof status === 'string' && status.toUpperCase() === 'RESOURCE_EXHAUSTED') {
      return 429;
    }
    if (typeof status === 'string' || typeof status === 'number') {
      const parsed = parseInt(status, 10);
      if (!isNaN(parsed)) return parsed;
    }
  }
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('overloaded') || msg.includes('resource_exhausted')) {
    return 429;
  }
  return null;
}

function isRetryableError(err) {
  return RETRYABLE_STATUSES.has(getErrorStatus(err)) || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(err?.code);
}

function getRetryAfterMs(err) {
  const headers = err?.headers || err?.response?.headers;
  let retryAfterValue = null;
  
  if (headers) {
    if (typeof headers.get === 'function') {
      retryAfterValue = headers.get('retry-after') || headers.get('Retry-After') || headers.get('x-retry-after');
    } else {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'retry-after' || key.toLowerCase() === 'x-retry-after') {
          retryAfterValue = headers[key];
          break;
        }
      }
    }
  }

  if (retryAfterValue === null || retryAfterValue === undefined) {
    retryAfterValue = err?.retryAfter ?? err?.retryAfterSeconds ?? null;
  }

  if (retryAfterValue !== null && retryAfterValue !== undefined) {
    const parsed = Number(retryAfterValue);
    if (!isNaN(parsed)) {
      return parsed * 1000;
    }
    const dateMs = Date.parse(retryAfterValue);
    if (!isNaN(dateMs)) {
      const waitMs = dateMs - Date.now();
      return waitMs > 0 ? waitMs : 0;
    }
  }
  return null;
}

function firstTextBlock(content) {
  const block = content?.find?.(item => item?.type === 'text' && typeof item.text === 'string');
  if (!block) throw new Error('Provider returned no text content');
  return block.text;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Provider call timed out after ${ms}ms`);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, ms);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer); }
}

export class Agent {
  constructor({ provider, model, systemPrompt, unsafePermissions = false }) {
    this.provider = provider;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.unsafePermissions = unsafePermissions === true;
    this._client = this._initClient();
  }

  _initClient() {
    switch (this.provider) {
      case 'anthropic':
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
        return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      case 'google':
        if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
        return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      case 'openai':
        if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
        return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      case 'claude-cli':
      case 'codex-cli':
      case 'agy-cli':
        return null;
      default:
        throw new Error(`Unknown provider: "${this.provider}"`);
    }
  }

  async call(userPrompt) {
    const startTime = Date.now();
    let lastErr;
    const maxRetries = process.env.TRIFORCE_MAX_RETRIES !== undefined
      ? parseInt(process.env.TRIFORCE_MAX_RETRIES, 10)
      : 3;
    const backoffCap = process.env.TRIFORCE_BACKOFF_CAP_MS !== undefined
      ? parseInt(process.env.TRIFORCE_BACKOFF_CAP_MS, 10)
      : Infinity;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= PROVIDER_TIMEOUT_MS) {
        throw lastErr || new Error(`Provider call exceeded total wall-clock timeout of ${PROVIDER_TIMEOUT_MS}ms`);
      }

      if (attempt > 0) {
        let waitMs = getRetryAfterMs(lastErr);
        if (waitMs === null) {
          waitMs = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 500;
          if (waitMs > backoffCap) {
            waitMs = backoffCap;
          }
        }
        
        const remaining = PROVIDER_TIMEOUT_MS - (Date.now() - startTime);
        if (remaining <= 0) {
          throw lastErr || new Error(`Provider call exceeded total wall-clock timeout of ${PROVIDER_TIMEOUT_MS}ms`);
        }
        
        const sleepTime = Math.min(waitMs, remaining);
        console.warn(`  [retry ${attempt}/${maxRetries}] waiting ${Math.round(sleepTime)}ms...`);
        await delay(sleepTime);
        
        if (Date.now() - startTime >= PROVIDER_TIMEOUT_MS) {
          throw lastErr || new Error(`Provider call exceeded total wall-clock timeout of ${PROVIDER_TIMEOUT_MS}ms`);
        }
      }

      try {
        const remainingTimeout = PROVIDER_TIMEOUT_MS - (Date.now() - startTime);
        if (remainingTimeout <= 0) {
          throw lastErr || new Error(`Provider call exceeded total wall-clock timeout of ${PROVIDER_TIMEOUT_MS}ms`);
        }
        const providerCall = this._callProvider(userPrompt);
        return CLI_PROVIDERS.has(this.provider)
          ? await providerCall
          : await withTimeout(providerCall, remainingTimeout);
      } catch (err) {
        if (isRetryableError(err)) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  async _callProvider(userPrompt) {
    switch (this.provider) {
      case 'anthropic':  return this._callAnthropic(userPrompt);
      case 'google':     return this._callGoogle(userPrompt);
      case 'openai':     return this._callOpenAI(userPrompt);
      case 'claude-cli': return this._callClaudeCLI(userPrompt);
      case 'codex-cli':  return this._callCodexCLI(userPrompt);
      case 'agy-cli':    return this._callAgyCLI(userPrompt);
    }
  }

  async _callAnthropic(userPrompt) {
    const msg = await this._client.messages.create({
      model: this.model,
      max_tokens: 8096,
      system: this.systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    return {
      text: firstTextBlock(msg.content),
      usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
    };
  }

  async _callGoogle(userPrompt) {
    const response = await this._client.models.generateContent({
      model: this.model,
      config: { systemInstruction: this.systemPrompt },
      contents: userPrompt,
    });
    return {
      text: response.text || (() => { throw new Error('Google returned no text content'); })(),
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  async _callOpenAI(userPrompt) {
    const completion = await this._client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    });
    return {
      text: completion.choices?.[0]?.message?.content || (() => { throw new Error('OpenAI returned no text content'); })(),
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  }

  async _callClaudeCLI(userPrompt) {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve, reject) => {
      const args = [];
      if (this.systemPrompt) {
        args.push('--system-prompt', this.systemPrompt);
      }
      args.push('-p');
      if (this.unsafePermissions) args.push('--permission-mode', 'bypassPermissions');

      const child = spawn(resolveBinPath('claude'), args, { detached: process.platform !== 'win32' });
      this._collectChild(child, userPrompt, 'claude', resolve, reject);
    });
  }

  _collectChild(child, stdin, label, resolve, reject, timeoutMs = PROVIDER_TIMEOUT_MS) {
      let stdout = '', stderr = '', settled = false, outputBytes = 0;
      const killTree = () => {
        if (child.pid == null) return;
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { try { child.kill('SIGKILL'); } catch {} }
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        killTree();
        finish(reject, new Error(`${label} CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const collect = (target, data) => {
        outputBytes += data.length;
        if (outputBytes > MAX_PROVIDER_OUTPUT_BYTES) {
          killTree();
          finish(reject, new Error(`${label} CLI exceeded output limit`));
          return target;
        }
        return target + data.toString();
      };

      child.stdout.on('data', data => { stdout = collect(stdout, data); });
      child.stderr.on('data', data => { stderr = collect(stderr, data); });
      child.on('error', err => finish(reject, new Error(`Failed to start ${label} CLI: ${err.message}`)));
      // A CLI may exit before consuming its input. Its close event carries the
      // useful exit code and stderr; consuming the stream error prevents EPIPE
      // from becoming an uncaught process-level error.
      child.stdin.on('error', () => {});

      child.on('close', (code) => {
        if (code !== 0) {
          const err = new Error(`${label} CLI exited with code ${code}. Stderr: ${stderr}`);
          const lowerStderr = stderr.toLowerCase();
          if (
            lowerStderr.includes('rate limit') ||
            lowerStderr.includes('429') ||
            lowerStderr.includes('overloaded') ||
            lowerStderr.includes('usage limit')
          ) {
            err.status = 429;
          }
          finish(reject, err);
        } else {
          finish(resolve, {
            text: stdout.trim(),
            usage: { inputTokens: 0, outputTokens: 0 },
          });
        }
      });

      if (stdin != null) child.stdin.end(stdin);
      else child.stdin.end();
  }

  _codexCLIArgs() {
    const args = ['exec', '--skip-git-repo-check'];
    if (this.unsafePermissions) args.push('--dangerously-bypass-approvals-and-sandbox');
    if (this.systemPrompt) {
      args.push('-c', `system_prompt=${JSON.stringify(this.systemPrompt)}`);
    }
    args.push('-');
    return args;
  }

  async _callCodexCLI(userPrompt) {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve, reject) => {
      const child = spawn(resolveBinPath('codex'), this._codexCLIArgs(), { detached: process.platform !== 'win32' });
      this._collectChild(child, userPrompt, 'codex', resolve, reject);
    });
  }

  async _callAgyCLI(userPrompt) {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve, reject) => {
      const fullPrompt = this.systemPrompt 
        ? `[System Instructions]\n${this.systemPrompt}\n\n[User Request]\n${userPrompt}`
        : userPrompt;

      const args = this.unsafePermissions ? ['--dangerously-skip-permissions'] : [];
      args.push('-p', fullPrompt);

      const child = spawn(resolveBinPath('agy'), args, { detached: process.platform !== 'win32' });
      this._collectChild(child, null, 'agy', resolve, reject);
    });
  }
}
