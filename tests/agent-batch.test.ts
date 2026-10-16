import { describe, expect, it, vi } from 'vitest';
import {
  parseDecision,
  executeBatch,
  runTaskStep,
  newTask,
  AgentAttention,
  restoreBatchHistory,
  ModelPlanner,
  type AgentAction,
  type AgentSession,
  type Observation,
  type AgentRunState,
  type BatchResult,
  type BuildResult,
  type AgentDecision,
  type Planner,
} from '@voxel/agent-runtime';
import { agentConfig } from '../apps/agent/src/cli/deepseek-config';

const task = {
  intent: 'continue',
  status: 'running',
  summary: '推进任务',
} as const;
const edit = (x = 1, material: 'wood' | null = 'wood'): AgentAction => ({
  type: 'edit',
  x,
  y: 3,
  z: 0,
  material,
});
const chat: AgentAction = { type: 'chat', text: '进展汇报' };
const move: AgentAction = {
  type: 'move',
  x: 1,
  z: 0,
  jump: false,
  durationMs: 100,
};
const config = () => ({
  ...agentConfig({ DEEPSEEK_API_KEY: 'fixture' }),
  allowEdits: true,
  timeoutMs: 2000,
});
function fixture() {
  const world: Observation = {
    id: 'obs',
    revision: 1,
    radius: 8,
    blocks: [],
    players: [],
    events: [],
    allowedActions: [],
    self: {
      id: 'ai',
      name: 'AI',
      kind: 'ai-agent',
      connected: true,
      x: 0,
      y: 2.5,
      z: 0,
      yaw: 0,
    },
  };
  const observe = vi.fn(async () => structuredClone(world));
  const request = vi.fn(async (type: string, payload?: any): Promise<any> => {
    if (type === 'observe') return observe();
    if (type === 'edit') {
      if (payload.revision !== world.revision)
        return { ok: false, revision: world.revision, error: 'conflict' };
      world.blocks = world.blocks.filter(
        (b) => !(b.x === payload.x && b.y === payload.y && b.z === payload.z),
      );
      if (payload.material)
        world.blocks.push({
          x: payload.x,
          y: payload.y,
          z: payload.z,
          material: payload.material,
        });
      world.revision++;
    }
    return { id: 'result', ok: true, revision: world.revision };
  });
  const sendMove = vi.fn((x: number, z: number) => {
    world.self.x += x / 2;
    world.self.z += z / 2;
  });
  const session: AgentSession = { observe, request, move: sendMove };
  const abort = new AbortController();
  const history: BatchResult[] = [];
  const builds: BuildResult[] = [];
  const run = (actions: AgentAction[], options = {}) =>
    executeBatch(session, actions, structuredClone(world), true, abort.signal, {
      checkpoint: (value) => history.push(value),
      buildCheckpoint: (_action, value) => builds.push(value),
      ...options,
    });
  return {
    world,
    observe,
    request,
    sendMove,
    session,
    abort,
    history,
    builds,
    run,
  };
}

