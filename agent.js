import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

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
      case 'anthropic': return this._callAnthropic(userPrompt);
      case 'google':    return this._callGoogle(userPrompt);
      case 'openai':    return this._callOpenAI(userPrompt);
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
}
