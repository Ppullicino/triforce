export const PROTOCOL_VERSION = '1.0.0' as const;

export type AgentRole = 'architect' | 'developer' | 'reviewer';
export type PipelineMode = 1 | 2 | 3;

export interface AgentConfiguration {
  provider: string;
  model: string;
}

export type PipelineConfiguration = Record<AgentRole, AgentConfiguration> & {
  maxIterations?: number;
};