describe('multi-action protocol', () => {
  it('accepts only a complete actions/task decision', () => {
    expect(parseDecision({ actions: [chat], task }, true)).toMatchObject({
      actions: [chat],
      task,
    });
    expect(
      parseDecision({ actions: Array(8).fill(chat), task }, false).actions,
    ).toHaveLength(8);
  });
  it.each([
    chat,
    { ...chat, task },
    { action: chat, task },
    { action: { ...chat, task } },
    { actions: [chat], task: null },
    { actions: [chat], type: 'chat', task },
    { actions: [], task },
    { actions: Array(9).fill(chat), task },
    { actions: [chat] },
    { actions: [chat, { type: 'shell' }], task },
    { actions: [{ type: 'wait' }, chat], task },
    { actions: [chat], action: chat, task },
    { actions: [{ ...chat, task }], task },
    { actions: [move], task: { ...task, intent: 'reply' } },
    {
      actions: [
        { type: 'build', blocks: [edit()] },
        { type: 'build', blocks: [edit(2)] },
      ],
      task,
    },
  ])('rejects invalid plan before effects: %j', (value) =>
    expect(() => parseDecision(value, true)).toThrow(),
  );
  it('does not allow an authorized chat to hide a forbidden trailing edit', () => {
    expect(() =>
      parseDecision({ actions: [chat, edit()], task }, false),
    ).toThrow();
  });
  it('rejects truncated model output without returning any partial plan', async () => {
    const f = fixture();
    const planner = new ModelPlanner(
      config(),
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'length',
                message: {
                  content: '{"actions":[{"type":"chat","text":"hello"},',
                },
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(
      planner.decide(f.world, null, f.abort.signal),
    ).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
});

describe('sequential batch effects', () => {
  it('validates an invalid tail before the first side effect', async () => {
    const f = fixture();
    await expect(
      f.run([chat, { type: 'shell' } as unknown as AgentAction]),
    ).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it('refreshes positions/revisions, records all steps and runs without another model call', async () => {
    const f = fixture();
    const { batch } = await f.run([move, edit(), edit(2), chat]);
    expect(batch.ok).toBe(true);
    expect(batch.results.map((r) => r.status)).toEqual(
      Array(4).fill('succeeded'),
    );
    expect(batch.results[0]).toMatchObject({
      before: { x: 0 },
      after: { x: 0.5 },
    });
    expect(
      f.request.mock.calls
        .filter(([t]) => t === 'edit')
        .map(([, p]) => p.revision),
    ).toEqual([1, 2]);
    expect(f.observe).toHaveBeenCalledTimes(3);
    expect(
      f.history.some(
        (b) =>
          b.results[1].status === 'succeeded' &&
          b.results[2].status === 'pending',
      ),
    ).toBe(true);
  });
  it('stops at the second failure without executing the trailing chat', async () => {
    const f = fixture();
    f.request
      .mockResolvedValueOnce({ ok: true, revision: 2 })
      .mockResolvedValueOnce({ ok: false, error: 'occupied', revision: 2 });
    const { batch } = await f.run([edit(), edit(2), chat]);
    expect(batch.stopReason).toBe('failed');
    expect(batch.results.map((r) => r.status)).toEqual([
      'succeeded',
      'failed',
      'pending',
    ]);
    expect(batch.remaining).toEqual([chat]);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('does not build after movement with no observed progress', async () => {
    const f = fixture();
    f.sendMove.mockImplementation(() => {});
    const { batch } = await f.run([move, edit()]);
    expect(batch.stopReason).toBe('movement_stalled');
    expect(f.request).not.toHaveBeenCalled();
    expect(f.sendMove).toHaveBeenLastCalledWith(0, 0, false);
  });
  it('keeps an acknowledged edit when the following observation fails', async () => {
    const f = fixture();
    f.observe.mockRejectedValueOnce(Error('offline'));
    const { batch } = await f.run([edit(), chat]);
    expect(batch.stopReason).toBe('observation_failed');
    expect(batch.results[0].status).toBe('succeeded');
    expect(f.world.blocks).toHaveLength(1);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('leaves timed-out requests unknown and never replays them', async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(Error('request timeout'));
    const { batch } = await f.run([edit(), chat]);
    expect(batch.results[0].status).toBe('unknown');
    expect(batch.stopReason).toBe('unknown');
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('aborts an in-flight request immediately and ignores late responses', async () => {
    const f = fixture();
    let release!: (value: any) => void;
    f.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const running = f.run([edit(), chat]);
    f.abort.abort();
    const { batch } = await running;
    expect(batch.results[0].status).toBe('unknown');
    release({ ok: true, revision: 2 });
    await Promise.resolve();
    expect(batch.results[0].status).toBe('unknown');
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('yields after the current action, preserving the unexecuted tail', async () => {
    const f = fixture();
    const { batch } = await f.run([edit(), chat], {
      pending: () => f.world.revision > 1,
    });
    expect(batch.stopReason).toBe('message');
    expect(batch.results.map((r) => r.status)).toEqual([
      'succeeded',
      'pending',
    ]);
  });
  it('paces consecutive chat messages and enforces private routing after refresh', async () => {
    const f = fixture();
    const sent: number[] = [];
    f.world.events = [
      {
        seq: 1,
        type: 'chat',
        actor: 'human',
        actorKind: 'human',
        at: 0,
        data: { scope: 'private', recipients: ['ai'], text: 'do it' },
      },
    ];
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (t, p) => {
      if (t === 'chat') sent.push(Date.now());
      return original(t, p);
    });
    await f.run([edit(), chat, chat]);
    expect(sent[1] - sent[0]).toBeGreaterThanOrEqual(340);
    for (const [, payload] of f.request.mock.calls.filter(
      ([t]) => t === 'chat',
    ))
      expect(payload).toMatchObject({
        scope: 'private',
        recipients: ['human'],
      });
  });
  it('preserves acknowledged deletions and pending/uncertain build work on cancellation', async () => {
    const f = fixture();
    f.world.blocks.push(
      { x: 1, y: 3, z: 0, material: 'wood' },
      { x: 2, y: 3, z: 0, material: 'wood' },
    );
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (t, p) => {
      if (t === 'edit' && p.x === 2) {
        setTimeout(() => f.abort.abort(), 0);
        return new Promise(() => {});
      }
      return original(t, p);
    });
    const { batch } = await f.run([
      {
        type: 'build',
        blocks: [
          { x: 1, y: 3, z: 0, material: null },
          { x: 2, y: 3, z: 0, material: null },
        ],
      },
      chat,
    ]);
    expect(batch.results[0].status).toBe('unknown');
    expect(f.builds.at(-1)).toMatchObject({
      completed: 1,
      remaining: [{ x: 2 }],
      uncertain: [{ x: 2 }],
    });
    expect(f.world.blocks.map((b) => b.x)).toEqual([2]);
    expect(f.request.mock.calls.filter(([t]) => t === 'chat')).toHaveLength(0);
  });
  it('returns a partial build and does not continue the outer sequence', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation((t, p) =>
      t === 'edit' && p.x === 1
        ? Promise.resolve({
            ok: false,
            error: 'out-of-reach',
            revision: f.world.revision,
          })
        : original(t, p),
    );
    const { batch } = await f.run([
      {
        type: 'build',
        blocks: [
          { x: 1, y: 3, z: 0, material: 'wood' },
          { x: 2, y: 3, z: 0, material: 'wood' },
        ],
      },
      chat,
    ]);
    expect(batch.stopReason).toBe('failed');
    expect(f.builds.at(-1)).toMatchObject({
      completed: 1,
      remaining: [{ x: 1 }],
    });
    expect(f.request.mock.calls.filter(([t]) => t === 'chat')).toHaveLength(0);
  });
});

function runtimeFixture() {
  const f = fixture();
  const memory: AgentRunState = { task: newTask('build') };
  const attention = new AgentAttention();
  const planner = {
    decide: vi.fn<Planner['decide']>(),
    lastUsage: { tokens: 50, estimated: false },
  };
  let seq = 0;
  const message = (scope = 'private', actor = 'human') =>
    attention.push(
      {
        seq: ++seq,
        actor,
        actorKind: 'human',
        type: 'chat',
        at: 0,
        data: { text: '你好', scope, recipients: ['ai'], kind: 'text' },
      },
      'ai',
    );
  const saved: AgentRunState[] = [];
  const step = (cfg = config()) =>
    runTaskStep(
      f.session,
      planner,
      cfg,
      f.abort.signal,
      memory,
      attention,
      () => {},
      () => saved.push(structuredClone(memory)),
    );
  return { ...f, memory, attention, planner, message, step, saved };
}

describe('batch task lifecycle', () => {
  it('charges once, prevents immediate completion and confirms on a later model turn', async () => {
    const f = runtimeFixture();
    f.planner.decide
      .mockResolvedValueOnce({
        actions: [edit(), edit(2), chat],
        task: { ...task, status: 'completed' },
      })
      .mockResolvedValueOnce({
        actions: [{ type: 'wait' }],
        task: { ...task, status: 'completed' },
      });
    await f.step();
    expect(f.memory.task).toMatchObject({
      status: 'running',
      calls: 1,
      tokens: 50,
    });
    expect(
      f.saved.some(
        (s) => (s.previous as BatchResult)?.results[1]?.status === 'succeeded',
      ),
    ).toBe(true);
    await f.step();
    expect(f.memory.task?.status).toBe('completed');
    expect(f.planner.decide).toHaveBeenCalledTimes(2);
    expect(
      (f.planner.decide.mock.calls[1][1] as any).previous.results,
    ).toHaveLength(3);
  });
  it('interrupts at a boundary, handles the greeting, and replans instead of replaying the tail', async () => {
    const f = runtimeFixture();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (t, p) => {
      const r = await original(t, p);
      if (t === 'edit') f.message();
      return r;
    });
    f.planner.decide
      .mockResolvedValueOnce({
        actions: [edit(), edit(2)],
        task: { ...task, status: 'completed' },
      })
      .mockResolvedValueOnce({
        actions: [chat],
        task: { ...task, intent: 'reply', status: 'completed' },
      })
      .mockResolvedValueOnce({
        actions: [{ type: 'wait' }],
        task: { ...task, status: 'needs_input' },
      });
    await f.step();
    const previous = structuredClone(f.memory.previous);
    expect(previous).toMatchObject({
      stopReason: 'message',
      remaining: [edit(2)],
    });
    await f.step();
    expect(f.memory.previous).toEqual(previous);
    await f.step();
    expect(f.world.blocks.map((b) => b.x)).toEqual([1]);
    expect(f.planner.decide).toHaveBeenCalledTimes(3);
  });
  it('does not drop queued addressed replies or disclose private batch history', async () => {
    const f = runtimeFixture();
    f.memory.task = newTask('secret', 'owner', 'owner');
    f.memory.previous = { actions: [chat], secret: 'private' };
    f.message('public', 'other');
    f.message('public', 'third');
    f.planner.decide.mockResolvedValue({
      actions: [chat],
      task: { ...task, intent: 'reply', status: 'completed' },
    });
    await f.step();
    await f.step();
    expect(f.request.mock.calls.filter(([t]) => t === 'chat')).toHaveLength(2);
    expect(f.memory.previous).toEqual({ actions: [chat], secret: 'private' });
    for (const [, context] of f.planner.decide.mock.calls)
      expect(context).toMatchObject({ task: undefined, previous: undefined });
  });
  it('counts actual edits as progress even when the last action is chat', async () => {
    const f = runtimeFixture();
    f.memory.noProgress = 2;
    f.planner.decide.mockResolvedValue({ actions: [edit(), chat], task });
    await f.step();
    expect(f.memory.noProgress).toBe(0);
    expect(f.memory.task?.status).toBe('running');
  });
  it('stops a long batch at its time budget without executing the tail', async () => {
    const f = runtimeFixture();
    f.planner.decide.mockResolvedValue({
      actions: [{ ...move, durationMs: 1000 } as AgentAction, edit()],
      task,
    });
    await f.step({ ...config(), taskTimeoutMs: 30 });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.memory.task?.status).toBe('budget');
    expect(f.memory.previous).toMatchObject({ stopReason: 'timeout' });
    expect(f.sendMove).toHaveBeenLastCalledWith(0, 0, false);
  });
  it('restores batch history without converting single-action records', () => {
    expect(
      restoreBatchHistory({ action: chat, result: { ok: true } }),
    ).toBeUndefined();
    const history: BatchResult = {
      actions: [chat],
      results: [{ action: chat, status: 'executing' }],
      remaining: [],
      ok: false,
      stopReason: 'executing',
    };
    expect(restoreBatchHistory(history)).toMatchObject({
      ok: false,
      stopReason: 'unknown',
      results: [{ status: 'unknown' }],
    });
    expect(history.results[0].status).toBe('executing');
  });
  it('does not infer a deleted block from an incomplete or distant observation', async () => {
    const f = runtimeFixture();
    const block = { x: 10, y: 3, z: 0, material: null } as const;
    f.memory.unfinishedBuild = {
      action: { type: 'build', blocks: [block] },
      result: {
        ok: false,
        total: 1,
        completed: 0,
        skipped: 0,
        remaining: [block],
        uncertain: [block],
        failures: [],
        note: 'unknown',
      },
    };
    f.planner.decide.mockResolvedValue({
      actions: [{ type: 'wait' }],
      task: { ...task, status: 'completed' },
    });
    await f.step();
    expect(f.memory.unfinishedBuild?.result.remaining).toEqual([block]);
    expect(f.memory.task?.status).toBe('blocked');
  });
});

it('preserves older pending blueprint coordinates when only a subset is rebuilt', async () => {
  const f = runtimeFixture();
  const blocks = [1, 2].map((x) => ({
    x,
    y: 3,
    z: 0,
    material: 'wood' as const,
  }));
  f.memory.unfinishedBuild = {
    action: { type: 'build', blocks },
    result: {
      ok: false,
      total: 2,
      completed: 0,
      skipped: 0,
      remaining: blocks,
      failures: [],
      note: 'partial',
    },
  };
  f.planner.decide.mockResolvedValue({
    actions: [{ type: 'build', blocks: [blocks[0]] }],
    task,
  });
  await f.step();
  expect(f.memory.unfinishedBuild?.result.remaining).toEqual([blocks[1]]);
  expect(f.memory.task?.status).toBe('running');
});

it('keeps an unconfirmed deletion outside the 500-block cutoff, even inside radius 8', async () => {
  const f = runtimeFixture();
  f.world.blocks = Array.from({ length: 500 }, (_, i) => ({
    x: (i % 10) / 100,
    y: 1,
    z: Math.floor(i / 10) / 100,
    material: 'stone',
  }));
  const block = { x: 6, y: 3, z: 0, material: null } as const;
  f.memory.unfinishedBuild = {
    action: { type: 'build', blocks: [block] },
    result: {
      ok: false,
      total: 1,
      completed: 0,
      skipped: 0,
      remaining: [block],
      uncertain: [block],
      failures: [],
      note: 'unknown',
    },
  };
  f.planner.decide.mockResolvedValue({
    actions: [{ type: 'wait' }],
    task: { ...task, status: 'completed' },
  });
  await f.step();
  expect(f.memory.unfinishedBuild?.result.remaining).toEqual([block]);
  expect(f.memory.task?.status).toBe('blocked');
});

it('confirms an unknown deletion by fresh complete observation without replaying the request', async () => {
  const f = runtimeFixture();
  const block = { x: 1, y: 3, z: 0, material: null } as const;
  f.memory.unfinishedBuild = {
    action: { type: 'build', blocks: [block] },
    result: {
      ok: false,
      total: 1,
      completed: 0,
      skipped: 0,
      remaining: [block],
      uncertain: [block],
      failures: [],
      note: 'unknown',
    },
  };
  f.planner.decide.mockResolvedValue({
    actions: [{ type: 'wait' }],
    task: { ...task, status: 'completed' },
  });
  await f.step();
  expect(f.memory.unfinishedBuild).toBeUndefined();
  expect(f.request).not.toHaveBeenCalled();
  expect(f.memory.task?.status).toBe('completed');
});

it('stops repeated stalled batches after three rounds without ever running their trailing chat', async () => {
  const f = runtimeFixture();
  f.sendMove.mockImplementation(() => {});
  f.planner.decide.mockResolvedValue({ actions: [move, chat], task });
  for (let i = 0; i < 5; i++) await f.step();
  expect(f.planner.decide).toHaveBeenCalledTimes(3);
  expect(f.memory.task?.status).toBe('blocked');
  expect(f.request).not.toHaveBeenCalled();
});

it('does not repeat already empty deletions when resuming a larger original build', async () => {
  const f = fixture();
  f.world.blocks.push({ x: 2, y: 3, z: 0, material: 'wood' });
  const { batch } = await f.run([
    {
      type: 'build',
      blocks: [
        { x: 1, y: 3, z: 0, material: null },
        { x: 2, y: 3, z: 0, material: null },
      ],
    },
  ]);
  expect(batch.ok).toBe(true);
  expect(
    f.request.mock.calls.filter(([t]) => t === 'edit').map(([, p]) => p.x),
  ).toEqual([2]);
  expect(f.builds.at(-1)).toMatchObject({
    skipped: 1,
    completed: 1,
    remaining: [],
  });
});

it.each([
  { type: 'chat', text: 'old action' },
  { type: 'chat', text: 'old action', task },
  { action: chat, task },
  { actions: [chat] },
])(
  'rejects obsolete or incomplete planner decisions before effects: %j',
  async (input) => {
    const f = runtimeFixture();
    f.planner.decide.mockResolvedValue(input as unknown as AgentDecision);
    await f.step();
    expect(f.request).not.toHaveBeenCalled();
    expect(f.sendMove).not.toHaveBeenCalled();
    expect(f.memory.task?.goal).toBe('build');
    expect(f.memory.decisionError).toMatch(/actions|task/);
  },
);

it.each([
  { type: 'chat', text: 'old action', task },
  { action: chat, task },
  { actions: [chat] },
])('rejects obsolete or incomplete JSON from the SDK: %j', async (input) => {
  const f = fixture();
  const planner = new ModelPlanner(
    config(),
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(input) },
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  await expect(planner.decide(f.world, null, f.abort.signal)).rejects.toThrow(
    '格式无效',
  );
});
