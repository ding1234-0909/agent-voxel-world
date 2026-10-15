import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentManager, ProviderStore } from '../apps/server/src/agent-manager';
import { DeepSeekError, type ModelPlanner } from '../apps/agent/src/deepseek';
import type { Session, Observation } from '../apps/agent/src/session';
import type { WorldEvent } from '../packages/shared/src/index';
let dir: string, store: ProviderStore, manager: AgentManager | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-life-'));
  store = new ProviderStore(join(dir, 'providers.json'));
  await store.load({ DEEPSEEK_API_KEY: 'fixture' });
});
afterEach(async () => {
  await manager?.close();
  manager = undefined;
  await rm(dir, { recursive: true, force: true });
});
function fakeSession(wait = Promise.resolve()) {
  let open = false;
  const leaves: (() => void)[] = [];
  const session = {
    onEvent: undefined as ((event: WorldEvent) => void) | undefined,
    room: {
      sessionId: 'player-1',
      onLeave: (cb: () => void) => leaves.push(cb),
      connection: { close: () => {} },
    },
    join: vi.fn(async () => {
      await wait;
      open = true;
    }),
    close: vi.fn(async () => {
      if (open) {
        open = false;
        leaves.forEach((cb) => cb());
      }
    }),
    move: vi.fn(),
    observe: vi.fn(
      async () =>
        ({ self: { id: 'player-1' }, events: [] }) as unknown as Observation,
    ),
    request: vi.fn(),
  };
  return session;
}
function setup(
  s: ReturnType<typeof fakeSession>,
  decide = vi.fn(async () => ({ type: 'wait' as const })),
) {
  manager = new AgentManager(store, 'ws://fixture', {
    session: () => s as unknown as Session,
    planner: () => ({ decide }) as unknown as ModelPlanner,
    models: async () => [],
  });
  return manager;
}
const settings = {
  providerId: 'deepseek',
  name: 'Reusable',
  goal: 'Wait',
  maxTurns: 1,
};
it('updates saved settings without inference, protects identity, validates inputs and persists', async () => {
  const s = fakeSession(),
    decide = vi.fn(async () => ({ type: 'wait' as const }));
  const m = setup(s, decide),
    job = m.create(settings);
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  await expect(
    m.update(job.id, {
      intervalMode: 'random',
      intervalMinMs: 8000,
      intervalMaxMs: 4000,
    }),
  ).rejects.toThrow('下限');
  const updated = await m.update(job.id, {
    maxTurns: 50,
    intervalMode: 'random',
    intervalMinMs: 4000,
    intervalMaxMs: 8000,
    maxTokens: 1024,
    allowEdits: true,
    id: 'forged',
    status: 'running',
  });
  expect(updated).toMatchObject({
    id: job.id,
    status: 'idle',
    sessionId: 'player-1',
    maxTurns: 50,
    maxTokens: 1024,
    allowEdits: true,
  });
  expect(decide).toHaveBeenCalledTimes(1);
  expect(s.join).toHaveBeenCalledTimes(1);
  await m.close();
  const restored = setup(s, decide);
  await restored.load();
  expect(restored.list()[0]).toMatchObject({
    id: job.id,
    maxTurns: 50,
    intervalMinMs: 4000,
    intervalMaxMs: 8000,
    maxTokens: 1024,
  });
});
it('task errors leave a joined character online until explicitly closed', async () => {
  const s = fakeSession(),
    decide = vi
      .fn()
      .mockRejectedValue(new DeepSeekError('fixture failure', true));
  const m = setup(s, decide),
    job = m.create(settings);
  await vi.waitFor(() => expect(m.list()[0]?.status).toBe('failed'));
  expect(s.close).not.toHaveBeenCalled();
  expect(m.list()[0]?.sessionId).toBe('player-1');
  m.stop(job.id);
  await vi.waitFor(() => expect(m.list()[0]?.status).toBe('stopped'));
  expect(s.close).toHaveBeenCalled();
});
it('closing while join is pending cannot leave an orphan player or start inference', async () => {
  let resolve!: () => void;
  const s = fakeSession(new Promise<void>((r) => (resolve = r))),
    decide = vi.fn(async () => ({ type: 'wait' as const }));
  const m = setup(s, decide),
    job = m.create(settings);
  m.stop(job.id);
  resolve();
  await vi.waitFor(() => expect(m.list()[0]?.status).toBe('stopped'));
  expect(m.list()[0]?.sessionId).toBeUndefined();
  expect(decide).not.toHaveBeenCalled();
  expect(s.close.mock.calls.length).toBeGreaterThanOrEqual(2);
});
it('unexpected disconnect releases identity and allows rejoining the same saved agent', async () => {
  const s = fakeSession(),
    m = setup(s),
    job = m.create(settings);
  await vi.waitFor(() => expect(m.list()[0]?.status).toBe('idle'));
  await s.close();
  expect(m.list()[0]?.status).toBe('failed');
  expect(m.list()[0]?.sessionId).toBeUndefined();
  m.resume(job.id, { goal: 'New goal' });
  await vi.waitFor(() => expect(m.list()[0]?.status).toBe('idle'));
  expect(m.list()[0]).toMatchObject({
    id: job.id,
    goal: 'New goal',
    sessionId: 'player-1',
  });
  expect(s.join).toHaveBeenCalledTimes(2);
});

it('human mentions wake an idle agent once and queue during inference without concurrent calls', async () => {
  const s = fakeSession();
  let release!: () => void;
  const decide = vi.fn(async () => ({ type: 'wait' as const }));
  const m = setup(s, decide),
    job = m.create(settings);
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  const mention = (seq: number, actorKind = 'human'): WorldEvent => ({
    seq,
    actorKind,
    actor: 'person',
    type: 'chat',
    at: Date.now(),
    data: {
      scope: 'public',
      recipients: ['player-1'],
      text: '换个地方',
      kind: 'text',
      name: 'Person',
    },
  });
  s.onEvent!(mention(1, 'ai-agent'));
  expect(decide).toHaveBeenCalledTimes(1);
  decide.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { type: 'wait' };
  });
  s.onEvent!(mention(2));
  await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
  s.onEvent!(mention(2));
  s.onEvent!(mention(3));
  expect(decide).toHaveBeenCalledTimes(2);
  release();
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  expect(decide).toHaveBeenCalledTimes(3);
  expect(s.join).toHaveBeenCalledTimes(1);
  expect(s.close).not.toHaveBeenCalled();
  m.stop(job.id);
  await vi.waitFor(() => expect(m.list()[0].status).toBe('stopped'));
  s.onEvent!(mention(4));
  expect(decide).toHaveBeenCalledTimes(3);
});
