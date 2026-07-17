export const ALLOWED_MODELS = new Map([
  ['anthropic', new Set(['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5', 'claude-3-5-sonnet-latest'])],
  ['google', new Set(['gemini-2.5-flash', 'gemini-2.5-pro'])],
  ['openai', new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'])],
  ['claude-cli', new Set(['claude-cli-default'])],
  ['codex-cli', new Set(['codex-cli-default'])],
  ['agy-cli', new Set(['agy-cli-default'])],
]);

export const RATES = {
  'claude-sonnet-4-6': [3.00,  15.00],
  'claude-opus-4-7':   [15.00, 75.00],
  'claude-haiku-4-5':  [0.80,  4.00],
  'claude-3-5-sonnet-latest': [3.00, 15.00],
  'gemini-2.5-flash':  [0.15,  0.60],
  'gemini-2.5-pro':    [1.25,  10.00],
  'gpt-4o':            [2.50,  10.00],
  'gpt-4o-mini':       [0.15,  0.60],
  'gpt-4.1':           [2.00,  8.00],
  'gpt-4.1-mini':      [0.40,  1.60],
  'claude-cli-default': [0.00, 0.00],
  'codex-cli-default': [0.00, 0.00],
  'agy-cli-default':   [0.00, 0.00],
};

const warnedModels = new Set();

export function getRates(model) {
  if (model in RATES) {
    return RATES[model];
  }
  if (!warnedModels.has(model)) {
    warnedModels.add(model);
    console.warn(`Warning: Model "${model}" is not in the model catalog. Defaulting cost rates to $0.00.`);
  }
  return [0, 0];
}

export function hasRates(model) {
  return model in RATES;
}

export function checkConfigForWarnings(config) {
  for (const role of ['architect', 'developer', 'reviewer']) {
    const entry = config[role];
    if (entry && entry.provider && entry.model) {
      const allowedSet = ALLOWED_MODELS.get(entry.provider);
      if (!allowedSet || !allowedSet.has(entry.model)) {
        console.warn(`Warning: Configuration entry for "${role}" uses model "${entry.model}" (provider "${entry.provider}") which is missing from the catalog.`);
      }
    }
  }
}
