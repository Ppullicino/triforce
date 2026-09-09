export const ALLOWED_MODELS = new Map([
  ['claude-cli', new Set(['claude-cli-default'])],
  ['codex-cli', new Set(['codex-cli-default'])],
  ['agy-cli', new Set(['agy-cli-default'])],
]);

export const RATES = {
  'claude-cli-default': [0.00, 0.00],
  'codex-cli-default': [0.00, 0.00],
  'agy-cli-default':   [0.00, 0.00],
};

export function getCatalog() {
  const providers = {};
  for (const [provider, models] of ALLOWED_MODELS) {
    providers[provider] = [...models];
  }
  return { providers, rates: { ...RATES } };
}

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
