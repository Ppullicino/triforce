export const PROTOCOL_VERSION: '1.2.0';
export const PROTOCOL_MAJOR: 1;

export type CliId = 'claude-cli' | 'codex-cli' | 'agy-cli';
export type AgentRole = 'architect' | 'developer' | 'reviewer';
export type BuildPosition = 'promptDesigner' | 'coder' | 'supervisor';
export type PipelineMode = 1 | 2 | 3;

export interface AgentConfiguration { provider: string; model: string }

export interface PipelineConfiguration {
  promptDesigner?: AgentConfiguration;
  coder?: AgentConfiguration;
  supervisor?: AgentConfiguration;
  architect?: AgentConfiguration;
  developer?: AgentConfiguration;
  reviewer?: AgentConfiguration;
  maxIterations?: number;
  maxPromptIterations?: number;
  pool?: CliId[];
  deliberate?: boolean;
}

export function normalizePipelineConfig(config?: Partial<PipelineConfiguration> & Record<string, unknown>): PipelineConfiguration & Record<string, unknown>;

export interface RunCommand { type: 'run'; task: string; config: PipelineConfiguration; mode?: PipelineMode; protocolVersion?: string }
export interface SubscribeCommand { type: 'subscribe'; runId: string; afterEventId?: number; protocolVersion?: string }
export interface CapabilitiesCommand { type: 'capabilities'; protocolVersion: string }
export interface CancelCommand { type: 'cancel'; runId: string; protocolVersion?: string }

export interface FsRootsCommand { type: 'fs.roots'; protocolVersion?: string }
export interface FsListCommand { type: 'fs.list'; path: string; protocolVersion?: string }
export interface FsStatCommand { type: 'fs.stat'; path: string; protocolVersion?: string }
export interface FsSelectWorkingCommand { type: 'fs.selectWorking'; path: string; protocolVersion?: string }
export interface ApplyCommand { type: 'apply'; runId: string; scope?: 'all' | 'files'; paths?: string[]; protocolVersion?: string }
export interface ChatCommand {
  type: 'chat';
  conversationId?: string;
  message: string;
  folder?: string;
  deliberate?: boolean;
  fast?: boolean;
  pool?: CliId[];
  protocolVersion?: string;
}

export type ClientCommand =
  | RunCommand | SubscribeCommand | CapabilitiesCommand | CancelCommand
  | FsRootsCommand | FsListCommand | FsStatCommand | FsSelectWorkingCommand
  | ApplyCommand | ChatCommand;

export type ServerEventType =
  | 'capabilities' | 'cost' | 'done' | 'error' | 'output' | 'protocol_error' | 'pty'
  | 'run_snapshot' | 'run_started' | 'run_state' | 'sandbox' | 'status' | 'usage' | 'workspace'
  | 'fs_list' | 'diff' | 'apply_result' | 'route' | 'deliberation' | 'chat_message';
export type ServerEvent = { type: ServerEventType; runId?: string; eventId?: number; timestamp?: string; [key: string]: unknown };

export interface ValidationSuccess { success: true; data: ClientCommand }
export interface ValidationFailure { success: false; error: { issues: unknown[] } }
export function validateClientCommand(value: unknown): ValidationSuccess | ValidationFailure;
export function validateServerEvent(value: unknown): { success: true; data: ServerEvent } | ValidationFailure;
export function isCompatibleProtocol(version: unknown): boolean;
export const capabilities: Readonly<{
  protocolVersion: string;
  protocolMajor: number;
  modes: readonly PipelineMode[];
  features: readonly string[];
  limits: Readonly<Record<string, number>>;
}>;
