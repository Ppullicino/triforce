import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

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

const RETRYABLE_STATUSES = new Set([429, 503]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function getErrorStatus(err) {
  return err?.status ?? err?.statusCode ?? err?.error?.status ?? null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Agent {
  constructor({ provider, model, systemPrompt }) {
    this.provider = provider;
    this.model = model;
    this.systemPrompt = systemPrompt;
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
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 500;
        console.warn(`  [retry ${attempt}/${MAX_RETRIES}] waiting ${Math.round(backoff)}ms...`);
        await delay(backoff);
      }
      try {
        return await this._callProvider(userPrompt);
      } catch (err) {
        if (RETRYABLE_STATUSES.has(getErrorStatus(err))) {
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
      text: msg.content[0].text,
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
      text: response.text,
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
      text: completion.choices[0].message.content,
      usage: {
        inputTokens: completion.usage.prompt_tokens,
        outputTokens: completion.usage.completion_tokens,
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
      args.push('--permission-mode', 'bypassPermissions');

      const child = spawn(resolveBinPath('claude'), args);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code}. Stderr: ${stderr}`));
        } else {
          resolve({
            text: stdout.trim(),
            usage: { inputTokens: 0, outputTokens: 0 },
          });
        }
      });

      child.stdin.write(userPrompt);
      child.stdin.end();
    });
  }

  async _callCodexCLI(userPrompt) {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve, reject) => {
      const args = ['exec', '--dangerously-bypass-approvals-and-sandbox'];
      if (this.systemPrompt) {
        args.push('-c', `system_prompt=${JSON.stringify(this.systemPrompt)}`);
      }
      args.push('-');

      const child = spawn(resolveBinPath('codex'), args);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`codex CLI exited with code ${code}. Stderr: ${stderr}`));
        } else {
          resolve({
            text: stdout.trim(),
            usage: { inputTokens: 0, outputTokens: 0 },
          });
        }
      });

      child.stdin.write(userPrompt);
      child.stdin.end();
    });
  }

  async _callAgyCLI(userPrompt) {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve, reject) => {
      const fullPrompt = this.systemPrompt 
        ? `[System Instructions]\n${this.systemPrompt}\n\n[User Request]\n${userPrompt}`
        : userPrompt;

      const args = ['--dangerously-skip-permissions', '-p', fullPrompt];

      const child = spawn(resolveBinPath('agy'), args);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`agy CLI exited with code ${code}. Stderr: ${stderr}`));
        } else {
          resolve({
            text: stdout.trim(),
            usage: { inputTokens: 0, outputTokens: 0 },
          });
        }
      });
    });
  }
}

