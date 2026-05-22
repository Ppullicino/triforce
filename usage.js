// Per-million-token rates [inputUSD, outputUSD]
const RATES = {
  'claude-sonnet-4-6': [3.00,  15.00],
  'claude-opus-4-7':   [15.00, 75.00],
  'claude-haiku-4-5':  [0.80,  4.00],
  'gemini-2.5-flash':  [0.15,  0.60],
  'gemini-2.5-pro':    [1.25,  10.00],
  'gpt-4o':            [2.50,  10.00],
  'gpt-4o-mini':       [0.15,  0.60],
  'gpt-4.1':           [2.00,  8.00],
  'gpt-4.1-mini':      [0.40,  1.60],
};

const records = [];

export function track(role, model, usage) {
  records.push({ role, model, ...usage });
}

export function printSummary() {
  if (records.length === 0) return;
  console.log('\n=== TOKEN USAGE ===');
  let totalCost = 0;
  for (const { role, model, inputTokens, outputTokens } of records) {
    const [inRate, outRate] = RATES[model] ?? [0, 0];
    const cost = (inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate;
    totalCost += cost;
    const rateNote = RATES[model] ? '' : ' (unknown rates)';
    console.log(`  ${role.padEnd(10)} ${(model + rateNote).padEnd(30)} in=${inputTokens} out=${outputTokens}  $${cost.toFixed(6)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(10)} ${''.padEnd(30)} $${totalCost.toFixed(6)}`);
}
