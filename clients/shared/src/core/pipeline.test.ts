import { expect, test } from 'vitest';
import { initialPipelineState, reducePipeline } from './pipeline';

test('assembles structured pipeline events into a view model', () => {
  let state = initialPipelineState();
  state = reducePipeline(state, { type: 'status', runId: 'run', stage: 'architect', label: 'Planning' });
  state = reducePipeline(state, { type: 'output', role: 'architect', text: 'Plan' });
  state = reducePipeline(state, { type: 'done', elapsed: 2.4, passed: true });
  expect(state).toMatchObject({ runId: 'run', stage: 'architect', status: 'completed', elapsed: 2.4 });
  expect(state.outputs.architect).toBe('Plan');
});

test('bounds long terminal streams', () => {
  const state = reducePipeline(initialPipelineState(), { type: 'pty', data: 'x'.repeat(250_000) });
  expect(state.terminal).toHaveLength(200_000);
});
