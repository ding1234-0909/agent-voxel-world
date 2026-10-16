import type { AgentTask, ChatData } from '@voxel/shared';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  AgentSession,
  Observation,
  AgentConfig,
  Planner,
} from '../contracts';
import type { AgentAttention } from './attention';
import { parseTaskDirective, newTask, type AgentRunState } from './task';
import { executeAction } from '../actions/execute';
import { parseAction } from '../actions/parse';
import { AgentRuntimeError } from '../errors';
import { houseBlocks } from '../actions/building';

export function worldSignature(o: Observation, kind: AgentTask['waitFor']) {
  return JSON.stringify(
    kind === 'players'
      ? (o.players ?? [])
          .map((p) => [
            p.id,
            Math.round(p.x * 2),
            Math.round(p.y * 2),
            Math.round(p.z * 2),
            p.connected,
          ])
          .sort()
      : (o.blocks ?? []).map((b) => [b.x, b.y, b.z, b.material]).sort(),
  );
}

function cap(task: AgentTask, config: AgentConfig) {
  if (task.calls >= config.maxTurns)
    return '已达到任务调用上限，请检查进展后手动继续。';
  if (task.tokens >= (config.tokenBudget ?? 50000))
    return '已达到任务 token 预算，请检查进展后手动继续。';
  if (task.elapsedMs >= (config.taskTimeoutMs ?? 900000))
    return '已达到任务执行时间上限，请检查进展后手动继续。';
  return '';
}

