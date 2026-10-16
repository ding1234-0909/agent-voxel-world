import { setTimeout as delay } from 'node:timers/promises';
import type {
  AgentAction,
  AgentSession,
  BatchResult,
  BuildAction,
  BuildResult,
  Observation,
} from '../contracts';
import { executeAction } from './execute';
import { parseActions } from './parse';

export type BatchOptions = {
  pending?: (index: number) => boolean;
  checkpoint?: (batch: BatchResult) => void;
  buildCheckpoint?: (action: BuildAction, result: BuildResult) => void;
  beforeAction?: (action: AgentAction) => void;
  log?: (message: string) => void;
};

/** Abort waiting without replaying requests whose effects may already have happened. */
async function cancellable<T>(
  request: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([request, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export async function executeBatch(
  session: AgentSession,
  actions: AgentAction[],
  initial: Observation,
  allowEdits: boolean,
  signal: AbortSignal,
  options: BatchOptions = {},
): Promise<{ batch: BatchResult; observation: Observation }> {
  // Defense in depth at the effect boundary, including an invalid final action.
  actions = parseActions(actions, allowEdits);
  const batch: BatchResult = {
    actions,
    results: actions.map((action) => ({ action, status: 'pending' })),
    remaining: [...actions],
    ok: false,
    stopReason: 'executing',
  };
  let observation = initial;
  let lastChat = 0;
  const log = options.log ?? (() => {});
  const save = () => {
    batch.remaining = batch.results
      .filter((r) => r.status === 'pending')
      .map((r) => r.action);
    options.checkpoint?.(structuredClone(batch));
  };
  save();
  for (const [index, entry] of batch.results.entries()) {
    if (signal.aborted) {
      batch.stopReason = 'aborted';
      break;
    }
    if (options.pending?.(index)) {
      batch.stopReason = 'message';
      break;
    }
    const action = entry.action;
    let awaitingEffect = false;
    let phase: 'before' | 'execute' | 'observe' = 'before';
    const guarded: AgentSession = {
      observe: () => {
        signal.throwIfAborted();
        return cancellable(session.observe(), signal);
      },
      move: (x, z, jump) => {
        // Always permit the final stop input after cancellation.
        if (x || z || jump) signal.throwIfAborted();
        session.move(x, z, jump);
      },
      request: async <T>(type: string, payload?: unknown): Promise<T> => {
        signal.throwIfAborted();
        awaitingEffect = type !== 'observe';
        const result = await cancellable(
          session.request<T>(type, payload),
          signal,
        );
        awaitingEffect = false;
        return result;
      },
    };
    try {
      if (action.type === 'chat' && lastChat) {
        await delay(Math.max(0, 350 - (Date.now() - lastChat)), undefined, {
          signal,
        });
        if (options.pending?.(index)) {
          batch.stopReason = 'message';
          break;
        }
      }
      signal.throwIfAborted();
      options.beforeAction?.(action);
      entry.status = 'executing';
      entry.before = {
        x: observation.self.x,
        y: observation.self.y,
        z: observation.self.z,
      };
      save();
      log(`第 ${index + 1}/${actions.length} 个动作：${action.type}`);
      phase = 'execute';
      entry.result = await executeAction(
        guarded,
        action,
        observation,
        allowEdits,
        signal,
        log,
        (result) => {
          entry.result = result;
          if (action.type === 'build' || action.type === 'house')
            options.buildCheckpoint?.(action, result);
          save();
        },
      );
      if (action.type === 'chat') lastChat = Date.now();
      entry.status = entry.result.ok ? 'succeeded' : 'failed';
      save();
      if (['move', 'edit', 'build', 'house'].includes(action.type)) {
        phase = 'observe';
        const fresh = await guarded.observe();
        // Never introduce raw historical chat into this decision's audience.
        observation = {
          ...fresh,
          events: initial.events,
          attention: initial.attention,
        };
        entry.after = { x: fresh.self.x, y: fresh.self.y, z: fresh.self.z };
        if (
          action.type === 'move' &&
          (action.x || action.z || action.jump) &&
          Math.hypot(
            entry.after.x - entry.before.x,
            entry.after.y - entry.before.y,
            entry.after.z - entry.before.z,
          ) < 0.05
        ) {
          entry.status = 'failed';
          entry.result = {
            ok: false,
            note: '未观察到有效移动；不代表到达目标。',
          };
          batch.stopReason = 'movement_stalled';
          break;
        }
      }
      if (!entry.result.ok) {
        batch.stopReason = 'failed';
        break;
      }
      save();
    } catch {
      if (awaitingEffect) {
        entry.status = 'unknown';
        batch.stopReason = 'unknown';
      } else if (phase === 'observe') {
        // Preserve the acknowledged effect, but do not continue on stale observations.
        batch.stopReason = signal.aborted ? 'aborted' : 'observation_failed';
      } else {
        if (entry.status === 'executing')
          entry.status = signal.aborted ? 'interrupted' : 'failed';
        batch.stopReason = signal.aborted ? 'aborted' : 'failed';
      }
      break;
    }
  }
  if (batch.stopReason === 'executing') {
    batch.ok = batch.results.every((r) => r.status === 'succeeded');
    batch.stopReason = batch.ok ? 'completed' : 'failed';
  }
  save();
  log(
    `批次${batch.ok ? '完成' : '中断'}：${batch.stopReason} · 剩余 ${batch.remaining.length} 个动作`,
  );
  return { batch, observation };
}
