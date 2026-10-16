import type { AgentDecision } from '../contracts';
import { parseActions } from '../actions/parse';
import { parseTaskDirective } from './task';

/** Strict model and runtime boundary: validate the complete actions/task object before effects. */
export function parseDecision(
  value: unknown,
  allowEdits: boolean,
): AgentDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('模型决策格式无效。');
  const v = value as Record<string, unknown>;
  if (!('actions' in v) || 'type' in v || 'action' in v)
    throw Error('模型决策必须使用 { actions, task } 格式。');
  if (!v.task) throw Error('模型决策必须提供顶层 task。');
  if (
    Array.isArray(v.actions) &&
    v.actions.some((item) => item && typeof item === 'object' && 'task' in item)
  )
    throw Error('任务决策只能放在整个序列外。');
  let actions;
  try {
    actions = parseActions(v.actions, allowEdits);
  } catch (error) {
    throw Error(
      `动作字段不符合约定（类型、参数或权限）：${error instanceof Error ? error.message : ''}`,
    );
  }
  let task;
  try {
    task = parseTaskDirective(v.task);
  } catch {
    throw Error('任务字段不符合约定（意图、状态、目标或等待条件）。');
  }
  if (
    ['reply', 'pause', 'cancel', 'resume'].includes(task.intent) &&
    actions.some((a) => !['chat', 'wait'].includes(a.type))
  )
    throw Error('回复或任务控制必须使用 chat / wait，不能附带移动或建造动作。');
  return { actions, task };
}
