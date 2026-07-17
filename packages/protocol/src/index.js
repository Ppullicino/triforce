import { z } from 'zod';

export const PROTOCOL_VERSION = '1.1.0';
export const PROTOCOL_MAJOR = 1;
export const agentRoleSchema = z.enum(['architect', 'developer', 'reviewer']);
export const pipelineModeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const agentConfigurationSchema = z.object({
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
});
export const pipelineConfigurationSchema = z.object({
  architect: agentConfigurationSchema,
  developer: agentConfigurationSchema,
  reviewer: agentConfigurationSchema,
  maxIterations: z.number().int().min(1).max(10).optional(),
});
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
export const clientCommandSchema = z.discriminatedUnion('type', [runCommandSchema, subscribeCommandSchema, capabilitiesCommandSchema, cancelCommandSchema]);
export const serverEventSchema = z.object({
  type: z.enum([
    'capabilities', 'cost', 'done', 'error', 'output', 'protocol_error', 'pty',
    'run_snapshot', 'run_started', 'run_state', 'sandbox', 'status', 'usage', 'workspace',
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
  features: ['run-ids', 'event-replay', 'run-status', 'bounded-event-buffer', 'cancellation'],
  limits: { taskCharacters: 50_000, websocketMessageBytes: 1024 * 1024 },
});
