import type { AgentTask, AgentUsage } from '@voxel/shared';
import type {
  TaskDirective,
  BuildAction,
  BuildResult,
  BatchResult,
} from '../contracts';

export function parseTaskDirective(value: unknown): TaskDirective {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('任务决策无效。');
  const input = value as TaskDirective;
  // JSON-mode providers often emit null for unused optional fields.
  const v = {
    ...input,
    goal: input.goal ?? undefined,
    waitFor: input.waitFor ?? undefined,
  };
  if (
    ![
      'reply',
      'task',
      'update',
      'continue',
      'pause',
      'resume',
      'cancel',
    ].includes(v.intent) ||
    !['running', 'waiting', 'needs_input', 'blocked', 'completed'].includes(
      v.status,
    ) ||
    typeof v.summary !== 'string' ||
    !v.summary.trim() ||
    v.summary.length > 500 ||
    (v.goal !== undefined &&
      (typeof v.goal !== 'string' || !v.goal.trim() || v.goal.length > 2000)) ||
    (v.intent === 'task' && !v.goal) ||
    (v.waitFor !== undefined && !['world', 'players'].includes(v.waitFor)) ||
    (v.status === 'waiting' && !v.waitFor)
  )
    throw Error('任务决策无效。');
  return {
    intent: v.intent,
    status: v.status,
    summary: v.summary.trim(),
    goal: v.goal?.trim(),
    waitFor: v.waitFor,
  };
}

export type AgentRunState = {
  task?: AgentTask;
  usage?: AgentUsage;
  previous?: unknown;
  lastReply?: BatchResult;
  unfinishedBuild?: { action: BuildAction; result: BuildResult };
  waitSignature?: string;
  failures?: number;
  noProgress?: number;
  lastProgress?: string;
  lastResponse?: string;
  decisionError?: string;
  audienceExpired?: boolean;
};

export function newTask(
  goal: string,
  owner?: string,
  privateTo?: string,
): AgentTask {
  return {
    goal,
    owner,
    privateTo,
    status: 'running',
    summary: '任务已接收，等待执行。',
    reason: '',
    calls: 0,
    tokens: 0,
    estimated: false,
    startedAt: Date.now(),
    elapsedMs: 0,
  };
}

/** Restore batch history only; in-flight effects remain unknown and never replay automatically. */
export function restoreBatchHistory(value: unknown): BatchResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as BatchResult;
  if (
    !Array.isArray(candidate.actions) ||
    !Array.isArray(candidate.results) ||
    !Array.isArray(candidate.remaining)
  )
    return undefined;
  const batch = structuredClone(candidate);
  for (const result of batch.results) {
    if (result.status === 'executing') result.status = 'unknown';
  }
  if (batch.stopReason === 'executing') {
    batch.ok = false;
    batch.stopReason = 'unknown';
  }
  return batch;
}
