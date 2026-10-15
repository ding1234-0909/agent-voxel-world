export type ProviderType = 'deepseek' | 'ollama' | 'compatible';
export type ProviderView = {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
  jsonMode: boolean;
  tokenField: 'max_tokens' | 'max_completion_tokens';
};
export type AgentSettings = {
  providerId: string;
  model: string;
  name: string;
  goal: string;
  continuous: boolean;
  maxTurns: number;
  intervalMode: 'fixed' | 'random';
  intervalMinMs: number;
  intervalMaxMs: number;
  intervalMs: number;
  timeoutMs: number;
  maxTokens: number;
  allowEdits: boolean;
  voiceReplies?: boolean;
  thinking: 'enabled' | 'disabled';
  reasoningEffort: 'none' | 'low' | 'high' | 'max';
};
export type ManagedAgentView = AgentSettings & {
  id: string;
  providerName: string;
  status:
    | 'joining'
    | 'running'
    | 'idle'
    | 'stopping'
    | 'stopped'
    | 'completed'
    | 'failed';
  createdAt: number;
  sessionId?: string;
  logs: string[];
};