/** One wake = at most one model call. Empty polls and unchanged waits cost no tokens. */
export async function runTaskStep(
  session: Pick<AgentSession, 'observe' | 'move' | 'request'>,
  planner: Planner,
  config: AgentConfig,
  signal: AbortSignal,
  memory: AgentRunState,
  attention?: AgentAttention,
  log: (message: string) => void = () => {},
) {
  const addressed = attention?.take();
  let task = memory.task;
  if (!addressed && !['running', 'waiting'].includes(task?.status ?? ''))
    return;
  if (!addressed && task) {
    const reason = cap(task, config);
    if (reason) {
      task.status = 'budget';
      task.reason = reason;
      log(reason);
      return;
    }
  }
  const raw = await session.observe();
  signal.throwIfAborted();
  if (
    !addressed &&
    task?.status === 'waiting' &&
    worldSignature(raw, task.waitFor) === memory.waitSignature
  )
    return;
  if (memory.unfinishedBuild) {
    const observed = new Map(
      (raw.blocks ?? []).map((b) => [`${b.x},${b.y},${b.z}`, b.material]),
    );
    const previous = memory.previous as
      | {
          action?: {
            type?: string;
            x?: number;
            y?: number;
            z?: number;
            material?: unknown;
          };
          result?: { ok?: boolean };
        }
      | undefined;
    const remaining = memory.unfinishedBuild.result.remaining.filter((b) => {
      if (b.material !== null)
        return observed.get(`${b.x},${b.y},${b.z}`) !== b.material;
      const a = previous?.action;
      return !(
        previous?.result?.ok &&
        a?.type === 'edit' &&
        a.material === null &&
        a.x === b.x &&
        a.y === b.y &&
        a.z === b.z
      );
    });
    if (!remaining.length) memory.unfinishedBuild = undefined;
    else memory.unfinishedBuild.result.remaining = remaining;
  }
  const message = addressed?.data as ChatData | undefined;
  const privateTo =
    message && ['private', 'nearby'].includes(message.scope)
      ? addressed!.actor
      : undefined;
  // Conversation and task audiences are independent. A public question never sees a private task.
  const visibleTask =
    task &&
    (!task.privateTo || (addressed ? task.privateTo === privateTo : true));
  const observation = {
    ...raw,
    attention: addressed,
    events: addressed ? [addressed] : [],
  };
  const context = {
    task: visibleTask ? task : undefined,
    previous: visibleTask ? memory.previous : undefined,
    unfinishedBuild: visibleTask ? memory.unfinishedBuild : undefined,
    decisionError: visibleTask ? memory.decisionError : undefined,
    trigger: addressed
      ? 'message'
      : task?.status === 'waiting'
        ? 'condition_changed'
        : 'task',
  };
  const started = Date.now();
  memory.usage ??= { calls: 0, tokens: 0, estimated: false };
  memory.usage.calls++;
  let chargedTask = !addressed ? task : undefined;
  let tokens = 0,
    estimated = true;
  const deadline = new AbortController();
  const decisionTimer = setTimeout(
    () => deadline.abort(),
    Math.max(
      1,
      chargedTask
        ? (config.taskTimeoutMs ?? 900000) - chargedTask.elapsedMs
        : config.timeoutMs,
    ),
  );
  const decisionSignal = AbortSignal.any([signal, deadline.signal]);
  const notifySender = async (text: string) => {
    if (!addressed || signal.aborted) return;
    try {
      const payload = {
        text: text.slice(0, 240),
        scope: 'private',
        recipients: [addressed.actor],
      };
      let result = await session.request('chat', payload);
      if (!result.ok && result.error === '发送过快，请稍候。') {
        await delay(350, undefined, { signal });
        result = await session.request('chat', payload);
      }
      if (!result.ok) log('消息处理回执未送达。');
    } catch {
      log('消息处理回执未送达。');
    }
  };
  let phase = '获取模型决策';
  try {
    const decision = await planner.decide(observation, context, decisionSignal);
    phase = '校验任务决策';
    decisionSignal.throwIfAborted();
    let action = parseAction(decision, config.allowEdits);
    const d = decision.task
      ? parseTaskDirective(decision.task)
      : {
          intent: addressed ? ('reply' as const) : ('continue' as const),
          status: ['wait', 'chat'].includes(action.type)
            ? ('completed' as const)
            : ('running' as const),
          summary:
            action.type === 'wait' ? '本次处理结束。' : '已处理当前请求。',
        };
    if (
      ['reply', 'pause', 'cancel', 'resume'].includes(d.intent) &&
      !['wait', 'chat'].includes(action.type)
    )
      throw new AgentRuntimeError(
        '回复或任务控制必须使用 chat / wait，不能附带移动或建造动作。',
      );
    // Some providers repeat the existing task as "task" or "update" on polls.
    // Only normalize the same goal, retaining identity, audience and all budgets.
    if (
      !addressed &&
      task &&
      (d.intent === 'task' || d.intent === 'update') &&
      (!d.goal || d.goal === task.goal)
    )
      d.intent = 'continue';
    if (!addressed && d.intent !== 'continue')
      throw new AgentRuntimeError(
        '自动推进必须使用 intent=continue，不能创建或替换任务目标。',
      );
    if (addressed && d.intent === 'continue')
      throw new AgentRuntimeError(
        '处理新消息时必须区分 reply、task、update 或任务控制，不能使用 continue。',
      );
    if (d.intent !== 'reply') {
      if (
        addressed &&
        task &&
        !['completed', 'cancelled'].includes(task.status) &&
        ((task.owner && task.owner !== addressed.actor) ||
          (task.privateTo && task.privateTo !== privateTo))
      ) {
        await session.request('chat', {
          text: '我还有正在处理的任务，请由任务发起者修改或取消，或在控制台安排新任务。',
          scope: 'private',
          recipients: [addressed.actor],
        });
        memory.lastResponse = '保留原任务，已提示任务发起者限制。';
        return;
      }
      if (d.intent === 'task') {
        task = memory.task = newTask(d.goal!, addressed!.actor, privateTo);
        memory.previous = undefined;
        memory.unfinishedBuild = undefined;
        memory.noProgress = 0;
        memory.failures = 0;
        memory.lastProgress = undefined;
      } else if (!task || !visibleTask)
        throw new AgentRuntimeError(
          '没有可修改的任务，请使用 task 创建明确的新任务。',
        );
      if (d.intent === 'update' && d.goal) task!.goal = d.goal;
      chargedTask = task;
      if (
        d.intent === 'resume' &&
        ['completed', 'cancelled', 'budget'].includes(task!.status)
      ) {
        // Budget extensions are operator-controlled, never reset by a chat loop.
        await session.request('chat', {
          text: '这个任务已结束或达到预算，请在控制台确认后继续或布置新任务。',
          scope: 'private',
          recipients: [addressed!.actor],
        });
        return;
      }
      if (!['pause', 'cancel'].includes(d.intent)) {
        const reason = cap(task!, config);
        if (reason) {
          task!.status = 'budget';
          task!.reason = reason;
          await notifySender(reason);
          return;
        }
      }
    }
    if (
      chargedTask &&
      chargedTask.elapsedMs + Date.now() - started >=
        (config.taskTimeoutMs ?? 900000)
    ) {
      chargedTask.status = 'budget';
      chargedTask.reason = '任务执行时间预算已耗尽，本次动作未执行。';
      await notifySender(chargedTask.reason);
      return;
    }
    if (
      d.intent !== 'reply' &&
      d.status === 'completed' &&
      memory.unfinishedBuild &&
      ['chat', 'wait'].includes(action.type)
    ) {
      d.status = 'blocked';
      d.summary = `仍有 ${memory.unfinishedBuild.result.remaining.length} 个方块未确认完成，已停止并保留进度。`;
      action = { type: 'chat', text: d.summary };
    }
    // Always route task replies to their original private audience, even after later public messages.
    const routed =
      action.type === 'chat' && !addressed && task?.privateTo
        ? { ...action, scope: 'private' as const, recipients: [task.privateTo] }
        : action;
    if ((action.type === 'build' || action.type === 'house') && chargedTask) {
      const blocks =
        action.type === 'house' ? houseBlocks(action) : action.blocks;
      memory.unfinishedBuild = {
        action,
        result: {
          ok: false,
          total: blocks.length,
          completed: 0,
          skipped: 0,
          remaining: blocks,
          failures: [],
          note: '执行中；若被暂停，继续时重新观察并跳过已有方块。',
        },
      };
    }
    const actionLimit = new AbortController();
    const remaining = chargedTask
      ? Math.max(
          1,
          (config.taskTimeoutMs ?? 900000) -
            chargedTask.elapsedMs -
            (Date.now() - started),
        )
      : config.timeoutMs;
    const timer = setTimeout(() => actionLimit.abort(), remaining);
    let result;
    try {
      phase = `执行 ${action.type} 动作`;
      result = await executeAction(
        session,
        routed,
        observation,
        config.allowEdits,
        AbortSignal.any([decisionSignal, actionLimit.signal]),
        log,
      );
    } finally {
      clearTimeout(timer);
    }
    signal.throwIfAborted();
    phase = '更新任务进展';
    memory.failures = 0;
    memory.decisionError = undefined;
    if (d.intent === 'reply') {
      if (action.type === 'wait') await notifySender(d.summary);
      memory.lastResponse = action.type === 'chat' ? action.text : d.summary;
      log(`消息已处理：${d.summary}`);
      return;
    }
    task!.summary = d.summary;
    task!.reason = d.status === 'running' ? '' : d.summary;
    task!.status =
      d.intent === 'pause'
        ? 'paused'
        : d.intent === 'cancel'
          ? 'cancelled'
          : d.status;
    task!.waitFor = 'waitFor' in d ? d.waitFor : undefined;
    if (
      ['edit', 'build', 'house', 'move'].includes(action.type) &&
      task!.status === 'completed'
    ) {
      task!.status = 'running';
      task!.reason = '等待下一次观察验证执行结果。';
    }
    // A move needs a fresh self-position observation, not a block-change event.
    if (action.type === 'move' && task!.status === 'waiting') {
      task!.status = 'running';
      task!.reason = '等待下一次观察验证移动结果。';
      task!.waitFor = undefined;
    }
    if (!result.ok && task!.status === 'completed') {
      task!.status = 'blocked';
      task!.reason = '动作失败，任务尚未完成。';
    }
    if (
      (action.type === 'build' || action.type === 'house') &&
      'remaining' in result
    )
      memory.unfinishedBuild = result.ok ? undefined : { action, result };
    if (task!.status === 'completed' && memory.unfinishedBuild) {
      task!.status = 'blocked';
      task!.reason = '仍有未完成的建造方块，不能标记完成。';
    }
    if (task!.status === 'cancelled') memory.unfinishedBuild = undefined;
    memory.previous = { action, result };
    const progress = JSON.stringify([
      raw.self?.x,
      raw.self?.y,
      raw.self?.z,
      worldSignature(raw, 'world'),
    ]);
    const changedBlocks =
      'completed' in result &&
      typeof result.completed === 'number' &&
      result.completed > 0;
    memory.noProgress =
      (!result.ok && !changedBlocks) ||
      (progress === memory.lastProgress && !changedBlocks)
        ? (memory.noProgress ?? 0) + 1
        : 0;
    memory.lastProgress = progress;
    if (memory.noProgress >= 3 && task!.status === 'running') {
      task!.status = 'blocked';
      task!.reason = '连续三次失败或没有实际进展，已停止自动重试。';
    }
    if (task!.status === 'waiting')
      memory.waitSignature = worldSignature(raw, task!.waitFor);
    if (addressed && action.type !== 'chat')
      await notifySender(
        result.ok
          ? `收到。${task!.summary}`
          : '收到指令，但这次动作未成功，我会根据执行结果判断下一步。',
      );
    log(
      `${action.type} · 任务${task!.status}：${task!.reason || task!.summary}`,
    );
  } catch (error) {
    if (signal.aborted) return;
    memory.failures = (memory.failures ?? 0) + 1;
    const reason =
      error instanceof AgentRuntimeError
        ? error.message
        : deadline.signal.aborted
          ? '本次任务决策超时，动作已停止。'
          : `${phase}时发生内部异常，已停止本次处理。`;
    memory.decisionError = reason;
    memory.lastResponse = reason;
    log(reason);
    await notifySender(`这条消息处理失败：${reason} 请稍后重试。`);
    if (task && !addressed) {
      if (
        (error instanceof AgentRuntimeError && error.fatal) ||
        memory.failures >= 3
      ) {
        task.status = 'blocked';
        task.reason = reason;
        throw new AgentRuntimeError('Agent 已停止自动执行：' + reason, true);
      }
    }
  } finally {
    clearTimeout(decisionTimer);
    tokens = planner.lastUsage?.tokens ?? config.maxTokens;
    estimated = planner.lastUsage?.estimated ?? true;
    memory.usage.tokens += tokens;
    memory.usage.estimated ||= estimated;
    if (chargedTask) {
      chargedTask.calls++;
      chargedTask.tokens += tokens;
      chargedTask.estimated ||= estimated;
      chargedTask.elapsedMs += Date.now() - started;
      const reason = cap(chargedTask, config);
      if (reason && ['running', 'waiting'].includes(chargedTask.status)) {
        chargedTask.status = 'budget';
        chargedTask.reason = reason;
      }
    }
  }
}
