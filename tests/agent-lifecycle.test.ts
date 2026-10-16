import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentManager, ProviderStore } from '../apps/server/src/agent/manager';
import {
  AgentRuntimeError,
  type Planner,
  type Session,
  type Observation,
} from '@voxel/agent-runtime';

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
      onMessage: vi.fn(),
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
    request: vi.fn(async () => ({ ok: true })),
  };
  return session;
}
function setup(
  s: ReturnType<typeof fakeSession>,
  decide: Planner['decide'] = vi.fn(async () => ({
    actions: [{ type: 'wait' as const }],
    task: {
      intent: 'continue' as const,
      status: 'completed' as const,
      summary: '测试决策',
    },
  })),
) {
  manager = new AgentManager(store, 'ws://fixture', {
    session: () => s as unknown as Session,
    planner: () => ({ decide }),
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
it('toggles voice during inference without restarting the agent or making another model call', async () => {
  let release!: () => void;
  const s = fakeSession();
  const decide = vi.fn(async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return {
      actions: [{ type: 'wait' as const }],
      task: {
        intent: 'continue' as const,
        status: 'completed' as const,
        summary: '测试决策',
      },
    };
  });
  const m = setup(s, decide),
    job = m.create(settings);
  await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
  await expect(m.setVoice(job.id, { enabled: 'yes' })).rejects.toThrow();
  expect((await m.setVoice(job.id, { enabled: true })).voiceReplies).toBe(true);
  expect((await m.setVoice(job.id, { enabled: false })).voiceReplies).toBe(
    false,
  );
  expect(s.request).toHaveBeenLastCalledWith('agent.voice', { enabled: false });
  expect(s.join).toHaveBeenCalledTimes(1);
  expect(s.close).not.toHaveBeenCalled();
  expect(decide).toHaveBeenCalledTimes(1);
  release();
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
});
it('updates saved settings without inference, protects identity, validates inputs and persists', async () => {
  const s = fakeSession(),
    decide = vi.fn(async () => ({
      actions: [{ type: 'wait' as const }],
      task: {
        intent: 'continue' as const,
        status: 'completed' as const,
        summary: '测试决策',
      },
    }));
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
    voiceReplies: true,
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
    voiceReplies: true,
  });
  expect(s.request).toHaveBeenCalledWith('agent.voice', { enabled: true });
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
      .mockRejectedValue(new AgentRuntimeError('fixture failure', true));
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
    decide = vi.fn(async () => ({
      actions: [{ type: 'wait' as const }],
      task: {
        intent: 'continue' as const,
        status: 'completed' as const,
        summary: '测试决策',
      },
    }));
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
  const decide = vi.fn(async () => ({
    actions: [{ type: 'wait' as const }],
    task: {
      intent: 'continue' as const,
      status: 'completed' as const,
      summary: '测试决策',
    },
  }));
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
    return {
      actions: [{ type: 'wait' }],
      task: {
        intent: 'continue' as const,
        status: 'completed' as const,
        summary: '测试决策',
      },
    };
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

it('pause, resume and cancel keep identity and retain task progress across restart', async () => {
  const s = fakeSession();
  const decide = vi.fn(async () => ({
    actions: [{ type: 'wait' as const }],
    task: {
      intent: 'continue' as const,
      status: 'running' as const,
      summary: '地基已规划',
    },
  }));
  const m = setup(s, decide),
    job = m.create({ ...settings, maxTurns: 30, intervalMs: 60000 });
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  await m.controlTask(job.id, 'pause');
  expect(m.list()[0]).toMatchObject({
    sessionId: 'player-1',
    task: { status: 'paused', summary: '地基已规划', calls: 1 },
    usage: { calls: 1 },
  });
  m.resume(job.id);
  await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  await m.controlTask(job.id, 'pause');
  await m.close();
  const restored = setup(s, decide);
  await restored.load();
  expect(decide).toHaveBeenCalledTimes(2);
  expect(restored.list()[0]).toMatchObject({
    task: { status: 'paused', summary: '地基已规划', calls: 2 },
    usage: { calls: 2 },
  });
  await restored.controlTask(job.id, 'cancel');
  expect(restored.list()[0]).toMatchObject({
    sessionId: 'player-1',
    task: { status: 'cancelled' },
  });
});

it('pausing pending inference drops late edits and does not close the character', async () => {
  const s = fakeSession();
  let release!: () => void;
  const decide = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      actions: [
        { type: 'edit' as const, x: 2, y: 3, z: 1, material: 'wood' as const },
      ],
      task: {
        intent: 'continue' as const,
        status: 'running' as const,
        summary: '测试决策',
      },
    };
  });
  const m = setup(s, decide),
    job = m.create({ ...settings, maxTurns: 30, allowEdits: true });
  await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
  const paused = m.controlTask(job.id, 'pause');
  release();
  await paused;
  expect(s.request.mock.calls.some((c) => (c as unknown[])[0] === 'edit')).toBe(
    false,
  );
  expect(s.close).not.toHaveBeenCalled();
  expect(m.list()[0].task?.status).toBe('paused');
});

