import { setTimeout as pause } from 'node:timers/promises';
import type { AgentConfig, AgentSession, Planner } from '../contracts';
import type { AgentAttention } from './attention';
import { newTask, type AgentRunState } from './task';
import { runTaskStep } from './task-runtime';

/** Draw a fresh inclusive interval after a completed turn; requests never overlap. */
export function nextIntervalMs(
  config: Pick<
    AgentConfig,
    'intervalMode' | 'intervalMs' | 'intervalMinMs' | 'intervalMaxMs'
  >,
  random = Math.random,
): number {
  return config.intervalMode === 'random'
    ? config.intervalMinMs +
        Math.floor(random() * (config.intervalMaxMs - config.intervalMinMs + 1))
    : config.intervalMs;
}

/** CLI task runner. Managed agents schedule exactly one runTaskStep per wake. */
export async function runAgent(
  session: Pick<AgentSession, 'observe' | 'move' | 'request'>,
  planner: Planner,
  config: AgentConfig,
  signal: AbortSignal,
  log: (message: string) => void = console.log,
  memory: AgentRunState = {},
  attention?: AgentAttention,
) {
  memory.task ??= newTask(config.goal);
  do {
    if (signal.aborted) break;
    await runTaskStep(session, planner, config, signal, memory, attention, log);
    if (
      signal.aborted ||
      (!attention?.pending && memory.task?.status !== 'running')
    )
      break;
    if (attention) await attention.wait(nextIntervalMs(config), signal);
    else
      await pause(nextIntervalMs(config), undefined, { signal }).catch(
        () => {},
      );
  } while (!signal.aborted);
}
