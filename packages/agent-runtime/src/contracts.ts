import type {
  AgentSettings,
  Material,
  ChatRoute,
  ProviderType,
  Player,
  Block,
  WorldEvent,
  Vec3,
} from '@voxel/shared';

export type Observation = {
  id: string;
  revision: number;
  self: Player;
  players: Player[];
  blocks: Block[];
  events: WorldEvent[];
  radius: number;
  allowedActions: string[];
  attention?: WorldEvent;
};

export type Result = {
  id: string;
  ok: boolean;
  error?: string;
  revision: number;
};

export type PlannedEdit = Vec3 & { material: Material | null };

export type BuildAction =
  | { type: 'build'; blocks: PlannedEdit[] }
  | {
      type: 'house';
      x: number;
      y: number;
      z: number;
      width: number;
      depth: number;
      height: number;
      material: Material;
      door: 'north' | 'south' | 'east' | 'west';
    };

export type BuildResult = {
  ok: boolean;
  total: number;
  completed: number;
  skipped: number;
  remaining: PlannedEdit[];
  failures: { block: PlannedEdit; error: string }[];
  note: string;
};

export type TaskDirective = {
  intent:
    | 'reply'
    | 'task'
    | 'update'
    | 'continue'
    | 'pause'
    | 'resume'
    | 'cancel';
  status: 'running' | 'waiting' | 'needs_input' | 'blocked' | 'completed';
  summary: string;
  goal?: string;
  waitFor?: 'world' | 'players';
};

export type AgentAction =
  | BuildAction
  | { type: 'wait' }
  | ({ type: 'chat'; text: string } & Partial<ChatRoute>)
  | { type: 'move'; x: number; z: number; jump: boolean; durationMs: number }
  | {
      type: 'edit';
      x: number;
      y: number;
      z: number;
      material: Material | null;
    };

export type AgentDecision = AgentAction & { task?: TaskDirective };

export type AgentConfig = Omit<AgentSettings, 'providerId'> & {
  apiKey: string;
};

export type ModelEndpoint = {
  type: ProviderType;
  baseUrl: string;
  jsonMode: boolean;
  tokenField: 'max_tokens' | 'max_completion_tokens';
};

export interface AgentSession {
  request<T = Result>(type: string, payload?: unknown): Promise<T>;
  move(x: number, z: number, jump?: boolean): void;
  observe(): Promise<Observation>;
}
export interface Planner {
  decide(
    observation: Observation,
    previous: unknown,
    signal: AbortSignal,
  ): Promise<AgentDecision>;
  lastUsage?: { tokens: number; estimated: boolean };
}
