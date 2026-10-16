import type { ChatData } from '@voxel/shared';
import { setTimeout as pause } from 'node:timers/promises';
import type {
  AgentSession,
  AgentAction,
  Observation,
  Result,
  BuildResult,
} from '../contracts';
import { parseAction } from './parse';
import { executeBuild } from './building';

export async function executeAction(
  session: Pick<AgentSession, 'move' | 'request'>,
  action: AgentAction,
  observation: Observation,
  allowEdits: boolean,
  signal: AbortSignal,
  progress: (message: string) => void = () => {},
  checkpoint: (result: BuildResult) => void = () => {},
): Promise<Result | BuildResult | { ok: boolean; note: string }> {
  signal.throwIfAborted();
  // Revalidate at the execution boundary as well as the provider boundary.
  action = parseAction(action, allowEdits);
  if (action.type === 'build' || action.type === 'house')
    return executeBuild(session, action, signal, progress, checkpoint);
  if (action.type === 'wait') return { ok: true, note: '等待下一次观察。' };
  if (action.type === 'chat') {
    const { type: _, ...payload } = action;
    const latest = observation.events
      .filter((e) => e.type === 'chat' && e.actor !== observation.self.id)
      .at(-1);
    // Enforce private replies locally, even if the model omits/misstates scope.
    if (
      latest &&
      ['private', 'nearby'].includes((latest.data as ChatData).scope)
    ) {
      payload.scope = 'private';
      payload.recipients = [latest.actor];
    }
    return session.request('chat', payload);
  }
  if (action.type === 'edit') {
    const { type: _, ...edit } = action;
    return session.request('edit', { ...edit, revision: observation.revision });
  }
  // Send at 10 Hz; the server stops movement after 250 ms without input.
  try {
    for (let elapsed = 0; elapsed < action.durationMs; elapsed += 100) {
      signal.throwIfAborted();
      session.move(action.x, action.z, action.jump);
      await pause(Math.min(100, action.durationMs - elapsed), undefined, {
        signal,
      });
    }
    return { ok: true, note: '移动输入已发送；是否到达需由下一轮位置确认。' };
  } finally {
    session.move(0, 0, false);
  }
}
