export const PROTOCOL_VERSION: '1.0.0';
export const PROTOCOL_MAJOR: 1;
export type AgentRole = 'architect' | 'developer' | 'reviewer';
export type PipelineMode = 1 | 2 | 3;
export interface AgentConfiguration { provider: string; model: string }
export type PipelineConfiguration = Record<AgentRole, AgentConfiguration> & { maxIterations?: number };
export interface RunCommand { type: 'run'; task: string; config: PipelineConfiguration; mode?: PipelineMode; protocolVersion?: string }
export interface SubscribeCommand { type: 'subscribe'; runId: string; afterEventId?: number; protocolVersion?: string }
export interface CapabilitiesCommand { type: 'capabilities'; protocolVersion: string }
export type ClientCommand = RunCommand | SubscribeCommand | CapabilitiesCommand;
export type ServerEventType = 'capabilities' | 'cost' | 'done' | 'error' | 'output' | 'protocol_error' | 'pty' | 'run_snapshot' | 'run_started' | 'run_state' | 'sandbox' | 'status' | 'usage' | 'workspace';
export type ServerEvent = { type: ServerEventType; runId?: string; eventId?: number; timestamp?: string; [key: string]: unknown };
export interface ValidationSuccess { success: true; data: ClientCommand }
export interface ValidationFailure { success: false; error: { issues: unknown[] } }
export function validateClientCommand(value: unknown): ValidationSuccess | ValidationFailure;
export function validateServerEvent(value: unknown): { success: true; data: ServerEvent } | ValidationFailure;
export function isCompatibleProtocol(version: unknown): boolean;
export const capabilities: Readonly<{ protocolVersion: string; protocolMajor: number; features: readonly string[]; limits: Readonly<Record<string, number>> }>;
