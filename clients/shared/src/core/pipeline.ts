import type { AgentRole, ServerEvent } from '@triforce/protocol';

const MAX_TERMINAL_CHARS = 200_000;
export interface UsageItem { inputTokens: number; outputTokens: number; cost: number }
export interface PipelineViewState {
  runId: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';
  stage: string;
  label: string;
  outputs: Record<AgentRole, string>;
  terminal: string;
  usage: Record<AgentRole, UsageItem>;
  sandbox: Record<string, unknown> | null;
  workspace: Record<string, unknown> | null;
  elapsed: number | null;
  error: string | null;
}

const emptyUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };
export function initialPipelineState(): PipelineViewState {
  return {
    runId: null, status: 'idle', stage: '', label: '',
    outputs: { architect: '', developer: '', reviewer: '' }, terminal: '',
    usage: { architect: { ...emptyUsage }, developer: { ...emptyUsage }, reviewer: { ...emptyUsage } },
    sandbox: null, workspace: null, elapsed: null, error: null,
  };
}

export function reducePipeline(state: PipelineViewState, event: ServerEvent): PipelineViewState {
  const runId = typeof event.runId === 'string' ? event.runId : state.runId;
  switch (event.type) {
    case 'run_started': return { ...initialPipelineState(), runId: String((event.run as { id?: string })?.id ?? ''), status: 'running' };
    case 'run_snapshot': return { ...state, runId: String((event.run as { id?: string })?.id ?? runId ?? ''), status: mapStatus((event.run as { status?: string })?.status) };
    case 'run_state': return { ...state, runId, status: mapStatus(String(event.status ?? '')) };
    case 'status': return { ...state, runId, status: 'running', stage: String(event.stage ?? ''), label: String(event.label ?? '') };
    case 'output': {
      const role = event.role as AgentRole;
      return role in state.outputs ? { ...state, runId, outputs: { ...state.outputs, [role]: String(event.text ?? '') } } : state;
    }
    case 'pty': return { ...state, runId, terminal: bounded(state.terminal + String(event.data ?? '')) };
    case 'usage': return { ...state, runId, usage: event.usage as PipelineViewState['usage'] };
    case 'sandbox': return { ...state, runId, sandbox: event as Record<string, unknown> };
    case 'workspace': return { ...state, runId, workspace: event as Record<string, unknown> };
    case 'done': return { ...state, runId, status: event.passed === false ? 'failed' : 'completed', elapsed: Number(event.elapsed ?? 0) };
    case 'error': return { ...state, runId, status: 'failed', error: String(event.message ?? 'Pipeline failed') };
    default: return state;
  }
}

function bounded(value: string) { return value.length > MAX_TERMINAL_CHARS ? value.slice(-MAX_TERMINAL_CHARS) : value; }
function mapStatus(value?: string): PipelineViewState['status'] {
  if (value === 'running') return 'running';
  if (value === 'completed') return 'completed';
  if (value === 'failed') return 'failed';
  return 'idle';
}
