import { getRates, hasRates } from './models.js';

const records = [];

export function track(role, model, usage) {
  records.push({ role, model, ...usage });
}

export function printSummary() {
  if (records.length === 0) return;
  console.log('\n=== TOKEN USAGE ===');
  let totalCost = 0;
  for (const { role, model, inputTokens, outputTokens } of records) {
    const [inRate, outRate] = getRates(model);
    const cost = (inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate;
    totalCost += cost;
    const rateNote = hasRates(model) ? '' : ' (unknown rates)';
    console.log(`  ${role.padEnd(10)} ${(model + rateNote).padEnd(30)} in=${inputTokens} out=${outputTokens}  $${cost.toFixed(6)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(10)} ${''.padEnd(30)} $${totalCost.toFixed(6)}`);
}
