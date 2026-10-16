import type { AgentAction, AgentDecision } from '../contracts';
import { parseAction } from '../actions/parse';
import { parseTaskDirective } from '../runtime/task';

/** Accept both a flat action and the common {action, task} envelope. */
export function parseDecision(
  value: unknown,
  allowEdits: boolean,
): AgentDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('模型决策格式无效。');
  const v = value as Record<string, unknown>;
  const actionValue = v.type === undefined ? v.action : v;
  let action: AgentAction;
  try {
    action = parseAction(actionValue, allowEdits);
  } catch {
    throw Error('动作字段不符合约定（类型、参数或权限）。');
  }
  const task =
    v.task ??
    (actionValue && typeof actionValue === 'object'
      ? (actionValue as Record<string, unknown>).task
      : undefined);
  if (task === undefined) return action;
  try {
    return { ...action, task: parseTaskDirective(task) };
  } catch {
    throw Error('任务字段不符合约定（意图、状态、目标或等待条件）。');
  }
}