it('expired private task audiences cannot be resumed after server restart', async () => {
  const s = fakeSession(),
    decide = vi.fn(async () => ({
      actions: [{ type: 'wait' as const }],
      task: {
        intent: 'continue' as const,
        status: 'completed' as const,
        summary: '测试决策',
      },
    }));
  const m = setup(s, decide),
    job = m.create(settings);
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  decide.mockResolvedValueOnce({
    actions: [{ type: 'wait' }],
    task: {
      intent: 'task',
      status: 'waiting',
      waitFor: 'world',
      goal: 'private goal',
      summary: 'waiting',
    },
  } as any);
  s.onEvent!({
    seq: 1,
    at: Date.now(),
    type: 'chat',
    actor: 'private-person',
    actorKind: 'human',
    data: {
      scope: 'private',
      recipients: ['player-1'],
      kind: 'text',
      text: 'secret task',
      name: 'Person',
    },
  });
  await vi.waitFor(() =>
    expect(m.list()[0].task?.privateTo).toBe('private-person'),
  );
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  await m.close();
  const restored = setup(s, decide);
  await restored.load();
  expect(restored.list()[0].task?.status).toBe('needs_input');
  expect(() => restored.resume(job.id)).toThrow('私聊会话已失效');
  expect(decide).toHaveBeenCalledTimes(2);
});

it('keeps the current chat-assigned goal consistent through editing, persistence and rerunning', async () => {
  const s = fakeSession();
  const decide = vi.fn<Planner['decide']>(async () => ({
    actions: [{ type: 'wait' }],
    task: {
      intent: 'continue' as const,
      status: 'completed' as const,
      summary: '测试决策',
    },
  }));
  const m = setup(s, decide),
    job = m.create(settings);
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  decide.mockResolvedValueOnce({
    actions: [{ type: 'wait' }],
    task: {
      intent: 'task',
      status: 'completed',
      goal: 'Build a new house',
      summary: 'House verified',
    },
  });
  s.onEvent!({
    seq: 1,
    at: Date.now(),
    type: 'chat',
    actor: 'person',
    actorKind: 'human',
    data: {
      scope: 'public',
      recipients: ['player-1'],
      kind: 'text',
      text: 'Build a new house',
      name: 'Person',
    },
  });
  await vi.waitFor(() =>
    expect(m.list()[0].task?.goal).toBe('Build a new house'),
  );
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  const before = m.list()[0];
  expect(before.goal).toBe(before.task?.goal);
  const updated = await m.update(job.id, {
    goal: before.goal,
    maxTokens: 1024,
  });
  expect(updated.task).toEqual(before.task);
  const partial = await m.update(job.id, { maxTokens: 2048 });
  expect(partial.goal).toBe('Build a new house');
  expect(partial.task).toEqual(before.task);
  await m.close();
  const restored = setup(s, decide);
  await restored.load();
  expect(restored.list()[0].goal).toBe('Build a new house');
  restored.resume(job.id);
  await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(3));
  expect(decide.mock.calls[2][1]).toMatchObject({
    task: { goal: 'Build a new house' },
  });
  await vi.waitFor(() => expect(restored.list()[0].status).toBe('idle'));
  const changed = await restored.update(job.id, { goal: 'Plant a garden' });
  expect(changed).toMatchObject({
    goal: 'Plant a garden',
    task: { goal: 'Plant a garden', status: 'paused', calls: 0 },
  });
});

it('an online agent with a failed task still accepts a new human mention without automatic retries', async () => {
  const s = fakeSession();
  const decide = vi
    .fn<Planner['decide']>()
    .mockRejectedValueOnce(new AgentRuntimeError('fixture failure', true));
  const m = setup(s, decide),
    job = m.create({ ...settings, maxTurns: 30 });
  await vi.waitFor(() => expect(m.list()[0].status).toBe('failed'));
  expect(decide).toHaveBeenCalledTimes(1);
  decide.mockResolvedValueOnce({
    actions: [{ type: 'chat', text: '我还在，任务已暂停。' }],
    task: { intent: 'reply', status: 'completed', summary: '已回复' },
  });
  s.onEvent!({
    seq: 1,
    at: Date.now(),
    type: 'chat',
    actor: 'human',
    actorKind: 'human',
    data: {
      scope: 'public',
      recipients: ['player-1'],
      kind: 'text',
      text: '还在吗',
      name: 'Person',
    },
  });
  await vi.waitFor(() => expect(m.list()[0].status).toBe('idle'));
  expect(decide).toHaveBeenCalledTimes(2);
  expect(m.list()[0]).toMatchObject({
    id: job.id,
    sessionId: 'player-1',
    task: { status: 'blocked', calls: 1 },
  });
  expect(s.join).toHaveBeenCalledTimes(1);
  expect(s.request).toHaveBeenCalledWith('chat', {
    text: '我还在，任务已暂停。',
  });
});
