import { z } from 'zod';

export const PROTOCOL_VERSION = '1.2.0';
export const PROTOCOL_MAJOR = 1;

/** CLI identifiers — the only model access Triforce has (no hosted API keys). */
export const cliIdSchema = z.enum(['claude-cli', 'codex-cli', 'agy-cli']);

/** Legacy Mode 1 role names. Kept as accepted aliases for one release. */
export const agentRoleSchema = z.enum(['architect', 'developer', 'reviewer']);
/** New Mode 1 position names (structured build loop). */
export const buildPositionSchema = z.enum(['promptDesigner', 'coder', 'supervisor']);

/**
 * Mode meanings as of protocol 1.2.0 (major stays 1; 1.1 clients still negotiate):
 *   1 = structured build   — Prompt Designer -> Supervisor -> Coder -> Supervisor,
 *                            anchored to the human's original prompt. Absorbs the
 *                            old cooperative loop AND the old workspace loop.
 *   2 = credit extender    — roleless router + subscription ledger; optional
 *                            multi-CLI deliberation for Q&A.
 *   3 = verified chat      — draft -> checked by all three CLIs -> reconciled.
 *                            Read-only folder context, never writes or executes.
 */
export const pipelineModeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const agentConfigurationSchema = z.object({
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
});

/**
 * All positions are optional at the protocol layer. The server enforces the
 * triad it actually needs per mode (Mode 1 needs a full build triad; Modes 2/3
 * need none). `normalizePipelineConfig` maps legacy names to new positions.
 */
export const pipelineConfigurationSchema = z.object({
  // new Mode 1 positions
  promptDesigner: agentConfigurationSchema.optional(),
  coder: agentConfigurationSchema.optional(),
  supervisor: agentConfigurationSchema.optional(),
  // legacy aliases (architect->promptDesigner, developer->coder, reviewer->supervisor)
  architect: agentConfigurationSchema.optional(),
  developer: agentConfigurationSchema.optional(),
  reviewer: agentConfigurationSchema.optional(),
  maxIterations: z.number().int().min(1).max(10).optional(),
  maxPromptIterations: z.number().int().min(1).max(10).optional(),
  // Modes 2/3 tuning
  pool: z.array(cliIdSchema).min(1).max(3).optional(),
  deliberate: z.boolean().optional(),
});

/**
 * Map legacy role keys onto the new build positions and keep both populated for
 * one release. Returns a new object; never mutates the input.
 * @param {Record<string, unknown>} [config]
 */
export function normalizePipelineConfig(config = {}) {
  const promptDesigner = config.promptDesigner ?? config.architect;
  const coder = config.coder ?? config.developer;
  const supervisor = config.supervisor ?? config.reviewer;
  const out = { ...config };
  if (promptDesigner) { out.promptDesigner = promptDesigner; out.architect = config.architect ?? promptDesigner; }
  if (coder) { out.coder = coder; out.developer = config.developer ?? coder; }
  if (supervisor) { out.supervisor = supervisor; out.reviewer = config.reviewer ?? supervisor; }
  return out;
}

export const runCommandSchema = z.object({
  type: z.literal('run'),
  task: z.string().trim().min(1).max(50_000),
  config: pipelineConfigurationSchema,
  mode: pipelineModeSchema.optional().default(1),
  protocolVersion: z.string().optional(),
});
export const subscribeCommandSchema = z.object({
  type: z.literal('subscribe'),
  runId: z.string().uuid(),
  afterEventId: z.number().int().nonnegative().optional().default(0),
  protocolVersion: z.string().optional(),
});
export const capabilitiesCommandSchema = z.object({
  type: z.literal('capabilities'),
  protocolVersion: z.string(),
});
export const cancelCommandSchema = z.object({
  type: z.literal('cancel'),
  runId: z.string().uuid(),
  protocolVersion: z.string().optional(),
});

// ── Filesystem navigator (protocol 1.2) ──
const fsPath = z.string().min(1).max(4096);
export const fsRootsCommandSchema = z.object({
  type: z.literal('fs.roots'),
  protocolVersion: z.string().optional(),
});
export const fsListCommandSchema = z.object({
  type: z.literal('fs.list'),
  path: fsPath,
  protocolVersion: z.string().optional(),
});
export const fsStatCommandSchema = z.object({
  type: z.literal('fs.stat'),
  path: fsPath,
  protocolVersion: z.string().optional(),
});
export const fsSelectWorkingCommandSchema = z.object({
  type: z.literal('fs.selectWorking'),
  path: fsPath,
  protocolVersion: z.string().optional(),
});
export const applyCommandSchema = z.object({
  type: z.literal('apply'),
  runId: z.string().uuid(),
  scope: z.enum(['all', 'files']).optional().default('all'),
  paths: z.array(fsPath).max(500).optional(),
  protocolVersion: z.string().optional(),
});

// ── Verified chat (protocol 1.2) ──
export const chatCommandSchema = z.object({
  type: z.literal('chat'),
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(50_000),
  folder: fsPath.optional(),
  deliberate: z.boolean().optional(),
  fast: z.boolean().optional(),
  pool: z.array(cliIdSchema).min(1).max(3).optional(),
  protocolVersion: z.string().optional(),
});

export const clientCommandSchema = z.discriminatedUnion('type', [
  runCommandSchema,
  subscribeCommandSchema,
  capabilitiesCommandSchema,
  cancelCommandSchema,
  fsRootsCommandSchema,
  fsListCommandSchema,
  fsStatCommandSchema,
  fsSelectWorkingCommandSchema,
  applyCommandSchema,
  chatCommandSchema,
]);

export const serverEventSchema = z.object({
  type: z.enum([
    'capabilities', 'cost', 'done', 'error', 'output', 'protocol_error', 'pty',
    'run_snapshot', 'run_started', 'run_state', 'sandbox', 'status', 'usage', 'workspace',
    // protocol 1.2 additions
    'fs_list', 'diff', 'apply_result', 'route', 'deliberation', 'chat_message',
  ]),
  runId: z.string().uuid().optional(),
  eventId: z.number().int().nonnegative().optional(),
  timestamp: z.string().datetime().optional(),
}).loose();

/** @param {unknown} value */
export function validateClientCommand(value) {
  return clientCommandSchema.safeParse(value);
}

/** @param {unknown} value */
export function validateServerEvent(value) {
  return serverEventSchema.safeParse(value);
}

/** @param {unknown} version */
export function isCompatibleProtocol(version) {
  if (typeof version !== 'string') return false;
  return Number.parseInt(version.split('.')[0] ?? '', 10) === PROTOCOL_MAJOR;
}

export const capabilities = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  protocolMajor: PROTOCOL_MAJOR,
  modes: Object.freeze([1, 2, 3]),
  features: Object.freeze([
    'run-ids', 'event-replay', 'run-status', 'bounded-event-buffer', 'cancellation',
    'filesystem', 'deliberation', 'apply', 'verified-chat',
  ]),
  limits: Object.freeze({ taskCharacters: 50_000, websocketMessageBytes: 1024 * 1024 }),
});
